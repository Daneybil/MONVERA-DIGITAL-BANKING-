import React from 'react';
import { MonveraLogo } from '../common/MonveraLogo';
import { ShieldCheck, HeartHandshake, Lock, ArrowUpRight, CheckCircle2, Building2, Headphones } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export const PublicFooter: React.FC = () => {
  const { setCurrentView, openModal, currentUser } = useAuth();

  return (
    <footer id="monvera-public-footer" className="bg-slate-950 text-slate-300 text-xs border-t border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        
        {/* Main Footer Row */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-10 pb-12 border-b border-slate-800">
          
          {/* Col 1: Brand & Modern Mission */}
          <div className="md:col-span-4 space-y-4">
            <div
              className="cursor-pointer inline-block"
              onClick={() => {
                setCurrentView('home');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            >
              <MonveraLogo variant="full" size="md" isLight={true} />
            </div>
            <p className="text-slate-300 text-sm leading-relaxed max-w-sm font-medium">
              Monvera is your modern digital banking and sovereign wealth platform. Built for people, businesses, and a brighter financial future with guaranteed daily yields and seamless global payments.
            </p>
            <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs pt-1">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Protected • Member FDIC Partner Security</span>
            </div>
          </div>

          {/* Col 2: Banking Solutions */}
          <div className="md:col-span-2 space-y-3">
            <h4 className="font-black text-white uppercase tracking-wider text-xs">Banking Solutions</h4>
            <ul className="space-y-2.5 text-sm font-medium">
              <li>
                <button
                  onClick={() => {
                    if (currentUser) setCurrentView('accounts');
                    else openModal('auth_register');
                  }}
                  className="hover:text-emerald-400 transition-colors text-slate-300 text-left"
                >
                  Checking Accounts
                </button>
              </li>
              <li>
                <button
                  onClick={() => {
                    if (currentUser) setCurrentView('accounts');
                    else openModal('auth_register');
                  }}
                  className="hover:text-emerald-400 transition-colors text-slate-300 text-left"
                >
                  High Yield Treasury
                </button>
              </li>
              <li>
                <button
                  onClick={() => {
                    setCurrentView('investments');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="hover:text-emerald-400 transition-colors text-slate-300 text-left"
                >
                  Term Investments
                </button>
              </li>
              <li>
                <button
                  onClick={() => {
                    if (currentUser) setCurrentView('cards');
                    else {
                      setCurrentView('home');
                      setTimeout(() => {
                        document.getElementById('cards')?.scrollIntoView({ behavior: 'smooth' });
                      }, 100);
                    }
                  }}
                  className="hover:text-emerald-400 transition-colors text-slate-300 text-left"
                >
                  Obsidian Metal Card
                </button>
              </li>
              <li>
                <button
                  onClick={() => {
                    if (currentUser) setCurrentView('business');
                    else openModal('auth_register');
                  }}
                  className="hover:text-emerald-400 transition-colors text-slate-300 text-left"
                >
                  Business Banking
                </button>
              </li>
            </ul>
          </div>

          {/* Col 3: Transfers & Movements */}
          <div className="md:col-span-3 space-y-3">
            <h4 className="font-black text-white uppercase tracking-wider text-xs">Transfers & Movement</h4>
            <ul className="space-y-2.5 text-sm font-medium">
              <li>
                <button
                  onClick={() => openModal('send')}
                  className="hover:text-emerald-400 transition-colors text-slate-300 text-left"
                >
                  Direct Account Transfers
                </button>
              </li>
              <li>
                <button
                  onClick={() => openModal('receive')}
                  className="hover:text-emerald-400 transition-colors text-slate-300 text-left"
                >
                  Account Lookup
                </button>
              </li>
              <li>
                <button
                  onClick={() => openModal('deposit')}
                  className="hover:text-emerald-400 transition-colors text-slate-300 text-left"
                >
                  Verified Payment Deposits
                </button>
              </li>
              <li>
                <button
                  onClick={() => openModal('withdraw')}
                  className="hover:text-emerald-400 transition-colors text-slate-300 text-left"
                >
                  FedWire & ACH Withdrawals
                </button>
              </li>
              <li>
                <button
                  onClick={() => {
                    if (currentUser) setCurrentView('transactions');
                    else openModal('auth_login');
                  }}
                  className="hover:text-emerald-400 transition-colors text-slate-300 text-left"
                >
                  Official Statement Records
                </button>
              </li>
            </ul>
          </div>

          {/* Col 4: Member Trust & Global Support */}
          <div className="md:col-span-3 space-y-3">
            <h4 className="font-black text-white uppercase tracking-wider text-xs">Member Trust & Support</h4>
            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3 text-xs">
              <div className="flex items-start gap-2.5">
                <Headphones className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold text-white">24/7 Global Concierge</div>
                  <div className="text-slate-400">Direct client assistance whenever you need it</div>
                </div>
              </div>
              <div className="flex items-start gap-2.5 pt-1 border-t border-slate-800">
                <ShieldCheck className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold text-white">FDIC-Insured Protection</div>
                  <div className="text-slate-400">Deposits insured up to $250,000 via partner banks</div>
                </div>
              </div>
              <div className="flex items-start gap-2.5 pt-1 border-t border-slate-800">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold text-white">Zero Hidden Charges</div>
                  <div className="text-slate-400">Complete transparency on all accounts and yields</div>
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* Regulatory Disclosures & Navigation */}
        <div className="pt-8 space-y-4">
          <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-2">
            <div className="text-xs font-black text-white uppercase tracking-wide flex items-center gap-2">
              <Building2 className="w-4 h-4 text-emerald-400" />
              <span>Regulatory & Financial Disclosures</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed font-medium">
              Monvera Bank and Nuvera are financial technology platforms, not standalone chartered banks. Banking services and depository accounts are provided by Nuvera's licensed partner financial institutions, Members FDIC. The Monvera Obsidian Card is issued pursuant to a license from authorized USA card networks. Your deposits are protected and FDIC-insured up to standard statutory limits ($250,000 per depositor) through our partner financial institutions, delivering sovereign control, maximum safety, and a reliable financial future.
            </p>
          </div>

          <div className="pt-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-400 border-t border-slate-800/80">
            <div className="font-medium text-slate-400">
              © {new Date().getFullYear()} Monvera & Nuvera Financial Technologies. All rights reserved. Building a better tomorrow.
            </div>
            <div className="flex items-center gap-6 font-bold">
              <button
                onClick={() => {
                  setCurrentView('privacy');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="hover:text-emerald-400 transition-colors cursor-pointer text-slate-300"
              >
                Privacy Policy
              </button>
              <button
                onClick={() => {
                  setCurrentView('terms');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="hover:text-emerald-400 transition-colors cursor-pointer text-slate-300"
              >
                Terms of Service
              </button>
              <button
                onClick={() => {
                  setCurrentView('security-protocol');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="hover:text-emerald-400 transition-colors cursor-pointer text-slate-300"
              >
                Security Protocols
              </button>
              <button
                onClick={() => setCurrentView('admin')}
                className="text-emerald-400 hover:text-emerald-300 font-mono font-bold"
              >
                Admin Console
              </button>
            </div>
          </div>
        </div>

      </div>
    </footer>
  );
};
