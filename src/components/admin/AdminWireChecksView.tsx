import React, { useState, useEffect, useMemo, useRef } from 'react';
import { WireCheckRequestRecord } from '../../types';
import { api } from '../../services/api';
import { AdminLoginForm } from './AdminLoginForm';
import {
  Search,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Clock,
  FileText,
  Landmark,
  Mail,
  Phone,
  MapPin,
  User,
  Loader2,
  X,
  ShieldCheck,
} from 'lucide-react';

interface AdminWireChecksViewProps {
  onRefreshData?: () => Promise<void>;
}

type StatusFilter = 'ALL' | 'REQUESTED' | 'DELIVERED';

export const AdminWireChecksView: React.FC<AdminWireChecksViewProps> = ({
  onRefreshData,
}) => {
  const [requests, setRequests] = useState<WireCheckRequestRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');

  // Confirmation modal & delivery submission state
  const [confirmTarget, setConfirmTarget] = useState<WireCheckRequestRecord | null>(null);
  const [isDelivering, setIsDelivering] = useState<boolean>(false);
  const [actionFeedback, setActionFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [needsAdminReauth, setNeedsAdminReauth] = useState<boolean>(false);
  const [reauthNotice, setReauthNotice] = useState<string | null>(null);

  const deliverLockRef = useRef<boolean>(false);

  const loadWireChecks = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await api.getAdminWireCheckRequests();
      if (res.success) {
        setRequests(res.requests || []);
      } else {
        setLoadError(res.error || 'Failed to load Wire Check withdrawal requests.');
        if (res.errorCode === 'ADMIN_SESSION_INVALID' || res.errorCode === 'UNAUTHORIZED') {
          setReauthNotice(
            'Your administrator session expired or is missing. Re-authenticate to continue managing Wire Check withdrawals.'
          );
          setNeedsAdminReauth(true);
        }
      }
    } catch (err: any) {
      setLoadError(err?.message || 'Network error retrieving Wire Check withdrawal requests.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadWireChecks();
  }, []);

  const stats = useMemo(() => {
    const requestedCount = requests.filter((r) => r.checkProcessingStatus === 'REQUESTED').length;
    const deliveredCount = requests.filter((r) => r.checkProcessingStatus === 'DELIVERED').length;
    const totalVolume = requests.reduce((sum, r) => sum + Number(r.amount || 0), 0);
    return {
      total: requests.length,
      requestedCount,
      deliveredCount,
      totalVolume,
    };
  }, [requests]);

  const filteredRequests = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return requests.filter((req) => {
      if (statusFilter !== 'ALL' && req.checkProcessingStatus !== statusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        (req.fullLegalName || '').toLowerCase().includes(q) ||
        (req.customerName || '').toLowerCase().includes(q) ||
        (req.customerAccountNumber || '').toLowerCase().includes(q) ||
        (req.userId || '').toLowerCase().includes(q) ||
        (req.bankName || '').toLowerCase().includes(q) ||
        (req.destinationBankAccountNumber || '').toLowerCase().includes(q) ||
        (req.destinationBankRoutingNumber || '').toLowerCase().includes(q) ||
        (req.referenceNumber || '').toLowerCase().includes(q) ||
        (req.email || '').toLowerCase().includes(q) ||
        (req.phoneNumber || '').toLowerCase().includes(q) ||
        (req.residentialAddress || '').toLowerCase().includes(q)
      );
    });
  }, [requests, statusFilter, searchQuery]);

  const handleConfirmMarkDelivered = async () => {
    if (!confirmTarget || deliverLockRef.current || isDelivering) return;

    deliverLockRef.current = true;
    setIsDelivering(true);
    setActionFeedback(null);

    try {
      const res = await api.markWireCheckDelivered(confirmTarget.requestId);
      if (res.success && res.request) {
        const updatedReq = res.request;
        setRequests((prev) =>
          prev.map((item) => (item.requestId === updatedReq.requestId ? updatedReq : item))
        );
        setConfirmTarget(null);
        setActionFeedback({
          type: 'success',
          text: `Wire Check ${updatedReq.referenceNumber} for ${updatedReq.fullLegalName} ($${updatedReq.amount.toLocaleString(
            'en-US',
            { minimumFractionDigits: 2, maximumFractionDigits: 2 }
          )} to ${updatedReq.bankName}) has been marked as DELIVERED and the customer has been notified.`,
        });
        await Promise.all([
          loadWireChecks(),
          onRefreshData ? onRefreshData() : Promise.resolve(),
        ]);
      } else if (
        res.errorCode === 'ADMIN_SESSION_INVALID' ||
        res.errorCode === 'UNAUTHORIZED'
      ) {
        setReauthNotice(
          res.error || 'Your administrator session expired. Re-authenticate to complete delivery confirmation.'
        );
        setNeedsAdminReauth(true);
      } else {
        setConfirmTarget(null);
        setActionFeedback({
          type: 'error',
          text: res.error || 'Unable to mark Wire Check as delivered.',
        });
      }
    } catch (err: any) {
      setConfirmTarget(null);
      setActionFeedback({
        type: 'error',
        text: err?.message || 'Unexpected error confirming Wire Check delivery.',
      });
    } finally {
      deliverLockRef.current = false;
      setIsDelivering(false);
    }
  };

  if (needsAdminReauth) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <AdminLoginForm
          sessionNotice={reauthNotice}
          onSuccess={() => {
            setNeedsAdminReauth(false);
            setReauthNotice(null);
            loadWireChecks();
          }}
          onCancel={() => setNeedsAdminReauth(false)}
        />
      </div>
    );
  }

  return (
    <section id="admin-wire-checks-view" className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">
              <FileText className="w-4.5 h-4.5 text-sky-300" />
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-slate-950 tracking-tight">
              WIRE CHECK WITHDRAWALS
            </h2>
          </div>
          <p className="text-xs sm:text-sm text-slate-600 font-medium">
            Isolated permanent-debit Wire Check withdrawal queue. All customer balances are already debited on
            submission; confirming delivery notifies the customer without altering balances.
          </p>
        </div>

        <button
          type="button"
          onClick={loadWireChecks}
          disabled={isLoading}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-bold transition-colors cursor-pointer shrink-0 whitespace-nowrap self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh Queue</span>
        </button>
      </div>

      {/* Summary Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider font-mono">
            Total Requests
          </div>
          <div className="text-2xl font-black text-slate-950 font-mono tabular-nums mt-1">
            {stats.total}
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-[11px] font-bold text-amber-700 uppercase tracking-wider font-mono">
            Awaiting Delivery
          </div>
          <div className="text-2xl font-black text-amber-700 font-mono tabular-nums mt-1">
            {stats.requestedCount}
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider font-mono">
            Delivered
          </div>
          <div className="text-2xl font-black text-emerald-700 font-mono tabular-nums mt-1">
            {stats.deliveredCount}
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider font-mono">
            Total Check Volume
          </div>
          <div className="text-2xl font-black text-slate-950 font-mono tabular-nums mt-1">
            ${stats.totalVolume.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
      </div>

      {/* Action / Load Feedback */}
      {actionFeedback && (
        <div
          role="status"
          className={`p-4 rounded-2xl border flex items-start justify-between gap-3 text-xs sm:text-sm font-semibold ${
            actionFeedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
              : 'bg-rose-50 border-rose-300 text-rose-950'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {actionFeedback.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-5 h-5 text-rose-700 shrink-0 mt-0.5" />
            )}
            <span>{actionFeedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionFeedback(null)}
            aria-label="Dismiss message"
            className="p-1 rounded-lg hover:bg-black/5 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {loadError && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-300 text-rose-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs sm:text-sm font-semibold">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-rose-700 shrink-0" />
            <span>{loadError}</span>
          </div>
          <button
            type="button"
            onClick={loadWireChecks}
            className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer self-start sm:self-auto"
          >
            Retry
          </button>
        </div>
      )}

      {/* Search & Filter Controls */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by legal name, account number, bank, reference, email, or phone..."
            className="w-full pl-10 pr-4 py-2 text-xs sm:text-sm rounded-xl border border-slate-300 bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-slate-900"
          />
        </div>

        <div className="flex items-center rounded-xl bg-slate-100 p-1 shrink-0">
          {(['ALL', 'REQUESTED', 'DELIVERED'] as StatusFilter[]).map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(status)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                statusFilter === status
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-700 hover:text-slate-950'
              }`}
            >
              {status === 'ALL' ? 'All' : status === 'REQUESTED' ? 'Requested' : 'Delivered'}
            </button>
          ))}
        </div>
      </div>

      {/* Queue List */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-4">
            {[1, 2, 3].map((row) => (
              <div
                key={row}
                className="h-28 rounded-xl bg-slate-100 animate-pulse border border-slate-200"
              />
            ))}
          </div>
        ) : filteredRequests.length === 0 ? (
          <div className="p-14 text-center space-y-2.5">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-500 flex items-center justify-center mx-auto">
              <FileText className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-slate-900">
              {requests.length === 0 ? 'No Wire Check Withdrawals Yet' : 'No Matching Requests'}
            </h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              {requests.length === 0
                ? 'Customer Wire Check withdrawal requests will appear here with full delivery details once submitted.'
                : 'Adjust your search query or status filter to view matching Wire Check requests.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {filteredRequests.map((req) => {
              const isDelivered = req.checkProcessingStatus === 'DELIVERED';
              const submittedDate = new Date(req.submittedAt);

              return (
                <div
                  key={req.requestId}
                  className="p-5 sm:p-6 hover:bg-slate-50/70 transition-colors space-y-4"
                >
                  {/* Top Row: Legal Name, Reference, Amount, Status */}
                  <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-black text-slate-950 flex items-center gap-1.5">
                          <User className="w-4 h-4 text-slate-500 shrink-0" />
                          <span>{req.fullLegalName}</span>
                        </span>
                        <span
                          className={`px-2.5 py-0.5 rounded-md font-mono font-bold text-[11px] uppercase ${
                            isDelivered
                              ? 'bg-emerald-100 text-emerald-900 border border-emerald-200'
                              : 'bg-amber-100 text-amber-900 border border-amber-200'
                          }`}
                        >
                          {req.checkProcessingStatus}
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-mono text-[11px] font-bold">
                          {req.sourceAccountType}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 font-mono">
                        <span>
                          Ref: <strong className="text-slate-950">{req.referenceNumber}</strong>
                        </span>
                        <span>•</span>
                        <span>
                          Account #: <strong className="text-slate-900">{req.customerAccountNumber}</strong>
                        </span>
                        <span>•</span>
                        <span>
                          UID: <strong className="text-slate-700">{req.userId}</strong>
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between lg:justify-end gap-4 shrink-0">
                      <div className="lg:text-right">
                        <div className="text-xl font-black text-slate-950 font-mono tabular-nums">
                          ${Number(req.amount).toLocaleString('en-US', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}{' '}
                          <span className="text-xs font-sans font-bold text-slate-500">USD</span>
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono tabular-nums flex items-center lg:justify-end gap-1 mt-0.5">
                          <Clock className="w-3 h-3" />
                          <span>
                            {submittedDate.toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })}{' '}
                            at{' '}
                            {submittedDate.toLocaleTimeString('en-US', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Protected Delivery & Contact Details Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                    <div className="space-y-0.5 min-w-0">
                      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono flex items-center gap-1">
                        <Landmark className="w-3 h-3" />
                        <span>Destination Bank</span>
                      </div>
                      <div className="font-bold text-slate-950 break-words">{req.bankName}</div>
                    </div>

                    <div className="space-y-0.5 min-w-0">
                      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono">
                        Destination Bank Account Number
                      </div>
                      <div className="font-bold text-slate-950 font-mono tabular-nums break-all">
                        {req.destinationBankAccountNumber || 'Not provided (legacy request)'}
                      </div>
                    </div>

                    <div className="space-y-0.5 min-w-0">
                      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono">
                        Destination Bank Routing Number
                      </div>
                      <div className="font-bold text-slate-950 font-mono tabular-nums break-all">
                        {req.destinationBankRoutingNumber || 'Not provided (legacy request)'}
                      </div>
                    </div>

                    <div className="space-y-0.5 min-w-0">
                      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        <span>Residential Address</span>
                      </div>
                      <div className="font-semibold text-slate-900 break-words">{req.residentialAddress}</div>
                    </div>

                    <div className="space-y-0.5 min-w-0">
                      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono flex items-center gap-1">
                        <Mail className="w-3 h-3" />
                        <span>Email Address</span>
                      </div>
                      <div className="font-semibold text-slate-900 break-all">{req.email}</div>
                    </div>

                    <div className="space-y-0.5 min-w-0">
                      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono flex items-center gap-1">
                        <Phone className="w-3 h-3" />
                        <span>Phone Number</span>
                      </div>
                      <div className="font-semibold text-slate-900 font-mono tabular-nums break-all">
                        {req.phoneNumber}
                      </div>
                    </div>
                  </div>

                  {/* Actions & Delivery Audit Footer */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <div className="text-xs text-slate-600">
                      {isDelivered ? (
                        <span className="inline-flex items-center gap-1.5 text-emerald-800 font-semibold">
                          <ShieldCheck className="w-4 h-4 text-emerald-700" />
                          <span>
                            Delivered{' '}
                            {req.deliveredAt
                              ? `on ${new Date(req.deliveredAt).toLocaleString('en-US')}`
                              : ''}
                            {req.deliveredByEmail ? ` by ${req.deliveredByEmail}` : ''}
                          </span>
                        </span>
                      ) : (
                        <span>
                          Estimated customer window: <strong>5 business days</strong> (customer debit already
                          completed permanently)
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0">
                      {!isDelivered && (
                        <button
                          type="button"
                          onClick={() => setConfirmTarget(req)}
                          disabled={isDelivering}
                          className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-black uppercase tracking-wider transition-colors cursor-pointer whitespace-nowrap"
                        >
                          MARK AS DELIVERED
                        </button>
                      )}

                      {/* Cancel button is intentionally rendered non-functional & permanently disabled per policy */}
                      <button
                        type="button"
                        disabled
                        aria-disabled="true"
                        title="Wire Check cancellations are disabled (permanent debit)"
                        className="px-3.5 py-2 rounded-xl bg-slate-100 border border-slate-200 text-slate-400 text-xs font-bold cursor-not-allowed opacity-60 whitespace-nowrap"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Confirmation Modal for MARK AS DELIVERED */}
      {confirmTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-wire-check-delivery-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs"
        >
          <div className="w-full max-w-lg bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <h3 id="confirm-wire-check-delivery-title" className="text-base font-black">
                  Confirm Wire Check Delivery
                </h3>
              </div>
              <button
                type="button"
                disabled={isDelivering}
                onClick={() => setConfirmTarget(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-xs sm:text-sm text-slate-700 leading-relaxed">
                Confirming marks this Wire Check withdrawal as <strong>DELIVERED</strong>, updates the customer&apos;s
                transaction record, and sends them an automatic in-app delivery notification. Customer account balances
                will not be modified.
              </p>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500 font-medium">Legal Name</span>
                  <span className="font-bold text-slate-950">{confirmTarget.fullLegalName}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500 font-medium">Destination Bank</span>
                  <span className="font-bold text-slate-950">{confirmTarget.bankName}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500 font-medium">Amount</span>
                  <span className="font-mono font-black text-slate-950 tabular-nums">
                    ${Number(confirmTarget.amount).toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    USD
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500 font-medium">Reference</span>
                  <span className="font-mono font-bold text-slate-900">{confirmTarget.referenceNumber}</span>
                </div>
                <div className="pt-1.5 border-t border-slate-200">
                  <span className="text-slate-500 font-medium block mb-0.5">Delivery Address</span>
                  <span className="font-semibold text-slate-900 break-words">
                    {confirmTarget.residentialAddress}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  disabled={isDelivering}
                  onClick={() => setConfirmTarget(null)}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  Close
                </button>
                <button
                  type="button"
                  disabled={isDelivering}
                  onClick={handleConfirmMarkDelivered}
                  className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-black uppercase tracking-wider flex items-center gap-2 cursor-pointer"
                >
                  {isDelivering ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Confirming Delivery...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Confirm &amp; Mark Delivered</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
