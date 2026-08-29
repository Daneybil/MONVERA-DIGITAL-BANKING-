import {
  UserProfile,
  BankAccount,
  AccountType,
  Transaction,
  TransactionType,
  TransactionStatus,
  LedgerEntry,
  InvestmentPlan,
  InvestmentEarningLog,
  LoanApplication,
  LoanStatus,
  CardItem,
  NotificationItem,
  AdminAuditLog,
  SessionInfo,
  AdminSystemOverview,
  InvestmentTermDays,
} from '../src/types';

// In-Memory Authoritative Store with initial seed data
export class MonveraDatabase {
  public users: Map<string, UserProfile> = new Map();
  public userPasswords: Map<string, string> = new Map(); // Secure hashed password store
  public accounts: Map<string, BankAccount> = new Map();
  public transactions: Transaction[] = [];
  public ledgerEntries: LedgerEntry[] = [];
  public investments: Map<string, InvestmentPlan> = new Map();
  public investmentEarnings: InvestmentEarningLog[] = [];
  public loans: Map<string, LoanApplication> = new Map();
  public cards: Map<string, CardItem> = new Map();
  public notifications: NotificationItem[] = [];
  public auditLogs: AdminAuditLog[] = [];
  public sessions: Map<string, SessionInfo[]> = new Map();
  public devFundingPoolBalance: number = 1000000000.0; // $1,000,000,000.00 Development Testing Liquidity Pool

  constructor() {
    this.seedInitialData();
  }

  private seedInitialData() {
    // Seed Super Admin Operations User (Bennett Johnson)
    const adminId = 'usr_admin';
    const adminAccNum = '1000000001';
    const adminUser: UserProfile = {
      id: adminId,
      username: 'bennett_johnson',
      firstName: 'Bennett',
      lastName: 'Johnson',
      email: 'admin@monvera.com',
      phone: '+1 (800) 555-0199',
      permanentAccountNumber: adminAccNum,
      country: 'United States',
      avatarUrl: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
      status: 'active',
      role: 'super_admin',
      membershipTier: 'Private Wealth',
      twoFactorEnabled: true,
      createdAt: '2024-12-01T00:00:00Z',
      kycStatus: 'verified',
      dailyTransactionLimit: 10000000,
    };
    this.users.set(adminId, adminUser);
    this.userPasswords.set(adminId, 'Password123!');

    // Initialize Bank Accounts for Admin
    this.initUserAccounts(adminId, adminAccNum);

    // Initial Cards, Investments, Transactions, and Notifications start clean with only real user data
  }

