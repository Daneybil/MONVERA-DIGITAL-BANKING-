/**
 * MONVERA — STAGE 3D-A / 3D-A3: DURABLE NOTIFICATION OUTBOX VERIFICATION SUITE
 *
 * Covers all 14 original Stage 3D-A scenarios PLUS all Stage 3D-A3 regression checks:
 *  1-4.  Deterministic SHA-256 outbox IDs, user isolation, lifecycle separation, unmodified transactionId.
 *  5.    Explicit eventKey behavior & legacy resolveDispatchKey backward compatibility.
 *  6-8.  Per-channel persistent status prevents SMS/Email resends across fresh worker restarts.
 *  9-10. DUPLICATE_IGNORED requires persistent confirmation; NO_ACTIVE_TOKENS/DISABLED_BY_USER terminal.
 * 11-12.Lease-token mismatch fencing & expired lease recovery blocking stale workers.
 * 13.   Sensitive payload rejection & UNCONFIGURED_PROVIDER vs permanent invalid payloads.
 * 14.   Backend-only Firestore security rules, composite indexes & outbox query builders.
 * 15.   [3D-A3 A] Strict Firestore read-before-write transaction harness: 2+ outbox records (C2C
 *       MONEY_SENT + MONEY_RECEIVED) in one atomic tx, read-after-write guard, duplicate non-overwrite,
 *       and non-throwing invalid payload preparation.
 * 16.   [3D-A3 B/E] SMS & Email UNCONFIGURED_PROVIDER does NOT poison sentCache, recovers when env
 *       configured, preserves sent dedupe, and isolates lifecycle eventKeys sharing one referenceNumber.
 * 17.   [3D-A3 C] LEASE_LOST aborts SMS/Email immediately, stale workers fenced from channel persistence,
 *       outbox/dispatch_log disagreement prevents resends, persistence errors not swallowed.
 * 18.   [3D-A3 D/E] FAILED_RETRYABLE blocked before nextAttemptAt, maxAttempts blocks re-claims,
 *       concurrent lease contention safe, explicit best-effort vs required channel policy, DEAD_LETTER immutable.
 *
 * Sends ZERO real SMS, email, or push notifications (network fetch & FCM mocked cleanly).
 */
import assert from 'assert';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import type { Messaging } from 'firebase-admin/messaging';

import {
  ServerNotificationDispatcher,
  buildTransactionLifecycleEventKey,
  computeDispatchLogId,
  registerCustomerPushToken,
  resolveDispatchKey,
} from './server/services/notificationDispatcher';
import {
  ALLOWED_OUTBOX_TRANSITIONS,
  DEFAULT_OUTBOX_CHANNEL_POLICY,
  NOTIFICATION_OUTBOX_COLLECTION,
  OUTBOX_TERMINAL_STATES,
  buildDispatchEventFromOutboxRecord,
  buildExpiredProcessingOutboxQuery,
  buildNotificationOutboxRecord,
  buildOutboxDispatchOptions,
  buildRetryableOutboxQuery,
  claimOutboxLease,
  computeNotificationOutboxId,
  evaluateOutboxAttemptOutcome,
  fetchDispatchLogForOutboxRecord,
  getUnfinishedOutboxChannels,
  isValidOutboxTransition,
  prepareNotificationOutboxBatch,
  prepareNotificationOutboxRecord,
  sanitizeAndValidateOutboxPayload,
  settleExhaustedOutboxRecord,
  transitionOutboxAsLeaseOwner,
  writePreparedNotificationOutboxBatchInTransaction,
} from './server/services/notificationOutbox';
import { smsService } from './server/services/smsService';
import { emailService } from './server/services/emailService';
import { db as inMemoryDb } from './server/db';
import {
  executeServerAdminTransfer,
  executeServerCardIssuance,
  executeServerDeposit,
  executeServerInvestmentCreation,
  executeServerInvestmentMaturity,
  executeServerLoanDisbursement,
  executeServerLoanRepayment,
  executeServerTransfer,
  executeServerWithdrawal,
  reverseServerFirestoreWithdrawal,
} from './server/firestoreTransactions';
import {
  executeServerWireCheckWithdrawal,
  markWireCheckRequestDeliveredAdmin,
} from './server/wireCheckService';
import { executeServerAdminCheckWithdrawal } from './server/adminCheckService';
import { evaluateAndProcessWelcomeReward } from './server/welcomeRewardService';

// ---------------------------------------------------------------------------
// Strict Firestore-Faithful In-Memory Harness
// - Enforces ALL reads (tx.get) MUST precede ALL writes (tx.set/create/delete)
// - Buffers transaction mutations and commits atomically on callback completion
// - Enforces optimistic version checks on read keys to catch concurrent races
// - Supports .where(), .orderBy(), .limit() for index query verification
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

type QueryFilter = { field: string; op: '==' | 'in' | '<='; value: any };
type QueryOrder = { field: string; dir: 'asc' | 'desc' };

class InMemoryQuery {
  constructor(
    protected store: DocStore,
    public readonly colPath: string,
    protected filters: QueryFilter[] = [],
    protected orders: QueryOrder[] = [],
    protected limitVal?: number
  ) {}

  where(field: string, op: '==' | 'in' | '<=', value: any): InMemoryQuery {
    return new InMemoryQuery(
      this.store,
      this.colPath,
      [...this.filters, { field, op, value }],
      this.orders,
      this.limitVal
    );
  }

  orderBy(field: string, dir: 'asc' | 'desc' = 'asc'): InMemoryQuery {
    return new InMemoryQuery(
      this.store,
      this.colPath,
      this.filters,
      [...this.orders, { field, dir }],
      this.limitVal
    );
  }

  limit(n: number): InMemoryQuery {
    return new InMemoryQuery(this.store, this.colPath, this.filters, this.orders, n);
  }

