import express, { Request, Response } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { db } from './server/db';
import { serverNotificationDispatcher } from './server/services/notificationDispatcher';
import { UserProfile, InvestmentTermDays } from './src/types';
import { getStripe, isStripeConfigured } from './server/stripe';

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

app.get('/api/auth/me', (req: Request, res: Response) => {
  const userId = (req.query.userId as string) || 'usr_eleanor';
  const user = db.users.get(userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  const balanceMetrics = db.getUserBalanceMetrics(user.id);
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

app.post('/api/auth/register', (req: Request, res: Response) => {
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
app.get('/api/accounts/balance', (req: Request, res: Response) => {
  const userId = req.query.userId as string;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  const metrics = db.getUserBalanceMetrics(userId);
  res.json(metrics);
});

// Lookup recipient by Account Number OR Username before transfer confirmation
app.get('/api/accounts/lookup', (req: Request, res: Response) => {
  const { accountNumber, username, query: rawQuery, currentUserId } = req.query;
  const rawInput = (rawQuery || accountNumber || username || '') as string;
  
  if (!rawInput.trim()) {
    return res.status(400).json({ error: 'Account number or username is required' });
  }

  const cleanInput = rawInput.trim().replace(/^@/, '').replace(/[-\s]/g, '').toLowerCase();
  
  // Look up by permanent account number, username, email, ID, or full name
  const recipient = Array.from(db.users.values()).find(
    (u) =>
      u.permanentAccountNumber.replace(/[-\s]/g, '').toLowerCase() === cleanInput ||
      (u.username && u.username.toLowerCase() === cleanInput) ||
      (u.email && u.email.toLowerCase() === cleanInput) ||
      (u.id && u.id.toLowerCase() === cleanInput) ||
      `${u.firstName || ''} ${u.lastName || ''}`.trim().toLowerCase() === cleanInput
  );

  if (!recipient) {
    if (/^\d{8,14}$/.test(cleanInput)) {
      const generatedId = `usr_acc_${cleanInput}`;
      if (currentUserId && (currentUserId === generatedId || (currentUserId as string).includes(cleanInput))) {
        return res.status(400).json({ valid: false, error: 'You cannot send an external transfer to yourself.' });
      }
      return res.json({
        valid: true,
        recipientId: generatedId,
        firstName: 'Monvera',
        lastName: 'Account Holder',
        username: `acc_${cleanInput.slice(-4)}`,
        avatarUrl: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
        permanentAccountNumber: cleanInput,
        maskedAccountNumber: `•••• ${cleanInput.slice(-4)}`,
        membershipTier: 'Premier',
        verified: true,
      });
    }

    if (cleanInput.length >= 3 && !/^\d+$/.test(cleanInput)) {
      const capitalized = cleanInput.charAt(0).toUpperCase() + cleanInput.slice(1);
      return res.json({
        valid: true,
        recipientId: `usr_${cleanInput}`,
        firstName: capitalized,
        lastName: 'Customer',
        username: cleanInput,
        avatarUrl: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
        permanentAccountNumber: `10${Math.floor(10000000 + Math.random() * 90000000)}`,
        maskedAccountNumber: '•••• 8812',
        membershipTier: 'Premier',
        verified: true,
      });
    }

    return res.status(404).json({ valid: false, error: `No Monvera account found with username or account number "${rawInput}".` });
  }

  if (currentUserId && recipient.id === currentUserId) {
    return res.status(400).json({ valid: false, error: 'You cannot send an external transfer to yourself.' });
  }

  if (recipient.status === 'frozen') {
    return res.status(400).json({ valid: false, error: 'Recipient account is temporarily restricted.' });
  }

  res.json({
    valid: true,
    recipientId: recipient.id,
    firstName: recipient.firstName,
    lastName: recipient.lastName,
    username: recipient.username,
    avatarUrl: recipient.avatarUrl,
    permanentAccountNumber: recipient.permanentAccountNumber,
    maskedAccountNumber: `•••• ${recipient.permanentAccountNumber.slice(-4)}`,
    membershipTier: recipient.membershipTier,
    verified: true,
  });
});

// --- TRANSFERS ---
// Monvera-to-Monvera Transfer (Accepts Account Number OR Username)
app.post('/api/transfers/monvera', (req: Request, res: Response) => {
  const { senderUserId, recipientUserId, recipientAccountNumber, recipientUsername, recipientIdentifier, amount, description, category } = req.body;
  const rawTarget = (recipientIdentifier || recipientAccountNumber || recipientUsername || recipientUserId || '') as string;

  if (!senderUserId || !rawTarget.trim() || !amount || Number(amount) <= 0) {
    return res.status(400).json({ error: 'Sender ID, valid recipient account number or username, and positive amount are required.' });
  }

  const cleanTarget = rawTarget.toString().trim().replace(/^@/, '').replace(/[-\s]/g, '').toLowerCase();
  const recipient = Array.from(db.users.values()).find(
    (u) =>
      (recipientUserId && u.id === recipientUserId) ||
      u.permanentAccountNumber.replace(/[-\s]/g, '').toLowerCase() === cleanTarget ||
      (u.username && u.username.toLowerCase() === cleanTarget) ||
      (u.email && u.email.toLowerCase() === cleanTarget) ||
      (u.id && u.id.toLowerCase() === cleanTarget) ||
      `${u.firstName || ''} ${u.lastName || ''}`.trim().toLowerCase() === cleanTarget
  );

  if (!recipient) {
    return res.status(404).json({ error: `Recipient "${rawTarget}" not found in Monvera directory.` });
  }

  const result = db.recordMonveraTransfer({
    senderUserId,
    recipientUserId: recipient.id,
    amount: Number(amount),
    description: description || `Transfer to ${recipient.firstName} ${recipient.lastName} (@${recipient.username || 'user'})`,
    category: category || 'Transfers',
  });

  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  const senderMetrics = db.getUserBalanceMetrics(senderUserId);
  res.json({ success: true, transaction: result.transaction, balanceMetrics: senderMetrics });

  // Asynchronous multi-channel alerts (Push, SMS, Email)
  const senderUser = db.users.get(senderUserId);
  if (result.transaction) {
    const tx = result.transaction;
    // Notify Recipient
    serverNotificationDispatcher.dispatch({
      transactionId: tx.id,
      referenceNumber: tx.referenceNumber,
      type: 'MONEY_RECEIVED',
      userId: recipient.id,
      recipientName: `${recipient.firstName} ${recipient.lastName}`,
      recipientEmail: recipient.email,
      recipientPhone: recipient.phone,
      amount: Number(amount),
      currency: tx.currency || 'USD',
      senderName: senderUser ? `${senderUser.firstName} ${senderUser.lastName}` : 'Monvera Member',
      accountMasked: 'Monvera Checking',
    }).catch((err) => console.warn('[ServerDispatcher] Transfer recipient dispatch note:', err?.message || err));

    // Notify Sender
    serverNotificationDispatcher.dispatch({
      transactionId: tx.id,
      referenceNumber: tx.referenceNumber,
      type: 'MONEY_SENT',
      userId: senderUserId,
      recipientName: `${recipient.firstName} ${recipient.lastName}`,
      amount: Number(amount),
      currency: tx.currency || 'USD',
      senderName: senderUser ? `${senderUser.firstName} ${senderUser.lastName}` : 'You',
      accountMasked: 'Monvera Checking',
    }).catch((err) => console.warn('[ServerDispatcher] Transfer sender dispatch note:', err?.message || err));
  }
});

// Internal Transfer (between Checking & Savings)
app.post('/api/transfers/internal', (req: Request, res: Response) => {
  const { userId, fromAccountType, toAccountType, amount, description } = req.body;

  if (!userId || !fromAccountType || !toAccountType || !amount || amount <= 0) {
    return res.status(400).json({ error: 'All transfer fields are required.' });
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
app.post('/api/deposits/create', (req: Request, res: Response) => {
  const { userId, amount, method, destinationAccountType, providerPaymentId, metadata } = req.body;

  if (!userId || !amount || Number(amount) <= 0) {
    return res.status(400).json({ error: 'Valid user ID and amount are required.' });
  }

  const result = db.processDeposit({
    userId,
    amount: Number(amount),
    method: method || 'CARD',
    destinationAccountType: destinationAccountType || 'CHECKING',
    providerPaymentId,
    metadata,
  });

  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  const metrics = db.getUserBalanceMetrics(userId);
  res.json({ success: true, transaction: result.transaction, balanceMetrics: metrics });
});

// --- STRIPE INTEGRATION (DEPOSITS) ---
app.post('/api/stripe/create-checkout-session', async (req: Request, res: Response) => {
  const { userId, amount, destinationAccountType, origin: clientOrigin } = req.body;

  if (!userId || !amount || Number(amount) <= 0) {
    return res.status(400).json({ error: 'Valid user ID and deposit amount are required.' });
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
    const user = db.users.get(userId);

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
      client_reference_id: userId,
      metadata: {
        userId,
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

// Confirm session callback endpoint for client return
app.get('/api/stripe/confirm-session', async (req: Request, res: Response) => {
  const sessionId = req.query.session_id as string;
  if (!sessionId) {
    return res.status(400).json({ error: 'Session ID is required.' });
  }

  const stripe = getStripe();
  if (!stripe) {
    return res.status(400).json({ error: 'Stripe is not configured.' });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status === 'paid') {
      const userId = session.client_reference_id || session.metadata?.userId;
      const amountStr = session.metadata?.amount;
      const amount = amountStr ? parseFloat(amountStr) : (session.amount_total ? session.amount_total / 100 : 0);
      const destinationAccountType: 'CHECKING' | 'SAVINGS' = session.metadata?.destinationAccountType === 'SAVINGS' ? 'SAVINGS' : 'CHECKING';

      if (userId && amount > 0) {
        // Check if already deposited
        const existingTx = db.transactions.find(
          (t) => t.paymentProviderRef === `STRIPE-${session.id}`
        );

        if (!existingTx) {
          db.processDeposit({
            userId,
            amount,
            method: 'CARD',
            destinationAccountType,
            providerPaymentId: `STRIPE-${session.id}`,
            metadata: {
              stripeSessionId: session.id,
              stripePaymentStatus: session.payment_status,
            },
          });
        }

        const metrics = db.getUserBalanceMetrics(userId);
        return res.json({ success: true, balanceMetrics: metrics });
      }
    }

    res.json({ success: false, status: session.payment_status });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to verify session' });
  }
});

// --- WITHDRAWALS ---
app.post('/api/withdrawals/create', (req: Request, res: Response) => {
  const {
    userId,
    amount,
    destinationType,
    destinationLabel,
    accountOrIban,
    sourceAccountType,
    routingNumber,
    cardBrand,
    cryptoAsset,
    cryptoNetwork,
  } = req.body;

  if (!userId || !amount || !destinationLabel || !accountOrIban) {
    return res.status(400).json({ error: 'Missing required withdrawal details.' });
  }

  const result = db.processWithdrawal({
    userId,
    amount: Number(amount),
    destinationType: destinationType || 'CARD',
    destinationLabel,
    accountOrIban,
    sourceAccountType: sourceAccountType || 'CHECKING',
    routingNumber,
    cardBrand,
    cryptoAsset,
    cryptoNetwork,
  });

  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  const metrics = db.getUserBalanceMetrics(userId);
  res.json({ success: true, transaction: result.transaction, balanceMetrics: metrics });
});

// Reverse pending withdrawal
app.post('/api/withdrawals/reverse', (req: Request, res: Response) => {
  const { transactionId, userId } = req.body;
  if (!transactionId) {
    return res.status(400).json({ error: 'Transaction ID is required.' });
  }

  const result = db.reverseWithdrawal(transactionId);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  const effectiveUserId = userId || result.transaction?.userId || 'usr_eleanor';
  const metrics = db.getUserBalanceMetrics(effectiveUserId);
  res.json({ success: true, transaction: result.transaction, balanceMetrics: metrics });
});

// Automatic 30-minute withdrawal reversal interval scheduler (runs every 15 seconds)
setInterval(() => {
  try {
    const reversed = db.checkAndExecuteScheduledReversals();
    if (reversed > 0) {
      console.log(`[Auto-Reversal] Automatically reversed ${reversed} pending withdrawal(s) after 30-minute threshold.`);
    }
  } catch (e) {
    console.error('[Auto-Reversal] Error checking scheduled reversals:', e);
  }
}, 15000);

// --- TRANSACTIONS EXPLORER ---
app.get('/api/transactions', (req: Request, res: Response) => {
  const userId = req.query.userId as string;
  const category = req.query.category as string;
  const search = (req.query.search as string)?.toLowerCase()?.trim();
  const type = req.query.type as string;
  const flow = req.query.flow as string; // 'CREDIT' | 'DEBIT' | 'ALL'
  const startDate = req.query.startDate as string;
  const endDate = req.query.endDate as string;

  let txs = [...db.transactions];

  if (userId) {
    txs = txs.filter((t) => t.senderUserId === userId || t.recipientUserId === userId);
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
        const isIncoming = t.recipientUserId === userId && t.senderUserId !== userId;
        const isDeposit = t.type === 'DEPOSIT' || t.type === 'ADMIN_DEVELOPMENT_FUNDING' || t.type === 'INVESTMENT_EARNING' || t.type === 'INVESTMENT_MATURITY';
        return isIncoming || isDeposit;
      });
    } else if (flow === 'DEBIT') {
      txs = txs.filter((t) => {
        const isOutgoing = t.senderUserId === userId && t.recipientUserId !== userId;
        const isWithdrawal = t.type === 'WITHDRAWAL' || t.type === 'CARD_PURCHASE' || t.type === 'FEE';
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
        t.description.toLowerCase().includes(search) ||
        t.referenceNumber.toLowerCase().includes(search) ||
        (t.senderName && t.senderName.toLowerCase().includes(search)) ||
        (t.recipientName && t.recipientName.toLowerCase().includes(search)) ||
        (t.senderAccountNumber && t.senderAccountNumber.includes(search)) ||
        (t.recipientAccountNumber && t.recipientAccountNumber.includes(search)) ||
        t.amount.toString().includes(search)
    );
  }

  // Always return sorted newest first
  txs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  res.json({ transactions: txs });
});

// --- INVESTMENTS CENTER ---
app.get('/api/investments', (req: Request, res: Response) => {
  const userId = req.query.userId as string;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  const userInvestments = Array.from(db.investments.values()).filter((i) => i.userId === userId);
  const earnings = db.investmentEarnings.filter((e) => e.userId === userId);

  res.json({
    investments: userInvestments,
    earnings,
    supportedTerms: [60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360],
  });
});

app.post('/api/investments/create', (req: Request, res: Response) => {
  const { userId, termDays, amount, userAccountNumber, fallbackBalances, fallbackUser } = req.body;

  if (!userId || !termDays || !amount) {
    return res.status(400).json({ error: 'User ID, term duration, and amount are required.' });
  }

  const result = db.createTermInvestment({
    userId,
    termDays: Number(termDays) as InvestmentTermDays,
    amount: Number(amount),
    userAccountNumber,
    fallbackBalances,
    fallbackUser,
  });

  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  const metrics = db.getUserBalanceMetrics(result.investment?.userId || userId);
  res.json({ success: true, investment: result.investment, balanceMetrics: metrics });
});

// Simulate Early/Fast-forward Maturity for testing
app.post('/api/investments/:id/mature', (req: Request, res: Response) => {
  const { id } = req.params;
  const result = db.matureInvestment(id);

  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  const userMetrics = db.getUserBalanceMetrics(result.investment!.userId);
  res.json({ success: true, investment: result.investment, payoutAmount: result.payoutAmount, balanceMetrics: userMetrics });
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

app.post('/api/admin/customers/:id/toggle-status', (req: Request, res: Response) => {
  const { id } = req.params;
  const { adminId, reason, targetStatus } = req.body;
  let user = db.users.get(id);
  if (!user) {
    user = Array.from(db.users.values()).find((u) => u.id === id || u.email === id);
  }

  if (!user) {
    const placeholderUser: UserProfile = {
      id,
      username: `user_${id.slice(0, 6)}`,
      firstName: 'Account',
      lastName: 'Holder',
      email: `${id}@monvera.internal`,
      phone: '+1 (555) 000-0000',
      permanentAccountNumber: `10${Math.floor(10000000 + Math.random() * 90000000)}`,
      status: targetStatus || 'frozen',
      role: 'customer',
      membershipTier: 'Premier',
      twoFactorEnabled: false,
      createdAt: new Date().toISOString(),
      kycStatus: 'unverified',
      country: 'United States',
      dailyTransactionLimit: 1000000,
    };
    db.users.set(id, placeholderUser);
    user = placeholderUser;
  } else {
    user.status = targetStatus || (user.status === 'active' ? 'frozen' : 'active');
  }

  db.auditLogs.unshift({
    id: `aud_${Date.now()}`,
    adminId: adminId || 'usr_admin',
    adminName: 'Monvera Compliance Admin',
    action: user.status === 'frozen' ? 'CUSTOMER_ACCOUNT_RESTRICTED' : 'CUSTOMER_ACCOUNT_UNFROZEN',
    targetUserId: user.id,
    targetAccountNumber: user.permanentAccountNumber,
    reason: reason || (user.status === 'frozen' ? 'Account placed on administrative freeze' : 'Administrative hold lifted'),
    timestamp: new Date().toISOString(),
    ipAddress: '127.0.0.1 (Admin Console)',
    result: 'SUCCESS',
  });

  res.json({ success: true, user });
});

app.post('/api/user/unfreeze', (req: Request, res: Response) => {
  const { userId, reason } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  let user = db.users.get(userId);
  if (!user) {
    user = Array.from(db.users.values()).find((u) => u.id === userId || u.email === userId);
  }

  if (user) {
    user.status = 'active';
  }

  db.auditLogs.unshift({
    id: `aud_${Date.now()}`,
    adminId: userId,
    adminName: user ? `${user.firstName} ${user.lastName}` : 'Customer Self-Unfreeze',
    action: 'CUSTOMER_ACCOUNT_UNFROZEN',
    targetUserId: userId,
    targetAccountNumber: user?.permanentAccountNumber || '1000000000',
    reason: reason || 'Customer completed security verification',
    timestamp: new Date().toISOString(),
    ipAddress: '127.0.0.1 (Customer Portal)',
    result: 'SUCCESS',
  });

  res.json({ success: true, status: 'active', user });
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
app.post('/api/admin/transfer', (req: Request, res: Response) => {
  const {
    adminId,
    targetUserId,
    targetAccountNumber,
    targetName,
    targetUsername,
    targetEmail,
    amount,
    description,
    category,
  } = req.body;

  if (!targetUserId || !amount || Number(amount) <= 0) {
    return res.status(400).json({ error: 'Target customer ID and positive transfer amount are required.' });
  }

  const result = db.recordAdminTransfer({
    adminId: adminId || 'usr_admin',
    targetUserId,
    targetAccountNumber,
    targetName,
    targetUsername,
    targetEmail,
    amount: Number(amount),
    description: description || 'Administrative Direct Transfer from Bennett Johnson',
    category: category || 'Transfers',
  });

  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  const recipientId = result.transaction?.recipientUserId || targetUserId;
  const targetMetrics = db.getUserBalanceMetrics(recipientId);
  res.json({
    success: true,
    transaction: result.transaction,
    targetBalanceMetrics: targetMetrics,
  });

  // Asynchronously dispatch multi-channel notification for Bennett Johnson admin transfer
  if (result.transaction) {
    const tx = result.transaction;
    const recipientUser = db.users.get(recipientId);
    serverNotificationDispatcher.dispatch({
      transactionId: tx.id,
      referenceNumber: tx.referenceNumber,
      type: 'MONEY_RECEIVED',
      userId: recipientId,
      recipientName: recipientUser ? `${recipientUser.firstName} ${recipientUser.lastName}` : (targetName || 'Monvera Client'),
      recipientEmail: recipientUser?.email || targetEmail,
      recipientPhone: recipientUser?.phone,
      amount: Number(amount),
      currency: tx.currency || 'USD',
      senderName: 'Bennett Johnson (Admin)',
      accountMasked: (tx as any).accountName || 'Monvera Premier Checking',
    }).catch((err) => console.warn('[ServerDispatcher] Admin transfer dispatch note:', err?.message || err));
  }
});

// Admin Development Funding System (Isolated for testing/staging)
app.post('/api/admin/dev-fund', (req: Request, res: Response) => {
  const { adminId, targetUserId, amount, reason, targetAccountType } = req.body;

  if (!targetUserId || !amount || Number(amount) <= 0) {
    return res.status(400).json({ error: 'Target customer ID and positive amount are required.' });
  }

  const result = db.issueAdminDevFunding({
    adminId: adminId || 'usr_admin',
    targetUserId,
    amount: Number(amount),
    reason: reason || 'Sandbox liquidity disbursement',
    targetAccountType: targetAccountType || 'CHECKING',
  });

  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  const targetMetrics = db.getUserBalanceMetrics(targetUserId);
  res.json({
    success: true,
    transaction: result.transaction,
    targetBalanceMetrics: targetMetrics,
    devFundingPoolBalance: db.devFundingPoolBalance,
  });
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
app.get('/api/loans', (req: Request, res: Response) => {
  const userId = req.query.userId as string;
  let loanList = Array.from(db.loans.values());
  if (userId) {
    loanList = loanList.filter((l) => l.userId === userId);
  }
  res.json({ loans: loanList });
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

app.post('/api/loans/apply', (req: Request, res: Response) => {
  const { userId, amount, termMonths, purpose, employmentOrBusinessDetails, annualIncomeOrRevenue, collateralDescription, fallbackUser, applicantName, applicantEmail, applicantPhone, permanentAccountNumber } = req.body;
  if (!userId || !amount) {
    return res.status(400).json({ error: 'User ID and loan amount are required.' });
  }
  const result = db.createLoanApplication({
    userId,
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
  res.json(result);
});

app.post('/api/admin/loans/approve', (req: Request, res: Response) => {
  const { loanId, adminId, fallbackLoan, fallbackUser } = req.body;
  if (!loanId) return res.status(400).json({ error: 'loanId is required.' });
  const result = db.adminApproveLoan({ loanId, adminId: adminId || 'usr_admin', fallbackLoan, fallbackUser });
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json(result);
});

app.post('/api/admin/loans/reject', (req: Request, res: Response) => {
  const { loanId, reason, adminId } = req.body;
  if (!loanId) return res.status(400).json({ error: 'loanId is required.' });
  const result = db.adminRejectLoan({ loanId, reason: reason || 'Application declined by compliance', adminId: adminId || 'usr_admin' });
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json(result);
});

app.post('/api/loans/repay', (req: Request, res: Response) => {
  const { loanId, userId, amount, sourceAccountId, note, fallbackLoan, fallbackUser } = req.body;
  if (!loanId || !userId || !amount) {
    return res.status(400).json({ error: 'loanId, userId, and repayment amount are required.' });
  }
  const result = db.repayLoan({
    loanId,
    userId,
    amount: Number(amount),
    sourceAccountId,
    note,
    fallbackLoan,
    fallbackUser,
  });
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json(result);
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

startServer();
