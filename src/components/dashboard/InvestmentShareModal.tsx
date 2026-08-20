import React, { useState, useRef } from 'react';
import { InvestmentPlan, UserProfile } from '../../types';
import {
  Share2,
  X,
  Copy,
  Check,
  MessageCircle,
  Send,
  ExternalLink,
  ShieldCheck,
  TrendingUp,
  Download,
  Calendar,
  Clock,
  Lock,
  Building2,
  Sparkles,
  FileCheck,
} from 'lucide-react';
import { toPng, toBlob } from 'html-to-image';

interface InvestmentShareModalProps {
  investment: InvestmentPlan;
  user: UserProfile;
  onClose: () => void;
}

export const InvestmentShareModal: React.FC<InvestmentShareModalProps> = ({
  investment,
  user,
  onClose,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [copiedText, setCopiedText] = useState<boolean>(false);
  const [copiedImage, setCopiedImage] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const startDate = new Date(investment.startDate);
  const maturityDate = new Date(investment.maturityDate);
  const dailyYield = Number((investment.amount * 0.045).toFixed(2));
  const certNumber = `MON-INV-${investment.id.replace(/[^a-zA-Z0-9]/g, '').slice(-8).toUpperCase()}`;
  const isActive = investment.status === 'ACTIVE';

  const shareText = `💰 Monvera Term Investment Certificate:
Investor: ${user.name}
Plan: ${investment.termDays} Days Term (4.50% / 24 Hours)
Principal Locked: $${investment.amount.toLocaleString()} USD
Daily Earnings: +$${dailyYield.toLocaleString()}/day
Maturity Value: $${investment.expectedMaturityValue.toLocaleString()} USD
Status: ${isActive ? 'Active & Accruing' : 'Matured & Settled'}
Certificate Ref: ${certNumber}
Official Portal: ${window.location.origin}`;

  // Helper to generate Image Blob
  const getImageBlob = async (): Promise<Blob | null> => {
    if (!cardRef.current) return null;
    return await toBlob(cardRef.current, {
      cacheBust: true,
      pixelRatio: 2.5,
      backgroundColor: '#020617',
    });
  };

  // Direct PNG Image Download
  const handleDownloadImage = async () => {
    if (!cardRef.current) return;
    setIsProcessing(true);
    try {
      const dataUrl = await toPng(cardRef.current, {
        cacheBust: true,
        pixelRatio: 3,
        backgroundColor: '#020617',
      });
      const link = document.createElement('a');
      link.download = `Monvera-Investment-Card-${certNumber}.png`;
      link.href = dataUrl;
      link.click();
      setStatusMsg('Certificate image downloaded to your device!');
      setTimeout(() => setStatusMsg(null), 4000);
    } catch (err) {
      console.error('Error downloading image', err);
    } finally {
      setIsProcessing(false);
    }
  };

  // Copy Image to Clipboard
  const handleCopyImage = async () => {
    setIsProcessing(true);
    try {
      const blob = await getImageBlob();
      if (blob && navigator.clipboard && (window as any).ClipboardItem) {
        await navigator.clipboard.write([
          new (window as any).ClipboardItem({ 'image/png': blob }),
        ]);
        setCopiedImage(true);
        setStatusMsg('Certificate image copied! You can paste (Ctrl+V) directly into WhatsApp, Telegram, or Discord.');
        setTimeout(() => {
          setCopiedImage(false);
          setStatusMsg(null), 5000;
        });
      } else {
        await handleDownloadImage();
      }
    } catch (err) {
      await handleDownloadImage();
    } finally {
      setIsProcessing(false);
    }
  };

  // Share Image File via Native Share or WhatsApp
  const handleShareAsImage = async () => {
    setIsProcessing(true);
    try {
      const blob = await getImageBlob();
      if (!blob) throw new Error('Blob creation failed');

      const file = new File([blob], `Monvera-Investment-${certNumber}.png`, { type: 'image/png' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `Monvera Investment Certificate - ${user.name}`,
          text: `Monvera ${investment.termDays}-Day Term Investment Certificate for ${user.name}`,
        });
        setStatusMsg('Image shared successfully!');
        setTimeout(() => setStatusMsg(null), 3500);
      } else {
        // Automatically download image and open WhatsApp
        await handleDownloadImage();
        const whatsappMsg = `💰 Monvera Term Investment for *${user.name}*:
• Capital: *$${investment.amount.toLocaleString()} USD*
• Term: *${investment.termDays} Days (4.50% / 24h)*
• Maturity Value: *$${investment.expectedMaturityValue.toLocaleString()} USD*
• Certificate Ref: *${certNumber}*
(Certificate Image has been downloaded to your device to attach)`;
        window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(whatsappMsg)}`, '_blank');
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('Share error', err);
        await handleDownloadImage();
      }
    } finally {
      setIsProcessing(false);
    }
  };

  // WhatsApp Button Click Handler
  const handleWhatsAppShare = async () => {
    setIsProcessing(true);
    try {
      const blob = await getImageBlob();
      if (blob) {
        const file = new File([blob], `Monvera-Investment-${certNumber}.png`, { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: `Monvera Investment - ${user.name}`,
            text: `Monvera Term Investment Certificate: $${investment.amount.toLocaleString()} for ${investment.termDays} Days (4.50% / 24h).`,
          });
          return;
        }
      }
      // If native file share not supported (e.g. desktop), download the image first so they can drag & drop it, then open WhatsApp
      await handleDownloadImage();
      const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`;
      window.open(whatsappUrl, '_blank');
    } catch (err) {
      const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`;
      window.open(whatsappUrl, '_blank');
    } finally {
      setIsProcessing(false);
    }
  };

  // Telegram Button Click Handler
  const handleTelegramShare = async () => {
    await handleDownloadImage();
    const telegramUrl = `https://t.me/share/url?url=${encodeURIComponent(window.location.origin)}&text=${encodeURIComponent(shareText)}`;
    window.open(telegramUrl, '_blank');
  };

  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopiedText(true);
      setTimeout(() => setCopiedText(false), 2500);
    } catch (err) {
      // Fallback
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/85 backdrop-blur-md overflow-y-auto animate-in fade-in">
      <div className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl border-3 border-slate-300 overflow-hidden my-auto max-h-[95vh] flex flex-col">
        
        {/* Header Bar */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-950 text-white border-b-2 border-slate-800 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-400 flex items-center justify-center text-emerald-400">
              <Share2 className="w-5 h-5" />
            </div>
            <div>
              <span className="font-mono font-black text-sm uppercase tracking-wider text-emerald-300 block">
                Share Investment Certificate
              </span>
              <span className="text-[11px] text-slate-400 font-mono">
                Investor: <strong className="text-white">{user.name}</strong>
              </span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Feedback Alert */}
        {statusMsg && (
          <div className="px-6 py-3 bg-emerald-100 border-b-2 border-emerald-400 text-emerald-950 text-xs sm:text-sm font-extrabold flex items-center gap-2 animate-in fade-in flex-shrink-0">
            <Check className="w-4 h-4 text-emerald-700 flex-shrink-0" />
            <span>{statusMsg}</span>
          </div>
        )}

        {/* Visual Shareable Certificate Card (Converted into Image) */}
        <div className="overflow-y-auto p-4 sm:p-6 flex-1 bg-slate-100 space-y-5">
          
          <div
            ref={cardRef}
            id="shareable-investment-image-card"
            className="p-6 sm:p-8 rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 text-white border-3 border-emerald-500 shadow-2xl space-y-5 relative overflow-hidden"
          >
            {/* Top Seal & Plan Label */}
            <div className="flex items-center justify-between border-b-2 border-slate-700 pb-4">
              <div className="space-y-0.5">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-950 border border-emerald-400 text-[11px] font-mono font-black text-emerald-300 uppercase">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Monvera Sovereign Treasury Certificate</span>
                </div>
                <h3 className="text-2xl sm:text-3xl font-black text-white tracking-tight mt-1">
                  {investment.planName}
                </h3>
              </div>

              <div className="text-right bg-slate-900 px-3.5 py-2 rounded-xl border-2 border-emerald-400 shadow-inner">
                <span className="text-2xl font-black font-mono text-emerald-400 block">4.50%</span>
                <span className="text-[9px] uppercase font-mono font-black text-slate-300 block">
                  Every 24 Hours
                </span>
              </div>
            </div>

            {/* Investor Full Name & Meta Box */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4 rounded-2xl bg-slate-900/90 border border-slate-700 text-xs font-mono">
              <div>
                <span className="text-slate-400 text-[10px] uppercase font-bold block">Investor Name</span>
                <span className="font-black text-white text-sm block">{user.name}</span>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] uppercase font-bold block">Customer ID</span>
                <span className="font-black text-white text-sm block">{user.id}</span>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] uppercase font-bold block">Investment Status</span>
                <span
                  className={`font-black inline-block px-2 py-0.5 rounded-md text-[11px] mt-0.5 border ${
                    isActive
                      ? 'bg-amber-950 text-amber-300 border-amber-500'
                      : 'bg-emerald-950 text-emerald-300 border-emerald-500'
                  }`}
                >
                  {isActive ? 'ACTIVE & ACCRUING' : 'MATURED & SETTLED'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] uppercase font-bold block">Deposit Date & Time</span>
                <span className="font-black text-slate-200 text-xs block">
                  {startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
                <span className="text-[10px] text-slate-400">
                  {startDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] uppercase font-bold block">Maturity Date & Time</span>
                <span className="font-black text-slate-200 text-xs block">
                  {maturityDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
                <span className="text-[10px] text-slate-400">
                  {maturityDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div>
                <span className="text-slate-400 text-[10px] uppercase font-bold block">Term Period</span>
                <span className="font-black text-emerald-400 text-sm block">{investment.termDays} Days</span>
              </div>
            </div>

            {/* Financial Highlights */}
            <div className="space-y-3 font-mono">
              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-700 flex items-center justify-between">
                <div>
                  <span className="text-[10px] uppercase font-black tracking-wider text-slate-400 block">
                    Principal Deposited
                  </span>
                  <span className="text-2xl sm:text-3xl font-black text-white">
                    ${investment.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] uppercase font-black tracking-wider text-slate-400 block">
                    Daily Profit (24h)
                  </span>
                  <span className="text-lg sm:text-xl font-black text-emerald-400">
                    +${dailyYield.toLocaleString('en-US', { minimumFractionDigits: 2 })}/day
                  </span>
                </div>
              </div>

              {/* Total Guaranteed Value at Maturity */}
              <div className="p-4 sm:p-5 rounded-2xl bg-emerald-950 border-2 border-emerald-400 space-y-1">
                <span className="text-[10px] uppercase tracking-wider font-black text-emerald-300 block">
                  Guaranteed Payout at Maturity
                </span>
                <div className="text-3xl sm:text-4xl font-black text-white font-mono">
                  ${investment.expectedMaturityValue.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD
                </div>
                <span className="text-[11px] text-emerald-200 font-bold block">
                  Principal (${investment.amount.toLocaleString()}) + Total Fixed Profits (${investment.expectedYield.toLocaleString()})
                </span>
              </div>
            </div>

            {/* Certificate Footer */}
            <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 pt-2 border-t border-slate-800">
              <div className="flex items-center gap-1 text-slate-300 font-bold">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Monvera Bank Treasury Guarantee</span>
              </div>
              <span>Ref: {certNumber}</span>
            </div>

          </div>

          {/* Sharing Action Channels (WhatsApp, Telegram, Device Share) */}
          <div className="p-5 rounded-2xl bg-white border-2 border-slate-300 shadow-md space-y-4">
            <label className="block text-xs font-mono font-black text-slate-800 uppercase tracking-wider">
              Share as High-Resolution Image File
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* WhatsApp Button */}
              <button
                onClick={handleWhatsAppShare}
                disabled={isProcessing}
                className="flex items-center justify-center gap-2 py-3.5 px-4 rounded-2xl bg-[#25D366] hover:bg-[#20ba5a] text-white font-black text-sm shadow-lg active:translate-y-0.5 transition-all cursor-pointer select-none"
              >
                <MessageCircle className="w-5 h-5" />
                <span>Share Image on WhatsApp</span>
              </button>

              {/* Native Device Share (Sends Image File) */}
              <button
                onClick={handleShareAsImage}
                disabled={isProcessing}
                className="flex items-center justify-center gap-2 py-3.5 px-4 rounded-2xl bg-gradient-to-b from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white font-black text-sm shadow-lg active:translate-y-0.5 transition-all cursor-pointer select-none"
              >
                <Share2 className="w-5 h-5" />
                <span>Send Image File</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Telegram Button */}
              <button
                onClick={handleTelegramShare}
                disabled={isProcessing}
                className="flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-[#0088cc] hover:bg-[#0077b5] text-white font-black text-sm shadow-md transition-all cursor-pointer select-none"
              >
                <Send className="w-4 h-4" />
                <span>Share on Telegram</span>
              </button>

              {/* Download PNG Button */}
              <button
                onClick={handleDownloadImage}
                disabled={isProcessing}
                className="flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-black text-sm shadow-md transition-all cursor-pointer select-none"
              >
                <Download className="w-4 h-4 text-emerald-400" />
                <span>Download Image (PNG)</span>
              </button>
            </div>

            {/* Copy Options */}
            <div className="pt-2 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <button
                onClick={handleCopyImage}
                disabled={isProcessing}
                className="inline-flex items-center gap-1.5 text-xs font-mono font-black text-slate-700 hover:text-slate-950 transition-colors cursor-pointer"
              >
                {copiedImage ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                <span>{copiedImage ? 'Image Copied to Clipboard!' : 'Copy Image to Clipboard (Paste in Chat)'}</span>
              </button>

              <button
                onClick={handleCopyText}
                className="inline-flex items-center gap-1.5 text-xs font-mono font-black text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
              >
                {copiedText ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedText ? 'Text Copied' : 'Copy Text'}</span>
              </button>
            </div>

          </div>

        </div>

      </div>
    </div>
  );
};
