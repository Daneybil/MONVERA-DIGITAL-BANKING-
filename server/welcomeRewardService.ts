import type { Firestore } from 'firebase-admin/firestore';
import { adminFirestore, isFirebaseAdminConfigured } from './firebaseAdmin';
import { db } from './db';
import { Transaction, WelcomeRewardInfo, WelcomeRewardStatus, BankAccount, BalanceMetrics } from '../src/types';
import { persistCustomerNotification, maskAccountNumber } from './services/notificationStore';
import {
  prepareNotificationOutboxBatch,
  writePreparedNotificationOutboxBatchInTransaction,
  type WrittenOutboxBatchResult,
} from './services/notificationOutbox';

export const WELCOME_REWARD_TARGET = 10000.0; // $10,000.00 in qualifying deposits
export const WELCOME_REWARD_AMOUNT = 1000.0; // $1,000.00 one-time welcome reward

export interface WelcomeRewardDeps {
  firestore?: Firestore;
  isAdminConfigured?: () => boolean;
  persistNotification?: typeof persistCustomerNotification;
}

function reportOutboxPreparationIssues(
  context: string,
  txId: string,
  outboxWrite: WrittenOutboxBatchResult | null
): void {
  if (!outboxWrite || outboxWrite.invalidItems.length === 0) return;
  console.warn(
    `[Outbox][${context}] Skipped ${outboxWrite.invalidItems.length} invalid outbox item(s) for transaction ${txId}:`,
    JSON.stringify(
      outboxWrite.invalidItems.map((item) => ({
        userId: item.userId,
        eventKey: item.eventKey,
        dispatchType: item.dispatchType,
        error: item.error,
      }))
    )
  );
}

function formatSafeOutboxAccountLabel(accountNumber?: string | null, label?: string | null): string {
  const masked = maskAccountNumber(accountNumber);
  const cleanLabel = typeof label === 'string' ? label.trim().slice(0, 36) : '';
  return cleanLabel ? `${cleanLabel} (${masked})` : masked;
}

/**
 * Builds standard 2-account BankAccount structure if not present on account document
 */
function buildDefaultAccounts(userId: string, checking: number, savings: number, invested = 0, userAcc = '1000000000'): BankAccount[] {
  return [
    {
      id: `acc_chk_${userId}`,
      userId,
      type: 'CHECKING',
      accountNumber: userAcc,
      routingNumber: '021000021',
      currency: 'USD',
      balance: checking,
      availableBalance: checking,
      investedBalance: 0,
      pendingBalance: 0,
      interestRateAPY: 1.25,
      status: 'ACTIVE',
      nickname: 'Monvera Premier Checking',
    },
    {
      id: `acc_sav_${userId}`,
      userId,
      type: 'SAVINGS',
      accountNumber: userAcc.length >= 7 ? `10${userAcc.slice(2, -3)}991` : '1000000991',
      routingNumber: '021000021',
      currency: 'USD',
      balance: savings,
      availableBalance: savings,
      investedBalance: 0,
      pendingBalance: 0,
      interestRateAPY: 4.85,
      status: 'ACTIVE',
      nickname: 'Monvera High-Yield Treasury',
    },
  ];
}

interface AggregatedDepositsResult {
  qualifyingSum: number;
  eligibleDepositRefs: Set<string>;
}

function isLoanDisbursementTransaction(docId: string, tx: Record<string, any>): boolean {
  const effectiveId = String(tx.id || docId || '').trim();
  const ref = String(tx.referenceNumber || '').trim();
  const senderAcc = String(tx.senderAccountNumber || '').trim();
  const senderName = String(tx.senderName || '').trim();
  const desc = String(tx.description || '').trim();
  const meta = tx.metadata && typeof tx.metadata === 'object' ? tx.metadata : {};

  if (effectiveId.startsWith('tx_loan_disb_')) return true;
  if (ref.startsWith('MVB-LN-')) return true;
  if (senderAcc === 'MVB-LN-001') return true;
  if (senderName === 'Monvera Credit & Lending Facility') return true;
  if (/^(?:Approved Commercial Loan Disbursement|Monvera Approved Loan Credit Disbursement)\b/i.test(desc)) {
    return true;
  }
  if (
    meta.isLoanDisbursement === true ||
    meta.transactionType === 'LOAN_DISBURSEMENT' ||
    meta.disbursementType === 'LOAN_DISBURSEMENT' ||
    Boolean(meta.loanId)
  ) {
    return true;
  }
  return false;
}

