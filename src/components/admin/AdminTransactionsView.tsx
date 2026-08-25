import React, { useState } from 'react';
import { Transaction, TransactionStatus, TransactionType } from '../../types';
import {
  Search,
  Filter,
  Download,
  ArrowDownLeft,
  ArrowUpRight,
  RefreshCw,
  Clock,
  CheckCircle2,
  AlertCircle,
  CreditCard,
  Building,
  DollarSign,
  ChevronRight,
  ShieldAlert,
} from 'lucide-react';
import { AdminConfirmationModal } from './AdminConfirmationModal';

interface AdminTransactionsViewProps {
  transactions: Transaction[];
  onUpdateStatus: (txId: string, status: TransactionStatus, reason: string) => Promise<void>;
  onRefreshData?: () => Promise<void>;
}

export const AdminTransactionsView: React.FC<AdminTransactionsViewProps> = ({
  transactions,
  onUpdateStatus,
  onRefreshData,
}) => {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [dateFilter, setDateFilter] = useState<'ALL' | 'TODAY' | '7D' | '30D'>('ALL');
  const [minAmount, setMinAmount] = useState<string>('');
  const [maxAmount, setMaxAmount] = useState<string>('');

  // Confirmation modal state
  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    variant: 'danger' | 'warning' | 'primary';
    targetName: string;
    action: (reason: string) => Promise<void>;
  }>({
    isOpen: false,
    title: '',
    description: '',
    confirmLabel: '',
    variant: 'primary',
    targetName: '',
    action: async () => {},
  });

  const filteredTransactions = transactions.filter((tx) => {
    const term = search.toLowerCase();
    const matchesSearch =
      tx.referenceNumber.toLowerCase().includes(term) ||
      tx.description.toLowerCase().includes(term) ||
      (tx.senderName && tx.senderName.toLowerCase().includes(term)) ||
      (tx.recipientName && tx.recipientName.toLowerCase().includes(term)) ||
      (tx.senderAccountNumber && tx.senderAccountNumber.includes(term)) ||
      (tx.recipientAccountNumber && tx.recipientAccountNumber.includes(term));

    const matchesType = typeFilter === 'ALL' || tx.type === typeFilter;
    const matchesStatus = statusFilter === 'ALL' || tx.status === statusFilter;

    // Date filtering
    let matchesDate = true;
    if (dateFilter !== 'ALL') {
      const txTime = new Date(tx.createdAt).getTime();
      const now = Date.now();
      if (dateFilter === 'TODAY') {
        matchesDate = now - txTime <= 24 * 3600 * 1000;
      } else if (dateFilter === '7D') {
        matchesDate = now - txTime <= 7 * 24 * 3600 * 1000;
      } else if (dateFilter === '30D') {
        matchesDate = now - txTime <= 30 * 24 * 3600 * 1000;
      }
    }

    // Amount range
    let matchesMin = true;
    if (minAmount && !isNaN(Number(minAmount))) {
      matchesMin = tx.amount >= Number(minAmount);
    }
    let matchesMax = true;
    if (maxAmount && !isNaN(Number(maxAmount))) {
      matchesMax = tx.amount <= Number(maxAmount);
    }

    return matchesSearch && matchesType && matchesStatus && matchesDate && matchesMin && matchesMax;
  });

  const exportCsv = () => {
    const headers = ['Reference', 'Date', 'Type', 'Amount', 'Currency', 'Status', 'Description', 'Sender', 'Recipient'];
    const rows = filteredTransactions.map((t) => [
      t.referenceNumber,
      new Date(t.createdAt).toISOString(),
      t.type,
      t.amount,
      t.currency || 'USD',
      t.status,
      `"${t.description.replace(/"/g, '""')}"`,
      `"${(t.senderName || t.senderUserId || '').replace(/"/g, '""')}"`,
      `"${(t.recipientName || t.recipientUserId || '').replace(/"/g, '""')}"`,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `monvera_ledger_export_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Master Transaction Ledger</h2>
          <p className="text-xs text-slate-500">
            Double-entry ledger audit trail, transaction clearance, and settlement state management
          </p>
        </div>

        <button
          onClick={exportCsv}
          className="px-4 py-2 rounded-xl bg-slate-900 text-white hover:bg-slate-800 text-xs font-bold transition-colors flex items-center gap-2 shadow-xs"
        >
          <Download className="w-4 h-4" /> Export CSV Ledger
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {/* Search Input */}
          <div className="md:col-span-2 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search reference, description, sender, or recipient..."
              className="w-full pl-10 pr-4 py-2 text-xs rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-slate-900/10 focus:border-slate-800 text-slate-900 placeholder:text-slate-400"
            />
          </div>

          {/* Type Filter */}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="text-xs px-3 py-2 rounded-xl border border-slate-200 focus:outline-hidden text-slate-900 bg-white font-medium"
          >
            <option value="ALL">All Types</option>
            <option value="DEPOSIT">Deposits</option>
            <option value="WITHDRAWAL">Withdrawals</option>
            <option value="TRANSFER">Transfers</option>
            <option value="INVESTMENT">Investments</option>
            <option value="CARD_PURCHASE">Card Purchases</option>
            <option value="ADMIN_DEVELOPMENT_FUNDING">Dev Liquidity Funding</option>
          </select>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-xs px-3 py-2 rounded-xl border border-slate-200 focus:outline-hidden text-slate-900 bg-white font-medium"
          >
            <option value="ALL">All Statuses</option>
            <option value="COMPLETED">Completed</option>
            <option value="PENDING">Pending</option>
            <option value="FAILED">Failed</option>
            <option value="REVERSED">Reversed</option>
          </select>
        </div>

        {/* Secondary Filter Row */}
        <div className="flex items-center justify-between gap-4 flex-wrap pt-2 border-t border-slate-100 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-400 font-medium">Time Window:</span>
            {(['ALL', 'TODAY', '7D', '30D'] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDateFilter(d)}
                className={`px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                  dateFilter === d ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:text-slate-900'
                }`}
              >
                {d === 'ALL' ? 'All Time' : d === 'TODAY' ? 'Today' : d === '7D' ? 'Last 7 Days' : 'Last 30 Days'}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-slate-400 font-medium">Amount:</span>
            <input
              type="number"
              placeholder="Min $"
              value={minAmount}
              onChange={(e) => setMinAmount(e.target.value)}
              className="w-20 px-2 py-1 text-xs border border-slate-200 rounded-lg"
            />
            <span className="text-slate-400">–</span>
            <input
              type="number"
              placeholder="Max $"
              value={maxAmount}
              onChange={(e) => setMaxAmount(e.target.value)}
              className="w-20 px-2 py-1 text-xs border border-slate-200 rounded-lg"
            />
          </div>
        </div>
      </div>

      {/* Transactions Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="p-4 font-semibold">Date & Timestamp</th>
                <th className="p-4 font-semibold">Reference ID</th>
                <th className="p-4 font-semibold">Type</th>
                <th className="p-4 font-semibold">Counterparties / Description</th>
                <th className="p-4 font-semibold text-right">Ledger Amount</th>
                <th className="p-4 font-semibold text-center">Status</th>
                <th className="p-4 font-semibold text-right">Admin Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-12 text-center text-slate-400">
                    No transactions match your search and filter parameters.
                  </td>
                </tr>
              ) : (
                filteredTransactions.map((tx) => {
                  const isDeposit = tx.type === 'DEPOSIT' || tx.type === 'ADMIN_DEVELOPMENT_FUNDING';
                  const isWithdrawal = tx.type === 'WITHDRAWAL';
                  const isTransfer = tx.type === 'TRANSFER';

                  return (
                    <tr key={tx.id} className="hover:bg-slate-50/80 transition-colors">
                      {/* Timestamp */}
                      <td className="p-4 text-slate-500 whitespace-nowrap">
                        <div className="font-medium text-slate-800">
                          {new Date(tx.createdAt).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </div>
                        <div className="text-[11px] font-mono text-slate-400">
                          {new Date(tx.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                      </td>

                      {/* Reference */}
                      <td className="p-4 font-mono font-bold text-slate-900 whitespace-nowrap">
                        {tx.referenceNumber}
                      </td>

                      {/* Type Badge */}
                      <td className="p-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                            isDeposit
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : isWithdrawal
                              ? 'bg-slate-100 text-slate-700 border-slate-200'
                              : isTransfer
                              ? 'bg-purple-50 text-purple-700 border-purple-200'
                              : 'bg-blue-50 text-blue-700 border-blue-200'
                          }`}
                        >
                          {tx.type.replace(/_/g, ' ')}
                        </span>
                      </td>

                      {/* Counterparty & Description */}
                      <td className="p-4 max-w-sm">
                        <div className="font-semibold text-slate-900 truncate">{tx.description}</div>
                        {(tx.senderName || tx.recipientName) && (
                          <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                            {tx.senderName && <span>From: <strong className="text-slate-700">{tx.senderName}</strong></span>}
                            {tx.senderName && tx.recipientName && <span> → </span>}
                            {tx.recipientName && <span>To: <strong className="text-slate-700">{tx.recipientName}</strong></span>}
                          </div>
                        )}
                      </td>

                      {/* Amount */}
                      <td
                        className={`p-4 text-right font-mono font-bold whitespace-nowrap text-sm ${
                          isDeposit ? 'text-emerald-600' : 'text-slate-900'
                        }`}
                      >
                        {isDeposit ? '+' : '-'}${tx.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>

                      {/* Status Badge */}
                      <td className="p-4 text-center">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                            tx.status === 'COMPLETED'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : tx.status === 'PENDING'
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : tx.status === 'REVERSED'
                              ? 'bg-purple-50 text-purple-700 border-purple-200'
                              : 'bg-rose-50 text-rose-700 border-rose-200'
                          }`}
                        >
                          {tx.status}
                        </span>
                      </td>

                      {/* Admin Actions */}
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {tx.status === 'PENDING' && (
                            <button
                              onClick={() => {
                                setConfirmConfig({
                                  isOpen: true,
                                  title: 'Complete Pending Transaction',
                                  description: `You are authorizing settlement for transaction ${tx.referenceNumber} ($${tx.amount.toLocaleString()}).`,
                                  confirmLabel: 'Authorize Settlement',
                                  variant: 'primary',
                                  targetName: `${tx.referenceNumber} - $${tx.amount.toLocaleString()}`,
                                  action: async (reason) => {
                                    await onUpdateStatus(tx.id, 'COMPLETED', reason);
                                    if (onRefreshData) await onRefreshData();
                                  },
                                });
                              }}
                              className="px-2.5 py-1 text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors"
                            >
                              Approve
                            </button>
                          )}

                          {tx.status === 'COMPLETED' && (
                            <button
                              onClick={() => {
                                setConfirmConfig({
                                  isOpen: true,
                                  title: 'Reverse Completed Transaction',
                                  description: `You are initiating an administrative reversal for transaction ${tx.referenceNumber} ($${tx.amount.toLocaleString()}).`,
                                  confirmLabel: 'Execute Reversal',
                                  variant: 'danger',
                                  targetName: `${tx.referenceNumber} - $${tx.amount.toLocaleString()}`,
                                  action: async (reason) => {
                                    await onUpdateStatus(tx.id, 'REVERSED', reason);
                                    if (onRefreshData) await onRefreshData();
                                  },
                                });
                              }}
                              className="px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors border border-slate-200"
                            >
                              Reverse
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
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
        targetEntityName={confirmConfig.targetName}
      />
    </div>
  );
};
