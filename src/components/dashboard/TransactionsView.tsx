import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { firestoreSync } from '../../services/firestoreSync';
import { Transaction } from '../../types';
import {
  Search,
  Filter,
  Download,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Calendar,
  Layers,
  FileText,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  X,
  ChevronDown,
  SlidersHorizontal,
  CreditCard,
  Building,
  UserCheck,
  RotateCcw,
  AlertCircle,
} from 'lucide-react';
import { TransactionReceiptModal } from './TransactionReceiptModal';
import { auth } from '../../services/firebase';

type DateFilterPreset = 'all' | 'today' | 'this_week' | 'this_month' | 'prev_month' | 'custom';
type FlowFilter = 'ALL' | 'CREDIT' | 'DEBIT';

export interface TransactionFlowClassification {
  isInternalTransfer: boolean;
  isCredit: boolean;
  flowKind: 'INTERNAL' | 'CREDIT' | 'DEBIT';
  sourceAccountLabel: string;
  destAccountLabel: string;
}

export function classifyTransactionFlow(
  tx: Transaction,
  userId?: string | null,
  effectiveUid?: string | null,
  userPermanentAccountNumber?: string | null
): TransactionFlowClassification {
  const userAccClean = (userPermanentAccountNumber || '').replace(/[-\s]/g, '');
  const txRecipAccClean = (tx.recipientAccountNumber || '').replace(/[-\s]/g, '');
  const txSenderAccClean = (tx.senderAccountNumber || '').replace(/[-\s]/g, '');

  const isRecipient =
    (effectiveUid ? tx.recipientUserId === effectiveUid : false) ||
    (!tx.recipientUserId && effectiveUid ? tx.userId === effectiveUid : false) ||
    (userId ? tx.recipientUserId === userId : false) ||
    (!tx.recipientUserId && userId ? tx.userId === userId : false) ||
    Boolean(userAccClean && txRecipAccClean && txRecipAccClean === userAccClean);

  const isSender =
    (effectiveUid ? tx.senderUserId === effectiveUid && tx.recipientUserId !== effectiveUid : false) ||
    (userId ? tx.senderUserId === userId && tx.recipientUserId !== userId : false) ||
    Boolean(userAccClean && txSenderAccClean && txSenderAccClean === userAccClean && txRecipAccClean !== userAccClean);

  const isAdminTransferCredit = Boolean(
    (tx.metadata?.disbursementType === 'ADMINISTRATIVE_TRANSFER' ||
      tx.senderAccountNumber === '1000000001' ||
      tx.senderName?.includes('Bennett Johnson')) &&
      (isRecipient ||
        (effectiveUid ? tx.userId === effectiveUid || tx.recipientUserId === effectiveUid : false) ||
        (userId ? tx.userId === userId || tx.recipientUserId === userId : false))
  );

  const desc = (tx.description || '').toLowerCase();
  const isSameUserTransfer =
    tx.type === 'TRANSFER' &&
    Boolean(tx.senderUserId && tx.recipientUserId && tx.senderUserId === tx.recipientUserId) &&
    !isAdminTransferCredit &&
    !desc.includes('loan') &&
    !desc.includes('disburs');

  const isInternalTransfer =
    tx.metadata?.isInternalTransfer === true ||
    tx.metadata?.transferScope === 'INTERNAL_ACCOUNT_TRANSFER' ||
    (tx.type === 'TRANSFER' &&
      (desc.includes('checking to savings') ||
        desc.includes('savings to checking') ||
        desc.includes('internal transfer') ||
        desc.includes('internal account transfer'))) ||
    isSameUserTransfer;

  const metaSource = String(tx.metadata?.sourceAccountType || '').toUpperCase();
  const metaDest = String(tx.metadata?.destinationAccountType || '').toUpperCase();
  const inferredCheckingToSavings =
    metaSource === 'CHECKING' ||
    desc.includes('checking to savings') ||
    desc.includes('from checking to savings') ||
    desc.includes('chk to sav');
  const inferredSavingsToChecking =
    metaSource === 'SAVINGS' ||
    desc.includes('savings to checking') ||
    desc.includes('from savings to checking') ||
    desc.includes('sav to chk');

  const sourceAccountLabel =
    metaSource === 'SAVINGS' || (!metaSource && inferredSavingsToChecking)
      ? 'High-Yield Savings'
      : 'Checking';
  const destAccountLabel =
    metaDest === 'CHECKING' || (!metaDest && inferredSavingsToChecking)
      ? 'Checking'
      : inferredCheckingToSavings || metaDest === 'SAVINGS'
      ? 'High-Yield Savings'
      : 'Savings';

  if (isInternalTransfer) {
    return {
      isInternalTransfer: true,
      isCredit: false,
      flowKind: 'INTERNAL',
      sourceAccountLabel,
      destAccountLabel,
    };
  }

  const isCheckWithdrawalDebit =
    tx.type === 'CHECK_WITHDRAWAL' || tx.type === 'WIRE_CHECK_WITHDRAWAL';
  const isIncoming = !isCheckWithdrawalDebit && ((isRecipient && !isSender) || isAdminTransferCredit);
  const isDeposit =
    !isCheckWithdrawalDebit &&
    (tx.type === 'DEPOSIT' ||
      tx.type === 'ADMIN_DEVELOPMENT_FUNDING' ||
      tx.type === 'INVESTMENT_EARNING' ||
      tx.type === 'INVESTMENT_MATURITY' ||
      isAdminTransferCredit);
  const isCredit = isCheckWithdrawalDebit ? false : isIncoming || isDeposit;

  return {
    isInternalTransfer: false,
    isCredit,
    flowKind: isCredit ? 'CREDIT' : 'DEBIT',
    sourceAccountLabel,
    destAccountLabel,
  };
}

