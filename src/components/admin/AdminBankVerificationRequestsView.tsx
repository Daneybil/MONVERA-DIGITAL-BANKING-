import React, { useState, useEffect } from 'react';
import { LinkedBankAccountApplication } from '../../types';
import { api } from '../../services/api';
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  Filter,
  RefreshCw,
  Eye,
  AlertTriangle,
  Building,
  User,
  Hash,
  Mail,
  Calendar,
  KeyRound,
  X,
  Check,
  History,
} from 'lucide-react';

interface AdminBankVerificationRequestsViewProps {
  onRefreshData?: () => void;
}

export const AdminBankVerificationRequestsView: React.FC<AdminBankVerificationRequestsViewProps> = ({
  onRefreshData,
}) => {
  const [applications, setApplications] = useState<LinkedBankAccountApplication[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'>('ALL');
  const [selectedApp, setSelectedApp] = useState<LinkedBankAccountApplication | null>(null);
  const [inspectModalOpen, setInspectModalOpen] = useState<boolean>(false);

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
      const res = await api.getAdminBankVerificationRequests();
      if (res.success && Array.isArray(res.requests)) {
        setApplications(res.requests);
        setLoadError(null);
      } else {
        setLoadError(
          res.error || 'Unable to load bank verification requests. Please verify your connection and retry.'
        );
      }
    } catch (err: any) {
      console.error('[AdminBankVerificationRequestsView] Error loading requests:', err);
      setLoadError(err?.message || 'Network error loading bank verification requests.');
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

  const getEffectiveStatus = (app: LinkedBankAccountApplication): 'PENDING' | 'APPROVED' | 'REJECTED' => {
    if (
      app.status === 'activated' ||
      app.activationStatus === 'ACTIVATED' ||
      app.verificationCodeStatus === 'APPROVED'
    ) {
      return 'APPROVED';
    }
    if (app.verificationCodeStatus === 'REJECTED' || app.activationStatus === 'REJECTED') {
      return 'REJECTED';
    }
    return 'PENDING';
  };

  const getSubmittedReference = (app: LinkedBankAccountApplication): string =>
    app.verificationReference || app.verificationCode || '';

  const handleApprove = async () => {
    if (!actionModal || actionModal.type !== 'APPROVE' || isSubmittingAction) return;
    setIsSubmittingAction(true);
    setActionError(null);
    try {
      const res = await api.approveBankVerificationRequest(actionModal.app.id);
      if (res.success && res.application) {
        setApplications((prev) =>
          prev.map((a) => (a.id === actionModal.app.id ? res.application! : a))
        );
        if (selectedApp?.id === actionModal.app.id) {
          setSelectedApp(res.application);
        }
        setActionModal(null);
        if (onRefreshData) onRefreshData();
      } else {
        setActionError(res.error || 'Failed to approve bank verification request.');
      }
    } catch (err: any) {
      setActionError(err?.message || 'Server error approving verification request.');
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleReject = async () => {
    if (!actionModal || actionModal.type !== 'REJECT' || isSubmittingAction) return;
    if (!rejectionReason.trim()) {
      setActionError('Please enter a rejection reason visible to the customer.');
      return;
    }
    setIsSubmittingAction(true);
    setActionError(null);
    try {
      const res = await api.rejectBankVerificationRequest(
        actionModal.app.id,
        rejectionReason.trim()
      );
      if (res.success && res.application) {
        setApplications((prev) =>
          prev.map((a) => (a.id === actionModal.app.id ? res.application! : a))
        );
        if (selectedApp?.id === actionModal.app.id) {
          setSelectedApp(res.application);
        }
        setActionModal(null);
        setRejectionReason('');
        if (onRefreshData) onRefreshData();
      } else {
        setActionError(res.error || 'Failed to reject bank verification request.');
      }
    } catch (err: any) {
      setActionError(err?.message || 'Server error rejecting verification request.');
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const filteredApps = applications.filter((app) => {
    const effStatus = getEffectiveStatus(app);
    if (statusFilter !== 'ALL' && effStatus !== statusFilter) {
      return false;
    }
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    const ref = getSubmittedReference(app).toLowerCase();
    return (
      (app.id || '').toLowerCase().includes(q) ||
      (app.customerName || '').toLowerCase().includes(q) ||
      (app.customerAccountNumber || '').toLowerCase().includes(q) ||
      (app.customerEmail || '').toLowerCase().includes(q) ||
      (app.bankEmail || '').toLowerCase().includes(q) ||
      (app.userId || '').toLowerCase().includes(q) ||
      (app.bankName || '').toLowerCase().includes(q) ||
      (app.accountHolderName || '').toLowerCase().includes(q) ||
      (app.maskedAccountNumber || '').toLowerCase().includes(q) ||
      (app.accountNumber || '').toLowerCase().includes(q) ||
      ref.includes(q)
    );
  });

  const pendingCount = applications.filter((a) => getEffectiveStatus(a) === 'PENDING').length;
  const approvedCount = applications.filter((a) => getEffectiveStatus(a) === 'APPROVED').length;
  const rejectedCount = applications.filter((a) => getEffectiveStatus(a) === 'REJECTED').length;

  return (
    <div className="space-y-6 animate-in fade-in duration-150">
      {/* Header Banner */}
      <div className="p-6 sm:p-7 rounded-3xl bg-linear-to-br from-slate-950 via-slate-900 to-teal-950 text-white shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-5 border border-slate-800">
        <div>
          <div className="flex items-center gap-2.5 mb-2 flex-wrap">
            <span className="px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-teal-500/20 text-teal-300 border border-teal-500/30 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-teal-400" />
              Stage 2 Activation Controls
            </span>
            <span className="text-xs text-slate-400 font-mono">
              Total Verification Submissions: {applications.length}
            </span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
            Bank Verification Requests
          </h2>
          <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-2xl leading-relaxed">
            Review customer verification references submitted after bank account approval. Approving a request activates direct bank payouts.
          </p>
        </div>

        <button
          type="button"
          onClick={() => loadRequests(false)}
          disabled={isLoading}
          className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/20 text-xs font-bold text-white transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50 self-start md:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh Queue</span>
        </button>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 sm:p-5 rounded-2xl bg-amber-50 border-2 border-amber-200 flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-amber-800 uppercase tracking-wider block">
              Pending Verification
            </span>
            <span className="text-2xl sm:text-3xl font-black text-amber-950 font-mono mt-1 block">
              {pendingCount}
            </span>
            <span className="text-[11px] text-amber-700 font-medium">Awaiting final activation review</span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-amber-200/80 text-amber-900 flex items-center justify-center font-black">
            <Clock className="w-6 h-6" />
          </div>
        </div>

        <div className="p-4 sm:p-5 rounded-2xl bg-emerald-50 border-2 border-emerald-200 flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-emerald-800 uppercase tracking-wider block">
              Approved & Activated
            </span>
            <span className="text-2xl sm:text-3xl font-black text-emerald-950 font-mono mt-1 block">
              {approvedCount}
            </span>
            <span className="text-[11px] text-emerald-700 font-medium">Unlocked for bank withdrawals</span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-emerald-200/80 text-emerald-900 flex items-center justify-center font-black">
            <CheckCircle2 className="w-6 h-6" />
          </div>
        </div>

        <div className="p-4 sm:p-5 rounded-2xl bg-rose-50 border-2 border-rose-200 flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-rose-800 uppercase tracking-wider block">
              Rejected References
            </span>
            <span className="text-2xl sm:text-3xl font-black text-rose-950 font-mono mt-1 block">
              {rejectedCount}
            </span>
            <span className="text-[11px] text-rose-700 font-medium">Awaiting customer resubmission</span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-rose-200/80 text-rose-900 flex items-center justify-center font-black">
            <XCircle className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          <input
            type="text"
            placeholder="Search by customer, UID, application ID, bank name, or verification reference..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-xs font-medium rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900 bg-slate-50/50"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
          <Filter className="w-3.5 h-3.5 text-slate-400 ml-1 mr-0.5 shrink-0" />
          {(['ALL', 'PENDING', 'APPROVED', 'REJECTED'] as const).map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => setStatusFilter(filter)}
              className={`px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider transition-colors cursor-pointer shrink-0 ${
                statusFilter === filter
                  ? 'bg-slate-950 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {filter}
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

      {/* Table of Bank Verification Requests */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="py-20 text-center space-y-3">
            <div className="w-8 h-8 border-3 border-teal-500 border-t-transparent animate-spin rounded-full mx-auto" />
            <p className="text-xs font-bold text-slate-500">Loading bank verification requests...</p>
          </div>
        ) : filteredApps.length === 0 ? (
          <div className="py-16 text-center space-y-3 px-4">
            <div
              className={`w-12 h-12 rounded-2xl flex items-center justify-center mx-auto ${
                loadError ? 'bg-rose-100 text-rose-500' : 'bg-slate-100 text-slate-400'
              }`}
            >
              {loadError ? <AlertTriangle className="w-6 h-6" /> : <ShieldCheck className="w-6 h-6" />}
            </div>
            <div className="font-black text-slate-900 text-sm">
              {loadError ? 'Unable to Load Bank Verification Requests' : 'No Bank Verification Requests Found'}
            </div>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              {loadError
                ? loadError
                : searchQuery || statusFilter !== 'ALL'
                ? 'No bank verification requests match your active search or status filter.'
                : 'Customer verification reference submissions for approved bank accounts will appear here.'}
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
                  <th className="px-5 py-4">Customer & IDs</th>
                  <th className="px-5 py-4">Bank & Account</th>
                  <th className="px-5 py-4">Verification Reference</th>
                  <th className="px-5 py-4">Submitted</th>
                  <th className="px-5 py-4 text-center">Verification Status</th>
                  <th className="px-5 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {filteredApps.map((app) => {
                  const effStatus = getEffectiveStatus(app);
                  const submittedRef = getSubmittedReference(app);
                  const isPending = effStatus === 'PENDING';
                  const isApproved = effStatus === 'APPROVED';
                  const isRejected = effStatus === 'REJECTED';
                  const displayEmail = app.customerEmail || app.bankEmail;

                  return (
                    <tr key={app.id} className="hover:bg-slate-50/70 transition-colors">
                      {/* Customer & IDs */}
                      <td className="px-5 py-4">
                        <div className="font-black text-slate-950 text-sm flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>{app.customerName}</span>
                        </div>
                        <div className="font-mono text-[11px] text-slate-600 flex items-center gap-1 mt-0.5">
                          <Hash className="w-3 h-3 text-slate-400 shrink-0" />
                          <span>MVB: {app.customerAccountNumber}</span>
                        </div>
                        {displayEmail && (
                          <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5 truncate max-w-[200px]" title={displayEmail}>
                            <Mail className="w-3 h-3 text-slate-400 shrink-0" />
                            <span>{displayEmail}</span>
                          </div>
                        )}
                        <div className="text-[10px] font-mono text-slate-400 mt-0.5 truncate max-w-[200px]" title={app.userId}>
                          UID: {app.userId}
                        </div>
                        <div className="text-[10px] font-mono text-slate-400 truncate max-w-[200px]" title={app.id}>
                          App: {app.id}
                        </div>
                      </td>

                      {/* Bank & Account */}
                      <td className="px-5 py-4">
                        <div className="font-black text-slate-900 flex items-center gap-1.5">
                          <Building className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>{app.bankName}</span>
                        </div>
                        <div className="text-[11px] text-slate-700 font-semibold mt-0.5">
                          Holder: <span className="font-bold text-slate-950">{app.accountHolderName}</span>
                        </div>
                        <div className="font-mono text-[11px] text-slate-800 font-bold mt-0.5">
                          {app.maskedAccountNumber || `•••• ${app.accountNumber.slice(-4)}`}
                        </div>
                      </td>

                      {/* Submitted Verification Reference */}
                      <td className="px-5 py-4">
                        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-teal-50 border border-teal-300 font-mono font-black text-teal-950 text-xs break-all max-w-[240px] select-all">
                          <KeyRound className="w-3.5 h-3.5 text-teal-700 shrink-0" />
                          <span>{submittedRef || '—'}</span>
                        </div>
                      </td>

                      {/* Submitted Timestamp */}
                      <td className="px-5 py-4 text-slate-600 text-[11px] whitespace-nowrap">
                        {app.verificationSubmittedAt ? (
                          <>
                            <div className="flex items-center gap-1 text-slate-800 font-semibold">
                              <Calendar className="w-3 h-3 text-slate-400" />
                              <span>{new Date(app.verificationSubmittedAt).toLocaleDateString()}</span>
                            </div>
                            <div className="font-mono text-[10px] text-slate-400 mt-0.5">
                              {new Date(app.verificationSubmittedAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </div>
                          </>
                        ) : (
                          <span className="text-slate-400 font-mono">Not recorded</span>
                        )}
                      </td>

                      {/* Verification Status */}
                      <td className="px-5 py-4 text-center">
                        {isPending && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-900 border border-amber-300 font-mono">
                            <Clock className="w-3 h-3 text-amber-700" />
                            PENDING
                          </span>
                        )}
                        {isApproved && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-900 border border-emerald-300 font-mono">
                            <CheckCircle2 className="w-3 h-3 text-emerald-700" />
                            APPROVED
                          </span>
                        )}
                        {isRejected && (
                          <div className="inline-flex flex-col items-center gap-1">
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-100 text-rose-900 border border-rose-300 font-mono">
                              <XCircle className="w-3 h-3 text-rose-600" />
                              REJECTED
                            </span>
                            {(app.verificationRejectionReason || app.lastVerificationRejectionReason) && (
                              <span
                                className="text-[10px] text-rose-700 max-w-[180px] truncate"
                                title={app.verificationRejectionReason || app.lastVerificationRejectionReason}
                              >
                                {app.verificationRejectionReason || app.lastVerificationRejectionReason}
                              </span>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedApp(app);
                              setInspectModalOpen(true);
                            }}
                            className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
                            title="Inspect Verification Details"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          {isPending && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setActionError(null);
                                  setActionModal({ type: 'APPROVE', app });
                                }}
                                className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[11px] uppercase tracking-wider transition-colors cursor-pointer flex items-center gap-1 shadow-xs"
                              >
                                <Check className="w-3.5 h-3.5" />
                                <span>APPROVE</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  setActionError(null);
                                  setRejectionReason('');
                                  setActionModal({ type: 'REJECT', app });
                                }}
                                className="px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-black text-[11px] uppercase tracking-wider transition-colors cursor-pointer flex items-center gap-1 shadow-xs"
                              >
                                <X className="w-3.5 h-3.5" />
                                <span>REJECT</span>
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

      {/* INSPECT MODAL */}
      {inspectModalOpen && selectedApp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-xl w-full p-6 sm:p-7 border border-slate-200 shadow-2xl relative max-h-[90vh] overflow-y-auto space-y-4">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-teal-950 text-teal-300 flex items-center justify-center font-bold shrink-0">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-black text-slate-950 text-lg truncate">Bank Verification Request</h3>
                  <p className="text-xs text-slate-500 font-mono truncate">Application ID: {selectedApp.id}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setInspectModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Customer Profile */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-xs space-y-2">
              <div className="font-bold text-slate-900 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-slate-500" />
                Customer Information
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-700">
                <div>
                  <span className="text-slate-400">Customer Name:</span>{' '}
                  <strong className="text-slate-950">{selectedApp.customerName}</strong>
                </div>
                <div>
                  <span className="text-slate-400">Monvera Account:</span>{' '}
                  <strong className="font-mono text-slate-950">{selectedApp.customerAccountNumber}</strong>
                </div>
                <div>
                  <span className="text-slate-400">Email:</span>{' '}
                  <strong className="text-slate-950 break-all">
                    {selectedApp.customerEmail || selectedApp.bankEmail || 'Not available'}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-400">Customer UID:</span>{' '}
                  <strong className="font-mono text-slate-900 break-all select-all">{selectedApp.userId}</strong>
                </div>
              </div>
            </div>

            {/* Bank Details */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-xs space-y-2">
              <div className="font-bold text-slate-900 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                <Building className="w-3.5 h-3.5 text-slate-500" />
                Approved Linked Bank Account
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-700">
                <div>
                  <span className="text-slate-400">Bank Name:</span>{' '}
                  <strong className="text-slate-950">{selectedApp.bankName}</strong>
                </div>
                <div>
                  <span className="text-slate-400">Account Holder:</span>{' '}
                  <strong className="text-slate-950">{selectedApp.accountHolderName}</strong>
                </div>
                <div>
                  <span className="text-slate-400">Masked Account:</span>{' '}
                  <strong className="font-mono text-slate-950">
                    {selectedApp.maskedAccountNumber || `•••• ${selectedApp.accountNumber.slice(-4)}`}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-400">Country & Currency:</span>{' '}
                  <strong className="text-slate-950">
                    {selectedApp.country} ({selectedApp.currency})
                  </strong>
                </div>
              </div>
            </div>

            {/* Stage 2 Verification Details */}
            <div className="p-4 rounded-2xl bg-teal-50/70 border border-teal-200 text-xs space-y-2.5">
              <div className="font-bold text-teal-950 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5 text-teal-700" />
                Verification Submission
              </div>
              <div className="space-y-1.5">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                  <span className="text-slate-600">Verification Reference:</span>
                  <strong className="font-mono text-teal-950 bg-white px-2.5 py-1 rounded-lg border border-teal-300 break-all select-all">
                    {getSubmittedReference(selectedApp) || '—'}
                  </strong>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-600">Verification Status:</span>
                  <strong className="font-mono uppercase text-slate-950">
                    {getEffectiveStatus(selectedApp)}
                  </strong>
                </div>
                {selectedApp.verificationSubmittedAt && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-600">Submitted Timestamp:</span>
                    <span className="font-mono text-slate-800">
                      {new Date(selectedApp.verificationSubmittedAt).toLocaleString()}
                    </span>
                  </div>
                )}
                {selectedApp.verificationApprovedAt && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-600">Approved Timestamp:</span>
                    <span className="font-mono text-emerald-800">
                      {new Date(selectedApp.verificationApprovedAt).toLocaleString()}
                    </span>
                  </div>
                )}
                {selectedApp.verificationRejectedAt && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-600">Rejected Timestamp:</span>
                    <span className="font-mono text-rose-800">
                      {new Date(selectedApp.verificationRejectedAt).toLocaleString()}
                    </span>
                  </div>
                )}
                {(selectedApp.verificationRejectionReason || selectedApp.lastVerificationRejectionReason) && (
                  <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 font-semibold">
                    Rejection Reason: {selectedApp.verificationRejectionReason || selectedApp.lastVerificationRejectionReason}
                  </div>
                )}
              </div>
            </div>

            {/* Verification History */}
            {Array.isArray(selectedApp.verificationHistory) && selectedApp.verificationHistory.length > 0 && (
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-xs space-y-2">
                <div className="font-bold text-slate-900 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5 text-slate-500" />
                  Verification Decision History
                </div>
                <div className="space-y-2">
                  {selectedApp.verificationHistory.map((entry, idx) => (
                    <div
                      key={`${entry.decidedAt}-${idx}`}
                      className="p-2.5 rounded-xl bg-white border border-slate-200 flex flex-col gap-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-bold text-slate-900 break-all">{entry.reference}</span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase font-mono ${
                            entry.decision === 'APPROVED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {entry.decision}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono">
                        Decided: {new Date(entry.decidedAt).toLocaleString()} • By: {entry.decidedBy}
                      </div>
                      {entry.reason && (
                        <div className="text-[11px] text-rose-800 font-medium">Reason: {entry.reason}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              {getEffectiveStatus(selectedApp) === 'PENDING' && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setInspectModalOpen(false);
                      setActionError(null);
                      setActionModal({ type: 'APPROVE', app: selectedApp });
                    }}
                    className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase tracking-wider cursor-pointer"
                  >
                    APPROVE
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setInspectModalOpen(false);
                      setActionError(null);
                      setRejectionReason('');
                      setActionModal({ type: 'REJECT', app: selectedApp });
                    }}
                    className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-black text-xs uppercase tracking-wider cursor-pointer"
                  >
                    REJECT
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setInspectModalOpen(false)}
                className="px-5 py-2.5 rounded-xl bg-slate-950 hover:bg-slate-800 text-white font-bold text-xs transition-colors cursor-pointer"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}

      {/* APPROVE / REJECT MODAL */}
      {actionModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95 duration-150">
            <div
              className={`p-6 text-white ${
                actionModal.type === 'APPROVE'
                  ? 'bg-linear-to-r from-emerald-900 to-slate-900'
                  : 'bg-linear-to-r from-rose-900 to-slate-900'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {actionModal.type === 'APPROVE' ? (
                    <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                  ) : (
                    <AlertTriangle className="w-6 h-6 text-rose-400" />
                  )}
                  <h3 className="text-lg font-black tracking-tight">
                    {actionModal.type === 'APPROVE'
                      ? 'Approve Bank Verification Request'
                      : 'Reject Bank Verification Request'}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setActionModal(null)}
                  className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-xs space-y-2">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">Customer Name:</span>
                  <span className="font-bold text-slate-900">{actionModal.app.customerName}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">Bank & Account:</span>
                  <span className="font-mono font-bold text-slate-900">
                    {actionModal.app.bankName} ({actionModal.app.maskedAccountNumber})
                  </span>
                </div>
                <div className="flex justify-between gap-2 items-center">
                  <span className="text-slate-500">Verification Reference:</span>
                  <span className="font-mono font-black text-teal-900 bg-teal-50 px-2 py-0.5 rounded border border-teal-200 break-all">
                    {getSubmittedReference(actionModal.app)}
                  </span>
                </div>
              </div>

              {actionError && (
                <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 font-medium flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{actionError}</span>
                </div>
              )}

              {actionModal.type === 'APPROVE' ? (
                <p className="text-xs text-slate-600 leading-relaxed font-medium">
                  Approving this verification reference will activate the linked bank account so the customer can immediately execute direct bank withdrawals.
                </p>
              ) : (
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Rejection Reason (Visible to Customer)
                  </label>
                  <textarea
                    required
                    rows={3}
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    placeholder="Enter the reason for rejecting this verification reference..."
                    className="w-full p-3 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-rose-500 bg-white"
                  />
                  <p className="text-[11px] text-slate-500">
                    The bank account will remain approved (not activated) and the customer can submit a new verification reference.
                  </p>
                </div>
              )}

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setActionModal(null)}
                  disabled={isSubmittingAction}
                  className="px-4 py-2.5 rounded-xl font-bold text-xs text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  Cancel
                </button>

                {actionModal.type === 'APPROVE' ? (
                  <button
                    type="button"
                    onClick={handleApprove}
                    disabled={isSubmittingAction}
                    className="px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 transition-colors flex items-center gap-1.5 cursor-pointer shadow-md"
                  >
                    {isSubmittingAction ? (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent animate-spin rounded-full" />
                    ) : (
                      <Check className="w-4 h-4" />
                    )}
                    <span>Confirm Approval</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleReject}
                    disabled={isSubmittingAction || !rejectionReason.trim()}
                    className="px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-50 transition-colors flex items-center gap-1.5 cursor-pointer shadow-md"
                  >
                    {isSubmittingAction ? (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent animate-spin rounded-full" />
                    ) : (
                      <X className="w-4 h-4" />
                    )}
                    <span>Confirm Rejection</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