function aggregateQualifyingUsdDeposits(
  entries: Iterable<{ id: string; data: Record<string, any> }>
): AggregatedDepositsResult {
  let qualifyingSum = 0;
  const eligibleDepositRefs = new Set<string>();
  const seenPaymentRefs = new Set<string>();

  for (const { id: docId, data: tx } of entries) {
    if (!tx || typeof tx !== 'object') continue;
    if (tx.type !== 'DEPOSIT' || tx.status !== 'COMPLETED') continue;

    const amt = Number(tx.amount ?? 0);
    const ref = tx.referenceNumber || docId;
    const provRef = tx.paymentProviderRef || tx.metadata?.stripeSessionId || '';
    const meta = tx.metadata || {};

    // Strict exclusions:
    // - Positive amounts only
    // - No reversed deposits (status REVERSED or metadata.isReversed === true)
    // - USD deposits only
    // - No reward credits / transfers / withdrawals
    // - No loan disbursements (including transactions recorded with type: 'DEPOSIT')
    if (!Number.isFinite(amt) || amt <= 0) continue;
    if (meta.isReversed === true || tx.status === 'REVERSED') continue;
    if (tx.currency && String(tx.currency).trim().toUpperCase() !== 'USD') continue;
    if (tx.category === 'Rewards' || tx.type === 'WELCOME_REWARD') continue;
    if (isLoanDisbursementTransaction(docId, tx)) continue;

    // Deduplication check
    if (provRef && seenPaymentRefs.has(provRef)) continue;
    if (seenPaymentRefs.has(ref)) continue;

    if (provRef) seenPaymentRefs.add(provRef);
    seenPaymentRefs.add(ref);
    eligibleDepositRefs.add(ref);
    qualifyingSum += amt;
  }

  return {
    qualifyingSum: Number(qualifyingSum.toFixed(2)),
    eligibleDepositRefs,
  };
}

/**
 * Evaluates a customer's verified, completed deposits against the $10,000 Welcome Reward threshold.
 * If the threshold is satisfied and the reward has not been paid, atomically credits $1,000
 * directly to the user's Monvera account ledger with strict idempotency protection.
 */
