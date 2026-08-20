import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { MonveraLogo } from '../common/MonveraLogo';
import { X, Lock, Mail, User, Phone, ShieldCheck, ArrowRight, CheckCircle2, AlertCircle, Building2 } from 'lucide-react';

export const AuthModals: React.FC = () => {
  const { activeModal, closeModal, openModal, login, registerUser, availableUsers, switchUser, setCurrentView } = useAuth();

  // Login form state
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Register form state
  const [regFirstName, setRegFirstName] = useState('');
  const [regLastName, setRegLastName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regDOB, setRegDOB] = useState('1992-06-15');
  const [regCountry, setRegCountry] = useState('United States');
  const [isBusiness, setIsBusiness] = useState(false);
  const [businessName, setBusinessName] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(true);
  const [regError, setRegError] = useState<string | null>(null);

  if (!activeModal || (activeModal !== 'auth_login' && activeModal !== 'auth_register')) {
    return null;
  }

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginIdentifier) {
      setLoginError('Please enter your email address or 10-digit Monvera Account Number.');
      return;
    }
    setLoginError(null);
    setIsSubmitting(true);

    const res = await login(loginIdentifier, loginPassword);
    setIsSubmitting(false);
    if (!res.success) {
      setLoginError(res.error || 'Invalid credentials.');
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regFirstName || !regLastName || !regEmail) {
      setRegError('Please complete all required fields.');
      return;
    }
    if (!termsAccepted) {
      setRegError('Please accept the Monvera Account Terms and Privacy Agreement.');
      return;
    }
    setRegError(null);
    setIsSubmitting(true);

    const res = await registerUser({
      firstName: regFirstName,
      lastName: regLastName,
      email: regEmail,
      phone: regPhone,
      dateOfBirth: regDOB,
      country: regCountry,
      isBusiness,
      businessName: isBusiness ? businessName : undefined,
    });
    setIsSubmitting(false);
    if (!res.success) {
      setRegError(res.error || 'Registration could not be completed.');
    }
  };

  return (
    <div
      id="monvera-auth-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeModal();
      }}
    >
      <div
        id="monvera-auth-modal-container"
        className="w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden relative max-h-[92vh] flex flex-col animate-in zoom-in-95 duration-150"
      >
        {/* Close Button */}
        <button
          onClick={closeModal}
          className="absolute top-5 right-5 w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-colors z-10"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Modal Header */}
        <div className="p-6 sm:p-8 bg-slate-50 border-b border-slate-100 flex-shrink-0">
          <MonveraLogo variant="full" size="md" />
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 mt-4">
            {activeModal === 'auth_login' ? 'Sign In to Monvera Banking' : 'Open Your Monvera Account'}
          </h2>
          <p className="text-xs sm:text-sm text-slate-600 mt-1">
            {activeModal === 'auth_login'
              ? 'Access your accounts, instant transfers, and term investments securely.'
              : 'Receive a permanent 10-digit Monvera account number in less than 2 minutes.'}
          </p>
        </div>

        {/* Modal Body */}
        <div className="p-6 sm:p-8 overflow-y-auto flex-1 space-y-6">
          
          {/* Quick Demo Logins for instant evaluation */}
          <div className="p-4 rounded-2xl bg-emerald-50/70 border border-emerald-200/80 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-emerald-900 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Instant Demo Access (Pre-Configured)
              </span>
              <span className="text-[10px] text-emerald-700 font-mono">1-Click Login</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
              {availableUsers.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => {
                    switchUser(u.id);
                    closeModal();
                    if (u.role === 'super_admin' || u.role === 'admin') {
                      setCurrentView('admin');
                    } else {
                      setCurrentView('dashboard');
                    }
                  }}
                  className="p-2 rounded-xl bg-white hover:bg-emerald-600 hover:text-white border border-emerald-300/80 text-slate-800 text-left transition-all group"
                >
                  <div className="font-bold text-xs truncate group-hover:text-white">{u.firstName}</div>
                  <div className="text-[10px] text-slate-500 group-hover:text-emerald-100 font-mono truncate">
                    {u.role === 'super_admin' ? 'Super Admin' : u.membershipTier}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* LOGIN FORM */}
          {activeModal === 'auth_login' && (
            <form onSubmit={handleLoginSubmit} className="space-y-4">
              {loginError && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{loginError}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Email or Monvera Account Number
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    placeholder="e.g. eleanor.vance@monvera.com or 1045827391"
                    value={loginIdentifier}
                    onChange={(e) => setLoginIdentifier(e.target.value)}
                    className="w-full px-4 py-3 text-sm rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-white"
                  />
                  <Mail className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5" />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Password
                  </label>
                  <span className="text-xs text-emerald-700 hover:underline cursor-pointer">
                    Forgot password?
                  </span>
                </div>
                <div className="relative">
                  <input
                    type="password"
                    placeholder="••••••••••••"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    className="w-full px-4 py-3 text-sm rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-white"
                  />
                  <Lock className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5" />
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3.5 px-6 rounded-xl font-bold text-sm text-white bg-slate-900 hover:bg-slate-800 transition-colors shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <span>{isSubmitting ? 'Authenticating...' : 'Sign In'}</span>
                  <ArrowRight className="w-4 h-4 text-emerald-400" />
                </button>
              </div>

              <div className="text-center pt-2">
                <span className="text-xs text-slate-500">
                  Don't have a Monvera account yet?{' '}
                  <button
                    type="button"
                    onClick={() => openModal('auth_register')}
                    className="text-emerald-700 font-bold hover:underline"
                  >
                    Open an Account
                  </button>
                </span>
              </div>
            </form>
          )}

          {/* REGISTER FORM */}
          {activeModal === 'auth_register' && (
            <form onSubmit={handleRegisterSubmit} className="space-y-4">
              {regError && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{regError}</span>
                </div>
              )}

              {/* Account Type Selector */}
              <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-xl">
                <button
                  type="button"
                  onClick={() => setIsBusiness(false)}
                  className={`py-2 text-xs font-bold rounded-lg transition-all ${
                    !isBusiness ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Personal Banking
                </button>
                <button
                  type="button"
                  onClick={() => setIsBusiness(true)}
                  className={`py-2 text-xs font-bold rounded-lg transition-all ${
                    isBusiness ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Business Banking
                </button>
              </div>

              {isBusiness && (
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Company / Enterprise Name
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Apex Global Ventures LLC"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    className="w-full px-4 py-2.5 text-sm rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 bg-white"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                    First Name
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Eleanor"
                    value={regFirstName}
                    onChange={(e) => setRegFirstName(e.target.value)}
                    className="w-full px-4 py-2.5 text-sm rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 bg-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Last Name
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Vance"
                    value={regLastName}
                    onChange={(e) => setRegLastName(e.target.value)}
                    className="w-full px-4 py-2.5 text-sm rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 bg-white"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  placeholder="e.g. eleanor.vance@example.com"
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  className="w-full px-4 py-2.5 text-sm rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 bg-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    placeholder="+1 (555) 000-0000"
                    value={regPhone}
                    onChange={(e) => setRegPhone(e.target.value)}
                    className="w-full px-4 py-2.5 text-sm rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 bg-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Country
                  </label>
                  <input
                    type="text"
                    value={regCountry}
                    onChange={(e) => setRegCountry(e.target.value)}
                    className="w-full px-4 py-2.5 text-sm rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 bg-white"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Password
                </label>
                <input
                  type="password"
                  placeholder="At least 8 characters"
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  className="w-full px-4 py-2.5 text-sm rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 bg-white"
                />
              </div>

              <div className="flex items-start gap-2.5 pt-1">
                <input
                  type="checkbox"
                  id="terms-check"
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                  className="mt-0.5 accent-emerald-600 rounded cursor-pointer"
                />
                <label htmlFor="terms-check" className="text-xs text-slate-600 cursor-pointer">
                  I agree to the Monvera Customer Agreement, Ledger Accounting Terms, and Member FDIC partner disclosures.
                </label>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3.5 px-6 rounded-xl font-bold text-sm text-white bg-emerald-600 hover:bg-emerald-700 transition-colors shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <span>{isSubmitting ? 'Opening Account...' : 'Generate Account & Launch Dashboard'}</span>
                  <ArrowRight className="w-4 h-4 text-white" />
                </button>
              </div>

              <div className="text-center pt-2">
                <span className="text-xs text-slate-500">
                  Already have an account?{' '}
                  <button
                    type="button"
                    onClick={() => openModal('auth_login')}
                    className="text-slate-900 font-bold hover:underline"
                  >
                    Log In
                  </button>
                </span>
              </div>
            </form>
          )}

        </div>
      </div>
    </div>
  );
};
