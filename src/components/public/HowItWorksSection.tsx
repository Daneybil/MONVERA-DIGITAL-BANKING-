import React from 'react';
import { UserCheck, Landmark, ArrowLeftRight, Activity, ArrowRight, Banknote, ShieldAlert } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export const HowItWorksSection: React.FC = () => {
  const { openModal, currentUser, setCurrentView } = useAuth();

  const steps = [
    {
      step: '01',
      title: 'Open & Verify Account',
      icon: UserCheck,
      description: 'Complete our secure 2-minute onboarding to receive your unique permanent 10-digit Monvera account number and verified profile.',
    },
    {
      step: '02',
      title: 'Fund & Transact',
      icon: Landmark,
      description: 'Deposit funds or transact $2,000+ to automatically establish your verified credit score and unlock your initial liquidity facility.',
    },
    {
      step: '03',
      title: 'Request Instant Loan',
      icon: Banknote,
      description: 'Apply for $1,000 to $1,000,000 USD credit lines with a flat 20% fixed interest, direct checking account disbursement, and rapid approval.',
    },
    {
      step: '04',
      title: 'Manage & Repay Effortlessly',
      icon: Activity,
      description: 'Track daily earnings, make automated installment payments, build institutional credit history, and scale to higher credit tiers seamlessly.',
    },
  ];

  return (
    <section id="how-it-works" className="py-20 lg:py-28 bg-white border-b-2 border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        <div className="text-center max-w-3xl mx-auto space-y-4 mb-16">
          <span className="text-xs sm:text-sm font-black uppercase tracking-wider text-emerald-900 bg-emerald-100 px-4 py-1.5 rounded-xl border-2 border-emerald-400">
            Frictionless Onboarding & Credit
          </span>
          <h2 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight text-slate-950">
            How Monvera Works
          </h2>
          <p className="text-lg sm:text-xl font-extrabold text-slate-900 leading-relaxed">
            A simple, transparent four-step journey designed for everyday banking, high-yield savings, and rapid credit liquidity.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {steps.map((item, idx) => {
            const Icon = item.icon;
            return (
              <div
                key={item.step}
                className="relative p-6 sm:p-7 rounded-3xl bg-slate-50 border-2 border-slate-300 flex flex-col justify-between space-y-6 hover:bg-white hover:border-emerald-500 hover:shadow-xl transition-all"
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-3xl font-black text-emerald-700">{item.step}</span>
                    <div className="w-12 h-12 rounded-2xl bg-slate-950 text-emerald-400 border-2 border-emerald-500 flex items-center justify-center shadow-md">
                      <Icon className="w-6 h-6" />
                    </div>
                  </div>
                  <h3 className="text-xl sm:text-2xl font-black text-slate-950">{item.title}</h3>
                  <p className="text-base sm:text-lg font-extrabold text-slate-800 leading-relaxed">{item.description}</p>
                </div>

                <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full"
                    style={{ width: `${(idx + 1) * 25}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-12 text-center">
          <button
            onClick={() => {
              if (currentUser) setCurrentView('dashboard');
              else openModal('auth_register');
            }}
            className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl font-black text-base sm:text-lg text-white bg-gradient-to-b from-emerald-600 to-emerald-800 hover:from-emerald-500 hover:to-emerald-700 border-2 border-emerald-400 border-b-[5px] border-b-emerald-950 shadow-xl active:translate-y-1 active:border-b-[2px] transition-all cursor-pointer"
          >
            <span>{currentUser ? 'Return to Dashboard' : 'Open Your Account in 2 Minutes'}</span>
            <ArrowRight className="w-5 h-5 text-emerald-100" />
          </button>
        </div>

      </div>
    </section>
  );
};
