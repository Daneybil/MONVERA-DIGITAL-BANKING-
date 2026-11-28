/**
 * MONVERA — STAGE 2B: CUSTOMER BALANCE PERSISTENCE & DISPLAY PROTECTION TESTS
 *
 * Verifies:
 *  1. Valid live accounts/{uid} balances (including savings/invested-only & genuine $0) resolve accurately.
 *  2. Cached balance persistence preserves last known balance cleanly without overwriting on read errors.
 *  3. Empty/zero accounts/{uid} NEVER overwrites valid owned legacy accounts/{permanentAccountNumber}
 *     across single-read selection, real-time two-stream snapshot coordination, and GET /api/accounts/balance.
 *  4. Legacy ownership enforcement rejects mismatched userId/uid/ownerUid/email/accountNumber on legacy docs.
 *  5. Temporary DB read errors (RESOURCE_EXHAUSTED, UNAVAILABLE, etc.) return 503/500 honestly and never fabricate $0.
 *  6. Snapshot coordinator recovers cleanly when live Firestore updates resume after an error.
 *  7. AuthContext, DashboardOverview, and AccountsView preserve cached balances with "Cached — reconnecting" labeling.
 */

import assert from 'assert';
import fs from 'fs';

import {
  sanitizeAccountNumber,
  hasAnyPositiveBalance,
  isLegacyAccountOwnedByUser,
  selectAuthoritativeAccountDocData,
  normalizeBalanceMetricsFromDoc,
  createAccountSnapshotCoordinator,
  readCachedUserBalances,
  writeCachedUserBalances,
} from './src/utils/balancePersistence';

class MockStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

type StoreMap = Map<string, Map<string, Record<string, any>>>;

function createServerTestFirestore(options?: {
  failAccountDocId?: string;
  failUserDocId?: string;
  errorToThrow?: any;
}) {
  const store: StoreMap = new Map();
  const getCol = (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name)!;
  };

  return {
    store,
    collection(name: string) {
      return {
        doc(id: string) {
          return {
            async get() {
              if (name === 'accounts' && options?.failAccountDocId === id) {
                throw options.errorToThrow || Object.assign(new Error('RESOURCE_EXHAUSTED'), { code: 8 });
              }
              if (name === 'users' && options?.failUserDocId === id) {
                throw options.errorToThrow || Object.assign(new Error('UNAVAILABLE'), { code: 14 });
              }
              const data = getCol(name).get(id);
              return {
                id,
                exists: data !== undefined,
                data: () => (data ? structuredClone(data) : undefined),
              };
            },
            async set(data: Record<string, any>) {
              getCol(name).set(id, structuredClone(data));
            },
          };
        },
      };
    },
  };
}

