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
  Sliders,
  Globe,
  Smartphone,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
} from 'lucide-react';

export const CardsView: React.FC = () => {
  const { currentUser } = useAuth();
  const [cards, setCards] = useState<CardItem[]>([]);
  const [revealedCardId, setRevealedCardId] = useState<string | null>(null);
  const [copiedNumber, setCopiedNumber] = useState<string | null>(null);

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
    navigator.clipboard.writeText(num);
    setCopiedNumber(id);
    setTimeout(() => setCopiedNumber(null), 2000);
  };

  return (
    <div id="cards-management-view" className="space-y-8 animate-in fade-in duration-150">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Obsidian & Sapphire Cards</h2>
          <p className="text-xs sm:text-sm text-slate-500">
            Precision metal cards with instant freeze killswitches and dynamic spending controls.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-200 font-bold">
            Zero Foreign Transaction Fees
          </span>
        </div>
      </div>

      {/* Cards List Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {cards.map((card) => {
          const isRevealed = revealedCardId === card.id;
          const isFrozen = card.status === 'FROZEN';

          return (
            <div key={card.id} className="space-y-6">
              
              {/* Card Visual Graphic */}
              <div
                className={`relative h-64 sm:h-72 rounded-3xl p-7 text-white shadow-2xl border transition-all duration-300 flex flex-col justify-between overflow-hidden ${
                  card.colorScheme === 'obsidian'
                    ? 'bg-gradient-to-br from-slate-950 via-slate-900 to-black border-slate-700/80'
                    : 'bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-950 border-indigo-900/60'
                } ${isFrozen ? 'grayscale opacity-75' : ''}`}
              >
                {/* Visual Glass Sheen Overlay */}
                <div className="absolute top-0 right-0 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

                {/* Top Row: Brand & Chip */}
                <div className="flex items-center justify-between relative z-10">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-8 rounded-md bg-gradient-to-br from-amber-200 to-amber-400 border border-amber-500/40 flex items-center justify-center shadow-inner">
                      <div className="w-7 h-5 border border-amber-700/40 rounded-xs grid grid-cols-2 gap-0.5 p-0.5">
                        <div className="bg-amber-600/20" />
                        <div className="bg-amber-600/20" />
                        <div className="bg-amber-600/20" />
                        <div className="bg-amber-600/20" />
                      </div>
                    </div>
                    <span className="text-[11px] font-mono tracking-widest text-emerald-400 uppercase">
                      {card.cardTier}
                    </span>
                  </div>

                  <div className="text-right">
                    <span className="font-extrabold tracking-widest text-base uppercase font-mono">
                      MONVERA
                    </span>
                    <span className="text-[9px] block text-slate-400 font-mono">MV BANKING</span>
                  </div>
                </div>

                {/* Middle: Card Number */}
                <div className="space-y-1 relative z-10 my-auto">
                  <div className="text-xl sm:text-2xl font-mono tracking-widest font-extrabold text-white flex items-center gap-3">
                    <span>{isRevealed ? card.fullNumberMasked : card.maskedNumber}</span>
                    <button
                      onClick={() => setRevealedCardId(isRevealed ? null : card.id)}
                      className="p-1 text-slate-400 hover:text-white"
                      title={isRevealed ? 'Mask card number' : 'Reveal card number'}
                    >
                      {isRevealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {isFrozen && (
                    <span className="inline-block text-[10px] font-mono uppercase font-bold text-red-300 bg-red-950/80 px-2 py-0.5 rounded border border-red-800">
                      Card Currently Frozen
                    </span>
                  )}
                </div>

                {/* Bottom: Holder Name, Expiry & CVV */}
                <div className="flex items-end justify-between relative z-10 pt-2 border-t border-slate-800/80">
                  <div>
                    <span className="text-[9px] uppercase tracking-wider text-slate-400 font-mono block">
                      Cardholder
                    </span>
                    <span className="text-sm font-bold tracking-wide uppercase font-mono">
                      {card.cardHolderName}
                    </span>
                  </div>

                  <div className="flex items-center gap-6">
                    <div>
                      <span className="text-[9px] uppercase tracking-wider text-slate-400 font-mono block">
                        Expires
                      </span>
                      <span className="text-xs font-bold font-mono">{card.expiryDate}</span>
                    </div>

                    <div>
                      <span className="text-[9px] uppercase tracking-wider text-slate-400 font-mono block">
                        CVV
                      </span>
                      <span className="text-xs font-bold font-mono">
                        {isRevealed ? card.cvvMasked : '•••'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Controls Card */}
              <div className="p-6 rounded-3xl bg-white border border-slate-200 shadow-xs space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-slate-900 text-sm">Card Controls & Protection</h4>
                  <button
                    onClick={() => handleToggleFreeze(card.id)}
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-2xs ${
                      isFrozen
                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                        : 'bg-red-50 hover:bg-red-100 text-red-700 border border-red-200'
                    }`}
                  >
                    {isFrozen ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                    <span>{isFrozen ? 'Unfreeze Card' : 'Freeze Card'}</span>
                  </button>
                </div>

                {/* Spending Limit Slider Preview */}
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-600 font-medium">Monthly Spending Limit:</span>
                    <span className="font-mono font-bold text-slate-900">
                      ${card.spendingLimitMonthly.toLocaleString()} USD
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                    <div className="bg-emerald-500 h-full w-2/5 rounded-full" />
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                    <span>$0.00 spent</span>
                    <span>Limit: ${card.spendingLimitMonthly.toLocaleString()}</span>
                  </div>
                </div>

                {/* Toggles */}
                <div className="grid grid-cols-2 gap-3 pt-2 text-xs">
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Globe className="w-4 h-4 text-emerald-600" />
                      <span className="font-semibold text-slate-700">International</span>
                    </div>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${card.internationalEnabled ? 'text-emerald-700 bg-emerald-50' : 'text-slate-500 bg-slate-200'}`}>
                      {card.internationalEnabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Smartphone className="w-4 h-4 text-emerald-600" />
                      <span className="font-semibold text-slate-700">Apple Pay</span>
                    </div>
                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                      Ready
                    </span>
                  </div>
                </div>
              </div>

            </div>
          );
        })}
      </div>

    </div>
  );
};
