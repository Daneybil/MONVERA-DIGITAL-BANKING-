import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { InvestmentPlan, InvestmentTermDays } from '../../types';
import confetti from 'canvas-confetti';
import {
  TrendingUp,
  Clock,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Plus,
  ArrowRight,
  Sparkles,
  Lock,
  FastForward,
  Layers,
  HelpCircle,
  Info,
  DollarSign,
  Calendar,
  Zap,
  FileCheck,
  Share2,
  Filter,
  Search,
  ArrowUpDown,
  Download,
  Check,
} from 'lucide-react';
import { InvestmentReceiptModal } from './InvestmentReceiptModal';
import { InvestmentShareModal } from './InvestmentShareModal';
import { InvestmentAccrualModal } from './InvestmentAccrualModal';

const SUPPORTED_TERMS: { termDays: InvestmentTermDays; dailyRate: number; planName: string; minAmount: number }[] = [
  { termDays: 60, dailyRate: 4.5, planName: 'Monvera 60-Day Term Plan', minAmount: 100 },
  { termDays: 90, dailyRate: 4.5, planName: 'Monvera 90-Day Term Plan', minAmount: 100 },
  { termDays: 120, dailyRate: 4.5, planName: 'Monvera 120-Day Term Plan', minAmount: 100 },
  { termDays: 150, dailyRate: 4.5, planName: 'Monvera 150-Day Term Plan', minAmount: 100 },
  { termDays: 180, dailyRate: 4.5, planName: 'Monvera 180-Day Term Plan', minAmount: 100 },
  { termDays: 210, dailyRate: 4.5, planName: 'Monvera 210-Day Term Plan', minAmount: 100 },
  { termDays: 240, dailyRate: 4.5, planName: 'Monvera 240-Day Term Plan', minAmount: 100 },
  { termDays: 270, dailyRate: 4.5, planName: 'Monvera 270-Day Term Plan', minAmount: 100 },
  { termDays: 300, dailyRate: 4.5, planName: 'Monvera 300-Day Term Plan', minAmount: 100 },
  { termDays: 330, dailyRate: 4.5, planName: 'Monvera 330-Day Term Plan', minAmount: 100 },
  { termDays: 360, dailyRate: 4.5, planName: 'Monvera 360-Day Term Plan', minAmount: 100 },
];

