/**
 * MONVERA — STAGE 2A: ADMIN DATABASE SYNCHRONIZATION REPAIR VERIFICATION SUITE
 *
 * Strictly isolated tests using mock Firestore instances via dependency injection.
 * Verifies:
 *  1. Coalesced single Firestore read across getAllBankAccountApplicationsAdmin & getBankVerificationRequestsAdmin
 *  2. Stage 1 / Stage 2 verification filtering and Firestore Timestamp-safe sorting
 *  3. Cache invalidation after mutations
 *  4. Bounded transient retry (UNAVAILABLE) vs fail-fast on non-retryable errors (RESOURCE_EXHAUSTED, PERMISSION_DENIED)
 *  5. handleGetAdminOverview & handleGetAdminCustomers fail accurately (503, success:false) and NEVER fabricate zeros or []
 */
import assert from 'assert';
import type { Firestore } from 'firebase-admin/firestore';
import type { Response } from 'express';
import {
  getAllBankAccountApplicationsAdmin,
  getBankVerificationRequestsAdmin,
  getAllCardActivationRequestsAdmin,
  invalidateAdminQueueReadCache,
  classifyFirestoreReadError,
} from './server/firestoreTransactions';
import type { AuthenticatedRequest } from './server/authMiddleware';

interface MockDoc {
  id: string;
  data: () => Record<string, any>;
}

function makeMockFirestore(
  handlers: Record<string, () => Promise<MockDoc[]> | MockDoc[]>
): { firestore: Firestore; readCounts: Record<string, number> } {
  const readCounts: Record<string, number> = {};
  const firestore = {
    collection(name: string) {
      return {
        async get() {
          readCounts[name] = (readCounts[name] || 0) + 1;
          const fn = handlers[name];
          const docs = fn ? await fn() : [];
          return {
            docs,
            empty: docs.length === 0,
            size: docs.length,
            forEach(cb: (d: MockDoc) => void) {
              docs.forEach(cb);
            },
          };
        },
      };
    },
  } as unknown as Firestore;

  return { firestore, readCounts };
}

function makeMockResponse(): {
  res: Response;
  getStatus: () => number;
  getBody: () => any;
} {
  let statusCode = 200;
  let body: any = null;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: any) {
      body = payload;
      return this;
    },
  } as unknown as Response;
  return {
    res,
    getStatus: () => statusCode,
    getBody: () => body,
  };
}

