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
  EyeOff,
  X,
  User,
  MapPin,
  FileText,
  Calendar,
  Mail,
  Phone,
  Building2,
  Check,
  CreditCard,
} from 'lucide-react';
import { AdminConfirmationModal } from './AdminConfirmationModal';

interface AdminKycViewProps {
  customers: (UserProfile & { balanceMetrics?: any })[];
  onApproveKyc: (userId: string, applicant?: any) => Promise<void>;
  onRejectKyc: (userId: string, reason: string, applicant?: any) => Promise<void>;
  onReviewKycItem?: (
    userId: string,
    itemName: 'identity' | 'proofOfAddress' | 'liveness' | 'ssn',
    status: 'approved' | 'rejected',
    reason?: string,
    applicant?: any
  ) => Promise<void>;
  onSelectCustomer: (customer: UserProfile & { balanceMetrics?: any }) => void;
  onRefreshData?: () => Promise<void>;
}

export const AdminKycView: React.FC<AdminKycViewProps> = ({
  customers,
  onApproveKyc,
  onRejectKyc,
  onReviewKycItem,
  onSelectCustomer,
  onRefreshData,
}) => {
  const [tab, setTab] = useState<'pending' | 'action_required' | 'verified' | 'unverified' | 'all'>('pending');
  const [search, setSearch] = useState('');
  const [zoomedImage, setZoomedImage] = useState<{ src: string; title: string } | null>(null);
  const [revealedSsnMap, setRevealedSsnMap] = useState<Record<string, boolean>>({});

  // Confirmation modal state
  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    variant: 'danger' | 'warning' | 'primary';
    requireReason: boolean;
    targetName: string;
    action: (reason: string) => Promise<void>;
  }>({
    isOpen: false,
    title: '',
    description: '',
    confirmLabel: '',
    variant: 'primary',
    requireReason: true,
    targetName: '',
    action: async () => {},
  });

  const toggleSsnVisibility = (userId: string) => {
    setRevealedSsnMap((prev) => ({
      ...prev,
      [userId]: !prev[userId],
    }));
  };

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

  const filtered = currentList.filter((c) => {
    const term = search.toLowerCase();
    const fullName = `${c.kycFullName || ''} ${c.firstName || ''} ${c.lastName || ''}`.toLowerCase();
    const email = (c.kycEmail || c.email || '').toLowerCase();
    const phone = (c.kycPhone || c.phone || '').toLowerCase();
    const acc = (c.permanentAccountNumber || '').toLowerCase();
    const docType = (c.kycDocumentType || '').toLowerCase();
    const docNum = (c.kycDocumentNumber || '').toLowerCase();
    const country = (c.kycCountry || c.country || '').toLowerCase();
    const address = (c.kycStreetAddress || c.streetAddress || (c as any).address || '').toLowerCase();

    return (
      fullName.includes(term) ||
      email.includes(term) ||
      phone.includes(term) ||
      acc.includes(term) ||
      docType.includes(term) ||
      docNum.includes(term) ||
      country.includes(term) ||
      address.includes(term)
    );
  });

  const handleApproveSingleItem = async (
    userId: string,
    itemName: 'identity' | 'proofOfAddress' | 'liveness' | 'ssn',
    customerName: string
  ) => {
    if (!onReviewKycItem) return;
    const applicant = customers.find((c) => c.id === userId);
    try {
      await onReviewKycItem(userId, itemName, 'approved', undefined, applicant);
      if (onRefreshData) onRefreshData().catch(() => {});
    } catch (err) {
      console.error('Failed to approve KYC item:', err);
    }
  };

  const handleRejectSingleItemPrompt = (
    userId: string,
    itemName: 'identity' | 'proofOfAddress' | 'liveness' | 'ssn',
    customerName: string
  ) => {
    const itemFriendlyNames: Record<string, string> = {
      identity: 'Government Identification Document',
      proofOfAddress: 'Proof of Address Document',
      liveness: 'Biometric Liveness Selfie',
      ssn: 'Social Security / Tax ID Document',
    };
    const friendlyName = itemFriendlyNames[itemName] || itemName;
    const applicant = customers.find((c) => c.id === userId);

    setConfirmConfig({
      isOpen: true,
      title: `Reject ${friendlyName}`,
      description: `Specify the compliance reason for rejecting only the ${friendlyName} for ${customerName}. The applicant will be notified immediately to re-upload only this document.`,
      confirmLabel: `Reject ${friendlyName}`,
      variant: 'danger',
      requireReason: true,
      targetName: `${customerName} (${friendlyName})`,
      action: async (reason: string) => {
        if (onReviewKycItem) {
          await onReviewKycItem(userId, itemName, 'rejected', reason, applicant);
          if (onRefreshData) onRefreshData().catch(() => {});
        }
      },
    });
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">KYC Identity & Compliance Desk</h2>
          <p className="text-xs text-slate-500">
            FinCEN, BSA, and AML regulatory compliance adjudication, granular document review, and limit management
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
            className={`px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
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
            className={`px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
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
            className={`px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
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
            className={`px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
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
            className={`px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
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
            placeholder="Search by full legal name, ID, phone, address..."
            className="w-full pl-10 pr-4 py-2 text-xs rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-slate-900/10 focus:border-slate-800 text-slate-900 placeholder:text-slate-400"
          />
        </div>
      </div>

      {/* KYC Application Dossier Cards */}
      {filtered.length === 0 ? (
        <div className="bg-white p-12 text-center rounded-2xl border border-slate-200 text-slate-400 text-sm">
          No KYC applications match the current filter.
        </div>
      ) : (
        <div className="space-y-6">
          {filtered.map((applicant) => {
            const isVerified = applicant.kycStatus === 'verified';
            const isPending = applicant.kycStatus === 'pending';
            const isActionRequired = applicant.kycStatus === 'action_required';

            const fullLegalName =
              applicant.kycFullName ||
              `${applicant.firstName || ''} ${applicant.lastName || ''}`.trim() ||
              'Not Specified';

            const isUS =
              (applicant.kycCountry || applicant.country || '').toLowerCase().includes('united states') ||
              (applicant.kycCountry || applicant.country || '').toUpperCase() === 'US' ||
              (applicant.kycCountry || applicant.country || '').toUpperCase() === 'USA';

            const isPassport =
              (applicant.kycDocumentType || '').toLowerCase().includes('passport');

            const reviews = applicant.kycItemReviews || {};
            const identityStatus = reviews.identity?.status || (isVerified ? 'approved' : 'pending');
            const addressStatus = reviews.proofOfAddress?.status || (isVerified ? 'approved' : 'pending');
            const livenessStatus = reviews.liveness?.status || (isVerified ? 'approved' : 'pending');
            const ssnStatus = reviews.ssn?.status || (isVerified ? 'approved' : 'pending');

            const isSsnRevealed = !!revealedSsnMap[applicant.id];
            const rawSsn = applicant.kycSsn || '';
            const displaySsn = rawSsn
              ? isSsnRevealed
                ? rawSsn
                : `•••-••-${rawSsn.slice(-4)}`
              : 'Not Provided';

            return (
              <div
                key={applicant.id}
                className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden divide-y divide-slate-100"
              >
                {/* 1. Header Bar with User Identity & Status */}
                <div className="p-5 bg-slate-50/60 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5">
                    <div className="w-12 h-12 rounded-2xl bg-slate-900 text-amber-400 font-black flex items-center justify-center text-base shrink-0 shadow-xs">
                      {applicant.firstName ? applicant.firstName[0].toUpperCase() : 'U'}
                      {applicant.lastName ? applicant.lastName[0].toUpperCase() : 'S'}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-base font-black text-slate-900 tracking-tight">
                          {fullLegalName}
                        </h3>
                        <span className="text-xs text-slate-400 font-mono">@{applicant.username}</span>
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-xs font-black border ${
                            isVerified
                              ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                              : isPending
                              ? 'bg-amber-100 text-amber-950 border-amber-300'
                              : isActionRequired
                              ? 'bg-rose-100 text-rose-950 border-rose-300'
                              : 'bg-slate-100 text-slate-700 border-slate-300'
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
                      <div className="text-xs text-slate-500 mt-1 flex items-center gap-3 flex-wrap">
                        <span>
                          Monvera Account: <strong className="font-mono text-slate-800">{applicant.permanentAccountNumber}</strong>
                        </span>
                        {applicant.kycSubmittedAt && (
                          <span>
                            Submitted: <strong className="text-slate-700">{new Date(applicant.kycSubmittedAt).toLocaleString()}</strong>
                          </span>
                        )}
                        {applicant.kycVerifiedAt && (
                          <span>
                            Verified At: <strong className="text-emerald-700">{new Date(applicant.kycVerifiedAt).toLocaleString()}</strong>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Overall Quick Actions */}
                  <div className="flex items-center gap-2 self-end md:self-center">
                    <button
                      onClick={() => onSelectCustomer(applicant)}
                      className="px-3 py-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                      View Customer File
                    </button>
                  </div>
                </div>

                {/* 2. Rejection Banner if action required */}
                {applicant.kycRejectionReason && (
                  <div className="p-4 bg-rose-50 border-y border-rose-200 text-xs text-rose-900 flex items-start gap-3">
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-black block text-rose-950 uppercase tracking-wide">
                        Compliance Action Required Notice:
                      </span>
                      <p className="mt-0.5 text-rose-800 font-medium leading-relaxed">
                        {applicant.kycRejectionReason}
                      </p>
                    </div>
                  </div>
                )}

                {/* 3. Complete Applicant Information Dossier Grid */}
                <div className="p-5 space-y-3 bg-white">
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-slate-500" />
                    Full Applicant Provided Information
                  </h4>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 text-xs">
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
                      <span className="text-slate-400 font-bold block">Full Legal Name</span>
                      <span className="font-black text-slate-900 text-sm mt-0.5 block">{fullLegalName}</span>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
                      <span className="text-slate-400 font-bold block">Date of Birth</span>
                      <span className="font-extrabold text-slate-900 text-sm mt-0.5 block">
                        {applicant.kycDateOfBirth || applicant.dateOfBirth || 'Not Specified'}
                      </span>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
                      <span className="text-slate-400 font-bold block">Email Address</span>
                      <span className="font-bold text-slate-900 text-xs mt-1 block truncate">
                        {applicant.kycEmail || applicant.email || 'Not Specified'}
                      </span>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
                      <span className="text-slate-400 font-bold block">Phone Number</span>
                      <span className="font-bold text-slate-900 text-xs mt-1 block">
                        {applicant.kycPhone || applicant.phone || 'Not Specified'}
                      </span>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
                      <span className="text-slate-400 font-bold block">Country / Jurisdiction</span>
                      <span className="font-extrabold text-slate-900 text-sm mt-0.5 block">
                        {applicant.kycCountry || applicant.country || 'United States'}
                      </span>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
                      <span className="text-slate-400 font-bold block">Document Type & Number</span>
                      <span className="font-bold text-slate-900 text-xs mt-0.5 block">
                        {applicant.kycDocumentType || "Driver's License / Passport"}
                      </span>
                      <span className="font-mono font-black text-slate-700 text-xs block mt-0.5">
                        ID: {applicant.kycDocumentNumber || 'Not Specified'}
                      </span>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
                      <span className="text-slate-400 font-bold block">Proof of Address Document</span>
                      <span className="font-bold text-slate-900 text-xs mt-0.5 block">
                        {applicant.kycProofOfAddressType || (applicant.kycProofOfAddressImage ? 'Utility Bill / Bank Statement' : 'Standard')}
                      </span>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400 font-bold block">SSN / Tax Identification</span>
                        {rawSsn && (
                          <button
                            type="button"
                            onClick={() => toggleSsnVisibility(applicant.id)}
                            className="text-slate-500 hover:text-slate-800 transition-colors p-0.5 cursor-pointer"
                            title={isSsnRevealed ? 'Mask SSN' : 'Reveal SSN'}
                          >
                            {isSsnRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                        )}
                      </div>
                      <span className="font-mono font-black text-slate-900 text-sm mt-0.5 block">
                        {displaySsn}
                      </span>
                    </div>

                    <div className="sm:col-span-2 md:col-span-3 lg:col-span-4 p-3 bg-slate-50 rounded-xl border border-slate-200/80">
                      <span className="text-slate-400 font-bold block">Residential Street Address</span>
                      <span className="font-extrabold text-slate-900 text-xs mt-0.5 block">
                        {applicant.kycStreetAddress || applicant.streetAddress || (applicant as any).address || 'No residential address on file'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 4. Complete Uploaded Document Inspection & Granular Action Controls */}
                <div className="p-5 space-y-4 bg-slate-50/40">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-slate-500" />
                      Submitted Documents Inspection & Granular Adjudication
                    </h4>
                    <span className="text-[11px] text-slate-400 font-medium">Click any document to inspect full-screen</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {/* ITEM 1: IDENTITY DOCUMENT (FRONT & BACK) */}
                    <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between space-y-3">
                      <div>
                        <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-slate-100">
                          <div className="flex items-center gap-2">
                            <FileText className="w-4 h-4 text-indigo-600 shrink-0" />
                            <span className="text-xs font-black text-slate-900 uppercase">
                              1. ID ({applicant.kycDocumentType || 'Govt ID'})
                            </span>
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded-md text-[10px] font-black border ${
                              identityStatus === 'approved'
                                ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                                : identityStatus === 'rejected'
                                ? 'bg-rose-100 text-rose-950 border-rose-300'
                                : 'bg-amber-100 text-amber-950 border-amber-300'
                            }`}
                          >
                            {identityStatus.toUpperCase()}
                          </span>
                        </div>

                        {reviews.identity?.reason && (
                          <div className="mt-2 p-2 rounded-lg bg-rose-50 text-[11px] text-rose-900 font-semibold border border-rose-200">
                            <strong>Reject Note:</strong> {reviews.identity.reason}
                          </div>
                        )}

                        <div className="grid grid-cols-2 gap-2 mt-3">
                          {/* Front Photo */}
                          <div
                            onClick={() => {
                              if (applicant.kycDocumentImage) {
                                setZoomedImage({
                                  src: applicant.kycDocumentImage,
                                  title: `Government ID (Front) - ${fullLegalName}`,
                                });
                              }
                            }}
                            className={`group relative h-28 rounded-xl border border-slate-200 overflow-hidden bg-slate-100 flex flex-col items-center justify-center ${
                              applicant.kycDocumentImage ? 'cursor-pointer hover:border-slate-400' : 'opacity-70 cursor-default'
                            }`}
                          >
                            {applicant.kycDocumentImage ? (
                              <>
                                <img
                                  src={applicant.kycDocumentImage}
                                  alt="ID Front"
                                  className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                                />
                                <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[10px] font-bold gap-1">
                                  <Eye className="w-3.5 h-3.5" /> Inspect Front
                                </div>
                              </>
                            ) : (
                              <div className="text-center p-2 text-slate-400 text-[10px]">
                                <FileText className="w-5 h-5 mx-auto mb-1 text-slate-300" />
                                No Front Photo
                              </div>
                            )}
                            <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-slate-950/70 text-white text-[9px] font-black">
                              Front
                            </span>
                          </div>

                          {/* Back Photo */}
                          <div
                            onClick={() => {
                              if (applicant.kycDocumentBackImage) {
                                setZoomedImage({
                                  src: applicant.kycDocumentBackImage,
                                  title: `Government ID (Back) - ${fullLegalName}`,
                                });
                              }
                            }}
                            className={`group relative h-28 rounded-xl border border-slate-200 overflow-hidden bg-slate-100 flex flex-col items-center justify-center ${
                              applicant.kycDocumentBackImage ? 'cursor-pointer hover:border-slate-400' : 'opacity-70 cursor-default'
                            }`}
                          >
                            {applicant.kycDocumentBackImage ? (
                              <>
                                <img
                                  src={applicant.kycDocumentBackImage}
                                  alt="ID Back"
                                  className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                                />
                                <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[10px] font-bold gap-1">
                                  <Eye className="w-3.5 h-3.5" /> Inspect Back
                                </div>
                              </>
                            ) : (
                              <div className="text-center p-2 text-slate-400 text-[10px]">
                                <FileText className="w-5 h-5 mx-auto mb-1 text-slate-300" />
                                {isPassport ? 'Passport (No back)' : 'No Back Photo'}
                              </div>
                            )}
                            <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-slate-950/70 text-white text-[9px] font-black">
                              Back
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Granular Approve / Reject for Identity */}
                      {onReviewKycItem && (
                        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                          <button
                            type="button"
                            onClick={() => handleRejectSingleItemPrompt(applicant.id, 'identity', fullLegalName)}
                            className="px-2.5 py-1 text-[11px] font-extrabold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors cursor-pointer"
                          >
                            Reject ID
                          </button>
                          <button
                            type="button"
                            onClick={() => handleApproveSingleItem(applicant.id, 'identity', fullLegalName)}
                            className="px-3 py-1 text-[11px] font-extrabold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors cursor-pointer flex items-center gap-1 shadow-xs"
                          >
                            <Check className="w-3 h-3" /> Approve ID
                          </button>
                        </div>
                      )}
                    </div>

                    {/* ITEM 2: BIOMETRIC LIVENESS SELFIE */}
                    <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between space-y-3">
                      <div>
                        <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-slate-100">
                          <div className="flex items-center gap-2">
                            <User className="w-4 h-4 text-emerald-600 shrink-0" />
                            <span className="text-xs font-black text-slate-900 uppercase">
                              2. Biometric Liveness Selfie
                            </span>
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded-md text-[10px] font-black border ${
                              livenessStatus === 'approved'
                                ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                                : livenessStatus === 'rejected'
                                ? 'bg-rose-100 text-rose-950 border-rose-300'
                                : 'bg-amber-100 text-amber-950 border-amber-300'
                            }`}
                          >
                            {livenessStatus.toUpperCase()}
                          </span>
                        </div>

                        {reviews.liveness?.reason && (
                          <div className="mt-2 p-2 rounded-lg bg-rose-50 text-[11px] text-rose-900 font-semibold border border-rose-200">
                            <strong>Reject Note:</strong> {reviews.liveness.reason}
                          </div>
                        )}

                        <div className="mt-3">
                          {/* Selfie Photo */}
                          <div
                            onClick={() => {
                              const selfieSrc = applicant.kycLiveSelfieImage || applicant.avatarUrl;
                              if (selfieSrc) {
                                setZoomedImage({
                                  src: selfieSrc,
                                  title: `Live Biometric Selfie - ${fullLegalName}`,
                                });
                              }
                            }}
                            className={`group relative h-28 rounded-xl border border-slate-200 overflow-hidden bg-slate-100 flex flex-col items-center justify-center ${
                              applicant.kycLiveSelfieImage || applicant.avatarUrl
                                ? 'cursor-pointer hover:border-slate-400'
                                : 'opacity-70 cursor-default'
                            }`}
                          >
                            {applicant.kycLiveSelfieImage || applicant.avatarUrl ? (
                              <>
                                <img
                                  src={applicant.kycLiveSelfieImage || applicant.avatarUrl}
                                  alt="Live Selfie"
                                  className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                                />
                                <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[10px] font-bold gap-1">
                                  <Eye className="w-3.5 h-3.5" /> Inspect Selfie
                                </div>
                              </>
                            ) : (
                              <div className="text-center p-2 text-slate-400 text-[10px]">
                                <User className="w-5 h-5 mx-auto mb-1 text-slate-300" />
                                No Selfie Uploaded
                              </div>
                            )}
                            <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-slate-950/70 text-white text-[9px] font-black">
                              Face Match
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Granular Approve / Reject for Selfie */}
                      {onReviewKycItem && (
                        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                          <button
                            type="button"
                            onClick={() => handleRejectSingleItemPrompt(applicant.id, 'liveness', fullLegalName)}
                            className="px-2.5 py-1 text-[11px] font-extrabold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors cursor-pointer"
                          >
                            Reject Selfie
                          </button>
                          <button
                            type="button"
                            onClick={() => handleApproveSingleItem(applicant.id, 'liveness', fullLegalName)}
                            className="px-3 py-1 text-[11px] font-extrabold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors cursor-pointer flex items-center gap-1 shadow-xs"
                          >
                            <Check className="w-3 h-3" /> Approve Selfie
                          </button>
                        </div>
                      )}
                    </div>

                    {/* ITEM 3: PROOF OF ADDRESS */}
                    <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between space-y-3">
                      <div>
                        <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-slate-100">
                          <div className="flex items-center gap-2">
                            <Building2 className="w-4 h-4 text-sky-600 shrink-0" />
                            <span className="text-xs font-black text-slate-900 uppercase truncate">
                              3. Address ({applicant.kycProofOfAddressType || 'Utility / Bank'})
                            </span>
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded-md text-[10px] font-black border shrink-0 ${
                              addressStatus === 'approved'
                                ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                                : addressStatus === 'rejected'
                                ? 'bg-rose-100 text-rose-950 border-rose-300'
                                : 'bg-amber-100 text-amber-950 border-amber-300'
                            }`}
                          >
                            {addressStatus.toUpperCase()}
                          </span>
                        </div>

                        {reviews.proofOfAddress?.reason && (
                          <div className="mt-2 p-2 rounded-lg bg-rose-50 text-[11px] text-rose-900 font-semibold border border-rose-200">
                            <strong>Reject Note:</strong> {reviews.proofOfAddress.reason}
                          </div>
                        )}

                        <div className="mt-3">
                          {/* Address Document Photo */}
                          <div
                            onClick={() => {
                              if (applicant.kycProofOfAddressImage) {
                                setZoomedImage({
                                  src: applicant.kycProofOfAddressImage,
                                  title: `Proof of Address (${applicant.kycProofOfAddressType || 'Utility / Bank'}) - ${fullLegalName}`,
                                });
                              }
                            }}
                            className={`group relative h-28 rounded-xl border border-slate-200 overflow-hidden bg-slate-100 flex flex-col items-center justify-center ${
                              applicant.kycProofOfAddressImage
                                ? 'cursor-pointer hover:border-slate-400'
                                : 'opacity-70 cursor-default'
                            }`}
                          >
                            {applicant.kycProofOfAddressImage ? (
                              <>
                                <img
                                  src={applicant.kycProofOfAddressImage}
                                  alt="Proof of Address"
                                  className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                                />
                                <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[10px] font-bold gap-1">
                                  <Eye className="w-3.5 h-3.5" /> Inspect Address Doc
                                </div>
                              </>
                            ) : (
                              <div className="text-center p-2 text-slate-400 text-[10px]">
                                <MapPin className="w-5 h-5 mx-auto mb-1 text-slate-300" />
                                No Address Document
                              </div>
                            )}
                            <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-slate-950/70 text-white text-[9px] font-black">
                              Utility / Statement
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Granular Approve / Reject for Proof of Address */}
                      {onReviewKycItem && (
                        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                          <button
                            type="button"
                            onClick={() => handleRejectSingleItemPrompt(applicant.id, 'proofOfAddress', fullLegalName)}
                            className="px-2.5 py-1 text-[11px] font-extrabold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors cursor-pointer"
                          >
                            Reject Address
                          </button>
                          <button
                            type="button"
                            onClick={() => handleApproveSingleItem(applicant.id, 'proofOfAddress', fullLegalName)}
                            className="px-3 py-1 text-[11px] font-extrabold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors cursor-pointer flex items-center gap-1 shadow-xs"
                          >
                            <Check className="w-3 h-3" /> Approve Address
                          </button>
                        </div>
                      )}
                    </div>

                    {/* ITEM 4: SSN / TAX ID (IF PROVIDED OR APPLICANT IS US) */}
                    {(isUS || applicant.kycSsn || applicant.kycSsnImage) && (
                      <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between space-y-3">
                        <div>
                          <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-slate-100">
                            <div className="flex items-center gap-2">
                              <CreditCard className="w-4 h-4 text-purple-600 shrink-0" />
                              <span className="text-xs font-black text-slate-900 uppercase truncate">
                                4. SSN / Tax Card
                              </span>
                            </div>
                            <span
                              className={`px-2 py-0.5 rounded-md text-[10px] font-black border shrink-0 ${
                                ssnStatus === 'approved'
                                  ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                                  : ssnStatus === 'rejected'
                                  ? 'bg-rose-100 text-rose-950 border-rose-300'
                                  : 'bg-amber-100 text-amber-950 border-amber-300'
                              }`}
                            >
                              {ssnStatus.toUpperCase()}
                            </span>
                          </div>

                          {reviews.ssn?.reason && (
                            <div className="mt-2 p-2 rounded-lg bg-rose-50 text-[11px] text-rose-900 font-semibold border border-rose-200">
                              <strong>Reject Note:</strong> {reviews.ssn.reason}
                            </div>
                          )}

                          <div className="mt-3">
                            {/* SSN Document Image or Card Placeholder */}
                            <div
                              onClick={() => {
                                if (applicant.kycSsnImage) {
                                  setZoomedImage({
                                    src: applicant.kycSsnImage,
                                    title: `SSN / Tax Identification Document - ${fullLegalName}`,
                                  });
                                }
                              }}
                              className={`group relative h-28 rounded-xl border border-slate-200 overflow-hidden bg-slate-100 flex flex-col items-center justify-center ${
                                applicant.kycSsnImage
                                  ? 'cursor-pointer hover:border-slate-400'
                                  : 'opacity-70 cursor-default'
                              }`}
                            >
                              {applicant.kycSsnImage ? (
                                <>
                                  <img
                                    src={applicant.kycSsnImage}
                                    alt="SSN Document"
                                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                                  />
                                  <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[10px] font-bold gap-1">
                                    <Eye className="w-3.5 h-3.5" /> Inspect SSN Card
                                  </div>
                                </>
                              ) : (
                                <div className="text-center p-2 text-slate-400 text-[10px]">
                                  <CreditCard className="w-5 h-5 mx-auto mb-1 text-slate-300" />
                                  <span>Card Not Attached</span>
                                  <span className="block font-mono text-[9px] mt-0.5 text-slate-600 font-bold">
                                    {displaySsn}
                                  </span>
                                </div>
                              )}
                              <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-slate-950/70 text-white text-[9px] font-black">
                                Tax ID Card
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Granular Approve / Reject for SSN */}
                        {onReviewKycItem && (
                          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                            <button
                              type="button"
                              onClick={() => handleRejectSingleItemPrompt(applicant.id, 'ssn', fullLegalName)}
                              className="px-2.5 py-1 text-[11px] font-extrabold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors cursor-pointer"
                            >
                              Reject SSN
                            </button>
                            <button
                              type="button"
                              onClick={() => handleApproveSingleItem(applicant.id, 'ssn', fullLegalName)}
                              className="px-3 py-1 text-[11px] font-extrabold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors cursor-pointer flex items-center gap-1 shadow-xs"
                            >
                              <Check className="w-3 h-3" /> Approve SSN
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* 5. Final Global Adjudication Toolbar */}
                <div className="p-4 bg-white flex flex-col sm:flex-row items-center justify-between gap-3">
                  <div className="text-xs text-slate-500">
                    {!isVerified ? (
                      <span>
                        Approve each document individually or use <strong>Approve All & Verify</strong> to certify the customer immediately.
                      </span>
                    ) : (
                      <span className="text-emerald-700 font-bold flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4" /> This customer is fully verified with a $1,000,000 daily transaction limit.
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 w-full sm:w-auto justify-end flex-wrap">
                    {!isVerified ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmConfig({
                              isOpen: true,
                              title: 'Reject Entire KYC Application',
                              description: `You are rejecting the complete verification application for ${fullLegalName}. A formal compliance notice will be sent and the account will remain limited.`,
                              confirmLabel: 'Reject Application',
                              variant: 'danger',
                              requireReason: true,
                              targetName: `${fullLegalName} (${applicant.permanentAccountNumber})`,
                              action: async (reason: string) => {
                                await onRejectKyc(applicant.id, reason, applicant);
                                if (onRefreshData) onRefreshData().catch(() => {});
                              },
                            });
                          }}
                          className="py-2 px-4 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold transition-colors cursor-pointer"
                        >
                          Reject Application
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setConfirmConfig({
                              isOpen: true,
                              title: 'Approve All Documents & Verify Account',
                              description: `Verify and certify ${fullLegalName}. This immediately approves all submitted KYC documents, unlocks full $1,000,000 daily limits, and sends an automated confirmation notice to the customer.`,
                              confirmLabel: 'Approve All & Verify Account',
                              variant: 'primary',
                              requireReason: false,
                              targetName: `${fullLegalName} (${applicant.permanentAccountNumber})`,
                              action: async () => {
                                await onApproveKyc(applicant.id, applicant);
                                if (onRefreshData) onRefreshData().catch(() => {});
                              },
                            });
                          }}
                          className="py-2 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black transition-all cursor-pointer shadow-md shadow-emerald-600/20 flex items-center gap-1.5"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          Approve All & Verify Account
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmConfig({
                            isOpen: true,
                            title: 'Revoke Verification / Re-evaluate Status',
                            description: `Revoke verified status for ${fullLegalName}. Status will return to Action Required.`,
                            confirmLabel: 'Revoke Verification',
                            variant: 'danger',
                            requireReason: true,
                            targetName: `${fullLegalName} (${applicant.permanentAccountNumber})`,
                            action: async (reason: string) => {
                              await onRejectKyc(applicant.id, reason, applicant);
                              if (onRefreshData) onRefreshData().catch(() => {});
                            },
                          });
                        }}
                        className="py-1.5 px-3 rounded-xl border border-rose-200 text-xs font-bold text-rose-700 hover:bg-rose-50 transition-colors cursor-pointer"
                      >
                        Revoke Verification
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Image Inspection Zoom Modal */}
      {zoomedImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-3xl w-full p-5 shadow-2xl border-2 border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
              <h4 className="text-sm font-black text-slate-900">{zoomedImage.title}</h4>
              <button
                onClick={() => setZoomedImage(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="max-h-[75vh] overflow-hidden rounded-2xl bg-slate-950 flex items-center justify-center p-2">
              <img
                src={zoomedImage.src}
                alt={zoomedImage.title}
                className="w-full h-auto max-h-[70vh] object-contain rounded-xl"
              />
            </div>
          </div>
        </div>
      )}

      {/* Confirmation & Rejection Reason Modal */}
      <AdminConfirmationModal
        isOpen={confirmConfig.isOpen}
        onClose={() => setConfirmConfig((prev) => ({ ...prev, isOpen: false }))}
        onConfirm={confirmConfig.action}
        title={confirmConfig.title}
        description={confirmConfig.description}
        confirmLabel={confirmConfig.confirmLabel}
        confirmVariant={confirmConfig.variant}
        requireReason={confirmConfig.requireReason}
        targetEntityName={confirmConfig.targetName}
      />
    </div>
  );
};
