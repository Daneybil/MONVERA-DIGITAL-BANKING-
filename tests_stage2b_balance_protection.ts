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
  resolveClientAccountBalanceRead,
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
        async get() {
          const entries = Array.from(getCol(name).entries());
          const docs = entries.map(([id, data]) => ({
            id,
            exists: true,
            data: () => structuredClone(data),
          }));
          return {
            docs,
            empty: docs.length === 0,
            size: docs.length,
            forEach(cb: (d: { id: string; exists: boolean; data: () => Record<string, any> }) => void) {
              docs.forEach(cb);
            },
          };
        },
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

  // -------------------------------------------------------------------------
  // 7. Stage 2B.1 Critical Legacy Balance Fallback Correction Tests
  // -------------------------------------------------------------------------
  {
    const { handleGetAdminOverview, handleGetAdminCustomers } = await import('./server');
    const { api } = await import('./src/services/api');
    const { firestoreSync } = await import('./src/services/firestoreSync');

    // 7a. Client getAccountBalances / resolveClientAccountBalanceRead with $0 UID + permission-denied on legacy
    // MUST return null (never $0) so callers fall back to authenticated /api/accounts/balance
    const permissionDeniedErr = Object.assign(new Error('Missing or insufficient permissions (permission-denied)'), {
      code: 'permission-denied',
    });

    const clientPermDeniedResult = await resolveClientAccountBalanceRead({
      userId: 'uid_leg_perm',
      userAccountNumber: '1088492555',
      userEmail: 'perm@monvera.test',
      readAccountDoc: async (docId) => {
        if (docId === 'uid_leg_perm') {
          return { exists: true, data: { checkingBalance: 0, savingsBalance: 0, totalBalance: 0 } };
        }
        throw permissionDeniedErr;
      },
    });
    assert.strictEqual(
      clientPermDeniedResult,
      null,
      'Client balance read MUST return null (not $0) when UID is $0 and legacy read gets permission-denied'
    );

    const syncPermDeniedResult = await firestoreSync.getAccountBalances(
      'uid_leg_perm',
      '1088492555',
      'perm@monvera.test',
      {
        readAccountDoc: async (docId) => {
          if (docId === 'uid_leg_perm') {
            return { exists: true, data: { checkingBalance: 0, savingsBalance: 0, totalBalance: 0 } };
          }
          throw permissionDeniedErr;
        },
      }
    );
    assert.strictEqual(
      syncPermDeniedResult,
      null,
      'firestoreSync.getAccountBalances MUST return null (not $0) when legacy read gets permission-denied'
    );

    // 7b. End-to-end: $0 UID + permission-denied client legacy read -> api.getBalanceMetrics triggers /api/accounts/balance
    // and resolves real owned legacy balance ($78,500), deduplicating concurrent calls.
    {
      const memFs = createServerTestFirestore();
      await memFs.collection('users').doc('uid_perm_cust').set({
        id: 'uid_perm_cust',
        email: 'cust@monvera.test',
        permanentAccountNumber: '1088492666',
      });
      await memFs.collection('accounts').doc('uid_perm_cust').set({
        userId: 'uid_perm_cust',
        checkingBalance: 0,
        savingsBalance: 0,
        totalBalance: 0,
      });
      await memFs.collection('accounts').doc('1088492666').set({
        userId: 'uid_perm_cust',
        permanentAccountNumber: '1088492666',
        checkingBalance: 60500,
        savingsBalance: 18000,
        totalBalance: 78500,
      });

      let backendCallCount = 0;
      const mockBackendFetch = async (endpoint: string) => {
        backendCallCount++;
        assert(endpoint.startsWith('/api/accounts/balance?userId=uid_perm_cust'));
        const res = createMockRes();
        await handleGetAccountBalance(
          { auth: { uid: 'uid_perm_cust' }, query: { userId: 'uid_perm_cust' }, headers: {} } as any,
          res as any,
          { firestore: memFs as any, isAdminFn: alwaysNonAdmin }
        );
        return {
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          headers: { get: () => 'application/json' },
          json: async () => res.body,
          text: async () => JSON.stringify(res.body),
        } as unknown as Response;
      };

      const [resA, resB] = await Promise.all([
        api.getBalanceMetrics('uid_perm_cust', '1088492666', {
          firestoreReadFn: () =>
            firestoreSync.getAccountBalances('uid_perm_cust', '1088492666', 'cust@monvera.test', {
              readAccountDoc: async (docId) =>
                docId === 'uid_perm_cust'
                  ? { exists: true, data: { checkingBalance: 0, totalBalance: 0 } }
                  : (() => {
                      throw permissionDeniedErr;
                    })(),
            }),
          fetchFn: mockBackendFetch,
          getAuthHeadersFn: async () => ({ Authorization: 'Bearer test-token' }),
        }),
        api.getBalanceMetrics('uid_perm_cust', '1088492666', {
          firestoreReadFn: async () => null,
          fetchFn: mockBackendFetch,
          getAuthHeadersFn: async () => ({ Authorization: 'Bearer test-token' }),
        }),
      ]);

      assert.strictEqual(backendCallCount, 1, 'Concurrent /api/accounts/balance requests MUST be deduplicated');
      assert(resA !== null && resB !== null);
      assert.strictEqual(resA.checkingBalance, 60500);
      assert.strictEqual(resA.totalBalance, 78500);
      assert.strictEqual(resB.totalBalance, 78500);
    }

    // 7c. Genuinely verified zero balance: UID is $0, no legacy balance exists, legacy client read gets permission-denied,
    // backend /api/accounts/balance confirms $0 -> genuine $0 IS preserved and returned.
    {
      const memFs = createServerTestFirestore();
      await memFs.collection('users').doc('uid_true_zero').set({
        id: 'uid_true_zero',
        email: 'zero@monvera.test',
        permanentAccountNumber: '1088492777',
      });
      await memFs.collection('accounts').doc('uid_true_zero').set({
        userId: 'uid_true_zero',
        checkingBalance: 0,
        savingsBalance: 0,
        totalBalance: 0,
      });

      const zeroMetrics = await api.getBalanceMetrics('uid_true_zero', '1088492777', {
        firestoreReadFn: async () => null,
        fetchFn: async () => {
          const res = createMockRes();
          await handleGetAccountBalance(
            { auth: { uid: 'uid_true_zero' }, query: { userId: 'uid_true_zero' }, headers: {} } as any,
            res as any,
            { firestore: memFs as any, isAdminFn: alwaysNonAdmin }
          );
          return {
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            headers: { get: () => 'application/json' },
            json: async () => res.body,
            text: async () => JSON.stringify(res.body),
          } as unknown as Response;
        },
        getAuthHeadersFn: async () => ({ Authorization: 'Bearer test-token' }),
      });

      assert(zeroMetrics !== null, 'Backend-confirmed genuine zero balance must be returned');
      assert.strictEqual(zeroMetrics.checkingBalance, 0);
      assert.strictEqual(zeroMetrics.totalBalance, 0);
    }

    // 7d. Backend failure (503) with $0 UID + permission-denied legacy read MUST return null (preserving cached balance)
    {
      const failedMetrics = await api.getBalanceMetrics('uid_503_cache', '1088492888', {
        firestoreReadFn: async () => null,
        fetchFn: async () =>
          ({
            ok: false,
            status: 503,
            headers: { get: () => 'application/json' },
            json: async () => ({ error: 'Service unavailable', code: 'FIRESTORE_UNAVAILABLE' }),
            text: async () => '{"error":"Service unavailable"}',
          } as unknown as Response),
        getAuthHeadersFn: async () => ({ Authorization: 'Bearer test-token' }),
      });
      assert.strictEqual(
        failedMetrics,
        null,
        'Unavailable /api/accounts/balance must return null so cached balance is never overwritten with unverified $0'
      );
    }

    // 7e. Snapshot coordinator with $0 UID + legacy permission-denied:
    // NEVER emits $0, invokes onLegacyPermissionDenied once per UID state, and emits live positive UID when later updated.
    {
      const emitted: number[] = [];
      const coordErrors: unknown[] = [];
      let fallbackTriggers = 0;

      const coord = createAccountSnapshotCoordinator({
        uid: 'uid_rt_perm',
        legacyAccNumber: '1088492999',
        userEmail: 'rt@monvera.test',
        onUpdate: (m) => emitted.push(m.totalBalance),
        onError: (e) => coordErrors.push(e),
        onLegacyPermissionDenied: () => {
          fallbackTriggers++;
        },
      });

      coord.onUidSnapshot(true, { checkingBalance: 0, savingsBalance: 0, totalBalance: 0 });
      coord.onLegacyError(permissionDeniedErr);
      // Duplicate identical $0 UID snapshot should not re-trigger fallback
      coord.onUidSnapshot(true, { checkingBalance: 0, savingsBalance: 0, totalBalance: 0 });

      assert.strictEqual(emitted.length, 0, 'Coordinator must NOT emit $0 when legacy read is permission-denied');
      assert.strictEqual(coordErrors.length, 0, 'Expected legacy permission-denied should trigger fallback, not error banner');
      assert.strictEqual(fallbackTriggers, 1, 'onLegacyPermissionDenied should trigger once without duplicate spam');

      // Later genuine live update on accounts/{uid} replaces cached/prior state cleanly
      coord.onUidSnapshot(true, { checkingBalance: 25000, savingsBalance: 5000, totalBalance: 30000 });
      assert.deepStrictEqual(emitted, [30000]);
    }

    // 7f. Admin endpoints: handleGetAdminCustomers & handleGetAdminOverview select authoritative legacy record
    // when UID doc is $0, respect ownership, and never double-count when both UID and legacy exist.
    {
      const memFs = createServerTestFirestore();
      // User 1: zero accounts/{uid} + valid $40,000 legacy accounts/{acc}
      await memFs.collection('users').doc('u_leg_1').set({
        id: 'u_leg_1',
        email: 'leg1@monvera.test',
        permanentAccountNumber: '1099000111',
      });
      await memFs.collection('accounts').doc('u_leg_1').set({
        userId: 'u_leg_1',
        checkingBalance: 0,
        savingsBalance: 0,
        totalBalance: 0,
      });
      await memFs.collection('accounts').doc('1099000111').set({
        userId: 'u_leg_1',
        permanentAccountNumber: '1099000111',
        checkingBalance: 30000,
        savingsBalance: 10000,
        totalBalance: 40000,
      });

      // User 2: BOTH UID ($15,000) and legacy ($5,000) exist -> UID wins ($15,000), must NOT sum to $20,000!
      await memFs.collection('users').doc('u_both_2').set({
        id: 'u_both_2',
        email: 'both2@monvera.test',
        permanentAccountNumber: '1099000222',
      });
      await memFs.collection('accounts').doc('u_both_2').set({
        userId: 'u_both_2',
        checkingBalance: 15000,
        savingsBalance: 0,
        totalBalance: 15000,
      });
      await memFs.collection('accounts').doc('1099000222').set({
        userId: 'u_both_2',
        permanentAccountNumber: '1099000222',
        checkingBalance: 5000,
        savingsBalance: 0,
        totalBalance: 5000,
      });

      // User 3: zero UID + stolen/mismatched legacy belonging to u_someone_else -> stays $0
      await memFs.collection('users').doc('u_spoof_3').set({
        id: 'u_spoof_3',
        email: 'spoof3@monvera.test',
        permanentAccountNumber: '1099000333',
      });
      await memFs.collection('accounts').doc('u_spoof_3').set({
        userId: 'u_spoof_3',
        checkingBalance: 0,
        totalBalance: 0,
      });
      await memFs.collection('accounts').doc('1099000333').set({
        userId: 'u_someone_else',
        checkingBalance: 999999,
        totalBalance: 999999,
      });

      const custRes = createMockRes();
      await handleGetAdminCustomers({} as any, custRes as any, {
        firestore: memFs as any,
        isFirebaseAdminConfiguredFn: () => true,
      });
      assert.strictEqual(custRes.statusCode, 200);
      assert.strictEqual(custRes.body.success, true);
      const custById = new Map<string, any>(custRes.body.customers.map((c: any) => [c.id, c]));
      assert.strictEqual(custById.get('u_leg_1').balanceMetrics.totalBalance, 40000);
      assert.strictEqual(custById.get('u_leg_1').balanceMetrics.checkingBalance, 30000);
      assert.strictEqual(custById.get('u_both_2').balanceMetrics.totalBalance, 15000);
      assert.strictEqual(custById.get('u_spoof_3').balanceMetrics.totalBalance, 0);

      const ovRes = createMockRes();
      await handleGetAdminOverview({} as any, ovRes as any, {
        firestore: memFs as any,
        isFirebaseAdminConfiguredFn: () => true,
      });
      assert.strictEqual(ovRes.statusCode, 200);
      assert.strictEqual(ovRes.body.success, true);
      assert.strictEqual(ovRes.body.totalCustomers, 3);
      assert.strictEqual(
        ovRes.body.totalPlatformDeposits,
        55000,
        'Admin overview must sum $40,000 legacy + $15,000 primary + $0 spoof without omitting legacy or double-counting'
      );
    }

    // 7g. Static check confirming api.ts removed the early `|| userAccountNumber` bypass & AuthContext uses resolveLiveOrCachedBalance
    {
      const apiSrc = fs.readFileSync('./src/services/api.ts', 'utf8');
      const authSrc = fs.readFileSync('./src/context/AuthContext.tsx', 'utf8');
      assert(
        !apiSrc.includes('hasAnyPositiveBalance(firestoreMetrics) || userAccountNumber'),
        'api.ts must NEVER short-circuit zero balances just because userAccountNumber was passed'
      );
      assert(
        apiSrc.includes('inflightBackendBalanceRequests'),
        'api.ts must deduplicate concurrent /api/accounts/balance requests'
      );
      assert(
        authSrc.includes('resolveLiveOrCachedBalance'),
        'AuthContext must route auth/refresh/switchUser balance resolution through resolveLiveOrCachedBalance'
      );
    }

    console.log('✓ 7. Stage 2B.1 critical legacy balance fallback corrections verified end-to-end');
  }

  console.log('\nALL STAGE 2B BALANCE PERSISTENCE & DISPLAY PROTECTION TESTS PASSED.\n');
}

runTests().catch((err) => {
  console.error('Stage 2B test suite failed:', err);
  process.exit(1);
});
