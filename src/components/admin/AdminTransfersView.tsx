import React, { useState } from 'react';
import { Transaction, UserProfile } from '../../types';
import {
  RefreshCw,
  Search,
  ArrowRight,
  CheckCircle2,
  Clock,
  User,
  Zap,
  ShieldCheck,
  Send,
  Building,
  AlertTriangle,
  Coins,
} from 'lucide-react';
import confetti from 'canvas-confetti';

interface AdminTransfersViewProps {
  transactions: Transaction[];
  customers?: (UserProfile & { balanceMetrics?: any })[];
  onAdminTransfer?: (params: {
    targetUserId: string;
    amount: number;
    description: string;
  }) => Promise<{ success: boolean; error?: string }>;
  onOpenSendMoney?: () => void;
  onRefreshData?: () => Promise<void>;
}

export const AdminTransfersView: React.FC<AdminTransfersViewProps> = ({
  transactions,
  customers = [],
  onAdminTransfer,
  onOpenSendMoney,
  onRefreshData,
}) => {
  const [search, setSearch] = useState('');
  
  // Admin Transfer Form State
  const [inputMode, setInputMode] = useState<'dropdown' | 'manual'>('manual');
  const [manualAccountInput, setManualAccountInput] = useState<string>('');
  const [targetUserId, setTargetUserId] = useState<string>(customers[0]?.id || '');
  const [amount, setAmount] = useState<string>('5000');
  const [description, setDescription] = useState<string>('Administrative Direct Transfer from Bennett Johnson');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Find effective target customer
  const selectedTargetCustomer = inputMode === 'dropdown'
    ? customers.find((c) => c.id === targetUserId)
    : customers.find((c) => {
        const cleanInput = manualAccountInput.trim().replace(/^@/, '').toLowerCase();
        const cleanAcc = manualAccountInput.trim().replace(/[-\s]/g, '');
        return (
          (c.permanentAccountNumber && c.permanentAccountNumber.replace(/[-\s]/g, '') === cleanAcc) ||
          (c.username && c.username.toLowerCase() === cleanInput) ||
          (c.email && c.email.toLowerCase() === cleanInput) ||
          (c.id === cleanInput)
        );
      });

  const handleExecuteAdminTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setFeedback({ type: 'error', text: 'Please enter a valid transfer amount greater than $0.00.' });
      return;
    }

    const effectiveTargetId = inputMode === 'dropdown'
      ? targetUserId
      : (selectedTargetCustomer?.id || manualAccountInput.trim());

    if (!effectiveTargetId) {
      setFeedback({ type: 'error', text: 'Please enter or select a valid recipient account number or customer.' });
      return;
    }

    if (!onAdminTransfer) {
      setFeedback({ type: 'error', text: 'Admin transfer service handler is not available.' });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);

    try {
      const res = await onAdminTransfer({
        targetUserId: effectiveTargetId,
        amount: numAmount,
        description: description || 'Administrative Direct Transfer from Bennett Johnson',
      });

      if (res.success) {
        setFeedback({
          type: 'success',
          text: `Successfully transferred $${numAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })} to ${selectedTargetCustomer?.firstName || 'Customer'} ${selectedTargetCustomer?.lastName || ''} from BENNETT JOHNSON. Double-entry ledger updated.`,
        });
        confetti({
          particleCount: 70,
          spread: 60,
          origin: { y: 0.6 },
          colors: ['#3b82f6', '#10b981', '#f59e0b'],
        });
        if (onRefreshData) await onRefreshData();
      } else {
        setFeedback({ type: 'error', text: res.error || 'Failed to complete administrative transfer.' });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Error processing administrative transfer.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const transfers = transactions.filter(
    (t) => t.type === 'TRANSFER' || t.category === 'Transfers'
  );

  const totalTransferVolume = transfers.reduce(
    (acc, t) => acc + (t.status === 'COMPLETED' ? t.amount : 0),
    0
  );

  const filteredTransfers = transfers.filter((tr) => {
    const term = search.toLowerCase();
    return (
      tr.referenceNumber.toLowerCase().includes(term) ||
      tr.description.toLowerCase().includes(term) ||
      (tr.senderName && tr.senderName.toLowerCase().includes(term)) ||
      (tr.recipientName && tr.recipientName.toLowerCase().includes(term)) ||
      (tr.senderAccountNumber && tr.senderAccountNumber.includes(term)) ||
      (tr.recipientAccountNumber && tr.recipientAccountNumber.includes(term))
    );
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Monvera Transfers & Administrative Clearance</h2>
          <p className="text-xs text-slate-500">
            Real-time internal liquidity movements & direct administrative transfers from Bennett Johnson
          </p>
        </div>

        <div className="px-4 py-2 rounded-xl bg-purple-50 border border-purple-200 text-xs text-right">
          <div className="text-purple-600 font-medium">Internal Volume</div>
          <div className="text-base font-bold text-purple-900 font-mono">
            ${totalTransferVolume.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
        </div>
      </div>

      {/* Bennett Johnson Administrator Transfer Control */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-slate-900 text-amber-400 shadow-xs">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900">Administrator Transfer Console</h3>
                <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-black tracking-wider uppercase border border-amber-200">
                  OFFICIAL ACCOUNT
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Send direct Monvera funds from <strong>BENNETT JOHNSON</strong> to any verified customer account
              </p>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs flex items-center gap-3">
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Originating Account</div>
              <div className="font-bold text-slate-900">BENNETT JOHNSON</div>
              <div className="text-[11px] font-mono text-slate-500">Acc: 1000000001 • NY Fed 021000021</div>
            </div>
          </div>
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

        <form onSubmit={handleExecuteAdminTransfer} className="space-y-4">
          {/* Target Customer Input Mode Selection */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setInputMode('manual')}
                className={`px-3 py-1.5 rounded-xl text-xs font-black transition-colors cursor-pointer border ${
                  inputMode === 'manual'
                    ? 'bg-slate-950 text-amber-400 border-slate-950 shadow-2xs'
                    : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
                }`}
              >
                Paste Account # or @Username
              </button>
              <button
                type="button"
                onClick={() => setInputMode('dropdown')}
                className={`px-3 py-1.5 rounded-xl text-xs font-black transition-colors cursor-pointer border ${
                  inputMode === 'dropdown'
                    ? 'bg-slate-950 text-amber-400 border-slate-950 shadow-2xs'
                    : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
                }`}
              >
                Select from Registered Accounts ({customers.length})
              </button>
            </div>

            {onOpenSendMoney && (
              <button
                type="button"
                onClick={onOpenSendMoney}
                className="text-xs font-black text-emerald-700 hover:text-emerald-900 flex items-center gap-1.5 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-xl border border-emerald-300 transition-colors cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Launch Full Send Modal</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Target Customer */}
            <div className="sm:col-span-1">
              <label className="block text-xs font-black text-slate-900 mb-1.5 uppercase tracking-wider font-mono">
                1. Recipient Customer Account
              </label>

              {inputMode === 'manual' ? (
                <div>
                  <input
                    type="text"
                    required
                    placeholder="Paste 10-digit account or @username"
                    value={manualAccountInput}
                    onChange={(e) => setManualAccountInput(e.target.value)}
                    className="w-full text-sm font-mono font-black tracking-wider text-slate-950 bg-white placeholder:text-slate-400 placeholder:font-sans placeholder:font-normal px-3.5 py-2.5 rounded-xl border-2 border-slate-300 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 shadow-xs"
                  />
                  {selectedTargetCustomer && (
                    <div className="mt-1.5 text-xs text-emerald-800 font-bold flex items-center gap-1.5 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>{selectedTargetCustomer.firstName} {selectedTargetCustomer.lastName} ({selectedTargetCustomer.permanentAccountNumber})</span>
                    </div>
                  )}
                </div>
              ) : (
                <select
                  value={targetUserId}
                  onChange={(e) => setTargetUserId(e.target.value)}
                  className="w-full text-xs px-3.5 py-2.5 rounded-xl border-2 border-slate-300 focus:border-emerald-600 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 text-slate-950 bg-white font-bold"
                >
                  {customers.length === 0 ? (
                    <option value="">No real registered customers</option>
                  ) : (
                    customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.firstName} {c.lastName} ({c.permanentAccountNumber ? `Acc: ${c.permanentAccountNumber}` : `@${c.username}`})
                      </option>
                    ))
                  )}
                </select>
              )}
            </div>

            {/* Transfer Amount */}
            <div className="sm:col-span-1">
              <label className="block text-xs font-black text-slate-900 mb-1.5 uppercase tracking-wider font-mono">
                2. Transfer Amount ($ USD)
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xs">$</span>
                <input
                  type="number"
                  min="1"
                  step="any"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="5000"
                  className="w-full text-sm pl-8 pr-4 py-2.5 rounded-xl border-2 border-slate-300 focus:border-emerald-600 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 text-slate-950 font-mono font-black bg-white shadow-xs"
                />
              </div>
            </div>

            {/* Memo / Description */}
            <div className="sm:col-span-1">
              <label className="block text-xs font-black text-slate-900 mb-1.5 uppercase tracking-wider font-mono">
                3. Transfer Memo / Note
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Administrative Direct Transfer from Bennett Johnson"
                className="w-full text-xs px-3.5 py-2.5 rounded-xl border-2 border-slate-300 focus:border-emerald-600 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 text-slate-950 bg-white font-medium shadow-xs"
              />
            </div>
          </div>

          {/* Quick preset amounts */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-[11px] font-semibold text-slate-400">Quick Amounts:</span>
            {['1000', '5000', '10000', '25000', '50000', '100000'].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setAmount(preset)}
                className={`px-2.5 py-1 rounded-lg text-xs font-mono font-semibold border transition-colors ${
                  amount === preset
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                ${Number(preset).toLocaleString()}
              </button>
            ))}
          </div>

          {/* Submit Action */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-100">
            <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>Recipient balance will be permanently credited with sender identified as <strong>Bennett Johnson</strong>.</span>
            </div>

            <button
              type="submit"
              disabled={isSubmitting || customers.length === 0}
              className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-bold transition-all shadow-sm flex items-center gap-2 cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Processing Transfer...</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5 text-amber-400" />
                  <span>Send Transfer as Bennett Johnson</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Instant Settlement Badge */}
      <div className="p-4 rounded-2xl bg-purple-900 text-white border border-purple-800 shadow-sm flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-purple-800 text-amber-300">
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-bold text-white">Monvera Instant Internal Routing Network</div>
            <div className="text-xs text-purple-200 mt-0.5">
              Zero-fee, sub-millisecond atomic ledger clearance between Monvera permanent account numbers.
            </div>
          </div>
        </div>

        <div className="hidden sm:block text-right text-xs">
          <span className="px-3 py-1 rounded-full bg-purple-800 text-purple-200 font-mono font-bold">
            Network Status: 100% Operational
          </span>
        </div>
      </div>

      {/* Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search transfer by reference, sender name, recipient, or account number..."
            className="w-full pl-10 pr-4 py-2 text-xs rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-slate-900/10 focus:border-slate-800 text-slate-900 placeholder:text-slate-400"
          />
        </div>
      </div>

      {/* Transfers Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="p-4 font-semibold">Timestamp</th>
                <th className="p-4 font-semibold">Reference ID</th>
                <th className="p-4 font-semibold">Sender Client</th>
                <th className="p-4 font-semibold text-center">Clearance Route</th>
                <th className="p-4 font-semibold">Recipient Client</th>
                <th className="p-4 font-semibold text-right">Transfer Amount</th>
                <th className="p-4 font-semibold text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredTransfers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-12 text-center text-slate-400">
                    No internal peer transfers match your query.
                  </td>
                </tr>
              ) : (
                filteredTransfers.map((tr) => (
                  <tr key={tr.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-4 text-slate-500 whitespace-nowrap">
                      <div className="font-medium text-slate-800">
                        {new Date(tr.createdAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </div>
                      <div className="text-[11px] font-mono text-slate-400">
                        {new Date(tr.createdAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </td>

                    <td className="p-4 font-mono font-bold text-slate-900 whitespace-nowrap">
                      {tr.referenceNumber}
                    </td>

                    <td className="p-4">
                      <div className="font-semibold text-slate-900">
                        {tr.senderName || 'Authorized Sender'}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        Acc: {tr.senderAccountNumber || '•••• 7391'}
                      </div>
                    </td>

                    <td className="p-4 text-center">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800">
                        Instant <ArrowRight className="w-3 h-3 text-purple-600" />
                      </span>
                    </td>

                    <td className="p-4">
                      <div className="font-semibold text-slate-900">{tr.recipientName || 'Authorized Recipient'}</div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        Acc: {tr.recipientAccountNumber || '•••• 8820'}
                      </div>
                    </td>

                    <td className="p-4 text-right font-mono font-bold text-slate-900 text-sm whitespace-nowrap">
                      ${tr.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>

                    <td className="p-4 text-center">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        Settled
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