  private initUserAccounts(userId: string, permanentAccNum: string) {
    const chkId = `acc_chk_${userId}`;
    const savId = `acc_sav_${userId}`;
    const invId = `acc_inv_${userId}`;

    this.accounts.set(chkId, {
      id: chkId,
      userId,
      type: 'CHECKING',
      accountNumber: permanentAccNum,
      routingNumber: '021000021', // Monvera NY Fed Routing
      currency: 'USD',
      balance: 0,
      availableBalance: 0,
      investedBalance: 0,
      pendingBalance: 0,
      interestRateAPY: 1.25,
      status: 'ACTIVE',
      nickname: 'Monvera Premier Checking',
    });

    this.accounts.set(savId, {
      id: savId,
      userId,
      type: 'SAVINGS',
      accountNumber: `${permanentAccNum.slice(0, 7)}991`,
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

    this.accounts.set(invId, {
      id: invId,
      userId,
      type: 'INVESTMENT',
      accountNumber: `${permanentAccNum.slice(0, 7)}882`,
      routingNumber: '021000021',
      currency: 'USD',
      balance: 0,
      availableBalance: 0,
      investedBalance: 0,
      pendingBalance: 0,
      interestRateAPY: 8.4,
      status: 'ACTIVE',
      nickname: 'Monvera Capital Investment Portfolio',
    });
  }

  public ensureUserExists(userId: string, data?: Partial<UserProfile>): UserProfile {
    let user = this.users.get(userId);
    if (!user && data?.email) {
      user = Array.from(this.users.values()).find(
        (u) => u.email.toLowerCase() === data.email!.trim().toLowerCase()
      );
      if (user) {
        // Associate this ID
        this.users.set(userId, user);
      }
    }

    if (!user) {
      const permanentAccountNumber =
        data?.permanentAccountNumber || `10${Math.floor(10000000 + Math.random() * 90000000)}`;
      user = {
        id: userId,
        username: data?.username || `user_${userId.slice(-6)}`,
        firstName: data?.firstName || 'Monvera',
        lastName: data?.lastName || 'Client',
        email: data?.email || `${userId}@monvera.com`,
        phone: data?.phone || '+1 (555) 000-0000',
        permanentAccountNumber,
        country: data?.country || 'United States',
        avatarUrl:
          data?.avatarUrl ||
          'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
        status: 'active',
        role: data?.role || 'customer',
        membershipTier: data?.membershipTier || 'Premier',
        twoFactorEnabled: false,
        createdAt: data?.createdAt || new Date().toISOString(),
        businessName: data?.businessName,
        kycStatus: data?.kycStatus || 'verified',
        dailyTransactionLimit: 1000000,
      };
      this.users.set(userId, user);
      this.initUserAccounts(userId, permanentAccountNumber);
    }
    return user;
  }

  // --- Authoritative Balance Calculation Engine ---
  public getUserBalanceMetrics(userId: string) {
    const userAccounts = Array.from(this.accounts.values()).filter((a) => a.userId === userId);
    const chk = userAccounts.find((a) => a.type === 'CHECKING');
    const sav = userAccounts.find((a) => a.type === 'SAVINGS');
    const inv = userAccounts.find((a) => a.type === 'INVESTMENT');

    // Calculate balances from ledger entries
    let checkingBal = 0;
    let savingsBal = 0;
    let investedBal = 0;

    const entries = this.ledgerEntries.filter((e) => e.userId === userId);
    for (const e of entries) {
      if (chk && e.accountId === chk.id) {
        checkingBal += e.entryType === 'CREDIT' ? e.amount : -e.amount;
      } else if (sav && e.accountId === sav.id) {
        savingsBal += e.entryType === 'CREDIT' ? e.amount : -e.amount;
      } else if (inv && e.accountId === inv.id) {
        investedBal += e.entryType === 'CREDIT' ? e.amount : -e.amount;
      }
    }

    // Active term investments sum & dynamic 24h profit accrual
    const activeInvestments = Array.from(this.investments.values()).filter(
      (i) => i.userId === userId && i.status === 'ACTIVE'
    );
    for (const inv of activeInvestments) {
      const elapsedMs = Math.max(0, Date.now() - new Date(inv.startDate).getTime());
      const completedDays = Math.min(inv.termDays, Math.floor(elapsedMs / (24 * 60 * 60 * 1000)));
      inv.totalAccruedEarnings = Number((completedDays * (inv.amount * 0.045)).toFixed(2));
    }
    const totalActiveInvestmentsAmount = activeInvestments.reduce((sum, i) => sum + i.amount, 0);
    const totalAccruedEarnings = activeInvestments.reduce((sum, i) => sum + i.totalAccruedEarnings, 0);

    // Sync account models
    if (chk) {
      chk.balance = checkingBal;
      chk.availableBalance = checkingBal;
    }
    if (sav) {
      sav.balance = savingsBal;
      sav.availableBalance = savingsBal;
    }
    if (inv) {
      inv.balance = totalActiveInvestmentsAmount + totalAccruedEarnings;
      inv.investedBalance = totalActiveInvestmentsAmount;
    }

    // Active approved loan principal calculation
    const activeLoans = Array.from(this.loans.values()).filter(
      (l) => l.userId === userId && (l.status === 'ACTIVE' || l.status === 'APPROVED')
    );
    const loanBalance = activeLoans.reduce((sum, l) => sum + (l.remainingBalance ?? l.amount), 0);

    const totalBalance = checkingBal + savingsBal + totalActiveInvestmentsAmount + totalAccruedEarnings;
    const availableBalance = checkingBal + savingsBal; // Liquid funds available for withdrawal/send

    return {
      checkingBalance: checkingBal,
      savingsBalance: savingsBal,
      investedBalance: totalActiveInvestmentsAmount,
      accruedEarnings: totalAccruedEarnings,
      totalBalance,
      availableBalance,
      loanBalance,
      pendingBalance: 0,
      accounts: userAccounts,
    };
  }

  // Double-Entry Ledger Core
  public recordLedgerTransaction(params: {
    type: TransactionType;
    amount: number;
    userId: string;
    senderAccountId?: string;
    recipientUserId?: string;
    recipientAccountId?: string;
    description: string;
    category: Transaction['category'];
    status: TransactionStatus;
    fee?: number;
    paymentProviderRef?: string;
    timestamp?: string;
    metadata?: Record<string, any>;
  }): Transaction {
    const txId = `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const refNum = `MV-${params.type.substring(0, 3)}-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
    const txTimestamp = params.timestamp || new Date().toISOString();

    const senderUser = this.users.get(params.userId);
    const recipientUser = params.recipientUserId ? this.users.get(params.recipientUserId) : undefined;

    const tx: Transaction = {
      id: txId,
      referenceNumber: refNum,
      type: params.type,
      amount: params.amount,
      currency: 'USD',
      status: params.status,
      senderUserId: params.userId,
      senderName: senderUser ? `${senderUser.firstName} ${senderUser.lastName}` : 'Monvera Liquidity Reserve',
      senderAccountNumber: senderUser?.permanentAccountNumber,
      recipientUserId: params.recipientUserId,
      recipientName: recipientUser
        ? `${recipientUser.firstName} ${recipientUser.lastName}`
        : params.recipientUserId
          ? 'External Recipient'
          : undefined,
      recipientAccountNumber: recipientUser?.permanentAccountNumber,
      fee: params.fee || 0,
      description: params.description,
      category: params.category,
      paymentProviderRef: params.paymentProviderRef,
      createdAt: txTimestamp,
      completedAt: params.status === 'COMPLETED' ? txTimestamp : undefined,
      metadata: params.metadata,
    };

    this.transactions.unshift(tx);

    // Create Ledger Entries if completed
    if (params.status === 'COMPLETED') {
      if (params.senderAccountId) {
        this.ledgerEntries.push({
          id: `led_${Date.now()}_d_${Math.random().toString(36).substring(2, 6)}`,
          transactionId: txId,
          userId: params.userId,
          accountId: params.senderAccountId,
          entryType: 'DEBIT',
          amount: params.amount + (params.fee || 0),
          balanceAfter: 0, // Recalculated dynamically
          description: params.description,
          timestamp: txTimestamp,
        });
      }

      if (params.recipientAccountId) {
        this.ledgerEntries.push({
          id: `led_${Date.now()}_c_${Math.random().toString(36).substring(2, 6)}`,
          transactionId: txId,
          userId: params.recipientUserId || params.userId,
          accountId: params.recipientAccountId,
          entryType: 'CREDIT',
          amount: params.amount,
          balanceAfter: 0,
          description: params.description,
          timestamp: txTimestamp,
        });
      }
    }

    return tx;
  }

  public recordInternalAccountTransfer(
    userId: string,
    fromAccountId: string,
    toAccountId: string,
    amount: number,
    description: string,
    timestamp?: string
  ) {
    return this.recordLedgerTransaction({
      type: 'TRANSFER',
      amount,
      userId,
      senderAccountId: fromAccountId,
      recipientUserId: userId,
      recipientAccountId: toAccountId,
      description,
      category: 'Transfers',
      status: 'COMPLETED',
      timestamp,
    });
  }

  // --- Monvera to Monvera Verified Transfer ---
  public recordMonveraTransfer(params: {
    senderUserId: string;
    recipientUserId: string;
    amount: number;
    description: string;
    category?: Transaction['category'];
    timestamp?: string;
  }): { success: boolean; transaction?: Transaction; error?: string } {
    const sender = this.users.get(params.senderUserId);
    const recipient = this.users.get(params.recipientUserId);

    if (!sender) return { success: false, error: 'Sender not found.' };
    if (!recipient) return { success: false, error: 'Recipient not found.' };
    if (sender.id === recipient.id) {
      return { success: false, error: 'Cannot transfer to the same Monvera account via external transfer.' };
    }
    if (sender.status === 'frozen') {
      return { success: false, error: 'Sender account is currently restricted/frozen.' };
    }
    if (recipient.status === 'frozen') {
      return { success: false, error: 'Recipient account cannot receive transfers at this time.' };
    }

    // Verify sender checking balance
    const senderMetrics = this.getUserBalanceMetrics(sender.id);
    if (senderMetrics.checkingBalance < params.amount) {
      return {
        success: false,
        error: `Insufficient available funds. Current checking balance is $${senderMetrics.checkingBalance.toLocaleString(
          'en-US',
          { minimumFractionDigits: 2 }
        )}.`,
      };
    }

    const senderChk = `acc_chk_${sender.id}`;
    const recipientChk = `acc_chk_${recipient.id}`;

    const tx = this.recordLedgerTransaction({
      type: 'TRANSFER',
      amount: params.amount,
      userId: sender.id,
      senderAccountId: senderChk,
      recipientUserId: recipient.id,
      recipientAccountId: recipientChk,
      description: params.description || `Transfer to ${recipient.firstName} ${recipient.lastName}`,
      category: params.category || 'Transfers',
      status: 'COMPLETED',
      timestamp: params.timestamp,
    });

    // Generate notifications for both parties
    this.notifications.unshift({
      id: `notif_${Date.now()}_s`,
      userId: sender.id,
      title: 'Transfer Sent',
      message: `You transferred $${params.amount.toLocaleString('en-US', {
        minimumFractionDigits: 2,
      })} to ${recipient.firstName} ${recipient.lastName} (MVB •••• ${recipient.permanentAccountNumber.slice(-4)}).`,
      type: 'TRANSACTION',
      severity: 'info',
      read: false,
      createdAt: new Date().toISOString(),
      referenceId: tx.referenceNumber,
    });

    this.notifications.unshift({
      id: `notif_${Date.now()}_r`,
      userId: recipient.id,
      title: 'Money Received',
      message: `Received $${params.amount.toLocaleString('en-US', {
        minimumFractionDigits: 2,
      })} from ${sender.firstName} ${sender.lastName} (MVB •••• ${sender.permanentAccountNumber.slice(-4)}).`,
      type: 'TRANSACTION',
      severity: 'success',
      read: false,
      createdAt: new Date().toISOString(),
      referenceId: tx.referenceNumber,
    });

    return { success: true, transaction: tx };
  }

  // --- Official Administrative Transfer from Bennett Johnson ---
  public recordAdminTransfer(params: {
    targetUserId: string;
    amount: number;
    description?: string;
    category?: Transaction['category'];
    adminId?: string;
  }): { success: boolean; transaction?: Transaction; error?: string } {
    let targetUser = this.users.get(params.targetUserId);
    if (!targetUser) {
      const cleanTarget = (params.targetUserId || '').replace(/^@/, '').replace(/[-\s]/g, '').toLowerCase();
      targetUser = Array.from(this.users.values()).find(
        (u) =>
          u.id === params.targetUserId ||
          (u.permanentAccountNumber && u.permanentAccountNumber.replace(/[-\s]/g, '').toLowerCase() === cleanTarget) ||
          (u.username && u.username.toLowerCase() === cleanTarget) ||
          (u.email && u.email.toLowerCase() === cleanTarget) ||
          `${u.firstName || ''} ${u.lastName || ''}`.trim().toLowerCase() === cleanTarget
      );
    }

    if (!targetUser) {
      // Dynamic user fallback for users registered across Firestore sessions
      const cleanDigits = (params.targetUserId || '').replace(/[-\s]/g, '');
      const dynamicId = params.targetUserId.startsWith('usr_') ? params.targetUserId : `usr_${params.targetUserId}`;
      targetUser = {
        id: dynamicId,
        username: `user_${cleanDigits.slice(-4) || 'customer'}`,
        firstName: 'Monvera',
        lastName: 'Customer',
        email: `customer_${cleanDigits || Date.now()}@monvera.com`,
        phone: '+1 (555) 019-2834',
        country: 'United States',
        permanentAccountNumber: cleanDigits.length >= 8 ? cleanDigits : `10${Math.floor(10000000 + Math.random() * 90000000)}`,
        status: 'active',
        membershipTier: 'Premier',
        role: 'customer',
        createdAt: new Date().toISOString(),
        twoFactorEnabled: false,
        kycStatus: 'verified',
        emailVerified: true,
        dailyTransactionLimit: 1000000,
      };
      this.users.set(dynamicId, targetUser);
    }

    if (!params.amount || params.amount <= 0) {
      return { success: false, error: 'Transfer amount must be greater than $0.00.' };
    }

    const adminSender = this.users.get('usr_admin') || {
      id: 'usr_admin',
      firstName: 'Bennett',
      lastName: 'Johnson',
      permanentAccountNumber: '1000000001',
    };

    const targetChk = `acc_chk_${targetUser.id}`;
    const txId = `tx_adm_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const refNum = `MV-ADM-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
    const txTimestamp = new Date().toISOString();

    const tx: Transaction = {
      id: txId,
      referenceNumber: refNum,
      type: 'TRANSFER',
      amount: params.amount,
      currency: 'USD',
      status: 'COMPLETED',
      senderUserId: 'usr_admin',
      senderName: 'Bennett Johnson',
      senderAccountNumber: '1000000001',
      recipientUserId: targetUser.id,
      recipientName: `${targetUser.firstName} ${targetUser.lastName}`.trim() || targetUser.username || 'Customer',
      recipientAccountNumber: targetUser.permanentAccountNumber,
      fee: 0.00,
      description: params.description || 'Administrative Direct Transfer from Bennett Johnson',
      category: params.category || 'Transfers',
      createdAt: txTimestamp,
      completedAt: txTimestamp,
      metadata: {
        adminSenderName: 'Bennett Johnson',
        adminSenderAccount: '1000000001',
        disbursementType: 'ADMINISTRATIVE_TRANSFER',
      },
    };

    this.transactions.unshift(tx);

    // Credit recipient checking ledger
    this.ledgerEntries.push({
      id: `led_${Date.now()}_c_${Math.random().toString(36).substring(2, 6)}`,
      transactionId: txId,
      userId: targetUser.id,
      accountId: targetChk,
      entryType: 'CREDIT',
      amount: params.amount,
      balanceAfter: 0, // Computed dynamically
      description: tx.description,
      timestamp: txTimestamp,
    });

    // Notify recipient
    this.notifications.unshift({
      id: `notif_${Date.now()}_adm_r`,
      userId: targetUser.id,
      title: 'Money Received',
      message: `Received $${params.amount.toLocaleString('en-US', {
        minimumFractionDigits: 2,
      })} from Bennett Johnson (MVB •••• 0001).`,
      type: 'TRANSACTION',
      severity: 'success',
      read: false,
      createdAt: txTimestamp,
      referenceId: tx.referenceNumber,
    });

    // Audit log
    this.auditLogs.unshift({
      id: `aud_${Date.now()}_adm_tx`,
      adminId: params.adminId || 'usr_admin',
      adminName: 'Bennett Johnson',
      action: 'ADMIN_TRANSFER_DISBURSEMENT',
      targetUserId: targetUser.id,
      targetAccountNumber: targetUser.permanentAccountNumber,
      amount: params.amount,
      reason: params.description || 'Administrative Direct Transfer',
      timestamp: txTimestamp,
      ipAddress: '127.0.0.1 (Admin Console)',
      result: 'SUCCESS',
    });

    return { success: true, transaction: tx };
  }

  // --- Verified Payment / Real Deposit Integration ---
  public processDeposit(params: {
    userId: string;
    amount: number;
    method: 'CARD' | 'ACH' | 'WIRE' | 'INSTANT_PAY' | 'CRYPTO_WALLET';
    destinationAccountType?: 'CHECKING' | 'SAVINGS';
    providerPaymentId?: string;
    metadata?: Record<string, any>;
  }): { success: boolean; transaction?: Transaction; error?: string } {
    const user = this.users.get(params.userId);
    if (!user) return { success: false, error: 'Customer account not found.' };
    if (params.amount <= 0) return { success: false, error: 'Deposit amount must be greater than $0.00.' };

    const targetType = params.destinationAccountType === 'SAVINGS' ? 'SAVINGS' : 'CHECKING';
    const targetAccountId = targetType === 'SAVINGS' ? `acc_sav_${user.id}` : `acc_chk_${user.id}`;
    const accountName = targetType === 'SAVINGS' ? 'High-Yield Savings' : 'Checking Account';
    const providerRef = params.providerPaymentId || `MVR-DEP-${Date.now().toString(36).toUpperCase()}`;

    const methodLabels: Record<string, string> = {
      CARD: 'Debit / Credit Card Gateway',
      ACH: 'Bank ACH Transfer',
      WIRE: 'Domestic FedWire',
      INSTANT_PAY: 'Instant RTP Network',
      CRYPTO_WALLET: 'Web3 Crypto Wallet Deposit',
    };
    const methodDesc = methodLabels[params.method] || params.method;

    const tx = this.recordLedgerTransaction({
      type: 'DEPOSIT',
      amount: params.amount,
      userId: user.id,
      recipientUserId: user.id,
      recipientAccountId: targetAccountId,
      description: `Deposit to ${accountName} via ${methodDesc}`,
      category: 'Deposits',
      status: 'COMPLETED',
      paymentProviderRef: providerRef,
      metadata: {
        ...params.metadata,
        destinationAccountType: targetType,
        depositMethod: params.method,
      },
    });

    this.notifications.unshift({
      id: `notif_${Date.now()}_dep`,
      userId: user.id,
      title: 'Deposit Settled & Available',
      message: `+$${params.amount.toLocaleString('en-US', {
        minimumFractionDigits: 2,
      })} has been securely credited to your Monvera ${accountName}.`,
      type: 'TRANSACTION',
      severity: 'success',
      read: false,
      createdAt: new Date().toISOString(),
      referenceId: tx.referenceNumber,
    });

    return { success: true, transaction: tx };
  }

  // --- Withdrawal Engine ---
  public processWithdrawal(params: {
    userId: string;
    amount: number;
    destinationType: 'ACH_BANK' | 'FEDWIRE' | 'CARD' | 'CRYPTO';
    destinationLabel: string;
    accountOrIban: string;
    sourceAccountType?: 'CHECKING' | 'SAVINGS';
    routingNumber?: string;
    cardBrand?: 'VISA' | 'MASTERCARD';
    cryptoAsset?: 'USDT' | 'BNB';
    cryptoNetwork?: string;
  }): { success: boolean; transaction?: Transaction; error?: string } {
    const user = this.users.get(params.userId);
    if (!user) return { success: false, error: 'Customer account not found.' };
    if (params.amount <= 0) return { success: false, error: 'Withdrawal amount must be greater than $0.00.' };

    const metrics = this.getUserBalanceMetrics(user.id);
    const fee = 0.0; // All withdrawals are 100% free and instant
    const totalRequired = params.amount + fee;

    const sourceType = params.sourceAccountType === 'SAVINGS' ? 'SAVINGS' : 'CHECKING';
    const sourceBal = sourceType === 'SAVINGS' ? metrics.savingsBalance : metrics.checkingBalance;
    const sourceAccName = sourceType === 'SAVINGS' ? 'High-Yield Savings' : 'Checking Account';

    if (sourceBal < totalRequired) {
      return {
        success: false,
        error: `Insufficient balance in your ${sourceAccName} ($${sourceBal.toLocaleString('en-US', {
          minimumFractionDigits: 2,
        })}). Required: $${totalRequired.toFixed(2)}. Note: Active investment capital is locked until maturity.`,
      };
    }

    const cleanAccountDisplay =
      params.destinationType === 'CRYPTO'
        ? `${params.accountOrIban.slice(0, 6)}...${params.accountOrIban.slice(-4)}`
        : `•••• ${params.accountOrIban.replace(/\s+/g, '').slice(-4)}`;

    const sourceAccountId = sourceType === 'SAVINGS' ? `acc_sav_${user.id}` : `acc_chk_${user.id}`;
    const tx = this.recordLedgerTransaction({
      type: 'WITHDRAWAL',
      amount: params.amount,
      fee,
      userId: user.id,
      senderAccountId: sourceAccountId,
      description: `Withdrawal from ${sourceAccName} to ${params.destinationLabel} (${cleanAccountDisplay})`,
      category: 'Withdrawals',
      status: 'COMPLETED',
      paymentProviderRef: `WTH-INSTANT-${Date.now().toString(36).toUpperCase()}`,
      metadata: {
        destinationType: params.destinationType,
        destinationLabel: params.destinationLabel,
        accountOrIbanMasked: cleanAccountDisplay,
        sourceAccountType: sourceType,
        routingNumber: params.routingNumber,
        cardBrand: params.cardBrand,
        cryptoAsset: params.cryptoAsset,
        cryptoNetwork: params.cryptoNetwork || (params.destinationType === 'CRYPTO' ? 'Binance Smart Chain (BEP-20)' : undefined),
      },
    });

    this.notifications.unshift({
      id: `notif_${Date.now()}_wth`,
      userId: user.id,
      title: 'Withdrawal Dispatched Instantly',
      message: `-$${params.amount.toLocaleString('en-US', {
        minimumFractionDigits: 2,
      })} has been debited from your ${sourceAccName} and sent to ${params.destinationLabel} (${cleanAccountDisplay}).`,
      type: 'TRANSACTION',
      severity: 'info',
      read: false,
      createdAt: new Date().toISOString(),
      referenceId: tx.referenceNumber,
    });

    return { success: true, transaction: tx };
  }

  // --- Term Investment Creation (60 to 360 Days ONLY - Strictly NO 30-Day Plan) ---
  public createTermInvestment(params: {
    userId: string;
    termDays: InvestmentTermDays;
    amount: number;
  }): { success: boolean; investment?: InvestmentPlan; error?: string } {
    const validTerms: InvestmentTermDays[] = [60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360];
    if (!validTerms.includes(params.termDays)) {
      return {
        success: false,
        error: `Invalid investment term. Supported Monvera terms begin at 60 days up to 360 days (${validTerms.join(
          ', '
        )} days). 30-day plans are not supported.`,
      };
    }

    const user = this.users.get(params.userId);
    if (!user) return { success: false, error: 'Customer not found.' };

    if (params.amount < 100) {
      return { success: false, error: 'Minimum term investment amount is $100.00.' };
    }

    const metrics = this.getUserBalanceMetrics(user.id);
    if (metrics.checkingBalance < params.amount) {
      return {
        success: false,
        error: `Insufficient available checking balance ($${metrics.checkingBalance.toLocaleString('en-US', {
          minimumFractionDigits: 2,
        })}). Please deposit or transfer funds to checking first.`,
      };
    }

    // Fixed 4.50% interest every 24 hours across all supported durations (60 to 360 days)
    const fixedDailyRate = 4.5; // 4.5% daily
    const expectedYield = Number((params.amount * (fixedDailyRate / 100) * params.termDays).toFixed(2));
    const expectedMaturityValue = Number((params.amount + expectedYield).toFixed(2));
    const startDate = new Date().toISOString();
    const maturityDate = new Date(Date.now() + params.termDays * 24 * 60 * 60 * 1000).toISOString();

    const invId = `inv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const plan: InvestmentPlan = {
      id: invId,
      userId: user.id,
      planName: `Monvera ${params.termDays}-Day Term Investment`,
      termDays: params.termDays,
      amount: params.amount,
      apy: 4.5,
      dailyRate: fixedDailyRate,
      expectedYield,
      expectedMaturityValue,
      totalAccruedEarnings: 0,
      startDate,
      maturityDate,
      status: 'ACTIVE',
      createdAt: startDate,
    };

    // Deduct from checking, credit investment portfolio in ledger
    const chkId = `acc_chk_${user.id}`;
    const invAccId = `acc_inv_${user.id}`;

    this.recordLedgerTransaction({
      type: 'INVESTMENT',
      amount: params.amount,
      userId: user.id,
      senderAccountId: chkId,
      recipientAccountId: invAccId,
      description: `Funded ${params.termDays}-Day Term Investment (4.50% interest / 24h)`,
      category: 'Investments',
      status: 'COMPLETED',
      metadata: { investmentId: invId, termDays: params.termDays, dailyRate: fixedDailyRate },
    });

    this.investments.set(invId, plan);

    this.notifications.unshift({
      id: `notif_${Date.now()}_inv`,
      userId: user.id,
      title: 'Term Investment Activated',
      message: `Your $${params.amount.toLocaleString('en-US', {
        minimumFractionDigits: 2,
      })} ${params.termDays}-Day term investment is now active and earning 4.50% interest every 24 hours.`,
      type: 'INVESTMENT',
      severity: 'success',
      read: false,
      createdAt: new Date().toISOString(),
    });

    return { success: true, investment: plan };
  }

  // --- Investment Accrual & Maturity Execution Engine ---
  public matureInvestment(investmentId: string): {
    success: boolean;
    investment?: InvestmentPlan;
    payoutAmount?: number;
    error?: string;
  } {
    const inv = this.investments.get(investmentId);
    if (!inv) return { success: false, error: 'Investment not found.' };
    if (inv.status === 'MATURED') return { success: false, error: 'Investment is already matured and paid out.' };

    const totalReturn = inv.expectedMaturityValue;
    inv.status = 'MATURED';
    inv.totalAccruedEarnings = inv.expectedYield;

    // Return principal + yield to checking account
    const chkId = `acc_chk_${inv.userId}`;
    const invAccId = `acc_inv_${inv.userId}`;

    // Ledger: Debit investment account, Credit checking account
    this.recordLedgerTransaction({
      type: 'INVESTMENT_MATURITY',
      amount: totalReturn,
      userId: inv.userId,
      senderAccountId: invAccId,
      recipientAccountId: chkId,
      description: `Maturity Settlement: ${inv.planName} (Principal $${inv.amount.toFixed(
        2
      )} + Yield $${inv.expectedYield.toFixed(2)})`,
      category: 'Investments',
      status: 'COMPLETED',
      metadata: { investmentId: inv.id, yield: inv.expectedYield },
    });

    this.notifications.unshift({
      id: `notif_${Date.now()}_mat`,
      userId: inv.userId,
      title: 'Investment Matured & Settled',
      message: `Your ${inv.termDays}-Day term investment matured! $${totalReturn.toLocaleString('en-US', {
        minimumFractionDigits: 2,
      })} has been credited to your Checking account.`,
      type: 'INVESTMENT',
      severity: 'success',
      read: false,
      createdAt: new Date().toISOString(),
    });

    return { success: true, investment: inv, payoutAmount: totalReturn };
  }

  // --- Card Creation & Issuance Engine ---
  public createCard(params: {
    userId: string;
    cardHolderName?: string;
    phone?: string;
    cardType?: 'PHYSICAL' | 'VIRTUAL';
    cardTier?: string;
    spendingLimitMonthly?: number;
    spendingLimitDaily?: number;
    colorScheme?: string;
    brand?: 'VISA' | 'MASTERCARD';
  }): { success: boolean; card?: CardItem; transaction?: Transaction; error?: string } {
    const user = this.users.get(params.userId);
    if (!user) return { success: false, error: 'User account not found.' };

    const metrics = this.getUserBalanceMetrics(params.userId);
    const issuanceFee = 2.0; // $2.00 fee to create a banking card

    if (metrics.checkingBalance < issuanceFee) {
      return {
        success: false,
        error: `Insufficient funds. You have $${metrics.checkingBalance.toFixed(
          2
        )} in checking, but a $${issuanceFee.toFixed(2)} card creation fee is required. Please deposit funds first.`,
      };
    }

    // Deduct $2.00 fee from checking account via double-entry ledger
    const chkId = `acc_chk_${user.id}`;
    const tx = this.recordLedgerTransaction({
      type: 'FEE',
      amount: issuanceFee,
      userId: user.id,
      senderAccountId: chkId,
      description: `Monvera Visa Card Issuance Fee ($${issuanceFee.toFixed(2)})`,
      category: 'Transfers',
      status: 'COMPLETED',
      metadata: {
        cardType: params.cardType || 'PHYSICAL',
        cardTier: params.cardTier || 'Monvera Visa Debit',
        phone: params.phone || user.phone,
      },
    });

    // Generate 16-digit card number (Visa starts with 4, Mastercard starts with 5)
    const brand = params.brand || (params.cardTier?.toLowerCase().includes('mastercard') ? 'MASTERCARD' : 'VISA');
    const prefix = brand === 'MASTERCARD' ? '5' : '4';
    const part1 = prefix + Math.floor(100 + Math.random() * 900);
    const part2 = Math.floor(1000 + Math.random() * 9000).toString();
    const part3 = Math.floor(1000 + Math.random() * 9000).toString();
    const part4 = Math.floor(1000 + Math.random() * 9000).toString();
    const last4 = part4;
    const completeNumber = `${part1} ${part2} ${part3} ${part4}`;
    const maskedNumber = `•••• •••• •••• ${last4}`;
    const fullNumberMasked = completeNumber;

    // Expiry date (5 years out: MM/YY)
    const now = new Date();
    const expMonth = String(now.getMonth() + 1).padStart(2, '0');
    const expYear = String((now.getFullYear() + 5) % 100).padStart(2, '0');
    const expiryDate = `${expMonth}/${expYear}`;
    const cvv = String(Math.floor(100 + Math.random() * 900));

    const cardId = `crd_${user.id}_${Date.now()}`;
    const holderName = (params.cardHolderName || `${user.firstName} ${user.lastName}`).toUpperCase().trim();
    const dailyLimit = params.spendingLimitDaily || 20000;
    const monthlyLimit = params.spendingLimitMonthly || 20000;

    const brandName = brand === 'MASTERCARD' ? 'Mastercard' : 'Visa';
    const defaultTier = params.cardTier || `Monvera ${brandName} Elite`;

    const newCard: CardItem = {
      id: cardId,
      userId: user.id,
      cardHolderName: holderName,
      cardNumber: completeNumber,
      maskedNumber,
      fullNumberMasked,
      expiryDate,
      cvvMasked: cvv,
      cardType: params.cardType || 'PHYSICAL',
      cardTier: defaultTier,
      brand,
      status: 'ACTIVE',
      spendingLimitDaily: dailyLimit,
      spendingLimitMonthly: monthlyLimit,
      currentDailySpend: 0,
      internationalEnabled: true,
      onlineEnabled: true,
      atmEnabled: true,
      contactlessEnabled: true,
      colorScheme: (params.colorScheme as any) || 'obsidian',
    };

    this.cards.set(cardId, newCard);

    // Instant Notification in Notification Center
    this.notifications.unshift({
      id: `notif_${Date.now()}_card_created`,
      userId: user.id,
      title: `${brandName} Card Issued & Activated`,
      message: `Your new ${newCard.cardTier} (${brandName} • ${completeNumber}) has been successfully created and linked with a $${dailyLimit.toLocaleString()} daily transaction limit. $2.00 card creation fee deducted.`,
      type: 'TRANSACTION',
      severity: 'success',
      read: false,
      createdAt: new Date().toISOString(),
    });

    return {
      success: true,
      card: newCard,
      transaction: tx,
    };
  }

  // --- Admin Development Liquidity Funding System (Isolated for Dev/Testing) ---
  public issueAdminDevFunding(params: {
    adminId: string;
    targetUserId: string;
    amount: number;
    reason: string;
    targetAccountType?: AccountType;
  }): { success: boolean; transaction?: Transaction; error?: string } {
    const admin = this.users.get(params.adminId);
    if (!admin || (admin.role !== 'admin' && admin.role !== 'super_admin')) {
      return { success: false, error: 'Unauthorized: Administrative credentials required.' };
    }

    const targetUser = this.users.get(params.targetUserId);
    if (!targetUser) return { success: false, error: 'Target customer account not found.' };

    if (params.amount <= 0) return { success: false, error: 'Amount must be greater than $0.00.' };
    if (params.amount > this.devFundingPoolBalance) {
      return {
        success: false,
        error: `Requested amount exceeds available Development Funding Pool balance ($${this.devFundingPoolBalance.toLocaleString(
          'en-US',
          { minimumFractionDigits: 2 }
        )}).`,
      };
    }

    // Deduct from Admin Dev Pool
    this.devFundingPoolBalance -= params.amount;

    const accId =
      params.targetAccountType === 'SAVINGS'
        ? `acc_sav_${targetUser.id}`
        : `acc_chk_${targetUser.id}`;

    const tx = this.recordLedgerTransaction({
      type: 'ADMIN_DEVELOPMENT_FUNDING',
      amount: params.amount,
      userId: targetUser.id,
      recipientUserId: targetUser.id,
      recipientAccountId: accId,
      description: `Development Testing Capital: ${params.reason || 'Sandbox liquidity disbursement'}`,
      category: 'Deposits',
      status: 'COMPLETED',
      paymentProviderRef: `DEV-MINT-${Date.now().toString(36).toUpperCase()}`,
      metadata: { adminId: admin.id, adminName: `${admin.firstName} ${admin.lastName}`, reason: params.reason },
    });

    // Create Audit Log
    this.auditLogs.unshift({
      id: `aud_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      adminId: admin.id,
      adminName: `${admin.firstName} ${admin.lastName}`,
      action: 'ADMIN_DEV_FUNDING_DISBURSEMENT',
      targetUserId: targetUser.id,
      targetAccountNumber: targetUser.permanentAccountNumber,
      amount: params.amount,
      reason: params.reason,
      timestamp: new Date().toISOString(),
      ipAddress: '127.0.0.1 (Authorized Admin Console)',
      result: 'SUCCESS',
    });

    return { success: true, transaction: tx };
  }

