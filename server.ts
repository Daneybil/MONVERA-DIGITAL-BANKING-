import express, { Request, Response } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { db } from './server/db';
import { serverNotificationDispatcher } from './server/services/notificationDispatcher';
import { UserProfile, InvestmentTermDays, LoanApplication } from './src/types';
import { getStripe, isStripeConfigured } from './server/stripe';
import { requireFirebaseAuth, optionalFirebaseAuth, requireAdminAuth, AuthenticatedRequest } from './server/authMiddleware';
import { adminFirestore } from './server/firebaseAdmin';
import {
  executeServerTransfer,
  executeServerWithdrawal,
  executeServerDeposit,
  executeServerAdminTransfer,
  executeServerAdminDevFunding,
  executeServerLoanDisbursement,
  executeServerLoanRepayment,
  executeServerInvestmentCreation,
  executeServerInvestmentMaturity,
  executeServerPendingWithdrawalReversals,
  reverseServerFirestoreWithdrawal,
  checkUserHasOutstandingLoan,
  resolveRecipientUser,
} from './server/firestoreTransactions';

const app = express();
const PORT = 3000;

app.use(
  express.json({
    limit: '50mb',
    verify: (req: any, _res, buf) => {
      if (req.originalUrl && req.originalUrl.startsWith('/api/stripe/webhook')) {
        req.rawBody = buf;
      }
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request logging middleware
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    console.log(`[MV-API] ${req.method} ${req.path}`);
  }
  next();
});

// --- AUTHENTICATION & USERS ---
app.get('/api/auth/users', (req: Request, res: Response) => {
  const userList = Array.from(db.users.values()).map((u) => ({
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    permanentAccountNumber: u.permanentAccountNumber,
    role: u.role,
    membershipTier: u.membershipTier,
    avatarUrl: u.avatarUrl,
    businessName: u.businessName,
  }));
  res.json({ users: userList });
});

app.get('/api/auth/me', async (req: Request, res: Response) => {
  const userId = (req.query.userId as string) || 'usr_eleanor';
  let user = db.users.get(userId);
  if (!user) {
    try {
      const uSnap = await adminFirestore.collection('users').doc(userId).get();
      if (uSnap.exists) {
        user = { ...uSnap.data(), id: userId } as any;
      }
    } catch {}
  }
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  let balanceMetrics: any = null;
  try {
    const accSnap = await adminFirestore.collection('accounts').doc(userId).get();
    if (accSnap.exists) {
      const ad = accSnap.data()!;
      const chk = Number(ad.checkingBalance ?? 0);
      const sav = Number(ad.savingsBalance ?? ad.savings ?? 0);
      const inv = Number(ad.investedBalance ?? ad.investmentBalance ?? 0);
      const accrued = Number(ad.accruedEarnings ?? 0);
      balanceMetrics = {
        checkingBalance: chk,
        savingsBalance: sav,
        investedBalance: inv,
        accruedEarnings: accrued,
        totalBalance: Number(ad.totalBalance ?? (chk + sav + inv + accrued)),
        availableBalance: Number(ad.availableBalance ?? chk),
        pendingBalance: Number(ad.pendingBalance ?? 0),
        loanBalance: Number(ad.loanBalance ?? 0),
        accounts: ad.accounts || [],
      };
    } else if (db.users.has(user.id)) {
      balanceMetrics = db.getUserBalanceMetrics(user.id);
    }
  } catch {
    if (db.users.has(user.id)) {
      balanceMetrics = db.getUserBalanceMetrics(user.id);
    }
  }

  res.json({ user, balanceMetrics });
});

app.post('/api/auth/login', (req: Request, res: Response) => {
  const { identifier, password } = req.body;
  if (!identifier) {
    return res.status(400).json({ error: 'Please enter your email or Monvera Account Number.' });
  }

  // Find user by email or account number
  const user = Array.from(db.users.values()).find(
    (u) =>
      u.email.toLowerCase() === identifier.trim().toLowerCase() ||
      u.permanentAccountNumber === identifier.trim().replace(/[-\s]/g, '')
  );

  if (!user) {
    return res.status(401).json({ error: 'No Monvera account found with those credentials.' });
  }

  const balanceMetrics = db.getUserBalanceMetrics(user.id);
  res.json({ success: true, user, balanceMetrics });
});

app.post('/api/auth/register', async (req: Request, res: Response) => {
  const { id, uid, firstName, lastName, email, phone, dateOfBirth, country, isBusiness, businessName, username, maritalStatus, address, permanentAccountNumber: requestedAccNum } = req.body;

  if (!firstName || !lastName || !email) {
    return res.status(400).json({ error: 'First name, last name, and valid email are required.' });
  }

  const userId = uid || id || `usr_${Date.now().toString(36)}`;

  // If user already exists by ID, return existing user and balance metrics
  if (db.users.has(userId)) {
    const existingUser = db.users.get(userId)!;
    if (req.body.kycStatus) existingUser.kycStatus = req.body.kycStatus;
    if (req.body.kycDocumentType) existingUser.kycDocumentType = req.body.kycDocumentType;
    if (req.body.kycDocumentNumber) existingUser.kycDocumentNumber = req.body.kycDocumentNumber;
    if (req.body.kycVerifiedAt) existingUser.kycVerifiedAt = req.body.kycVerifiedAt;
    const balanceMetrics = db.getUserBalanceMetrics(existingUser.id);
    return res.json({ success: true, user: existingUser, balanceMetrics });
  }

  // Check if email already registered under another ID
  const existingByEmail = Array.from(db.users.values()).find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
  if (existingByEmail && existingByEmail.id !== userId) {
    // If it was another user ID, update ID to Firebase UID
    db.users.delete(existingByEmail.id);
    existingByEmail.id = userId;
    if (req.body.kycStatus) existingByEmail.kycStatus = req.body.kycStatus;
    if (req.body.kycDocumentType) existingByEmail.kycDocumentType = req.body.kycDocumentType;
    if (req.body.kycDocumentNumber) existingByEmail.kycDocumentNumber = req.body.kycDocumentNumber;
    if (req.body.kycVerifiedAt) existingByEmail.kycVerifiedAt = req.body.kycVerifiedAt;
    db.users.set(userId, existingByEmail);
    const balanceMetrics = db.getUserBalanceMetrics(userId);
    return res.json({ success: true, user: existingByEmail, balanceMetrics });
  }

  // Generate unique username if not provided
  let generatedUsername = (username || `${firstName}${lastName.charAt(0)}`).toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (!generatedUsername) generatedUsername = `user${Math.floor(1000 + Math.random() * 9000)}`;
  
  let finalUsername = generatedUsername;
  let counter = 1;
  while (Array.from(db.users.values()).some((u) => u.id !== userId && u.username.toLowerCase() === finalUsername.toLowerCase())) {
    finalUsername = `${generatedUsername}${counter}`;
    counter++;
  }

  // Generate unique 10-digit permanent Monvera Account Number (starts with 10)
  let permanentAccountNumber = requestedAccNum || '';
  if (!permanentAccountNumber) {
    do {
      permanentAccountNumber = `10${Math.floor(10000000 + Math.random() * 90000000)}`;
    } while (Array.from(db.users.values()).some((u) => u.id !== userId && u.permanentAccountNumber === permanentAccountNumber));
  }

  const newUser: UserProfile = {
    id: userId,
    username: finalUsername,
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    email: email.trim().toLowerCase(),
    phone: phone || '+1 (555) 000-0000',
    permanentAccountNumber,
    dateOfBirth,
    country: country || 'United States',
    maritalStatus: maritalStatus || req.body.maritalStatus,
    taxId: req.body.taxId,
    avatarUrl: `https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80`,
    status: 'active',
    role: isBusiness ? 'business' : 'customer',
    membershipTier: isBusiness ? 'Business Platinum' : 'Premier',
    twoFactorEnabled: false,
    createdAt: new Date().toISOString(),
    businessName: isBusiness ? businessName || `${firstName}'s Enterprise` : undefined,
    kycStatus: 'unverified',
    dailyTransactionLimit: 1000000,
  };

  db.users.set(userId, newUser);
  if (req.body.password) {
    db.userPasswords.set(userId, req.body.password);
  } else {
    db.userPasswords.set(userId, 'Password123!');
  }

  // Initialize checking, savings, investment accounts
  const chkId = `acc_chk_${userId}`;
  const savId = `acc_sav_${userId}`;
  const invId = `acc_inv_${userId}`;

  db.accounts.set(chkId, {
    id: chkId,
    userId,
    type: 'CHECKING',
    accountNumber: permanentAccountNumber,
    routingNumber: '021000021',
    currency: 'USD',
    balance: 0,
    availableBalance: 0,
    investedBalance: 0,
    pendingBalance: 0,
    interestRateAPY: 1.25,
    status: 'ACTIVE',
    nickname: 'Monvera Premier Checking',
  });

  db.accounts.set(savId, {
    id: savId,
    userId,
    type: 'SAVINGS',
    accountNumber: `${permanentAccountNumber.slice(0, 7)}991`,
    routingNumber: '021000021',
    currency: 'USD',
    balance: 0,
    availableBalance: 0,
    investedBalance: 0,
    pendingBalance: 0,
    interestRateAPY: 4.85,
    status: 'ACTIVE',
    nickname: 'Monvera High-Yield Treasury',
  });

  db.accounts.set(invId, {
    id: invId,
    userId,
    type: 'INVESTMENT',
    accountNumber: `${permanentAccountNumber.slice(0, 7)}882`,
    routingNumber: '021000021',
    currency: 'USD',
    balance: 0,
    availableBalance: 0,
    investedBalance: 0,
    pendingBalance: 0,
    interestRateAPY: 8.4,
    status: 'ACTIVE',
    nickname: 'Monvera Capital Portfolio',
  });

  // Legitimate base account initialization in Firestore with zero balance
  try {
    const accRef = adminFirestore.collection('accounts').doc(userId);
    const existingAcc = await accRef.get();
    if (!existingAcc.exists) {
      const nowIso = new Date().toISOString();
      await accRef.set({
        userId,
        checkingBalance: 0,
        savingsBalance: 0,
        investedBalance: 0,
        accruedEarnings: 0,
        totalBalance: 0,
        availableBalance: 0,
        pendingBalance: 0,
        loanBalance: 0,
        permanentAccountNumber,
        accounts: [
          {
            id: chkId,
            userId,
            type: 'CHECKING',
            accountNumber: permanentAccountNumber,
            routingNumber: '021000021',
            currency: 'USD',
            balance: 0,
            availableBalance: 0,
            investedBalance: 0,
            pendingBalance: 0,
            interestRateAPY: 1.25,
            status: 'ACTIVE',
            nickname: 'Monvera Premier Checking',
          },
          {
            id: savId,
            userId,
            type: 'SAVINGS',
            accountNumber: `${permanentAccountNumber.slice(0, 7)}991`,
            routingNumber: '021000021',
            currency: 'USD',
            balance: 0,
            availableBalance: 0,
            investedBalance: 0,
            pendingBalance: 0,
            interestRateAPY: 4.85,
            status: 'ACTIVE',
            nickname: 'Monvera High-Yield Treasury',
          },
        ],
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    }
  } catch (fsErr) {
    console.warn('[Register] Firestore initial accounts initialization note:', fsErr);
  }

  // Welcome notification
  db.notifications.push({
    id: `notif_welcome_${userId}`,
    userId,
    title: 'Welcome to MONVERA',
    message: `Your permanent Monvera Account Number is ${permanentAccountNumber}. Your accounts are active and ready.`,
    type: 'SYSTEM',
    severity: 'success',
    read: false,
    createdAt: new Date().toISOString(),
  });

  const balanceMetrics = db.getUserBalanceMetrics(userId);
  res.json({ success: true, user: newUser, balanceMetrics });
});

// Change Password Endpoint
app.post('/api/auth/change-password', (req: Request, res: Response) => {
  const { userId, currentPassword, newPassword } = req.body;
  if (!userId || !newPassword) {
    return res.status(400).json({ error: 'User ID and new password are required.' });
  }

  const result = db.changePassword({ userId, currentPassword, newPassword });
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  res.json({ success: true, message: result.message });
});

// Password Reset / Recovery Endpoint
app.post('/api/auth/reset-password', (req: Request, res: Response) => {
  const { emailOrAccount } = req.body;
  if (!emailOrAccount) {
    return res.status(400).json({ error: 'Email or Account Number is required.' });
  }

  const result = db.resetPassword(emailOrAccount);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  res.json({ success: true, message: result.message });
});

// Update Profile Avatar Endpoint
app.post('/api/auth/update-avatar', (req: Request, res: Response) => {
  const { userId, avatarUrl } = req.body;
  if (!userId || !avatarUrl) {
    return res.status(400).json({ error: 'User ID and avatar URL are required.' });
  }

  const user = db.users.get(userId);
  if (!user) {
    return res.status(404).json({ error: 'User account not found.' });
  }

  user.avatarUrl = avatarUrl;
  db.users.set(userId, user);

  res.json({ success: true, user });
});

// KYC Submit Verification Endpoint
app.post('/api/kyc/submit', (req: Request, res: Response) => {
  const {
    userId,
    fullName,
    firstName,
    lastName,
    documentType,
    documentNumber,
    documentImage,
    documentBackImage,
    liveSelfieImage,
    streetAddress,
    country,
    phone,
    email,
    dateOfBirth,
    proofOfAddressType,
    proofOfAddressImage,
    ssn,
    ssnImage,
    isResubmission,
    autoApprove,
    reviewDurationMinutes,
  } = req.body;

  if (!userId || !documentType || !documentNumber) {
    return res.status(400).json({ error: 'User ID, document type, and document number are required.' });
  }

  const result = db.submitKyc({
    userId,
    fullName,
    firstName,
    lastName,
    documentType,
    documentNumber,
    documentImage,
    documentBackImage,
    liveSelfieImage,
    streetAddress,
    country,
    phone,
    email,
    dateOfBirth,
    proofOfAddressType,
    proofOfAddressImage,
    ssn,
    ssnImage,
    isResubmission,
    autoApprove: false, // Strict compliance: Requires manual/individual review
    reviewDurationMinutes: reviewDurationMinutes || 10,
  });

  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  res.json({ success: true, user: result.user });
});

// KYC Admin Approve Endpoint
app.post('/api/kyc/approve', (req: Request, res: Response) => {
  const { userId, adminId } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'Customer ID is required.' });
  }

  const result = db.approveKyc(userId, adminId);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  res.json({ success: true, user: result.user });
});

