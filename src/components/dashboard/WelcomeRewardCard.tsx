import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { WelcomeRewardInfo } from '../../types';
import {
  Gift,
  CheckCircle2,
  Clock,
  ArrowRight,
  Sparkles,
  TrendingUp,
  Plus,
  RefreshCw,
  Copy,
  Check,
  X,
} from 'lucide-react';

export interface WelcomeRewardButtonProps {
  onClick: () => void;
  isVerified?: boolean;
}

/**
 * Dedicated Quick Banking Action button matching Send/Deposit buttons
 */
export const WelcomeRewardButton: React.FC<WelcomeRewardButtonProps> = ({ onClick }) => {
  return (
    <button
      id="action-btn-welcome-reward"
      onClick={onClick}
      type="button"
      className="p-5 sm:p-6 rounded-3xl bg-white border-2 shadow-md hover:shadow-xl active:translate-y-1 transition-all text-center flex flex-col items-center justify-center gap-3 group cursor-pointer relative border-amber-300 hover:border-amber-500 hover:bg-amber-50/40"
    >
      <div className="w-14 h-14 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center group-hover:scale-110 group-hover:bg-amber-400 group-hover:text-slate-950 transition-all shadow-sm">
        <Gift className="w-7 h-7 stroke-[2.5]" />
      </div>
      <div>
        <span className="text-base font-black text-slate-950 block">Welcome Reward</span>
        <span className="text-xs text-amber-700 font-bold block">$1,000 Bonus</span>
      </div>
    </button>
  );
};

export interface WelcomeRewardCardProps {
  isOpen?: boolean;
  onClose?: () => void;
  onOpenDeposit?: () => void;
}