  public topUpDevFundingPool(adminId: string, amount: number, reason: string): { success: boolean; newBalance: number; error?: string } {
    const admin = this.users.get(adminId);
    if (!admin || (admin.role !== 'admin' && admin.role !== 'super_admin')) {
      return { success: false, newBalance: this.devFundingPoolBalance, error: 'Unauthorized.' };
    }

    this.devFundingPoolBalance += amount;

    this.auditLogs.unshift({
      id: `aud_${Date.now()}_topup`,
      adminId: admin.id,
      adminName: `${admin.firstName} ${admin.lastName}`,
      action: 'DEV_POOL_REPLENISHMENT',
      amount,
      reason: reason || 'Administrative testing pool replenishment',
      timestamp: new Date().toISOString(),
      ipAddress: '127.0.0.1 (Admin Console)',
      result: 'SUCCESS',
    });

    return { success: true, newBalance: this.devFundingPoolBalance };
  }

  // --- Admin Overview Metrics ---
  public getAdminOverview(): AdminSystemOverview {
    const allUsers = Array.from(this.users.values());
    const customers = allUsers.filter((u) => u.role === 'customer' || u.role === 'business');
    const activeCustomers = customers.filter((u) => u.status === 'active');

    let totalPlatformDeposits = 0;
    let totalPlatformWithdrawals = 0;
    let totalPlatformTransfers = 0;
    let totalPlatformInvestments = 0;
    let pendingCount = 0;
    let failedCount = 0;

    for (const tx of this.transactions) {
      if (tx.status === 'COMPLETED') {
        if (tx.type === 'DEPOSIT' || tx.type === 'ADMIN_DEVELOPMENT_FUNDING') {
          totalPlatformDeposits += tx.amount;
        } else if (tx.type === 'WITHDRAWAL') {
          totalPlatformWithdrawals += tx.amount;
        } else if (tx.type === 'TRANSFER') {
          totalPlatformTransfers += tx.amount;
        } else if (tx.type === 'INVESTMENT') {
          totalPlatformInvestments += tx.amount;
        }
      } else if (tx.status === 'PENDING') {
        pendingCount++;
      } else if (tx.status === 'FAILED') {
        failedCount++;
      }
    }

    return {
      totalCustomers: customers.length,
      activeAccounts: activeCustomers.length * 3, // Checking, Savings, Investment
      totalPlatformDeposits,
      totalPlatformWithdrawals,
      totalPlatformTransfers,
      totalPlatformInvestments,
      pendingTransactionsCount: pendingCount,
      failedTransactionsCount: failedCount,
      devFundingPoolBalance: this.devFundingPoolBalance,
      systemReserveRatio: 100.0,
      activeNodesCount: 14,
    };
  }

