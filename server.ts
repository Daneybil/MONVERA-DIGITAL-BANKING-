import 'dotenv/config';
import crypto from 'crypto';
import express, { Request, Response } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { db } from './server/db';
import {
  serverNotificationDispatcher,
  registerCustomerPushToken,
  unregisterCustomerPushToken,
  validatePushToken,
  buildTrustedTransferDispatchEvents,
  areTransferParticipantsAllowlisted,
  isOutboundNotificationsDisabled,
  isUidAllowlisted,
  parseNotificationAllowlistUids,
  resolveNotificationAllowlistPolicy,
} from './server/services/notificationDispatcher';
import {
  computeNotificationOutboxId,
  prepareNotificationOutboxBatch,
  writePreparedNotificationOutboxBatchInTransaction,
} from './server/services/notificationOutbox';
import {
  isNotificationWorkerEnabled,
  startNotificationOutboxWorker,
} from './server/services/notificationOutboxWorker';
import { persistCustomerNotification, maskAccountNumber, resolveCustomerNotificationContext } from './server/services/notificationStore';
import { UserProfile, InvestmentTermDays, LoanApplication, AdminSystemOverview } from './src/types';
import { getStripe, isStripeConfigured } from './server/stripe';
import { requireFirebaseAuth, optionalFirebaseAuth, requireAdminAuth, isCallerAdministrator, getConfiguredAdminEmails, AuthenticatedRequest, createAdminSessionToken, verifyAdminSessionToken } from './server/authMiddleware';
import { adminAuth, adminFirestore, isFirebaseAdminConfigured, getFirebaseAdminDiagnostics } from './server/firebaseAdmin';
import { executeServerAdminCheckWithdrawal, getAllIssuedChecksAdmin, resolveCustomerPreviewBalanceMetrics } from './server/adminCheckService';
import {
  executeServerWireCheckWithdrawal,
  getAllWireCheckRequestsAdmin,
  markWireCheckRequestDeliveredAdmin,
} from './server/wireCheckService';
import {
  executeServerTransfer,
  executeServerInternalTransfer,
  executeServerWithdrawal,
  executeServerDeposit,
  executeServerAdminTransfer,
  executeServerAdminDevFunding,
  executeServerLoanDisbursement,
  executeServerLoanRepayment,
  executeServerInvestmentCreation,
  executeServerInvestmentMaturity,
  executeServerCardIssuance,
  executeServerPendingWithdrawalReversals,
  reverseServerFirestoreWithdrawal,
  checkUserHasOutstandingLoan,
  resolveRecipientUser,
  getAllWithdrawalSupportRecordsAdmin,
  submitBankAccountApplication,
  getCustomerBankAccountApplications,
  getAllBankAccountApplicationsAdmin,
  getBankVerificationRequestsAdmin,
  approveBankAccountApplication,
  rejectBankAccountApplication,
  cancelBankAccountApplication,
  adminCancelBankAccount,
  completeBankVerification,
  approveBankVerificationCode,
  rejectBankVerificationCode,
  submitCardActivationRequest,
  getCustomerCardActivationStatus,
  getAllCardActivationRequestsAdmin,
  approveCardActivationRequest,
  rejectCardActivationRequest,
} from './server/firestoreTransactions';
import { evaluateAndProcessWelcomeReward, getAllWelcomeRewardsAdmin } from './server/welcomeRewardService';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// CORS & Preflight handling for browser clients
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Admin-Session, X-Admin-Console, X-Admin-Email');
  res.header('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use(
  express.json({
    limit: '50mb',
    verify: (req: any, _res, buf) => {
      if (
        (req.originalUrl && req.originalUrl.startsWith('/api/stripe/webhook')) ||
        (req.url && req.url.startsWith('/api/stripe/webhook'))
      ) {
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

// Safe service health & route readiness check (no secrets or private configuration)
app.get('/api/health', (_req: Request, res: Response) => {
  return res.json({
    success: true,
    status: 'ok',
    service: 'monvera-core-banking-api',
    version: '2026.11.13-bank-v2',
    timestamp: new Date().toISOString(),
  });
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

  // If user already exists by ID, sync non-sensitive fields and return existing user
  if (db.users.has(userId)) {
    const existingUser = db.users.get(userId)!;
    // Allow updating legal name before verification
    if (existingUser.kycStatus !== 'verified') {
      if (firstName) existingUser.firstName = firstName.trim();
      if (lastName) existingUser.lastName = lastName.trim();
      existingUser.kycFirstName = existingUser.firstName;
      existingUser.kycLastName = existingUser.lastName;
      existingUser.kycFullName = `${existingUser.firstName} ${existingUser.lastName}`;
    }
    // Prevent unverified payload from downgrading verified or pending user
    if (req.body.kycStatus && req.body.kycStatus !== 'unverified') {
      existingUser.kycStatus = req.body.kycStatus;
    }
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
    if (existingByEmail.kycStatus !== 'verified') {
      if (firstName) existingByEmail.firstName = firstName.trim();
      if (lastName) existingByEmail.lastName = lastName.trim();
      existingByEmail.kycFirstName = existingByEmail.firstName;
      existingByEmail.kycLastName = existingByEmail.lastName;
      existingByEmail.kycFullName = `${existingByEmail.firstName} ${existingByEmail.lastName}`;
    }
    if (req.body.kycStatus && req.body.kycStatus !== 'unverified') {
      existingByEmail.kycStatus = req.body.kycStatus;
    }
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

    // Persist new user profile to Firestore users collection
    await adminFirestore.collection('users').doc(userId).set({
      ...newUser,
      usernameLower: newUser.username.toLowerCase(),
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  } catch (fsErr) {
    console.warn('[Register] Firestore initial accounts/user initialization note:', fsErr);
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

// --- USER PROFILE UPDATE ENDPOINT ---
// Authenticated endpoint allowing customers to correct legal name, phone, address, etc. before verification
// Permanently locks verified legal name once customer has reached 'verified' status
app.post('/api/user/profile', optionalFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { userId, firstName, lastName, phone, dateOfBirth, country, address, streetAddress, maritalStatus, businessName } = req.body;
  const effectiveUserId = req.auth?.uid || userId;

  if (!effectiveUserId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  if (req.auth?.uid && req.auth.uid !== effectiveUserId && !(await isCallerAdministrator(req.auth.uid, req.auth.email, req.auth))) {
    return res.status(403).json({ error: 'FORBIDDEN: You can only update your own user profile.' });
  }

  try {
    const userDocRef = adminFirestore.collection('users').doc(effectiveUserId);
    const userDocSnap = await userDocRef.get();
    const existingFsData = userDocSnap.exists ? userDocSnap.data()! : {};
    const existingKycStatus = existingFsData.kycStatus || db.users.get(effectiveUserId)?.kycStatus || 'unverified';

    const trimmedFirst = firstName?.trim() || existingFsData.firstName || '';
    const trimmedLast = lastName?.trim() || existingFsData.lastName || '';

    // If verified, legal name cannot be modified by customer
    if (existingKycStatus === 'verified') {
      const isTryingToChangeName =
        (firstName && firstName.trim() !== (existingFsData.firstName || '')) ||
        (lastName && lastName.trim() !== (existingFsData.lastName || ''));
      if (isTryingToChangeName) {
        return res.status(403).json({
          error: 'FORBIDDEN: Verified legal name is permanently locked. Legal name changes require formal compliance review.',
        });
      }
    }

    const cleanFullName = `${trimmedFirst} ${trimmedLast}`.trim();
    const updatePayload: Record<string, any> = {
      id: effectiveUserId,
      uid: effectiveUserId,
      updatedAt: new Date().toISOString(),
    };

    if (existingKycStatus !== 'verified') {
      if (trimmedFirst) updatePayload.firstName = trimmedFirst;
      if (trimmedLast) updatePayload.lastName = trimmedLast;
      if (cleanFullName) {
        updatePayload.fullName = cleanFullName;
        updatePayload.kycFullName = cleanFullName;
        updatePayload.kycFirstName = trimmedFirst;
        updatePayload.kycLastName = trimmedLast;
      }
    }

    if (phone !== undefined) updatePayload.phone = phone.trim();
    if (dateOfBirth !== undefined) updatePayload.dateOfBirth = dateOfBirth.trim();
    if (country !== undefined) updatePayload.country = country.trim();
    if (address !== undefined) updatePayload.address = address.trim();
    if (streetAddress !== undefined) updatePayload.streetAddress = streetAddress.trim();
    if (maritalStatus !== undefined) updatePayload.maritalStatus = maritalStatus.trim();
    if (businessName !== undefined) updatePayload.businessName = businessName.trim();

    await userDocRef.set(updatePayload, { merge: true });

    // Synchronize server in-memory database
    let memUser = db.users.get(effectiveUserId);
    if (memUser) {
      Object.assign(memUser, updatePayload);
      db.users.set(effectiveUserId, memUser);
    } else {
      const freshSnap = await userDocRef.get();
      if (freshSnap.exists) {
        memUser = { id: effectiveUserId, ...freshSnap.data() } as UserProfile;
        db.users.set(effectiveUserId, memUser);
      }
    }

    res.json({ success: true, user: memUser || updatePayload });
  } catch (err: any) {
    console.error('[POST /api/user/profile] Error:', err);
    res.status(500).json({ error: err?.message || 'Failed to update user profile' });
  }
});

// --- PROTECTED KYC DOCUMENT INSPECTION ENDPOINT ---
// Allows authenticated owner and authorized administrators to securely retrieve submitted verification documents
app.get('/api/kyc/documents/:userId/:docType', optionalFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { userId, docType } = req.params;
  const callerUid = req.auth?.uid;
  let isOwner = callerUid && callerUid === userId;
  let isAdmin = await isCallerAdministrator(callerUid, req.auth?.email, req.auth);

  // Support authenticated admin session from query param or header for <img> tag rendering
  const queryAdminSession = (req.query.adminSession as string) || (req.headers['x-admin-session'] as string);
  if (!isAdmin && queryAdminSession) {
    const verified = verifyAdminSessionToken(queryAdminSession);
    if (verified.valid) isAdmin = true;
  }

  // Support authenticated customer token from query param if <img> tag cannot send Authorization header
  const queryToken = req.query.token as string;
  if (!isOwner && queryToken && isFirebaseAdminConfigured()) {
    try {
      const decoded = await adminAuth.verifyIdToken(queryToken);
      if (decoded && decoded.uid === userId) isOwner = true;
      if (decoded && await isCallerAdministrator(decoded.uid, decoded.email, decoded)) isAdmin = true;
    } catch {}
  }

  if (!isOwner && !isAdmin) {
    return res.status(403).json({ error: 'FORBIDDEN: You do not have permission to view this customer document.' });
  }

  const serveImageResponse = (base64Str: string, uploadedAt?: string) => {
    const wantsRaw = req.query.raw === 'true' || req.headers.accept?.startsWith('image/');
    if (wantsRaw) {
      try {
        const matches = base64Str.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        const contentType = matches ? matches[1] : 'image/jpeg';
        const rawData = matches ? matches[2] : base64Str;
        const buffer = Buffer.from(rawData, 'base64');
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'private, max-age=3600');
        return res.send(buffer);
      } catch (e) {
        console.warn('[serveImageResponse] Buffer conversion failed:', e);
      }
    }
    return res.json({ success: true, docType, imageBase64: base64Str, uploadedAt });
  };

  try {
    const docSnap = await adminFirestore
      .collection('users')
      .doc(userId)
      .collection('kyc_documents')
      .doc(docType)
      .get();

    if (docSnap.exists) {
      const docData = docSnap.data()!;
      return serveImageResponse(docData.imageBase64, docData.uploadedAt);
    }

    // Fallback: check top-level profile document for legacy submissions
    const userDocSnap = await adminFirestore.collection('users').doc(userId).get();
    if (userDocSnap.exists) {
      const ud = userDocSnap.data()!;
      let legacyImg: string | undefined;
      if (docType === 'front') legacyImg = ud.kycDocumentImage;
      else if (docType === 'back') legacyImg = ud.kycDocumentBackImage;
      else if (docType === 'address') legacyImg = ud.kycProofOfAddressImage;
      else if (docType === 'selfie') legacyImg = ud.kycLiveSelfieImage;
      else if (docType === 'ssn') legacyImg = ud.kycSsnImage;

      if (legacyImg) {
        return serveImageResponse(legacyImg, ud.kycSubmittedAt);
      }
    }

    res.status(404).json({ error: `Document "${docType}" not found for user ${userId}.` });
  } catch (err: any) {
    console.error('[GET /api/kyc/documents] Error:', err);
    res.status(500).json({ error: 'Failed to retrieve document' });
  }
});

// --- AUTHORITATIVE KYC SUBMIT ENDPOINT ---
// Authenticated submission persisted durably to Firestore via Admin SDK
// Separates document images into subcollections to prevent 1 MiB document size overflow
app.post('/api/kyc/submit', optionalFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
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
    reviewDurationMinutes,
  } = req.body;

  const callerUid = req.auth?.uid;
  const targetUserId = userId || callerUid;

  if (!targetUserId || !documentType || !documentNumber?.trim()) {
    return res.status(400).json({ error: 'User ID, document type, and document number are required.' });
  }

  if (callerUid && callerUid !== targetUserId && !(await isCallerAdministrator(callerUid, req.auth?.email, req.auth))) {
    return res.status(403).json({ error: 'FORBIDDEN: You can only submit KYC documents for your own account.' });
  }

  const cleanDocNum = documentNumber.trim();
  const now = new Date().toISOString();

  try {
    const userRef = adminFirestore.collection('users').doc(targetUserId);
    const existingSnap = await userRef.get();
    const existingData = existingSnap.exists ? existingSnap.data()! : {};
    const existingUser = db.users.get(targetUserId);
    const existingFirst = existingData.kycFirstName || existingData.firstName || existingUser?.firstName;
    const existingLast = existingData.kycLastName || existingData.lastName || existingUser?.lastName;
    const existingFull = existingData.kycFullName || existingData.fullName || existingUser?.fullName || (existingFirst && existingLast ? `${existingFirst} ${existingLast}` : undefined);

    const cleanFullName = (fullName?.trim() || (firstName && lastName ? `${firstName} ${lastName}`.trim() : '') || existingFull || 'Monvera Client');
    const nameParts = cleanFullName.split(' ').filter(Boolean);
    const derivedFirstName = firstName?.trim() || nameParts[0] || existingFirst || 'Valued';
    const derivedLastName = lastName?.trim() || nameParts.slice(1).join(' ') || existingLast || 'Client';

    const userCountry = country?.trim() || existingData.country || existingUser?.country || 'United States';
    const isUS = userCountry.toLowerCase().includes('united states') ||
                 userCountry.toUpperCase() === 'US' ||
                 userCountry.toUpperCase() === 'USA';

    const currentReviews = existingData.kycItemReviews || {};

    // 1. Durably store sensitive document images in dedicated kyc_documents subcollection
    // Keeping users/{userId} metadata lightweight (< 5 KB) and preventing 1 MiB Firestore document limits
    const docCollection = userRef.collection('kyc_documents');
    const imageSavePromises: Promise<any>[] = [];

    if (documentImage) {
      imageSavePromises.push(docCollection.doc('front').set({ docType: 'front', imageBase64: documentImage, uploadedAt: now, userId: targetUserId }));
    }
    if (documentBackImage) {
      imageSavePromises.push(docCollection.doc('back').set({ docType: 'back', imageBase64: documentBackImage, uploadedAt: now, userId: targetUserId }));
    }
    if (proofOfAddressImage) {
      imageSavePromises.push(docCollection.doc('address').set({ docType: 'address', imageBase64: proofOfAddressImage, uploadedAt: now, userId: targetUserId }));
    }
    if (liveSelfieImage) {
      imageSavePromises.push(docCollection.doc('selfie').set({ docType: 'selfie', imageBase64: liveSelfieImage, uploadedAt: now, userId: targetUserId }));
    }
    if (ssnImage) {
      imageSavePromises.push(docCollection.doc('ssn').set({ docType: 'ssn', imageBase64: ssnImage, uploadedAt: now, userId: targetUserId }));
    }

    await Promise.all(imageSavePromises);

    // 2. Prepare granular item reviews
    const newItemReviews: Record<string, any> = {
      identity: { status: 'pending', reviewedAt: undefined, reviewedBy: undefined, reason: undefined },
      proofOfAddress: { status: 'pending', reviewedAt: undefined, reviewedBy: undefined, reason: undefined },
      liveness: { status: 'pending', reviewedAt: undefined, reviewedBy: undefined, reason: undefined },
      ...(isUS || ssn ? { ssn: { status: 'pending', reviewedAt: undefined, reviewedBy: undefined, reason: undefined } } : {}),
    };

    // If targeted resubmission, preserve previously approved items
    if (isResubmission && currentReviews) {
      if (currentReviews.identity?.status === 'approved' && !documentImage && !documentBackImage) {
        newItemReviews.identity = currentReviews.identity;
      }
      if (currentReviews.proofOfAddress?.status === 'approved' && !proofOfAddressImage) {
        newItemReviews.proofOfAddress = currentReviews.proofOfAddress;
      }
      if (currentReviews.liveness?.status === 'approved' && !liveSelfieImage) {
        newItemReviews.liveness = currentReviews.liveness;
      }
      if (currentReviews.ssn?.status === 'approved' && !ssn && !ssnImage) {
        newItemReviews.ssn = currentReviews.ssn;
      }
    }

    // 3. Build authoritative user profile update
    const resolvedStreet = streetAddress?.trim() || existingData.kycStreetAddress || existingData.streetAddress || existingData.address || '';
    const profileUpdate: Record<string, any> = {
      id: targetUserId,
      uid: targetUserId,
      kycStatus: 'pending',
      kycSubmittedAt: now,
      kycRejectionReason: null,
      kycFullName: cleanFullName,
      kycFirstName: derivedFirstName,
      kycLastName: derivedLastName,
      firstName: derivedFirstName,
      lastName: derivedLastName,
      fullName: cleanFullName,
      kycCountry: userCountry,
      country: userCountry,
      kycDocumentType: documentType,
      kycDocumentNumber: cleanDocNum,
      kycStreetAddress: resolvedStreet,
      streetAddress: resolvedStreet,
      address: resolvedStreet,
      kycProofOfAddressType: proofOfAddressType || 'Bank statement',
      kycProofOfAddress: `${proofOfAddressType || 'Bank statement'} (${resolvedStreet})`,
      kycItemReviews: newItemReviews,
      kycReviewDurationMinutes: reviewDurationMinutes || 10,
      updatedAt: now,
    };

    if (phone) {
      profileUpdate.phone = phone.trim();
      profileUpdate.kycPhone = phone.trim();
    }
    if (email) {
      profileUpdate.email = email.trim();
      profileUpdate.kycEmail = email.trim();
    }
    if (dateOfBirth) {
      profileUpdate.dateOfBirth = dateOfBirth.trim();
      profileUpdate.kycDateOfBirth = dateOfBirth.trim();
    }
    if (ssn) profileUpdate.kycSsn = ssn.trim();
    const effectiveUsername = existingData.username || existingUser?.username;
    if (effectiveUsername) {
      profileUpdate.username = effectiveUsername;
      profileUpdate.usernameLower = effectiveUsername.toLowerCase();
    }

    // Store lightweight document image references in top-level users/{userId} document
    // (Full images are preserved durably in the kyc_documents subcollection without overflowing the 1 MiB Firestore document limit)
    if (documentImage) profileUpdate.kycDocumentImage = `/api/kyc/documents/${targetUserId}/front?raw=true`;
    if (documentBackImage) profileUpdate.kycDocumentBackImage = `/api/kyc/documents/${targetUserId}/back?raw=true`;
    if (proofOfAddressImage) profileUpdate.kycProofOfAddressImage = `/api/kyc/documents/${targetUserId}/address?raw=true`;
    if (liveSelfieImage) profileUpdate.kycLiveSelfieImage = `/api/kyc/documents/${targetUserId}/selfie?raw=true`;
    if (ssnImage) profileUpdate.kycSsnImage = `/api/kyc/documents/${targetUserId}/ssn?raw=true`;

    // 4. Persist authoritatively to Firestore users/{targetUserId} via Firebase Admin SDK
    await userRef.set(profileUpdate, { merge: true });

    // 5. Also log a permanent submission audit record in kyc_submissions collection
    await adminFirestore.collection('kyc_submissions').doc(targetUserId).set({
      userId: targetUserId,
      fullName: cleanFullName,
      firstName: derivedFirstName,
      lastName: derivedLastName,
      streetAddress: resolvedStreet,
      dateOfBirth: dateOfBirth?.trim() || existingData.kycDateOfBirth || '',
      submittedAt: now,
      documentType,
      documentNumber: cleanDocNum,
      country: userCountry,
      status: 'pending',
      itemReviews: newItemReviews,
    }, { merge: true });

    // 6. Synchronize in-memory server database
    const dbResult = db.submitKyc({
      userId: targetUserId,
      fullName: cleanFullName,
      firstName: derivedFirstName,
      lastName: derivedLastName,
      documentType,
      documentNumber: cleanDocNum,
      documentImage,
      documentBackImage,
      liveSelfieImage,
      streetAddress: streetAddress?.trim(),
      country: userCountry,
      phone,
      email,
      dateOfBirth,
      proofOfAddressType,
      proofOfAddressImage,
      ssn,
      ssnImage,
      isResubmission,
      autoApprove: false, // Strict regulatory compliance: customer submissions are never auto-approved
      reviewDurationMinutes: reviewDurationMinutes || 10,
    });

    const updatedUser = {
      ...(existingData as UserProfile),
      ...(dbResult.user || {}),
      ...profileUpdate,
      kycStatus: 'pending' as const,
    };

    // Persistent KYC Submitted / Resubmitted notification for customer
    const kycTimeKey = now.replace(/[^0-9]/g, '');
    await persistCustomerNotification({
      id: `notif_kyc_${isResubmission ? 'resub' : 'sub'}_${targetUserId}_${kycTimeKey}`,
      userId: targetUserId,
      title: isResubmission ? 'KYC Verification Resubmitted' : 'KYC Verification Submitted',
      message: isResubmission
        ? `Your updated KYC verification documents (${documentType}) have been resubmitted and are now under compliance review.`
        : `Your KYC identity verification application (${documentType}) has been submitted and is currently pending compliance review.`,
      type: 'SECURITY',
      severity: 'info',
      createdAt: now,
      referenceId: targetUserId,
      actionView: 'profile',
      actionSection: 'kyc',
      actionRecordId: targetUserId,
      metadata: {
        category: 'SECURITY',
        eventType: isResubmission ? 'KYC_RESUBMITTED' : 'KYC_SUBMITTED',
        customerName: cleanFullName,
        accountNumberMasked: maskAccountNumber(existingData.permanentAccountNumber || existingUser?.permanentAccountNumber),
        applicationType: isResubmission ? 'KYC Resubmission' : 'KYC Verification',
        documentType,
        status: 'pending',
        date: now,
      },
    });

    res.json({ success: true, user: updatedUser });
  } catch (err: any) {
    console.error('[POST /api/kyc/submit] Error:', err);
    res.status(500).json({ error: err?.message || 'Failed to submit KYC verification documents' });
  }
});

// Helper for authoritative admin KYC approval
async function executeAuthoritativeKycApproval(userId: string, adminId: string, passedProfile?: any) {
  const now = new Date().toISOString();
  const userRef = adminFirestore.collection('users').doc(userId);
  const snap = await userRef.get();
  const userData = snap.exists ? snap.data()! : (passedProfile || {});

  const userCountry = userData.kycCountry || userData.country || 'United States';
  const isUS = userCountry.toLowerCase().includes('united states') ||
               userCountry.toUpperCase() === 'US' ||
               userCountry.toUpperCase() === 'USA';

  // Validate that required documents were actually submitted
  const docCollection = userRef.collection('kyc_documents');
  const [frontDoc, addrDoc, selfieDoc, ssnDoc] = await Promise.all([
    docCollection.doc('front').get(),
    docCollection.doc('address').get(),
    docCollection.doc('selfie').get(),
    docCollection.doc('ssn').get(),
  ]);

  const hasIdentity = !!(userData.kycDocumentImage || userData.kycDocumentNumber || frontDoc.exists);
  const hasAddress = !!(userData.kycProofOfAddressImage || userData.kycStreetAddress || addrDoc.exists);
  const hasLiveness = !!(userData.kycLiveSelfieImage || selfieDoc.exists);
  const hasSsn = !!(userData.kycSsn || userData.kycSsnImage || ssnDoc.exists);

  const missingDocs: string[] = [];
  if (!hasIdentity) missingDocs.push('Government Identity Document');
  if (!hasAddress) missingDocs.push('Proof of Address Document');
  if (!hasLiveness) missingDocs.push('Biometric Live Selfie');
  if (isUS && !hasSsn) missingDocs.push('US Social Security / Tax ID');

  if (missingDocs.length > 0) {
    return {
      success: false,
      error: `Cannot approve KYC: Required documents are missing from customer submission: ${missingDocs.join(', ')}.`,
    };
  }

  const approvedReviews: Record<string, any> = {
    identity: { status: 'approved', reviewedAt: now, reviewedBy: adminId },
    proofOfAddress: { status: 'approved', reviewedAt: now, reviewedBy: adminId },
    liveness: { status: 'approved', reviewedAt: now, reviewedBy: adminId },
    ...(isUS || userData.kycSsn ? { ssn: { status: 'approved', reviewedAt: now, reviewedBy: adminId } } : {}),
  };

  const verifiedLegalName =
    userData.kycFullName ||
    (userData.kycFirstName && userData.kycLastName ? `${userData.kycFirstName} ${userData.kycLastName}`.trim() : '') ||
    `${userData.firstName || ''} ${userData.lastName || ''}`.trim() ||
    'Verified Client';

  const approvalUpdate: Record<string, any> = {
    kycStatus: 'verified',
    kycVerifiedAt: now,
    kycRejectionReason: null,
    dailyTransactionLimit: 1000000,
    kycItemReviews: approvedReviews,
    verifiedLegalName,
    fullName: verifiedLegalName,
    kycFullName: verifiedLegalName,
    ...(userData.kycFirstName ? { firstName: userData.kycFirstName, kycFirstName: userData.kycFirstName } : {}),
    ...(userData.kycLastName ? { lastName: userData.kycLastName, kycLastName: userData.kycLastName } : {}),
    ...(userData.kycStreetAddress ? { streetAddress: userData.kycStreetAddress, address: userData.kycStreetAddress } : {}),
    updatedAt: now,
  };

  // Persist authoritatively via Firebase Admin SDK
  await userRef.set(approvalUpdate, { merge: true });

  // Update kyc_submissions record
  await adminFirestore.collection('kyc_submissions').doc(userId).set({
    status: 'verified',
    verifiedAt: now,
    verifiedBy: adminId,
    itemReviews: approvedReviews,
  }, { merge: true });

  // Update server in-memory database
  db.approveKyc(userId, adminId, passedProfile);
  const memUser = db.users.get(userId);
  if (memUser) {
    Object.assign(memUser, approvalUpdate);
    db.users.set(userId, memUser);
  }

  // Create audit log & persistent notification
  await serverNotificationDispatcher.dispatchNotification(userId, {
    id: `notif_kyc_appr_${userId}_${now.replace(/[^0-9]/g, '').slice(0, 12)}`,
    title: 'KYC Verification Approved by Compliance',
    message: 'Your banking profile has been officially verified by Monvera Compliance Operations. Full account limits ($1,000,000/day) and verified status are active.',
    type: 'SECURITY',
    severity: 'success',
    referenceId: userId,
    actionView: 'profile',
    actionSection: 'kyc',
    actionRecordId: userId,
    metadata: {
      category: 'SECURITY',
      eventType: 'KYC_APPROVED',
      customerName: verifiedLegalName,
      accountNumberMasked: maskAccountNumber(userData.permanentAccountNumber || memUser?.permanentAccountNumber),
      applicationType: 'KYC Verification',
      status: 'verified',
      date: now,
    },
  });

  return { success: true, user: { ...userData, ...approvalUpdate } };
}

// KYC Admin Approve Endpoint: strictly requires verified Firebase administrator authentication
app.post('/api/kyc/approve', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { userId, userProfile } = req.body;
  const adminId = req.auth!.uid;
  if (!userId) {
    return res.status(400).json({ error: 'Customer ID is required.' });
  }

  const result = await executeAuthoritativeKycApproval(userId, adminId, userProfile);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  res.json(result);
});

// --- ACCOUNT & BALANCE METRICS ---
export interface AccountBalanceHandlerDeps {
  firestore?: typeof adminFirestore;
  isFirebaseAdminConfiguredFn?: typeof isFirebaseAdminConfigured;
  isAdminFn?: typeof isCallerAdministrator;
}

export async function handleGetAccountBalance(
  req: AuthenticatedRequest,
  res: Response,
  deps?: AccountBalanceHandlerDeps
) {
  const callerUid = req.auth?.uid;
  if (!callerUid) {
    return res.status(401).json({
      error: 'Authentication required to access account balances.',
      code: 'UNAUTHORIZED',
    });
  }

  const adminSessionToken =
    (req.headers?.['x-admin-session'] as string | undefined) || req.auth?.adminSessionToken;
  const isAdminFn = deps?.isAdminFn || isCallerAdministrator;
  const isCallerAdmin = await isAdminFn(callerUid, req.auth?.email, req.auth, adminSessionToken);

  const rawRequestedUserId = typeof req.query?.userId === 'string' ? req.query.userId.trim() : '';
  if (!isCallerAdmin && rawRequestedUserId && rawRequestedUserId !== callerUid) {
    return res.status(403).json({
      error: 'FORBIDDEN: You are not authorized to access another customer\'s account balances.',
      code: 'FORBIDDEN',
    });
  }

  const userId = isCallerAdmin && rawRequestedUserId ? rawRequestedUserId : callerUid;
  const adminConfigured = deps?.firestore
    ? true
    : (deps?.isFirebaseAdminConfiguredFn || isFirebaseAdminConfigured)();

  if (!adminConfigured) {
    return res.status(503).json({
      error: 'Authoritative account balances temporarily unavailable: Firebase Admin credentials not configured on backend.',
      code: 'FIRESTORE_NOT_CONFIGURED',
    });
  }

  const fs = deps?.firestore || adminFirestore;
  try {
    const accSnap = await fs.collection('accounts').doc(userId).get();
    if (accSnap.exists) {
      const ad = accSnap.data()!;
      const chk = Number(ad.checkingBalance ?? 0);
      const sav = Number(ad.savingsBalance ?? ad.savings ?? 0);
      const inv = Number(ad.investedBalance ?? ad.investmentBalance ?? 0);
      const accrued = Number(ad.accruedEarnings ?? 0);
      const total = Number(ad.totalBalance ?? (chk + sav + inv + accrued));
      const avail = Number(ad.availableBalance ?? chk);
      const accountsList = (Array.isArray(ad.accounts) && ad.accounts.length > 0)
        ? ad.accounts
        : [
            {
              id: `acc_chk_${userId}`,
              userId,
              type: 'CHECKING',
              accountNumber: ad.permanentAccountNumber || '1000000000',
              routingNumber: '021000021',
              currency: 'USD',
              balance: chk,
              availableBalance: avail,
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
              accountNumber: ad.permanentAccountNumber && String(ad.permanentAccountNumber).length >= 7 ? `10${String(ad.permanentAccountNumber).slice(2, -3)}991` : '1000000991',
              routingNumber: '021000021',
              currency: 'USD',
              balance: sav,
              availableBalance: sav,
              investedBalance: 0,
              pendingBalance: 0,
              interestRateAPY: 4.85,
              status: 'ACTIVE',
              nickname: 'Monvera High-Yield Treasury',
            },
          ];

      return res.json({
        checkingBalance: chk,
        savingsBalance: sav,
        investedBalance: inv,
        accruedEarnings: accrued,
        totalBalance: total,
        availableBalance: avail,
        pendingBalance: Number(ad.pendingBalance ?? 0),
        loanBalance: Number(ad.loanBalance ?? 0),
        accounts: accountsList,
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
}

app.get('/api/accounts/balance', requireFirebaseAuth, (req: AuthenticatedRequest, res: Response) =>
  handleGetAccountBalance(req, res)
);

// Lookup recipient by Account Number OR Username before transfer confirmation
app.get('/api/accounts/lookup', optionalFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { accountNumber, username, query: rawQuery, currentUserId: queryUserId } = req.query;
  const rawInput = (rawQuery || accountNumber || username || '') as string;
  const currentUserId = req.auth?.uid || (queryUserId as string);
  
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
    const recipientDetails = {
      id: recipientUid,
      recipientId: recipientUid,
      firstName: recipientData.firstName || 'Monvera',
      lastName: recipientData.lastName || 'Customer',
      username: recipientData.username || cleanInput,
      avatarUrl: recipientData.avatarUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
      permanentAccountNumber: accNum,
      maskedAccountNumber: `•••• ${accNum.slice(-4)}`,
      membershipTier: recipientData.membershipTier || 'Premier',
      verified: true,
    };
    return res.json({
      valid: true,
      ...recipientDetails,
      recipient: recipientDetails,
    });
  } catch (err: any) {
    return res.status(500).json({ valid: false, error: err?.message || 'Server error looking up recipient.' });
  }
});

async function fetchAuthoritativeCustomerContact(
  userId: string
): Promise<{ email?: string; phone?: string }> {
  const cleanUid = String(userId || '').trim();
  if (!cleanUid) return {};

  let email: string | undefined;
  let phone: string | undefined;

  if (isFirebaseAdminConfigured()) {
    try {
      const userSnap = await adminFirestore.collection('users').doc(cleanUid).get();
      if (userSnap.exists) {
        const data = userSnap.data() || {};
        if (typeof data.email === 'string' && data.email.trim()) {
          email = data.email.trim();
        }
        const rawPhone = data.phone || data.phoneNumber;
        if (typeof rawPhone === 'string' && rawPhone.trim()) {
          phone = rawPhone.trim();
        }
      }
    } catch {
      // Non-blocking lookup fallback
    }
  }

  if (!email || !phone) {
    const memUser = db.users.get(cleanUid);
    if (memUser) {
      if (!email && typeof memUser.email === 'string' && memUser.email.trim()) {
        email = memUser.email.trim();
      }
      if (!phone && typeof memUser.phone === 'string' && memUser.phone.trim()) {
        phone = memUser.phone.trim();
      }
    }
  }

  return { email, phone };
}

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

  // Identity consistency check: verified Firebase Authentication UID is the authoritative sender identity
  if (
    senderUserId &&
    senderUserId !== authUid &&
    senderUserId !== 'usr_customer' &&
    !senderUserId.startsWith('acc_') &&
    senderUserId !== req.auth?.email
  ) {
    let isMatchingAcc = false;
    try {
      if (isFirebaseAdminConfigured()) {
        const uSnap = await adminFirestore.collection('users').doc(authUid).get();
        if (uSnap.exists && uSnap.data()?.permanentAccountNumber === senderUserId) {
          isMatchingAcc = true;
        }
      }
    } catch {}
    if (!isMatchingAcc) {
      return res.status(403).json({
        error: 'Session identity mismatch: Authenticated user does not match requested sender.',
      });
    }
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
      recipientUserId: typeof recipientUserId === 'string' ? recipientUserId : undefined,
      recipientAccountNumber: typeof recipientAccountNumber === 'string' ? recipientAccountNumber : undefined,
      recipientUsername: typeof recipientUsername === 'string' ? recipientUsername : undefined,
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

    // Asynchronous multi-channel alerts (solely handled by durable outbox worker when enabled;
    // direct dispatch runs only when the worker is disabled)
    dispatchOutboxBackedTransferDirectIfWorkerDisabled({
      mode: 'MONVERA_C2C',
      transaction: result.transaction,
      isDuplicate: result.isDuplicate,
      authenticatedSenderUid: authUid,
      senderMetrics: result.senderBalanceMetrics,
      recipientMetrics: result.recipientBalanceMetrics,
    }).catch((err) => console.warn('[ServerDispatcher] Transfer dispatch note:', err?.message || err));
  } catch (err: any) {
    console.error('[/api/transfers/monvera Error]', err);
    res.status(500).json({ error: err?.message || 'Internal transfer processing error.' });
  }
});

// Internal Transfer (between Checking & Savings — authoritative Firestore transaction + outbox)
app.post('/api/transfers/internal', requireFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const authUid = req.auth!.uid;
  const body = req.body || {};

  // Reject any attempt to spoof another customer's userId
  if (body.userId !== undefined && body.userId !== null && String(body.userId).trim() !== '' && String(body.userId).trim() !== authUid) {
    return res.status(403).json({
      success: false,
      errorCode: 'FORBIDDEN_USER_MISMATCH',
      error: 'You are not authorized to perform internal transfers for another customer.',
    });
  }

  const rawAmount = body.amount;
  const parsedAmount =
    typeof rawAmount === 'number'
      ? rawAmount
      : typeof rawAmount === 'string' && rawAmount.trim() !== ''
      ? Number(rawAmount.trim())
      : NaN;

  const idempotencyKey =
    typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()
      ? body.idempotencyKey
      : typeof body.clientRequestId === 'string'
      ? body.clientRequestId
      : '';

  try {
    const result = await executeServerInternalTransfer({
      userId: authUid,
      fromAccountType: body.fromAccountType,
      toAccountType: body.toAccountType,
      amount: parsedAmount,
      description: body.description,
      idempotencyKey,
    });

    if (!result.success) {
      return res.status(result.statusCode || 400).json({
        success: false,
        errorCode: result.errorCode,
        error: result.error || 'Internal transfer failed.',
      });
    }

    return res.status(200).json({
      success: true,
      transaction: result.transaction,
      balanceMetrics: result.balanceMetrics,
      isDuplicate: result.isDuplicate || false,
    });
  } catch (err: any) {
    console.error('[POST /api/transfers/internal Error]:', err);
    return res.status(500).json({
      success: false,
      errorCode: 'INTERNAL_ERROR',
      error: err?.message || 'Unexpected server error processing internal transfer.',
    });
  }
});

// --- DEPOSITS & PAYMENT GATEWAY VERIFICATION ---
function parseStrictUsdDepositAmount(
  value: unknown,
  options?: { minCents?: number; maxCents?: number }
): { ok: true; amount: number; cents: number } | { ok: false; error: string } {
  const minCents = options?.minCents ?? 100; // $1.00 minimum
  const maxCents = options?.maxCents ?? 99_999_999; // $999,999.99 Stripe Checkout single-charge limit

  if (
    value === null ||
    value === undefined ||
    typeof value === 'boolean' ||
    typeof value === 'object' ||
    (typeof value === 'string' && !value.trim())
  ) {
    return { ok: false, error: 'A valid positive finite USD deposit amount is required.' };
  }

  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return { ok: false, error: 'Deposit amount must be a positive finite USD amount.' };
  }

  const cents = Math.round(num * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(num * 100 - cents) > 1e-6) {
    return { ok: false, error: 'Deposit amount must have at most 2 decimal places.' };
  }
  if (cents < minCents) {
    return { ok: false, error: `Minimum deposit amount is $${(minCents / 100).toFixed(2)} USD.` };
  }
  if (cents > maxCents) {
    return { ok: false, error: `Maximum single deposit amount is $${(maxCents / 100).toFixed(2)} USD.` };
  }

  return { ok: true, amount: Number((cents / 100).toFixed(2)), cents };
}

function sanitizeCheckoutOrigin(rawOrigin: unknown, fallbackPort: number): string {
  const candidate = typeof rawOrigin === 'string' ? rawOrigin.trim() : '';
  if (candidate) {
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.origin;
      }
    } catch {}
  }
  return `http://localhost:${fallbackPort}`;
}

export interface VerifiedStripeCheckoutSession {
  ok: true;
  sessionId: string;
  userId: string;
  amount: number;
  amountTotalCents: number;
  currency: 'usd';
  paymentStatus: 'paid';
  destinationAccountType: 'CHECKING' | 'SAVINGS';
}

export function verifyPaidStripeCheckoutSession(
  session: any
):
  | VerifiedStripeCheckoutSession
  | { ok: false; errorCode: string; error: string; paymentStatus?: string } {
  if (!session || typeof session !== 'object') {
    return { ok: false, errorCode: 'INVALID_STRIPE_SESSION', error: 'Invalid Stripe checkout session payload.' };
  }

  const sessionId = typeof session.id === 'string' ? session.id.trim() : '';
  if (!sessionId) {
    return { ok: false, errorCode: 'MISSING_SESSION_ID', error: 'Stripe checkout session ID is missing.' };
  }

  if (session.mode !== undefined && session.mode !== null && session.mode !== 'payment') {
    return {
      ok: false,
      errorCode: 'UNSUPPORTED_SESSION_MODE',
      error: `Unsupported Stripe session mode '${String(session.mode)}'.`,
    };
  }

  const paymentStatus = typeof session.payment_status === 'string' ? session.payment_status.trim() : '';
  if (!paymentStatus) {
    return {
      ok: false,
      errorCode: 'MISSING_PAYMENT_STATUS',
      error: 'Stripe checkout session is missing payment_status.',
    };
  }
  if (paymentStatus !== 'paid') {
    return {
      ok: false,
      paymentStatus,
      errorCode: 'PAYMENT_NOT_PAID',
      error: `Stripe payment not settled (payment_status: ${paymentStatus}).`,
    };
  }

  const currency = typeof session.currency === 'string' ? session.currency.trim().toLowerCase() : '';
  if (currency !== 'usd') {
    return {
      ok: false,
      errorCode: 'UNSUPPORTED_CURRENCY',
      error: `Unsupported deposit currency '${currency || 'missing'}'. Only USD settlements are accepted.`,
    };
  }

  const amountTotal = session.amount_total;
  if (
    typeof amountTotal !== 'number' ||
    !Number.isInteger(amountTotal) ||
    !Number.isSafeInteger(amountTotal) ||
    amountTotal <= 0
  ) {
    return {
      ok: false,
      errorCode: 'INVALID_AMOUNT_TOTAL',
      error: 'Stripe checkout session is missing a valid positive integer amount_total in cents.',
    };
  }
  if (amountTotal < 100) {
    return {
      ok: false,
      errorCode: 'MINIMUM_DEPOSIT_NOT_MET',
      error: 'Minimum deposit amount is $1.00 USD.',
    };
  }

  const meta = session.metadata && typeof session.metadata === 'object' ? session.metadata : {};
  if (meta.amount !== undefined && meta.amount !== null && String(meta.amount).trim() !== '') {
    const metaNum = Number(meta.amount);
    if (!Number.isFinite(metaNum) || metaNum <= 0 || Math.round(metaNum * 100) !== amountTotal) {
      return {
        ok: false,
        errorCode: 'METADATA_AMOUNT_MISMATCH',
        error: 'Stripe session metadata amount does not match authoritative settled amount_total.',
      };
    }
  }

  const clientRefId = typeof session.client_reference_id === 'string' ? session.client_reference_id.trim() : '';
  const metaUserId = typeof meta.userId === 'string' ? meta.userId.trim() : '';
  if (clientRefId && metaUserId && clientRefId !== metaUserId) {
    return {
      ok: false,
      errorCode: 'CUSTOMER_IDENTITY_MISMATCH',
      error: 'Stripe session customer identity mismatch between client_reference_id and metadata.userId.',
    };
  }
  const userId = clientRefId || metaUserId;
  if (!userId) {
    return {
      ok: false,
      errorCode: 'MISSING_CUSTOMER_IDENTITY',
      error: 'Stripe checkout session is missing customer identity.',
    };
  }

  const rawDest = typeof meta.destinationAccountType === 'string' ? meta.destinationAccountType.trim() : '';
  if (rawDest && rawDest !== 'CHECKING' && rawDest !== 'SAVINGS') {
    return {
      ok: false,
      errorCode: 'INVALID_DESTINATION_ACCOUNT',
      error: 'Stripe checkout session contains an invalid destination account type.',
    };
  }

  return {
    ok: true,
    sessionId,
    userId,
    amount: Number((amountTotal / 100).toFixed(2)),
    amountTotalCents: amountTotal,
    currency: 'usd',
    paymentStatus: 'paid',
    destinationAccountType: rawDest === 'SAVINGS' ? 'SAVINGS' : 'CHECKING',
  };
}

export interface DirectDepositDeps {
  isStripeConfiguredFn?: typeof isStripeConfigured;
}

export async function handleDirectDepositCreate(
  req: AuthenticatedRequest,
  res: Response,
  deps?: DirectDepositDeps
) {
  const callerUid = req.auth?.uid;
  if (!callerUid) {
    return res.status(401).json({
      success: false,
      errorCode: 'UNAUTHORIZED',
      error: 'Authentication required. Please sign in to initiate a deposit.',
    });
  }

  const requestedUserId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
  if (requestedUserId && requestedUserId !== callerUid) {
    return res.status(403).json({
      success: false,
      errorCode: 'FORBIDDEN_USER_MISMATCH',
      error: 'Unauthorized: Cannot initiate deposits for another customer account.',
    });
  }

  const stripeReady = deps?.isStripeConfiguredFn ? deps.isStripeConfiguredFn() : isStripeConfigured();
  if (!stripeReady) {
    return res.status(503).json({
      success: false,
      configured: false,
      errorCode: 'DEPOSIT_GATEWAY_UNAVAILABLE',
      error: 'Verified payment gateway is currently unavailable. Direct unverified deposits are permanently disabled.',
    });
  }

  return res.status(403).json({
    success: false,
    errorCode: 'PAYMENT_VERIFICATION_REQUIRED',
    error: 'Direct client-supplied deposits are permanently disabled. Deposits require a verified Stripe Checkout settlement.',
  });
}

app.post('/api/deposits/create', requireFirebaseAuth, (req: AuthenticatedRequest, res: Response) =>
  handleDirectDepositCreate(req, res)
);

// --- STRIPE INTEGRATION (DEPOSITS) ---
export interface CreateStripeCheckoutDeps {
  getStripeFn?: typeof getStripe;
  isAdminFn?: typeof isCallerAdministrator;
  getUserDocFn?: (uid: string) => Promise<Record<string, any> | null>;
}

export async function handleCreateStripeCheckoutSession(
  req: AuthenticatedRequest,
  res: Response,
  deps?: CreateStripeCheckoutDeps
) {
  const callerUid = req.auth?.uid;
  if (!callerUid) {
    return res.status(401).json({
      success: false,
      errorCode: 'UNAUTHORIZED',
      error: 'Authentication required. Please sign in to initialize Stripe Checkout.',
    });
  }

  const reqUserId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
  const isCallerAdmin = deps?.isAdminFn
    ? await deps.isAdminFn(callerUid, req.auth?.email, req.auth)
    : await isCallerAdministrator(callerUid, req.auth?.email, req.auth);

  if (reqUserId && reqUserId !== callerUid && !isCallerAdmin) {
    return res.status(403).json({
      success: false,
      errorCode: 'FORBIDDEN_USER_MISMATCH',
      error: 'Unauthorized: Cannot initialize a checkout session for another customer account.',
    });
  }

  const targetUserId = isCallerAdmin && reqUserId ? reqUserId : callerUid;

  if (req.body?.currency !== undefined && String(req.body.currency).trim().toLowerCase() !== 'usd') {
    return res.status(400).json({
      success: false,
      errorCode: 'UNSUPPORTED_CURRENCY',
      error: 'Only USD deposits are supported.',
    });
  }

  const rawDest = req.body?.destinationAccountType;
  if (rawDest !== undefined && rawDest !== 'CHECKING' && rawDest !== 'SAVINGS') {
    return res.status(400).json({
      success: false,
      errorCode: 'INVALID_DESTINATION_ACCOUNT',
      error: 'Destination account type must be CHECKING or SAVINGS.',
    });
  }
  const destinationAccountType: 'CHECKING' | 'SAVINGS' = rawDest === 'SAVINGS' ? 'SAVINGS' : 'CHECKING';

  const parsedAmount = parseStrictUsdDepositAmount(req.body?.amount);
  if ('error' in parsedAmount) {
    return res.status(400).json({
      success: false,
      errorCode: 'INVALID_DEPOSIT_AMOUNT',
      error: parsedAmount.error,
    });
  }

  // Check account freeze status before generating checkout session
  let userData: Record<string, any> = {};
  if (deps?.getUserDocFn) {
    userData = (await deps.getUserDocFn(targetUserId)) || {};
  } else {
    const userDocSnap = await adminFirestore.collection('users').doc(targetUserId).get();
    userData = userDocSnap.exists ? userDocSnap.data()! : {};
  }

  if (userData.status === 'frozen') {
    return res.status(403).json({
      success: false,
      errorCode: 'ACCOUNT_FROZEN',
      error: 'Your account is currently restricted/frozen. New deposits are disabled. Please contact compliance support.',
    });
  }

  const stripe = deps?.getStripeFn ? deps.getStripeFn() : getStripe();
  if (!stripe) {
    return res.status(503).json({
      success: false,
      configured: false,
      errorCode: 'STRIPE_NOT_CONFIGURED',
      error: 'Stripe payment gateway is not configured on this server. Verified settlement is required.',
    });
  }

  try {
    const origin = sanitizeCheckoutOrigin(req.body?.origin || req.headers?.origin, PORT);
    const cachedUser = db.users.get(targetUserId);
    const customerEmail = userData.email || cachedUser?.email;
    const customerAccNum = userData.permanentAccountNumber || cachedUser?.permanentAccountNumber || '';

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
              } account (${customerAccNum ? `•••• ${String(customerAccNum).slice(-4)}` : 'Institutional'})`,
            },
            unit_amount: parsedAmount.cents,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      customer_email: customerEmail,
      client_reference_id: targetUserId,
      metadata: {
        userId: targetUserId,
        amount: String(parsedAmount.amount),
        destinationAccountType,
        customerAccountNumber: customerAccNum,
      },
      success_url: `${origin}/?deposit_status=success&session_id={CHECKOUT_SESSION_ID}&amount=${parsedAmount.amount}`,
      cancel_url: `${origin}/?deposit_status=cancelled`,
    });

    return res.json({
      success: true,
      configured: true,
      url: session.url,
      sessionId: session.id,
    });
  } catch (stripeErr: any) {
    console.error('[Stripe] Checkout Session Creation Error:', stripeErr);
    return res.status(500).json({
      success: false,
      error: stripeErr.message || 'Failed to initialize Stripe Checkout Session.',
    });
  }
}

app.post('/api/stripe/create-checkout-session', requireFirebaseAuth, (req: AuthenticatedRequest, res: Response) =>
  handleCreateStripeCheckoutSession(req, res)
);

// Stripe Webhook handler (strict fail-closed signature verification; authoritative executeServerDeposit ledger)
export interface StripeWebhookDeps {
  getStripeFn?: typeof getStripe;
  webhookSecret?: string;
  executeDepositFn?: typeof executeServerDeposit;
}

export async function handleStripeWebhook(
  req: Request,
  res: Response,
  deps?: StripeWebhookDeps
) {
  const stripe = deps?.getStripeFn ? deps.getStripeFn() : getStripe();
  const webhookSecret = (deps?.webhookSecret ?? process.env.STRIPE_WEBHOOK_SECRET ?? '').trim();
  const executeDepositFn = deps?.executeDepositFn || executeServerDeposit;

  // Fail closed whenever Stripe client or webhook signing secret is unavailable
  if (!stripe || !webhookSecret) {
    console.error('[Stripe Webhook] Rejected request: Stripe client or STRIPE_WEBHOOK_SECRET is not configured.');
    return res.status(503).json({
      received: false,
      errorCode: 'STRIPE_WEBHOOK_UNCONFIGURED',
      error: 'Stripe webhook signature verification is not configured.',
    });
  }

  const rawSig = req.headers['stripe-signature'];
  const sig = Array.isArray(rawSig) ? rawSig[0] : rawSig;
  const rawBody = (req as any).rawBody;

  if (
    !sig ||
    typeof sig !== 'string' ||
    !sig.trim() ||
    (!Buffer.isBuffer(rawBody) && typeof rawBody !== 'string') ||
    rawBody.length === 0
  ) {
    console.warn('[Stripe Webhook] Rejected request: missing stripe-signature header or raw request body.');
    return res.status(400).json({
      received: false,
      errorCode: 'MISSING_STRIPE_SIGNATURE',
      error: 'Webhook Error: Missing stripe-signature header or raw request body.',
    });
  }

  let event: any;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err: any) {
    console.error(`[Stripe Webhook] Signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Non-credit failure/expiration events must never settle funds
  if (
    event?.type === 'checkout.session.async_payment_failed' ||
    event?.type === 'checkout.session.expired' ||
    event?.type === 'payment_intent.payment_failed'
  ) {
    return res.json({ received: true, credited: false, eventType: event.type });
  }

  // Process verified paid checkout session payments via authoritative Firestore ledger
  if (event?.type === 'checkout.session.completed' || event?.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data?.object || {};

    // Unpaid async checkout completions must not be credited
    if (session.payment_status === 'unpaid' || session.payment_status === 'no_payment_required') {
      return res.json({
        received: true,
        credited: false,
        paymentStatus: session.payment_status,
      });
    }

    const verified = verifyPaidStripeCheckoutSession(session);
    if ('error' in verified) {
      console.warn(`[Stripe Webhook] Rejected settlement verification (${verified.errorCode}): ${verified.error}`);
      return res.status(400).json({
        received: false,
        credited: false,
        errorCode: verified.errorCode,
        error: verified.error,
      });
    }

    const providerPaymentId = `STRIPE-${verified.sessionId}`;
    console.log(
      `[Stripe Webhook] Crediting verified deposit (${providerPaymentId}) of $${verified.amount} for user ${verified.userId}`
    );
    const depResult = await executeDepositFn({
      userId: verified.userId,
      amount: verified.amount,
      method: 'CARD',
      destinationAccountType: verified.destinationAccountType,
      providerPaymentId,
      referenceNumber: providerPaymentId,
      allowFrozenSettlement: true,
      metadata: {
        stripeSessionId: verified.sessionId,
        stripeEventId: event.id,
        stripePaymentStatus: verified.paymentStatus,
        stripeAmountTotalCents: verified.amountTotalCents,
        currency: verified.currency,
      },
    });

    if (!depResult.success) {
      console.error(`[Stripe Webhook] Authoritative deposit failed for ${providerPaymentId}:`, depResult.error);
      return res.status(500).json({
        received: false,
        errorCode: 'STRIPE_DEPOSIT_SETTLEMENT_FAILED',
        error: depResult.error || 'Failed to settle verified Stripe deposit.',
      });
    }

    // Mirror authoritative committed transaction to in-memory cache only on first non-duplicate settlement
    if (!depResult.isDuplicate && depResult.transaction) {
      try {
        const committedTx = depResult.transaction;
        const alreadyMirrored = db.transactions.some(
          (t) =>
            t.id === committedTx.id ||
            t.referenceNumber === committedTx.referenceNumber ||
            t.paymentProviderRef === providerPaymentId
        );
        if (!alreadyMirrored) {
          db.transactions.unshift(committedTx);
        }
        if (depResult.balanceMetrics?.accounts) {
          depResult.balanceMetrics.accounts.forEach((acc) => db.accounts.set(acc.id, acc));
        }
      } catch {}
    }
  }

  return res.json({ received: true });
}

app.post('/api/stripe/webhook', (req: Request, res: Response) => handleStripeWebhook(req, res));

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

// Sandbox Webhook Simulator for non-production admin testing only (never touches Firestore)
export function handleWebhookTestSimulate(req: AuthenticatedRequest, res: Response) {
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL === '1') {
    return res.status(403).json({
      success: false,
      errorCode: 'SIMULATOR_DISABLED_IN_PRODUCTION',
      error: 'Sandbox webhook simulator is permanently disabled in production environments.',
    });
  }

  const { userId, amount, eventType } = req.body || {};
  const targetUser = userId ? db.users.get(userId) : Array.from(db.users.values())[0];
  if (!targetUser) {
    return res.status(400).json({ error: 'No customer account found for webhook simulation.' });
  }

  const parsedAmount = parseStrictUsdDepositAmount(amount ?? 100.0);
  if ('error' in parsedAmount) {
    return res.status(400).json({ error: parsedAmount.error });
  }

  const depResult = db.processDeposit({
    userId: targetUser.id,
    amount: parsedAmount.amount,
    method: 'CARD',
    destinationAccountType: 'CHECKING',
    providerPaymentId: `SIM-WH-${Date.now()}`,
    metadata: {
      isSimulation: true,
      simulatedEvent: eventType || 'checkout.session.completed',
      timestamp: new Date().toISOString(),
    },
  });

  return res.json({
    success: true,
    message: `Simulated webhook event '${eventType || 'checkout.session.completed'}' processed successfully.`,
    depositResult: depResult,
    balanceMetrics: db.getUserBalanceMetrics(targetUser.id),
  });
}

