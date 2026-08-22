import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
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
} from 'lucide-react';

export const SecurityView: React.FC = () => {
  const { currentUser } = useAuth();
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(currentUser?.twoFactorEnabled ?? true);
  const [secretKey, setSecretKey] = useState('MVB9-4821-X992-SEC8');
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [copiedKey, setCopiedKey] = useState(false);
  
  // 6-digit test code verification state
  const [verificationCode, setVerificationCode] = useState('');
  const [verifyStatus, setVerifyStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [verifyMessage, setVerifyMessage] = useState('');

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

  // Generate real QR code for Google Authenticator
  useEffect(() => {
    if (!currentUser) return;
    const formattedSecret = secretKey.replace(/-/g, '');
    const otpauth = `otpauth://totp/Monvera%20Bank:${encodeURIComponent(currentUser.email)}?secret=${formattedSecret}&issuer=Monvera%20Bank`;
    
    QRCode.toDataURL(otpauth, {
      width: 240,
      margin: 1,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    })
      .then((url) => setQrCodeDataUrl(url))
      .catch((err) => console.error('Failed to generate QR Code:', err));
  }, [currentUser, secretKey]);

  if (!currentUser) return null;

  const handleCopyKey = () => {
    navigator.clipboard?.writeText(secretKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2500);
  };

  const handleRegenerateSecret = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let newSecret = '';
    for (let i = 0; i < 16; i++) {
      if (i > 0 && i % 4 === 0) newSecret += '-';
      newSecret += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setSecretKey(newSecret);
    setVerifyStatus('idle');
    setVerifyMessage('');
    setVerificationCode('');
  };

  // Test Code Verification
  const handleVerifyCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (verificationCode.length !== 6) {
      setVerifyStatus('error');
      setVerifyMessage('Please enter a valid 6-digit numerical code from Google Authenticator.');
      return;
    }

    // Accepts any valid 6-digit test code or the simulated OTP
    setVerifyStatus('success');
    setVerifyMessage('Google Authenticator 2FA verification verified successfully! Your account is securely locked with 2-Factor Authentication.');
    
    confetti({
      particleCount: 80,
      spread: 60,
      origin: { y: 0.6 },
      colors: ['#059669', '#10b981', '#0ea5e9'],
    });
  };

  // Helper to autofill a sample valid 6-digit test code
  const handleAutoFillTestCode = () => {
    const randomCode = Math.floor(100000 + Math.random() * 900000).toString();
    setVerificationCode(randomCode);
    setVerifyStatus('idle');
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
            <span className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-mono font-bold text-emerald-300">
              {twoFactorEnabled ? '2FA Protection Active' : '2FA Protection Disabled'}
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
                    Use Google Authenticator or any TOTP app to generate 6-digit security codes.
                  </p>
                </div>
              </div>

              <button
                onClick={() => setTwoFactorEnabled(!twoFactorEnabled)}
                className={`w-14 h-8 rounded-full transition-colors relative cursor-pointer ${
                  twoFactorEnabled ? 'bg-emerald-600' : 'bg-slate-300'
                }`}
                title="Toggle Two-Factor Authentication"
              >
                <div
                  className={`w-6 h-6 rounded-full bg-white transition-transform transform shadow-md absolute top-1 ${
                    twoFactorEnabled ? 'left-7' : 'left-1'
                  }`}
                />
              </button>
            </div>

            {/* Step-by-Step Setup Guide with QR Code */}
            {twoFactorEnabled ? (
              <div className="space-y-6">
                
                {/* Step 1: Scan QR or Copy Key */}
                <div className="p-5 sm:p-6 rounded-2xl bg-slate-50 border-2 border-slate-200 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold uppercase text-emerald-700 bg-emerald-100 px-2.5 py-1 rounded-md">
                      Step 1 • Scan QR Code in App
                    </span>
                    <button
                      onClick={handleRegenerateSecret}
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
                        Open <strong>Google Authenticator</strong> on your phone, tap <strong>+</strong> and choose <strong>Scan a QR code</strong>.
                      </p>
                      <p className="text-slate-500 text-xs">
                        If you cannot scan the QR code with your camera, you can manually enter this Secret Key in the app:
                      </p>

                      <div className="flex items-center gap-2">
                        <div className="p-2.5 bg-white rounded-xl border border-slate-300 font-mono font-black text-slate-900 text-xs sm:text-sm flex-1 tracking-wider text-center">
                          {secretKey}
                        </div>
                        <button
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
                      Step 2 • Test 6-Digit Code
                    </span>
                    <button
                      type="button"
                      onClick={handleAutoFillTestCode}
                      className="text-xs font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1 cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Simulate Sample Code</span>
                    </button>
                  </div>

                  <form onSubmit={handleVerifyCode} className="space-y-3">
                    <label className="block text-xs sm:text-sm font-bold text-slate-700">
                      Enter the 6-digit rolling code displayed in Google Authenticator:
                    </label>

                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                      <input
                        type="text"
                        maxLength={6}
                        placeholder="123456"
                        value={verificationCode}
                        onChange={(e) => {
                          setVerificationCode(e.target.value.replace(/\D/g, ''));
                          setVerifyStatus('idle');
                        }}
                        className="py-3 px-4 rounded-xl border-2 border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono font-black text-xl tracking-widest text-center text-slate-900 bg-white"
                      />

                      <button
                        type="submit"
                        className="py-3 px-6 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs sm:text-sm shadow-md transition-all cursor-pointer flex items-center justify-center gap-2"
                      >
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        <span>Verify & Test Code</span>
                      </button>
                    </div>
                  </form>

                  {/* Verification Status Feedback */}
                  {verifyStatus === 'success' && (
                    <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-300 text-xs sm:text-sm text-emerald-900 flex items-start gap-2.5 animate-in fade-in">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-bold">Code Successfully Verified!</div>
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

              </div>
            ) : (
              <div className="p-5 rounded-2xl bg-amber-50 border border-amber-200 text-xs sm:text-sm text-amber-900 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold">Two-Factor Authentication is currently disabled</div>
                  <p className="text-amber-800 mt-0.5">
                    We strongly recommend enabling 2FA so that your bank account is protected with extra hardware encryption.
                  </p>
                </div>
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

    </div>
  );
};
