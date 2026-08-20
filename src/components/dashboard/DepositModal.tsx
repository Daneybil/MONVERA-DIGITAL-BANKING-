import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import confetti from 'canvas-confetti';
import {
  X,
  ArrowRight,
  Landmark,
  CreditCard,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Wallet,
  Coins,
  Check,
  Sparkles,
  Link,
  ChevronRight,
} from 'lucide-react';

export const DepositModal: React.FC = () => {
  const { activeModal, closeModal, currentUser, balanceMetrics, refreshBalance, refreshNotifications } = useAuth();
  const [depositMethod, setDepositMethod] = useState<'CARD' | 'ACH' | 'WIRE' | 'INSTANT_PAY' | 'CRYPTO_WALLET'>('CARD');
  const [destinationAccount, setDestinationAccount] = useState<'CHECKING' | 'SAVINGS'>('CHECKING');
  const [amount, setAmount] = useState<string>('5000');
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [paymentRef, setPaymentRef] = useState<string | null>(null);

  // Web3 / Crypto State
  const [cryptoWalletConnected, setCryptoWalletConnected] = useState(false);
  const [selectedWalletProvider, setSelectedWalletProvider] = useState<'MetaMask' | 'Coinbase' | 'WalletConnect' | 'TrustWallet'>('MetaMask');
  const [selectedCryptoNetwork, setSelectedCryptoNetwork] = useState<'Ethereum' | 'Polygon' | 'Arbitrum' | 'BSC'>('Ethereum');
  const [selectedCryptoToken, setSelectedCryptoToken] = useState<'USDT' | 'USDC' | 'ETH'>('USDT');
  const [connectedWalletAddress, setConnectedWalletAddress] = useState<string>('0x71C...8B3e');
  const [isConnectingWallet, setIsConnectingWallet] = useState(false);

  if (activeModal !== 'deposit' || !currentUser) return null;

  const handleConnectWallet = () => {
    setIsConnectingWallet(true);
    setTimeout(() => {
      const randomHex = `0x${Math.random().toString(16).substring(2, 6)}...${Math.random().toString(16).substring(2, 6)}`;
      setConnectedWalletAddress(randomHex);
      setCryptoWalletConnected(true);
      setIsConnectingWallet(false);
    }, 600);
  };

  const handleDepositSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setErrorMessage('Please enter a valid deposit amount.');
      return;
    }

    if (depositMethod === 'CRYPTO_WALLET' && !cryptoWalletConnected) {
      setErrorMessage('Please connect your Web3 Crypto Wallet first.');
      return;
    }

    setErrorMessage(null);
    setIsProcessing(true);

    try {
      const providerPaymentId = `GATEWAY-${depositMethod}-${Math.floor(100000 + Math.random() * 900000)}`;
      const res = await api.createDeposit({
        userId: currentUser.id,
        amount: numAmount,
        method: depositMethod,
        destinationAccountType: destinationAccount,
        providerPaymentId,
        metadata:
          depositMethod === 'CRYPTO_WALLET'
            ? {
                walletProvider: selectedWalletProvider,
                network: selectedCryptoNetwork,
                token: selectedCryptoToken,
                walletAddress: connectedWalletAddress,
              }
            : undefined,
      });

      if (res.success && res.transaction) {
        setIsSuccess(true);
        setPaymentRef(res.transaction.referenceNumber);
        await refreshBalance();
        await refreshNotifications();
        confetti({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#059669', '#10b981', '#0f172a', '#3b82f6'],
        });
      } else {
        setErrorMessage(res.error || "We couldn't complete your deposit. Please try again.");
      }
    } catch (err: any) {
      setErrorMessage('Failed to connect to payment verification provider.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReset = () => {
    setIsSuccess(false);
    setPaymentRef(null);
    setAmount('5000');
    setErrorMessage(null);
    closeModal();
  };

  const checkingAcc = balanceMetrics?.accounts?.find((a) => a.type === 'CHECKING');
  const savingsAcc = balanceMetrics?.accounts?.find((a) => a.type === 'SAVINGS');

  return (
    <div
      id="deposit-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isProcessing) handleReset();
      }}
    >
      <div
        id="deposit-modal-container"
        className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl border-2 border-slate-200 overflow-hidden relative max-h-[94vh] flex flex-col"
      >
        {/* Header */}
        <div className="p-6 sm:p-7 bg-slate-50 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-slate-950 text-emerald-400 flex items-center justify-center font-black shadow-sm">
              <Landmark className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-black text-slate-950">Deposit & Add Funds</h2>
              <p className="text-xs text-slate-500 font-semibold">Institutional Verified Payment & Liquidity Gateway</p>
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

        {/* Content Body */}
        <div className="p-6 sm:p-8 overflow-y-auto flex-1 space-y-6">
          {errorMessage && (
            <div className="p-4 rounded-2xl bg-red-50 border-2 border-red-200 text-xs sm:text-sm text-red-800 font-medium flex items-start gap-3">
              <AlertCircle className="w-5 h-5 flex-shrink-0 text-red-600 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {!isSuccess ? (
            <form onSubmit={handleDepositSubmit} className="space-y-6">
              
              {/* 1. Destination Account Selector */}
              <div className="space-y-2.5">
                <label className="block text-xs font-black text-slate-900 uppercase tracking-wider font-mono">
                  1. Select Destination Account
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setDestinationAccount('CHECKING')}
                    className={`p-4 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                      destinationAccount === 'CHECKING'
                        ? 'bg-emerald-50/90 border-emerald-600 text-slate-950 ring-2 ring-emerald-500/20 shadow-sm'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-slate-900">Premier Checking</span>
                      {destinationAccount === 'CHECKING' && <Check className="w-4 h-4 text-emerald-600 font-bold" />}
                    </div>
                    <div className="text-sm font-black font-mono text-emerald-700 mt-1">
                      ${checkingAcc ? checkingAcc.balance.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '0.00'}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono mt-0.5">•••• {currentUser.permanentAccountNumber.slice(-4)}</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDestinationAccount('SAVINGS')}
                    className={`p-4 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                      destinationAccount === 'SAVINGS'
                        ? 'bg-emerald-50/90 border-emerald-600 text-slate-950 ring-2 ring-emerald-500/20 shadow-sm'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-slate-900">High-Yield Treasury Savings</span>
                      {destinationAccount === 'SAVINGS' && <Check className="w-4 h-4 text-emerald-600 font-bold" />}
                    </div>
                    <div className="text-sm font-black font-mono text-emerald-700 mt-1">
                      ${savingsAcc ? savingsAcc.balance.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '0.00'}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono mt-0.5">4.85% APY • Auto-Compounding</div>
                  </button>
                </div>
              </div>

              {/* 2. Funding Method Selector */}
              <div className="space-y-2.5">
                <label className="block text-xs font-black text-slate-900 uppercase tracking-wider font-mono">
                  2. Select Funding Method
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <button
                    type="button"
                    onClick={() => setDepositMethod('CARD')}
                    className={`p-3.5 rounded-2xl border-2 text-left transition-all cursor-pointer flex flex-col justify-between ${
                      depositMethod === 'CARD'
                        ? 'bg-emerald-50/90 border-emerald-600 text-slate-950 ring-2 ring-emerald-500/20 shadow-sm'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <CreditCard className="w-5 h-5 text-emerald-600 mb-2" />
                    <div>
                      <div className="font-bold text-xs text-slate-950">Debit / Credit Card</div>
                      <div className="text-[10px] text-slate-500 font-medium">Instant Gateway</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDepositMethod('ACH')}
                    className={`p-3.5 rounded-2xl border-2 text-left transition-all cursor-pointer flex flex-col justify-between ${
                      depositMethod === 'ACH'
                        ? 'bg-emerald-50/90 border-emerald-600 text-slate-950 ring-2 ring-emerald-500/20 shadow-sm'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <Landmark className="w-5 h-5 text-emerald-600 mb-2" />
                    <div>
                      <div className="font-bold text-xs text-slate-950">Bank ACH Transfer</div>
                      <div className="text-[10px] text-slate-500 font-medium">US Bank Link</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDepositMethod('WIRE')}
                    className={`p-3.5 rounded-2xl border-2 text-left transition-all cursor-pointer flex flex-col justify-between ${
                      depositMethod === 'WIRE'
                        ? 'bg-emerald-50/90 border-emerald-600 text-slate-950 ring-2 ring-emerald-500/20 shadow-sm'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <ShieldCheck className="w-5 h-5 text-emerald-600 mb-2" />
                    <div>
                      <div className="font-bold text-xs text-slate-950">Domestic FedWire</div>
                      <div className="text-[10px] text-slate-500 font-medium">Same-Day Sovereign</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDepositMethod('INSTANT_PAY')}
                    className={`p-3.5 rounded-2xl border-2 text-left transition-all cursor-pointer flex flex-col justify-between ${
                      depositMethod === 'INSTANT_PAY'
                        ? 'bg-emerald-50/90 border-emerald-600 text-slate-950 ring-2 ring-emerald-500/20 shadow-sm'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <RefreshCw className="w-5 h-5 text-emerald-600 mb-2" />
                    <div>
                      <div className="font-bold text-xs text-slate-950">Instant RTP</div>
                      <div className="text-[10px] text-slate-500 font-medium">Real-Time Rails</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDepositMethod('CRYPTO_WALLET')}
                    className={`p-3.5 rounded-2xl border-2 text-left transition-all cursor-pointer flex flex-col justify-between col-span-2 sm:col-span-2 ${
                      depositMethod === 'CRYPTO_WALLET'
                        ? 'bg-indigo-50/90 border-indigo-600 text-slate-950 ring-2 ring-indigo-500/20 shadow-sm'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <Wallet className="w-5 h-5 text-indigo-600" />
                      <span className="text-[10px] font-black font-mono px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800">
                        WEB3 CRYPTO
                      </span>
                    </div>
                    <div>
                      <div className="font-bold text-xs text-slate-950">Crypto Wallet Deposit</div>
                      <div className="text-[10px] text-slate-500 font-medium">
                        {cryptoWalletConnected ? `Connected: ${connectedWalletAddress}` : 'Connect Wallet (USDT / USDC / ETH)'}
                      </div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Web3 Crypto Details Box when Crypto is selected */}
              {depositMethod === 'CRYPTO_WALLET' && (
                <div className="p-4 sm:p-5 rounded-2xl bg-indigo-50/70 border-2 border-indigo-200 space-y-4 animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Coins className="w-4 h-4 text-indigo-600" />
                      <span className="text-xs font-black text-indigo-950 uppercase font-mono">Web3 Wallet Configuration</span>
                    </div>
                    {cryptoWalletConnected ? (
                      <span className="flex items-center gap-1.5 text-xs font-mono font-bold text-emerald-700 bg-emerald-100 px-2.5 py-0.5 rounded-full">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        Connected
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={handleConnectWallet}
                        disabled={isConnectingWallet}
                        className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer"
                      >
                        <Link className="w-3.5 h-3.5" />
                        {isConnectingWallet ? 'Connecting...' : 'Connect Wallet'}
                      </button>
                    )}
                  </div>

                  {cryptoWalletConnected ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div className="p-2.5 rounded-xl bg-white border border-indigo-100">
                          <span className="text-[10px] text-slate-500 block font-mono">Wallet</span>
                          <span className="font-bold text-slate-900 font-mono">{connectedWalletAddress}</span>
                        </div>
                        <div className="p-2.5 rounded-xl bg-white border border-indigo-100">
                          <span className="text-[10px] text-slate-500 block font-mono">Token</span>
                          <select
                            value={selectedCryptoToken}
                            onChange={(e) => setSelectedCryptoToken(e.target.value as any)}
                            className="font-bold text-slate-900 font-mono bg-transparent w-full cursor-pointer focus:outline-none"
                          >
                            <option value="USDT">USDT (Tether)</option>
                            <option value="USDC">USDC (USD Coin)</option>
                            <option value="ETH">ETH (Ethereum)</option>
                          </select>
                        </div>
                        <div className="p-2.5 rounded-xl bg-white border border-indigo-100">
                          <span className="text-[10px] text-slate-500 block font-mono">Network</span>
                          <select
                            value={selectedCryptoNetwork}
                            onChange={(e) => setSelectedCryptoNetwork(e.target.value as any)}
                            className="font-bold text-slate-900 font-mono bg-transparent w-full cursor-pointer focus:outline-none"
                          >
                            <option value="Ethereum">ERC-20</option>
                            <option value="Polygon">Polygon</option>
                            <option value="Arbitrum">Arbitrum</option>
                            <option value="BSC">BNB Chain</option>
                          </select>
                        </div>
                      </div>
                      <div className="text-[11px] text-indigo-900 font-medium flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                        <span>Instant 1:1 auto-conversion to USD credited directly to your selected bank account.</span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-indigo-800 font-medium">
                      Click <strong className="font-bold">Connect Wallet</strong> to link your MetaMask, Coinbase, or Trust Wallet and authorize instant stablecoin funding.
                    </div>
                  )}
                </div>
              )}

              {/* 3. Amount Input */}
              <div className="space-y-2">
                <label className="block text-xs font-black text-slate-900 uppercase tracking-wider font-mono">
                  3. Enter Deposit Amount (USD)
                </label>
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
                    className="w-full pl-10 pr-4 py-3.5 text-2xl sm:text-3xl font-black font-mono text-slate-950 rounded-2xl border-2 border-slate-300 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-white"
                  />
                </div>
              </div>

              {/* Presets */}
              <div className="grid grid-cols-4 gap-2">
                {[1000, 5000, 25000, 100000].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setAmount(preset.toString())}
                    className="py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-mono font-black text-slate-800 transition-colors cursor-pointer border border-slate-200"
                  >
                    +${preset.toLocaleString()}
                  </button>
                ))}
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isProcessing}
                  className="w-full py-4 px-6 rounded-2xl font-black text-base text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 transition-all shadow-lg hover:shadow-xl active:translate-y-0.5 flex items-center justify-center gap-2.5 cursor-pointer"
                >
                  {isProcessing ? (
                    <>
                      <div className="w-5 h-5 border-3 border-white border-t-transparent animate-spin rounded-full" />
                      <span>Verifying & Crediting Account...</span>
                    </>
                  ) : (
                    <>
                      <span>Authorize & Deposit ${parseFloat(amount || '0').toLocaleString()} USD</span>
                      <ArrowRight className="w-5 h-5 text-white" />
                    </>
                  )}
                </button>
              </div>
            </form>
          ) : (
            <div className="text-center space-y-6 animate-in zoom-in-95 py-4">
              <div className="w-20 h-20 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-md">
                <CheckCircle2 className="w-12 h-12 text-emerald-600" />
              </div>

              <div className="space-y-1.5">
                <h3 className="text-2xl sm:text-3xl font-black text-slate-950">Deposit Confirmed</h3>
                <div className="text-3xl sm:text-4xl font-black text-emerald-600 font-mono">
                  +${parseFloat(amount).toLocaleString('en-US', { minimumFractionDigits: 2 })} USD
                </div>
                <p className="text-xs sm:text-sm text-slate-600 font-medium max-w-md mx-auto">
                  Funds have been verified by payment provider and settled into your{' '}
                  <strong className="text-slate-900 font-bold">
                    {destinationAccount === 'SAVINGS' ? 'High-Yield Treasury Savings' : 'Premier Checking Account'}
                  </strong>.
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-slate-50 border-2 border-slate-200 text-left space-y-2.5 text-xs font-mono">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-sans">Payment Reference:</span>
                  <span className="font-black text-slate-950">{paymentRef}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-sans">Destination Account:</span>
                  <span className="text-slate-900 font-sans font-bold">
                    Monvera {destinationAccount === 'SAVINGS' ? 'Savings' : 'Checking'} (•••• {currentUser.permanentAccountNumber.slice(-4)})
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-sans">Method:</span>
                  <span className="text-slate-800 font-sans font-semibold">
                    {depositMethod === 'CRYPTO_WALLET' ? `Web3 Wallet (${selectedCryptoToken})` : `${depositMethod} Protocol`}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                  <span className="text-slate-500 font-sans">Ledger Status:</span>
                  <span className="text-emerald-700 font-sans font-black">SETTLED & AVAILABLE</span>
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
