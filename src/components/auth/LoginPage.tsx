import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { MonveraLogo } from '../common/MonveraLogo';
import {
  Lock,
  User,
  Eye,
  EyeOff,
  Globe,
  ChevronDown,
  Fingerprint,
  Shield,
  Zap,
  Headphones,
  CheckCircle2,
  AlertCircle,
  X,
} from 'lucide-react';

interface LoginPageProps {
  onSwitchToSignUp?: () => void;
  onClose?: () => void;
  isModal?: boolean;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  onSwitchToSignUp,
  onClose,
  isModal = false,
}) => {
  const { login, switchUser, availableUsers, setCurrentView, sendPasswordReset } = useAuth();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [selectedLang, setSelectedLang] = useState('English');
  const [isLangOpen, setIsLangOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDemoAccounts, setShowDemoAccounts] = useState(false);

  // Forgot Password Modal State
  const [forgotModalOpen, setForgotModalOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [isSendingReset, setIsSendingReset] = useState(false);
  const [resetSuccessMsg, setResetSuccessMsg] = useState<string | null>(null);
  const [resetErrorMsg, setResetErrorMsg] = useState<string | null>(null);

  const languages = ['English', 'Español', 'Français', 'Deutsch', 'العربية', '中文'];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim()) {
      setErrorMessage('Please enter your account number, username, or email.');
      return;
    }
    setErrorMessage(null);
    setIsSubmitting(true);

    const res = await login(identifier.trim(), password);
    setIsSubmitting(false);

    if (!res.success) {
      setErrorMessage(res.error || 'Invalid credentials. Please verify your details.');
    } else {
      if (onClose) onClose();
    }
  };

  const handleBiometricLogin = async () => {
    // Instant Biometric / Demo Fast Access
    setIsSubmitting(true);
    const demoUser = availableUsers[0] || { id: 'usr_eleanor' };
    await switchUser(demoUser.id);
    setIsSubmitting(false);
    setCurrentView('dashboard');
    if (onClose) onClose();
  };

  const handleSendPasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailToUse = (forgotEmail || identifier).trim();
    if (!emailToUse) {
      setResetErrorMsg('Please enter your registered email address.');
      return;
    }
    setResetErrorMsg(null);
    setResetSuccessMsg(null);
    setIsSendingReset(true);

    const res = await sendPasswordReset(emailToUse);
    setIsSendingReset(false);

    if (res.success) {
      setResetSuccessMsg(res.message || `Password reset link sent to ${emailToUse}. Please check your email.`);
    } else {
      setResetErrorMsg(res.error || 'Failed to send password reset email. Please try again.');
    }
  };

  return (
    <div
      id="monvera-login-page"
      className={`min-h-screen w-full flex flex-col justify-between relative overflow-x-hidden ${
        isModal ? 'p-3 sm:p-6' : 'py-8 px-4 sm:px-6 lg:px-8'
      }`}
      style={{
        background: 'radial-gradient(ellipse at 50% 20%, #0c1833 0%, #070e1e 50%, #03070f 100%)',
      }}
    >
      {/* Background Architectural Skyline & Light Atmosphere */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-30">
        <svg
          viewBox="0 0 1440 600"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="absolute bottom-0 w-full h-auto min-h-[300px] object-cover"
        >
          {/* Skyscraper Silhouettes */}
          <path
            d="M80 600V240L140 180H160V600H80Z"
            fill="#0F1C3F"
          />
          <path
            d="M160 600V300H240V600H160Z"
            fill="#0A142D"
          />
          <path
            d="M240 600V120L280 80L320 120V600H240Z"
            fill="#12234F"
          />
          <path
            d="M320 600V260H390V600H320Z"
            fill="#081026"
          />
          <path
            d="M480 600V340H540V600H480Z"
            fill="#0D1A3B"
          />
          <path
            d="M900 600V280H960V600H900Z"
            fill="#0F1E44"
          />
          <path
            d="M1040 600V180H1120V600H1040Z"
            fill="#132452"
          />
          <path
            d="M1120 600V310H1200V600H1120Z"
            fill="#0A142F"
          />
          <path
            d="M1260 600V220L1320 160V600H1260Z"
            fill="#11214B"
          />
          {/* Water reflection ripples */}
          <line x1="0" y1="580" x2="1440" y2="580" stroke="#1E3A8A" strokeWidth="2" strokeOpacity="0.4" />
          <line x1="0" y1="590" x2="1440" y2="590" stroke="#3B82F6" strokeWidth="1.5" strokeOpacity="0.3" />
        </svg>

        {/* Ambient Top Glows */}
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-[650px] h-[350px] bg-blue-600/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-1/4 right-10 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />
      </div>

      {/* TOP BAR: Logo & Language Selector */}
      <header className="relative z-10 max-w-7xl mx-auto w-full flex items-center justify-between pb-6 sm:pb-8">
        <div
          onClick={() => setCurrentView('home')}
          className="cursor-pointer flex items-center"
        >
          <MonveraLogo variant="full" size="md" isLight={true} />
        </div>

        <div className="flex items-center gap-3">
          {/* Language Selector Dropdown */}
          <div className="relative">
            <button
              type="button"
              id="login-lang-selector"
              onClick={() => setIsLangOpen(!isLangOpen)}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900/80 hover:bg-slate-850 text-slate-200 border border-slate-700/80 text-xs font-semibold backdrop-blur-md shadow-sm transition-colors cursor-pointer"
            >
              <Globe className="w-4 h-4 text-slate-400" />
              <span>{selectedLang}</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>

            {isLangOpen && (
              <div className="absolute right-0 mt-2 w-36 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl py-1.5 z-30 text-xs animate-in fade-in zoom-in-95 duration-150">
                {languages.map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => {
                      setSelectedLang(lang);
                      setIsLangOpen(false);
                    }}
                    className={`w-full text-left px-3.5 py-2 hover:bg-slate-800 text-slate-200 transition-colors flex items-center justify-between ${
                      selectedLang === lang ? 'text-amber-400 font-bold bg-slate-800/60' : ''
                    }`}
                  >
                    <span>{lang}</span>
                    {selectedLang === lang && <span className="text-amber-400 text-xs">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Close button if shown as modal */}
          {isModal && onClose && (
            <button
              onClick={onClose}
              id="login-close-btn"
              className="w-9 h-9 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition-colors border border-slate-700 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {/* MAIN CONTENT: Centered Login Card */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center py-4 sm:py-6">
        <div
          id="login-card-container"
          className="w-full max-w-[480px] sm:max-w-[500px] bg-white rounded-[28px] sm:rounded-[32px] p-7 sm:p-10 shadow-2xl border border-slate-100 relative overflow-hidden"
        >
          {/* Desktop & Mobile Quick Switcher Bar */}
          <div className="flex rounded-2xl bg-slate-100 p-1.5 mb-6 border border-slate-200 shadow-inner">
            <button
              type="button"
              id="login-tab-signin"
              className="flex-1 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-extrabold text-slate-950 bg-white shadow-xs transition-all flex items-center justify-center gap-1.5 select-none"
            >
              <Lock className="w-3.5 h-3.5 text-amber-500" />
              <span>Sign In</span>
            </button>
            <button
              type="button"
              id="login-tab-signup"
              onClick={onSwitchToSignUp}
              className="flex-1 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-bold text-slate-600 hover:text-slate-950 hover:bg-white/60 transition-all flex items-center justify-center gap-1.5 cursor-pointer select-none"
            >
              <User className="w-3.5 h-3.5 text-slate-400" />
              <span>Create Account</span>
            </button>
          </div>

          {/* Card Top Title */}
          <div className="text-center pb-5">
            <h1 className="text-2xl sm:text-[28px] font-black text-slate-900 tracking-tight font-sans">
              Welcome Back
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
              Sign in to access your Monvera sovereign financial dashboard
            </p>
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div className="mb-4 p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs sm:text-sm text-red-700 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span className="font-semibold">{errorMessage}</span>
            </div>
          )}

          {/* Login Form */}
          <form onSubmit={handleSubmit} className="space-y-4.5">
            {/* Account Number / Username / Email Field */}
            <div className="space-y-1.5">
              <label className="block text-xs sm:text-sm font-bold text-slate-700">
                Account Number, Username, or Email
              </label>
              <div className="relative">
                <User className="w-5 h-5 text-slate-400 absolute left-4 top-4 pointer-events-none" />
                <input
                  type="text"
                  required
                  id="login-identifier-input"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="Enter account number, email, or username"
                  className="w-full pl-12 pr-4 py-3.5 sm:py-4 text-sm sm:text-base font-medium text-slate-900 bg-slate-50/80 hover:bg-slate-50 focus:bg-white border border-slate-200 focus:border-slate-900 rounded-xl focus:outline-hidden transition-all shadow-2xs placeholder:text-slate-400"
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="space-y-1.5">
              <label className="block text-xs sm:text-sm font-bold text-slate-700">
                Password
              </label>
              <div className="relative">
                <Lock className="w-5 h-5 text-slate-400 absolute left-4 top-4 pointer-events-none" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  id="login-password-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your account password"
                  className="w-full pl-12 pr-12 py-3.5 sm:py-4 text-sm sm:text-base font-medium text-slate-900 bg-slate-50/80 hover:bg-slate-50 focus:bg-white border border-slate-200 focus:border-slate-900 rounded-xl focus:outline-hidden transition-all shadow-2xs placeholder:text-slate-400"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* Remember Me & Forgot Password Row */}
            <div className="flex items-center justify-between pt-1 text-xs sm:text-sm">
              <label className="flex items-center gap-2 font-medium text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  id="login-remember-me"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded text-slate-900 border-slate-300 focus:ring-slate-800 cursor-pointer"
                />
                <span>Remember me</span>
              </label>

              <button
                type="button"
                id="login-forgot-password-btn"
                onClick={() => {
                  setForgotEmail(identifier.includes('@') ? identifier : '');
                  setResetSuccessMsg(null);
                  setResetErrorMsg(null);
                  setForgotModalOpen(true);
                }}
                className="font-bold text-blue-600 hover:text-blue-700 hover:underline cursor-pointer"
              >
                Forgot Password?
              </button>
            </div>

            {/* Primary Sign In Button (Large, prominent navy) */}
            <div className="pt-2">
              <button
                type="submit"
                id="login-submit-btn"
                disabled={isSubmitting}
                className="w-full py-4 px-6 rounded-xl font-black text-sm sm:text-base text-white bg-[#0A1227] hover:bg-[#060B18] active:scale-[0.99] border border-slate-800 shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <Lock className="w-4 h-4 text-amber-400" />
                <span>{isSubmitting ? 'Authenticating...' : 'Sign In to Account'}</span>
              </button>
            </div>

            {/* OR Divider */}
            <div className="relative flex items-center justify-center py-2">
              <div className="w-full border-t border-slate-200" />
              <span className="bg-white px-3 text-xs font-bold text-slate-400 uppercase tracking-wider font-mono absolute">
                OR
              </span>
            </div>

            {/* Login with Biometrics / Fast Demo Button */}
            <div>
              <button
                type="button"
                id="login-biometrics-btn"
                onClick={handleBiometricLogin}
                className="w-full py-3.5 px-4 rounded-xl font-bold text-xs sm:text-sm text-slate-800 bg-white hover:bg-slate-50 border border-slate-300 shadow-2xs hover:shadow-xs transition-all flex items-center justify-center gap-2.5 cursor-pointer"
              >
                <Fingerprint className="w-5 h-5 text-blue-600" />
                <span>Login with Biometrics (Fast Access)</span>
              </button>
            </div>

            {/* 1-Click Demo Users Dropdown */}
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowDemoAccounts(!showDemoAccounts)}
                className="w-full text-center text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
              >
                {showDemoAccounts ? '▲ Hide Quick Demo Accounts' : '▼ Instant 1-Click Evaluation Logins'}
              </button>

              {showDemoAccounts && (
                <div className="mt-2 p-2.5 bg-slate-50 rounded-xl border border-slate-200 grid grid-cols-2 gap-2 animate-in fade-in duration-150">
                  {availableUsers.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => {
                        setIdentifier(u.email);
                        setPassword('Password123!');
                      }}
                      className="p-2.5 rounded-lg bg-white hover:bg-slate-900 hover:text-white text-slate-800 text-left border border-slate-200 text-xs transition-all shadow-2xs"
                    >
                      <div className="font-bold truncate">{u.firstName} {u.lastName}</div>
                      <div className="text-[11px] text-slate-400 font-mono truncate">{u.email}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </form>
        </div>
      </main>

      {/* BOTTOM SECTION: 4 Bank-Grade Feature Blocks & Sign Up Link (Compact & balanced) */}
      <footer className="relative z-10 max-w-5xl mx-auto w-full pt-4 sm:pt-6 pb-2 space-y-4 sm:space-y-5">
        {/* 4 Feature Icons Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-2">
          {/* Feature 1 */}
          <div className="flex flex-col items-center text-center space-y-1.5 p-3 rounded-2xl bg-slate-900/50 border border-slate-800/80 backdrop-blur-xs">
            <div className="w-9 h-9 rounded-full bg-slate-800/90 border border-slate-700 flex items-center justify-center text-amber-400 shadow-inner">
              <Shield className="w-4.5 h-4.5" />
            </div>
            <div>
              <div className="text-xs font-bold text-white tracking-tight">Bank-Grade Security</div>
              <div className="text-[11px] text-slate-400 font-medium">256-bit AES encryption</div>
            </div>
          </div>

          {/* Feature 2 */}
          <div className="flex flex-col items-center text-center space-y-1.5 p-3 rounded-2xl bg-slate-900/50 border border-slate-800/80 backdrop-blur-xs">
            <div className="w-9 h-9 rounded-full bg-slate-800/90 border border-slate-700 flex items-center justify-center text-amber-400 shadow-inner">
              <Zap className="w-4.5 h-4.5" />
            </div>
            <div>
              <div className="text-xs font-bold text-white tracking-tight">Instant Settlement</div>
              <div className="text-[11px] text-slate-400 font-medium">Real-time global ledger</div>
            </div>
          </div>

          {/* Feature 3 */}
          <div className="flex flex-col items-center text-center space-y-1.5 p-3 rounded-2xl bg-slate-900/50 border border-slate-800/80 backdrop-blur-xs">
            <div className="w-9 h-9 rounded-full bg-slate-800/90 border border-slate-700 flex items-center justify-center text-amber-400 shadow-inner">
              <Globe className="w-4.5 h-4.5" />
            </div>
            <div>
              <div className="text-xs font-bold text-white tracking-tight">Global Access</div>
              <div className="text-[11px] text-slate-400 font-medium">Multi-currency sovereign accounts</div>
            </div>
          </div>

          {/* Feature 4 */}
          <div className="flex flex-col items-center text-center space-y-2 p-3 rounded-2xl bg-slate-900/50 border border-slate-800/80 backdrop-blur-xs">
            <div className="w-9 h-9 rounded-full bg-slate-800/90 border border-slate-700 flex items-center justify-center text-amber-400 shadow-inner">
              <Headphones className="w-4.5 h-4.5" />
            </div>
            <div>
              <div className="text-xs font-bold text-white tracking-tight">24/7 Priority Support</div>
              <div className="text-[11px] text-slate-400 font-medium">Concierge service always live</div>
            </div>
          </div>
        </div>

        {/* Bottom Sign Up Redirect Link */}
        <div className="text-center pb-1">
          <p className="text-xs sm:text-sm text-slate-300 font-medium">
            Don't have an account yet?{' '}
            <button
              type="button"
              id="switch-to-signup-btn"
              onClick={onSwitchToSignUp}
              className="font-black text-amber-400 hover:text-amber-300 hover:underline cursor-pointer ml-1"
            >
              Create Account (Sign Up)
            </button>
          </p>
        </div>
      </footer>

      {/* Forgot Password Dialog (Full-featured real Firebase Password Reset) */}
      {forgotModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full text-center space-y-4 shadow-2xl border border-slate-200 relative">
            <button
              onClick={() => setForgotModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 p-1.5 rounded-full hover:bg-slate-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="w-14 h-14 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto shadow-inner border border-blue-100">
              <Lock className="w-7 h-7" />
            </div>

            <div>
              <h3 className="text-xl font-black text-slate-900 tracking-tight">Reset Your Password</h3>
              <p className="text-xs sm:text-sm text-slate-500 mt-1 font-medium">
                Enter your registered email address below. We'll send an official password reset link directly to your inbox.
              </p>
            </div>

            {resetSuccessMsg && (
              <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-xs sm:text-sm text-emerald-800 font-semibold flex items-start gap-2.5 text-left">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <span>{resetSuccessMsg}</span>
              </div>
            )}

            {resetErrorMsg && (
              <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs sm:text-sm text-red-700 font-semibold flex items-start gap-2.5 text-left">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{resetErrorMsg}</span>
              </div>
            )}

            {!resetSuccessMsg ? (
              <form onSubmit={handleSendPasswordReset} className="space-y-4 text-left">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    Registered Email Address
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="e.g. user@domain.com"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    className="w-full px-4 py-3.5 text-sm rounded-xl border border-slate-300 focus:border-slate-900 focus:outline-hidden font-medium text-slate-900"
                  />
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600 font-medium">
                  Default evaluation password: <strong className="text-slate-900 font-bold">Password123!</strong>
                </div>

                <button
                  type="submit"
                  disabled={isSendingReset}
                  className="w-full py-3.5 rounded-xl bg-slate-950 hover:bg-slate-900 text-white font-black text-sm shadow-md transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isSendingReset ? 'Sending Reset Instructions...' : 'Send Password Reset Email'}
                </button>
              </form>
            ) : (
              <button
                onClick={() => setForgotModalOpen(false)}
                className="w-full py-3.5 rounded-xl bg-slate-950 hover:bg-slate-900 text-white font-black text-sm shadow-md cursor-pointer"
              >
                Close & Return to Sign In
              </button>
            )}

            <button
              onClick={() => setForgotModalOpen(false)}
              className="text-xs font-bold text-slate-500 hover:text-slate-800 block mx-auto pt-1 cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
