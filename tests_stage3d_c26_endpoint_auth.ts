/**
 * MONVERA — STAGE 3D-C2.6: FINANCIAL ENDPOINT AUTHENTICATION & AUTHORIZATION REMEDIATION TESTS
 *
 * Offline security & regression test suite covering Parts 1–6:
 *  1. Unauthenticated requests rejected (401/503) on all 5 routes via real Express HTTP loopback:
 *     - GET /api/accounts/balance
 *     - POST /api/withdrawals/reverse
 *     - POST /api/investments/create
 *     - POST /api/investments/:id/mature
 *     - GET /api/rewards/welcome/:userId
 *  2. Part 1 (Balances): Customer A cannot read Customer B balances (403); owner & admin succeed; response shape preserved.
 *  3. Part 2 (Withdrawal Reversal): Customer A cannot reverse Customer B withdrawal (HTTP handler, Firestore helper, and legacy memory fallback);
 *     owner & admin succeed with idempotency and single outbox entry.
 *  4. Part 3 (Investment Creation): Customer A cannot create investment under Customer B UID (handler & helper);
 *     clientRequestId idempotency is scoped per customer (zero cross-customer collision, safe per-user replay);
 *     frozen check, $100 minimum, balances & outbox preserved; admin permitted.
 *  5. Part 4 (Investment Maturity): Customer A cannot settle Customer B investment (handler & helper);
 *     early maturity rejected; rightful owner & admin settle once under effectiveOwnerId; replay is idempotent.
 *  6. Part 5 (Welcome Reward): Customer A cannot read/trigger Customer B Welcome Reward (403, zero evaluation/writes/outbox);
 *     owner & admin succeed; $10,000 threshold, $1,000 one-time payout, and loan exclusion preserved.
 *  7. Client API verification: api.getBalanceMetrics & api.reversePendingWithdrawal send getAuthHeaders() and respect 401/403 rejections.
 */

import assert from 'assert';
import fs from 'fs';
import http from 'http';
import type { Firestore } from 'firebase-admin/firestore';

import {
  reverseServerFirestoreWithdrawal,
  executeServerInvestmentCreation,
  executeServerInvestmentMaturity,
} from './server/firestoreTransactions';
import { evaluateAndProcessWelcomeReward } from './server/welcomeRewardService';
import { NOTIFICATION_OUTBOX_COLLECTION } from './server/services/notificationOutbox';

// ---------------------------------------------------------------------------
// Strict Offline In-Memory Firestore Harness (enforces reads-before-writes)
// ---------------------------------------------------------------------------
type DocStore = Map<string, Map<string, { version: number; data: Record<string, any> }>>;

function cloneVal<T>(v: T): T {
  return v === undefined ? v : structuredClone(v);
}

class InMemoryDocRef {
  constructor(private store: DocStore, public readonly path: string) {}

  get id(): string {
    const parts = this.path.split('/');
    return parts[parts.length - 1];
  }

  public splitParentAndId(): { colPath: string; docId: string } {
    const idx = this.path.lastIndexOf('/');
    return { colPath: this.path.slice(0, idx), docId: this.path.slice(idx + 1) };
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
    if (!this.store.has(colPath)) this.store.set(colPath, new Map());
    const col = this.store.get(colPath)!;
    const prev = col.get(docId);
    const nextData = options?.merge && prev ? { ...cloneVal(prev.data), ...cloneVal(data) } : cloneVal(data);
    col.set(docId, { version: (prev?.version || 0) + 1, data: nextData });
  }
}

type QueryFilter = { field: string; op: '==' | 'in' | '<='; value: any };

class InMemoryQuery {
  constructor(
    protected store: DocStore,
    public readonly colPath: string,
    protected filters: QueryFilter[] = [],
    protected limitVal?: number
  ) {}

  where(field: string, op: '==' | 'in' | '<=', value: any): InMemoryQuery {
    return new InMemoryQuery(this.store, this.colPath, [...this.filters, { field, op, value }], this.limitVal);
  }

  orderBy(): InMemoryQuery {
    return this;
  }

  limit(n: number): InMemoryQuery {
    return new InMemoryQuery(this.store, this.colPath, this.filters, n);
  }

