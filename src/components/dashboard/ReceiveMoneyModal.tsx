import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { X, Copy, Check, QrCode, ShieldCheck, Share2, Landmark } from 'lucide-react';

export const ReceiveMoneyModal: React.FC = () => {
  const { activeModal, closeModal, currentUser } = useAuth();
  const [copiedField, setCopiedField] = useState<string | null>(null);

  if (activeModal !== 'receive' || !currentUser) return null;

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const qrData = `monvera://pay?account=${currentUser.permanentAccountNumber}&name=${encodeURIComponent(
    currentUser.firstName + ' ' + currentUser.lastName
  )}`;

  return (
    <div
      id="receive-money-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeModal();
      }}
    >
      <div
        id="receive-money-modal-container"
        className="w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden relative max-h-[92vh] flex flex-col"
      >
        {/* Header */}
        <div className="p-6 sm:p-7 bg-slate-50 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-900 text-emerald-400 flex items-center justify-center font-bold">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">Receive Money</h2>
              <p className="text-xs text-slate-500 font-mono">Your Permanent Monvera Credentials</p>
            </div>
          </div>
          <button
            onClick={closeModal}
            className="w-8 h-8 rounded-full bg-white hover:bg-slate-200 text-slate-500 flex items-center justify-center border border-slate-200 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 sm:p-8 overflow-y-auto flex-1 space-y-6">
          
          {/* QR Code & Account Visual Card */}
          <div className="p-6 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 text-white text-center space-y-4 shadow-xl">
            <div className="inline-block p-3 bg-white rounded-2xl shadow-md">
              {/* Responsive SVG QR Code Simulation */}
              <svg className="w-36 h-36 mx-auto" viewBox="0 0 100 100" fill="none">
                <rect width="100" height="100" fill="#ffffff" />
                {/* Corner markers */}
                <rect x="10" y="10" width="24" height="24" fill="#0f172a" rx="4" />
                <rect x="14" y="14" width="16" height="16" fill="#ffffff" rx="2" />
                <rect x="18" y="18" width="8" height="8" fill="#059669" />

                <rect x="66" y="10" width="24" height="24" fill="#0f172a" rx="4" />
                <rect x="70" y="14" width="16" height="16" fill="#ffffff" rx="2" />
                <rect x="74" y="18" width="8" height="8" fill="#059669" />

                <rect x="10" y="66" width="24" height="24" fill="#0f172a" rx="4" />
                <rect x="14" y="70" width="16" height="16" fill="#ffffff" rx="2" />
                <rect x="18" y="74" width="8" height="8" fill="#059669" />

                {/* Pattern blocks */}
                <rect x="42" y="12" width="6" height="6" fill="#0f172a" />
                <rect x="52" y="12" width="6" height="6" fill="#0f172a" />
                <rect x="42" y="24" width="6" height="6" fill="#0f172a" />
                <rect x="52" y="30" width="6" height="6" fill="#059669" />
                <rect x="12" y="42" width="6" height="6" fill="#0f172a" />
                <rect x="24" y="48" width="6" height="6" fill="#0f172a" />
                <rect x="42" y="42" width="16" height="16" fill="#0f172a" rx="2" />
                <rect x="66" y="42" width="6" height="6" fill="#0f172a" />
                <rect x="78" y="48" width="6" height="6" fill="#059669" />
                <rect x="42" y="66" width="6" height="6" fill="#0f172a" />
                <rect x="52" y="78" width="6" height="6" fill="#0f172a" />
                <rect x="66" y="66" width="8" height="8" fill="#0f172a" />
                <rect x="80" y="76" width="8" height="8" fill="#0f172a" />
              </svg>
            </div>

            <div>
              <div className="text-xs uppercase font-mono tracking-widest text-emerald-400">
                Monvera Direct Pay QR
              </div>
              <div className="text-lg font-black text-white">
                {currentUser.firstName} {currentUser.lastName}
              </div>
              <div className="text-xs text-emerald-400/90 font-mono font-bold mt-0.5">
                @{currentUser.username || 'user'} • Acc {currentUser.permanentAccountNumber}
              </div>
            </div>
          </div>

          {/* Account Credential Blocks */}
          <div className="space-y-3">
            {/* Monvera Username */}
            <div className="p-4 rounded-2xl bg-emerald-50 border-2 border-emerald-300 flex items-center justify-between shadow-xs">
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-emerald-800 block font-mono">
                  Monvera Username (Instant Peer Transfers)
                </span>
                <span className="text-lg font-mono font-black text-emerald-950">
                  @{currentUser.username || 'user'}
                </span>
              </div>
              <button
                onClick={() => copyToClipboard(`@${currentUser.username || 'user'}`, 'user')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-black text-emerald-900 bg-white hover:bg-emerald-100 border border-emerald-300 transition-colors shadow-xs cursor-pointer"
              >
                {copiedField === 'user' ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                <span>{copiedField === 'user' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            {/* Permanent Account Number */}
            <div className="p-4 rounded-2xl bg-slate-50 border-2 border-slate-200 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 block font-mono">
                  Permanent Monvera Account Number
                </span>
                <span className="text-lg font-mono font-black text-slate-900">
                  {currentUser.permanentAccountNumber}
                </span>
              </div>
              <button
                onClick={() => copyToClipboard(currentUser.permanentAccountNumber, 'acc')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-black text-slate-800 bg-white hover:bg-slate-100 border border-slate-300 transition-colors shadow-xs cursor-pointer"
              >
                {copiedField === 'acc' ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                <span>{copiedField === 'acc' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            {/* Routing Number */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                  ACH & FedWire Routing Number (MVB NY)
                </span>
                <span className="text-sm font-mono font-bold text-slate-900">
                  021000021
                </span>
              </div>
              <button
                onClick={() => copyToClipboard('021000021', 'route')}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 transition-colors shadow-2xs"
              >
                {copiedField === 'route' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedField === 'route' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            {/* SWIFT / BIC */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                  SWIFT / BIC (International Inbound)
                </span>
                <span className="text-sm font-mono font-bold text-slate-900">
                  MONVUS33
                </span>
              </div>
              <button
                onClick={() => copyToClipboard('MONVUS33', 'swift')}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 transition-colors shadow-2xs"
              >
                {copiedField === 'swift' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedField === 'swift' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          <div className="pt-2">
            <button
              onClick={() => {
                const text = `Monvera Banking Details:\nName: ${currentUser.firstName} ${currentUser.lastName}\nAccount: ${currentUser.permanentAccountNumber}\nRouting: 021000021\nBank: Monvera (MVB)`;
                copyToClipboard(text, 'all');
              }}
              className="w-full py-3.5 rounded-xl font-bold text-sm text-white bg-slate-900 hover:bg-slate-800 transition-colors shadow-md flex items-center justify-center gap-2"
            >
              <Share2 className="w-4 h-4 text-emerald-400" />
              <span>{copiedField === 'all' ? 'Details Copied to Clipboard!' : 'Share Complete Wire / ACH Details'}</span>
            </button>
          </div>

        </div>
      </div>
    </div>
  );
};