export const TransactionsView: React.FC = () => {
  const { currentUser, balanceMetrics, lastUpdateTimestamp } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [flowFilter, setFlowFilter] = useState<FlowFilter>('ALL');
  const [datePreset, setDatePreset] = useState<DateFilterPreset>('all');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [selectedTxForReceipt, setSelectedTxForReceipt] = useState<Transaction | null>(null);
  const [showFilterDrawer, setShowFilterDrawer] = useState(false);

  const effectiveUid = auth.currentUser?.uid || currentUser?.id;

  const fetchTransactions = async () => {
    if (!effectiveUid && !currentUser) return;
    setIsLoading(true);
    try {
      // Authoritative single-path transaction retrieval
      const res = await api.getTransactions({ userId: effectiveUid || currentUser?.id });
      setTransactions(res.transactions || []);
    } catch (err) {
      console.error('Failed to fetch transactions:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTransactions();

    const handleTxCreated = (e: any) => {
      const detail = e?.detail;
      if (!detail) return;
      if (!detail.userId || detail.userId === effectiveUid || detail.userId === currentUser?.id) {
        fetchTransactions();
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('monvera_transaction_created', handleTxCreated);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('monvera_transaction_created', handleTxCreated);
      }
    };
  }, [effectiveUid, currentUser, balanceMetrics, lastUpdateTimestamp]);

  useEffect(() => {
    if (!transactions || transactions.length === 0) return;
    const focusTxFromNav = (rawTarget?: any) => {
      try {
        let target = rawTarget;
        if (!target && typeof window !== 'undefined') {
          const saved = sessionStorage.getItem('monvera_notification_nav_target');
          if (saved) target = JSON.parse(saved);
        }
        if (target && target.actionView === 'transactions') {
          const refOrId = target.referenceNumber || target.actionRecordId;
          if (refOrId) {
            const matched = transactions.find(
              (t) => t.id === refOrId || t.referenceNumber === refOrId
            );
            if (matched) {
              setSelectedTxForReceipt(matched);
            } else {
              setSearchQuery(String(refOrId));
            }
          }
          if (typeof window !== 'undefined') {
            sessionStorage.removeItem('monvera_notification_nav_target');
          }
        }
      } catch {}
    };

    focusTxFromNav();
    const onNavigate = (e: any) => focusTxFromNav(e?.detail);
    if (typeof window !== 'undefined') {
      window.addEventListener('monvera_notification_navigate', onNavigate);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('monvera_notification_navigate', onNavigate);
      }
    };
  }, [transactions]);

  if (!currentUser) return null;

  const categories = ['ALL', 'Transfers', 'Deposits', 'Withdrawals', 'Checks', 'Wire Check', 'Investments', 'Shopping', 'Payroll'];

  // Helper for date filtering calculation
  const filteredTransactions = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    
    // Start of this week (Monday)
    const dayOfWeek = now.getDay();
    const diffToMon = now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1);
    const startOfThisWeek = new Date(now.getFullYear(), now.getMonth(), diffToMon).getTime();

    // Start of this month
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    // Start & End of previous month
    const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
    const endOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999).getTime();

    return transactions.filter((tx) => {
      const txTime = new Date(tx.createdAt).getTime();

      // 1. Date Preset Filter
      if (datePreset === 'today') {
        if (txTime < startOfToday) return false;
      } else if (datePreset === 'this_week') {
        if (txTime < startOfThisWeek) return false;
      } else if (datePreset === 'this_month') {
        if (txTime < startOfThisMonth) return false;
      } else if (datePreset === 'prev_month') {
        if (txTime < startOfPrevMonth || txTime > endOfPrevMonth) return false;
      } else if (datePreset === 'custom') {
        if (customStartDate) {
          const customStart = new Date(customStartDate).getTime();
          if (!isNaN(customStart) && txTime < customStart) return false;
        }
        if (customEndDate) {
          const customEnd = new Date(customEndDate).setHours(23, 59, 59, 999);
          if (!isNaN(customEnd) && txTime > customEnd) return false;
        }
      }

      // 2. Flow Filter (Credit vs Debit — internal transfers appear in ALL only)
      const flowClass = classifyTransactionFlow(
        tx,
        currentUser.id,
        effectiveUid,
        currentUser.permanentAccountNumber
      );

      if (flowFilter === 'CREDIT' && flowClass.flowKind !== 'CREDIT') return false;
      if (flowFilter === 'DEBIT' && flowClass.flowKind !== 'DEBIT') return false;

      // 3. Category Filter
      if (selectedCategory !== 'ALL' && tx.category !== selectedCategory) {
        return false;
      }

      // 4. Search Filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const descMatch = tx.description.toLowerCase().includes(q);
        const refMatch = tx.referenceNumber.toLowerCase().includes(q);
        const senderMatch = tx.senderName ? tx.senderName.toLowerCase().includes(q) : false;
        const recipientMatch = tx.recipientName ? tx.recipientName.toLowerCase().includes(q) : false;
        const amountMatch = tx.amount.toString().includes(q);
        const hashMatch = tx.id.toLowerCase().includes(q);
        const senderAccMatch = tx.senderAccountNumber ? tx.senderAccountNumber.includes(q) : false;
        const recipAccMatch = tx.recipientAccountNumber ? tx.recipientAccountNumber.includes(q) : false;

        if (!descMatch && !refMatch && !senderMatch && !recipientMatch && !amountMatch && !hashMatch && !senderAccMatch && !recipAccMatch) {
          return false;
        }
      }

      return true;
    });
  }, [transactions, currentUser, datePreset, customStartDate, customEndDate, flowFilter, selectedCategory, searchQuery]);

  // Aggregate Metrics for Current Filter
  const stats = useMemo(() => {
    let totalInflow = 0;
    let totalOutflow = 0;

    for (const tx of filteredTransactions) {
      const flowClass = classifyTransactionFlow(
        tx,
        currentUser?.id,
        effectiveUid,
        currentUser?.permanentAccountNumber
      );

      if (flowClass.flowKind === 'CREDIT') {
        totalInflow += tx.amount;
      } else if (flowClass.flowKind === 'DEBIT') {
        totalOutflow += tx.amount;
      }
    }

    return {
      totalInflow,
      totalOutflow,
      netVolume: totalInflow - totalOutflow,
      count: filteredTransactions.length,
    };
  }, [filteredTransactions, currentUser, effectiveUid]);

  const getCleanTypeLabel = (type: string, tx?: Transaction) => {
    if (
      tx &&
      classifyTransactionFlow(tx, currentUser?.id, effectiveUid, currentUser?.permanentAccountNumber).isInternalTransfer
    ) {
      return 'Internal Transfer';
    }
    switch (type) {
      case 'TRANSFER':
        return 'Peer Transfer';
      case 'DEPOSIT':
        return 'Direct Deposit';
      case 'WITHDRAWAL':
        return 'Wire Withdrawal';
      case 'CHECK_WITHDRAWAL':
        return 'Check Withdrawal';
      case 'WIRE_CHECK_WITHDRAWAL':
        return 'Wire Check Withdrawal';
      case 'INVESTMENT':
        return 'Treasury Plan';
      case 'INVESTMENT_EARNING':
        return 'Daily Yield';
      case 'INVESTMENT_MATURITY':
        return 'Term Maturity';
      case 'CARD_PURCHASE':
        return 'Card Purchase';
      case 'ADMIN_DEVELOPMENT_FUNDING':
        return 'Disbursement';
      default:
        return type.replace(/_/g, ' ');
    }
  };

  const exportCSV = () => {
    const headers = [
      'Reference Number',
      'Transaction Date',
      'Transaction Time',
      'Flow (Credit/Debit)',
      'Type',
      'Category',
      'Description',
      'Party / Merchant',
      'Amount (USD)',
      'Fee (USD)',
      'Status',
    ];

    const rows = filteredTransactions.map((t) => {
      const flowClass = classifyTransactionFlow(
        t,
        currentUser.id,
        effectiveUid,
        currentUser.permanentAccountNumber
      );

      const dateObj = new Date(t.createdAt);
      const party = flowClass.isInternalTransfer
        ? `${flowClass.sourceAccountLabel} -> ${flowClass.destAccountLabel}`
        : flowClass.isCredit
        ? t.senderName || 'Authorized Sender'
        : t.recipientName || 'Authorized Recipient';

      return [
        t.referenceNumber,
        dateObj.toLocaleDateString(),
        dateObj.toLocaleTimeString(),
        flowClass.flowKind,
        flowClass.isInternalTransfer ? 'INTERNAL_TRANSFER' : t.type,
        t.category,
        `"${t.description.replace(/"/g, '""')}"`,
        `"${party.replace(/"/g, '""')}"`,
        flowClass.isInternalTransfer
          ? t.amount.toFixed(2)
          : (flowClass.isCredit ? t.amount : -t.amount).toFixed(2),
        (t.fee || 0).toFixed(2),
        t.status,
      ];
    });

    const csvContent =
      'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `monvera_transactions_export_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div id="transactions-ledger-view" className="space-y-6 animate-fadeIn pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">Transaction History & Ledger</h2>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-sky-100 text-sky-800 border border-sky-200">
              Live RTP Feed
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Complete records of all credits, debits, peer transfers, deposits, withdrawals, and treasury allocations.
          </p>
        </div>

        <div className="flex items-center space-x-2.5">
          <button
            onClick={fetchTransactions}
            className="p-2 rounded-xl text-slate-600 bg-white hover:bg-slate-50 border border-slate-200 shadow-xs transition-colors"
            title="Refresh Ledger"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-sky-600' : ''}`} />
          </button>
          <button
            onClick={exportCSV}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 rounded-xl border border-slate-200 shadow-xs transition-colors"
          >
            <Download className="w-4 h-4 text-slate-500" />
            <span>Export Statement (CSV)</span>
          </button>
        </div>
      </div>

      {/* Summary Volume Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 sm:p-5 rounded-2xl bg-white border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Received (Credits)</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-extrabold text-emerald-600 mt-2">
            +${stats.totalInflow.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Incoming transfers, deposits, and returns</div>
        </div>

        <div className="p-4 sm:p-5 rounded-2xl bg-white border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Dispatched (Debits)</span>
            <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center">
              <TrendingDown className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-2">
            -${stats.totalOutflow.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Outgoing transfers, withdrawals, and cards</div>
        </div>

        <div className="p-4 sm:p-5 rounded-2xl bg-sky-50 border border-sky-100 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-sky-900 uppercase tracking-wider">Filtered Volume</span>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-sky-200/60 text-sky-900">
              {stats.count} {stats.count === 1 ? 'record' : 'records'}
            </span>
          </div>
          <div className={`text-xl sm:text-2xl font-extrabold mt-2 ${stats.netVolume >= 0 ? 'text-sky-950' : 'text-slate-900'}`}>
            {stats.netVolume >= 0 ? '+' : '-'}${Math.abs(stats.netVolume).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-sky-700 mt-1">Net flow across active filters</div>
        </div>
      </div>

      {/* Filter and Date Control Panel */}
      <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-4">
        {/* Active Filter Bar & Back/Reset Button when filters are applied */}
        {(searchQuery || flowFilter !== 'ALL' || selectedCategory !== 'ALL' || datePreset !== 'all' || customStartDate || customEndDate) && (
          <div className="p-3 rounded-xl bg-sky-50 border border-sky-200 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center space-x-2 text-xs font-bold text-sky-950">
              <span className="inline-block w-2 h-2 rounded-full bg-sky-600 animate-pulse" />
              <span>Filters currently active:</span>
              {flowFilter !== 'ALL' && <span className="px-2 py-0.5 rounded-md bg-white border border-sky-300 font-mono">{flowFilter}</span>}
              {selectedCategory !== 'ALL' && <span className="px-2 py-0.5 rounded-md bg-white border border-sky-300">{selectedCategory}</span>}
              {datePreset !== 'all' && <span className="px-2 py-0.5 rounded-md bg-white border border-sky-300 capitalize">{datePreset.replace('_', ' ')}</span>}
              {searchQuery && <span className="px-2 py-0.5 rounded-md bg-white border border-sky-300">"{searchQuery}"</span>}
            </div>
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedCategory('ALL');
                setFlowFilter('ALL');
                setDatePreset('all');
                setCustomStartDate('');
                setCustomEndDate('');
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold text-sky-900 bg-white hover:bg-sky-100 border border-sky-300 transition-colors shadow-2xs cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to All Transactions</span>
            </button>
          </div>
        )}

        {/* Row 1: Search & Flow Switcher */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
          {/* Search Box */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
            <input
              type="text"
              placeholder="Search by name, reference (MV-...), description, account number, or amount..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-xs sm:text-sm rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-sky-500 bg-slate-50/50"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Flow Type Pills (All / Credit / Debit) */}
          <div className="flex items-center rounded-xl bg-slate-100 p-1 shrink-0">
            <button
              onClick={() => setFlowFilter('ALL')}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all ${
                flowFilter === 'ALL' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All Types
            </button>
            <button
              onClick={() => setFlowFilter('CREDIT')}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center space-x-1 ${
                flowFilter === 'CREDIT' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-600 hover:text-emerald-700'
              }`}
            >
              <ArrowDownLeft className="w-3.5 h-3.5" />
              <span>Credits (In)</span>
            </button>
            <button
              onClick={() => setFlowFilter('DEBIT')}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center space-x-1 ${
                flowFilter === 'DEBIT' ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ArrowUpRight className="w-3.5 h-3.5" />
              <span>Debits (Out)</span>
            </button>
          </div>
        </div>

        {/* Row 2: Date Presets & Categories */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pt-2 border-t border-slate-100">
          {/* Date Presets */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wide mr-1 flex items-center space-x-1">
              <Calendar className="w-3.5 h-3.5 text-sky-600" />
              <span>Period:</span>
            </span>
            {[
              { id: 'all', label: 'All Time' },
              { id: 'today', label: 'Today' },
              { id: 'this_week', label: 'This Week' },
              { id: 'this_month', label: 'This Month' },
              { id: 'prev_month', label: 'Previous Month' },
              { id: 'custom', label: 'Custom Range' },
            ].map((preset) => (
              <button
                key={preset.id}
                onClick={() => setDatePreset(preset.id as DateFilterPreset)}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                  datePreset === preset.id
                    ? 'bg-sky-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Categories Selector */}
          <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 lg:pb-0">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wide mr-1">Category:</span>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-2.5 py-1 text-xs font-semibold rounded-lg whitespace-nowrap transition-all ${
                  selectedCategory === cat
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Row 3: Custom Date Pickers (when custom range is selected) */}
        {datePreset === 'custom' && (
          <div className="p-3.5 rounded-xl bg-sky-50/70 border border-sky-100 flex flex-wrap items-center gap-4 animate-fadeIn">
            <div className="flex items-center space-x-2">
              <label className="text-xs font-bold text-sky-900">Start Date:</label>
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-sky-200 bg-white text-xs font-medium text-slate-800 focus:ring-2 focus:ring-sky-500"
              />
            </div>
            <div className="flex items-center space-x-2">
              <label className="text-xs font-bold text-sky-900">End Date:</label>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-sky-200 bg-white text-xs font-medium text-slate-800 focus:ring-2 focus:ring-sky-500"
              />
            </div>
            {(customStartDate || customEndDate) && (
              <button
                onClick={() => {
                  setCustomStartDate('');
                  setCustomEndDate('');
                }}
                className="text-xs font-bold text-sky-700 hover:underline"
              >
                Reset Dates
              </button>
            )}
          </div>
        )}
      </div>

      {/* Main Transactions List */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {filteredTransactions.length === 0 ? (
          <div className="p-16 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
              <Layers className="w-6 h-6" />
            </div>
            <div className="text-base font-bold text-slate-800">No Transactions Found</div>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              No ledger records matched your current search criteria or date filter. Try selecting "All Time" or adjusting your search filters.
            </p>
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedCategory('ALL');
                setFlowFilter('ALL');
                setDatePreset('all');
              }}
              className="px-4 py-2 rounded-xl text-xs font-bold text-sky-700 bg-sky-50 hover:bg-sky-100 transition-colors"
            >
              Clear All Filters
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredTransactions.map((tx) => {
              const flowClass = classifyTransactionFlow(
                tx,
                currentUser?.id,
                effectiveUid,
                currentUser?.permanentAccountNumber
              );
              const { isInternalTransfer, isCredit, sourceAccountLabel, destAccountLabel } = flowClass;

              const dateObj = new Date(tx.createdAt);
              const formattedDate = dateObj.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              });
              const formattedTime = dateObj.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: true,
              });

              const cleanSenderName = (tx.senderName || '').replace(/\s*\(Admin\)/i, '').trim();
              const cleanRecipName = (tx.recipientName || '').replace(/\s*\(Admin\)/i, '').trim();
              const partyName = isCredit
                ? cleanSenderName || (tx.type === 'DEPOSIT' ? 'Direct ACH Infusion' : 'Bennett Johnson')
                : cleanRecipName || (tx.type === 'WITHDRAWAL' ? 'External Financial Institution' : 'Commercial Merchant');

              const displayDescription = (tx.description && tx.description.toLowerCase().includes('administrative direct transfer'))
                ? `Transfer from ${cleanSenderName || 'Bennett Johnson'}`
                : tx.description;

              return (
                <div
                  key={tx.id}
                  onClick={() => setSelectedTxForReceipt(tx)}
                  className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50/90 transition-colors border-l-4 border-l-transparent hover:border-l-sky-600 cursor-pointer group"
                >
                  {/* Left Col: Direction Icon & Details */}
                  <div className="flex items-start sm:items-center space-x-3.5 min-w-0">
                    <div
                      className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-105 ${
                        isInternalTransfer
                          ? 'bg-sky-50 text-sky-700 border border-sky-200'
                          : isCredit
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-slate-100 text-slate-800 border border-slate-200'
                      }`}
                    >
                      {isInternalTransfer ? (
                        <ArrowRightLeft className="w-5 h-5" />
                      ) : isCredit ? (
                        <ArrowDownLeft className="w-5 h-5" />
                      ) : (
                        <ArrowUpRight className="w-5 h-5" />
                      )}
                    </div>

                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-extrabold text-slate-900 group-hover:text-sky-700 transition-colors truncate">
                          {displayDescription}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                            isInternalTransfer
                              ? 'bg-sky-100 text-sky-800 border border-sky-200'
                              : isCredit
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                              : 'bg-slate-200 text-slate-800'
                          }`}
                        >
                          {isInternalTransfer ? 'Internal' : isCredit ? 'Credit' : 'Debit'}
                        </span>
                      </div>

                      {/* Party & Type info */}
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
                        <span className="font-semibold text-slate-800">
                          {isInternalTransfer
                            ? `${sourceAccountLabel} → ${destAccountLabel}`
                            : tx.type === 'WIRE_CHECK_WITHDRAWAL'
                            ? `Bank: ${tx.metadata?.bankName || cleanRecipName || 'Destination Bank'}${tx.metadata?.destinationBankAccountNumberMasked ? ` (${tx.metadata.destinationBankAccountNumberMasked})` : ''}`
                            : tx.type === 'CHECK_WITHDRAWAL'
                            ? `Payee: ${partyName}`
                            : isCredit
                            ? `From: ${partyName}`
                            : `To: ${partyName}`}
                        </span>
                        <span className="text-slate-300">•</span>
                        <span className="text-slate-500">{getCleanTypeLabel(tx.type, tx)}</span>
                        {tx.type === 'CHECK_WITHDRAWAL' && tx.metadata?.checkNumber && (
                          <>
                            <span className="text-slate-300">•</span>
                            <span className="text-slate-700 font-mono font-semibold">
                              Check #{tx.metadata.checkNumber}
                              {tx.metadata?.sourceAccountType ? ` (${tx.metadata.sourceAccountType})` : ''}
                            </span>
                          </>
                        )}
                        {tx.type === 'WIRE_CHECK_WITHDRAWAL' && (
                          <>
                            {tx.metadata?.sourceAccountType && (
                              <>
                                <span className="text-slate-300">•</span>
                                <span className="text-slate-700 font-mono font-semibold">
                                  {tx.metadata.sourceAccountType}
                                </span>
                              </>
                            )}
                            <span className="text-slate-300">•</span>
                            <span
                              className={`px-2 py-0.5 rounded-md font-mono font-bold text-[10px] uppercase ${
                                tx.metadata?.checkProcessingStatus === 'DELIVERED'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-amber-100 text-amber-900'
                              }`}
                            >
                              {tx.metadata?.checkProcessingStatus === 'DELIVERED'
                                ? 'DELIVERED'
                                : 'REQUESTED • 5 business days'}
                            </span>
                          </>
                        )}
                        <span className="text-slate-300">•</span>
                        <span className="text-slate-500 font-mono text-[11px]">{tx.referenceNumber}</span>
                      </div>

                      {/* Exact Date & Time */}
                      <div className="flex items-center space-x-1.5 text-[11px] text-slate-500 font-medium">
                        <Clock className="w-3 h-3 text-sky-600 shrink-0" />
                        <span>{formattedDate} at {formattedTime}</span>
                      </div>
                    </div>
                  </div>

                  {/* Right Col: Amount, Status & Receipt Button */}
                  <div className="flex items-center justify-between sm:justify-end sm:space-x-4 pl-14 sm:pl-0">
                    <div className="text-left sm:text-right space-y-1">
                      <div
                        className={`text-base sm:text-lg font-extrabold font-mono tracking-tight ${
                          isInternalTransfer ? 'text-slate-900' : isCredit ? 'text-emerald-600' : 'text-slate-900'
                        }`}
                      >
                        {isInternalTransfer ? '' : isCredit ? '+' : '-'}$
                        {tx.amount.toLocaleString('en-US', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                        <span className="text-xs text-slate-500 font-sans ml-1">USD</span>
                      </div>
                      <div className="flex items-center sm:justify-end space-x-1">
                        {tx.status === 'COMPLETED' && (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider font-mono">
                              Settled
                            </span>
                          </>
                        )}
                        {tx.status === 'PENDING' && tx.type === 'WITHDRAWAL' && (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider font-mono">
                              Successful
                            </span>
                          </>
                        )}
                        {tx.status === 'PENDING' && tx.type !== 'WITHDRAWAL' && (
                          <>
                            <Clock className="w-3.5 h-3.5 text-amber-600 animate-pulse" />
                            <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider font-mono">
                              Pending
                            </span>
                          </>
                        )}
                        {tx.status === 'REVERSED' && (
                          <>
                            <RotateCcw className="w-3.5 h-3.5 text-sky-600" />
                            <span className="text-[10px] font-bold text-sky-700 tracking-wide font-mono">
                              Transaction was reversed.
                            </span>
                          </>
                        )}
                        {tx.status !== 'COMPLETED' && tx.status !== 'PENDING' && tx.status !== 'REVERSED' && (
                          <>
                            <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                            <span className="text-[10px] font-bold text-rose-700 uppercase tracking-wider font-mono">
                              {tx.status}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedTxForReceipt(tx);
                      }}
                      className="px-3.5 py-1.5 rounded-xl text-xs font-bold text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 flex items-center space-x-1.5 shadow-2xs transition-all shrink-0 cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Receipt</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Official Transaction Receipt Modal */}
      {selectedTxForReceipt && (
        <TransactionReceiptModal
          transaction={selectedTxForReceipt}
          currentUser={currentUser}
          onClose={() => setSelectedTxForReceipt(null)}
        />
      )}
    </div>
  );
};