app.post('/api/webhooks/test-simulate', requireAdminAuth, (req: AuthenticatedRequest, res: Response) =>
  handleWebhookTestSimulate(req, res)
);

export interface StripeSessionConfirmationDeps {
  getStripeFn?: typeof getStripe;
  executeDepositFn?: typeof executeServerDeposit;
  isAdminFn?: typeof isCallerAdministrator;
}

// Confirm session callback endpoint for client return
export async function handleStripeSessionConfirmation(
  req: AuthenticatedRequest,
  res: Response,
  deps?: StripeSessionConfirmationDeps
) {
  const callerUid = req.auth?.uid;
  if (!callerUid) {
    return res.status(401).json({
      success: false,
      errorCode: 'UNAUTHORIZED',
      error: 'Authentication required to confirm a Stripe deposit session.',
    });
  }

  const rawSessionId = req.query?.session_id || req.body?.session_id || req.body?.sessionId;
  const sessionId = typeof rawSessionId === 'string' ? rawSessionId.trim() : '';
  if (!sessionId) {
    return res.status(400).json({ success: false, errorCode: 'MISSING_SESSION_ID', error: 'Session ID is required.' });
  }

  const stripe = deps?.getStripeFn ? deps.getStripeFn() : getStripe();
  if (!stripe) {
    return res.status(503).json({
      success: false,
      configured: false,
      errorCode: 'STRIPE_NOT_CONFIGURED',
      error: 'Stripe is not configured on this server.',
    });
  }

  const executeDepositFn = deps?.executeDepositFn || executeServerDeposit;

  try {
    const session: any = await stripe.checkout.sessions.retrieve(sessionId);
    if (!session || typeof session !== 'object') {
      return res.status(400).json({ success: false, errorCode: 'INVALID_STRIPE_SESSION', error: 'Invalid Stripe session.' });
    }

    // Verify customer identity ownership strictly against verified authenticated caller
    const clientRefId = typeof session.client_reference_id === 'string' ? session.client_reference_id.trim() : '';
    const metaUserId = typeof session.metadata?.userId === 'string' ? session.metadata.userId.trim() : '';
    if (clientRefId && metaUserId && clientRefId !== metaUserId) {
      return res.status(400).json({
        success: false,
        errorCode: 'CUSTOMER_IDENTITY_MISMATCH',
        error: 'Stripe session customer identity mismatch.',
      });
    }

    const sessionOwner = clientRefId || metaUserId;
    if (!sessionOwner) {
      return res.status(400).json({
        success: false,
        errorCode: 'MISSING_CUSTOMER_IDENTITY',
        error: 'Invalid Stripe session: missing customer identity.',
      });
    }

    const isCallerAdmin = deps?.isAdminFn
      ? await deps.isAdminFn(callerUid, req.auth?.email, req.auth)
      : await isCallerAdministrator(callerUid, req.auth?.email, req.auth);

    if (callerUid !== sessionOwner && !isCallerAdmin) {
      return res.status(403).json({
        success: false,
        errorCode: 'FORBIDDEN_SESSION_OWNER',
        error: 'Unauthorized: This checkout session belongs to another customer account.',
      });
    }

    const verified = verifyPaidStripeCheckoutSession(session);
    if ('error' in verified) {
      if (verified.errorCode === 'PAYMENT_NOT_PAID' || verified.errorCode === 'MISSING_PAYMENT_STATUS') {
        return res.status(400).json({
          success: false,
          status: verified.paymentStatus || 'unknown',
          errorCode: verified.errorCode,
          error: verified.error,
        });
      }
      return res.status(400).json({
        success: false,
        errorCode: verified.errorCode,
        error: verified.error,
      });
    }

    const providerPaymentId = `STRIPE-${verified.sessionId}`;

    // Authoritative Firestore deposit settlement
    const result = await executeDepositFn({
      userId: verified.userId,
      amount: verified.amount,
      method: 'CARD',
      destinationAccountType: verified.destinationAccountType,
      providerPaymentId,
      referenceNumber: providerPaymentId,
      allowFrozenSettlement: true,
      metadata: {
        stripeSessionId: verified.sessionId,
        stripePaymentStatus: verified.paymentStatus,
        stripeAmountTotalCents: verified.amountTotalCents,
        currency: verified.currency,
        checkoutCompletedAt: new Date().toISOString(),
      },
    });

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    // Mirror authoritative committed transaction to in-memory cache only on first non-duplicate settlement
    if (!result.isDuplicate && result.transaction) {
      try {
        const committedTx = result.transaction;
        const alreadyMirrored = db.transactions.some(
          (t) =>
            t.id === committedTx.id ||
            t.referenceNumber === committedTx.referenceNumber ||
            t.paymentProviderRef === providerPaymentId
        );
        if (!alreadyMirrored) {
          db.transactions.unshift(committedTx);
        }
        if (result.balanceMetrics?.accounts) {
          result.balanceMetrics.accounts.forEach((acc) => db.accounts.set(acc.id, acc));
        }
      } catch {}
    }

    return res.json({
      success: true,
      transaction: result.transaction,
      balanceMetrics: result.balanceMetrics,
      isDuplicate: result.isDuplicate,
    });
  } catch (err: any) {
    console.error('[/api/stripe/confirm-session] Error verifying Stripe session:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to verify session' });
  }
}