// --- ACCOUNT & BALANCE METRICS ---
app.get('/api/accounts/balance', async (req: Request, res: Response) => {
  const userId = req.query.userId as string;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  try {
    const accSnap = await adminFirestore.collection('accounts').doc(userId).get();
    if (accSnap.exists) {
      const ad = accSnap.data()!;
      const chk = Number(ad.checkingBalance ?? 0);
      const sav = Number(ad.savingsBalance ?? ad.savings ?? 0);
      const inv = Number(ad.investedBalance ?? ad.investmentBalance ?? 0);
      const accrued = Number(ad.accruedEarnings ?? 0);
      const total = Number(ad.totalBalance ?? (chk + sav + inv + accrued));
      const avail = Number(ad.availableBalance ?? chk);
      return res.json({
        checkingBalance: chk,
        savingsBalance: sav,
        investedBalance: inv,
        accruedEarnings: accrued,
        totalBalance: total,
        availableBalance: avail,
        pendingBalance: Number(ad.pendingBalance ?? 0),
        loanBalance: Number(ad.loanBalance ?? 0),
        accounts: ad.accounts || [],
      });
    } else {
      return res.status(404).json({
        error: `Authoritative account ledger not found for user ${userId}.`,
        code: 'ACCOUNT_NOT_FOUND',
      });
    }
  } catch (e: any) {
    const errCode = e?.code || e?.status || 'UNKNOWN';
    const isQuota = errCode === 8 || String(e?.message).includes('RESOURCE_EXHAUSTED') || errCode === 'RESOURCE_EXHAUSTED';
    console.error('[/api/accounts/balance error reading Firestore]', e);
    return res.status(isQuota ? 503 : 500).json({
      error: isQuota
        ? 'Authoritative account balances temporarily unavailable due to upstream Firestore quota limits.'
        : 'Failed to retrieve authoritative account balances from Firestore ledger.',
      code: isQuota ? 'RESOURCE_EXHAUSTED' : 'FIRESTORE_ERROR',
    });
  }
});

// Lookup recipient by Account Number OR Username before transfer confirmation
app.get('/api/accounts/lookup', async (req: Request, res: Response) => {
  const { accountNumber, username, query: rawQuery, currentUserId } = req.query;
  const rawInput = (rawQuery || accountNumber || username || '') as string;
  
  if (!rawInput.trim()) {
    return res.status(400).json({ valid: false, error: 'Account number or username is required' });
  }

  const cleanInput = rawInput.trim().replace(/^@/, '').replace(/[-\s]/g, '').toLowerCase();

  try {
    const resolution = await resolveRecipientUser(rawInput.trim());
    if (!resolution || !resolution.success || !resolution.uid) {
      if (resolution && resolution.isAmbiguous) {
        return res.status(400).json({ valid: false, error: resolution.error, isAmbiguous: true });
      }
      return res.status(404).json({ valid: false, error: resolution?.error || `No Monvera account found with username or account number "${rawInput}".` });
    }

    const recipientUid = resolution.uid;
    const recipientData = resolution.data || {};

    if (
      currentUserId &&
      (recipientUid === currentUserId ||
        (recipientData.permanentAccountNumber &&
          recipientData.permanentAccountNumber.replace(/[-\s]/g, '') === currentUserId))
    ) {
      return res.status(400).json({ valid: false, error: 'You cannot send an external transfer to yourself.' });
    }

    if (recipientData.status === 'frozen') {
      return res.status(400).json({ valid: false, error: 'Recipient account is temporarily restricted.' });
    }

    const accNum = recipientData.permanentAccountNumber || recipientData.accountNumber || '1000000000';
    return res.json({
      valid: true,
      recipientId: recipientUid,
      firstName: recipientData.firstName || 'Monvera',
      lastName: recipientData.lastName || 'Customer',
      username: recipientData.username || cleanInput,
      avatarUrl: recipientData.avatarUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
      permanentAccountNumber: accNum,
      maskedAccountNumber: `•••• ${accNum.slice(-4)}`,
      membershipTier: recipientData.membershipTier || 'Premier',
      verified: true,
    });
  } catch (err: any) {
    return res.status(500).json({ valid: false, error: err?.message || 'Server error looking up recipient.' });
  }
});

// --- TRANSFERS ---
// Monvera-to-Monvera Transfer (Server-Authoritative Firestore Transaction)
app.post('/api/transfers/monvera', requireFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const authUid = req.auth!.uid;
  const {
    senderUserId,
    recipientUserId,
    recipientAccountNumber,
    recipientUsername,
    recipientIdentifier,
    amount,
    description,
    category,
    referenceNumber,
    referenceId,
    idempotencyKey,
  } = req.body;

  // Identity consistency check: verified Firebase Authentication UID is the ONLY authoritative sender identity
  if (senderUserId && senderUserId !== authUid) {
    return res.status(403).json({
      error: 'Session identity mismatch: Authenticated user does not match requested sender.',
    });
  }

  const rawTarget = (recipientIdentifier || recipientAccountNumber || recipientUsername || recipientUserId || '') as string;
  const transferRef = (referenceNumber || referenceId || idempotencyKey || '') as string;

  if (!rawTarget.trim() || !amount || Number(amount) <= 0) {
    return res.status(400).json({ error: 'Valid recipient account number, username, or ID and a positive amount are required.' });
  }

  try {
    const result = await executeServerTransfer({
      senderUid: authUid,
      recipientIdentifier: rawTarget,
      amount: Number(amount),
      description,
      category,
      referenceNumber: transferRef || undefined,
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      success: true,
      transaction: result.transaction,
      balanceMetrics: result.senderBalanceMetrics,
      recipientBalanceMetrics: result.recipientBalanceMetrics,
    });

    // Asynchronous multi-channel alerts (Push, SMS, Email)
    if (result.transaction) {
      const tx = result.transaction;
      // Notify Recipient
      if (tx.recipientUserId) {
        serverNotificationDispatcher.dispatch({
          transactionId: tx.id,
          referenceNumber: tx.referenceNumber,
          type: 'MONEY_RECEIVED',
          userId: tx.recipientUserId,
          recipientName: tx.recipientName || 'Monvera Member',
          amount: Number(amount),
          currency: tx.currency || 'USD',
          senderName: tx.senderName || 'Monvera Member',
          accountMasked: 'Monvera Checking',
        }).catch((err) => console.warn('[ServerDispatcher] Transfer recipient dispatch note:', err?.message || err));
      }

      // Notify Sender
      serverNotificationDispatcher.dispatch({
        transactionId: tx.id,
        referenceNumber: tx.referenceNumber,
        type: 'MONEY_SENT',
        userId: authUid,
        recipientName: tx.recipientName || 'Monvera Member',
        amount: Number(amount),
        currency: tx.currency || 'USD',
        senderName: tx.senderName || 'You',
        accountMasked: 'Monvera Checking',
      }).catch((err) => console.warn('[ServerDispatcher] Transfer sender dispatch note:', err?.message || err));
    }
  } catch (err: any) {
    console.error('[/api/transfers/monvera Error]', err);
    res.status(500).json({ error: err?.message || 'Internal transfer processing error.' });
  }
});

