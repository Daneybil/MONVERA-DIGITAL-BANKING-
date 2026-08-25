import React, { useState } from 'react';
import { UserProfile, Transaction, AdminSystemOverview } from '../../types';
import {
  Coins,
  ShieldAlert,
  AlertTriangle,
  ArrowRight,
  Plus,
  RefreshCw,
  CheckCircle2,
  Lock,
  Layers,
  Building,
} from 'lucide-react';
import confetti from 'canvas-confetti';

interface AdminDemoFundsViewProps {
  metrics: AdminSystemOverview | null;
  customers: (UserProfile & { balanceMetrics?: any })[];
  transactions: Transaction[];
  onIssueFunding: (params: {
    targetUserId: string;
    amount: number;
    reason: string;
    targetAccountType: 'CHECKING' | 'SAVINGS';
  }) => Promise<{ success: boolean; error?: string }>;
  onTopUpPool: (amount: number) => Promise<{ success: boolean; error?: string }>;
  onRefreshData?: () => Promise<void>;
}

export const AdminDemoFundsView: React.FC<AdminDemoFundsViewProps> = ({
  metrics,
  customers,
  transactions,
  onIssueFunding,
  onTopUpPool,
  onRefreshData,
}) => {
  const [targetUserId, setTargetUserId] = useState<string>(customers[0]?.id || '');
  const [amount, setAmount] = useState<string>('50000');
  const [accountType, setAccountType] = useState<'CHECKING' | 'SAVINGS'>('CHECKING');
  const [reason, setReason] = useState<string>('Sandbox Development & Stage Simulation Liquidity');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [topUpAmount, setTopUpAmount] = useState<string>('500000000');
  const [isToppingUp, setIsToppingUp] = useState<boolean>(false);

  const devFundingTxs = transactions.filter(
    (t) => t.type === 'ADMIN_DEVELOPMENT_FUNDING'
  );

  const handleSubmitDisbursement = async (e: React.FormEvent) => {
    e.preventDefault();
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setFeedback({ type: 'error', text: 'Please enter a valid disbursement amount greater than $0.00.' });
      return;
    }

    if (!targetUserId) {
      setFeedback({ type: 'error', text: 'Please select a recipient test customer.' });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);

    try {
      const res = await onIssueFunding({
        targetUserId,
        amount: numAmount,
        reason,
        targetAccountType: accountType,
      });

      if (res.success) {
        setFeedback({
          type: 'success',
          text: `Successfully disbursed $${numAmount.toLocaleString()} in Sandbox Liquidity. Double-entry ledger updated.`,
        });
        confetti({
          particleCount: 70,
          spread: 60,
          origin: { y: 0.6 },
          colors: ['#f59e0b', '#10b981', '#0f172a'],
        });
        if (onRefreshData) await onRefreshData();
      } else {
        setFeedback({ type: 'error', text: res.error || 'Failed to disburse sandbox test funds.' });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Error executing sandbox ledger operation.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTopUp = async () => {
    const numAmount = parseFloat(topUpAmount);
    if (isNaN(numAmount) || numAmount <= 0) return;

    setIsToppingUp(true);
    try {
      const res = await onTopUpPool(numAmount);
      if (res.success) {
        if (onRefreshData) await onRefreshData();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsToppingUp(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Isolated Sandbox Test Liquidity Pool</h2>
          <p className="text-xs text-slate-500">
            Development & staging liquidity disbursements strictly partitioned from production financial reserves
          </p>
        </div>

        <div className="px-4 py-2 rounded-xl bg-amber-50 border border-amber-200 text-xs text-right">
          <div className="text-amber-800 font-medium">Sandbox Reserve Pool</div>
          <div className="text-base font-bold text-amber-900 font-mono">
            ${(metrics?.devFundingPoolBalance || 1000000000).toLocaleString('en-US')}
          </div>
        </div>
      </div>

      {/* Mandatory Isolation Disclaimer Banner */}
      <div className="p-5 rounded-2xl bg-amber-500/10 border-2 border-amber-500/30 text-slate-900 shadow-sm flex items-start gap-4">
        <div className="p-2.5 rounded-xl bg-amber-500 text-white shrink-0 shadow-xs">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <div className="text-xs leading-relaxed space-y-1.5 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-bold text-amber-900 text-sm uppercase tracking-wide">
              Isolated Test / Demo Liquidity Console
            </span>
            <span className="px-2 py-0.5 rounded-full bg-amber-200 text-amber-900 text-[10px] font-bold">
              NON-PRODUCTION
            </span>
          </div>
          <p className="text-slate-700">
            These funds are strictly designated for <strong>development, regression testing, and interface preview</strong>. Disbursements made here are tagged with <code>[TEST LIQUIDITY]</code> in double-entry audit ledgers and must never be represented as real-world customer fiat balances.
          </p>
        </div>
      </div>

      {/* Action Grid: Disburse Funds Form & Pool Management */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left 2 Cols: Form */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Issue Sandbox Test Liquidity</h3>
              <p className="text-xs text-slate-500">Inject test capital directly into a customer checking or savings account</p>
            </div>
            <span className="p-2 rounded-xl bg-slate-100 text-slate-700">
              <Coins className="w-5 h-5" />
            </span>
          </div>

          {feedback && (
            <div
              className={`p-4 rounded-xl text-xs flex items-center gap-2.5 ${
                feedback.type === 'success'
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border border-rose-200 text-rose-800'
              }`}
            >
              {feedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              )}
              <span>{feedback.text}</span>
            </div>
          )}

          <form onSubmit={handleSubmitDisbursement} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Target Customer */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wider">
                  Target Customer Account
                </label>
                <select
                  value={targetUserId}
                  onChange={(e) => setTargetUserId(e.target.value)}
                  className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-slate-900/10 text-slate-900 bg-white font-medium"
                >
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.firstName} {c.lastName} ({c.permanentAccountNumber})
                    </option>
                  ))}
                </select>
              </div>

              {/* Account Type */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wider">
                  Destination Account Type
                </label>
                <select
                  value={accountType}
                  onChange={(e) => setAccountType(e.target.value as any)}
                  className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-slate-900/10 text-slate-900 bg-white font-medium"
                >
                  <option value="CHECKING">Monvera Premier Checking</option>
                  <option value="SAVINGS">Monvera High-Yield Treasury</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Amount Input */}
              <div className="sm:col-span-1">
                <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wider">
                  Amount (USD)
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xs">$</span>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="50000"
                    className="w-full pl-8 pr-3 py-2.5 text-xs font-mono font-bold rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-slate-900/10 text-slate-900"
                  />
                </div>
              </div>

              {/* Reason Input */}
              <div className="sm:col-span-2">
                <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wider">
                  Compliance Audit Justification
                </label>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Development and testing sandbox liquidity allocation..."
                  className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-slate-900/10 text-slate-900 placeholder:text-slate-400"
                />
              </div>
            </div>

            {/* Quick Amount Buttons */}
            <div className="flex items-center gap-2 pt-1">
              <span className="text-[11px] text-slate-400 font-medium">Presets:</span>
              {['10000', '50000', '100000', '250000', '1000000'].map((preset) => (
                <button
                  type="button"
                  key={preset}
                  onClick={() => setAmount(preset)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-mono font-medium transition-colors ${
                    amount === preset
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  +${Number(preset).toLocaleString()}
                </button>
              ))}
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-end">
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-6 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs transition-colors shadow-sm shadow-amber-500/20 flex items-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-slate-950/40 border-t-slate-950 rounded-full animate-spin" />
                    Executing Ledger Entry...
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" /> Disburse Sandbox Liquidity
                  </>
                )}
              </button>
            </div>
          </form>
        </div>

        {/* Right 1 Col: Reserve Pool Status & Top-Up */}
        <div className="space-y-6">
          <div className="bg-slate-900 text-white rounded-2xl border border-slate-800 p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-amber-400">Sandbox Capital Pool</h4>
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            </div>

            <div>
              <div className="text-2xl font-bold font-mono text-white">
                ${(metrics?.devFundingPoolBalance || 1000000000).toLocaleString('en-US')}
              </div>
              <div className="text-xs text-slate-400 mt-1">Available Sandbox Allocation Reserve</div>
            </div>

            <div className="pt-4 border-t border-slate-800 space-y-3">
              <label className="block text-xs font-semibold text-slate-300">
                Replenish Sandbox Pool Reserve:
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={topUpAmount}
                  onChange={(e) => setTopUpAmount(e.target.value)}
                  className="flex-1 px-3 py-2 text-xs font-mono font-bold bg-slate-800 border border-slate-700 rounded-xl text-white focus:outline-hidden"
                />
                <button
                  type="button"
                  onClick={handleTopUp}
                  disabled={isToppingUp}
                  className="px-4 py-2 text-xs font-bold rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 transition-colors shrink-0"
                >
                  {isToppingUp ? 'Topping...' : '+ Replenish'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Sandbox Allocations Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Recent Sandbox Disbursements History</h3>
            <p className="text-xs text-slate-500">Immutable records of all test allocations</p>
          </div>
          <span className="text-xs font-mono text-slate-400">{devFundingTxs.length} records</span>
        </div>

        {devFundingTxs.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-xs">
            No sandbox test disbursements recorded yet.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {devFundingTxs.map((tx) => (
              <div key={tx.id} className="py-3 flex items-center justify-between gap-4 text-xs">
                <div>
                  <div className="font-semibold text-slate-900 flex items-center gap-2">
                    <span>{tx.description}</span>
                    <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">
                      TEST
                    </span>
                  </div>
                  <div className="text-slate-400 font-mono text-[11px] mt-0.5">
                    Ref: {tx.referenceNumber} • {new Date(tx.createdAt).toLocaleString()}
                  </div>
                </div>

                <div className="text-right">
                  <div className="font-mono font-bold text-emerald-600 text-sm">
                    +${tx.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </div>
                  <span className="text-[10px] font-semibold text-slate-500">Settled to Checking</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