  async get() {
    const col = this.store.get(this.colPath) || new Map();
    let entries = Array.from(col.entries()).filter(([, entry]) => {
      return this.filters.every((f) => {
        const val = entry.data[f.field];
        if (f.op === '==') return val === f.value;
        if (f.op === 'in') return Array.isArray(f.value) && f.value.includes(val);
        if (f.op === '<=') return typeof val === 'string' && typeof f.value === 'string' && val <= f.value;
        return false;
      });
    });

    for (const o of this.orders) {
      entries = entries.sort((a, b) => {
        const va = String(a[1].data[o.field] ?? '');
        const vb = String(b[1].data[o.field] ?? '');
        return o.dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      });
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

  doc(id: string): InMemoryDocRef {
    return new InMemoryDocRef(this.store, `${this.colPath}/${id}`);
  }
}

class StrictInMemoryFirestore {
  public readonly store: DocStore = new Map();
  public failNextTransactionWrite = false;
  public onBeforeCommitConflictOnce: (() => Promise<void> | void) | null = null;
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
        get: async (refOrQuery: InMemoryDocRef | InMemoryQuery) => {
          if (hasWritten) {
            throw new Error('Firestore transactions require all reads to be executed before all writes.');
          }
          if (refOrQuery instanceof InMemoryQuery) {
            const snap = await refOrQuery.get();
            for (const d of snap.docs) {
              const entry = d.ref.readRawEntry();
              if (!readVersions.has(d.ref.path)) {
                readVersions.set(d.ref.path, entry?.version ?? 0);
              }
            }
            return snap;
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

      if (this.onBeforeCommitConflictOnce) {
        const hook = this.onBeforeCommitConflictOnce;
        this.onBeforeCommitConflictOnce = null;
        await hook();
      }

      if (this.failNextTransactionWrite && pendingOps.length > 0) {
        this.failNextTransactionWrite = false;
        throw new Error('SIMULATED_FIRESTORE_COMMIT_FAILURE');
      }

      // Optimistic concurrency validation at commit time (if any read doc changed concurrently, abort & retry)
      let conflictedPath: string | null = null;
      for (const [docPath, expectedVersion] of readVersions.entries()) {
        const idx = docPath.lastIndexOf('/');
        const colPath = docPath.slice(0, idx);
        const docId = docPath.slice(idx + 1);
        const currentVersion = this.store.get(colPath)?.get(docId)?.version ?? 0;
        if (currentVersion !== expectedVersion) {
          conflictedPath = docPath;
          break;
        }
      }

      if (conflictedPath) {
        if (attempt < maxAttempts) {
          continue;
        }
        throw new Error(`ABORTED: Concurrent transaction conflict on ${conflictedPath}`);
      }

      // Apply all buffered writes atomically
      for (const op of pendingOps) {
        if (op.type === 'delete') {
          await op.ref.delete();
        } else {
          await op.ref.set(op.data, { merge: op.merge });
        }
      }

      return result;
    }

    throw new Error('ABORTED: Exhausted transaction retry attempts');
  }
}

async function runTests() {
  console.log('=== MONVERA STAGE 3D-A / 3D-A3: DURABLE OUTBOX VERIFICATION SUITE ===\n');

  // -------------------------------------------------------------------------
  // TEST 1, 2, 3 & 4: Deterministic outbox IDs, user isolation, lifecycle separation,
  // unmodified original transactionId & strict read-before-write batching
  // -------------------------------------------------------------------------
  {
    const txId = 'tx_ledger_orig_12345';
    const refNo = 'MV-TRF-2026-12345';
    const keyInitiated = buildTransactionLifecycleEventKey(txId, 'INITIATED');
    const keyReversed = buildTransactionLifecycleEventKey(txId, 'REVERSED');
    const keySubmitted = buildTransactionLifecycleEventKey(txId, 'SUBMITTED');
    const keyDelivered = buildTransactionLifecycleEventKey(txId, 'DELIVERED');

    const expectedHash = crypto
      .createHash('sha256')
      .update(`uid_alice::${keyInitiated}::MONEY_SENT`)
      .digest('hex');
    const computedA1 = computeNotificationOutboxId('uid_alice', keyInitiated, 'MONEY_SENT');
    const computedA2 = computeNotificationOutboxId('uid_alice', keyInitiated, 'MONEY_SENT');
    assert.strictEqual(computedA1, expectedHash);
    assert.strictEqual(computedA1, computedA2);

    const computedBob = computeNotificationOutboxId('uid_bob', keyInitiated, 'MONEY_SENT');
    assert.notStrictEqual(computedA1, computedBob);

    const stageIds = new Set([
      computeNotificationOutboxId('uid_alice', keyInitiated, 'TRANSACTION'),
      computeNotificationOutboxId('uid_alice', keyReversed, 'TRANSACTION'),
      computeNotificationOutboxId('uid_alice', keySubmitted, 'TRANSACTION'),
      computeNotificationOutboxId('uid_alice', keyDelivered, 'TRANSACTION'),
    ]);
    assert.strictEqual(stageIds.size, 4);

    const fsMem = new StrictInMemoryFirestore();
    await (fsMem as unknown as Firestore).runTransaction(async (tx) => {
      const prepared = await prepareNotificationOutboxBatch(tx, fsMem as unknown as Firestore, [
        {
          userId: 'uid_alice',
          transactionId: txId,
          referenceNumber: refNo,
          eventKey: keySubmitted,
          lifecycleStage: 'SUBMITTED',
          dispatchType: 'TRANSACTION',
          payload: {
            title: 'Wire Check Submitted',
            body: 'Your request is submitted.',
            amount: 500,
            currency: 'USD',
            accountMasked: 'MVB •••• 7391',
          },
        },
        // In-batch duplicate with same deterministic key must dedupe cleanly
        {
          userId: 'uid_alice',
          transactionId: txId,
          referenceNumber: refNo,
          eventKey: keySubmitted,
          lifecycleStage: 'SUBMITTED',
          dispatchType: 'TRANSACTION',
          payload: {
            title: 'Wire Check Submitted',
            body: 'Duplicate in same tx.',
            amount: 500,
            currency: 'USD',
          },
        },
      ]);

      const written = writePreparedNotificationOutboxBatchInTransaction(tx, prepared);
      assert.strictEqual(written.writtenIds.length, 1);
      assert.strictEqual(written.records[0].transactionId, txId);
      assert.strictEqual(written.records[0].eventKey, keySubmitted);
      assert.strictEqual(written.records[0].status, 'PENDING');
    });

    assert.strictEqual(isValidOutboxTransition('PENDING', 'PROCESSING'), true);
    assert.strictEqual(isValidOutboxTransition('DISPATCHED', 'PROCESSING'), false);
    assert.strictEqual(isValidOutboxTransition('DEAD_LETTER', 'PENDING'), false);
    assert.strictEqual(OUTBOX_TERMINAL_STATES.has('DISPATCHED'), true);
    assert.strictEqual(OUTBOX_TERMINAL_STATES.has('DEAD_LETTER'), true);
    assert.deepStrictEqual(ALLOWED_OUTBOX_TRANSITIONS.DISPATCHED, []);

    console.log('✓ Tests 1–4 passed: Deterministic outbox IDs, user isolation, lifecycle separation & unmodified transactionId');
  }

  // -------------------------------------------------------------------------
  // TEST 5: Explicit eventKey behavior & backward compatibility in notificationDispatcher
  // -------------------------------------------------------------------------
  {
    const legacyKey = resolveDispatchKey({
      transactionId: 'tx_legacy_1',
      referenceNumber: 'MV-1',
      type: 'MONEY_RECEIVED',
    });
    assert.strictEqual(legacyKey, 'tx_legacy_1_MONEY_RECEIVED');

    const explicitInitKey = resolveDispatchKey({
      transactionId: 'tx_multi_1',
      referenceNumber: 'MV-2',
      eventKey: buildTransactionLifecycleEventKey('tx_multi_1', 'INITIATED'),
      type: 'TRANSACTION',
    });
    const explicitRevKey = resolveDispatchKey({
      transactionId: 'tx_multi_1',
      referenceNumber: 'MV-2',
      eventKey: buildTransactionLifecycleEventKey('tx_multi_1', 'REVERSED'),
      type: 'TRANSACTION',
    });
    assert.strictEqual(explicitInitKey, 'tx_multi_1:INITIATED_TRANSACTION');
    assert.strictEqual(explicitRevKey, 'tx_multi_1:REVERSED_TRANSACTION');
    assert.notStrictEqual(
      computeDispatchLogId('uid_1', explicitInitKey),
      computeDispatchLogId('uid_1', explicitRevKey)
    );

    const fsMem = new StrictInMemoryFirestore();
    const pushTok = 'fcm_stage3da_evkey_tok_' + 'a'.repeat(40);
    await registerCustomerPushToken(
      { uid: 'uid_ev_test', token: pushTok, platform: 'web' },
      fsMem as unknown as Firestore
    );

    let pushCount = 0;
    const mockMessaging: Partial<Messaging> = {
      sendEachForMulticast: async (msg: any) => {
        pushCount++;
        return {
          successCount: msg.tokens.length,
          failureCount: 0,
          responses: msg.tokens.map(() => ({ success: true, messageId: `m_${pushCount}` })),
        };
      },
    };

    const dispatcher = new ServerNotificationDispatcher({
      firestore: fsMem as unknown as Firestore,
      messaging: mockMessaging as Messaging,
      isAdminConfigured: () => true,
      isMessagingConfigured: () => true,
    });

    const out1 = await dispatcher.dispatch({
      transactionId: 'tx_orig_777',
      referenceNumber: 'MV-777',
      eventKey: buildTransactionLifecycleEventKey('tx_orig_777', 'INITIATED'),
      lifecycleStage: 'INITIATED',
      type: 'TRANSACTION',
      userId: 'uid_ev_test',
      title: 'Withdrawal Initiated',
      body: 'Initiated withdrawal.',
    });
    const out2 = await dispatcher.dispatch({
      transactionId: 'tx_orig_777',
      referenceNumber: 'MV-777',
      eventKey: buildTransactionLifecycleEventKey('tx_orig_777', 'REVERSED'),
      lifecycleStage: 'REVERSED',
      type: 'TRANSACTION',
      userId: 'uid_ev_test',
      title: 'Withdrawal Reversed',
      body: 'Reversed withdrawal.',
    });

    assert.strictEqual(out1.push.delivered, true);
    assert.strictEqual(out2.push.delivered, true);
    assert.strictEqual(pushCount, 2);

    const initLogId = computeDispatchLogId('uid_ev_test', explicitInitKey.replace('tx_multi_1', 'tx_orig_777'));
    const initLogSnap = await fsMem.collection('notification_dispatch_logs').doc(initLogId).get();
    assert.strictEqual(initLogSnap.data()?.transactionId, 'tx_orig_777');
    assert.strictEqual(initLogSnap.data()?.eventKey, 'tx_orig_777:INITIATED');

    console.log('✓ Test 5 passed: Explicit eventKey isolates lifecycle stages while keeping backward compatibility & original transactionId');
  }

  // -------------------------------------------------------------------------
  // TEST 6, 7 & 8: Persistent per-channel status prevents SMS/Email resends across restarts
  // -------------------------------------------------------------------------
  {
    const fsMem = new StrictInMemoryFirestore();
    const validTok = 'fcm_stage3da_channel_tok_' + 'b'.repeat(40);
    await registerCustomerPushToken(
      { uid: 'uid_chan', token: validTok, platform: 'web' },
      fsMem as unknown as Firestore
    );

    let smsSendCount = 0;
    let emailSendCount = 0;
    let pushFailMode = true;

    const origSms = smsService.sendTransactionSms.bind(smsService);
    const origEmail = emailService.sendTransactionalEmail.bind(emailService);

    (smsService as any).sendTransactionSms = async () => {
      smsSendCount++;
      return { success: true, delivered: true, status: 'SENT', messageId: `sms_${smsSendCount}` };
    };
    (emailService as any).sendTransactionalEmail = async () => {
      emailSendCount++;
      return { success: true, delivered: true, status: 'SENT', messageId: `email_${emailSendCount}` };
    };

    try {
      const mockMessaging: Partial<Messaging> = {
        sendEachForMulticast: async (msg: any) => {
          if (pushFailMode) {
            return {
              successCount: 0,
              failureCount: msg.tokens.length,
              responses: msg.tokens.map(() => ({
                success: false,
                error: { code: 'messaging/internal-error', message: 'Transient FCM outage' },
              })),
            };
          }
          return {
            successCount: msg.tokens.length,
            failureCount: 0,
            responses: msg.tokens.map(() => ({ success: true, messageId: 'push_ok' })),
          };
        },
      };

      const recordA = buildNotificationOutboxRecord({
        userId: 'uid_chan',
        transactionId: 'tx_chan_A',
        referenceNumber: 'MV-CHAN-A',
        eventKey: 'tx_chan_A:COMPLETED',
        lifecycleStage: 'COMPLETED',
        dispatchType: 'MONEY_RECEIVED',
        payload: {
          amount: 250,
          currency: 'USD',
          senderName: 'Bennett Johnson',
          recipientName: 'Eleanor Vance',
          accountMasked: 'MVB •••• 7391',
        },
      });
      await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(recordA.id).set(recordA);

      const worker1 = new ServerNotificationDispatcher({
        firestore: fsMem as unknown as Firestore,
        messaging: mockMessaging as Messaging,
        isAdminConfigured: () => true,
        isMessagingConfigured: () => true,
        instanceId: 'worker_1',
      });

      const claim1 = await claimOutboxLease(fsMem as unknown as Firestore, recordA.id, 'worker_1');
      assert.strictEqual(claim1.claimed, true);

      const dispatch1 = await worker1.dispatch(
        buildDispatchEventFromOutboxRecord(claim1.record!, {
          email: 'eleanor@example.com',
          phone: '+15550001234',
        }),
        buildOutboxDispatchOptions(claim1.record!, claim1.leaseToken!)
      );
      assert.strictEqual(dispatch1.push.status, 'FAILED');
      assert.strictEqual(dispatch1.sms.status, 'SENT');
      assert.strictEqual(dispatch1.email.status, 'SENT');

      const log1 = await fetchDispatchLogForOutboxRecord(fsMem as unknown as Firestore, recordA);
      assert.strictEqual(log1?.smsStatus, 'SENT');
      assert.strictEqual(log1?.emailStatus, 'SENT');

      const outcome1 = evaluateOutboxAttemptOutcome({
        outboxRecord: claim1.record!,
        dispatchResult: dispatch1,
        persistentLog: log1,
      });
      assert.strictEqual(outcome1.nextStatus, 'FAILED_RETRYABLE');
      assert.strictEqual(outcome1.smsStatus, 'SENT');
      assert.strictEqual(outcome1.emailStatus, 'SENT');

      const tr1 = await transitionOutboxAsLeaseOwner(
        fsMem as unknown as Firestore,
        recordA.id,
        claim1.leaseToken!,
        () => ({
          status: outcome1.nextStatus!,
          pushStatus: outcome1.pushStatus,
          smsStatus: outcome1.smsStatus,
          emailStatus: outcome1.emailStatus,
          failureClassification: outcome1.failureClassification,
          nextAttemptAt: new Date(Date.now() - 1000).toISOString(),
          lastError: outcome1.lastError,
        })
      );
      assert.strictEqual(tr1.status, 'UPDATED');
      assert.deepStrictEqual(getUnfinishedOutboxChannels(tr1.record!), {
        push: true,
        sms: false,
        email: false,
      });

      pushFailMode = false;
      const worker2 = new ServerNotificationDispatcher({
        firestore: fsMem as unknown as Firestore,
        messaging: mockMessaging as Messaging,
        isAdminConfigured: () => true,
        isMessagingConfigured: () => true,
        instanceId: 'worker_2',
      });
      const claim2 = await claimOutboxLease(fsMem as unknown as Firestore, recordA.id, 'worker_2');
      assert.strictEqual(claim2.claimed, true);

      const dispatch2 = await worker2.dispatch(
        buildDispatchEventFromOutboxRecord(claim2.record!, {
          email: 'eleanor@example.com',
          phone: '+15550001234',
        }),
        buildOutboxDispatchOptions(claim2.record!, claim2.leaseToken!)
      );
      assert.strictEqual(dispatch2.push.status, 'SENT');
      assert.strictEqual(smsSendCount, 1);
      assert.strictEqual(emailSendCount, 1);

      const log2 = await fetchDispatchLogForOutboxRecord(fsMem as unknown as Firestore, recordA);
      const outcome2 = evaluateOutboxAttemptOutcome({
        outboxRecord: claim2.record!,
        dispatchResult: dispatch2,
        persistentLog: log2,
      });
      assert.strictEqual(outcome2.nextStatus, 'DISPATCHED');

      // Email succeeds while SMS fails transiently -> retry only runs SMS + Push
      const prevSmsCalls = smsSendCount;
      const prevEmailCalls = emailSendCount;
      (smsService as any).sendTransactionSms = async () => {
        if (smsSendCount === prevSmsCalls) {
          smsSendCount++;
          return { success: false, delivered: false, status: 'FAILED', error: 'Twilio 503' };
        }
        smsSendCount++;
        return { success: true, delivered: true, status: 'SENT', messageId: 'sms_recovered' };
      };
      pushFailMode = true;

      const worker3 = new ServerNotificationDispatcher({
        firestore: fsMem as unknown as Firestore,
        messaging: mockMessaging as Messaging,
        isAdminConfigured: () => true,
        isMessagingConfigured: () => true,
        instanceId: 'worker_3',
      });
      const outB1 = await worker3.dispatch({
        transactionId: 'tx_chan_B',
        referenceNumber: 'MV-CHAN-B',
        eventKey: 'tx_chan_B:COMPLETED',
        type: 'MONEY_SENT',
        userId: 'uid_chan',
        recipientEmail: 'eleanor@example.com',
        recipientPhone: '+15550001234',
        amount: 100,
      });
      assert.strictEqual(outB1.email.status, 'SENT');
      assert.strictEqual(outB1.sms.status, 'FAILED');
      assert.strictEqual(emailSendCount, prevEmailCalls + 1);

      pushFailMode = false;
      const worker4 = new ServerNotificationDispatcher({
        firestore: fsMem as unknown as Firestore,
        messaging: mockMessaging as Messaging,
        isAdminConfigured: () => true,
        isMessagingConfigured: () => true,
        instanceId: 'worker_4',
      });
      const outB2 = await worker4.dispatch({
        transactionId: 'tx_chan_B',
        referenceNumber: 'MV-CHAN-B',
        eventKey: 'tx_chan_B:COMPLETED',
        type: 'MONEY_SENT',
        userId: 'uid_chan',
        recipientEmail: 'eleanor@example.com',
        recipientPhone: '+15550001234',
        amount: 100,
      });
      assert.strictEqual(outB2.push.status, 'SENT');
      assert.strictEqual(outB2.sms.status, 'SENT');
      assert.strictEqual(outB2.email.status, 'DUPLICATE_IGNORED');
      assert.strictEqual(emailSendCount, prevEmailCalls + 1);
    } finally {
      (smsService as any).sendTransactionSms = origSms;
      (emailService as any).sendTransactionalEmail = origEmail;
    }

    console.log('✓ Tests 6–8 passed: Per-channel persistent status prevents SMS or Email resends across worker restarts');
  }

  // -------------------------------------------------------------------------
  // TEST 9 & 10: DUPLICATE_IGNORED verification + NO_ACTIVE_TOKENS & DISABLED_BY_USER terminal
  // -------------------------------------------------------------------------
  {
    const baseRecord = buildNotificationOutboxRecord({
      userId: 'uid_dup',
      transactionId: 'tx_dup_1',
      referenceNumber: 'MV-DUP-1',
      eventKey: 'tx_dup_1:COMPLETED',
      lifecycleStage: 'COMPLETED',
      dispatchType: 'MONEY_RECEIVED',
      payload: { amount: 75, currency: 'USD', accountMasked: 'MVB •••• 1111' },
    });
    const claimedRecord = { ...baseRecord, status: 'PROCESSING' as const, attemptCount: 1 };

    const unconfirmedDup = evaluateOutboxAttemptOutcome({
      outboxRecord: claimedRecord,
      dispatchResult: {
        transactionId: 'tx_dup_1',
        referenceNumber: 'MV-DUP-1',
        push: { attempted: false, delivered: false, status: 'DUPLICATE_IGNORED' },
        sms: { success: true, delivered: false, status: 'DUPLICATE_IGNORED' },
        email: { success: true, delivered: false, status: 'DUPLICATE_IGNORED' },
      },
      persistentLog: null,
    });
    assert.strictEqual(unconfirmedDup.nextStatus, 'FAILED_RETRYABLE');
    assert.strictEqual(unconfirmedDup.pushStatus, 'FAILED_RETRYABLE');

    const confirmedDup = evaluateOutboxAttemptOutcome({
      outboxRecord: claimedRecord,
      dispatchResult: {
        transactionId: 'tx_dup_1',
        referenceNumber: 'MV-DUP-1',
        push: { attempted: false, delivered: false, status: 'DUPLICATE_IGNORED' },
        sms: { success: true, delivered: false, status: 'DUPLICATE_IGNORED' },
        email: { success: true, delivered: false, status: 'DUPLICATE_IGNORED' },
      },
      persistentLog: { pushStatus: 'SENT', smsStatus: 'SENT', emailStatus: 'SENT' },
    });
    assert.strictEqual(confirmedDup.nextStatus, 'DISPATCHED');

    const noTokensOutcome = evaluateOutboxAttemptOutcome({
      outboxRecord: claimedRecord,
      dispatchResult: {
        transactionId: 'tx_dup_1',
        referenceNumber: 'MV-DUP-1',
        push: { attempted: false, delivered: false, status: 'NO_ACTIVE_TOKENS' },
        sms: { success: true, delivered: false, status: 'DISABLED_BY_USER' },
        email: { success: true, delivered: false, status: 'DISABLED_BY_USER' },
      },
      persistentLog: { pushStatus: 'NO_ACTIVE_TOKENS' },
    });
    assert.strictEqual(noTokensOutcome.nextStatus, 'DISPATCHED');

    console.log('✓ Tests 9–10 passed: DUPLICATE_IGNORED requires persistent confirmation & NO_ACTIVE_TOKENS/DISABLED_BY_USER are terminal');
  }

  // -------------------------------------------------------------------------
  // TEST 11 & 12: Lease-token mismatch fencing & expired lease recovery
  // -------------------------------------------------------------------------
  {
    const fsMem = new StrictInMemoryFirestore();
    const rec = buildNotificationOutboxRecord({
      userId: 'uid_lease',
      transactionId: 'tx_lease_1',
      referenceNumber: 'MV-LEASE-1',
      eventKey: 'tx_lease_1:COMPLETED',
      lifecycleStage: 'COMPLETED',
      dispatchType: 'SECURITY',
      payload: { title: 'Security Update', body: 'Activity noticed.' },
    });
    await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(rec.id).set(rec);

    const t0 = 1_700_000_000_000;
    const workerAClaim = await claimOutboxLease(fsMem as unknown as Firestore, rec.id, 'worker_A', 5_000, t0);
    assert.strictEqual(workerAClaim.claimed, true);

    const prematureClaimB = await claimOutboxLease(fsMem as unknown as Firestore, rec.id, 'worker_B', 5_000, t0 + 1_000);
    assert.strictEqual(prematureClaimB.claimed, false);
    assert.strictEqual(prematureClaimB.reason, 'LEASE_ACTIVE');

    const wrongTokenWrite = await transitionOutboxAsLeaseOwner(
      fsMem as unknown as Firestore,
      rec.id,
      'forged_or_wrong_lease_token_00000000',
      () => ({ status: 'DISPATCHED', pushStatus: 'SENT' }),
      t0 + 1_500
    );
    assert.strictEqual(wrongTokenWrite.status, 'LEASE_LOST');
    assert.strictEqual(wrongTokenWrite.updated, false);

    const workerBClaim = await claimOutboxLease(fsMem as unknown as Firestore, rec.id, 'worker_B', 10_000, t0 + 6_000);
    assert.strictEqual(workerBClaim.claimed, true);
    assert.notStrictEqual(workerBClaim.leaseToken, workerAClaim.leaseToken);
    assert.strictEqual(workerBClaim.record?.attemptCount, 2);

    const staleAttemptA = await transitionOutboxAsLeaseOwner(
      fsMem as unknown as Firestore,
      rec.id,
      workerAClaim.leaseToken!,
      () => ({ status: 'FAILED_RETRYABLE', pushStatus: 'FAILED_RETRYABLE', lastError: 'stale failure' }),
      t0 + 6_500
    );
    assert.strictEqual(staleAttemptA.status, 'LEASE_LOST');
    assert.strictEqual(staleAttemptA.updated, false);

    const workerBFinalize = await transitionOutboxAsLeaseOwner(
      fsMem as unknown as Firestore,
      rec.id,
      workerBClaim.leaseToken!,
      () => ({
        status: 'DISPATCHED',
        pushStatus: 'SENT',
        smsStatus: 'SENT',
        emailStatus: 'SENT',
        dispatchedAt: new Date(t0 + 7_000).toISOString(),
      }),
      t0 + 7_000
    );
    assert.strictEqual(workerBFinalize.status, 'UPDATED');

    const postFinishAttemptA = await transitionOutboxAsLeaseOwner(
      fsMem as unknown as Firestore,
      rec.id,
      workerAClaim.leaseToken!,
      () => ({ status: 'FAILED_RETRYABLE' }),
      t0 + 7_500
    );
    assert.strictEqual(postFinishAttemptA.status, 'LEASE_LOST');

    console.log('✓ Tests 11–12 passed: Cryptographic leaseToken fencing blocks wrong tokens & stale workers');
  }

  // -------------------------------------------------------------------------
  // TEST 13 & 14: Invalid payload classification, Firestore rules & composite index queries
  // -------------------------------------------------------------------------
  {
    assert.strictEqual(sanitizeAndValidateOutboxPayload({ accountNumber: '1045827391' }).valid, false);
    assert.strictEqual(sanitizeAndValidateOutboxPayload({ pushTokens: ['raw'] }).valid, false);
    assert.strictEqual(sanitizeAndValidateOutboxPayload({ destinationBankRoutingNumber: '062005690' }).valid, false);
    assert.strictEqual(sanitizeAndValidateOutboxPayload({ body: 'Account 1045827391 debited' }).valid, false);

    const rulesSrc = fs.readFileSync(path.resolve('firestore.rules'), 'utf8');
    assert.ok(/match\s+\/notification_outbox\/\{outboxId\}\s*\{\s*allow\s+read,\s*write:\s*if\s+false;\s*\}/m.test(rulesSrc));
    assert.ok(/match\s+\/notification_dispatch_logs\/\{logId\}\s*\{\s*allow\s+read,\s*write:\s*if\s+false;\s*\}/m.test(rulesSrc));
    assert.ok(/match\s+\/\{document=\*\*\}\s*\{\s*allow\s+read,\s*write:\s*if\s+false;\s*\}/m.test(rulesSrc));

    const firebaseJson = JSON.parse(fs.readFileSync(path.resolve('firebase.json'), 'utf8'));
    assert.strictEqual(firebaseJson.firestore.rules, 'firestore.rules');
    assert.strictEqual(firebaseJson.firestore.indexes, 'firestore.indexes.json');

    const indexesJson = JSON.parse(fs.readFileSync(path.resolve('firestore.indexes.json'), 'utf8'));
    assert.deepStrictEqual(
      indexesJson.indexes.map((idx: any) => idx.fields.map((f: any) => f.fieldPath)),
      [
        ['status', 'nextAttemptAt'],
        ['status', 'leaseExpiresAt'],
      ]
    );

    // Execute buildRetryableOutboxQuery & buildExpiredProcessingOutboxQuery directly against harness
    const qFs = new StrictInMemoryFirestore();
    const duePending = buildNotificationOutboxRecord({
      userId: 'u_q1',
      transactionId: 'tx_q1',
      referenceNumber: 'MV-Q1',
      eventKey: 'tx_q1:COMPLETED',
      lifecycleStage: 'COMPLETED',
      dispatchType: 'MONEY_SENT',
      payload: { amount: 10, currency: 'USD' },
      nowIso: '2026-11-18T00:00:00.000Z',
    });
    const futureRetry = {
      ...buildNotificationOutboxRecord({
        userId: 'u_q2',
        transactionId: 'tx_q2',
        referenceNumber: 'MV-Q2',
        eventKey: 'tx_q2:COMPLETED',
        lifecycleStage: 'COMPLETED',
        dispatchType: 'MONEY_SENT',
        payload: { amount: 20, currency: 'USD' },
        nowIso: '2026-11-18T00:00:00.000Z',
      }),
      status: 'FAILED_RETRYABLE' as const,
      nextAttemptAt: '2026-11-18T05:00:00.000Z',
    };
    const expiredProc = {
      ...buildNotificationOutboxRecord({
        userId: 'u_q3',
        transactionId: 'tx_q3',
        referenceNumber: 'MV-Q3',
        eventKey: 'tx_q3:COMPLETED',
        lifecycleStage: 'COMPLETED',
        dispatchType: 'MONEY_RECEIVED',
        payload: { amount: 30, currency: 'USD' },
        nowIso: '2026-11-18T00:00:00.000Z',
      }),
      status: 'PROCESSING' as const,
      leaseExpiresAt: '2026-11-18T00:01:00.000Z',
    };

    await qFs.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(duePending.id).set(duePending);
    await qFs.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(futureRetry.id).set(futureRetry);
    await qFs.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(expiredProc.id).set(expiredProc);

    const retryableSnap = await buildRetryableOutboxQuery(
      qFs as unknown as Firestore,
      '2026-11-18T01:00:00.000Z'
    ).get();
    assert.strictEqual(retryableSnap.size, 1);
    assert.strictEqual(retryableSnap.docs[0].id, duePending.id);

    const expiredSnap = await buildExpiredProcessingOutboxQuery(
      qFs as unknown as Firestore,
      '2026-11-18T01:00:00.000Z'
    ).get();
    assert.strictEqual(expiredSnap.size, 1);
    assert.strictEqual(expiredSnap.docs[0].id, expiredProc.id);

    console.log('✓ Tests 13–14 passed: Validation, security rules, composite indexes & outbox query execution verified');
  }

  // -------------------------------------------------------------------------
  // TEST 15 [Stage 3D-A3 A]: Multi-record (C2C MONEY_SENT + MONEY_RECEIVED) atomic batching
  // with strict Firestore read-before-write enforcement & non-throwing invalid payloads
  // -------------------------------------------------------------------------
  {
    const fsMem = new StrictInMemoryFirestore();

    // 1. Seed existing ledger account + pre-existing DISPATCHED outbox record that must NOT be overwritten
    await fsMem.collection('accounts').doc('uid_sender').set({ checkingBalance: 1000 });
    const alreadyDispatchedRec = {
      ...buildNotificationOutboxRecord({
        userId: 'uid_already_done',
        transactionId: 'tx_done_1',
        referenceNumber: 'MV-DONE-1',
        eventKey: 'tx_done_1:COMPLETED',
        lifecycleStage: 'COMPLETED',
        dispatchType: 'MONEY_RECEIVED',
        payload: { amount: 99, currency: 'USD', accountMasked: 'MVB •••• 9999' },
      }),
      status: 'DISPATCHED' as const,
      pushStatus: 'SENT' as const,
      smsStatus: 'SENT' as const,
      emailStatus: 'SENT' as const,
      dispatchedAt: '2026-11-18T01:00:00.000Z',
    };
    await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(alreadyDispatchedRec.id).set(alreadyDispatchedRec);

    // 2. Prepare two C2C outbox records BEFORE entering transaction (never throws synchronously)
    const c2cTxId = 'tx_c2c_atomic_9001';
    const preparedSent = prepareNotificationOutboxRecord({
      userId: 'uid_sender',
      transactionId: c2cTxId,
      referenceNumber: 'MV-C2C-9001',
      eventKey: `${c2cTxId}:COMPLETED`,
      lifecycleStage: 'COMPLETED',
      dispatchType: 'MONEY_SENT',
      payload: { amount: 200, currency: 'USD', recipientName: 'Alice', accountMasked: 'MVB •••• 1111' },
    });
    const preparedReceived = prepareNotificationOutboxRecord({
      userId: 'uid_recipient',
      transactionId: c2cTxId,
      referenceNumber: 'MV-C2C-9001',
      eventKey: `${c2cTxId}:COMPLETED`,
      lifecycleStage: 'COMPLETED',
      dispatchType: 'MONEY_RECEIVED',
      payload: { amount: 200, currency: 'USD', senderName: 'Bob', accountMasked: 'MVB •••• 2222' },
    });
    const preparedInvalid = prepareNotificationOutboxRecord({
      userId: 'uid_invalid_case',
      transactionId: c2cTxId,
      referenceNumber: 'MV-C2C-9001',
      eventKey: `${c2cTxId}:INVALID_TEST`,
      lifecycleStage: 'COMPLETED',
      dispatchType: 'TRANSACTION',
      payload: {
        title: 'Bad Payload',
        body: 'Leaked 1045827391 account digits', // Forbidden unmasked 10 digits
      },
    });
    const preparedExistingDone = prepareNotificationOutboxRecord({
      userId: 'uid_already_done',
      transactionId: 'tx_done_1',
      referenceNumber: 'MV-DONE-1',
      eventKey: 'tx_done_1:COMPLETED',
      lifecycleStage: 'COMPLETED',
      dispatchType: 'MONEY_RECEIVED',
      payload: { amount: 99, currency: 'USD', accountMasked: 'MVB •••• 9999' },
    });

    assert.strictEqual(preparedSent.valid, true);
    assert.strictEqual(preparedReceived.valid, true);
    assert.strictEqual(preparedInvalid.valid, false, 'Invalid payload must return explicit valid:false instead of throwing');
    assert.strictEqual(preparedExistingDone.valid, true);

    // 3. Execute C2C ledger reads + outbox reads cleanly BEFORE ANY writes
    const writeSummary = await (fsMem as unknown as Firestore).runTransaction(async (tx) => {
      const senderAccSnap = await tx.get(
        fsMem.collection('accounts').doc('uid_sender') as unknown as DocumentReference
      );
      const outboxBatch = await prepareNotificationOutboxBatch(tx, fsMem as unknown as Firestore, [
        preparedSent,
        preparedReceived,
        preparedExistingDone,
        preparedInvalid,
      ]);

      // Write phase: ledger + two new outbox records atomically (zero tx.get() calls after first write!)
      tx.set(fsMem.collection('accounts').doc('uid_sender') as unknown as DocumentReference, {
        checkingBalance: Number(senderAccSnap.data()!.checkingBalance) - 200,
      });
      tx.set(fsMem.collection('transactions').doc(c2cTxId) as unknown as DocumentReference, {
        id: c2cTxId,
        amount: 200,
        status: 'COMPLETED',
      });

      return writePreparedNotificationOutboxBatchInTransaction(tx, outboxBatch);
    });

    assert.strictEqual(writeSummary.writtenIds.length, 2, 'Both MONEY_SENT and MONEY_RECEIVED must be written atomically');
    assert.strictEqual(writeSummary.skippedExistingIds.length, 1, 'Existing DISPATCHED record must not be overwritten');
    assert.strictEqual(writeSummary.invalidItems.length, 1, 'Invalid item must be reported explicitly without crashing ledger commit');

    // Verify existing DISPATCHED record stayed intact
    const preservedDone = await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(alreadyDispatchedRec.id).get();
    assert.strictEqual(preservedDone.data()?.status, 'DISPATCHED');
    assert.strictEqual(preservedDone.data()?.pushStatus, 'SENT');

    // 4. Verify StrictInMemoryFirestore indeed rejects tx.get after tx.set (proving harness catches read-after-write!)
    let readAfterWriteCaught = false;
    try {
      await (fsMem as unknown as Firestore).runTransaction(async (tx) => {
        tx.set(fsMem.collection('transactions').doc('tx_raw_order_check') as any, { ok: true });
        await prepareNotificationOutboxBatch(tx, fsMem as unknown as Firestore, [preparedSent]);
      });
    } catch (err: any) {
      readAfterWriteCaught = String(err?.message || '').includes('all reads to be executed before all writes');
    }
    assert.strictEqual(readAfterWriteCaught, true, 'Strict harness must enforce Firestore read-before-write rule');

    console.log('✓ Test 15 passed: Atomic multi-record outbox prepare/read/write passes strict Firestore read-before-write & non-throwing invalid payload handling');
  }

  // -------------------------------------------------------------------------
  // TEST 16 [Stage 3D-A3 B & E]: Real smsService & emailService UNCONFIGURED_PROVIDER
  // never poisons sentCache, recovers when env configured, and isolates eventKeys
  // -------------------------------------------------------------------------
  {
    const prevEnv = {
      TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
      TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
      TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER,
      TERMII_API_KEY: process.env.TERMII_API_KEY,
      RESEND_API_KEY: process.env.RESEND_API_KEY,
      SENDGRID_API_KEY: process.env.SENDGRID_API_KEY,
    };
    const origFetch = globalThis.fetch;
    let smsHttpCalls = 0;
    let emailHttpCalls = 0;

    try {
      delete process.env.TWILIO_ACCOUNT_SID;
      delete process.env.TWILIO_AUTH_TOKEN;
      delete process.env.TWILIO_PHONE_NUMBER;
      delete process.env.TERMII_API_KEY;
      delete process.env.RESEND_API_KEY;
      delete process.env.SENDGRID_API_KEY;

      const testRef = `MV-REC-${Date.now()}`;
      const testPhone = '+15559990001';
      const testEmail = `recovery-${Date.now()}@monvera.test`;
      const evCompleted = `${testRef}:COMPLETED`;

      // Attempt 1 & 2 while UNCONFIGURED: must NEVER poison sentCache or return DUPLICATE_IGNORED
      const smsUnconf1 = await smsService.sendTransactionSms({
        to: testPhone,
        type: 'MONEY_RECEIVED',
        amount: 300,
        referenceNumber: testRef,
        eventKey: evCompleted,
      });
      const smsUnconf2 = await smsService.sendTransactionSms({
        to: testPhone,
        type: 'MONEY_RECEIVED',
        amount: 300,
        referenceNumber: testRef,
        eventKey: evCompleted,
      });
      assert.strictEqual(smsUnconf1.status, 'UNCONFIGURED_PROVIDER');
      assert.strictEqual(smsUnconf2.status, 'UNCONFIGURED_PROVIDER', 'Second SMS attempt while unconfigured must NOT become DUPLICATE_IGNORED');

      const emailUnconf1 = await emailService.sendTransactionalEmail({
        to: testEmail,
        type: 'MONEY_RECEIVED',
        amount: 300,
        referenceNumber: testRef,
        eventKey: evCompleted,
      });
      const emailUnconf2 = await emailService.sendTransactionalEmail({
        to: testEmail,
        type: 'MONEY_RECEIVED',
        amount: 300,
        referenceNumber: testRef,
        eventKey: evCompleted,
      });
      assert.strictEqual(emailUnconf1.status, 'UNCONFIGURED_PROVIDER');
      assert.strictEqual(emailUnconf2.status, 'UNCONFIGURED_PROVIDER', 'Second Email attempt while unconfigured must NOT become DUPLICATE_IGNORED');

      // Configure providers with mocked fetch (zero real network calls!) and verify immediate recovery
      process.env.TWILIO_ACCOUNT_SID = 'AC_mock_test';
      process.env.TWILIO_AUTH_TOKEN = 'mock_auth_token';
      process.env.TWILIO_PHONE_NUMBER = '+15550009999';
      process.env.RESEND_API_KEY = 're_mock_key';

      globalThis.fetch = (async (url: any) => {
        const sUrl = String(url);
        if (sUrl.includes('api.twilio.com')) {
          smsHttpCalls++;
          return { ok: true, status: 200, json: async () => ({ sid: `SM_mock_${smsHttpCalls}` }) } as any;
        }
        if (sUrl.includes('api.resend.com')) {
          emailHttpCalls++;
          return { ok: true, status: 200, json: async () => ({ id: `em_mock_${emailHttpCalls}` }) } as any;
        }
        throw new Error(`Unexpected external fetch URL in test: ${sUrl}`);
      }) as any;

      const smsRecovered = await smsService.sendTransactionSms({
        to: testPhone,
        type: 'MONEY_RECEIVED',
        amount: 300,
        referenceNumber: testRef,
        eventKey: evCompleted,
      });
      assert.strictEqual(smsRecovered.status, 'SENT');
      assert.strictEqual(smsHttpCalls, 1);

      const emailRecovered = await emailService.sendTransactionalEmail({
        to: testEmail,
        type: 'MONEY_RECEIVED',
        amount: 300,
        referenceNumber: testRef,
        eventKey: evCompleted,
      });
      assert.strictEqual(emailRecovered.status, 'SENT');
      assert.strictEqual(emailHttpCalls, 1);

      // Successful-send deduplication remains strict for the SAME eventKey
      const smsDupSameStage = await smsService.sendTransactionSms({
        to: testPhone,
        type: 'MONEY_RECEIVED',
        amount: 300,
        referenceNumber: testRef,
        eventKey: evCompleted,
      });
      const emailDupSameStage = await emailService.sendTransactionalEmail({
        to: testEmail,
        type: 'MONEY_RECEIVED',
        amount: 300,
        referenceNumber: testRef,
        eventKey: evCompleted,
      });
      assert.strictEqual(smsDupSameStage.status, 'DUPLICATE_IGNORED');
      assert.strictEqual(emailDupSameStage.status, 'DUPLICATE_IGNORED');

      // Lifecycle stages sharing the EXACT same referenceNumber & type MUST NOT collide!
      const sharedRef = `MV-LIFE-${Date.now()}`;
      for (const stage of ['INITIATED', 'REVERSED', 'SUBMITTED', 'DELIVERED'] as const) {
        const stageKey = buildTransactionLifecycleEventKey('tx_life_shared', stage);
        const sRes = await smsService.sendTransactionSms({
          to: testPhone,
          type: 'SECURITY',
          referenceNumber: sharedRef,
          eventKey: stageKey,
        });
        const eRes = await emailService.sendTransactionalEmail({
          to: testEmail,
          type: 'SECURITY',
          referenceNumber: sharedRef,
          eventKey: stageKey,
        });
        assert.strictEqual(sRes.status, 'SENT', `SMS stage ${stage} must not collide with prior lifecycle stage`);
        assert.strictEqual(eRes.status, 'SENT', `Email stage ${stage} must not collide with prior lifecycle stage`);
      }
      assert.strictEqual(smsHttpCalls, 5);
      assert.strictEqual(emailHttpCalls, 5);

      // Ensure historical DISPATCHED outbox record with UNCONFIGURED_PROVIDER cannot be claimed or marked SENT later
      const histRecord = {
        ...buildNotificationOutboxRecord({
          userId: 'uid_hist_cfg',
          transactionId: 'tx_hist_cfg',
          referenceNumber: 'MV-HIST-1',
          eventKey: 'tx_hist_cfg:COMPLETED',
          lifecycleStage: 'COMPLETED',
          dispatchType: 'MONEY_RECEIVED',
          payload: { amount: 100, currency: 'USD', accountMasked: 'MVB •••• 0001' },
        }),
        status: 'PROCESSING' as const,
        attemptCount: 1,
      };
      const histOutcome = evaluateOutboxAttemptOutcome({
        outboxRecord: histRecord,
        dispatchResult: {
          transactionId: 'tx_hist_cfg',
          referenceNumber: 'MV-HIST-1',
          push: { attempted: true, delivered: true, status: 'SENT' },
          sms: { success: true, delivered: false, status: 'UNCONFIGURED_PROVIDER' },
          email: { success: true, delivered: false, status: 'UNCONFIGURED_PROVIDER' },
        },
        persistentLog: { pushStatus: 'SENT' },
      });
      assert.strictEqual(DEFAULT_OUTBOX_CHANNEL_POLICY.smsPolicy, 'BEST_EFFORT_RETRY_TRANSIENT');
      assert.strictEqual(histOutcome.nextStatus, 'DISPATCHED');
      assert.strictEqual(histOutcome.smsStatus, 'UNCONFIGURED_PROVIDER', 'Must preserve actual UNCONFIGURED_PROVIDER status');
      assert.strictEqual(histOutcome.emailStatus, 'UNCONFIGURED_PROVIDER');
      assert.strictEqual(histOutcome.failureClassification, 'MISSING_CONFIGURATION');

      // When requireConfiguredSms is explicitly enforced, UNCONFIGURED_PROVIDER remains FAILED_RETRYABLE
      const strictCfgOutcome = evaluateOutboxAttemptOutcome({
        outboxRecord: histRecord,
        dispatchResult: {
          transactionId: 'tx_hist_cfg',
          referenceNumber: 'MV-HIST-1',
          push: { attempted: true, delivered: true, status: 'SENT' },
          sms: { success: true, delivered: false, status: 'UNCONFIGURED_PROVIDER' },
          email: { success: true, delivered: false, status: 'UNCONFIGURED_PROVIDER' },
        },
        persistentLog: { pushStatus: 'SENT' },
        channelPolicy: { requireConfiguredSms: true },
      });
      assert.strictEqual(strictCfgOutcome.nextStatus, 'FAILED_RETRYABLE');
    } finally {
      globalThis.fetch = origFetch;
      for (const [k, v] of Object.entries(prevEnv)) {
        if (v === undefined) delete (process.env as any)[k];
        else (process.env as any)[k] = v;
      }
    }

    console.log('✓ Test 16 passed: SMS/Email UNCONFIGURED_PROVIDER does not poison sentCache, recovers on config & isolates lifecycle eventKeys');
  }

  // -------------------------------------------------------------------------
  // TEST 17 [Stage 3D-A3 C]: LEASE_LOST aborts SMS/Email, stale worker blocked from channel persistence,
  // outbox vs dispatch_log disagreement healed without duplicate sends, persistence errors propagated
  // -------------------------------------------------------------------------
  {
    const fsMem = new StrictInMemoryFirestore();
    const tok = 'fcm_stage3da3_lease_abort_tok_' + 'c'.repeat(40);
    await registerCustomerPushToken(
      { uid: 'uid_fence_c', token: tok, platform: 'web' },
      fsMem as unknown as Firestore
    );

    const outboxRec = buildNotificationOutboxRecord({
      userId: 'uid_fence_c',
      transactionId: 'tx_fence_c1',
      referenceNumber: 'MV-FENCE-C1',
      eventKey: 'tx_fence_c1:COMPLETED',
      lifecycleStage: 'COMPLETED',
      dispatchType: 'MONEY_RECEIVED',
      payload: { amount: 500, currency: 'USD', accountMasked: 'MVB •••• 5555' },
    });
    await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(outboxRec.id).set(outboxRec);

    const tStart = Date.now();
    const claimA = await claimOutboxLease(fsMem as unknown as Firestore, outboxRec.id, 'worker_stale_A', 2_000, tStart);
    assert.strictEqual(claimA.claimed, true);

    let smsInvocations = 0;
    let emailInvocations = 0;
    const origSms = smsService.sendTransactionSms.bind(smsService);
    const origEmail = emailService.sendTransactionalEmail.bind(emailService);

    (smsService as any).sendTransactionSms = async () => {
      smsInvocations++;
      return { success: true, delivered: true, status: 'SENT' };
    };
    (emailService as any).sendTransactionalEmail = async () => {
      emailInvocations++;
      return { success: true, delivered: true, status: 'SENT' };
    };

    try {
      // Simulate lease expiring and Worker B reclaiming RIGHT DURING Worker A's FCM send call
      const hijackingMessaging: Partial<Messaging> = {
        sendEachForMulticast: async (msg: any) => {
          const claimB = await claimOutboxLease(
            fsMem as unknown as Firestore,
            outboxRec.id,
            'worker_fresh_B',
            10_000,
            tStart + 5_000
          );
          assert.strictEqual(claimB.claimed, true);
          return {
            successCount: msg.tokens.length,
            failureCount: 0,
            responses: msg.tokens.map(() => ({ success: true, messageId: 'stale_push' })),
          };
        },
      };

      const staleWorker = new ServerNotificationDispatcher({
        firestore: fsMem as unknown as Firestore,
        messaging: hijackingMessaging as Messaging,
        isAdminConfigured: () => true,
        isMessagingConfigured: () => true,
        instanceId: 'worker_stale_A',
      });

      const staleResult = await staleWorker.dispatch(
        buildDispatchEventFromOutboxRecord(claimA.record!, {
          email: 'fence@monvera.test',
          phone: '+15558881111',
        }),
        buildOutboxDispatchOptions(claimA.record!, claimA.leaseToken!)
      );

      assert.strictEqual(staleResult.push.status, 'LEASE_LOST');
      assert.strictEqual(staleResult.sms.status, 'LEASE_LOST');
      assert.strictEqual(staleResult.email.status, 'LEASE_LOST');
      assert.strictEqual(smsInvocations, 0, 'LEASE_LOST on Push must immediately abort SMS');
      assert.strictEqual(emailInvocations, 0, 'LEASE_LOST on Push must immediately abort Email');

      // Stale worker's attempt to write channel completion into dispatch_logs was blocked
      const dispatchLogAfterStale = await fetchDispatchLogForOutboxRecord(fsMem as unknown as Firestore, outboxRec);
      assert.notStrictEqual(dispatchLogAfterStale?.pushStatus, 'SENT');
      assert.notStrictEqual(dispatchLogAfterStale?.smsStatus, 'SENT');

      // Outbox vs dispatch_log disagreement: outbox says smsStatus='SENT' while dispatch_logs has 'PENDING'
      const disagreeRec = buildNotificationOutboxRecord({
        userId: 'uid_fence_c',
        transactionId: 'tx_disagree_1',
        referenceNumber: 'MV-DIS-1',
        eventKey: 'tx_disagree_1:COMPLETED',
        lifecycleStage: 'COMPLETED',
        dispatchType: 'MONEY_RECEIVED',
        payload: { amount: 120, currency: 'USD', accountMasked: 'MVB •••• 5555' },
      });
      await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(disagreeRec.id).set({
        ...disagreeRec,
        smsStatus: 'SENT', // Already confirmed in outbox, missing from dispatch_logs!
      });
      const disagreeClaim = await claimOutboxLease(fsMem as unknown as Firestore, disagreeRec.id, 'worker_sync');
      assert.strictEqual(disagreeClaim.claimed, true);

      const cleanMessaging: Partial<Messaging> = {
        sendEachForMulticast: async (msg: any) => ({
          successCount: msg.tokens.length,
          failureCount: 0,
          responses: msg.tokens.map(() => ({ success: true, messageId: 'ok_sync' })),
        }),
      };
      const syncWorker = new ServerNotificationDispatcher({
        firestore: fsMem as unknown as Firestore,
        messaging: cleanMessaging as Messaging,
        isAdminConfigured: () => true,
        isMessagingConfigured: () => true,
        instanceId: 'worker_sync',
      });

      const smsBeforeSync = smsInvocations;
      const syncDispatch = await syncWorker.dispatch(
        buildDispatchEventFromOutboxRecord(disagreeClaim.record!, {
          email: 'fence@monvera.test',
          phone: '+15558881111',
        }),
        buildOutboxDispatchOptions(disagreeClaim.record!, disagreeClaim.leaseToken!)
      );
      assert.strictEqual(smsInvocations, smsBeforeSync, 'Confirmed SENT SMS on outbox must NOT resend even when dispatch_log disagreed');
      assert.strictEqual(syncDispatch.sms.status, 'DUPLICATE_IGNORED');
      assert.strictEqual(syncDispatch.email.status, 'SENT');

      // Verify dispatch_logs was synchronized to SENT
      const syncedLog = await fetchDispatchLogForOutboxRecord(fsMem as unknown as Firestore, disagreeRec);
      assert.strictEqual(syncedLog?.smsStatus, 'SENT');

      // Persistence failure with requirePersistentTracking=true must NOT be silently swallowed
      const persistFailRec = buildNotificationOutboxRecord({
        userId: 'uid_fence_c',
        transactionId: 'tx_pfail_1',
        referenceNumber: 'MV-PF-1',
        eventKey: 'tx_pfail_1:COMPLETED',
        lifecycleStage: 'COMPLETED',
        dispatchType: 'MONEY_RECEIVED',
        payload: { amount: 90, currency: 'USD', accountMasked: 'MVB •••• 5555' },
      });
      await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(persistFailRec.id).set(persistFailRec);
      const pfailClaim = await claimOutboxLease(fsMem as unknown as Firestore, persistFailRec.id, 'worker_pf');
      fsMem.failNextTransactionWrite = true;

      let persistenceThrew = false;
      try {
        await syncWorker.dispatch(
          buildDispatchEventFromOutboxRecord(pfailClaim.record!, {
            email: 'fence@monvera.test',
            phone: '+15558881111',
          }),
          buildOutboxDispatchOptions(pfailClaim.record!, pfailClaim.leaseToken!)
        );
      } catch (pErr: any) {
        persistenceThrew = String(pErr?.message || '').includes('SIMULATED_FIRESTORE_COMMIT_FAILURE');
      }
      assert.strictEqual(persistenceThrew, true, 'Required persistent tracking failure must NOT be silently swallowed');
    } finally {
      (smsService as any).sendTransactionSms = origSms;
      (emailService as any).sendTransactionalEmail = origEmail;
    }

    console.log('✓ Test 17 passed: LEASE_LOST aborts SMS/Email, stale workers fenced, disagreements resolved & tracking errors propagated');
  }

  // -------------------------------------------------------------------------
  // TEST 18 [Stage 3D-A3 D & E]: Retry backoff guard (nextAttemptAt), maxAttempts cap,
  // concurrent claimOutboxLease contention & DEAD_LETTER non-resurrection
  // -------------------------------------------------------------------------
  {
    const fsMem = new StrictInMemoryFirestore();
    const baseMs = 1_750_000_000_000;
    const retryRec = buildNotificationOutboxRecord({
      userId: 'uid_retry_guard',
      transactionId: 'tx_rg_1',
      referenceNumber: 'MV-RG-1',
      eventKey: 'tx_rg_1:COMPLETED',
      lifecycleStage: 'COMPLETED',
      dispatchType: 'TRANSACTION',
      payload: { title: 'Notice', body: 'Test retry guards.' },
      maxAttempts: 2,
      nowIso: new Date(baseMs).toISOString(),
    });
    await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(retryRec.id).set(retryRec);

    // Concurrent contention: two workers claim simultaneously; at most one succeeds!
    const concurrentResults = await Promise.allSettled([
      claimOutboxLease(fsMem as unknown as Firestore, retryRec.id, 'concurrent_w1', 5_000, baseMs + 100),
      claimOutboxLease(fsMem as unknown as Firestore, retryRec.id, 'concurrent_w2', 5_000, baseMs + 100),
    ]);
    const wonClaims = concurrentResults.filter(
      (r) => r.status === 'fulfilled' && r.value.claimed === true
    ) as PromiseFulfilledResult<any>[];
    assert.strictEqual(wonClaims.length, 1, 'Simultaneous claimOutboxLease calls must allow exactly one winner');

    const firstWinner = wonClaims[0].value;
    const backoffEval = evaluateOutboxAttemptOutcome({
      outboxRecord: firstWinner.record,
      dispatchResult: {
        transactionId: 'tx_rg_1',
        referenceNumber: 'MV-RG-1',
        push: { attempted: true, delivered: false, status: 'FAILED' },
        sms: { success: true, delivered: false, status: 'UNCONFIGURED_PROVIDER' },
        email: { success: true, delivered: false, status: 'UNCONFIGURED_PROVIDER' },
      },
      nowMs: baseMs + 200,
    });
    assert.strictEqual(backoffEval.nextStatus, 'FAILED_RETRYABLE');

    await transitionOutboxAsLeaseOwner(
      fsMem as unknown as Firestore,
      retryRec.id,
      firstWinner.leaseToken,
      () => ({
        status: 'FAILED_RETRYABLE',
        pushStatus: 'FAILED_RETRYABLE',
        nextAttemptAt: backoffEval.nextAttemptAt,
      }),
      baseMs + 250
    );

    // Claiming BEFORE nextAttemptAt must be rejected with RETRY_NOT_DUE
    const tooEarlyClaim = await claimOutboxLease(
      fsMem as unknown as Firestore,
      retryRec.id,
      'worker_early',
      5_000,
      baseMs + 5_000
    );
    assert.strictEqual(tooEarlyClaim.claimed, false);
    assert.strictEqual(tooEarlyClaim.reason, 'RETRY_NOT_DUE');

    // Claiming AT/AFTER nextAttemptAt succeeds (attempt 2 of maxAttempts=2)
    const dueMs = Date.parse(backoffEval.nextAttemptAt!) + 1;
    const attempt2Claim = await claimOutboxLease(fsMem as unknown as Firestore, retryRec.id, 'worker_2', 5_000, dueMs);
    assert.strictEqual(attempt2Claim.claimed, true);
    assert.strictEqual(attempt2Claim.record?.attemptCount, 2);

    // If attempt 2 crashes & lease expires, attempting a 3rd claim is blocked by maxAttempts=2
    const overMaxClaim = await claimOutboxLease(
      fsMem as unknown as Firestore,
      retryRec.id,
      'worker_3',
      5_000,
      dueMs + 10_000
    );
    assert.strictEqual(overMaxClaim.claimed, false);
    assert.strictEqual(overMaxClaim.reason, 'MAX_ATTEMPTS_EXCEEDED');

    // Transition to DEAD_LETTER and confirm DEAD_LETTER can never be resurrected
    const finalDeadOutcome = evaluateOutboxAttemptOutcome({
      outboxRecord: attempt2Claim.record!,
      dispatchResult: {
        transactionId: 'tx_rg_1',
        referenceNumber: 'MV-RG-1',
        push: { attempted: true, delivered: false, status: 'FAILED' },
        sms: { success: true, delivered: false, status: 'UNCONFIGURED_PROVIDER' },
        email: { success: true, delivered: false, status: 'UNCONFIGURED_PROVIDER' },
      },
      nowMs: dueMs + 100,
    });
    assert.strictEqual(finalDeadOutcome.nextStatus, 'DEAD_LETTER');

    await transitionOutboxAsLeaseOwner(
      fsMem as unknown as Firestore,
      retryRec.id,
      attempt2Claim.leaseToken!,
      () => ({
        status: 'DEAD_LETTER',
        pushStatus: 'FAILED_RETRYABLE',
        lastError: finalDeadOutcome.lastError,
      }),
      dueMs + 200
    );

    const reclaimDead = await claimOutboxLease(fsMem as unknown as Firestore, retryRec.id, 'worker_zombie', 5_000, dueMs + 100_000);
    assert.strictEqual(reclaimDead.claimed, false);
    assert.strictEqual(reclaimDead.reason, 'ALREADY_TERMINAL');

    console.log('✓ Test 18 passed: nextAttemptAt guard, maxAttempts cap, concurrent contention & DEAD_LETTER immutability verified');
  }

  // -------------------------------------------------------------------------
  // TEST 19 [Stage 3D-A4 Correction 1 — Tests A & B]: Explicit channel filtering
  // preserves PENDING and FAILED_RETRYABLE channels without mislabeling or terminalizing
  // -------------------------------------------------------------------------
  {
    const fsMem = new StrictInMemoryFirestore();
    const tok = 'fcm_stage3da4_filter_tok_' + 'd'.repeat(40);
    await registerCustomerPushToken(
      { uid: 'uid_filter_a4', token: tok, platform: 'web' },
      fsMem as unknown as Firestore
    );

    let pushCalls = 0;
    let smsCalls = 0;
    let emailCalls = 0;
    const origSms = smsService.sendTransactionSms.bind(smsService);
    const origEmail = emailService.sendTransactionalEmail.bind(emailService);

    (smsService as any).sendTransactionSms = async () => {
      smsCalls++;
      return { success: true, delivered: true, status: 'SENT', messageId: `sms_${smsCalls}` };
    };
    (emailService as any).sendTransactionalEmail = async () => {
      emailCalls++;
      return { success: true, delivered: true, status: 'SENT', messageId: `email_${emailCalls}` };
    };

    try {
      const mockMessaging: Partial<Messaging> = {
        sendEachForMulticast: async (msg: any) => {
          pushCalls++;
          return {
            successCount: msg.tokens.length,
            failureCount: 0,
            responses: msg.tokens.map(() => ({ success: true, messageId: `p_${pushCalls}` })),
          };
        },
      };

      const dispatcher = new ServerNotificationDispatcher({
        firestore: fsMem as unknown as Firestore,
        messaging: mockMessaging as Messaging,
        isAdminConfigured: () => true,
        isMessagingConfigured: () => true,
        instanceId: 'worker_filter_a4',
      });

      // A1. Explicitly skip PENDING SMS & Email while dispatching Push
      const pendingRec = buildNotificationOutboxRecord({
        userId: 'uid_filter_a4',
        transactionId: 'tx_flt_pend_1',
        referenceNumber: 'MV-FLT-1',
        eventKey: 'tx_flt_pend_1:COMPLETED',
        lifecycleStage: 'COMPLETED',
        dispatchType: 'MONEY_RECEIVED',
        payload: { amount: 125, currency: 'USD', accountMasked: 'MVB •••• 2468' },
      });
      await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(pendingRec.id).set(pendingRec);

      const claimA1 = await claimOutboxLease(fsMem as unknown as Firestore, pendingRec.id, 'worker_filter_a4');
      assert.strictEqual(claimA1.claimed, true);

      const resSkipSmsEmail = await dispatcher.dispatch(
        buildDispatchEventFromOutboxRecord(claimA1.record!, {
          email: 'filter@monvera.test',
          phone: '+15551112222',
        }),
        {
          ...buildOutboxDispatchOptions(claimA1.record!, claimA1.leaseToken!),
          channels: { push: true, sms: false, email: false },
        }
      );

      assert.strictEqual(resSkipSmsEmail.push.status, 'SENT');
      assert.strictEqual(resSkipSmsEmail.sms.status, 'SKIPPED', 'Skipped PENDING SMS must return SKIPPED');
      assert.strictEqual(resSkipSmsEmail.email.status, 'SKIPPED', 'Skipped PENDING Email must return SKIPPED');
      assert.strictEqual(pushCalls, 1);
      assert.strictEqual(smsCalls, 0, 'Skipped SMS must not invoke smsService');
      assert.strictEqual(emailCalls, 0, 'Skipped Email must not invoke emailService');

      const logAfterSkip1 = await fetchDispatchLogForOutboxRecord(fsMem as unknown as Firestore, pendingRec);
      assert.strictEqual(logAfterSkip1?.pushStatus, 'SENT');
      assert.strictEqual(logAfterSkip1?.smsStatus, 'PENDING', 'Skipped SMS must remain PENDING in dispatch_logs');
      assert.strictEqual(logAfterSkip1?.emailStatus, 'PENDING', 'Skipped Email must remain PENDING in dispatch_logs');

      const evalAfterSkip1 = evaluateOutboxAttemptOutcome({
        outboxRecord: claimA1.record!,
        dispatchResult: resSkipSmsEmail,
        persistentLog: logAfterSkip1,
      });
      assert.strictEqual(evalAfterSkip1.nextStatus, 'FAILED_RETRYABLE', 'Outbox must stay non-terminal when PENDING channels were skipped');
      assert.strictEqual(evalAfterSkip1.pushStatus, 'SENT');
      assert.strictEqual(evalAfterSkip1.smsStatus, 'PENDING', 'Skipped PENDING SMS must stay PENDING');
      assert.strictEqual(evalAfterSkip1.emailStatus, 'PENDING', 'Skipped PENDING Email must stay PENDING');

      await transitionOutboxAsLeaseOwner(
        fsMem as unknown as Firestore,
        pendingRec.id,
        claimA1.leaseToken!,
        () => ({
          status: evalAfterSkip1.nextStatus!,
          pushStatus: evalAfterSkip1.pushStatus,
          smsStatus: evalAfterSkip1.smsStatus,
          emailStatus: evalAfterSkip1.emailStatus,
          nextAttemptAt: new Date(Date.now() - 1000).toISOString(),
        })
      );

      // A2. Subsequent normal retry executes skipped PENDING SMS & Email and settles DISPATCHED
      const claimA2 = await claimOutboxLease(fsMem as unknown as Firestore, pendingRec.id, 'worker_filter_a4_2');
      assert.strictEqual(claimA2.claimed, true);
      assert.deepStrictEqual(getUnfinishedOutboxChannels(claimA2.record!), {
        push: false,
        sms: true,
        email: true,
      });

      const resFinish = await dispatcher.dispatch(
        buildDispatchEventFromOutboxRecord(claimA2.record!, {
          email: 'filter@monvera.test',
          phone: '+15551112222',
        }),
        buildOutboxDispatchOptions(claimA2.record!, claimA2.leaseToken!)
      );
      assert.strictEqual(resFinish.sms.status, 'SENT');
      assert.strictEqual(resFinish.email.status, 'SENT');
      assert.strictEqual(smsCalls, 1);
      assert.strictEqual(emailCalls, 1);
      assert.strictEqual(pushCalls, 1, 'Push was already SENT and must not re-send');

      // A3. Explicitly skip PENDING Push while sending SMS & Email -> Push remains PENDING & non-terminal
      const pushSkipRec = buildNotificationOutboxRecord({
        userId: 'uid_filter_a4',
        transactionId: 'tx_flt_push_pend',
        referenceNumber: 'MV-FLT-2',
        eventKey: 'tx_flt_push_pend:COMPLETED',
        lifecycleStage: 'COMPLETED',
        dispatchType: 'MONEY_SENT',
        payload: { amount: 80, currency: 'USD', accountMasked: 'MVB •••• 2468' },
      });
      await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(pushSkipRec.id).set(pushSkipRec);
      const claimPushSkip = await claimOutboxLease(fsMem as unknown as Firestore, pushSkipRec.id, 'worker_push_skip');
      assert.strictEqual(claimPushSkip.claimed, true);

      const resSkipPush = await dispatcher.dispatch(
        buildDispatchEventFromOutboxRecord(claimPushSkip.record!, {
          email: 'filter@monvera.test',
          phone: '+15551112222',
        }),
        {
          ...buildOutboxDispatchOptions(claimPushSkip.record!, claimPushSkip.leaseToken!),
          channels: { push: false, sms: true, email: true },
        }
      );
      assert.strictEqual(resSkipPush.push.status, 'SKIPPED');
      assert.strictEqual(resSkipPush.sms.status, 'SENT');
      assert.strictEqual(resSkipPush.email.status, 'SENT');
      assert.strictEqual(pushCalls, 1, 'Skipped Push must not invoke FCM');

      const logPushSkip = await fetchDispatchLogForOutboxRecord(fsMem as unknown as Firestore, pushSkipRec);
      const evalPushSkip = evaluateOutboxAttemptOutcome({
        outboxRecord: claimPushSkip.record!,
        dispatchResult: resSkipPush,
        persistentLog: logPushSkip,
      });
      assert.strictEqual(evalPushSkip.nextStatus, 'FAILED_RETRYABLE');
      assert.strictEqual(evalPushSkip.pushStatus, 'PENDING', 'Skipped PENDING Push must remain PENDING');

      // B. Explicitly skipped FAILED_RETRYABLE Push, SMS, and Email all remain FAILED_RETRYABLE
      const retryableSkippedRec = {
        ...buildNotificationOutboxRecord({
          userId: 'uid_filter_a4',
          transactionId: 'tx_flt_retry_1',
          referenceNumber: 'MV-FLT-3',
          eventKey: 'tx_flt_retry_1:COMPLETED',
          lifecycleStage: 'COMPLETED',
          dispatchType: 'MONEY_RECEIVED',
          payload: { amount: 60, currency: 'USD', accountMasked: 'MVB •••• 2468' },
        }),
        status: 'PROCESSING' as const,
        pushStatus: 'FAILED_RETRYABLE' as const,
        smsStatus: 'FAILED_RETRYABLE' as const,
        emailStatus: 'FAILED_RETRYABLE' as const,
        attemptCount: 1,
      };
      const evalRetrySkip = evaluateOutboxAttemptOutcome({
        outboxRecord: retryableSkippedRec,
        dispatchResult: {
          transactionId: 'tx_flt_retry_1',
          referenceNumber: 'MV-FLT-3',
          push: { attempted: false, delivered: false, status: 'SKIPPED' },
          sms: { success: true, delivered: false, status: 'SKIPPED' },
          email: { success: true, delivered: false, status: 'SKIPPED' },
        },
        persistentLog: null,
      });
      assert.strictEqual(evalRetrySkip.nextStatus, 'FAILED_RETRYABLE');
      assert.strictEqual(evalRetrySkip.pushStatus, 'FAILED_RETRYABLE');
      assert.strictEqual(evalRetrySkip.smsStatus, 'FAILED_RETRYABLE');
      assert.strictEqual(evalRetrySkip.emailStatus, 'FAILED_RETRYABLE');
      assert.deepStrictEqual(getUnfinishedOutboxChannels({
        dispatchType: 'MONEY_RECEIVED',
        pushStatus: evalRetrySkip.pushStatus!,
        smsStatus: evalRetrySkip.smsStatus!,
        emailStatus: evalRetrySkip.emailStatus!,
      }), { push: true, sms: true, email: true });
    } finally {
      (smsService as any).sendTransactionSms = origSms;
      (emailService as any).sendTransactionalEmail = origEmail;
    }

    console.log('✓ Test 19 passed: Explicitly skipped PENDING and FAILED_RETRYABLE channels remain eligible and unmodified');
  }

  // -------------------------------------------------------------------------
  // TEST 20 [Stage 3D-A4 Correction 2 — Tests C, D & E]: Default Date.now() lease
  // expiry self-fences BEFORE any competing worker reclaims the outbox record
  // -------------------------------------------------------------------------
  {
    const fsMem = new StrictInMemoryFirestore();
    const tok = 'fcm_stage3da4_expiry_tok_' + 'e'.repeat(40);
    await registerCustomerPushToken(
      { uid: 'uid_self_exp', token: tok, platform: 'web' },
      fsMem as unknown as Firestore
    );

    let pushCount = 0;
    let smsCount = 0;
    let emailCount = 0;
    const origSms = smsService.sendTransactionSms.bind(smsService);
    const origEmail = emailService.sendTransactionalEmail.bind(emailService);

    (smsService as any).sendTransactionSms = async () => {
      smsCount++;
      return { success: true, delivered: true, status: 'SENT' };
    };
    (emailService as any).sendTransactionalEmail = async () => {
      emailCount++;
      return { success: true, delivered: true, status: 'SENT' };
    };

    try {
      // C1/D1/E1: Worker claims a lease that has ALREADY expired vs Date.now() (no reclaim by Worker B)
      const expiredEntryRec = buildNotificationOutboxRecord({
        userId: 'uid_self_exp',
        transactionId: 'tx_self_exp_1',
        referenceNumber: 'MV-EXP-1',
        eventKey: 'tx_self_exp_1:COMPLETED',
        lifecycleStage: 'COMPLETED',
        dispatchType: 'MONEY_RECEIVED',
        payload: { amount: 220, currency: 'USD', accountMasked: 'MVB •••• 3579' },
      });
      await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(expiredEntryRec.id).set(expiredEntryRec);

      // Claim at (Date.now() - 5000) with 1000ms lease -> lease expired 4000ms ago; NO Worker B has reclaimed!
      const claimPast = await claimOutboxLease(
        fsMem as unknown as Firestore,
        expiredEntryRec.id,
        'worker_expired_entry',
        1_000,
        Date.now() - 5_000
      );
      assert.strictEqual(claimPast.claimed, true);

      const mockMessaging1: Partial<Messaging> = {
        sendEachForMulticast: async (msg: any) => {
          pushCount++;
          return {
            successCount: msg.tokens.length,
            failureCount: 0,
            responses: msg.tokens.map(() => ({ success: true, messageId: 'unexpected_exp_push' })),
          };
        },
      };

      const expiredWorker = new ServerNotificationDispatcher({
        firestore: fsMem as unknown as Firestore,
        messaging: mockMessaging1 as Messaging,
        isAdminConfigured: () => true,
        isMessagingConfigured: () => true,
        instanceId: 'worker_expired_entry',
      });

      // NOTE: Intentionally omit overrides.nowMs so dispatcher checks Date.now() itself!
      const expRes1 = await expiredWorker.dispatch(
        buildDispatchEventFromOutboxRecord(claimPast.record!, {
          email: 'expired@monvera.test',
          phone: '+15553334444',
        }),
        buildOutboxDispatchOptions(claimPast.record!, claimPast.leaseToken!)
      );

      assert.strictEqual(expRes1.push.status, 'LEASE_LOST');
      assert.strictEqual(expRes1.sms.status, 'LEASE_LOST');
      assert.strictEqual(expRes1.email.status, 'LEASE_LOST');
      assert.strictEqual(pushCount, 0, 'Expired lease must not initiate Push even without Worker B reclaim');
      assert.strictEqual(smsCount, 0, 'Expired lease must not send SMS even without Worker B reclaim');
      assert.strictEqual(emailCount, 0, 'Expired lease must not send Email even without Worker B reclaim');

      const logExp1 = await fetchDispatchLogForOutboxRecord(fsMem as unknown as Firestore, expiredEntryRec);
      assert.strictEqual(logExp1, null, 'Expired worker must not create or modify dispatch logs');

      // Calling transitionOutboxAsLeaseOwner with expired lease (still no Worker B reclaim) is also fenced!
      const expiredOutboxTransition = await transitionOutboxAsLeaseOwner(
        fsMem as unknown as Firestore,
        expiredEntryRec.id,
        claimPast.leaseToken!,
        () => ({ status: 'DISPATCHED', pushStatus: 'SENT' })
      );
      assert.strictEqual(expiredOutboxTransition.status, 'LEASE_LOST');
      assert.strictEqual(expiredOutboxTransition.updated, false);

      // C2/D2/E2: Worker stalls INSIDE FCM sendEachForMulticast past its short lease, with NO reclaim
      const midExpiryRec = buildNotificationOutboxRecord({
        userId: 'uid_self_exp',
        transactionId: 'tx_self_exp_2',
        referenceNumber: 'MV-EXP-2',
        eventKey: 'tx_self_exp_2:COMPLETED',
        lifecycleStage: 'COMPLETED',
        dispatchType: 'MONEY_RECEIVED',
        payload: { amount: 310, currency: 'USD', accountMasked: 'MVB •••• 3579' },
      });
      await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(midExpiryRec.id).set(midExpiryRec);

      const claimMid = await claimOutboxLease(
        fsMem as unknown as Firestore,
        midExpiryRec.id,
        'worker_mid_expiry',
        30 // 30ms real wall-clock TTL
      );
      assert.strictEqual(claimMid.claimed, true);

      const stallingMessaging: Partial<Messaging> = {
        sendEachForMulticast: async (msg: any) => {
          await new Promise((r) => setTimeout(r, 60)); // Wait past 30ms TTL — NO competing claim!
          return {
            successCount: msg.tokens.length,
            failureCount: 0,
            responses: msg.tokens.map(() => ({ success: true, messageId: 'late_mid_push' })),
          };
        },
      };

      const midWorker = new ServerNotificationDispatcher({
        firestore: fsMem as unknown as Firestore,
        messaging: stallingMessaging as Messaging,
        isAdminConfigured: () => true,
        isMessagingConfigured: () => true,
        instanceId: 'worker_mid_expiry',
      });

      const expRes2 = await midWorker.dispatch(
        buildDispatchEventFromOutboxRecord(claimMid.record!, {
          email: 'expired@monvera.test',
          phone: '+15553334444',
        }),
        buildOutboxDispatchOptions(claimMid.record!, claimMid.leaseToken!)
      );

      assert.strictEqual(expRes2.push.status, 'LEASE_LOST');
      assert.strictEqual(expRes2.sms.status, 'LEASE_LOST');
      assert.strictEqual(expRes2.email.status, 'LEASE_LOST');
      assert.strictEqual(smsCount, 0, 'Worker expiring mid-Push must NOT proceed to SMS');
      assert.strictEqual(emailCount, 0, 'Worker expiring mid-Push must NOT proceed to Email');

      const logExp2 = await fetchDispatchLogForOutboxRecord(fsMem as unknown as Firestore, midExpiryRec);
      assert.notStrictEqual(logExp2?.pushStatus, 'SENT', 'Expired worker must not finalize pushStatus=SENT in dispatch logs');
      assert.strictEqual(logExp2?.smsStatus, 'PENDING');
    } finally {
      (smsService as any).sendTransactionSms = origSms;
      (emailService as any).sendTransactionalEmail = origEmail;
    }

    console.log('✓ Test 20 passed: Expired leases self-fence via Date.now() without reclaim, blocking Push/SMS/Email & protected writes');
  }

  // -------------------------------------------------------------------------
  // TEST 21 [Stage 3D-A4 Correction 3 — Tests F, G, H, I & J]: Idempotent
  // transactional DEAD_LETTER settlement of exhausted PROCESSING & FAILED_RETRYABLE records
  // -------------------------------------------------------------------------
  {
    const fsMem = new StrictInMemoryFirestore();
    const baseMs = 1_760_000_000_000;
    const baseIso = new Date(baseMs).toISOString();

    assert.strictEqual(isValidOutboxTransition('FAILED_RETRYABLE', 'DEAD_LETTER'), true);

    // F. Exhausted expired PROCESSING record -> transitions to DEAD_LETTER & disappears from sweep queries
    const recProcExhausted = buildNotificationOutboxRecord({
      userId: 'uid_settle',
      transactionId: 'tx_stl_proc',
      referenceNumber: 'MV-STL-1',
      eventKey: 'tx_stl_proc:COMPLETED',
      lifecycleStage: 'COMPLETED',
      dispatchType: 'TRANSACTION',
      payload: { title: 'Notice', body: 'Processing exhausted test.' },
      maxAttempts: 2,
      nowIso: baseIso,
    });
    await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(recProcExhausted.id).set(recProcExhausted);

    // Claim attempt 1 & fail retryably
    const c1 = await claimOutboxLease(fsMem as unknown as Firestore, recProcExhausted.id, 'w1', 5_000, baseMs + 100);
    assert.strictEqual(c1.claimed, true);
    await transitionOutboxAsLeaseOwner(
      fsMem as unknown as Firestore,
      recProcExhausted.id,
      c1.leaseToken!,
      () => ({
        status: 'FAILED_RETRYABLE',
        pushStatus: 'FAILED_RETRYABLE',
        nextAttemptAt: new Date(baseMs + 200).toISOString(),
        lastError: 'Transient FCM 503',
      }),
      baseMs + 150
    );

    // H. Non-exhausted FAILED_RETRYABLE (attemptCount=1 < maxAttempts=2) MUST NOT settle!
    const nonExhaustedRetry = await settleExhaustedOutboxRecord(fsMem as unknown as Firestore, recProcExhausted.id, {
      nowMs: baseMs + 250,
    });
    assert.strictEqual(nonExhaustedRetry.settled, false);
    assert.strictEqual(nonExhaustedRetry.reason, 'NOT_EXHAUSTED');

    // Claim attempt 2 (attemptCount === maxAttempts === 2, active lease for 5s)
    const c2 = await claimOutboxLease(fsMem as unknown as Firestore, recProcExhausted.id, 'w2', 5_000, baseMs + 300);
    assert.strictEqual(c2.claimed, true);
    assert.strictEqual(c2.record?.attemptCount, 2);

    // I. Active unexpired lease on final attempt CANNOT be dead-lettered by a competing worker!
    const activeSettleBlocked = await settleExhaustedOutboxRecord(fsMem as unknown as Firestore, recProcExhausted.id, {
      nowMs: baseMs + 1_000, // Lease valid until baseMs + 5_300
    });
    assert.strictEqual(activeSettleBlocked.settled, false);
    assert.strictEqual(activeSettleBlocked.reason, 'LEASE_ACTIVE');

    // Once expired (baseMs + 6_000 > baseMs + 5_300), settle cleanly transitions expired PROCESSING to DEAD_LETTER
    const settledProc = await settleExhaustedOutboxRecord(fsMem as unknown as Firestore, recProcExhausted.id, {
      nowMs: baseMs + 6_000,
    });
    assert.strictEqual(settledProc.settled, true);
    assert.strictEqual(settledProc.reason, 'SETTLED_TO_DEAD_LETTER');
    assert.strictEqual(settledProc.record?.status, 'DEAD_LETTER');
    assert.strictEqual(settledProc.record?.leaseOwner, null);
    assert.strictEqual(settledProc.record?.leaseToken, null);
    assert.strictEqual(settledProc.record?.leaseExpiresAt, null);

    // J. Idempotent re-settlement on DEAD_LETTER
    const idempProc = await settleExhaustedOutboxRecord(fsMem as unknown as Firestore, recProcExhausted.id, {
      nowMs: baseMs + 7_000,
    });
    assert.strictEqual(idempProc.settled, true);
    assert.strictEqual(idempProc.reason, 'ALREADY_DEAD_LETTER');
    assert.strictEqual(idempProc.record?.status, 'DEAD_LETTER');

    // Confirm settled expired PROCESSING doc no longer appears in expired or retryable sweeps
    const expiredSweepAfterProc = await buildExpiredProcessingOutboxQuery(
      fsMem as unknown as Firestore,
      new Date(baseMs + 100_000).toISOString()
    ).get();
    assert.strictEqual(expiredSweepAfterProc.docs.some((d) => d.id === recProcExhausted.id), false);

    // G. Exhausted FAILED_RETRYABLE record -> transitions cleanly to DEAD_LETTER & leaves sweep query
    const recRetryExhausted = {
      ...buildNotificationOutboxRecord({
        userId: 'uid_settle',
        transactionId: 'tx_stl_retry',
        referenceNumber: 'MV-STL-2',
        eventKey: 'tx_stl_retry:COMPLETED',
        lifecycleStage: 'COMPLETED',
        dispatchType: 'MONEY_SENT',
        payload: { amount: 45, currency: 'USD', accountMasked: 'MVB •••• 3579' },
        maxAttempts: 3,
        nowIso: baseIso,
      }),
      status: 'FAILED_RETRYABLE' as const,
      pushStatus: 'FAILED_RETRYABLE' as const,
      attemptCount: 3,
      nextAttemptAt: new Date(baseMs + 100).toISOString(),
    };
    await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(recRetryExhausted.id).set(recRetryExhausted);

    const settledRetry = await settleExhaustedOutboxRecord(fsMem as unknown as Firestore, recRetryExhausted.id, {
      nowMs: baseMs + 50,
    });
    assert.strictEqual(settledRetry.settled, true);
    assert.strictEqual(settledRetry.reason, 'SETTLED_TO_DEAD_LETTER');
    assert.strictEqual(settledRetry.record?.status, 'DEAD_LETTER');

    const retrySweepAfter = await buildRetryableOutboxQuery(
      fsMem as unknown as Firestore,
      new Date(baseMs + 100_000).toISOString()
    ).get();
    assert.strictEqual(retrySweepAfter.docs.some((d) => d.id === recRetryExhausted.id), false);

    // H & J (continued): PENDING, non-exhausted expired PROCESSING, and DISPATCHED are untouched
    const recPending = buildNotificationOutboxRecord({
      userId: 'uid_settle',
      transactionId: 'tx_stl_pend',
      referenceNumber: 'MV-STL-3',
      eventKey: 'tx_stl_pend:COMPLETED',
      lifecycleStage: 'COMPLETED',
      dispatchType: 'TRANSACTION',
      payload: { title: 'Notice', body: 'Pending check.' },
      maxAttempts: 2,
      nowIso: baseIso,
    });
    const recProcNonExh = {
      ...buildNotificationOutboxRecord({
        userId: 'uid_settle',
        transactionId: 'tx_stl_proc_nonexh',
        referenceNumber: 'MV-STL-4',
        eventKey: 'tx_stl_proc_nonexh:COMPLETED',
        lifecycleStage: 'COMPLETED',
        dispatchType: 'TRANSACTION',
        payload: { title: 'Notice', body: 'Non-exhausted expired processing.' },
        maxAttempts: 3,
        nowIso: baseIso,
      }),
      status: 'PROCESSING' as const,
      attemptCount: 1,
      leaseExpiresAt: new Date(baseMs - 100).toISOString(),
    };
    const recDispatched = {
      ...buildNotificationOutboxRecord({
        userId: 'uid_settle',
        transactionId: 'tx_stl_done',
        referenceNumber: 'MV-STL-5',
        eventKey: 'tx_stl_done:COMPLETED',
        lifecycleStage: 'COMPLETED',
        dispatchType: 'MONEY_RECEIVED',
        payload: { amount: 15, currency: 'USD', accountMasked: 'MVB •••• 3579' },
        maxAttempts: 2,
        nowIso: baseIso,
      }),
      status: 'DISPATCHED' as const,
      pushStatus: 'SENT' as const,
      attemptCount: 2,
      dispatchedAt: baseIso,
    };

    await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(recPending.id).set(recPending);
    await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(recProcNonExh.id).set(recProcNonExh);
    await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(recDispatched.id).set(recDispatched);

    const pendingRes = await settleExhaustedOutboxRecord(fsMem as unknown as Firestore, recPending.id, { nowMs: baseMs });
    assert.strictEqual(pendingRes.settled, false);
    assert.strictEqual(pendingRes.reason, 'NOT_EXHAUSTED');

    const nonExhProcRes = await settleExhaustedOutboxRecord(fsMem as unknown as Firestore, recProcNonExh.id, { nowMs: baseMs });
    assert.strictEqual(nonExhProcRes.settled, false);
    assert.strictEqual(nonExhProcRes.reason, 'NOT_EXHAUSTED');

    const dispatchedRes = await settleExhaustedOutboxRecord(fsMem as unknown as Firestore, recDispatched.id, { nowMs: baseMs });
    assert.strictEqual(dispatchedRes.settled, false);
    assert.strictEqual(dispatchedRes.reason, 'ALREADY_DISPATCHED');
    const dispSnap = await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(recDispatched.id).get();
    assert.strictEqual(dispSnap.data()?.status, 'DISPATCHED', 'DISPATCHED must never be overwritten');

    console.log('✓ Test 21 passed: Exhausted PROCESSING & FAILED_RETRYABLE records settle idempotently to DEAD_LETTER while active/non-exhausted/DISPATCHED stay protected');
  }

  // -------------------------------------------------------------------------
  // TEST 22 [3D-B1.1]: executeServerTransfer transactional outbox integration
  // - Strict read-before-write compliance
  // - Two separate outbox events (sender MONEY_SENT, recipient MONEY_RECEIVED) sharing txId & :COMPLETED
  // - 9-digit referenceNumber preserved top-level without silent invalidItems drop
  // - Duplicate replay creates zero additional outbox docs & preserves DISPATCHED state
  // - Failed transfer (insufficient funds) & non-Firestore fallback create zero outbox docs
  // -------------------------------------------------------------------------
  {
    const fsMem = new StrictInMemoryFirestore();
    const deps = { firestore: fsMem as unknown as Firestore, isAdminConfigured: () => true };

    await fsMem.collection('users').doc('uid_sender_3db1').set({
      id: 'uid_sender_3db1',
      firstName: 'Alice',
      lastName: 'Sender',
      permanentAccountNumber: '1088492001',
      status: 'active',
    });
    await fsMem.collection('users').doc('uid_recip_3db1').set({
      id: 'uid_recip_3db1',
      firstName: 'Bob',
      lastName: 'Recipient',
      permanentAccountNumber: '1088492002',
      status: 'active',
    });
    await fsMem.collection('accounts').doc('uid_sender_3db1').set({
      userId: 'uid_sender_3db1',
      permanentAccountNumber: '1088492001',
      checkingBalance: 1000,
      savingsBalance: 0,
      investedBalance: 0,
      accruedEarnings: 0,
      totalBalance: 1000,
      availableBalance: 1000,
      pendingBalance: 0,
    });
    await fsMem.collection('accounts').doc('uid_recip_3db1').set({
      userId: 'uid_recip_3db1',
      permanentAccountNumber: '1088492002',
      checkingBalance: 200,
      savingsBalance: 0,
      investedBalance: 0,
      accruedEarnings: 0,
      totalBalance: 200,
      availableBalance: 200,
      pendingBalance: 0,
    });

    const trfRes = await executeServerTransfer(
      {
        senderUid: 'uid_sender_3db1',
        recipientIdentifier: 'uid_recip_3db1',
        recipientUserId: 'uid_recip_3db1',
        amount: 150,
        referenceNumber: 'MV-TRF-987654321',
        description: 'Stage 3D-B1.1 C2C transfer test',
      },
      deps
    );
    assert.strictEqual(trfRes.success, true);
    assert.strictEqual(trfRes.isDuplicate, false);
    assert.strictEqual(trfRes.transaction?.status, 'COMPLETED');
    assert.strictEqual(trfRes.senderBalanceMetrics?.checkingBalance, 850);
    assert.strictEqual(trfRes.recipientBalanceMetrics?.checkingBalance, 350);

    const committedTxId = trfRes.transaction!.id;
    const expectedEventKey = `${committedTxId}:COMPLETED`;
    const senderOutboxId = computeNotificationOutboxId('uid_sender_3db1', expectedEventKey, 'MONEY_SENT');
    const recipOutboxId = computeNotificationOutboxId('uid_recip_3db1', expectedEventKey, 'MONEY_RECEIVED');
    assert.notStrictEqual(senderOutboxId, recipOutboxId);

    const outboxSnap = await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get();
    assert.strictEqual(outboxSnap.size, 2, 'C2C transfer must write exactly 2 outbox records atomically');

    const senderOutboxSnap = await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(senderOutboxId).get();
    const recipOutboxSnap = await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(recipOutboxId).get();
    assert.strictEqual(senderOutboxSnap.exists, true);
    assert.strictEqual(recipOutboxSnap.exists, true);

    const senderOutbox = senderOutboxSnap.data()!;
    const recipOutbox = recipOutboxSnap.data()!;
    assert.strictEqual(senderOutbox.transactionId, committedTxId);
    assert.strictEqual(senderOutbox.referenceNumber, 'MV-TRF-987654321');
    assert.strictEqual(senderOutbox.eventKey, expectedEventKey);
    assert.strictEqual(senderOutbox.lifecycleStage, 'COMPLETED');
    assert.strictEqual(senderOutbox.dispatchType, 'MONEY_SENT');
    assert.strictEqual(senderOutbox.status, 'PENDING');
    assert.strictEqual(senderOutbox.payload.amount, 150);
    assert.strictEqual(JSON.stringify(senderOutbox).includes('1088492001'), false);
    assert.strictEqual(JSON.stringify(senderOutbox).includes('1088492002'), false);

    assert.strictEqual(recipOutbox.transactionId, committedTxId);
    assert.strictEqual(recipOutbox.referenceNumber, 'MV-TRF-987654321');
    assert.strictEqual(recipOutbox.eventKey, expectedEventKey);
    assert.strictEqual(recipOutbox.lifecycleStage, 'COMPLETED');
    assert.strictEqual(recipOutbox.dispatchType, 'MONEY_RECEIVED');
    assert.strictEqual(recipOutbox.status, 'PENDING');

    // Mark sender record DISPATCHED and replay duplicate transfer reference
    await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(senderOutboxId).set(
      { ...senderOutbox, status: 'DISPATCHED', pushStatus: 'SENT' }
    );
    const dupTrfRes = await executeServerTransfer(
      {
        senderUid: 'uid_sender_3db1',
        recipientIdentifier: 'uid_recip_3db1',
        recipientUserId: 'uid_recip_3db1',
        amount: 150,
        referenceNumber: 'MV-TRF-987654321',
      },
      deps
    );
    assert.strictEqual(dupTrfRes.success, true);
    assert.strictEqual(dupTrfRes.isDuplicate, true);
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 2);
    assert.strictEqual(
      (await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(senderOutboxId).get()).data()?.status,
      'DISPATCHED'
    );

    // Failed transfer (insufficient funds) must write ZERO outbox records
    const failTrfRes = await executeServerTransfer(
      {
        senderUid: 'uid_sender_3db1',
        recipientIdentifier: 'uid_recip_3db1',
        recipientUserId: 'uid_recip_3db1',
        amount: 999999,
        referenceNumber: 'MV-TRF-FAIL-987654321',
      },
      deps
    );
    assert.strictEqual(failTrfRes.success, false);
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 2);

    // Non-Firestore in-memory fallback must be excluded from outbox writes
    inMemoryDb.users.set('uid_sender_3db1', {
      id: 'uid_sender_3db1',
      email: 'alice3db1@monvera.test',
      passwordHash: 'test',
      firstName: 'Alice',
      lastName: 'Sender',
      permanentAccountNumber: '1088492001',
      kycStatus: 'verified',
      role: 'customer',
      createdAt: new Date().toISOString(),
    } as any);
    inMemoryDb.users.set('uid_recip_3db1', {
      id: 'uid_recip_3db1',
      email: 'bob3db1@monvera.test',
      passwordHash: 'test',
      firstName: 'Bob',
      lastName: 'Recipient',
      permanentAccountNumber: '1088492002',
      kycStatus: 'verified',
      role: 'customer',
      createdAt: new Date().toISOString(),
    } as any);
    inMemoryDb.accounts.set('acc_chk_uid_sender_3db1', {
      id: 'acc_chk_uid_sender_3db1',
      userId: 'uid_sender_3db1',
      type: 'CHECKING',
      accountNumber: '1088492001',
      routingNumber: '021000021',
      currency: 'USD',
      balance: 500,
      availableBalance: 500,
      investedBalance: 0,
      pendingBalance: 0,
      interestRateAPY: 1.25,
      status: 'ACTIVE',
      nickname: 'Monvera Premier Checking',
    });
    inMemoryDb.accounts.set('acc_chk_uid_recip_3db1', {
      id: 'acc_chk_uid_recip_3db1',
      userId: 'uid_recip_3db1',
      type: 'CHECKING',
      accountNumber: '1088492002',
      routingNumber: '021000021',
      currency: 'USD',
      balance: 200,
      availableBalance: 200,
      investedBalance: 0,
      pendingBalance: 0,
      interestRateAPY: 1.25,
      status: 'ACTIVE',
      nickname: 'Monvera Premier Checking',
    });
    const ledEntryId = 'led_tmp_3db1_fallback';
    inMemoryDb.ledgerEntries.push({
      id: ledEntryId,
      transactionId: 'tx_tmp_3db1_seed',
      userId: 'uid_sender_3db1',
      accountId: 'acc_chk_uid_sender_3db1',
      entryType: 'CREDIT',
      amount: 500,
      balanceAfter: 500,
      description: 'Temp test seed',
      timestamp: new Date().toISOString(),
    });
    try {
      const fallbackRes = await executeServerTransfer(
        {
          senderUid: 'uid_sender_3db1',
          recipientIdentifier: 'uid_recip_3db1',
          recipientUserId: 'uid_recip_3db1',
          amount: 10,
        },
        { firestore: fsMem as unknown as Firestore, isAdminConfigured: () => false }
      );
      assert.strictEqual(fallbackRes.success, true, `Fallback failed: ${fallbackRes.error}`);
      assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 2);
    } finally {
      inMemoryDb.users.delete('uid_sender_3db1');
      inMemoryDb.users.delete('uid_recip_3db1');
      inMemoryDb.accounts.delete('acc_chk_uid_sender_3db1');
      inMemoryDb.accounts.delete('acc_chk_uid_recip_3db1');
      const idx = inMemoryDb.ledgerEntries.findIndex((e) => e.id === ledEntryId);
      if (idx !== -1) inMemoryDb.ledgerEntries.splice(idx, 1);
    }

