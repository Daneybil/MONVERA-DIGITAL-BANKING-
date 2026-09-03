import React, { useState } from 'react';
import { UserProfile } from '../../types';
import {
  ShieldCheck,
  ShieldAlert,
  Shield,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Search,
  ExternalLink,
  Eye,
  X,
  User,
  MapPin,
  FileText,
  Calendar,
} from 'lucide-react';
import { AdminConfirmationModal } from './AdminConfirmationModal';

interface AdminKycViewProps {
  customers: (UserProfile & { balanceMetrics?: any })[];
  onApproveKyc: (userId: string) => Promise<void>;
  onRejectKyc: (userId: string, reason: string) => Promise<void>;
  onSelectCustomer: (customer: UserProfile & { balanceMetrics?: any }) => void;
  onRefreshData?: () => Promise<void>;
}

export const AdminKycView: React.FC<AdminKycViewProps> = ({
  customers,
  onApproveKyc,
  onRejectKyc,
  onSelectCustomer,
  onRefreshData,
}) => {
  const [tab, setTab] = useState<'pending' | 'action_required' | 'verified' | 'unverified' | 'all'>('pending');
  const [search, setSearch] = useState('');
  const [zoomedImage, setZoomedImage] = useState<{ src: string; title: string } | null>(null);

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

  const pending = customers.filter((c) => c.kycStatus === 'pending');
  const actionRequired = customers.filter((c) => c.kycStatus === 'action_required');
  const verified = customers.filter((c) => c.kycStatus === 'verified');
  const unverified = customers.filter((c) => !c.kycStatus || c.kycStatus === 'unverified');

  const currentList =
    tab === 'pending'
      ? pending
      : tab === 'action_required'
      ? actionRequired
      : tab === 'verified'
      ? verified
      : tab === 'unverified'
      ? unverified
      : customers;

  const filtered = currentList.filter(
    (c) =>
      (c.firstName || '').toLowerCase().includes(search.toLowerCase()) ||
      (c.lastName || '').toLowerCase().includes(search.toLowerCase()) ||
      (c.email || '').toLowerCase().includes(search.toLowerCase()) ||
      (c.permanentAccountNumber || '').includes(search) ||
      (c.kycDocumentType && c.kycDocumentType.toLowerCase().includes(search.toLowerCase())) ||
      (c.kycCountry && c.kycCountry.toLowerCase().includes(search.toLowerCase())) ||
      (c.kycRejectionReason && c.kycRejectionReason.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">KYC Identity & Compliance Desk</h2>
          <p className="text-xs text-slate-500">
            FinCEN, BSA, and AML regulatory compliance adjudication and document inspection
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-xs font-bold text-amber-800 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-amber-600" />
            {pending.length} Pending
          </span>
          <span className="px-3 py-1.5 rounded-xl bg-rose-50 border border-rose-200 text-xs font-bold text-rose-800 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
            {actionRequired.length} Action Req
          </span>
          <span className="px-3 py-1.5 rounded-xl bg-blue-50 border border-blue-200 text-xs font-bold text-blue-800 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
            {verified.length} Verified
          </span>
          <span className="px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-700 flex items-center gap-1.5">
            <User className="w-3.5 h-3.5 text-slate-500" />
            {customers.length} Total
          </span>
        </div>
      </div>

      {/* Tabs & Search */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs flex-wrap">
          <button
            onClick={() => setTab('pending')}
            className={`px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5 ${
              tab === 'pending'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Clock className="w-3.5 h-3.5 text-amber-600" />
            Pending ({pending.length})
          </button>

          <button
            onClick={() => setTab('action_required')}
            className={`px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5 ${
              tab === 'action_required'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
            Action Required ({actionRequired.length})
          </button>

          <button
            onClick={() => setTab('verified')}
            className={`px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5 ${
              tab === 'verified'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
            Verified ({verified.length})
          </button>

          <button
            onClick={() => setTab('unverified')}
            className={`px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5 ${
              tab === 'unverified'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5 text-slate-400" />
            Unverified ({unverified.length})
          </button>

          <button
            onClick={() => setTab('all')}
            className={`px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5 ${
              tab === 'all'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Shield className="w-3.5 h-3.5 text-indigo-600" />
            All ({customers.length})
          </button>
        </div>

        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search applicants by name, country, document..."
            className="w-full pl-10 pr-4 py-2 text-xs rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-slate-900/10 focus:border-slate-800 text-slate-900 placeholder:text-slate-400"
          />
        </div>
      </div>

      {/* KYC Application Dossier Cards */}
      {filtered.length === 0 ? (
        <div className="bg-white p-12 text-center rounded-2xl border border-slate-200 text-slate-400 text-sm">
          No KYC applications in this view.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          {filtered.map((applicant) => {
            const isVerified = applicant.kycStatus === 'verified';
            const isPending = applicant.kycStatus === 'pending';
            const isActionRequired = applicant.kycStatus === 'action_required';

            return (
              <div
                key={applicant.id}
                className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 hover:shadow-md transition-shadow"
              >
                <div className="flex flex-col lg:flex-row items-start justify-between gap-6">
                  {/* Left: Applicant Information */}
                  <div className="space-y-4 flex-1">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-2xl bg-slate-900 text-amber-400 font-bold flex items-center justify-center text-base">
                        {applicant.firstName ? applicant.firstName[0] : 'U'}
                        {applicant.lastName ? applicant.lastName[0] : 'S'}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-base font-bold text-slate-900">
                            {applicant.firstName} {applicant.lastName}
                          </h3>
                          <span className="text-xs text-slate-400 font-mono">@{applicant.username}</span>
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                              isVerified
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : isPending
                                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                : isActionRequired
                                ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                : 'bg-slate-100 text-slate-700 border border-slate-200'
                            }`}
                          >
                            {isVerified
                              ? 'VERIFIED'
                              : isPending
                              ? 'PENDING REVIEW'
                              : isActionRequired
                              ? 'ACTION REQUIRED / REJECTED'
                              : 'UNVERIFIED'}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          Monvera Account: <strong className="font-mono text-slate-800">{applicant.permanentAccountNumber}</strong> • Registered: {new Date(applicant.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                    </div>

                    {/* Rejection / Compliance Notice Banner if rejected */}
                    {applicant.kycRejectionReason && (
                      <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2.5">
                        <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-bold block text-rose-900">Compliance Action Required Note:</span>
                          <span className="text-rose-700">{applicant.kycRejectionReason}</span>
                        </div>
                      </div>
                    )}

                    {/* Metadata Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs bg-slate-50/80 p-3.5 rounded-xl border border-slate-100">
                      <div>
                        <span className="text-slate-400 block font-medium">Document Type</span>
                        <span className="font-semibold text-slate-800 mt-0.5 block">
                          {applicant.kycDocumentType || 'Passport / National ID'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block font-medium">Document ID</span>
                        <span className="font-mono font-semibold text-slate-800 mt-0.5 block">
                          {applicant.kycDocumentNumber || 'Not Specified'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block font-medium">Country / Jurisdiction</span>
                        <span className="font-semibold text-slate-800 mt-0.5 block">
                          {applicant.kycCountry || applicant.country || 'United States'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block font-medium">Tax ID / SSN</span>
                        <span className="font-mono font-semibold text-slate-800 mt-0.5 block">
                          {applicant.kycSsn ? `•••-••-${applicant.kycSsn.slice(-4)}` : 'On File (W-8/W-9)'}
                        </span>
                      </div>
                      <div className="col-span-2 pt-2 border-t border-slate-200/60">
                        <span className="text-slate-400 block font-medium">Proof of Address Document</span>
                        <span className="font-semibold text-slate-800 mt-0.5 block">
                          {applicant.kycProofOfAddressType || (applicant.kycProofOfAddressImage ? 'Utility Bill / Bank Statement' : 'Standard Address Verification')}
                        </span>
                      </div>
                      <div className="col-span-2 pt-2 border-t border-slate-200/60">
                        <span className="text-slate-400 block font-medium">Residential Street Address</span>
                        <span className="font-semibold text-slate-800 mt-0.5 block">
                          {applicant.kycStreetAddress || 'Not Provided'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Document Inspection & Actions */}
                  <div className="w-full lg:w-96 space-y-4">
                    <div className="text-xs font-bold text-slate-700 flex items-center justify-between">
                      <span>Submitted Documents (Inspection)</span>
                      <span className="text-[10px] text-slate-400 font-normal">Click to enlarge</span>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      {/* Document 1: Government ID Front */}
                      <div
                        onClick={() => {
                          if (applicant.kycDocumentImage) {
                            setZoomedImage({
                              src: applicant.kycDocumentImage,
                              title: `Government ID (Front) - ${applicant.firstName} ${applicant.lastName}`,
                            });
                          }
                        }}
                        className={`group relative h-24 rounded-xl border border-slate-200 overflow-hidden bg-slate-100 shadow-xs flex flex-col items-center justify-center ${
                          applicant.kycDocumentImage ? 'cursor-pointer' : 'cursor-default opacity-80'
                        }`}
                      >
                        {applicant.kycDocumentImage ? (
                          <>
                            <img
                              src={applicant.kycDocumentImage}
                              alt="Government ID Front"
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                            />
                            <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[11px] font-semibold gap-1">
                              <Eye className="w-3.5 h-3.5" /> Inspect
                            </div>
                          </>
                        ) : (
                          <div className="flex flex-col items-center justify-center text-slate-400 p-2 text-center">
                            <FileText className="w-5 h-5 mb-1 text-slate-300" />
                            <span className="text-[10px] font-medium">Front Not Uploaded</span>
                          </div>
                        )}
                        <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded-md bg-slate-950/70 text-white text-[9px] font-bold">
                          1. ID Front
                        </span>
                      </div>

                      {/* Document 2: Government ID Back */}
                      <div
                        onClick={() => {
                          if (applicant.kycDocumentBackImage) {
                            setZoomedImage({
                              src: applicant.kycDocumentBackImage,
                              title: `Government ID (Back) - ${applicant.firstName} ${applicant.lastName}`,
                            });
                          }
                        }}
                        className={`group relative h-24 rounded-xl border border-slate-200 overflow-hidden bg-slate-100 shadow-xs flex flex-col items-center justify-center ${
                          applicant.kycDocumentBackImage ? 'cursor-pointer' : 'cursor-default opacity-80'
                        }`}
                      >
                        {applicant.kycDocumentBackImage ? (
                          <>
                            <img
                              src={applicant.kycDocumentBackImage}
                              alt="Government ID Back"
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                            />
                            <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[11px] font-semibold gap-1">
                              <Eye className="w-3.5 h-3.5" /> Inspect
                            </div>
                          </>
                        ) : (
                          <div className="flex flex-col items-center justify-center text-slate-400 p-2 text-center">
                            <FileText className="w-5 h-5 mb-1 text-slate-300" />
                            <span className="text-[10px] font-medium">Back Not Uploaded</span>
                          </div>
                        )}
                        <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded-md bg-slate-950/70 text-white text-[9px] font-bold">
                          2. ID Back
                        </span>
                      </div>

                      {/* Document 3: Biometric Liveness Selfie */}
                      <div
                        onClick={() => {
                          const selfieSrc = applicant.kycLiveSelfieImage || applicant.avatarUrl;
                          if (selfieSrc) {
                            setZoomedImage({
                              src: selfieSrc,
                              title: `Live Biometric Selfie - ${applicant.firstName} ${applicant.lastName}`,
                            });
                          }
                        }}
                        className={`group relative h-24 rounded-xl border border-slate-200 overflow-hidden bg-slate-100 shadow-xs flex flex-col items-center justify-center ${
                          applicant.kycLiveSelfieImage || applicant.avatarUrl ? 'cursor-pointer' : 'cursor-default opacity-80'
                        }`}
                      >
                        {applicant.kycLiveSelfieImage || applicant.avatarUrl ? (
                          <>
                            <img
                              src={applicant.kycLiveSelfieImage || applicant.avatarUrl}
                              alt="Biometric Selfie"
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                            />
                            <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[11px] font-semibold gap-1">
                              <Eye className="w-3.5 h-3.5" /> Inspect
                            </div>
                          </>
                        ) : (
                          <div className="flex flex-col items-center justify-center text-slate-400 p-2 text-center">
                            <User className="w-5 h-5 mb-1 text-slate-300" />
                            <span className="text-[10px] font-medium">Selfie Not Uploaded</span>
                          </div>
                        )}
                        <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded-md bg-slate-950/70 text-white text-[9px] font-bold">
                          3. Biometric Selfie
                        </span>
                      </div>

                      {/* Document 4: Proof of Address */}
                      <div
                        onClick={() => {
                          if (applicant.kycProofOfAddressImage) {
                            setZoomedImage({
                              src: applicant.kycProofOfAddressImage,
                              title: `Proof of Address (${applicant.kycProofOfAddressType || 'Utility / Statement'}) - ${applicant.firstName} ${applicant.lastName}`,
                            });
                          }
                        }}
                        className={`group relative h-24 rounded-xl border border-slate-200 overflow-hidden bg-slate-100 shadow-xs flex flex-col items-center justify-center ${
                          applicant.kycProofOfAddressImage ? 'cursor-pointer' : 'cursor-default opacity-80'
                        }`}
                      >
                        {applicant.kycProofOfAddressImage ? (
                          <>
                            <img
                              src={applicant.kycProofOfAddressImage}
                              alt="Proof of Address"
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                            />
                            <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[11px] font-semibold gap-1">
                              <Eye className="w-3.5 h-3.5" /> Inspect
                            </div>
                          </>
                        ) : (
                          <div className="flex flex-col items-center justify-center text-slate-400 p-2 text-center">
                            <MapPin className="w-5 h-5 mb-1 text-slate-300" />
                            <span className="text-[10px] font-medium">Address Doc Not Uploaded</span>
                          </div>
                        )}
                        <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded-md bg-slate-950/70 text-white text-[9px] font-bold">
                          4. Proof of Address
                        </span>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={() => onSelectCustomer(applicant)}
                        className="flex-1 py-2 px-3 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                      >
                        View Full Dossier
                      </button>

                      {!isVerified ? (
                        <>
                          <button
                            onClick={() => {
                              setConfirmConfig({
                                isOpen: true,
                                title: 'Reject KYC Application',
                                description: `You are rejecting the verification application for ${applicant.firstName} ${applicant.lastName}. A formal notice will be sent to the customer requesting document resubmission.`,
                                confirmLabel: 'Reject KYC Application',
                                variant: 'danger',
                                targetName: `${applicant.firstName} ${applicant.lastName} (${applicant.permanentAccountNumber})`,
                                action: async (reason) => {
                                  await onRejectKyc(applicant.id, reason);
                                  if (onRefreshData) await onRefreshData();
                                },
                              });
                            }}
                            className="py-2 px-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 text-xs font-semibold transition-colors"
                          >
                            Reject
                          </button>

                          <button
                            onClick={() => {
                              setConfirmConfig({
                                isOpen: true,
                                title: 'Approve KYC Verification',
                                description: `Approve regulatory verification for ${applicant.firstName} ${applicant.lastName}. This unlocks Tier 3 verified status and the full $1,000,000 daily transaction limit.`,
                                confirmLabel: 'Approve & Verify',
                                variant: 'primary',
                                targetName: `${applicant.firstName} ${applicant.lastName} (${applicant.permanentAccountNumber})`,
                                action: async () => {
                                  await onApproveKyc(applicant.id);
                                  if (onRefreshData) await onRefreshData();
                                },
                              });
                            }}
                            className="py-2 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors shadow-sm shadow-emerald-600/20"
                          >
                            Approve
                          </button>
                        </>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="text-xs text-emerald-700 font-semibold flex items-center gap-1">
                            <CheckCircle2 className="w-4 h-4" /> Verified
                          </div>
                          <button
                            onClick={() => {
                              setConfirmConfig({
                                isOpen: true,
                                title: 'Re-evaluate / Reject KYC Status',
                                description: `Revoke verified status for ${applicant.firstName} ${applicant.lastName} and set status to Action Required.`,
                                confirmLabel: 'Revoke & Reject',
                                variant: 'danger',
                                targetName: `${applicant.firstName} ${applicant.lastName} (${applicant.permanentAccountNumber})`,
                                action: async (reason) => {
                                  await onRejectKyc(applicant.id, reason);
                                  if (onRefreshData) await onRefreshData();
                                },
                              });
                            }}
                            className="py-1.5 px-2.5 rounded-lg border border-rose-200 text-[11px] text-rose-700 hover:bg-rose-50 transition-colors"
                          >
                            Revoke
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Image Inspection Zoom Modal */}
      {zoomedImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-4 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-bold text-slate-900">{zoomedImage.title}</h4>
              <button
                onClick={() => setZoomedImage(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="max-h-[70vh] overflow-hidden rounded-xl bg-slate-950 flex items-center justify-center">
              <img
                src={zoomedImage.src}
                alt={zoomedImage.title}
                className="w-full h-auto max-h-[70vh] object-contain"
              />
            </div>
          </div>
        </div>
      )}

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
