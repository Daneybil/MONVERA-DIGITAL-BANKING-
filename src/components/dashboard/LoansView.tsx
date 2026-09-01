import React, { useState, useEffect } from 'react';
import {
  Banknote,
  TrendingUp,
  ShieldCheck,
  Zap,
  ArrowRight,
  Calculator,
  Coins,
  CheckCircle2,
  AlertCircle,
  Clock,
  RefreshCw,
  Building,
  CreditCard,
  FileText,
  DollarSign,
  XCircle,
  Sparkles,
  Info,
  Gavel,
  ShieldAlert,
  Calendar,
  Percent,
  Check,
  ChevronDown,
  ChevronUp,
  History,
  Timer,
  AlertTriangle,
  ArrowUpRight,
  Wallet,
  BadgeCheck,
  Bell,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { firestoreSync } from '../../services/firestoreSync';
import { LoanApplication, LoanEligibilityTier } from '../../types';

// Helper to format ISO dates with exact date and time
const formatDateWithTime = (dateStr?: string) => {
  if (!dateStr) return 'N/A';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'N/A';
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  } catch {
    return dateStr;
  }
};

// Live countdown timer badge component
const LoanCountdownBadge: React.FC<{
  maturityDateStr?: string;
  disbursedAtStr?: string;
  termMonths: number;
  isPaid: boolean;
}> = ({ maturityDateStr, disbursedAtStr, termMonths, isPaid }) => {
  const [timeLeft, setTimeLeft] = useState<{
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
    isDue: boolean;
  }>({ days: 0, hours: 0, minutes: 0, seconds: 0, isDue: false });

  useEffect(() => {
    if (isPaid) return;

    const calcTime = () => {
      let targetTime: number;
      if (maturityDateStr) {
        targetTime = new Date(maturityDateStr).getTime();
      } else {
        const base = disbursedAtStr ? new Date(disbursedAtStr).getTime() : Date.now();
        targetTime = base + (termMonths || 12) * 30 * 24 * 60 * 60 * 1000;
      }

      const diff = targetTime - Date.now();
      if (diff <= 0) {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0, isDue: true });
      } else {
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
        const minutes = Math.floor((diff / (1000 * 60)) % 60);
        const seconds = Math.floor((diff / 1000) % 60);
        setTimeLeft({ days, hours, minutes, seconds, isDue: false });
      }
    };

    calcTime();
    const interval = setInterval(calcTime, 1000);
    return () => clearInterval(interval);
  }, [maturityDateStr, disbursedAtStr, termMonths, isPaid]);

  if (isPaid) {
    return (
      <div className="inline-flex items-center gap-2 bg-emerald-100 text-emerald-950 px-3.5 py-1.5 rounded-xl border-2 border-emerald-500 font-mono font-black text-xs sm:text-sm">
        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
        <span>LOAN SETTLED IN FULL</span>
      </div>
    );
  }

  if (timeLeft.isDue) {
    return (
      <div className="inline-flex items-center gap-2 bg-red-100 text-red-950 px-3.5 py-2 rounded-xl border-2 border-red-600 font-mono font-black text-xs sm:text-sm animate-pulse shadow-md">
        <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
        <span>⚠️ MATURITY DUE DATE REACHED — REPAYMENT DUE IMMEDIATELY</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex items-center gap-2 bg-slate-950 text-white px-3.5 py-2 rounded-xl border-2 border-slate-700 shadow-md">
        <Timer className="w-4 h-4 text-amber-400 animate-spin" style={{ animationDuration: '6s' }} />
        <span className="text-xs font-black uppercase tracking-wider text-amber-300">Countdown to Maturity:</span>
        <span className="font-mono font-black text-sm sm:text-base text-white">
          {timeLeft.days}d {timeLeft.hours}h {timeLeft.minutes}m {timeLeft.seconds}s
        </span>
      </div>
      <span className="text-xs sm:text-sm font-black px-3 py-1.5 rounded-xl bg-amber-100 text-amber-950 border-2 border-amber-400 font-mono shadow-xs">
        ⏳ {timeLeft.days} Days Remaining
      </span>
    </div>
  );
};