    console.log('✓ Test 22 passed: executeServerTransfer writes dual C2C outbox events atomically, handles duplicates/failures safely, and skips fallback');
  }

  // -------------------------------------------------------------------------
  // TEST 23 [3D-B1.1]: executeServerDeposit transactional outbox integration
  // - Read-before-write safe
  // - Single MONEY_RECEIVED :COMPLETED outbox doc on settlement
  // - Default 9-digit MV-DEP-######### ref pattern does not drop silently
  // - Duplicate Stripe/reference deposit & frozen/invalid failure create zero extra outbox docs
  // -------------------------------------------------------------------------
  {
    const fsMem = new StrictInMemoryFirestore();
    const deps = { firestore: fsMem as unknown as Firestore, isAdminConfigured: () => true };

    await fsMem.collection('users').doc('uid_dep_3db1').set({
      id: 'uid_dep_3db1',
      firstName: 'Clara',
      lastName: 'Depositor',
      permanentAccountNumber: '1088492003',
      status: 'active',
    });
    await fsMem.collection('accounts').doc('uid_dep_3db1').set({
      userId: 'uid_dep_3db1',
      permanentAccountNumber: '1088492003',
      checkingBalance: 100,
      savingsBalance: 0,
      investedBalance: 0,
      accruedEarnings: 0,
      totalBalance: 100,
      availableBalance: 100,
      pendingBalance: 0,
    });

    const depRes = await executeServerDeposit(
      {
        userId: 'uid_dep_3db1',
        amount: 500,
        method: 'CARD',
        destinationAccountType: 'CHECKING',
        providerPaymentId: 'STRIPE-cs_test_123456789',
        referenceNumber: 'STRIPE-cs_test_123456789',
      },
      deps
    );
    assert.strictEqual(depRes.success, true);
    assert.strictEqual(depRes.isDuplicate, false);
    assert.strictEqual(depRes.transaction?.status, 'COMPLETED');
    assert.strictEqual(depRes.balanceMetrics?.checkingBalance, 600);

    const depTxId = depRes.transaction!.id;
    const depOutboxId = computeNotificationOutboxId('uid_dep_3db1', `${depTxId}:COMPLETED`, 'MONEY_RECEIVED');
    const depOutboxSnap = await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(depOutboxId).get();
    assert.strictEqual(depOutboxSnap.exists, true);
    const depOutbox = depOutboxSnap.data()!;
    assert.strictEqual(depOutbox.transactionId, depTxId);
    assert.strictEqual(depOutbox.referenceNumber, 'STRIPE-cs_test_123456789');
    assert.strictEqual(depOutbox.eventKey, `${depTxId}:COMPLETED`);
    assert.strictEqual(depOutbox.lifecycleStage, 'COMPLETED');
    assert.strictEqual(depOutbox.dispatchType, 'MONEY_RECEIVED');
    assert.strictEqual(depOutbox.payload.amount, 500);
    assert.strictEqual(JSON.stringify(depOutbox).includes('1088492003'), false);

    // Default generated 9-digit MV-DEP-######### reference must NOT fail invalidItems
    const depRandomRefRes = await executeServerDeposit(
      {
        userId: 'uid_dep_3db1',
        amount: 250,
        method: 'ACH',
        destinationAccountType: 'SAVINGS',
      },
      deps
    );
    assert.strictEqual(depRandomRefRes.success, true);
    assert.match(depRandomRefRes.transaction!.referenceNumber, /^MV-DEP-\d{9}$/);
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 2);

    // Duplicate Stripe webhook replay preserves existing PROCESSING state and adds 0 outbox docs
    await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(depOutboxId).set(
      { ...depOutbox, status: 'PROCESSING', leaseToken: 'lease_keep' }
    );
    const dupDepRes = await executeServerDeposit(
      {
        userId: 'uid_dep_3db1',
        amount: 500,
        method: 'CARD',
        providerPaymentId: 'STRIPE-cs_test_123456789',
        referenceNumber: 'STRIPE-cs_test_123456789',
      },
      deps
    );
    assert.strictEqual(dupDepRes.success, true);
    assert.strictEqual(dupDepRes.isDuplicate, true);
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 2);
    assert.strictEqual(
      (await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(depOutboxId).get()).data()?.leaseToken,
      'lease_keep'
    );

    // Invalid deposit creates zero outbox records
    const badDepRes = await executeServerDeposit({ userId: 'uid_dep_3db1', amount: -25 }, deps);
    assert.strictEqual(badDepRes.success, false);
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 2);

    console.log('✓ Test 23 passed: executeServerDeposit creates MONEY_RECEIVED :COMPLETED outbox record atomically, handles 9-digit refs & replays safely');
  }

  // -------------------------------------------------------------------------
  // TEST 24 & 25 [3D-B1.1]: executeServerWithdrawal (:INITIATED) + reverseServerFirestoreWithdrawal (:REVERSED)
  // - Withdrawal creates :INITIATED (never :COMPLETED), strips full PAN/CVV/expiry/routing/untrusted label
  // - Reversal creates exactly one :REVERSED on same transactionId when actually reversed
  // - Replay & invalid reversals create zero additional outbox docs
  // -------------------------------------------------------------------------
  {
    const fsMem = new StrictInMemoryFirestore();
    const deps = { firestore: fsMem as unknown as Firestore, isAdminConfigured: () => true };

    await fsMem.collection('users').doc('uid_wth_3db1').set({
      id: 'uid_wth_3db1',
      firstName: 'David',
      lastName: 'Withdrawer',
      permanentAccountNumber: '1088492004',
      status: 'active',
    });
    await fsMem.collection('accounts').doc('uid_wth_3db1').set({
      userId: 'uid_wth_3db1',
      permanentAccountNumber: '1088492004',
      checkingBalance: 800,
      savingsBalance: 0,
      investedBalance: 0,
      accruedEarnings: 0,
      totalBalance: 800,
      availableBalance: 800,
      pendingBalance: 0,
    });

    const wthRes = await executeServerWithdrawal(
      {
        userId: 'uid_wth_3db1',
        amount: 120,
        sourceAccountType: 'CHECKING',
        destinationType: 'CARD',
        destinationLabel: 'Visa Debit 4111111111114242 SpoofedCompleted',
        accountOrIban: '4111111111114242',
        cardBrand: 'VISA',
        routingNumber: '021000021',
        cardHolder: 'David Spoof',
        cardExpiry: '12/29',
        cardCvv: '999',
        referenceNumber: 'MV-WTH-123456789',
      },
      deps
    );
    assert.strictEqual(wthRes.success, true);
    assert.strictEqual(wthRes.transaction?.status, 'PENDING');
    assert.strictEqual(wthRes.balanceMetrics?.checkingBalance, 680);

    const wthTxId = wthRes.transaction!.id;
    const initEventKey = buildTransactionLifecycleEventKey(wthTxId, 'INITIATED');
    const initOutboxId = computeNotificationOutboxId('uid_wth_3db1', initEventKey, 'TRANSACTION');

    const initSnap = await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(initOutboxId).get();
    assert.strictEqual(initSnap.exists, true);
    const initDoc = initSnap.data()!;
    assert.strictEqual(initDoc.transactionId, wthTxId);
    assert.strictEqual(initDoc.referenceNumber, 'MV-WTH-123456789');
    assert.strictEqual(initDoc.eventKey, `${wthTxId}:INITIATED`);
    assert.strictEqual(initDoc.lifecycleStage, 'INITIATED');
    assert.strictEqual(initDoc.dispatchType, 'TRANSACTION');
    assert.strictEqual(String(initDoc.payload.title).toLowerCase().includes('completed'), false);
    assert.strictEqual(String(initDoc.payload.body).toLowerCase().includes('completed'), false);
    assert.strictEqual(String(initDoc.payload.body).toLowerCase().includes('initiated'), true);
    assert.strictEqual(/\b\d{8,}\b/.test(String(initDoc.payload.body || '')), false);

    // Ensure ZERO sensitive card/bank PII leaked into outbox doc
    const serializedInit = JSON.stringify(initDoc);
    assert.strictEqual(serializedInit.includes('4111111111114242'), false);
    assert.strictEqual(serializedInit.includes('4111 1111'), false);
    assert.strictEqual(serializedInit.includes('1088492004'), false);
    assert.strictEqual(serializedInit.includes('021000021'), false);
    assert.strictEqual(serializedInit.includes('12/29'), false);
    assert.strictEqual(serializedInit.includes('999'), false);
    assert.strictEqual(serializedInit.includes('SpoofedCompleted'), false);

    // Duplicate withdrawal reference creates 0 extra outbox records
    const dupWthRes = await executeServerWithdrawal(
      {
        userId: 'uid_wth_3db1',
        amount: 120,
        sourceAccountType: 'CHECKING',
        destinationType: 'CARD',
        destinationLabel: 'Visa Debit',
        accountOrIban: '4111111111114242',
        referenceNumber: 'MV-WTH-123456789',
      },
      deps
    );
    assert.strictEqual(dupWthRes.success, true);
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 1);

    // Failed withdrawal (insufficient funds) creates 0 extra outbox records
    const failWthRes = await executeServerWithdrawal(
      {
        userId: 'uid_wth_3db1',
        amount: 50000,
        sourceAccountType: 'CHECKING',
        destinationType: 'CARD',
        destinationLabel: 'Visa Debit',
        accountOrIban: '4111111111114242',
        referenceNumber: 'MV-WTH-FAIL-123456789',
      },
      deps
    );
    assert.strictEqual(failWthRes.success, false);
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 1);

    // Actual reversal produces exactly one :REVERSED event sharing wthTxId
    const revRes = await reverseServerFirestoreWithdrawal(wthTxId, 'uid_wth_3db1', deps);
    assert.strictEqual(revRes.success, true);
    assert.strictEqual(revRes.transaction?.status, 'REVERSED');
    assert.strictEqual(revRes.balanceMetrics?.checkingBalance, 800);

    const revEventKey = buildTransactionLifecycleEventKey(wthTxId, 'REVERSED');
    const revOutboxId = computeNotificationOutboxId('uid_wth_3db1', revEventKey, 'TRANSACTION');
    assert.notStrictEqual(revOutboxId, initOutboxId);

    const outboxAfterRev = await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get();
    assert.strictEqual(outboxAfterRev.size, 2, 'Both :INITIATED and :REVERSED outbox records must coexist');

    const revSnap = await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(revOutboxId).get();
    assert.strictEqual(revSnap.exists, true);
    const revDoc = revSnap.data()!;
    assert.strictEqual(revDoc.transactionId, wthTxId);
    assert.strictEqual(revDoc.referenceNumber, 'MV-WTH-123456789');
    assert.strictEqual(revDoc.eventKey, `${wthTxId}:REVERSED`);
    assert.strictEqual(revDoc.lifecycleStage, 'REVERSED');
    assert.strictEqual(revDoc.dispatchType, 'TRANSACTION');
    assert.strictEqual(/\b\d{8,}\b/.test(String(revDoc.payload.body || '')), false);
    assert.strictEqual(JSON.stringify(revDoc).includes('1088492004'), false);

    // Re-running reversal on already-reversed transaction must NOT create any duplicate outbox record
    const dupRevRes = await reverseServerFirestoreWithdrawal(wthTxId, 'uid_wth_3db1', deps);
    assert.strictEqual(dupRevRes.success, true);
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 2);

    // Attempting reversal on non-PENDING completed transaction creates 0 outbox records
    await fsMem.collection('transactions').doc('tx_completed_non_pending').set({
      id: 'tx_completed_non_pending',
      referenceNumber: 'MV-WTH-COMPLETED-1',
      type: 'WITHDRAWAL',
      status: 'COMPLETED',
      amount: 50,
      userId: 'uid_wth_3db1',
    });
    const nonPendRev = await reverseServerFirestoreWithdrawal('tx_completed_non_pending', 'uid_wth_3db1', deps);
    assert.strictEqual(nonPendRev.success, false);
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 2);

    console.log('✓ Tests 24-25 passed: executeServerWithdrawal (:INITIATED) and reverseServerFirestoreWithdrawal (:REVERSED) enforce PII masking, lifecycle separation, and duplicate protection');
  }

  // -------------------------------------------------------------------------
  // TEST 26 [3D-B1.2]: executeServerAdminTransfer transactional outbox integration
  // - Strict read-before-write compliance
  // - Single recipient MONEY_RECEIVED :COMPLETED outbox record (admin sender never gets customer outbox record)
  // - Protects DISPATCHED records & ignores duplicates/invalid/rejected transfers
  // - Atomic rollback on transaction commit failure
  // - Excludes full account numbers, emails, phones, and unmasked 8+ digit body identifiers
  // -------------------------------------------------------------------------
  {
    const fsMem = new StrictInMemoryFirestore();
    const deps = { firestore: fsMem as unknown as Firestore, isAdminConfigured: () => true };

    await fsMem.collection('users').doc('uid_adm_recip_3db12').set({
      id: 'uid_adm_recip_3db12',
      firstName: 'Elena',
      lastName: 'Vance',
      permanentAccountNumber: '1099881122',
      email: 'elena.private@monvera.test',
      phone: '+15551239999',
      status: 'active',
    });
    await fsMem.collection('accounts').doc('uid_adm_recip_3db12').set({
      userId: 'uid_adm_recip_3db12',
      permanentAccountNumber: '1099881122',
      checkingBalance: 250,
      savingsBalance: 0,
      investedBalance: 0,
      accruedEarnings: 0,
      totalBalance: 250,
      availableBalance: 250,
      pendingBalance: 0,
    });
    await fsMem.collection('accounts').doc('usr_admin').set({
      userId: 'usr_admin',
      checkingBalance: 50000,
      availableBalance: 50000,
      totalBalance: 50000,
    });

    const admRes = await executeServerAdminTransfer(
      {
        adminId: 'usr_admin',
        targetIdentifier: 'uid_adm_recip_3db12',
        amount: 750,
        referenceNumber: 'MV-ADM-2026-123456789',
        clientRequestId: 'req_adm_123456789',
        description: 'Stage 3D-B1.2 Treasury Disbursement',
      },
      deps
    );
    assert.strictEqual(admRes.success, true);
    assert.strictEqual(admRes.isDuplicate, false);
    assert.strictEqual(admRes.transaction?.status, 'COMPLETED');
    assert.strictEqual(admRes.targetBalanceMetrics?.checkingBalance, 1000);

    const admTxId = admRes.transaction!.id;
    const expectedOutboxId = computeNotificationOutboxId(
      'uid_adm_recip_3db12',
      `${admTxId}:COMPLETED`,
      'MONEY_RECEIVED'
    );
    const admOutboxSnap = await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get();
    assert.strictEqual(admOutboxSnap.size, 1, 'Admin transfer must create exactly 1 recipient outbox record');

    const recipOutboxDoc = admOutboxSnap.docs[0].data()!;
    assert.strictEqual(admOutboxSnap.docs[0].id, expectedOutboxId);
    assert.strictEqual(recipOutboxDoc.userId, 'uid_adm_recip_3db12');
    assert.strictEqual(recipOutboxDoc.transactionId, admTxId);
    assert.strictEqual(recipOutboxDoc.referenceNumber, 'MV-ADM-2026-123456789');
    assert.strictEqual(recipOutboxDoc.eventKey, `${admTxId}:COMPLETED`);
    assert.strictEqual(recipOutboxDoc.lifecycleStage, 'COMPLETED');
    assert.strictEqual(recipOutboxDoc.dispatchType, 'MONEY_RECEIVED');
    assert.strictEqual(recipOutboxDoc.status, 'PENDING');
    assert.strictEqual(recipOutboxDoc.payload.amount, 750);
    assert.strictEqual(recipOutboxDoc.payload.senderName, 'Bennett Johnson');
    assert.strictEqual(recipOutboxDoc.payload.body, undefined);

    // Ensure admin sender has NO customer outbox record and zero sensitive fields leaked
    assert.strictEqual(
      admOutboxSnap.docs.some((d) => d.data().userId === 'usr_admin'),
      false,
      'Admin sender must never receive a customer outbox record'
    );
    const serializedAdm = JSON.stringify(recipOutboxDoc);
    assert.strictEqual(serializedAdm.includes('1099881122'), false);
    assert.strictEqual(serializedAdm.includes('1000000001'), false);
    assert.strictEqual(serializedAdm.includes('elena.private@monvera.test'), false);
    assert.strictEqual(serializedAdm.includes('+15551239999'), false);

    // Existing DISPATCHED record must remain untouched on duplicate replay
    await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(expectedOutboxId).set({
      ...recipOutboxDoc,
      status: 'DISPATCHED',
      pushStatus: 'SENT',
    });

    const dupAdmRes = await executeServerAdminTransfer(
      {
        adminId: 'usr_admin',
        targetIdentifier: 'uid_adm_recip_3db12',
        amount: 750,
        referenceNumber: 'MV-ADM-2026-123456789',
      },
      deps
    );
    assert.strictEqual(dupAdmRes.success, true);
    assert.strictEqual(dupAdmRes.isDuplicate, true);
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 1);
    assert.strictEqual(
      (await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(expectedOutboxId).get()).data()?.status,
      'DISPATCHED'
    );

    // Failed/invalid admin transfer writes ZERO outbox records
    const badAdmRes = await executeServerAdminTransfer(
      { adminId: 'usr_admin', targetIdentifier: 'uid_nonexistent_3db12', amount: 100 },
      deps
    );
    assert.strictEqual(badAdmRes.success, false);
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 1);

    // Simulated transaction commit failure rolls back BOTH balance/ledger and outbox atomically
    fsMem.failNextTransactionWrite = true;
    const rollbackAdmRes = await executeServerAdminTransfer(
      {
        adminId: 'usr_admin',
        targetIdentifier: 'uid_adm_recip_3db12',
        amount: 200,
        referenceNumber: 'MV-ADM-2026-ROLLBACK1',
      },
      deps
    );
    assert.strictEqual(rollbackAdmRes.success, false);
    assert.strictEqual(
      (await fsMem.collection('accounts').doc('uid_adm_recip_3db12').get()).data()?.checkingBalance,
      1000
    );
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 1);

    console.log('✓ Test 26 passed: executeServerAdminTransfer creates 1 recipient MONEY_RECEIVED outbox record, excludes admin sender, and rolls back atomically');
  }

  // -------------------------------------------------------------------------
  // TEST 27 [3D-B1.2]: executeServerLoanDisbursement transactional outbox integration
  // - Strict read-before-write compliance
  // - Single MONEY_RECEIVED :COMPLETED record using deterministic txId & MVB-LN-${loanId}
  // - Repeated disbursement, rejected/non-pending, and rollback failure produce zero extra outbox docs
  // -------------------------------------------------------------------------
  {
    const fsMem = new StrictInMemoryFirestore();
    const deps = { firestore: fsMem as unknown as Firestore, isAdminConfigured: () => true };

    const loanId = 'loan_88442211'; // includes 8-digit token in ID/reference
    await fsMem.collection('accounts').doc('uid_loan_3db12').set({
      userId: 'uid_loan_3db12',
      permanentAccountNumber: '1077665544',
      checkingBalance: 400,
      savingsBalance: 0,
      investedBalance: 0,
      accruedEarnings: 0,
      totalBalance: 400,
      availableBalance: 400,
      pendingBalance: 0,
      loanBalance: 0,
      creditedLoans: [],
    });
    await fsMem.collection('loans').doc(loanId).set({
      id: loanId,
      userId: 'uid_loan_3db12',
      applicantName: 'Marcus Vance',
      applicantEmail: 'marcus.private@monvera.test',
      applicantPhone: '+15550008888',
      permanentAccountNumber: '1077665544',
      amount: 2500,
      termMonths: 12,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    });

    const loanRes = await executeServerLoanDisbursement({ loanId, adminId: 'usr_admin' }, deps);
    assert.strictEqual(loanRes.success, true);
    assert.strictEqual(loanRes.isDuplicate, false);
    assert.strictEqual(loanRes.loan?.status, 'ACTIVE');
    assert.strictEqual(loanRes.balanceMetrics?.checkingBalance, 2900);
    assert.strictEqual(loanRes.balanceMetrics?.loanBalance, 3000);
    assert.strictEqual(loanRes.transaction?.id, `tx_loan_disb_${loanId}`);
    assert.strictEqual(loanRes.transaction?.referenceNumber, `MVB-LN-${loanId}`);

    const loanOutboxId = computeNotificationOutboxId(
      'uid_loan_3db12',
      `tx_loan_disb_${loanId}:COMPLETED`,
      'MONEY_RECEIVED'
    );
    const loanOutboxSnap = await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get();
    assert.strictEqual(loanOutboxSnap.size, 1);

    const loanOutboxDoc = loanOutboxSnap.docs[0].data()!;
    assert.strictEqual(loanOutboxSnap.docs[0].id, loanOutboxId);
    assert.strictEqual(loanOutboxDoc.userId, 'uid_loan_3db12');
    assert.strictEqual(loanOutboxDoc.transactionId, `tx_loan_disb_${loanId}`);
    assert.strictEqual(loanOutboxDoc.referenceNumber, `MVB-LN-${loanId}`);
    assert.strictEqual(loanOutboxDoc.eventKey, `tx_loan_disb_${loanId}:COMPLETED`);
    assert.strictEqual(loanOutboxDoc.lifecycleStage, 'COMPLETED');
    assert.strictEqual(loanOutboxDoc.dispatchType, 'MONEY_RECEIVED');
    assert.strictEqual(loanOutboxDoc.payload.amount, 2500);
    assert.strictEqual(loanOutboxDoc.payload.body, undefined);

    const serializedLoan = JSON.stringify(loanOutboxDoc);
    assert.strictEqual(serializedLoan.includes('1077665544'), false);
    assert.strictEqual(serializedLoan.includes('marcus.private@monvera.test'), false);
    assert.strictEqual(serializedLoan.includes('+15550008888'), false);

    // Mark outbox PROCESSING & verify repeated disbursement creates zero additional records and preserves PROCESSING
    await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(loanOutboxId).set({
      ...loanOutboxDoc,
      status: 'PROCESSING',
      leaseToken: 'loan_lease_keep',
    });
    const dupLoanRes = await executeServerLoanDisbursement({ loanId, adminId: 'usr_admin' }, deps);
    assert.strictEqual(dupLoanRes.success, true);
    assert.strictEqual(dupLoanRes.isDuplicate, true);
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 1);
    assert.strictEqual(
      (await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(loanOutboxId).get()).data()?.leaseToken,
      'loan_lease_keep'
    );

    // Rejected loan creates zero outbox records
    await fsMem.collection('loans').doc('loan_rejected_1').set({
      id: 'loan_rejected_1',
      userId: 'uid_loan_3db12',
      amount: 1000,
      termMonths: 12,
      status: 'REJECTED',
    });
    const rejLoanRes = await executeServerLoanDisbursement({ loanId: 'loan_rejected_1', adminId: 'usr_admin' }, deps);
    assert.strictEqual(rejLoanRes.success, false);
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 1);

    // Simulated commit failure rolls back loan, balance, ledger, and outbox atomically
    await fsMem.collection('loans').doc('loan_rollback_1').set({
      id: 'loan_rollback_1',
      userId: 'uid_loan_3db12',
      applicantName: 'Marcus Vance',
      amount: 500,
      termMonths: 12,
      status: 'PENDING',
    });
    fsMem.failNextTransactionWrite = true;
    const rbLoanRes = await executeServerLoanDisbursement({ loanId: 'loan_rollback_1', adminId: 'usr_admin' }, deps);
    assert.strictEqual(rbLoanRes.success, false);
    assert.strictEqual((await fsMem.collection('loans').doc('loan_rollback_1').get()).data()?.status, 'PENDING');
    assert.strictEqual((await fsMem.collection('accounts').doc('uid_loan_3db12').get()).data()?.checkingBalance, 2900);
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 1);

    console.log('✓ Test 27 passed: executeServerLoanDisbursement writes 1 MONEY_RECEIVED outbox record, enforces creditedLoans/status checks, and rolls back atomically');
  }

  // -------------------------------------------------------------------------
  // TEST 28 [3D-B1.2]: executeServerInvestmentMaturity transactional outbox integration
  // - Strict read-before-write compliance
  // - Single INVESTMENT :COMPLETED outbox record on maturity settlement
  // - Repeated maturity, early maturity rejection, unauthorized user, and rollback failure create zero extra outbox docs
  // - Zero sensitive fields or unmasked 8+ digit body strings
  // -------------------------------------------------------------------------
  {
    const fsMem = new StrictInMemoryFirestore();
    const deps = { firestore: fsMem as unknown as Firestore, isAdminConfigured: () => true };

    const invId = 'inv_99887766';
    const pastMaturity = new Date(Date.now() - 3_600_000).toISOString();
    const futureMaturity = new Date(Date.now() + 86_400_000).toISOString();

    await fsMem.collection('accounts').doc('uid_inv_3db12').set({
      userId: 'uid_inv_3db12',
      permanentAccountNumber: '1055443322',
      checkingBalance: 500,
      savingsBalance: 0,
      investedBalance: 1000,
      accruedEarnings: 0,
      totalBalance: 1500,
      availableBalance: 500,
      pendingBalance: 0,
      loanBalance: 0,
    });
    await fsMem.collection('investments').doc(invId).set({
      id: invId,
      userId: 'uid_inv_3db12',
      planName: 'Monvera Treasury 30D',
      amount: 1000,
      termDays: 30,
      expectedYield: 75,
      expectedMaturityValue: 1075,
      status: 'ACTIVE',
      maturityDate: pastMaturity,
      createdAt: new Date(Date.now() - 31 * 86_400_000).toISOString(),
    });
    await fsMem.collection('investments').doc('inv_early_1').set({
      id: 'inv_early_1',
      userId: 'uid_inv_3db12',
      planName: 'Monvera Early Block',
      amount: 500,
      termDays: 90,
      expectedYield: 60,
      expectedMaturityValue: 560,
      status: 'ACTIVE',
      maturityDate: futureMaturity,
    });

    // Unauthorized user or early maturity must fail with 0 outbox records
    const unauthInvRes = await executeServerInvestmentMaturity(
      { investmentId: invId, userId: 'uid_attacker_3db12' },
      deps
    );
    assert.strictEqual(unauthInvRes.success, false);
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 0);

    const earlyInvRes = await executeServerInvestmentMaturity(
      { investmentId: 'inv_early_1', userId: 'uid_inv_3db12' },
      deps
    );
    assert.strictEqual(earlyInvRes.success, false);
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 0);

    // Valid maturity settlement creates exactly one INVESTMENT :COMPLETED outbox record
    const matRes = await executeServerInvestmentMaturity(
      { investmentId: invId, userId: 'uid_inv_3db12' },
      deps
    );
    assert.strictEqual(matRes.success, true);
    assert.strictEqual(matRes.isDuplicate, false);
    assert.strictEqual(matRes.investment?.status, 'MATURED');
    assert.strictEqual(matRes.payoutAmount, 1075);
    assert.strictEqual(matRes.balanceMetrics?.checkingBalance, 1575);
    assert.strictEqual(matRes.balanceMetrics?.investedBalance, 0);
    assert.strictEqual(matRes.transaction?.referenceNumber, `MV-MAT-${invId}`);

    const matTxId = matRes.transaction!.id;
    const matOutboxId = computeNotificationOutboxId('uid_inv_3db12', `${matTxId}:COMPLETED`, 'INVESTMENT');
    const matOutboxSnap = await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get();
    assert.strictEqual(matOutboxSnap.size, 1);

    const matOutboxDoc = matOutboxSnap.docs[0].data()!;
    assert.strictEqual(matOutboxSnap.docs[0].id, matOutboxId);
    assert.strictEqual(matOutboxDoc.userId, 'uid_inv_3db12');
    assert.strictEqual(matOutboxDoc.transactionId, matTxId);
    assert.strictEqual(matOutboxDoc.referenceNumber, `MV-MAT-${invId}`);
    assert.strictEqual(matOutboxDoc.eventKey, `${matTxId}:COMPLETED`);
    assert.strictEqual(matOutboxDoc.lifecycleStage, 'COMPLETED');
    assert.strictEqual(matOutboxDoc.dispatchType, 'INVESTMENT');
    assert.strictEqual(matOutboxDoc.category, 'INVESTMENT');
    assert.strictEqual(matOutboxDoc.payload.amount, 1075);
    assert.strictEqual(matOutboxDoc.payload.body, undefined);
    assert.strictEqual(JSON.stringify(matOutboxDoc).includes('1055443322'), false);

    // Repeated maturity on MATURED investment must create ZERO additional outbox records
    const dupMatRes = await executeServerInvestmentMaturity(
      { investmentId: invId, userId: 'uid_inv_3db12' },
      deps
    );
    assert.strictEqual(dupMatRes.success, true);
    assert.strictEqual(dupMatRes.isDuplicate, true);
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 1);

    // Simulated commit failure rolls back investment, balance, ledger, and outbox atomically
    await fsMem.collection('investments').doc('inv_rollback_1').set({
      id: 'inv_rollback_1',
      userId: 'uid_inv_3db12',
      planName: 'Monvera Rollback Plan',
      amount: 200,
      termDays: 30,
      expectedYield: 15,
      expectedMaturityValue: 215,
      status: 'ACTIVE',
      maturityDate: pastMaturity,
    });
    fsMem.failNextTransactionWrite = true;
    const rbMatRes = await executeServerInvestmentMaturity(
      { investmentId: 'inv_rollback_1', userId: 'uid_inv_3db12' },
      deps
    );
    assert.strictEqual(rbMatRes.success, false);
    assert.strictEqual((await fsMem.collection('investments').doc('inv_rollback_1').get()).data()?.status, 'ACTIVE');
    assert.strictEqual((await fsMem.collection('accounts').doc('uid_inv_3db12').get()).data()?.checkingBalance, 1575);
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 1);

    console.log('✓ Test 28 passed: executeServerInvestmentMaturity writes 1 INVESTMENT :COMPLETED outbox record, blocks duplicates/early settlement, and rolls back atomically');
  }

  // -------------------------------------------------------------------------
  // TEST 29 [3D-B1.3A]: executeServerLoanRepayment transactional outbox integration
  // - Strict read-before-write compliance
  // - Single TRANSACTION :COMPLETED outbox record on partial & full payoff repayments
  // - Duplicate referenceNumber preserves existing outbox state without extra doc
  // - Failed/unauthorized/frozen/excess/rollback repayments create ZERO outbox docs
  // - Zero raw PAN/account/email/phone or 8+ digit body tokens leaked
  // -------------------------------------------------------------------------
  {
    const fsMem = new StrictInMemoryFirestore();
    const deps = { firestore: fsMem as unknown as Firestore, isAdminConfigured: () => true };

    const userId = 'uid_rep_3db13';
    const loanId = 'loan_rep_88332211';

    await fsMem.collection('users').doc(userId).set({
      id: userId,
      firstName: 'Jordan',
      lastName: 'Blake',
      permanentAccountNumber: '1099112233',
      email: 'jordan.repay.private@monvera.test',
      phone: '+15551112222',
      status: 'active',
    });
    await fsMem.collection('accounts').doc(userId).set({
      userId,
      permanentAccountNumber: '1099112233',
      checkingBalance: 1500,
      savingsBalance: 0,
      investedBalance: 0,
      accruedEarnings: 0,
      totalBalance: 1500,
      availableBalance: 1500,
      pendingBalance: 0,
      loanBalance: 1200,
    });
    await fsMem.collection('loans').doc(loanId).set({
      id: loanId,
      userId,
      applicantName: 'Jordan Blake',
      applicantEmail: 'jordan.repay.private@monvera.test',
      permanentAccountNumber: '1099112233',
      amount: 1000,
      totalRepaymentAmount: 1200,
      totalRepaid: 0,
      remainingBalance: 1200,
      termMonths: 12,
      status: 'ACTIVE',
      repaymentHistory: [],
    });

    // Unauthorized caller, excess amount, insufficient balance, and frozen account must write ZERO outbox docs
    const unauthRepRes = await executeServerLoanRepayment(
      { loanId, userId: 'uid_intruder_3db13', amount: 100 },
      deps
    );
    assert.strictEqual(unauthRepRes.success, false);
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 0);

    const excessRepRes = await executeServerLoanRepayment(
      { loanId, userId, amount: 1500 },
      deps
    );
    assert.strictEqual(excessRepRes.success, false);
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 0);

    await fsMem.collection('users').doc(userId).set({ status: 'frozen' }, { merge: true });
    const frozenRepRes = await executeServerLoanRepayment(
      { loanId, userId, amount: 100 },
      deps
    );
    assert.strictEqual(frozenRepRes.success, false);
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 0);
    await fsMem.collection('users').doc(userId).set({ status: 'active' }, { merge: true });

    // Valid partial repayment with 8+ digit referenceNumber
    const partialRef = 'MVB-RP-2026-88776655';
    const repRes = await executeServerLoanRepayment(
      { loanId, userId, amount: 400, referenceNumber: partialRef, note: 'Installment #1' },
      deps
    );
    assert.strictEqual(repRes.success, true);
    assert.strictEqual(repRes.isDuplicate, false);
    assert.strictEqual(repRes.loan?.status, 'ACTIVE');
    assert.strictEqual(repRes.remainingBalance, 800);
    assert.strictEqual(repRes.balanceMetrics?.checkingBalance, 1100);
    assert.strictEqual(repRes.balanceMetrics?.loanBalance, 800);

    const repTxId = repRes.transaction!.id;
    const expectedRepOutboxId = computeNotificationOutboxId(userId, `${repTxId}:COMPLETED`, 'TRANSACTION');
    const repOutboxSnap = await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get();
    assert.strictEqual(repOutboxSnap.size, 1);

    const repOutboxDoc = repOutboxSnap.docs[0].data()!;
    assert.strictEqual(repOutboxSnap.docs[0].id, expectedRepOutboxId);
    assert.strictEqual(repOutboxDoc.userId, userId);
    assert.strictEqual(repOutboxDoc.transactionId, repTxId);
    assert.strictEqual(repOutboxDoc.referenceNumber, partialRef);
    assert.strictEqual(repOutboxDoc.eventKey, `${repTxId}:COMPLETED`);
    assert.strictEqual(repOutboxDoc.lifecycleStage, 'COMPLETED');
    assert.strictEqual(repOutboxDoc.dispatchType, 'TRANSACTION');
    assert.strictEqual(repOutboxDoc.category, 'TRANSACTION');
    assert.strictEqual(repOutboxDoc.status, 'PENDING');
    assert.strictEqual(repOutboxDoc.payload.amount, 400);
    assert.strictEqual(repOutboxDoc.payload.actionUrl, '/dashboard?view=loans');
    assert.strictEqual(repOutboxDoc.payload.title, 'Loan Repayment Applied — Monvera');
    assert.strictEqual(
      repOutboxDoc.payload.body,
      'Your partial loan repayment of $400.00 from Checking (MVB •••• 2233) was applied. Remaining balance: $800.00.'
    );
    assert.strictEqual(/\b\d{8,}\b/.test(String(repOutboxDoc.payload.body || '')), false);

    const serializedRep = JSON.stringify(repOutboxDoc);
    assert.strictEqual(serializedRep.includes('1099112233'), false);
    assert.strictEqual(serializedRep.includes('jordan.repay.private@monvera.test'), false);
    assert.strictEqual(serializedRep.includes('+15551112222'), false);

    // Existing DISPATCHED record must remain untouched on duplicate replay
    await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(expectedRepOutboxId).set({
      ...repOutboxDoc,
      status: 'DISPATCHED',
      pushStatus: 'SENT',
    });

    const dupRepRes = await executeServerLoanRepayment(
      { loanId, userId, amount: 400, referenceNumber: partialRef },
      deps
    );
    assert.strictEqual(dupRepRes.success, true);
    assert.strictEqual(dupRepRes.isDuplicate, true);
    assert.strictEqual(dupRepRes.balanceMetrics?.checkingBalance, 1100);
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 1);
    assert.strictEqual(
      (await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(expectedRepOutboxId).get()).data()?.status,
      'DISPATCHED'
    );

    // Simulated commit failure rolls back balance, loan, ledger, and outbox atomically
    fsMem.failNextTransactionWrite = true;
    const rbRepRes = await executeServerLoanRepayment(
      { loanId, userId, amount: 200, referenceNumber: 'MVB-RP-2026-ROLLBACK1' },
      deps
    );
    assert.strictEqual(rbRepRes.success, false);
    assert.strictEqual((await fsMem.collection('accounts').doc(userId).get()).data()?.checkingBalance, 1100);
    assert.strictEqual((await fsMem.collection('loans').doc(loanId).get()).data()?.remainingBalance, 800);
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 1);

    // Full loan settlement creates a second distinct outbox record with settlement title
    const fullRepRes = await executeServerLoanRepayment(
      { loanId, userId, amount: 800, referenceNumber: 'MVB-RP-2026-FINAL99' },
      deps
    );
    assert.strictEqual(fullRepRes.success, true);
    assert.strictEqual(fullRepRes.loan?.status, 'PAID');
    assert.strictEqual(fullRepRes.remainingBalance, 0);
    assert.strictEqual(fullRepRes.balanceMetrics?.checkingBalance, 300);
    assert.strictEqual(fullRepRes.balanceMetrics?.loanBalance, 0);
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 2);

    const fullOutboxId = computeNotificationOutboxId(userId, `${fullRepRes.transaction!.id}:COMPLETED`, 'TRANSACTION');
    const fullOutboxDoc = (await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(fullOutboxId).get()).data()!;
    assert.strictEqual(fullOutboxDoc.payload.title, 'Loan Settled in Full — Monvera');
    assert.strictEqual(
      fullOutboxDoc.payload.body,
      'Your loan repayment of $800.00 from Checking (MVB •••• 2233) settled your loan in full.'
    );
    assert.strictEqual(fullOutboxDoc.payload.amount, 800);

    // Subsequent repayment on PAID loan must fail with zero extra outbox docs
    const paidRepRes = await executeServerLoanRepayment(
      { loanId, userId, amount: 50, referenceNumber: 'MVB-RP-2026-AFTERPAID' },
      deps
    );
    assert.strictEqual(paidRepRes.success, false);
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 2);

    console.log('✓ Test 29 passed: executeServerLoanRepayment writes 1 TRANSACTION :COMPLETED outbox record, protects duplicates, and rolls back atomically');
  }

  // -------------------------------------------------------------------------
  // TEST 30 [3D-B1.3A]: executeServerInvestmentCreation transactional outbox integration
  // - Strict read-before-write compliance
  // - Single INVESTMENT :COMPLETED outbox record with exact 4.5% daily yield math preserved
  // - Invalid term, < $100, insufficient funds, frozen account, duplicate, and rollback checks
  // -------------------------------------------------------------------------
  {
    const fsMem = new StrictInMemoryFirestore();
    const deps = { firestore: fsMem as unknown as Firestore, isAdminConfigured: () => true };

    const userId = 'uid_inv_cr_3db13';
    await fsMem.collection('users').doc(userId).set({
      id: userId,
      firstName: 'Nadia',
      lastName: 'Kerr',
      permanentAccountNumber: '1088776655',
      email: 'nadia.inv.private@monvera.test',
      phone: '+15553334444',
      status: 'active',
    });
    await fsMem.collection('accounts').doc(userId).set({
      userId,
      permanentAccountNumber: '1088776655',
      checkingBalance: 2500,
      savingsBalance: 0,
      investedBalance: 0,
      accruedEarnings: 0,
      totalBalance: 2500,
      availableBalance: 2500,
      pendingBalance: 0,
      loanBalance: 0,
    });

    // Invalid term, below minimum, insufficient funds, frozen account produce ZERO outbox docs
    assert.strictEqual(
      (await executeServerInvestmentCreation({ userId, termDays: 45 as any, amount: 500 }, deps)).success,
      false
    );
    assert.strictEqual(
      (await executeServerInvestmentCreation({ userId, termDays: 60, amount: 50 }, deps)).success,
      false
    );
    assert.strictEqual(
      (await executeServerInvestmentCreation({ userId, termDays: 60, amount: 5000 }, deps)).success,
      false
    );
    await fsMem.collection('users').doc(userId).set({ status: 'frozen' }, { merge: true });
    assert.strictEqual(
      (await executeServerInvestmentCreation({ userId, termDays: 60, amount: 500 }, deps)).success,
      false
    );
    await fsMem.collection('users').doc(userId).set({ status: 'active' }, { merge: true });
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 0);

    // Valid term investment creation
    const reqId = 'req_inv_3db13_99887766';
    const invRes = await executeServerInvestmentCreation(
      { userId, termDays: 60, amount: 1000, clientRequestId: reqId },
      deps
    );
    assert.strictEqual(invRes.success, true);
    assert.strictEqual(invRes.isDuplicate, false);
    assert.strictEqual(invRes.investment?.status, 'ACTIVE');
    assert.strictEqual(invRes.investment?.expectedYield, 2700); // 1000 * 0.045 * 60
    assert.strictEqual(invRes.investment?.expectedMaturityValue, 3700);
    assert.strictEqual(invRes.balanceMetrics?.checkingBalance, 1500);
    assert.strictEqual(invRes.balanceMetrics?.investedBalance, 1000);
    assert.strictEqual(invRes.balanceMetrics?.totalBalance, 2500);

    const invTxId = invRes.transaction!.id;
    const expectedInvOutboxId = computeNotificationOutboxId(userId, `${invTxId}:COMPLETED`, 'INVESTMENT');
    const invOutboxSnap = await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get();
    assert.strictEqual(invOutboxSnap.size, 1);

    const invOutboxDoc = invOutboxSnap.docs[0].data()!;
    assert.strictEqual(invOutboxSnap.docs[0].id, expectedInvOutboxId);
    assert.strictEqual(invOutboxDoc.userId, userId);
    assert.strictEqual(invOutboxDoc.transactionId, invTxId);
    assert.strictEqual(invOutboxDoc.referenceNumber, reqId);
    assert.strictEqual(invOutboxDoc.eventKey, `${invTxId}:COMPLETED`);
    assert.strictEqual(invOutboxDoc.lifecycleStage, 'COMPLETED');
    assert.strictEqual(invOutboxDoc.dispatchType, 'INVESTMENT');
    assert.strictEqual(invOutboxDoc.category, 'INVESTMENT');
    assert.strictEqual(invOutboxDoc.status, 'PENDING');
    assert.strictEqual(invOutboxDoc.payload.amount, 1000);
    assert.strictEqual(invOutboxDoc.payload.actionUrl, '/dashboard?view=investments');
    assert.strictEqual(invOutboxDoc.payload.title, 'Term Investment Activated — Monvera');
    assert.strictEqual(
      invOutboxDoc.payload.body,
      'Your 60-day term investment of $1,000.00 from Checking (MVB •••• 6655) has been activated.'
    );
    assert.strictEqual(/\b\d{8,}\b/.test(String(invOutboxDoc.payload.body || '')), false);

    const serializedInv = JSON.stringify(invOutboxDoc);
    assert.strictEqual(serializedInv.includes('1088776655'), false);
    assert.strictEqual(serializedInv.includes('nadia.inv.private@monvera.test'), false);
    assert.strictEqual(serializedInv.includes('+15553334444'), false);

    // Mark outbox PROCESSING & verify duplicate clientRequestId preserves PROCESSING without re-debiting
    await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(expectedInvOutboxId).set({
      ...invOutboxDoc,
      status: 'PROCESSING',
      leaseToken: 'inv_create_lease_keep',
    });
    const dupInvRes = await executeServerInvestmentCreation(
      { userId, termDays: 60, amount: 1000, clientRequestId: reqId },
      deps
    );
    assert.strictEqual(dupInvRes.success, true);
    assert.strictEqual(dupInvRes.isDuplicate, true);
    assert.strictEqual(dupInvRes.balanceMetrics?.checkingBalance, 1500);
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 1);
    assert.strictEqual(
      (await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(expectedInvOutboxId).get()).data()?.leaseToken,
      'inv_create_lease_keep'
    );

    // Simulated commit failure rolls back investment, balance, ledger, notification, and outbox atomically
    fsMem.failNextTransactionWrite = true;
    const rbInvRes = await executeServerInvestmentCreation(
      { userId, termDays: 90, amount: 500, clientRequestId: 'req_inv_3db13_rollback' },
      deps
    );
    assert.strictEqual(rbInvRes.success, false);
    assert.strictEqual((await fsMem.collection('accounts').doc(userId).get()).data()?.checkingBalance, 1500);
    assert.strictEqual((await fsMem.collection('accounts').doc(userId).get()).data()?.investedBalance, 1000);
    assert.strictEqual((await fsMem.collection('investments').get()).size, 1);
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 1);

    console.log('✓ Test 30 passed: executeServerInvestmentCreation writes 1 INVESTMENT :COMPLETED outbox record, preserves yield/idempotency, and rolls back atomically');
  }

  // -------------------------------------------------------------------------
  // TEST 31 [3D-B1.3A]: executeServerCardIssuance transactional outbox integration & PCI/PII scrubbing
  // - Strict read-before-write compliance
  // - Deducts exact $2.00 fee and writes 1 TRANSACTION :COMPLETED outbox record
  // - Zero PAN, CVV, expiry, PIN, phone, tokens, or unmasked account numbers in outbox record
  // - Insufficient funds, frozen account, duplicate clientRequestId, and rollback checks
  // -------------------------------------------------------------------------
  {
    const fsMem = new StrictInMemoryFirestore();
    const deps = { firestore: fsMem as unknown as Firestore, isAdminConfigured: () => true };

    const userId = 'uid_crd_3db13';
    await fsMem.collection('users').doc(userId).set({
      id: userId,
      firstName: 'Avery',
      lastName: 'Quinn',
      permanentAccountNumber: '1066554433',
      email: 'avery.card.private@monvera.test',
      phone: '+15556667777',
      status: 'active',
    });
    await fsMem.collection('accounts').doc(userId).set({
      userId,
      permanentAccountNumber: '1066554433',
      checkingBalance: 1.50,
      savingsBalance: 0,
      investedBalance: 0,
      accruedEarnings: 0,
      totalBalance: 1.50,
      availableBalance: 1.50,
      pendingBalance: 0,
      loanBalance: 0,
    });

    // Insufficient funds (< $2.00) must create ZERO outbox records
    const lowFundsRes = await executeServerCardIssuance(
      { userId, cardHolderName: 'Avery Quinn', brand: 'MASTERCARD', clientRequestId: 'req_crd_low_1' },
      deps
    );
    assert.strictEqual(lowFundsRes.success, false);
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 0);

    // Fund account & verify frozen account also writes ZERO outbox records
    await fsMem.collection('accounts').doc(userId).set(
      {
        checkingBalance: 100,
        totalBalance: 100,
        availableBalance: 100,
      },
      { merge: true }
    );
    await fsMem.collection('users').doc(userId).set({ status: 'frozen' }, { merge: true });
    const frozenCrdRes = await executeServerCardIssuance(
      { userId, cardHolderName: 'Avery Quinn', brand: 'MASTERCARD', clientRequestId: 'req_crd_frozen_1' },
      deps
    );
    assert.strictEqual(frozenCrdRes.success, false);
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 0);
    await fsMem.collection('users').doc(userId).set({ status: 'active' }, { merge: true });

    // Valid card issuance ($2.00 fee)
    const crdReqId = 'req_crd_3db13_11223344';
    const crdRes = await executeServerCardIssuance(
      {
        userId,
        cardHolderName: 'Avery Quinn',
        phone: '+15556667777',
        cardType: 'VIRTUAL',
        brand: 'MASTERCARD',
        clientRequestId: crdReqId,
      },
      deps
    );
    assert.strictEqual(crdRes.success, true);
    assert.strictEqual(crdRes.isDuplicate, false);
    assert.strictEqual(crdRes.transaction?.type, 'FEE');
    assert.strictEqual(crdRes.transaction?.amount, 2);
    assert.strictEqual(crdRes.balanceMetrics?.checkingBalance, 98);
    assert.strictEqual(crdRes.balanceMetrics?.totalBalance, 98);

    const crdTxId = crdRes.transaction!.id;
    const expectedCrdOutboxId = computeNotificationOutboxId(userId, `${crdTxId}:COMPLETED`, 'TRANSACTION');
    const crdOutboxSnap = await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get();
    assert.strictEqual(crdOutboxSnap.size, 1);

    const crdOutboxDoc = crdOutboxSnap.docs[0].data()!;
    assert.strictEqual(crdOutboxSnap.docs[0].id, expectedCrdOutboxId);
    assert.strictEqual(crdOutboxDoc.userId, userId);
    assert.strictEqual(crdOutboxDoc.transactionId, crdTxId);
    assert.strictEqual(crdOutboxDoc.referenceNumber, crdReqId);
    assert.strictEqual(crdOutboxDoc.eventKey, `${crdTxId}:COMPLETED`);
    assert.strictEqual(crdOutboxDoc.lifecycleStage, 'COMPLETED');
    assert.strictEqual(crdOutboxDoc.dispatchType, 'TRANSACTION');
    assert.strictEqual(crdOutboxDoc.category, 'TRANSACTION');
    assert.strictEqual(crdOutboxDoc.payload.amount, 2);
    assert.strictEqual(crdOutboxDoc.payload.title, 'Mastercard Card Issued — Monvera');
    assert.strictEqual(crdOutboxDoc.payload.actionUrl, '/dashboard?view=cards');
    assert.strictEqual(
      crdOutboxDoc.payload.body,
      'Your new Mastercard card has been issued. A $2.00 card issuance fee was debited from Checking (MVB •••• 4433).'
    );
    assert.strictEqual(/\b\d{8,}\b/.test(String(crdOutboxDoc.payload.body || '')), false);

    // Strict PCI/PII verification on serialized outbox document
    const serializedCrd = JSON.stringify(crdOutboxDoc);
    const issuedCard = crdRes.card!;
    const rawPanDigits = issuedCard.cardNumber.replace(/\s+/g, '');
    assert.strictEqual(serializedCrd.includes(issuedCard.cardNumber), false);
    assert.strictEqual(serializedCrd.includes(rawPanDigits), false);
    assert.strictEqual(serializedCrd.includes(issuedCard.fullNumberMasked), false);
    assert.strictEqual(serializedCrd.includes(issuedCard.maskedNumber), false);
    assert.strictEqual(serializedCrd.includes(issuedCard.expiryDate), false);
    assert.strictEqual(/\b\d{12,19}\b/.test(serializedCrd), false, 'Outbox must never contain PAN digit sequences');
    assert.strictEqual('cvvMasked' in crdOutboxDoc.payload, false);
    assert.strictEqual('expiryDate' in crdOutboxDoc.payload, false);
    assert.strictEqual('cardNumber' in crdOutboxDoc.payload, false);
    assert.strictEqual(serializedCrd.includes('1066554433'), false);
    assert.strictEqual(serializedCrd.includes('avery.card.private@monvera.test'), false);
    assert.strictEqual(serializedCrd.includes('+15556667777'), false);
    assert.strictEqual(serializedCrd.includes('AVERY QUINN'), false);

    // Existing DISPATCHED outbox record must remain untouched on duplicate replay
    await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(expectedCrdOutboxId).set({
      ...crdOutboxDoc,
      status: 'DISPATCHED',
      pushStatus: 'SENT',
    });
    const dupCrdRes = await executeServerCardIssuance(
      { userId, cardHolderName: 'Avery Quinn', brand: 'MASTERCARD', clientRequestId: crdReqId },
      deps
    );
    assert.strictEqual(dupCrdRes.success, true);
    assert.strictEqual(dupCrdRes.isDuplicate, true);
    assert.strictEqual(dupCrdRes.card?.id, issuedCard.id);
    assert.strictEqual(dupCrdRes.balanceMetrics?.checkingBalance, 98);
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 1);
    assert.strictEqual(
      (await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(expectedCrdOutboxId).get()).data()?.status,
      'DISPATCHED'
    );

    // Simulated commit failure rolls back $2.00 fee, card, ledger tx, notification, and outbox atomically
    fsMem.failNextTransactionWrite = true;
    const rbCrdRes = await executeServerCardIssuance(
      { userId, cardHolderName: 'Avery Quinn', brand: 'VISA', clientRequestId: 'req_crd_rollback_1' },
      deps
    );
    assert.strictEqual(rbCrdRes.success, false);
    assert.strictEqual((await fsMem.collection('accounts').doc(userId).get()).data()?.checkingBalance, 98);
    assert.strictEqual((await fsMem.collection('cards').get()).size, 1);
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 1);

    console.log('✓ Test 31 passed: executeServerCardIssuance deducts $2.00, writes 1 scrubbed TRANSACTION :COMPLETED outbox record, protects PCI/PII, and rolls back atomically');
  }

  // -------------------------------------------------------------------------
  // TEST 32 [3D-B1.3A]: Transaction contention retries across all 3 functions
  // - Concurrent account update triggers ABORTED retry-then-commit with single deterministic artifacts
  // - Concurrent duplicate completion before retry resets transient vars cleanly and avoids double debit/outbox
  // -------------------------------------------------------------------------
  {
    const fsMem = new StrictInMemoryFirestore();
    const deps = { firestore: fsMem as unknown as Firestore, isAdminConfigured: () => true };

    const userId = 'uid_retry_3db13';
    const loanId = 'loan_retry_3db13';
    await fsMem.collection('users').doc(userId).set({
      id: userId,
      firstName: 'Morgan',
      lastName: 'Reed',
      permanentAccountNumber: '1044332211',
      status: 'active',
    });
    await fsMem.collection('accounts').doc(userId).set({
      userId,
      permanentAccountNumber: '1044332211',
      checkingBalance: 2000,
      savingsBalance: 0,
      investedBalance: 0,
      accruedEarnings: 0,
      totalBalance: 2000,
      availableBalance: 2000,
      pendingBalance: 0,
      loanBalance: 1200,
    });
    await fsMem.collection('loans').doc(loanId).set({
      id: loanId,
      userId,
      applicantName: 'Morgan Reed',
      amount: 1000,
      totalRepaymentAmount: 1200,
      totalRepaid: 0,
      remainingBalance: 1200,
      termMonths: 12,
      status: 'ACTIVE',
      repaymentHistory: [],
    });

    // Case A: Concurrent balance top-up conflicts on attempt 1 of investment creation -> retries & uses fresh checkingBalance (2500 -> 2000)
    fsMem.onBeforeCommitConflictOnce = async () => {
      const cur = (await fsMem.collection('accounts').doc(userId).get()).data()!;
      await fsMem.collection('accounts').doc(userId).set({
        ...cur,
        checkingBalance: 2500,
        availableBalance: 2500,
        totalBalance: 2500,
      });
    };
    const retryInvRes = await executeServerInvestmentCreation(
      { userId, termDays: 60, amount: 500, clientRequestId: 'req_inv_retry_1' },
      deps
    );
    assert.strictEqual(retryInvRes.success, true);
    assert.strictEqual(retryInvRes.isDuplicate, false);
    assert.strictEqual(fsMem.lastTransactionAttempts, 2, 'Investment creation should have retried after ABORTED conflict');
    assert.strictEqual(retryInvRes.balanceMetrics?.checkingBalance, 2000);
    assert.strictEqual(retryInvRes.balanceMetrics?.investedBalance, 500);
    assert.strictEqual((await fsMem.collection('investments').get()).size, 1);
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 1);

    // Case B: Concurrent balance change conflicts on attempt 1 of card issuance (without clientRequestId) -> retries deterministically
    fsMem.onBeforeCommitConflictOnce = async () => {
      const cur = (await fsMem.collection('accounts').doc(userId).get()).data()!;
      await fsMem.collection('accounts').doc(userId).set({
        ...cur,
        checkingBalance: 2100,
        availableBalance: 2100,
        totalBalance: 2600,
      });
    };
    const retryCrdRes = await executeServerCardIssuance(
      { userId, cardHolderName: 'Morgan Reed', brand: 'VISA' },
      deps
    );
    assert.strictEqual(retryCrdRes.success, true);
    assert.strictEqual(retryCrdRes.isDuplicate, false);
    assert.strictEqual(fsMem.lastTransactionAttempts, 2, 'Card issuance should have retried after ABORTED conflict');
    assert.strictEqual(retryCrdRes.balanceMetrics?.checkingBalance, 2098);
    assert.strictEqual((await fsMem.collection('cards').get()).size, 1);
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 2);

    // Case C: Attempt 1 of loan repayment computes non-duplicate writes, then another worker commits identical referenceNumber before attempt 1 commit -> attempt 2 detects duplicate & resets state cleanly
    const raceRef = 'MVB-RP-2026-RACE99';
    fsMem.onBeforeCommitConflictOnce = async () => {
      await fsMem.collection('transactions').doc('tx_race_winner').set({
        id: 'tx_race_winner',
        userId,
        type: 'TRANSFER',
        amount: 300,
        currency: 'USD',
        status: 'COMPLETED',
        referenceNumber: raceRef,
        createdAt: new Date().toISOString(),
      });
      const curAcc = (await fsMem.collection('accounts').doc(userId).get()).data()!;
      await fsMem.collection('accounts').doc(userId).set({
        ...curAcc,
        checkingBalance: 1798,
        availableBalance: 1798,
        loanBalance: 900,
      });
      const curLoan = (await fsMem.collection('loans').doc(loanId).get()).data()!;
      await fsMem.collection('loans').doc(loanId).set({
        ...curLoan,
        totalRepaid: 300,
        remainingBalance: 900,
      });
    };
    const raceRepRes = await executeServerLoanRepayment(
      { loanId, userId, amount: 300, referenceNumber: raceRef },
      deps
    );
    assert.strictEqual(raceRepRes.success, true);
    assert.strictEqual(raceRepRes.isDuplicate, true);
    assert.strictEqual(fsMem.lastTransactionAttempts, 2, 'Loan repayment should have retried and detected duplicate');
    assert.strictEqual(raceRepRes.transaction?.id, 'tx_race_winner');
    assert.strictEqual(raceRepRes.balanceMetrics?.checkingBalance, 1798);
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 2);

    console.log('✓ Test 32 passed: Contention retries across loan repayment, investment creation, and card issuance are deterministic and duplicate-safe');
  }

  // -------------------------------------------------------------------------
  // TEST 33 [3D-B1.3A.1]: End-to-end outbox -> buildDispatchEventFromOutboxRecord ->
  // ServerNotificationDispatcher.dispatch() FCM content & sanitization regression suite
  // - Verifies final FCM notification/webpush/data title & body (not just outbox records)
  // - Distinguishes partial loan repayment from full settlement & uses actualRepay
  // - Verifies term investment activation wording (without implying maturity/earned yield)
  // - Verifies card issuance $2.00 fee wording & zero PCI/PII in final FCM payload
  // - Confirms unsupported SMS/Email remain UNCONFIGURED_PROVIDER (never SENT)
  // - Verifies formatSafePushContent preserves custom title when body is omitted & redacts 8+ digits
  // - Verifies preferences, persistent deduplication, lease ownership, and retry outcomes remain intact
  // -------------------------------------------------------------------------
  {
    const fsMem = new StrictInMemoryFirestore();
    const txDeps = { firestore: fsMem as unknown as Firestore, isAdminConfigured: () => true };

    const userId = 'uid_dispatch_3db13a1';
    const loanId = 'loan_disp_3db13a1';
    const userPan = '1099887744';
    const userEmail = 'claire.dispatch.private@monvera.test';
    const userPhone = '+15559990001';
    const fcmTok = 'fcm_stage3db13a1_dispatch_tok_' + 'q'.repeat(40);

    await fsMem.collection('users').doc(userId).set({
      id: userId,
      firstName: 'Claire',
      lastName: 'Moran',
      permanentAccountNumber: userPan,
      email: userEmail,
      phone: userPhone,
      status: 'active',
    });
    await fsMem.collection('accounts').doc(userId).set({
      userId,
      permanentAccountNumber: userPan,
      checkingBalance: 5000,
      savingsBalance: 0,
      investedBalance: 0,
      accruedEarnings: 0,
      totalBalance: 5000,
      availableBalance: 5000,
      pendingBalance: 0,
      loanBalance: 1200,
    });
    await fsMem.collection('loans').doc(loanId).set({
      id: loanId,
      userId,
      applicantName: 'Claire Moran',
      applicantEmail: userEmail,
      permanentAccountNumber: userPan,
      amount: 1000,
      totalRepaymentAmount: 1200,
      totalRepaid: 0,
      remainingBalance: 1200,
      termMonths: 12,
      status: 'ACTIVE',
      repaymentHistory: [],
    });

    await registerCustomerPushToken(
      { uid: userId, token: fcmTok, platform: 'web' },
      fsMem as unknown as Firestore
    );

    const capturedFcmMessages: any[] = [];
    let smsCallCount = 0;
    let emailCallCount = 0;
    const origSms = smsService.sendTransactionSms.bind(smsService);
    const origEmail = emailService.sendTransactionalEmail.bind(emailService);
    (smsService as any).sendTransactionSms = async () => {
      smsCallCount++;
      return { success: true, delivered: true, status: 'SENT' };
    };
    (emailService as any).sendTransactionalEmail = async () => {
      emailCallCount++;
      return { success: true, delivered: true, status: 'SENT' };
    };

    try {
      const mockMessaging: Partial<Messaging> = {
        sendEachForMulticast: async (message: any) => {
          capturedFcmMessages.push(structuredClone(message));
          return {
            successCount: message.tokens.length,
            failureCount: 0,
            responses: message.tokens.map((_: string, idx: number) => ({
              success: true,
              messageId: `fcm_3db13a1_${capturedFcmMessages.length}_${idx}`,
            })),
          };
        },
      };

      const dispatcher = new ServerNotificationDispatcher({
        firestore: fsMem as unknown as Firestore,
        messaging: mockMessaging as Messaging,
        isAdminConfigured: () => true,
        isMessagingConfigured: () => true,
        instanceId: 'worker_3db13a1_regression',
      });

      const dispatchOutboxRecordAndAssert = async (outboxId: string, workerId: string) => {
        const claim = await claimOutboxLease(fsMem as unknown as Firestore, outboxId, workerId);
        assert.strictEqual(claim.claimed, true, `Failed to claim outbox ${outboxId}: ${claim.reason}`);
        const dispatchEvent = buildDispatchEventFromOutboxRecord(claim.record!, {
          email: userEmail,
          phone: userPhone,
        });
        const dispatchRes = await dispatcher.dispatch(
          dispatchEvent,
          buildOutboxDispatchOptions(claim.record!, claim.leaseToken!)
        );
        const logSnap = await fetchDispatchLogForOutboxRecord(fsMem as unknown as Firestore, claim.record!);
        const evaluated = evaluateOutboxAttemptOutcome({
          outboxRecord: claim.record!,
          dispatchResult: dispatchRes,
          persistentLog: logSnap,
        });
        assert.strictEqual(evaluated.action, 'TRANSITION');
        assert.strictEqual(evaluated.nextStatus, 'DISPATCHED');
        assert.strictEqual(evaluated.smsStatus, 'UNCONFIGURED_PROVIDER');
        assert.strictEqual(evaluated.emailStatus, 'UNCONFIGURED_PROVIDER');
        const trans = await transitionOutboxAsLeaseOwner(
          fsMem as unknown as Firestore,
          outboxId,
          claim.leaseToken!,
          () => ({
            status: evaluated.nextStatus!,
            pushStatus: evaluated.pushStatus,
            smsStatus: evaluated.smsStatus,
            emailStatus: evaluated.emailStatus,
            failureClassification: evaluated.failureClassification,
            lastError: evaluated.lastError,
            dispatchedAt: evaluated.dispatchedAt,
          })
        );
        assert.strictEqual(trans.status, 'UPDATED');
        return { dispatchRes, claimRecord: claim.record!, finalRecord: trans.record! };
      };

      // 1A. Partial loan repayment ($400.00 of $1,200.00 -> $800.00 remaining)
      const partialRes = await executeServerLoanRepayment(
        { loanId, userId, amount: 400, referenceNumber: 'MVB-RP-2026-44556677' },
        txDeps
      );
      assert.strictEqual(partialRes.success, true);
      const partialOutboxId = computeNotificationOutboxId(
        userId,
        `${partialRes.transaction!.id}:COMPLETED`,
        'TRANSACTION'
      );
      const partialDispatch = await dispatchOutboxRecordAndAssert(partialOutboxId, 'worker_loan_partial');
      assert.strictEqual(partialDispatch.dispatchRes.push.status, 'SENT');
      assert.strictEqual(partialDispatch.dispatchRes.sms.status, 'UNCONFIGURED_PROVIDER');
      assert.strictEqual(partialDispatch.dispatchRes.sms.delivered, false);
      assert.strictEqual(partialDispatch.dispatchRes.email.status, 'UNCONFIGURED_PROVIDER');
      assert.strictEqual(partialDispatch.dispatchRes.email.delivered, false);

      const fcmPartial = capturedFcmMessages[0];
      assert.strictEqual(fcmPartial.notification.title, 'Loan Repayment Applied — Monvera');
      assert.strictEqual(
        fcmPartial.notification.body,
        'Your partial loan repayment of $400.00 from Checking (MVB •••• 7744) was applied. Remaining balance: $800.00.'
      );
      assert.strictEqual(fcmPartial.webpush.notification.title, fcmPartial.notification.title);
      assert.strictEqual(fcmPartial.webpush.notification.body, fcmPartial.notification.body);
      assert.strictEqual(fcmPartial.data.title, fcmPartial.notification.title);
      assert.strictEqual(fcmPartial.data.body, fcmPartial.notification.body);
      assert.strictEqual(fcmPartial.notification.body.toLowerCase().includes('settled'), false);
      assert.strictEqual(/\b\d{8,}\b/.test(fcmPartial.notification.body), false);

      // 1B. Full loan settlement using +0.01 tolerance (requested 800.01 vs remaining 800.00 -> actualRepay = $800.00)
      const fullRes = await executeServerLoanRepayment(
        { loanId, userId, amount: 800.01, referenceNumber: 'MVB-RP-2026-88990011' },
        txDeps
      );
      assert.strictEqual(fullRes.success, true);
      assert.strictEqual(fullRes.loan?.status, 'PAID');
      assert.strictEqual(fullRes.transaction?.amount, 800);
      const fullOutboxId = computeNotificationOutboxId(
        userId,
        `${fullRes.transaction!.id}:COMPLETED`,
        'TRANSACTION'
      );
      const fullDispatch = await dispatchOutboxRecordAndAssert(fullOutboxId, 'worker_loan_full');
      assert.strictEqual(fullDispatch.dispatchRes.push.status, 'SENT');
      assert.strictEqual(fullDispatch.dispatchRes.sms.status, 'UNCONFIGURED_PROVIDER');
      assert.strictEqual(fullDispatch.dispatchRes.email.status, 'UNCONFIGURED_PROVIDER');

      const fcmFull = capturedFcmMessages[1];
      assert.strictEqual(fcmFull.notification.title, 'Loan Settled in Full — Monvera');
      assert.strictEqual(
        fcmFull.notification.body,
        'Your loan repayment of $800.00 from Checking (MVB •••• 7744) settled your loan in full.'
      );
      assert.strictEqual(fcmFull.notification.body.includes('800.01'), false, 'Body must use actualRepay ($800.00), not requested $800.01');
      assert.strictEqual(/\b\d{8,}\b/.test(fcmFull.notification.body), false);

      // 2. Term investment creation ($1,000.00, 60 days)
      const invRes = await executeServerInvestmentCreation(
        { userId, termDays: 60, amount: 1000, clientRequestId: 'req_inv_disp_99887766' },
        txDeps
      );
      assert.strictEqual(invRes.success, true);
      const invOutboxId = computeNotificationOutboxId(
        userId,
        `${invRes.transaction!.id}:COMPLETED`,
        'INVESTMENT'
      );
      const invDispatch = await dispatchOutboxRecordAndAssert(invOutboxId, 'worker_inv_create');
      assert.strictEqual(invDispatch.dispatchRes.push.status, 'SENT');
      assert.strictEqual(invDispatch.dispatchRes.sms.status, 'UNCONFIGURED_PROVIDER');
      assert.strictEqual(invDispatch.dispatchRes.sms.delivered, false);
      assert.strictEqual(invDispatch.dispatchRes.email.status, 'UNCONFIGURED_PROVIDER');
      assert.strictEqual(invDispatch.dispatchRes.email.delivered, false);

      const fcmInv = capturedFcmMessages[2];
      assert.strictEqual(fcmInv.notification.title, 'Term Investment Activated — Monvera');
      assert.strictEqual(
        fcmInv.notification.body,
        'Your 60-day term investment of $1,000.00 from Checking (MVB •••• 7744) has been activated.'
      );
      assert.strictEqual(fcmInv.webpush.notification.title, fcmInv.notification.title);
      assert.strictEqual(fcmInv.webpush.notification.body, fcmInv.notification.body);
      assert.strictEqual(fcmInv.notification.body.toLowerCase().includes('matured'), false);
      assert.strictEqual(fcmInv.notification.body.toLowerCase().includes('earned'), false);
      assert.strictEqual(/\b\d{8,}\b/.test(fcmInv.notification.body), false);

      // 3. Card issuance ($2.00 fee, Mastercard + strict PCI/PII verification on final FCM message)
      const crdRes = await executeServerCardIssuance(
        {
          userId,
          cardHolderName: 'Claire Moran',
          phone: userPhone,
          cardType: 'VIRTUAL',
          brand: 'MASTERCARD',
          clientRequestId: 'req_crd_disp_11223344',
        },
        txDeps
      );
      assert.strictEqual(crdRes.success, true);
      const crdOutboxId = computeNotificationOutboxId(
        userId,
        `${crdRes.transaction!.id}:COMPLETED`,
        'TRANSACTION'
      );
      const crdDispatch = await dispatchOutboxRecordAndAssert(crdOutboxId, 'worker_card_issue');
      assert.strictEqual(crdDispatch.dispatchRes.push.status, 'SENT');
      assert.strictEqual(crdDispatch.dispatchRes.sms.status, 'UNCONFIGURED_PROVIDER');
      assert.strictEqual(crdDispatch.dispatchRes.sms.delivered, false);
      assert.strictEqual(crdDispatch.dispatchRes.email.status, 'UNCONFIGURED_PROVIDER');
      assert.strictEqual(crdDispatch.dispatchRes.email.delivered, false);

      const fcmCard = capturedFcmMessages[3];
      assert.strictEqual(fcmCard.notification.title, 'Mastercard Card Issued — Monvera');
      assert.strictEqual(
        fcmCard.notification.body,
        'Your new Mastercard card has been issued. A $2.00 card issuance fee was debited from Checking (MVB •••• 7744).'
      );
      assert.strictEqual(fcmCard.webpush.notification.title, fcmCard.notification.title);
      assert.strictEqual(fcmCard.webpush.notification.body, fcmCard.notification.body);
      assert.strictEqual(fcmCard.data.title, fcmCard.notification.title);
      assert.strictEqual(fcmCard.data.body, fcmCard.notification.body);

      const issuedCard = crdRes.card!;
      const serializedFcmCard = JSON.stringify({
        notification: fcmCard.notification,
        webpush: fcmCard.webpush,
        data: fcmCard.data,
      });
      const rawCardDigits = issuedCard.cardNumber.replace(/\s+/g, '');
      const cardLast4 = rawCardDigits.slice(-4);
      assert.strictEqual(serializedFcmCard.includes(issuedCard.cardNumber), false);
      assert.strictEqual(serializedFcmCard.includes(rawCardDigits), false);
      assert.strictEqual(serializedFcmCard.includes(issuedCard.fullNumberMasked), false);
      assert.strictEqual(serializedFcmCard.includes(issuedCard.maskedNumber), false);
      assert.strictEqual(serializedFcmCard.includes(cardLast4), false, 'Card issuance push must not expose even masked card last-4');
      assert.strictEqual(serializedFcmCard.includes(issuedCard.expiryDate), false);
      assert.strictEqual(serializedFcmCard.includes(userPan), false);
      assert.strictEqual(serializedFcmCard.includes(userEmail), false);
      assert.strictEqual(serializedFcmCard.includes(userPhone), false);
      assert.strictEqual(serializedFcmCard.includes('Claire Moran'), false);
      assert.strictEqual(serializedFcmCard.includes('CLAIRE MORAN'), false);
      assert.strictEqual(/\b\d{8,}\b/.test(fcmCard.notification.body), false);
      assert.strictEqual(smsCallCount, 0, 'Unsupported SMS event types must make 0 SMS provider calls');
      assert.strictEqual(emailCallCount, 0, 'Unsupported Email event types must make 0 Email provider calls');

      // 4. Formatter preservation when body is omitted & numeric-reference/control-char sanitizer check
      const titleOnlyRec = buildNotificationOutboxRecord({
        userId,
        transactionId: 'tx_title_only_inv_1',
        referenceNumber: 'MV-INV-TITLE-1',
        eventKey: 'tx_title_only_inv_1:COMPLETED',
        lifecycleStage: 'COMPLETED',
        dispatchType: 'INVESTMENT',
        category: 'INVESTMENT',
        payload: {
          title: 'Term Investment Activated — Monvera',
          amount: 750,
          currency: 'USD',
          accountMasked: 'Checking (MVB •••• 7744)',
        },
      });
      await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(titleOnlyRec.id).set(titleOnlyRec);
      await dispatchOutboxRecordAndAssert(titleOnlyRec.id, 'worker_title_only');
      const fcmTitleOnly = capturedFcmMessages[4];
      assert.strictEqual(
        fcmTitleOnly.notification.title,
        'Term Investment Activated — Monvera',
        'Custom safe title must be preserved when body is omitted'
      );
      assert.strictEqual(
        fcmTitleOnly.notification.body,
        'Investment activity of $750.00 recorded. Ref: MV-INV-TITLE-1.'
      );

      // Verify custom 8+ digit numeric identifiers & HTML/control chars are sanitized in formatSafePushContent
      await dispatcher.dispatch({
        transactionId: 'tx_sanitize_direct_1',
        referenceNumber: 'MV-SAN-1',
        type: 'TRANSACTION',
        userId,
        title: 'Account\nUpdate <script>',
        body: 'Transfer ref 998877665544 processed for $25.00\r\n',
      });
      const fcmSanitized = capturedFcmMessages[5];
      assert.strictEqual(fcmSanitized.notification.title, 'Account Update script');
      assert.strictEqual(fcmSanitized.notification.body, 'Transfer ref •••• processed for $25.00');
      assert.strictEqual(/\b\d{8,}\b/.test(fcmSanitized.notification.body), false);

      // 5. Persistent dedupe & user preference checks remain intact
      const reclaimTerminal = await claimOutboxLease(fsMem as unknown as Firestore, crdOutboxId, 'worker_reclaim_terminal');
      assert.strictEqual(reclaimTerminal.claimed, false);
      assert.strictEqual(reclaimTerminal.reason, 'ALREADY_TERMINAL');

      const dedupeReplay = await dispatcher.dispatch({
        transactionId: 'tx_sanitize_direct_1',
        referenceNumber: 'MV-SAN-1',
        type: 'TRANSACTION',
        userId,
        title: 'Account Update',
        body: 'Duplicate check',
      });
      assert.strictEqual(dedupeReplay.push.status, 'DUPLICATE_IGNORED');
      assert.strictEqual(capturedFcmMessages.length, 6, 'Duplicate dispatch must not send extra FCM message');

      await fsMem
        .collection('users')
        .doc(userId)
        .collection('notificationPreferences')
        .doc('settings')
        .set({ pushEnabled: false, smsEnabled: true, emailEnabled: true, transactionAlerts: true });
      const prefOffRes = await dispatcher.dispatch({
        transactionId: 'tx_pref_off_1',
        referenceNumber: 'MV-PREF-1',
        type: 'TRANSACTION',
        userId,
        title: 'Should Be Skipped',
        body: 'Push disabled test',
      });
      assert.strictEqual(prefOffRes.push.status, 'DISABLED_BY_USER');
      assert.strictEqual(capturedFcmMessages.length, 6, 'Disabled push preference must not invoke FCM');
    } finally {
      (smsService as any).sendTransactionSms = origSms;
      (emailService as any).sendTransactionalEmail = origEmail;
    }

    console.log('✓ Test 33 passed: End-to-end dispatch regression verified exact FCM payloads, M-1 fix, UNCONFIGURED_PROVIDER channels, zero PCI/PII, dedupe, and preferences');
  }

  // -------------------------------------------------------------------------
  // TEST 34 [3D-B1.3B]: executeServerWireCheckWithdrawal transactional outbox integration
  // - Strict read-before-write & zero live Firestore/notification usage
  // - Failed/rejected/frozen/insufficient attempts write 0 outbox docs
  // - Successful submission writes 1 TRANSACTION :SUBMITTED outbox doc
  // - Zero leakage of destination bank account, routing, address, email, phone, or 8+ digit refs
  // - Duplicate idempotency replay preserves existing outbox status without double-debit
  // - Commit failure rolls back atomically & ABORTED retry commits cleanly once
  // -------------------------------------------------------------------------
  {
    const fsMem = new StrictInMemoryFirestore();
    const auxNotifs: any[] = [];
    const auxAudits: any[] = [];
    const deps = {
      firestore: fsMem as unknown as Firestore,
      persistNotification: async (n: any) => {
        auxNotifs.push(n);
        return { ...n, read: false };
      },
      recordAuditLog: (a: any) => {
        auxAudits.push(a);
      },
    };

    const userId = 'uid_wchk_3db13b';
    const userPan = '1077889900';
    const destAcct = '987654321098';
    const destRouting = '021000021';
    const resAddress = '742 Evergreen Terrace, Austin, TX 78701';
    const custEmail = 'wchk.private@monvera.test';
    const custPhone = '+15125550199';

    await fsMem.collection('users').doc(userId).set({
      id: userId,
      firstName: 'Jordan',
      lastName: 'Ellis',
      permanentAccountNumber: userPan,
      email: custEmail,
      phone: custPhone,
      status: 'active',
    });
    await fsMem.collection('accounts').doc(userId).set({
      userId,
      permanentAccountNumber: userPan,
      checkingBalance: 3000,
      savingsBalance: 1500,
      investedBalance: 0,
      accruedEarnings: 0,
      totalBalance: 4500,
      availableBalance: 3000,
      pendingBalance: 0,
      loanBalance: 0,
    });

    const basePayload = {
      userId,
      bankName: 'Regions Bank',
      destinationBankAccountNumber: destAcct,
      destinationBankRoutingNumber: destRouting,
      fullLegalName: 'Jordan Ellis',
      residentialAddress: resAddress,
      email: custEmail,
      phoneNumber: custPhone,
      amount: 600,
      sourceAccountType: 'CHECKING' as const,
      idempotencyKey: 'wchk_idemp_invalid_1',
    };

    // Insufficient funds -> 0 outbox docs
    const lowRes = await executeServerWireCheckWithdrawal(
      { ...basePayload, amount: 5000, idempotencyKey: 'wchk_idemp_low_1' },
      deps
    );
    assert.strictEqual(lowRes.success, false);
    assert.strictEqual(lowRes.errorCode, 'INSUFFICIENT_FUNDS');
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 0);

    // Invalid routing -> 0 outbox docs
    const badRtRes = await executeServerWireCheckWithdrawal(
      { ...basePayload, destinationBankRoutingNumber: '123456789', idempotencyKey: 'wchk_idemp_badrt_1' },
      deps
    );
    assert.strictEqual(badRtRes.success, false);
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 0);

    // Frozen account -> 0 outbox docs
    await fsMem.collection('users').doc(userId).set({ status: 'frozen' }, { merge: true });
    const frozenRes = await executeServerWireCheckWithdrawal(
      { ...basePayload, idempotencyKey: 'wchk_idemp_frozen_1' },
      deps
    );
    assert.strictEqual(frozenRes.success, false);
    assert.strictEqual(frozenRes.errorCode, 'ACCOUNT_FROZEN');
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 0);
    await fsMem.collection('users').doc(userId).set({ status: 'active' }, { merge: true });

    // Valid Wire Check submission from CHECKING
    const subKey = 'wchk_idemp_valid_1';
    const subRes = await executeServerWireCheckWithdrawal(
      { ...basePayload, amount: 600, idempotencyKey: subKey },
      deps
    );
    assert.strictEqual(subRes.success, true);
    assert.strictEqual(subRes.isDuplicate, false);
    assert.strictEqual(subRes.request?.checkProcessingStatus, 'REQUESTED');
    assert.strictEqual(subRes.transaction?.type, 'WIRE_CHECK_WITHDRAWAL');
    assert.strictEqual(subRes.transaction?.status, 'COMPLETED');
    assert.strictEqual(subRes.transaction?.amount, 600);
    assert.strictEqual(subRes.balanceMetrics?.checkingBalance, 2400);
    assert.strictEqual(subRes.balanceMetrics?.savingsBalance, 1500);
    assert.strictEqual(subRes.balanceMetrics?.totalBalance, 3900);

    const wchkTxId = subRes.transaction!.id;
    const expectedSubOutboxId = computeNotificationOutboxId(userId, `${wchkTxId}:SUBMITTED`, 'TRANSACTION');
    const subOutboxSnap = await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get();
    assert.strictEqual(subOutboxSnap.size, 1);

    const subOutboxDoc = subOutboxSnap.docs[0].data()!;
    assert.strictEqual(subOutboxSnap.docs[0].id, expectedSubOutboxId);
    assert.strictEqual(subOutboxDoc.userId, userId);
    assert.strictEqual(subOutboxDoc.transactionId, wchkTxId);
    assert.strictEqual(subOutboxDoc.referenceNumber, subRes.request!.referenceNumber);
    assert.strictEqual(subOutboxDoc.eventKey, `${wchkTxId}:SUBMITTED`);
    assert.strictEqual(subOutboxDoc.lifecycleStage, 'SUBMITTED');
    assert.strictEqual(subOutboxDoc.dispatchType, 'TRANSACTION');
    assert.strictEqual(subOutboxDoc.category, 'TRANSACTION');
    assert.strictEqual(subOutboxDoc.status, 'PENDING');
    assert.strictEqual(subOutboxDoc.payload.amount, 600);
    assert.strictEqual(subOutboxDoc.payload.currency, 'USD');
    assert.strictEqual(subOutboxDoc.payload.actionUrl, '/dashboard?view=transactions');
    assert.strictEqual(subOutboxDoc.payload.title, 'Wire Check Request Submitted — Monvera');
    assert.strictEqual(
      subOutboxDoc.payload.body,
      'Your Wire Check withdrawal request for $600.00 from Checking (MVB •••• 9900) was submitted successfully.'
    );
    assert.strictEqual(subOutboxDoc.payload.body.toLowerCase().includes('delivered'), false);
    assert.strictEqual(/\b\d{8,}\b/.test(subOutboxDoc.payload.body), false);

    const serializedSub = JSON.stringify(subOutboxDoc);
    assert.strictEqual(serializedSub.includes(destAcct), false);
    assert.strictEqual(serializedSub.includes('321098'), false);
    assert.strictEqual(serializedSub.includes(destRouting), false);
    assert.strictEqual(serializedSub.includes(resAddress), false);
    assert.strictEqual(serializedSub.includes(custEmail), false);
    assert.strictEqual(serializedSub.includes(custPhone), false);
    assert.strictEqual(serializedSub.includes(userPan), false);
    assert.strictEqual(serializedSub.includes('Regions Bank'), false);

    // Duplicate idempotency replay preserves PROCESSING/DISPATCHED status and avoids double debit
    await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(expectedSubOutboxId).set({
      ...subOutboxDoc,
      status: 'DISPATCHED',
      pushStatus: 'SENT',
    });
    const dupSubRes = await executeServerWireCheckWithdrawal(
      { ...basePayload, amount: 600, idempotencyKey: subKey },
      deps
    );
    assert.strictEqual(dupSubRes.success, true);
    assert.strictEqual(dupSubRes.isDuplicate, true);
    assert.strictEqual(dupSubRes.balanceMetrics?.checkingBalance, 2400);
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 1);
    assert.strictEqual(
      (await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(expectedSubOutboxId).get()).data()?.status,
      'DISPATCHED'
    );

    // Simulated commit failure rolls back balance, tx, request, idemp, and outbox atomically
    fsMem.failNextTransactionWrite = true;
    const rbSubRes = await executeServerWireCheckWithdrawal(
      { ...basePayload, amount: 250, sourceAccountType: 'SAVINGS', idempotencyKey: 'wchk_idemp_rb_1' },
      deps
    );
    assert.strictEqual(rbSubRes.success, false);
    assert.strictEqual((await fsMem.collection('accounts').doc(userId).get()).data()?.savingsBalance, 1500);
    assert.strictEqual((await fsMem.collection('wire_check_requests').get()).size, 1);
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 1);

    // ABORTED retry contention test on SAVINGS withdrawal
    fsMem.onBeforeCommitConflictOnce = async () => {
      const cur = (await fsMem.collection('accounts').doc(userId).get()).data()!;
      await fsMem.collection('accounts').doc(userId).set({
        ...cur,
        savingsBalance: 2000,
        totalBalance: 4400,
      });
    };
    const retrySubRes = await executeServerWireCheckWithdrawal(
      { ...basePayload, amount: 300, sourceAccountType: 'SAVINGS', idempotencyKey: 'wchk_idemp_retry_1' },
      deps
    );
    assert.strictEqual(retrySubRes.success, true);
    assert.strictEqual(retrySubRes.isDuplicate, false);
    assert.strictEqual(fsMem.lastTransactionAttempts, 2);
    assert.strictEqual(retrySubRes.balanceMetrics?.savingsBalance, 1700);
    assert.strictEqual((await fsMem.collection('wire_check_requests').get()).size, 2);
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 2);
    assert.strictEqual(auxNotifs.length, 2);
    assert.strictEqual(auxAudits.length, 2);

    console.log('✓ Test 34 passed: executeServerWireCheckWithdrawal writes 1 scrubbed TRANSACTION :SUBMITTED outbox record, enforces idempotency/rollback/retry, and protects bank PII');
  }

  // -------------------------------------------------------------------------
  // TEST 35 [3D-B1.3B]: markWireCheckRequestDeliveredAdmin transactional outbox integration
  // - First valid REQUESTED -> DELIVERED transition writes 1 TRANSACTION :DELIVERED outbox doc
  // - Reuses original transactionId alongside existing :SUBMITTED outbox doc
  // - Never modifies balances or creates a second ledger transaction
  // - Invalid status / missing tx / duplicate delivery (409 ALREADY_DELIVERED) write 0 extra outbox docs
  // - Commit failure rolls back delivery + outbox atomically & ABORTED retry commits cleanly once
  // -------------------------------------------------------------------------
  {
    const fsMem = new StrictInMemoryFirestore();
    const deps = {
      firestore: fsMem as unknown as Firestore,
      persistNotification: async (n: any) => ({ ...n, read: false }),
      recordAuditLog: () => {},
    };

    const userId = 'uid_wchk_deliv_3db13b';
    const userPan = '1033445566';
    const destAcct = '554433221100';
    const destRouting = '062005690';
    const resAddress = '900 Congress Ave, Austin, TX 78701';

    await fsMem.collection('users').doc(userId).set({
      id: userId,
      firstName: 'Maya',
      lastName: 'Lin',
      permanentAccountNumber: userPan,
      email: 'maya.deliv.private@monvera.test',
      phone: '+15125550144',
      status: 'active',
    });
    await fsMem.collection('accounts').doc(userId).set({
      userId,
      permanentAccountNumber: userPan,
      checkingBalance: 2200,
      savingsBalance: 800,
      investedBalance: 0,
      accruedEarnings: 0,
      totalBalance: 3000,
      availableBalance: 2200,
      pendingBalance: 0,
      loanBalance: 0,
    });

    const subRes = await executeServerWireCheckWithdrawal(
      {
        userId,
        bankName: 'Regions Bank',
        destinationBankAccountNumber: destAcct,
        destinationBankRoutingNumber: destRouting,
        fullLegalName: 'Maya Lin',
        residentialAddress: resAddress,
        email: 'maya.deliv.private@monvera.test',
        phoneNumber: '+15125550144',
        amount: 450,
        sourceAccountType: 'CHECKING',
        idempotencyKey: 'wchk_deliv_sub_1',
      },
      deps
    );
    assert.strictEqual(subRes.success, true);
    const reqId = subRes.request!.requestId;
    const origTxId = subRes.transaction!.id;
    const txCountBefore = (await fsMem.collection('transactions').get()).size;
    assert.strictEqual(txCountBefore, 1);

    // Invalid targetStatus -> 0 extra outbox docs
    const badTarget = await markWireCheckRequestDeliveredAdmin(
      { requestId: reqId, targetStatus: 'CANCELLED', adminUid: 'usr_admin', adminEmail: 'admin@monvera.test' },
      deps
    );
    assert.strictEqual(badTarget.success, false);
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 1);

    // Simulated commit failure on delivery rolls back DELIVERED status AND :DELIVERED outbox doc, keeping :SUBMITTED
    fsMem.failNextTransactionWrite = true;
    const rbDeliv = await markWireCheckRequestDeliveredAdmin(
      { requestId: reqId, targetStatus: 'DELIVERED', adminUid: 'usr_admin', adminEmail: 'admin@monvera.test' },
      deps
    );
    assert.strictEqual(rbDeliv.success, false);
    assert.strictEqual((await fsMem.collection('wire_check_requests').doc(reqId).get()).data()?.checkProcessingStatus, 'REQUESTED');
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 1);

    // ABORTED retry contention test on delivery (e.g., concurrent metadata touch) -> commits cleanly once
    fsMem.onBeforeCommitConflictOnce = async () => {
      const curReq = (await fsMem.collection('wire_check_requests').doc(reqId).get()).data()!;
      await fsMem.collection('wire_check_requests').doc(reqId).set({
        ...curReq,
        adminNote: 'Concurrent note update',
      });
    };
    const delivRes = await markWireCheckRequestDeliveredAdmin(
      { requestId: reqId, targetStatus: 'DELIVERED', adminUid: 'usr_admin', adminEmail: 'admin@monvera.test' },
      deps
    );
    assert.strictEqual(delivRes.success, true);
    assert.strictEqual(fsMem.lastTransactionAttempts, 2);
    assert.strictEqual(delivRes.request?.checkProcessingStatus, 'DELIVERED');
    assert.strictEqual(delivRes.transaction?.id, origTxId);
    assert.strictEqual(delivRes.transaction?.amount, 450);
    assert.strictEqual(delivRes.transaction?.status, 'COMPLETED');

    // Balances & transaction count unchanged
    assert.strictEqual((await fsMem.collection('accounts').doc(userId).get()).data()?.checkingBalance, 1750);
    assert.strictEqual((await fsMem.collection('transactions').get()).size, 1);

    // Both :SUBMITTED and :DELIVERED coexist without collision
    const outboxSnapAfter = await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get();
    assert.strictEqual(outboxSnapAfter.size, 2);

    const expectedDelivOutboxId = computeNotificationOutboxId(userId, `${origTxId}:DELIVERED`, 'TRANSACTION');
    const delivOutboxDoc = (await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(expectedDelivOutboxId).get()).data()!;
    assert.strictEqual(Boolean(delivOutboxDoc), true);
    assert.strictEqual(delivOutboxDoc.id, expectedDelivOutboxId);
    assert.strictEqual(delivOutboxDoc.userId, userId);
    assert.strictEqual(delivOutboxDoc.transactionId, origTxId);
    assert.strictEqual(delivOutboxDoc.referenceNumber, subRes.request!.referenceNumber);
    assert.strictEqual(delivOutboxDoc.eventKey, `${origTxId}:DELIVERED`);
    assert.strictEqual(delivOutboxDoc.lifecycleStage, 'DELIVERED');
    assert.strictEqual(delivOutboxDoc.dispatchType, 'TRANSACTION');
    assert.strictEqual(delivOutboxDoc.category, 'TRANSACTION');
    assert.strictEqual(delivOutboxDoc.status, 'PENDING');
    assert.strictEqual(delivOutboxDoc.payload.title, 'Wire Check Delivered — Monvera');
    assert.strictEqual(
      delivOutboxDoc.payload.body,
      'Your Wire Check of $450.00 from Checking (MVB •••• 5566) has been marked as delivered.'
    );
    assert.strictEqual(/\b\d{8,}\b/.test(delivOutboxDoc.payload.body), false);

    const serializedDeliv = JSON.stringify(delivOutboxDoc);
    assert.strictEqual(serializedDeliv.includes(destAcct), false);
    assert.strictEqual(serializedDeliv.includes(destRouting), false);
    assert.strictEqual(serializedDeliv.includes(resAddress), false);
    assert.strictEqual(serializedDeliv.includes('maya.deliv.private@monvera.test'), false);
    assert.strictEqual(serializedDeliv.includes('+15125550144'), false);
    assert.strictEqual(serializedDeliv.includes(userPan), false);
    assert.strictEqual(serializedDeliv.includes('admin@monvera.test'), false);

    // Duplicate delivery attempt -> 409 ALREADY_DELIVERED and 0 additional outbox records
    const dupDeliv = await markWireCheckRequestDeliveredAdmin(
      { requestId: reqId, targetStatus: 'DELIVERED', adminUid: 'usr_admin', adminEmail: 'admin@monvera.test' },
      deps
    );
    assert.strictEqual(dupDeliv.success, false);
    assert.strictEqual(dupDeliv.statusCode, 409);
    assert.strictEqual(dupDeliv.errorCode, 'ALREADY_DELIVERED');
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 2);

    console.log('✓ Test 35 passed: markWireCheckRequestDeliveredAdmin writes 1 scrubbed TRANSACTION :DELIVERED outbox record sharing transactionId, preserves balances, and blocks duplicate delivery');
  }

  // -------------------------------------------------------------------------
  // TEST 36 [3D-B1.3B]: executeServerAdminCheckWithdrawal transactional outbox integration
  // - Overdraft / duplicate check number / missing customer create 0 outbox docs
  // - Successful issuance debits customer & writes 1 TRANSACTION :COMPLETED outbox doc
  // - Strictly excludes checkNumber, normalizedCheckNumber, payeeName, memo, emails, unmasked account, routing
  // - Duplicate idempotencyKey preserves existing outbox status without re-debiting
  // - Commit failure rolls back & ABORTED retry commits cleanly once
  // -------------------------------------------------------------------------
  {
    const fsMem = new StrictInMemoryFirestore();
    const userId = 'uid_adchk_3db13b';
    const userPan = '1055667788';
    const custEmail = 'adchk.private@monvera.test';
    const adminEmail = 'executive.admin@monvera.test';
    const checkNumRaw = 'CHK-904215';
    const payeePrivate = 'Acme Legal Escrow Partners LLC';
    const memoPrivate = 'Confidential Settlement Escrow #7712';

    await fsMem.collection('users').doc(userId).set({
      id: userId,
      firstName: 'Devon',
      lastName: 'Brooks',
      permanentAccountNumber: userPan,
      email: custEmail,
      status: 'active',
    });
    await fsMem.collection('accounts').doc(userId).set({
      userId,
      permanentAccountNumber: userPan,
      checkingBalance: 5000,
      savingsBalance: 1200,
      investedBalance: 0,
      accruedEarnings: 0,
      totalBalance: 6200,
      availableBalance: 5000,
      pendingBalance: 0,
      loanBalance: 0,
    });

    const deps = {
      firestore: fsMem as unknown as Firestore,
      resolveCustomer: async (identifier: string) => {
        if (identifier === userId || identifier === userPan) {
          return {
            success: true,
            uid: userId,
            data: (await fsMem.collection('users').doc(userId).get()).data(),
          };
        }
        return { success: false, error: 'Customer not found' };
      },
      persistNotification: async (n: any) => ({ ...n, read: false }),
      recordAuditLog: () => {},
    };

    // Overdraft attempt -> 0 outbox docs
    const overdraftRes = await executeServerAdminCheckWithdrawal(
      {
        customerIdentifier: userId,
        sourceAccountType: 'SAVINGS',
        checkNumber: 'CHK-999001',
        payeeName: payeePrivate,
        amount: 2000,
        idempotencyKey: 'adchk_overdraft_1',
        adminUid: 'usr_admin',
        adminEmail,
      },
      deps
    );
    assert.strictEqual(overdraftRes.success, false);
    assert.strictEqual(overdraftRes.errorCode, 'INSUFFICIENT_FUNDS');
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 0);

    // Valid check issuance from CHECKING
    const idempKey = 'adchk_valid_1';
    const chkRes = await executeServerAdminCheckWithdrawal(
      {
        customerIdentifier: userId,
        sourceAccountType: 'CHECKING',
        checkNumber: checkNumRaw,
        payeeName: payeePrivate,
        amount: 1250,
        memo: memoPrivate,
        idempotencyKey: idempKey,
        adminUid: 'usr_admin',
        adminEmail,
      },
      deps
    );
    assert.strictEqual(chkRes.success, true);
    assert.strictEqual(chkRes.isDuplicate, false);
    assert.strictEqual(chkRes.transaction?.type, 'CHECK_WITHDRAWAL');
    assert.strictEqual(chkRes.transaction?.status, 'COMPLETED');
    assert.strictEqual(chkRes.balanceMetrics?.checkingBalance, 3750);
    assert.strictEqual(chkRes.balanceMetrics?.totalBalance, 4950);

    const chkTxId = chkRes.transaction!.id;
    const expectedChkOutboxId = computeNotificationOutboxId(userId, `${chkTxId}:COMPLETED`, 'TRANSACTION');
    const chkOutboxSnap = await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get();
    assert.strictEqual(chkOutboxSnap.size, 1);

    const chkOutboxDoc = chkOutboxSnap.docs[0].data()!;
    assert.strictEqual(chkOutboxSnap.docs[0].id, expectedChkOutboxId);
    assert.strictEqual(chkOutboxDoc.userId, userId);
    assert.strictEqual(chkOutboxDoc.transactionId, chkTxId);
    assert.strictEqual(chkOutboxDoc.referenceNumber, chkRes.check!.referenceNumber);
    assert.strictEqual(chkOutboxDoc.eventKey, `${chkTxId}:COMPLETED`);
    assert.strictEqual(chkOutboxDoc.lifecycleStage, 'COMPLETED');
    assert.strictEqual(chkOutboxDoc.dispatchType, 'TRANSACTION');
    assert.strictEqual(chkOutboxDoc.category, 'TRANSACTION');
    assert.strictEqual(chkOutboxDoc.payload.amount, 1250);
    assert.strictEqual(chkOutboxDoc.payload.title, 'Official Check Issued — Monvera');
    assert.strictEqual(
      chkOutboxDoc.payload.body,
      'An official check withdrawal of $1,250.00 from Checking (MVB •••• 7788) has been issued.'
    );
    assert.strictEqual(/\b\d{8,}\b/.test(chkOutboxDoc.payload.body), false);

    // Strict check: ZERO checkNumber, normalizedCheckNumber, payeeName, memo, emails, unmasked account, or routing
    const serializedChk = JSON.stringify(chkOutboxDoc);
    assert.strictEqual(serializedChk.includes(checkNumRaw), false);
    assert.strictEqual(serializedChk.includes('CHK904215'), false);
    assert.strictEqual(serializedChk.includes('904215'), false);
    assert.strictEqual(serializedChk.includes(payeePrivate), false);
    assert.strictEqual(serializedChk.includes(memoPrivate), false);
    assert.strictEqual(serializedChk.includes('7712'), false);
    assert.strictEqual(serializedChk.includes(custEmail), false);
    assert.strictEqual(serializedChk.includes(adminEmail), false);
    assert.strictEqual(serializedChk.includes(userPan), false);
    assert.strictEqual(serializedChk.includes('021000021'), false);

    // Duplicate check number -> 409 DUPLICATE_CHECK_NUMBER and 0 extra outbox docs
    const dupNumRes = await executeServerAdminCheckWithdrawal(
      {
        customerIdentifier: userId,
        sourceAccountType: 'CHECKING',
        checkNumber: 'chk 904-215',
        payeeName: payeePrivate,
        amount: 100,
        idempotencyKey: 'adchk_dup_num_2',
        adminUid: 'usr_admin',
        adminEmail,
      },
      deps
    );
    assert.strictEqual(dupNumRes.success, false);
    assert.strictEqual(dupNumRes.errorCode, 'DUPLICATE_CHECK_NUMBER');
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 1);

    // Replay same idempotencyKey -> preserves existing DISPATCHED outbox state without re-debiting
    await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(expectedChkOutboxId).set({
      ...chkOutboxDoc,
      status: 'DISPATCHED',
      pushStatus: 'SENT',
    });
    const replayChkRes = await executeServerAdminCheckWithdrawal(
      {
        customerIdentifier: userId,
        sourceAccountType: 'CHECKING',
        checkNumber: checkNumRaw,
        payeeName: payeePrivate,
        amount: 1250,
        memo: memoPrivate,
        idempotencyKey: idempKey,
        adminUid: 'usr_admin',
        adminEmail,
      },
      deps
    );
    assert.strictEqual(replayChkRes.success, true);
    assert.strictEqual(replayChkRes.isDuplicate, true);
    assert.strictEqual(replayChkRes.balanceMetrics?.checkingBalance, 3750);
    assert.strictEqual(
      (await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(expectedChkOutboxId).get()).data()?.status,
      'DISPATCHED'
    );

    // Simulated commit failure rolls back check, lock, balance, tx, and outbox atomically
    fsMem.failNextTransactionWrite = true;
    const rbChkRes = await executeServerAdminCheckWithdrawal(
      {
        customerIdentifier: userId,
        sourceAccountType: 'SAVINGS',
        checkNumber: 'CHK-904216',
        payeeName: payeePrivate,
        amount: 200,
        idempotencyKey: 'adchk_rb_1',
        adminUid: 'usr_admin',
        adminEmail,
      },
      deps
    );
    assert.strictEqual(rbChkRes.success, false);
    assert.strictEqual((await fsMem.collection('accounts').doc(userId).get()).data()?.savingsBalance, 1200);
    assert.strictEqual((await fsMem.collection('issued_checks').get()).size, 1);
    assert.strictEqual((await fsMem.collection('check_number_locks').get()).size, 1);
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 1);

    // ABORTED retry contention test on SAVINGS check issuance
    fsMem.onBeforeCommitConflictOnce = async () => {
      const cur = (await fsMem.collection('accounts').doc(userId).get()).data()!;
      await fsMem.collection('accounts').doc(userId).set({
        ...cur,
        savingsBalance: 1400,
        totalBalance: 5150,
      });
    };
    const retryChkRes = await executeServerAdminCheckWithdrawal(
      {
        customerIdentifier: userId,
        sourceAccountType: 'SAVINGS',
        checkNumber: 'CHK-904217',
        payeeName: payeePrivate,
        amount: 200,
        idempotencyKey: 'adchk_retry_1',
        adminUid: 'usr_admin',
        adminEmail,
      },
      deps
    );
    assert.strictEqual(retryChkRes.success, true);
    assert.strictEqual(retryChkRes.isDuplicate, false);
    assert.strictEqual(fsMem.lastTransactionAttempts, 2);
    assert.strictEqual(retryChkRes.balanceMetrics?.savingsBalance, 1200);
    assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 2);

    console.log('✓ Test 36 passed: executeServerAdminCheckWithdrawal writes 1 scrubbed TRANSACTION :COMPLETED outbox record without checkNumber/payee/memo leakage');
  }

  // -------------------------------------------------------------------------
  // TEST 37 [3D-B1.3B]: evaluateAndProcessWelcomeReward transactional outbox integration
  // - Below $10,000 qualifying deposits -> IN_PROGRESS, 0 reward credit, 0 outbox docs
  // - Excluded C2C transfers / reversed / pending deposits never trigger threshold
  // - Reaching >= $10,000 credits single $1,000.00 reward + 1 MONEY_RECEIVED :COMPLETED outbox doc
  // - Already-PAID & existingTxSnap recovery paths do NOT duplicate credits or outbox records
  // - Commit failure rolls back credit, welcome_rewards, tx & outbox cleanly; ABORTED retry settles once
  // -------------------------------------------------------------------------
  {
    const fsMem = new StrictInMemoryFirestore();
    const userId = 'uid_rwd_3db13b';
    const userPan = '1022334455';
    const userIdRetry = 'uid_rwd_retry_3db13b';
    const userIdRecover = 'uid_rwd_recover_3db13b';
    const trackedUids = new Set([userId, userIdRetry, userIdRecover]);
    const initialMemTxIds = new Set(inMemoryDb.transactions.map((t) => t.id));

    const rwdDeps = {
      firestore: fsMem as unknown as Firestore,
      isAdminConfigured: () => true,
      persistNotification: async (n: any) => ({ ...n, read: false }),
    };

    try {
      await fsMem.collection('users').doc(userId).set({
        id: userId,
        firstName: 'Elena',
        lastName: 'Vance',
        permanentAccountNumber: userPan,
        email: 'elena.rwd.private@monvera.test',
        phone: '+15557778899',
        status: 'active',
      });
      await fsMem.collection('accounts').doc(userId).set({
        userId,
        permanentAccountNumber: userPan,
        checkingBalance: 4000,
        savingsBalance: 0,
        investedBalance: 0,
        accruedEarnings: 0,
        totalBalance: 4000,
        availableBalance: 4000,
        pendingBalance: 0,
        loanBalance: 0,
      });

      // $4,000 completed deposit + $7,000 C2C transfer (excluded) + $7,000 reversed deposit (excluded) -> only $4,000 qualifies
      await fsMem.collection('transactions').doc('tx_dep_q1').set({
        id: 'tx_dep_q1',
        userId,
        type: 'DEPOSIT',
        status: 'COMPLETED',
        amount: 4000,
        currency: 'USD',
        referenceNumber: 'MV-DEP-Q1',
      });
      await fsMem.collection('transactions').doc('tx_trf_excl').set({
        id: 'tx_trf_excl',
        userId,
        type: 'TRANSFER',
        status: 'COMPLETED',
        amount: 7000,
        currency: 'USD',
        referenceNumber: 'MV-TRF-EXCL',
      });
      await fsMem.collection('transactions').doc('tx_dep_rev').set({
        id: 'tx_dep_rev',
        userId,
        type: 'DEPOSIT',
        status: 'COMPLETED',
        amount: 7000,
        currency: 'USD',
        referenceNumber: 'MV-DEP-REV',
        metadata: { isReversed: true },
      });

      const inProgRes = await evaluateAndProcessWelcomeReward(userId, rwdDeps);
      assert.strictEqual(inProgRes.status, 'IN_PROGRESS');
      assert.strictEqual(inProgRes.qualifyingDeposits, 4000);
      assert.strictEqual((await fsMem.collection('accounts').doc(userId).get()).data()?.checkingBalance, 4000);
      assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 0);

      // Add second qualifying deposit ($6,000 -> total $10,000), first test commit failure rollback
      await fsMem.collection('transactions').doc('tx_dep_q2').set({
        id: 'tx_dep_q2',
        userId,
        type: 'DEPOSIT',
        status: 'COMPLETED',
        amount: 6000,
        currency: 'USD',
        referenceNumber: 'MV-DEP-Q2',
      });
      fsMem.failNextTransactionWrite = true;
      const rbRwdRes = await evaluateAndProcessWelcomeReward(userId, rwdDeps);
      assert.strictEqual(rbRwdRes.status, 'QUALIFIED');
      assert.strictEqual((await fsMem.collection('accounts').doc(userId).get()).data()?.checkingBalance, 4000);
      assert.strictEqual((await fsMem.collection('welcome_rewards').doc(userId).get()).data()?.status, 'IN_PROGRESS');
      assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 0);

      // Clean evaluation -> atomic $1,000.00 credit + 1 MONEY_RECEIVED :COMPLETED outbox doc
      const paidRes = await evaluateAndProcessWelcomeReward(userId, rwdDeps);
      assert.strictEqual(paidRes.status, 'PAID');
      assert.strictEqual(paidRes.rewardAmount, 1000);
      const rewardTxId = `tx_rwd_welcome_${userId}`;
      assert.strictEqual(paidRes.transactionId, rewardTxId);
      assert.strictEqual(paidRes.transactionReference, `MV-RWD-WELCOME-${userId}`);
      assert.strictEqual((await fsMem.collection('accounts').doc(userId).get()).data()?.checkingBalance, 5000);
      assert.strictEqual((await fsMem.collection('accounts').doc(userId).get()).data()?.totalBalance, 5000);

      const expectedRwdOutboxId = computeNotificationOutboxId(
        userId,
        `${rewardTxId}:COMPLETED`,
        'MONEY_RECEIVED'
      );
      const rwdOutboxSnap = await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get();
      assert.strictEqual(rwdOutboxSnap.size, 1);

      const rwdOutboxDoc = rwdOutboxSnap.docs[0].data()!;
      assert.strictEqual(rwdOutboxSnap.docs[0].id, expectedRwdOutboxId);
      assert.strictEqual(rwdOutboxDoc.userId, userId);
      assert.strictEqual(rwdOutboxDoc.transactionId, rewardTxId);
      assert.strictEqual(rwdOutboxDoc.referenceNumber, `MV-RWD-WELCOME-${userId}`);
      assert.strictEqual(rwdOutboxDoc.eventKey, `${rewardTxId}:COMPLETED`);
      assert.strictEqual(rwdOutboxDoc.lifecycleStage, 'COMPLETED');
      assert.strictEqual(rwdOutboxDoc.dispatchType, 'MONEY_RECEIVED');
      assert.strictEqual(rwdOutboxDoc.category, 'TRANSACTION');
      assert.strictEqual(rwdOutboxDoc.payload.amount, 1000);
      assert.strictEqual(rwdOutboxDoc.payload.title, 'Welcome Reward Credited — Monvera');
      assert.strictEqual(
        rwdOutboxDoc.payload.body,
        'Congratulations! Your $1,000.00 Monvera Welcome Reward has been credited to Checking (MVB •••• 4455).'
      );
      assert.strictEqual(/\b\d{8,}\b/.test(rwdOutboxDoc.payload.body), false);

      const serializedRwd = JSON.stringify(rwdOutboxDoc);
      assert.strictEqual(serializedRwd.includes(userPan), false);
      assert.strictEqual(serializedRwd.includes('elena.rwd.private@monvera.test'), false);
      assert.strictEqual(serializedRwd.includes('+15557778899'), false);

      // Mark DISPATCHED, then replay -> must NOT pay twice or overwrite outbox
      await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(expectedRwdOutboxId).set({
        ...rwdOutboxDoc,
        status: 'DISPATCHED',
        pushStatus: 'SENT',
      });
      const replayPaidRes = await evaluateAndProcessWelcomeReward(userId, rwdDeps);
      assert.strictEqual(replayPaidRes.status, 'PAID');
      assert.strictEqual((await fsMem.collection('accounts').doc(userId).get()).data()?.checkingBalance, 5000);
      assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 1);
      assert.strictEqual(
        (await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(expectedRwdOutboxId).get()).data()?.status,
        'DISPATCHED'
      );

      // Recovery path: reward transaction already exists while welcome_rewards doc is missing -> marks PAID, writes 0 new outbox docs
      await fsMem.collection('users').doc(userIdRecover).set({
        id: userIdRecover,
        firstName: 'Sam',
        lastName: 'Recover',
        permanentAccountNumber: '1011223344',
        status: 'active',
      });
      await fsMem.collection('accounts').doc(userIdRecover).set({
        userId: userIdRecover,
        permanentAccountNumber: '1011223344',
        checkingBalance: 11000,
        savingsBalance: 0,
        investedBalance: 0,
        accruedEarnings: 0,
        totalBalance: 11000,
        availableBalance: 11000,
      });
      await fsMem.collection('transactions').doc('tx_dep_rec_1').set({
        id: 'tx_dep_rec_1',
        userId: userIdRecover,
        type: 'DEPOSIT',
        status: 'COMPLETED',
        amount: 10000,
        currency: 'USD',
        referenceNumber: 'MV-DEP-REC-1',
      });
      await fsMem.collection('transactions').doc(`tx_rwd_welcome_${userIdRecover}`).set({
        id: `tx_rwd_welcome_${userIdRecover}`,
        referenceNumber: `MV-RWD-WELCOME-${userIdRecover}`,
        type: 'WELCOME_REWARD',
        amount: 1000,
        currency: 'USD',
        status: 'COMPLETED',
        userId: userIdRecover,
        createdAt: new Date().toISOString(),
      });
      const recRes = await evaluateAndProcessWelcomeReward(userIdRecover, rwdDeps);
      assert.strictEqual(recRes.status, 'PAID');
      assert.strictEqual((await fsMem.collection('accounts').doc(userIdRecover).get()).data()?.checkingBalance, 11000);
      assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 1);

      // ABORTED retry contention test for Welcome Reward payout
      await fsMem.collection('users').doc(userIdRetry).set({
        id: userIdRetry,
        firstName: 'Tessa',
        lastName: 'Retry',
        permanentAccountNumber: '1088990011',
        status: 'active',
      });
      await fsMem.collection('accounts').doc(userIdRetry).set({
        userId: userIdRetry,
        permanentAccountNumber: '1088990011',
        checkingBalance: 10000,
        savingsBalance: 0,
        investedBalance: 0,
        accruedEarnings: 0,
        totalBalance: 10000,
        availableBalance: 10000,
      });
      await fsMem.collection('transactions').doc('tx_dep_rtry_1').set({
        id: 'tx_dep_rtry_1',
        userId: userIdRetry,
        type: 'DEPOSIT',
        status: 'COMPLETED',
        amount: 10000,
        currency: 'USD',
        referenceNumber: 'MV-DEP-RTRY-1',
      });
      fsMem.onBeforeCommitConflictOnce = async () => {
        const cur = (await fsMem.collection('accounts').doc(userIdRetry).get()).data()!;
        await fsMem.collection('accounts').doc(userIdRetry).set({
          ...cur,
          checkingBalance: 10500,
          availableBalance: 10500,
          totalBalance: 10500,
        });
      };
      const retryRwdRes = await evaluateAndProcessWelcomeReward(userIdRetry, rwdDeps);
      assert.strictEqual(retryRwdRes.status, 'PAID');
      assert.strictEqual(fsMem.lastTransactionAttempts, 2);
      assert.strictEqual((await fsMem.collection('accounts').doc(userIdRetry).get()).data()?.checkingBalance, 11500);
      assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 2);
    } finally {
      for (let i = inMemoryDb.transactions.length - 1; i >= 0; i--) {
        const tx = inMemoryDb.transactions[i];
        if (!initialMemTxIds.has(tx.id) && trackedUids.has(tx.userId)) {
          inMemoryDb.transactions.splice(i, 1);
        }
      }
    }

    console.log('✓ Test 37 passed: evaluateAndProcessWelcomeReward writes 1 MONEY_RECEIVED :COMPLETED outbox record cleanly, preserves idempotency/recovery, and rolls back atomically');
  }

  // -------------------------------------------------------------------------
  // TEST 38 [3D-B1.3B]: End-to-end dispatch regression across all 4 Stage 3D-B1.3B integrations
  // - Builds dispatch events from actual Wire Check Submitted, Wire Check Delivered,
  //   Admin Check Issued, and Welcome Reward outbox records
  // - Verifies exact FCM payloads, zero PII/bank-account/routing/check-number leakage,
  //   UNCONFIGURED_PROVIDER isolation, and safe SMS/Email invocation on MONEY_RECEIVED only
  // -------------------------------------------------------------------------
  {
    const fsMem = new StrictInMemoryFirestore();
    const userId = 'uid_e2e_3db13b';
    const userPan = '1066112233';
    const destAcct = '443322119988';
    const destRouting = '062005690';
    const checkNumRaw = 'CHK-551199';
    const payeePrivate = 'Northstar Closing Escrow';
    const memoPrivate = 'Escrow Ref 99110022';
    const custEmail = 'e2e.3db13b.private@monvera.test';
    const custPhone = '+15559990011';
    const capturedFcmMessages: any[] = [];
    const smsPayloads: any[] = [];
    const emailPayloads: any[] = [];
    const initialMemTxIds = new Set(inMemoryDb.transactions.map((t) => t.id));

    await fsMem.collection('users').doc(userId).set({
      id: userId,
      firstName: 'Nolan',
      lastName: 'Price',
      permanentAccountNumber: userPan,
      email: custEmail,
      phone: custPhone,
      status: 'active',
    });
    await fsMem.collection('accounts').doc(userId).set({
      userId,
      permanentAccountNumber: userPan,
      checkingBalance: 20000,
      savingsBalance: 0,
      investedBalance: 0,
      accruedEarnings: 0,
      totalBalance: 20000,
      availableBalance: 20000,
      pendingBalance: 0,
      loanBalance: 0,
    });
    await fsMem.collection('transactions').doc('tx_e2e_dep_10k').set({
      id: 'tx_e2e_dep_10k',
      userId,
      type: 'DEPOSIT',
      status: 'COMPLETED',
      amount: 10000,
      currency: 'USD',
      referenceNumber: 'MV-E2E-DEP-10K',
    });
    const regTokRes = await registerCustomerPushToken(
      { uid: userId, token: 'fcm_tok_3db13b_e2e_valid_device_token_12345', platform: 'web' },
      fsMem as unknown as Firestore
    );
    assert.strictEqual(regTokRes.success, true, `Failed to register test push token: ${regTokRes.error}`);

    const mockMessaging = {
      sendEachForMulticast: async (message: any) => {
        capturedFcmMessages.push(structuredClone(message));
        return {
          successCount: message.tokens.length,
          failureCount: 0,
          responses: message.tokens.map((_: string, idx: number) => ({
            success: true,
            messageId: `fcm_3db13b_${capturedFcmMessages.length}_${idx}`,
          })),
        };
      },
    } as unknown as Messaging;

    const dispatcher = new ServerNotificationDispatcher({
      firestore: fsMem as unknown as Firestore,
      messaging: mockMessaging,
      isAdminConfigured: () => true,
      isMessagingConfigured: () => true,
      instanceId: 'worker_3db13b_e2e',
    });

    const origSms = smsService.sendTransactionSms.bind(smsService);
    const origEmail = emailService.sendTransactionalEmail.bind(emailService);
    (smsService as any).sendTransactionSms = async (params: any) => {
      smsPayloads.push(params);
      return { success: false, delivered: false, status: 'UNCONFIGURED_PROVIDER', reason: 'Mock unconfigured' };
    };
    (emailService as any).sendTransactionalEmail = async (params: any) => {
      emailPayloads.push(params);
      return { success: false, delivered: false, status: 'UNCONFIGURED_PROVIDER', reason: 'Mock unconfigured' };
    };

    const dispatchOutbox = async (outboxId: string, workerId: string) => {
      const claim = await claimOutboxLease(fsMem as unknown as Firestore, outboxId, workerId);
      assert.strictEqual(claim.claimed, true, `Failed to claim outbox ${outboxId}: ${claim.reason}`);
      const rec = claim.record!;
      const evt = buildDispatchEventFromOutboxRecord(rec, {
        email: custEmail,
        phone: custPhone,
      });
      const opts = buildOutboxDispatchOptions(rec, claim.leaseToken!);
      const res = await dispatcher.dispatch(evt, opts);
      const persistentLog = await fetchDispatchLogForOutboxRecord(fsMem as unknown as Firestore, rec);
      const outcome = evaluateOutboxAttemptOutcome({
        outboxRecord: rec,
        dispatchResult: res,
        persistentLog,
      });
      assert.strictEqual(outcome.action, 'TRANSITION');
      await transitionOutboxAsLeaseOwner(
        fsMem as unknown as Firestore,
        outboxId,
        claim.leaseToken!,
        () => ({
          status: outcome.nextStatus!,
          pushStatus: outcome.pushStatus,
          smsStatus: outcome.smsStatus,
          emailStatus: outcome.emailStatus,
          failureClassification: outcome.failureClassification,
          lastError: outcome.lastError,
          nextAttemptAt: outcome.nextAttemptAt,
          dispatchedAt: outcome.dispatchedAt,
        })
      );
      return outcome;
    };

    try {
      const wchkDeps = {
        firestore: fsMem as unknown as Firestore,
        persistNotification: async (n: any) => ({ ...n, read: false }),
        recordAuditLog: () => {},
      };
      const chkDeps = {
        firestore: fsMem as unknown as Firestore,
        resolveCustomer: async () => ({
          success: true,
          uid: userId,
          data: (await fsMem.collection('users').doc(userId).get()).data(),
        }),
        persistNotification: async (n: any) => ({ ...n, read: false }),
        recordAuditLog: () => {},
      };
      const rwdDeps = {
        firestore: fsMem as unknown as Firestore,
        isAdminConfigured: () => true,
        persistNotification: async (n: any) => ({ ...n, read: false }),
      };

      const wchkSub = await executeServerWireCheckWithdrawal(
        {
          userId,
          bankName: 'Regions Bank',
          destinationBankAccountNumber: destAcct,
          destinationBankRoutingNumber: destRouting,
          fullLegalName: 'Nolan Price',
          residentialAddress: '100 Main St, Austin, TX 78701',
          email: custEmail,
          phoneNumber: custPhone,
          amount: 500,
          sourceAccountType: 'CHECKING',
          idempotencyKey: 'e2e_wchk_sub_1',
        },
        wchkDeps
      );
      assert.strictEqual(wchkSub.success, true);

      const wchkDeliv = await markWireCheckRequestDeliveredAdmin(
        {
          requestId: wchkSub.request!.requestId,
          targetStatus: 'DELIVERED',
          adminUid: 'usr_admin',
          adminEmail: 'admin@monvera.test',
        },
        wchkDeps
      );
      assert.strictEqual(wchkDeliv.success, true);

      const adChk = await executeServerAdminCheckWithdrawal(
        {
          customerIdentifier: userId,
          sourceAccountType: 'CHECKING',
          checkNumber: checkNumRaw,
          payeeName: payeePrivate,
          amount: 800,
          memo: memoPrivate,
          idempotencyKey: 'e2e_adchk_1',
          adminUid: 'usr_admin',
          adminEmail: 'admin@monvera.test',
        },
        chkDeps
      );
      assert.strictEqual(adChk.success, true);

      const rwd = await evaluateAndProcessWelcomeReward(userId, rwdDeps);
      assert.strictEqual(rwd.status, 'PAID');

      const outSub = await dispatchOutbox(
        computeNotificationOutboxId(userId, `${wchkSub.transaction!.id}:SUBMITTED`, 'TRANSACTION'),
        'w_e2e_1'
      );
      const outDeliv = await dispatchOutbox(
        computeNotificationOutboxId(userId, `${wchkSub.transaction!.id}:DELIVERED`, 'TRANSACTION'),
        'w_e2e_2'
      );
      const outChk = await dispatchOutbox(
        computeNotificationOutboxId(userId, `${adChk.transaction!.id}:COMPLETED`, 'TRANSACTION'),
        'w_e2e_3'
      );
      const outRwd = await dispatchOutbox(
        computeNotificationOutboxId(userId, `${rwd.transactionId}:COMPLETED`, 'MONEY_RECEIVED'),
        'w_e2e_4'
      );

      assert.strictEqual(outSub.nextStatus, 'DISPATCHED');
      assert.strictEqual(outSub.pushStatus, 'SENT');
      assert.strictEqual(outDeliv.nextStatus, 'DISPATCHED');
      assert.strictEqual(outDeliv.pushStatus, 'SENT');
      assert.strictEqual(outChk.nextStatus, 'DISPATCHED');
      assert.strictEqual(outChk.pushStatus, 'SENT');
      assert.strictEqual(outRwd.nextStatus, 'DISPATCHED');
      assert.strictEqual(outRwd.pushStatus, 'SENT');
      assert.strictEqual(capturedFcmMessages.length, 4);

      assert.strictEqual(capturedFcmMessages[0].notification.title, 'Wire Check Request Submitted — Monvera');
      assert.strictEqual(
        capturedFcmMessages[0].notification.body,
        'Your Wire Check withdrawal request for $500.00 from Checking (MVB •••• 2233) was submitted successfully.'
      );
      assert.strictEqual(capturedFcmMessages[1].notification.title, 'Wire Check Delivered — Monvera');
      assert.strictEqual(
        capturedFcmMessages[1].notification.body,
        'Your Wire Check of $500.00 from Checking (MVB •••• 2233) has been marked as delivered.'
      );
      assert.strictEqual(capturedFcmMessages[2].notification.title, 'Official Check Issued — Monvera');
      assert.strictEqual(
        capturedFcmMessages[2].notification.body,
        'An official check withdrawal of $800.00 from Checking (MVB •••• 2233) has been issued.'
      );
      assert.strictEqual(capturedFcmMessages[3].notification.title, 'Welcome Reward Credited — Monvera');
      assert.strictEqual(
        capturedFcmMessages[3].notification.body,
        'Congratulations! Your $1,000.00 Monvera Welcome Reward has been credited to Checking (MVB •••• 2233).'
      );

      // TRANSACTION events make 0 SMS/Email calls; MONEY_RECEIVED (Welcome Reward) invokes mocked SMS/Email cleanly
      assert.strictEqual(smsPayloads.length, 1);
      assert.strictEqual(emailPayloads.length, 1);

      const allSerializedNotifications = JSON.stringify({
        fcm: capturedFcmMessages.map((m) => ({ notification: m.notification, data: m.data })),
        sms: smsPayloads,
        email: emailPayloads,
      });
      for (const secret of [userPan, destAcct, destRouting, checkNumRaw, '551199', payeePrivate, memoPrivate, 'admin@monvera.test', '100 Main St']) {
        assert.strictEqual(allSerializedNotifications.includes(secret), false, `Dispatched payloads must not contain ${secret}`);
      }
    } finally {
      (smsService as any).sendTransactionSms = origSms;
      (emailService as any).sendTransactionalEmail = origEmail;
      for (let i = inMemoryDb.transactions.length - 1; i >= 0; i--) {
        const tx = inMemoryDb.transactions[i];
        if (!initialMemTxIds.has(tx.id) && tx.userId === userId) {
          inMemoryDb.transactions.splice(i, 1);
        }
      }
    }

    console.log('✓ Test 38 passed: End-to-end Stage 3D-B1.3B dispatch regression verified exact FCM payloads, channel safety, and zero sensitive data leakage');
  }

  // -------------------------------------------------------------------------
  // TEST 39 [3D-B1.3B.1 Test A]: Welcome Reward concurrent payout evaluations
  // - Two parallel evaluateAndProcessWelcomeReward calls for same eligible user
  // - Only one $1,000.00 reward is credited
  // - Exactly one WELCOME_REWARD ledger transaction and one deterministic outbox doc
  // - Final reward status is PAID
  // -------------------------------------------------------------------------
  {
    const fsMem = new StrictInMemoryFirestore();
    const userId = 'uid_rwd_conc_3db13b1';
    const userPan = '1091234567';
    const initialMemTxIds = new Set(inMemoryDb.transactions.map((t) => t.id));
    const auxNotifs: any[] = [];

    const rwdDeps = {
      firestore: fsMem as unknown as Firestore,
      isAdminConfigured: () => true,
      persistNotification: async (n: any) => {
        auxNotifs.push(n);
        return { ...n, read: false };
      },
    };

    try {
      await fsMem.collection('users').doc(userId).set({
        id: userId,
        firstName: 'Aria',
        lastName: 'Concurrent',
        permanentAccountNumber: userPan,
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
      });
      await fsMem.collection('accounts').doc(userId).set({
        userId,
        permanentAccountNumber: userPan,
        checkingBalance: 2000,
        savingsBalance: 500,
        investedBalance: 0,
        accruedEarnings: 0,
        totalBalance: 2500,
        availableBalance: 2000,
      });
      await fsMem.collection('transactions').doc('tx_dep_conc_1').set({
        id: 'tx_dep_conc_1',
        userId,
        type: 'DEPOSIT',
        status: 'COMPLETED',
        amount: 4000,
        currency: 'USD',
        referenceNumber: 'MV-DEP-CONC-1',
      });
      await fsMem.collection('transactions').doc('tx_dep_conc_2').set({
        id: 'tx_dep_conc_2',
        userId,
        type: 'DEPOSIT',
        status: 'COMPLETED',
        amount: 6000,
        currency: 'USD',
        referenceNumber: 'MV-DEP-CONC-2',
      });

      const [resA, resB] = await Promise.all([
        evaluateAndProcessWelcomeReward(userId, rwdDeps),
        evaluateAndProcessWelcomeReward(userId, rwdDeps),
      ]);

      assert.strictEqual(resA.status, 'PAID');
      assert.strictEqual(resB.status, 'PAID');
      assert.strictEqual(resA.transactionId, `tx_rwd_welcome_${userId}`);
      assert.strictEqual(resB.transactionId, `tx_rwd_welcome_${userId}`);

      const accAfter = (await fsMem.collection('accounts').doc(userId).get()).data()!;
      assert.strictEqual(accAfter.checkingBalance, 3000);
      assert.strictEqual(accAfter.totalBalance, 3500);

      const allTxSnap = await fsMem.collection('transactions').get();
      const rewardTxs = allTxSnap.docs.filter((d) => d.data()?.type === 'WELCOME_REWARD');
      assert.strictEqual(rewardTxs.length, 1);

      const expectedOutboxId = computeNotificationOutboxId(
        userId,
        `tx_rwd_welcome_${userId}:COMPLETED`,
        'MONEY_RECEIVED'
      );
      const outboxSnap = await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get();
      assert.strictEqual(outboxSnap.size, 1);
      assert.strictEqual(outboxSnap.docs[0].id, expectedOutboxId);

      const rwdDoc = (await fsMem.collection('welcome_rewards').doc(userId).get()).data()!;
      assert.strictEqual(rwdDoc.status, 'PAID');
      assert.strictEqual(auxNotifs.length, 1);
    } finally {
      for (let i = inMemoryDb.transactions.length - 1; i >= 0; i--) {
        const tx = inMemoryDb.transactions[i];
        if (!initialMemTxIds.has(tx.id) && tx.userId === userId) {
          inMemoryDb.transactions.splice(i, 1);
        }
      }
    }

    console.log('✓ Test 39 [3D-B1.3B.1 Test A] passed: Concurrent Welcome Reward evaluations credit strictly one $1,000 reward and one outbox record');
  }

  // -------------------------------------------------------------------------
  // TEST 40 [3D-B1.3B.1 Test B]: Stale below-threshold evaluation cannot regress PAID
  // - Eval 1 enters transaction and observes below-threshold ($4,000), then pauses
  //   before committing IN_PROGRESS
  // - Second deposit ($6,000) arrives and Eval 2 qualifies & commits PAID + $1,000 credit
  // - Eval 1 resumes and attempts to commit stale IN_PROGRESS
  // - Verify PAID status, paidAt, transactionId, balance ($2,500), and single outbox stay intact
  // -------------------------------------------------------------------------
  {
    const fsMem = new StrictInMemoryFirestore();
    const userId = 'uid_rwd_stale_3db13b1';
    const userPan = '1092345678';
    const initialMemTxIds = new Set(inMemoryDb.transactions.map((t) => t.id));

    let signalBelowThresholdRead!: () => void;
    const belowThresholdReadDone = new Promise<void>((resolve) => {
      signalBelowThresholdRead = resolve;
    });
    let releaseStaleEval!: () => void;
    const staleEvalPaused = new Promise<void>((resolve) => {
      releaseStaleEval = resolve;
    });

    try {
      await fsMem.collection('users').doc(userId).set({
        id: userId,
        firstName: 'Lucas',
        lastName: 'StaleRace',
        permanentAccountNumber: userPan,
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
      });
      await fsMem.collection('accounts').doc(userId).set({
        userId,
        permanentAccountNumber: userPan,
        checkingBalance: 1500,
        savingsBalance: 0,
        investedBalance: 0,
        accruedEarnings: 0,
        totalBalance: 1500,
        availableBalance: 1500,
      });
      await fsMem.collection('transactions').doc('tx_dep_stale_1').set({
        id: 'tx_dep_stale_1',
        userId,
        type: 'DEPOSIT',
        status: 'COMPLETED',
        amount: 4000,
        currency: 'USD',
        referenceNumber: 'MV-DEP-STALE-1',
      });

      // Firestore wrapper for Eval 1: pauses Attempt 1 right after reading below-threshold state
      // and right before tx.set(welcome_rewards/userId, IN_PROGRESS)
      let pausedOnce = false;
      const pausingFirestore = {
        collection: (name: string) => fsMem.collection(name),
        runTransaction: async <T>(fn: (tx: any) => Promise<T>): Promise<T> => {
          return fsMem.runTransaction(async (innerTx) => {
            const wrappedTx = {
              get: (refOrQuery: any) => innerTx.get(refOrQuery),
              create: (ref: any, data: any) => innerTx.create(ref, data),
              delete: (ref: any) => innerTx.delete(ref),
              set: async (ref: any, data: any, opts?: any) => {
                // Only reached synchronously after all tx.get calls; if Attempt 1 writes IN_PROGRESS,
                // wait via wrapped runTransaction wrapper below
                innerTx.set(ref, data, opts);
              },
            };
            const res = await fn(wrappedTx);
            if (!pausedOnce && (res as any)?.action === 'IN_PROGRESS') {
              pausedOnce = true;
              signalBelowThresholdRead();
              await staleEvalPaused;
            }
            return res;
          });
        },
      } as unknown as Firestore;

      const staleEvalPromise = evaluateAndProcessWelcomeReward(userId, {
        firestore: pausingFirestore,
        isAdminConfigured: () => true,
        persistNotification: async (n: any) => ({ ...n, read: false }),
      });

      // Wait until Eval 1 has observed $4,000 (below threshold) and is paused before commit
      await belowThresholdReadDone;

      // Second qualifying deposit lands and Eval 2 completes $1,000 PAID payout
      await fsMem.collection('transactions').doc('tx_dep_stale_2').set({
        id: 'tx_dep_stale_2',
        userId,
        type: 'DEPOSIT',
        status: 'COMPLETED',
        amount: 6000,
        currency: 'USD',
        referenceNumber: 'MV-DEP-STALE-2',
      });

      const winningEval = await evaluateAndProcessWelcomeReward(userId, {
        firestore: fsMem as unknown as Firestore,
        isAdminConfigured: () => true,
        persistNotification: async (n: any) => ({ ...n, read: false }),
      });
      assert.strictEqual(winningEval.status, 'PAID');
      assert.strictEqual((await fsMem.collection('accounts').doc(userId).get()).data()?.checkingBalance, 2500);

      // Resume stale Eval 1 — optimistic retry must detect PAID and never regress welcome_rewards/{userId}
      releaseStaleEval();
      const resumedStale = await staleEvalPromise;
      assert.strictEqual(resumedStale.status, 'PAID');
      assert.strictEqual(resumedStale.transactionId, `tx_rwd_welcome_${userId}`);

      const persistedReward = (await fsMem.collection('welcome_rewards').doc(userId).get()).data()!;
      assert.strictEqual(persistedReward.status, 'PAID');
      assert.strictEqual(persistedReward.transactionId, `tx_rwd_welcome_${userId}`);
      assert.strictEqual(Boolean(persistedReward.paidAt), true);
      assert.strictEqual((await fsMem.collection('accounts').doc(userId).get()).data()?.checkingBalance, 2500);
      assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 1);

      // Even if a subsequent stale transaction fails commit completely, PAID remains preserved
      fsMem.failNextTransactionWrite = true;
      const errFallbackRes = await evaluateAndProcessWelcomeReward(userId, {
        firestore: {
          collection: (name: string) => {
            if (name === 'welcome_rewards') {
              const realRef = fsMem.collection('welcome_rewards').doc(userId);
              let fastCheckDone = false;
              return {
                doc: (id: string) =>
                  id === userId
                    ? {
                        get: async () => {
                          if (!fastCheckDone) {
                            fastCheckDone = true;
                            return { id: userId, exists: false, ref: realRef, data: () => undefined };
                          }
                          return realRef.get();
                        },
                      }
                    : fsMem.collection('welcome_rewards').doc(id),
              };
            }
            return fsMem.collection(name);
          },
          runTransaction: async () => {
            throw new Error('SIMULATED_STALE_EVAL_FAILURE');
          },
        } as unknown as Firestore,
        isAdminConfigured: () => true,
      });
      fsMem.failNextTransactionWrite = false;
      assert.strictEqual(errFallbackRes.status, 'PAID');
      assert.strictEqual((await fsMem.collection('welcome_rewards').doc(userId).get()).data()?.status, 'PAID');
    } finally {
      for (let i = inMemoryDb.transactions.length - 1; i >= 0; i--) {
        const tx = inMemoryDb.transactions[i];
        if (!initialMemTxIds.has(tx.id) && tx.userId === userId) {
          inMemoryDb.transactions.splice(i, 1);
        }
      }
    }

    console.log('✓ Test 40 [3D-B1.3B.1 Test B] passed: Stale below-threshold evaluation cannot overwrite PAID status or regress reward metadata');
  }

  // -------------------------------------------------------------------------
  // TEST 41 [3D-B1.3B.1 Test C]: Concurrent deposit reversal aborts unauthorized reward
  // - User starts at $10,000 ($4,000 + $6,000)
  // - Right before payout commit, $6,000 deposit is reversed concurrently
  // - Transaction detects conflict, revalidates inside transaction ($4,000 < $10,000),
  //   and blocks unauthorized $1,000 credit & outbox creation
  // -------------------------------------------------------------------------
  {
    const fsMem = new StrictInMemoryFirestore();
    const userId = 'uid_rwd_rev_3db13b1';
    const userPan = '1093456789';
    const initialMemTxIds = new Set(inMemoryDb.transactions.map((t) => t.id));
    const auxNotifs: any[] = [];

    const rwdDeps = {
      firestore: fsMem as unknown as Firestore,
      isAdminConfigured: () => true,
      persistNotification: async (n: any) => {
        auxNotifs.push(n);
        return { ...n, read: false };
      },
    };

    try {
      await fsMem.collection('users').doc(userId).set({
        id: userId,
        firstName: 'Nadia',
        lastName: 'ReversalRace',
        permanentAccountNumber: userPan,
        status: 'active',
      });
      await fsMem.collection('accounts').doc(userId).set({
        userId,
        permanentAccountNumber: userPan,
        checkingBalance: 5000,
        savingsBalance: 0,
        investedBalance: 0,
        accruedEarnings: 0,
        totalBalance: 5000,
        availableBalance: 5000,
      });
      await fsMem.collection('transactions').doc('tx_dep_rev_a').set({
        id: 'tx_dep_rev_a',
        userId,
        type: 'DEPOSIT',
        status: 'COMPLETED',
        amount: 4000,
        currency: 'USD',
        referenceNumber: 'MV-DEP-REV-A',
      });
      await fsMem.collection('transactions').doc('tx_dep_rev_b').set({
        id: 'tx_dep_rev_b',
        userId,
        type: 'DEPOSIT',
        status: 'COMPLETED',
        amount: 6000,
        currency: 'USD',
        referenceNumber: 'MV-DEP-REV-B',
      });

      fsMem.onBeforeCommitConflictOnce = async () => {
        const depB = (await fsMem.collection('transactions').doc('tx_dep_rev_b').get()).data()!;
        await fsMem.collection('transactions').doc('tx_dep_rev_b').set({
          ...depB,
          status: 'REVERSED',
          metadata: { isReversed: true },
        });
      };

      const revRes = await evaluateAndProcessWelcomeReward(userId, rwdDeps);
      assert.strictEqual(fsMem.lastTransactionAttempts, 2);
      assert.strictEqual(revRes.status, 'IN_PROGRESS');
      assert.strictEqual(revRes.qualifyingDeposits, 4000);
      assert.strictEqual((await fsMem.collection('accounts').doc(userId).get()).data()?.checkingBalance, 5000);
      assert.strictEqual((await fsMem.collection('transactions').doc(`tx_rwd_welcome_${userId}`).get()).exists, false);
      assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 0);
      assert.strictEqual((await fsMem.collection('welcome_rewards').doc(userId).get()).data()?.status, 'IN_PROGRESS');
      assert.strictEqual(auxNotifs.length, 0);
    } finally {
      for (let i = inMemoryDb.transactions.length - 1; i >= 0; i--) {
        const tx = inMemoryDb.transactions[i];
        if (!initialMemTxIds.has(tx.id) && tx.userId === userId) {
          inMemoryDb.transactions.splice(i, 1);
        }
      }
    }

    console.log('✓ Test 41 [3D-B1.3B.1 Test C] passed: Concurrent deposit reversal prevents unauthorized $1,000 credit and outbox creation');
  }

  // -------------------------------------------------------------------------
  // TEST 42 [3D-B1.3B.1 Test D]: Currency and in-memory fallback isolation
  // - Firestore mode rejects non-USD, pending, reversed, transfer, and ALL inMemoryDb records
  // - Non-Firestore fallback mode also strictly rejects non-USD and reversed records
  // -------------------------------------------------------------------------
  {
    const fsMem = new StrictInMemoryFirestore();
    const userId = 'uid_rwd_curr_3db13b1';
    const userIdFallback = 'uid_rwd_fallback_curr';
    const initialMemTxIds = new Set(inMemoryDb.transactions.map((t) => t.id));
    const initialMemNotifIds = new Set(inMemoryDb.notifications.map((n) => n.id));
    const initialMemLedgerIds = new Set(inMemoryDb.ledgerEntries.map((l) => l.id));

    try {
      await fsMem.collection('users').doc(userId).set({
        id: userId,
        firstName: 'Theo',
        lastName: 'CurrencyIso',
        permanentAccountNumber: '1094567890',
        status: 'active',
      });
      await fsMem.collection('accounts').doc(userId).set({
        userId,
        permanentAccountNumber: '1094567890',
        checkingBalance: 1000,
        savingsBalance: 0,
        investedBalance: 0,
        accruedEarnings: 0,
        totalBalance: 1000,
        availableBalance: 1000,
      });

      // Only $6,000 valid USD completed deposit in Firestore
      await fsMem.collection('transactions').doc('tx_curr_usd_ok').set({
        id: 'tx_curr_usd_ok',
        userId,
        type: 'DEPOSIT',
        status: 'COMPLETED',
        amount: 6000,
        currency: 'USD',
        referenceNumber: 'MV-CURR-USD-1',
      });
      // Ineligible entries in Firestore: EUR, GBP, PENDING, isReversed, TRANSFER, WELCOME_REWARD
      await fsMem.collection('transactions').doc('tx_curr_eur').set({
        id: 'tx_curr_eur',
        userId,
        type: 'DEPOSIT',
        status: 'COMPLETED',
        amount: 12000,
        currency: 'EUR',
        referenceNumber: 'MV-CURR-EUR-1',
      });
      await fsMem.collection('transactions').doc('tx_curr_pending').set({
        id: 'tx_curr_pending',
        userId,
        type: 'DEPOSIT',
        status: 'PENDING',
        amount: 10000,
        currency: 'USD',
        referenceNumber: 'MV-CURR-PEND-1',
      });
      await fsMem.collection('transactions').doc('tx_curr_rev').set({
        id: 'tx_curr_rev',
        userId,
        type: 'DEPOSIT',
        status: 'COMPLETED',
        amount: 10000,
        currency: 'USD',
        referenceNumber: 'MV-CURR-REV-1',
        metadata: { isReversed: true },
      });
      await fsMem.collection('transactions').doc('tx_curr_trf').set({
        id: 'tx_curr_trf',
        userId,
        type: 'TRANSFER',
        status: 'COMPLETED',
        amount: 10000,
        currency: 'USD',
        referenceNumber: 'MV-CURR-TRF-1',
      });

      // Plant stale/ineligible memory db deposits for the Firestore user (must NEVER leak into Firestore threshold)
      inMemoryDb.transactions.push(
        {
          id: 'mem_leak_usd',
          referenceNumber: 'MV-MEM-LEAK-USD',
          type: 'DEPOSIT',
          amount: 15000,
          currency: 'USD',
          status: 'COMPLETED',
          userId,
          createdAt: new Date().toISOString(),
        } as any,
        {
          id: 'mem_leak_eur',
          referenceNumber: 'MV-MEM-LEAK-EUR',
          type: 'DEPOSIT',
          amount: 15000,
          currency: 'EUR',
          status: 'COMPLETED',
          userId,
          createdAt: new Date().toISOString(),
        } as any
      );

      const fsIsoRes = await evaluateAndProcessWelcomeReward(userId, {
        firestore: fsMem as unknown as Firestore,
        isAdminConfigured: () => true,
        persistNotification: async (n: any) => ({ ...n, read: false }),
      });

      assert.strictEqual(fsIsoRes.status, 'IN_PROGRESS');
      assert.strictEqual(fsIsoRes.qualifyingDeposits, 6000);
      assert.strictEqual((await fsMem.collection('accounts').doc(userId).get()).data()?.checkingBalance, 1000);
      assert.strictEqual((await fsMem.collection('transactions').doc(`tx_rwd_welcome_${userId}`).get()).exists, false);
      assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 0);

      // Non-Firestore fallback also enforces strict USD + non-reversed exclusion
      inMemoryDb.transactions.push(
        {
          id: 'mem_fb_usd_ok',
          referenceNumber: 'MV-FB-USD-1',
          type: 'DEPOSIT',
          amount: 5000,
          currency: 'USD',
          status: 'COMPLETED',
          userId: userIdFallback,
          createdAt: new Date().toISOString(),
        } as any,
        {
          id: 'mem_fb_eur',
          referenceNumber: 'MV-FB-EUR-1',
          type: 'DEPOSIT',
          amount: 15000,
          currency: 'EUR',
          status: 'COMPLETED',
          userId: userIdFallback,
          createdAt: new Date().toISOString(),
        } as any,
        {
          id: 'mem_fb_rev',
          referenceNumber: 'MV-FB-REV-1',
          type: 'DEPOSIT',
          amount: 9000,
          currency: 'USD',
          status: 'COMPLETED',
          userId: userIdFallback,
          metadata: { isReversed: true },
          createdAt: new Date().toISOString(),
        } as any
      );

      const fbRes = await evaluateAndProcessWelcomeReward(userIdFallback, {
        isAdminConfigured: () => false,
      });
      assert.strictEqual(fbRes.status, 'IN_PROGRESS');
      assert.strictEqual(fbRes.qualifyingDeposits, 5000);
    } finally {
      for (let i = inMemoryDb.transactions.length - 1; i >= 0; i--) {
        if (!initialMemTxIds.has(inMemoryDb.transactions[i].id)) {
          inMemoryDb.transactions.splice(i, 1);
        }
      }
      for (let i = inMemoryDb.notifications.length - 1; i >= 0; i--) {
        if (!initialMemNotifIds.has(inMemoryDb.notifications[i].id)) {
          inMemoryDb.notifications.splice(i, 1);
        }
      }
      for (let i = inMemoryDb.ledgerEntries.length - 1; i >= 0; i--) {
        if (!initialMemLedgerIds.has(inMemoryDb.ledgerEntries[i].id)) {
          inMemoryDb.ledgerEntries.splice(i, 1);
        }
      }
    }

    console.log('✓ Test 42 [3D-B1.3B.1 Test D] passed: Non-USD and in-memory fallback records cannot pollute Firestore-authoritative reward thresholds');
  }

  // -------------------------------------------------------------------------
  // TEST 43 [3D-B1.3B.2]: Loan disbursement (type: 'DEPOSIT') excluded across Firestore & fallback
  // - Actual executeServerLoanDisbursement ($12,000) keeps loan accounting & loan outbox intact
  // - evaluateAndProcessWelcomeReward counts $0 qualifying deposits and stays IN_PROGRESS
  // - Non-Firestore fallback path also excludes MVB-LN-* / Monvera Credit & Lending Facility deposits
  // -------------------------------------------------------------------------
  {
    const fsMem = new StrictInMemoryFirestore();
    const userId = 'uid_rwd_loan_excl_1';
    const userPan = '1095678901';
    const loanId = 'loan_3db13b2_1';
    const initialMemTxIds = new Set(inMemoryDb.transactions.map((t) => t.id));
    const initialMemNotifIds = new Set(inMemoryDb.notifications.map((n) => n.id));
    const initialMemLedgerIds = new Set(inMemoryDb.ledgerEntries.map((l) => l.id));

    try {
      await fsMem.collection('users').doc(userId).set({
        id: userId,
        firstName: 'Claire',
        lastName: 'Borrower',
        permanentAccountNumber: userPan,
        status: 'active',
        createdAt: '2026-02-01T00:00:00.000Z',
      });
      await fsMem.collection('accounts').doc(userId).set({
        userId,
        permanentAccountNumber: userPan,
        checkingBalance: 0,
        savingsBalance: 0,
        investedBalance: 0,
        accruedEarnings: 0,
        totalBalance: 0,
        availableBalance: 0,
        pendingBalance: 0,
        loanBalance: 0,
        creditedLoans: [],
      });
      await fsMem.collection('loans').doc(loanId).set({
        id: loanId,
        userId,
        applicantName: 'Claire Borrower',
        applicantEmail: 'claire.borrower@monvera.test',
        applicantPhone: '+15551112233',
        permanentAccountNumber: userPan,
        amount: 12000,
        termMonths: 12,
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      });

      const loanRes = await executeServerLoanDisbursement(
        { loanId, adminId: 'usr_admin' },
        { firestore: fsMem as unknown as Firestore, isAdminConfigured: () => true }
      );
      assert.strictEqual(loanRes.success, true);
      assert.strictEqual(loanRes.loan?.status, 'ACTIVE');
      assert.strictEqual(loanRes.transaction?.type, 'DEPOSIT');
      assert.strictEqual(loanRes.balanceMetrics?.checkingBalance, 12000);
      assert.strictEqual(loanRes.balanceMetrics?.loanBalance, 14400);

      const loanOutboxId = computeNotificationOutboxId(
        userId,
        `tx_loan_disb_${loanId}:COMPLETED`,
        'MONEY_RECEIVED'
      );
      assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(loanOutboxId).get()).exists, true);

      const rwdRes = await evaluateAndProcessWelcomeReward(userId, {
        firestore: fsMem as unknown as Firestore,
        isAdminConfigured: () => true,
        persistNotification: async (n: any) => ({ ...n, read: false }),
      });

      assert.strictEqual(rwdRes.status, 'IN_PROGRESS');
      assert.strictEqual(rwdRes.qualifyingDeposits, 0);
      assert.strictEqual(rwdRes.qualifyingDepositCount, 0);
      assert.strictEqual(rwdRes.remainingAmount, 10000);

      const accAfter = (await fsMem.collection('accounts').doc(userId).get()).data()!;
      assert.strictEqual(accAfter.checkingBalance, 12000);
      assert.strictEqual(accAfter.loanBalance, 14400);
      assert.strictEqual((await fsMem.collection('transactions').doc(`tx_rwd_welcome_${userId}`).get()).exists, false);
      assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 1);

      // Verify fallback mode excludes loan disbursement DEPOSIT records as well
      const fallbackUid = 'uid_rwd_loan_fallback_1';
      inMemoryDb.transactions.push({
        id: `tx_loan_disb_fb_${fallbackUid}`,
        referenceNumber: `MVB-LN-FB-${fallbackUid}`,
        type: 'DEPOSIT',
        category: 'Deposits',
        amount: 15000,
        fee: 0,
        currency: 'USD',
        status: 'COMPLETED',
        description: 'Approved Commercial Loan Disbursement ($15,000.00) - Ref: fb1',
        senderName: 'Monvera Credit & Lending Facility',
        senderAccountNumber: 'MVB-LN-001',
        userId: fallbackUid,
        recipientUserId: fallbackUid,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      } as any);

      const fbRes = await evaluateAndProcessWelcomeReward(fallbackUid, {
        isAdminConfigured: () => false,
      });
      assert.strictEqual(fbRes.status, 'IN_PROGRESS');
      assert.strictEqual(fbRes.qualifyingDeposits, 0);
    } finally {
      for (let i = inMemoryDb.transactions.length - 1; i >= 0; i--) {
        if (!initialMemTxIds.has(inMemoryDb.transactions[i].id)) {
          inMemoryDb.transactions.splice(i, 1);
        }
      }
      for (let i = inMemoryDb.notifications.length - 1; i >= 0; i--) {
        if (!initialMemNotifIds.has(inMemoryDb.notifications[i].id)) {
          inMemoryDb.notifications.splice(i, 1);
        }
      }
      for (let i = inMemoryDb.ledgerEntries.length - 1; i >= 0; i--) {
        if (!initialMemLedgerIds.has(inMemoryDb.ledgerEntries[i].id)) {
          inMemoryDb.ledgerEntries.splice(i, 1);
        }
      }
    }

    console.log('✓ Test 43 [3D-B1.3B.2] passed: Loan disbursements (type: DEPOSIT) are excluded from Welcome Reward eligibility while loan accounting & outbox remain intact');
  }

  // -------------------------------------------------------------------------
  // TEST 44 [3D-B1.3B.2]: $9,999 genuine deposits + loan disbursement does NOT qualify;
  // qualifies ONLY once genuine deposits alone reach $10,000 (+ replay idempotency)
  // -------------------------------------------------------------------------
  {
    const fsMem = new StrictInMemoryFirestore();
    const userId = 'uid_rwd_loan_combo_1';
    const userPan = '1096789012';
    const loanId = 'loan_3db13b2_2';
    const auxNotifs: any[] = [];
    const initialMemTxIds = new Set(inMemoryDb.transactions.map((t) => t.id));

    const rwdDeps = {
      firestore: fsMem as unknown as Firestore,
      isAdminConfigured: () => true,
      persistNotification: async (n: any) => {
        auxNotifs.push(n);
        return { ...n, read: false };
      },
    };

    try {
      await fsMem.collection('users').doc(userId).set({
        id: userId,
        firstName: 'Devon',
        lastName: 'Combo',
        permanentAccountNumber: userPan,
        status: 'active',
        createdAt: '2026-02-02T00:00:00.000Z',
      });
      await fsMem.collection('accounts').doc(userId).set({
        userId,
        permanentAccountNumber: userPan,
        checkingBalance: 100,
        savingsBalance: 0,
        investedBalance: 0,
        accruedEarnings: 0,
        totalBalance: 100,
        availableBalance: 100,
        pendingBalance: 0,
        loanBalance: 0,
        creditedLoans: [],
      });
      await fsMem.collection('loans').doc(loanId).set({
        id: loanId,
        userId,
        applicantName: 'Devon Combo',
        applicantEmail: 'devon.combo@monvera.test',
        applicantPhone: '+15553334455',
        permanentAccountNumber: userPan,
        amount: 12000,
        termMonths: 12,
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      });

      const loanRes = await executeServerLoanDisbursement(
        { loanId, adminId: 'usr_admin' },
        { firestore: fsMem as unknown as Firestore, isAdminConfigured: () => true }
      );
      assert.strictEqual(loanRes.success, true);
      assert.strictEqual(loanRes.balanceMetrics?.checkingBalance, 12100);

      // Also plant a $1+ loan disbursement with LOAN_DISBURSEMENT metadata & $9,999 in genuine customer deposits
      await fsMem.collection('transactions').doc('tx_loan_meta_1').set({
        id: 'tx_loan_meta_1',
        userId,
        recipientUserId: userId,
        type: 'DEPOSIT',
        category: 'Deposits',
        status: 'COMPLETED',
        amount: 1,
        currency: 'USD',
        referenceNumber: 'MV-CUSTOM-LN-META-1',
        metadata: { transactionType: 'LOAN_DISBURSEMENT', loanId: 'loan_meta_99' },
      });
      await fsMem.collection('transactions').doc('tx_dep_gen_1').set({
        id: 'tx_dep_gen_1',
        userId,
        recipientUserId: userId,
        type: 'DEPOSIT',
        category: 'Deposits',
        status: 'COMPLETED',
        amount: 6000,
        currency: 'USD',
        referenceNumber: 'STRIPE-cs_combo_6000',
        paymentProviderRef: 'STRIPE-cs_combo_6000',
        senderName: 'Debit / Credit Card Gateway',
        senderAccountNumber: 'STRIPE-cs_combo_6000',
        description: 'Deposit to Premier Checking via Debit / Credit Card Gateway',
      });
      await fsMem.collection('transactions').doc('tx_dep_gen_2').set({
        id: 'tx_dep_gen_2',
        userId,
        recipientUserId: userId,
        type: 'DEPOSIT',
        category: 'Deposits',
        status: 'COMPLETED',
        amount: 3999,
        currency: 'USD',
        referenceNumber: 'MV-DEP-COMBO-3999',
        paymentProviderRef: 'MV-DEP-COMBO-3999',
        senderName: 'Bank ACH Transfer',
        senderAccountNumber: 'EXTERNAL_GATEWAY',
        description: 'Deposit to Premier Checking via Bank ACH Transfer',
      });

      // $9,999 genuine + $12,001 loan disbursements MUST NOT qualify
      const belowRes = await evaluateAndProcessWelcomeReward(userId, rwdDeps);
      assert.strictEqual(belowRes.status, 'IN_PROGRESS');
      assert.strictEqual(belowRes.qualifyingDeposits, 9999);
      assert.strictEqual(belowRes.remainingAmount, 1);
      assert.strictEqual(belowRes.qualifyingDepositCount, 2);
      assert.strictEqual((await fsMem.collection('accounts').doc(userId).get()).data()?.checkingBalance, 12100);
      assert.strictEqual((await fsMem.collection('transactions').doc(`tx_rwd_welcome_${userId}`).get()).exists, false);
      assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 1);
      assert.strictEqual(auxNotifs.length, 0);

      // Add final $1.00 genuine customer deposit -> genuine deposits alone hit $10,000 -> qualifies!
      await fsMem.collection('transactions').doc('tx_dep_gen_3').set({
        id: 'tx_dep_gen_3',
        userId,
        recipientUserId: userId,
        type: 'DEPOSIT',
        category: 'Deposits',
        status: 'COMPLETED',
        amount: 1,
        currency: 'USD',
        referenceNumber: 'MV-DEP-COMBO-1',
        paymentProviderRef: 'MV-DEP-COMBO-1',
        senderName: 'Instant RTP Network',
        senderAccountNumber: 'EXTERNAL_GATEWAY',
        description: 'Deposit to Premier Checking via Instant RTP Network',
      });

      const paidRes = await evaluateAndProcessWelcomeReward(userId, rwdDeps);
      assert.strictEqual(paidRes.status, 'PAID');
      assert.strictEqual(paidRes.qualifyingDeposits, 10000);
      assert.strictEqual(paidRes.qualifyingDepositCount, 3);
      assert.strictEqual(paidRes.rewardAmount, 1000);
      assert.strictEqual(paidRes.transactionId, `tx_rwd_welcome_${userId}`);

      const accAfterPaid = (await fsMem.collection('accounts').doc(userId).get()).data()!;
      assert.strictEqual(accAfterPaid.checkingBalance, 13100);
      assert.strictEqual(accAfterPaid.loanBalance, 14400);
      assert.strictEqual((await fsMem.collection('transactions').doc(`tx_rwd_welcome_${userId}`).get()).exists, true);
      assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 2);
      assert.strictEqual(auxNotifs.length, 1);

      const expectedRwdOutboxId = computeNotificationOutboxId(
        userId,
        `tx_rwd_welcome_${userId}:COMPLETED`,
        'MONEY_RECEIVED'
      );
      const rwdOutboxDoc = (await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(expectedRwdOutboxId).get()).data()!;
      assert.strictEqual(rwdOutboxDoc.payload.amount, 1000);

      // Replay remains strictly idempotent
      const replayRes = await evaluateAndProcessWelcomeReward(userId, rwdDeps);
      assert.strictEqual(replayRes.status, 'PAID');
      assert.strictEqual((await fsMem.collection('accounts').doc(userId).get()).data()?.checkingBalance, 13100);
      assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 2);
      assert.strictEqual(auxNotifs.length, 1);
    } finally {
      for (let i = inMemoryDb.transactions.length - 1; i >= 0; i--) {
        const tx = inMemoryDb.transactions[i];
        if (!initialMemTxIds.has(tx.id) && tx.userId === userId) {
          inMemoryDb.transactions.splice(i, 1);
        }
      }
    }

    console.log('✓ Test 44 [3D-B1.3B.2] passed: $9,999 genuine + loan disbursements stays IN_PROGRESS and qualifies only at $10,000 genuine deposits');
  }

  // -------------------------------------------------------------------------
  // TEST 45 [3D-B1.3B.2]: Pure genuine USD deposits totaling $10,000 qualify & preserve outbox/replay
  // -------------------------------------------------------------------------
  {
    const fsMem = new StrictInMemoryFirestore();
    const userId = 'uid_rwd_genuine_10k';
    const userPan = '1097890123';
    const initialMemTxIds = new Set(inMemoryDb.transactions.map((t) => t.id));
    const rwdDeps = {
      firestore: fsMem as unknown as Firestore,
      isAdminConfigured: () => true,
      persistNotification: async (n: any) => ({ ...n, read: false }),
    };

    try {
      await fsMem.collection('users').doc(userId).set({
        id: userId,
        firstName: 'Maya',
        lastName: 'Genuine',
        permanentAccountNumber: userPan,
        status: 'active',
        createdAt: '2026-02-03T00:00:00.000Z',
      });
      await fsMem.collection('accounts').doc(userId).set({
        userId,
        permanentAccountNumber: userPan,
        checkingBalance: 10000,
        savingsBalance: 0,
        investedBalance: 0,
        accruedEarnings: 0,
        totalBalance: 10000,
        availableBalance: 10000,
      });
      await fsMem.collection('transactions').doc('tx_pure_dep_1').set({
        id: 'tx_pure_dep_1',
        userId,
        recipientUserId: userId,
        type: 'DEPOSIT',
        category: 'Deposits',
        status: 'COMPLETED',
        amount: 4000,
        currency: 'USD',
        referenceNumber: 'STRIPE-cs_pure_4000',
        paymentProviderRef: 'STRIPE-cs_pure_4000',
        senderName: 'Debit / Credit Card Gateway',
        senderAccountNumber: 'STRIPE-cs_pure_4000',
        description: 'Deposit to Premier Checking via Debit / Credit Card Gateway',
      });
      await fsMem.collection('transactions').doc('tx_pure_dep_2').set({
        id: 'tx_pure_dep_2',
        userId,
        recipientUserId: userId,
        type: 'DEPOSIT',
        category: 'Deposits',
        status: 'COMPLETED',
        amount: 6000,
        currency: 'USD',
        referenceNumber: 'MV-DEP-PURE-6000',
        paymentProviderRef: 'MV-DEP-PURE-6000',
        senderName: 'Domestic FedWire',
        senderAccountNumber: 'EXTERNAL_GATEWAY',
        description: 'Deposit to Premier Checking via Domestic FedWire',
      });

      const paidRes = await evaluateAndProcessWelcomeReward(userId, rwdDeps);
      assert.strictEqual(paidRes.status, 'PAID');
      assert.strictEqual(paidRes.qualifyingDeposits, 10000);
      assert.strictEqual(paidRes.qualifyingDepositCount, 2);
      assert.strictEqual((await fsMem.collection('accounts').doc(userId).get()).data()?.checkingBalance, 11000);
      assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 1);

      const replayRes = await evaluateAndProcessWelcomeReward(userId, rwdDeps);
      assert.strictEqual(replayRes.status, 'PAID');
      assert.strictEqual((await fsMem.collection('accounts').doc(userId).get()).data()?.checkingBalance, 11000);
      assert.strictEqual((await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 1);
    } finally {
      for (let i = inMemoryDb.transactions.length - 1; i >= 0; i--) {
        const tx = inMemoryDb.transactions[i];
        if (!initialMemTxIds.has(tx.id) && tx.userId === userId) {
          inMemoryDb.transactions.splice(i, 1);
        }
      }
    }

    console.log('✓ Test 45 [3D-B1.3B.2] passed: Genuine USD deposits totaling $10,000 qualify cleanly with idempotent replay');
  }

  console.log('\nALL STAGE 3D-A / 3D-B1.1 / 3D-B1.2 / 3D-B1.3A / 3D-B1.3B / 3D-B1.3B.1 / 3D-B1.3B.2 OUTBOX TESTS PASSED (45/45).');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('\nStage 3D-A3 Verification Failed:', err);
  process.exit(1);
});
