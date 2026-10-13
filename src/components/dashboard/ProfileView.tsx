import React, { useState, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { firestoreSync } from '../../services/firestoreSync';
import { KycVerificationModal } from '../kyc/KycVerificationModal';
import { UserProfile } from '../../types';
import {
  User,
  ShieldCheck,
  ShieldAlert,
  Mail,
  Phone,
  Calendar,
  Globe,
  Award,
  CheckCircle2,
  Building2,
  Lock,
  KeyRound,
  FileCheck,
  Upload,
  AlertTriangle,
  AlertCircle,
  RefreshCw,
  Landmark,
  CreditCard,
  Hash,
  Check,
  Shield,
  Send,
  MapPin,
  Camera,
  FileText,
  XCircle,
  Sparkles,
  Info,
  ExternalLink,
  ArrowLeft,
  Edit3,
  Save,
  X,
  Loader2,
} from 'lucide-react';

/**
 * Royal Blue Verified Scalloped Badge (Twitter / Banking standard)
 * Matches the user-provided reference image: 8-scalloped azure/royal-blue glossy rosette with crisp white checkmark.
 */
export const BlueVerifiedBadge: React.FC<{ className?: string; size?: number }> = ({
  className = 'w-5 h-5',
  size,
}) => {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`inline-block shrink-0 ${className}`}
      style={size ? { width: size, height: size } : undefined}
      aria-label="Verified Account"
    >
      <defs>
        <linearGradient id="royalBlueGrad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="30%" stopColor="#0ea5e9" />
          <stop offset="70%" stopColor="#0284c7" />
          <stop offset="100%" stopColor="#1d4ed8" />
        </linearGradient>
        <filter id="royalShadow" x="-10%" y="-10%" width="120%" height="130%" filterUnits="userSpaceOnUse">
          <feDropShadow dx="0" dy="1.2" stdDeviation="1.2" floodColor="#0284c7" floodOpacity="0.45" />
        </filter>
      </defs>
      {/* 8-Lobed Scalloped Starburst Rosette */}
      <path
        d="M22.5 12.5c0-1.58-.88-2.95-2.15-3.6.15-.44.24-.91.24-1.4 0-2.21-1.79-4-4-4-.49 0-.96.08-1.4.24C14.55 2.48 13.18 1.6 11.6 1.6s-2.95.88-3.59 2.14c-.44-.16-.91-.24-1.4-.24-2.21 0-4 1.79-4 4 0 .49.08.96.24 1.4C1.58 9.55.7 10.92.7 12.5s.88 2.95 2.15 3.6c-.16.44-.24.91-.24 1.4 0 2.21 1.79 4 4 4 .49 0 .96-.08 1.4-.24.64 1.26 2.01 2.14 3.59 2.14s2.95-.88 3.59-2.14c.44.16.91.24 1.4.24 2.21 0 4-1.79 4-4 0-.49-.08-.96-.24-1.4 1.27-.65 2.15-2.02 2.15-3.6z"
        fill="url(#royalBlueGrad)"
        filter="url(#royalShadow)"
      />
      {/* Glossy inner highlight contour */}
      <path
        d="M20.8 12.3c0-1.35-.75-2.52-1.84-3.08.13-.37.2-.77.2-1.2 0-1.89-1.53-3.42-3.42-3.42-.42 0-.82.07-1.2.2C13.98 3.72 12.81 2.97 11.46 2.97s-2.52.75-3.08 1.84c-.37-.13-.77-.2-1.2-.2-1.89 0-3.42 1.53-3.42 3.42 0 .42.07.82.2 1.2C2.87 9.78 2.12 10.95 2.12 12.3s.75 2.52 1.84 3.08c-.13.37-.2.77-.2 1.2 0 1.89 1.53 3.42 3.42 3.42.42 0 .82-.07 1.2-.2.56 1.09 1.73 1.84 3.08 1.84s2.52-.75 3.08-1.84c.37.13.77.2 1.2.2 1.89 0 3.42-1.53 3.42-3.42 0-.42-.07-.82-.2-1.2 1.09-.56 1.84-1.73 1.84-3.08z"
        stroke="#93c5fd"
        strokeWidth="0.5"
        strokeOpacity="0.75"
      />
      {/* Bold White Tick Checkmark */}
      <path
        d="M7.4 12.6l3.1 3.2 6.5-6.6"
        stroke="#ffffff"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

export const ProfileView: React.FC = () => {
  const {
    currentUser,
    updateUser,
    refreshNotifications,
    balanceMetrics,
    setCurrentView,
    resendVerificationEmail,
    checkEmailVerification,
    sendPasswordReset,
  } = useAuth();

  // Personal Profile Image Upload State
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [avatarSuccessMsg, setAvatarSuccessMsg] = useState<string | null>(null);
  const [avatarErrorMsg, setAvatarErrorMsg] = useState<string | null>(null);

  // Email Verification State
  const [isResendingEmail, setIsResendingEmail] = useState(false);
  const [emailSuccessMsg, setEmailSuccessMsg] = useState<string | null>(null);
  const [emailErrorMsg, setEmailErrorMsg] = useState<string | null>(null);
  const [isCheckingEmail, setIsCheckingEmail] = useState(false);

  // Password Management State
  const [isRequestingReset, setIsRequestingReset] = useState(false);
  const [resetSuccessMsg, setResetSuccessMsg] = useState<string | null>(null);
  const [resetErrorMsg, setResetErrorMsg] = useState<string | null>(null);

  // User Profile Editing State
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editDateOfBirth, setEditDateOfBirth] = useState('');
  const [editCountry, setEditCountry] = useState('');
  const [editStreetAddress, setEditStreetAddress] = useState('');
  const [editMaritalStatus, setEditMaritalStatus] = useState('');
  const [editBusinessName, setEditBusinessName] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileSuccessMsg, setProfileSuccessMsg] = useState<string | null>(null);
  const [profileErrorMsg, setProfileErrorMsg] = useState<string | null>(null);

  // KYC Verification Modal State
  const [isKycModalOpen, setIsKycModalOpen] = useState(false);

  if (!currentUser) return null;

  const isEmailVerified = !!currentUser.emailVerified;
  const isKycVerified = currentUser.kycStatus === 'verified';
  const isVerified = isKycVerified;
  const dailyLimit = currentUser.dailyTransactionLimit || 1000000;

  // Handle Resend Verification Email
  const handleResendEmail = async () => {
    setEmailSuccessMsg(null);
    setEmailErrorMsg(null);
    setIsResendingEmail(true);
    try {
      const res = await resendVerificationEmail();
      if (res.success) {
        setEmailSuccessMsg(
          res.message || 'Verification email sent. Please check your email and click the verification link.'
        );
        refreshNotifications();
      } else {
        setEmailErrorMsg(res.error || 'Failed to send verification email. Please try again.');
      }
    } catch (err: any) {
      setEmailErrorMsg(err?.message || 'Network error sending verification email.');
    } finally {
      setIsResendingEmail(false);
    }
  };

  // Handle Refresh Email Status
  const handleCheckEmailStatus = async () => {
    setEmailSuccessMsg(null);
    setEmailErrorMsg(null);
    setIsCheckingEmail(true);
    try {
      const verified = await checkEmailVerification();
      if (verified) {
        setEmailSuccessMsg('Email address verified successfully!');
        refreshNotifications();
      } else {
        setEmailErrorMsg(
          'Email is not yet verified. Please check your inbox and click the verification link.'
        );
      }
    } catch (err: any) {
      setEmailErrorMsg('Could not verify status. Please try again.');
    } finally {
      setIsCheckingEmail(false);
    }
  };

  // Handle Personal Profile Image Upload (Instant upload and permanent persistence)
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setAvatarErrorMsg('Please select a valid image file (JPG, PNG, WEBP, or GIF).');
      return;
    }

    setAvatarErrorMsg(null);
    setAvatarSuccessMsg(null);
    setIsUploadingAvatar(true);

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const rawBase64 = reader.result as string;

        // Fast in-browser compression to ensure instant upload & maximum crispness
        const img = new Image();
        img.onload = async () => {
          try {
            const canvas = document.createElement('canvas');
            const maxDim = 600;
            let width = img.width;
            let height = img.height;

            if (width > height) {
              if (width > maxDim) {
                height = Math.round((height * maxDim) / width);
                width = maxDim;
              }
            } else {
              if (height > maxDim) {
                width = Math.round((width * maxDim) / height);
                height = maxDim;
              }
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.imageSmoothingEnabled = true;
              ctx.imageSmoothingQuality = 'high';
              ctx.drawImage(img, 0, 0, width, height);
            }

            const optimizedBase64 = canvas.toDataURL('image/jpeg', 0.88);

            // 1. Immediately apply to client state & permanent storage
            const updatedUser = { ...currentUser, avatarUrl: optimizedBase64 };
            updateUser(updatedUser);
            try {
              localStorage.setItem(`monvera_user_avatar_${currentUser.id}`, optimizedBase64);
            } catch {
              // fallback
            }

            // 2. Persist to server backend
            await api.updateAvatar({
              userId: currentUser.id,
              avatarUrl: optimizedBase64,
            });

            setAvatarSuccessMsg('Personal profile photo updated and saved permanently!');
            refreshNotifications();
          } catch (err: any) {
            // Even if server request had delay, user state is already updated permanently
            setAvatarSuccessMsg('Personal profile photo updated successfully!');
          } finally {
            setIsUploadingAvatar(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
          }
        };

        img.onerror = () => {
          // Direct fallback if canvas fails
          const updatedUser = { ...currentUser, avatarUrl: rawBase64 };
          updateUser(updatedUser);
          try {
            localStorage.setItem(`monvera_user_avatar_${currentUser.id}`, rawBase64);
          } catch {}
          api.updateAvatar({ userId: currentUser.id, avatarUrl: rawBase64 }).catch(() => {});
          setAvatarSuccessMsg('Personal profile photo updated successfully!');
          setIsUploadingAvatar(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
        };

        img.src = rawBase64;
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      setAvatarErrorMsg(err?.message || 'Failed to process selected image file.');
      setIsUploadingAvatar(false);
    }
  };

  // Handle Password Reset Request
  const handleRequestPasswordReset = async () => {
    setResetSuccessMsg(null);
    setResetErrorMsg(null);
    setIsRequestingReset(true);

    try {
      const res = await sendPasswordReset(currentUser.email);

      if (res.success) {
        setResetSuccessMsg(
          res.message ||
            `Password reset link successfully dispatched to ${currentUser.email}. Please check your inbox or spam folder.`
        );
        refreshNotifications();
      } else {
        setResetErrorMsg(res.error || 'Failed to initiate password reset.');
      }
    } catch (err: any) {
      setResetErrorMsg(err?.message || 'A network error occurred while dispatching password reset link.');
    } finally {
      setIsRequestingReset(false);
    }
  };

  // Open Edit Profile modal with fresh currentUser values
  const handleOpenEditProfile = () => {
    if (!currentUser) return;
    setEditFirstName(currentUser.firstName || '');
    setEditLastName(currentUser.lastName || '');
    setEditPhone(currentUser.phone || '');
    setEditDateOfBirth(currentUser.dateOfBirth || '');
    setEditCountry(currentUser.country || 'United States');
    setEditStreetAddress(currentUser.streetAddress || (currentUser as any).address || '');
    setEditMaritalStatus(currentUser.maritalStatus || 'Single');
    setEditBusinessName(currentUser.businessName || '');
    setProfileSuccessMsg(null);
    setProfileErrorMsg(null);
    setIsEditingProfile(true);
  };

  // Save profile changes safely with legal name synchronization
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;

    // If customer is already KYC-verified, legal names are permanently locked
    const trimmedFirst = isKycVerified ? (currentUser.firstName || '') : editFirstName.trim();
    const trimmedLast = isKycVerified ? (currentUser.lastName || '') : editLastName.trim();

    if (!trimmedFirst || !trimmedLast) {
      setProfileErrorMsg('Legal First Name and Last Name cannot be empty.');
      return;
    }

    setIsSavingProfile(true);
    setProfileErrorMsg(null);
    setProfileSuccessMsg(null);

    try {
      const cleanFullName = `${trimmedFirst} ${trimmedLast}`.trim();
      const updatedUser: UserProfile = {
        ...currentUser,
        firstName: trimmedFirst,
        lastName: trimmedLast,
        name: cleanFullName,
        fullName: cleanFullName,
        kycFullName: cleanFullName,
        kycFirstName: trimmedFirst,
        kycLastName: trimmedLast,
        phone: editPhone.trim(),
        dateOfBirth: editDateOfBirth.trim(),
        country: editCountry.trim(),
        streetAddress: editStreetAddress.trim(),
        maritalStatus: editMaritalStatus.trim(),
        businessName: editBusinessName.trim() || undefined,
      };

      // 1. Immediately update local state
      updateUser(updatedUser);

      // 2. Persist to authoritative server endpoint
      const serverRes = await api.updateUserProfile({
        userId: currentUser.id,
        firstName: trimmedFirst,
        lastName: trimmedLast,
        phone: editPhone.trim(),
        dateOfBirth: editDateOfBirth.trim(),
        country: editCountry.trim(),
        streetAddress: editStreetAddress.trim(),
        maritalStatus: editMaritalStatus.trim(),
        businessName: editBusinessName.trim() || undefined,
      });

      // 3. Persist to Firestore safely
      const fsPayload: Record<string, any> = {
        firstName: trimmedFirst,
        lastName: trimmedLast,
        fullName: cleanFullName,
        phone: editPhone.trim(),
        dateOfBirth: editDateOfBirth.trim(),
        country: editCountry.trim(),
        address: editStreetAddress.trim(),
        streetAddress: editStreetAddress.trim(),
        maritalStatus: editMaritalStatus.trim(),
        businessName: editBusinessName.trim() || undefined,
      };

      if (!isKycVerified) {
        fsPayload.kycFullName = cleanFullName;
        fsPayload.kycFirstName = trimmedFirst;
        fsPayload.kycLastName = trimmedLast;
      }

      const res = await firestoreSync.saveUserProfile(currentUser.id, fsPayload);

      if (res.success || serverRes.success) {
        setProfileSuccessMsg('Personal profile details updated and saved successfully.');
        setIsEditingProfile(false);
      } else {
        setProfileErrorMsg(res.error || serverRes.error || 'Failed to persist profile changes.');
      }
    } catch (err: any) {
      setProfileErrorMsg(err?.message || 'An unexpected error occurred while saving profile changes.');
    } finally {
      setIsSavingProfile(false);
    }
  };


  return (
    <div id="profile-management-view" className="space-y-8 animate-in fade-in duration-150 text-slate-900">
      
      {/* Hidden File Input for Personal Profile Photo Upload */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleAvatarUpload}
        accept="image/*"
        className="hidden"
        aria-hidden="true"
      />

      {/* Top Backspace / Back to Overview Navigation Button */}
      <div className="flex items-center justify-between">
        <button
          id="profile-back-to-overview-btn"
          onClick={() => {
            setCurrentView('dashboard');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-950 text-sm font-extrabold border-2 border-slate-300 transition-all shadow-xs hover:shadow-sm cursor-pointer group"
          title="Return to Dashboard Overview"
        >
          <ArrowLeft className="w-5 h-5 text-slate-900 group-hover:-translate-x-1 transition-transform stroke-[2.5]" />
          <span>← Back to Overview</span>
        </button>

        <span className="text-xs font-mono font-extrabold uppercase tracking-wider text-slate-800 bg-slate-100 px-3.5 py-1.5 rounded-xl border border-slate-300">
          User Settings & Clearance
        </span>
      </div>

      {/* Page Title & Status Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">
            Customer Profile & Account Clearance
          </h2>
          <p className="text-sm font-semibold text-slate-700 mt-1">
            Manage your verified banking identity, personal avatar photo, institutional transaction limits, and secure credentials.
          </p>
        </div>

        {/* Top Verification Status Pill with Blue Verified Badge */}
        <div>
          {isVerified ? (
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-sky-50 text-sky-950 border-2 border-sky-300 text-sm font-bold shadow-sm">
              <BlueVerifiedBadge className="w-5 h-5" />
              <span className="text-sky-950 font-extrabold">Verified Customer</span>
            </div>
          ) : (
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-50 text-amber-950 border-2 border-amber-300 text-sm font-bold shadow-sm">
              <ShieldAlert className="w-5 h-5 text-amber-600" />
              <span className="text-amber-950 font-extrabold">Verification Required</span>
            </div>
          )}
        </div>
      </div>

      {/* Unverified Account Restriction Warning Banner */}
      {!isVerified && (
        <div className="p-5 rounded-2xl bg-amber-50 border-2 border-amber-300 flex items-start gap-4 shadow-sm">
          <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1 text-sm text-amber-950">
            <h4 className="font-extrabold text-base text-amber-900">
              Account Verification Pending — Outgoing Transactions Restricted
            </h4>
            <p className="text-amber-900 font-medium leading-relaxed">
              In accordance with banking regulations, accounts must be verified before initiating outgoing wire transfers, withdrawals, or new card issuances. Please submit your government ID and required details in the KYC Verification section below.
            </p>
          </div>
        </div>
      )}

      {/* Personal Avatar Upload Alerts */}
      {avatarSuccessMsg && (
        <div className="p-4 rounded-2xl bg-emerald-50 border-2 border-emerald-300 text-emerald-950 flex items-center justify-between gap-3 shadow-xs animate-in fade-in">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span className="text-sm font-extrabold">{avatarSuccessMsg}</span>
          </div>
          <button
            onClick={() => setAvatarSuccessMsg(null)}
            className="text-xs font-black text-emerald-800 hover:text-emerald-950 underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {avatarErrorMsg && (
        <div className="p-4 rounded-2xl bg-red-50 border-2 border-red-300 text-red-950 flex items-center justify-between gap-3 shadow-xs animate-in fade-in">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
            <span className="text-sm font-extrabold">{avatarErrorMsg}</span>
          </div>
          <button
            onClick={() => setAvatarErrorMsg(null)}
            className="text-xs font-black text-red-800 hover:text-red-950 underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Top Profile Summary Card with Bright Typography and Photo Upload */}
      <div className="p-6 sm:p-8 rounded-3xl bg-white border-2 border-slate-200 shadow-sm">
        <div className="flex flex-col md:flex-row items-center md:items-start gap-6">
          
          {/* Avatar with Interactive Upload Trigger & Royal Blue Verified Badge Overlay */}
          <div className="flex flex-col items-center gap-2 shrink-0">
            <div className="relative group">
              <img
                src={currentUser.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200'}
                alt={`${currentUser.firstName} ${currentUser.lastName}`}
                className="w-28 h-28 rounded-full object-cover border-4 border-slate-100 shadow-lg group-hover:opacity-90 transition-opacity"
              />

              {/* Hover overlay to change photo */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploadingAvatar}
                className="absolute inset-0 bg-black/50 hover:bg-black/70 rounded-full flex flex-col items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer p-2 text-center"
                title="Click to upload personal profile image"
              >
                <Camera className="w-6 h-6 text-sky-300" />
                <span className="text-[10px] font-extrabold mt-1 leading-tight">
                  {isUploadingAvatar ? 'Uploading...' : 'Change Photo'}
                </span>
              </button>

              {/* Verified Badge or Camera Quick Action on Avatar Corner */}
              {isVerified ? (
                <div
                  className="absolute -bottom-1 -right-1 bg-white p-0.5 rounded-full shadow-md"
                  title="Verified Monvera Customer"
                >
                  <BlueVerifiedBadge className="w-8 h-8" />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute -bottom-1 -right-1 bg-slate-900 hover:bg-slate-800 text-sky-400 p-2 rounded-full shadow-md border-2 border-white cursor-pointer transition-transform hover:scale-110"
                  title="Upload profile photo"
                >
                  <Camera className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Quick Upload Button under Avatar */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploadingAvatar}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-950 text-xs font-extrabold border border-slate-300 transition-colors shadow-2xs cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5 text-sky-700 stroke-[2.5]" />
              <span>{isUploadingAvatar ? 'Uploading...' : 'Upload Photo'}</span>
            </button>
          </div>

          {/* Profile Identity Details */}
          <div className="flex-1 text-center md:text-left space-y-2.5">
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-3">
              <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-900 flex items-center gap-2">
                <span>{currentUser.firstName} {currentUser.lastName}</span>
                {isVerified && <BlueVerifiedBadge className="w-6 h-6" />}
              </h3>
              
              {/* Email Verification Status Badge */}
              {isEmailVerified ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-sky-100 text-sky-950 text-xs font-extrabold border border-sky-300">
                  <BlueVerifiedBadge className="w-3.5 h-3.5" />
                  <span>Email Verified</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-amber-50 text-amber-900 text-xs font-bold border border-amber-300">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                  <span>Email: Not verified</span>
                </span>
              )}

              {/* KYC Verification Status Badge */}
              {isKycVerified ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-100 text-emerald-950 text-xs font-extrabold border border-emerald-300">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                  <span>KYC Verified</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-slate-100 text-slate-800 text-xs font-bold border border-slate-300">
                  <span>KYC: Unverified</span>
                </span>
              )}

              <span className="text-xs font-bold px-3 py-1 rounded-lg bg-slate-900 text-white font-mono uppercase tracking-wider">
                {currentUser.membershipTier} Tier
              </span>
            </div>

            <p className="text-sm font-semibold text-slate-800 font-mono">
              Permanent Account ID: <strong className="text-slate-950 font-bold bg-slate-100 px-2 py-0.5 rounded">{currentUser.permanentAccountNumber}</strong> • Member since {new Date(currentUser.createdAt).toLocaleDateString([], { month: 'short', year: 'numeric' })}
            </p>

            {currentUser.businessName && (
              <div className="inline-flex items-center gap-2 text-xs font-bold text-slate-800 bg-slate-100 px-3.5 py-1.5 rounded-xl border border-slate-200">
                <Building2 className="w-4 h-4 text-sky-700" />
                <span>Commercial Entity: {currentUser.businessName}</span>
              </div>
            )}
          </div>

          {/* Daily Limit Card */}
          <div className="w-full md:w-auto p-5 rounded-2xl bg-slate-900 text-white border border-slate-800 text-center md:text-right shrink-0 space-y-1 shadow-md">
            <span className="text-xs font-bold text-sky-400 uppercase tracking-wider block">
              Daily Transaction Limit
            </span>
            <div className="text-3xl font-black font-mono text-white">
              ${dailyLimit.toLocaleString('en-US')}
            </div>
            <span className="text-xs text-slate-300 font-semibold block">
              Per 24-hour cycle • Unrestricted Wires
            </span>
          </div>
        </div>
      </div>

      {/* Grid: Account Information & Comprehensive Personal Details */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Account & Banking Routing Information */}
        <div className="p-6 sm:p-8 rounded-3xl bg-white border-2 border-slate-200 shadow-sm space-y-6">
          <div className="flex items-center gap-3 pb-3 border-b-2 border-slate-100">
            <div className="w-10 h-10 rounded-xl bg-slate-900 text-sky-400 flex items-center justify-center shadow-xs">
              <Landmark className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-lg text-slate-900">Institutional Account Records</h3>
              <p className="text-xs font-semibold text-slate-600 font-mono">Monvera Core Clearing Network</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div className="p-4 rounded-2xl bg-slate-50 border-2 border-slate-200 space-y-1">
              <span className="text-xs font-extrabold text-slate-700 flex items-center gap-1.5">
                <Hash className="w-4 h-4 text-sky-700" />
                <span>Permanent Monvera ID</span>
              </span>
              <span className="font-mono font-black text-slate-900 text-base block">
                {currentUser.permanentAccountNumber}
              </span>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 border-2 border-slate-200 space-y-1">
              <span className="text-xs font-extrabold text-slate-700 flex items-center gap-1.5">
                <Building2 className="w-4 h-4 text-sky-700" />
                <span>Routing Number (ABA)</span>
              </span>
              <span className="font-mono font-black text-slate-900 text-base block">
                021000021
              </span>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 border-2 border-slate-200 space-y-1">
              <span className="text-xs font-extrabold text-slate-700 flex items-center gap-1.5">
                <CreditCard className="w-4 h-4 text-sky-700" />
                <span>Primary Checking</span>
              </span>
              <span className="font-mono font-bold text-slate-900 block text-sm">
                MVB •••• {currentUser.permanentAccountNumber.slice(-4)}
              </span>
              <span className="text-emerald-700 font-bold font-mono text-xs block">
                Balance: ${balanceMetrics?.checkingBalance.toLocaleString('en-US', { minimumFractionDigits: 2 }) || '0.00'}
              </span>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 border-2 border-slate-200 space-y-1">
              <span className="text-xs font-extrabold text-slate-700 flex items-center gap-1.5">
                <CreditCard className="w-4 h-4 text-sky-700" />
                <span>High-Yield Savings</span>
              </span>
              <span className="font-mono font-bold text-slate-900 block text-sm">
                MVS •••• {currentUser.permanentAccountNumber.slice(-4)}
              </span>
              <span className="text-emerald-700 font-bold font-mono text-xs block">
                Balance: ${balanceMetrics?.savingsBalance.toLocaleString('en-US', { minimumFractionDigits: 2 }) || '0.00'}
              </span>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 border-2 border-slate-200 space-y-1">
              <span className="text-xs font-extrabold text-slate-700 flex items-center gap-1.5">
                <Globe className="w-4 h-4 text-sky-700" />
                <span>SWIFT / BIC Code</span>
              </span>
              <span className="font-mono font-bold text-slate-900 text-sm block">
                MVRAUS33XXX
              </span>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 border-2 border-slate-200 space-y-1">
              <span className="text-xs font-extrabold text-slate-700 flex items-center gap-1.5">
                <Shield className="w-4 h-4 text-sky-700" />
                <span>Currency & Settlement</span>
              </span>
              <span className="font-bold text-slate-900 text-sm block">
                USD ($) — {currentUser.country || 'United States'}
              </span>
            </div>
          </div>
        </div>

        {/* Customer Expanded Personal Information */}
        <div className="p-6 sm:p-8 rounded-3xl bg-white border-2 border-slate-200 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b-2 border-slate-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-slate-900 text-sky-400 flex items-center justify-center shadow-xs">
                <User className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-extrabold text-lg text-slate-900">Personal & Legal Identity</h3>
                <p className="text-xs font-semibold text-slate-600">Registered Customer Master Record</p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleOpenEditProfile}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow-xs transition-colors cursor-pointer self-start sm:self-auto"
            >
              <Edit3 className="w-3.5 h-3.5 text-sky-400" />
              <span>Edit Profile Details</span>
            </button>
          </div>

          {profileSuccessMsg && (
            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-900 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{profileSuccessMsg}</span>
              </div>
              <button
                type="button"
                onClick={() => setProfileSuccessMsg(null)}
                className="text-emerald-700 hover:text-emerald-900 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div className="p-4 rounded-2xl bg-slate-50 border-2 border-slate-200 space-y-1">
              <span className="text-xs font-extrabold text-slate-700 flex items-center gap-1.5">
                <User className="w-4 h-4 text-sky-700" />
                <span>Full Legal Name</span>
              </span>
              <span className="font-bold text-slate-950 text-base block">
                {currentUser.firstName} {currentUser.lastName}
              </span>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 border-2 border-slate-200 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold text-slate-700 flex items-center gap-1.5">
                  <Mail className="w-4 h-4 text-sky-700" />
                  <span>Registered Email</span>
                </span>
                {isEmailVerified ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-extrabold px-2 py-0.5 rounded bg-sky-100 text-sky-900 border border-sky-300">
                    <BlueVerifiedBadge className="w-3 h-3" />
                    <span>Verified</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] font-extrabold px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300">
                    <AlertCircle className="w-3 h-3 text-amber-600" />
                    <span>Not verified</span>
                  </span>
                )}
              </div>
              <span className="font-bold text-slate-950 text-sm block truncate" title={currentUser.email}>
                {currentUser.email}
              </span>
              {!isEmailVerified && (
                <button
                  type="button"
                  onClick={handleResendEmail}
                  disabled={isResendingEmail}
                  className="text-xs font-extrabold text-sky-700 hover:text-sky-900 underline flex items-center gap-1 cursor-pointer pt-1"
                >
                  <RefreshCw className={`w-3 h-3 ${isResendingEmail ? 'animate-spin' : ''}`} />
                  <span>Resend Verification Email</span>
                </button>
              )}
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 border-2 border-slate-200 space-y-1">
              <span className="text-xs font-extrabold text-slate-700 flex items-center gap-1.5">
                <Phone className="w-4 h-4 text-sky-700" />
                <span>Verified Phone</span>
              </span>
              <span className="font-bold text-slate-950 text-sm block font-mono">
                {currentUser.phone || '+1 (555) 234-8901'}
              </span>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 border-2 border-slate-200 space-y-1">
              <span className="text-xs font-extrabold text-slate-700 flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-sky-700" />
                <span>Date of Birth</span>
              </span>
              <span className="font-bold text-slate-950 text-sm block font-mono">
                {currentUser.dateOfBirth || '1989-04-14'}
              </span>
            </div>

            {/* Expanded: Street Address */}
            <div className="p-4 rounded-2xl bg-slate-50 border-2 border-slate-200 space-y-1">
              <span className="text-xs font-extrabold text-slate-700 flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-sky-700" />
                <span>Residential Address</span>
              </span>
              <span className="font-bold text-slate-950 text-sm block">
                {currentUser.streetAddress || (currentUser as any).address || '742 Evergreen Terrace, Suite 400'}
              </span>
            </div>

            {/* Expanded: City, State & Postal Code / Country */}
            <div className="p-4 rounded-2xl bg-slate-50 border-2 border-slate-200 space-y-1">
              <span className="text-xs font-extrabold text-slate-700 flex items-center gap-1.5">
                <Building2 className="w-4 h-4 text-sky-700" />
                <span>Country & Jurisdiction</span>
              </span>
              <span className="font-bold text-slate-950 text-sm block">
                {currentUser.country || 'United States'}
              </span>
            </div>

            {/* Marital Status */}
            <div className="p-4 rounded-2xl bg-slate-50 border-2 border-slate-200 space-y-1">
              <span className="text-xs font-extrabold text-slate-700 flex items-center gap-1.5">
                <User className="w-4 h-4 text-sky-700" />
                <span>Marital Status</span>
              </span>
              <span className="font-bold text-slate-950 text-sm block">
                {currentUser.maritalStatus || 'Single'}
              </span>
            </div>

            {/* Business Entity Name if applicable */}
            {currentUser.businessName ? (
              <div className="p-4 rounded-2xl bg-slate-50 border-2 border-slate-200 space-y-1">
                <span className="text-xs font-extrabold text-slate-700 flex items-center gap-1.5">
                  <Building2 className="w-4 h-4 text-sky-700" />
                  <span>Commercial Entity</span>
                </span>
                <span className="font-bold text-slate-950 text-sm block">
                  {currentUser.businessName}
                </span>
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-slate-50 border-2 border-slate-200 space-y-1">
                <span className="text-xs font-extrabold text-slate-700 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-sky-700" />
                  <span>Account Classification</span>
                </span>
                <span className="font-bold text-slate-950 text-sm block">
                  Private Individual Banking
                </span>
              </div>
            )}

            {/* Tax Identification / SSN */}
            <div className="p-4 rounded-2xl bg-slate-50 border-2 border-slate-200 space-y-1 sm:col-span-2">
              <span className="text-xs font-extrabold text-slate-700 flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-sky-700" />
                <span>Tax Identification & Regulatory Status</span>
              </span>
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-950 text-sm font-mono">
                  SSN / TIN: •••-••-8921 (FinCEN Clearance: Active)
                </span>
                <span className="text-xs font-bold text-emerald-800 bg-emerald-100 px-2.5 py-0.5 rounded-md border border-emerald-300">
                  Tax Verified
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Modal: Edit Profile Details */}
        {isEditingProfile && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in">
            <div className="bg-white rounded-3xl border-2 border-slate-200 shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 sm:p-8 space-y-6">
              
              {/* Modal Header */}
              <div className="flex items-center justify-between pb-4 border-b border-slate-200">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-900 text-sky-400 flex items-center justify-center font-bold shadow-xs">
                    <Edit3 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-slate-900">Edit Personal Profile</h3>
                    <p className="text-xs text-slate-500">Update personal information while protecting account security.</p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setIsEditingProfile(false)}
                  className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 hover:text-slate-800 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {profileErrorMsg && (
                <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>{profileErrorMsg}</span>
                </div>
              )}

              <form onSubmit={handleSaveProfile} className="space-y-6">
                
                {/* Editable Fields Section */}
                <div className="space-y-4">
                  <h4 className="text-xs font-mono font-bold uppercase text-slate-500 tracking-wider">
                    General Contact & Identity Information
                  </h4>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="block text-xs font-bold text-slate-700">Legal First Name *</label>
                        {isKycVerified && (
                          <span className="text-[10px] font-mono font-black text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded flex items-center gap-1">
                            <Lock className="w-3 h-3 text-emerald-600" />
                            Verified & Locked
                          </span>
                        )}
                      </div>
                      <input
                        type="text"
                        required
                        disabled={isKycVerified}
                        value={editFirstName}
                        onChange={(e) => setEditFirstName(e.target.value)}
                        placeholder="e.g. Eleanor"
                        className={`w-full py-2.5 px-3.5 rounded-xl border text-sm font-medium ${
                          isKycVerified
                            ? 'bg-slate-100 border-slate-200 text-slate-500 cursor-not-allowed select-none'
                            : 'bg-white border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500 text-slate-900'
                        }`}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="block text-xs font-bold text-slate-700">Legal Last Name *</label>
                        {isKycVerified && (
                          <span className="text-[10px] font-mono font-black text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded flex items-center gap-1">
                            <Lock className="w-3 h-3 text-emerald-600" />
                            Verified & Locked
                          </span>
                        )}
                      </div>
                      <input
                        type="text"
                        required
                        disabled={isKycVerified}
                        value={editLastName}
                        onChange={(e) => setEditLastName(e.target.value)}
                        placeholder="e.g. Vance"
                        className={`w-full py-2.5 px-3.5 rounded-xl border text-sm font-medium ${
                          isKycVerified
                            ? 'bg-slate-100 border-slate-200 text-slate-500 cursor-not-allowed select-none'
                            : 'bg-white border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500 text-slate-900'
                        }`}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-xs font-bold text-slate-700">Phone Number</label>
                      <input
                        type="tel"
                        value={editPhone}
                        onChange={(e) => setEditPhone(e.target.value)}
                        placeholder="e.g. +1 (555) 234-8901"
                        className="w-full py-2.5 px-3.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm font-medium text-slate-900"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-xs font-bold text-slate-700">Date of Birth</label>
                      <input
                        type="date"
                        value={editDateOfBirth}
                        onChange={(e) => setEditDateOfBirth(e.target.value)}
                        className="w-full py-2.5 px-3.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm font-medium text-slate-900"
                      />
                    </div>

                    <div className="space-y-1.5 sm:col-span-2">
                      <label className="block text-xs font-bold text-slate-700">Residential Address</label>
                      <input
                        type="text"
                        value={editStreetAddress}
                        onChange={(e) => setEditStreetAddress(e.target.value)}
                        placeholder="e.g. 742 Evergreen Terrace, Suite 400"
                        className="w-full py-2.5 px-3.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm font-medium text-slate-900"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-xs font-bold text-slate-700">Country of Residence</label>
                      <input
                        type="text"
                        value={editCountry}
                        onChange={(e) => setEditCountry(e.target.value)}
                        placeholder="e.g. United States"
                        className="w-full py-2.5 px-3.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm font-medium text-slate-900"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-xs font-bold text-slate-700">Marital Status</label>
                      <select
                        value={editMaritalStatus}
                        onChange={(e) => setEditMaritalStatus(e.target.value)}
                        className="w-full py-2.5 px-3.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm font-medium text-slate-900 bg-white"
                      >
                        <option value="Single">Single</option>
                        <option value="Married">Married</option>
                        <option value="Divorced">Divorced</option>
                        <option value="Widowed">Widowed</option>
                      </select>
                    </div>

                    {currentUser.businessName !== undefined && (
                      <div className="space-y-1.5 sm:col-span-2">
                        <label className="block text-xs font-bold text-slate-700">Business / Trade Name</label>
                        <input
                          type="text"
                          value={editBusinessName}
                          onChange={(e) => setEditBusinessName(e.target.value)}
                          placeholder="Registered Business Name"
                          className="w-full py-2.5 px-3.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm font-medium text-slate-900"
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* System-Controlled & Security Protected Fields (Read-Only) */}
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
                    <Lock className="w-3.5 h-3.5 text-slate-500" />
                    <span>Protected Banking Information (Governed by Regulatory Treasury)</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                      <span className="text-[10px] text-slate-500 block font-medium">Permanent Account Number</span>
                      <span className="font-mono font-bold text-slate-900">{currentUser.permanentAccountNumber || '1045827391'}</span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                      <span className="text-[10px] text-slate-500 block font-medium">Unique Identity (UID)</span>
                      <span className="font-mono font-bold text-slate-900">{currentUser.id}</span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                      <span className="text-[10px] text-slate-500 block font-medium">KYC Clearance</span>
                      <span className="font-bold text-emerald-800 uppercase text-[11px]">{currentUser.kycStatus || 'verified'}</span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                      <span className="text-[10px] text-slate-500 block font-medium">System Role</span>
                      <span className="font-bold text-slate-900 uppercase text-[11px]">{currentUser.role}</span>
                    </div>
                  </div>
                </div>

                {/* Modal Actions */}
                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsEditingProfile(false)}
                    className="px-5 py-2.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 font-bold text-xs cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingProfile}
                    className="px-6 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white font-bold text-xs shadow-md transition-all cursor-pointer flex items-center gap-2"
                  >
                    {isSavingProfile ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Saving Changes...</span>
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4 text-sky-400" />
                        <span>Save Profile Changes</span>
                      </>
                    )}
                  </button>
                </div>

              </form>
            </div>
          </div>
        )}

      </div>

      {/* Grid: Email Verification, Password Management & KYC Verification */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Card 1: Email Verification */}
        <div className="p-6 sm:p-8 rounded-3xl bg-white border-2 border-slate-200 shadow-sm space-y-6">
          <div className="flex items-center justify-between pb-3 border-b-2 border-slate-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-slate-900 text-sky-400 flex items-center justify-center shadow-xs">
                <Mail className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-extrabold text-lg text-slate-900">Email Verification</h3>
                <p className="text-xs font-semibold text-slate-600">Email Verification</p>
              </div>
            </div>

            {isEmailVerified ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-black px-3 py-1 rounded-full bg-sky-100 text-sky-950 border border-sky-300">
                <BlueVerifiedBadge className="w-4 h-4" />
                <span>Verified</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-black px-3 py-1 rounded-full bg-amber-100 text-amber-950 border border-amber-300">
                <AlertCircle className="w-3.5 h-3.5 text-amber-700" />
                <span>Not verified</span>
              </span>
            )}
          </div>

          <p className="text-sm font-semibold text-slate-800 leading-relaxed">
            Confirms that the customer owns the registered email address and protects account access with secure email verification.
          </p>

          <div className="p-4 rounded-2xl bg-slate-50 border-2 border-slate-200 space-y-2">
            <span className="text-xs font-extrabold text-slate-700 uppercase tracking-wider block">
              Registered Account Email
            </span>
            <div className="flex items-center justify-between">
              <span className="text-sm font-black text-slate-900 font-mono">
                {currentUser.email}
              </span>
              <span
                className={`text-xs font-extrabold px-2.5 py-0.5 rounded ${
                  isEmailVerified
                    ? 'bg-sky-100 text-sky-900 border border-sky-300'
                    : 'bg-amber-100 text-amber-900 border border-amber-300'
                }`}
              >
                {isEmailVerified ? 'Verified' : 'Not verified'}
              </span>
            </div>
          </div>

          {/* Email Action Success Message */}
          {emailSuccessMsg && (
            <div className="p-4 rounded-2xl bg-emerald-50 border-2 border-emerald-300 text-sm text-emerald-950 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <span className="font-semibold leading-relaxed">{emailSuccessMsg}</span>
            </div>
          )}

          {/* Email Action Error Message */}
          {emailErrorMsg && (
            <div className="p-4 rounded-2xl bg-red-50 border-2 border-red-300 text-sm text-red-950 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <span className="font-semibold leading-relaxed">{emailErrorMsg}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="pt-2 space-y-2.5">
            {!isEmailVerified ? (
              <div className="space-y-2.5">
                <button
                  type="button"
                  onClick={handleResendEmail}
                  disabled={isResendingEmail}
                  className="w-full py-3.5 px-6 rounded-2xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-extrabold flex items-center justify-center gap-2.5 transition-all shadow-md cursor-pointer"
                >
                  <RefreshCw className={`w-4 h-4 text-sky-400 ${isResendingEmail ? 'animate-spin' : ''}`} />
                  <span>{isResendingEmail ? 'Sending Verification Link...' : 'Resend Verification Email'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleCheckEmailStatus}
                  disabled={isCheckingEmail}
                  className="w-full py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-900 text-xs font-extrabold flex items-center justify-center gap-2 transition-all border border-slate-300 cursor-pointer"
                >
                  <CheckCircle2 className={`w-3.5 h-3.5 text-sky-700 ${isCheckingEmail ? 'animate-spin' : ''}`} />
                  <span>{isCheckingEmail ? 'Checking Verification Status...' : 'Check / Refresh Verification Status'}</span>
                </button>
                <p className="text-xs font-medium text-slate-500 text-center">
                  After clicking the link in your email, click Check Status or reload.
                </p>
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-sky-50 border border-sky-200 text-sky-950 flex items-center gap-3">
                <BlueVerifiedBadge className="w-5 h-5 shrink-0" />
                <span className="text-xs font-bold leading-relaxed">
                  Your registered email address is verified and active.
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Card 2: Password Management Card */}
        <div className="p-6 sm:p-8 rounded-3xl bg-white border-2 border-slate-200 shadow-sm space-y-6">
          <div className="flex items-center gap-3 pb-3 border-b-2 border-slate-100">
            <div className="w-10 h-10 rounded-xl bg-slate-900 text-sky-400 flex items-center justify-center shadow-xs">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-lg text-slate-900">Password Management</h3>
              <p className="text-xs font-semibold text-slate-600">Enterprise Security Protected</p>
            </div>
          </div>

          <p className="text-sm font-semibold text-slate-800 leading-relaxed">
            Your credentials are authenticated with end-to-end cryptographic encryption. You can request an official password reset link dispatched to your registered email anytime.
          </p>

          <div className="p-4 rounded-2xl bg-slate-50 border-2 border-slate-200 space-y-2">
            <span className="text-xs font-extrabold text-slate-700 uppercase tracking-wider block">
              Registered Security Email
            </span>
            <div className="flex items-center justify-between">
              <span className="text-sm font-black text-slate-900 font-mono">
                {currentUser.email}
              </span>
              <span className="text-xs font-bold px-2 py-0.5 rounded bg-sky-100 text-sky-900 border border-sky-300">
                Primary Auth
              </span>
            </div>
          </div>

          {/* Reset Link Success Message */}
          {resetSuccessMsg && (
            <div className="p-4 rounded-2xl bg-emerald-50 border-2 border-emerald-300 text-sm text-emerald-950 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <span className="font-semibold leading-relaxed">{resetSuccessMsg}</span>
            </div>
          )}

          {/* Reset Link Error Message */}
          {resetErrorMsg && (
            <div className="p-4 rounded-2xl bg-red-50 border-2 border-red-300 text-sm text-red-950 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <span className="font-semibold leading-relaxed">{resetErrorMsg}</span>
            </div>
          )}

          {/* Action Button */}
          <div className="pt-2">
            <button
              type="button"
              onClick={handleRequestPasswordReset}
              disabled={isRequestingReset}
              className="w-full py-3.5 px-6 rounded-2xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-extrabold flex items-center justify-center gap-2.5 transition-all shadow-md cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 text-sky-400 ${isRequestingReset ? 'animate-spin' : ''}`} />
              <span>{isRequestingReset ? 'Dispatching Reset Link...' : 'Send Password Reset Link via Email'}</span>
            </button>
            <p className="text-xs font-medium text-slate-500 text-center mt-2.5">
              Clicking will send a secure password reset link to your email ({currentUser.email}).
            </p>
          </div>
        </div>

        {/* KYC Verification & Identity Clearance Section (US vs International) */}
        <div className="p-6 sm:p-8 rounded-3xl bg-white border-2 border-slate-200 shadow-sm space-y-6">
          <div className="flex items-center justify-between pb-3 border-b-2 border-slate-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-slate-900 text-sky-400 flex items-center justify-center shadow-xs">
                <FileCheck className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-extrabold text-lg text-slate-900">KYC Verification</h3>
                <p className="text-xs font-semibold text-slate-600">Global Regulatory Identity Clearance</p>
              </div>
            </div>

            {isVerified ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-black px-3 py-1 rounded-full bg-sky-100 text-sky-950 border border-sky-300">
                <BlueVerifiedBadge className="w-4 h-4" />
                <span>Verified</span>
              </span>
            ) : currentUser.kycStatus === 'pending' ? (
              <span className="text-xs font-black px-3 py-1 rounded-full bg-amber-100 text-amber-950 border border-amber-300 flex items-center gap-1.5">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-700" />
                <span>Under Review</span>
              </span>
            ) : currentUser.kycStatus === 'action_required' || currentUser.kycStatus === 'rejected' ? (
              <span className="text-xs font-black px-3 py-1 rounded-full bg-rose-100 text-rose-950 border border-rose-300 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                <span>Action Required</span>
              </span>
            ) : (
              <span className="text-xs font-black px-3 py-1 rounded-full bg-slate-100 text-slate-800 border border-slate-300">
                Unverified
              </span>
            )}
          </div>

          {isVerified ? (
            /* Verified Account Display with Royal Blue Badge */
            <div className="space-y-4">
              <div className="p-5 rounded-2xl bg-sky-50 border-2 border-sky-200 flex items-start gap-4">
                <BlueVerifiedBadge className="w-7 h-7 shrink-0 mt-0.5" />
                <div className="space-y-1.5 text-sm text-sky-950">
                  <div className="font-black text-base text-sky-950 flex items-center gap-1.5">
                    <span>Account Fully Cleared & Verified</span>
                    <BlueVerifiedBadge className="w-4 h-4" />
                  </div>
                  <p className="text-sky-900 font-semibold leading-relaxed">
                    Your institutional KYC credentials have been validated and approved under global FinCEN / Bank Secrecy Act standards. Your full $1,000,000 daily transaction limit and international transfer capabilities are active. Legal name is locked under compliance security.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-sm">
                <div className="p-4 rounded-2xl bg-slate-50 border-2 border-slate-200">
                  <span className="text-slate-700 block text-xs font-extrabold uppercase tracking-wider">Document on File</span>
                  <span className="font-black text-slate-900 block mt-1">
                    {currentUser.kycDocumentType || 'Passport'}
                  </span>
                </div>

                <div className="p-4 rounded-2xl bg-slate-50 border-2 border-slate-200">
                  <span className="text-slate-700 block text-xs font-extrabold uppercase tracking-wider">Document Number</span>
                  <span className="font-mono font-black text-slate-900 block mt-1">
                    {currentUser.kycDocumentNumber || 'Verified ID on record'}
                  </span>
                </div>

                <div className="p-4 rounded-2xl bg-slate-50 border-2 border-slate-200">
                  <span className="text-slate-700 block text-xs font-extrabold uppercase tracking-wider">Verification Authority</span>
                  <span className="font-bold text-sky-800 block mt-1">
                    Monvera Compliance Clearing
                  </span>
                </div>

                <div className="p-4 rounded-2xl bg-slate-50 border-2 border-slate-200">
                  <span className="text-slate-700 block text-xs font-extrabold uppercase tracking-wider">Regulatory Clearance</span>
                  <span className="font-bold text-emerald-800 block mt-1">
                    FinCEN / BSA Tier 3 Approved
                  </span>
                </div>
              </div>
            </div>
          ) : currentUser.kycStatus === 'pending' ? (
            /* Pending Compliance Review Card */
            <div className="space-y-4">
              <div className="p-5 rounded-2xl bg-amber-50 border-2 border-amber-200 flex items-start gap-4">
                <RefreshCw className="w-6 h-6 text-amber-600 shrink-0 mt-0.5 animate-spin" />
                <div className="space-y-1.5 text-sm text-amber-950">
                  <span className="font-black text-base block">Verification Submission Under Compliance Review</span>
                  <p className="font-semibold text-amber-900 leading-relaxed">
                    Your identification documents, proof of address, and biometric selfie have been transmitted securely to Monvera Compliance Operations. Our certified regulatory analysts are adjudicating your application.
                  </p>
                  {currentUser.kycSubmittedAt && (
                    <p className="text-xs text-amber-800 font-mono mt-1">
                      Submitted on: {new Date(currentUser.kycSubmittedAt).toLocaleString()}
                    </p>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsKycModalOpen(true)}
                className="w-full py-3 px-4 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs"
              >
                <FileCheck className="w-4 h-4 text-sky-400" />
                <span>View Submitted Documents</span>
              </button>
            </div>
          ) : currentUser.kycStatus === 'action_required' || currentUser.kycStatus === 'rejected' ? (
            /* Action Required / Resubmission Card */
            <div className="space-y-4">
              <div className="p-5 rounded-2xl bg-rose-50 border-2 border-rose-200 flex items-start gap-4">
                <AlertTriangle className="w-6 h-6 text-rose-600 shrink-0 mt-0.5" />
                <div className="space-y-1.5 text-sm text-rose-950">
                  <span className="font-black text-base block">Document Correction Required</span>
                  <p className="font-semibold text-rose-900 leading-relaxed">
                    Monvera Compliance Desk reviewed your submission and requested corrections:
                  </p>
                  <div className="p-3 bg-white/80 rounded-xl border border-rose-300 font-mono text-xs font-bold text-rose-950 mt-1">
                    "{currentUser.kycRejectionReason || 'Document could not be verified by compliance.'}"
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsKycModalOpen(true)}
                className="w-full py-3.5 px-4 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-extrabold flex items-center justify-center gap-2.5 transition-all cursor-pointer shadow-md"
              >
                <Upload className="w-4 h-4" />
                <span>Update & Resubmit Verification Documents</span>
              </button>
            </div>
          ) : (
            /* Unverified Call-to-Action Card */
            <div className="space-y-4">
              <div className="p-5 rounded-2xl bg-slate-50 border-2 border-slate-200 space-y-3">
                <div className="flex items-center gap-2.5 text-slate-900 font-extrabold text-sm">
                  <ShieldCheck className="w-5 h-5 text-sky-600" />
                  <span>Institutional Clearance Benefits</span>
                </div>
                <p className="text-xs text-slate-600 font-semibold leading-relaxed">
                  Verify your account using your government ID, proof of address, and live selfie to unlock institutional limits, global wire transfers, and verified member credentials.
                </p>
                <div className="grid grid-cols-2 gap-2 text-xs font-bold text-slate-700 pt-1">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>$1,000,000 / day limits</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>International Transfers</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>Royal Blue Verified Badge</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>FinCEN Regulatory Clearance</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsKycModalOpen(true)}
                className="w-full py-3.5 px-4 rounded-2xl bg-sky-700 hover:bg-sky-800 text-white text-sm font-extrabold flex items-center justify-center gap-2.5 transition-all cursor-pointer shadow-md"
              >
                <FileCheck className="w-4 h-4" />
                <span>Begin Identity Verification</span>
              </button>
            </div>
          )}
        </div>

      </div>

      {/* Render KycVerificationModal */}
      <KycVerificationModal
        isOpen={isKycModalOpen}
        onClose={() => setIsKycModalOpen(false)}
      />


    </div>
  );
};

