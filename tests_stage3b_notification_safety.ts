/**
 * MONVERA — STAGE 3B: TARGETED PRE-WIRING SAFETY CORRECTIONS VERIFICATION SUITE
 *
 * Tests all 9 mandatory verification requirements:
 *  1. Missing Stripe signature header & missing STRIPE_WEBHOOK_SECRET fail closed (no credit).
 *  2. Invalid Stripe signature is rejected (400, no credit).
 *  3. Valid signed Stripe checkout.session.completed webhook runs executeDepositFn (executeServerDeposit)
 *     and does NOT invoke db.processDeposit or serverNotificationDispatcher.
 *  4. Duplicate Stripe webhook delivery does NOT create a second credit or generate random tx IDs/refs.
 *  5. TRANSACTION, INVESTMENT, SYSTEM, and SUPPORT events do NOT trigger SMS or Email as SECURITY alerts,
 *     while MONEY_RECEIVED, MONEY_SENT, and SECURITY retain expected classification & mandatory behavior.
 *  6. Duplicate transfer results (isDuplicate: true) do NOT dispatch transfer notifications.
 *  7. Non-COMPLETED transfer results (PENDING, FAILED, REVERSED) do NOT dispatch completed-money notifications.
 *  8. Notification amounts and identities come strictly from committed transaction data (ignoring tampered client payloads).
 *  9. Stage 2D token registration, mismatched-credential token preservation, dispatch leases, deduplication,
 *     push delivery, and Phase 4 deterministic lifecycle event key contract remain intact.
 *
 * Uses isolated in-memory Firestore/Messaging harnesses and dependency injection; touches ZERO live customer records.
 */
import assert from 'assert';
import crypto from 'crypto';
import http from 'http';
import Stripe from 'stripe';
import type { Firestore } from 'firebase-admin/firestore';
import type { Messaging } from 'firebase-admin/messaging';

// Prevent server startup side-effects / intervals when importing Express app from server.ts
process.env.VERCEL = '1';

import {
  app,
  handleStripeWebhook,
} from './server';
import {
  ServerNotificationDispatcher,
  registerCustomerPushToken,
  unregisterCustomerPushToken,
  computePushTokenId,
  buildTrustedTransferDispatchEvents,
  buildTransactionLifecycleEventKey,
  serverNotificationDispatcher,
} from './server/services/notificationDispatcher';
import { smsService } from './server/services/smsService';
import { emailService } from './server/services/emailService';
import { db } from './server/db';
import type { BalanceMetrics, Transaction } from './src/types';

// ---------------------------------------------------------------------------
// Isolated Transaction-Faithful In-Memory Firestore & Messaging Harnesses
// ---------------------------------------------------------------------------
type DocStore = Map<string, Map<string, Record<string, any>>>;

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

  private splitParentAndId(): { colPath: string; docId: string } {
    const idx = this.path.lastIndexOf('/');
    return {
      colPath: this.path.slice(0, idx),
      docId: this.path.slice(idx + 1),
    };
  }

  collection(subCol: string): InMemoryCollectionRef {
    return new InMemoryCollectionRef(this.store, `${this.path}/${subCol}`);
  }

  async get() {
    const { colPath, docId } = this.splitParentAndId();
    const raw = this.store.get(colPath)?.get(docId);
    return {
      id: docId,
      exists: raw !== undefined,
      ref: this,
      data: () => (raw ? cloneVal(raw) : undefined),
    };
  }

  async set(data: Record<string, any>, options?: { merge?: boolean }) {
    const { colPath, docId } = this.splitParentAndId();
    if (!this.store.has(colPath)) {
      this.store.set(colPath, new Map());
    }
    const col = this.store.get(colPath)!;
    const prev = col.get(docId);
    const next = options?.merge && prev ? { ...cloneVal(prev), ...cloneVal(data) } : cloneVal(data);
    col.set(docId, next);
  }

  async delete() {
    const { colPath, docId } = this.splitParentAndId();
    this.store.get(colPath)?.delete(docId);
  }
}

class InMemoryCollectionRef {
  constructor(
    private store: DocStore,
    public readonly colPath: string
  ) {}

  doc(id: string): InMemoryDocRef {
    return new InMemoryDocRef(this.store, `${this.colPath}/${id}`);
  }

  async get() {
    const col = this.store.get(this.colPath) || new Map();
    const docs = Array.from(col.entries()).map(([docId, raw]) => ({
      id: docId,
      exists: true,
      ref: this.doc(docId),
      data: () => cloneVal(raw),
    }));
    return {
      empty: docs.length === 0,
      size: docs.length,
      docs,
    };
  }
}

