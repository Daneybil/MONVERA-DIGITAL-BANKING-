import { adminFirestore } from './firebaseAdmin';
import {
  Transaction,
  BankAccount,
  BalanceMetrics,
  LoanApplication,
  NotificationItem,
  InvestmentPlan,
  InvestmentTermDays,
} from '../src/types';

export interface TransferParams {
  senderUid: string;
  recipientIdentifier: string; // Recipient UID, account number, username, or email
  amount: number;
  description?: string;
  category?: string;
  referenceNumber?: string;
}

export interface TransferResult {
  success: boolean;
  transaction?: Transaction;
  senderBalanceMetrics?: BalanceMetrics;
  recipientBalanceMetrics?: BalanceMetrics;
  isDuplicate?: boolean;
  error?: string;
}

export interface WithdrawalParams {
  userId: string;
  amount: number;
  sourceAccountType?: 'CHECKING' | 'SAVINGS';
  destinationType?: string;
  destinationLabel: string;
  accountOrIban: string;
  cardBrand?: string;
  routingNumber?: string;
  referenceNumber?: string;
}

export interface WithdrawalResult {
  success: boolean;
  transaction?: Transaction;
  balanceMetrics?: BalanceMetrics;
  error?: string;
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

/**
 * Resolves a recipient user document from Firestore users collection
 */
export async function resolveRecipientUser(rawTarget: string): Promise<{ uid: string; data: any } | null> {
  const cleanTarget = rawTarget.trim().replace(/^@/, '').toLowerCase();
  const cleanDigits = rawTarget.trim().replace(/[-\s]/g, '');

  const usersCol = adminFirestore.collection('users');

  // 1. Direct document ID lookup
  if (rawTarget.trim().length >= 10) {
    const directSnap = await usersCol.doc(rawTarget.trim()).get();
    if (directSnap.exists) {
      return { uid: directSnap.id, data: directSnap.data() };
    }
  }

  // 2. Query by permanentAccountNumber or accountNumber
  if (cleanDigits) {
    const qAcc = await usersCol.where('permanentAccountNumber', '==', cleanDigits).limit(1).get();
    if (!qAcc.empty) {
      return { uid: qAcc.docs[0].id, data: qAcc.docs[0].data() };
    }
    const qAccLegacy = await usersCol.where('accountNumber', '==', cleanDigits).limit(1).get();
    if (!qAccLegacy.empty) {
      return { uid: qAccLegacy.docs[0].id, data: qAccLegacy.docs[0].data() };
    }
  }

  // 3. Query by usernameLower or username
  if (cleanTarget) {
    const qUserLower = await usersCol.where('usernameLower', '==', cleanTarget).limit(1).get();
    if (!qUserLower.empty) {
      return { uid: qUserLower.docs[0].id, data: qUserLower.docs[0].data() };
    }
    const qUser = await usersCol.where('username', '==', cleanTarget).limit(1).get();
    if (!qUser.empty) {
      return { uid: qUser.docs[0].id, data: qUser.docs[0].data() };
    }
    const qEmail = await usersCol.where('email', '==', cleanTarget).limit(1).get();
    if (!qEmail.empty) {
      return { uid: qEmail.docs[0].id, data: qEmail.docs[0].data() };
    }
  }

  // 4. Fallback search scan
  const allUsersSnap = await usersCol.limit(100).get();
  for (const d of allUsersSnap.docs) {
    const u = d.data();
    const uAcc = (u.permanentAccountNumber || u.accountNumber || '').replace(/[-\s]/g, '');
    const uUser = (u.username || '').replace(/^@/, '').toLowerCase();
    const uEmail = (u.email || '').toLowerCase();
    const uName = `${u.firstName || ''} ${u.lastName || ''}`.trim().toLowerCase();

    if (
      (cleanDigits && uAcc === cleanDigits) ||
      (cleanTarget && (uUser === cleanTarget || uEmail === cleanTarget || uName === cleanTarget))
    ) {
      return { uid: d.id, data: u };
    }
  }

  return null;
}

/**
 * Server-authoritative Monvera-to-Monvera transfer inside a single Firestore transaction.
 */
export async function executeServerTransfer(params: TransferParams): Promise<TransferResult> {
  const { senderUid, recipientIdentifier, amount, description, category, referenceNumber } = params;
  const transferAmount = Number(amount);

  if (!senderUid || isNaN(transferAmount) || transferAmount <= 0) {
    return { success: false, error: 'Sender ID and a positive transfer amount are required.' };
  }

  // 1. Resolve recipient BEFORE modifying balances
  const recipientRecord = await resolveRecipientUser(recipientIdentifier);
  if (!recipientRecord) {
    return {
      success: false,
      error: `Recipient "${recipientIdentifier}" not found in Monvera directory.`,
    };
  }

  const recipientUid = recipientRecord.uid;
  const recipientData = recipientRecord.data;

  // 2. Validate sender is not recipient
  if (senderUid === recipientUid) {
    return {
      success: false,
      error: 'You cannot transfer funds to your own account. Use internal account transfer instead.',
    };
  }

  // 3. Resolve sender profile info
  const senderDocSnap = await adminFirestore.collection('users').doc(senderUid).get();
  const senderData = senderDocSnap.exists ? senderDocSnap.data()! : {};
  const senderName = `${senderData.firstName || ''} ${senderData.lastName || ''}`.trim() || senderData.username || 'Monvera Member';
  const senderAcc = senderData.permanentAccountNumber || senderData.accountNumber || '1000000000';

  const recipientName = `${recipientData.firstName || ''} ${recipientData.lastName || ''}`.trim() || recipientData.username || 'Monvera Recipient';
  const recipientAcc = recipientData.permanentAccountNumber || recipientData.accountNumber || '1088492015';

  // 4. Idempotency reference resolution
  const finalRef = referenceNumber || `MV-TRF-${Math.floor(100000000 + Math.random() * 900000000)}`;
  const txId = `tx_mv_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;

  // References
  const senderAccRef = adminFirestore.collection('accounts').doc(senderUid);
  const recipientAccRef = adminFirestore.collection('accounts').doc(recipientUid);
  const txRef = adminFirestore.collection('transactions').doc(txId);

  let finalTx: Transaction | null = null;
  let finalSenderMetrics: BalanceMetrics | null = null;
  let finalRecipientMetrics: BalanceMetrics | null = null;

  try {
    await adminFirestore.runTransaction(async (transaction) => {
      // Check idempotency by referenceNumber
      const existingRefQuery = await transaction.get(
        adminFirestore.collection('transactions').where('referenceNumber', '==', finalRef).limit(1)
      );

      if (!existingRefQuery.empty) {
        const existingTx = existingRefQuery.docs[0].data() as Transaction;
        if (existingTx.status === 'COMPLETED') {
          // Idempotent short-circuit
          finalTx = existingTx;
          const sSnap = await transaction.get(senderAccRef);
          if (sSnap.exists) {
            const sd = sSnap.data()!;
            finalSenderMetrics = {
              checkingBalance: Number(sd.checkingBalance ?? 0),
              savingsBalance: Number(sd.savingsBalance ?? 0),
              investedBalance: Number(sd.investedBalance ?? 0),
              accruedEarnings: Number(sd.accruedEarnings ?? 0),
              totalBalance: Number(sd.totalBalance ?? 0),
              availableBalance: Number(sd.availableBalance ?? sd.checkingBalance ?? 0),
              pendingBalance: Number(sd.pendingBalance ?? 0),
              loanBalance: Number(sd.loanBalance ?? 0),
              accounts: sd.accounts || [],
            };
          }
          const rSnap = await transaction.get(recipientAccRef);
          if (rSnap.exists) {
            const rd = rSnap.data()!;
            finalRecipientMetrics = {
              checkingBalance: Number(rd.checkingBalance ?? 0),
              savingsBalance: Number(rd.savingsBalance ?? 0),
              investedBalance: Number(rd.investedBalance ?? 0),
              accruedEarnings: Number(rd.accruedEarnings ?? 0),
              totalBalance: Number(rd.totalBalance ?? 0),
              availableBalance: Number(rd.availableBalance ?? rd.checkingBalance ?? 0),
              pendingBalance: Number(rd.pendingBalance ?? 0),
              loanBalance: Number(rd.loanBalance ?? 0),
              accounts: rd.accounts || [],
            };
          }
          return;
        }
      }

      // Read sender account
      const senderAccSnap = await transaction.get(senderAccRef);
      // Read recipient account
      const recipientAccSnap = await transaction.get(recipientAccRef);

      let senderChecking = 0;
      let senderSavings = 0;
      let senderInvested = 0;
      let senderAccrued = 0;
      let senderAccounts: BankAccount[] = [];

      if (senderAccSnap.exists) {
        const sd = senderAccSnap.data()!;
        senderChecking = Number(sd.checkingBalance ?? sd.availableBalance ?? 0);
        senderSavings = Number(sd.savingsBalance ?? sd.savings ?? 0);
        senderInvested = Number(sd.investedBalance ?? sd.investmentBalance ?? 0);
        senderAccrued = Number(sd.accruedEarnings ?? 0);
        if (Array.isArray(sd.accounts) && sd.accounts.length > 0) {
          senderAccounts = sd.accounts;
        }
      } else {
        // No account document created yet -> insufficient balance
        throw new Error(`INSUFFICIENT_FUNDS: Insufficient checking balance ($0.00). Transfer requires $${transferAmount.toFixed(2)}.`);
      }

      // Validate sender available balance
      if (senderChecking < transferAmount) {
        throw new Error(
          `INSUFFICIENT_FUNDS: Insufficient checking balance ($${senderChecking.toFixed(2)}). Transfer requires $${transferAmount.toFixed(2)}.`
        );
      }

      let recipientChecking = 0;
      let recipientSavings = 0;
      let recipientInvested = 0;
      let recipientAccrued = 0;
      let recipientAccounts: BankAccount[] = [];

      if (recipientAccSnap.exists) {
        const rd = recipientAccSnap.data()!;
        recipientChecking = Number(rd.checkingBalance ?? rd.availableBalance ?? 0);
        recipientSavings = Number(rd.savingsBalance ?? rd.savings ?? 0);
        recipientInvested = Number(rd.investedBalance ?? rd.investmentBalance ?? 0);
        recipientAccrued = Number(rd.accruedEarnings ?? 0);
        if (Array.isArray(rd.accounts) && rd.accounts.length > 0) {
          recipientAccounts = rd.accounts;
        }
      }

      // Calculate new sender balances
      const newSenderChecking = Number((senderChecking - transferAmount).toFixed(2));
      const newSenderTotal = Number((newSenderChecking + senderSavings + senderInvested + senderAccrued).toFixed(2));
      const newSenderAvailable = newSenderChecking;

      const updatedSenderAccounts = senderAccounts.length > 0
        ? senderAccounts.map((a) =>
            a.type === 'CHECKING'
              ? { ...a, balance: newSenderChecking, availableBalance: newSenderAvailable }
              : a
          )
        : buildDefaultAccounts(senderUid, newSenderChecking, senderSavings, senderInvested, senderAcc);

      finalSenderMetrics = {
        checkingBalance: newSenderChecking,
        savingsBalance: senderSavings,
        investedBalance: senderInvested,
        accruedEarnings: senderAccrued,
        totalBalance: newSenderTotal,
        availableBalance: newSenderAvailable,
        pendingBalance: 0,
        accounts: updatedSenderAccounts,
      };

      // Calculate new recipient balances
      const newRecipientChecking = Number((recipientChecking + transferAmount).toFixed(2));
      const newRecipientTotal = Number((newRecipientChecking + recipientSavings + recipientInvested + recipientAccrued).toFixed(2));
      const newRecipientAvailable = newRecipientChecking;

      const updatedRecipientAccounts = recipientAccounts.length > 0
        ? recipientAccounts.map((a) =>
            a.type === 'CHECKING'
              ? { ...a, balance: newRecipientChecking, availableBalance: newRecipientAvailable }
              : a
          )
        : buildDefaultAccounts(recipientUid, newRecipientChecking, recipientSavings, recipientInvested, recipientAcc);

      finalRecipientMetrics = {
        checkingBalance: newRecipientChecking,
        savingsBalance: recipientSavings,
        investedBalance: recipientInvested,
        accruedEarnings: recipientAccrued,
        totalBalance: newRecipientTotal,
        availableBalance: newRecipientAvailable,
        pendingBalance: 0,
        accounts: updatedRecipientAccounts,
      };

      const nowIso = new Date().toISOString();

      finalTx = {
        id: txId,
        referenceNumber: finalRef,
        type: 'TRANSFER',
        amount: transferAmount,
        currency: 'USD',
        status: 'COMPLETED',
        senderUserId: senderUid,
        senderName,
        senderAccountNumber: senderAcc,
        recipientUserId: recipientUid,
        recipientName,
        recipientAccountNumber: recipientAcc,
        fee: 0.0,
        description: description || `Transfer to ${recipientName}`,
        category: (category as any) || 'Transfers',
        createdAt: nowIso,
        completedAt: nowIso,
      };

      // Atomic commit: write sender account
      transaction.set(
        senderAccRef,
        {
          userId: senderUid,
          ...finalSenderMetrics,
          updatedAt: nowIso,
        },
        { merge: true }
      );

      // Atomic commit: write recipient account
      transaction.set(
        recipientAccRef,
        {
          userId: recipientUid,
          ...finalRecipientMetrics,
          updatedAt: nowIso,
        },
        { merge: true }
      );

      // Atomic commit: write transaction ledger record
      transaction.set(txRef, finalTx, { merge: true });
    });

    if (finalTx) {
      return {
        success: true,
        transaction: finalTx,
        senderBalanceMetrics: finalSenderMetrics || undefined,
        recipientBalanceMetrics: finalRecipientMetrics || undefined,
      };
    }

    return { success: false, error: 'Transaction completed without returning final transaction record.' };
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    if (errMsg.includes('INSUFFICIENT_FUNDS:')) {
      return {
        success: false,
        error: errMsg.replace('INSUFFICIENT_FUNDS:', '').trim(),
      };
    }
    return {
      success: false,
      error: errMsg || 'Server transfer transaction failed.',
    };
  }
}

/**
 * Server-authoritative withdrawal inside a single Firestore transaction.
 */
export async function executeServerWithdrawal(params: WithdrawalParams): Promise<WithdrawalResult> {
  const {
    userId,
    amount,
    sourceAccountType = 'CHECKING',
    destinationType = 'CARD',
    destinationLabel,
    accountOrIban,
    cardBrand,
    routingNumber,
    referenceNumber,
  } = params;

  const withdrawAmount = Number(amount);
  const isChecking = sourceAccountType === 'CHECKING';

  if (!userId || isNaN(withdrawAmount) || withdrawAmount <= 0) {
    return { success: false, error: 'Valid user ID and positive withdrawal amount are required.' };
  }

  const userDocSnap = await adminFirestore.collection('users').doc(userId).get();
  const userData = userDocSnap.exists ? userDocSnap.data()! : {};
  const userAcc = userData.permanentAccountNumber || userData.accountNumber || '1000000000';

  const finalRef = referenceNumber || `MV-WTH-${Math.floor(100000000 + Math.random() * 900000000)}`;
  const txId = `tx_wth_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;

  const accRef = adminFirestore.collection('accounts').doc(userId);
  const txRef = adminFirestore.collection('transactions').doc(txId);

  let finalTx: Transaction | null = null;
  let finalMetrics: BalanceMetrics | null = null;

  try {
    await adminFirestore.runTransaction(async (transaction) => {
      // Idempotency check
      const existingRefQuery = await transaction.get(
        adminFirestore.collection('transactions').where('referenceNumber', '==', finalRef).limit(1)
      );

      if (!existingRefQuery.empty) {
        const existingTx = existingRefQuery.docs[0].data() as Transaction;
        finalTx = existingTx;
        const sSnap = await transaction.get(accRef);
        if (sSnap.exists) {
          const sd = sSnap.data()!;
          finalMetrics = {
            checkingBalance: Number(sd.checkingBalance ?? 0),
            savingsBalance: Number(sd.savingsBalance ?? 0),
            investedBalance: Number(sd.investedBalance ?? 0),
            accruedEarnings: Number(sd.accruedEarnings ?? 0),
            totalBalance: Number(sd.totalBalance ?? 0),
            availableBalance: Number(sd.availableBalance ?? sd.checkingBalance ?? 0),
            pendingBalance: Number(sd.pendingBalance ?? 0),
            loanBalance: Number(sd.loanBalance ?? 0),
            accounts: sd.accounts || [],
          };
        }
        return;
      }

      // Read account inside transaction
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
      } else {
        throw new Error('INSUFFICIENT_FUNDS: No active account record found to debit funds.');
      }

      const sourceBal = isChecking ? currentChecking : currentSavings;
      if (sourceBal < withdrawAmount) {
        throw new Error(
          `INSUFFICIENT_FUNDS: Insufficient funds. Your available ${isChecking ? 'Checking' : 'Savings'} balance is $${sourceBal.toLocaleString('en-US', {
            minimumFractionDigits: 2,
          })}.`
        );
      }

      // Calculate resulting balance
      const newChecking = isChecking
        ? Number((currentChecking - withdrawAmount).toFixed(2))
        : currentChecking;
      const newSavings = !isChecking
        ? Number((currentSavings - withdrawAmount).toFixed(2))
        : currentSavings;
      const newTotal = Number((newChecking + newSavings + currentInvested + currentAccrued).toFixed(2));

      const updatedAccounts = accountsList.length > 0
        ? accountsList.map((a) => {
            if (a.type === sourceAccountType) {
              const b = isChecking ? newChecking : newSavings;
              return { ...a, balance: b, availableBalance: b };
            }
            return a;
          })
        : buildDefaultAccounts(userId, newChecking, newSavings, currentInvested, userAcc);

      finalMetrics = {
        checkingBalance: newChecking,
        savingsBalance: newSavings,
        investedBalance: currentInvested,
        accruedEarnings: currentAccrued,
        totalBalance: newTotal,
        availableBalance: newChecking,
        pendingBalance: 0,
        accounts: updatedAccounts,
      };

      const nowIso = new Date().toISOString();
      const reversalMinutes = 30;
      const reversalScheduledAt = new Date(Date.now() + reversalMinutes * 60 * 1000).toISOString();

      finalTx = {
        id: txId,
        referenceNumber: finalRef,
        type: 'WITHDRAWAL',
        amount: withdrawAmount,
        currency: 'USD',
        status: 'PENDING',
        senderUserId: userId,
        fee: 0.0,
        description: `Instant Card Push to ${destinationLabel} (${accountOrIban.slice(-4)})`,
        category: 'Withdrawals',
        createdAt: nowIso,
        metadata: {
          destinationType,
          destinationLabel,
          accountOrIban,
          cardBrand,
          routingNumber,
          sourceAccountType,
          autoReverse: true,
          reversalMinutes,
          reversalScheduledAt,
        },
      };

      // Atomic commit: update account
      transaction.set(
        accRef,
        {
          userId,
          ...finalMetrics,
          updatedAt: nowIso,
        },
        { merge: true }
      );

      // Atomic commit: create withdrawal ledger record
      transaction.set(txRef, finalTx, { merge: true });
    });

    if (finalTx) {
      return {
        success: true,
        transaction: finalTx,
        balanceMetrics: finalMetrics || undefined,
      };
    }

    return { success: false, error: 'Withdrawal completed without returning final transaction record.' };
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    if (errMsg.includes('INSUFFICIENT_FUNDS:')) {
      return {
        success: false,
        error: errMsg.replace('INSUFFICIENT_FUNDS:', '').trim(),
      };
    }
    return {
      success: false,
      error: errMsg || 'Server withdrawal transaction failed.',
    };
  }
}