// Internal Transfer (between Checking & Savings)
app.post('/api/transfers/internal', optionalFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { userId: reqUserId, fromAccountType, toAccountType, amount, description } = req.body;
  const callerUid = req.auth?.uid;
  let isCallerAdmin = req.auth?.role === 'admin' || req.auth?.role === 'super_admin' || req.auth?.email === 'daneybil2020@gmail.com' || req.auth?.email === 'admin@monvera.com';
  if (!isCallerAdmin && callerUid) {
    try {
      const uDoc = await adminFirestore.collection('users').doc(callerUid).get();
      if (uDoc.exists && (uDoc.data()?.role === 'admin' || uDoc.data()?.role === 'super_admin')) {
        isCallerAdmin = true;
      }
    } catch {}
  }
  const userId = (callerUid && !isCallerAdmin) ? callerUid : (reqUserId || callerUid);

  if (!userId || !fromAccountType || !toAccountType || !amount || amount <= 0) {
    return res.status(400).json({ error: 'All transfer fields are required.' });
  }

  // Check account freeze status
  const userDocSnap = await adminFirestore.collection('users').doc(userId).get();
  const userData = userDocSnap.exists ? userDocSnap.data()! : {};
  if (userData.status === 'frozen') {
    return res.status(403).json({
      error: 'Your account is currently restricted/frozen. Internal transfers are disabled. Please contact compliance support.',
    });
  }

  const metrics = db.getUserBalanceMetrics(userId);
  const fromAccId = fromAccountType === 'CHECKING' ? `acc_chk_${userId}` : `acc_sav_${userId}`;
  const toAccId = toAccountType === 'CHECKING' ? `acc_chk_${userId}` : `acc_sav_${userId}`;

  const available = fromAccountType === 'CHECKING' ? metrics.checkingBalance : metrics.savingsBalance;
  if (available < amount) {
    return res.status(400).json({ error: `Insufficient balance in ${fromAccountType} ($${available.toFixed(2)}).` });
  }

  const tx = db.recordInternalAccountTransfer(
    userId,
    fromAccId,
    toAccId,
    Number(amount),
    description || `Transfer from ${fromAccountType} to ${toAccountType}`
  );

  const updatedMetrics = db.getUserBalanceMetrics(userId);
  res.json({ success: true, transaction: tx, balanceMetrics: updatedMetrics });
});

// --- DEPOSITS & PAYMENT GATEWAY VERIFICATION ---
app.post('/api/deposits/create', optionalFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { amount, method, destinationAccountType, providerPaymentId, referenceNumber, metadata } = req.body;
  const callerUid = req.auth?.uid;
  let isCallerAdmin = req.auth?.role === 'admin' || req.auth?.role === 'super_admin' || req.auth?.email === 'daneybil2020@gmail.com' || req.auth?.email === 'admin@monvera.com';
  if (!isCallerAdmin && callerUid) {
    try {
      const uDoc = await adminFirestore.collection('users').doc(callerUid).get();
      if (uDoc.exists && (uDoc.data()?.role === 'admin' || uDoc.data()?.role === 'super_admin')) {
        isCallerAdmin = true;
      }
    } catch {}
  }
  const targetUserId = (callerUid && !isCallerAdmin) ? callerUid : (req.body.userId || callerUid);

  if (!targetUserId || !amount || Number(amount) <= 0) {
    return res.status(400).json({ error: 'Valid user ID and positive amount are required.' });
  }

  // Check account freeze status
  const userDocSnap = await adminFirestore.collection('users').doc(targetUserId).get();
  const userData = userDocSnap.exists ? userDocSnap.data()! : {};
  if (userData.status === 'frozen') {
    return res.status(403).json({
      error: 'Your account is currently restricted/frozen. New deposits are disabled. Please contact compliance support.',
    });
  }

  try {
    const result = await executeServerDeposit({
      userId: targetUserId,
      amount: Number(amount),
      method: method || 'CARD',
      destinationAccountType: destinationAccountType || 'CHECKING',
      providerPaymentId,
      referenceNumber,
      metadata,
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Mirror to memory db for local consistency
    try {
      db.processDeposit({
        userId: targetUserId,
        amount: Number(amount),
        method: method || 'CARD',
        destinationAccountType: destinationAccountType || 'CHECKING',
        providerPaymentId: result.transaction?.referenceNumber || providerPaymentId,
        metadata,
      });
    } catch {}

    return res.json({
      success: true,
      transaction: result.transaction,
      balanceMetrics: result.balanceMetrics,
      isDuplicate: result.isDuplicate,
    });
  } catch (err: any) {
    console.error('[POST /api/deposits/create] Uncaught error:', err);
    return res.status(500).json({ error: err?.message || 'Server failed to process deposit.' });
  }
});

// --- STRIPE INTEGRATION (DEPOSITS) ---
app.post('/api/stripe/create-checkout-session', optionalFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { userId: reqUserId, amount, destinationAccountType, origin: clientOrigin } = req.body;
  const callerUid = req.auth?.uid;
  let isCallerAdmin = req.auth?.role === 'admin' || req.auth?.role === 'super_admin' || req.auth?.email === 'daneybil2020@gmail.com' || req.auth?.email === 'admin@monvera.com';
  if (!isCallerAdmin && callerUid) {
    try {
      const uDoc = await adminFirestore.collection('users').doc(callerUid).get();
      if (uDoc.exists && (uDoc.data()?.role === 'admin' || uDoc.data()?.role === 'super_admin')) {
        isCallerAdmin = true;
      }
    } catch {}
  }
  const targetUserId = (callerUid && !isCallerAdmin) ? callerUid : (reqUserId || callerUid);

  if (!targetUserId || !amount || Number(amount) <= 0) {
    return res.status(400).json({ error: 'Valid user ID and deposit amount are required.' });
  }

  // Check account freeze status before generating checkout session
  const userDocSnap = await adminFirestore.collection('users').doc(targetUserId).get();
  const userData = userDocSnap.exists ? userDocSnap.data()! : {};
  if (userData.status === 'frozen') {
    return res.status(403).json({
      error: 'Your account is currently restricted/frozen. New deposits are disabled. Please contact compliance support.',
    });
  }

  const numAmount = Number(amount);
  const stripe = getStripe();

  if (!stripe) {
    return res.status(200).json({
      success: false,
      configured: false,
      error: 'Stripe Secret Key is not configured on this server. Please set STRIPE_SECRET_KEY in your environment variables.',
    });
  }

  try {
    const origin = clientOrigin || req.headers.origin || `http://localhost:${PORT}`;
    const user = db.users.get(targetUserId);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Monvera Premier Account Deposit',
              description: `Direct liquid balance deposit to ${
                destinationAccountType === 'SAVINGS' ? 'Treasury Savings' : 'Premier Checking'
              } account (${user?.permanentAccountNumber ? `•••• ${user.permanentAccountNumber.slice(-4)}` : 'Institutional'})`,
            },
            unit_amount: Math.round(numAmount * 100),
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      customer_email: user?.email,
      client_reference_id: targetUserId,
      metadata: {
        userId: targetUserId,
        amount: String(numAmount),
        destinationAccountType: destinationAccountType || 'CHECKING',
        customerAccountNumber: user?.permanentAccountNumber || '',
      },
      success_url: `${origin}/?deposit_status=success&session_id={CHECKOUT_SESSION_ID}&amount=${numAmount}`,
      cancel_url: `${origin}/?deposit_status=cancelled`,
    });

    res.json({
      success: true,
      configured: true,
      url: session.url,
      sessionId: session.id,
    });
  } catch (stripeErr: any) {
    console.error('[Stripe] Checkout Session Creation Error:', stripeErr);
    res.status(500).json({
      success: false,
      error: stripeErr.message || 'Failed to initialize Stripe Checkout Session.',
    });
  }
});

