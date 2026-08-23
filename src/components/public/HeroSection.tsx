import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { MonveraLogo } from '../common/MonveraLogo';
import officeHeroImage from '../../assets/images/monvera_office_hero_1787152640128.jpg';
import luxuryCardholderImage from '../../assets/images/monvera_luxury_cardholder_1787487721200.jpg';
import { ArrowRight, Zap, TrendingUp, CreditCard, ChevronRight, Shield, CheckCircle2, LayoutDashboard, Sparkles, HelpCircle, Landmark, Star, Lock } from 'lucide-react';

export const HeroSection: React.FC = () => {
  const { currentUser, setCurrentView, openModal } = useAuth();
  const [getStartedClicked, setGetStartedClicked] = useState(false);

  const handleGetStartedClick = () => {
    setGetStartedClicked(true);
    openModal('auth_prompt');
  };

  const handleLoginClick = () => {
    if (currentUser) {
      setCurrentView(currentUser.role === 'super_admin' ? 'admin' : 'dashboard');
    } else {
      openModal('auth_login');
    }
  };

  const handleBankOffersClick = () => {
    setCurrentView('offers');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleInvestmentCenterClick = () => {
    setCurrentView('investments');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleHowItWorksClick = () => {
    setCurrentView('how-it-works');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <section className="relative overflow-hidden bg-[#FAF7F2] pt-20 pb-20 lg:pt-28 lg:pb-28 border-b border-amber-900/10">
      {/* Subtle Background Warm Milk Radial Atmosphere */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-96 bg-gradient-to-tr from-amber-200/25 via-orange-100/20 to-emerald-100/15 blur-3xl pointer-events-none" />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 relative text-center space-y-10">
        
        {/* Brand Logo & Trusted Digital Bank Worldwide Identifier */}
        <div className="flex flex-col items-center gap-4 pb-2">
          <MonveraLogo variant="full" size="lg" />
          <span className="text-[12px] sm:text-[13px] font-black tracking-wider text-slate-900 uppercase font-mono">
            MONVERA • THE TRUSTED DIGITAL BANK FOR THE PEOPLE WORLDWIDE
          </span>
        </div>

        {/* Main Headline */}
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-slate-950 leading-[1.14] max-w-4xl mx-auto">
          Simple, powerful banking to manage your money, earn high interest, and <span className="text-slate-900 underline decoration-emerald-500/60 underline-offset-8">grow your wealth</span>.
        </h1>

        {/* Supporting Concise Text - High Brightness & High Contrast Legibility */}
        <p className="text-lg sm:text-xl md:text-2xl text-slate-950 font-semibold max-w-3xl mx-auto leading-relaxed">
          Send money instantly, earn guaranteed returns on your savings, and spend anywhere with premium cards and zero hidden fees. Everything you need for personal and business finances in one easy dashboard.
        </p>

        {/* Stretched Bold Rectangular Monvera Executive Office Image */}
        <div className="w-full max-w-5xl mx-auto rounded-2xl sm:rounded-3xl overflow-hidden shadow-2xl border-2 border-slate-800/40 bg-slate-950 relative group transition-all duration-300 hover:shadow-slate-950/30">
          <img
            src={officeHeroImage}
            alt="Monvera Bank Executive Office Suite"
            className="w-full h-72 sm:h-96 md:h-[430px] object-cover transition-transform duration-700 group-hover:scale-102"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-950/20 to-transparent pointer-events-none" />
          <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between pointer-events-none">
            <span className="text-xs sm:text-sm uppercase font-mono tracking-widest text-emerald-400 font-extrabold bg-slate-950/95 backdrop-blur-xs px-4 py-2 rounded-xl border border-emerald-500/50 shadow-md">
              MONVERA EXECUTIVE BANKING OFFICE
            </span>
            <span className="text-xs sm:text-sm font-mono font-bold text-slate-200 bg-slate-900/95 px-3.5 py-2 rounded-xl border border-slate-700 shadow-md">
              WORLDWIDE
            </span>
          </div>
        </div>

        {/* Compact Centered 3D Action Buttons (Short & Centered) */}
        <div className="pt-2 w-full flex flex-col items-center justify-center mx-auto text-center">
          <div className="grid grid-cols-2 sm:grid-cols-2 gap-3 max-w-sm sm:max-w-md w-full mx-auto justify-items-center">
            {/* 3D Button 1: Get Started */}
            <button
              id="hero-get-started-btn"
              onClick={handleGetStartedClick}
              className="w-full max-w-[190px] inline-flex items-center justify-center gap-2 px-3 sm:px-4 py-3 text-xs sm:text-sm font-extrabold text-white bg-gradient-to-b from-slate-850 via-slate-900 to-black hover:from-slate-800 hover:to-slate-950 rounded-xl border border-slate-700 border-b-[4px] border-b-slate-950 shadow-md active:translate-y-1 active:border-b-[1px] active:shadow-2xs transition-all cursor-pointer select-none"
            >
              <span>Get Started</span>
              <ArrowRight className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            </button>

            {/* 3D Button 2: Monvera Bank Offers */}
            <button
              id="hero-bank-offers-btn"
              onClick={handleBankOffersClick}
              className="w-full max-w-[190px] inline-flex items-center justify-center gap-2 px-3 sm:px-4 py-3 text-xs sm:text-sm font-extrabold text-slate-950 bg-gradient-to-b from-white via-slate-50 to-slate-100 hover:bg-white rounded-xl border border-slate-300 border-b-[4px] border-b-slate-400 shadow-md active:translate-y-1 active:border-b-[1px] active:shadow-2xs transition-all cursor-pointer select-none"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span>Monvera Bank Offers</span>
            </button>

            {/* 3D Button 3: Monvera Investment Center */}
            <button
              id="hero-investment-center-btn"
              onClick={handleInvestmentCenterClick}
              className="w-full max-w-[190px] inline-flex items-center justify-center gap-2 px-3 sm:px-4 py-3 text-xs sm:text-sm font-extrabold text-white bg-gradient-to-b from-blue-600 via-blue-700 to-blue-800 hover:from-blue-500 hover:to-blue-700 rounded-xl border border-blue-400 border-b-[4px] border-b-blue-950 shadow-md active:translate-y-1 active:border-b-[1px] active:shadow-2xs transition-all cursor-pointer select-none"
            >
              <TrendingUp className="w-3.5 h-3.5 text-blue-200 shrink-0" />
              <span>Investment Center</span>
            </button>

            {/* 3D Button 4: How Monvera Bank Works */}
            <button
              id="hero-how-it-works-btn"
              onClick={handleHowItWorksClick}
              className="w-full max-w-[190px] inline-flex items-center justify-center gap-2 px-3 sm:px-4 py-3 text-xs sm:text-sm font-extrabold text-white bg-gradient-to-b from-amber-600 via-amber-700 to-amber-800 hover:from-amber-500 hover:to-amber-700 rounded-xl border border-amber-400 border-b-[4px] border-b-amber-950 shadow-md active:translate-y-1 active:border-b-[1px] active:shadow-2xs transition-all cursor-pointer select-none"
            >
              <HelpCircle className="w-3.5 h-3.5 text-amber-200 shrink-0" />
              <span>How It Works</span>
            </button>
          </div>
        </div>

        {/* Institutional Metrics Bar Positioned Directly on Top of Dark Investment Section with Bright, High-Contrast Letters */}
        <div className="pt-8 border-t-2 border-slate-200/90 max-w-2xl mx-auto space-y-6">
          <div className="grid grid-cols-3 gap-4 sm:gap-6 text-center">
            <div className="space-y-1">
              <div className="text-3xl sm:text-4xl font-black font-mono text-slate-950 tracking-tight">100%</div>
              <div className="text-xs sm:text-sm text-slate-900 font-bold uppercase tracking-wide">
                Full Reserve Settlement
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-3xl sm:text-4xl font-black font-mono text-slate-950 tracking-tight">60–360D</div>
              <div className="text-xs sm:text-sm text-slate-900 font-bold uppercase tracking-wide">
                Investment Term Plans
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-3xl sm:text-4xl font-black font-mono text-slate-950 tracking-tight">AES-256</div>
              <div className="text-xs sm:text-sm text-slate-900 font-bold uppercase tracking-wide">
                Cryptographic Security
              </div>
            </div>
          </div>

          {/* Prominent Review Rating with 4.9 Stars, Profile Avatars Lineup, and (2.4M+ Reviews) */}
          <div className="flex flex-col items-center justify-center gap-4 pt-3 pb-2">
            {/* Stars & Rating Summary */}
            <div className="flex flex-wrap items-center justify-center gap-3">
              <div className="flex items-center gap-1.5 bg-amber-50 px-3.5 py-1.5 rounded-full border-2 border-amber-300 shadow-sm">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="w-5 h-5 fill-amber-400 text-amber-500" />
                ))}
                <span className="text-base sm:text-lg font-black text-slate-950 font-mono ml-1">
                  4.9 / 5.0
                </span>
              </div>
              <span className="text-sm sm:text-base font-black text-emerald-950 bg-emerald-100 px-4 py-1.5 rounded-full border-2 border-emerald-400 shadow-sm">
                (2.4 Million Verified Reviews)
              </span>
            </div>

            {/* Lineup of Profile Icons of People who Reviewed - Overlapping Stack Design */}
            <div className="flex flex-col items-center justify-center gap-4 pt-1 w-full max-w-full px-2">
              {/* Profile Avatars Touching & Overlapping Each Other */}
              <div className="flex items-center justify-center -space-x-3 sm:-space-x-3.5 p-2 max-w-xl mx-auto overflow-x-auto py-3">
                {[
                  { name: 'Sarah Jenkins, Portfolio Lead', src: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80' },
                  { name: 'David Chen, Managing Director', src: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80' },
                  { name: 'Elena Rostova, Chief Analyst', src: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80' },
                  { name: 'Marcus Vance, Enterprise Partner', src: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80' },
                  { name: 'Chloe Dubois, Private Wealth Client', src: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&auto=format&fit=crop&q=80' },
                  { name: 'James Wilson, Treasury Strategist', src: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=150&auto=format&fit=crop&q=80' },
                  { name: 'Michael Sterling, Commercial Director', src: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=150&auto=format&fit=crop&q=80' },
                  { name: 'Nathalie Gomez, Senior Partner', src: 'https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?w=150&auto=format&fit=crop&q=80' },
                  { name: 'Tariq Al-Mansoor, Global Investor', src: 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=150&auto=format&fit=crop&q=80' },
                  { name: 'Yuki Tanaka, Investment Lead', src: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80' },
                  { name: 'Gabriel Santos, Wealth Manager', src: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=150&auto=format&fit=crop&q=80' },
                  { name: 'Brian O\'Connor, Capital Trustee', src: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&auto=format&fit=crop&q=80' },
                  { name: 'Amara Okafor, Institutional Member', src: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=150&auto=format&fit=crop&q=80' },
                  { name: 'Rachel Adams, Private Client', src: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=150&auto=format&fit=crop&q=80' },
                ].map((user, idx) => (
                  <div
                    key={idx}
                    title={user.name}
                    className="relative flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 rounded-full border-[3px] border-[#FAF7F2] ring-1 ring-slate-300 shadow-md transition-all duration-200 hover:scale-130 hover:z-40 hover:ring-2 hover:ring-emerald-500 cursor-pointer"
                  >
                    <img
                      src={user.src}
                      alt={user.name}
                      className="w-full h-full rounded-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                ))}
                
                {/* Additional Counter Badge Overlapping on the Stack */}
                <div className="relative flex-shrink-0 inline-flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 text-white font-mono text-[11px] sm:text-xs font-black border-[3px] border-[#FAF7F2] ring-1 ring-slate-300 shadow-md">
                  +2.4M
                </div>
              </div>

              {/* Extremely Visible & Bright Depositors Badge */}
              <div className="text-sm sm:text-base font-black text-slate-950 bg-white px-5 py-2 rounded-full border-2 border-emerald-500 shadow-md flex items-center gap-2">
                <span>Trusted by</span>
                <span className="text-emerald-700 font-black text-base sm:text-lg">2,400,000+</span>
                <span>depositors globally</span>
              </div>

              {/* Bold Rectangular Monvera Luxury Cardholder Image Placed Underneath Depositors Badge */}
              <div className="w-full max-w-5xl mx-auto mt-6 rounded-2xl sm:rounded-3xl overflow-hidden shadow-2xl border-2 border-slate-800/40 bg-slate-950 relative group transition-all duration-300 hover:shadow-slate-950/30">
                <img
                  src={luxuryCardholderImage}
                  alt="Monvera Executive Cardholder & Premium Banking"
                  className="w-full h-72 sm:h-96 md:h-[440px] object-cover transition-transform duration-700 group-hover:scale-102"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-950/20 to-transparent pointer-events-none" />
                <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between pointer-events-none">
                  <span className="text-xs sm:text-sm uppercase font-mono tracking-widest text-amber-400 font-extrabold bg-slate-950/95 backdrop-blur-xs px-4 py-2 rounded-xl border border-amber-500/50 shadow-md flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-amber-400" />
                    <span>MONVERA ELITE CARDHOLDER & WEALTH SUITE</span>
                  </span>
                  <span className="text-xs sm:text-sm font-mono font-bold text-emerald-300 bg-slate-900/95 px-3.5 py-2 rounded-xl border border-emerald-500/50 shadow-md">
                    WORLDWIDE ACCEPTANCE
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </section>
  );
};