export interface DepositParams {
  userId: string;
  amount: number;
  method?: 'CARD' | 'ACH' | 'WIRE' | 'INSTANT_PAY' | 'CRYPTO_WALLET' | string;
  destinationAccountType?: 'CHECKING' | 'SAVINGS';
  providerPaymentId?: string;
  referenceNumber?: string;
  metadata?: Record<string, any>;
}

export interface DepositResult {
  success: boolean;
  transaction?: Transaction;
  balanceMetrics?: BalanceMetrics;
  isDuplicate?: boolean;
  error?: string;
}

/**
 * Server-authoritative deposit execution inside a single Firestore transaction.
 */
export async function executeServerDeposit(params: DepositParams): Promise<DepositResult> {
  const { userId, amount, method = 'CARD', destinationAccountType = 'CHECKING', providerPaymentId, referenceNumber, metadata } = params;
  const depositAmount = Number(amount);

  if (!userId || isNaN(depositAmount) || depositAmount <= 0) {
    return { success: false, error: 'Valid user ID and a positive deposit amount are required.' };
  }

  // 1. Fetch user profile metadata from Firestore to enrich records
  let userAcc = '1000000000';
  try {
    const uSnap = await adminFirestore.collection('users').doc(userId).get();
    if (uSnap.exists) {
      const ud = uSnap.data()!;
      userAcc = ud.permanentAccountNumber || ud.accountNumber || '1000000000';
    }
  } catch {}

  const finalRef = referenceNumber || providerPaymentId || `MV-DEP-${Math.floor(100000000 + Math.random() * 900000000)}`;
  const txId = `tx_dep_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
  const accRef = adminFirestore.collection('accounts').doc(userId);
  const txRef = adminFirestore.collection('transactions').doc(txId);

  const isChecking = destinationAccountType !== 'SAVINGS';
  const targetAccountType = isChecking ? 'CHECKING' : 'SAVINGS';

  let finalTx: Transaction | null = null;
  let finalMetrics: BalanceMetrics | null = null;
  let isDuplicate = false;

  const methodLabels: Record<string, string> = {
    CARD: 'Debit / Credit Card Gateway',
    ACH: 'Bank ACH Transfer',
    WIRE: 'Domestic FedWire',
    INSTANT_PAY: 'Instant RTP Network',
    CRYPTO_WALLET: 'Web3 Crypto Wallet Deposit',
  };
  const methodLabel = methodLabels[method] || method;

  try {
    await adminFirestore.runTransaction(async (transaction) => {
      // 1. Check idempotency: if referenceNumber or providerPaymentId has already settled
      const existingRefQuery = await transaction.get(
        adminFirestore.collection('transactions').where('referenceNumber', '==', finalRef).limit(1)
      );

      if (!existingRefQuery.empty) {
        const existingTx = existingRefQuery.docs[0].data() as Transaction;
        if (existingTx.status === 'COMPLETED') {
          isDuplicate = true;
          finalTx = existingTx;
          const aSnap = await transaction.get(accRef);
          if (aSnap.exists) {
            const ad = aSnap.data()!;
            finalMetrics = {
              checkingBalance: Number(ad.checkingBalance ?? 0),
              savingsBalance: Number(ad.savingsBalance ?? 0),
              investedBalance: Number(ad.investedBalance ?? 0),
              accruedEarnings: Number(ad.accruedEarnings ?? 0),
              totalBalance: Number(ad.totalBalance ?? 0),
              availableBalance: Number(ad.availableBalance ?? ad.checkingBalance ?? 0),
              pendingBalance: Number(ad.pendingBalance ?? 0),
              loanBalance: Number(ad.loanBalance ?? 0),
              accounts: ad.accounts || [],
            };
          }
          return;
        }
      }

      if (providerPaymentId) {
        const existingProviderQuery = await transaction.get(
          adminFirestore.collection('transactions').where('paymentProviderRef', '==', providerPaymentId).limit(1)
        );
        if (!existingProviderQuery.empty) {
          const existingTx = existingProviderQuery.docs[0].data() as Transaction;
          if (existingTx.status === 'COMPLETED') {
            isDuplicate = true;
            finalTx = existingTx;
            const aSnap = await transaction.get(accRef);
            if (aSnap.exists) {
              const ad = aSnap.data()!;
              finalMetrics = {
                checkingBalance: Number(ad.checkingBalance ?? 0),
                savingsBalance: Number(ad.savingsBalance ?? 0),
                investedBalance: Number(ad.investedBalance ?? 0),
                accruedEarnings: Number(ad.accruedEarnings ?? 0),
                totalBalance: Number(ad.totalBalance ?? 0),
                availableBalance: Number(ad.availableBalance ?? ad.checkingBalance ?? 0),
                pendingBalance: Number(ad.pendingBalance ?? 0),
                loanBalance: Number(ad.loanBalance ?? 0),
                accounts: ad.accounts || [],
              };
            }
            return;
          }
        }
      }

      // 2. Read destination account document
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

      // 3. Compute new balances
      const newChecking = isChecking
        ? Number((currentChecking + depositAmount).toFixed(2))
        : currentChecking;
      const newSavings = !isChecking
        ? Number((currentSavings + depositAmount).toFixed(2))
        : currentSavings;
      const newTotal = Number((newChecking + newSavings + currentInvested + currentAccrued).toFixed(2));
      const newAvailable = newChecking;

      const updatedAccounts = accountsList.length > 0
        ? accountsList.map((a) => {
            if (a.type === targetAccountType) {
              const b = isChecking ? newChecking : newSavings;
              return { ...a, balance: b, availableBalance: b };
            }
            return a;
          })
        : buildDefaultAccounts(userId, newChecking, newSavings, currentInvested, userAcc);

      finalMetrics = {
        checkingBalance: newChecking,
        savingsBalance: newSavings,
        investedBalance: currentInvested,
        accruedEarnings: currentAccrued,
        totalBalance: newTotal,
        availableBalance: newAvailable,
        pendingBalance: 0,
        accounts: updatedAccounts,
      };

      const nowIso = new Date().toISOString();
      const targetAccountName = isChecking ? 'Premier Checking' : 'High-Yield Treasury';

      finalTx = {
        id: txId,
        referenceNumber: finalRef,
        type: 'DEPOSIT',
        amount: depositAmount,
        currency: 'USD',
        status: 'COMPLETED',
        userId,
        senderUserId: userId,
        recipientUserId: userId,
        fee: 0.0,
        description: `Deposit to ${targetAccountName} via ${methodLabel}`,
        category: 'Deposits',
        paymentProviderRef: providerPaymentId || finalRef,
        createdAt: nowIso,
        completedAt: nowIso,
        metadata: {
          destinationAccountType: targetAccountType,
          depositMethod: method,
          ...metadata,
        },
      };

      // Atomic commit: update account
      transaction.set(
        accRef,
        {
          userId,
          ...finalMetrics,
          updatedAt: nowIso,
        },
        { merge: true }
      );

      // Atomic commit: create permanent deposit ledger transaction
      transaction.set(txRef, finalTx, { merge: true });
    });

    if (finalTx) {
      // Create user notification asynchronously
      const notifId = `notif_${Date.now()}_dep_${Math.random().toString(36).substring(2, 6)}`;
      adminFirestore.collection('notifications').doc(notifId).set({
        id: notifId,
        userId,
        title: 'Deposit Settled & Available',
        message: `+$${depositAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })} has been securely credited to your Monvera ${isChecking ? 'Checking Account' : 'High-Yield Savings'}.`,
        type: 'TRANSACTION',
        severity: 'success',
        read: false,
        createdAt: new Date().toISOString(),
        referenceId: finalTx.referenceNumber,
      }).catch((e) => console.warn('[executeServerDeposit] Notification write note:', e?.message || e));

      return {
        success: true,
        transaction: finalTx,
        balanceMetrics: finalMetrics || undefined,
        isDuplicate,
      };
    }

    return { success: false, error: 'Deposit completed without returning transaction record.' };
  } catch (err: any) {
    console.error('[executeServerDeposit] Transaction failed:', err);
    return {
      success: false,
      error: err?.message || 'Server deposit transaction failed.',
    };
  }
}

export interface AdminTransferParams {
  adminId: string;
  targetIdentifier: string;
  amount: number;
  description?: string;
  category?: string;
  referenceNumber?: string;
}

export interface AdminTransferResult {
  success: boolean;
  transaction?: Transaction;
  targetBalanceMetrics?: BalanceMetrics;
  isDuplicate?: boolean;
  error?: string;
}

/**
 * Server-authoritative Admin Direct Transfer from Bennett Johnson inside a single Firestore transaction.
 */
export async function executeServerAdminTransfer(params: AdminTransferParams): Promise<AdminTransferResult> {
  const { adminId, targetIdentifier, amount, description, category, referenceNumber } = params;
  const transferAmount = Number(amount);

  if (!targetIdentifier || isNaN(transferAmount) || transferAmount <= 0) {
    return { success: false, error: 'Target customer ID and positive transfer amount are required.' };
  }

  // 1. Resolve recipient from Firestore
  const recipientRecord = await resolveRecipientUser(targetIdentifier);
  if (!recipientRecord) {
    return {
      success: false,
      error: `Recipient "${targetIdentifier}" not found in Monvera directory. Please verify account number or customer ID.`,
    };
  }

  const recipientUid = recipientRecord.uid;
  const recipientData = recipientRecord.data || {};
  const recipientDisplayName = `${recipientData.firstName || ''} ${recipientData.lastName || ''}`.trim() || recipientData.username || 'Monvera Client';
  const recipientAcc = recipientData.permanentAccountNumber || recipientData.accountNumber || '1000000000';

  const finalRef = referenceNumber || `MV-ADM-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
  const txId = `tx_adm_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const accRef = adminFirestore.collection('accounts').doc(recipientUid);
  const txRef = adminFirestore.collection('transactions').doc(txId);

  let finalTx: Transaction | null = null;
  let finalMetrics: BalanceMetrics | null = null;
  let isDuplicate = false;

  try {
    await adminFirestore.runTransaction(async (transaction) => {
      // 1. Check idempotency
      const existingRefQuery = await transaction.get(
        adminFirestore.collection('transactions').where('referenceNumber', '==', finalRef).limit(1)
      );

      if (!existingRefQuery.empty) {
        const existingTx = existingRefQuery.docs[0].data() as Transaction;
        if (existingTx.status === 'COMPLETED') {
          isDuplicate = true;
          finalTx = existingTx;
          const aSnap = await transaction.get(accRef);
          if (aSnap.exists) {
            const ad = aSnap.data()!;
            finalMetrics = {
              checkingBalance: Number(ad.checkingBalance ?? 0),
              savingsBalance: Number(ad.savingsBalance ?? 0),
              investedBalance: Number(ad.investedBalance ?? 0),
              accruedEarnings: Number(ad.accruedEarnings ?? 0),
              totalBalance: Number(ad.totalBalance ?? 0),
              availableBalance: Number(ad.availableBalance ?? ad.checkingBalance ?? 0),
              pendingBalance: Number(ad.pendingBalance ?? 0),
              loanBalance: Number(ad.loanBalance ?? 0),
              accounts: ad.accounts || [],
            };
          }
          return;
        }
      }

      // 2. Read recipient account
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

      // 3. Credit Checking balance
      const newChecking = Number((currentChecking + transferAmount).toFixed(2));
      const newSavings = currentSavings;
      const newTotal = Number((newChecking + newSavings + currentInvested + currentAccrued).toFixed(2));
      const newAvailable = newChecking;

      const updatedAccounts = accountsList.length > 0
        ? accountsList.map((a) => {
            if (a.type === 'CHECKING') {
              return { ...a, balance: newChecking, availableBalance: newChecking };
            }
            return a;
          })
        : buildDefaultAccounts(recipientUid, newChecking, newSavings, currentInvested, recipientAcc);

      finalMetrics = {
        checkingBalance: newChecking,
        savingsBalance: newSavings,
        investedBalance: currentInvested,
        accruedEarnings: currentAccrued,
        totalBalance: newTotal,
        availableBalance: newAvailable,
        pendingBalance: 0,
        accounts: updatedAccounts,
      };

      const nowIso = new Date().toISOString();

      finalTx = {
        id: txId,
        referenceNumber: finalRef,
        type: 'TRANSFER',
        amount: transferAmount,
        currency: 'USD',
        status: 'COMPLETED',
        senderUserId: adminId || 'usr_admin',
        senderName: 'Bennett Johnson (Admin)',
        senderAccountNumber: '1000000001',
        recipientUserId: recipientUid,
        recipientName: recipientDisplayName,
        recipientAccountNumber: recipientAcc,
        fee: 0.0,
        description: description || 'Administrative Direct Transfer from Bennett Johnson',
        category: (category as any) || 'Transfers',
        createdAt: nowIso,
        completedAt: nowIso,
        metadata: {
          adminSenderName: 'Bennett Johnson',
          adminSenderAccount: '1000000001',
          disbursementType: 'ADMINISTRATIVE_TRANSFER',
        },
      };

      // Atomic commit: update recipient account document
      transaction.set(
        accRef,
        {
          userId: recipientUid,
          ...finalMetrics,
          updatedAt: nowIso,
        },
        { merge: true }
      );

      // Atomic commit: write transaction ledger record
      transaction.set(txRef, finalTx, { merge: true });
    });

    if (finalTx) {
      // Save notification to Firestore for recipient
      const notifId = `notif_${Date.now()}_adm_${Math.random().toString(36).substring(2, 6)}`;
      adminFirestore.collection('notifications').doc(notifId).set({
        id: notifId,
        userId: recipientUid,
        title: 'Money Received',
        message: `Received $${transferAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })} from Bennett Johnson (MVB •••• 0001).`,
        type: 'TRANSACTION',
        severity: 'success',
        read: false,
        createdAt: new Date().toISOString(),
        referenceId: finalTx.referenceNumber,
      }).catch((e) => console.warn('[executeServerAdminTransfer] Notification write note:', e?.message || e));

      return {
        success: true,
        transaction: finalTx,
        targetBalanceMetrics: finalMetrics || undefined,
        isDuplicate,
      };
    }

    return { success: false, error: 'Admin transfer completed without returning transaction record.' };
  } catch (err: any) {
    console.error('[executeServerAdminTransfer] Transaction failed:', err);
    return {
      success: false,
      error: err?.message || 'Server admin transfer failed.',
    };
  }
}

export interface AdminDevFundingParams {
  adminId: string;
  targetUserId: string;
  amount: number;
  reason?: string;
  targetAccountType?: 'CHECKING' | 'SAVINGS';
  referenceId?: string;
}

export interface AdminDevFundingResult {
  success: boolean;
  transaction?: Transaction;
  targetBalanceMetrics?: BalanceMetrics;
  isDuplicate?: boolean;
  error?: string;
}

/**
 * Server-authoritative Developer Liquidity Injection inside a single Firestore transaction.
 */
export async function executeServerAdminDevFunding(params: AdminDevFundingParams): Promise<AdminDevFundingResult> {
  const { adminId, targetUserId, amount, reason, targetAccountType = 'CHECKING', referenceId } = params;
  const fundingAmount = Number(amount);

  if (!targetUserId || isNaN(fundingAmount) || fundingAmount <= 0) {
    return { success: false, error: 'Target customer ID and positive funding amount are required.' };
  }

  // 1. Resolve target customer from Firestore
  const targetRecord = await resolveRecipientUser(targetUserId);
  const targetUid = targetRecord ? targetRecord.uid : targetUserId;
  const targetData = targetRecord ? targetRecord.data : {};
  const targetDisplayName = `${targetData.firstName || ''} ${targetData.lastName || ''}`.trim() || targetData.username || 'Developer Sandbox Account';
  const targetAcc = targetData.permanentAccountNumber || targetData.accountNumber || 'Sandbox';

  const finalRef = referenceId || `MVB-DEV-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  const txId = `tx_dev_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const accRef = adminFirestore.collection('accounts').doc(targetUid);
  const txRef = adminFirestore.collection('transactions').doc(txId);

  const isSavings = targetAccountType === 'SAVINGS';
  const targetType = isSavings ? 'SAVINGS' : 'CHECKING';

  let finalTx: Transaction | null = null;
  let finalMetrics: BalanceMetrics | null = null;
  let isDuplicate = false;

  try {
    await adminFirestore.runTransaction(async (transaction) => {
      // 1. Check idempotency: by referenceNumber or paymentProviderRef
      const existingRefQuery = await transaction.get(
        adminFirestore.collection('transactions').where('referenceNumber', '==', finalRef).limit(1)
      );

      if (!existingRefQuery.empty) {
        const existingTx = existingRefQuery.docs[0].data() as Transaction;
        if (existingTx.status === 'COMPLETED') {
          isDuplicate = true;
          finalTx = existingTx;
          const aSnap = await transaction.get(accRef);
          if (aSnap.exists) {
            const ad = aSnap.data()!;
            finalMetrics = {
              checkingBalance: Number(ad.checkingBalance ?? 0),
              savingsBalance: Number(ad.savingsBalance ?? 0),
              investedBalance: Number(ad.investedBalance ?? 0),
              accruedEarnings: Number(ad.accruedEarnings ?? 0),
              totalBalance: Number(ad.totalBalance ?? 0),
              availableBalance: Number(ad.availableBalance ?? ad.checkingBalance ?? 0),
              pendingBalance: Number(ad.pendingBalance ?? 0),
              loanBalance: Number(ad.loanBalance ?? 0),
              accounts: ad.accounts || [],
            };
          }
          return;
        }
      }

      // Also check paymentProviderRef
      const existingProvQuery = await transaction.get(
        adminFirestore.collection('transactions').where('paymentProviderRef', '==', finalRef).limit(1)
      );

      if (!existingProvQuery.empty) {
        const existingTx = existingProvQuery.docs[0].data() as Transaction;
        if (existingTx.status === 'COMPLETED') {
          isDuplicate = true;
          finalTx = existingTx;
          const aSnap = await transaction.get(accRef);
          if (aSnap.exists) {
            const ad = aSnap.data()!;
            finalMetrics = {
              checkingBalance: Number(ad.checkingBalance ?? 0),
              savingsBalance: Number(ad.savingsBalance ?? 0),
              investedBalance: Number(ad.investedBalance ?? 0),
              accruedEarnings: Number(ad.accruedEarnings ?? 0),
              totalBalance: Number(ad.totalBalance ?? 0),
              availableBalance: Number(ad.availableBalance ?? ad.checkingBalance ?? 0),
              pendingBalance: Number(ad.pendingBalance ?? 0),
              loanBalance: Number(ad.loanBalance ?? 0),
              accounts: ad.accounts || [],
            };
          }
          return;
        }
      }

      // 2. Read target account
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

      // 3. Compute credit
      const newChecking = isSavings
        ? currentChecking
        : Number((currentChecking + fundingAmount).toFixed(2));
      const newSavings = isSavings
        ? Number((currentSavings + fundingAmount).toFixed(2))
        : currentSavings;
      const newTotal = Number((newChecking + newSavings + currentInvested + currentAccrued).toFixed(2));
      const newAvailable = newChecking;

      const updatedAccounts = accountsList.length > 0
        ? accountsList.map((a) => {
            if (a.type === targetType) {
              const b = isSavings ? newSavings : newChecking;
              return { ...a, balance: b, availableBalance: b };
            }
            return a;
          })
        : buildDefaultAccounts(targetUid, newChecking, newSavings, currentInvested, targetAcc);

      finalMetrics = {
        checkingBalance: newChecking,
        savingsBalance: newSavings,
        investedBalance: currentInvested,
        accruedEarnings: currentAccrued,
        totalBalance: newTotal,
        availableBalance: newAvailable,
        pendingBalance: 0,
        accounts: updatedAccounts,
      };

      const nowIso = new Date().toISOString();

      finalTx = {
        id: txId,
        referenceNumber: finalRef,
        paymentProviderRef: finalRef,
        type: 'ADMIN_DEVELOPMENT_FUNDING',
        amount: fundingAmount,
        currency: 'USD',
        status: 'COMPLETED',
        senderUserId: adminId || 'usr_admin',
        senderName: 'Monvera Developer Sandbox Pool',
        senderAccountNumber: 'MVB-DEV-POOL',
        recipientUserId: targetUid,
        recipientName: targetDisplayName,
        recipientAccountNumber: targetAcc,
        fee: 0.0,
        description: `Development Testing Capital: ${reason || 'Sandbox liquidity disbursement'}`,
        category: 'Deposits',
        createdAt: nowIso,
        completedAt: nowIso,
        metadata: {
          adminId,
          reason,
          referenceId: finalRef,
          targetAccountType: targetType,
        },
      };

      // Atomic commit: update target account
      transaction.set(
        accRef,
        {
          userId: targetUid,
          ...finalMetrics,
          updatedAt: nowIso,
        },
        { merge: true }
      );

      // Atomic commit: create transaction ledger document
      transaction.set(txRef, finalTx, { merge: true });
    });

    if (finalTx) {
      // Save notification to Firestore for target user
      const notifId = `notif_${Date.now()}_dev_${Math.random().toString(36).substring(2, 6)}`;
      adminFirestore.collection('notifications').doc(notifId).set({
        id: notifId,
        userId: targetUid,
        title: 'Sandbox Liquidity Injected',
        message: `+$${fundingAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })} dev testing capital has been credited to your account.`,
        type: 'TRANSACTION',
        severity: 'success',
        read: false,
        createdAt: new Date().toISOString(),
        referenceId: finalTx.referenceNumber,
      }).catch((e) => console.warn('[executeServerAdminDevFunding] Notification write note:', e?.message || e));

      return {
        success: true,
        transaction: finalTx,
        targetBalanceMetrics: finalMetrics || undefined,
        isDuplicate,
      };
    }

    return { success: false, error: 'Admin dev funding completed without returning transaction record.' };
  } catch (err: any) {
    console.error('[executeServerAdminDevFunding] Transaction failed:', err);
    return {
      success: false,
      error: err?.message || 'Server admin dev funding failed.',
    };
  }
}

export interface LoanDisbursementParams {
  loanId: string;
  adminId?: string;
  fallbackLoan?: any;
  fallbackUser?: any;
}

export interface LoanDisbursementResult {
  success: boolean;
  loan?: LoanApplication;
  transaction?: Transaction;
  balanceMetrics?: BalanceMetrics;
  notification?: NotificationItem;
  isDuplicate?: boolean;
  error?: string;
}

/**
 * Server-authoritative loan disbursement inside a single atomic Firestore transaction.
 */
export async function executeServerLoanDisbursement(
  params: LoanDisbursementParams
): Promise<LoanDisbursementResult> {
  const { loanId, adminId = 'usr_admin', fallbackLoan, fallbackUser } = params;
  if (!loanId) {
    return { success: false, error: 'Loan ID is required for disbursement.' };
  }

  const loanRef = adminFirestore.collection('loans').doc(loanId);
  const now = new Date().toISOString();

  let finalLoan: LoanApplication | null = null;
  let finalTx: Transaction | null = null;
  let finalMetrics: BalanceMetrics | null = null;
  let finalNotif: NotificationItem | null = null;
  let isDuplicate = false;

  try {
    await adminFirestore.runTransaction(async (transaction) => {
      // 1. Reads
      const loanSnap = await transaction.get(loanRef);
      let loanData: LoanApplication;

      if (loanSnap.exists) {
        loanData = loanSnap.data() as LoanApplication;
      } else if (fallbackLoan) {
        loanData = {
          ...fallbackLoan,
          id: loanId,
          userId: fallbackLoan.userId || fallbackUser?.id,
          applicantName:
            fallbackLoan.applicantName ||
            (fallbackUser ? `${fallbackUser.firstName || ''} ${fallbackUser.lastName || ''}`.trim() : 'Valued Client'),
          applicantEmail: fallbackLoan.applicantEmail || fallbackUser?.email || '',
          applicantPhone: fallbackLoan.applicantPhone || fallbackUser?.phone || '',
          permanentAccountNumber:
            fallbackLoan.permanentAccountNumber || fallbackUser?.permanentAccountNumber || '1000000000',
          amount: Number(fallbackLoan.amount),
          termMonths: Number(fallbackLoan.termMonths) || 12,
          status: 'PENDING',
          createdAt: fallbackLoan.createdAt || now,
        };
      } else {
        throw new Error('LOAN_NOT_FOUND: Loan record not found.');
      }

      const targetUserId = loanData.userId;
      if (!targetUserId) {
        throw new Error('INVALID_LOAN: Loan record has no associated target userId.');
      }

      const accRef = adminFirestore.collection('accounts').doc(targetUserId);
      const accSnap = await transaction.get(accRef);

      // Check deterministic idempotency reference:
      // If loan is already ACTIVE or APPROVED or already disbursed:
      const deterministicRef = `MVB-LN-${loanId}`;
      const isAlreadyActiveOrApproved = loanData.status === 'ACTIVE' || loanData.status === 'APPROVED';
      const isAlreadyCredited =
        accSnap.exists && Array.isArray(accSnap.data()?.creditedLoans) && accSnap.data()?.creditedLoans.includes(loanId);

      if (isAlreadyActiveOrApproved || isAlreadyCredited) {
        isDuplicate = true;
        finalLoan = loanData;
        if (accSnap.exists) {
          const ad = accSnap.data()!;
          finalMetrics = {
            checkingBalance: Number(ad.checkingBalance ?? 0),
            savingsBalance: Number(ad.savingsBalance ?? 0),
            investedBalance: Number(ad.investedBalance ?? 0),
            accruedEarnings: Number(ad.accruedEarnings ?? 0),
            totalBalance: Number(ad.totalBalance ?? 0),
            availableBalance: Number(ad.availableBalance ?? ad.checkingBalance ?? 0),
            pendingBalance: Number(ad.pendingBalance ?? 0),
            loanBalance: Number(ad.loanBalance ?? 0),
            accounts: ad.accounts || [],
          };
        }
        return; // Idempotent: do not credit money again!
      }

      // 2. Validate loan amount
      const loanAmount = Number(loanData.amount);
      if (isNaN(loanAmount) || loanAmount <= 0) {
        throw new Error('INVALID_AMOUNT: Loan amount must be a positive number.');
      }

      const termMonths = loanData.termMonths || 12;
      const totalRepay = Number((loanAmount * 1.20).toFixed(2));
      const interestAmt = Number((loanAmount * 0.20).toFixed(2));
      const monthlyPayment = Number((totalRepay / termMonths).toFixed(2));
      const maturityDate = new Date(Date.now() + termMonths * 30 * 24 * 60 * 60 * 1000).toISOString();

      // Read current account balances
      let currentChecking = 0;
      let currentSavings = 0;
      let currentInvested = 0;
      let currentAccrued = 0;
      let currentLoanBal = 0;
      let accountsList: BankAccount[] = [];
      let creditedLoans: string[] = [];
      let userAcc = loanData.permanentAccountNumber || '1000000000';

      if (accSnap.exists) {
        const ad = accSnap.data()!;
        currentChecking = Number(ad.checkingBalance ?? ad.availableBalance ?? 0);
        currentSavings = Number(ad.savingsBalance ?? ad.savings ?? 0);
        currentInvested = Number(ad.investedBalance ?? ad.investmentBalance ?? 0);
        currentAccrued = Number(ad.accruedEarnings ?? 0);
        currentLoanBal = Number(ad.loanBalance ?? 0);
        userAcc = ad.permanentAccountNumber || ad.accountNumber || userAcc;
        if (Array.isArray(ad.accounts) && ad.accounts.length > 0) {
          accountsList = ad.accounts;
        }
        if (Array.isArray(ad.creditedLoans)) {
          creditedLoans = [...ad.creditedLoans];
        }
      }

      // Compute new balances
      const newChecking = Number((currentChecking + loanAmount).toFixed(2));
      const newAvailable = Number((currentChecking + loanAmount).toFixed(2));
      const newTotal = Number((newChecking + currentSavings + currentInvested + currentAccrued).toFixed(2));
      const newLoanBal = Number((currentLoanBal + totalRepay).toFixed(2));

      if (!creditedLoans.includes(loanId)) {
        creditedLoans.push(loanId);
      }

      // Update accounts list
      let foundChecking = false;
      const updatedAccountsList = accountsList.map((a) => {
        if (a.type === 'CHECKING') {
          foundChecking = true;
          return { ...a, balance: newChecking, availableBalance: newAvailable };
        }
        return a;
      });

      if (!foundChecking) {
        updatedAccountsList.unshift({
          id: `acc_chk_${targetUserId}`,
          userId: targetUserId,
          type: 'CHECKING',
          accountNumber: userAcc,
          routingNumber: '021000021',
          currency: 'USD',
          balance: newChecking,
          availableBalance: newAvailable,
          investedBalance: 0,
          pendingBalance: 0,
          interestRateAPY: 1.25,
          status: 'ACTIVE',
          nickname: 'Monvera Premier Checking',
        });
      }

      finalMetrics = {
        checkingBalance: newChecking,
        savingsBalance: currentSavings,
        investedBalance: currentInvested,
        accruedEarnings: currentAccrued,
        totalBalance: newTotal,
        availableBalance: newAvailable,
        pendingBalance: 0,
        loanBalance: newLoanBal,
        accounts: updatedAccountsList,
      };

      // 3. Atomically write updated account balance
      transaction.set(
        accRef,
        {
          userId: targetUserId,
          ...finalMetrics,
          creditedLoans,
          updatedAt: now,
        },
        { merge: true }
      );

      // 4. Atomically update loan record
      finalLoan = {
        ...loanData,
        status: 'ACTIVE',
        approvedAt: now,
        approvedBy: adminId,
        disbursedAt: now,
        disbursedAmount: loanAmount,
        interestAmount: interestAmt,
        totalRepaymentAmount: totalRepay,
        remainingBalance: totalRepay,
        totalRepaid: 0,
        monthlyPayment,
        maturityDate,
        updatedAt: now,
      };
      transaction.set(loanRef, finalLoan, { merge: true });

      // 5. Atomically create transaction ledger record
      const txId = `tx_loan_disb_${loanId}`;
      const txRef = adminFirestore.collection('transactions').doc(txId);
      finalTx = {
        id: txId,
        userId: targetUserId,
        type: 'DEPOSIT',
        category: 'Deposits',
        amount: loanAmount,
        fee: 0,
        currency: 'USD',
        status: 'COMPLETED',
        description: `Approved Commercial Loan Disbursement ($${loanAmount.toLocaleString('en-US', {
          minimumFractionDigits: 2,
        })}) - Ref: ${loanId}`,
        senderName: 'Monvera Credit & Lending Facility',
        senderAccountNumber: 'MVB-LN-001',
        recipientUserId: targetUserId,
        recipientName: loanData.applicantName || 'Valued Client',
        recipientAccountNumber: userAcc,
        referenceNumber: deterministicRef,
        createdAt: now,
        completedAt: now,
      };
      transaction.set(txRef, finalTx, { merge: true });

      // 6. Atomically create notification record
      const notifId = `notif_loan_appr_${loanId}`;
      const notifRef = adminFirestore.collection('notifications').doc(notifId);
      finalNotif = {
        id: notifId,
        userId: targetUserId,
        title: '🎉 Loan Approved & Disbursed!',
        message: `Congratulations! Your loan application for $${loanAmount.toLocaleString('en-US', {
          minimumFractionDigits: 2,
        })} has been approved and the capital has been credited directly into your Checking Account.`,
        type: 'TRANSACTION',
        severity: 'success',
        read: false,
        createdAt: now,
        referenceId: loanId,
      };
      transaction.set(notifRef, finalNotif, { merge: true });
    });

    if (finalLoan) {
      return {
        success: true,
        loan: finalLoan,
        transaction: finalTx || undefined,
        balanceMetrics: finalMetrics || undefined,
        notification: finalNotif || undefined,
        isDuplicate,
      };
    }

    return { success: false, error: 'Disbursement completed without returning loan record.' };
  } catch (err: any) {
    console.error('[executeServerLoanDisbursement] Error:', err);
    return {
      success: false,
      error: err?.message || 'Server loan disbursement failed.',
    };
  }
}

export interface LoanRepaymentParams {
  loanId: string;
  userId: string;
  amount: number;
  sourceAccountId?: string;
  note?: string;
  referenceNumber?: string;
  fallbackLoan?: any;
  fallbackUser?: any;
}

export interface LoanRepaymentResult {
  success: boolean;
  loan?: LoanApplication;
  transaction?: Transaction;
  balanceMetrics?: BalanceMetrics;
  remainingBalance?: number;
  isDuplicate?: boolean;
  error?: string;
}

/**
 * Server-authoritative loan repayment inside a single atomic Firestore transaction.
 */
export async function executeServerLoanRepayment(
  params: LoanRepaymentParams
): Promise<LoanRepaymentResult> {
  const { loanId, userId, amount, note, referenceNumber, fallbackLoan } = params;

  if (!loanId || !userId || isNaN(Number(amount)) || Number(amount) <= 0) {
    return { success: false, error: 'Loan ID, user ID, and a positive repayment amount are required.' };
  }

  const repayAmount = Number(Number(amount).toFixed(2));
  const loanRef = adminFirestore.collection('loans').doc(loanId);
  const accRef = adminFirestore.collection('accounts').doc(userId);
  const now = new Date().toISOString();

  let finalLoan: LoanApplication | null = null;
  let finalTx: Transaction | null = null;
  let finalMetrics: BalanceMetrics | null = null;
  let finalRemaining: number = 0;
  let isDuplicate = false;

  const finalRef = referenceNumber || `MVB-RP-${loanId}-${Math.round(repayAmount * 100)}-${Date.now()}`;

  try {
    await adminFirestore.runTransaction(async (transaction) => {
      // Check idempotency if referenceNumber was passed
      if (referenceNumber) {
        const existingTxQuery = await transaction.get(
          adminFirestore.collection('transactions').where('referenceNumber', '==', referenceNumber).limit(1)
        );
        if (!existingTxQuery.empty) {
          const existingTx = existingTxQuery.docs[0].data() as Transaction;
          if (existingTx.status === 'COMPLETED') {
            isDuplicate = true;
            finalTx = existingTx;
            const lSnap = await transaction.get(loanRef);
            if (lSnap.exists) {
              finalLoan = lSnap.data() as LoanApplication;
              finalRemaining = finalLoan.remainingBalance || 0;
            }
            const aSnap = await transaction.get(accRef);
            if (aSnap.exists) {
              const ad = aSnap.data()!;
              finalMetrics = {
                checkingBalance: Number(ad.checkingBalance ?? 0),
                savingsBalance: Number(ad.savingsBalance ?? 0),
                investedBalance: Number(ad.investedBalance ?? 0),
                accruedEarnings: Number(ad.accruedEarnings ?? 0),
                totalBalance: Number(ad.totalBalance ?? 0),
                availableBalance: Number(ad.availableBalance ?? ad.checkingBalance ?? 0),
                pendingBalance: Number(ad.pendingBalance ?? 0),
                loanBalance: Number(ad.loanBalance ?? 0),
                accounts: ad.accounts || [],
              };
            }
            return;
          }
        }
      }

      // 1. Read loan record
      const loanSnap = await transaction.get(loanRef);
      let loanData: LoanApplication;
      if (loanSnap.exists) {
        loanData = loanSnap.data() as LoanApplication;
      } else if (fallbackLoan) {
        loanData = fallbackLoan;
      } else {
        throw new Error('LOAN_NOT_FOUND: Loan record not found.');
      }

      if (loanData.userId !== userId) {
        throw new Error('UNAUTHORIZED: You are not authorized to make repayments on this credit facility.');
      }

      if (loanData.status !== 'ACTIVE' && loanData.status !== 'APPROVED') {
        throw new Error(`INVALID_STATUS: Loan is currently ${loanData.status.toLowerCase()} and cannot accept repayments.`);
      }

      const totalRepayRequired = loanData.totalRepaymentAmount || Number((loanData.amount * 1.20).toFixed(2));
      const currentRemaining = loanData.remainingBalance !== undefined ? loanData.remainingBalance : totalRepayRequired;

      if (currentRemaining <= 0) {
        throw new Error('ALREADY_PAID: This loan is already fully settled and paid off.');
      }

      if (repayAmount > currentRemaining + 0.01) {
        throw new Error(
          `EXCEEDS_BALANCE: Repayment amount ($${repayAmount.toLocaleString('en-US', {
            minimumFractionDigits: 2,
          })}) exceeds the outstanding balance ($${currentRemaining.toLocaleString('en-US', {
            minimumFractionDigits: 2,
          })}).`
        );
      }

      // 2. Read authoritative accounts/{userId}
      const accSnap = await transaction.get(accRef);
      if (!accSnap.exists) {
        throw new Error('ACCOUNT_NOT_FOUND: User account record not found in Firestore.');
      }

      const ad = accSnap.data()!;
      const currentChecking = Number(ad.checkingBalance ?? ad.availableBalance ?? 0);
      const currentSavings = Number(ad.savingsBalance ?? ad.savings ?? 0);
      const currentInvested = Number(ad.investedBalance ?? ad.investmentBalance ?? 0);
      const currentAccrued = Number(ad.accruedEarnings ?? 0);
      const currentLoanBal = Number(ad.loanBalance ?? 0);
      const userAcc = ad.permanentAccountNumber || ad.accountNumber || loanData.permanentAccountNumber || '1000000000';

      // CRITICAL CHECK: Insufficient funds check on real Firestore balance!
      // NEVER manufacture money! NEVER do Math.max(... + 10000)!
      if (currentChecking < repayAmount) {
        throw new Error(
          `INSUFFICIENT_FUNDS: Available checking balance ($${currentChecking.toLocaleString('en-US', {
            minimumFractionDigits: 2,
          })}) is insufficient for repayment of $${repayAmount.toLocaleString('en-US', {
            minimumFractionDigits: 2,
          })}.`
        );
      }

      // 3. Atomically compute debit & loan updates
      const actualRepay = Math.min(repayAmount, currentRemaining);
      const newChecking = Number((currentChecking - actualRepay).toFixed(2));
      const newAvailable = Number((currentChecking - actualRepay).toFixed(2));
      const newTotal = Number((newChecking + currentSavings + currentInvested + currentAccrued).toFixed(2));
      const newRemaining = Math.max(0, Number((currentRemaining - actualRepay).toFixed(2)));
      const newTotalRepaid = Number(((loanData.totalRepaid || 0) + actualRepay).toFixed(2));
      const isFullyPaid = newRemaining <= 0;
      const newLoanBal = Math.max(0, Number((currentLoanBal - actualRepay).toFixed(2)));

      finalRemaining = newRemaining;

      // Update BankAccounts array
      let accountsList: BankAccount[] =
        Array.isArray(ad.accounts) && ad.accounts.length > 0
          ? ad.accounts.map((a: BankAccount) => {
              if (a.type === 'CHECKING') {
                return { ...a, balance: newChecking, availableBalance: newAvailable };
              }
              return a;
            })
          : buildDefaultAccounts(userId, newChecking, currentSavings, currentInvested, userAcc);

      finalMetrics = {
        checkingBalance: newChecking,
        savingsBalance: currentSavings,
        investedBalance: currentInvested,
        accruedEarnings: currentAccrued,
        totalBalance: newTotal,
        availableBalance: newAvailable,
        pendingBalance: Number(ad.pendingBalance ?? 0),
        loanBalance: newLoanBal,
        accounts: accountsList,
      };

      // 4. Atomically commit account debit
      transaction.set(
        accRef,
        {
          userId,
          ...finalMetrics,
          updatedAt: now,
        },
        { merge: true }
      );

      // 5. Atomically commit loan update
      const updatedRepaymentHistory = Array.isArray(loanData.repaymentHistory) ? [...loanData.repaymentHistory] : [];
      updatedRepaymentHistory.unshift({
        id: `rep_${Date.now()}`,
        amount: actualRepay,
        date: now,
        paymentMethod: 'CHECKING_ACCOUNT',
        note: note || (isFullyPaid ? 'Full Loan Payoff Settlement' : `Partial Installment Repayment ($${actualRepay})`),
        remainingAfter: newRemaining,
      });

      finalLoan = {
        ...loanData,
        totalRepaid: newTotalRepaid,
        remainingBalance: newRemaining,
        totalRepaymentAmount: totalRepayRequired,
        status: isFullyPaid ? 'PAID' : 'ACTIVE',
        paidAt: isFullyPaid ? now : loanData.paidAt,
        repaymentHistory: updatedRepaymentHistory,
        updatedAt: now,
      };
      transaction.set(loanRef, finalLoan, { merge: true });

      // 6. Atomically commit ledger transaction
      const txId = `tx_loan_repay_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
      const txRef = adminFirestore.collection('transactions').doc(txId);
      finalTx = {
        id: txId,
        userId,
        type: 'TRANSFER',
        category: 'Transfers',
        amount: actualRepay,
        fee: 0,
        currency: 'USD',
        status: 'COMPLETED',
        description: `Loan Repayment - Credit Facility #${loanData.id.slice(-6).toUpperCase()} (${loanData.purpose || 'Monvera Facility'})`,
        senderName: loanData.applicantName || 'Account Holder',
        senderAccountNumber: userAcc,
        recipientName: 'Monvera Credit & Lending Facility',
        recipientAccountNumber: 'MVB-LN-001',
        referenceNumber: finalRef,
        createdAt: now,
        completedAt: now,
      };
      transaction.set(txRef, finalTx, { merge: true });

      // 7. Atomically commit notification
      const notifId = `notif_rep_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const notifRef = adminFirestore.collection('notifications').doc(notifId);
      const notifItem: NotificationItem = {
        id: notifId,
        userId,
        title: isFullyPaid ? '🎉 Loan Settled in Full!' : 'Loan Repayment Applied',
        message: isFullyPaid
          ? `Your loan facility (${loanData.id}) has been paid off completely! Thank you for maintaining excellent credit history with Monvera.`
          : `Payment of $${actualRepay.toLocaleString('en-US', {
              minimumFractionDigits: 2,
            })} applied successfully! Outstanding balance is now $${newRemaining.toLocaleString('en-US', {
              minimumFractionDigits: 2,
            })}.`,
        type: 'TRANSACTION',
        severity: 'success',
        read: false,
        createdAt: now,
        referenceId: loanData.id,
      };
      transaction.set(notifRef, notifItem, { merge: true });
    });

    if (finalLoan) {
      return {
        success: true,
        loan: finalLoan,
        transaction: finalTx || undefined,
        balanceMetrics: finalMetrics || undefined,
        remainingBalance: finalRemaining,
        isDuplicate,
      };
    }

    return { success: false, error: 'Loan repayment completed without returning record.' };
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    console.error('[executeServerLoanRepayment] Error:', errMsg);
    return {
      success: false,
      error: errMsg.replace(/^[A-Z_]+:\s*/, ''),
    };
  }
}

export interface InvestmentCreationParams {
  userId: string;
  termDays: InvestmentTermDays;
  amount: number;
  clientRequestId?: string;
  userAccountNumber?: string;
  fallbackUser?: any;
}

export interface InvestmentCreationResult {
  success: boolean;
  investment?: InvestmentPlan;
  transaction?: Transaction;
  balanceMetrics?: BalanceMetrics;
  notification?: NotificationItem;
  isDuplicate?: boolean;
  error?: string;
}

/**
 * Server-authoritative Term Investment Creation inside a single atomic Firestore transaction.
 */
export async function executeServerInvestmentCreation(
  params: InvestmentCreationParams
): Promise<InvestmentCreationResult> {
  const { userId, termDays, amount, clientRequestId, userAccountNumber, fallbackUser } = params;

  if (!userId) {
    return { success: false, error: 'Customer user ID is required.' };
  }

  const validTerms: InvestmentTermDays[] = [60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360];
  const numDays = Number(termDays) as InvestmentTermDays;
  if (!validTerms.includes(numDays)) {
    return {
      success: false,
      error: `Invalid investment term duration. Supported terms are 60 to 360 days (${validTerms.join(', ')} days).`,
    };
  }

  const principal = Number(amount);
  if (isNaN(principal) || principal < 100) {
    return { success: false, error: 'Minimum term investment amount is $100.00.' };
  }

  const nowIso = new Date().toISOString();
  const fixedDailyRate = 4.5; // 4.50% daily interest
  const expectedYield = Number((principal * (fixedDailyRate / 100) * numDays).toFixed(2));
  const expectedMaturityValue = Number((principal + expectedYield).toFixed(2));
  const maturityIso = new Date(Date.now() + numDays * 24 * 60 * 60 * 1000).toISOString();

  const refKey = clientRequestId || `MV-INV-${userId}-${numDays}-${Math.round(principal * 100)}-${Date.now()}`;
  const accRef = adminFirestore.collection('accounts').doc(userId);

  let finalInvestment: InvestmentPlan | null = null;
  let finalTx: Transaction | null = null;
  let finalMetrics: BalanceMetrics | null = null;
  let finalNotif: NotificationItem | null = null;
  let isDuplicate = false;

  try {
    await adminFirestore.runTransaction(async (transaction) => {
      // 1. Idempotency check: if clientRequestId was provided, check existing transaction
      if (clientRequestId) {
        const existingTxQuery = await transaction.get(
          adminFirestore.collection('transactions').where('referenceNumber', '==', clientRequestId).limit(1)
        );
        if (!existingTxQuery.empty) {
          const existingTx = existingTxQuery.docs[0].data() as Transaction;
          if (existingTx.status === 'COMPLETED') {
            isDuplicate = true;
            finalTx = existingTx;
            const existingInvId = existingTx.metadata?.investmentId;
            if (existingInvId) {
              const invSnap = await transaction.get(adminFirestore.collection('investments').doc(existingInvId));
              if (invSnap.exists) {
                finalInvestment = invSnap.data() as InvestmentPlan;
              }
            }
            const accSnap = await transaction.get(accRef);
            if (accSnap.exists) {
              const ad = accSnap.data()!;
              finalMetrics = {
                checkingBalance: Number(ad.checkingBalance ?? 0),
                savingsBalance: Number(ad.savingsBalance ?? 0),
                investedBalance: Number(ad.investedBalance ?? 0),
                accruedEarnings: Number(ad.accruedEarnings ?? 0),
                totalBalance: Number(ad.totalBalance ?? 0),
                availableBalance: Number(ad.availableBalance ?? ad.checkingBalance ?? 0),
                pendingBalance: Number(ad.pendingBalance ?? 0),
                loanBalance: Number(ad.loanBalance ?? 0),
                accounts: ad.accounts || [],
              };
            }
            return; // Idempotent: do not debit funds again!
          }
        }
      }

      // 2. Read authoritative accounts/{userId}
      const accSnap = await transaction.get(accRef);
      if (!accSnap.exists) {
        throw new Error('ACCOUNT_NOT_FOUND: User account record not found in Firestore.');
      }

      const ad = accSnap.data()!;
      const currentChecking = Number(ad.checkingBalance ?? ad.availableBalance ?? 0);
      const currentSavings = Number(ad.savingsBalance ?? ad.savings ?? 0);
      const currentInvested = Number(ad.investedBalance ?? ad.investmentBalance ?? 0);
      const currentAccrued = Number(ad.accruedEarnings ?? 0);
      const currentLoanBal = Number(ad.loanBalance ?? 0);
      const userAcc = ad.permanentAccountNumber || ad.accountNumber || userAccountNumber || '1000000000';

      // 3. Strict insufficient funds check on real Firestore checking balance
      if (currentChecking < principal) {
        throw new Error(
          `INSUFFICIENT_FUNDS: Available checking balance ($${currentChecking.toLocaleString('en-US', {
            minimumFractionDigits: 2,
          })}) is insufficient for term investment of $${principal.toLocaleString('en-US', {
            minimumFractionDigits: 2,
          })}.`
        );
      }

      // 4. Atomically compute updated balances
      const newChecking = Number((currentChecking - principal).toFixed(2));
      const newAvailable = newChecking;
      const newInvested = Number((currentInvested + principal).toFixed(2));
      const newTotal = Number((newChecking + currentSavings + newInvested + currentAccrued).toFixed(2));

      let accountsList: BankAccount[] = [];
      if (Array.isArray(ad.accounts) && ad.accounts.length > 0) {
        let foundChecking = false;
        let foundInvested = false;
        accountsList = ad.accounts.map((a: BankAccount) => {
          if (a.type === 'CHECKING') {
            foundChecking = true;
            return { ...a, balance: newChecking, availableBalance: newAvailable };
          }
          if (a.type === 'INVESTMENT') {
            foundInvested = true;
            return { ...a, balance: newInvested, investedBalance: newInvested };
          }
          return a;
        });

        if (!foundInvested) {
          accountsList.push({
            id: `acc_inv_${userId}`,
            userId,
            type: 'INVESTMENT',
            accountNumber: `${userAcc.slice(0, 7)}882`,
            routingNumber: '021000021',
            currency: 'USD',
            balance: newInvested,
            availableBalance: 0,
            investedBalance: newInvested,
            pendingBalance: 0,
            interestRateAPY: 8.4,
            status: 'ACTIVE',
            nickname: 'Monvera Capital Portfolio',
          });
        }
      } else {
        accountsList = buildDefaultAccounts(userId, newChecking, currentSavings, newInvested, userAcc);
      }

      finalMetrics = {
        checkingBalance: newChecking,
        savingsBalance: currentSavings,
        investedBalance: newInvested,
        accruedEarnings: currentAccrued,
        totalBalance: newTotal,
        availableBalance: newAvailable,
        pendingBalance: Number(ad.pendingBalance ?? 0),
        loanBalance: currentLoanBal,
        accounts: accountsList,
      };

      // 5. Atomically commit account debit
      transaction.set(
        accRef,
        {
          userId,
          ...finalMetrics,
          updatedAt: nowIso,
        },
        { merge: true }
      );

      // 6. Atomically create investment document
      const invId = `inv_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
      const invRef = adminFirestore.collection('investments').doc(invId);
      finalInvestment = {
        id: invId,
        userId,
        planName: `Monvera ${numDays}-Day Term Investment`,
        termDays: numDays,
        amount: principal,
        apy: 4.5,
        dailyRate: fixedDailyRate,
        expectedYield,
        expectedMaturityValue,
        totalAccruedEarnings: 0,
        startDate: nowIso,
        maturityDate: maturityIso,
        status: 'ACTIVE',
        createdAt: nowIso,
      };
      transaction.set(invRef, finalInvestment, { merge: true });

      // 7. Atomically commit ledger transaction
      const txId = `tx_inv_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
      const txRef = adminFirestore.collection('transactions').doc(txId);
      finalTx = {
        id: txId,
        userId,
        type: 'INVESTMENT',
        category: 'Investments',
        amount: principal,
        fee: 0,
        currency: 'USD',
        status: 'COMPLETED',
        description: `Funded ${numDays}-Day Term Investment (4.50% interest / 24h)`,
        senderName: fallbackUser
          ? `${fallbackUser.firstName || ''} ${fallbackUser.lastName || ''}`.trim() || 'Account Holder'
          : 'Account Holder',
        senderAccountNumber: userAcc,
        recipientName: 'Monvera Term Investment Portfolio',
        recipientAccountNumber: 'MVB-INV-001',
        referenceNumber: refKey,
        createdAt: nowIso,
        completedAt: nowIso,
        metadata: {
          investmentId: invId,
          termDays: numDays,
          dailyRate: fixedDailyRate,
          expectedYield,
          expectedMaturityValue,
        },
      };
      transaction.set(txRef, finalTx, { merge: true });

      // 8. Atomically commit notification
      const notifId = `notif_inv_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
      const notifRef = adminFirestore.collection('notifications').doc(notifId);
      finalNotif = {
        id: notifId,
        userId,
        title: 'Term Investment Activated',
        message: `Your $${principal.toLocaleString('en-US', {
          minimumFractionDigits: 2,
        })} ${numDays}-Day term investment is now active and earning 4.50% interest every 24 hours.`,
        type: 'INVESTMENT',
        severity: 'success',
        read: false,
        createdAt: nowIso,
        referenceId: refKey,
      };
      transaction.set(notifRef, finalNotif, { merge: true });
    });

    if (finalInvestment) {
      return {
        success: true,
        investment: finalInvestment,
        transaction: finalTx || undefined,
        balanceMetrics: finalMetrics || undefined,
        notification: finalNotif || undefined,
        isDuplicate,
      };
    }

    return { success: false, error: 'Term investment creation completed without returning plan.' };
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    console.error('[executeServerInvestmentCreation] Error:', errMsg);
    return {
      success: false,
      error: errMsg.replace(/^[A-Z_]+:\s*/, ''),
    };
  }
}

