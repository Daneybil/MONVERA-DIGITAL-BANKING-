import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { LinkedBankAccountApplication } from '../../types';
import {
  Wallet,
  Landmark,
  TrendingUp,
  Copy,
  Check,
  Plus,
  ArrowRightLeft,
  ArrowRight,
  ShieldCheck,
  Download,
  AlertCircle,
  CheckCircle2,
  Clock,
  XCircle,
  Building2,
} from 'lucide-react';

export const AccountsView: React.FC = () => {
  const { currentUser, balanceMetrics, openModal, refreshBalance, refreshNotifications } = useAuth();
  const [copiedAcc, setCopiedAcc] = useState<string | null>(null);

  // Bank Account Applications State
  const [bankAccounts, setBankAccounts] = useState<LinkedBankAccountApplication[]>([]);
  const [isLoadingBanks, setIsLoadingBanks] = useState<boolean>(false);

  useEffect(() => {
    if (currentUser?.id) {
      loadBanks();
    }
  }, [currentUser?.id]);

  const loadBanks = async () => {
    if (!currentUser?.id) return;
    setIsLoadingBanks(true);
    try {
      const res = await api.getMyBankAccountApplications(currentUser.id);
      if (res.success && res.applications) {
        setBankAccounts(res.applications);
      }
    } catch (err) {
      console.warn('Could not load bank accounts:', err);
    } finally {
      setIsLoadingBanks(false);
    }
  };

  // Internal Transfer Form State (Between Checking and Savings)
  const [fromType, setFromType] = useState<'CHECKING' | 'SAVINGS'>('CHECKING');
  const [transferAmount, setTransferAmount] = useState<string>('1000');
  const [isTransferring, setIsTransferring] = useState<boolean>(false);
  const [transferMsg, setTransferMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  if (!currentUser) return null;

  if (!balanceMetrics) {
    return (
      <div className="p-8 sm:p-12 text-center bg-white rounded-3xl border border-slate-200 shadow-sm space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center mx-auto shadow-inner">
          <div className="w-6 h-6 border-3 border-emerald-600 border-t-transparent animate-spin rounded-full" />
        </div>
        <div>
          <h3 className="text-lg font-black text-slate-900">Synchronizing Account Ledger</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto font-medium">
            Retrieving authoritative checking, savings, and treasury balances from the Monvera Banking Core.
          </p>
        </div>
        <button
          onClick={() => refreshBalance()}
          className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-black transition-colors cursor-pointer shadow-xs"
        >
          Refresh Balances
        </button>
      </div>
    );
  }

  const copyToClipboard = (val: string, id: string) => {
    navigator.clipboard.writeText(val);
    setCopiedAcc(id);
    setTimeout(() => setCopiedAcc(null), 2000);
  };

  const handleInternalTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(transferAmount);
    if (isNaN(amount) || amount <= 0) {
      setTransferMsg({ type: 'error', text: 'Please enter a valid transfer amount.' });
      return;
    }

    const available = fromType === 'CHECKING' ? balanceMetrics.checkingBalance : balanceMetrics.savingsBalance;
    if (amount > available) {
      setTransferMsg({
        type: 'error',
        text: `Insufficient funds in ${fromType === 'CHECKING' ? 'Checking' : 'Savings'} account ($${available.toLocaleString()}).`,
      });
      return;
    }

    setIsTransferring(true);
    setTransferMsg(null);

    try {
      const res = await api.sendInternalTransfer({
        userId: currentUser.id,
        fromAccountType: fromType,
        toAccountType: fromType === 'CHECKING' ? 'SAVINGS' : 'CHECKING',
        amount,
      });

      if (res.success) {
        setTransferMsg({
          type: 'success',
          text: `Successfully transferred $${amount.toLocaleString()} between your accounts.`,
        });
        await refreshBalance();
        await refreshNotifications();
      } else {
        setTransferMsg({ type: 'error', text: res.error || 'Internal transfer failed.' });
      }
    } catch (err: any) {
      setTransferMsg({ type: 'error', text: 'Internal transfer request failed.' });
    } finally {
      setIsTransferring(false);
    }
  };

  const checkingAcc = balanceMetrics.accounts?.find((a) => a.type === 'CHECKING');
  const savingsAcc = balanceMetrics.accounts?.find((a) => a.type === 'SAVINGS');
  const investmentAcc = balanceMetrics.accounts?.find((a) => a.type === 'INVESTMENT');

  return (
    <div id="accounts-management-view" className="space-y-8 animate-in fade-in duration-150">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Accounts & Balances</h2>
          <p className="text-xs sm:text-sm text-slate-500">
            View account routing details, manage balances, and execute instant internal transfers.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => openModal('deposit')}
            className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-xs transition-colors flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Fund Account</span>
          </button>
        </div>
      </div>

      {/* Account Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* CHECKING ACCOUNT */}
        <div className="p-6 rounded-3xl bg-white border border-slate-200/90 shadow-sm space-y-5">
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center">
              <Wallet className="w-5 h-5" />
            </div>
            <span className="text-[10px] uppercase font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
              Primary Liquid
            </span>
          </div>

          <div>
            <span className="text-xs text-slate-400 font-mono">Available Liquid Balance</span>
            <div className="text-3xl font-extrabold font-mono text-slate-900">
              ${balanceMetrics.checkingBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100 space-y-2 text-xs font-mono">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-sans">Account No:</span>
              <div className="flex items-center gap-1 font-bold text-slate-800">
                <span>{checkingAcc?.accountNumber || currentUser.permanentAccountNumber}</span>
                <button
                  onClick={() => copyToClipboard(checkingAcc?.accountNumber || currentUser.permanentAccountNumber, 'chk')}
                  className="p-1 hover:bg-slate-200 rounded text-slate-400"
                >
                  {copiedAcc === 'chk' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-sans">Routing (MVB):</span>
              <span className="text-slate-700">021000021</span>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => openModal('send')}
              className="flex-1 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors text-center"
            >
              Send from Checking
            </button>
          </div>
        </div>

        {/* HIGH YIELD SAVINGS ACCOUNT */}
        <div className="p-6 rounded-3xl bg-white border border-slate-200/90 shadow-sm space-y-5">
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center justify-center">
              <Landmark className="w-5 h-5" />
            </div>
            <span className="text-[10px] uppercase font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
              4.85% APY
            </span>
          </div>

          <div>
            <span className="text-xs text-slate-400 font-mono">High-Yield Treasury Balance</span>
            <div className="text-3xl font-extrabold font-mono text-slate-900">
              ${balanceMetrics.savingsBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100 space-y-2 text-xs font-mono">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-sans">Account No:</span>
              <div className="flex items-center gap-1 font-bold text-slate-800">
                <span>{savingsAcc?.accountNumber || '1045829991'}</span>
                <button
                  onClick={() => copyToClipboard(savingsAcc?.accountNumber || '1045829991', 'sav')}
                  className="p-1 hover:bg-slate-200 rounded text-slate-400"
                >
                  {copiedAcc === 'sav' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-sans">Compounding:</span>
              <span className="text-slate-700 font-sans">Daily Ledger Credit</span>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => {
                setFromType('CHECKING');
                setTransferAmount('5000');
              }}
              className="flex-1 py-2 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-xl transition-colors text-center border border-emerald-200"
            >
              Deposit to High-Yield
            </button>
          </div>
        </div>

        {/* INVESTMENT ACCOUNT */}
        <div className="p-6 rounded-3xl bg-white border border-slate-200/90 shadow-sm space-y-5">
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 rounded-xl bg-slate-900 text-emerald-400 flex items-center justify-center">
              <TrendingUp className="w-5 h-5" />
            </div>
            <span className="text-[10px] uppercase font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
              60-360D Fixed Terms
            </span>
          </div>

          <div>
            <span className="text-xs text-slate-400 font-mono">Invested Capital Portfolio</span>
            <div className="text-3xl font-extrabold font-mono text-emerald-600">
              ${balanceMetrics.investedBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100 space-y-2 text-xs font-mono">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-sans">Yield Accrued:</span>
              <span className="text-amber-600 font-bold">+${balanceMetrics.accruedEarnings.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-sans">Strategy:</span>
              <span className="text-slate-700 font-sans">Sovereign Treasury</span>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => openModal('invest')}
              className="flex-1 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-colors text-center"
            >
              Invest Capital
            </button>
          </div>
        </div>

      </div>

      {/* --- INTERNAL TRANSFER TOOL --- */}
      <div className="p-6 sm:p-8 rounded-3xl bg-white border border-slate-200/90 shadow-xs space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
            <ArrowRightLeft className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900">Internal Account Transfer</h3>
            <p className="text-xs text-slate-500">
              Instantly move funds between your Checking and High-Yield Savings accounts with 0% fee.
            </p>
          </div>
        </div>

        {transferMsg && (
          <div
            className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 ${
              transferMsg.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-red-50 border-red-200 text-red-700'
            }`}
          >
            {transferMsg.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5 text-emerald-600" />
            ) : (
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-600" />
            )}
            <span>{transferMsg.text}</span>
          </div>
        )}

        <form onSubmit={handleInternalTransfer} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-center">
            
            {/* From Account */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                From Account
              </label>
              <select
                value={fromType}
                onChange={(e) => setFromType(e.target.value as any)}
                className="w-full px-4 py-2.5 text-xs font-semibold rounded-xl border border-slate-300 bg-white"
              >
                <option value="CHECKING">
                  Checking (${balanceMetrics.checkingBalance.toLocaleString()})
                </option>
                <option value="SAVINGS">
                  High-Yield Savings (${balanceMetrics.savingsBalance.toLocaleString()})
                </option>
              </select>
            </div>

            {/* To Account */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                To Account
              </label>
              <div className="px-4 py-2.5 text-xs font-semibold rounded-xl border border-slate-200 bg-slate-50 text-slate-700">
                {fromType === 'CHECKING'
                  ? `High-Yield Savings ($${balanceMetrics.savingsBalance.toLocaleString()})`
                  : `Checking ($${balanceMetrics.checkingBalance.toLocaleString()})`}
              </div>
            </div>

            {/* Amount */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                Amount (USD)
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-2.5 text-xs font-bold text-slate-400 font-mono">$</span>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  required
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  className="w-full pl-7 pr-4 py-2 text-sm font-bold font-mono rounded-xl border border-slate-300 bg-white"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={isTransferring}
              className="py-3 px-6 rounded-xl font-bold text-xs text-white bg-slate-900 hover:bg-slate-800 transition-colors shadow-sm flex items-center gap-2 cursor-pointer"
            >
              <span>{isTransferring ? 'Transferring...' : 'Execute Internal Transfer'}</span>
              <ArrowRight className="w-3.5 h-3.5 text-emerald-400" />
            </button>
          </div>
        </form>
      </div>

      {/* Linked External Bank Accounts Area */}
      <div className="p-6 sm:p-8 bg-white rounded-3xl border border-slate-200 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-slate-950 text-emerald-400 flex items-center justify-center font-bold shadow-xs">
              <Landmark className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-950">Linked Bank Accounts</h3>
              <p className="text-xs text-slate-500 font-medium">
                External bank accounts linked for verified wire and ACH payout settlement
              </p>
            </div>
          </div>

          <button
            onClick={() => openModal('withdraw')}
            className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black transition-colors flex items-center gap-1.5 self-start sm:self-center shadow-xs cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Link Bank Account</span>
          </button>
        </div>

        {isLoadingBanks ? (
          <div className="py-8 text-center text-xs font-bold text-slate-400">Loading linked bank accounts...</div>
        ) : bankAccounts.length === 0 ? (
          <div className="py-8 text-center space-y-2 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
            <Building2 className="w-8 h-8 text-slate-400 mx-auto" />
            <div className="font-bold text-xs text-slate-700">No External Bank Accounts Linked</div>
            <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
              Link your domestic or international checking or savings bank account to enable direct wire and ACH withdrawals.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {bankAccounts.map((app) => (
              <div
                key={app.id}
                className="p-4 rounded-2xl border-2 border-slate-200 bg-slate-50/70 space-y-2.5 transition-all hover:bg-white hover:border-slate-300"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-800">
                      <Landmark className="w-4 h-4 text-emerald-600" />
                    </div>
                    <div>
                      <h4 className="font-black text-xs text-slate-950">{app.bankName}</h4>
                      <p className="text-[10px] text-slate-500 font-medium">{app.country} • {app.currency}</p>
                    </div>
                  </div>

                  {app.status === 'approved' && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-300">
                      <Check className="w-3 h-3 text-emerald-600" />
                      Approved
                    </span>
                  )}
                  {app.status === 'pending' && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-300">
                      <Clock className="w-3 h-3 text-amber-600" />
                      Pending Review
                    </span>
                  )}
                  {app.status === 'rejected' && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-100 text-rose-800 border border-rose-300">
                      <XCircle className="w-3 h-3 text-rose-600" />
                      Rejected
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-slate-200/80">
                  <div>
                    <span className="text-[10px] text-slate-400 block font-semibold">Account Number</span>
                    <strong className="font-mono text-slate-900 text-xs">{app.maskedAccountNumber}</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block font-semibold">Beneficiary Name</span>
                    <strong className="text-slate-900 text-xs truncate block">{app.accountHolderName}</strong>
                  </div>
                </div>

                {app.status === 'pending' && (
                  <div className="p-2.5 rounded-xl bg-amber-100/60 border border-amber-200 text-[11px] text-amber-900 font-medium">
                    Pending Approval — Your bank account is being reviewed.
                  </div>
                )}
                {app.status === 'rejected' && app.rejectionReason && (
                  <div className="p-2.5 rounded-xl bg-rose-100/60 border border-rose-200 text-[11px] text-rose-900 font-medium">
                    Reason: {app.rejectionReason}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
};
