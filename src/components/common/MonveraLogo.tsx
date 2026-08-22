import React from 'react';

interface MonveraLogoProps {
  variant?: 'full' | 'short' | 'icon' | 'crest' | 'crest-stacked';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  isLight?: boolean;
  className?: string;
}

export const MonveraLogo: React.FC<MonveraLogoProps> = ({
  variant = 'full',
  size = 'md',
  isLight = false,
  className = '',
}) => {
  const iconSizes = {
    sm: 'w-6 h-6',
    md: 'w-8 h-8',
    lg: 'w-10 h-10',
    xl: 'w-12 h-12',
  };

  const textSizes = {
    sm: 'text-base font-semibold tracking-tight',
    md: 'text-xl font-bold tracking-tight',
    lg: 'text-2xl font-extrabold tracking-tight',
    xl: 'text-3xl font-extrabold tracking-tight',
  };

  const badgeSizes = {
    sm: 'text-[9px] px-1.5 py-0.5',
    md: 'text-[10px] px-2 py-0.5',
    lg: 'text-xs px-2.5 py-0.5',
    xl: 'text-xs px-3 py-1',
  };

  // Golden Shield Heraldic Crest Symbol (As in the banking reference)
  if (variant === 'crest' || variant === 'crest-stacked') {
    const shieldSizes = {
      sm: 'w-8 h-10',
      md: 'w-11 h-13',
      lg: 'w-14 h-16',
      xl: 'w-16 h-20',
    };

    return (
      <div
        id="monvera-crest-logo"
        className={`select-none ${
          variant === 'crest-stacked' ? 'flex flex-col items-center text-center gap-2' : 'inline-flex items-center gap-3.5'
        } ${className}`}
      >
        {/* Golden Heraldic Shield */}
        <div className={`${shieldSizes[size]} relative flex items-center justify-center shrink-0 drop-shadow-md`}>
          <svg viewBox="0 0 48 56" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
            <defs>
              <linearGradient id="goldBorderGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#F6D860" />
                <stop offset="35%" stopColor="#D4AF37" />
                <stop offset="70%" stopColor="#AA771C" />
                <stop offset="100%" stopColor="#85580C" />
              </linearGradient>
              <linearGradient id="goldInnerGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#FFF7D6" />
                <stop offset="50%" stopColor="#E5C158" />
                <stop offset="100%" stopColor="#B38728" />
              </linearGradient>
              <linearGradient id="shieldBgDark" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#0B132B" />
                <stop offset="100%" stopColor="#050B14" />
              </linearGradient>
            </defs>

            {/* Outer Shield Border */}
            <path
              d="M24 2L44 8V26C44 40.5 24 53 24 53C24 53 4 40.5 4 26V8L24 2Z"
              fill={isLight ? 'url(#shieldBgDark)' : '#FFFFFF'}
              stroke="url(#goldBorderGrad)"
              strokeWidth="2.5"
            />
            {/* Inner Shield Rim */}
            <path
              d="M24 5.5L41 10.5V25.5C41 38 24 49 24 49C24 49 7 38 7 25.5V10.5L24 5.5Z"
              fill="none"
              stroke="url(#goldBorderGrad)"
              strokeWidth="1"
              strokeOpacity="0.8"
            />
            {/* Elegant Serif 'M' Monogram in Center */}
            <path
              d="M16 34V18H18.5L24 27.5L29.5 18H32V34H29.5V23L24.8 31H23.2L18.5 23V34H16Z"
              fill="url(#goldInnerGrad)"
              stroke="#85580C"
              strokeWidth="0.3"
            />
          </svg>
        </div>

        {/* Brand Text Typography */}
        <div className={variant === 'crest-stacked' ? 'flex flex-col items-center' : 'flex flex-col'}>
          <div className="flex items-center gap-1.5">
            <span
              className={`font-serif font-black tracking-wider uppercase text-lg sm:text-2xl ${
                isLight ? 'text-white' : 'text-slate-900'
              }`}
              style={{ letterSpacing: '0.08em' }}
            >
              MONVERA
            </span>
          </div>
          <span
            className="text-[10px] sm:text-xs font-sans font-bold tracking-[0.28em] uppercase text-amber-500/90 sm:text-amber-500"
          >
            BANKING
          </span>
        </div>
      </div>
    );
  }

  return (
    <div id="monvera-brand-logo" className={`inline-flex items-center gap-2.5 select-none ${className}`}>
      {/* Precision Geometric Monogram Symbol */}
      <div
        className={`${iconSizes[size]} relative flex items-center justify-center rounded-xl bg-gradient-to-br from-slate-900 via-slate-850 to-emerald-950 shadow-md border border-slate-700/40 p-1 flex-shrink-0`}
      >
        <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
          {/* M & V Intersecting Diamond Vault Paths */}
          <path
            d="M6 24V8L16 18L26 8V24"
            stroke="#ffffff"
            strokeWidth="2.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M10 24L16 16L22 24"
            stroke="#10b981"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="16" cy="10" r="1.75" fill="#34d399" />
        </svg>
      </div>

      {variant === 'full' && (
        <div className="flex items-center gap-2">
          <span
            className={`${textSizes[size]} ${
              isLight ? 'text-white' : 'text-slate-900'
            } font-bold uppercase tracking-wide font-sans`}
          >
            MONVERA
          </span>
          <span
            className={`${badgeSizes[size]} font-medium rounded-md uppercase tracking-wider font-mono ${
              isLight
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
            }`}
          >
            MVB
          </span>
        </div>
      )}

      {variant === 'short' && (
        <div className="flex items-center gap-1.5">
          <span
            className={`${textSizes[size]} ${
              isLight ? 'text-white' : 'text-slate-900'
            } font-bold tracking-tight`}
          >
            MV Banking
          </span>
        </div>
      )}
    </div>
  );
};