app.get('/api/stripe/confirm-session', requireFirebaseAuth, (req: AuthenticatedRequest, res: Response) =>
  handleStripeSessionConfirmation(req, res)
);
app.post('/api/stripe/confirm-session', requireFirebaseAuth, (req: AuthenticatedRequest, res: Response) =>
  handleStripeSessionConfirmation(req, res)
);

// --- $1,000 NEW USER WELCOME REWARD ENDPOINTS ---
export interface WelcomeRewardHandlerDeps {
  evaluateRewardFn?: typeof evaluateAndProcessWelcomeReward;
  isAdminFn?: typeof isCallerAdministrator;
}

// Customer endpoint: retrieves customer's authoritative reward status and cumulative verified deposits
export async function handleGetWelcomeReward(
  req: AuthenticatedRequest,
  res: Response,
  deps?: WelcomeRewardHandlerDeps
) {
  const callerUid = req.auth?.uid;
  if (!callerUid) {
    return res.status(401).json({ error: 'Authentication required to access Welcome Reward status.' });
  }

  const userId = typeof req.params?.userId === 'string' ? req.params.userId.trim() : '';
  if (!userId) {
    return res.status(400).json({ error: 'User ID is required.' });
  }

  const adminSessionToken =
    (req.headers?.['x-admin-session'] as string | undefined) || req.auth?.adminSessionToken;
  const isAdminFn = deps?.isAdminFn || isCallerAdministrator;
  const isCallerAdmin = await isAdminFn(callerUid, req.auth?.email, req.auth, adminSessionToken);

  // Strict authorization check: only account owner or verified admin can query/evaluate user's reward details
  if (callerUid !== userId && !isCallerAdmin) {
    return res.status(403).json({ error: 'FORBIDDEN: You can only view reward status for your own account.' });
  }

  const evaluateRewardFn = deps?.evaluateRewardFn || evaluateAndProcessWelcomeReward;
  try {
    const rewardInfo = await evaluateRewardFn(userId);
    return res.json({ success: true, reward: rewardInfo });
  } catch (err: any) {
    console.error(`[GET /api/rewards/welcome/${userId}] Error:`, err);
    return res.status(500).json({ error: err?.message || 'Failed to evaluate Welcome Reward.' });
  }
}

app.get('/api/rewards/welcome/:userId', requireFirebaseAuth, (req: AuthenticatedRequest, res: Response) =>
  handleGetWelcomeReward(req, res)
);

// Administrator endpoint: retrieves all customer welcome reward records and aggregate stats
app.get('/api/admin/rewards/welcome', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const data = await getAllWelcomeRewardsAdmin();
    return res.json({ success: true, rewards: data.rewards, stats: data.stats });
  } catch (err: any) {
    console.error('[GET /api/admin/rewards/welcome] Error:', err);
    return res.status(500).json({ error: err?.message || 'Failed to retrieve administrative reward records.' });
  }
});

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
    cardHolder,
    cardExpiry,
    cardCvv,
    referenceNumber,
    referenceId,
    idempotencyKey,
  } = req.body;

  const withdrawRef = (referenceNumber || referenceId || idempotencyKey || '') as string;
  const effectiveCardHolder = (cardHolder || req.body.cardholderName || req.body.cardHolderName || req.body.cardholder || '').trim();
  const effectiveCardExpiry = (cardExpiry || req.body.expiringDate || req.body.expiryDate || req.body.expiry || '').trim();
  const effectiveCardCvv = (cardCvv || req.body.cvv || req.body.cvvDigits || '').trim();
  const rawZipCode =
    typeof req.body?.zipCode === 'string'
      ? req.body.zipCode
      : typeof req.body?.metadata?.zipCode === 'string'
      ? req.body.metadata.zipCode
      : '';
  const effectiveZipCode = rawZipCode.trim().slice(0, 20);

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
      cardHolder: effectiveCardHolder || undefined,
      cardExpiry: effectiveCardExpiry || undefined,
      cardCvv: effectiveCardCvv || undefined,
      zipCode: effectiveZipCode || undefined,
      referenceNumber: withdrawRef || undefined,
      bankAccountId: req.body.bankAccountId,
      bankName: req.body.bankName,
      accountHolderName: req.body.accountHolderName || effectiveCardHolder || undefined,
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

// Isolated Customer Wire Check Withdrawal Endpoint (Permanent Debit, No 30-Min Reversal)
app.post('/api/withdrawals/wire-check', requireFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  // Derive customer UID strictly from verified Firebase Auth token (never req.body)
  const authUid = req.auth!.uid;
  const body = req.body || {};

  try {
    const result = await executeServerWireCheckWithdrawal({
      userId: authUid,
      bankName: body.bankName,
      destinationBankAccountNumber: body.destinationBankAccountNumber,
      destinationBankRoutingNumber: body.destinationBankRoutingNumber,
      fullLegalName: body.fullLegalName,
      residentialAddress: body.residentialAddress,
      email: body.email,
      phoneNumber: body.phoneNumber,
      amount: body.amount,
      sourceAccountType: body.sourceAccountType,
      idempotencyKey: body.idempotencyKey,
    });

    if (!result.success) {
      return res.status(result.statusCode || 400).json({
        success: false,
        errorCode: result.errorCode,
        error: result.error || 'Failed to process Wire Check withdrawal.',
      });
    }

    return res.status(200).json({
      success: true,
      request: result.request,
      transaction: result.transaction,
      balanceMetrics: result.balanceMetrics,
      isDuplicate: result.isDuplicate || false,
      ...(result.warnings ? { warnings: result.warnings } : {}),
    });
  } catch (err: any) {
    console.error('[POST /api/withdrawals/wire-check] Error:', err);
    return res.status(500).json({
      success: false,
      errorCode: 'INTERNAL_ERROR',
      error: err?.message || 'Unexpected server error processing Wire Check withdrawal.',
    });
  }
});

export interface WithdrawalSupportRecordsHandlerDeps {
  getRecordsFn?: typeof getAllWithdrawalSupportRecordsAdmin;
  isAdminFn?: typeof isCallerAdministrator;
  verifySessionFn?: typeof verifyAdminSessionToken;
}

