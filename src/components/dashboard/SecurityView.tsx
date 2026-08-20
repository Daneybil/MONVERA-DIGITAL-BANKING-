import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
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
} from 'lucide-react';

export const SecurityView: React.FC = () => {
  const { currentUser } = useAuth();
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(currentUser?.twoFactorEnabled ?? true);
  const [passwordUpdated, setPasswordUpdated] = useState(false);
  const [sessions, setSessions] = useState([
    {
      id: 'sess-1',
      device: 'MacBook Pro (Apple Silicon) • macOS 15.1',
      ip: '198.51.100.24 (New York, US)',
      current: true,
      lastActive: 'Active right now',
    },
    {
      id: 'sess-2',
      device: 'iPhone 16 Pro • Monvera iOS App',
      ip: '198.51.100.78 (New York, US)',
      current: false,
      lastActive: '3 hours ago',
    },
  ]);

  if (!currentUser) return null;

  const handleTerminateSession = (id: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== id));
  };

  return (
    <div id="security-center-view" className="space-y-8 animate-in fade-in duration-150">
      
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Security & Device Governance</h2>
        <p className="text-xs sm:text-sm text-slate-500">
          Manage hardware multi-factor authentication, active login sessions, and account protection policies.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Security Settings */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* 2FA Card */}
          <div className="p-6 rounded-3xl bg-white border border-slate-200/90 shadow-2xs space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-slate-900 text-emerald-400 flex items-center justify-center">
                  <KeyRound className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">Two-Factor Authentication (2FA)</h3>
                  <p className="text-xs text-slate-500">Required for high-value transfers & wire authorizations</p>
                </div>
              </div>

              <button
                onClick={() => setTwoFactorEnabled(!twoFactorEnabled)}
                className={`w-12 h-6 rounded-full transition-colors relative ${
                  twoFactorEnabled ? 'bg-emerald-600' : 'bg-slate-300'
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-white transition-transform transform shadow-xs ${
                    twoFactorEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-center justify-between">
              <span className="font-medium">Primary Method:</span>
              <span className="font-mono text-slate-900 font-bold">FIDO2 / Authenticator App (TOTP)</span>
            </div>
          </div>

          {/* Active Sessions */}
          <div className="p-6 rounded-3xl bg-white border border-slate-200/90 shadow-2xs space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-900 flex items-center justify-center">
                  <Laptop className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">Authorized Active Sessions</h3>
                  <p className="text-xs text-slate-500">Devices currently authenticated to your account</p>
                </div>
              </div>
            </div>

            <div className="space-y-3 pt-2">
              {sessions.map((s) => (
                <div
                  key={s.id}
                  className="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 font-bold text-slate-900">
                      <span>{s.device}</span>
                      {s.current && (
                        <span className="text-[10px] text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded font-mono">
                          This Device
                        </span>
                      )}
                    </div>
                    <div className="text-slate-500 font-mono text-[11px]">{s.ip} • {s.lastActive}</div>
                  </div>

                  {!s.current && (
                    <button
                      onClick={() => handleTerminateSession(s.id)}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 transition-colors"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* Right Column: Ledger Proof & Compliance */}
        <div className="space-y-6">
          <div className="p-6 rounded-3xl bg-gradient-to-br from-slate-900 to-slate-950 text-white shadow-xl space-y-4">
            <div className="w-10 h-10 rounded-xl bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5" />
            </div>

            <h3 className="font-bold text-base text-white">Cryptographic Sentinel</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Every balance update is protected by mathematical double-entry assertions. No funds can be minted or destroyed without audit confirmation.
            </p>

            <div className="pt-2 border-t border-slate-800 space-y-2 text-xs font-mono">
              <div className="flex justify-between text-slate-400">
                <span>Encryption:</span>
                <span className="text-white">AES-256 GCM</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>TLS Protocol:</span>
                <span className="text-emerald-400">v1.3 Strict</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Ledger Invariance:</span>
                <span className="text-emerald-400">100.0% Verified</span>
              </div>
            </div>
          </div>
        </div>

      </div>

    </div>
  );
};
