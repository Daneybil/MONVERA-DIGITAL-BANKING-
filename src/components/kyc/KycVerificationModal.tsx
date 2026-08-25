import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { firestoreSync } from '../../services/firestoreSync';
import { CountrySelector } from '../common/CountrySelector';
import { BlueVerifiedBadge } from '../dashboard/ProfileView';
import {
  ShieldCheck,
  ShieldAlert,
  X,
  FileText,
  Upload,
  CheckCircle2,
  AlertCircle,
  Clock,
  ArrowRight,
  User,
  Lock,
  Camera,
  Check,
  Building2,
  ImageIcon,
  MapPin,
  FileCheck2,
  RefreshCw,
  Eye,
  EyeOff,
  Trash2,
  AlertTriangle,
  HelpCircle,
  Phone,
  Mail,
  Calendar,
} from 'lucide-react';

interface KycVerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const KycVerificationModal: React.FC<KycVerificationModalProps> = ({ isOpen, onClose }) => {
  const { currentUser, updateUser, refreshNotifications } = useAuth();

  // Full Legal Name
  const [fullName, setFullName] = useState(
    currentUser?.kycFullName ||
      (currentUser?.firstName && currentUser?.lastName ? `${currentUser.firstName} ${currentUser.lastName}` : '')
  );
  const [country, setCountry] = useState(currentUser?.kycCountry || currentUser?.country || 'United States');
  const [phone, setPhone] = useState(currentUser?.kycPhone || currentUser?.phone || '');
  const [email, setEmail] = useState(currentUser?.kycEmail || currentUser?.email || '');
  const [dateOfBirth, setDateOfBirth] = useState(
    currentUser?.kycDateOfBirth || currentUser?.dateOfBirth || '1990-01-01'
  );

  // Government ID Details
  const [documentType, setDocumentType] = useState<string>(
    currentUser?.kycDocumentType || "Driver's License"
  );
  const [documentNumber, setDocumentNumber] = useState(currentUser?.kycDocumentNumber || '');

  // Proof of Address Details
  const [streetAddress, setStreetAddress] = useState(currentUser?.kycStreetAddress || '');
  const [proofOfAddressType, setProofOfAddressType] = useState(
    currentUser?.kycProofOfAddressType || 'Bank statement'
  );

  // US Tax Identifier
  const [ssnNumber, setSsnNumber] = useState(currentUser?.kycSsn || '');
  const [showSsn, setShowSsn] = useState(false);

  // Image Uploads (Base64 data URIs)
  const [documentImage, setDocumentImage] = useState<string>(currentUser?.kycDocumentImage || '');
  const [documentBackImage, setDocumentBackImage] = useState<string>(
    currentUser?.kycDocumentBackImage || ''
  );
  const [proofOfAddressImage, setProofOfAddressImage] = useState<string>(
    currentUser?.kycProofOfAddressImage || ''
  );
  const [ssnImage, setSsnImage] = useState<string>(currentUser?.kycSsnImage || '');
  const [liveSelfieImage, setLiveSelfieImage] = useState<string>(
    currentUser?.kycLiveSelfieImage || ''
  );

  // File Input References
  const docFrontFileRef = useRef<HTMLInputElement>(null);
  const docBackFileRef = useRef<HTMLInputElement>(null);
  const proofFileRef = useRef<HTMLInputElement>(null);
  const ssnFileRef = useRef<HTMLInputElement>(null);
  const selfieFileRef = useRef<HTMLInputElement>(null);

  // UI Flow State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submittedSuccess, setSubmittedSuccess] = useState(false);

  // Synchronize state when user changes
  useEffect(() => {
    if (currentUser) {
      setFullName(
        currentUser.kycFullName ||
          (currentUser.firstName && currentUser.lastName ? `${currentUser.firstName} ${currentUser.lastName}` : '')
      );
      setCountry(currentUser.kycCountry || currentUser.country || 'United States');
      setPhone(currentUser.kycPhone || currentUser.phone || '');
      setEmail(currentUser.kycEmail || currentUser.email || '');
      if (currentUser.kycDateOfBirth || currentUser.dateOfBirth) {
        setDateOfBirth(currentUser.kycDateOfBirth || currentUser.dateOfBirth || '');
      }
      if (currentUser.kycDocumentType) setDocumentType(currentUser.kycDocumentType);
      if (currentUser.kycDocumentNumber) setDocumentNumber(currentUser.kycDocumentNumber);
      if (currentUser.kycStreetAddress) setStreetAddress(currentUser.kycStreetAddress);
      if (currentUser.kycProofOfAddressType) setProofOfAddressType(currentUser.kycProofOfAddressType);
      if (currentUser.kycDocumentImage) setDocumentImage(currentUser.kycDocumentImage);
      if (currentUser.kycDocumentBackImage) setDocumentBackImage(currentUser.kycDocumentBackImage);
      if (currentUser.kycProofOfAddressImage) setProofOfAddressImage(currentUser.kycProofOfAddressImage);
      if (currentUser.kycSsnImage) setSsnImage(currentUser.kycSsnImage);
      if (currentUser.kycLiveSelfieImage) setLiveSelfieImage(currentUser.kycLiveSelfieImage);
      if (currentUser.kycSsn) setSsnNumber(currentUser.kycSsn);
    }
  }, [currentUser]);

