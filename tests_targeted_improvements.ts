import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateUsdDepositAmount, MIN_USD_DEPOSIT_CENTS, MIN_USD_DEPOSIT_DOLLARS } from './src/utils/depositValidation';
import {
  buildTransactionNotificationPresentation,
  isFinancialTransactionNotification,
} from './src/utils/transactionNotificationFormatter';
import {
  handleCreateStripeCheckoutSession,
  verifyPaidStripeCheckoutSession,
  handleStripeWebhook,
  handleStripeSessionConfirmation,
  handleWebhookTestSimulate,
} from './server';
import {
  executeServerDeposit,
  executeServerTransfer,
} from './server/firestoreTransactions';
import { db } from './server/db';
import { NotificationItem } from './src/types';

function createMockRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    headers: {},
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

class InMemoryFirestoreDocRef {
  public id: string;
  constructor(
    private store: Map<string, Record<string, any>>,
    private collectionName: string,
    docId: string
  ) {
    this.id = docId;
  }
  get key() {
    return `${this.collectionName}/${this.id}`;
  }
  async get() {
    const val = this.store.get(this.key);
    return {
      exists: val !== undefined,
      id: this.id,
      ref: this,
      data: () => (val ? { ...val } : undefined),
    };
  }
  async set(data: Record<string, any>, options?: { merge?: boolean }) {
    if (options?.merge && this.store.has(this.key)) {
      this.store.set(this.key, { ...this.store.get(this.key)!, ...data });
    } else {
      this.store.set(this.key, { ...data });
    }
  }
}

class InMemoryFirestoreQuery {
  constructor(
    private store: Map<string, Record<string, any>>,
    private collectionName: string,
    private filters: Array<{ field: string; value: any }> = []
  ) {}
  where(field: string, _op: string, value: any) {
    return new InMemoryFirestoreQuery(this.store, this.collectionName, [...this.filters, { field, value }]);
  }
  limit(_n: number) {
    return this;
  }
  async get() {
    const prefix = `${this.collectionName}/`;
    const docs: any[] = [];
    for (const [k, v] of this.store.entries()) {
      if (!k.startsWith(prefix)) continue;
      const matches = this.filters.every((f) => v[f.field] === f.value);
      if (matches) {
        const docId = k.slice(prefix.length);
        docs.push({
          id: docId,
          exists: true,
          ref: new InMemoryFirestoreDocRef(this.store, this.collectionName, docId),
          data: () => ({ ...v }),
        });
      }
    }
    return { empty: docs.length === 0, docs };
  }
}

