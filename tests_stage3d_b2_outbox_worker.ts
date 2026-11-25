/**
 * MONVERA — STAGE 3D-C1: DURABLE NOTIFICATION OUTBOX WORKER & SAFETY TEST SUITE
 *
 * Strictly offline test harness — sends ZERO live Firebase requests and ZERO real SMS, Email, or Push alerts.
 * Covers all 16 required Stage 3D-C1 scenarios + Firebase Admin local ADC guard + in-app kill-switch preservation.
 */
import assert from 'assert';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { Firestore } from 'firebase-admin/firestore';
import type { Messaging } from 'firebase-admin/messaging';

import {
  ServerNotificationDispatcher,
  areTransferParticipantsAllowlisted,
  buildTrustedTransferDispatchEvents,
  computeDispatchLogId,
  parseNotificationAllowlistUids,
  registerCustomerPushToken,
  resolveDispatchKey,
} from './server/services/notificationDispatcher';
import {
  NOTIFICATION_OUTBOX_COLLECTION,
  type NotificationOutboxRecord,
  buildNotificationOutboxRecord,
  computeNotificationOutboxId,
} from './server/services/notificationOutbox';
import {
  NOTIFICATION_OUTBOX_WORKER_STATE_COLLECTION,
  NotificationOutboxWorker,
  runNotificationOutboxWorkerTick,
  startNotificationOutboxWorker,
  stopNotificationOutboxWorker,
} from './server/services/notificationOutboxWorker';
import { smsService } from './server/services/smsService';
import { emailService } from './server/services/emailService';
import {
  executeServerInternalTransfer,
  executeServerTransfer,
} from './server/firestoreTransactions';
import { createAdminSessionToken } from './server/authMiddleware';

// ---------------------------------------------------------------------------
// Strict Firestore-Faithful In-Memory Harness
// - Enforces ALL reads (tx.get) MUST precede ALL writes (tx.set/create/delete)
// - Supports .where('==', 'in', '<=', '>='), .orderBy() with docId tiebreaker,
//   .startAfter(docSnap | scalarValue), and .limit()
// - Enforces optimistic concurrency version checks across read documents
// ---------------------------------------------------------------------------
type DocStore = Map<string, Map<string, { version: number; data: Record<string, any> }>>;

function cloneVal<T>(v: T): T {
  return v === undefined ? v : structuredClone(v);
}

class InMemoryDocRef {
  constructor(
    private store: DocStore,
    public readonly path: string
  ) {}

  get id(): string {
    const parts = this.path.split('/');
    return parts[parts.length - 1];
  }

  public splitParentAndId(): { colPath: string; docId: string } {
    const idx = this.path.lastIndexOf('/');
    return {
      colPath: this.path.slice(0, idx),
      docId: this.path.slice(idx + 1),
    };
  }

  collection(subCol: string): InMemoryCollectionRef {
    return new InMemoryCollectionRef(this.store, `${this.path}/${subCol}`);
  }

  public readRawEntry(): { version: number; data: Record<string, any> } | undefined {
    const { colPath, docId } = this.splitParentAndId();
    return this.store.get(colPath)?.get(docId);
  }

  async get() {
    const { docId } = this.splitParentAndId();
    const raw = this.readRawEntry();
    return {
      id: docId,
      exists: raw !== undefined,
      ref: this,
      data: () => (raw ? cloneVal(raw.data) : undefined),
    };
  }

  async set(data: Record<string, any>, options?: { merge?: boolean }) {
    const { colPath, docId } = this.splitParentAndId();
    if (!this.store.has(colPath)) {
      this.store.set(colPath, new Map());
    }
    const col = this.store.get(colPath)!;
    const prev = col.get(docId);
    const nextData = options?.merge && prev ? { ...cloneVal(prev.data), ...cloneVal(data) } : cloneVal(data);
    col.set(docId, { version: (prev?.version || 0) + 1, data: nextData });
  }

  async delete() {
    const { colPath, docId } = this.splitParentAndId();
    this.store.get(colPath)?.delete(docId);
  }
}

type QueryFilter = { field: string; op: '==' | 'in' | '<=' | '>='; value: any };
type QueryOrder = { field: string; dir: 'asc' | 'desc' };

class InMemoryQuery {
  constructor(
    protected store: DocStore,
    public readonly colPath: string,
    protected filters: QueryFilter[] = [],
    protected orders: QueryOrder[] = [],
    protected limitVal?: number,
    protected startAfterCursor?: any
  ) {}

  where(field: string, op: '==' | 'in' | '<=' | '>=', value: any): InMemoryQuery {
    return new InMemoryQuery(
      this.store,
      this.colPath,
      [...this.filters, { field, op, value }],
      this.orders,
      this.limitVal,
      this.startAfterCursor
    );
  }

  orderBy(field: string, dir: 'asc' | 'desc' = 'asc'): InMemoryQuery {
    return new InMemoryQuery(
      this.store,
      this.colPath,
      this.filters,
      [...this.orders, { field, dir }],
      this.limitVal,
      this.startAfterCursor
    );
  }

  startAfter(cursor: any): InMemoryQuery {
    return new InMemoryQuery(
      this.store,
      this.colPath,
      this.filters,
      this.orders,
      this.limitVal,
      cursor
    );
  }

  limit(n: number): InMemoryQuery {
    return new InMemoryQuery(
      this.store,
      this.colPath,
      this.filters,
      this.orders,
      n,
      this.startAfterCursor
    );
  }

  async get() {
    const col = this.store.get(this.colPath) || new Map();
    let entries = Array.from(col.entries()).filter(([, entry]) => {
      return this.filters.every((f) => {
        const val = entry.data[f.field];
        if (f.op === '==') return val === f.value;
        if (f.op === 'in') return Array.isArray(f.value) && f.value.includes(val);
        if (f.op === '<=') return typeof val === 'string' && typeof f.value === 'string' && val <= f.value;
        if (f.op === '>=') return typeof val === 'string' && typeof f.value === 'string' && val >= f.value;
        return false;
      });
    });

    if (this.orders.length > 0) {
      entries = entries.sort((a, b) => {
        for (const o of this.orders) {
          const va = String(a[1].data[o.field] ?? '');
          const vb = String(b[1].data[o.field] ?? '');
          const cmp = va < vb ? -1 : va > vb ? 1 : 0;
          if (cmp !== 0) {
            return o.dir === 'asc' ? cmp : -cmp;
          }
        }
        // Firestore ties break by document ID in direction of primary order
        const primaryDir = this.orders[0]?.dir || 'asc';
        const idCmp = a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
        return primaryDir === 'asc' ? idCmp : -idCmp;
      });
    }

    if (this.startAfterCursor !== undefined && this.startAfterCursor !== null && this.orders.length > 0) {
      const primary = this.orders[0];
      if (typeof this.startAfterCursor === 'object' && typeof this.startAfterCursor.id === 'string') {
        const cursorId = this.startAfterCursor.id;
        const cursorData = typeof this.startAfterCursor.data === 'function' ? this.startAfterCursor.data() : undefined;
        const idx = entries.findIndex(([id]) => id === cursorId);
        if (idx >= 0) {
          entries = entries.slice(idx + 1);
        } else if (cursorData && typeof cursorData[primary.field] === 'string') {
          const cv = String(cursorData[primary.field]);
          entries = entries.filter(([id, entry]) => {
            const ev = String(entry.data[primary.field] ?? '');
            if (primary.dir === 'asc') {
              return ev > cv || (ev === cv && id > cursorId);
            }
            return ev < cv || (ev === cv && id < cursorId);
          });
        }
      } else {
        const cv = String(this.startAfterCursor);
        entries = entries.filter(([, entry]) => {
          const ev = String(entry.data[primary.field] ?? '');
          return primary.dir === 'asc' ? ev > cv : ev < cv;
        });
      }
    }

    if (typeof this.limitVal === 'number') {
      entries = entries.slice(0, this.limitVal);
    }

    const docs = entries.map(([docId, entry]) => ({
      id: docId,
      exists: true,
      ref: new InMemoryDocRef(this.store, `${this.colPath}/${docId}`),
      data: () => cloneVal(entry.data),
    }));

    return {
      empty: docs.length === 0,
      size: docs.length,
      docs,
    };
  }
}

class InMemoryCollectionRef extends InMemoryQuery {
  constructor(store: DocStore, colPath: string) {
    super(store, colPath);
  }

  doc(id?: string): InMemoryDocRef {
    const resolvedId = id || `auto_${Math.random().toString(36).slice(2, 12)}`;
    return new InMemoryDocRef(this.store, `${this.colPath}/${resolvedId}`);
  }
}

class StrictInMemoryFirestore {
  public readonly store: DocStore = new Map();
  public onBeforeCommitConflictOnce: ((paths: string[]) => Promise<void> | void) | null = null;
  public lastTransactionAttempts = 0;

  collection(name: string): InMemoryCollectionRef {
    return new InMemoryCollectionRef(this.store, name);
  }

  async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    const maxAttempts = 5;
    this.lastTransactionAttempts = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      this.lastTransactionAttempts = attempt;
      let hasWritten = false;
      const readVersions = new Map<string, number>();
      const pendingOps: Array<
        | { type: 'set'; ref: InMemoryDocRef; data: Record<string, any>; merge: boolean }
        | { type: 'delete'; ref: InMemoryDocRef }
      > = [];

      const tx = {
        get: async (refOrQuery: any) => {
          if (hasWritten) {
            throw new Error('Firestore transactions require all reads before writes.');
          }
          if (typeof refOrQuery?.readRawEntry !== 'function' && typeof refOrQuery?.get === 'function') {
            return refOrQuery.get();
          }
          const ref = refOrQuery as InMemoryDocRef;
          const entry = ref.readRawEntry();
          if (!readVersions.has(ref.path)) {
            readVersions.set(ref.path, entry?.version ?? 0);
          }
          const { docId } = ref.splitParentAndId();
          return {
            id: docId,
            exists: entry !== undefined,
            ref,
            data: () => (entry ? cloneVal(entry.data) : undefined),
          };
        },
        set: (ref: InMemoryDocRef, data: Record<string, any>, opts?: { merge?: boolean }) => {
          hasWritten = true;
          pendingOps.push({ type: 'set', ref, data: cloneVal(data), merge: Boolean(opts?.merge) });
        },
        create: (ref: InMemoryDocRef, data: Record<string, any>) => {
          hasWritten = true;
          pendingOps.push({ type: 'set', ref, data: cloneVal(data), merge: false });
        },
        delete: (ref: InMemoryDocRef) => {
          hasWritten = true;
          pendingOps.push({ type: 'delete', ref });
        },
      };

      const result = await fn(tx);

      if (pendingOps.length === 0) {
        return result;
      }

      if (this.onBeforeCommitConflictOnce) {
        const hook = this.onBeforeCommitConflictOnce;
        this.onBeforeCommitConflictOnce = null;
        await hook(Array.from(readVersions.keys()));
      }

      // Check optimistic concurrency across read docs
      let conflicted = false;
      for (const [docPath, expectedVersion] of readVersions.entries()) {
        const idx = docPath.lastIndexOf('/');
        const colPath = docPath.slice(0, idx);
        const docId = docPath.slice(idx + 1);
        const currentVersion = this.store.get(colPath)?.get(docId)?.version ?? 0;
        if (currentVersion !== expectedVersion) {
          conflicted = true;
          break;
        }
      }

      if (conflicted) {
        if (attempt === maxAttempts) {
          throw new Error('Transaction aborted due to concurrent write conflict.');
        }
        continue;
      }

      for (const op of pendingOps) {
        if (op.type === 'set') {
          await op.ref.set(op.data, { merge: op.merge });
        } else {
          await op.ref.delete();
        }
      }
      return result;
    }

    throw new Error('Unexpected transaction loop termination.');
  }
}

// ---------------------------------------------------------------------------
// Mock Helpers for Zero-Side-Effect External Notification Verification
// ---------------------------------------------------------------------------
interface ExternalCallCounters {
  pushCalls: number;
  smsCalls: number;
  emailCalls: number;
  lastTimeoutSignalPresent: boolean;
}