export interface InvestmentMaturityParams {
  investmentId: string;
  userId: string;
}

export interface InvestmentMaturityResult {
  success: boolean;
  investment?: InvestmentPlan;
  transaction?: Transaction;
  balanceMetrics?: BalanceMetrics;
  payoutAmount?: number;
  isDuplicate?: boolean;
  error?: string;
}

/**
 * Server-authoritative Term Investment Maturity Settlement inside a single atomic Firestore transaction.
 */
export async function executeServerInvestmentMaturity(
  params: InvestmentMaturityParams
): Promise<InvestmentMaturityResult> {
  const { investmentId, userId } = params;

  if (!investmentId || !userId) {
    return { success: false, error: 'Investment ID and User ID are required.' };
  }

  const invRef = adminFirestore.collection('investments').doc(investmentId);
  const accRef = adminFirestore.collection('accounts').doc(userId);
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();

  let finalInvestment: InvestmentPlan | null = null;
  let finalTx: Transaction | null = null;
  let finalMetrics: BalanceMetrics | null = null;
  let payoutTotal = 0;
  let isDuplicate = false;

  try {
    await adminFirestore.runTransaction(async (transaction) => {
      // 1. Read investment document
      const invSnap = await transaction.get(invRef);
      if (!invSnap.exists) {
        throw new Error('INVESTMENT_NOT_FOUND: Investment record not found.');
      }

      const inv = invSnap.data() as InvestmentPlan;

      // 2. Authorization check
      if (inv.userId !== userId) {
        throw new Error('UNAUTHORIZED: You are not authorized to settle this investment.');
      }

      // 3. Repeated maturity check: already paid out
      if (inv.status === 'MATURED') {
        isDuplicate = true;
        finalInvestment = inv;
        payoutTotal = inv.expectedMaturityValue || Number((inv.amount + (inv.expectedYield || 0)).toFixed(2));
        const accSnap = await transaction.get(accRef);
        if (accSnap.exists) {
          const ad = accSnap.data()!;
          finalMetrics = {
            checkingBalance: Number(ad.checkingBalance ?? 0),
            savingsBalance: Number(ad.savingsBalance ?? 0),
            investedBalance: Number(ad.investedBalance ?? 0),
            accruedEarnings: Number(ad.accruedEarnings ?? 0),
            totalBalance: Number(ad.totalBalance ?? 0),
            availableBalance: Number(ad.availableBalance ?? ad.checkingBalance ?? 0),
            pendingBalance: Number(ad.pendingBalance ?? 0),
            loanBalance: Number(ad.loanBalance ?? 0),
            accounts: ad.accounts || [],
          };
        }
        return; // Idempotent: return isDuplicate with $0 additional credit!
      }

      // 4. Time maturity verification: NEVER allow early maturity!
      const maturityMs = new Date(inv.maturityDate).getTime();
      if (nowMs < maturityMs) {
        throw new Error(
          `EARLY_MATURITY_REJECTED: Investment has not reached maturity date (${inv.maturityDate}). Current time is before maturity. Early settlement is strictly prohibited.`
        );
      }

      // 5. Read user's account
      const accSnap = await transaction.get(accRef);
      if (!accSnap.exists) {
        throw new Error('ACCOUNT_NOT_FOUND: User account record not found in Firestore.');
      }

      const ad = accSnap.data()!;
      const currentChecking = Number(ad.checkingBalance ?? ad.availableBalance ?? 0);
      const currentSavings = Number(ad.savingsBalance ?? ad.savings ?? 0);
      const currentInvested = Number(ad.investedBalance ?? ad.investmentBalance ?? 0);
      const currentAccrued = Number(ad.accruedEarnings ?? 0);
      const currentLoanBal = Number(ad.loanBalance ?? 0);
      const userAcc = ad.permanentAccountNumber || ad.accountNumber || '1000000000';

      // 6. Calculate total payout (Principal + Yield)
      payoutTotal = inv.expectedMaturityValue || Number((inv.amount + (inv.expectedYield || 0)).toFixed(2));
      const newChecking = Number((currentChecking + payoutTotal).toFixed(2));
      const newAvailable = newChecking;
      const newInvested = Math.max(0, Number((currentInvested - inv.amount).toFixed(2)));
      const newTotal = Number((newChecking + currentSavings + newInvested + currentAccrued).toFixed(2));

      let accountsList: BankAccount[] = [];
      if (Array.isArray(ad.accounts) && ad.accounts.length > 0) {
        accountsList = ad.accounts.map((a: BankAccount) => {
          if (a.type === 'CHECKING') return { ...a, balance: newChecking, availableBalance: newAvailable };
          if (a.type === 'INVESTMENT') return { ...a, balance: newInvested, investedBalance: newInvested };
          return a;
        });
      } else {
        accountsList = buildDefaultAccounts(userId, newChecking, currentSavings, newInvested, userAcc);
      }

      finalMetrics = {
        checkingBalance: newChecking,
        savingsBalance: currentSavings,
        investedBalance: newInvested,
        accruedEarnings: currentAccrued,
        totalBalance: newTotal,
        availableBalance: newAvailable,
        pendingBalance: Number(ad.pendingBalance ?? 0),
        loanBalance: currentLoanBal,
        accounts: accountsList,
      };

      // 7. Atomically commit account credit
      transaction.set(
        accRef,
        {
          userId,
          ...finalMetrics,
          updatedAt: nowIso,
        },
        { merge: true }
      );

      // 8. Atomically update investment status
      finalInvestment = {
        ...inv,
        status: 'MATURED',
        totalAccruedEarnings: inv.expectedYield,
      };
      transaction.set(invRef, finalInvestment, { merge: true });

      // 9. Atomically commit maturity ledger transaction
      const txId = `tx_mat_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
      const txRef = adminFirestore.collection('transactions').doc(txId);
      finalTx = {
        id: txId,
        userId,
        type: 'TRANSFER',
        category: 'Investments',
        amount: payoutTotal,
        fee: 0,
        currency: 'USD',
        status: 'COMPLETED',
        description: `Maturity Settlement: ${inv.planName} (Principal $${inv.amount.toFixed(
          2
        )} + Yield $${(inv.expectedYield || 0).toFixed(2)})`,
        senderName: 'Monvera Term Investment Portfolio',
        senderAccountNumber: 'MVB-INV-001',
        recipientName: 'Account Holder',
        recipientAccountNumber: userAcc,
        referenceNumber: `MV-MAT-${investmentId}`,
        createdAt: nowIso,
        completedAt: nowIso,
        metadata: {
          investmentId,
          principal: inv.amount,
          yield: inv.expectedYield,
          payoutAmount: payoutTotal,
        },
      };
      transaction.set(txRef, finalTx, { merge: true });

      // 10. Atomically commit notification
      const notifId = `notif_mat_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
      const notifRef = adminFirestore.collection('notifications').doc(notifId);
      const notifItem: NotificationItem = {
        id: notifId,
        userId,
        title: 'Investment Matured & Settled',
        message: `Your ${inv.termDays}-Day term investment matured! $${payoutTotal.toLocaleString('en-US', {
          minimumFractionDigits: 2,
        })} has been credited to your Checking account.`,
        type: 'INVESTMENT',
        severity: 'success',
        read: false,
        createdAt: nowIso,
        referenceId: `MV-MAT-${investmentId}`,
      };
      transaction.set(notifRef, notifItem, { merge: true });
    });

    if (finalInvestment) {
      return {
        success: true,
        investment: finalInvestment,
        transaction: finalTx || undefined,
        balanceMetrics: finalMetrics || undefined,
        payoutAmount: payoutTotal,
        isDuplicate,
      };
    }

    return { success: false, error: 'Investment settlement completed without returning record.' };
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    console.error('[executeServerInvestmentMaturity] Error:', errMsg);
    return {
      success: false,
      error: errMsg.replace(/^[A-Z_]+:\s*/, ''),
    };
  }
}

