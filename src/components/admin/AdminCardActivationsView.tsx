import React, { useState, useEffect } from 'react';
import { CardActivationRequest, CardActivationStatus } from '../../types';
import { api } from '../../services/api';
import {
  CreditCard,
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  Filter,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  User,
  Hash,
  Mail,
  KeyRound,
  X,
  Check,
  Calendar,
} from 'lucide-react';

interface AdminCardActivationsViewProps {
  onRefreshData?: () => void;
}

export const AdminCardActivationsView: React.FC<AdminCardActivationsViewProps> = ({ onRefreshData }) => {
  const [requests, setRequests] = useState<CardActivationRequest[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | CardActivationStatus>('ALL');

  // Approval / Rejection modal state
  const [actionModal, setActionModal] = useState<{
    type: 'APPROVE' | 'REJECT';
    req: CardActivationRequest;
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
      const res = await api.getAdminCardActivationRequests();
      if (res.success && Array.isArray(res.requests)) {
        const list = [...res.requests].sort(
          (a, b) => (new Date(b.submittedAt || 0).getTime() || 0) - (new Date(a.submittedAt || 0).getTime() || 0)
        );
        setRequests(list);
        setLoadError(null);
      } else {
        setLoadError(res.error || 'Unable to load card activation requests. Please verify your connection and try again.');
      }
    } catch (err: any) {
      console.error('[AdminCardActivationsView] Error loading requests:', err);
      setLoadError(err?.message || 'Unexpected error loading card activation requests.');
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
      const res = await api.approveCardActivationRequest(actionModal.req.id);
      if (res.success && res.request) {
        setRequests((prev) =>
          prev.map((r) => (r.id === actionModal.req.id ? res.request! : r))
        );
        setActionModal(null);
        if (onRefreshData) onRefreshData();
      } else {
        setActionError(res.error || 'Failed to approve card activation request.');
      }
    } catch (err: any) {
      setActionError(err?.message || 'Server error during approval.');
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleReject = async () => {
    if (!actionModal || actionModal.type !== 'REJECT') return;
    if (!rejectionReason.trim()) {
      setActionError('Please provide a reason for rejecting this activation request.');
      return;
    }
    setIsSubmittingAction(true);
    setActionError(null);
    try {
      const res = await api.rejectCardActivationRequest(
        actionModal.req.id,
        rejectionReason.trim()
      );
      if (res.success && res.request) {
        setRequests((prev) =>
          prev.map((r) => (r.id === actionModal.req.id ? res.request! : r))
        );
        setActionModal(null);
        setRejectionReason('');
        if (onRefreshData) onRefreshData();
      } else {
        setActionError(res.error || 'Failed to reject card activation request.');
      }
    } catch (err: any) {
      setActionError(err?.message || 'Server error during rejection.');
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const filteredRequests = requests.filter((r) => {
    const matchesStatus =
      statusFilter === 'ALL' || r.status === statusFilter;
    const query = searchQuery.toLowerCase().trim();
    const matchesSearch =
      !query ||
      (r.id || '').toLowerCase().includes(query) ||
      (r.customerName || '').toLowerCase().includes(query) ||
      (r.customerAccountNumber || '').toLowerCase().includes(query) ||
      (r.activationCode || '').toLowerCase().includes(query) ||
      (r.customerEmail && r.customerEmail.toLowerCase().includes(query));
    return matchesStatus && matchesSearch;
  });

  const pendingCount = requests.filter((r) => r.status === 'PENDING').length;
  const activatedCount = requests.filter((r) => r.status === 'ACTIVATED').length;
  const rejectedCount = requests.filter((r) => r.status === 'REJECTED').length;

  return (
    <div className="space-y-6 animate-in fade-in duration-150">
      {/* Header Banner */}
      <div className="p-6 sm:p-7 rounded-3xl bg-linear-to-br from-slate-950 via-slate-900 to-indigo-950 text-white shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-5 border border-slate-800">
        <div>
          <div className="flex items-center gap-2.5 mb-2">
            <span className="px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-indigo-400" />
              Debit Card Controls
            </span>
            <span className="text-xs text-slate-400 font-mono">
              Total Requests: {requests.length}
            </span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
            Debit Card Activation for Withdrawal
          </h2>
          <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-2xl leading-relaxed">
            Review customer debit card activation submissions. Approved cards are immediately authorized for instant card push withdrawals.
          </p>
        </div>

        <button
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
              Pending Activations
            </span>
            <span className="text-2xl sm:text-3xl font-black text-amber-950 font-mono mt-1 block">
              {pendingCount}
            </span>
            <span className="text-[11px] text-amber-700 font-medium">Awaiting administrator review</span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-amber-200/80 text-amber-900 flex items-center justify-center font-black">
            <Clock className="w-6 h-6" />
          </div>
        </div>

        <div className="p-4 sm:p-5 rounded-2xl bg-emerald-50 border-2 border-emerald-200 flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-emerald-800 uppercase tracking-wider block">
              Activated Cards
            </span>
            <span className="text-2xl sm:text-3xl font-black text-emerald-950 font-mono mt-1 block">
              {activatedCount}
            </span>
            <span className="text-[11px] text-emerald-700 font-medium">Authorized for card withdrawals</span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-emerald-200/80 text-emerald-900 flex items-center justify-center font-black">
            <CheckCircle2 className="w-6 h-6" />
          </div>
        </div>

        <div className="p-4 sm:p-5 rounded-2xl bg-rose-50 border-2 border-rose-200 flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-rose-800 uppercase tracking-wider block">
              Rejected Requests
            </span>
            <span className="text-2xl sm:text-3xl font-black text-rose-950 font-mono mt-1 block">
              {rejectedCount}
            </span>
            <span className="text-[11px] text-rose-700 font-medium">Declined by compliance</span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-rose-200/80 text-rose-900 flex items-center justify-center font-black">
            <XCircle className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          <input
            type="text"
            placeholder="Search by customer name, account number, or activation code..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-xs font-medium rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900 bg-slate-50/50"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <Filter className="w-3.5 h-3.5 text-slate-400 ml-1 mr-0.5" />
          {(['ALL', 'PENDING', 'ACTIVATED', 'REJECTED'] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setStatusFilter(filter)}
              className={`px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider transition-colors cursor-pointer ${
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

      {/* Table of Requests */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-slate-500 space-y-3">
            <div className="w-7 h-7 border-3 border-indigo-600 border-t-transparent animate-spin rounded-full mx-auto" />
            <p className="text-xs font-bold font-mono">Loading Card Activation Requests...</p>
          </div>
        ) : filteredRequests.length === 0 ? (
          <div className="p-12 text-center text-slate-500 space-y-2.5">
            {loadError ? (
              <AlertTriangle className="w-10 h-10 text-rose-400 mx-auto" />
            ) : (
              <KeyRound className="w-10 h-10 text-slate-300 mx-auto" />
            )}
            <h4 className="font-black text-slate-800 text-sm">
              {loadError ? 'Unable to Load Activation Requests' : 'No Activation Requests Found'}
            </h4>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              {loadError
                ? loadError
                : searchQuery || statusFilter !== 'ALL'
                ? 'No requests match your current search or filter criteria.'
                : 'Customer activation submissions will appear here for review.'}
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
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider">
                  <th className="p-4">Customer Details</th>
                  <th className="p-4">Activation Code</th>
                  <th className="p-4">Card Brand / Type</th>
                  <th className="p-4">Submitted Date</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRequests.map((req) => {
                  const isPending = req.status === 'PENDING';
                  const isActivated = req.status === 'ACTIVATED';
                  const isRejected = req.status === 'REJECTED';

                  return (
                    <tr key={req.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-4">
                        <div className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-slate-400" />
                          <span>{req.customerName}</span>
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 mt-0.5 flex items-center gap-1">
                          <Hash className="w-3 h-3 text-slate-400" />
                          <span>Acc: {req.customerAccountNumber}</span>
                        </div>
                        {req.customerEmail && (
                          <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1">
                            <Mail className="w-3 h-3 text-slate-400" />
                            <span>{req.customerEmail}</span>
                          </div>
                        )}
                        <div className="text-[10px] font-mono text-slate-400 mt-0.5 truncate max-w-[180px]" title={req.id}>
                          ID: {req.id}
                        </div>
                      </td>

                      <td className="p-4">
                        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-100 border border-slate-300 font-mono font-black text-slate-900 text-xs tracking-wider">
                          <KeyRound className="w-3.5 h-3.5 text-indigo-600" />
                          <span>{req.activationCode}</span>
                        </div>
                      </td>

                      <td className="p-4 font-mono font-bold text-slate-700">
                        <div className="flex items-center gap-1.5">
                          <CreditCard className="w-4 h-4 text-indigo-600" />
                          <span>{req.cardBrand || 'VISA'} Debit</span>
                        </div>
                      </td>

                      <td className="p-4 text-slate-600 font-medium whitespace-nowrap">
                        <div className="flex items-center gap-1 text-[11px]">
                          <Calendar className="w-3 h-3 text-slate-400" />
                          <span>{new Date(req.submittedAt).toLocaleDateString()}</span>
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                          {new Date(req.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </td>

                      <td className="p-4 whitespace-nowrap">
                        {isPending && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-300">
                            <Clock className="w-3 h-3 text-amber-600" />
                            Pending Review
                          </span>
                        )}
                        {isActivated && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-300">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            Activated
                          </span>
                        )}
                        {isRejected && (
                          <div>
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-100 text-rose-800 border border-rose-300">
                              <XCircle className="w-3 h-3 text-rose-600" />
                              Rejected
                            </span>
                            {req.rejectionReason && (
                              <div className="text-[10px] text-rose-700 mt-1 max-w-[200px] truncate" title={req.rejectionReason}>
                                Reason: {req.rejectionReason}
                              </div>
                            )}
                          </div>
                        )}
                      </td>

                      <td className="p-4 text-right whitespace-nowrap">
                        {isPending ? (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setActionModal({ type: 'APPROVE', req });
                                setActionError(null);
                              }}
                              className="px-3 py-1.5 rounded-xl font-black text-xs uppercase tracking-wider text-emerald-800 bg-emerald-100 hover:bg-emerald-200 border border-emerald-300 transition-colors flex items-center gap-1 cursor-pointer"
                            >
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                              <span>Approve</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setActionModal({ type: 'REJECT', req });
                                setRejectionReason('');
                                setActionError(null);
                              }}
                              className="px-3 py-1.5 rounded-xl font-black text-xs uppercase tracking-wider text-rose-800 bg-rose-100 hover:bg-rose-200 border border-rose-300 transition-colors flex items-center gap-1 cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5 text-rose-600" />
                              <span>Reject</span>
                            </button>
                          </div>
                        ) : isActivated ? (
                          <span className="text-[11px] font-bold text-emerald-700 font-mono">
                            Approved & Active
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setActionModal({ type: 'APPROVE', req });
                              setActionError(null);
                            }}
                            className="text-[11px] font-bold text-indigo-700 hover:text-indigo-900 underline cursor-pointer"
                          >
                            Re-evaluate / Approve
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Approve / Reject Modal */}
      {actionModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div
              className={`p-6 text-white ${
                actionModal.type === 'APPROVE'
                  ? 'bg-gradient-to-r from-emerald-900 to-slate-900'
                  : 'bg-gradient-to-r from-rose-900 to-slate-900'
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
                      ? 'Approve Debit Card Activation'
                      : 'Reject Debit Card Activation'}
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

            {/* Modal Body */}
            <div className="p-6 space-y-4">
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-xs space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-500">Customer Name:</span>
                  <span className="font-bold text-slate-900">{actionModal.req.customerName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Account Number:</span>
                  <span className="font-mono font-bold text-slate-900">
                    {actionModal.req.customerAccountNumber}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Submitted Activation Code:</span>
                  <span className="font-mono font-black text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                    {actionModal.req.activationCode}
                  </span>
                </div>
              </div>

              {actionError && (
                <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 font-medium">
                  {actionError}
                </div>
              )}

              {actionModal.type === 'APPROVE' ? (
                <p className="text-xs text-slate-600 leading-relaxed font-medium">
                  Approving this activation will update the customer's card status to <strong>Activated</strong>, permitting instant debit card push withdrawals on their account.
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
                    placeholder="Enter specific rejection reason (e.g. Invalid activation code, code expired, compliance verification failed)..."
                    className="w-full p-3 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-rose-500 bg-white"
                  />
                  <p className="text-[11px] text-slate-500">
                    The customer will see this reason in their withdrawal portal and may re-enter a new code.
                  </p>
                </div>
              )}

              {/* Action Buttons */}
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