  async get() {
    const col = this.store.get(this.colPath) || new Map();
    let entries = Array.from(col.entries()).filter(([, entry]) =>
      this.filters.every((f) => {
        const val = entry.data[f.field];
        if (f.op === '==') return val === f.value;
        if (f.op === 'in') return Array.isArray(f.value) && f.value.includes(val);
        if (f.op === '<=') return typeof val === 'string' && typeof f.value === 'string' && val <= f.value;
        return false;
      })
    );
    if (typeof this.limitVal === 'number') entries = entries.slice(0, this.limitVal);
    const docs = entries.map(([docId, entry]) => ({
      id: docId,
      exists: true,
      ref: new InMemoryDocRef(this.store, `${this.colPath}/${docId}`),
      data: () => cloneVal(entry.data),
    }));
    return { empty: docs.length === 0, size: docs.length, docs };
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
  private txMutex: Promise<void> = Promise.resolve();

  collection(name: string): InMemoryCollectionRef {
    return new InMemoryCollectionRef(this.store, name);
  }

  async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    let release!: () => void;
    const prev = this.txMutex;
    this.txMutex = new Promise<void>((res) => {
      release = res;
    });
    await prev;

    try {
      let hasWritten = false;
      const pendingOps: Array<{ type: 'set' | 'delete'; ref: InMemoryDocRef; data?: any; merge?: boolean }> = [];
      const tx = {
        get: async (refOrQuery: InMemoryDocRef | InMemoryQuery) => {
          if (hasWritten) {
            throw new Error('Firestore transactions require all reads to precede all writes.');
          }
          return await refOrQuery.get();
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
      for (const op of pendingOps) {
        if (op.type === 'set') {
          await op.ref.set(op.data, { merge: op.merge });
        }
      }
      return result;
    } finally {
      release();
    }
  }
}

function createMockRes() {
  const res: any = {
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
    send(payload: any) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

async function seedCustomer(
  memFs: StrictInMemoryFirestore,
  uid: string,
  opts: {
    checkingBalance: number;
    savingsBalance?: number;
    investedBalance?: number;
    pendingBalance?: number;
    accountNumber?: string;
    status?: string;
  }
) {
  const sav = opts.savingsBalance ?? 1000;
  const inv = opts.investedBalance ?? 0;
  const pend = opts.pendingBalance ?? 0;
  const total = Number((opts.checkingBalance + sav + inv).toFixed(2));
  const accNum = opts.accountNumber || '1088492001';

  await memFs.collection('users').doc(uid).set({
    id: uid,
    firstName: uid,
    lastName: 'Customer',
    email: `${uid}@monvera.test`,
    permanentAccountNumber: accNum,
    status: opts.status || 'active',
  });

  await memFs.collection('accounts').doc(uid).set({
    userId: uid,
    permanentAccountNumber: accNum,
    checkingBalance: opts.checkingBalance,
    availableBalance: opts.checkingBalance,
    savingsBalance: sav,
    investedBalance: inv,
    accruedEarnings: 0,
    pendingBalance: pend,
    loanBalance: 0,
    totalBalance: total,
  });
}

async function runTests() {
  process.env.VERCEL = '1';
  const {
    app,
    handleGetAccountBalance,
    handleReverseWithdrawal,
    handleCreateInvestment,
    handleMatureInvestment,
    handleGetWelcomeReward,
  } = await import('./server');

  console.log('\n=== STAGE 3D-C2.6: FINANCIAL ENDPOINT AUTH & AUTHZ REGRESSION TESTS ===\n');

  const alwaysNonAdmin = async () => false;
  const alwaysAdmin = async () => true;

  // -------------------------------------------------------------------------
  // 1. Real Express HTTP loopback: Unauthenticated requests rejected on all 5 routes
  // -------------------------------------------------------------------------
  {
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as any;
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      const checks: Array<{ method: string; path: string; body?: any }> = [
        { method: 'GET', path: '/api/accounts/balance?userId=cust_victim' },
        { method: 'POST', path: '/api/withdrawals/reverse', body: { transactionId: 'tx_wth_1', userId: 'cust_victim' } },
        { method: 'POST', path: '/api/investments/create', body: { userId: 'cust_victim', termDays: 60, amount: 500 } },
        { method: 'POST', path: '/api/investments/inv_1/mature', body: { userId: 'cust_victim' } },
        { method: 'GET', path: '/api/rewards/welcome/cust_victim' },
      ];

      for (const c of checks) {
        const resp = await fetch(`${baseUrl}${c.path}`, {
          method: c.method,
          headers: { 'Content-Type': 'application/json' },
          body: c.body ? JSON.stringify(c.body) : undefined,
        });
        assert(
          resp.status === 401 || resp.status === 503,
          `Expected unauthenticated ${c.method} ${c.path} to return 401 or 503, got ${resp.status}`
        );
      }

      // Spoofed/malformed Bearer token must also be rejected
      for (const c of checks) {
        const resp = await fetch(`${baseUrl}${c.path}`, {
          method: c.method,
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer invalid.forged.token',
          },
          body: c.body ? JSON.stringify(c.body) : undefined,
        });
        assert(
          resp.status === 401 || resp.status === 503,
          `Expected forged-token ${c.method} ${c.path} to return 401 or 503, got ${resp.status}`
        );
      }

      console.log('✓ 1. Unauthenticated & forged-token requests rejected on all 5 routes');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  // -------------------------------------------------------------------------
  // 2. Part 1 — GET /api/accounts/balance
  // -------------------------------------------------------------------------
  {
    const memFs = new StrictInMemoryFirestore();
    await seedCustomer(memFs, 'cust_A', { checkingBalance: 4250.5, savingsBalance: 1200, accountNumber: '1088492001' });
    await seedCustomer(memFs, 'cust_B', { checkingBalance: 98500.75, savingsBalance: 25000, accountNumber: '1088492002' });

    // 2a. Unauthenticated caller at handler boundary -> 401
    {
      const res = createMockRes();
      await handleGetAccountBalance(
        { query: { userId: 'cust_B' }, headers: {} } as any,
        res,
        { firestore: memFs as any, isAdminFn: alwaysNonAdmin }
      );
      assert.strictEqual(res.statusCode, 401);
    }

    // 2b. Customer A requesting Customer B's balance -> 403
    {
      const res = createMockRes();
      await handleGetAccountBalance(
        { auth: { uid: 'cust_A' }, query: { userId: 'cust_B' }, headers: {} } as any,
        res,
        { firestore: memFs as any, isAdminFn: alwaysNonAdmin }
      );
      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.body.code, 'FORBIDDEN');
    }

    // 2c. Customer A requesting own balance (explicit or omitted query userId) -> 200 & exact shape
    {
      const resExplicit = createMockRes();
      await handleGetAccountBalance(
        { auth: { uid: 'cust_A' }, query: { userId: 'cust_A' }, headers: {} } as any,
        resExplicit,
        { firestore: memFs as any, isAdminFn: alwaysNonAdmin }
      );
      assert.strictEqual(resExplicit.statusCode, 200);
      assert.strictEqual(resExplicit.body.checkingBalance, 4250.5);
      assert.strictEqual(resExplicit.body.savingsBalance, 1200);
      assert.strictEqual(resExplicit.body.totalBalance, 5450.5);
      assert.strictEqual(resExplicit.body.accounts.length, 2);

      const resOmitted = createMockRes();
      await handleGetAccountBalance(
        { auth: { uid: 'cust_A' }, query: {}, headers: {} } as any,
        resOmitted,
        { firestore: memFs as any, isAdminFn: alwaysNonAdmin }
      );
      assert.strictEqual(resOmitted.statusCode, 200);
      assert.strictEqual(resOmitted.body.checkingBalance, 4250.5);
    }

    // 2d. Verified admin reading Customer B's balance -> 200
    {
      const resAdmin = createMockRes();
      await handleGetAccountBalance(
        { auth: { uid: 'admin_1' }, query: { userId: 'cust_B' }, headers: {} } as any,
        resAdmin,
        { firestore: memFs as any, isAdminFn: alwaysAdmin }
      );
      assert.strictEqual(resAdmin.statusCode, 200);
      assert.strictEqual(resAdmin.body.checkingBalance, 98500.75);
      assert.strictEqual(resAdmin.body.savingsBalance, 25000);
    }

    console.log('✓ 2. Part 1 (Balances): Cross-customer blocked (403); owner & verified admin permitted');
  }

  // -------------------------------------------------------------------------
  // 3. Part 2 — POST /api/withdrawals/reverse + reverseServerFirestoreWithdrawal
  // -------------------------------------------------------------------------
  {
    const memFs = new StrictInMemoryFirestore();
    await seedCustomer(memFs, 'cust_A', { checkingBalance: 1000, pendingBalance: 100, accountNumber: '1088492001' });
    await seedCustomer(memFs, 'cust_B', { checkingBalance: 5000, pendingBalance: 750, accountNumber: '1088492002' });

    await memFs.collection('transactions').doc('tx_wth_A').set({
      id: 'tx_wth_A',
      userId: 'cust_A',
      senderUserId: 'cust_A',
      senderName: 'Customer A',
      senderAccountNumber: '1088492001',
      type: 'WITHDRAWAL',
      amount: 100,
      status: 'PENDING',
      referenceNumber: 'MV-WTH-A1',
      metadata: { sourceAccountType: 'CHECKING' },
    });
    await memFs.collection('transactions').doc('tx_wth_B').set({
      id: 'tx_wth_B',
      userId: 'cust_B',
      senderUserId: 'cust_B',
      senderName: 'Customer B',
      senderAccountNumber: '1088492002',
      type: 'WITHDRAWAL',
      amount: 750,
      status: 'PENDING',
      referenceNumber: 'MV-WTH-B1',
      metadata: { sourceAccountType: 'CHECKING' },
    });

    // 3a. Customer A attempts to reverse Customer B's withdrawal (with spoofed userId OR omitted userId) -> 403
    for (const body of [
      { transactionId: 'tx_wth_B', userId: 'cust_B' },
      { transactionId: 'tx_wth_B', userId: 'cust_A' },
      { transactionId: 'MV-WTH-B1' },
    ]) {
      const res = createMockRes();
      await handleReverseWithdrawal(
        { auth: { uid: 'cust_A' }, body, headers: {} } as any,
        res,
        { firestore: memFs as any, isAdminFn: alwaysNonAdmin }
      );
      assert.strictEqual(res.statusCode, 403, `Expected 403 for ${JSON.stringify(body)}, got ${res.statusCode}`);
    }

    // Verify Customer B's withdrawal & balances and outbox are completely untouched
    assert.strictEqual((await memFs.collection('transactions').doc('tx_wth_B').get()).data()!.status, 'PENDING');
    assert.strictEqual((await memFs.collection('accounts').doc('cust_B').get()).data()!.checkingBalance, 5000);
    assert.strictEqual((await memFs.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 0);

    // 3b. Direct helper reverseServerFirestoreWithdrawal rejects cross-customer call
    const directCross = await reverseServerFirestoreWithdrawal('tx_wth_B', 'cust_A', {
      firestore: memFs as unknown as Firestore,
    });
    assert.strictEqual(directCross.success, false);
    assert(directCross.error?.startsWith('FORBIDDEN'));
    assert.strictEqual((await memFs.collection('accounts').doc('cust_B').get()).data()!.checkingBalance, 5000);

    // 3c. Legacy db.reverseWithdrawal memory fallback CANNOT bypass ownership
    let memoryReverseCalled = false;
    const mockMemoryDb = {
      transactions: [
        {
          id: 'mem_wth_B',
          userId: 'cust_B',
          senderUserId: 'cust_B',
          type: 'WITHDRAWAL' as const,
          amount: 300,
          status: 'PENDING' as const,
          referenceNumber: 'MEM-WTH-B1',
        } as any,
      ],
      reverseWithdrawal: () => {
        memoryReverseCalled = true;
        return { success: true };
      },
      getUserBalanceMetrics: () => ({} as any),
    };
    const resMemAttack = createMockRes();
    await handleReverseWithdrawal(
      { auth: { uid: 'cust_A' }, body: { transactionId: 'mem_wth_B' }, headers: {} } as any,
      resMemAttack,
      { firestore: memFs as any, isAdminFn: alwaysNonAdmin, memoryDb: mockMemoryDb }
    );
    assert.strictEqual(resMemAttack.statusCode, 403);
    assert.strictEqual(memoryReverseCalled, false, 'Memory fallback must NEVER execute for another customer tx');

    // 3d. Legitimate Customer A reversal succeeds atomically + idempotent replay
    const resOwner = createMockRes();
    await handleReverseWithdrawal(
      { auth: { uid: 'cust_A' }, body: { transactionId: 'tx_wth_A' }, headers: {} } as any,
      resOwner,
      { firestore: memFs as any, isAdminFn: alwaysNonAdmin }
    );
    assert.strictEqual(resOwner.statusCode, 200);
    assert.strictEqual(resOwner.body.success, true);
    assert.strictEqual((await memFs.collection('accounts').doc('cust_A').get()).data()!.checkingBalance, 1100);
    assert.strictEqual((await memFs.collection('accounts').doc('cust_A').get()).data()!.pendingBalance, 0);
    assert.strictEqual((await memFs.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 1);

    // 3e. Verified admin can reverse Customer B's withdrawal
    const resAdmin = createMockRes();
    await handleReverseWithdrawal(
      { auth: { uid: 'admin_1' }, body: { transactionId: 'tx_wth_B', userId: 'cust_B' }, headers: {} } as any,
      resAdmin,
      { firestore: memFs as any, isAdminFn: alwaysAdmin }
    );
    assert.strictEqual(resAdmin.statusCode, 200);
    assert.strictEqual((await memFs.collection('accounts').doc('cust_B').get()).data()!.checkingBalance, 5750);
    assert.strictEqual((await memFs.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 2);

    console.log('✓ 3. Part 2 (Withdrawals): Cross-customer & memory-fallback bypass blocked; owner & admin succeed');
  }

  // -------------------------------------------------------------------------
  // 4. Part 3 — POST /api/investments/create + executeServerInvestmentCreation
  // -------------------------------------------------------------------------
  {
    const memFs = new StrictInMemoryFirestore();
    await seedCustomer(memFs, 'cust_A', { checkingBalance: 3000, accountNumber: '1088492001' });
    await seedCustomer(memFs, 'cust_B', { checkingBalance: 10000, accountNumber: '1088492002' });
    await seedCustomer(memFs, 'cust_frozen', { checkingBalance: 5000, status: 'frozen' });

    const noopMemDb = { createTermInvestment: () => ({} as any) };

    // 4a. Customer A trying to create investment using Customer B UID -> 403
    {
      const res = createMockRes();
      await handleCreateInvestment(
        {
          auth: { uid: 'cust_A' },
          body: { userId: 'cust_B', termDays: 60, amount: 500, clientRequestId: 'shared_req_1' },
          headers: {},
        } as any,
        res,
        { firestore: memFs as any, isAdminFn: alwaysNonAdmin, memoryDb: noopMemDb }
      );
      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual((await memFs.collection('accounts').doc('cust_B').get()).data()!.checkingBalance, 10000);
      assert.strictEqual((await memFs.collection('investments').get()).size, 0);
      assert.strictEqual((await memFs.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 0);
    }

    // 4b. Direct helper rejects mismatched authenticatedUid
    {
      const helperRes = await executeServerInvestmentCreation(
        {
          userId: 'cust_B',
          authenticatedUid: 'cust_A',
          isAuthorizedAdmin: false,
          termDays: 60,
          amount: 500,
        },
        { firestore: memFs as unknown as Firestore }
      );
      assert.strictEqual(helperRes.success, false);
      assert.strictEqual(helperRes.errorCode, 'FORBIDDEN');
      assert.strictEqual((await memFs.collection('accounts').doc('cust_B').get()).data()!.checkingBalance, 10000);
    }

    // 4c. Per-user scoped idempotency: Customer A & Customer B both send identical clientRequestId -> BOTH succeed!
    {
      const resA1 = createMockRes();
      await handleCreateInvestment(
        {
          auth: { uid: 'cust_A' },
          body: { termDays: 60, amount: 500, clientRequestId: 'shared_client_req_99' },
          headers: {},
        } as any,
        resA1,
        { firestore: memFs as any, isAdminFn: alwaysNonAdmin, memoryDb: noopMemDb }
      );
      assert.strictEqual(resA1.statusCode, 200);
      assert.strictEqual(resA1.body.investment.userId, 'cust_A');
      assert.strictEqual(resA1.body.isDuplicate, false);
      assert.strictEqual((await memFs.collection('accounts').doc('cust_A').get()).data()!.checkingBalance, 2500);

      // Customer B uses exact same clientRequestId -> must NOT collide with A!
      const resB1 = createMockRes();
      await handleCreateInvestment(
        {
          auth: { uid: 'cust_B' },
          body: { termDays: 90, amount: 1000, clientRequestId: 'shared_client_req_99' },
          headers: {},
        } as any,
        resB1,
        { firestore: memFs as any, isAdminFn: alwaysNonAdmin, memoryDb: noopMemDb }
      );
      assert.strictEqual(resB1.statusCode, 200);
      assert.strictEqual(resB1.body.investment.userId, 'cust_B');
      assert.strictEqual(resB1.body.isDuplicate, false);
      assert.notStrictEqual(resB1.body.investment.id, resA1.body.investment.id);
      assert.strictEqual((await memFs.collection('accounts').doc('cust_B').get()).data()!.checkingBalance, 9000);

      // Replaying Customer A's same clientRequestId is idempotent & does NOT double-debit
      const resA2 = createMockRes();
      await handleCreateInvestment(
        {
          auth: { uid: 'cust_A' },
          body: { termDays: 60, amount: 500, clientRequestId: 'shared_client_req_99' },
          headers: {},
        } as any,
        resA2,
        { firestore: memFs as any, isAdminFn: alwaysNonAdmin, memoryDb: noopMemDb }
      );
      assert.strictEqual(resA2.statusCode, 200);
      assert.strictEqual(resA2.body.isDuplicate, true);
      assert.strictEqual((await memFs.collection('accounts').doc('cust_A').get()).data()!.checkingBalance, 2500);
      assert.strictEqual((await memFs.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 2);
    }

    // 4d. Minimum amount (<$100) and frozen status still enforced; admin can act for customer
    {
      const resMin = createMockRes();
      await handleCreateInvestment(
        { auth: { uid: 'cust_A' }, body: { termDays: 60, amount: 50 }, headers: {} } as any,
        resMin,
        { firestore: memFs as any, isAdminFn: alwaysNonAdmin, memoryDb: noopMemDb }
      );
      assert.strictEqual(resMin.statusCode, 400);

      const resFrozen = createMockRes();
      await handleCreateInvestment(
        { auth: { uid: 'cust_frozen' }, body: { termDays: 60, amount: 200 }, headers: {} } as any,
        resFrozen,
        { firestore: memFs as any, isAdminFn: alwaysNonAdmin, memoryDb: noopMemDb }
      );
      assert.strictEqual(resFrozen.statusCode, 403);

      const resAdmin = createMockRes();
      await handleCreateInvestment(
        {
          auth: { uid: 'admin_1' },
          body: { userId: 'cust_B', termDays: 60, amount: 400, clientRequestId: 'admin_inv_b1' },
          headers: {},
        } as any,
        resAdmin,
        { firestore: memFs as any, isAdminFn: alwaysAdmin, memoryDb: noopMemDb }
      );
      assert.strictEqual(resAdmin.statusCode, 200);
      assert.strictEqual((await memFs.collection('accounts').doc('cust_B').get()).data()!.checkingBalance, 8600);
    }

    console.log('✓ 4. Part 3 (Investment Create): Cross-customer blocked (403); per-user idempotency & rules intact');
  }

  // -------------------------------------------------------------------------
  // 5. Part 4 — POST /api/investments/:id/mature + executeServerInvestmentMaturity
  // -------------------------------------------------------------------------
  {
    const memFs = new StrictInMemoryFirestore();
    await seedCustomer(memFs, 'cust_A', { checkingBalance: 1000, investedBalance: 500 });
    await seedCustomer(memFs, 'cust_B', { checkingBalance: 2000, investedBalance: 2000 });

    const pastIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const futureIso = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();

    await memFs.collection('investments').doc('inv_A_matured').set({
      id: 'inv_A_matured',
      userId: 'cust_A',
      planName: '60-Day Treasury',
      termDays: 60,
      amount: 500,
      expectedYield: 1350,
      expectedMaturityValue: 1850,
      maturityDate: pastIso,
      status: 'ACTIVE',
    });
    await memFs.collection('investments').doc('inv_B_matured').set({
      id: 'inv_B_matured',
      userId: 'cust_B',
      planName: '60-Day Treasury',
      termDays: 60,
      amount: 1000,
      expectedYield: 2700,
      expectedMaturityValue: 3700,
      maturityDate: pastIso,
      status: 'ACTIVE',
    });
    await memFs.collection('investments').doc('inv_A_early').set({
      id: 'inv_A_early',
      userId: 'cust_A',
      planName: '60-Day Treasury',
      termDays: 60,
      amount: 300,
      expectedYield: 810,
      expectedMaturityValue: 1110,
      maturityDate: futureIso,
      status: 'ACTIVE',
    });

    const noopMemDb = { matureInvestment: () => ({} as any) };

    // 5a. Customer A trying to mature Customer B's investment (with spoofed body userId or own UID) -> 403
    for (const body of [{ userId: 'cust_B' }, { userId: 'cust_A' }, {}]) {
      const res = createMockRes();
      await handleMatureInvestment(
        { auth: { uid: 'cust_A' }, params: { id: 'inv_B_matured' }, body, headers: {} } as any,
        res,
        { firestore: memFs as any, isAdminFn: alwaysNonAdmin, memoryDb: noopMemDb }
      );
      assert.strictEqual(res.statusCode, 403);
    }
    assert.strictEqual((await memFs.collection('investments').doc('inv_B_matured').get()).data()!.status, 'ACTIVE');
    assert.strictEqual((await memFs.collection('accounts').doc('cust_B').get()).data()!.checkingBalance, 2000);
    assert.strictEqual((await memFs.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 0);

    // 5b. Direct helper rejects Customer A trying to settle Customer B investment
    {
      const directRes = await executeServerInvestmentMaturity(
        { investmentId: 'inv_B_matured', userId: 'cust_B', authenticatedUid: 'cust_A', isAuthorizedAdmin: false },
        { firestore: memFs as unknown as Firestore }
      );
      assert.strictEqual(directRes.success, false);
      assert.strictEqual(directRes.errorCode, 'FORBIDDEN');
    }

    // 5c. Early maturity still rejected even for owner or admin
    {
      const resEarly = createMockRes();
      await handleMatureInvestment(
        { auth: { uid: 'cust_A' }, params: { id: 'inv_A_early' }, body: {}, headers: {} } as any,
        resEarly,
        { firestore: memFs as any, isAdminFn: alwaysNonAdmin, memoryDb: noopMemDb }
      );
      assert.strictEqual(resEarly.statusCode, 400);
      assert(resEarly.body.error.includes('not reached maturity date'));
    }

    // 5d. Owner matures inv_A_matured once; replay is idempotent
    {
      const resMatA1 = createMockRes();
      await handleMatureInvestment(
        { auth: { uid: 'cust_A' }, params: { id: 'inv_A_matured' }, body: {}, headers: {} } as any,
        resMatA1,
        { firestore: memFs as any, isAdminFn: alwaysNonAdmin, memoryDb: noopMemDb }
      );
      assert.strictEqual(resMatA1.statusCode, 200);
      assert.strictEqual(resMatA1.body.payoutAmount, 1850);
      assert.strictEqual((await memFs.collection('accounts').doc('cust_A').get()).data()!.checkingBalance, 2850);
      assert.strictEqual((await memFs.collection('accounts').doc('cust_A').get()).data()!.investedBalance, 0);

      const resMatA2 = createMockRes();
      await handleMatureInvestment(
        { auth: { uid: 'cust_A' }, params: { id: 'inv_A_matured' }, body: {}, headers: {} } as any,
        resMatA2,
        { firestore: memFs as any, isAdminFn: alwaysNonAdmin, memoryDb: noopMemDb }
      );
      assert.strictEqual(resMatA2.statusCode, 200);
      assert.strictEqual(resMatA2.body.isDuplicate, true);
      assert.strictEqual((await memFs.collection('accounts').doc('cust_A').get()).data()!.checkingBalance, 2850);
    }

    // 5e. Verified admin can mature Customer B investment even without supplying body.userId (uses effectiveOwnerId!)
    {
      const resAdmin = createMockRes();
      await handleMatureInvestment(
        { auth: { uid: 'admin_1' }, params: { id: 'inv_B_matured' }, body: {}, headers: {} } as any,
        resAdmin,
        { firestore: memFs as any, isAdminFn: alwaysAdmin, memoryDb: noopMemDb }
      );
      assert.strictEqual(resAdmin.statusCode, 200);
      assert.strictEqual(resAdmin.body.transaction.userId, 'cust_B');
      assert.strictEqual((await memFs.collection('accounts').doc('cust_B').get()).data()!.checkingBalance, 5700);
      const outboxDocs = (await memFs.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).docs.map((d) => d.data());
      assert.strictEqual(outboxDocs.length, 2);
      assert(outboxDocs.some((o) => o.userId === 'cust_B' && o.dispatchType === 'INVESTMENT'));
    }

    console.log('✓ 5. Part 4 (Investment Mature): Cross-customer & premature maturity blocked; owner & admin succeed');
  }

  // -------------------------------------------------------------------------
  // 6. Part 5 — GET /api/rewards/welcome/:userId
  // -------------------------------------------------------------------------
  {
    const memFs = new StrictInMemoryFirestore();
    await seedCustomer(memFs, 'cust_A', { checkingBalance: 12000 });
    await seedCustomer(memFs, 'cust_B', { checkingBalance: 15000 });

    // Verified $10,000 Stripe deposit for Customer B (would qualify if triggered!) + $20,000 loan disbursement for Customer A (excluded!)
    await memFs.collection('transactions').doc('tx_dep_B1').set({
      id: 'tx_dep_B1',
      userId: 'cust_B',
      recipientUserId: 'cust_B',
      type: 'DEPOSIT',
      status: 'COMPLETED',
      amount: 10500,
      referenceNumber: 'MV-DEP-STRIPE-B1',
      paymentProviderRef: 'pi_stripe_live_b1',
      metadata: { stripeSessionId: 'cs_live_b1' },
    });
    await memFs.collection('transactions').doc('tx_loan_A1').set({
      id: 'tx_loan_A1',
      userId: 'cust_A',
      recipientUserId: 'cust_A',
      type: 'DEPOSIT',
      status: 'COMPLETED',
      amount: 20000,
      senderAccountNumber: 'MVB-LN-001',
      senderName: 'Monvera Credit & Lending Facility',
      referenceNumber: 'MVB-LN-12345',
      metadata: { isLoanDisbursement: true },
    });
    await memFs.collection('transactions').doc('tx_dep_A1').set({
      id: 'tx_dep_A1',
      userId: 'cust_A',
      recipientUserId: 'cust_A',
      type: 'DEPOSIT',
      status: 'COMPLETED',
      amount: 10000,
      referenceNumber: 'MV-DEP-STRIPE-A1',
      paymentProviderRef: 'pi_stripe_live_a1',
      metadata: { stripeSessionId: 'cs_live_a1' },
    });

    const evalWithHarness = (uid: string) =>
      evaluateAndProcessWelcomeReward(uid, {
        firestore: memFs as unknown as Firestore,
        isAdminConfigured: () => true,
        persistNotification: async () => undefined as any,
      });

    // 6a. Unauthenticated caller at handler boundary -> 401
    {
      const res = createMockRes();
      await handleGetWelcomeReward(
        { params: { userId: 'cust_B' }, headers: {} } as any,
        res,
        { evaluateRewardFn: evalWithHarness, isAdminFn: alwaysNonAdmin }
      );
      assert.strictEqual(res.statusCode, 401);
    }

    // 6b. Customer A querying Customer B's Welcome Reward -> 403, ZERO reward evaluation or payout!
    {
      let evaluated = false;
      const res = createMockRes();
      await handleGetWelcomeReward(
        { auth: { uid: 'cust_A' }, params: { userId: 'cust_B' }, headers: {} } as any,
        res,
        {
          evaluateRewardFn: async (uid) => {
            evaluated = true;
            return evalWithHarness(uid);
          },
          isAdminFn: alwaysNonAdmin,
        }
      );
      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(evaluated, false, 'Reward evaluation must NOT run for unauthorized caller');
      assert.strictEqual((await memFs.collection('accounts').doc('cust_B').get()).data()!.checkingBalance, 15000);
      assert.strictEqual((await memFs.collection(NOTIFICATION_OUTBOX_COLLECTION).get()).size, 0);
    }

    // 6c. Customer A querying own Welcome Reward -> 200, excludes loan disbursement ($20k), counts $10k deposit, pays $1,000 once
    {
      const resOwn1 = createMockRes();
      await handleGetWelcomeReward(
        { auth: { uid: 'cust_A' }, params: { userId: 'cust_A' }, headers: {} } as any,
        resOwn1,
        { evaluateRewardFn: evalWithHarness, isAdminFn: alwaysNonAdmin }
      );
      assert.strictEqual(resOwn1.statusCode, 200);
      assert.strictEqual(resOwn1.body.reward.qualifyingDeposits, 10000, 'Loan disbursement must be excluded');
      assert.strictEqual(resOwn1.body.reward.status, 'PAID');
      assert.strictEqual((await memFs.collection('accounts').doc('cust_A').get()).data()!.checkingBalance, 13000);

      // Replay must NOT pay $1,000 again
      const resOwn2 = createMockRes();
      await handleGetWelcomeReward(
        { auth: { uid: 'cust_A' }, params: { userId: 'cust_A' }, headers: {} } as any,
        resOwn2,
        { evaluateRewardFn: evalWithHarness, isAdminFn: alwaysNonAdmin }
      );
      assert.strictEqual(resOwn2.statusCode, 200);
      assert.strictEqual((await memFs.collection('accounts').doc('cust_A').get()).data()!.checkingBalance, 13000);
    }

    // 6d. Verified admin querying Customer B's Welcome Reward -> 200
    {
      const resAdmin = createMockRes();
      await handleGetWelcomeReward(
        { auth: { uid: 'admin_1' }, params: { userId: 'cust_B' }, headers: {} } as any,
        resAdmin,
        { evaluateRewardFn: evalWithHarness, isAdminFn: alwaysAdmin }
      );
      assert.strictEqual(resAdmin.statusCode, 200);
      assert.strictEqual(resAdmin.body.reward.status, 'PAID');
      assert.strictEqual((await memFs.collection('accounts').doc('cust_B').get()).data()!.checkingBalance, 16000);
    }

    console.log('✓ 6. Part 5 (Welcome Reward): Cross-customer blocked (403); loan exclusion & one-time $1,000 lock intact');
  }

  // -------------------------------------------------------------------------
  // 7. Client API verification (src/services/api.ts)
  // -------------------------------------------------------------------------
  {
    const apiSrc = fs.readFileSync('src/services/api.ts', 'utf8');
    const balSection = apiSrc.slice(
      apiSrc.indexOf('async getBalanceMetrics('),
      apiSrc.indexOf('async lookupRecipient(')
    );
    assert(
      balSection.includes('getAuthHeaders()') && balSection.includes('headers'),
      'api.getBalanceMetrics must attach getAuthHeaders() to /api/accounts/balance request'
    );

    const revSection = apiSrc.slice(
      apiSrc.indexOf('async reversePendingWithdrawal('),
      apiSrc.indexOf('async checkAndExecutePendingWithdrawalReversals(')
    );
    assert(
      revSection.includes('getAuthHeaders()') &&
        revSection.includes('res.status === 401 || res.status === 403'),
      'api.reversePendingWithdrawal must attach getAuthHeaders() and abort on 401/403 without client fallback'
    );

    console.log('✓ 7. Client API (src/services/api.ts) sends Firebase Auth headers on balance & withdrawal reversal calls');
  }

  console.log('\nALL STAGE 3D-C2.6 ENDPOINT AUTHENTICATION & AUTHORIZATION TESTS PASSED.\n');
}

runTests().catch((err) => {
  console.error('Stage 3D-C2.6 test suite failed:', err);
  process.exit(1);
});
