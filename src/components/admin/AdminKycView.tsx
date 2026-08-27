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
  const [tab, setTab] = useState<'pending' | 'verified' | 'unverified'>('pending');
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
  const verified = customers.filter((c) => c.kycStatus === 'verified');
  const unverified = customers.filter((c) => !c.kycStatus || c.kycStatus === 'unverified');

  const currentList = tab === 'pending' ? pending : tab === 'verified' ? verified : unverified;

  const filtered = currentList.filter(
    (c) =>
      (c.firstName || '').toLowerCase().includes(search.toLowerCase()) ||
      (c.lastName || '').toLowerCase().includes(search.toLowerCase()) ||
      (c.email || '').toLowerCase().includes(search.toLowerCase()) ||
      (c.permanentAccountNumber || '').includes(search) ||
      (c.kycDocumentType && c.kycDocumentType.toLowerCase().includes(search.toLowerCase())) ||
      (c.kycCountry && c.kycCountry.toLowerCase().includes(search.toLowerCase()))
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

        <div className="flex items-center gap-2">
          <span className="px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-xs font-bold text-amber-800 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-amber-600" />
            {pending.length} Pending Review
          </span>
          <span className="px-3 py-1.5 rounded-xl bg-blue-50 border border-blue-200 text-xs font-bold text-blue-800 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
            {verified.length} Verified
          </span>
        </div>
      </div>

      {/* Tabs & Search */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs">
          <button
            onClick={() => setTab('pending')}
            className={`px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5 ${
              tab === 'pending'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Clock className="w-3.5 h-3.5 text-amber-600" />
            Pending Review ({pending.length})
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
            Approved & Verified ({verified.length})
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
                        {applicant.firstName[0]}
                        {applicant.lastName[0]}
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
                                : 'bg-slate-100 text-slate-700 border border-slate-200'
                            }`}
                          >
                            {applicant.kycStatus ? applicant.kycStatus.toUpperCase() : 'UNVERIFIED'}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          Monvera Account: <strong className="font-mono text-slate-800">{applicant.permanentAccountNumber}</strong> • Registered: {new Date(applicant.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                    </div>

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
                          {applicant.kycDocumentNumber || 'P884910283'}
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
                      <div className="col-span-2 sm:col-span-4 pt-2 border-t border-slate-200/60">
                        <span className="text-slate-400 block font-medium">Residential Street Address</span>
                        <span className="font-semibold text-slate-800 mt-0.5 block">
                          {applicant.kycStreetAddress || '450 Lexington Ave, Suite 2400, New York, NY 10017'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Document Inspection & Actions */}
                  <div className="w-full lg:w-96 space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      {/* ID Photo */}
                      <div
                        onClick={() =>
                          setZoomedImage({
                            src: applicant.kycDocumentImage || 'https://images.unsplash.com/photo-1544717305-2782549b5136?w=600&auto=format&fit=crop&q=80',
                            title: `Government Document - ${applicant.firstName} ${applicant.lastName}`,
                          })
                        }
                        className="group relative h-28 rounded-xl border border-slate-200 overflow-hidden bg-slate-100 cursor-pointer shadow-xs"
                      >
                        <img
                          src={applicant.kycDocumentImage || 'https://images.unsplash.com/photo-1544717305-2782549b5136?w=600&auto=format&fit=crop&q=80'}
                          alt="Government Document"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        />
                        <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-semibold gap-1">
                          <Eye className="w-4 h-4" /> Inspect
                        </div>
                        <span className="absolute bottom-1.5 left-1.5 px-2 py-0.5 rounded-md bg-slate-950/70 text-white text-[10px] font-bold">
                          Document
                        </span>
                      </div>

                      {/* Selfie Photo */}
                      <div
                        onClick={() =>
                          setZoomedImage({
                            src: applicant.kycLiveSelfieImage || applicant.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=600&auto=format&fit=crop&q=80',
                            title: `Live Biometric Selfie - ${applicant.firstName} ${applicant.lastName}`,
                          })
                        }
                        className="group relative h-28 rounded-xl border border-slate-200 overflow-hidden bg-slate-100 cursor-pointer shadow-xs"
                      >
                        <img
                          src={applicant.kycLiveSelfieImage || applicant.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=600&auto=format&fit=crop&q=80'}
                          alt="Biometric Selfie"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        />
                        <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-semibold gap-1">
                          <Eye className="w-4 h-4" /> Inspect
                        </div>
                        <span className="absolute bottom-1.5 left-1.5 px-2 py-0.5 rounded-md bg-slate-950/70 text-white text-[10px] font-bold">
                          Live Biometric
                        </span>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-2 pt-2">
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
                        <div className="text-xs text-emerald-700 font-semibold flex items-center gap-1">
                          <CheckCircle2 className="w-4 h-4" /> Verified
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
