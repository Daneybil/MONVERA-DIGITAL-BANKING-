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
  Sparkles,
  Zap,
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
  Trash2,
} from 'lucide-react';
import confetti from 'canvas-confetti';

interface KycVerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const KycVerificationModal: React.FC<KycVerificationModalProps> = ({ isOpen, onClose }) => {
  const { currentUser, updateUser, refreshNotifications } = useAuth();

  // Form State
  const [firstName, setFirstName] = useState(currentUser?.firstName || '');
  const [lastName, setLastName] = useState(currentUser?.lastName || '');
  const [country, setCountry] = useState(currentUser?.country || 'Nigeria');
  const [documentType, setDocumentType] = useState<string>('Passport');
  const [documentNumber, setDocumentNumber] = useState(currentUser?.kycDocumentNumber || '');
  const [ssnNumber, setSsnNumber] = useState(currentUser?.kycSsn || '');
  const [streetAddress, setStreetAddress] = useState(
    currentUser?.kycStreetAddress || 'Plot 14, Victoria Island, Lagos'
  );

  // File Upload States (Base64 data URIs or Preview URLs)
  const [documentImage, setDocumentImage] = useState<string>(currentUser?.kycDocumentImage || '');
  const [proofOfAddressImage, setProofOfAddressImage] = useState<string>(
    currentUser?.kycProofOfAddressImage || ''
  );
  const [liveSelfieImage, setLiveSelfieImage] = useState<string>(
    currentUser?.kycLiveSelfieImage || ''
  );

  // Upload refs
  const docFileRef = useRef<HTMLInputElement>(null);
  const proofFileRef = useRef<HTMLInputElement>(null);
  const selfieFileRef = useRef<HTMLInputElement>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Automated Review Simulation State (5-10 Minutes Countdown)
  const [isAutoVerifying, setIsAutoVerifying] = useState(false);
  const [reviewSecondsLeft, setReviewSecondsLeft] = useState(300); // 5 minutes (300s) default
  const [verificationProgress, setVerificationProgress] = useState(0);
  const [currentStepText, setCurrentStepText] = useState('');

  // Sync state if currentUser changes
  useEffect(() => {
    if (currentUser) {
      setFirstName(currentUser.firstName || '');
      setLastName(currentUser.lastName || '');
      setCountry(currentUser.country || 'Nigeria');
      if (currentUser.kycDocumentType) setDocumentType(currentUser.kycDocumentType);
      if (currentUser.kycDocumentNumber) setDocumentNumber(currentUser.kycDocumentNumber);
      if (currentUser.kycStreetAddress) setStreetAddress(currentUser.kycStreetAddress);
      if (currentUser.kycDocumentImage) setDocumentImage(currentUser.kycDocumentImage);
      if (currentUser.kycProofOfAddressImage) setProofOfAddressImage(currentUser.kycProofOfAddressImage);
      if (currentUser.kycLiveSelfieImage) setLiveSelfieImage(currentUser.kycLiveSelfieImage);
      if (currentUser.kycSsn) setSsnNumber(currentUser.kycSsn);
    }
  }, [currentUser]);

  if (!isOpen || !currentUser) return null;

  const isVerified = currentUser.kycStatus === 'verified';
  const isPending = currentUser.kycStatus === 'pending';
  const isUnitedStates =
    country.toLowerCase().includes('united states') || country.toUpperCase() === 'US' || country.toUpperCase() === 'USA';

  // Helper for reading file as Data URL
  const handleFileUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    setter: (val: string) => void
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      setErrorMsg('Image size must be under 10MB.');
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

  // SSN input formatting (XXX-XX-XXXX)
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