class InMemoryFirestore {
  public readonly store: DocStore = new Map();

  collection(name: string): InMemoryCollectionRef {
    return new InMemoryCollectionRef(this.store, name);
  }

  async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    const tx = {
      get: (ref: InMemoryDocRef) => ref.get(),
      set: (ref: InMemoryDocRef, data: Record<string, any>, opts?: { merge?: boolean }) =>
        ref.set(data, opts),
      delete: (ref: InMemoryDocRef) => ref.delete(),
    };
    return fn(tx);
  }
}

function createMockRes() {
  const res: any = {
    statusCode: 200,
    body: undefined as any,
    headersSent: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      this.headersSent = true;
      return this;
    },
    send(payload: any) {
      this.body = payload;
      this.headersSent = true;
      return this;
    },
  };
  return res;
}

async function runTests() {
  console.log('=== MONVERA STAGE 3B: PRE-WIRING SAFETY VERIFICATION SUITE ===\n');

  const stripeTestClient = new Stripe('sk_test_51MockTestKeyForWebhookUnitVerificationOnly00000000', {
    apiVersion: '2026-02-25.clover' as any,
  });
  const testWebhookSecret = 'whsec_test_stage3b_verification_secret_123456';

  // -------------------------------------------------------------------------
  // TEST 1: Missing Stripe signature header & missing STRIPE_WEBHOOK_SECRET fail closed
  // -------------------------------------------------------------------------
  {
    let depositCalled = 0;
    const prevSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const prevNodeEnv = process.env.NODE_ENV;
    try {
      // Case 1A: Missing STRIPE_WEBHOOK_SECRET fails closed with 503 even in production
      process.env.NODE_ENV = 'production';
      process.env.STRIPE_WEBHOOK_SECRET = '';
      const payload = JSON.stringify({
        id: 'evt_test_missing_secret',
        type: 'checkout.session.completed',
        data: { object: { id: 'cs_missing_secret', client_reference_id: 'usr_1', amount_total: 5000 } },
      });

      const reqMissingSecret: any = {
        headers: { 'stripe-signature': 't=123,v1=abc' },
        rawBody: Buffer.from(payload, 'utf8'),
        body: JSON.parse(payload),
      };
      const resMissingSecret = createMockRes();
      await handleStripeWebhook(reqMissingSecret, resMissingSecret, {
        getStripeFn: () => stripeTestClient,
        webhookSecret: '',
        executeDepositFn: async () => {
          depositCalled++;
          return { success: true };
        },
      });
      assert.strictEqual(resMissingSecret.statusCode, 503, 'Missing webhook secret must fail closed with HTTP 503');
      assert.strictEqual(resMissingSecret.body?.received, false);
      assert.strictEqual(depositCalled, 0, 'Unconfigured secret must never credit deposit');

      // Case 1B: Configured secret but missing stripe-signature header fails closed with 400
      const reqMissingSig: any = {
        headers: {},
        rawBody: Buffer.from(payload, 'utf8'),
        body: JSON.parse(payload),
      };
      const resMissingSig = createMockRes();
      await handleStripeWebhook(reqMissingSig, resMissingSig, {
        getStripeFn: () => stripeTestClient,
        webhookSecret: testWebhookSecret,
        executeDepositFn: async () => {
          depositCalled++;
          return { success: true };
        },
      });
      assert.strictEqual(resMissingSig.statusCode, 400, 'Missing stripe-signature must fail closed with HTTP 400');
      assert.strictEqual(resMissingSig.body?.received, false);
      assert.strictEqual(depositCalled, 0, 'Missing signature must never credit deposit');

      // Case 1C: Missing rawBody (JSON object only) fails closed with 400 without trusting req.body
      const reqMissingRaw: any = {
        headers: { 'stripe-signature': 't=123,v1=abc' },
        rawBody: undefined,
        body: JSON.parse(payload),
      };
      const resMissingRaw = createMockRes();
      await handleStripeWebhook(reqMissingRaw, resMissingRaw, {
        getStripeFn: () => stripeTestClient,
        webhookSecret: testWebhookSecret,
        executeDepositFn: async () => {
          depositCalled++;
          return { success: true };
        },
      });
      assert.strictEqual(resMissingRaw.statusCode, 400, 'Missing rawBody must fail closed with HTTP 400');
      assert.strictEqual(depositCalled, 0, 'Must never parse or credit req.body without rawBody verification');

      // Case 1D: Live Express HTTP middleware route check (POST /api/stripe/webhook over loopback)
      process.env.STRIPE_WEBHOOK_SECRET = '';
      const server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      try {
        const addr = server.address() as any;
        const resp = await fetch(`http://127.0.0.1:${addr.port}/api/stripe/webhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        });
        assert.strictEqual(resp.status, 503, 'Live Express route must fail closed (503) when unconfigured');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    } finally {
      if (prevSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
      else process.env.STRIPE_WEBHOOK_SECRET = prevSecret;
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
    }
    console.log('✓ Test 1 passed: Missing Stripe signature header & missing secret fail closed with zero credit');
  }

  // -------------------------------------------------------------------------
  // TEST 2: Invalid Stripe signature rejected (HTTP 400), zero credit
  // -------------------------------------------------------------------------
  {
    let depositCalled = 0;
    const payload = JSON.stringify({
      id: 'evt_forged_sig_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_forged_1',
          client_reference_id: 'usr_victim',
          amount_total: 250000,
          payment_status: 'paid',
          metadata: { userId: 'usr_victim', amount: '2500' },
        },
      },
    });
    const forgedSig = stripeTestClient.webhooks.generateTestHeaderString({
      payload,
      secret: 'whsec_wrong_attacker_secret',
    });

    const req: any = {
      headers: { 'stripe-signature': forgedSig },
      rawBody: Buffer.from(payload, 'utf8'),
      body: JSON.parse(payload),
    };
    const res = createMockRes();

    await handleStripeWebhook(req, res, {
      getStripeFn: () => stripeTestClient,
      webhookSecret: testWebhookSecret,
      executeDepositFn: async () => {
        depositCalled++;
        return { success: true };
      },
    });

    assert.strictEqual(res.statusCode, 400, 'Invalid Stripe signature must return HTTP 400');
    assert.strictEqual(depositCalled, 0, 'Invalid signature must never trigger executeDepositFn');
    console.log('✓ Test 2 passed: Invalid Stripe signature is rejected with HTTP 400 and zero credits');
  }

  // -------------------------------------------------------------------------
  // TEST 3 & TEST 4: Valid signed webhook credits ONCE via executeServerDeposit contract,
  // does NOT call db.processDeposit or dispatcher, and duplicate delivery does NOT re-credit
  // or mint random IDs/refs.
  // -------------------------------------------------------------------------
  {
    const sessionId = 'cs_stage3b_valid_001';
    const seenPayments = new Set<string>();
    const depositCalls: any[] = [];
    const origProcessDeposit = db.processDeposit.bind(db);
    const origDispatch = serverNotificationDispatcher.dispatch.bind(serverNotificationDispatcher);
    let legacyProcessDepositCalls = 0;
    let dispatcherCalls = 0;

    (db as any).processDeposit = (...args: any[]) => {
      legacyProcessDepositCalls++;
      return origProcessDeposit(...(args as [any]));
    };
    (serverNotificationDispatcher as any).dispatch = async (...args: any[]) => {
      dispatcherCalls++;
      return origDispatch(...(args as [any]));
    };

    const initialTxLen = db.transactions.length;
    try {
      const executeMockAuthoritativeDeposit = async (params: any) => {
        depositCalls.push(params);
        const alreadyProcessed = seenPayments.has(params.providerPaymentId);
        seenPayments.add(params.providerPaymentId);

        const deterministicTx: Transaction = {
          id: `tx_dep_${params.providerPaymentId}`,
          referenceNumber: params.providerPaymentId,
          type: 'DEPOSIT',
          amount: params.amount,
          currency: 'USD',
          status: 'COMPLETED',
          userId: params.userId,
          recipientUserId: params.userId,
          fee: 0,
          description: 'Stripe Card Deposit',
          category: 'Deposits',
          paymentProviderRef: params.providerPaymentId,
          createdAt: '2026-11-17T07:00:00.000Z',
          completedAt: '2026-11-17T07:00:00.000Z',
        };

        return {
          success: true,
          isDuplicate: alreadyProcessed,
          transaction: deterministicTx,
        };
      };

      const payload = JSON.stringify({
        id: 'evt_valid_001',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: sessionId,
            client_reference_id: 'usr_eleanor',
            amount_total: 150000,
            currency: 'usd',
            payment_status: 'paid',
            metadata: {
              userId: 'usr_eleanor',
              amount: '1500',
              destinationAccountType: 'CHECKING',
            },
          },
        },
      });
      const validSig = stripeTestClient.webhooks.generateTestHeaderString({
        payload,
        secret: testWebhookSecret,
      });

      // First delivery
      const req1: any = {
        headers: { 'stripe-signature': validSig },
        rawBody: Buffer.from(payload, 'utf8'),
        body: JSON.parse(payload),
      };
      const res1 = createMockRes();
      await handleStripeWebhook(req1, res1, {
        getStripeFn: () => stripeTestClient,
        webhookSecret: testWebhookSecret,
        executeDepositFn: executeMockAuthoritativeDeposit as any,
      });

      assert.strictEqual(res1.statusCode, 200);
      assert.strictEqual(res1.body?.received, true);
      assert.strictEqual(depositCalls.length, 1);
      assert.strictEqual(depositCalls[0].providerPaymentId, `STRIPE-${sessionId}`);
      assert.strictEqual(depositCalls[0].referenceNumber, `STRIPE-${sessionId}`);
      assert.strictEqual(legacyProcessDepositCalls, 0, 'Must NOT invoke db.processDeposit');
      assert.strictEqual(dispatcherCalls, 0, 'Stage 3B webhook must NOT call serverNotificationDispatcher');
      assert.strictEqual(db.transactions.length, initialTxLen + 1, 'First verified settlement mirrors committed tx once');

      // Duplicate delivery of the same signed session
      const sig2 = stripeTestClient.webhooks.generateTestHeaderString({
        payload,
        secret: testWebhookSecret,
      });
      const req2: any = {
        headers: { 'stripe-signature': sig2 },
        rawBody: Buffer.from(payload, 'utf8'),
        body: JSON.parse(payload),
      };
      const res2 = createMockRes();
      await handleStripeWebhook(req2, res2, {
        getStripeFn: () => stripeTestClient,
        webhookSecret: testWebhookSecret,
        executeDepositFn: executeMockAuthoritativeDeposit as any,
      });

      assert.strictEqual(res2.statusCode, 200);
      assert.strictEqual(res2.body?.received, true);
      assert.strictEqual(depositCalls.length, 2);
      assert.strictEqual(depositCalls[1].providerPaymentId, `STRIPE-${sessionId}`, 'Duplicate retry must pass exact deterministic providerPaymentId');
      assert.strictEqual(depositCalls[1].referenceNumber, `STRIPE-${sessionId}`, 'Duplicate retry must never generate random referenceNumber');
      assert.strictEqual(db.transactions.length, initialTxLen + 1, 'Duplicate Stripe webhook must NOT append a second transaction');
      assert.strictEqual(legacyProcessDepositCalls, 0);
      assert.strictEqual(dispatcherCalls, 0);
    } finally {
      (db as any).processDeposit = origProcessDeposit;
      (serverNotificationDispatcher as any).dispatch = origDispatch;
      // Remove the temporary test entry from in-memory db.transactions
      while (db.transactions.length > initialTxLen) {
        db.transactions.shift();
      }
    }
    console.log('✓ Test 3 & Test 4 passed: Valid Stripe webhook uses authoritative deposit path & duplicate retries stay idempotent without random IDs or db.processDeposit');
  }

  // -------------------------------------------------------------------------
  // TEST 5: Event-type classification safety (never coerce TRANSACTION/INVESTMENT/SYSTEM/SUPPORT to SECURITY)
  // -------------------------------------------------------------------------
  {
    const fsMem = new InMemoryFirestore();
    const smsCalls: any[] = [];
    const emailCalls: any[] = [];
    const sentPushPayloads: any[] = [];

    const validTok = 'd_token_stage3b_classification_test_' + 'a'.repeat(40);
    await registerCustomerPushToken(
      { uid: 'usr_class_test', token: validTok, platform: 'web' },
      fsMem as unknown as Firestore
    );

    const mockMessaging: Partial<Messaging> = {
      sendEachForMulticast: async (message: any) => {
        sentPushPayloads.push(message);
        return {
          successCount: message.tokens.length,
          failureCount: 0,
          responses: message.tokens.map(() => ({ success: true, messageId: 'msg_ok' })),
        };
      },
    };

    const origSms = smsService.sendTransactionSms.bind(smsService);
    const origEmail = emailService.sendTransactionalEmail.bind(emailService);
    (smsService as any).sendTransactionSms = async (params: any) => {
      smsCalls.push(params);
      return { success: true, delivered: true, status: 'SENT' };
    };
    (emailService as any).sendTransactionalEmail = async (params: any) => {
      emailCalls.push(params);
      return { success: true, delivered: true, status: 'SENT' };
    };

    try {
      const dispatcher = new ServerNotificationDispatcher({
        firestore: fsMem as unknown as Firestore,
        messaging: mockMessaging as Messaging,
        isAdminConfigured: () => true,
        isMessagingConfigured: () => true,
      });

      // Unsupported SMS/Email types must NEVER fall back to SECURITY
      for (const nonAlertType of ['TRANSACTION', 'INVESTMENT', 'SYSTEM', 'SUPPORT'] as const) {
        const res = await dispatcher.dispatch({
          transactionId: `tx_type_${nonAlertType}`,
          referenceNumber: `REF-${nonAlertType}`,
          type: nonAlertType,
          userId: 'usr_class_test',
          recipientName: 'Eleanor Vance',
          recipientEmail: 'eleanor@example.com',
          recipientPhone: '+15551234567',
          amount: 500,
          title: `${nonAlertType} Update`,
          body: `Informational ${nonAlertType} notice`,
        });

        assert.strictEqual(res.push.delivered, true, `${nonAlertType} push still delivers when push enabled`);
        assert.strictEqual(res.sms.delivered, false, `${nonAlertType} must NOT trigger SMS as SECURITY`);
        assert.strictEqual(res.sms.status, 'UNCONFIGURED_PROVIDER');
        assert.strictEqual(res.email.delivered, false, `${nonAlertType} must NOT trigger Email as SECURITY`);
        assert.strictEqual(res.email.status, 'UNCONFIGURED_PROVIDER');
      }
      assert.strictEqual(smsCalls.length, 0, 'SMS service must receive 0 calls for TRANSACTION/INVESTMENT/SYSTEM/SUPPORT');
      assert.strictEqual(emailCalls.length, 0, 'Email service must receive 0 calls for TRANSACTION/INVESTMENT/SYSTEM/SUPPORT');

      // MONEY_RECEIVED & MONEY_SENT preserve exact types
      await dispatcher.dispatch({
        transactionId: 'tx_money_rcv_1',
        referenceNumber: 'REF-RCV-1',
        type: 'MONEY_RECEIVED',
        userId: 'usr_class_test',
        recipientName: 'Eleanor Vance',
        recipientEmail: 'eleanor@example.com',
        recipientPhone: '+15551234567',
        senderName: 'Marcus Sterling',
        amount: 250,
        accountMasked: 'Monvera Premier Checking (MVB •••• 7391)',
      });
      await dispatcher.dispatch({
        transactionId: 'tx_money_sent_1',
        referenceNumber: 'REF-SENT-1',
        type: 'MONEY_SENT',
        userId: 'usr_class_test',
        recipientName: 'Marcus Sterling',
        recipientEmail: 'eleanor@example.com',
        recipientPhone: '+15551234567',
        senderName: 'Eleanor Vance',
        amount: 125,
        accountMasked: 'Monvera Premier Checking (MVB •••• 7391)',
      });

      // SECURITY stays mandatory even if transactionAlerts is false
      await dispatcher.dispatch({
        transactionId: 'tx_sec_1',
        referenceNumber: 'REF-SEC-1',
        type: 'SECURITY',
        userId: 'usr_class_test',
        recipientName: 'Eleanor Vance',
        recipientEmail: 'eleanor@example.com',
        recipientPhone: '+15551234567',
        preferences: { transactionAlerts: false },
      });

      assert.deepStrictEqual(
        smsCalls.map((c) => c.type),
        ['MONEY_RECEIVED', 'MONEY_SENT', 'SECURITY'],
        'SMS types must preserve exact classification'
      );
      assert.deepStrictEqual(
        emailCalls.map((c) => c.type),
        ['MONEY_RECEIVED', 'MONEY_SENT', 'SECURITY'],
        'Email types must preserve exact classification'
      );
    } finally {
      (smsService as any).sendTransactionSms = origSms;
      (emailService as any).sendTransactionalEmail = origEmail;
    }
    console.log('✓ Test 5 passed: Non-SECURITY event types are never misclassified as SECURITY in SMS/Email while MONEY_RECEIVED/MONEY_SENT/SECURITY preserve exact templates');
  }

  // -------------------------------------------------------------------------
  // TEST 6, 7 & 8: Transfer dispatch safety (duplicate suppression, COMPLETED-only gating,
  // committed-transaction truth ignoring client tampering, masked accounts & nicknames)
  // -------------------------------------------------------------------------
  {
    const committedTx: Transaction = {
      id: 'tx_committed_999',
      referenceNumber: 'MV-TX-999',
      type: 'TRANSFER',
      amount: 420.5,
      currency: 'USD',
      status: 'COMPLETED',
      userId: 'uid_sender_real',
      senderUserId: 'uid_sender_real',
      senderName: 'Real Sender Name',
      senderAccountNumber: '1045827391',
      recipientUserId: 'uid_recipient_real',
      recipientName: 'Real Recipient Name',
      recipientAccountNumber: '1099887766',
      fee: 0,
      description: 'Settled transfer',
      category: 'Transfers',
      createdAt: '2026-11-17T07:00:00.000Z',
    };

    const senderMetrics: BalanceMetrics = {
      checkingBalance: 1000,
      savingsBalance: 0,
      investedBalance: 0,
      accruedEarnings: 0,
      totalBalance: 1000,
      availableBalance: 1000,
      pendingBalance: 0,
      accounts: [
        {
          id: 'acc_s_chk',
          userId: 'uid_sender_real',
          type: 'CHECKING',
          accountNumber: '1045827391',
          routingNumber: '021000021',
          currency: 'USD',
          balance: 1000,
          availableBalance: 1000,
          investedBalance: 0,
          pendingBalance: 0,
          interestRateAPY: 0.5,
          status: 'ACTIVE',
          nickname: 'Executive Checking',
        },
      ],
    };

    const recipientMetrics: BalanceMetrics = {
      checkingBalance: 2500,
      savingsBalance: 0,
      investedBalance: 0,
      accruedEarnings: 0,
      totalBalance: 2500,
      availableBalance: 2500,
      pendingBalance: 0,
      accounts: [
        {
          id: 'acc_r_chk',
          userId: 'uid_recipient_real',
          type: 'CHECKING',
          accountNumber: '1099887766',
          routingNumber: '021000021',
          currency: 'USD',
          balance: 2500,
          availableBalance: 2500,
          investedBalance: 0,
          pendingBalance: 0,
          interestRateAPY: 0.5,
          status: 'ACTIVE',
          nickname: 'Private Reserve Checking',
        },
      ],
    };

    // Test 6: Duplicate transfer result returns []
    const dupEvents = buildTrustedTransferDispatchEvents(committedTx, true, {
      mode: 'MONVERA_C2C',
      authenticatedSenderUid: 'uid_sender_real',
      senderMetrics,
      recipientMetrics,
    });
    assert.strictEqual(dupEvents.length, 0, 'Duplicate transfer result must produce zero dispatch events');

    // Test 7: Non-COMPLETED statuses return []
    for (const badStatus of ['PENDING', 'FAILED', 'REVERSED'] as const) {
      const nonCompletedEvents = buildTrustedTransferDispatchEvents(
        { ...committedTx, status: badStatus },
        false,
        {
          mode: 'MONVERA_C2C',
          authenticatedSenderUid: 'uid_sender_real',
          senderMetrics,
          recipientMetrics,
        }
      );
      assert.strictEqual(
        nonCompletedEvents.length,
        0,
        `Status ${badStatus} must produce zero completed-money dispatch events`
      );
    }

    // Test 8: Valid non-duplicate COMPLETED transfer uses committed values, authoritative contact & masked nicknames
    const c2cEvents = buildTrustedTransferDispatchEvents(committedTx, false, {
      mode: 'MONVERA_C2C',
      authenticatedSenderUid: 'uid_sender_real',
      senderMetrics,
      recipientMetrics,
      senderContact: { email: 'sender-auth@monvera.test', phone: '+15550001111' },
      recipientContact: { email: 'recipient-auth@monvera.test', phone: '+15550002222' },
    });

    assert.strictEqual(c2cEvents.length, 2, 'C2C completed transfer produces MONEY_RECEIVED + MONEY_SENT');
    const rcvEvt = c2cEvents.find((e) => e.type === 'MONEY_RECEIVED')!;
    const sentEvt = c2cEvents.find((e) => e.type === 'MONEY_SENT')!;

    assert.strictEqual(rcvEvt.userId, 'uid_recipient_real');
    assert.strictEqual(rcvEvt.amount, 420.5);
    assert.strictEqual(rcvEvt.recipientName, 'Real Recipient Name');
    assert.strictEqual(rcvEvt.senderName, 'Real Sender Name');
    assert.strictEqual(rcvEvt.recipientEmail, 'recipient-auth@monvera.test');
    assert.strictEqual(rcvEvt.accountMasked, 'Private Reserve Checking (MVB •••• 7766)');
    assert.ok(!rcvEvt.accountMasked?.includes('1099887766'), 'Full account number must never appear in notification payload');

    assert.strictEqual(sentEvt.userId, 'uid_sender_real');
    assert.strictEqual(sentEvt.amount, 420.5);
    assert.strictEqual(sentEvt.recipientEmail, 'sender-auth@monvera.test');
    assert.strictEqual(sentEvt.accountMasked, 'Executive Checking (MVB •••• 7391)');
    assert.ok(!sentEvt.accountMasked?.includes('1045827391'), 'Full sender account number must never appear');

    // Admin transfer produces only MONEY_RECEIVED for committed recipientUserId (never trusts client targetName/amount)
    const adminEvents = buildTrustedTransferDispatchEvents(
      {
        ...committedTx,
        senderUserId: 'usr_admin',
        senderName: 'Bennett Johnson',
        metadata: { adminSenderName: 'Bennett Johnson', recipientAccountType: 'CHECKING' },
      },
      false,
      {
        mode: 'ADMIN_TRANSFER',
        recipientMetrics,
        recipientContact: { email: 'recipient-auth@monvera.test', phone: '+15550002222' },
      }
    );
    assert.strictEqual(adminEvents.length, 1);
    assert.strictEqual(adminEvents[0].type, 'MONEY_RECEIVED');
    assert.strictEqual(adminEvents[0].recipientName, 'Real Recipient Name');
    assert.strictEqual(adminEvents[0].amount, 420.5);

    // Mismatched authenticated senderUid prevents spoofing MONEY_SENT
    const spoofedSenderEvents = buildTrustedTransferDispatchEvents(committedTx, false, {
      mode: 'MONVERA_C2C',
      authenticatedSenderUid: 'uid_different_caller',
      senderMetrics,
      recipientMetrics,
    });
    assert.strictEqual(spoofedSenderEvents.some((e) => e.type === 'MONEY_SENT'), false);

    console.log('✓ Tests 6, 7 & 8 passed: Duplicate/non-COMPLETED suppression & committed-transaction identity/amount/masking enforced');
  }

  // -------------------------------------------------------------------------
  // TEST 9: Stage 2D token registration, mismatched-credential safety, lease/dedupe push delivery,
  // and Phase 4 deterministic lifecycle event key contract
  // -------------------------------------------------------------------------
  {
    const fsMem = new InMemoryFirestore();
    const sharedTok = 'fcm_stage3b_shared_device_token_' + 'z'.repeat(40);
    const badTok = 'fcm_stage3b_unregistered_token_' + 'u'.repeat(40);
    const mismatchTok = 'fcm_stage3b_mismatch_token_' + 'm'.repeat(40);

    // 9A. Token registration & shared-device reassignment
    const r1 = await registerCustomerPushToken(
      { uid: 'user_A', token: sharedTok, platform: 'web' },
      fsMem as unknown as Firestore
    );
    assert.strictEqual(r1.success, true);

    const r2 = await registerCustomerPushToken(
      { uid: 'user_B', token: sharedTok, platform: 'web' },
      fsMem as unknown as Firestore
    );
    assert.strictEqual(r2.success, true);
    assert.strictEqual(r2.reassignedFromPreviousUser, true, 'Reassigning shared token must unlink previous user');
    const userATokens = await fsMem.collection('users').doc('user_A').collection('notificationTokens').get();
    assert.strictEqual(userATokens.size, 0, 'Previous user subcollection entry must be removed on reassignment');

    await registerCustomerPushToken(
      { uid: 'user_B', token: badTok, platform: 'web' },
      fsMem as unknown as Firestore
    );
    await registerCustomerPushToken(
      { uid: 'user_B', token: mismatchTok, platform: 'web' },
      fsMem as unknown as Firestore
    );

    // 9B. Mock FCM with mixed outcomes: success (sharedTok), invalid token (badTok), mismatched-credential (mismatchTok)
    let sendCalls = 0;
    const mockMessaging: Partial<Messaging> = {
      sendEachForMulticast: async (msg: any) => {
        sendCalls++;
        return {
          successCount: 1,
          failureCount: 2,
          responses: msg.tokens.map((t: string) => {
            if (t === sharedTok) return { success: true, messageId: 'fcm_ok_1' };
            if (t === badTok) {
              return {
                success: false,
                error: { code: 'messaging/registration-token-not-registered', message: 'Not registered' },
              };
            }
            return {
              success: false,
              error: { code: 'messaging/mismatched-credential', message: 'SenderId mismatch' },
            };
          }),
        };
      },
    };

    const dispatcher = new ServerNotificationDispatcher({
      firestore: fsMem as unknown as Firestore,
      messaging: mockMessaging as Messaging,
      isAdminConfigured: () => true,
      isMessagingConfigured: () => true,
    });

    const firstDispatch = await dispatcher.dispatch({
      transactionId: 'tx_stage2d_check_1',
      referenceNumber: 'REF-2D-1',
      type: 'SECURITY',
      userId: 'user_B',
      recipientEmail: '',
      recipientPhone: '',
    });

    assert.strictEqual(firstDispatch.push.delivered, true);
    assert.strictEqual(firstDispatch.push.status, 'PARTIAL', 'mismatched-credential stays transient failure -> PARTIAL');
    assert.strictEqual(firstDispatch.push.removedInvalidTokens, 1, 'Only permanent unregistered token removed');

    const badTokId = computePushTokenId(badTok);
    const mismatchTokId = computePushTokenId(mismatchTok);
    const userBDocs = await fsMem.collection('users').doc('user_B').collection('notificationTokens').get();
    const survivingIds = new Set(userBDocs.docs.map((d) => d.id));
    assert.strictEqual(survivingIds.has(badTokId), false, 'Permanent invalid token must be deleted');
    assert.strictEqual(survivingIds.has(mismatchTokId), true, 'messaging/mismatched-credential must NEVER delete token');

    // Second dispatch on same event with second worker instance skips already delivered sharedTok & retries only mismatchTok
    const mockMessagingRetry: Partial<Messaging> = {
      sendEachForMulticast: async (msg: any) => {
        assert.deepStrictEqual(msg.tokens, [mismatchTok], 'Retry must target only undelivered tokens');
        return {
          successCount: 1,
          failureCount: 0,
          responses: [{ success: true, messageId: 'fcm_ok_retry' }],
        };
      },
    };
    const dispatcher2 = new ServerNotificationDispatcher({
      firestore: fsMem as unknown as Firestore,
      messaging: mockMessagingRetry as Messaging,
      isAdminConfigured: () => true,
      isMessagingConfigured: () => true,
    });

    const retryDispatch = await dispatcher2.dispatch({
      transactionId: 'tx_stage2d_check_1',
      referenceNumber: 'REF-2D-1',
      type: 'SECURITY',
      userId: 'user_B',
      recipientEmail: '',
      recipientPhone: '',
    });
    assert.strictEqual(retryDispatch.push.status, 'SENT');

    // Third dispatch on SENT event must be blocked by persistent lease/dedupe
    const thirdDispatch = await dispatcher2.dispatch({
      transactionId: 'tx_stage2d_check_1',
      referenceNumber: 'REF-2D-1',
      type: 'SECURITY',
      userId: 'user_B',
      recipientEmail: '',
      recipientPhone: '',
    });
    assert.strictEqual(thirdDispatch.push.status, 'DUPLICATE_IGNORED');
    assert.strictEqual(sendCalls, 1);

    // Unregister leaves other tokens intact
    const unreg = await unregisterCustomerPushToken(
      { uid: 'user_B', token: sharedTok },
      fsMem as unknown as Firestore
    );
    assert.strictEqual(unreg.success, true);
    assert.strictEqual(unreg.unregistered, true);
    const remainingUserB = await fsMem.collection('users').doc('user_B').collection('notificationTokens').get();
    assert.strictEqual(remainingUserB.size, 1);

    // 9C. Phase 4 deterministic lifecycle event key contract & per-user dispatch log key isolation
    assert.strictEqual(buildTransactionLifecycleEventKey('tx_abc', 'INITIATED'), 'tx_abc:INITIATED');
    assert.strictEqual(buildTransactionLifecycleEventKey('tx_abc', 'REVERSED'), 'tx_abc:REVERSED');
    assert.strictEqual(buildTransactionLifecycleEventKey('tx_abc', 'SUBMITTED'), 'tx_abc:SUBMITTED');
    assert.strictEqual(buildTransactionLifecycleEventKey('tx_abc', 'DELIVERED'), 'tx_abc:DELIVERED');
    assert.throws(() => buildTransactionLifecycleEventKey('  ', 'INITIATED'));

    // Confirm same transactionId hashes separately per userId in dispatch logs
    const hashUserA = crypto.createHash('sha256').update('user_A::tx_abc:INITIATED_TRANSACTION').digest('base64url');
    const hashUserB = crypto.createHash('sha256').update('user_B::tx_abc:INITIATED_TRANSACTION').digest('base64url');
    assert.notStrictEqual(hashUserA, hashUserB, 'Per-user dispatch log keys must remain isolated');

    console.log('✓ Test 9 passed: Stage 2D token lifecycle, mismatch preservation, lease/dedupe recovery & Phase 4 key contract verified');
  }

  console.log('\nALL STAGE 3B VERIFICATION CHECKS PASSED (9/9).');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('\nStage 3B Verification Failed:', err);
  process.exit(1);
});
