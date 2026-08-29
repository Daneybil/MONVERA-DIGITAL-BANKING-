import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { MonveraLogo } from '../common/MonveraLogo';
import { CountrySelector } from '../common/CountrySelector';
import { CountryOption, findCountry } from '../../data/countries';
import {
  User,
  Mail,
  Phone,
  Calendar,
  MapPin,
  Users,
  Lock,
  Eye,
  EyeOff,
  Gift,
  UserPlus,
  ShieldCheck,
  CreditCard,
  KeyRound,
  Shield,
  AlertCircle,
  X,
  CheckCircle2,
} from 'lucide-react';

interface SignUpPageProps {
  onSwitchToLogin?: () => void;
  onClose?: () => void;
  isModal?: boolean;
}

export const SignUpPage: React.FC<SignUpPageProps> = ({
  onSwitchToLogin,
  onClose,
  isModal = false,
}) => {
  const { registerUser, setCurrentView } = useAuth();

  // Form State
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [address, setAddress] = useState('');
  const [selectedCountry, setSelectedCountry] = useState<CountryOption>(findCountry('United States'));
  const [maritalStatus, setMaritalStatus] = useState('');
  const [age, setAge] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  // Toggles
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Auto-calculate age from Date of Birth
  const handleDobChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const dob = e.target.value;
    setDateOfBirth(dob);
    if (dob) {
      const birthDate = new Date(dob);
      const today = new Date();
      let calculatedAge = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        calculatedAge--;
      }
      if (calculatedAge > 0 && calculatedAge < 120) {
        setAge(calculatedAge.toString());
      }
    }
  };

  const handleCountryChange = (country: CountryOption) => {
    setSelectedCountry(country);
    // If phone number is empty, we can prefill dial code
    if (!phoneNumber) {
      setPhoneNumber(`${country.dialCode} `);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || successMessage) return;
    setErrorMessage(null);
    setSuccessMessage(null);

    // Validation
    if (!fullName.trim()) {
      setErrorMessage('Please enter your full name.');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }
    if (!phoneNumber.trim()) {
      setErrorMessage('Please enter your phone number.');
      return;
    }
    if (!selectedCountry) {
      setErrorMessage('Please select your country of residence.');
      return;
    }
    if (!password || password.length < 6) {
      setErrorMessage('Password must be at least 6 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }
    if (!agreedToTerms) {
      setErrorMessage('You must agree to the Terms & Conditions and Privacy Policy.');
      return;
    }

    setIsSubmitting(true);

    // Split Full Name into First and Last name
    const parts = fullName.trim().split(' ');
    const firstName = parts[0] || 'Valued';
    const lastName = parts.slice(1).join(' ') || 'Customer';

    const res = await registerUser({
      fullName: fullName.trim(),
      firstName,
      lastName,
      email: email.trim(),
      phone: phoneNumber.trim(),
      country: selectedCountry.name,
      maritalStatus: maritalStatus || 'Single',
      dateOfBirth: dateOfBirth || '1995-01-01',
      age: age || undefined,
      address: address.trim() || undefined,
      password,
    });

    setIsSubmitting(false);

    if (!res.success) {
      setErrorMessage(res.error || 'Account creation failed. Please try again.');
    } else {
      setSuccessMessage('Account created successfully.');
      setTimeout(() => {
        if (onClose) onClose();
        setCurrentView('dashboard');
      }, 700);
    }
  };

  // MODAL VIEW: Clean dedicated card inside modal dialog
  if (isModal) {
    return (
      <div
        id="monvera-signup-modal-card"
        className="w-full bg-white rounded-[28px] sm:rounded-[36px] p-6 sm:p-8 shadow-2xl border border-slate-200 relative overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with Close */}
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <MonveraLogo variant="icon" size="sm" />
            <span className="font-extrabold text-slate-900 text-sm">Monvera Bank</span>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              id="signup-modal-close-btn"
              className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Quick Switcher */}
        <div className="flex rounded-2xl bg-slate-100 p-1.5 mb-5 max-w-xs mx-auto border border-slate-200 shadow-inner">
          <button
            type="button"
            onClick={onSwitchToLogin}
            className="flex-1 py-2 px-3 rounded-xl text-xs sm:text-sm font-bold text-slate-600 hover:text-slate-950 hover:bg-white/60 transition-all flex items-center justify-center gap-1.5 cursor-pointer select-none"
          >
            <Lock className="w-3.5 h-3.5 text-slate-400" />
            <span>Sign In</span>
          </button>
          <button
            type="button"
            className="flex-1 py-2 px-3 rounded-xl text-xs sm:text-sm font-extrabold text-slate-950 bg-white shadow-xs transition-all flex items-center justify-center gap-1.5 select-none"
          >
            <User className="w-3.5 h-3.5 text-amber-500" />
            <span>Create Account</span>
          </button>
        </div>

        {/* Title */}
        <div className="text-center pb-4">
          <h1 className="text-2xl font-black text-slate-900 tracking-tight font-sans">
            Create Your Account
          </h1>
          <p className="text-xs text-slate-500 font-medium mt-1">
            Join Monvera and experience secure, high-yield digital banking
          </p>
        </div>

        {/* Success Banner */}
        {successMessage && (
          <div className="mb-4 p-3.5 rounded-2xl bg-emerald-50 border-2 border-emerald-300 text-xs sm:text-sm text-emerald-950 flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <div>
              <span className="font-extrabold block">{successMessage}</span>
              <span className="text-xs text-emerald-800">Redirecting to your dashboard...</span>
            </div>
          </div>
        )}

        {/* Error Banner */}
        {errorMessage && (
          <div className="mb-4 p-3.5 rounded-2xl bg-red-50 border-2 border-red-200 text-xs text-red-900 flex items-start justify-between gap-2.5">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span className="font-bold">{errorMessage}</span>
            </div>
            {(errorMessage.includes('already registered') || errorMessage.includes('already exists') || errorMessage.includes('log in')) && onSwitchToLogin && (
              <button
                type="button"
                onClick={onSwitchToLogin}
                className="shrink-0 px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white rounded-md font-bold text-xs cursor-pointer"
              >
                Log In
              </button>
            )}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Full Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                id="signup-fullname-modal"
                value={fullName}
                onClick={(e) => e.stopPropagation()}
                onFocus={(e) => e.stopPropagation()}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Enter your full name"
                className="w-full px-3.5 py-2.5 text-sm font-medium text-slate-900 bg-slate-50 border border-slate-200 focus:border-slate-800 rounded-xl focus:outline-hidden"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Email Address <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                required
                id="signup-email-modal"
                value={email}
                onClick={(e) => e.stopPropagation()}
                onFocus={(e) => e.stopPropagation()}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email address"
                className="w-full px-3.5 py-2.5 text-sm font-medium text-slate-900 bg-slate-50 border border-slate-200 focus:border-slate-800 rounded-xl focus:outline-hidden"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Phone Number <span className="text-red-500">*</span>
              </label>
              <input
                type="tel"
                required
                id="signup-phone-modal"
                value={phoneNumber}
                onClick={(e) => e.stopPropagation()}
                onFocus={(e) => e.stopPropagation()}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="+1 (555) 000-0000"
                className="w-full px-3.5 py-2.5 text-sm font-medium text-slate-900 bg-slate-50 border border-slate-200 focus:border-slate-800 rounded-xl focus:outline-hidden"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Password <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  id="signup-password-modal"
                  value={password}
                  onClick={(e) => e.stopPropagation()}
                  onFocus={(e) => e.stopPropagation()}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min. 6 characters"
                  className="w-full pl-3.5 pr-10 py-2.5 text-sm font-medium text-slate-900 bg-slate-50 border border-slate-200 focus:border-slate-800 rounded-xl focus:outline-hidden"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Confirm Password <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  required
                  id="signup-confirm-password-modal"
                  value={confirmPassword}
                  onClick={(e) => e.stopPropagation()}
                  onFocus={(e) => e.stopPropagation()}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  className="w-full pl-3.5 pr-10 py-2.5 text-sm font-medium text-slate-900 bg-slate-50 border border-slate-200 focus:border-slate-800 rounded-xl focus:outline-hidden"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="pt-1">
              <label className="flex items-start gap-2 text-xs text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  id="signup-terms-modal"
                  checked={agreedToTerms}
                  onChange={(e) => setAgreedToTerms(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-slate-800 cursor-pointer"
                />
                <span>I agree to Monvera Bank's Terms & Conditions and Privacy Policy.</span>
              </label>
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3.5 px-6 rounded-xl font-black text-sm text-white bg-slate-950 hover:bg-slate-900 shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <ShieldCheck className="w-4 h-4 text-amber-400" />
            <span>{isSubmitting ? 'Creating Account...' : 'Open My Account'}</span>
          </button>
        </form>
      </div>
    );
  }

  return (
    <div
      id="monvera-signup-page"
      className="min-h-screen w-full flex flex-col justify-between relative overflow-x-hidden py-8 px-4 sm:px-6 lg:px-8"
      style={{
        background: 'linear-gradient(135deg, #F8F9FA 0%, #EDF1F7 50%, #F5F7FA 100%)',
      }}
    >
      {/* Background Luxury Golden Curves & Geometry */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-40">
        <svg
          viewBox="0 0 1440 900"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full object-cover"
        >
          <path
            d="M-100 200 C 400 100, 800 400, 1540 100"
            stroke="url(#signupGoldLine1)"
            strokeWidth="1.5"
            strokeDasharray="4 8"
          />
          <path
            d="M-100 350 C 500 250, 900 600, 1540 250"
            stroke="url(#signupGoldLine2)"
            strokeWidth="1.2"
          />
          <path
            d="M200 900 C 600 700, 1000 850, 1600 600"
            stroke="url(#signupGoldLine1)"
            strokeWidth="1"
          />
          <defs>
            <linearGradient id="signupGoldLine1" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#D4AF37" stopOpacity="0.1" />
              <stop offset="50%" stopColor="#D4AF37" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#AA771C" stopOpacity="0.1" />
            </linearGradient>
            <linearGradient id="signupGoldLine2" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#B8860B" stopOpacity="0.05" />
              <stop offset="50%" stopColor="#F59E0B" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#D4AF37" stopOpacity="0.05" />
            </linearGradient>
          </defs>
        </svg>

        <div className="absolute top-10 left-10 w-96 h-96 bg-amber-400/5 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-10 right-10 w-[500px] h-[500px] bg-blue-400/5 rounded-full blur-3xl pointer-events-none" />
      </div>

      {/* TOP HEADER: Monvera Logo (Official Brand Logo) */}
      <header className="relative z-10 max-w-7xl mx-auto w-full flex items-center justify-between pb-6 sm:pb-8">
        <div
          onClick={() => setCurrentView('home')}
          className="cursor-pointer flex items-center"
        >
          <MonveraLogo variant="full" size="md" isLight={false} />
        </div>

        {/* Close modal button if active */}
        <div className="flex items-center gap-3">
          {isModal && onClose && (
            <button
              onClick={onClose}
              id="signup-close-btn"
              className="w-9 h-9 rounded-full bg-slate-200/80 hover:bg-slate-300 text-slate-700 flex items-center justify-center transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {/* MAIN CONTENT: Centered Account Creation Card */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center py-2 sm:py-4">
        <div
          id="signup-card-container"
          className="w-full max-w-4xl bg-white rounded-[28px] sm:rounded-[36px] p-6 sm:p-10 lg:p-12 shadow-2xl border border-slate-200/80 relative overflow-hidden"
        >
          {/* Desktop & Mobile Quick Switcher Bar */}
          <div className="flex rounded-2xl bg-slate-100 p-1.5 mb-6 max-w-sm mx-auto border border-slate-200 shadow-inner">
            <button
              type="button"
              id="signup-tab-signin"
              onClick={onSwitchToLogin}
              className="flex-1 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-bold text-slate-600 hover:text-slate-950 hover:bg-white/60 transition-all flex items-center justify-center gap-1.5 cursor-pointer select-none"
            >
              <Lock className="w-3.5 h-3.5 text-slate-400" />
              <span>Sign In</span>
            </button>
            <button
              type="button"
              id="signup-tab-signup"
              className="flex-1 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-extrabold text-slate-950 bg-white shadow-xs transition-all flex items-center justify-center gap-1.5 select-none"
            >
              <User className="w-3.5 h-3.5 text-amber-500" />
              <span>Create Account</span>
            </button>
          </div>

          {/* Card Heading */}
          <div className="text-center pb-5 sm:pb-6">
            <h1 className="text-2xl sm:text-3xl lg:text-[32px] font-black text-slate-900 tracking-tight font-sans">
              Create Your Account
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
              Join Monvera and experience secure, high-yield sovereign digital banking
            </p>
          </div>

          {/* Success Banner */}
          {successMessage && (
            <div className="mb-6 p-4 rounded-2xl bg-emerald-50 border-2 border-emerald-300 text-sm text-emerald-950 flex items-center gap-3 animate-in fade-in duration-200 shadow-xs">
              <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
              <div>
                <span className="font-extrabold block text-emerald-950 text-base">{successMessage}</span>
                <span className="text-xs font-semibold text-emerald-800">Redirecting to your Monvera financial dashboard...</span>
              </div>
            </div>
          )}

          {/* Error Banner */}
          {errorMessage && (
            <div className="mb-6 p-4 rounded-2xl bg-red-50 border-2 border-red-200 text-xs sm:text-sm text-red-900 flex items-start justify-between gap-3 animate-in fade-in duration-200">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span className="font-bold leading-relaxed">{errorMessage}</span>
              </div>
              {(errorMessage.includes('already registered') || errorMessage.includes('already exists') || errorMessage.includes('log in')) && onSwitchToLogin && (
                <button
                  type="button"
                  onClick={onSwitchToLogin}
                  className="shrink-0 px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-extrabold text-xs cursor-pointer transition-colors shadow-2xs"
                >
                  Log In Now
                </button>
              )}
            </div>
          )}

          {/* 2-Column Responsive Form Layout */}
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 sm:gap-y-5">
              {/* LEFT COLUMN */}
              <div className="space-y-4 sm:space-y-5">
                {/* 1. Full Name */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-700">
                    Full Name <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <User className="w-5 h-5 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none" />
                    <input
                      type="text"
                      required
                      id="signup-fullname"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Enter your full name"
                      className="w-full pl-11 pr-4 py-3 sm:py-3.5 text-sm font-medium text-slate-900 bg-slate-50/70 hover:bg-slate-50 focus:bg-white border border-slate-200 focus:border-slate-800 rounded-xl focus:outline-hidden transition-all shadow-2xs placeholder:text-slate-400"
                    />
                  </div>
                </div>

                {/* 2. Email Address */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-700">
                    Email Address <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <Mail className="w-5 h-5 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none" />
                    <input
                      type="email"
                      required
                      id="signup-email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Enter your email address"
                      className="w-full pl-11 pr-4 py-3 sm:py-3.5 text-sm font-medium text-slate-900 bg-slate-50/70 hover:bg-slate-50 focus:bg-white border border-slate-200 focus:border-slate-800 rounded-xl focus:outline-hidden transition-all shadow-2xs placeholder:text-slate-400"
                    />
                  </div>
                </div>

                {/* 3. Phone Number */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-700">
                    Phone Number <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <Phone className="w-5 h-5 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none" />
                    <input
                      type="tel"
                      required
                      id="signup-phone"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      placeholder="Enter your phone number"
                      className="w-full pl-11 pr-4 py-3 sm:py-3.5 text-sm font-medium text-slate-900 bg-slate-50/70 hover:bg-slate-50 focus:bg-white border border-slate-200 focus:border-slate-800 rounded-xl focus:outline-hidden transition-all shadow-2xs placeholder:text-slate-400"
                    />
                  </div>
                </div>

                {/* 4. Date of Birth */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-700">
                    Date of Birth
                  </label>
                  <div className="relative">
                    <Calendar className="w-5 h-5 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none" />
                    <input
                      type="date"
                      id="signup-dob"
                      value={dateOfBirth}
                      onChange={handleDobChange}
                      placeholder="Select your date of birth"
                      className="w-full pl-11 pr-4 py-3 sm:py-3.5 text-sm font-medium text-slate-900 bg-slate-50/70 hover:bg-slate-50 focus:bg-white border border-slate-200 focus:border-slate-800 rounded-xl focus:outline-hidden transition-all shadow-2xs placeholder:text-slate-400"
                    />
                  </div>
                </div>

                {/* 5. Residential Address */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-700">
                    Address
                  </label>
                  <div className="relative">
                    <MapPin className="w-5 h-5 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none" />
                    <input
                      type="text"
                      id="signup-address"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="Enter your residential address"
                      className="w-full pl-11 pr-4 py-3 sm:py-3.5 text-sm font-medium text-slate-900 bg-slate-50/70 hover:bg-slate-50 focus:bg-white border border-slate-200 focus:border-slate-800 rounded-xl focus:outline-hidden transition-all shadow-2xs placeholder:text-slate-400"
                    />
                  </div>
                </div>

                {/* 6. Country Selector */}
                <div className="space-y-1.5">
                  <CountrySelector
                    id="signup-country-selector"
                    value={selectedCountry?.name || ''}
                    onChange={handleCountryChange}
                    label="Country"
                    required={true}
                    placeholder="Select your country"
                  />
                </div>
              </div>

              {/* RIGHT COLUMN */}
              <div className="space-y-4 sm:space-y-5">
                {/* 1. Marital Status */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-700">
                    Marital Status
                  </label>
                  <div className="relative">
                    <Users className="w-5 h-5 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none" />
                    <select
                      id="signup-marital-status"
                      value={maritalStatus}
                      onChange={(e) => setMaritalStatus(e.target.value)}
                      className="w-full pl-11 pr-8 py-3 sm:py-3.5 text-sm font-medium text-slate-900 bg-slate-50/70 hover:bg-slate-50 focus:bg-white border border-slate-200 focus:border-slate-800 rounded-xl focus:outline-hidden transition-all shadow-2xs appearance-none cursor-pointer"
                    >
                      <option value="">Select your marital status</option>
                      <option value="Single">Single</option>
                      <option value="Married">Married</option>
                      <option value="Divorced">Divorced</option>
                      <option value="Widowed">Widowed</option>
                    </select>
                    <div className="absolute right-3.5 top-4 pointer-events-none text-slate-400 text-xs">▼</div>
                  </div>
                </div>

                {/* 2. Age */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-700">
                    Age
                  </label>
                  <div className="relative">
                    <User className="w-5 h-5 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none" />
                    <input
                      type="number"
                      id="signup-age"
                      value={age}
                      onChange={(e) => setAge(e.target.value)}
                      placeholder="Enter your age"
                      min="18"
                      max="120"
                      className="w-full pl-11 pr-4 py-3 sm:py-3.5 text-sm font-medium text-slate-900 bg-slate-50/70 hover:bg-slate-50 focus:bg-white border border-slate-200 focus:border-slate-800 rounded-xl focus:outline-hidden transition-all shadow-2xs placeholder:text-slate-400"
                    />
                  </div>
                </div>

                {/* 3. Password */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-700">
                    Password <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <Lock className="w-5 h-5 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      id="signup-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Create a strong password"
                      className="w-full pl-11 pr-11 py-3 sm:py-3.5 text-sm font-medium text-slate-900 bg-slate-50/70 hover:bg-slate-50 focus:bg-white border border-slate-200 focus:border-slate-800 rounded-xl focus:outline-hidden transition-all shadow-2xs placeholder:text-slate-400"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3.5 top-3.5 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                      title={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                {/* 4. Confirm Password */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-700">
                    Confirm Password <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <Lock className="w-5 h-5 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none" />
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      required
                      id="signup-confirm-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm your password"
                      className="w-full pl-11 pr-11 py-3 sm:py-3.5 text-sm font-medium text-slate-900 bg-slate-50/70 hover:bg-slate-50 focus:bg-white border border-slate-200 focus:border-slate-800 rounded-xl focus:outline-hidden transition-all shadow-2xs placeholder:text-slate-400"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3.5 top-3.5 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                      title={showConfirmPassword ? 'Hide password' : 'Show password'}
                    >
                      {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                {/* 5. Referral Code (Optional) */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-700">
                    Referral Code (Optional)
                  </label>
                  <div className="relative">
                    <Gift className="w-5 h-5 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none" />
                    <input
                      type="text"
                      id="signup-referral"
                      value={referralCode}
                      onChange={(e) => setReferralCode(e.target.value)}
                      placeholder="Enter referral code"
                      className="w-full pl-11 pr-4 py-3 sm:py-3.5 text-sm font-medium text-slate-900 bg-slate-50/70 hover:bg-slate-50 focus:bg-white border border-slate-200 focus:border-slate-800 rounded-xl focus:outline-hidden transition-all shadow-2xs placeholder:text-slate-400"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Terms Agreement Checkbox */}
            <div className="pt-2">
              <label className="flex items-start gap-2.5 text-xs text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  required
                  id="signup-terms-checkbox"
                  checked={agreedToTerms}
                  onChange={(e) => setAgreedToTerms(e.target.checked)}
                  className="w-4 h-4 mt-0.5 rounded text-slate-900 border-slate-300 focus:ring-slate-800 cursor-pointer shrink-0"
                />
                <span>
                  I agree to the{' '}
                  <span className="font-bold text-blue-600 hover:underline">Terms & Conditions</span> and{' '}
                  <span className="font-bold text-blue-600 hover:underline">Privacy Policy</span>
                </span>
              </label>
            </div>

            {/* Primary Sign Up Button (Prominent Navy) */}
            <div className="pt-2">
              <button
                type="submit"
                id="signup-submit-btn"
                disabled={isSubmitting}
                className="w-full py-4 px-6 rounded-xl font-bold text-sm text-white bg-[#0A1227] hover:bg-[#060B18] active:scale-[0.99] border border-slate-800 shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <UserPlus className="w-4 h-4 text-white" />
                <span>{isSubmitting ? 'Creating Monvera Account...' : 'Sign Up'}</span>
              </button>
            </div>

            {/* Already have an account? Sign In link */}
            <div className="text-center pt-1">
              <p className="text-xs sm:text-sm text-slate-600 font-medium">
                Already have an account?{' '}
                <button
                  type="button"
                  id="switch-to-login-btn"
                  onClick={onSwitchToLogin}
                  className="font-bold text-blue-600 hover:text-blue-700 hover:underline cursor-pointer ml-1"
                >
                  Sign In
                </button>
              </p>
            </div>
          </form>
        </div>
      </main>

      {/* BOTTOM SECTION: Trust Badges (Compact & balanced) */}
      <footer className="relative z-10 max-w-4xl mx-auto w-full pt-4 sm:pt-6 pb-2">
        <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-8 text-slate-600">
          {/* SSL Secured */}
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4.5 h-4.5 text-amber-600" />
            <div className="text-[11px] font-bold tracking-wider text-slate-700 uppercase font-mono">
              SSL SECURED
            </div>
          </div>

          {/* PCI DSS Compliant */}
          <div className="flex items-center gap-2">
            <CreditCard className="w-4.5 h-4.5 text-amber-600" />
            <div className="text-[11px] font-bold tracking-wider text-slate-700 uppercase font-mono">
              PCI DSS COMPLIANT
            </div>
          </div>

          {/* 256-Bit Encryption */}
          <div className="flex items-center gap-2">
            <KeyRound className="w-4.5 h-4.5 text-amber-600" />
            <div className="text-[11px] font-bold tracking-wider text-slate-700 uppercase font-mono">
              256-BIT ENCRYPTION
            </div>
          </div>

          {/* Fraud Protection */}
          <div className="flex items-center gap-2">
            <Shield className="w-4.5 h-4.5 text-amber-600" />
            <div className="text-[11px] font-bold tracking-wider text-slate-700 uppercase font-mono">
              FRAUD PROTECTION
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};
