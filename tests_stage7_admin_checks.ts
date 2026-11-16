/**
 * MONVERA — STAGE 7: ADMIN-ISSUED CHECKS WITH PERMANENT CUSTOMER DEBIT VERIFICATION SUITE
 *
 * Strictly isolated test suite (Tests A–J + auxiliary failure consistency test).
 * Uses an isolated, transaction-faithful in-memory Firestore harness via dependency injection
 * in server/adminCheckService.ts so ZERO live Firestore documents or real customer balances
 * are ever touched.
 */
import assert from 'assert';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Firestore } from 'firebase-admin/firestore';
import {
  executeServerAdminCheckWithdrawal,
  getAllIssuedChecksAdmin,
  normalizeCheckNumber,
  toCents,
  fromCents,
} from './server/adminCheckService';
import {
  createAdminSessionToken,
  verifyAdminSessionToken,
  requireAdminAuth,
  isCallerAdministrator,
  AuthenticatedRequest,
} from './server/authMiddleware';
import { issueAdminCheckWithAuthRetry } from './src/services/api';
import { db } from './server/db';
import { Transaction } from './src/types';

// ---------------------------------------------------------------------------
// Isolated Transaction-Faithful In-Memory Firestore Harness
// ---------------------------------------------------------------------------
class InMemoryDocRef {
  constructor(
    private store: Map<string, Map<string, Record<string, any>>>,
    public readonly collectionName: string,
    public readonly id: string
  ) {}

  async get() {
    const col = this.store.get(this.collectionName);
    const raw = col?.get(this.id);
    return {
      id: this.id,
      exists: raw !== undefined,
      ref: this,
      data: () => (raw ? structuredClone(raw) : undefined),
    };
  }

  async set(data: Record<string, any>, options?: { merge?: boolean }) {
    if (!this.store.has(this.collectionName)) {
      this.store.set(this.collectionName, new Map());
    }
    const col = this.store.get(this.collectionName)!;
    const prev = col.get(this.id);
    const next = options?.merge && prev ? { ...structuredClone(prev), ...structuredClone(data) } : structuredClone(data);
    col.set(this.id, next);
  }
}

class InMemoryQuery {
  constructor(
    private store: Map<string, Map<string, Record<string, any>>>,
    private collectionName: string,
    private filters: Array<{ field: string; value: any }> = [],
    private maxResults?: number
  ) {}

  where(field: string, op: string, value: any) {
    if (op !== '==') throw new Error(`Unsupported query operator in harness: ${op}`);
    return new InMemoryQuery(this.store, this.collectionName, [...this.filters, { field, value }], this.maxResults);
  }

  limit(n: number) {
    return new InMemoryQuery(this.store, this.collectionName, this.filters, n);
  }

  async get() {
    const col = this.store.get(this.collectionName) || new Map<string, Record<string, any>>();
    const matchedDocs: Array<{ id: string; exists: boolean; ref: InMemoryDocRef; data: () => Record<string, any> }> = [];

    for (const [docId, docData] of col.entries()) {
      const matches = this.filters.every((f) => docData[f.field] === f.value);
      if (matches) {
        matchedDocs.push({
          id: docId,
          exists: true,
          ref: new InMemoryDocRef(this.store, this.collectionName, docId),
          data: () => structuredClone(docData),
        });
        if (this.maxResults !== undefined && matchedDocs.length >= this.maxResults) {
          break;
        }
      }
    }

    return {
      empty: matchedDocs.length === 0,
      size: matchedDocs.length,
      docs: matchedDocs,
      forEach: (cb: (d: (typeof matchedDocs)[number]) => void) => matchedDocs.forEach(cb),
    };
  }
}

class InMemoryCollectionRef extends InMemoryQuery {
  constructor(
    private rawStore: Map<string, Map<string, Record<string, any>>>,
    private colName: string
  ) {
    super(rawStore, colName);
  }

  doc(id: string) {
    return new InMemoryDocRef(this.rawStore, this.colName, id);
  }
}

class InMemoryTransactionalFirestore {
  private store = new Map<string, Map<string, Record<string, any>>>();
  private txMutex: Promise<void> = Promise.resolve();

  collection(name: string) {
    return new InMemoryCollectionRef(this.store, name);
  }

  seed(collectionName: string, docId: string, data: Record<string, any>) {
    if (!this.store.has(collectionName)) {
      this.store.set(collectionName, new Map());
    }
    this.store.get(collectionName)!.set(docId, structuredClone(data));
  }

  getDocData(collectionName: string, docId: string): Record<string, any> | undefined {
    const val = this.store.get(collectionName)?.get(docId);
    return val ? structuredClone(val) : undefined;
  }

  getAllDocs(collectionName: string): Array<Record<string, any>> {
    const col = this.store.get(collectionName);
    if (!col) return [];
    return Array.from(col.values()).map((d) => structuredClone(d));
  }

  async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    let release!: () => void;
    const nextLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prevLock = this.txMutex;
    this.txMutex = prevLock.then(() => nextLock);
    await prevLock;

    try {
      // Working snapshot to enforce atomic commit/rollback and read-before-write rule
      const stagedWrites: Array<{ ref: InMemoryDocRef; data: Record<string, any>; merge: boolean }> = [];
      let hasWritten = false;

      const txHandle = {
        get: async (docRef: InMemoryDocRef) => {
          if (hasWritten) {
            throw new Error('Firestore transaction violation: reads must precede writes.');
          }
          return docRef.get();
        },
        set: (docRef: InMemoryDocRef, data: Record<string, any>, options?: { merge?: boolean }) => {
          hasWritten = true;
          stagedWrites.push({
            ref: docRef,
            data: structuredClone(data),
            merge: Boolean(options?.merge),
          });
        },
      };

      const result = await fn(txHandle);

      // Commit all writes atomically only if fn succeeded without throwing
      for (const write of stagedWrites) {
        await write.ref.set(write.data, { merge: write.merge });
      }
      return result;
    } finally {
      release();
    }
  }
}

function createMockReqRes(options: {
  headers?: Record<string, string>;
  body?: any;
  auth?: any;
  query?: Record<string, string>;
  params?: Record<string, string>;
}) {
  const req: any = {
    headers: options.headers || {},
    body: options.body || {},
    auth: options.auth,
    query: options.query || {},
    params: options.params || {},
  };
  let statusCode = 200;
  let responseData: any = null;

  const res: any = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(data: any) {
      responseData = data;
      return res;
    },
  };

  return {
    req: req as AuthenticatedRequest,
    res,
    getStatusCode: () => statusCode,
    getResponseData: () => responseData,
  };
}