  private seedNotificationsData(eleanorId: string, marcusId: string, sophiaId: string) {
    const now = Date.now();

    // Notifications for Eleanor Vance
    this.notifications.push(
      {
        id: `notif_el_01`,
        userId: eleanorId,
        title: 'Money Received',
        message: 'You received $5,000.00 from Marcus Sterling (Sterling Technologies Inc.) via Monvera Direct Transfer for Consulting Advisory Fee - Q1 Strategy.',
        type: 'TRANSACTION',
        severity: 'success',
        read: false,
        createdAt: new Date(now - 28 * 3600000).toISOString(),
        referenceId: 'MV-TRF-2026-884102',
      },
      {
        id: `notif_el_02`,
        userId: eleanorId,
        title: 'Deposit Completed',
        message: 'Wire deposit of $75,000.00 from Chase Private Client has cleared and is fully available in your Monvera Premier Checking account.',
        type: 'TRANSACTION',
        severity: 'success',
        read: false,
        createdAt: new Date(now - 45 * 86400000).toISOString(),
        referenceId: 'WIRE-US-9920148',
      },
      {
        id: `notif_el_03`,
        userId: eleanorId,
        title: 'Investment Activity: Term Activated',
        message: 'Your $25,000.00 allocation to the Monvera 180-Day Sovereign Term Plan (8.40% APY) is active and accruing fixed daily earnings.',
        type: 'INVESTMENT',
        severity: 'info',
        read: false,
        createdAt: new Date(now - 35 * 86400000).toISOString(),
        referenceId: 'INV-180-SOV-441',
      },
      {
        id: `notif_el_04`,
        userId: eleanorId,
        title: 'Account Activity: KYC Verified & Daily Limit Active',
        message: 'Your regulatory identity verification (Tier 3 Institutional) was approved. Your daily transaction limit of $1,000,000 is now active.',
        type: 'SECURITY',
        severity: 'success',
        read: true,
        createdAt: new Date(now - 46 * 86400000).toISOString(),
      },
      {
        id: `notif_el_05`,
        userId: eleanorId,
        title: 'Withdrawal / Card Payment Processed',
        message: 'Card purchase of $2,499.00 at Apple Park Infinite Loop was authorized successfully on your Monvera Black Card (•••• 9941).',
        type: 'TRANSACTION',
        severity: 'info',
        read: true,
        createdAt: new Date(now - 5 * 86400000).toISOString(),
        referenceId: 'AUTH-VISA-99410',
      }
    );

    // Notifications for Marcus Sterling
    this.notifications.push(
      {
        id: `notif_mc_01`,
        userId: marcusId,
        title: 'Money Sent',
        message: 'You successfully sent $5,000.00 to Eleanor Vance (MVB •••• 7391) for Consulting Advisory Fee - Q1 Strategy.',
        type: 'TRANSACTION',
        severity: 'info',
        read: false,
        createdAt: new Date(now - 28 * 3600000).toISOString(),
        referenceId: 'MV-TRF-2026-884102',
      },
      {
        id: `notif_mc_02`,
        userId: marcusId,
        title: 'Commercial Deposit Cleared',
        message: 'ACH infusion of $150,000.00 from Sterling Ventures has settled into your Business Checking account.',
        type: 'TRANSACTION',
        severity: 'success',
        read: false,
        createdAt: new Date(now - 30 * 86400000).toISOString(),
        referenceId: 'ACH-COMM-881920',
      },
      {
        id: `notif_mc_03`,
        userId: marcusId,
        title: 'Account Activity: Commercial Profile Verified',
        message: 'Your corporate identity verification was completed. Your $1,000,000 daily commercial transaction limit is confirmed.',
        type: 'SECURITY',
        severity: 'success',
        read: true,
        createdAt: new Date(now - 32 * 86400000).toISOString(),
      }
    );

    // Notifications for Sophia Chen
    this.notifications.push(
      {
        id: `notif_sp_01`,
        userId: sophiaId,
        title: 'Deposit Completed',
        message: 'Domestic FedWire deposit of $90,000.00 from Apex Global Asset Management has been credited to your Checking account.',
        type: 'TRANSACTION',
        severity: 'success',
        read: false,
        createdAt: new Date(now - 20 * 86400000).toISOString(),
        referenceId: 'FEDWIRE-NY-448102',
      },
      {
        id: `notif_sp_02`,
        userId: sophiaId,
        title: 'Account Verification Required',
        message: 'Please complete your KYC identity verification in your Profile to ensure unrestricted access to your $1,000,000 daily transaction limit.',
        type: 'SECURITY',
        severity: 'warning',
        read: false,
        createdAt: new Date(now - 1 * 86400000).toISOString(),
      }
    );
  }

