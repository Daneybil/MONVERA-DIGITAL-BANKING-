/**
 * MONVERA DIGITAL BANKING — PRODUCTION PUSH NOTIFICATION REPAIR VERIFICATION SUITE (TESTS A–J)
 *
 * Strictly isolated offline verification using in-memory Firestore/Messaging/SW mocks.
 * Zero live Firebase mutations, zero live financial transactions, zero deployed changes.
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import type { Firestore } from 'firebase-admin/firestore';
import type { Messaging } from 'firebase-admin/messaging';

process.env.VERCEL = '1';

import {
  ServerNotificationDispatcher,
  registerCustomerPushToken,
  formatSafePushContent,
  buildTrustedTransferDispatchEvents,
} from './server/services/notificationDispatcher';
import {
  NOTIFICATION_OUTBOX_COLLECTION,
  computeNotificationOutboxId,
  claimOutboxLease,
  buildDispatchEventFromOutboxRecord,
  buildOutboxDispatchOptions,
  fetchDispatchLogForOutboxRecord,
  evaluateOutboxAttemptOutcome,
  transitionOutboxAsLeaseOwner,
} from './server/services/notificationOutbox';
import { executeServerTransfer } from './server/firestoreTransactions';
import { persistCustomerNotification } from './server/services/notificationStore';
import { PushNotificationService } from './src/services/pushNotificationService';
import {
  normalizePushPayload,
  buildNotificationNavTargetFromNormalized,
  parseNotificationDeepLinkFromUrl,
  savePendingNotificationNavTarget,
  readPendingNotificationNavTarget,
  clearPendingNotificationNavTarget,
  PushNotificationDeduplicator,
} from './src/utils/pushNotificationPayload';
import { resolveAuthorizedTransactionForDeepLink } from './src/components/dashboard/TransactionsView';
import type { Transaction } from './src/types';

type DocStore = Map<string, Map<string, Record<string, any>>>;

function cloneVal<T>(v: T): T {
  return v === undefined ? v : structuredClone(v);
}

class InMemoryDocRef {
  constructor(private store: DocStore, public readonly path: string) {}

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
    public readonly colPath: string,
    private filters: Array<{ field: string; op: string; value: any }> = [],
    private limitVal?: number
  ) {}

  doc(id: string): InMemoryDocRef {
    return new InMemoryDocRef(this.store, `${this.colPath}/${id}`);
  }

  where(field: string, op: string, value: any): InMemoryCollectionRef {
    return new InMemoryCollectionRef(
      this.store,
      this.colPath,
      [...this.filters, { field, op, value }],
      this.limitVal
    );
  }

  limit(n: number): InMemoryCollectionRef {
    return new InMemoryCollectionRef(this.store, this.colPath, this.filters, n);
  }

  async get() {
    const col = this.store.get(this.colPath) || new Map();
    let docs = Array.from(col.entries())
      .filter(([, raw]) => {
        return this.filters.every((f) => {
          const v = raw?.[f.field];
          if (f.op === '==') return v === f.value;
          if (f.op === 'in') return Array.isArray(f.value) && f.value.includes(v);
          return true;
        });
      })
      .map(([docId, raw]) => ({
        id: docId,
        exists: true,
        ref: this.doc(docId),
        data: () => cloneVal(raw),
      }));
    if (this.limitVal !== undefined) {
      docs = docs.slice(0, this.limitVal);
    }
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
      get: (refOrQuery: any) => refOrQuery.get(),
      set: (ref: InMemoryDocRef, data: Record<string, any>, opts?: { merge?: boolean }) =>
        ref.set(data, opts),
      create: (ref: InMemoryDocRef, data: Record<string, any>) => ref.set(data, { merge: false }),
      update: (ref: InMemoryDocRef, data: Record<string, any>) => ref.set(data, { merge: true }),
      delete: (ref: InMemoryDocRef) => ref.delete(),
    };
    return fn(tx);
  }
}

class InMemoryStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

async function runTests() {
  console.log('=== MONVERA PUSH NOTIFICATION REPAIR VERIFICATION SUITE (TESTS A-J) ===\n');

  // -------------------------------------------------------------------------
  // TEST A & J (Foreground): Foreground push creates visible notification UI
  // & deduplicates rapid duplicate deliveries
  // -------------------------------------------------------------------------
  {
    let incomingHandler: ((payload: any) => void) | null = null;
    const uiDelivered: any[] = [];
    const hiddenOsDelivered: Array<{ title: string; options?: NotificationOptions }> = [];

    const pushSvc = new PushNotificationService({
      getCurrentUid: () => 'uid_fg_1',
      getNotificationPermissionFn: () => 'granted',
      subscribeOnMessageFn: (handler) => {
        incomingHandler = handler;
        return () => {
          incomingHandler = null;
        };
      },
      displayNotificationFn: (title, options) => {
        hiddenOsDelivered.push({ title, options });
      },
    });

    const unsub = pushSvc.listenToForegroundMessages((rawPayload, normalized) => {
      uiDelivered.push({ rawPayload, normalized });
    });

    assert.ok(incomingHandler, 'Foreground listener should attach immediately');

    const sampleFcmForeground = {
      fcmMessageId: 'fcm_fg_msg_001',
      notification: {
        title: 'Account Debited',
        body: 'Your account has been debited $125.00 USD for Transfer to Jordan Lee (MVB •••• 4411). Ref: MV-TRF-FG01.',
      },
      data: {
        title: 'Account Debited',
        body: 'Your account has been debited $125.00 USD for Transfer to Jordan Lee (MVB •••• 4411). Ref: MV-TRF-FG01.',
        direction: 'DEBIT',
        amount: '125.00',
        currency: 'USD',
        transactionId: 'tx_fg_debit_001',
        referenceId: 'MV-TRF-FG01',
        actionView: 'transactions',
        url: '/dashboard?view=transactions&transactionId=tx_fg_debit_001&referenceId=MV-TRF-FG01',
        eventKey: 'tx_fg_debit_001:COMPLETED',
      },
    };

    // Visible tab: fires once -> visible UI banner queue receives rich Debit item AND OS notification fires
    const prevDocA = (globalThis as any).document;
    try {
      (globalThis as any).document = { hidden: false };
      incomingHandler!(sampleFcmForeground);
      assert.strictEqual(uiDelivered.length, 1);
      assert.strictEqual(uiDelivered[0].normalized.title, 'Account Debited');
      assert.strictEqual(uiDelivered[0].normalized.direction, 'DEBIT');
      assert.strictEqual(uiDelivered[0].normalized.actionView, 'transactions');
      assert.strictEqual(uiDelivered[0].normalized.transactionId, 'tx_fg_debit_001');
      assert.strictEqual(uiDelivered[0].normalized.referenceId, 'MV-TRF-FG01');
      assert.strictEqual(hiddenOsDelivered.length, 1, 'Visible foreground tab must also trigger OS notification when granted');

      // Duplicate replay within dedupe window -> MUST NOT create a second foreground alert or OS notification
      incomingHandler!(structuredClone(sampleFcmForeground));
      assert.strictEqual(uiDelivered.length, 1, 'Duplicate foreground FCM payload must be deduplicated');
      assert.strictEqual(hiddenOsDelivered.length, 1, 'Duplicate foreground FCM payload must not trigger duplicate OS notification');

      // Hidden tab simulation: when document.hidden === true, OS fallback also fires with Read More + full data
      (globalThis as any).document = { hidden: true };
      const creditPayload = {
        notification: {
          title: 'Account Credited',
          body: 'Your account has received $400.00 USD from Alice (MVB •••• 4411). Ref: MV-TRF-FG02.',
        },
        data: {
          direction: 'CREDIT',
          amount: '400.00',
          currency: 'USD',
          description: 'Incoming transfer from Alice',
          transactionId: 'tx_fg_credit_002',
          referenceId: 'MV-TRF-FG02',
          actionView: 'transactions',
          url: '/dashboard?view=transactions&transactionId=tx_fg_credit_002&referenceId=MV-TRF-FG02',
          eventKey: 'tx_fg_credit_002:COMPLETED',
        },
      };
      incomingHandler!(creditPayload);
      assert.strictEqual(uiDelivered.length, 2);
      assert.strictEqual(hiddenOsDelivered.length, 2);
      assert.strictEqual(hiddenOsDelivered[1].title, 'Account Credited');
      assert.strictEqual((hiddenOsDelivered[1].options as any)?.actions?.[0]?.action, 'read_more');
      assert.strictEqual((hiddenOsDelivered[1].options as any)?.actions?.[0]?.title, 'Read More');
      assert.strictEqual(
        hiddenOsDelivered[1].options?.data?.url,
        '/dashboard?view=transactions&transactionId=tx_fg_credit_002&referenceId=MV-TRF-FG02'
      );
      assert.strictEqual(hiddenOsDelivered[1].options?.data?.amount, '400.00');
      assert.strictEqual(hiddenOsDelivered[1].options?.data?.currency, 'USD');
      assert.strictEqual(hiddenOsDelivered[1].options?.data?.description, 'Incoming transfer from Alice');
    } finally {
      (globalThis as any).document = prevDocA;
    }

    unsub();
    console.log('✓ Tests A & J (Foreground): Visible & hidden foreground payload delivery, Read More options, metadata preservation, and dedupe verified');
  }

  // -------------------------------------------------------------------------
  // TEST B & G (Service Worker Source Structure & Behavior Check):
  // - notificationclick registered BEFORE getMessaging()
  // - single background OS render (no duplicate on FCM notification payload)
  // - Read More action & body click both support existing window navigate+postMessage AND cold-start openWindow
  // -------------------------------------------------------------------------
  {
    const swPath = path.resolve(process.cwd(), 'src/sw.ts');
    const swSource = fs.readFileSync(swPath, 'utf8');

    const notifClickIdx = swSource.indexOf("self.addEventListener('notificationclick'");
    const getMessagingIdx = swSource.indexOf('const messaging = getMessaging(firebaseApp)');
    assert.ok(notifClickIdx > 0, 'src/sw.ts must register notificationclick');
    assert.ok(getMessagingIdx > 0, 'src/sw.ts must initialize Firebase getMessaging');
    assert.ok(
      notifClickIdx < getMessagingIdx,
      'CRITICAL: src/sw.ts must register notificationclick BEFORE getMessaging() so Firebase SDK does not hijack clicks'
    );

    assert.ok(swSource.includes('event.stopImmediatePropagation()'));
    assert.ok(swSource.includes("action: 'read_more'"));
    assert.ok(swSource.includes("title: 'Read More'"));
    assert.ok(swSource.includes("type: 'MONVERA_PUSH_NAVIGATE'"));
    assert.ok(swSource.includes('preferredClient.navigate(fullUrl)'));
    assert.ok(swSource.includes('self.clients.openWindow(fullUrl)'));
    assert.ok(swSource.includes('if (payload?.notification) {\n    return;\n  }'));
    assert.ok(swSource.includes('if (payload.notification || payload.fcmMessageId || payload.data)'));

    // Also verify normalizePushPayload extracts FCM_MSG wrapped data identically to Firebase SW wrapInternalPayload
    const firebaseWrappedData = {
      FCM_MSG: {
        notification: {
          title: 'Account Credited',
          body: 'Your account has received $950.00 USD from Acme Corp (MVB •••• 1122). Ref: MV-DEP-99.',
        },
        data: {
          transactionId: 'tx_bg_99',
          referenceId: 'MV-DEP-99',
          direction: 'CREDIT',
          actionView: 'transactions',
          url: '/dashboard?view=transactions&transactionId=tx_bg_99&referenceId=MV-DEP-99',
        },
      },
    };
    const normalizedFromSwData = normalizePushPayload(firebaseWrappedData);
    assert.strictEqual(normalizedFromSwData.title, 'Account Credited');
    assert.strictEqual(normalizedFromSwData.transactionId, 'tx_bg_99');
    assert.strictEqual(normalizedFromSwData.referenceId, 'MV-DEP-99');
    assert.strictEqual(normalizedFromSwData.actionView, 'transactions');
    assert.strictEqual(
      normalizedFromSwData.url,
      '/dashboard?view=transactions&transactionId=tx_bg_99&referenceId=MV-DEP-99'
    );

    console.log('✓ Tests B & G (Service Worker): Listener precedence, zero duplicate OS notification guards, FCM_MSG extraction, Read More action & openWindow/navigate verified');
  }

  // -------------------------------------------------------------------------
  // TEST C & D: Debit & Credit message formatting, currency, description, safety
  // -------------------------------------------------------------------------
  {
    const debitContent = formatSafePushContent({
      transactionId: 'tx_debit_c1',
      referenceNumber: 'MV-DB-1001',
      eventKey: 'tx_debit_c1:COMPLETED',
      type: 'MONEY_SENT',
      userId: 'uid_sender',
      title: 'Transfer Sent — Monvera',
      amount: 1250.5,
      currency: 'USD',
      recipientName: 'Elena Vance',
      accountMasked: 'Checking (MVB •••• 4321)',
      actionUrl: '/dashboard?view=transactions',
    });
    assert.strictEqual(debitContent.title, 'Account Debited');
    assert.strictEqual(debitContent.direction, 'DEBIT');
    assert.strictEqual(
      debitContent.body,
      'Your account has been debited $1,250.50 USD for Transfer to Elena Vance (Checking (MVB •••• 4321)). Ref: MV-DB-1001.'
    );
    assert.strictEqual(
      debitContent.url,
      '/dashboard?view=transactions&transactionId=tx_debit_c1&referenceId=MV-DB-1001'
    );

    const creditContent = formatSafePushContent({
      transactionId: 'tx_credit_d1',
      referenceNumber: 'MV-CR-2002',
      eventKey: 'tx_credit_d1:COMPLETED',
      type: 'MONEY_RECEIVED',
      userId: 'uid_recip',
      title: 'Money Received — Monvera',
      amount: 2500,
      currency: 'USD',
      senderName: 'Marcus Sterling',
      accountMasked: 'Checking (MVB •••• 8765)',
      actionUrl: '/dashboard?view=transactions',
    });
    assert.strictEqual(creditContent.title, 'Account Credited');
    assert.strictEqual(creditContent.direction, 'CREDIT');
    assert.strictEqual(
      creditContent.body,
      'Your account has received $2,500.00 USD from Marcus Sterling (Checking (MVB •••• 8765)). Ref: MV-CR-2002.'
    );
    assert.strictEqual(
      creditContent.url,
      '/dashboard?view=transactions&transactionId=tx_credit_d1&referenceId=MV-CR-2002'
    );

    // Reversal credit must infer CREDIT even under dispatchType TRANSACTION
    const reversalContent = formatSafePushContent({
      transactionId: 'tx_wd_rev_1',
      referenceNumber: 'MV-WD-REV-1',
      eventKey: 'tx_wd_rev_1:REVERSED',
      lifecycleStage: 'REVERSED',
      type: 'TRANSACTION',
      userId: 'uid_wd',
      title: 'Transaction Was Reversed — Monvera',
      body: 'Transaction was reversed. Your withdrawal of $300.00 (Checking (MVB •••• 1111)) was credited back to your account.',
      amount: 300,
      currency: 'USD',
      actionUrl: '/dashboard?view=transactions',
    });
    assert.strictEqual(reversalContent.direction, 'CREDIT');

    // Trusted transfer dispatch helper inherits exact updated copy & deep links
    const trustedEvents = buildTrustedTransferDispatchEvents(
      {
        id: 'tx_c2c_trusted_1',
        referenceNumber: 'MV-TRF-9988',
        type: 'TRANSFER',
        status: 'COMPLETED',
        amount: 320,
        currency: 'USD',
        senderUserId: 'uid_s',
        senderName: 'Alice',
        senderAccountNumber: '1012345678',
        recipientUserId: 'uid_r',
        recipientName: 'Bob',
        recipientAccountNumber: '1098765432',
        fee: 0,
        category: 'Transfers',
        createdAt: new Date().toISOString(),
        description: 'Peer transfer',
      } as Transaction,
      false,
      { mode: 'MONVERA_C2C', authenticatedSenderUid: 'uid_s' }
    );
    assert.strictEqual(trustedEvents.length, 2);
    const recipFormatted = formatSafePushContent(trustedEvents[0]);
    const senderFormatted = formatSafePushContent(trustedEvents[1]);
    assert.strictEqual(recipFormatted.title, 'Account Credited');
    assert.ok(recipFormatted.body.includes('$320.00 USD'));
    assert.strictEqual(senderFormatted.title, 'Account Debited');
    assert.ok(senderFormatted.body.includes('$320.00 USD'));

    console.log('✓ Tests C & D: Debit & Credit copy, direction inference, currency, and safe deep-link URLs verified');
  }

  // -------------------------------------------------------------------------
  // TEST E & J (End-to-End C2C Transfer -> Outbox -> Dispatcher -> FCM Multicast):
  // - Sender receives Account Debited FCM payload with Read More & deep-link
  // - Recipient receives Account Credited FCM payload with Read More & deep-link
  // - Valid HTTPS fcmOptions check (omits invalid relative fcmOptions.link)
  // - Persistent dispatch deduplication prevents duplicate FCM delivery
  // -------------------------------------------------------------------------
  {
    const fsMem = new InMemoryFirestore();
    const senderUid = 'uid_c2c_sender_e';
    const recipientUid = 'uid_c2c_recip_e';
    const senderPan = '1044556677';
    const recipientPan = '1088990011';

    await fsMem.collection('users').doc(senderUid).set({
      id: senderUid,
      firstName: 'Diana',
      lastName: 'Prince',
      email: 'diana@monvera.test',
      permanentAccountNumber: senderPan,
      kycStatus: 'verified',
      dailyTransactionLimit: 1000000,
      status: 'active',
    });
    await fsMem.collection('users').doc(recipientUid).set({
      id: recipientUid,
      firstName: 'Arthur',
      lastName: 'Curry',
      email: 'arthur@monvera.test',
      permanentAccountNumber: recipientPan,
      kycStatus: 'verified',
      dailyTransactionLimit: 1000000,
      status: 'active',
    });
    await fsMem.collection('accounts').doc(senderUid).set({
      userId: senderUid,
      permanentAccountNumber: senderPan,
      checkingBalance: 5000,
      savingsBalance: 0,
      investedBalance: 0,
      accruedEarnings: 0,
      totalBalance: 5000,
      availableBalance: 5000,
      pendingBalance: 0,
      loanBalance: 0,
    });
    await fsMem.collection('accounts').doc(recipientUid).set({
      userId: recipientUid,
      permanentAccountNumber: recipientPan,
      checkingBalance: 1000,
      savingsBalance: 0,
      investedBalance: 0,
      accruedEarnings: 0,
      totalBalance: 1000,
      availableBalance: 1000,
      pendingBalance: 0,
      loanBalance: 0,
    });

    await registerCustomerPushToken(
      { uid: senderUid, token: 'fcm_sender_e_token_' + 'a'.repeat(40), platform: 'web' },
      fsMem as unknown as Firestore
    );
    await registerCustomerPushToken(
      { uid: recipientUid, token: 'fcm_recip_e_token_' + 'b'.repeat(40), platform: 'web' },
      fsMem as unknown as Firestore
    );

    const txRes = await executeServerTransfer(
      {
        senderUid,
        recipientIdentifier: recipientPan,
        amount: 640,
        description: 'Invoice #882',
        referenceNumber: 'MV-TRF-E1-882',
      },
      {
        firestore: fsMem as unknown as Firestore,
        isAdminConfigured: () => true,
      }
    );
    assert.strictEqual(txRes.success, true, `executeServerTransfer failed: ${txRes.error}`);
    const txId = txRes.transaction!.id;
    const txRef = txRes.transaction!.referenceNumber;

    const capturedMulticasts: any[] = [];
    const mockMessaging: Partial<Messaging> = {
      sendEachForMulticast: async (msg: any) => {
        capturedMulticasts.push(structuredClone(msg));
        return {
          successCount: msg.tokens.length,
          failureCount: 0,
          responses: msg.tokens.map((_: string, i: number) => ({
            success: true,
            messageId: `fcm_e_${capturedMulticasts.length}_${i}`,
          })),
        };
      },
    };

    const dispatcher = new ServerNotificationDispatcher({
      firestore: fsMem as unknown as Firestore,
      messaging: mockMessaging as Messaging,
      isAdminConfigured: () => true,
      isMessagingConfigured: () => true,
      instanceId: 'worker_push_repair_e',
    });

    const senderOutboxId = computeNotificationOutboxId(senderUid, `${txId}:COMPLETED`, 'MONEY_SENT');
    const recipOutboxId = computeNotificationOutboxId(recipientUid, `${txId}:COMPLETED`, 'MONEY_RECEIVED');

    for (const outboxId of [senderOutboxId, recipOutboxId]) {
      const claim = await claimOutboxLease(fsMem as unknown as Firestore, outboxId, 'w_e');
      assert.strictEqual(claim.claimed, true);
      const evt = buildDispatchEventFromOutboxRecord(claim.record!);
      const res = await dispatcher.dispatch(evt, buildOutboxDispatchOptions(claim.record!, claim.leaseToken!));
      assert.strictEqual(res.push.status, 'SENT');
      const logSnap = await fetchDispatchLogForOutboxRecord(fsMem as unknown as Firestore, claim.record!);
      const outcome = evaluateOutboxAttemptOutcome({
        outboxRecord: claim.record!,
        dispatchResult: res,
        persistentLog: logSnap,
      });
      await transitionOutboxAsLeaseOwner(fsMem as unknown as Firestore, outboxId, claim.leaseToken!, () => ({
        status: outcome.nextStatus!,
        pushStatus: outcome.pushStatus,
        smsStatus: outcome.smsStatus,
        emailStatus: outcome.emailStatus,
        failureClassification: outcome.failureClassification,
        lastError: outcome.lastError,
        dispatchedAt: outcome.dispatchedAt,
      }));
    }

    assert.strictEqual(capturedMulticasts.length, 2);

    const senderPush = capturedMulticasts[0];
    assert.strictEqual(senderPush.notification.title, 'Account Debited');
    assert.ok(senderPush.notification.body.includes('$640.00 USD'));
    assert.ok(senderPush.notification.body.includes('Transfer to Arthur Curry'));
    assert.strictEqual(senderPush.data.direction, 'DEBIT');
    assert.strictEqual(senderPush.data.transactionId, txId);
    assert.strictEqual(senderPush.data.referenceId, txRef);
    assert.strictEqual(senderPush.data.actionView, 'transactions');
    assert.strictEqual(
      senderPush.data.url,
      `/dashboard?view=transactions&transactionId=${txId}&referenceId=${txRef}`
    );
    assert.deepStrictEqual(senderPush.webpush.notification.actions, [
      { action: 'read_more', title: 'Read More' },
    ]);
    if (senderPush.webpush.fcmOptions) {
      assert.ok(
        String(senderPush.webpush.fcmOptions.link).startsWith('https://'),
        'webpush.fcmOptions.link must always be HTTPS when present'
      );
    }

    const recipPush = capturedMulticasts[1];
    assert.strictEqual(recipPush.notification.title, 'Account Credited');
    assert.ok(recipPush.notification.body.includes('$640.00 USD'));
    assert.ok(recipPush.notification.body.includes('from Diana Prince'));
    assert.strictEqual(recipPush.data.direction, 'CREDIT');
    assert.strictEqual(recipPush.data.transactionId, txId);
    assert.strictEqual(recipPush.data.referenceId, txRef);
    assert.strictEqual(recipPush.data.actionView, 'transactions');
    assert.strictEqual(
      recipPush.data.url,
      `/dashboard?view=transactions&transactionId=${txId}&referenceId=${txRef}`
    );
    assert.deepStrictEqual(recipPush.webpush.notification.actions, [
      { action: 'read_more', title: 'Read More' },
    ]);

    // Verify PUBLIC_APP_URL with https:// produces valid HTTPS fcmOptions.link AND unset origin omits invalid relative link
    const prevEnv = {
      PUBLIC_APP_URL: process.env.PUBLIC_APP_URL,
      FRONTEND_URL: process.env.FRONTEND_URL,
      APP_URL: process.env.APP_URL,
      VITE_APP_URL: process.env.VITE_APP_URL,
    };
    try {
      delete process.env.PUBLIC_APP_URL;
      delete process.env.FRONTEND_URL;
      delete process.env.APP_URL;
      delete process.env.VITE_APP_URL;
      await dispatcher.dispatch({
        transactionId: 'tx_no_origin_link_test',
        referenceNumber: 'MV-NOORIG-1',
        type: 'MONEY_RECEIVED',
        userId: recipientUid,
        amount: 25,
        currency: 'USD',
        senderName: 'Treasury',
        accountMasked: 'Checking (MVB •••• 0011)',
      });
      assert.strictEqual(
        capturedMulticasts[2].webpush.fcmOptions,
        undefined,
        'Relative URL must never be sent in webpush.fcmOptions.link when HTTPS origin is absent'
      );

      process.env.PUBLIC_APP_URL = 'https://app.monvera.com';
      await dispatcher.dispatch({
        transactionId: 'tx_https_link_test',
        referenceNumber: 'MV-HTTPS-1',
        type: 'MONEY_RECEIVED',
        userId: recipientUid,
        amount: 50,
        currency: 'USD',
        senderName: 'Treasury',
        accountMasked: 'Checking (MVB •••• 0011)',
      });
      assert.strictEqual(
        capturedMulticasts[3].webpush.fcmOptions.link,
        'https://app.monvera.com/dashboard?view=transactions&transactionId=tx_https_link_test&referenceId=MV-HTTPS-1'
      );
    } finally {
      for (const [k, v] of Object.entries(prevEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }

    // Re-claiming already-DISPATCHED sender outbox doc fails cleanly -> zero duplicate push
    const dupClaim = await claimOutboxLease(fsMem as unknown as Firestore, senderOutboxId, 'w_e_dup');
    assert.strictEqual(dupClaim.claimed, false);
    assert.strictEqual(dupClaim.reason, 'ALREADY_TERMINAL');

    console.log('✓ Tests E & J (Backend C2C): Sender debit & recipient credit FCM payloads, Read More actions, HTTPS-only fcmOptions, and outbox terminal dedupe verified');
  }

  // -------------------------------------------------------------------------
  // TESTS F, G (App Deep-Link), H (Auth & Ownership Enforcement):
  // -------------------------------------------------------------------------
  {
    const storage = new InMemoryStorage();

    // Test F: Read More target resolution from normalized push payload
    const normalized = normalizePushPayload({
      data: {
        title: 'Account Debited',
        body: 'Your account has been debited $100.00 USD.',
        direction: 'DEBIT',
        transactionId: 'tx_owned_user_a',
        referenceId: 'MV-OWN-A1',
        actionView: 'transactions',
        url: '/dashboard?view=transactions&transactionId=tx_owned_user_a&referenceId=MV-OWN-A1',
      },
    });
    const navTarget = buildNotificationNavTargetFromNormalized(normalized);
    assert.strictEqual(navTarget.actionView, 'transactions');
    assert.strictEqual(navTarget.actionRecordId, 'tx_owned_user_a');
    assert.strictEqual(navTarget.referenceNumber, 'MV-OWN-A1');

    // Test G (Cold start URL parsing + pending storage persistence across login)
    const coldParsed = parseNotificationDeepLinkFromUrl(
      '/dashboard',
      '?view=transactions&transactionId=tx_owned_user_a&referenceId=MV-OWN-A1'
    );
    assert.ok(coldParsed);
    assert.strictEqual(coldParsed!.actionView, 'transactions');
    assert.strictEqual(coldParsed!.actionRecordId, 'tx_owned_user_a');
    assert.strictEqual(coldParsed!.referenceNumber, 'MV-OWN-A1');

    // Public root path without view/transaction query does NOT hijack landing page
    assert.strictEqual(parseNotificationDeepLinkFromUrl('/', ''), null);

    // Malicious view injection falls back safely to 'transactions' (never 'admin')
    const injectedView = parseNotificationDeepLinkFromUrl('/dashboard', '?view=admin&transactionId=tx_1');
    assert.strictEqual(injectedView?.actionView, 'transactions');

    // Pending target persists in sessionStorage during login and clears cleanly after consumption
    savePendingNotificationNavTarget(coldParsed!, storage);
    const restoredPending = readPendingNotificationNavTarget(storage);
    assert.strictEqual(restoredPending?.actionView, 'transactions');
    assert.strictEqual(restoredPending?.actionRecordId, 'tx_owned_user_a');
    clearPendingNotificationNavTarget(storage);
    assert.strictEqual(readPendingNotificationNavTarget(storage), null);

    // Test H: Transaction ownership enforcement
    const userATx: Transaction = {
      id: 'tx_owned_user_a',
      referenceNumber: 'MV-OWN-A1',
      type: 'TRANSFER',
      status: 'COMPLETED',
      amount: 100,
      currency: 'USD',
      userId: 'uid_alice',
      senderUserId: 'uid_alice',
      recipientUserId: 'uid_bob',
      fee: 0,
      category: 'Transfers',
      createdAt: new Date().toISOString(),
      description: 'Owned transfer',
    };
    const foreignTx: Transaction = {
      id: 'tx_foreign_charlie',
      referenceNumber: 'MV-FOR-C1',
      type: 'TRANSFER',
      status: 'COMPLETED',
      amount: 9999,
      currency: 'USD',
      userId: 'uid_charlie',
      senderUserId: 'uid_charlie',
      recipientUserId: 'uid_dave',
      fee: 0,
      category: 'Transfers',
      createdAt: new Date().toISOString(),
      description: 'Foreign transfer',
    };

    const allowedMatch = resolveAuthorizedTransactionForDeepLink({
      transactions: [userATx, foreignTx],
      refOrId: 'MV-OWN-A1',
      effectiveUid: 'uid_alice',
      userId: 'uid_alice',
    });
    assert.strictEqual(allowedMatch?.id, 'tx_owned_user_a');

    // Recipient (Bob) also owns the incoming transfer leg
    const recipMatch = resolveAuthorizedTransactionForDeepLink({
      transactions: [userATx],
      refOrId: 'tx_owned_user_a',
      effectiveUid: 'uid_bob',
      userId: 'uid_bob',
    });
    assert.strictEqual(recipMatch?.id, 'tx_owned_user_a');

    // Unrelated user (Eve) MUST NOT resolve Alice's or Charlie's transaction even if ID is supplied
    const unauthorizedMatch = resolveAuthorizedTransactionForDeepLink({
      transactions: [userATx, foreignTx],
      refOrId: 'MV-FOR-C1',
      effectiveUid: 'uid_alice',
      userId: 'uid_alice',
    });
    assert.strictEqual(unauthorizedMatch, null, 'Foreign transaction must NEVER resolve for another user');

    const unauthNull = resolveAuthorizedTransactionForDeepLink({
      transactions: [userATx],
      refOrId: 'MV-OWN-A1',
      effectiveUid: null,
      userId: null,
    });
    assert.strictEqual(unauthNull, null, 'Unauthenticated user must NEVER resolve any transaction');

    // Verify PushNotificationDeduplicator bounded window
    const dedup = new PushNotificationDeduplicator(5000, 2);
    assert.strictEqual(dedup.shouldAccept('k1', 1000), true);
    assert.strictEqual(dedup.shouldAccept('k1', 2000), false);
    assert.strictEqual(dedup.shouldAccept('k1', 7000), true);

    console.log('✓ Tests F, G & H: Read More navigation, cold-start URL & login persistence, safe view sanitization, and transaction ownership verified');
  }

  // -------------------------------------------------------------------------
  // TEST I: Existing in-app notification persistence remains completely intact
  // -------------------------------------------------------------------------
  {
    const { db: memDb } = await import('./server/db');
    const persisted = await persistCustomerNotification({
      id: 'notif_inapp_preserved_1',
      userId: 'uid_alice',
      title: 'Peer Transfer Sent',
      message: 'You sent $50.00 to Bob.',
      type: 'TRANSACTION',
      severity: 'info',
      referenceId: 'MV-INAPP-1',
      actionView: 'transactions',
      actionRecordId: 'tx_inapp_1',
    });
    assert.ok(persisted);
    assert.strictEqual(persisted!.id, 'notif_inapp_preserved_1');
    assert.strictEqual(persisted!.read, false);
    const inMemRecord = memDb.notifications.find((n) => n.id === 'notif_inapp_preserved_1');
    assert.ok(inMemRecord);
    assert.strictEqual(inMemRecord?.title, 'Peer Transfer Sent');
    assert.strictEqual(inMemRecord?.actionView, 'transactions');
    assert.strictEqual(inMemRecord?.actionRecordId, 'tx_inapp_1');
    // Clean up test entry from singleton db.notifications
    const idx = memDb.notifications.findIndex((n) => n.id === 'notif_inapp_preserved_1');
    if (idx >= 0) memDb.notifications.splice(idx, 1);
    console.log('✓ Test I: Existing in-app notification persistence works unchanged');
  }

  // -------------------------------------------------------------------------
  // TEST K: Visible Foreground OS Notification via Active ServiceWorkerRegistration.showNotification
  // (Android Chrome / Installed PWA simulation when Monvera is OPEN and VISIBLE)
  // -------------------------------------------------------------------------
  {
    const prevDoc = (globalThis as any).document;
    const prevWindow = (globalThis as any).window;
    const prevNotification = (globalThis as any).Notification;
    const sharedStorage = new InMemoryStorage();

    try {
      (globalThis as any).document = { hidden: false };
      (globalThis as any).window = { localStorage: sharedStorage };
      // Simulate Android Chrome where `new Notification(...)` throws Illegal constructor
      (globalThis as any).Notification = function ForbiddenAndroidWindowNotification() {
        throw new TypeError("Illegal constructor: use ServiceWorkerRegistration.showNotification");
      };

      const swCalls: Array<{ title: string; options: any }> = [];
      const mockSwRegistration = {
        active: { state: 'activated', scriptURL: 'https://monvera.test/sw.js' },
        showNotification: async (title: string, options?: NotificationOptions) => {
          swCalls.push({ title, options });
        },
      } as unknown as ServiceWorkerRegistration;

      let tab1Handler: ((payload: any) => void) | null = null;
      let tab2Handler: ((payload: any) => void) | null = null;
      const tab1Banners: any[] = [];
      const tab2Banners: any[] = [];

      const svcTab1 = new PushNotificationService({
        getCurrentUid: () => 'uid_pwa_1',
        getNotificationPermissionFn: () => 'granted',
        ensureActiveSwFn: async () => mockSwRegistration,
        subscribeOnMessageFn: (h) => {
          tab1Handler = h;
          return () => {
            tab1Handler = null;
          };
        },
      });

      const svcTab2 = new PushNotificationService({
        getCurrentUid: () => 'uid_pwa_1',
        getNotificationPermissionFn: () => 'granted',
        ensureActiveSwFn: async () => mockSwRegistration,
        subscribeOnMessageFn: (h) => {
          tab2Handler = h;
          return () => {
            tab2Handler = null;
          };
        },
      });

      const unsub1 = svcTab1.listenToForegroundMessages((_raw, norm) => tab1Banners.push(norm));
      const unsub2 = svcTab2.listenToForegroundMessages((_raw, norm) => tab2Banners.push(norm));

      const debitPush = {
        fcmMessageId: 'fcm_pwa_debit_01',
        notification: {
          title: 'Account Debited',
          body: 'Your account has been debited $840.25 USD for Transfer to Noah Vance (MVB •••• 7788). Ref: MV-FG-SW-1.',
        },
        data: {
          title: 'Account Debited',
          body: 'Your account has been debited $840.25 USD for Transfer to Noah Vance (MVB •••• 7788). Ref: MV-FG-SW-1.',
          direction: 'DEBIT',
          amount: '840.25',
          currency: 'USD',
          description: 'Transfer to Noah Vance',
          transactionId: 'tx_pwa_debit_01',
          referenceId: 'MV-FG-SW-1',
          actionView: 'transactions',
          url: '/dashboard?view=transactions&transactionId=tx_pwa_debit_01&referenceId=MV-FG-SW-1',
          eventKey: 'tx_pwa_debit_01:COMPLETED',
        },
      };

      // Broadcast same FCM message to both open visible windows
      tab1Handler!(debitPush);
      tab2Handler!(structuredClone(debitPush));
      // Allow microtask queue to flush async ensureActiveSwFn -> sw.showNotification
      await new Promise((r) => setTimeout(r, 15));

      assert.strictEqual(tab1Banners.length, 1);
      assert.strictEqual(tab2Banners.length, 1);
      assert.strictEqual(
        swCalls.length,
        1,
        'Visible foreground push across open tabs must invoke ServiceWorkerRegistration.showNotification exactly once'
      );

      const shown = swCalls[0];
      assert.strictEqual(shown.title, 'Account Debited');
      assert.ok(shown.options.body.includes('$840.25 USD'));
      assert.strictEqual(shown.options.icon, '/pwa-192x192.png');
      assert.strictEqual(shown.options.badge, '/pwa-192x192.png');
      assert.strictEqual(shown.options.renotify, false);
      assert.strictEqual(shown.options.actions[0].action, 'read_more');
      assert.strictEqual(shown.options.actions[0].title, 'Read More');
      assert.strictEqual(shown.options.data.amount, '840.25');
      assert.strictEqual(shown.options.data.currency, 'USD');
      assert.strictEqual(shown.options.data.direction, 'DEBIT');
      assert.strictEqual(shown.options.data.description, 'Transfer to Noah Vance');
      assert.strictEqual(shown.options.data.referenceId, 'MV-FG-SW-1');
      assert.strictEqual(shown.options.data.transactionId, 'tx_pwa_debit_01');
      assert.strictEqual(
        shown.options.data.url,
        '/dashboard?view=transactions&transactionId=tx_pwa_debit_01&referenceId=MV-FG-SW-1'
      );

      // Duplicate replay in Tab 1 must produce neither duplicate toast nor duplicate OS notification
      tab1Handler!(structuredClone(debitPush));
      await new Promise((r) => setTimeout(r, 15));
      assert.strictEqual(tab1Banners.length, 1);
      assert.strictEqual(swCalls.length, 1);

      // Distinct Credit push in visible foreground must display via SW showNotification
      const creditPush = {
        fcmMessageId: 'fcm_pwa_credit_02',
        notification: {
          title: 'Account Credited',
          body: 'Your account has received $1,950.00 USD from Maya Lin (MVB •••• 7788). Ref: MV-FG-SW-2.',
        },
        data: {
          direction: 'CREDIT',
          amount: '1950.00',
          currency: 'USD',
          description: 'Incoming transfer from Maya Lin',
          transactionId: 'tx_pwa_credit_02',
          referenceId: 'MV-FG-SW-2',
          actionView: 'transactions',
          url: '/dashboard?view=transactions&transactionId=tx_pwa_credit_02&referenceId=MV-FG-SW-2',
          eventKey: 'tx_pwa_credit_02:COMPLETED',
        },
      };
      tab1Handler!(creditPush);
      await new Promise((r) => setTimeout(r, 15));
      assert.strictEqual(swCalls.length, 2);
      assert.strictEqual(swCalls[1].title, 'Account Credited');
      assert.strictEqual(swCalls[1].options.data.direction, 'CREDIT');
      assert.strictEqual(swCalls[1].options.data.amount, '1950.00');
      assert.strictEqual(swCalls[1].options.data.currency, 'USD');
      assert.strictEqual(swCalls[1].options.data.description, 'Incoming transfer from Maya Lin');

      // Click/Read More round-trip from foreground SW OS notification data -> exact transaction resolution
      const clickedNormalized = normalizePushPayload(swCalls[1].options.data);
      const clickedNav = buildNotificationNavTargetFromNormalized(clickedNormalized);
      assert.strictEqual(clickedNormalized.amount, '1950.00');
      assert.strictEqual(clickedNormalized.currency, 'USD');
      assert.strictEqual(clickedNormalized.direction, 'CREDIT');
      assert.strictEqual(clickedNormalized.description, 'Incoming transfer from Maya Lin');
      assert.strictEqual(clickedNav.actionView, 'transactions');
      assert.strictEqual(clickedNav.actionRecordId, 'tx_pwa_credit_02');
      assert.strictEqual(clickedNav.referenceNumber, 'MV-FG-SW-2');

      const ownedCreditTx: Transaction = {
        id: 'tx_pwa_credit_02',
        referenceNumber: 'MV-FG-SW-2',
        type: 'TRANSFER',
        status: 'COMPLETED',
        amount: 1950,
        currency: 'USD',
        userId: 'uid_pwa_1',
        recipientUserId: 'uid_pwa_1',
        senderUserId: 'uid_maya',
        fee: 0,
        category: 'Transfers',
        createdAt: new Date().toISOString(),
        description: 'Incoming transfer from Maya Lin',
      };
      const resolvedTx = resolveAuthorizedTransactionForDeepLink({
        transactions: [ownedCreditTx],
        refOrId: clickedNav.actionRecordId,
        effectiveUid: 'uid_pwa_1',
        userId: 'uid_pwa_1',
      });
      assert.strictEqual(resolvedTx?.id, 'tx_pwa_credit_02');

      // Permission === 'denied' or 'default' -> toast callback fires, SW showNotification MUST NOT fire
      let deniedHandler: ((p: any) => void) | null = null;
      const deniedBanners: any[] = [];
      const deniedSvc = new PushNotificationService({
        getCurrentUid: () => 'uid_pwa_1',
        getNotificationPermissionFn: () => 'denied',
        ensureActiveSwFn: async () => mockSwRegistration,
        subscribeOnMessageFn: (h) => {
          deniedHandler = h;
          return () => {};
        },
      });
      const unsubDenied = deniedSvc.listenToForegroundMessages((_raw, norm) => deniedBanners.push(norm));
      deniedHandler!({
        notification: { title: 'Account Debited', body: 'Test $10.00 USD' },
        data: { transactionId: 'tx_perm_denied', direction: 'DEBIT' },
      });
      await new Promise((r) => setTimeout(r, 15));
      assert.strictEqual(deniedBanners.length, 1);
      assert.strictEqual(swCalls.length, 2, 'OS notification must not display when browser permission is not granted');

      unsubDenied();
      unsub1();
      unsub2();
      console.log('✓ Test K (Visible Foreground SW OS Display): ServiceWorkerRegistration.showNotification, metadata preservation, cross-tab dedupe, permission guard, and click navigation verified');
    } finally {
      (globalThis as any).document = prevDoc;
      (globalThis as any).window = prevWindow;
      (globalThis as any).Notification = prevNotification;
    }
  }

  console.log('\nALL PUSH NOTIFICATION REPAIR TESTS (A–K) PASSED SUCCESSFULLY.');
}

runTests().catch((err) => {
  console.error('❌ Push repair verification failed:', err);
  process.exit(1);
});
