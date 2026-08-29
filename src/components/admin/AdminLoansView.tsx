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
  Filter,
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
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { firestoreSync } from '../../services/firestoreSync';
import { LoanApplication, LoanStatus, Transaction } from '../../types';

export const AdminLoansView: React.FC = () => {
  const { currentUser, refreshBalance } = useAuth();

  const [loans, setLoans] = useState<LoanApplication[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Approval Modal State
  const [approveModalLoan, setApproveModalLoan] = useState<LoanApplication | null>(null);

  // Rejection Modal State
  const [rejectModalLoan, setRejectModalLoan] = useState<LoanApplication | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string>('');
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
        setApproveModalLoan(null);
        fetchLoans();
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
        reason: rejectionReason || 'Application does not meet current transaction volume underwriting guidelines.',
        adminId: currentUser?.id || 'usr_admin',
      });

      if (res.success && res.loan) {
        setFeedback({
          type: 'success',
          message: `Loan ${rejectModalLoan.id} declined. Notice sent to applicant.`,
        });
        setRejectModalLoan(null);
        setRejectionReason('');
        fetchLoans();
      } else {
        setFeedback({ type: 'error', message: res.error || 'Failed to reject loan.' });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Error processing loan rejection.' });
    } finally {
      setIsProcessing(false);
    }
  };

  // Metrics
  const totalRequested = loans.reduce((sum, l) => sum + l.amount, 0);
  const pendingLoans = loans.filter((l) => l.status === 'PENDING');
  const activeLoans = loans.filter((l) => l.status === 'ACTIVE' || l.status === 'APPROVED');
  const disbursedTotal = activeLoans.reduce((sum, l) => sum + (l.disbursedAmount || l.amount), 0);

  // Filtered List
  const filteredLoans = loans.filter((loan) => {
    const matchesStatus =
      filterStatus === 'ALL' ||
      (filterStatus === 'PENDING' && loan.status === 'PENDING') ||
      (filterStatus === 'ACTIVE' && (loan.status === 'ACTIVE' || loan.status === 'APPROVED')) ||
      (filterStatus === 'REJECTED' && loan.status === 'REJECTED');

    const matchesSearch =
      loan.applicantName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      loan.applicantEmail.toLowerCase().includes(searchQuery.toLowerCase()) ||
      loan.permanentAccountNumber.includes(searchQuery) ||
      loan.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      loan.purpose.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesStatus && matchesSearch;
  });

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-mono font-black uppercase tracking-wider text-emerald-400 bg-emerald-950/60 px-3 py-1 rounded-lg border border-emerald-500/30 mb-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Institutional Credit & Underwriting Terminal</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
            Loan Underwriting & Review
          </h1>
          <p className="text-slate-400 text-sm sm:text-base font-bold mt-1">
            Review customer credit applications, verify live transaction history & deposit qualification, and disburse capital directly to checking accounts.
          </p>
        </div>

        <button
          onClick={fetchLoans}
          disabled={isLoading}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-sm border border-slate-700 transition-all cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh Queue</span>
        </button>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`p-4 rounded-2xl border-2 flex items-center justify-between gap-3 ${
            feedback.type === 'success'
              ? 'bg-emerald-950/80 border-emerald-500 text-emerald-200'
              : 'bg-red-950/80 border-red-500 text-red-200'
          }`}
        >
          <div className="flex items-center gap-2 font-bold text-sm">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button onClick={() => setFeedback(null)} className="text-slate-400 hover:text-white p-1">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Overview Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-850 border border-slate-750 rounded-2xl p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase text-slate-400 tracking-wider">Pending Review</span>
            <Clock className="w-5 h-5 text-amber-400" />
          </div>
          <div className="text-2xl sm:text-3xl font-black text-white font-mono">{pendingLoans.length}</div>
          <p className="text-xs font-bold text-slate-400">Applications awaiting underwriting</p>
        </div>

        <div className="bg-slate-850 border border-slate-750 rounded-2xl p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase text-slate-400 tracking-wider">Active Facilities</span>
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="text-2xl sm:text-3xl font-black text-emerald-400 font-mono">{activeLoans.length}</div>
          <p className="text-xs font-bold text-slate-400">Active credit lines disbursed</p>
        </div>

        <div className="bg-slate-850 border border-slate-750 rounded-2xl p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase text-slate-400 tracking-wider">Total Disbursed</span>
            <DollarSign className="w-5 h-5 text-cyan-400" />
          </div>
          <div className="text-2xl sm:text-3xl font-black text-white font-mono">
            ${disbursedTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
          <p className="text-xs font-bold text-slate-400">Capital funded into client accounts</p>
        </div>

        <div className="bg-slate-850 border border-slate-750 rounded-2xl p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase text-slate-400 tracking-wider">Total Pipeline</span>
            <Coins className="w-5 h-5 text-purple-400" />
          </div>
          <div className="text-2xl sm:text-3xl font-black text-white font-mono">
            ${totalRequested.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
          <p className="text-xs font-bold text-slate-400">All submitted loan applications</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-slate-850 border border-slate-750 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400 mr-1" />
          {(['ALL', 'PENDING', 'ACTIVE', 'REJECTED'] as const).map((status) => (
            <button
              key={status}
              onClick={() => setFilterStatus(status)}
              className={`px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
                filterStatus === status
                  ? 'bg-emerald-500 text-slate-950 shadow-md'
                  : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              {status}
            </button>
          ))}
        </div>

        <div className="relative min-w-[260px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, account, ID..."
            className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-4 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 font-bold"
          />
        </div>
      </div>

      {/* Loan Applications Queue */}
      <div className="space-y-4">
        {filteredLoans.length === 0 ? (
          <div className="bg-slate-850 border border-slate-750 rounded-2xl p-12 text-center space-y-3">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-slate-800 flex items-center justify-center text-slate-500">
              <Banknote className="w-7 h-7" />
            </div>
            <h3 className="text-lg font-black text-white">No Loan Applications in this Category</h3>
            <p className="text-sm font-bold text-slate-400">
              There are currently no credit requests matching your filter parameters.
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
                className={`rounded-2xl p-6 border-2 transition-all space-y-5 ${
                  loan.status === 'PENDING'
                    ? 'bg-slate-850 border-amber-500/50 shadow-lg shadow-amber-950/20'
                    : loan.status === 'ACTIVE' || loan.status === 'APPROVED'
                    ? 'bg-slate-850 border-emerald-500/50'
                    : 'bg-slate-850 border-slate-700/80 opacity-85'
                }`}
              >
                {/* Card Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-750 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-emerald-400 font-black text-lg">
                      {loan.applicantName.charAt(0)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg sm:text-xl font-black text-white">{loan.applicantName}</h3>
                        <span className="text-xs font-mono text-slate-400 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
                          Acc: {loan.permanentAccountNumber}
                        </span>
                      </div>
                      <span className="text-xs text-slate-400 font-bold">{loan.applicantEmail}</span>
                    </div>
                  </div>

                  {/* Status and Action Buttons */}
                  <div className="flex items-center gap-3">
                    {loan.status === 'PENDING' ? (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setApproveModalLoan(loan)}
                          disabled={isProcessing}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm shadow-md transition-all cursor-pointer disabled:opacity-50"
                        >
                          <Check className="w-4 h-4" />
                          <span>Approve & Disburse</span>
                        </button>

                        <button
                          onClick={() => {
                            setRejectModalLoan(loan);
                            setRejectionReason('Insufficient platform transaction volume or additional documentation required.');
                          }}
                          disabled={isProcessing}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-950/60 hover:bg-red-900 border border-red-500/40 text-red-200 font-black text-sm transition-all cursor-pointer disabled:opacity-50"
                        >
                          <X className="w-4 h-4" />
                          <span>Decline</span>
                        </button>
                      </div>
                    ) : loan.status === 'ACTIVE' || loan.status === 'APPROVED' ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-black uppercase text-emerald-300 bg-emerald-950/80 px-3.5 py-1.5 rounded-xl border border-emerald-500/50">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        Disbursed to Checking
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs font-black uppercase text-red-300 bg-red-950/80 px-3.5 py-1.5 rounded-xl border border-red-500/50">
                        <XCircle className="w-4 h-4 text-red-400" />
                        Declined by Compliance
                      </span>
                    )}
                  </div>
                </div>

                {/* Financial & Underwriting Metrics Grid (with 3-Card Clarity) */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-slate-900/60 p-4 rounded-xl border border-slate-750 text-sm">
                  <div>
                    <span className="text-xs font-bold text-slate-400 uppercase block">Requested Principal</span>
                    <span className="text-xl sm:text-2xl font-black text-amber-300 font-mono">
                      ${loan.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-400 uppercase block">Monthly Installment</span>
                    <span className="text-lg font-black text-white font-mono">
                      ${loan.monthlyPayment.toLocaleString('en-US')}/mo ({loan.termMonths} Mo)
                    </span>
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-400 uppercase block">Fixed 20% Interest</span>
                    <span className="text-lg font-black text-emerald-400 font-mono">
                      ${fixedInterestAmt.toLocaleString('en-US')} (20%)
                    </span>
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-400 uppercase block">Total Repayment Due</span>
                    <span className="text-lg font-black text-cyan-400 font-mono">
                      ${totalRepaymentAmt.toLocaleString('en-US')}
                    </span>
                  </div>
                </div>

                {/* Purpose & Details */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-bold text-slate-300">
                  <div className="space-y-1">
                    <span className="text-slate-400 uppercase tracking-wider block">Capital Objective:</span>
                    <p className="text-white text-sm font-extrabold">{loan.purpose}</p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-slate-400 uppercase tracking-wider block">Business / Employment & Revenue:</span>
                    <p className="text-slate-200">
                      {loan.employmentOrBusinessDetails} (Est. Revenue: ${loan.annualIncomeOrRevenue?.toLocaleString('en-US') || 'N/A'}/yr)
                    </p>
                  </div>
                </div>

                {/* Rejection note if applicable */}
                {loan.status === 'REJECTED' && loan.rejectionReason && (
                  <div className="p-3 bg-red-950/40 border border-red-500/30 rounded-xl text-xs font-bold text-red-300">
                    <span className="font-black uppercase text-red-200 block">Decline Compliance Note:</span>
                    <p className="mt-0.5">{loan.rejectionReason}</p>
                  </div>
                )}

                {/* Inspect Transaction Ledger & Deposit Qualification Button */}
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => handleToggleInspection(loan)}
                    className="w-full flex items-center justify-between p-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 font-bold text-xs transition-all cursor-pointer"
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
                    <div className="mt-3 p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-4">
                      {userHistory?.loading ? (
                        <div className="py-6 text-center text-xs font-bold text-slate-400 flex items-center justify-center gap-2">
                          <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" />
                          <span>Loading applicant transaction ledger...</span>
                        </div>
                      ) : (
                        <>
                          {/* Financial Standing Summary */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-900 p-3 rounded-lg border border-slate-800 text-xs">
                            <div>
                              <span className="text-slate-500 uppercase block font-bold">Checking Balance</span>
                              <span className="text-white font-mono font-black text-sm">
                                ${userHistory?.checkingBalance?.toLocaleString('en-US', { minimumFractionDigits: 2 }) || '0.00'}
                              </span>
                            </div>
                            <div>
                              <span className="text-slate-500 uppercase block font-bold">Savings Balance</span>
                              <span className="text-white font-mono font-black text-sm">
                                ${userHistory?.savingsBalance?.toLocaleString('en-US', { minimumFractionDigits: 2 }) || '0.00'}
                              </span>
                            </div>
                            <div>
                              <span className="text-slate-500 uppercase block font-bold">Lifetime Tx Volume</span>
                              <span className="text-cyan-400 font-mono font-black text-sm">
                                ${userHistory?.totalVolume?.toLocaleString('en-US', { minimumFractionDigits: 2 }) || '0.00'}
                              </span>
                            </div>
                            <div>
                              <span className="text-slate-500 uppercase block font-bold">Volume Qualification</span>
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
                                  className="flex items-center justify-between p-2.5 bg-slate-900/80 rounded-lg border border-slate-800 text-xs font-bold"
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
                                      <div className="text-[10px] text-slate-500 font-mono">
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
                                          ? 'bg-emerald-950/60 text-emerald-400'
                                          : 'bg-amber-950/60 text-amber-400'
                                      }`}
                                    >
                                      {tx.status}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="py-4 text-center text-xs font-bold text-slate-500">
                              No prior transactions found on this account ledger.
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Audit Stamp */}
                <div className="flex justify-between items-center text-[11px] font-mono text-slate-500 pt-2 border-t border-slate-750">
                  <span>Facility ID: {loan.id}</span>
                  <span>Submitted: {new Date(loan.createdAt).toLocaleString()}</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Approve and Disburse Modal */}
      {approveModalLoan && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border-2 border-emerald-500/50 rounded-3xl p-6 sm:p-8 max-w-lg w-full space-y-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-700 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-950 border border-emerald-500 flex items-center justify-center text-emerald-400">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-white">Confirm Loan Approval & Disbursement</h3>
                  <span className="text-xs text-emerald-400 font-mono">Immediate Credit Disbursement</span>
                </div>
              </div>
              <button
                onClick={() => setApproveModalLoan(null)}
                className="text-slate-400 hover:text-white p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-emerald-950/40 border border-emerald-500/30 space-y-3 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-slate-400 uppercase">Applicant:</span>
                  <span className="text-white font-black">{approveModalLoan.applicantName}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-slate-400 uppercase">Account:</span>
                  <span className="text-emerald-300 font-mono font-black">{approveModalLoan.permanentAccountNumber}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-slate-400 uppercase">Disbursement Amount:</span>
                  <span className="text-2xl font-black text-amber-300 font-mono">
                    ${approveModalLoan.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD
                  </span>
                </div>
                <div className="flex justify-between items-center border-t border-slate-800 pt-2">
                  <span className="text-xs font-bold text-slate-400 uppercase">Fixed 20% Interest:</span>
                  <span className="text-emerald-400 font-mono font-bold">
                    +${(approveModalLoan.amount * 0.20).toLocaleString('en-US', { minimumFractionDigits: 2 })} USD
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-slate-400 uppercase">Total Repayment:</span>
                  <span className="text-cyan-300 font-mono font-black">
                    ${(approveModalLoan.amount * 1.20).toLocaleString('en-US', { minimumFractionDigits: 2 })} USD
                  </span>
                </div>
              </div>

              <p className="text-xs font-bold text-slate-300 leading-relaxed">
                By approving this credit facility, the funds will be instantly credited to the borrower's checking account balance and a confirmed loan transaction will be permanently recorded in the institutional ledger.
              </p>
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <button
                type="button"
                onClick={() => setApproveModalLoan(null)}
                disabled={isProcessing}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-300 text-sm font-black transition-all cursor-pointer disabled:opacity-50"
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
                    <Check className="w-4 h-4" />
                    <span>Confirm & Disburse Funds</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Decline Reason Modal */}
      {rejectModalLoan && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border-2 border-slate-700 rounded-3xl p-6 sm:p-8 max-w-lg w-full space-y-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-700 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-red-950 border border-red-500 flex items-center justify-center text-red-400">
                  <XCircle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-white">Decline Loan Application</h3>
                  <span className="text-xs text-slate-400">{rejectModalLoan.applicantName} (${rejectModalLoan.amount.toLocaleString('en-US')})</span>
                </div>
              </div>
              <button
                onClick={() => setRejectModalLoan(null)}
                className="text-slate-400 hover:text-white p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleRejectSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-black text-slate-300 uppercase tracking-wider block">
                  Compliance Decline Reason (Visible to Customer):
                </label>
                <textarea
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  rows={4}
                  required
                  placeholder="Explain why this loan application cannot be approved at this time..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3.5 text-sm text-white font-bold focus:outline-none focus:border-red-500"
                />
              </div>

              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setRejectModalLoan(null)}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-300 text-sm font-black transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isProcessing}
                  className="px-6 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-black shadow-lg transition-all cursor-pointer disabled:opacity-50"
                >
                  {isProcessing ? 'Processing...' : 'Confirm Decline'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
