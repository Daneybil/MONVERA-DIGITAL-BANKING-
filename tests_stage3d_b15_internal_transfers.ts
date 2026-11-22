/**
 * MONVERA — STAGE 3D-B1.5: INTERNAL ACCOUNT TRANSFER VERIFICATION SUITE
 *
 * Covers:
 *  1.  Checking -> Savings authoritative transfer (balances, totalBalance, availableBalance === checkingBalance)
 *  2.  Savings -> Checking authoritative transfer + integer-cent precision ($123.45)
 *  3.  Firestore persistence of transaction (`type: 'TRANSFER'`, `metadata.isInternalTransfer: true`),
 *      idempotency record, and scrubbed `notification_outbox` record (`PENDING`, `TRANSACTION`, `:COMPLETED`)
 *  4.  Idempotent replay with identical `idempotencyKey` returns duplicate safely with zero extra debit/outbox
 *  5.  Idempotency conflict (409) when reusing `idempotencyKey` with different amount or direction
 *  6.  Concurrent internal transfers (Promise.all with OCC) prevent double-spending & reset attempt state on retry
 *  7.  Insufficient funds in source sub-account fails even if other sub-account has ample balance
 *  8.  Strict input validation (same-account, invalid account type, <= 0, NaN, >2 decimals, missing idempotencyKey)
 *  9.  Fail-closed when Firestore is not configured (no volatile in-memory `db` fallback)
 * 10.  Frozen user profile rejected (`403 ACCOUNT_FROZEN`) with zero state/outbox mutation
 * 11.  Frozen source or destination sub-account rejected (`403 SUBACCOUNT_FROZEN`)
 * 12.  Missing `accounts/{uid}` document rejected (`404 ACCOUNT_NOT_FOUND`, never fabricates balance)
 * 13.  Account ownership mismatch rejected (`403 ACCOUNT_OWNERSHIP_MISMATCH`)
 * 14.  Preserves existing `accounts[]` metadata (accountNumber, nickname, routing, APY, INVESTMENT account) & `loanBalance`
 * 15.  Atomic rollback on notification outbox preparation or write failure (zero partial account/tx/idemp writes)
 * 16.  Auth guard, `sendInternalTransferWithAuthRetry` Bearer header + 401 refresh retry + idempotency key preservation
 * 17.  UI & ledger classification (`classifyTransactionFlow`, `/api/transactions` flow filter, `computeBalancesFromTransactions`)
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import type { Firestore } from 'firebase-admin/firestore';

import { executeServerInternalTransfer } from './server/firestoreTransactions';
import { computeNotificationOutboxId, NOTIFICATION_OUTBOX_COLLECTION } from './server/services/notificationOutbox';
import { requireFirebaseAuth } from './server/authMiddleware';
import { sendInternalTransferWithAuthRetry } from './src/services/api';
import { classifyTransactionFlow } from './src/components/dashboard/TransactionsView';
import { firestoreSync } from './src/services/firestoreSync';
import type { Transaction } from './src/types';

// ---------------------------------------------------------------------------
// Strict Firestore-Faithful In-Memory Harness (Read-Before-Write + OCC + Rollback)
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

class InMemoryCollectionRef {
  constructor(
    protected store: DocStore,
    public readonly colPath: string
  ) {}

  doc(id: string): InMemoryDocRef {
    return new InMemoryDocRef(this.store, `${this.colPath}/${id}`);
  }

  async get() {
    const docs = Array.from(this.store.get(this.colPath)?.entries() || []).map(([docId, entry]) => {
      const ref = new InMemoryDocRef(this.store, `${this.colPath}/${docId}`);
      return {
        id: docId,
        exists: true,
        ref,
        data: () => cloneVal(entry.data),
      };
    });
    return { empty: docs.length === 0, size: docs.length, docs };
  }
}

class InMemoryFirestore {
  public store: DocStore = new Map();
  public failOnPathPrefix: string | null = null;
  public onBeforeCommitOnce: (() => Promise<void> | void) | null = null;
  public lastTransactionAttempts = 0;

  collection(name: string): InMemoryCollectionRef {
    return new InMemoryCollectionRef(this.store, name);
  }

  countCollection(name: string): number {
    return this.store.get(name)?.size || 0;
  }

  async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    const maxAttempts = 6;
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
        get: async (ref: InMemoryDocRef) => {
          if (hasWritten) {
            throw new Error('Firestore transactions require all reads before writes.');
          }
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
          if (this.failOnPathPrefix && ref.path.startsWith(this.failOnPathPrefix)) {
            throw new Error(`SIMULATED_WRITE_FAILURE on ${ref.path}`);
          }
          pendingOps.push({ type: 'set', ref, data: cloneVal(data), merge: Boolean(opts?.merge) });
        },
        create: (ref: InMemoryDocRef, data: Record<string, any>) => {
          hasWritten = true;
          if (this.failOnPathPrefix && ref.path.startsWith(this.failOnPathPrefix)) {
            throw new Error(`SIMULATED_WRITE_FAILURE on ${ref.path}`);
          }
          pendingOps.push({ type: 'set', ref, data: cloneVal(data), merge: false });
        },
        delete: (ref: InMemoryDocRef) => {
          hasWritten = true;
          pendingOps.push({ type: 'delete', ref });
        },
      };

      const result = await fn(tx);

      if (this.onBeforeCommitOnce) {
        const hook = this.onBeforeCommitOnce;
        this.onBeforeCommitOnce = null;
        await hook();
      }

      // Optimistic concurrency check across all read documents
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
        if (attempt < maxAttempts) {
          continue;
        }
        throw new Error('ABORTED: Exhausted transaction concurrency retries');
      }

      for (const op of pendingOps) {
        if (op.type === 'delete') {
          await op.ref.delete();
        } else {
          await op.ref.set(op.data, { merge: op.merge });
        }
      }

      return result;
    }

    throw new Error('ABORTED: Transaction retry limit exceeded');
  }
}

async function seedCustomer(
  fsMem: InMemoryFirestore,
  uid: string,
  opts?: {
    checking?: number;
    savings?: number;
    invested?: number;
    accrued?: number;
    loanBalance?: number;
    status?: string;
    checkingStatus?: string;
    savingsStatus?: string;
    accountOwnerOverride?: string;
    omitAccountsDoc?: boolean;
  }
) {
  const checking = opts?.checking ?? 5000;
  const savings = opts?.savings ?? 2000;
  const invested = opts?.invested ?? 1500;
  const accrued = opts?.accrued ?? 125.5;
  const total = Number((checking + savings + invested + accrued).toFixed(2));

  await fsMem.collection('users').doc(uid).set({
    id: uid,
    uid,
    firstName: 'Morgan',
    lastName: 'Reed',
    permanentAccountNumber: '1045998877',
    status: opts?.status ?? 'active',
  });

  if (!opts?.omitAccountsDoc) {
    await fsMem.collection('accounts').doc(uid).set({
      userId: opts?.accountOwnerOverride ?? uid,
      permanentAccountNumber: '1045998877',
      accountTier: 'PRIVATE_WEALTH',
      customBankMetadata: { advisor: 'Bennett Johnson', kycTier: 3 },
      checkingBalance: checking,
      savingsBalance: savings,
      investedBalance: invested,
      accruedEarnings: accrued,
      totalBalance: total,
      availableBalance: checking,
      pendingBalance: 0,
      ...(opts?.loanBalance !== undefined ? { loanBalance: opts.loanBalance } : {}),
      accounts: [
        {
          id: `acc_chk_${uid}`,
          userId: uid,
          type: 'CHECKING',
          accountNumber: '1045998877',
          routingNumber: '021000021',
          currency: 'USD',
          balance: checking,
          availableBalance: checking,
          investedBalance: 0,
          pendingBalance: 0,
          interestRateAPY: 1.25,
          status: opts?.checkingStatus ?? 'ACTIVE',
          nickname: 'Custom Sovereign Checking',
        },
        {
          id: `acc_sav_${uid}`,
          userId: uid,
          type: 'SAVINGS',
          accountNumber: '1045998991',
          routingNumber: '021000021',
          currency: 'USD',
          balance: savings,
          availableBalance: savings,
          investedBalance: 0,
          pendingBalance: 0,
          interestRateAPY: 4.85,
          status: opts?.savingsStatus ?? 'ACTIVE',
          nickname: 'Custom High-Yield Vault',
        },
        {
          id: `acc_inv_${uid}`,
          userId: uid,
          type: 'INVESTMENT',
          accountNumber: '1045998777',
          routingNumber: '021000021',
          currency: 'USD',
          balance: invested,
          availableBalance: 0,
          investedBalance: invested,
          pendingBalance: 0,
          interestRateAPY: 12.5,
          status: 'ACTIVE',
          nickname: 'Custom Sovereign Treasury',
        },
      ],
    });
  }
}

async function runTests() {
  console.log('=== MONVERA STAGE 3D-B1.5: INTERNAL ACCOUNT TRANSFER VERIFICATION SUITE ===\n');

  // ---------------------------------------------------------------------------
  // TESTS 1, 2, 3, 14: Checking -> Savings, Savings -> Checking, Outbox, Metadata Preservation
  // ---------------------------------------------------------------------------
  {
    const fsMem = new InMemoryFirestore();
    const uid = 'uid_b15_cust_100000000001';
    await seedCustomer(fsMem, uid, { checking: 5000, savings: 2000, invested: 1500, accrued: 125.5, loanBalance: 900 });

    const deps = {
      firestore: fsMem as unknown as Firestore,
      isAdminConfigured: () => true,
    };

    // Checking -> Savings ($1,234.56)
    const res1 = await executeServerInternalTransfer(
      {
        userId: uid,
        fromAccountType: 'CHECKING',
        toAccountType: 'SAVINGS',
        amount: 1234.56,
        idempotencyKey: 'b15_chk_to_sav_1',
      },
      deps
    );

    assert.strictEqual(res1.success, true, `Expected C->S success, got ${res1.error}`);
    assert.strictEqual(res1.isDuplicate, false);
    assert.ok(res1.transaction, 'Transaction must be returned');
    assert.strictEqual(res1.transaction!.type, 'TRANSFER');
    assert.strictEqual(res1.transaction!.status, 'COMPLETED');
    assert.strictEqual(res1.transaction!.amount, 1234.56);
    assert.strictEqual(res1.transaction!.fee, 0);
    assert.strictEqual(res1.transaction!.currency, 'USD');
    assert.strictEqual(res1.transaction!.senderUserId, uid);
    assert.strictEqual(res1.transaction!.recipientUserId, uid);
    assert.strictEqual(res1.transaction!.metadata?.isInternalTransfer, true);
    assert.strictEqual(res1.transaction!.metadata?.sourceAccountType, 'CHECKING');
    assert.strictEqual(res1.transaction!.metadata?.destinationAccountType, 'SAVINGS');
    assert.strictEqual(res1.transaction!.senderAccountNumber, '1045998877');
    assert.strictEqual(res1.transaction!.recipientAccountNumber, '1045998991');

    // Balances & parity checks
    assert.strictEqual(res1.balanceMetrics?.checkingBalance, 3765.44);
    assert.strictEqual(res1.balanceMetrics?.savingsBalance, 3234.56);
    assert.strictEqual(res1.balanceMetrics?.availableBalance, 3765.44);
    assert.strictEqual(res1.balanceMetrics?.investedBalance, 1500);
    assert.strictEqual(res1.balanceMetrics?.accruedEarnings, 125.5);
    assert.strictEqual(res1.balanceMetrics?.loanBalance, 900);
    assert.strictEqual(res1.balanceMetrics?.totalBalance, 8625.5); // 5000 + 2000 + 1500 + 125.50

    // Preserved custom nicknames and INVESTMENT sub-account
    const chkSub = res1.balanceMetrics?.accounts?.find((a) => a.type === 'CHECKING');
    const savSub = res1.balanceMetrics?.accounts?.find((a) => a.type === 'SAVINGS');
    const invSub = res1.balanceMetrics?.accounts?.find((a) => a.type === 'INVESTMENT');
    assert.strictEqual(chkSub?.nickname, 'Custom Sovereign Checking');
    assert.strictEqual(savSub?.nickname, 'Custom High-Yield Vault');
    assert.strictEqual(invSub?.nickname, 'Custom Sovereign Treasury');
    assert.strictEqual(invSub?.balance, 1500);

    // Firestore persistence checks (accounts, transactions, idempotency, notification_outbox)
    const txSnap = await fsMem.collection('transactions').doc(res1.transaction!.id).get();
    assert.strictEqual(txSnap.exists, true, 'Transaction must be persisted in Firestore');

    const expectedOutboxId = computeNotificationOutboxId(
      uid,
      `${res1.transaction!.id}:COMPLETED`,
      'TRANSACTION'
    );
    const outboxSnap = await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(expectedOutboxId).get();
    assert.strictEqual(outboxSnap.exists, true, 'Outbox record must exist');
    const outboxData = outboxSnap.data()!;
    assert.strictEqual(outboxData.status, 'PENDING');
    assert.strictEqual(outboxData.dispatchType, 'TRANSACTION');
    assert.strictEqual(outboxData.lifecycleStage, 'COMPLETED');
    assert.strictEqual(outboxData.eventKey, `${res1.transaction!.id}:COMPLETED`);
    assert.strictEqual(outboxData.payload?.amount, 1234.56);
    assert.ok(!String(outboxData.payload?.body || '').includes('1045998877'), 'Outbox body must never expose full account number');
    assert.ok(String(outboxData.payload?.accountMasked || '').includes('8877'), 'Outbox accountMasked must retain last 4 masked');

    // Savings -> Checking ($234.56)
    const res2 = await executeServerInternalTransfer(
      {
        userId: uid,
        fromAccountType: 'SAVINGS',
        toAccountType: 'CHECKING',
        amount: 234.56,
        description: 'Move back to Checking',
        idempotencyKey: 'b15_sav_to_chk_1',
      },
      deps
    );
    assert.strictEqual(res2.success, true);
    assert.strictEqual(res2.balanceMetrics?.checkingBalance, 4000);
    assert.strictEqual(res2.balanceMetrics?.savingsBalance, 3000);
    assert.strictEqual(res2.balanceMetrics?.availableBalance, 4000);
    assert.strictEqual(res2.balanceMetrics?.totalBalance, 8625.5);
    assert.strictEqual(res2.transaction?.description, 'Move back to Checking');
    assert.strictEqual(res2.transaction?.metadata?.sourceAccountType, 'SAVINGS');
    assert.strictEqual(res2.transaction?.metadata?.destinationAccountType, 'CHECKING');

    console.log('✓ Test 1 passed: Checking<->Savings transfers update Firestore balances cleanly, preserve total & availableBalance parity, preserve metadata, and write durable outbox records');
  }

  // ---------------------------------------------------------------------------
  // TESTS 4 & 5: Idempotent Replay & 409 Conflict
  // ---------------------------------------------------------------------------
  {
    const fsMem = new InMemoryFirestore();
    const uid = 'uid_b15_idemp_200000000002';
    await seedCustomer(fsMem, uid, { checking: 3000, savings: 1000, invested: 0, accrued: 0 });
    const deps = { firestore: fsMem as unknown as Firestore, isAdminConfigured: () => true };

    const first = await executeServerInternalTransfer(
      {
        userId: uid,
        fromAccountType: 'CHECKING',
        toAccountType: 'SAVINGS',
        amount: 500,
        idempotencyKey: 'same_key_123',
      },
      deps
    );
    assert.strictEqual(first.success, true);
    assert.strictEqual(first.isDuplicate, false);

    // Exact replay
    const replay = await executeServerInternalTransfer(
      {
        userId: uid,
        fromAccountType: 'CHECKING',
        toAccountType: 'SAVINGS',
        amount: 500,
        idempotencyKey: 'same_key_123',
      },
      deps
    );
    assert.strictEqual(replay.success, true);
    assert.strictEqual(replay.isDuplicate, true);
    assert.strictEqual(replay.transaction?.id, first.transaction?.id);
    assert.strictEqual(replay.balanceMetrics?.checkingBalance, 2500);
    assert.strictEqual(replay.balanceMetrics?.savingsBalance, 1500);
    assert.strictEqual(fsMem.countCollection('transactions'), 1);
    assert.strictEqual(fsMem.countCollection(NOTIFICATION_OUTBOX_COLLECTION), 1);

    // Same key with changed amount -> 409
    const conflictAmount = await executeServerInternalTransfer(
      {
        userId: uid,
        fromAccountType: 'CHECKING',
        toAccountType: 'SAVINGS',
        amount: 750,
        idempotencyKey: 'same_key_123',
      },
      deps
    );
    assert.strictEqual(conflictAmount.success, false);
    assert.strictEqual(conflictAmount.statusCode, 409);
    assert.strictEqual(conflictAmount.errorCode, 'IDEMPOTENCY_CONFLICT');

    // Same key with swapped direction -> 409
    const conflictDir = await executeServerInternalTransfer(
      {
        userId: uid,
        fromAccountType: 'SAVINGS',
        toAccountType: 'CHECKING',
        amount: 500,
        idempotencyKey: 'same_key_123',
      },
      deps
    );
    assert.strictEqual(conflictDir.success, false);
    assert.strictEqual(conflictDir.statusCode, 409);
    assert.strictEqual(conflictDir.errorCode, 'IDEMPOTENCY_CONFLICT');

    const accAfter = (await fsMem.collection('accounts').doc(uid).get()).data()!;
    assert.strictEqual(accAfter.checkingBalance, 2500);
    assert.strictEqual(accAfter.savingsBalance, 1500);

    console.log('✓ Test 2 passed: Idempotency replay returns duplicate without double-debit/outbox; mismatched key reuse returns 409 conflict');
  }

  // ---------------------------------------------------------------------------
  // TEST 6: Concurrency Protection + OCC Attempt State Reset
  // ---------------------------------------------------------------------------
  {
    const fsMem = new InMemoryFirestore();
    const uid = 'uid_b15_race_300000000003';
    await seedCustomer(fsMem, uid, { checking: 1000, savings: 500, invested: 0, accrued: 0 });
    const deps = { firestore: fsMem as unknown as Firestore, isAdminConfigured: () => true };

    const [a, b] = await Promise.all([
      executeServerInternalTransfer(
        { userId: uid, fromAccountType: 'CHECKING', toAccountType: 'SAVINGS', amount: 600, idempotencyKey: 'race_key_a' },
        deps
      ),
      executeServerInternalTransfer(
        { userId: uid, fromAccountType: 'CHECKING', toAccountType: 'SAVINGS', amount: 600, idempotencyKey: 'race_key_b' },
        deps
      ),
    ]);

    const successes = [a, b].filter((r) => r.success);
    const failures = [a, b].filter((r) => !r.success);
    assert.strictEqual(successes.length, 1, 'Exactly one concurrent $600 transfer from $1,000 must succeed');
    assert.strictEqual(failures.length, 1, 'Second concurrent $600 transfer must fail');
    assert.strictEqual(failures[0].errorCode, 'INSUFFICIENT_FUNDS');

    const accAfterRace = (await fsMem.collection('accounts').doc(uid).get()).data()!;
    assert.strictEqual(accAfterRace.checkingBalance, 400);
    assert.strictEqual(accAfterRace.savingsBalance, 1100);
    assert.strictEqual(accAfterRace.totalBalance, 1500);
    assert.strictEqual(fsMem.countCollection('transactions'), 1);
    assert.strictEqual(fsMem.countCollection(NOTIFICATION_OUTBOX_COLLECTION), 1);

    // Simulate OCC conflict on attempt 1 where external write changed checkingBalance down to $100
    fsMem.onBeforeCommitOnce = async () => {
      const curr = (await fsMem.collection('accounts').doc(uid).get()).data()!;
      await fsMem.collection('accounts').doc(uid).set({ ...curr, checkingBalance: 100, availableBalance: 100 });
    };
    const retryRes = await executeServerInternalTransfer(
      { userId: uid, fromAccountType: 'CHECKING', toAccountType: 'SAVINGS', amount: 300, idempotencyKey: 'occ_retry_fail' },
      deps
    );
    assert.strictEqual(retryRes.success, false, 'Retry after balance dropped to $100 must fail with fresh state');
    assert.strictEqual(retryRes.errorCode, 'INSUFFICIENT_FUNDS');
    assert.strictEqual(fsMem.lastTransactionAttempts, 2);
    assert.strictEqual(fsMem.countCollection('transactions'), 1);

    console.log('✓ Test 3 passed: Concurrent internal transfers enforce OCC balance integrity and reset attempt state on retry');
  }

  // ---------------------------------------------------------------------------
  // TESTS 7, 8, 9, 10, 11, 12, 13: Failure Cases & Fail-Closed Guards
  // ---------------------------------------------------------------------------
  {
    const fsMem = new InMemoryFirestore();
    const uid = 'uid_b15_guard_400000000004';
    await seedCustomer(fsMem, uid, { checking: 50, savings: 5000, invested: 0, accrued: 0 });
    const deps = { firestore: fsMem as unknown as Firestore, isAdminConfigured: () => true };

    // 7. Insufficient funds in source checking even though savings has $5,000
    const insuf = await executeServerInternalTransfer(
      { userId: uid, fromAccountType: 'CHECKING', toAccountType: 'SAVINGS', amount: 100, idempotencyKey: 'insuf_1' },
      deps
    );
    assert.strictEqual(insuf.success, false);
    assert.strictEqual(insuf.statusCode, 400);
    assert.strictEqual(insuf.errorCode, 'INSUFFICIENT_FUNDS');

    // 8. Validation guards
    const sameAcc = await executeServerInternalTransfer(
      { userId: uid, fromAccountType: 'CHECKING', toAccountType: 'CHECKING', amount: 10, idempotencyKey: 'val_1' },
      deps
    );
    assert.strictEqual(sameAcc.errorCode, 'SAME_ACCOUNT_TRANSFER');

    const badAccType = await executeServerInternalTransfer(
      { userId: uid, fromAccountType: 'INVESTMENT' as any, toAccountType: 'SAVINGS', amount: 10, idempotencyKey: 'val_2' },
      deps
    );
    assert.strictEqual(badAccType.errorCode, 'INVALID_ACCOUNT_TYPE');

    const zeroAmt = await executeServerInternalTransfer(
      { userId: uid, fromAccountType: 'CHECKING', toAccountType: 'SAVINGS', amount: 0, idempotencyKey: 'val_3' },
      deps
    );
    assert.strictEqual(zeroAmt.errorCode, 'INVALID_AMOUNT');

    const threeDecAmt = await executeServerInternalTransfer(
      { userId: uid, fromAccountType: 'CHECKING', toAccountType: 'SAVINGS', amount: 10.123, idempotencyKey: 'val_4' },
      deps
    );
    assert.strictEqual(threeDecAmt.errorCode, 'INVALID_AMOUNT');

    const nanAmt = await executeServerInternalTransfer(
      { userId: uid, fromAccountType: 'CHECKING', toAccountType: 'SAVINGS', amount: Number.NaN, idempotencyKey: 'val_5' },
      deps
    );
    assert.strictEqual(nanAmt.errorCode, 'INVALID_AMOUNT');

    const missingKey = await executeServerInternalTransfer(
      { userId: uid, fromAccountType: 'CHECKING', toAccountType: 'SAVINGS', amount: 10, idempotencyKey: '   ' },
      deps
    );
    assert.strictEqual(missingKey.errorCode, 'IDEMPOTENCY_KEY_REQUIRED');

    // 9. Unconfigured Firestore fails closed (503)
    const unconfigured = await executeServerInternalTransfer(
      { userId: uid, fromAccountType: 'CHECKING', toAccountType: 'SAVINGS', amount: 10, idempotencyKey: 'val_6' },
      { firestore: fsMem as unknown as Firestore, isAdminConfigured: () => false }
    );
    assert.strictEqual(unconfigured.success, false);
    assert.strictEqual(unconfigured.statusCode, 503);
    assert.strictEqual(unconfigured.errorCode, 'FIRESTORE_NOT_CONFIGURED');

    // 10. Frozen customer profile
    const frozenUid = 'uid_b15_frozen_500000000005';
    await seedCustomer(fsMem, frozenUid, { checking: 1000, savings: 1000, status: 'frozen' });
    const frozenRes = await executeServerInternalTransfer(
      { userId: frozenUid, fromAccountType: 'CHECKING', toAccountType: 'SAVINGS', amount: 100, idempotencyKey: 'frz_1' },
      deps
    );
    assert.strictEqual(frozenRes.success, false);
    assert.strictEqual(frozenRes.statusCode, 403);
    assert.strictEqual(frozenRes.errorCode, 'ACCOUNT_FROZEN');

    // 11. Frozen sub-account
    const frozenSubUid = 'uid_b15_fsub_600000000006';
    await seedCustomer(fsMem, frozenSubUid, { checking: 1000, savings: 1000, savingsStatus: 'FROZEN' });
    const frozenSubRes = await executeServerInternalTransfer(
      { userId: frozenSubUid, fromAccountType: 'CHECKING', toAccountType: 'SAVINGS', amount: 100, idempotencyKey: 'fsub_1' },
      deps
    );
    assert.strictEqual(frozenSubRes.success, false);
    assert.strictEqual(frozenSubRes.statusCode, 403);
    assert.strictEqual(frozenSubRes.errorCode, 'SUBACCOUNT_FROZEN');

    // 12. Missing accounts doc
    const missingAccUid = 'uid_b15_noacc_700000000007';
    await seedCustomer(fsMem, missingAccUid, { omitAccountsDoc: true });
    const missingAccRes = await executeServerInternalTransfer(
      { userId: missingAccUid, fromAccountType: 'CHECKING', toAccountType: 'SAVINGS', amount: 100, idempotencyKey: 'noacc_1' },
      deps
    );
    assert.strictEqual(missingAccRes.success, false);
    assert.strictEqual(missingAccRes.statusCode, 404);
    assert.strictEqual(missingAccRes.errorCode, 'ACCOUNT_NOT_FOUND');

    // 13. Ownership mismatch
    const mismatchUid = 'uid_b15_owner_800000000008';
    await seedCustomer(fsMem, mismatchUid, { accountOwnerOverride: 'other_user_uid' });
    const mismatchRes = await executeServerInternalTransfer(
      { userId: mismatchUid, fromAccountType: 'CHECKING', toAccountType: 'SAVINGS', amount: 100, idempotencyKey: 'own_1' },
      deps
    );
    assert.strictEqual(mismatchRes.success, false);
    assert.strictEqual(mismatchRes.statusCode, 403);
    assert.strictEqual(mismatchRes.errorCode, 'ACCOUNT_OWNERSHIP_MISMATCH');

    assert.strictEqual(fsMem.countCollection('transactions'), 0);
    assert.strictEqual(fsMem.countCollection(NOTIFICATION_OUTBOX_COLLECTION), 0);

    console.log('✓ Test 4 passed: Insufficient funds, validation guards, fail-closed Firestore check, frozen user/sub-account, missing account, and ownership checks all fail cleanly');
  }

  // ---------------------------------------------------------------------------
  // TEST 15: Outbox Write Failure Rollback (Zero Partial Commits)
  // ---------------------------------------------------------------------------
  {
    const fsMem = new InMemoryFirestore();
    const uid = 'uid_b15_rb_900000000009';
    await seedCustomer(fsMem, uid, { checking: 2500, savings: 1000, invested: 0, accrued: 0 });
    fsMem.failOnPathPrefix = `${NOTIFICATION_OUTBOX_COLLECTION}/`;

    const rbWriteRes = await executeServerInternalTransfer(
      { userId: uid, fromAccountType: 'CHECKING', toAccountType: 'SAVINGS', amount: 400, idempotencyKey: 'rb_write_1' },
      { firestore: fsMem as unknown as Firestore, isAdminConfigured: () => true }
    );
    assert.strictEqual(rbWriteRes.success, false);
    assert.strictEqual(fsMem.countCollection('transactions'), 0, 'No transaction committed on outbox write failure');
    assert.strictEqual(fsMem.countCollection('internal_transfer_idempotency'), 0, 'No idempotency committed on outbox write failure');
    assert.strictEqual(fsMem.countCollection(NOTIFICATION_OUTBOX_COLLECTION), 0);
    const accAfterWriteRb = (await fsMem.collection('accounts').doc(uid).get()).data()!;
    assert.strictEqual(accAfterWriteRb.checkingBalance, 2500);
    assert.strictEqual(accAfterWriteRb.savingsBalance, 1000);

    // Also verify invalid/throwing outbox preparation aborts transaction atomically
    fsMem.failOnPathPrefix = null;
    const rbPrepRes = await executeServerInternalTransfer(
      { userId: uid, fromAccountType: 'CHECKING', toAccountType: 'SAVINGS', amount: 400, idempotencyKey: 'rb_prep_1' },
      {
        firestore: fsMem as unknown as Firestore,
        isAdminConfigured: () => true,
        prepareOutboxBatch: async () => ({
          readyItems: [],
          invalidItems: [{ valid: false, error: 'SIMULATED_INVALID_OUTBOX' }],
        }),
      }
    );
    assert.strictEqual(rbPrepRes.success, false);
    assert.strictEqual(rbPrepRes.errorCode, 'OUTBOX_INVALID_PAYLOAD');
    assert.strictEqual(fsMem.countCollection('transactions'), 0);
    assert.strictEqual(fsMem.countCollection('internal_transfer_idempotency'), 0);
    assert.strictEqual((await fsMem.collection('accounts').doc(uid).get()).data()!.checkingBalance, 2500);

    console.log('✓ Test 5 passed: Outbox preparation or write failure rolls back accounts, transactions, and idempotency atomically');
  }

  // ---------------------------------------------------------------------------
  // TEST 16: Route Auth Enforcement & Client Retry / Auth-Header Preservation
  // ---------------------------------------------------------------------------
  {
    const serverSource = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');
    assert.ok(
      serverSource.includes("app.post('/api/transfers/internal', requireFirebaseAuth"),
      'server.ts must enforce requireFirebaseAuth on POST /api/transfers/internal'
    );
    assert.ok(
      serverSource.includes("FORBIDDEN_USER_MISMATCH"),
      'server.ts must reject mismatched req.body.userId against authenticated token UID'
    );

    // Verify requireFirebaseAuth middleware rejects missing Authorization header with 401
    let statusAssigned = 0;
    let jsonPayload: any = null;
    let nextCalled = false;
    await requireFirebaseAuth(
      { headers: {} } as any,
      {
        status(code: number) {
          statusAssigned = code;
          return this;
        },
        json(payload: any) {
          jsonPayload = payload;
          return this;
        },
      } as any,
      () => {
        nextCalled = true;
      }
    );
    assert.strictEqual(nextCalled, false);
    assert.strictEqual(statusAssigned, 401);
    assert.ok(jsonPayload?.error);

    // Verify client sendInternalTransferWithAuthRetry rejects signed-out callers cleanly
    const unauthClient = await sendInternalTransferWithAuthRetry(
      {
        userId: 'uid_spoof',
        fromAccountType: 'CHECKING',
        toAccountType: 'SAVINGS',
        amount: 200,
        idempotencyKey: 'client_unauth_1',
      },
      { hasAuthenticatedUser: () => false }
    );
    assert.strictEqual(unauthClient.success, false);
    assert.strictEqual(unauthClient.errorCode, 'UNAUTHORIZED');

    // Verify client attaches Authorization Bearer header, retries 401 with refreshed token,
    // preserves identical idempotencyKey, and strips client userId from POST payload
    const capturedCalls: Array<{ headers: Record<string, string>; body: any }> = [];
    const retryRes = await sendInternalTransferWithAuthRetry(
      {
        userId: 'uid_client_1',
        fromAccountType: 'CHECKING',
        toAccountType: 'SAVINGS',
        amount: 350,
        idempotencyKey: 'client_retry_key_99',
      },
      {
        hasAuthenticatedUser: () => true,
        buildHeaders: async (forceRefresh) => ({
          'Content-Type': 'application/json',
          Authorization: forceRefresh ? 'Bearer fresh_tok' : 'Bearer stale_tok',
        }),
        fetchFn: async (_endpoint, init) => {
          const headers = (init?.headers || {}) as Record<string, string>;
          const body = JSON.parse(String(init?.body || '{}'));
          capturedCalls.push({ headers, body });
          if (headers.Authorization === 'Bearer stale_tok') {
            return new Response(JSON.stringify({ error: 'Token expired' }), {
              status: 401,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response(
            JSON.stringify({
              success: true,
              transaction: {
                id: 'tx_int_ok',
                referenceNumber: 'MV-INT-OK',
                type: 'TRANSFER',
                amount: 350,
                currency: 'USD',
                status: 'COMPLETED',
                userId: 'uid_client_1',
                senderUserId: 'uid_client_1',
                recipientUserId: 'uid_client_1',
                description: 'Internal Transfer: Checking to Savings',
                category: 'Transfers',
                createdAt: new Date().toISOString(),
              },
              balanceMetrics: {
                checkingBalance: 650,
                savingsBalance: 850,
                investedBalance: 0,
                accruedEarnings: 0,
                totalBalance: 1500,
                availableBalance: 650,
                pendingBalance: 0,
                accounts: [],
              },
              isDuplicate: false,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        },
      }
    );

    assert.strictEqual(retryRes.success, true);
    assert.strictEqual(capturedCalls.length, 2, 'Should retry once after 401 token refresh');
    assert.strictEqual(capturedCalls[0].headers.Authorization, 'Bearer stale_tok');
    assert.strictEqual(capturedCalls[1].headers.Authorization, 'Bearer fresh_tok');
    assert.strictEqual(capturedCalls[0].body.idempotencyKey, 'client_retry_key_99');
    assert.strictEqual(capturedCalls[1].body.idempotencyKey, 'client_retry_key_99');
    assert.strictEqual(capturedCalls[0].body.userId, undefined, 'Client must not send trusted userId in body');

    console.log('✓ Test 6 passed: Auth middleware returns 401 unauthenticated, server blocks userId spoofing, and client attaches Bearer token + retries 401 with preserved idempotencyKey');
  }

  // ---------------------------------------------------------------------------
  // TEST 17: UI Classification & Balance Computation Parity
  // ---------------------------------------------------------------------------
  {
    const uid = 'uid_ui_check_1';
    const internalChkToSav: Transaction = {
      id: 'tx_int_1',
      referenceNumber: 'MV-INT-AAA111',
      type: 'TRANSFER',
      amount: 500,
      currency: 'USD',
      status: 'COMPLETED',
      userId: uid,
      senderUserId: uid,
      recipientUserId: uid,
      senderAccountNumber: '1045998877',
      recipientAccountNumber: '1045998991',
      fee: 0,
      description: 'Custom savings allocation',
      category: 'Transfers',
      createdAt: new Date().toISOString(),
      metadata: {
        isInternalTransfer: true,
        sourceAccountType: 'CHECKING',
        destinationAccountType: 'SAVINGS',
      },
    };
    const internalSavToChk: Transaction = {
      ...internalChkToSav,
      id: 'tx_int_2',
      referenceNumber: 'MV-INT-BBB222',
      amount: 200,
      description: 'Internal Transfer: Savings to Checking',
      metadata: {
        isInternalTransfer: true,
        sourceAccountType: 'SAVINGS',
        destinationAccountType: 'CHECKING',
      },
    };
    const externalIncomingTransfer: Transaction = {
      id: 'tx_c2c_in',
      referenceNumber: 'MV-TRF-IN1',
      type: 'TRANSFER',
      amount: 1000,
      currency: 'USD',
      status: 'COMPLETED',
      userId: 'other_sender',
      senderUserId: 'other_sender',
      recipientUserId: uid,
      fee: 0,
      description: 'External peer credit',
      category: 'Transfers',
      createdAt: new Date().toISOString(),
    };
    const externalOutgoingTransfer: Transaction = {
      id: 'tx_c2c_out',
      referenceNumber: 'MV-TRF-OUT1',
      type: 'TRANSFER',
      amount: 250,
      currency: 'USD',
      status: 'COMPLETED',
      userId: uid,
      senderUserId: uid,
      recipientUserId: 'other_recipient',
      fee: 0,
      description: 'External peer debit',
      category: 'Transfers',
      createdAt: new Date().toISOString(),
    };

    const c1 = classifyTransactionFlow(internalChkToSav, uid, uid, '1045998877');
    assert.strictEqual(c1.isInternalTransfer, true);
    assert.strictEqual(c1.isCredit, false);
    assert.strictEqual(c1.flowKind, 'INTERNAL');
    assert.strictEqual(c1.sourceAccountLabel, 'Checking');
    assert.strictEqual(c1.destAccountLabel, 'High-Yield Savings');

    const c2 = classifyTransactionFlow(internalSavToChk, uid, uid, '1045998877');
    assert.strictEqual(c2.isInternalTransfer, true);
    assert.strictEqual(c2.flowKind, 'INTERNAL');
    assert.strictEqual(c2.sourceAccountLabel, 'High-Yield Savings');
    assert.strictEqual(c2.destAccountLabel, 'Checking');

    const c3 = classifyTransactionFlow(externalIncomingTransfer, uid, uid, '1045998877');
    assert.strictEqual(c3.isInternalTransfer, false);
    assert.strictEqual(c3.isCredit, true);
    assert.strictEqual(c3.flowKind, 'CREDIT');

    const c4 = classifyTransactionFlow(externalOutgoingTransfer, uid, uid, '1045998877');
    assert.strictEqual(c4.isInternalTransfer, false);
    assert.strictEqual(c4.isCredit, false);
    assert.strictEqual(c4.flowKind, 'DEBIT');

    // computeBalancesFromTransactions should handle both C->S (with custom description) and S->C cleanly
    const computed = firestoreSync.computeBalancesFromTransactions(
      uid,
      [externalIncomingTransfer, internalChkToSav, internalSavToChk],
      [],
      '1045998877'
    );
    // Start 0 + 1000 Checking - 500 Checking (+500 Savings) + 200 Checking (-200 Savings) => Checking 700, Savings 300, Total 1000
    assert.strictEqual(computed.checkingBalance, 700);
    assert.strictEqual(computed.savingsBalance, 300);
    assert.strictEqual(computed.availableBalance, 700);
    assert.strictEqual(computed.totalBalance, 1000);

    console.log('✓ Test 7 passed: UI classification treats internal transfers as neutral INTERNAL (preserving C2C classification) and computeBalancesFromTransactions reconciles Checking/Savings accurately');
  }

  console.log('\n🎉 ALL STAGE 3D-B1.5 INTERNAL ACCOUNT TRANSFER TESTS PASSED.');
}

runTests().catch((err) => {
  console.error('❌ Stage 3D-B1.5 test suite failed:', err);
  process.exit(1);
});
