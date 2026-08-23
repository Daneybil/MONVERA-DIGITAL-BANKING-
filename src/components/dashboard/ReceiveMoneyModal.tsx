import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { X, Copy, Check, QrCode, Share2, Download, AtSign, ShieldCheck, User } from 'lucide-react';
import QRCode from 'qrcode';

export const ReceiveMoneyModal: React.FC = () => {
  const { activeModal, closeModal, currentUser } = useAuth();
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [isGeneratingQr, setIsGeneratingQr] = useState<boolean>(true);

  // Automatically derive clean username from user's first name if not set
  const derivedUsername =
    currentUser?.username ||
    (currentUser?.firstName
      ? currentUser.firstName.trim().split(' ')[0].toLowerCase().replace(/[^a-z0-9_]/g, '')
      : 'user');

  const fullName = currentUser ? `${currentUser.firstName} ${currentUser.lastName}`.trim() : '';

  useEffect(() => {
    if (currentUser && activeModal === 'receive') {
      setIsGeneratingQr(true);
      
      // Standard Monvera Direct Pay QR payload format
      const qrPayload = JSON.stringify({
        app: 'monvera',
        version: '1.0',
        username: derivedUsername,
        accountNumber: currentUser.permanentAccountNumber,
        name: fullName,
        action: 'pay',
      });

      QRCode.toDataURL(qrPayload, {
        width: 360,
        margin: 2,
        color: {
          dark: '#022c22', // Deep emerald dark
          light: '#ffffff',
        },
        errorCorrectionLevel: 'H',
      })
        .then((url) => {
          setQrDataUrl(url);
          setIsGeneratingQr(false);
        })
        .catch((err) => {
          console.error('Failed to generate QR Code:', err);
          setIsGeneratingQr(false);
        });
    }
  }, [currentUser, activeModal, derivedUsername, fullName]);

  if (activeModal !== 'receive' || !currentUser) return null;

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleDownloadQr = () => {
    if (!qrDataUrl) return;
    const link = document.createElement('a');
    link.href = qrDataUrl;
    link.download = `Monvera-QR-${derivedUsername}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div
      id="receive-money-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-md animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeModal();
      }}
    >
      <div
        id="receive-money-modal-container"
        className="w-full max-w-lg bg-white rounded-3xl shadow-2xl border-2 border-slate-200 overflow-hidden relative max-h-[92vh] flex flex-col"
      >
        {/* Header */}
        <div className="p-6 sm:p-7 bg-slate-50 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-slate-950 text-emerald-400 flex items-center justify-center font-black shadow-sm">
              <QrCode className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-950">Receive Money</h2>
              <p className="text-xs text-slate-600 font-mono font-bold">Your Monvera Username & QR Code</p>
            </div>
          </div>
          <button
            onClick={closeModal}
            className="w-9 h-9 rounded-full bg-white hover:bg-slate-200 text-slate-600 hover:text-slate-950 flex items-center justify-center border border-slate-200 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 sm:p-8 overflow-y-auto flex-1 space-y-6">
          
          {/* Branded QR Code Card */}
          <div className="p-6 rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 text-white text-center space-y-4 shadow-xl border-2 border-emerald-500/40 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-36 h-36 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />
            
            <div className="inline-block p-4 bg-white rounded-3xl shadow-2xl border-4 border-emerald-400/80 relative">
              {isGeneratingQr ? (
                <div className="w-48 h-48 flex flex-col items-center justify-center gap-2">
                  <div className="w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs font-mono font-bold text-slate-600">Generating QR...</span>
                </div>
              ) : qrDataUrl ? (
                <div className="relative group">
                  <img
                    src={qrDataUrl}
                    alt={`Monvera QR Code for @${derivedUsername}`}
                    className="w-48 h-48 rounded-xl object-contain mx-auto"
                  />
                  {/* Subtle Center Monvera Badge */}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-10 h-10 rounded-xl bg-slate-950 text-emerald-400 flex items-center justify-center font-black text-xs border-2 border-emerald-400 shadow-md">
                      MV
                    </div>
                  </div>
                </div>
              ) : (
                <div className="w-48 h-48 flex items-center justify-center bg-slate-100 rounded-xl text-slate-500 text-xs font-mono">
                  QR Code Unavailable
                </div>
              )}
            </div>

            <div className="space-y-1">
              <span className="text-[11px] uppercase font-mono tracking-widest text-emerald-400 font-black block">
                Instant Monvera Transfer QR
              </span>
              <h3 className="text-xl font-black text-white">{fullName}</h3>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-950/80 border border-emerald-500/60 text-emerald-300 font-mono font-bold text-xs mt-1">
                <span>@{derivedUsername}</span>
                <span>•</span>
                <span>Acc {currentUser.permanentAccountNumber}</span>
              </div>
            </div>

            <p className="text-xs text-slate-300 font-medium max-w-xs mx-auto">
              Other Monvera users can scan this QR code or send directly to your username to transfer funds instantly.
            </p>
          </div>

          {/* Account Credential Blocks */}
          <div className="space-y-3.5">
            {/* Monvera Username */}
            <div className="p-4 sm:p-5 rounded-2xl bg-emerald-50 border-2 border-emerald-400 flex items-center justify-between shadow-xs">
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <AtSign className="w-3.5 h-3.5 text-emerald-800" />
                  <span className="text-[11px] font-black uppercase tracking-wider text-emerald-900 font-mono">
                    Monvera Username
                  </span>
                </div>
                <span className="text-xl font-mono font-black text-emerald-950 block">
                  @{derivedUsername}
                </span>
                <span className="text-[11px] text-emerald-700 font-semibold block">
                  Auto-assigned from your name for peer transfers
                </span>
              </div>
              <button
                onClick={() => copyToClipboard(`@${derivedUsername}`, 'user')}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-black text-emerald-950 bg-white hover:bg-emerald-100 border-2 border-emerald-400 transition-colors shadow-xs cursor-pointer"
              >
                {copiedField === 'user' ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                <span>{copiedField === 'user' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            {/* Permanent Account Number */}
            <div className="p-4 sm:p-5 rounded-2xl bg-slate-50 border-2 border-slate-300 flex items-center justify-between shadow-xs">
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-slate-700" />
                  <span className="text-[11px] font-black uppercase tracking-wider text-slate-700 font-mono">
                    Permanent Account Number
                  </span>
                </div>
                <span className="text-xl font-mono font-black text-slate-950 block">
                  {currentUser.permanentAccountNumber}
                </span>
                <span className="text-[11px] text-slate-500 font-semibold block">
                  Your primary 10-digit Monvera account identifier
                </span>
              </div>
              <button
                onClick={() => copyToClipboard(currentUser.permanentAccountNumber, 'acc')}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-black text-slate-900 bg-white hover:bg-slate-100 border-2 border-slate-300 transition-colors shadow-xs cursor-pointer"
              >
                {copiedField === 'acc' ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                <span>{copiedField === 'acc' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <button
              onClick={handleDownloadQr}
              disabled={!qrDataUrl}
              className="py-3.5 px-4 rounded-2xl font-black text-xs text-slate-900 bg-slate-100 hover:bg-slate-200 border-2 border-slate-300 transition-colors shadow-xs flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <Download className="w-4 h-4 text-slate-700" />
              <span>Download QR Image</span>
            </button>

            <button
              onClick={() => {
                const text = `Send money to ${fullName} on Monvera:\nUsername: @${derivedUsername}\nAccount: ${currentUser.permanentAccountNumber}`;
                copyToClipboard(text, 'share');
              }}
              className="py-3.5 px-4 rounded-2xl font-black text-xs text-white bg-slate-950 hover:bg-slate-800 transition-colors shadow-md flex items-center justify-center gap-2 cursor-pointer"
            >
              <Share2 className="w-4 h-4 text-emerald-400" />
              <span>{copiedField === 'share' ? 'Payment Info Copied!' : 'Copy Payment Info'}</span>
            </button>
          </div>

        </div>
      </div>
    </div>
  );
};