function createIsolatedDispatcherAndEnv(fs: StrictInMemoryFirestore, options?: {
  pushFailsOnce?: boolean;
  pushAlwaysFails?: boolean;
  pushUnconfigured?: boolean;
  smsDelayOrFail?: 'OK' | 'FAIL_500' | 'TIMEOUT';
  emailFail?: boolean;
}) {
  const counters: ExternalCallCounters = {
    pushCalls: 0,
    smsCalls: 0,
    emailCalls: 0,
    lastTimeoutSignalPresent: false,
  };

  let remainingPushFail = options?.pushFailsOnce ? 1 : 0;

  const mockMessaging: Partial<Messaging> = {
    sendEachForMulticast: async (msg: any) => {
      counters.pushCalls++;
      const count = Array.isArray(msg?.tokens) ? msg.tokens.length : 1;
      if (options?.pushAlwaysFails || remainingPushFail > 0) {
        if (remainingPushFail > 0) remainingPushFail--;
        return {
          successCount: 0,
          failureCount: count,
          responses: Array.from({ length: count }, () => ({
            success: false,
            error: { code: 'messaging/internal-error', message: 'Simulated transient FCM failure' } as any,
          })),
        };
      }
      return {
        successCount: count,
        failureCount: 0,
        responses: Array.from({ length: count }, () => ({
          success: true,
          messageId: `fcm_msg_${counters.pushCalls}`,
        })),
      };
    },
  };

  const dispatcher = new ServerNotificationDispatcher({
    firestore: fs as unknown as Firestore,
    messaging: mockMessaging as Messaging,
    isAdminConfigured: () => true,
    isMessagingConfigured: () => !options?.pushUnconfigured,
  });

  const mockFetch = async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = String(url);
    counters.lastTimeoutSignalPresent = Boolean(init?.signal);

    if (urlStr.includes('twilio.com') || urlStr.includes('termii')) {
      counters.smsCalls++;
      if (options?.smsDelayOrFail === 'TIMEOUT') {
        throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
      }
      if (options?.smsDelayOrFail === 'FAIL_500') {
        return new Response('Twilio server error', { status: 500 });
      }
      return new Response(JSON.stringify({ sid: `SM_${counters.smsCalls}` }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (urlStr.includes('resend.com') || urlStr.includes('sendgrid.com')) {
      counters.emailCalls++;
      if (options?.emailFail) {
        return new Response('Resend upstream error', { status: 500 });
      }
      return new Response(JSON.stringify({ id: `em_${counters.emailCalls}` }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    throw new Error(`Unexpected external HTTP fetch in test: ${urlStr}`);
  };

  return { dispatcher, counters, mockFetch };
}

async function seedCustomerForNotifications(
  fs: StrictInMemoryFirestore,
  uid: string,
  extra?: { email?: string; phone?: string; withToken?: boolean; checkingBalance?: number; savingsBalance?: number }
) {
  const email = extra?.email ?? `${uid}@monvera.test`;
  const phone = extra?.phone ?? '+14155550199';
  const chk = extra?.checkingBalance ?? 5000;
  const sav = extra?.savingsBalance ?? 2000;

  await fs.collection('users').doc(uid).set({
    id: uid,
    uid,
    firstName: 'Test',
    lastName: uid,
    fullName: `User ${uid}`,
    name: `User ${uid}`,
    email,
    phone,
    accountNumber: `CHK-${uid}`,
    permanentAccountNumber: `10${crypto.createHash('sha256').update(uid).digest('hex').slice(0, 8)}`,
    status: 'active',
    role: 'USER',
  });

  await fs.collection('accounts').doc(uid).set({
    userId: uid,
    checkingBalance: chk,
    savingsBalance: sav,
    investmentBalance: 0,
    loanBalance: 0,
    totalBalance: chk + sav,
    availableBalance: chk,
    accounts: [
      {
        id: `acc_chk_${uid}`,
        userId: uid,
        type: 'CHECKING',
        accountNumber: `CHK-${uid}`,
        balance: chk,
        status: 'ACTIVE',
      },
      {
        id: `acc_sav_${uid}`,
        userId: uid,
        type: 'SAVINGS',
        accountNumber: `SAV-${uid}`,
        balance: sav,
        status: 'ACTIVE',
      },
    ],
  });

  if (extra?.withToken !== false) {
    const regRes = await registerCustomerPushToken(
      {
        uid,
        token: `fcm-token-long-enough-for-validation-${uid}-0123456789`,
        platform: 'web',
      },
      fs as unknown as Firestore
    );
    assert.strictEqual(regRes.success, true, `Failed to register test push token: ${regRes.error}`);
  }
}

async function seedOutboxDoc(
  fs: StrictInMemoryFirestore,
  overrides: Partial<NotificationOutboxRecord> & { id: string; userId: string }
): Promise<NotificationOutboxRecord> {
  const base = buildNotificationOutboxRecord({
    userId: overrides.userId,
    transactionId: overrides.transactionId || `tx_${overrides.id}`,
    referenceNumber: overrides.referenceNumber || `REF-${overrides.id}`,
    eventKey: overrides.eventKey || `${overrides.transactionId || `tx_${overrides.id}`}:COMPLETED`,
    lifecycleStage: overrides.lifecycleStage || 'COMPLETED',
    dispatchType: overrides.dispatchType || 'TRANSACTION',
    category: overrides.category || 'TRANSACTION',
    payload: overrides.payload || {
      title: 'Monvera Account Update',
      body: 'Safe summary body.',
      amount: 100,
      currency: 'USD',
    },
    nowIso: overrides.createdAt || '2026-04-05T12:00:00.000Z',
  });

  const merged: NotificationOutboxRecord = {
    ...base,
    ...overrides,
  };
  await fs.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(merged.id).set(merged);
  return merged;
}

const originalFetch = globalThis.fetch;
const savedEnv = { ...process.env };

function restoreTestEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, savedEnv);
  globalThis.fetch = originalFetch;
}

function configureTestProvidersEnv() {
  process.env.TWILIO_ACCOUNT_SID = 'AC_test_mock';
  process.env.TWILIO_AUTH_TOKEN = 'twilio_token_mock';
  process.env.TWILIO_PHONE_NUMBER = '+14155550000';
  process.env.RESEND_API_KEY = 're_test_mock';
  process.env.EMAIL_FROM = 'alerts@monvera.test';
  delete process.env.DISABLE_OUTBOUND_NOTIFICATIONS;
  delete process.env.NOTIFICATION_ALLOWLIST_UIDS;
  delete process.env.NOTIFICATION_ALLOWLIST_MODE;
  delete process.env.VERCEL;
  process.env.NOTIFICATION_WORKER_ENABLED = 'true';
  process.env.NOTIFICATION_OUTBOX_MIN_CREATED_AT = '2026-04-01T00:00:00.000Z';
}

async function runTests() {
  console.log('=== STAGE 3D-C1: DURABLE NOTIFICATION OUTBOX WORKER TEST SUITE ===\n');

  // -------------------------------------------------------------------------
  // TEST 1: Worker disabled by default (NOTIFICATION_WORKER_ENABLED unset/false)
  // -------------------------------------------------------------------------
  restoreTestEnv();
  {
    const fsMem = new StrictInMemoryFirestore();
    await seedCustomerForNotifications(fsMem, 'uid_default_off');
    await seedOutboxDoc(fsMem, {
      id: 'outbox_default_off',
      userId: 'uid_default_off',
      createdAt: '2026-04-10T00:00:00.000Z',
      nextAttemptAt: '2026-04-10T00:00:00.000Z',
    });

    delete process.env.NOTIFICATION_WORKER_ENABLED;
    process.env.NOTIFICATION_OUTBOX_MIN_CREATED_AT = '2026-04-01T00:00:00.000Z';

    const { dispatcher, counters, mockFetch } = createIsolatedDispatcherAndEnv(fsMem);
    globalThis.fetch = mockFetch as any;

    const tickUnset = await runNotificationOutboxWorkerTick({
      firestore: fsMem as unknown as Firestore,
      dispatcher,
    });
    assert.strictEqual(tickUnset.executed, false);
    assert.strictEqual(tickUnset.skippedReason, 'WORKER_DISABLED');

    process.env.NOTIFICATION_WORKER_ENABLED = 'false';
    const tickFalse = await runNotificationOutboxWorkerTick({
      firestore: fsMem as unknown as Firestore,
      dispatcher,
    });
    assert.strictEqual(tickFalse.executed, false);
    assert.strictEqual(tickFalse.skippedReason, 'WORKER_DISABLED');

    const started = startNotificationOutboxWorker({
      firestore: fsMem as unknown as Firestore,
      dispatcher,
    });
    assert.strictEqual(started, null, 'startNotificationOutboxWorker must return null when disabled');

    const stored = (await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc('outbox_default_off').get()).data();
    assert.strictEqual(stored?.status, 'PENDING');
    assert.strictEqual(stored?.attemptCount, 0);
    assert.strictEqual(counters.pushCalls + counters.smsCalls + counters.emailCalls, 0);
    console.log('[PASS] 1. Worker strictly disabled by default when NOTIFICATION_WORKER_ENABLED is unset or false');
  }

  // -------------------------------------------------------------------------
  // TEST 2: Worker refuses to run under Vercel serverless runtime
  // -------------------------------------------------------------------------
  restoreTestEnv();
  {
    configureTestProvidersEnv();
    process.env.VERCEL = '1';
    const fsMem = new StrictInMemoryFirestore();
    await seedOutboxDoc(fsMem, {
      id: 'outbox_vercel',
      userId: 'uid_vercel',
      createdAt: '2026-04-10T00:00:00.000Z',
      nextAttemptAt: '2026-04-10T00:00:00.000Z',
    });

    const { dispatcher, counters, mockFetch } = createIsolatedDispatcherAndEnv(fsMem);
    globalThis.fetch = mockFetch as any;

    const tick = await runNotificationOutboxWorkerTick({
      firestore: fsMem as unknown as Firestore,
      dispatcher,
    });
    assert.strictEqual(tick.executed, false);
    assert.strictEqual(tick.skippedReason, 'VERCEL_SERVERLESS_BLOCKED');

    const started = startNotificationOutboxWorker({
      firestore: fsMem as unknown as Firestore,
      dispatcher,
    });
    assert.strictEqual(started, null, 'Worker must refuse startup in Vercel runtime');
    assert.strictEqual(counters.pushCalls + counters.smsCalls + counters.emailCalls, 0);
    console.log('[PASS] 2. Worker refuses to start or run ticks under Vercel serverless runtime');
  }

  // -------------------------------------------------------------------------
  // TEST 3: DISABLE_OUTBOUND_NOTIFICATIONS=true blocks FCM/SMS/Email, leaves outbox PENDING,
  //         and still preserves in-app notification persistence
  // -------------------------------------------------------------------------
  restoreTestEnv();
  {
    configureTestProvidersEnv();
    process.env.DISABLE_OUTBOUND_NOTIFICATIONS = 'true';
    const fsMem = new StrictInMemoryFirestore();
    await seedCustomerForNotifications(fsMem, 'uid_killswitch');
    await seedOutboxDoc(fsMem, {
      id: 'outbox_killswitch',
      userId: 'uid_killswitch',
      createdAt: '2026-04-10T00:00:00.000Z',
      nextAttemptAt: '2026-04-10T00:00:00.000Z',
    });

    const { dispatcher, counters, mockFetch } = createIsolatedDispatcherAndEnv(fsMem);
    globalThis.fetch = mockFetch as any;

    // 3a. Worker pauses without claiming or mutating records
    const tick = await runNotificationOutboxWorkerTick({
      firestore: fsMem as unknown as Firestore,
      dispatcher,
    });
    assert.strictEqual(tick.executed, false);
    assert.strictEqual(tick.skippedReason, 'OUTBOUND_NOTIFICATIONS_DISABLED');
    const started = startNotificationOutboxWorker({
      firestore: fsMem as unknown as Firestore,
      dispatcher,
    });
    assert.strictEqual(started, null);

    const stored = (await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc('outbox_killswitch').get()).data();
    assert.strictEqual(stored?.status, 'PENDING');
    assert.strictEqual(stored?.attemptCount, 0);

    // 3b. Direct provider calls & dispatchNotification preserve in-app notification while suppressing outbound
    const smsRes = await smsService.sendTransactionSms({
      to: '+14155550199',
      type: 'MONEY_RECEIVED',
      amount: 50,
      currency: 'USD',
      referenceNumber: 'REF-KS',
    });
    const emailRes = await emailService.sendTransactionalEmail({
      to: 'user@monvera.test',
      type: 'MONEY_RECEIVED',
      amount: 50,
      currency: 'USD',
      referenceNumber: 'REF-KS',
    });
    assert.strictEqual(smsRes.status, 'SKIPPED');
    assert.strictEqual(emailRes.status, 'SKIPPED');

    const inAppDispatcher = new ServerNotificationDispatcher({
      firestore: fsMem as unknown as Firestore,
      isAdminConfigured: () => true,
      isMessagingConfigured: () => true,
      persistNotification: async (input) => {
        await fsMem.collection('notifications').doc(input.id).set(input);
        return input as any;
      },
    });

    await inAppDispatcher.dispatchNotification('uid_killswitch', {
      id: 'notif_ks_inapp_1',
      title: 'Credit Alert',
      message: 'Your account received funds.',
      type: 'TRANSACTION',
      referenceId: 'REF-KS-INAPP',
    });

    const inAppSnap = await fsMem
      .collection('notifications')
      .where('userId', '==', 'uid_killswitch')
      .get();
    assert.strictEqual(inAppSnap.size, 1, 'In-app notification must still be stored when outbound is disabled');
    assert.strictEqual(counters.pushCalls, 0);
    assert.strictEqual(counters.smsCalls, 0);
    assert.strictEqual(counters.emailCalls, 0);
    console.log('[PASS] 3. DISABLE_OUTBOUND_NOTIFICATIONS=true blocks FCM/SMS/Email, leaves outbox untouched, preserves in-app storage');
  }

  // -------------------------------------------------------------------------
  // TEST 4: Historical records (createdAt < minCreatedAt, including retried) untouched
  // -------------------------------------------------------------------------
  restoreTestEnv();
  {
    configureTestProvidersEnv();
    process.env.NOTIFICATION_OUTBOX_MIN_CREATED_AT = '2026-04-10T00:00:00.000Z';
    process.env.NOTIFICATION_ALLOWLIST_UIDS = 'uid_hist';
    const fsMem = new StrictInMemoryFirestore();
    await seedCustomerForNotifications(fsMem, 'uid_hist');

    // Historical PENDING whose nextAttemptAt is also before cutoff
    await seedOutboxDoc(fsMem, {
      id: 'hist_old_pending',
      userId: 'uid_hist',
      status: 'PENDING',
      createdAt: '2026-03-01T00:00:00.000Z',
      nextAttemptAt: '2026-03-01T00:00:00.000Z',
    });
    // Historical FAILED_RETRYABLE whose nextAttemptAt was bumped past minCreatedAt by an old retry
    await seedOutboxDoc(fsMem, {
      id: 'hist_retried_newer_next',
      userId: 'uid_hist',
      status: 'FAILED_RETRYABLE',
      attemptCount: 1,
      createdAt: '2026-03-15T00:00:00.000Z',
      nextAttemptAt: '2026-04-11T00:00:00.000Z',
    });
    // Historical expired PROCESSING
    await seedOutboxDoc(fsMem, {
      id: 'hist_expired_proc',
      userId: 'uid_hist',
      status: 'PROCESSING',
      attemptCount: 1,
      leaseOwner: 'dead_worker',
      leaseToken: 'old_tok',
      leaseExpiresAt: '2026-04-10T01:00:00.000Z',
      createdAt: '2026-03-20T00:00:00.000Z',
      nextAttemptAt: '2026-04-11T00:00:00.000Z',
    });

    const { dispatcher, counters, mockFetch } = createIsolatedDispatcherAndEnv(fsMem);
    globalThis.fetch = mockFetch as any;

    const tick = await runNotificationOutboxWorkerTick({
      firestore: fsMem as unknown as Firestore,
      dispatcher,
      nowFn: () => Date.parse('2026-04-15T00:00:00.000Z'),
    });

    assert.strictEqual(tick.executed, true);
    assert.strictEqual(tick.claimedCount, 0);
    assert.strictEqual(tick.dispatchedCount, 0);
    assert.strictEqual(counters.pushCalls + counters.smsCalls + counters.emailCalls, 0);

    const r1 = (await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc('hist_old_pending').get()).data();
    const r2 = (await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc('hist_retried_newer_next').get()).data();
    const r3 = (await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc('hist_expired_proc').get()).data();
    assert.strictEqual(r1?.attemptCount, 0);
    assert.strictEqual(r1?.status, 'PENDING');
    assert.strictEqual(r2?.attemptCount, 1);
    assert.strictEqual(r2?.status, 'FAILED_RETRYABLE');
    assert.strictEqual(r3?.attemptCount, 1);
    assert.strictEqual(r3?.status, 'PROCESSING');
    console.log('[PASS] 4. Historical records (including retried records with newer nextAttemptAt) remain completely untouched');
  }

  // -------------------------------------------------------------------------
  // TEST 5: Missing / malformed createdAt untouched + missing/malformed cutoff fails closed
  // -------------------------------------------------------------------------
  restoreTestEnv();
  {
    configureTestProvidersEnv();
    process.env.NOTIFICATION_ALLOWLIST_UIDS = 'uid_malformed';
    const fsMem = new StrictInMemoryFirestore();
    await seedCustomerForNotifications(fsMem, 'uid_malformed');

    // Worker fails closed when NOTIFICATION_OUTBOX_MIN_CREATED_AT is missing or malformed ("1", "invalid", "")
    for (const badCutoff of [undefined, '', '1', 'not-a-timestamp']) {
      if (badCutoff === undefined) delete process.env.NOTIFICATION_OUTBOX_MIN_CREATED_AT;
      else process.env.NOTIFICATION_OUTBOX_MIN_CREATED_AT = badCutoff;
      const t = await runNotificationOutboxWorkerTick({ firestore: fsMem as unknown as Firestore });
      assert.strictEqual(t.executed, false);
      assert.strictEqual(t.skippedReason, 'INVALID_OR_MISSING_MIN_CREATED_AT');
    }

    process.env.NOTIFICATION_OUTBOX_MIN_CREATED_AT = '2026-04-01T00:00:00.000Z';
    const badValues: any[] = [undefined, '', '1', 'not-a-date', 123456];
    for (let i = 0; i < badValues.length; i++) {
      const rec = await seedOutboxDoc(fsMem, {
        id: `bad_created_${i}`,
        userId: 'uid_malformed',
        createdAt: '2026-04-10T00:00:00.000Z',
        nextAttemptAt: '2026-04-10T00:00:00.000Z',
      });
      if (badValues[i] === undefined) {
        delete (rec as any).createdAt;
      } else {
        (rec as any).createdAt = badValues[i];
      }
      await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(rec.id).set(rec);
    }

    const { dispatcher, counters, mockFetch } = createIsolatedDispatcherAndEnv(fsMem);
    globalThis.fetch = mockFetch as any;

    const tick = await runNotificationOutboxWorkerTick({
      firestore: fsMem as unknown as Firestore,
      dispatcher,
      nowFn: () => Date.parse('2026-04-15T00:00:00.000Z'),
    });
    assert.strictEqual(tick.executed, true);
    assert.strictEqual(tick.skippedHistoricalOrInvalid, badValues.length);
    assert.strictEqual(tick.claimedCount, 0);
    assert.strictEqual(counters.pushCalls + counters.smsCalls + counters.emailCalls, 0);

    for (let i = 0; i < badValues.length; i++) {
      const stored = (await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(`bad_created_${i}`).get()).data();
      assert.strictEqual(stored?.status, 'PENDING');
      assert.strictEqual(stored?.attemptCount, 0);
    }
    console.log('[PASS] 5. Missing/malformed createdAt untouched and missing/malformed MIN_CREATED_AT fails closed');
  }

  // -------------------------------------------------------------------------
  // TEST 6: Non-allowlisted UID records remain completely untouched
  // -------------------------------------------------------------------------
  restoreTestEnv();
  {
    configureTestProvidersEnv();
    process.env.NOTIFICATION_ALLOWLIST_UIDS = 'uid_approved_1, uid_approved_2';
    const fsMem = new StrictInMemoryFirestore();
    await seedCustomerForNotifications(fsMem, 'uid_stranger');
    await seedOutboxDoc(fsMem, {
      id: 'not_allowlisted_doc',
      userId: 'uid_stranger',
      dispatchType: 'TRANSACTION',
      createdAt: '2026-04-10T00:00:00.000Z',
      nextAttemptAt: '2026-04-10T00:00:00.000Z',
    });

    const { dispatcher, counters, mockFetch } = createIsolatedDispatcherAndEnv(fsMem);
    globalThis.fetch = mockFetch as any;

    const tick = await runNotificationOutboxWorkerTick({
      firestore: fsMem as unknown as Firestore,
      dispatcher,
      nowFn: () => Date.parse('2026-04-15T00:00:00.000Z'),
    });
    assert.strictEqual(tick.skippedNotAllowlisted, 1);
    assert.strictEqual(tick.claimedCount, 0);
    assert.strictEqual(counters.pushCalls + counters.smsCalls + counters.emailCalls, 0);

    const stored = (await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc('not_allowlisted_doc').get()).data();
    assert.strictEqual(stored?.status, 'PENDING');
    assert.strictEqual(stored?.attemptCount, 0);
    console.log('[PASS] 6. Non-allowlisted UID records remain completely untouched');
  }

  // -------------------------------------------------------------------------
  // TEST 7: Two-account C2C isolation (partial allowlist rejected; both allowlisted succeeds)
  // -------------------------------------------------------------------------
  restoreTestEnv();
  {
    configureTestProvidersEnv();
    process.env.NOTIFICATION_ALLOWLIST_UIDS = 'uid_test_a,uid_test_b';
    const fsMem = new StrictInMemoryFirestore();
    await seedCustomerForNotifications(fsMem, 'uid_test_a');
    await seedCustomerForNotifications(fsMem, 'uid_test_b');
    await seedCustomerForNotifications(fsMem, 'uid_prod_c');

    // Mixed C2C transfer: uid_test_a -> uid_prod_c (uid_prod_c NOT in allowlist)
    await fsMem.collection('transactions').doc('tx_c2c_mixed').set({
      id: 'tx_c2c_mixed',
      type: 'TRANSFER',
      status: 'COMPLETED',
      senderUserId: 'uid_test_a',
      recipientUserId: 'uid_prod_c',
      amount: 120,
      metadata: {},
    });
    await seedOutboxDoc(fsMem, {
      id: 'c2c_mixed_sender',
      userId: 'uid_test_a',
      transactionId: 'tx_c2c_mixed',
      dispatchType: 'MONEY_SENT',
      createdAt: '2026-04-10T00:00:00.000Z',
      nextAttemptAt: '2026-04-10T00:00:00.000Z',
    });
    await seedOutboxDoc(fsMem, {
      id: 'c2c_mixed_recip',
      userId: 'uid_prod_c',
      transactionId: 'tx_c2c_mixed',
      dispatchType: 'MONEY_RECEIVED',
      createdAt: '2026-04-10T00:00:00.000Z',
      nextAttemptAt: '2026-04-10T00:00:00.000Z',
    });

    // Direct C2C guard helper must also reject mixed pair
    const allowlistSet = parseNotificationAllowlistUids();
    assert.strictEqual(
      areTransferParticipantsAllowlisted(
        { senderUserId: 'uid_test_a', recipientUserId: 'uid_prod_c' },
        allowlistSet
      ),
      false
    );

    // Approved C2C transfer: uid_test_a -> uid_test_b (BOTH in allowlist)
    await fsMem.collection('transactions').doc('tx_c2c_ok').set({
      id: 'tx_c2c_ok',
      type: 'TRANSFER',
      status: 'COMPLETED',
      senderUserId: 'uid_test_a',
      recipientUserId: 'uid_test_b',
      amount: 75,
      metadata: {},
    });
    await seedOutboxDoc(fsMem, {
      id: 'c2c_ok_sender',
      userId: 'uid_test_a',
      transactionId: 'tx_c2c_ok',
      dispatchType: 'MONEY_SENT',
      createdAt: '2026-04-10T01:00:00.000Z',
      nextAttemptAt: '2026-04-10T01:00:00.000Z',
    });
    await seedOutboxDoc(fsMem, {
      id: 'c2c_ok_recip',
      userId: 'uid_test_b',
      transactionId: 'tx_c2c_ok',
      dispatchType: 'MONEY_RECEIVED',
      createdAt: '2026-04-10T01:00:00.000Z',
      nextAttemptAt: '2026-04-10T01:00:00.000Z',
    });
    assert.strictEqual(
      areTransferParticipantsAllowlisted(
        { senderUserId: 'uid_test_a', recipientUserId: 'uid_test_b' },
        allowlistSet
      ),
      true
    );

    const { dispatcher, counters, mockFetch } = createIsolatedDispatcherAndEnv(fsMem);
    globalThis.fetch = mockFetch as any;

    const tick = await runNotificationOutboxWorkerTick({
      firestore: fsMem as unknown as Firestore,
      dispatcher,
      nowFn: () => Date.parse('2026-04-15T00:00:00.000Z'),
    });

    assert.strictEqual(tick.skippedNotAllowlisted, 2, 'Both legs of mixed C2C pair must be rejected');
    assert.strictEqual(tick.dispatchedCount, 2, 'Both legs of fully allowlisted C2C pair must dispatch');
    assert.strictEqual(counters.pushCalls, 2);

    // Mixed pair untouched
    assert.strictEqual(
      (await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc('c2c_mixed_sender').get()).data()?.status,
      'PENDING'
    );
    assert.strictEqual(
      (await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc('c2c_mixed_recip').get()).data()?.status,
      'PENDING'
    );
    // Approved pair dispatched
    assert.strictEqual(
      (await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc('c2c_ok_sender').get()).data()?.status,
      'DISPATCHED'
    );
    assert.strictEqual(
      (await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc('c2c_ok_recip').get()).data()?.status,
      'DISPATCHED'
    );
    console.log('[PASS] 7. Two-account C2C isolation blocks mixed pairs and permits dual-allowlisted pairs');
  }

  // -------------------------------------------------------------------------
  // TEST 8: C2C and Admin transfer eventKey parity (${txId}:COMPLETED) prevents duplicates
  // -------------------------------------------------------------------------
  restoreTestEnv();
  {
    configureTestProvidersEnv();
    process.env.NOTIFICATION_ALLOWLIST_UIDS = 'uid_sender,uid_recip';
    const fsMem = new StrictInMemoryFirestore();
    await seedCustomerForNotifications(fsMem, 'uid_sender');
    await seedCustomerForNotifications(fsMem, 'uid_recip');

    const { dispatcher, counters, mockFetch } = createIsolatedDispatcherAndEnv(fsMem);
    globalThis.fetch = mockFetch as any;

    // 8a. C2C transfer via executeServerTransfer -> writes outbox with eventKey "${tx.id}:COMPLETED"
    const transferRes = await executeServerTransfer(
      {
        senderUid: 'uid_sender',
        recipientIdentifier: 'uid_recip',
        recipientUserId: 'uid_recip',
        amount: 250,
        referenceNumber: 'MV-PARITY-C2C-1',
        description: 'Test C2C parity',
      },
      {
        firestore: fsMem as unknown as Firestore,
        isAdminConfigured: () => true,
      }
    );
    assert.strictEqual(transferRes.success, true, `executeServerTransfer failed: ${transferRes.error}`);
    const tx = transferRes.transaction!;

    // Direct dispatch (simulating server.ts HTTP route immediate dispatch)
    const c2cEvents = buildTrustedTransferDispatchEvents(tx, false, {
      mode: 'MONVERA_C2C',
      authenticatedSenderUid: 'uid_sender',
      senderContact: { email: 'uid_sender@monvera.test', phone: '+14155550199' },
      recipientContact: { email: 'uid_recip@monvera.test', phone: '+14155550199' },
    });
    assert.strictEqual(c2cEvents.length, 2);
    for (const evt of c2cEvents) {
      assert.strictEqual(evt.eventKey, `${tx.id}:COMPLETED`);
      await dispatcher.dispatch(evt);
    }

    assert.strictEqual(counters.pushCalls, 2);
    assert.strictEqual(counters.smsCalls, 2);
    assert.strictEqual(counters.emailCalls, 2);

    // Worker subsequently processes the outbox records created atomically by executeServerTransfer
    const tick = await runNotificationOutboxWorkerTick({
      firestore: fsMem as unknown as Firestore,
      dispatcher,
      minCreatedAt: '2020-01-01T00:00:00.000Z',
      nowFn: () => Date.now() + 5_000,
    });
    assert.strictEqual(tick.dispatchedCount, 2);

    // Total sends MUST remain 2 (zero duplicate push/sms/email)!
    assert.strictEqual(counters.pushCalls, 2, 'No duplicate push after C2C direct+worker');
    assert.strictEqual(counters.smsCalls, 2, 'No duplicate SMS after C2C direct+worker');
    assert.strictEqual(counters.emailCalls, 2, 'No duplicate Email after C2C direct+worker');

    // Verify identical dispatch log IDs used for Admin Transfer too
    const adminEvents = buildTrustedTransferDispatchEvents(
      {
        ...tx,
        id: 'tx_admin_parity',
        senderUserId: 'admin_bennett',
        recipientUserId: 'uid_recip',
        metadata: { disbursementType: 'ADMINISTRATIVE_TRANSFER' },
      },
      false,
      { mode: 'ADMIN_TRANSFER' }
    );
    assert.strictEqual(adminEvents.length, 1);
    assert.strictEqual(adminEvents[0].eventKey, 'tx_admin_parity:COMPLETED');
    const outboxIdRecip = computeNotificationOutboxId(
      'uid_recip',
      `${tx.id}:COMPLETED`,
      'MONEY_RECEIVED'
    );
    const outboxRec = (await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(outboxIdRecip).get()).data();
    assert.strictEqual(
      computeDispatchLogId('uid_recip', resolveDispatchKey(c2cEvents[0])),
      computeDispatchLogId('uid_recip', resolveDispatchKey({
        transactionId: outboxRec!.transactionId,
        referenceNumber: outboxRec!.referenceNumber,
        eventKey: outboxRec!.eventKey,
        type: outboxRec!.dispatchType,
      }))
    );
    console.log('[PASS] 8. C2C & Admin transfer eventKey parity prevents duplicate direct+outbox sends');
  }

  // -------------------------------------------------------------------------
  // TEST 9: Cursor pagination advances past >1 page of skipped records (+ mid-page batch limit)
  // -------------------------------------------------------------------------
  restoreTestEnv();
  {
    configureTestProvidersEnv();
    process.env.NOTIFICATION_OUTBOX_MIN_CREATED_AT = '2026-04-10T00:00:00.000Z';
    process.env.NOTIFICATION_ALLOWLIST_UIDS = 'uid_eligible_pag';
    const fsMem = new StrictInMemoryFirestore();
    await seedCustomerForNotifications(fsMem, 'uid_eligible_pag');
    await seedCustomerForNotifications(fsMem, 'uid_blocked_pag');

    // Seed 6 historical / unapproved records sorting BEFORE 2 eligible records (pageSize = 2 -> >1 page skipped)
    for (let i = 1; i <= 6; i++) {
      await seedOutboxDoc(fsMem, {
        id: `skip_${i}`,
        userId: i % 2 === 0 ? 'uid_blocked_pag' : 'uid_eligible_pag',
        createdAt: i % 2 === 1 ? '2026-03-01T00:00:00.000Z' : '2026-04-11T00:00:00.000Z',
        nextAttemptAt: `2026-04-10T0${i}:00:00.000Z`,
      });
    }
    await seedOutboxDoc(fsMem, {
      id: 'elig_7',
      userId: 'uid_eligible_pag',
      createdAt: '2026-04-12T00:00:00.000Z',
      nextAttemptAt: '2026-04-10T07:00:00.000Z',
    });
    await seedOutboxDoc(fsMem, {
      id: 'elig_8',
      userId: 'uid_eligible_pag',
      createdAt: '2026-04-12T01:00:00.000Z',
      nextAttemptAt: '2026-04-10T08:00:00.000Z',
    });

    const { dispatcher, mockFetch } = createIsolatedDispatcherAndEnv(fsMem);
    globalThis.fetch = mockFetch as any;

    const worker = new NotificationOutboxWorker({
      firestore: fsMem as unknown as Firestore,
      dispatcher,
      pageSize: 2,
      maxPagesPerTick: 10,
      eligibleBatchLimit: 1, // Forces mid-page break between elig_7 and elig_8!
      checkpointId: 'ckpt_pag',
      nowFn: () => Date.parse('2026-04-15T00:00:00.000Z'),
    });

    const tick1 = await worker.runTick();
    assert.strictEqual(tick1.dispatchedCount, 1, 'Tick 1 advances past 3 skipped pages and processes elig_7');
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc('elig_7').get()).data()?.status, 'DISPATCHED');
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc('elig_8').get()).data()?.status, 'PENDING');

    const tick2 = await worker.runTick();
    assert.strictEqual(tick2.dispatchedCount, 1, 'Tick 2 resumes from mid-page break and processes elig_8');
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc('elig_8').get()).data()?.status, 'DISPATCHED');
    console.log('[PASS] 9. Cursor pagination advances past >1 page of skipped records and handles mid-page batch limits');
  }

  // -------------------------------------------------------------------------
  // TEST 10: Restart-safe durable cursor checkpointing prevents starvation across restarts
  // -------------------------------------------------------------------------
  restoreTestEnv();
  {
    configureTestProvidersEnv();
    process.env.NOTIFICATION_OUTBOX_MIN_CREATED_AT = '2026-04-10T00:00:00.000Z';
    process.env.NOTIFICATION_ALLOWLIST_UIDS = 'uid_restart';
    const fsMem = new StrictInMemoryFirestore();
    await seedCustomerForNotifications(fsMem, 'uid_restart');

    // 4 retried historical records filling page 1 and page 2 (pageSize = 2, maxPagesPerTick = 1)
    for (let i = 1; i <= 4; i++) {
      await seedOutboxDoc(fsMem, {
        id: `retried_hist_${i}`,
        userId: 'uid_restart',
        status: 'FAILED_RETRYABLE',
        attemptCount: 1,
        createdAt: '2026-03-01T00:00:00.000Z',
        nextAttemptAt: `2026-04-10T0${i}:00:00.000Z`,
      });
    }
    // 1 eligible record sitting at position 5
    await seedOutboxDoc(fsMem, {
      id: 'new_elig_5',
      userId: 'uid_restart',
      createdAt: '2026-04-12T00:00:00.000Z',
      nextAttemptAt: '2026-04-10T05:00:00.000Z',
    });

    const { dispatcher, counters, mockFetch } = createIsolatedDispatcherAndEnv(fsMem);
    globalThis.fetch = mockFetch as any;

    // Worker instance 1: only 1 page of size 2 per tick -> stops after skipping docs 1..2, saves durable checkpoint
    const workerBeforeRestart = new NotificationOutboxWorker({
      firestore: fsMem as unknown as Firestore,
      dispatcher,
      checkpointId: 'railway_restart_ckpt',
      pageSize: 2,
      maxPagesPerTick: 1,
      nowFn: () => Date.parse('2026-04-15T00:00:00.000Z'),
    });
    const t1 = await workerBeforeRestart.runTick();
    assert.strictEqual(t1.scannedRetryable, 2);
    assert.strictEqual(t1.skippedHistoricalOrInvalid, 2);
    assert.strictEqual(t1.dispatchedCount, 0);

    const savedCkpt = (
      await fsMem.collection(NOTIFICATION_OUTBOX_WORKER_STATE_COLLECTION).doc('railway_restart_ckpt').get()
    ).data();
    assert.strictEqual(savedCkpt?.retryableCursor?.docId, 'retried_hist_2');

    // Simulated Railway restart: brand-new NotificationOutboxWorker instance using same checkpointId
    const workerAfterRestart1 = new NotificationOutboxWorker({
      firestore: fsMem as unknown as Firestore,
      dispatcher,
      checkpointId: 'railway_restart_ckpt',
      pageSize: 2,
      maxPagesPerTick: 1,
      nowFn: () => Date.parse('2026-04-15T00:00:00.000Z'),
    });
    const t2 = await workerAfterRestart1.runTick();
    assert.strictEqual(t2.scannedRetryable, 2, 'Restarted worker must resume at docs 3..4, NOT 1..2');
    assert.strictEqual(t2.dispatchedCount, 0);

    // Another restart -> page 3 reaches new_elig_5 and processes it!
    const workerAfterRestart2 = new NotificationOutboxWorker({
      firestore: fsMem as unknown as Firestore,
      dispatcher,
      checkpointId: 'railway_restart_ckpt',
      pageSize: 2,
      maxPagesPerTick: 1,
      nowFn: () => Date.parse('2026-04-15T00:00:00.000Z'),
    });
    const t3 = await workerAfterRestart2.runTick();
    assert.strictEqual(t3.scannedRetryable, 1);
    assert.strictEqual(t3.dispatchedCount, 1);
    assert.strictEqual(t3.wrappedRetryableScan, true);
    assert.strictEqual(counters.pushCalls, 1);
    assert.strictEqual(
      (await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc('new_elig_5').get()).data()?.status,
      'DISPATCHED'
    );
    console.log('[PASS] 10. Restart-safe durable cursor checkpointing resumes after crash/restart without starvation');
  }

  // -------------------------------------------------------------------------
  // TEST 11: Concurrent tick overlap prevention on same worker instance
  // -------------------------------------------------------------------------
  restoreTestEnv();
  {
    configureTestProvidersEnv();
    process.env.NOTIFICATION_ALLOWLIST_UIDS = 'uid_overlap';
    const fsMem = new StrictInMemoryFirestore();
    await seedCustomerForNotifications(fsMem, 'uid_overlap');
    await seedOutboxDoc(fsMem, {
      id: 'overlap_doc',
      userId: 'uid_overlap',
      createdAt: '2026-04-10T00:00:00.000Z',
      nextAttemptAt: '2026-04-10T00:00:00.000Z',
    });

    const slowDispatcher = {
      dispatch: async () => {
        await new Promise((r) => setTimeout(r, 40));
        return {
          transactionId: 'tx_overlap',
          referenceNumber: 'REF-OVERLAP',
          push: { attempted: true, delivered: true, status: 'SENT' },
          sms: { success: true, delivered: false, status: 'SKIPPED' as const },
          email: { success: true, delivered: false, status: 'SKIPPED' as const },
        };
      },
    };

    const worker = new NotificationOutboxWorker({
      firestore: fsMem as unknown as Firestore,
      dispatcher: slowDispatcher,
      resolveCustomerContact: async () => ({}),
      checkpointId: 'ckpt_overlap',
      nowFn: () => Date.parse('2026-04-15T00:00:00.000Z'),
    });

    const [resA, resB] = await Promise.all([worker.runTick(), worker.runTick()]);
    const skipped = [resA, resB].filter((r) => !r.executed);
    const executed = [resA, resB].filter((r) => r.executed);
    assert.strictEqual(executed.length, 1);
    assert.strictEqual(skipped.length, 1);
    assert.strictEqual(skipped[0].skippedReason, 'TICK_ALREADY_IN_PROGRESS');

    // Chained timer start/stop lifecycle check
    const startedWorker = startNotificationOutboxWorker({
      firestore: fsMem as unknown as Firestore,
      dispatcher: slowDispatcher,
      pollIntervalMs: 60_000,
    });
    assert.ok(startedWorker && startedWorker.isRunning());
    assert.strictEqual(startedWorker.start(), false, 'Double-start must be rejected');
    stopNotificationOutboxWorker(startedWorker);
    assert.strictEqual(startedWorker.isRunning(), false);
    console.log('[PASS] 11. Concurrent tick overlap prevention & non-overlapping timer lifecycle');
  }

  // -------------------------------------------------------------------------
  // TEST 12: Concurrent workers racing on the same eligible record send once
  // -------------------------------------------------------------------------
  restoreTestEnv();
  {
    configureTestProvidersEnv();
    process.env.NOTIFICATION_ALLOWLIST_UIDS = 'uid_race';
    const fsMem = new StrictInMemoryFirestore();
    await seedCustomerForNotifications(fsMem, 'uid_race');
    await fsMem.collection('transactions').doc('tx_race_doc').set({
      id: 'tx_race_doc',
      type: 'DEPOSIT',
      status: 'COMPLETED',
      recipientUserId: 'uid_race',
    });
    await seedOutboxDoc(fsMem, {
      id: 'race_doc',
      userId: 'uid_race',
      dispatchType: 'MONEY_RECEIVED',
      createdAt: '2026-04-10T00:00:00.000Z',
      nextAttemptAt: '2026-04-10T00:00:00.000Z',
    });

    const { dispatcher, counters, mockFetch } = createIsolatedDispatcherAndEnv(fsMem);
    globalThis.fetch = mockFetch as any;

    const w1 = new NotificationOutboxWorker({
      firestore: fsMem as unknown as Firestore,
      dispatcher,
      workerId: 'worker_1',
      checkpointId: 'ckpt_race_1',
      nowFn: () => Date.parse('2026-04-15T00:00:00.000Z'),
    });
    const w2 = new NotificationOutboxWorker({
      firestore: fsMem as unknown as Firestore,
      dispatcher,
      workerId: 'worker_2',
      checkpointId: 'ckpt_race_2',
      nowFn: () => Date.parse('2026-04-15T00:00:00.000Z'),
    });

    const [t1, t2] = await Promise.all([w1.runTick(), w2.runTick()]);
    assert.strictEqual(t1.claimedCount + t2.claimedCount, 1, 'Only one concurrent worker may claim lease');
    assert.strictEqual(t1.dispatchedCount + t2.dispatchedCount, 1);
    assert.strictEqual(counters.pushCalls, 1);
    assert.strictEqual(counters.smsCalls, 1);
    assert.strictEqual(counters.emailCalls, 1);
    console.log('[PASS] 12. Concurrent workers racing on the same eligible record send exactly once');
  }

  // -------------------------------------------------------------------------
  // TEST 13: Lease loss mid-flight halts channel execution and increments leaseLostCount
  // -------------------------------------------------------------------------
  restoreTestEnv();
  {
    configureTestProvidersEnv();
    process.env.NOTIFICATION_ALLOWLIST_UIDS = 'uid_lease_loss';
    const fsMem = new StrictInMemoryFirestore();
    await seedCustomerForNotifications(fsMem, 'uid_lease_loss');
    await fsMem.collection('transactions').doc('tx_lease_loss_doc').set({
      id: 'tx_lease_loss_doc',
      type: 'DEPOSIT',
      status: 'COMPLETED',
      recipientUserId: 'uid_lease_loss',
    });
    await seedOutboxDoc(fsMem, {
      id: 'lease_loss_doc',
      userId: 'uid_lease_loss',
      dispatchType: 'MONEY_RECEIVED',
      createdAt: '2026-04-10T00:00:00.000Z',
      nextAttemptAt: '2026-04-10T00:00:00.000Z',
    });

    const { dispatcher, counters, mockFetch } = createIsolatedDispatcherAndEnv(fsMem);
    globalThis.fetch = mockFetch as any;

    // Intercept dispatch right after claim so Worker B steals/supersedes the lease before dispatcher writes log
    const wrappedDispatcher = {
      dispatch: async (evt: any, opts: any) => {
        const ref = fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc('lease_loss_doc');
        const cur = (await ref.get()).data()!;
        await ref.set({
          ...cur,
          leaseOwner: 'newer_worker',
          leaseToken: 'stolen_newer_lease_token',
          leaseExpiresAt: '2026-04-15T05:00:00.000Z',
        });
        return dispatcher.dispatch(evt, opts);
      },
    };

    const staleWorker = new NotificationOutboxWorker({
      firestore: fsMem as unknown as Firestore,
      dispatcher: wrappedDispatcher,
      workerId: 'stale_worker',
      checkpointId: 'ckpt_lease_loss',
      nowFn: () => Date.parse('2026-04-15T00:00:00.000Z'),
    });

    const tick = await staleWorker.runTick();
    assert.strictEqual(tick.leaseLostCount, 1);
    assert.strictEqual(tick.dispatchedCount, 0);
    // LEASE_LOST in dispatch log acquisition aborts BEFORE sending Push/SMS/Email!
    assert.strictEqual(counters.pushCalls, 0);
    assert.strictEqual(counters.smsCalls, 0);
    assert.strictEqual(counters.emailCalls, 0);
    const stored = (await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc('lease_loss_doc').get()).data();
    assert.strictEqual(stored?.leaseToken, 'stolen_newer_lease_token', 'Newer lease owner preserved');
    console.log('[PASS] 13. Lease loss mid-flight halts outbound channels and protects newer lease owner');
  }

  // -------------------------------------------------------------------------
  // TEST 14: Retryable failures follow exponential backoff + 10s AbortSignal.timeout
  // -------------------------------------------------------------------------
  restoreTestEnv();
  {
    configureTestProvidersEnv();
    process.env.NOTIFICATION_ALLOWLIST_UIDS = 'uid_retry';
    const fsMem = new StrictInMemoryFirestore();
    await seedCustomerForNotifications(fsMem, 'uid_retry');
    await fsMem.collection('transactions').doc('tx_retry_doc').set({
      id: 'tx_retry_doc',
      type: 'DEPOSIT',
      status: 'COMPLETED',
      recipientUserId: 'uid_retry',
    });
    await seedOutboxDoc(fsMem, {
      id: 'retry_doc',
      userId: 'uid_retry',
      dispatchType: 'MONEY_RECEIVED',
      maxAttempts: 5,
      createdAt: '2026-04-10T00:00:00.000Z',
      nextAttemptAt: '2026-04-10T00:00:00.000Z',
    });

    // Attempt 1: Push succeeds, Email succeeds, SMS fails via simulated timeout (check AbortSignal attached!)
    const env1 = createIsolatedDispatcherAndEnv(fsMem, { smsDelayOrFail: 'TIMEOUT' });
    globalThis.fetch = env1.mockFetch as any;

    const now1 = Date.parse('2026-04-15T00:00:00.000Z');
    const tick1 = await runNotificationOutboxWorkerTick({
      firestore: fsMem as unknown as Firestore,
      dispatcher: env1.dispatcher,
      checkpointId: 'ckpt_retry',
      nowFn: () => now1,
    });
    assert.strictEqual(tick1.retryScheduledCount, 1);
    assert.strictEqual(env1.counters.lastTimeoutSignalPresent, true, 'External fetch must carry AbortSignal.timeout');

    const afterAttempt1 = (await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc('retry_doc').get()).data()!;
    assert.strictEqual(afterAttempt1.status, 'FAILED_RETRYABLE');
    assert.strictEqual(afterAttempt1.pushStatus, 'SENT');
    assert.strictEqual(afterAttempt1.emailStatus, 'SENT');
    assert.strictEqual(afterAttempt1.smsStatus, 'FAILED_RETRYABLE');
    assert.strictEqual(
      Date.parse(afterAttempt1.nextAttemptAt),
      now1 + 30_000,
      'Attempt 1 backoff must be 30s'
    );

    // Before backoff elapses -> NOT claimed
    const tickEarly = await runNotificationOutboxWorkerTick({
      firestore: fsMem as unknown as Firestore,
      dispatcher: env1.dispatcher,
      checkpointId: 'ckpt_retry',
      nowFn: () => now1 + 10_000,
    });
    assert.strictEqual(tickEarly.claimedCount, 0);

    // Attempt 2 after backoff -> only SMS retried; Push & Email NOT resent!
    const env2 = createIsolatedDispatcherAndEnv(fsMem, { smsDelayOrFail: 'OK' });
    globalThis.fetch = env2.mockFetch as any;
    const tick2 = await runNotificationOutboxWorkerTick({
      firestore: fsMem as unknown as Firestore,
      dispatcher: env2.dispatcher,
      checkpointId: 'ckpt_retry',
      nowFn: () => now1 + 35_000,
    });
    assert.strictEqual(tick2.dispatchedCount, 1);
    assert.strictEqual(env2.counters.pushCalls, 0, 'Already SENT push must not resend on retry');
    assert.strictEqual(env2.counters.emailCalls, 0, 'Already SENT email must not resend on retry');
    assert.strictEqual(env2.counters.smsCalls, 1, 'Pending/retryable SMS must send on retry');
    console.log('[PASS] 14. Retryable failures use exponential backoff, AbortSignal.timeout, and never resend SENT channels');
  }

  // -------------------------------------------------------------------------
  // TEST 15: Exhausted records (retry exhaustion & expired lease exhaustion) settle to DEAD_LETTER
  // -------------------------------------------------------------------------
  restoreTestEnv();
  {
    configureTestProvidersEnv();
    process.env.NOTIFICATION_ALLOWLIST_UIDS = 'uid_dlq';
    const fsMem = new StrictInMemoryFirestore();
    await seedCustomerForNotifications(fsMem, 'uid_dlq');

    // Case A: Reaches maxAttempts=2 via failing attempts
    await seedOutboxDoc(fsMem, {
      id: 'dlq_fail_doc',
      userId: 'uid_dlq',
      dispatchType: 'TRANSACTION',
      attemptCount: 1,
      maxAttempts: 2,
      status: 'FAILED_RETRYABLE',
      createdAt: '2026-04-10T00:00:00.000Z',
      nextAttemptAt: '2026-04-10T00:00:00.000Z',
    });

    // Case B: Already exhausted expired PROCESSING lease (attemptCount === maxAttempts)
    await seedOutboxDoc(fsMem, {
      id: 'dlq_expired_doc',
      userId: 'uid_dlq',
      dispatchType: 'TRANSACTION',
      attemptCount: 2,
      maxAttempts: 2,
      status: 'PROCESSING',
      leaseOwner: 'crashed_worker',
      leaseToken: 'tok_crashed',
      leaseExpiresAt: '2026-04-12T00:00:00.000Z',
      createdAt: '2026-04-10T00:00:00.000Z',
      nextAttemptAt: '2026-04-10T00:00:00.000Z',
    });

    const { dispatcher, mockFetch } = createIsolatedDispatcherAndEnv(fsMem, { pushAlwaysFails: true });
    globalThis.fetch = mockFetch as any;

    const tick = await runNotificationOutboxWorkerTick({
      firestore: fsMem as unknown as Firestore,
      dispatcher,
      checkpointId: 'ckpt_dlq',
      nowFn: () => Date.parse('2026-04-15T00:00:00.000Z'),
    });
    assert.strictEqual(tick.deadLetteredCount, 2);

    const docA = (await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc('dlq_fail_doc').get()).data()!;
    const docB = (await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc('dlq_expired_doc').get()).data()!;
    assert.strictEqual(docA.status, 'DEAD_LETTER');
    assert.strictEqual(docB.status, 'DEAD_LETTER');
    console.log('[PASS] 15. Exhausted records settle cleanly to DEAD_LETTER');
  }

  // -------------------------------------------------------------------------
  // TEST 16: Financial transactions unchanged + Firebase Admin ADC guard + static safety checks
  // -------------------------------------------------------------------------
  restoreTestEnv();
  {
    process.env.DISABLE_OUTBOUND_NOTIFICATIONS = 'true';
    const fsMem = new StrictInMemoryFirestore();
    await seedCustomerForNotifications(fsMem, 'uid_fin_a', { checkingBalance: 1000, savingsBalance: 500 });
    await seedCustomerForNotifications(fsMem, 'uid_fin_b', { checkingBalance: 400, savingsBalance: 100 });

    const internalRes = await executeServerInternalTransfer(
      {
        userId: 'uid_fin_a',
        fromAccountType: 'CHECKING',
        toAccountType: 'SAVINGS',
        amount: 250,
        idempotencyKey: 'idem_fin_int_1',
      },
      {
        firestore: fsMem as unknown as Firestore,
        isAdminConfigured: () => true,
      }
    );
    assert.strictEqual(internalRes.success, true, `executeServerInternalTransfer failed: ${internalRes.error}`);
    assert.strictEqual(internalRes.balanceMetrics?.checkingBalance, 750);
    assert.strictEqual(internalRes.balanceMetrics?.savingsBalance, 750);

    const c2cRes = await executeServerTransfer(
      {
        senderUid: 'uid_fin_a',
        recipientIdentifier: 'uid_fin_b',
        recipientUserId: 'uid_fin_b',
        amount: 100,
        referenceNumber: 'MV-FIN-CHECK-1',
        description: 'Ledger preservation check',
      },
      {
        firestore: fsMem as unknown as Firestore,
        isAdminConfigured: () => true,
      }
    );
    assert.strictEqual(c2cRes.success, true, `executeServerTransfer failed: ${c2cRes.error}`);
    assert.strictEqual(c2cRes.senderBalanceMetrics?.checkingBalance, 650);
    assert.strictEqual(c2cRes.recipientBalanceMetrics?.checkingBalance, 500);

    // Outbox records created atomically by financial tx remain safely PENDING without dispatching
    const outboxCol = fsMem.store.get(NOTIFICATION_OUTBOX_COLLECTION);
    assert.ok(outboxCol && outboxCol.size >= 3);
    for (const entry of outboxCol.values()) {
      assert.strictEqual(entry.data.status, 'PENDING');
      assert.strictEqual(entry.data.attemptCount, 0);
    }

    // Subprocess verification of server/firebaseAdmin.ts local dev ADC fail-closed guard
    const adcBlockedOut = execFileSync(
      'npx',
      [
        'tsx',
        '-e',
        "import('./server/firebaseAdmin.ts').then(m => console.log('CONFIGURED=' + m.isFirebaseAdminConfigured()));",
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: 'development',
          RAILWAY_ENVIRONMENT: '',
          ALLOW_FIREBASE_ADC: '',
          FIREBASE_SERVICE_ACCOUNT_KEY: '',
          FIREBASE_SERVICE_ACCOUNT: '',
          FIREBASE_SERVICE_ACCOUNT_JSON: '',
          FIREBASE_CLIENT_EMAIL: '',
          FIREBASE_PRIVATE_KEY: '',
        },
        encoding: 'utf8',
      }
    );
    assert.ok(
      adcBlockedOut.includes('CONFIGURED=false'),
      `Local dev ADC must be blocked when ALLOW_FIREBASE_ADC is unset. Got: ${adcBlockedOut}`
    );

    // Static architecture & config preservation checks
    const serverSrc = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');
    assert.ok(
      serverSrc.includes("process.env.NOTIFICATION_WORKER_ENABLED === 'true'") &&
        serverSrc.includes("process.env.DISABLE_OUTBOUND_NOTIFICATIONS !== 'true'") &&
        serverSrc.includes('startNotificationOutboxWorker()'),
      'server.ts must gate startNotificationOutboxWorker behind Railway non-Vercel, WORKER_ENABLED, and kill-switch'
    );
    assert.ok(
      serverSrc.includes('areTransferParticipantsAllowlisted('),
      'server.ts must enforce two-account allowlist check on C2C direct dispatch'
    );

    console.log('[PASS] 16. Financial transactions unchanged, local dev ADC fail-closed verified, and server.ts worker wiring verified');
  }

  // -------------------------------------------------------------------------
  // TEST 17 (Stage 3D-C1.2 M-1): Direct-dispatch suppression when worker is enabled,
  //           legacy direct dispatch when disabled, concurrency safety, in-app & direct-only preservation
  // -------------------------------------------------------------------------
  restoreTestEnv();
  {
    configureTestProvidersEnv();
    process.env.NOTIFICATION_ALLOWLIST_UIDS = 'uid_m1_a,uid_m1_b';
    const fsMem = new StrictInMemoryFirestore();
    await seedCustomerForNotifications(fsMem, 'uid_m1_a', { checkingBalance: 5000 });
    await seedCustomerForNotifications(fsMem, 'uid_m1_b', { checkingBalance: 1000 });
    await seedCustomerForNotifications(fsMem, 'uid_m1_unapproved', { checkingBalance: 1000 });

    const { dispatcher, counters, mockFetch } = createIsolatedDispatcherAndEnv(fsMem);
    globalThis.fetch = mockFetch as any;

    // Import server.ts with VERCEL='1' so Express listen/timers never activate during test import
    process.env.VERCEL = '1';
    const { dispatchOutboxBackedTransferDirectIfWorkerDisabled } = await import('./server');
    delete process.env.VERCEL;

    const c2cSampleTx = {
      id: 'tx_m1_c2c_1',
      referenceNumber: 'MV-M1-C2C-1',
      type: 'TRANSFER',
      status: 'COMPLETED',
      amount: 125,
      currency: 'USD',
      senderUserId: 'uid_m1_a',
      senderName: 'User A',
      senderAccountNumber: '1000000101',
      recipientUserId: 'uid_m1_b',
      recipientName: 'User B',
      recipientAccountNumber: '1000000102',
    };
    const adminSampleTx = {
      id: 'tx_m1_adm_1',
      referenceNumber: 'MV-M1-ADM-1',
      type: 'TRANSFER',
      status: 'COMPLETED',
      amount: 300,
      currency: 'USD',
      senderUserId: 'admin_bennett',
      senderName: 'Bennett Johnson',
      senderAccountNumber: '1000000001',
      recipientUserId: 'uid_m1_b',
      recipientName: 'User B',
      recipientAccountNumber: '1000000102',
      metadata: { disbursementType: 'ADMINISTRATIVE_TRANSFER', adminSenderName: 'Bennett Johnson' },
    };

    // 17a. Worker DISABLED: direct dispatch runs for both C2C & Admin transfers
    process.env.NOTIFICATION_WORKER_ENABLED = 'false';
    let directCallCount = 0;
    const spyDispatcher = {
      dispatch: async () => {
        directCallCount++;
        return {
          transactionId: 'tx',
          referenceNumber: 'REF',
          push: { attempted: true, delivered: true, status: 'SENT' },
          sms: { success: true, delivered: true, status: 'SENT' as const },
          email: { success: true, delivered: true, status: 'SENT' as const },
        };
      },
    };
    const c2cWhenDisabled = await dispatchOutboxBackedTransferDirectIfWorkerDisabled(
      { mode: 'MONVERA_C2C', transaction: c2cSampleTx, isDuplicate: false, authenticatedSenderUid: 'uid_m1_a' },
      { isAdminConfigured: () => true, dispatcher: spyDispatcher as any, fetchContact: async () => ({ email: 'a@b.test', phone: '+14155550199' }) }
    );
    const adminWhenDisabled = await dispatchOutboxBackedTransferDirectIfWorkerDisabled(
      { mode: 'ADMIN_TRANSFER', transaction: adminSampleTx, isDuplicate: false },
      { isAdminConfigured: () => true, dispatcher: spyDispatcher as any, fetchContact: async () => ({ email: 'a@b.test', phone: '+14155550199' }) }
    );
    assert.strictEqual(c2cWhenDisabled.dispatched, true);
    assert.strictEqual(adminWhenDisabled.dispatched, true);
    assert.strictEqual(directCallCount, 3, '2 C2C events + 1 Admin event should directly dispatch when worker disabled');

    // 17b. Worker ENABLED: direct external dispatch is suppressed for BOTH C2C and Admin transfers
    process.env.NOTIFICATION_WORKER_ENABLED = 'true';
    directCallCount = 0;
    const c2cWhenEnabled = await dispatchOutboxBackedTransferDirectIfWorkerDisabled(
      { mode: 'MONVERA_C2C', transaction: c2cSampleTx, isDuplicate: false, authenticatedSenderUid: 'uid_m1_a' },
      { isAdminConfigured: () => true, dispatcher: spyDispatcher as any, fetchContact: async () => ({ email: 'a@b.test', phone: '+14155550199' }) }
    );
    const adminWhenEnabled = await dispatchOutboxBackedTransferDirectIfWorkerDisabled(
      { mode: 'ADMIN_TRANSFER', transaction: adminSampleTx, isDuplicate: false },
      { isAdminConfigured: () => true, dispatcher: spyDispatcher as any, fetchContact: async () => ({ email: 'a@b.test', phone: '+14155550199' }) }
    );
    assert.strictEqual(c2cWhenEnabled.dispatched, false);
    assert.strictEqual(c2cWhenEnabled.skippedReason, 'OUTBOX_WORKER_ACTIVE');
    assert.strictEqual(adminWhenEnabled.dispatched, false);
    assert.strictEqual(adminWhenEnabled.skippedReason, 'OUTBOX_WORKER_ACTIVE');
    assert.strictEqual(directCallCount, 0, 'Worker-enabled transfer routes must suppress redundant direct dispatch');

    // Verify server.ts routes actually invoke dispatchOutboxBackedTransferDirectIfWorkerDisabled
    const serverSrc = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');
    assert.ok(
      serverSrc.includes("mode: 'MONVERA_C2C'") &&
        serverSrc.includes("mode: 'ADMIN_TRANSFER'") &&
        serverSrc.includes('dispatchOutboxBackedTransferDirectIfWorkerDisabled(')
    );

    // 17c. Execute real C2C transfer -> outbox records written -> concurrent workers dispatch strictly once per channel
    const c2cExec = await executeServerTransfer(
      {
        senderUid: 'uid_m1_a',
        recipientIdentifier: 'uid_m1_b',
        recipientUserId: 'uid_m1_b',
        amount: 200,
        referenceNumber: 'MV-M1-CONCUR-1',
        description: 'Concurrent outbox worker ownership check',
      },
      { firestore: fsMem as unknown as Firestore, isAdminConfigured: () => true }
    );
    assert.strictEqual(c2cExec.success, true);

    const w1 = new NotificationOutboxWorker({
      firestore: fsMem as unknown as Firestore,
      dispatcher,
      workerId: 'm1_wrk_1',
      checkpointId: 'm1_ckpt_1',
      minCreatedAt: '2020-01-01T00:00:00.000Z',
      nowFn: () => Date.now() + 5_000,
    });
    const w2 = new NotificationOutboxWorker({
      firestore: fsMem as unknown as Firestore,
      dispatcher,
      workerId: 'm1_wrk_2',
      checkpointId: 'm1_ckpt_2',
      minCreatedAt: '2020-01-01T00:00:00.000Z',
      nowFn: () => Date.now() + 5_000,
    });
    const [tickA, tickB] = await Promise.all([w1.runTick(), w2.runTick()]);
    assert.strictEqual(tickA.dispatchedCount + tickB.dispatchedCount, 2, 'Exactly 2 C2C legs dispatched total');
    assert.strictEqual(counters.pushCalls, 2);
    assert.strictEqual(counters.smsCalls, 2);
    assert.strictEqual(counters.emailCalls, 2);

    // 17d. Defense-in-depth: DUPLICATE_IN_FLIGHT on dispatch_logs must also skip SMS & Email
    const inFlightKey = resolveDispatchKey({ transactionId: 'tx_inflight_1', referenceNumber: 'REF-IF', type: 'SECURITY' });
    const inFlightLogId = computeDispatchLogId('uid_m1_a', inFlightKey);
    await fsMem.collection('notification_dispatch_logs').doc(inFlightLogId).set({
      userId: 'uid_m1_a',
      dispatchKey: inFlightKey,
      pushStatus: 'CLAIMED',
      smsStatus: 'PENDING',
      emailStatus: 'PENDING',
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const beforeSms = counters.smsCalls;
    const beforeEmail = counters.emailCalls;
    const dupInFlightRes = await dispatcher.dispatch({
      transactionId: 'tx_inflight_1',
      referenceNumber: 'REF-IF',
      type: 'SECURITY',
      category: 'SECURITY',
      userId: 'uid_m1_a',
      recipientEmail: 'uid_m1_a@monvera.test',
      recipientPhone: '+14155550199',
      title: 'Security Check',
      body: 'Safe test',
    });
    assert.strictEqual(dupInFlightRes.push.status, 'DUPLICATE_IN_FLIGHT');
    assert.strictEqual(dupInFlightRes.sms.status, 'DUPLICATE_IGNORED');
    assert.strictEqual(dupInFlightRes.email.status, 'DUPLICATE_IGNORED');
    assert.strictEqual(counters.smsCalls, beforeSms, 'DUPLICATE_IN_FLIGHT must not fire SMS');
    assert.strictEqual(counters.emailCalls, beforeEmail, 'DUPLICATE_IN_FLIGHT must not fire Email');

    // 17e. Direct-only notifications & in-app persistence remain intact when worker is enabled
    let inAppPersistedCount = 0;
    const directOnlyDispatcher = new ServerNotificationDispatcher({
      firestore: fsMem as unknown as Firestore,
      messaging: (dispatcher as any).getMessaging(),
      isAdminConfigured: () => true,
      isMessagingConfigured: () => true,
      persistNotification: async (input) => {
        inAppPersistedCount++;
        await fsMem.collection('notifications').doc(input.id).set(input);
        return input as any;
      },
    });
    const pushBeforeDirectOnly = counters.pushCalls;
    await directOnlyDispatcher.dispatchNotification('uid_m1_a', {
      id: 'notif_kyc_direct_only_1',
      title: 'KYC Approved',
      message: 'Verified.',
      type: 'SECURITY',
      referenceId: 'uid_m1_a',
    });
    // Non-allowlisted direct-only still stores in-app notification, while external push/sms/email stay blocked!
    await directOnlyDispatcher.dispatchNotification('uid_m1_unapproved', {
      id: 'notif_kyc_direct_only_2',
      title: 'KYC Approved',
      message: 'Verified.',
      type: 'SECURITY',
      referenceId: 'uid_m1_unapproved',
    });
    assert.strictEqual(inAppPersistedCount, 2, 'In-app notifications must persist for all users');
    assert.strictEqual(counters.pushCalls, pushBeforeDirectOnly + 1, 'Direct-only external push runs ONLY for allowlisted UID');
    console.log('[PASS] 17. M-1 direct-dispatch suppression, concurrency parity, DUPLICATE_IN_FLIGHT SMS/Email guard, in-app & direct-only preserved');
  }

  // -------------------------------------------------------------------------
  // TEST 18 (Stage 3D-C1.2 M-2): Fail-closed allowlist (all 12 cases + direct parity + ledger unaffected)
  // -------------------------------------------------------------------------
  restoreTestEnv();
  {
    configureTestProvidersEnv();
    const fsMem = new StrictInMemoryFirestore();
    await seedCustomerForNotifications(fsMem, 'uid_m2_single');
    await seedCustomerForNotifications(fsMem, 'uid_m2_alpha', { checkingBalance: 2000 });
    await seedCustomerForNotifications(fsMem, 'uid_m2_beta', { checkingBalance: 1000 });
    await seedCustomerForNotifications(fsMem, 'uid_m2_outside', { checkingBalance: 1000 });

    const { dispatcher, counters, mockFetch } = createIsolatedDispatcherAndEnv(fsMem);
    globalThis.fetch = mockFetch as any;

    const seedFreshTxDoc = async (id: string, userId: string, extra?: Partial<NotificationOutboxRecord>) =>
      seedOutboxDoc(fsMem, {
        id,
        userId,
        dispatchType: 'TRANSACTION',
        createdAt: '2026-04-10T00:00:00.000Z',
        nextAttemptAt: '2026-04-10T00:00:00.000Z',
        ...extra,
      });

    // Cases 1-4: Missing, empty, whitespace-only, comma-only, and malformed allowlists fail closed
    await seedFreshTxDoc('m2_probe_doc', 'uid_m2_outside');
    const invalidConfigs: Array<{ raw: string | undefined; mode?: string; label: string }> = [
      { raw: undefined, label: '1. missing' },
      { raw: '', label: '2. empty' },
      { raw: '   \t\n ', label: '3. whitespace-only' },
      { raw: ',,, , ', label: '4a. comma-only' },
      { raw: 'uid bad,uid_m2_single', label: '4b. malformed whitespace UID' },
      { raw: 'uid_m2_alpha/bad', label: '4c. malformed slash UID' },
      { raw: undefined, mode: 'open', label: '4d. non-exact OPEN lowercase override' },
      { raw: ',,,', mode: 'true', label: '4e. comma-only with OPEN=true override' },
    ];
    for (const cfg of invalidConfigs) {
      if (cfg.raw === undefined) delete process.env.NOTIFICATION_ALLOWLIST_UIDS;
      else process.env.NOTIFICATION_ALLOWLIST_UIDS = cfg.raw;
      if (cfg.mode === undefined) delete process.env.NOTIFICATION_ALLOWLIST_MODE;
      else process.env.NOTIFICATION_ALLOWLIST_MODE = cfg.mode;

      assert.strictEqual(
        startNotificationOutboxWorker({ firestore: fsMem as unknown as Firestore, dispatcher }),
        null,
        `Worker startup must fail closed for allowlist case: ${cfg.label}`
      );
      const t = await runNotificationOutboxWorkerTick({
        firestore: fsMem as unknown as Firestore,
        dispatcher,
        nowFn: () => Date.parse('2026-04-15T00:00:00.000Z'),
      });
      assert.strictEqual(t.executed, false, `Tick must fail closed for ${cfg.label}`);
      assert.strictEqual(t.skippedReason, 'ALLOWLIST_REQUIRED_OR_INVALID', `Expected ALLOWLIST_REQUIRED_OR_INVALID for ${cfg.label}`);

      // Direct external dispatch must also fail closed when worker is enabled without valid allowlist
      const directFailClosed = await dispatcher.dispatch({
        transactionId: 'tx_direct_failclosed',
        referenceNumber: 'REF-DFC',
        type: 'SECURITY',
        category: 'SECURITY',
        userId: 'uid_m2_outside',
        recipientEmail: 'outside@monvera.test',
        recipientPhone: '+14155550199',
        title: 'Alert',
        body: 'Test',
      });
      assert.strictEqual(directFailClosed.push.status, 'SKIPPED_NOT_ALLOWLISTED', `Direct dispatch must fail closed for ${cfg.label}`);
    }
    const untouchedProbe = (await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc('m2_probe_doc').get()).data();
    assert.strictEqual(untouchedProbe?.status, 'PENDING');
    assert.strictEqual(untouchedProbe?.attemptCount, 0);
    assert.strictEqual(counters.pushCalls + counters.smsCalls + counters.emailCalls, 0);

    // Invalid notification config must NOT break financial ledger execution
    delete process.env.NOTIFICATION_ALLOWLIST_UIDS;
    delete process.env.NOTIFICATION_ALLOWLIST_MODE;
    const finWhileInvalid = await executeServerInternalTransfer(
      {
        userId: 'uid_m2_alpha',
        fromAccountType: 'CHECKING',
        toAccountType: 'SAVINGS',
        amount: 150,
        idempotencyKey: 'idem_m2_fin_unaffected',
      },
      { firestore: fsMem as unknown as Firestore, isAdminConfigured: () => true }
    );
    assert.strictEqual(finWhileInvalid.success, true, 'Financial transactions must remain unaffected by invalid notification allowlist');

    // Clean probe doc & test Case 5: One valid UID
    await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc('m2_probe_doc').delete();
    for (const entry of Array.from((fsMem.store.get(NOTIFICATION_OUTBOX_COLLECTION) || new Map()).keys())) {
      await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(entry).delete();
    }
    process.env.NOTIFICATION_ALLOWLIST_UIDS = 'uid_m2_single';
    await seedFreshTxDoc('m2_one_uid_ok', 'uid_m2_single');
    await seedFreshTxDoc('m2_one_uid_block', 'uid_m2_outside');
    const startedOne = startNotificationOutboxWorker({
      firestore: fsMem as unknown as Firestore,
      dispatcher,
      pollIntervalMs: 60_000,
    });
    assert.ok(startedOne && startedOne.isRunning(), 'Case 5: One valid UID must allow worker startup');
    stopNotificationOutboxWorker(startedOne);
    const tickOne = await runNotificationOutboxWorkerTick({
      firestore: fsMem as unknown as Firestore,
      dispatcher,
      checkpointId: 'm2_ckpt_one',
      nowFn: () => Date.parse('2026-04-15T00:00:00.000Z'),
    });
    assert.strictEqual(tickOne.dispatchedCount, 1);
    assert.strictEqual(tickOne.skippedNotAllowlisted, 1);

    // Case 6, 7, 10, 11, 12: Two valid UIDs, non-allowlisted UID, C2C partial & full pairs, Admin transfer distinction
    process.env.NOTIFICATION_ALLOWLIST_UIDS = 'uid_m2_alpha, uid_m2_beta';
    // Case 10: Sender allowed (alpha), recipient NOT allowed (outside)
    await fsMem.collection('transactions').doc('tx_m2_c2c_10').set({
      id: 'tx_m2_c2c_10',
      type: 'TRANSFER',
      status: 'COMPLETED',
      senderUserId: 'uid_m2_alpha',
      recipientUserId: 'uid_m2_outside',
      amount: 50,
      metadata: {},
    });
    await seedFreshTxDoc('m2_c2c10_s', 'uid_m2_alpha', { transactionId: 'tx_m2_c2c_10', dispatchType: 'MONEY_SENT' });
    await seedFreshTxDoc('m2_c2c10_r', 'uid_m2_outside', { transactionId: 'tx_m2_c2c_10', dispatchType: 'MONEY_RECEIVED' });

    // Case 11: Recipient allowed (beta), sender NOT allowed (outside)
    await fsMem.collection('transactions').doc('tx_m2_c2c_11').set({
      id: 'tx_m2_c2c_11',
      type: 'TRANSFER',
      status: 'COMPLETED',
      senderUserId: 'uid_m2_outside',
      recipientUserId: 'uid_m2_beta',
      amount: 60,
      metadata: {},
    });
    await seedFreshTxDoc('m2_c2c11_s', 'uid_m2_outside', { transactionId: 'tx_m2_c2c_11', dispatchType: 'MONEY_SENT' });
    await seedFreshTxDoc('m2_c2c11_r', 'uid_m2_beta', { transactionId: 'tx_m2_c2c_11', dispatchType: 'MONEY_RECEIVED' });

    // Case 10b: Missing authoritative transaction fails closed even if userId is allowlisted
    await seedFreshTxDoc('m2_c2c_missing_tx', 'uid_m2_alpha', { transactionId: 'tx_missing_authoritative', dispatchType: 'MONEY_SENT' });

    // Case 12: Both C2C participants allowed (alpha -> beta) + Admin transfer to beta
    await fsMem.collection('transactions').doc('tx_m2_c2c_12').set({
      id: 'tx_m2_c2c_12',
      type: 'TRANSFER',
      status: 'COMPLETED',
      senderUserId: 'uid_m2_alpha',
      recipientUserId: 'uid_m2_beta',
      amount: 70,
      metadata: {},
    });
    await seedFreshTxDoc('m2_c2c12_s', 'uid_m2_alpha', { transactionId: 'tx_m2_c2c_12', dispatchType: 'MONEY_SENT' });
    await seedFreshTxDoc('m2_c2c12_r', 'uid_m2_beta', { transactionId: 'tx_m2_c2c_12', dispatchType: 'MONEY_RECEIVED' });

    await fsMem.collection('transactions').doc('tx_m2_adm_ok').set({
      id: 'tx_m2_adm_ok',
      type: 'TRANSFER',
      status: 'COMPLETED',
      senderUserId: 'admin_bennett',
      recipientUserId: 'uid_m2_beta',
      amount: 80,
      metadata: { disbursementType: 'ADMINISTRATIVE_TRANSFER' },
    });
    await seedFreshTxDoc('m2_adm_ok', 'uid_m2_beta', { transactionId: 'tx_m2_adm_ok', dispatchType: 'MONEY_RECEIVED' });

    const tickTwo = await runNotificationOutboxWorkerTick({
      firestore: fsMem as unknown as Firestore,
      dispatcher,
      checkpointId: 'm2_ckpt_two',
      nowFn: () => Date.parse('2026-04-15T00:00:00.000Z'),
    });
    assert.strictEqual(tickTwo.dispatchedCount, 3, '2 dual-allowlisted C2C legs + 1 Admin transfer leg dispatched');
    assert.strictEqual(tickTwo.skippedNotAllowlisted, 6, '1 outside + 4 mixed C2C + 1 missing tx rejected');
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc('m2_c2c10_s').get()).data()?.status, 'PENDING');
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc('m2_c2c11_r').get()).data()?.status, 'PENDING');
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc('m2_c2c_missing_tx').get()).data()?.status, 'PENDING');
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc('m2_c2c12_s').get()).data()?.status, 'DISPATCHED');
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc('m2_c2c12_r').get()).data()?.status, 'DISPATCHED');
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc('m2_adm_ok').get()).data()?.status, 'DISPATCHED');

    // Case 8 & Case 9: Explicit NOTIFICATION_ALLOWLIST_MODE=OPEN (including combined with invalid/comma-only allowlist)
    delete process.env.NOTIFICATION_ALLOWLIST_UIDS;
    process.env.NOTIFICATION_ALLOWLIST_MODE = 'OPEN';
    const tickOpen = await runNotificationOutboxWorkerTick({
      firestore: fsMem as unknown as Firestore,
      dispatcher,
      checkpointId: 'm2_ckpt_open',
      nowFn: () => Date.parse('2026-04-15T00:00:00.000Z'),
    });
    assert.strictEqual(tickOpen.executed, true, 'Case 8: Explicit OPEN override activates unrestricted mode');
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc('m2_one_uid_block').get()).data()?.status, 'DISPATCHED');

    process.env.NOTIFICATION_ALLOWLIST_UIDS = ',,, , ';
    process.env.NOTIFICATION_ALLOWLIST_MODE = 'OPEN';
    await seedFreshTxDoc('m2_open_plus_invalid', 'uid_m2_outside');
    const tickOpenWithInvalidRaw = await runNotificationOutboxWorkerTick({
      firestore: fsMem as unknown as Firestore,
      dispatcher,
      checkpointId: 'm2_ckpt_open_inv',
      nowFn: () => Date.parse('2026-04-15T00:00:00.000Z'),
    });
    assert.strictEqual(tickOpenWithInvalidRaw.executed, true, 'Case 9: Explicit OPEN override still permits unrestricted mode');
    assert.strictEqual(
      (await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc('m2_open_plus_invalid').get()).data()?.status,
      'DISPATCHED'
    );
    console.log('[PASS] 18. M-2 Fail-closed allowlist verified across all 12 cases, C2C parity, direct dispatch enforcement, and ledger safety');
  }

  // -------------------------------------------------------------------------
  // TEST 19 (Stage 3D-C1.2 L-1): Transient checkpoint read error preserves persisted checkpoint & retries cleanly
  // -------------------------------------------------------------------------
  restoreTestEnv();
  {
    configureTestProvidersEnv();
    process.env.NOTIFICATION_OUTBOX_MIN_CREATED_AT = '2026-04-10T00:00:00.000Z';
    process.env.NOTIFICATION_ALLOWLIST_UIDS = 'uid_l1_user';
    const fsMem = new StrictInMemoryFirestore();
    await seedCustomerForNotifications(fsMem, 'uid_l1_user');

    // Seed 4 historical records + 1 eligible record at position 5
    for (let i = 1; i <= 4; i++) {
      await seedOutboxDoc(fsMem, {
        id: `l1_hist_${i}`,
        userId: 'uid_l1_user',
        status: 'FAILED_RETRYABLE',
        attemptCount: 1,
        createdAt: '2026-03-01T00:00:00.000Z',
        nextAttemptAt: `2026-04-10T0${i}:00:00.000Z`,
      });
    }
    await seedOutboxDoc(fsMem, {
      id: 'l1_elig_5',
      userId: 'uid_l1_user',
      createdAt: '2026-04-12T00:00:00.000Z',
      nextAttemptAt: '2026-04-10T05:00:00.000Z',
    });

    const { dispatcher, counters, mockFetch } = createIsolatedDispatcherAndEnv(fsMem);
    globalThis.fetch = mockFetch as any;

    // Step 1: Initial worker scans page 1 (2 docs), saves durable checkpoint at l1_hist_2
    const worker1 = new NotificationOutboxWorker({
      firestore: fsMem as unknown as Firestore,
      dispatcher,
      checkpointId: 'l1_ckpt',
      pageSize: 2,
      maxPagesPerTick: 1,
      nowFn: () => Date.parse('2026-04-15T00:00:00.000Z'),
    });
    const w1Tick = await worker1.runTick();
    assert.strictEqual(w1Tick.scannedRetryable, 2);
    assert.strictEqual(w1Tick.skippedHistoricalOrInvalid, 2);
    const persistedAfterW1 = (
      await fsMem.collection(NOTIFICATION_OUTBOX_WORKER_STATE_COLLECTION).doc('l1_ckpt').get()
    ).data();
    assert.strictEqual(persistedAfterW1?.retryableCursor?.docId, 'l1_hist_2');

    // Step 2: Simulate restart with a transient Firestore read error on the FIRST checkpoint read
    let failCheckpointReadOnce = true;
    const flakyFs = {
      collection(name: string) {
        const realCol = fsMem.collection(name);
        if (name !== NOTIFICATION_OUTBOX_WORKER_STATE_COLLECTION) {
          return realCol;
        }
        return {
          doc(docId: string) {
            const realDoc = realCol.doc(docId);
            return {
              id: realDoc.id,
              path: realDoc.path,
              get: async () => {
                if (failCheckpointReadOnce) {
                  failCheckpointReadOnce = false;
                  throw new Error('SIMULATED_TRANSIENT_CHECKPOINT_READ_ERROR');
                }
                return realDoc.get();
              },
              set: (data: any, opts?: any) => realDoc.set(data, opts),
              delete: () => realDoc.delete(),
            };
          },
        };
      },
      runTransaction: (fn: any) => fsMem.runTransaction(fn),
    } as unknown as Firestore;

    const workerAfterRestart = new NotificationOutboxWorker({
      firestore: flakyFs,
      dispatcher,
      checkpointId: 'l1_ckpt',
      pageSize: 2,
      maxPagesPerTick: 1,
      nowFn: () => Date.parse('2026-04-15T00:00:00.000Z'),
    });

    // Tick 1 hits transient read error -> must skip cleanly WITHOUT overwriting persisted checkpoint
    const failedLoadTick = await workerAfterRestart.runTick();
    assert.strictEqual(failedLoadTick.executed, false);
    assert.strictEqual(failedLoadTick.skippedReason, 'CHECKPOINT_LOAD_FAILED');
    const persistedAfterFail = (
      await fsMem.collection(NOTIFICATION_OUTBOX_WORKER_STATE_COLLECTION).doc('l1_ckpt').get()
    ).data();
    assert.strictEqual(
      persistedAfterFail?.retryableCursor?.docId,
      'l1_hist_2',
      'Transient checkpoint read failure must NOT overwrite persisted checkpoint'
    );

    // Tick 2 on SAME worker instance retries loadCheckpointsIfNeeded -> resumes cleanly at docs 3..4
    const retryTick = await workerAfterRestart.runTick();
    assert.strictEqual(retryTick.executed, true);
    assert.strictEqual(retryTick.scannedRetryable, 2, 'Must resume from saved l1_hist_2 (docs 3..4), NOT docs 1..2');
    assert.strictEqual(retryTick.dispatchedCount, 0);

    // Tick 3 advances to l1_elig_5 and dispatches it
    const finalTick = await workerAfterRestart.runTick();
    assert.strictEqual(finalTick.executed, true);
    assert.strictEqual(finalTick.scannedRetryable, 1);
    assert.strictEqual(finalTick.dispatchedCount, 1);
    assert.strictEqual(finalTick.wrappedRetryableScan, true);
    assert.strictEqual(counters.pushCalls, 1);
    assert.strictEqual(
      (await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc('l1_elig_5').get()).data()?.status,
      'DISPATCHED'
    );
    for (let i = 1; i <= 4; i++) {
      const h = (await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(`l1_hist_${i}`).get()).data();
      assert.strictEqual(h?.status, 'FAILED_RETRYABLE');
      assert.strictEqual(h?.attemptCount, 1);
    }
    console.log('[PASS] 19. L-1 Transient checkpoint read failure preserves checkpoint, retries cleanly, and resumes anti-starvation progress');
  }

  // -------------------------------------------------------------------------
  // TEST 20 (Admin Test Outbox SYSTEM Event): Worker Compatibility, Single FCM, & Dispatch-Log Idempotency
  // -------------------------------------------------------------------------
  restoreTestEnv();
  {
    // Temporarily prevent server.ts auto-listen during import, then clear VERCEL before running worker ticks
    process.env.VERCEL = '1';
    const { handleAdminTestOutboxNotification } = await import('./server');
    configureTestProvidersEnv();

    process.env.ADMIN_UIDS = 'uid_admin_ops';
    process.env.ADMIN_EMAILS = 'ops.admin@monvera.test';
    process.env.ADMIN_PASSWORD = 'Stage3dB2AdminTestSecret!2026';
    process.env.NOTIFICATION_OUTBOX_MIN_CREATED_AT = '2026-04-10T00:00:00.000Z';
    process.env.NOTIFICATION_ALLOWLIST_UIDS = 'uid_systest_1,uid_systest_2';

    const adminSession = createAdminSessionToken('uid_admin_ops', 'ops.admin@monvera.test')!;
    const fsMem = new StrictInMemoryFirestore();
    await seedCustomerForNotifications(fsMem, 'uid_systest_1', {
      checkingBalance: 2500,
      savingsBalance: 1000,
      withToken: true,
    });
    assert.strictEqual((await fsMem.collection('transactions').get()).size, 0, 'No transactions doc required');

    const enqueueNowMs = Date.parse('2026-04-15T10:00:00.000Z');
    const mockRes: any = {
      statusCode: 200,
      body: undefined as any,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: any) {
        this.body = payload;
        return this;
      },
    };

    await handleAdminTestOutboxNotification(
      {
        auth: { uid: 'uid_admin_ops', email: 'ops.admin@monvera.test', email_verified: true },
        headers: { 'x-admin-session': adminSession },
        body: { targetUserId: 'uid_systest_1', idempotencyKey: 'worker-smoke-01' },
      } as any,
      mockRes,
      {
        firestore: fsMem as any,
        isFirebaseAdminConfiguredFn: () => true,
        nowFn: () => enqueueNowMs,
      }
    );

    assert.strictEqual(mockRes.statusCode, 200);
    assert.strictEqual(mockRes.body.success, true);
    assert.strictEqual(mockRes.body.isDuplicate, false);
    const outboxId: string = mockRes.body.outboxId;
    assert.strictEqual((await fsMem.collection('transactions').get()).size, 0);

    // Run existing NotificationOutboxWorker tick with mocked FCM
    const { dispatcher, counters, mockFetch } = createIsolatedDispatcherAndEnv(fsMem);
    globalThis.fetch = mockFetch as any;

    const tick1 = await runNotificationOutboxWorkerTick({
      firestore: fsMem as unknown as Firestore,
      dispatcher,
      checkpointId: 'systest_ckpt',
      nowFn: () => Date.parse('2026-04-15T10:01:00.000Z'),
    });

    assert.strictEqual(tick1.executed, true);
    assert.strictEqual(tick1.claimedCount, 1);
    assert.strictEqual(tick1.dispatchedCount, 1);
    assert.strictEqual(counters.pushCalls, 1, 'Mocked FCM must be called once for verified token');
    assert.strictEqual(counters.smsCalls, 0);
    assert.strictEqual(counters.emailCalls, 0);

    const outboxAfter = (await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(outboxId).get()).data()!;
    assert.strictEqual(outboxAfter.status, 'DISPATCHED');
    assert.strictEqual(outboxAfter.pushStatus, 'SENT');
    assert.strictEqual(outboxAfter.smsStatus, 'UNCONFIGURED_PROVIDER');
    assert.strictEqual(outboxAfter.emailStatus, 'UNCONFIGURED_PROVIDER');
    assert.strictEqual(outboxAfter.failureClassification, 'NONE');

    const dispatchKey = resolveDispatchKey({
      transactionId: outboxAfter.transactionId,
      referenceNumber: outboxAfter.referenceNumber,
      eventKey: outboxAfter.eventKey,
      type: outboxAfter.dispatchType,
    });
    const dispatchLog = (
      await fsMem
        .collection('notification_dispatch_logs')
        .doc(computeDispatchLogId('uid_systest_1', dispatchKey))
        .get()
    ).data()!;
    assert.strictEqual(dispatchLog.pushStatus, 'SENT');

    // Duplicate admin submission after DISPATCHED preserves DISPATCHED record untouched & does not trigger extra send
    const dupRes: any = {
      statusCode: 200,
      body: undefined as any,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: any) {
        this.body = payload;
        return this;
      },
    };
    await handleAdminTestOutboxNotification(
      {
        auth: { uid: 'uid_admin_ops', email: 'ops.admin@monvera.test', email_verified: true },
        headers: { 'x-admin-session': adminSession },
        body: { targetUserId: 'uid_systest_1', idempotencyKey: 'worker-smoke-01' },
      } as any,
      dupRes,
      {
        firestore: fsMem as any,
        isFirebaseAdminConfiguredFn: () => true,
        nowFn: () => enqueueNowMs + 120_000,
      }
    );
    assert.strictEqual(dupRes.statusCode, 200);
    assert.strictEqual(dupRes.body.isDuplicate, true);
    assert.strictEqual(
      (await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(outboxId).get()).data()?.status,
      'DISPATCHED'
    );

    // Second worker tick and direct dispatcher replay must NOT invoke FCM again
    const tick2 = await runNotificationOutboxWorkerTick({
      firestore: fsMem as unknown as Firestore,
      dispatcher,
      checkpointId: 'systest_ckpt',
      nowFn: () => Date.parse('2026-04-15T10:02:00.000Z'),
    });
    assert.strictEqual(tick2.claimedCount, 0);

    const replayRes = await dispatcher.dispatch({
      transactionId: outboxAfter.transactionId,
      referenceNumber: outboxAfter.referenceNumber,
      eventKey: outboxAfter.eventKey,
      type: 'SYSTEM',
      category: 'SYSTEM',
      userId: 'uid_systest_1',
      title: outboxAfter.payload.title,
      body: outboxAfter.payload.body,
      actionUrl: outboxAfter.payload.actionUrl,
    });
    assert.strictEqual(replayRes.push.status, 'DUPLICATE_IGNORED');
    assert.strictEqual(counters.pushCalls, 1, 'Dispatch-log idempotency must block duplicate FCM delivery');

    console.log('[PASS] 20. Admin test-outbox SYSTEM event processed by existing worker once with zero transactions doc and terminal DISPATCHED');
  }

  restoreTestEnv();
  console.log('\nALL STAGE 3D-C1 / 3D-C1.2 DURABLE OUTBOX WORKER TESTS PASSED (20/20) — ZERO LIVE FIREBASE WRITES OR OUTBOUND SENDS.');
}

runTests().catch((err) => {
  restoreTestEnv();
  console.error('[Stage 3D-C1 / 3D-C1.2 Test Failure]', err);
  process.exit(1);
});
