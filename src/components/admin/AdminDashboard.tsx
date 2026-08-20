import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import {
  UserProfile,
  Transaction,
  AdminAuditLog,
  AdminSystemOverview,
} from '../../types';
import confetti from 'canvas-confetti';
import {
  Shield,
  Coins,
  Users,
  Layers,
  Activity,
  ArrowRight,
  Plus,
  Lock,
  Unlock,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Search,
  Zap,
  Building,
} from 'lucide-react';

export const AdminDashboard: React.FC = () => {
  const { currentUser, refreshBalance, refreshNotifications } = useAuth();
  
  const [metrics, setMetrics] = useState<AdminSystemOverview | null>(null);
  const [customers, setCustomers] = useState<(UserProfile & { balanceMetrics?: any })[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);

  // Funding tool state
  const [targetUserId, setTargetUserId] = useState<string>('usr_eleanor');
  const [fundAmount, setFundAmount] = useState<string>('50000');
  const [fundReason, setFundReason] = useState<string>('Development and Test Liquidity Provision');
  const [isFunding, setIsFunding] = useState<boolean>(false);
  const [fundFeedback, setFundFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Pool top-up state
  const [topUpAmount, setTopUpAmount] = useState<string>('500000000');
  const [isToppingUp, setIsToppingUp] = useState<boolean>(false);

  // User search
  const [userSearch, setUserSearch] = useState<string>('');

  useEffect(() => {
    loadAllAdminData();
  }, []);

  const loadAllAdminData = async () => {
    try {
      const [overviewRes, custRes, txRes, logsRes] = await Promise.all([
        api.getAdminOverview(),
        api.getAdminCustomers(),
        api.getTransactions(),
        api.getAdminAuditLogs(),
      ]);

      if (overviewRes) setMetrics(overviewRes);
      if (custRes.customers) {
        setCustomers(custRes.customers);
        if (custRes.customers.length > 0 && !targetUserId) {
          setTargetUserId(custRes.customers[0].id);
        }
      }
      if (txRes.transactions) setTransactions(txRes.transactions);
      if (logsRes.auditLogs) setAuditLogs(logsRes.auditLogs);
    } catch (err) {
      console.error(err);
    }
  };

  const handleIssueFunding = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(fundAmount);
    if (isNaN(amount) || amount <= 0) {
      setFundFeedback({ type: 'error', text: 'Please enter a valid funding amount.' });
      return;
    }

    setIsFunding(true);
    setFundFeedback(null);

    try {
      const res = await api.issueAdminDevFunding({
        adminId: currentUser?.id || 'usr_admin',
        targetUserId,
        amount,
        reason: fundReason,
      });

      if (res.success) {
        setFundFeedback({
          type: 'success',
          text: `Issued $${amount.toLocaleString()} in Dev Liquidity. Target user checking balance credited and ledger double-entry recorded.`,
        });
        await loadAllAdminData();
        await refreshBalance();
        await refreshNotifications();
        confetti({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#f59e0b', '#10b981', '#0f172a'],
        });
      } else {
        setFundFeedback({ type: 'error', text: res.error || 'Failed to issue funding.' });
      }
    } catch (err) {
      setFundFeedback({ type: 'error', text: 'Error executing admin funding ledger operation.' });
    } finally {
      setIsFunding(false);
    }
  };

  const handleTopUpPool = async () => {
    setIsToppingUp(true);
    try {
      const res = await api.topUpDevFundingPool({
        adminId: currentUser?.id || 'usr_admin',
        amount: parseFloat(topUpAmount),
        reason: 'Authorized Reserve Capital Injection',
      });
      if (res.success) {
        await loadAllAdminData();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsToppingUp(false);
    }
  };

  const handleToggleFreezeUser = async (userId: string) => {
    try {
      const res = await api.toggleCustomerStatus(userId, {
        adminId: currentUser?.id,
        reason: 'Administrative compliance audit',
      });
      if (res.success) {
        await loadAllAdminData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const filteredUsers = customers.filter((u) =>
    `${u.firstName} ${u.lastName} ${u.email} ${u.permanentAccountNumber}`
      .toLowerCase()
      .includes(userSearch.toLowerCase())
  );

  return (
    <div id="admin-governance-dashboard" className="space-y-8 animate-in fade-in duration-150">
      
      {/* Admin Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 rounded-3xl bg-slate-900 text-white shadow-xl border border-slate-800">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center font-bold">
            <Shield className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-white">Private Administration & Ledger Sentinel</h2>
              <span className="text-[10px] font-mono font-bold uppercase bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded border border-amber-500/30">
                Restricted Clearance
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Authoritative management console for double-entry ledger oversight, customer governance, and testing liquidity.
            </p>
          </div>
        </div>

        <button
          onClick={loadAllAdminData}
          className="self-start sm:self-center px-4 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors flex items-center gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh Metrics</span>
        </button>
      </div>

      {/* --- SYSTEM METRICS OVERVIEW --- */}
      {metrics && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-2xs space-y-1">
            <span className="text-[11px] text-slate-400 font-mono uppercase block">Total Customers</span>
            <div className="text-2xl font-extrabold font-mono text-slate-900">{metrics.totalCustomers}</div>
            <span className="text-[10px] text-emerald-600 font-semibold block">100% KYC Verified</span>
          </div>

          <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-2xs space-y-1">
            <span className="text-[11px] text-slate-400 font-mono uppercase block">Total System Deposits</span>
            <div className="text-2xl font-extrabold font-mono text-emerald-600">
              ${(metrics.totalPlatformDeposits || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </div>
            <span className="text-[10px] text-slate-500 font-mono block">Inbound Settled</span>
          </div>

          <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-2xs space-y-1">
            <span className="text-[11px] text-slate-400 font-mono uppercase block">Active Investments</span>
            <div className="text-2xl font-extrabold font-mono text-slate-900">
              ${(metrics.totalPlatformInvestments || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </div>
            <span className="text-[10px] text-slate-500 font-mono block">60-360D Sovereign Contracts</span>
          </div>

          <div className="p-5 rounded-2xl bg-slate-900 text-white border border-slate-800 shadow-2xs space-y-1">
            <span className="text-[11px] text-amber-400 font-mono uppercase block">Dev Liquidity Pool</span>
            <div className="text-2xl font-extrabold font-mono text-amber-300">
              ${(metrics.devFundingPoolBalance || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </div>
            <span className="text-[10px] text-slate-400 font-mono block">Isolated Testing Reserve</span>
          </div>
        </div>
      )}

      {/* --- ADMIN DEVELOPMENT FUNDING SYSTEM --- */}
      <div className="p-6 sm:p-8 rounded-3xl bg-white border border-amber-200/80 shadow-md space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center font-bold">
              <Coins className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">Admin Development Funding System</h3>
              <p className="text-xs text-slate-500">
                Grant test capital from the $1B Development Liquidity Pool directly into any customer's checking account with full ledger tracking.
              </p>
            </div>
          </div>

          <button
            onClick={handleTopUpPool}
            disabled={isToppingUp}
            className="px-3.5 py-2 text-xs font-bold text-amber-900 bg-amber-100 hover:bg-amber-200 rounded-xl border border-amber-300 transition-colors"
          >
            {isToppingUp ? 'Topping up...' : '+ Top Up Dev Pool (+$500M)'}
          </button>
        </div>

        {fundFeedback && (
          <div
            className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 ${
              fundFeedback.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-red-50 border-red-200 text-red-700'
            }`}
          >
            {fundFeedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5 text-emerald-600" />
            ) : (
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-600" />
            )}
            <span>{fundFeedback.text}</span>
          </div>
        )}

        <form onSubmit={handleIssueFunding} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            
            {/* Target User */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                Recipient Customer
              </label>
              <select
                value={targetUserId}
                onChange={(e) => setTargetUserId(e.target.value)}
                className="w-full px-3.5 py-2.5 text-xs font-semibold rounded-xl border border-slate-300 bg-white"
              >
                {customers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.firstName} {u.lastName} ({u.permanentAccountNumber})
                  </option>
                ))}
              </select>
            </div>

            {/* Amount */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                Funding Amount (USD)
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-2.5 text-xs font-bold text-slate-400 font-mono">$</span>
                <input
                  type="number"
                  step="1000"
                  min="1"
                  required
                  value={fundAmount}
                  onChange={(e) => setFundAmount(e.target.value)}
                  className="w-full pl-7 pr-4 py-2 text-sm font-bold font-mono rounded-xl border border-slate-300 bg-white"
                />
              </div>
            </div>

            {/* Reason */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                Audit Reason
              </label>
              <input
                type="text"
                required
                value={fundReason}
                onChange={(e) => setFundReason(e.target.value)}
                className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-300 bg-white"
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={isFunding}
              className="py-3 px-6 rounded-xl font-bold text-xs text-white bg-slate-900 hover:bg-slate-800 transition-colors shadow-md flex items-center gap-2 disabled:opacity-50"
            >
              <span>{isFunding ? 'Executing Ledger Settle...' : 'Issue Development Testing Capital'}</span>
              <ArrowRight className="w-3.5 h-3.5 text-emerald-400" />
            </button>
          </div>
        </form>
      </div>

      {/* --- CUSTOMER GOVERNANCE TABLE --- */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h3 className="text-lg font-bold text-slate-900">Customer Governance ({customers.length})</h3>
          
          <div className="relative w-full sm:w-72">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search customers..."
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-300 bg-white"
            />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-2xs">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px]">
              <tr>
                <th className="p-3.5">Customer</th>
                <th className="p-3.5">Permanent Account</th>
                <th className="p-3.5">Tier</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              {filteredUsers.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="p-3.5 font-sans">
                    <div className="font-bold text-slate-900">{u.firstName} {u.lastName}</div>
                    <div className="text-[10px] text-slate-500">{u.email}</div>
                  </td>
                  <td className="p-3.5 text-slate-700">{u.permanentAccountNumber}</td>
                  <td className="p-3.5 text-emerald-700 font-sans font-bold">{u.membershipTier}</td>
                  <td className="p-3.5 font-sans">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        u.status === 'active'
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          : 'bg-red-50 text-red-800 border border-red-200'
                      }`}
                    >
                      {u.status}
                    </span>
                  </td>
                  <td className="p-3.5 text-right font-sans">
                    <button
                      onClick={() => handleToggleFreezeUser(u.id)}
                      className={`px-3 py-1 text-xs font-bold rounded-lg transition-colors ${
                        u.status === 'active'
                          ? 'bg-red-50 hover:bg-red-100 text-red-700'
                          : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      {u.status === 'active' ? 'Freeze' : 'Unfreeze'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* --- IMMUTABLE AUDIT LOG --- */}
      <div className="space-y-4">
        <h3 className="text-lg font-bold text-slate-900">System Audit Trail</h3>
        <div className="bg-slate-950 rounded-2xl p-4 font-mono text-xs text-slate-300 max-h-60 overflow-y-auto space-y-1.5 border border-slate-800">
          {auditLogs.map((log) => (
            <div key={log.id} className="flex items-center justify-between text-[11px] py-1 border-b border-slate-900">
              <span className="text-emerald-400">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
              <span className="text-slate-200 font-bold">{log.action}</span>
              <span className="text-slate-400 truncate max-w-xs">{log.reason}</span>
              <span className="text-amber-400">Admin: {log.adminName}</span>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
};
