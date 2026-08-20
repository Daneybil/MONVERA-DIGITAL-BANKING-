import React from 'react';
import { ShieldCheck, Lock, KeyRound, BellRing, Smartphone, CheckCircle, RefreshCw, Sparkles, Building2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import monveraBankHqImage from '../../assets/images/monvera_bank_entrance_1787207250044.jpg';

export const SecuritySection: React.FC = () => {
  const { openModal, currentUser, setCurrentView } = useAuth();

  const securityFeatures = [
    {
      icon: Lock,
      title: 'End-to-End Ledger Encryption',
      description: 'All financial transmissions and customer database states are protected with AES-256 GCM encryption and TLS 1.3 protocol standards.',
    },
    {
      icon: KeyRound,
      title: 'Hardware & Biometric 2FA',
      description: 'Support for hardware security keys (FIDO2/WebAuthn), TOTP authenticator apps, and biometric verification on Apple & Android devices.',
    },
    {
      icon: BellRing,
      title: 'Real-Time Anomaly Monitoring',
      description: 'Intelligent heuristics analyze transaction velocity, geographic anomalies, and device fingerprints to flag unauthorized attempts instantly.',
    },
    {
      icon: Smartphone,
      title: 'Remote Session Killswitch',
      description: 'View every active device, IP address, and browser session with the capability to terminate suspicious sessions with a single tap.',
    },
  ];

  return (
    <section id="security" className="py-20 lg:py-28 bg-white border-t-2 border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Prominent Architectural Image of People Walking into Monvera Digital Bank */}
        <div className="relative mb-14 max-w-5xl mx-auto">
          {/* Unobstructed Image Container */}
          <div className="relative rounded-3xl overflow-hidden border-2 border-emerald-500 shadow-2xl shadow-emerald-950/20 group">
            <img
              src={monveraBankHqImage}
              alt="Monvera Digital Bank Global Headquarters"
              className="w-full h-64 sm:h-80 md:h-[450px] object-cover object-center group-hover:scale-105 transition-transform duration-700"
              referrerPolicy="no-referrer"
            />
          </div>

          {/* Clean Badges Positioned Directly Underneath the Image */}
          <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-3.5 p-4 sm:p-5 rounded-2xl bg-slate-950 text-white border-2 border-emerald-500 shadow-xl">
            <div className="flex items-center gap-3">
              <Building2 className="w-6 h-6 text-amber-400 flex-shrink-0" />
              <span className="text-base sm:text-lg font-black tracking-wide text-white">
                Monvera Digital Bank, Global Headquarters
              </span>
            </div>
            <div className="flex items-center gap-2 bg-emerald-950 text-emerald-300 px-4 py-2 rounded-xl text-sm sm:text-base font-black border-2 border-emerald-500 shadow-md">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              <span>Licensed & Regulated Institution</span>
            </div>
          </div>
        </div>

        {/* Section Heading & Subtitle - High Contrast, Big & Thick Bold Typography */}
        <div className="text-center max-w-3xl mx-auto space-y-4 mb-16">
          <h2 className="text-3xl sm:text-5xl lg:text-6xl font-black tracking-tight text-slate-950">
            Protected by Modern Cryptographic Rigor
          </h2>
          <p className="text-lg sm:text-xl lg:text-2xl text-slate-900 font-extrabold leading-relaxed">
            Engineered to rigorous banking compliance specifications to ensure your identity, accounts, and ledger records remain inviolable.
          </p>
        </div>

        {/* 4 Feature Cards with Large, Bold, Bright & Thick Styling */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {securityFeatures.map((feat) => {
            const Icon = feat.icon;
            return (
              <div
                key={feat.title}
                className="p-6 sm:p-7 rounded-3xl bg-slate-50 border-2 border-emerald-500/60 space-y-4 hover:bg-white hover:border-emerald-600 hover:shadow-xl transition-all"
              >
                <div className="w-14 h-14 rounded-2xl bg-slate-950 text-emerald-400 border-2 border-emerald-500 flex items-center justify-center shadow-md">
                  <Icon className="w-7 h-7" />
                </div>
                <h3 className="text-xl sm:text-2xl font-black text-slate-950">{feat.title}</h3>
                <p className="text-base sm:text-lg font-extrabold text-slate-800 leading-relaxed">{feat.description}</p>
              </div>
            );
          })}
        </div>

        {/* Security Disclosures Banner - Extra Bold and Bright */}
        <div className="mt-14 p-6 sm:p-8 rounded-3xl bg-slate-950 text-white border-2 border-emerald-500 shadow-2xl flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-950 text-emerald-300 border-2 border-emerald-400 flex items-center justify-center flex-shrink-0 shadow-md">
              <ShieldCheck className="w-8 h-8" />
            </div>
            <div className="space-y-1">
              <div className="text-base sm:text-xl font-black text-white">Full-Stack Regulatory & Deposit Protection</div>
              <div className="text-sm sm:text-base font-bold text-slate-200 leading-relaxed">
                Banking services provided through partner financial institutions, Member FDIC. Deposits are insured up to standard statutory limits.
              </div>
            </div>
          </div>
          <button
            onClick={() => {
              if (currentUser) setCurrentView('security');
              else openModal('auth_login');
            }}
            className="w-full md:w-auto whitespace-nowrap px-7 py-4 rounded-xl text-base font-black text-white bg-gradient-to-b from-emerald-600 via-emerald-700 to-emerald-800 hover:from-emerald-500 hover:to-emerald-700 border-2 border-emerald-400 border-b-[5px] border-b-emerald-950 shadow-xl active:translate-y-1 active:border-b-[2px] transition-all cursor-pointer flex-shrink-0"
          >
            {currentUser ? 'Open Security Center' : 'Review Security Protocols'}
          </button>
        </div>

      </div>
    </section>
  );
};
