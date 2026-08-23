import React from 'react';
import { InvestmentPlan } from '../../types';
import {
  X,
  TrendingUp,
  Clock,
  CheckCircle2,
  Calendar,
  DollarSign,
  ShieldCheck,
  Zap,
  ArrowRight,
  Layers,
  Sparkles,
} from 'lucide-react';

interface InvestmentAccrualModalProps {
  investment: InvestmentPlan;
  currentTime: number;
  onClose: () => void;
}

export const InvestmentAccrualModal: React.FC<InvestmentAccrualModalProps> = ({
  investment,
  currentTime,
  onClose,
}) => {
  const startDateMs = new Date(investment.startDate).getTime();
  const maturityDateMs = new Date(investment.maturityDate).getTime();
  const elapsedMs = Math.max(0, currentTime - startDateMs);
  const dayLengthMs = 24 * 60 * 60 * 1000;
  const totalDays = investment.termDays;
  const completedCycles = Math.min(totalDays, Math.floor(elapsedMs / dayLengthMs));
  const dailyProfit = Number((investment.amount * 0.045).toFixed(2));
  const accruedProfit = Number((completedCycles * dailyProfit).toFixed(2));
  const currentRunningValue = Number((investment.amount + accruedProfit).toFixed(2));

  const nextPayoutMs = startDateMs + (completedCycles + 1) * dayLengthMs;
  const msToNext = Math.max(0, nextPayoutMs - currentTime);
  const hoursToNext = Math.floor(msToNext / (1000 * 60 * 60));
  const minsToNext = Math.floor((msToNext % (1000 * 60 * 60)) / (1000 * 60));
  const secsToNext = Math.floor((msToNext % (1000 * 60)) / 1000);
  const countdownFormatted = `${String(hoursToNext).padStart(2, '0')}:${String(minsToNext).padStart(2, '0')}:${String(secsToNext).padStart(2, '0')}`;

  const isActive = investment.status === 'ACTIVE';

  // Generate schedule rows (all days or up to current + next 10 for pagination)
  const scheduleRows = Array.from({ length: totalDays }, (_, idx) => {
    const cycleDay = idx + 1;
    const cycleTimestampMs = startDateMs + cycleDay * dayLengthMs;
    const cycleDate = new Date(cycleTimestampMs);
    const isCompleted = cycleDay <= completedCycles;
    const isCurrent = isActive && cycleDay === completedCycles + 1;
    const cumulativeProfit = Number((cycleDay * dailyProfit).toFixed(2));
    const cumulativeTotal = Number((investment.amount + cumulativeProfit).toFixed(2));

    return {
      day: cycleDay,
      date: cycleDate,
      profit: dailyProfit,
      cumulativeProfit,
      cumulativeTotal,
      isCompleted,
      isCurrent,
      status: isCompleted ? 'POSTED' : isCurrent ? 'IN_PROGRESS' : 'SCHEDULED',
    };
  });

  return (
    <div
      id="investment-accrual-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-4xl bg-white rounded-3xl border-2 border-slate-300 shadow-2xl overflow-hidden my-8 text-slate-950">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-emerald-950 p-6 sm:p-8 text-white border-b-2 border-emerald-500">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-xl bg-emerald-950/90 text-emerald-300 border border-emerald-400 text-xs font-mono font-black tracking-wider uppercase">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"></span>
                </span>
                <span>24-Hour Profit Distribution Engine</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                {investment.planName}
              </h2>
              <p className="text-xs sm:text-sm font-extrabold text-slate-300 font-mono">
                Contract Ref: #{investment.id.slice(-8).toUpperCase()} • Principal: ${investment.amount.toLocaleString()} • Fixed Rate: 4.50% / 24 Hours
              </p>
            </div>

            <button
              onClick={onClose}
              className="p-2.5 rounded-2xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-600 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Quick Metrics Bar inside Modal */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-6 border-t border-slate-800 font-mono">
            <div className="bg-slate-950/70 p-3.5 rounded-2xl border border-slate-700">
              <span className="text-[11px] uppercase font-bold text-slate-400 block">Accrued Profits</span>
              <span className="text-lg sm:text-xl font-black text-emerald-400">
                +${accruedProfit.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
              <span className="text-[10px] text-slate-400 block font-bold mt-0.5">
                {completedCycles} of {totalDays} cycles credited
              </span>
            </div>

            <div className="bg-slate-950/70 p-3.5 rounded-2xl border border-slate-700">
              <span className="text-[11px] uppercase font-bold text-slate-400 block">Current Portfolio Value</span>
              <span className="text-lg sm:text-xl font-black text-white">
                ${currentRunningValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
              <span className="text-[10px] text-slate-400 block font-bold mt-0.5">
                Principal + Earnings
              </span>
            </div>

            <div className="bg-slate-950/70 p-3.5 rounded-2xl border border-slate-700">
              <span className="text-[11px] uppercase font-bold text-slate-400 block">Daily 24h Payout</span>
              <span className="text-lg sm:text-xl font-black text-emerald-400">
                +${dailyProfit.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
              <span className="text-[10px] text-slate-400 block font-bold mt-0.5">
                4.50% every 24 hours
              </span>
            </div>

            <div className="bg-slate-950/70 p-3.5 rounded-2xl border border-slate-700">
              <span className="text-[11px] uppercase font-bold text-slate-400 block">Next 24h Payout In</span>
              <span className="text-lg sm:text-xl font-black text-amber-400 animate-pulse">
                {isActive ? countdownFormatted : 'Matured'}
              </span>
              <span className="text-[10px] text-slate-400 block font-bold mt-0.5">
                {isActive ? `${Math.max(0, totalDays - completedCycles)} days left` : 'Completed'}
              </span>
            </div>
          </div>
        </div>

        {/* Live Active Cycle Banner */}
        {isActive && (
          <div className="p-4 sm:p-5 bg-emerald-50 border-b-2 border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-emerald-600 text-white flex items-center justify-center flex-shrink-0 font-black shadow-md">
                <Clock className="w-5 h-5 animate-spin" style={{ animationDuration: '6s' }} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-black text-slate-950 text-sm sm:text-base">
                    Active Cycle: Day {completedCycles + 1} of {totalDays}
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-emerald-200 text-emerald-950 text-xs font-mono font-black border border-emerald-400">
                    4.50% Distribution
                  </span>
                </div>
                <p className="text-xs font-extrabold text-slate-600 mt-0.5">
                  +$ {dailyProfit.toLocaleString('en-US', { minimumFractionDigits: 2 })} will automatically credit when the countdown timer hits 00:00:00.
                </p>
              </div>
            </div>

            <div className="bg-slate-950 text-white px-4 py-2 rounded-2xl border-2 border-emerald-500 font-mono text-center flex-shrink-0 shadow-md">
              <span className="text-[10px] uppercase font-black text-emerald-400 block tracking-widest">
                Cycle Countdown
              </span>
              <span className="text-xl font-black text-emerald-300 tracking-wider">
                {countdownFormatted}
              </span>
            </div>
          </div>
        )}

        {/* Chronological Table of 24h Cycles */}
        <div className="p-6 sm:p-8 space-y-4 max-h-[50vh] overflow-y-auto">
          <div className="flex items-center justify-between">
            <h3 className="font-black text-slate-950 text-lg flex items-center gap-2">
              <Layers className="w-5 h-5 text-emerald-600" />
              <span>Full 24-Hour Profit Distribution Schedule ({totalDays} Days)</span>
            </h3>
            <span className="text-xs font-mono font-black text-slate-500">
              {completedCycles} Posted • {totalDays - completedCycles} Remaining
            </span>
          </div>

          <div className="border-2 border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm font-mono">
                <thead className="bg-slate-100 border-b-2 border-slate-200 text-slate-700 font-black uppercase text-[11px]">
                  <tr>
                    <th className="py-3 px-4">Cycle</th>
                    <th className="py-3 px-4">Payout Date & Time</th>
                    <th className="py-3 px-4 text-right">Profit Rate</th>
                    <th className="py-3 px-4 text-right">24h Profit</th>
                    <th className="py-3 px-4 text-right">Accrued Total</th>
                    <th className="py-3 px-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-bold">
                  {scheduleRows.map((row) => (
                    <tr
                      key={row.day}
                      className={`transition-colors ${
                        row.isCurrent
                          ? 'bg-emerald-50/80 font-black'
                          : row.isCompleted
                            ? 'bg-white hover:bg-slate-50'
                            : 'bg-slate-50/50 text-slate-500'
                      }`}
                    >
                      <td className="py-3 px-4">
                        <span className="font-black text-slate-900">
                          Day {row.day}
                        </span>
                      </td>

                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5 text-slate-800 font-extrabold">
                          <Calendar className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                          <span>
                            {row.date.toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })}{' '}
                            <span className="text-slate-500 font-normal">
                              {row.date.toLocaleTimeString('en-US', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </span>
                        </div>
                      </td>

                      <td className="py-3 px-4 text-right font-black text-slate-700">
                        4.50%
                      </td>

                      <td className="py-3 px-4 text-right font-black text-emerald-700">
                        +${row.profit.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>

                      <td className="py-3 px-4 text-right font-black text-slate-900">
                        +${row.cumulativeProfit.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>

                      <td className="py-3 px-4 text-center">
                        {row.isCompleted ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-950 border border-emerald-400 font-black text-[11px]">
                            <CheckCircle2 className="w-3 h-3 text-emerald-700" />
                            <span>POSTED</span>
                          </span>
                        ) : row.isCurrent ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-100 text-amber-950 border border-amber-400 font-black text-[11px] animate-pulse">
                            <Clock className="w-3 h-3 text-amber-700" />
                            <span>IN PROGRESS ({countdownFormatted})</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 border border-slate-300 font-bold text-[11px]">
                            <span>SCHEDULED</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-slate-50 p-4 sm:p-6 border-t-2 border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs font-mono font-bold text-slate-600">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Monvera Institutional Treasury Contract Protection Enabled</span>
          </div>

          <button
            onClick={onClose}
            className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-slate-950 hover:bg-slate-800 text-white font-mono font-black text-sm transition-colors cursor-pointer shadow-md"
          >
            Close Schedule
          </button>
        </div>

      </div>
    </div>
  );
};
