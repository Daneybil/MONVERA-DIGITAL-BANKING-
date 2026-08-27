import React, { useState } from 'react';
import { MonveraLogo } from '../common/MonveraLogo';
import { useAuth } from '../../context/AuthContext';
import { ArrowRight, ShieldCheck, ChevronDown, Menu, X, Lock, LayoutDashboard } from 'lucide-react';
import { KycVerificationModal } from '../kyc/KycVerificationModal';

export const PublicNavbar: React.FC = () => {
  const { currentUser, setCurrentView, openModal } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isKycModalOpen, setIsKycModalOpen] = useState(false);

  const navLinks = [
    { label: 'Personal', target: 'personal' },
    { label: 'Business', target: 'business' },
    { label: 'Investments', target: 'investments' },
    { label: 'Cards', target: 'cards' },
    { label: 'How It Works', target: 'how-it-works' },
    { label: 'Security', target: 'security' },
  ];

  const handleNavClick = (target: string) => {
    setMobileMenuOpen(false);
    if (target === 'how-it-works') {
      setCurrentView('how-it-works');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (target === 'personal' || target === 'business') {
      setCurrentView('offers');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (target === 'investments' || target === 'cards' || target === 'security') {
      setCurrentView('home');
      setTimeout(() => {
        const elem = document.getElementById(target);
        if (elem) {
          elem.scrollIntoView({ behavior: 'smooth' });
        } else {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }, 80);
      return;
    }
    setCurrentView('home');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <header id="monvera-public-navbar" className="sticky top-0 z-50 bg-[#FAF7F2]/95 backdrop-blur-md border-b border-amber-900/10 shadow-2xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
        {/* Monvera Brand */}
        <div
          className="cursor-pointer flex items-center"
          onClick={() => {
            setCurrentView('home');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        >
          <MonveraLogo variant="full" size="md" />
        </div>

        {/* Desktop Navigation Links */}
        <nav className="hidden lg:flex items-center gap-8 text-[15px] font-semibold text-slate-700">
          {navLinks.map((link) => (
            <button
              key={link.label}
              id={`nav-link-${link.target}`}
              onClick={() => handleNavClick(link.target)}
              className="hover:text-slate-950 transition-colors duration-150 py-1 cursor-pointer"
            >
              {link.label}
            </button>
          ))}
        </nav>

        {/* Right CTA Actions & Menu Trigger (Both Mobile and Desktop) */}
        <div className="flex items-center gap-2 sm:gap-3.5">
          {currentUser ? (
            <button
              id="navbar-dashboard-btn"
              onClick={() => {
                if (currentUser.role === 'super_admin' || currentUser.role === 'admin') {
                  setCurrentView('admin');
                } else {
                  setCurrentView('dashboard');
                }
              }}
              className="inline-flex items-center gap-2 px-3.5 sm:px-5 py-2.5 text-xs sm:text-sm font-extrabold text-slate-900 bg-amber-400 hover:bg-amber-300 rounded-xl shadow-xs border border-amber-500/30 transition-all cursor-pointer"
            >
              <LayoutDashboard className="w-4 h-4 text-slate-950" />
              <span>Dashboard</span>
            </button>
          ) : (
            <button
              id="navbar-signin-btn"
              onClick={() => openModal('auth_login')}
              className="hidden sm:inline-flex items-center gap-1.5 px-4 py-2.5 text-xs sm:text-sm font-bold text-slate-800 hover:text-slate-950 hover:bg-slate-200/60 rounded-xl transition-all cursor-pointer"
            >
              <Lock className="w-4 h-4 text-slate-600" />
              <span>Sign In</span>
            </button>
          )}

          {/* Get Started CTA Button */}
          <button
            id="get-started-btn-header"
            onClick={() => {
              if (currentUser) {
                setCurrentView('dashboard');
              } else {
                openModal('auth_prompt');
              }
            }}
            className="inline-flex items-center gap-2 px-4 sm:px-6 py-2.5 text-xs sm:text-sm font-extrabold text-white bg-slate-950 hover:bg-slate-900 rounded-xl shadow-md border border-slate-800 transition-all active:scale-[0.98] cursor-pointer"
          >
            <span>{currentUser ? 'My Account' : 'Get Started'}</span>
            <ArrowRight className="w-4 h-4 text-emerald-400" />
          </button>

          {/* 3 Horizontal Lines Menu Trigger (Visible on BOTH Mobile & Desktop) */}
          <button
            id="menu-toggle-btn"
            aria-label="Toggle navigation menu"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2.5 text-slate-800 bg-slate-100/90 hover:bg-slate-200/90 rounded-xl border border-slate-300/70 shadow-2xs transition-all flex items-center justify-center cursor-pointer active:scale-95"
            title="Menu"
          >
            {mobileMenuOpen ? (
              <X className="w-5 h-5 text-slate-900" />
            ) : (
              <Menu className="w-5 h-5 text-slate-900" />
            )}
          </button>
        </div>
      </div>

      {/* Global Navigation Drawer (Works on both Mobile & Desktop) */}
      {mobileMenuOpen && (
        <div id="global-menu-drawer" className="bg-white border-b border-slate-200 px-4 sm:px-8 pt-3 pb-6 shadow-xl animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="max-w-7xl mx-auto">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 pt-2">
              {navLinks.map((link) => (
                <button
                  key={link.label}
                  id={`drawer-link-${link.target}`}
                  onClick={() => handleNavClick(link.target)}
                  className="text-left px-3 py-2.5 text-sm font-semibold text-slate-700 hover:text-slate-950 hover:bg-slate-50 rounded-xl transition-colors cursor-pointer border border-transparent hover:border-slate-200"
                >
                  {link.label}
                </button>
              ))}
            </div>

            <div className="pt-4 mt-3 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="text-xs text-slate-500 font-medium">
                Monvera Institutional Digital Asset & Treasury Banking
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  id="drawer-get-started-btn"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    openModal('auth_prompt');
                  }}
                  className="w-full sm:w-auto px-6 py-2.5 text-center text-xs sm:text-sm font-extrabold text-white bg-slate-950 hover:bg-slate-900 rounded-xl shadow-md flex items-center justify-center gap-2 cursor-pointer transition-all"
                >
                  <span>Open Account</span>
                  <ArrowRight className="w-4 h-4 text-emerald-400" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* KYC Verification Modal */}
      <KycVerificationModal
        isOpen={isKycModalOpen}
        onClose={() => setIsKycModalOpen(false)}
      />
    </header>
  );
};
