import React from 'react';
import { ShieldCheck, Lock, Eye, FileText, CheckCircle2, Building2, HelpCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export const PrivacyPolicyPage: React.FC = () => {
  const { setCurrentView, openModal, currentUser } = useAuth();

  return (
    <div className="py-12 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto space-y-12">
      {/* Header Banner */}
      <div className="text-center space-y-4 max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-950/80 border-2 border-emerald-500 text-emerald-300 text-sm font-black tracking-wide">
          <ShieldCheck className="w-4 h-4" />
          <span>Official Privacy Policy & Data Protection Standards</span>
        </div>
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-white tracking-tight">
          Monvera & Nuvera Privacy Policy
        </h1>
        <p className="text-lg sm:text-xl font-bold text-slate-300 leading-relaxed">
          Clear, honest, and transparent protection for your personal and financial information. We believe you should always know how your data is guarded.
        </p>
        <div className="text-sm font-mono text-emerald-400 font-bold">
          Effective Date: August 2026 • Verified Bank-Grade Compliance
        </div>
      </div>

      {/* Main Content Cards */}
      <div className="space-y-8 bg-slate-900/90 rounded-3xl p-6 sm:p-10 border-2 border-slate-700 shadow-2xl text-slate-200">
        
        {/* Section 1 */}
        <section className="space-y-3 pb-6 border-b border-slate-800">
          <div className="flex items-center gap-3 text-2xl font-black text-white">
            <span className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center text-base font-black">1</span>
            <h2>Our Fundamental Privacy Commitment</h2>
          </div>
          <p className="text-base sm:text-lg leading-relaxed text-slate-300 font-medium">
            At Monvera (operating in synergy with Nuvera Financial Technologies), privacy is not an afterthought—it is the foundation of our entire digital banking platform. We never sell your personal information, financial data, or transaction history to third-party advertisers. Your information is used strictly to provide you with secure banking services, high-yield term investments, and authorized card transactions.
          </p>
        </section>

        {/* Section 2 */}
        <section className="space-y-3 pb-6 border-b border-slate-800">
          <div className="flex items-center gap-3 text-2xl font-black text-white">
            <span className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center text-base font-black">2</span>
            <h2>Information We Collect</h2>
          </div>
          <p className="text-base sm:text-lg leading-relaxed text-slate-300 font-medium">
            To ensure your account is protected under United States banking regulations and standard identity verification requirements, we collect:
          </p>
          <ul className="space-y-2.5 pt-2 text-base text-slate-300">
            <li className="flex items-start gap-2.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
              <span><strong>Account Identification:</strong> Legal name, email address, phone number, and physical residence or business address.</span>
            </li>
            <li className="flex items-start gap-2.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
              <span><strong>Financial & Transaction Records:</strong> Deposit methods, transfer recipients, term investment schedules, and debit card purchases.</span>
            </li>
            <li className="flex items-start gap-2.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
              <span><strong>Security & Device Information:</strong> IP address, browser type, device identifiers, and multi-factor authentication tokens to stop fraud instantly.</span>
            </li>
          </ul>
        </section>

        {/* Section 3 */}
        <section className="space-y-3 pb-6 border-b border-slate-800">
          <div className="flex items-center gap-3 text-2xl font-black text-white">
            <span className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center text-base font-black">3</span>
            <h2>How Your Financial Information Is Safeguarded</h2>
          </div>
          <p className="text-base sm:text-lg leading-relaxed text-slate-300 font-medium">
            Every transaction and piece of personal information is encrypted with bank-grade <strong>AES-256 cryptographic standards</strong> and TLS 1.3 in-transit encryption. Our double-entry accounting records ensure mathematical accuracy, complete transparency, and total protection against unauthorized balance alterations.
          </p>
        </section>

        {/* Section 4 */}
        <section className="space-y-3 pb-6 border-b border-slate-800">
          <div className="flex items-center gap-3 text-2xl font-black text-white">
            <span className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center text-base font-black">4</span>
            <h2>Partner Financial Institutions & FDIC Protection</h2>
          </div>
          <p className="text-base sm:text-lg leading-relaxed text-slate-300 font-medium">
            Monvera and Nuvera are financial technology companies, not standalone chartered banks. Banking and depository services are provided by our licensed partner financial institutions, Members FDIC. We only share necessary verification details with our partner FDIC institutions to hold and insure your deposits up to $250,000 per depositor.
          </p>
        </section>

        {/* Section 5 */}
        <section className="space-y-3 pb-6 border-b border-slate-800">
          <div className="flex items-center gap-3 text-2xl font-black text-white">
            <span className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center text-base font-black">5</span>
            <h2>Your Control & Privacy Rights</h2>
          </div>
          <p className="text-base sm:text-lg leading-relaxed text-slate-300 font-medium">
            You retain complete control over your account. At any time, you can:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <div className="p-4 rounded-xl bg-slate-800/80 border border-slate-700">
              <strong className="text-emerald-400 block mb-1">Download Account Statements</strong>
              <span className="text-sm text-slate-300">Access and export official digital ledger statements of all your transfers and yields.</span>
            </div>
            <div className="p-4 rounded-xl bg-slate-800/80 border border-slate-700">
              <strong className="text-emerald-400 block mb-1">Instant Session Termination</strong>
              <span className="text-sm text-slate-300">Remotely log out active sessions across all devices directly from your security settings.</span>
            </div>
          </div>
        </section>

        {/* Section 6 */}
        <section className="space-y-3">
          <div className="flex items-center gap-3 text-2xl font-black text-white">
            <span className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center text-base font-black">6</span>
            <h2>Contact Our Privacy & Compliance Team</h2>
          </div>
          <p className="text-base sm:text-lg leading-relaxed text-slate-300 font-medium">
            If you have questions about your personal data, privacy settings, or FDIC coverage details, our dedicated compliance and support teams are available 24/7.
          </p>
          <div className="p-4 rounded-2xl bg-emerald-950/60 border-2 border-emerald-500 text-emerald-200 text-sm font-bold flex items-center gap-3">
            <Building2 className="w-6 h-6 text-emerald-400 flex-shrink-0" />
            <span>Monvera & Nuvera Privacy Office • Monvera Global Banking Center • support@monverabank.com</span>
          </div>
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
            Open a Secure Account
          </button>
        )}
      </div>
    </div>
  );
};
