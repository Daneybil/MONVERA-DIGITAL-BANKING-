import React, { useState, useRef } from 'react';
import {
  X,
  Download,
  Share2,
  CheckCircle2,
  Copy,
  Check,
  ShieldCheck,
  Building2,
  ArrowUpRight,
  ArrowDownLeft,
  Calendar,
  Clock,
  Hash,
  FileText,
  Printer,
  Sparkles,
  ImageIcon,
} from 'lucide-react';
import { toPng, toBlob } from 'html-to-image';
import { Transaction, UserProfile } from '../../types';

interface TransactionReceiptModalProps {
  transaction: Transaction | null;
  currentUser: UserProfile | null;
  onClose: () => void;
}

export const TransactionReceiptModal: React.FC<TransactionReceiptModalProps> = ({
  transaction,
  currentUser,
  onClose,
}) => {
  const [copiedRef, setCopiedRef] = useState(false);
  const [copiedHash, setCopiedHash] = useState(false);
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [isSharingImage, setIsSharingImage] = useState(false);
  const [isDownloadingImage, setIsDownloadingImage] = useState(false);
  const receiptCardRef = useRef<HTMLDivElement>(null);

  if (!transaction) return null;

  const isSender = currentUser ? transaction.senderUserId === currentUser.id : false;
  const isRecipient = currentUser ? transaction.recipientUserId === currentUser.id : false;
  const isCredit =
    isRecipient ||
    transaction.type === 'DEPOSIT' ||
    transaction.type === 'ADMIN_DEVELOPMENT_FUNDING' ||
    transaction.type === 'INVESTMENT_EARNING' ||
    transaction.type === 'INVESTMENT_MATURITY';

  const dateObj = new Date(transaction.createdAt);
  const formattedDate = dateObj.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const formattedTime = dateObj.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

  const getCleanTypeLabel = (type: string) => {
    switch (type) {
      case 'TRANSFER':
        return 'Monvera Instant Peer Transfer';
      case 'DEPOSIT':
        return 'Electronic Funds Deposit';
      case 'WITHDRAWAL':
        return 'External Wire / Account Withdrawal';
      case 'INVESTMENT':
        return 'High-Yield Treasury Allocation';
      case 'INVESTMENT_EARNING':
        return 'Daily Yield & Dividend Return';
      case 'INVESTMENT_MATURITY':
        return 'Investment Principal & Yield Return';
      case 'CARD_PURCHASE':
        return 'Monvera Obsidian Card Purchase';
      case 'ADMIN_DEVELOPMENT_FUNDING':
        return 'Treasury Development Disbursement';
      default:
        return type.replace(/_/g, ' ');
    }
  };

  const handleCopyRef = () => {
    navigator.clipboard.writeText(transaction.referenceNumber);
    setCopiedRef(true);
    setTimeout(() => setCopiedRef(false), 2000);
  };

  const handleCopyHash = () => {
    navigator.clipboard.writeText(transaction.id);
    setCopiedHash(true);
    setTimeout(() => setCopiedHash(false), 2000);
  };

  const handleShareImage = async () => {
    if (!receiptCardRef.current) return;
    setIsSharingImage(true);
    try {
      const blob = await toBlob(receiptCardRef.current, {
        cacheBust: true,
        quality: 0.98,
        pixelRatio: 2,
        backgroundColor: '#ffffff',
      });

      if (blob && navigator.share && navigator.canShare && navigator.canShare({ files: [new File([blob], 'receipt.png', { type: 'image/png' })] })) {
        const file = new File([blob], `Monvera-Receipt-${transaction.referenceNumber}.png`, { type: 'image/png' });
        await navigator.share({
          title: `Monvera Bank Receipt - ${transaction.referenceNumber}`,
          text: `Official Monvera Transaction Receipt for $${transaction.amount.toFixed(2)} USD. Reference: ${transaction.referenceNumber}`,
          files: [file],
        });
      } else {
        // Fallback: download the PNG directly
        const dataUrl = await toPng(receiptCardRef.current, {
          cacheBust: true,
          quality: 0.98,
          pixelRatio: 2,
          backgroundColor: '#ffffff',
        });
        const link = document.createElement('a');
        link.download = `Monvera-Receipt-${transaction.referenceNumber}.png`;
        link.href = dataUrl;
        link.click();
        setCopiedSummary(true);
        setTimeout(() => setCopiedSummary(false), 2500);
      }
    } catch (err) {
      console.error('Image share failed, fallback to text/summary share:', err);
      handleCopySummary();
    } finally {
      setIsSharingImage(false);
    }
  };

  const handleDownloadImage = async () => {
    if (!receiptCardRef.current) return;
    setIsDownloadingImage(true);
    try {
      const dataUrl = await toPng(receiptCardRef.current, {
        cacheBust: true,
        quality: 0.98,
        pixelRatio: 2,
        backgroundColor: '#ffffff',
      });
      const link = document.createElement('a');
      link.download = `Monvera-Official-Receipt-${transaction.referenceNumber}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Failed to export receipt image:', err);
      handleDownload();
    } finally {
      setIsDownloadingImage(false);
    }
  };

  const handleCopySummary = async () => {
    const summaryText = `═══════════════════════════════════
   MONVERA PRIVATE BANK RECEIPT
═══════════════════════════════════
Status: VERIFIED & SETTLED
Type: ${getCleanTypeLabel(transaction.type)}
Flow: ${isCredit ? 'CREDIT (+)' : 'DEBIT (-)'}
Amount: $${transaction.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
Fee: $${(transaction.fee || 0).toFixed(2)} USD
Sender: ${transaction.senderName || 'Authorized Account'} (${transaction.senderAccountNumber || 'MVB •••• 9921'})
Recipient: ${transaction.recipientName || 'Authorized Account'} (${transaction.recipientAccountNumber || 'MVB •••• 7391'})
Date & Time: ${formattedDate} at ${formattedTime}
Reference: ${transaction.referenceNumber}
Ledger Hash: ${transaction.id}
Memo: ${transaction.description}
═══════════════════════════════════
Authenticated by Monvera Real-Time Clearing Protocol`;

    if (navigator.share) {
      try {
        setIsSharingImage(true);
        await navigator.share({
          title: `Monvera Transaction Receipt - ${transaction.referenceNumber}`,
          text: summaryText,
        });
        setIsSharingImage(false);
        return;
      } catch (err) {
        setIsSharingImage(false);
      }
    }

    navigator.clipboard.writeText(summaryText);
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 2500);
  };

  const handlePrint = () => {
    window.print();
  };

  const handleDownload = () => {
    const receiptHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Monvera Receipt - ${transaction.referenceNumber}</title>
  <style>
    body { font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif; padding: 40px; color: #0f172a; background: #fff; max-width: 680px; margin: 0 auto; }
    .header { border-bottom: 2px solid #0284c7; padding-bottom: 20px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; }
    .logo { font-size: 24px; font-weight: 800; letter-spacing: 0.15em; color: #0369a1; }
    .status { background: #e0f2fe; color: #0369a1; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase; }
    .amount-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px; }
    .amount-label { font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
    .amount-val { font-size: 36px; font-weight: 800; color: ${isCredit ? '#059669' : '#0f172a'}; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
    .item { background: #f8fafc; padding: 12px 16px; border-radius: 8px; border: 1px solid #e2e8f0; }
    .item-label { font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 600; margin-bottom: 4px; }
    .item-val { font-size: 14px; font-weight: 600; color: #1e293b; }
    .footer { border-top: 1px solid #e2e8f0; padding-top: 16px; margin-top: 32px; font-size: 11px; color: #94a3b8; text-align: center; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo">MONVERA</div>
      <div style="font-size: 12px; color: #64748b; margin-top: 4px;">Official Sovereign Transaction Record</div>
    </div>
    <div class="status">✓ Verified & Settled</div>
  </div>

  <div class="amount-box">
    <div class="amount-label">${isCredit ? 'Credit Transaction • Incoming' : 'Debit Transaction • Outgoing'}</div>
    <div class="amount-val">${isCredit ? '+' : '-'}$${transaction.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</div>
    <div style="font-size: 13px; color: #64748b; margin-top: 6px;">${transaction.description}</div>
  </div>

  <div class="grid">
    <div class="item">
      <div class="item-label">Transaction Type</div>
      <div class="item-val">${getCleanTypeLabel(transaction.type)}</div>
    </div>
    <div class="item">
      <div class="item-label">Status</div>
      <div class="item-val" style="color: #059669;">Completed & Settled</div>
    </div>
    <div class="item">
      <div class="item-label">Sender</div>
      <div class="item-val">${transaction.senderName || 'Authorized Sender'} (${transaction.senderAccountNumber || 'MVB •••• 9921'})</div>
    </div>
    <div class="item">
      <div class="item-label">Recipient</div>
      <div class="item-val">${transaction.recipientName || 'Authorized Recipient'} (${transaction.recipientAccountNumber || 'MVB •••• 7391'})</div>
    </div>
    <div class="item">
      <div class="item-label">Date & Time</div>
      <div class="item-val">${formattedDate} • ${formattedTime}</div>
    </div>
    <div class="item">
      <div class="item-label">Transaction Fee</div>
      <div class="item-val">$${(transaction.fee || 0).toFixed(2)} USD (Zero-Fee Protocol)</div>
    </div>
    <div class="item" style="grid-column: span 2;">
      <div class="item-label">Transaction Reference</div>
      <div class="item-val" style="font-family: monospace;">${transaction.referenceNumber}</div>
    </div>
    <div class="item" style="grid-column: span 2;">
      <div class="item-label">Ledger Cryptographic Hash</div>
      <div class="item-val" style="font-family: monospace; font-size: 12px;">${transaction.id}</div>
    </div>
  </div>

  <div class="footer">
    Monvera Sovereign Bank • FDIC Insured up to $2,500,000 via Insured Cash Sweep Protocol<br>
    This official electronic document represents a final, irrevocable ledger posting.
  </div>
</body>
</html>`;

    const blob = new Blob([receiptHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Monvera-Receipt-${transaction.referenceNumber}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Modal Top Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-sky-600 flex items-center justify-center font-bold text-white tracking-widest text-sm shadow-sm">
              M
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-base tracking-wider text-white">MONVERA</span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 font-semibold border border-sky-400/30">
                  OFFICIAL RECEIPT
                </span>
              </div>
              <p className="text-xs text-slate-400">Electronic Ledger Record • Monvera Sovereign Banking</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Receipt Body */}
        <div ref={receiptCardRef} className="p-6 overflow-y-auto space-y-6 flex-1 bg-white">
          {/* Main Status & Amount Card */}
          <div className="rounded-2xl p-6 bg-slate-50 border-2 border-slate-200 text-center relative overflow-hidden">
            <div className="absolute top-0 right-0 transform translate-x-4 -translate-y-4 w-24 h-24 bg-sky-500/5 rounded-full blur-xl pointer-events-none" />
            
            <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-black bg-emerald-100 text-emerald-900 border border-emerald-300 mb-3">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>TRANSACTION SETTLED & VERIFIED</span>
            </div>

            <div className="text-xs uppercase font-bold text-slate-500 tracking-wider mb-1 font-mono">
              {isCredit ? 'Credit Inflow • Received' : 'Debit Outflow • Dispatched'}
            </div>

            <div className={`text-4xl sm:text-5xl font-black tracking-tight font-mono ${isCredit ? 'text-emerald-700' : 'text-slate-950'}`}>
              {isCredit ? '+' : '-'}$
              {transaction.amount.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
              <span className="text-base font-bold text-slate-500 ml-1.5 font-sans">USD</span>
            </div>

            <p className="text-sm font-bold text-slate-800 mt-2 max-w-md mx-auto">
              {transaction.description}
            </p>
          </div>

          {/* Key Transaction Metadata Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="p-4 rounded-2xl bg-white border-2 border-slate-200">
              <span className="text-[11px] font-black text-slate-500 uppercase tracking-wide block mb-1 font-mono">
                Transaction Type
              </span>
              <div className="flex items-center space-x-2">
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${isCredit ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-800'}`}>
                  {isCredit ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                </div>
                <span className="text-sm font-bold text-slate-900">
                  {getCleanTypeLabel(transaction.type)}
                </span>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-white border-2 border-slate-200">
              <span className="text-[11px] font-black text-slate-500 uppercase tracking-wide block mb-1 font-mono">
                Settlement Status
              </span>
              <div className="flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span className="text-sm font-bold text-emerald-700">Completed (Instant Settlement)</span>
              </div>
            </div>

            {/* Sender Details */}
            <div className="p-4 rounded-2xl bg-white border-2 border-slate-200">
              <span className="text-[11px] font-black text-slate-500 uppercase tracking-wide block mb-1 font-mono">
                Sender Information
              </span>
              <div className="text-sm font-black text-slate-950">
                {transaction.senderName || 'Monvera Authorized Account'}
              </div>
              <div className="text-xs text-slate-500 font-mono font-bold mt-0.5">
                {transaction.senderAccountNumber || 'MVB •••• 9921'}
              </div>
            </div>

            {/* Recipient Details */}
            <div className="p-4 rounded-2xl bg-white border-2 border-slate-200">
              <span className="text-[11px] font-black text-slate-500 uppercase tracking-wide block mb-1 font-mono">
                Recipient Information
              </span>
              <div className="text-sm font-black text-slate-950">
                {transaction.recipientName || 'Monvera Authorized Account'}
              </div>
              <div className="text-xs text-slate-500 font-mono font-bold mt-0.5">
                {transaction.recipientAccountNumber || 'MVB •••• 7391'}
              </div>
            </div>

            {/* Date and Time */}
            <div className="p-4 rounded-2xl bg-white border-2 border-slate-200 sm:col-span-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-[11px] font-black text-slate-500 uppercase tracking-wide flex items-center space-x-1 mb-1 font-mono">
                    <Calendar className="w-3.5 h-3.5 text-sky-600" />
                    <span>Transaction Date</span>
                  </span>
                  <span className="text-sm font-bold text-slate-900">{formattedDate}</span>
                </div>
                <div>
                  <span className="text-[11px] font-black text-slate-500 uppercase tracking-wide flex items-center space-x-1 mb-1 font-mono">
                    <Clock className="w-3.5 h-3.5 text-sky-600" />
                    <span>Exact Timestamp</span>
                  </span>
                  <span className="text-sm font-bold text-slate-900">{formattedTime} (UTC-4)</span>
                </div>
              </div>
            </div>

            {/* Reference Number */}
            <div className="p-4 rounded-2xl bg-white border-2 border-slate-200 sm:col-span-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[11px] font-black text-slate-500 uppercase tracking-wide flex items-center space-x-1 mb-1 font-mono">
                    <Hash className="w-3.5 h-3.5 text-sky-600" />
                    <span>Transaction Reference</span>
                  </span>
                  <span className="text-sm font-black font-mono text-slate-950">
                    {transaction.referenceNumber}
                  </span>
                </div>
                <button
                  onClick={handleCopyRef}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold text-sky-800 bg-sky-50 hover:bg-sky-100 border border-sky-300 flex items-center space-x-1 transition-colors cursor-pointer"
                >
                  {copiedRef ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedRef ? 'Copied' : 'Copy Ref'}</span>
                </button>
              </div>
            </div>

            {/* Cryptographic Ledger ID */}
            <div className="p-4 rounded-2xl bg-slate-50 border-2 border-slate-200 sm:col-span-2">
              <div className="flex items-center justify-between">
                <div className="min-w-0 pr-2">
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-wide block mb-0.5 font-mono">
                    Ledger Audit ID / Hash
                  </span>
                  <span className="text-xs font-mono text-slate-700 truncate block font-bold">
                    {transaction.id}
                  </span>
                </div>
                <button
                  onClick={handleCopyHash}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-bold text-slate-700 hover:text-slate-950 hover:bg-slate-200 shrink-0 cursor-pointer"
                >
                  {copiedHash ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          </div>

          {/* Settlement Guarantee Notice */}
          <div className="p-4 rounded-2xl bg-sky-50 border-2 border-sky-200 text-xs text-sky-950 flex items-start space-x-3">
            <ShieldCheck className="w-5 h-5 text-sky-700 shrink-0 mt-0.5" />
            <div>
              <p className="font-black text-sky-950">Settled via Monvera Real-Time Clearing Network (MICN)</p>
              <p className="text-sky-800 text-xs mt-0.5 font-medium">
                This transaction was processed with 100% full asset backing and double-entry immutable ledger verification.
              </p>
            </div>
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="px-6 py-4 bg-slate-50 border-t-2 border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-2">
            <button
              onClick={handlePrint}
              className="px-4 py-2 rounded-2xl text-xs font-black text-slate-700 bg-white hover:bg-slate-100 border-2 border-slate-300 flex items-center space-x-1.5 shadow-sm transition-colors cursor-pointer"
            >
              <Printer className="w-4 h-4 text-slate-600" />
              <span>Print</span>
            </button>
            <button
              onClick={handleShareImage}
              disabled={isSharingImage}
              className="px-4 py-2 rounded-2xl text-xs font-black text-slate-900 bg-white hover:bg-slate-100 border-2 border-slate-300 flex items-center space-x-1.5 shadow-sm transition-colors cursor-pointer"
            >
              {copiedSummary ? <Check className="w-4 h-4 text-emerald-600" /> : <Share2 className="w-4 h-4 text-slate-800" />}
              <span>{isSharingImage ? 'Preparing Image...' : copiedSummary ? 'Image Downloaded!' : 'Share Receipt (Image)'}</span>
            </button>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleDownloadImage}
              disabled={isDownloadingImage}
              className="px-5 py-2.5 rounded-2xl text-xs font-black text-white bg-slate-900 hover:bg-slate-800 shadow-md flex items-center space-x-2 transition-all cursor-pointer"
            >
              <ImageIcon className="w-4 h-4" />
              <span>{isDownloadingImage ? 'Generating PNG...' : 'Save PNG'}</span>
            </button>
            <button
              onClick={handleDownload}
              className="px-5 py-2.5 rounded-2xl text-xs font-black text-white bg-sky-600 hover:bg-sky-700 shadow-md flex items-center space-x-2 transition-all cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>HTML Doc</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
