import React, { useState } from 'react';
import { CreditCard, Shield, Lock, Sliders, Globe, Zap, Sparkles, CheckCircle2, ArrowRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export const CardShowcaseSection: React.FC = () => {
  const { openModal, currentUser, setCurrentView } = useAuth();
  const [activeCardColor, setActiveCardColor] = useState<'obsidian' | 'titanium' | 'emerald'>('obsidian');
  const [monthlySpend, setMonthlySpend] = useState<number>(3500);

  // Dynamic cashback calculation based on configurable 2.5% rate
  const cashbackRate = 0.025; // 2.5%
  const annualCashback = Math.round(monthlySpend * 12 * cashbackRate);
  const monthlyCashback = Math.round(monthlySpend * cashbackRate);

  return (
    <section id="cards" className="py-20 lg:py-28 bg-white relative overflow-hidden border-t border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
        
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          
          {/* Left Column: Interactive Luxury Card Presentation */}
          <div className="lg:col-span-6 space-y-7">
            <div className="text-center lg:text-left space-y-3">
              <span className="text-sm sm:text-base font-black uppercase tracking-wider text-emerald-900 bg-emerald-100 px-4 py-2 rounded-xl border-2 border-emerald-400 shadow-sm inline-block">
                Next-Gen Card Experience
              </span>
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-slate-950">
                The Monvera Obsidian Card
              </h2>
              <p className="text-slate-900 text-lg sm:text-xl font-extrabold leading-relaxed">
                A premium metal card designed for easy everyday spending, high rewards, and total security right from your phone.
              </p>
            </div>

            {/* Interactive Color Switcher */}
            <div className="flex flex-wrap items-center justify-center lg:justify-start gap-3 pt-2">
              <span className="text-sm sm:text-base font-black text-slate-950 uppercase tracking-wider">Select Edition:</span>
              <button
                onClick={() => setActiveCardColor('obsidian')}
                className={`px-4 py-2.5 rounded-xl text-sm sm:text-base font-black transition-all cursor-pointer ${
                  activeCardColor === 'obsidian'
                    ? 'bg-slate-950 text-white border-2 border-slate-950 shadow-lg scale-105'
                    : 'bg-slate-100 text-slate-900 border-2 border-slate-300 hover:bg-slate-200'
                }`}
              >
                Obsidian World Elite
              </button>
              <button
                onClick={() => setActiveCardColor('titanium')}
                className={`px-4 py-2.5 rounded-xl text-sm sm:text-base font-black transition-all cursor-pointer ${
                  activeCardColor === 'titanium'
                    ? 'bg-slate-800 text-amber-300 border-2 border-slate-800 shadow-lg scale-105'
                    : 'bg-slate-100 text-slate-900 border-2 border-slate-300 hover:bg-slate-200'
                }`}
              >
                Titanium Edition
              </button>
              <button
                onClick={() => setActiveCardColor('emerald')}
                className={`px-4 py-2.5 rounded-xl text-sm sm:text-base font-black transition-all cursor-pointer ${
                  activeCardColor === 'emerald'
                    ? 'bg-emerald-800 text-white border-2 border-emerald-800 shadow-lg scale-105'
                    : 'bg-slate-100 text-slate-900 border-2 border-slate-300 hover:bg-slate-200'
                }`}
              >
                Emerald Private
              </button>
            </div>

            {/* Dynamic Card Display */}
            <div className="relative group max-w-lg mx-auto lg:mx-0 pt-2">
              <div
                className={`w-full min-h-[270px] sm:min-h-[300px] rounded-3xl p-7 sm:p-8 text-white shadow-2xl flex flex-col justify-between relative overflow-hidden transition-all duration-300 ${
                  activeCardColor === 'obsidian'
                    ? 'bg-gradient-to-br from-black via-slate-950 to-slate-900 border-2 border-slate-700 shadow-slate-900/40'
                    : activeCardColor === 'titanium'
                    ? 'bg-gradient-to-br from-slate-800 via-slate-700 to-zinc-900 border-2 border-slate-500 shadow-slate-900/40'
                    : 'bg-gradient-to-br from-emerald-950 via-emerald-900 to-slate-950 border-2 border-emerald-500 shadow-emerald-950/40'
                }`}
              >
                <div className="flex items-center justify-between relative z-10">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-white/20 border-2 border-white/40 flex items-center justify-center font-black text-lg text-amber-300 shadow-md">
                      M
                    </div>
                    <div>
                      <span className="font-black tracking-widest text-xl uppercase block font-sans text-white">MONVERA</span>
                      <span className="text-xs text-emerald-300 font-mono font-black tracking-wider">PRIVATE WEALTH</span>
                    </div>
                  </div>
                  <span className="text-xs sm:text-sm uppercase font-mono font-black tracking-wider px-4 py-1.5 rounded-lg bg-white/20 border-2 border-white/40 text-white">
                    {activeCardColor === 'obsidian' ? 'World Elite' : activeCardColor === 'titanium' ? 'Titanium' : 'Private Wealth'}
                  </span>
                </div>

                {/* EMV Microchip Graphic with golden antique sheen */}
                <div className="w-14 h-10 rounded-lg bg-gradient-to-tr from-amber-300 via-amber-100 to-amber-400 border-2 border-amber-300 shadow-md flex items-center justify-center relative z-10">
                  <div className="w-full h-0.5 bg-amber-700/60" />
                </div>

                <div className="space-y-3 relative z-10 pt-2">
                  <div className="font-mono text-2xl sm:text-3xl tracking-widest text-white font-black">
                    4921 •••• •••• 8829
                  </div>
                  <div className="flex items-center justify-between text-sm text-slate-200 font-mono uppercase font-black">
                    <div>
                      <span className="text-xs text-slate-300 font-black block">CARD HOLDER</span>
                      <span className="text-white font-black text-lg">ELEANOR VANCE</span>
                    </div>
                    <div className="text-right">
                      <span className="text-xs text-slate-300 font-black block">VALID THRU</span>
                      <span className="text-white font-black text-lg">08/29</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Card Controls & Cashback Estimator */}
          <div className="lg:col-span-6 space-y-6">
            
            {/* Feature List: Extra Bold, High Contrast, Large Text in Simple English on Clean White Background */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              
              {/* Feature 1 */}
              <div className="p-5 rounded-2xl bg-white border-2 border-emerald-600 shadow-sm space-y-2">
                <div className="flex items-center gap-2.5 font-black text-lg sm:text-xl text-emerald-900">
                  <Lock className="w-6 h-6 text-emerald-700 flex-shrink-0" />
                  <span>Instant Freeze Control</span>
                </div>
                <p className="text-sm sm:text-base font-extrabold text-slate-900 leading-relaxed">
                  Lock and unlock your physical and virtual cards immediately from your dashboard with a single tap.
                </p>
              </div>

              {/* Feature 2 */}
              <div className="p-5 rounded-2xl bg-white border-2 border-emerald-600 shadow-sm space-y-2">
                <div className="flex items-center gap-2.5 font-black text-lg sm:text-xl text-emerald-900">
                  <Sliders className="w-6 h-6 text-emerald-700 flex-shrink-0" />
                  <span>Custom Spending Limits</span>
                </div>
                <p className="text-sm sm:text-base font-extrabold text-slate-900 leading-relaxed">
                  Set easy daily and monthly spending caps anytime to keep full control over your money.
                </p>
              </div>

              {/* Feature 3 */}
              <div className="p-5 rounded-2xl bg-white border-2 border-emerald-600 shadow-sm space-y-2">
                <div className="flex items-center gap-2.5 font-black text-lg sm:text-xl text-emerald-900">
                  <Globe className="w-6 h-6 text-emerald-700 flex-shrink-0" />
                  <span>Zero Foreign Fees</span>
                </div>
                <p className="text-sm sm:text-base font-extrabold text-slate-900 leading-relaxed">
                  Shop and travel anywhere in the world with zero extra exchange or foreign transaction fees.
                </p>
              </div>

              {/* Feature 4 */}
              <div className="p-5 rounded-2xl bg-white border-2 border-emerald-600 shadow-sm space-y-2">
                <div className="flex items-center gap-2.5 font-black text-lg sm:text-xl text-emerald-900">
                  <Zap className="w-6 h-6 text-emerald-700 flex-shrink-0" />
                  <span>Instant Spend Alerts</span>
                </div>
                <p className="text-sm sm:text-base font-extrabold text-slate-900 leading-relaxed">
                  Get notified on your phone the very second any payment is made with your card.
                </p>
              </div>
            </div>

            {/* Dynamic Cashback Calculator with Plain English Explanation */}
            <div className="p-6 sm:p-8 rounded-3xl bg-white border-2 border-emerald-600 shadow-xl space-y-6">
              
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b-2 border-slate-100 pb-5">
                <div className="space-y-1.5">
                  <h4 className="text-2xl sm:text-3xl font-black text-slate-950">Annual Cashback Estimator</h4>
                  <p className="text-base sm:text-lg font-extrabold text-emerald-800">
                    Earn 2.5% cash back automatically on all your everyday card purchases.
                  </p>
                </div>
                <div className="text-left sm:text-right bg-emerald-50 px-5 py-3 rounded-2xl border-2 border-emerald-500 shadow-sm flex-shrink-0">
                  <div className="text-3xl sm:text-4xl font-black text-emerald-800 font-mono">+${annualCashback.toLocaleString()}</div>
                  <div className="text-xs sm:text-sm font-black uppercase tracking-wider text-slate-950">Estimated Yearly Cashback</div>
                </div>
              </div>

              {/* Plain English Explanation Box */}
              <div className="bg-slate-50 rounded-2xl p-5 sm:p-6 border-2 border-slate-300 space-y-2 text-base font-bold text-slate-900">
                <div className="text-emerald-900 font-black text-base sm:text-lg uppercase tracking-wide flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-emerald-700" />
                  How the 2.5% Cashback Works:
                </div>
                <p className="text-base sm:text-lg font-extrabold text-slate-900 leading-relaxed">
                  Every time you swipe, tap, or shop online with your Monvera card, exactly <strong>2.5% ($2.50 for every $100 spent)</strong> is calculated and paid straight back into your account. At <span className="text-slate-950 font-black">${monthlySpend.toLocaleString()}/month</span>, you earn <span className="text-emerald-800 font-black">${monthlyCashback.toLocaleString()}</span> every single month, adding up to <span className="text-emerald-800 font-black">${annualCashback.toLocaleString()}</span> cash earned each year.
                </p>
              </div>

              {/* Slider Controls */}
              <div className="space-y-3.5">
                <div className="flex justify-between items-center text-base sm:text-lg font-black text-slate-950">
                  <span>Your Monthly Card Spending:</span>
                  <span className="font-mono text-emerald-900 font-black text-xl bg-emerald-100 px-4 py-1.5 rounded-xl border-2 border-emerald-400">
                    ${monthlySpend.toLocaleString()} / month
                  </span>
                </div>
                <input
                  type="range"
                  min="500"
                  max="20000"
                  step="250"
                  value={monthlySpend}
                  onChange={(e) => setMonthlySpend(Number(e.target.value))}
                  className="w-full accent-emerald-600 cursor-pointer h-3.5 bg-slate-200 rounded-lg"
                />
                <div className="flex justify-between text-sm sm:text-base text-slate-800 font-black font-mono">
                  <span>$500</span>
                  <span>$10,000</span>
                  <span>$20,000</span>
                </div>
              </div>

              {/* Action Button */}
              <div className="pt-2 flex justify-end">
                <button
                  onClick={() => {
                    if (currentUser) setCurrentView('cards');
                    else openModal('auth_register');
                  }}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 text-base sm:text-lg font-black text-white bg-gradient-to-b from-emerald-600 via-emerald-700 to-emerald-800 hover:from-emerald-500 hover:to-emerald-700 border-2 border-emerald-500 border-b-[5px] border-b-emerald-950 px-8 py-4 rounded-xl shadow-xl active:translate-y-1 active:border-b-[2px] transition-all cursor-pointer"
                >
                  <span>{currentUser ? 'Manage Your Cards' : 'Apply for Monvera Obsidian Card'}</span>
                  <ArrowRight className="w-5 h-5 text-white" />
                </button>
              </div>
            </div>

          </div>

        </div>

      </div>
    </section>
  );
};

