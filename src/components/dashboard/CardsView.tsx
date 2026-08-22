import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { CardItem } from '../../types';
import {
  CreditCard,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Shield,
  ShieldCheck,
  Sliders,
  Globe,
  Smartphone,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Plus,
  X,
  Sparkles,
  ArrowRight,
  RefreshCw,
  Wallet,
  Phone,
  User,
  Zap,
  DollarSign,
  Layers,
} from 'lucide-react';

export const CardsView: React.FC = () => {
  const { currentUser, balanceMetrics, refreshBalance, refreshNotifications, openModal } = useAuth();
  const [cards, setCards] = useState<CardItem[]>([]);
  const [revealedCardId, setRevealedCardId] = useState<string | null>(null);
  const [copiedNumber, setCopiedNumber] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Card Creation Form State
  const [createStep, setCreateStep] = useState<'details' | 'payment' | 'success'>('details');
  const [cardBrand, setCardBrand] = useState<'VISA' | 'MASTERCARD'>('VISA');
  const [cardHolderName, setCardHolderName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [cardType, setCardType] = useState<'PHYSICAL' | 'VIRTUAL'>('PHYSICAL');
  const [cardCategory, setCardCategory] = useState<'DEBIT' | 'CREDIT'>('DEBIT');
  const [cardTier, setCardTier] = useState<string>('Obsidian World Elite');
  const [colorScheme, setColorScheme] = useState<string>('obsidian');
  const [bankingLimit, setBankingLimit] = useState<number>(20000);
  const [newlyCreatedCard, setNewlyCreatedCard] = useState<CardItem | null>(null);

  // Card limits editing state
  const [editingLimitCardId, setEditingLimitCardId] = useState<string | null>(null);
  const [tempLimitValue, setTempLimitValue] = useState<number>(20000);

  const checkingBalance = balanceMetrics?.checkingBalance ?? 0;
  const issuanceFee = 2.0; // $2.00 card issuance fee

  useEffect(() => {
    async function loadCards() {
      if (currentUser) {
        const res = await api.getCards(currentUser.id);
        if (res.cards) {
          setCards(res.cards);
        }
      }
    }
    loadCards();
  }, [currentUser]);

  // Reset/Pre-fill modal inputs when opened
  const handleOpenCreateModal = (initialBrand?: 'VISA' | 'MASTERCARD') => {
    if (currentUser) {
      setCardHolderName(`${currentUser.firstName} ${currentUser.lastName}`);
      setPhoneNumber(currentUser.phone || '+1 (555) 000-0000');
    }
    setCardBrand(initialBrand || 'VISA');
    setCardType('PHYSICAL');
    setCardCategory('DEBIT');
    setCardTier(initialBrand === 'MASTERCARD' ? 'Mastercard Black Edition' : 'Visa Obsidian World Elite');
    setColorScheme('obsidian');
    setBankingLimit(20000);
    setCreateStep('details');
    setActionError(null);
    setNewlyCreatedCard(null);
    setIsCreateModalOpen(true);
  };

  if (!currentUser) return null;

  const handleToggleFreeze = async (cardId: string) => {
    try {
      const res = await api.toggleCardFreeze(cardId);
      if (res.success && res.card) {
        setCards((prev) => prev.map((c) => (c.id === cardId ? res.card! : c)));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCopyCardNumber = (num: string, id: string) => {
    navigator.clipboard.writeText(num.replace(/\s+/g, ''));
    setCopiedNumber(id);
    setTimeout(() => setCopiedNumber(null), 2000);
  };

  const handleSaveLimit = async (cardId: string) => {
    try {
      const res = await api.updateCardLimits(cardId, {
        monthlyLimit: tempLimitValue,
        dailyLimit: tempLimitValue,
      });
      if (res.success && res.card) {
        setCards((prev) => prev.map((c) => (c.id === cardId ? res.card! : c)));
        setEditingLimitCardId(null);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleFeature = async (cardId: string, feature: 'international' | 'online' | 'atm') => {
    const targetCard = cards.find((c) => c.id === cardId);
    if (!targetCard) return;

    const updates: any = {};
    if (feature === 'international') updates.international = !targetCard.internationalEnabled;
    if (feature === 'online') updates.online = !targetCard.onlineEnabled;
    if (feature === 'atm') updates.atm = !targetCard.atmEnabled;

    try {
      const res = await api.updateCardLimits(cardId, updates);
      if (res.success && res.card) {
        setCards((prev) => prev.map((c) => (c.id === cardId ? res.card! : c)));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleProceedToPayment = () => {
    if (!cardHolderName.trim()) {
      setActionError('Please enter a valid cardholder name.');
      return;
    }
    if (!phoneNumber.trim()) {
      setActionError('Please enter a valid contact phone number.');
      return;
    }
    setActionError(null);
    setCreateStep('payment');
  };

  const handleExecuteCardCreation = async () => {
    if (checkingBalance < issuanceFee) {
      setActionError(
        `Insufficient checking balance ($${checkingBalance.toFixed(2)}). You need at least $${issuanceFee.toFixed(
          2
        )} to create your ${cardBrand === 'MASTERCARD' ? 'Mastercard' : 'Visa'} card.`
      );
      return;
    }

    setIsProcessing(true);
    setActionError(null);

    try {
      const tierTitle = `${cardBrand === 'MASTERCARD' ? 'Mastercard' : 'Visa'} ${
        cardCategory === 'DEBIT' ? 'Debit' : 'Credit'
      } • ${cardTier}`;

      const res = await api.createCard({
        userId: currentUser.id,
        cardHolderName: cardHolderName.trim(),
        phone: phoneNumber.trim(),
        cardType,
        cardTier: tierTitle,
        brand: cardBrand,
        spendingLimitMonthly: bankingLimit,
        spendingLimitDaily: bankingLimit,
        colorScheme,
      });

      if (res.success && res.card) {
        setCards((prev) => [res.card!, ...prev]);
        setNewlyCreatedCard(res.card);
        // Automatically refresh balances and notifications
        await refreshBalance();
        await refreshNotifications();
        setCreateStep('success');
      } else {
        setActionError(res.error || 'Failed to create card. Please check your balance.');
      }
    } catch (err: any) {
      setActionError(err.message || 'An unexpected error occurred while creating your card.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Color theme helper for visual cards
  const getCardBgClass = (scheme: string) => {
    switch (scheme) {
      case 'sapphire':
        return 'bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-950 border-blue-800/60 shadow-blue-950/40';
      case 'emerald':
        return 'bg-gradient-to-br from-slate-950 via-emerald-950 to-slate-900 border-emerald-800/60 shadow-emerald-950/40';
      case 'titanium':
        return 'bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950 border-slate-600/60 shadow-slate-950/40';
      case 'gold':
        return 'bg-gradient-to-br from-amber-950 via-stone-900 to-black border-amber-600/60 shadow-amber-950/40';
      case 'obsidian':
      default:
        return 'bg-gradient-to-br from-slate-950 via-slate-900 to-black border-slate-700/80 shadow-slate-950/50';
    }
  };

  // Brand Badge Renderer
  const renderBrandBadge = (brand?: string) => {
    if (brand === 'MASTERCARD') {
      return (
        <div className="flex items-center space-x-1 bg-slate-950/90 px-2.5 py-1 rounded-lg border border-slate-700/80 shadow-xs">
          <div className="flex -space-x-1.5 items-center">
            <div className="w-4 h-4 rounded-full bg-red-600 shadow-xs" />
            <div className="w-4 h-4 rounded-full bg-amber-500 opacity-90 shadow-xs" />
          </div>
          <span className="text-[10px] font-black tracking-tight text-white uppercase font-mono ml-1">
            Mastercard
          </span>
        </div>
      );
    }
    return (
      <div className="flex items-center space-x-1.5 font-mono">
        <span className="text-xs font-black italic tracking-tighter bg-white text-slate-950 px-2.5 py-0.5 rounded font-sans shadow-xs">
          VISA
        </span>
      </div>
    );
  };

  // Preview Card Number generator for modal
  const previewCardNumber = React.useMemo(() => {
    const prefix = cardBrand === 'MASTERCARD' ? '5421' : '4654';
    return `${prefix} 8392 4102 5985`;
  }, [cardBrand]);

  return (
    <div id="cards-management-view" className="space-y-8 animate-in fade-in duration-150">
      {/* Top Header & Banking Limit Summary Bar */}
      <div className="p-6 sm:p-7 rounded-3xl bg-slate-900 text-white border-2 border-slate-800 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-bold font-mono">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>VISA® & MASTERCARD® GLOBAL NETWORK • EMV CHIP & PIN</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
              Visa & Mastercard Banking Cards
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 max-w-xl font-medium">
              Manage your physical and virtual Visa and Mastercard debit and credit cards with a <strong>$20,000 daily transaction limit</strong>, instant freeze killswitch, and contactless security.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="p-3.5 rounded-2xl bg-slate-800/90 border border-slate-700 text-right min-w-[140px]">
              <span className="text-[10px] uppercase font-bold text-slate-400 font-mono block">
                Checking Balance
              </span>
              <span className="text-lg font-black font-mono text-emerald-400">
                ${checkingBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                id="btn-open-create-visa-header"
                onClick={() => handleOpenCreateModal('VISA')}
                className="px-4 py-3.5 rounded-2xl bg-white hover:bg-slate-100 text-slate-950 font-black text-xs sm:text-sm flex items-center space-x-1.5 shadow-lg transition-all hover:scale-105 active:scale-95 cursor-pointer"
              >
                <Plus className="w-4 h-4 stroke-[3] text-sky-700" />
                <span>+ Visa Card ($2.00)</span>
              </button>
              <button
                id="btn-open-create-mastercard-header"
                onClick={() => handleOpenCreateModal('MASTERCARD')}
                className="px-4 py-3.5 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs sm:text-sm flex items-center space-x-1.5 shadow-lg shadow-amber-500/20 transition-all hover:scale-105 active:scale-95 cursor-pointer"
              >
                <Plus className="w-4 h-4 stroke-[3] text-red-900" />
                <span>+ Mastercard ($2.00)</span>
              </button>
            </div>
          </div>
        </div>

        {/* Banking Limits Quick Strip */}
        <div className="mt-6 pt-5 border-t border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono">
          <div>
            <span className="text-slate-400 block text-[11px]">Card Issuance Fee</span>
            <span className="text-white font-bold text-sm">$2.00 USD</span>
          </div>
          <div>
            <span className="text-slate-400 block text-[11px]">Daily Transaction Limit</span>
            <span className="text-emerald-400 font-bold text-sm">$20,000.00 / day</span>
          </div>
          <div>
            <span className="text-slate-400 block text-[11px]">Active Cards on File</span>
            <span className="text-white font-bold text-sm">{cards.length} Cards</span>
          </div>
          <div>
            <span className="text-slate-400 block text-[11px]">Supported Networks</span>
            <span className="text-emerald-400 font-bold text-sm">Visa & Mastercard</span>
          </div>
        </div>
      </div>

      {/* --- SCENARIO 1: NO CARDS PRESENT (EMPTY STATE / CARD CREATION HERO) --- */}
      {cards.length === 0 ? (
        <div className="p-8 sm:p-12 rounded-3xl bg-white border-2 border-slate-200 text-center space-y-6 shadow-sm">
          <div className="w-20 h-20 rounded-3xl bg-emerald-50 text-emerald-700 border-2 border-emerald-200 flex items-center justify-center mx-auto shadow-inner">
            <CreditCard className="w-10 h-10 stroke-[2]" />
          </div>

          <div className="max-w-md mx-auto space-y-2">
            <h3 className="text-2xl font-black text-slate-950">No Banking Cards Issued Yet</h3>
            <p className="text-sm text-slate-600 leading-relaxed font-medium">
              You currently do not have any active cards. You can choose between a <strong>Visa</strong> or <strong>Mastercard</strong> with full 16-digit card security, a one-time <strong>$2.00 creation fee</strong>, and a default daily limit of <strong>$20,000.00</strong>.
            </p>
          </div>

          {/* Balance & Fee Indicator Banner */}
          <div className="max-w-md mx-auto p-4 rounded-2xl bg-slate-50 border-2 border-slate-200 text-left space-y-2">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-600 font-bold">One-Time Issuance Fee:</span>
              <span className="text-slate-900 font-black">$2.00 USD</span>
            </div>
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-600 font-bold">Default Daily Limit:</span>
              <span className="text-emerald-700 font-black">$20,000.00 USD</span>
            </div>
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-600 font-bold">Your Checking Balance:</span>
              <span className={`font-black ${checkingBalance >= 2 ? 'text-emerald-700' : 'text-red-700'}`}>
                ${checkingBalance.toFixed(2)} USD
              </span>
            </div>
            {checkingBalance < 2 && (
              <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] font-bold text-amber-900 flex items-center space-x-1.5 mt-2">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>You need at least $2.00 in your checking account to issue a card.</span>
              </div>
            )}
          </div>

          {/* Action Buttons: Choose Visa or Mastercard */}
          <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
            {checkingBalance >= 2 ? (
              <>
                <button
                  onClick={() => handleOpenCreateModal('VISA')}
                  className="px-7 py-4 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-black text-sm flex items-center space-x-2 shadow-lg shadow-slate-900/20 transition-all hover:scale-105 active:scale-95 cursor-pointer"
                >
                  <Plus className="w-5 h-5 stroke-[3] text-sky-400" />
                  <span>Issue Visa Card ($2.00)</span>
                </button>
                <button
                  onClick={() => handleOpenCreateModal('MASTERCARD')}
                  className="px-7 py-4 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-sm flex items-center space-x-2 shadow-lg shadow-amber-500/20 transition-all hover:scale-105 active:scale-95 cursor-pointer"
                >
                  <Plus className="w-5 h-5 stroke-[3] text-red-900" />
                  <span>Issue Mastercard ($2.00)</span>
                </button>
              </>
            ) : (
              <button
                onClick={() => openModal('deposit')}
                className="px-8 py-4 rounded-2xl bg-sky-600 hover:bg-sky-700 text-white font-black text-sm flex items-center space-x-2 shadow-lg shadow-sky-600/20 transition-all hover:scale-105 active:scale-95 cursor-pointer"
              >
                <Wallet className="w-5 h-5" />
                <span>Deposit Funds to Enable Card Creation</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        /* --- SCENARIO 2: USER HAS CARDS (CARDS GRID & CONTROLS) --- */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {cards.map((card) => {
            const isMasked = revealedCardId === `masked_${card.id}`;
            const isFrozen = card.status === 'FROZEN';
            const isEditingLimit = editingLimitCardId === card.id;
            const fullCardNumber = card.cardNumber || card.fullNumberMasked || '4654 8392 4102 5985';
            const displayCardNumber = isMasked ? card.maskedNumber : fullCardNumber;

            return (
              <div key={card.id} className="space-y-6">
                {/* Visual Card Graphic */}
                <div
                  className={`relative h-64 sm:h-72 rounded-3xl p-7 text-white shadow-2xl border-2 transition-all duration-300 flex flex-col justify-between overflow-hidden ${getCardBgClass(
                    card.colorScheme
                  )} ${isFrozen ? 'grayscale opacity-75' : ''}`}
                >
                  {/* Subtle Glass Sheen */}
                  <div className="absolute top-0 right-0 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

                  {/* Top Row: Chip, Card Tier, & Brand Badge */}
                  <div className="flex items-center justify-between relative z-10">
                    <div className="flex items-center gap-3">
                      {/* EMV Brass Smart Chip */}
                      <div className="w-11 h-8 rounded-md bg-gradient-to-br from-amber-200 via-amber-300 to-amber-500 border border-amber-600/40 flex items-center justify-center shadow-inner">
                        <div className="w-7 h-5 border border-amber-800/40 rounded-xs grid grid-cols-2 gap-0.5 p-0.5">
                          <div className="bg-amber-700/20" />
                          <div className="bg-amber-700/20" />
                          <div className="bg-amber-700/20" />
                          <div className="bg-amber-700/20" />
                        </div>
                      </div>
                      <span className="text-[11px] font-mono tracking-widest text-emerald-400 uppercase font-black">
                        {card.cardTier}
                      </span>
                    </div>

                    <div className="text-right flex items-center space-x-2">
                      <span className="font-extrabold tracking-widest text-base uppercase font-mono text-white">
                        MONVERA
                      </span>
                      {renderBrandBadge(card.brand || (card.cardNumber?.startsWith('5') ? 'MASTERCARD' : 'VISA'))}
                    </div>
                  </div>

                  {/* Middle: Complete 16-Digit Card Number with Reveal & Copy */}
                  <div className="space-y-1 relative z-10 my-auto">
                    <div className="text-lg sm:text-2xl font-mono tracking-wider sm:tracking-widest font-black text-white flex items-center gap-2 sm:gap-3 flex-wrap">
                      <span className="select-all">{displayCardNumber}</span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setRevealedCardId(isMasked ? null : `masked_${card.id}`)}
                          className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-slate-200 hover:text-white transition-colors cursor-pointer"
                          title={isMasked ? 'Show complete 16-digit card number' : 'Hide / Mask card number'}
                        >
                          {isMasked ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => handleCopyCardNumber(fullCardNumber, card.id)}
                          className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-slate-200 hover:text-white transition-colors cursor-pointer"
                          title="Copy complete 16-digit card number"
                        >
                          {copiedNumber === card.id ? (
                            <Check className="w-4 h-4 text-emerald-400" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>

                    {isFrozen && (
                      <span className="inline-block text-[10px] font-mono uppercase font-black text-red-300 bg-red-950/90 px-2.5 py-0.5 rounded border border-red-700">
                        Card Frozen & Locked
                      </span>
                    )}
                  </div>

                  {/* Bottom Row: Cardholder Name, Expiry & CVV */}
                  <div className="flex items-end justify-between relative z-10 pt-2 border-t border-slate-700/80">
                    <div>
                      <span className="text-[9px] uppercase tracking-wider text-slate-400 font-mono block">
                        Cardholder
                      </span>
                      <span className="text-sm font-bold tracking-wide uppercase font-mono text-white">
                        {card.cardHolderName}
                      </span>
                    </div>

                    <div className="flex items-center gap-5">
                      <div>
                        <span className="text-[9px] uppercase tracking-wider text-slate-400 font-mono block">
                          Expires
                        </span>
                        <span className="text-xs font-bold font-mono text-white">{card.expiryDate}</span>
                      </div>

                      <div>
                        <span className="text-[9px] uppercase tracking-wider text-slate-400 font-mono block">
                          CVV
                        </span>
                        <span className="text-xs font-bold font-mono text-white">
                          {!isMasked ? card.cvvMasked : '•••'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Card Controls, Protection & Limit Adjuster */}
                <div className="p-6 rounded-3xl bg-white border-2 border-slate-200 shadow-xs space-y-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-black text-slate-950 text-sm">Card Controls & Protection</h4>
                      <p className="text-xs text-slate-500 font-medium">Instant security toggles and banking limit</p>
                    </div>

                    <button
                      onClick={() => handleToggleFreeze(card.id)}
                      className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer ${
                        isFrozen
                          ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                          : 'bg-red-50 hover:bg-red-100 text-red-700 border border-red-200'
                      }`}
                    >
                      {isFrozen ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                      <span>{isFrozen ? 'Unfreeze Card' : 'Freeze Card'}</span>
                    </button>
                  </div>

                  {/* Daily / Monthly Banking Limit Box */}
                  <div className="p-4 rounded-2xl bg-slate-50 border-2 border-slate-200 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <span className="text-xs font-bold text-slate-700 block">
                          Daily Transaction Limit
                        </span>
                        <span className="text-lg font-black font-mono text-slate-950">
                          ${(card.spendingLimitDaily || 20000).toLocaleString()} USD
                        </span>
                      </div>

                      <button
                        onClick={() => {
                          if (isEditingLimit) {
                            setEditingLimitCardId(null);
                          } else {
                            setEditingLimitCardId(card.id);
                            setTempLimitValue(card.spendingLimitDaily || 20000);
                          }
                        }}
                        className="px-3 py-1.5 rounded-xl text-xs font-bold text-sky-800 bg-sky-50 hover:bg-sky-100 border border-sky-200 transition-colors cursor-pointer"
                      >
                        {isEditingLimit ? 'Cancel' : 'Change Limit'}
                      </button>
                    </div>

                    {isEditingLimit ? (
                      <div className="pt-2 border-t border-slate-200 space-y-3">
                        <div className="grid grid-cols-5 gap-1.5">
                          {[5000, 10000, 15000, 20000, 50000].map((val) => (
                            <button
                              key={val}
                              onClick={() => setTempLimitValue(val)}
                              className={`py-1.5 rounded-lg text-xs font-bold font-mono transition-colors cursor-pointer ${
                                tempLimitValue === val
                                  ? 'bg-slate-900 text-white'
                                  : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-100'
                              }`}
                            >
                              ${val >= 1000 ? `${val / 1000}k` : val}
                            </button>
                          ))}
                        </div>

                        <div className="flex items-center justify-between gap-3">
                          <input
                            type="range"
                            min="500"
                            max="50000"
                            step="500"
                            value={tempLimitValue}
                            onChange={(e) => setTempLimitValue(Number(e.target.value))}
                            className="flex-1 accent-slate-900"
                          />
                          <button
                            onClick={() => handleSaveLimit(card.id)}
                            className="px-4 py-1.5 rounded-xl text-xs font-black bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs cursor-pointer"
                          >
                            Save ${tempLimitValue.toLocaleString()}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="w-full bg-slate-200 h-2.5 rounded-full overflow-hidden">
                          <div
                            className="bg-emerald-500 h-full rounded-full transition-all duration-300"
                            style={{
                              width: `${Math.min(100, (card.currentDailySpend / (card.spendingLimitDaily || 20000)) * 100 || 2)}%`,
                            }}
                          />
                        </div>
                        <div className="flex justify-between text-[11px] text-slate-500 font-mono font-bold">
                          <span>${card.currentDailySpend.toFixed(2)} spent today</span>
                          <span>Daily Limit: ${(card.spendingLimitDaily || 20000).toLocaleString()} USD</span>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Security Feature Toggles */}
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <button
                      onClick={() => handleToggleFeature(card.id, 'international')}
                      className="p-3.5 rounded-2xl bg-slate-50 hover:bg-slate-100 border border-slate-200 flex items-center justify-between text-left transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <Globe className="w-4 h-4 text-sky-600" />
                        <span className="font-bold text-slate-800">International</span>
                      </div>
                      <span
                        className={`text-[10px] font-black px-2 py-0.5 rounded-md ${
                          card.internationalEnabled ? 'text-emerald-800 bg-emerald-100' : 'text-slate-500 bg-slate-200'
                        }`}
                      >
                        {card.internationalEnabled ? 'ON' : 'OFF'}
                      </span>
                    </button>

                    <button
                      onClick={() => handleToggleFeature(card.id, 'online')}
                      className="p-3.5 rounded-2xl bg-slate-50 hover:bg-slate-100 border border-slate-200 flex items-center justify-between text-left transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <Smartphone className="w-4 h-4 text-emerald-600" />
                        <span className="font-bold text-slate-800">Online & Mobile</span>
                      </div>
                      <span
                        className={`text-[10px] font-black px-2 py-0.5 rounded-md ${
                          card.onlineEnabled ? 'text-emerald-800 bg-emerald-100' : 'text-slate-500 bg-slate-200'
                        }`}
                      >
                        {card.onlineEnabled ? 'ON' : 'OFF'}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* --- CREATE / ISSUE CARD POP-UP MODAL --- */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-lg w-full overflow-hidden shadow-2xl border-2 border-slate-200 flex flex-col max-h-[92vh]">
            
            {/* Modal Header */}
            <div className="p-6 bg-slate-900 text-white flex items-center justify-between relative border-b border-slate-800">
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <CreditCard className="w-5 h-5 text-emerald-400" />
                  <span className="text-xs font-mono font-black text-emerald-400 uppercase tracking-wider">
                    Official Card Issuance
                  </span>
                </div>
                <h3 className="text-xl font-black tracking-tight text-white">
                  {createStep === 'details' && `Configure Your ${cardBrand === 'MASTERCARD' ? 'Mastercard' : 'Visa'} Card`}
                  {createStep === 'payment' && 'Review & Authorize Payment'}
                  {createStep === 'success' && 'Card Activated & Ready!'}
                </h3>
              </div>

              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1">
              
              {/* STEP 1: CARD DETAILS & CUSTOMIZATION */}
              {createStep === 'details' && (
                <div className="space-y-5">
                  {/* Dynamic Card Live Preview (Full 16 digits preview) */}
                  <div
                    className={`relative h-48 sm:h-52 rounded-2xl p-5 text-white shadow-xl border transition-all duration-300 flex flex-col justify-between overflow-hidden ${getCardBgClass(
                      colorScheme
                    )}`}
                  >
                    <div className="flex items-center justify-between relative z-10">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-6 rounded bg-amber-300 border border-amber-600/40 shadow-inner" />
                        <span className="text-[10px] font-mono tracking-wider text-emerald-400 uppercase font-black">
                          {cardBrand === 'MASTERCARD' ? 'Mastercard' : 'Visa'} • {cardCategory === 'DEBIT' ? 'Debit' : 'Credit'}
                        </span>
                      </div>
                      <div className="flex items-center space-x-1.5 font-mono">
                        <span className="text-xs font-black uppercase text-white">MONVERA</span>
                        {renderBrandBadge(cardBrand)}
                      </div>
                    </div>

                    <div className="my-auto relative z-10">
                      <span className="text-base sm:text-lg font-mono font-black tracking-wider text-white">
                        {previewCardNumber}
                      </span>
                    </div>

                    <div className="flex items-end justify-between relative z-10 border-t border-slate-700/60 pt-1.5">
                      <div>
                        <span className="text-[8px] uppercase tracking-wider text-slate-400 font-mono block">
                          Cardholder
                        </span>
                        <span className="text-xs font-bold font-mono uppercase text-white truncate max-w-[180px] block">
                          {cardHolderName || 'YOUR NAME'}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[8px] uppercase tracking-wider text-slate-400 font-mono block">
                          Expires
                        </span>
                        <span className="text-[11px] font-bold font-mono text-white">08/31</span>
                      </div>
                    </div>
                  </div>

                  {/* Brand Selector: Mastercard vs Visa */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-black text-slate-700 uppercase tracking-wide">
                      Select Card Brand (Visa or Mastercard)
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setCardBrand('VISA');
                          setCardTier('Visa Obsidian Elite');
                        }}
                        className={`p-3.5 rounded-2xl border-2 text-left transition-all cursor-pointer flex items-center justify-between ${
                          cardBrand === 'VISA'
                            ? 'border-sky-600 bg-sky-50/50 text-slate-900 shadow-sm ring-2 ring-sky-600/30'
                            : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <div>
                          <span className="text-xs font-black block">Visa Card</span>
                          <span className="text-[11px] text-slate-500 block font-mono">Prefix: 4xxx</span>
                        </div>
                        <span className="text-xs font-black italic bg-white text-slate-950 px-2 py-0.5 rounded border border-slate-300 font-sans shadow-2xs">
                          VISA
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setCardBrand('MASTERCARD');
                          setCardTier('Mastercard Black Edition');
                        }}
                        className={`p-3.5 rounded-2xl border-2 text-left transition-all cursor-pointer flex items-center justify-between ${
                          cardBrand === 'MASTERCARD'
                            ? 'border-amber-600 bg-amber-50/50 text-slate-900 shadow-sm ring-2 ring-amber-600/30'
                            : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <div>
                          <span className="text-xs font-black block">Mastercard</span>
                          <span className="text-[11px] text-slate-500 block font-mono">Prefix: 5xxx</span>
                        </div>
                        <div className="flex -space-x-1.5 items-center">
                          <div className="w-4 h-4 rounded-full bg-red-600 shadow-xs" />
                          <div className="w-4 h-4 rounded-full bg-amber-500 opacity-90 shadow-xs" />
                        </div>
                      </button>
                    </div>
                  </div>

                  {/* Field: Cardholder Name (Auto-filled) */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-black text-slate-700 uppercase tracking-wide flex items-center space-x-1">
                      <User className="w-3.5 h-3.5 text-sky-600" />
                      <span>Cardholder Name (Auto-Filled)</span>
                    </label>
                    <input
                      type="text"
                      value={cardHolderName}
                      onChange={(e) => setCardHolderName(e.target.value)}
                      placeholder="e.g. ELEANOR VANCE"
                      className="w-full px-4 py-3 rounded-2xl bg-slate-50 border-2 border-slate-200 text-sm font-bold text-slate-900 uppercase font-mono focus:bg-white focus:border-sky-600 outline-hidden transition-all"
                    />
                  </div>

                  {/* Field: Phone Number */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-black text-slate-700 uppercase tracking-wide flex items-center space-x-1">
                      <Phone className="w-3.5 h-3.5 text-sky-600" />
                      <span>Contact Phone Number</span>
                    </label>
                    <input
                      type="tel"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      placeholder="+1 (555) 000-0000"
                      className="w-full px-4 py-3 rounded-2xl bg-slate-50 border-2 border-slate-200 text-sm font-bold text-slate-900 font-mono focus:bg-white focus:border-sky-600 outline-hidden transition-all"
                    />
                  </div>

                  {/* Card Type Selector: Debit vs Credit */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-black text-slate-700 uppercase tracking-wide">
                      Select Card Type
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setCardCategory('DEBIT')}
                        className={`p-3.5 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                          cardCategory === 'DEBIT'
                            ? 'border-slate-900 bg-slate-900 text-white shadow-md'
                            : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <span className="text-xs font-black block">Debit Card</span>
                        <span className="text-[11px] opacity-80 block">Direct checking linkage</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setCardCategory('CREDIT')}
                        className={`p-3.5 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                          cardCategory === 'CREDIT'
                            ? 'border-slate-900 bg-slate-900 text-white shadow-md'
                            : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <span className="text-xs font-black block">Credit Card</span>
                        <span className="text-[11px] opacity-80 block">Revolving zero fee line</span>
                      </button>
                    </div>
                  </div>

                  {/* Card Styling / Color Scheme */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-black text-slate-700 uppercase tracking-wide">
                      Select Card Style & Metal Tier
                    </label>
                    <div className="grid grid-cols-5 gap-2">
                      {[
                        { id: 'obsidian', name: 'Obsidian', color: 'bg-slate-950 border-slate-700' },
                        { id: 'sapphire', name: 'Sapphire', color: 'bg-blue-950 border-blue-600' },
                        { id: 'emerald', name: 'Emerald', color: 'bg-emerald-950 border-emerald-600' },
                        { id: 'titanium', name: 'Titanium', color: 'bg-slate-800 border-slate-400' },
                        { id: 'gold', name: 'Gold', color: 'bg-amber-950 border-amber-500' },
                      ].map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            setColorScheme(item.id);
                            setCardTier(`${cardBrand === 'MASTERCARD' ? 'Mastercard' : 'Visa'} ${item.name} Edition`);
                          }}
                          className={`p-2 rounded-xl border-2 flex flex-col items-center gap-1 transition-all cursor-pointer ${
                            colorScheme === item.id ? 'border-sky-600 ring-2 ring-sky-600/30' : 'border-slate-200'
                          }`}
                        >
                          <div className={`w-6 h-6 rounded-full border ${item.color}`} />
                          <span className="text-[10px] font-bold text-slate-700">{item.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Daily Transaction Limit Setting (Default $20,000) */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-black text-slate-700 uppercase">Daily Transaction Limit</span>
                      <span className="font-mono font-black text-slate-900">${bankingLimit.toLocaleString()} USD</span>
                    </div>
                    <div className="grid grid-cols-5 gap-1.5 font-mono">
                      {[5000, 10000, 15000, 20000, 50000].map((val) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setBankingLimit(val)}
                          className={`py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                            bankingLimit === val
                              ? 'bg-slate-900 text-white shadow-xs'
                              : 'bg-slate-100 hover:bg-slate-200 text-slate-800'
                          }`}
                        >
                          ${val >= 1000 ? `${val / 1000}k` : val}
                        </button>
                      ))}
                    </div>
                  </div>

                  {actionError && (
                    <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-xs font-bold text-red-800 flex items-center space-x-2">
                      <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                      <span>{actionError}</span>
                    </div>
                  )}
                </div>
              )}

              {/* STEP 2: PAYMENT & ISSUANCE REVIEW ($2.00 FEE) */}
              {createStep === 'payment' && (
                <div className="space-y-5">
                  <div className="p-5 rounded-2xl bg-slate-50 border-2 border-slate-200 space-y-4">
                    <h4 className="text-xs font-black uppercase text-slate-500 font-mono tracking-wider">
                      Card Issuance Summary
                    </h4>

                    <div className="space-y-2 text-xs font-mono">
                      <div className="flex justify-between py-1 border-b border-slate-200">
                        <span className="text-slate-600">Card Product:</span>
                        <span className="font-black text-slate-900 uppercase">
                          {cardBrand} {cardCategory === 'DEBIT' ? 'Debit Card' : 'Credit Card'} ({cardTier})
                        </span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-200">
                        <span className="text-slate-600">Cardholder:</span>
                        <span className="font-black text-slate-900">{cardHolderName}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-200">
                        <span className="text-slate-600">Contact Phone:</span>
                        <span className="font-black text-slate-900">{phoneNumber}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-200">
                        <span className="text-slate-600">Daily Limit:</span>
                        <span className="font-black text-slate-900">${bankingLimit.toLocaleString()} USD</span>
                      </div>
                      <div className="flex justify-between py-1.5 text-sm">
                        <span className="font-bold text-slate-900">Issuance Fee:</span>
                        <span className="font-black text-emerald-700">${issuanceFee.toFixed(2)} USD</span>
                      </div>
                    </div>
                  </div>

                  {/* Payment Source Account Verification */}
                  <div className="p-5 rounded-2xl bg-white border-2 border-slate-200 space-y-3">
                    <span className="text-xs font-black uppercase text-slate-500 font-mono tracking-wider block">
                      Payment Account Verification
                    </span>

                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <span className="text-sm font-bold text-slate-900 block">Monvera Checking Account</span>
                        <span className="text-xs font-mono text-slate-500 font-bold">
                          MVB •••• {currentUser.permanentAccountNumber.slice(-4)}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-xs text-slate-500 block">Available Balance</span>
                        <span className="text-base font-black font-mono text-slate-900">
                          ${checkingBalance.toFixed(2)} USD
                        </span>
                      </div>
                    </div>

                    {checkingBalance >= issuanceFee ? (
                      <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-900 flex items-center space-x-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span>Sufficient funds available. $2.00 will be charged to activate your {cardBrand} card.</span>
                      </div>
                    ) : (
                      <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs font-bold text-red-900 space-y-2">
                        <div className="flex items-center space-x-2">
                          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                          <span>
                            Insufficient Funds: You have ${checkingBalance.toFixed(2)} available. A $2.00 balance is required.
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setIsCreateModalOpen(false);
                            openModal('deposit');
                          }}
                          className="w-full py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-black text-xs transition-colors cursor-pointer"
                        >
                          Deposit Funds to Checking
                        </button>
                      </div>
                    )}
                  </div>

                  {actionError && (
                    <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-xs font-bold text-red-800 flex items-center space-x-2">
                      <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                      <span>{actionError}</span>
                    </div>
                  )}
                </div>
              )}

              {/* STEP 3: SUCCESS & ACTIVATION */}
              {createStep === 'success' && newlyCreatedCard && (
                <div className="space-y-6 text-center">
                  <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-md">
                    <Check className="w-8 h-8 stroke-[3]" />
                  </div>

                  <div className="space-y-1">
                    <h4 className="text-xl font-black text-slate-950">
                      {newlyCreatedCard.brand === 'MASTERCARD' ? 'Mastercard' : 'Visa'} Card Activated!
                    </h4>
                    <p className="text-xs text-slate-600 font-medium">
                      Your card is live with complete 16-digit access and a ${bankingLimit.toLocaleString()} daily limit.
                    </p>
                  </div>

                  {/* Minted Card Graphic with Complete 16 Digits */}
                  <div
                    className={`relative h-48 sm:h-52 rounded-2xl p-5 text-white shadow-xl border text-left flex flex-col justify-between overflow-hidden ${getCardBgClass(
                      newlyCreatedCard.colorScheme
                    )}`}
                  >
                    <div className="flex items-center justify-between relative z-10">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-6 rounded bg-amber-300 border border-amber-600/40" />
                        <span className="text-[10px] font-mono tracking-wider text-emerald-400 uppercase font-black">
                          {newlyCreatedCard.cardTier}
                        </span>
                      </div>
                      {renderBrandBadge(newlyCreatedCard.brand)}
                    </div>

                    <div className="my-auto relative z-10">
                      <span className="text-lg font-mono font-black tracking-wider text-white">
                        {newlyCreatedCard.cardNumber || newlyCreatedCard.fullNumberMasked}
                      </span>
                    </div>

                    <div className="flex items-end justify-between relative z-10 border-t border-slate-700/60 pt-1.5">
                      <div>
                        <span className="text-[8px] uppercase tracking-wider text-slate-400 font-mono block">
                          Cardholder
                        </span>
                        <span className="text-xs font-bold font-mono uppercase text-white">
                          {newlyCreatedCard.cardHolderName}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-right">
                        <div>
                          <span className="text-[8px] uppercase tracking-wider text-slate-400 font-mono block">
                            Expires
                          </span>
                          <span className="text-[11px] font-bold font-mono text-white">
                            {newlyCreatedCard.expiryDate}
                          </span>
                        </div>
                        <div>
                          <span className="text-[8px] uppercase tracking-wider text-slate-400 font-mono block">
                            CVV
                          </span>
                          <span className="text-[11px] font-bold font-mono text-white">
                            {newlyCreatedCard.cvvMasked}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-center gap-3">
                    <button
                      onClick={() =>
                        handleCopyCardNumber(
                          newlyCreatedCard.cardNumber || newlyCreatedCard.fullNumberMasked,
                          newlyCreatedCard.id
                        )
                      }
                      className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-800 flex items-center space-x-1.5 transition-colors cursor-pointer"
                    >
                      {copiedNumber === newlyCreatedCard.id ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>{copiedNumber === newlyCreatedCard.id ? 'Copied' : 'Copy Full 16 Digits'}</span>
                    </button>

                    <button
                      onClick={() => {
                        alert('Card added to Apple Pay & Google Wallet securely.');
                      }}
                      className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white flex items-center space-x-1.5 transition-colors cursor-pointer"
                    >
                      <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Add to Apple / Google Pay</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer Actions */}
            <div className="p-6 bg-slate-50 border-t-2 border-slate-200 flex items-center justify-between gap-3">
              {createStep === 'details' && (
                <>
                  <button
                    type="button"
                    onClick={() => setIsCreateModalOpen(false)}
                    className="px-5 py-2.5 rounded-2xl text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleProceedToPayment}
                    className="px-6 py-2.5 rounded-2xl text-xs font-black text-white bg-slate-900 hover:bg-slate-800 shadow-md flex items-center space-x-2 transition-all cursor-pointer"
                  >
                    <span>Continue to Payment ($2.00)</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </>
              )}

              {createStep === 'payment' && (
                <>
                  <button
                    type="button"
                    onClick={() => setCreateStep('details')}
                    className="px-5 py-2.5 rounded-2xl text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 transition-colors cursor-pointer"
                  >
                    Back to Details
                  </button>
                  <button
                    type="button"
                    disabled={isProcessing || checkingBalance < issuanceFee}
                    onClick={handleExecuteCardCreation}
                    className={`px-6 py-2.5 rounded-2xl text-xs font-black text-white shadow-md flex items-center space-x-2 transition-all cursor-pointer ${
                      checkingBalance >= issuanceFee
                        ? 'bg-emerald-600 hover:bg-emerald-700'
                        : 'bg-slate-400 cursor-not-allowed'
                    }`}
                  >
                    {isProcessing ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Issuing Card...</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4 stroke-[3]" />
                        <span>Authorize & Pay $2.00</span>
                      </>
                    )}
                  </button>
                </>
              )}

              {createStep === 'success' && (
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="w-full py-3 rounded-2xl text-xs font-black text-white bg-slate-900 hover:bg-slate-800 shadow-md transition-all cursor-pointer"
                >
                  Done & Return to Cards Manager
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