// Stripe Webhook handler
app.post('/api/stripe/webhook', async (req: Request, res: Response) => {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event: any = req.body;

  if (stripe && webhookSecret) {
    const sig = req.headers['stripe-signature'];
    const rawBody = (req as any).rawBody;
    if (sig && rawBody) {
      try {
        event = stripe.webhooks.constructEvent(rawBody, sig as string, webhookSecret);
      } catch (err: any) {
        console.error(`[Stripe Webhook] Signature verification failed: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }
    }
  }

  // Process checkout.session.completed or payment_intent.succeeded
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.client_reference_id || session.metadata?.userId;
    const amountStr = session.metadata?.amount;
    const amount = amountStr ? parseFloat(amountStr) : (session.amount_total ? session.amount_total / 100 : 0);
    const destinationAccountType = session.metadata?.destinationAccountType || 'CHECKING';

    if (userId && amount > 0) {
      console.log(`[Stripe Webhook] Crediting deposit of $${amount} for user ${userId}`);
      try {
        await executeServerDeposit({
          userId,
          amount,
          method: 'CARD',
          destinationAccountType,
          providerPaymentId: `STRIPE-${session.id}`,
          metadata: {
            stripeSessionId: session.id,
            stripePaymentStatus: session.payment_status,
            currency: session.currency,
          },
        });
      } catch (e: any) {
        console.warn('[Stripe Webhook] Firestore server deposit note:', e?.message || e);
      }

      const depResult = db.processDeposit({
        userId,
        amount,
        method: 'CARD',
        destinationAccountType,
        providerPaymentId: `STRIPE-${session.id}`,
        metadata: {
          stripeSessionId: session.id,
          stripePaymentStatus: session.payment_status,
          currency: session.currency,
        },
      });

      if (depResult.success && depResult.transaction) {
        const tx = depResult.transaction;
        serverNotificationDispatcher.dispatch({
          transactionId: tx.id,
          referenceNumber: tx.referenceNumber,
          type: 'MONEY_RECEIVED',
          userId,
          amount,
          currency: 'USD',
          accountMasked: 'Monvera Checking',
        }).catch(() => {});
      }
    }
  }

  res.json({ received: true });
});

// Webhook status endpoint
app.get('/api/webhooks/status', (req: Request, res: Response) => {
  const stripeConfigured = isStripeConfigured();
  const webhookSecretConfigured = Boolean(process.env.STRIPE_WEBHOOK_SECRET);
  res.json({
    success: true,
    stripeConfigured,
    webhookSecretConfigured,
    stripeWebhookPath: '/api/stripe/webhook',
    incomingWebhookPath: '/api/webhooks/incoming',
    supportedEvents: [
      'checkout.session.completed',
      'payment_intent.succeeded',
      'charge.refunded',
    ],
  });
});

// Generic inbound webhook handler (for custom fintech partners or external aggregators)
app.post('/api/webhooks/incoming', (req: Request, res: Response) => {
  const payload = req.body || {};
  const eventType = payload.event || payload.type || 'generic.webhook';
  console.log(`[Webhooks Inbound] Event '${eventType}' received:`, JSON.stringify(payload).slice(0, 150));

  res.json({
    success: true,
    received: true,
    event: eventType,
    processedAt: new Date().toISOString(),
  });
});

// Sandbox Webhook Simulator for instant testing
app.post('/api/webhooks/test-simulate', (req: Request, res: Response) => {
  const { userId, amount, eventType } = req.body;
  const targetUser = userId ? db.users.get(userId) : Array.from(db.users.values())[0];
  if (!targetUser) {
    return res.status(400).json({ error: 'No customer account found for webhook simulation.' });
  }

  const depositAmount = Number(amount) || 100.0;
  const depResult = db.processDeposit({
    userId: targetUser.id,
    amount: depositAmount,
    method: 'CARD',
    destinationAccountType: 'CHECKING',
    providerPaymentId: `SIM-WH-${Date.now()}`,
    metadata: {
      isSimulation: true,
      simulatedEvent: eventType || 'checkout.session.completed',
      timestamp: new Date().toISOString(),
    },
  });

  res.json({
    success: true,
    message: `Simulated webhook event '${eventType || 'checkout.session.completed'}' processed successfully.`,
    depositResult: depResult,
    balanceMetrics: db.getUserBalanceMetrics(targetUser.id),
  });
});

// Confirm session callback endpoint for client return
const handleStripeSessionConfirmation = async (req: AuthenticatedRequest, res: Response) => {
  const sessionId = ((req.query.session_id || req.body?.session_id || req.body?.sessionId) as string)?.trim();
  if (!sessionId) {
    return res.status(400).json({ success: false, error: 'Session ID is required.' });
  }

  const stripe = getStripe();
  if (!stripe) {
    return res.status(400).json({ success: false, error: 'Stripe is not configured on this server.' });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status === 'paid') {
      const targetUserId = session.client_reference_id || session.metadata?.userId;
      const amountStr = session.metadata?.amount;
      const amount = amountStr ? parseFloat(amountStr) : (session.amount_total ? session.amount_total / 100 : 0);
      const destinationAccountType: 'CHECKING' | 'SAVINGS' = session.metadata?.destinationAccountType === 'SAVINGS' ? 'SAVINGS' : 'CHECKING';

      if (!targetUserId || isNaN(amount) || amount <= 0) {
        return res.status(400).json({ success: false, error: 'Invalid Stripe session: missing customer identity or deposit amount.' });
      }

      // Authorization verification: if caller is authenticated, ensure caller matches target customer or is admin
      const callerUid = req.auth?.uid;
      let isCallerAdmin = req.auth?.role === 'admin' || req.auth?.role === 'super_admin' || req.auth?.email === 'daneybil2020@gmail.com' || req.auth?.email === 'admin@monvera.com';
      if (!isCallerAdmin && callerUid) {
        try {
          const uDoc = await adminFirestore.collection('users').doc(callerUid).get();
          if (uDoc.exists && (uDoc.data()?.role === 'admin' || uDoc.data()?.role === 'super_admin')) {
            isCallerAdmin = true;
          }
        } catch {}
      }
      if (callerUid && callerUid !== targetUserId && !isCallerAdmin) {
        const sessionOwner = session.client_reference_id || session.metadata?.userId;
        if (sessionOwner !== targetUserId) {
          return res.status(403).json({ success: false, error: 'Unauthorized: This checkout session belongs to another customer account.' });
        }
      }

      // Authoritative Firestore deposit settlement
      const result = await executeServerDeposit({
        userId: targetUserId,
        amount,
        method: 'CARD',
        destinationAccountType,
        providerPaymentId: `STRIPE-${session.id}`,
        metadata: {
          stripeSessionId: session.id,
          stripePaymentStatus: session.payment_status,
          currency: session.currency,
          checkoutCompletedAt: new Date().toISOString(),
        },
      });

      if (!result.success) {
        return res.status(400).json({ success: false, error: result.error });
      }

      // Mirror to memory db only for non-authoritative local cache consistency
      try {
        db.processDeposit({
          userId: targetUserId,
          amount,
          method: 'CARD',
          destinationAccountType,
          providerPaymentId: `STRIPE-${session.id}`,
          metadata: {
            stripeSessionId: session.id,
            stripePaymentStatus: session.payment_status,
          },
        });
      } catch {}

      return res.json({
        success: true,
        transaction: result.transaction,
        balanceMetrics: result.balanceMetrics,
        isDuplicate: result.isDuplicate,
      });
    }

    return res.json({ success: false, status: session.payment_status, error: `Payment not completed (status: ${session.payment_status})` });
  } catch (err: any) {
    console.error('[/api/stripe/confirm-session] Error verifying Stripe session:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to verify session' });
  }
};

app.get('/api/stripe/confirm-session', optionalFirebaseAuth, handleStripeSessionConfirmation);
app.post('/api/stripe/confirm-session', optionalFirebaseAuth, handleStripeSessionConfirmation);

// --- WITHDRAWALS ---
app.post('/api/withdrawals/create', requireFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const authUid = req.auth!.uid;
  const {
    amount,
    destinationType,
    destinationLabel,
    accountOrIban,
    sourceAccountType,
    routingNumber,
    cardBrand,
    referenceNumber,
    referenceId,
    idempotencyKey,
  } = req.body;

  const withdrawRef = (referenceNumber || referenceId || idempotencyKey || '') as string;

  if (!amount || Number(amount) <= 0 || !destinationLabel || !accountOrIban) {
    return res.status(400).json({ error: 'Missing required withdrawal details or positive amount.' });
  }

  try {
    const result = await executeServerWithdrawal({
      userId: authUid,
      amount: Number(amount),
      sourceAccountType: sourceAccountType || 'CHECKING',
      destinationType: destinationType || 'CARD',
      destinationLabel,
      accountOrIban,
      cardBrand,
      routingNumber,
      referenceNumber: withdrawRef || undefined,
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      success: true,
      transaction: result.transaction,
      balanceMetrics: result.balanceMetrics,
    });
  } catch (err: any) {
    console.error('[/api/withdrawals/create Error]', err);
    res.status(500).json({ error: err?.message || 'Internal withdrawal processing error.' });
  }
});

// Reverse pending withdrawal
app.post('/api/withdrawals/reverse', async (req: Request, res: Response) => {
  const { transactionId, userId } = req.body;
  if (!transactionId) {
    return res.status(400).json({ error: 'Transaction ID is required.' });
  }

  // Attempt server-authoritative Firestore reversal
  const fsResult = await reverseServerFirestoreWithdrawal(transactionId, userId);
  if (fsResult.success) {
    return res.json({ success: true, transaction: fsResult.transaction, balanceMetrics: fsResult.balanceMetrics });
  }

  // Fall back to memory store if transaction only existed in memory
  const result = db.reverseWithdrawal(transactionId);
  if (!result.success) {
    return res.status(400).json({ error: fsResult.error || result.error });
  }

  const effectiveUserId = userId || result.transaction?.userId || 'usr_eleanor';
  const metrics = db.getUserBalanceMetrics(effectiveUserId);
  res.json({ success: true, transaction: result.transaction, balanceMetrics: metrics });
});

// Targeted 30-minute withdrawal reversal scheduler
if (!process.env.VERCEL) {
  // Initial safety sync on startup after 5 seconds
  setTimeout(async () => {
    try {
      const reversed = await executeServerPendingWithdrawalReversals();
      if (reversed > 0) {
        console.log(`[Auto-Reversal] Reversed ${reversed} expired pending withdrawal(s) on startup.`);
      }
    } catch (e) {
      console.error('[Auto-Reversal] Startup check error:', e);
    }
  }, 5000);

  // Low-frequency safety reconciliation interval (every 10 minutes instead of every 15 seconds)
  setInterval(async () => {
    try {
      const reversed = await executeServerPendingWithdrawalReversals();
      if (reversed > 0) {
        console.log(`[Auto-Reversal] Automatically reversed ${reversed} pending Firestore withdrawal(s).`);
      }
    } catch (e) {
      console.error('[Auto-Reversal] Reconciliation check error:', e);
    }
  }, 10 * 60 * 1000);
}

// --- TRANSACTIONS EXPLORER ---
app.get('/api/transactions', optionalFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = (req.query.userId as string) || req.auth?.uid;
  const category = req.query.category as string;
  const search = (req.query.search as string)?.toLowerCase()?.trim();
  const type = req.query.type as string;
  const flow = req.query.flow as string; // 'CREDIT' | 'DEBIT' | 'ALL'
  const startDate = req.query.startDate as string;
  const endDate = req.query.endDate as string;

  let txs: any[] = [];
  let userAcc = '';

  try {
    const txCol = adminFirestore.collection('transactions');
    const txMap = new Map<string, any>();

    if (userId) {
      try {
        const uSnap = await adminFirestore.collection('users').doc(userId).get();
        if (uSnap.exists) {
          userAcc = uSnap.data()?.permanentAccountNumber || '';
        }
      } catch {}

      const cleanAcc = userAcc ? userAcc.replace(/[-\s]/g, '') : '';

      const promises = [
        txCol.where('userId', '==', userId).get(),
        txCol.where('senderUserId', '==', userId).get(),
        txCol.where('recipientUserId', '==', userId).get(),
      ];

      if (cleanAcc) {
        promises.push(txCol.where('senderAccountNumber', '==', cleanAcc).get());
        promises.push(txCol.where('recipientAccountNumber', '==', cleanAcc).get());
      }

      const snaps = await Promise.all(promises.map((p) => p.catch(() => null)));
      for (const snap of snaps) {
        if (snap && !snap.empty) {
          snap.forEach((d) => {
            const t = d.data();
            txMap.set(t.id || d.id, { ...t, id: t.id || d.id });
          });
        }
      }
    } else {
      const snap = await txCol.get();
      snap.forEach((d) => {
        const t = d.data();
        txMap.set(t.id || d.id, { ...t, id: t.id || d.id });
      });
    }

    txs = Array.from(txMap.values());
  } catch (err) {
    console.error('[/api/transactions Error reading Firestore]', err);
    txs = [...db.transactions];
    if (userId) {
      txs = txs.filter((t) => t.senderUserId === userId || t.recipientUserId === userId || t.userId === userId);
    }
  }

  if (category && category !== 'ALL' && category !== 'All') {
    txs = txs.filter((t) => t.category === category);
  }

  if (type && type !== 'ALL' && type !== 'All') {
    txs = txs.filter((t) => t.type === type);
  }

  if (flow && flow !== 'ALL' && userId) {
    if (flow === 'CREDIT') {
      txs = txs.filter((t) => {
        const userAccClean = userAcc ? userAcc.replace(/[-\s]/g, '') : '';
        const txRecipClean = (t.recipientAccountNumber || '').replace(/[-\s]/g, '');
        const isRecipient = t.recipientUserId === userId || (!t.recipientUserId && t.userId === userId) || (userAccClean && txRecipClean && txRecipClean === userAccClean);
        const isAdminTransferCredit =
          (t.metadata?.disbursementType === 'ADMINISTRATIVE_TRANSFER' ||
           t.senderAccountNumber === '1000000001' ||
           t.senderName?.includes('Bennett Johnson')) &&
          (isRecipient || t.userId === userId || t.recipientUserId === userId);
        const isIncoming = (isRecipient && t.senderUserId !== userId) || isAdminTransferCredit;
        const isDeposit =
          t.type === 'DEPOSIT' ||
          t.type === 'ADMIN_DEVELOPMENT_FUNDING' ||
          t.type === 'INVESTMENT_EARNING' ||
          t.type === 'INVESTMENT_MATURITY' ||
          isAdminTransferCredit;
        return isIncoming || isDeposit;
      });
    } else if (flow === 'DEBIT') {
      txs = txs.filter((t) => {
        const userAccClean = userAcc ? userAcc.replace(/[-\s]/g, '') : '';
        const txSenderClean = (t.senderAccountNumber || '').replace(/[-\s]/g, '');
        const isOutgoing = (t.senderUserId === userId && t.recipientUserId !== userId) || (userAccClean && txSenderClean && txSenderClean === userAccClean);
        const isWithdrawal = t.type === 'WITHDRAWAL' || t.type === 'CARD_PURCHASE' || t.type === 'FEE';
        const isAdminTransferCredit =
          (t.metadata?.disbursementType === 'ADMINISTRATIVE_TRANSFER' ||
           t.senderAccountNumber === '1000000001' ||
           t.senderName?.includes('Bennett Johnson')) &&
          (t.recipientUserId === userId || t.userId === userId);
        if (isAdminTransferCredit) return false;
        return isOutgoing || isWithdrawal;
      });
    }
  }

  if (startDate) {
    const start = new Date(startDate).getTime();
    if (!isNaN(start)) {
      txs = txs.filter((t) => new Date(t.createdAt).getTime() >= start);
    }
  }

  if (endDate) {
    const end = new Date(endDate).getTime();
    if (!isNaN(end)) {
      txs = txs.filter((t) => new Date(t.createdAt).getTime() <= end);
    }
  }

  if (search) {
    txs = txs.filter(
      (t) =>
        (t.description && t.description.toLowerCase().includes(search)) ||
        (t.referenceNumber && t.referenceNumber.toLowerCase().includes(search)) ||
        (t.senderName && t.senderName.toLowerCase().includes(search)) ||
        (t.recipientName && t.recipientName.toLowerCase().includes(search)) ||
        (t.senderAccountNumber && String(t.senderAccountNumber).includes(search)) ||
        (t.recipientAccountNumber && String(t.recipientAccountNumber).includes(search)) ||
        (t.amount && t.amount.toString().includes(search))
    );
  }

  // Always return sorted newest first
  txs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  res.json({ transactions: txs });
});

// --- INVESTMENTS CENTER ---
app.get('/api/investments', optionalFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = (req.query.userId as string) || req.auth?.uid;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  try {
    const fsSnap = await adminFirestore.collection('investments').where('userId', '==', userId).get();
    const fsInvestments: any[] = [];
    fsSnap.forEach((doc) => fsInvestments.push(doc.data()));

    // Merge with in-memory investments for full synchronization
    const userInvestmentsMap = new Map<string, any>();
    fsInvestments.forEach((i) => userInvestmentsMap.set(i.id, i));
    Array.from(db.investments.values())
      .filter((i) => i.userId === userId)
      .forEach((i) => {
        if (!userInvestmentsMap.has(i.id)) userInvestmentsMap.set(i.id, i);
      });

    const earnings = db.investmentEarnings.filter((e) => e.userId === userId);

    res.json({
      investments: Array.from(userInvestmentsMap.values()),
      earnings,
      supportedTerms: [60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360],
    });
  } catch (err: any) {
    const userInvestments = Array.from(db.investments.values()).filter((i) => i.userId === userId);
    const earnings = db.investmentEarnings.filter((e) => e.userId === userId);
    res.json({
      investments: userInvestments,
      earnings,
      supportedTerms: [60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360],
    });
  }
});

app.post('/api/investments/create', optionalFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { termDays, amount, userAccountNumber, clientRequestId, fallbackUser } = req.body;
  const callerUid = req.auth?.uid;
  let isCallerAdmin = req.auth?.role === 'admin' || req.auth?.role === 'super_admin' || req.auth?.email === 'daneybil2020@gmail.com' || req.auth?.email === 'admin@monvera.com';
  if (!isCallerAdmin && callerUid) {
    try {
      const uDoc = await adminFirestore.collection('users').doc(callerUid).get();
      if (uDoc.exists && (uDoc.data()?.role === 'admin' || uDoc.data()?.role === 'super_admin')) {
        isCallerAdmin = true;
      }
    } catch {}
  }
  const userId = (callerUid && !isCallerAdmin) ? callerUid : (req.auth?.uid || req.body.userId);

  if (!userId || !termDays || !amount) {
    return res.status(400).json({ error: 'User ID, term duration, and amount are required.' });
  }

  // Check account freeze status before investment creation
  const userDocSnap = await adminFirestore.collection('users').doc(userId).get();
  const userData = userDocSnap.exists ? userDocSnap.data()! : {};
  if (userData.status === 'frozen') {
    return res.status(403).json({
      error: 'Your account is currently restricted/frozen. New investments are disabled while the account is frozen. Please contact compliance support.',
    });
  }

  try {
    const result = await executeServerInvestmentCreation({
      userId,
      termDays: Number(termDays) as InvestmentTermDays,
      amount: Number(amount),
      clientRequestId,
      userAccountNumber,
      fallbackUser,
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Mirror to in-memory db for local sync
    try {
      db.createTermInvestment({
        userId,
        termDays: Number(termDays) as InvestmentTermDays,
        amount: Number(amount),
        userAccountNumber,
        fallbackUser,
      });
    } catch {}

    return res.json(result);
  } catch (err: any) {
    console.error('[/api/investments/create] Error:', err);
    return res.status(500).json({ error: err?.message || 'Server error creating term investment.' });
  }
});

// Settlement of Matured Term Investment
app.post('/api/investments/:id/mature', optionalFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const userId = req.auth?.uid || req.body.userId;

  if (!userId) {
    return res.status(401).json({ error: 'Authentication required to settle investment.' });
  }

  try {
    const result = await executeServerInvestmentMaturity({
      investmentId: id,
      userId,
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Mirror to in-memory db for local sync
    try {
      db.matureInvestment(id);
    } catch {}

    return res.json(result);
  } catch (err: any) {
    console.error('[/api/investments/:id/mature] Error:', err);
    return res.status(500).json({ error: err?.message || 'Server error settling term investment.' });
  }
});

// --- CARDS ---
app.get('/api/cards', (req: Request, res: Response) => {
  const userId = req.query.userId as string;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  const userCards = Array.from(db.cards.values()).filter((c) => c.userId === userId);
  res.json({ cards: userCards });
});

app.post('/api/cards/create', (req: Request, res: Response) => {
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
    userAccountNumber,
    fallbackBalances,
    fallbackUser,
  } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  const result = db.createCard({
    userId,
    cardHolderName,
    phone,
    cardType,
    cardTier,
    brand,
    spendingLimitMonthly: spendingLimitMonthly ? Number(spendingLimitMonthly) : 20000,
    spendingLimitDaily: spendingLimitDaily ? Number(spendingLimitDaily) : 20000,
    colorScheme,
    userAccountNumber,
    fallbackBalances,
    fallbackUser,
  });

  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  const targetUserId = result.card?.userId || userId;
  const balanceMetrics = db.getUserBalanceMetrics(targetUserId);
  res.json({
    success: true,
    card: result.card,
    transaction: result.transaction,
    balanceMetrics,
  });
});

app.post('/api/cards/:id/toggle-freeze', (req: Request, res: Response) => {
  const { id } = req.params;
  const card = db.cards.get(id);

  if (!card) return res.status(404).json({ error: 'Card not found' });

  card.status = card.status === 'ACTIVE' ? 'FROZEN' : 'ACTIVE';

  db.notifications.unshift({
    id: `notif_card_${Date.now()}`,
    userId: card.userId,
    title: `Card ${card.status === 'FROZEN' ? 'Frozen' : 'Reactivated'}`,
    message: `Your ${card.cardTier} (•••• ${card.maskedNumber.slice(-4)}) has been ${
      card.status === 'FROZEN' ? 'locked' : 'unlocked'
    }.`,
    type: 'SECURITY',
    severity: card.status === 'FROZEN' ? 'warning' : 'success',
    read: false,
    createdAt: new Date().toISOString(),
  });

  res.json({ success: true, card });
});

app.post('/api/cards/:id/update-limits', (req: Request, res: Response) => {
  const { id } = req.params;
  const { dailyLimit, monthlyLimit, international, online, atm } = req.body;
  const card = db.cards.get(id);

  if (!card) return res.status(404).json({ error: 'Card not found' });

  if (dailyLimit !== undefined) card.spendingLimitDaily = Number(dailyLimit);
  if (monthlyLimit !== undefined) card.spendingLimitMonthly = Number(monthlyLimit);
  if (international !== undefined) card.internationalEnabled = Boolean(international);
  if (online !== undefined) card.onlineEnabled = Boolean(online);
  if (atm !== undefined) card.atmEnabled = Boolean(atm);

  res.json({ success: true, card });
});

// --- NOTIFICATIONS & SECURITY ---
app.get('/api/notifications', (req: Request, res: Response) => {
  const userId = req.query.userId as string;
  const accountNumber = req.query.accountNumber as string;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  const matchedUserIds = new Set<string>([userId]);
  const user = db.users.get(userId) || Array.from(db.users.values()).find(
    (u) =>
      u.id === userId ||
      (accountNumber && u.permanentAccountNumber === accountNumber) ||
      (userId.includes('@') && u.email.toLowerCase() === userId.toLowerCase())
  );
  if (user) {
    matchedUserIds.add(user.id);
    if (user.permanentAccountNumber) matchedUserIds.add(user.permanentAccountNumber);
  }
  if (accountNumber) matchedUserIds.add(accountNumber);

  const userNotifs = db.notifications.filter((n) => matchedUserIds.has(n.userId) || n.userId === 'all');
  // Sort latest first
  userNotifs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json({ notifications: userNotifs });
});

app.post('/api/notifications/read', (req: Request, res: Response) => {
  const { notificationId, userId } = req.body;
  if (!notificationId || !userId) {
    return res.status(400).json({ error: 'notificationId and userId are required' });
  }

  const success = db.markNotificationAsRead(notificationId, userId);
  res.json({ success });
});

app.post('/api/notifications/read-all', (req: Request, res: Response) => {
  const { userId } = req.body;
  db.notifications.forEach((n) => {
    if (n.userId === userId) n.read = true;
  });
  res.json({ success: true });
});

app.post('/api/support/reply', (req: Request, res: Response) => {
  const { notificationId, userId, message } = req.body;
  if (!notificationId || !userId || !message) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  const result = db.replyToSupportMessage({ notificationId, userId, message });
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  res.json({ success: true, notification: result.notification });
});

// Multi-Channel Notification Dispatcher Endpoint (SMS, Email, Push)
app.post('/api/notifications/dispatch', async (req: Request, res: Response) => {
  try {
    const {
      transactionId,
      referenceNumber,
      type,
      userId,
      recipientName,
      recipientEmail,
      recipientPhone,
      amount,
      currency,
      senderName,
      accountMasked,
      preferences,
    } = req.body;

    if (!userId || !type) {
      return res.status(400).json({ error: 'userId and notification type are required' });
    }

    // Try to resolve user contact details from database if not explicitly provided
    const user = db.users.get(userId);
    const finalPhone = recipientPhone || user?.phone;
    const finalEmail = recipientEmail || user?.email;
    const finalName = recipientName || (user ? `${user.firstName} ${user.lastName}` : undefined);

    const result = await serverNotificationDispatcher.dispatch({
      transactionId: transactionId || referenceNumber || `tx_${Date.now()}`,
      referenceNumber: referenceNumber || `MV-${Date.now().toString().slice(-6)}`,
      type,
      userId,
      recipientName: finalName,
      recipientEmail: finalEmail,
      recipientPhone: finalPhone,
      amount: amount !== undefined ? Number(amount) : undefined,
      currency: currency || 'USD',
      senderName,
      accountMasked,
      preferences,
    });

    res.json({ success: true, dispatchResult: result });
  } catch (err: any) {
    console.error('[API] /api/notifications/dispatch error:', err?.message || err);
    res.status(500).json({ success: false, error: err?.message || 'Dispatch failed' });
  }
});

app.get('/api/security/sessions', (req: Request, res: Response) => {
  const userId = req.query.userId as string;
  const userSessions = db.sessions.get(userId) || [];
  res.json({ sessions: userSessions });
});

app.post('/api/security/sessions/:id/terminate', (req: Request, res: Response) => {
  const { id } = req.params;
  const { userId } = req.body;
  const currentSessions = db.sessions.get(userId) || [];
  const updated = currentSessions.filter((s) => s.id !== id);
  db.sessions.set(userId, updated);
  res.json({ success: true, sessions: updated });
});

// --- ADMIN SYSTEM & GOVERNANCE ---
app.get('/api/admin/overview', (req: Request, res: Response) => {
  const overview = db.getAdminOverview();
  res.json(overview);
});

app.get('/api/admin/customers', (req: Request, res: Response) => {
  const customers = Array.from(db.users.values())
    .filter((u) => u.id !== 'usr_admin' && u.role !== 'super_admin' && !u.email?.endsWith('@monvera.internal'))
    .map((u) => {
      const metrics = db.getUserBalanceMetrics(u.id);
      return {
        ...u,
        balanceMetrics: metrics,
      };
    });
  res.json({ customers });
});

app.post('/api/admin/customers/:id/toggle-status', optionalFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { adminId, reason, targetStatus } = req.body;

  // 1. Verify caller has administrative privileges
  const callerUid = req.auth?.uid;
  let isCallerAdmin = req.auth?.role === 'admin' || req.auth?.role === 'super_admin' || req.auth?.email === 'daneybil2020@gmail.com' || req.auth?.email === 'admin@monvera.com';
  if (!isCallerAdmin && callerUid) {
    try {
      const uDoc = await adminFirestore.collection('users').doc(callerUid).get();
      if (uDoc.exists && (uDoc.data()?.role === 'admin' || uDoc.data()?.role === 'super_admin')) {
        isCallerAdmin = true;
      }
    } catch {}
  }

  if (!isCallerAdmin) {
    return res.status(403).json({ error: 'FORBIDDEN: Only authorized compliance administrators can change customer freeze status.' });
  }

  // 2. Resolve target customer to canonical Firebase Auth UID
  const resolved = await resolveRecipientUser(id);
  if (!resolved.success || !resolved.uid) {
    if (resolved.isAmbiguous) {
      return res.status(400).json({ error: resolved.error || 'Ambiguous customer match. Target could not be uniquely resolved.' });
    }
    return res.status(404).json({ error: resolved.error || `Customer "${id}" could not be found in Monvera directory.` });
  }

  const canonicalUid = resolved.uid;

  // 3. Determine next status
  let nextStatus: 'active' | 'frozen';
  if (targetStatus === 'active' || targetStatus === 'frozen') {
    nextStatus = targetStatus;
  } else {
    // Read authoritative status from Firestore
    const userDocSnap = await adminFirestore.collection('users').doc(canonicalUid).get();
    const currentStatus = userDocSnap.exists ? (userDocSnap.data()?.status || 'active') : 'active';
    nextStatus = currentStatus === 'frozen' ? 'active' : 'frozen';
  }

  const nowIso = new Date().toISOString();

  // 4. Authoritatively persist status to Firestore users/{canonicalUid} via Firebase Admin
  try {
    await adminFirestore.collection('users').doc(canonicalUid).set(
      {
        status: nextStatus,
        statusUpdatedAt: nowIso,
        statusUpdatedBy: adminId || callerUid || 'usr_admin',
        freezeReason: nextStatus === 'frozen' ? (reason || 'Administrative compliance audit') : null,
      },
      { merge: true }
    );
  } catch (err: any) {
    console.error('Failed to persist customer status to Firestore:', err);
    return res.status(500).json({ error: 'Failed to persist status change to authoritative database.' });
  }

  // 5. Update in-memory DB cache and target identifier mappings
  let user = db.users.get(canonicalUid);
  if (!user) {
    user = db.users.get(id);
  }
  if (!user) {
    user = Array.from(db.users.values()).find((u) => u.id === canonicalUid || u.id === id || u.email === id);
  }

  if (user) {
    user.status = nextStatus;
    db.users.set(canonicalUid, user);
  } else {
    const existingData = resolved.data || {};
    const placeholderUser: UserProfile = {
      id: canonicalUid,
      username: existingData.username || `user_${canonicalUid.slice(0, 6)}`,
      firstName: existingData.firstName || 'Account',
      lastName: existingData.lastName || 'Holder',
      email: existingData.email || `${canonicalUid}@monvera.internal`,
      phone: existingData.phone || '+1 (555) 000-0000',
      permanentAccountNumber: existingData.permanentAccountNumber || `10${Math.floor(10000000 + Math.random() * 90000000)}`,
      status: nextStatus,
      role: existingData.role || 'customer',
      membershipTier: existingData.membershipTier || 'Premier',
      twoFactorEnabled: existingData.twoFactorEnabled || false,
      createdAt: existingData.createdAt || nowIso,
      kycStatus: existingData.kycStatus || 'unverified',
      country: existingData.country || 'United States',
      dailyTransactionLimit: 1000000,
    };
    db.users.set(canonicalUid, placeholderUser);
    user = placeholderUser;
  }

  db.auditLogs.unshift({
    id: `aud_${Date.now()}`,
    adminId: adminId || callerUid || 'usr_admin',
    adminName: 'Monvera Compliance Admin',
    action: nextStatus === 'frozen' ? 'CUSTOMER_ACCOUNT_RESTRICTED' : 'CUSTOMER_ACCOUNT_UNFROZEN',
    targetUserId: canonicalUid,
    targetAccountNumber: user.permanentAccountNumber,
    reason: reason || (nextStatus === 'frozen' ? 'Account placed on administrative freeze' : 'Administrative hold lifted'),
    timestamp: nowIso,
    ipAddress: '127.0.0.1 (Admin Console)',
    result: 'SUCCESS',
  });

  res.json({ success: true, user, status: nextStatus, canonicalUid });
});

app.post('/api/user/unfreeze', optionalFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const callerUid = req.auth?.uid;
  let isCallerAdmin = req.auth?.role === 'admin' || req.auth?.role === 'super_admin' || req.auth?.email === 'daneybil2020@gmail.com' || req.auth?.email === 'admin@monvera.com';
  if (!isCallerAdmin && callerUid) {
    try {
      const uDoc = await adminFirestore.collection('users').doc(callerUid).get();
      if (uDoc.exists && (uDoc.data()?.role === 'admin' || uDoc.data()?.role === 'super_admin')) {
        isCallerAdmin = true;
      }
    } catch {}
  }

  if (!isCallerAdmin) {
    return res.status(403).json({ error: 'Customer self-unfreeze is disabled. Only authorized compliance administrators can unfreeze accounts.' });
  }

  const { userId, reason } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  // Resolve canonical UID
  const resolved = await resolveRecipientUser(userId);
  if (!resolved.success || !resolved.uid) {
    return res.status(404).json({ error: resolved.error || `Customer "${userId}" could not be found.` });
  }

  const canonicalUid = resolved.uid;
  const nowIso = new Date().toISOString();

  // Persist unfreeze to Firestore users/{canonicalUid}
  try {
    await adminFirestore.collection('users').doc(canonicalUid).set(
      {
        status: 'active',
        statusUpdatedAt: nowIso,
        statusUpdatedBy: callerUid || 'usr_admin',
        freezeReason: null,
      },
      { merge: true }
    );
  } catch (err: any) {
    console.error('Failed to unfreeze in Firestore:', err);
    return res.status(500).json({ error: 'Failed to update authoritative database.' });
  }

  let user = db.users.get(canonicalUid);
  if (!user) {
    user = Array.from(db.users.values()).find((u) => u.id === canonicalUid || u.email === canonicalUid);
  }

  if (user) {
    user.status = 'active';
  }

  db.auditLogs.unshift({
    id: `aud_${Date.now()}`,
    adminId: callerUid || 'usr_admin',
    adminName: 'Monvera Compliance Admin',
    action: 'CUSTOMER_ACCOUNT_UNFROZEN',
    targetUserId: canonicalUid,
    targetAccountNumber: user?.permanentAccountNumber || '1000000000',
    reason: reason || 'Administrative compliance unfreeze',
    timestamp: nowIso,
    ipAddress: '127.0.0.1 (Admin Console)',
    result: 'SUCCESS',
  });

  res.json({ success: true, status: 'active', user, canonicalUid });
});

// Admin KYC Approval & Rejection Endpoints
app.post('/api/admin/kyc/approve', (req: Request, res: Response) => {
  const { userId, adminId, userProfile } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  const result = db.approveKyc(userId, adminId, userProfile);
  if (!result.success) return res.status(400).json({ error: result.error });

  res.json(result);
});

app.post('/api/admin/kyc/reject', (req: Request, res: Response) => {
  const { userId, reason, adminId, userProfile } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  const result = db.rejectKyc({ userId, reason: reason || 'Documents could not be verified by compliance.', adminId, userProfile });
  if (!result.success) return res.status(400).json({ error: result.error });

  res.json(result);
});

app.post('/api/admin/kyc/review-item', (req: Request, res: Response) => {
  const { userId, itemName, status, reason, adminId, userProfile } = req.body;
  if (!userId || !itemName || !status) {
    return res.status(400).json({ error: 'userId, itemName, and status are required' });
  }

  const result = db.reviewKycItem({
    userId,
    itemName,
    status,
    reason,
    adminId,
    userProfile,
  });

  if (!result.success) return res.status(400).json({ error: result.error });

  res.json(result);
});

// Admin Transaction Status Endpoint
app.post('/api/admin/transactions/:id/update-status', (req: Request, res: Response) => {
  const { id } = req.params;
  const { status, adminId, reason } = req.body;
  if (!status) return res.status(400).json({ error: 'status is required' });

  const result = db.updateTransactionStatus({ txId: id, status, adminId, reason });
  if (!result.success) return res.status(400).json({ error: result.error });

  res.json(result);
});

// Admin Transfer Direct Endpoint (Bennett Johnson)
app.post('/api/admin/transfer', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
  const adminUid = req.auth!.uid;
  const {
    targetUserId,
    targetAccountNumber,
    targetName,
    targetUsername,
    targetEmail,
    amount,
    description,
    category,
    referenceNumber,
  } = req.body;

  const targetIdentifier = targetUserId || targetAccountNumber || targetEmail || targetUsername;

  if (!targetIdentifier || !amount || Number(amount) <= 0) {
    return res.status(400).json({ error: 'Target customer ID and positive transfer amount are required.' });
  }

  try {
    const result = await executeServerAdminTransfer({
      adminId: adminUid,
      targetIdentifier,
      amount: Number(amount),
      description: description || 'Transfer from Bennett Johnson',
      category: category || 'Transfers',
      referenceNumber,
      clientRequestId: req.body.clientRequestId || referenceNumber,
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    const resolvedTargetId = result.transaction?.recipientUserId || targetUserId;

    // Mirror to memory db for local caching consistency
    try {
      db.recordAdminTransfer({
        adminId: adminUid,
        targetUserId: resolvedTargetId,
        targetAccountNumber,
        targetName,
        targetUsername,
        targetEmail,
        amount: Number(amount),
        description: description || 'Transfer from Bennett Johnson',
        category: category || 'Transfers',
      });
    } catch {}

    res.json({
      success: true,
      transaction: result.transaction,
      targetBalanceMetrics: result.targetBalanceMetrics,
      isDuplicate: result.isDuplicate || false,
    });

    // Asynchronously dispatch multi-channel notification for Bennett Johnson admin transfer
    if (result.transaction) {
      const tx = result.transaction;
      const recipientUser = db.users.get(resolvedTargetId);
      serverNotificationDispatcher.dispatch({
        transactionId: tx.id,
        referenceNumber: tx.referenceNumber,
        type: 'MONEY_RECEIVED',
        userId: resolvedTargetId,
        recipientName: recipientUser ? `${recipientUser.firstName} ${recipientUser.lastName}` : (targetName || tx.recipientName || 'Monvera Client'),
        recipientEmail: recipientUser?.email || targetEmail,
        recipientPhone: recipientUser?.phone,
        amount: Number(amount),
        currency: tx.currency || 'USD',
        senderName: 'Bennett Johnson',
        accountMasked: (tx as any).accountName || 'Monvera Premier Checking',
      }).catch((err) => console.warn('[ServerDispatcher] Admin transfer dispatch note:', err?.message || err));
    }
  } catch (err: any) {
    console.error('[POST /api/admin/transfer] Error:', err);
    return res.status(500).json({ error: err?.message || 'Server error processing administrative transfer.' });
  }
});

// Admin Development Funding System (Isolated for testing/staging)
app.post('/api/admin/dev-fund', optionalFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { adminId, targetUserId, amount, reason, targetAccountType, referenceId } = req.body;

  if (!targetUserId || !amount || Number(amount) <= 0) {
    return res.status(400).json({ error: 'Target customer ID and positive amount are required.' });
  }

  const numAmount = Number(amount);

  if (numAmount > db.devFundingPoolBalance) {
    return res.status(400).json({
      error: `Requested amount exceeds available Development Funding Pool balance ($${db.devFundingPoolBalance.toLocaleString(
        'en-US',
        { minimumFractionDigits: 2 }
      )}).`,
    });
  }

  try {
    const result = await executeServerAdminDevFunding({
      adminId: adminId || req.auth?.uid || 'usr_admin',
      targetUserId,
      amount: numAmount,
      reason: reason || 'Sandbox liquidity disbursement',
      targetAccountType: targetAccountType || 'CHECKING',
      referenceId,
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Mirror to memory db
    try {
      db.issueAdminDevFunding({
        adminId: adminId || 'usr_admin',
        targetUserId,
        amount: numAmount,
        reason: reason || 'Sandbox liquidity disbursement',
        targetAccountType: targetAccountType || 'CHECKING',
        referenceId,
      });
    } catch {}

    return res.json({
      success: true,
      transaction: result.transaction,
      targetBalanceMetrics: result.targetBalanceMetrics,
      devFundingPoolBalance: db.devFundingPoolBalance,
      isDuplicate: result.isDuplicate || false,
    });
  } catch (err: any) {
    console.error('[POST /api/admin/dev-fund] Error:', err);
    return res.status(500).json({ error: err?.message || 'Server error issuing development funding.' });
  }
});

app.post('/api/admin/dev-topup', (req: Request, res: Response) => {
  const { adminId, amount, reason } = req.body;
  const topupAmount = Number(amount) || 100000000;

  const result = db.topUpDevFundingPool(adminId || 'usr_admin', topupAmount, reason || 'Replenish development testing pool');
  res.json(result);
});

app.get('/api/admin/audit-logs', (req: Request, res: Response) => {
  res.json({ auditLogs: db.auditLogs });
});

// --- LOANS & CREDIT FACILITY API ---
app.get('/api/loans', requireFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const callerUid = req.auth!.uid;
  let isCallerAdmin = req.auth?.role === 'admin' || req.auth?.role === 'super_admin' || req.auth?.email === 'daneybil2020@gmail.com' || req.auth?.email === 'admin@monvera.com';
  if (!isCallerAdmin && callerUid) {
    try {
      const uDoc = await adminFirestore.collection('users').doc(callerUid).get();
      if (uDoc.exists && (uDoc.data()?.role === 'admin' || uDoc.data()?.role === 'super_admin')) {
        isCallerAdmin = true;
      }
    } catch {}
  }

  const requestedUserId = req.query.userId as string | undefined;

  // Ordinary customers must receive only loans belonging to their authenticated Firebase UID.
  // Reject requests attempting to access another user's loans.
  if (!isCallerAdmin) {
    if (requestedUserId && requestedUserId !== callerUid) {
      return res.status(403).json({
        error: 'FORBIDDEN: You are not authorized to view another customer\'s loans.',
      });
    }
  }

  const targetUserId = isCallerAdmin ? requestedUserId : callerUid;

  try {
    const loanMap = new Map<string, any>();

    if (targetUserId) {
      // Query authoritative Firestore for the specific user
      const fsSnap = await adminFirestore.collection('loans').where('userId', '==', targetUserId).get();
      fsSnap.forEach((doc) => {
        const data = doc.data();
        if (data && data.id) loanMap.set(data.id, data);
      });

      // Also merge in-memory loans if matched by userId
      Array.from(db.loans.values()).forEach((l) => {
        if (l.userId === targetUserId && !loanMap.has(l.id)) {
          loanMap.set(l.id, l);
        }
      });
    } else if (isCallerAdmin) {
      // Full loan listings only for authorized administrators
      const fsSnap = await adminFirestore.collection('loans').get();
      fsSnap.forEach((doc) => {
        const data = doc.data();
        if (data && data.id) loanMap.set(data.id, data);
      });

      Array.from(db.loans.values()).forEach((l) => {
        if (!loanMap.has(l.id)) {
          loanMap.set(l.id, l);
        }
      });
    }

    const loanList = Array.from(loanMap.values()).sort(
      (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return res.json({ loans: loanList });
  } catch (err: any) {
    console.error('[/api/loans Error]', err);
    return res.status(500).json({ error: 'Failed to retrieve loan records.' });
  }
});

app.get('/api/loans/eligibility', (req: Request, res: Response) => {
  const userId = req.query.userId as string;
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }
  const queryVolume = Number(req.query.volume);
  const dbVolume = db.calculateUserTransactionVolume(userId);
  const volume = !isNaN(queryVolume) && queryVolume > dbVolume ? queryVolume : dbVolume;
  const eligibility = db.getLoanEligibilityTier(volume);
  res.json({ volume, ...eligibility });
});

app.post('/api/loans/apply', optionalFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { userId, amount, termMonths, purpose, employmentOrBusinessDetails, annualIncomeOrRevenue, collateralDescription, fallbackUser, applicantName, applicantEmail, applicantPhone, permanentAccountNumber } = req.body;
  if (!userId || !amount) {
    return res.status(400).json({ error: 'User ID and loan amount are required.' });
  }

  const callerUid = req.auth?.uid;
  let isCallerAdmin = req.auth?.role === 'admin' || req.auth?.role === 'super_admin' || req.auth?.email === 'daneybil2020@gmail.com' || req.auth?.email === 'admin@monvera.com';
  if (!isCallerAdmin && callerUid) {
    try {
      const uDoc = await adminFirestore.collection('users').doc(callerUid).get();
      if (uDoc.exists && (uDoc.data()?.role === 'admin' || uDoc.data()?.role === 'super_admin')) {
        isCallerAdmin = true;
      }
    } catch {}
  }
  const effectiveUserId = (callerUid && !isCallerAdmin) ? callerUid : (callerUid || userId);

  // Check account freeze status before loan application
  const userDocSnap = await adminFirestore.collection('users').doc(effectiveUserId).get();
  const userData = userDocSnap.exists ? userDocSnap.data()! : {};
  if (userData.status === 'frozen') {
    return res.status(403).json({
      error: 'Your account is currently restricted/frozen. Loan applications are disabled. Please contact compliance support.',
    });
  }

  // 1. Authoritative server-side check in Firestore
  const outstandingCheck = await checkUserHasOutstandingLoan({
    userId: effectiveUserId,
    authUid: callerUid,
    permanentAccountNumber,
    email: applicantEmail,
  });

  if (outstandingCheck.hasOutstanding) {
    return res.status(400).json({
      error: 'You currently have an outstanding loan. Please pay off your existing loan before applying for another loan.',
    });
  }

  const result = db.createLoanApplication({
    userId: outstandingCheck.canonicalUid || effectiveUserId,
    amount: Number(amount),
    termMonths: Number(termMonths) || 12,
    purpose,
    employmentOrBusinessDetails,
    annualIncomeOrRevenue: annualIncomeOrRevenue ? Number(annualIncomeOrRevenue) : undefined,
    collateralDescription,
    fallbackUser: fallbackUser || {
      firstName: applicantName?.split(' ')[0] || 'Valued',
      lastName: applicantName?.split(' ').slice(1).join(' ') || 'Client',
      email: applicantEmail,
      phone: applicantPhone,
      permanentAccountNumber,
    },
  });

  if (!result.success) return res.status(400).json({ error: result.error });

  // Persist newly created loan to Firestore so subsequent queries find it
  if (result.loan) {
    try {
      await adminFirestore.collection('loans').doc(result.loan.id).set(result.loan, { merge: true });
    } catch (fsErr) {
      console.warn('Failed to persist loan to Firestore in server.ts:', fsErr);
    }
  }

  res.json(result);
});

app.post('/api/admin/loans/approve', optionalFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { loanId, adminId, fallbackLoan, fallbackUser } = req.body;
  if (!loanId) return res.status(400).json({ error: 'loanId is required.' });

  try {
    const result = await executeServerLoanDisbursement({
      loanId,
      adminId: req.auth?.uid || adminId || 'usr_admin',
      fallbackLoan,
      fallbackUser,
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Mirror to in-memory db for local synchronization
    try {
      db.adminApproveLoan({ loanId, adminId: adminId || 'usr_admin', fallbackLoan, fallbackUser });
    } catch {}

    return res.json(result);
  } catch (err: any) {
    console.error('[/api/admin/loans/approve] Error:', err);
    return res.status(500).json({ error: err?.message || 'Server error approving loan.' });
  }
});

app.post('/api/admin/loans/reject', optionalFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { loanId, reason, adminId } = req.body;
  if (!loanId) return res.status(400).json({ error: 'loanId is required.' });

  const callerUid = req.auth?.uid;
  let isCallerAdmin = req.auth?.role === 'admin' || req.auth?.role === 'super_admin' || req.auth?.email === 'daneybil2020@gmail.com' || req.auth?.email === 'admin@monvera.com';
  if (!isCallerAdmin && callerUid) {
    try {
      const uDoc = await adminFirestore.collection('users').doc(callerUid).get();
      if (uDoc.exists && (uDoc.data()?.role === 'admin' || uDoc.data()?.role === 'super_admin')) {
        isCallerAdmin = true;
      }
    } catch {}
  }

  if (!isCallerAdmin) {
    return res.status(403).json({ error: 'FORBIDDEN: Only authorized compliance administrators can reject loan applications.' });
  }

  const effectiveAdminId = adminId || callerUid || 'usr_admin';
  const nowIso = new Date().toISOString();
  const rejectionReason = reason || 'Application declined by compliance';

  // 1. Authoritatively update Firestore loan document
  let loanData: LoanApplication | null = null;
  try {
    const loanDocRef = adminFirestore.collection('loans').doc(loanId);
    const loanSnap = await loanDocRef.get();
    if (loanSnap.exists) {
      loanData = loanSnap.data() as LoanApplication;
      await loanDocRef.set(
        {
          status: 'REJECTED',
          rejectedAt: nowIso,
          rejectionReason,
          rejectedBy: effectiveAdminId,
          updatedAt: nowIso,
        },
        { merge: true }
      );
      loanData.status = 'REJECTED';
      loanData.rejectedAt = nowIso;
      loanData.rejectionReason = rejectionReason;
      loanData.rejectedBy = effectiveAdminId;
      loanData.updatedAt = nowIso;

      // Dispatch security notification to borrower
      if (loanData.userId) {
        const notifId = `notif_${Date.now()}_loan_rej`;
        await adminFirestore.collection('notifications').doc(notifId).set(
          {
            id: notifId,
            userId: loanData.userId,
            title: 'Loan Application Update',
            message: `Your credit facility application (#${loanId.slice(-6).toUpperCase()}) was declined. Reason: "${rejectionReason}".`,
            type: 'SYSTEM',
            severity: 'error',
            read: false,
            createdAt: nowIso,
            referenceId: loanId,
          },
          { merge: true }
        );
      }
    }
  } catch (fsErr) {
    console.error('[/api/admin/loans/reject] Firestore error:', fsErr);
    return res.status(500).json({ error: 'Failed to persist loan rejection to authoritative database.' });
  }

  // 2. Sync to in-memory db
  const result = db.adminRejectLoan({ loanId, reason: rejectionReason, adminId: effectiveAdminId });
  if (!result.success && !loanData) {
    return res.status(400).json({ error: result.error });
  }

  res.json({ success: true, loan: loanData || result.loan });
});