export const WelcomeRewardCard: React.FC<WelcomeRewardCardProps> = ({
  isOpen,
  onClose,
  onOpenDeposit,
}) => {
  const { currentUser, openModal } = useAuth();
  const [internalOpen, setInternalOpen] = useState<boolean>(false);
  const [reward, setReward] = useState<WelcomeRewardInfo | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [copiedRef, setCopiedRef] = useState<boolean>(false);

  const isControlled = isOpen !== undefined;
  const showModal = isControlled ? isOpen : internalOpen;

  const handleClose = () => {
    if (isControlled) {
      onClose?.();
    } else {
      setInternalOpen(false);
    }
  };

  const fetchRewardStatus = async () => {
    if (!currentUser?.id) return;
    try {
      const res = await api.getWelcomeReward(currentUser.id);
      if (res.success && res.reward) {
        setReward(res.reward);
      }
    } catch (err) {
      console.warn('[WelcomeRewardCard] Error fetching reward status:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRewardStatus();

    // Listen for real-time balance or transaction update events
    const handleUpdate = () => {
      fetchRewardStatus();
    };

    window.addEventListener('monvera_balance_updated', handleUpdate);
    window.addEventListener('monvera_transaction_created', handleUpdate);

    return () => {
      window.removeEventListener('monvera_balance_updated', handleUpdate);
      window.removeEventListener('monvera_transaction_created', handleUpdate);
    };
  }, [currentUser?.id]);

  // Handle Escape key to close modal
  useEffect(() => {
    if (!showModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showModal]);

  const handleCopyRef = (refText?: string) => {
    if (!refText) return;
    try {
      navigator.clipboard.writeText(refText);
      setCopiedRef(true);
      setTimeout(() => setCopiedRef(false), 2000);
    } catch {}
  };

  const targetAmount = reward?.targetAmount ?? 10000;
  const rewardAmount = reward?.rewardAmount ?? 1000;
  const qualifyingDeposits = reward?.qualifyingDeposits ?? 0;
  const progressPercentage = reward?.progressPercentage ?? Math.min(100, (qualifyingDeposits / targetAmount) * 100);
  const remainingAmount = reward?.remainingAmount ?? Math.max(0, targetAmount - qualifyingDeposits);
  const status = reward?.status ?? (qualifyingDeposits >= targetAmount ? 'QUALIFIED' : 'IN_PROGRESS');
  const isPaid = status === 'PAID';

  // If uncontrolled, render the button by default in place
  const buttonElement = !isControlled ? (
    <WelcomeRewardButton onClick={() => setInternalOpen(true)} />
  ) : null;

  if (!showModal) {
    return buttonElement;
  }

  return (
    <>
      {buttonElement}

      {/* Modal Dialog Overlay */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs overflow-y-auto"
        onClick={(e) => {
          if (e.target === e.currentTarget) handleClose();
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-reward-modal-title"
      >
        <div
          id="welcome-reward-modal-container"
          className="relative w-full max-w-2xl bg-white rounded-3xl p-6 sm:p-8 border-2 border-slate-200/90 shadow-2xl my-8 overflow-hidden transition-all text-slate-900"
        >
          {/* Subtle Ambient Accent Glow */}
          <div
            className={`absolute -top-16 -right-16 w-56 h-56 rounded-full blur-3xl pointer-events-none opacity-40 ${
              isPaid ? 'bg-emerald-400/30' : 'bg-amber-400/25'
            }`}
          />

          <div className="relative z-10 space-y-6">
            {/* Header Row: Title, Program Tag, Refresh & Close Buttons */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div
                  className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-sm border ${
                    isPaid
                      ? 'bg-emerald-500 text-white border-emerald-400'
                      : 'bg-amber-400/20 text-amber-700 border-amber-400/40'
                  }`}
                >
                  <Gift className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-black uppercase tracking-wider text-slate-500">
                      New User Welcome Reward
                    </span>
                    <span className="text-[10px] font-mono font-black uppercase px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                      One-Time
                    </span>
                  </div>
                  <h3 id="welcome-reward-modal-title" className="text-xl sm:text-2xl font-black text-slate-950 tracking-tight">
                    $1,000 New User Reward Program
                  </h3>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setLoading(true);
                    fetchRewardStatus();
                  }}
                  title="Refresh Reward Progress"
                  className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-emerald-600' : ''}`} />
                </button>
                <button
                  type="button"
                  onClick={handleClose}
                  className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                  title="Close Modal"
                >
                  <X className="w-5 h-5 stroke-[2.5]" />
                </button>
              </div>
            </div>

            {/* Status Indicator */}
            <div className="flex items-center justify-between pb-1 border-b border-slate-100">
              <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">Reward Status:</span>
              {isPaid ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 border-2 border-emerald-300 shadow-2xs">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Paid & Credited</span>
                </span>
              ) : status === 'QUALIFIED' ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-blue-100 text-blue-800 border-2 border-blue-300 shadow-2xs">
                  <Sparkles className="w-4 h-4 text-blue-600 animate-spin" />
                  <span>Qualified • Crediting</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-amber-100 text-amber-900 border-2 border-amber-300 shadow-2xs">
                  <Clock className="w-4 h-4 text-amber-700" />
                  <span>In Progress</span>
                </span>
              )}
            </div>

            {/* 3-Part Metric Breakdown Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              {/* Card 1: Reward Amount */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-1">
                <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-slate-500 block">
                  Reward Amount
                </span>
                <span className="text-2xl font-black font-mono text-emerald-600 block notranslate" translate="no">
                  ${rewardAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
                <span className="text-xs text-slate-500 font-medium block">
                  Direct deposit bonus
                </span>
              </div>

              {/* Card 2: Cumulative Verified Deposits */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-1">
                <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-slate-500 block">
                  Cumulative Deposits
                </span>
                <span className="text-2xl font-black font-mono text-slate-900 block notranslate" translate="no">
                  ${qualifyingDeposits.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
                <span className="text-xs text-slate-500 font-medium block">
                  Target: ${targetAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>

              {/* Card 3: Remaining Required / Completed */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-1">
                <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-slate-500 block">
                  Remaining to Qualify
                </span>
                <span
                  className={`text-2xl font-black font-mono block notranslate ${
                    isPaid || remainingAmount === 0 ? 'text-emerald-600' : 'text-amber-700'
                  }`}
                  translate="no"
                >
                  {isPaid || remainingAmount === 0
                    ? '$0.00 (Target Met)'
                    : `$${remainingAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
                </span>
                <span className="text-xs text-slate-500 font-medium block">
                  {isPaid ? '100% Satisfied' : 'USD qualifying deposits'}
                </span>
              </div>
            </div>

            {/* Progress Bar & Percentage */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-mono font-bold">
                <span className="text-slate-600 flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Progress toward $10,000 threshold:</span>
                </span>
                <span className="text-slate-950 font-black text-sm">{progressPercentage}%</span>
              </div>

              <div className="w-full h-3.5 bg-slate-100 rounded-full overflow-hidden p-0.5 border border-slate-300/80 shadow-inner">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    isPaid
                      ? 'bg-gradient-to-r from-emerald-500 to-emerald-600'
                      : 'bg-gradient-to-r from-amber-400 via-emerald-400 to-emerald-500'
                  }`}
                  style={{ width: `${Math.max(3, Math.min(100, progressPercentage))}%` }}
                />
              </div>
            </div>

            {/* Post-Payment Credit Details or Deposit CTA */}
            {isPaid ? (
              <div className="p-4 rounded-2xl bg-emerald-50 border-2 border-emerald-300/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-emerald-950 font-semibold">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 font-black text-emerald-900">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>$1,000 Welcome Reward Successfully Credited</span>
                  </div>
                  <div className="text-[11px] text-emerald-800 font-mono flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span>
                      Credited: <strong>{reward?.paidAt ? new Date(reward.paidAt).toLocaleDateString() : 'Active'}</strong>
                    </span>
                    <span className="flex items-center gap-1">
                      Ref: <strong className="font-bold">{reward?.transactionReference || 'MV-RWD-WELCOME'}</strong>
                      <button
                        type="button"
                        onClick={() => handleCopyRef(reward?.transactionReference)}
                        className="p-1 hover:bg-emerald-100 rounded cursor-pointer"
                        title="Copy Reference Number"
                      >
                        {copiedRef ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5 text-emerald-700" />}
                      </button>
                    </span>
                  </div>
                </div>
                <span className="px-3 py-1 rounded-xl bg-emerald-600 text-white font-mono font-bold text-[11px] shrink-0">
                  Settled in Checking
                </span>
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-amber-50/70 border border-amber-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="text-xs text-slate-700 font-medium leading-relaxed">
                  <span className="font-bold text-slate-900">How to qualify:</span> Make cumulative deposits totaling $10,000 using Card, Bank ACH, or Wire. Once reached, your $1,000 welcome reward is automatically credited directly to your checking account.
                </div>
                <button
                  type="button"
                  onClick={() => {
                    handleClose();
                    if (onOpenDeposit) onOpenDeposit();
                    else openModal('deposit');
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-950 hover:bg-slate-900 text-white text-xs font-black shadow-md transition-all shrink-0 cursor-pointer active:scale-95"
                >
                  <Plus className="w-3.5 h-3.5 text-emerald-400 stroke-[3]" />
                  <span>Deposit Qualifying Funds</span>
                  <ArrowRight className="w-3.5 h-3.5 text-emerald-400" />
                </button>
              </div>
            )}

            {/* Modal Bottom Close Button */}
            <div className="flex justify-end pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={handleClose}
                className="px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