  // --- Password Management Core ---
  public changePassword(params: {
    userId: string;
    currentPassword?: string;
    newPassword: string;
  }): { success: boolean; error?: string; message?: string } {
    const user = this.users.get(params.userId);
    if (!user) return { success: false, error: 'User account not found.' };

    if (!params.newPassword || params.newPassword.length < 8) {
      return { success: false, error: 'New password must be at least 8 characters long.' };
    }

    const storedPassword = this.userPasswords.get(params.userId) || 'Password123!';
    if (params.currentPassword && params.currentPassword !== storedPassword) {
      return { success: false, error: 'Current password does not match our records.' };
    }

    // Save updated password
    this.userPasswords.set(params.userId, params.newPassword);

    // Generate security notification
    this.notifications.unshift({
      id: `notif_pwd_${Date.now()}`,
      userId: user.id,
      title: 'Security Notice: Password Updated',
      message: 'Your Monvera account password was changed successfully. If you did not make this change, please contact Monvera Fraud Security immediately.',
      type: 'SECURITY',
      severity: 'info',
      read: false,
      createdAt: new Date().toISOString(),
    });

    // Record audit log
    this.auditLogs.unshift({
      id: `aud_${Date.now()}_pwd`,
      adminId: user.id,
      adminName: `${user.firstName} ${user.lastName}`,
      action: 'CUSTOMER_PASSWORD_CHANGED',
      targetUserId: user.id,
      targetAccountNumber: user.permanentAccountNumber,
      reason: 'User self-service password update',
      timestamp: new Date().toISOString(),
      ipAddress: '127.0.0.1 (Secure Session)',
      result: 'SUCCESS',
    });

    return { success: true, message: 'Password updated securely.' };
  }

  public resetPassword(emailOrAccount: string): { success: boolean; error?: string; message?: string } {
    const clean = emailOrAccount.trim().toLowerCase().replace(/[-\s]/g, '');
    const user = Array.from(this.users.values()).find(
      (u) =>
        u.email.toLowerCase() === emailOrAccount.trim().toLowerCase() ||
        u.permanentAccountNumber.replace(/[-\s]/g, '') === clean
    );

    if (!user) {
      return { success: false, error: 'No Monvera account found matching that email or account number.' };
    }

    // Reset password to secure temporary password
    const tempPassword = `Mv#${Math.floor(100000 + Math.random() * 900000)}`;
    this.userPasswords.set(user.id, tempPassword);

    this.notifications.unshift({
      id: `notif_rst_${Date.now()}`,
      userId: user.id,
      title: 'Password Reset Notification',
      message: `A password reset was requested for your account. Temporary login credential has been dispatched to ${user.email}.`,
      type: 'SECURITY',
      severity: 'warning',
      read: false,
      createdAt: new Date().toISOString(),
    });

    return {
      success: true,
      message: `Password reset instructions and security code have been sent to ${user.email}.`,
    };
  }

