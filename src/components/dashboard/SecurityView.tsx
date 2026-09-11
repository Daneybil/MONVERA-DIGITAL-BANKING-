import React, { useState, useEffect } from 'react';
import { useAuth, TotpSecret } from '../../context/AuthContext';
import QRCode from 'qrcode';
import confetti from 'canvas-confetti';
import {
  ShieldCheck,
  KeyRound,
  Smartphone,
  Lock,
  CheckCircle2,
  AlertTriangle,
  LogOut,
  Laptop,
  Check,
  Copy,
  QrCode,
  Sparkles,
  HelpCircle,
  RefreshCw,
  Eye,
  EyeOff,
  Shield,
  Loader2,
} from 'lucide-react';

export const SecurityView: React.FC = () => {
  const {
    currentUser,
    getEnrolledTotpFactor,
    startTotpEnrollment,
    finishTotpEnrollment,
    unenrollTotpMfa,
    reauthenticateUser,
  } = useAuth();

  const [isEnrolled, setIsEnrolled] = useState<boolean>(() => {
    return !!getEnrolledTotpFactor() || (currentUser?.twoFactorEnabled ?? false);
  });

  const [totpSecret, setTotpSecret] = useState<TotpSecret | null>(null);
  const [secretKeyDisplay, setSecretKeyDisplay] = useState<string>('');
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [copiedKey, setCopiedKey] = useState(false);
  const [isInitializingMfa, setIsInitializingMfa] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  // 6-digit verification code
  const [verificationCode, setVerificationCode] = useState('');
  const [verifyStatus, setVerifyStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [verifyMessage, setVerifyMessage] = useState('');

  // Password Reauthentication Modal State (required by Firebase for MFA security modifications)
  const [showReauthModal, setShowReauthModal] = useState(false);
  const [reauthPassword, setReauthPassword] = useState('');
  const [reauthError, setReauthError] = useState<string | null>(null);
  const [isReauthenticating, setIsReauthenticating] = useState(false);
  const [reauthAction, setReauthAction] = useState<'enroll' | 'unenroll' | null>(null);
  const [showReauthPassword, setShowReauthPassword] = useState(false);

  // Active Sessions
  const [sessions, setSessions] = useState([
    {
      id: 'sess-1',
      device: 'MacBook Pro (Apple Silicon) • Safari / Chrome',
      ip: '198.51.100.24 (New York, US)',
      current: true,
      lastActive: 'Active right now',
    },
    {
      id: 'sess-2',
      device: 'iPhone 16 Pro • Monvera Mobile Web',
      ip: '198.51.100.78 (New York, US)',
      current: false,
      lastActive: '2 hours ago',
    },
  ]);

  // Sync enrolled status with Auth context
  useEffect(() => {
    const factor = getEnrolledTotpFactor();
    if (factor) {
      setIsEnrolled(true);
    } else if (currentUser?.twoFactorEnabled !== undefined) {
      setIsEnrolled(currentUser.twoFactorEnabled);
    }
  }, [currentUser, getEnrolledTotpFactor]);

  // Format secret key in groups of 4 characters for easy human readability
  const formatSecretKey = (rawKey: string): string => {
    const clean = rawKey.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const chunks: string[] = [];
    for (let i = 0; i < clean.length; i += 4) {
      chunks.push(clean.slice(i, i + 4));
    }
    return chunks.join('-');
  };

  // Generate real Firebase TOTP enrollment session
  const handleInitiateEnrollment = async () => {
    setIsInitializingMfa(true);
    setInitError(null);
    setVerifyStatus('idle');
    setVerifyMessage('');

    try {
      const res = await startTotpEnrollment();
      if (res.success && res.totpSecret) {
        setTotpSecret(res.totpSecret);
        const formatted = formatSecretKey(res.secretKey || res.totpSecret.secretKey || '');
        setSecretKeyDisplay(formatted);

        // Generate QR code data URL using qrcode package
        const qrUrl = res.qrCodeUrl || res.totpSecret.generateQrCodeUrl(
          currentUser?.email || 'customer@monvera.com',
          'Monvera Bank'
        );

        QRCode.toDataURL(qrUrl, {
          width: 240,
          margin: 1,
          color: {
            dark: '#0f172a',
            light: '#ffffff',
          },
        })
          .then((url) => setQrCodeDataUrl(url))
          .catch((err) => {
            console.error('Failed to generate QR Code:', err);
            setInitError('Could not render QR code visually. Please use the manual Secret Key below.');
          });
      } else if (res.requiresReauth) {
        setReauthAction('enroll');
        setShowReauthModal(true);
      } else {
        setInitError(res.error || 'Failed to initialize Google Authenticator with Firebase.');
      }
    } catch (err: any) {
      setInitError(err?.message || 'An unexpected error occurred while starting 2FA setup.');
    } finally {
      setIsInitializingMfa(false);
    }
  };

  // Load TOTP session if user is not enrolled and wishes to configure
  useEffect(() => {
    if (!isEnrolled && !totpSecret && !isInitializingMfa) {
      handleInitiateEnrollment();
    }
  }, [isEnrolled]);

  if (!currentUser) return null;

  const handleCopyKey = () => {
    if (!secretKeyDisplay) return;
    navigator.clipboard?.writeText(secretKeyDisplay.replace(/-/g, ''));
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2500);
  };

  // Handle Verify & Activate TOTP Code
  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = verificationCode.replace(/\D/g, '').trim();
    if (cleanCode.length !== 6) {
      setVerifyStatus('error');
      setVerifyMessage('Please enter a valid 6-digit numerical code from Google Authenticator.');
      return;
    }

    if (!totpSecret) {
      setVerifyStatus('error');
      setVerifyMessage('Setup session expired. Please click "Regenerate Key" to start a fresh enrollment.');
      return;
    }

    setVerifyStatus('loading');
    setVerifyMessage('');

    try {
      const res = await finishTotpEnrollment(totpSecret, cleanCode, 'Google Authenticator');
      if (res.success) {
        setVerifyStatus('success');
        setVerifyMessage(
          'Google Authenticator 2FA verified and activated successfully! Your Monvera account is now securely protected with hardware-grade two-factor authentication.'
        );
        setIsEnrolled(true);

        confetti({
          particleCount: 80,
          spread: 60,
          origin: { y: 0.6 },
          colors: ['#059669', '#10b981', '#0ea5e9'],
        });
      } else {
        setVerifyStatus('error');
        setVerifyMessage(
          res.error || 'Invalid 6-digit code. Please verify your phone time is accurate and try again.'
        );
      }
    } catch (err: any) {
      setVerifyStatus('error');
      setVerifyMessage(err?.message || 'Failed to verify authentication code.');
    }
  };

  // Handle Disable / Toggle 2FA
  const handleToggle2FA = async () => {
    if (isEnrolled) {
      // Prompt user to disable 2FA
      const confirmDisable = window.confirm(
        'Are you sure you want to disable Google Authenticator Two-Factor Authentication? Your account will have less protection against unauthorized wire transfers and logins.'
      );
      if (!confirmDisable) return;

      setVerifyStatus('loading');
      const res = await unenrollTotpMfa();
      if (res.success) {
        setIsEnrolled(false);
        setTotpSecret(null);
        setQrCodeDataUrl('');
        setVerificationCode('');
        setVerifyStatus('idle');
        setVerifyMessage('');
      } else if (res.requiresReauth) {
        setReauthAction('unenroll');
        setShowReauthModal(true);
      } else {
        setVerifyStatus('error');
        setVerifyMessage(res.error || 'Failed to disable Two-Factor Authentication.');
      }
    } else {
      // User wants to enable 2FA
      handleInitiateEnrollment();
    }
  };

  // Handle Password Re-Authentication Submission
  const handleReauthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reauthPassword) {
      setReauthError('Please enter your account password.');
      return;
    }

    setIsReauthenticating(true);
    setReauthError(null);

    try {
      const res = await reauthenticateUser(reauthPassword);
      if (res.success) {
        setShowReauthModal(false);
        setReauthPassword('');
        if (reauthAction === 'enroll') {
          handleInitiateEnrollment();
        } else if (reauthAction === 'unenroll') {
          await unenrollTotpMfa();
          setIsEnrolled(false);
          setTotpSecret(null);
          setQrCodeDataUrl('');
        }
      } else {
        setReauthError(res.error || 'Incorrect password. Please try again.');
      }
    } catch (err: any) {
      setReauthError(err?.message || 'Authentication error.');
    } finally {
      setIsReauthenticating(false);
    }
  };

  const handleTerminateSession = (id: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== id));
  };

  return (
    <div id="security-center-view" className="space-y-6 sm:space-y-8 animate-in fade-in duration-150">
      
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-850 to-slate-900 text-white p-6 sm:p-8 rounded-3xl border-2 border-slate-800 shadow-xl space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-mono font-bold">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Institutional Account Protection</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
              Security & Google Authenticator (2FA)
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 max-w-2xl leading-relaxed">
              Add Google Authenticator to your account for extra security. Every time you log in or send high-value wire transfers, a 6-digit temporary code will keep your money safe from hackers.
            </p>
          </div>

          <div className="flex items-center gap-2 bg-slate-950/80 px-4 py-2 rounded-2xl border border-slate-800 shrink-0">
            <span className={`w-3 h-3 rounded-full ${isEnrolled ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
            <span className={`text-xs font-mono font-bold ${isEnrolled ? 'text-emerald-300' : 'text-amber-300'}`}>
              {isEnrolled ? '2FA Protection Active' : '2FA Protection Disabled'}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
        
        {/* Left Column (2 Cols): Google Authenticator Setup & Testing */}
        <div className="lg:col-span-2 space-y-6 sm:space-y-8">
          
          {/* Main Google Authenticator Card */}
          <div className="p-6 sm:p-8 rounded-3xl bg-white border-2 border-slate-200 shadow-md space-y-6">
            
            {/* 2FA Toggle Header */}
            <div className="flex items-center justify-between pb-5 border-b border-slate-200">
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-2xl bg-slate-900 text-emerald-400 flex items-center justify-center shadow-md">
                  <Smartphone className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900">Google Authenticator (2FA)</h3>
                  <p className="text-xs sm:text-sm text-slate-500">
                    Industry-standard Time-based One-Time Password (TOTP) backed by Firebase Authentication.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleToggle2FA}
                className={`w-14 h-8 rounded-full transition-colors relative cursor-pointer ${
                  isEnrolled ? 'bg-emerald-600' : 'bg-slate-300'
                }`}
                title={isEnrolled ? 'Click to disable 2FA' : 'Click to enable 2FA'}
              >
                <div
                  className={`w-6 h-6 rounded-full bg-white transition-transform transform shadow-md absolute top-1 ${
                    isEnrolled ? 'left-7' : 'left-1'
                  }`}
                />
              </button>
            </div>

            {/* If 2FA is currently active */}
            {isEnrolled ? (
              <div className="space-y-5">
                <div className="p-5 rounded-2xl bg-emerald-50 border-2 border-emerald-200 space-y-3">
                  <div className="flex items-center gap-2.5 text-emerald-900 font-extrabold text-sm sm:text-base">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    <span>Two-Factor Authentication is Active & Enforced</span>
                  </div>
                  <p className="text-xs sm:text-sm text-emerald-800 leading-relaxed font-medium">
                    Your Monvera banking account is protected with Google Authenticator. Whenever you sign in or authorize high-value wire transfers, a temporary 6-digit TOTP verification code from your device will be required.
                  </p>
                  <div className="pt-2 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={handleToggle2FA}
                      className="px-4 py-2 rounded-xl bg-white hover:bg-slate-50 text-slate-700 hover:text-red-700 border border-slate-300 font-bold text-xs transition-colors cursor-pointer"
                    >
                      Disable Google Authenticator
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsEnrolled(false);
                        handleInitiateEnrollment();
                      }}
                      className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition-colors cursor-pointer flex items-center gap-1.5"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Re-enroll / Switch Device</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              /* If 2FA is NOT enrolled, guide through real setup */
              <div className="space-y-6">
                
                {initError && (
                  <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-xs sm:text-sm text-red-800 flex items-start gap-2.5">
                    <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <div className="font-bold">2FA Setup Notice</div>
                      <div>{initError}</div>
                      <button
                        type="button"
                        onClick={handleInitiateEnrollment}
                        className="font-bold underline text-red-900 hover:text-red-700 cursor-pointer pt-1 inline-block"
                      >
                        Try Again
                      </button>
                    </div>
                  </div>
                )}

                {isInitializingMfa ? (
                  <div className="p-8 rounded-2xl bg-slate-50 border-2 border-slate-200 flex flex-col items-center justify-center space-y-3 text-center">
                    <Loader2 className="w-8 h-8 text-sky-600 animate-spin" />
                    <div className="font-bold text-slate-800 text-sm">Generating Secure Authenticator Key...</div>
                    <p className="text-xs text-slate-500">Contacting Firebase Authentication to establish a TOTP session.</p>
                  </div>
                ) : (
                  <>
                    {/* Step 1: Scan QR or Copy Key */}
                    <div className="p-5 sm:p-6 rounded-2xl bg-slate-50 border-2 border-slate-200 space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono font-bold uppercase text-emerald-700 bg-emerald-100 px-2.5 py-1 rounded-md">
                          Step 1 • Scan QR Code in Authenticator App
                        </span>
                        <button
                          type="button"
                          onClick={handleInitiateEnrollment}
                          className="text-xs font-bold text-slate-600 hover:text-slate-900 flex items-center gap-1.5 cursor-pointer"
                          title="Generate new secret key"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>New Key</span>
                        </button>
                      </div>

                      <div className="flex flex-col sm:flex-row items-center gap-6">
                        {/* QR Code Container */}
                        <div className="p-3 bg-white rounded-2xl border-2 border-slate-300 shadow-sm shrink-0">
                          {qrCodeDataUrl ? (
                            <img
                              src={qrCodeDataUrl}
                              alt="Google Authenticator QR Code"
                              className="w-40 h-40 rounded-xl"
                            />
                          ) : (
                            <div className="w-40 h-40 bg-slate-100 animate-pulse rounded-xl flex items-center justify-center">
                              <QrCode className="w-8 h-8 text-slate-400" />
                            </div>
                          )}
                        </div>

                        {/* Manual Secret Key Info */}
                        <div className="space-y-3 flex-1 text-xs sm:text-sm">
                          <p className="text-slate-700 leading-relaxed font-medium">
                            Open <strong>Google Authenticator</strong> (or 1Password / Authy) on your mobile device, tap <strong>+</strong> and select <strong>Scan a QR code</strong>.
                          </p>
                          <p className="text-slate-500 text-xs">
                            Cannot scan? Tap <strong>Enter a setup key</strong> in Google Authenticator and type this key:
                          </p>

                          <div className="flex items-center gap-2">
                            <div className="p-2.5 bg-white rounded-xl border border-slate-300 font-mono font-black text-slate-900 text-xs sm:text-sm flex-1 tracking-wider text-center select-all">
                              {secretKeyDisplay || 'Generating key...'}
                            </div>
                            <button
                              type="button"
                              onClick={handleCopyKey}
                              className="p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold flex items-center gap-1.5 transition-colors cursor-pointer text-xs shrink-0"
                              title="Copy Secret Key"
                            >
                              {copiedKey ? (
                                <>
                                  <Check className="w-4 h-4 text-emerald-400" />
                                  <span>Copied!</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-4 h-4" />
                                  <span>Copy</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Step 2: Test & Verify 6-Digit Code */}
                    <div className="p-5 sm:p-6 rounded-2xl bg-slate-50 border-2 border-slate-200 space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono font-bold uppercase text-slate-700 bg-slate-200 px-2.5 py-1 rounded-md">
                          Step 2 • Verify 6-Digit Code
                        </span>
                        <span className="text-xs text-slate-500 font-medium">
                          From Google Authenticator
                        </span>
                      </div>

                      <form onSubmit={handleVerifyCode} className="space-y-3">
                        <label className="block text-xs sm:text-sm font-bold text-slate-700">
                          Enter the 6-digit rolling code displayed on your phone:
                        </label>

                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                          <input
                            type="text"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            maxLength={6}
                            placeholder="000000"
                            value={verificationCode}
                            onChange={(e) => {
                              setVerificationCode(e.target.value.replace(/\D/g, ''));
                              setVerifyStatus('idle');
                            }}
                            className="py-3 px-4 rounded-xl border-2 border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono font-black text-2xl tracking-widest text-center text-slate-900 bg-white"
                          />

                          <button
                            type="submit"
                            disabled={verifyStatus === 'loading' || verificationCode.length !== 6}
                            className="py-3 px-6 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-extrabold text-xs sm:text-sm shadow-md transition-all cursor-pointer flex items-center justify-center gap-2"
                          >
                            {verifyStatus === 'loading' ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <span>Verifying...</span>
                              </>
                            ) : (
                              <>
                                <CheckCircle2 className="w-4 h-4" />
                                <span>Activate Google Authenticator</span>
                              </>
                            )}
                          </button>
                        </div>
                      </form>

                      {/* Verification Status Feedback */}
                      {verifyStatus === 'success' && (
                        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-300 text-xs sm:text-sm text-emerald-900 flex items-start gap-2.5 animate-in fade-in">
                          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                          <div>
                            <div className="font-bold">Google Authenticator Activated!</div>
                            <div>{verifyMessage}</div>
                          </div>
                        </div>
                      )}

                      {verifyStatus === 'error' && (
                        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-xs sm:text-sm text-red-800 flex items-start gap-2.5 animate-in fade-in">
                          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                          <div>
                            <div className="font-bold">Verification Failed</div>
                            <div>{verifyMessage}</div>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}

              </div>
            )}

          </div>

          {/* Active Logged-in Devices Card */}
          <div className="p-6 sm:p-8 rounded-3xl bg-white border-2 border-slate-200 shadow-md space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-900 flex items-center justify-center font-bold">
                  <Laptop className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-slate-900 text-base">Authorized Active Devices</h3>
                  <p className="text-xs text-slate-500">Devices currently logged in to your Monvera bank account</p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {sessions.map((s) => (
                <div
                  key={s.id}
                  className="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 font-bold text-slate-900 text-sm">
                      <span>{s.device}</span>
                      {s.current && (
                        <span className="text-[10px] text-emerald-800 bg-emerald-100 border border-emerald-300 px-2 py-0.5 rounded font-mono font-bold">
                          Current Device
                        </span>
                      )}
                    </div>
                    <div className="text-slate-500 font-mono text-[11px]">{s.ip} • {s.lastActive}</div>
                  </div>

                  {!s.current && (
                    <button
                      onClick={() => handleTerminateSession(s.id)}
                      className="px-3.5 py-1.5 rounded-xl text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 transition-colors self-start sm:self-auto cursor-pointer"
                    >
                      Log Out Device
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* Right Column: How to Add & Use Google Authenticator (Layman Guide) */}
        <div className="space-y-6">
          
          {/* Detailed Instructions Card */}
          <div className="p-6 rounded-3xl bg-white border-2 border-slate-200 shadow-md space-y-4">
            <div className="flex items-center gap-2 text-emerald-700 font-bold text-sm">
              <HelpCircle className="w-4 h-4" />
              <span>How Google Authenticator Works</span>
            </div>

            <h3 className="text-base font-black text-slate-900">
              Simple 3-Step Setup Guide
            </h3>

            <div className="space-y-3 text-xs sm:text-sm text-slate-600">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                <strong className="text-slate-900 block font-bold">1. Download the Free App</strong>
                <p>Install <strong>Google Authenticator</strong> from the Apple App Store (iPhone) or Google Play Store (Android).</p>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                <strong className="text-slate-900 block font-bold">2. Scan the Monvera QR Code</strong>
                <p>Open the app, tap the <strong>+</strong> button, and aim your phone camera at the QR code on this screen.</p>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                <strong className="text-slate-900 block font-bold">3. Type the 6-Digit Code</strong>
                <p>The app will give you a 6-digit number that updates every 30 seconds. Enter that number here to test and confirm!</p>
              </div>
            </div>
          </div>

          {/* Cryptographic Protection Badge */}
          <div className="p-6 rounded-3xl bg-gradient-to-br from-slate-900 to-slate-950 text-white shadow-xl space-y-4 border-2 border-slate-800">
            <div className="w-10 h-10 rounded-xl bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center font-bold">
              <ShieldCheck className="w-5 h-5" />
            </div>

            <h3 className="font-bold text-base text-white">Bank-Grade 256-Bit Security</h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              With 2-Factor Authentication enabled, no one can authorize outbound wire transfers or log in without your physical device code.
            </p>

            <div className="pt-2 border-t border-slate-800 space-y-2 text-xs font-mono">
              <div className="flex justify-between text-slate-400">
                <span>Encryption:</span>
                <span className="text-white font-bold">AES-256 GCM</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Auth Standard:</span>
                <span className="text-emerald-400 font-bold">RFC 6238 TOTP</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Protection:</span>
                <span className="text-emerald-400 font-bold">Hardware Enforced</span>
              </div>
            </div>
          </div>

        </div>

      </div>

      {/* Password Re-authentication Modal for Sensitive MFA Changes */}
      {showReauthModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-3xl border-2 border-slate-200 shadow-2xl max-w-md w-full p-6 sm:p-8 space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
                <Lock className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-black text-lg text-slate-900">Security Verification</h3>
                <p className="text-xs text-slate-500">
                  Please confirm your password to {reauthAction === 'unenroll' ? 'disable' : 'configure'} Two-Factor Authentication.
                </p>
              </div>
            </div>

            <form onSubmit={handleReauthSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700">Account Password</label>
                <div className="relative">
                  <input
                    type={showReauthPassword ? 'text' : 'password'}
                    value={reauthPassword}
                    onChange={(e) => {
                      setReauthPassword(e.target.value);
                      setReauthError(null);
                    }}
                    placeholder="Enter your current password"
                    className="w-full py-3 pl-4 pr-11 rounded-xl border-2 border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-medium text-sm text-slate-900"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowReauthPassword(!showReauthPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    {showReauthPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {reauthError && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>{reauthError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowReauthModal(false);
                    setReauthPassword('');
                    setReauthError(null);
                  }}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 font-bold text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isReauthenticating || !reauthPassword}
                  className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white font-bold text-xs cursor-pointer flex items-center gap-2"
                >
                  {isReauthenticating ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Verifying...</span>
                    </>
                  ) : (
                    <span>Confirm & Continue</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
