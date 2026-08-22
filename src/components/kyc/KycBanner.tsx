import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { KycVerificationModal } from './KycVerificationModal';
import { ShieldAlert, ShieldCheck, Clock, ArrowRight, Zap, Sparkles } from 'lucide-react';
import { BlueVerifiedBadge } from '../dashboard/ProfileView';

export const KycBanner: React.FC = () => {
  const { currentUser } = useAuth();
  const [isModalOpen, setIsModalOpen] = useState(false);

  if (!currentUser) return null;

  const isVerified = currentUser.kycStatus === 'verified';
  const isPending = currentUser.kycStatus === 'pending';

  if (isVerified) {
    return null; // No need for banner if verified
  }

  return (
    <>
      <div className="w-full rounded-2xl overflow-hidden shadow-lg border-2 border-amber-400 bg-gradient-to-r from-amber-500 via-amber-600 to-amber-700 text-white p-4 sm:p-5 relative animate-in fade-in slide-in-from-top-2 duration-300">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-xs flex items-center justify-center text-white shrink-0 shadow-inner">
              {isPending ? <Clock className="w-6 h-6 animate-pulse" /> : <ShieldAlert className="w-6 h-6" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs uppercase font-black tracking-wider bg-black/30 px-2.5 py-0.5 rounded-md text-amber-200">
                  {isPending ? 'KYC REVIEW UNDERWAY' : 'ACTION REQUIRED'}
                </span>
                <span className="text-xs text-amber-100 font-bold">Monvera Global Compliance</span>
              </div>
              <h3 className="text-base sm:text-lg font-black text-white mt-1 leading-tight">
                {isPending
                  ? 'Automated Identity Review in Progress (1–2 Hours)'
                  : 'Verify Your Account to Unlock Full Banking Services'}
              </h3>
              <p className="text-xs sm:text-sm text-amber-100 mt-0.5 max-w-2xl font-medium">
                {isPending
                  ? 'Your documents have been submitted to our automated compliance engine. Verification is completed automatically with zero manual delays.'
                  : 'Complete fast automated identity verification with your official ID to unlock instant transfers, 4.50% interest investments, and cards.'}
              </p>
            </div>
          </div>

          <div className="w-full sm:w-auto shrink-0 flex items-center gap-2">
            <button
              id="dashboard-verify-kyc-btn"
              onClick={() => setIsModalOpen(true)}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-black text-sm text-slate-950 bg-white hover:bg-amber-50 border-2 border-amber-300 shadow-md cursor-pointer transition-all active:scale-95 select-none"
            >
              {isPending ? (
                <>
                  <Clock className="w-4 h-4 text-amber-700" />
                  <span>Check KYC Status</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4 text-emerald-700" />
                  <span>Verify KYC</span>
                  <ArrowRight className="w-4 h-4 text-slate-950" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      <KycVerificationModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </>
  );
};
