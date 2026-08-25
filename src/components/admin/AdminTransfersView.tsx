import React, { useState } from 'react';
import { Transaction } from '../../types';
import {
  RefreshCw,
  Search,
  ArrowRight,
  CheckCircle2,
  Clock,
  User,
  Zap,
} from 'lucide-react';

interface AdminTransfersViewProps {
  transactions: Transaction[];
  onRefreshData?: () => Promise<void>;
}

export const AdminTransfersView: React.FC<AdminTransfersViewProps> = ({
  transactions,
  onRefreshData,
}) => {
  const [search, setSearch] = useState('');

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
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Monvera Peer-to-Peer Transfer Monitor</h2>
          <p className="text-xs text-slate-500">
            Real-time internal liquidity movements between verified Monvera accounts
          </p>
        </div>

        <div className="px-4 py-2 rounded-xl bg-purple-50 border border-purple-200 text-xs text-right">
          <div className="text-purple-600 font-medium">Internal Volume</div>
          <div className="text-base font-bold text-purple-900 font-mono">
            ${totalTransferVolume.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
        </div>
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
                      <div className="font-semibold text-slate-900">{tr.senderName || 'Authorized Sender'}</div>
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
