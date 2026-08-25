import React, { useState } from 'react';
import { Transaction, TransactionStatus } from '../../types';
import {
  ArrowUpRight,
  Search,
  Building,
  CreditCard,
  Coins,
  CheckCircle2,
  Clock,
  AlertCircle,
  XCircle,
  ShieldAlert,
} from 'lucide-react';
import { AdminConfirmationModal } from './AdminConfirmationModal';

interface AdminWithdrawalsViewProps {
  transactions: Transaction[];
  onUpdateStatus: (txId: string, status: TransactionStatus, reason: string) => Promise<void>;
  onRefreshData?: () => Promise<void>;
}

export const AdminWithdrawalsView: React.FC<AdminWithdrawalsViewProps> = ({
  transactions,
  onUpdateStatus,
  onRefreshData,
}) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

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

  const withdrawals = transactions.filter(
    (t) => t.type === 'WITHDRAWAL' || t.category === 'Withdrawals'
  );

  const totalVolume = withdrawals.reduce(
    (acc, t) => acc + (t.status === 'COMPLETED' ? t.amount : 0),
    0
  );

  const filteredWithdrawals = withdrawals.filter((wth) => {
    const term = search.toLowerCase();
    const matchesSearch =
      wth.referenceNumber.toLowerCase().includes(term) ||
      wth.description.toLowerCase().includes(term) ||
      (wth.senderName && wth.senderName.toLowerCase().includes(term));

    const matchesStatus = statusFilter === 'ALL' || wth.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Outbound Withdrawal Settlement Queue</h2>
          <p className="text-xs text-slate-500">
            Adjudicate, process, and settle outbound client disbursements across ACH, FedWire, and Web3
          </p>
        </div>

        <div className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs text-right shadow-xs">
          <div className="text-slate-400 font-medium">Settled Outflows</div>
          <div className="text-base font-bold text-amber-400 font-mono">
            ${totalVolume.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search withdrawal reference, customer, or destination..."
            className="w-full pl-10 pr-4 py-2 text-xs rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-slate-900/10 focus:border-slate-800 text-slate-900 placeholder:text-slate-400"
          />
        </div>

        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-xs px-3 py-2 rounded-xl border border-slate-200 focus:outline-hidden text-slate-900 bg-white font-medium"
          >
            <option value="ALL">All Statuses</option>
            <option value="COMPLETED">Completed / Settled</option>
            <option value="PENDING">Pending Settlement</option>
            <option value="FAILED">Failed / Rejected</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>
      </div>

      {/* Withdrawals Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="p-4 font-semibold">Timestamp</th>
                <th className="p-4 font-semibold">Reference ID</th>
                <th className="p-4 font-semibold">Beneficiary & Destination Account</th>
                <th className="p-4 font-semibold text-right">Disbursement Amount</th>
                <th className="p-4 font-semibold text-center">Settlement Status</th>
                <th className="p-4 font-semibold text-right">Administrative Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredWithdrawals.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-12 text-center text-slate-400">
                    No withdrawal requests match your search and filter criteria.
                  </td>
                </tr>
              ) : (
                filteredWithdrawals.map((wth) => {
                  const isPending = wth.status === 'PENDING';
                  const isCompleted = wth.status === 'COMPLETED';

                  return (
                    <tr key={wth.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-4 text-slate-500 whitespace-nowrap">
                        <div className="font-medium text-slate-800">
                          {new Date(wth.createdAt).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </div>
                        <div className="text-[11px] font-mono text-slate-400">
                          {new Date(wth.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                      </td>

                      <td className="p-4 font-mono font-bold text-slate-900 whitespace-nowrap">
                        {wth.referenceNumber}
                      </td>

                      <td className="p-4 max-w-sm">
                        <div className="font-semibold text-slate-900">{wth.description}</div>
                        {wth.metadata && (
                          <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                            Dest: {wth.metadata.destinationLabel || 'External Account'} • {wth.metadata.accountOrIbanMasked || '••••'}
                          </div>
                        )}
                      </td>

                      <td className="p-4 text-right font-mono font-bold text-slate-900 text-sm whitespace-nowrap">
                        -${wth.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>

                      <td className="p-4 text-center">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                            isCompleted
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : isPending
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : 'bg-rose-50 text-rose-700 border-rose-200'
                          }`}
                        >
                          {isCompleted ? <CheckCircle2 className="w-3 h-3 text-emerald-600" /> : <Clock className="w-3 h-3 text-amber-600" />}
                          {wth.status}
                        </span>
                      </td>

                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {isPending && (
                            <>
                              <button
                                onClick={() => {
                                  setConfirmConfig({
                                    isOpen: true,
                                    title: 'Approve & Settle Outbound Withdrawal',
                                    description: `Confirm outbound settlement of $${wth.amount.toLocaleString()} for reference ${wth.referenceNumber}.`,
                                    confirmLabel: 'Confirm Settlement',
                                    variant: 'primary',
                                    targetName: `${wth.referenceNumber} ($${wth.amount.toLocaleString()})`,
                                    action: async (reason) => {
                                      await onUpdateStatus(wth.id, 'COMPLETED', reason);
                                      if (onRefreshData) await onRefreshData();
                                    },
                                  });
                                }}
                                className="px-2.5 py-1 text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors"
                              >
                                Settle
                              </button>

                              <button
                                onClick={() => {
                                  setConfirmConfig({
                                    isOpen: true,
                                    title: 'Cancel / Reject Outbound Withdrawal',
                                    description: `Reject withdrawal ${wth.referenceNumber} ($${wth.amount.toLocaleString()}). Funds will remain in the client checking account.`,
                                    confirmLabel: 'Cancel Withdrawal',
                                    variant: 'danger',
                                    targetName: `${wth.referenceNumber} ($${wth.amount.toLocaleString()})`,
                                    action: async (reason) => {
                                      await onUpdateStatus(wth.id, 'CANCELLED', reason);
                                      if (onRefreshData) await onRefreshData();
                                    },
                                  });
                                }}
                                className="px-2.5 py-1 text-[11px] font-bold bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg transition-colors"
                              >
                                Reject
                              </button>
                            </>
                          )}

                          {isCompleted && (
                            <span className="text-[11px] text-emerald-600 font-semibold flex items-center gap-1 justify-end">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Dispatched
                            </span>
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
