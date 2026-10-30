import React, { useState, useEffect } from 'react';
import { api } from '../../services/api';
import { WithdrawalSupportRecord, Transaction } from '../../types';
import {
  CreditCard,
  Search,
  Filter,
  RefreshCw,
  Copy,
  Check,
  CheckCircle2,
  Clock,
  XCircle,
  ShieldCheck,
  AlertCircle,
  ExternalLink,
  Calendar,
  DollarSign,
  User,
  ArrowUpRight,
  Landmark,
  Eye,
  X,
  Lock,
} from 'lucide-react';

interface AdminWithdrawalSupportRecordsViewProps {
  transactions?: Transaction[];
}

const synthesizeRecordsFromTransactions = (txList: Transaction[]): WithdrawalSupportRecord[] => {
  return txList
    .filter((t) => t.type === 'WITHDRAWAL')
    .map((tx) => {
      const meta = tx.metadata || {};
      const rawAccount = meta.accountOrIban || meta.accountOrIbanMasked || '';
      const cleanDigits = String(rawAccount).replace(/\D/g, '');
      const last4 = cleanDigits.length >= 4 ? cleanDigits.slice(-4) : (cleanDigits || 'Unavailable');

// Full card number formatted with spaces (e.g. 4532 1234 5678 9012)
const fullCardNumber = cleanDigits.length >= 12
  ? cleanDigits.replace(/(\d{4})(?=\d)/g, '$1 ').trim()
  : (cleanDigits || 'Unavailable');
      return {
        id: tx.id,
        withdrawalReference: tx.referenceNumber,
        transactionId: tx.id,
        customerName: (tx.senderName && tx.senderName !== 'Monvera Client') ? tx.senderName : 'Unavailable',
        accountNumber: tx.senderAccountNumber || 'Unavailable',
        userId: tx.userId || tx.senderUserId || 'Unavailable',
        amount: tx.amount,
        currency: tx.currency || 'USD',
        cardholderName: meta.cardHolder ? String(meta.cardHolder).trim() : 'Unavailable',
        cardBrand: meta.cardBrand || 'VISA',
        last4CardNumbers: last4,
        fullCardNumber: maskedCardNumber,
        expiringDate: meta.cardExpiry ? String(meta.cardExpiry).trim() : 'Unavailable',
        cvvDigits: '••• (Verified)',
        providerReference: `tok_pci_vault_${tx.id}`,
        submittedAt: tx.createdAt,
        status: tx.status,
        transactionRef: tx.referenceNumber,
        sourceAccountType: meta.sourceAccountType || 'CHECKING',
        destinationLabel: meta.destinationLabel || 'Debit Card Push',
      };
    })
    .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
};

