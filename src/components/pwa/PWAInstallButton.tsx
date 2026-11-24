import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Bell,
  CheckCircle2,
  Compass,
  Download,
  ExternalLink,
  Laptop,
  MoreVertical,
  PlusSquare,
  Share,
  ShieldCheck,
  Smartphone,
  X,
} from 'lucide-react';
import { usePWAInstall } from '../../hooks/usePWAInstall';

export type PWAInstallButtonVariant = 'navbar' | 'hero' | 'drawer' | 'footer' | 'dashboard';

interface PWAInstallButtonProps {
  variant?: PWAInstallButtonVariant;
  className?: string;
  suppressModal?: boolean;
  label?: string;
  mobileLabel?: string;
  sublabel?: string;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  variant = 'navbar',
  className = '',
  suppressModal = false,
  label,
  mobileLabel,
  sublabel,
}) => {
  const {
    platform,
    isStandalone,
    isInstalled,
    isIOSSafari,
    isDesktopSafari,
    isDesktopChromium,
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
      const outcome = await promptInstall();
      if (outcome === 'accepted' || outcome === 'dismissed') {
        return;
      }
    }

    setIsGuideOpen(true);
  };

  const buttonClassesByVariant: Record<PWAInstallButtonVariant, string> = {
    navbar:
      'inline-flex items-center justify-center gap-1 px-2 sm:px-2.5 xl:px-3 py-1.5 sm:py-2 text-[11px] sm:text-xs font-extrabold text-emerald-950 bg-emerald-50 hover:bg-emerald-100 rounded-xl border border-emerald-400/80 shadow-2xs transition-all cursor-pointer active:scale-[0.98] whitespace-nowrap shrink-0',
    hero:
      'w-full max-w-sm inline-flex items-center justify-center gap-2.5 px-5 py-3.5 text-sm sm:text-base font-black text-white bg-gradient-to-b from-emerald-700 via-emerald-800 to-emerald-900 hover:from-emerald-600 hover:to-emerald-800 rounded-xl border border-emerald-500 border-b-[4px] border-b-emerald-950 shadow-lg active:translate-y-1 active:border-b-[1px] active:shadow-2xs transition-all cursor-pointer select-none',
    drawer:
      'w-full sm:w-auto px-4 py-2.5 text-center text-xs sm:text-sm font-extrabold text-emerald-950 bg-emerald-50 hover:bg-emerald-100 rounded-xl border border-emerald-300 shadow-2xs inline-flex items-center justify-center gap-2 cursor-pointer transition-all whitespace-nowrap',
    footer:
      'inline-flex items-center gap-2 px-4 py-2.5 text-xs font-extrabold text-white bg-slate-900 hover:bg-slate-800 rounded-xl border border-emerald-500/40 hover:border-emerald-400 shadow-xs transition-all cursor-pointer',
    dashboard:
      'flex-1 sm:flex-none py-2 px-3.5 rounded-xl bg-emerald-950/70 hover:bg-emerald-900/80 text-emerald-300 hover:text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 border border-emerald-600/50 transition-colors cursor-pointer',
  };

  const iconClassesByVariant: Record<PWAInstallButtonVariant, string> = {
    navbar: 'w-3 h-3 sm:w-3.5 sm:h-3.5 text-emerald-700 shrink-0',
    hero: 'w-4 h-4 sm:w-5 sm:h-5 text-emerald-200 shrink-0',
    drawer: 'w-4 h-4 text-emerald-700 shrink-0',
    footer: 'w-4 h-4 text-emerald-400 shrink-0',
    dashboard: 'w-3.5 h-3.5 text-emerald-400 shrink-0',
  };

  const resolvedLabel = label || (variant === 'navbar' || variant === 'hero' || variant === 'drawer' ? 'Download Monvera App' : 'Install Monvera App');

  const renderButtonText = () => {
    if (variant === 'navbar') {
      const compactLabel = mobileLabel || 'Download App';
      return (
        <>
          <span className="sm:hidden">Get App</span>
          <span className="hidden sm:inline md:hidden">{compactLabel}</span>
          <span className="hidden md:inline">{resolvedLabel}</span>
        </>
      );
    }
    return <span>{resolvedLabel}</span>;
  };

  const modalSubtitle =
    platform === 'ios'
      ? 'iPhone & iPad Home Screen Setup'
      : platform === 'android'
      ? 'Android Mobile App Setup'
      : 'Desktop Browser App Setup';

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
                      Download Monvera App
                    </h2>
                    <p className="text-[11px] font-mono text-emerald-400 truncate">
                      {modalSubtitle}
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
                        On iPhone and iPad, installing to your Home Screen works best in{' '}
                        <strong className="text-white">Safari</strong>. Open{' '}
                        <span className="font-mono text-emerald-400">
                          https://www.monveradigitalbanking.space
                        </span>{' '}
                        in Safari first.
                      </div>
                    )}

                    <div className="space-y-2.5 text-xs sm:text-sm">
                      <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800 flex items-start gap-3">
                        <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
                          <Compass className="w-4 h-4" />
                        </div>
                        <div className="text-slate-200 leading-snug">
                          <span className="font-black text-white">1.</span> Open{' '}
                          <strong className="text-white">Monvera</strong> in{' '}
                          <strong className="text-white">Safari</strong>.
                        </div>
                      </div>

                      <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800 flex items-start gap-3">
                        <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
                          <Share className="w-4 h-4" />
                        </div>
                        <div className="text-slate-200 leading-snug">
                          <span className="font-black text-white">2.</span> Tap the{' '}
                          <strong className="text-white">Share</strong> icon in Safari.
                        </div>
                      </div>

                      <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800 flex items-start gap-3">
                        <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
                          <PlusSquare className="w-4 h-4" />
                        </div>
                        <div className="text-slate-200 leading-snug">
                          <span className="font-black text-white">3.</span> Select{' '}
                          <strong className="text-white">Add to Home Screen</strong>.
                        </div>
                      </div>

                      <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800 flex items-start gap-3">
                        <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
                          <CheckCircle2 className="w-4 h-4" />
                        </div>
                        <div className="text-slate-200 leading-snug">
                          <span className="font-black text-white">4.</span> Confirm{' '}
                          <strong className="text-white">Add</strong> to place Monvera on your Home
                          Screen.
                        </div>
                      </div>
                    </div>

                    <div className="p-3 rounded-2xl bg-emerald-950/40 border border-emerald-500/30 text-emerald-100 text-xs leading-relaxed flex items-start gap-2.5">
                      <Bell className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <div>
                        Supported iPhone and iPad web push notifications require launching Monvera
                        from your Home Screen app icon and granting notification permission.
                      </div>
                    </div>
                  </>
                ) : platform === 'android' ? (
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
                          <span className="font-black text-white">1.</span> Open the Chrome menu (
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
                          <strong className="text-white">&quot;Add to Home screen&quot;</strong>.
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
                ) : (
                  <>
                    {isDesktopSafari ? (
                      <div className="space-y-2.5 text-xs sm:text-sm">
                        <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800 flex items-start gap-3">
                          <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
                            <Compass className="w-4 h-4" />
                          </div>
                          <div className="text-slate-200 leading-snug">
                            <span className="font-black text-white">1.</span> In Safari on macOS,
                            open the <strong className="text-white">File</strong> menu (or click the{' '}
                            <strong className="text-white">Share</strong> button in the toolbar).
                          </div>
                        </div>

                        <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800 flex items-start gap-3">
                          <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
                            <PlusSquare className="w-4 h-4" />
                          </div>
                          <div className="text-slate-200 leading-snug">
                            <span className="font-black text-white">2.</span> Select{' '}
                            <strong className="text-white">Add to Dock...</strong> (available on
                            supported macOS versions).
                          </div>
                        </div>

                        <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800 flex items-start gap-3">
                          <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
                            <CheckCircle2 className="w-4 h-4" />
                          </div>
                          <div className="text-slate-200 leading-snug">
                            <span className="font-black text-white">3.</span> Click{' '}
                            <strong className="text-white">Add</strong> to launch{' '}
                            <strong className="text-white">Monvera</strong> as a dedicated desktop
                            app from your Dock.
                          </div>
                        </div>
                      </div>
                    ) : (
                      <>
                        {!isDesktopChromium && (
                          <div className="p-3.5 rounded-2xl bg-amber-950/50 border border-amber-500/40 text-amber-100 text-xs leading-relaxed flex items-start gap-2.5">
                            <ExternalLink className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                            <div>
                              <div className="font-extrabold text-amber-300 mb-0.5">
                                Open in Chrome, Edge, or Safari (macOS)
                              </div>
                              <div>
                                Your current desktop browser does not support direct Web App
                                installation. Open Monvera in{' '}
                                <strong className="text-white">Google Chrome</strong>,{' '}
                                <strong className="text-white">Microsoft Edge</strong>, or{' '}
                                <strong className="text-white">macOS Safari</strong> to install it.
                              </div>
                            </div>
                          </div>
                        )}

                        <div className="space-y-2.5 text-xs sm:text-sm">
                          <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800 flex items-start gap-3">
                            <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
                              <Laptop className="w-4 h-4" />
                            </div>
                            <div className="text-slate-200 leading-snug">
                              <span className="font-black text-white">1.</span> Look for the{' '}
                              <strong className="text-white">Install app</strong> icon in the right
                              side of your Chrome or Edge address bar.
                            </div>
                          </div>

                          <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800 flex items-start gap-3">
                            <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
                              <MoreVertical className="w-4 h-4" />
                            </div>
                            <div className="text-slate-200 leading-snug">
                              <span className="font-black text-white">2.</span> Or open your browser
                              menu and choose{' '}
                              <strong className="text-white">
                                Cast, save, and share → Install page as app
                              </strong>{' '}
                              (Chrome) or{' '}
                              <strong className="text-white">Apps → Install this site as an app</strong>{' '}
                              (Edge).
                            </div>
                          </div>

                          <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800 flex items-start gap-3">
                            <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
                              <CheckCircle2 className="w-4 h-4" />
                            </div>
                            <div className="text-slate-200 leading-snug">
                              <span className="font-black text-white">3.</span> Confirm{' '}
                              <strong className="text-white">Install</strong> to open Monvera in its
                              own desktop window.
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </>
                )}

                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-300 font-semibold">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>Follow browser steps above to install</span>
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
      <div className={variant === 'hero' ? 'flex flex-col items-center gap-1.5 w-full' : 'inline-flex'}>
        <button
          type="button"
          id={`pwa-install-btn-${variant}`}
          onClick={handleInstallClick}
          className={`${buttonClassesByVariant[variant]} ${className}`.trim()}
        >
          <Download className={iconClassesByVariant[variant]} />
          {renderButtonText()}
        </button>
        {sublabel && variant === 'hero' && (
          <p className="text-xs sm:text-sm font-extrabold text-slate-900 text-center">
            {sublabel}
          </p>
        )}
      </div>
      {modalContent}
    </>
  );
};