function createMockRes() {
  return {
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
}

async function runTests() {
  process.env.VERCEL = '1';
  const { handleGetAccountBalance } = await import('./server');
  const alwaysNonAdmin = async () => false;

  console.log('\n=== STAGE 2B: CUSTOMER BALANCE PERSISTENCE & DISPLAY PROTECTION TESTS ===\n');

  // -------------------------------------------------------------------------
  // 1. Positive balance detection & legacy ownership rules
  // -------------------------------------------------------------------------
  {
    assert.strictEqual(sanitizeAccountNumber(' 1088-4920 01 '), '1088492001');
    assert.strictEqual(sanitizeAccountNumber('0000000000'), '');
    assert.strictEqual(sanitizeAccountNumber(''), '');

    assert.strictEqual(hasAnyPositiveBalance(null), false);
    assert.strictEqual(hasAnyPositiveBalance({ checkingBalance: 0, totalBalance: 0 }), false);
    assert.strictEqual(hasAnyPositiveBalance({ checkingBalance: 0, savingsBalance: 2500 }), true);
    assert.strictEqual(hasAnyPositiveBalance({ checkingBalance: 0, investedBalance: 5000 }), true);
    assert.strictEqual(hasAnyPositiveBalance({ checkingBalance: 0, accruedEarnings: 12.5 }), true);

    assert.strictEqual(
      isLegacyAccountOwnedByUser({
        uid: 'uid_owner',
        cleanAccountNumber: '1088492001',
        legacyData: { checkingBalance: 12000, permanentAccountNumber: '1088492001' },
      }),
      true
    );

    assert.strictEqual(
      isLegacyAccountOwnedByUser({
        uid: 'uid_attacker',
        cleanAccountNumber: '1088492001',
        legacyData: { userId: 'uid_victim', checkingBalance: 99000 },
      }),
      false,
      'Legacy doc with differing userId must be rejected'
    );

    assert.strictEqual(
      isLegacyAccountOwnedByUser({
        uid: 'uid_owner',
        cleanAccountNumber: '1088492001',
        legacyData: { email: 'other@monvera.test', checkingBalance: 99000 },
        userEmail: 'owner@monvera.test',
      }),
      false,
      'Legacy doc with differing email must be rejected'
    );

    console.log('✓ 1. Balance detection & strict legacy ownership verification passed');
  }

  // -------------------------------------------------------------------------
  // 2. Authoritative account selection: zero UID doc NEVER overwrites legacy balance
  // -------------------------------------------------------------------------
  {
    // Empty/zero UID doc vs valid owned legacy doc -> picks legacy
    const sel1 = selectAuthoritativeAccountDocData({
      uid: 'uid_1',
      uidExists: true,
      uidData: { checkingBalance: 0, savingsBalance: 0, totalBalance: 0 },
      legacyAccNumber: '1088492001',
      legacyExists: true,
      legacyData: { userId: 'uid_1', checkingBalance: 18500, savingsBalance: 4000, totalBalance: 22500 },
    });
    assert.strictEqual(sel1.source, 'legacy');
    assert.strictEqual(sel1.data?.checkingBalance, 18500);

    // Non-zero UID doc wins even if legacy doc also exists
    const sel2 = selectAuthoritativeAccountDocData({
      uid: 'uid_1',
      uidExists: true,
      uidData: { checkingBalance: 25000, savingsBalance: 5000, totalBalance: 30000 },
      legacyAccNumber: '1088492001',
      legacyExists: true,
      legacyData: { userId: 'uid_1', checkingBalance: 18500, savingsBalance: 4000, totalBalance: 22500 },
    });
    assert.strictEqual(sel2.source, 'uid');
    assert.strictEqual(sel2.data?.checkingBalance, 25000);

    // Zero UID doc vs mismatched-owner legacy doc -> does NOT use stolen legacy doc
    const sel3 = selectAuthoritativeAccountDocData({
      uid: 'uid_1',
      uidExists: true,
      uidData: { checkingBalance: 0, totalBalance: 0 },
      legacyAccNumber: '1088492001',
      legacyExists: true,
      legacyData: { userId: 'uid_someone_else', checkingBalance: 75000 },
    });
    assert.strictEqual(sel3.source, 'uid');
    assert.strictEqual(sel3.data?.checkingBalance, 0);

    console.log('✓ 2. Authoritative account-source selection protects valid legacy balances');
  }

  // -------------------------------------------------------------------------
  // 3. Real-time Snapshot Coordinator: avoids $0 overwrite, holds on errors, recovers when DB returns
  // -------------------------------------------------------------------------
  {
    const emissions: number[] = [];
    const errors: unknown[] = [];

    const coordinator = createAccountSnapshotCoordinator({
      uid: 'uid_legacy_cust',
      legacyAccNumber: '1088492001',
      userEmail: 'legacy@monvera.test',
      onUpdate: (metrics) => emissions.push(metrics.totalBalance),
      onError: (err) => errors.push(err),
    });

    // Simulate zero-valued UID snapshot arriving BEFORE legacy snapshot settles
    coordinator.onUidSnapshot(true, { checkingBalance: 0, savingsBalance: 0, totalBalance: 0 });
    assert.strictEqual(emissions.length, 0, 'Must NOT emit $0 before legacy stream settles');

    // Legacy snapshot arrives with real balance ($42,750)
    coordinator.onLegacySnapshot(true, {
      userId: 'uid_legacy_cust',
      checkingBalance: 32750,
      savingsBalance: 10000,
      totalBalance: 42750,
    });
    assert.deepStrictEqual(emissions, [42750]);

    // Subsequent zero-valued update on accounts/{uid} MUST NOT overwrite $42,750
    coordinator.onUidSnapshot(true, { checkingBalance: 0, totalBalance: 0, updatedAt: '2026-11-28T00:00:00Z' });
    assert.deepStrictEqual(emissions, [42750, 42750]);

    // Subsequent temporary Firestore error surfaces via onError without emitting $0
    coordinator.onUidError(Object.assign(new Error('RESOURCE_EXHAUSTED'), { code: 'resource-exhausted' }));
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(emissions[emissions.length - 1], 42750);

    // When connectivity returns with updated live UID balance ($45,000), coordinator emits live balance
    coordinator.onUidSnapshot(true, { checkingBalance: 35000, savingsBalance: 10000, totalBalance: 45000 });
    assert.strictEqual(emissions[emissions.length - 1], 45000);

    // Separate test: UID error + legacy $0 must NEVER emit $0
    const errEmissions: number[] = [];
    const errCoord = createAccountSnapshotCoordinator({
      uid: 'uid_2',
      legacyAccNumber: '1088492002',
      onUpdate: (m) => errEmissions.push(m.totalBalance),
    });
    errCoord.onUidError(new Error('unavailable'));
    errCoord.onLegacySnapshot(true, { userId: 'uid_2', checkingBalance: 0, totalBalance: 0 });
    assert.strictEqual(errEmissions.length, 0, 'Must NOT emit $0 from legacy when UID stream errored');

    console.log('✓ 3. Real-time snapshot coordinator preserves legacy balance & recovers automatically');
  }

  // -------------------------------------------------------------------------
  // 4. Cached balance persistence helpers
  // -------------------------------------------------------------------------
  {
    const storage = new MockStorage();
    const sampleMetrics = normalizeBalanceMetricsFromDoc('uid_cache_1', {
      checkingBalance: 12345.67,
      savingsBalance: 2000,
      investedBalance: 5000,
      accruedEarnings: 250,
      totalBalance: 19595.67,
      permanentAccountNumber: '1088492099',
    });

    writeCachedUserBalances('uid_cache_1', sampleMetrics, storage, '2026-11-28T09:00:00.000Z');
    const restored = readCachedUserBalances('uid_cache_1', storage);
    assert(restored !== null);
    assert.strictEqual(restored.metrics.totalBalance, 19595.67);
    assert.strictEqual(restored.metrics.checkingBalance, 12345.67);
    assert.strictEqual(restored.cachedAt, '2026-11-28T09:00:00.000Z');

    // Corrupted cache JSON does not throw and returns null safely
    storage.setItem('monvera_balances_uid_bad', '{broken json');
    assert.strictEqual(readCachedUserBalances('uid_bad', storage), null);

    console.log('✓ 4. Cached balance storage hydration & corrupt-data resilience passed');
  }

  // -------------------------------------------------------------------------
  // 5. Server GET /api/accounts/balance: legacy fallback, ownership enforcement & honest DB errors
  // -------------------------------------------------------------------------
  {
    // 5a. Missing accounts/{uid}, valid verified legacy accounts/{permanentAccountNumber} -> 200 with legacy balance
    {
      const memFs = createServerTestFirestore();
      await memFs.collection('users').doc('uid_leg_only').set({
        id: 'uid_leg_only',
        email: 'legonly@monvera.test',
        permanentAccountNumber: '1088492111',
      });
      await memFs.collection('accounts').doc('1088492111').set({
        permanentAccountNumber: '1088492111',
        checkingBalance: 14200,
        savingsBalance: 3800,
        totalBalance: 18000,
      });

      const res = createMockRes();
      await handleGetAccountBalance(
        { auth: { uid: 'uid_leg_only' }, query: { userId: 'uid_leg_only' }, headers: {} } as any,
        res as any,
        { firestore: memFs as any, isAdminFn: alwaysNonAdmin }
      );
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.checkingBalance, 14200);
      assert.strictEqual(res.body.savingsBalance, 3800);
      assert.strictEqual(res.body.totalBalance, 18000);
    }

    // 5b. Zero-valued accounts/{uid} + valid verified legacy accounts/{permanentAccountNumber} -> 200 with legacy balance (NOT $0!)
    {
      const memFs = createServerTestFirestore();
      await memFs.collection('users').doc('uid_zero_uid').set({
        id: 'uid_zero_uid',
        email: 'zerouid@monvera.test',
        permanentAccountNumber: '1088492222',
      });
      await memFs.collection('accounts').doc('uid_zero_uid').set({
        userId: 'uid_zero_uid',
        checkingBalance: 0,
        savingsBalance: 0,
        totalBalance: 0,
      });
      await memFs.collection('accounts').doc('1088492222').set({
        userId: 'uid_zero_uid',
        permanentAccountNumber: '1088492222',
        checkingBalance: 51250.25,
        savingsBalance: 10000,
        totalBalance: 61250.25,
      });

      const res = createMockRes();
      await handleGetAccountBalance(
        { auth: { uid: 'uid_zero_uid' }, query: {}, headers: {} } as any,
        res as any,
        { firestore: memFs as any, isAdminFn: alwaysNonAdmin }
      );
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.checkingBalance, 51250.25);
      assert.strictEqual(res.body.totalBalance, 61250.25);
    }

    // 5c. Legacy ownership violation: legacy doc belongs to a DIFFERENT userId -> rejected cleanly
    {
      const memFs = createServerTestFirestore();
      await memFs.collection('users').doc('uid_spoof').set({
        id: 'uid_spoof',
        email: 'spoof@monvera.test',
        permanentAccountNumber: '1088492333',
      });
      await memFs.collection('accounts').doc('1088492333').set({
        userId: 'uid_real_owner',
        permanentAccountNumber: '1088492333',
        checkingBalance: 999999,
        totalBalance: 999999,
      });

      const res = createMockRes();
      await handleGetAccountBalance(
        { auth: { uid: 'uid_spoof' }, query: {}, headers: {} } as any,
        res as any,
        { firestore: memFs as any, isAdminFn: alwaysNonAdmin }
      );
      assert.strictEqual(res.statusCode, 404);
      assert.strictEqual(res.body.code, 'ACCOUNT_NOT_FOUND');
    }

    // 5d. DB read failure on accounts/{uid} or legacy lookup -> honest 503 error, never fabricated $0
    {
      const quotaFs = createServerTestFirestore({
        failAccountDocId: 'uid_err_1',
        errorToThrow: Object.assign(new Error('RESOURCE_EXHAUSTED'), { code: 8 }),
      });
      const resQuota = createMockRes();
      await handleGetAccountBalance(
        { auth: { uid: 'uid_err_1' }, query: {}, headers: {} } as any,
        resQuota as any,
        { firestore: quotaFs as any, isAdminFn: alwaysNonAdmin }
      );
      assert.strictEqual(resQuota.statusCode, 503);
      assert.strictEqual(resQuota.body.code, 'RESOURCE_EXHAUSTED');
      assert.strictEqual(resQuota.body.checkingBalance, undefined);

      // Failure during users/{uid} lookup in legacy fallback path also returns 503 cleanly
      const userFailFs = createServerTestFirestore({
        failUserDocId: 'uid_err_2',
        errorToThrow: Object.assign(new Error('UNAVAILABLE'), { code: 14 }),
      });
      const resUserFail = createMockRes();
      await handleGetAccountBalance(
        { auth: { uid: 'uid_err_2' }, query: {}, headers: {} } as any,
        resUserFail as any,
        { firestore: userFailFs as any, isAdminFn: alwaysNonAdmin }
      );
      assert.strictEqual(resUserFail.statusCode, 503);
      assert.strictEqual(resUserFail.body.code, 'FIRESTORE_UNAVAILABLE');
      assert.strictEqual(resUserFail.body.checkingBalance, undefined);
    }

    console.log('✓ 5. Server /api/accounts/balance legacy fallback, ownership checks & honest DB errors passed');
  }

  // -------------------------------------------------------------------------
  // 6. UI & AuthContext Static Guarantees
  // -------------------------------------------------------------------------
  {
    const authSrc = fs.readFileSync('./src/context/AuthContext.tsx', 'utf8');
    const overviewSrc = fs.readFileSync('./src/components/dashboard/DashboardOverview.tsx', 'utf8');
    const accountsSrc = fs.readFileSync('./src/components/dashboard/AccountsView.tsx', 'utf8');

    assert(authSrc.includes('isBalanceCached'), 'AuthContext must expose isBalanceCached');
    assert(authSrc.includes('hydrateCachedBalanceIfNeeded'), 'AuthContext must hydrate cached balance during auth/failure');
    assert(authSrc.includes('applyLiveBalanceMetrics'), 'AuthContext must replace cached flag once live balance resolves');
    assert(
      !authSrc.includes('metricsRes = await api.getCurrentUser(resolvedUser.id)'),
      'AuthContext onAuthStateChanged must NOT use unauthenticated /api/auth/me balance fallback'
    );

    assert(overviewSrc.includes('Cached — reconnecting'), 'DashboardOverview must clearly label cached balances');
    assert(
      !overviewSrc.includes('Displaying verified last-known balances'),
      'DashboardOverview must never claim cached balances are verified'
    );
    assert(
      !overviewSrc.includes("!liveBalanceMetrics ? '••••'"),
      'DashboardOverview breakdown cards must remain visible when cached balance is displayed'
    );

    assert(accountsSrc.includes('Cached — reconnecting'), 'AccountsView must clearly label cached balances');
    assert(accountsSrc.includes('readCachedUserBalances'), 'AccountsView must keep cached balances visible on reconnect');

    console.log('✓ 6. AuthContext, DashboardOverview, and AccountsView display & cache protections verified');
  }

  console.log('\nALL STAGE 2B BALANCE PERSISTENCE & DISPLAY PROTECTION TESTS PASSED.\n');
}

runTests().catch((err) => {
  console.error('Stage 2B test suite failed:', err);
  process.exit(1);
});
