import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  X,
  Download,
  Share2,
  CheckCircle2,
  Copy,
  Check,
  ShieldCheck,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowRightLeft,
  Calendar,
  Clock,
  Hash,
  Printer,
  ImageIcon,
  MessageSquare,
} from 'lucide-react';
import { toBlob } from 'html-to-image';
import { Transaction, UserProfile } from '../../types';

interface TransactionReceiptModalProps {
  transaction: Transaction | null;
  currentUser: UserProfile | null;
  onClose: () => void;
}

interface PreparedReceiptAsset {
  txId: string;
  blob: Blob;
  dataUrl: string;
}

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to convert receipt image blob to data URL'));
      }
    };
    reader.onerror = () => reject(reader.error || new Error('FileReader error'));
    reader.readAsDataURL(blob);
  });

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
  const [showShareOptions, setShowShareOptions] = useState(false);
  const [shareNotice, setShareNotice] = useState<{ type: 'success' | 'info' | 'error'; message: string } | null>(null);
  const [isReceiptCached, setIsReceiptCached] = useState(false);
  const receiptCardRef = useRef<HTMLDivElement>(null);
  const captureRef = useRef<HTMLDivElement>(null);
  const preparedReceiptRef = useRef<PreparedReceiptAsset | null>(null);
  const preparePromiseRef = useRef<Promise<PreparedReceiptAsset | null> | null>(null);

  const captureUnclippedReceipt = useCallback(async (txId: string): Promise<PreparedReceiptAsset | null> => {
    const target = captureRef.current;
    if (!target) return null;

    if (typeof document !== 'undefined' && (document as any).fonts?.ready) {
      try {
        await (document as any).fonts.ready;
      } catch {}
    }

    const images = Array.from(target.querySelectorAll('img'));
    await Promise.all(
      images.map((img) => {
        if (img.complete) return Promise.resolve();
        return new Promise<void>((resolve) => {
          img.onload = () => resolve();
          img.onerror = () => resolve();
        });
      })
    );

    const width = Math.max(target.scrollWidth, target.offsetWidth, 576);
    const height = Math.max(target.scrollHeight, target.offsetHeight);

    const blob = await toBlob(target, {
      cacheBust: true,
      quality: 0.98,
      pixelRatio: 2,
      backgroundColor: '#ffffff',
      width,
      height,
      style: {
        overflow: 'visible',
        maxHeight: 'none',
        height: `${height}px`,
        width: `${width}px`,
      },
    });

    if (!blob) return null;
    const dataUrl = await blobToDataUrl(blob);
    const asset: PreparedReceiptAsset = { txId, blob, dataUrl };
    preparedReceiptRef.current = asset;
    setIsReceiptCached(true);
    return asset;
  }, []);

  const ensurePreparedReceipt = useCallback(
    async (txId: string): Promise<PreparedReceiptAsset | null> => {
      if (preparedReceiptRef.current?.txId === txId) {
        return preparedReceiptRef.current;
      }
      if (preparePromiseRef.current) {
        const pending = await preparePromiseRef.current;
        if (pending?.txId === txId) return pending;
      }
      const promise = captureUnclippedReceipt(txId).catch((err) => {
        console.warn('[TransactionReceiptModal] Receipt pre-render warning:', err);
        return null;
      });
      preparePromiseRef.current = promise;
      const result = await promise;
      if (preparePromiseRef.current === promise) {
        preparePromiseRef.current = null;
      }
      return result;
    },
    [captureUnclippedReceipt]
  );

  // Pre-generate full unclipped PNG blob on modal open so native file sharing retains user activation
  useEffect(() => {
    setShowShareOptions(false);
    setShareNotice(null);
    setIsReceiptCached(false);
    preparedReceiptRef.current = null;
    preparePromiseRef.current = null;

    if (!transaction?.id) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!cancelled) {
        ensurePreparedReceipt(transaction.id);
      }
    }, 80);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [transaction?.id, ensurePreparedReceipt]);

  if (!transaction) return null;

  const userAccClean = (currentUser?.permanentAccountNumber || '').replace(/[-\s]/g, '');
  const txRecipAccClean = (transaction.recipientAccountNumber || '').replace(/[-\s]/g, '');
  const txSenderAccClean = (transaction.senderAccountNumber || '').replace(/[-\s]/g, '');

  const isRecipient = currentUser
    ? (transaction.recipientUserId === currentUser.id ||
       (!transaction.recipientUserId && transaction.userId === currentUser.id) ||
       (userAccClean && txRecipAccClean && txRecipAccClean === userAccClean))
    : false;

  const isSender = currentUser
    ? ((transaction.senderUserId === currentUser.id && transaction.recipientUserId !== currentUser.id) ||
       (userAccClean && txSenderAccClean && txSenderAccClean === userAccClean && txRecipAccClean !== userAccClean))
    : false;

  const isAdminTransferCredit = Boolean(
    (transaction.metadata?.disbursementType === 'ADMINISTRATIVE_TRANSFER' ||
      transaction.senderAccountNumber === '1000000001' ||
      transaction.senderName?.includes('Bennett Johnson')) &&
      (isRecipient || transaction.userId === currentUser?.id || transaction.recipientUserId === currentUser?.id)
  );

  const isCheckWithdrawalDebit = transaction.type === 'CHECK_WITHDRAWAL';
  const isWireCheckWithdrawalDebit = transaction.type === 'WIRE_CHECK_WITHDRAWAL';
  const isPermanentCheckDebit = isCheckWithdrawalDebit || isWireCheckWithdrawalDebit;
  const txDescLower = (transaction.description || '').toLowerCase();
  const isInternalTransfer =
    transaction.metadata?.isInternalTransfer === true ||
    transaction.metadata?.transferScope === 'INTERNAL_ACCOUNT_TRANSFER' ||
    (transaction.type === 'TRANSFER' &&
      (txDescLower.includes('checking to savings') ||
        txDescLower.includes('savings to checking') ||
        txDescLower.includes('internal transfer') ||
        txDescLower.includes('internal account transfer') ||
        (Boolean(
          transaction.senderUserId &&
            transaction.recipientUserId &&
            transaction.senderUserId === transaction.recipientUserId
        ) &&
          !isAdminTransferCredit &&
          !txDescLower.includes('loan') &&
          !txDescLower.includes('disburs'))));

  const metaSource = String(transaction.metadata?.sourceAccountType || '').toUpperCase();
  const metaDest = String(transaction.metadata?.destinationAccountType || '').toUpperCase();
  const internalSourceIsSavings =
    metaSource === 'SAVINGS' ||
    (!metaSource && (txDescLower.includes('savings to checking') || txDescLower.includes('sav to chk')));
  const internalDestIsChecking =
    metaDest === 'CHECKING' ||
    (!metaDest && (txDescLower.includes('savings to checking') || txDescLower.includes('sav to chk')));
  const internalSourceLabel = internalSourceIsSavings ? 'High-Yield Savings' : 'Checking';
  const internalDestLabel = internalDestIsChecking ? 'Checking' : 'High-Yield Savings';

  const wireCheckBankName = String(transaction.metadata?.bankName || 'United States Financial Institution');
  const wireCheckDestAccMasked = transaction.metadata?.destinationBankAccountNumberMasked
    ? String(transaction.metadata.destinationBankAccountNumberMasked)
    : '';
  const wireCheckSourceAccMasked = transaction.metadata?.sourceAccountNumberMasked
    ? String(transaction.metadata.sourceAccountNumberMasked)
    : 'MVB ••••';
  const wireCheckSourceAccount = String(transaction.metadata?.sourceAccountType || 'CHECKING');
  const wireCheckDeliveryStatus =
    transaction.metadata?.checkProcessingStatus === 'DELIVERED' ? 'DELIVERED' : 'REQUESTED';
  const wireCheckEstBusinessDays = Number(transaction.metadata?.estimatedDeliveryBusinessDays) || 5;
  const wireCheckNoticeMessage =
    wireCheckDeliveryStatus === 'DELIVERED'
      ? 'Your Wire Check has been delivered.'
      : `Estimated delivery is ${wireCheckEstBusinessDays} business days. You will receive a notification when your Wire Check has been delivered.`;

  const isCredit = isPermanentCheckDebit || isInternalTransfer
    ? false
    : (isRecipient && !isSender) ||
      isAdminTransferCredit ||
      transaction.type === 'DEPOSIT' ||
      transaction.type === 'ADMIN_DEVELOPMENT_FUNDING' ||
      transaction.type === 'INVESTMENT_EARNING' ||
      transaction.type === 'INVESTMENT_MATURITY';

  const cleanSenderName = (transaction.senderName || '').replace(/\s*\(Admin\)/i, '').trim();
  const displayDescription = (transaction.description && transaction.description.toLowerCase().includes('administrative direct transfer'))
    ? `Transfer from ${cleanSenderName || 'Bennett Johnson'}`
    : transaction.description;

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
    if (isInternalTransfer) {
      return 'Internal Account Transfer';
    }
    switch (type) {
      case 'TRANSFER':
        return 'Monvera Instant Peer Transfer';
      case 'DEPOSIT':
        return 'Electronic Funds Deposit';
      case 'WITHDRAWAL':
        return 'External Wire / Account Withdrawal';
      case 'CHECK_WITHDRAWAL':
        return 'Check Withdrawal';
      case 'WIRE_CHECK_WITHDRAWAL':
        return 'Wire Check Withdrawal';
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

  const buildSummaryText = () => `═══════════════════════════════════
   MONVERA PRIVATE BANK RECEIPT
═══════════════════════════════════
Status: ${isWireCheckWithdrawalDebit ? `COMPLETED • ${wireCheckDeliveryStatus}` : 'VERIFIED & SETTLED'}
Type: ${getCleanTypeLabel(transaction.type)}
Flow: ${isInternalTransfer ? 'INTERNAL (Account-to-Account)' : isCredit ? 'CREDIT (+)' : 'DEBIT (-)'}
Amount: $${transaction.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
Fee: $${(transaction.fee || 0).toFixed(2)} USD
${isInternalTransfer ? `Source Account: Monvera ${internalSourceLabel} (${transaction.metadata?.sourceAccountMasked || transaction.senderAccountNumber || 'MVB ••••'})
Destination Account: Monvera ${internalDestLabel} (${transaction.metadata?.destinationAccountMasked || transaction.recipientAccountNumber || 'MVB ••••'})` : `Sender: ${transaction.senderName || 'Monvera Authorized Account'} (${isWireCheckWithdrawalDebit ? wireCheckSourceAccMasked : transaction.senderAccountNumber || 'MVB •••• 9921'})
${isWireCheckWithdrawalDebit ? `Destination Bank: ${wireCheckBankName}${wireCheckDestAccMasked ? ` (${wireCheckDestAccMasked})` : ''}
Source Account: ${wireCheckSourceAccount}
Delivery Status: ${wireCheckDeliveryStatus}
Estimated Delivery: ${wireCheckEstBusinessDays} business days
Notice: ${wireCheckNoticeMessage}` : isCheckWithdrawalDebit ? `Payee: ${transaction.recipientName || transaction.metadata?.payeeName || 'Authorized Payee'} (${transaction.metadata?.checkNumber ? `Check #${transaction.metadata.checkNumber}` : transaction.recipientAccountNumber || 'Check'})
Source Account: ${transaction.metadata?.sourceAccountType || 'CHECKING'}` : `Recipient: ${transaction.recipientName || 'Monvera Authorized Account'} (${transaction.recipientAccountNumber || 'MVB •••• 7391'})`}`}
Date & Time: ${formattedDate} at ${formattedTime}
Reference: ${transaction.referenceNumber}
Ledger Hash: ${transaction.id}
Memo: ${displayDescription}
═══════════════════════════════════
Authenticated by Monvera Real-Time Clearing Protocol`;

  const handleCopyRef = async () => {
    try {
      await navigator.clipboard.writeText(transaction.referenceNumber);
      setCopiedRef(true);
      setTimeout(() => setCopiedRef(false), 2000);
    } catch {
      setShareNotice({ type: 'error', message: 'Clipboard access unavailable in this browser.' });
    }
  };

  const handleCopyHash = async () => {
    try {
      await navigator.clipboard.writeText(transaction.id);
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 2000);
    } catch {
      setShareNotice({ type: 'error', message: 'Clipboard access unavailable in this browser.' });
    }
  };

  const handleCopySummary = async () => {
    try {
      await navigator.clipboard.writeText(buildSummaryText());
      setCopiedSummary(true);
      setShareNotice({ type: 'success', message: 'Receipt details copied to clipboard.' });
      setTimeout(() => setCopiedSummary(false), 2500);
    } catch {
      setShareNotice({ type: 'error', message: 'Clipboard access unavailable in this browser.' });
    }
  };

  const handleShareTextSummary = async () => {
    const summaryText = buildSummaryText();
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: `Monvera Transaction Receipt - ${transaction.referenceNumber}`,
          text: summaryText,
        });
        setShareNotice({ type: 'success', message: 'Receipt summary shared.' });
        setShowShareOptions(false);
        return;
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
      }
    }
    await handleCopySummary();
  };

  const canShareImageFile = (blob: Blob) => {
    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false;
    if (typeof File === 'undefined' || typeof navigator.canShare !== 'function') return false;
    try {
      const testFile = new File([blob], `Monvera-Receipt-${transaction.referenceNumber}.png`, { type: 'image/png' });
      return navigator.canShare({ files: [testFile] });
    } catch {
      return false;
    }
  };

  const handleShareImage = async () => {
    setShareNotice(null);

    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
      ensurePreparedReceipt(transaction.id);
      setShowShareOptions(true);
      setShareNotice({
        type: 'info',
        message: 'Native share sheet is unavailable in this browser. Choose a share option below:',
      });
      return;
    }

    // Fast path: if receipt PNG is already cached, invoke navigator.share synchronously inside user gesture
    const cached = preparedReceiptRef.current?.txId === transaction.id ? preparedReceiptRef.current : null;
    if (cached) {
      if (canShareImageFile(cached.blob)) {
        const file = new File([cached.blob], `Monvera-Receipt-${transaction.referenceNumber}.png`, { type: 'image/png' });
        try {
          await navigator.share({
            title: `Monvera Bank Receipt - ${transaction.referenceNumber}`,
            text: `Official Monvera Transaction Receipt for $${transaction.amount.toFixed(2)} USD. Reference: ${transaction.referenceNumber}`,
            files: [file],
          });
          setShareNotice({ type: 'success', message: 'Receipt image shared successfully.' });
          setShowShareOptions(false);
        } catch (err: any) {
          if (err?.name === 'AbortError') {
            return;
          }
          console.warn('[TransactionReceiptModal] Native file share unavailable/declined:', err);
          setShowShareOptions(true);
          setShareNotice({
            type: 'info',
            message: 'Unable to open native file sharing here. Choose an explicit option below:',
          });
        }
        return;
      }

      // Browser supports navigator.share but not image files -> show explicit Share Options (never silently download)
      setShowShareOptions(true);
      setShareNotice({
        type: 'info',
        message: 'Image file sharing is not supported by this browser. Choose a share or download option below:',
      });
      return;
    }

    // Fallback if user clicked Share before pre-render completed
    setIsSharingImage(true);
    try {
      const asset = await ensurePreparedReceipt(transaction.id);
      if (!asset) {
        setShowShareOptions(true);
        setShareNotice({
          type: 'error',
          message: 'Could not prepare receipt image for sharing. You can copy details below.',
        });
        return;
      }

      if (canShareImageFile(asset.blob)) {
        const file = new File([asset.blob], `Monvera-Receipt-${transaction.referenceNumber}.png`, { type: 'image/png' });
        try {
          await navigator.share({
            title: `Monvera Bank Receipt - ${transaction.referenceNumber}`,
            text: `Official Monvera Transaction Receipt for $${transaction.amount.toFixed(2)} USD. Reference: ${transaction.referenceNumber}`,
            files: [file],
          });
          setShareNotice({ type: 'success', message: 'Receipt image shared successfully.' });
          setShowShareOptions(false);
        } catch (err: any) {
          if (err?.name === 'AbortError') {
            return;
          }
          setShowShareOptions(true);
          setShareNotice({
            type: 'info',
            message: 'Receipt image is now ready. Tap "Share Image Now" or choose another option below:',
          });
        }
      } else {
        setShowShareOptions(true);
        setShareNotice({
          type: 'info',
          message: 'Image file sharing is not supported by this browser. Choose a share or download option below:',
        });
      }
    } finally {
      setIsSharingImage(false);
    }
  };

  const handleDownloadImage = async () => {
    setShareNotice(null);
    setIsDownloadingImage(true);
    try {
      const asset = await ensurePreparedReceipt(transaction.id);
      if (!asset?.dataUrl) {
        setShareNotice({
          type: 'error',
          message: 'Failed to generate PNG receipt image. Please use HTML Doc or Print.',
        });
        return;
      }
      const link = document.createElement('a');
      link.download = `Monvera-Official-Receipt-${transaction.referenceNumber}.png`;
      link.href = asset.dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setShareNotice({ type: 'success', message: 'Official PNG receipt downloaded.' });
    } catch (err) {
      console.error('Failed to export receipt image:', err);
      setShareNotice({
        type: 'error',
        message: 'Failed to generate PNG image. Please try HTML Doc or Print.',
      });
    } finally {
      setIsDownloadingImage(false);
    }
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
    <div class="status">${isWireCheckWithdrawalDebit ? `Wire Check • ${wireCheckDeliveryStatus}` : '✓ Verified & Settled'}</div>
  </div>

  <div class="amount-box">
    <div class="amount-label">${isInternalTransfer ? 'Internal Account Movement • Self-Transfer' : isCredit ? 'Credit Transaction • Incoming' : 'Debit Transaction • Outgoing'}</div>
    <div class="amount-val">${isInternalTransfer ? '' : isCredit ? '+' : '-'}$${transaction.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</div>
    <div style="font-size: 13px; color: #64748b; margin-top: 6px;">${displayDescription}</div>
  </div>

  <div class="grid">
    <div class="item">
      <div class="item-label">Transaction Type</div>
      <div class="item-val">${getCleanTypeLabel(transaction.type)}</div>
    </div>
    <div class="item">
      <div class="item-label">Status</div>
      <div class="item-val" style="color: #059669;">${isWireCheckWithdrawalDebit ? `Completed • ${wireCheckDeliveryStatus}` : 'Completed & Settled'}</div>
    </div>
    <div class="item">
      <div class="item-label">${isInternalTransfer ? 'Source Account' : 'Sender'}</div>
      <div class="item-val">${isInternalTransfer ? `Monvera ${internalSourceLabel} (${transaction.metadata?.sourceAccountMasked || transaction.senderAccountNumber || 'MVB ••••'})` : `${transaction.senderName || 'Authorized Sender'} (${isWireCheckWithdrawalDebit ? wireCheckSourceAccMasked : transaction.senderAccountNumber || 'MVB •••• 9921'})`}</div>
    </div>
    <div class="item">
      <div class="item-label">${isInternalTransfer ? 'Destination Account' : isWireCheckWithdrawalDebit ? 'Destination Bank' : isCheckWithdrawalDebit ? 'Check Payee & Check #' : 'Recipient'}</div>
      <div class="item-val">${isInternalTransfer ? `Monvera ${internalDestLabel} (${transaction.metadata?.destinationAccountMasked || transaction.recipientAccountNumber || 'MVB ••••'})` : isWireCheckWithdrawalDebit ? `${wireCheckBankName}${wireCheckDestAccMasked ? ` (${wireCheckDestAccMasked})` : ''}` : `${transaction.recipientName || transaction.metadata?.payeeName || 'Authorized Recipient'} (${isCheckWithdrawalDebit && transaction.metadata?.checkNumber ? `Check #${transaction.metadata.checkNumber}` : transaction.recipientAccountNumber || 'MVB •••• 7391'})`}</div>
    </div>
    ${isCheckWithdrawalDebit ? `<div class="item" style="grid-column: span 2;"><div class="item-label">Source Account</div><div class="item-val">${transaction.metadata?.sourceAccountType || 'CHECKING'}</div></div>` : ''}
    ${isWireCheckWithdrawalDebit ? `<div class="item"><div class="item-label">Source Account</div><div class="item-val">${wireCheckSourceAccount}</div></div><div class="item"><div class="item-label">Delivery Estimate & Notification</div><div class="item-val">${wireCheckDeliveryStatus} • ${wireCheckNoticeMessage}</div></div>` : ''}
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

  const canRetryFileShareNow =
    isReceiptCached &&
    preparedReceiptRef.current?.txId === transaction.id &&
    canShareImageFile(preparedReceiptRef.current.blob);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fadeIn">
      {/* Unclipped Off-Screen Receipt Capture Surface (includes official header, omits interactive buttons & modal chrome) */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          left: '-10000px',
          top: 0,
          width: '576px',
          pointerEvents: 'none',
          zIndex: -1,
          opacity: 1,
        }}
      >
        <div
          ref={captureRef}
          className="w-[576px] bg-white rounded-2xl border border-slate-200 overflow-visible"
        >
          {/* Official Header (omits Close button) */}
          <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800 rounded-t-2xl">
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
          </div>

          {/* Unclipped Full Receipt Body */}
          <div className="p-6 space-y-6 bg-white rounded-b-2xl overflow-visible">
            <div className="rounded-2xl p-6 bg-slate-50 border-2 border-slate-200 text-center relative overflow-hidden">
              <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-black bg-emerald-100 text-emerald-900 border border-emerald-300 mb-3">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>
                  {isWireCheckWithdrawalDebit
                    ? `WIRE CHECK • ${wireCheckDeliveryStatus}`
                    : 'TRANSACTION SETTLED & VERIFIED'}
                </span>
              </div>

              <div className="text-xs uppercase font-bold text-slate-500 tracking-wider mb-1 font-mono">
                {isInternalTransfer
                  ? 'Internal Account Movement • Self-Transfer'
                  : isCredit
                  ? 'Credit Inflow • Received'
                  : 'Debit Outflow • Dispatched'}
              </div>

              <div className={`text-4xl font-black tracking-tight font-mono ${isInternalTransfer ? 'text-slate-950' : isCredit ? 'text-emerald-700' : 'text-slate-950'}`}>
                {isInternalTransfer ? '' : isCredit ? '+' : '-'}$
                {transaction.amount.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
                <span className="text-base font-bold text-slate-500 ml-1.5 font-sans">USD</span>
              </div>

              <p className="text-sm font-bold text-slate-800 mt-2 max-w-md mx-auto">
                {displayDescription}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3.5">
              <div className="p-4 rounded-2xl bg-white border-2 border-slate-200">
                <span className="text-[11px] font-black text-slate-500 uppercase tracking-wide block mb-1 font-mono">
                  Transaction Type
                </span>
                <div className="flex items-center space-x-2">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${isInternalTransfer ? 'bg-sky-100 text-sky-700' : isCredit ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-800'}`}>
                    {isInternalTransfer ? <ArrowRightLeft className="w-4 h-4" /> : isCredit ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
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
                  <span className="text-sm font-bold text-emerald-700">
                    {isWireCheckWithdrawalDebit
                      ? `Completed (${wireCheckDeliveryStatus})`
                      : 'Completed (Instant Settlement)'}
                  </span>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-white border-2 border-slate-200">
                <span className="text-[11px] font-black text-slate-500 uppercase tracking-wide block mb-1 font-mono">
                  {isInternalTransfer ? 'Source Account' : 'Sender Information'}
                </span>
                <div className="text-sm font-black text-slate-950">
                  {isInternalTransfer
                    ? `Monvera ${internalSourceLabel}`
                    : transaction.senderName || 'Monvera Authorized Account'}
                </div>
                <div className="text-xs text-slate-500 font-mono font-bold mt-0.5">
                  {isInternalTransfer
                    ? transaction.metadata?.sourceAccountMasked || transaction.senderAccountNumber || 'MVB ••••'
                    : isWireCheckWithdrawalDebit
                    ? wireCheckSourceAccMasked
                    : transaction.senderAccountNumber || 'MVB •••• 9921'}
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-white border-2 border-slate-200">
                <span className="text-[11px] font-black text-slate-500 uppercase tracking-wide block mb-1 font-mono">
                  {isInternalTransfer
                    ? 'Destination Account'
                    : isWireCheckWithdrawalDebit
                    ? 'Destination Bank & Source'
                    : isCheckWithdrawalDebit
                    ? 'Check Payee & Check #'
                    : 'Recipient Information'}
                </span>
                <div className="text-sm font-black text-slate-950">
                  {isInternalTransfer
                    ? `Monvera ${internalDestLabel}`
                    : isWireCheckWithdrawalDebit
                    ? `${wireCheckBankName}${wireCheckDestAccMasked ? ` (${wireCheckDestAccMasked})` : ''}`
                    : transaction.recipientName || transaction.metadata?.payeeName || 'Monvera Authorized Account'}
                </div>
                <div className="text-xs text-slate-500 font-mono font-bold mt-0.5">
                  {isInternalTransfer
                    ? transaction.metadata?.destinationAccountMasked || transaction.recipientAccountNumber || 'MVB ••••'
                    : isWireCheckWithdrawalDebit
                    ? `${wireCheckSourceAccount} • ${wireCheckDeliveryStatus}`
                    : isCheckWithdrawalDebit && transaction.metadata?.checkNumber
                    ? `Check #${transaction.metadata.checkNumber}${transaction.metadata?.sourceAccountType ? ` • ${transaction.metadata.sourceAccountType}` : ''}`
                    : transaction.recipientAccountNumber || 'MVB •••• 7391'}
                </div>
              </div>

              {isWireCheckWithdrawalDebit && (
                <div className="p-4 rounded-2xl bg-sky-50 border-2 border-sky-200 col-span-2 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-black text-sky-900 uppercase tracking-wide font-mono">
                      Delivery Estimate &amp; Notification
                    </span>
                    <span className="px-2 py-0.5 rounded-md font-mono font-black text-xs uppercase bg-white text-slate-900 border border-sky-200">
                      {wireCheckDeliveryStatus}
                    </span>
                  </div>
                  <p className="text-xs text-sky-900 font-medium leading-relaxed">
                    {wireCheckNoticeMessage}
                  </p>
                </div>
              )}

              <div className="p-4 rounded-2xl bg-white border-2 border-slate-200 col-span-2">
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

              <div className="p-4 rounded-2xl bg-white border-2 border-slate-200 col-span-2">
                <span className="text-[11px] font-black text-slate-500 uppercase tracking-wide flex items-center space-x-1 mb-1 font-mono">
                  <Hash className="w-3.5 h-3.5 text-sky-600" />
                  <span>Transaction Reference</span>
                </span>
                <span className="text-sm font-black font-mono text-slate-950 break-all">
                  {transaction.referenceNumber}
                </span>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 border-2 border-slate-200 col-span-2">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-wide block mb-0.5 font-mono">
                  Ledger Audit ID / Hash
                </span>
                <span className="text-xs font-mono text-slate-700 break-all block font-bold">
                  {transaction.id}
                </span>
              </div>
            </div>

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
        </div>
      </div>

      {/* Visible Interactive Modal */}
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
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
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
              <span>
                {isWireCheckWithdrawalDebit
                  ? `WIRE CHECK • ${wireCheckDeliveryStatus}`
                  : 'TRANSACTION SETTLED & VERIFIED'}
              </span>
            </div>

            <div className="text-xs uppercase font-bold text-slate-500 tracking-wider mb-1 font-mono">
              {isInternalTransfer
                ? 'Internal Account Movement • Self-Transfer'
                : isCredit
                ? 'Credit Inflow • Received'
                : 'Debit Outflow • Dispatched'}
            </div>

            <div className={`text-4xl sm:text-5xl font-black tracking-tight font-mono ${isInternalTransfer ? 'text-slate-950' : isCredit ? 'text-emerald-700' : 'text-slate-950'}`}>
              {isInternalTransfer ? '' : isCredit ? '+' : '-'}$
              {transaction.amount.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
              <span className="text-base font-bold text-slate-500 ml-1.5 font-sans">USD</span>
            </div>

            <p className="text-sm font-bold text-slate-800 mt-2 max-w-md mx-auto">
              {displayDescription}
            </p>
          </div>

          {/* Key Transaction Metadata Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="p-4 rounded-2xl bg-white border-2 border-slate-200">
              <span className="text-[11px] font-black text-slate-500 uppercase tracking-wide block mb-1 font-mono">
                Transaction Type
              </span>
              <div className="flex items-center space-x-2">
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${isInternalTransfer ? 'bg-sky-100 text-sky-700' : isCredit ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-800'}`}>
                  {isInternalTransfer ? <ArrowRightLeft className="w-4 h-4" /> : isCredit ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
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
                <span className="text-sm font-bold text-emerald-700">
                  {isWireCheckWithdrawalDebit
                    ? `Completed (${wireCheckDeliveryStatus})`
                    : 'Completed (Instant Settlement)'}
                </span>
              </div>
            </div>

            {/* Sender Details */}
            <div className="p-4 rounded-2xl bg-white border-2 border-slate-200">
              <span className="text-[11px] font-black text-slate-500 uppercase tracking-wide block mb-1 font-mono">
                {isInternalTransfer ? 'Source Account' : 'Sender Information'}
              </span>
              <div className="text-sm font-black text-slate-950">
                {isInternalTransfer
                  ? `Monvera ${internalSourceLabel}`
                  : transaction.senderName || 'Monvera Authorized Account'}
              </div>
              <div className="text-xs text-slate-500 font-mono font-bold mt-0.5">
                {isInternalTransfer
                  ? transaction.metadata?.sourceAccountMasked || transaction.senderAccountNumber || 'MVB ••••'
                  : isWireCheckWithdrawalDebit
                  ? wireCheckSourceAccMasked
                  : transaction.senderAccountNumber || 'MVB •••• 9921'}
              </div>
            </div>

            {/* Recipient / Check Payee / Wire Check Details */}
            <div className="p-4 rounded-2xl bg-white border-2 border-slate-200">
              <span className="text-[11px] font-black text-slate-500 uppercase tracking-wide block mb-1 font-mono">
                {isInternalTransfer
                  ? 'Destination Account'
                  : isWireCheckWithdrawalDebit
                  ? 'Destination Bank & Source'
                  : isCheckWithdrawalDebit
                  ? 'Check Payee & Check #'
                  : 'Recipient Information'}
              </span>
              <div className="text-sm font-black text-slate-950">
                {isInternalTransfer
                  ? `Monvera ${internalDestLabel}`
                  : isWireCheckWithdrawalDebit
                  ? `${wireCheckBankName}${wireCheckDestAccMasked ? ` (${wireCheckDestAccMasked})` : ''}`
                  : transaction.recipientName || transaction.metadata?.payeeName || 'Monvera Authorized Account'}
              </div>
              <div className="text-xs text-slate-500 font-mono font-bold mt-0.5">
                {isInternalTransfer
                  ? transaction.metadata?.destinationAccountMasked || transaction.recipientAccountNumber || 'MVB ••••'
                  : isWireCheckWithdrawalDebit
                  ? `${wireCheckSourceAccount} • ${wireCheckDeliveryStatus}`
                  : isCheckWithdrawalDebit && transaction.metadata?.checkNumber
                  ? `Check #${transaction.metadata.checkNumber}${transaction.metadata?.sourceAccountType ? ` • ${transaction.metadata.sourceAccountType}` : ''}`
                  : transaction.recipientAccountNumber || 'MVB •••• 7391'}
              </div>
            </div>

            {isWireCheckWithdrawalDebit && (
              <div className="p-4 rounded-2xl bg-sky-50 border-2 border-sky-200 sm:col-span-2 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-black text-sky-900 uppercase tracking-wide font-mono">
                    Delivery Estimate &amp; Notification
                  </span>
                  <span
                    className={`px-2.5 py-0.5 rounded-md font-mono font-black text-xs uppercase ${
                      wireCheckDeliveryStatus === 'DELIVERED'
                        ? 'bg-emerald-100 text-emerald-900'
                        : 'bg-amber-100 text-amber-900'
                    }`}
                  >
                    {wireCheckDeliveryStatus}
                  </span>
                </div>
                <p className="text-xs text-sky-900 font-medium leading-relaxed">
                  {wireCheckNoticeMessage}
                </p>
              </div>
            )}

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

        {/* Share Status & Explicit Share Options Panel (No silent download fallbacks) */}
        {(shareNotice || showShareOptions) && (
          <div className="px-6 py-3 bg-slate-100 border-t border-slate-200 space-y-2.5">
            {shareNotice && (
              <div
                className={`flex items-center justify-between gap-2 text-xs font-bold px-3 py-2 rounded-xl border ${
                  shareNotice.type === 'success'
                    ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
                    : shareNotice.type === 'error'
                    ? 'bg-rose-50 text-rose-900 border-rose-200'
                    : 'bg-sky-50 text-sky-900 border-sky-200'
                }`}
              >
                <span>{shareNotice.message}</span>
                <button
                  type="button"
                  onClick={() => setShareNotice(null)}
                  className="text-slate-500 hover:text-slate-900 font-black px-1 cursor-pointer shrink-0"
                  aria-label="Dismiss notice"
                >
                  ✕
                </button>
              </div>
            )}

            {showShareOptions && (
              <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-black uppercase tracking-wider text-slate-600">
                    Share Options
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowShareOptions(false)}
                    className="text-[11px] font-bold text-slate-500 hover:text-slate-900 cursor-pointer"
                  >
                    Close
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {canRetryFileShareNow && (
                    <button
                      type="button"
                      onClick={handleShareImage}
                      className="px-3 py-1.5 rounded-lg text-xs font-black bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 cursor-pointer"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                      <span>Share PNG Image Now</span>
                    </button>
                  )}
                  {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
                    <button
                      type="button"
                      onClick={handleShareTextSummary}
                      className="px-3 py-1.5 rounded-lg text-xs font-black bg-sky-600 hover:bg-sky-700 text-white flex items-center gap-1.5 cursor-pointer"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>Share Text Summary</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleCopySummary}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 flex items-center gap-1.5 cursor-pointer"
                  >
                    {copiedSummary ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedSummary ? 'Details Copied' : 'Copy Receipt Details'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyRef}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 flex items-center gap-1.5 cursor-pointer"
                  >
                    {copiedRef ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Hash className="w-3.5 h-3.5" />}
                    <span>{copiedRef ? 'Ref Copied' : 'Copy Reference'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadImage}
                    disabled={isDownloadingImage}
                    className="px-3 py-1.5 rounded-lg text-xs font-black bg-slate-900 hover:bg-slate-800 text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                  >
                    <ImageIcon className="w-3.5 h-3.5" />
                    <span>{isDownloadingImage ? 'Saving PNG...' : 'Download Receipt PNG'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

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
              className="px-4 py-2 rounded-2xl text-xs font-black text-slate-900 bg-white hover:bg-slate-100 border-2 border-slate-300 flex items-center space-x-1.5 shadow-sm transition-colors cursor-pointer disabled:opacity-60"
            >
              <Share2 className="w-4 h-4 text-slate-800" />
              <span>{isSharingImage ? 'Preparing Image...' : 'Share Receipt (Image)'}</span>
            </button>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleDownloadImage}
              disabled={isDownloadingImage}
              className="px-5 py-2.5 rounded-2xl text-xs font-black text-white bg-slate-900 hover:bg-slate-800 shadow-md flex items-center space-x-2 transition-all cursor-pointer disabled:opacity-60"
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

