import React, { useState } from 'react';
import {
  UserProfile,
  Transaction,
  InvestmentPlan,
  AdminAuditLog,
} from '../../types';
import {
  X,
  User,
  Shield,
  ShieldCheck,
  ShieldAlert,
  CreditCard,
  Lock,
  Unlock,
  Building,
  Building2,
  ArrowDownLeft,
  ArrowUpRight,
  RefreshCw,
  TrendingUp,
  FileText,
  Calendar,
  Phone,
  Mail,
  MapPin,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Eye,
  Trash2,
  HelpCircle,
  Copy,
  Check,
} from 'lucide-react';
import { AdminConfirmationModal } from './AdminConfirmationModal';

interface AdminCustomerDetailsModalProps {
  customer: (UserProfile & { balanceMetrics?: any }) | null;
  isOpen: boolean;
  onClose: () => void;
  transactions: Transaction[];
  onToggleStatus: (userId: string, reason: string) => Promise<void>;
  onApproveKyc: (userId: string, customer?: any) => Promise<void>;
  onRejectKyc: (userId: string, reason: string, customer?: any) => Promise<void>;
  onReviewKycItem?: (
    userId: string,
    itemName: 'identity' | 'proofOfAddress' | 'liveness' | 'ssn',
    status: 'approved' | 'rejected',
    reason?: string,
    customer?: any
  ) => Promise<void>;
  onRefreshData?: () => Promise<void>;
}

