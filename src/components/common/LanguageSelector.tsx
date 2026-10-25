import React, { useState, useEffect, useRef } from 'react';
import {
  SUPPORTED_LANGUAGES,
  SupportedLanguage,
  getCurrentLanguage,
  setLanguage,
  LANGUAGE_CHANGE_EVENT,
} from '../../services/translationService';
import { Globe, Check, ChevronDown } from 'lucide-react';

interface LanguageSelectorProps {
  variant?: 'light' | 'dark' | 'header';
  className?: string;
  showLabel?: boolean;
}

export const LanguageSelector: React.FC<LanguageSelectorProps> = ({
  variant = 'light',
  className = '',
  showLabel = true,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [currentCode, setCurrentCode] = useState<string>(() => getCurrentLanguage());
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Sync with language changes across the app
  useEffect(() => {
    const handleLanguageChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ lang: string }>;
      if (customEvent.detail?.lang) {
        setCurrentCode(customEvent.detail.lang);
      }
    };

    window.addEventListener(LANGUAGE_CHANGE_EVENT, handleLanguageChange);
    return () => {
      window.removeEventListener(LANGUAGE_CHANGE_EVENT, handleLanguageChange);
    };
  }, []);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Close on ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const activeLang =
    SUPPORTED_LANGUAGES.find((l) => l.code === currentCode) || SUPPORTED_LANGUAGES[0];

  const handleSelect = (lang: SupportedLanguage) => {
    setLanguage(lang.code);
    setCurrentCode(lang.code);
    setIsOpen(false);
  };

  // Button styling variants
  let buttonClasses = '';
  if (variant === 'dark') {
    buttonClasses =
      'bg-slate-800/90 hover:bg-slate-750 text-slate-200 border-slate-700/80 shadow-xs hover:border-slate-600';
  } else if (variant === 'header') {
    buttonClasses =
      'bg-slate-100 hover:bg-slate-200/80 text-slate-800 border-slate-300/80 shadow-2xs hover:border-slate-400';
  } else {
    // default light
    buttonClasses =
      'bg-slate-100/90 hover:bg-slate-200 text-slate-800 border-slate-300/80 shadow-2xs hover:border-slate-400';
  }

  return (
    <div
      ref={dropdownRef}
      className={`relative inline-block text-left notranslate ${className}`}
      translate="no"
    >
      {/* Trigger Button */}
      <button
        type="button"
        id="language-selector-btn"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-label="Select Language"
        className={`inline-flex items-center gap-1 sm:gap-1.5 ${
          showLabel ? 'px-2.5 py-2 sm:px-3.5 sm:py-2.5' : 'px-2 py-1.5 sm:px-2.5 sm:py-2'
        } rounded-xl text-xs font-bold border transition-all cursor-pointer ${buttonClasses}`}
      >
        <span className="text-sm leading-none" role="img" aria-label={activeLang.name}>
          {activeLang.flag}
        </span>
        {showLabel && (
          <span className="font-extrabold uppercase tracking-wider text-[11px] sm:text-xs text-slate-850">
            {activeLang.code.toUpperCase()}
          </span>
        )}
        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-500 transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          id="language-dropdown-menu"
          className="absolute right-0 mt-2 w-56 sm:w-64 max-w-[calc(100vw-20px)] rounded-2xl bg-white shadow-2xl border border-slate-200 py-2 z-50 animate-in fade-in zoom-in-95 duration-150 focus:outline-none"
          role="menu"
          aria-orientation="vertical"
        >
          {/* Header */}
          <div className="px-3.5 py-2 border-b border-slate-100 flex items-center justify-between">
            <span className="text-[11px] font-mono uppercase tracking-wider text-slate-500 font-bold flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-emerald-600" />
              <span>Select Language</span>
            </span>
            <span className="text-[10px] font-mono text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200/60">
              10 Global
            </span>
          </div>

          {/* Languages list */}
          <div className="p-1.5 max-h-80 overflow-y-auto space-y-1 custom-scrollbar">
            {SUPPORTED_LANGUAGES.map((lang) => {
              const isSelected = lang.code === currentCode;
              return (
                <button
                  key={lang.code}
                  type="button"
                  id={`lang-opt-${lang.code}`}
                  onClick={() => handleSelect(lang)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors cursor-pointer text-left ${
                    isSelected
                      ? 'bg-emerald-50 text-emerald-950 font-bold border border-emerald-200/80 shadow-2xs'
                      : 'hover:bg-slate-50 text-slate-800'
                  }`}
                  role="menuitem"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-base leading-none" role="img" aria-label={lang.name}>
                      {lang.flag}
                    </span>
                    <div className="flex flex-col">
                      <span className="font-extrabold text-slate-900 leading-tight">
                        {lang.nativeName}
                      </span>
                      <span className="text-[10px] text-slate-600 leading-tight">
                        {lang.name}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {lang.code === 'tr' && (
                      <span className="text-[9px] font-mono font-bold text-amber-700 bg-amber-50 px-1 py-0.5 rounded border border-amber-200">
                        TR
                      </span>
                    )}
                    {lang.code === 'ar' && (
                      <span className="text-[9px] font-mono font-bold text-sky-700 bg-sky-50 px-1 py-0.5 rounded border border-sky-200">
                        RTL
                      </span>
                    )}
                    {isSelected && (
                      <Check className="w-4 h-4 text-emerald-600 stroke-[2.5]" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Footer Notice */}
          <div className="px-3.5 py-2 mt-1 border-t border-slate-100 bg-slate-50/60 rounded-b-xl flex items-center justify-between text-[10px] text-slate-500 font-medium">
            <span>Powered by Monvera Multi-Lingual</span>
            <span className="font-mono text-emerald-600">v2.5</span>
          </div>
        </div>
      )}
    </div>
  );
};
