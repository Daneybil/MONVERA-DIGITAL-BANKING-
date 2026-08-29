export type UserRole = 'customer' | 'business' | 'admin' | 'super_admin';
export type UserStatus = 'active' | 'frozen' | 'pending_verification';
export type KycStatus = 'unverified' | 'pending' | 'action_required' | 'partially_approved' | 'verified' | 'rejected';

export type KycItemReviewStatus = 'pending' | 'approved' | 'rejected';

export interface KycItemReview {
  status: KycItemReviewStatus;
  rejectionReason?: string;
  reason?: string;
  reviewedAt?: string;
  reviewedBy?: string;
}

export interface KycItemReviews {
  identity?: KycItemReview;
  proofOfAddress?: KycItemReview;
  liveness?: KycItemReview;
  ssn?: KycItemReview;
}

export interface UserProfile {
  id: string;
  username: string; // Unique Monvera handle e.g. "eleanor", "marcus"
  name?: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  permanentAccountNumber: string; // 10-digit unique number e.g. "1045827391"
  dateOfBirth?: string;
  country: string;
  streetAddress?: string;
  avatarUrl?: string;
  status: UserStatus;
  role: UserRole;
  membershipTier: 'Premier' | 'Private Wealth' | 'Standard' | 'Business Platinum';
  twoFactorEnabled: boolean;
  createdAt: string;
  businessName?: string;
  maritalStatus?: string;
  taxId?: string;
  kycStatus?: KycStatus;
  kycFullName?: string;
  kycFirstName?: string;
  kycLastName?: string;
  kycCountry?: string;
  kycPhone?: string;
  kycEmail?: string;
  kycDateOfBirth?: string;
  kycDocumentType?: string;
  kycDocumentNumber?: string;
  kycDocumentImage?: string; // Front image or single doc image
  kycDocumentBackImage?: string; // Back image where applicable (Driver's License, National ID)
  kycLiveSelfieImage?: string; // Liveness / Selfie
  kycStreetAddress?: string; // Residential street address
  kycProofOfAddressType?: string; // e.g. "Bank Statement", "Utility Bill", etc.
  kycProofOfAddressImage?: string; // Proof of address document
  kycSsn?: string; // SSN number
  kycSsnImage?: string; // Optional SSN document image
  kycSubmittedAt?: string;
  kycVerifiedAt?: string;
  kycRejectionReason?: string;
  kycItemReviews?: KycItemReviews;
  kycReviewDurationMinutes?: number;
  emailVerified?: boolean;
  dailyTransactionLimit?: number;
}

export type AccountType = 'CHECKING' | 'SAVINGS' | 'INVESTMENT' | 'BUSINESS';

export interface BankAccount {
  id: string;
  userId: string;
  type: AccountType;
  accountNumber: string;
  routingNumber: string;
  currency: string;
  balance: number; // Authoritative balance computed from ledger
  availableBalance: number;
  investedBalance: number;
  pendingBalance: number;
  interestRateAPY: number;
  status: 'ACTIVE' | 'FROZEN' | 'DORMANT';
  nickname: string;
}

export type TransactionType =
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'TRANSFER'
  | 'INVESTMENT'
  | 'INVESTMENT_EARNING'
  | 'INVESTMENT_MATURITY'
  | 'CARD_PURCHASE'
  | 'ADMIN_DEVELOPMENT_FUNDING'
  | 'REVERSAL'
  | 'FEE';

export type TransactionStatus = 'COMPLETED' | 'PENDING' | 'FAILED' | 'REVERSED' | 'CANCELLED';

export interface Transaction {
  id: string;
  referenceNumber: string; // e.g. "MV-TRF-2026-9048"
  type: TransactionType;
  amount: number;
  currency: string;
  status: TransactionStatus;
  userId?: string;
  senderUserId?: string;
  senderName?: string;
  senderAccountNumber?: string;
  recipientUserId?: string;
  recipientName?: string;
  recipientAccountNumber?: string;
  fee: number;
  description: string;
  category: 'Transfers' | 'Deposits' | 'Withdrawals' | 'Investments' | 'Shopping' | 'Earnings' | 'System' | 'Bills';
  paymentProviderRef?: string;
  createdAt: string;
  completedAt?: string;
  metadata?: Record<string, any>;
}

export interface LedgerEntry {
  id: string;
  transactionId: string;
  userId: string;
  accountId: string;
  entryType: 'DEBIT' | 'CREDIT';
  amount: number;
  balanceAfter: number;
  description: string;
  timestamp: string;
}

export type InvestmentTermDays = 60 | 90 | 120 | 150 | 180 | 210 | 240 | 270 | 300 | 330 | 360;

export interface InvestmentPlan {
  id: string;
  userId: string;
  planName: string;
  termDays: InvestmentTermDays;
  amount: number;
  apy: number; // e.g., 6.4 for 6.4%
  dailyRate: number;
  expectedYield: number;
  expectedMaturityValue: number;
  totalAccruedEarnings: number;
  startDate: string;
  maturityDate: string;
  status: 'ACTIVE' | 'MATURED' | 'CANCELLED';
  createdAt: string;
}