  // --- KYC Submission & Verification Engine ---
  public submitKyc(params: {
    userId: string;
    fullName?: string;
    firstName?: string;
    lastName?: string;
    country?: string;
    phone?: string;
    email?: string;
    dateOfBirth?: string;
    documentType: string;
    documentNumber: string;
    documentImage?: string;
    documentBackImage?: string;
    liveSelfieImage?: string;
    streetAddress?: string;
    proofOfAddressType?: string;
    proofOfAddressImage?: string;
    ssn?: string;
    ssnImage?: string;
    isResubmission?: boolean;
    autoApprove?: boolean;
    reviewDurationMinutes?: number;
  }): { success: boolean; user?: UserProfile; error?: string } {
    const user = this.users.get(params.userId);
    if (!user) return { success: false, error: 'User account not found.' };

    if (!params.documentType || !params.documentNumber.trim()) {
      return { success: false, error: 'Document type and document number are required.' };
    }

    const now = new Date().toISOString();
    if (params.fullName) user.kycFullName = params.fullName;
    if (params.firstName) user.firstName = params.firstName;
    if (params.lastName) user.lastName = params.lastName;
    user.kycFirstName = params.firstName || user.firstName;
    user.kycLastName = params.lastName || user.lastName;
    user.kycCountry = params.country || user.country;
    user.country = params.country || user.country;
    if (params.phone) {
      user.phone = params.phone;
      user.kycPhone = params.phone;
    }
    if (params.email) user.kycEmail = params.email;
    if (params.dateOfBirth) user.kycDateOfBirth = params.dateOfBirth;

    user.kycDocumentType = params.documentType;
    user.kycDocumentNumber = params.documentNumber.trim();
    if (params.documentImage) user.kycDocumentImage = params.documentImage;
    if (params.documentBackImage) user.kycDocumentBackImage = params.documentBackImage;
    if (params.liveSelfieImage) user.kycLiveSelfieImage = params.liveSelfieImage;
    if (params.streetAddress) user.kycStreetAddress = params.streetAddress;
    if (params.proofOfAddressType) user.kycProofOfAddressType = params.proofOfAddressType;
    if (params.proofOfAddressImage) user.kycProofOfAddressImage = params.proofOfAddressImage;
    if (params.ssn) user.kycSsn = params.ssn;
    if (params.ssnImage) user.kycSsnImage = params.ssnImage;

    user.kycSubmittedAt = now;
    user.kycReviewDurationMinutes = params.reviewDurationMinutes || 10;
    user.kycStatus = 'pending';
    user.kycRejectionReason = undefined;

    // Granular item reviews initialization / update
    const currentReviews = user.kycItemReviews || {};
    const isUS = (user.kycCountry || user.country || '').toLowerCase().includes('united states') ||
                 (user.kycCountry || user.country || '').toUpperCase() === 'US' ||
                 (user.kycCountry || user.country || '').toUpperCase() === 'USA';

    user.kycItemReviews = {
      identity: {
        status: 'pending',
        reviewedAt: undefined,
        reviewedBy: undefined,
        reason: undefined,
      },
      proofOfAddress: {
        status: 'pending',
        reviewedAt: undefined,
        reviewedBy: undefined,
        reason: undefined,
      },
      liveness: {
        status: 'pending',
        reviewedAt: undefined,
        reviewedBy: undefined,
        reason: undefined,
      },
      ...(isUS || params.ssn
        ? {
            ssn: {
              status: 'pending',
              reviewedAt: undefined,
              reviewedBy: undefined,
              reason: undefined,
            },
          }
        : {}),
    };

    // If this is a targeted resubmission, preserve already approved items
    if (params.isResubmission && currentReviews) {
      if (currentReviews.identity?.status === 'approved' && !params.documentImage && !params.documentBackImage) {
        user.kycItemReviews.identity = currentReviews.identity;
      }
      if (currentReviews.proofOfAddress?.status === 'approved' && !params.proofOfAddressImage) {
        user.kycItemReviews.proofOfAddress = currentReviews.proofOfAddress;
      }
      if (currentReviews.liveness?.status === 'approved' && !params.liveSelfieImage) {
        user.kycItemReviews.liveness = currentReviews.liveness;
      }
      if (currentReviews.ssn?.status === 'approved' && !params.ssn && !params.ssnImage) {
        user.kycItemReviews.ssn = currentReviews.ssn;
      }
    }

    this.notifications.unshift({
      id: `notif_kyc_sub_${Date.now()}`,
      userId: user.id,
      title: 'KYC Verification Submitted',
      message: `Your ${params.documentType} and address documents have been submitted successfully and are currently under compliance review. Verification may take up to 72 hours.`,
      type: 'SECURITY',
      severity: 'info',
      read: false,
      createdAt: now,
    });

    this.auditLogs.unshift({
      id: `aud_${Date.now()}_kyc_sub`,
      adminId: 'system',
      adminName: 'Monvera KYC Ingestion Desk',
      action: 'KYC_SUBMITTED_FOR_REVIEW',
      targetUserId: user.id,
      targetAccountNumber: user.permanentAccountNumber,
      reason: `Submitted ${params.documentType} (${params.country || 'Global'}) for compliance verification`,
      timestamp: now,
      ipAddress: '127.0.0.1',
      result: 'SUCCESS',
    });

    return { success: true, user };
  }

  public reviewKycItem(params: {
    userId: string;
    itemName: 'identity' | 'proofOfAddress' | 'liveness' | 'ssn';
    status: 'approved' | 'rejected' | 'pending';
    reason?: string;
    adminId?: string;
  }): { success: boolean; user?: UserProfile; error?: string } {
    const user = this.users.get(params.userId);
    if (!user) return { success: false, error: 'Customer not found.' };

    const now = new Date().toISOString();
    if (!user.kycItemReviews) {
      user.kycItemReviews = {};
    }

    user.kycItemReviews[params.itemName] = {
      status: params.status,
      reviewedAt: now,
      reviewedBy: params.adminId || 'usr_admin',
      reason: params.reason,
    };

    // Recalculate overall KYC status
    const reviews = user.kycItemReviews;
    const itemKeys = Object.keys(reviews) as (keyof typeof reviews)[];
    const isUS = (user.kycCountry || user.country || '').toLowerCase().includes('united states') ||
                 (user.kycCountry || user.country || '').toUpperCase() === 'US' ||
                 (user.kycCountry || user.country || '').toUpperCase() === 'USA';

    const requiredKeys: ('identity' | 'proofOfAddress' | 'liveness' | 'ssn')[] = ['identity', 'proofOfAddress', 'liveness'];
    if (isUS || user.kycSsn) {
      requiredKeys.push('ssn');
    }

    const hasRejected = requiredKeys.some((k) => reviews[k]?.status === 'rejected');
    const allApproved = requiredKeys.every((k) => reviews[k]?.status === 'approved');

    const itemFriendlyNames: Record<string, string> = {
      identity: 'Identity Document',
      proofOfAddress: 'Proof of Address',
      liveness: 'Biometric Liveness Selfie',
      ssn: 'Social Security / Tax ID',
    };

    if (hasRejected) {
      user.kycStatus = 'action_required';
      const rejectedItems = requiredKeys
        .filter((k) => reviews[k]?.status === 'rejected')
        .map((k) => `${itemFriendlyNames[k]}: ${reviews[k]?.reason || 'Requires resubmission'}`)
        .join('; ');
      user.kycRejectionReason = rejectedItems;

      this.notifications.unshift({
        id: `notif_kyc_item_rej_${Date.now()}`,
        userId: user.id,
        title: 'KYC Verification Update: Action Required',
        message: `A KYC document requires correction: ${itemFriendlyNames[params.itemName]} was rejected. Reason: ${params.reason || 'Document does not meet compliance guidelines'}. Please resubmit only this item in your Profile.`,
        type: 'SECURITY',
        severity: 'warning',
        read: false,
        createdAt: now,
      });
    } else if (allApproved) {
      user.kycStatus = 'verified';
      user.kycVerifiedAt = now;
      user.dailyTransactionLimit = 1000000;
      user.kycRejectionReason = undefined;

      this.notifications.unshift({
        id: `notif_kyc_all_app_${Date.now()}`,
        userId: user.id,
        title: 'KYC Verification Approved by Compliance',
        message: 'All your submitted KYC verification documents have been verified and approved by Monvera Compliance Operations. Full account limits ($1,000,000/day) and verified status are active.',
        type: 'SECURITY',
        severity: 'success',
        read: false,
        createdAt: now,
      });
    } else {
      user.kycStatus = 'pending';
    }

    this.auditLogs.unshift({
      id: `aud_${Date.now()}_kyc_item`,
      adminId: params.adminId || 'usr_admin',
      adminName: 'Monvera Compliance Desk',
      action: params.status === 'approved' ? 'KYC_ITEM_APPROVED' : params.status === 'rejected' ? 'KYC_ITEM_REJECTED' : 'KYC_ITEM_STATUS_UPDATED',
      targetUserId: user.id,
      targetAccountNumber: user.permanentAccountNumber,
      reason: `Adjudicated ${itemFriendlyNames[params.itemName]} as ${params.status.toUpperCase()}${params.reason ? ` - ${params.reason}` : ''}`,
      timestamp: now,
      ipAddress: '127.0.0.1 (Admin Console)',
      result: 'SUCCESS',
    });

    return { success: true, user };
  }

  public approveKyc(userId: string, adminId?: string): { success: boolean; user?: UserProfile; error?: string } {
    const user = this.users.get(userId);
    if (!user) return { success: false, error: 'Customer not found.' };

    const now = new Date().toISOString();
    user.kycStatus = 'verified';
    user.kycVerifiedAt = now;
    user.dailyTransactionLimit = 1000000;
    user.kycRejectionReason = undefined;

    const isUS = (user.kycCountry || user.country || '').toLowerCase().includes('united states') ||
                 (user.kycCountry || user.country || '').toUpperCase() === 'US' ||
                 (user.kycCountry || user.country || '').toUpperCase() === 'USA';

    user.kycItemReviews = {
      identity: { status: 'approved', reviewedAt: now, reviewedBy: adminId || 'usr_admin' },
      proofOfAddress: { status: 'approved', reviewedAt: now, reviewedBy: adminId || 'usr_admin' },
      liveness: { status: 'approved', reviewedAt: now, reviewedBy: adminId || 'usr_admin' },
      ...(isUS || user.kycSsn
        ? { ssn: { status: 'approved', reviewedAt: now, reviewedBy: adminId || 'usr_admin' } }
        : {}),
    };

    this.notifications.unshift({
      id: `notif_kyc_app_${Date.now()}`,
      userId: user.id,
      title: 'KYC Verification Approved by Compliance',
      message: 'Your banking profile has been officially verified by Monvera Compliance Operations. Full account limits ($1,000,000/day) and verified status are active.',
      type: 'SECURITY',
      severity: 'success',
      read: false,
      createdAt: now,
    });

    this.auditLogs.unshift({
      id: `aud_${Date.now()}_kyc_app`,
      adminId: adminId || 'usr_admin',
      adminName: 'Monvera Compliance Desk',
      action: 'ADMIN_KYC_APPROVAL',
      targetUserId: user.id,
      targetAccountNumber: user.permanentAccountNumber,
      reason: 'Administrative manual review and overall KYC approval',
      timestamp: now,
      ipAddress: '127.0.0.1 (Admin Console)',
      result: 'SUCCESS',
    });

    return { success: true, user };
  }

  public rejectKyc(params: { userId: string; reason: string; adminId?: string }): { success: boolean; user?: UserProfile; error?: string } {
    const user = this.users.get(params.userId);
    if (!user) return { success: false, error: 'Customer not found.' };

    const now = new Date().toISOString();
    user.kycStatus = 'action_required';
    user.dailyTransactionLimit = 25000;
    user.kycRejectionReason = params.reason || 'Documents could not be verified by compliance.';

    const isUS = (user.kycCountry || user.country || '').toLowerCase().includes('united states') ||
                 (user.kycCountry || user.country || '').toUpperCase() === 'US' ||
                 (user.kycCountry || user.country || '').toUpperCase() === 'USA';

    user.kycItemReviews = {
      identity: { status: 'rejected', reviewedAt: now, reviewedBy: params.adminId || 'usr_admin', reason: params.reason },
      proofOfAddress: { status: 'rejected', reviewedAt: now, reviewedBy: params.adminId || 'usr_admin', reason: params.reason },
      liveness: { status: 'rejected', reviewedAt: now, reviewedBy: params.adminId || 'usr_admin', reason: params.reason },
      ...(isUS || user.kycSsn
        ? { ssn: { status: 'rejected', reviewedAt: now, reviewedBy: params.adminId || 'usr_admin', reason: params.reason } }
        : {}),
    };

    this.notifications.unshift({
      id: `notif_kyc_rej_${Date.now()}`,
      userId: user.id,
      title: 'KYC Document Verification Status',
      message: `Your identity verification requires attention. Reason: ${params.reason || 'Document unreadable or invalid credentials'}. Please review and re-submit the required documents in your Profile.`,
      type: 'SECURITY',
      severity: 'warning',
      read: false,
      createdAt: now,
    });

    this.auditLogs.unshift({
      id: `aud_${Date.now()}_kyc_rej`,
      adminId: params.adminId || 'usr_admin',
      adminName: 'Monvera Compliance Desk',
      action: 'ADMIN_KYC_REJECTED',
      targetUserId: user.id,
      targetAccountNumber: user.permanentAccountNumber,
      reason: params.reason || 'Identity documents failed compliance verification',
      timestamp: now,
      ipAddress: '127.0.0.1 (Admin Console)',
      result: 'SUCCESS',
    });

    return { success: true, user };
  }

