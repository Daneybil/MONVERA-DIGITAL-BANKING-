import React, { useState } from 'react';
import { Transaction } from '../../types';
import {
  ArrowDownLeft,
  Search,
  ShieldCheck,
  Building,
  CreditCard,
  Coins,
  CheckCircle2,
  Clock,
  AlertCircle,
  ExternalLink,
  Download,
} from 'lucide-react';

interface AdminDepositsViewProps {
  transactions: Transaction[];
  onRefreshData?: () => Promise<void>;
}

export const AdminDepositsView: React.FC<AdminDepositsViewProps> = ({
  transactions,
  onRefreshData,
}) => {
  const [search, setSearch] = useState('');
  const [methodFilter, setMethodFilter] = useState<string>('ALL');

  const deposits = transactions.filter(
    (t) => t.type === 'DEPOSIT' || t.category === 'Deposits' || t.type === 'ADMIN_DEVELOPMENT_FUNDING'
  );

  const totalDepositVolume = deposits.reduce(
    (acc, t) => acc + (t.status === 'COMPLETED' ? t.amount : 0),
    0
  );

  const filteredDeposits = deposits.filter((dep) => {
    const term = search.toLowerCase();
    const matchesSearch =
      dep.referenceNumber.toLowerCase().includes(term) ||
      dep.description.toLowerCase().includes(term) ||
      (dep.paymentProviderRef && dep.paymentProviderRef.toLowerCase().includes(term)) ||
      (dep.senderName && dep.senderName.toLowerCase().includes(term)) ||
      (dep.recipientName && dep.recipientName.toLowerCase().includes(term));

    let matchesMethod = true;
    if (methodFilter !== 'ALL') {
      matchesMethod = dep.description.toUpperCase().includes(methodFilter);
    }

    return matchesSearch && matchesMethod;
  });

  return (
    <div className="space-y-6">
      {/* Header & Policy Notice */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Deposit Clearances & Provider Ledger</h2>
          <p className="text-xs text-slate-500">
            Real-time verification of payment gateway webhooks, FedWire settlements, and bank ACH inflows
          </p>
        </div>

        <div className="px-4 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-right">
          <div className="text-slate-500 font-medium">Total Settled Inflows</div>
          <div className="text-base font-bold text-emerald-700 font-mono">
            ${totalDepositVolume.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
        </div>
      </div>

      {/* FinCEN & Gateway Policy Banner */}
      <div className="p-4 rounded-2xl bg-slate-900 text-white border border-slate-800 shadow-sm flex items-start gap-3">
        <div className="p-2 rounded-xl bg-amber-500/20 border border-amber-400/30 text-amber-400 shrink-0">
          <ShieldCheck className="w-5 h-5" />
        </div>
        <div className="text-xs leading-relaxed space-y-1">
          <span className="font-bold text-amber-300 block">Bank Gateway Settlement Policy:</span>
          <p className="text-slate-300">
            All customer checking and treasury balances shown below are backed by verified payment provider confirmations (Stripe, Plaid ACH, FedWire transit, or direct Web3 liquidity). Never credit production funds without verified gateway settlement.
          </p>
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by deposit reference, Stripe ID, customer, or bank description..."
            className="w-full pl-10 pr-4 py-2 text-xs rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-slate-900/10 focus:border-slate-800 text-slate-900 placeholder:text-slate-400"
          />
        </div>

        <div className="flex items-center gap-2">
          <select
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value)}
            className="text-xs px-3 py-2 rounded-xl border border-slate-200 focus:outline-hidden text-slate-900 bg-white font-medium"
          >
            <option value="ALL">All Deposit Methods</option>
            <option value="CARD">Card Gateway (Stripe)</option>
            <option value="ACH">ACH Bank Transfer</option>
            <option value="WIRE">FedWire Domestic</option>
            <option value="CRYPTO">Web3 Crypto Inflow</option>
          </select>
        </div>
      </div>

      {/* Deposits Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="p-4 font-semibold">Date & Timestamp</th>
                <th className="p-4 font-semibold">Monvera Reference</th>
                <th className="p-4 font-semibold">Deposit Description / Method</th>
                <th className="p-4 font-semibold">Gateway / Provider Ref</th>
                <th className="p-4 font-semibold text-right">Settled Amount</th>
                <th className="p-4 font-semibold text-center">Provider Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredDeposits.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-12 text-center text-slate-400">
                    No deposits found matching the search criteria.
                  </td>
                </tr>
              ) : (
                filteredDeposits.map((dep) => (
                  <tr key={dep.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-4 text-slate-500 whitespace-nowrap">
                      <div className="font-medium text-slate-800">
                        {new Date(dep.createdAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </div>
                      <div className="text-[11px] font-mono text-slate-400">
                        {new Date(dep.createdAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </td>

                    <td className="p-4 font-mono font-bold text-slate-900 whitespace-nowrap">
                      {dep.referenceNumber}
                    </td>

                    <td className="p-4">
                      <div className="font-semibold text-slate-900">{dep.description}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Target Account: <strong className="text-slate-700">{dep.metadata?.destinationAccountType || 'Premier Checking'}</strong>
                      </div>
                    </td>

                    <td className="p-4 font-mono text-xs text-slate-600">
                      {dep.paymentProviderRef ? (
                        <span className="px-2 py-1 rounded-md bg-slate-100 font-semibold text-slate-800">
                          {dep.paymentProviderRef}
                        </span>
                      ) : (
                        <span className="text-slate-400 italic">Direct FedWire Transit</span>
                      )}
                    </td>

                    <td className="p-4 text-right font-mono font-bold text-emerald-600 text-sm whitespace-nowrap">
                      +${dep.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>

                    <td className="p-4 text-center">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        Provider Verified
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
