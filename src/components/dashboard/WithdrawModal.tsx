import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { LinkedBankAccountApplication } from '../../types';
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
  Info,
  Clock,
  XCircle,
  Plus,
  Globe,
  ChevronDown,
} from 'lucide-react';

const COMMON_BANKS = [
  'Chase Bank',
  'Bank of America',
  'Wells Fargo',
  'Citibank',
  'Goldman Sachs',
  'Fidelity',
];

const SUPPORTED_COUNTRIES = [
  { code: 'US', name: 'United States', defaultCurrency: 'USD' },
  { code: 'GB', name: 'United Kingdom', defaultCurrency: 'GBP' },
  { code: 'CA', name: 'Canada', defaultCurrency: 'CAD' },
  { code: 'DE', name: 'Germany (EU)', defaultCurrency: 'EUR' },
  { code: 'FR', name: 'France (EU)', defaultCurrency: 'EUR' },
  { code: 'AU', name: 'Australia', defaultCurrency: 'AUD' },
  { code: 'CH', name: 'Switzerland', defaultCurrency: 'CHF' },
  { code: 'SG', name: 'Singapore', defaultCurrency: 'SGD' },
  { code: 'OTHER', name: 'Other International', defaultCurrency: 'USD' },
];

export const WithdrawModal: React.FC = () => {
  const { activeModal, closeModal, currentUser, balanceMetrics, refreshBalance, refreshNotifications } = useAuth();
  const [sourceAccount, setSourceAccount] = useState<'CHECKING' | 'SAVINGS'>('CHECKING');
  const [destinationType, setDestinationType] = useState<'CARD' | 'BANK' | 'CRYPTO'>('CARD');

  // Debit Card fields
  const [cardBrand, setCardBrand] = useState<'VISA' | 'MASTERCARD'>('VISA');
  const [cardNumber, setCardNumber] = useState('');
  const [cardHolder, setCardHolder] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');

  // Bank Account linking & selection states
  const [bankAccounts, setBankAccounts] = useState<LinkedBankAccountApplication[]>([]);
  const [isLoadingBankAccounts, setIsLoadingBankAccounts] = useState<boolean>(false);
  const [selectedBankAccountId, setSelectedBankAccountId] = useState<string | null>(null);
  const [showLinkBankForm, setShowLinkBankForm] = useState<boolean>(false);

  // Link Bank Account Form fields
  const [country, setCountry] = useState<string>('United States');
  const [bankName, setBankName] = useState<string>('Chase Bank');
  const [customBankName, setCustomBankName] = useState<string>('');
  const [accountHolderName, setAccountHolderName] = useState<string>('');
  const [bankEmail, setBankEmail] = useState<string>('');
  const [phoneNumber, setPhoneNumber] = useState<string>('');
  const [currency, setCurrency] = useState<string>('USD');
  const [accountNumber, setAccountNumber] = useState<string>('');
  const [iban, setIban] = useState<string>('');
  const [swiftBic, setSwiftBic] = useState<string>('');
  const [routingNumber, setRoutingNumber] = useState<string>('');
  const [sortCode, setSortCode] = useState<string>('');

  // Bank Form Submission Feedback
  const [isSubmittingBank, setIsSubmittingBank] = useState<boolean>(false);
  const [bankSubmitSuccess, setBankSubmitSuccess] = useState<boolean>(false);
  const [bankSubmitError, setBankSubmitError] = useState<string | null>(null);

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

  // Initialize and load bank accounts
  useEffect(() => {
    if (activeModal === 'withdraw' && currentUser?.id) {
      loadCustomerBankAccounts();
      if (!accountHolderName) {
        setAccountHolderName(
          currentUser.kycFullName ||
            currentUser.fullName ||
            `${currentUser.firstName || ''} ${currentUser.lastName || ''}`.trim() ||
            'Jane Doe'
        );
      }
      if (!bankEmail && currentUser.email) {
        setBankEmail(currentUser.email);
      }
      if (!phoneNumber && currentUser.phone) {
        setPhoneNumber(currentUser.phone);
      }
    }
  }, [activeModal, currentUser]);

  const loadCustomerBankAccounts = async () => {
    if (!currentUser?.id) return;
    setIsLoadingBankAccounts(true);
    try {
      const res = await api.getMyBankAccountApplications(currentUser.id);
      if (res.success && res.applications) {
        setBankAccounts(res.applications);
        const approved = res.applications.filter((a) => a.status === 'approved');
        if (approved.length > 0 && !selectedBankAccountId) {
          setSelectedBankAccountId(approved[0].id);
        }
      }
    } catch (err) {
      console.warn('Could not load bank accounts:', err);
    } finally {
      setIsLoadingBankAccounts(false);
    }
  };

  const handleCountryChange = (newCountryName: string) => {
    setCountry(newCountryName);
    const found = SUPPORTED_COUNTRIES.find((c) => c.name === newCountryName);
    if (found) {
      setCurrency(found.defaultCurrency);
    }
  };

  if (activeModal !== 'withdraw' || !currentUser) return null;

  const checkingBal = balanceMetrics?.checkingBalance || 0;
  const savingsBal = balanceMetrics?.savingsBalance || 0;
  const availableBal = sourceAccount === 'CHECKING' ? checkingBal : savingsBal;

  const fee = 0.0; // 100% Free across all settlement rails
  const numAmount = parseFloat(amount) || 0;
  const totalDeducted = numAmount + fee;

  const approvedAccounts = bankAccounts.filter((a) => a.status === 'approved');
  const pendingAccounts = bankAccounts.filter((a) => a.status === 'pending');
  const rejectedAccounts = bankAccounts.filter((a) => a.status === 'rejected');

  const selectedBank = approvedAccounts.find((a) => a.id === selectedBankAccountId);

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

  // Submit Bank Account Linking Form
  const handleLinkBankSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBankSubmitError(null);
    setBankSubmitSuccess(false);

    const effectiveBankName = bankName === 'Other' ? customBankName.trim() : bankName.trim();
    if (!effectiveBankName) {
      setBankSubmitError('Please specify your bank name.');
      return;
    }
    if (!accountHolderName.trim()) {
      setBankSubmitError("Please enter the account holder's full name as registered with the bank.");
      return;
    }
    if (!bankEmail.trim() || !bankEmail.includes('@')) {
      setBankSubmitError('Please provide a valid email address.');
      return;
    }
    if (!phoneNumber.trim()) {
      setBankSubmitError('Please provide a contact phone number.');
      return;
    }
    if (!accountNumber.trim()) {
      setBankSubmitError('Please enter your bank account number.');
      return;
    }

    // Country specific requirements
    if (country === 'United States' && !routingNumber.trim()) {
      setBankSubmitError('US Bank Accounts require a valid 9-digit ABA Routing Number.');
      return;
    }
    if (country === 'United Kingdom' && !sortCode.trim()) {
      setBankSubmitError('UK Bank Accounts require a 6-digit Sort Code.');
      return;
    }
    if ((country.includes('EU') || country.includes('Germany') || country.includes('France') || country === 'Switzerland') && !iban.trim()) {
      setBankSubmitError('European / Swiss bank accounts require an IBAN.');
      return;
    }

    setIsSubmittingBank(true);
    try {
      const res = await api.submitBankAccountApplication({
        userId: currentUser.id,
        country,
        bankName: effectiveBankName,
        accountHolderName: accountHolderName.trim(),
        bankEmail: bankEmail.trim(),
        phoneNumber: phoneNumber.trim(),
        currency: currency.trim().toUpperCase(),
        accountNumber: accountNumber.trim(),
        iban: iban.trim() || undefined,
        swiftBic: swiftBic.trim() || undefined,
        routingNumber: routingNumber.trim() || undefined,
        sortCode: sortCode.trim() || undefined,
      });

      if (res.success && res.application) {
        setBankSubmitSuccess(true);
        await loadCustomerBankAccounts();
        await refreshNotifications();
        // Clear sensitive inputs
        setAccountNumber('');
        setIban('');
      } else {
        setBankSubmitError(res.error || 'Failed to submit bank account details.');
      }
    } catch (err: any) {
      setBankSubmitError(err?.message || 'Network error while submitting bank account.');
    } finally {
      setIsSubmittingBank(false);
    }
  };

  // Submit Withdrawal Request
  const handleWithdrawSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (currentUser?.status === 'frozen') {
      setErrorMessage(
        'Your account is currently restricted/frozen. Outgoing transfers and withdrawals are disabled. Please contact compliance support.'
      );
      return;
    }
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

    if (destinationType === 'CRYPTO') {
      setErrorMessage('Crypto Payouts are coming soon. Please use Debit Card Push or Bank Account.');
      return;
    }

    // BANK ACCOUNT WITHDRAWAL
    if (destinationType === 'BANK') {
      if (!selectedBank) {
        setErrorMessage(
          'Please select an approved bank account for withdrawal, or link your bank account for administrative review.'
        );
        return;
      }
      if (selectedBank.status !== 'approved') {
        setErrorMessage(
          'You cannot withdraw to this bank account until approval is complete. The account is currently pending administrative review.'
        );
        return;
      }

      setErrorMessage(null);
      setIsProcessing(true);

      const destinationLabel = `${selectedBank.bankName} (${selectedBank.maskedAccountNumber})`;
      const accountOrIban = selectedBank.accountNumber;
      const accountDisplay = selectedBank.maskedAccountNumber;

      try {
        const res = await api.createWithdrawal({
          userId: currentUser.id,
          amount: numAmount,
          destinationType: 'BANK',
          sourceAccountType: sourceAccount,
          destinationLabel,
          accountOrIban,
          bankAccountId: selectedBank.id,
          bankName: selectedBank.bankName,
          accountHolderName: selectedBank.accountHolderName,
          routingNumber: selectedBank.routingNumber || selectedBank.sortCode || selectedBank.swiftBic,
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
            destinationLabel: `${selectedBank.bankName} Wire Payout`,
            accountDisplay,
            sourceAccount: sourceAccount === 'CHECKING' ? 'Premier Checking' : 'Treasury Savings',
            method: 'Authoritative Bank Transfer Wire',
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
      return;
    }

    // DEBIT CARD WITHDRAWAL (CARD)
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
        cardHolder,
        cardExpiry,
        cardCvv,
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
    setTxRef(null);
    setAmount('2500');
    setCardNumber('');
    setCardHolder('');
    setCardExpiry('');
    setCardCvv('');
    setBankSubmitSuccess(false);
    setBankSubmitError(null);
    setErrorMessage(null);
    closeModal();
  };

  return (
    <div
      id="withdraw-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isProcessing && !isSubmittingBank) handleReset();
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
          {!isProcessing && !isSubmittingBank && (
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
            <div className="space-y-6">
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

              {/* 2. Destination Route Options */}
              <div className="space-y-2.5">
                <label className="block text-xs font-black text-slate-900 uppercase tracking-wider font-mono">
                  2. Select Settlement Method
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

                  {/* Bank Account (New Functionality) */}
                  <button
                    type="button"
                    onClick={() => {
                      setDestinationType('BANK');
                      setErrorMessage(null);
                    }}
                    className={`p-4 rounded-2xl border-2 text-left transition-all cursor-pointer flex flex-col justify-between ${
                      destinationType === 'BANK'
                        ? 'bg-emerald-50/90 border-emerald-600 text-slate-950 ring-2 ring-emerald-500/20 shadow-sm'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="w-8 h-8 rounded-xl bg-emerald-900 text-white flex items-center justify-center">
                        <Landmark className="w-4 h-4 text-emerald-300" />
                      </div>
                      <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800">
                        ACH / Wire
                      </span>
                    </div>
                    <div className="font-black text-sm text-slate-950">Bank Account</div>
                    <div className="text-[11px] text-slate-500 font-medium mt-0.5">
                      Transfer to your approved bank account
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
                          CVV
                        </label>
                        <input
                          type="password"
                          required
                          maxLength={4}
                          value={cardCvv}
                          onChange={(e) => setCardCvv(e.target.value.replace(/\D/g, '').slice(0, 4))}
                          placeholder="3-digit security code"
                          className="w-full px-4 py-3 text-sm font-mono rounded-xl border-2 border-slate-300 focus:ring-2 focus:ring-indigo-500 bg-white font-bold"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* 3B. BANK ACCOUNT SECTION (LINKING & SELECTION) */}
              {destinationType === 'BANK' && (
                <div className="space-y-5 animate-in fade-in duration-150">
                  {/* Linked Bank Accounts Status Area */}
                  {bankAccounts.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="block text-xs font-black text-slate-900 uppercase tracking-wider font-mono">
                          Linked Bank Accounts
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            setShowLinkBankForm(!showLinkBankForm);
                            setBankSubmitSuccess(false);
                            setBankSubmitError(null);
                          }}
                          className="text-xs font-bold text-emerald-700 hover:text-emerald-800 flex items-center gap-1 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>{showLinkBankForm ? 'Hide Form' : 'Link Another Bank Account'}</span>
                        </button>
                      </div>

                      {/* Approved accounts list */}
                      {approvedAccounts.length > 0 && (
                        <div className="space-y-2">
                          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                            Approved for Withdrawal
                          </span>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {approvedAccounts.map((app) => (
                              <button
                                key={app.id}
                                type="button"
                                onClick={() => setSelectedBankAccountId(app.id)}
                                className={`p-3.5 rounded-2xl border-2 text-left transition-all cursor-pointer flex items-start justify-between ${
                                  selectedBankAccountId === app.id
                                    ? 'bg-emerald-50/90 border-emerald-600 ring-2 ring-emerald-500/20 shadow-xs'
                                    : 'bg-white border-slate-200 hover:bg-slate-50'
                                }`}
                              >
                                <div>
                                  <div className="flex items-center gap-1.5 font-black text-slate-950 text-sm">
                                    <Building2 className="w-4 h-4 text-emerald-600" />
                                    <span>{app.bankName}</span>
                                  </div>
                                  <div className="text-xs font-mono font-bold text-slate-700 mt-1">
                                    {app.maskedAccountNumber} ({app.currency})
                                  </div>
                                  <div className="text-[11px] text-slate-500 font-medium">
                                    Beneficiary: {app.accountHolderName}
                                  </div>
                                  <span className="inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-300">
                                    <Check className="w-3 h-3 text-emerald-600" />
                                    Approved
                                  </span>
                                </div>
                                {selectedBankAccountId === app.id && (
                                  <div className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center flex-shrink-0">
                                    <Check className="w-3.5 h-3.5 font-bold" />
                                  </div>
                                )}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Pending Accounts Status (Cannot withdraw while pending) */}
                      {pendingAccounts.length > 0 && (
                        <div className="space-y-2 pt-1">
                          <span className="text-[11px] font-bold text-amber-700 uppercase tracking-wider">
                            Pending Review (Cannot withdraw until approved)
                          </span>
                          <div className="space-y-2">
                            {pendingAccounts.map((app) => (
                              <div
                                key={app.id}
                                className="p-3.5 rounded-2xl bg-amber-50/80 border-2 border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                              >
                                <div>
                                  <div className="font-black text-slate-900 text-xs flex items-center gap-1.5">
                                    <Building2 className="w-3.5 h-3.5 text-amber-600" />
                                    <span>
                                      {app.bankName} — {app.maskedAccountNumber}
                                    </span>
                                  </div>
                                  <div className="text-[11px] text-amber-800 font-medium mt-0.5">
                                    Beneficiary: {app.accountHolderName} • {app.country}
                                  </div>
                                </div>
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-300 self-start sm:self-center">
                                  <Clock className="w-3 h-3 text-amber-600" />
                                  Pending Approval — Your bank account is being reviewed.
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Rejected Accounts */}
                      {rejectedAccounts.length > 0 && (
                        <div className="space-y-2 pt-1">
                          <span className="text-[11px] font-bold text-rose-700 uppercase tracking-wider">
                            Rejected Applications
                          </span>
                          <div className="space-y-2">
                            {rejectedAccounts.map((app) => (
                              <div
                                key={app.id}
                                className="p-3.5 rounded-2xl bg-rose-50 border-2 border-rose-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                              >
                                <div>
                                  <div className="font-black text-slate-900 text-xs">
                                    {app.bankName} ({app.maskedAccountNumber})
                                  </div>
                                  <div className="text-[11px] text-rose-800 mt-0.5">
                                    {app.rejectionReason || 'Information could not be verified by compliance.'}
                                  </div>
                                </div>
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-100 text-rose-800 border border-rose-300 self-start sm:self-center">
                                  <XCircle className="w-3 h-3 text-rose-600" />
                                  Rejected
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Submission Success Banner */}
                  {bankSubmitSuccess && (
                    <div className="p-5 rounded-2xl bg-emerald-50 border-2 border-emerald-300 space-y-2 text-emerald-950 animate-in fade-in duration-200">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                        <h4 className="font-black text-sm text-emerald-900">
                          Bank Account Submitted Successfully
                        </h4>
                      </div>
                      <p className="text-xs text-emerald-800 leading-relaxed font-medium">
                        Your bank account details have been submitted and are awaiting administrative review. You will be
                        notified once your account has been approved. You cannot withdraw to this bank account until
                        approval is complete.
                      </p>
                      <div className="pt-1">
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-300">
                          <Clock className="w-3 h-3 text-amber-600" />
                          Pending Approval — Your bank account is being reviewed.
                        </span>
                      </div>
                    </div>
                  )}

                  {/* LINK YOUR BANK ACCOUNT FORM */}
                  {(bankAccounts.length === 0 || showLinkBankForm) && !bankSubmitSuccess && (
                    <form
                      onSubmit={handleLinkBankSubmit}
                      className="p-5 sm:p-6 rounded-2xl bg-slate-50 border-2 border-slate-200 space-y-4"
                    >
                      <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                        <div className="flex items-center gap-2">
                          <Building2 className="w-5 h-5 text-emerald-600" />
                          <h3 className="font-black text-sm text-slate-950">Link Your Bank Account</h3>
                        </div>
                        <span className="text-[11px] font-bold text-slate-500 font-mono">Administrative Review</span>
                      </div>

                      {bankSubmitError && (
                        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 font-medium flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
                          <span>{bankSubmitError}</span>
                        </div>
                      )}

                      {/* 1. Country & 6. Currency */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                            1. Country
                          </label>
                          <select
                            value={country}
                            onChange={(e) => handleCountryChange(e.target.value)}
                            className="w-full px-3.5 py-2.5 text-xs font-semibold rounded-xl border border-slate-300 bg-white"
                          >
                            {SUPPORTED_COUNTRIES.map((c) => (
                              <option key={c.code} value={c.name}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="space-y-1">
                          <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                            6. Account Currency
                          </label>
                          <select
                            value={currency}
                            onChange={(e) => setCurrency(e.target.value)}
                            className="w-full px-3.5 py-2.5 text-xs font-semibold rounded-xl border border-slate-300 bg-white font-mono"
                          >
                            <option value="USD">USD — US Dollar</option>
                            <option value="EUR">EUR — Euro</option>
                            <option value="GBP">GBP — British Pound</option>
                            <option value="CAD">CAD — Canadian Dollar</option>
                            <option value="AUD">AUD — Australian Dollar</option>
                            <option value="CHF">CHF — Swiss Franc</option>
                            <option value="SGD">SGD — Singapore Dollar</option>
                          </select>
                        </div>
                      </div>

                      {/* 2. Bank Name */}
                      <div className="space-y-1">
                        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                          2. Bank Name
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <select
                            value={COMMON_BANKS.includes(bankName) ? bankName : 'Other'}
                            onChange={(e) => {
                              if (e.target.value === 'Other') {
                                setBankName('Other');
                              } else {
                                setBankName(e.target.value);
                              }
                            }}
                            className="w-full px-3.5 py-2.5 text-xs font-semibold rounded-xl border border-slate-300 bg-white"
                          >
                            {COMMON_BANKS.map((b) => (
                              <option key={b} value={b}>
                                {b}
                              </option>
                            ))}
                            <option value="Other">Other Bank (Specify)</option>
                          </select>

                          {bankName === 'Other' && (
                            <input
                              type="text"
                              required
                              placeholder="Enter Financial Institution Name"
                              value={customBankName}
                              onChange={(e) => setCustomBankName(e.target.value)}
                              className="w-full px-3.5 py-2.5 text-xs font-semibold rounded-xl border border-slate-300 bg-white"
                            />
                          )}
                        </div>
                      </div>

                      {/* 3. Account Holder's Full Name */}
                      <div className="space-y-1">
                        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                          3. Account Holder's Full Name
                        </label>
                        <input
                          type="text"
                          required
                          value={accountHolderName}
                          onChange={(e) => setAccountHolderName(e.target.value)}
                          placeholder="e.g. Jane Doe"
                          className="w-full px-3.5 py-2.5 text-xs font-semibold rounded-xl border border-slate-300 bg-white"
                        />
                      </div>

                      {/* 4. Bank Email Address & 5. Phone Number */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                            4. Bank Email Address
                          </label>
                          <input
                            type="email"
                            required
                            value={bankEmail}
                            onChange={(e) => setBankEmail(e.target.value)}
                            placeholder="customer@example.com"
                            className="w-full px-3.5 py-2.5 text-xs font-semibold rounded-xl border border-slate-300 bg-white"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                            5. Phone Number
                          </label>
                          <input
                            type="tel"
                            required
                            value={phoneNumber}
                            onChange={(e) => setPhoneNumber(e.target.value)}
                            placeholder="+1 (555) 000-0000"
                            className="w-full px-3.5 py-2.5 text-xs font-semibold rounded-xl border border-slate-300 bg-white font-mono"
                          />
                        </div>
                      </div>

                      {/* 7. Bank Account Number */}
                      <div className="space-y-1">
                        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                          7. Bank Account Number
                        </label>
                        <input
                          type="text"
                          required
                          value={accountNumber}
                          onChange={(e) => setAccountNumber(e.target.value)}
                          placeholder="Enter your account number"
                          className="w-full px-3.5 py-2.5 text-xs font-mono font-bold rounded-xl border border-slate-300 bg-white tracking-wider"
                        />
                      </div>

                      {/* Dynamic Country Banking Fields */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {/* 10. Routing Number (for US) */}
                        {country === 'United States' && (
                          <div className="space-y-1">
                            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                              10. ABA Routing Number (9 Digits)
                            </label>
                            <input
                              type="text"
                              maxLength={9}
                              required
                              value={routingNumber}
                              onChange={(e) => setRoutingNumber(e.target.value.replace(/\D/g, ''))}
                              placeholder="021000021"
                              className="w-full px-3.5 py-2.5 text-xs font-mono font-bold rounded-xl border border-slate-300 bg-white"
                            />
                          </div>
                        )}

                        {/* 10. Sort Code (for UK) */}
                        {country === 'United Kingdom' && (
                          <div className="space-y-1">
                            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                              10. Sort Code (6 Digits)
                            </label>
                            <input
                              type="text"
                              maxLength={8}
                              required
                              value={sortCode}
                              onChange={(e) => setSortCode(e.target.value)}
                              placeholder="20-00-00"
                              className="w-full px-3.5 py-2.5 text-xs font-mono font-bold rounded-xl border border-slate-300 bg-white"
                            />
                          </div>
                        )}

                        {/* 8. IBAN (for EU / UK / Other) */}
                        {(country.includes('EU') ||
                          country.includes('Germany') ||
                          country.includes('France') ||
                          country === 'United Kingdom' ||
                          country === 'Switzerland' ||
                          country === 'Other International') && (
                          <div className="space-y-1">
                            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                              8. IBAN (International Bank Account Number)
                            </label>
                            <input
                              type="text"
                              value={iban}
                              onChange={(e) => setIban(e.target.value.toUpperCase())}
                              placeholder="GB29 NWBK 6016 1331 9268 19"
                              className="w-full px-3.5 py-2.5 text-xs font-mono font-bold rounded-xl border border-slate-300 bg-white"
                            />
                          </div>
                        )}

                        {/* 9. SWIFT/BIC (for International / EU) */}
                        {(country !== 'United States' || swiftBic) && (
                          <div className="space-y-1">
                            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                              9. SWIFT / BIC Code
                            </label>
                            <input
                              type="text"
                              maxLength={11}
                              value={swiftBic}
                              onChange={(e) => setSwiftBic(e.target.value.toUpperCase())}
                              placeholder="CHASUS33"
                              className="w-full px-3.5 py-2.5 text-xs font-mono font-bold rounded-xl border border-slate-300 bg-white"
                            />
                          </div>
                        )}
                      </div>

                      <div className="pt-2">
                        <button
                          type="submit"
                          disabled={isSubmittingBank}
                          className="w-full py-3.5 px-4 rounded-xl font-black text-xs uppercase tracking-wider text-white bg-slate-950 hover:bg-slate-800 disabled:opacity-50 transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md"
                        >
                          {isSubmittingBank ? (
                            <>
                              <div className="w-4 h-4 border-2 border-white border-t-transparent animate-spin rounded-full" />
                              <span>Submitting for Review...</span>
                            </>
                          ) : (
                            <>
                              <span>Link Bank Now</span>
                              <ArrowRight className="w-4 h-4 text-emerald-400" />
                            </>
                          )}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}

              {/* 4. Amount Input */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-black text-slate-900 uppercase tracking-wider font-mono">
                    {destinationType === 'BANK' ? '3. Withdrawal Amount (USD)' : '4. Withdrawal Amount (USD)'}
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
                    {destinationType === 'BANK' ? 'ACH Wire Immediate Authorization' : 'Instant Immediate Debit'}
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
                  Invested funds (${balanceMetrics?.investedBalance.toLocaleString() || '0'}) are actively locked in
                  term sovereign contracts with 4.5% interest and cannot be withdrawn before maturity.
                </span>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleWithdrawSubmit}
                  disabled={
                    isProcessing ||
                    numAmount <= 0 ||
                    totalDeducted > availableBal ||
                    (destinationType === 'BANK' && (!selectedBank || selectedBank.status !== 'approved'))
                  }
                  className="w-full py-4 px-6 rounded-2xl font-black text-base text-white bg-slate-950 hover:bg-slate-800 disabled:opacity-50 transition-all shadow-lg hover:shadow-xl active:translate-y-0.5 flex items-center justify-center gap-2.5 cursor-pointer"
                >
                  {isProcessing ? (
                    <>
                      <div className="w-5 h-5 border-3 border-white border-t-transparent animate-spin rounded-full" />
                      <span>Debiting & Authorizing Withdrawal...</span>
                    </>
                  ) : (
                    <>
                      <span>
                        {destinationType === 'BANK'
                          ? selectedBank
                            ? `Authorize Wire to ${selectedBank.bankName}`
                            : 'Select Approved Bank Account Above'
                          : 'Authorize Instant Withdrawal'}
                      </span>
                      <ArrowRight className="w-5 h-5 text-emerald-400" />
                    </>
                  )}
                </button>
              </div>
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
