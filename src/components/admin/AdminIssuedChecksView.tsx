import React, { useState, useEffect, useMemo, useRef } from 'react';
import { IssuedCheckRecord, UserProfile } from '../../types';
import { api } from '../../services/api';
import { AdminLoginForm } from './AdminLoginForm';
import {
  Search,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  FileText,
  User,
  Wallet,
  ShieldCheck,
  Loader2,
  X,
  ArrowUpRight,
  Clock,
  Hash,
  Lock,
} from 'lucide-react';

interface AdminIssuedChecksViewProps {
  customers: (UserProfile & { balanceMetrics?: any })[];
  onRefreshData?: () => Promise<void>;
}

function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `chk_req_${crypto.randomUUID()}`;
  }
  return `chk_req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export const AdminIssuedChecksView: React.FC<AdminIssuedChecksViewProps> = ({
  customers = [],
  onRefreshData,
}) => {
  // Issued Checks Registry (authoritative from Firestore via GET /api/admin/checks)
  const [issuedChecks, setIssuedChecks] = useState<IssuedCheckRecord[]>([]);
  const [isLoadingChecks, setIsLoadingChecks] = useState<boolean>(true);
  const [checksLoadError, setChecksLoadError] = useState<string | null>(null);
  const [registrySearch, setRegistrySearch] = useState<string>('');

  // Customer selection state
  const [customerSearch, setCustomerSearch] = useState<string>('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');

  // Check form state
  const [sourceAccountType, setSourceAccountType] = useState<'CHECKING' | 'SAVINGS'>('CHECKING');
  const [checkNumber, setCheckNumber] = useState<string>('');
  const [payeeName, setPayeeName] = useState<string>('');
  const [amountInput, setAmountInput] = useState<string>('');
  const [memo, setMemo] = useState<string>('');

  // Review, submission & idempotency lock state
  const [showReviewModal, setShowReviewModal] = useState<boolean>(false);
  const [pendingIdempotencyKey, setPendingIdempotencyKey] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [hasRetryableTimeout, setHasRetryableTimeout] = useState<boolean>(false);
  const [needsAdminReauth, setNeedsAdminReauth] = useState<boolean>(false);
  const [reauthNotice, setReauthNotice] = useState<string | null>(null);
  const [formFeedback, setFormFeedback] = useState<{
    type: 'success' | 'error' | 'warning';
    text: string;
    check?: IssuedCheckRecord;
    warnings?: string[];
  } | null>(null);

  const submitLockRef = useRef<boolean>(false);

  const loadIssuedChecks = async () => {
    setIsLoadingChecks(true);
    setChecksLoadError(null);
    try {
      const res = await api.getAdminIssuedChecks();
      if (res.success) {
        setIssuedChecks(res.checks || []);
      } else {
        setChecksLoadError(res.error || 'Failed to retrieve issued checks from server.');
        if (res.errorCode === 'ADMIN_SESSION_INVALID') {
          setReauthNotice(
            'Your administrator session has expired or is missing. Re-authenticate to continue loading and issuing checks.'
          );
        }
      }
    } catch (err: any) {
      setChecksLoadError(err?.message || 'Network error retrieving issued checks.');
    } finally {
      setIsLoadingChecks(false);
    }
  };

  useEffect(() => {
    loadIssuedChecks();
  }, []);

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => {
      const fullName = `${c.firstName || ''} ${c.lastName || ''}`.trim().toLowerCase();
      const accNum = (c.permanentAccountNumber || '').toLowerCase();
      const email = (c.email || '').toLowerCase();
      const username = (c.username || '').toLowerCase();
      const uid = (c.id || '').toLowerCase();
      return (
        fullName.includes(q) ||
        accNum.includes(q) ||
        email.includes(q) ||
        username.includes(q) ||
        uid.includes(q)
      );
    });
  }, [customers, customerSearch]);

  const selectedCustomer = useMemo(() => {
    return customers.find((c) => c.id === selectedCustomerId) || null;
  }, [customers, selectedCustomerId]);

  const checkingBalance = Number(selectedCustomer?.balanceMetrics?.checkingBalance ?? 0);
  const savingsBalance = Number(selectedCustomer?.balanceMetrics?.savingsBalance ?? 0);
  const selectedSourceBalance = sourceAccountType === 'CHECKING' ? checkingBalance : savingsBalance;

  const cleanAmountValue = useMemo(() => {
    const cleaned = amountInput.trim().replace(/[$,\s]/g, '');
    if (!cleaned) return NaN;
    return Number(cleaned);
  }, [amountInput]);

  const isValidAmount =
    Number.isFinite(cleanAmountValue) &&
    cleanAmountValue > 0 &&
    Math.abs(cleanAmountValue * 100 - Math.round(cleanAmountValue * 100)) <= 1e-4;

  const projectedBalance =
    selectedCustomer && isValidAmount
      ? Number((selectedSourceBalance - cleanAmountValue).toFixed(2))
      : selectedSourceBalance;

  const normalizedEnteredCheck = checkNumber.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const matchingExistingCheck = useMemo(() => {
    if (!normalizedEnteredCheck) return null;
    return (
      issuedChecks.find(
        (c) =>
          (c.normalizedCheckNumber || c.checkNumber.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')) ===
          normalizedEnteredCheck
      ) || null
    );
  }, [issuedChecks, normalizedEnteredCheck]);

  const resetSubmissionLock = () => {
    setPendingIdempotencyKey('');
    setHasRetryableTimeout(false);
  };

  const handleOpenReview = (e: React.FormEvent) => {
    e.preventDefault();
    setFormFeedback(null);

    if (!selectedCustomer) {
      setFormFeedback({ type: 'error', text: 'Please search and select an existing customer first.' });
      return;
    }

    if (!checkNumber.trim() || !normalizedEnteredCheck) {
      setFormFeedback({ type: 'error', text: 'Please enter a valid check number.' });
      return;
    }

    if (matchingExistingCheck) {
      setFormFeedback({
        type: 'error',
        text: `Check number "${checkNumber.trim()}" has already been issued (${matchingExistingCheck.referenceNumber}). Duplicate check numbers are not permitted.`,
      });
      return;
    }

    if (!payeeName.trim()) {
      setFormFeedback({ type: 'error', text: 'Please enter the payee name.' });
      return;
    }

    if (!isValidAmount) {
      setFormFeedback({
        type: 'error',
        text: 'Please enter a valid positive check amount (up to 2 decimal places).',
      });
      return;
    }

    if (cleanAmountValue > selectedSourceBalance) {
      setFormFeedback({
        type: 'error',
        text: `Insufficient available ${sourceAccountType === 'CHECKING' ? 'Checking' : 'Savings'} balance. Available funds: $${selectedSourceBalance.toLocaleString(
          'en-US',
          { minimumFractionDigits: 2, maximumFractionDigits: 2 }
        )}.`,
      });
      return;
    }

    if (!pendingIdempotencyKey) {
      setPendingIdempotencyKey(generateIdempotencyKey());
    }
    setHasRetryableTimeout(false);
    setShowReviewModal(true);
  };

  const handleConfirmIssueCheck = async () => {
    if (submitLockRef.current || isSubmitting) return;
    if (!selectedCustomer || !isValidAmount || !checkNumber.trim() || !payeeName.trim()) {
      setFormFeedback({ type: 'error', text: 'Missing or invalid check issuance details.' });
      setShowReviewModal(false);
      return;
    }

    const activeIdempotencyKey = pendingIdempotencyKey || generateIdempotencyKey();
    if (!pendingIdempotencyKey) {
      setPendingIdempotencyKey(activeIdempotencyKey);
    }

    submitLockRef.current = true;
    setIsSubmitting(true);
    setFormFeedback(null);

    try {
      const res = await api.issueAdminCheck({
        customerIdentifier: selectedCustomer.id,
        sourceAccountType,
        checkNumber: checkNumber.trim(),
        payeeName: payeeName.trim(),
        amount: Number(cleanAmountValue.toFixed(2)),
        memo: memo.trim() || undefined,
        idempotencyKey: activeIdempotencyKey,
      });

      if (res.success && res.check && res.transaction) {
        setShowReviewModal(false);
        setHasRetryableTimeout(false);
        setPendingIdempotencyKey('');
        setCheckNumber('');
        setPayeeName('');
        setAmountInput('');
        setMemo('');

        setFormFeedback({
          type: 'success',
          text: res.isDuplicate
            ? `Confirmed existing issuance for Check #${res.check.checkNumber} (${res.check.referenceNumber}) without duplicate debit.`
            : `Check #${res.check.checkNumber} issued to "${res.check.payeeName}" for -$${res.check.amount.toLocaleString(
                'en-US',
                { minimumFractionDigits: 2, maximumFractionDigits: 2 }
              )}. Customer ${res.check.customerName}'s ${res.check.sourceAccountType} account was permanently debited.`,
          check: res.check,
          warnings: res.warnings,
        });

        await Promise.all([
          loadIssuedChecks(),
          onRefreshData ? onRefreshData() : Promise.resolve(),
        ]);
      } else if (res.isRetryableTimeout) {
        // Keep modal open & keep the EXACT same idempotencyKey so retry is safe
        setHasRetryableTimeout(true);
        setFormFeedback({
          type: 'warning',
          text:
            res.error ||
            'Request timed out or encountered a server interruption. Your idempotency key is preserved; you can safely click "Retry Check Issuance" without double-debiting.',
        });
        // Check server registry in case commit completed right before timeout
        await Promise.all([
          loadIssuedChecks(),
          onRefreshData ? onRefreshData() : Promise.resolve(),
        ]);
      } else if (
        res.errorCode === 'ADMIN_SESSION_INVALID' ||
        res.errorCode === 'UNAUTHORIZED' ||
        res.errorCode === 'TOKEN_REFRESH_FAILED'
      ) {
        // Preserve review form, entered values, AND pendingIdempotencyKey so admin can re-authenticate and safely retry
        setHasRetryableTimeout(false);
        setReauthNotice(
          res.error ||
            'Your administrator session or authentication token expired. Re-authenticate below; your entered check details and request key remain preserved.'
        );
        setNeedsAdminReauth(true);
        setFormFeedback({
          type: 'warning',
          text:
            res.error ||
            'Authentication renewal required. Re-authenticate to safely retry with your preserved check details.',
        });
      } else {
        setShowReviewModal(false);
        setHasRetryableTimeout(false);
        // On non-timeout definitive business rejection, clear the key only if conflict wasn't an identical retry
        if (res.errorCode !== 'IDEMPOTENCY_MISMATCH') {
          setPendingIdempotencyKey('');
        }
        setFormFeedback({
          type: 'error',
          text: res.error || 'Failed to issue check. Customer balance was not modified.',
        });
      }
    } catch (err: any) {
      setHasRetryableTimeout(true);
      setFormFeedback({
        type: 'warning',
        text: err?.message || 'Unexpected error during check issuance. Retry safely with the preserved request key.',
      });
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  const filteredChecks = useMemo(() => {
    const q = registrySearch.trim().toLowerCase();
    if (!q) return issuedChecks;
    return issuedChecks.filter((c) => {
      return (
        c.checkNumber.toLowerCase().includes(q) ||
        c.customerName.toLowerCase().includes(q) ||
        c.customerAccountNumber.toLowerCase().includes(q) ||
        c.payeeName.toLowerCase().includes(q) ||
        c.referenceNumber.toLowerCase().includes(q) ||
        c.issuedByEmail.toLowerCase().includes(q)
      );
    });
  }, [issuedChecks, registrySearch]);

  const totalIssuedAmount = useMemo(
    () => issuedChecks.reduce((sum, c) => sum + (Number(c.amount) || 0), 0),
    [issuedChecks]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">Issued Checks</h2>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-900 text-amber-400">
              Permanent Account Debit
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Issue official bank checks to customers with immediate atomic debiting and irreversible ledger settlement
          </p>
        </div>

        <button
          type="button"
          onClick={loadIssuedChecks}
          disabled={isLoadingChecks}
          className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-xs font-bold text-slate-700 flex items-center gap-2 shadow-2xs cursor-pointer self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoadingChecks ? 'animate-spin text-amber-600' : ''}`} />
          <span>Refresh Check Registry</span>
        </button>
      </div>

      {/* Feedback Banner */}
      {formFeedback && (
        <div
          className={`p-4 rounded-2xl border-2 flex items-start justify-between gap-3 shadow-xs ${
            formFeedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
              : formFeedback.type === 'warning'
              ? 'bg-amber-50 border-amber-300 text-amber-950'
              : 'bg-rose-50 border-rose-300 text-rose-950'
          }`}
        >
          <div className="flex items-start gap-3 text-xs font-semibold">
            {formFeedback.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle
                className={`w-5 h-5 shrink-0 mt-0.5 ${
                  formFeedback.type === 'warning' ? 'text-amber-600' : 'text-rose-600'
                }`}
              />
            )}
            <div className="space-y-1">
              <div className="font-bold">{formFeedback.text}</div>
              {formFeedback.check && (
                <div className="font-mono text-[11px] opacity-85">
                  Ref: {formFeedback.check.referenceNumber} • Ledger Tx: {formFeedback.check.transactionId} • Status: COMPLETED
                </div>
              )}
              {formFeedback.warnings && formFeedback.warnings.length > 0 && (
                <div className="text-[11px] text-amber-800 bg-amber-100/80 px-2.5 py-1 rounded-lg mt-1">
                  Note: {formFeedback.warnings.join(' ')}
                </div>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setFormFeedback(null)}
            className="text-slate-500 hover:text-slate-900 p-1 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main Split Grid: Issuance Form + Summary/Recipient Confirmation */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Check Issuance Form */}
        <form
          onSubmit={handleOpenReview}
          className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 shadow-xs p-5 sm:p-6 space-y-5"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Issue New Customer Check</h3>
              <p className="text-[11px] text-slate-500">
                Debits selected balance immediately in a single atomic Firestore transaction
              </p>
            </div>
            <Lock className="w-4 h-4 text-slate-400" />
          </div>

          {/* 1. Customer Search & Selection */}
          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-700">
              1. Find & Select Customer
            </label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                placeholder="Search customer by name, account number, email, or @username..."
                className="w-full pl-10 pr-4 py-2.5 text-xs rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-slate-900/10 focus:border-slate-800 text-slate-900"
              />
            </div>

            <select
              value={selectedCustomerId}
              onChange={(e) => {
                setSelectedCustomerId(e.target.value);
                resetSubmissionLock();
              }}
              className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-slate-200 bg-white text-slate-900 font-semibold focus:outline-hidden focus:ring-2 focus:ring-slate-900/10 focus:border-slate-800"
            >
              <option value="">
                {filteredCustomers.length === 0
                  ? 'No matching customers found'
                  : `-- Select Customer (${filteredCustomers.length} matching) --`}
              </option>
              {filteredCustomers.map((cust) => {
                const name = `${cust.firstName || ''} ${cust.lastName || ''}`.trim() || cust.username || cust.email;
                const chk = Number(cust.balanceMetrics?.checkingBalance ?? 0);
                const sav = Number(cust.balanceMetrics?.savingsBalance ?? 0);
                return (
                  <option key={cust.id} value={cust.id}>
                    {name} — Acc #{cust.permanentAccountNumber || 'N/A'} (Chk: ${chk.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                    })} | Sav: ${sav.toLocaleString('en-US', { minimumFractionDigits: 2 })})
                  </option>
                );
              })}
            </select>
          </div>

          {/* 2. Source Account Selector */}
          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-700">
              2. Debit Source Account
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(['CHECKING', 'SAVINGS'] as const).map((acctType) => {
                const isSelected = sourceAccountType === acctType;
                const bal = acctType === 'CHECKING' ? checkingBalance : savingsBalance;
                return (
                  <button
                    key={acctType}
                    type="button"
                    onClick={() => {
                      setSourceAccountType(acctType);
                      resetSubmissionLock();
                    }}
                    className={`p-3.5 rounded-xl border-2 text-left transition-all cursor-pointer ${
                      isSelected
                        ? 'border-slate-900 bg-slate-900 text-white shadow-xs'
                        : 'border-slate-200 bg-slate-50/70 hover:bg-slate-100 text-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold">
                        {acctType === 'CHECKING' ? 'Premier Checking' : 'High-Yield Savings'}
                      </span>
                      <Wallet className={`w-4 h-4 ${isSelected ? 'text-amber-400' : 'text-slate-400'}`} />
                    </div>
                    <div
                      className={`text-base font-mono font-extrabold mt-1 ${
                        isSelected ? 'text-amber-300' : 'text-slate-900'
                      }`}
                    >
                      {selectedCustomer
                        ? `$${bal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : '—'}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. Check Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700">
                3. Check Number *
              </label>
              <input
                type="text"
                value={checkNumber}
                onChange={(e) => {
                  setCheckNumber(e.target.value);
                  resetSubmissionLock();
                }}
                placeholder="e.g. 10452"
                maxLength={64}
                className="w-full px-3.5 py-2.5 text-xs font-mono font-bold rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-slate-900/10 focus:border-slate-800 text-slate-900"
                required
              />
              {matchingExistingCheck && (
                <p className="text-[11px] font-bold text-rose-600">
                  Already issued on {new Date(matchingExistingCheck.issuedAt).toLocaleDateString()} (Ref:{' '}
                  {matchingExistingCheck.referenceNumber})
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700">
                4. Check Amount (USD) *
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={amountInput}
                onChange={(e) => {
                  setAmountInput(e.target.value);
                  resetSubmissionLock();
                }}
                placeholder="0.00"
                className="w-full px-3.5 py-2.5 text-xs font-mono font-bold rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-slate-900/10 focus:border-slate-800 text-slate-900"
                required
              />
              {selectedCustomer && isValidAmount && cleanAmountValue > selectedSourceBalance && (
                <p className="text-[11px] font-bold text-rose-600">
                  Exceeds available {sourceAccountType.toLowerCase()} balance ($
                  {selectedSourceBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}).
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-700">
              5. Payee Name *
            </label>
            <input
              type="text"
              value={payeeName}
              onChange={(e) => {
                setPayeeName(e.target.value);
                resetSubmissionLock();
              }}
              placeholder="Full legal name of payee or business"
              maxLength={150}
              className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-slate-900/10 focus:border-slate-800 text-slate-900 font-medium"
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-700">
              6. Memo / Description (Optional)
            </label>
            <input
              type="text"
              value={memo}
              onChange={(e) => {
                setMemo(e.target.value);
                resetSubmissionLock();
              }}
              placeholder="e.g. Official Cashier's Check Disbursement"
              maxLength={240}
              className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-slate-900/10 focus:border-slate-800 text-slate-900"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-amber-400 text-xs font-extrabold tracking-wide transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm"
          >
            <FileText className="w-4 h-4" />
            <span>Review & Confirm Check Issuance</span>
          </button>
        </form>

        {/* Right: Customer Balance Preview & Program Stats */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-slate-900 text-white rounded-2xl p-5 sm:p-6 space-y-4 shadow-sm border border-slate-800">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-bold">Recipient & Balance Confirmation</h3>
              </div>
              <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-amber-400/15 text-amber-300 border border-amber-400/30">
                Pre-Debit Check
              </span>
            </div>

            {selectedCustomer ? (
              <div className="space-y-4 text-xs">
                <div className="p-3.5 rounded-xl bg-slate-800/70 border border-slate-700 space-y-1.5">
                  <div className="text-[11px] text-slate-400 uppercase font-bold">Customer Identity</div>
                  <div className="text-base font-extrabold text-white">
                    {`${selectedCustomer.firstName || ''} ${selectedCustomer.lastName || ''}`.trim() ||
                      selectedCustomer.username}
                  </div>
                  <div className="font-mono text-amber-300 font-bold">
                    Account #: {selectedCustomer.permanentAccountNumber || 'N/A'}
                  </div>
                  <div className="text-slate-400">{selectedCustomer.email}</div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl bg-slate-800/50 border border-slate-800">
                    <div className="text-[10px] text-slate-400 uppercase font-bold">
                      Available {sourceAccountType === 'CHECKING' ? 'Checking' : 'Savings'}
                    </div>
                    <div className="text-sm font-mono font-bold text-white mt-1">
                      ${selectedSourceBalance.toLocaleString('en-US', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-800/50 border border-slate-800">
                    <div className="text-[10px] text-slate-400 uppercase font-bold">Permanent Debit</div>
                    <div className="text-sm font-mono font-bold text-rose-400 mt-1">
                      {isValidAmount
                        ? `-$${cleanAmountValue.toLocaleString('en-US', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}`
                        : '$0.00'}
                    </div>
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between">
                  <span className="text-slate-300 font-semibold">Projected Balance After Issuance</span>
                  <span
                    className={`text-base font-mono font-extrabold ${
                      projectedBalance < 0 ? 'text-rose-400' : 'text-emerald-400'
                    }`}
                  >
                    ${projectedBalance.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-slate-400 space-y-2">
                <User className="w-8 h-8 text-slate-600 mx-auto" />
                <p>Select a customer from the left panel to verify their account number and available balances.</p>
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Check Issuance Summary</span>
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-2xl font-extrabold text-slate-900 font-mono">{issuedChecks.length}</div>
                <div className="text-[11px] text-slate-500">Total Issued Checks</div>
              </div>
              <div>
                <div className="text-2xl font-extrabold text-slate-900 font-mono">
                  ${totalIssuedAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="text-[11px] text-slate-500">Total Permanently Debited</div>
              </div>
            </div>
            <div className="text-[11px] text-slate-500 pt-2 border-t border-slate-100">
              All check debits settle immediately as <span className="font-mono font-bold text-slate-700">CHECK_WITHDRAWAL</span> and are isolated from the 30-minute withdrawal reversal workflow.
            </div>
          </div>
        </div>
      </div>

      {/* Issued Checks Registry Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Issued Checks Ledger</h3>
            <p className="text-[11px] text-slate-500">
              Authoritative Firestore check issuance records and confirmed permanent debit statuses
            </p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={registrySearch}
              onChange={(e) => setRegistrySearch(e.target.value)}
              placeholder="Search check #, customer, payee, ref..."
              className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-slate-900/10 focus:border-slate-800"
            />
          </div>
        </div>

        {checksLoadError && (
          <div className="p-4 bg-rose-50 border-b border-rose-200 text-xs font-semibold text-rose-800 flex flex-wrap items-center justify-between gap-2">
            <span>{checksLoadError}</span>
            <div className="flex items-center gap-2">
              {reauthNotice && (
                <button
                  type="button"
                  onClick={() => setNeedsAdminReauth(true)}
                  className="px-3 py-1 rounded-lg bg-slate-900 text-amber-400 font-bold cursor-pointer"
                >
                  Re-authenticate
                </button>
              )}
              <button
                type="button"
                onClick={loadIssuedChecks}
                className="px-3 py-1 rounded-lg bg-rose-600 text-white font-bold cursor-pointer"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="p-4 font-semibold">Check #</th>
                <th className="p-4 font-semibold">Customer</th>
                <th className="p-4 font-semibold">Payee</th>
                <th className="p-4 font-semibold">Source</th>
                <th className="p-4 font-semibold text-right">Amount</th>
                <th className="p-4 font-semibold">Issued Date</th>
                <th className="p-4 font-semibold">Issued By</th>
                <th className="p-4 font-semibold text-center">Debit Status</th>
                <th className="p-4 font-semibold">Tx Reference</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoadingChecks && issuedChecks.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-10 text-center text-slate-400">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-amber-500" />
                    Loading issued checks from Firestore...
                  </td>
                </tr>
              ) : filteredChecks.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-10 text-center text-slate-400">
                    No issued checks found matching your filter.
                  </td>
                </tr>
              ) : (
                filteredChecks.map((chk) => (
                  <tr key={chk.checkId} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-4 font-mono font-bold text-slate-900 whitespace-nowrap">
                      #{chk.checkNumber}
                    </td>
                    <td className="p-4">
                      <div className="font-bold text-slate-900">{chk.customerName}</div>
                      <div className="text-[11px] font-mono text-slate-500">
                        Acc: {chk.customerAccountNumber}
                      </div>
                    </td>
                    <td className="p-4 font-semibold text-slate-800">{chk.payeeName}</td>
                    <td className="p-4">
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-bold text-[10px]">
                        {chk.sourceAccountType}
                      </span>
                    </td>
                    <td className="p-4 text-right font-mono font-bold text-slate-900 whitespace-nowrap">
                      -${Number(chk.amount || 0).toLocaleString('en-US', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="p-4 text-slate-600 whitespace-nowrap">
                      <div>{new Date(chk.issuedAt).toLocaleDateString()}</div>
                      <div className="text-[11px] font-mono text-slate-400">
                        {new Date(chk.issuedAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </td>
                    <td className="p-4 text-slate-600 font-medium">{chk.issuedByEmail}</td>
                    <td className="p-4 text-center">
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <CheckCircle2 className="w-3 h-3" />
                        {chk.debitStatus || 'COMPLETED'}
                      </span>
                    </td>
                    <td className="p-4 font-mono font-bold text-slate-700 whitespace-nowrap">
                      {chk.referenceNumber}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Review & Confirm Modal */}
      {showReviewModal && selectedCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="w-full max-w-lg bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="w-5 h-5 text-amber-400" />
                <div>
                  <h3 className="text-sm font-extrabold">Confirm Permanent Check Debit</h3>
                  <p className="text-[11px] text-slate-400">Review all check details before committing</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!isSubmitting) setShowReviewModal(false);
                }}
                disabled={isSubmitting}
                className="text-slate-400 hover:text-white p-1 cursor-pointer disabled:opacity-40"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                <div className="flex justify-between">
                  <span className="text-slate-500">Customer</span>
                  <span className="font-bold text-slate-900">
                    {`${selectedCustomer.firstName || ''} ${selectedCustomer.lastName || ''}`.trim()} (Acc:{' '}
                    {selectedCustomer.permanentAccountNumber})
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Source Account</span>
                  <span className="font-bold text-slate-900">{sourceAccountType}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Check Number</span>
                  <span className="font-mono font-bold text-slate-900">#{checkNumber.trim()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Payee Name</span>
                  <span className="font-bold text-slate-900">{payeeName.trim()}</span>
                </div>
                {memo.trim() && (
                  <div className="flex justify-between gap-4">
                    <span className="text-slate-500 shrink-0">Memo</span>
                    <span className="font-medium text-slate-800 text-right">{memo.trim()}</span>
                  </div>
                )}
                <div className="pt-2.5 border-t border-slate-200 flex justify-between items-center">
                  <span className="text-slate-600 font-semibold">Current Available Balance</span>
                  <span className="font-mono font-bold text-slate-800">
                    ${selectedSourceBalance.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-600 font-semibold">Permanent Debit Amount</span>
                  <span className="font-mono text-sm font-extrabold text-rose-600">
                    -${cleanAmountValue.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
                <div className="flex justify-between items-center pt-1.5 border-t border-slate-200">
                  <span className="font-bold text-slate-900">New Balance After Issuance</span>
                  <span className="font-mono text-sm font-extrabold text-emerald-700">
                    ${projectedBalance.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 text-[11px] font-medium">
                This action permanently debits the customer's account and posts a completed CHECK_WITHDRAWAL transaction. It will never enter the 30-minute reversal queue.
              </div>

              {hasRetryableTimeout && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-[11px] font-semibold">
                  Previous attempt timed out or was interrupted. Retrying uses the locked idempotency key (
                  <span className="font-mono">{pendingIdempotencyKey}</span>) so no duplicate debit can occur.
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowReviewModal(false)}
                  disabled={isSubmitting}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-bold hover:bg-slate-50 cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmIssueCheck}
                  disabled={isSubmitting}
                  className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-amber-400 font-extrabold flex items-center gap-2 cursor-pointer disabled:opacity-50 shadow-sm"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Committing Atomic Debit...</span>
                    </>
                  ) : hasRetryableTimeout ? (
                    <>
                      <RefreshCw className="w-4 h-4" />
                      <span>Retry Check Issuance</span>
                    </>
                  ) : (
                    <>
                      <ArrowUpRight className="w-4 h-4" />
                      <span>Confirm & Issue Check</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* In-Place Admin Re-Authentication Modal (preserves entered form values and review modal) */}
      {needsAdminReauth && (
        <div className="fixed inset-0 z-[60] overflow-y-auto bg-slate-950/80 backdrop-blur-xs">
          <AdminLoginForm
            sessionNotice={
              reauthNotice ||
              'Your administrator session expired. Sign in again to continue issuing your check with all entered details preserved.'
            }
            onSuccess={() => {
              setNeedsAdminReauth(false);
              setReauthNotice(null);
              setFormFeedback({
                type: 'warning',
                text: 'Administrator session renewed. Your entered check details and idempotency key are preserved — review and click Confirm & Issue Check to proceed.',
              });
              loadIssuedChecks();
            }}
            onCancel={() => {
              setNeedsAdminReauth(false);
            }}
          />
        </div>
      )}
    </div>
  );
};
