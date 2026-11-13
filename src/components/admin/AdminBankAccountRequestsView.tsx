import React, { useState, useEffect } from 'react';
import { LinkedBankAccountApplication } from '../../types';
import { api } from '../../services/api';
import {
  Landmark,
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  Filter,
  RefreshCw,
  Eye,
  ShieldCheck,
  AlertTriangle,
  Building,
  User,
  Hash,
  Mail,
  Phone,
  Globe,
  Calendar,
  Lock,
  X,
  Check,
} from 'lucide-react';

interface AdminBankAccountRequestsViewProps {
  onRefreshData?: () => void;
}

export const AdminBankAccountRequestsView: React.FC<AdminBankAccountRequestsViewProps> = ({ onRefreshData }) => {
  const [applications, setApplications] = useState<LinkedBankAccountApplication[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'pending' | 'approved' | 'activated' | 'rejected' | 'cancelled'>('ALL');
  const [selectedApp, setSelectedApp] = useState<LinkedBankAccountApplication | null>(null);
  const [inspectModalOpen, setInspectModalOpen] = useState<boolean>(false);

  // Approval / Rejection modal state (Stage 1)
  const [actionModal, setActionModal] = useState<{
    type: 'APPROVE' | 'REJECT';
    app: LinkedBankAccountApplication;
  } | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string>('');
  const [isSubmittingAction, setIsSubmittingAction] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadRequests = async (silent = false) => {
    if (!silent) {
      setIsLoading(true);
    }
    try {
      const res = await api.getAdminBankAccountApplications();
      if (res.success && res.applications) {
        setApplications(res.applications);
        setLoadError(null);
      } else {
        setLoadError(res.error || 'Unable to load bank account approval requests. Please verify your connection and retry.');
      }
    } catch (err: any) {
      console.error('[AdminBankAccountRequestsView] Error loading requests:', err);
      setLoadError(err?.message || 'Network error loading bank account approval requests.');
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    loadRequests(false);
    const intervalId = window.setInterval(() => {
      loadRequests(true);
    }, 10000);
    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        loadRequests(true);
      }
    };
    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, []);

  const handleApprove = async () => {
    if (!actionModal || actionModal.type !== 'APPROVE') return;
    setIsSubmittingAction(true);
    setActionError(null);
    try {
      const res = await api.approveBankAccountApplication(actionModal.app.id);
      if (res.success && res.application) {
        setApplications((prev) =>
          prev.map((a) => (a.id === actionModal.app.id ? res.application! : a))
        );
        setActionModal(null);
        if (selectedApp?.id === actionModal.app.id) {
          setSelectedApp(res.application);
        }
        if (onRefreshData) onRefreshData();
      } else {
        setActionError(res.error || 'Failed to approve bank account application.');
      }
    } catch (err: any) {
      setActionError(err?.message || 'Server error during approval.');
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleReject = async () => {
    if (!actionModal || actionModal.type !== 'REJECT') return;
    setIsSubmittingAction(true);
    setActionError(null);
    try {
      const res = await api.rejectBankAccountApplication(
        actionModal.app.id,
        rejectionReason.trim() || undefined
      );
      if (res.success && res.application) {
        setApplications((prev) =>
          prev.map((a) => (a.id === actionModal.app.id ? res.application! : a))
        );
        setActionModal(null);
        setRejectionReason('');
        if (selectedApp?.id === actionModal.app.id) {
          setSelectedApp(res.application);
        }
        if (onRefreshData) onRefreshData();
      } else {
        setActionError(res.error || 'Failed to reject bank account application.');
      }
    } catch (err: any) {
      setActionError(err?.message || 'Server error during rejection.');
    } finally {
      setIsSubmittingAction(false);
    }
  };

  // Filtering
  const filteredApps = applications.filter((app) => {
    if (statusFilter !== 'ALL') {
      if (statusFilter === 'activated') {
        if (app.status !== 'activated' && app.activationStatus !== 'ACTIVATED') return false;
      } else if (statusFilter === 'approved') {
        if (app.status !== 'approved' || app.activationStatus === 'ACTIVATED') return false;
      } else if (app.status !== statusFilter) {
        return false;
      }
    }
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      (app.id || '').toLowerCase().includes(q) ||
      (app.customerName || '').toLowerCase().includes(q) ||
      (app.customerAccountNumber || '').toLowerCase().includes(q) ||
      (app.bankName || '').toLowerCase().includes(q) ||
      (app.accountHolderName || '').toLowerCase().includes(q) ||
      (app.userId || '').toLowerCase().includes(q) ||
      (app.accountNumber && app.accountNumber.toLowerCase().includes(q)) ||
      (app.bankEmail && app.bankEmail.toLowerCase().includes(q)) ||
      (app.phoneNumber && app.phoneNumber.toLowerCase().includes(q)) ||
      (app.verificationReference && app.verificationReference.toLowerCase().includes(q)) ||
      (app.verificationCode && app.verificationCode.toLowerCase().includes(q)) ||
      (app.maskedAccountNumber && app.maskedAccountNumber.toLowerCase().includes(q)) ||
      (app.swiftBic && app.swiftBic.toLowerCase().includes(q)) ||
      (app.iban && app.iban.toLowerCase().includes(q)) ||
      (app.maskedIban && app.maskedIban.toLowerCase().includes(q))
    );
  });

  const pendingCount = applications.filter((a) => a.status === 'pending').length;
  const approvedCount = applications.filter((a) => a.status === 'approved' && a.activationStatus !== 'ACTIVATED').length;
  const activatedCount = applications.filter((a) => a.status === 'activated' || a.activationStatus === 'ACTIVATED').length;
  const rejectedCount = applications.filter((a) => a.status === 'rejected').length;

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Top Banner & Stats */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-7 text-white shadow-xl relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-amber-400/20 text-amber-400 flex items-center justify-center border border-amber-400/30">
                <Landmark className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white">
                  Bank Account Approval Requests
                </h1>
                <p className="text-xs text-slate-400 font-medium">
                  Authoritative administrative review for customer manual bank account linking and payout rails
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => loadRequests(false)}
              disabled={isLoading}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-colors flex items-center gap-2 border border-slate-700 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-amber-400' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Aggregate Counters */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-6 pt-6 border-t border-slate-800/80">
          <div className="p-3.5 rounded-2xl bg-slate-950/60 border border-slate-800">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Total Applications</div>
            <div className="text-2xl font-black font-mono text-white mt-1">{applications.length}</div>
          </div>
          <div className="p-3.5 rounded-2xl bg-amber-950/30 border border-amber-500/30">
            <div className="text-[11px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              Pending Review
            </div>
            <div className="text-2xl font-black font-mono text-amber-400 mt-1">{pendingCount}</div>
          </div>
          <div className="p-3.5 rounded-2xl bg-blue-950/30 border border-blue-500/30">
            <div className="text-[11px] font-bold text-blue-400 uppercase tracking-wider flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-blue-400" />
              Approved (Verifying)
            </div>
            <div className="text-2xl font-black font-mono text-blue-400 mt-1">{approvedCount}</div>
          </div>
          <div className="p-3.5 rounded-2xl bg-emerald-950/30 border border-emerald-500/30">
            <div className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              Activated
            </div>
            <div className="text-2xl font-black font-mono text-emerald-400 mt-1">{activatedCount}</div>
          </div>
          <div className="p-3.5 rounded-2xl bg-rose-950/30 border border-rose-500/30">
            <div className="text-[11px] font-bold text-rose-400 uppercase tracking-wider flex items-center gap-1.5">
              <XCircle className="w-3.5 h-3.5 text-rose-400" />
              Rejected
            </div>
            <div className="text-2xl font-black font-mono text-rose-400 mt-1">{rejectedCount}</div>
          </div>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="relative w-full md:w-96">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          <input
            type="text"
            placeholder="Search by customer, account #, bank name, UID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-xs font-semibold rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900 bg-slate-50"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto pb-1 md:pb-0">
          <span className="text-xs font-bold text-slate-500 mr-1 flex items-center gap-1">
            <Filter className="w-3.5 h-3.5" /> Filter:
          </span>
          {(['ALL', 'pending', 'approved', 'activated', 'rejected', 'cancelled'] as const).map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold capitalize transition-all cursor-pointer ${
                statusFilter === st
                  ? 'bg-slate-950 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {st === 'ALL' ? 'All Requests' : st}
            </button>
          ))}
        </div>
      </div>

      {/* Load Error Alert */}
      {loadError && (
        <div className="p-4 rounded-2xl bg-rose-50 border-2 border-rose-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-rose-900 text-xs font-semibold">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{loadError}</span>
          </div>
          <button
            type="button"
            onClick={() => loadRequests(false)}
            className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-colors cursor-pointer self-start sm:self-auto"
          >
            Retry
          </button>
        </div>
      )}

      {/* Applications Table / Cards */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="py-20 text-center space-y-3">
            <div className="w-8 h-8 border-3 border-amber-500 border-t-transparent animate-spin rounded-full mx-auto" />
            <p className="text-xs font-bold text-slate-500">Loading bank approval applications...</p>
          </div>
        ) : filteredApps.length === 0 ? (
          <div className="py-16 text-center space-y-3">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mx-auto ${loadError ? 'bg-rose-100 text-rose-500' : 'bg-slate-100 text-slate-400'}`}>
              {loadError ? <AlertTriangle className="w-6 h-6" /> : <Landmark className="w-6 h-6" />}
            </div>
            <div className="font-black text-slate-900 text-sm">
              {loadError ? 'Unable to Load Bank Account Requests' : 'No Bank Account Requests Found'}
            </div>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              {loadError
                ? loadError
                : searchQuery || statusFilter !== 'ALL'
                ? 'No bank account applications match your active search filters.'
                : 'Customers have not submitted any manual bank account linking applications yet.'}
            </p>
            {loadError && (
              <button
                type="button"
                onClick={() => loadRequests(false)}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-colors cursor-pointer"
              >
                Retry Loading Requests
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="px-5 py-4">Customer</th>
                  <th className="px-5 py-4">Bank & Country</th>
                  <th className="px-5 py-4">Account Holder</th>
                  <th className="px-5 py-4">Account / SWIFT / IBAN</th>
                  <th className="px-5 py-4">Contact Info</th>
                  <th className="px-5 py-4">Submitted</th>
                  <th className="px-5 py-4 text-center">Status</th>
                  <th className="px-5 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {filteredApps.map((app) => {
                  const isPending = app.status === 'pending';

                  return (
                    <tr key={app.id} className="hover:bg-slate-50/70 transition-colors">
                      {/* Customer Info */}
                      <td className="px-5 py-4">
                        <div className="font-black text-slate-950 text-sm">{app.customerName}</div>
                        <div className="font-mono text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                          <Hash className="w-3 h-3 text-slate-400" />
                          <span>MVB: {app.customerAccountNumber}</span>
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono truncate max-w-[160px]" title={app.userId}>
                          UID: {app.userId.slice(0, 10)}...
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono truncate max-w-[160px]" title={app.id}>
                          App: {app.id}
                        </div>
                      </td>

                      {/* Bank & Country */}
                      <td className="px-5 py-4">
                        <div className="font-black text-slate-900 flex items-center gap-1.5">
                          <Building className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                          <span>{app.bankName}</span>
                        </div>
                        <div className="text-[11px] text-slate-600 font-semibold mt-0.5 flex items-center gap-1">
                          <Globe className="w-3 h-3 text-slate-400" />
                          <span>{app.country}</span>
                          <span className="px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 font-mono text-[10px] font-bold">
                            {app.currency}
                          </span>
                        </div>
                      </td>

                      {/* Account Holder Name */}
                      <td className="px-5 py-4">
                        <div className="font-bold text-slate-900">{app.accountHolderName}</div>
                        <div className="text-[10px] text-slate-500">Legal Beneficiary</div>
                        {(app.accountHolderName || '').trim().toLowerCase() !== (app.customerName || '').trim().toLowerCase() ? (
                          <div className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-amber-100 text-amber-900 border border-amber-300">
                            <AlertTriangle className="w-2.5 h-2.5 text-amber-600 flex-shrink-0" />
                            <span>Name Mismatch</span>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider bg-emerald-50 text-emerald-800 border border-emerald-200">
                            <Check className="w-2.5 h-2.5 text-emerald-600 flex-shrink-0" />
                            <span>Matched</span>
                          </div>
                        )}
                      </td>

                      {/* Account / SWIFT / IBAN */}
                      <td className="px-5 py-4">
                        <div className="font-mono font-bold text-slate-900 select-all">
                          {app.accountNumber || app.maskedAccountNumber}
                        </div>
                        {app.swiftBic && (
                          <div className="font-mono text-[11px] text-slate-700 font-semibold mt-0.5 select-all">
                            SWIFT/BIC: {app.swiftBic}
                          </div>
                        )}
                        {(app.iban || app.maskedIban) && (
                          <div className="font-mono text-[11px] text-slate-600 mt-0.5 break-all select-all">
                            IBAN: {app.iban || app.maskedIban}
                          </div>
                        )}
                        {app.routingNumber && (
                          <div className="font-mono text-[10px] text-slate-400">
                            Routing: {app.routingNumber}
                          </div>
                        )}
                        {app.sortCode && (
                          <div className="font-mono text-[10px] text-slate-400">
                            Sort Code: {app.sortCode}
                          </div>
                        )}
                        {app.bsb && (
                          <div className="font-mono text-[10px] text-slate-400">
                            BSB: {app.bsb}
                          </div>
                        )}
                        {app.verificationCode && (
                          <div className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-50 border border-indigo-200 font-mono text-[11px] font-black text-indigo-900 select-all">
                            <Lock className="w-3 h-3 text-indigo-600 shrink-0" />
                            <span>Code: {app.verificationCode}</span>
                          </div>
                        )}
                        {app.verificationReference && (
                          <div className="font-mono text-[10px] text-emerald-700 font-bold flex items-center gap-1 mt-0.5">
                            <ShieldCheck className="w-3 h-3 text-emerald-600" />
                            <span>Ref: {app.verificationReference}</span>
                          </div>
                        )}
                      </td>

                      {/* Contact Info */}
                      <td className="px-5 py-4">
                        <div className="text-slate-700 text-[11px] flex items-center gap-1 truncate max-w-[160px]" title={app.bankEmail}>
                          <Mail className="w-3 h-3 text-slate-400 flex-shrink-0" />
                          <span>{app.bankEmail}</span>
                        </div>
                        <div className="text-slate-600 text-[11px] flex items-center gap-1 mt-0.5">
                          <Phone className="w-3 h-3 text-slate-400 flex-shrink-0" />
                          <span>{app.phoneNumber}</span>
                        </div>
                      </td>

                      {/* Submission Date */}
                      <td className="px-5 py-4 text-slate-600 text-[11px]">
                        <div className="flex items-center gap-1 text-slate-800 font-semibold">
                          <Calendar className="w-3 h-3 text-slate-400" />
                          <span>{new Date(app.submittedAt).toLocaleDateString()}</span>
                        </div>
                        <div className="font-mono text-[10px] text-slate-400">
                          {new Date(app.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-5 py-4 text-center">
                        {(app.status === 'activated' || app.activationStatus === 'ACTIVATED') && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-900 border border-emerald-400 font-mono">
                            <ShieldCheck className="w-3 h-3 text-emerald-700" />
                            Activated
                          </span>
                        )}
                        {app.status === 'approved' && app.activationStatus !== 'ACTIVATED' && (
                          (app.verificationCode || app.verificationReference) && app.verificationCodeStatus === 'PENDING' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-indigo-100 text-indigo-900 border border-indigo-400 font-mono">
                              <Clock className="w-3 h-3 text-indigo-700" />
                              Verification Pending Review
                            </span>
                          ) : app.verificationCodeStatus === 'REJECTED' || app.activationStatus === 'REJECTED' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-100 text-rose-900 border border-rose-400 font-mono">
                              <XCircle className="w-3 h-3 text-rose-600" />
                              Verification Rejected
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-blue-100 text-blue-900 border border-blue-400 font-mono">
                              <Clock className="w-3 h-3 text-blue-700" />
                              Approved (Awaiting Reference)
                            </span>
                          )
                        )}
                        {app.status === 'pending' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-900 border border-amber-400 font-mono">
                            <Clock className="w-3 h-3 text-amber-600" />
                            Pending
                          </span>
                        )}
                        {app.status === 'rejected' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-100 text-rose-900 border border-rose-400 font-mono">
                            <XCircle className="w-3.5 h-3.5 text-rose-600" />
                            Rejected
                          </span>
                        )}
                        {app.status === 'cancelled' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-slate-200 text-slate-700 border border-slate-300 font-mono">
                            Cancelled
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => {
                              setSelectedApp(app);
                              setInspectModalOpen(true);
                            }}
                            className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
                            title="Inspect Details"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          {isPending && (
                            <>
                              <button
                                onClick={() => {
                                  setActionError(null);
                                  setActionModal({ type: 'APPROVE', app });
                                }}
                                className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] transition-colors cursor-pointer flex items-center gap-1 shadow-xs"
                              >
                                <Check className="w-3.5 h-3.5" />
                                <span>Approve</span>
                              </button>

                              <button
                                onClick={() => {
                                  setActionError(null);
                                  setRejectionReason('');
                                  setActionModal({ type: 'REJECT', app });
                                }}
                                className="px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-[11px] transition-colors cursor-pointer flex items-center gap-1 shadow-xs"
                              >
                                <X className="w-3.5 h-3.5" />
                                <span>Reject</span>
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* INSPECT DETAILS MODAL */}
      {inspectModalOpen && selectedApp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-xl w-full p-6 sm:p-7 border border-slate-200 shadow-2xl relative max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-slate-900 text-amber-400 flex items-center justify-center font-bold">
                  <Landmark className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-slate-950 text-lg">Bank Account Application Details</h3>
                  <p className="text-xs text-slate-500 font-mono">ID: {selectedApp.id}</p>
                </div>
              </div>
              <button
                onClick={() => setInspectModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-5 space-y-4 text-xs">
              {/* Beneficiary Name Audit Banner */}
              {(selectedApp.accountHolderName || '').trim().toLowerCase() !== (selectedApp.customerName || '').trim().toLowerCase() ? (
                <div className="p-3.5 rounded-2xl bg-amber-50 border-2 border-amber-300 text-amber-950 space-y-1">
                  <div className="flex items-center gap-1.5 font-black text-amber-900 text-xs">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    <span>⚠️ Warning: Account Holder & Monvera Profile Name Mismatch</span>
                  </div>
                  <p className="text-[11px] text-amber-800 leading-relaxed font-medium">
                    Submitted bank holder name (<strong>{selectedApp.accountHolderName}</strong>) differs from Monvera profile name (<strong>{selectedApp.customerName}</strong>). Please manually review KYC documentation and verify whether third-party wire authorization applies before approval. Do not reject solely due to a name difference without verifying relationship.
                  </p>
                </div>
              ) : (
                <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 flex items-center gap-2 text-[11px] font-medium">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  <span>Beneficiary name matches customer's registered Monvera legal identity.</span>
                </div>
              )}

              {/* Customer Profile Section */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="font-bold text-slate-900 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-slate-500" />
                  Customer Profile
                </div>
                <div className="grid grid-cols-2 gap-2 text-slate-700">
                  <div>
                    <span className="text-slate-400">Full Name:</span>{' '}
                    <strong className="text-slate-950">{selectedApp.customerName}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400">Monvera Account:</span>{' '}
                    <strong className="font-mono text-slate-950">{selectedApp.customerAccountNumber}</strong>
                  </div>
                  <div className="col-span-2">
                    <span className="text-slate-400">Customer UID:</span>{' '}
                    <span className="font-mono text-slate-600 select-all">{selectedApp.userId}</span>
                  </div>
                </div>
              </div>

              {/* Bank Details Section */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5">
                <div className="font-bold text-slate-900 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                  <Building className="w-3.5 h-3.5 text-slate-500" />
                  Banking Credentials & Rails
                </div>
                <div className="grid grid-cols-2 gap-3 text-slate-700">
                  <div>
                    <span className="text-slate-400 block text-[10px]">Bank Name</span>
                    <strong className="text-slate-950 text-sm">{selectedApp.bankName}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Country & Currency</span>
                    <strong className="text-slate-950">
                      {selectedApp.country} ({selectedApp.currency})
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Account Holder Name</span>
                    <strong className="text-slate-950">{selectedApp.accountHolderName}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Bank Account Number</span>
                    <strong className="font-mono text-slate-950 select-all">
                      {selectedApp.accountNumber || selectedApp.maskedAccountNumber}
                    </strong>
                    {selectedApp.maskedAccountNumber && selectedApp.accountNumber && (
                      <span className="block text-[10px] font-mono text-slate-400">
                        Masked: {selectedApp.maskedAccountNumber}
                      </span>
                    )}
                  </div>
                  <div className="col-span-2 pt-2 border-t border-slate-200/80">
                    <span className="text-slate-400 block text-[10px]">Bank Activation & Rail Verification</span>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {selectedApp.status === 'activated' || selectedApp.activationStatus === 'ACTIVATED' ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-emerald-100 text-emerald-900 border border-emerald-300 font-mono">
                          <ShieldCheck className="w-4 h-4 text-emerald-700" />
                          Activated ({selectedApp.verificationReference || 'OB-DIRECT-AUTH'})
                        </span>
                      ) : selectedApp.status === 'approved' ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-blue-100 text-blue-900 border border-blue-300 font-mono">
                          <Clock className="w-4 h-4 text-blue-700" />
                          {(selectedApp.verificationCode || selectedApp.verificationReference) &&
                          selectedApp.verificationCodeStatus === 'PENDING'
                            ? 'Verification Pending Review (See Bank Verification Requests Tab)'
                            : selectedApp.verificationCodeStatus === 'REJECTED'
                            ? 'Verification Rejected'
                            : 'Approved • Awaiting Verification Reference'}
                        </span>
                      ) : selectedApp.status === 'pending' ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-amber-100 text-amber-900 border border-amber-300 font-mono">
                          <Clock className="w-4 h-4 text-amber-700" />
                          Pending Review
                        </span>
                      ) : selectedApp.status === 'cancelled' ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-slate-200 text-slate-700 border border-slate-300 font-mono">
                          Cancelled
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-rose-100 text-rose-900 border border-rose-300 font-mono">
                          Rejected
                        </span>
                      )}
                      {(selectedApp.verificationReference || selectedApp.verificationCode) && (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-indigo-100 text-indigo-950 border border-indigo-300 font-mono select-all">
                          <Lock className="w-3.5 h-3.5 text-indigo-700" />
                          Submitted Reference: {selectedApp.verificationReference || selectedApp.verificationCode}
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">SWIFT / BIC Code</span>
                    <strong className="font-mono text-slate-950 select-all">
                      {selectedApp.swiftBic || 'Not provided'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">IBAN (International)</span>
                    <strong className="font-mono text-slate-950 break-all select-all">
                      {selectedApp.iban || selectedApp.maskedIban || 'Not provided'}
                    </strong>
                  </div>
                  {selectedApp.routingNumber && (
                    <div>
                      <span className="text-slate-400 block text-[10px]">Routing Number</span>
                      <strong className="font-mono text-slate-950">{selectedApp.routingNumber}</strong>
                    </div>
                  )}
                  {selectedApp.sortCode && (
                    <div>
                      <span className="text-slate-400 block text-[10px]">Sort Code</span>
                      <strong className="font-mono text-slate-950">{selectedApp.sortCode}</strong>
                    </div>
                  )}
                  {selectedApp.bsb && (
                    <div>
                      <span className="text-slate-400 block text-[10px]">BSB Code</span>
                      <strong className="font-mono text-slate-950">{selectedApp.bsb}</strong>
                    </div>
                  )}
                  {selectedApp.authVerificationStatus && (
                    <div className="col-span-2 pt-2 border-t border-slate-200/80">
                      <span className="text-slate-400 block text-[10px]">Open Banking OAuth Status</span>
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200 mt-1">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                        {selectedApp.authVerificationStatus === 'OAUTH_VERIFIED'
                          ? 'Open Banking OAuth Verified'
                          : 'Manual Compliance Document Verification Mode'}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Contact Information */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="font-bold text-slate-900 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-slate-500" />
                  Customer Contact Submitted
                </div>
                <div className="grid grid-cols-2 gap-2 text-slate-700">
                  <div>
                    <span className="text-slate-400">Bank Email:</span>{' '}
                    <strong className="text-slate-950">{selectedApp.bankEmail}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400">Phone:</span>{' '}
                    <strong className="text-slate-950">{selectedApp.phoneNumber}</strong>
                  </div>
                </div>
              </div>

              {/* Status and Audit History */}
              <div className="p-4 rounded-2xl bg-amber-50/70 border border-amber-200/80 space-y-2">
                <div className="font-bold text-amber-900 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-amber-700" />
                  Compliance Status & Audit
                </div>
                <div className="space-y-1.5 text-amber-950">
                  <div className="flex items-center justify-between">
                    <span>Application Status:</span>
                    <strong className="uppercase font-black text-amber-900">{selectedApp.status}</strong>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Submitted At:</span>
                    <span className="font-mono">{new Date(selectedApp.submittedAt).toLocaleString()}</span>
                  </div>
                  {selectedApp.approvedAt && (
                    <div className="flex items-center justify-between">
                      <span>Approved At:</span>
                      <span className="font-mono">{new Date(selectedApp.approvedAt).toLocaleString()}</span>
                    </div>
                  )}
                  {selectedApp.rejectedAt && (
                    <div className="flex items-center justify-between">
                      <span>Rejected At:</span>
                      <span className="font-mono">{new Date(selectedApp.rejectedAt).toLocaleString()}</span>
                    </div>
                  )}
                  {selectedApp.rejectionReason && (
                    <div className="pt-1 border-t border-amber-200">
                      <span className="text-slate-500 block">Stage 1 Rejection Reason:</span>
                      <span className="font-semibold text-rose-800">{selectedApp.rejectionReason}</span>
                    </div>
                  )}
                  {(selectedApp.verificationReference || selectedApp.verificationCode || selectedApp.verificationCodeStatus) && (
                    <div className="pt-2 border-t border-amber-200 space-y-1">
                      <div className="flex items-center justify-between">
                        <span>Stage 2 Verification Status:</span>
                        <strong className="font-mono uppercase text-amber-950">
                          {selectedApp.verificationCodeStatus || selectedApp.activationStatus || 'N/A'}
                        </strong>
                      </div>
                      {(selectedApp.verificationReference || selectedApp.verificationCode) && (
                        <div className="flex items-center justify-between gap-2">
                          <span>Submitted Reference:</span>
                          <span className="font-mono font-bold text-slate-950 break-all select-all">
                            {selectedApp.verificationReference || selectedApp.verificationCode}
                          </span>
                        </div>
                      )}
                      {selectedApp.verificationSubmittedAt && (
                        <div className="flex items-center justify-between">
                          <span>Verification Submitted At:</span>
                          <span className="font-mono">{new Date(selectedApp.verificationSubmittedAt).toLocaleString()}</span>
                        </div>
                      )}
                      {selectedApp.verificationApprovedAt && (
                        <div className="flex items-center justify-between">
                          <span>Verification Approved At:</span>
                          <span className="font-mono">{new Date(selectedApp.verificationApprovedAt).toLocaleString()}</span>
                        </div>
                      )}
                      {selectedApp.verificationRejectedAt && (
                        <div className="flex items-center justify-between">
                          <span>Verification Rejected At:</span>
                          <span className="font-mono">{new Date(selectedApp.verificationRejectedAt).toLocaleString()}</span>
                        </div>
                      )}
                      {(selectedApp.verificationRejectionReason || selectedApp.lastVerificationRejectionReason) && (
                        <div>
                          <span className="text-slate-500 block">Stage 2 Rejection Reason:</span>
                          <span className="font-semibold text-rose-800">
                            {selectedApp.verificationRejectionReason || selectedApp.lastVerificationRejectionReason}
                          </span>
                        </div>
                      )}
                      {Array.isArray(selectedApp.verificationHistory) && selectedApp.verificationHistory.length > 0 && (
                        <div className="pt-1 space-y-1">
                          <span className="text-slate-500 block">Stage 2 Decision History:</span>
                          {selectedApp.verificationHistory.map((h, i) => (
                            <div key={`${h.decidedAt}-${i}`} className="p-2 rounded-lg bg-white border border-amber-200 text-[11px]">
                              <div className="flex justify-between font-mono font-bold">
                                <span className="break-all">{h.reference}</span>
                                <span className={h.decision === 'APPROVED' ? 'text-emerald-700' : 'text-rose-700'}>
                                  {h.decision}
                                </span>
                              </div>
                              <div className="text-[10px] text-slate-500 font-mono">
                                {new Date(h.decidedAt).toLocaleString()} • {h.decidedBy}
                              </div>
                              {h.reason && <div className="text-rose-700 mt-0.5">Reason: {h.reason}</div>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setInspectModalOpen(false)}
                className="px-5 py-2.5 rounded-xl bg-slate-950 hover:bg-slate-800 text-white font-bold text-xs transition-colors cursor-pointer"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}

      {/* APPROVE / REJECT CONFIRMATION MODAL (STAGE 1) */}
      {actionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 border border-slate-200 shadow-2xl relative space-y-4">
            <div className="flex items-center gap-3">
              <div
                className={`w-11 h-11 rounded-2xl flex items-center justify-center ${
                  actionModal.type === 'APPROVE'
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-rose-100 text-rose-700'
                }`}
              >
                {actionModal.type === 'APPROVE' ? (
                  <CheckCircle2 className="w-6 h-6" />
                ) : (
                  <AlertTriangle className="w-6 h-6" />
                )}
              </div>
              <div>
                <h3 className="font-black text-slate-950 text-base">
                  {actionModal.type === 'APPROVE' ? 'Approve Bank Account' : 'Reject Bank Account'}
                </h3>
                <p className="text-xs text-slate-500">
                  {actionModal.type === 'APPROVE'
                    ? 'Approve bank details so customer can proceed to the activation step'
                    : 'Deny this bank account linking request'}
                </p>
              </div>
            </div>

            {actionError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 font-medium flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                <span>{actionError}</span>
              </div>
            )}

            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-xs space-y-1.5 text-slate-700">
              <div>
                <span className="text-slate-400">Customer:</span>{' '}
                <strong className="text-slate-950">{actionModal.app.customerName}</strong>
              </div>
              <div>
                <span className="text-slate-400">Bank:</span>{' '}
                <strong className="text-slate-950">
                  {actionModal.app.bankName} ({actionModal.app.accountNumber || actionModal.app.maskedAccountNumber})
                </strong>
              </div>
              <div>
                <span className="text-slate-400">Beneficiary:</span>{' '}
                <strong className="text-slate-950">{actionModal.app.accountHolderName}</strong>
              </div>
              {actionModal.app.swiftBic && (
                <div>
                  <span className="text-slate-400">SWIFT / BIC:</span>{' '}
                  <strong className="font-mono text-slate-950">{actionModal.app.swiftBic}</strong>
                </div>
              )}
              {(actionModal.app.iban || actionModal.app.maskedIban) && (
                <div>
                  <span className="text-slate-400">IBAN:</span>{' '}
                  <strong className="font-mono text-slate-950 break-all">
                    {actionModal.app.iban || actionModal.app.maskedIban}
                  </strong>
                </div>
              )}
            </div>

            {actionModal.type === 'REJECT' && (
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Rejection Reason (Optional)
                </label>
                <textarea
                  rows={3}
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="e.g. Beneficiary name does not match verified KYC documents, or invalid routing code."
                  className="w-full p-3 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white"
                />
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setActionModal(null)}
                disabled={isSubmittingAction}
                className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition-colors cursor-pointer"
              >
                Cancel
              </button>

              {actionModal.type === 'APPROVE' ? (
                <button
                  type="button"
                  onClick={handleApprove}
                  disabled={isSubmittingAction}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition-colors flex items-center gap-1.5 cursor-pointer shadow-md disabled:opacity-50"
                >
                  {isSubmittingAction ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent animate-spin rounded-full" />
                      <span>Approving...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Confirm Approval</span>
                    </>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleReject}
                  disabled={isSubmittingAction}
                  className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs transition-colors flex items-center gap-1.5 cursor-pointer shadow-md disabled:opacity-50"
                >
                  {isSubmittingAction ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent animate-spin rounded-full" />
                      <span>Rejecting...</span>
                    </>
                  ) : (
                    <>
                      <X className="w-4 h-4" />
                      <span>Confirm Rejection</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
