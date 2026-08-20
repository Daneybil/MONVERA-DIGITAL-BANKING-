import React, { useRef, useState } from 'react';
import { InvestmentPlan, UserProfile } from '../../types';
import {
  ShieldCheck,
  Printer,
  Download,
  X,
  CheckCircle2,
  Calendar,
  Clock,
  Lock,
  Sparkles,
  Building2,
  FileCheck,
  Share2,
  Copy,
  Check,
  ExternalLink,
  MessageCircle,
  QrCode,
  Image as ImageIcon,
} from 'lucide-react';
import { toPng, toBlob } from 'html-to-image';

interface InvestmentReceiptModalProps {
  investment: InvestmentPlan;
  user: UserProfile;
  onClose: () => void;
}

export const InvestmentReceiptModal: React.FC<InvestmentReceiptModalProps> = ({
  investment,
  user,
  onClose,
}) => {
  const receiptRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [copiedImage, setCopiedImage] = useState<boolean>(false);
  const [shareSuccess, setShareSuccess] = useState<string | null>(null);

  const startDate = new Date(investment.startDate);
  const maturityDate = new Date(investment.maturityDate);
  const dailyYield = Number((investment.amount * 0.045).toFixed(2));
  const certNumber = `MON-INV-${investment.id.replace(/[^a-zA-Z0-9]/g, '').slice(-8).toUpperCase()}`;

  const isActive = investment.status === 'ACTIVE';
  const totalDurationMs = maturityDate.getTime() - startDate.getTime();
  const elapsedMs = Math.max(0, Date.now() - startDate.getTime());
  const progressPercent = isActive ? Math.min(100, Math.round((elapsedMs / totalDurationMs) * 100)) : 100;
  const daysRemaining = isActive ? Math.max(0, Math.ceil((maturityDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : 0;

  // Print trigger
  const handlePrint = () => {
    window.print();
  };

  // Generate Image Blob / Data URL
  const generateReceiptImageBlob = async (): Promise<Blob | null> => {
    if (!receiptRef.current) return null;
    try {
      const blob = await toBlob(receiptRef.current, {
        cacheBust: true,
        pixelRatio: 2.5,
        backgroundColor: '#ffffff',
      });
      return blob;
    } catch (err) {
      console.error('Failed to generate image blob', err);
      return null;
    }
  };

  // Download High-Resolution PNG Image
  const handleDownloadImage = async () => {
    if (!receiptRef.current) return;
    setIsGenerating(true);
    try {
      const dataUrl = await toPng(receiptRef.current, {
        cacheBust: true,
        pixelRatio: 3,
        backgroundColor: '#ffffff',
      });
      const link = document.createElement('a');
      link.download = `Monvera-Investment-Receipt-${certNumber}.png`;
      link.href = dataUrl;
      link.click();
      setShareSuccess('Receipt image successfully downloaded!');
      setTimeout(() => setShareSuccess(null), 4000);
    } catch (err) {
      console.error('Error downloading image', err);
    } finally {
      setIsGenerating(false);
    }
  };

  // Copy Image to Clipboard
  const handleCopyImage = async () => {
    setIsGenerating(true);
    try {
      const blob = await generateReceiptImageBlob();
      if (blob && navigator.clipboard && (window as any).ClipboardItem) {
        await navigator.clipboard.write([
          new (window as any).ClipboardItem({ 'image/png': blob }),
        ]);
        setCopiedImage(true);
        setShareSuccess('Receipt image copied to clipboard! You can now paste (Ctrl+V) directly into WhatsApp or any chat.');
        setTimeout(() => {
          setCopiedImage(false);
          setShareSuccess(null);
        }, 5000);
      } else {
        // Fallback to downloading image
        await handleDownloadImage();
      }
    } catch (err) {
      console.error('Error copying image', err);
      await handleDownloadImage();
    } finally {
      setIsGenerating(false);
    }
  };

  // Share as Image via Native Share or WhatsApp
  const handleShareImage = async () => {
    setIsGenerating(true);
    try {
      const blob = await generateReceiptImageBlob();
      if (!blob) throw new Error('Image generation failed');

      const file = new File([blob], `Monvera-Receipt-${certNumber}.png`, { type: 'image/png' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `Monvera Investment Certificate - ${user.name}`,
          text: `Official Monvera Term Investment Certificate for ${user.name}. ${investment.termDays} Days at 4.50% interest every 24 hours.`,
        });
        setShareSuccess('Shared successfully!');
        setTimeout(() => setShareSuccess(null), 3000);
      } else {
        // Automatically download image and open WhatsApp
        await handleDownloadImage();
        const shareMsg = `💰 Official Monvera Investment Certificate for ${user.name}:
Plan: ${investment.termDays} Days Term (4.50% / 24 Hours)
Principal: $${investment.amount.toLocaleString()} USD
Maturity Value: $${investment.expectedMaturityValue.toLocaleString()} USD
Certificate No: ${certNumber}
(Receipt Image has been downloaded to your device - attach it to this chat)`;
        window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(shareMsg)}`, '_blank');
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('Share error', err);
        await handleDownloadImage();
      }
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/85 backdrop-blur-md overflow-y-auto animate-in fade-in">
      <div className="relative w-full max-w-3xl bg-white rounded-3xl shadow-2xl border-3 border-slate-300 overflow-hidden my-auto max-h-[95vh] flex flex-col">
        
        {/* Header Action Bar */}
        <div className="flex flex-wrap items-center justify-between px-6 py-4 bg-slate-950 text-white border-b-2 border-slate-800 gap-3 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-400 flex items-center justify-center text-emerald-400">
              <FileCheck className="w-5 h-5" />
            </div>
            <div>
              <span className="font-mono font-black text-sm uppercase tracking-wider text-emerald-300 block">
                Official Investment Certificate
              </span>
              <span className="text-[11px] text-slate-400 font-mono">
                Issued to: <strong className="text-white">{user.name}</strong>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-black text-xs transition-colors cursor-pointer border border-slate-700"
              title="Print Certificate"
            >
              <Printer className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Print</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Feedback Alert if Action Triggered */}
        {shareSuccess && (
          <div className="px-6 py-3 bg-emerald-100 border-b-2 border-emerald-400 text-emerald-950 text-xs sm:text-sm font-extrabold flex items-center gap-2 animate-in fade-in flex-shrink-0">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 flex-shrink-0" />
            <span>{shareSuccess}</span>
          </div>
        )}

        {/* Certificate Body (Printable & Exportable to Image) */}
        <div className="overflow-y-auto p-4 sm:p-8 flex-1 bg-slate-100">
          
          <div
            ref={receiptRef}
            id="printable-investment-certificate"
            className="p-6 sm:p-10 space-y-6 text-slate-900 bg-white rounded-3xl border-3 border-slate-300 shadow-xl relative overflow-hidden"
          >
            {/* Watermark Crest */}
            <div className="absolute right-[-40px] top-[-40px] opacity-[0.03] pointer-events-none select-none">
              <ShieldCheck className="w-96 h-96 text-slate-900" />
            </div>

            {/* Certificate Header Banner */}
            <div className="border-b-3 border-slate-900 pb-6 text-center space-y-3 relative z-10">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-100 text-emerald-950 border-2 border-emerald-500 text-xs font-black uppercase tracking-wider shadow-sm">
                <ShieldCheck className="w-4 h-4 text-emerald-700" />
                <span>Monvera Sovereign Treasury Bond • Official Certificate</span>
              </div>
              <h2 className="text-3xl sm:text-4xl font-black text-slate-950 tracking-tight uppercase">
                Fixed Term Deposit Certificate
              </h2>
              <div className="flex flex-wrap items-center justify-center gap-3 text-xs font-mono font-bold text-slate-600">
                <span>Certificate No: <strong className="text-slate-950">{certNumber}</strong></span>
                <span>•</span>
                <span>Institution: <strong className="text-slate-950">Monvera Digital Bank N.A.</strong></span>
              </div>
            </div>

            {/* Investor & Account Meta Grid (With Exact Investor Name) */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 p-5 rounded-2xl bg-slate-50 border-2 border-slate-300 text-xs font-mono relative z-10">
              <div>
                <span className="text-slate-500 block uppercase font-bold text-[10px]">Investor Full Name</span>
                <span className="font-black text-slate-950 text-sm sm:text-base">{user.name}</span>
              </div>
              <div>
                <span className="text-slate-500 block uppercase font-bold text-[10px]">Account / Customer ID</span>
                <span className="font-black text-slate-950 text-sm sm:text-base">{user.id}</span>
              </div>
              <div>
                <span className="text-slate-500 block uppercase font-bold text-[10px]">Investment Status</span>
                <span
                  className={`font-black inline-block px-2.5 py-1 rounded-lg text-xs mt-0.5 border ${
                    isActive
                      ? 'bg-amber-100 text-amber-950 border-amber-500'
                      : 'bg-emerald-100 text-emerald-950 border-emerald-500'
                  }`}
                >
                  {isActive ? 'ACTIVE & ACCRUING' : 'MATURED & SETTLED'}
                </span>
              </div>

              {/* Exact Accurate Deposit Date & Time */}
              <div>
                <span className="text-slate-500 block uppercase font-bold text-[10px]">Deposit Date & Time</span>
                <span className="font-black text-slate-950 text-xs sm:text-sm block">
                  {startDate.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
                <span className="text-[11px] text-slate-600 font-bold">
                  {startDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </div>

              {/* Exact Accurate Maturity Date & Time */}
              <div>
                <span className="text-slate-500 block uppercase font-bold text-[10px]">
                  {isActive ? 'Scheduled Maturity Date' : 'Settlement Date & Time'}
                </span>
                <span className="font-black text-slate-950 text-xs sm:text-sm block">
                  {maturityDate.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
                <span className="text-[11px] text-slate-600 font-bold">
                  {maturityDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </div>

              <div>
                <span className="text-slate-500 block uppercase font-bold text-[10px]">Locked Term Duration</span>
                <span className="font-black text-emerald-900 text-sm sm:text-base block">{investment.termDays} Days</span>
                <span className="text-[10px] text-slate-600 font-bold">
                  {isActive ? `${daysRemaining} days remaining` : 'Term complete'}
                </span>
              </div>
            </div>

            {/* Financial Breakdown Table */}
            <div className="space-y-4 relative z-10">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-5 rounded-2xl bg-slate-950 text-white shadow-md gap-3">
                <div>
                  <span className="text-xs font-mono uppercase text-emerald-400 font-black tracking-wider block">
                    Principal Capital Deposited
                  </span>
                  <span className="text-3xl sm:text-4xl font-black font-mono text-white tracking-tight">
                    ${investment.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD
                  </span>
                </div>
                <div className="text-left sm:text-right bg-slate-900 px-4 py-2.5 rounded-xl border-2 border-emerald-500 shadow-inner">
                  <span className="text-2xl sm:text-3xl font-black font-mono text-emerald-400 block">4.50%</span>
                  <span className="text-[11px] text-slate-200 uppercase font-mono font-black">
                    Fixed Interest Every 24 Hours
                  </span>
                </div>
              </div>

              <div className="p-5 rounded-2xl border-2 border-slate-300 bg-slate-50 space-y-3 text-sm font-mono font-extrabold">
                <div className="flex justify-between py-1.5 border-b border-slate-200">
                  <span className="text-slate-700">Daily Return (Every 24h):</span>
                  <span className="font-black text-emerald-800">
                    +${dailyYield.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD / day
                  </span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-200">
                  <span className="text-slate-700">Total Interest for {investment.termDays} Days:</span>
                  <span className="font-black text-emerald-800">
                    +${investment.expectedYield.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD
                  </span>
                </div>
                <div className="flex justify-between py-3 border-t-2 border-slate-400 text-base sm:text-xl">
                  <span className="font-black text-slate-950">Guaranteed Total at Maturity:</span>
                  <span className="font-black text-emerald-950 font-mono">
                    ${investment.expectedMaturityValue.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD
                  </span>
                </div>
              </div>
            </div>

            {/* Security Seal & Ledger Verification Footer */}
            <div className="p-4 rounded-2xl bg-white border-2 border-slate-200 space-y-2 text-xs font-mono text-slate-700 relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1 max-w-md">
                <div className="flex items-center gap-1.5 font-black text-slate-950 text-sm">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>Verified Double-Entry Ledger Seal</span>
                </div>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  Certified digital certificate of deposit issued by Monvera Digital Bank. Principal capital and accumulated 4.50% daily profits are secured by treasury reserve obligations.
                </p>
                <div className="text-[10px] text-slate-500 font-bold">
                  Ledger Hash: 0x{investment.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 24)}...
                </div>
              </div>

              {/* Visual Stamp / Seal */}
              <div className="flex items-center justify-center p-3 rounded-xl border-2 border-emerald-600 bg-emerald-50 text-emerald-950 text-center font-black uppercase text-[10px] tracking-wider self-center sm:self-auto min-w-[120px]">
                <div>
                  <Building2 className="w-6 h-6 text-emerald-700 mx-auto mb-1" />
                  <span>MONVERA TREASURY</span>
                  <div className="text-[8px] text-emerald-800">GUARANTEED</div>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Large Prominent Action Bar (Download Image & Share) */}
        <div className="p-4 sm:p-6 bg-slate-900 border-t-2 border-slate-800 space-y-3 flex-shrink-0">
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            
            {/* BIG PROMINENT DOWNLOAD BUTTON */}
            <button
              id="download-receipt-image-btn"
              onClick={handleDownloadImage}
              disabled={isGenerating}
              className="py-4 px-6 rounded-2xl font-black text-base sm:text-lg text-white bg-gradient-to-b from-emerald-500 via-emerald-600 to-emerald-700 hover:from-emerald-400 hover:to-emerald-600 border-2 border-emerald-400 border-b-[5px] border-b-emerald-950 shadow-xl active:translate-y-1 active:border-b-[2px] transition-all flex items-center justify-center gap-2.5 cursor-pointer disabled:opacity-50 select-none"
            >
              <Download className="w-5 h-5 text-emerald-100" />
              <span>{isGenerating ? 'Generating Image...' : 'Download Receipt Image (PNG)'}</span>
            </button>

            {/* BIG PROMINENT SHARE BUTTON */}
            <button
              id="share-receipt-image-btn"
              onClick={handleShareImage}
              disabled={isGenerating}
              className="py-4 px-6 rounded-2xl font-black text-base sm:text-lg text-white bg-gradient-to-b from-blue-600 via-blue-700 to-blue-800 hover:from-blue-500 hover:to-blue-700 border-2 border-blue-400 border-b-[5px] border-b-blue-950 shadow-xl active:translate-y-1 active:border-b-[2px] transition-all flex items-center justify-center gap-2.5 cursor-pointer disabled:opacity-50 select-none"
            >
              <Share2 className="w-5 h-5 text-blue-200" />
              <span>Share Receipt as Image</span>
            </button>

          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs font-mono text-slate-400">
            <button
              onClick={handleCopyImage}
              className="inline-flex items-center gap-1.5 text-slate-300 hover:text-white transition-colors cursor-pointer font-bold"
            >
              {copiedImage ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedImage ? 'Image Copied to Clipboard!' : 'Copy Image to Clipboard (Paste anywhere)'}</span>
            </button>

            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-200 transition-colors cursor-pointer font-bold ml-auto"
            >
              Close Window
            </button>
          </div>

        </div>

      </div>
    </div>
  );
};
