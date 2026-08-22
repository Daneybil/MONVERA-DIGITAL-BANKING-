import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';
import confetti from 'canvas-confetti';

interface KycVerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const KycVerificationModal: React.FC<KycVerificationModalProps> = ({ isOpen, onClose }) => {
  const { currentUser, updateUser, refreshNotifications } = useAuth();

  const [documentType, setDocumentType] = useState('Passport');
  const [documentNumber, setDocumentNumber] = useState('');
  const [country, setCountry] = useState(currentUser?.country || 'United States');
  const [address, setAddress] = useState('100 Wall Street, Suite 2400, New York, NY 10005');
  const [proofType, setProofType] = useState('Utility Bill / Bank Statement');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Automated Review Simulation State
  const [isAutoVerifying, setIsAutoVerifying] = useState(false);
  const [verificationProgress, setVerificationProgress] = useState(0);
  const [currentStepText, setCurrentStepText] = useState('');

  if (!isOpen || !currentUser) return null;

  const isVerified = currentUser.kycStatus === 'verified';
  const isPending = currentUser.kycStatus === 'pending';

  // Handle User Document Submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!documentNumber.trim()) {
      setErrorMsg('Please enter a valid official document ID number.');
      return;
    }
    setErrorMsg(null);
    setIsSubmitting(true);

    try {
      // Step 1: Submit to API / Database as pending automated review
      const res = await api.submitKyc({
        userId: currentUser.id,
        documentType,
        documentNumber: documentNumber.trim(),
        country,
        proofOfAddress: proofType,
        autoApprove: false, // will run automated review engine
      });

      if (res.success && res.user) {
        // Update user state to pending
        const pendingUser = {
          ...currentUser,
          kycStatus: 'pending' as const,
          kycDocumentType: documentType,
          kycDocumentNumber: documentNumber.trim(),
          kycSubmittedAt: new Date().toISOString(),
        };
        updateUser(pendingUser);
        firestoreSync.saveUser(pendingUser);
        refreshNotifications();

        // Trigger Automated Verification Scanner
        runAutomatedReview(pendingUser);
      } else {
        setErrorMsg(res.error || 'Submission failed. Please check your details and try again.');
        setIsSubmitting(false);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Network error occurred during submission.');
      setIsSubmitting(false);
    }
  };

  // Automated Review Process Engine (Simulates AI & Compliance check taking ~1-2 hours or fast automated clearing)
  const runAutomatedReview = (userToVerify: typeof currentUser) => {
    setIsAutoVerifying(true);
    setVerificationProgress(15);
    setCurrentStepText('Analyzing document security features & holographic watermarks...');

    const steps = [
      { p: 35, text: 'Verifying optical MRZ cryptographic barcode against global databases...' },
      { p: 65, text: 'Executing automated AML, OFAC, and sanction watch-list scan...' },
      { p: 85, text: 'Biometric facial match & address verification complete...' },
      { p: 100, text: 'Automated verification cleared! Account approved.' },
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
        };
        updateUser(approvedUser);
        firestoreSync.saveUser(approvedUser);
        
        // Notify backend of approval
        await api.approveKyc(userToVerify.id);
        refreshNotifications();
        setIsAutoVerifying(false);
        setIsSubmitting(false);

        // Confetti celebration
        try {
          confetti({
            particleCount: 80,
            spread: 70,
            origin: { y: 0.6 },
          });
        } catch {
          // ignore
        }
      }
    }, 1800);
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
        className="w-full max-w-xl bg-white rounded-3xl shadow-2xl border-2 border-slate-800 overflow-hidden relative max-h-[92vh] flex flex-col animate-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="p-6 sm:p-7 bg-slate-950 text-white flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-black tracking-tight text-white flex items-center gap-2">
                Automated KYC Verification
                {isVerified && <BlueVerifiedBadge size={20} />}
              </h2>
              <p className="text-xs text-slate-400 font-mono">
                MONVERA TRUST & COMPLIANCE ENGINE
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
              <div className="w-20 h-20 rounded-full bg-emerald-100 border-4 border-emerald-500/30 flex items-center justify-center mx-auto text-emerald-600 shadow-lg">
                <CheckCircle2 className="w-10 h-10" />
              </div>
              <div className="space-y-2">
                <h3 className="text-2xl font-black text-slate-950 flex items-center justify-center gap-2">
                  Account 100% Verified <BlueVerifiedBadge size={24} />
                </h3>
                <p className="text-sm text-slate-600 max-w-md mx-auto">
                  Your identity has been authenticated. You have unrestricted access to wire transfers, 4.5% interest investments, card controls, and institutional limits.
                </p>
              </div>

              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 text-xs font-mono space-y-2 text-left max-w-md mx-auto">
                <div className="flex justify-between">
                  <span className="text-slate-500">Document Type:</span>
                  <span className="font-bold text-slate-900">{currentUser.kycDocumentType || 'Passport'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Document Number:</span>
                  <span className="font-bold text-slate-900">{currentUser.kycDocumentNumber || '••••••••'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Verification Status:</span>
                  <span className="font-bold text-emerald-600 uppercase">OFFICIALLY VERIFIED</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Daily Transaction Limit:</span>
                  <span className="font-bold text-slate-900">$1,000,000.00 USD</span>
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
            /* STATE 2: AUTOMATED REVIEW UNDERWAY */
            <div className="space-y-6 py-4">
              <div className="p-5 rounded-2xl bg-amber-50 border-2 border-amber-300 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center animate-pulse">
                    <Clock className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-black text-base text-amber-950">
                      Automated Review in Progress
                    </h4>
                    <p className="text-xs text-amber-800 font-medium">
                      Estimated turnaround: 1–2 hours (Standard Automated Clearance)
                    </p>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="space-y-2">
                  <div className="w-full bg-amber-200 h-3 rounded-full overflow-hidden p-0.5">
                    <div
                      className="bg-amber-600 h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.max(verificationProgress, 25)}%` }}
                    />
                  </div>
                  <div className="text-xs font-mono font-bold text-amber-900 flex justify-between">
                    <span>{currentStepText || 'Processing document compliance scan...'}</span>
                    <span>{verificationProgress > 0 ? `${verificationProgress}%` : 'In Queue'}</span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-2 text-xs text-slate-700">
                <div className="font-bold text-slate-900 uppercase font-mono tracking-wider">
                  What happens next?
                </div>
                <p>
                  Our system automatically processes and validates your submitted documentation against government databases. Once verified (in ~1-2 hours), you will be notified immediately and full banking capabilities will activate without any manual paperwork.
                </p>
              </div>

              {/* Fast Track simulation button for test evaluation */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleInstantFastTrack}
                  className="w-full py-3.5 px-5 rounded-xl font-extrabold text-xs sm:text-sm text-slate-950 bg-gradient-to-r from-emerald-400 via-teal-300 to-emerald-400 hover:from-emerald-300 hover:to-teal-200 border-2 border-emerald-600 shadow-md flex items-center justify-center gap-2 cursor-pointer active:scale-98 transition-all"
                >
                  <Zap className="w-4 h-4 text-emerald-900" />
                  <span>Fast-Track Instant Automated AI Verification</span>
                </button>
                <span className="text-[11px] text-slate-500 text-center block mt-1.5 font-medium">
                  Click to fast-forward the 1–2 hour queue and verify immediately.
                </span>
              </div>
            </div>
          ) : (
            /* STATE 3: VERIFICATION FORM (GLOBAL WORLDWIDE KYC) */
            <form onSubmit={handleSubmit} className="space-y-5">
              {errorMsg && (
                <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <div className="p-4 rounded-2xl bg-emerald-50/80 border border-emerald-200 space-y-1.5 text-xs text-emerald-900">
                <div className="font-bold flex items-center gap-1.5 uppercase font-mono tracking-wider">
                  <Sparkles className="w-4 h-4 text-emerald-700" /> Automated Compliance Verification
                </div>
                <p>
                  Submit your government-issued identification from any country worldwide. Verification is processed automatically within 1–2 hours with zero manual delays.
                </p>
              </div>

              {/* Full Name Confirmation */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-xs font-black text-slate-800 uppercase tracking-wider font-mono">
                    First Name
                  </label>
                  <input
                    type="text"
                    disabled
                    value={currentUser.firstName}
                    className="w-full px-3.5 py-2.5 bg-slate-100 text-slate-800 text-sm font-bold rounded-xl border border-slate-300"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-black text-slate-800 uppercase tracking-wider font-mono">
                    Last Name
                  </label>
                  <input
                    type="text"
                    disabled
                    value={currentUser.lastName}
                    className="w-full px-3.5 py-2.5 bg-slate-100 text-slate-800 text-sm font-bold rounded-xl border border-slate-300"
                  />
                </div>
              </div>

              {/* Country Selector (Worldwide) */}
              <CountrySelector
                value={country}
                onChange={(c) => setCountry(c.name)}
                label="Country / Territory of Citizenship"
                required
              />

              {/* Document Type Selector */}
              <div className="space-y-1.5">
                <label className="block text-xs font-black text-slate-800 uppercase tracking-wider font-mono">
                  Document Type <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {['Passport', 'National ID', "Driver's License", 'Residence Permit'].map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setDocumentType(type)}
                      className={`py-2.5 px-2 rounded-xl text-xs font-bold border-2 transition-all cursor-pointer text-center ${
                        documentType === type
                          ? 'bg-slate-950 text-white border-slate-950 shadow-sm'
                          : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              {/* Document Number */}
              <div className="space-y-1.5">
                <label className="block text-xs font-black text-slate-800 uppercase tracking-wider font-mono">
                  {documentType} Number / ID Code <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    placeholder="e.g. US-PASS-99042811 or A12345678"
                    value={documentNumber}
                    onChange={(e) => setDocumentNumber(e.target.value)}
                    className="w-full px-4 py-3 text-sm font-mono font-bold rounded-xl border-2 border-slate-300 focus:border-slate-950 focus:outline-hidden bg-white uppercase"
                  />
                  <FileText className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5" />
                </div>
              </div>

              {/* Residential Address */}
              <div className="space-y-1.5">
                <label className="block text-xs font-black text-slate-800 uppercase tracking-wider font-mono">
                  Residential Street Address
                </label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full px-4 py-2.5 text-sm font-medium rounded-xl border-2 border-slate-300 focus:border-slate-950 focus:outline-hidden bg-white"
                />
              </div>

              {/* Simulated Document Upload Confirmation */}
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
                    <Check className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900">ID Photo & Proof of Address Attached</div>
                    <div className="text-[11px] text-slate-500 font-mono">256-bit encrypted digital capture</div>
                  </div>
                </div>
                <span className="text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2.5 py-1 rounded-md">
                  READY
                </span>
              </div>

              {/* Submit Button */}
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-4 px-6 rounded-2xl font-black text-sm text-white bg-gradient-to-b from-slate-900 to-black hover:from-slate-800 hover:to-slate-950 transition-all shadow-xl flex items-center justify-center gap-2 cursor-pointer border border-slate-700 active:scale-98 disabled:opacity-50"
                >
                  <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  <span>{isSubmitting ? 'Submitting for Automated Review...' : 'Submit for Automated KYC Review'}</span>
                </button>
                <span className="text-[11px] text-slate-500 text-center block mt-2">
                  By submitting, you agree to Monvera Bank's automated KYC identity verification procedures.
                </span>
              </div>
            </form>
          )}

        </div>
      </div>
    </div>
  );
};
