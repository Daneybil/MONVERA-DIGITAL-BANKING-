import React, { useState } from 'react';
import { InvestmentTermDays } from '../../types';
import { TrendingUp, Clock, ShieldCheck, Lock, Sparkles, ArrowRight, CreditCard } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export const InvestmentTermPreview: React.FC = () => {
  const { openModal, currentUser, setCurrentView } = useAuth();
  const [selectedTerm, setSelectedTerm] = useState<InvestmentTermDays>(180);
  const [investAmount, setInvestAmount] = useState<number>(1000);

  // Supported Monvera Terms strictly starting at 60 Days up to 360 Days with 4.5% daily interest every 24 hours
  const termOptions: { days: InvestmentTermDays; dailyRate: number; tierLabel: string }[] = [
    { days: 60, dailyRate: 4.5, tierLabel: '60-Day Treasury Term' },
    { days: 90, dailyRate: 4.5, tierLabel: '90-Day Quarterly Prime' },
    { days: 120, dailyRate: 4.5, tierLabel: '120-Day Trimester Growth' },
    { days: 150, dailyRate: 4.5, tierLabel: '150-Day Yield Alpha' },
    { days: 180, dailyRate: 4.5, tierLabel: '180-Day Semi-Annual Vault' },
    { days: 210, dailyRate: 4.5, tierLabel: '210-Day Dynamic Harvest' },
    { days: 240, dailyRate: 4.5, tierLabel: '240-Day Fixed Capital Plan' },
    { days: 270, dailyRate: 4.5, tierLabel: '270-Day Three-Quarter Vault' },
    { days: 300, dailyRate: 4.5, tierLabel: '300-Day Strategic Alpha' },
    { days: 330, dailyRate: 4.5, tierLabel: '330-Day Institutional Reserve' },
    { days: 360, dailyRate: 4.5, tierLabel: '360-Day Annual Treasury Plan' },
  ];

  const currentTermConfig = termOptions.find((t) => t.days === selectedTerm) || termOptions[4];
  const dailyYield = Number((investAmount * (currentTermConfig.dailyRate / 100)).toFixed(2));
  const expectedYield = Number((dailyYield * selectedTerm).toFixed(2));
  const expectedMaturityValue = Number((investAmount + expectedYield).toFixed(2));

  return (
    <section id="investments" className="py-20 lg:py-28 bg-[#182130] text-white relative overflow-hidden border-t border-slate-700/60">
      {/* Visual background accents */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
        
        <div className="text-center max-w-3xl mx-auto space-y-4 mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-xl bg-emerald-950/90 text-emerald-300 border-2 border-emerald-500 text-sm font-black tracking-wide">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <span>Investment Treasury Guaranteed</span>
          </div>
          <h2 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight text-white">
            Monvera Investment Center
          </h2>
          <p className="text-xl sm:text-2xl text-slate-100 font-black leading-relaxed">
            Institutional term commitments from 60 to 360 days with fixed 4.50% interest rate every 24 hours.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* Left Column: Term Selector Buttons & Amount Slider */}
          <div className="lg:col-span-7 bg-[#1f2c40] rounded-3xl p-6 sm:p-8 border-2 border-slate-700/80 shadow-2xl space-y-7">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-700/80 pb-4 gap-2">
              <div>
                <h3 className="text-2xl sm:text-3xl font-black text-white">Select Investment Duration</h3>
                <p className="text-base text-slate-200 font-bold mt-1">Choose between 60 days to 360 days (Min $100)</p>
              </div>
              <span className="text-sm sm:text-base font-mono text-emerald-300 font-black bg-emerald-950 px-3.5 py-1.5 rounded-xl border-2 border-emerald-500 shadow-sm self-start sm:self-auto">
                11 Supported Terms
              </span>
            </div>

            {/* Term Duration Grid (Strictly starts at 60d to 360d with 4.5% Every 24 Hours) */}
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3.5">
              {termOptions.map((term) => (
                <button
                  key={term.days}
                  onClick={() => setSelectedTerm(term.days)}
                  className={`p-4 rounded-2xl border-2 text-center transition-all cursor-pointer ${
                    selectedTerm === term.days
                      ? 'bg-emerald-600 text-white border-emerald-300 shadow-xl shadow-emerald-600/50 font-black scale-[1.04]'
                      : 'bg-slate-800 text-slate-100 border-slate-700 hover:bg-slate-750 hover:text-white font-black'
                  }`}
                >
                  <div className="text-lg sm:text-xl font-black">{term.days} Days</div>
                  <div className={`text-sm sm:text-base font-mono font-black ${selectedTerm === term.days ? 'text-emerald-100' : 'text-emerald-400'}`}>
                    4.5% / 24h
                  </div>
                </button>
              ))}
            </div>

            {/* Amount Slider & Direct Input */}
            <div className="space-y-4 pt-4 border-t border-slate-700">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <label className="text-lg sm:text-xl font-black text-white">Investment Capital Amount</label>
                <div className="text-2xl sm:text-3xl font-black font-mono text-white bg-slate-800 px-5 py-2 rounded-xl border-2 border-emerald-500/80 shadow-inner">
                  ${investAmount.toLocaleString()} USD
                </div>
              </div>

              <input
                type="range"
                min="100"
                max="1000000"
                step="100"
                value={investAmount}
                onChange={(e) => setInvestAmount(Number(e.target.value))}
                className="w-full accent-emerald-400 cursor-pointer h-3.5 bg-slate-700 rounded-lg"
              />

              <div className="flex items-center justify-between text-base text-slate-200 font-black font-mono">
                <span>$100 (Min)</span>
                <span>$500,000</span>
                <span>$1,000,000</span>
              </div>
            </div>

            {/* Bright, Highly Visible Capital Lock Notice */}
            <div className="flex items-start gap-4 p-5 sm:p-6 rounded-2xl bg-amber-950/80 border-2 border-amber-400 text-amber-100 shadow-xl">
              <Lock className="w-7 h-7 text-amber-300 flex-shrink-0 mt-0.5" />
              <div className="text-base sm:text-lg leading-relaxed font-extrabold">
                <strong className="text-amber-300 font-black uppercase tracking-wider text-base sm:text-lg mr-2 block sm:inline">
                  Capital Lock Notice:
                </strong>
                Funds allocated to a {selectedTerm}-day term plan are secured and cannot be withdrawn prior to maturity. Returns of 4.50% are credited automatically every 24 hours. Upon maturity, 100% of your initial principal plus total profits are released for instant withdrawal.
              </div>
            </div>
          </div>

          {/* Right Column: Calculated Yield Summary Card */}
          <div className="lg:col-span-5 bg-gradient-to-b from-[#1f2c40] to-[#16202e] rounded-3xl p-6 sm:p-8 border-2 border-emerald-500 shadow-2xl space-y-6">
            <div className="space-y-1">
              <span className="text-xs font-mono uppercase tracking-widest text-emerald-400 block font-black">
                Fixed Interest Breakdown
              </span>
              <h3 className="text-3xl sm:text-4xl font-black text-white tracking-tight">{currentTermConfig.tierLabel}</h3>
            </div>

            <div className="space-y-4 pt-2">
              <div className="flex items-center justify-between py-3 border-b border-slate-700 text-base sm:text-lg font-black">
                <span className="text-slate-200 font-black">Principal Deposit:</span>
                <span className="font-mono font-black text-white text-xl sm:text-2xl">${investAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
              </div>

              <div className="flex items-center justify-between py-3 border-b border-slate-700 text-base sm:text-lg font-black">
                <span className="text-slate-200 font-black">Principal Lock Period:</span>
                <span className="font-mono font-black text-white text-xl sm:text-2xl">{selectedTerm} Days</span>
              </div>

              <div className="flex items-center justify-between py-3 border-b border-slate-700 text-base sm:text-lg font-black">
                <span className="text-slate-200 font-black">Interest Every 24 Hours:</span>
                <span className="font-mono font-black text-emerald-400 text-lg sm:text-xl">4.50% (${dailyYield.toLocaleString('en-US', { minimumFractionDigits: 2 })} / day)</span>
              </div>

              <div className="flex items-center justify-between py-3 border-b border-slate-700 text-base sm:text-lg font-black">
                <span className="text-slate-200 font-black">Total Projected Interest:</span>
                <span className="font-mono font-black text-emerald-400 text-xl sm:text-2xl">+${expectedYield.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
              </div>

              {/* Total at Maturity Highlight */}
              <div className="p-6 sm:p-7 rounded-2xl bg-emerald-950 border-2 border-emerald-400 space-y-2.5 shadow-2xl">
                <div className="text-base sm:text-lg font-black uppercase tracking-wide text-emerald-300">Expected Value at Maturity:</div>
                <div className="text-4xl sm:text-5xl lg:text-6xl font-black text-white font-mono tracking-tight">
                  ${expectedMaturityValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </div>
                <div className="text-sm sm:text-base font-black text-emerald-200">
                  Principal (${investAmount.toLocaleString()}) + Total Interest (${expectedYield.toLocaleString()})
                </div>
              </div>
            </div>

            <div className="space-y-4 pt-2 flex flex-col items-center justify-center text-center">
              <button
                id="investment-center-open-btn"
                onClick={() => {
                  if (currentUser) setCurrentView('investments');
                  else openModal('auth_register');
                }}
                className="w-full max-w-sm inline-flex items-center justify-center gap-2 py-4 px-6 rounded-xl font-black text-lg bg-gradient-to-b from-emerald-500 via-emerald-600 to-emerald-700 hover:from-emerald-400 hover:to-emerald-600 text-white border-2 border-emerald-400 border-b-[5px] border-b-emerald-950 shadow-xl active:translate-y-1 active:border-b-[2px] active:shadow-sm transition-all cursor-pointer select-none"
              >
                <span>{currentUser ? 'Open Term Plan in Dashboard' : 'Open Term Account'}</span>
                <ArrowRight className="w-6 h-6 text-emerald-100" />
              </button>

              {/* Monvera Obsidian Card Button Placed Underneath in 3D Style */}
              <button
                id="monvera-obsidian-card-btn"
                onClick={() => {
                  if (currentUser) {
                    setCurrentView('cards');
                  } else {
                    const elem = document.getElementById('cards');
                    if (elem) {
                      elem.scrollIntoView({ behavior: 'smooth' });
                    }
                  }
                }}
                className="w-full max-w-sm inline-flex items-center justify-center gap-2 py-4 px-6 rounded-xl font-black text-lg bg-gradient-to-b from-slate-800 via-slate-850 to-slate-900 hover:from-slate-750 hover:to-slate-850 text-slate-100 border-2 border-slate-600 border-b-[5px] border-b-slate-950 shadow-lg active:translate-y-1 active:border-b-[2px] active:shadow-sm transition-all cursor-pointer select-none"
              >
                <CreditCard className="w-6 h-6 text-amber-400" />
                <span>Monvera Obsidian Card</span>
                <ArrowRight className="w-6 h-6 text-slate-300 ml-auto" />
              </button>
            </div>
          </div>

        </div>

      </div>
    </section>
  );
};