  if (!isOpen || !currentUser) return null;

  const isVerified = currentUser.kycStatus === 'verified';
  const isPending = currentUser.kycStatus === 'pending' || submittedSuccess;
  const isUnitedStates =
    country.toLowerCase().includes('united states') || country.toUpperCase() === 'US' || country.toUpperCase() === 'USA';

  const itemReviews = currentUser.kycItemReviews || {};
  const isResubmissionMode =
    currentUser.kycStatus === 'action_required' ||
    currentUser.kycStatus === 'rejected' ||
    currentUser.kycStatus === 'partially_approved' ||
    Object.values(itemReviews).some((r: any) => r?.status === 'rejected');

  const isPassport = documentType.toLowerCase().includes('passport');

  // Review states per item
  const identityApproved = itemReviews.identity?.status === 'approved';
  const identityRejected = itemReviews.identity?.status === 'rejected';
  const identityRejectReason = itemReviews.identity?.rejectionReason;

  const proofApproved = itemReviews.proofOfAddress?.status === 'approved';
  const proofRejected = itemReviews.proofOfAddress?.status === 'rejected';
  const proofRejectReason = itemReviews.proofOfAddress?.rejectionReason;

  const selfieApproved = itemReviews.liveness?.status === 'approved';
  const selfieRejected = itemReviews.liveness?.status === 'rejected';
  const selfieRejectReason = itemReviews.liveness?.rejectionReason;

  const ssnApproved = itemReviews.ssn?.status === 'approved';
  const ssnRejected = itemReviews.ssn?.status === 'rejected';
  const ssnRejectReason = itemReviews.ssn?.rejectionReason;

