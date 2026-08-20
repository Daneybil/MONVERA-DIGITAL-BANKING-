import React from 'react';
import { FileText, ShieldCheck, CheckCircle2, Building2, CreditCard, Sparkles, Lock } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export const TermsOfServicePage: React.FC = () => {
  const { setCurrentView, openModal, currentUser } = useAuth();

  return (
    <div className="py-12 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto space-y-12">
      {/* Header Banner */}
      <div className="text-center space-y-4 max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-950/80 border-2 border-emerald-500 text-emerald-300 text-sm font-black tracking-wide">
          <FileText className="w-4 h-4" />
          <span>Official Customer Terms & Banking Service Agreement</span>
        </div>
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-white tracking-tight">
          Monvera & Nuvera Terms of Service
        </h1>
        <p className="text-lg sm:text-xl font-bold text-slate-300 leading-relaxed">
          Clear, simple, and straightforward rules designed to protect you, foster financial growth, and provide sovereign banking freedom.
        </p>
        <div className="text-sm font-mono text-emerald-400 font-bold">
          Updated: August 2026 • Member FDIC Partner Protection
        </div>
      </div>

      {/* Main Content Cards */}
      <div className="space-y-8 bg-slate-900/90 rounded-3xl p-6 sm:p-10 border-2 border-slate-700 shadow-2xl text-slate-200">
        
        {/* Section 1 */}
        <section className="space-y-3 pb-6 border-b border-slate-800">
          <div className="flex items-center gap-3 text-2xl font-black text-white">
            <span className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center text-base font-black">1</span>
            <h2>Welcome & Agreement Overview</h2>
          </div>
          <p className="text-base sm:text-lg leading-relaxed text-slate-300 font-medium">
            Welcome to Monvera. By creating an account or accessing our services (provided under the technology banner of Monvera and Nuvera Financial Technologies), you agree to these transparent Terms of Service. These terms are written in straightforward language so you always understand your rights, rewards, and protections.
          </p>
        </section>

        {/* Section 2 */}
        <section className="space-y-3 pb-6 border-b border-slate-800">
          <div className="flex items-center gap-3 text-2xl font-black text-white">
            <span className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center text-base font-black">2</span>
            <h2>Platform Model & FDIC Partner Financial Institutions</h2>
          </div>
          <p className="text-base sm:text-lg leading-relaxed text-slate-300 font-medium">
            Monvera is a financial technology platform, not a standalone chartered bank. Banking products, depository accounts, and payment settlements are delivered through our licensed partner financial institutions, Members FDIC. Your funds are held securely in FDIC-insured accounts up to $250,000 per depositor.
          </p>
          <div className="p-4 rounded-xl bg-emerald-950/60 border border-emerald-500 text-emerald-200 text-sm font-bold flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-emerald-400 flex-shrink-0" />
            <span>All deposits are held in real, verifiable partner bank accounts with double-entry cryptographic reconciliation.</span>
          </div>
        </section>

        {/* Section 3 */}
        <section className="space-y-3 pb-6 border-b border-slate-800">
          <div className="flex items-center gap-3 text-2xl font-black text-white">
            <span className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center text-base font-black">3</span>
            <h2>Account Eligibility & Verification</h2>
          </div>
          <p className="text-base sm:text-lg leading-relaxed text-slate-300 font-medium">
            To register for a Monvera account, you must be of legal age in your jurisdiction and pass standard identity verification. You agree to provide accurate information and keep your login credentials and two-factor authentication methods secure.
          </p>
        </section>

        {/* Section 4 */}
        <section className="space-y-3 pb-6 border-b border-slate-800">
          <div className="flex items-center gap-3 text-2xl font-black text-white">
            <span className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center text-base font-black">4</span>
            <h2>Term Investments & Guaranteed Yield Payouts</h2>
          </div>
          <p className="text-base sm:text-lg leading-relaxed text-slate-300 font-medium">
            Monvera provides institutional term investments ranging from 60 days to 360 days. All active plans earn an attractive <strong>4.50% yield every 24 hours</strong>, automatically credited to your account.
          </p>
          <ul className="space-y-2 text-base text-slate-300 pt-1">
            <li className="flex items-start gap-2.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
              <span><strong>Principal Lock Period:</strong> Funds committed to a selected term (e.g. 60, 180, or 360 days) remain locked until maturity to ensure yield generation.</span>
            </li>
            <li className="flex items-start gap-2.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
              <span><strong>Maturity Settlement:</strong> At maturity, your original principal and all accumulated yields become fully unlocked in your primary checking account.</span>
            </li>
          </ul>
        </section>

        {/* Section 5 */}
        <section className="space-y-3 pb-6 border-b border-slate-800">
          <div className="flex items-center gap-3 text-2xl font-black text-white">
            <span className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center text-base font-black">5</span>
            <h2>Monvera Obsidian Card & 2.5% Cashback</h2>
          </div>
          <p className="text-base sm:text-lg leading-relaxed text-slate-300 font-medium">
            The Monvera Obsidian Metal Card is issued pursuant to a license from authorized USA payment card networks. Cardholders enjoy unlimited 2.5% cashback on all eligible domestic and international purchases with zero foreign exchange markup fees.
          </p>
        </section>

        {/* Section 6 */}
        <section className="space-y-3">
          <div className="flex items-center gap-3 text-2xl font-black text-white">
            <span className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center text-base font-black">6</span>
            <h2>Transparent Governance & Fair Treatment</h2>
          </div>
          <p className="text-base sm:text-lg leading-relaxed text-slate-300 font-medium">
            We are dedicated to total transparency. There are no hidden maintenance fees, surprise overdraft penalties, or unannounced charges. If you ever need support or dispute a charge, our global concierge team is at your service 24 hours a day.
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
            onClick={() => setCurrentView('dashboard')}
            className="px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-base transition-colors shadow-lg"
          >
            Go to Your Dashboard
          </button>
        ) : (
          <button
            onClick={() => openModal('auth_register')}
            className="px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-base transition-colors shadow-lg"
          >
            Open an Account Today
          </button>
        )}
      </div>
    </div>
  );
};
