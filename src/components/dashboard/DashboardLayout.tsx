import React, { useState } from 'react';
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
  Zap,
  ArrowLeft,
} from 'lucide-react';

interface DashboardLayoutProps {
  children: React.ReactNode;
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

  if (!currentUser) return null;

  const navItems: { id: AppView; label: string; icon: React.ElementType; actionType?: 'view' | 'modal'; modalName?: any }[] = [
    { id: 'dashboard', label: 'Overview', icon: LayoutDashboard, actionType: 'view' },
    { id: 'accounts', label: 'Accounts', icon: Wallet, actionType: 'view' },
    { id: 'transactions', label: 'Transactions', icon: ArrowLeftRight, actionType: 'view' },
    { id: 'send', label: 'Send Money', icon: Send, actionType: 'modal', modalName: 'send' },
    { id: 'receive', label: 'Receive', icon: QrCode, actionType: 'modal', modalName: 'receive' },
    { id: 'deposit', label: 'Deposit', icon: Plus, actionType: 'modal', modalName: 'deposit' },
    { id: 'withdraw', label: 'Withdraw', icon: Landmark, actionType: 'modal', modalName: 'withdraw' },
    { id: 'investments', label: 'Investments', icon: TrendingUp, actionType: 'view' },
    { id: 'cards', label: 'Cards', icon: CreditCard, actionType: 'view' },
    { id: 'security', label: 'Security', icon: ShieldCheck, actionType: 'view' },
    { id: 'profile', label: 'Profile', icon: User, actionType: 'view' },
    { id: 'business', label: 'Business Banking', icon: Building2, actionType: 'view' },
  ];

  const handleNavClick = (item: typeof navItems[0]) => {
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
        <div className="p-4 mx-4 mt-4 rounded-2xl bg-slate-850 border border-slate-800 space-y-1.5">
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
              className="flex-1 py-1.5 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center justify-center gap-1 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Deposit</span>
            </button>
            <button
              id="sidebar-send-btn"
              onClick={() => openModal('send')}
              className="flex-1 py-1.5 px-2.5 rounded-lg bg-slate-700 hover:bg-slate-650 text-white text-xs font-semibold flex items-center justify-center gap-1 transition-colors"
            >
              <Send className="w-3.5 h-3.5 text-emerald-400" />
              <span>Send</span>
            </button>
          </div>
        </div>

        {/* Navigation Links */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
          <div className="px-3 py-1.5 text-[10px] uppercase font-bold text-slate-500 tracking-wider">
            Menu
          </div>

          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                id={`sidebar-nav-${item.id}`}
                onClick={() => handleNavClick(item)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}

          {/* Admin Portal Nav Item (Always visible for easy audit/testing) */}
          <div className="pt-3 border-t border-slate-800/80">
            <button
              id="sidebar-nav-admin"
              onClick={() => setCurrentView('admin')}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                currentView === 'admin'
                  ? 'bg-amber-600 text-white'
                  : 'text-amber-400/90 hover:text-amber-300 hover:bg-amber-950/40 border border-amber-500/20'
              }`}
            >
              <div className="flex items-center gap-3">
                <Shield className="w-4 h-4 text-amber-400" />
                <span>Admin Governance</span>
              </div>
              <span className="text-[9px] uppercase font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">
                Core
              </span>
            </button>
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
              className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-red-400 transition-colors"
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
          
          {/* Left Title / Greeting & Back to Home Button */}
          <div className="flex items-center gap-3">
            {/* Mobile Menu Button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded-lg text-slate-700 hover:bg-slate-100 lg:hidden"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>

            {/* Prominent Back Button on Dashboard */}
            <button
              id="dashboard-back-to-home-btn"
              onClick={() => {
                setCurrentView('home');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-slate-950 text-xs font-extrabold border border-slate-300 transition-colors cursor-pointer"
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
              className="hidden md:inline-flex items-center gap-2 px-3.5 py-2.5 text-xs font-bold text-slate-700 hover:text-slate-950 bg-slate-100 hover:bg-slate-200/80 rounded-xl border border-slate-250 transition-colors"
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
                className="flex items-center gap-2 px-3.5 py-2.5 text-xs font-bold text-slate-900 bg-slate-100 hover:bg-slate-200/80 rounded-xl border border-slate-300/80 shadow-2xs transition-colors"
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
                      className={`w-full text-left px-4 py-2.5 text-xs flex items-center justify-between hover:bg-slate-50 transition-colors ${
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
              className="relative p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300/80 transition-colors"
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
              className="hidden sm:inline-flex items-center gap-2 px-5 py-2.5 text-xs font-extrabold text-white bg-slate-950 hover:bg-slate-900 rounded-xl shadow-md border border-slate-800 transition-all active:scale-[0.98]"
            >
              <Send className="w-3.5 h-3.5 text-emerald-400" />
              <span>Send Money</span>
            </button>
          </div>
        </header>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <div className="lg:hidden bg-slate-900 text-white p-4 space-y-2 border-b border-slate-800 shadow-xl z-40">
            <div className="grid grid-cols-2 gap-2">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleNavClick(item)}
                    className={`flex items-center gap-2 p-2.5 rounded-xl text-xs font-semibold ${
                      currentView === item.id ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  setCurrentView('admin');
                }}
                className="flex items-center gap-2 p-2.5 rounded-xl text-xs font-semibold bg-amber-950 text-amber-300 border border-amber-800"
              >
                <Shield className="w-4 h-4 text-amber-400" />
                <span>Admin Governance</span>
              </button>
            </div>
          </div>
        )}

        {/* Page Content Viewport */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto pb-24 lg:pb-8">
          {children}
        </main>
      </div>

      {/* Notifications Drawer */}
      <NotificationsDrawer isOpen={notifsOpen} onClose={() => setNotifsOpen(false)} />
    </div>
  );
};
