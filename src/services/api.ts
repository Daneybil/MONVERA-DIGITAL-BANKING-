import {
  UserProfile,
  BankAccount,
  Transaction,
  InvestmentPlan,
  InvestmentEarningLog,
  CardItem,
  NotificationItem,
  AdminAuditLog,
  SessionInfo,
  AdminSystemOverview,
  InvestmentTermDays,
} from '../types';

export interface BalanceMetrics {
  checkingBalance: number;
  savingsBalance: number;
  investedBalance: number;
  accruedEarnings: number;
  totalBalance: number;
  availableBalance: number;
  pendingBalance: number;
  accounts: BankAccount[];
}

export interface RecipientLookupResult {
  valid: boolean;
  recipientId?: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  avatarUrl?: string;
  permanentAccountNumber?: string;
  maskedAccountNumber?: string;
  membershipTier?: string;
  verified?: boolean;
  error?: string;
}

export const api = {
  async getUsers(): Promise<{ users: UserProfile[] }> {
    const res = await fetch('/api/auth/users');
    return res.json();
  },

  async getCurrentUser(userId?: string): Promise<{ user: UserProfile; balanceMetrics: BalanceMetrics }> {
    const res = await fetch(`/api/auth/me?userId=${encodeURIComponent(userId || '')}`);
    return res.json();
  },

  async login(identifier: string, password?: string): Promise<{ success: boolean; user?: UserProfile; balanceMetrics?: BalanceMetrics; error?: string }> {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    });
    return res.json();
  },

  async register(data: {
    id?: string;
    uid?: string;
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    dateOfBirth?: string;
    country?: string;
    maritalStatus?: string;
    address?: string;
    taxId?: string;
    password?: string;
    isBusiness?: boolean;
    businessName?: string;
    permanentAccountNumber?: string;
  }): Promise<{ success: boolean; user?: UserProfile; balanceMetrics?: BalanceMetrics; error?: string }> {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async changePassword(data: {
    userId: string;
    currentPassword?: string;
    newPassword: string;
  }): Promise<{ success: boolean; error?: string; message?: string }> {
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async resetPassword(data: {
    emailOrAccount: string;
  }): Promise<{ success: boolean; error?: string; message?: string }> {
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async updateAvatar(data: {
    userId: string;
    avatarUrl: string;
  }): Promise<{ success: boolean; user?: UserProfile; error?: string }> {
    const res = await fetch('/api/auth/update-avatar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async submitKyc(data: {
    userId: string;
    documentType: string;
    documentNumber: string;
    country: string;
    proofOfAddress?: string;
    autoApprove?: boolean;
  }): Promise<{ success: boolean; user?: UserProfile; error?: string }> {
    const res = await fetch('/api/kyc/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async approveKyc(data: {
    userId: string;
    adminId?: string;
  }): Promise<{ success: boolean; user?: UserProfile; error?: string }> {
    const res = await fetch('/api/kyc/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async getBalanceMetrics(userId: string): Promise<BalanceMetrics> {
    const res = await fetch(`/api/accounts/balance?userId=${encodeURIComponent(userId)}`);
    return res.json();
  },

  async lookupRecipient(identifier: string, currentUserId: string): Promise<RecipientLookupResult> {
    const res = await fetch(
      `/api/accounts/lookup?query=${encodeURIComponent(identifier)}&currentUserId=${encodeURIComponent(currentUserId)}`
    );
    return res.json();
  },

  async sendMonveraTransfer(data: {
    senderUserId: string;
    recipientAccountNumber?: string;
    recipientUsername?: string;
    recipientIdentifier?: string;
    amount: number;
    description?: string;
    category?: Transaction['category'];
  }): Promise<{ success: boolean; transaction?: Transaction; balanceMetrics?: BalanceMetrics; error?: string }> {
    const res = await fetch('/api/transfers/monvera', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async sendInternalTransfer(data: {
    userId: string;
    fromAccountType: 'CHECKING' | 'SAVINGS';
    toAccountType: 'CHECKING' | 'SAVINGS';
    amount: number;
    description?: string;
  }): Promise<{ success: boolean; transaction?: Transaction; balanceMetrics?: BalanceMetrics; error?: string }> {
    const res = await fetch('/api/transfers/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async createDeposit(data: {
    userId: string;
    amount: number;
    method: 'CARD' | 'ACH' | 'WIRE' | 'INSTANT_PAY' | 'CRYPTO_WALLET';
    destinationAccountType?: 'CHECKING' | 'SAVINGS';
    providerPaymentId?: string;
    metadata?: Record<string, any>;
  }): Promise<{ success: boolean; transaction?: Transaction; balanceMetrics?: BalanceMetrics; error?: string }> {
    const res = await fetch('/api/deposits/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async createWithdrawal(data: {
    userId: string;
    amount: number;
    destinationType: 'ACH_BANK' | 'FEDWIRE' | 'CARD' | 'CRYPTO';
    destinationLabel: string;
    accountOrIban: string;
    sourceAccountType?: 'CHECKING' | 'SAVINGS';
    routingNumber?: string;
  }): Promise<{ success: boolean; transaction?: Transaction; balanceMetrics?: BalanceMetrics; error?: string }> {
    const res = await fetch('/api/withdrawals/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async getTransactions(params?: {
    userId?: string;
    category?: string;
    search?: string;
    type?: string;
    flow?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<{ transactions: Transaction[] }> {
    const query = new URLSearchParams();
    if (params?.userId) query.append('userId', params.userId);
    if (params?.category) query.append('category', params.category);
    if (params?.search) query.append('search', params.search);
    if (params?.type) query.append('type', params.type);
    if (params?.flow) query.append('flow', params.flow);
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);

    const res = await fetch(`/api/transactions?${query.toString()}`);
    return res.json();
  },

  async getInvestments(userId: string): Promise<{
    investments: InvestmentPlan[];
    earnings: InvestmentEarningLog[];
    supportedTerms: InvestmentTermDays[];
  }> {
    const res = await fetch(`/api/investments?userId=${encodeURIComponent(userId)}`);
    return res.json();
  },

  async createInvestment(data: {
    userId: string;
    termDays: InvestmentTermDays;
    amount: number;
  }): Promise<{ success: boolean; investment?: InvestmentPlan; balanceMetrics?: BalanceMetrics; error?: string }> {
    const res = await fetch('/api/investments/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async matureInvestment(id: string): Promise<{
    success: boolean;
    investment?: InvestmentPlan;
    payoutAmount?: number;
    balanceMetrics?: BalanceMetrics;
    error?: string;
  }> {
    const res = await fetch(`/api/investments/${encodeURIComponent(id)}/mature`, {
      method: 'POST',
    });
    return res.json();
  },

  async getCards(userId: string): Promise<{ cards: CardItem[] }> {
    const res = await fetch(`/api/cards?userId=${encodeURIComponent(userId)}`);
    return res.json();
  },

  async createCard(data: {
    userId: string;
    cardHolderName?: string;
    phone?: string;
    cardType?: 'PHYSICAL' | 'VIRTUAL';
    cardTier?: string;
    brand?: 'VISA' | 'MASTERCARD';
    spendingLimitMonthly?: number;
    spendingLimitDaily?: number;
    colorScheme?: string;
  }): Promise<{
    success: boolean;
    card?: CardItem;
    transaction?: Transaction;
    balanceMetrics?: BalanceMetrics;
    error?: string;
  }> {
    const res = await fetch('/api/cards/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async toggleCardFreeze(id: string): Promise<{ success: boolean; card?: CardItem; error?: string }> {
    const res = await fetch(`/api/cards/${encodeURIComponent(id)}/toggle-freeze`, {
      method: 'POST',
    });
    return res.json();
  },

  async updateCardLimits(
    id: string,
    limits: {
      dailyLimit?: number;
      monthlyLimit?: number;
      international?: boolean;
      online?: boolean;
      atm?: boolean;
    }
  ): Promise<{ success: boolean; card?: CardItem; error?: string }> {
    const res = await fetch(`/api/cards/${encodeURIComponent(id)}/update-limits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(limits),
    });
    return res.json();
  },

  async getNotifications(userId: string): Promise<{ notifications: NotificationItem[] }> {
    const res = await fetch(`/api/notifications?userId=${encodeURIComponent(userId)}`);
    return res.json();
  },

  async markNotificationsRead(userId: string): Promise<{ success: boolean }> {
    const res = await fetch('/api/notifications/read-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    return res.json();
  },

  async markSingleNotificationRead(notificationId: string, userId: string): Promise<{ success: boolean }> {
    const res = await fetch('/api/notifications/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notificationId, userId }),
    });
    return res.json();
  },

  async replyToSupportMessage(data: {
    notificationId: string;
    userId: string;
    message: string;
  }): Promise<{ success: boolean; notification?: NotificationItem; error?: string }> {
    const res = await fetch('/api/support/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async getSessions(userId: string): Promise<{ sessions: SessionInfo[] }> {
    const res = await fetch(`/api/security/sessions?userId=${encodeURIComponent(userId)}`);
    return res.json();
  },

  async terminateSession(id: string, userId: string): Promise<{ success: boolean; sessions: SessionInfo[] }> {
    const res = await fetch(`/api/security/sessions/${encodeURIComponent(id)}/terminate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    return res.json();
  },

  // Admin Endpoints
  async getAdminOverview(): Promise<AdminSystemOverview> {
    const res = await fetch('/api/admin/overview');
    return res.json();
  },

  async getAdminCustomers(): Promise<{ customers: (UserProfile & { balanceMetrics: BalanceMetrics })[] }> {
    const res = await fetch('/api/admin/customers');
    return res.json();
  },

  async toggleCustomerStatus(id: string, data: { adminId?: string; reason?: string }): Promise<{ success: boolean; user?: UserProfile }> {
    const res = await fetch(`/api/admin/customers/${encodeURIComponent(id)}/toggle-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async issueAdminDevFunding(data: {
    adminId: string;
    targetUserId: string;
    amount: number;
    reason: string;
    targetAccountType?: 'CHECKING' | 'SAVINGS';
  }): Promise<{ success: boolean; transaction?: Transaction; targetBalanceMetrics?: BalanceMetrics; devFundingPoolBalance?: number; error?: string }> {
    const res = await fetch('/api/admin/dev-fund', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async topUpDevFundingPool(data: {
    adminId: string;
    amount?: number;
    reason?: string;
  }): Promise<{ success: boolean; newBalance?: number; error?: string }> {
    const res = await fetch('/api/admin/dev-topup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async getAdminAuditLogs(): Promise<{ auditLogs: AdminAuditLog[] }> {
    const res = await fetch('/api/admin/audit-logs');
    return res.json();
  },
};
