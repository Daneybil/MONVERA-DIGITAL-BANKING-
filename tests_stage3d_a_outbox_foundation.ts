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
  executeServerDeposit,
  executeServerTransfer,
  executeServerWithdrawal,
  reverseServerFirestoreWithdrawal,
} from './server/firestoreTransactions';

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

  collection(name: string): InMemoryCollectionRef {
    return new InMemoryCollectionRef(this.store, name);
  }

  async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
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

    if (this.failNextTransactionWrite && pendingOps.length > 0) {
      this.failNextTransactionWrite = false;
      throw new Error('SIMULATED_FIRESTORE_COMMIT_FAILURE');
    }

    // Optimistic concurrency validation at commit time (if any read doc changed concurrently, abort!)
    for (const [docPath, expectedVersion] of readVersions.entries()) {
      const idx = docPath.lastIndexOf('/');
      const colPath = docPath.slice(0, idx);
      const docId = docPath.slice(idx + 1);
      const currentVersion = this.store.get(colPath)?.get(docId)?.version ?? 0;
      if (currentVersion !== expectedVersion) {
        throw new Error(`ABORTED: Concurrent transaction conflict on ${docPath}`);
      }
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

  console.log('\nALL STAGE 3D-A / 3D-B1.1 OUTBOX TESTS PASSED (25/25).');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('\nStage 3D-A3 Verification Failed:', err);
  process.exit(1);
});
