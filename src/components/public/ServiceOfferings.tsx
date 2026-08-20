import React from 'react';
import { Wallet, PiggyBank, TrendingUp, CreditCard, Building2, ArrowRight, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export const ServiceOfferings: React.FC = () => {
  const { openModal, currentUser, setCurrentView } = useAuth();

  const offerings = [
    {
      icon: Wallet,
      title: 'Everyday Checking Accounts',
      tag: 'Zero Fees • Instant Access',
      description: 'Simple and transparent personal checking with zero monthly fees, a dedicated 10-digit account number, and instant transfers anytime.',
      action: 'Open Checking Account',
      tagBg: 'bg-emerald-100 text-emerald-900 border-emerald-300',
    },
    {
      icon: PiggyBank,
      title: 'High-Yield Treasury & Savings',
      tag: '4.85% APY • Daily Compound',
      description: 'Keep your money safe, liquid, and growing with 4.85% APY annual yield. Interest compounds daily with automatic monthly payouts.',
      action: 'Start Saving Today',
      tagBg: 'bg-emerald-100 text-emerald-900 border-emerald-300',
    },
    {
      icon: TrendingUp,
      title: 'Term Investments',
      tag: '60 to 360 Days • 4.50% / 24h',
      description: 'Choose fixed terms from 60 to 360 days and earn a guaranteed 4.50% interest every 24 hours, credited directly to your balance.',
      action: 'Explore 11 Term Plans',
      tagBg: 'bg-amber-100 text-amber-950 border-amber-300',
    },
    {
      icon: CreditCard,
      title: 'Monvera Obsidian Metal Cards',
      tag: '2.5% Unlimited Cashback',
      description: 'Heavy metal card and instant virtual debit cards with unlimited 2.5% cashback on every purchase, zero foreign fees, and instant freeze controls.',
      action: 'Get Your Obsidian Card',
      tagBg: 'bg-slate-900 text-white border-slate-700',
    },
    {
      icon: Building2,
      title: 'Business Banking Suite',
      tag: 'Commercial Growth',
      description: 'Full-featured banking built for business: multi-user team access, automated payroll batches, high transfer limits, and dedicated 24/7 support.',
      action: 'Open Business Account',
      tagBg: 'bg-blue-100 text-blue-950 border-blue-300',
    },
  ];

  const handleAction = (itemTitle: string) => {
    if (currentUser) {
      if (itemTitle.includes('Term')) setCurrentView('investments');
      else if (itemTitle.includes('Obsidian')) setCurrentView('cards');
      else if (itemTitle.includes('Business')) setCurrentView('business');
      else setCurrentView('accounts');
    } else {
      if (itemTitle.includes('Term')) {
        setCurrentView('investments');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        openModal('auth_register');
      }
    }
  };

  return (
    <section id="offerings" className="py-20 lg:py-28 bg-white border-y-2 border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Header with Bold, Thick, High-Contrast Typography */}
        <div className="text-center max-w-3xl mx-auto space-y-4 mb-16">
          <div className="inline-flex items-center gap-2 text-sm sm:text-base font-black uppercase tracking-wider text-emerald-900 bg-emerald-100 px-4 py-1.5 rounded-xl border-2 border-emerald-400 shadow-xs">
            <ShieldCheck className="w-4 h-4 text-emerald-700" />
            <span>Comprehensive Financial Capabilities</span>
          </div>
          <h2 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight text-slate-950">
            What Monvera Offers
          </h2>
          <p className="text-lg sm:text-xl lg:text-2xl text-slate-900 font-extrabold leading-relaxed">
            Modern, secure banking built for your personal wealth and business success with total transparency.
          </p>
        </div>

        {/* Offerings Grid - Extra Bold & Bright Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
          {offerings.map((item, idx) => {
            const Icon = item.icon;
            return (
              <div
                key={item.title}
                id={`offering-card-${idx}`}
                className="group p-8 rounded-3xl bg-slate-50 hover:bg-white border-2 border-slate-300 hover:border-emerald-500 hover:shadow-2xl transition-all duration-200 flex flex-col justify-between"
              >
                <div className="space-y-5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="w-14 h-14 rounded-2xl bg-slate-950 text-white border-2 border-emerald-500 flex items-center justify-center shadow-md group-hover:bg-emerald-600 transition-colors">
                      <Icon className="w-7 h-7 text-emerald-300 group-hover:text-white" />
                    </div>
                    <span className={`text-xs sm:text-sm font-black px-3 py-1.5 rounded-xl border-2 shadow-xs ${item.tagBg}`}>
                      {item.tag}
                    </span>
                  </div>

                  <h3 className="text-2xl sm:text-3xl font-black text-slate-950 tracking-tight leading-snug">
                    {item.title}
                  </h3>
                  <p className="text-base sm:text-lg font-extrabold text-slate-800 leading-relaxed">
                    {item.description}
                  </p>
                </div>

                <div className="pt-6 mt-6 border-t-2 border-slate-200">
                  <button
                    onClick={() => handleAction(item.title)}
                    className="w-full inline-flex items-center justify-between gap-2 py-3 px-4 rounded-xl text-base font-black text-emerald-950 bg-emerald-100 hover:bg-emerald-600 hover:text-white border-2 border-emerald-400 transition-all cursor-pointer shadow-sm"
                  >
                    <span>{item.action}</span>
                    <ArrowRight className="w-5 h-5 flex-shrink-0" />
                  </button>
                </div>
              </div>
            );
          })}

          {/* Sixth Feature Block: Monvera Full-Reserve & Deposit Safety */}
          <div className="p-8 rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 text-white border-2 border-emerald-400 flex flex-col justify-between shadow-2xl space-y-6">
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <span className="text-xs sm:text-sm font-black uppercase tracking-wider text-emerald-300 bg-emerald-950 px-3.5 py-1.5 rounded-xl border-2 border-emerald-500">
                  100% Full-Reserve Security
                </span>
                <ShieldCheck className="w-8 h-8 text-emerald-400" />
              </div>
              <h3 className="text-2xl sm:text-3xl font-black text-white tracking-tight leading-snug">
                Guaranteed Deposit Protection & Peace of Mind
              </h3>
              <p className="text-base sm:text-lg font-extrabold text-slate-200 leading-relaxed">
                Unlike traditional banks that lend out your deposits, Monvera holds 100% full backing for every dollar in real time. Your funds are always ready, protected, and FDIC-insured up to $250,000 via our partner financial institutions.
              </p>
            </div>

            <div className="pt-6 border-t-2 border-slate-700">
              <button
                onClick={() => {
                  if (currentUser) setCurrentView('dashboard');
                  else openModal('auth_register');
                }}
                className="w-full inline-flex items-center justify-center gap-2 py-4 px-6 rounded-xl text-base sm:text-lg font-black bg-gradient-to-b from-emerald-500 to-emerald-700 hover:from-emerald-400 hover:to-emerald-600 text-white border-2 border-emerald-400 border-b-[5px] border-b-emerald-950 shadow-xl active:translate-y-1 active:border-b-[2px] transition-all cursor-pointer"
              >
                <span>{currentUser ? 'Go to Your Dashboard' : 'Open a Verified Account'}</span>
                <ArrowRight className="w-5 h-5 text-emerald-100" />
              </button>
            </div>
          </div>
        </div>

      </div>
    </section>
  );
};