export const InvestmentsView: React.FC = () => {
  const { currentUser, balanceMetrics, refreshBalance, refreshNotifications } = useAuth();
  const [investments, setInvestments] = useState<InvestmentPlan[]>([]);
  const [selectedPlanDays, setSelectedPlanDays] = useState<InvestmentTermDays>(180);
  const [principalAmount, setPrincipalAmount] = useState<string>('1000');
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isFastForwarding, setIsFastForwarding] = useState<string | null>(null);
  const [earlyWithdrawalNotice, setEarlyWithdrawalNotice] = useState<string | null>(null);

  // Receipt, Share & Accrual Schedule Modals
  const [receiptInv, setReceiptInv] = useState<InvestmentPlan | null>(null);
  const [shareInv, setShareInv] = useState<InvestmentPlan | null>(null);
  const [accrualModalInv, setAccrualModalInv] = useState<InvestmentPlan | null>(null);

  // Live 1-Second Real-Time Ticker for 24h cycle countdown
  const [currentTime, setCurrentTime] = useState<number>(Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // History Filters & Search
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'MATURED'>('ALL');
  const [durationFilter, setDurationFilter] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<'NEWEST' | 'OLDEST' | 'AMOUNT_DESC' | 'YIELD_DESC'>('NEWEST');

  useEffect(() => {
    async function loadData() {
      if (currentUser) {
        const invRes = await api.getInvestments(currentUser.id);
        if (invRes.investments) {
          setInvestments(invRes.investments);
        }
      }
    }
    loadData();
  }, [currentUser, balanceMetrics]);

  if (!currentUser || !balanceMetrics) return null;

  const activePlan = SUPPORTED_TERMS.find((p) => p.termDays === selectedPlanDays) || SUPPORTED_TERMS[4];

  const principalNum = parseFloat(principalAmount) || 0;
  const fixedDailyRate = 4.5; // 4.5% every 24 hours
  const dailyInterest = Number((principalNum * (fixedDailyRate / 100)).toFixed(2));
  const expectedReturn = Number((dailyInterest * activePlan.termDays).toFixed(2));
  const totalAtMaturity = Number((principalNum + expectedReturn).toFixed(2));

  // Compute active investments stats and live accrued profits
  const activeInvestments = investments.filter((i) => i.status === 'ACTIVE');
  const totalDailyAccrual = activeInvestments.reduce((acc, curr) => acc + curr.amount * 0.045, 0);
  const totalProjectedAccrual = activeInvestments.reduce((acc, curr) => acc + curr.expectedYield, 0);

  const totalAccruedProfitLive = activeInvestments.reduce((acc, inv) => {
    const elapsed = Math.max(0, currentTime - new Date(inv.startDate).getTime());
    const cycles = Math.min(inv.termDays, Math.floor(elapsed / (24 * 60 * 60 * 1000)));
    return acc + cycles * (inv.amount * 0.045);
  }, 0);

  const handleCreateInvestment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (principalNum < 100) {
      setFeedbackMsg({
        type: 'error',
        text: 'Minimum investment amount is $100.00.',
      });
      return;
    }

    if (principalNum > balanceMetrics.checkingBalance) {
      setFeedbackMsg({
        type: 'error',
        text: `Insufficient checking balance ($${balanceMetrics.checkingBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}). Please deposit funds to your checking account first.`,
      });
      return;
    }

    setIsCreating(true);
    setFeedbackMsg(null);

    try {
      const res = await api.createInvestment({
        userId: currentUser.id,
        termDays: selectedPlanDays,
        amount: principalNum,
      });

      if (res.success && res.investment) {
        setFeedbackMsg({
          type: 'success',
          text: `Success! $${principalNum.toLocaleString('en-US', { minimumFractionDigits: 2 })} locked for ${selectedPlanDays} Days at 4.50% interest every 24 hours.`,
        });
        setInvestments((prev) => [res.investment!, ...prev]);
        await refreshBalance();
        await refreshNotifications();
        confetti({
          particleCount: 85,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#10b981', '#059669', '#f59e0b', '#3b82f6'],
        });
      } else {
        setFeedbackMsg({
          type: 'error',
          text: res.error || 'Failed to initialize term investment.',
        });
      }
    } catch (err: any) {
      setFeedbackMsg({
        type: 'error',
        text: 'Network error while locking term investment.',
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleFastForwardMaturity = async (invId: string) => {
    setIsFastForwarding(invId);
    try {
      const res = await api.matureInvestment(invId);
      if (res.success) {
        setFeedbackMsg({
          type: 'success',
          text: `Term investment matured! Principal and full 4.50% daily interest returned to your Checking Account.`,
        });
        const invRes = await api.getInvestments(currentUser.id);
        if (invRes.investments) setInvestments(invRes.investments);
        await refreshBalance();
        await refreshNotifications();
        confetti({
          particleCount: 100,
          spread: 80,
          origin: { y: 0.5 },
          colors: ['#10b981', '#34d399', '#fbbf24'],
        });
      }
    } catch (err) {
      setFeedbackMsg({ type: 'error', text: 'Failed to mature investment.' });
    } finally {
      setIsFastForwarding(null);
    }
  };

  // Filter and Sort Investments
  const filteredInvestments = useMemo(() => {
    return investments
      .filter((inv) => {
        // Status filter
        if (statusFilter !== 'ALL' && inv.status !== statusFilter) return false;
        // Duration filter
        if (durationFilter !== 'ALL' && inv.termDays.toString() !== durationFilter) return false;
        // Search query
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchName = inv.planName.toLowerCase().includes(q);
          const matchId = inv.id.toLowerCase().includes(q);
          const matchAmt = inv.amount.toString().includes(q);
          if (!matchName && !matchId && !matchAmt) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'NEWEST') {
          return new Date(b.startDate).getTime() - new Date(a.startDate).getTime();
        }
        if (sortBy === 'OLDEST') {
          return new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
        }
        if (sortBy === 'AMOUNT_DESC') {
          return b.amount - a.amount;
        }
        if (sortBy === 'YIELD_DESC') {
          return b.expectedYield - a.expectedYield;
        }
        return 0;
      });
  }, [investments, statusFilter, durationFilter, searchQuery, sortBy]);

  return (
    <div id="investments-hub-view" className="space-y-10 animate-in fade-in duration-150">
      
      {/* Top Header Section */}
      <div className="space-y-6">
        <div className="p-6 sm:p-8 rounded-3xl bg-slate-900 border-2 border-slate-700 shadow-2xl text-white space-y-4">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-emerald-950 text-emerald-300 border-2 border-emerald-500 text-xs sm:text-sm font-black tracking-wide">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Investment Treasury Guaranteed</span>
          </div>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black text-white tracking-tight">
            Fixed Term Investment Engine
          </h1>
          <p className="text-base sm:text-lg lg:text-xl font-extrabold text-slate-200 leading-relaxed max-w-4xl">
            Institutional term commitment from 60 to 360 days with fixed 4.5% interest rate every 24 hours.
          </p>
        </div>

        {/* Large Prominent Rectangular 3D Card: TOTAL INVESTED CAPITAL */}
        <div
          id="total-invested-capital-box"
          className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-slate-950 via-slate-900 to-emerald-950 p-6 sm:p-8 border-3 border-emerald-500 shadow-2xl text-white"
        >
          {/* Subtle glow background */}
          <div className="absolute top-0 right-0 w-80 h-80 bg-emerald-500/15 rounded-full blur-3xl pointer-events-none" />

          <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="space-y-3">
              <div className="flex items-center gap-2.5">
                <div className="w-12 h-12 rounded-2xl bg-emerald-600 border-2 border-emerald-400 text-white flex items-center justify-center shadow-lg font-black">
                  <TrendingUp className="w-6 h-6" />
                </div>
                <div>
                  <span className="text-xs sm:text-sm uppercase font-mono text-emerald-400 block font-black tracking-widest">
                    Total Invested Capital
                  </span>
                  <div className="inline-flex items-center gap-1.5 text-xs text-slate-300 font-extrabold">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span>Fixed 4.50% / 24 Hours Active Engine</span>
                  </div>
                </div>
              </div>

              {/* Huge Bold Amount */}
              <div className="text-4xl sm:text-5xl lg:text-6xl font-black font-mono text-white tracking-tight drop-shadow-md">
                ${balanceMetrics.investedBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
            </div>

            {/* Quick Metrics Sub-Box */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-950/80 p-4 sm:p-5 rounded-2xl border-2 border-slate-700 font-mono">
              <div className="space-y-0.5">
                <span className="text-[11px] uppercase text-slate-400 font-bold block">
                  Active Contracts
                </span>
                <span className="text-lg sm:text-xl font-black text-white">
                  {activeInvestments.length} {activeInvestments.length === 1 ? 'Plan' : 'Plans'}
                </span>
              </div>
              <div className="space-y-0.5">
                <span className="text-[11px] uppercase text-emerald-400 font-bold block">
                  Accrued Profit So Far
                </span>
                <span className="text-lg sm:text-xl font-black text-emerald-400">
                  +${totalAccruedProfitLive.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="space-y-0.5">
                <span className="text-[11px] uppercase text-slate-400 font-bold block">
                  Daily Yield (24h)
                </span>
                <span className="text-lg sm:text-xl font-black text-emerald-400">
                  +${totalDailyAccrual.toLocaleString('en-US', { minimumFractionDigits: 2 })}/d
                </span>
              </div>
              <div className="space-y-0.5">
                <span className="text-[11px] uppercase text-slate-400 font-bold block">
                  Projected Profits
                </span>
                <span className="text-lg sm:text-xl font-black text-emerald-400">
                  +${totalProjectedAccrual.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main 3D Investment Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* Left Form: Plan Selector & Principal (7 cols) */}
        <div className="lg:col-span-7 bg-white rounded-3xl p-6 sm:p-8 border-2 border-slate-300 shadow-2xl space-y-6">
          <div className="flex items-center justify-between border-b-2 border-slate-100 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-slate-950 text-emerald-400 border-2 border-emerald-500 flex items-center justify-center shadow-md">
                <Plus className="w-5 h-5" />
              </div>
              <h2 className="text-2xl sm:text-3xl font-black text-slate-950">
                Open New Term Investment
              </h2>
            </div>
            <span className="text-sm font-mono font-black text-emerald-950 bg-emerald-100 px-3.5 py-1.5 rounded-xl border-2 border-emerald-400 shadow-xs">
              60 – 360 Days
            </span>
          </div>

          {feedbackMsg && (
            <div
              className={`p-4 sm:p-5 rounded-2xl text-sm sm:text-base font-extrabold flex items-start gap-3 border-2 shadow-md ${
                feedbackMsg.type === 'success'
                  ? 'bg-emerald-100 border-emerald-500 text-emerald-950'
                  : 'bg-red-100 border-red-500 text-red-950'
              }`}
            >
              {feedbackMsg.type === 'success' ? (
                <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-emerald-700 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 flex-shrink-0 text-red-700 mt-0.5" />
              )}
              <span>{feedbackMsg.text}</span>
            </div>
          )}

          <form onSubmit={handleCreateInvestment} className="space-y-6">
            
            {/* Term Plans Selection 3D Buttons */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-black uppercase tracking-wider text-slate-900 font-mono">
                  Select Investment Duration (60 to 360 Days)
                </label>
                <span className="text-xs font-black text-emerald-700 font-mono">
                  Fixed 4.50% / 24 Hours
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {SUPPORTED_TERMS.map((plan) => {
                  const isSelected = selectedPlanDays === plan.termDays;
                  return (
                    <button
                      key={plan.termDays}
                      type="button"
                      onClick={() => setSelectedPlanDays(plan.termDays)}
                      className={`p-3.5 rounded-2xl border-2 text-left transition-all relative overflow-hidden cursor-pointer ${
                        isSelected
                          ? 'border-emerald-600 bg-emerald-50 text-slate-950 shadow-lg ring-2 ring-emerald-500 scale-[1.02]'
                          : 'border-slate-300 bg-slate-50 hover:bg-white hover:border-slate-400 text-slate-900'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-base font-black text-slate-950 font-mono">
                          {plan.termDays} Days
                        </span>
                        <span className="text-xs font-black text-emerald-900 bg-emerald-200 border border-emerald-400 px-1.5 py-0.5 rounded-md font-mono">
                          4.5% / 24h
                        </span>
                      </div>
                      <span className="text-xs font-extrabold text-slate-700 block font-mono">
                        Min ${plan.minAmount}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Principal Input with Minimum $100 */}
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-sm">
                <label className="font-black uppercase tracking-wider text-slate-900 font-mono">
                  Investment Capital Amount (USD)
                </label>
                <span className="text-slate-800 font-mono font-bold text-xs sm:text-sm">
                  Available in Checking: <strong className="text-emerald-700 font-black">${balanceMetrics.checkingBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong>
                </span>
              </div>

              <div className="relative">
                <span className="absolute left-4 top-3 text-2xl font-black text-slate-400 font-mono">$</span>
                <input
                  type="number"
                  min="100"
                  max="5000000"
                  step="50"
                  required
                  value={principalAmount}
                  onChange={(e) => setPrincipalAmount(e.target.value)}
                  className="w-full pl-10 pr-20 py-3.5 text-2xl font-black font-mono rounded-2xl border-2 border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50 text-slate-950 shadow-inner"
                  placeholder="100"
                />
                <span className="absolute right-4 top-4 text-sm font-black font-mono text-slate-500 uppercase">
                  USD
                </span>
              </div>

              {/* Quick Amount Pills - Starting from Min $100 */}
              <div className="flex flex-wrap gap-2 pt-1">
                {[100, 500, 1000, 5000, 10000, 25000].map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setPrincipalAmount(amt.toString())}
                    className="px-3 py-1.5 rounded-xl text-xs font-mono font-black text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-300 transition-colors cursor-pointer"
                  >
                    +${amt >= 1000 ? `${amt / 1000}k` : amt}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setPrincipalAmount(Math.floor(balanceMetrics.checkingBalance).toString())}
                  className="px-3 py-1.5 rounded-xl text-xs font-mono font-black text-emerald-900 bg-emerald-100 hover:bg-emerald-200 border-2 border-emerald-400 transition-colors cursor-pointer"
                >
                  Max Checking
                </button>
              </div>
            </div>

            {/* Bright Capital Lock Notice Banner */}
            <div className="flex items-start gap-3 p-4 sm:p-5 rounded-2xl bg-amber-50 border-2 border-amber-400 text-amber-950 shadow-sm">
              <Lock className="w-6 h-6 text-amber-700 flex-shrink-0 mt-0.5" />
              <div className="text-xs sm:text-sm font-extrabold leading-relaxed">
                <strong className="font-black text-amber-900 uppercase tracking-wide block sm:inline mr-1.5">
                  Capital Lock Guarantee:
                </strong>
                Funds allocated to the {selectedPlanDays}-Day term plan are locked until maturity date. A fixed 4.50% interest is generated and credited every 24 hours. Upon maturity, 100% of your initial principal plus all daily profits are unlocked for instant withdrawal.
              </div>
            </div>

            {/* 3D Submit Action Button */}
            <button
              type="submit"
              disabled={isCreating || principalNum < 100}
              className="w-full py-4 px-6 rounded-2xl font-black text-lg text-white bg-gradient-to-b from-emerald-500 via-emerald-600 to-emerald-700 hover:from-emerald-400 hover:to-emerald-600 border-2 border-emerald-400 border-b-[5px] border-b-emerald-950 shadow-xl active:translate-y-1 active:border-b-[2px] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed select-none"
            >
              <Lock className="w-5 h-5 text-emerald-100" />
              <span>
                {isCreating
                  ? 'Activating Term Plan...'
                  : `Lock $${principalNum.toLocaleString()} for ${activePlan.termDays} Days (4.5% / 24h)`}
              </span>
              <ArrowRight className="w-5 h-5 text-emerald-200" />
            </button>
          </form>
        </div>

        {/* Right Panel: Detailed Fixed Interest Rate & Yield Breakdown Card (5 cols) */}
        <div className="lg:col-span-5 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 rounded-3xl p-6 sm:p-8 text-white shadow-2xl border-2 border-emerald-500 flex flex-col justify-between space-y-6">
          <div className="space-y-5">
            <div className="flex items-center justify-between border-b-2 border-slate-700 pb-4">
              <div>
                <span className="text-xs font-mono uppercase tracking-widest text-emerald-400 block font-black">
                  Fixed Interest Breakdown
                </span>
                <h3 className="text-2xl font-black text-white mt-1">{activePlan.planName}</h3>
              </div>
              <div className="text-right bg-emerald-950 p-2.5 rounded-xl border-2 border-emerald-500 shadow-md">
                <span className="text-2xl sm:text-3xl font-black font-mono text-emerald-300">4.50%</span>
                <span className="text-[10px] block text-emerald-200 uppercase font-mono font-black">Every 24 Hours</span>
              </div>
            </div>

            <div className="space-y-3 pt-2 text-sm sm:text-base font-mono">
              <div className="flex justify-between py-2.5 border-b border-slate-800 font-extrabold">
                <span className="text-slate-300">Principal Deposit:</span>
                <span className="font-black text-white text-lg sm:text-xl">
                  ${principalNum.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex justify-between py-2.5 border-b border-slate-800 font-extrabold">
                <span className="text-slate-300">Term Duration:</span>
                <span className="font-black text-white text-lg sm:text-xl">{activePlan.termDays} Days</span>
              </div>
              <div className="flex justify-between py-2.5 border-b border-slate-800 font-extrabold">
                <span className="text-slate-300">Daily Interest (Every 24h):</span>
                <span className="font-black text-emerald-400 text-lg sm:text-xl">
                  +${dailyInterest.toLocaleString('en-US', { minimumFractionDigits: 2 })} / day
                </span>
              </div>
              <div className="flex justify-between py-2.5 border-b border-slate-800 font-extrabold">
                <span className="text-slate-300">Total Projected Interest:</span>
                <span className="font-black text-emerald-400 text-lg sm:text-xl">
                  +${expectedReturn.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>

              {/* 3D Highlight Total at Maturity Box */}
              <div className="p-5 sm:p-6 rounded-2xl bg-emerald-950 border-2 border-emerald-400 shadow-xl space-y-2">
                <span className="text-xs uppercase font-mono text-emerald-300 block font-black tracking-wider">
                  Total Guaranteed Value at Maturity
                </span>
                <div className="text-3xl sm:text-4xl lg:text-5xl font-black text-white font-mono tracking-tight">
                  ${totalAtMaturity.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </div>
                <p className="text-xs text-emerald-200 font-extrabold">
                  Includes full return of original deposit + {activePlan.termDays} daily payments of ${dailyInterest.toLocaleString('en-US', { minimumFractionDigits: 2 })}.
                </p>
              </div>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900/80 border-2 border-slate-700 text-slate-200 text-xs sm:text-sm font-extrabold space-y-2">
            <div className="flex items-center gap-2 text-white font-black">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <span>Full Double-Entry Ledger Protection</span>
            </div>
            <p className="text-slate-300 leading-relaxed font-bold">
              Earnings are calculated precisely every 24 hours and posted to your ledger. Upon reaching maturity, the full balance is transferred to your checking account for instant withdrawal.
            </p>
          </div>
        </div>
      </div>

      {/* Active & Historic Investments List Section */}
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-950 text-emerald-400 border-2 border-emerald-500 flex items-center justify-center shadow-md">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-2xl sm:text-3xl font-black text-slate-950">
                Your Term Investments History
              </h2>
              <p className="text-xs sm:text-sm font-extrabold text-slate-600">
                Full chronological ledger, contract timestamps, receipts, and maturity schedules.
              </p>
            </div>
          </div>

          {/* Quick Count Badge */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-slate-100 text-slate-800 border border-slate-300 font-mono font-black text-xs self-start md:self-auto">
            <span>Showing {filteredInvestments.length} of {investments.length} records</span>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div className="p-4 sm:p-5 rounded-2xl bg-white border-2 border-slate-300 shadow-md space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            
            {/* Search Input */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                placeholder="Search plan, ID or amount..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs font-mono font-bold rounded-xl border-2 border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            {/* Status Filter */}
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200">
              {(['ALL', 'ACTIVE', 'MATURED'] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`flex-1 py-1.5 text-xs font-mono font-black rounded-lg transition-all cursor-pointer ${
                    statusFilter === status
                      ? 'bg-slate-950 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-950'
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>

            {/* Duration Filter Dropdown */}
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-500 flex-shrink-0" />
              <select
                value={durationFilter}
                onChange={(e) => setDurationFilter(e.target.value)}
                className="w-full py-2 px-3 text-xs font-mono font-bold rounded-xl border-2 border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
              >
                <option value="ALL">All Durations (60d - 360d)</option>
                {SUPPORTED_TERMS.map((t) => (
                  <option key={t.termDays} value={t.termDays.toString()}>
                    {t.termDays} Days Term
                  </option>
                ))}
              </select>
            </div>

            {/* Sort Options */}
            <div className="flex items-center gap-2">
              <ArrowUpDown className="w-4 h-4 text-slate-500 flex-shrink-0" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="w-full py-2 px-3 text-xs font-mono font-bold rounded-xl border-2 border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
              >
                <option value="NEWEST">Sort: Newest First</option>
                <option value="OLDEST">Sort: Oldest First</option>
                <option value="AMOUNT_DESC">Sort: Principal (High to Low)</option>
                <option value="YIELD_DESC">Sort: Expected Yield (High to Low)</option>
              </select>
            </div>

          </div>
        </div>

        {/* Early Withdrawal Notice Popup Dialog */}
        {earlyWithdrawalNotice && (
          <div className="p-5 rounded-2xl bg-amber-100 border-2 border-amber-500 text-amber-950 flex items-start justify-between gap-4 shadow-xl animate-in fade-in">
            <div className="flex items-start gap-3">
              <Info className="w-6 h-6 text-amber-700 flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="font-black text-base text-amber-950">Fixed Term Lock Notice</h4>
                <p className="text-sm font-extrabold text-amber-900 mt-1 leading-relaxed">
                  {earlyWithdrawalNotice}
                </p>
              </div>
            </div>
            <button
              onClick={() => setEarlyWithdrawalNotice(null)}
              className="px-3 py-1.5 rounded-xl bg-amber-200 hover:bg-amber-300 text-amber-950 font-black text-xs transition-colors cursor-pointer"
            >
              Got it
            </button>
          </div>
        )}

        {filteredInvestments.length === 0 ? (
          <div className="p-10 rounded-3xl bg-white border-2 border-slate-300 text-center space-y-3 shadow-md">
            <Clock className="w-12 h-12 text-slate-300 mx-auto" />
            <h3 className="text-xl font-black text-slate-900">No matching investments found.</h3>
            <p className="text-sm sm:text-base font-extrabold text-slate-600 max-w-md mx-auto">
              Try adjusting your search query or filters above, or open a new term investment.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredInvestments.map((inv) => {
              const isFast = isFastForwarding === inv.id;
              const isActive = inv.status === 'ACTIVE';
              const invDaily = Number((inv.amount * 0.045).toFixed(2));

              const startDateObj = new Date(inv.startDate);
              const maturityDateObj = new Date(inv.maturityDate);
              const startDateMs = startDateObj.getTime();
              const maturityDateMs = maturityDateObj.getTime();

              // Calculate time progress and 24-hour cycles
              const totalDurationMs = maturityDateMs - startDateMs;
              const elapsedMs = Math.max(0, currentTime - startDateMs);
              const dayLengthMs = 24 * 60 * 60 * 1000;
              const totalDays = inv.termDays;
              const completedCycles = Math.min(totalDays, Math.floor(elapsedMs / dayLengthMs));
              const accruedProfit = Number((completedCycles * invDaily).toFixed(2));
              const currentRunningValue = Number((inv.amount + accruedProfit).toFixed(2));

              const nextPayoutMs = startDateMs + (completedCycles + 1) * dayLengthMs;
              const msToNext = Math.max(0, nextPayoutMs - currentTime);
              const hoursToNext = Math.floor(msToNext / (1000 * 60 * 60));
              const minsToNext = Math.floor((msToNext % (1000 * 60 * 60)) / (1000 * 60));
              const secsToNext = Math.floor((msToNext % (1000 * 60)) / 1000);
              const countdownStr = `${String(hoursToNext).padStart(2, '0')}:${String(minsToNext).padStart(2, '0')}:${String(secsToNext).padStart(2, '0')}`;

              const progressPercent = isActive
                ? Math.min(100, Math.round((elapsedMs / totalDurationMs) * 100))
                : 100;
              const daysRemaining = isActive
                ? Math.max(0, totalDays - completedCycles)
                : 0;

              return (
                <div
                  key={inv.id}
                  id={`investment-card-${inv.id}`}
                  className={`p-6 sm:p-7 rounded-3xl border-2 transition-all space-y-5 shadow-xl flex flex-col justify-between ${
                    isActive
                      ? 'bg-white border-emerald-500 shadow-emerald-950/10'
                      : 'bg-slate-50 border-slate-300 opacity-90'
                  }`}
                >
                  <div className="space-y-4">
                    {/* Status and 24h Yield Badges */}
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`inline-flex items-center gap-2 text-xs font-mono uppercase font-black px-3 py-1.5 rounded-xl border-2 ${
                          isActive
                            ? 'bg-emerald-100 text-emerald-950 border-emerald-500'
                            : 'bg-slate-200 text-slate-800 border-slate-400'
                        }`}
                      >
                        {isActive && (
                          <span className="relative flex h-2.5 w-2.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-600"></span>
                          </span>
                        )}
                        <span>{isActive ? 'LOCKED & EARNING' : 'MATURED & SETTLED'}</span>
                      </span>
                      <span className="text-xs font-mono font-black text-emerald-950 bg-emerald-200 border-2 border-emerald-400 px-3 py-1.5 rounded-xl">
                        +4.50% / 24 Hours
                      </span>
                    </div>

                    <div>
                      <h3 className="font-black text-slate-950 text-xl tracking-tight">{inv.planName}</h3>
                      <span className="text-xs text-slate-500 font-mono font-bold block mt-0.5">
                        Contract Ref: #{inv.id.slice(-8).toUpperCase()}
                      </span>
                    </div>

                    {/* Prominent 3D 24-Hour Live Countdown Box */}
                    {isActive ? (
                      <div className="p-4 rounded-2xl bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 border-2 border-emerald-500 text-white font-mono shadow-lg space-y-2.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-black text-emerald-400 flex items-center gap-1.5 uppercase tracking-wider">
                            <Clock className="w-3.5 h-3.5 animate-spin" style={{ animationDuration: '8s' }} />
                            <span>Next 4.50% Profit Payout</span>
                          </span>
                          <span className="px-2 py-0.5 rounded-md bg-emerald-900/80 text-emerald-300 border border-emerald-500/50 font-black text-[11px]">
                            +${invDaily.toFixed(2)}
                          </span>
                        </div>

                        {/* Large Bold Digital Ticker */}
                        <div className="flex items-center justify-center gap-2 bg-slate-950/80 py-2.5 px-3 rounded-xl border border-slate-700">
                          <div className="text-center">
                            <span className="text-xl sm:text-2xl font-black text-white tracking-wider block">
                              {String(hoursToNext).padStart(2, '0')}
                            </span>
                            <span className="text-[9px] uppercase font-black text-slate-400">Hours</span>
                          </div>
                          <span className="text-xl sm:text-2xl font-black text-emerald-400 -mt-2">:</span>
                          <div className="text-center">
                            <span className="text-xl sm:text-2xl font-black text-white tracking-wider block">
                              {String(minsToNext).padStart(2, '0')}
                            </span>
                            <span className="text-[9px] uppercase font-black text-slate-400">Mins</span>
                          </div>
                          <span className="text-xl sm:text-2xl font-black text-emerald-400 -mt-2">:</span>
                          <div className="text-center">
                            <span className="text-xl sm:text-2xl font-black text-emerald-400 tracking-wider block animate-pulse">
                              {String(secsToNext).padStart(2, '0')}
                            </span>
                            <span className="text-[9px] uppercase font-black text-emerald-400">Secs</span>
                          </div>
                        </div>

                        <p className="text-[11px] text-slate-300 font-extrabold text-center">
                          Auto-credited every 24 hours • Cycle {completedCycles + 1} of {totalDays}
                        </p>
                      </div>
                    ) : (
                      <div className="p-3.5 rounded-2xl bg-slate-100 border-2 border-slate-300 font-mono text-center space-y-1">
                        <span className="text-xs uppercase font-black text-slate-600 flex items-center justify-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          <span>All {totalDays} Cycles Distributed</span>
                        </span>
                        <span className="text-sm font-black text-slate-900 block">
                          Full 4.5% Profit Settled to Checking
                        </span>
                      </div>
                    )}

                    {/* Accrued Profit & Current Running Value Box */}
                    <div className="p-3.5 rounded-2xl bg-emerald-50 border-2 border-emerald-300 font-mono space-y-2">
                      <div className="flex items-center justify-between text-xs font-black">
                        <span className="text-slate-700">Accrued Profit So Far:</span>
                        <span className="text-emerald-700 font-black text-sm">
                          +${accruedProfit.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-xs font-black">
                        <span className="text-slate-700">Current Portfolio Value:</span>
                        <span className="text-slate-950 font-black text-sm">
                          ${currentRunningValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[11px] font-bold text-slate-600 pt-1 border-t border-emerald-200">
                        <span>Daily Distribution Status:</span>
                        <span className="font-black text-emerald-950">
                          {completedCycles} of {totalDays} Days Credited
                        </span>
                      </div>
                    </div>

                    {/* Accurate Timestamps: Deposit Time & Expiry Time */}
                    <div className="p-3.5 rounded-2xl bg-slate-50 border-2 border-slate-200 text-xs font-mono space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-slate-500 font-bold flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5 text-slate-400" />
                          <span>Deposit Made:</span>
                        </span>
                        <span className="font-black text-slate-900 text-right">
                          {startDateObj.toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}{' '}
                          <span className="text-slate-500 font-normal">
                            at {startDateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </span>
                      </div>

                      <div className="flex items-start justify-between gap-2">
                        <span className="text-slate-500 font-bold flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          <span>Maturity / Expiry:</span>
                        </span>
                        <span className="font-black text-slate-900 text-right">
                          {maturityDateObj.toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}{' '}
                          <span className="text-slate-500 font-normal">
                            at {maturityDateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </span>
                      </div>

                      {/* Progress Bar */}
                      <div className="pt-1.5 space-y-1">
                        <div className="flex justify-between text-[11px] font-black text-slate-600">
                          <span>{isActive ? `${daysRemaining} days remaining` : 'Completed'}</span>
                          <span>{progressPercent}% Elapsed</span>
                        </div>
                        <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                            style={{ width: `${progressPercent}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Financial Metrics */}
                    <div className="space-y-2 pt-1 border-t-2 border-slate-100 text-sm font-mono font-extrabold">
                      <div className="flex justify-between text-slate-700">
                        <span>Principal Locked:</span>
                        <span className="font-black text-slate-950">${inv.amount.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-slate-700">
                        <span>Daily Profit (24h Rate):</span>
                        <span className="font-black text-emerald-700">+${invDaily.toLocaleString('en-US', { minimumFractionDigits: 2 })}/day</span>
                      </div>
                      <div className="flex justify-between text-slate-700">
                        <span>Total Term Guaranteed Earnings:</span>
                        <span className="font-black text-emerald-700">+${inv.expectedYield.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                      </div>
                      <div className="flex justify-between text-slate-900 pt-2 border-t border-slate-200">
                        <span className="font-black">Total at Maturity:</span>
                        <span className="font-black text-emerald-900 text-base sm:text-lg">
                          ${inv.expectedMaturityValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions Bar */}
                  <div className="pt-4 space-y-2.5 border-t-2 border-slate-100">
                    
                    {/* View 24h Profit Accrual Schedule Button */}
                    <button
                      onClick={() => setAccrualModalInv(inv)}
                      className="w-full py-2.5 px-3 rounded-xl text-xs font-black text-emerald-950 bg-emerald-100 hover:bg-emerald-200 border-2 border-emerald-500 transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-xs"
                    >
                      <Layers className="w-4 h-4 text-emerald-700" />
                      <span>View 24h Profit Schedule ({completedCycles} of {totalDays} Credited)</span>
                    </button>

                    {/* Certificate & Share Buttons */}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setReceiptInv(inv)}
                        className="py-2 px-3 rounded-xl text-xs font-black text-slate-900 bg-slate-100 hover:bg-slate-200 border border-slate-300 transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                      >
                        <Download className="w-3.5 h-3.5 text-slate-700" />
                        <span>Receipt / Cert</span>
                      </button>

                      <button
                        onClick={() => setShareInv(inv)}
                        className="py-2 px-3 rounded-xl text-xs font-black text-emerald-950 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                      >
                        <Share2 className="w-3.5 h-3.5 text-emerald-700" />
                        <span>Share Plan</span>
                      </button>
                    </div>

                    {isActive && (
                      <>
                        {/* Early Withdrawal Information Trigger Button */}
                        <button
                          onClick={() =>
                            setEarlyWithdrawalNotice(
                              `This ${inv.termDays}-Day Term Investment is locked until ${maturityDateObj.toLocaleDateString()} at ${maturityDateObj.toLocaleTimeString()}. Fixed term contracts cannot be withdrawn prior to maturity. Once the term concludes, your full principal ($${inv.amount.toLocaleString()}) and all 4.5% daily interest ($${inv.expectedYield.toLocaleString()}) will automatically be available for instant withdrawal.`
                            )
                          }
                          className="w-full py-2.5 px-3 rounded-xl text-xs font-black text-amber-900 bg-amber-100 hover:bg-amber-200 border-2 border-amber-400 transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                        >
                          <Lock className="w-4 h-4 text-amber-700" />
                          <span>Withdrawal Status: Locked Until Maturity</span>
                        </button>

                        {/* Simulator Button */}
                        <button
                          onClick={() => handleFastForwardMaturity(inv.id)}
                          disabled={isFast}
                          className="w-full py-2 px-3 rounded-xl text-xs font-black text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors flex items-center justify-center gap-1.5 border border-slate-300 cursor-pointer shadow-xs"
                          title="Simulate maturity date arrival and immediate ledger settlement"
                        >
                          <FastForward className="w-3.5 h-3.5 text-emerald-600" />
                          <span>{isFast ? 'Settling Funds...' : 'Simulate Maturity Payout (Test)'}</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Official Receipt Modal */}
      {receiptInv && (
        <InvestmentReceiptModal
          investment={receiptInv}
          user={currentUser}
          onClose={() => setReceiptInv(null)}
        />
      )}

      {/* Share Modal */}
      {shareInv && (
        <InvestmentShareModal
          investment={shareInv}
          user={currentUser}
          onClose={() => setShareInv(null)}
        />
      )}

      {/* 24-Hour Profit Accrual & Daily Distribution Schedule Modal */}
      {accrualModalInv && (
        <InvestmentAccrualModal
          investment={accrualModalInv}
          currentTime={currentTime}
          onClose={() => setAccrualModalInv(null)}
        />
      )}

    </div>
  );
};