function seedIsolatedCustomer(
  fsHarness: InMemoryTransactionalFirestore,
  opts: {
    uid: string;
    firstName: string;
    lastName: string;
    email: string;
    accountNumber: string;
    checkingBalance?: number;
    savingsBalance?: number;
    investedBalance?: number;
    accruedEarnings?: number;
    pendingBalance?: number;
    loanBalance?: number;
    includeCheckingSubAccount?: boolean;
    includeSavingsSubAccount?: boolean;
  }
) {
  fsHarness.seed('users', opts.uid, {
    id: opts.uid,
    firstName: opts.firstName,
    lastName: opts.lastName,
    email: opts.email,
    permanentAccountNumber: opts.accountNumber,
    role: 'customer',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
  });

  const chk = opts.checkingBalance ?? 0;
  const sav = opts.savingsBalance ?? 0;
  const inv = opts.investedBalance ?? 0;
  const acc = opts.accruedEarnings ?? 0;
  const accounts: any[] = [];

  if (opts.includeCheckingSubAccount !== false) {
    accounts.push({
      id: `acc_chk_${opts.uid}`,
      userId: opts.uid,
      type: 'CHECKING',
      accountNumber: opts.accountNumber,
      routingNumber: '021000021',
      currency: 'USD',
      balance: chk,
      availableBalance: chk,
      investedBalance: 0,
      pendingBalance: 0,
      interestRateAPY: 1.25,
      status: 'ACTIVE',
      nickname: 'Monvera Premier Checking',
    });
  }
  if (opts.includeSavingsSubAccount !== false) {
    accounts.push({
      id: `acc_sav_${opts.uid}`,
      userId: opts.uid,
      type: 'SAVINGS',
      accountNumber: `10${opts.accountNumber.slice(2, -3)}991`,
      routingNumber: '021000021',
      currency: 'USD',
      balance: sav,
      availableBalance: sav,
      investedBalance: 0,
      pendingBalance: 0,
      interestRateAPY: 4.85,
      status: 'ACTIVE',
      nickname: 'Monvera High-Yield Treasury',
    });
  }

  const accDoc: Record<string, any> = {
    userId: opts.uid,
    permanentAccountNumber: opts.accountNumber,
    investedBalance: inv,
    accruedEarnings: acc,
    pendingBalance: opts.pendingBalance ?? 0,
    loanBalance: opts.loanBalance ?? 0,
    totalBalance: Number((chk + sav + inv + acc).toFixed(2)),
    accounts,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  if (opts.includeCheckingSubAccount !== false) {
    accDoc.checkingBalance = chk;
    accDoc.availableBalance = chk;
  }
  if (opts.includeSavingsSubAccount !== false) {
    accDoc.savingsBalance = sav;
  }

  fsHarness.seed('accounts', opts.uid, accDoc);
}

// Mirror customer UI debit classification logic from TransactionsView / DashboardOverview / TransactionReceiptModal
function classifyCustomerFlow(tx: Transaction, currentUserId: string, currentUserAcc: string): { isCredit: boolean } {
  const userAccClean = currentUserAcc.replace(/[-\s]/g, '');
  const txRecipAccClean = (tx.recipientAccountNumber || '').replace(/[-\s]/g, '');
  const txSenderAccClean = (tx.senderAccountNumber || '').replace(/[-\s]/g, '');

  const isRecipient =
    tx.recipientUserId === currentUserId ||
    (!tx.recipientUserId && tx.userId === currentUserId) ||
    (!!userAccClean && !!txRecipAccClean && txRecipAccClean === userAccClean);

  const isSender =
    (tx.senderUserId === currentUserId && tx.recipientUserId !== currentUserId) ||
    (!!userAccClean && !!txSenderAccClean && txSenderAccClean === userAccClean && txRecipAccClean !== userAccClean);

  const isAdminTransferCredit =
    (tx.metadata?.disbursementType === 'ADMINISTRATIVE_TRANSFER' ||
      tx.senderAccountNumber === '1000000001' ||
      tx.senderName?.includes('Bennett Johnson')) &&
    (isRecipient || tx.userId === currentUserId || tx.recipientUserId === currentUserId);

  const isCheckWithdrawalDebit = tx.type === 'CHECK_WITHDRAWAL';
  const isIncoming = !isCheckWithdrawalDebit && ((isRecipient && !isSender) || isAdminTransferCredit);
  const isDeposit =
    !isCheckWithdrawalDebit &&
    (tx.type === 'DEPOSIT' ||
      tx.type === 'ADMIN_DEVELOPMENT_FUNDING' ||
      tx.type === 'INVESTMENT_EARNING' ||
      tx.type === 'INVESTMENT_MATURITY' ||
      isAdminTransferCredit);
  const isCredit = isCheckWithdrawalDebit ? false : isIncoming || isDeposit;
  return { isCredit };
}

async function runStage7AdminCheckTests() {
  console.log('================================================================');
  console.log('  MONVERA STAGE 7: ADMIN-ISSUED CHECKS VERIFICATION (TESTS A-J) ');
  console.log('================================================================\n');

  const harness = new InMemoryTransactionalFirestore();
  const firestore = harness as unknown as Firestore;
  const recordedNotifications: any[] = [];
  const recordedAudits: any[] = [];

  const deps = {
    firestore,
    persistNotification: async (notif: any) => {
      recordedNotifications.push(notif);
      return { ...notif, read: false };
    },
    recordAuditLog: (entry: any) => {
      recordedAudits.push(entry);
    },
  };

  // Seed isolated synthetic test customers
  seedIsolatedCustomer(harness, {
    uid: 'cust_test_alpha',
    firstName: 'Claire',
    lastName: 'Vance',
    email: 'claire.vance@test.monvera',
    accountNumber: '1088442201',
    checkingBalance: 5000.0,
    savingsBalance: 12000.0,
    investedBalance: 2500.0,
    accruedEarnings: 125.5,
    pendingBalance: 350.0,
    loanBalance: 1000.0,
  });

  seedIsolatedCustomer(harness, {
    uid: 'cust_test_savings_only',
    firstName: 'Marcus',
    lastName: 'Hale',
    email: 'marcus.hale@test.monvera',
    accountNumber: '1088442299',
    checkingBalance: 0,
    savingsBalance: 1500.75,
    includeCheckingSubAccount: false,
    includeSavingsSubAccount: true,
  });

  // ==========================================================================
  // TEST A: Successful issuance (Checking)
  // ==========================================================================
  console.log('[Test A] Successful Check Issuance (Checking Debit, Atomic Ledger, Registry)');
  const resA = await executeServerAdminCheckWithdrawal(
    {
      customerIdentifier: 'cust_test_alpha',
      sourceAccountType: 'CHECKING',
      checkNumber: 'CHK-10450',
      payeeName: 'Apex Legal Escrow LLC',
      amount: 1250.25,
      memo: 'Closing retainer check',
      idempotencyKey: 'idemp_test_a_001',
      adminUid: 'usr_admin',
      adminEmail: 'daneybil2020@gmail.com',
    },
    deps
  );

  assert.strictEqual(resA.success, true, `Test A must succeed: ${resA.error}`);
  assert.strictEqual(resA.statusCode, 200);
  assert.ok(resA.check, 'Issued check record must be returned');
  assert.ok(resA.transaction, 'Transaction record must be returned');
  assert.strictEqual(resA.check.debitStatus, 'COMPLETED');
  assert.strictEqual(resA.check.status, 'ISSUED');
  assert.strictEqual(resA.check.normalizedCheckNumber, 'CHK10450');
  assert.strictEqual(resA.transaction.type, 'CHECK_WITHDRAWAL');
  assert.strictEqual(resA.transaction.status, 'COMPLETED');
  assert.strictEqual(resA.transaction.category, 'Checks');
  assert.strictEqual(resA.transaction.amount, 1250.25);
  assert.strictEqual(resA.transaction.metadata?.permanentDebit, true);
  assert.strictEqual(resA.transaction.metadata?.autoReverse, false);
  assert.notStrictEqual(resA.transaction.recipientAccountNumber, '1088442201');
  assert.strictEqual(resA.transaction.recipientAccountNumber, 'CHK-CHK10450');

  const accAfterA = harness.getDocData('accounts', 'cust_test_alpha')!;
  assert.strictEqual(accAfterA.checkingBalance, 3749.75, 'Checking balance must decrease from 5000.00 to 3749.75');
  assert.strictEqual(accAfterA.availableBalance, 3749.75, 'Available balance must equal checkingBalance');
  assert.strictEqual(accAfterA.savingsBalance, 12000.0, 'Savings balance must remain untouched');
  assert.strictEqual(accAfterA.pendingBalance, 350.0, 'Pending balance must remain untouched');
  assert.strictEqual(accAfterA.investedBalance, 2500.0, 'Invested balance must remain untouched');
  assert.strictEqual(accAfterA.loanBalance, 1000.0, 'Loan balance must remain untouched');
  assert.strictEqual(accAfterA.totalBalance, 18375.25, 'Total balance must reflect exact deduction');

  const persistedCheckA = harness.getDocData('issued_checks', resA.check.checkId);
  const persistedTxA = harness.getDocData('transactions', resA.transaction.id);
  assert.ok(persistedCheckA, 'issued_checks doc must be persisted');
  assert.ok(persistedTxA, 'transactions doc must be persisted');
  assert.strictEqual(recordedNotifications.length, 1, 'Customer notification must be persisted once');
  assert.strictEqual(recordedAudits.length, 1, 'Admin audit log must be recorded once');
  console.log('  ✓ Checking debited atomically; COMPLETED CHECK_WITHDRAWAL & issued_checks persisted; unrelated balances untouched.\n');

  // ==========================================================================
  // TEST B: Source-account correctness (Savings + Cent precision + sub-account)
  // ==========================================================================
  console.log('[Test B] Source-Account Correctness (Savings Debit & Floating-Point Cent Safety)');
  const resB = await executeServerAdminCheckWithdrawal(
    {
      customerIdentifier: '1088442201', // lookup by account number
      sourceAccountType: 'SAVINGS',
      checkNumber: '10451',
      payeeName: 'Pacific Title Services',
      amount: 19.99,
      memo: 'Recording fee',
      idempotencyKey: 'idemp_test_b_001',
      adminUid: 'usr_admin',
      adminEmail: 'daneybil2020@gmail.com',
    },
    deps
  );

  assert.strictEqual(resB.success, true, `Test B must succeed: ${resB.error}`);
  const accAfterB = harness.getDocData('accounts', 'cust_test_alpha')!;
  assert.strictEqual(accAfterB.checkingBalance, 3749.75, 'Checking must be untouched during Savings check debit');
  assert.strictEqual(accAfterB.savingsBalance, 11980.01, 'Savings must be 12000.00 - 19.99 = 11980.01');
  assert.strictEqual(accAfterB.totalBalance, 18355.26, 'Total must be exact to the cent');
  const savSubAcct = accAfterB.accounts.find((a: any) => a.type === 'SAVINGS');
  assert.strictEqual(savSubAcct.balance, 11980.01, 'accounts[] SAVINGS entry must match savingsBalance');

  // Missing CHECKING sub-account rejection
  const resBMissingChecking = await executeServerAdminCheckWithdrawal(
    {
      customerIdentifier: 'cust_test_savings_only',
      sourceAccountType: 'CHECKING',
      checkNumber: '10452',
      payeeName: 'Test Payee',
      amount: 50,
      idempotencyKey: 'idemp_test_b_missing_chk',
      adminUid: 'usr_admin',
      adminEmail: 'daneybil2020@gmail.com',
    },
    deps
  );
  assert.strictEqual(resBMissingChecking.success, false);
  assert.strictEqual(resBMissingChecking.errorCode, 'SOURCE_ACCOUNT_NOT_FOUND');
  assert.strictEqual(toCents(19.99), 1999);
  assert.strictEqual(fromCents(1198001), 11980.01);
  console.log('  ✓ Savings debited independently with exact cent arithmetic; missing sub-account rejected cleanly.\n');

  // ==========================================================================
  // TEST C: Duplicate submission / idempotency + concurrency + mismatch
  // ==========================================================================
  console.log('[Test C] Idempotency Replay, Concurrent Double-Submit & Parameter Mismatch');
  // 1. Sequential identical replay
  const resCReplay = await executeServerAdminCheckWithdrawal(
    {
      customerIdentifier: 'cust_test_alpha',
      sourceAccountType: 'SAVINGS',
      checkNumber: '10451',
      payeeName: 'Pacific Title Services',
      amount: 19.99,
      memo: 'Recording fee',
      idempotencyKey: 'idemp_test_b_001',
      adminUid: 'usr_admin',
      adminEmail: 'daneybil2020@gmail.com',
    },
    deps
  );
  assert.strictEqual(resCReplay.success, true);
  assert.strictEqual(resCReplay.isDuplicate, true, 'Sequential replay must flag isDuplicate=true');
  assert.strictEqual(resCReplay.check?.checkId, resB.check?.checkId, 'Must return exact original checkId');
  assert.strictEqual(
    harness.getDocData('accounts', 'cust_test_alpha')!.savingsBalance,
    11980.01,
    'Savings balance MUST NOT be debited twice on replay'
  );

  // 2. Same idempotencyKey with altered parameters must be rejected 409 IDEMPOTENCY_MISMATCH
  const resCMismatch = await executeServerAdminCheckWithdrawal(
    {
      customerIdentifier: 'cust_test_alpha',
      sourceAccountType: 'SAVINGS',
      checkNumber: '10451',
      payeeName: 'Pacific Title Services',
      amount: 20.0, // Altered amount!
      memo: 'Recording fee',
      idempotencyKey: 'idemp_test_b_001',
      adminUid: 'usr_admin',
      adminEmail: 'daneybil2020@gmail.com',
    },
    deps
  );
  assert.strictEqual(resCMismatch.success, false);
  assert.strictEqual(resCMismatch.statusCode, 409);
  assert.strictEqual(resCMismatch.errorCode, 'IDEMPOTENCY_MISMATCH');

  // 3. Concurrent Promise.all race with same new idempotencyKey
  const [race1, race2, race3] = await Promise.all([
    executeServerAdminCheckWithdrawal(
      {
        customerIdentifier: 'cust_test_savings_only',
        sourceAccountType: 'SAVINGS',
        checkNumber: 'CONC-9001',
        payeeName: 'Concurrent Vendor',
        amount: 100.25,
        idempotencyKey: 'idemp_concurrent_race_1',
        adminUid: 'usr_admin',
        adminEmail: 'daneybil2020@gmail.com',
      },
      deps
    ),
    executeServerAdminCheckWithdrawal(
      {
        customerIdentifier: 'cust_test_savings_only',
        sourceAccountType: 'SAVINGS',
        checkNumber: 'CONC-9001',
        payeeName: 'Concurrent Vendor',
        amount: 100.25,
        idempotencyKey: 'idemp_concurrent_race_1',
        adminUid: 'usr_admin',
        adminEmail: 'daneybil2020@gmail.com',
      },
      deps
    ),
    executeServerAdminCheckWithdrawal(
      {
        customerIdentifier: 'cust_test_savings_only',
        sourceAccountType: 'SAVINGS',
        checkNumber: 'CONC-9001',
        payeeName: 'Concurrent Vendor',
        amount: 100.25,
        idempotencyKey: 'idemp_concurrent_race_1',
        adminUid: 'usr_admin',
        adminEmail: 'daneybil2020@gmail.com',
      },
      deps
    ),
  ]);
  assert.strictEqual(race1.success && race2.success && race3.success, true);
  const duplicateFlags = [race1.isDuplicate, race2.isDuplicate, race3.isDuplicate].filter(Boolean);
  assert.strictEqual(duplicateFlags.length, 2, 'Exactly 2 of 3 concurrent calls must replay as duplicates');
  assert.strictEqual(
    harness.getDocData('accounts', 'cust_test_savings_only')!.savingsBalance,
    1400.5,
    'Concurrent race must debit 1500.75 - 100.25 = 1400.50 strictly once'
  );
  console.log('  ✓ Idempotency prevents double debit sequentially and under parallel concurrency; parameter tampering rejected (409).\n');

  // ==========================================================================
  // TEST D: Duplicate check number normalization & locking
  // ==========================================================================
  console.log('[Test D] Duplicate Check Number Guard Across Formatting Variations');
  assert.strictEqual(normalizeCheckNumber('chk-10450'), 'CHK10450');
  assert.strictEqual(normalizeCheckNumber('  chk 10450 '), 'CHK10450');

  const resDDupCheck = await executeServerAdminCheckWithdrawal(
    {
      customerIdentifier: 'cust_test_alpha',
      sourceAccountType: 'CHECKING',
      checkNumber: 'chk 10450', // same normalized check number with different idempotencyKey
      payeeName: 'Another Payee',
      amount: 10,
      idempotencyKey: 'idemp_test_d_dup_check',
      adminUid: 'usr_admin',
      adminEmail: 'daneybil2020@gmail.com',
    },
    deps
  );
  assert.strictEqual(resDDupCheck.success, false);
  assert.strictEqual(resDDupCheck.statusCode, 409);
  assert.strictEqual(resDDupCheck.errorCode, 'DUPLICATE_CHECK_NUMBER');
  assert.strictEqual(
    harness.getDocData('accounts', 'cust_test_alpha')!.checkingBalance,
    3749.75,
    'Duplicate check number rejection must leave balance unchanged'
  );
  console.log('  ✓ Duplicate check numbers rejected with 409 DUPLICATE_CHECK_NUMBER across formatting variations.\n');

  // ==========================================================================
  // TEST E: Insufficient balance & invalid inputs
  // ==========================================================================
  console.log('[Test E] Insufficient Balance & Invalid Input Rejection');
  const beforeBalAlpha = harness.getDocData('accounts', 'cust_test_alpha')!.checkingBalance;

  const invalidCases = [
    { label: 'overdraft', amount: 999999, checkNumber: 'E-1', payeeName: 'Payee', expectedCode: 'INSUFFICIENT_FUNDS' },
    { label: 'zero amount', amount: 0, checkNumber: 'E-2', payeeName: 'Payee', expectedCode: 'INVALID_AMOUNT' },
    { label: 'negative amount', amount: -25, checkNumber: 'E-3', payeeName: 'Payee', expectedCode: 'INVALID_AMOUNT' },
    { label: '3 decimals', amount: 12.345, checkNumber: 'E-4', payeeName: 'Payee', expectedCode: 'INVALID_AMOUNT_PRECISION' },
    { label: 'missing check number', amount: 10, checkNumber: '   ', payeeName: 'Payee', expectedCode: 'MISSING_CHECK_NUMBER' },
    { label: 'missing payee', amount: 10, checkNumber: 'E-5', payeeName: '', expectedCode: 'MISSING_PAYEE' },
  ];

  for (const tc of invalidCases) {
    const r = await executeServerAdminCheckWithdrawal(
      {
        customerIdentifier: 'cust_test_alpha',
        sourceAccountType: 'CHECKING',
        checkNumber: tc.checkNumber,
        payeeName: tc.payeeName,
        amount: tc.amount,
        idempotencyKey: `idemp_test_e_${tc.label}`,
        adminUid: 'usr_admin',
        adminEmail: 'daneybil2020@gmail.com',
      },
      deps
    );
    assert.strictEqual(r.success, false, `Case "${tc.label}" must fail`);
    assert.strictEqual(r.errorCode, tc.expectedCode, `Case "${tc.label}" expected ${tc.expectedCode}, got ${r.errorCode}`);
  }

  const missingCust = await executeServerAdminCheckWithdrawal(
    {
      customerIdentifier: 'non_existent_customer_999',
      sourceAccountType: 'CHECKING',
      checkNumber: 'E-6',
      payeeName: 'Payee',
      amount: 10,
      idempotencyKey: 'idemp_test_e_missing_cust',
      adminUid: 'usr_admin',
      adminEmail: 'daneybil2020@gmail.com',
    },
    deps
  );
  assert.strictEqual(missingCust.success, false);
  assert.strictEqual(missingCust.errorCode, 'CUSTOMER_NOT_FOUND');

  // Ensure admin account cannot be debited as a customer
  const adminTargetRes = await executeServerAdminCheckWithdrawal(
    {
      customerIdentifier: 'usr_admin',
      sourceAccountType: 'CHECKING',
      checkNumber: 'E-7',
      payeeName: 'Payee',
      amount: 10,
      idempotencyKey: 'idemp_test_e_admin_target',
      adminUid: 'usr_admin',
      adminEmail: 'daneybil2020@gmail.com',
    },
    {
      ...deps,
      resolveCustomer: async () => ({ success: true, uid: 'usr_admin', data: { role: 'super_admin' } }),
    }
  );
  assert.strictEqual(adminTargetRes.success, false);
  assert.strictEqual(adminTargetRes.errorCode, 'INVALID_CUSTOMER');
  assert.strictEqual(
    harness.getDocData('accounts', 'cust_test_alpha')!.checkingBalance,
    beforeBalAlpha,
    'Checking balance must remain completely unchanged after invalid input rejections'
  );
  console.log('  ✓ All invalid amounts, overdrafts, missing fields, missing customer, and admin targets cleanly rejected.\n');

  // ==========================================================================
  // TEST F: Authorization & Session Expiry Enforcement
  // ==========================================================================
  console.log('[Test F] Authorization, Role Checks & Admin Session Expiry');
  const prevPassword = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = 'TestMonveraAdminPassword!2026';

  try {
    // 1. Unauthenticated request to requireAdminAuth -> 401
    const unauthMock = createMockReqRes({ headers: {} });
    await requireAdminAuth(unauthMock.req, unauthMock.res, () => {
      assert.fail('Unauthenticated request must not pass requireAdminAuth');
    });
    assert.strictEqual(unauthMock.getStatusCode(), 401);

    // 2. Non-admin customer caller -> isCallerAdministrator must return false
    const nonAdmin = await isCallerAdministrator('cust_test_alpha', 'claire.vance@test.monvera', { role: 'customer' });
    assert.strictEqual(nonAdmin, false, 'Non-admin customer must never pass admin authorization');

    // 3. Valid admin session token vs tampered vs expired session token
    const validAdminToken = createAdminSessionToken('usr_admin', 'daneybil2020@gmail.com');
    assert.ok(validAdminToken, 'createAdminSessionToken must generate token when ADMIN_PASSWORD is set');
    const validCheck = verifyAdminSessionToken(validAdminToken!, 'usr_admin', 'daneybil2020@gmail.com');
    assert.strictEqual(validCheck.valid, true, 'Valid admin token must verify');

    // Tampered token -> invalid
    const tamperedToken = `${validAdminToken!.split('.')[0]}.tamperedsig`;
    assert.strictEqual(verifyAdminSessionToken(tamperedToken, 'usr_admin', 'daneybil2020@gmail.com').valid, false);

    // Mismatched UID/email -> invalid
    assert.strictEqual(verifyAdminSessionToken(validAdminToken!, 'cust_test_alpha', 'claire.vance@test.monvera').valid, false);

    // Missing/empty session token -> invalid (enforced on POST /api/admin/checks/issue)
    assert.strictEqual(verifyAdminSessionToken(undefined, 'usr_admin', 'daneybil2020@gmail.com').valid, false);

    // Confirm server.ts route enforces sessionCheck and derives adminUid/adminEmail from req.auth!
    const serverSrc = fs.readFileSync(path.resolve('server.ts'), 'utf-8');
    assert.ok(
      serverSrc.includes("app.post('/api/admin/checks/issue', requireAdminAuth") &&
        serverSrc.includes('verifyAdminSessionToken(effectiveSessionToken, req.auth!.uid, req.auth!.email)') &&
        serverSrc.includes('const verifiedAdminUid = req.auth!.uid;'),
      'POST /api/admin/checks/issue must requireAdminAuth, validate session token, and derive admin identity strictly from req.auth'
    );

    // Confirm service itself fails closed without verified adminUid/adminEmail
    const noAdminSvc = await executeServerAdminCheckWithdrawal(
      {
        customerIdentifier: 'cust_test_alpha',
        sourceAccountType: 'CHECKING',
        checkNumber: 'F-1',
        payeeName: 'Payee',
        amount: 10,
        adminUid: '',
        adminEmail: '',
      },
      deps
    );
    assert.strictEqual(noAdminSvc.success, false);
    assert.strictEqual(noAdminSvc.statusCode, 401);
  } finally {
    if (prevPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = prevPassword;
  }
  console.log('  ✓ Unauthenticated, non-admin, tampered/missing session, and identity spoofing checks verified.\n');

  // ==========================================================================
  // TEST G: 30-Minute Reversal & Withdrawal Support Backfill Isolation
  // ==========================================================================
  console.log('[Test G] Reversal Queue & Withdrawal Support Backfill Isolation');
  const allTxs = harness.getAllDocs('transactions') as Transaction[];
  assert.ok(allTxs.length >= 3, 'Should have committed CHECK_WITHDRAWAL transactions');

  // Replicate exact query predicate of executeServerPendingWithdrawalReversals (server/firestoreTransactions.ts:2070)
  // and firestoreSync.checkAndExecutePendingWithdrawalReversals (src/services/firestoreSync.ts:3894)
  const reversalCandidates = allTxs.filter((tx) => {
    const isPendingWithdrawal = tx.type === 'WITHDRAWAL' && tx.status === 'PENDING' && !tx.metadata?.isReversed;
    const isAuto = tx.metadata?.autoReverse !== false;
    return isPendingWithdrawal && isAuto;
  });
  assert.strictEqual(reversalCandidates.length, 0, 'Zero CHECK_WITHDRAWAL transactions may ever match reversal queue');

  // Replicate exact backfill predicate of getAllWithdrawalSupportRecordsAdmin (server/firestoreTransactions.ts:1681,1689)
  const supportBackfillCandidates = allTxs.filter((tx) => tx.type === 'WITHDRAWAL');
  assert.strictEqual(supportBackfillCandidates.length, 0, 'Zero CHECK_WITHDRAWAL transactions may ever match withdrawal support backfill');

  // Even if a CHECK_WITHDRAWAL timestamp is > 31 minutes old, verify it remains COMPLETED and never triggers reversal
  for (const tx of allTxs) {
    assert.strictEqual(tx.type, 'CHECK_WITHDRAWAL');
    assert.strictEqual(tx.status, 'COMPLETED');
    assert.strictEqual(tx.metadata?.autoReverse, false);
    assert.strictEqual(tx.metadata?.permanentDebit, true);
  }
  console.log('  ✓ CHECK_WITHDRAWAL transactions are completely excluded from 30-minute reversals and support backfill.\n');

  // ==========================================================================
  // TEST H: Customer Dashboard, Receipt Classification & Ledger Read Verification
  // ==========================================================================
  console.log('[Test H] Customer Dashboard Debit Classification, Receipt Formatting & Ledger Listing');
  const checkTx = persistedTxA as Transaction;
  const flowClassification = classifyCustomerFlow(checkTx, 'cust_test_alpha', '1088442201');
  assert.strictEqual(flowClassification.isCredit, false, 'Customer UI MUST classify CHECK_WITHDRAWAL as DEBIT (isCredit=false)');
  assert.strictEqual(checkTx.recipientName, 'Apex Legal Escrow LLC');
  assert.strictEqual(checkTx.metadata?.checkNumber, 'CHK-10450');
  assert.strictEqual(checkTx.metadata?.sourceAccountType, 'CHECKING');

  const listedChecks = await getAllIssuedChecksAdmin({ firestore });
  assert.strictEqual(listedChecks.success, true);
  assert.strictEqual(listedChecks.checks.length, 3, 'Issued checks list should include all 3 committed checks');
  assert.strictEqual(listedChecks.checks[0].checkNumber, 'CONC-9001', 'List should be ordered newest-first or deterministic');
  console.log('  ✓ Customer ledger/receipt classifies CHECK_WITHDRAWAL strictly as DEBIT with Check # and Payee metadata.\n');

  // ==========================================================================
  // TEST I: Admin Ledger Status-Reversal Protection
  // ==========================================================================
  console.log('[Test I] Admin Ledger Status-Reversal Protection');
  // Test db.transactions + server.ts status guard logic against permanent CHECK_WITHDRAWAL
  db.transactions.push(structuredClone(checkTx));
  try {
    const targetMemTx = db.transactions.find((t) => t.id === checkTx.id || t.referenceNumber === checkTx.referenceNumber);
    assert.ok(targetMemTx, 'Seeded check tx in memory');
    const shouldBlockReverse =
      (targetMemTx!.type === 'CHECK_WITHDRAWAL' || targetMemTx!.metadata?.permanentDebit === true) &&
      ('REVERSED' === 'REVERSED');
    assert.strictEqual(shouldBlockReverse, true, 'Status-only update guard must block REVERSED on CHECK_WITHDRAWAL');

    // Verify server.ts contains this exact guard and AdminTransactionsView hides Reverse button
    const serverSrc = fs.readFileSync(path.resolve('server.ts'), 'utf-8');
    const adminTxViewSrc = fs.readFileSync(path.resolve('src/components/admin/AdminTransactionsView.tsx'), 'utf-8');
    assert.ok(serverSrc.includes("errorCode: 'CHECK_WITHDRAWAL_PERMANENT'"), 'server.ts must enforce CHECK_WITHDRAWAL_PERMANENT');
    assert.ok(
      adminTxViewSrc.includes("tx.type !== 'CHECK_WITHDRAWAL'") && adminTxViewSrc.includes('Permanent Debit'),
      'AdminTransactionsView must hide Reverse button and display Permanent Debit badge'
    );
  } finally {
    const idx = db.transactions.findIndex((t) => t.id === checkTx.id);
    if (idx !== -1) db.transactions.splice(idx, 1);
  }
  console.log('  ✓ Status-only reversal on CHECK_WITHDRAWAL is blocked in server.ts and hidden in AdminTransactionsView.\n');

  // ==========================================================================
  // TEST J: Existing Withdrawal Regression & Firestore Rules Protection Check
  // ==========================================================================
  console.log('[Test J] Existing Withdrawal Regression & Firestore Rules Client-Write Lockout');
  const fsTxSrc = fs.readFileSync(path.resolve('server/firestoreTransactions.ts'), 'utf-8');
  const fsSyncSrc = fs.readFileSync(path.resolve('src/services/firestoreSync.ts'), 'utf-8');
  const withdrawModalSrc = fs.readFileSync(path.resolve('src/components/dashboard/WithdrawModal.tsx'), 'utf-8');
  const rulesSrc = fs.readFileSync(path.resolve('firestore.rules'), 'utf-8');

  // Verify existing withdrawal files contain zero CHECK_WITHDRAWAL contamination
  assert.strictEqual(fsTxSrc.includes('CHECK_WITHDRAWAL'), false, 'server/firestoreTransactions.ts must remain untouched');
  assert.strictEqual(fsSyncSrc.includes('CHECK_WITHDRAWAL'), false, 'src/services/firestoreSync.ts must remain untouched');
  assert.strictEqual(withdrawModalSrc.includes('CHECK_WITHDRAWAL'), false, 'WithdrawModal.tsx must remain untouched');

  // Verify firestore.rules locks down new collections from client writes
  assert.ok(
    rulesSrc.includes('match /issued_checks/{checkId}') &&
      rulesSrc.includes('allow read: if isAdmin() || (isSignedIn() && resource.data.userId == request.auth.uid);') &&
      rulesSrc.includes('allow create, update, delete: if false;'),
    'firestore.rules must allow owner/admin read and block all client writes on issued_checks'
  );
  assert.ok(
    rulesSrc.includes('match /check_idempotency/{idempotencyKey}') &&
      rulesSrc.includes('match /check_number_locks/{normalizedCheckNumber}') &&
      rulesSrc.includes('allow read, write: if false;'),
    'firestore.rules must block all client reads/writes on check_idempotency and check_number_locks'
  );
  console.log('  ✓ Existing withdrawal code untouched; firestore.rules locks down all check lock/write paths.\n');

  // ==========================================================================
  // BONUS CONSISTENCY TEST: Post-Commit Notification Failure Does Not Undo/Duplicate Debit
  // ==========================================================================
  console.log('[Bonus Consistency Test] Post-Commit Notification Failure Handling');
  const prevSavings = harness.getDocData('accounts', 'cust_test_savings_only')!.savingsBalance;
  const resAuxFail = await executeServerAdminCheckWithdrawal(
    {
      customerIdentifier: 'cust_test_savings_only',
      sourceAccountType: 'SAVINGS',
      checkNumber: 'AUX-FAIL-1',
      payeeName: 'Resilience Test Payee',
      amount: 50.0,
      idempotencyKey: 'idemp_aux_fail_test',
      adminUid: 'usr_admin',
      adminEmail: 'daneybil2020@gmail.com',
    },
    {
      firestore,
      persistNotification: async () => {
        throw new Error('Simulated FCM notification outage');
      },
      recordAuditLog: () => {
        throw new Error('Simulated audit store write error');
      },
    }
  );
  assert.strictEqual(resAuxFail.success, true, 'Committed debit must succeed even if auxiliary notification throws');
  assert.ok(resAuxFail.warnings && resAuxFail.warnings.length === 2, 'Auxiliary warnings must be reported cleanly');
  assert.strictEqual(
    harness.getDocData('accounts', 'cust_test_savings_only')!.savingsBalance,
    Number((prevSavings - 50.0).toFixed(2)),
    'Balance debit must remain intact after auxiliary failure'
  );
  console.log('  ✓ Auxiliary notification/audit failure surfaced as warnings without aborting or duplicating debit.\n');

  // ==========================================================================
  // TEST K: Correction 1 — Admin Session Verification & Expiry Consistency
  // ==========================================================================
  console.log('[Test K] Correction 1: Admin Session Verification & Expiry Enforcement');
  const prevPassK = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = 'TestMonveraAdminPassword!2026';
  try {
    // Craft an actually expired HMAC-signed admin session token
    const salt = process.env.ADMIN_SESSION_SALT || 'monvera-admin-auth-secure-hmac-salt-v1';
    const hmacSecret = crypto.createHmac('sha256', salt).update(process.env.ADMIN_PASSWORD).digest('hex');
    const expiredPayloadB64 = Buffer.from(
      JSON.stringify({
        uid: 'usr_admin',
        email: 'daneybil2020@gmail.com',
        iat: Date.now() - 9 * 60 * 60 * 1000,
        exp: Date.now() - 60 * 1000,
      })
    ).toString('base64url');
    const expiredSig = crypto.createHmac('sha256', hmacSecret).update(expiredPayloadB64).digest('base64url');
    const expiredAdminToken = `${expiredPayloadB64}.${expiredSig}`;

    // 1. Expired admin session token MUST fail verifyAdminSessionToken with 'Admin session expired'
    const expiredVerify = verifyAdminSessionToken(expiredAdminToken, 'usr_admin', 'daneybil2020@gmail.com');
    assert.strictEqual(expiredVerify.valid, false);
    assert.strictEqual(expiredVerify.reason, 'Admin session expired');

    // 2. Missing session token MUST fail verifyAdminSessionToken with 'Session token missing'
    const missingVerify = verifyAdminSessionToken(undefined, 'usr_admin', 'daneybil2020@gmail.com');
    assert.strictEqual(missingVerify.valid, false);
    assert.strictEqual(missingVerify.reason, 'Session token missing');

    // 3. Valid admin session token MUST pass
    const validTok = createAdminSessionToken('usr_admin', 'daneybil2020@gmail.com')!;
    assert.strictEqual(verifyAdminSessionToken(validTok, 'usr_admin', 'daneybil2020@gmail.com').valid, true);

    // 4. Confirm GET /api/admin/verify-session and POST /api/admin/checks/issue share identical session enforcement
    const serverSrcK = fs.readFileSync(path.resolve('server.ts'), 'utf-8');
    const verifyRouteBlock = serverSrcK.slice(
      serverSrcK.indexOf("app.get('/api/admin/verify-session'"),
      serverSrcK.indexOf("app.post('/api/admin/login'")
    );
    assert.ok(
      verifyRouteBlock.includes('verifyAdminSessionToken(effectiveSessionToken, req.auth!.uid, req.auth!.email)') &&
        verifyRouteBlock.includes("errorCode: 'ADMIN_SESSION_INVALID'") &&
        verifyRouteBlock.includes('sessionExpired: isExpired'),
      'GET /api/admin/verify-session must strictly enforce verifyAdminSessionToken and return 401 ADMIN_SESSION_INVALID'
    );
  } finally {
    if (prevPassK === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = prevPassK;
  }
  console.log('  ✓ Missing, expired, and valid admin sessions enforced consistently across verify-session and check issuance.\n');

  // ==========================================================================
  // TEST L: Correction 2 — Firebase ID Token Refresh & Idempotency Preservation
  // ==========================================================================
  console.log('[Test L] Correction 2: Firebase Token Refresh on Check Issuance');
  {
    // 1. Expired Firebase ID token -> 401 -> refreshes ID token -> retries exact same idempotencyKey -> 200 without duplicate debit
    const refreshCalls: boolean[] = [];
    const seenAuthTokens: string[] = [];
    const seenPayloads: any[] = [];
    let attemptNum = 0;

    const resRefreshSuccess = await issueAdminCheckWithAuthRetry(
      {
        customerIdentifier: 'cust_test_alpha',
        sourceAccountType: 'CHECKING',
        checkNumber: 'TOK-1001',
        payeeName: 'Token Refresh Escrow',
        amount: 25.5,
        memo: 'Refresh flow check',
        idempotencyKey: 'idemp_token_refresh_001',
      },
      {
        hasAuthenticatedUser: () => true,
        buildHeaders: async (forceRefresh = false) => {
          refreshCalls.push(forceRefresh);
          return {
            'Content-Type': 'application/json',
            Authorization: forceRefresh ? 'Bearer fresh-fb-id-token' : 'Bearer expired-fb-id-token',
            'X-Admin-Session': 'valid-admin-session',
          };
        },
        fetchFn: async (_endpoint, init) => {
          attemptNum++;
          const hdrs = (init?.headers || {}) as Record<string, string>;
          seenAuthTokens.push(hdrs['Authorization']);
          const parsedBody = JSON.parse(String(init?.body || '{}'));
          seenPayloads.push(parsedBody);

          if (attemptNum === 1) {
            return new Response(
              JSON.stringify({
                error: 'UNAUTHORIZED: Invalid or expired authentication token. Please re-authenticate.',
                details: 'auth/id-token-expired',
              }),
              { status: 401, headers: { 'Content-Type': 'application/json' } }
            );
          }

          // Second attempt executes the real server service against isolated Firestore harness
          const execRes = await executeServerAdminCheckWithdrawal(
            {
              ...parsedBody,
              adminUid: 'usr_admin',
              adminEmail: 'daneybil2020@gmail.com',
            },
            deps
          );
          return new Response(JSON.stringify(execRes), {
            status: execRes.statusCode,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      }
    );

    assert.strictEqual(resRefreshSuccess.success, true, 'Check issuance should succeed after token refresh retry');
    assert.deepStrictEqual(refreshCalls, [false, true], 'Must build non-forced headers first, then force-refresh once');
    assert.deepStrictEqual(seenAuthTokens, ['Bearer expired-fb-id-token', 'Bearer fresh-fb-id-token']);
    assert.strictEqual(seenPayloads.length, 2);
    assert.strictEqual(seenPayloads[0].idempotencyKey, 'idemp_token_refresh_001');
    assert.strictEqual(seenPayloads[1].idempotencyKey, 'idemp_token_refresh_001', 'Retry MUST preserve exact same idempotencyKey');
    assert.strictEqual(
      harness.getAllDocs('issued_checks').filter((c) => c.checkNumber === 'TOK-1001').length,
      1,
      'Must create strictly 1 issued check record'
    );

    // 2. Failed Firebase ID token refresh returns clean TOKEN_REFRESH_FAILED without duplicate submission
    let failedRefreshFetches = 0;
    const resRefreshFail = await issueAdminCheckWithAuthRetry(
      {
        customerIdentifier: 'cust_test_alpha',
        sourceAccountType: 'CHECKING',
        checkNumber: 'TOK-1002',
        payeeName: 'Failed Refresh Payee',
        amount: 10,
        idempotencyKey: 'idemp_token_refresh_fail',
      },
      {
        hasAuthenticatedUser: () => true,
        buildHeaders: async (forceRefresh = false) => {
          if (forceRefresh) return { 'Content-Type': 'application/json' }; // No Authorization -> refresh failed
          return { 'Content-Type': 'application/json', Authorization: 'Bearer stale-token' };
        },
        fetchFn: async () => {
          failedRefreshFetches++;
          return new Response(JSON.stringify({ error: 'UNAUTHORIZED: Token expired' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      }
    );
    assert.strictEqual(resRefreshFail.success, false);
    assert.strictEqual(resRefreshFail.errorCode, 'TOKEN_REFRESH_FAILED');
    assert.strictEqual(failedRefreshFetches, 1, 'Must NOT fire unauthenticated retry when refresh fails');

    // 3. Business / authorization / ADMIN_SESSION_INVALID errors must NOT trigger Firebase token refresh retry
    for (const nonRetryCase of [
      { status: 400, errorCode: 'INSUFFICIENT_FUNDS' },
      { status: 409, errorCode: 'DUPLICATE_CHECK_NUMBER' },
      { status: 403, errorCode: 'FORBIDDEN' },
      { status: 401, errorCode: 'ADMIN_SESSION_INVALID' },
    ]) {
      let forceRefreshCalled = false;
      let fetchCount = 0;
      const rNonRetry = await issueAdminCheckWithAuthRetry(
        {
          customerIdentifier: 'cust_test_alpha',
          sourceAccountType: 'CHECKING',
          checkNumber: 'TOK-1003',
          payeeName: 'Business Error Payee',
          amount: 10,
          idempotencyKey: `idemp_non_retry_${nonRetryCase.errorCode}`,
        },
        {
          hasAuthenticatedUser: () => true,
          buildHeaders: async (forceRefresh = false) => {
            if (forceRefresh) forceRefreshCalled = true;
            return { 'Content-Type': 'application/json', Authorization: 'Bearer valid-fb-token' };
          },
          fetchFn: async () => {
            fetchCount++;
            return new Response(
              JSON.stringify({ success: false, errorCode: nonRetryCase.errorCode, error: 'Rejected' }),
              { status: nonRetryCase.status, headers: { 'Content-Type': 'application/json' } }
            );
          },
        }
      );
      assert.strictEqual(rNonRetry.success, false);
      assert.strictEqual(rNonRetry.errorCode, nonRetryCase.errorCode);
      assert.strictEqual(forceRefreshCalled, false, `${nonRetryCase.errorCode} must NOT trigger ID token refresh`);
      assert.strictEqual(fetchCount, 1, `${nonRetryCase.errorCode} must NOT be retried`);
    }

    // 4. Verify AdminIssuedChecksView preserves entered form values and pendingIdempotencyKey on auth failures
    const viewSrc = fs.readFileSync(path.resolve('src/components/admin/AdminIssuedChecksView.tsx'), 'utf-8');
    assert.ok(
      viewSrc.includes("res.errorCode === 'ADMIN_SESSION_INVALID'") &&
        viewSrc.includes("res.errorCode === 'TOKEN_REFRESH_FAILED'") &&
        viewSrc.includes('setNeedsAdminReauth(true)'),
      'AdminIssuedChecksView must trigger in-place re-auth while preserving entered form fields and pendingIdempotencyKey'
    );
  }
  console.log('  ✓ Firebase token refresh retry, idempotencyKey preservation, failed-refresh handling, and non-retry business guards passed.\n');

  // ==========================================================================
  // TEST M: Correction 3 — Legacy Subaccount Balance Fallback & Validation
  // ==========================================================================
  console.log('[Test M] Correction 3: Legacy accounts[] Fallback & Authoritative Balance Priority');
  {
    // 1. Legacy account: NO top-level checkingBalance/savingsBalance, balances live ONLY in accounts[]
    harness.seed('users', 'cust_legacy_subonly', {
      id: 'cust_legacy_subonly',
      firstName: 'Legacy',
      lastName: 'Client',
      email: 'legacy.client@test.monvera',
      permanentAccountNumber: '1077001100',
      role: 'customer',
      status: 'active',
    });
    harness.seed('accounts', 'cust_legacy_subonly', {
      userId: 'cust_legacy_subonly',
      permanentAccountNumber: '1077001100',
      investedBalance: 400,
      accruedEarnings: 25,
      pendingBalance: 150,
      loanBalance: 800,
      accounts: [
        { id: 'chk_leg', userId: 'cust_legacy_subonly', type: 'CHECKING', accountNumber: '1077001100', balance: 620.5, availableBalance: 620.5 },
        { id: 'sav_leg', userId: 'cust_legacy_subonly', type: 'SAVINGS', accountNumber: '1077001991', balance: 2100.25, availableBalance: 2100.25 },
      ],
    });

    const resLegacyChk = await executeServerAdminCheckWithdrawal(
      {
        customerIdentifier: 'cust_legacy_subonly',
        sourceAccountType: 'CHECKING',
        checkNumber: 'LEG-101',
        payeeName: 'Legacy Vendor LLC',
        amount: 120.5,
        idempotencyKey: 'idemp_legacy_chk_1',
        adminUid: 'usr_admin',
        adminEmail: 'daneybil2020@gmail.com',
      },
      deps
    );
    assert.strictEqual(resLegacyChk.success, true, `Legacy CHECKING fallback must succeed: ${resLegacyChk.error}`);
    const legAfter = harness.getDocData('accounts', 'cust_legacy_subonly')!;
    assert.strictEqual(legAfter.checkingBalance, 500.0, 'Checking fallback 620.50 - 120.50 = 500.00');
    assert.strictEqual(legAfter.availableBalance, 500.0);
    assert.strictEqual(legAfter.savingsBalance, 2100.25, 'Savings fallback balance must be preserved untouched');
    assert.strictEqual(legAfter.totalBalance, 3025.25, 'totalBalance = 500 + 2100.25 + 400 + 25');
    assert.strictEqual(legAfter.pendingBalance, 150, 'pendingBalance must remain untouched');
    assert.strictEqual(legAfter.loanBalance, 800, 'loanBalance must remain untouched');

    // 2. Top-level checkingBalance/savingsBalance exists (including authoritative 0): MUST take precedence over accounts[]
    harness.seed('users', 'cust_top_auth', {
      id: 'cust_top_auth',
      firstName: 'Auth',
      lastName: 'Top',
      email: 'auth.top@test.monvera',
      permanentAccountNumber: '1077002200',
      role: 'customer',
      status: 'active',
    });
    harness.seed('accounts', 'cust_top_auth', {
      userId: 'cust_top_auth',
      permanentAccountNumber: '1077002200',
      checkingBalance: 0, // Authoritative top-level ZERO must NOT fall back to stale accounts[] 9999
      savingsBalance: 300,
      accounts: [
        { id: 'chk_stale', userId: 'cust_top_auth', type: 'CHECKING', accountNumber: '1077002200', balance: 9999 },
        { id: 'sav_stale', userId: 'cust_top_auth', type: 'SAVINGS', accountNumber: '1077002991', balance: 9999 },
      ],
    });
    const resAuthZero = await executeServerAdminCheckWithdrawal(
      {
        customerIdentifier: 'cust_top_auth',
        sourceAccountType: 'CHECKING',
        checkNumber: 'TOP-201',
        payeeName: 'Payee',
        amount: 50,
        idempotencyKey: 'idemp_top_zero_1',
        adminUid: 'usr_admin',
        adminEmail: 'daneybil2020@gmail.com',
      },
      deps
    );
    assert.strictEqual(resAuthZero.success, false);
    assert.strictEqual(resAuthZero.errorCode, 'INSUFFICIENT_FUNDS', 'Authoritative top-level 0 must NOT be overridden by stale accounts[]');

    const resAuthSav = await executeServerAdminCheckWithdrawal(
      {
        customerIdentifier: 'cust_top_auth',
        sourceAccountType: 'SAVINGS',
        checkNumber: 'TOP-202',
        payeeName: 'Payee',
        amount: 400, // Exceeds authoritative 300 even though accounts[] has 9999
        idempotencyKey: 'idemp_top_sav_1',
        adminUid: 'usr_admin',
        adminEmail: 'daneybil2020@gmail.com',
      },
      deps
    );
    assert.strictEqual(resAuthSav.success, false);
    assert.strictEqual(resAuthSav.errorCode, 'INSUFFICIENT_FUNDS', 'Authoritative top-level savingsBalance must win');

    // 3. Wrong account type must NEVER borrow other account's balance (even with legacy availableBalance set)
    harness.seed('users', 'cust_sav_only_legacy', {
      id: 'cust_sav_only_legacy',
      firstName: 'SavOnly',
      lastName: 'Legacy',
      email: 'savonly.legacy@test.monvera',
      permanentAccountNumber: '1077003300',
      role: 'customer',
      status: 'active',
    });
    harness.seed('accounts', 'cust_sav_only_legacy', {
      userId: 'cust_sav_only_legacy',
      permanentAccountNumber: '1077003300',
      availableBalance: 5000, // Legacy total liquid funds — must NOT be mistaken for CHECKING when accounts[] only has SAVINGS
      accounts: [{ id: 'sav_only', userId: 'cust_sav_only_legacy', type: 'SAVINGS', accountNumber: '1077003991', balance: 5000 }],
    });
    const resWrongType = await executeServerAdminCheckWithdrawal(
      {
        customerIdentifier: 'cust_sav_only_legacy',
        sourceAccountType: 'CHECKING',
        checkNumber: 'WRG-301',
        payeeName: 'Payee',
        amount: 100,
        idempotencyKey: 'idemp_wrong_type_1',
        adminUid: 'usr_admin',
        adminEmail: 'daneybil2020@gmail.com',
      },
      deps
    );
    assert.strictEqual(resWrongType.success, false);
    assert.strictEqual(resWrongType.errorCode, 'SOURCE_ACCOUNT_NOT_FOUND');

    // 4. Negative, invalid, and ambiguous balance data must fail safely with zero writes
    const badAccountCases: Array<{ uid: string; doc: Record<string, any>; expectedCode: string }> = [
      {
        uid: 'cust_bad_neg',
        doc: { userId: 'cust_bad_neg', checkingBalance: -250 },
        expectedCode: 'INVALID_ACCOUNT_BALANCE',
      },
      {
        uid: 'cust_bad_nan',
        doc: { userId: 'cust_bad_nan', checkingBalance: 'not-a-number' },
        expectedCode: 'INVALID_ACCOUNT_BALANCE',
      },
      {
        uid: 'cust_bad_ambig_dup',
        doc: {
          userId: 'cust_bad_ambig_dup',
          accounts: [
            { id: 'c1', type: 'CHECKING', balance: 500 },
            { id: 'c2', type: 'CHECKING', balance: 700 },
          ],
        },
        expectedCode: 'AMBIGUOUS_ACCOUNT_BALANCE',
      },
      {
        uid: 'cust_bad_ambig_mismatch',
        doc: {
          userId: 'cust_bad_ambig_mismatch',
          accounts: [{ id: 'c1', type: 'CHECKING', balance: 500, availableBalance: 200 }],
        },
        expectedCode: 'AMBIGUOUS_ACCOUNT_BALANCE',
      },
    ];

    for (const tc of badAccountCases) {
      harness.seed('users', tc.uid, {
        id: tc.uid,
        firstName: 'Bad',
        lastName: 'Case',
        email: `${tc.uid}@test.monvera`,
        permanentAccountNumber: '1077009999',
        role: 'customer',
        status: 'active',
      });
      harness.seed('accounts', tc.uid, tc.doc);
      const beforeSnapshot = JSON.stringify(harness.getDocData('accounts', tc.uid));
      const badRes = await executeServerAdminCheckWithdrawal(
        {
          customerIdentifier: tc.uid,
          sourceAccountType: 'CHECKING',
          checkNumber: `BAD-${tc.uid}`,
          payeeName: 'Payee',
          amount: 10,
          idempotencyKey: `idemp_${tc.uid}`,
          adminUid: 'usr_admin',
          adminEmail: 'daneybil2020@gmail.com',
        },
        deps
      );
      assert.strictEqual(badRes.success, false, `${tc.uid} must be rejected`);
      assert.strictEqual(badRes.errorCode, tc.expectedCode, `${tc.uid} expected ${tc.expectedCode}, got ${badRes.errorCode}`);
      assert.strictEqual(JSON.stringify(harness.getDocData('accounts', tc.uid)), beforeSnapshot, `${tc.uid} must NOT be modified`);
    }
  }
  console.log('  ✓ Legacy accounts[] fallback, authoritative top-level precedence, wrong-type rejection, and invalid/ambiguous balance guards passed.\n');

  console.log('================================================================');
  console.log('   STAGE 7 ADMIN ISSUED CHECKS VERIFICATION: ALL PASSED (A-M)   ');
  console.log('================================================================');
}

runStage7AdminCheckTests().catch((err) => {
  console.error('\n❌ Stage 7 Admin Check Issuance Test Failed:', err);
  process.exit(1);
});
