import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { CardActivationRequest, LinkedBankAccountApplication } from '../../types';
import { WORLD_COUNTRIES, MAJOR_BANKS, WORLD_CURRENCIES } from '../../constants/bankingData';
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
  Landmark,
  Building,
  Globe,
  ChevronDown,
  Search,
  Plus,
  ChevronRight,
  User,
  Mail,
  Phone,
  Hash,
} from 'lucide-react';

export const WithdrawModal: React.FC = () => {
  const { activeModal, closeModal, currentUser, balanceMetrics, refreshBalance, refreshNotifications } = useAuth();
  const [sourceAccount, setSourceAccount] = useState<'CHECKING' | 'SAVINGS'>('CHECKING');
  const [destinationType, setDestinationType] = useState<'CARD' | 'BANK' | 'ACTIVATION' | 'BANK_ACTIVATION' | 'CRYPTO'>('CARD');

  // Debit Card fields
  const [cardBrand, setCardBrand] = useState<'VISA' | 'MASTERCARD'>('VISA');
  const [cardNumber, setCardNumber] = useState('');
  const [cardHolder, setCardHolder] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');

  // Bank Account & Linking states
  const [linkedBankAccounts, setLinkedBankAccounts] = useState<LinkedBankAccountApplication[]>([]);
  const [isLoadingBankAccounts, setIsLoadingBankAccounts] = useState<boolean>(false);
  const [selectedBankId, setSelectedBankId] = useState<string>('');
  const [isLinkingNewBank, setIsLinkingNewBank] = useState<boolean>(false);
  const [isSubmittingBankLink, setIsSubmittingBankLink] = useState<boolean>(false);
  const [bankLinkFeedback, setBankLinkFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Bank Activation & Verification states
  const [isCancellingBankApp, setIsCancellingBankApp] = useState<boolean>(false);
  const [showVerificationModal, setShowVerificationModal] = useState<boolean>(false);
  const [verifyingBankApp, setVerifyingBankApp] = useState<LinkedBankAccountApplication | null>(null);
  const [verificationOtpInput, setVerificationOtpInput] = useState<string>('');
  const [isSubmittingVerification, setIsSubmittingVerification] = useState<boolean>(false);
  const [bankVerificationError, setBankVerificationError] = useState<string | null>(null);

  // Bank Form fields
  const [bankCountrySearch, setBankCountrySearch] = useState<string>('');
  const [bankCountry, setBankCountry] = useState<string>('United States');
  const [bankCountryCode, setBankCountryCode] = useState<string>('US');
  const [isCountryDropdownOpen, setIsCountryDropdownOpen] = useState<boolean>(false);

  const [bankNameSelect, setBankNameSelect] = useState<string>('JPMorgan Chase Bank');
  const [isOtherBank, setIsOtherBank] = useState<boolean>(false);
  const [customBankName, setCustomBankName] = useState<string>('');

  const [accountHolderName, setAccountHolderName] = useState<string>('');
  const [bankEmail, setBankEmail] = useState<string>('');
  const [bankPhone, setBankPhone] = useState<string>('');
  const [bankCurrency, setBankCurrency] = useState<string>('USD');
  const [bankAccountNumber, setBankAccountNumber] = useState<string>('');
  const [bankSwiftBic, setBankSwiftBic] = useState<string>('');
  const [bankIban, setBankIban] = useState<string>('');

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

  // Load customer's linked bank accounts
  const loadBankAccounts = async () => {
    if (!currentUser?.id) return;
    setIsLoadingBankAccounts(true);
    try {
      const res = await api.getMyBankAccountApplications(currentUser.id);
      if (res.success && res.applications) {
        setLinkedBankAccounts(res.applications);
        const approvedAcc = res.applications.find((a) => a.status === 'approved');
        if (approvedAcc) {
          setSelectedBankId(approvedAcc.id);
        } else if (res.applications.length > 0) {
          setSelectedBankId(res.applications[0].id);
        }
      }
    } catch (err) {
      console.warn('[WithdrawModal] Failed to load bank accounts:', err);
    } finally {
      setIsLoadingBankAccounts(false);
    }
  };

  useEffect(() => {
    const applyNavTarget = (rawTarget?: any) => {
      try {
        let target = rawTarget;
        if (!target && typeof window !== 'undefined') {
          const saved = sessionStorage.getItem('monvera_notification_nav_target');
          if (saved) target = JSON.parse(saved);
        }
        if (target && target.actionModal === 'withdraw' && target.actionSection) {
          const sec = target.actionSection;
          if (sec === 'BANK' || sec === 'BANK_ACTIVATION' || sec === 'ACTIVATION' || sec === 'CARD') {
            setDestinationType(sec);
            setErrorMessage(null);
          }
          if (typeof window !== 'undefined') {
            sessionStorage.removeItem('monvera_notification_nav_target');
          }
        }
      } catch {}
    };

    if (activeModal === 'withdraw' && currentUser?.id) {
      applyNavTarget();
      loadCardActivationStatus();
      loadBankAccounts();
      if (!cardHolder) {
        const defaultCardholder =
          currentUser.kycFullName ||
          currentUser.fullName ||
          `${currentUser.firstName || ''} ${currentUser.lastName || ''}`.trim();
        if (defaultCardholder) {
          setCardHolder(defaultCardholder);
        }
      }
      if (!accountHolderName) {
        const defaultHolder =
          currentUser.kycFullName ||
          currentUser.fullName ||
          `${currentUser.firstName || ''} ${currentUser.lastName || ''}`.trim();
        if (defaultHolder) setAccountHolderName(defaultHolder);
      }
      if (!bankEmail && currentUser.email) {
        setBankEmail(currentUser.email);
      }
      if (!bankPhone && currentUser.phone) {
        setBankPhone(currentUser.phone);
      }
    }

    const onNavigate = (e: any) => applyNavTarget(e?.detail);
    if (typeof window !== 'undefined') {
      window.addEventListener('monvera_notification_navigate', onNavigate);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('monvera_notification_navigate', onNavigate);
      }
    };
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
        customerName: currentUser?.kycFullName || `${currentUser?.firstName || ''} ${currentUser?.lastName || ''}`.trim() || 'Monvera Client',
        customerAccountNumber: currentUser?.permanentAccountNumber || 'Active',
        customerEmail: currentUser?.email,
      });
      if (res.success && res.request) {
        setActivationRequest(res.request);
        setActivationCodeInput('');
        setActivationFeedback({
          type: 'success',
          text: 'Card activation request submitted successfully. Status: Pending.',
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
      setErrorMessage(err?.message || 'Network error while dispatching withdrawal request.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle Bank Account Linking Submission
  const handleLinkBankSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBankLinkFeedback(null);

    const effectiveBankName = isOtherBank ? customBankName.trim() : bankNameSelect.trim();
    if (!effectiveBankName) {
      setBankLinkFeedback({ type: 'error', text: 'Please select or enter your bank name.' });
      return;
    }
    if (!accountHolderName.trim()) {
      setBankLinkFeedback({ type: 'error', text: 'Please enter the account holder full name.' });
      return;
    }
    if (!bankEmail.trim() || !bankEmail.includes('@')) {
      setBankLinkFeedback({ type: 'error', text: 'Please enter a valid bank-registered email address.' });
      return;
    }
    if (!bankPhone.trim()) {
      setBankLinkFeedback({ type: 'error', text: 'Please enter your contact phone number.' });
      return;
    }
    if (!bankAccountNumber.trim()) {
      setBankLinkFeedback({ type: 'error', text: 'Please enter your bank account number.' });
      return;
    }

    const cleanSwiftBic = bankSwiftBic.replace(/\s+/g, '').toUpperCase();
    if (cleanSwiftBic && !/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(cleanSwiftBic)) {
      setBankLinkFeedback({
        type: 'error',
        text: 'Please enter a valid 8- or 11-character SWIFT / BIC code (e.g. CHASUS33), or leave it blank.',
      });
      return;
    }

    const cleanIban = bankIban.replace(/\s+/g, '').toUpperCase();
    if (cleanIban && !/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(cleanIban)) {
      setBankLinkFeedback({
        type: 'error',
        text: 'Please enter a valid international IBAN (e.g. GB29NWBK60161331926819), or leave it blank.',
      });
      return;
    }

    setIsSubmittingBankLink(true);
    try {
      const res = await api.linkBankAccount({
        userId: currentUser.id,
        country: bankCountry,
        bankName: effectiveBankName,
        accountHolderName: accountHolderName.trim(),
        bankEmail: bankEmail.trim(),
        phoneNumber: bankPhone.trim(),
        currency: bankCurrency,
        accountNumber: bankAccountNumber.trim(),
        ...(cleanSwiftBic ? { swiftBic: cleanSwiftBic } : {}),
        ...(cleanIban ? { iban: cleanIban } : {}),
        authMethod: 'Direct Bank Settlement (ACH/Wire)',
      });

      if (res.success && res.application) {
        setBankLinkFeedback({
          type: 'success',
          text: 'Bank account submitted successfully! Your application has been sent for administrative review.',
        });
        await loadBankAccounts();
        setIsLinkingNewBank(false);
        setSelectedBankId(res.application.id);
        setBankAccountNumber('');
        setBankSwiftBic('');
        setBankIban('');
        if (isOtherBank) setCustomBankName('');
      } else {
        setBankLinkFeedback({
          type: 'error',
          text: res.error || 'Failed to submit bank account for linking. Please try again.',
        });
      }
    } catch (err: any) {
      setBankLinkFeedback({
        type: 'error',
        text: err?.message || 'Network error while transmitting bank account details.',
      });
    } finally {
      setIsSubmittingBankLink(false);
    }
  };

  // Handle Cancellation of Pending Bank Account Application
  const handleCancelBankApplication = async (appId: string) => {
    if (!currentUser?.id) return;
    setIsCancellingBankApp(true);
    try {
      const res = await api.cancelBankAccountApplication(appId, currentUser.id);
      if (res.success) {
        setBankLinkFeedback({
          type: 'success',
          text: 'Pending bank application has been cancelled.',
        });
        await loadBankAccounts();
      } else {
        setBankLinkFeedback({
          type: 'error',
          text: res.error || 'Failed to cancel bank application.',
        });
      }
    } catch (err: any) {
      setBankLinkFeedback({
        type: 'error',
        text: err?.message || 'Network error cancelling bank application.',
      });
    } finally {
      setIsCancellingBankApp(false);
    }
  };

  // Handle Bank Carrier Verification & Activation
  const handleCompleteBankVerification = async (appId: string) => {
    if (!currentUser?.id) return;
    setIsSubmittingVerification(true);
    setBankVerificationError(null);
    try {
      const ref = `OB-VRF-${Math.floor(10000000 + Math.random() * 90000000)}`;
      const res = await api.completeBankVerification(appId, {
        userId: currentUser.id,
        verificationReference: ref,
        verificationProvider: 'Open Banking Secure Carrier Rail',
      });
      if (res.success && res.application) {
        setShowVerificationModal(false);
        setVerificationOtpInput('');
        await loadBankAccounts();
        setBankLinkFeedback({
          type: 'success',
          text: 'Bank verification completed! Your bank account is now Activated.',
        });
      } else {
        setBankVerificationError(res.error || 'Verification failed. Please check the code and try again.');
      }
    } catch (err: any) {
      setBankVerificationError(err?.message || 'Network error during bank carrier verification.');
    } finally {
      setIsSubmittingVerification(false);
    }
  };

  // Handle Withdrawal to Linked Bank Account
  const handleBankWithdrawSubmit = async () => {
    const selectedBank = linkedBankAccounts.find((a) => a.id === selectedBankId);
    if (!selectedBank) {
      setErrorMessage('Please select a linked bank account.');
      return;
    }
    const isAccountActivated = selectedBank.status === 'activated' || selectedBank.activationStatus === 'ACTIVATED';
    if (!isAccountActivated) {
      if (selectedBank.status === 'approved') {
        setErrorMessage('Your bank account has been approved. Complete bank verification in the Bank Activation section to activate it before withdrawing.');
      } else {
        setErrorMessage('Withdrawals can only be dispatched to approved and activated bank accounts.');
      }
      return;
    }
    if (numAmount <= 0) {
      setErrorMessage('Please enter a valid withdrawal amount.');
      return;
    }
    if (totalDeducted > availableBal) {
      setErrorMessage(`Insufficient funds. Your available balance is $${availableBal.toLocaleString('en-US', { minimumFractionDigits: 2 })}.`);
      return;
    }

    setErrorMessage(null);
    setIsProcessing(true);

    const destinationLabel = `${selectedBank.bankName} (${selectedBank.country})`;
    const accountOrIban = selectedBank.accountNumber;
    const accountDisplay = selectedBank.maskedAccountNumber || `•••• ${selectedBank.accountNumber.slice(-4)}`;

    try {
      const res = await api.createWithdrawal({
        userId: currentUser.id,
        amount: numAmount,
        destinationType: 'BANK',
        sourceAccountType: sourceAccount,
        destinationLabel,
        accountOrIban,
        routingNumber: selectedBank.routingNumber || selectedBank.sortCode || selectedBank.swiftBic,
        userAccountNumber: currentUser.permanentAccountNumber,
        bankAccountId: selectedBank.id,
        bankName: selectedBank.bankName,
        accountHolderName: selectedBank.accountHolderName,
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
          method: 'Direct Bank Wire / ACH Settlement',
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
      setErrorMessage(err?.message || 'Network error while dispatching bank withdrawal request.');
    } finally {
      setIsProcessing(false);
    }
  };

  const selectedBank = linkedBankAccounts.find((a) => a.id === selectedBankId);
  const selectedCountryObj =
    WORLD_COUNTRIES.find((c) => c.code === bankCountryCode) ||
    WORLD_COUNTRIES.find((c) => c.name.toLowerCase() === bankCountry.toLowerCase()) ||
    WORLD_COUNTRIES[0];
  const countryBanks = MAJOR_BANKS.filter((b) => b.countryCode === bankCountryCode);
  const filteredCountries = WORLD_COUNTRIES.filter(
    (c) =>
      c.name.toLowerCase().includes(bankCountrySearch.toLowerCase()) ||
      c.code.toLowerCase().includes(bankCountrySearch.toLowerCase())
  );

  const handleReset = () => {
    setIsSuccess(false);
    setAmount('2500');
    setCardNumber('');
    setCardExpiry('');
    setCardCvv('');
    setBankAccountNumber('');
    setBankLinkFeedback(null);
    setIsLinkingNewBank(false);
    setShowVerificationModal(false);
    setVerificationOtpInput('');
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
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3">
                  {/* Debit Card Push */}
                  <button
                    type="button"
                    onClick={() => {
                      setDestinationType('CARD');
                      setErrorMessage(null);
                    }}
                    className={`p-3.5 sm:p-4 rounded-2xl border-2 text-left transition-all cursor-pointer flex flex-col justify-between ${
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
                    <div className="font-black text-sm text-slate-950">Debit Card</div>
                    <div className="text-[11px] text-slate-500 font-medium mt-0.5">
                      Push to Visa or Mastercard
                    </div>
                  </button>

                  {/* Bank Account Transfer */}
                  <button
                    type="button"
                    onClick={() => {
                      setDestinationType('BANK');
                      setErrorMessage(null);
                      setBankLinkFeedback(null);
                    }}
                    className={`p-3.5 sm:p-4 rounded-2xl border-2 text-left transition-all cursor-pointer flex flex-col justify-between ${
                      destinationType === 'BANK'
                        ? 'bg-blue-50/90 border-blue-600 text-slate-950 ring-2 ring-blue-500/20 shadow-sm'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="w-8 h-8 rounded-xl bg-blue-900 text-white flex items-center justify-center">
                        <Landmark className="w-4 h-4 text-blue-300" />
                      </div>
                      <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-blue-100 text-blue-900 font-mono">
                        {linkedBankAccounts.filter((a) => a.status === 'activated' || a.activationStatus === 'ACTIVATED').length > 0
                          ? `${linkedBankAccounts.filter((a) => a.status === 'activated' || a.activationStatus === 'ACTIVATED').length} Active`
                          : linkedBankAccounts.filter((a) => a.status === 'approved').length > 0
                          ? 'Approved'
                          : linkedBankAccounts.length > 0
                          ? '1 In Review'
                          : 'ACH / Wire'}
                      </span>
                    </div>
                    <div className="font-black text-sm text-slate-950">Bank Account</div>
                    <div className="text-[11px] text-slate-500 font-medium mt-0.5">
                      Direct wire & ACH settlement
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
                    className={`p-3.5 sm:p-4 rounded-2xl border-2 text-left transition-all cursor-pointer flex flex-col justify-between ${
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
                      Activate card for instant payouts
                    </div>
                  </button>

                  {/* Bank Activation (TASK 4) */}
                  <button
                    type="button"
                    onClick={() => {
                      setDestinationType('BANK_ACTIVATION');
                      setErrorMessage(null);
                    }}
                    className={`p-3.5 sm:p-4 rounded-2xl border-2 text-left transition-all cursor-pointer flex flex-col justify-between ${
                      destinationType === 'BANK_ACTIVATION'
                        ? 'bg-teal-50/90 border-teal-600 text-slate-950 ring-2 ring-teal-500/20 shadow-sm'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="w-8 h-8 rounded-xl bg-teal-950 text-white flex items-center justify-center">
                        <ShieldCheck className="w-4 h-4 text-teal-300" />
                      </div>
                      <span
                        className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md ${
                          linkedBankAccounts.some((a) => a.status === 'activated' || a.activationStatus === 'ACTIVATED')
                            ? 'bg-teal-100 text-teal-900 font-mono'
                            : linkedBankAccounts.some((a) => a.status === 'approved')
                            ? 'bg-blue-100 text-blue-900 font-mono'
                            : linkedBankAccounts.some((a) => a.status === 'pending')
                            ? 'bg-amber-100 text-amber-900 font-mono'
                            : 'bg-slate-100 text-slate-800 font-mono'
                        }`}
                      >
                        {linkedBankAccounts.some((a) => a.status === 'activated' || a.activationStatus === 'ACTIVATED')
                          ? 'Activated'
                          : linkedBankAccounts.some((a) => a.status === 'approved')
                          ? 'Ready'
                          : linkedBankAccounts.some((a) => a.status === 'pending')
                          ? 'Pending'
                          : 'Verify'}
                      </span>
                    </div>
                    <div className="font-black text-sm text-slate-950">Bank Activation</div>
                    <div className="text-[11px] text-slate-500 font-medium mt-0.5">
                      Verify & activate bank payouts
                    </div>
                  </button>

                  {/* Crypto Payouts (Coming Soon) */}
                  <div className="p-3.5 sm:p-4 rounded-2xl border-2 border-slate-200 bg-slate-50/80 text-left flex flex-col justify-between opacity-85 select-none relative overflow-hidden">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="w-8 h-8 rounded-xl bg-slate-200 text-slate-700 flex items-center justify-center font-black">
                        <Coins className="w-4 h-4 text-slate-700" />
                      </div>
                      <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500 text-slate-950 shadow-xs font-mono">
                        Soon
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
                    <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-300 text-xs font-bold text-emerald-950 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span>Card Activation Status: <strong className="text-emerald-800">Activated</strong></span>
                      </div>
                      <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-emerald-600 text-white">
                        Active
                      </span>
                    </div>
                  ) : activationRequest?.status === 'PENDING' ? (
                    <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-300 text-xs font-bold text-amber-950 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                        <span>Card Activation Status: <strong className="text-amber-800">Pending</strong></span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setDestinationType('ACTIVATION')}
                        className="text-[11px] font-black text-amber-800 underline hover:text-amber-950 cursor-pointer"
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

              {/* 3B. CARD ACTIVATION */}
              {destinationType === 'ACTIVATION' && (
                <div className="space-y-5 animate-in fade-in duration-150">
                  <div className="p-5 sm:p-6 rounded-2xl bg-white border-2 border-slate-300 shadow-md space-y-5">
                    {/* Header */}
                    <div className="flex items-center justify-between pb-3.5 border-b-2 border-slate-200">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-2xl bg-indigo-950 text-white flex items-center justify-center shrink-0 shadow-xs">
                          <KeyRound className="w-6 h-6 text-indigo-300 stroke-[2.5]" />
                        </div>
                        <div>
                          <h3 className="font-black text-xl text-slate-950 tracking-tight">
                            Card Activation
                          </h3>
                          <p className="text-sm font-bold text-slate-700 mt-0.5">
                            Activate your card to access withdrawals and instant payouts.
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={loadCardActivationStatus}
                        disabled={isLoadingActivation}
                        className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-300 text-xs font-black text-slate-950 flex items-center gap-1.5 cursor-pointer transition-colors"
                        title="Refresh Status"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 text-slate-950 ${isLoadingActivation ? 'animate-spin' : ''}`} />
                        <span>Refresh</span>
                      </button>
                    </div>

                    {/* Activation Status Banner */}
                    <div className="space-y-2">
                      <label className="block text-xs font-black text-slate-950 uppercase tracking-wider font-mono">
                        Activation Status
                      </label>

                      {activationRequest?.status === 'ACTIVATED' && (
                        <div className="p-4 sm:p-5 rounded-2xl bg-emerald-50 border-2 border-emerald-400 text-emerald-950 space-y-2.5 animate-in fade-in duration-150 shadow-xs">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <CheckCircle2 className="w-5 h-5 text-emerald-700 stroke-[2.5] shrink-0" />
                              <span className="font-black text-base text-emerald-950">Activated</span>
                            </div>
                            <span className="px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-emerald-600 text-white shadow-xs">
                              Activated
                            </span>
                          </div>
                          <p className="text-sm text-emerald-950 font-bold leading-relaxed">
                            Your card is activated and ready for instant withdrawals.
                          </p>
                          <div className="pt-1 flex flex-wrap items-center gap-3 text-xs font-mono font-bold text-emerald-900 border-t border-emerald-200/80">
                            <span>Code Verified: <strong className="font-black text-emerald-950">{activationRequest.activationCode}</strong></span>
                            {activationRequest.approvedAt && (
                              <span>• Activated on {new Date(activationRequest.approvedAt).toLocaleDateString()}</span>
                            )}
                          </div>
                        </div>
                      )}

                      {activationRequest?.status === 'PENDING' && (
                        <div className="p-4 sm:p-5 rounded-2xl bg-amber-50 border-2 border-amber-400 text-amber-950 space-y-2.5 animate-in fade-in duration-150 shadow-xs">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Clock className="w-5 h-5 text-amber-700 stroke-[2.5] shrink-0" />
                              <span className="font-black text-base text-amber-950">Pending</span>
                            </div>
                            <span className="px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-amber-500 text-slate-950 shadow-xs">
                              Pending
                            </span>
                          </div>
                          <p className="text-sm text-amber-950 font-bold leading-relaxed">
                            Your card activation request is being processed. Instant payouts will unlock once verified.
                          </p>
                          <div className="pt-1 text-xs font-mono font-bold text-amber-900 border-t border-amber-200/80">
                            Submitted Code: <strong className="font-black text-amber-950">{activationRequest.activationCode}</strong> ({new Date(activationRequest.submittedAt).toLocaleDateString()})
                          </div>
                        </div>
                      )}

                      {activationRequest?.status === 'REJECTED' && (
                        <div className="p-4 sm:p-5 rounded-2xl bg-rose-50 border-2 border-rose-400 text-rose-950 space-y-2.5 animate-in fade-in duration-150 shadow-xs">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <XCircle className="w-5 h-5 text-rose-700 stroke-[2.5] shrink-0" />
                              <span className="font-black text-base text-rose-950">Rejected</span>
                            </div>
                            <span className="px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-rose-600 text-white shadow-xs">
                              Rejected
                            </span>
                          </div>
                          {activationRequest.rejectionReason && (
                            <div className="p-3 rounded-xl bg-white border-2 border-rose-300 text-xs font-black text-rose-950">
                              Reason: {activationRequest.rejectionReason}
                            </div>
                          )}
                          <p className="text-sm text-rose-950 font-bold leading-relaxed">
                            Please check your card activation code and re-submit below.
                          </p>
                        </div>
                      )}

                      {(!activationRequest || (!['ACTIVATED', 'PENDING', 'REJECTED'].includes(activationRequest.status))) && (
                        <div className="p-4 sm:p-5 rounded-2xl bg-slate-50 border-2 border-slate-300 text-slate-950 space-y-2 shadow-xs">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Info className="w-5 h-5 text-slate-700 stroke-[2.5] shrink-0" />
                              <span className="font-black text-sm text-slate-950">Card Inactive</span>
                            </div>
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-black uppercase tracking-wider bg-slate-800 text-white">
                              Not Activated
                            </span>
                          </div>
                          <p className="text-xs sm:text-sm text-slate-800 font-bold leading-relaxed">
                            Enter the activation code printed on your Monvera debit card package or provided by your private banker to activate card withdrawals.
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Activation Code Input Form */}
                    {activationRequest?.status !== 'ACTIVATED' && activationRequest?.status !== 'PENDING' && (
                      <form onSubmit={handleActivateCard} className="space-y-4 pt-3 border-t-2 border-slate-200">
                        {activationFeedback && (
                          <div
                            className={`p-3.5 rounded-xl border-2 text-xs font-black flex items-center gap-2 shadow-xs ${
                              activationFeedback.type === 'success'
                                ? 'bg-emerald-50 border-emerald-400 text-emerald-950'
                                : 'bg-red-50 border-red-400 text-red-950'
                            }`}
                          >
                            {activationFeedback.type === 'success' ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-700 stroke-[2.5] shrink-0" />
                            ) : (
                              <AlertCircle className="w-4 h-4 text-red-700 stroke-[2.5] shrink-0" />
                            )}
                            <span>{activationFeedback.text}</span>
                          </div>
                        )}

                        <div className="space-y-2">
                          <label className="block text-xs font-black text-slate-950 uppercase tracking-wider font-mono">
                            Activation Code
                          </label>
                          <input
                            type="text"
                            required
                            value={activationCodeInput}
                            onChange={(e) => setActivationCodeInput(e.target.value.toUpperCase())}
                            placeholder="Enter activation code (e.g. ACT-84219)"
                            className="w-full px-4 py-3.5 text-base font-mono tracking-wider font-black rounded-xl border-2 border-slate-400 focus:border-indigo-600 focus:ring-2 focus:ring-indigo-500 text-slate-950 bg-white placeholder:text-slate-400 shadow-xs"
                          />
                        </div>

                        <button
                          type="submit"
                          disabled={isSubmittingActivation || !activationCodeInput.trim()}
                          className="w-full py-4 px-5 rounded-xl font-black text-sm uppercase tracking-wider text-white bg-slate-950 hover:bg-slate-900 active:scale-[0.99] disabled:opacity-50 transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md"
                        >
                          {isSubmittingActivation ? (
                            <>
                              <div className="w-4 h-4 border-2 border-white border-t-transparent animate-spin rounded-full" />
                              <span>Submitting Activation...</span>
                            </>
                          ) : (
                            <>
                              <span>Activate</span>
                              <ArrowRight className="w-4 h-4 text-emerald-400 stroke-[3]" />
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
                          className="w-full py-4 px-5 rounded-xl font-black text-sm uppercase tracking-wider text-white bg-emerald-600 hover:bg-emerald-500 transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md"
                        >
                          <span>Proceed to Debit Card Withdrawal</span>
                          <ArrowRight className="w-4 h-4 text-white stroke-[3]" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 3B2. BANK ACTIVATION (TASK 4 & 5) */}
              {destinationType === 'BANK_ACTIVATION' && (
                <div className="space-y-5 animate-in fade-in duration-150">
                  <div className="p-5 sm:p-6 rounded-2xl bg-white border-2 border-slate-300 shadow-md space-y-5">
                    {/* Header */}
                    <div className="flex items-center justify-between pb-3.5 border-b-2 border-slate-200">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-2xl bg-teal-950 text-white flex items-center justify-center shrink-0 shadow-xs">
                          <ShieldCheck className="w-6 h-6 text-teal-300 stroke-[2.5]" />
                        </div>
                        <div>
                          <h3 className="font-black text-xl text-slate-950 tracking-tight">
                            Bank Activation
                          </h3>
                          <p className="text-sm font-bold text-slate-700 mt-0.5">
                            Verify and activate your bank account for secure direct wire & ACH withdrawals.
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={loadBankAccounts}
                        disabled={isLoadingBankAccounts}
                        className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-300 text-xs font-black text-slate-950 flex items-center gap-1.5 cursor-pointer transition-colors"
                        title="Refresh Status"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 text-slate-950 ${isLoadingBankAccounts ? 'animate-spin' : ''}`} />
                        <span>Refresh</span>
                      </button>
                    </div>

                    {/* Status Display & Applications List */}
                    <div className="space-y-3">
                      <label className="block text-xs font-black text-slate-950 uppercase tracking-wider font-mono">
                        Bank Activation Status
                      </label>

                      {linkedBankAccounts.length === 0 ? (
                        <div className="p-5 rounded-2xl bg-slate-50 border-2 border-slate-300 text-slate-950 space-y-3 shadow-xs">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Info className="w-5 h-5 text-slate-700 stroke-[2.5] shrink-0" />
                              <span className="font-black text-sm text-slate-950">No Bank Account Linked</span>
                            </div>
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-black uppercase tracking-wider bg-slate-800 text-white font-mono">
                              Not Linked
                            </span>
                          </div>
                          <p className="text-xs sm:text-sm text-slate-800 font-bold leading-relaxed">
                            You must link a bank account first before activating bank withdrawal rails.
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              setDestinationType('BANK');
                              setIsLinkingNewBank(true);
                              setBankLinkFeedback(null);
                            }}
                            className="px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider text-white bg-slate-950 hover:bg-slate-900 transition-colors flex items-center gap-2 cursor-pointer shadow-xs"
                          >
                            <span>Link Bank Account for Withdrawal</span>
                            <ArrowRight className="w-3.5 h-3.5 text-emerald-400 stroke-[3]" />
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {linkedBankAccounts.map((account) => {
                            const isActivated = account.status === 'activated' || account.activationStatus === 'ACTIVATED';
                            const isApprovedAwaiting = account.status === 'approved' && !isActivated;
                            const isPending = account.status === 'pending';
                            const isRejected = account.status === 'rejected';
                            const isCancelled = account.status === 'cancelled';

                            return (
                              <div
                                key={account.id}
                                className={`p-4 sm:p-5 rounded-2xl border-2 space-y-3 transition-all ${
                                  isActivated
                                    ? 'bg-emerald-50/80 border-emerald-400 text-emerald-950'
                                    : isApprovedAwaiting
                                    ? 'bg-blue-50/80 border-blue-400 text-blue-950'
                                    : isPending
                                    ? 'bg-amber-50/80 border-amber-400 text-amber-950'
                                    : isRejected
                                    ? 'bg-rose-50/80 border-rose-400 text-rose-950'
                                    : 'bg-slate-50 border-slate-300 text-slate-950'
                                }`}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex items-start gap-3">
                                    <div
                                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5 text-white ${
                                        isActivated
                                          ? 'bg-emerald-800'
                                          : isApprovedAwaiting
                                          ? 'bg-blue-800'
                                          : isPending
                                          ? 'bg-amber-800'
                                          : isRejected
                                          ? 'bg-rose-800'
                                          : 'bg-slate-800'
                                      }`}
                                    >
                                      {isActivated ? (
                                        <CheckCircle2 className="w-5 h-5 text-emerald-300 stroke-[2.5]" />
                                      ) : isApprovedAwaiting ? (
                                        <ShieldCheck className="w-5 h-5 text-blue-300 stroke-[2.5]" />
                                      ) : isPending ? (
                                        <Clock className="w-5 h-5 text-amber-300 stroke-[2.5]" />
                                      ) : (
                                        <XCircle className="w-5 h-5 text-rose-300 stroke-[2.5]" />
                                      )}
                                    </div>
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <h4 className="font-black text-base text-slate-950">{account.bankName}</h4>
                                        <span className="text-xs px-2 py-0.5 rounded-md bg-white/80 border border-slate-300 font-mono font-bold text-slate-800">
                                          {account.country}
                                        </span>
                                      </div>
                                      <p className="text-xs text-slate-700 font-bold mt-0.5">
                                        Holder: <span className="text-slate-950">{account.accountHolderName}</span>
                                      </p>
                                      <div className="text-xs font-mono font-bold text-slate-800 mt-1">
                                        Account: {account.maskedAccountNumber || `•••• ${account.accountNumber.slice(-4)}`} • {account.currency}
                                      </div>
                                    </div>
                                  </div>

                                  <div>
                                    {isActivated && (
                                      <span className="px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-emerald-600 text-white shadow-xs font-mono flex items-center gap-1">
                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                        Activated
                                      </span>
                                    )}
                                    {isApprovedAwaiting && (
                                      <span className="px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-blue-600 text-white shadow-xs font-mono">
                                        Approved
                                      </span>
                                    )}
                                    {isPending && (
                                      <span className="px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-amber-500 text-slate-950 shadow-xs font-mono">
                                        Pending Review
                                      </span>
                                    )}
                                    {isRejected && (
                                      <span className="px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-rose-600 text-white shadow-xs font-mono">
                                        Rejected
                                      </span>
                                    )}
                                    {isCancelled && (
                                      <span className="px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-slate-500 text-white shadow-xs font-mono">
                                        Cancelled
                                      </span>
                                    )}
                                  </div>
                                </div>

                                {/* STAGE 1: PENDING WITH CANCELLATION OPTION */}
                                {isPending && (
                                  <div className="pt-2 border-t border-amber-300/80 space-y-2.5">
                                    <p className="text-xs sm:text-sm text-amber-950 font-bold leading-relaxed">
                                      Your bank application is currently under administrative review. You can leave it pending or cancel your application anytime.
                                    </p>
                                    <div className="flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => handleCancelBankApplication(account.id)}
                                        disabled={isCancellingBankApp}
                                        className="px-3.5 py-1.5 rounded-xl bg-amber-200 hover:bg-amber-300 text-amber-950 text-xs font-black uppercase tracking-wider cursor-pointer transition-colors shadow-xs"
                                      >
                                        {isCancellingBankApp ? 'Cancelling...' : 'Cancel Application'}
                                      </button>
                                      <span className="text-[11px] font-bold text-amber-800">
                                        Or leave pending for compliance approval
                                      </span>
                                    </div>
                                  </div>
                                )}

                                {/* STAGE 2 & 3: APPROVED, AWAITING OPEN BANKING VERIFICATION */}
                                {isApprovedAwaiting && (
                                  <div className="pt-2 border-t border-blue-300/80 space-y-3">
                                    <div className="p-3.5 rounded-xl bg-blue-100/90 border border-blue-300 text-xs sm:text-sm font-black text-blue-950 flex items-center gap-2">
                                      <ShieldCheck className="w-5 h-5 text-blue-700 shrink-0" />
                                      <span>Your bank account has been approved. Complete bank verification to activate it.</span>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setVerifyingBankApp(account);
                                        setVerificationOtpInput('');
                                        setBankVerificationError(null);
                                        setShowVerificationModal(true);
                                      }}
                                      className="w-full py-3.5 px-4 rounded-xl font-black text-xs uppercase tracking-wider text-white bg-blue-600 hover:bg-blue-500 transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-md"
                                    >
                                      <ShieldCheck className="w-4 h-4 text-blue-200 stroke-[2.5]" />
                                      <span>Start Secure Bank Verification</span>
                                    </button>
                                  </div>
                                )}

                                {/* STAGE 4: ACTIVATED */}
                                {isActivated && (
                                  <div className="pt-2 border-t border-emerald-300/80 space-y-2.5">
                                    <p className="text-xs sm:text-sm text-emerald-950 font-bold leading-relaxed">
                                      Your bank account is fully activated and eligible for direct wire / ACH payouts.
                                    </p>
                                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono font-bold text-emerald-900">
                                      <span>
                                        Verified Rail: <strong className="text-emerald-950">{account.verificationReference || 'OB-DIRECT-AUTH'}</strong>
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setSelectedBankId(account.id);
                                          setDestinationType('BANK');
                                          setIsLinkingNewBank(false);
                                        }}
                                        className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black uppercase tracking-wider flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
                                      >
                                        <span>Proceed to Bank Withdrawal</span>
                                        <ArrowRight className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </div>
                                )}

                                {/* REJECTED */}
                                {isRejected && (
                                  <div className="pt-2 border-t border-rose-300/80 space-y-2">
                                    {account.rejectionReason && (
                                      <div className="p-2.5 rounded-xl bg-white border border-rose-200 text-xs font-bold text-rose-950">
                                        Reason: {account.rejectionReason}
                                      </div>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setDestinationType('BANK');
                                        setIsLinkingNewBank(true);
                                        setBankLinkFeedback(null);
                                      }}
                                      className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-black uppercase tracking-wider cursor-pointer"
                                    >
                                      Link a New Bank Account
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* 3C. BANK ACCOUNT TRANSFER & LINKING */}
              {destinationType === 'BANK' && (
                <div className="space-y-5 animate-in fade-in duration-150">
                  {!isLinkingNewBank && linkedBankAccounts.length > 0 ? (
                    <div className="space-y-4">
                      {/* Header with Title and Add Account button */}
                      <div className="flex items-center justify-between">
                        <div>
                          <label className="block text-xs font-black text-slate-900 uppercase tracking-wider font-mono">
                            Linked Bank Accounts
                          </label>
                          <p className="text-xs text-slate-600 font-medium mt-0.5">
                            Select a verified bank account for direct wire / ACH payout
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={loadBankAccounts}
                            disabled={isLoadingBankAccounts}
                            className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
                            title="Refresh Accounts"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingBankAccounts ? 'animate-spin' : ''}`} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setIsLinkingNewBank(true);
                              setBankLinkFeedback(null);
                            }}
                            className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs cursor-pointer transition-colors"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Link Another Bank</span>
                          </button>
                        </div>
                      </div>

                      {/* Accounts Grid */}
                      <div className="grid grid-cols-1 gap-3">
                        {linkedBankAccounts.map((account) => {
                          const isSelected = selectedBankId === account.id;
                          return (
                            <div
                              key={account.id}
                              onClick={() => setSelectedBankId(account.id)}
                              className={`p-4 rounded-2xl border-2 transition-all cursor-pointer relative ${
                                isSelected
                                  ? 'bg-blue-50/70 border-blue-600 ring-2 ring-blue-500/20 shadow-xs'
                                  : 'bg-white border-slate-200 hover:bg-slate-50'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex items-start gap-3">
                                  <div className="w-10 h-10 rounded-xl bg-blue-900 text-white flex items-center justify-center shrink-0 mt-0.5">
                                    <Building className="w-5 h-5 text-blue-300" />
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <h4 className="font-black text-sm text-slate-950">{account.bankName}</h4>
                                      <span className="text-xs px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-mono font-bold">
                                        {account.country}
                                      </span>
                                    </div>
                                    <p className="text-xs text-slate-600 font-medium mt-0.5">
                                      Holder: <span className="font-bold text-slate-900">{account.accountHolderName}</span>
                                    </p>
                                    <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs font-mono">
                                      <span className="font-bold text-slate-800">
                                        Account: {account.maskedAccountNumber || `•••• ${account.accountNumber.slice(-4)}`}
                                      </span>
                                      {(account.routingNumber || account.sortCode) && (
                                        <span className="text-slate-500">
                                          Routing: {account.routingNumber || account.sortCode}
                                        </span>
                                      )}
                                      {account.currency && (
                                        <span className="font-bold text-indigo-700">{account.currency}</span>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                <div className="flex flex-col items-end gap-1.5 shrink-0">
                                  {(account.status === 'activated' || account.activationStatus === 'ACTIVATED') && (
                                    <span className="px-2.5 py-1 rounded-full text-[11px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 flex items-center gap-1 font-mono">
                                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                      Activated
                                    </span>
                                  )}
                                  {account.status === 'approved' && account.activationStatus !== 'ACTIVATED' && (
                                    <span className="px-2.5 py-1 rounded-full text-[11px] font-black uppercase tracking-wider bg-blue-100 text-blue-900 flex items-center gap-1 font-mono">
                                      <ShieldCheck className="w-3.5 h-3.5 text-blue-700" />
                                      Approved
                                    </span>
                                  )}
                                  {account.status === 'pending' && (
                                    <span className="px-2.5 py-1 rounded-full text-[11px] font-black uppercase tracking-wider bg-amber-100 text-amber-800 flex items-center gap-1 font-mono">
                                      <Clock className="w-3.5 h-3.5 text-amber-600" />
                                      Pending
                                    </span>
                                  )}
                                  {account.status === 'rejected' && (
                                    <span className="px-2.5 py-1 rounded-full text-[11px] font-black uppercase tracking-wider bg-rose-100 text-rose-800 flex items-center gap-1 font-mono">
                                      <XCircle className="w-3.5 h-3.5 text-rose-600" />
                                      Rejected
                                    </span>
                                  )}
                                  {account.status === 'cancelled' && (
                                    <span className="px-2.5 py-1 rounded-full text-[11px] font-black uppercase tracking-wider bg-slate-200 text-slate-700 font-mono">
                                      Cancelled
                                    </span>
                                  )}
                                  {isSelected && (
                                    <div className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center">
                                      <Check className="w-3.5 h-3.5" />
                                    </div>
                                  )}
                                </div>
                              </div>

                              {account.status === 'rejected' && account.rejectionReason && (
                                <div className="mt-3 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-900">
                                  <strong>Administrative Note:</strong> {account.rejectionReason}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Status Alerts for selected account */}
                      {selectedBank && selectedBank.status === 'pending' && (
                        <div className="p-4 rounded-2xl bg-amber-50 border-2 border-amber-300 text-amber-950 space-y-3">
                          <div className="flex items-center gap-2">
                            <Clock className="w-5 h-5 text-amber-700 shrink-0" />
                            <h5 className="font-black text-sm">Account Verification In Progress</h5>
                          </div>
                          <p className="text-xs text-amber-900 font-bold leading-relaxed">
                            Your bank account application for <strong>{selectedBank.bankName}</strong> was successfully submitted to our compliance department. Outbound wire/ACH withdrawals will unlock as soon as administrator approval and bank verification are complete.
                          </p>
                          <div className="flex items-center gap-2 pt-1 border-t border-amber-200">
                            <button
                              type="button"
                              onClick={() => handleCancelBankApplication(selectedBank.id)}
                              disabled={isCancellingBankApp}
                              className="px-3.5 py-1.5 rounded-xl bg-amber-200 hover:bg-amber-300 text-amber-950 text-xs font-black uppercase tracking-wider cursor-pointer transition-colors"
                            >
                              {isCancellingBankApp ? 'Cancelling...' : 'Cancel Application'}
                            </button>
                            <span className="text-[11px] text-amber-800 font-medium">
                              Or leave pending for administrator review
                            </span>
                          </div>
                        </div>
                      )}

                      {selectedBank && selectedBank.status === 'approved' && selectedBank.activationStatus !== 'ACTIVATED' && (
                        <div className="p-4 rounded-2xl bg-blue-50 border-2 border-blue-400 text-blue-950 space-y-3">
                          <div className="flex items-center gap-2">
                            <ShieldCheck className="w-5 h-5 text-blue-700 shrink-0" />
                            <h5 className="font-black text-sm">Approved — Awaiting Bank Activation</h5>
                          </div>
                          <p className="text-xs sm:text-sm text-blue-900 font-bold leading-relaxed">
                            Your bank account has been approved. Complete bank verification to activate it.
                          </p>
                          <div>
                            <button
                              type="button"
                              onClick={() => {
                                setVerifyingBankApp(selectedBank);
                                setVerificationOtpInput('');
                                setBankVerificationError(null);
                                setShowVerificationModal(true);
                              }}
                              className="w-full py-3.5 px-4 rounded-xl font-black text-xs uppercase tracking-wider text-white bg-blue-600 hover:bg-blue-500 transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-md"
                            >
                              <ShieldCheck className="w-4 h-4 text-blue-200 stroke-[2.5]" />
                              <span>Complete Bank Verification</span>
                            </button>
                          </div>
                        </div>
                      )}

                      {selectedBank && selectedBank.status === 'rejected' && (
                        <div className="p-4 rounded-2xl bg-rose-50 border-2 border-rose-300 text-rose-950 space-y-2">
                          <div className="flex items-center gap-2">
                            <XCircle className="w-5 h-5 text-rose-700 shrink-0" />
                            <h5 className="font-black text-sm">Account Verification Declined</h5>
                          </div>
                          <p className="text-xs text-rose-900 font-medium leading-relaxed">
                            {selectedBank.rejectionReason || 'The submitted account details could not be verified by compliance.'}
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              setIsLinkingNewBank(true);
                              setBankLinkFeedback(null);
                            }}
                            className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer"
                          >
                            Link a New Bank Account
                          </button>
                        </div>
                      )}

                      {/* Withdrawal execution section when an activated account is selected */}
                      {selectedBank && (selectedBank.status === 'activated' || selectedBank.activationStatus === 'ACTIVATED') && (
                        <div className="space-y-4 pt-2">
                          {/* Activated verification badge */}
                          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-300 text-xs text-emerald-950 font-bold flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                              <span>Verified Rail: <strong className="font-mono text-emerald-900">{selectedBank.verificationReference || 'OB-DIRECT-AUTH'}</strong></span>
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-emerald-600 text-white font-mono">
                              Activated
                            </span>
                          </div>

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

                          {/* Financial Breakdown */}
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
                              <span>Destination Bank:</span>
                              <span className="font-bold text-slate-900">{selectedBank.bankName}</span>
                            </div>
                            <div className="flex items-center justify-between text-slate-600">
                              <span>Settlement Speed:</span>
                              <span className="font-semibold text-emerald-800 flex items-center gap-1">
                                <Zap className="w-3.5 h-3.5 fill-emerald-600 text-emerald-600" />
                                1–2 Business Days (ACH / Wire)
                              </span>
                            </div>
                            <div className="flex items-center justify-between pt-2.5 border-t border-slate-200 font-black text-slate-950">
                              <span>Total Debit from {sourceAccount === 'CHECKING' ? 'Checking' : 'Savings'}:</span>
                              <span className="font-mono text-base text-emerald-700">${totalDeducted.toFixed(2)} USD</span>
                            </div>
                          </div>

                          {/* Authorize Bank Withdrawal Button */}
                          <div className="pt-2">
                            <button
                              type="button"
                              onClick={handleBankWithdrawSubmit}
                              disabled={isProcessing || numAmount <= 0 || totalDeducted > availableBal}
                              className="w-full py-4 px-6 rounded-2xl font-black text-base text-white bg-slate-950 hover:bg-slate-800 disabled:opacity-50 transition-all shadow-lg hover:shadow-xl active:translate-y-0.5 flex items-center justify-center gap-2.5 cursor-pointer"
                            >
                              {isProcessing ? (
                                <>
                                  <div className="w-5 h-5 border-3 border-white border-t-transparent animate-spin rounded-full" />
                                  <span>Authorizing Bank Wire / ACH Settlement...</span>
                                </>
                              ) : (
                                <>
                                  <span>Authorize Bank Wire / ACH Withdrawal</span>
                                  <ArrowRight className="w-5 h-5 text-emerald-400" />
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    /* The Bank Account Linking Form (TASK 1: Bright, High Visibility, Bold & TASK 2: Removed routing/sort code & international fields) */
                    <form onSubmit={handleLinkBankSubmit} className="space-y-5">
                      <div className="flex items-center justify-between pb-4 border-b-2 border-slate-900/10">
                        <div>
                          <h3 className="font-black text-2xl sm:text-3xl text-slate-950 tracking-tight">
                            Link Bank Account for Withdrawal
                          </h3>
                          <p className="text-sm font-bold text-slate-900 mt-1">
                            Transmitted securely to the admin console for fast approval & verification.
                          </p>
                        </div>
                        {linkedBankAccounts.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setIsLinkingNewBank(false)}
                            className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-black uppercase tracking-wider cursor-pointer shadow-xs transition-colors"
                          >
                            ← Back to Accounts
                          </button>
                        )}
                      </div>

                      {bankLinkFeedback && (
                        <div
                          className={`p-4 rounded-xl border-2 text-xs sm:text-sm font-black flex items-center gap-2 shadow-xs ${
                            bankLinkFeedback.type === 'success'
                              ? 'bg-emerald-50 border-emerald-500 text-emerald-950'
                              : 'bg-red-50 border-red-500 text-red-950'
                          }`}
                        >
                          {bankLinkFeedback.type === 'success' ? (
                            <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0 stroke-[2.5]" />
                          ) : (
                            <AlertCircle className="w-5 h-5 text-red-700 shrink-0 stroke-[2.5]" />
                          )}
                          <span>{bankLinkFeedback.text}</span>
                        </div>
                      )}

                      {/* 1. Country Selection (Searchable) */}
                      <div className="space-y-1.5 relative">
                        <label className="block text-xs sm:text-sm font-black text-slate-950 uppercase tracking-wider font-mono">
                          Bank Country / Jurisdiction
                        </label>
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => setIsCountryDropdownOpen(!isCountryDropdownOpen)}
                            className="w-full px-4 py-3.5 rounded-xl border-2 border-slate-400 bg-white text-left flex items-center justify-between cursor-pointer hover:border-slate-950 transition-colors shadow-xs"
                          >
                            <div className="flex items-center gap-2.5">
                              <span className="text-xl">{selectedCountryObj.flag}</span>
                              <span className="text-sm sm:text-base font-black text-slate-950">{selectedCountryObj.name}</span>
                              <span className="text-xs font-mono font-bold text-slate-700">({selectedCountryObj.code})</span>
                            </div>
                            <ChevronDown className="w-4 h-4 text-slate-950 stroke-[2.5]" />
                          </button>

                          {isCountryDropdownOpen && (
                            <div className="absolute top-full left-0 right-0 z-30 mt-1 bg-white rounded-2xl border-2 border-slate-400 shadow-2xl max-h-60 overflow-hidden flex flex-col">
                              <div className="p-2 border-b-2 border-slate-200 bg-slate-50">
                                <div className="relative">
                                  <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-600 stroke-[2.5]" />
                                  <input
                                    type="text"
                                    placeholder="Search country name or code..."
                                    value={bankCountrySearch}
                                    onChange={(e) => setBankCountrySearch(e.target.value)}
                                    className="w-full pl-9 pr-3 py-1.5 text-xs font-bold rounded-lg border border-slate-300 focus:outline-hidden focus:ring-1 focus:ring-slate-900 bg-white text-slate-950"
                                    autoFocus
                                  />
                                </div>
                              </div>
                              <div className="overflow-y-auto max-h-48 p-1">
                                {filteredCountries.map((c) => (
                                  <button
                                    key={c.code}
                                    type="button"
                                    onClick={() => {
                                      setBankCountry(c.name);
                                      setBankCountryCode(c.code);
                                      setBankCurrency(c.defaultCurrency);
                                      setIsCountryDropdownOpen(false);
                                      setBankCountrySearch('');
                                      const defaultBank = MAJOR_BANKS.find((b) => b.countryCode === c.code);
                                      if (defaultBank) {
                                        setBankNameSelect(defaultBank.name);
                                        setIsOtherBank(false);
                                      } else {
                                        setIsOtherBank(true);
                                        setBankNameSelect('');
                                      }
                                    }}
                                    className={`w-full px-3 py-2 rounded-lg text-left text-xs font-bold flex items-center justify-between hover:bg-slate-100 transition-colors ${
                                      bankCountryCode === c.code ? 'bg-slate-100 text-slate-950' : 'text-slate-800'
                                    }`}
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className="text-base">{c.flag}</span>
                                      <span>{c.name}</span>
                                    </div>
                                    <span className="text-slate-600 font-mono text-[11px] font-bold">{c.code}</span>
                                  </button>
                                ))}
                                {filteredCountries.length === 0 && (
                                  <div className="p-3 text-center text-xs font-bold text-slate-600">No countries found</div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* 2. Bank Name Selection */}
                      <div className="space-y-1.5">
                        <label className="block text-xs sm:text-sm font-black text-slate-950 uppercase tracking-wider font-mono">
                          Bank Name
                        </label>
                        {countryBanks.length > 0 && !isOtherBank ? (
                          <div className="space-y-2">
                            <select
                              value={bankNameSelect}
                              onChange={(e) => {
                                if (e.target.value === 'OTHER') {
                                  setIsOtherBank(true);
                                  setBankNameSelect('');
                                } else {
                                  setBankNameSelect(e.target.value);
                                }
                              }}
                              className="w-full px-4 py-3.5 rounded-xl border-2 border-slate-400 bg-white text-sm sm:text-base font-black text-slate-950 focus:border-slate-950 focus:ring-2 focus:ring-slate-950/20"
                            >
                              {countryBanks.map((b) => (
                                <option key={b.name} value={b.name} className="font-bold text-slate-950">
                                  {b.name}
                                </option>
                              ))}
                              <option value="OTHER" className="font-bold text-slate-950">Other Bank / Unlisted Financial Institution</option>
                            </select>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <input
                              type="text"
                              required
                              placeholder="e.g. Deutsche Bank, Barclays, Standard Chartered..."
                              value={customBankName}
                              onChange={(e) => setCustomBankName(e.target.value)}
                              className="w-full px-4 py-3.5 rounded-xl border-2 border-slate-400 bg-white text-sm sm:text-base font-black text-slate-950 focus:border-slate-950 focus:ring-2 focus:ring-slate-950/20"
                            />
                            {countryBanks.length > 0 && (
                              <button
                                type="button"
                                onClick={() => {
                                  setIsOtherBank(false);
                                  if (countryBanks[0]) setBankNameSelect(countryBanks[0].name);
                                }}
                                className="text-xs text-blue-700 font-black hover:underline cursor-pointer"
                              >
                                ← Choose from major {selectedCountryObj.name} banks list
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      {/* 3. Account Holder Full Name & Email */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                        <div className="space-y-1.5">
                          <label className="block text-xs sm:text-sm font-black text-slate-950 uppercase tracking-wider font-mono">
                            Account Holder Name
                          </label>
                          <div className="relative">
                            <User className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-600 stroke-[2.5]" />
                            <input
                              type="text"
                              required
                              value={accountHolderName}
                              onChange={(e) => setAccountHolderName(e.target.value)}
                              placeholder="Full Name as on Account"
                              className="w-full pl-10 pr-3 py-3 rounded-xl border-2 border-slate-400 bg-white text-sm sm:text-base font-black text-slate-950 focus:border-slate-950 focus:ring-2 focus:ring-slate-950/20"
                            />
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <label className="block text-xs sm:text-sm font-black text-slate-950 uppercase tracking-wider font-mono">
                            Bank-Registered Email
                          </label>
                          <div className="relative">
                            <Mail className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-600 stroke-[2.5]" />
                            <input
                              type="email"
                              required
                              value={bankEmail}
                              onChange={(e) => setBankEmail(e.target.value)}
                              placeholder="customer@email.com"
                              className="w-full pl-10 pr-3 py-3 rounded-xl border-2 border-slate-400 bg-white text-sm sm:text-base font-black text-slate-950 focus:border-slate-950 focus:ring-2 focus:ring-slate-950/20"
                            />
                          </div>
                        </div>
                      </div>

                      {/* 4. Phone Number & Currency */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                        <div className="space-y-1.5">
                          <label className="block text-xs sm:text-sm font-black text-slate-950 uppercase tracking-wider font-mono">
                            Phone Number
                          </label>
                          <div className="flex rounded-xl border-2 border-slate-400 bg-white overflow-hidden">
                            <span className="px-3.5 py-3 bg-slate-100 text-slate-950 font-mono text-xs sm:text-sm font-black border-r border-slate-300 flex items-center">
                              {selectedCountryObj.dialCode || '+1'}
                            </span>
                            <input
                              type="tel"
                              required
                              value={bankPhone}
                              onChange={(e) => setBankPhone(e.target.value)}
                              placeholder="Phone number"
                              className="w-full px-3 py-3 bg-white text-sm sm:text-base font-black text-slate-950 focus:outline-hidden"
                            />
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <label className="block text-xs sm:text-sm font-black text-slate-950 uppercase tracking-wider font-mono">
                            Account Currency
                          </label>
                          <select
                            value={bankCurrency}
                            onChange={(e) => setBankCurrency(e.target.value)}
                            className="w-full px-3 py-3 rounded-xl border-2 border-slate-400 bg-white text-sm sm:text-base font-black text-slate-950 focus:border-slate-950 focus:ring-2 focus:ring-slate-950/20"
                          >
                            {WORLD_CURRENCIES.map((curr) => (
                              <option key={curr.code} value={curr.code} className="font-bold text-slate-950">
                                {curr.code} ({curr.symbol}) - {curr.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* 5. Account Number */}
                      <div className="space-y-1.5">
                        <label className="block text-xs sm:text-sm font-black text-slate-950 uppercase tracking-wider font-mono">
                          Bank Account Number
                        </label>
                        <div className="relative">
                          <Hash className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-600 stroke-[2.5]" />
                          <input
                            type="text"
                            required
                            value={bankAccountNumber}
                            onChange={(e) => setBankAccountNumber(e.target.value)}
                            placeholder="Enter your complete bank account number"
                            className="w-full pl-10 pr-4 py-3.5 rounded-xl border-2 border-slate-400 text-slate-950 font-mono font-black text-base focus:border-slate-950 focus:ring-2 focus:ring-slate-950/20 bg-white shadow-xs"
                          />
                        </div>
                      </div>

                      {/* 6. SWIFT / BIC Code & IBAN (Optional International Banking Fields) */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                        <div className="space-y-1.5">
                          <label className="block text-xs sm:text-sm font-black text-slate-950 uppercase tracking-wider font-mono">
                            SWIFT / BIC Code (Optional)
                          </label>
                          <div className="relative">
                            <Building className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-600 stroke-[2.5]" />
                            <input
                              type="text"
                              value={bankSwiftBic}
                              onChange={(e) => setBankSwiftBic(e.target.value.toUpperCase())}
                              placeholder="e.g. CHASUS33"
                              maxLength={11}
                              className="w-full pl-10 pr-3 py-3 rounded-xl border-2 border-slate-400 bg-white text-sm sm:text-base font-mono font-black text-slate-950 uppercase placeholder:normal-case placeholder:font-sans focus:border-slate-950 focus:ring-2 focus:ring-slate-950/20 shadow-xs"
                            />
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <label className="block text-xs sm:text-sm font-black text-slate-950 uppercase tracking-wider font-mono">
                            IBAN (Optional / International)
                          </label>
                          <div className="relative">
                            <Globe className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-600 stroke-[2.5]" />
                            <input
                              type="text"
                              value={bankIban}
                              onChange={(e) => setBankIban(e.target.value.toUpperCase())}
                              placeholder="e.g. GB29NWBK60161331926819"
                              maxLength={42}
                              className="w-full pl-10 pr-3 py-3 rounded-xl border-2 border-slate-400 bg-white text-sm sm:text-base font-mono font-black text-slate-950 uppercase placeholder:normal-case placeholder:font-sans focus:border-slate-950 focus:ring-2 focus:ring-slate-950/20 shadow-xs"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Security badge */}
                      <div className="flex items-center gap-2 p-3.5 rounded-xl bg-slate-100 border-2 border-slate-300 text-xs text-slate-950 font-bold">
                        <ShieldCheck className="w-5 h-5 text-slate-900 shrink-0 stroke-[2.5]" />
                        <span>
                          Monvera Sovereign Rails • End-to-end encrypted 256-bit bank routing transmission.
                        </span>
                      </div>

                      {/* Submit Button */}
                      <div className="pt-2">
                        <button
                          type="submit"
                          disabled={isSubmittingBankLink || !bankAccountNumber.trim()}
                          className="w-full py-4 px-6 rounded-2xl font-black text-base text-white bg-slate-950 hover:bg-slate-900 disabled:opacity-50 transition-all shadow-lg hover:shadow-xl active:translate-y-0.5 flex items-center justify-center gap-2.5 cursor-pointer"
                        >
                          {isSubmittingBankLink ? (
                            <>
                              <div className="w-5 h-5 border-3 border-white border-t-transparent animate-spin rounded-full" />
                              <span>Submitting Bank Application...</span>
                            </>
                          ) : (
                            <>
                              <span>Link Bank Account for Withdrawal</span>
                              <ArrowRight className="w-5 h-5 text-emerald-400 stroke-[3]" />
                            </>
                          )}
                        </button>
                      </div>
                    </form>
                  )}
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

      {/* OPEN BANKING SECURE VERIFICATION MODAL (TASK 5 - STAGE 3) */}
      {showVerificationModal && verifyingBankApp && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-7 border-2 border-slate-300 shadow-2xl relative space-y-5">
            <div className="flex items-center justify-between pb-3.5 border-b-2 border-slate-200">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-teal-950 text-white flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-6 h-6 text-teal-300 stroke-[2.5]" />
                </div>
                <div>
                  <h3 className="font-black text-lg sm:text-xl text-slate-950 tracking-tight">
                    Authorized Bank Verification
                  </h3>
                  <p className="text-xs font-bold text-slate-600">
                    Direct Open Banking Carrier Rail • 256-bit TLS
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowVerificationModal(false);
                  setBankVerificationError(null);
                }}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center font-bold cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Bank details summary */}
            <div className="p-4 rounded-2xl bg-slate-50 border-2 border-slate-200 text-xs space-y-1.5 font-bold text-slate-800">
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Bank Institution:</span>
                <span className="text-slate-950 font-black">{verifyingBankApp.bankName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Account Number:</span>
                <span className="font-mono text-slate-950">{verifyingBankApp.maskedAccountNumber || verifyingBankApp.accountNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Beneficiary Name:</span>
                <span className="text-slate-950">{verifyingBankApp.accountHolderName}</span>
              </div>
            </div>

            {/* Zero-Knowledge Security Notice */}
            <div className="p-3.5 rounded-2xl bg-teal-50 border border-teal-300 text-teal-950 text-xs font-bold leading-relaxed space-y-1">
              <div className="flex items-center gap-1.5 text-teal-900 font-black">
                <ShieldCheck className="w-4 h-4 text-teal-700 shrink-0" />
                <span>Zero-Knowledge Carrier Direct Verification</span>
              </div>
              <p className="text-[11px] text-teal-900/90 font-medium">
                Enter the one-time verification passcode sent to your bank-registered mobile or authenticator. Passcodes are processed directly with your banking network and are never shared, stored, or visible to Monvera administrators.
              </p>
            </div>

            {bankVerificationError && (
              <div className="p-3 rounded-xl bg-red-50 border-2 border-red-300 text-xs font-black text-red-950 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-700 shrink-0" />
                <span>{bankVerificationError}</span>
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleCompleteBankVerification(verifyingBankApp.id);
              }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <label className="block text-xs font-black text-slate-950 uppercase tracking-wider font-mono">
                  Bank Verification OTP / Passcode
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  maxLength={10}
                  value={verificationOtpInput}
                  onChange={(e) => setVerificationOtpInput(e.target.value.trim())}
                  placeholder="Enter 6-digit bank verification code"
                  className="w-full px-4 py-3.5 text-center text-xl font-mono font-black tracking-widest rounded-xl border-2 border-slate-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-500/20 text-slate-950 bg-white placeholder:text-slate-400 placeholder:text-sm placeholder:tracking-normal shadow-xs"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowVerificationModal(false);
                    setBankVerificationError(null);
                  }}
                  disabled={isSubmittingVerification}
                  className="flex-1 py-3.5 px-4 rounded-xl font-black text-xs uppercase tracking-wider text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingVerification || !verificationOtpInput.trim()}
                  className="flex-1 py-3.5 px-4 rounded-xl font-black text-xs uppercase tracking-wider text-white bg-teal-700 hover:bg-teal-600 transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md disabled:opacity-50"
                >
                  {isSubmittingVerification ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent animate-spin rounded-full" />
                      <span>Verifying...</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4 text-teal-200 stroke-[2.5]" />
                      <span>Activate Account</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
