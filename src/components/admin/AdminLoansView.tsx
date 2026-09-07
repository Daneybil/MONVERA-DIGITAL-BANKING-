import React, { useState, useEffect } from 'react';
import {
  Banknote,
  Coins,
  ShieldCheck,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  Clock,
  ArrowRight,
  Search,
  Check,
  X,
  XCircle,
  DollarSign,
  User,
  Building,
  RefreshCw,
  FileText,
  CreditCard,
  ChevronDown,
  ChevronUp,
  History,
  ArrowDownLeft,
  ArrowUpRight,
  Send,
  Download,
  Eye,
  Ban,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { firestoreSync } from '../../services/firestoreSync';
import { LoanApplication, LoanStatus, Transaction } from '../../types';

export const AdminLoansView: React.FC = () => {
  const { currentUser, refreshBalance } = useAuth();

  const [loans, setLoans] = useState<LoanApplication[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Approval Modal State
  const [approveModalLoan, setApproveModalLoan] = useState<LoanApplication | null>(null);

  // Rejection Modal State
  const [rejectModalLoan, setRejectModalLoan] = useState<LoanApplication | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string>('');

  // Cancellation Modal State
  const [cancelModalLoan, setCancelModalLoan] = useState<LoanApplication | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Transaction History Inspection State
  const [expandedLedgerLoanId, setExpandedLedgerLoanId] = useState<string | null>(null);
  const [userLedgers, setUserLedgers] = useState<
    Record<
      string,
      {
        loading: boolean;
        transactions: Transaction[];
        checkingBalance?: number;
        savingsBalance?: number;
        totalVolume: number;
        error?: string;
      }
    >
  >({});

  const fetchLoans = async () => {
    setIsLoading(true);
    try {
      const res = await api.getLoans();
      setLoans(res.loans || []);
    } catch (err) {
      console.error('Error fetching admin loans:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLoans();
    const unsubscribe = firestoreSync.subscribeToLoans((all) => {
      setLoans(all);
    });
    return () => unsubscribe();
  }, []);

  const handleToggleInspection = async (loan: LoanApplication) => {
    if (expandedLedgerLoanId === loan.id) {
      setExpandedLedgerLoanId(null);
      return;
    }

    setExpandedLedgerLoanId(loan.id);

    // If already loaded, don't refetch
    if (userLedgers[loan.userId] && !userLedgers[loan.userId].loading) {
      return;
    }

    setUserLedgers((prev) => ({
      ...prev,
      [loan.userId]: {
        loading: true,
        transactions: [],
        totalVolume: 0,
      },
    }));

    try {
      const [txRes, balanceMetrics] = await Promise.all([
        api.getTransactions({ userId: loan.userId }),
        api.getBalanceMetrics(loan.userId, loan.permanentAccountNumber),
      ]);

      const txs = txRes.transactions || [];
      const volume = txs
        .filter((t) => t.status === 'COMPLETED')
        .reduce((sum, t) => sum + (t.amount || 0), 0);

      setUserLedgers((prev) => ({
        ...prev,
        [loan.userId]: {
          loading: false,
          transactions: txs,
          checkingBalance: balanceMetrics.checkingBalance,
          savingsBalance: balanceMetrics.savingsBalance,
          totalVolume: volume,
        },
      }));
    } catch (err: any) {
      setUserLedgers((prev) => ({
        ...prev,
        [loan.userId]: {
          loading: false,
          transactions: [],
          totalVolume: loan.userTransactionVolume || 0,
          error: err?.message || 'Could not load transaction history.',
        },
      }));
    }
  };

  const handleApproveConfirm = async () => {
    if (!approveModalLoan) return;

    setIsProcessing(true);
    setFeedback(null);
    try {
      const res = await api.adminApproveLoan({
        loanId: approveModalLoan.id,
        adminId: currentUser?.id || 'usr_admin',
      });

      if (res.success && res.loan) {
        setFeedback({
          type: 'success',
          message: `Loan ${approveModalLoan.id} for $${approveModalLoan.amount.toLocaleString('en-US')} approved and disbursed directly into ${approveModalLoan.applicantName}'s Checking Account!`,
        });
        // Immediately remove approved loan from admin dashboard
        setLoans((prev) => prev.filter((l) => l.id !== approveModalLoan.id));
        setApproveModalLoan(null);
        refreshBalance();
      } else {
        setFeedback({ type: 'error', message: res.error || 'Failed to approve loan.' });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Error processing loan approval.' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRejectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectModalLoan) return;

    setIsProcessing(true);
    setFeedback(null);
    try {
      const res = await api.adminRejectLoan({
        loanId: rejectModalLoan.id,
        reason: rejectionReason || 'Application does not meet current transaction volume Monvera guidelines.',
        adminId: currentUser?.id || 'usr_admin',
      });

      if (res.success && res.loan) {
        setFeedback({
          type: 'success',
          message: `Loan ${rejectModalLoan.id} declined. Details removed from admin dashboard and notice sent to applicant.`,
        });
        // Immediately remove rejected loan from admin dashboard
        setLoans((prev) => prev.filter((l) => l.id !== rejectModalLoan.id));
        setRejectModalLoan(null);
        setRejectionReason('');
      } else {
        setFeedback({ type: 'error', message: res.error || 'Failed to reject loan.' });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Error processing loan rejection.' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancelConfirm = async () => {
    if (!cancelModalLoan) return;

    setIsProcessing(true);
    setFeedback(null);
    try {
      const res = await api.adminRejectLoan({
        loanId: cancelModalLoan.id,
        reason: 'Application canceled and closed by administrator.',
        adminId: currentUser?.id || 'usr_admin',
      });

      if (res.success) {
        setFeedback({
          type: 'success',
          message: `Loan ${cancelModalLoan.id} canceled and removed from admin dashboard. Customer dashboard updated.`,
        });
        // Immediately remove canceled loan from admin dashboard
        setLoans((prev) => prev.filter((l) => l.id !== cancelModalLoan.id));
        setCancelModalLoan(null);
      } else {
        setFeedback({ type: 'error', message: res.error || 'Failed to cancel loan.' });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Error canceling loan application.' });
    } finally {
      setIsProcessing(false);
    }
  };

  // Metrics
  const totalRequested = loans.reduce((sum, l) => sum + l.amount, 0);
  const pendingLoans = loans.filter((l) => l.status === 'PENDING');
  const activeLoans = loans.filter((l) => l.status === 'ACTIVE' || l.status === 'APPROVED');
  const disbursedTotal = activeLoans.reduce((sum, l) => sum + (l.disbursedAmount || l.amount), 0);

  // Filtered List - ONLY pending loans appear in the admin queue
  // Any loan approved, rejected, or canceled immediately disappears from the admin dashboard!
  const filteredLoans = loans.filter((loan) => {
    // Approved, rejected, and canceled loans disappear from the admin dashboard
    if (loan.status !== 'PENDING') return false;

    const matchesSearch =
      loan.applicantName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      loan.applicantEmail.toLowerCase().includes(searchQuery.toLowerCase()) ||
      loan.permanentAccountNumber.includes(searchQuery) ||
      loan.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      loan.purpose.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesSearch;
  });

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-12">
      {/* Executive Command Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-indigo-950 rounded-3xl p-6 sm:p-8 text-white shadow-xl border border-slate-800 relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="relative z-10 space-y-2">
          <div className="inline-flex items-center gap-2 text-xs font-mono font-black uppercase tracking-wider text-emerald-400 bg-emerald-950/70 px-3 py-1 rounded-lg border border-emerald-500/40">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Institutional Credit & Monvera Terminal</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
            Loan Monvera & Credit Administration
          </h1>
          <p className="text-slate-300 text-sm sm:text-base font-medium max-w-2xl leading-relaxed">
            Review customer credit applications, analyze deposit qualification and transaction volume, verify collateral, and disburse approved capital directly to client checking accounts.
          </p>
        </div>

        <div className="relative z-10 flex items-center gap-3">
          <button
            onClick={fetchLoans}
            disabled={isLoading}
            className="inline-flex items-center gap-2 px-4.5 py-2.5 rounded-xl bg-slate-800/90 hover:bg-slate-750 text-white font-bold text-sm border border-slate-700 transition-all cursor-pointer shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 text-amber-400 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refresh Queue</span>
          </button>
        </div>
      </div>

      {/* Blinking Alert Button / Banner When Loan Applications Are Received */}
      {pendingLoans.length > 0 && (
        <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-amber-500/15 via-rose-500/15 to-amber-500/15 border-2 border-amber-500/80 shadow-lg shadow-amber-500/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="relative flex h-4 w-4 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-90"></span>
              <span className="relative inline-flex rounded-full h-4 w-4 bg-rose-600"></span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-black text-slate-900 uppercase tracking-tight">
                  ACTION REQUIRED: {pendingLoans.length} LOAN APPLICATION{pendingLoans.length > 1 ? 'S' : ''} RECEIVED
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-600 text-white shadow-xs animate-pulse">
                  New Message
                </span>
              </div>
              <p className="text-xs font-bold text-slate-700 mt-0.5">
                Customer credit requests are awaiting compliance verification, deposit volume inspection, and capital disbursement.
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              const el = document.getElementById('admin-loans-queue');
              el?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="inline-flex items-center gap-2 px-4.5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black text-xs shadow-lg animate-pulse transition-all shrink-0 cursor-pointer"
            title="Click to view all pending loan messages"
          >
            <span className="w-2 h-2 rounded-full bg-white animate-ping"></span>
            <span>REVIEW {pendingLoans.length} PENDING LOAN{pendingLoans.length > 1 ? 'S' : ''}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`p-4 rounded-2xl border-2 flex items-center justify-between gap-3 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-500 text-emerald-950'
              : 'bg-rose-50 border-rose-500 text-rose-950'
          }`}
        >
          <div className="flex items-center gap-2 font-bold text-sm">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button onClick={() => setFeedback(null)} className="text-slate-500 hover:text-slate-800 p-1 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Overview Stat Cards (Crisp High-Contrast White Background) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-2 hover:border-slate-300 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase text-slate-500 tracking-wider">Pending Review</span>
            <Clock className="w-5 h-5 text-amber-500" />
          </div>
          <div className="text-2xl sm:text-3xl font-black text-slate-950 font-mono">{pendingLoans.length}</div>
          <p className="text-xs font-bold text-slate-600">Applications awaiting Monvera review</p>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-2 hover:border-slate-300 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase text-slate-500 tracking-wider">Active Facilities</span>
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          </div>
          <div className="text-2xl sm:text-3xl font-black text-emerald-700 font-mono">{activeLoans.length}</div>
          <p className="text-xs font-bold text-slate-600">Active credit lines disbursed</p>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-2 hover:border-slate-300 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase text-slate-500 tracking-wider">Total Disbursed</span>
            <DollarSign className="w-5 h-5 text-indigo-600" />
          </div>
          <div className="text-2xl sm:text-3xl font-black text-slate-950 font-mono">
            ${disbursedTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
          <p className="text-xs font-bold text-slate-600">Capital funded into client accounts</p>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-2 hover:border-slate-300 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase text-slate-500 tracking-wider">Total Pipeline</span>
            <Coins className="w-5 h-5 text-purple-600" />
          </div>
          <div className="text-2xl sm:text-3xl font-black text-slate-950 font-mono">
            ${totalRequested.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
          <p className="text-xs font-bold text-slate-600">All submitted loan applications</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-amber-100 text-amber-900 border border-amber-300 text-xs font-black uppercase tracking-wider">
            <Clock className="w-4 h-4 text-amber-700" />
            <span>Pending Action Queue ({filteredLoans.length})</span>
          </div>
          <span className="text-xs font-bold text-slate-500 hidden md:inline">
            Approved, rejected, & canceled loans automatically disappear from this terminal and update on the customer dashboard.
          </span>
        </div>

        <div className="relative min-w-[260px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search pending applications..."
            className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-10 pr-4 py-2 text-sm text-slate-900 focus:outline-none focus:border-amber-500 focus:bg-white font-bold placeholder:text-slate-400"
          />
        </div>
      </div>

      {/* Loan Applications Queue */}
      <div id="admin-loans-queue" className="space-y-5">
        {filteredLoans.length === 0 ? (
          <div className="bg-white border border-slate-200/90 rounded-2xl p-12 text-center space-y-3 shadow-xs">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <h3 className="text-lg font-black text-slate-950">All Applications Processed</h3>
            <p className="text-sm font-bold text-slate-500 max-w-md mx-auto">
              There are currently no pending credit requests awaiting administrative action. Approved, rejected, and canceled loans are automatically saved and updated on the customer dashboard.
            </p>
          </div>
        ) : (
          filteredLoans.map((loan) => {
            const userHistory = userLedgers[loan.userId];
            const isLedgerOpen = expandedLedgerLoanId === loan.id;
            const fixedInterestAmt = Number((loan.amount * 0.20).toFixed(2));
            const totalRepaymentAmt = Number((loan.amount * 1.20).toFixed(2));

            return (
              <div
                key={loan.id}
                className={`rounded-2xl p-6 sm:p-7 border-2 transition-all space-y-5 bg-white shadow-xs ${
                  loan.status === 'PENDING'
                    ? 'border-amber-400 bg-amber-50/15 shadow-md shadow-amber-500/5'
                    : loan.status === 'ACTIVE' || loan.status === 'APPROVED'
                    ? 'border-emerald-300 bg-emerald-50/15'
                    : 'border-slate-300 bg-slate-50/60 opacity-90'
                }`}
              >
                {/* Card Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4.5">
                  <div className="flex items-center gap-3.5">
                    <div className="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-amber-400 font-black text-lg shadow-xs">
                      {loan.applicantName.charAt(0)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <h3 className="text-lg sm:text-xl font-black text-slate-950 tracking-tight">{loan.applicantName}</h3>
                        <span className="text-xs font-mono font-black text-slate-800 bg-slate-100 px-2.5 py-0.5 rounded-lg border border-slate-200">
                          Acc: {loan.permanentAccountNumber}
                        </span>
                        {loan.status === 'PENDING' && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-600 text-white shadow-xs animate-pulse">
                            <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping"></span>
                            <span>New Message</span>
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-slate-600 font-bold block mt-0.5">{loan.applicantEmail}</span>
                    </div>
                  </div>

                  {/* Status and Action Buttons */}
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => setApproveModalLoan(loan)}
                        disabled={isProcessing}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs sm:text-sm shadow-md transition-all cursor-pointer disabled:opacity-50"
                      >
                        <Check className="w-4 h-4 stroke-[2.5]" />
                        <span>Approve & Disburse</span>
                      </button>

                      <button
                        onClick={() => {
                          setRejectModalLoan(loan);
                          setRejectionReason('Insufficient platform transaction volume or additional documentation required.');
                        }}
                        disabled={isProcessing}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-300 text-rose-700 font-black text-xs sm:text-sm transition-all cursor-pointer disabled:opacity-50"
                      >
                        <X className="w-4 h-4 stroke-[2.5]" />
                        <span>Decline</span>
                      </button>

                      <button
                        onClick={() => setCancelModalLoan(loan)}
                        disabled={isProcessing}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 font-bold text-xs sm:text-sm transition-all cursor-pointer disabled:opacity-50"
                        title="Cancel this application and remove from admin dashboard"
                      >
                        <Ban className="w-3.5 h-3.5 text-slate-600" />
                        <span>Cancel & Remove</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Financial & Monvera Metrics Grid (Crisp High-Contrast Numbers) */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-slate-50 border border-slate-200/90 p-4.5 rounded-2xl text-sm">
                  <div>
                    <span className="text-xs font-black text-slate-500 uppercase block tracking-wider">Requested Principal</span>
                    <span className="text-xl sm:text-2xl font-black text-amber-700 font-mono">
                      ${loan.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs font-black text-slate-500 uppercase block tracking-wider">Monthly Installment</span>
                    <span className="text-lg font-black text-slate-950 font-mono">
                      ${loan.monthlyPayment.toLocaleString('en-US')}/mo ({loan.termMonths} Mo)
                    </span>
                  </div>
                  <div>
                    <span className="text-xs font-black text-slate-500 uppercase block tracking-wider">Fixed 20% Interest</span>
                    <span className="text-lg font-black text-emerald-700 font-mono">
                      ${fixedInterestAmt.toLocaleString('en-US')} (20%)
                    </span>
                  </div>
                  <div>
                    <span className="text-xs font-black text-slate-500 uppercase block tracking-wider">Total Repayment Due</span>
                    <span className="text-lg font-black text-indigo-700 font-mono">
                      ${totalRepaymentAmt.toLocaleString('en-US')}
                    </span>
                  </div>
                </div>

                {/* Purpose & Details Write-Ups (High Legibility) */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-bold text-slate-700">
                  <div className="bg-slate-50 border border-slate-200/90 p-4 rounded-xl space-y-1.5">
                    <span className="text-slate-500 uppercase tracking-wider block font-black text-[11px]">Capital Objective:</span>
                    <p className="text-slate-950 text-sm font-extrabold leading-snug">{loan.purpose}</p>
                  </div>
                  <div className="bg-slate-50 border border-slate-200/90 p-4 rounded-xl space-y-1.5">
                    <span className="text-slate-500 uppercase tracking-wider block font-black text-[11px]">Business / Employment & Revenue:</span>
                    <p className="text-slate-800 text-sm font-bold leading-snug">
                      {loan.employmentOrBusinessDetails} (Est. Revenue: ${loan.annualIncomeOrRevenue?.toLocaleString('en-US') || 'N/A'}/yr)
                    </p>
                  </div>
                </div>

                {/* Rejection note if applicable */}
                {loan.status === 'REJECTED' && loan.rejectionReason && (
                  <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs font-bold text-rose-900">
                    <span className="font-black uppercase text-rose-800 block">Decline Compliance Note:</span>
                    <p className="mt-0.5">{loan.rejectionReason}</p>
                  </div>
                )}

                {/* Inspect Transaction Ledger & Deposit Qualification Button */}
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => handleToggleInspection(loan)}
                    className="w-full flex items-center justify-between p-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition-all cursor-pointer shadow-xs"
                  >
                    <div className="flex items-center gap-2">
                      <History className="w-4 h-4 text-cyan-400" />
                      <span>
                        {isLedgerOpen
                          ? 'Hide Applicant Transaction Ledger & Eligibility History'
                          : 'Inspect Applicant Transaction History & Deposit Ledger'}
                      </span>
                    </div>
                    {isLedgerOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>

                  {/* Expanded Transaction History Drawer */}
                  {isLedgerOpen && (
                    <div className="mt-3 p-5 rounded-2xl bg-slate-950 border border-slate-800 space-y-4 text-white">
                      {userHistory?.loading ? (
                        <div className="py-6 text-center text-xs font-bold text-slate-400 flex items-center justify-center gap-2">
                          <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" />
                          <span>Loading applicant transaction ledger...</span>
                        </div>
                      ) : (
                        <>
                          {/* Financial Standing Summary */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-900 p-3.5 rounded-xl border border-slate-800 text-xs">
                            <div>
                              <span className="text-slate-400 uppercase block font-bold">Checking Balance</span>
                              <span className="text-white font-mono font-black text-sm">
                                ${userHistory?.checkingBalance?.toLocaleString('en-US', { minimumFractionDigits: 2 }) || '0.00'}
                              </span>
                            </div>
                            <div>
                              <span className="text-slate-400 uppercase block font-bold">Savings Balance</span>
                              <span className="text-white font-mono font-black text-sm">
                                ${userHistory?.savingsBalance?.toLocaleString('en-US', { minimumFractionDigits: 2 }) || '0.00'}
                              </span>
                            </div>
                            <div>
                              <span className="text-slate-400 uppercase block font-bold">Lifetime Tx Volume</span>
                              <span className="text-cyan-400 font-mono font-black text-sm">
                                ${userHistory?.totalVolume?.toLocaleString('en-US', { minimumFractionDigits: 2 }) || '0.00'}
                              </span>
                            </div>
                            <div>
                              <span className="text-slate-400 uppercase block font-bold">Volume Qualification</span>
                              <span
                                className={`font-mono font-black text-xs px-2 py-0.5 rounded ${
                                  (userHistory?.totalVolume || 0) >= 10000
                                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                                    : (userHistory?.totalVolume || 0) >= 2000
                                    ? 'bg-blue-950 text-blue-300 border border-blue-500/40'
                                    : 'bg-amber-950 text-amber-300 border border-amber-500/40'
                                }`}
                              >
                                {(userHistory?.totalVolume || 0) >= 10000
                                  ? 'Prime Qualified ($20k+)'
                                  : (userHistory?.totalVolume || 0) >= 2000
                                  ? 'Tier 1 Qualified ($1k-$10k)'
                                  : 'Deposit Needed (< $2k)'}
                              </span>
                            </div>
                          </div>

                          {/* Transactions Table */}
                          {userHistory?.transactions && userHistory.transactions.length > 0 ? (
                            <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                              {userHistory.transactions.slice(0, 15).map((tx) => (
                                <div
                                  key={tx.id}
                                  className="flex items-center justify-between p-2.5 bg-slate-900/90 rounded-lg border border-slate-800 text-xs font-bold"
                                >
                                  <div className="flex items-center gap-2.5">
                                    <div
                                      className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                                        tx.type === 'DEPOSIT'
                                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-600/40'
                                          : tx.type === 'WITHDRAWAL'
                                          ? 'bg-amber-950 text-amber-400 border border-amber-600/40'
                                          : 'bg-blue-950 text-blue-400 border border-blue-600/40'
                                      }`}
                                    >
                                      {tx.type === 'DEPOSIT' ? (
                                        <ArrowDownLeft className="w-3.5 h-3.5" />
                                      ) : tx.type === 'WITHDRAWAL' ? (
                                        <ArrowUpRight className="w-3.5 h-3.5" />
                                      ) : (
                                        <Send className="w-3.5 h-3.5" />
                                      )}
                                    </div>
                                    <div>
                                      <div className="text-white font-black">{tx.description || tx.type}</div>
                                      <div className="text-[10px] text-slate-400 font-mono">
                                        Ref: {tx.referenceNumber} • {new Date(tx.createdAt).toLocaleDateString()}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="text-right">
                                    <div
                                      className={`font-mono font-black ${
                                        tx.type === 'DEPOSIT' ? 'text-emerald-400' : 'text-slate-200'
                                      }`}
                                    >
                                      {tx.type === 'DEPOSIT' ? '+' : '-'}${tx.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                    </div>
                                    <span
                                      className={`text-[9px] uppercase px-1.5 py-0.5 rounded font-black ${
                                        tx.status === 'COMPLETED'
                                          ? 'bg-emerald-950/80 text-emerald-400'
                                          : 'bg-amber-950/80 text-amber-400'
                                      }`}
                                    >
                                      {tx.status}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="py-4 text-center text-xs font-bold text-slate-400">
                              No prior transactions found on this account ledger.
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Audit Stamp */}
                <div className="flex justify-between items-center text-[11px] font-mono font-bold text-slate-500 pt-3 border-t border-slate-200">
                  <span>Facility ID: {loan.id}</span>
                  <span>Submitted: {new Date(loan.createdAt).toLocaleString()}</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Approve and Disburse Modal (Crisp High-Contrast White Background) */}
      {approveModalLoan && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border-2 border-emerald-500 rounded-3xl p-6 sm:p-8 max-w-lg w-full space-y-6 shadow-2xl text-slate-950">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 border border-emerald-300 flex items-center justify-center text-emerald-700">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-950">Confirm Loan Approval & Disbursement</h3>
                  <span className="text-xs text-emerald-700 font-mono font-bold">Immediate Credit Disbursement</span>
                </div>
              </div>
              <button
                onClick={() => setApproveModalLoan(null)}
                className="text-slate-400 hover:text-slate-700 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="p-4.5 rounded-2xl bg-emerald-50/70 border border-emerald-200 space-y-3 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-black text-slate-600 uppercase">Applicant:</span>
                  <span className="text-slate-950 font-black">{approveModalLoan.applicantName}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-black text-slate-600 uppercase">Account:</span>
                  <span className="text-emerald-800 font-mono font-black">{approveModalLoan.permanentAccountNumber}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-black text-slate-600 uppercase">Disbursement Amount:</span>
                  <span className="text-2xl font-black text-amber-700 font-mono">
                    ${approveModalLoan.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD
                  </span>
                </div>
                <div className="flex justify-between items-center border-t border-emerald-200 pt-2">
                  <span className="text-xs font-black text-slate-600 uppercase">Fixed 20% Interest:</span>
                  <span className="text-emerald-700 font-mono font-bold">
                    +${(approveModalLoan.amount * 0.20).toLocaleString('en-US', { minimumFractionDigits: 2 })} USD
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-black text-slate-600 uppercase">Total Repayment:</span>
                  <span className="text-indigo-800 font-mono font-black">
                    ${(approveModalLoan.amount * 1.20).toLocaleString('en-US', { minimumFractionDigits: 2 })} USD
                  </span>
                </div>
              </div>

              <p className="text-xs font-bold text-slate-600 leading-relaxed">
                By approving this credit facility, the funds will be instantly credited to the borrower's checking account balance and a confirmed loan transaction will be permanently recorded in the institutional ledger.
              </p>
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <button
                type="button"
                onClick={() => setApproveModalLoan(null)}
                disabled={isProcessing}
                className="px-4.5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-black transition-all cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApproveConfirm}
                disabled={isProcessing}
                className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-black shadow-lg transition-all cursor-pointer disabled:opacity-50 flex items-center gap-2"
              >
                {isProcessing ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Disbursing Capital...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 stroke-[2.5]" />
                    <span>Confirm & Disburse Funds</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Decline Reason Modal (Crisp High-Contrast White Background) */}
      {rejectModalLoan && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border-2 border-slate-300 rounded-3xl p-6 sm:p-8 max-w-lg w-full space-y-6 shadow-2xl text-slate-950">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-100 border border-rose-300 flex items-center justify-center text-rose-700">
                  <XCircle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-950">Decline Loan Application</h3>
                  <span className="text-xs text-slate-500 font-bold">{rejectModalLoan.applicantName} (${rejectModalLoan.amount.toLocaleString('en-US')})</span>
                </div>
              </div>
              <button
                onClick={() => setRejectModalLoan(null)}
                className="text-slate-400 hover:text-slate-700 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleRejectSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-black text-slate-700 uppercase tracking-wider block">
                  Compliance Decline Reason (Visible to Customer):
                </label>
                <textarea
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  rows={4}
                  required
                  placeholder="Explain why this loan application cannot be approved at this time..."
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3.5 text-sm text-slate-900 font-bold focus:outline-none focus:border-rose-500 placeholder:text-slate-400"
                />
              </div>

              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setRejectModalLoan(null)}
                  className="px-4.5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-black transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isProcessing}
                  className="px-6 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-black shadow-lg transition-all cursor-pointer disabled:opacity-50"
                >
                  {isProcessing ? 'Processing...' : 'Confirm Decline'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Cancel & Remove Application Modal */}
      {cancelModalLoan && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border-2 border-slate-400 rounded-3xl p-6 sm:p-8 max-w-lg w-full space-y-6 shadow-2xl text-slate-950">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-100 border border-rose-300 flex items-center justify-center text-rose-700">
                  <Ban className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-950">Cancel & Remove Loan Application</h3>
                  <span className="text-xs text-slate-500 font-mono font-bold">Remove from Admin Dashboard</span>
                </div>
              </div>
              <button
                onClick={() => setCancelModalLoan(null)}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 bg-slate-50 p-4 rounded-2xl border border-slate-200 text-sm">
              <p className="font-bold text-slate-800">
                Are you sure you want to cancel the loan application for{' '}
                <span className="font-black text-slate-950">{cancelModalLoan.applicantName}</span> (
                <span className="font-mono font-bold text-amber-700">${cancelModalLoan.amount.toLocaleString()}</span>)?
              </p>
              <p className="text-xs text-slate-600 font-semibold">
                This loan application will immediately disappear from your admin dashboard queue, and the customer dashboard will be updated with the cancellation notice.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setCancelModalLoan(null)}
                disabled={isProcessing}
                className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-black text-sm hover:bg-slate-100"
              >
                Go Back
              </button>
              <button
                type="button"
                onClick={handleCancelConfirm}
                disabled={isProcessing}
                className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-black text-sm shadow-md flex items-center gap-2"
              >
                {isProcessing ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Removing...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    <span>Confirm Cancel & Remove</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