  // Handle generic base64 file upload
  const handleFileUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    setter: (val: string) => void
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 15 * 1024 * 1024) {
      setErrorMsg('Document size exceeds maximum limit of 15MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setter(reader.result);
        setErrorMsg(null);
      }
    };
    reader.readAsDataURL(file);
  };

  // SSN formatting (XXX-XX-XXXX)
  const handleSsnChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 9);
    let formatted = raw;
    if (raw.length > 5) {
      formatted = `${raw.slice(0, 3)}-${raw.slice(3, 5)}-${raw.slice(5)}`;
    } else if (raw.length > 3) {
      formatted = `${raw.slice(0, 3)}-${raw.slice(3)}`;
    }
    setSsnNumber(formatted);
  };

  // Submit KYC handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    // 1. Validate Full Legal Name
    const cleanFullName = fullName.trim();
    if (!cleanFullName || cleanFullName.split(' ').length < 2) {
      setErrorMsg('Please enter your full legal first and last name exactly as it appears on your government-issued ID.');
      return;
    }

    // 2. Validate Country
    if (!country.trim()) {
      setErrorMsg('Please select your country of residence.');
      return;
    }

    // 3. Validate Phone & Email
    if (!phone.trim()) {
      setErrorMsg('Please provide a valid phone number.');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      setErrorMsg('Please provide a valid email address.');
      return;
    }

    // 4. Validate Identity Document
    if (!identityApproved) {
      if (!documentNumber.trim()) {
        setErrorMsg(`Please enter your actual ${documentType} document number (do not enter the photo/file name).`);
        return;
      }
      if (!documentImage) {
        setErrorMsg(`Please upload the front page image of your ${documentType}.`);
        return;
      }
      if (!isPassport && !documentBackImage) {
        setErrorMsg(`Please upload the back page image of your ${documentType}.`);
        return;
      }
    }

    // 5. Validate Proof of Address
    if (!proofApproved) {
      if (!streetAddress.trim()) {
        setErrorMsg('Please enter your residential street address.');
        return;
      }
      if (!proofOfAddressImage) {
        setErrorMsg('Please upload your Proof of Address document (bank statement, utility bill, or official correspondence).');
        return;
      }
    }

    // 6. Validate US SSN (mandatory for US residents)
    if (isUnitedStates && !ssnApproved) {
      const cleanSsnDigits = ssnNumber.replace(/\D/g, '');
      if (cleanSsnDigits.length !== 9) {
        setErrorMsg('Please enter a valid 9-digit US Social Security Number (SSN).');
        return;
      }
    }

    // 7. Validate Live Biometric Selfie
    if (!selfieApproved && !liveSelfieImage) {
      setErrorMsg('Please capture or upload a clear biometric selfie photo.');
      return;
    }

    setIsSubmitting(true);

    try {
      const nameParts = cleanFullName.split(' ');
      const derivedFirstName = nameParts[0];
      const derivedLastName = nameParts.slice(1).join(' ');

      const submitPayload = {
        userId: currentUser.id,
        fullName: cleanFullName,
        firstName: derivedFirstName,
        lastName: derivedLastName,
        country: country.trim(),
        phone: phone.trim(),
        email: email.trim(),
        dateOfBirth: dateOfBirth || undefined,
        documentType,
        documentNumber: documentNumber.trim(),
        documentImage: documentImage || undefined,
        documentBackImage: !isPassport ? documentBackImage : undefined,
        liveSelfieImage: liveSelfieImage || undefined,
        streetAddress: streetAddress.trim(),
        proofOfAddressType,
        proofOfAddress: `${proofOfAddressType} (${streetAddress.trim()})`,
        proofOfAddressImage: proofOfAddressImage || undefined,
        ssn: isUnitedStates ? ssnNumber.trim() : undefined,
        ssnImage: isUnitedStates && ssnImage ? ssnImage : undefined,
        isResubmission: isResubmissionMode,
        autoApprove: false,
      };

      const res = await api.submitKyc(submitPayload);

      if (res.success && res.user) {
        const updatedUser = {
          ...currentUser,
          ...res.user,
          kycStatus: 'pending' as const,
          kycFullName: cleanFullName,
          kycCountry: country.trim(),
          kycPhone: phone.trim(),
          kycEmail: email.trim(),
          kycDateOfBirth: dateOfBirth,
          kycDocumentType: documentType,
          kycDocumentNumber: documentNumber.trim(),
          kycDocumentImage: documentImage,
          kycDocumentBackImage: !isPassport ? documentBackImage : undefined,
          kycLiveSelfieImage: liveSelfieImage,
          kycStreetAddress: streetAddress.trim(),
          kycProofOfAddressType: proofOfAddressType,
          kycProofOfAddressImage: proofOfAddressImage,
          kycSsn: isUnitedStates ? ssnNumber.trim() : undefined,
          kycSsnImage: isUnitedStates && ssnImage ? ssnImage : undefined,
          kycSubmittedAt: new Date().toISOString(),
          kycRejectionReason: undefined,
        };

        updateUser(updatedUser);
        await firestoreSync.saveUserProfile(currentUser.id, updatedUser);
        refreshNotifications();

        setSubmittedSuccess(true);
      } else {
        setErrorMsg(res.error || 'KYC submission could not be processed. Please verify your details.');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Network error occurred during KYC document transmission.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-xs overflow-y-auto">
      <div className="bg-slate-900 text-slate-100 rounded-3xl max-w-3xl w-full max-h-[92vh] flex flex-col shadow-2xl border-2 border-slate-700 animate-in fade-in zoom-in-95 duration-150 overflow-hidden">
        
        {/* Top Header */}
        <div className="p-6 bg-slate-850 border-b border-slate-700/80 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
              <ShieldCheck className="w-6 h-6 stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-black uppercase tracking-wider text-amber-400 bg-amber-950/60 px-2 py-0.5 rounded-md border border-amber-800/60">
                  Regulatory Compliance
                </span>
                <span className="text-xs text-slate-400 font-semibold">Bank KYC / AML</span>
              </div>
              <h3 className="text-xl font-black text-white tracking-tight mt-0.5">
                {isVerified
                  ? 'Identity Clearance Active'
                  : isPending
                  ? 'KYC Verification Under Review'
                  : isResubmissionMode
                  ? 'KYC Document Correction Required'
                  : 'Customer KYC Verification'}
              </h3>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-6 h-6 stroke-[2.5]" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-6 sm:p-8 overflow-y-auto space-y-6 flex-1 text-slate-200">
          
          {/* STATE 1: ALREADY VERIFIED */}
          {isVerified && (
            <div className="p-8 rounded-2xl bg-sky-950/40 border-2 border-sky-600/50 text-center space-y-4">
              <div className="flex justify-center">
                <BlueVerifiedBadge size={64} />
              </div>
              <h4 className="text-2xl font-black text-white tracking-tight">
                Account Fully Verified & Cleared
              </h4>
              <p className="text-sm text-sky-200/90 max-w-md mx-auto leading-relaxed font-medium">
                Your government credentials have been approved by Monvera Compliance. You have unrestricted access to all banking features and full <strong>$1,000,000.00 daily transaction limits</strong>.
              </p>
              <div className="pt-2">
                <button
                  onClick={onClose}
                  className="px-6 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-extrabold text-sm shadow-md transition-colors"
                >
                  Return to Dashboard
                </button>
              </div>
            </div>
          )}

          {/* STATE 2: PENDING REVIEW CONFIRMATION */}
          {!isVerified && isPending && (
            <div className="p-8 rounded-2xl bg-amber-950/30 border-2 border-amber-500/40 text-center space-y-5">
              <div className="w-16 h-16 rounded-full bg-amber-500/20 border-2 border-amber-400/50 text-amber-400 flex items-center justify-center mx-auto animate-pulse">
                <Clock className="w-8 h-8 stroke-[2.5]" />
              </div>

              <div className="space-y-2">
                <span className="text-xs font-mono font-black uppercase tracking-wider text-amber-400 bg-amber-950/80 px-3 py-1 rounded-full border border-amber-700/60">
                  STATUS: PENDING REVIEW
                </span>
                <h4 className="text-2xl font-black text-white tracking-tight">
                  KYC Submitted Successfully
                </h4>
                <p className="text-base text-amber-100/95 max-w-lg mx-auto leading-relaxed font-semibold">
                  Your KYC has been submitted successfully and is currently under review. Verification may take up to 72 hours.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-850/80 border border-slate-700 text-left max-w-md mx-auto space-y-2 text-xs">
                <div className="flex items-center justify-between text-slate-300">
                  <span>Applicant Name:</span>
                  <strong className="text-white font-semibold">{fullName || `${currentUser.firstName} ${currentUser.lastName}`}</strong>
                </div>
                <div className="flex items-center justify-between text-slate-300">
                  <span>Document Type:</span>
                  <span className="text-amber-300 font-semibold">{documentType}</span>
                </div>
                <div className="flex items-center justify-between text-slate-300">
                  <span>Jurisdiction / Country:</span>
                  <span className="text-white font-semibold">{country}</span>
                </div>
                <div className="flex items-center justify-between text-slate-300">
                  <span>Proof of Address:</span>
                  <span className="text-emerald-400 font-semibold">{proofOfAddressType} (Attached)</span>
                </div>
                <div className="flex items-center justify-between text-slate-300">
                  <span>Review Timeframe:</span>
                  <span className="text-amber-300 font-bold">Standard Review (Within 72 Hours)</span>
                </div>
              </div>

              <p className="text-xs text-slate-400 max-w-md mx-auto font-medium">
                Our compliance officers manually inspect each security watermark and document signature. You will receive an in-app notice and email once verification is complete.
              </p>

              <div className="pt-3">
                <button
                  onClick={onClose}
                  className="px-7 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-black text-sm border border-slate-600 transition-colors shadow-sm cursor-pointer"
                >
                  Close & Return to Dashboard
                </button>
              </div>
            </div>
          )}

          {/* STATE 3: INTERACTIVE KYC SUBMISSION & RESUBMISSION FORM */}
          {!isVerified && !isPending && (
            <form onSubmit={handleSubmit} className="space-y-6">
              
              {/* Granular Resubmission Alert Banner */}
              {isResubmissionMode && (
                <div className="p-5 rounded-2xl bg-rose-950/60 border-2 border-rose-600 text-rose-100 flex items-start gap-4 shadow-lg">
                  <AlertCircle className="w-6 h-6 text-rose-400 shrink-0 mt-0.5 stroke-[2.5]" />
                  <div className="space-y-1.5 text-sm">
                    <h4 className="font-black text-rose-200 text-base">
                      Correction Required: Resubmit Highlighted Items
                    </h4>
                    <p className="text-rose-200/90 leading-relaxed font-medium">
                      Our compliance desk reviewed your submission. One or more items require correction.
                      <strong> You only need to correct and resubmit the rejected documents below.</strong> Approved items are saved and locked.
                    </p>
                    {currentUser.kycRejectionReason && (
                      <div className="p-3 bg-rose-900/50 rounded-xl border border-rose-700/60 text-xs font-semibold text-rose-100 mt-2">
                        <strong>Compliance Team Note:</strong> {currentUser.kycRejectionReason}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Error Message */}
              {errorMsg && (
                <div className="p-4 rounded-xl bg-rose-950/80 border border-rose-500 text-rose-200 text-sm flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                  <div className="font-semibold">{errorMsg}</div>
                </div>
              )}

              {/* SECTION 1: PERSONAL LEGAL DETAILS */}
              <div className="p-5 rounded-2xl bg-slate-850 border border-slate-700 space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-slate-700/60">
                  <User className="w-5 h-5 text-amber-400" />
                  <h4 className="text-base font-black text-white">1. Personal & Contact Information</h4>
                </div>

                <div className="space-y-4 text-sm">
                  {/* Full Legal Name */}
                  <div>
                    <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                      Full Legal Name <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="e.g. Johnathan Alexander Doe"
                      className="w-full px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-amber-400 focus:ring-1 focus:ring-amber-400 text-white placeholder:text-slate-500 font-medium"
                      required
                    />
                    <p className="text-xs text-amber-300/90 mt-1.5 flex items-center gap-1.5 font-medium">
                      <HelpCircle className="w-3.5 h-3.5 shrink-0" />
                      Enter your name EXACTLY as it appears on your government-issued identification document.
                    </p>
                  </div>

                  {/* Country Selector */}
                  <div>
                    <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                      Country of Residence / Citizenship <span className="text-rose-400">*</span>
                    </label>
                    <CountrySelector
                      value={country}
                      onChange={(val) => setCountry(val)}
                      className="w-full"
                    />
                  </div>

                  {/* Phone & Email Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                        <Phone className="w-3.5 h-3.5 text-slate-400" />
                        Phone Number <span className="text-rose-400">*</span>
                      </label>
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+1 (555) 000-0000"
                        className="w-full px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-amber-400 text-white placeholder:text-slate-500 font-medium"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                        <Mail className="w-3.5 h-3.5 text-slate-400" />
                        Email Address <span className="text-rose-400">*</span>
                      </label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="john.doe@example.com"
                        className="w-full px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-amber-400 text-white placeholder:text-slate-500 font-medium"
                        required
                      />
                    </div>
                  </div>

                  {/* Date of Birth */}
                  <div>
                    <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      Date of Birth <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="date"
                      value={dateOfBirth}
                      onChange={(e) => setDateOfBirth(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-amber-400 text-white font-medium"
                      required
                    />
                  </div>
                </div>
              </div>

              {/* SECTION 2: GOVERNMENT IDENTIFICATION DOCUMENT */}
              <div
                className={`p-5 rounded-2xl border transition-all ${
                  identityApproved
                    ? 'bg-emerald-950/20 border-emerald-600/50'
                    : identityRejected
                    ? 'bg-rose-950/30 border-rose-500'
                    : 'bg-slate-850 border-slate-700'
                } space-y-4`}
              >
                <div className="flex items-center justify-between pb-2 border-b border-slate-700/60">
                  <div className="flex items-center gap-2">
                    <FileCheck2 className="w-5 h-5 text-amber-400" />
                    <h4 className="text-base font-black text-white">
                      2. Government Identification Document
                    </h4>
                  </div>
                  {identityApproved && (
                    <span className="px-2.5 py-1 rounded-full text-xs font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Approved
                    </span>
                  )}
                  {identityRejected && (
                    <span className="px-2.5 py-1 rounded-full text-xs font-black bg-rose-500/20 text-rose-300 border border-rose-500/40 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" /> Correction Required
                    </span>
                  )}
                </div>

                {identityRejected && identityRejectReason && (
                  <div className="p-3 bg-rose-900/60 border border-rose-600 rounded-xl text-xs text-rose-100 font-semibold">
                    <strong>Rejection Reason:</strong> {identityRejectReason}
                  </div>
                )}

                {identityApproved ? (
                  <div className="text-xs text-emerald-200/90 font-medium py-2">
                    ✓ Your {documentType} ({documentNumber}) has been approved by compliance. No changes required.
                  </div>
                ) : (
                  <div className="space-y-4 text-sm">
                    {/* Document Type Selector */}
                    <div>
                      <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                        Government Identification Document Type <span className="text-rose-400">*</span>
                      </label>
                      <select
                        value={documentType}
                        onChange={(e) => setDocumentType(e.target.value)}
                        className="w-full px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-amber-400 text-white font-medium cursor-pointer"
                      >
                        <option value="Driver's License">Driver's License</option>
                        <option value="National ID / Government ID">National ID / Government ID</option>
                        <option value="International Passport">International Passport</option>
                        <option value="Other supported government-issued ID">Other supported government-issued ID</option>
                      </select>
                    </div>

                    {/* Document Number */}
                    <div>
                      <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                        Document Number <span className="text-rose-400">*</span>
                      </label>
                      <input
                        type="text"
                        value={documentNumber}
                        onChange={(e) => setDocumentNumber(e.target.value)}
                        placeholder="e.g. DL-98402194 or P982014920"
                        className="w-full px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-amber-400 font-mono text-white placeholder:text-slate-500 font-bold"
                        required
                      />
                      <p className="text-xs text-amber-300/90 mt-1.5 flex items-center gap-1.5 font-medium">
                        <HelpCircle className="w-3.5 h-3.5 shrink-0" />
                        Enter the actual document number shown on your selected identification document. Do NOT enter the document image or file number.
                      </p>
                    </div>

                    {/* ID Document Uploads (Front & Back) */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                      {/* Front Page Upload */}
                      <div>
                        <span className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                          {isPassport ? 'Photo / Info Page' : 'Front Page Image'} <span className="text-rose-400">*</span>
                        </span>
                        <input
                          type="file"
                          ref={docFrontFileRef}
                          onChange={(e) => handleFileUpload(e, setDocumentImage)}
                          accept="image/*"
                          className="hidden"
                        />

                        {documentImage ? (
                          <div className="relative rounded-xl border border-slate-600 overflow-hidden bg-slate-950 p-2 group">
                            <img
                              src={documentImage}
                              alt="Front ID"
                              className="w-full h-32 object-cover rounded-lg"
                            />
                            <button
                              type="button"
                              onClick={() => setDocumentImage('')}
                              className="absolute top-3 right-3 p-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700 shadow-md cursor-pointer"
                              title="Remove Image"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                            <span className="block text-[11px] text-emerald-400 font-bold text-center mt-1.5">
                              ✓ Front Page Attached
                            </span>
                          </div>
                        ) : (
                          <div
                            onClick={() => docFrontFileRef.current?.click()}
                            className="h-32 rounded-xl border-2 border-dashed border-slate-600 hover:border-amber-400 bg-slate-900/60 hover:bg-slate-900 flex flex-col items-center justify-center p-4 text-center cursor-pointer transition-colors"
                          >
                            <Upload className="w-6 h-6 text-amber-400 mb-1" />
                            <span className="text-xs font-bold text-white">Upload Front Page</span>
                            <span className="text-[11px] text-slate-400 mt-0.5">JPG, PNG (Max 15MB)</span>
                          </div>
                        )}
                      </div>

                      {/* Back Page Upload (If not passport) */}
                      {!isPassport && (
                        <div>
                          <span className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                            Back Page Image <span className="text-rose-400">*</span>
                          </span>
                          <input
                            type="file"
                            ref={docBackFileRef}
                            onChange={(e) => handleFileUpload(e, setDocumentBackImage)}
                            accept="image/*"
                            className="hidden"
                          />

                          {documentBackImage ? (
                            <div className="relative rounded-xl border border-slate-600 overflow-hidden bg-slate-950 p-2 group">
                              <img
                                src={documentBackImage}
                                alt="Back ID"
                                className="w-full h-32 object-cover rounded-lg"
                              />
                              <button
                                type="button"
                                onClick={() => setDocumentBackImage('')}
                                className="absolute top-3 right-3 p-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700 shadow-md cursor-pointer"
                                title="Remove Image"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                              <span className="block text-[11px] text-emerald-400 font-bold text-center mt-1.5">
                                ✓ Back Page Attached
                              </span>
                            </div>
                          ) : (
                            <div
                              onClick={() => docBackFileRef.current?.click()}
                              className="h-32 rounded-xl border-2 border-dashed border-slate-600 hover:border-amber-400 bg-slate-900/60 hover:bg-slate-900 flex flex-col items-center justify-center p-4 text-center cursor-pointer transition-colors"
                            >
                              <Upload className="w-6 h-6 text-amber-400 mb-1" />
                              <span className="text-xs font-bold text-white">Upload Back Page</span>
                              <span className="text-[11px] text-slate-400 mt-0.5">Barcode / Signature side</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* SECTION 3: PROOF OF ADDRESS */}
              <div
                className={`p-5 rounded-2xl border transition-all ${
                  proofApproved
                    ? 'bg-emerald-950/20 border-emerald-600/50'
                    : proofRejected
                    ? 'bg-rose-950/30 border-rose-500'
                    : 'bg-slate-850 border-slate-700'
                } space-y-4`}
              >
                <div className="flex items-center justify-between pb-2 border-b border-slate-700/60">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-5 h-5 text-amber-400" />
                    <h4 className="text-base font-black text-white">3. Proof of Address</h4>
                  </div>
                  {proofApproved && (
                    <span className="px-2.5 py-1 rounded-full text-xs font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Approved
                    </span>
                  )}
                  {proofRejected && (
                    <span className="px-2.5 py-1 rounded-full text-xs font-black bg-rose-500/20 text-rose-300 border border-rose-500/40 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" /> Correction Required
                    </span>
                  )}
                </div>

                {proofRejected && proofRejectReason && (
                  <div className="p-3 bg-rose-900/60 border border-rose-600 rounded-xl text-xs text-rose-100 font-semibold">
                    <strong>Rejection Reason:</strong> {proofRejectReason}
                  </div>
                )}

                {proofApproved ? (
                  <div className="text-xs text-emerald-200/90 font-medium py-2">
                    ✓ Your proof of address ({streetAddress}) has been approved by compliance.
                  </div>
                ) : (
                  <div className="space-y-4 text-sm">
                    {/* Residential Street Address */}
                    <div>
                      <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                        Residential Street Address <span className="text-rose-400">*</span>
                      </label>
                      <input
                        type="text"
                        value={streetAddress}
                        onChange={(e) => setStreetAddress(e.target.value)}
                        placeholder="e.g. 450 Lexington Avenue, Suite 2400, New York, NY 10017"
                        className="w-full px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-amber-400 text-white placeholder:text-slate-500 font-medium"
                        required
                      />
                    </div>

                    {/* Proof Type Selector */}
                    <div>
                      <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                        Select Proof of Address Type <span className="text-rose-400">*</span>
                      </label>
                      <select
                        value={proofOfAddressType}
                        onChange={(e) => setProofOfAddressType(e.target.value)}
                        className="w-full px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-amber-400 text-white font-medium cursor-pointer"
                      >
                        <option value="Bank statement">Bank statement</option>
                        <option value="Utility bill">Utility bill</option>
                        <option value="Government correspondence">Government correspondence</option>
                        <option value="Other supported official proof of address">Other supported official proof of address</option>
                      </select>
                    </div>

                    {/* Proof Document Upload */}
                    <div>
                      <span className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                        Upload Document <span className="text-rose-400">*</span>
                      </span>
                      <input
                        type="file"
                        ref={proofFileRef}
                        onChange={(e) => handleFileUpload(e, setProofOfAddressImage)}
                        accept="image/*"
                        className="hidden"
                      />

                      {proofOfAddressImage ? (
                        <div className="relative rounded-xl border border-slate-600 overflow-hidden bg-slate-950 p-2 group">
                          <img
                            src={proofOfAddressImage}
                            alt="Proof of Address"
                            className="w-full h-36 object-cover rounded-lg"
                          />
                          <button
                            type="button"
                            onClick={() => setProofOfAddressImage('')}
                            className="absolute top-3 right-3 p-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700 shadow-md cursor-pointer"
                            title="Remove Document"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <span className="block text-[11px] text-emerald-400 font-bold text-center mt-1.5">
                            ✓ {proofOfAddressType} Attached
                          </span>
                        </div>
                      ) : (
                        <div
                          onClick={() => proofFileRef.current?.click()}
                          className="h-32 rounded-xl border-2 border-dashed border-slate-600 hover:border-amber-400 bg-slate-900/60 hover:bg-slate-900 flex flex-col items-center justify-center p-4 text-center cursor-pointer transition-colors"
                        >
                          <Upload className="w-6 h-6 text-amber-400 mb-1" />
                          <span className="text-xs font-bold text-white">Upload {proofOfAddressType}</span>
                          <span className="text-[11px] text-slate-400 mt-0.5">JPG, PNG (Max 15MB)</span>
                        </div>
                      )}

                      <p className="text-xs text-amber-300/90 mt-2 font-medium leading-relaxed">
                        * Note: Proof of address must be recent (less than 3 months old) and contain your full legal name and residential address.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* SECTION 4: US SSN TAX IDENTIFIER (FOR US RESIDENTS) */}
              {isUnitedStates && (
                <div
                  className={`p-5 rounded-2xl border transition-all ${
                    ssnApproved
                      ? 'bg-emerald-950/20 border-emerald-600/50'
                      : ssnRejected
                      ? 'bg-rose-950/30 border-rose-500'
                      : 'bg-slate-850 border-slate-700'
                  } space-y-4`}
                >
                  <div className="flex items-center justify-between pb-2 border-b border-slate-700/60">
                    <div className="flex items-center gap-2">
                      <Lock className="w-5 h-5 text-amber-400" />
                      <h4 className="text-base font-black text-white">
                        4. US Social Security Number (SSN)
                      </h4>
                    </div>
                    {ssnApproved && (
                      <span className="px-2.5 py-1 rounded-full text-xs font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Approved
                      </span>
                    )}
                    {ssnRejected && (
                      <span className="px-2.5 py-1 rounded-full text-xs font-black bg-rose-500/20 text-rose-300 border border-rose-500/40 flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5" /> Correction Required
                      </span>
                    )}
                  </div>

                  {ssnRejected && ssnRejectReason && (
                    <div className="p-3 bg-rose-900/60 border border-rose-600 rounded-xl text-xs text-rose-100 font-semibold">
                      <strong>Rejection Reason:</strong> {ssnRejectReason}
                    </div>
                  )}

                  {ssnApproved ? (
                    <div className="text-xs text-emerald-200/90 font-medium py-2">
                      ✓ Your US Tax Identification has been verified against federal registries.
                    </div>
                  ) : (
                    <div className="space-y-4 text-sm">
                      <div>
                        <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                          Social Security Number (9 Digits) <span className="text-rose-400">*</span>
                        </label>
                        <div className="relative">
                          <input
                            type={showSsn ? 'text' : 'password'}
                            value={ssnNumber}
                            onChange={handleSsnChange}
                            placeholder="XXX-XX-XXXX"
                            maxLength={11}
                            className="w-full pl-4 pr-12 py-3 rounded-xl bg-slate-900 border border-slate-700 focus:border-amber-400 font-mono text-white text-base tracking-widest font-bold"
                            required
                          />
                          <button
                            type="button"
                            onClick={() => setShowSsn(!showSsn)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-white"
                          >
                            {showSsn ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                        <p className="text-xs text-slate-400 mt-1 font-medium">
                          Required for FinCEN / IRS CIP compliance on US accounts. Transmitted via 256-bit AES encryption.
                        </p>
                      </div>

                      {/* Optional SSN Document Image Upload */}
                      <div>
                        <span className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                          SSN Card Document Photo <span className="text-slate-400 font-normal">(Optional)</span>
                        </span>
                        <input
                          type="file"
                          ref={ssnFileRef}
                          onChange={(e) => handleFileUpload(e, setSsnImage)}
                          accept="image/*"
                          className="hidden"
                        />

                        {ssnImage ? (
                          <div className="relative rounded-xl border border-slate-600 overflow-hidden bg-slate-950 p-2 group">
                            <img
                              src={ssnImage}
                              alt="SSN Card"
                              className="w-full h-28 object-cover rounded-lg"
                            />
                            <button
                              type="button"
                              onClick={() => setSsnImage('')}
                              className="absolute top-3 right-3 p-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700 shadow-md cursor-pointer"
                              title="Remove SSN Document"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                            <span className="block text-[11px] text-emerald-400 font-bold text-center mt-1.5">
                              ✓ Optional SSN Document Attached
                            </span>
                          </div>
                        ) : (
                          <div
                            onClick={() => ssnFileRef.current?.click()}
                            className="h-24 rounded-xl border-2 border-dashed border-slate-700 hover:border-slate-500 bg-slate-900/40 hover:bg-slate-900 flex flex-col items-center justify-center p-3 text-center cursor-pointer transition-colors"
                          >
                            <Upload className="w-5 h-5 text-slate-400 mb-1" />
                            <span className="text-xs font-bold text-slate-300">Upload SSN Card (Optional)</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* SECTION 5: LIVE BIOMETRIC SELFIE */}
              <div
                className={`p-5 rounded-2xl border transition-all ${
                  selfieApproved
                    ? 'bg-emerald-950/20 border-emerald-600/50'
                    : selfieRejected
                    ? 'bg-rose-950/30 border-rose-500'
                    : 'bg-slate-850 border-slate-700'
                } space-y-4`}
              >
                <div className="flex items-center justify-between pb-2 border-b border-slate-700/60">
                  <div className="flex items-center gap-2">
                    <Camera className="w-5 h-5 text-amber-400" />
                    <h4 className="text-base font-black text-white">
                      {isUnitedStates ? '5. Biometric Facial Selfie' : '4. Biometric Facial Selfie'}
                    </h4>
                  </div>
                  {selfieApproved && (
                    <span className="px-2.5 py-1 rounded-full text-xs font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Approved
                    </span>
                  )}
                  {selfieRejected && (
                    <span className="px-2.5 py-1 rounded-full text-xs font-black bg-rose-500/20 text-rose-300 border border-rose-500/40 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" /> Correction Required
                    </span>
                  )}
                </div>

                {selfieRejected && selfieRejectReason && (
                  <div className="p-3 bg-rose-900/60 border border-rose-600 rounded-xl text-xs text-rose-100 font-semibold">
                    <strong>Rejection Reason:</strong> {selfieRejectReason}
                  </div>
                )}

                {selfieApproved ? (
                  <div className="text-xs text-emerald-200/90 font-medium py-2">
                    ✓ Your biometric selfie match has been approved by compliance.
                  </div>
                ) : (
                  <div>
                    <span className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                      Live Selfie Photo <span className="text-rose-400">*</span>
                    </span>
                    <input
                      type="file"
                      ref={selfieFileRef}
                      onChange={(e) => handleFileUpload(e, setLiveSelfieImage)}
                      accept="image/*"
                      className="hidden"
                    />

                    {liveSelfieImage ? (
                      <div className="relative rounded-xl border border-slate-600 overflow-hidden bg-slate-950 p-2 group flex flex-col items-center">
                        <img
                          src={liveSelfieImage}
                          alt="Biometric Selfie"
                          className="w-36 h-36 object-cover rounded-full border-2 border-amber-400"
                        />
                        <button
                          type="button"
                          onClick={() => setLiveSelfieImage('')}
                          className="absolute top-3 right-3 p-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700 shadow-md cursor-pointer"
                          title="Retake Selfie"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <span className="block text-[11px] text-emerald-400 font-bold text-center mt-2">
                          ✓ Biometric Facial Selfie Ready
                        </span>
                      </div>
                    ) : (
                      <div
                        onClick={() => selfieFileRef.current?.click()}
                        className="h-32 rounded-xl border-2 border-dashed border-slate-600 hover:border-amber-400 bg-slate-900/60 hover:bg-slate-900 flex flex-col items-center justify-center p-4 text-center cursor-pointer transition-colors"
                      >
                        <Camera className="w-6 h-6 text-amber-400 mb-1" />
                        <span className="text-xs font-bold text-white">Capture / Upload Selfie Photo</span>
                        <span className="text-[11px] text-slate-400 mt-0.5">Ensure face is well-lit without glasses or hats</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Submit Buttons */}
              <div className="pt-4 border-t border-slate-700 flex flex-col sm:flex-row items-center justify-between gap-4">
                <p className="text-xs text-slate-400 font-medium max-w-sm">
                  By submitting, you certify that all information and documents provided are genuine and legally valid.
                </p>

                <div className="flex items-center gap-3 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-5 py-3 rounded-xl border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 text-sm font-bold transition-colors w-full sm:w-auto cursor-pointer"
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-7 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-black transition-all shadow-md shadow-amber-500/25 flex items-center justify-center gap-2 w-full sm:w-auto cursor-pointer disabled:opacity-50"
                  >
                    {isSubmitting ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Transmitting Dossier...</span>
                      </>
                    ) : isResubmissionMode ? (
                      <>
                        <ShieldCheck className="w-4 h-4" />
                        <span>Submit Corrections for Review</span>
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="w-4 h-4" />
                        <span>Submit KYC for Review</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
