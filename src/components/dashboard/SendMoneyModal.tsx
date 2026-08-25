import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api, RecipientLookupResult } from '../../services/api';
import confetti from 'canvas-confetti';
import {
  X,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Zap,
  ArrowLeft,
  User,
  CreditCard,
  Lock,
  Download,
  Copy,
  Check,
  AtSign,
  QrCode,
  Camera,
} from 'lucide-react';
import { Transaction } from '../../types';
import { QrScannerModal } from './QrScannerModal';

export const SendMoneyModal: React.FC = () => {
  const { activeModal, closeModal, currentUser, balanceMetrics, refreshBalance, refreshNotifications } = useAuth();

  // Multi-step transfer state: 'INPUT' | 'CONFIRM' | 'PROCESSING' | 'SUCCESS'
  const [step, setStep] = useState<'INPUT' | 'CONFIRM' | 'PROCESSING' | 'SUCCESS'>('INPUT');
  const [recipientInput, setRecipientInput] = useState('');
  const [amount, setAmount] = useState<string>('');
  const [memo, setMemo] = useState('');
  const [category, setCategory] = useState<Transaction['category']>('Transfers');
  const [securityPin, setSecurityPin] = useState('8829');
  const [isQrScannerOpen, setIsQrScannerOpen] = useState(false);

  // Lookup state
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [lookupResult, setLookupResult] = useState<RecipientLookupResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [completedTx, setCompletedTx] = useState<Transaction | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (activeModal === 'send') {
      setStep('INPUT');
      setRecipientInput('');
      setAmount('');
      setMemo('');
      setLookupResult(null);
      setErrorMessage(null);
      setCompletedTx(null);
    }
  }, [activeModal]);

  if (activeModal !== 'send' || !currentUser) return null;

  // Real-time lookup for either 10-digit account number OR username
  const handleLookup = async (
    inputVal: string,
    hint?: { name?: string; username?: string; accountNumber?: string }
  ) => {
    const trimmed = inputVal.trim();
    if (!trimmed && !hint?.accountNumber && !hint?.username) {
      setLookupResult(null);
      setErrorMessage(null);
      return;
    }

    if (trimmed.length < 2 && !hint?.accountNumber && !hint?.username) {
      setLookupResult(null);
      return;
    }

    setIsLookingUp(true);
    setErrorMessage(null);
    try {
      const res = await api.lookupRecipient(trimmed, currentUser.id, hint);
      if (res.valid) {
        setLookupResult(res);
        setErrorMessage(null);
      } else {
        setLookupResult(null);
        setErrorMessage(res.error || 'Recipient not found.');
      }
    } catch (err: any) {
      setLookupResult(null);
      setErrorMessage('Failed to verify recipient account or username.');
    } finally {
      setIsLookingUp(false);
    }
  };

  const handleSelectQuickContact = (identifier: string) => {
    setRecipientInput(identifier);
    handleLookup(identifier);
  };

  const handleProceedToReview = (e: React.FormEvent) => {
    e.preventDefault();
    if (!lookupResult || !lookupResult.valid) {
      setErrorMessage('Please enter a valid Monvera Username (e.g. @marcus) or 10-digit Account Number.');
      return;
    }
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setErrorMessage('Please enter a valid transfer amount.');
      return;
    }
    const checkingBal = balanceMetrics?.checkingBalance || 0;
    if (numAmount > checkingBal) {
      setErrorMessage(`Insufficient checking funds ($${checkingBal.toLocaleString('en-US', { minimumFractionDigits: 2 })}).`);
      return;
    }

    setErrorMessage(null);
    setStep('CONFIRM');
  };

  const handleExecuteTransfer = async () => {
    setStep('PROCESSING');
    setErrorMessage(null);

    try {
      const res = await api.sendMonveraTransfer({
        senderUserId: currentUser.id,
        recipientIdentifier: lookupResult?.permanentAccountNumber || recipientInput,
        amount: parseFloat(amount),
        description: memo || `Transfer to ${lookupResult?.firstName} ${lookupResult?.lastName} (@${lookupResult?.username || 'user'})`,
        category,
      });

      if (res.success && res.transaction) {
        setCompletedTx(res.transaction);
        setStep('SUCCESS');
        await refreshBalance();
        await refreshNotifications();
        confetti({
          particleCount: 80,
          spread: 60,
          origin: { y: 0.6 },
          colors: ['#059669', '#10b981', '#0f172a', '#d97706'],
        });
      } else {
        setErrorMessage(res.error || 'Transfer failed. Your balance has not been changed.');
        setStep('CONFIRM');
      }
    } catch (err: any) {
      setErrorMessage('Network or server error during transfer processing.');
      setStep('CONFIRM');
    }
  };

  const handleCopyRef = () => {
    if (completedTx) {
      navigator.clipboard.writeText(completedTx.referenceNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const quickContacts = [
    { name: 'Marcus Sterling', username: 'marcus', acc: '1088492015', tier: 'Business' },
    { name: 'Sophia Chen', username: 'sophia', acc: '1093847294', tier: 'Premier' },
    { name: 'Eleanor Vance', username: 'eleanor', acc: '1045827391', tier: 'Private Wealth' },
  ].filter((c) => c.acc !== currentUser.permanentAccountNumber);

  return (
    <>
      <div
        id="send-money-modal-backdrop"
        className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200"
        onClick={(e) => {
          if (e.target === e.currentTarget && step !== 'PROCESSING') closeModal();
        }}
      >
      <div
        id="send-money-modal-container"
        className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl border-2 border-slate-200 overflow-hidden relative max-h-[94vh] flex flex-col"
      >
        {/* Header */}
        <div className="p-6 sm:p-7 bg-slate-50 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-slate-950 text-emerald-400 flex items-center justify-center font-black shadow-sm">
              <Zap className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-black text-slate-950">Send & Transfer Money</h2>
              <p className="text-xs text-slate-500 font-semibold">Instant Transfers by Username (@handle) or Account Number</p>
            </div>
          </div>
          {step !== 'PROCESSING' && (
            <button
              onClick={closeModal}
              className="w-9 h-9 rounded-full bg-white hover:bg-slate-200 text-slate-600 hover:text-slate-950 flex items-center justify-center border border-slate-200 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-6 sm:p-8 overflow-y-auto flex-1 space-y-6">
          {errorMessage && (
            <div className="p-4 rounded-2xl bg-red-50 border-2 border-red-200 text-xs sm:text-sm text-red-800 font-medium flex items-start gap-3">
              <AlertCircle className="w-5 h-5 flex-shrink-0 text-red-600 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* STEP 1: INPUT RECIPIENT & AMOUNT */}
          {step === 'INPUT' && (
            <form onSubmit={handleProceedToReview} className="space-y-6">
              {/* Recipient Monvera Username or Account Number */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-black text-slate-900 uppercase tracking-wider font-mono">
                    1. Recipient Username or Account Number
                  </label>
                  <span className="text-[11px] text-slate-500 font-semibold">
                    e.g. <strong className="text-emerald-700">@marcus</strong> or <strong className="text-slate-800">1088492015</strong>
                  </span>
                </div>
                
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <div className="absolute left-4 top-3.5 text-slate-400">
                      <AtSign className="w-5 h-5" />
                    </div>
                    <input
                      type="text"
                      required
                      placeholder="Enter @username or 10-digit account number"
                      value={recipientInput}
                      onChange={(e) => {
                        const val = e.target.value;
                        setRecipientInput(val);
                        handleLookup(val);
                      }}
                      className="w-full pl-11 pr-24 py-3.5 text-base font-mono font-bold tracking-wider rounded-2xl border-2 border-slate-300 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-white"
                    />
                    {isLookingUp ? (
                      <div className="absolute right-4 top-3.5 text-xs text-emerald-600 animate-pulse font-mono font-bold">
                        Verifying...
                      </div>
                    ) : (
                      recipientInput.trim() && (
                        <button
                          type="button"
                          onClick={() => handleLookup(recipientInput)}
                          className="absolute right-2.5 top-2 px-3 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 transition-colors cursor-pointer"
                        >
                          Verify
                        </button>
                      )
                    )}
                  </div>

                  {/* QR Scan Button */}
                  <button
                    type="button"
                    onClick={() => setIsQrScannerOpen(true)}
                    className="py-3.5 px-4 rounded-2xl bg-emerald-50 hover:bg-emerald-100 border-2 border-emerald-400 text-emerald-950 font-black text-xs flex items-center gap-1.5 shadow-xs transition-all cursor-pointer flex-shrink-0"
                    title="Scan Recipient QR Code"
                  >
                    <Camera className="w-4 h-4 text-emerald-800" />
                    <span className="hidden sm:inline">Scan QR</span>
                  </button>
                </div>

                {/* Quick Directory Contacts */}
                <div className="pt-1">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                      Quick Transfer Suggestions
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsQrScannerOpen(true)}
                      className="text-[11px] font-bold text-emerald-700 hover:text-emerald-900 flex items-center gap-1 cursor-pointer"
                    >
                      <QrCode className="w-3.5 h-3.5" />
                      <span>Scan QR Code</span>
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {quickContacts.map((contact) => (
                      <button
                        key={contact.username}
                        type="button"
                        onClick={() => handleSelectQuickContact(`@${contact.username}`)}
                        className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-emerald-50 hover:border-emerald-300 border border-slate-200 text-xs font-medium text-slate-800 flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <span className="font-bold">@{contact.username}</span>
                        <span className="text-slate-400 text-[10px]">({contact.name})</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Verified Recipient Banner Preview */}
              {lookupResult && (
                <div className="p-4 sm:p-5 rounded-2xl bg-emerald-50/90 border-2 border-emerald-400 flex items-center justify-between animate-in fade-in slide-in-from-top-1">
                  <div className="flex items-center gap-3.5">
                    <img
                      src={lookupResult.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150'}
                      alt="Recipient"
                      className="w-12 h-12 rounded-2xl object-cover border-2 border-emerald-300 shadow-xs"
                    />
                    <div>
                      <div className="flex items-center gap-1.5 font-black text-base text-emerald-950">
                        <span>{lookupResult.firstName} {lookupResult.lastName}</span>
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 fill-emerald-100" />
                      </div>
                      <div className="text-xs text-emerald-700 font-mono font-bold flex items-center gap-2 mt-0.5">
                        <span className="bg-emerald-200/70 text-emerald-900 px-2 py-0.5 rounded-md">
                          @{lookupResult.username || 'user'}
                        </span>
                        <span>Acc {lookupResult.maskedAccountNumber}</span>
                      </div>
                    </div>
                  </div>
                  <span className="text-xs uppercase font-black text-emerald-900 bg-white px-3 py-1 rounded-xl border border-emerald-200 shadow-xs">
                    Verified User
                  </span>
                </div>
              )}

              {/* Amount Input */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-black text-slate-900 uppercase tracking-wider font-mono">
                    2. Transfer Amount (USD)
                  </label>
                  <span className="text-xs text-slate-600 font-mono font-semibold">
                    Available Checking:{' '}
                    <strong className="text-slate-950 font-black">
                      ${balanceMetrics?.checkingBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </strong>
                  </span>
                </div>
                <div className="relative">
                  <span className="absolute left-5 top-3.5 text-2xl font-black text-slate-400 font-mono">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    required
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full pl-10 pr-4 py-3.5 text-2xl sm:text-3xl font-black font-mono text-slate-950 rounded-2xl border-2 border-slate-300 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-white"
                  />
                </div>
              </div>

              {/* Quick Preset Buttons */}
              <div className="grid grid-cols-4 gap-2">
                {[100, 500, 2000, 5000].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setAmount(preset.toString())}
                    className="py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-mono font-black text-slate-800 transition-colors cursor-pointer border border-slate-200"
                  >
                    +${preset.toLocaleString()}
                  </button>
                ))}
              </div>

              {/* Transfer Memo */}
              <div className="space-y-2">
                <label className="block text-xs font-black text-slate-900 uppercase tracking-wider font-mono">
                  3. Transfer Note / Description (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Payment for invoice #8091"
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  className="w-full px-4 py-3 text-sm rounded-xl border-2 border-slate-200 focus:ring-2 focus:ring-emerald-500 bg-white font-medium"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={!lookupResult}
                  className="w-full py-4 px-6 rounded-2xl font-black text-base text-white bg-slate-950 hover:bg-slate-800 disabled:opacity-40 transition-all shadow-lg hover:shadow-xl active:translate-y-0.5 flex items-center justify-center gap-2.5 cursor-pointer"
                >
                  <span>Review Transfer Details</span>
                  <ArrowRight className="w-5 h-5 text-emerald-400" />
                </button>
              </div>
            </form>
          )}

          {/* STEP 2: REVIEW & CONFIRM */}
          {step === 'CONFIRM' && (
            <div className="space-y-6 animate-in fade-in py-2">
              <div className="text-center space-y-1.5">
                <span className="text-xs font-mono uppercase text-slate-500 font-bold tracking-widest">Total Transfer Amount</span>
                <div className="text-4xl sm:text-5xl font-black text-slate-950 font-mono">
                  ${parseFloat(amount).toLocaleString('en-US', { minimumFractionDigits: 2 })} USD
                </div>
                <span className="inline-block text-xs text-emerald-800 font-black bg-emerald-100 px-3 py-1 rounded-full border border-emerald-300">
                  Instant Settlement • $0.00 Fee
                </span>
              </div>

              <div className="p-5 rounded-2xl bg-slate-50 border-2 border-slate-200 space-y-3 text-xs sm:text-sm">
                <div className="flex items-center justify-between pb-2.5 border-b border-slate-200">
                  <span className="text-slate-500">From Account:</span>
                  <span className="font-mono font-bold text-slate-950">
                    Checking (•••• {currentUser.permanentAccountNumber.slice(-4)})
                  </span>
                </div>
                <div className="flex items-center justify-between pb-2.5 border-b border-slate-200">
                  <span className="text-slate-500">Recipient Name:</span>
                  <span className="font-black text-slate-950">
                    {lookupResult?.firstName} {lookupResult?.lastName}
                  </span>
                </div>
                <div className="flex items-center justify-between pb-2.5 border-b border-slate-200">
                  <span className="text-slate-500">Monvera Username:</span>
                  <span className="font-mono font-bold text-emerald-700">@{lookupResult?.username || 'user'}</span>
                </div>
                <div className="flex items-center justify-between pb-2.5 border-b border-slate-200">
                  <span className="text-slate-500">Recipient Account:</span>
                  <span className="font-mono font-bold text-slate-950">{lookupResult?.maskedAccountNumber}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Description:</span>
                  <span className="font-semibold text-slate-800">{memo || 'Monvera Peer Transfer'}</span>
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setStep('INPUT')}
                  className="w-1/3 py-4 rounded-2xl font-black text-sm text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Back</span>
                </button>
                <button
                  type="button"
                  onClick={handleExecuteTransfer}
                  className="w-2/3 py-4 rounded-2xl font-black text-base text-white bg-emerald-600 hover:bg-emerald-700 transition-colors shadow-lg hover:shadow-xl flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span>Authorize & Send</span>
                  <ArrowRight className="w-5 h-5 text-white" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: PROCESSING STATE */}
          {step === 'PROCESSING' && (
            <div className="py-14 text-center space-y-4 animate-in fade-in">
              <div className="w-16 h-16 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin mx-auto" />
              <h3 className="text-xl font-black text-slate-950">Authorizing Ledger Transfer...</h3>
              <p className="text-xs sm:text-sm text-slate-500 max-w-xs mx-auto font-medium">
                Authorizing instant balance debit and recipient credit with verified cryptographic protocol.
              </p>
            </div>
          )}

          {/* STEP 4: SUCCESS CONFIRMATION */}
          {step === 'SUCCESS' && completedTx && (
            <div className="text-center space-y-6 animate-in zoom-in-95 py-3">
              <div className="w-20 h-20 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-md">
                <CheckCircle2 className="w-12 h-12 text-emerald-600" />
              </div>

              <div className="space-y-1.5">
                <h3 className="text-2xl sm:text-3xl font-black text-slate-950">Transfer Complete</h3>
                <div className="text-3xl sm:text-4xl font-black text-emerald-600 font-mono">
                  -${completedTx.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD
                </div>
                <p className="text-xs sm:text-sm text-slate-600 font-medium">
                  Successfully sent to {completedTx.recipientName} (@{lookupResult?.username || 'user'} • {lookupResult?.maskedAccountNumber})
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-slate-50 border-2 border-slate-200 text-left space-y-2.5 text-xs font-mono">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-sans">Transaction Reference:</span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-black text-slate-950">{completedTx.referenceNumber}</span>
                    <button
                      onClick={handleCopyRef}
                      className="p-1 hover:bg-slate-200 rounded-md text-slate-500 cursor-pointer"
                      title="Copy Reference"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-sans">Timestamp:</span>
                  <span className="text-slate-800">{new Date(completedTx.createdAt).toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                  <span className="text-slate-500 font-sans">Ledger Status:</span>
                  <span className="text-emerald-700 font-sans font-black">COMPLETED & VERIFIED</span>
                </div>
              </div>

              <button
                type="button"
                onClick={closeModal}
                className="w-full py-4 rounded-2xl font-black text-base text-white bg-slate-950 hover:bg-slate-800 transition-colors shadow-lg cursor-pointer"
              >
                Return to Dashboard
              </button>
            </div>
          )}
        </div>
      </div>
    </div>

    {/* Recipient QR Scanner Modal */}
    <QrScannerModal
      isOpen={isQrScannerOpen}
      onClose={() => setIsQrScannerOpen(false)}
      onScanSuccess={(scanned) => {
        setRecipientInput(scanned.identifier);
        handleLookup(scanned.identifier, scanned);
      }}
    />
  </>
  );
};
