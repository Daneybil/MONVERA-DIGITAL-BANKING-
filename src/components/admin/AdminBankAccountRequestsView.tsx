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

export const AdminBankAccountRequestsView: React.FC = () => {
  const [applications, setApplications] = useState<LinkedBankAccountApplication[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'pending' | 'approved' | 'rejected'>('ALL');
  const [selectedApp, setSelectedApp] = useState<LinkedBankAccountApplication | null>(null);
  const [inspectModalOpen, setInspectModalOpen] = useState<boolean>(false);

  // Approval / Rejection modal state
  const [actionModal, setActionModal] = useState<{
    type: 'APPROVE' | 'REJECT';
    app: LinkedBankAccountApplication;
  } | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string>('');
  const [isSubmittingAction, setIsSubmittingAction] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadRequests = async () => {
    setIsLoading(true);
    try {
      const res = await api.getAdminBankAccountApplications();
      if (res.success && res.applications) {
        setApplications(res.applications);
      }
    } catch (err) {
      console.error('[AdminBankAccountRequestsView] Error loading requests:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRequests();
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
    if (statusFilter !== 'ALL' && app.status !== statusFilter) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      app.customerName.toLowerCase().includes(q) ||
      app.customerAccountNumber.toLowerCase().includes(q) ||
      app.bankName.toLowerCase().includes(q) ||
      app.accountHolderName.toLowerCase().includes(q) ||
      app.userId.toLowerCase().includes(q) ||
      (app.iban && app.iban.toLowerCase().includes(q)) ||
      (app.maskedAccountNumber && app.maskedAccountNumber.toLowerCase().includes(q))
    );
  });

  const pendingCount = applications.filter((a) => a.status === 'pending').length;
  const approvedCount = applications.filter((a) => a.status === 'approved').length;
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
              onClick={loadRequests}
              disabled={isLoading}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-colors flex items-center gap-2 border border-slate-700 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-amber-400' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Aggregate Counters */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-6 border-t border-slate-800/80">
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
          <div className="p-3.5 rounded-2xl bg-emerald-950/30 border border-emerald-500/30">
            <div className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              Approved
            </div>
            <div className="text-2xl font-black font-mono text-emerald-400 mt-1">{approvedCount}</div>
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
          {(['ALL', 'pending', 'approved', 'rejected'] as const).map((st) => (
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

      {/* Applications Table / Cards */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="py-20 text-center space-y-3">
            <div className="w-8 h-8 border-3 border-amber-500 border-t-transparent animate-spin rounded-full mx-auto" />
            <p className="text-xs font-bold text-slate-500">Loading bank approval applications...</p>
          </div>
        ) : filteredApps.length === 0 ? (
          <div className="py-16 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
              <Landmark className="w-6 h-6" />
            </div>
            <div className="font-black text-slate-900 text-sm">No Bank Account Requests Found</div>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              {searchQuery
                ? 'No bank account applications match your active search filters.'
                : 'Customers have not submitted any manual bank account linking applications yet.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="px-5 py-4">Customer</th>
                  <th className="px-5 py-4">Bank & Country</th>
                  <th className="px-5 py-4">Account Holder</th>
                  <th className="px-5 py-4">Account Number / IBAN</th>
                  <th className="px-5 py-4">Contact Info</th>
                  <th className="px-5 py-4">Submitted</th>
                  <th className="px-5 py-4 text-center">Status</th>
                  <th className="px-5 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {filteredApps.map((app) => {
                  const isPending = app.status === 'pending';
                  const isApproved = app.status === 'approved';
                  const isRejected = app.status === 'rejected';

                  return (
                    <tr key={app.id} className="hover:bg-slate-50/70 transition-colors">
                      {/* Customer Info */}
                      <td className="px-5 py-4">
                        <div className="font-black text-slate-950 text-sm">{app.customerName}</div>
                        <div className="font-mono text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                          <Hash className="w-3 h-3 text-slate-400" />
                          <span>MVB: {app.customerAccountNumber}</span>
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono truncate max-w-[140px]" title={app.userId}>
                          UID: {app.userId.slice(0, 10)}...
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
                      </td>

                      {/* Account / IBAN */}
                      <td className="px-5 py-4">
                        <div className="font-mono font-bold text-slate-900">{app.maskedAccountNumber}</div>
                        {app.maskedIban && (
                          <div className="font-mono text-[11px] text-slate-500 mt-0.5">
                            IBAN: {app.maskedIban}
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
                        {isPending && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-300">
                            <Clock className="w-3 h-3 text-amber-600" />
                            Pending
                          </span>
                        )}
                        {isApproved && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-300">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            Approved
                          </span>
                        )}
                        {isRejected && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-100 text-rose-800 border border-rose-300">
                            <XCircle className="w-3 h-3 text-rose-600" />
                            Rejected
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
                    <span className="text-slate-400 block text-[10px]">Masked Account Number</span>
                    <strong className="font-mono text-slate-950">{selectedApp.maskedAccountNumber}</strong>
                  </div>
                  {selectedApp.iban && (
                    <div className="col-span-2">
                      <span className="text-slate-400 block text-[10px]">IBAN</span>
                      <strong className="font-mono text-slate-950">{selectedApp.iban}</strong>
                    </div>
                  )}
                  {selectedApp.swiftBic && (
                    <div>
                      <span className="text-slate-400 block text-[10px]">SWIFT / BIC Code</span>
                      <strong className="font-mono text-slate-950">{selectedApp.swiftBic}</strong>
                    </div>
                  )}
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
                      <span className="text-slate-500 block">Rejection Reason:</span>
                      <span className="font-semibold text-rose-800">{selectedApp.rejectionReason}</span>
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

      {/* APPROVE / REJECT CONFIRMATION MODAL */}
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
                    ? 'Verify and activate this bank account for withdrawals'
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
                  {actionModal.app.bankName} ({actionModal.app.maskedAccountNumber})
                </strong>
              </div>
              <div>
                <span className="text-slate-400">Beneficiary:</span>{' '}
                <strong className="text-slate-950">{actionModal.app.accountHolderName}</strong>
              </div>
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
