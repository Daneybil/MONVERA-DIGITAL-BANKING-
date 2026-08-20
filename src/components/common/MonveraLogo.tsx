import React from 'react';

interface MonveraLogoProps {
  variant?: 'full' | 'short' | 'icon';
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
