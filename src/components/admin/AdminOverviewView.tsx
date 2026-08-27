import React from 'react';
import {
  UserProfile,
  Transaction,
  AdminSystemOverview,
  AdminAuditLog,
} from '../../types';
import {
  Users,
  ShieldCheck,
  Clock,
  ArrowDownLeft,
  ArrowUpRight,
  RefreshCw,
  Coins,
  Shield,
  Activity,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  ArrowRight,
  DollarSign,
  Building,
  Lock,
  Send,
  Zap,
} from 'lucide-react';

interface AdminOverviewViewProps {
  metrics: AdminSystemOverview | null;
  customers: (UserProfile & { balanceMetrics?: any })[];
  transactions: Transaction[];
  auditLogs: AdminAuditLog[];
  onNavigateTab: (tab: string) => void;
  onSelectCustomer: (customer: UserProfile & { balanceMetrics?: any }) => void;
  onOpenSendMoney?: () => void;
}

export const AdminOverviewView: React.FC<AdminOverviewViewProps> = ({
  metrics,
  customers,
  transactions,
  auditLogs,
  onNavigateTab,
  onSelectCustomer,
  onOpenSendMoney,
}) => {
  const pendingKycCustomers = customers.filter((c) => c.kycStatus === 'pending');
  const verifiedCustomers = customers.filter((c) => c.kycStatus === 'verified');
  const activeCustomers = customers.filter((c) => c.status === 'active');
  const frozenCustomers = customers.filter((c) => c.status === 'frozen');

  const pendingTxs = transactions.filter((t) => t.status === 'PENDING');
  const completedTxs = transactions.filter((t) => t.status === 'COMPLETED');
  
  const deposits = transactions.filter((t) => t.type === 'DEPOSIT' || t.category === 'Deposits');
  const totalDepositVolume = deposits.reduce((acc, t) => acc + (t.status === 'COMPLETED' ? t.amount : 0), 0);

  const withdrawals = transactions.filter((t) => t.type === 'WITHDRAWAL' || t.category === 'Withdrawals');
  const totalWithdrawalVolume = withdrawals.reduce((acc, t) => acc + (t.status === 'COMPLETED' ? t.amount : 0), 0);

  const transfers = transactions.filter((t) => t.type === 'TRANSFER' || t.category === 'Transfers');
  const totalTransferVolume = transfers.reduce((acc, t) => acc + (t.status === 'COMPLETED' ? t.amount : 0), 0);

  const totalUserBalances = customers.reduce((sum, c) => sum + (c.balanceMetrics?.totalBalance || 0), 0);

  return (
    <div className="space-y-6">
      {/* Top Welcome / System Status Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-850 to-slate-900 rounded-2xl p-6 sm:p-7 text-white shadow-xl border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <span className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-black uppercase tracking-widest text-amber-400">
              Core Banking Node 01 • Operational
            </span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">Monvera Executive Control Center</h2>
          <p className="text-sm font-medium text-slate-300 max-w-2xl leading-relaxed">
            Real-time governance, ledger double-entry reconciliation, customer compliance dossier, and instant settlement monitoring.
          </p>
        </div>

        <div className="flex items-center gap-3.5 self-stretch md:self-auto">
          <div className="px-5 py-3 rounded-xl bg-slate-800/90 border border-slate-700 text-right shadow-sm">
            <div className="text-xs uppercase font-extrabold text-slate-300 tracking-wider">Total User Net Worth</div>
            <div className="text-xl sm:text-2xl font-black text-amber-400 font-mono mt-0.5">
              ${totalUserBalances.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </div>
          </div>

          <div className="px-5 py-3 rounded-xl bg-slate-800/90 border border-slate-700 text-right shadow-sm">
            <div className="text-xs uppercase font-extrabold text-slate-300 tracking-wider">Reserve Coverage</div>
            <div className="text-xl sm:text-2xl font-black text-emerald-400 font-mono mt-0.5">
              {metrics?.systemReserveRatio || 100}% Liquid
            </div>
          </div>
        </div>
      </div>

      {/* Executive Quick Banking Actions Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 p-5 rounded-2xl bg-white border border-slate-200 shadow-xs">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-slate-900 text-emerald-400 flex items-center justify-center flex-shrink-0 shadow-xs">
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <div className="text-base font-black text-slate-950 flex items-center gap-2">
              <span>Executive Disbursement & Transfers</span>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300 uppercase">
                Active
              </span>
            </div>
            <p className="text-xs text-slate-500 font-semibold mt-0.5">
              Initiate double-entry fund disbursements from Bennett Johnson directly to any customer account.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            id="admin-overview-send-money-btn"
            onClick={onOpenSendMoney ? onOpenSendMoney : () => onNavigateTab('transfers')}
            className="w-full sm:w-auto px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer border border-emerald-500/60 active:scale-95"
            title="Open Administrator Send Money Interface"
          >
            <Send className="w-4 h-4 text-white stroke-[2.5]" />
            <span>Send Money</span>
          </button>
        </div>
      </div>

      {/* Primary KPI Grid (8 Key Cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
        {/* Total Customers */}
        <div
          onClick={() => onNavigateTab('customers')}
          className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-xs hover:shadow-md hover:border-slate-300 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-slate-600 uppercase tracking-wider">Total Customers</span>
            <div className="p-3 rounded-xl bg-blue-50 text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-colors">
              <Users className="w-6 h-6" />
            </div>
          </div>
          <div className="mt-3.5">
            <div className="text-3xl font-black text-slate-900 tracking-tight">{customers.length}</div>
            <div className="flex items-center gap-2 mt-1.5 text-xs font-bold text-slate-600">
              <span className="text-emerald-700 font-black">{activeCustomers.length} active</span>
              <span>•</span>
              <span className={frozenCustomers.length > 0 ? 'text-rose-700 font-black' : ''}>
                {frozenCustomers.length} frozen
              </span>
            </div>
          </div>
        </div>

        {/* Active Accounts */}
        <div
          onClick={() => onNavigateTab('customers')}
          className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-xs hover:shadow-md hover:border-slate-300 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-slate-600 uppercase tracking-wider">Active Bank Accounts</span>
            <div className="p-3 rounded-xl bg-emerald-50 text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
              <Building className="w-6 h-6" />
            </div>
          </div>
          <div className="mt-3.5">
            <div className="text-3xl font-black text-slate-900 tracking-tight">
              {metrics?.activeAccounts || customers.length * 3}
            </div>
            <div className="text-xs font-bold text-slate-500 mt-1.5">
              Checking, Treasury & Investment portfolios
            </div>
          </div>
        </div>

        {/* Pending KYC Queue */}
        <div
          onClick={() => onNavigateTab('kyc')}
          className={`p-5 sm:p-6 rounded-2xl border shadow-xs hover:shadow-md transition-all cursor-pointer group ${
            pendingKycCustomers.length > 0
              ? 'bg-amber-50/70 border-amber-300'
              : 'bg-white border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-slate-600 uppercase tracking-wider">Pending KYC Queue</span>
            <div
              className={`p-3 rounded-xl transition-colors ${
                pendingKycCustomers.length > 0
                  ? 'bg-amber-500 text-white'
                  : 'bg-slate-100 text-slate-600 group-hover:bg-amber-500 group-hover:text-white'
              }`}
            >
              <Clock className="w-6 h-6" />
            </div>
          </div>
          <div className="mt-3.5">
            <div className="text-3xl font-black text-slate-900 tracking-tight">
              {pendingKycCustomers.length}
            </div>
            <div className="text-xs font-bold text-amber-900 mt-1.5 flex items-center gap-1.5">
              {pendingKycCustomers.length > 0 ? (
                <>
                  <AlertTriangle className="w-4 h-4 text-amber-600 stroke-[2.5]" /> Requires compliance review
                </>
              ) : (
                <span className="text-slate-500 font-semibold">All submissions verified</span>
              )}
            </div>
          </div>
        </div>

        {/* Verified Customers */}
        <div
          onClick={() => onNavigateTab('kyc')}
          className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-xs hover:shadow-md hover:border-slate-300 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-slate-600 uppercase tracking-wider">Verified Customers</span>
            <div className="p-3 rounded-xl bg-blue-50 text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-colors">
              <ShieldCheck className="w-6 h-6" />
            </div>
          </div>
          <div className="mt-3.5">
            <div className="text-3xl font-black text-slate-900 tracking-tight">
              {verifiedCustomers.length}
            </div>
            <div className="text-xs font-bold text-slate-500 mt-1.5">
              $1,000,000 daily transaction limit enabled
            </div>
          </div>
        </div>

        {/* Total Platform Deposits */}
        <div
          onClick={() => onNavigateTab('deposits')}
          className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-xs hover:shadow-md hover:border-slate-300 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-slate-600 uppercase tracking-wider">Total Deposits</span>
            <div className="p-3 rounded-xl bg-emerald-50 text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
              <ArrowDownLeft className="w-6 h-6" />
            </div>
          </div>
          <div className="mt-3.5">
            <div className="text-2xl font-black text-slate-900 font-mono tracking-tight">
              ${totalDepositVolume.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </div>
            <div className="text-xs font-bold text-slate-500 mt-1.5">
              {deposits.length} cleared provider inflows
            </div>
          </div>
        </div>

        {/* Total Withdrawals */}
        <div
          onClick={() => onNavigateTab('withdrawals')}
          className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-xs hover:shadow-md hover:border-slate-300 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-slate-600 uppercase tracking-wider">Total Withdrawals</span>
            <div className="p-3 rounded-xl bg-slate-100 text-slate-700 group-hover:bg-slate-900 group-hover:text-white transition-colors">
              <ArrowUpRight className="w-6 h-6" />
            </div>
          </div>
          <div className="mt-3.5">
            <div className="text-2xl font-black text-slate-900 font-mono tracking-tight">
              ${totalWithdrawalVolume.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </div>
            <div className="text-xs font-bold text-slate-500 mt-1.5">
              {withdrawals.length} settled outbound transfers
            </div>
          </div>
        </div>

        {/* Internal Transfers */}
        <div
          onClick={() => onNavigateTab('transfers')}
          className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-xs hover:shadow-md hover:border-slate-300 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-slate-600 uppercase tracking-wider">Monvera Transfers</span>
            <div className="p-3 rounded-xl bg-purple-50 text-purple-600 group-hover:bg-purple-600 group-hover:text-white transition-colors">
              <RefreshCw className="w-6 h-6" />
            </div>
          </div>
          <div className="mt-3.5">
            <div className="text-2xl font-black text-slate-900 font-mono tracking-tight">
              ${totalTransferVolume.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </div>
            <div className="text-xs font-bold text-slate-500 mt-1.5">
              {transfers.length} instant peer clearances
            </div>
          </div>
        </div>

        {/* Pending Transactions */}
        <div
          onClick={() => onNavigateTab('transactions')}
          className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-xs hover:shadow-md hover:border-slate-300 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-slate-600 uppercase tracking-wider">Pending Transactions</span>
            <div className="p-3 rounded-xl bg-amber-50 text-amber-600 group-hover:bg-amber-600 group-hover:text-white transition-colors">
              <Clock className="w-6 h-6" />
            </div>
          </div>
          <div className="mt-3.5">
            <div className="text-3xl font-black text-slate-900 tracking-tight">
              {pendingTxs.length}
            </div>
            <div className="text-xs font-bold text-slate-500 mt-1.5">
              {pendingTxs.length === 0 ? 'All transactions completed' : 'Awaiting settlement'}
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid: Priority Attention & Customer Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column (2 Cols): Pending Actions & Recent Transactions */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Pending KYC Action Card */}
          {pendingKycCustomers.length > 0 && (
            <div className="bg-amber-50 border border-amber-300 rounded-2xl p-5 sm:p-6 shadow-xs">
              <div className="flex items-center justify-between mb-3.5">
                <div className="flex items-center gap-2.5 text-amber-950 font-black text-base">
                  <AlertTriangle className="w-5 h-5 text-amber-600 stroke-[2.5]" />
                  Action Required: {pendingKycCustomers.length} KYC Verification{pendingKycCustomers.length > 1 ? 's' : ''} Pending
                </div>
                <button
                  onClick={() => onNavigateTab('kyc')}
                  className="text-sm font-extrabold text-amber-900 hover:text-amber-950 flex items-center gap-1.5 px-3 py-1 bg-amber-100/80 rounded-lg hover:bg-amber-200 transition-colors"
                >
                  Open Queue <ArrowRight className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-2.5">
                {pendingKycCustomers.map((cust) => (
                  <div
                    key={cust.id}
                    className="bg-white p-3.5 sm:p-4 rounded-xl border border-amber-200 flex items-center justify-between gap-4 text-sm"
                  >
                    <div className="flex items-center gap-3.5">
                      <div className="w-10 h-10 rounded-xl bg-amber-100 font-black text-amber-900 flex items-center justify-center text-sm shadow-xs">
                        {cust.firstName[0]}
                        {cust.lastName[0]}
                      </div>
                      <div>
                        <div className="font-extrabold text-slate-900 text-sm sm:text-base">
                          {cust.firstName} {cust.lastName}
                        </div>
                        <div className="text-slate-600 font-semibold text-xs mt-0.5">
                          {cust.kycDocumentType || 'Passport'} • {cust.country || 'Global'}
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => onSelectCustomer(cust)}
                      className="px-4 py-2 rounded-xl bg-slate-900 text-white font-bold text-xs sm:text-sm hover:bg-slate-800 transition-colors shadow-xs"
                    >
                      Review Dossier
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Ledger Activity Table */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-black text-slate-900">Recent Platform Transactions</h3>
                <p className="text-xs font-semibold text-slate-500 mt-0.5">Real-time ledger updates across all customers</p>
              </div>
              <button
                onClick={() => onNavigateTab('transactions')}
                className="text-xs sm:text-sm font-bold text-slate-800 hover:text-slate-950 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 transition-colors"
              >
                View Full Ledger <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            <div className="divide-y divide-slate-100">
              {transactions.slice(0, 5).map((tx) => {
                const isDeposit = tx.type === 'DEPOSIT' || tx.type === 'ADMIN_DEVELOPMENT_FUNDING';
                const isWithdrawal = tx.type === 'WITHDRAWAL';
                const isTransfer = tx.type === 'TRANSFER';
                return (
                  <div key={tx.id} className="py-3.5 flex items-center justify-between gap-4 text-sm">
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div
                        className={`p-2.5 rounded-xl shrink-0 ${
                          isDeposit
                            ? 'bg-emerald-50 text-emerald-700'
                            : isWithdrawal
                            ? 'bg-slate-100 text-slate-800'
                            : 'bg-purple-50 text-purple-700'
                        }`}
                      >
                        {isDeposit ? (
                          <ArrowDownLeft className="w-5 h-5 stroke-[2.5]" />
                        ) : isWithdrawal ? (
                          <ArrowUpRight className="w-5 h-5 stroke-[2.5]" />
                        ) : (
                          <RefreshCw className="w-5 h-5 stroke-[2.5]" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="font-extrabold text-slate-900 truncate text-sm sm:text-base">{tx.description}</div>
                        <div className="text-slate-500 font-mono font-semibold text-xs flex items-center gap-2 mt-0.5">
                          <span>{tx.referenceNumber}</span>
                          <span>•</span>
                          <span>
                            {new Date(tx.createdAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div
                        className={`font-mono font-black text-base sm:text-lg ${
                          isDeposit ? 'text-emerald-700' : 'text-slate-900'
                        }`}
                      >
                        {isDeposit ? '+' : '-'}${tx.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </div>
                      <span className="inline-block mt-0.5 px-2.5 py-0.5 rounded-full text-xs font-black bg-slate-100 text-slate-800">
                        {tx.status}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column (1 Col): Customer Directory Quick Cards & Audit Snippet */}
        <div className="space-y-6">
          
          {/* Customer Quick Directory */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-black text-slate-900">Key Account Profiles</h3>
                <p className="text-xs font-bold text-slate-500 mt-0.5">{customers.length} registered customers</p>
              </div>
              <button
                onClick={() => onNavigateTab('customers')}
                className="text-xs sm:text-sm font-bold text-slate-800 hover:text-slate-950 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 transition-colors"
              >
                All <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              {customers.slice(0, 4).map((cust) => (
                <div
                  key={cust.id}
                  onClick={() => onSelectCustomer(cust)}
                  className="p-3.5 rounded-xl border border-slate-150 hover:border-slate-300 hover:bg-slate-50 transition-all cursor-pointer flex items-center justify-between gap-3 shadow-xs"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-slate-900 text-amber-400 font-black flex items-center justify-center text-sm shrink-0 shadow-sm">
                      {cust.firstName[0]}
                      {cust.lastName[0]}
                    </div>
                    <div className="min-w-0">
                      <div className="font-black text-slate-900 text-sm truncate">
                        {cust.firstName} {cust.lastName}
                      </div>
                      <div className="text-xs text-slate-600 font-mono font-bold truncate mt-0.5">
                        {cust.permanentAccountNumber}
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="text-sm font-mono font-black text-slate-950">
                      ${(cust.balanceMetrics?.totalBalance || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </div>
                    <span
                      className={`text-xs font-black ${
                        cust.status === 'frozen' ? 'text-rose-700' : 'text-emerald-700'
                      }`}
                    >
                      {cust.status === 'frozen' ? 'Frozen' : 'Active'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Audit Log Preview */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-black text-slate-900">Governance Audit Trail</h3>
                <p className="text-xs font-bold text-slate-500 mt-0.5">Immutable admin actions</p>
              </div>
              <button
                onClick={() => onNavigateTab('audit')}
                className="text-xs sm:text-sm font-bold text-slate-800 hover:text-slate-950 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 transition-colors"
              >
                Log <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              {auditLogs.slice(0, 3).map((log) => (
                <div key={log.id} className="text-xs border-l-3 border-slate-400 pl-3.5 py-1.5">
                  <div className="font-extrabold text-slate-900 text-xs sm:text-sm">{log.action.replace(/_/g, ' ')}</div>
                  <div className="text-slate-600 font-semibold text-xs mt-0.5 line-clamp-1">{log.reason}</div>
                  <div className="text-slate-500 font-bold text-xs mt-1 font-mono">
                    {log.adminName} • {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
