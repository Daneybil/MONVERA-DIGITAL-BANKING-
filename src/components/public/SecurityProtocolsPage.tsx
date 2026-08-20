import React from 'react';
import { ShieldCheck, Lock, KeyRound, BellRing, Smartphone, CheckCircle, RefreshCw, Sparkles, Building2, AlertTriangle, ShieldAlert } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export const SecurityProtocolsPage: React.FC = () => {
  const { setCurrentView, openModal, currentUser } = useAuth();

  return (
    <div className="py-12 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto space-y-12">
      {/* Header Banner */}
      <div className="text-center space-y-4 max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-950/80 border-2 border-emerald-500 text-emerald-300 text-sm font-black tracking-wide">
          <ShieldCheck className="w-4 h-4" />
          <span>Verified Security Protocols & Asset Protection Framework</span>
        </div>
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-white tracking-tight">
          Monvera Security Protocols
        </h1>
        <p className="text-lg sm:text-xl font-bold text-slate-300 leading-relaxed">
          Comprehensive banking security engineered with cryptographic rigor, continuous anomaly detection, and partner FDIC insurance safeguards.
        </p>
        <div className="text-sm font-mono text-emerald-400 font-bold">
          Zero-Trust Security Standard • 24/7 Monitored Protection
        </div>
      </div>

      {/* Main Content Cards */}
      <div className="space-y-8 bg-slate-900/90 rounded-3xl p-6 sm:p-10 border-2 border-slate-700 shadow-2xl text-slate-200">
        
        {/* Protocol 1: End-to-End Cryptography */}
        <section className="space-y-3 pb-6 border-b border-slate-800">
          <div className="flex items-center gap-3 text-2xl font-black text-white">
            <div className="w-10 h-10 rounded-xl bg-slate-950 text-emerald-400 border-2 border-emerald-500 flex items-center justify-center">
              <Lock className="w-6 h-6" />
            </div>
            <h2>1. End-to-End Cryptographic Ledger Encryption</h2>
          </div>
          <p className="text-base sm:text-lg leading-relaxed text-slate-300 font-medium">
            All user balances, transactions, and term contracts are mathematically encrypted using <strong>AES-256-GCM</strong> and isolated via double-entry reconciliation. No balance can be altered without dual-entry verification, eliminating tampering or unauthorized ledger adjustments.
          </p>
        </section>

        {/* Protocol 2: Multi-Factor & Biometrics */}
        <section className="space-y-3 pb-6 border-b border-slate-800">
          <div className="flex items-center gap-3 text-2xl font-black text-white">
            <div className="w-10 h-10 rounded-xl bg-slate-950 text-emerald-400 border-2 border-emerald-500 flex items-center justify-center">
              <KeyRound className="w-6 h-6" />
            </div>
            <h2>2. Hardware & Biometric Two-Factor Authentication (2FA)</h2>
          </div>
          <p className="text-base sm:text-lg leading-relaxed text-slate-300 font-medium">
            Every critical action—including funds withdrawal, term investment opening, and recipient address updates—requires biometric authentication (FaceID, TouchID, or FIDO2 hardware security keys). Session tokens expire automatically to prevent unauthorized access.
          </p>
        </section>

        {/* Protocol 3: Real-Time Monitoring */}
        <section className="space-y-3 pb-6 border-b border-slate-800">
          <div className="flex items-center gap-3 text-2xl font-black text-white">
            <div className="w-10 h-10 rounded-xl bg-slate-950 text-emerald-400 border-2 border-emerald-500 flex items-center justify-center">
              <BellRing className="w-6 h-6" />
            </div>
            <h2>3. 24/7 Automated Anomaly & Fraud Detection</h2>
          </div>
          <p className="text-base sm:text-lg leading-relaxed text-slate-300 font-medium">
            Our automated security models analyze incoming transactions, device locations, and velocity metrics in real time. Any suspicious activity triggers immediate push notifications and a temporary hold until you explicitly confirm the transaction.
          </p>
        </section>

        {/* Protocol 4: Remote Killswitch */}
        <section className="space-y-3 pb-6 border-b border-slate-800">
          <div className="flex items-center gap-3 text-2xl font-black text-white">
            <div className="w-10 h-10 rounded-xl bg-slate-950 text-emerald-400 border-2 border-emerald-500 flex items-center justify-center">
              <Smartphone className="w-6 h-6" />
            </div>
            <h2>4. Remote Session Killswitch & Instant Card Freeze</h2>
          </div>
          <p className="text-base sm:text-lg leading-relaxed text-slate-300 font-medium">
            Lost your phone or suspect device compromise? You can instantly terminate all active sessions, invalidate tokens, and freeze your Monvera Obsidian Card with one tap from any web browser or by calling our emergency security hotline.
          </p>
        </section>

        {/* Protocol 5: FDIC Deposit Custody */}
        <section className="space-y-3">
          <div className="flex items-center gap-3 text-2xl font-black text-white">
            <div className="w-10 h-10 rounded-xl bg-slate-950 text-emerald-400 border-2 border-emerald-500 flex items-center justify-center">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <h2>5. FDIC Partner Deposit Insurance & Regulatory Oversight</h2>
          </div>
          <p className="text-base sm:text-lg leading-relaxed text-slate-300 font-medium">
            Monvera works with licensed partner financial institutions, Members FDIC. All deposits are held under US regulatory standards and protected up to $250,000 per depositor, guaranteeing that your sovereign capital is always secure.
          </p>
        </section>

      </div>

      {/* Bottom Action */}
      <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
        <button
          onClick={() => {
            setCurrentView('home');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className="px-6 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-black text-base border border-slate-600 transition-colors"
        >
          Return to Monvera Home
        </button>
        {currentUser ? (
          <button
            onClick={() => setCurrentView('security')}
            className="px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-base transition-colors shadow-lg"
          >
            Configure Your Security Settings
          </button>
        ) : (
          <button
            onClick={() => openModal('auth_register')}
            className="px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-base transition-colors shadow-lg"
          >
            Open Protected Account
          </button>
        )}
      </div>
    </div>
  );
};