  // Handle User Document Submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim()) {
      setErrorMsg('Please enter your legal First Name.');
      return;
    }
    if (!lastName.trim()) {
      setErrorMsg('Please enter your legal Second Name / Last Name.');
      return;
    }
    if (!country.trim()) {
      setErrorMsg('Please select your country of citizenship.');
      return;
    }
    if (isUnitedStates && !ssnNumber.trim()) {
      setErrorMsg('United States residents must provide a valid Social Security Number (SSN).');
      return;
    }
    if (!documentNumber.trim()) {
      setErrorMsg(`Please enter your ${documentType} ID Number / Code.`);
      return;
    }
    if (!documentImage) {
      setErrorMsg(`Please upload a clear image of your ${documentType}.`);
      return;
    }
    if (!streetAddress.trim()) {
      setErrorMsg('Please enter your residential street address.');
      return;
    }
    if (!proofOfAddressImage) {
      setErrorMsg('Please upload a proof of address document (Utility bill or bank statement).');
      return;
    }
    if (!liveSelfieImage) {
      setErrorMsg('Please take or upload a live biometric selfie image.');
      return;
    }

    setErrorMsg(null);
    setIsSubmitting(true);

    try {
      // Step 1: Submit to API / Firestore database as pending KYC review
      const res = await api.submitKyc({
        userId: currentUser.id,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        country: country.trim(),
        documentType,
        documentNumber: documentNumber.trim(),
        documentImage,
        liveSelfieImage,
        streetAddress: streetAddress.trim(),
        proofOfAddressImage,
        ssn: isUnitedStates ? ssnNumber.trim() : undefined,
        autoApprove: false, // Start 5-10 minute review
        reviewDurationMinutes: 10,
      });

      if (res.success && res.user) {
        // Update user state to pending in Context and Firestore
        const pendingUser = {
          ...currentUser,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          country: country.trim(),
          kycStatus: 'pending' as const,
          kycFirstName: firstName.trim(),
          kycLastName: lastName.trim(),
          kycCountry: country.trim(),
          kycDocumentType: documentType,
          kycDocumentNumber: documentNumber.trim(),
          kycDocumentImage: documentImage,
          kycLiveSelfieImage: liveSelfieImage,
          kycStreetAddress: streetAddress.trim(),
          kycProofOfAddressImage: proofOfAddressImage,
          kycSsn: isUnitedStates ? ssnNumber.trim() : undefined,
          kycSubmittedAt: new Date().toISOString(),
          kycReviewDurationMinutes: 10,
        };

        updateUser(pendingUser);
        await firestoreSync.saveUser(pendingUser);
        refreshNotifications();

        // Trigger Automated Verification Scanner (5–10 min review)
        runAutomatedReview(pendingUser);
      } else {
        setErrorMsg(res.error || 'Submission failed. Please check your details and try again.');
        setIsSubmitting(false);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Network error occurred during KYC submission.');
      setIsSubmitting(false);
    }
  };

  // Automated Review Process Engine (5–10 min review simulation with step progression)
  const runAutomatedReview = (userToVerify: typeof currentUser) => {
    setIsAutoVerifying(true);
    setVerificationProgress(15);
    setCurrentStepText('Analyzing document security features & holographic watermarks...');

    const steps = [
      { p: 30, text: 'Scanning optical MRZ cryptographic barcode against global databases...' },
      { p: 55, text: 'Running automated AML, OFAC, and international sanction screening...' },
      { p: 75, text: 'Executing 3D biometric facial liveness match & document authentication...' },
      { p: 90, text: 'Confirming residential street address & utility proof integrity...' },
      { p: 100, text: 'Automated compliance review complete! Account officially verified.' },
    ];

    let stepIdx = 0;
    const interval = setInterval(async () => {
      if (stepIdx < steps.length) {
        setVerificationProgress(steps[stepIdx].p);
        setCurrentStepText(steps[stepIdx].text);
        stepIdx++;
      } else {
        clearInterval(interval);
        // Complete Verification
        const approvedUser = {
          ...userToVerify,
          kycStatus: 'verified' as const,
          kycVerifiedAt: new Date().toISOString(),
          dailyTransactionLimit: 1000000,
        };

        updateUser(approvedUser);
        await firestoreSync.saveUser(approvedUser);

        // Notify backend of approval
        await api.approveKyc({ userId: userToVerify.id });
        refreshNotifications();
        setIsAutoVerifying(false);
        setIsSubmitting(false);

        // Confetti celebration
        try {
          confetti({
            particleCount: 100,
            spread: 80,
            origin: { y: 0.6 },
            colors: ['#0284c7', '#10b981', '#f59e0b', '#0f172a'],
          });
        } catch {
          // ignore
        }
      }
    }, 2200);
  };

  const handleInstantFastTrack = () => {
    runAutomatedReview(currentUser);
  };

  return (
    <div
      id="kyc-verification-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isAutoVerifying) onClose();
      }}
    >
      <div
        id="kyc-verification-modal-container"
        className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl border-2 border-slate-800 overflow-hidden relative max-h-[92vh] flex flex-col animate-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="p-6 bg-slate-950 text-white flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-sky-500/20 border border-sky-500/40 flex items-center justify-center text-sky-400">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-black tracking-tight text-white flex items-center gap-2">
                KYC Identity Verification
                {isVerified && <BlueVerifiedBadge size={20} />}
              </h2>
              <p className="text-xs text-slate-400 font-mono">
                MONVERA GLOBAL COMPLIANCE ONBOARDING
              </p>
            </div>
          </div>
          {!isAutoVerifying && (
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Modal Body */}
        <div className="p-6 sm:p-7 overflow-y-auto flex-1 space-y-6">
          
          {/* STATE 1: ALREADY VERIFIED */}
          {isVerified ? (
            <div className="text-center py-6 space-y-5">
              <div className="w-20 h-20 rounded-full bg-sky-100 border-4 border-sky-500/30 flex items-center justify-center mx-auto text-sky-600 shadow-lg">
                <CheckCircle2 className="w-10 h-10" />
              </div>
              <div className="space-y-2">
                <h3 className="text-2xl font-black text-slate-950 flex items-center justify-center gap-2">
                  Account 100% KYC Verified <BlueVerifiedBadge size={24} />
                </h3>
                <p className="text-sm text-slate-600 max-w-md mx-auto font-medium">
                  Your identity has been authenticated. You have unrestricted access to wire transfers, 4.5% interest investments, virtual/physical cards, and elevated $1,000,000 daily limits.
                </p>
              </div>

              <div className="bg-slate-50 p-5 rounded-2xl border-2 border-slate-200 text-xs font-mono space-y-2.5 text-left max-w-md mx-auto">
                <div className="flex justify-between">
                  <span className="text-slate-500 font-semibold">Account Holder:</span>
                  <span className="font-bold text-slate-950">{currentUser.firstName} {currentUser.lastName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-semibold">Country of Record:</span>
                  <span className="font-bold text-slate-950">{currentUser.country || 'Nigeria'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-semibold">Document Type:</span>
                  <span className="font-bold text-slate-950">{currentUser.kycDocumentType || 'Passport'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-semibold">Document Number:</span>
                  <span className="font-bold text-slate-950">{currentUser.kycDocumentNumber || '••••••••'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-semibold">Verification Status:</span>
                  <span className="font-black text-sky-700 uppercase flex items-center gap-1">
                    <BlueVerifiedBadge size={14} /> OFFICIALLY VERIFIED
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-semibold">Daily Limit:</span>
                  <span className="font-bold text-slate-950">$1,000,000.00 USD</span>
                </div>
              </div>

              <button
                onClick={onClose}
                className="w-full max-w-md mx-auto py-3.5 px-6 rounded-xl font-black text-sm text-white bg-slate-950 hover:bg-slate-900 transition-all cursor-pointer shadow-md"
              >
                Return to Dashboard
              </button>
            </div>
          ) : isAutoVerifying || isPending ? (
            /* STATE 2: REVIEW IN PROGRESS (5–10 MINUTES COUNTDOWN) */
            <div className="space-y-6 py-4">
              <div className="p-6 rounded-2xl bg-amber-50 border-2 border-amber-300 space-y-4">
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-2xl bg-amber-500 text-white flex items-center justify-center animate-pulse shadow-md">
                    <Clock className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="font-black text-base text-amber-950">
                      KYC Review Underway (5–10 Minutes Turnaround)
                    </h4>
                    <p className="text-xs text-amber-800 font-semibold">
                      Your identity documents and biometric photo are being processed through our compliance engine.
                    </p>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="space-y-2">
                  <div className="w-full bg-amber-200 h-3.5 rounded-full overflow-hidden p-0.5">
                    <div
                      className="bg-gradient-to-r from-amber-500 to-amber-600 h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.max(verificationProgress, 25)}%` }}
                    />
                  </div>
                  <div className="text-xs font-mono font-bold text-amber-950 flex justify-between">
                    <span>{currentStepText || 'Processing compliance scan & document verification...'}</span>
                    <span>{verificationProgress > 0 ? `${verificationProgress}%` : 'In Queue'}</span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 p-4 rounded-2xl border-2 border-slate-200 space-y-2 text-xs text-slate-700">
                <div className="font-black text-slate-950 uppercase font-mono tracking-wider">
                  Automated Verification Details
                </div>
                <p className="font-medium">
                  Once the automated 5–10 minute check verifies your document holographic security features, MRZ code, and biometric selfie, your account will be unlocked with full institutional limits.
                </p>
              </div>

              {/* Fast-Track instant button */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleInstantFastTrack}
                  className="w-full py-3.5 px-5 rounded-xl font-black text-xs sm:text-sm text-slate-950 bg-gradient-to-r from-sky-400 via-teal-300 to-sky-400 hover:from-sky-300 hover:to-teal-200 border-2 border-sky-600 shadow-md flex items-center justify-center gap-2 cursor-pointer active:scale-98 transition-all"
                >
                  <Zap className="w-4 h-4 text-sky-950" />
                  <span>Fast-Track Instant Compliance Verification</span>
                </button>
                <span className="text-[11px] text-slate-500 text-center block mt-1.5 font-semibold">
                  Fast-forward the 5–10 minute queue to clear and verify your account immediately.
                </span>
              </div>
            </div>
          ) : (
            /* STATE 3: COMPLETE KYC FORM */
            <form onSubmit={handleSubmit} className="space-y-5">
              {errorMsg && (
                <div className="p-3.5 rounded-xl bg-red-50 border-2 border-red-200 text-xs text-red-700 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="font-bold">{errorMsg}</span>
                </div>
              )}

              <div className="p-4 rounded-2xl bg-sky-50 border-2 border-sky-200 space-y-1 text-xs text-sky-950">
                <div className="font-black flex items-center gap-1.5 uppercase font-mono tracking-wider">
                  <Sparkles className="w-4 h-4 text-sky-700" /> Identity Onboarding & Regulatory Verification
                </div>
                <p className="font-medium">
                  Please provide your legal name, country, government-issued identification, proof of address, and direct live selfie. Verification turnaround is 5–10 minutes.
                </p>
              </div>

              {/* 1. Legal First Name & Second Name */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-xs font-black text-slate-800 uppercase tracking-wider font-mono">
                    First Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. John"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white text-slate-900 text-sm font-bold rounded-xl border-2 border-slate-300 focus:border-slate-950 focus:outline-hidden"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-black text-slate-800 uppercase tracking-wider font-mono">
                    Second Name (Last Name) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Doe"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white text-slate-900 text-sm font-bold rounded-xl border-2 border-slate-300 focus:border-slate-950 focus:outline-hidden"
                  />
                </div>
              </div>

              {/* 2. Country Selector */}
              <CountrySelector
                value={country}
                onChange={(c) => setCountry(c.name)}
                label="Country of Citizenship"
                required
              />

              {/* 3. US SSN Field (If United States selected) */}
              {isUnitedStates && (
                <div className="space-y-1.5 p-3.5 rounded-2xl bg-slate-50 border-2 border-slate-200">
                  <label className="block text-xs font-black text-slate-800 uppercase tracking-wider font-mono flex items-center justify-between">
                    <span>Social Security Number (SSN - 9 Digits) <span className="text-red-500">*</span></span>
                    <span className="text-sky-700 font-mono text-[11px]">Format: XXX-XX-XXXX</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={ssnNumber}
                    onChange={handleSsnChange}
                    placeholder="e.g. 123-45-6789"
                    maxLength={11}
                    className="w-full px-3.5 py-2.5 text-sm font-mono font-bold rounded-xl border-2 border-slate-300 focus:border-slate-950 focus:outline-hidden bg-white text-slate-900"
                  />
                  <p className="text-[11px] text-slate-500 font-semibold">
                    Required under United States FinCEN banking regulatory compliance.
                  </p>
                </div>
              )}

              {/* 4. Select Government ID Type */}
              <div className="space-y-1.5">
                <label className="block text-xs font-black text-slate-800 uppercase tracking-wider font-mono">
                  Select ID Type <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { id: 'Passport', label: 'Passport' },
                    { id: 'National ID', label: 'National ID' },
                    { id: "Driver's License", label: "Driver's License" },
                    { id: 'Resident Permit', label: 'Resident Permit' },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setDocumentType(item.id)}
                      className={`py-2.5 px-2 rounded-xl text-xs font-black border-2 transition-all cursor-pointer text-center ${
                        documentType === item.id
                          ? 'bg-slate-950 text-white border-slate-950 shadow-sm'
                          : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 5. Upload Image of Passport / Selected ID (Crucial step) */}
              <div className="space-y-1.5">
                <label className="block text-xs font-black text-slate-800 uppercase tracking-wider font-mono">
                  Upload Image of {documentType} <span className="text-red-500">*</span>
                </label>

                <input
                  ref={docFileRef}
                  type="file"
                  accept="image/*,.pdf"
                  className="hidden"
                  onChange={(e) => handleFileUpload(e, setDocumentImage)}
                />

                {documentImage ? (
                  <div className="p-3.5 rounded-2xl bg-emerald-50 border-2 border-emerald-300 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-emerald-100 overflow-hidden border border-emerald-300 flex items-center justify-center shrink-0">
                        <img
                          src={documentImage}
                          alt="Document Preview"
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div>
                        <div className="text-xs font-black text-emerald-950 flex items-center gap-1">
                          <Check className="w-4 h-4 text-emerald-600" />
                          <span>{documentType} Image Attached</span>
                        </div>
                        <div className="text-[11px] text-emerald-700 font-mono">Ready for OCR extraction</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => docFileRef.current?.click()}
                        className="px-2.5 py-1.5 rounded-lg bg-emerald-200 hover:bg-emerald-300 text-emerald-950 text-xs font-bold transition-colors cursor-pointer"
                      >
                        Change
                      </button>
                      <button
                        type="button"
                        onClick={() => setDocumentImage('')}
                        className="p-1.5 rounded-lg text-red-600 hover:bg-red-100 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    onClick={() => docFileRef.current?.click()}
                    className="p-5 rounded-2xl border-2 border-dashed border-slate-300 hover:border-slate-900 bg-slate-50 hover:bg-slate-100/80 transition-all text-center cursor-pointer space-y-2 group"
                  >
                    <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 text-slate-600 flex items-center justify-center mx-auto group-hover:scale-110 transition-transform">
                      <Upload className="w-5 h-5" />
                    </div>
                    <div className="text-xs font-black text-slate-800">
                      Click to upload photo page of your {documentType}
                    </div>
                    <div className="text-[11px] text-slate-500 font-medium">
                      PNG, JPG, or PDF (Max 10MB) • High resolution with visible corners
                    </div>
                  </div>
                )}
              </div>

              {/* 6. Document ID Code / Number */}
              <div className="space-y-1.5">
                <label className="block text-xs font-black text-slate-800 uppercase tracking-wider font-mono">
                  {documentType} Number / ID Code <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    placeholder="e.g. A12345678 or NG-PASS-904812"
                    value={documentNumber}
                    onChange={(e) => setDocumentNumber(e.target.value)}
                    className="w-full px-4 py-3 text-sm font-mono font-bold rounded-xl border-2 border-slate-300 focus:border-slate-950 focus:outline-hidden bg-white uppercase"
                  />
                  <FileText className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5" />
                </div>
              </div>

              {/* 7. Residential Street Address */}
              <div className="space-y-1.5">
                <label className="block text-xs font-black text-slate-800 uppercase tracking-wider font-mono">
                  Residential Street Address <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    placeholder="e.g. Plot 14, Victoria Island, Lagos, Nigeria"
                    value={streetAddress}
                    onChange={(e) => setStreetAddress(e.target.value)}
                    className="w-full px-4 py-3 text-sm font-bold rounded-xl border-2 border-slate-300 focus:border-slate-950 focus:outline-hidden bg-white"
                  />
                  <MapPin className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5" />
                </div>
              </div>

              {/* 8. Proof of Address Upload & Direct Live Selfie */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                
                {/* Proof of Address */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-black text-slate-800 uppercase tracking-wider font-mono">
                    Proof of Address <span className="text-red-500">*</span>
                  </label>
                  <input
                    ref={proofFileRef}
                    type="file"
                    accept="image/*,.pdf"
                    className="hidden"
                    onChange={(e) => handleFileUpload(e, setProofOfAddressImage)}
                  />

                  {proofOfAddressImage ? (
                    <div className="p-3 rounded-xl bg-emerald-50 border-2 border-emerald-300 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span className="text-xs font-black text-emerald-950">Proof Attached</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => proofFileRef.current?.click()}
                        className="text-xs font-bold text-emerald-900 underline cursor-pointer"
                      >
                        Change
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => proofFileRef.current?.click()}
                      className="w-full p-3 rounded-xl border-2 border-dashed border-slate-300 hover:border-slate-900 bg-slate-50 text-left flex items-center justify-between cursor-pointer"
                    >
                      <span className="text-xs font-bold text-slate-700">Attach Utility / Bank Bill</span>
                      <Upload className="w-4 h-4 text-slate-500" />
                    </button>
                  )}
                </div>

                {/* Direct Live Selfie */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-black text-slate-800 uppercase tracking-wider font-mono">
                    Live Biometric Selfie <span className="text-red-500">*</span>
                  </label>
                  <input
                    ref={selfieFileRef}
                    type="file"
                    accept="image/*"
                    capture="user"
                    className="hidden"
                    onChange={(e) => handleFileUpload(e, setLiveSelfieImage)}
                  />

                  {liveSelfieImage ? (
                    <div className="p-3 rounded-xl bg-emerald-50 border-2 border-emerald-300 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <Camera className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span className="text-xs font-black text-emerald-950">Selfie Captured</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => selfieFileRef.current?.click()}
                        className="text-xs font-bold text-emerald-900 underline cursor-pointer"
                      >
                        Retake
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => selfieFileRef.current?.click()}
                      className="w-full p-3 rounded-xl border-2 border-dashed border-slate-300 hover:border-slate-900 bg-slate-50 text-left flex items-center justify-between cursor-pointer"
                    >
                      <span className="text-xs font-bold text-slate-700">Take Live Camera Photo</span>
                      <Camera className="w-4 h-4 text-slate-500" />
                    </button>
                  )}
                </div>
              </div>

              {/* Submit for KYC Review Button */}
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-4 px-6 rounded-2xl font-black text-sm text-white bg-gradient-to-b from-slate-900 to-black hover:from-slate-800 hover:to-slate-950 transition-all shadow-xl flex items-center justify-center gap-2 cursor-pointer border border-slate-700 active:scale-98 disabled:opacity-50"
                >
                  <ShieldCheck className="w-5 h-5 text-sky-400" />
                  <span>
                    {isSubmitting ? 'Submitting for KYC Review...' : 'Submit for KYC Review'}
                  </span>
                </button>
                <span className="text-[11px] text-slate-500 text-center block mt-2 font-semibold">
                  By submitting, your documentation is encrypted and verified against official regulatory compliance databases (5–10 min turnaround).
                </span>
              </div>
            </form>
          )}

        </div>
      </div>
    </div>
  );
};
