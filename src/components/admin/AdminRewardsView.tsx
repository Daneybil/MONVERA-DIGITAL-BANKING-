import React, { useState, useEffect } from 'react';
import { api } from '../../services/api';
import { WelcomeRewardInfo } from '../../types';
import {
  Gift,
  CheckCircle2,
  Clock,
  Sparkles,
  Search,
  Filter,
  RefreshCw,
  Copy,
  Check,
  TrendingUp,
  ShieldCheck,
  AlertTriangle,
  User,
  ArrowUpRight,
  Landmark,
} from 'lucide-react';

export const AdminRewardsView: React.FC = () => {
  const [rewards, setRewards] = useState<WelcomeRewardInfo[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PAID' | 'IN_PROGRESS' | 'QUALIFIED'>('ALL');
  const [copiedRef, setCopiedRef] = useState<string | null>(null);

  const fetchAdminRewards = async () => {
    setLoading(true);
    try {
      const res = await api.getAdminWelcomeRewards();
      if (res.success && res.rewards) {
        setRewards(res.rewards);
        setStats(res.stats);
      }
    } catch (err) {
      console.error('[AdminRewardsView] Error loading rewards:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAdminRewards();
  }, []);

  const handleCopy = (text: string) => {
    try {
      navigator.clipboard.writeText(text);
      setCopiedRef(text);
      setTimeout(() => setCopiedRef(null), 2000);
    } catch {}
  };

  // Filter rewards
  const filteredRewards = rewards.filter((r) => {
    if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const name = (r.customerName || '').toLowerCase();
      const acc = (r.permanentAccountNumber || '').toLowerCase();
      const ref = (r.transactionReference || '').toLowerCase();
      const uid = (r.userId || '').toLowerCase();
      return name.includes(q) || acc.includes(q) || ref.includes(q) || uid.includes(q);
    }
    return true;
  });

  return (
    <div id="admin-welcome-rewards-view" className="space-y-6">
      {/* Top Banner: Program Header */}
      <div className="p-6 rounded-3xl bg-slate-900 border-2 border-slate-800 text-white shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-amber-400/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-black uppercase tracking-wider bg-amber-400/20 text-amber-300 border border-amber-400/40">
                Authoritative Incentive Program
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                100% Automated Backend
              </span>
            </div>
            <h2 className="text-2xl font-black text-white flex items-center gap-2.5">
              <Gift className="w-6 h-6 text-amber-400" />
              <span>Welcome Rewards Program ($1,000 per Eligible Account)</span>
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 max-w-2xl font-medium">
              Real-time monitoring of customer deposit progress toward the $10,000 cumulative threshold.
              Qualified accounts receive exactly $1,000 credited atomically via the core backend ledger.
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              onClick={fetchAdminRewards}
              disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs border border-slate-700 transition-all cursor-pointer shadow-sm disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-amber-400' : ''}`} />
              <span>Refresh Records</span>
            </button>
          </div>
        </div>
      </div>

      {/* Program Statistics Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Stat 1: Total Distributed */}
        <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-slate-500 text-xs font-mono font-bold uppercase tracking-wider">
            <span>Total Rewards Paid</span>
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
          </div>
          <div className="text-2xl sm:text-3xl font-black font-mono text-emerald-600 notranslate" translate="no">
            ${(stats?.totalRewardsDistributed ?? (rewards.filter((r) => r.status === 'PAID').length * 1000)).toLocaleString('en-US', {
              minimumFractionDigits: 2,
            })}
          </div>
          <div className="text-xs text-slate-600 font-semibold">
            {stats?.totalPaid ?? rewards.filter((r) => r.status === 'PAID').length} customers paid ($1,000 ea.)
          </div>
        </div>

        {/* Stat 2: Total Cumulative Qualifying Deposits */}
        <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-slate-500 text-xs font-mono font-bold uppercase tracking-wider">
            <span>Qualifying Deposits</span>
            <TrendingUp className="w-3.5 h-3.5 text-blue-500" />
          </div>
          <div className="text-2xl sm:text-3xl font-black font-mono text-slate-900 notranslate" translate="no">
            ${(stats?.totalQualifyingDeposits ?? rewards.reduce((acc, r) => acc + (r.qualifyingDeposits || 0), 0)).toLocaleString('en-US', {
              minimumFractionDigits: 2,
            })}
          </div>
          <div className="text-xs text-slate-600 font-semibold">
            Across all enrolled accounts
          </div>
        </div>

        {/* Stat 3: In Progress Customers */}
        <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-slate-500 text-xs font-mono font-bold uppercase tracking-wider">
            <span>In Progress</span>
            <Clock className="w-3.5 h-3.5 text-amber-500" />
          </div>
          <div className="text-2xl sm:text-3xl font-black font-mono text-amber-700 notranslate" translate="no">
            {stats?.totalInProgress ?? rewards.filter((r) => r.status === 'IN_PROGRESS').length}
          </div>
          <div className="text-xs text-slate-600 font-semibold">
            Deposits below $10,000 target
          </div>
        </div>

        {/* Stat 4: Tracked Customers */}
        <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-slate-500 text-xs font-mono font-bold uppercase tracking-wider">
            <span>Total Tracked</span>
            <ShieldCheck className="w-3.5 h-3.5 text-slate-500" />
          </div>
          <div className="text-2xl sm:text-3xl font-black font-mono text-slate-900 notranslate" translate="no">
            {rewards.length}
          </div>
          <div className="text-xs text-slate-600 font-semibold">
            Target: $10,000 / Reward: $1,000
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 bg-white rounded-2xl border border-slate-200 shadow-xs">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by customer, account #, ref..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-xs font-bold bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 transition-all text-slate-900"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto">
          {(['ALL', 'PAID', 'IN_PROGRESS', 'QUALIFIED'] as const).map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                statusFilter === st
                  ? 'bg-slate-950 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {st === 'ALL'
                ? `All (${rewards.length})`
                : st === 'PAID'
                ? `Paid (${rewards.filter((r) => r.status === 'PAID').length})`
                : st === 'IN_PROGRESS'
                ? `In Progress (${rewards.filter((r) => r.status === 'IN_PROGRESS').length})`
                : `Qualified (${rewards.filter((r) => r.status === 'QUALIFIED').length})`}
            </button>
          ))}
        </div>
      </div>

      {/* Main Records Table */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-mono font-bold tracking-wider">
              <tr>
                <th className="px-5 py-3.5">Customer Name</th>
                <th className="px-5 py-3.5">Account #</th>
                <th className="px-5 py-3.5">Registration Date</th>
                <th className="px-5 py-3.5">Qualifying Deposits</th>
                <th className="px-5 py-3.5">Progress</th>
                <th className="px-5 py-3.5">Reward Status</th>
                <th className="px-5 py-3.5">Payment Date</th>
                <th className="px-5 py-3.5">Transaction Reference</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && rewards.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <RefreshCw className="w-6 h-6 animate-spin text-amber-500" />
                      <span className="font-bold text-xs">Loading authoritative reward records...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredRewards.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-1">
                      <Gift className="w-8 h-8 text-slate-300" />
                      <span className="font-bold text-xs text-slate-600">No matching customer reward records found</span>
                      <span className="text-[11px] text-slate-400">Try adjusting your search query or filter.</span>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredRewards.map((r) => {
                  const isPaid = r.status === 'PAID';
                  const isQualified = r.status === 'QUALIFIED';
                  const remaining = r.remainingAmount ?? Math.max(0, 10000 - r.qualifyingDeposits);

                  return (
                    <tr key={r.userId} className="hover:bg-slate-50/80 transition-colors">
                      {/* Customer Name */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-xl bg-slate-900 text-amber-400 flex items-center justify-center font-bold text-xs shrink-0">
                            {(r.customerName?.[0] || 'U').toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <span className="font-extrabold text-slate-900 block truncate">
                              {r.customerName || 'Monvera Customer'}
                            </span>
                            <span className="text-[10px] font-mono text-slate-400 block truncate">
                              ID: {r.userId}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Account Number */}
                      <td className="px-5 py-4 font-mono font-bold text-slate-800 notranslate" translate="no">
                        {r.permanentAccountNumber || '••••'}
                      </td>

                      {/* Registration Date */}
                      <td className="px-5 py-4 text-slate-600 font-mono text-[11px]">
                        {r.registrationDate
                          ? new Date(r.registrationDate).toLocaleDateString()
                          : '—'}
                      </td>

                      {/* Qualifying Deposits */}
                      <td className="px-5 py-4">
                        <div className="font-mono font-black text-slate-900 notranslate" translate="no">
                          ${r.qualifyingDeposits.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </div>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {r.qualifyingDepositCount ?? 0} verified deposit{r.qualifyingDepositCount === 1 ? '' : 's'}
                        </span>
                      </td>

                      {/* Progress Bar & Percentage */}
                      <td className="px-5 py-4 min-w-[130px]">
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[11px] font-mono font-bold">
                            <span className="text-slate-600">{r.progressPercentage ?? 0}%</span>
                            <span className="text-[10px] text-slate-400">
                              {remaining > 0 ? `$${remaining.toLocaleString()} left` : 'Met'}
                            </span>
                          </div>
                          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                            <div
                              className={`h-full rounded-full ${
                                isPaid
                                  ? 'bg-emerald-500'
                                  : 'bg-amber-400'
                              }`}
                              style={{ width: `${Math.max(4, Math.min(100, r.progressPercentage ?? 0))}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      {/* Reward Status */}
                      <td className="px-5 py-4">
                        {isPaid ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-300">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            <span>Paid ($1,000)</span>
                          </span>
                        ) : isQualified ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-black uppercase tracking-wider bg-blue-100 text-blue-800 border border-blue-300">
                            <Sparkles className="w-3 h-3 text-blue-600" />
                            <span>Qualified</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-black uppercase tracking-wider bg-amber-100 text-amber-900 border border-amber-300">
                            <Clock className="w-3 h-3 text-amber-700" />
                            <span>In Progress</span>
                          </span>
                        )}
                        {r.failureReason && (
                          <div className="text-[10px] text-rose-600 font-semibold mt-1 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" />
                            <span>{r.failureReason}</span>
                          </div>
                        )}
                      </td>

                      {/* Payment Date */}
                      <td className="px-5 py-4 text-slate-600 font-mono text-[11px]">
                        {r.paidAt ? (
                          <div>
                            <span className="font-bold text-slate-800 block">
                              {new Date(r.paidAt).toLocaleDateString()}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {new Date(r.paidAt).toLocaleTimeString()}
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      {/* Transaction Reference */}
                      <td className="px-5 py-4 font-mono text-[11px]">
                        {r.transactionReference ? (
                          <div className="flex items-center gap-1 text-slate-800 font-bold">
                            <span className="truncate max-w-[140px]" title={r.transactionReference}>
                              {r.transactionReference}
                            </span>
                            <button
                              onClick={() => handleCopy(r.transactionReference!)}
                              className="p-1 hover:bg-slate-200 rounded cursor-pointer transition-colors"
                              title="Copy Reference"
                            >
                              {copiedRef === r.transactionReference ? (
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                              ) : (
                                <Copy className="w-3.5 h-3.5 text-slate-500" />
                              )}
                            </button>
                          </div>
                        ) : (
                          <span className="text-slate-400 font-normal">Pending qualification</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer Note */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 text-xs text-slate-500 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>
              <strong>Durable Ledger Protection:</strong> The $1,000 Welcome Reward is automatically credited upon verified deposit settlement. Manual balance overrides are strictly restricted to preserve ledger integrity.
            </span>
          </div>
          <span className="text-[11px] font-mono text-slate-400 shrink-0">
            Total records: {filteredRewards.length}
          </span>
        </div>
      </div>
    </div>
  );
};
