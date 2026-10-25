import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  Shield,
  Lock,
  Mail,
  Eye,
  EyeOff,
  AlertCircle,
  Loader2,
  ArrowLeft,
  KeyRound,
  CheckCircle2,
  Server,
} from 'lucide-react';

interface AdminLoginFormProps {
  onCancel?: () => void;
  onSuccess?: () => void;
}

export const AdminLoginForm: React.FC<AdminLoginFormProps> = ({ onCancel, onSuccess }) => {
  const { adminLogin, setCurrentView } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const cleanEmail = email.trim().toLowerCase();
    const cleanPassword = password;

    if (!cleanEmail) {
      setErrorCode('INVALID_INPUT');
      setErrorMessage('Please enter your administrator email address.');
      return;
    }

    if (!cleanEmail.includes('@')) {
      setErrorCode('INVALID_INPUT');
      setErrorMessage('Please enter a valid email format (e.g. admin@monvera.com).');
      return;
    }

    if (!cleanPassword) {
      setErrorCode('INVALID_INPUT');
      setErrorMessage('Please enter your administrator password.');
      return;
    }

    setErrorMessage(null);
    setErrorCode(null);
    setIsSubmitting(true);

    try {
      const res = await adminLogin(cleanEmail, cleanPassword);

      if (!res.success) {
        setErrorCode(res.errorCode || 'AUTH_FAILED');
        setErrorMessage(res.error || 'Administrator authentication failed. Access denied.');
      } else {
        if (onSuccess) onSuccess();
      }
    } catch (err: any) {
      setErrorCode('UNEXPECTED');
      setErrorMessage(err?.message || 'An unexpected error occurred during sign-in.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getCategorizedErrorDetails = () => {
    if (!errorMessage) return null;

    switch (errorCode) {
      case 'EMAIL_NOT_ADMIN':
        return {
          title: 'Administrator Identity Not Recognized',
          description: errorMessage,
          hint: 'The email address entered is not configured in the server environment (ADMIN_EMAIL or ADMIN_EMAILS). Please ensure you are using the authorized executive address.',
          badge: 'Identity Mismatch',
        };
      case 'INVALID_CREDENTIALS':
        return {
          title: 'Invalid Administrator Credentials',
          description: errorMessage,
          hint: 'The password entered does not match the master administrator secret (ADMIN_PASSWORD) configured on the Railway banking backend.',
          badge: 'Authentication Failed',
        };
      case 'CONFIG_UNAVAILABLE':
        return {
          title: 'Required Server Configuration Unavailable',
          description: errorMessage,
          hint: 'The backend server is missing required administrator environment variables or Firebase Admin service account keys. Check Railway environment settings.',
          badge: 'Server Config Notice',
        };
      case 'NETWORK_FAILURE':
        return {
          title: 'Connection / Network Failure',
          description: errorMessage,
          hint: 'Unable to reach the Monvera Banking Core API. Verify server status and network connectivity.',
          badge: 'Network Error',
        };
      case 'TOKEN_AUTH_FAILED':
        return {
          title: 'Cryptographic Token Exchange Failure',
          description: errorMessage,
          hint: 'The backend verified your credentials, but Firebase was unable to exchange the cryptographic custom token.',
          badge: 'Token Error',
        };
      default:
        return {
          title: 'Authentication Denied',
          description: errorMessage,
          hint: undefined,
          badge: 'Access Denied',
        };
    }
  };

  const errorInfo = getCategorizedErrorDetails();

  return (
    <div
      id="monvera-admin-login-screen"
      className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-4 sm:p-6 font-sans selection:bg-amber-400 selection:text-slate-950"
    >
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden">
        {/* Subtle executive background glow */}
        <div className="absolute -top-24 -right-24 w-60 h-60 bg-amber-400/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-60 h-60 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />

        {/* Executive Header */}
        <div className="text-center space-y-3 relative z-10">
          <div className="w-14 h-14 rounded-2xl bg-amber-400/10 border border-amber-400/30 text-amber-400 flex items-center justify-center mx-auto shadow-inner shadow-amber-400/20">
            <Shield className="w-7 h-7" />
          </div>

          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-800/80 border border-slate-700/80 text-[11px] font-mono font-semibold uppercase tracking-wider text-amber-400 mb-1.5">
              <KeyRound className="w-3 h-3" />
              <span>Administrative Clearance</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
              Monvera Executive Banking Console
            </h1>
            <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
              Core Banking Control Center & Compliance Authority
            </p>
          </div>
        </div>

        {/* Security protocol pill */}
        <div className="mt-5 p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-400 relative z-10">
          <span className="flex items-center gap-1.5 text-slate-300">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            TLS 1.3 End-to-End
          </span>
          <span className="text-amber-400/90 font-medium">Server Session Enforced</span>
        </div>

        {/* Error Notification Alert */}
        {errorInfo && (
          <div className="mt-5 p-3.5 rounded-2xl bg-red-950/40 border border-red-500/30 text-red-200 text-xs space-y-1.5 animate-in fade-in duration-200 relative z-10">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-bold text-red-300">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{errorInfo.title}</span>
              </div>
              <span className="px-2 py-0.5 rounded-md bg-red-900/50 border border-red-500/20 text-[10px] font-mono uppercase text-red-300 shrink-0">
                {errorInfo.badge}
              </span>
            </div>
            <p className="text-[12px] text-red-200 leading-relaxed font-medium pl-6">
              {errorInfo.description}
            </p>
            {errorInfo.hint && (
              <p className="text-[11px] text-slate-400 leading-relaxed font-mono pl-6 pt-1 border-t border-red-900/40">
                {errorInfo.hint}
              </p>
            )}
          </div>
        )}

        {/* Dedicated Administrator Form */}
        <form onSubmit={handleSubmit} className="mt-6 space-y-4 relative z-10">
          {/* Administrator Email */}
          <div className="space-y-1.5">
            <label
              htmlFor="admin-email-input"
              className="block text-xs font-bold uppercase tracking-wider text-slate-300"
            >
              Administrator Email
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                <Mail className="w-4 h-4" />
              </div>
              <input
                id="admin-email-input"
                type="email"
                name="admin-email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@monvera.com"
                disabled={isSubmitting}
                className="w-full pl-10 pr-4 py-3 bg-slate-950/80 border border-slate-700/80 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-400 transition-all font-mono"
                required
              />
            </div>
          </div>

          {/* Administrator Password */}
          <div className="space-y-1.5">
            <label
              htmlFor="admin-password-input"
              className="block text-xs font-bold uppercase tracking-wider text-slate-300"
            >
              Administrator Password
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                <Lock className="w-4 h-4" />
              </div>
              <input
                id="admin-password-input"
                type={showPassword ? 'text' : 'password'}
                name="admin-password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                disabled={isSubmitting}
                className="w-full pl-10 pr-11 py-3 bg-slate-950/80 border border-slate-700/80 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-400 transition-all font-mono"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-500 hover:text-slate-300 cursor-pointer"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Sign In Button */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3.5 px-4 rounded-xl bg-amber-400 hover:bg-amber-300 active:bg-amber-500 disabled:opacity-60 disabled:cursor-not-allowed text-slate-950 font-black text-sm tracking-wide transition-all shadow-lg shadow-amber-400/10 flex items-center justify-center gap-2 cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Verifying Cryptographic Credentials...</span>
                </>
              ) : (
                <>
                  <Shield className="w-4 h-4" />
                  <span>Sign In to Executive Console</span>
                </>
              )}
            </button>
          </div>
        </form>

        {/* Footer Navigation */}
        <div className="mt-6 pt-5 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400 relative z-10">
          <button
            type="button"
            onClick={onCancel || (() => setCurrentView('home'))}
            className="inline-flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Return to Public Home</span>
          </button>

          <span className="font-mono text-[11px] text-slate-500 flex items-center gap-1">
            <Server className="w-3 h-3" />
            Railway Backend
          </span>
        </div>
      </div>
    </div>
  );
};