export interface InvestmentEarningLog {
  id: string;
  investmentId: string;
  userId: string;
  date: string;
  amount: number;
  runningValue: number;
  status: 'POSTED' | 'PENDING';
}

export type LoanStatus = 'PENDING' | 'APPROVED' | 'ACTIVE' | 'REJECTED' | 'PAID' | 'CANCELLED';

export interface LoanApplication {
  id: string;
  userId: string;
  applicantName: string;
  applicantEmail: string;
  applicantPhone?: string;
  permanentAccountNumber: string;
  amount: number; // $1,000 to $1,000,000
  termMonths: number; // e.g. 6, 12, 24, 36, 48, 60
  monthlyPayment: number;
  interestRateAPR: number; // e.g. 4.9% - 7.5%
  purpose: string;
  employmentOrBusinessDetails?: string;
  annualIncomeOrRevenue?: number;
  collateralDescription?: string;
  status: LoanStatus;
  userTransactionVolume?: number;
  eligibilityTier?: string;
  rejectionReason?: string;
  approvedAt?: string;
  approvedBy?: string;
  rejectedAt?: string;
  rejectedBy?: string;
  disbursedAt?: string;
  disbursedAmount?: number;
  totalRepaid?: number;
  remainingBalance?: number;
  totalRepaymentAmount?: number;
  interestAmount?: number;
  maturityDate?: string;
  paidAt?: string;
  repaymentHistory?: Array<{
    id: string;
    amount: number;
    date: string;
    paymentMethod: string;
    note?: string;
    remainingAfter?: number;
  }>;
  createdAt: string;
  updatedAt?: string;
}

export interface CardItem {
  id: string;
  userId: string;
  cardHolderName: string;
  cardNumber: string; // Complete 16-digit number formatted: "4654 8291 3049 5985"
  maskedNumber: string; // e.g. "•••• •••• •••• 8829"
  fullNumberMasked: string; // e.g. "4921 •••• •••• 8829"
  expiryDate: string;
  cvvMasked: string;
  cardType: 'VIRTUAL' | 'PHYSICAL';
  cardTier: string;
  brand?: 'VISA' | 'MASTERCARD';
  status: 'ACTIVE' | 'FROZEN' | 'CANCELLED';
  spendingLimitDaily: number;
  spendingLimitMonthly: number;
  currentDailySpend: number;
  internationalEnabled: boolean;
  onlineEnabled: boolean;
  atmEnabled: boolean;
  contactlessEnabled: boolean;
  colorScheme: 'obsidian' | 'titanium' | 'emerald' | 'sapphire' | 'gold' | string;
}

export interface NotificationReply {
  id: string;
  sender: 'user' | 'support' | 'ADMIN' | 'COMPLIANCE' | 'SUPPORT_REP' | string;
  senderRole?: 'ADMIN' | 'COMPLIANCE' | 'SUPPORT_REP' | 'USER' | 'CUSTOMER';
  senderId?: string;
  senderName: string;
  senderAvatar?: string;
  message: string;
  createdAt?: string;
  timestamp?: string;
}

export interface NotificationItem {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: 'TRANSACTION' | 'SECURITY' | 'INVESTMENT' | 'SYSTEM' | 'SUPPORT';
  severity: 'info' | 'success' | 'warning' | 'support' | 'error';
  read: boolean;
  createdAt: string;
  referenceId?: string;
  supportTicketId?: string;
  supportRepName?: string;
  supportRepRole?: string;
  supportRepAvatar?: string;
  supportStatus?: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED' | string;
  replies?: NotificationReply[];
}

export interface AdminAuditLog {
  id: string;
  adminId: string;
  adminName: string;
  action: string;
  targetUserId?: string;
  targetAccountNumber?: string;
  amount?: number;
  reason: string;
  timestamp: string;
  ipAddress: string;
  result: 'SUCCESS' | 'FAILED';
}

export interface SessionInfo {
  id: string;
  userId: string;
  device: string;
  browser: string;
  location: string;
  ipAddress: string;
  lastActive: string;
  isCurrent: boolean;
}

export interface ChatMessage {
  id: string;
  userId: string;
  sender: 'user' | 'support' | 'system';
  senderName: string;
  senderRole?: string;
  senderAvatar?: string;
  message: string;
  timestamp: string;
  status: 'sent' | 'delivered' | 'read';
  attachmentUrl?: string;
  attachmentType?: 'image' | 'document' | 'receipt';
  quickAction?: string;
}

export interface AdminSystemOverview {
  totalCustomers: number;
  activeAccounts: number;
  totalPlatformDeposits: number;
  totalPlatformWithdrawals: number;
  totalPlatformTransfers: number;
  totalPlatformInvestments: number;
  pendingTransactionsCount: number;
  failedTransactionsCount: number;
  devFundingPoolBalance: number;
  systemReserveRatio: number;
  activeNodesCount: number;
}

export interface LoanEligibilityTier {
  volume: number;
  tier: string;
  maxLimit: number;
  interestRateAPR: number;
  minRequiredVolume?: number;
  description: string;
}