async function runTests() {
  process.env.VERCEL = '1';
  const { handleGetAdminOverview, handleGetAdminCustomers } = await import('./server');

  console.log('Running Stage 2A Admin Sync Verification Suite...\n');

  // Test 1: Classifier maps quota, permission, unavailable, and unconfigured errors accurately
  {
    const quota = classifyFirestoreReadError({ code: 8, message: '8 RESOURCE_EXHAUSTED: Quota exceeded.' });
    assert.strictEqual(quota.errorCode, 'FIRESTORE_QUOTA_EXCEEDED');
    assert.strictEqual(quota.retryable, false);

    const perm = classifyFirestoreReadError({ code: 7, message: '7 PERMISSION_DENIED: Missing permissions.' });
    assert.strictEqual(perm.errorCode, 'FIRESTORE_PERMISSION_DENIED');
    assert.strictEqual(perm.retryable, false);

    const unavail = classifyFirestoreReadError({ code: 14, message: '14 UNAVAILABLE: Connection reset' });
    assert.strictEqual(unavail.errorCode, 'FIRESTORE_UNAVAILABLE');
    assert.strictEqual(unavail.retryable, true);

    console.log('✓ Test 1 passed: classifyFirestoreReadError accurately classifies quota, permission, and transient errors.');
  }

  // Test 2: Concurrent admin bank-account + bank-verification reads coalesce into 1 Firestore scan & preserve sorting/filtering
  {
    const sampleApps: MockDoc[] = [
      {
        id: 'app_pending',
        data: () => ({
          userId: 'u1',
          status: 'pending',
          submittedAt: '2026-11-27T10:00:00.000Z',
        }),
      },
      {
        id: 'app_verif_stage2',
        data: () => ({
          userId: 'u2',
          status: 'approved',
          activationStatus: 'PENDING_VERIFICATION',
          verificationReference: 'REF-123',
          verificationCodeStatus: 'PENDING',
          submittedAt: '2026-11-26T10:00:00.000Z',
          verificationSubmittedAt: { toDate: () => new Date('2026-11-27T12:00:00.000Z') },
        }),
      },
      {
        id: 'app_cancelled',
        data: () => ({
          userId: 'u3',
          status: 'cancelled',
          activationStatus: 'CANCELLED',
          verificationReference: 'REF-999',
          submittedAt: '2026-11-25T10:00:00.000Z',
        }),
      },
    ];

    const { firestore, readCounts } = makeMockFirestore({
      bank_account_applications: async () => {
        await new Promise((r) => setTimeout(r, 20));
        return sampleApps;
      },
    });

    const [apps, verifs] = await Promise.all([
      getAllBankAccountApplicationsAdmin({ firestore, isAdminConfigured: () => true }),
      getBankVerificationRequestsAdmin({ firestore, isAdminConfigured: () => true }),
    ]);

    assert.strictEqual(readCounts['bank_account_applications'], 1, 'Concurrent calls must share 1 Firestore collection read');
    assert.strictEqual(apps.length, 3);
    assert.strictEqual(apps[0].id, 'app_pending');
    assert.strictEqual(verifs.length, 1);
    assert.strictEqual(verifs[0].id, 'app_verif_stage2');

    // Invalidation clears short-lived cache so next read queries Firestore again
    invalidateAdminQueueReadCache('bank_account_applications', firestore);
    await getAllBankAccountApplicationsAdmin({ firestore, isAdminConfigured: () => true });
    assert.strictEqual(readCounts['bank_account_applications'], 2);

    console.log('✓ Test 2 passed: Bank applications & verifications coalesce concurrent Firestore reads and honor cache invalidation.');
  }

  // Test 3: Quota exceeded fails fast without retrying and preserves exact error prefix (never returns [])
  {
    const { firestore, readCounts } = makeMockFirestore({
      bank_account_applications: () => {
        throw Object.assign(new Error('8 RESOURCE_EXHAUSTED: Quota exceeded.'), { code: 8 });
      },
      card_activation_requests: () => {
        throw Object.assign(new Error('7 PERMISSION_DENIED: Missing permissions.'), { code: 7 });
      },
    });

    let bankErr: any = null;
    try {
      await getAllBankAccountApplicationsAdmin({ firestore, isAdminConfigured: () => true });
    } catch (e) {
      bankErr = e;
    }
    assert.ok(bankErr, 'Must throw on quota error');
    assert.strictEqual(readCounts['bank_account_applications'], 1, 'RESOURCE_EXHAUSTED must not retry');
    assert.strictEqual(bankErr.statusCode, 503);
    assert.strictEqual(bankErr.errorCode, 'FIRESTORE_QUOTA_EXCEEDED');
    assert.ok(bankErr.message.startsWith('Database read error: unable to retrieve bank account approval requests'));

    let verifErr: any = null;
    try {
      await getBankVerificationRequestsAdmin({ firestore, isAdminConfigured: () => true });
    } catch (e) {
      verifErr = e;
    }
    assert.ok(verifErr, 'Failed read must never be cached; verification read must also fail accurately');
    assert.strictEqual(verifErr.errorCode, 'FIRESTORE_QUOTA_EXCEEDED');
    assert.ok(verifErr.message.startsWith('Database read error: unable to retrieve bank verification requests'));

    let cardErr: any = null;
    try {
      await getAllCardActivationRequestsAdmin({ firestore, isAdminConfigured: () => true });
    } catch (e) {
      cardErr = e;
    }
    assert.ok(cardErr, 'Must throw on permission error');
    assert.strictEqual(readCounts['card_activation_requests'], 1, 'PERMISSION_DENIED must not retry');
    assert.strictEqual(cardErr.errorCode, 'FIRESTORE_PERMISSION_DENIED');
    assert.ok(cardErr.message.startsWith('Database read error: unable to retrieve card activation requests'));

    console.log('✓ Test 3 passed: Non-retryable Firestore errors fail fast with accurate 503 classified errors and never return [].');
  }

  // Test 4: Transient UNAVAILABLE error retries once and recovers
  {
    let attempts = 0;
    const { firestore, readCounts } = makeMockFirestore({
      card_activation_requests: () => {
        attempts++;
        if (attempts === 1) {
          throw Object.assign(new Error('14 UNAVAILABLE: temporary network reset'), { code: 14 });
        }
        return [
          {
            id: 'card_1',
            data: () => ({
              userId: 'u1',
              status: 'PENDING',
              submittedAt: '2026-11-27T09:00:00.000Z',
            }),
          },
        ];
      },
    });

    const list = await getAllCardActivationRequestsAdmin({ firestore, isAdminConfigured: () => true });
    assert.strictEqual(readCounts['card_activation_requests'], 2);
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].id, 'card_1');

    console.log('✓ Test 4 passed: Transient UNAVAILABLE error recovers cleanly on bounded single retry.');
  }

  // Test 5: /api/admin/overview & /api/admin/customers never return fabricated zeros or [] when Firestore fails
  {
    const req = { auth: { uid: 'admin_1', email: 'admin@monvera.org' } } as unknown as AuthenticatedRequest;

    // 5a: Overview fails when accounts collection fails (even if users succeeded)
    {
      const { firestore } = makeMockFirestore({
        users: () => [{ id: 'u1', data: () => ({ email: 'real@example.com', role: 'customer' }) }],
        accounts: () => {
          throw Object.assign(new Error('8 RESOURCE_EXHAUSTED: Quota exceeded.'), { code: 8 });
        },
        transactions: () => [],
        investments: () => [],
      });
      const mockRes = makeMockResponse();
      await handleGetAdminOverview(req, mockRes.res, {
        firestore,
        isFirebaseAdminConfiguredFn: () => true,
      });
      assert.strictEqual(mockRes.getStatus(), 503);
      assert.strictEqual(mockRes.getBody().success, false);
      assert.strictEqual(mockRes.getBody().errorCode, 'FIRESTORE_QUOTA_EXCEEDED');
      assert.strictEqual(mockRes.getBody().totalCustomers, undefined);
    }

    // 5b: Customers fails when accounts collection fails (must NEVER emit checkingBalance: 0)
    {
      const { firestore } = makeMockFirestore({
        users: () => [{ id: 'u1', data: () => ({ email: 'real@example.com', role: 'customer' }) }],
        accounts: () => {
          throw Object.assign(new Error('8 RESOURCE_EXHAUSTED: Quota exceeded.'), { code: 8 });
        },
      });
      const mockRes = makeMockResponse();
      await handleGetAdminCustomers(req, mockRes.res, {
        firestore,
        isFirebaseAdminConfiguredFn: () => true,
      });
      assert.strictEqual(mockRes.getStatus(), 503);
      assert.strictEqual(mockRes.getBody().success, false);
      assert.strictEqual(mockRes.getBody().errorCode, 'FIRESTORE_QUOTA_EXCEEDED');
      assert.strictEqual(mockRes.getBody().customers, undefined);
    }

    // 5c: Unconfigured DB returns 503 (never fabricated db.getAdminOverview or [])
    {
      const mockRes1 = makeMockResponse();
      await handleGetAdminOverview(req, mockRes1.res, {
        isFirebaseAdminConfiguredFn: () => false,
      });
      assert.strictEqual(mockRes1.getStatus(), 503);
      assert.strictEqual(mockRes1.getBody().success, false);
      assert.strictEqual(mockRes1.getBody().errorCode, 'DATABASE_UNCONFIGURED');

      const mockRes2 = makeMockResponse();
      await handleGetAdminCustomers(req, mockRes2.res, {
        isFirebaseAdminConfiguredFn: () => false,
      });
      assert.strictEqual(mockRes2.getStatus(), 503);
      assert.strictEqual(mockRes2.getBody().success, false);
      assert.strictEqual(mockRes2.getBody().errorCode, 'DATABASE_UNCONFIGURED');
    }

    // 5d: Healthy Firestore returns genuine metrics and customer balances
    {
      const { firestore } = makeMockFirestore({
        users: () => [
          { id: 'u1', data: () => ({ email: 'alice@example.com', role: 'customer', permanentAccountNumber: '1000001234' }) },
        ],
        accounts: () => [
          {
            id: 'u1',
            data: () => ({
              checkingBalance: 250.5,
              savingsBalance: 100,
              investedBalance: 0,
              accruedEarnings: 0,
              totalBalance: 350.5,
            }),
          },
        ],
        transactions: () => [
          { id: 'tx1', data: () => ({ amount: 50, type: 'WITHDRAWAL', status: 'COMPLETED' }) },
        ],
        investments: () => [],
      });

      const ovRes = makeMockResponse();
      await handleGetAdminOverview(req, ovRes.res, {
        firestore,
        isFirebaseAdminConfiguredFn: () => true,
      });
      assert.strictEqual(ovRes.getStatus(), 200);
      assert.strictEqual(ovRes.getBody().success, true);
      assert.strictEqual(ovRes.getBody().totalCustomers, 1);
      assert.strictEqual(ovRes.getBody().totalPlatformDeposits, 350.5);
      assert.strictEqual(ovRes.getBody().totalPlatformWithdrawals, 50);

      const custRes = makeMockResponse();
      await handleGetAdminCustomers(req, custRes.res, {
        firestore,
        isFirebaseAdminConfiguredFn: () => true,
      });
      assert.strictEqual(custRes.getStatus(), 200);
      assert.strictEqual(custRes.getBody().success, true);
      assert.strictEqual(custRes.getBody().customers.length, 1);
      assert.strictEqual(custRes.getBody().customers[0].balanceMetrics.checkingBalance, 250.5);
    }

    console.log('✓ Test 5 passed: Admin overview and customer handlers report 503 on DB failures and never fabricate zeros or [].');
  }

  console.log('\nALL STAGE 2A VERIFICATION TESTS PASSED!');
}

runTests().catch((err) => {
  console.error('Stage 2A test suite failed:', err);
  process.exit(1);
});
