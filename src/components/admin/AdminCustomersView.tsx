import React, { useState } from 'react';
import { UserProfile } from '../../types';
import {
  Search,
  Filter,
  User,
  ShieldCheck,
  ShieldAlert,
  Lock,
  Unlock,
  MoreVertical,
  ChevronRight,
  Download,
  CheckCircle2,
  AlertCircle,
  Clock,
  Coins,
} from 'lucide-react';
import { AdminConfirmationModal } from './AdminConfirmationModal';

interface AdminCustomersViewProps {
  customers: (UserProfile & { balanceMetrics?: any })[];
  onSelectCustomer: (customer: UserProfile & { balanceMetrics?: any }) => void;
  onToggleStatus: (userId: string, reason: string) => Promise<void>;
  onRefreshData?: () => Promise<void>;
}

export const AdminCustomersView: React.FC<AdminCustomersViewProps> = ({
  customers,
  onSelectCustomer,
  onToggleStatus,
  onRefreshData,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'frozen'>('all');
  const [kycFilter, setKycFilter] = useState<'all' | 'verified' | 'pending' | 'unverified'>('all');

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

  const filteredCustomers = customers.filter((cust) => {
    const matchesSearch =
      cust.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      cust.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      cust.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      cust.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
      cust.permanentAccountNumber.includes(searchTerm);

    const matchesStatus =
      statusFilter === 'all' ? true : cust.status === statusFilter;

    const matchesKyc =
      kycFilter === 'all'
        ? true
        : kycFilter === 'verified'
        ? cust.kycStatus === 'verified'
        : kycFilter === 'pending'
        ? cust.kycStatus === 'pending'
        : cust.kycStatus === 'unverified' || !cust.kycStatus;

    return matchesSearch && matchesStatus && matchesKyc;
  });

  return (
    <div className="space-y-6">
      {/* Header & Stats Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">Customer Account Management</h2>
          <p className="text-sm font-semibold text-slate-500 mt-0.5">
            Search, inspect dossiers, and manage restrictions across {customers.length} registered banking clients
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="px-4 py-2.5 rounded-xl bg-slate-100 border border-slate-200 text-sm font-bold text-slate-700 shadow-xs">
            Total Available Liquidity: <strong className="text-slate-950 font-black font-mono ml-1">
              ${customers
                .reduce((acc, c) => acc + (c.balanceMetrics?.checkingBalance || 0), 0)
                .toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </strong>
          </div>
        </div>
      </div>

      {/* Filter and Search Toolbar */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by legal name, @handle, account number, or email..."
            className="w-full pl-11 pr-4 py-2.5 text-sm font-semibold rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-slate-900/15 focus:border-slate-800 text-slate-900 placeholder:text-slate-400 placeholder:font-normal shadow-xs"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 bg-slate-100 p-1.5 rounded-xl border border-slate-200 text-xs">
            <span className="text-slate-500 px-2 font-bold uppercase tracking-wider text-[11px]">Status:</span>
            {(['all', 'active', 'frozen'] as const).map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 rounded-lg font-extrabold capitalize transition-all ${
                  statusFilter === st
                    ? 'bg-white text-slate-950 shadow-sm'
                    : 'text-slate-600 hover:text-slate-950'
                }`}
              >
                {st}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 bg-slate-100 p-1.5 rounded-xl border border-slate-200 text-xs">
            <span className="text-slate-500 px-2 font-bold uppercase tracking-wider text-[11px]">KYC:</span>
            {(['all', 'verified', 'pending', 'unverified'] as const).map((k) => (
              <button
                key={k}
                onClick={() => setKycFilter(k)}
                className={`px-3 py-1.5 rounded-lg font-extrabold capitalize transition-all ${
                  kycFilter === k
                    ? 'bg-white text-slate-950 shadow-sm'
                    : 'text-slate-600 hover:text-slate-950'
                }`}
              >
                {k}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Customer Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-100/80 text-slate-800 border-b border-slate-200">
              <tr>
                <th className="p-4 sm:p-5 text-xs font-black uppercase tracking-wider">Client Legal Profile</th>
                <th className="p-4 sm:p-5 text-xs font-black uppercase tracking-wider">Account Number</th>
                <th className="p-4 sm:p-5 text-xs font-black uppercase tracking-wider">KYC Verification</th>
                <th className="p-4 sm:p-5 text-xs font-black uppercase tracking-wider">Account Status</th>
                <th className="p-4 sm:p-5 text-xs font-black uppercase tracking-wider text-right">Available Checking</th>
                <th className="p-4 sm:p-5 text-xs font-black uppercase tracking-wider text-right">Total Net Worth</th>
                <th className="p-4 sm:p-5 text-xs font-black uppercase tracking-wider">Registration Date</th>
                <th className="p-4 sm:p-5 text-xs font-black uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-12 text-center text-slate-500 font-bold text-sm">
                    No customers found matching the search and filter criteria.
                  </td>
                </tr>
              ) : (
                filteredCustomers.map((cust) => {
                  const isFrozen = cust.status === 'frozen';
                  const isKycVerified = cust.kycStatus === 'verified';
                  const isKycPending = cust.kycStatus === 'pending';

                  return (
                    <tr
                      key={cust.id}
                      className="hover:bg-slate-50/90 transition-colors group cursor-pointer"
                      onClick={() => onSelectCustomer(cust)}
                    >
                      {/* Legal Profile */}
                      <td className="p-4 sm:p-5">
                        <div className="flex items-center gap-3.5">
                          <div className="relative">
                            {cust.avatarUrl ? (
                              <img
                                src={cust.avatarUrl}
                                alt={cust.firstName}
                                className="w-12 h-12 rounded-2xl object-cover shadow-xs"
                              />
                            ) : (
                              <div className="w-12 h-12 rounded-2xl bg-slate-900 text-amber-400 font-black flex items-center justify-center text-base shadow-xs">
                                {cust.firstName[0]}
                                {cust.lastName[0]}
                              </div>
                            )}
                            <span
                              className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white ${
                                isFrozen ? 'bg-rose-500' : 'bg-emerald-500'
                              }`}
                            />
                          </div>

                          <div>
                            <div className="font-extrabold text-slate-950 text-base flex items-center gap-2">
                              <span>{cust.firstName} {cust.lastName}</span>
                              <span className="text-xs font-bold text-slate-400">@{cust.username}</span>
                            </div>
                            <div className="text-slate-600 font-semibold text-xs mt-1">
                              {cust.email} • {cust.phone || '+1 (555) 019-2834'}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Account Number */}
                      <td className="p-4 sm:p-5 font-mono font-black text-sm text-slate-950">
                        {cust.permanentAccountNumber}
                      </td>

                      {/* KYC Verification */}
                      <td className="p-4 sm:p-5">
                        <span
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold border ${
                            isKycVerified
                              ? 'bg-blue-50 text-blue-800 border-blue-200'
                              : isKycPending
                              ? 'bg-amber-50 text-amber-900 border-amber-300'
                              : 'bg-slate-100 text-slate-700 border-slate-200'
                          }`}
                        >
                          {isKycVerified ? (
                            <>
                              <ShieldCheck className="w-4 h-4 text-blue-600 stroke-[2.5]" />
                              Tier 3 Verified
                            </>
                          ) : isKycPending ? (
                            <>
                              <Clock className="w-4 h-4 text-amber-600 stroke-[2.5]" />
                              Review Pending
                            </>
                          ) : (
                            <>
                              <AlertCircle className="w-4 h-4 text-slate-500 stroke-[2.5]" />
                              Unverified
                            </>
                          )}
                        </span>
                      </td>

                      {/* Account Status */}
                      <td className="p-4 sm:p-5">
                        <span
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold border ${
                            isFrozen
                              ? 'bg-rose-50 text-rose-800 border-rose-200'
                              : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          }`}
                        >
                          {isFrozen ? (
                            <>
                              <Lock className="w-3.5 h-3.5 text-rose-600 stroke-[2.5]" /> Frozen / Restricted
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 stroke-[2.5]" /> Active & Unrestricted
                            </>
                          )}
                        </span>
                      </td>

                      {/* Available Checking */}
                      <td className="p-4 sm:p-5 text-right font-mono font-black text-sm sm:text-base text-slate-950">
                        ${(cust.balanceMetrics?.checkingBalance || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>

                      {/* Total Balance */}
                      <td className="p-4 sm:p-5 text-right font-mono font-black text-sm sm:text-base text-amber-700">
                        ${(cust.balanceMetrics?.totalBalance || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>

                      {/* Reg Date */}
                      <td className="p-4 sm:p-5 text-slate-700 font-bold text-xs sm:text-sm whitespace-nowrap">
                        {new Date(cust.createdAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </td>

                      {/* Actions */}
                      <td className="p-4 sm:p-5 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-2.5">
                          <button
                            onClick={() => onSelectCustomer(cust)}
                            className="px-3.5 py-2 rounded-xl bg-slate-900 text-white font-bold text-xs sm:text-sm hover:bg-slate-800 transition-colors flex items-center gap-1 shadow-xs"
                          >
                            Dossier <ChevronRight className="w-4 h-4" />
                          </button>

                          <button
                            onClick={() => {
                              setConfirmConfig({
                                isOpen: true,
                                title: isFrozen ? 'Unfreeze Customer Account' : 'Freeze Customer Account',
                                description: isFrozen
                                  ? `You are restoring transactional privileges to ${cust.firstName} ${cust.lastName}.`
                                  : `You are freezing ${cust.firstName} ${cust.lastName}'s account. All withdrawals and outbound transfers will be blocked.`,
                                confirmLabel: isFrozen ? 'Unfreeze Account' : 'Freeze Account',
                                variant: isFrozen ? 'primary' : 'danger',
                                targetName: `${cust.firstName} ${cust.lastName} (${cust.permanentAccountNumber})`,
                                action: async (reason) => {
                                  await onToggleStatus(cust.id, reason);
                                  if (onRefreshData) await onRefreshData();
                                },
                              });
                            }}
                            title={isFrozen ? 'Unfreeze account' : 'Freeze account'}
                            className={`p-2.5 rounded-xl border transition-colors ${
                              isFrozen
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100'
                                : 'bg-rose-50 border-rose-200 text-rose-800 hover:bg-rose-100'
                            }`}
                          >
                            {isFrozen ? <Unlock className="w-4.5 h-4.5 stroke-[2.5]" /> : <Lock className="w-4.5 h-4.5 stroke-[2.5]" />}
                          </button>
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
