/**
 * MONVERA — STAGE 3D-C2.3: DEPOSIT SECURITY REMEDIATION & STRIPE SETTLEMENT HARDENING TESTS
 *
 * Offline security regression test suite covering all 22 mandatory security requirements:
 *  1. Unauthenticated POST /api/deposits/create returns 401 and creates zero balance credits.
 *  2. Authenticated customer POST /api/deposits/create with fake payment ref returns 403 and creates zero balance credits.
 *  3. Authenticated customer POST /api/deposits/create with mismatched userId returns 403 and creates zero balance credits.
 *  4. Authenticated admin POST /api/deposits/create fails closed without creating balance credits.
 *  5. POST /api/deposits/create when Stripe is unconfigured fails closed (503) and does not settle a demo deposit.
 *  6. DepositModal fallback no longer calls /api/deposits/create or shows success when Stripe configured: false.
 *  7. Unauthenticated POST /api/stripe/create-checkout-session returns 401.
 *  8. Authenticated customer creating a checkout session for another userId returns 403.
 *  9. Checkout session creation rejects invalid amounts (0, negative, NaN, non-numeric, Infinity) and non-USD currencies (400).
 * 10. Checkout session creation blocks frozen accounts (403).
 * 11. Unauthenticated GET / POST /api/stripe/confirm-session returns 401.
 * 12. Authenticated customer confirming another customer's paid Stripe session returns 403 (fixes tautological check).
 * 13. Confirming an unpaid Stripe checkout session returns 400 and creates zero balance credits.
 * 14. Confirming a non-USD or mismatched-amount Stripe session returns 400 and creates zero balance credits.
 * 15. Stripe webhook rejects missing stripe-signature header, invalid signature, and missing webhook secret (400/503, zero credits).
 * 16. Stripe webhook ignores/rejects checkout.session.completed with payment_status: "unpaid" or missing payment_status (zero credits).
 * 17. Stripe webhook rejects non-USD currency or metadata.amount !== amount_total (400, zero credits).
 * 18. Valid paid Stripe webhook uses authoritative amount_total / 100, credits once, writes transaction + deposit_idempotency + notification_outbox.
 * 19. Repeated Stripe webhook and/or racing confirm-session + webhook calls for same session_id do not double-credit or double Welcome Reward.
 * 20. Production environment rejects POST /api/webhooks/test-simulate (403) and route enforces requireAdminAuth (401/403).
 * 21. executeServerDeposit() rejects non-finite, zero, negative, and invalid-precision amounts; rejects untrusted FROZEN bypass without allowFrozenSettlement; allows explicit internal allowFrozenSettlement=true.
 * 22. Verified deposit outbox + Welcome Reward evaluation remains intact and excludes unverified/demo markers.
 */

import assert from 'assert';
import crypto from 'crypto';
import http from 'http';
import Stripe from 'stripe';
import type { Firestore } from 'firebase-admin/firestore';

process.env.VERCEL = '1';

