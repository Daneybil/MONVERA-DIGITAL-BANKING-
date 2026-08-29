import React, { useState } from 'react';
import {
  Banknote,
  TrendingUp,
  ShieldCheck,
  Zap,
  ArrowRight,
  Calculator,
  Award,
  CheckCircle2,
  Coins,
  ChevronRight,
  Layers,
  AlertTriangle,
  ShieldAlert,
  Gavel,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export const LoanSection: React.FC = () => {
  const { openModal, currentUser, setCurrentView } = useAuth();

  // Interactive loan calculator state
  const [loanAmount, setLoanAmount] = useState<number>(25000);
  const [termMonths, setTermMonths] = useState<number>(6);

  // Fixed 20% Loan Interest Rate
  const fixedRate = 20.0;
  const totalInterest = Number((loanAmount * 0.20).toFixed(2));
  const totalRepayment = Number((loanAmount * 1.20).toFixed(2));
  const monthlyPayment = Math.round(totalRepayment / termMonths);

  return (
    <section id="loans" className="py-20 lg:py-28 bg-slate-50 relative overflow-hidden border-t-2 border-slate-200">
      {/* Background Decorative Grid */}
      <div className="absolute inset-0 bg-[radial-gradient(#059669_1px,transparent_1px)] [background-size:24px_24px] opacity-10 pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
        
        {/* Section Header */}
        <div className="text-center max-w-4xl mx-auto space-y-4 mb-16">
          <div className="inline-flex items-center gap-2 text-sm sm:text-base font-black uppercase tracking-wider text-emerald-950 bg-emerald-100 px-4 py-2 rounded-xl border-2 border-emerald-400 shadow-sm">
            <Coins className="w-5 h-5 text-emerald-800" />
            <span>Monvera Credit & Liquidity Financing</span>
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-slate-950">
            Instant Loans From $1,000 to $1,000,000 USD
          </h2>
          <p className="text-slate-800 text-lg sm:text-xl font-bold leading-relaxed max-w-3xl mx-auto">
            Unlock flexible, high-capacity liquidity tailored for personal milestones, working capital, and enterprise expansion. Total loan interest is fixed at a transparent 20% of borrowed principal across all term options.
          </p>
        </div>

        {/* Dynamic Qualification & Tier Cards */}
        <div className="mb-16">
          <div className="text-center mb-8">
            <h3 className="text-2xl sm:text-3xl font-black text-slate-950">
              How Transaction-Driven Loan Eligibility Works
            </h3>
            <p className="text-slate-700 text-base sm:text-lg font-bold mt-2">
              No endless paperwork. Maintain a minimum cumulative deposit of $2,000+ to unlock your credit line, with higher transaction volumes unlocking up to $1,000,000.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Tier 1 */}
            <div className="bg-white rounded-2xl p-6 border-2 border-slate-300 shadow-sm flex flex-col justify-between hover:border-emerald-600 transition-all">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black uppercase tracking-wider text-emerald-900 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-300">
                    Tier 1 • Starter
                  </span>
                  <span className="text-xs font-bold text-slate-700">20% Fixed Interest</span>
                </div>
                <div className="text-2xl font-black text-slate-950 font-mono">$1,000 – $10,000</div>
                <p className="text-sm font-bold text-slate-700 leading-relaxed">
                  Unlocked upon reaching $2,000 in account deposits or completed transaction volume. Perfect for rapid personal liquidity.
                </p>
              </div>
              <div className="mt-4 pt-4 border-t border-slate-100 text-xs font-black text-slate-800 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                <span>$2,000+ Completed Transactions</span>
              </div>
            </div>

            {/* Tier 2 */}
            <div className="bg-white rounded-2xl p-6 border-2 border-slate-300 shadow-sm flex flex-col justify-between hover:border-emerald-600 transition-all">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black uppercase tracking-wider text-emerald-900 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-300">
                    Tier 2 • Growth
                  </span>
                  <span className="text-xs font-bold text-slate-700">20% Fixed Interest</span>
                </div>
                <div className="text-2xl font-black text-slate-950 font-mono">$10,000 – $20,000</div>
                <p className="text-sm font-bold text-slate-700 leading-relaxed">
                  Ideal for small business inventory, equipment purchase, and consistent working capital replenishment.
                </p>
              </div>
              <div className="mt-4 pt-4 border-t border-slate-100 text-xs font-black text-slate-800 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                <span>$5,000+ Completed Transactions</span>
              </div>
            </div>

            {/* Tier 3 */}
            <div className="bg-white rounded-2xl p-6 border-2 border-emerald-500 shadow-md flex flex-col justify-between relative overflow-hidden">
              <div className="absolute top-0 right-0 bg-emerald-700 text-white text-[10px] font-black uppercase px-3 py-0.5 rounded-bl-lg">
                Popular
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black uppercase tracking-wider text-emerald-900 bg-emerald-100 px-2.5 py-1 rounded-md border border-emerald-400">
                    Tier 3 • Prime
                  </span>
                  <span className="text-xs font-bold text-slate-700">20% Fixed Interest</span>
                </div>
                <div className="text-2xl font-black text-slate-950 font-mono">$20,000 – $250,000</div>
                <p className="text-sm font-bold text-slate-700 leading-relaxed">
                  Unlocked upon reaching $10,000+ in transaction volume. Provides $20,000 to $50,000+ credit limits (up to $250,000 facility) for commercial expansion.
                </p>
              </div>
              <div className="mt-4 pt-4 border-t border-slate-100 text-xs font-black text-slate-800 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                <span>$10,000+ Volume ($20k+ Limit)</span>
              </div>
            </div>

            {/* Tier 4 */}
            <div className="bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 text-white rounded-2xl p-6 border-2 border-slate-700 shadow-xl flex flex-col justify-between">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black uppercase tracking-wider text-amber-300 bg-white/10 px-2.5 py-1 rounded-md border border-white/20">
                    Tier 4 • Sovereign
                  </span>
                  <span className="text-xs font-bold text-emerald-300">20% Fixed Interest</span>
                </div>
                <div className="text-2xl font-black text-white font-mono">$250k – $1,000,000</div>
                <p className="text-sm font-bold text-slate-300 leading-relaxed">
                  Institutional private credit facility for executive acquisitions, large commercial projects, and high-net-worth liquidity.
                </p>
              </div>
              <div className="mt-4 pt-4 border-t border-white/10 text-xs font-black text-emerald-300 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-amber-400 flex-shrink-0" />
                <span>$50,000+ Institutional Activity</span>
              </div>
            </div>
          </div>
        </div>

        {/* Interactive Loan Calculator & Feature Columns */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center mb-16">
          
          {/* Left Column: Loan Benefits */}
          <div className="lg:col-span-6 space-y-6">
            <div className="space-y-3">
              <span className="text-xs sm:text-sm font-black uppercase tracking-widest text-emerald-900 bg-emerald-100 px-3.5 py-1.5 rounded-lg border border-emerald-400 inline-block font-mono">
                Rapid Underwriting & Instant Credit
              </span>
              <h3 className="text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight text-slate-950">
                Transparent Capital on Your Own Terms
              </h3>
              <p className="text-slate-800 text-base sm:text-lg font-bold leading-relaxed">
                Experience seamless credit disbursement directly credited to your Monvera Checking Account. We deliver a flat 20% fixed interest, transparent monthly amortization, and full early repayment flexibility.
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex items-start gap-4 p-4 rounded-2xl bg-white border-2 border-slate-200 shadow-sm">
                <div className="w-12 h-12 rounded-xl bg-emerald-100 border-2 border-emerald-400 flex items-center justify-center flex-shrink-0">
                  <Zap className="w-6 h-6 text-emerald-800" />
                </div>
                <div>
                  <h4 className="text-lg font-black text-slate-950">Direct Checking Account Disbursement</h4>
                  <p className="text-sm font-bold text-slate-700">
                    Once approved by underwriting compliance, funds are deposited immediately into your liquid checking account balance.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4 p-4 rounded-2xl bg-white border-2 border-slate-200 shadow-sm">
                <div className="w-12 h-12 rounded-xl bg-emerald-100 border-2 border-emerald-400 flex items-center justify-center flex-shrink-0">
                  <ShieldCheck className="w-6 h-6 text-emerald-800" />
                </div>
                <div>
                  <h4 className="text-lg font-black text-slate-950">Fixed 20% Interest (Zero Hidden Fees)</h4>
                  <p className="text-sm font-bold text-slate-700">
                    Total interest is always 20% of your borrowed loan amount, with no surprise costs or hidden management fees.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4 p-4 rounded-2xl bg-white border-2 border-slate-200 shadow-sm">
                <div className="w-12 h-12 rounded-xl bg-emerald-100 border-2 border-emerald-400 flex items-center justify-center flex-shrink-0">
                  <TrendingUp className="w-6 h-6 text-emerald-800" />
                </div>
                <div>
                  <h4 className="text-lg font-black text-slate-950">Unlock $20,000+ with $10,000+ Volume</h4>
                  <p className="text-sm font-bold text-slate-700">
                    Deposit $2,000+ for starter facilities, and unlock $20,000 to $50,000+ borrowing power as your total transaction volume reaches $10,000+.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Interactive Loan Calculator Box */}
          <div className="lg:col-span-6">
            <div className="bg-white rounded-3xl p-6 sm:p-8 border-2 border-emerald-600 shadow-2xl space-y-6">
              <div className="flex items-center justify-between border-b-2 border-slate-100 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-100 border-2 border-emerald-400 flex items-center justify-center">
                    <Calculator className="w-5 h-5 text-emerald-800" />
                  </div>
                  <div>
                    <h4 className="text-xl sm:text-2xl font-black text-slate-950">Loan Estimate Calculator</h4>
                    <span className="text-xs font-bold text-emerald-800">Fixed 20% Interest Structure</span>
                  </div>
                </div>
                <span className="text-xs font-mono font-black uppercase text-emerald-900 bg-emerald-50 px-3 py-1 rounded-lg border border-emerald-300">
                  20.00% Fixed Interest
                </span>
              </div>

              {/* Amount Slider */}
              <div className="space-y-3">
                <div className="flex justify-between items-center text-base font-black text-slate-950">
                  <span>Desired Loan Amount:</span>
                  <span className="font-mono text-emerald-900 font-black text-2xl bg-emerald-100 px-4 py-1 rounded-xl border-2 border-emerald-400">
                    ${loanAmount.toLocaleString('en-US')}
                  </span>
                </div>
                <input
                  type="range"
                  min="1000"
                  max="1000000"
                  step="1000"
                  value={loanAmount}
                  onChange={(e) => setLoanAmount(Number(e.target.value))}
                  className="w-full accent-emerald-600 cursor-pointer h-3.5 bg-slate-200 rounded-lg"
                />
                <div className="flex justify-between text-xs sm:text-sm text-slate-800 font-bold font-mono">
                  <span>$1,000 (Min)</span>
                  <span>$250,000</span>
                  <span>$500,000</span>
                  <span>$1,000,000 (Max)</span>
                </div>
              </div>

              {/* Repayment Term Selector */}
              <div className="space-y-2.5">
                <label className="text-sm font-black text-slate-950 uppercase tracking-wider block">
                  Select Repayment Period:
                </label>
                <div className="grid grid-cols-5 gap-2">
                  {[6, 12, 24, 36, 48].map((months) => (
                    <button
                      key={months}
                      onClick={() => setTermMonths(months)}
                      className={`py-2.5 rounded-xl text-xs sm:text-sm font-black transition-all cursor-pointer ${
                        termMonths === months
                          ? 'bg-slate-950 text-white border-2 border-slate-950 shadow-md scale-105'
                          : 'bg-slate-100 text-slate-800 border border-slate-300 hover:bg-slate-200'
                      }`}
                    >
                      {months} Mo
                    </button>
                  ))}
                </div>
              </div>

              {/* 3-Card Summary: Monthly Installment | Fixed 20% Interest (Middle) | Total Repayment (Right) */}
              <div className="bg-slate-50 rounded-2xl p-4 sm:p-5 border-2 border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
                {/* 1. Monthly Installment */}
                <div className="p-3.5 bg-white rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between">
                  <div className="text-[11px] font-black uppercase tracking-wider text-slate-600">
                    Monthly Installment
                  </div>
                  <div className="text-xl sm:text-2xl font-black text-emerald-800 font-mono my-1">
                    ${monthlyPayment.toLocaleString('en-US')}
                  </div>
                  <div className="text-[10px] font-bold text-slate-500">{termMonths} monthly payments</div>
                </div>

                {/* 2. Fixed 20% Interest In The Middle */}
                <div className="p-3.5 bg-amber-50 rounded-xl border-2 border-amber-300 shadow-xs flex flex-col justify-between">
                  <div className="text-[11px] font-black uppercase tracking-wider text-amber-950">
                    Fixed 20% Interest
                  </div>
                  <div className="text-xl sm:text-2xl font-black text-amber-900 font-mono my-1">
                    ${totalInterest.toLocaleString('en-US')}
                  </div>
                  <div className="text-[10px] font-bold text-amber-800">Due at loan maturity</div>
                </div>

                {/* 3. Total Repayment */}
                <div className="p-3.5 bg-white rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between">
                  <div className="text-[11px] font-black uppercase tracking-wider text-slate-600">
                    Total Repayment
                  </div>
                  <div className="text-xl sm:text-2xl font-black text-slate-950 font-mono my-1">
                    ${totalRepayment.toLocaleString('en-US')}
                  </div>
                  <div className="text-[10px] font-bold text-emerald-700">Principal + 20% interest</div>
                </div>
              </div>

              {/* CTA Button */}
              <button
                onClick={() => {
                  if (currentUser) {
                    setCurrentView('loans');
                  } else {
                    openModal('auth_register');
                  }
                }}
                className="w-full inline-flex items-center justify-center gap-2 text-base sm:text-lg font-black text-white bg-gradient-to-b from-emerald-600 via-emerald-700 to-emerald-800 hover:from-emerald-500 hover:to-emerald-700 border-2 border-emerald-500 border-b-[5px] border-b-emerald-950 px-8 py-4 rounded-xl shadow-xl active:translate-y-1 active:border-b-[2px] transition-all cursor-pointer"
              >
                <span>{currentUser ? 'Apply Now in Dashboard' : 'Apply for Monvera Loan ($1k - $1M)'}</span>
                <ArrowRight className="w-5 h-5 text-white" />
              </button>
            </div>
          </div>

        </div>

        {/* High-Definition Loan Executive Showcase Image */}
        <div className="relative rounded-3xl overflow-hidden border-2 border-slate-300 shadow-2xl bg-slate-950 mb-12">
          <div className="grid grid-cols-1 lg:grid-cols-12 items-center">
            <div className="lg:col-span-7 relative h-72 sm:h-96 lg:h-[460px] w-full overflow-hidden">
              <img
                src="/src/assets/images/monvera_executive_loan_growth_1787939265899.jpg"
                alt="Monvera Executive Commercial Loan Growth & Private Credit"
                className="w-full h-full object-cover object-center"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent lg:bg-gradient-to-r lg:from-transparent lg:to-slate-950" />
            </div>
            <div className="lg:col-span-5 p-8 sm:p-10 space-y-5 text-white">
              <span className="text-xs sm:text-sm font-black uppercase tracking-widest text-emerald-400 bg-emerald-950/80 px-3.5 py-1.5 rounded-lg border border-emerald-500/40 inline-block font-mono">
                Institutional Capital Deployment
              </span>
              <h3 className="text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight text-white">
                Empowering Business Expansion & Private Wealth
              </h3>
              <p className="text-slate-300 text-base sm:text-lg font-bold leading-relaxed">
                Whether you need $5,000 for immediate operational flexibility or $1,000,000 for strategic corporate acquisitions, Monvera credit underwriting provides rapid decisions, dedicated relationship managers, and swift execution.
              </p>
              <div className="flex flex-wrap gap-4 pt-2">
                <div className="bg-white/10 backdrop-blur-md border border-white/20 px-4 py-2.5 rounded-xl">
                  <div className="text-xl sm:text-2xl font-black text-amber-300 font-mono">&lt; 24 Hours</div>
                  <div className="text-xs font-bold text-slate-300 uppercase">Underwriting Turnaround</div>
                </div>
                <div className="bg-white/10 backdrop-blur-md border border-white/20 px-4 py-2.5 rounded-xl">
                  <div className="text-xl sm:text-2xl font-black text-emerald-400 font-mono">$1,000,000</div>
                  <div className="text-xs font-bold text-slate-300 uppercase">Max Single Facility</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Scary Institutional Legal Warning & Anti-Default Compliance Notice */}
        <div className="rounded-3xl p-6 sm:p-8 bg-red-950/95 border-2 border-red-500 shadow-2xl text-white space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-red-900 border-2 border-red-400 flex items-center justify-center text-red-200 flex-shrink-0">
              <Gavel className="w-6 h-6" />
            </div>
            <div>
              <div className="text-xs font-mono font-black uppercase tracking-widest text-red-300">
                Institutional Regulatory Notice • Enforceable Promissory Covenant
              </div>
              <h4 className="text-lg sm:text-xl font-black text-white">
                Legal Compliance & Zero-Tolerance Anti-Default Enforcement Notice
              </h4>
            </div>
          </div>

          <p className="text-xs sm:text-sm font-bold text-red-100 leading-relaxed">
            All Monvera credit facilities and liquidity loans are legally binding financial contracts registered under federal banking compliance and international credit enforcement treaties. Borrowers are legally obligated to meet all repayment schedules on or before maturity.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 text-xs font-bold text-red-200">
            <div className="p-3.5 bg-red-900/60 rounded-xl border border-red-400/40 space-y-1">
              <span className="font-black text-white uppercase block">Global Credit Reporting</span>
              <p>Defaulting accounts are immediately submitted to international credit bureaus (Equifax, Experian, TransUnion), permanently damaging credit scores globally.</p>
            </div>

            <div className="p-3.5 bg-red-900/60 rounded-xl border border-red-400/40 space-y-1">
              <span className="font-black text-white uppercase block">Asset Freezing & Recovery</span>
              <p>Failure to repay triggers immediate account freezes, liquidation of linked collateral or balances, and cross-border commercial debt recovery enforcement.</p>
            </div>

            <div className="p-3.5 bg-red-900/60 rounded-xl border border-red-400/40 space-y-1">
              <span className="font-black text-white uppercase block">Criminal Fraud Prosecution</span>
              <p>Attempting to borrow funds with intention of evasion or fraudulent identity constitutes financial felony theft, prosecuted to the maximum extent of the law.</p>
            </div>
          </div>
        </div>

      </div>
    </section>
  );
};
