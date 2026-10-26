import { adminFirestore, isFirebaseAdminConfigured } from './firebaseAdmin';
import { db } from './db';
import { Transaction, WelcomeRewardInfo, WelcomeRewardStatus, BankAccount, BalanceMetrics } from '../src/types';

export const WELCOME_REWARD_TARGET = 10000.0; // $10,000.00 in qualifying deposits
export const WELCOME_REWARD_AMOUNT = 1000.0; // $1,000.00 one-time welcome reward

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

/**
 * Evaluates a customer's verified, completed deposits against the $10,000 Welcome Reward threshold.
 * If the threshold is satisfied and the reward has not been paid, atomically credits $1,000
 * directly to the user's Monvera account ledger with strict idempotency protection.
 */
export async function evaluateAndProcessWelcomeReward(userId: string): Promise<WelcomeRewardInfo> {
  if (!userId) {
    throw new Error('Valid user ID is required to evaluate Welcome Reward.');
  }

  const nowIso = new Date().toISOString();
  const rewardDocRef = isFirebaseAdminConfigured()
    ? adminFirestore.collection('welcome_rewards').doc(userId)
    : null;

  // 1. Fetch user profile for metadata & account number
  let customerName = 'Monvera Customer';
  let permanentAccountNumber = '1000000000';
  let registrationDate = new Date().toISOString();

  if (isFirebaseAdminConfigured()) {
    try {
      const uSnap = await adminFirestore.collection('users').doc(userId).get();
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

  // 2. Check if already paid from persistent store
  if (rewardDocRef) {
    try {
      const existingRewardSnap = await rewardDocRef.get();
      if (existingRewardSnap.exists) {
        const rData = existingRewardSnap.data() as WelcomeRewardInfo;
        if (rData.status === 'PAID') {
          return {
            ...rData,
            customerName: rData.customerName || customerName,
            permanentAccountNumber: rData.permanentAccountNumber || permanentAccountNumber,
            registrationDate: rData.registrationDate || registrationDate,
          };
        }
      }
    } catch (e) {
      console.warn(`[WelcomeReward] Error reading reward record for ${userId}:`, e);
    }
  }

  // 3. Authoritatively aggregate all successfully completed, verified USD deposits
  // EXCLUSIONS (Strict Rule #3):
  // - No pending, failed, cancelled, reversed, or refunded deposits
  // - No transfers between Monvera users
  // - No withdrawals, investment movements, or reward credits
  // - Deduplicate by provider reference / reference number
  let qualifyingSum = 0;
  const eligibleDepositRefs = new Set<string>();
  const seenPaymentRefs = new Set<string>();

  if (isFirebaseAdminConfigured()) {
    try {
      // Query completed deposits for this user
      const txQueryA = await adminFirestore
        .collection('transactions')
        .where('userId', '==', userId)
        .where('type', '==', 'DEPOSIT')
        .where('status', '==', 'COMPLETED')
        .get();

      const txQueryB = await adminFirestore
        .collection('transactions')
        .where('recipientUserId', '==', userId)
        .where('type', '==', 'DEPOSIT')
        .where('status', '==', 'COMPLETED')
        .get();

      const combinedDocs = new Map<string, any>();
      txQueryA.docs.forEach((d) => combinedDocs.set(d.id, d.data()));
      txQueryB.docs.forEach((d) => combinedDocs.set(d.id, d.data()));

      for (const [docId, tx] of combinedDocs.entries()) {
        const amt = Number(tx.amount ?? 0);
        const ref = tx.referenceNumber || docId;
        const provRef = tx.paymentProviderRef || tx.metadata?.stripeSessionId || '';
        const meta = tx.metadata || {};

        // Exclusions:
        if (amt <= 0) continue;
        if (meta.isReversed === true || tx.status === 'REVERSED') continue;
        if (tx.currency && tx.currency.toUpperCase() !== 'USD') continue;
        if (tx.category === 'Rewards' || tx.type === 'WELCOME_REWARD') continue;

        // Deduplication check
        if (provRef && seenPaymentRefs.has(provRef)) continue;
        if (seenPaymentRefs.has(ref)) continue;

        if (provRef) seenPaymentRefs.add(provRef);
        seenPaymentRefs.add(ref);
        eligibleDepositRefs.add(ref);
        qualifyingSum += amt;
      }
    } catch (err) {
      console.error(`[WelcomeReward] Error querying Firestore deposits for ${userId}:`, err);
    }
  }

  // Also include any verified completed deposits from memory db (with strict reference deduplication)
  const memoryUserTxs = db.transactions.filter(
    (t) => (t.userId === userId || t.recipientUserId === userId) &&
           t.type === 'DEPOSIT' &&
           t.status === 'COMPLETED' &&
           t.category !== 'Rewards' &&
           !(t.metadata?.isReversed)
  );

  for (const tx of memoryUserTxs) {
    const amt = Number(tx.amount ?? 0);
    const ref = tx.referenceNumber || tx.id;
    const provRef = tx.paymentProviderRef || '';
    if (amt <= 0) continue;
    if (provRef && seenPaymentRefs.has(provRef)) continue;
    if (seenPaymentRefs.has(ref)) continue;
    if (provRef) seenPaymentRefs.add(provRef);
    seenPaymentRefs.add(ref);
    eligibleDepositRefs.add(ref);
    qualifyingSum += amt;
  }

  qualifyingSum = Number(qualifyingSum.toFixed(2));
  const isEligibleForPayment = qualifyingSum >= WELCOME_REWARD_TARGET;
  const remainingAmount = Math.max(0, Number((WELCOME_REWARD_TARGET - qualifyingSum).toFixed(2)));
  const progressPercentage = Math.min(100, Number(((qualifyingSum / WELCOME_REWARD_TARGET) * 100).toFixed(1)));

  const idempotencyKey = `MV-RWD-WELCOME-${userId}`;
  const rewardTxId = `tx_rwd_welcome_${userId}`;

  // 4. If qualified, execute atomic idempotent $1,000 credit
  if (isEligibleForPayment) {
    if (isFirebaseAdminConfigured() && rewardDocRef) {
      try {
        const creditResult = await adminFirestore.runTransaction(async (transaction) => {
          // Double-check reward record inside transaction lock
          const rewardSnap = await transaction.get(rewardDocRef);
          if (rewardSnap.exists) {
            const rd = rewardSnap.data() as WelcomeRewardInfo;
            if (rd.status === 'PAID') {
              return { alreadyPaid: true, record: rd };
            }
          }

          // Double-check if reward transaction already exists in ledger
          const existingTxSnap = await transaction.get(
            adminFirestore.collection('transactions').where('referenceNumber', '==', idempotencyKey).limit(1)
          );
          if (!existingTxSnap.empty) {
            const existingTx = existingTxSnap.docs[0].data() as Transaction;
            const updatedRecord: WelcomeRewardInfo = {
              userId,
              rewardAmount: WELCOME_REWARD_AMOUNT,
              targetAmount: WELCOME_REWARD_TARGET,
              qualifyingDeposits: qualifyingSum,
              progressPercentage: 100,
              remainingAmount: 0,
              status: 'PAID',
              qualifyingDepositCount: eligibleDepositRefs.size,
              paidAt: existingTx.completedAt || existingTx.createdAt || nowIso,
              transactionReference: idempotencyKey,
              transactionId: existingTx.id,
              customerName,
              permanentAccountNumber,
              registrationDate,
              updatedAt: nowIso,
            };
            transaction.set(rewardDocRef, updatedRecord, { merge: true });
            return { alreadyPaid: true, record: updatedRecord };
          }

          // Read customer account document
          const accRef = adminFirestore.collection('accounts').doc(userId);
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
            : buildDefaultAccounts(userId, newChecking, currentSavings, currentInvested, permanentAccountNumber);

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
            customerName,
            permanentAccountNumber,
            registrationDate,
            updatedAt: nowIso,
          };

          // 1. Commit balance updates to account document
          transaction.set(accRef, { userId, ...finalMetrics, updatedAt: nowIso }, { merge: true });

          // 2. Commit permanent transaction ledger record
          transaction.set(adminFirestore.collection('transactions').doc(rewardTxId), rewardTx, { merge: true });

          // 3. Commit reward status as PAID
          transaction.set(rewardDocRef, rewardRecord, { merge: true });

          return { alreadyPaid: false, record: rewardRecord };
        });

        // Dispatch asynchronous customer notification
        if (!creditResult.alreadyPaid) {
          const notifId = `notif_rwd_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
          adminFirestore.collection('notifications').doc(notifId).set({
            id: notifId,
            userId,
            title: 'Welcome Reward Credited! 🎉',
            message: `Congratulations! You completed $10,000 in qualifying deposits and your $1,000 Welcome Reward has been credited to your Monvera Checking Account.`,
            type: 'TRANSACTION',
            severity: 'success',
            read: false,
            createdAt: nowIso,
            referenceId: idempotencyKey,
          }).catch((e) => console.warn('[WelcomeReward] Notification error:', e?.message || e));
        }

        // Mirror in memory db
        syncRewardToMemoryDb(creditResult.record);

        return creditResult.record;
      } catch (err: any) {
        console.error(`[WelcomeReward] Error executing reward credit for ${userId}:`, err);
        // Fallback: return qualified with error note
        return {
          userId,
          rewardAmount: WELCOME_REWARD_AMOUNT,
          targetAmount: WELCOME_REWARD_TARGET,
          qualifyingDeposits: qualifyingSum,
          progressPercentage: 100,
          remainingAmount: 0,
          status: 'QUALIFIED',
          qualifyingDepositCount: eligibleDepositRefs.size,
          customerName,
          permanentAccountNumber,
          registrationDate,
          updatedAt: nowIso,
          failureReason: err?.message || 'Transaction credit failed',
        };
      }
    } else {
      // Memory DB fallback implementation
      const existingTx = db.transactions.find((t) => t.referenceNumber === idempotencyKey);
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
        paidAt: nowIso,
        transactionReference: idempotencyKey,
        transactionId: rewardTxId,
        customerName,
        permanentAccountNumber,
        registrationDate,
        updatedAt: nowIso,
      };

      syncRewardToMemoryDb(memoryRecord);
      return memoryRecord;
    }
  }

  // 5. Still in progress
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

  if (rewardDocRef) {
    rewardDocRef.set(inProgressRecord, { merge: true }).catch((e) =>
      console.warn(`[WelcomeReward] In-progress record write note:`, e?.message || e)
    );
  }
  syncRewardToMemoryDb(inProgressRecord);

  return inProgressRecord;
}

// In-memory cache for fast lookup and dev fallback
const memoryRewardStore = new Map<string, WelcomeRewardInfo>();

function syncRewardToMemoryDb(record: WelcomeRewardInfo) {
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