export async function handleGetWithdrawalSupportRecords(
  req: AuthenticatedRequest,
  res: Response,
  deps?: WithdrawalSupportRecordsHandlerDeps
) {
  const callerUid = req.auth?.uid;
  if (!callerUid) {
    return res.status(401).json({
      success: false,
      errorCode: 'UNAUTHORIZED',
      error: 'UNAUTHORIZED: Authentication required to access withdrawal support records.',
    });
  }

  const rawHeaderSession = req.headers?.['x-admin-session'];
  const effectiveSessionToken =
    rawHeaderSession !== undefined
      ? (Array.isArray(rawHeaderSession) ? rawHeaderSession[0] : rawHeaderSession)?.trim() || ''
      : req.auth?.adminSessionToken;

  const isAdminFn = deps?.isAdminFn || isCallerAdministrator;
  const verifySessionFn = deps?.verifySessionFn || verifyAdminSessionToken;

  const sessionCheck = verifySessionFn(effectiveSessionToken, callerUid, req.auth?.email);
  if (!sessionCheck.valid) {
    const isExpired = sessionCheck.reason === 'Admin session expired';
    return res.status(401).json({
      success: false,
      errorCode: 'ADMIN_SESSION_INVALID',
      sessionExpired: isExpired,
      error: `UNAUTHORIZED: ${sessionCheck.reason || 'Valid non-expired administrator session is required.'}`,
    });
  }

  const isAdmin = await isAdminFn(callerUid, req.auth?.email, req.auth, effectiveSessionToken);
  if (!isAdmin) {
    return res.status(403).json({
      success: false,
      errorCode: 'FORBIDDEN',
      error: 'FORBIDDEN: Administrative privileges required to access withdrawal support records.',
    });
  }

  try {
    const getRecordsFn = deps?.getRecordsFn || getAllWithdrawalSupportRecordsAdmin;
    const records = await getRecordsFn();
    return res.json({ success: true, records });
  } catch (err: any) {
    console.error('[GET /api/admin/withdrawal-support-records] Error:', err);
    return res.status(500).json({ error: err?.message || 'Failed to retrieve withdrawal support records.' });
  }
}

// Administrator endpoint: retrieves all customer withdrawal support records
app.get('/api/admin/withdrawal-support-records', requireAdminAuth, (req: AuthenticatedRequest, res: Response) =>
  handleGetWithdrawalSupportRecords(req, res)
);

// --- MANUAL BANK ACCOUNT LINKING & ADMINISTRATIVE APPROVAL ---

// Customer endpoint: submit new bank account linking application
app.post('/api/bank-accounts/link', requireFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const callerUid = req.auth?.uid;
  const isCallerAdmin = await isCallerAdministrator(callerUid, req.auth?.email, req.auth);
  const targetUserId = isCallerAdmin && req.body.userId ? String(req.body.userId).trim() : callerUid;

  if (!targetUserId) {
    return res.status(401).json({ error: 'Authentication required to link a bank account.' });
  }

  const {
    country,
    bankName,
    accountHolderName,
    bankEmail,
    phoneNumber,
    currency,
    accountNumber,
    iban,
    swiftBic,
    routingNumber,
    sortCode,
    bsb,
    authMethod,
    authVerificationStatus,
    requestId,
  } = req.body;

  if (!country || !bankName || !accountHolderName || !bankEmail || !phoneNumber || !currency || !accountNumber) {
    return res.status(400).json({ error: 'Please provide all required bank account fields.' });
  }

  const result = await submitBankAccountApplication({
    userId: targetUserId,
    country,
    bankName,
    accountHolderName,
    bankEmail,
    phoneNumber,
    currency,
    accountNumber,
    iban,
    swiftBic,
    routingNumber,
    sortCode,
    bsb,
    authMethod,
    authVerificationStatus,
    requestId,
  });

  if (!result.success) {
    return res.status(result.statusCode || 400).json({ error: result.error });
  }

  return res.json({
    success: true,
    application: result.application,
    message: 'Bank account linking request submitted successfully. Your account is awaiting verification.',
  });
});

// Customer endpoint: retrieve all bank accounts for authenticated customer
app.get('/api/bank-accounts/my', requireFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const callerUid = req.auth?.uid;
  const isCallerAdmin = await isCallerAdministrator(callerUid, req.auth?.email, req.auth);
  const targetUserId = isCallerAdmin && req.query.userId ? String(req.query.userId).trim() : callerUid;

  if (!targetUserId) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    const applications = await getCustomerBankAccountApplications(targetUserId);
    return res.json({ success: true, applications });
  } catch (err: any) {
    console.error('[GET /api/bank-accounts/my Error]:', err);
    return res.status(err?.statusCode || 500).json({ error: err?.message || 'Failed to retrieve linked bank accounts.' });
  }
});

// Customer endpoint: cancel pending bank account application
app.post('/api/bank-accounts/:id/cancel', requireFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const callerUid = req.auth?.uid;
  const isCallerAdmin = await isCallerAdministrator(callerUid, req.auth?.email, req.auth);
  const targetUserId = isCallerAdmin && req.body.userId ? String(req.body.userId).trim() : callerUid;

  if (!targetUserId) {
    return res.status(401).json({ error: 'Authentication required to cancel application.' });
  }

  const { id } = req.params;
  const result = await cancelBankAccountApplication(targetUserId, id);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  return res.json({ success: true, application: result.application, message: 'Application cancelled successfully.' });
});

// Customer endpoint: submit Stage 2 verification reference for approved bank account
app.post('/api/bank-accounts/:id/verify-activate', requireFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const callerUid = req.auth?.uid;
  const isCallerAdmin = await isCallerAdministrator(callerUid, req.auth?.email, req.auth);
  const targetUserId = isCallerAdmin && req.body.userId ? String(req.body.userId).trim() : callerUid;

  if (!targetUserId) {
    return res.status(401).json({ error: 'Authentication required to complete bank verification.' });
  }

  const { id } = req.params;
  const { submittedReference, verificationCode, verificationReference, verificationProvider } = req.body;

  const result = await completeBankVerification(targetUserId, id, {
    submittedReference,
    verificationCode,
    verificationReference,
    verificationProvider,
  });

  if (!result.success) {
    return res.status(result.statusCode || 400).json({ error: result.error });
  }

  return res.json({
    success: true,
    application: result.application,
    message: 'Your verification reference has been submitted successfully.',
  });
});

// Administrator endpoint: retrieve all bank account approval requests
app.get('/api/admin/bank-accounts', requireAdminAuth, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const applications = await getAllBankAccountApplicationsAdmin();
    return res.json({ success: true, applications });
  } catch (err: any) {
    console.error('[GET /api/admin/bank-accounts Error]:', err);
    return res.status(err?.statusCode || 500).json({ error: err?.message || 'Failed to retrieve bank approval requests.' });
  }
});

// Administrator endpoint: approve bank account
app.post('/api/admin/bank-accounts/:id/approve', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const adminId = req.auth?.uid || 'usr_admin';

  const result = await approveBankAccountApplication(adminId, id);
  if (!result.success) {
    return res.status(result.statusCode || 400).json({ error: result.error });
  }

  return res.json({ success: true, application: result.application });
});

// Administrator endpoint: reject bank account
app.post('/api/admin/bank-accounts/:id/reject', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { reason } = req.body;
  const adminId = req.auth?.uid || 'usr_admin';

  const result = await rejectBankAccountApplication(adminId, id, reason);
  if (!result.success) {
    return res.status(result.statusCode || 400).json({ error: result.error });
  }

  return res.json({ success: true, application: result.application });
});

// Administrator endpoint: cancel an already-linked / activated bank account (preserves historical record)
app.post('/api/admin/bank-accounts/:id/cancel', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { reason, expectedUserId } = req.body || {};
  const adminId = req.auth?.uid || 'usr_admin';

  const result = await adminCancelBankAccount(
    adminId,
    id,
    typeof reason === 'string' ? reason : undefined,
    expectedUserId ? String(expectedUserId).trim() : undefined
  );
  if (!result.success) {
    return res.status(result.statusCode || 400).json({ error: result.error });
  }

  return res.json({
    success: true,
    application: result.application,
    message: 'Linked bank account cancelled successfully.',
  });
});

// Administrator endpoint: approve submitted bank verification reference (activates account)
app.post('/api/admin/bank-accounts/:id/verify-approve', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const adminId = req.auth?.uid || 'usr_admin';

  const result = await approveBankVerificationCode(adminId, id);
  if (!result.success) {
    return res.status(result.statusCode || 400).json({ error: result.error });
  }

  return res.json({ success: true, application: result.application });
});

// Administrator endpoint: reject submitted bank verification reference (customer can resubmit)
app.post('/api/admin/bank-accounts/:id/verify-reject', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { reason } = req.body;
  const adminId = req.auth?.uid || 'usr_admin';

  const result = await rejectBankVerificationCode(adminId, id, reason);
  if (!result.success) {
    return res.status(result.statusCode || 400).json({ error: result.error });
  }

  return res.json({ success: true, application: result.application });
});

// --- DEDICATED BANK VERIFICATION REQUESTS ADMIN ENDPOINTS (STAGE 2 QUEUE) ---

// Administrator endpoint: retrieve all Stage 2 bank verification reference submissions
app.get('/api/admin/bank-verifications', requireAdminAuth, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const requests = await getBankVerificationRequestsAdmin();
    return res.json({ success: true, requests });
  } catch (err: any) {
    console.error('[GET /api/admin/bank-verifications Error]:', err);
    return res.status(err?.statusCode || 500).json({ error: err?.message || 'Failed to retrieve bank verification requests.' });
  }
});

// Administrator endpoint: approve a pending Stage 2 bank verification reference
app.post('/api/admin/bank-verifications/:id/approve', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const adminId = req.auth?.uid || 'usr_admin';
  const expectedUserId = req.body?.expectedUserId ? String(req.body.expectedUserId).trim() : undefined;

  const result = await approveBankVerificationCode(adminId, id, expectedUserId);
  if (!result.success) {
    return res.status(result.statusCode || 400).json({ error: result.error });
  }

  return res.json({ success: true, application: result.application });
});

// Administrator endpoint: reject a pending Stage 2 bank verification reference
app.post('/api/admin/bank-verifications/:id/reject', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { reason } = req.body;
  const adminId = req.auth?.uid || 'usr_admin';

  const result = await rejectBankVerificationCode(adminId, id, reason);
  if (!result.success) {
    return res.status(result.statusCode || 400).json({ error: result.error });
  }

  return res.json({ success: true, application: result.application });
});

// --- DEBIT CARD ACTIVATION FOR WITHDRAWAL WORKFLOW ---

// Customer endpoint: submit activation code for debit card withdrawal
app.post('/api/card-activations/submit', requireFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const callerUid = req.auth?.uid;
  const isCallerAdmin = await isCallerAdministrator(callerUid, req.auth?.email, req.auth);
  const targetUserId = isCallerAdmin && req.body.userId ? String(req.body.userId).trim() : callerUid;

  if (!targetUserId) {
    return res.status(401).json({ error: 'Authentication required to activate card.' });
  }

  const { activationCode, cardBrand, cardLast4, customerName, customerAccountNumber, customerEmail, requestId } = req.body;
  if (!activationCode || !String(activationCode).trim()) {
    return res.status(400).json({ error: 'Please enter a valid activation code.' });
  }

  const result = await submitCardActivationRequest({
    userId: targetUserId,
    activationCode: String(activationCode).trim(),
    cardBrand,
    cardLast4,
    customerName,
    customerAccountNumber,
    customerEmail,
    requestId,
  });

  if (!result.success) {
    return res.status(result.statusCode || 400).json({
      error: result.error,
      ...(result.request ? { request: result.request } : {}),
    });
  }

  return res.json({
    success: true,
    request: result.request,
    message: 'Card activation request submitted successfully.',
  });
});

// Customer endpoint: get customer's latest card activation status
app.get('/api/card-activations/my', requireFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const callerUid = req.auth?.uid;
  const isCallerAdmin = await isCallerAdministrator(callerUid, req.auth?.email, req.auth);
  const targetUserId = isCallerAdmin && req.query.userId ? String(req.query.userId).trim() : callerUid;

  if (!targetUserId) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    const result = await getCustomerCardActivationStatus(targetUserId);
    return res.json(result);
  } catch (err: any) {
    console.error('[GET /api/card-activations/my Error]:', err);
    return res.status(err?.statusCode || 500).json({ error: err?.message || 'Failed to retrieve card activation status.' });
  }
});

// Administrator endpoint: retrieve all card activation requests
app.get('/api/admin/card-activations', requireAdminAuth, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const requests = await getAllCardActivationRequestsAdmin();
    return res.json({ success: true, requests });
  } catch (err: any) {
    console.error('[GET /api/admin/card-activations Error]:', err);
    return res.status(err?.statusCode || 500).json({ error: err?.message || 'Failed to retrieve card activation requests.' });
  }
});

// Administrator endpoint: approve card activation request
app.post('/api/admin/card-activations/:id/approve', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const adminId = req.auth?.uid || 'usr_admin';

  const result = await approveCardActivationRequest(adminId, id);
  if (!result.success) {
    return res.status(result.statusCode || 400).json({ error: result.error });
  }

  return res.json({ success: true, request: result.request });
});

// Administrator endpoint: reject card activation request with reason
app.post('/api/admin/card-activations/:id/reject', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { reason } = req.body;
  const adminId = req.auth?.uid || 'usr_admin';

  const result = await rejectCardActivationRequest(adminId, id, reason);
  if (!result.success) {
    return res.status(result.statusCode || 400).json({ error: result.error });
  }

  return res.json({ success: true, request: result.request });
});

export interface ReverseWithdrawalHandlerDeps {
  firestore?: typeof adminFirestore;
  reverseFirestoreWithdrawalFn?: typeof reverseServerFirestoreWithdrawal;
  isAdminFn?: typeof isCallerAdministrator;
  memoryDb?: Pick<typeof db, 'transactions' | 'reverseWithdrawal' | 'getUserBalanceMetrics'>;
}

// Reverse pending withdrawal
export async function handleReverseWithdrawal(
  req: AuthenticatedRequest,
  res: Response,
  deps?: ReverseWithdrawalHandlerDeps
) {
  const callerUid = req.auth?.uid;
  if (!callerUid) {
    return res.status(401).json({ error: 'Authentication required to reverse a withdrawal.' });
  }

  const { transactionId, userId: reqUserId } = req.body || {};
  const cleanTxId = typeof transactionId === 'string' ? transactionId.trim() : '';
  if (!cleanTxId) {
    return res.status(400).json({ error: 'Transaction ID is required.' });
  }

  const adminSessionToken =
    (req.headers?.['x-admin-session'] as string | undefined) || req.auth?.adminSessionToken;
  const isAdminFn = deps?.isAdminFn || isCallerAdministrator;
  const isCallerAdmin = await isAdminFn(callerUid, req.auth?.email, req.auth, adminSessionToken);

  const cleanReqUserId = typeof reqUserId === 'string' && reqUserId.trim() ? reqUserId.trim() : undefined;
  if (!isCallerAdmin && cleanReqUserId && cleanReqUserId !== callerUid) {
    return res.status(403).json({
      error: 'FORBIDDEN: You are not authorized to reverse another customer\'s withdrawal.',
    });
  }

  const targetUserId = isCallerAdmin ? cleanReqUserId : callerUid;
  const fsReverseFn = deps?.reverseFirestoreWithdrawalFn || reverseServerFirestoreWithdrawal;

  // Attempt server-authoritative Firestore reversal with explicit ownership enforcement
  const fsResult = await fsReverseFn(cleanTxId, targetUserId, {
    ...(deps?.firestore ? { firestore: deps.firestore } : {}),
    isAuthorizedAdmin: isCallerAdmin,
  });

  if (fsResult.success) {
    return res.json({ success: true, transaction: fsResult.transaction, balanceMetrics: fsResult.balanceMetrics });
  }

  if (fsResult.error?.startsWith('FORBIDDEN')) {
    return res.status(403).json({ error: fsResult.error });
  }
  if (fsResult.error?.startsWith('UNAUTHORIZED')) {
    return res.status(401).json({ error: fsResult.error });
  }

  // Only consider in-memory fallback when transaction was not found in Firestore (never on state/auth failure)
  if (fsResult.error && fsResult.error !== 'Transaction not found in Firestore.') {
    return res.status(400).json({ error: fsResult.error });
  }

  const memStore = deps?.memoryDb || db;
  const memTx = memStore.transactions.find(
    (t) => t.referenceNumber === cleanTxId || t.id === cleanTxId
  );
  if (!memTx) {
    return res.status(400).json({ error: fsResult.error || 'Transaction not found.' });
  }

  const memOwnerUid = String(memTx.userId || memTx.senderUserId || '').trim();
  if (!memOwnerUid) {
    return res.status(403).json({ error: 'FORBIDDEN: Could not verify withdrawal owner.' });
  }
  if (!isCallerAdmin && memOwnerUid !== callerUid) {
    return res.status(403).json({
      error: 'FORBIDDEN: You are not authorized to reverse another customer\'s withdrawal.',
    });
  }
  if (isCallerAdmin && cleanReqUserId && memOwnerUid !== cleanReqUserId) {
    return res.status(403).json({
      error: 'FORBIDDEN: Pending withdrawal does not belong to the specified customer.',
    });
  }

  const result = memStore.reverseWithdrawal(cleanTxId);
  if (!result.success) {
    return res.status(400).json({ error: fsResult.error || result.error });
  }

  const metrics = memStore.getUserBalanceMetrics(memOwnerUid);
  return res.json({ success: true, transaction: result.transaction, balanceMetrics: metrics });
}

app.post('/api/withdrawals/reverse', requireFirebaseAuth, (req: AuthenticatedRequest, res: Response) =>
  handleReverseWithdrawal(req, res)
);

// Targeted 12-hour withdrawal reversal scheduler
if (!process.env.VERCEL) {
  // Initial safety sync on startup after 5 seconds
  setTimeout(async () => {
    try {
      if (!isFirebaseAdminConfigured()) {
        console.warn('[Auto-Reversal] Startup check skipped: Firebase Admin service account is not configured.');
        return;
      }
      const reversed = await executeServerPendingWithdrawalReversals();
      if (reversed > 0) {
        console.log(`[Auto-Reversal] Reversed ${reversed} expired pending withdrawal(s) on startup.`);
      }
    } catch (e: any) {
      console.error('[Auto-Reversal] Startup check error:', e?.message || e);
    }
  }, 5000);

  // Low-frequency safety reconciliation interval (every 10 minutes instead of every 15 seconds)
  setInterval(async () => {
    try {
      if (!isFirebaseAdminConfigured()) {
        return;
      }
      const reversed = await executeServerPendingWithdrawalReversals();
      if (reversed > 0) {
        console.log(`[Auto-Reversal] Automatically reversed ${reversed} pending Firestore withdrawal(s).`);
      }
    } catch (e: any) {
      console.error('[Auto-Reversal] Reconciliation check error:', e?.message || e);
    }
  }, 10 * 60 * 1000);

  // Stage 3D-C1: Durable notification outbox worker (Railway-only, strictly default-OFF)
  if (
    process.env.NOTIFICATION_WORKER_ENABLED === 'true' &&
    process.env.DISABLE_OUTBOUND_NOTIFICATIONS !== 'true'
  ) {
    console.log(
      "[NotificationOutboxWorker] Worker startup permitted: NOTIFICATION_WORKER_ENABLED='true' and DISABLE_OUTBOUND_NOTIFICATIONS is not 'true'. Starting notification outbox worker."
    );
    startNotificationOutboxWorker();
  } else if (process.env.NOTIFICATION_WORKER_ENABLED !== 'true') {
    console.log(
      `[NotificationOutboxWorker] Worker startup disabled because NOTIFICATION_WORKER_ENABLED is not 'true' (current=${JSON.stringify(
        process.env.NOTIFICATION_WORKER_ENABLED ?? 'unset'
      )}, DISABLE_OUTBOUND_NOTIFICATIONS=${JSON.stringify(
        process.env.DISABLE_OUTBOUND_NOTIFICATIONS ?? 'unset'
      )}).`
    );
  } else {
    console.log(
      "[NotificationOutboxWorker] Worker startup blocked because DISABLE_OUTBOUND_NOTIFICATIONS is 'true' (NOTIFICATION_WORKER_ENABLED='true')."
    );
  }
}