export const AdminCustomerDetailsModal: React.FC<AdminCustomerDetailsModalProps> = ({
  customer,
  isOpen,
  onClose,
  transactions,
  onToggleStatus,
  onApproveKyc,
  onRejectKyc,
  onReviewKycItem,
  onRefreshData,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'transactions' | 'deposits' | 'withdrawals' | 'kyc' | 'controls'>('overview');
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [zoomedImage, setZoomedImage] = useState<{ src: string; title: string } | null>(null);
  const [showSsn, setShowSsn] = useState<boolean>(false);
  
  // Confirmation state
  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    variant: 'danger' | 'warning' | 'primary';
    action: (reason: string) => Promise<void>;
  }>({
    isOpen: false,
    title: '',
    description: '',
    confirmLabel: '',
    variant: 'primary',
    action: async () => {},
  });

  if (!isOpen || !customer) return null;

  const copyToClipboard = (text: string, fieldId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldId);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const userTxs = transactions.filter(
    (t) => t.senderUserId === customer.id || t.recipientUserId === customer.id
  );

  const deposits = userTxs.filter((t) => t.category === 'Deposits' || t.type === 'DEPOSIT');
  const withdrawals = userTxs.filter((t) => t.category === 'Withdrawals' || t.type === 'WITHDRAWAL');

  const metrics = customer.balanceMetrics || {
    checkingBalance: 0,
    savingsBalance: 0,
    investedBalance: 0,
    totalBalance: 0,
    availableBalance: 0,
  };

  const isFrozen = customer.status === 'frozen';
  const isKycVerified = customer.kycStatus === 'verified';
  const isKycPending = customer.kycStatus === 'pending';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/70 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150 overflow-hidden">
        
        {/* Header */}
        <div className="p-6 bg-slate-900 text-white flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="relative">
              {customer.avatarUrl ? (
                <img
                  src={customer.avatarUrl}
                  alt={customer.firstName}
                  className="w-16 h-16 rounded-2xl object-cover ring-2 ring-white/20"
                />
              ) : (
                <div className="w-16 h-16 rounded-2xl bg-amber-500/25 border border-amber-400/40 flex items-center justify-center text-2xl font-black text-amber-300">
                  {customer.firstName[0]}
                  {customer.lastName[0]}
                </div>
              )}
              <span
                className={`absolute -bottom-1 -right-1 w-4.5 h-4.5 rounded-full border-2 border-slate-900 ${
                  isFrozen ? 'bg-rose-500' : 'bg-emerald-500'
                }`}
              />
            </div>

            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-2xl font-black text-white tracking-tight">
                  {customer.firstName} {customer.lastName}
                </h2>
                <span className="px-3 py-1 text-xs font-black rounded-full bg-slate-800 border border-slate-700 text-slate-200">
                  @{customer.username}
                </span>
                <span
                  className={`px-3 py-1 text-xs font-black rounded-full border ${
                    isFrozen
                      ? 'bg-rose-500/25 text-rose-200 border-rose-500/40'
                      : 'bg-emerald-500/25 text-emerald-200 border-emerald-500/40'
                  }`}
                >
                  {isFrozen ? 'Restricted / Frozen' : 'Active Account'}
                </span>
                <span
                  className={`px-3 py-1 text-xs font-black rounded-full border ${
                    isKycVerified
                      ? 'bg-blue-500/25 text-blue-200 border-blue-500/40'
                      : isKycPending
                      ? 'bg-amber-500/25 text-amber-200 border-amber-500/40'
                      : 'bg-slate-700 text-slate-200 border-slate-600'
                  }`}
                >
                  {isKycVerified ? 'KYC Verified ($1M/day)' : isKycPending ? 'KYC In Review' : 'KYC Unverified'}
                </span>
              </div>

              <div className="flex items-center gap-4 mt-2 text-sm text-slate-300 font-mono font-bold">
                <span className="flex items-center gap-1.5">
                  <span>Acc:</span>
                  <span className="text-amber-300 font-black">{customer.permanentAccountNumber}</span>
                  <button
                    onClick={() => copyToClipboard(customer.permanentAccountNumber, 'acc')}
                    className="hover:text-amber-400 text-slate-300 transition-colors"
                  >
                    {copiedField === 'acc' ? <Check className="w-4 h-4 text-emerald-400 stroke-[2.5]" /> : <Copy className="w-4 h-4" />}
                  </button>
                </span>
                <span>•</span>
                <span>Tier: <strong className="text-amber-300 font-black">{customer.membershipTier || 'Private Wealth'}</strong></span>
                <span>•</span>
                <span>ID: <code className="text-slate-300 font-semibold">{customer.id}</code></span>
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2.5 rounded-xl text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-6 h-6 stroke-[2.5]" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center px-6 border-b border-slate-200 bg-slate-100/90 gap-2 overflow-x-auto">
          {[
            { id: 'overview', label: 'Overview & Balances', icon: Building },
            { id: 'transactions', label: `Transactions (${userTxs.length})`, icon: RefreshCw },
            { id: 'deposits', label: `Deposits (${deposits.length})`, icon: ArrowDownLeft },
            { id: 'withdrawals', label: `Withdrawals (${withdrawals.length})`, icon: ArrowUpRight },
            { id: 'kyc', label: 'KYC & Compliance', icon: ShieldCheck },
            { id: 'controls', label: 'Security & Controls', icon: Lock },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 py-3.5 px-4 text-sm font-extrabold border-b-2 transition-all whitespace-nowrap ${
                  isActive
                    ? 'border-slate-900 text-slate-950 bg-white shadow-xs rounded-t-xl'
                    : 'border-transparent text-slate-600 hover:text-slate-950 hover:border-slate-300'
                }`}
              >
                <Icon className={`w-4.5 h-4.5 ${isActive ? 'text-amber-600 stroke-[2.5]' : 'text-slate-500 stroke-[2]'}`} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        <div className="p-6 overflow-y-auto flex-1 bg-slate-50/60">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Balance Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
                  <div className="text-xs font-black text-slate-600 uppercase tracking-wider">Checking Balance</div>
                  <div className="text-2xl font-black text-slate-950 mt-1.5 font-mono">
                    ${(metrics.checkingBalance || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </div>
                  <div className="text-xs font-bold text-slate-500 mt-1">Available for transfers & card</div>
                </div>

                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
                  <div className="text-xs font-black text-slate-600 uppercase tracking-wider">Treasury / Savings</div>
                  <div className="text-2xl font-black text-emerald-700 mt-1.5 font-mono">
                    ${(metrics.savingsBalance || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </div>
                  <div className="text-xs font-bold text-slate-500 mt-1">4.85% APY High-Yield</div>
                </div>

                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
                  <div className="text-xs font-black text-slate-600 uppercase tracking-wider">Invested Capital</div>
                  <div className="text-2xl font-black text-blue-700 mt-1.5 font-mono">
                    ${(metrics.investedBalance || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </div>
                  <div className="text-xs font-bold text-slate-500 mt-1">Term deposits & securities</div>
                </div>

                <div className="bg-slate-900 text-white p-5 rounded-2xl border border-slate-800 shadow-xs">
                  <div className="text-xs font-black text-slate-300 uppercase tracking-wider">Total Net Worth</div>
                  <div className="text-2xl font-black text-amber-400 mt-1.5 font-mono">
                    ${(metrics.totalBalance || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </div>
                  <div className="text-xs font-bold text-slate-400 mt-1">Consolidated ledger balance</div>
                </div>
              </div>

              {/* Account Details & Metadata */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
                  <h4 className="text-sm font-black uppercase tracking-wider text-slate-700 flex items-center gap-2">
                    <User className="w-5 h-5 text-slate-600" /> Customer Information
                  </h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-xs font-bold text-slate-500 block uppercase tracking-wider">Full Legal Name</span>
                      <span className="font-extrabold text-slate-950 text-base">{customer.firstName} {customer.lastName}</span>
                    </div>
                    <div>
                      <span className="text-xs font-bold text-slate-500 block uppercase tracking-wider">Email Address</span>
                      <span className="font-extrabold text-slate-950 break-all">{customer.email}</span>
                    </div>
                    <div>
                      <span className="text-xs font-bold text-slate-500 block uppercase tracking-wider">Phone Number</span>
                      <span className="font-extrabold text-slate-950">{customer.phone || '+1 (555) 019-2834'}</span>
                    </div>
                    <div>
                      <span className="text-xs font-bold text-slate-500 block uppercase tracking-wider">Country of Residence</span>
                      <span className="font-extrabold text-slate-950">{customer.country || 'United States'}</span>
                    </div>
                    <div>
                      <span className="text-xs font-bold text-slate-500 block uppercase tracking-wider">Member Since</span>
                      <span className="font-extrabold text-slate-950">
                        {new Date(customer.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs font-bold text-slate-500 block uppercase tracking-wider">2FA Status</span>
                      <span className={`font-black ${customer.twoFactorEnabled ? 'text-emerald-700' : 'text-slate-700'}`}>
                        {customer.twoFactorEnabled ? 'Active (Authenticator)' : 'Standard'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
                  <h4 className="text-sm font-black uppercase tracking-wider text-slate-700 flex items-center gap-2">
                    <Building className="w-5 h-5 text-slate-600" /> Monvera Banking Routing & Limits
                  </h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-xs font-bold text-slate-500 block uppercase tracking-wider">Permanent Account No.</span>
                      <span className="font-mono font-black text-slate-950 text-base">{customer.permanentAccountNumber}</span>
                    </div>
                    <div>
                      <span className="text-xs font-bold text-slate-500 block uppercase tracking-wider">Fed Routing Transit</span>
                      <span className="font-mono font-black text-slate-950 text-base">021000021 (MVB NY)</span>
                    </div>
                    <div>
                      <span className="text-xs font-bold text-slate-500 block uppercase tracking-wider">Daily Transaction Limit</span>
                      <span className="font-mono font-black text-emerald-700 text-base">
                        ${(customer.dailyTransactionLimit || 1000000).toLocaleString('en-US')}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs font-bold text-slate-500 block uppercase tracking-wider">Institutional Tier</span>
                      <span className="font-black text-amber-800 text-base">{customer.membershipTier || 'Private Wealth'}</span>
                    </div>
                    <div className="col-span-2 pt-3 border-t border-slate-100 flex items-center justify-between">
                      <span className="text-slate-700 font-extrabold">Account Restrictions:</span>
                      <span className={`px-3 py-1 rounded-full font-black text-xs ${isFrozen ? 'bg-rose-100 text-rose-900 border border-rose-200' : 'bg-emerald-100 text-emerald-900 border border-emerald-200'}`}>
                        {isFrozen ? 'RESTRICTED / SUSPENDED' : 'CLEAR & UNRESTRICTED'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'transactions' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-base font-black text-slate-950">Transaction History ({userTxs.length})</h4>
                <span className="text-xs font-bold text-slate-500">Real-time ledger entries</span>
              </div>

              {userTxs.length === 0 ? (
                <div className="bg-white p-8 text-center rounded-2xl border border-slate-200 text-slate-500 font-bold text-sm">
                  No transaction records found for this account.
                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
                  <table className="w-full text-left">
                    <thead className="bg-slate-100/90 text-slate-800 border-b border-slate-200">
                      <tr>
                        <th className="p-4 text-xs font-black uppercase tracking-wider">Date & Time</th>
                        <th className="p-4 text-xs font-black uppercase tracking-wider">Reference</th>
                        <th className="p-4 text-xs font-black uppercase tracking-wider">Type</th>
                        <th className="p-4 text-xs font-black uppercase tracking-wider">Description</th>
                        <th className="p-4 text-xs font-black uppercase tracking-wider text-right">Amount</th>
                        <th className="p-4 text-xs font-black uppercase tracking-wider text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {userTxs.map((tx) => {
                        const isCredit = tx.recipientUserId === customer.id || tx.type === 'DEPOSIT' || tx.type === 'ADMIN_DEVELOPMENT_FUNDING';
                        return (
                          <tr key={tx.id} className="hover:bg-slate-50/80">
                            <td className="p-4 text-slate-700 font-bold whitespace-nowrap">
                              {new Date(tx.createdAt).toLocaleString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </td>
                            <td className="p-4 font-mono font-bold text-slate-900">{tx.referenceNumber}</td>
                            <td className="p-4">
                              <span className="px-2.5 py-1 rounded-lg bg-slate-100 font-extrabold text-xs text-slate-800">
                                {tx.type}
                              </span>
                            </td>
                            <td className="p-4 text-slate-950 font-bold max-w-xs truncate">{tx.description}</td>
                            <td className={`p-4 text-right font-mono font-black text-base whitespace-nowrap ${isCredit ? 'text-emerald-700' : 'text-slate-950'}`}>
                              {isCredit ? '+' : '-'}${tx.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </td>
                            <td className="p-4 text-center">
                              <span
                                className={`px-3 py-1 rounded-full text-xs font-black ${
                                  tx.status === 'COMPLETED'
                                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                    : tx.status === 'PENDING'
                                    ? 'bg-amber-50 text-amber-900 border border-amber-300'
                                    : 'bg-rose-50 text-rose-800 border border-rose-200'
                                }`}
                              >
                                {tx.status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === 'deposits' && (
            <div className="space-y-4">
              <h4 className="text-base font-black text-slate-950">Deposits & Provider Clearances ({deposits.length})</h4>
              {deposits.length === 0 ? (
                <div className="bg-white p-8 text-center rounded-2xl border border-slate-200 text-slate-500 font-bold text-sm">
                  No deposits recorded.
                </div>
              ) : (
                <div className="space-y-3">
                  {deposits.map((dep) => (
                    <div key={dep.id} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3.5">
                        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700">
                          <ArrowDownLeft className="w-6 h-6 stroke-[2.5]" />
                        </div>
                        <div>
                          <div className="text-base font-extrabold text-slate-950">{dep.description}</div>
                          <div className="text-xs text-slate-600 font-mono font-bold flex items-center gap-2 mt-1">
                            <span>Ref: {dep.referenceNumber}</span>
                            {dep.paymentProviderRef && <span>• Provider ID: {dep.paymentProviderRef}</span>}
                            <span>• {new Date(dep.createdAt).toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-black text-emerald-700 font-mono">
                          +${dep.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </div>
                        <span className="inline-block mt-1 px-3 py-0.5 rounded-full text-xs font-black bg-emerald-100 text-emerald-900">
                          Provider Confirmed
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'withdrawals' && (
            <div className="space-y-4">
              <h4 className="text-base font-black text-slate-950">Withdrawals & Outbound Disbursements ({withdrawals.length})</h4>
              {withdrawals.length === 0 ? (
                <div className="bg-white p-8 text-center rounded-2xl border border-slate-200 text-slate-500 font-bold text-sm">
                  No withdrawals recorded.
                </div>
              ) : (
                <div className="space-y-3">
                  {withdrawals.map((wth) => (
                    <div key={wth.id} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3.5">
                        <div className="p-3 rounded-xl bg-slate-100 border border-slate-200 text-slate-800">
                          <ArrowUpRight className="w-6 h-6 stroke-[2.5]" />
                        </div>
                        <div>
                          <div className="text-base font-extrabold text-slate-950">{wth.description}</div>
                          <div className="text-xs text-slate-600 font-mono font-bold flex items-center gap-2 mt-1">
                            <span>Ref: {wth.referenceNumber}</span>
                            <span>• {new Date(wth.createdAt).toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-black text-slate-950 font-mono">
                          -${wth.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </div>
                        <span className="inline-block mt-1 px-3 py-0.5 rounded-full text-xs font-black bg-slate-100 text-slate-900">
                          {wth.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'kyc' && (
            <div className="space-y-6">
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-6">
                
                {/* Header Info */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
                  <div className="flex items-center gap-3">
                    <Shield className="w-6 h-6 text-amber-600 stroke-[2.5]" />
                    <div>
                      <h4 className="text-base font-black text-slate-950">Regulatory KYC Verification Dossier</h4>
                      <p className="text-xs text-slate-500 font-semibold mt-0.5">
                        Granular compliance adjudication & identity document verification
                      </p>
                    </div>
                  </div>
                  <span
                    className={`px-3.5 py-1 rounded-full text-xs font-black border self-start sm:self-auto ${
                      isKycVerified
                        ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                        : isKycPending
                        ? 'bg-amber-100 text-amber-950 border-amber-300'
                        : customer.kycStatus === 'action_required' || customer.kycStatus === 'partially_approved'
                        ? 'bg-orange-100 text-orange-950 border-orange-300'
                        : customer.kycStatus === 'rejected'
                        ? 'bg-rose-100 text-rose-950 border-rose-300'
                        : 'bg-slate-100 text-slate-800 border-slate-300'
                    }`}
                  >
                    {customer.kycStatus?.toUpperCase() || 'UNVERIFIED'}
                  </span>
                </div>

                {/* Customer KYC Metadata Summary */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Full Legal Name</span>
                    <span className="font-extrabold text-slate-950 text-sm mt-0.5 block truncate">
                      {customer.kycFullName || `${customer.firstName} ${customer.lastName}`}
                    </span>
                  </div>

                  <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Country</span>
                    <span className="font-extrabold text-slate-950 text-sm mt-0.5 block truncate">
                      {customer.kycCountry || customer.country || 'United States'}
                    </span>
                  </div>

                  <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Phone & Email</span>
                    <span className="font-extrabold text-slate-950 text-xs mt-0.5 block truncate">
                      {customer.kycPhone || customer.phone || 'No phone'}
                    </span>
                    <span className="text-slate-600 text-xs truncate block">{customer.kycEmail || customer.email}</span>
                  </div>

                  <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Date of Birth</span>
                    <span className="font-extrabold text-slate-950 text-sm mt-0.5 block">
                      {customer.kycDateOfBirth || customer.dateOfBirth || 'Not specified'}
                    </span>
                  </div>
                </div>

                {/* ITEM 1: GOVERNMENT IDENTITY DOCUMENT */}
                {(() => {
                  const item = customer.kycItemReviews?.identity;
                  const itemStatus = item?.status || (isKycVerified ? 'approved' : isKycPending ? 'pending' : 'pending');
                  return (
                    <div className="p-5 rounded-2xl border border-slate-200 bg-slate-50/80 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-200">
                        <div className="flex items-center gap-2.5">
                          <FileText className="w-5 h-5 text-indigo-600" />
                          <h5 className="text-sm font-black text-slate-900 uppercase tracking-wider">
                            1. Government Identification ({customer.kycDocumentType || "Driver's License / Passport"})
                          </h5>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-xs font-black border ${
                              itemStatus === 'approved'
                                ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                                : itemStatus === 'rejected'
                                ? 'bg-rose-100 text-rose-950 border-rose-300'
                                : 'bg-amber-100 text-amber-950 border-amber-300'
                            }`}
                          >
                            {itemStatus.toUpperCase()}
                          </span>
                        </div>
                      </div>

                      {item?.rejectionReason && (
                        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-900 font-semibold">
                          <strong>Rejection Note:</strong> {item.rejectionReason}
                        </div>
                      )}

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                        <div className="p-2.5 bg-white rounded-lg border border-slate-200">
                          <span className="text-slate-500 font-bold block">Document Type</span>
                          <span className="font-extrabold text-slate-900 text-sm mt-0.5 block">{customer.kycDocumentType || "Driver's License"}</span>
                        </div>
                        <div className="p-2.5 bg-white rounded-lg border border-slate-200">
                          <span className="text-slate-500 font-bold block">Document Number</span>
                          <span className="font-mono font-black text-slate-900 text-sm mt-0.5 block">{customer.kycDocumentNumber || 'Not provided'}</span>
                        </div>
                      </div>

                      {/* Front and Back Images */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                        <div>
                          <span className="text-xs font-bold text-slate-700 block mb-1.5">Front Page Photo</span>
                          {customer.kycDocumentImage ? (
                            <div className="relative group rounded-xl overflow-hidden border border-slate-200 bg-white">
                              <img
                                src={customer.kycDocumentImage}
                                alt="ID Front"
                                className="w-full h-36 object-cover"
                              />
                              <button
                                type="button"
                                onClick={() => setZoomedImage({ src: customer.kycDocumentImage!, title: 'Government ID - Front' })}
                                className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-xs font-bold gap-1.5 transition-opacity cursor-pointer"
                              >
                                <Eye className="w-4 h-4" /> Inspect Image
                              </button>
                            </div>
                          ) : (
                            <div className="h-36 rounded-xl bg-slate-200/80 flex items-center justify-center text-xs text-slate-600 font-bold">
                              No front image uploaded
                            </div>
                          )}
                        </div>

                        <div>
                          <span className="text-xs font-bold text-slate-700 block mb-1.5">Back Page Photo</span>
                          {customer.kycDocumentBackImage ? (
                            <div className="relative group rounded-xl overflow-hidden border border-slate-200 bg-white">
                              <img
                                src={customer.kycDocumentBackImage}
                                alt="ID Back"
                                className="w-full h-36 object-cover"
                              />
                              <button
                                type="button"
                                onClick={() => setZoomedImage({ src: customer.kycDocumentBackImage!, title: 'Government ID - Back' })}
                                className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-xs font-bold gap-1.5 transition-opacity cursor-pointer"
                              >
                                <Eye className="w-4 h-4" /> Inspect Image
                              </button>
                            </div>
                          ) : (
                            <div className="h-36 rounded-xl bg-slate-200/80 flex items-center justify-center text-xs text-slate-600 font-bold">
                              {customer.kycDocumentType?.toLowerCase().includes('passport') ? 'Not required for Passport' : 'No back image uploaded'}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Granular item actions */}
                      {onReviewKycItem && (
                        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmConfig({
                                isOpen: true,
                                title: 'Reject Government ID Document',
                                description: `Specify the compliance reason for rejecting the ID document of ${customer.firstName} ${customer.lastName}. The user will be asked to re-upload only this document.`,
                                confirmLabel: 'Reject ID',
                                variant: 'danger',
                                action: async (reason) => {
                                  await onReviewKycItem(customer.id, 'identity', 'rejected', reason || 'Unclear, expired, or cropped ID photo.', customer);
                                  if (onRefreshData) onRefreshData().catch(() => {});
                                },
                              });
                            }}
                            className="px-3.5 py-1.5 text-xs font-extrabold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-300 rounded-lg transition-colors cursor-pointer"
                          >
                            Reject ID Document
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await onReviewKycItem(customer.id, 'identity', 'approved', undefined, customer);
                              if (onRefreshData) onRefreshData().catch(() => {});
                            }}
                            className="px-4 py-1.5 text-xs font-extrabold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors cursor-pointer shadow-xs"
                          >
                            Approve ID Document
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* ITEM 2: PROOF OF ADDRESS */}
                {(() => {
                  const item = customer.kycItemReviews?.proofOfAddress;
                  const itemStatus = item?.status || (isKycVerified ? 'approved' : isKycPending ? 'pending' : 'pending');
                  return (
                    <div className="p-5 rounded-2xl border border-slate-200 bg-slate-50/80 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-200">
                        <div className="flex items-center gap-2.5">
                          <Building2 className="w-5 h-5 text-sky-600" />
                          <h5 className="text-sm font-black text-slate-900 uppercase tracking-wider">
                            2. Proof of Address ({customer.kycProofOfAddressType || 'Bank Statement / Utility'})
                          </h5>
                        </div>
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-xs font-black border ${
                            itemStatus === 'approved'
                              ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                              : itemStatus === 'rejected'
                              ? 'bg-rose-100 text-rose-950 border-rose-300'
                              : 'bg-amber-100 text-amber-950 border-amber-300'
                          }`}
                        >
                          {itemStatus.toUpperCase()}
                        </span>
                      </div>

                      {item?.rejectionReason && (
                        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-900 font-semibold">
                          <strong>Rejection Note:</strong> {item.rejectionReason}
                        </div>
                      )}

                      <div className="p-3 bg-white rounded-xl border border-slate-200 text-xs space-y-1">
                        <span className="text-slate-500 font-bold block">Registered Residential Address</span>
                        <span className="font-extrabold text-slate-900 text-sm block">
                          {customer.kycStreetAddress || customer.streetAddress || 'Not specified'}
                        </span>
                      </div>

                      <div>
                        <span className="text-xs font-bold text-slate-700 block mb-1.5">Submitted Proof Document</span>
                        {customer.kycProofOfAddressImage ? (
                          <div className="relative group rounded-xl overflow-hidden border border-slate-200 bg-white max-w-md">
                            <img
                              src={customer.kycProofOfAddressImage}
                              alt="Proof of Address"
                              className="w-full h-40 object-cover"
                            />
                            <button
                              type="button"
                              onClick={() => setZoomedImage({ src: customer.kycProofOfAddressImage!, title: 'Proof of Address' })}
                              className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-xs font-bold gap-1.5 transition-opacity cursor-pointer"
                            >
                              <Eye className="w-4 h-4" /> Inspect Full Document
                            </button>
                          </div>
                        ) : (
                          <div className="h-28 rounded-xl bg-slate-200/80 flex items-center justify-center text-xs text-slate-600 font-bold">
                            No proof of address image uploaded
                          </div>
                        )}
                      </div>

                      {/* Granular item actions */}
                      {onReviewKycItem && (
                        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmConfig({
                                isOpen: true,
                                title: 'Reject Proof of Address',
                                description: `Specify why the proof of address document for ${customer.firstName} ${customer.lastName} is rejected (e.g. older than 3 months, name mismatch, illegible).`,
                                confirmLabel: 'Reject Address',
                                variant: 'danger',
                                action: async (reason) => {
                                  await onReviewKycItem(customer.id, 'proofOfAddress', 'rejected', reason || 'Proof of address older than 3 months or illegible.', customer);
                                  if (onRefreshData) onRefreshData().catch(() => {});
                                },
                              });
                            }}
                            className="px-3.5 py-1.5 text-xs font-extrabold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-300 rounded-lg transition-colors cursor-pointer"
                          >
                            Reject Proof of Address
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await onReviewKycItem(customer.id, 'proofOfAddress', 'approved', undefined, customer);
                              if (onRefreshData) onRefreshData().catch(() => {});
                            }}
                            className="px-4 py-1.5 text-xs font-extrabold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors cursor-pointer shadow-xs"
                          >
                            Approve Proof of Address
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* ITEM 3: BIOMETRIC FACIAL SELFIE */}
                {(() => {
                  const item = customer.kycItemReviews?.liveness;
                  const itemStatus = item?.status || (isKycVerified ? 'approved' : isKycPending ? 'pending' : 'pending');
                  return (
                    <div className="p-5 rounded-2xl border border-slate-200 bg-slate-50/80 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-200">
                        <div className="flex items-center gap-2.5">
                          <ShieldCheck className="w-5 h-5 text-emerald-600" />
                          <h5 className="text-sm font-black text-slate-900 uppercase tracking-wider">
                            3. Biometric Facial Selfie
                          </h5>
                        </div>
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-xs font-black border ${
                            itemStatus === 'approved'
                              ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                              : itemStatus === 'rejected'
                              ? 'bg-rose-100 text-rose-950 border-rose-300'
                              : 'bg-amber-100 text-amber-950 border-amber-300'
                          }`}
                        >
                          {itemStatus.toUpperCase()}
                        </span>
                      </div>

                      {item?.rejectionReason && (
                        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-900 font-semibold">
                          <strong>Rejection Note:</strong> {item.rejectionReason}
                        </div>
                      )}

                      <div className="flex items-center gap-6">
                        {customer.kycLiveSelfieImage || customer.avatarUrl ? (
                          <div className="relative group rounded-full overflow-hidden border-2 border-slate-300 bg-white w-28 h-28 shrink-0">
                            <img
                              src={customer.kycLiveSelfieImage || customer.avatarUrl}
                              alt="Biometric Selfie"
                              className="w-full h-full object-cover"
                            />
                            <button
                              type="button"
                              onClick={() => setZoomedImage({ src: (customer.kycLiveSelfieImage || customer.avatarUrl)!, title: 'Biometric Facial Selfie' })}
                              className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-[11px] font-bold transition-opacity cursor-pointer"
                            >
                              Inspect
                            </button>
                          </div>
                        ) : (
                          <div className="w-28 h-28 rounded-full bg-slate-200/80 flex items-center justify-center text-xs text-slate-600 font-bold text-center p-2 shrink-0">
                            No selfie uploaded
                          </div>
                        )}

                        <div className="text-xs text-slate-600 space-y-1">
                          <p className="font-bold text-slate-800">Biometric Facial Match</p>
                          <p>Ensures applicant matches ID card photo and confirms physical liveness.</p>
                        </div>
                      </div>

                      {/* Granular item actions */}
                      {onReviewKycItem && (
                        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmConfig({
                                isOpen: true,
                                title: 'Reject Biometric Selfie',
                                description: `Specify why the selfie for ${customer.firstName} ${customer.lastName} is rejected (e.g. face covered, blurry, poor lighting).`,
                                confirmLabel: 'Reject Selfie',
                                variant: 'danger',
                                action: async (reason) => {
                                  await onReviewKycItem(customer.id, 'liveness', 'rejected', reason || 'Selfie image is blurry or poorly lit.', customer);
                                  if (onRefreshData) onRefreshData().catch(() => {});
                                },
                              });
                            }}
                            className="px-3.5 py-1.5 text-xs font-extrabold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-300 rounded-lg transition-colors cursor-pointer"
                          >
                            Reject Selfie
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await onReviewKycItem(customer.id, 'liveness', 'approved', undefined, customer);
                              if (onRefreshData) onRefreshData().catch(() => {});
                            }}
                            className="px-4 py-1.5 text-xs font-extrabold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors cursor-pointer shadow-xs"
                          >
                            Approve Selfie
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* ITEM 4: US SSN TAX IDENTIFIER (IF APPLICABLE) */}
                {(customer.kycSsn || customer.kycCountry?.toLowerCase().includes('united states') || customer.country?.toLowerCase().includes('united states')) && (() => {
                  const item = customer.kycItemReviews?.ssn;
                  const itemStatus = item?.status || (isKycVerified ? 'approved' : isKycPending ? 'pending' : 'pending');
                  return (
                    <div className="p-5 rounded-2xl border border-slate-200 bg-slate-50/80 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-200">
                        <div className="flex items-center gap-2.5">
                          <Lock className="w-5 h-5 text-amber-600" />
                          <h5 className="text-sm font-black text-slate-900 uppercase tracking-wider">
                            4. US Social Security Number (Tax CIP)
                          </h5>
                        </div>
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-xs font-black border ${
                            itemStatus === 'approved'
                              ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                              : itemStatus === 'rejected'
                              ? 'bg-rose-100 text-rose-950 border-rose-300'
                              : 'bg-amber-100 text-amber-950 border-amber-300'
                          }`}
                        >
                          {itemStatus.toUpperCase()}
                        </span>
                      </div>

                      {item?.rejectionReason && (
                        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-900 font-semibold">
                          <strong>Rejection Note:</strong> {item.rejectionReason}
                        </div>
                      )}

                      <div className="flex items-center justify-between p-3 bg-white rounded-xl border border-slate-200 text-xs">
                        <div>
                          <span className="text-slate-500 font-bold block">Social Security Number</span>
                          <span className="font-mono font-black text-slate-900 text-base mt-0.5 block tracking-wider">
                            {customer.kycSsn
                              ? showSsn
                                ? customer.kycSsn
                                : `•••-••-${customer.kycSsn.replace(/\D/g, '').slice(-4)}`
                              : 'Not provided'}
                          </span>
                        </div>
                        {customer.kycSsn && (
                          <button
                            type="button"
                            onClick={() => setShowSsn(!showSsn)}
                            className="px-3 py-1.5 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-700 cursor-pointer"
                          >
                            {showSsn ? 'Hide SSN' : 'Reveal SSN'}
                          </button>
                        )}
                      </div>

                      {customer.kycSsnImage && (
                        <div>
                          <span className="text-xs font-bold text-slate-700 block mb-1.5">Attached SSN Card Document</span>
                          <div className="relative group rounded-xl overflow-hidden border border-slate-200 bg-white max-w-sm">
                            <img
                              src={customer.kycSsnImage}
                              alt="SSN Card"
                              className="w-full h-32 object-cover"
                            />
                            <button
                              type="button"
                              onClick={() => setZoomedImage({ src: customer.kycSsnImage!, title: 'SSN Card Document' })}
                              className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-xs font-bold gap-1.5 transition-opacity cursor-pointer"
                            >
                              <Eye className="w-4 h-4" /> Inspect SSN Card
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Granular item actions */}
                      {onReviewKycItem && (
                        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmConfig({
                                isOpen: true,
                                title: 'Reject US SSN Identification',
                                description: `Specify why the SSN for ${customer.firstName} ${customer.lastName} is rejected.`,
                                confirmLabel: 'Reject SSN',
                                variant: 'danger',
                                action: async (reason) => {
                                  await onReviewKycItem(customer.id, 'ssn', 'rejected', reason || 'Invalid or mismatched SSN record.', customer);
                                  if (onRefreshData) onRefreshData().catch(() => {});
                                },
                              });
                            }}
                            className="px-3.5 py-1.5 text-xs font-extrabold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-300 rounded-lg transition-colors cursor-pointer"
                          >
                            Reject SSN
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await onReviewKycItem(customer.id, 'ssn', 'approved', undefined, customer);
                              if (onRefreshData) onRefreshData().catch(() => {});
                            }}
                            className="px-4 py-1.5 text-xs font-extrabold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors cursor-pointer shadow-xs"
                          >
                            Approve SSN
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* OVERALL KYC ACTIONS */}
                <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
                  <div className="text-xs text-slate-500 font-semibold">
                    Approving the entire KYC activates the verified blue badge and unlocks full $1,000,000 limits.
                  </div>

                  <div className="flex items-center gap-3">
                    {!isKycVerified ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmConfig({
                              isOpen: true,
                              title: 'Reject Entire KYC Application',
                              description: `You are rejecting all identity documents submitted by ${customer.firstName} ${customer.lastName}. The user will be notified to resubmit compliant credentials.`,
                              confirmLabel: 'Reject All KYC',
                              variant: 'danger',
                              action: async (reason) => {
                                await onRejectKyc(customer.id, reason, customer);
                                if (onRefreshData) onRefreshData().catch(() => {});
                              },
                            });
                          }}
                          className="px-4 py-2.5 text-xs font-extrabold text-rose-800 bg-rose-50 hover:bg-rose-100 border border-rose-300 rounded-xl transition-colors shadow-xs cursor-pointer"
                        >
                          Reject Entire Application
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmConfig({
                              isOpen: true,
                              title: 'Approve All Documents & Verify Account',
                              description: `You are approving all identity credentials for ${customer.firstName} ${customer.lastName}. This will activate the verified badge and unlock the full $1,000,000 daily transaction limit.`,
                              confirmLabel: 'Approve All & Verify',
                              variant: 'primary',
                              action: async () => {
                                await onApproveKyc(customer.id, customer);
                                if (onRefreshData) onRefreshData().catch(() => {});
                              },
                            });
                          }}
                          className="px-5 py-2.5 text-xs font-extrabold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors shadow-sm shadow-emerald-600/25 cursor-pointer"
                        >
                          Approve All & Verify
                        </button>
                      </>
                    ) : (
                      <div className="text-xs text-emerald-800 font-black flex items-center gap-2">
                        <CheckCircle2 className="w-5 h-5 text-emerald-600 stroke-[2.5]" /> Full Identity Clearance Granted
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'controls' && (
            <div className="space-y-6">
              {/* Freeze / Unfreeze Action Card */}
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h4 className="text-base font-black text-slate-950 flex items-center gap-2.5">
                      {isFrozen ? <ShieldAlert className="w-6 h-6 text-rose-600 stroke-[2.5]" /> : <ShieldCheck className="w-6 h-6 text-emerald-600 stroke-[2.5]" />}
                      Account Freeze & Compliance Restriction
                    </h4>
                    <p className="text-sm font-semibold text-slate-600 mt-1.5 max-w-lg leading-relaxed">
                      {isFrozen
                        ? 'This account is currently FROZEN. All outgoing transfers, card spending, and withdrawals are locked. You can unfreeze the account after completing compliance review.'
                        : 'Freezing this account immediately halts all outward movements of funds, card authorisations, and active transaction capabilities for security or fraud review.'}
                    </p>
                  </div>

                  <button
                    onClick={() => {
                      setConfirmConfig({
                        isOpen: true,
                        title: isFrozen ? 'Unfreeze Customer Account' : 'Freeze & Restrict Customer Account',
                        description: isFrozen
                          ? `You are restoring full transactional access to ${customer.firstName} ${customer.lastName}'s account. All features and card limits will be reactivated.`
                          : `You are restricting ${customer.firstName} ${customer.lastName}'s account. The customer will not be able to execute withdrawals or transfers until unrestricted.`,
                        confirmLabel: isFrozen ? 'Unfreeze Account' : 'Freeze Account',
                        variant: isFrozen ? 'primary' : 'danger',
                        action: async (reason) => {
                          await onToggleStatus(customer.id, reason);
                          if (onRefreshData) await onRefreshData();
                        },
                      });
                    }}
                    className={`px-6 py-3 text-sm font-black rounded-xl transition-all shadow-xs flex items-center gap-2 whitespace-nowrap ${
                      isFrozen
                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/20'
                        : 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-600/20'
                    }`}
                  >
                    {isFrozen ? <Unlock className="w-5 h-5 stroke-[2.5]" /> : <Lock className="w-5 h-5 stroke-[2.5]" />}
                    {isFrozen ? 'Unfreeze Customer Account' : 'Freeze Customer Account'}
                  </button>
                </div>
              </div>

              {/* Administrative Notice */}
              <div className="p-5 rounded-2xl bg-amber-50 border border-amber-300 text-amber-950 text-sm leading-relaxed font-semibold">
                <strong className="font-black block mb-1 text-base">Administrative Compliance Notice:</strong>
                All customer controls executed from this console are recorded directly in the immutable administrative audit ledger with your administrator ID, timestamp, and IP address.
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-5 bg-slate-100 border-t border-slate-200 flex items-center justify-between text-sm text-slate-600 font-bold">
          <div>
            Viewing customer dossier for <span className="font-black text-slate-950">{customer.firstName} {customer.lastName}</span>
          </div>
          <button
            onClick={onClose}
            className="px-5 py-2 font-extrabold text-slate-800 bg-white hover:bg-slate-50 border border-slate-300 rounded-xl transition-colors shadow-xs"
          >
            Close Dossier
          </button>
        </div>
      </div>

      {/* Confirmation Modal */}
      <AdminConfirmationModal
        isOpen={confirmConfig.isOpen}
        onClose={() => setConfirmConfig((prev) => ({ ...prev, isOpen: false }))}
        onConfirm={confirmConfig.action}
        title={confirmConfig.title}
        description={confirmConfig.description}
        confirmLabel={confirmConfig.confirmLabel}
        confirmVariant={confirmConfig.variant}
        targetEntityName={`${customer.firstName} ${customer.lastName} (${customer.permanentAccountNumber})`}
      />

      {/* Zoom Image Inspection Modal */}
      {zoomedImage && (
        <div className="fixed inset-0 z-60 bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-center p-4 sm:p-8 animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="p-4 sm:p-5 bg-slate-850 border-b border-slate-700 flex items-center justify-between">
              <h4 className="text-base font-black text-white">{zoomedImage.title}</h4>
              <button
                type="button"
                onClick={() => setZoomedImage(null)}
                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5 stroke-[2.5]" />
              </button>
            </div>
            <div className="p-4 sm:p-6 overflow-auto flex items-center justify-center bg-slate-950 flex-1 min-h-[300px]">
              <img
                src={zoomedImage.src}
                alt={zoomedImage.title}
                className="max-h-[70vh] max-w-full object-contain rounded-xl shadow-lg border border-slate-800"
              />
            </div>
            <div className="p-4 bg-slate-850 border-t border-slate-700 flex justify-end">
              <button
                type="button"
                onClick={() => setZoomedImage(null)}
                className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs border border-slate-600 transition-colors cursor-pointer"
              >
                Close Fullscreen Inspection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
