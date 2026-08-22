import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { Transaction } from '../../types';
import {
  Wallet,
  TrendingUp,
  Plus,
  Send,
  QrCode,
  Landmark,
  CreditCard,
  ArrowRight,
  ShieldCheck,
  Zap,
  ArrowUpRight,
  ArrowDownLeft,
  Clock,
  CheckCircle2,
  Copy,
  Check,
  Eye,
  EyeOff,
  Building2,
  Lock,
  Sparkles,
  FileText,
} from 'lucide-react';
import { TransactionReceiptModal } from './TransactionReceiptModal';
import { KycBanner } from '../kyc/KycBanner';
import { KycVerificationModal } from '../kyc/KycVerificationModal';

export const DashboardOverview: React.FC = () => {
  const { currentUser, balanceMetrics, openModal, setCurrentView } = useAuth();
  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>([]);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [hideBalances, setHideBalances] = useState<boolean>(false);
  const [copiedAcc, setCopiedAcc] = useState<boolean>(false);
  const [isKycModalOpen, setIsKycModalOpen] = useState<boolean>(false);

  useEffect(() => {
    async function loadTx() {
      if (currentUser) {
        const res = await api.getTransactions({ userId: currentUser.id });
        if (res.transactions) {
          setRecentTransactions(res.transactions.slice(0, 6));
        }
      }
    }
    loadTx();
  }, [currentUser, balanceMetrics]);

  if (!currentUser || !balanceMetrics) {
    return (
      <div className="p-12 text-center">
        <div className="w-10 h-10 border-4 border-emerald-600 border-t-transparent animate-spin rounded-full mx-auto" />
      </div>
    );
  }

  const handleCopyAccount = () => {
    navigator.clipboard.writeText(currentUser.permanentAccountNumber);
    setCopiedAcc(true);
    setTimeout(() => setCopiedAcc(false), 2000);
  };

  const isVerified = currentUser?.kycStatus === 'verified';

  const handleProtectedAction = (action: () => void) => {
    if (!isVerified) {
      setIsKycModalOpen(true);
    } else {
      action();
    }
  };

  const checkingAcc = balanceMetrics.accounts?.find((a) => a.type === 'CHECKING');
  const savingsAcc = balanceMetrics.accounts?.find((a) => a.type === 'SAVINGS');
  const investmentAcc = balanceMetrics.accounts?.find((a) => a.type === 'INVESTMENT');

  return (
    <div id="dashboard-overview-view" className="space-y-9 animate-in fade-in duration-150">
      
      {/* Top Welcome Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl sm:text-4xl font-black text-slate-950 tracking-tight">
            Welcome back, {currentUser.firstName}
          </h2>
          <p className="text-sm sm:text-base text-slate-800 font-bold mt-1">
            Your financial accounts, deposits, and investment holdings are active and fully secured.
          </p>
        </div>

        {/* Permanent Account Pill */}
        <div className="flex items-center gap-3 bg-white px-5 py-3 rounded-2xl border-2 border-slate-300 shadow-md">
          <div className="text-left">
            <span className="text-xs text-slate-900 font-mono block uppercase font-black tracking-wider">Permanent Account</span>
            <span className="text-base font-mono font-black text-slate-950">{currentUser.permanentAccountNumber}</span>
          </div>
          <button
            onClick={handleCopyAccount}
            className="p-2 hover:bg-slate-100 rounded-xl text-slate-800 hover:text-slate-950 transition-colors cursor-pointer border border-slate-200"
            title="Copy Account Number"
          >
            {copiedAcc ? <Check className="w-5 h-5 text-emerald-600 font-black" /> : <Copy className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* KYC Verification Callout Banner (Appears automatically for unverified/pending accounts) */}
      <KycBanner />

      {/* --- HERO BALANCE CARD (EXPANDED LENGTH & BOLD HIGH-CONTRAST TYPOGRAPHY) --- */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-7 sm:p-10 lg:p-12 text-white shadow-2xl border-4 border-slate-800">
        <div className="absolute top-0 right-0 w-[30rem] h-[30rem] bg-emerald-500/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="relative z-10 space-y-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-sm font-mono font-black text-slate-200 uppercase tracking-widest">
              <span>Total Net Worth / Balance</span>
              <button
                onClick={() => setHideBalances(!hideBalances)}
                className="text-slate-300 hover:text-white transition-colors cursor-pointer p-1.5 rounded-lg bg-slate-800/80 border border-slate-700"
                title={hideBalances ? 'Show Balances' : 'Hide Balances'}
              >
                {hideBalances ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <span className="text-xs sm:text-sm font-mono font-black px-4 py-1.5 rounded-full bg-emerald-950 text-emerald-300 border-2 border-emerald-500 shadow-inner">
              USD Currency
            </span>
          </div>

          {/* Primary Large Balance Display */}
          <div className="text-4xl sm:text-6xl lg:text-7xl font-black font-mono tracking-tight text-white select-none drop-shadow-md">
            {hideBalances ? (
              '••••••••••••'
            ) : (
              `$${balanceMetrics.totalBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
            )}
          </div>

          {/* Balance Breakdown Grid (3 Spacious Columns) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-6 border-t-2 border-slate-700/90">
            <div className="space-y-2 p-5 rounded-2xl bg-slate-900/90 border-2 border-slate-700 shadow-sm">
              <span className="text-xs sm:text-sm font-black uppercase tracking-wider text-slate-200 block font-mono">
                Liquid Operating Balance
              </span>
              <span className="text-2xl sm:text-3xl font-black font-mono text-white block">
                {hideBalances ? '••••••' : `$${balanceMetrics.availableBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
              </span>
              <span className="text-xs sm:text-sm text-slate-300 block font-bold">Checking + Savings Accounts</span>
            </div>

            <div className="space-y-2 p-5 rounded-2xl bg-slate-900/90 border-2 border-emerald-600/60 shadow-sm">
              <span className="text-xs sm:text-sm font-black uppercase tracking-wider text-emerald-300 block font-mono">
                Invested Capital (Locked)
              </span>
              <span className="text-2xl sm:text-3xl font-black font-mono text-emerald-300 block">
                {hideBalances ? '••••••' : `$${balanceMetrics.investedBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
              </span>
              <span className="text-xs sm:text-sm text-emerald-200 block font-bold">60-360D Term Sovereign Plans</span>
            </div>

            <div className="space-y-2 p-5 rounded-2xl bg-slate-900/90 border-2 border-amber-600/60 shadow-sm">
              <span className="text-xs sm:text-sm font-black uppercase tracking-wider text-amber-300 block font-mono">
                Total Accrued Interest & Profits
              </span>
              <span className="text-2xl sm:text-3xl font-black font-mono text-amber-300 block">
                {hideBalances ? '••••••' : `+$${balanceMetrics.accruedEarnings.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
              </span>
              <span className="text-xs sm:text-sm text-amber-200 block font-bold">Earned from 4.50% Daily Yield & Savings</span>
            </div>
          </div>
        </div>
      </div>

      {/* --- MAIN DASHBOARD ACTIONS (LARGE, SMART & PROFESSIONAL BUTTONS) --- */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-base font-black uppercase tracking-wider text-slate-950">Quick Banking Actions</div>
          {!isVerified && (
            <button
              onClick={() => setIsKycModalOpen(true)}
              className="inline-flex items-center gap-1.5 text-xs font-black text-amber-800 bg-amber-100 hover:bg-amber-200 border border-amber-300 px-3 py-1 rounded-full cursor-pointer transition-colors"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Actions Locked — Click to Verify</span>
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          
          <button
            id="action-btn-deposit"
            onClick={() => handleProtectedAction(() => openModal('deposit'))}
            className={`p-5 sm:p-6 rounded-3xl bg-white border-2 shadow-md hover:shadow-xl active:translate-y-1 transition-all text-center flex flex-col items-center justify-center gap-3 group cursor-pointer relative ${
              !isVerified
                ? 'border-amber-300 hover:border-amber-500 bg-amber-50/20'
                : 'hover:bg-emerald-50/90 border-slate-300 hover:border-emerald-600'
            }`}
          >
            {!isVerified && (
              <span className="absolute top-2.5 right-2.5 p-1 rounded-full bg-amber-100 text-amber-800 border border-amber-300" title="Locked - KYC Required">
                <Lock className="w-3.5 h-3.5" />
              </span>
            )}
            <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center group-hover:scale-110 group-hover:bg-emerald-600 group-hover:text-white transition-all shadow-sm">
              <Plus className="w-7 h-7 stroke-[3]" />
            </div>
            <div>
              <span className="text-base font-black text-slate-950 block">Deposit</span>
              <span className="text-xs text-slate-700 font-bold block">{!isVerified ? 'Locked (Verify)' : 'Add Funds'}</span>
            </div>
          </button>

          <button
            id="action-btn-send"
            onClick={() => handleProtectedAction(() => openModal('send'))}
            className={`p-5 sm:p-6 rounded-3xl bg-white border-2 shadow-md hover:shadow-xl active:translate-y-1 transition-all text-center flex flex-col items-center justify-center gap-3 group cursor-pointer relative ${
              !isVerified
                ? 'border-amber-300 hover:border-amber-500 bg-amber-50/20'
                : 'hover:bg-emerald-50/90 border-slate-300 hover:border-emerald-600'
            }`}
          >
            {!isVerified && (
              <span className="absolute top-2.5 right-2.5 p-1 rounded-full bg-amber-100 text-amber-800 border border-amber-300" title="Locked - KYC Required">
                <Lock className="w-3.5 h-3.5" />
              </span>
            )}
            <div className="w-14 h-14 rounded-2xl bg-slate-950 text-emerald-400 flex items-center justify-center group-hover:scale-110 group-hover:bg-emerald-600 group-hover:text-white transition-all shadow-sm">
              <Send className="w-6 h-6 stroke-[3]" />
            </div>
            <div>
              <span className="text-base font-black text-slate-950 block">Send Money</span>
              <span className="text-xs text-slate-700 font-bold block">{!isVerified ? 'Locked (Verify)' : 'Transfer Funds'}</span>
            </div>
          </button>

          <button
            id="action-btn-receive"
            onClick={() => handleProtectedAction(() => openModal('receive'))}
            className={`p-5 sm:p-6 rounded-3xl bg-white border-2 shadow-md hover:shadow-xl active:translate-y-1 transition-all text-center flex flex-col items-center justify-center gap-3 group cursor-pointer relative ${
              !isVerified
                ? 'border-amber-300 hover:border-amber-500 bg-amber-50/20'
                : 'hover:bg-slate-50 border-slate-300 hover:border-slate-500'
            }`}
          >
            {!isVerified && (
              <span className="absolute top-2.5 right-2.5 p-1 rounded-full bg-amber-100 text-amber-800 border border-amber-300" title="Locked - KYC Required">
                <Lock className="w-3.5 h-3.5" />
              </span>
            )}
            <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-900 flex items-center justify-center group-hover:scale-110 group-hover:bg-slate-950 group-hover:text-white transition-all shadow-sm">
              <QrCode className="w-6 h-6 stroke-[3]" />
            </div>
            <div>
              <span className="text-base font-black text-slate-950 block">Receive</span>
              <span className="text-xs text-slate-700 font-bold block">{!isVerified ? 'Locked (Verify)' : 'QR / Details'}</span>
            </div>
          </button>

          <button
            id="action-btn-withdraw"
            onClick={() => handleProtectedAction(() => openModal('withdraw'))}
            className={`p-5 sm:p-6 rounded-3xl bg-white border-2 shadow-md hover:shadow-xl active:translate-y-1 transition-all text-center flex flex-col items-center justify-center gap-3 group cursor-pointer relative ${
              !isVerified
                ? 'border-amber-300 hover:border-amber-500 bg-amber-50/20'
                : 'hover:bg-slate-50 border-slate-300 hover:border-slate-500'
            }`}
          >
            {!isVerified && (
              <span className="absolute top-2.5 right-2.5 p-1 rounded-full bg-amber-100 text-amber-800 border border-amber-300" title="Locked - KYC Required">
                <Lock className="w-3.5 h-3.5" />
              </span>
            )}
            <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-900 flex items-center justify-center group-hover:scale-110 group-hover:bg-slate-950 group-hover:text-white transition-all shadow-sm">
              <Landmark className="w-6 h-6 stroke-[3]" />
            </div>
            <div>
              <span className="text-base font-black text-slate-950 block">Withdraw</span>
              <span className="text-xs text-slate-700 font-bold block">{!isVerified ? 'Locked (Verify)' : 'ACH / Wire / Card'}</span>
            </div>
          </button>

          <button
            id="action-btn-invest"
            onClick={() => handleProtectedAction(() => setCurrentView('investments'))}
            className={`p-5 sm:p-6 rounded-3xl bg-white border-2 shadow-md hover:shadow-xl active:translate-y-1 transition-all text-center flex flex-col items-center justify-center gap-3 group cursor-pointer relative ${
              !isVerified
                ? 'border-amber-300 hover:border-amber-500 bg-amber-50/20'
                : 'hover:bg-emerald-50/90 border-slate-300 hover:border-emerald-600'
            }`}
          >
            {!isVerified && (
              <span className="absolute top-2.5 right-2.5 p-1 rounded-full bg-amber-100 text-amber-800 border border-amber-300" title="Locked - KYC Required">
                <Lock className="w-3.5 h-3.5" />
              </span>
            )}
            <div className="w-14 h-14 rounded-2xl bg-emerald-950 text-emerald-400 flex items-center justify-center group-hover:scale-110 group-hover:bg-emerald-600 group-hover:text-white transition-all shadow-sm">
              <TrendingUp className="w-6 h-6 stroke-[3]" />
            </div>
            <div>
              <span className="text-base font-black text-slate-950 block">Invest (4.50%)</span>
              <span className="text-xs text-emerald-800 font-black block">{!isVerified ? 'Locked (Verify)' : '60-360D Term'}</span>
            </div>
          </button>

          <button
            id="action-btn-cards"
            onClick={() => handleProtectedAction(() => setCurrentView('cards'))}
            className={`p-5 sm:p-6 rounded-3xl bg-white border-2 shadow-md hover:shadow-xl active:translate-y-1 transition-all text-center flex flex-col items-center justify-center gap-3 group cursor-pointer relative ${
              !isVerified
                ? 'border-amber-300 hover:border-amber-500 bg-amber-50/20'
                : 'hover:bg-slate-50 border-slate-300 hover:border-slate-500'
            }`}
          >
            {!isVerified && (
              <span className="absolute top-2.5 right-2.5 p-1 rounded-full bg-amber-100 text-amber-800 border border-amber-300" title="Locked - KYC Required">
                <Lock className="w-3.5 h-3.5" />
              </span>
            )}
            <div className="w-14 h-14 rounded-2xl bg-slate-950 text-white flex items-center justify-center group-hover:scale-110 group-hover:bg-slate-800 transition-all shadow-sm">
              <CreditCard className="w-6 h-6 stroke-[3]" />
            </div>
            <div>
              <span className="text-base font-black text-slate-950 block">Cards</span>
              <span className="text-xs text-slate-700 font-bold block">{!isVerified ? 'Locked (Verify)' : 'Manage Debit'}</span>
            </div>
          </button>

        </div>
      </div>

      {/* --- ACCOUNT SUMMARY (ACCOUNTS & BALANCES SECTION) --- */}
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xl sm:text-2xl font-black text-slate-950">Account Summary & Balances</h3>
            <p className="text-xs sm:text-sm text-slate-800 font-bold">
              Institutional segregation across Checking, High-Yield Savings, and Term Investment portfolios.
            </p>
          </div>
          <button
            onClick={() => setCurrentView('accounts')}
            className="text-xs sm:text-sm font-black text-emerald-800 hover:text-emerald-950 hover:underline flex items-center gap-1.5 bg-emerald-50 px-3.5 py-2 rounded-xl border border-emerald-300"
          >
            <span>Manage All Accounts</span>
            <ArrowRight className="w-4 h-4 font-black" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Card 1: Premier Checking Account */}
          <div className="p-6 sm:p-7 rounded-3xl bg-white border-2 border-slate-300 shadow-md space-y-5 flex flex-col justify-between hover:border-slate-400 transition-all">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-2xl bg-slate-950 text-white flex items-center justify-center shadow-sm">
                  <Wallet className="w-6 h-6" />
                </div>
                <span className="text-xs uppercase font-black text-emerald-900 bg-emerald-100 px-3 py-1 rounded-full border border-emerald-300">
                  CHECKING ACCOUNT
                </span>
              </div>
              <div>
                <h4 className="font-black text-slate-950 text-lg">Premier Checking Account</h4>
                <div className="text-xs font-mono font-bold text-slate-700 mt-0.5">
                  MVB •••• {currentUser.permanentAccountNumber.slice(-4)}
                </div>
                <p className="text-xs text-slate-800 font-medium mt-1">
                  Primary liquid operating account for day-to-day spending, card transactions, wires, and peer payments.
                </p>
              </div>
            </div>

            <div className="pt-3 border-t-2 border-slate-200 space-y-1">
              <div className="text-xs text-slate-700 font-black uppercase tracking-wider font-mono">Available Checking Balance</div>
              <div className="text-2xl sm:text-3xl font-black font-mono text-slate-950">
                {hideBalances ? '••••••' : `$${balanceMetrics.checkingBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
              </div>
            </div>
          </div>

          {/* Card 2: High-Yield Treasury Savings Account (Clearly positioned as Savings Account) */}
          <div className="p-6 sm:p-7 rounded-3xl bg-gradient-to-b from-emerald-50/90 to-white border-2 border-emerald-500 shadow-md space-y-5 flex flex-col justify-between ring-2 ring-emerald-500/20">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-sm">
                  <Landmark className="w-6 h-6" />
                </div>
                <span className="text-xs uppercase font-black text-emerald-950 bg-emerald-200 px-3 py-1 rounded-full border border-emerald-400 shadow-xs">
                  SAVINGS ACCOUNT • 4.85% APY
                </span>
              </div>
              <div>
                <h4 className="font-black text-slate-950 text-lg">High-Yield Treasury Savings</h4>
                <div className="text-xs font-mono font-bold text-emerald-900 mt-0.5">
                  MVB •••• {savingsAcc?.accountNumber.slice(-4) || '9991'}
                </div>
                <p className="text-xs text-slate-800 font-medium mt-1">
                  High-yield savings account earning 4.85% APY compound interest daily with full instant liquidity.
                </p>
              </div>
            </div>

            <div className="pt-3 border-t-2 border-emerald-200 space-y-1">
              <div className="text-xs text-emerald-900 font-black uppercase tracking-wider font-mono">Current Savings Balance</div>
              <div className="text-2xl sm:text-3xl font-black font-mono text-emerald-950">
                {hideBalances ? '••••••' : `$${balanceMetrics.savingsBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
              </div>
            </div>
          </div>

          {/* Card 3: Capital Term Investments */}
          <div className="p-6 sm:p-7 rounded-3xl bg-white border-2 border-slate-300 shadow-md space-y-5 flex flex-col justify-between hover:border-slate-400 transition-all">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-2xl bg-slate-950 text-emerald-400 flex items-center justify-center shadow-sm">
                  <TrendingUp className="w-6 h-6" />
                </div>
                <span className="text-xs uppercase font-black text-slate-900 bg-slate-200 px-3 py-1 rounded-full border border-slate-300">
                  INVESTMENT PORTFOLIO
                </span>
              </div>
              <div>
                <h4 className="font-black text-slate-950 text-lg">Capital Term Investments</h4>
                <div className="text-xs font-mono font-bold text-slate-700 mt-0.5">
                  Active Sovereign Terms (60-360D)
                </div>
                <p className="text-xs text-slate-800 font-medium mt-1">
                  Fixed sovereign term contracts generating guaranteed 4.50% fixed daily interest (credited every 24 hours) until maturity.
                </p>
              </div>
            </div>

            <div className="pt-3 border-t-2 border-slate-200 space-y-1">
              <div className="text-xs text-slate-700 font-black uppercase tracking-wider font-mono">Total Invested Principal</div>
              <div className="text-2xl sm:text-3xl font-black font-mono text-emerald-700">
                {hideBalances ? '••••••' : `$${balanceMetrics.investedBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* --- RECENT TRANSACTIONS LEDGER FEED --- */}
      <div className="space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="text-xl sm:text-2xl font-black text-slate-950">Recent Transaction History</h3>
              <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-900 border border-emerald-300">
                Live Feed
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-800 font-bold mt-0.5">
              Verified records of incoming credits, debits, peer transfers, and deposits with immutable reference hashes.
            </p>
          </div>
          <button
            onClick={() => setCurrentView('transactions')}
            className="text-xs sm:text-sm font-black text-sky-800 hover:text-sky-950 hover:underline flex items-center gap-1.5 bg-sky-50 hover:bg-sky-100 px-4 py-2 rounded-xl border border-sky-300 transition-colors shrink-0"
          >
            <span>View All & Filter</span>
            <ArrowRight className="w-4 h-4 font-black" />
          </button>
        </div>

        <div className="bg-white rounded-3xl border-2 border-slate-300 shadow-md overflow-hidden">
          {recentTransactions.length === 0 ? (
            <div className="p-12 text-center text-sm text-slate-600 font-bold">
              Your transaction history will appear here as soon as transactions occur.
            </div>
          ) : (
            <div className="divide-y-2 divide-slate-100">
              {recentTransactions.map((tx) => {
                const isIncoming =
                  tx.recipientUserId === currentUser.id && tx.senderUserId !== currentUser.id;
                const isDeposit =
                  tx.type === 'DEPOSIT' ||
                  tx.type === 'ADMIN_DEVELOPMENT_FUNDING' ||
                  tx.type === 'INVESTMENT_EARNING' ||
                  tx.type === 'INVESTMENT_MATURITY';
                const isCredit = isIncoming || isDeposit;

                const dateObj = new Date(tx.createdAt);
                const formattedDate = dateObj.toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                });
                const formattedTime = dateObj.toLocaleTimeString('en-US', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                  hour12: true,
                });

                const partyName = isCredit
                  ? tx.senderName || (tx.type === 'DEPOSIT' ? 'Direct ACH Infusion' : 'Authorized Sender')
                  : tx.recipientName || (tx.type === 'WITHDRAWAL' ? 'External Institution' : 'Commercial Merchant');

                return (
                  <div
                    key={tx.id}
                    onClick={() => setSelectedTx(tx)}
                    className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50 transition-colors cursor-pointer group"
                  >
                    {/* Left Details */}
                    <div className="flex items-start sm:items-center gap-4 min-w-0">
                      <div
                        className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-sm transition-transform group-hover:scale-105 ${
                          isCredit
                            ? 'bg-emerald-100 text-emerald-800 border-2 border-emerald-300'
                            : 'bg-slate-100 text-slate-900 border-2 border-slate-200'
                        }`}
                      >
                        {isCredit ? (
                          <ArrowDownLeft className="w-6 h-6 stroke-[2.5]" />
                        ) : (
                          <ArrowUpRight className="w-6 h-6 stroke-[2.5]" />
                        )}
                      </div>

                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-base font-black text-slate-950 group-hover:text-sky-700 transition-colors truncate">
                            {tx.description}
                          </span>
                          <span
                            className={`text-[11px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider ${
                              isCredit
                                ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                                : 'bg-slate-200 text-slate-900'
                            }`}
                          >
                            {isCredit ? 'Credit' : 'Debit'}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-700 font-bold">
                          <span className="text-slate-900">
                            {isCredit ? `From: ${partyName}` : `To: ${partyName}`}
                          </span>
                          <span>•</span>
                          <span className="text-slate-600 font-mono">{tx.referenceNumber}</span>
                        </div>

                        <div className="flex items-center space-x-1 text-xs text-slate-600 font-bold">
                          <Clock className="w-3.5 h-3.5 text-sky-700" />
                          <span>{formattedDate} at {formattedTime}</span>
                        </div>
                      </div>
                    </div>

                    {/* Right Amount & Receipt Button */}
                    <div className="flex items-center justify-between sm:justify-end sm:space-x-4 pl-16 sm:pl-0">
                      <div className="text-left sm:text-right space-y-0.5">
                        <div
                          className={`text-lg sm:text-xl font-black font-mono tracking-tight ${
                            isCredit ? 'text-emerald-700' : 'text-slate-950'
                          }`}
                        >
                          {isCredit ? '+' : '-'}$
                          {tx.amount.toLocaleString('en-US', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                          <span className="text-xs text-slate-700 font-sans ml-1">USD</span>
                        </div>
                        <span className="inline-block text-[10px] uppercase font-black text-emerald-950 bg-emerald-100 px-2 py-0.5 rounded-full border border-emerald-300 font-mono">
                          {tx.status}
                        </span>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedTx(tx);
                        }}
                        className="px-3.5 py-2 rounded-xl text-xs font-black text-sky-800 bg-sky-50 hover:bg-sky-100 border border-sky-300 flex items-center space-x-1.5 shadow-2xs transition-colors shrink-0 cursor-pointer"
                      >
                        <FileText className="w-4 h-4" />
                        <span>Receipt</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Official Transaction Receipt Modal */}
      {selectedTx && (
        <TransactionReceiptModal
          transaction={selectedTx}
          currentUser={currentUser}
          onClose={() => setSelectedTx(null)}
        />
      )}

      {/* KYC Verification Modal */}
      <KycVerificationModal
        isOpen={isKycModalOpen}
        onClose={() => setIsKycModalOpen(false)}
      />

    </div>
  );
};

