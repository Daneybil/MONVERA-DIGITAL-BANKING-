import React, { useState } from 'react';
import { MonveraLogo } from '../common/MonveraLogo';
import { useAuth } from '../../context/AuthContext';
import { ArrowRight, ShieldCheck, ChevronDown, Menu, X, UserCheck, Lock } from 'lucide-react';
import { KycVerificationModal } from '../kyc/KycVerificationModal';

export const PublicNavbar: React.FC = () => {
  const { currentUser, setCurrentView, openModal, availableUsers, switchUser } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [demoDropdownOpen, setDemoDropdownOpen] = useState(false);
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
    <header id="monvera-public-navbar" className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-slate-200/90 shadow-2xs">
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

        {/* Right CTA Actions & Prominent Top-Right Section */}
        <div className="hidden sm:flex items-center gap-3.5">
          {/* Quick Demo Persona Dropdown */}
          <div className="relative">
            <button
              id="demo-switcher-btn"
              onClick={() => setDemoDropdownOpen(!demoDropdownOpen)}
              className="flex items-center gap-2 px-3.5 py-2.5 text-xs font-bold text-slate-800 bg-slate-100/90 hover:bg-slate-200/90 rounded-xl border border-slate-300/70 shadow-2xs transition-all"
              title="Switch demo persona for testing"
            >
              <UserCheck className="w-4 h-4 text-emerald-600" />
              <span>Persona: <strong className="text-slate-950 font-bold">{currentUser ? currentUser.firstName : 'Demo'}</strong></span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
            </button>

            {demoDropdownOpen && (
              <div
                id="demo-persona-menu"
                className="absolute right-0 mt-2 w-68 bg-white rounded-2xl shadow-2xl border border-slate-200 py-2.5 z-50 animate-in fade-in slide-in-from-top-2 duration-150"
              >
                <div className="px-4 py-2 text-[11px] uppercase font-extrabold text-slate-400 tracking-wider">
                  Select User Persona
                </div>
                {availableUsers.map((u) => (
                  <button
                    key={u.id}
                    id={`persona-select-${u.id}`}
                    onClick={() => {
                      switchUser(u.id);
                      setDemoDropdownOpen(false);
                      if (u.role === 'super_admin' || u.role === 'admin') {
                        setCurrentView('admin');
                      } else {
                        setCurrentView('dashboard');
                      }
                    }}
                    className={`w-full text-left px-4 py-2.5 text-xs flex items-center justify-between hover:bg-slate-50 transition-colors ${
                      currentUser?.id === u.id ? 'bg-emerald-50/80 text-emerald-950 font-bold' : 'text-slate-700'
                    }`}
                  >
                    <div>
                      <div className="font-bold text-slate-900 text-sm">{u.firstName} {u.lastName}</div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        {u.role === 'super_admin' ? '🛡️ Admin Console' : `MVB •••• ${u.permanentAccountNumber.slice(-4)}`}
                      </div>
                    </div>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200 font-mono">
                      {u.membershipTier || u.role}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            id="get-started-btn-header"
            onClick={() => openModal('auth_prompt')}
            className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-extrabold text-white bg-slate-950 hover:bg-slate-900 rounded-xl shadow-md border border-slate-800 transition-all active:scale-[0.98] cursor-pointer"
          >
            <span>Get Started</span>
            <ArrowRight className="w-4 h-4 text-emerald-400" />
          </button>
        </div>

        {/* Mobile Menu Trigger */}
        <div className="flex items-center gap-2 sm:hidden">
          <button
            id="mobile-menu-toggle"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 text-slate-700 hover:bg-slate-100 rounded-lg"
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div id="mobile-menu-drawer" className="sm:hidden bg-white border-b border-slate-200 px-4 pt-2 pb-6 space-y-4 shadow-lg">
          <div className="grid grid-cols-2 gap-2 pt-2">
            {navLinks.map((link) => (
              <button
                key={link.label}
                onClick={() => handleNavClick(link.target)}
                className="text-left px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 rounded-lg"
              >
                {link.label}
              </button>
            ))}
          </div>

          <div className="pt-4 border-t border-slate-200 space-y-2">
            <button
              onClick={() => {
                setMobileMenuOpen(false);
                openModal('auth_prompt');
              }}
              className="w-full py-3.5 text-center text-sm font-extrabold text-white bg-slate-950 rounded-xl shadow-md flex items-center justify-center gap-2"
            >
              <span>Get Started</span>
              <ArrowRight className="w-4 h-4 text-emerald-400" />
            </button>
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
