import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import {
  X,
  ArrowRight,
  Landmark,
  CreditCard,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Lock,
  Wallet,
  Building2,
  Check,
  Coins,
  Zap,
  Sparkles,
  Info,
} from 'lucide-react';

const COMMON_BANKS = [
  'Chase Bank',
  'Bank of America',
  'Wells Fargo',
  'Citibank',
  'Goldman Sachs',
  'Fidelity',
];

export const WithdrawModal: React.FC = () => {
  const { activeModal, closeModal, currentUser, balanceMetrics, refreshBalance, refreshNotifications } = useAuth();
  const [sourceAccount, setSourceAccount] = useState<'CHECKING' | 'SAVINGS'>('CHECKING');
  const [destinationType, setDestinationType] = useState<'ACH_BANK' | 'CRYPTO' | 'CARD'>('ACH_BANK');

  // Bank ACH fields
  const [bankName, setBankName] = useState('Chase Bank');
  const [accountNumber, setAccountNumber] = useState('8839201948');
  const [routingNumber, setRoutingNumber] = useState('021000021');

  // Crypto fields (Binance Smart Chain Only)
  const [cryptoAsset, setCryptoAsset] = useState<'USDT' | 'BNB'>('USDT');
  const [cryptoAddress, setCryptoAddress] = useState('');

  // Debit Card fields
  const [cardBrand, setCardBrand] = useState<'VISA' | 'MASTERCARD'>('VISA');
  const [cardNumber, setCardNumber] = useState('');
  const [cardHolder, setCardHolder] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');

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

  const handleWithdrawSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (numAmount <= 0) {
      setErrorMessage('Please enter a valid withdrawal amount greater than $0.00.');
      return;
    }
    if (totalDeducted > availableBal) {
      setErrorMessage(
        `Insufficient liquid funds in ${
          sourceAccount === 'CHECKING' ? 'Checking' : 'Savings'
        } ($${availableBal.toLocaleString('en-US', {
          minimumFractionDigits: 2,
        })}). Requested: $${totalDeducted.toFixed(2)}. Sovereign term deposits are locked until maturity.`
      );
      return;
    }

    // Validation per route
    if (destinationType === 'ACH_BANK') {
      if (!bankName.trim()) {
        setErrorMessage('Please provide your bank or financial institution name.');
        return;
      }
      if (!accountNumber.trim() || accountNumber.length < 4) {
        setErrorMessage('Please provide a valid recipient account number.');
        return;
      }
      if (!routingNumber.trim() || routingNumber.length !== 9) {
        setErrorMessage('Please provide a valid 9-digit ABA bank routing number.');
        return;
      }
    } else if (destinationType === 'CRYPTO') {
      if (!cryptoAddress.trim() || !cryptoAddress.startsWith('0x') || cryptoAddress.length < 40) {
        setErrorMessage('Please enter a valid Binance Smart Chain (BSC BEP-20) wallet address starting with 0x.');
        return;
      }
    } else if (destinationType === 'CARD') {
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
    }

    setErrorMessage(null);
    setIsProcessing(true);

    let destinationLabel = '';
    let accountOrIban = '';
    let accountDisplay = '';

    if (destinationType === 'ACH_BANK') {
      destinationLabel = `${bankName} (ACH)`;
      accountOrIban = accountNumber;
      accountDisplay = `•••• ${accountNumber.slice(-4)}`;
    } else if (destinationType === 'CRYPTO') {
      destinationLabel = `${cryptoAsset === 'USDT' ? 'USD (USDT)' : 'Binance Coin (BNB)'} on Binance Smart Chain`;
      accountOrIban = cryptoAddress;
      accountDisplay = `${cryptoAddress.slice(0, 6)}...${cryptoAddress.slice(-4)}`;
    } else if (destinationType === 'CARD') {
      const cleanCard = cardNumber.replace(/\s+/g, '');
      destinationLabel = `${cardBrand === 'VISA' ? 'Visa' : 'Mastercard'} Debit Card Push`;
      accountOrIban = cleanCard;
      accountDisplay = `•••• ${cleanCard.slice(-4)}`;
    }

    try {
      const res = await api.createWithdrawal({
        userId: currentUser.id,
        amount: numAmount,
        destinationType,
        sourceAccountType: sourceAccount,
        destinationLabel,
        accountOrIban,
        routingNumber: destinationType === 'ACH_BANK' ? routingNumber : undefined,
        cardBrand: destinationType === 'CARD' ? cardBrand : undefined,
        cryptoAsset: destinationType === 'CRYPTO' ? cryptoAsset : undefined,
        cryptoNetwork: destinationType === 'CRYPTO' ? 'Binance Smart Chain (BEP-20)' : undefined,
      });

      if (res.success && res.transaction) {
        setIsSuccess(true);
        setTxRef(res.transaction.referenceNumber);
        setReceiptDetails({
          amount: numAmount,
          destinationLabel,
          accountDisplay,
          sourceAccount: sourceAccount === 'CHECKING' ? 'Premier Checking' : 'Treasury Savings',
          method:
            destinationType === 'ACH_BANK'
              ? 'Standard ACH Clearing'
              : destinationType === 'CRYPTO'
              ? 'Binance Smart Chain (BEP-20)'
              : 'Instant Debit Card Push',
        });
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
    setTxRef(null);
    setAmount('2500');
    setCryptoAddress('');
    setCardNumber('');
    setCardHolder('');
    setCardExpiry('');
    setCardCvv('');
    setErrorMessage(null);
    closeModal();
  };

  return (
    <div
      id="withdraw-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isProcessing) handleReset();
      }}
    >
      <div
        id="withdraw-modal-container"
        className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl border-2 border-slate-200 overflow-hidden relative max-h-[94vh] flex flex-col"
      >
        {/* Header */}
        <div className="p-6 sm:p-7 bg-slate-50 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-slate-950 text-emerald-400 flex items-center justify-center font-black shadow-sm">
              <Landmark className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl sm:text-2xl font-black text-slate-950">Withdraw Funds</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-300">
                  Instant & Free
                </span>
              </div>
              <p className="text-xs text-slate-500 font-semibold">Immediate balance debit & guaranteed settlement</p>
            </div>
          </div>
          {!isProcessing && (
            <button
              onClick={handleReset}
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

          {!isSuccess ? (
            <form onSubmit={handleWithdrawSubmit} className="space-y-6">
              {/* 1. Withdraw From (Source Account) */}
              <div className="space-y-2.5">
                <label className="block text-xs font-black text-slate-900 uppercase tracking-wider font-mono">
                  1. Select Source Account
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setSourceAccount('CHECKING')}
                    className={`p-4 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                      sourceAccount === 'CHECKING'
                        ? 'bg-emerald-50/90 border-emerald-600 text-slate-950 ring-2 ring-emerald-500/20 shadow-sm'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-slate-900">Premier Checking Account</span>
                      {sourceAccount === 'CHECKING' && <Check className="w-4 h-4 text-emerald-600 font-bold" />}
                    </div>
                    <div className="text-base font-black font-mono text-emerald-700 mt-1">
                      ${checkingBal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono mt-0.5">Liquid Operating Funds</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSourceAccount('SAVINGS')}
                    className={`p-4 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                      sourceAccount === 'SAVINGS'
                        ? 'bg-emerald-50/90 border-emerald-600 text-slate-950 ring-2 ring-emerald-500/20 shadow-sm'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-slate-900">High-Yield Treasury Savings</span>
                      {sourceAccount === 'SAVINGS' && <Check className="w-4 h-4 text-emerald-600 font-bold" />}
                    </div>
                    <div className="text-base font-black font-mono text-emerald-700 mt-1">
                      ${savingsBal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono mt-0.5">4.85% APY Liquid Reserves</div>
                  </button>
                </div>
              </div>

              {/* 2. Destination Route */}
              <div className="space-y-2.5">
                <label className="block text-xs font-black text-slate-900 uppercase tracking-wider font-mono">
                  2. Select Settlement Method
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Standard ACH */}
                  <button
                    type="button"
                    onClick={() => setDestinationType('ACH_BANK')}
                    className={`p-4 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                      destinationType === 'ACH_BANK'
                        ? 'bg-emerald-50/90 border-emerald-600 text-slate-950 ring-2 ring-emerald-500/20 shadow-sm'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="w-8 h-8 rounded-xl bg-slate-900 text-white flex items-center justify-center">
                        <Building2 className="w-4 h-4 text-emerald-400" />
                      </div>
                      <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800">
                        $0.00 Free
                      </span>
                    </div>
                    <div className="font-black text-xs text-slate-950">Standard ACH</div>
                    <div className="text-[11px] text-slate-500 font-medium mt-0.5">Bank Account & Routing</div>
                  </button>

                  {/* Crypto Payout (Binance Smart Chain Only) */}
                  <button
                    type="button"
                    onClick={() => setDestinationType('CRYPTO')}
                    className={`p-4 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                      destinationType === 'CRYPTO'
                        ? 'bg-amber-50/90 border-amber-500 text-slate-950 ring-2 ring-amber-500/20 shadow-sm'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="w-8 h-8 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center font-black">
                        <Coins className="w-4 h-4" />
                      </div>
                      <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-amber-100 text-amber-800">
                        BSC (BEP-20)
                      </span>
                    </div>
                    <div className="font-black text-xs text-slate-950">Crypto Payout</div>
                    <div className="text-[11px] text-slate-500 font-medium mt-0.5">USD (USDT) & BNB on BSC</div>
                  </button>

                  {/* Debit Card Push */}
                  <button
                    type="button"
                    onClick={() => setDestinationType('CARD')}
                    className={`p-4 rounded-2xl border-2 text-left transition-all cursor-pointer ${
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
                    <div className="font-black text-xs text-slate-950">Debit Card Push</div>
                    <div className="text-[11px] text-slate-500 font-medium mt-0.5">Visa & Mastercard Payout</div>
                  </button>
                </div>
              </div>

              {/* 3. Destination Form Fields */}
              <div className="space-y-4 pt-1">
                {/* --- STANDARD ACH BANK INPUTS --- */}
                {destinationType === 'ACH_BANK' && (
                  <div className="p-5 rounded-2xl bg-slate-50 border-2 border-slate-200 space-y-4 animate-in fade-in duration-150">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-black text-slate-900 uppercase tracking-wider font-mono">
                        Bank Clearing Information
                      </label>
                      <span className="text-[11px] text-slate-500 font-medium">Quick select:</span>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {COMMON_BANKS.map((bank) => (
                        <button
                          key={bank}
                          type="button"
                          onClick={() => setBankName(bank)}
                          className={`text-xs px-3 py-1.5 rounded-xl border font-bold transition-all cursor-pointer ${
                            bankName === bank
                              ? 'bg-slate-950 text-white border-slate-950 shadow-xs'
                              : 'bg-white text-slate-700 hover:bg-slate-200 border-slate-200'
                          }`}
                        >
                          {bank}
                        </button>
                      ))}
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                        Bank / Institution Name
                      </label>
                      <input
                        type="text"
                        required
                        value={bankName}
                        onChange={(e) => setBankName(e.target.value)}
                        placeholder="e.g. Chase Bank, Bank of America"
                        className="w-full px-4 py-3 text-sm rounded-xl border-2 border-slate-200 focus:ring-2 focus:ring-emerald-500 bg-white font-medium"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                          Account Number
                        </label>
                        <input
                          type="text"
                          required
                          value={accountNumber}
                          onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ''))}
                          placeholder="8839201948"
                          className="w-full px-4 py-3 text-sm font-mono rounded-xl border-2 border-slate-200 focus:ring-2 focus:ring-emerald-500 bg-white font-bold"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                          Routing Number (9-digit ABA)
                        </label>
                        <input
                          type="text"
                          required
                          maxLength={9}
                          value={routingNumber}
                          onChange={(e) => setRoutingNumber(e.target.value.replace(/\D/g, '').slice(0, 9))}
                          placeholder="021000021"
                          className="w-full px-4 py-3 text-sm font-mono rounded-xl border-2 border-slate-200 focus:ring-2 focus:ring-emerald-500 bg-white font-bold"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* --- CRYPTO PAYOUT INPUTS (Binance Smart Chain BEP-20 Only) --- */}
                {destinationType === 'CRYPTO' && (
                  <div className="p-5 rounded-2xl bg-amber-50/70 border-2 border-amber-300 space-y-4 animate-in fade-in duration-150">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-xs font-black text-slate-900 uppercase tracking-wider font-mono">
                          Binance Smart Chain (BSC BEP-20) Rail
                        </span>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-200/80 text-amber-900">
                        BSC Only
                      </span>
                    </div>

                    <div className="space-y-2">
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                        Select Binance Smart Chain Asset
                      </label>
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() => setCryptoAsset('USDT')}
                          className={`p-3 rounded-xl border-2 text-left flex items-center justify-between transition-all cursor-pointer ${
                            cryptoAsset === 'USDT'
                              ? 'bg-white border-emerald-600 ring-2 ring-emerald-500/20 shadow-xs'
                              : 'bg-amber-100/50 border-amber-200 text-slate-700 hover:bg-white'
                          }`}
                        >
                          <div>
                            <div className="font-black text-xs text-slate-950 flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-emerald-500" />
                              USD (USDT BEP-20)
                            </div>
                            <div className="text-[10px] text-slate-500 font-medium">USD on Binance Smart Chain</div>
                          </div>
                          {cryptoAsset === 'USDT' && <Check className="w-4 h-4 text-emerald-600 font-bold" />}
                        </button>

                        <button
                          type="button"
                          onClick={() => setCryptoAsset('BNB')}
                          className={`p-3 rounded-xl border-2 text-left flex items-center justify-between transition-all cursor-pointer ${
                            cryptoAsset === 'BNB'
                              ? 'bg-white border-amber-600 ring-2 ring-amber-500/20 shadow-xs'
                              : 'bg-amber-100/50 border-amber-200 text-slate-700 hover:bg-white'
                          }`}
                        >
                          <div>
                            <div className="font-black text-xs text-slate-950 flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-amber-500" />
                              BNB (Binance Coin)
                            </div>
                            <div className="text-[10px] text-slate-500 font-medium">Native BSC Gas & Token</div>
                          </div>
                          {cryptoAsset === 'BNB' && <Check className="w-4 h-4 text-amber-600 font-bold" />}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                          Recipient BSC Wallet Address (BEP-20)
                        </label>
                        {cryptoAddress.startsWith('0x') && cryptoAddress.length >= 40 && (
                          <span className="text-[11px] text-emerald-700 font-bold flex items-center gap-1">
                            <ShieldCheck className="w-3.5 h-3.5" /> Valid BSC Address
                          </span>
                        )}
                      </div>
                      <input
                        type="text"
                        required
                        value={cryptoAddress}
                        onChange={(e) => setCryptoAddress(e.target.value.trim())}
                        placeholder="0x71C... (BEP-20 Binance Smart Chain address)"
                        className="w-full px-4 py-3 text-sm font-mono rounded-xl border-2 border-slate-300 focus:ring-2 focus:ring-amber-500 bg-white font-bold"
                      />
                      <p className="text-[11px] text-slate-600 font-medium flex items-center gap-1 pt-0.5">
                        <Info className="w-3.5 h-3.5 text-amber-700 flex-shrink-0" />
                        Please ensure the wallet supports BEP-20 on Binance Smart Chain. Payout is dispatched instantly.
                      </p>
                    </div>
                  </div>
                )}

                {/* --- DEBIT CARD PUSH INPUTS --- */}
                {destinationType === 'CARD' && (
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
                        16-Digit Debit Card Number
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

                    <div className="space-y-1.5">
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                        Cardholder Full Name
                      </label>
                      <input
                        type="text"
                        required
                        value={cardHolder}
                        onChange={(e) => setCardHolder(e.target.value)}
                        placeholder={`${currentUser.firstName} ${currentUser.lastName}`}
                        className="w-full px-4 py-3 text-sm rounded-xl border-2 border-slate-300 focus:ring-2 focus:ring-indigo-500 bg-white font-medium"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                          Expiry (MM/YY)
                        </label>
                        <input
                          type="text"
                          required
                          maxLength={5}
                          value={cardExpiry}
                          onChange={(e) => handleExpiryChange(e.target.value)}
                          placeholder="12/28"
                          className="w-full px-4 py-3 text-sm font-mono rounded-xl border-2 border-slate-300 focus:ring-2 focus:ring-indigo-500 bg-white font-bold"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                          CVV (3 Digits)
                        </label>
                        <input
                          type="password"
                          required
                          maxLength={4}
                          value={cardCvv}
                          onChange={(e) => setCardCvv(e.target.value.replace(/\D/g, '').slice(0, 4))}
                          placeholder="882"
                          className="w-full px-4 py-3 text-sm font-mono rounded-xl border-2 border-slate-300 focus:ring-2 focus:ring-indigo-500 bg-white font-bold"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* 4. Amount Input */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-black text-slate-900 uppercase tracking-wider font-mono">
                    4. Withdrawal Amount (USD)
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
                    <Zap className="w-3.5 h-3.5 fill-emerald-600 text-emerald-600" /> Instant Immediate Debit
                  </span>
                </div>
                <div className="flex items-center justify-between pt-2.5 border-t border-slate-200 font-black text-slate-950">
                  <span>Total Debit from {sourceAccount === 'CHECKING' ? 'Checking' : 'Savings'}:</span>
                  <span className="font-mono text-base text-emerald-700">${totalDeducted.toFixed(2)} USD</span>
                </div>
              </div>

              {/* Capital Preservation Notice */}
              <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-amber-50/80 border-2 border-amber-200/80 text-xs text-amber-900">
                <Lock className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" />
                <span className="font-medium">
                  Invested funds (${balanceMetrics?.investedBalance.toLocaleString() || '0'}) are actively locked in term sovereign contracts with 4.5% interest and cannot be withdrawn before maturity.
                </span>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
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
            </form>
          ) : (
            <div className="text-center space-y-6 animate-in zoom-in-95 py-3">
              <div className="w-20 h-20 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-md">
                <CheckCircle2 className="w-12 h-12 text-emerald-600" />
              </div>

              <div className="space-y-1.5">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-black uppercase tracking-wider border border-emerald-300">
                  <Sparkles className="w-3.5 h-3.5" /> Debited & Dispatched Instantly
                </div>
                <h3 className="text-2xl sm:text-3xl font-black text-slate-950">Withdrawal Successful</h3>
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
                  <span className="text-emerald-700 font-sans font-black">SETTLED & DEBITED INSTANTLY</span>
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
