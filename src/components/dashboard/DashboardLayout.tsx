import React, { useState, useEffect } from 'react';
import { useAuth, AppView } from '../../context/AuthContext';
import { MonveraLogo } from '../common/MonveraLogo';
import { NotificationsDrawer } from './NotificationsDrawer';
import {
  LayoutDashboard,
  Wallet,
  ArrowLeftRight,
  Send,
  QrCode,
  Landmark,
  TrendingUp,
  CreditCard,
  ShieldCheck,
  User,
  Building2,
  Shield,
  Bell,
  LogOut,
  ChevronDown,
  UserCheck,
  Plus,
  Home,
  Menu,
  X,
  ArrowLeft,
  ChevronRight,
  Lock,
  CheckCircle2,
} from 'lucide-react';

interface DashboardLayoutProps {
  children: React.ReactNode;
}

interface NavMenuItem {
  id: AppView;
  label: string;
  sublabel?: string;
  icon: React.ElementType;
  actionType?: 'view' | 'modal';
  modalName?: any;
  badge?: string;
  badgeColor?: string;
}

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({ children }) => {
  const {
    currentUser,
    currentView,
    setCurrentView,
    openModal,
    logout,
    availableUsers,
    switchUser,
    unreadNotifsCount,
    balanceMetrics,
  } = useAuth();

  const [notifsOpen, setNotifsOpen] = useState(false);
  const [personaMenuOpen, setPersonaMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Close drawer on escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mobileMenuOpen) {
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileMenuOpen]);

  // Lock body scroll when drawer is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [mobileMenuOpen]);

  if (!currentUser) return null;

  // Categorized Navigation Architecture for a Mature Institutional Experience
  const coreBankingItems: NavMenuItem[] = [
    { id: 'dashboard', label: 'Overview', sublabel: 'Financial metrics, liquidity & daily stats', icon: LayoutDashboard, actionType: 'view' },
    { id: 'accounts', label: 'Accounts', sublabel: 'Checking, savings & multi-currency vault', icon: Wallet, actionType: 'view' },
    { id: 'transactions', label: 'Transactions', sublabel: 'Real-time wire & clearance ledger', icon: ArrowLeftRight, actionType: 'view' },
    { id: 'send', label: 'Send Money', sublabel: 'Instant domestic & international wire', icon: Send, actionType: 'modal', modalName: 'send', badge: 'Wire' },
    { id: 'receive', label: 'Receive', sublabel: 'Account routing, IBAN & instant QR', icon: QrCode, actionType: 'modal', modalName: 'receive' },
    { id: 'deposit', label: 'Deposit', sublabel: 'Instant liquidity intake & ACH deposit', icon: Plus, actionType: 'modal', modalName: 'deposit', badge: 'Instant' },
    { id: 'withdraw', label: 'Withdraw', sublabel: 'Outbound ACH / swift wire settlement', icon: Landmark, actionType: 'modal', modalName: 'withdraw' },
  ];

  const wealthItems: NavMenuItem[] = [
    { id: 'cards', label: 'Card', sublabel: 'Monvera Visa Infinite & virtual cards', icon: CreditCard, actionType: 'view', badge: 'Visa' },
    { id: 'investments', label: 'Investment', sublabel: '4.5% fixed daily interest term plans', icon: TrendingUp, actionType: 'view', badge: '4.5% Daily' },
    { id: 'business', label: 'Business Banking', sublabel: 'Company accounts, staff payroll & invoices', icon: Building2, actionType: 'view', badge: 'Company' },
  ];

  const securityGovernanceItems: NavMenuItem[] = [
    { id: 'profile', label: 'Profile', sublabel: 'Verified KYC identity & daily limits', icon: User, actionType: 'view' },
    { id: 'security', label: 'Security', sublabel: 'Hardware 2FA, passkeys & device logs', icon: ShieldCheck, actionType: 'view', badge: 'Encrypted' },
  ];

  const allNavItems = [...coreBankingItems, ...wealthItems, ...securityGovernanceItems];

  const handleNavClick = (item: NavMenuItem) => {
    setMobileMenuOpen(false);
    if (item.actionType === 'modal') {
      openModal(item.modalName);
    } else {
      setCurrentView(item.id);
    }
  };

  return (
    <div id="monvera-dashboard-layout" className="min-h-screen bg-slate-100/70 flex flex-col lg:flex-row font-sans">
      
      {/* --- DESKTOP SIDEBAR --- */}
      <aside className="hidden lg:flex flex-col w-72 bg-slate-900 text-slate-300 border-r border-slate-800 flex-shrink-0 min-h-screen sticky top-0 h-screen z-30">
        {/* Brand Header */}
        <div className="p-6 border-b border-slate-800/80 flex items-center justify-between">
          <MonveraLogo variant="full" size="md" isLight={true} />
        </div>

        {/* Account Balance Widget */}
        <div className="p-4 mx-4 mt-4 rounded-2xl bg-slate-850 border border-slate-800 space-y-1.5 shadow-sm">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>Checking Balance</span>
            <span className="text-emerald-400 font-mono font-bold">MVB •••• {currentUser.permanentAccountNumber.slice(-4)}</span>
          </div>
          <div className="text-2xl font-extrabold font-mono text-white tracking-tight">
            ${balanceMetrics?.checkingBalance.toLocaleString('en-US', { minimumFractionDigits: 2 }) || '0.00'}
          </div>
          <div className="pt-2 flex items-center gap-2">
            <button
              id="sidebar-deposit-btn"
              onClick={() => openModal('deposit')}
              className="flex-1 py-2 px-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow-xs cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Deposit</span>
            </button>
            <button
              id="sidebar-send-btn"
              onClick={() => openModal('send')}
              className="flex-1 py-2 px-2.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-all border border-slate-700/80 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5 text-emerald-400" />
              <span>Send</span>
            </button>
          </div>
        </div>

        {/* Navigation Links */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 custom-scrollbar">
          
          {/* Core Operations */}
          <div className="space-y-1.5">
            <div className="px-3 py-1 text-[10px] uppercase font-mono font-black text-slate-400 tracking-wider flex items-center justify-between">
              <span>Core Banking</span>
              <span className="text-[9px] font-mono text-emerald-400">7</span>
            </div>
            {coreBankingItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentView === item.id;
              return (
                <button
                  key={item.id}
                  id={`sidebar-nav-${item.id}`}
                  onClick={() => handleNavClick(item)}
                  className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                    isActive
                      ? 'bg-gradient-to-b from-emerald-600 to-emerald-700 text-white border-emerald-400 shadow-[0_4px_0_0_#064e3b] translate-y-0.5'
                      : 'bg-slate-850/60 hover:bg-slate-800 text-slate-300 hover:text-white border-slate-800 hover:border-slate-700 shadow-[0_2px_0_0_#0b0f19] active:translate-y-0.5'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-emerald-400'}`} />
                    <span className="font-extrabold">{item.label}</span>
                  </div>
                  {item.badge && (
                    <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Wealth & Portfolios */}
          <div className="space-y-1.5 pt-2 border-t border-slate-800/80">
            <div className="px-3 py-1 text-[10px] uppercase font-mono font-black text-slate-400 tracking-wider flex items-center justify-between">
              <span>Wealth & Business</span>
              <span className="text-[9px] font-mono text-cyan-400">3</span>
            </div>
            {wealthItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentView === item.id;
              return (
                <button
                  key={item.id}
                  id={`sidebar-nav-${item.id}`}
                  onClick={() => handleNavClick(item)}
                  className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                    isActive
                      ? 'bg-gradient-to-b from-cyan-600 to-cyan-700 text-white border-cyan-400 shadow-[0_4px_0_0_#164e63] translate-y-0.5'
                      : 'bg-slate-850/60 hover:bg-slate-800 text-slate-300 hover:text-white border-slate-800 hover:border-slate-700 shadow-[0_2px_0_0_#0b0f19] active:translate-y-0.5'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-cyan-400'}`} />
                    <span className="font-extrabold">{item.label}</span>
                  </div>
                  {item.badge && (
                    <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Security & Governance */}
          <div className="space-y-1.5 pt-2 border-t border-slate-800/80">
            <div className="px-3 py-1 text-[10px] uppercase font-mono font-black text-slate-400 tracking-wider flex items-center justify-between">
              <span>Security & Clearance</span>
              <span className="text-[9px] font-mono text-amber-400">{securityGovernanceItems.length}</span>
            </div>
            {securityGovernanceItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentView === item.id;
              const isAmber = item.badgeColor === 'amber';
              return (
                <button
                  key={item.id}
                  id={`sidebar-nav-${item.id}`}
                  onClick={() => handleNavClick(item)}
                  className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                    isActive
                      ? isAmber
                        ? 'bg-gradient-to-b from-amber-600 to-amber-700 text-white border-amber-400 shadow-[0_4px_0_0_#78350f] translate-y-0.5'
                        : 'bg-gradient-to-b from-emerald-600 to-emerald-700 text-white border-emerald-400 shadow-[0_4px_0_0_#064e3b] translate-y-0.5'
                      : isAmber
                      ? 'bg-amber-950/40 hover:bg-amber-950/60 text-amber-300 hover:text-amber-200 border-amber-800/60 shadow-[0_2px_0_0_#291305]'
                      : 'bg-slate-850/60 hover:bg-slate-800 text-slate-300 hover:text-white border-slate-800 hover:border-slate-700 shadow-[0_2px_0_0_#0b0f19] active:translate-y-0.5'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className={`w-4 h-4 ${isActive ? 'text-white' : isAmber ? 'text-amber-400' : 'text-slate-400'}`} />
                    <span className="font-extrabold">{item.label}</span>
                  </div>
                  {item.badge && (
                    <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border ${isAmber ? 'bg-amber-500/20 text-amber-300 border-amber-500/30' : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'}`}>
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

        </div>

        {/* User Card Bottom */}
        <div className="p-4 border-t border-slate-800/80 bg-slate-950/40">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 truncate">
              <img
                src={currentUser.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150'}
                alt={currentUser.firstName}
                className="w-9 h-9 rounded-full object-cover border border-slate-700 flex-shrink-0"
              />
              <div className="truncate">
                <div className="text-xs font-bold text-white truncate">
                  {currentUser.firstName} {currentUser.lastName}
                </div>
                <div className="text-[10px] text-slate-400 font-mono truncate">
                  {currentUser.membershipTier}
                </div>
              </div>
            </div>

            <button
              onClick={logout}
              className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-red-400 transition-colors cursor-pointer"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* --- MAIN CONTENT WRAPPER --- */}
      <div className="flex-1 flex flex-col min-w-0">
        
        {/* Top Header Bar */}
        <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/90 h-16 sm:h-20 px-4 sm:px-8 flex items-center justify-between shadow-2xs">
          
          {/* Left Title / Greeting & Menu Toggle */}
          <div className="flex items-center gap-3">
            
            {/* The 3 Horizontal Lines Menu Toggle Button (Sleek Rectangular Smart Trigger) */}
            <button
              id="dashboard-header-menu-btn"
              onClick={() => setMobileMenuOpen(true)}
              className="px-3.5 py-2.5 rounded-xl bg-slate-950 hover:bg-slate-900 text-white shadow-sm border border-slate-800 transition-all active:scale-95 flex items-center gap-2 cursor-pointer group"
              title="Open Navigation Menu"
              aria-label="Open Monvera Navigation Menu"
            >
              <Menu className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" />
              <span className="text-xs font-black tracking-wide text-slate-100">
                Menu Hub
              </span>
            </button>

            {/* Prominent Back Button on Dashboard */}
            <button
              id="dashboard-back-to-home-btn"
              onClick={() => {
                setCurrentView('home');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 hover:text-slate-950 text-xs font-extrabold border border-slate-300 transition-colors cursor-pointer"
              title="Return to Monvera Home"
            >
              <ArrowLeft className="w-4 h-4 text-emerald-600" />
              <span className="hidden xs:inline">Back to Home</span>
              <span className="xs:hidden">Home</span>
            </button>

            <div className="hidden md:block pl-2 border-l border-slate-200">
              <h1 className="text-base font-bold text-slate-900 capitalize leading-tight">
                {currentView === 'dashboard' ? 'Banking Dashboard' : currentView.replace('-', ' ')}
              </h1>
              <div className="text-[11px] text-slate-500 font-mono">
                Permanent Account: <strong className="text-slate-800">{currentUser.permanentAccountNumber}</strong>
              </div>
            </div>
          </div>

          {/* Right Header Controls */}
          <div className="flex items-center gap-2.5 sm:gap-3.5">
            
            {/* Return to Public Website Switcher */}
            <button
              id="header-view-website-btn"
              onClick={() => setCurrentView('home')}
              className="hidden md:inline-flex items-center gap-2 px-3.5 py-2.5 text-xs font-bold text-slate-700 hover:text-slate-950 bg-slate-100 hover:bg-slate-200/80 rounded-xl border border-slate-250 transition-colors cursor-pointer"
              title="View Public Homepage"
            >
              <Home className="w-4 h-4 text-slate-500" />
              <span>Public Website</span>
            </button>

            {/* Persona Switcher Dropdown */}
            <div className="relative">
              <button
                id="header-persona-switcher"
                onClick={() => setPersonaMenuOpen(!personaMenuOpen)}
                className="flex items-center gap-2 px-3.5 py-2.5 text-xs font-bold text-slate-900 bg-slate-100 hover:bg-slate-200/80 rounded-xl border border-slate-300/80 shadow-2xs transition-colors cursor-pointer"
              >
                <UserCheck className="w-4 h-4 text-emerald-600" />
                <span className="hidden sm:inline">Active: <strong className="font-extrabold">{currentUser.firstName}</strong></span>
                <span className="sm:hidden font-bold">{currentUser.firstName}</span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
              </button>

              {personaMenuOpen && (
                <div
                  id="header-persona-dropdown"
                  className="absolute right-0 mt-2 w-72 bg-white rounded-2xl shadow-2xl border border-slate-200 py-2.5 z-50 animate-in fade-in slide-in-from-top-2"
                >
                  <div className="px-4 py-2 text-[11px] uppercase font-extrabold text-slate-400 tracking-wider">
                    Switch Test Account
                  </div>
                  {availableUsers.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => {
                        switchUser(u.id);
                        setPersonaMenuOpen(false);
                        if (u.role === 'super_admin' || u.role === 'admin') {
                          setCurrentView('admin');
                        }
                      }}
                      className={`w-full text-left px-4 py-2.5 text-xs flex items-center justify-between hover:bg-slate-50 transition-colors cursor-pointer ${
                        currentUser.id === u.id ? 'bg-emerald-50 text-emerald-950 font-bold' : 'text-slate-700'
                      }`}
                    >
                      <div>
                        <div className="font-bold text-slate-900 text-sm">{u.firstName} {u.lastName}</div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          {u.role === 'super_admin' ? '🛡️ Admin Console' : `MVB •••• ${u.permanentAccountNumber.slice(-4)}`}
                        </div>
                      </div>
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-mono">
                        {u.role === 'super_admin' ? 'Admin' : u.membershipTier}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Notification Bell */}
            <button
              id="header-notifications-btn"
              onClick={() => setNotifsOpen(true)}
              className="relative p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300/80 transition-colors cursor-pointer"
              title="Notifications"
            >
              <Bell className="w-4 h-4" />
              {unreadNotifsCount > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
              )}
              {unreadNotifsCount > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-600" />
              )}
            </button>

            {/* Quick Send Action */}
            <button
              id="header-quick-send-btn"
              onClick={() => openModal('send')}
              className="hidden sm:inline-flex items-center gap-2 px-5 py-2.5 text-xs font-extrabold text-white bg-slate-950 hover:bg-slate-900 rounded-xl shadow-md border border-slate-800 transition-all active:scale-[0.98] cursor-pointer"
            >
              <Send className="w-3.5 h-3.5 text-emerald-400" />
              <span>Send Money</span>
            </button>
          </div>
        </header>

        {/* --- PROFESSIONAL, PORTABLE RECTANGULAR NAVIGATION MENU (FLOATING SMART MODAL, DOES NOT COVER FULL SCREEN) --- */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 md:p-8 animate-in fade-in duration-200">
            {/* Backdrop Blur Overlay */}
            <div
              className="fixed inset-0 bg-slate-950/75 backdrop-blur-sm transition-opacity"
              onClick={() => setMobileMenuOpen(false)}
              aria-hidden="true"
            />

            {/* Smart Portable Rectangular Executive Hub Window */}
            <div className="relative w-full max-w-2xl lg:max-w-3xl bg-slate-950 text-slate-100 rounded-3xl border-2 border-slate-700 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9),0_0_0_1px_rgba(255,255,255,0.08)] flex flex-col z-50 max-h-[88vh] sm:max-h-[84vh] overflow-hidden animate-in zoom-in-95 duration-200">
              
              {/* Rectangular Header: Brand & Close */}
              <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between bg-gradient-to-r from-slate-900 via-slate-900 to-slate-950 shrink-0">
                <div className="flex items-center gap-3">
                  <MonveraLogo variant="full" size="md" isLight={true} />
                  <div className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-950/80 text-emerald-400 border border-emerald-500/30 text-xs font-mono font-bold">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span>Navigation Hub</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono text-slate-400 hidden xs:inline">ESC to close</span>
                  <button
                    onClick={() => setMobileMenuOpen(false)}
                    className="p-2.5 rounded-xl bg-slate-850 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700 transition-colors cursor-pointer"
                    title="Close Navigation Hub"
                    aria-label="Close Navigation Hub"
                  >
                    <X className="w-5 h-5 stroke-[2.5]" />
                  </button>
                </div>
              </div>

              {/* Client Strip & Quick Actions inside the Rectangular Card */}
              <div className="px-4 sm:px-6 pt-4 pb-3 border-b border-slate-850 bg-slate-900/90 shrink-0 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <img
                        src={currentUser.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150'}
                        alt={currentUser.firstName}
                        className="w-11 h-11 rounded-xl object-cover border border-emerald-400 shadow-sm"
                      />
                      {currentUser.kycStatus === 'verified' && (
                        <div className="absolute -bottom-1 -right-1 bg-slate-900 p-0.5 rounded-full" title="Verified KYC">
                          <CheckCircle2 className="w-4 h-4 text-sky-400 fill-sky-500 stroke-slate-950" />
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="text-sm sm:text-base font-black text-white tracking-tight flex items-center gap-2">
                        <span>{currentUser.firstName} {currentUser.lastName}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-500/30 font-mono">
                          {currentUser.membershipTier}
                        </span>
                      </div>
                      <div className="text-[11px] font-mono text-slate-400">
                        MVB •••• {currentUser.permanentAccountNumber.slice(-4)}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3">
                    <div className="text-right">
                      <div className="text-[10px] uppercase font-mono text-slate-400 font-bold">Checking</div>
                      <div className="text-base sm:text-lg font-black font-mono text-emerald-400">
                        ${balanceMetrics?.checkingBalance.toLocaleString('en-US', { minimumFractionDigits: 2 }) || '0.00'}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setMobileMenuOpen(false);
                          openModal('deposit');
                        }}
                        className="py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Deposit</span>
                      </button>
                      <button
                        onClick={() => {
                          setMobileMenuOpen(false);
                          openModal('send');
                        }}
                        className="py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-750 text-white text-xs font-bold flex items-center gap-1.5 border border-slate-700 transition-colors cursor-pointer"
                      >
                        <Send className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Send</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Scrollable Navigation Grid inside Rectangular Window */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 custom-scrollbar">
                
                {/* 1. Core Banking Operations */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-[11px] font-mono font-bold uppercase tracking-wider text-slate-400 px-1">
                    <span className="flex items-center gap-1.5 text-slate-300">
                      <span className="w-2 h-2 rounded-full bg-emerald-400" />
                      Core Banking & Liquidity
                    </span>
                    <span className="text-emerald-400">7 Modules</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {coreBankingItems.map((item) => {
                      const Icon = item.icon;
                      const isActive = currentView === item.id;
                      return (
                        <button
                          key={item.id}
                          id={`drawer-nav-${item.id}`}
                          onClick={() => handleNavClick(item)}
                          className={`w-full text-left p-3.5 rounded-2xl transition-all cursor-pointer flex items-center gap-3 border ${
                            isActive
                              ? 'bg-gradient-to-r from-emerald-700 to-emerald-800 text-white border-emerald-400 shadow-md'
                              : 'bg-slate-900/90 hover:bg-slate-850 text-slate-200 hover:text-white border-slate-800 hover:border-slate-700 shadow-xs'
                          }`}
                        >
                          <div className={`w-10 h-10 rounded-xl shrink-0 flex items-center justify-center border ${
                            isActive
                              ? 'bg-white/20 border-white/30 text-white'
                              : 'bg-slate-800 border-slate-700 text-emerald-400'
                          }`}>
                            <Icon className="w-5 h-5" />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-1.5">
                              <span className="text-sm font-black text-white truncate">
                                {item.label}
                              </span>
                              {item.badge && (
                                <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${
                                  isActive
                                    ? 'bg-emerald-950 text-emerald-200 border border-emerald-400/40'
                                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                }`}>
                                  {item.badge}
                                </span>
                              )}
                            </div>
                            {item.sublabel && (
                              <p className={`text-[11px] truncate mt-0.5 ${
                                isActive ? 'text-emerald-100' : 'text-slate-400'
                              }`}>
                                {item.sublabel}
                              </p>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 2. Wealth & Business Banking */}
                <div className="space-y-2.5 pt-3 border-t border-slate-850">
                  <div className="flex items-center justify-between text-[11px] font-mono font-bold uppercase tracking-wider text-slate-400 px-1">
                    <span className="flex items-center gap-1.5 text-slate-300">
                      <span className="w-2 h-2 rounded-full bg-cyan-400" />
                      Wealth Management & Business
                    </span>
                    <span className="text-cyan-400">3 Modules</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {wealthItems.map((item) => {
                      const Icon = item.icon;
                      const isActive = currentView === item.id;
                      return (
                        <button
                          key={item.id}
                          id={`drawer-nav-${item.id}`}
                          onClick={() => handleNavClick(item)}
                          className={`w-full text-left p-3.5 rounded-2xl transition-all cursor-pointer flex items-center gap-3 border ${
                            isActive
                              ? 'bg-gradient-to-r from-cyan-700 to-cyan-800 text-white border-cyan-400 shadow-md'
                              : 'bg-slate-900/90 hover:bg-slate-850 text-slate-200 hover:text-white border-slate-800 hover:border-slate-700 shadow-xs'
                          }`}
                        >
                          <div className={`w-10 h-10 rounded-xl shrink-0 flex items-center justify-center border ${
                            isActive
                              ? 'bg-white/20 border-white/30 text-white'
                              : 'bg-slate-800 border-slate-700 text-cyan-400'
                          }`}>
                            <Icon className="w-5 h-5" />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-1.5">
                              <span className="text-sm font-black text-white truncate">
                                {item.label}
                              </span>
                              {item.badge && (
                                <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${
                                  isActive
                                    ? 'bg-cyan-950 text-cyan-200 border border-cyan-400/40'
                                    : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                                }`}>
                                  {item.badge}
                                </span>
                              )}
                            </div>
                            {item.sublabel && (
                              <p className={`text-[11px] truncate mt-0.5 ${
                                isActive ? 'text-cyan-100' : 'text-slate-400'
                              }`}>
                                {item.sublabel}
                              </p>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 3. Security, Clearance & Governance */}
                <div className="space-y-2.5 pt-3 border-t border-slate-850">
                  <div className="flex items-center justify-between text-[11px] font-mono font-bold uppercase tracking-wider text-slate-400 px-1">
                    <span className="flex items-center gap-1.5 text-slate-300">
                      <span className="w-2 h-2 rounded-full bg-amber-400" />
                      Security & Identity
                    </span>
                    <span className="text-amber-400">{securityGovernanceItems.length} Modules</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {securityGovernanceItems.map((item) => {
                      const Icon = item.icon;
                      const isActive = currentView === item.id;
                      const isAmber = item.badgeColor === 'amber';
                      return (
                        <button
                          key={item.id}
                          id={`drawer-nav-${item.id}`}
                          onClick={() => handleNavClick(item)}
                          className={`w-full text-left p-3.5 rounded-2xl transition-all cursor-pointer flex items-center gap-3 border ${
                            isActive
                              ? isAmber
                                ? 'bg-gradient-to-r from-amber-700 to-amber-800 text-white border-amber-400 shadow-md'
                                : 'bg-gradient-to-r from-emerald-700 to-emerald-800 text-white border-emerald-400 shadow-md'
                              : isAmber
                              ? 'bg-amber-950/30 hover:bg-amber-950/50 text-amber-200 hover:text-white border-amber-800/60 hover:border-amber-700'
                              : 'bg-slate-900/90 hover:bg-slate-850 text-slate-200 hover:text-white border-slate-800 hover:border-slate-700 shadow-xs'
                          }`}
                        >
                          <div className={`w-10 h-10 rounded-xl shrink-0 flex items-center justify-center border ${
                            isActive
                              ? 'bg-white/20 border-white/30 text-white'
                              : isAmber
                              ? 'bg-amber-900/40 border-amber-700 text-amber-400'
                              : 'bg-slate-800 border-slate-700 text-slate-300'
                          }`}>
                            <Icon className="w-5 h-5" />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-1.5">
                              <span className="text-sm font-black text-white truncate">
                                {item.label}
                              </span>
                              {item.badge && (
                                <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${
                                  isActive
                                    ? 'bg-slate-950 text-white border border-white/30'
                                    : isAmber
                                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                }`}>
                                  {item.badge}
                                </span>
                              )}
                            </div>
                            {item.sublabel && (
                              <p className={`text-[11px] truncate mt-0.5 ${
                                isActive ? 'text-slate-200' : isAmber ? 'text-amber-300/80' : 'text-slate-400'
                              }`}>
                                {item.sublabel}
                              </p>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

              </div>

              {/* Rectangular Footer: Security Clearance & Quick Exit */}
              <div className="p-4 sm:p-5 border-t border-slate-800 bg-gradient-to-r from-slate-900 via-slate-900 to-slate-950 shrink-0 flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
                  <Lock className="w-3.5 h-3.5 text-emerald-400" />
                  <span>256-Bit TLS • FDIC FinCEN Tier-1</span>
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <button
                    onClick={() => {
                      setMobileMenuOpen(false);
                      setCurrentView('home');
                    }}
                    className="flex-1 sm:flex-none py-2 px-3.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 text-xs font-bold flex items-center justify-center gap-1.5 border border-slate-700 transition-colors cursor-pointer"
                  >
                    <Home className="w-3.5 h-3.5" />
                    <span>Public Home</span>
                  </button>

                  <button
                    onClick={() => {
                      setMobileMenuOpen(false);
                      logout();
                    }}
                    className="flex-1 sm:flex-none py-2 px-3.5 rounded-xl bg-red-950/60 hover:bg-red-900/80 text-red-300 hover:text-white text-xs font-bold flex items-center justify-center gap-1.5 border border-red-800/60 transition-colors cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* Page Content Viewport */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto pb-24 lg:pb-8">
          {currentView === 'admin' && (
            <div className="mb-6 p-4 rounded-2xl bg-amber-950/90 border-2 border-amber-500 text-amber-100 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xl">
              <div className="flex items-center gap-3 text-sm font-extrabold">
                <span className="w-3 h-3 rounded-full bg-amber-400 animate-ping" />
                <span>Private URL-Activated Admin Mode (/MonveraMV)</span>
              </div>
              <button
                onClick={() => setCurrentView('dashboard')}
                className="w-full sm:w-auto px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs transition-colors cursor-pointer"
              >
                Return to Member Dashboard
              </button>
            </div>
          )}
          {children}
        </main>
      </div>

      {/* Notifications Drawer */}
      <NotificationsDrawer isOpen={notifsOpen} onClose={() => setNotifsOpen(false)} />
    </div>
  );
};
