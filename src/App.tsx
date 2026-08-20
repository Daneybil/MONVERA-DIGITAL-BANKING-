import React from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { PublicNavbar } from './components/public/PublicNavbar';
import { HeroSection } from './components/public/HeroSection';
import { ServiceOfferings } from './components/public/ServiceOfferings';
import { InvestmentTermPreview } from './components/public/InvestmentTermPreview';
import { CardShowcaseSection } from './components/public/CardShowcaseSection';
import { HowItWorksSection } from './components/public/HowItWorksSection';
import { SecuritySection } from './components/public/SecuritySection';
import { PrivacyPolicyPage } from './components/public/PrivacyPolicyPage';
import { TermsOfServicePage } from './components/public/TermsOfServicePage';
import { SecurityProtocolsPage } from './components/public/SecurityProtocolsPage';
import { PublicFooter } from './components/public/PublicFooter';
import { ArrowLeft } from 'lucide-react';

import { DashboardLayout } from './components/dashboard/DashboardLayout';
import { DashboardOverview } from './components/dashboard/DashboardOverview';
import { AccountsView } from './components/dashboard/AccountsView';
import { TransactionsView } from './components/dashboard/TransactionsView';
import { InvestmentsView } from './components/dashboard/InvestmentsView';
import { CardsView } from './components/dashboard/CardsView';
import { SecurityView } from './components/dashboard/SecurityView';
import { ProfileView } from './components/dashboard/ProfileView';
import { BusinessBankingView } from './components/dashboard/BusinessBankingView';
import { AdminDashboard } from './components/admin/AdminDashboard';

import { AuthModals } from './components/auth/AuthModals';
import { SendMoneyModal } from './components/dashboard/SendMoneyModal';
import { ReceiveMoneyModal } from './components/dashboard/ReceiveMoneyModal';
import { DepositModal } from './components/dashboard/DepositModal';
import { WithdrawModal } from './components/dashboard/WithdrawModal';

const AppContent: React.FC = () => {
  const { currentView, currentUser, setCurrentView } = useAuth();

  // Dedicated Monvera Bank Offers Page
  if (currentView === 'offers') {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-white">
        <PublicNavbar />
        <div className="bg-slate-850 border-b border-slate-700 py-3.5 px-4 sm:px-8">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <button
              onClick={() => {
                setCurrentView('home');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="inline-flex items-center gap-2 text-sm font-bold text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Monvera Home</span>
            </button>
            <span className="text-xs font-mono uppercase tracking-wider text-slate-400">
              Monvera Bank Offers & Solutions
            </span>
          </div>
        </div>
        <main className="flex-1">
          <ServiceOfferings />
        </main>
        <PublicFooter />
        <AuthModals />
      </div>
    );
  }

  // Dedicated How Monvera Bank Works Page
  if (currentView === 'how-it-works') {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-white">
        <PublicNavbar />
        <div className="bg-slate-850 border-b border-slate-700 py-3.5 px-4 sm:px-8">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <button
              onClick={() => {
                setCurrentView('home');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="inline-flex items-center gap-2 text-sm font-bold text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Monvera Home</span>
            </button>
            <span className="text-xs font-mono uppercase tracking-wider text-slate-400">
              How Monvera Works Guide
            </span>
          </div>
        </div>
        <main className="flex-1">
          <HowItWorksSection />
        </main>
        <PublicFooter />
        <AuthModals />
      </div>
    );
  }

  // Dedicated Privacy Policy Page
  if (currentView === 'privacy') {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-white">
        <PublicNavbar />
        <div className="bg-slate-850 border-b border-slate-700 py-3.5 px-4 sm:px-8">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <button
              onClick={() => {
                setCurrentView('home');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="inline-flex items-center gap-2 text-sm font-bold text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Monvera Home</span>
            </button>
            <span className="text-xs font-mono uppercase tracking-wider text-slate-400">
              Monvera & Nuvera Privacy Policy
            </span>
          </div>
        </div>
        <main className="flex-1">
          <PrivacyPolicyPage />
        </main>
        <PublicFooter />
        <AuthModals />
      </div>
    );
  }

  // Dedicated Terms of Service Page
  if (currentView === 'terms') {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-white">
        <PublicNavbar />
        <div className="bg-slate-850 border-b border-slate-700 py-3.5 px-4 sm:px-8">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <button
              onClick={() => {
                setCurrentView('home');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="inline-flex items-center gap-2 text-sm font-bold text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Monvera Home</span>
            </button>
            <span className="text-xs font-mono uppercase tracking-wider text-slate-400">
              Monvera & Nuvera Terms of Service
            </span>
          </div>
        </div>
        <main className="flex-1">
          <TermsOfServicePage />
        </main>
        <PublicFooter />
        <AuthModals />
      </div>
    );
  }

  // Dedicated Security Protocols Page
  if (currentView === 'security-protocol') {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-white">
        <PublicNavbar />
        <div className="bg-slate-850 border-b border-slate-700 py-3.5 px-4 sm:px-8">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <button
              onClick={() => {
                setCurrentView('home');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="inline-flex items-center gap-2 text-sm font-bold text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Monvera Home</span>
            </button>
            <span className="text-xs font-mono uppercase tracking-wider text-slate-400">
              Monvera Security Protocols
            </span>
          </div>
        </div>
        <main className="flex-1">
          <SecurityProtocolsPage />
        </main>
        <PublicFooter />
        <AuthModals />
      </div>
    );
  }

  // Dedicated Public Investment Center Page (When accessed outside login)
  if (currentView === 'investments' && !currentUser) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-white">
        <PublicNavbar />
        <div className="bg-slate-850 border-b border-slate-700 py-3.5 px-4 sm:px-8">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <button
              onClick={() => {
                setCurrentView('home');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="inline-flex items-center gap-2 text-sm font-bold text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Monvera Home</span>
            </button>
            <span className="text-xs font-mono uppercase tracking-wider text-slate-400">
              Monvera Sovereign Investment Center
            </span>
          </div>
        </div>
        <main className="flex-1 py-8">
          <InvestmentTermPreview />
        </main>
        <PublicFooter />
        <AuthModals />
      </div>
    );
  }

  // If user is on the public landing page ('home')
  if (currentView === 'home') {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-white">
        <PublicNavbar />
        <main className="flex-1">
          <HeroSection />
          <InvestmentTermPreview />
          <CardShowcaseSection />
          <SecuritySection />
        </main>
        <PublicFooter />
        
        {/* Global Modals */}
        <AuthModals />
        <SendMoneyModal />
        <ReceiveMoneyModal />
        <DepositModal />
        <WithdrawModal />
      </div>
    );
  }

  // Authenticated Portal Views
  return (
    <DashboardLayout>
      {currentView === 'dashboard' && <DashboardOverview />}
      {currentView === 'accounts' && <AccountsView />}
      {currentView === 'transactions' && <TransactionsView />}
      {currentView === 'investments' && <InvestmentsView />}
      {currentView === 'cards' && <CardsView />}
      {currentView === 'security' && <SecurityView />}
      {currentView === 'profile' && <ProfileView />}
      {currentView === 'business' && <BusinessBankingView />}
      {currentView === 'admin' && <AdminDashboard />}

      {/* Global Modals */}
      <AuthModals />
      <SendMoneyModal />
      <ReceiveMoneyModal />
      <DepositModal />
      <WithdrawModal />
    </DashboardLayout>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
