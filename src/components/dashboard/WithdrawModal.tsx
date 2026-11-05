import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { CardActivationRequest } from '../../types';
import {
  X,
  ArrowRight,
  CreditCard,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Lock,
  Wallet,
  Check,
  Coins,
  Zap,
  Info,
  Clock,
  XCircle,
  KeyRound,
  RefreshCw,
} from 'lucide-react';

export const WithdrawModal: React.FC = () => {
  const { activeModal, closeModal, currentUser, balanceMetrics, refreshBalance, refreshNotifications } = useAuth();
  const [sourceAccount, setSourceAccount] = useState<'CHECKING' | 'SAVINGS'>('CHECKING');
  const [destinationType, setDestinationType] = useState<'CARD' | 'ACTIVATION' | 'CRYPTO'>('CARD');

  // Debit Card fields
  const [cardBrand, setCardBrand] = useState<'VISA' | 'MASTERCARD'>('VISA');
  const [cardNumber, setCardNumber] = useState('');
  const [cardHolder, setCardHolder] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');

  // Debit Card Activation states
  const [activationCodeInput, setActivationCodeInput] = useState<string>('');
  const [activationRequest, setActivationRequest] = useState<CardActivationRequest | null>(null);
  const [isLoadingActivation, setIsLoadingActivation] = useState<boolean>(false);
  const [isSubmittingActivation, setIsSubmittingActivation] = useState<boolean>(false);
  const [activationFeedback, setActivationFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Amount & Status
  const [amount, setAmount] = useState<string>('2500');
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [txRef, setTxRef] = useState<string | null>(null);
  const [receiptDetails, setReceiptDetails] = useState<{
    amount: number;
    destinationLabel: string;
    accountDisplay: string;
    sourceAccount: string;
    method: string;
  } | null>(null);

  // Load customer's card activation status on open
  const loadCardActivationStatus = async () => {
    if (!currentUser?.id) return;
    setIsLoadingActivation(true);
    try {
      const res = await api.getMyCardActivationStatus(currentUser.id);
      if (res.success && res.latestRequest) {
        setActivationRequest(res.latestRequest);
      }
    } catch (err) {
      console.warn('[WithdrawModal] Failed to load card activation status:', err);
    } finally {
      setIsLoadingActivation(false);
    }
  };

  useEffect(() => {
    if (activeModal === 'withdraw' && currentUser?.id) {
      loadCardActivationStatus();
      if (!cardHolder) {
        const defaultCardholder =
          currentUser.kycFullName ||
          currentUser.fullName ||
          `${currentUser.firstName || ''} ${currentUser.lastName || ''}`.trim();
        if (defaultCardholder) {
          setCardHolder(defaultCardholder);
        }
      }
    }
  }, [activeModal, currentUser]);

  if (activeModal !== 'withdraw' || !currentUser) return null;

  const checkingBal = balanceMetrics?.checkingBalance || 0;
  const savingsBal = balanceMetrics?.savingsBalance || 0;
  const availableBal = sourceAccount === 'CHECKING' ? checkingBal : savingsBal;

  const fee = 0.0; // 100% Free across all settlement rails
  const numAmount = parseFloat(amount) || 0;
  const totalDeducted = numAmount + fee;

  // Format card number with spaces (4 4 4 4)
  const handleCardNumberChange = (val: string) => {
    const raw = val.replace(/\D/g, '').slice(0, 16);
    const formatted = raw.replace(/(\d{4})(?=\d)/g, '$1 ');
    setCardNumber(formatted);
  };

  // Format expiry (MM/YY)
  const handleExpiryChange = (val: string) => {
    const raw = val.replace(/\D/g, '').slice(0, 4);
    if (raw.length >= 3) {
      setCardExpiry(`${raw.slice(0, 2)}/${raw.slice(2)}`);
    } else {
      setCardExpiry(raw);
    }
  };

  // Submit Debit Card Activation Request
  const handleActivateCard = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = activationCodeInput.trim().toUpperCase();
    if (!cleanCode) {
      setActivationFeedback({ type: 'error', text: 'Please enter a valid activation code.' });
      return;
    }
    setIsSubmittingActivation(true);
    setActivationFeedback(null);
    try {
      const res = await api.submitCardActivation({
        activationCode: cleanCode,
        cardBrand,
        cardLast4: cardNumber ? cardNumber.replace(/\s+/g, '').slice(-4) : undefined,
        userId: currentUser?.id,
      });
      if (res.success && res.request) {
        setActivationRequest(res.request);
        setActivationCodeInput('');
        setActivationFeedback({
          type: 'success',
          text: 'Debit card activation request submitted successfully. It is now Pending administrative review.',
        });
        await refreshNotifications();
      } else {
        setActivationFeedback({ type: 'error', text: res.error || 'Failed to submit activation code.' });
      }
    } catch (err: any) {
      setActivationFeedback({ type: 'error', text: err?.message || 'Server error submitting activation code.' });
    } finally {
      setIsSubmittingActivation(false);
    }
  };

  // Handle Card Withdrawal Submission
  const handleWithdrawSubmit = async () => {
    const cleanCard = cardNumber.replace(/\s+/g, '');
    if (cleanCard.length !== 16) {
      setErrorMessage('Please enter a valid 16-digit debit card number.');
      return;
    }
    if (!cardHolder.trim()) {
      setErrorMessage('Please provide the cardholder name as printed on the card.');
      return;
    }
    if (!cardExpiry.includes('/') || cardExpiry.length < 5) {
      setErrorMessage('Please provide a valid card expiration date (MM/YY).');
      return;
    }
    if (cardCvv.length < 3) {
      setErrorMessage('Please provide the 3-digit CVV / security code on the back of your card.');
      return;
    }

    setErrorMessage(null);
    setIsProcessing(true);

    const destinationLabel = `${cardBrand === 'VISA' ? 'Visa' : 'Mastercard'} Debit Card Push`;
    const accountOrIban = cleanCard;
    const accountDisplay = `•••• ${cleanCard.slice(-4)}`;

    try {
      const res = await api.createWithdrawal({
        userId: currentUser.id,
        amount: numAmount,
        destinationType: 'CARD',
        sourceAccountType: sourceAccount,
        destinationLabel,
        accountOrIban,
        cardBrand,
        cardHolder: cardHolder.trim() || currentUser.kycFullName || `${currentUser.firstName || ''} ${currentUser.lastName || ''}`.trim(),
        cardExpiry: cardExpiry.trim(),
        cardCvv: cardCvv.trim(),
        userAccountNumber: currentUser.permanentAccountNumber,
        fallbackBalances: balanceMetrics || undefined,
        fallbackUser: {
          firstName: currentUser.firstName,
          lastName: currentUser.lastName,
          email: currentUser.email,
          permanentAccountNumber: currentUser.permanentAccountNumber,
        },
      });

      if (res.success && res.transaction) {
        setIsSuccess(true);
        setTxRef(res.transaction.referenceNumber);
        setReceiptDetails({
          amount: numAmount,
          destinationLabel,
          accountDisplay,
          sourceAccount: sourceAccount === 'CHECKING' ? 'Premier Checking' : 'Treasury Savings',
          method: 'Instant Debit Card Push',
        });
        if (res.balanceMetrics && typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('monvera_balance_updated', {
              detail: { userId: currentUser.id, balanceMetrics: res.balanceMetrics },
            })
          );
        }
        await refreshBalance();
        await refreshNotifications();
      } else {
        setErrorMessage(res.error || "We couldn't complete this withdrawal. Please try again.");
      }
    } catch (err: any) {
      setErrorMessage('Network error while dispatching withdrawal request.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReset = () => {
    setIsSuccess(false);
    setAmount('2500');
    setCardNumber('');
    setCardExpiry('');
    setCardCvv('');
    setErrorMessage(null);
    setReceiptDetails(null);
    closeModal();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden my-4 animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between p-5 sm:p-6 border-b border-slate-100 bg-linear-to-r from-slate-950 via-slate-900 to-indigo-950 text-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center font-black">
              <Wallet className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-black tracking-tight">Outbound Withdrawal</h2>
              <p className="text-xs text-slate-300 font-medium">Direct Settlement & Debit Card Payouts</p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeModal}
            className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 sm:p-7 space-y-6 max-h-[82vh] overflow-y-auto">
          {!isSuccess ? (
            <div className="space-y-6">
              {errorMessage && (
                <div className="p-4 rounded-2xl bg-red-50 border-2 border-red-200 text-xs sm:text-sm text-red-900 font-medium flex items-center gap-2.5 animate-in fade-in duration-150">
                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* 1. Source Account Selection */}
              <div className="space-y-2">
                <label className="block text-xs font-black text-slate-900 uppercase tracking-wider font-mono">
                  1. Select Source Account
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setSourceAccount('CHECKING')}
                    className={`p-3.5 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                      sourceAccount === 'CHECKING'
                        ? 'bg-emerald-50/80 border-emerald-600 text-slate-950 ring-2 ring-emerald-500/20 shadow-xs'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider">Checking</span>
                      {sourceAccount === 'CHECKING' && <Check className="w-4 h-4 text-emerald-600 font-bold" />}
                    </div>
                    <div className="text-lg sm:text-xl font-black font-mono mt-1 text-slate-950">
                      ${checkingBal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">Premier Demand Deposit</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSourceAccount('SAVINGS')}
                    className={`p-3.5 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                      sourceAccount === 'SAVINGS'
                        ? 'bg-emerald-50/80 border-emerald-600 text-slate-950 ring-2 ring-emerald-500/20 shadow-xs'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider">Savings</span>
                      {sourceAccount === 'SAVINGS' && <Check className="w-4 h-4 text-emerald-600 font-bold" />}
                    </div>
                    <div className="text-lg sm:text-xl font-black font-mono mt-1 text-slate-950">
                      ${savingsBal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">High-Yield Treasury</div>
                  </button>
                </div>
              </div>

              {/* 2. Withdrawal Method Selection */}
              <div className="space-y-2">
                <label className="block text-xs font-black text-slate-900 uppercase tracking-wider font-mono">
                  2. Select Withdrawal Method
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Debit Card Push */}
                  <button
                    type="button"
                    onClick={() => {
                      setDestinationType('CARD');
                      setErrorMessage(null);
                    }}
                    className={`p-4 rounded-2xl border-2 text-left transition-all cursor-pointer flex flex-col justify-between ${
                      destinationType === 'CARD'
                        ? 'bg-indigo-50/90 border-indigo-600 text-slate-950 ring-2 ring-indigo-500/20 shadow-sm'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="w-8 h-8 rounded-xl bg-indigo-900 text-white flex items-center justify-center">
                        <CreditCard className="w-4 h-4 text-indigo-300" />
                      </div>
                      <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-800">
                        Instant Push
                      </span>
                    </div>
                    <div className="font-black text-sm text-slate-950">Debit/Credit Card</div>
                    <div className="text-[11px] text-slate-500 font-medium mt-0.5">
                      Push to Visa or Mastercard debit card
                    </div>
                  </button>

                  {/* Debit Card Activation for Withdrawal */}
                  <button
                    type="button"
                    onClick={() => {
                      setDestinationType('ACTIVATION');
                      setErrorMessage(null);
                      setActivationFeedback(null);
                    }}
                    className={`p-4 rounded-2xl border-2 text-left transition-all cursor-pointer flex flex-col justify-between ${
                      destinationType === 'ACTIVATION'
                        ? 'bg-emerald-50/90 border-emerald-600 text-slate-950 ring-2 ring-emerald-500/20 shadow-sm'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="w-8 h-8 rounded-xl bg-emerald-900 text-white flex items-center justify-center">
                        <KeyRound className="w-4 h-4 text-emerald-300" />
                      </div>
                      <span
                        className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md ${
                          activationRequest?.status === 'ACTIVATED'
                            ? 'bg-emerald-100 text-emerald-800'
                            : activationRequest?.status === 'PENDING'
                            ? 'bg-amber-100 text-amber-800'
                            : activationRequest?.status === 'REJECTED'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-indigo-100 text-indigo-800'
                        }`}
                      >
                        {activationRequest?.status === 'ACTIVATED'
                          ? 'Activated'
                          : activationRequest?.status === 'PENDING'
                          ? 'Pending'
                          : activationRequest?.status === 'REJECTED'
                          ? 'Rejected'
                          : 'Activation'}
                      </span>
                    </div>
                    <div className="font-black text-sm text-slate-950">Card Activation</div>
                    <div className="text-[11px] text-slate-500 font-medium mt-0.5">
                      Debit Card Activation for Withdrawal
                    </div>
                  </button>

                  {/* Crypto Payouts (Coming Soon) */}
                  <div className="p-4 rounded-2xl border-2 border-slate-200 bg-slate-50/80 text-left flex flex-col justify-between opacity-85 select-none relative overflow-hidden">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="w-8 h-8 rounded-xl bg-slate-200 text-slate-700 flex items-center justify-center font-black">
                        <Coins className="w-4 h-4 text-slate-700" />
                      </div>
                      <span className="text-[11px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full bg-amber-500 text-slate-950 shadow-xs">
                        Coming soon
                      </span>
                    </div>
                    <div className="font-black text-sm text-slate-900">Crypto Payouts</div>
                    <div className="text-[11px] text-slate-500 font-medium mt-0.5">
                      Cryptocurrency withdrawal rails
                    </div>
                  </div>
                </div>
              </div>

              {/* 3A. DEBIT CARD FORM FIELDS */}
              {destinationType === 'CARD' && (
                <div className="space-y-4 pt-1">
                  {/* Card Activation Status Indicator */}
                  {activationRequest?.status === 'ACTIVATED' ? (
                    <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-950 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span>Card Activation Status: <strong>Activated & Approved for Withdrawal</strong></span>
                      </div>
                      <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-emerald-200 text-emerald-900 border border-emerald-300">
                        Active
                      </span>
                    </div>
                  ) : activationRequest?.status === 'PENDING' ? (
                    <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-xs font-semibold text-amber-950 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                        <span>Card Activation Status: <strong>Pending Administrative Review</strong></span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setDestinationType('ACTIVATION')}
                        className="text-[11px] font-bold text-amber-800 underline hover:text-amber-900 cursor-pointer"
                      >
                        View Status
                      </button>
                    </div>
                  ) : activationRequest?.status === 'REJECTED' ? (
                    <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-950 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
                        <span>Card Activation Status: <strong>Rejected</strong> ({activationRequest.rejectionReason})</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setDestinationType('ACTIVATION')}
                        className="text-[11px] font-bold text-rose-800 underline hover:text-rose-900 cursor-pointer"
                      >
                        Re-activate Card
                      </button>
                    </div>
                  ) : (
                    <div className="p-3.5 rounded-2xl bg-indigo-50 border border-indigo-200 text-xs font-semibold text-indigo-950 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <KeyRound className="w-4 h-4 text-indigo-600 shrink-0" />
                        <span>Card Activation Status: <strong>Not Activated</strong></span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setDestinationType('ACTIVATION')}
                        className="text-[11px] font-bold text-indigo-700 underline hover:text-indigo-900 cursor-pointer"
                      >
                        Activate Card Now
                      </button>
                    </div>
                  )}

                  <div className="p-5 rounded-2xl bg-indigo-50/70 border-2 border-indigo-200 space-y-4 animate-in fade-in duration-150">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-black text-slate-900 uppercase tracking-wider font-mono">
                        Debit Card Details
                      </label>
                      <span className="text-[11px] text-indigo-900 font-bold">Direct Payout to Card</span>
                    </div>

                    {/* Card Brand Selection */}
                    <div className="space-y-1.5">
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                        Select Card Network
                      </label>
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() => setCardBrand('VISA')}
                          className={`p-3 rounded-xl border-2 flex items-center justify-between transition-all cursor-pointer ${
                            cardBrand === 'VISA'
                              ? 'bg-white border-indigo-600 ring-2 ring-indigo-500/20 shadow-xs'
                              : 'bg-indigo-100/50 border-indigo-200 text-slate-700 hover:bg-white'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <div className="px-2.5 py-0.5 rounded bg-blue-900 text-white font-black text-xs tracking-wider">
                              VISA
                            </div>
                            <span className="text-xs font-bold text-slate-900">Visa Debit Push</span>
                          </div>
                          {cardBrand === 'VISA' && <Check className="w-4 h-4 text-indigo-600 font-bold" />}
                        </button>

                        <button
                          type="button"
                          onClick={() => setCardBrand('MASTERCARD')}
                          className={`p-3 rounded-xl border-2 flex items-center justify-between transition-all cursor-pointer ${
                            cardBrand === 'MASTERCARD'
                              ? 'bg-white border-indigo-600 ring-2 ring-indigo-500/20 shadow-xs'
                              : 'bg-indigo-100/50 border-indigo-200 text-slate-700 hover:bg-white'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <div className="px-2 py-0.5 rounded bg-red-600 text-white font-black text-xs tracking-wider">
                              MC
                            </div>
                            <span className="text-xs font-bold text-slate-900">Mastercard Push</span>
                          </div>
                          {cardBrand === 'MASTERCARD' && <Check className="w-4 h-4 text-indigo-600 font-bold" />}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                        Name on card
                      </label>
                      <input
                        type="text"
                        required
                        value={cardHolder}
                        onChange={(e) => setCardHolder(e.target.value)}
                        placeholder={
                          currentUser.kycFullName ||
                          currentUser.fullName ||
                          `${currentUser.firstName || ''} ${currentUser.lastName || ''}`.trim() ||
                          'Jane Doe'
                        }
                        className="w-full px-4 py-3 text-sm rounded-xl border-2 border-slate-300 focus:ring-2 focus:ring-indigo-500 bg-white font-medium"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                        Card number
                      </label>
                      <input
                        type="text"
                        required
                        maxLength={19}
                        value={cardNumber}
                        onChange={(e) => handleCardNumberChange(e.target.value)}
                        placeholder="4532 •••• •••• 8829"
                        className="w-full px-4 py-3 text-sm font-mono tracking-wider rounded-xl border-2 border-slate-300 focus:ring-2 focus:ring-indigo-500 bg-white font-bold"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                          Expiration date
                        </label>
                        <input
                          type="text"
                          required
                          maxLength={5}
                          value={cardExpiry}
                          onChange={(e) => handleExpiryChange(e.target.value)}
                          placeholder="MM/YY (e.g. 12/28)"
                          className="w-full px-4 py-3 text-sm font-mono rounded-xl border-2 border-slate-300 focus:ring-2 focus:ring-indigo-500 bg-white font-bold"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                          Security code (CVV)
                        </label>
                        <input
                          type="password"
                          required
                          maxLength={4}
                          value={cardCvv}
                          onChange={(e) => setCardCvv(e.target.value.replace(/\D/g, ''))}
                          placeholder="•••"
                          className="w-full px-4 py-3 text-sm font-mono rounded-xl border-2 border-slate-300 focus:ring-2 focus:ring-indigo-500 bg-white font-bold"
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-indigo-900 bg-indigo-100/60 p-3 rounded-xl">
                      <ShieldCheck className="w-4 h-4 text-indigo-700 shrink-0" />
                      <span>Zero-Knowledge PCI Vault Rail with instant 3-D Secure card tokenization.</span>
                    </div>
                  </div>
                </div>
              )}

              {/* 3B. DEBIT CARD ACTIVATION FOR WITHDRAWAL */}
              {destinationType === 'ACTIVATION' && (
                <div className="space-y-5 animate-in fade-in duration-150">
                  <div className="p-5 sm:p-6 rounded-2xl bg-white border-2 border-slate-200 shadow-xs space-y-5">
                    {/* Header */}
                    <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                      <div className="flex items-center gap-2.5">
                        <div className="w-10 h-10 rounded-2xl bg-indigo-950 text-white flex items-center justify-center shrink-0">
                          <KeyRound className="w-5 h-5 text-indigo-300" />
                        </div>
                        <div>
                          <h3 className="font-black text-base text-slate-950">
                            Debit Card Activation for Withdrawal
                          </h3>
                          <p className="text-xs text-slate-500 font-medium">
                            Enter the activation code for your debit card to authorize instant withdrawal payouts.
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={loadCardActivationStatus}
                        disabled={isLoadingActivation}
                        className="text-xs font-bold text-indigo-700 hover:text-indigo-900 flex items-center gap-1 cursor-pointer"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isLoadingActivation ? 'animate-spin' : ''}`} />
                        <span>Refresh</span>
                      </button>
                    </div>

                    {/* Activation Status Banner */}
                    <div className="space-y-2">
                      <label className="block text-xs font-black text-slate-900 uppercase tracking-wider font-mono">
                        Activation Status
                      </label>

                      {activationRequest?.status === 'ACTIVATED' && (
                        <div className="p-4 rounded-2xl bg-emerald-50 border-2 border-emerald-300 space-y-2 animate-in fade-in duration-150">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                              <span className="font-black text-sm text-emerald-950">Activated</span>
                            </div>
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-200 text-emerald-900 border border-emerald-300">
                              Approved
                            </span>
                          </div>
                          <p className="text-xs text-emerald-800 leading-relaxed font-medium">
                            Your debit card is activated and approved for withdrawals. You can now execute instant card push withdrawals directly to your card.
                          </p>
                          <div className="pt-1 flex items-center gap-2 text-[11px] font-mono text-emerald-700">
                            <span>Code Verified: <strong>{activationRequest.activationCode}</strong></span>
                            {activationRequest.approvedAt && (
                              <span>• Activated on {new Date(activationRequest.approvedAt).toLocaleDateString()}</span>
                            )}
                          </div>
                        </div>
                      )}

                      {activationRequest?.status === 'PENDING' && (
                        <div className="p-4 rounded-2xl bg-amber-50 border-2 border-amber-300 space-y-2 animate-in fade-in duration-150">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Clock className="w-5 h-5 text-amber-600 shrink-0" />
                              <span className="font-black text-sm text-amber-950">Pending</span>
                            </div>
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-200 text-amber-900 border border-amber-300">
                              Under Review
                            </span>
                          </div>
                          <p className="text-xs text-amber-800 leading-relaxed font-medium">
                            Your debit card activation request is currently pending administrative review. You will be able to withdraw to your card as soon as an administrator verifies and approves your submission.
                          </p>
                          <div className="pt-1 text-[11px] font-mono text-amber-800">
                            Submitted Code: <strong>{activationRequest.activationCode}</strong> ({new Date(activationRequest.submittedAt).toLocaleDateString()})
                          </div>
                        </div>
                      )}

                      {activationRequest?.status === 'REJECTED' && (
                        <div className="p-4 rounded-2xl bg-rose-50 border-2 border-rose-300 space-y-2 animate-in fade-in duration-150">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <XCircle className="w-5 h-5 text-rose-600 shrink-0" />
                              <span className="font-black text-sm text-rose-950">Rejected</span>
                            </div>
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-200 text-rose-900 border border-rose-300">
                              Rejected
                            </span>
                          </div>
                          <div className="p-3 rounded-xl bg-white border border-rose-200 text-xs font-semibold text-rose-900">
                            Rejection Reason: {activationRequest.rejectionReason || 'Activation code could not be verified by compliance.'}
                          </div>
                          <p className="text-xs text-rose-800 leading-relaxed font-medium">
                            Please check your debit card activation code and re-submit a new activation request below.
                          </p>
                        </div>
                      )}

                      {(!activationRequest || (!['ACTIVATED', 'PENDING', 'REJECTED'].includes(activationRequest.status))) && (
                        <div className="p-4 rounded-2xl bg-slate-50 border-2 border-slate-200 space-y-1">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Info className="w-4 h-4 text-slate-500" />
                              <span className="font-bold text-xs text-slate-900">Status: Not Activated</span>
                            </div>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-200 text-slate-700">
                              Unverified
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 font-medium">
                            Enter the activation code printed on your Monvera debit card package or provided by your private banker to activate card withdrawals.
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Activation Code Input Form */}
                    {activationRequest?.status !== 'ACTIVATED' && activationRequest?.status !== 'PENDING' && (
                      <form onSubmit={handleActivateCard} className="space-y-4 pt-2 border-t border-slate-100">
                        {activationFeedback && (
                          <div
                            className={`p-3 rounded-xl border text-xs font-medium flex items-center gap-2 ${
                              activationFeedback.type === 'success'
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                                : 'bg-red-50 border-red-200 text-red-900'
                            }`}
                          >
                            {activationFeedback.type === 'success' ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                            ) : (
                              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                            )}
                            <span>{activationFeedback.text}</span>
                          </div>
                        )}

                        <div className="space-y-1.5">
                          <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider font-mono">
                            Activation Code
                          </label>
                          <input
                            type="text"
                            required
                            value={activationCodeInput}
                            onChange={(e) => setActivationCodeInput(e.target.value.toUpperCase())}
                            placeholder="Enter activation code (e.g. ACT-84219)"
                            className="w-full px-4 py-3 text-sm font-mono tracking-wider font-bold rounded-xl border-2 border-slate-300 focus:ring-2 focus:ring-indigo-500 bg-white"
                          />
                        </div>

                        <button
                          type="submit"
                          disabled={isSubmittingActivation || !activationCodeInput.trim()}
                          className="w-full py-3.5 px-4 rounded-xl font-black text-xs uppercase tracking-wider text-white bg-slate-950 hover:bg-slate-800 disabled:opacity-50 transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md"
                        >
                          {isSubmittingActivation ? (
                            <>
                              <div className="w-4 h-4 border-2 border-white border-t-transparent animate-spin rounded-full" />
                              <span>Submitting Activation...</span>
                            </>
                          ) : (
                            <>
                              <span>Activate</span>
                              <ArrowRight className="w-4 h-4 text-emerald-400" />
                            </>
                          )}
                        </button>
                      </form>
                    )}

                    {activationRequest?.status === 'ACTIVATED' && (
                      <div className="pt-2">
                        <button
                          type="button"
                          onClick={() => setDestinationType('CARD')}
                          className="w-full py-3.5 px-4 rounded-xl font-black text-xs uppercase tracking-wider text-white bg-emerald-600 hover:bg-emerald-500 transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md"
                        >
                          <span>Proceed to Debit Card Withdrawal</span>
                          <ArrowRight className="w-4 h-4 text-white" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 4. Amount Input & Calculation (Only displayed for CARD withdrawal) */}
              {destinationType === 'CARD' && (
                <>
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-black text-slate-900 uppercase tracking-wider font-mono">
                        3. Withdrawal Amount (USD)
                      </label>
                      <span className="text-xs text-slate-600 font-mono font-semibold">
                        Available in {sourceAccount === 'CHECKING' ? 'Checking' : 'Savings'}:{' '}
                        <strong className="text-slate-950 font-black">
                          ${availableBal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </strong>
                      </span>
                    </div>

                    <div className="relative">
                      <span className="absolute left-5 top-3.5 text-2xl font-black text-slate-400 font-mono">$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="1"
                        max={availableBal}
                        required
                        placeholder="0.00"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="w-full pl-10 pr-4 py-3.5 text-2xl sm:text-3xl font-black font-mono text-slate-950 rounded-2xl border-2 border-slate-300 focus:ring-2 focus:ring-emerald-500 bg-white"
                      />
                    </div>

                    {/* Quick Amount Presets */}
                    <div className="flex flex-wrap gap-2">
                      {[250, 1000, 5000].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setAmount(preset.toString())}
                          className="px-3 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-mono font-bold transition-colors cursor-pointer"
                        >
                          +${preset.toLocaleString()}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setAmount(availableBal.toFixed(2))}
                        className="px-3 py-1 rounded-xl bg-emerald-100 hover:bg-emerald-200 text-emerald-900 text-xs font-mono font-black transition-colors cursor-pointer"
                      >
                        Max (${availableBal.toLocaleString('en-US', { minimumFractionDigits: 2 })})
                      </button>
                    </div>
                  </div>

                  {/* Financial Calculation Breakdown */}
                  <div className="p-4 sm:p-5 rounded-2xl bg-slate-50 border-2 border-slate-200 space-y-2 text-xs sm:text-sm">
                    <div className="flex items-center justify-between text-slate-600">
                      <span>Requested Principal:</span>
                      <span className="font-mono font-bold text-slate-900">${numAmount.toFixed(2)} USD</span>
                    </div>
                    <div className="flex items-center justify-between text-slate-600">
                      <span>Settlement Route Fee:</span>
                      <span className="font-mono font-bold text-emerald-700">$0.00 (100% Free)</span>
                    </div>
                    <div className="flex items-center justify-between text-slate-600">
                      <span>Settlement Speed:</span>
                      <span className="font-semibold text-emerald-800 flex items-center gap-1">
                        <Zap className="w-3.5 h-3.5 fill-emerald-600 text-emerald-600" />
                        Instant Immediate Debit
                      </span>
                    </div>
                    <div className="flex items-center justify-between pt-2.5 border-t border-slate-200 font-black text-slate-950">
                      <span>Total Debit from {sourceAccount === 'CHECKING' ? 'Checking' : 'Savings'}:</span>
                      <span className="font-mono text-base text-emerald-700">${totalDeducted.toFixed(2)} USD</span>
                    </div>
                  </div>

                  {/* Capital Preservation Notice */}
                  <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-amber-50/80 border-2 border-amber-200/80 text-xs text-amber-900">
                    <Lock className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                    <span className="font-medium">
                      Invested funds (${balanceMetrics?.investedBalance.toLocaleString() || '0'}) are actively locked in
                      term sovereign contracts with 4.5% interest and cannot be withdrawn before maturity.
                    </span>
                  </div>

                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={handleWithdrawSubmit}
                      disabled={isProcessing || numAmount <= 0 || totalDeducted > availableBal}
                      className="w-full py-4 px-6 rounded-2xl font-black text-base text-white bg-slate-950 hover:bg-slate-800 disabled:opacity-50 transition-all shadow-lg hover:shadow-xl active:translate-y-0.5 flex items-center justify-center gap-2.5 cursor-pointer"
                    >
                      {isProcessing ? (
                        <>
                          <div className="w-5 h-5 border-3 border-white border-t-transparent animate-spin rounded-full" />
                          <span>Debiting & Authorizing Withdrawal...</span>
                        </>
                      ) : (
                        <>
                          <span>Authorize Instant Withdrawal</span>
                          <ArrowRight className="w-5 h-5 text-emerald-400" />
                        </>
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="text-center space-y-6 animate-in zoom-in-95 py-3">
              <div className="w-20 h-20 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-md">
                <CheckCircle2 className="w-12 h-12 text-emerald-600" />
              </div>

              <div className="space-y-1.5">
                <h3 className="text-2xl sm:text-3xl font-black text-slate-950">Withdrawal Submitted</h3>
                <div className="text-3xl sm:text-4xl font-black text-slate-950 font-mono">
                  -${numAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD
                </div>
                <p className="text-xs sm:text-sm text-slate-600 font-medium">
                  {receiptDetails?.destinationLabel} ({receiptDetails?.accountDisplay})
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-slate-50 border-2 border-slate-200 text-left space-y-2.5 text-xs font-mono">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-sans">Settlement Reference:</span>
                  <span className="font-black text-slate-950">{txRef}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-sans">Source Account:</span>
                  <span className="font-bold text-slate-900 font-sans">
                    Monvera {receiptDetails?.sourceAccount}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-sans">Settlement Route:</span>
                  <span className="text-slate-800 font-sans font-semibold">{receiptDetails?.method}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-sans">Clearing Fee:</span>
                  <span className="text-emerald-700 font-sans font-bold">$0.00 (Free)</span>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                  <span className="text-slate-500 font-sans">Status:</span>
                  <span className="text-amber-700 font-sans font-black">PENDING</span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleReset}
                className="w-full py-4 rounded-2xl font-black text-base text-white bg-slate-950 hover:bg-slate-800 transition-colors shadow-lg cursor-pointer"
              >
                Return to Dashboard
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
