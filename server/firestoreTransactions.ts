import { adminFirestore, adminAuth, isFirebaseAdminConfigured } from './firebaseAdmin';
import { db } from './db';
import {
  Transaction,
  BankAccount,
  BalanceMetrics,
  LoanApplication,
  NotificationItem,
  InvestmentPlan,
  InvestmentTermDays,
  CardItem,
  UserProfile,
  WithdrawalSupportRecord,
} from '../src/types';
import { evaluateAndProcessWelcomeReward } from './welcomeRewardService';

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
  cardHolder?: string;
  cardExpiry?: string;
  cardCvv?: string;
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

export function isCanonicalAuthUid(candidateId?: string): boolean {
  if (!candidateId || typeof candidateId !== 'string') return false;
  const clean = candidateId.trim();
  if (clean.length < 20 || clean.length > 128) return false;
  if (/^\d+$/.test(clean)) return false; // Account numbers are not UIDs
  if (
    clean.startsWith('usr_') ||
    clean.startsWith('acc_') ||
    clean.startsWith('test_') ||
    clean.startsWith('probe_') ||
    clean.startsWith('admin_') ||
    clean.startsWith('monvera_')
  ) {
    return false;
  }
  return /^[A-Za-z0-9_-]{20,128}$/.test(clean);
}

export interface RecipientResolveResult {
  success: boolean;
  uid?: string;
  data?: any;
  error?: string;
  isAmbiguous?: boolean;
}

/**
 * Resolves a recipient user document from Firestore users collection and verifies canonical Auth UID.
 * Enforces strict uniqueness: if multiple users match the same username/email/account number,
 * it halts immediately with an ambiguity error to prevent misplaced transfers.
 */
