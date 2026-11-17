import React, { useState, useRef, useMemo } from 'react';
import { api } from '../../services/api';
import { UserProfile, WireCheckRequestRecord, Transaction } from '../../types';
import {
  Landmark,
  User,
  MapPin,
  Mail,
  Phone,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Clock,
  ShieldCheck,
  Bell,
  Hash,
  CreditCard,
} from 'lucide-react';

export const WIRE_CHECK_US_BANKS: readonly string[] = [
  'Regions Bank',
  'JPMorgan Chase Bank',
  'Bank of America',
  'Wells Fargo',
  'Citibank',
  'U.S. Bank',
  'PNC Bank',
  'Truist Bank',
  'Capital One',
  'TD Bank',
  'Citizens Bank',
  'KeyBank',
  'Fifth Third Bank',
  'Huntington National Bank',
  'BMO Bank',
  'M&T Bank',
  'Ally Bank',
  'Charles Schwab Bank',
];

function generateWireCheckIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `wchk_${crypto.randomUUID()}`;
  }
  return `wchk_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function isValidUsRoutingNumber(raw: string): { valid: boolean; error?: string } {
  const trimmed = raw.trim();
  if (!/^\d{9}$/.test(trimmed)) {
    return {
      valid: false,
      error: 'Destination bank routing number must be exactly 9 numeric digits.',
    };
  }
  if (trimmed === '000000000') {
    return {
      valid: false,
      error: 'Please enter a valid 9-digit US bank routing number.',
    };
  }
  const d = trimmed.split('').map((ch) => Number(ch));
  const checksum =
    3 * (d[0] + d[3] + d[6]) +
    7 * (d[1] + d[4] + d[7]) +
    (d[2] + d[5] + d[8]);
  if (checksum % 10 !== 0) {
    return {
      valid: false,
      error: 'Invalid destination bank routing number. Please check your 9-digit US routing number.',
    };
  }
  return { valid: true };
}

export function isValidUsBankAccountNumber(raw: string): { valid: boolean; error?: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      valid: false,
      error: 'Please enter your destination bank account number.',
    };
  }
  if (!/^[0-9][0-9\-\s]{2,23}$/.test(trimmed)) {
    return {
      valid: false,
      error: 'Destination bank account number must contain only digits (4 to 17 digits).',
    };
  }
  const digitsOnly = trimmed.replace(/\D/g, '');
  if (digitsOnly.length < 4 || digitsOnly.length > 17) {
    return {
      valid: false,
      error: 'Destination bank account number must be between 4 and 17 digits.',
    };
  }
  return { valid: true };
}

interface WireCheckWithdrawPanelProps {
  currentUser: UserProfile;
  sourceAccount: 'CHECKING' | 'SAVINGS';
  onSourceAccountChange: (account: 'CHECKING' | 'SAVINGS') => void;
  availableChecking: number;
  availableSavings: number;
  refreshBalance: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
  onDone: () => void;
}

export const WireCheckWithdrawPanel: React.FC<WireCheckWithdrawPanelProps> = ({
  currentUser,
  sourceAccount,
  onSourceAccountChange,
  availableChecking,
  availableSavings,
  refreshBalance,
  refreshNotifications,
  onDone,
}) => {
  const defaultLegalName =
    currentUser.kycFullName ||
    currentUser.fullName ||
    `${currentUser.firstName || ''} ${currentUser.lastName || ''}`.trim();

  const [selectedBankOption, setSelectedBankOption] = useState<string>('Regions Bank');
  const [customBankName, setCustomBankName] = useState<string>('');
  const [destinationAccountNumber, setDestinationAccountNumber] = useState<string>('');
  const [destinationRoutingNumber, setDestinationRoutingNumber] = useState<string>('');
  const [fullLegalName, setFullLegalName] = useState<string>(defaultLegalName);
  const [residentialAddress, setResidentialAddress] = useState<string>('');
  const [email, setEmail] = useState<string>(currentUser.email || '');
  const [phoneNumber, setPhoneNumber] = useState<string>(currentUser.phone || '');
  const [amountInput, setAmountInput] = useState<string>('');

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRetryableError, setIsRetryableError] = useState<boolean>(false);
  const [confirmedSubmission, setConfirmedSubmission] = useState<{
    request: WireCheckRequestRecord;
    transaction: Transaction;
    isDuplicate?: boolean;
  } | null>(null);

  const submitLockRef = useRef<boolean>(false);
  const idempotencyKeyRef = useRef<string>('');

  const availableBal = sourceAccount === 'CHECKING' ? availableChecking : availableSavings;

  const effectiveBankName =
    selectedBankOption === 'OTHER' ? customBankName.trim() : selectedBankOption.trim();

  const parsedAmount = useMemo(() => {
    const cleaned = amountInput.trim().replace(/[$,\s]/g, '');
    if (!cleaned) return NaN;
    return Number(cleaned);
  }, [amountInput]);

  const hasValidPrecision =
    Number.isFinite(parsedAmount) &&
    parsedAmount > 0 &&
    Math.abs(parsedAmount * 100 - Math.round(parsedAmount * 100)) <= 1e-4;

  const invalidateIdempotencyKeyOnInputChange = () => {
    idempotencyKeyRef.current = '';
    setIsRetryableError(false);
    if (errorMessage) setErrorMessage(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLockRef.current || isSubmitting) return;

    setErrorMessage(null);
    setIsRetryableError(false);

    if (!effectiveBankName || effectiveBankName.length < 2) {
      setErrorMessage(
        selectedBankOption === 'OTHER'
          ? 'Please enter the name of your US bank.'
          : 'Please select a destination US bank.'
      );
      return;
    }

    const trimmedDestAccount = destinationAccountNumber.trim();
    const destAccCheck = isValidUsBankAccountNumber(trimmedDestAccount);
    if (!destAccCheck.valid) {
      setErrorMessage(destAccCheck.error || 'Please enter a valid destination bank account number.');
      return;
    }

    const trimmedDestRouting = destinationRoutingNumber.trim();
    const destRoutingCheck = isValidUsRoutingNumber(trimmedDestRouting);
    if (!destRoutingCheck.valid) {
      setErrorMessage(destRoutingCheck.error || 'Please enter a valid 9-digit US routing number.');
      return;
    }

    if (!fullLegalName.trim() || fullLegalName.trim().length < 2) {
      setErrorMessage('Please enter your full legal name.');
      return;
    }
    if (!phoneNumber.trim() || phoneNumber.trim().length < 7) {
      setErrorMessage('Please enter a valid phone number.');
      return;
    }
    const trimmedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }
    if (!residentialAddress.trim() || residentialAddress.trim().length < 5) {
      setErrorMessage('Please enter your complete current residential address.');
      return;
    }
    if (!hasValidPrecision) {
      setErrorMessage('Please enter a valid withdrawal amount greater than $0.00 (up to 2 decimal places).');
      return;
    }
    const cleanAmount = Number(parsedAmount.toFixed(2));
    if (cleanAmount > availableBal) {
      setErrorMessage(
        `Insufficient funds in ${sourceAccount === 'CHECKING' ? 'Checking' : 'Savings'}. Available balance is $${availableBal.toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}.`
      );
      return;
    }

    // Generate or reuse the same idempotencyKey across retries of the identical submission
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = generateWireCheckIdempotencyKey();
    }
    const activeIdempotencyKey = idempotencyKeyRef.current;

    submitLockRef.current = true;
    setIsSubmitting(true);

    try {
      const res = await api.submitWireCheckWithdrawal({
        bankName: effectiveBankName,
        destinationBankAccountNumber: trimmedDestAccount,
        destinationBankRoutingNumber: trimmedDestRouting,
        fullLegalName: fullLegalName.trim(),
        residentialAddress: residentialAddress.trim(),
        email: trimmedEmail,
        phoneNumber: phoneNumber.trim(),
        amount: cleanAmount,
        sourceAccountType: sourceAccount,
        idempotencyKey: activeIdempotencyKey,
      });

      if (res.success && res.request && res.transaction) {
        idempotencyKeyRef.current = '';
        setConfirmedSubmission({
          request: res.request,
          transaction: res.transaction,
          isDuplicate: res.isDuplicate,
        });
        await Promise.all([refreshBalance(), refreshNotifications()]);
      } else {
        setIsRetryableError(Boolean(res.isRetryableTimeout));
        if (!res.isRetryableTimeout && res.errorCode !== 'IDEMPOTENCY_MISMATCH') {
          idempotencyKeyRef.current = '';
        }
        setErrorMessage(res.error || 'Failed to submit Wire Check withdrawal. Your account was not debited.');
      }
    } catch (err: any) {
      setIsRetryableError(true);
      setErrorMessage(
        err?.message || 'Network interruption while submitting Wire Check withdrawal. You may safely retry.'
      );
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleStartAnother = () => {
    idempotencyKeyRef.current = '';
    setConfirmedSubmission(null);
    setDestinationAccountNumber('');
    setDestinationRoutingNumber('');
    setAmountInput('');
    setErrorMessage(null);
    setIsRetryableError(false);
  };

  if (confirmedSubmission) {
    const { request } = confirmedSubmission;
    return (
      <div className="space-y-5 py-2 animate-in fade-in duration-150">
        <div className="text-center space-y-2">
          <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto border border-emerald-200">
            <CheckCircle2 className="w-9 h-9" />
          </div>
          <h3 className="text-2xl font-black text-slate-950 tracking-tight">
            Wire Check Withdrawal Confirmed
          </h3>
          <div className="text-3xl font-black text-slate-950 font-mono tabular-nums">
            -${request.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
          </div>
          <p className="text-xs sm:text-sm text-slate-700 font-semibold max-w-md mx-auto">
            Your {request.sourceAccountType === 'CHECKING' ? 'Checking' : 'Savings'} account has been permanently debited and your Wire Check withdrawal request has been queued for delivery.
          </p>
        </div>

        <div className="p-4 sm:p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5 text-xs sm:text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-600 font-medium">Destination Bank</span>
            <span className="font-bold text-slate-950 text-right">{request.bankName}</span>
          </div>
          {request.destinationBankAccountNumberMasked && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-600 font-medium">Destination Bank Account</span>
              <span className="font-mono font-bold text-slate-950 tabular-nums text-right">
                {request.destinationBankAccountNumberMasked}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-600 font-medium">Transaction Reference</span>
            <span className="font-mono font-bold text-slate-950 tabular-nums text-right">
              {request.referenceNumber}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-600 font-medium">Source Account</span>
            <span className="font-bold text-slate-900">
              Monvera {request.sourceAccountType === 'CHECKING' ? 'Checking' : 'Savings'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-600 font-medium">Debit Status</span>
            <span className="font-bold text-emerald-700">Permanent Debit Completed</span>
          </div>
          <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-200">
            <span className="text-slate-600 font-medium">Delivery Status</span>
            <span className="px-2.5 py-0.5 rounded-md bg-amber-100 text-amber-900 font-mono font-bold text-xs uppercase">
              {request.checkProcessingStatus}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-600 font-medium">Estimated Delivery Time</span>
            <span className="font-bold text-slate-950 font-mono tabular-nums">
              {request.estimatedDeliveryBusinessDays || 5} business days
            </span>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-sky-50 border border-sky-200 text-xs text-sky-950 space-y-1.5">
          <div className="flex items-center gap-2 font-bold">
            <Bell className="w-4 h-4 text-sky-700 shrink-0" />
            <span>Delivery Estimate &amp; Notification</span>
          </div>
          <p className="text-sky-900 leading-relaxed">
            Estimated delivery is 5 business days. You will receive a notification when your Wire Check has been delivered.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 pt-1">
          <button
            type="button"
            onClick={handleStartAnother}
            className="flex-1 py-3.5 px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-900 font-bold text-sm transition-colors cursor-pointer whitespace-nowrap"
          >
            New Wire Check
          </button>
          <button
            type="button"
            onClick={onDone}
            className="flex-1 py-3.5 px-4 rounded-xl bg-slate-950 hover:bg-slate-800 text-white font-bold text-sm transition-colors cursor-pointer whitespace-nowrap"
          >
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 pt-1 animate-in fade-in duration-150">
      <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex items-start gap-3 text-xs text-slate-800">
        <ShieldCheck className="w-5 h-5 text-slate-900 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-bold text-slate-950 text-sm">
            Wire Check Withdrawal
          </div>
          <p className="text-slate-600 leading-relaxed">
            Submitting a Wire Check debits your selected Checking or Savings account and sends your check for delivery. Estimated delivery is 5 business days. You will receive a notification when your Wire Check has been delivered.
          </p>
        </div>
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-red-50 border border-red-300 text-xs sm:text-sm text-red-950 font-semibold flex items-start gap-2.5"
        >
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span>{errorMessage}</span>
            {isRetryableError && (
              <p className="text-xs font-medium text-red-800">
                Your submission key is preserved so retrying will not duplicate your debit.
              </p>
            )}
          </div>
        </div>
      )}

      {/* 1. Destination US Bank */}
      <div className="space-y-1.5">
        <label
          htmlFor="wire-check-bank-select"
          className="block text-xs font-black text-slate-900 uppercase tracking-wider font-mono"
        >
          Destination US Bank
        </label>
        <div className="relative">
          <Landmark className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5 pointer-events-none" />
          <select
            id="wire-check-bank-select"
            value={selectedBankOption}
            onChange={(e) => {
              setSelectedBankOption(e.target.value);
              invalidateIdempotencyKeyOnInputChange();
            }}
            className="w-full pl-10 pr-4 py-3 rounded-xl border-2 border-slate-300 focus:border-slate-950 bg-white text-sm font-bold text-slate-950 cursor-pointer"
          >
            {WIRE_CHECK_US_BANKS.map((bank) => (
              <option key={bank} value={bank}>
                {bank}
              </option>
            ))}
            <option value="OTHER">Other / Custom Bank</option>
          </select>
        </div>

        {selectedBankOption === 'OTHER' && (
          <div className="pt-1.5">
            <label
              htmlFor="wire-check-custom-bank"
              className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1 font-mono"
            >
              Custom Bank Name
            </label>
            <input
              id="wire-check-custom-bank"
              type="text"
              required
              maxLength={120}
              value={customBankName}
              onChange={(e) => {
                setCustomBankName(e.target.value);
                invalidateIdempotencyKeyOnInputChange();
              }}
              placeholder="Enter US Bank or Credit Union Name"
              className="w-full px-3.5 py-3 rounded-xl border-2 border-slate-300 focus:border-slate-950 bg-white text-sm font-bold text-slate-950"
            />
          </div>
        )}
      </div>

      {/* 2. Destination Bank Account Number */}
      <div className="space-y-1.5">
        <label
          htmlFor="wire-check-dest-account"
          className="block text-xs font-black text-slate-900 uppercase tracking-wider font-mono"
        >
          DESTINATION BANK ACCOUNT NUMBER
        </label>
        <div className="relative">
          <CreditCard className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5 pointer-events-none" />
          <input
            id="wire-check-dest-account"
            type="text"
            inputMode="numeric"
            required
            maxLength={24}
            autoComplete="off"
            value={destinationAccountNumber}
            onChange={(e) => {
              setDestinationAccountNumber(e.target.value);
              invalidateIdempotencyKeyOnInputChange();
            }}
            placeholder="Enter your US bank account number"
            className="w-full pl-10 pr-3.5 py-3 rounded-xl border-2 border-slate-300 focus:border-slate-950 bg-white text-sm font-bold font-mono text-slate-950"
          />
        </div>
      </div>

      {/* 3. Destination Bank Routing Number */}
      <div className="space-y-1.5">
        <label
          htmlFor="wire-check-dest-routing"
          className="block text-xs font-black text-slate-900 uppercase tracking-wider font-mono"
        >
          DESTINATION BANK ROUTING NUMBER
        </label>
        <div className="relative">
          <Hash className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5 pointer-events-none" />
          <input
            id="wire-check-dest-routing"
            type="text"
            inputMode="numeric"
            required
            maxLength={9}
            autoComplete="off"
            value={destinationRoutingNumber}
            onChange={(e) => {
              setDestinationRoutingNumber(e.target.value);
              invalidateIdempotencyKeyOnInputChange();
            }}
            placeholder="Enter your 9-digit US routing number"
            className="w-full pl-10 pr-3.5 py-3 rounded-xl border-2 border-slate-300 focus:border-slate-950 bg-white text-sm font-bold font-mono text-slate-950"
          />
        </div>
      </div>

      {/* 4. Full Legal Name & 5. Phone Number */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        <div className="space-y-1.5">
          <label
            htmlFor="wire-check-legal-name"
            className="block text-xs font-black text-slate-900 uppercase tracking-wider font-mono"
          >
            Full Legal Name
          </label>
          <div className="relative">
            <User className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5 pointer-events-none" />
            <input
              id="wire-check-legal-name"
              type="text"
              required
              maxLength={120}
              value={fullLegalName}
              onChange={(e) => {
                setFullLegalName(e.target.value);
                invalidateIdempotencyKeyOnInputChange();
              }}
              placeholder="Full legal name"
              className="w-full pl-10 pr-3.5 py-3 rounded-xl border-2 border-slate-300 focus:border-slate-950 bg-white text-sm font-bold text-slate-950"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="wire-check-phone"
            className="block text-xs font-black text-slate-900 uppercase tracking-wider font-mono"
          >
            Phone Number
          </label>
          <div className="relative">
            <Phone className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5 pointer-events-none" />
            <input
              id="wire-check-phone"
              type="tel"
              required
              maxLength={40}
              value={phoneNumber}
              onChange={(e) => {
                setPhoneNumber(e.target.value);
                invalidateIdempotencyKeyOnInputChange();
              }}
              placeholder="+1 (555) 234-5678"
              className="w-full pl-10 pr-3.5 py-3 rounded-xl border-2 border-slate-300 focus:border-slate-950 bg-white text-sm font-bold text-slate-950"
            />
          </div>
        </div>
      </div>

      {/* 6. Email Address */}
      <div className="space-y-1.5">
        <label
          htmlFor="wire-check-email"
          className="block text-xs font-black text-slate-900 uppercase tracking-wider font-mono"
        >
          Email Address
        </label>
        <div className="relative">
          <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5 pointer-events-none" />
          <input
            id="wire-check-email"
            type="email"
            required
            maxLength={120}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              invalidateIdempotencyKeyOnInputChange();
            }}
            placeholder="customer@email.com"
            className="w-full pl-10 pr-3.5 py-3 rounded-xl border-2 border-slate-300 focus:border-slate-950 bg-white text-sm font-bold text-slate-950"
          />
        </div>
      </div>

      {/* 7. Current Residential Address */}
      <div className="space-y-1.5">
        <label
          htmlFor="wire-check-address"
          className="block text-xs font-black text-slate-900 uppercase tracking-wider font-mono"
        >
          Current Residential Address
        </label>
        <div className="relative">
          <MapPin className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5 pointer-events-none" />
          <textarea
            id="wire-check-address"
            required
            rows={2}
            maxLength={250}
            value={residentialAddress}
            onChange={(e) => {
              setResidentialAddress(e.target.value);
              invalidateIdempotencyKeyOnInputChange();
            }}
            placeholder="Street address, apartment/suite, city, state, ZIP code"
            className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border-2 border-slate-300 focus:border-slate-950 bg-white text-sm font-bold text-slate-950 resize-none"
          />
        </div>
      </div>

      {/* 8. Withdrawal Amount (USD) */}
      <div className="space-y-2 pt-1">
        <label
          htmlFor="wire-check-amount"
          className="block text-xs font-black text-slate-900 uppercase tracking-wider font-mono"
        >
          Withdrawal Amount (USD)
        </label>
        <div className="relative">
          <span className="absolute left-4 top-3.5 text-xl font-black text-slate-400 font-mono">$</span>
          <input
            id="wire-check-amount"
            type="number"
            step="0.01"
            min="0.01"
            max={availableBal > 0 ? availableBal : undefined}
            required
            placeholder="0.00"
            value={amountInput}
            onChange={(e) => {
              setAmountInput(e.target.value);
              invalidateIdempotencyKeyOnInputChange();
            }}
            className="w-full pl-9 pr-4 py-3 text-2xl font-black font-mono tabular-nums text-slate-950 rounded-xl border-2 border-slate-300 focus:border-slate-950 bg-white"
          />
        </div>
      </div>

      {/* 9. Source Account — Checking or Savings */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label
            htmlFor="wire-check-source-account"
            className="block text-xs font-black text-slate-900 uppercase tracking-wider font-mono"
          >
            Source Account
          </label>
          <span className="text-xs font-mono text-slate-600 tabular-nums">
            Available:{' '}
            <strong className="text-slate-950 font-black">
              ${availableBal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </strong>
          </span>
        </div>
        <select
          id="wire-check-source-account"
          aria-label="Wire Check source account"
          value={sourceAccount}
          onChange={(e) => {
            onSourceAccountChange(e.target.value === 'SAVINGS' ? 'SAVINGS' : 'CHECKING');
            invalidateIdempotencyKeyOnInputChange();
          }}
          className="w-full px-3.5 py-3 rounded-xl border-2 border-slate-300 focus:border-slate-950 bg-white text-sm font-bold text-slate-950 cursor-pointer"
        >
          <option value="CHECKING">Checking (${availableChecking.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})</option>
          <option value="SAVINGS">Savings (${availableSavings.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})</option>
        </select>

        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs">
          <div className="flex items-center justify-between text-slate-700">
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-slate-500" />
              Estimated Delivery
            </span>
            <span className="font-bold text-slate-950">5 business days</span>
          </div>
        </div>
      </div>

      <button
        type="submit"
        disabled={isSubmitting || !hasValidPrecision || parsedAmount > availableBal}
        className="w-full py-4 px-6 rounded-2xl font-black text-base text-white bg-slate-950 hover:bg-slate-800 disabled:opacity-50 transition-all shadow-md flex items-center justify-center gap-2.5 cursor-pointer"
      >
        {isSubmitting ? (
          <>
            <div className="w-5 h-5 border-2 border-white border-t-transparent animate-spin rounded-full" />
            <span>Submitting Wire Check Withdrawal...</span>
          </>
        ) : (
          <>
            <span>Submit Wire Check Withdrawal</span>
            <ArrowRight className="w-5 h-5 text-emerald-400" />
          </>
        )}
      </button>
    </form>
  );
};