function createMockFirestore(initialDocs: Record<string, Record<string, any>> = {}) {
  const store = new Map<string, Record<string, any>>();
  for (const [k, v] of Object.entries(initialDocs)) {
    store.set(k, { ...v });
  }
  const firestore: any = {
    store,
    collection(name: string) {
      return {
        doc(id?: string) {
          const docId = id || `auto_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          return new InMemoryFirestoreDocRef(store, name, docId);
        },
        where(field: string, op: string, value: any) {
          return new InMemoryFirestoreQuery(store, name, [{ field, value }]);
        },
      };
    },
    async runTransaction(fn: (tx: any) => Promise<any>) {
      const tx = {
        async get(target: any) {
          return target.get();
        },
        set(ref: InMemoryFirestoreDocRef, data: any, options?: { merge?: boolean }) {
          if (options?.merge && store.has(ref.key)) {
            store.set(ref.key, { ...store.get(ref.key)!, ...data });
          } else {
            store.set(ref.key, { ...data });
          }
          return tx;
        },
      };
      return fn(tx);
    },
  };
  return firestore;
}

async function run() {
  console.log('=== Running Targeted Monvera Improvements Verification Suite ===');

  // -------------------------------------------------------------------------
  // 1. UI Back Button Verification (NotificationsDrawer.tsx)
  // -------------------------------------------------------------------------
  const drawerSource = fs.readFileSync(
    path.join(process.cwd(), 'src/components/dashboard/NotificationsDrawer.tsx'),
    'utf8'
  );
  assert.ok(drawerSource.includes('id="notifications-back-btn"'), 'NotificationsDrawer must expose #notifications-back-btn');
  assert.ok(drawerSource.includes('id="notification-detail-back-btn"'), 'NotificationsDrawer must preserve #notification-detail-back-btn');
  assert.ok(drawerSource.includes('handleBackToPreviousSection'), 'Must call handleBackToPreviousSection');
  assert.ok(!drawerSource.includes("setCurrentView('dashboard')"), 'Back button must NOT hardcode navigation to dashboard');
  assert.ok(drawerSource.includes('onBack?: () => void'), 'NotificationsDrawer must accept optional onBack prop');
  assert.ok(drawerSource.includes('aria-label={`Back to ${previousScreenLabel}`}'), 'Back button must have accessible aria-label naming previous screen');
  assert.ok(
    drawerSource.includes("import { MonveraLogo } from '../common/MonveraLogo'") &&
      drawerSource.includes('<MonveraLogo variant="full" size="sm" isLight={true} />') &&
      drawerSource.includes('MONVERA DIGITAL BANKING'),
    'NotificationsDrawer must reuse existing official MonveraLogo component and show MONVERA DIGITAL BANKING branding'
  );
  console.log('✓ Test 1 passed: Notification section Back button, accessibility, state preservation, and official MonveraLogo branding verified');

  // -------------------------------------------------------------------------
  // 2. Minimum Deposit Validation ($1.00 USD) — Frontend + UI Source + Backend
  // -------------------------------------------------------------------------
  assert.equal(MIN_USD_DEPOSIT_DOLLARS, 1.0);
  assert.equal(MIN_USD_DEPOSIT_CENTS, 100);

  for (const invalidVal of [0, -5, '0', '-1.00', 0.5, '0.50', 0.99, '0.99', '1.234', '', null, undefined, 'abc']) {
    const res = validateUsdDepositAmount(invalidVal);
    assert.equal(res.ok, false, `Expected validateUsdDepositAmount(${String(invalidVal)}) to fail`);
  }
  for (const validVal of [1, '1', 1.0, '1.00', '1.01', 1.5, 10, '250.50']) {
    const res = validateUsdDepositAmount(validVal);
    assert.equal(res.ok, true, `Expected validateUsdDepositAmount(${String(validVal)}) to succeed`);
  }

  const depositModalSource = fs.readFileSync(
    path.join(process.cwd(), 'src/components/dashboard/DepositModal.tsx'),
    'utf8'
  );
  assert.ok(depositModalSource.includes('validateUsdDepositAmount'), 'DepositModal must use shared validateUsdDepositAmount');
  assert.ok(depositModalSource.includes('Minimum deposit: $1.00 USD'), 'DepositModal must clearly display Minimum deposit: $1.00 USD');
  assert.ok(depositModalSource.includes('min={MIN_USD_DEPOSIT_DOLLARS.toFixed(2)}'), 'DepositModal input min attribute must enforce $1.00');
  assert.ok(depositModalSource.includes('stripeRes.configured === false'), 'DepositModal must preserve Stripe config check');
  assert.ok(!depositModalSource.includes('api.createDeposit'), 'DepositModal must not reintroduce unverified fallback deposit API');

  // Backend Stripe Checkout creation rejects < $1.00 and accepts $1.00
  const checkoutRejectRes = createMockRes();
  let stripeCreateCalled = false;
  await handleCreateStripeCheckoutSession(
    { auth: { uid: 'usr_cust_1', email: 'c@monvera.test' }, body: { userId: 'usr_cust_1', amount: 0.99 } } as any,
    checkoutRejectRes,
    {
      isAdminFn: async () => false,
      getUserDocFn: async () => ({ status: 'active', email: 'c@monvera.test' }),
      getStripeFn: () =>
        ({
          checkout: {
            sessions: {
              create: async () => {
                stripeCreateCalled = true;
                return { id: 'cs_should_not_exist', url: 'https://checkout.stripe.test' };
              },
            },
          },
        }) as any,
    }
  );
  assert.equal(checkoutRejectRes.statusCode, 400);
  assert.equal(checkoutRejectRes.body?.errorCode, 'INVALID_DEPOSIT_AMOUNT');
  assert.ok(checkoutRejectRes.body?.error?.includes('$1.00 USD'));
  assert.equal(stripeCreateCalled, false);

  const checkoutAcceptRes = createMockRes();
  let capturedUnitAmount = 0;
  await handleCreateStripeCheckoutSession(
    { auth: { uid: 'usr_cust_1', email: 'c@monvera.test' }, body: { userId: 'usr_cust_1', amount: 1.0 } } as any,
    checkoutAcceptRes,
    {
      isAdminFn: async () => false,
      getUserDocFn: async () => ({ status: 'active', email: 'c@monvera.test' }),
      getStripeFn: () =>
        ({
          checkout: {
            sessions: {
              create: async (opts: any) => {
                capturedUnitAmount = opts.line_items[0].price_data.unit_amount;
                return { id: 'cs_1dollar_ok', url: 'https://checkout.stripe.test/cs_1dollar_ok' };
              },
            },
          },
        }) as any,
    }
  );
  assert.equal(checkoutAcceptRes.statusCode, 200);
  assert.equal(checkoutAcceptRes.body?.success, true);
  assert.equal(capturedUnitAmount, 100);

  // Stripe session verifier rejects 99 cents & accepts 100 cents
  const verify99 = verifyPaidStripeCheckoutSession({
    id: 'cs_99',
    mode: 'payment',
    payment_status: 'paid',
    currency: 'usd',
    amount_total: 99,
    client_reference_id: 'usr_cust_1',
    metadata: { userId: 'usr_cust_1', amount: '0.99' },
  });
  assert.equal(verify99.ok, false);
  assert.equal((verify99 as any).errorCode, 'MINIMUM_DEPOSIT_NOT_MET');

  const verify100 = verifyPaidStripeCheckoutSession({
    id: 'cs_100',
    mode: 'payment',
    payment_status: 'paid',
    currency: 'usd',
    amount_total: 100,
    client_reference_id: 'usr_cust_1',
    metadata: { userId: 'usr_cust_1', amount: '1' },
  });
  assert.equal(verify100.ok, true);
  assert.equal((verify100 as any).amount, 1);

  // Webhook & confirm-session reject 99 cents with 400 and 0 credits
  let webhookCreditCalled = false;
  const wh99Res = createMockRes();
  await handleStripeWebhook(
    { headers: { 'stripe-signature': 'sig_ok' }, rawBody: Buffer.from('{}') } as any,
    wh99Res,
    {
      webhookSecret: 'whsec_test',
      getStripeFn: () =>
        ({
          webhooks: {
            constructEvent: () => ({
              id: 'evt_99',
              type: 'checkout.session.completed',
              data: {
                object: {
                  id: 'cs_wh_99',
                  mode: 'payment',
                  payment_status: 'paid',
                  currency: 'usd',
                  amount_total: 99,
                  client_reference_id: 'usr_cust_1',
                  metadata: { userId: 'usr_cust_1', amount: '0.99' },
                },
              },
            }),
          },
        }) as any,
      executeDepositFn: async () => {
        webhookCreditCalled = true;
        return { success: true };
      },
    }
  );
  assert.equal(wh99Res.statusCode, 400);
  assert.equal(wh99Res.body?.errorCode, 'MINIMUM_DEPOSIT_NOT_MET');
  assert.equal(webhookCreditCalled, false);

  const confirm99Res = createMockRes();
  await handleStripeSessionConfirmation(
    { auth: { uid: 'usr_cust_1' }, query: { session_id: 'cs_99_confirm' }, body: {} } as any,
    confirm99Res,
    {
      isAdminFn: async () => false,
      getStripeFn: () =>
        ({
          checkout: {
            sessions: {
              retrieve: async () => ({
                id: 'cs_99_confirm',
                mode: 'payment',
                payment_status: 'paid',
                currency: 'usd',
                amount_total: 99,
                client_reference_id: 'usr_cust_1',
                metadata: { userId: 'usr_cust_1', amount: '0.99' },
              }),
            },
          },
        }) as any,
      executeDepositFn: async () => ({ success: true }),
    }
  );
  assert.equal(confirm99Res.statusCode, 400);
  assert.equal(confirm99Res.body?.errorCode, 'MINIMUM_DEPOSIT_NOT_MET');

  // Direct executeServerDeposit rejects $0.99 and credits $1.00 atomically
  const depMockFs = createMockFirestore({
    'users/usr_dep_min': {
      firstName: 'Maya',
      lastName: 'Lin',
      permanentAccountNumber: '1099887766',
      status: 'active',
    },
    'accounts/usr_dep_min': {
      userId: 'usr_dep_min',
      permanentAccountNumber: '1099887766',
      checkingBalance: 25,
      savingsBalance: 10,
      investedBalance: 0,
      accruedEarnings: 0,
      totalBalance: 35,
      availableBalance: 25,
      pendingBalance: 0,
    },
  });
  const serverDepReject = await executeServerDeposit(
    { userId: 'usr_dep_min', amount: 0.99, method: 'CARD', destinationAccountType: 'CHECKING' },
    { firestore: depMockFs, isAdminConfigured: () => true }
  );
  assert.equal(serverDepReject.success, false);
  assert.ok(serverDepReject.error?.includes('$1.00 USD'));

  const serverDepAccept = await executeServerDeposit(
    {
      userId: 'usr_dep_min',
      amount: 1.0,
      method: 'CARD',
      destinationAccountType: 'CHECKING',
      providerPaymentId: 'STRIPE-CS-MIN-100',
    },
    { firestore: depMockFs, isAdminConfigured: () => true }
  );
  assert.equal(serverDepAccept.success, true);
  assert.equal(serverDepAccept.transaction?.amount, 1);
  assert.equal(serverDepAccept.balanceMetrics?.checkingBalance, 26);

  // In-memory db.processDeposit and webhook simulator reject < $1.00 and accept $1.00
  const simUser = Array.from(db.users.values())[0];
  assert.ok(simUser, 'Expected at least one user in in-memory db');
  const dbDepReject = db.processDeposit({ userId: simUser.id, amount: 0.99, method: 'CARD' });
  assert.equal(dbDepReject.success, false);
  assert.ok(dbDepReject.error?.includes('$1.00 USD'));
  const dbDepAccept = db.processDeposit({ userId: simUser.id, amount: 1.0, method: 'CARD' });
  assert.equal(dbDepAccept.success, true);

  const sim99Res = createMockRes();
  handleWebhookTestSimulate({ auth: { uid: 'usr_admin' }, body: { userId: simUser.id, amount: 0.5 } } as any, sim99Res);
  assert.equal(sim99Res.statusCode, 400);

  console.log('✓ Test 2 passed: $1.00 USD minimum deposit enforced across frontend validator, DepositModal, Stripe checkout/confirm/webhook, executeServerDeposit, and db.processDeposit');

  // -------------------------------------------------------------------------
  // 3. Transaction Notification Presentation & Description Rules
  // -------------------------------------------------------------------------
  // 3A. Credit WITHOUT supplied description -> MUST omit description completely
  const creditNoDescNotif: NotificationItem = {
    id: 'notif_credit_nodesc',
    userId: 'usr_recip',
    title: 'Money Received',
    message: 'You received $500.00 from Daniel Brooks (MVB •••• 1122). Reference: MV-TRF-882100.',
    type: 'TRANSACTION',
    severity: 'success',
    read: false,
    createdAt: '2026-11-26T15:42:00.000Z',
    referenceId: 'MV-TRF-882100',
    metadata: {
      category: 'TRANSACTION',
      eventType: 'MONEY_RECEIVED',
      customerName: 'Elena Vance',
      senderName: 'Daniel Brooks',
      recipientName: 'Elena Vance',
      accountNumberMasked: 'MVB •••• 4455',
      transactionType: 'TRANSFER',
      direction: 'CREDIT',
      amount: 500,
      currency: 'USD',
      status: 'COMPLETED',
      referenceNumber: 'MV-TRF-882100',
      descriptionProvided: false,
      date: '2026-11-26T15:42:00.000Z',
    },
  };
  const creditNoDescPres = buildTransactionNotificationPresentation(creditNoDescNotif);
  assert.equal(isFinancialTransactionNotification(creditNoDescNotif), true);
  assert.equal(creditNoDescPres.heading, 'ACCOUNT CREDITED');
  assert.equal(creditNoDescPres.signedAmountFormatted, '+$500.00 USD');
  assert.equal(creditNoDescPres.senderName, 'Daniel Brooks');
  assert.equal(creditNoDescPres.recipientName, 'Elena Vance');
  assert.equal(creditNoDescPres.reference, 'MV-TRF-882100');
  assert.ok(creditNoDescPres.formattedDate.includes('2026'));
  assert.ok(/\d{1,2}:\d{2}\s?(AM|PM)/i.test(creditNoDescPres.formattedTime));
  assert.equal(creditNoDescPres.description, undefined, 'Credit notification without supplied description MUST omit description');

  // 3B. Credit WITH genuinely supplied description -> displays it
  const creditWithDescPres = buildTransactionNotificationPresentation({
    ...creditNoDescNotif,
    id: 'notif_credit_withdesc',
    metadata: {
      ...creditNoDescNotif.metadata,
      description: 'November Advisory Retainer',
      descriptionProvided: true,
    },
  });
  assert.equal(creditWithDescPres.description, 'November Advisory Retainer');

  // 3C. Debit WITH actual description -> shows actual description (no fallback)
  const debitWithDescNotif: NotificationItem = {
    id: 'notif_debit_withdesc',
    userId: 'usr_sender',
    title: 'Money Sent',
    message: 'You sent $120.00 to Elena Vance.',
    type: 'TRANSACTION',
    severity: 'info',
    read: false,
    createdAt: '2026-11-26T16:15:00.000Z',
    referenceId: 'MV-TRF-993211',
    metadata: {
      category: 'TRANSACTION',
      eventType: 'MONEY_SENT',
      senderName: 'Daniel Brooks',
      recipientName: 'Elena Vance',
      direction: 'DEBIT',
      amount: 120,
      currency: 'USD',
      status: 'COMPLETED',
      referenceNumber: 'MV-TRF-993211',
      description: 'Studio Equipment Reimbursement',
      descriptionProvided: true,
      date: '2026-11-26T16:15:00.000Z',
    },
  };
  const debitWithDescPres = buildTransactionNotificationPresentation(debitWithDescNotif);
  assert.equal(debitWithDescPres.heading, 'ACCOUNT DEBITED');
  assert.equal(debitWithDescPres.signedAmountFormatted, '-$120.00 USD');
  assert.equal(debitWithDescPres.description, 'Studio Equipment Reimbursement');
  assert.equal(debitWithDescPres.usedDebitFallbackDescription, false);

  // 3D. Debit WITHOUT recipient name AND WITHOUT description -> MUST use "Money transferred" fallback
  const debitMissingRecipAndDesc: NotificationItem = {
    id: 'notif_debit_fallback',
    userId: 'usr_sender',
    title: 'Account Debited',
    message: 'An outgoing debit of $75.00 was completed.',
    type: 'TRANSACTION',
    severity: 'info',
    read: false,
    createdAt: '2026-11-26T17:05:00.000Z',
    referenceId: 'MV-DEB-774100',
    metadata: {
      category: 'TRANSACTION',
      eventType: 'MONEY_SENT',
      senderName: 'Daniel Brooks',
      direction: 'DEBIT',
      amount: 75,
      currency: 'USD',
      status: 'COMPLETED',
      referenceNumber: 'MV-DEB-774100',
      descriptionProvided: false,
      date: '2026-11-26T17:05:00.000Z',
    },
  };
  const debitFallbackPres = buildTransactionNotificationPresentation(debitMissingRecipAndDesc);
  assert.equal(debitFallbackPres.heading, 'ACCOUNT DEBITED');
  assert.equal(debitFallbackPres.recipientName, undefined);
  assert.equal(debitFallbackPres.description, 'Money transferred');
  assert.equal(debitFallbackPres.usedDebitFallbackDescription, true);

  // 3E. Non-transaction security/support notification must NOT be formatted as financial tx card
  const securityNotif: NotificationItem = {
    id: 'notif_sec_1',
    userId: 'usr_1',
    title: 'KYC Approved',
    message: 'Your identity verification is complete.',
    type: 'SECURITY',
    severity: 'success',
    read: false,
    createdAt: '2026-11-26T12:00:00.000Z',
    metadata: { eventType: 'KYC_APPROVED' },
  };
  assert.equal(isFinancialTransactionNotification(securityNotif), false);

  // -------------------------------------------------------------------------
  // 4. End-to-end In-Memory Producer Notification Verification (C2C Transfer, Deposit, Admin Transfer)
  // -------------------------------------------------------------------------
  const usersArr = Array.from(db.users.values()).filter((u) => u.id !== 'usr_admin' && u.role !== 'super_admin');
  if (usersArr.length >= 2) {
    const senderU = usersArr[0];
    const recipU = usersArr[1];
    const preCount = db.notifications.length;
    const trfRes = db.recordMonveraTransfer({
      senderUserId: senderU.id,
      recipientUserId: recipU.id,
      amount: 25,
      description: '',
    });
    assert.equal(trfRes.success, true);
    const createdNotifs = db.notifications.slice(0, db.notifications.length - preCount);
    const creditNotif = createdNotifs.find((n) => n.userId === recipU.id);
    const debitNotif = createdNotifs.find((n) => n.userId === senderU.id);
    assert.ok(creditNotif && debitNotif, 'C2C transfer must create notifications for both sender and recipient');

    const creditPres = buildTransactionNotificationPresentation(creditNotif!);
    const debitPres = buildTransactionNotificationPresentation(debitNotif!);
    assert.equal(creditPres.heading, 'ACCOUNT CREDITED');
    assert.equal(creditPres.description, undefined, 'C2C credit notification with blank description must omit description');
    assert.equal(debitPres.heading, 'ACCOUNT DEBITED');
    assert.ok(creditPres.senderName && creditPres.recipientName, 'Credit notification must retain sender & recipient');
    assert.ok(debitPres.senderName && debitPres.recipientName, 'Debit notification must retain sender & recipient');
  }

  // Also test executeServerTransfer in mock Firestore preserves omitted vs supplied descriptions properly
  const trfMockFs = createMockFirestore({
    'users/usr_s1': {
      firstName: 'Jordan',
      lastName: 'Miles',
      permanentAccountNumber: '1011111111',
      status: 'active',
    },
    'users/usr_r1': {
      firstName: 'Clara',
      lastName: 'Chen',
      permanentAccountNumber: '1022222222',
      status: 'active',
    },
    'accounts/usr_s1': {
      userId: 'usr_s1',
      permanentAccountNumber: '1011111111',
      checkingBalance: 500,
      savingsBalance: 0,
      investedBalance: 0,
      accruedEarnings: 0,
      totalBalance: 500,
      availableBalance: 500,
      pendingBalance: 0,
    },
    'accounts/usr_r1': {
      userId: 'usr_r1',
      permanentAccountNumber: '1022222222',
      checkingBalance: 100,
      savingsBalance: 0,
      investedBalance: 0,
      accruedEarnings: 0,
      totalBalance: 100,
      availableBalance: 100,
      pendingBalance: 0,
    },
  });
  const srvTrfRes = await executeServerTransfer(
    {
      senderUid: 'usr_s1',
      recipientIdentifier: 'usr_r1',
      recipientUserId: 'usr_r1',
      amount: 40,
      description: '',
    },
    { firestore: trfMockFs, isAdminConfigured: () => true }
  );
  assert.equal(srvTrfRes.success, true);
  assert.equal(srvTrfRes.senderBalanceMetrics?.checkingBalance, 460);
  assert.equal(srvTrfRes.recipientBalanceMetrics?.checkingBalance, 140);

  console.log('✓ Test 3 & 4 passed: Branded notification presentation, strict credit description omission, debit fallback ("Money transferred"), and server/in-memory metadata verified');
  console.log('ALL TARGETED IMPROVEMENT TESTS PASSED.');
}

run().catch((err) => {
  console.error('TEST SUITE FAILED:', err);
  process.exit(1);
});