import {
  app,
  handleDirectDepositCreate,
  handleCreateStripeCheckoutSession,
  handleStripeWebhook,
  handleStripeSessionConfirmation,
  handleWebhookTestSimulate,
} from './server';
import { executeServerDeposit } from './server/firestoreTransactions';
import { evaluateAndProcessWelcomeReward } from './server/welcomeRewardService';
import { NOTIFICATION_OUTBOX_COLLECTION } from './server/services/notificationOutbox';
import { db } from './server/db';
import fs from 'fs';

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
    // Serialize optimistic retry attempts faithfully like Firestore transactions
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
          if (refOrQuery instanceof InMemoryQuery) {
            return await refOrQuery.get();
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

async function runTests() {
  console.log('\n=== STAGE 3D-C2.3: CRITICAL DEPOSIT SECURITY REMEDIATION TESTS ===\n');

  const stripeTestClient = new Stripe('sk_test_stage3d_c23_dummy_key', {
    apiVersion: '2025-02-24.acacia' as any,
  });
  const webhookSecret = 'whsec_test_stage3d_c23_secret_987654';

  const origFirebaseProject = process.env.FIREBASE_PROJECT_ID;
  const origClientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const origPrivateKey = process.env.FIREBASE_PRIVATE_KEY;
  const origStripeKey = process.env.STRIPE_SECRET_KEY;

  // Test 1, 7, 11, 20 HTTP Route Guard Checks via real Express loopback
  {
    // Temporarily simulate unconfigured or configured Firebase Admin guard via HTTP routes
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as any;
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      // Test 1 (HTTP): Unauthenticated POST /api/deposits/create returns 401 (or 503 fail-closed when Admin not initialized) and zero credits
      const r1 = await fetch(`${baseUrl}/api/deposits/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'victim_uid', amount: 50000, providerPaymentId: 'FAKE-REF' }),
      });
      assert.ok(r1.status === 401 || r1.status === 503, `POST /api/deposits/create unauthenticated status=${r1.status}`);
      assert.strictEqual(db.transactions.length, 0, 'Unauthenticated deposit must create zero in-memory credits');

      // Test 7 (HTTP): Unauthenticated POST /api/stripe/create-checkout-session fails closed (401/503)
      const r7 = await fetch(`${baseUrl}/api/stripe/create-checkout-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'victim_uid', amount: 500 }),
      });
      assert.ok(r7.status === 401 || r7.status === 503, `POST /api/stripe/create-checkout-session unauthenticated status=${r7.status}`);

      // Test 11 (HTTP): Unauthenticated GET & POST /api/stripe/confirm-session fail closed (401/503)
      const r11Get = await fetch(`${baseUrl}/api/stripe/confirm-session?session_id=cs_fake`);
      const r11Post = await fetch(`${baseUrl}/api/stripe/confirm-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: 'cs_fake' }),
      });
      assert.ok(r11Get.status === 401 || r11Get.status === 503);
      assert.ok(r11Post.status === 401 || r11Post.status === 503);

      // Test 20 (HTTP): Unauthenticated POST /api/webhooks/test-simulate fails closed (401/503)
      const r20 = await fetch(`${baseUrl}/api/webhooks/test-simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'victim_uid', amount: 99999 }),
      });
      assert.ok(r20.status === 401 || r20.status === 503);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  // Test 1–5: handleDirectDepositCreate fail-closed enforcement
  {
    const initialMemLen = db.transactions.length;

    // Test 1 (Handler): Missing req.auth -> 401
    const res1 = createMockRes();
    await handleDirectDepositCreate({ body: { userId: 'usr_a', amount: 5000 } } as any, res1, {
      isStripeConfiguredFn: () => true,
    });
    assert.strictEqual(res1.statusCode, 401);
    assert.strictEqual(res1.body?.success, false);

    // Test 2 (Handler): Authenticated customer with fake payment ref -> 403
    const res2 = createMockRes();
    await handleDirectDepositCreate(
      {
        auth: { uid: 'usr_attacker', email: 'attacker@test.local' },
        body: { userId: 'usr_attacker', amount: 50000, providerPaymentId: 'CARD-FAKE-999' },
      } as any,
      res2,
      { isStripeConfiguredFn: () => true }
    );
    assert.strictEqual(res2.statusCode, 403);
    assert.strictEqual(res2.body?.errorCode, 'PAYMENT_VERIFICATION_REQUIRED');

    // Test 3 (Handler): Authenticated customer attempting another UID -> 403 mismatch
    const res3 = createMockRes();
    await handleDirectDepositCreate(
      {
        auth: { uid: 'usr_attacker', email: 'attacker@test.local' },
        body: { userId: 'usr_victim', amount: 25000 },
      } as any,
      res3,
      { isStripeConfiguredFn: () => true }
    );
    assert.strictEqual(res3.statusCode, 403);
    assert.strictEqual(res3.body?.errorCode, 'FORBIDDEN_USER_MISMATCH');

    // Test 4 (Handler): Admin claim on POST /api/deposits/create ALSO fails closed
    const res4 = createMockRes();
    await handleDirectDepositCreate(
      {
        auth: { uid: 'usr_admin', email: 'admin@monvera.com', admin: true },
        body: { userId: 'usr_victim', amount: 10000 },
      } as any,
      res4,
      { isStripeConfiguredFn: () => true }
    );
    assert.strictEqual(res4.statusCode, 403);
    assert.strictEqual(res4.body?.success, false);

    // Test 5 (Handler): Stripe unconfigured -> 503 fail closed (no demo fallback credit)
    const res5 = createMockRes();
    await handleDirectDepositCreate(
      {
        auth: { uid: 'usr_cust_1', email: 'cust@test.local' },
        body: { userId: 'usr_cust_1', amount: 500 },
      } as any,
      res5,
      { isStripeConfiguredFn: () => false }
    );
    assert.strictEqual(res5.statusCode, 503);
    assert.strictEqual(res5.body?.configured, false);
    assert.strictEqual(res5.body?.errorCode, 'DEPOSIT_GATEWAY_UNAVAILABLE');
    assert.strictEqual(db.transactions.length, initialMemLen);
    console.log('✓ Tests 1–5 passed: POST /api/deposits/create fails closed across all caller/config combinations');
  }

  // Test 6: Static & behavioral verification of DepositModal + api.ts
  {
    const modalSrc = fs.readFileSync('./src/components/dashboard/DepositModal.tsx', 'utf8');
    assert.ok(!modalSrc.includes('api.createDeposit'), 'DepositModal must not call api.createDeposit fallback');
    assert.ok(!modalSrc.includes('CARD-STRIPE-DEMO-'), 'DepositModal must not mint CARD-STRIPE-DEMO prefixes');
    assert.ok(modalSrc.includes('stripeRes.configured === false'), 'DepositModal must explicitly handle unconfigured gateway');

    const apiSrc = fs.readFileSync('./src/services/api.ts', 'utf8');
    const stripeMethodSlice = apiSrc.slice(
      apiSrc.indexOf('async createStripeCheckoutSession'),
      apiSrc.indexOf('async confirmStripeSession')
    );
    assert.ok(
      stripeMethodSlice.includes('getCustomerAuthHeaders'),
      'api.createStripeCheckoutSession must attach authenticated customer Bearer headers'
    );
    console.log('✓ Test 6 passed: DepositModal fallback removed and createStripeCheckoutSession attaches auth headers');
  }

  // Tests 7–10: Stripe Checkout Session Creation Security
  {
    let stripeCreateCalled = 0;
    const mockStripe: any = {
      checkout: {
        sessions: {
          create: async (opts: any) => {
            stripeCreateCalled++;
            return { id: 'cs_test_ok', url: 'https://checkout.stripe.com/c/pay/cs_test_ok', ...opts };
          },
        },
      },
    };

    // Test 7 (Handler): Unauthenticated -> 401
    const r7 = createMockRes();
    await handleCreateStripeCheckoutSession({ body: { amount: 100 } } as any, r7, {
      getStripeFn: () => mockStripe,
      isAdminFn: async () => false,
      getUserDocFn: async () => ({ status: 'active' }),
    });
    assert.strictEqual(r7.statusCode, 401);

    // Test 8: Authenticated non-admin attempting another userId -> 403
    const r8 = createMockRes();
    await handleCreateStripeCheckoutSession(
      { auth: { uid: 'usr_a' }, body: { userId: 'usr_b', amount: 100 } } as any,
      r8,
      {
        getStripeFn: () => mockStripe,
        isAdminFn: async () => false,
        getUserDocFn: async () => ({ status: 'active' }),
      }
    );
    assert.strictEqual(r8.statusCode, 403);
    assert.strictEqual(r8.body?.errorCode, 'FORBIDDEN_USER_MISMATCH');

    // Test 9: Rejects 0, negative, NaN, non-numeric, Infinity, 3-decimal, non-USD currency
    for (const badAmount of [0, -100, NaN, Infinity, -Infinity, 'abc', '', null, true, 10.123]) {
      const rBad = createMockRes();
      await handleCreateStripeCheckoutSession(
        { auth: { uid: 'usr_a' }, body: { userId: 'usr_a', amount: badAmount } } as any,
        rBad,
        {
          getStripeFn: () => mockStripe,
          isAdminFn: async () => false,
          getUserDocFn: async () => ({ status: 'active' }),
        }
      );
      assert.strictEqual(rBad.statusCode, 400, `Expected 400 for bad amount ${String(badAmount)}`);
    }

    const rBadCurr = createMockRes();
    await handleCreateStripeCheckoutSession(
      { auth: { uid: 'usr_a' }, body: { userId: 'usr_a', amount: 100, currency: 'eur' } } as any,
      rBadCurr,
      {
        getStripeFn: () => mockStripe,
        isAdminFn: async () => false,
        getUserDocFn: async () => ({ status: 'active' }),
      }
    );
    assert.strictEqual(rBadCurr.statusCode, 400);
    assert.strictEqual(rBadCurr.body?.errorCode, 'UNSUPPORTED_CURRENCY');

    // Test 10: Frozen user blocked BEFORE creating Stripe Checkout session
    const rFrozen = createMockRes();
    await handleCreateStripeCheckoutSession(
      { auth: { uid: 'usr_frozen' }, body: { userId: 'usr_frozen', amount: 500 } } as any,
      rFrozen,
      {
        getStripeFn: () => mockStripe,
        isAdminFn: async () => false,
        getUserDocFn: async () => ({ status: 'frozen', email: 'frozen@test.local' }),
      }
    );
    assert.strictEqual(rFrozen.statusCode, 403);
    assert.strictEqual(rFrozen.body?.errorCode, 'ACCOUNT_FROZEN');
    assert.strictEqual(stripeCreateCalled, 0, 'Must never invoke Stripe session creation for rejected/frozen requests');

    // Valid active customer request creates Stripe session cleanly
    const rValid = createMockRes();
    await handleCreateStripeCheckoutSession(
      {
        auth: { uid: 'usr_valid' },
        body: { userId: 'usr_valid', amount: 250.5, destinationAccountType: 'SAVINGS' },
      } as any,
      rValid,
      {
        getStripeFn: () => mockStripe,
        isAdminFn: async () => false,
        getUserDocFn: async () => ({ status: 'active', email: 'valid@test.local', permanentAccountNumber: '1011223344' }),
      }
    );
    assert.strictEqual(rValid.statusCode, 200);
    assert.strictEqual(rValid.body?.success, true);
    assert.strictEqual(stripeCreateCalled, 1);
    console.log('✓ Tests 7–10 passed: create-checkout-session enforces auth, UID matching, amount/currency validation, and frozen blocks');
  }

  // Tests 11–14: Confirm Session Authorization & Settlement Verification
  {
    let confirmDepositCalls = 0;
    const makeConfirmStripe = (sessionObj: any) =>
      ({
        checkout: {
          sessions: {
            retrieve: async () => sessionObj,
          },
        },
      } as any);

    // Test 11 (Handler): Missing auth -> 401
    const r11 = createMockRes();
    await handleStripeSessionConfirmation({ query: { session_id: 'cs_any' } } as any, r11, {
      getStripeFn: () => makeConfirmStripe({}),
      executeDepositFn: async () => {
        confirmDepositCalls++;
        return { success: true };
      },
    });
    assert.strictEqual(r11.statusCode, 401);

    // Test 12: Authenticated customer attempting to confirm another customer's paid session -> 403 (fixes tautological check)
    const r12 = createMockRes();
    await handleStripeSessionConfirmation(
      {
        auth: { uid: 'usr_attacker', email: 'attacker@test.local' },
        query: { session_id: 'cs_victim_paid' },
      } as any,
      r12,
      {
        isAdminFn: async () => false,
        getStripeFn: () =>
          makeConfirmStripe({
            id: 'cs_victim_paid',
            mode: 'payment',
            payment_status: 'paid',
            currency: 'usd',
            amount_total: 50000,
            client_reference_id: 'usr_victim',
            metadata: { userId: 'usr_victim', amount: '500', destinationAccountType: 'CHECKING' },
          }),
        executeDepositFn: async () => {
          confirmDepositCalls++;
          return { success: true };
        },
      }
    );
    assert.strictEqual(r12.statusCode, 403);
    assert.strictEqual(r12.body?.errorCode, 'FORBIDDEN_SESSION_OWNER');

    // Test 13: Unpaid session returns 400 and zero credits
    const r13 = createMockRes();
    await handleStripeSessionConfirmation(
      { auth: { uid: 'usr_cust' }, query: { session_id: 'cs_unpaid' } } as any,
      r13,
      {
        isAdminFn: async () => false,
        getStripeFn: () =>
          makeConfirmStripe({
            id: 'cs_unpaid',
            mode: 'payment',
            payment_status: 'unpaid',
            currency: 'usd',
            amount_total: 50000,
            client_reference_id: 'usr_cust',
            metadata: { userId: 'usr_cust', amount: '500' },
          }),
        executeDepositFn: async () => {
          confirmDepositCalls++;
          return { success: true };
        },
      }
    );
    assert.strictEqual(r13.statusCode, 400);
    assert.strictEqual(r13.body?.errorCode, 'PAYMENT_NOT_PAID');

    // Test 14A: Non-USD session rejected (400, zero credits)
    const r14Eur = createMockRes();
    await handleStripeSessionConfirmation(
      { auth: { uid: 'usr_cust' }, query: { session_id: 'cs_eur' } } as any,
      r14Eur,
      {
        isAdminFn: async () => false,
        getStripeFn: () =>
          makeConfirmStripe({
            id: 'cs_eur',
            mode: 'payment',
            payment_status: 'paid',
            currency: 'eur',
            amount_total: 50000,
            client_reference_id: 'usr_cust',
            metadata: { userId: 'usr_cust', amount: '500' },
          }),
        executeDepositFn: async () => {
          confirmDepositCalls++;
          return { success: true };
        },
      }
    );
    assert.strictEqual(r14Eur.statusCode, 400);
    assert.strictEqual(r14Eur.body?.errorCode, 'UNSUPPORTED_CURRENCY');

    // Test 14B: Mismatched metadata.amount vs amount_total rejected (400, zero credits)
    const r14Mismatch = createMockRes();
    await handleStripeSessionConfirmation(
      { auth: { uid: 'usr_cust' }, query: { session_id: 'cs_mismatch' } } as any,
      r14Mismatch,
      {
        isAdminFn: async () => false,
        getStripeFn: () =>
          makeConfirmStripe({
            id: 'cs_mismatch',
            mode: 'payment',
            payment_status: 'paid',
            currency: 'usd',
            amount_total: 1000, // $10
            client_reference_id: 'usr_cust',
            metadata: { userId: 'usr_cust', amount: '10000' }, // Tampered $10,000
          }),
        executeDepositFn: async () => {
          confirmDepositCalls++;
          return { success: true };
        },
      }
    );
    assert.strictEqual(r14Mismatch.statusCode, 400);
    assert.strictEqual(r14Mismatch.body?.errorCode, 'METADATA_AMOUNT_MISMATCH');
    assert.strictEqual(confirmDepositCalls, 0, 'Invalid/unauthorized confirm-session requests must never invoke executeDepositFn');
    console.log('✓ Tests 11–14 passed: confirm-session enforces auth, strict ownership, paid status, USD, and amount_total consistency');
  }

  // Tests 15–17: Webhook Security & Tamper Resistance
  {
    let whDepositCalls = 0;

    // Test 15: Missing signature / invalid signature / missing secret
    const badSecretRes = createMockRes();
    await handleStripeWebhook(
      { headers: { 'stripe-signature': 't=1,v1=bad' }, rawBody: Buffer.from('{}') } as any,
      badSecretRes,
      { getStripeFn: () => stripeTestClient, webhookSecret: '', executeDepositFn: async () => ({ success: true }) }
    );
    assert.strictEqual(badSecretRes.statusCode, 503);

    const missingSigRes = createMockRes();
    await handleStripeWebhook(
      { headers: {}, rawBody: Buffer.from('{}') } as any,
      missingSigRes,
      { getStripeFn: () => stripeTestClient, webhookSecret, executeDepositFn: async () => ({ success: true }) }
    );
    assert.strictEqual(missingSigRes.statusCode, 400);

    const badSigPayload = JSON.stringify({ id: 'evt_bad', type: 'checkout.session.completed', data: { object: {} } });
    const badSigRes = createMockRes();
    await handleStripeWebhook(
      {
        headers: {
          'stripe-signature': stripeTestClient.webhooks.generateTestHeaderString({
            payload: badSigPayload,
            secret: 'whsec_wrong_secret',
          }),
        },
        rawBody: Buffer.from(badSigPayload),
      } as any,
      badSigRes,
      { getStripeFn: () => stripeTestClient, webhookSecret, executeDepositFn: async () => ({ success: true }) }
    );
    assert.strictEqual(badSigRes.statusCode, 400);

    // Test 16A: Signed webhook with payment_status: "unpaid" -> ignored, zero credits
    const unpaidPayload = JSON.stringify({
      id: 'evt_unpaid',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_wh_unpaid',
          mode: 'payment',
          payment_status: 'unpaid',
          currency: 'usd',
          amount_total: 50000,
          client_reference_id: 'usr_e2e',
          metadata: { userId: 'usr_e2e', amount: '500' },
        },
      },
    });
    const unpaidRes = createMockRes();
    await handleStripeWebhook(
      {
        headers: {
          'stripe-signature': stripeTestClient.webhooks.generateTestHeaderString({
            payload: unpaidPayload,
            secret: webhookSecret,
          }),
        },
        rawBody: Buffer.from(unpaidPayload),
      } as any,
      unpaidRes,
      {
        getStripeFn: () => stripeTestClient,
        webhookSecret,
        executeDepositFn: async () => {
          whDepositCalls++;
          return { success: true };
        },
      }
    );
    assert.strictEqual(unpaidRes.statusCode, 200);
    assert.strictEqual(unpaidRes.body?.credited, false);

    // Test 16B: Signed webhook with missing payment_status -> rejected 400, zero credits
    const noStatusPayload = JSON.stringify({
      id: 'evt_no_status',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_wh_nostatus',
          mode: 'payment',
          currency: 'usd',
          amount_total: 50000,
          client_reference_id: 'usr_e2e',
        },
      },
    });
    const noStatusRes = createMockRes();
    await handleStripeWebhook(
      {
        headers: {
          'stripe-signature': stripeTestClient.webhooks.generateTestHeaderString({
            payload: noStatusPayload,
            secret: webhookSecret,
          }),
        },
        rawBody: Buffer.from(noStatusPayload),
      } as any,
      noStatusRes,
      {
        getStripeFn: () => stripeTestClient,
        webhookSecret,
        executeDepositFn: async () => {
          whDepositCalls++;
          return { success: true };
        },
      }
    );
    assert.strictEqual(noStatusRes.statusCode, 400);
    assert.strictEqual(noStatusRes.body?.errorCode, 'MISSING_PAYMENT_STATUS');

    // Test 17A: Non-USD currency rejected (400, zero credits)
    const eurPayload = JSON.stringify({
      id: 'evt_eur',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_wh_eur',
          mode: 'payment',
          payment_status: 'paid',
          currency: 'eur',
          amount_total: 50000,
          client_reference_id: 'usr_e2e',
        },
      },
    });
    const eurRes = createMockRes();
    await handleStripeWebhook(
      {
        headers: {
          'stripe-signature': stripeTestClient.webhooks.generateTestHeaderString({
            payload: eurPayload,
            secret: webhookSecret,
          }),
        },
        rawBody: Buffer.from(eurPayload),
      } as any,
      eurRes,
      {
        getStripeFn: () => stripeTestClient,
        webhookSecret,
        executeDepositFn: async () => {
          whDepositCalls++;
          return { success: true };
        },
      }
    );
    assert.strictEqual(eurRes.statusCode, 400);
    assert.strictEqual(eurRes.body?.errorCode, 'UNSUPPORTED_CURRENCY');

    // Test 17B: metadata.amount !== amount_total rejected (400, zero credits)
    const mismatchPayload = JSON.stringify({
      id: 'evt_mismatch',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_wh_mismatch',
          mode: 'payment',
          payment_status: 'paid',
          currency: 'usd',
          amount_total: 2500, // $25
          client_reference_id: 'usr_e2e',
          metadata: { userId: 'usr_e2e', amount: '25000' },
        },
      },
    });
    const mismatchRes = createMockRes();
    await handleStripeWebhook(
      {
        headers: {
          'stripe-signature': stripeTestClient.webhooks.generateTestHeaderString({
            payload: mismatchPayload,
            secret: webhookSecret,
          }),
        },
        rawBody: Buffer.from(mismatchPayload),
      } as any,
      mismatchRes,
      {
        getStripeFn: () => stripeTestClient,
        webhookSecret,
        executeDepositFn: async () => {
          whDepositCalls++;
          return { success: true };
        },
      }
    );
    assert.strictEqual(mismatchRes.statusCode, 400);
    assert.strictEqual(mismatchRes.body?.errorCode, 'METADATA_AMOUNT_MISMATCH');
    assert.strictEqual(whDepositCalls, 0);
    console.log('✓ Tests 15–17 passed: Webhook rejects invalid/missing sig, unpaid/missing payment_status, non-USD, and amount mismatch');
  }

  // Tests 18, 19, 22: End-to-End Authoritative Deposit + Concurrent Webhook/Confirm-Session Race + Outbox + Welcome Reward
  {
    const fsMem = new StrictInMemoryFirestore();
    const uid = 'uid_c23_race_test';
    const sessionId = 'cs_live_race_001';
    const initialMemTxLen = db.transactions.length;

    await fsMem.collection('users').doc(uid).set({
      id: uid,
      firstName: 'Marcus',
      lastName: 'Sterling',
      permanentAccountNumber: '1088776655',
      email: 'marcus.sterling@monvera.test',
      phone: '+15551112233',
      status: 'active',
    });
    await fsMem.collection('accounts').doc(uid).set({
      userId: uid,
      checkingBalance: 1000,
      savingsBalance: 0,
      investedBalance: 0,
      accruedEarnings: 0,
      totalBalance: 1000,
      availableBalance: 1000,
      pendingBalance: 0,
      loanBalance: 0,
    });

    // Inject an unverified/demo transaction fixture that MUST NOT count toward Welcome Reward!
    await fsMem.collection('transactions').doc('tx_demo_excluded').set({
      id: 'tx_demo_excluded',
      userId: uid,
      type: 'DEPOSIT',
      status: 'COMPLETED',
      amount: 9500,
      currency: 'USD',
      referenceNumber: 'CARD-STRIPE-DEMO-123456',
      paymentProviderRef: 'CARD-STRIPE-DEMO-123456',
      metadata: { isDemo: true },
    });

    const sessionPayloadObj = {
      id: sessionId,
      mode: 'payment',
      payment_status: 'paid',
      currency: 'usd',
      amount_total: 1050000, // $10,500.00 -> qualifies for Welcome Reward once (NOT twice!)
      client_reference_id: uid,
      metadata: {
        userId: uid,
        amount: '10500',
        destinationAccountType: 'CHECKING',
      },
    };
    const webhookBodyStr = JSON.stringify({
      id: 'evt_race_001',
      type: 'checkout.session.completed',
      data: { object: sessionPayloadObj },
    });
    const sig = stripeTestClient.webhooks.generateTestHeaderString({
      payload: webhookBodyStr,
      secret: webhookSecret,
    });

    const mockConfirmStripe: any = {
      checkout: {
        sessions: {
          retrieve: async () => sessionPayloadObj,
        },
      },
    };

    const runDepositWithFs = (params: any) =>
      executeServerDeposit(params, { firestore: fsMem as unknown as Firestore });

    // Race webhook + webhook retry + confirm-session concurrently!
    const resWh1 = createMockRes();
    const resWh2 = createMockRes();
    const resConfirm = createMockRes();

    await Promise.all([
      handleStripeWebhook(
        { headers: { 'stripe-signature': sig }, rawBody: Buffer.from(webhookBodyStr) } as any,
        resWh1,
        { getStripeFn: () => stripeTestClient, webhookSecret, executeDepositFn: runDepositWithFs }
      ),
      handleStripeWebhook(
        { headers: { 'stripe-signature': sig }, rawBody: Buffer.from(webhookBodyStr) } as any,
        resWh2,
        { getStripeFn: () => stripeTestClient, webhookSecret, executeDepositFn: runDepositWithFs }
      ),
      handleStripeSessionConfirmation(
        { auth: { uid }, query: { session_id: sessionId } } as any,
        resConfirm,
        {
          isAdminFn: async () => false,
          getStripeFn: () => mockConfirmStripe,
          executeDepositFn: runDepositWithFs,
        }
      ),
    ]);

    assert.strictEqual(resWh1.statusCode, 200);
    assert.strictEqual(resWh2.statusCode, 200);
    assert.strictEqual(resConfirm.statusCode, 200);
    assert.strictEqual(resConfirm.body?.success, true);

    const accAfter = (await fsMem.collection('accounts').doc(uid).get()).data()!;
    assert.strictEqual(accAfter.checkingBalance, 11500, 'Account must be credited EXACTLY ONCE ($1,000 + $10,500)');

    const expectedIdempKey = crypto.createHash('sha256').update(`STRIPE-${sessionId}`).digest('hex');
    const idempSnap = await fsMem.collection('deposit_idempotency').doc(expectedIdempKey).get();
    assert.strictEqual(idempSnap.exists, true, 'Deterministic deposit_idempotency lock doc must exist');

    const txCol = fsMem.store.get('transactions')!;
    const completedDeposits = Array.from(txCol.values()).filter(
      (e) => e.data.paymentProviderRef === `STRIPE-${sessionId}`
    );
    assert.strictEqual(completedDeposits.length, 1, 'Exactly one DEPOSIT transaction record created for Stripe session');

    const outboxSnap = await fsMem.collection(NOTIFICATION_OUTBOX_COLLECTION).get();
    assert.strictEqual(outboxSnap.size, 1, 'Exactly one notification_outbox MONEY_RECEIVED record for settled deposit');
    assert.strictEqual(outboxSnap.docs[0].data().dispatchType, 'MONEY_RECEIVED');

    // Test 22: Welcome Reward ignores CARD-STRIPE-DEMO-123456 and evaluates ONLY the $10,500 verified Stripe deposit
    const rwdDeps = {
      firestore: fsMem as unknown as Firestore,
      isAdminConfigured: () => true,
      persistNotification: async (n: any) => ({ ...n, read: false }),
    };
    const rwd1 = await evaluateAndProcessWelcomeReward(uid, rwdDeps);
    assert.strictEqual(rwd1.status, 'PAID');
    assert.strictEqual(rwd1.qualifyingDeposits, 10500, 'Unverified/demo deposit must NOT count toward Welcome Reward sum');

    // Verify demo-only user with $15,000 of CARD-STRIPE-DEMO cannot claim Welcome Reward
    const demoOnlyUid = 'uid_demo_only_rwd';
    await fsMem.collection('users').doc(demoOnlyUid).set({ id: demoOnlyUid, status: 'active' });
    await fsMem.collection('accounts').doc(demoOnlyUid).set({
      userId: demoOnlyUid,
      checkingBalance: 0,
      savingsBalance: 0,
      investedBalance: 0,
      accruedEarnings: 0,
      totalBalance: 0,
      availableBalance: 0,
    });
    await fsMem.collection('transactions').doc('tx_demo_only_1').set({
      id: 'tx_demo_only_1',
      userId: demoOnlyUid,
      type: 'DEPOSIT',
      status: 'COMPLETED',
      amount: 15000,
      currency: 'USD',
      referenceNumber: 'CARD-STRIPE-DEMO-999999',
      paymentProviderRef: 'CARD-STRIPE-DEMO-999999',
    });
    const rwdDemo = await evaluateAndProcessWelcomeReward(demoOnlyUid, rwdDeps);
    assert.strictEqual(rwdDemo.status, 'IN_PROGRESS');
    assert.strictEqual(rwdDemo.qualifyingDeposits, 0);
    assert.strictEqual((await fsMem.collection('accounts').doc(demoOnlyUid).get()).data()?.checkingBalance, 0);

    // Clean up db.transactions mirror from test
    while (db.transactions.length > initialMemTxLen) {
      db.transactions.shift();
    }
    console.log('✓ Tests 18, 19, 22 passed: Concurrent Stripe webhook/confirm-session races stay idempotent, outbox emits once, Welcome Reward excludes demo markers');
  }

  // Test 20: Sandbox test-simulate blocks production & requires admin auth
  {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevVercel = process.env.VERCEL;
    try {
      process.env.NODE_ENV = 'production';
      process.env.VERCEL = '1';
      const rProd = createMockRes();
      handleWebhookTestSimulate({ auth: { uid: 'usr_admin' }, body: { amount: 100 } } as any, rProd);
      assert.strictEqual(rProd.statusCode, 403);
      assert.strictEqual(rProd.body?.errorCode, 'SIMULATOR_DISABLED_IN_PRODUCTION');
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
      if (prevVercel === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = prevVercel;
    }
    console.log('✓ Test 20 passed: POST /api/webhooks/test-simulate fails closed in production and requires admin auth');
  }

  // Test 21: executeServerDeposit amount validation + removal of STRIPE- prefix bypass on frozen accounts
  {
    const fsMem = new StrictInMemoryFirestore();
    const frozenUid = 'uid_frozen_dep_test';
    await fsMem.collection('users').doc(frozenUid).set({ id: frozenUid, status: 'frozen' });
    await fsMem.collection('accounts').doc(frozenUid).set({
      userId: frozenUid,
      checkingBalance: 200,
      savingsBalance: 0,
      investedBalance: 0,
      accruedEarnings: 0,
      totalBalance: 200,
      availableBalance: 200,
    });

    for (const badAmt of [NaN, Infinity, -Infinity, 0, -50, 10.999]) {
      const badRes = await executeServerDeposit(
        { userId: frozenUid, amount: badAmt },
        { firestore: fsMem as unknown as Firestore }
      );
      assert.strictEqual(badRes.success, false, `executeServerDeposit must reject amount ${String(badAmt)}`);
    }

    // Spoofed 'STRIPE-...' prefix WITHOUT explicit allowFrozenSettlement=true MUST be rejected!
    const spoofedFrozenRes = await executeServerDeposit(
      {
        userId: frozenUid,
        amount: 100,
        providerPaymentId: 'STRIPE-spoofed-by-caller',
      },
      { firestore: fsMem as unknown as Firestore }
    );
    assert.strictEqual(spoofedFrozenRes.success, false);
    assert.ok(spoofedFrozenRes.error?.includes('frozen'));

    // Internal verified settlement WITH explicit allowFrozenSettlement=true succeeds cleanly
    const internalFrozenRes = await executeServerDeposit(
      {
        userId: frozenUid,
        amount: 100,
        providerPaymentId: 'STRIPE-cs_verified_internal',
        allowFrozenSettlement: true,
      },
      { firestore: fsMem as unknown as Firestore }
    );
    assert.strictEqual(internalFrozenRes.success, true);
    assert.strictEqual(internalFrozenRes.balanceMetrics?.checkingBalance, 300);
    console.log('✓ Test 21 passed: executeServerDeposit validates strict finite amounts and removes STRIPE- prefix bypass');
  }

  if (origFirebaseProject === undefined) delete process.env.FIREBASE_PROJECT_ID;
  else process.env.FIREBASE_PROJECT_ID = origFirebaseProject;
  if (origClientEmail === undefined) delete process.env.FIREBASE_CLIENT_EMAIL;
  else process.env.FIREBASE_CLIENT_EMAIL = origClientEmail;
  if (origPrivateKey === undefined) delete process.env.FIREBASE_PRIVATE_KEY;
  else process.env.FIREBASE_PRIVATE_KEY = origPrivateKey;
  if (origStripeKey === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = origStripeKey;

  console.log('\nALL STAGE 3D-C2.3 DEPOSIT SECURITY REGRESSION TESTS PASSED!\n');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('\nStage 3D-C2.3 Security Test Failure:', err);
  process.exit(1);
});
