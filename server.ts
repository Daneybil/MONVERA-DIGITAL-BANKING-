import express, { Request, Response } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { db } from './server/db';
import { UserProfile, InvestmentTermDays } from './src/types';

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));
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
    const balanceMetrics = db.getUserBalanceMetrics(existingUser.id);
    return res.json({ success: true, user: existingUser, balanceMetrics });
  }

  // Check if email already registered under another ID
  const existingByEmail = Array.from(db.users.values()).find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
  if (existingByEmail && existingByEmail.id !== userId) {
    // If it was another user ID, update ID to Firebase UID
    db.users.delete(existingByEmail.id);
    existingByEmail.id = userId;
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
  const { userId, documentType, documentNumber, country, proofOfAddress, autoApprove } = req.body;
  if (!userId || !documentType || !documentNumber) {
    return res.status(400).json({ error: 'User ID, document type, and document number are required.' });
  }

  const result = db.submitKyc({
    userId,
    documentType,
    documentNumber,
    country,
    proofOfAddress,
    autoApprove: autoApprove !== false,
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
  
  // Look up by permanent account number OR username
  const recipient = Array.from(db.users.values()).find(
    (u) =>
      u.permanentAccountNumber.replace(/[-\s]/g, '') === cleanInput ||
      (u.username && u.username.toLowerCase() === cleanInput)
  );

  if (!recipient) {
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
  const { senderUserId, recipientAccountNumber, recipientUsername, recipientIdentifier, amount, description, category } = req.body;
  const rawTarget = (recipientIdentifier || recipientAccountNumber || recipientUsername || '') as string;

  if (!senderUserId || !rawTarget.trim() || !amount || Number(amount) <= 0) {
    return res.status(400).json({ error: 'Sender ID, valid recipient account number or username, and positive amount are required.' });
  }

  const cleanTarget = rawTarget.toString().trim().replace(/^@/, '').replace(/[-\s]/g, '').toLowerCase();
  const recipient = Array.from(db.users.values()).find(
    (u) =>
      u.permanentAccountNumber.replace(/[-\s]/g, '') === cleanTarget ||
      (u.username && u.username.toLowerCase() === cleanTarget)
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

// --- WITHDRAWALS ---
app.post('/api/withdrawals/create', (req: Request, res: Response) => {
  const { userId, amount, destinationType, destinationLabel, accountOrIban, sourceAccountType } = req.body;

  if (!userId || !amount || !destinationLabel || !accountOrIban) {
    return res.status(400).json({ error: 'Missing required withdrawal details.' });
  }

  const result = db.processWithdrawal({
    userId,
    amount: Number(amount),
    destinationType: destinationType || 'ACH_BANK',
    destinationLabel,
    accountOrIban,
    sourceAccountType: sourceAccountType || 'CHECKING',
  });

  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  const metrics = db.getUserBalanceMetrics(userId);
  res.json({ success: true, transaction: result.transaction, balanceMetrics: metrics });
});

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
  const { userId, termDays, amount } = req.body;

  if (!userId || !termDays || !amount) {
    return res.status(400).json({ error: 'User ID, term duration, and amount are required.' });
  }

  const result = db.createTermInvestment({
    userId,
    termDays: Number(termDays) as InvestmentTermDays,
    amount: Number(amount),
  });

  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  const metrics = db.getUserBalanceMetrics(userId);
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
  const { userId, cardHolderName, phone, cardType, cardTier, brand, spendingLimitMonthly, spendingLimitDaily, colorScheme } = req.body;
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
  });

  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  const balanceMetrics = db.getUserBalanceMetrics(userId);
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
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  const userNotifs = db.notifications.filter((n) => n.userId === userId);
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
  const customers = Array.from(db.users.values()).map((u) => {
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
  const { adminId, reason } = req.body;
  const user = db.users.get(id);

  if (!user) return res.status(404).json({ error: 'Customer not found' });

  user.status = user.status === 'active' ? 'frozen' : 'active';

  db.auditLogs.unshift({
    id: `aud_${Date.now()}`,
    adminId: adminId || 'usr_admin',
    adminName: 'Monvera Compliance Admin',
    action: user.status === 'frozen' ? 'CUSTOMER_ACCOUNT_RESTRICTED' : 'CUSTOMER_ACCOUNT_UNFROZEN',
    targetUserId: user.id,
    targetAccountNumber: user.permanentAccountNumber,
    reason: reason || 'Administrative compliance review',
    timestamp: new Date().toISOString(),
    ipAddress: '127.0.0.1 (Admin Console)',
    result: 'SUCCESS',
  });

  res.json({ success: true, user });
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