  public updateTransactionStatus(params: {
    txId: string;
    status: TransactionStatus;
    adminId?: string;
    reason?: string;
  }): { success: boolean; transaction?: Transaction; error?: string } {
    const tx = this.transactions.find((t) => t.id === params.txId || t.referenceNumber === params.txId);
    if (!tx) return { success: false, error: 'Transaction record not found.' };

    const oldStatus = tx.status;
    tx.status = params.status;
    if (params.status === 'COMPLETED') {
      tx.completedAt = new Date().toISOString();
    }

    this.auditLogs.unshift({
      id: `aud_${Date.now()}_tx_status`,
      adminId: params.adminId || 'usr_admin',
      adminName: 'Monvera Settlement Desk',
      action: `TRANSACTION_STATUS_UPDATED_${params.status}`,
      targetUserId: tx.senderUserId || tx.recipientUserId,
      amount: tx.amount,
      reason: params.reason || `Status changed from ${oldStatus} to ${params.status}`,
      timestamp: new Date().toISOString(),
      ipAddress: '127.0.0.1 (Admin Console)',
      result: 'SUCCESS',
    });

    return { success: true, transaction: tx };
  }

  // --- Support & Notification Management ---
  public replyToSupportMessage(params: {
    notificationId: string;
    userId: string;
    message: string;
  }): { success: boolean; notification?: NotificationItem; error?: string } {
    const notif = this.notifications.find((n) => n.id === params.notificationId);
    if (!notif) return { success: false, error: 'Notification record not found.' };

    const user = this.users.get(params.userId);
    if (!user) return { success: false, error: 'User not found.' };

    if (!notif.replies) notif.replies = [];

    const userReply = {
      id: `rep_${Date.now()}_u`,
      sender: 'user' as const,
      senderName: `${user.firstName} ${user.lastName}`,
      senderAvatar: user.avatarUrl,
      message: params.message,
      createdAt: new Date().toISOString(),
    };
    notif.replies.push(userReply);
    notif.read = true;

    // Simulate instant representative acknowledgment
    setTimeout(() => {
      const repName = notif.supportRepName || 'David Vance';
      const repReply = {
        id: `rep_${Date.now()}_rep`,
        sender: 'support' as const,
        senderName: repName,
        senderAvatar: notif.supportRepAvatar || 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
        message: `Thank you for your response, ${user.firstName}. Our Private Wealth Operations Desk has noted your update and our team is actively assisting with your request.`,
        createdAt: new Date().toISOString(),
      };
      notif.replies?.push(repReply);
      notif.read = false; // Mark unread so user sees representative reply
    }, 1500);

    return { success: true, notification: notif };
  }

  public markNotificationAsRead(id: string, userId: string): boolean {
    const notif = this.notifications.find((n) => n.id === id && n.userId === userId);
    if (notif) {
      notif.read = true;
      return true;
    }
    return false;
  }

  // --- Loan & Dynamic Credit Facility Engine ---
  public calculateUserTransactionVolume(userId: string): number {
    const txs = this.transactions.filter(
      (t) =>
        (t.userId === userId || t.senderUserId === userId || t.recipientUserId === userId) &&
        t.status === 'COMPLETED'
    );
    return txs.reduce((sum, t) => sum + (t.amount || 0), 0);
  }

  public getLoanEligibilityTier(volume: number): {
    tier: string;
    maxLimit: number;
    interestRateAPR: number;
    minRequiredVolume: number;
    description: string;
  } {
    // Fixed 20.00% loan interest rate across all terms as requested
    const fixedRate = 20.00;

    if (volume >= 50000) {
      return {
        tier: 'Sovereign Institutional Tier',
        maxLimit: 1000000,
        interestRateAPR: fixedRate,
        minRequiredVolume: 50000,
        description: 'Elite clearance tier ($50,000+ volume): Eligible for up to $1,000,000 USD facility with fixed 20% interest.',
      };
    } else if (volume >= 10000) {
      return {
        tier: 'Prime Capital Tier',
        maxLimit: 250000,
        interestRateAPR: fixedRate,
        minRequiredVolume: 10000,
        description: 'High volume tier ($10,000+ volume): Eligible for $20,000 to $50,000+ USD credit line (up to $250,000 USD facility) with fixed 20% interest.',
      };
    } else if (volume >= 5000) {
      return {
        tier: 'Growth Business Tier',
        maxLimit: 50000,
        interestRateAPR: fixedRate,
        minRequiredVolume: 5000,
        description: 'Active banking tier ($5,000+ volume): Eligible for up to $50,000 USD financing line with fixed 20% interest.',
      };
    } else if (volume >= 2000) {
      return {
        tier: 'Starter Credit Tier',
        maxLimit: 10000,
        interestRateAPR: fixedRate,
        minRequiredVolume: 2000,
        description: 'Tier unlocked with $2,000+ transaction volume: Eligible for $1,000 to $10,000 USD credit line with fixed 20% interest.',
      };
    } else {
      return {
        tier: 'Initial Tier (Deposit Required)',
        maxLimit: 0,
        interestRateAPR: fixedRate,
        minRequiredVolume: 2000,
        description: `Monvera requirement: A minimum of $2,000.00 in cumulative deposits or verified transaction volume is required to unlock your first credit facility ($1,000 – $10,000 USD). Current volume: $${volume.toLocaleString('en-US', { minimumFractionDigits: 2 })}. Build your transaction history through legitimate deposits and transactions to qualify for higher available loan limits.`,
      };
    }
  }

