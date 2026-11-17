import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckCircle2,
  Download,
  ExternalLink,
  MoreVertical,
  PlusSquare,
  Share,
  ShieldCheck,
  Smartphone,
  X,
} from 'lucide-react';
import { usePWAInstall } from '../../hooks/usePWAInstall';

export type PWAInstallButtonVariant = 'navbar' | 'drawer' | 'footer' | 'dashboard';

interface PWAInstallButtonProps {
  variant?: PWAInstallButtonVariant;
  className?: string;
  suppressModal?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  variant = 'navbar',
  className = '',
  suppressModal = false,
}) => {
  const {
    platform,
    isStandalone,
    isInstalled,
    isIOSSafari,
    isInAppBrowser,
    canPromptNatively,
    shouldShowInstall,
    promptInstall,
  } = usePWAInstall();

  const [isGuideOpen, setIsGuideOpen] = useState(false);

  // Close guide automatically if app becomes standalone or an active transaction modal opens
  useEffect(() => {
    if (suppressModal || isStandalone || isInstalled) {
      setIsGuideOpen(false);
    }
  }, [suppressModal, isStandalone, isInstalled]);

  // Close modal on Escape key
  useEffect(() => {
    if (!isGuideOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setIsGuideOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isGuideOpen]);

  if (!shouldShowInstall) {
    return null;
  }

  const handleInstallClick = async () => {
    if (suppressModal) return;

    if (platform !== 'ios' && canPromptNatively) {
      await promptInstall();
      return;
    }

    setIsGuideOpen(true);
  };

  const buttonClassesByVariant: Record<PWAInstallButtonVariant, string> = {
    navbar:
      'hidden lg:inline-flex items-center gap-1.5 px-3 py-2 text-xs font-extrabold text-emerald-950 bg-emerald-50 hover:bg-emerald-100 rounded-xl border border-emerald-300/80 shadow-2xs transition-all cursor-pointer active:scale-[0.98]',
    drawer:
      'w-full sm:w-auto px-4 py-2.5 text-center text-xs sm:text-sm font-extrabold text-emerald-950 bg-emerald-50 hover:bg-emerald-100 rounded-xl border border-emerald-300 shadow-2xs inline-flex items-center justify-center gap-2 cursor-pointer transition-all',
    footer:
      'inline-flex items-center gap-2 px-4 py-2.5 text-xs font-extrabold text-white bg-slate-900 hover:bg-slate-800 rounded-xl border border-emerald-500/40 hover:border-emerald-400 shadow-xs transition-all cursor-pointer',
    dashboard:
      'flex-1 sm:flex-none py-2 px-3.5 rounded-xl bg-emerald-950/70 hover:bg-emerald-900/80 text-emerald-300 hover:text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 border border-emerald-600/50 transition-colors cursor-pointer',
  };

  const iconClassesByVariant: Record<PWAInstallButtonVariant, string> = {
    navbar: 'w-3.5 h-3.5 text-emerald-700 shrink-0',
    drawer: 'w-4 h-4 text-emerald-700 shrink-0',
    footer: 'w-4 h-4 text-emerald-400 shrink-0',
    dashboard: 'w-3.5 h-3.5 text-emerald-400 shrink-0',
  };

  const modalContent =
    isGuideOpen && typeof document !== 'undefined'
      ? createPortal(
          <div
            id="monvera-pwa-install-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="monvera-pwa-install-title"
            className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          >
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-slate-950/75 backdrop-blur-xs transition-opacity"
              onClick={() => setIsGuideOpen(false)}
              aria-hidden="true"
            />

            {/* Monvera Installation Card */}
            <div className="relative z-10 w-full max-w-md max-h-[90vh] flex flex-col rounded-3xl bg-slate-950 text-slate-100 border border-slate-700/90 shadow-2xl overflow-hidden">
              {/* Modal Header */}
              <div className="px-5 py-4 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-slate-950 border border-emerald-500/40 flex items-center justify-center shrink-0 overflow-hidden shadow-xs">
                    <img
                      src="/pwa-192x192.png"
                      alt="Monvera App Icon"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="min-w-0">
                    <h2
                      id="monvera-pwa-install-title"
                      className="text-sm sm:text-base font-black text-white tracking-tight truncate"
                    >
                      Install Monvera App
                    </h2>
                    <p className="text-[11px] font-mono text-emerald-400 truncate">
                      {platform === 'ios'
                        ? 'iPhone & iPad Home Screen Setup'
                        : 'Android Mobile App Setup'}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setIsGuideOpen(false)}
                  aria-label="Close installation guide"
                  className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors cursor-pointer shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-5 space-y-4 flex-1 min-h-0 overflow-y-auto overscroll-contain">
                {platform === 'ios' ? (
                  <>
                    {isInAppBrowser && (
                      <div className="p-3.5 rounded-2xl bg-amber-950/50 border border-amber-500/40 text-amber-100 text-xs leading-relaxed flex items-start gap-2.5">
                        <ExternalLink className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                        <div>
                          <div className="font-extrabold text-amber-300 mb-0.5">
                            Open in Safari First
                          </div>
                          <div>
                            You are currently viewing Monvera inside an in-app browser. Tap the
                            menu or Share button and select{' '}
                            <strong className="text-white">Open in Safari</strong> for{' '}
                            <span className="font-mono text-amber-200">
                              monveradigitalbanking.space
                            </span>
                            , then follow the steps below.
                          </div>
                        </div>
                      </div>
                    )}

                    {!isInAppBrowser && !isIOSSafari && (
                      <div className="p-3 rounded-2xl bg-slate-900 border border-slate-700 text-slate-200 text-xs leading-relaxed">
                        If <strong className="text-white">Add to Home Screen</strong> is not visible
                        in your current browser&apos;s Share menu, open{' '}
                        <span className="font-mono text-emerald-400">
                          https://www.monveradigitalbanking.space
                        </span>{' '}
                        in <strong className="text-white">Safari</strong> first.
                      </div>
                    )}

                    <div className="space-y-2.5 text-xs sm:text-sm">
                      <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800 flex items-start gap-3">
                        <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
                          <Share className="w-4 h-4" />
                        </div>
                        <div className="text-slate-200 leading-snug">
                          <span className="font-black text-white">1.</span> Tap the{' '}
                          <strong className="text-white">Share</strong> button in Safari.
                        </div>
                      </div>

                      <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800 flex items-start gap-3">
                        <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
                          <PlusSquare className="w-4 h-4" />
                        </div>
                        <div className="text-slate-200 leading-snug">
                          <span className="font-black text-white">2.</span> Scroll down and select{' '}
                          <strong className="text-white">Add to Home Screen</strong>.
                        </div>
                      </div>

                      <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800 flex items-start gap-3">
                        <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
                          <CheckCircle2 className="w-4 h-4" />
                        </div>
                        <div className="text-slate-200 leading-snug">
                          <span className="font-black text-white">3.</span> Tap{' '}
                          <strong className="text-white">Add</strong> in the top-right corner.
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    {isInAppBrowser && (
                      <div className="p-3.5 rounded-2xl bg-amber-950/50 border border-amber-500/40 text-amber-100 text-xs leading-relaxed flex items-start gap-2.5">
                        <ExternalLink className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                        <div>
                          <div className="font-extrabold text-amber-300 mb-0.5">
                            Open in Chrome First
                          </div>
                          <div>
                            In-app browsers do not support direct app installation. Tap the
                            top-right menu (<strong className="text-white">⋮</strong>) and choose{' '}
                            <strong className="text-white">Open in Chrome</strong> (or your
                            device&apos;s browser), then continue below.
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="space-y-2.5 text-xs sm:text-sm">
                      <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800 flex items-start gap-3">
                        <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
                          <MoreVertical className="w-4 h-4" />
                        </div>
                        <div className="text-slate-200 leading-snug">
                          <span className="font-black text-white">1.</span> Open the browser menu (
                          <strong className="text-white">⋮</strong>).
                        </div>
                      </div>

                      <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800 flex items-start gap-3">
                        <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
                          <Smartphone className="w-4 h-4" />
                        </div>
                        <div className="text-slate-200 leading-snug">
                          <span className="font-black text-white">2.</span> Choose{' '}
                          <strong className="text-white">&quot;Install app&quot;</strong> or{' '}
                          <strong className="text-white">&quot;Add to Home screen&quot;</strong>,
                          depending on your browser.
                        </div>
                      </div>

                      <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800 flex items-start gap-3">
                        <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
                          <CheckCircle2 className="w-4 h-4" />
                        </div>
                        <div className="text-slate-200 leading-snug">
                          <span className="font-black text-white">3.</span> Confirm installation to
                          launch <strong className="text-white">Monvera</strong> from your Home
                          Screen.
                        </div>
                      </div>
                    </div>
                  </>
                )}

                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-medium">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>Official Monvera Web App</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsGuideOpen(false)}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold transition-colors cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <button
        type="button"
        id={`pwa-install-btn-${variant}`}
        onClick={handleInstallClick}
        className={`${buttonClassesByVariant[variant]} ${className}`.trim()}
      >
        <Download className={iconClassesByVariant[variant]} />
        <span>Install Monvera App</span>
      </button>
      {modalContent}
    </>
  );
};