app.post('/api/loans/repay', optionalFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { loanId, amount, sourceAccountId, note, referenceNumber, fallbackLoan, fallbackUser } = req.body;
  const callerUid = req.auth?.uid;
  let isCallerAdmin = req.auth?.role === 'admin' || req.auth?.role === 'super_admin' || req.auth?.email === 'daneybil2020@gmail.com' || req.auth?.email === 'admin@monvera.com';
  if (!isCallerAdmin && callerUid) {
    try {
      const uDoc = await adminFirestore.collection('users').doc(callerUid).get();
      if (uDoc.exists && (uDoc.data()?.role === 'admin' || uDoc.data()?.role === 'super_admin')) {
        isCallerAdmin = true;
      }
    } catch {}
  }
  const userId = (callerUid && !isCallerAdmin) ? callerUid : (req.auth?.uid || req.body.userId);

  if (!loanId || !userId || !amount) {
    return res.status(400).json({ error: 'loanId, userId, and repayment amount are required.' });
  }

  // Check account freeze status before loan repayment
  const userDocSnap = await adminFirestore.collection('users').doc(userId).get();
  const userData = userDocSnap.exists ? userDocSnap.data()! : {};
  if (userData.status === 'frozen') {
    return res.status(403).json({
      error: 'Your account is currently restricted/frozen. Loan repayments are disabled while the account is frozen. Please contact compliance support.',
    });
  }

  try {
    const result = await executeServerLoanRepayment({
      loanId,
      userId,
      amount: Number(amount),
      sourceAccountId,
      note,
      referenceNumber,
      fallbackLoan,
      fallbackUser,
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Mirror to in-memory db for local synchronization
    try {
      db.repayLoan({
        loanId,
        userId,
        amount: Number(amount),
        sourceAccountId,
        note,
        fallbackLoan,
        fallbackUser,
      });
    } catch {}

    return res.json(result);
  } catch (err: any) {
    console.error('[/api/loans/repay] Error:', err);
    return res.status(500).json({ error: err?.message || 'Server error processing loan repayment.' });
  }
});

// --- SUPPORT CHAT LIVE PERSISTENCE ---
app.get('/api/support/messages', (req: Request, res: Response) => {
  const userId = req.query.userId as string;
  const allMessages = Array.from(db.supportMessages.values());
  if (!userId) {
    return res.json({ messages: allMessages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()) });
  }
  const userMessages = allMessages
    .filter((m) => m.userId === userId || m.userEmail === userId || m.userAccountNumber === userId)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  res.json({ messages: userMessages });
});

app.post('/api/support/messages', (req: Request, res: Response) => {
  const msg = req.body;
  if (!msg || !msg.id || !msg.userId) {
    return res.status(400).json({ error: 'Valid message with id and userId required.' });
  }
  db.supportMessages.set(msg.id, msg);
  res.json({ success: true, message: msg });
});

app.post('/api/support/messages/read', (req: Request, res: Response) => {
  const { userId, role } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }
  for (const [id, msg] of db.supportMessages.entries()) {
    if (msg.userId === userId) {
      if (role === 'admin' && msg.sender === 'user') {
        db.supportMessages.set(id, { ...msg, status: 'read' });
      } else if (role === 'user' && msg.sender === 'support') {
        db.supportMessages.set(id, { ...msg, status: 'read' });
      }
    }
  }
  res.json({ success: true });
});

// --- VITE / STATIC SERVING ---
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MONVERA Core Banking System running on http://localhost:${PORT}`);
  });
}

if (!process.env.VERCEL) {
  startServer();
}

export default app;
export { app };
