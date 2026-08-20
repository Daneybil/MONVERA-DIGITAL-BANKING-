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
  public accounts: Map<string, BankAccount> = new Map();
  public transactions: Transaction[] = [];
  public ledgerEntries: LedgerEntry[] = [];
  public investments: Map<string, InvestmentPlan> = new Map();
  public investmentEarnings: InvestmentEarningLog[] = [];
  public cards: Map<string, CardItem> = new Map();
  public notifications: NotificationItem[] = [];
  public auditLogs: AdminAuditLog[] = [];
  public sessions: Map<string, SessionInfo[]> = new Map();
  public devFundingPoolBalance: number = 1000000000.0; // $1,000,000,000.00 Development Testing Liquidity Pool

  constructor() {
    this.seedInitialData();
  }

  private seedInitialData() {
    // 1. Seed Customer: Eleanor Vance
    const eleanorId = 'usr_eleanor';
    const eleanorAccNum = '1045827391';
    const eleanorUser: UserProfile = {
      id: eleanorId,
      username: 'eleanor',
      firstName: 'Eleanor',
      lastName: 'Vance',
      email: 'eleanor.vance@monvera.com',
      phone: '+1 (555) 234-8901',
      permanentAccountNumber: eleanorAccNum,
      dateOfBirth: '1989-04-14',
      country: 'United States',
      avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      status: 'active',
      role: 'customer',
      membershipTier: 'Private Wealth',
      twoFactorEnabled: true,
      createdAt: '2025-01-15T09:00:00Z',
    };
    this.users.set(eleanorId, eleanorUser);

    // 2. Seed Customer: Marcus Sterling (Business Entrepreneur)
    const marcusId = 'usr_marcus';
    const marcusAccNum = '1088492015';
    const marcusUser: UserProfile = {
      id: marcusId,
      username: 'marcus',
      firstName: 'Marcus',
      lastName: 'Sterling',
      email: 'marcus@sterlingtech.io',
      phone: '+1 (555) 892-4412',
      permanentAccountNumber: marcusAccNum,
      dateOfBirth: '1984-11-20',
      country: 'United States',
      avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
      status: 'active',
      role: 'business',
      membershipTier: 'Business Platinum',
      twoFactorEnabled: true,
      createdAt: '2025-02-01T11:30:00Z',
      businessName: 'Sterling Technologies Inc.',
    };
    this.users.set(marcusId, marcusUser);

    // 3. Seed Customer: Sophia Chen
    const sophiaId = 'usr_sophia';
    const sophiaAccNum = '1093847294';
    const sophiaUser: UserProfile = {
      id: sophiaId,
      username: 'sophia',
      firstName: 'Sophia',
      lastName: 'Chen',
      email: 'sophia.chen@monvera.com',
      phone: '+1 (555) 431-7788',
      permanentAccountNumber: sophiaAccNum,
      dateOfBirth: '1992-08-05',
      country: 'United States',
      avatarUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&auto=format&fit=crop&q=80',
      status: 'active',
      role: 'customer',
      membershipTier: 'Premier',
      twoFactorEnabled: true,
      createdAt: '2025-03-10T14:15:00Z',
    };
    this.users.set(sophiaId, sophiaUser);

    // 4. Seed Super Admin
    const adminId = 'usr_admin';
    const adminAccNum = '1000000001';
    const adminUser: UserProfile = {
      id: adminId,
      username: 'admin',
      firstName: 'Monvera',
      lastName: 'Operations',
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
    };
    this.users.set(adminId, adminUser);

    // Initialize Bank Accounts
    this.initUserAccounts(eleanorId, eleanorAccNum);
    this.initUserAccounts(marcusId, marcusAccNum);
    this.initUserAccounts(sophiaId, sophiaAccNum);
    this.initUserAccounts(adminId, adminAccNum);

    // Seed Cards for Eleanor
    const eleanorCardId = 'crd_el_01';
    this.cards.set(eleanorCardId, {
      id: eleanorCardId,
      userId: eleanorId,
      cardHolderName: 'ELEANOR VANCE',
      maskedNumber: '•••• •••• •••• 8829',
      fullNumberMasked: '4921 •••• •••• 8829',
      expiryDate: '08/29',
      cvvMasked: '•••',
      cardType: 'PHYSICAL',
      cardTier: 'Obsidian World Elite',
      status: 'ACTIVE',
      spendingLimitDaily: 15000,
      spendingLimitMonthly: 75000,
      currentDailySpend: 1420.5,
      internationalEnabled: true,
      onlineEnabled: true,
      atmEnabled: true,
      contactlessEnabled: true,
      colorScheme: 'obsidian',
    });

    const eleanorVirtualCardId = 'crd_el_02';
    this.cards.set(eleanorVirtualCardId, {
      id: eleanorVirtualCardId,
      userId: eleanorId,
      cardHolderName: 'ELEANOR VANCE',
      maskedNumber: '•••• •••• •••• 3410',
      fullNumberMasked: '5284 •••• •••• 3410',
      expiryDate: '12/28',
      cvvMasked: '•••',
      cardType: 'VIRTUAL',
      cardTier: 'Sapphire Debit',
      status: 'ACTIVE',
      spendingLimitDaily: 5000,
      spendingLimitMonthly: 25000,
      currentDailySpend: 230.0,
      internationalEnabled: false,
      onlineEnabled: true,
      atmEnabled: false,
      contactlessEnabled: true,
      colorScheme: 'emerald',
    });

    // Seed Cards for Marcus
    const marcusCardId = 'crd_mc_01';
    this.cards.set(marcusCardId, {
      id: marcusCardId,
      userId: marcusId,
      cardHolderName: 'MARCUS STERLING',
      maskedNumber: '•••• •••• •••• 9104',
      fullNumberMasked: '4119 •••• •••• 9104',
      expiryDate: '04/30',
      cvvMasked: '•••',
      cardType: 'PHYSICAL',
      cardTier: 'Titanium Business',
      status: 'ACTIVE',
      spendingLimitDaily: 50000,
      spendingLimitMonthly: 250000,
      currentDailySpend: 4850.0,
      internationalEnabled: true,
      onlineEnabled: true,
      atmEnabled: true,
      contactlessEnabled: true,
      colorScheme: 'titanium',
    });

    // Seed Initial Transactions and Ledger records
    this.seedLedgerTransactions(eleanorId, marcusId, sophiaId);

    // Seed Initial Term Investment for Eleanor (e.g. 180 Days Term)
    const inv1Id = 'inv_el_01';
    const inv1StartDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(); // 35 days ago
    const inv1MaturityDate = new Date(Date.now() + 145 * 24 * 60 * 60 * 1000).toISOString();
    const invAmount = 25000;
    const invDailyRate = 4.5; // 4.5% interest every 24 hours
    const expectedYield = Number((invAmount * 0.045 * 180).toFixed(2));
    const accruedEarnings = Number((invAmount * 0.045 * 35).toFixed(2));

    this.investments.set(inv1Id, {
      id: inv1Id,
      userId: eleanorId,
      planName: 'Monvera 180-Day Term Investment',
      termDays: 180,
      amount: invAmount,
      apy: 4.5,
      dailyRate: invDailyRate,
      expectedYield,
      expectedMaturityValue: invAmount + expectedYield,
      totalAccruedEarnings: accruedEarnings,
      startDate: inv1StartDate,
      maturityDate: inv1MaturityDate,
      status: 'ACTIVE',
      createdAt: inv1StartDate,
    });

    // Log some earnings for this investment
    for (let i = 1; i <= 5; i++) {
      const earnDate = new Date(Date.now() - (35 - i * 7) * 24 * 60 * 60 * 1000).toISOString();
      this.investmentEarnings.push({
        id: `earn_${inv1Id}_${i}`,
        investmentId: inv1Id,
        userId: eleanorId,
        date: earnDate,
        amount: Number((accruedEarnings / 5).toFixed(2)),
        runningValue: invAmount + Number(((accruedEarnings / 5) * i).toFixed(2)),
        status: 'POSTED',
      });
    }

    // Seed Notifications
    this.notifications.push(
      {
        id: 'notif_sup_01',
        userId: eleanorId,
        title: 'Customer Support: Private Wealth Desk',
        message: 'Hello Eleanor, your dedicated Private Wealth liaison David Vance is available to assist with institutional Treasury allocations or international wire limits. How may we assist you today?',
        type: 'SUPPORT',
        severity: 'support',
        read: false,
        createdAt: new Date(Date.now() - 1 * 3600000).toISOString(),
        supportTicketId: 'MV-CS-89210',
        supportRepName: 'David Vance',
        supportRepRole: 'Senior Private Wealth Director',
        supportRepAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
        replies: [
          {
            id: 'rep_01',
            sender: 'support',
            senderName: 'David Vance',
            senderAvatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
            message: 'Hello Eleanor, your dedicated Private Wealth liaison David Vance is available to assist with institutional Treasury allocations or international wire limits. How may we assist you today?',
            createdAt: new Date(Date.now() - 1 * 3600000).toISOString(),
          },
        ],
      },
      {
        id: 'notif_01',
        userId: eleanorId,
        title: 'Dividend & Yield Accrual Posted',
        message: 'Your 180-Day Sovereign Investment generated +$40.27 in scheduled returns today.',
        type: 'INVESTMENT',
        severity: 'success',
        read: false,
        createdAt: new Date(Date.now() - 2 * 3600000).toISOString(),
      },
      {
        id: 'notif_02',
        userId: eleanorId,
        title: 'Money Received',
        message: 'You received $5,000.00 from Marcus Sterling (MVB Account •••• 2015).',
        type: 'TRANSACTION',
        severity: 'success',
        read: false,
        createdAt: new Date(Date.now() - 28 * 3600000).toISOString(),
      },
      {
        id: 'notif_03',
        userId: eleanorId,
        title: 'Security Verification Complete',
        message: 'Biometric and hardware 2-Factor Authentication confirmed for your primary device.',
        type: 'SECURITY',
        severity: 'info',
        read: true,
        createdAt: new Date(Date.now() - 72 * 3600000).toISOString(),
      },
      {
        id: 'notif_sup_02',
        userId: marcusId,
        title: 'Customer Support: Business Platinum Concierge',
        message: 'Marcus, your corporate liquidity sweep threshold has been verified by the Monvera Treasury operations desk.',
        type: 'SUPPORT',
        severity: 'support',
        read: false,
        createdAt: new Date(Date.now() - 4 * 3600000).toISOString(),
        supportTicketId: 'MV-CS-44102',
        supportRepName: 'Sarah Jenkins',
        supportRepRole: 'Monvera Corporate Treasury Liaison',
        supportRepAvatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
        replies: [
          {
            id: 'rep_m01',
            sender: 'support',
            senderName: 'Sarah Jenkins',
            message: 'Marcus, your corporate liquidity sweep threshold has been verified by the Monvera Treasury operations desk.',
            createdAt: new Date(Date.now() - 4 * 3600000).toISOString(),
          },
        ],
      }
    );

    // Seed Active Sessions
    this.sessions.set(eleanorId, [
      {
        id: 'ses_01',
        userId: eleanorId,
        device: 'Apple MacBook Pro 16" (M3 Max)',
        browser: 'Chrome 128 / macOS Sequoia',
        location: 'San Francisco, CA, USA',
        ipAddress: '192.0.2.45',
        lastActive: 'Just now',
        isCurrent: true,
      },
      {
        id: 'ses_02',
        userId: eleanorId,
        device: 'Apple iPhone 16 Pro',
        browser: 'Monvera iOS App v3.2.0',
        location: 'San Francisco, CA, USA',
        ipAddress: '198.51.100.12',
        lastActive: '2 hours ago',
        isCurrent: false,
      },
    ]);

    // Seed Admin Audit Logs
    this.auditLogs.push({
      id: 'aud_01',
      adminId: 'usr_admin',
      adminName: 'Monvera Operations Officer',
      action: 'SYSTEM_LIQUIDITY_AUDIT',
      reason: 'Standard nightly ledger reconciliation',
      timestamp: new Date(Date.now() - 14 * 3600000).toISOString(),
      ipAddress: '10.0.0.1',
      result: 'SUCCESS',
    });
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

  private seedLedgerTransactions(eleanorId: string, marcusId: string, sophiaId: string) {
    const now = Date.now();

    // Eleanor initial funding: Deposit $75,000
    this.recordLedgerTransaction({
      type: 'DEPOSIT',
      amount: 75000,
      userId: eleanorId,
      recipientUserId: eleanorId,
      recipientAccountId: `acc_chk_${eleanorId}`,
      description: 'Initial Wire Deposit from Chase Private Client',
      category: 'Deposits',
      status: 'COMPLETED',
      paymentProviderRef: 'WIRE-US-9920148',
      timestamp: new Date(now - 45 * 86400000).toISOString(),
    });

    // Eleanor transfer to Savings: $20,000
    this.recordInternalAccountTransfer(
      eleanorId,
      `acc_chk_${eleanorId}`,
      `acc_sav_${eleanorId}`,
      20000,
      'Automated High-Yield Savings Allocation',
      new Date(now - 40 * 86400000).toISOString()
    );

    // Eleanor invested $25,000 into 180-Day Capital Term
    this.recordLedgerTransaction({
      type: 'INVESTMENT',
      amount: 25000,
      userId: eleanorId,
      senderAccountId: `acc_chk_${eleanorId}`,
      recipientAccountId: `acc_inv_${eleanorId}`,
      description: 'Allocation to 180-Day Sovereign Term Plan (8.40% APY)',
      category: 'Investments',
      status: 'COMPLETED',
      timestamp: new Date(now - 35 * 86400000).toISOString(),
    });

    // Marcus deposit: $150,000
    this.recordLedgerTransaction({
      type: 'DEPOSIT',
      amount: 150000,
      userId: marcusId,
      recipientUserId: marcusId,
      recipientAccountId: `acc_chk_${marcusId}`,
      description: 'Commercial Capital Infusion - Sterling Ventures',
      category: 'Deposits',
      status: 'COMPLETED',
      paymentProviderRef: 'ACH-COMM-881920',
      timestamp: new Date(now - 30 * 86400000).toISOString(),
    });

    // Marcus transfers $5,000 to Eleanor (Monvera-to-Monvera)
    this.recordMonveraTransfer({
      senderUserId: marcusId,
      recipientUserId: eleanorId,
      amount: 5000,
      description: 'Consulting Advisory Fee - Q1 Strategy',
      category: 'Transfers',
      timestamp: new Date(now - 28 * 3600000).toISOString(),
    });

    // Sophia deposit: $90,000
    this.recordLedgerTransaction({
      type: 'DEPOSIT',
      amount: 90000,
      userId: sophiaId,
      recipientUserId: sophiaId,
      recipientAccountId: `acc_chk_${sophiaId}`,
      description: 'Wire Transfer - Apex Global Asset Management',
      category: 'Deposits',
      status: 'COMPLETED',
      paymentProviderRef: 'FEDWIRE-NY-448102',
      timestamp: new Date(now - 20 * 86400000).toISOString(),
    });

    // Eleanor card payment: Apple Store
    this.recordLedgerTransaction({
      type: 'CARD_PURCHASE',
      amount: 2499.0,
      userId: eleanorId,
      senderAccountId: `acc_chk_${eleanorId}`,
      description: 'Apple Park Infinite Loop - Hardware Upgrade',
      category: 'Shopping',
      status: 'COMPLETED',
      paymentProviderRef: 'AUTH-VISA-99410',
      timestamp: new Date(now - 5 * 86400000).toISOString(),
    });

    // Eleanor card payment: Four Seasons Resorts
    this.recordLedgerTransaction({
      type: 'CARD_PURCHASE',
      amount: 1850.0,
      userId: eleanorId,
      senderAccountId: `acc_chk_${eleanorId}`,
      description: 'Four Seasons Resort Maui - Executive Suite',
      category: 'Shopping',
      status: 'COMPLETED',
      paymentProviderRef: 'AUTH-VISA-10492',
      timestamp: new Date(now - 2 * 86400000).toISOString(),
    });
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

    // Active term investments sum
    const activeInvestments = Array.from(this.investments.values()).filter(
      (i) => i.userId === userId && i.status === 'ACTIVE'
    );
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

    const totalBalance = checkingBal + savingsBal + totalActiveInvestmentsAmount + totalAccruedEarnings;
    const availableBalance = checkingBal + savingsBal; // Liquid funds available for withdrawal/send

    return {
      checkingBalance: checkingBal,
      savingsBalance: savingsBal,
      investedBalance: totalActiveInvestmentsAmount,
      accruedEarnings: totalAccruedEarnings,
      totalBalance,
      availableBalance,
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
  }): { success: boolean; transaction?: Transaction; error?: string } {
    const user = this.users.get(params.userId);
    if (!user) return { success: false, error: 'Customer account not found.' };
    if (params.amount <= 0) return { success: false, error: 'Withdrawal amount must be greater than $0.00.' };

    const metrics = this.getUserBalanceMetrics(user.id);
    const fee = params.destinationType === 'FEDWIRE' ? 15.0 : 0.0;
    const totalRequired = params.amount + fee;

    const sourceType = params.sourceAccountType === 'SAVINGS' ? 'SAVINGS' : 'CHECKING';
    const sourceBal = sourceType === 'SAVINGS' ? metrics.savingsBalance : metrics.checkingBalance;
    const sourceAccName = sourceType === 'SAVINGS' ? 'High-Yield Savings' : 'Checking Account';

    if (sourceBal < totalRequired) {
      return {
        success: false,
        error: `Insufficient balance in your ${sourceAccName} ($${sourceBal.toLocaleString('en-US', {
          minimumFractionDigits: 2,
        })}). Required: $${totalRequired.toFixed(2)} (including $${fee.toFixed(2)} fee). Note: Active investment capital is locked until maturity.`,
      };
    }

    const sourceAccountId = sourceType === 'SAVINGS' ? `acc_sav_${user.id}` : `acc_chk_${user.id}`;
    const tx = this.recordLedgerTransaction({
      type: 'WITHDRAWAL',
      amount: params.amount,
      fee,
      userId: user.id,
      senderAccountId: sourceAccountId,
      description: `Withdrawal from ${sourceAccName} to ${params.destinationLabel} (•••• ${params.accountOrIban.slice(-4)})`,
      category: 'Withdrawals',
      status: 'COMPLETED',
      paymentProviderRef: `WTH-CLEAR-${Date.now().toString(36).toUpperCase()}`,
      metadata: {
        destinationType: params.destinationType,
        destinationLabel: params.destinationLabel,
        accountOrIbanMasked: `•••• ${params.accountOrIban.slice(-4)}`,
        sourceAccountType: sourceType,
      },
    });

    this.notifications.unshift({
      id: `notif_${Date.now()}_wth`,
      userId: user.id,
      title: 'Withdrawal Dispatched',
      message: `-$${params.amount.toLocaleString('en-US', {
        minimumFractionDigits: 2,
      })} has been dispatched from your ${sourceAccName} to ${params.destinationLabel}.`,
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
}

export const db = new MonveraDatabase();