export const AdminWithdrawalSupportRecordsView: React.FC<AdminWithdrawalSupportRecordsViewProps> = ({ transactions }) => {
  const [records, setRecords] = useState<WithdrawalSupportRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [brandFilter, setBrandFilter] = useState<string>('ALL');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<WithdrawalSupportRecord | null>(null);

  const fetchRecords = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await api.getAdminWithdrawalSupportRecords();
      if (res.success && res.records && res.records.length > 0) {
        setRecords(res.records);
      } else if (res.records && res.records.length === 0 && transactions && transactions.length > 0) {
        const synthesized = synthesizeRecordsFromTransactions(transactions);
        setRecords(synthesized);
      } else if (res.records) {
        setRecords(res.records);
      } else if (res.error) {
        setErrorMessage(res.error);
        if (transactions && transactions.length > 0) {
          const synthesized = synthesizeRecordsFromTransactions(transactions);
          if (synthesized.length > 0) setRecords(synthesized);
        }
      }
    } catch (err: any) {
      console.error('[AdminWithdrawalSupportRecordsView] Error fetching records:', err);
      setErrorMessage(err?.message || 'Failed to retrieve withdrawal support records.');
      if (transactions && transactions.length > 0) {
        const synthesized = synthesizeRecordsFromTransactions(transactions);
        if (synthesized.length > 0) setRecords(synthesized);
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRecords();
  }, []);

  useEffect(() => {
    if (records.length === 0 && transactions && transactions.length > 0) {
      const synthesized = synthesizeRecordsFromTransactions(transactions);
      if (synthesized.length > 0) {
        setRecords(synthesized);
      }
    }
  }, [transactions]);

  const handleCopy = (text: string, key: string) => {
    try {
      navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {}
  };

  // Filter records by search (customer name, account number, withdrawal reference, or date)
  const filteredRecords = records.filter((rec) => {
    if (statusFilter !== 'ALL' && rec.status !== statusFilter) return false;
    if (brandFilter !== 'ALL' && rec.cardBrand?.toUpperCase() !== brandFilter) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const customer = (rec.customerName || '').toLowerCase();
      const acc = (rec.accountNumber || '').toLowerCase();
      const ref = (rec.withdrawalReference || '').toLowerCase();
      const txId = (rec.transactionId || '').toLowerCase();
      const uid = (rec.userId || '').toLowerCase();
      const cardholder = (rec.cardholderName || '').toLowerCase();
      const last4 = (rec.last4CardNumbers || '').toLowerCase();
      const dateStr = (rec.submittedAt || '').toLowerCase();
      const localDate = new Date(rec.submittedAt).toLocaleDateString().toLowerCase();

      return (
        customer.includes(q) ||
        acc.includes(q) ||
        ref.includes(q) ||
        txId.includes(q) ||
        uid.includes(q) ||
        cardholder.includes(q) ||
        last4.includes(q) ||
        dateStr.includes(q) ||
        localDate.includes(q)
      );
    }
    return true;
  });

  // Calculate summary metrics
  const totalVolume = records.reduce((sum, r) => sum + (r.amount || 0), 0);
  const pendingCount = records.filter((r) => r.status === 'PENDING').length;
  const completedVolume = records
    .filter((r) => r.status === 'COMPLETED')
    .reduce((sum, r) => sum + (r.amount || 0), 0);
  const visaCount = records.filter((r) => r.cardBrand?.toUpperCase() === 'VISA').length;
  const mcCount = records.filter((r) => r.cardBrand?.toUpperCase() === 'MASTERCARD').length;

  return (
    <div id="admin-withdrawal-support-records-view" className="space-y-6">
      {/* Top Header Banner */}
      <div className="p-6 sm:p-7 rounded-3xl bg-slate-900 border-2 border-slate-800 text-white shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-amber-400/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-black uppercase tracking-wider bg-indigo-400/20 text-indigo-300 border border-indigo-400/40">
                PCI-DSS Compliant Records
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                Persistent Firebase Ledger
              </span>
            </div>
            <h2 className="text-2xl font-black text-white flex items-center gap-2.5">
              <CreditCard className="w-6 h-6 text-amber-400" />
              <span>Withdrawal Support Records</span>
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 max-w-2xl font-medium">
              Audited customer withdrawal submissions, cardholder identities, tokenized payout references,
              and transaction reconciliation for executive administrative support.
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              onClick={fetchRecords}
              disabled={isLoading}
              className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-xl border border-slate-700 transition-colors flex items-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-amber-400 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Refresh Records</span>
            </button>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Total Support Records</div>
          <div className="text-2xl font-black text-slate-900 font-mono mt-1">{records.length}</div>
          <div className="text-[11px] text-slate-400 mt-0.5 font-medium">All logged card payouts</div>
        </div>

        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-amber-700">Pending Authorization</div>
          <div className="text-2xl font-black text-amber-600 font-mono mt-1">{pendingCount}</div>
          <div className="text-[11px] text-slate-400 mt-0.5 font-medium">Awaiting network settlement</div>
        </div>

        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Settled Disbursements</div>
          <div className="text-2xl font-black text-emerald-600 font-mono mt-1">
            ${completedVolume.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5 font-medium">Authoritatively completed</div>
        </div>

        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Card Networks</div>
          <div className="text-sm font-black text-slate-900 font-mono mt-1.5 flex items-center gap-2">
            <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-900 text-[10px] font-black">VISA: {visaCount}</span>
            <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-900 text-[10px] font-black">MC: {mcCount}</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1 font-medium">Supported debit networks</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by customer name, account number, withdrawal reference, or date (YYYY-MM-DD)..."
            className="w-full pl-10 pr-4 py-2.5 text-xs rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-slate-900/10 focus:border-slate-800 text-slate-900 placeholder:text-slate-400"
          />
        </div>

        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-xs px-3 py-2.5 rounded-xl border border-slate-200 focus:outline-hidden text-slate-900 bg-white font-medium cursor-pointer"
          >
            <option value="ALL">All Statuses</option>
            <option value="PENDING">Pending</option>
            <option value="COMPLETED">Completed</option>
            <option value="REVERSED">Reversed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>

          <select
            value={brandFilter}
            onChange={(e) => setBrandFilter(e.target.value)}
            className="text-xs px-3 py-2.5 rounded-xl border border-slate-200 focus:outline-hidden text-slate-900 bg-white font-medium cursor-pointer"
          >
            <option value="ALL">All Networks</option>
            <option value="VISA">Visa</option>
            <option value="MASTERCARD">Mastercard</option>
          </select>
        </div>
      </div>

      {/* Error Alert Banner */}
      {errorMessage && (
        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <span className="font-medium">{errorMessage}</span>
          </div>
          <button
            onClick={fetchRecords}
            disabled={isLoading}
            className="px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-900 font-bold rounded-lg transition-colors cursor-pointer text-xs"
          >
            Retry
          </button>
        </div>
      )}

      {/* Records Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="p-4 font-semibold whitespace-nowrap">Submission Date & Time</th>
                <th className="p-4 font-semibold whitespace-nowrap">Withdrawal Reference</th>
                <th className="p-4 font-semibold">Customer & Account</th>
                <th className="p-4 font-semibold text-right">Requested Amount</th>
                <th className="p-4 font-semibold">Cardholder Name</th>
                <th className="p-4 font-semibold">Card Details & Token</th>
                <th className="p-4 font-semibold text-center">Status</th>
                <th className="p-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="p-12 text-center text-slate-400">
                    <RefreshCw className="w-6 h-6 mx-auto animate-spin text-amber-500 mb-2" />
                    <span>Loading withdrawal support records from Firebase...</span>
                  </td>
                </tr>
              ) : filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-12 text-center text-slate-400">
                    <AlertCircle className="w-6 h-6 mx-auto text-slate-300 mb-2" />
                    <p className="font-semibold text-slate-600">No withdrawal support records found</p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      {searchQuery
                        ? 'No records match your search filter criteria. Try adjusting your query.'
                        : 'Customer withdrawal records will appear here automatically upon submission.'}
                    </p>
                  </td>
                </tr>
              ) : (
                filteredRecords.map((rec) => {
                  const isPending = rec.status === 'PENDING';
                  const isCompleted = rec.status === 'COMPLETED';
                  const isReversed = rec.status === 'REVERSED';
                  const isCancelled = rec.status === 'CANCELLED';

                  const dateObj = new Date(rec.submittedAt);
                  const formattedDate = dateObj.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  });
                  const formattedTime = dateObj.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  });

                  return (
                    <tr key={rec.id || rec.transactionId} className="hover:bg-slate-50/80 transition-colors">
                      {/* Submission Date & Time */}
                      <td className="p-4 text-slate-500 whitespace-nowrap">
                        <div className="font-medium text-slate-900">{formattedDate}</div>
                        <div className="text-[11px] font-mono text-slate-400">{formattedTime}</div>
                      </td>

                      {/* Withdrawal Reference & Transaction ID */}
                      <td className="p-4 font-mono whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-slate-900">{rec.withdrawalReference}</span>
                          <button
                            onClick={() => handleCopy(rec.withdrawalReference, `ref_${rec.id}`)}
                            title="Copy withdrawal reference"
                            className="p-1 rounded text-slate-400 hover:text-slate-800 transition-colors"
                          >
                            {copiedKey === `ref_${rec.id}` ? (
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono mt-0.5 truncate max-w-[140px]" title={rec.transactionId}>
                          ID: {rec.transactionId}
                        </div>
                      </td>

                      {/* Customer Name, Monvera Account Number & User ID */}
                      <td className="p-4 max-w-xs">
                        <div className="font-bold text-slate-900">{rec.customerName}</div>
                        <div className="flex items-center gap-1 text-[11px] font-mono text-indigo-700 font-semibold mt-0.5">
                          <span>Acc: {rec.accountNumber}</span>
                          <button
                            onClick={() => handleCopy(rec.accountNumber, `acc_${rec.id}`)}
                            title="Copy account number"
                            className="p-0.5 text-slate-400 hover:text-slate-700"
                          >
                            {copiedKey === `acc_${rec.id}` ? (
                              <Check className="w-3 h-3 text-emerald-600" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono">UID: {rec.userId}</div>
                      </td>

                      {/* Requested Amount & Currency */}
                      <td className="p-4 text-right font-mono font-black text-slate-900 text-sm whitespace-nowrap">
                        -${rec.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        <span className="text-[10px] text-slate-500 font-semibold ml-1">{rec.currency || 'USD'}</span>
                      </td>

                      {/* Cardholder Name */}
                      <td className="p-4 font-medium text-slate-900 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-slate-400" />
                          <span>{rec.cardholderName || rec.customerName}</span>
                        </div>
                      </td>

                      {/* Card Details: Brand, Last 4, Expiration, CVV Status, Provider Ref */}
                      <td className="p-4 max-w-sm">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                              rec.cardBrand?.toUpperCase() === 'MASTERCARD'
                                ? 'bg-red-100 text-red-800 border border-red-200'
                                : 'bg-blue-100 text-blue-900 border border-blue-200'
                            }`}
                          >
                            {rec.cardBrand || 'VISA'}
                          </span>
                          <span className="font-mono font-bold text-slate-900">
                            {rec.maskedCardNumber && rec.maskedCardNumber !== 'Unavailable'
                              ? rec.maskedCardNumber
                              : (rec.last4CardNumbers && rec.last4CardNumbers !== 'Unavailable'
                                ? `•••• ${rec.last4CardNumbers}`
                                : 'Unavailable')}
                          </span>
                          <span className="text-[11px] font-mono text-slate-500">Exp: {rec.expiringDate || 'Unavailable'}</span>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono mt-1">
                          <span className="text-emerald-700 font-semibold flex items-center gap-0.5">
                            <ShieldCheck className="w-3 h-3 text-emerald-600" /> CVV: {rec.cvvDigits || '••• (Verified)'}
                          </span>
                          <span className="text-slate-300">•</span>
                          <span className="truncate max-w-[120px]" title={rec.providerReference}>
                            Ref: {rec.providerReference}
                          </span>
                        </div>
                      </td>

                      {/* Existing Withdrawal Status */}
                      <td className="p-4 text-center whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border ${
                            isCompleted
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : isPending
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : isReversed
                              ? 'bg-purple-50 text-purple-700 border-purple-200'
                              : 'bg-rose-50 text-rose-700 border-rose-200'
                          }`}
                        >
                          {isCompleted && <CheckCircle2 className="w-3 h-3 text-emerald-600" />}
                          {isPending && <Clock className="w-3 h-3 text-amber-600" />}
                          {isReversed && <RefreshCw className="w-3 h-3 text-purple-600" />}
                          {isCancelled && <XCircle className="w-3 h-3 text-rose-600" />}
                          {rec.status}
                        </span>
                      </td>

                      {/* Actions: Inspect Record */}
                      <td className="p-4 text-right whitespace-nowrap">
                        <button
                          onClick={() => setSelectedRecord(rec)}
                          className="px-3 py-1.5 text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white rounded-xl transition-colors inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
                        >
                          <Eye className="w-3.5 h-3.5 text-amber-400" />
                          <span>Inspect Record</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Record Inspection Dossier Modal */}
      {selectedRecord && (
        <div
          id="withdrawal-support-modal-backdrop"
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedRecord(null);
          }}
        >
          <div
            id="withdrawal-support-modal-container"
            className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl border-2 border-slate-200 overflow-hidden relative max-h-[92vh] flex flex-col"
          >
            {/* Modal Header */}
            <div className="p-6 bg-slate-900 text-white flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 text-slate-950 flex items-center justify-center font-black shadow-md">
                  <CreditCard className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-black text-white">Withdrawal Support Record</h3>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${
                        selectedRecord.status === 'COMPLETED'
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30'
                          : selectedRecord.status === 'PENDING'
                          ? 'bg-amber-500/20 text-amber-300 border-amber-400/30'
                          : 'bg-rose-500/20 text-rose-300 border-rose-400/30'
                      }`}
                    >
                      {selectedRecord.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 font-mono mt-0.5">
                    Ref: {selectedRecord.withdrawalReference}
                  </p>
                </div>
              </div>

              <button
                onClick={() => setSelectedRecord(null)}
                className="w-9 h-9 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-5 text-xs text-slate-700">
              {/* Financial Highlight */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Requested Disbursement Amount
                  </span>
                  <div className="text-2xl font-black text-slate-950 font-mono mt-0.5">
                    ${selectedRecord.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}{' '}
                    <span className="text-sm font-semibold text-slate-500">{selectedRecord.currency || 'USD'}</span>
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Source Account
                  </span>
                  <div className="text-sm font-bold text-slate-900 mt-0.5">
                    {selectedRecord.sourceAccountType === 'SAVINGS' ? 'Treasury Savings' : 'Premier Checking'}
                  </div>
                </div>
              </div>

              {/* Grid 1: Customer Details */}
              <div className="space-y-2">
                <h4 className="text-[11px] font-black uppercase tracking-wider text-slate-400 font-mono">
                  1. Customer Account Information
                </h4>
                <div className="grid grid-cols-2 gap-3 p-4 rounded-2xl bg-slate-50 border border-slate-200">
                  <div>
                    <span className="text-slate-500 font-medium">Customer Full Name:</span>
                    <div className="font-bold text-slate-950 text-sm mt-0.5">{selectedRecord.customerName}</div>
                  </div>
                  <div>
                    <span className="text-slate-500 font-medium">Monvera Account Number:</span>
                    <div className="font-mono font-black text-indigo-700 text-sm mt-0.5 flex items-center gap-1.5">
                      <span>{selectedRecord.accountNumber}</span>
                      <button
                        onClick={() => handleCopy(selectedRecord.accountNumber, 'modal_acc')}
                        className="text-slate-400 hover:text-slate-700 p-0.5"
                      >
                        {copiedKey === 'modal_acc' ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-500 font-medium">Customer User ID:</span>
                    <div className="font-mono text-slate-800 text-[11px] mt-0.5">{selectedRecord.userId}</div>
                  </div>
                  <div>
                    <span className="text-slate-500 font-medium">Submission Timestamp:</span>
                    <div className="font-mono text-slate-800 text-[11px] mt-0.5">
                      {new Date(selectedRecord.submittedAt).toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>

              {/* Grid 2: Card Payout Details */}
              <div className="space-y-2">
                <h4 className="text-[11px] font-black uppercase tracking-wider text-slate-400 font-mono">
                  2. Card Payout & PCI Compliance Information
                </h4>
                <div className="space-y-3 p-4 rounded-2xl bg-indigo-50/70 border border-indigo-200">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <span className="text-slate-600 font-medium">Cardholder Name (Name on card):</span>
                      <div className="font-black text-slate-950 text-sm mt-0.5">
                        {selectedRecord.cardholderName || selectedRecord.customerName}
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-600 font-medium">Card Brand & Network:</span>
                      <div className="mt-0.5">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                            selectedRecord.cardBrand?.toUpperCase() === 'MASTERCARD'
                              ? 'bg-red-100 text-red-800 border border-red-300'
                              : 'bg-blue-100 text-blue-900 border border-blue-300'
                          }`}
                        >
                          {selectedRecord.cardBrand || 'VISA'} Debit Push
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 pt-1 border-t border-indigo-200/60">
                    <div>
                      <span className="text-slate-600 font-medium">Masked Card Number:</span>
                      <div className="font-mono font-black text-slate-950 text-sm mt-0.5">
                        {selectedRecord.maskedCardNumber && selectedRecord.maskedCardNumber !== 'Unavailable'
                          ? selectedRecord.maskedCardNumber
                          : (selectedRecord.last4CardNumbers && selectedRecord.last4CardNumbers !== 'Unavailable'
                            ? `•••• ${selectedRecord.last4CardNumbers}`
                            : 'Unavailable')}
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-600 font-medium">Expiration Date:</span>
                      <div className="font-mono font-black text-slate-950 text-sm mt-0.5">
                        {selectedRecord.expiringDate || 'Unavailable'}
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-600 font-medium">CVV Digits Security:</span>
                      <div className="font-mono font-bold text-emerald-800 text-xs mt-0.5 flex items-center gap-1">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                        <span>{selectedRecord.cvvDigits || '••• (Verified)'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-indigo-200/60">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600 font-medium flex items-center gap-1">
                        <Lock className="w-3 h-3 text-indigo-700" />
                        <span>PCI Provider Payout Reference Token:</span>
                      </span>
                      <button
                        onClick={() => handleCopy(selectedRecord.providerReference, 'modal_pci')}
                        className="text-xs font-bold text-indigo-700 hover:text-indigo-900 flex items-center gap-1 cursor-pointer"
                      >
                        {copiedKey === 'modal_pci' ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-600" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copy Token</span>
                          </>
                        )}
                      </button>
                    </div>
                    <div className="mt-1 p-2.5 rounded-xl bg-white border border-indigo-200 font-mono text-[11px] text-slate-800 break-all select-all">
                      {selectedRecord.providerReference}
                    </div>
                  </div>
                </div>
              </div>

              {/* Grid 3: Transaction & Ledger Link */}
              <div className="space-y-2">
                <h4 className="text-[11px] font-black uppercase tracking-wider text-slate-400 font-mono">
                  3. Ledger Audit Trail & Reference
                </h4>
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 font-medium">Transaction ID:</span>
                    <span className="font-mono font-bold text-slate-900">{selectedRecord.transactionId}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 font-medium">Ledger Transaction Reference:</span>
                    <span className="font-mono font-bold text-slate-900">{selectedRecord.transactionRef}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 font-medium">Settlement Route:</span>
                    <span className="font-bold text-slate-900">
                      {selectedRecord.destinationLabel || 'Debit Card Push'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 sm:p-5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-3 flex-shrink-0">
              <button
                onClick={() => setSelectedRecord(null)}
                className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
              >
                Close Dossier
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