export const LoansView: React.FC = () => {
  const { currentUser, balanceMetrics, refreshBalance, openModal, setCurrentView } = useAuth();

  // Eligibility state
  const [eligibility, setEligibility] = useState<LoanEligibilityTier>({
    volume: 0,
    tier: 'Starter Credit Tier',
    maxLimit: 10000,
    interestRateAPR: 20.0,
    minRequiredVolume: 2000,
    description: 'A minimum of $2,000.00 in account transaction volume or deposits is required to unlock your first credit facility.',
  });

  const [loans, setLoans] = useState<LoanApplication[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Form State
  const [amount, setAmount] = useState<number>(25000);
  const [termMonths, setTermMonths] = useState<number>(6);
  const [purpose, setPurpose] = useState<string>('Business Expansion & Working Capital');
  const [employmentOrBusiness, setEmploymentOrBusiness] = useState<string>('Enterprise Executive / Business Founder');
  const [annualRevenue, setAnnualRevenue] = useState<number>(150000);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Repayment Modal State
  const [repayModalLoan, setRepayModalLoan] = useState<LoanApplication | null>(null);
  const [repayAmountType, setRepayAmountType] = useState<'full' | 'installment' | 'custom'>('full');
  const [customRepayAmount, setCustomRepayAmount] = useState<number>(0);
  const [selectedSourceAccount, setSelectedSourceAccount] = useState<string>('');
  const [isRepaying, setIsRepaying] = useState<boolean>(false);
  const [repayFeedback, setRepayFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Expand / collapse logs for loan history
  const [expandedLoanIds, setExpandedLoanIds] = useState<Record<string, boolean>>({});

  const toggleLoanDetails = (loanId: string) => {
    setExpandedLoanIds((prev) => ({
      ...prev,
      [loanId]: !prev[loanId],
    }));
  };

  const loadData = async () => {
    if (!currentUser) return;
    setIsLoading(true);
    try {
      const [eligRes, loansRes] = await Promise.all([
        api.getLoanEligibility(currentUser.id),
        api.getLoans(currentUser.id),
      ]);

      if (eligRes) setEligibility(eligRes);
      if (loansRes && loansRes.loans) setLoans(loansRes.loans);
    } catch (err) {
      console.error('Error loading loan info:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();

    if (currentUser?.id) {
      const unsubscribe = firestoreSync.subscribeToLoans((allLoans) => {
        const userLoans = allLoans.filter((l) => l.userId === currentUser.id);
        setLoans(userLoans);
      });
      return () => unsubscribe();
    }
  }, [currentUser]);

  // Set default source account when repayment modal opens
  useEffect(() => {
    if (repayModalLoan && balanceMetrics?.accounts && balanceMetrics.accounts.length > 0 && !selectedSourceAccount) {
      const chk = balanceMetrics.accounts.find((a) => a.type === 'CHECKING') || balanceMetrics.accounts[0];
      setSelectedSourceAccount(chk.id);
    }
  }, [repayModalLoan, balanceMetrics, selectedSourceAccount]);

  // Fixed 20% Interest Calculation across all terms
  const totalInterest = Number((amount * 0.20).toFixed(2));
  const calculatedTotalRepayment = Number((amount * 1.20).toFixed(2));
  const calculatedMonthlyPayment = Math.round(calculatedTotalRepayment / termMonths);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;

    if (amount <= 0) {
      setFeedback({ type: 'error', message: 'Please enter a valid loan amount.' });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);

    try {
      const applicantFullName = `${currentUser.firstName || 'Valued'} ${currentUser.lastName || 'Customer'}`.trim();
      const applicantAccount = currentUser.permanentAccountNumber || (balanceMetrics?.accounts?.[0]?.accountNumber) || '1088492015';

      const res = await api.applyForLoan({
        userId: currentUser.id,
        amount,
        termMonths,
        purpose,
        employmentOrBusinessDetails: employmentOrBusiness,
        annualIncomeOrRevenue: annualRevenue,
        applicantName: applicantFullName,
        applicantEmail: currentUser.email || 'customer@monvera.com',
        applicantPhone: currentUser.phone || '+1 (555) 019-2834',
        permanentAccountNumber: applicantAccount,
        fallbackUser: {
          firstName: currentUser.firstName || 'Valued',
          lastName: currentUser.lastName || 'Customer',
          email: currentUser.email || 'customer@monvera.com',
          phone: currentUser.phone || '+1 (555) 019-2834',
          permanentAccountNumber: applicantAccount,
        },
      });

      if (res.success && res.loan) {
        setFeedback({
          type: 'success',
          message: `Loan application for $${amount.toLocaleString('en-US')} submitted to Monvera! You will receive a notification upon review.`,
        });
        loadData();
        refreshBalance();
      } else {
        setFeedback({
          type: 'error',
          message: res.error || 'Failed to submit loan application. Please try again.',
        });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Error communicating with Monvera.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenRepayModal = (loan: LoanApplication) => {
    setRepayModalLoan(loan);
    const totalRepay = loan.totalRepaymentAmount || Number((loan.amount * 1.20).toFixed(2));
    const remaining = loan.remainingBalance !== undefined ? loan.remainingBalance : totalRepay;
    setRepayAmountType('full');
    setCustomRepayAmount(remaining);
    setRepayFeedback(null);
    if (balanceMetrics?.accounts && balanceMetrics.accounts.length > 0) {
      const chk = balanceMetrics.accounts.find((a) => a.type === 'CHECKING') || balanceMetrics.accounts[0];
      setSelectedSourceAccount(chk.id);
    }
  };

  const handleProcessRepayment = async () => {
    if (!repayModalLoan || !currentUser) return;

    const totalRepay = repayModalLoan.totalRepaymentAmount || Number((repayModalLoan.amount * 1.20).toFixed(2));
    const remaining = repayModalLoan.remainingBalance !== undefined ? repayModalLoan.remainingBalance : totalRepay;

    let amountToPay = customRepayAmount;
    if (repayAmountType === 'full') {
      amountToPay = remaining;
    } else if (repayAmountType === 'installment') {
      amountToPay = Math.min(repayModalLoan.monthlyPayment, remaining);
    }

    if (amountToPay <= 0) {
      setRepayFeedback({ type: 'error', message: 'Please enter a valid repayment amount greater than $0.00.' });
      return;
    }

    if (amountToPay > remaining + 0.01) {
      setRepayFeedback({
        type: 'error',
        message: `Repayment amount ($${amountToPay.toLocaleString('en-US', {
          minimumFractionDigits: 2,
        })}) cannot exceed the remaining balance ($${remaining.toLocaleString('en-US', { minimumFractionDigits: 2 })}).`,
      });
      return;
    }

    setIsRepaying(true);
    setRepayFeedback(null);

    try {
      const applicantAccount = currentUser.permanentAccountNumber || (balanceMetrics?.accounts?.[0]?.accountNumber) || '1088492015';
      const res = await api.repayLoan({
        loanId: repayModalLoan.id,
        userId: currentUser.id,
        amount: amountToPay,
        sourceAccountId: selectedSourceAccount,
        note: repayAmountType === 'full' ? 'Full Loan Payoff Settlement' : `Partial Installment Repayment ($${amountToPay})`,
        fallbackLoan: repayModalLoan,
        fallbackUser: {
          firstName: currentUser.firstName || 'Valued',
          lastName: currentUser.lastName || 'Customer',
          email: currentUser.email || 'customer@monvera.com',
          phone: currentUser.phone || '+1 (555) 019-2834',
          permanentAccountNumber: applicantAccount,
        },
      });

      if (res.success && res.loan) {
        setRepayFeedback({
          type: 'success',
          message: res.remainingBalance === 0
            ? '🎉 Outstanding loan balance has been 100% repaid and settled in full!'
            : `Payment of $${amountToPay.toLocaleString('en-US', {
                minimumFractionDigits: 2,
              })} applied successfully! Outstanding balance is now $${res.remainingBalance?.toLocaleString('en-US', {
                minimumFractionDigits: 2,
              })}.`,
        });

        // Refresh global state
        await refreshBalance();
        await loadData();

        setTimeout(() => {
          setRepayModalLoan(null);
        }, 1800);
      } else {
        setRepayFeedback({
          type: 'error',
          message: res.error || 'Failed to process loan repayment. Please ensure sufficient funds in your selected account.',
        });
      }
    } catch (err: any) {
      setRepayFeedback({ type: 'error', message: err?.message || 'Error communicating with payment server.' });
    } finally {
      setIsRepaying(false);
    }
  };

  const activeLoans = loans.filter((l) => l.status === 'ACTIVE' || l.status === 'APPROVED');
  const totalActiveLoanBalance = activeLoans.reduce(
    (sum, l) => {
      const totalRepay = l.totalRepaymentAmount || Number((l.amount * 1.20).toFixed(2));
      const remaining = l.remainingBalance !== undefined ? l.remainingBalance : totalRepay;
      return sum + remaining;
    },
    0
  );

  // Available source account balance
  const activeSelectedAccount = balanceMetrics?.accounts?.find((a) => a.id === selectedSourceAccount);
  const availableSourceBalance = activeSelectedAccount ? activeSelectedAccount.balance : (balanceMetrics?.totalBalance || 0);

  return (
    <div className="space-y-8 pb-20">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b-2 border-slate-300 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-2xl bg-emerald-100 border-2 border-emerald-600 flex items-center justify-center text-emerald-950 shadow-md">
              <Banknote className="w-8 h-8" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-4xl font-black text-slate-950 tracking-tight">
                Loans & Liquidity Credit Facilities
              </h1>
              <p className="text-sm sm:text-base font-extrabold text-slate-800 mt-1">
                Institutional credit lines from $1,000 to $1,000,000 USD with transparent 20% fixed interest and flexible repayment options.
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={loadData}
          className="self-start sm:self-auto inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-black shadow-md transition-all cursor-pointer border border-slate-700"
        >
          <RefreshCw className={`w-4 h-4 text-emerald-400 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh Loan Status</span>
        </button>
      </div>

      {/* Real-time Tier & Eligibility Banner */}
      <div className="rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 text-white p-6 sm:p-9 border-3 border-slate-800 shadow-2xl relative overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center relative z-10">
          <div className="lg:col-span-7 space-y-4">
            <div className="inline-flex items-center gap-2 text-xs sm:text-sm font-mono font-black uppercase tracking-wider text-amber-300 bg-white/15 px-4 py-2 rounded-xl border border-white/25">
              <Sparkles className="w-4 h-4 text-amber-300" />
              <span>Credit Facility Status</span>
            </div>
            <h2 className="text-2xl sm:text-4xl lg:text-5xl font-black text-white tracking-tight">
              {eligibility.tier}
            </h2>
            <p className="text-slate-200 text-base sm:text-lg font-bold leading-relaxed">
              {eligibility.description}
            </p>

            {/* Dynamic Volume Progress */}
            <div className="pt-2 space-y-2.5 max-w-xl">
              <div className="flex justify-between text-sm sm:text-base font-mono font-black">
                <span className="text-slate-300">Monvera Transaction Volume:</span>
                <span className="text-emerald-300 text-base sm:text-lg font-black">${eligibility.volume.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-4 border-2 border-slate-700 overflow-hidden shadow-inner">
                <div
                  className="bg-gradient-to-r from-emerald-500 via-emerald-400 to-emerald-300 h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(100, Math.max(8, (eligibility.volume / 50000) * 100))}%`,
                  }}
                />
              </div>
              <div className="flex justify-between text-xs font-mono font-black text-slate-300">
                <span>$2,000 (Tier 1)</span>
                <span>$5,000 (Tier 2)</span>
                <span>$10,000 ($20k+ Limit)</span>
                <span>$50,000+ (Sovereign $1M)</span>
              </div>
            </div>
          </div>

          <div className="lg:col-span-5 grid grid-cols-2 gap-4">
            <div className="bg-white/10 backdrop-blur-md rounded-2xl p-5 border-2 border-white/20 shadow-lg">
              <div className="text-xs font-black text-slate-200 uppercase tracking-wider">Max Credit Limit</div>
              <div className="text-2xl sm:text-4xl font-black text-amber-300 font-mono mt-1.5">
                ${eligibility.maxLimit.toLocaleString('en-US')}
              </div>
              <div className="text-xs font-bold text-slate-300 mt-1">Direct to checking</div>
            </div>

            <div className="bg-white/10 backdrop-blur-md rounded-2xl p-5 border-2 border-white/20 shadow-lg">
              <div className="text-xs font-black text-slate-200 uppercase tracking-wider">Fixed Interest</div>
              <div className="text-2xl sm:text-4xl font-black text-emerald-300 font-mono mt-1.5">
                20.00%
              </div>
              <div className="text-xs font-bold text-slate-300 mt-1">Fixed loan interest</div>
            </div>

            <div className="bg-white/10 backdrop-blur-md rounded-2xl p-5 border-2 border-white/20 col-span-2 shadow-lg">
              <div className="text-xs font-black text-slate-200 uppercase tracking-wider">Total Outstanding Loan Obligation</div>
              <div className="text-2xl sm:text-4xl font-black text-white font-mono mt-1.5">
                ${totalActiveLoanBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
              <div className="text-xs font-bold text-slate-300 mt-1">
                {activeLoans.length > 0 ? `${activeLoans.length} active approved loan facility(ies) awaiting settlement` : 'No active outstanding balance'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Credit Limit Lock Notice if volume < $2,000 */}
      {eligibility.volume < 2000 && (
        <div className="p-6 rounded-3xl bg-amber-50 border-3 border-amber-400 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5 shadow-md">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-amber-200 border-2 border-amber-500 flex items-center justify-center text-amber-950 flex-shrink-0 mt-0.5">
              <AlertCircle className="w-7 h-7" />
            </div>
            <div>
              <h4 className="text-lg font-black text-amber-950">Minimum Deposit Requirement ($2,000 USD)</h4>
              <p className="text-sm sm:text-base font-bold text-amber-900 leading-relaxed mt-1">
                Monvera requires a cumulative deposit or completed transaction volume of <span className="underline font-black">$2,000.00</span> to unlock Tier 1 instant credit ($1,000 – $10,000 USD). Your current volume is <span className="font-mono font-black text-slate-950">${eligibility.volume.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>. Build your transaction history through legitimate deposits and transactions to qualify for higher available loan limits.
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              if (openModal) openModal('deposit');
              else if (setCurrentView) setCurrentView('transactions');
            }}
            className="whitespace-nowrap px-6 py-3.5 rounded-2xl bg-amber-900 hover:bg-amber-950 text-white font-black text-sm uppercase tracking-wider shadow-lg transition-all cursor-pointer"
          >
            Deposit Funds Now
          </button>
        </div>
      )}

      {/* Global Feedback Alert */}
      {feedback && (
        <div
          className={`p-5 rounded-3xl border-3 flex items-start gap-4 shadow-lg ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-500 text-emerald-950'
              : 'bg-red-50 border-red-500 text-red-950'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-6 h-6 text-emerald-700 flex-shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-6 h-6 text-red-700 flex-shrink-0 mt-0.5" />
          )}
          <div className="text-base font-extrabold leading-relaxed">{feedback.message}</div>
        </div>
      )}

      {/* Main Grid: Application Form & Active Loans */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* Left Column: Application Form */}
        <div className="lg:col-span-5 bg-white rounded-3xl p-6 sm:p-8 border-3 border-slate-300 shadow-xl space-y-6">
          <div className="border-b-2 border-slate-200 pb-4">
            <div className="inline-flex items-center gap-2 text-xs font-mono font-black uppercase text-emerald-950 bg-emerald-100 px-3.5 py-1.5 rounded-xl border-2 border-emerald-400 mb-2.5">
              <Calculator className="w-4 h-4 text-emerald-700" />
              <span>Direct Credit Application</span>
            </div>
            <h2 className="text-2xl font-black text-slate-950 tracking-tight">
              Apply for Capital Liquidity
            </h2>
            <p className="text-sm font-bold text-slate-700 mt-1">
              Submit your request to Monvera for disbursement directly into your checking account.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            
            {/* Amount Slider and Number Input */}
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <label className="text-sm font-black text-slate-950 uppercase tracking-wider">
                  Requested Amount ($ USD):
                </label>
                <div className="font-mono text-emerald-950 font-black text-2xl sm:text-3xl bg-emerald-100 px-4 py-1.5 rounded-2xl border-2 border-emerald-500 shadow-xs">
                  ${amount.toLocaleString('en-US')}
                </div>
              </div>

              <input
                type="range"
                min="1000"
                max={Math.max(10000, eligibility.maxLimit || 250000)}
                step="1000"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                className="w-full accent-emerald-600 cursor-pointer h-4 bg-slate-200 rounded-lg"
              />

              <div className="flex justify-between text-xs font-mono font-black text-slate-700">
                <span>$1,000 Min</span>
                <span>$25,000</span>
                <span>${(eligibility.maxLimit || 250000).toLocaleString('en-US')} Tier Max</span>
              </div>
            </div>

            {/* Repayment Term Selection */}
            <div className="space-y-2.5">
              <label className="text-sm font-black text-slate-950 uppercase tracking-wider block">
                Repayment Term Period:
              </label>
              <div className="grid grid-cols-5 gap-2">
                {[6, 12, 24, 36, 48].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setTermMonths(m)}
                    className={`py-3 rounded-xl text-xs sm:text-sm font-black transition-all cursor-pointer ${
                      termMonths === m
                        ? 'bg-slate-950 text-white border-2 border-slate-950 shadow-md scale-105'
                        : 'bg-slate-100 text-slate-900 border-2 border-slate-300 hover:bg-slate-200'
                    }`}
                  >
                    {m} Mo
                  </button>
                ))}
              </div>
            </div>

            {/* Loan Purpose / Capital Objective */}
            <div className="space-y-2">
              <label className="text-sm font-black text-slate-950 uppercase tracking-wider block">
                Loan Purpose / Capital Objective:
              </label>
              <select
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                className="w-full bg-slate-50 border-2 border-slate-300 rounded-xl px-4 py-3.5 text-slate-950 font-bold text-sm sm:text-base focus:border-emerald-600 focus:outline-none cursor-pointer"
              >
                <option value="Business Expansion & Working Capital">Business Expansion & Working Capital</option>
                <option value="Equipment, Technology & Fleet Purchase">Equipment, Technology & Fleet Purchase</option>
                <option value="Commercial Real Estate & Property">Commercial Real Estate & Property</option>
                <option value="Personal Milestone & Liquidity">Personal Milestone & Liquidity</option>
                <option value="Debt Consolidation & Refinancing">Debt Consolidation & Refinancing</option>
                <option value="Institutional Trade Finance">Institutional Trade Finance</option>
                <option value="Inventory & Supplier Invoicing">Inventory & Supplier Invoicing</option>
                <option value="Emergency Operating Reserves">Emergency Operating Reserves</option>
              </select>
            </div>

            {/* Business / Employment & Annual Income / Revenue */}
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-black text-slate-950 uppercase tracking-wider block">
                  Business / Employment Organization:
                </label>
                <input
                  type="text"
                  value={employmentOrBusiness}
                  onChange={(e) => setEmploymentOrBusiness(e.target.value)}
                  placeholder="e.g. Acme Global Logistics Corp"
                  className="w-full bg-slate-50 border-2 border-slate-300 rounded-xl px-4 py-3 text-slate-950 font-bold text-sm focus:border-emerald-600 focus:outline-none"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-black text-slate-950 uppercase tracking-wider block">
                  Annual Income / Business Revenue ($ USD):
                </label>
                <input
                  type="number"
                  value={annualRevenue}
                  onChange={(e) => setAnnualRevenue(Number(e.target.value))}
                  placeholder="150000"
                  className="w-full bg-slate-50 border-2 border-slate-300 rounded-xl px-4 py-3 text-slate-950 font-black font-mono text-sm focus:border-emerald-600 focus:outline-none"
                />
              </div>
            </div>

            {/* 3-Card Summary: Monthly Installment | Fixed 20% Interest | Total Repayment */}
            <div className="bg-slate-100 rounded-2xl p-4 sm:p-5 border-2 border-slate-300 grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
              {/* Monthly Installment */}
              <div className="p-3.5 bg-white rounded-xl border-2 border-slate-200 shadow-xs flex flex-col justify-between">
                <span className="text-[11px] font-black uppercase tracking-wider text-slate-700">
                  Monthly Installment
                </span>
                <div className="text-xl font-black text-emerald-950 font-mono my-1">
                  ${calculatedMonthlyPayment.toLocaleString('en-US')}
                </div>
                <span className="text-[10px] font-bold text-slate-600">{termMonths} monthly payments</span>
              </div>

              {/* Fixed 20% Interest */}
              <div className="p-3.5 bg-amber-100 rounded-xl border-2 border-amber-400 shadow-xs flex flex-col justify-between">
                <span className="text-[11px] font-black uppercase tracking-wider text-amber-950">
                  Fixed 20% Interest
                </span>
                <div className="text-xl font-black text-amber-950 font-mono my-1">
                  ${totalInterest.toLocaleString('en-US')}
                </div>
                <span className="text-[10px] font-black text-amber-900">Fixed rate fee</span>
              </div>

              {/* Total Repayment Due */}
              <div className="p-3.5 bg-white rounded-xl border-2 border-slate-200 shadow-xs flex flex-col justify-between">
                <span className="text-[11px] font-black uppercase tracking-wider text-slate-700">
                  Total Repayment
                </span>
                <div className="text-xl font-black text-slate-950 font-mono my-1">
                  ${calculatedTotalRepayment.toLocaleString('en-US')}
                </div>
                <span className="text-[10px] font-bold text-emerald-800">Principal + 20% fee</span>
              </div>
            </div>

            {/* Submit CTA */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full inline-flex items-center justify-center gap-2 text-base sm:text-lg font-black text-white bg-gradient-to-b from-emerald-600 via-emerald-700 to-emerald-800 hover:from-emerald-500 hover:to-emerald-700 border-2 border-emerald-500 border-b-[5px] border-b-emerald-950 px-8 py-4 rounded-2xl shadow-xl active:translate-y-1 active:border-b-[2px] transition-all cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? (
                <RefreshCw className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <span>Submit Loan Application (${amount.toLocaleString('en-US')})</span>
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </form>

          {/* Legal Compliance Warning Box */}
          <div className="p-4 rounded-2xl bg-red-950 text-white border-2 border-red-500 space-y-2 shadow-lg">
            <div className="flex items-center gap-2 text-red-300">
              <Gavel className="w-4 h-4 text-red-400 flex-shrink-0" />
              <span className="text-xs font-mono font-black uppercase tracking-wider">
                Enforceable Promissory & Debt Recovery Agreement
              </span>
            </div>
            <p className="text-xs font-bold text-red-100 leading-relaxed">
              All approved credit lines must be settled before or on maturity. Defaulting triggers international credit bureau reporting, account freezes, and commercial debt recovery enforcement.
            </p>
          </div>
        </div>

        {/* Right Column: Complete Application History & Detailed Breakdown */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-white rounded-3xl p-6 sm:p-8 border-3 border-slate-300 shadow-xl space-y-6">
            <div className="flex items-center justify-between border-b-2 border-slate-200 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-slate-900 border-2 border-slate-700 flex items-center justify-center text-white shadow-md">
                  <Clock className="w-6 h-6 text-amber-400" />
                </div>
                <div>
                  <h3 className="text-xl sm:text-2xl font-black text-slate-950 tracking-tight">Application & Active Loan History</h3>
                  <span className="text-xs sm:text-sm font-extrabold text-slate-700">Detailed breakdown, repayment status, countdown, and settlement actions</span>
                </div>
              </div>
              <span className="text-xs sm:text-sm font-black font-mono px-3.5 py-1.5 bg-slate-900 text-white rounded-xl shadow-xs border border-slate-700">
                {loans.length} Record(s)
              </span>
            </div>

            {loans.length === 0 ? (
              <div className="text-center py-14 space-y-4">
                <div className="w-16 h-16 mx-auto rounded-3xl bg-slate-100 border-2 border-slate-300 flex items-center justify-center text-slate-500 shadow-inner">
                  <Coins className="w-8 h-8" />
                </div>
                <h4 className="text-xl font-black text-slate-950">No Loan Applications Yet</h4>
                <p className="text-sm font-bold text-slate-700 max-w-sm mx-auto">
                  Submit an application using the credit form on the left to request liquidity directly into your checking account.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {loans.map((loan) => {
                  const isDisbursed = loan.status === 'ACTIVE' || loan.status === 'APPROVED';
                  const isPaid = loan.status === 'PAID';
                  const principal = loan.amount;
                  const interestAmt = loan.interestAmount || Number((principal * 0.20).toFixed(2));
                  const totalObligation = loan.totalRepaymentAmount || Number((principal * 1.20).toFixed(2));
                  const totalRepaid = loan.totalRepaid || 0;
                  const remainingBalance = loan.remainingBalance !== undefined ? loan.remainingBalance : (isPaid ? 0 : totalObligation);
                  const progressPct = Math.min(100, Math.round((totalRepaid / totalObligation) * 100));

                  const isExpanded = expandedLoanIds[loan.id] || false;

                  return (
                    <div
                      key={loan.id}
                      className={`rounded-3xl border-3 transition-all space-y-5 p-5 sm:p-7 shadow-lg ${
                        isPaid
                          ? 'bg-emerald-50/70 border-emerald-400'
                          : isDisbursed
                          ? 'bg-gradient-to-b from-white to-slate-50 border-slate-400 hover:border-slate-600'
                          : loan.status === 'REJECTED'
                          ? 'bg-red-50/70 border-red-300'
                          : 'bg-amber-50/70 border-amber-300'
                      }`}
                    >
                      {/* Top Header Row */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b-2 border-slate-200/80 pb-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono font-black uppercase text-slate-500 tracking-wider">
                              Ref ID: {loan.id}
                            </span>
                            <span className="text-slate-300">•</span>
                            <span className="text-xs font-black text-slate-700">
                              Applied: {formatDateWithTime(loan.createdAt)}
                            </span>
                          </div>
                          <h4 className="text-xl sm:text-2xl font-black text-slate-950 mt-1">
                            {loan.purpose}
                          </h4>
                        </div>

                        {/* Status Badge */}
                        <div className="self-start sm:self-auto">
                          {isPaid ? (
                            <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-black uppercase text-emerald-950 bg-emerald-200 px-4 py-2 rounded-xl border-2 border-emerald-500 shadow-sm">
                              <BadgeCheck className="w-4 h-4 text-emerald-700" />
                              Fully Repaid & Settled
                            </span>
                          ) : isDisbursed ? (
                            <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-black uppercase text-emerald-950 bg-emerald-100 px-4 py-2 rounded-xl border-2 border-emerald-500 shadow-sm">
                              <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                              Disbursed & Active
                            </span>
                          ) : loan.status === 'PENDING' ? (
                            <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-black uppercase text-amber-950 bg-amber-100 px-4 py-2 rounded-xl border-2 border-amber-400 animate-pulse shadow-sm">
                              <Clock className="w-4 h-4 text-amber-700" />
                              Monvera In Review
                            </span>
                          ) : loan.status === 'REJECTED' ? (
                            <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-black uppercase text-red-950 bg-red-100 px-4 py-2 rounded-xl border-2 border-red-400 shadow-sm">
                              <XCircle className="w-4 h-4 text-red-700" />
                              Application Declined
                            </span>
                          ) : (
                            <span className="text-xs font-black text-slate-800">{loan.status}</span>
                          )}
                        </div>
                      </div>

                      {/* Prominent Real-time Countdown & Remaining Days Banner */}
                      {(isDisbursed || isPaid) && (
                        <div className="p-4 rounded-2xl bg-slate-900 text-white border-2 border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-md">
                          <LoanCountdownBadge
                            maturityDateStr={loan.maturityDate}
                            disbursedAtStr={loan.disbursedAt}
                            termMonths={loan.termMonths}
                            isPaid={isPaid}
                          />

                          <div className="text-right">
                            <span className="text-[11px] font-black uppercase text-slate-400 block">Maturity Repayment Date</span>
                            <span className="text-xs sm:text-sm font-mono font-black text-amber-300">
                              {formatDateWithTime(loan.maturityDate || new Date(Date.now() + (loan.termMonths || 12) * 30 * 24 * 60 * 60 * 1000).toISOString())}
                            </span>
                          </div>
                        </div>
                      )}

                      {/* COMPREHENSIVE FINANCIAL BREAKDOWN MATRIX (Huge, Bold, Crystal-Clear) */}
                      <div className="space-y-3">
                        <div className="text-xs font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
                          <DollarSign className="w-4 h-4 text-emerald-700" />
                          <span>Detailed Financial Breakdown & Settlement Status</span>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                          {/* 1. Principal Disbursed */}
                          <div className="p-3.5 bg-slate-100 rounded-2xl border-2 border-slate-300 flex flex-col justify-between">
                            <span className="text-[10px] font-black uppercase text-slate-600">Principal Disbursed</span>
                            <span className="text-lg sm:text-xl font-black font-mono text-slate-950 my-1">
                              ${principal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </span>
                            <span className="text-[10px] font-bold text-slate-500">Credited to Checking</span>
                          </div>

                          {/* 2. Fixed 20% Interest Fee */}
                          <div className="p-3.5 bg-amber-50 rounded-2xl border-2 border-amber-400 flex flex-col justify-between">
                            <span className="text-[10px] font-black uppercase text-amber-950">Fixed 20% Interest</span>
                            <span className="text-lg sm:text-xl font-black font-mono text-amber-950 my-1">
                              ${interestAmt.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </span>
                            <span className="text-[10px] font-black text-amber-800">Fixed rate fee</span>
                          </div>

                          {/* 3. Total at Maturity */}
                          <div className="p-3.5 bg-slate-950 text-white rounded-2xl border-2 border-slate-800 flex flex-col justify-between shadow-md">
                            <span className="text-[10px] font-black uppercase text-amber-300">Total at Maturity</span>
                            <span className="text-lg sm:text-xl font-black font-mono text-white my-1">
                              ${totalObligation.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </span>
                            <span className="text-[10px] font-bold text-slate-300">Principal + 20%</span>
                          </div>

                          {/* 4. Total Amount Repaid */}
                          <div className="p-3.5 bg-emerald-100 rounded-2xl border-2 border-emerald-500 flex flex-col justify-between">
                            <span className="text-[10px] font-black uppercase text-emerald-950">Total Paid So Far</span>
                            <span className="text-lg sm:text-xl font-black font-mono text-emerald-950 my-1">
                              ${totalRepaid.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </span>
                            <span className="text-[10px] font-bold text-emerald-800">{progressPct}% Repaid</span>
                          </div>

                          {/* 5. Remaining Balance to Settle */}
                          <div className={`p-3.5 rounded-2xl border-2 flex flex-col justify-between ${
                            remainingBalance === 0
                              ? 'bg-emerald-50 border-emerald-400 text-emerald-950'
                              : 'bg-indigo-50 border-2 border-indigo-400 text-indigo-950'
                          }`}>
                            <span className="text-[10px] font-black uppercase text-indigo-950">Remaining Balance</span>
                            <span className="text-lg sm:text-xl font-black font-mono text-indigo-950 my-1">
                              ${remainingBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </span>
                            <span className="text-[10px] font-bold text-indigo-800">
                              {remainingBalance === 0 ? 'Fully Settled' : 'Due by Maturity'}
                            </span>
                          </div>

                          {/* 6. Monthly Installment */}
                          <div className="p-3.5 bg-slate-100 rounded-2xl border-2 border-slate-300 flex flex-col justify-between">
                            <span className="text-[10px] font-black uppercase text-slate-600">Monthly Payment</span>
                            <span className="text-lg sm:text-xl font-black font-mono text-slate-950 my-1">
                              ${loan.monthlyPayment.toLocaleString('en-US')}
                            </span>
                            <span className="text-[10px] font-bold text-slate-500">{loan.termMonths} Months Term</span>
                          </div>
                        </div>

                        {/* Interactive Repayment Progress Bar */}
                        {(isDisbursed || isPaid) && (
                          <div className="space-y-1.5 pt-1">
                            <div className="flex justify-between text-xs font-mono font-black text-slate-950">
                              <span>Repayment Progress ({progressPct}% Complete)</span>
                              <span>
                                ${totalRepaid.toLocaleString('en-US', { minimumFractionDigits: 2 })} / ${totalObligation.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                              </span>
                            </div>
                            <div className="w-full bg-slate-200 rounded-full h-3.5 border-2 border-slate-300 overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-500 ${
                                  isPaid
                                    ? 'bg-emerald-500'
                                    : 'bg-gradient-to-r from-emerald-600 to-emerald-400'
                                }`}
                                style={{ width: `${progressPct}%` }}
                              />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Timestamps & Disbursement Audit Details */}
                      <div className="p-4 rounded-2xl bg-white border-2 border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono text-slate-900">
                        <div>
                          <span className="text-[11px] font-black uppercase text-slate-500 block">Disbursed Date & Time:</span>
                          <span className="text-xs sm:text-sm font-black text-slate-950">
                            {loan.disbursedAt ? formatDateWithTime(loan.disbursedAt) : 'Pending Disbursement'}
                          </span>
                        </div>
                        <div>
                          <span className="text-[11px] font-black uppercase text-slate-500 block">Maturity / Due Date & Time:</span>
                          <span className="text-xs sm:text-sm font-black text-amber-900">
                            {loan.maturityDate ? formatDateWithTime(loan.maturityDate) : 'Calculated upon disbursement'}
                          </span>
                        </div>
                      </div>

                      {/* Rejection Note if Rejected */}
                      {loan.status === 'REJECTED' && loan.rejectionReason && (
                        <div className="p-4 bg-red-100 rounded-2xl border-2 border-red-400 text-xs font-bold text-red-950 space-y-1">
                          <span className="font-black uppercase tracking-wider text-red-950 block">
                            Monvera Compliance Note:
                          </span>
                          <p className="leading-relaxed text-sm">{loan.rejectionReason}</p>
                        </div>
                      )}

                      {/* ACTION BUTTONS: Repay Loan & Repayment Logs */}
                      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t-2 border-slate-200">
                        {/* Repay Button (Only for Active loans with balance > 0) */}
                        {isDisbursed && remainingBalance > 0 ? (
                          <button
                            type="button"
                            onClick={() => handleOpenRepayModal(loan)}
                            className="inline-flex items-center gap-2.5 px-6 py-3 rounded-2xl bg-gradient-to-r from-emerald-600 via-emerald-700 to-emerald-800 hover:from-emerald-500 hover:to-emerald-700 text-white font-black text-sm sm:text-base uppercase tracking-wider shadow-lg active:scale-95 transition-all cursor-pointer border-2 border-emerald-500"
                          >
                            <Wallet className="w-5 h-5" />
                            <span>Repay Loan (Partial or Full Payoff)</span>
                            <ArrowRight className="w-4 h-4" />
                          </button>
                        ) : isPaid ? (
                          <div className="inline-flex items-center gap-2 text-sm font-black text-emerald-800 bg-emerald-100 px-4 py-2 rounded-xl border border-emerald-400">
                            <BadgeCheck className="w-5 h-5 text-emerald-600" />
                            <span>Account in Good Standing — Zero Outstanding Debt</span>
                          </div>
                        ) : (
                          <div className="text-xs font-black text-slate-500">
                            Status: Monvera Compliance Assessment
                          </div>
                        )}

                        {/* Toggle Payment History Accordion */}
                        {loan.repaymentHistory && loan.repaymentHistory.length > 0 && (
                          <button
                            type="button"
                            onClick={() => toggleLoanDetails(loan.id)}
                            className="inline-flex items-center gap-2 text-xs sm:text-sm font-black text-slate-900 hover:text-emerald-700 bg-slate-100 hover:bg-slate-200 px-4 py-2.5 rounded-xl border-2 border-slate-300 transition-all cursor-pointer"
                          >
                            <History className="w-4 h-4" />
                            <span>{loan.repaymentHistory.length} Repayment Log(s)</span>
                            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </button>
                        )}
                      </div>

                      {/* Repayment History Itemized Accordion */}
                      {isExpanded && loan.repaymentHistory && loan.repaymentHistory.length > 0 && (
                        <div className="p-4 rounded-2xl bg-slate-900 text-white border-2 border-slate-800 space-y-3">
                          <div className="flex items-center justify-between border-b border-slate-700 pb-2">
                            <span className="text-xs font-black uppercase text-amber-300">
                              Itemized Repayment Ledger
                            </span>
                            <span className="text-xs font-mono text-slate-400">
                              Total Repaid: ${totalRepaid.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </span>
                          </div>

                          <div className="space-y-2">
                            {loan.repaymentHistory.map((rep) => (
                              <div
                                key={rep.id}
                                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-slate-800/90 rounded-xl border border-slate-700 text-xs font-mono"
                              >
                                <div>
                                  <span className="text-emerald-400 font-black text-sm">
                                    +${rep.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                  </span>
                                  <span className="text-slate-400 ml-2 font-bold">via {rep.paymentMethod}</span>
                                  {rep.note && <span className="text-slate-300 text-[11px] block">{rep.note}</span>}
                                </div>
                                <div className="text-right">
                                  <span className="text-slate-300 block">{formatDateWithTime(rep.date)}</span>
                                  {rep.remainingAfter !== undefined && (
                                    <span className="text-amber-300 text-[10px]">
                                      Balance after: ${rep.remainingAfter.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
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

      {/* REPAYMENT MODAL / DIALOG */}
      {repayModalLoan && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isRepaying) {
              setRepayModalLoan(null);
            }
          }}
        >
          <div
            className="bg-white w-full max-w-xl rounded-3xl p-6 sm:p-8 border-4 border-slate-900 shadow-2xl space-y-6 relative max-h-[92vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b-2 border-slate-200 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-emerald-100 border-2 border-emerald-600 flex items-center justify-center text-emerald-950 shadow-md">
                  <Wallet className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-xl sm:text-2xl font-black text-slate-950">Loan Settlement & Repayment</h3>
                  <span className="text-xs font-bold text-slate-600">Ref: {repayModalLoan.id} • {repayModalLoan.purpose}</span>
                </div>
              </div>
              <button
                type="button"
                disabled={isRepaying}
                onClick={() => setRepayModalLoan(null)}
                className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center cursor-pointer transition-all border border-slate-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Current Loan Summary Card */}
            {(() => {
              const totalRepay = repayModalLoan.totalRepaymentAmount || Number((repayModalLoan.amount * 1.20).toFixed(2));
              const currentRemaining = repayModalLoan.remainingBalance !== undefined ? repayModalLoan.remainingBalance : totalRepay;
              const alreadyPaid = repayModalLoan.totalRepaid || 0;

              let paymentAmount = customRepayAmount;
              if (repayAmountType === 'full') {
                paymentAmount = currentRemaining;
              } else if (repayAmountType === 'installment') {
                paymentAmount = Math.min(repayModalLoan.monthlyPayment, currentRemaining);
              }

              const remainingAfterPayment = Math.max(0, Number((currentRemaining - paymentAmount).toFixed(2)));

              return (
                <div className="space-y-6">
                  {/* Balance Display Grid */}
                  <div className="grid grid-cols-2 gap-3 bg-slate-900 text-white p-4 sm:p-5 rounded-2xl border-2 border-slate-800 shadow-md">
                    <div>
                      <span className="text-[11px] font-black uppercase text-amber-300 block">Outstanding Balance</span>
                      <span className="text-2xl sm:text-3xl font-mono font-black text-white">
                        ${currentRemaining.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </span>
                      <span className="text-[10px] text-slate-400 block mt-0.5">
                        Total Maturity: ${totalRepay.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </span>
                    </div>

                    <div>
                      <span className="text-[11px] font-black uppercase text-emerald-400 block">Total Repaid So Far</span>
                      <span className="text-2xl sm:text-3xl font-mono font-black text-emerald-300">
                        ${alreadyPaid.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </span>
                      <span className="text-[10px] text-slate-400 block mt-0.5">
                        Monthly: ${repayModalLoan.monthlyPayment.toLocaleString('en-US')}
                      </span>
                    </div>
                  </div>

                  {/* Repayment Type Selector */}
                  <div className="space-y-2">
                    <label className="text-xs font-black uppercase tracking-wider text-slate-950 block">
                      Choose Repayment Option:
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <button
                        type="button"
                        onClick={() => {
                          setRepayAmountType('full');
                          setCustomRepayAmount(currentRemaining);
                        }}
                        className={`py-3 px-3 rounded-xl text-xs font-black transition-all cursor-pointer text-center ${
                          repayAmountType === 'full'
                            ? 'bg-emerald-700 text-white border-2 border-emerald-950 shadow-md ring-2 ring-emerald-500'
                            : 'bg-slate-100 text-slate-800 border-2 border-slate-300 hover:bg-slate-200'
                        }`}
                      >
                        <div className="font-black text-sm">Pay Full Balance</div>
                        <div className="font-mono text-[11px] opacity-90 mt-0.5">${currentRemaining.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setRepayAmountType('installment');
                          setCustomRepayAmount(Math.min(repayModalLoan.monthlyPayment, currentRemaining));
                        }}
                        className={`py-3 px-3 rounded-xl text-xs font-black transition-all cursor-pointer text-center ${
                          repayAmountType === 'installment'
                            ? 'bg-emerald-700 text-white border-2 border-emerald-950 shadow-md ring-2 ring-emerald-500'
                            : 'bg-slate-100 text-slate-800 border-2 border-slate-300 hover:bg-slate-200'
                        }`}
                      >
                        <div className="font-black text-sm">Monthly Installment</div>
                        <div className="font-mono text-[11px] opacity-90 mt-0.5">${Math.min(repayModalLoan.monthlyPayment, currentRemaining).toLocaleString('en-US')}</div>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setRepayAmountType('custom');
                          if (!customRepayAmount || customRepayAmount === currentRemaining) {
                            setCustomRepayAmount(Math.min(repayModalLoan.monthlyPayment, currentRemaining));
                          }
                        }}
                        className={`py-3 px-3 rounded-xl text-xs font-black transition-all cursor-pointer text-center ${
                          repayAmountType === 'custom'
                            ? 'bg-emerald-700 text-white border-2 border-emerald-950 shadow-md ring-2 ring-emerald-500'
                            : 'bg-slate-100 text-slate-800 border-2 border-slate-300 hover:bg-slate-200'
                        }`}
                      >
                        <div className="font-black text-sm">Custom Partial Payment</div>
                        <div className="font-mono text-[11px] opacity-90 mt-0.5">Enter custom amount</div>
                      </button>
                    </div>
                  </div>

                  {/* Custom Amount Input & Quick Chips */}
                  {repayAmountType === 'custom' && (
                    <div className="space-y-3 p-4 bg-slate-50 rounded-2xl border-2 border-slate-200">
                      <label className="text-xs font-black uppercase tracking-wider text-slate-900 block">
                        Enter Partial Repayment Amount ($ USD):
                      </label>
                      <div className="relative">
                        <span className="absolute left-4 top-3.5 text-lg font-black text-slate-500 font-mono">$</span>
                        <input
                          type="number"
                          step="10"
                          min="1"
                          max={currentRemaining}
                          value={customRepayAmount || ''}
                          onChange={(e) => setCustomRepayAmount(Number(e.target.value))}
                          placeholder="e.g. 2500"
                          className="w-full pl-9 pr-4 py-3 bg-white border-2 border-slate-300 focus:border-emerald-600 rounded-xl font-mono text-xl font-black text-slate-950 focus:outline-none"
                        />
                      </div>

                      {/* Quick Presets */}
                      <div className="flex flex-wrap gap-2 pt-1">
                        {[100, 500, 1000, 2500, 5000].map((chip) => (
                          chip <= currentRemaining && (
                            <button
                              key={chip}
                              type="button"
                              onClick={() => setCustomRepayAmount(chip)}
                              className="text-xs font-black px-3 py-1.5 rounded-lg bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 font-mono transition-all cursor-pointer"
                            >
                              +${chip.toLocaleString('en-US')}
                            </button>
                          )
                        ))}
                        <button
                          type="button"
                          onClick={() => setCustomRepayAmount(currentRemaining)}
                          className="text-xs font-black px-3 py-1.5 rounded-lg bg-emerald-100 hover:bg-emerald-200 border border-emerald-400 text-emerald-950 font-mono transition-all cursor-pointer"
                        >
                          Max (${currentRemaining.toLocaleString('en-US', { minimumFractionDigits: 2 })})
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Payment Source Account Selector */}
                  <div className="space-y-2">
                    <label className="text-xs font-black uppercase tracking-wider text-slate-950 block">
                      Debit Source Account:
                    </label>
                    <select
                      value={selectedSourceAccount}
                      onChange={(e) => setSelectedSourceAccount(e.target.value)}
                      className="w-full bg-slate-50 border-2 border-slate-300 rounded-xl px-4 py-3 text-slate-950 font-bold text-sm focus:border-emerald-600 focus:outline-none cursor-pointer"
                    >
                      {(balanceMetrics?.accounts || []).map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.nickname || acc.type} ({acc.type}) — Available: ${acc.balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </option>
                      ))}
                    </select>

                    <div className="flex justify-between items-center text-xs font-mono text-slate-600 pt-0.5">
                      <span>Available in Selected Account:</span>
                      <span className="font-black text-slate-950">
                        ${availableSourceBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>

                  {/* Live Projection Matrix */}
                  <div className="p-4 rounded-2xl bg-emerald-50 border-2 border-emerald-300 space-y-2">
                    <div className="flex justify-between text-xs font-mono font-bold text-slate-700">
                      <span>Current Remaining Balance:</span>
                      <span className="font-black">${currentRemaining.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex justify-between text-xs font-mono font-bold text-emerald-800">
                      <span>Payment Amount:</span>
                      <span className="font-black">-${paymentAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex justify-between text-sm font-mono font-black text-slate-950 border-t border-emerald-200 pt-2">
                      <span>New Remaining Balance:</span>
                      <span className="text-base font-black text-emerald-950">
                        ${remainingAfterPayment.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>

                  {/* Repayment Modal Feedback */}
                  {repayFeedback && (
                    <div
                      className={`p-4 rounded-2xl border-2 flex items-start gap-3 ${
                        repayFeedback.type === 'success'
                          ? 'bg-emerald-100 border-emerald-500 text-emerald-950'
                          : 'bg-red-100 border-red-500 text-red-950'
                      }`}
                    >
                      {repayFeedback.type === 'success' ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-700 flex-shrink-0 mt-0.5" />
                      ) : (
                        <AlertCircle className="w-5 h-5 text-red-700 flex-shrink-0 mt-0.5" />
                      )}
                      <div className="text-sm font-black leading-relaxed">{repayFeedback.message}</div>
                    </div>
                  )}

                  {/* Submit Repayment Button */}
                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      disabled={isRepaying}
                      onClick={() => setRepayModalLoan(null)}
                      className="flex-1 py-3.5 rounded-xl border-2 border-slate-300 text-slate-800 hover:bg-slate-100 font-black text-sm transition-all cursor-pointer"
                    >
                      Cancel
                    </button>

                    <button
                      type="button"
                      disabled={isRepaying || paymentAmount <= 0}
                      onClick={handleProcessRepayment}
                      className="flex-2 inline-flex items-center justify-center gap-2 py-3.5 rounded-xl bg-gradient-to-r from-emerald-600 via-emerald-700 to-emerald-800 hover:from-emerald-500 hover:to-emerald-700 text-white font-black text-base shadow-xl active:scale-98 transition-all cursor-pointer disabled:opacity-50 border-2 border-emerald-500"
                    >
                      {isRepaying ? (
                        <RefreshCw className="w-5 h-5 animate-spin" />
                      ) : (
                        <>
                          <span>Confirm & Repay ${paymentAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                          <Check className="w-5 h-5" />
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
};