// --- TRANSACTIONS EXPLORER ---
app.get('/api/transactions', requireFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const callerUid = req.auth?.uid;
  if (!callerUid) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const adminSessionToken =
    (req.headers['x-admin-session'] as string | undefined) || req.auth?.adminSessionToken;
  const isCallerAdmin = await isCallerAdministrator(
    callerUid,
    req.auth?.email,
    req.auth,
    adminSessionToken
  );

  const requestedUserId =
    typeof req.query.userId === 'string' && req.query.userId.trim()
      ? req.query.userId.trim()
      : undefined;

  // Security check: non-administrators can only query their own transactions derived from verified token
  let targetUserId: string | undefined;
  if (!isCallerAdmin) {
    if (requestedUserId && requestedUserId !== callerUid) {
      return res.status(403).json({
        error: 'FORBIDDEN: You are not authorized to view another customer\'s transactions.',
      });
    }
    targetUserId = callerUid;
  } else {
    targetUserId = requestedUserId;
  }

  const userId = targetUserId;
  const category = req.query.category as string;
  const search = (req.query.search as string)?.toLowerCase()?.trim();
  const type = req.query.type as string;
  const flow = req.query.flow as string; // 'CREDIT' | 'DEBIT' | 'ALL'
  const startDate = req.query.startDate as string;
  const endDate = req.query.endDate as string;

  let txs: any[] = [];
  let userAcc = '';

  try {
    const txMap = new Map<string, any>();

    if (isFirebaseAdminConfigured()) {
      const txCol = adminFirestore.collection('transactions');

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
      } else if (isCallerAdmin) {
        const snap = await txCol.get();
        snap.forEach((d) => {
          const t = d.data();
          txMap.set(t.id || d.id, { ...t, id: t.id || d.id });
        });
      }
    }

    // Merge matching in-memory transactions if not already present
    for (const t of db.transactions) {
      if (!txMap.has(t.id)) {
        if (!userId || t.userId === userId || t.senderUserId === userId || t.recipientUserId === userId) {
          txMap.set(t.id, t);
        }
      }
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
    const isInternalMovement = (t: any) => {
      if (t.metadata?.isInternalTransfer === true || t.metadata?.transferScope === 'INTERNAL_ACCOUNT_TRANSFER') {
        return true;
      }
      if (t.type !== 'TRANSFER') return false;
      const desc = String(t.description || '').toLowerCase();
      if (
        desc.includes('checking to savings') ||
        desc.includes('savings to checking') ||
        desc.includes('internal transfer') ||
        desc.includes('internal account transfer')
      ) {
        return true;
      }
      const isAdminTransfer =
        t.metadata?.disbursementType === 'ADMINISTRATIVE_TRANSFER' ||
        t.senderAccountNumber === '1000000001' ||
        t.senderName?.includes('Bennett Johnson');
      return Boolean(
        !isAdminTransfer &&
        !desc.includes('loan') &&
        !desc.includes('disburs') &&
        t.senderUserId &&
        t.recipientUserId &&
        t.senderUserId === t.recipientUserId
      );
    };

    if (flow === 'CREDIT') {
      txs = txs.filter((t) => {
        if (isInternalMovement(t)) return false;
        if (t.type === 'CHECK_WITHDRAWAL' || t.type === 'WIRE_CHECK_WITHDRAWAL') return false;
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
        if (isInternalMovement(t)) return false;
        if (t.type === 'CHECK_WITHDRAWAL' || t.type === 'WIRE_CHECK_WITHDRAWAL') return true;
        const userAccClean = userAcc ? userAcc.replace(/[-\s]/g, '') : '';
        const txSenderClean = (t.senderAccountNumber || '').replace(/[-\s]/g, '');
        const isOutgoing = (t.senderUserId === userId && t.recipientUserId !== userId) || (userAccClean && txSenderClean && txSenderClean === userAccClean);
        const isWithdrawal =
          t.type === 'WITHDRAWAL' ||
          t.type === 'CHECK_WITHDRAWAL' ||
          t.type === 'WIRE_CHECK_WITHDRAWAL' ||
          t.type === 'CARD_PURCHASE' ||
          t.type === 'FEE';
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

export interface CreateInvestmentHandlerDeps {
  firestore?: typeof adminFirestore;
  createInvestmentFn?: typeof executeServerInvestmentCreation;
  isAdminFn?: typeof isCallerAdministrator;
  memoryDb?: Pick<typeof db, 'createTermInvestment'>;
}

export async function handleCreateInvestment(
  req: AuthenticatedRequest,
  res: Response,
  deps?: CreateInvestmentHandlerDeps
) {
  const callerUid = req.auth?.uid;
  if (!callerUid) {
    return res.status(401).json({ error: 'Authentication required to create a term investment.' });
  }

  const { termDays, amount, userAccountNumber, clientRequestId, fallbackUser, userId: reqUserId } = req.body || {};
  const adminSessionToken =
    (req.headers?.['x-admin-session'] as string | undefined) || req.auth?.adminSessionToken;
  const isAdminFn = deps?.isAdminFn || isCallerAdministrator;
  const isCallerAdmin = await isAdminFn(callerUid, req.auth?.email, req.auth, adminSessionToken);

  const cleanReqUserId = typeof reqUserId === 'string' && reqUserId.trim() ? reqUserId.trim() : undefined;
  if (!isCallerAdmin && cleanReqUserId && cleanReqUserId !== callerUid) {
    return res.status(403).json({
      error: 'FORBIDDEN: You are not authorized to create term investments for another customer.',
    });
  }

  const userId = isCallerAdmin && cleanReqUserId ? cleanReqUserId : callerUid;
  if (!userId || !termDays || !amount) {
    return res.status(400).json({ error: 'User ID, term duration, and amount are required.' });
  }

  const fs = deps?.firestore || adminFirestore;
  // Check account freeze status before investment creation
  try {
    const userDocSnap = await fs.collection('users').doc(userId).get();
    const userData = userDocSnap.exists ? userDocSnap.data()! : {};
    if (userData.status === 'frozen') {
      return res.status(403).json({
        error: 'Your account is currently restricted/frozen. New investments are disabled while the account is frozen. Please contact compliance support.',
      });
    }
  } catch (err: any) {
    console.error('[/api/investments/create] Failed to verify user status:', err);
    return res.status(500).json({ error: 'Unable to verify customer account status.' });
  }

  const createInvestmentFn = deps?.createInvestmentFn || executeServerInvestmentCreation;
  const memStore = deps?.memoryDb || db;

  try {
    const result = await createInvestmentFn(
      {
        userId,
        authenticatedUid: callerUid,
        isAuthorizedAdmin: isCallerAdmin,
        termDays: Number(termDays) as InvestmentTermDays,
        amount: Number(amount),
        clientRequestId,
        userAccountNumber,
        fallbackUser,
      },
      deps?.firestore ? { firestore: deps.firestore } : undefined
    );

    if (!result.success) {
      const statusCode =
        result.errorCode === 'FORBIDDEN' || result.error?.includes('FORBIDDEN')
          ? 403
          : result.errorCode === 'UNAUTHORIZED'
            ? 401
            : 400;
      return res.status(statusCode).json({ error: result.error });
    }

    // Mirror to in-memory db for local sync
    try {
      memStore.createTermInvestment({
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
}

app.post('/api/investments/create', requireFirebaseAuth, (req: AuthenticatedRequest, res: Response) =>
  handleCreateInvestment(req, res)
);

export interface MatureInvestmentHandlerDeps {
  firestore?: typeof adminFirestore;
  matureInvestmentFn?: typeof executeServerInvestmentMaturity;
  isAdminFn?: typeof isCallerAdministrator;
  memoryDb?: Pick<typeof db, 'matureInvestment'>;
}

// Settlement of Matured Term Investment
export async function handleMatureInvestment(
  req: AuthenticatedRequest,
  res: Response,
  deps?: MatureInvestmentHandlerDeps
) {
  const callerUid = req.auth?.uid;
  if (!callerUid) {
    return res.status(401).json({ error: 'Authentication required to settle investment.' });
  }

  const id = typeof req.params?.id === 'string' ? req.params.id.trim() : '';
  if (!id) {
    return res.status(400).json({ error: 'Investment ID is required.' });
  }

  const adminSessionToken =
    (req.headers?.['x-admin-session'] as string | undefined) || req.auth?.adminSessionToken;
  const isAdminFn = deps?.isAdminFn || isCallerAdministrator;
  const isCallerAdmin = await isAdminFn(callerUid, req.auth?.email, req.auth, adminSessionToken);

  const cleanReqUserId = typeof req.body?.userId === 'string' && req.body.userId.trim() ? req.body.userId.trim() : undefined;
  if (!isCallerAdmin && cleanReqUserId && cleanReqUserId !== callerUid) {
    return res.status(403).json({
      error: 'FORBIDDEN: You are not authorized to settle another customer\'s investment.',
    });
  }

  const targetUserId = isCallerAdmin ? (cleanReqUserId || '') : callerUid;
  const matureInvestmentFn = deps?.matureInvestmentFn || executeServerInvestmentMaturity;
  const memStore = deps?.memoryDb || db;

  try {
    const result = await matureInvestmentFn(
      {
        investmentId: id,
        userId: targetUserId,
        authenticatedUid: callerUid,
        isAuthorizedAdmin: isCallerAdmin,
      },
      deps?.firestore ? { firestore: deps.firestore } : undefined
    );

    if (!result.success) {
      const statusCode =
        result.errorCode === 'FORBIDDEN' || result.error?.includes('FORBIDDEN')
          ? 403
          : result.errorCode === 'UNAUTHORIZED'
            ? 401
            : 400;
      return res.status(statusCode).json({ error: result.error });
    }

    // Mirror to in-memory db for local sync
    try {
      memStore.matureInvestment(id);
    } catch {}

    return res.json(result);
  } catch (err: any) {
    console.error('[/api/investments/:id/mature] Error:', err);
    return res.status(500).json({ error: err?.message || 'Server error settling term investment.' });
  }
}

app.post('/api/investments/:id/mature', requireFirebaseAuth, (req: AuthenticatedRequest, res: Response) =>
  handleMatureInvestment(req, res)
);

// --- CARDS ---
app.get('/api/cards', optionalFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const callerUid = req.auth?.uid;
  const isCallerAdmin = callerUid ? await isCallerAdministrator(callerUid, req.auth?.email, req.auth) : false;
  const requestedUserId = req.query.userId as string | undefined;

  const targetUserId = isCallerAdmin && requestedUserId ? requestedUserId : (callerUid || requestedUserId);
  if (!targetUserId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  // If ordinary customer, deny access to other customers' cards
  if (callerUid && !isCallerAdmin && requestedUserId && requestedUserId !== callerUid) {
    return res.status(403).json({ error: 'FORBIDDEN: You are not authorized to view another customer\'s cards.' });
  }

  try {
    const cardMap = new Map<string, any>();

    // 1. Authoritative cards in Firestore
    const fsSnap = await adminFirestore.collection('cards').where('userId', '==', targetUserId).get();
    fsSnap.forEach((doc) => {
      const c = doc.data();
      if (c && c.id) cardMap.set(c.id, c);
    });

    // 2. In-memory cards
    Array.from(db.cards.values()).forEach((c) => {
      if (c.userId === targetUserId && !cardMap.has(c.id)) {
        cardMap.set(c.id, c);
      }
    });

    const userCards = Array.from(cardMap.values()).sort(
      (a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );
    return res.json({ cards: userCards });
  } catch (err: any) {
    console.error('[/api/cards error]', err);
    const userCards = Array.from(db.cards.values()).filter((c) => c.userId === targetUserId);
    return res.json({ cards: userCards });
  }
});

app.post('/api/cards/create', requireFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const callerUid = req.auth!.uid;
  const isCallerAdmin = await isCallerAdministrator(callerUid, req.auth?.email, req.auth);

  // Determine target customer UID strictly from verified token (unless admin creating on behalf of a customer)
  const targetUserId = (isCallerAdmin && req.body.userId) ? req.body.userId : callerUid;

  const {
    cardHolderName,
    phone,
    cardType,
    cardTier,
    brand,
    spendingLimitMonthly,
    spendingLimitDaily,
    colorScheme,
    userAccountNumber,
    clientRequestId,
    fallbackBalances,
    fallbackUser,
  } = req.body;

  try {
    const result = await executeServerCardIssuance({
      userId: targetUserId,
      cardHolderName,
      phone,
      cardType,
      cardTier,
      brand,
      spendingLimitMonthly: spendingLimitMonthly ? Number(spendingLimitMonthly) : 20000,
      spendingLimitDaily: spendingLimitDaily ? Number(spendingLimitDaily) : 20000,
      colorScheme,
      userAccountNumber,
      clientRequestId,
      fallbackBalances,
      fallbackUser,
    });

    if (!result.success) {
      const statusCode = result.error?.includes('not found') ? 404 : 400;
      return res.status(statusCode).json({ error: result.error });
    }

    // Mirror to in-memory db
    try {
      if (result.card) {
        db.cards.set(result.card.id, result.card);
      }
      if (result.transaction) {
        db.transactions.unshift(result.transaction);
      }
      if (result.balanceMetrics?.accounts) {
        result.balanceMetrics.accounts.forEach((acc) => db.accounts.set(acc.id, acc));
      }
    } catch {}

    return res.json(result);
  } catch (err: any) {
    console.error('[/api/cards/create Error]:', err);
    return res.status(500).json({ error: err?.message || 'Server error creating card.' });
  }
});

app.post('/api/cards/:id/toggle-freeze', optionalFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const callerUid = req.auth?.uid;
  let card: any = null;

  try {
    const cardDocRef = adminFirestore.collection('cards').doc(id);
    const cardSnap = await cardDocRef.get();
    if (cardSnap.exists) {
      card = cardSnap.data();
      if (callerUid) {
        const isCallerAdmin = await isCallerAdministrator(callerUid, req.auth?.email, req.auth);
        if (!isCallerAdmin && card.userId !== callerUid) {
          return res.status(403).json({ error: 'FORBIDDEN: You do not own this card.' });
        }
      }
      card.status = card.status === 'ACTIVE' ? 'FROZEN' : 'ACTIVE';
      card.updatedAt = new Date().toISOString();
      await cardDocRef.set({ status: card.status, updatedAt: card.updatedAt }, { merge: true });
      db.cards.set(id, card);
    }
  } catch (fsErr) {
    console.warn('[/api/cards/:id/toggle-freeze] Firestore error:', fsErr);
  }

  if (!card) {
    card = db.cards.get(id);
    if (!card) return res.status(404).json({ error: 'Card not found' });
    card.status = card.status === 'ACTIVE' ? 'FROZEN' : 'ACTIVE';
  }

  // Persistent deterministic notification for card freeze/unfreeze
  try {
    const tsKey = (card.updatedAt || new Date().toISOString()).replace(/[^0-9]/g, '');
    await persistCustomerNotification({
      id: `notif_card_frz_${id}_${tsKey}`,
      userId: card.userId,
      title: `Card ${card.status === 'FROZEN' ? 'Frozen' : 'Reactivated'}`,
      message: `Your ${card.cardTier || 'Monvera'} card (•••• ${(card.maskedNumber || card.cardNumber || '0000').slice(-4)}) has been ${
        card.status === 'FROZEN' ? 'locked' : 'unlocked'
      }.`,
      type: 'SECURITY',
      severity: card.status === 'FROZEN' ? 'warning' : 'success',
      createdAt: card.updatedAt || new Date().toISOString(),
      referenceId: id,
      actionView: 'cards',
      actionRecordId: id,
      metadata: {
        category: 'SECURITY',
        eventType: card.status === 'FROZEN' ? 'CARD_FROZEN' : 'CARD_UNFROZEN',
        requestType: 'Debit / Virtual Card Security',
        status: card.status,
        cardId: id,
        date: card.updatedAt || new Date().toISOString(),
      },
    });
  } catch {}

  res.json({ success: true, card });
});

app.post('/api/cards/:id/update-limits', optionalFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const callerUid = req.auth?.uid;
  const { dailyLimit, monthlyLimit, international, online, atm } = req.body;
  let card: any = null;

  try {
    const cardDocRef = adminFirestore.collection('cards').doc(id);
    const cardSnap = await cardDocRef.get();
    if (cardSnap.exists) {
      card = cardSnap.data();
      if (callerUid) {
        const isCallerAdmin = await isCallerAdministrator(callerUid, req.auth?.email, req.auth);
        if (!isCallerAdmin && card.userId !== callerUid) {
          return res.status(403).json({ error: 'FORBIDDEN: You do not own this card.' });
        }
      }
      if (dailyLimit !== undefined) card.spendingLimitDaily = Number(dailyLimit);
      if (monthlyLimit !== undefined) card.spendingLimitMonthly = Number(monthlyLimit);
      if (international !== undefined) card.internationalEnabled = Boolean(international);
      if (online !== undefined) card.onlineEnabled = Boolean(online);
      if (atm !== undefined) card.atmEnabled = Boolean(atm);
      card.updatedAt = new Date().toISOString();
      await cardDocRef.set(card, { merge: true });
      db.cards.set(id, card);
    }
  } catch (fsErr) {
    console.warn('[/api/cards/:id/update-limits] Firestore error:', fsErr);
  }

  if (!card) {
    card = db.cards.get(id);
    if (!card) return res.status(404).json({ error: 'Card not found' });
    if (dailyLimit !== undefined) card.spendingLimitDaily = Number(dailyLimit);
    if (monthlyLimit !== undefined) card.spendingLimitMonthly = Number(monthlyLimit);
    if (international !== undefined) card.internationalEnabled = Boolean(international);
    if (online !== undefined) card.onlineEnabled = Boolean(online);
    if (atm !== undefined) card.atmEnabled = Boolean(atm);
  }

  res.json({ success: true, card });
});

// --- NOTIFICATIONS & SECURITY ---
app.get('/api/notifications', optionalFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const callerUid = req.auth?.uid;
  const isCallerAdmin = callerUid
    ? await isCallerAdministrator(callerUid, req.auth?.email, req.auth, req.headers['x-admin-session'] as string | undefined)
    : false;

  const requestedUserId = (req.query.userId as string | undefined)?.trim();
  const accountNumber = (req.query.accountNumber as string | undefined)?.trim();

  if (callerUid && !isCallerAdmin && requestedUserId && requestedUserId !== callerUid) {
    return res.status(403).json({ error: 'FORBIDDEN: You are not authorized to view another customer\'s notifications.' });
  }

  const targetUserId = isCallerAdmin && requestedUserId ? requestedUserId : (callerUid || requestedUserId);
  if (!targetUserId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  const matchedUserIds = new Set<string>([targetUserId]);
  const user =
    db.users.get(targetUserId) ||
    Array.from(db.users.values()).find(
      (u) =>
        u.id === targetUserId ||
        (accountNumber && u.permanentAccountNumber === accountNumber)
    );
  if (user && user.id === targetUserId && user.permanentAccountNumber) {
    matchedUserIds.add(user.permanentAccountNumber);
  }
  if (accountNumber && (!user || user.id === targetUserId)) {
    matchedUserIds.add(accountNumber);
  }

  const notifMap = new Map<string, any>();

  // 1. Authoritative notifications from Firestore (only belonging to targetUserId)
  if (isFirebaseAdminConfigured()) {
    try {
      const fsSnap = await adminFirestore
        .collection('notifications')
        .where('userId', '==', targetUserId)
        .get();
      fsSnap.forEach((d) => {
        const data = d.data();
        const id = d.id || data?.id;
        if (id && data?.userId === targetUserId) {
          notifMap.set(id, { id, ...data });
        }
      });

      // Also include any legacy docs keyed by customer accountNumber if different from UID
      if (accountNumber && accountNumber !== targetUserId) {
        try {
          const accSnap = await adminFirestore
            .collection('notifications')
            .where('userId', '==', accountNumber)
            .get();
          accSnap.forEach((d) => {
            const data = d.data();
            const id = d.id || data?.id;
            if (id && !notifMap.has(id)) {
              notifMap.set(id, { id, ...data, userId: targetUserId });
            }
          });
        } catch {}
      }
    } catch (fsErr: any) {
      console.warn('[/api/notifications] Firestore read note:', fsErr?.message || fsErr);
    }
  }

  // 2. Merge in-memory notifications belonging strictly to targetUserId (never leak other users or global 'all')
  db.notifications.forEach((n) => {
    if (!n || !n.id) return;
    if (matchedUserIds.has(n.userId)) {
      const existing = notifMap.get(n.id);
      if (!existing) {
        notifMap.set(n.id, n);
      } else if (n.read && !existing.read) {
        notifMap.set(n.id, { ...existing, read: true });
      }
    }
  });

  const userNotifs = Array.from(notifMap.values()).sort(
    (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  );

  res.json({ notifications: userNotifs });
});

app.post('/api/notifications/read', optionalFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const callerUid = req.auth?.uid;
  const isCallerAdmin = callerUid
    ? await isCallerAdministrator(callerUid, req.auth?.email, req.auth, req.headers['x-admin-session'] as string | undefined)
    : false;

  const { notificationId, userId: bodyUserId } = req.body || {};
  if (!notificationId || !bodyUserId) {
    return res.status(400).json({ error: 'notificationId and userId are required' });
  }

  if (callerUid && !isCallerAdmin && bodyUserId !== callerUid) {
    return res.status(403).json({ error: 'FORBIDDEN: You cannot modify another customer\'s notification state.' });
  }

  const targetUserId = isCallerAdmin ? bodyUserId : (callerUid || bodyUserId);
  const readAt = new Date().toISOString();
  let updated = db.markNotificationAsRead(notificationId, targetUserId);

  if (isFirebaseAdminConfigured()) {
    try {
      const docRef = adminFirestore.collection('notifications').doc(notificationId);
      const snap = await docRef.get();
      if (snap.exists) {
        const data = snap.data() || {};
        if (!isCallerAdmin && data.userId && data.userId !== targetUserId) {
          return res.status(403).json({ error: 'FORBIDDEN: Notification belongs to another customer.' });
        }
        await docRef.set({ read: true, readAt }, { merge: true });
        updated = true;
      }
    } catch (err: any) {
      console.warn('[/api/notifications/read] Firestore update note:', err?.message || err);
    }
  }

  res.json({ success: updated });
});

app.post('/api/notifications/read-all', optionalFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const callerUid = req.auth?.uid;
  const isCallerAdmin = callerUid
    ? await isCallerAdministrator(callerUid, req.auth?.email, req.auth, req.headers['x-admin-session'] as string | undefined)
    : false;

  const { userId: bodyUserId } = req.body || {};
  if (!bodyUserId && !callerUid) {
    return res.status(400).json({ error: 'userId is required' });
  }

  if (callerUid && !isCallerAdmin && bodyUserId && bodyUserId !== callerUid) {
    return res.status(403).json({ error: 'FORBIDDEN: You cannot mark another customer\'s notifications as read.' });
  }

  const targetUserId = isCallerAdmin && bodyUserId ? bodyUserId : (callerUid || bodyUserId);
  const readAt = new Date().toISOString();

  db.notifications.forEach((n) => {
    if (n.userId === targetUserId) {
      n.read = true;
    }
  });

  if (isFirebaseAdminConfigured()) {
    try {
      const snap = await adminFirestore
        .collection('notifications')
        .where('userId', '==', targetUserId)
        .where('read', '==', false)
        .get();
      if (!snap.empty) {
        const batch = adminFirestore.batch();
        snap.docs.forEach((d) => {
          batch.set(d.ref, { read: true, readAt }, { merge: true });
        });
        await batch.commit();
      }
    } catch (err: any) {
      console.warn('[/api/notifications/read-all] Firestore batch update note:', err?.message || err);
    }
  }

  res.json({ success: true });
});

app.post('/api/support/reply', optionalFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { notificationId, userId, message } = req.body || {};
  const cleanMessage = typeof message === 'string' ? message.trim() : '';
  if (!notificationId || !userId || !cleanMessage) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  const callerUid = req.auth?.uid;
  const isCallerAdmin = callerUid
    ? await isCallerAdministrator(callerUid, req.auth?.email, req.auth, req.headers['x-admin-session'] as string | undefined)
    : false;

  if (!callerUid && !isCallerAdmin) {
    return res.status(401).json({ error: 'UNAUTHORIZED: Authentication required to reply to support tickets.' });
  }

  if (callerUid && !isCallerAdmin && userId !== callerUid) {
    return res.status(403).json({ error: 'FORBIDDEN: You can only reply to your own support notices.' });
  }

  const effectiveUserId = callerUid && !isCallerAdmin ? callerUid : userId;
  const nowIso = new Date().toISOString();

  if (isFirebaseAdminConfigured()) {
    try {
      const notifRef = adminFirestore.collection('notifications').doc(notificationId);
      const snap = await notifRef.get();
      if (snap.exists) {
        const existing = snap.data() as any;
        if (!isCallerAdmin && existing.userId && existing.userId !== effectiveUserId) {
          return res.status(403).json({ error: 'FORBIDDEN: You are not authorized to reply to this notice.' });
        }

        let senderName = isCallerAdmin ? 'Specialist' : 'Valued Customer';
        let senderAvatar: string | undefined;
        try {
          const uSnap = await adminFirestore.collection('users').doc(effectiveUserId).get();
          if (uSnap.exists) {
            const u = uSnap.data() as any;
            const fullName = `${u.firstName || ''} ${u.lastName || ''}`.trim();
            if (fullName) senderName = fullName;
            senderAvatar = u.avatarUrl;
          } else {
            const memUser = db.users.get(effectiveUserId);
            if (memUser) {
              senderName = `${memUser.firstName} ${memUser.lastName}`.trim() || senderName;
              senderAvatar = memUser.avatarUrl;
            }
          }
        } catch {}

        const newReply = {
          id: `rep_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          sender: isCallerAdmin ? ('support' as const) : ('user' as const),
          senderRole: isCallerAdmin ? ('ADMIN' as const) : ('CUSTOMER' as const),
          senderId: effectiveUserId,
          senderName,
          ...(senderAvatar ? { senderAvatar } : {}),
          message: cleanMessage,
          createdAt: nowIso,
          timestamp: nowIso,
        };

        const updatedReplies = [...(Array.isArray(existing.replies) ? existing.replies : []), newReply];
        const updatedSupportStatus = isCallerAdmin ? 'IN_PROGRESS' : 'OPEN';
        const updatedDoc = {
          ...existing,
          id: existing.id || notificationId,
          supportTicketId: existing.supportTicketId || notificationId,
          replies: updatedReplies,
          supportStatus: updatedSupportStatus,
          read: isCallerAdmin ? false : true,
          updatedAt: nowIso,
        };

        await notifRef.set(updatedDoc, { merge: true });

        // Sync in-memory record if present
        const memIdx = db.notifications.findIndex((n) => n.id === notificationId);
        if (memIdx >= 0) {
          db.notifications[memIdx] = updatedDoc;
        }

        return res.json({ success: true, notification: updatedDoc });
      }
    } catch (fsErr: any) {
      console.error('[/api/support/reply] Firestore persistence error:', fsErr?.message || fsErr);
      return res.status(500).json({ error: 'Failed to persist support reply to database. Please try again.' });
    }
  }

  const result = db.replyToSupportMessage({ notificationId, userId: effectiveUserId, message: cleanMessage });
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  res.json({ success: true, notification: result.notification });
});

// Multi-Channel Notification Dispatcher Endpoint (Disabled for external HTTP calls)
// Financial and compliance notifications are generated strictly in-process by verified backend ledger operations.
app.post('/api/notifications/dispatch', requireFirebaseAuth, async (_req: AuthenticatedRequest, res: Response) => {
  return res.status(403).json({
    success: false,
    errorCode: 'NOTIFICATION_DISPATCH_DISABLED',
    error: 'FORBIDDEN: External HTTP notification dispatch is disabled. Transaction and security notifications are generated exclusively by verified backend operations.',
  });
});

// Authenticated Push Device Registration (derives UID exclusively from verified Firebase ID token)
app.post('/api/push/register', requireFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const uid = req.auth!.uid;
  const { token, platform, userAgent } = req.body || {};

  const validation = validatePushToken(token);
  if (!validation.valid || !validation.token) {
    return res.status(400).json({ success: false, error: validation.error || 'Invalid FCM registration token.' });
  }

  try {
    const result = await registerCustomerPushToken({
      uid,
      token: validation.token,
      platform: typeof platform === 'string' ? platform : 'web',
      userAgent: typeof userAgent === 'string' ? userAgent : (req.headers['user-agent'] || 'unknown'),
    });

    if (!result.success) {
      return res.status(503).json({ success: false, error: result.error || 'Failed to register push token.' });
    }

    return res.json({
      success: true,
      tokenId: result.tokenId,
    });
  } catch (err: any) {
    console.error('[POST /api/push/register] Error:', err?.message || err);
    return res.status(500).json({ success: false, error: 'Failed to register push device.' });
  }
});

// Authenticated Push Device Unregistration (unlinks ONLY the caller's current device token)
app.post('/api/push/unregister', requireFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const uid = req.auth!.uid;
  const { token } = req.body || {};

  const validation = validatePushToken(token);
  if (!validation.valid || !validation.token) {
    return res.status(400).json({ success: false, error: validation.error || 'Invalid FCM registration token.' });
  }

  try {
    const result = await unregisterCustomerPushToken({
      uid,
      token: validation.token,
    });

    if (!result.success) {
      return res.status(503).json({ success: false, error: result.error || 'Failed to unregister push token.' });
    }

    return res.json({
      success: true,
      unregistered: result.unregistered,
    });
  } catch (err: any) {
    console.error('[POST /api/push/unregister] Error:', err?.message || err);
    return res.status(500).json({ success: false, error: 'Failed to unregister push device.' });
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
app.get('/api/admin/verify-session', requireAdminAuth, (req: AuthenticatedRequest, res: Response) => {
  const headerSessionToken = req.headers['x-admin-session'] as string | undefined;
  const effectiveSessionToken = headerSessionToken || req.auth?.adminSessionToken;
  const sessionCheck = verifyAdminSessionToken(effectiveSessionToken, req.auth!.uid, req.auth!.email);
  if (!sessionCheck.valid) {
    const isExpired = sessionCheck.reason === 'Admin session expired';
    return res.status(401).json({
      success: false,
      isAdmin: false,
      hasAdminIdentity: true,
      sessionExpired: isExpired,
      errorCode: 'ADMIN_SESSION_INVALID',
      error: `UNAUTHORIZED: ${sessionCheck.reason || 'Valid non-expired administrator session is required. Please sign in to the Executive Console again.'}`,
    });
  }

  res.json({
    success: true,
    isAdmin: true,
    uid: req.auth!.uid,
    email: req.auth!.email,
    expiresAt: sessionCheck.payload?.exp,
  });
});

app.post('/api/admin/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body || {};
    if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
      return res.status(400).json({ success: false, error: 'Email and password are required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const configuredEmails = getConfiguredAdminEmails();
    const configuredPassword = (process.env.ADMIN_PASSWORD || '').replace(/^["']|["']$/g, '').trim();

    // Check if this email matches the configured administrator email list
    const isAdminEmail = configuredEmails.length > 0 && configuredEmails.includes(cleanEmail);

    if (!isAdminEmail) {
      // Not an administrator email - notify client with distinct error code
      console.warn(`[POST /api/admin/login] Authentication attempt with unconfigured email: ${cleanEmail}`);
      return res.status(403).json({
        success: false,
        isAdminAttempt: false,
        errorCode: 'EMAIL_NOT_ADMIN',
        error: 'Email address is not recognized as an authorized administrator in server configuration.',
      });
    }

    // It IS an administrator email. Verify password against ADMIN_PASSWORD from Railway environment variables.
    if (!configuredPassword) {
      console.warn('[POST /api/admin/login] ADMIN_PASSWORD is not configured in server environment variables.');
      return res.status(503).json({
        success: false,
        isAdminAttempt: true,
        errorCode: 'CONFIG_UNAVAILABLE',
        error: 'ADMIN_NOT_CONFIGURED: Administrator password is not configured on the server.',
      });
    }

    // Secure timing-safe password comparison
    const incomingBuffer = Buffer.from(password);
    const configuredBuffer = Buffer.from(configuredPassword);
    const passwordMatches =
      incomingBuffer.length === configuredBuffer.length &&
      crypto.timingSafeEqual(incomingBuffer, configuredBuffer);

    if (!passwordMatches) {
      console.warn(`[POST /api/admin/login] Failed login attempt for administrator email: ${cleanEmail}`);
      return res.status(401).json({
        success: false,
        isAdminAttempt: true,
        errorCode: 'INVALID_CREDENTIALS',
        error: 'INVALID_CREDENTIALS: Invalid administrator email or password.',
      });
    }

    // Administrator credentials verified successfully!
    if (!isFirebaseAdminConfigured()) {
      const fbDiag = getFirebaseAdminDiagnostics();
      console.warn('[POST /api/admin/login] Firebase Admin SDK unavailable:', fbDiag.error || 'not configured');
      return res.status(503).json({
        success: false,
        isAdminAttempt: true,
        errorCode: 'CONFIG_UNAVAILABLE',
        error: fbDiag.error
          ? `SERVICE_UNAVAILABLE: ${fbDiag.error}`
          : 'SERVICE_UNAVAILABLE: Firebase Admin service account is not configured on the server.',
      });
    }

    let userRecord;
    try {
      userRecord = await adminAuth.getUserByEmail(cleanEmail);
    } catch (userErr: any) {
      if (userErr?.code === 'auth/user-not-found') {
        console.log(`[Admin Login] Creating Firebase Auth record for administrator: ${cleanEmail}`);
        userRecord = await adminAuth.createUser({
          email: cleanEmail,
          emailVerified: true,
          displayName: 'Monvera Administrator',
          password: configuredPassword,
        });
      } else {
        throw userErr;
      }
    }

    if (userRecord.disabled) {
      console.warn(`[Admin Login] Administrator Firebase Auth account is disabled for ${cleanEmail}`);
      return res.status(403).json({
        success: false,
        isAdminAttempt: true,
        errorCode: 'ACCOUNT_DISABLED',
        error: 'Administrator Firebase Authentication account is disabled. Enable the account in Firebase Console.',
      });
    }

    // Ensure emailVerified is true without overwriting password (updating password bumps tokensValidAfterTime before createCustomToken)
    if (!userRecord.emailVerified) {
      try {
        await adminAuth.updateUser(userRecord.uid, {
          emailVerified: true,
        });
      } catch (syncErr) {
        console.warn('[Admin Login] Notice: Could not update emailVerified on Firebase user record:', syncErr);
      }
    }

    // Create cryptographically signed administrator session token
    const adminSessionToken = createAdminSessionToken(userRecord.uid, cleanEmail);
    if (!adminSessionToken) {
      console.error('[Admin Login] Failed to create admin session token');
      return res.status(500).json({
        success: false,
        isAdminAttempt: true,
        errorCode: 'SERVER_ERROR',
        error: 'SERVER_ERROR: Failed to issue administrator session credentials.',
      });
    }

    const adminClaims = {
      admin: true,
      role: 'admin',
      roleLevel: 4,
      adminSessionToken,
    };

    try {
      await adminAuth.setCustomUserClaims(userRecord.uid, adminClaims);
    } catch (claimsErr) {
      console.warn('[Admin Login] Notice: Could not set custom claims:', claimsErr);
    }

    // Mint Firebase Custom Token with admin claims and verified session token
    const customToken = await adminAuth.createCustomToken(userRecord.uid, adminClaims);

    console.log(`[Admin Login] Successfully authenticated administrator: ${cleanEmail}`);
    return res.json({
      success: true,
      isAdminAttempt: true,
      customToken,
      adminSessionToken,
      user: {
        uid: userRecord.uid,
        email: cleanEmail,
        role: 'admin',
      },
    });
  } catch (err: any) {
    console.error('[POST /api/admin/login] Unexpected error:', err?.message || err);
    return res.status(500).json({
      success: false,
      isAdminAttempt: true,
      errorCode: 'SERVER_ERROR',
      error: 'SERVER_ERROR: An unexpected error occurred during administrator authentication.',
    });
  }
});

const FAKE_ACCOUNT_IDS = new Set([
  'usr_eleanor',
  'usr_marcus',
  'usr_sophia',
  'usr_alexander',
  'usr_isabella',
  'usr_lucas',
  'usr_clara',
  'usr_tariq',
  'usr_elena',
  'usr_william',
  'usr_amara',
  'usr_julian',
]);

function isFakeAccount(user: { id?: string; email?: string; role?: string }): boolean {
  if (!user) return true;
  if (user.id && FAKE_ACCOUNT_IDS.has(user.id)) return true;
  if (user.id === 'usr_admin' || user.role === 'super_admin') return true;
  if (user.email) {
    const em = user.email.toLowerCase().trim();
    if (
      em.endsWith('@vanceholdings.com') ||
      em.endsWith('@sterlingtech.io') ||
      em.endsWith('@falconcap.ae') ||
      em.endsWith('@apexventures.sg') ||
      em.endsWith('@milanolux.it') ||
      em.endsWith('@vanderbiltmaritime.nl') ||
      em.endsWith('@oswaldresearch.org') ||
      em.endsWith('@gulfenergyholdings.com') ||
      em.endsWith('@auroraglobal.ch') ||
      em.endsWith('@thornepartners.co.uk') ||
      em.endsWith('@lagosfin.ng') ||
      em.endsWith('@delacroixequity.fr') ||
      em.endsWith('@monvera.internal')
    ) {
      return true;
    }
  }
  return false;
}

app.get('/api/admin/overview', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    let totalCustomers = 0;
    let activeAccounts = 0;
    let totalPlatformDeposits = 0;
    let totalPlatformWithdrawals = 0;
    let totalPlatformTransfers = 0;
    let totalPlatformInvestments = 0;
    let pendingTransactionsCount = 0;
    let failedTransactionsCount = 0;

    if (isFirebaseAdminConfigured()) {
      const [usersSnap, accountsSnap, txSnap, invSnap] = await Promise.all([
        adminFirestore.collection('users').get().catch(() => null),
        adminFirestore.collection('accounts').get().catch(() => null),
        adminFirestore.collection('transactions').get().catch(() => null),
        adminFirestore.collection('investments').get().catch(() => null),
      ]);

      const realUserIds = new Set<string>();
      if (usersSnap) {
        usersSnap.forEach((doc) => {
          const d = doc.data();
          if (!isFakeAccount({ id: doc.id, ...d })) {
            realUserIds.add(doc.id);
          }
        });
      }

      totalCustomers = realUserIds.size;

      if (accountsSnap) {
        accountsSnap.forEach((doc) => {
          if (realUserIds.has(doc.id) || !usersSnap) {
            const ad = doc.data();
            const chk = Number(ad.checkingBalance ?? 0);
            const sav = Number(ad.savingsBalance ?? ad.savings ?? 0);
            const inv = Number(ad.investedBalance ?? ad.investmentBalance ?? 0);
            const accrued = Number(ad.accruedEarnings ?? 0);
            const total = Number(ad.totalBalance ?? (chk + sav + inv + accrued));
            totalPlatformDeposits += total;
            if (Array.isArray(ad.accounts) && ad.accounts.length > 0) {
              activeAccounts += ad.accounts.filter((a: any) => a.status === 'ACTIVE').length;
            } else {
              activeAccounts += 2;
            }
          }
        });
      }

      if (txSnap) {
        txSnap.forEach((doc) => {
          const tx = doc.data();
          const amt = Number(tx.amount) || 0;
          const status = (tx.status || 'COMPLETED').toUpperCase();

          if (status === 'PENDING') {
            pendingTransactionsCount++;
          } else if (status === 'FAILED' || status === 'DECLINED') {
            failedTransactionsCount++;
          } else if (status === 'COMPLETED' || status === 'SETTLED' || status === 'POSTED') {
            if (tx.type === 'WITHDRAWAL') {
              totalPlatformWithdrawals += amt;
            } else if (tx.type === 'TRANSFER' || tx.type === 'INTERNAL_TRANSFER') {
              totalPlatformTransfers += amt;
            } else if (tx.type === 'INVESTMENT') {
              totalPlatformInvestments += amt;
            }
          }
        });
      }

      if (invSnap) {
        invSnap.forEach((doc) => {
          const inv = doc.data();
          if (inv && (inv.status === 'ACTIVE' || inv.status === 'ACTIVE_INVESTMENT')) {
            totalPlatformInvestments += Number(inv.principalAmount || inv.amount || 0);
          }
        });
      }
    }

    if (totalCustomers === 0) {
      return res.json(db.getAdminOverview());
    }

    if (activeAccounts === 0) {
      activeAccounts = totalCustomers * 2;
    }

    const overview: AdminSystemOverview = {
      totalCustomers,
      activeAccounts,
      totalPlatformDeposits,
      totalPlatformWithdrawals,
      totalPlatformTransfers,
      totalPlatformInvestments,
      pendingTransactionsCount,
      failedTransactionsCount,
      devFundingPoolBalance: db.devFundingPoolBalance,
      systemReserveRatio: 100,
      activeNodesCount: 8,
    };

    res.json(overview);
  } catch (err) {
    console.error('[GET /api/admin/overview] Error:', err);
    res.json(db.getAdminOverview());
  }
});

app.get('/api/admin/customers', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const firestoreUsers: any[] = [];
    const accountsMap = new Map<string, any>();

    if (isFirebaseAdminConfigured()) {
      const [usersSnap, accountsSnap] = await Promise.all([
        adminFirestore.collection('users').get().catch((err) => {
          console.warn('[GET /api/admin/customers] Error fetching users from Firestore:', err?.message || err);
          return null;
        }),
        adminFirestore.collection('accounts').get().catch((err) => {
          console.warn('[GET /api/admin/customers] Error fetching accounts from Firestore:', err?.message || err);
          return null;
        }),
      ]);

      if (accountsSnap) {
        accountsSnap.forEach((doc) => {
          accountsMap.set(doc.id, doc.data());
        });
      }

      if (usersSnap) {
        usersSnap.forEach((doc) => {
          const d = doc.data();
          if (!isFakeAccount({ id: doc.id, ...d })) {
            firestoreUsers.push({ id: doc.id, ...d });
          }
        });
      }
    }

    const userMap = new Map<string, any>();

    for (const fu of firestoreUsers) {
      const cleanAcc = (fu.permanentAccountNumber || '').replace(/[-\s]/g, '');
      const ad = accountsMap.get(fu.id) || (cleanAcc ? accountsMap.get(cleanAcc) : null);
      let balanceMetrics: any;
      if (ad) {
        balanceMetrics = resolveCustomerPreviewBalanceMetrics(ad, {
          userId: fu.id,
          accountNumber: cleanAcc,
        });
      } else if (db.users.has(fu.id)) {
        balanceMetrics = db.getUserBalanceMetrics(fu.id);
      } else {
        balanceMetrics = {
          checkingBalance: 0,
          savingsBalance: 0,
          investedBalance: 0,
          accruedEarnings: 0,
          totalBalance: 0,
          availableBalance: 0,
          pendingBalance: 0,
          loanBalance: 0,
          accounts: [],
        };
      }

      userMap.set(fu.id, {
        ...fu,
        balanceMetrics,
      });

      if (!db.users.has(fu.id)) {
        db.users.set(fu.id, fu as UserProfile);
      } else {
        Object.assign(db.users.get(fu.id)!, fu);
      }
    }

    // Fallback to non-fake users in db.users if Firestore returned nothing (e.g. dev mode without Firestore)
    if (userMap.size === 0) {
      Array.from(db.users.values())
        .filter((u) => !isFakeAccount(u))
        .forEach((u) => {
          userMap.set(u.id, {
            ...u,
            balanceMetrics: db.getUserBalanceMetrics(u.id),
          });
        });
    }

    const customers = Array.from(userMap.values());
    res.json({ customers });
  } catch (err: any) {
    console.error('[GET /api/admin/customers] Error fetching customers:', err);
    const customers = Array.from(db.users.values())
      .filter((u) => !isFakeAccount(u))
      .map((u) => ({
        ...u,
        balanceMetrics: db.getUserBalanceMetrics(u.id),
      }));
    res.json({ customers });
  }
});

app.post('/api/admin/customers/:id/toggle-status', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { reason, targetStatus } = req.body;

  // 1. Authoritative caller identity from verified Firebase ID token
  const callerUid = req.auth!.uid;
  const effectiveAdminId = callerUid;

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
        statusUpdatedBy: effectiveAdminId,
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
    adminId: effectiveAdminId,
    adminName: 'Monvera Compliance Admin',
    action: nextStatus === 'frozen' ? 'CUSTOMER_ACCOUNT_RESTRICTED' : 'CUSTOMER_ACCOUNT_UNFROZEN',
    targetUserId: canonicalUid,
    targetAccountNumber: user.permanentAccountNumber,
    reason: reason || (nextStatus === 'frozen' ? 'Account placed on administrative freeze' : 'Administrative hold lifted'),
    timestamp: nowIso,
    ipAddress: '127.0.0.1 (Admin Console)',
    result: 'SUCCESS',
  });

  // Persist customer security notification
  persistCustomerNotification({
    id: `notif_acc_status_${canonicalUid}_${nowIso.replace(/[^0-9]/g, '').slice(0, 14)}`,
    userId: canonicalUid,
    title: nextStatus === 'frozen' ? 'Account Restricted / Placed on Hold' : 'Account Restrictions Lifted',
    message:
      nextStatus === 'frozen'
        ? `Your Monvera banking profile has been temporarily restricted by Compliance. Reason: ${reason || 'Administrative compliance review'}.`
        : `Good news — your Monvera banking profile is active and full transactional access has been restored.`,
    type: 'SECURITY',
    severity: nextStatus === 'frozen' ? 'warning' : 'success',
    createdAt: nowIso,
    referenceId: canonicalUid,
    actionView: 'profile',
    actionRecordId: canonicalUid,
    metadata: {
      category: 'SECURITY',
      eventType: nextStatus === 'frozen' ? 'ACCOUNT_FROZEN' : 'ACCOUNT_UNFROZEN',
      customerName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Account Holder',
      accountNumberMasked: maskAccountNumber(user.permanentAccountNumber),
      requestType: 'Account Security Status',
      status: nextStatus,
      reason: reason || undefined,
      date: nowIso,
    },
  }).catch(() => {});

  res.json({ success: true, user, status: nextStatus, canonicalUid });
});

app.post('/api/user/unfreeze', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
  const callerUid = req.auth!.uid;

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
        statusUpdatedBy: callerUid,
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

  persistCustomerNotification({
    id: `notif_acc_unfreeze_${canonicalUid}_${nowIso.replace(/[^0-9]/g, '').slice(0, 14)}`,
    userId: canonicalUid,
    title: 'Account Restrictions Lifted',
    message: 'Your Monvera banking profile is active and full transactional capabilities have been restored.',
    type: 'SECURITY',
    severity: 'success',
    createdAt: nowIso,
    referenceId: canonicalUid,
    actionView: 'profile',
    actionRecordId: canonicalUid,
    metadata: {
      category: 'SECURITY',
      eventType: 'ACCOUNT_UNFROZEN',
      accountNumberMasked: maskAccountNumber(user?.permanentAccountNumber),
      requestType: 'Account Security Status',
      status: 'active',
      reason: reason || undefined,
      date: nowIso,
    },
  }).catch(() => {});

  res.json({ success: true, status: 'active', user, canonicalUid });
});

// Admin KYC Approval & Rejection Endpoints
app.post('/api/admin/kyc/approve', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { userId, userProfile } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  const adminId = req.auth!.uid;
  const result = await executeAuthoritativeKycApproval(userId, adminId, userProfile);
  if (!result.success) return res.status(400).json({ error: result.error });

  res.json(result);
});

app.post('/api/admin/kyc/reject', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { userId, reason, userProfile } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  const adminId = req.auth!.uid;
  const rejectionReason = reason || 'Documents could not be verified by compliance.';
  const now = new Date().toISOString();

  try {
    const userRef = adminFirestore.collection('users').doc(userId);
    await userRef.set({
      kycStatus: 'action_required',
      kycRejectionReason: rejectionReason,
      updatedAt: now,
    }, { merge: true });

    await adminFirestore.collection('kyc_submissions').doc(userId).set({
      status: 'action_required',
      rejectionReason,
      reviewedBy: adminId,
      reviewedAt: now,
    }, { merge: true });

    const result = db.rejectKyc({ userId, reason: rejectionReason, adminId, userProfile });
    const memUser = db.users.get(userId);
    if (memUser) {
      memUser.kycStatus = 'action_required';
      memUser.kycRejectionReason = rejectionReason;
      db.users.set(userId, memUser);
    }

    await serverNotificationDispatcher.dispatchNotification(userId, {
      id: `notif_kyc_rej_${userId}_${now.replace(/[^0-9]/g, '').slice(0, 14)}`,
      title: 'KYC Verification Update: Action Required',
      message: `Your KYC verification requires attention: "${rejectionReason}". Please review and resubmit in your Profile.`,
      type: 'SECURITY',
      severity: 'warning',
      referenceId: userId,
      actionView: 'profile',
      actionSection: 'kyc',
      actionRecordId: userId,
      metadata: {
        category: 'SECURITY',
        eventType: 'KYC_REJECTED',
        applicationType: 'KYC Verification',
        status: 'action_required',
        reason: rejectionReason,
        date: now,
      },
    });

    res.json(result);
  } catch (err: any) {
    console.error('[POST /api/admin/kyc/reject] Error:', err);
    res.status(500).json({ error: err?.message || 'Failed to reject KYC application' });
  }
});

app.post('/api/admin/kyc/review-item', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { userId, itemName, status, reason, userProfile } = req.body;
  if (!userId || !itemName || !status) {
    return res.status(400).json({ error: 'userId, itemName, and status are required' });
  }

  const adminId = req.auth!.uid;
  const now = new Date().toISOString();

  try {
    const userRef = adminFirestore.collection('users').doc(userId);
    const snap = await userRef.get();
    const userData = snap.exists ? snap.data()! : (userProfile || {});

    const userCountry = userData.kycCountry || userData.country || 'United States';
    const isUS = userCountry.toLowerCase().includes('united states') ||
                 userCountry.toUpperCase() === 'US' ||
                 userCountry.toUpperCase() === 'USA';

    const reviews = { ...(userData.kycItemReviews || {}) };
    reviews[itemName] = {
      status,
      reviewedAt: now,
      reviewedBy: adminId,
      reason: reason || undefined,
    };

    const requiredKeys: string[] = ['identity', 'proofOfAddress', 'liveness'];
    if (isUS || userData.kycSsn) {
      requiredKeys.push('ssn');
    }

    const hasRejected = requiredKeys.some((k) => reviews[k]?.status === 'rejected');
    const allApproved = requiredKeys.every((k) => reviews[k]?.status === 'approved');

    let newKycStatus = userData.kycStatus || 'pending';
    let newRejectionReason = userData.kycRejectionReason;
    let newLimit = userData.dailyTransactionLimit || 25000;
    let newVerifiedAt = userData.kycVerifiedAt;

    if (hasRejected) {
      newKycStatus = 'action_required';
      newRejectionReason = reason || `${itemName} document requires correction.`;
    } else if (allApproved) {
      newKycStatus = 'verified';
      newVerifiedAt = now;
      newLimit = 1000000;
      newRejectionReason = null;
    } else {
      newKycStatus = 'pending';
    }

    const itemUpdate: Record<string, any> = {
      kycStatus: newKycStatus,
      kycItemReviews: reviews,
      kycRejectionReason: newRejectionReason,
      dailyTransactionLimit: newLimit,
      kycVerifiedAt: newVerifiedAt,
      updatedAt: now,
    };

    if (newKycStatus === 'verified') {
      const verifiedLegalName =
        userData.kycFullName ||
        (userData.kycFirstName && userData.kycLastName ? `${userData.kycFirstName} ${userData.kycLastName}`.trim() : '') ||
        `${userData.firstName || ''} ${userData.lastName || ''}`.trim() ||
        'Verified Client';
      itemUpdate.verifiedLegalName = verifiedLegalName;
      itemUpdate.fullName = verifiedLegalName;
      itemUpdate.kycFullName = verifiedLegalName;
      if (userData.kycFirstName) {
        itemUpdate.firstName = userData.kycFirstName;
        itemUpdate.kycFirstName = userData.kycFirstName;
      }
      if (userData.kycLastName) {
        itemUpdate.lastName = userData.kycLastName;
        itemUpdate.kycLastName = userData.kycLastName;
      }
      if (userData.kycStreetAddress) {
        itemUpdate.streetAddress = userData.kycStreetAddress;
        itemUpdate.address = userData.kycStreetAddress;
      }
    }

    await userRef.set(itemUpdate, { merge: true });

    await adminFirestore.collection('kyc_submissions').doc(userId).set({
      status: newKycStatus,
      itemReviews: reviews,
      updatedAt: now,
      lastReviewedBy: adminId,
    }, { merge: true });

    const result = db.reviewKycItem({
      userId,
      itemName,
      status,
      reason,
      adminId,
      userProfile,
    });

    const memUser = db.users.get(userId);
    if (memUser) {
      Object.assign(memUser, itemUpdate);
      db.users.set(userId, memUser);
    }

    if (allApproved) {
      await persistCustomerNotification({
        id: `notif_kyc_appr_${userId}_${now.replace(/[^0-9]/g, '').slice(0, 12)}`,
        userId,
        title: 'KYC Verification Approved by Compliance',
        message: 'All required KYC documents have been approved by Compliance Operations. Full account limits ($1,000,000/day) are now active.',
        type: 'SECURITY',
        severity: 'success',
        createdAt: now,
        referenceId: userId,
        actionView: 'profile',
        actionSection: 'kyc',
        actionRecordId: userId,
        metadata: {
          category: 'SECURITY',
          eventType: 'KYC_APPROVED',
          customerName: itemUpdate.verifiedLegalName || userData.fullName || undefined,
          accountNumberMasked: maskAccountNumber(userData.permanentAccountNumber),
          applicationType: 'KYC Verification',
          status: 'verified',
          date: now,
        },
      });
    } else if (status === 'rejected' || hasRejected) {
      await persistCustomerNotification({
        id: `notif_kyc_item_rej_${userId}_${itemName}_${now.replace(/[^0-9]/g, '').slice(0, 12)}`,
        userId,
        title: 'KYC Verification Update: Resubmission Required',
        message: `Your ${itemName} document check requires correction: "${newRejectionReason || 'Please upload a clearer copy'}". Please resubmit in Profile.`,
        type: 'SECURITY',
        severity: 'warning',
        createdAt: now,
        referenceId: userId,
        actionView: 'profile',
        actionSection: 'kyc',
        actionRecordId: userId,
        metadata: {
          category: 'SECURITY',
          eventType: 'KYC_ITEM_REJECTED',
          customerName: userData.kycFullName || userData.fullName || undefined,
          accountNumberMasked: maskAccountNumber(userData.permanentAccountNumber),
          applicationType: `KYC (${itemName})`,
          status: 'action_required',
          reason: newRejectionReason || undefined,
          date: now,
        },
      });
    }

    res.json({ success: true, user: { ...userData, ...itemUpdate } });
  } catch (err: any) {
    console.error('[POST /api/admin/kyc/review-item] Error:', err);
    res.status(500).json({ error: err?.message || 'Failed to review KYC item' });
  }
});

// Admin Transaction Status Endpoint
app.post('/api/admin/transactions/:id/update-status', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { status, reason } = req.body;
  if (!status) return res.status(400).json({ error: 'status is required' });

  // Protect permanent CHECK_WITHDRAWAL and WIRE_CHECK_WITHDRAWAL debits from status-only reversal/override
  const normalizedTargetStatus = String(status).trim().toUpperCase();
  const memTxMatch = db.transactions.find((t) => t.id === id || t.referenceNumber === id);
  if (
    memTxMatch &&
    memTxMatch.type === 'WIRE_CHECK_WITHDRAWAL' &&
    (normalizedTargetStatus === 'REVERSED' || normalizedTargetStatus !== 'COMPLETED')
  ) {
    return res.status(400).json({
      success: false,
      errorCode: 'WIRE_CHECK_WITHDRAWAL_PERMANENT',
      error: 'WIRE_CHECK_WITHDRAWAL debits are permanent and cannot be reversed or altered through status-only updates.',
    });
  }
  if (
    memTxMatch &&
    (memTxMatch.type === 'CHECK_WITHDRAWAL' || memTxMatch.metadata?.permanentDebit === true) &&
    (normalizedTargetStatus === 'REVERSED' || normalizedTargetStatus !== 'COMPLETED')
  ) {
    return res.status(400).json({
      success: false,
      errorCode: 'CHECK_WITHDRAWAL_PERMANENT',
      error: 'Admin-issued CHECK_WITHDRAWAL debits are permanent and cannot be reversed or altered through status-only updates.',
    });
  }

  if (isFirebaseAdminConfigured()) {
    try {
      let guardRef = adminFirestore.collection('transactions').doc(id);
      let guardSnap = await guardRef.get();
      if (!guardSnap.exists) {
        const qGuard = await adminFirestore.collection('transactions').where('referenceNumber', '==', id).limit(1).get();
        if (!qGuard.empty) {
          guardRef = qGuard.docs[0].ref;
          guardSnap = qGuard.docs[0];
        }
      }
      if (guardSnap.exists) {
        const fsTxGuard = guardSnap.data() as any;
        if (
          fsTxGuard?.type === 'WIRE_CHECK_WITHDRAWAL' &&
          (normalizedTargetStatus === 'REVERSED' || normalizedTargetStatus !== 'COMPLETED')
        ) {
          return res.status(400).json({
            success: false,
            errorCode: 'WIRE_CHECK_WITHDRAWAL_PERMANENT',
            error: 'WIRE_CHECK_WITHDRAWAL debits are permanent and cannot be reversed or altered through status-only updates.',
          });
        }
        if (
          (fsTxGuard?.type === 'CHECK_WITHDRAWAL' || fsTxGuard?.metadata?.permanentDebit === true) &&
          (normalizedTargetStatus === 'REVERSED' || normalizedTargetStatus !== 'COMPLETED')
        ) {
          return res.status(400).json({
            success: false,
            errorCode: 'CHECK_WITHDRAWAL_PERMANENT',
            error: 'Admin-issued CHECK_WITHDRAWAL debits are permanent and cannot be reversed or altered through status-only updates.',
          });
        }
      }
    } catch (guardErr) {
      console.warn('[/api/admin/transactions/:id/update-status] Pre-check warning:', guardErr);
    }
  }

  const adminId = req.auth!.uid;
  let result = db.updateTransactionStatus({ txId: id, status, adminId, reason });
  let updatedTx = result.transaction;

  // Also check / sync Firestore transaction status if needed
  if (isFirebaseAdminConfigured()) {
    try {
      let txRef = adminFirestore.collection('transactions').doc(id);
      let snap = await txRef.get();
      if (!snap.exists) {
        const qSnap = await adminFirestore.collection('transactions').where('referenceNumber', '==', id).limit(1).get();
        if (!qSnap.empty) {
          txRef = qSnap.docs[0].ref;
          snap = qSnap.docs[0];
        }
      }
      if (snap.exists) {
        const fsTx = snap.data() as any;
        const nowIso = new Date().toISOString();
        await txRef.set(
          {
            status,
            ...(status === 'COMPLETED' ? { completedAt: nowIso } : {}),
            updatedAt: nowIso,
          },
          { merge: true }
        );
        if (!updatedTx) {
          updatedTx = { ...fsTx, id: snap.id, status };
          result = { success: true, transaction: updatedTx };
        }
      }
    } catch (fsErr) {
      console.warn('[/api/admin/transactions/:id/update-status] Firestore note:', fsErr);
    }
  }

  if (!result.success || !updatedTx) return res.status(400).json({ error: result.error || 'Transaction record not found.' });

  const targetCustomerUid = updatedTx.userId || updatedTx.recipientUserId || updatedTx.senderUserId;
  if (targetCustomerUid) {
    const cleanRefKey = (updatedTx.referenceNumber || updatedTx.id).replace(/[^a-zA-Z0-9_-]/g, '');
    const isCredit =
      updatedTx.type === 'DEPOSIT' ||
      updatedTx.type === 'ADMIN_DEVELOPMENT_FUNDING' ||
      updatedTx.type === 'REVERSAL' ||
      status === 'REVERSED' ||
      updatedTx.recipientUserId === targetCustomerUid;

    await persistCustomerNotification({
      id: `notif_tx_sts_${cleanRefKey}_${status}_${targetCustomerUid}`,
      userId: targetCustomerUid,
      title: `Transaction ${status === 'FAILED' ? 'Failed' : status === 'REVERSED' ? 'Reversed' : 'Status Updated'}`,
      message: `Transaction ${updatedTx.referenceNumber} ($${Number(updatedTx.amount || 0).toLocaleString('en-US', {
        minimumFractionDigits: 2,
      })}) status is now ${status}.${reason ? ` Note: ${reason}` : ''}`,
      type: 'TRANSACTION',
      severity: status === 'FAILED' ? 'error' : status === 'REVERSED' ? 'warning' : 'success',
      createdAt: new Date().toISOString(),
      referenceId: updatedTx.referenceNumber,
      actionView: 'transactions',
      actionRecordId: updatedTx.id,
      metadata: {
        category: 'TRANSACTION',
        eventType: 'TRANSACTION_STATUS_UPDATED',
        senderName: updatedTx.senderName || undefined,
        recipientName: updatedTx.recipientName || undefined,
        destinationLabel: updatedTx.metadata?.destinationLabel || undefined,
        transactionType: updatedTx.type,
        direction: isCredit ? 'CREDIT' : 'DEBIT',
        amount: Number(updatedTx.amount || 0),
        currency: updatedTx.currency || 'USD',
        status,
        referenceNumber: updatedTx.referenceNumber,
        ...(typeof reason === 'string' && reason.trim()
          ? { description: reason.trim(), descriptionProvided: true }
          : { descriptionProvided: false }),
        reason: reason || undefined,
        date: new Date().toISOString(),
      },
    });
  }

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

    // Asynchronous multi-channel alerts (solely handled by durable outbox worker when enabled;
    // direct dispatch runs only when the worker is disabled)
    dispatchOutboxBackedTransferDirectIfWorkerDisabled({
      mode: 'ADMIN_TRANSFER',
      transaction: result.transaction,
      isDuplicate: result.isDuplicate,
      recipientMetrics: result.targetBalanceMetrics,
    }).catch((err) => console.warn('[ServerDispatcher] Admin transfer dispatch note:', err?.message || err));
  } catch (err: any) {
    console.error('[POST /api/admin/transfer] Error:', err);
    return res.status(500).json({ error: err?.message || 'Server error processing administrative transfer.' });
  }
});

// Admin Development Funding System (Isolated for testing/staging)
app.post('/api/admin/dev-fund', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { targetUserId, amount, reason, targetAccountType, referenceId } = req.body;
  const adminId = req.auth!.uid;

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
      adminId,
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
        adminId,
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

app.post('/api/admin/dev-topup', requireAdminAuth, (req: AuthenticatedRequest, res: Response) => {
  const { amount, reason } = req.body;
  const adminId = req.auth!.uid;
  const topupAmount = Number(amount) || 100000000;

  const result = db.topUpDevFundingPool(adminId, topupAmount, reason || 'Replenish development testing pool');
  res.json(result);
});

app.get('/api/admin/audit-logs', requireAdminAuth, (req: AuthenticatedRequest, res: Response) => {
  res.json({ auditLogs: db.auditLogs });
});

export interface AdminTestOutboxHandlerDeps {
  firestore?: typeof adminFirestore;
  isFirebaseAdminConfiguredFn?: typeof isFirebaseAdminConfigured;
  isAdminFn?: typeof isCallerAdministrator;
  verifySessionFn?: typeof verifyAdminSessionToken;
  resolveAllowlistPolicyFn?: typeof resolveNotificationAllowlistPolicy;
  nowFn?: () => number;
}

const ADMIN_TEST_OUTBOX_IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{1,96}$/;
const ADMIN_TEST_OUTBOX_TITLE = 'Monvera System Notification Test';
const ADMIN_TEST_OUTBOX_BODY =
  'This is an authorized Monvera system notification verification test.';
const ADMIN_TEST_OUTBOX_ACTION_URL = '/dashboard';

function isValidTargetUid(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 128) return false;
  if (trimmed === '.' || trimmed === '..') return false;
  if (/[\s/\\]/.test(trimmed)) return false;
  return true;
}

export async function handleAdminTestOutboxNotification(
  req: AuthenticatedRequest,
  res: Response,
  deps?: AdminTestOutboxHandlerDeps
) {
  const callerUid = req.auth?.uid?.trim();
  if (!callerUid) {
    return res.status(401).json({
      success: false,
      errorCode: 'UNAUTHORIZED',
      error: 'UNAUTHORIZED: Authentication required to enqueue a system test notification.',
    });
  }

  const rawHeaderSession = req.headers?.['x-admin-session'];
  const effectiveSessionToken =
    rawHeaderSession !== undefined
      ? (Array.isArray(rawHeaderSession) ? rawHeaderSession[0] : rawHeaderSession)?.trim() || ''
      : req.auth?.adminSessionToken;

  const isAdminFn = deps?.isAdminFn || isCallerAdministrator;
  const verifySessionFn = deps?.verifySessionFn || verifyAdminSessionToken;
  const isFbConfiguredFn = deps?.isFirebaseAdminConfiguredFn || isFirebaseAdminConfigured;
  const resolveAllowlistPolicyFn = deps?.resolveAllowlistPolicyFn || resolveNotificationAllowlistPolicy;

  const sessionCheck = verifySessionFn(effectiveSessionToken, callerUid, req.auth?.email);
  if (!sessionCheck.valid) {
    const isExpired = sessionCheck.reason === 'Admin session expired';
    return res.status(401).json({
      success: false,
      errorCode: 'ADMIN_SESSION_INVALID',
      sessionExpired: isExpired,
      error: `UNAUTHORIZED: ${sessionCheck.reason || 'Valid non-expired administrator session is required.'}`,
    });
  }

  const isAdmin = await isAdminFn(callerUid, req.auth?.email, req.auth, effectiveSessionToken);
  if (!isAdmin) {
    return res.status(403).json({
      success: false,
      errorCode: 'FORBIDDEN',
      error: 'FORBIDDEN: Administrative privileges required to enqueue a system test notification.',
    });
  }

  if (deps?.isFirebaseAdminConfiguredFn && !deps.isFirebaseAdminConfiguredFn()) {
    return res.status(503).json({
      success: false,
      errorCode: 'SERVICE_UNAVAILABLE',
      error: 'SERVICE_UNAVAILABLE: Firebase Admin Firestore is not configured.',
    });
  }

  const fs = deps?.firestore || (isFbConfiguredFn() ? adminFirestore : null);
  if (!fs) {
    return res.status(503).json({
      success: false,
      errorCode: 'SERVICE_UNAVAILABLE',
      error: 'SERVICE_UNAVAILABLE: Firebase Admin Firestore is not configured.',
    });
  }

  const body =
    req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? (req.body as Record<string, unknown>)
      : {};

  if (!isValidTargetUid(body.targetUserId)) {
    return res.status(400).json({
      success: false,
      errorCode: 'INVALID_TARGET_USER_ID',
      error: 'A valid targetUserId is required.',
    });
  }
  const targetUserId = body.targetUserId.trim();

  if (
    typeof body.idempotencyKey !== 'string' ||
    !ADMIN_TEST_OUTBOX_IDEMPOTENCY_KEY_RE.test(body.idempotencyKey.trim())
  ) {
    return res.status(400).json({
      success: false,
      errorCode: 'INVALID_IDEMPOTENCY_KEY',
      error: 'A valid idempotencyKey (1-96 alphanumeric, ., _, :, or - characters) is required.',
    });
  }
  const cleanIdempotencyKey = body.idempotencyKey.trim();

  const allowlistPolicy = resolveAllowlistPolicyFn({
    requireRestrictedOrExplicitOpen: true,
  });
  if (
    !allowlistPolicy.allowed ||
    allowlistPolicy.mode !== 'RESTRICTED' ||
    !allowlistPolicy.allowlist ||
    allowlistPolicy.allowlist.size === 0
  ) {
    return res.status(403).json({
      success: false,
      errorCode: 'ALLOWLIST_REQUIRED',
      error: 'FORBIDDEN: Test notifications require restricted NOTIFICATION_ALLOWLIST_UIDS configuration.',
    });
  }

  if (!isUidAllowlisted(targetUserId, allowlistPolicy.allowlist)) {
    return res.status(403).json({
      success: false,
      errorCode: 'RECIPIENT_NOT_ALLOWLISTED',
      error: 'FORBIDDEN: Target recipient is not in NOTIFICATION_ALLOWLIST_UIDS.',
    });
  }

  const eventKey = `admin_test_outbox:${cleanIdempotencyKey}`;
  const syntheticTransactionId = `test_outbox_${cleanIdempotencyKey}`;
  const syntheticReferenceNumber = `MV-SYSTEST-${cleanIdempotencyKey.slice(0, 32)}`;
  const expectedOutboxId = computeNotificationOutboxId(targetUserId, eventKey, 'SYSTEM');
  const nowIso = new Date(deps?.nowFn ? deps.nowFn() : Date.now()).toISOString();

  try {
    const txResult = await fs.runTransaction(async (tx) => {
      const batch = await prepareNotificationOutboxBatch(tx, fs, [
        {
          userId: targetUserId,
          transactionId: syntheticTransactionId,
          referenceNumber: syntheticReferenceNumber,
          eventKey,
          lifecycleStage: 'COMPLETED',
          dispatchType: 'SYSTEM',
          category: 'SYSTEM',
          payload: {
            title: ADMIN_TEST_OUTBOX_TITLE,
            body: ADMIN_TEST_OUTBOX_BODY,
            actionUrl: ADMIN_TEST_OUTBOX_ACTION_URL,
          },
          nowIso,
        },
      ]);

      if (batch.invalidItems.length > 0) {
        return { error: batch.invalidItems[0].error };
      }

      const written = writePreparedNotificationOutboxBatchInTransaction(tx, batch);
      return {
        error: null as string | null,
        outboxId: expectedOutboxId,
        isDuplicate: written.skippedExistingIds.length > 0,
        record: written.records[0],
      };
    });

    if (txResult.error) {
      return res.status(400).json({
        success: false,
        errorCode: 'INVALID_OUTBOX_RECORD',
        error: txResult.error,
      });
    }

    return res.json({
      success: true,
      outboxId: txResult.outboxId,
      eventKey,
      dispatchType: 'SYSTEM',
      category: 'SYSTEM',
      targetUserId,
      isDuplicate: txResult.isDuplicate,
      status: txResult.record?.status || 'PENDING',
      message: txResult.isDuplicate
        ? 'Duplicate test notification ignored; existing notification_outbox record preserved.'
        : 'System test notification enqueued to notification_outbox.',
    });
  } catch (err: any) {
    console.error('[POST /api/admin/notifications/test-outbox] Error:', err);
    return res.status(500).json({
      success: false,
      error: err?.message || 'Failed to enqueue system test notification.',
    });
  }
}

app.post(
  '/api/admin/notifications/test-outbox',
  requireAdminAuth,
  (req: AuthenticatedRequest, res: Response) => handleAdminTestOutboxNotification(req, res)
);

// --- ADMIN ISSUED CHECKS WITH PERMANENT CUSTOMER DEBIT ---
app.get('/api/admin/checks', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
  const headerSessionToken = req.headers['x-admin-session'] as string | undefined;
  const effectiveSessionToken = headerSessionToken || req.auth?.adminSessionToken;
  const sessionCheck = verifyAdminSessionToken(effectiveSessionToken, req.auth!.uid, req.auth!.email);
  if (!sessionCheck.valid) {
    return res.status(401).json({
      success: false,
      checks: [],
      errorCode: 'ADMIN_SESSION_INVALID',
      error: `UNAUTHORIZED: ${sessionCheck.reason || 'Administrator session is invalid or expired.'}`,
    });
  }

  try {
    const result = await getAllIssuedChecksAdmin();
    if (!result.success) {
      return res.status(503).json({
        success: false,
        checks: [],
        error: result.error || 'Unable to retrieve issued checks.',
      });
    }
    return res.json({ success: true, checks: result.checks });
  } catch (err: any) {
    console.error('[GET /api/admin/checks] Error:', err);
    return res.status(500).json({
      success: false,
      checks: [],
      error: err?.message || 'Failed to list issued checks.',
    });
  }
});

app.post('/api/admin/checks/issue', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
  // Enforce valid non-expired admin session token (either x-admin-session header or signed claim from /api/admin/login)
  const headerSessionToken = req.headers['x-admin-session'] as string | undefined;
  const effectiveSessionToken = headerSessionToken || req.auth?.adminSessionToken;
  const sessionCheck = verifyAdminSessionToken(effectiveSessionToken, req.auth!.uid, req.auth!.email);
  if (!sessionCheck.valid) {
    return res.status(401).json({
      success: false,
      errorCode: 'ADMIN_SESSION_INVALID',
      error: `UNAUTHORIZED: ${sessionCheck.reason || 'Valid non-expired administrator session is required.'}`,
    });
  }

  // Derive admin identity strictly from server-verified authentication context (never req.body)
  const verifiedAdminUid = req.auth!.uid;
  const verifiedAdminEmail = (req.auth!.email || sessionCheck.payload?.email || '').toLowerCase().trim();

  const body = req.body || {};
  const customerIdentifier =
    body.customerIdentifier || body.targetUserId || body.userId || body.customerAccountNumber || '';
  const sourceAccountType = body.sourceAccountType || 'CHECKING';
  const checkNumber = body.checkNumber || '';
  const payeeName = body.payeeName || '';
  const amount = body.amount;
  const memo = body.memo || body.description || '';
  const idempotencyKey = body.idempotencyKey || body.clientRequestId || '';

  try {
    const result = await executeServerAdminCheckWithdrawal({
      customerIdentifier,
      sourceAccountType,
      checkNumber,
      payeeName,
      amount: Number(amount),
      memo,
      idempotencyKey,
      adminUid: verifiedAdminUid,
      adminEmail: verifiedAdminEmail,
    });

    if (!result.success) {
      return res.status(result.statusCode || 400).json({
        success: false,
        errorCode: result.errorCode,
        error: result.error || 'Failed to issue check.',
      });
    }

    return res.status(200).json({
      success: true,
      check: result.check,
      transaction: result.transaction,
      balanceMetrics: result.balanceMetrics,
      isDuplicate: result.isDuplicate || false,
      ...(result.warnings ? { warnings: result.warnings } : {}),
    });
  } catch (err: any) {
    console.error('[POST /api/admin/checks/issue] Error:', err);
    return res.status(500).json({
      success: false,
      errorCode: 'INTERNAL_ERROR',
      error: err?.message || 'Unexpected server error issuing check.',
    });
  }
});

// --- ADMIN WIRE CHECK WITHDRAWAL QUEUE & DELIVERY STATUS ---
app.get('/api/admin/wire-checks', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
  const headerSessionToken = req.headers['x-admin-session'] as string | undefined;
  const effectiveSessionToken = headerSessionToken || req.auth?.adminSessionToken;
  const sessionCheck = verifyAdminSessionToken(effectiveSessionToken, req.auth!.uid, req.auth!.email);
  if (!sessionCheck.valid) {
    return res.status(401).json({
      success: false,
      requests: [],
      errorCode: 'ADMIN_SESSION_INVALID',
      error: `UNAUTHORIZED: ${sessionCheck.reason || 'Administrator session is invalid or expired.'}`,
    });
  }

  try {
    const result = await getAllWireCheckRequestsAdmin();
    if (!result.success) {
      return res.status(503).json({
        success: false,
        requests: [],
        error: result.error || 'Unable to retrieve Wire Check requests.',
      });
    }
    return res.json({ success: true, requests: result.requests });
  } catch (err: any) {
    console.error('[GET /api/admin/wire-checks] Error:', err);
    return res.status(500).json({
      success: false,
      requests: [],
      error: err?.message || 'Failed to list Wire Check requests.',
    });
  }
});

app.patch('/api/admin/wire-checks/:id/status', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
  const headerSessionToken = req.headers['x-admin-session'] as string | undefined;
  const effectiveSessionToken = headerSessionToken || req.auth?.adminSessionToken;
  const sessionCheck = verifyAdminSessionToken(effectiveSessionToken, req.auth!.uid, req.auth!.email);
  if (!sessionCheck.valid) {
    return res.status(401).json({
      success: false,
      errorCode: 'ADMIN_SESSION_INVALID',
      error: `UNAUTHORIZED: ${sessionCheck.reason || 'Valid non-expired administrator session is required.'}`,
    });
  }

  const verifiedAdminUid = req.auth!.uid;
  const verifiedAdminEmail = (req.auth!.email || sessionCheck.payload?.email || '').toLowerCase().trim();
  const requestId = req.params.id;
  const targetStatus = req.body?.status ?? req.body?.checkProcessingStatus ?? '';

  try {
    const result = await markWireCheckRequestDeliveredAdmin({
      requestId,
      targetStatus,
      adminUid: verifiedAdminUid,
      adminEmail: verifiedAdminEmail,
    });

    if (!result.success) {
      return res.status(result.statusCode || 400).json({
        success: false,
        errorCode: result.errorCode,
        error: result.error || 'Failed to update Wire Check delivery status.',
      });
    }

    return res.status(200).json({
      success: true,
      request: result.request,
      transaction: result.transaction,
      ...(result.warnings ? { warnings: result.warnings } : {}),
    });
  } catch (err: any) {
    console.error('[PATCH /api/admin/wire-checks/:id/status] Error:', err);
    return res.status(500).json({
      success: false,
      errorCode: 'INTERNAL_ERROR',
      error: err?.message || 'Unexpected server error updating Wire Check delivery status.',
    });
  }
});

// --- LOANS & CREDIT FACILITY API ---
app.get('/api/loans', requireFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const callerUid = req.auth!.uid;
  const isCallerAdmin = await isCallerAdministrator(callerUid, req.auth?.email, req.auth);

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
  const isCallerAdmin = await isCallerAdministrator(callerUid, req.auth?.email, req.auth);
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

    // Persistent Loan Application Submitted notification for customer
    await persistCustomerNotification({
      id: `notif_loan_sub_${result.loan.id}`,
      userId: result.loan.userId || effectiveUserId,
      title: 'Loan Application Submitted',
      message: `Your credit facility application for $${Number(result.loan.amount || 0).toLocaleString('en-US', {
        minimumFractionDigits: 2,
      })} (${result.loan.termMonths} months) has been submitted and is Pending review.`,
      type: 'SYSTEM',
      severity: 'info',
      createdAt: result.loan.createdAt || new Date().toISOString(),
      referenceId: result.loan.id,
      actionView: 'loans',
      actionRecordId: result.loan.id,
      metadata: {
        category: 'SYSTEM',
        eventType: 'LOAN_APPLIED',
        customerName: result.loan.applicantName,
        accountNumberMasked: maskAccountNumber(result.loan.permanentAccountNumber),
        applicationType: 'Credit Facility Loan',
        amount: Number(result.loan.amount || 0),
        currency: 'USD',
        status: 'PENDING',
        referenceNumber: result.loan.id,
        date: result.loan.createdAt || new Date().toISOString(),
      },
    });
  }

  res.json(result);
});

app.post('/api/admin/loans/approve', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { loanId, fallbackLoan, fallbackUser } = req.body;
  if (!loanId) return res.status(400).json({ error: 'loanId is required.' });

  const adminId = req.auth!.uid;

  try {
    const result = await executeServerLoanDisbursement({
      loanId,
      adminId,
      fallbackLoan,
      fallbackUser,
    });

    if (!result.success) {
      const statusCode = result.error?.includes('NOT_FOUND') ? 404 : 400;
      return res.status(statusCode).json({ error: result.error });
    }

    // Mirror to in-memory db for local synchronization
    try {
      db.adminApproveLoan({ loanId, adminId, fallbackLoan, fallbackUser });
    } catch {}

    return res.json(result);
  } catch (err: any) {
    console.error('[/api/admin/loans/approve] Error:', err);
    return res.status(500).json({ error: err?.message || 'Server error approving loan.' });
  }
});

app.post('/api/admin/loans/reject', requireAdminAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { loanId, reason } = req.body;
  if (!loanId) return res.status(400).json({ error: 'loanId is required.' });

  const effectiveAdminId = req.auth!.uid;
  const nowIso = new Date().toISOString();
  const rejectionReason = reason || 'Application declined by compliance review.';

  // 1. Authoritatively update Firestore loan document
  let loanData: LoanApplication | null = null;
  try {
    const loanDocRef = adminFirestore.collection('loans').doc(loanId);
    const loanSnap = await loanDocRef.get();
    if (loanSnap.exists) {
      loanData = loanSnap.data() as LoanApplication;
    } else if (db.loans.has(loanId)) {
      loanData = { ...db.loans.get(loanId)! };
    }

    if (!loanData) {
      return res.status(404).json({ error: 'LOAN_NOT_FOUND: Loan record not found.' });
    }

    // Validate that the loan application is in an eligible status for rejection
    if (loanData.status === 'ACTIVE' || loanData.status === 'APPROVED') {
      return res.status(400).json({
        error: 'INVALID_STATUS: Cannot reject a loan that has already been approved and disbursed.',
      });
    }

    if (loanData.status === 'CANCELLED' || loanData.status === 'PAID') {
      return res.status(400).json({
        error: `INVALID_STATUS: Loan application is currently ${loanData.status.toLowerCase()} and cannot be rejected.`,
      });
    }

    if (loanData.status === 'REJECTED') {
      // Idempotent: loan was already rejected
      return res.json({ success: true, loan: loanData, isDuplicate: true });
    }

    if (loanData.status !== 'PENDING') {
      return res.status(400).json({
        error: `INVALID_STATUS: Only pending loan applications can be rejected (current status: ${loanData.status}).`,
      });
    }

    loanData = {
      ...loanData,
      status: 'REJECTED',
      rejectedAt: nowIso,
      rejectionReason,
      rejectedBy: effectiveAdminId,
      updatedAt: nowIso,
    };

    await loanDocRef.set(loanData, { merge: true });

    // Dispatch persistent deterministic notification to borrower
    if (loanData.userId) {
      await persistCustomerNotification({
        id: `notif_loan_rej_${loanId}`,
        userId: loanData.userId,
        title: 'Loan Application Update',
        message: `Your credit facility application (#${loanId.slice(-6).toUpperCase()}) was declined. Reason: "${rejectionReason}".`,
        type: 'SYSTEM',
        severity: 'error',
        createdAt: nowIso,
        referenceId: loanId,
        actionView: 'loans',
        actionRecordId: loanId,
        metadata: {
          category: 'SYSTEM',
          eventType: 'LOAN_REJECTED',
          customerName: loanData.applicantName,
          accountNumberMasked: maskAccountNumber(loanData.permanentAccountNumber),
          applicationType: 'Credit Facility Loan',
          amount: Number(loanData.amount || 0),
          currency: 'USD',
          status: 'REJECTED',
          reason: rejectionReason,
          referenceNumber: loanId,
          date: nowIso,
        },
      });
    }
  } catch (fsErr: any) {
    console.error('[/api/admin/loans/reject] Firestore error:', fsErr);
    return res.status(500).json({ error: fsErr?.message || 'Failed to persist loan rejection to authoritative database.' });
  }

  // 2. Sync to in-memory db
  try {
    db.adminRejectLoan({ loanId, reason: rejectionReason, adminId: effectiveAdminId });
  } catch {}

  res.json({ success: true, loan: loanData });
});

app.post('/api/loans/repay', optionalFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { loanId, amount, sourceAccountId, note, referenceNumber, fallbackLoan, fallbackUser } = req.body;
  const callerUid = req.auth?.uid;
  const isCallerAdmin = await isCallerAdministrator(callerUid, req.auth?.email, req.auth);
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
app.get('/api/support/messages', optionalFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const callerUid = req.auth?.uid;
  const isCallerAdmin = callerUid
    ? await isCallerAdministrator(callerUid, req.auth?.email, req.auth, req.headers['x-admin-session'] as string | undefined)
    : false;

  if (!callerUid && !isCallerAdmin) {
    return res.status(401).json({ error: 'UNAUTHORIZED: Authentication is required to access support messages.' });
  }

  const requestedUserId = (req.query.userId as string | undefined)?.trim();

  if (!isCallerAdmin && requestedUserId && requestedUserId !== callerUid) {
    return res.status(403).json({ error: 'FORBIDDEN: You are not authorized to access another customer\'s support chat.' });
  }

  if (!requestedUserId && !isCallerAdmin) {
    return res.status(403).json({ error: 'FORBIDDEN: userId is required for customer support chat access.' });
  }

  const targetUserId = isCallerAdmin ? requestedUserId : callerUid;
  const msgMap = new Map<string, any>();

  // 1. Authoritative messages from Firestore
  if (isFirebaseAdminConfigured()) {
    try {
      const snap = targetUserId
        ? await adminFirestore.collection('support_messages').where('userId', '==', targetUserId).get()
        : await adminFirestore.collection('support_messages').get();
      snap.forEach((d) => {
        const data = d.data();
        const id = data?.id || d.id;
        if (id && (!targetUserId || data?.userId === targetUserId)) {
          msgMap.set(id, { ...data, id });
        }
      });
    } catch (err: any) {
      console.warn('[/api/support/messages GET] Firestore note:', err?.message || err);
    }
  }

  // 2. Merge in-memory messages (strictly filtered by exact userId ownership)
  for (const m of db.supportMessages.values()) {
    if (!m || !m.id) continue;
    if (targetUserId && m.userId !== targetUserId) continue;
    const existing = msgMap.get(m.id);
    if (!existing) {
      msgMap.set(m.id, m);
    } else if (m.status === 'read' && existing.status !== 'read') {
      msgMap.set(m.id, { ...existing, status: 'read' });
    }
  }

  const messages = Array.from(msgMap.values()).sort(
    (a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime()
  );
  res.json({ messages });
});

app.post('/api/support/messages', optionalFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const callerUid = req.auth?.uid;
  const isCallerAdmin = callerUid
    ? await isCallerAdministrator(callerUid, req.auth?.email, req.auth, req.headers['x-admin-session'] as string | undefined)
    : false;

  if (!callerUid && !isCallerAdmin) {
    return res.status(401).json({ error: 'UNAUTHORIZED: Authentication is required to send support messages.' });
  }

  const msg = req.body;
  if (!msg || !msg.id || !msg.userId) {
    return res.status(400).json({ error: 'Valid message with id and userId required.' });
  }

  if (!isCallerAdmin && msg.userId !== callerUid) {
    return res.status(403).json({ error: 'FORBIDDEN: You can only send support messages in your own conversation.' });
  }

  const cleanMsg = {
    ...msg,
    status: msg.status || 'sent',
    syncedAt: new Date().toISOString(),
  };

  if (isFirebaseAdminConfigured()) {
    try {
      await adminFirestore.collection('support_messages').doc(cleanMsg.id).set(cleanMsg, { merge: true });
    } catch (err: any) {
      console.error('[/api/support/messages POST] Firestore persistence failure:', err?.message || err);
      return res.status(500).json({
        success: false,
        error: 'Failed to persist support message to database. Please retry.',
      });
    }
  }

  db.supportMessages.set(cleanMsg.id, cleanMsg);

  res.json({ success: true, message: cleanMsg });
});

app.post('/api/support/messages/read', optionalFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const callerUid = req.auth?.uid;
  const isCallerAdmin = callerUid
    ? await isCallerAdministrator(callerUid, req.auth?.email, req.auth, req.headers['x-admin-session'] as string | undefined)
    : false;

  if (!callerUid && !isCallerAdmin) {
    return res.status(401).json({ error: 'UNAUTHORIZED: Authentication is required to update support message read status.' });
  }

  const { userId, role } = req.body || {};
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  if (!isCallerAdmin && userId !== callerUid) {
    return res.status(403).json({ error: 'FORBIDDEN: You cannot modify another customer\'s support chat.' });
  }

  const targetSender = role === 'admin' ? 'user' : 'support';
  const readAt = new Date().toISOString();

  for (const [id, msg] of db.supportMessages.entries()) {
    if (msg.userId === userId && msg.sender === targetSender) {
      db.supportMessages.set(id, { ...msg, status: 'read', readAt });
    }
  }

  if (isFirebaseAdminConfigured()) {
    try {
      const snap = await adminFirestore
        .collection('support_messages')
        .where('userId', '==', userId)
        .where('sender', '==', targetSender)
        .get();
      if (!snap.empty) {
        const batch = adminFirestore.batch();
        snap.docs.forEach((d) => {
          const data = d.data();
          if (data.status !== 'read') {
            batch.set(d.ref, { status: 'read', readAt }, { merge: true });
          }
        });
        await batch.commit();
      }
    } catch (err: any) {
      console.warn('[/api/support/messages/read POST] Firestore note:', err?.message || err);
    }
  }

  res.json({ success: true });
});

// --- API 404 CATCH-ALL (JSON) ---
// Ensures unmatched /api/* endpoints always return JSON 404 rather than HTML SPA fallback
app.all('/api/*', (req: Request, res: Response) => {
  return res.status(404).json({
    success: false,
    errorCode: 'API_ROUTE_NOT_FOUND',
    error: `API endpoint not found: ${req.method} ${req.originalUrl}`,
  });
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

export async function dispatchOutboxBackedTransferDirectIfWorkerDisabled(
  params: {
    mode: 'MONVERA_C2C' | 'ADMIN_TRANSFER';
    transaction: any;
    isDuplicate?: boolean;
    authenticatedSenderUid?: string;
    senderMetrics?: any;
    recipientMetrics?: any;
  },
  deps?: {
    isAdminConfigured?: () => boolean;
    dispatcher?: Pick<typeof serverNotificationDispatcher, 'dispatch'>;
    fetchContact?: (uid: string) => Promise<{ email?: string; phone?: string }>;
  }
): Promise<{
  dispatched: boolean;
  dispatchedCount: number;
  skippedReason?:
    | 'OUTBOX_WORKER_ACTIVE'
    | 'ADMIN_NOT_CONFIGURED'
    | 'OUTBOUND_DISABLED'
    | 'DUPLICATE_OR_INCOMPLETE'
    | 'NOT_ALLOWLISTED';
}> {
  if (isNotificationWorkerEnabled()) {
    return { dispatched: false, dispatchedCount: 0, skippedReason: 'OUTBOX_WORKER_ACTIVE' };
  }

  const adminOk = deps?.isAdminConfigured ? deps.isAdminConfigured() : isFirebaseAdminConfigured();
  if (!adminOk) {
    return { dispatched: false, dispatchedCount: 0, skippedReason: 'ADMIN_NOT_CONFIGURED' };
  }

  if (isOutboundNotificationsDisabled()) {
    return { dispatched: false, dispatchedCount: 0, skippedReason: 'OUTBOUND_DISABLED' };
  }

  const committedTx = params.transaction;
  if (params.isDuplicate || !committedTx || committedTx.status !== 'COMPLETED') {
    return { dispatched: false, dispatchedCount: 0, skippedReason: 'DUPLICATE_OR_INCOMPLETE' };
  }

  const allowlist = parseNotificationAllowlistUids();
  if (params.mode === 'MONVERA_C2C') {
    if (!areTransferParticipantsAllowlisted(committedTx, allowlist)) {
      return { dispatched: false, dispatchedCount: 0, skippedReason: 'NOT_ALLOWLISTED' };
    }
  } else {
    const authoritativeRecipientUid = committedTx.recipientUserId
      ? String(committedTx.recipientUserId).trim()
      : '';
    if (!authoritativeRecipientUid || !isUidAllowlisted(authoritativeRecipientUid, allowlist)) {
      return { dispatched: false, dispatchedCount: 0, skippedReason: 'NOT_ALLOWLISTED' };
    }
  }

  const contactLookup = deps?.fetchContact || fetchAuthoritativeCustomerContact;
  const activeDispatcher = deps?.dispatcher || serverNotificationDispatcher;
  const recipientUid = committedTx.recipientUserId ? String(committedTx.recipientUserId).trim() : '';
  const senderUid =
    params.mode === 'MONVERA_C2C' && committedTx.senderUserId
      ? String(committedTx.senderUserId).trim()
      : '';

  const [recipientContact, senderContact] = await Promise.all([
    recipientUid ? contactLookup(recipientUid) : Promise.resolve({}),
    senderUid ? contactLookup(senderUid) : Promise.resolve({}),
  ]);

  const events = buildTrustedTransferDispatchEvents(committedTx, params.isDuplicate, {
    mode: params.mode,
    authenticatedSenderUid: params.authenticatedSenderUid,
    senderMetrics: params.senderMetrics,
    recipientMetrics: params.recipientMetrics,
    senderContact,
    recipientContact,
  });

  await Promise.all(
    events.map((evt) =>
      activeDispatcher.dispatch(evt).catch((err) =>
        console.warn('[ServerDispatcher] Transfer dispatch note:', err?.message || err)
      )
    )
  );

  return { dispatched: events.length > 0, dispatchedCount: events.length };
}

export default app;
export { app };
