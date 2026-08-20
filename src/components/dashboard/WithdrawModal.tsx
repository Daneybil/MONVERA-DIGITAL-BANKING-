import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import {
  X,
  ArrowRight,
  Landmark,
  CreditCard,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Lock,
  Wallet,
  Building2,
  Check,
  Coins,
} from 'lucide-react';

const COMMON_BANKS = [
  'Chase Private Client',
  'Bank of America Merrill',
  'Wells Fargo Premier',
  'Citibank Private Bank',
  'Goldman Sachs Marcus',
  'Fidelity Cash Management',
];

export const WithdrawModal: React.FC = () => {
  const { activeModal, closeModal, currentUser, balanceMetrics, refreshBalance, refreshNotifications } = useAuth();
  const [sourceAccount, setSourceAccount] = useState<'CHECKING' | 'SAVINGS'>('CHECKING');
  const [destinationType, setDestinationType] = useState<'ACH_BANK' | 'FEDWIRE' | 'CARD' | 'CRYPTO'>('ACH_BANK');
  const [destinationLabel, setDestinationLabel] = useState('Chase Private Client Checking');
  const [accountOrIban, setAccountOrIban] = useState('8839201948');
  const [routingNumber, setRoutingNumber] = useState('021000021');
  const [amount, setAmount] = useState<string>('2500');
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [txRef, setTxRef] = useState<string | null>(null);

  if (activeModal !== 'withdraw' || !currentUser) return null;

  const checkingBal = balanceMetrics?.checkingBalance || 0;
  const savingsBal = balanceMetrics?.savingsBalance || 0;
  const availableBal = sourceAccount === 'CHECKING' ? checkingBal : savingsBal;

  const fee = destinationType === 'FEDWIRE' ? 15.0 : destinationType === 'CARD' ? 2.5 : 0.0;
  const numAmount = parseFloat(amount) || 0;
  const totalDeducted = numAmount + fee;

  const handleWithdrawSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (numAmount <= 0) {
      setErrorMessage('Please enter a valid withdrawal amount.');
      return;
    }
    if (totalDeducted > availableBal) {
      setErrorMessage(
        `Insufficient liquid funds in ${
          sourceAccount === 'CHECKING' ? 'Checking' : 'Savings'
        } ($${availableBal.toLocaleString('en-US', {
          minimumFractionDigits: 2,
        })}). Total required with settlement fee: $${totalDeducted.toFixed(2)}. Sovereign term deposits are locked until maturity.`
      );
      return;
    }

    setErrorMessage(null);
    setIsProcessing(true);

    try {
      const res = await api.createWithdrawal({
        userId: currentUser.id,
        amount: numAmount,
        destinationType,
        sourceAccountType: sourceAccount,
        destinationLabel,
        accountOrIban,
        routingNumber: destinationType !== 'CRYPTO' ? routingNumber : undefined,
      });

      if (res.success && res.transaction) {
        setIsSuccess(true);
        setTxRef(res.transaction.referenceNumber);
        await refreshBalance();
        await refreshNotifications();
      } else {
        setErrorMessage(res.error || "We couldn't complete this withdrawal. Please try again.");
      }
    } catch (err: any) {
      setErrorMessage('Network error while dispatching withdrawal request.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReset = () => {
    setIsSuccess(false);
    setTxRef(null);
    setAmount('2500');
    setErrorMessage(null);
    closeModal();
  };

  return (
    <div
      id="withdraw-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isProcessing) handleReset();
      }}
    >
      <div
        id="withdraw-modal-container"
        className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl border-2 border-slate-200 overflow-hidden relative max-h-[94vh] flex flex-col"
      >
        {/* Header */}
        <div className="p-6 sm:p-7 bg-slate-50 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-slate-950 text-emerald-400 flex items-center justify-center font-black shadow-sm">
              <Landmark className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-black text-slate-950">Withdraw Funds</h2>
              <p className="text-xs text-slate-500 font-semibold">External Bank Clearing & Sovereign Liquidity Rails</p>
            </div>
          </div>
          {!isProcessing && (
            <button
              onClick={handleReset}
              className="w-9 h-9 rounded-full bg-white hover:bg-slate-200 text-slate-600 hover:text-slate-950 flex items-center justify-center border border-slate-200 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-6 sm:p-8 overflow-y-auto flex-1 space-y-6">
          {errorMessage && (
            <div className="p-4 rounded-2xl bg-red-50 border-2 border-red-200 text-xs sm:text-sm text-red-800 font-medium flex items-start gap-3">
              <AlertCircle className="w-5 h-5 flex-shrink-0 text-red-600 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {!isSuccess ? (
            <form onSubmit={handleWithdrawSubmit} className="space-y-6">
              {/* 1. Withdraw From (Source Account) */}
              <div className="space-y-2.5">
                <label className="block text-xs font-black text-slate-900 uppercase tracking-wider font-mono">
                  1. Withdraw From Account
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setSourceAccount('CHECKING')}
                    className={`p-4 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                      sourceAccount === 'CHECKING'
                        ? 'bg-emerald-50/90 border-emerald-600 text-slate-950 ring-2 ring-emerald-500/20 shadow-sm'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-slate-900">Premier Checking Account</span>
                      {sourceAccount === 'CHECKING' && <Check className="w-4 h-4 text-emerald-600 font-bold" />}
                    </div>
                    <div className="text-sm font-black font-mono text-emerald-700 mt-1">
                      ${checkingBal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono mt-0.5">Liquid Operating Funds</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSourceAccount('SAVINGS')}
                    className={`p-4 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                      sourceAccount === 'SAVINGS'
                        ? 'bg-emerald-50/90 border-emerald-600 text-slate-950 ring-2 ring-emerald-500/20 shadow-sm'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-slate-900">High-Yield Treasury Savings</span>
                      {sourceAccount === 'SAVINGS' && <Check className="w-4 h-4 text-emerald-600 font-bold" />}
                    </div>
                    <div className="text-sm font-black font-mono text-emerald-700 mt-1">
                      ${savingsBal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono mt-0.5">4.85% APY Liquid Reserves</div>
                  </button>
                </div>
              </div>

              {/* 2. Destination Route */}
              <div className="space-y-2.5">
                <label className="block text-xs font-black text-slate-900 uppercase tracking-wider font-mono">
                  2. Select Settlement Route
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setDestinationType('ACH_BANK')}
                    className={`p-3.5 rounded-2xl border-2 text-center transition-all cursor-pointer ${
                      destinationType === 'ACH_BANK'
                        ? 'bg-emerald-50/90 border-emerald-600 text-slate-950 ring-2 ring-emerald-500/20 shadow-sm'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div className="font-bold text-xs text-slate-950">Standard ACH</div>
                    <div className="text-[10px] text-emerald-700 font-bold">$0.00 Fee</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDestinationType('FEDWIRE')}
                    className={`p-3.5 rounded-2xl border-2 text-center transition-all cursor-pointer ${
                      destinationType === 'FEDWIRE'
                        ? 'bg-emerald-50/90 border-emerald-600 text-slate-950 ring-2 ring-emerald-500/20 shadow-sm'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div className="font-bold text-xs text-slate-950">FedWire</div>
                    <div className="text-[10px] text-slate-500 font-semibold">$15.00 Wire Fee</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDestinationType('CARD')}
                    className={`p-3.5 rounded-2xl border-2 text-center transition-all cursor-pointer ${
                      destinationType === 'CARD'
                        ? 'bg-emerald-50/90 border-emerald-600 text-slate-950 ring-2 ring-emerald-500/20 shadow-sm'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div className="font-bold text-xs text-slate-950">Debit Push</div>
                    <div className="text-[10px] text-slate-500 font-semibold">Instant Card</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDestinationType('CRYPTO')}
                    className={`p-3.5 rounded-2xl border-2 text-center transition-all cursor-pointer ${
                      destinationType === 'CRYPTO'
                        ? 'bg-indigo-50/90 border-indigo-600 text-slate-950 ring-2 ring-indigo-500/20 shadow-sm'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div className="font-bold text-xs text-slate-950">Crypto Payout</div>
                    <div className="text-[10px] text-indigo-700 font-bold">USDT / USDC</div>
                  </button>
                </div>
              </div>

              {/* 3. Destination Bank or Address */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-black text-slate-900 uppercase tracking-wider font-mono">
                    3. Destination Details (Send to Other Banks)
                  </label>
                  {destinationType !== 'CRYPTO' && (
                    <span className="text-[11px] text-slate-500 font-medium">Or choose quick bank:</span>
                  )}
                </div>

                {destinationType !== 'CRYPTO' && (
                  <div className="flex flex-wrap gap-1.5 pb-1">
                    {COMMON_BANKS.map((bank) => (
                      <button
                        key={bank}
                        type="button"
                        onClick={() => setDestinationLabel(bank)}
                        className={`text-[11px] px-2.5 py-1 rounded-lg border font-semibold transition-all cursor-pointer ${
                          destinationLabel === bank
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border-slate-200'
                        }`}
                      >
                        {bank.split(' ')[0]}
                      </button>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                      {destinationType === 'CRYPTO' ? 'Wallet Network' : 'Bank / Institution Name'}
                    </label>
                    <input
                      type="text"
                      required
                      value={destinationLabel}
                      onChange={(e) => setDestinationLabel(e.target.value)}
                      placeholder={destinationType === 'CRYPTO' ? 'e.g. Ethereum (USDT ERC-20)' : 'e.g. Chase Bank'}
                      className="w-full px-4 py-3 text-sm rounded-xl border-2 border-slate-200 focus:ring-2 focus:ring-emerald-500 bg-white font-medium"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                      {destinationType === 'CRYPTO' ? 'Recipient Crypto Address' : 'Account / IBAN Number'}
                    </label>
                    <input
                      type="text"
                      required
                      value={accountOrIban}
                      onChange={(e) => setAccountOrIban(e.target.value)}
                      placeholder={destinationType === 'CRYPTO' ? '0x...' : '8839201948'}
                      className="w-full px-4 py-3 text-sm font-mono rounded-xl border-2 border-slate-200 focus:ring-2 focus:ring-emerald-500 bg-white font-bold"
                    />
                  </div>
                </div>

                {destinationType !== 'CRYPTO' && (
                  <div className="space-y-1.5">
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Routing Number (ABA / SWIFT)
                    </label>
                    <input
                      type="text"
                      required
                      value={routingNumber}
                      onChange={(e) => setRoutingNumber(e.target.value)}
                      placeholder="021000021"
                      className="w-full px-4 py-3 text-sm font-mono rounded-xl border-2 border-slate-200 focus:ring-2 focus:ring-emerald-500 bg-white font-bold"
                    />
                  </div>
                )}
              </div>

              {/* 4. Amount Input */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-black text-slate-900 uppercase tracking-wider font-mono">
                    4. Withdrawal Amount (USD)
                  </label>
                  <span className="text-xs text-slate-600 font-mono font-semibold">
                    Available in {sourceAccount === 'CHECKING' ? 'Checking' : 'Savings'}:{' '}
                    <strong className="text-slate-950 font-black">
                      ${availableBal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </strong>
                  </span>
                </div>
                <div className="relative">
                  <span className="absolute left-5 top-3.5 text-2xl font-black text-slate-400 font-mono">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="10"
                    required
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full pl-10 pr-4 py-3.5 text-2xl sm:text-3xl font-black font-mono text-slate-950 rounded-2xl border-2 border-slate-300 focus:ring-2 focus:ring-emerald-500 bg-white"
                  />
                </div>
              </div>

              {/* Financial Calculation Breakdown */}
              <div className="p-4 sm:p-5 rounded-2xl bg-slate-50 border-2 border-slate-200 space-y-2 text-xs sm:text-sm">
                <div className="flex items-center justify-between text-slate-600">
                  <span>Requested Principal:</span>
                  <span className="font-mono font-bold text-slate-900">${numAmount.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between text-slate-600">
                  <span>Settlement Route Fee:</span>
                  <span className="font-mono font-bold text-slate-900">${fee.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between pt-2.5 border-t border-slate-200 font-black text-slate-950">
                  <span>Total Debit from {sourceAccount === 'CHECKING' ? 'Checking' : 'Savings'}:</span>
                  <span className="font-mono text-base text-emerald-700">${totalDeducted.toFixed(2)} USD</span>
                </div>
              </div>

              {/* Capital Preservation Notice */}
              <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-amber-50/80 border-2 border-amber-200/80 text-xs text-amber-900">
                <Lock className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" />
                <span className="font-medium">
                  Invested funds (${balanceMetrics?.investedBalance.toLocaleString() || '0'}) are actively locked in term sovereign contracts with 4.5% interest and cannot be withdrawn before maturity.
                </span>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isProcessing}
                  className="w-full py-4 px-6 rounded-2xl font-black text-base text-white bg-slate-950 hover:bg-slate-800 disabled:opacity-50 transition-all shadow-lg hover:shadow-xl active:translate-y-0.5 flex items-center justify-center gap-2.5 cursor-pointer"
                >
                  {isProcessing ? (
                    <>
                      <div className="w-5 h-5 border-3 border-white border-t-transparent animate-spin rounded-full" />
                      <span>Dispatching Funds...</span>
                    </>
                  ) : (
                    <>
                      <span>Authorize Withdrawal</span>
                      <ArrowRight className="w-5 h-5 text-emerald-400" />
                    </>
                  )}
                </button>
              </div>
            </form>
          ) : (
            <div className="text-center space-y-6 animate-in zoom-in-95 py-3">
              <div className="w-20 h-20 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-md">
                <CheckCircle2 className="w-12 h-12 text-emerald-600" />
              </div>

              <div className="space-y-1.5">
                <h3 className="text-2xl sm:text-3xl font-black text-slate-950">Withdrawal Dispatched</h3>
                <div className="text-3xl sm:text-4xl font-black text-slate-950 font-mono">
                  -${numAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD
                </div>
                <p className="text-xs sm:text-sm text-slate-600 font-medium">
                  Successfully dispatched to {destinationLabel} (•••• {accountOrIban.slice(-4)})
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-slate-50 border-2 border-slate-200 text-left space-y-2.5 text-xs font-mono">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-sans">Settlement Reference:</span>
                  <span className="font-black text-slate-950">{txRef}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-sans">Source Account:</span>
                  <span className="font-bold text-slate-900 font-sans">
                    Monvera {sourceAccount === 'CHECKING' ? 'Premier Checking' : 'Treasury Savings'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-sans">Clearing Method:</span>
                  <span className="text-slate-800 font-sans font-semibold">{destinationType} Protocol</span>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                  <span className="text-slate-500 font-sans">Status:</span>
                  <span className="text-emerald-700 font-sans font-black">DISPATCHED (LEDGER RECORDED)</span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleReset}
                className="w-full py-4 rounded-2xl font-black text-base text-white bg-slate-950 hover:bg-slate-800 transition-colors shadow-lg cursor-pointer"
              >
                Return to Dashboard
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
