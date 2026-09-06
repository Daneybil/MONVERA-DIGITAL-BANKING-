import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
  ArrowRight,
  X,
  FileText,
  CheckCircle2,
  Lock,
} from 'lucide-react';

export const KycStatusAlertModal: React.FC = () => {
  const { currentUser, refreshNotifications, setCurrentView } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [activeType, setActiveType] = useState<'rejected' | 'verified' | null>(null);

  useEffect(() => {
    if (!currentUser?.id) {
      setIsOpen(false);
      return;
    }

    const kycStatus = currentUser.kycStatus;
    const reason = currentUser.kycRejectionReason || '';

    if (kycStatus === 'action_required' || kycStatus === 'rejected') {
      const dismissKey = `monvera_kyc_dismiss_${currentUser.id}_rejected_${reason}`;
      const dismissed = sessionStorage.getItem(dismissKey);
      if (!dismissed) {
        setActiveType('rejected');
        setIsOpen(true);
      }
    } else if (kycStatus === 'verified') {
      const dismissKey = `monvera_kyc_dismiss_${currentUser.id}_verified`;
      const dismissed = sessionStorage.getItem(dismissKey);
      if (!dismissed) {
        setActiveType('verified');
        setIsOpen(true);
      }
    } else {
      setIsOpen(false);
    }
  }, [currentUser?.id, currentUser?.kycStatus, currentUser?.kycRejectionReason]);

  // Real-time listener for instant notification popup upon admin adjudication
  useEffect(() => {
    const handleKycStatusUpdated = (e: any) => {
      const detail = e.detail;
      if (!detail || !currentUser?.id) return;

      if (detail.userId === currentUser.id) {
        refreshNotifications();
        if (detail.kycStatus === 'action_required' || detail.kycStatus === 'rejected') {
          const reason = detail.user?.kycRejectionReason || currentUser.kycRejectionReason || '';
          sessionStorage.removeItem(`monvera_kyc_dismiss_${currentUser.id}_rejected_${reason}`);
          setActiveType('rejected');
          setIsOpen(true);
        } else if (detail.kycStatus === 'verified') {
          sessionStorage.removeItem(`monvera_kyc_dismiss_${currentUser.id}_verified`);
          setActiveType('verified');
          setIsOpen(true);
        }
      }
    };

    window.addEventListener('monvera_kyc_status_updated', handleKycStatusUpdated);
    return () => {
      window.removeEventListener('monvera_kyc_status_updated', handleKycStatusUpdated);
    };
  }, [currentUser?.id, currentUser?.kycRejectionReason, refreshNotifications]);

  const handleDismiss = () => {
    if (!currentUser?.id) {
      setIsOpen(false);
      return;
    }

    if (activeType === 'rejected') {
      const reason = currentUser.kycRejectionReason || '';
      sessionStorage.setItem(`monvera_kyc_dismiss_${currentUser.id}_rejected_${reason}`, 'true');
    } else if (activeType === 'verified') {
      sessionStorage.setItem(`monvera_kyc_dismiss_${currentUser.id}_verified`, 'true');
    }
    setIsOpen(false);
  };

  const handleReSubmit = () => {
    handleDismiss();
    setCurrentView('profile');
    setTimeout(() => {
      const kycSection = document.getElementById('kyc-verification-card');
      if (kycSection) {
        kycSection.scrollIntoView({ behavior: 'smooth' });
      }
    }, 150);
  };

  if (!isOpen || !activeType || !currentUser) return null;

  return (
    <div
      id="kyc-status-alert-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs animate-fadeIn"
      role="dialog"
      aria-modal="true"
    >
      <div
        id="kyc-status-alert-card"
        className="w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden animate-scaleIn text-slate-900"
      >
        {activeType === 'rejected' ? (
          <>
            {/* Rejection / Action Required Header */}
            <div className="p-6 bg-gradient-to-br from-rose-50 via-rose-100/50 to-amber-50 border-b border-rose-200">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-rose-600 text-white flex items-center justify-center shrink-0 shadow-lg shadow-rose-600/20">
                    <AlertTriangle className="w-6 h-6 stroke-[2.5]" />
                  </div>
                  <div>
                    <span className="inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-wider text-rose-800 bg-rose-200/80 px-2.5 py-0.5 rounded-full border border-rose-300">
                      Action Required
                    </span>
                    <h3 className="text-xl font-black text-slate-900 tracking-tight mt-1">
                      Identity Verification Update
                    </h3>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleDismiss}
                  className="p-2 text-slate-400 hover:text-slate-600 hover:bg-rose-200/50 rounded-xl transition-colors cursor-pointer"
                  title="Close alert"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Content Body */}
            <div className="p-6 space-y-5">
              <p className="text-sm font-semibold text-slate-600 leading-relaxed">
                The compliance & regulatory verification department has reviewed your identity documents and requires updated documentation before tier limits can be lifted.
              </p>

              {/* Compliance Note Box */}
              <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200/90 space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-black text-rose-900 uppercase tracking-wider">
                  <ShieldAlert className="w-4 h-4 text-rose-600" />
                  <span>Compliance Reviewer Reason</span>
                </div>
                <div className="text-sm font-bold text-rose-950 bg-white/80 p-3 rounded-xl border border-rose-200">
                  {currentUser.kycRejectionReason || 'Document details could not be certified. Please re-upload clear, uncropped identification.'}
                </div>
              </div>

              {/* Notice info */}
              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600">
                <FileText className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                <div>
                  A permanent record has been logged in your <strong>Notification Center</strong>. Please re-submit your documents promptly to ensure uninterrupted service.
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col sm:flex-row items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleDismiss}
                  className="w-full sm:w-auto px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  Review Later
                </button>
                <button
                  type="button"
                  onClick={handleReSubmit}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-black flex items-center justify-center gap-2 transition-all shadow-md shadow-rose-600/20 cursor-pointer"
                >
                  <span>Re-submit Documents</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Approval Header */}
            <div className="p-6 bg-gradient-to-br from-emerald-50 via-teal-50 to-blue-50 border-b border-emerald-200">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-lg shadow-emerald-600/20">
                    <CheckCircle2 className="w-6 h-6 stroke-[2.5]" />
                  </div>
                  <div>
                    <span className="inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-wider text-emerald-800 bg-emerald-200/80 px-2.5 py-0.5 rounded-full border border-emerald-300">
                      Tier 3 Certified
                    </span>
                    <h3 className="text-xl font-black text-slate-900 tracking-tight mt-1">
                      Identity Verification Approved!
                    </h3>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleDismiss}
                  className="p-2 text-slate-400 hover:text-slate-600 hover:bg-emerald-200/50 rounded-xl transition-colors cursor-pointer"
                  title="Close alert"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Content Body */}
            <div className="p-6 space-y-5">
              <p className="text-sm font-semibold text-slate-600 leading-relaxed">
                Your regulatory identity documents have been certified and approved by Monvera Compliance. All features, wire capabilities, and accounts are fully operational.
              </p>

              {/* Limit unlocked box */}
              <div className="p-4 rounded-2xl bg-emerald-50/80 border border-emerald-200 flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-emerald-800 uppercase tracking-wider block">
                    Daily Outbound Transaction Limit
                  </span>
                  <span className="font-mono font-black text-emerald-950 text-xl block mt-0.5">
                    $1,000,000.00 USD
                  </span>
                </div>
                <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center">
                  <ShieldCheck className="w-5 h-5" />
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end pt-2">
                <button
                  type="button"
                  onClick={handleDismiss}
                  className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black transition-all shadow-md shadow-emerald-600/20 cursor-pointer"
                >
                  Continue to Banking Dashboard
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
