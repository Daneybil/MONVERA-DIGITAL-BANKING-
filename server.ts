import 'dotenv/config';
import express, { Request, Response } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { db } from './server/db';
import { serverNotificationDispatcher } from './server/services/notificationDispatcher';
import { UserProfile, InvestmentTermDays, LoanApplication, AdminSystemOverview } from './src/types';
import { getStripe, isStripeConfigured } from './server/stripe';
import { requireFirebaseAuth, optionalFirebaseAuth, requireAdminAuth, isCallerAdministrator, AuthenticatedRequest } from './server/authMiddleware';
import { adminFirestore, isFirebaseAdminConfigured } from './server/firebaseAdmin';
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
  executeServerCardIssuance,
  executeServerPendingWithdrawalReversals,
  reverseServerFirestoreWithdrawal,
  checkUserHasOutstandingLoan,
  resolveRecipientUser,
} from './server/firestoreTransactions';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// CORS & Preflight handling for browser clients
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
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
  const isOwner = callerUid && callerUid === userId;
  const isAdmin = await isCallerAdministrator(callerUid, req.auth?.email, req.auth);

  if (!isOwner && !isAdmin) {
    return res.status(403).json({ error: 'FORBIDDEN: You do not have permission to view this customer document.' });
  }

  try {
    const docSnap = await adminFirestore
      .collection('users')
      .doc(userId)
      .collection('kyc_documents')
      .doc(docType)
      .get();

    if (docSnap.exists) {
      const docData = docSnap.data()!;
      return res.json({ success: true, docType, imageBase64: docData.imageBase64, uploadedAt: docData.uploadedAt });
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
        return res.json({ success: true, docType, imageBase64: legacyImg, legacy: true });
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

    // Store document image references/URIs in top-level document
    if (documentImage) profileUpdate.kycDocumentImage = documentImage;
    if (documentBackImage) profileUpdate.kycDocumentBackImage = documentBackImage;
    if (proofOfAddressImage) profileUpdate.kycProofOfAddressImage = proofOfAddressImage;
    if (liveSelfieImage) profileUpdate.kycLiveSelfieImage = liveSelfieImage;
    if (ssnImage) profileUpdate.kycSsnImage = ssnImage;

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

  // Create audit log & notification
  serverNotificationDispatcher.dispatchNotification(userId, {
    title: 'KYC Verification Approved by Compliance',
    message: 'Your banking profile has been officially verified by Monvera Compliance Operations. Full account limits ($1,000,000/day) and verified status are active.',
    type: 'SECURITY',
    severity: 'success',
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
app.get('/api/accounts/balance', async (req: Request, res: Response) => {
  const userId = req.query.userId as string;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  if (!isFirebaseAdminConfigured()) {
    return res.status(503).json({
      error: 'Authoritative account balances temporarily unavailable: Firebase Admin credentials not configured on backend.',
      code: 'FIRESTORE_NOT_CONFIGURED',
    });
  }

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
});

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
  const isCallerAdmin = await isCallerAdministrator(callerUid, req.auth?.email, req.auth);
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
  const isCallerAdmin = await isCallerAdministrator(callerUid, req.auth?.email, req.auth);
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
  const isCallerAdmin = await isCallerAdministrator(callerUid, req.auth?.email, req.auth);
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
      const isCallerAdmin = await isCallerAdministrator(callerUid, req.auth?.email, req.auth);
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
app.post('/api/withdrawals/reverse', optionalFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { transactionId, userId: reqUserId } = req.body;
  const callerUid = req.auth?.uid;
  if (!transactionId) {
    return res.status(400).json({ error: 'Transaction ID is required.' });
  }

  const isCallerAdmin = await isCallerAdministrator(callerUid, req.auth?.email, req.auth);
  const targetUserId = (callerUid && !isCallerAdmin) ? callerUid : (reqUserId || callerUid);

  // Attempt server-authoritative Firestore reversal
  const fsResult = await reverseServerFirestoreWithdrawal(transactionId, targetUserId);
  if (fsResult.success) {
    return res.json({ success: true, transaction: fsResult.transaction, balanceMetrics: fsResult.balanceMetrics });
  }

  // Fall back to memory store if transaction only existed in memory
  const result = db.reverseWithdrawal(transactionId);
  if (!result.success) {
    return res.status(400).json({ error: fsResult.error || result.error });
  }

  const effectiveUserId = targetUserId || result.transaction?.userId || 'usr_eleanor';
  const metrics = db.getUserBalanceMetrics(effectiveUserId);
  res.json({ success: true, transaction: result.transaction, balanceMetrics: metrics });
});

// Targeted 30-minute withdrawal reversal scheduler
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
}

// --- TRANSACTIONS EXPLORER ---
app.get('/api/transactions', optionalFirebaseAuth, async (req: AuthenticatedRequest, res: Response) => {
  const callerUid = req.auth?.uid;
  const isCallerAdmin = await isCallerAdministrator(callerUid, req.auth?.email, req.auth);

  let targetUserId = req.query.userId as string | undefined;

  // Security check: non-administrators can only query their own transactions
  if (!isCallerAdmin) {
    if (!callerUid && !targetUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (callerUid) {
      targetUserId = callerUid;
    }
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
  const isCallerAdmin = await isCallerAdministrator(callerUid, req.auth?.email, req.auth);
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

  // Notification
  try {
    const notifItem = {
      id: `notif_card_${Date.now()}`,
      userId: card.userId,
      title: `Card ${card.status === 'FROZEN' ? 'Frozen' : 'Reactivated'}`,
      message: `Your ${card.cardTier} (•••• ${(card.maskedNumber || card.cardNumber || '0000').slice(-4)}) has been ${
        card.status === 'FROZEN' ? 'locked' : 'unlocked'
      }.`,
      type: 'SECURITY',
      severity: card.status === 'FROZEN' ? 'warning' : 'success',
      read: false,
      createdAt: new Date().toISOString(),
    };
    db.notifications.unshift(notifItem as any);
    await adminFirestore.collection('notifications').doc(notifItem.id).set(notifItem, { merge: true });
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
app.get('/api/admin/verify-session', requireAdminAuth, (req: AuthenticatedRequest, res: Response) => {
  res.json({
    success: true,
    isAdmin: true,
    uid: req.auth!.uid,
    email: req.auth!.email,
  });
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
        const chk = Number(ad.checkingBalance ?? 0);
        const sav = Number(ad.savingsBalance ?? ad.savings ?? 0);
        const inv = Number(ad.investedBalance ?? ad.investmentBalance ?? 0);
        const accrued = Number(ad.accruedEarnings ?? 0);
        const total = Number(ad.totalBalance ?? (chk + sav + inv + accrued));
        const avail = Number(ad.availableBalance ?? chk);
        const loanBal = Number(ad.loanBalance ?? 0);
        const pending = Number(ad.pendingBalance ?? 0);
        const accountsList = ad.accounts || [
          {
            id: `acc_chk_${fu.id}`,
            userId: fu.id,
            type: 'CHECKING',
            accountNumber: cleanAcc || '1000000000',
            routingNumber: '021000021',
            currency: 'USD',
            balance: chk,
            availableBalance: avail,
            investedBalance: inv,
            pendingBalance: pending,
            status: 'ACTIVE',
            nickname: 'Monvera Premier Checking',
          },
          {
            id: `acc_sav_${fu.id}`,
            userId: fu.id,
            type: 'SAVINGS',
            accountNumber: cleanAcc ? `10${cleanAcc.slice(2, -3)}991` : '1000000991',
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
        balanceMetrics = {
          checkingBalance: chk,
          savingsBalance: sav,
          investedBalance: inv,
          accruedEarnings: accrued,
          totalBalance: total,
          availableBalance: avail,
          pendingBalance: pending,
          loanBalance: loanBal,
          accounts: accountsList,
        };
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

    serverNotificationDispatcher.dispatchNotification(userId, {
      title: 'KYC Verification Update: Action Required',
      message: `Your verification application requires correction: "${rejectionReason}". Please review and resubmit in your Profile.`,
      type: 'SECURITY',
      severity: 'warning',
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

    res.json({ success: true, user: { ...userData, ...itemUpdate } });
  } catch (err: any) {
    console.error('[POST /api/admin/kyc/review-item] Error:', err);
    res.status(500).json({ error: err?.message || 'Failed to review KYC item' });
  }
});

// Admin Transaction Status Endpoint
app.post('/api/admin/transactions/:id/update-status', requireAdminAuth, (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { status, reason } = req.body;
  if (!status) return res.status(400).json({ error: 'status is required' });

  const adminId = req.auth!.uid;
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