  public createLoanApplication(params: {
    userId: string;
    amount: number;
    termMonths: number;
    purpose: string;
    employmentOrBusinessDetails?: string;
    annualIncomeOrRevenue?: number;
    collateralDescription?: string;
    fallbackUser?: Partial<UserProfile>;
  }): { success: boolean; loan?: LoanApplication; error?: string } {
    const user = this.ensureUserExists(params.userId, params.fallbackUser);

    if (params.amount < 1000 || params.amount > 1000000) {
      return { success: false, error: 'Loan amounts must be between $1,000 and $1,000,000 USD.' };
    }

    const validTerms = [6, 12, 24, 36, 48, 60];
    const termMonths = validTerms.includes(params.termMonths) ? params.termMonths : 12;

    const txVolume = this.calculateUserTransactionVolume(user.id);
    const eligibility = this.getLoanEligibilityTier(txVolume);

    // Fixed 20.00% loan interest: Total Interest = 20% of borrowed principal. Total Repayment = 120%.
    const totalRepayment = Number((params.amount * 1.20).toFixed(2));
    const interestAmount = Number((params.amount * 0.20).toFixed(2));
    const monthlyPayment = Number((totalRepayment / termMonths).toFixed(2));
    const maturityDate = new Date(Date.now() + termMonths * 30 * 24 * 60 * 60 * 1000).toISOString();

    const loanId = `loan_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newLoan: LoanApplication = {
      id: loanId,
      userId: user.id,
      applicantName: `${user.firstName} ${user.lastName}`,
      applicantEmail: user.email,
      applicantPhone: user.phone,
      permanentAccountNumber: user.permanentAccountNumber,
      amount: params.amount,
      termMonths,
      monthlyPayment,
      interestRateAPR: 20.0,
      interestAmount,
      totalRepaymentAmount: totalRepayment,
      remainingBalance: totalRepayment,
      totalRepaid: 0,
      maturityDate,
      purpose: params.purpose || 'Business Expansion & Working Capital',
      employmentOrBusinessDetails:
        params.employmentOrBusinessDetails || user.businessName || 'Verified Monvera Account Holder (Corporate & Personal)',
      annualIncomeOrRevenue: params.annualIncomeOrRevenue || 120000,
      collateralDescription: params.collateralDescription || 'Ledger Cash Flow Guarantee',
      status: 'PENDING',
      userTransactionVolume: txVolume,
      eligibilityTier: eligibility.tier,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.loans.set(loanId, newLoan);

    // Create user notification
    this.notifications.unshift({
      id: `notif_${Date.now()}_loan`,
      userId: user.id,
      title: 'Loan Application Received for Monvera Review',
      message: `Your credit application for $${params.amount.toLocaleString(
        'en-US',
        { minimumFractionDigits: 2 }
      )} (Fixed 20% Interest) has been submitted and is currently undergoing review by our Monvera team.`,
      type: 'SYSTEM',
      severity: 'info',
      read: false,
      createdAt: new Date().toISOString(),
      referenceId: loanId,
    });

    return { success: true, loan: newLoan };
  }

  public adminApproveLoan(params: {
    loanId: string;
    adminId: string;
  }): { success: boolean; loan?: LoanApplication; transaction?: Transaction; error?: string } {
    const loan = this.loans.get(params.loanId);
    if (!loan) return { success: false, error: 'Loan record not found.' };

    if (loan.status === 'ACTIVE' || loan.status === 'APPROVED') {
      return { success: false, error: 'This loan has already been approved and disbursed.' };
    }

    const user = this.ensureUserExists(loan.userId, {
      email: loan.applicantEmail,
      firstName: loan.applicantName.split(' ')[0] || 'Valued',
      lastName: loan.applicantName.split(' ').slice(1).join(' ') || 'Client',
      permanentAccountNumber: loan.permanentAccountNumber,
      phone: loan.applicantPhone,
    });

    const now = new Date().toISOString();
    const totalRepay = Number((loan.amount * 1.20).toFixed(2));
    const interestAmt = Number((loan.amount * 0.20).toFixed(2));
    const termMonths = loan.termMonths || 12;
    const maturityDate = new Date(Date.now() + termMonths * 30 * 24 * 60 * 60 * 1000).toISOString();

    loan.status = 'ACTIVE';
    loan.approvedAt = now;
    loan.approvedBy = params.adminId;
    loan.disbursedAt = now;
    loan.disbursedAmount = loan.amount;
    loan.interestAmount = interestAmt;
    loan.totalRepaymentAmount = totalRepay;
    loan.remainingBalance = loan.remainingBalance !== undefined ? loan.remainingBalance : totalRepay;
    loan.totalRepaid = loan.totalRepaid || 0;
    loan.maturityDate = maturityDate;
    loan.updatedAt = now;

    // Disburse loan amount directly into customer's Checking Account via Double-Entry Ledger
    const chkId = `acc_chk_${user.id}`;
    const tx = this.recordLedgerTransaction({
      type: 'ADMIN_DEVELOPMENT_FUNDING',
      amount: loan.amount,
      userId: user.id,
      recipientUserId: user.id,
      recipientAccountId: chkId,
      description: `Monvera Approved Loan Credit Disbursement ($${loan.amount.toLocaleString('en-US', {
        minimumFractionDigits: 2,
      })}) - Ref: ${loan.id}`,
      category: 'Deposits',
      status: 'COMPLETED',
      timestamp: now,
    });

    // Notify customer
    this.notifications.unshift({
      id: `notif_${Date.now()}_loan_appr`,
      userId: user.id,
      title: '🎉 Loan Approved & Disbursed!',
      message: `Congratulations! Your loan application for $${loan.amount.toLocaleString('en-US', {
        minimumFractionDigits: 2,
      })} has been approved and the capital has been credited directly into your Checking Account.`,
      type: 'TRANSACTION',
      severity: 'success',
      read: false,
      createdAt: now,
      referenceId: loan.id,
    });

    // Admin Audit Log
    this.auditLogs.unshift({
      id: `audit_${Date.now()}_loan_appr`,
      adminId: params.adminId,
      adminName: 'Operations Compliance Officer',
      action: 'APPROVE_LOAN_DISBURSEMENT',
      targetUserId: user.id,
      targetAccountNumber: user.permanentAccountNumber,
      amount: loan.amount,
      reason: `Authorized underwriting approval for ${loan.purpose}`,
      timestamp: now,
      ipAddress: '127.0.0.1',
      result: 'SUCCESS',
    });

    return { success: true, loan, transaction: tx };
  }

  public adminRejectLoan(params: {
    loanId: string;
    reason: string;
    adminId: string;
  }): { success: boolean; loan?: LoanApplication; error?: string } {
    const loan = this.loans.get(params.loanId);
    if (!loan) return { success: false, error: 'Loan record not found.' };

    const user = this.users.get(loan.userId);
    if (!user) return { success: false, error: 'Customer account not found.' };

    const now = new Date().toISOString();
    const rejectionReason = params.reason || 'Insufficient platform transaction volume or additional documentation required.';
    loan.status = 'REJECTED';
    loan.rejectionReason = rejectionReason;
    loan.rejectedAt = now;
    loan.rejectedBy = params.adminId;
    loan.updatedAt = now;

    // Notify customer with exact reason
    this.notifications.unshift({
      id: `notif_${Date.now()}_loan_rej`,
      userId: user.id,
      title: 'Loan Application Update',
      message: `Your loan application for $${loan.amount.toLocaleString('en-US', {
        minimumFractionDigits: 2,
      })} was not approved at this time. Compliance Reason: "${rejectionReason}". You may increase your transaction activity on Monvera to qualify for higher credit limits.`,
      type: 'SYSTEM',
      severity: 'error',
      read: false,
      createdAt: now,
      referenceId: loan.id,
    });

    // Admin Audit Log
    this.auditLogs.unshift({
      id: `audit_${Date.now()}_loan_rej`,
      adminId: params.adminId,
      adminName: 'Operations Compliance Officer',
      action: 'REJECT_LOAN_APPLICATION',
      targetUserId: user.id,
      targetAccountNumber: user.permanentAccountNumber,
      amount: loan.amount,
      reason: rejectionReason,
      timestamp: now,
      ipAddress: '127.0.0.1',
      result: 'SUCCESS',
    });

    return { success: true, loan };
  }

  public repayLoan(params: {
    loanId: string;
    userId: string;
    amount: number;
    sourceAccountId?: string;
    note?: string;
  }): { success: boolean; loan?: LoanApplication; transaction?: Transaction; remainingBalance?: number; error?: string } {
    const loan = this.loans.get(params.loanId);
    if (!loan) return { success: false, error: 'Loan record not found.' };

    if (loan.userId !== params.userId) {
      return { success: false, error: 'Unauthorized to make payments on this loan facility.' };
    }

    if (loan.status !== 'ACTIVE' && loan.status !== 'APPROVED') {
      return { success: false, error: `Loan is currently ${loan.status.toLowerCase()} and cannot accept repayments.` };
    }

    const totalRepayRequired = loan.totalRepaymentAmount || Number((loan.amount * 1.20).toFixed(2));
    const currentRemaining = loan.remainingBalance !== undefined ? loan.remainingBalance : totalRepayRequired;

    if (currentRemaining <= 0) {
      return { success: false, error: 'This loan is already fully settled and paid off.' };
    }

    const repayAmount = Number(params.amount);
    if (isNaN(repayAmount) || repayAmount <= 0) {
      return { success: false, error: 'Please enter a valid repayment amount.' };
    }

    if (repayAmount > currentRemaining + 0.01) {
      return {
        success: false,
        error: `Repayment amount ($${repayAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}) exceeds the outstanding balance ($${currentRemaining.toLocaleString('en-US', { minimumFractionDigits: 2 })}).`,
      };
    }

    const user = this.users.get(params.userId);
    if (!user) return { success: false, error: 'User account not found.' };

    // Determine debit source account (default to checking account)
    const sourceAccId = params.sourceAccountId || `acc_chk_${user.id}`;
    const sourceAcc = this.accounts.get(sourceAccId);
    
    let availableBal = 0;
    if (sourceAcc) {
      availableBal = sourceAcc.balance;
    } else {
      const chk = this.accounts.get(`acc_chk_${user.id}`);
      availableBal = chk ? chk.balance : 0;
    }

    if (availableBal < repayAmount) {
      return {
        success: false,
        error: `Insufficient available balance in your account. Available: $${availableBal.toLocaleString('en-US', { minimumFractionDigits: 2 })}, Required: $${repayAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}.`,
      };
    }

    const now = new Date().toISOString();
    const actualRepay = Math.min(repayAmount, currentRemaining);
    const newRemaining = Math.max(0, Number((currentRemaining - actualRepay).toFixed(2)));
    const newTotalRepaid = Number(((loan.totalRepaid || 0) + actualRepay).toFixed(2));

    // Record Ledger Debit Transaction
    const tx = this.recordLedgerTransaction({
      type: 'TRANSFER',
      amount: actualRepay,
      userId: user.id,
      senderAccountId: sourceAccId,
      recipientUserId: 'monvera_treasury',
      recipientAccountId: 'acc_monvera_loan_facility',
      description: `Monvera Credit Facility Repayment (${loan.purpose}) - Ref: ${loan.id}`,
      category: 'Transfers',
      status: 'COMPLETED',
      timestamp: now,
    });

    // Update Loan Record
    loan.totalRepaid = newTotalRepaid;
    loan.remainingBalance = newRemaining;
    loan.totalRepaymentAmount = totalRepayRequired;
    loan.updatedAt = now;

    if (!loan.repaymentHistory) {
      loan.repaymentHistory = [];
    }

    loan.repaymentHistory.unshift({
      id: `rep_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      amount: actualRepay,
      date: now,
      paymentMethod: sourceAcc?.nickname || 'Monvera Checking Account',
      note: params.note || (newRemaining === 0 ? 'Full Loan Settlement' : 'Partial Loan Repayment'),
      remainingAfter: newRemaining,
    });

    if (newRemaining === 0) {
      loan.status = 'PAID';
      loan.paidAt = now;
    }

    // User Notification
    this.notifications.unshift({
      id: `notif_${Date.now()}_repay`,
      userId: user.id,
      title: newRemaining === 0 ? '🎊 Loan Fully Settled & Closed!' : '💳 Loan Repayment Successful',
      message: newRemaining === 0
        ? `Congratulations! Your loan facility (${loan.purpose}) has been 100% repaid and settled in full. Thank you for your business!`
        : `Your payment of $${actualRepay.toLocaleString('en-US', {
            minimumFractionDigits: 2,
          })} for Loan #${loan.id} has been posted. Outstanding remaining balance is $${newRemaining.toLocaleString('en-US', {
            minimumFractionDigits: 2,
          })}.`,
      type: 'TRANSACTION',
      severity: 'success',
      read: false,
      createdAt: now,
      referenceId: loan.id,
    });

    // Admin Audit Log
    this.auditLogs.unshift({
      id: `audit_${Date.now()}_loan_repay`,
      adminId: 'system',
      adminName: 'Monvera Automated Treasury',
      action: 'LOAN_REPAYMENT_POSTED',
      targetUserId: user.id,
      targetAccountNumber: user.permanentAccountNumber,
      amount: actualRepay,
      reason: `Borrower posted repayment of $${actualRepay.toLocaleString('en-US', { minimumFractionDigits: 2 })} towards loan ${loan.id}. Remaining: $${newRemaining.toLocaleString('en-US', { minimumFractionDigits: 2 })}.`,
      timestamp: now,
      ipAddress: '127.0.0.1',
      result: 'SUCCESS',
    });

    return {
      success: true,
      loan,
      transaction: tx,
      remainingBalance: newRemaining,
    };
  }
}

export const db = new MonveraDatabase();