export async function evaluateAndProcessWelcomeReward(
  userId: string,
  deps?: WelcomeRewardDeps
): Promise<WelcomeRewardInfo> {
  if (!userId) {
    throw new Error('Valid user ID is required to evaluate Welcome Reward.');
  }

  const adminConfigured = deps?.isAdminConfigured
    ? deps.isAdminConfigured()
    : Boolean(deps?.firestore) || isFirebaseAdminConfigured();
  const fs = deps?.firestore || (adminConfigured ? adminFirestore : null);

  const rewardDocRef = adminConfigured && fs
    ? fs.collection('welcome_rewards').doc(userId)
    : null;

  // 1. Fetch user profile for fallback metadata & account number
  let customerName = 'Monvera Customer';
  let permanentAccountNumber = '1000000000';
  let registrationDate = new Date().toISOString();

  if (adminConfigured && fs) {
    try {
      const uSnap = await fs.collection('users').doc(userId).get();
      if (uSnap.exists) {
        const ud = uSnap.data()!;
        customerName = `${ud.firstName || ''} ${ud.lastName || ''}`.trim() || ud.username || customerName;
        permanentAccountNumber = ud.permanentAccountNumber || ud.accountNumber || permanentAccountNumber;
        registrationDate = ud.createdAt || registrationDate;
      }
    } catch (e) {
      console.warn(`[WelcomeReward] Error reading user ${userId}:`, e);
    }
  } else {
    const memUser = db.users.get(userId);
    if (memUser) {
      customerName = `${memUser.firstName} ${memUser.lastName}`.trim() || memUser.username || customerName;
      permanentAccountNumber = memUser.permanentAccountNumber || permanentAccountNumber;
      registrationDate = memUser.createdAt || registrationDate;
    }
  }

  // 2. Fast-path terminal check: PAID state never regresses
  if (rewardDocRef) {
    try {
      const existingRewardSnap = await rewardDocRef.get();
      if (existingRewardSnap.exists) {
        const rData = existingRewardSnap.data() as WelcomeRewardInfo;
        if (rData.status === 'PAID') {
          const paidRecord: WelcomeRewardInfo = {
            ...rData,
            customerName: rData.customerName || customerName,
            permanentAccountNumber: rData.permanentAccountNumber || permanentAccountNumber,
            registrationDate: rData.registrationDate || registrationDate,
          };
          syncRewardToMemoryDb(paidRecord);
          return paidRecord;
        }
      }
    } catch (e) {
      console.warn(`[WelcomeReward] Error reading reward record for ${userId}:`, e);
    }
  }

  const idempotencyKey = `MV-RWD-WELCOME-${userId}`;
  const rewardTxId = `tx_rwd_welcome_${userId}`;

  // 3. Authoritative Firestore execution path:
  //    Revalidate qualifying deposits, existing PAID state, ledger recovery, account credit,
  //    IN_PROGRESS status updates, and outbox creation inside one atomic Firestore transaction
  //    with strict read-before-write ordering and zero in-memory fallback contamination.
  if (adminConfigured && fs && rewardDocRef) {
    const userRef = fs.collection('users').doc(userId);
    const accRef = fs.collection('accounts').doc(userId);
    const rewardTxRef = fs.collection('transactions').doc(rewardTxId);
    const existingTxQuery = fs
      .collection('transactions')
      .where('referenceNumber', '==', idempotencyKey)
      .limit(1);
    const txQueryA = fs
      .collection('transactions')
      .where('userId', '==', userId)
      .where('type', '==', 'DEPOSIT')
      .where('status', '==', 'COMPLETED');
    const txQueryB = fs
      .collection('transactions')
      .where('recipientUserId', '==', userId)
      .where('type', '==', 'DEPOSIT')
      .where('status', '==', 'COMPLETED');

    // Attempt-scoped closure state (reset at the start of every Firestore retry)
    let outboxWriteResult: WrittenOutboxBatchResult | null = null;
    let attemptQualifyingSum = 0;
    let attemptEligibleCount = 0;
    let attemptWasEligible = false;
    let attemptNowIso = new Date().toISOString();

    try {
      const txOutcome = await fs.runTransaction(async (transaction) => {
        outboxWriteResult = null;
        attemptQualifyingSum = 0;
        attemptEligibleCount = 0;
        attemptWasEligible = false;
        attemptNowIso = new Date().toISOString();
        const nowIso = attemptNowIso;

        // READ PHASE (ALL tx.get calls strictly precede ALL tx.set calls)
        const [rewardSnap, existingTxSnap, rewardTxSnap, userSnap, txQueryASnap, txQueryBSnap] =
          await Promise.all([
            transaction.get(rewardDocRef),
            transaction.get(existingTxQuery),
            transaction.get(rewardTxRef),
            transaction.get(userRef),
            transaction.get(txQueryA),
            transaction.get(txQueryB),
          ]);

        let txCustomerName = customerName;
        let txPan = permanentAccountNumber;
        let txRegistrationDate = registrationDate;
        if (userSnap.exists) {
          const ud = userSnap.data()!;
          txCustomerName = `${ud.firstName || ''} ${ud.lastName || ''}`.trim() || ud.username || txCustomerName;
          txPan = ud.permanentAccountNumber || ud.accountNumber || txPan;
          txRegistrationDate = ud.createdAt || txRegistrationDate;
        }

        // Recompute authoritative USD completed deposits strictly from Firestore snapshots
        const combinedDocs = new Map<string, { id: string; data: Record<string, any> }>();
        txQueryASnap.docs.forEach((d) => combinedDocs.set(d.id, { id: d.id, data: d.data() }));
        txQueryBSnap.docs.forEach((d) => combinedDocs.set(d.id, { id: d.id, data: d.data() }));

        const { qualifyingSum, eligibleDepositRefs } = aggregateQualifyingUsdDeposits(combinedDocs.values());
        attemptQualifyingSum = qualifyingSum;
        attemptEligibleCount = eligibleDepositRefs.size;

        const existingRewardData = rewardSnap.exists ? (rewardSnap.data() as WelcomeRewardInfo) : undefined;
        const preservedRegistrationDate = existingRewardData?.registrationDate || txRegistrationDate;

        // Guard 1: Reward already marked PAID must NEVER regress or duplicate
        if (existingRewardData?.status === 'PAID') {
          return {
            action: 'ALREADY_PAID' as const,
            record: {
              ...existingRewardData,
              customerName: existingRewardData.customerName || txCustomerName,
              permanentAccountNumber: existingRewardData.permanentAccountNumber || txPan,
              registrationDate: preservedRegistrationDate,
            },
          };
        }

        // Guard 2: Existing reward transaction in ledger recovers PAID cleanly without double payout
        const recoveredTxDoc = !existingTxSnap.empty
          ? (existingTxSnap.docs[0].data() as Transaction)
          : rewardTxSnap.exists
            ? (rewardTxSnap.data() as Transaction)
            : null;
        if (recoveredTxDoc) {
          const recoveredRecord: WelcomeRewardInfo = {
            ...(existingRewardData || {}),
            userId,
            rewardAmount: WELCOME_REWARD_AMOUNT,
            targetAmount: WELCOME_REWARD_TARGET,
            qualifyingDeposits: Math.max(qualifyingSum, Number(existingRewardData?.qualifyingDeposits ?? 0)),
            progressPercentage: 100,
            remainingAmount: 0,
            status: 'PAID',
            qualifyingDepositCount: Math.max(
              eligibleDepositRefs.size,
              Number(existingRewardData?.qualifyingDepositCount ?? 0)
            ),
            paidAt: recoveredTxDoc.completedAt || recoveredTxDoc.createdAt || existingRewardData?.paidAt || nowIso,
            transactionReference: idempotencyKey,
            transactionId: recoveredTxDoc.id || rewardTxId,
            customerName: txCustomerName,
            permanentAccountNumber: txPan,
            registrationDate: preservedRegistrationDate,
            updatedAt: nowIso,
          };
          transaction.set(rewardDocRef, recoveredRecord, { merge: true });
          return { action: 'ALREADY_PAID' as const, record: recoveredRecord };
        }

        const isEligibleForPayment = qualifyingSum >= WELCOME_REWARD_TARGET;
        attemptWasEligible = isEligibleForPayment;

        // Guard 3: Below-threshold path — awaited transactional write protected against concurrent PAID commits
        if (!isEligibleForPayment) {
          const remainingAmount = Math.max(0, Number((WELCOME_REWARD_TARGET - qualifyingSum).toFixed(2)));
          const progressPercentage = Math.min(
            100,
            Number(((qualifyingSum / WELCOME_REWARD_TARGET) * 100).toFixed(1))
          );

          const inProgressRecord: WelcomeRewardInfo = {
            userId,
            rewardAmount: WELCOME_REWARD_AMOUNT,
            targetAmount: WELCOME_REWARD_TARGET,
            qualifyingDeposits: qualifyingSum,
            progressPercentage,
            remainingAmount,
            status: 'IN_PROGRESS',
            qualifyingDepositCount: eligibleDepositRefs.size,
            customerName: txCustomerName,
            permanentAccountNumber: txPan,
            registrationDate: preservedRegistrationDate,
            updatedAt: nowIso,
          };

          transaction.set(rewardDocRef, inProgressRecord, { merge: true });
          return { action: 'IN_PROGRESS' as const, record: inProgressRecord };
        }

        // Eligible path: complete remaining READS before ANY transaction.set(...)
        const accSnap = await transaction.get(accRef);

        let currentChecking = 0;
        let currentSavings = 0;
        let currentInvested = 0;
        let currentAccrued = 0;
        let accountsList: BankAccount[] = [];

        if (accSnap.exists) {
          const d = accSnap.data()!;
          currentChecking = Number(d.checkingBalance ?? d.availableBalance ?? 0);
          currentSavings = Number(d.savingsBalance ?? d.savings ?? 0);
          currentInvested = Number(d.investedBalance ?? d.investmentBalance ?? 0);
          currentAccrued = Number(d.accruedEarnings ?? 0);
          if (Array.isArray(d.accounts) && d.accounts.length > 0) {
            accountsList = d.accounts;
          }
        }

        // Credit $1,000 to Premier Checking
        const newChecking = Number((currentChecking + WELCOME_REWARD_AMOUNT).toFixed(2));
        const newTotal = Number((newChecking + currentSavings + currentInvested + currentAccrued).toFixed(2));
        const newAvailable = newChecking;

        const updatedAccounts = accountsList.length > 0
          ? accountsList.map((a) => {
              if (a.type === 'CHECKING') {
                return { ...a, balance: newChecking, availableBalance: newChecking };
              }
              return a;
            })
          : buildDefaultAccounts(userId, newChecking, currentSavings, currentInvested, txPan);

        const finalMetrics: BalanceMetrics = {
          checkingBalance: newChecking,
          savingsBalance: currentSavings,
          investedBalance: currentInvested,
          accruedEarnings: currentAccrued,
          totalBalance: newTotal,
          availableBalance: newAvailable,
          pendingBalance: 0,
          accounts: updatedAccounts,
        };

        // Build permanent Welcome Reward transaction record
        const rewardTx: Transaction = {
          id: rewardTxId,
          referenceNumber: idempotencyKey,
          type: 'WELCOME_REWARD',
          amount: WELCOME_REWARD_AMOUNT,
          currency: 'USD',
          status: 'COMPLETED',
          userId,
          recipientUserId: userId,
          recipientAccountNumber: txPan,
          recipientName: txCustomerName,
          senderName: 'Monvera Executive Treasury',
          senderAccountNumber: 'MONVERA-TREASURY-001',
          fee: 0.0,
          description: 'Monvera $1,000 New User Welcome Reward',
          category: 'Rewards',
          paymentProviderRef: idempotencyKey,
          createdAt: nowIso,
          completedAt: nowIso,
          metadata: {
            rewardProgram: 'NEW_USER_WELCOME_1000',
            qualifyingDepositsVerified: qualifyingSum,
            depositTarget: WELCOME_REWARD_TARGET,
            creditedAt: nowIso,
            isWelcomeReward: true,
          },
        };

        const rewardRecord: WelcomeRewardInfo = {
          userId,
          rewardAmount: WELCOME_REWARD_AMOUNT,
          targetAmount: WELCOME_REWARD_TARGET,
          qualifyingDeposits: qualifyingSum,
          progressPercentage: 100,
          remainingAmount: 0,
          status: 'PAID',
          qualifyingDepositCount: eligibleDepositRefs.size,
          paidAt: nowIso,
          transactionReference: idempotencyKey,
          transactionId: rewardTxId,
          customerName: txCustomerName,
          permanentAccountNumber: txPan,
          registrationDate: preservedRegistrationDate,
          updatedAt: nowIso,
        };

        // Transaction read-phase: prepare MONEY_RECEIVED outbox record strictly BEFORE any writes
        const rewardAmtFormatted = WELCOME_REWARD_AMOUNT.toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
        const safeRewardAccountMasked = formatSafeOutboxAccountLabel(txPan, 'Checking');

        const welcomeRewardOutboxBatch = await prepareNotificationOutboxBatch(transaction, fs, [
          {
            userId,
            transactionId: rewardTx.id,
            referenceNumber: rewardTx.referenceNumber,
            eventKey: `${rewardTx.id}:COMPLETED`,
            lifecycleStage: 'COMPLETED',
            dispatchType: 'MONEY_RECEIVED',
            category: 'TRANSACTION',
            nowIso,
            payload: {
              title: 'Welcome Reward Credited — Monvera',
              body: `Congratulations! Your $${rewardAmtFormatted} Monvera Welcome Reward has been credited to ${safeRewardAccountMasked}.`,
              actionUrl: '/dashboard?view=transactions',
              amount: WELCOME_REWARD_AMOUNT,
              currency: 'USD',
              senderName: 'Monvera Executive Treasury',
              recipientName: txCustomerName,
              accountMasked: safeRewardAccountMasked,
            },
          },
        ]);

        // WRITE PHASE
        // 1. Commit balance updates to account document
        transaction.set(accRef, { userId, ...finalMetrics, updatedAt: nowIso }, { merge: true });

        // 2. Commit permanent transaction ledger record
        transaction.set(rewardTxRef, rewardTx, { merge: true });

        // 3. Commit reward status as PAID
        transaction.set(rewardDocRef, rewardRecord, { merge: true });

        // 4. Commit durable notification outbox record atomically
        outboxWriteResult = writePreparedNotificationOutboxBatchInTransaction(
          transaction,
          welcomeRewardOutboxBatch
        );

        return { action: 'NEWLY_PAID' as const, record: rewardRecord };
      });

      // Dispatch asynchronous customer notification only on newly committed payout
      if (txOutcome.action === 'NEWLY_PAID') {
        reportOutboxPreparationIssues('evaluateAndProcessWelcomeReward', rewardTxId, outboxWriteResult);
        const notifyFn = deps?.persistNotification || persistCustomerNotification;
        notifyFn({
          id: `notif_welcome_${userId}`,
          userId,
          title: 'Welcome Reward Credited! 🎉',
          message: `Congratulations! You completed $10,000 in qualifying deposits and your $1,000.00 Welcome Reward has been credited to your Monvera Checking Account.`,
          type: 'TRANSACTION',
          severity: 'success',
          createdAt: txOutcome.record.paidAt || attemptNowIso,
          referenceId: idempotencyKey,
          actionView: 'transactions',
          actionRecordId: rewardTxId,
          metadata: {
            category: 'TRANSACTION',
            eventType: 'WELCOME_REWARD',
            customerName: txOutcome.record.customerName || customerName,
            accountNumberMasked: maskAccountNumber(txOutcome.record.permanentAccountNumber || permanentAccountNumber),
            transactionType: 'WELCOME_REWARD',
            direction: 'CREDIT',
            amount: WELCOME_REWARD_AMOUNT,
            currency: 'USD',
            status: 'COMPLETED',
            referenceNumber: idempotencyKey,
            date: txOutcome.record.paidAt || attemptNowIso,
          },
        }).catch((e) => console.warn('[WelcomeReward] Notification error:', e?.message || e));
      }

      // Mirror in memory db (guarded so PAID never regresses)
      syncRewardToMemoryDb(txOutcome.record);
      return txOutcome.record;
    } catch (err: any) {
      console.error(`[WelcomeReward] Error executing reward evaluation/credit for ${userId}:`, err);
      // Do not overwrite an already-committed PAID reward on error/failure
      try {
        const latestSnap = await rewardDocRef.get();
        if (latestSnap.exists) {
          const latestData = latestSnap.data() as WelcomeRewardInfo;
          if (latestData.status === 'PAID') {
            syncRewardToMemoryDb(latestData);
            return latestData;
          }
        }
      } catch {
        // Ignore follow-up read errors in fallback path
      }

      const remainingAmount = Math.max(0, Number((WELCOME_REWARD_TARGET - attemptQualifyingSum).toFixed(2)));
      const progressPercentage = Math.min(
        100,
        Number(((attemptQualifyingSum / WELCOME_REWARD_TARGET) * 100).toFixed(1))
      );

      return {
        userId,
        rewardAmount: WELCOME_REWARD_AMOUNT,
        targetAmount: WELCOME_REWARD_TARGET,
        qualifyingDeposits: attemptQualifyingSum,
        progressPercentage: attemptWasEligible ? 100 : progressPercentage,
        remainingAmount: attemptWasEligible ? 0 : remainingAmount,
        status: attemptWasEligible ? 'QUALIFIED' : 'IN_PROGRESS',
        qualifyingDepositCount: attemptEligibleCount,
        customerName,
        permanentAccountNumber,
        registrationDate,
        updatedAt: attemptNowIso,
        failureReason: err?.message || 'Transaction credit failed',
      };
    }
  }

  // 4. Non-Firestore / In-Memory-Only Fallback Path (strictly applies identical USD/completed/non-reversed rules)
  const existingMemReward = memoryRewardStore.get(userId);
  if (existingMemReward?.status === 'PAID') {
    return existingMemReward;
  }

  const nowIso = new Date().toISOString();
  const memoryEntries = db.transactions
    .filter((t) => t.userId === userId || t.recipientUserId === userId)
    .map((t) => ({ id: t.id, data: t as Record<string, any> }));

  const { qualifyingSum, eligibleDepositRefs } = aggregateQualifyingUsdDeposits(memoryEntries);
  const isEligibleForPayment = qualifyingSum >= WELCOME_REWARD_TARGET;
  const remainingAmount = Math.max(0, Number((WELCOME_REWARD_TARGET - qualifyingSum).toFixed(2)));
  const progressPercentage = Math.min(100, Number(((qualifyingSum / WELCOME_REWARD_TARGET) * 100).toFixed(1)));

  if (isEligibleForPayment) {
    const existingTx = db.transactions.find((t) => t.referenceNumber === idempotencyKey || t.id === rewardTxId);
    if (!existingTx) {
      const rewardTx: Transaction = {
        id: rewardTxId,
        referenceNumber: idempotencyKey,
        type: 'WELCOME_REWARD',
        amount: WELCOME_REWARD_AMOUNT,
        currency: 'USD',
        status: 'COMPLETED',
        userId,
        recipientUserId: userId,
        recipientAccountNumber: permanentAccountNumber,
        recipientName: customerName,
        senderName: 'Monvera Executive Treasury',
        senderAccountNumber: 'MONVERA-TREASURY-001',
        fee: 0.0,
        description: 'Monvera $1,000 New User Welcome Reward',
        category: 'Rewards',
        paymentProviderRef: idempotencyKey,
        createdAt: nowIso,
        completedAt: nowIso,
        metadata: {
          rewardProgram: 'NEW_USER_WELCOME_1000',
          qualifyingDepositsVerified: qualifyingSum,
          depositTarget: WELCOME_REWARD_TARGET,
          creditedAt: nowIso,
          isWelcomeReward: true,
        },
      };

      db.transactions.unshift(rewardTx);

      // Credit memory checking account
      const chkId = `acc_chk_${userId}`;
      const chkAcc = db.accounts.get(chkId);
      if (chkAcc) {
        chkAcc.balance = Number((chkAcc.balance + WELCOME_REWARD_AMOUNT).toFixed(2));
        chkAcc.availableBalance = chkAcc.balance;
        db.accounts.set(chkId, chkAcc);
      }

      db.ledgerEntries.push({
        id: `led_rwd_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        transactionId: rewardTxId,
        userId,
        accountId: chkId,
        entryType: 'CREDIT',
        amount: WELCOME_REWARD_AMOUNT,
        balanceAfter: chkAcc?.balance || WELCOME_REWARD_AMOUNT,
        description: rewardTx.description,
        timestamp: nowIso,
      });

      db.notifications.unshift({
        id: `notif_rwd_${Date.now()}`,
        userId,
        title: 'Welcome Reward Credited! 🎉',
        message: `Congratulations! You completed $10,000 in qualifying deposits and your $1,000 Welcome Reward has been credited to your Monvera Checking Account.`,
        type: 'TRANSACTION',
        severity: 'success',
        read: false,
        createdAt: nowIso,
        referenceId: idempotencyKey,
      });
    }

    const memoryRecord: WelcomeRewardInfo = {
      userId,
      rewardAmount: WELCOME_REWARD_AMOUNT,
      targetAmount: WELCOME_REWARD_TARGET,
      qualifyingDeposits: qualifyingSum,
      progressPercentage: 100,
      remainingAmount: 0,
      status: 'PAID',
      qualifyingDepositCount: eligibleDepositRefs.size,
      paidAt: existingTx?.completedAt || existingTx?.createdAt || nowIso,
      transactionReference: idempotencyKey,
      transactionId: existingTx?.id || rewardTxId,
      customerName,
      permanentAccountNumber,
      registrationDate,
      updatedAt: nowIso,
    };

    syncRewardToMemoryDb(memoryRecord);
    return memoryRecord;
  }

  // Fallback in-progress (only when Firestore is unavailable)
  const inProgressRecord: WelcomeRewardInfo = {
    userId,
    rewardAmount: WELCOME_REWARD_AMOUNT,
    targetAmount: WELCOME_REWARD_TARGET,
    qualifyingDeposits: qualifyingSum,
    progressPercentage,
    remainingAmount,
    status: 'IN_PROGRESS',
    qualifyingDepositCount: eligibleDepositRefs.size,
    customerName,
    permanentAccountNumber,
    registrationDate,
    updatedAt: nowIso,
  };

  syncRewardToMemoryDb(inProgressRecord);
  return inProgressRecord;
}

// In-memory cache for fast lookup and dev fallback
const memoryRewardStore = new Map<string, WelcomeRewardInfo>();

function syncRewardToMemoryDb(record: WelcomeRewardInfo) {
  const existingMem = memoryRewardStore.get(record.userId);
  if (existingMem?.status === 'PAID' && record.status !== 'PAID') {
    return;
  }
  memoryRewardStore.set(record.userId, record);
  if (record.status === 'PAID') {
    const chkId = `acc_chk_${record.userId}`;
    const chkAcc = db.accounts.get(chkId);
    const refNum = record.transactionReference || `MV-RWD-WELCOME-${record.userId}`;
    const existingTx = db.transactions.find((t) => t.referenceNumber === refNum);
    if (!existingTx) {
      if (chkAcc) {
        chkAcc.balance = Number((chkAcc.balance + WELCOME_REWARD_AMOUNT).toFixed(2));
        chkAcc.availableBalance = chkAcc.balance;
        db.accounts.set(chkId, chkAcc);
      }
      db.transactions.unshift({
        id: record.transactionId || `tx_rwd_welcome_${record.userId}`,
        referenceNumber: refNum,
        type: 'WELCOME_REWARD',
        amount: WELCOME_REWARD_AMOUNT,
        currency: 'USD',
        status: 'COMPLETED',
        userId: record.userId,
        recipientUserId: record.userId,
        recipientAccountNumber: record.permanentAccountNumber || '1000000000',
        recipientName: record.customerName || 'Monvera Customer',
        senderName: 'Monvera Executive Treasury',
        senderAccountNumber: 'MONVERA-TREASURY-001',
        fee: 0.0,
        description: 'Monvera $1,000 New User Welcome Reward',
        category: 'Rewards',
        paymentProviderRef: refNum,
        createdAt: record.paidAt || new Date().toISOString(),
        completedAt: record.paidAt || new Date().toISOString(),
      });
    }
  }
}

/**
 * Returns all Welcome Reward records across all customers for the Administrator Dashboard
 */
export async function getAllWelcomeRewardsAdmin(): Promise<{ rewards: WelcomeRewardInfo[]; stats: any }> {
  const result: WelcomeRewardInfo[] = [];

  if (isFirebaseAdminConfigured()) {
    try {
      // 1. First fetch all records from welcome_rewards collection
      const rSnap = await adminFirestore.collection('welcome_rewards').get();
      const loadedUserIds = new Set<string>();

      rSnap.docs.forEach((d) => {
        const item = d.data() as WelcomeRewardInfo;
        result.push(item);
        loadedUserIds.add(item.userId);
      });

      // 2. Also ensure all registered customers have an evaluated entry
      const usersSnap = await adminFirestore.collection('users').get();
      for (const uDoc of usersSnap.docs) {
        const u = uDoc.data();
        if (u.role === 'admin' || u.role === 'super_admin') continue;
        if (!loadedUserIds.has(uDoc.id)) {
          // Evaluate on the fly
          try {
            const ev = await evaluateAndProcessWelcomeReward(uDoc.id);
            result.push(ev);
            loadedUserIds.add(uDoc.id);
          } catch {}
        }
      }
    } catch (err) {
      console.error('[getAllWelcomeRewardsAdmin] Firestore query error:', err);
    }
  }

  // Fallback / merge with memory store
  for (const [uid, r] of memoryRewardStore.entries()) {
    if (!result.some((existing) => existing.userId === uid)) {
      result.push(r);
    }
  }

  // Also include any users in db.users not yet in result
  for (const [uid, user] of db.users.entries()) {
    if (user.role === 'admin' || user.role === 'super_admin') continue;
    if (!result.some((r) => r.userId === uid)) {
      try {
        const ev = await evaluateAndProcessWelcomeReward(uid);
        result.push(ev);
      } catch {}
    }
  }

  // Compute aggregate statistics
  const totalPaid = result.filter((r) => r.status === 'PAID').length;
  const totalInProgress = result.filter((r) => r.status === 'IN_PROGRESS').length;
  const totalQualified = result.filter((r) => r.status === 'QUALIFIED').length;
  const totalQualifyingDeposits = result.reduce((acc, r) => acc + (r.qualifyingDeposits || 0), 0);
  const totalRewardsDistributed = totalPaid * WELCOME_REWARD_AMOUNT;

  return {
    rewards: result,
    stats: {
      totalCustomersTracked: result.length,
      totalPaid,
      totalInProgress,
      totalQualified,
      totalQualifyingDeposits,
      totalRewardsDistributed,
      rewardAmountPerUser: WELCOME_REWARD_AMOUNT,
      targetAmountRequired: WELCOME_REWARD_TARGET,
    },
  };
}