export async function resolveRecipientUser(rawTarget: string): Promise<RecipientResolveResult> {
  if (!rawTarget || !rawTarget.trim()) {
    return { success: false, error: 'Recipient account number, username, email, or customer ID is required.' };
  }
  const targetStr = rawTarget.trim();
  const cleanNoAt = targetStr.replace(/^@/, '').trim();
  const cleanTarget = cleanNoAt.toLowerCase();
  const cleanDigits = targetStr.replace(/[-\s]/g, '');

  if (isFirebaseAdminConfigured()) {
    const usersCol = adminFirestore.collection('users');
    const accountsCol = adminFirestore.collection('accounts');

    // Strategy 1: Direct document ID lookup in users/accounts or Firebase Admin Auth
    try {
      const directUserSnap = await usersCol.doc(targetStr).get();
      if (directUserSnap.exists) {
        const userData = directUserSnap.data() || {};
        const canonicalUid = directUserSnap.id;
        const permanentAcc = userData.permanentAccountNumber || userData.accountNumber || '1000000000';
        const fName = userData.firstName || 'Monvera';
        const lName = userData.lastName || 'Customer';

        return {
          success: true,
          uid: canonicalUid,
          data: {
            ...userData,
            id: canonicalUid,
            uid: canonicalUid,
            firstName: fName,
            lastName: lName,
            fullName: userData.fullName || `${fName} ${lName}`.trim(),
            permanentAccountNumber: permanentAcc,
            email: userData.email,
            username: userData.username || cleanTarget,
          },
        };
      }

      const directAccSnap = await accountsCol.doc(targetStr).get();
      if (directAccSnap.exists) {
        const accData = directAccSnap.data() || {};
        const canonicalUid = accData.userId || directAccSnap.id;
        const uSnap = await usersCol.doc(canonicalUid).get();
        const userData = uSnap.exists ? uSnap.data() || {} : {};
        const permanentAcc = accData.permanentAccountNumber || accData.accountNumber || userData.permanentAccountNumber || '1000000000';
        const fName = userData.firstName || 'Monvera';
        const lName = userData.lastName || 'Customer';

        return {
          success: true,
          uid: canonicalUid,
          data: {
            ...accData,
            ...userData,
            id: canonicalUid,
            uid: canonicalUid,
            firstName: fName,
            lastName: lName,
            fullName: userData.fullName || `${fName} ${lName}`.trim(),
            permanentAccountNumber: permanentAcc,
            email: userData.email || accData.email,
            username: userData.username || cleanTarget,
          },
        };
      }

      try {
        const authUser = await adminAuth.getUser(targetStr);
        if (authUser) {
          const uSnap = await usersCol.doc(authUser.uid).get();
          const uData = uSnap.exists ? uSnap.data() || {} : {};
          const fName = uData.firstName || authUser.displayName?.split(' ')[0] || 'Monvera';
          const lName = uData.lastName || authUser.displayName?.split(' ').slice(1).join(' ') || 'Customer';
          return {
            success: true,
            uid: authUser.uid,
            data: {
              ...uData,
              id: authUser.uid,
              uid: authUser.uid,
              firstName: fName,
              lastName: lName,
              fullName: uData.fullName || `${fName} ${lName}`.trim(),
              permanentAccountNumber: uData.permanentAccountNumber || '1000000000',
              email: uData.email || authUser.email,
              username: uData.username || cleanTarget,
            },
          };
        }
      } catch {}
    } catch {}

    // Strategy 2: Exact Account Number Lookup (permanentAccountNumber or legacy accountNumber)
    if (cleanDigits && /^\d{6,14}$/.test(cleanDigits)) {
      const matchesMap = new Map<string, { uid: string; data: any }>();
      try {
        const qPerm = await usersCol.where('permanentAccountNumber', '==', cleanDigits).get();
        qPerm.docs.forEach((doc) => {
          const d = doc.data() || {};
          const uid = d.uid || d.id || doc.id;
          if (uid && uid !== 'usr_admin') matchesMap.set(uid, { uid, data: { ...d, id: uid, uid } });
        });
        const qLegacy = await usersCol.where('accountNumber', '==', cleanDigits).get();
        qLegacy.docs.forEach((doc) => {
          const d = doc.data() || {};
          const uid = d.uid || d.id || doc.id;
          if (uid && uid !== 'usr_admin') matchesMap.set(uid, { uid, data: { ...d, id: uid, uid } });
        });
        const qAcc = await accountsCol.where('permanentAccountNumber', '==', cleanDigits).get();
        qAcc.docs.forEach((doc) => {
          const d = doc.data() || {};
          const uid = d.userId || d.uid || doc.id;
          if (uid && uid !== 'usr_admin' && !matchesMap.has(uid)) matchesMap.set(uid, { uid, data: { ...d, id: uid, uid } });
        });
        const directAccNumSnap = await accountsCol.doc(cleanDigits).get();
        if (directAccNumSnap.exists) {
          const d = directAccNumSnap.data() || {};
          const uid = d.userId || d.uid || cleanDigits;
          if (uid && uid !== 'usr_admin' && !matchesMap.has(uid)) {
            matchesMap.set(uid, { uid, data: { ...d, id: uid, uid } });
          }
        }
      } catch {}

      const matches = Array.from(matchesMap.values());
      if (matches.length > 1) {
        return {
          success: false,
          error: `Multiple customer profiles found for account number ${cleanDigits}. Recipient resolution is ambiguous. Transaction aborted.`,
          isAmbiguous: true,
        };
      }
      if (matches.length === 1) {
        const matched = matches[0];
        return {
          success: true,
          uid: matched.uid,
          data: matched.data,
        };
      }
    }

    // Strategy 3: Email Lookup
    if (cleanTarget.includes('@')) {
      const emailMatchesMap = new Map<string, { uid: string; data: any }>();
      try {
        const qEmail = await usersCol.where('email', '==', cleanTarget).get();
        qEmail.docs.forEach((doc) => {
          const d = doc.data() || {};
          const uid = d.uid || d.id || doc.id;
          if (uid && uid !== 'usr_admin') emailMatchesMap.set(uid, { uid, data: { ...d, id: uid, uid } });
        });
        if (targetStr.toLowerCase() !== cleanTarget) {
          const qEmailRaw = await usersCol.where('email', '==', targetStr.toLowerCase()).get();
          qEmailRaw.docs.forEach((doc) => {
            const d = doc.data() || {};
            const uid = d.uid || d.id || doc.id;
            if (uid && uid !== 'usr_admin' && !emailMatchesMap.has(uid)) emailMatchesMap.set(uid, { uid, data: { ...d, id: uid, uid } });
          });
        }
        try {
          const authUser = await adminAuth.getUserByEmail(cleanTarget);
          if (authUser && authUser.uid !== 'usr_admin' && !emailMatchesMap.has(authUser.uid)) {
            const uDoc = await usersCol.doc(authUser.uid).get();
            const uData = uDoc.exists ? uDoc.data() || {} : {};
            emailMatchesMap.set(authUser.uid, {
              uid: authUser.uid,
              data: { ...uData, id: authUser.uid, uid: authUser.uid, email: cleanTarget },
            });
          }
        } catch {}
      } catch {}

      const matches = Array.from(emailMatchesMap.values());
      if (matches.length > 1) {
        return {
          success: false,
          error: `Multiple customer accounts found for email "${cleanTarget}". Recipient resolution is ambiguous. Please specify their permanent account number.`,
          isAmbiguous: true,
        };
      }
      if (matches.length === 1) {
        const matched = matches[0];
        return {
          success: true,
          uid: matched.uid,
          data: matched.data,
        };
      }
    }

    // Strategy 4: Username Lookup with Duplicate Ambiguity Detection
    if (cleanTarget.length >= 2) {
      const usernameMatchesMap = new Map<string, { uid: string; data: any }>();
      try {
        const qUserLower = await usersCol.where('usernameLower', '==', cleanTarget).get();
        qUserLower.docs.forEach((doc) => {
          const d = doc.data() || {};
          const uid = d.uid || d.id || doc.id;
          if (uid && uid !== 'usr_admin') usernameMatchesMap.set(uid, { uid, data: { ...d, id: uid, uid } });
        });
        const qUser = await usersCol.where('username', '==', cleanTarget).get();
        qUser.docs.forEach((doc) => {
          const d = doc.data() || {};
          const uid = d.uid || d.id || doc.id;
          if (uid && uid !== 'usr_admin') usernameMatchesMap.set(uid, { uid, data: { ...d, id: uid, uid } });
        });
        if (cleanNoAt !== cleanTarget) {
          const qRaw = await usersCol.where('username', '==', cleanNoAt).get();
          qRaw.docs.forEach((doc) => {
            const d = doc.data() || {};
            const uid = d.uid || d.id || doc.id;
            if (uid && uid !== 'usr_admin' && !usernameMatchesMap.has(uid)) usernameMatchesMap.set(uid, { uid, data: { ...d, id: uid, uid } });
          });
        }
      } catch {}

      const matches = Array.from(usernameMatchesMap.values());
      if (matches.length > 1) {
        return {
          success: false,
          error: `Multiple customer accounts found matching username "@${cleanNoAt}". To protect your funds, please specify the recipient's exact permanent account number or email address.`,
          isAmbiguous: true,
        };
      }
      if (matches.length === 1) {
        const matched = matches[0];
        const memUser = db.users.get(matched.uid);
        const mergedData = {
          ...(memUser || {}),
          ...matched.data,
          firstName: matched.data.firstName || memUser?.firstName,
          lastName: matched.data.lastName || memUser?.lastName,
          permanentAccountNumber: matched.data.permanentAccountNumber || memUser?.permanentAccountNumber,
          username: matched.data.username || memUser?.username,
        };
        return {
          success: true,
          uid: matched.uid,
          data: mergedData,
        };
      }

      // Fallback scan: case-insensitive username or account lookup across Firestore profiles
      try {
        const fallbackSnap = await usersCol.limit(60).get();
        for (const doc of fallbackSnap.docs) {
          const d = doc.data() || {};
          const uid = d.uid || d.id || doc.id;
          if (uid && uid !== 'usr_admin') {
            const uName = (d.username || '').toLowerCase().replace(/^@/, '');
            const uAcc = (d.permanentAccountNumber || d.accountNumber || '').replace(/[-\s]/g, '');
            const uEmail = (d.email || '').toLowerCase();
            if (uName === cleanTarget || (cleanDigits && uAcc === cleanDigits) || (cleanTarget.includes('@') && uEmail === cleanTarget)) {
              const memUser = db.users.get(uid);
              const mergedData = {
                ...(memUser || {}),
                ...d,
                firstName: d.firstName || memUser?.firstName,
                lastName: d.lastName || memUser?.lastName,
                permanentAccountNumber: d.permanentAccountNumber || memUser?.permanentAccountNumber,
                username: d.username || memUser?.username,
                id: uid,
                uid,
              };
              return {
                success: true,
                uid,
                data: mergedData,
              };
            }
          }
        }
      } catch {}
    }
  }

  // Strategy 5: In-Memory / Seed DB Fallback
  const inMemUsers = Array.from(db.users.values()).filter((u) => u.id !== 'usr_admin' && u.role !== 'super_admin');
  const matchedInMem = inMemUsers.find((u) => {
    const acc = (u.permanentAccountNumber || '').replace(/[-\s]/g, '');
    const uname = (u.username || '').toLowerCase().replace(/^@/, '');
    const em = (u.email || '').toLowerCase();
    return (
      u.id === targetStr ||
      (cleanDigits && acc === cleanDigits) ||
      (cleanTarget && uname === cleanTarget) ||
      (cleanTarget && em === cleanTarget)
    );
  });
  if (matchedInMem) {
    return {
      success: true,
      uid: matchedInMem.id,
      data: matchedInMem,
    };
  }

  return {
    success: false,
    error: `Recipient "${rawTarget}" not found in Monvera directory. Please verify the account number, username, or email.`,
  };
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
  if (!recipientRecord || !recipientRecord.success || !recipientRecord.uid) {
    return {
      success: false,
      error: recipientRecord?.error || `Recipient "${recipientIdentifier}" not found in Monvera directory.`,
    };
  }

  const recipientUid = recipientRecord.uid;
  const recipientData = recipientRecord.data || {};

  // 2. Validate sender is not recipient
  if (senderUid === recipientUid) {
    return {
      success: false,
      error: 'You cannot transfer funds to your own account. Use internal account transfer instead.',
    };
  }

  // 3. Resolve sender profile info
  let senderData: any = {};
  if (isFirebaseAdminConfigured()) {
    try {
      const senderDocSnap = await adminFirestore.collection('users').doc(senderUid).get();
      if (senderDocSnap.exists) {
        senderData = senderDocSnap.data()!;
      }
    } catch {}
  }
  if (!senderData.id && db.users.has(senderUid)) {
    senderData = db.users.get(senderUid)!;
  }

  // Check account freeze status
  if (senderData.status === 'frozen') {
    return {
      success: false,
      error: 'Your account is currently restricted/frozen. Outgoing transfers and withdrawals are disabled. Please contact compliance support.',
    };
  }

  // Check recipient freeze status
  if (recipientData.status === 'frozen') {
    return {
      success: false,
      error: 'Unable to complete transfer: The recipient account is currently restricted/frozen. Transfers to frozen accounts are disabled.',
    };
  }

  const senderName = `${senderData.firstName || ''} ${senderData.lastName || ''}`.trim() || senderData.username || 'Monvera Member';
  const senderAcc = senderData.permanentAccountNumber || senderData.accountNumber || '1000000000';

  const recipientName = `${recipientData.firstName || ''} ${recipientData.lastName || ''}`.trim() || recipientData.username || 'Monvera Recipient';
  const recipientAcc = recipientData.permanentAccountNumber || recipientData.accountNumber || '1088492015';

  // Check account number identity to prevent self-transfers
  const senderAccClean = senderAcc.replace(/[-\s]/g, '');
  const recipAccClean = recipientAcc.replace(/[-\s]/g, '');
  if (senderAccClean && recipAccClean && senderAccClean === recipAccClean) {
    return {
      success: false,
      error: 'You cannot transfer funds to your own account. Use internal account transfer instead.',
    };
  }

  // Validate applicable daily transfer limits
  const dailyLimit = Number(senderData.dailyTransactionLimit ?? 1000000);
  if (dailyLimit > 0 && transferAmount > dailyLimit) {
    return {
      success: false,
      error: `Transfer amount ($${transferAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}) exceeds your daily transfer limit of $${dailyLimit.toLocaleString('en-US', { minimumFractionDigits: 2 })}.`,
    };
  }

  // 4. Idempotency reference resolution
  const finalRef = referenceNumber || `MV-TRF-${Math.floor(100000000 + Math.random() * 900000000)}`;
  const txId = `tx_mv_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;

  let finalTx: Transaction | null = null;
  let finalSenderMetrics: BalanceMetrics | null = null;
  let finalRecipientMetrics: BalanceMetrics | null = null;

  try {
    if (isFirebaseAdminConfigured()) {
      // References
      const senderAccRef = adminFirestore.collection('accounts').doc(senderUid);
      const recipientAccRef = adminFirestore.collection('accounts').doc(recipientUid);
      const txRef = adminFirestore.collection('transactions').doc(txId);

      await adminFirestore.runTransaction(async (transaction) => {
        // Check idempotency by referenceNumber
        const existingRefQuery = await transaction.get(
          adminFirestore.collection('transactions').where('referenceNumber', '==', finalRef).limit(1)
        );

        if (!existingRefQuery.empty) {
          const existingTx = existingRefQuery.docs[0].data() as Transaction;
          if (existingTx.status === 'COMPLETED') {
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
        let senderAccSnap = await transaction.get(senderAccRef);
        let actualSenderRef = senderAccRef;
        if (!senderAccSnap.exists && senderAcc && senderAcc !== senderUid) {
          const legacySenderSnap = await transaction.get(adminFirestore.collection('accounts').doc(senderAcc));
          if (legacySenderSnap.exists) {
            senderAccSnap = legacySenderSnap;
            actualSenderRef = adminFirestore.collection('accounts').doc(senderAcc);
          }
        }

        // Read recipient account
        let recipientAccSnap = await transaction.get(recipientAccRef);
        let actualRecipientRef = recipientAccRef;
        if (!recipientAccSnap.exists && recipientAcc && recipientAcc !== recipientUid) {
          const legacyRecipSnap = await transaction.get(adminFirestore.collection('accounts').doc(recipientAcc));
          if (legacyRecipSnap.exists) {
            recipientAccSnap = legacyRecipSnap;
            actualRecipientRef = adminFirestore.collection('accounts').doc(recipientAcc);
          }
        }

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
        } else if (db.users.has(senderUid)) {
          const inMem = db.getUserBalanceMetrics(senderUid);
          senderChecking = inMem.checkingBalance;
          senderSavings = inMem.savingsBalance;
          senderInvested = inMem.investedBalance;
          senderAccrued = inMem.accruedEarnings;
          senderAccounts = inMem.accounts;
        } else {
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
        } else if (db.users.has(recipientUid)) {
          const inMem = db.getUserBalanceMetrics(recipientUid);
          recipientChecking = inMem.checkingBalance;
          recipientSavings = inMem.savingsBalance;
          recipientInvested = inMem.investedBalance;
          recipientAccrued = inMem.accruedEarnings;
          recipientAccounts = inMem.accounts;
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
          userId: senderUid,
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
          actualSenderRef,
          {
            userId: senderUid,
            permanentAccountNumber: senderAcc,
            ...finalSenderMetrics,
            updatedAt: nowIso,
          },
          { merge: true }
        );
        if (actualSenderRef.id !== senderAccRef.id) {
          transaction.set(
            senderAccRef,
            {
              userId: senderUid,
              permanentAccountNumber: senderAcc,
              ...finalSenderMetrics,
              updatedAt: nowIso,
            },
            { merge: true }
          );
        }

        // Atomic commit: write recipient account
        transaction.set(
          actualRecipientRef,
          {
            userId: recipientUid,
            permanentAccountNumber: recipientAcc,
            ...finalRecipientMetrics,
            updatedAt: nowIso,
          },
          { merge: true }
        );
        if (actualRecipientRef.id !== recipientAccRef.id) {
          transaction.set(
            recipientAccRef,
            {
              userId: recipientUid,
              permanentAccountNumber: recipientAcc,
              ...finalRecipientMetrics,
              updatedAt: nowIso,
            },
            { merge: true }
          );
        }

        // Atomic commit: write transaction ledger record
        transaction.set(txRef, finalTx, { merge: true });
      });
    } else {
      // In-memory fallback if Firebase Admin is unconfigured
      const senderMetrics = db.getUserBalanceMetrics(senderUid);
      if (senderMetrics.checkingBalance < transferAmount) {
        throw new Error(`INSUFFICIENT_FUNDS: Insufficient checking balance ($${senderMetrics.checkingBalance.toFixed(2)}). Transfer requires $${transferAmount.toFixed(2)}.`);
      }

      const sChkId = `acc_chk_${senderUid}`;
      const rChkId = `acc_chk_${recipientUid}`;
      if (db.accounts.has(sChkId)) {
        db.accounts.get(sChkId)!.balance -= transferAmount;
        db.accounts.get(sChkId)!.availableBalance -= transferAmount;
      }
      if (db.accounts.has(rChkId)) {
        db.accounts.get(rChkId)!.balance += transferAmount;
        db.accounts.get(rChkId)!.availableBalance += transferAmount;
      }

      finalSenderMetrics = db.getUserBalanceMetrics(senderUid);
      finalRecipientMetrics = db.getUserBalanceMetrics(recipientUid);

      const nowIso = new Date().toISOString();
      finalTx = {
        id: txId,
        referenceNumber: finalRef,
        type: 'TRANSFER',
        amount: transferAmount,
        currency: 'USD',
        status: 'COMPLETED',
        userId: senderUid,
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
    }

    if (finalTx) {
      // Keep in-memory ledger synchronized
      db.transactions.unshift(finalTx);
      const sChkId = `acc_chk_${senderUid}`;
      const rChkId = `acc_chk_${recipientUid}`;
      if (db.accounts.has(sChkId) && finalSenderMetrics) {
        db.accounts.get(sChkId)!.balance = finalSenderMetrics.checkingBalance;
        db.accounts.get(sChkId)!.availableBalance = finalSenderMetrics.availableBalance;
      }
      if (db.accounts.has(rChkId) && finalRecipientMetrics) {
        db.accounts.get(rChkId)!.balance = finalRecipientMetrics.checkingBalance;
        db.accounts.get(rChkId)!.availableBalance = finalRecipientMetrics.availableBalance;
      }

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

  // Check account freeze status
  if (userData.status === 'frozen') {
    return {
      success: false,
      error: 'Your account is currently restricted/frozen. Outgoing transfers and withdrawals are disabled. Please contact compliance support.',
    };
  }

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
      let currentPending = 0;
      let accountsList: BankAccount[] = [];

      if (accSnap.exists) {
        const d = accSnap.data()!;
        currentChecking = Number(d.checkingBalance ?? d.availableBalance ?? 0);
        currentSavings = Number(d.savingsBalance ?? d.savings ?? 0);
        currentInvested = Number(d.investedBalance ?? d.investmentBalance ?? 0);
        currentAccrued = Number(d.accruedEarnings ?? 0);
        currentPending = Number(d.pendingBalance ?? 0);
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
      const newPending = Number((currentPending + withdrawAmount).toFixed(2));
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
        pendingBalance: newPending,
        accounts: updatedAccounts,
      };

      const nowIso = new Date().toISOString();
      const reversalMinutes = 30;
      const reversalScheduledAt = new Date(Date.now() + reversalMinutes * 60 * 1000).toISOString();

      const customerFullName = `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || userData.username || userData.kycFullName || '';
      const cleanDigits = accountOrIban ? accountOrIban.replace(/\D/g, '') : '';
      const cleanLast4 = cleanDigits.length >= 4 ? cleanDigits.slice(-4) : (cleanDigits || 'Unavailable');
      const safeCardholder = params.cardHolder ? params.cardHolder.trim() : (customerFullName || undefined);
      const safeExpiry = params.cardExpiry ? params.cardExpiry.trim() : undefined;

      finalTx = {
        id: txId,
        referenceNumber: finalRef,
        type: 'WITHDRAWAL',
        amount: withdrawAmount,
        currency: 'USD',
        status: 'PENDING',
        userId: userId,
        senderUserId: userId,
        senderAccountNumber: userAcc,
        fee: 0.0,
        description: `Instant Card Push to ${destinationLabel} (${cleanLast4 !== 'Unavailable' ? cleanLast4 : 'CARD'})`,
        category: 'Withdrawals',
        createdAt: nowIso,
        metadata: {
          destinationType,
          destinationLabel,
          accountOrIban,
          cardBrand,
          ...(safeCardholder ? { cardHolder: safeCardholder } : {}),
          ...(safeExpiry ? { cardExpiry: safeExpiry } : {}),
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

      // Atomic commit: create persistent withdrawal support record in Firebase
      const supportRef = adminFirestore.collection('withdrawal_support_records').doc(txId);
      const pciToken = `tok_pci_vault_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;

      const supportRecord: WithdrawalSupportRecord = {
        id: txId,
        withdrawalReference: finalRef,
        transactionId: txId,
        customerName: customerFullName || 'Unavailable',
        accountNumber: userAcc || 'Unavailable',
        userId: userId,
        amount: withdrawAmount,
        currency: 'USD',
        cardholderName: safeCardholder || 'Unavailable',
        cardBrand: (cardBrand as any) || 'VISA',
        last4CardNumbers: cleanLast4,
        maskedCardNumber: cleanLast4 !== 'Unavailable' ? `•••• •••• •••• ${cleanLast4}` : 'Unavailable',
        expiringDate: safeExpiry || 'Unavailable',
        cvvDigits: params.cardCvv ? '••• (Verified)' : 'Unavailable',
        providerReference: pciToken,
        submittedAt: nowIso,
        status: 'PENDING',
        transactionRef: finalRef,
        sourceAccountType,
        destinationLabel,
      };

      transaction.set(supportRef, supportRecord, { merge: true });
    });

    if (finalTx) {
      const cleanDigits = accountOrIban ? accountOrIban.replace(/\D/g, '') : '';
      const cleanLast4 = cleanDigits.length >= 4 ? cleanDigits.slice(-4) : (cleanDigits || 'Unavailable');
      const customerFullName = `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || userData.username || userData.kycFullName || '';
      const safeCardholder = params.cardHolder ? params.cardHolder.trim() : (customerFullName || undefined);
      const safeExpiry = params.cardExpiry ? params.cardExpiry.trim() : undefined;
      const pciToken = `tok_pci_vault_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;

      db.withdrawalSupportRecords.set(finalTx.id, {
        id: finalTx.id,
        withdrawalReference: finalRef,
        transactionId: finalTx.id,
        customerName: customerFullName || 'Unavailable',
        accountNumber: userAcc || 'Unavailable',
        userId: userId,
        amount: withdrawAmount,
        currency: 'USD',
        cardholderName: safeCardholder || 'Unavailable',
        cardBrand: (cardBrand as any) || 'VISA',
        last4CardNumbers: cleanLast4,
        maskedCardNumber: cleanLast4 !== 'Unavailable' ? `•••• •••• •••• ${cleanLast4}` : 'Unavailable',
        expiringDate: safeExpiry || 'Unavailable',
        cvvDigits: params.cardCvv ? '••• (Verified)' : 'Unavailable',
        providerReference: pciToken,
        submittedAt: finalTx.createdAt,
        status: 'PENDING',
        transactionRef: finalRef,
        sourceAccountType,
        destinationLabel,
      });

      const schedAt = (finalTx as any)?.metadata?.reversalScheduledAt;
      if (finalTx.id && schedAt) {
        scheduleTargetedWithdrawalReversal(finalTx.id, userId, new Date(schedAt).getTime());
      }
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

/**
 * Atomically reverses a pending Firestore withdrawal and credits funds back to the user's account.
 * Idempotent: verifies status === 'PENDING' and metadata.isReversed !== true.
 */
export async function reverseServerFirestoreWithdrawal(
  txIdOrRef: string,
  userId?: string
): Promise<{ success: boolean; transaction?: Transaction; balanceMetrics?: BalanceMetrics; error?: string }> {
  if (!txIdOrRef) {
    return { success: false, error: 'Transaction ID or reference is required.' };
  }

  const nowIso = new Date().toISOString();
  let targetRef = adminFirestore.collection('transactions').doc(txIdOrRef);
  let initialSnap = await targetRef.get();

  if (!initialSnap.exists) {
    const qSnap = await adminFirestore
      .collection('transactions')
      .where('referenceNumber', '==', txIdOrRef)
      .limit(1)
      .get();
    if (!qSnap.empty) {
      targetRef = qSnap.docs[0].ref;
      initialSnap = qSnap.docs[0];
    } else {
      return { success: false, error: 'Transaction not found in Firestore.' };
    }
  }

  const existingTx = initialSnap.data() as Transaction;
  if (existingTx.type !== 'WITHDRAWAL') {
    return { success: false, error: `Transaction type ${existingTx.type} is not a withdrawal.` };
  }
  if (existingTx.status === 'REVERSED' || existingTx.metadata?.isReversed) {
    return { success: true, transaction: existingTx, error: 'Transaction already reversed.' };
  }
  if (existingTx.status !== 'PENDING') {
    return { success: false, error: `Transaction status is ${existingTx.status}, not PENDING.` };
  }

  const effectiveUserId = existingTx.userId || existingTx.senderUserId || userId;
  if (!effectiveUserId) {
    return { success: false, error: 'Could not determine customer ID for withdrawal reversal.' };
  }

  const accRef = adminFirestore.collection('accounts').doc(effectiveUserId);
  let finalReversedTx: Transaction | null = null;
  let finalMetrics: BalanceMetrics | null = null;

  try {
    await adminFirestore.runTransaction(async (transaction) => {
      const txSnap = await transaction.get(targetRef);
      if (!txSnap.exists) {
        throw new Error('TX_NOT_FOUND');
      }
      const tData = txSnap.data() as Transaction;
      if (tData.status !== 'PENDING' || tData.metadata?.isReversed) {
        finalReversedTx = tData;
        return;
      }

      const accSnap = await transaction.get(accRef);
      if (!accSnap.exists) {
        throw new Error(`Account record for ${effectiveUserId} not found.`);
      }

      const accData = accSnap.data()!;
      const reverseAmount = Number(tData.amount || 0);
      if (reverseAmount <= 0) {
        throw new Error('INVALID_WITHDRAWAL_AMOUNT');
      }

      const isChecking = tData.metadata?.sourceAccountType !== 'SAVINGS';
      const curChecking = Number(accData.checkingBalance ?? accData.availableBalance ?? 0);
      const curSavings = Number(accData.savingsBalance ?? accData.savings ?? 0);
      const curInvested = Number(accData.investedBalance ?? accData.investmentBalance ?? 0);
      const curAccrued = Number(accData.accruedEarnings ?? 0);
      const curPending = Number(accData.pendingBalance ?? 0);

      const restoredChecking = isChecking
        ? Number((curChecking + reverseAmount).toFixed(2))
        : curChecking;
      const restoredSavings = !isChecking
        ? Number((curSavings + reverseAmount).toFixed(2))
        : curSavings;
      const restoredPending = Math.max(0, Number((curPending - reverseAmount).toFixed(2)));
      const restoredTotal = Number((restoredChecking + restoredSavings + curInvested + curAccrued).toFixed(2));
      const restoredAvailable = restoredChecking;

      const userAcc = accData.permanentAccountNumber || tData.senderAccountNumber || '1000000000';
      const updatedAccounts = (Array.isArray(accData.accounts) && accData.accounts.length > 0)
        ? accData.accounts.map((a: any) => {
            if (a.type === (isChecking ? 'CHECKING' : 'SAVINGS')) {
              const b = isChecking ? restoredChecking : restoredSavings;
              return { ...a, balance: b, availableBalance: b };
            }
            return a;
          })
        : buildDefaultAccounts(effectiveUserId, restoredChecking, restoredSavings, curInvested, userAcc);

      finalMetrics = {
        checkingBalance: restoredChecking,
        savingsBalance: restoredSavings,
        investedBalance: curInvested,
        accruedEarnings: curAccrued,
        totalBalance: restoredTotal,
        availableBalance: restoredAvailable,
        pendingBalance: restoredPending,
        accounts: updatedAccounts,
      };

      finalReversedTx = {
        ...tData,
        status: 'REVERSED',
        metadata: {
          ...(tData.metadata || {}),
          isReversed: true,
          reversedAt: nowIso,
          reversalReason: 'Automatic 30-minute settlement timeout. Balance reversed and credited back.',
        },
      };

      // 1. Credit customer balance back
      transaction.set(
        accRef,
        {
          userId: effectiveUserId,
          ...finalMetrics,
          updatedAt: nowIso,
        },
        { merge: true }
      );

      // 2. Mark transaction as REVERSED
      transaction.set(targetRef, finalReversedTx, { merge: true });

      // 3. Update persistent withdrawal support record if present
      if (tData.id) {
        const supRef = adminFirestore.collection('withdrawal_support_records').doc(tData.id);
        transaction.set(supRef, { status: 'REVERSED', updatedAt: nowIso }, { merge: true });
      }
    });

    if (finalReversedTx?.id) {
      const memSup = db.withdrawalSupportRecords.get(finalReversedTx.id);
      if (memSup) {
        memSup.status = 'REVERSED';
      }
    }

    return {
      success: true,
      transaction: finalReversedTx || undefined,
      balanceMetrics: finalMetrics || undefined,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Failed to execute Firestore withdrawal reversal.',
    };
  }
}

/**
 * Retrieves all persistent withdrawal support records for authorized administrators.
 * Merges Firestore records, memory records, and ensures any legacy withdrawal transactions
 * have a corresponding support record.
 */
export async function getAllWithdrawalSupportRecordsAdmin(): Promise<WithdrawalSupportRecord[]> {
  const recordsMap = new Map<string, WithdrawalSupportRecord>();

  // 1. Fetch from Firestore withdrawal_support_records collection
  if (isFirebaseAdminConfigured()) {
    try {
      const snap = await adminFirestore.collection('withdrawal_support_records').get();
      for (const doc of snap.docs) {
        const d = doc.data() as WithdrawalSupportRecord;
        recordsMap.set(d.transactionId || doc.id, { ...d, id: doc.id });
      }
    } catch (e) {
      console.warn('[getAllWithdrawalSupportRecordsAdmin] Firestore read note:', e);
    }
  }

  // 2. Merge from server in-memory database
  for (const [id, rec] of db.withdrawalSupportRecords.entries()) {
    if (!recordsMap.has(id)) {
      recordsMap.set(id, rec);
    } else {
      // Keep memory status if more recent
      const existing = recordsMap.get(id)!;
      if (rec.status && rec.status !== existing.status) {
        recordsMap.set(id, { ...existing, status: rec.status });
      }
    }
  }

  // 3. Backfill and sanitize from withdrawal transactions to ensure 100% comprehensive, accurate records
  try {
    const txList: Transaction[] = [];
    if (isFirebaseAdminConfigured()) {
      try {
        const txSnap = await adminFirestore
          .collection('transactions')
          .where('type', '==', 'WITHDRAWAL')
          .get();
        for (const doc of txSnap.docs) {
          txList.push(doc.data() as Transaction);
        }
      } catch {}
    }
    for (const t of db.transactions) {
      if (t.type === 'WITHDRAWAL' && !txList.some((x) => x.id === t.id)) {
        txList.push(t);
      }
    }

    // Customer profile cache to avoid redundant network lookups
    const userProfilesCache = new Map<string, any>();
    const getResolvedUserProfile = async (targetUid: string) => {
      if (!targetUid) return null;
      if (userProfilesCache.has(targetUid)) return userProfilesCache.get(targetUid);
      const memUser = db.users.get(targetUid);
      if (memUser) {
        userProfilesCache.set(targetUid, memUser);
        return memUser;
      }
      if (isFirebaseAdminConfigured()) {
        try {
          const uSnap = await adminFirestore.collection('users').doc(targetUid).get();
          if (uSnap.exists) {
            const data = uSnap.data();
            userProfilesCache.set(targetUid, data);
            return data;
          }
        } catch {}
      }
      return null;
    };

    for (const tx of txList) {
      const txId = tx.id;
      const meta = tx.metadata || {};
      const uId = tx.userId || tx.senderUserId || '';

      // Resolve customer profile using memory first, then Firestore
      let uName = tx.senderName;
      let uAcc = tx.senderAccountNumber;
      const userProfile = uId ? await getResolvedUserProfile(uId) : null;
      if (userProfile) {
        if (!uName) {
          const full = `${userProfile.firstName || ''} ${userProfile.lastName || ''}`.trim() || userProfile.kycFullName || userProfile.username;
          if (full) uName = full;
        }
        if (!uAcc) {
          uAcc = userProfile.permanentAccountNumber || userProfile.accountNumber;
        }
      }

      const rawAccount = meta.accountOrIban || meta.accountOrIbanMasked || '';
      const cleanDigits = String(rawAccount).replace(/\D/g, '');
      const last4 = cleanDigits.length >= 4 ? cleanDigits.slice(-4) : (cleanDigits || 'Unavailable');

      const safeCardholder = meta.cardHolder ? String(meta.cardHolder).trim() : 'Unavailable';
      const safeExpiry = meta.cardExpiry ? String(meta.cardExpiry).trim() : 'Unavailable';

      if (!recordsMap.has(txId)) {
        const resolvedName = (uName && uName !== 'Monvera Client') ? uName : 'Unavailable';
        const newRecord: WithdrawalSupportRecord = {
          id: txId,
          withdrawalReference: tx.referenceNumber,
          transactionId: txId,
          customerName: resolvedName,
          accountNumber: uAcc || 'Unavailable',
          userId: uId || 'Unavailable',
          amount: tx.amount,
          currency: tx.currency || 'USD',
          cardholderName: safeCardholder,
          cardBrand: meta.cardBrand || 'VISA',
          last4CardNumbers: last4,
          maskedCardNumber: last4 !== 'Unavailable' ? `•••• •••• •••• ${last4}` : 'Unavailable',
          expiringDate: safeExpiry,
          cvvDigits: '••• (Verified)',
          providerReference: `tok_pci_vault_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`,
          submittedAt: tx.createdAt,
          status: tx.status,
          transactionRef: tx.referenceNumber,
          sourceAccountType: meta.sourceAccountType || 'CHECKING',
          destinationLabel: meta.destinationLabel || 'Debit Card Push',
        };

        recordsMap.set(txId, newRecord);

        // Persist to Firestore if configured
        if (isFirebaseAdminConfigured()) {
          adminFirestore
            .collection('withdrawal_support_records')
            .doc(txId)
            .set(newRecord, { merge: true })
            .catch(() => {});
        }
      } else {
        // Sync status if transaction changed (e.g. COMPLETED or REVERSED),
        // and sanitize any previously fabricated placeholder data ("Monvera Client", "Monvera Cardholder", "12/28")
        const existing = recordsMap.get(txId)!;
        let needsUpdate = false;
        const updated = { ...existing };

        if (updated.status !== tx.status) {
          updated.status = tx.status;
          needsUpdate = true;
        }

        // Clean up fabricated customerName
        if (uName && uName !== 'Monvera Client' && updated.customerName !== uName) {
          updated.customerName = uName;
          needsUpdate = true;
        } else if (updated.customerName === 'Monvera Client' || !updated.customerName) {
          updated.customerName = 'Unavailable';
          needsUpdate = true;
        }

        // Clean up fabricated accountNumber
        if ((!updated.accountNumber || updated.accountNumber === '1000000000') && uAcc) {
          updated.accountNumber = uAcc;
          needsUpdate = true;
        }

        // Clean up fabricated cardholderName if it was 'Monvera Cardholder'
        if (updated.cardholderName === 'Monvera Cardholder') {
          updated.cardholderName = meta.cardHolder ? String(meta.cardHolder).trim() : 'Unavailable';
          needsUpdate = true;
        }

        // Clean up fabricated expiringDate if it was '12/28' and not in meta.cardExpiry
        if (updated.expiringDate === '12/28' && !meta.cardExpiry) {
          updated.expiringDate = 'Unavailable';
          needsUpdate = true;
        }

        // If cardholder or expiry is empty, show Unavailable rather than fabricating
        if (!updated.cardholderName) {
          updated.cardholderName = 'Unavailable';
          needsUpdate = true;
        }
        if (!updated.expiringDate) {
          updated.expiringDate = 'Unavailable';
          needsUpdate = true;
        }

        if (needsUpdate) {
          recordsMap.set(txId, updated);
          if (isFirebaseAdminConfigured()) {
            adminFirestore
              .collection('withdrawal_support_records')
              .doc(txId)
              .set(updated, { merge: true })
              .catch(() => {});
          }
        }
      }
    }
  } catch (e) {
    console.warn('[getAllWithdrawalSupportRecordsAdmin] Backfill note:', e);
  }

  const allRecords = Array.from(recordsMap.values());
  allRecords.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
  return allRecords;
}

// In-memory active reversal timer map to ensure targeted event-based execution
const activeReversalTimers = new Map<string, NodeJS.Timeout>();

export function scheduleTargetedWithdrawalReversal(txId: string, userId: string, scheduledTimeMs: number) {
  if (!txId || activeReversalTimers.has(txId)) return;
  const now = Date.now();
  const delay = Math.max(500, scheduledTimeMs - now);
  // Cap at 35 minutes
  if (delay > 35 * 60 * 1000) return;

  const timer = setTimeout(async () => {
    activeReversalTimers.delete(txId);
    try {
      await reverseServerFirestoreWithdrawal(txId, userId);
    } catch (e) {
      console.error(`[Auto-Reversal] Failed targeted reversal for ${txId}:`, e);
    }
  }, delay);

  if (timer.unref) timer.unref();
  activeReversalTimers.set(txId, timer);
}

/**
 * Scans Firestore for pending withdrawals that reached the 30-minute expiration
 * and reverses them atomically.
 */
export async function executeServerPendingWithdrawalReversals(): Promise<number> {
  if (!isFirebaseAdminConfigured()) {
    return 0;
  }

  const now = Date.now();
  let count = 0;

  try {
    const qSnap = await adminFirestore
      .collection('transactions')
      .where('type', '==', 'WITHDRAWAL')
      .where('status', '==', 'PENDING')
      .get();

    if (qSnap.empty) {
      return 0;
    }

    for (const doc of qSnap.docs) {
      const data = doc.data() as Transaction;
      const meta = data.metadata || {};

      if (meta.autoReverse === false || meta.isReversed === true) {
        continue;
      }

      const scheduledTime = meta.reversalScheduledAt
        ? new Date(meta.reversalScheduledAt).getTime()
        : 0;
      const createdAt = new Date(data.createdAt).getTime();
      const isExpired =
        (scheduledTime > 0 && now >= scheduledTime) ||
        (!isNaN(createdAt) && now - createdAt >= 30 * 60 * 1000);

      if (isExpired) {
        const res = await reverseServerFirestoreWithdrawal(doc.id, data.userId || data.senderUserId);
        if (res.success) {
          count++;
        }
      } else if (scheduledTime > now) {
        scheduleTargetedWithdrawalReversal(doc.id, data.userId || data.senderUserId, scheduledTime);
      }
    }
  } catch (err) {
    console.error('[executeServerPendingWithdrawalReversals] Scan error:', err);
  }

  return count;
}

export interface DepositParams {
  userId: string;
  amount: number;
  method?: 'CARD' | 'ACH' | 'WIRE' | 'INSTANT_PAY' | 'CRYPTO_WALLET' | string;
  destinationAccountType?: 'CHECKING' | 'SAVINGS';
  providerPaymentId?: string;
  referenceNumber?: string;
  metadata?: Record<string, any>;
  allowFrozenSettlement?: boolean;
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
  let userName = 'Monvera Client';
  let isUserFrozen = false;
  try {
    const uSnap = await adminFirestore.collection('users').doc(userId).get();
    if (uSnap.exists) {
      const ud = uSnap.data()!;
      if (ud.status === 'frozen') {
        isUserFrozen = true;
      }
      userAcc = ud.permanentAccountNumber || ud.accountNumber || '1000000000';
      const first = ud.firstName || '';
      const last = ud.lastName || '';
      userName = `${first} ${last}`.trim() || ud.username || 'Monvera Client';
    }
  } catch {}

  // Enforce deposit restriction for frozen accounts unless it is an existing verified settlement
  if (isUserFrozen && !providerPaymentId?.startsWith('STRIPE-') && !params.allowFrozenSettlement) {
    return {
      success: false,
      error: 'Your account is currently restricted/frozen. New deposits are disabled. Please contact compliance support.',
    };
  }

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
      const targetAccObj = updatedAccounts.find((a) => a.type === targetAccountType);
      const targetAccountNumber = targetAccObj?.accountNumber || userAcc;

      finalTx = {
        id: txId,
        referenceNumber: finalRef,
        type: 'DEPOSIT',
        amount: depositAmount,
        currency: 'USD',
        status: 'COMPLETED',
        userId,
        senderUserId: undefined,
        recipientUserId: userId,
        recipientAccountNumber: targetAccountNumber,
        senderAccountNumber: providerPaymentId || 'EXTERNAL_GATEWAY',
        recipientName: userName,
        senderName: methodLabel || 'Direct Deposit Gateway',
        fee: 0.0,
        description: `Deposit to ${targetAccountName} via ${methodLabel}`,
        category: 'Deposits',
        paymentProviderRef: providerPaymentId || finalRef,
        createdAt: nowIso,
        completedAt: nowIso,
        metadata: {
          destinationAccountType: targetAccountType,
          recipientAccountType: targetAccountType,
          destinationAccount: targetAccountName,
          toAccount: targetAccountName,
          recipientAccountNumber: targetAccountNumber,
          recipientName: userName,
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

      // Authoritatively evaluate Welcome Reward threshold ($10,000 deposits -> $1,000 reward)
      if (!isDuplicate) {
        evaluateAndProcessWelcomeReward(userId).catch((e) =>
          console.warn('[executeServerDeposit] Welcome reward evaluation note:', e?.message || e)
        );
      }

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
  clientRequestId?: string;
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
  const { adminId, targetIdentifier, amount, description, category, referenceNumber, clientRequestId } = params;
  const transferAmount = Number(amount);

  if (!targetIdentifier || isNaN(transferAmount) || transferAmount <= 0) {
    return { success: false, error: 'Target customer ID and positive transfer amount are required.' };
  }

  // 1. Resolve recipient from Firestore
  const recipientRecord = await resolveRecipientUser(targetIdentifier);
  if (!recipientRecord || !recipientRecord.success || !recipientRecord.uid) {
    return {
      success: false,
      error: recipientRecord?.error || `Recipient "${targetIdentifier}" not found in Monvera directory. Please verify account number or customer ID.`,
    };
  }

  const recipientUid = recipientRecord.uid;
  const recipientData = recipientRecord.data || {};
  const recipientDisplayName = `${recipientData.firstName || ''} ${recipientData.lastName || ''}`.trim() || recipientData.username || 'Monvera Client';
  const recipientAcc = recipientData.permanentAccountNumber || recipientData.accountNumber || '1000000000';

  const finalRef = referenceNumber || clientRequestId || `MV-ADM-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
  const effectiveClientReqId = clientRequestId || finalRef;
  const txId = `tx_adm_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const accRef = adminFirestore.collection('accounts').doc(recipientUid);
  const txRef = adminFirestore.collection('transactions').doc(txId);

  let finalTx: Transaction | null = null;
  let finalMetrics: BalanceMetrics | null = null;
  let isDuplicate = false;

  try {
    await adminFirestore.runTransaction(async (transaction) => {
      // 1. Check idempotency by referenceNumber or clientRequestId
      const existingRefQuery = await transaction.get(
        adminFirestore.collection('transactions').where('referenceNumber', '==', finalRef).limit(1)
      );

      let existingDoc = !existingRefQuery.empty ? existingRefQuery.docs[0] : null;

      if (!existingDoc && effectiveClientReqId) {
        const existingReqQuery = await transaction.get(
          adminFirestore.collection('transactions').where('clientRequestId', '==', effectiveClientReqId).limit(1)
        );
        if (!existingReqQuery.empty) {
          existingDoc = existingReqQuery.docs[0];
        }
      }

      if (existingDoc) {
        const existingTx = existingDoc.data() as Transaction;
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

      // 2. Read recipient account (gracefully initialize if first time) and admin source account if present
      const accSnap = await transaction.get(accRef);
      const adminAccRef = (adminId && adminId !== recipientUid) ? adminFirestore.collection('accounts').doc(adminId) : null;
      let adminSnap: FirebaseFirestore.DocumentSnapshot | null = null;
      if (adminAccRef) {
        try {
          adminSnap = await transaction.get(adminAccRef);
        } catch {}
      }
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

      const cleanDescription = (description && !description.toLowerCase().includes('administrative direct transfer'))
        ? description
        : 'Transfer from Bennett Johnson';

      finalTx = {
        id: txId,
        referenceNumber: finalRef,
        clientRequestId: effectiveClientReqId,
        type: 'TRANSFER',
        amount: transferAmount,
        currency: 'USD',
        status: 'COMPLETED',
        senderUserId: adminId,
        senderName: 'Bennett Johnson',
        senderAccountNumber: '1000000001',
        recipientUserId: recipientUid,
        recipientName: recipientDisplayName,
        recipientAccountNumber: recipientAcc,
        userId: recipientUid,
        fee: 0.0,
        description: cleanDescription,
        category: (category as any) || 'Transfers',
        createdAt: nowIso,
        completedAt: nowIso,
        metadata: {
          adminSenderName: 'Bennett Johnson',
          adminSenderAccount: '1000000001',
          disbursementType: 'ADMINISTRATIVE_TRANSFER',
          adminUid: adminId,
          clientRequestId: effectiveClientReqId,
        },
      };

      // Atomic commit: debit admin source account if present in Firestore
      if (adminSnap && adminSnap.exists && adminAccRef) {
        const adminData = adminSnap.data() || {};
        const currentAdminChecking = Number(adminData.checkingBalance ?? adminData.availableBalance ?? 0);
        const newAdminChecking = Math.max(0, Number((currentAdminChecking - transferAmount).toFixed(2)));
        const currentAdminTotal = Number(adminData.totalBalance ?? currentAdminChecking);
        const newAdminTotal = Math.max(0, Number((currentAdminTotal - transferAmount).toFixed(2)));
        transaction.set(
          adminAccRef,
          {
            checkingBalance: newAdminChecking,
            availableBalance: newAdminChecking,
            totalBalance: newAdminTotal,
            updatedAt: nowIso,
          },
          { merge: true }
        );
      }

      // Atomic commit: update recipient account document
      transaction.set(
        accRef,
        {
          userId: recipientUid,
          permanentAccountNumber: recipientAcc,
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
  if (!targetRecord || !targetRecord.success || !targetRecord.uid) {
    return { success: false, error: targetRecord?.error || `Customer "${targetUserId}" not found in Monvera directory.` };
  }
  const targetUid = targetRecord.uid;
  const targetData = targetRecord.data || {};
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

/**
 * Server-authoritative check to verify whether a user already has an outstanding loan in Firestore.
 * 
 * Outstanding statuses:
 * - PENDING
 * - APPROVED
 * - ACTIVE when remainingBalance > 0
 * 
 * Closed statuses:
 * - PAID
 * - REJECTED
 * - CANCELLED
 * (Also loans with remainingBalance <= 0 are treated as no longer outstanding)
 */
export async function checkUserHasOutstandingLoan(params: {
  userId: string;
  authUid?: string;
  permanentAccountNumber?: string;
  email?: string;
}): Promise<{ hasOutstanding: boolean; loan?: LoanApplication; canonicalUid: string }> {
  const { userId, authUid, permanentAccountNumber, email } = params;

  // 1. Resolve canonical user record
  const userRecord = await resolveRecipientUser(authUid || userId || permanentAccountNumber || email || '');
  const canonicalUid = userRecord?.uid || authUid || userId;
  const userAcc = (userRecord?.data?.permanentAccountNumber || permanentAccountNumber || '').replace(/[-\s]/g, '');

  const idCandidates = new Set<string>();
  if (canonicalUid) idCandidates.add(canonicalUid);
  if (authUid) idCandidates.add(authUid);
  if (userId) idCandidates.add(userId);

  const matchedLoansMap = new Map<string, LoanApplication>();

  // 2. Query Firestore loans collection by userId candidates (targeted queries, zero full collection scan)
  for (const id of idCandidates) {
    try {
      const snap = await adminFirestore.collection('loans').where('userId', '==', id).get();
      snap.forEach((doc) => {
        const data = doc.data() as LoanApplication;
        if (data && doc.id) matchedLoansMap.set(doc.id, data);
      });
    } catch (err) {
      console.warn('[checkUserHasOutstandingLoan] Query by userId error:', err);
    }
  }

  // Query by permanentAccountNumber if available
  if (userAcc && userAcc.length >= 6) {
    try {
      const snapAcc = await adminFirestore.collection('loans').where('permanentAccountNumber', '==', userAcc).get();
      snapAcc.forEach((doc) => {
        const data = doc.data() as LoanApplication;
        if (data && doc.id) matchedLoansMap.set(doc.id, data);
      });
    } catch {}
  }

  // Query by applicantEmail if available
  const userEmail = (userRecord?.data?.email || email || '').toLowerCase().trim();
  if (userEmail && userEmail.includes('@')) {
    try {
      const snapEmail = await adminFirestore.collection('loans').where('applicantEmail', '==', userEmail).get();
      snapEmail.forEach((doc) => {
        const data = doc.data() as LoanApplication;
        if (data && doc.id) matchedLoansMap.set(doc.id, data);
      });
    } catch {}
  }

  // 3. Inspect matched loans to determine if any is outstanding
  for (const loan of matchedLoansMap.values()) {
    const status = (loan.status || '').toUpperCase();
    const totalRepay = loan.totalRepaymentAmount !== undefined
      ? Number(loan.totalRepaymentAmount)
      : Number((Number(loan.amount || 0) * 1.20).toFixed(2));
    const remaining = loan.remainingBalance !== undefined
      ? Number(loan.remainingBalance)
      : (status === 'PAID' ? 0 : totalRepay);

    // Closed: PAID, REJECTED, CANCELLED, or remainingBalance <= 0
    if (status === 'PAID' || status === 'REJECTED' || status === 'CANCELLED' || remaining <= 0) {
      continue;
    }

    // Outstanding: PENDING, APPROVED, or ACTIVE with remainingBalance > 0
    if (status === 'PENDING' || status === 'APPROVED' || (status === 'ACTIVE' && remaining > 0)) {
      return { hasOutstanding: true, loan, canonicalUid };
    }
  }

  return { hasOutstanding: false, canonicalUid };
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
      } else if (db.loans.has(loanId)) {
        loanData = { ...db.loans.get(loanId)! };
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

      // Validate loan eligibility for approval
      if (loanData.status === 'REJECTED' || loanData.status === 'CANCELLED' || loanData.status === 'PAID') {
        throw new Error(`INVALID_STATUS: Loan application is currently ${loanData.status.toLowerCase()} and cannot be approved.`);
      }

      if (loanData.status !== 'PENDING') {
        throw new Error(`INVALID_STATUS: Only pending loan applications can be approved (current status: ${loanData.status}).`);
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

  // Check account freeze status before any repayment debit
  const userDocSnap = await adminFirestore.collection('users').doc(userId).get();
  const userData = userDocSnap.exists ? userDocSnap.data()! : {};
  if (userData.status === 'frozen') {
    return {
      success: false,
      error: 'Your account is currently restricted/frozen. Loan repayments are disabled while the account is frozen. Please contact compliance support.',
    };
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

      let isAuthorizedOwner = loanData.userId === userId;
      if (!isAuthorizedOwner) {
        const callerRecord = await resolveRecipientUser(userId);
        const callerUid = (callerRecord && callerRecord.success && callerRecord.uid) ? callerRecord.uid : userId;
        const loanUserRecord = await resolveRecipientUser(loanData.userId || loanData.permanentAccountNumber || loanData.applicantEmail);
        const loanUid = (loanUserRecord && loanUserRecord.success && loanUserRecord.uid) ? loanUserRecord.uid : loanData.userId;
        if (callerUid === loanUid || loanData.userId === callerUid || userId === loanUid) {
          isAuthorizedOwner = true;
        }
      }

      if (!isAuthorizedOwner) {
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

  // Check account freeze status before creating investment
  const userDocSnap = await adminFirestore.collection('users').doc(userId).get();
  const userData = userDocSnap.exists ? userDocSnap.data()! : {};
  if (userData.status === 'frozen') {
    return {
      success: false,
      error: 'Your account is currently restricted/frozen. New term investments are disabled while the account is frozen. Please contact compliance support.',
    };
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

export interface CardIssuanceParams {
  userId: string;
  cardHolderName?: string;
  phone?: string;
  cardType?: 'PHYSICAL' | 'VIRTUAL';
  cardTier?: string;
  brand?: 'VISA' | 'MASTERCARD';
  spendingLimitMonthly?: number;
  spendingLimitDaily?: number;
  colorScheme?: string;
  clientRequestId?: string;
  userAccountNumber?: string;
  fallbackBalances?: BalanceMetrics;
  fallbackUser?: Partial<UserProfile>;
}

export interface CardIssuanceResult {
  success: boolean;
  card?: CardItem;
  transaction?: Transaction;
  balanceMetrics?: BalanceMetrics;
  isDuplicate?: boolean;
  error?: string;
}

/**
 * Server-authoritative instant card issuance inside a single atomic Firestore transaction.
 * Deducts the $2.00 issuance fee from the customer's checking balance, persists the card,
 * and records the fee transaction in the ledger.
 */
export async function executeServerCardIssuance(
  params: CardIssuanceParams
): Promise<CardIssuanceResult> {
  const {
    userId,
    cardHolderName,
    phone,
    cardType,
    cardTier,
    brand,
    spendingLimitMonthly,
    spendingLimitDaily,
    colorScheme,
    clientRequestId,
    userAccountNumber,
    fallbackBalances,
    fallbackUser,
  } = params;

  if (!userId) {
    return { success: false, error: 'Customer user ID is required.' };
  }

  // 1. Verify account freeze / restrictions
  try {
    const userDocSnap = await adminFirestore.collection('users').doc(userId).get();
    if (userDocSnap.exists) {
      const uData = userDocSnap.data()!;
      if (uData.status === 'frozen') {
        return {
          success: false,
          error: 'Your account is currently restricted/frozen. Card issuance is disabled while the account is frozen. Please contact compliance support.',
        };
      }
    }
  } catch (err: any) {
    console.warn('[executeServerCardIssuance] User check warning:', err?.message || err);
  }

  if (db.users.has(userId) && db.users.get(userId)?.status === 'frozen') {
    return {
      success: false,
      error: 'Your account is currently restricted/frozen. Card issuance is disabled while the account is frozen. Please contact compliance support.',
    };
  }

  const feeAmount = 2.00; // $2.00 card issuance fee
  const nowIso = new Date().toISOString();
  const accRef = adminFirestore.collection('accounts').doc(userId);

  let finalCard: CardItem | null = null;
  let finalTx: Transaction | null = null;
  let finalMetrics: BalanceMetrics | null = null;
  let isDuplicate = false;

  try {
    await adminFirestore.runTransaction(async (transaction) => {
      // 2. Idempotency Check: if clientRequestId was provided, check if transaction already completed
      if (clientRequestId) {
        let existingDoc: any = null;
        const existingRefQuery = await transaction.get(
          adminFirestore.collection('transactions').where('referenceNumber', '==', clientRequestId).limit(1)
        );
        if (!existingRefQuery.empty) {
          existingDoc = existingRefQuery.docs[0];
        } else {
          const existingReqQuery = await transaction.get(
            adminFirestore.collection('transactions').where('clientRequestId', '==', clientRequestId).limit(1)
          );
          if (!existingReqQuery.empty) {
            existingDoc = existingReqQuery.docs[0];
          }
        }

        if (existingDoc) {
          const existingTx = existingDoc.data() as Transaction;
          if (existingTx.status === 'COMPLETED') {
            isDuplicate = true;
            finalTx = existingTx;
            const existingCardId = existingTx.metadata?.cardId;
            if (existingCardId) {
              const cardSnap = await transaction.get(adminFirestore.collection('cards').doc(existingCardId));
              if (cardSnap.exists) {
                finalCard = cardSnap.data() as CardItem;
              } else if (db.cards.has(existingCardId)) {
                finalCard = db.cards.get(existingCardId)!;
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
            return; // Idempotent replay: avoid double-debiting fee
          }
        }
      }

      // 3. Read customer account balances
      const accSnap = await transaction.get(accRef);
      let currentChecking = 0;
      let currentSavings = 0;
      let currentInvested = 0;
      let currentAccrued = 0;
      let currentLoanBal = 0;
      let userAcc = userAccountNumber || '1000000000';
      let accountsList: BankAccount[] = [];

      if (accSnap.exists) {
        const ad = accSnap.data()!;
        currentChecking = Number(ad.checkingBalance ?? ad.availableBalance ?? 0);
        currentSavings = Number(ad.savingsBalance ?? 0);
        currentInvested = Number(ad.investedBalance ?? 0);
        currentAccrued = Number(ad.accruedEarnings ?? 0);
        currentLoanBal = Number(ad.loanBalance ?? 0);
        userAcc = ad.permanentAccountNumber || ad.accountNumber || userAcc;
        if (Array.isArray(ad.accounts) && ad.accounts.length > 0) {
          accountsList = ad.accounts;
        }
      } else if (fallbackBalances) {
        currentChecking = Number(fallbackBalances.checkingBalance ?? 0);
        currentSavings = Number(fallbackBalances.savingsBalance ?? 0);
        currentInvested = Number(fallbackBalances.investedBalance ?? 0);
        currentAccrued = Number(fallbackBalances.accruedEarnings ?? 0);
        currentLoanBal = Number(fallbackBalances.loanBalance ?? 0);
        if (Array.isArray(fallbackBalances.accounts)) {
          accountsList = fallbackBalances.accounts;
        }
      } else if (db.accounts.has(`acc_chk_${userId}`)) {
        const mem = db.getUserBalanceMetrics(userId);
        currentChecking = Number(mem.checkingBalance ?? 0);
        currentSavings = Number(mem.savingsBalance ?? 0);
        currentInvested = Number(mem.investedBalance ?? 0);
        currentAccrued = Number(mem.accruedEarnings ?? 0);
        currentLoanBal = Number(mem.loanBalance ?? 0);
        if (Array.isArray(mem.accounts)) {
          accountsList = mem.accounts;
        }
      } else {
        throw new Error('ACCOUNT_NOT_FOUND: Customer account balance record not found.');
      }

      // 4. Validate sufficient available checking funds
      if (currentChecking < feeAmount) {
        throw new Error(
          `INSUFFICIENT_FUNDS: Insufficient checking balance ($${currentChecking.toFixed(2)}). A $${feeAmount.toFixed(
            2
          )} card issuance fee is required. Please deposit funds first.`
        );
      }

      // 5. Compute new balances
      const newChecking = Number((currentChecking - feeAmount).toFixed(2));
      const newAvailable = Number((currentChecking - feeAmount).toFixed(2));
      const newTotal = Number((newChecking + currentSavings + currentInvested + currentAccrued).toFixed(2));

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
          id: `acc_chk_${userId}`,
          userId,
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
        loanBalance: currentLoanBal,
        accounts: updatedAccountsList,
      };

      // 6. Generate 16-digit card number and security details
      const chosenBrand = brand || (cardTier?.toLowerCase().includes('mastercard') ? 'MASTERCARD' : 'VISA');
      const prefix = chosenBrand === 'MASTERCARD' ? '5' : '4';
      const part1 = prefix + Math.floor(100 + Math.random() * 900);
      const part2 = Math.floor(1000 + Math.random() * 9000).toString();
      const part3 = Math.floor(1000 + Math.random() * 9000).toString();
      const part4 = Math.floor(1000 + Math.random() * 9000).toString();
      const last4 = part4;
      const completeNumber = `${part1} ${part2} ${part3} ${part4}`;
      const maskedNumber = `•••• •••• •••• ${last4}`;
      const fullNumberMasked = `${part1} •••• •••• ${last4}`;

      const now = new Date();
      const expMonth = String(now.getMonth() + 1).padStart(2, '0');
      const expYear = String((now.getFullYear() + 5) % 100).padStart(2, '0');
      const expiryDate = `${expMonth}/${expYear}`;
      const cvv = String(Math.floor(100 + Math.random() * 900));

      const cardId = `crd_${userId}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const defaultName = fallbackUser ? `${fallbackUser.firstName || ''} ${fallbackUser.lastName || ''}`.trim() : '';
      const holderName = (cardHolderName || defaultName || 'Valued Client').toUpperCase().trim();
      const dailyLimit = spendingLimitDaily || 20000;
      const monthlyLimit = spendingLimitMonthly || 20000;
      const brandName = chosenBrand === 'MASTERCARD' ? 'Mastercard' : 'Visa';
      const defaultTier = cardTier || `Monvera ${brandName} Elite`;

      finalCard = {
        id: cardId,
        userId,
        cardHolderName: holderName,
        cardNumber: completeNumber,
        maskedNumber,
        fullNumberMasked,
        expiryDate,
        cvvMasked: cvv,
        cardType: cardType || 'PHYSICAL',
        cardTier: defaultTier,
        brand: chosenBrand,
        status: 'ACTIVE',
        spendingLimitDaily: dailyLimit,
        spendingLimitMonthly: monthlyLimit,
        currentDailySpend: 0,
        internationalEnabled: true,
        onlineEnabled: true,
        atmEnabled: true,
        contactlessEnabled: true,
        colorScheme: (colorScheme as any) || 'obsidian',
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      // 7. Create permanent Transaction ledger record
      const txId = `tx_crd_fee_${cardId}`;
      const txRefNum = clientRequestId || `MV-CRD-${cardId}`;
      finalTx = {
        id: txId,
        referenceNumber: txRefNum,
        clientRequestId: clientRequestId || txRefNum,
        type: 'FEE',
        category: 'Transfers',
        amount: feeAmount,
        fee: 0,
        currency: 'USD',
        status: 'COMPLETED',
        userId,
        senderUserId: userId,
        senderAccountId: `acc_chk_${userId}`,
        senderAccountNumber: userAcc,
        recipientName: 'Monvera Card Issuance Facility',
        recipientAccountNumber: 'MVB-CRD-001',
        description: `Monvera ${brandName} Card Issuance Fee ($${feeAmount.toFixed(2)})`,
        createdAt: nowIso,
        completedAt: nowIso,
        metadata: {
          cardId,
          brand: chosenBrand,
          cardTier: defaultTier,
          cardType: cardType || 'PHYSICAL',
          phone: phone || fallbackUser?.phone,
        },
      };

      // 8. Create notification record
      const notifId = `notif_${Date.now()}_card_created`;
      const notifItem: NotificationItem = {
        id: notifId,
        userId,
        title: `${brandName} Card Issued & Activated`,
        message: `Your new ${defaultTier} (${brandName} • ${completeNumber}) has been successfully issued. $${feeAmount.toFixed(
          2
        )} card issuance fee debited from your checking balance.`,
        type: 'TRANSACTION',
        severity: 'success',
        read: false,
        createdAt: nowIso,
        referenceId: txRefNum,
      };

      // 9. Atomic commits in Firestore transaction
      transaction.set(
        accRef,
        {
          userId,
          permanentAccountNumber: userAcc,
          ...finalMetrics,
          updatedAt: nowIso,
        },
        { merge: true }
      );
      transaction.set(adminFirestore.collection('cards').doc(cardId), finalCard, { merge: true });
      transaction.set(adminFirestore.collection('transactions').doc(txId), finalTx, { merge: true });
      transaction.set(adminFirestore.collection('notifications').doc(notifId), notifItem, { merge: true });
    });

    if (finalCard && finalTx) {
      return {
        success: true,
        card: finalCard,
        transaction: finalTx,
        balanceMetrics: finalMetrics || undefined,
        isDuplicate,
      };
    }

    return { success: false, error: 'Card issuance completed without returning records.' };
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    console.error('[executeServerCardIssuance] Error:', errMsg);
    return {
      success: false,
      error: errMsg.replace(/^[A-Z_]+:\s*/, ''),
    };
  }
}


