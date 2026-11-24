import { useCallback, useEffect, useState } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms?: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export type PWAInstallPlatform = 'ios' | 'android' | 'desktop';

interface PWAInstallSnapshot {
  deferredPrompt: BeforeInstallPromptEvent | null;
  isStandalone: boolean;
  isInstalled: boolean;
  wasDismissed: boolean;
  platform: PWAInstallPlatform;
  isIOSSafari: boolean;
  isDesktopSafari: boolean;
  isDesktopChromium: boolean;
  isInAppBrowser: boolean;
}

function detectEnvironment(): Pick<
  PWAInstallSnapshot,
  'isStandalone' | 'platform' | 'isIOSSafari' | 'isDesktopSafari' | 'isDesktopChromium' | 'isInAppBrowser'
> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      isStandalone: false,
      platform: 'desktop',
      isIOSSafari: false,
      isDesktopSafari: false,
      isDesktopChromium: false,
      isInAppBrowser: false,
    };
  }

  const ua = navigator.userAgent || '';
  const navWithStandalone = navigator as Navigator & { standalone?: boolean };

  const isStandalone =
    Boolean(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    Boolean(navWithStandalone.standalone === true) ||
    (typeof document !== 'undefined' && document.referrer.startsWith('android-app://'));

  const isIOS =
    /iphone|ipad|ipod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /android/i.test(ua);
  const platform: PWAInstallPlatform = isIOS ? 'ios' : isAndroid ? 'android' : 'desktop';

  const isInAppBrowser = /(FBAN|FBAV|Instagram|WhatsApp|Line\/|MicroMessenger|GSA\/|; wv\b|\bwv\))/i.test(
    ua
  );

  const isIOSSafari =
    isIOS &&
    !isInAppBrowser &&
    /Safari/i.test(ua) &&
    !/(CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo)/i.test(ua);

  const isDesktopSafari =
    platform === 'desktop' &&
    /Macintosh|Mac OS X/i.test(ua) &&
    /Safari/i.test(ua) &&
    !/(Chrome|Chromium|Edg|EdgA|OPR|Firefox|FxiOS|Brave|DuckDuckGo)/i.test(ua);

  const isDesktopChromium =
    platform === 'desktop' &&
    /(Chrome|Chromium|Edg)\//i.test(ua) &&
    !/Firefox\//i.test(ua);

  return {
    isStandalone,
    platform,
    isIOSSafari,
    isDesktopSafari,
    isDesktopChromium,
    isInAppBrowser,
  };
}

// Module-scoped singleton store prevents duplicate window listeners when multiple install triggers mount simultaneously.
let snapshot: PWAInstallSnapshot = {
  deferredPrompt: null,
  isInstalled: false,
  wasDismissed: false,
  ...detectEnvironment(),
};

const subscribers = new Set<() => void>();
let listenersAttached = false;
let displayModeMediaQuery: MediaQueryList | null = null;

function notifySubscribers(): void {
  subscribers.forEach((callback) => callback());
}

function updateSnapshot(partial: Partial<PWAInstallSnapshot>): void {
  snapshot = { ...snapshot, ...partial };
  notifySubscribers();
}

function handleBeforeInstallPrompt(event: Event): void {
  const promptEvent = event as BeforeInstallPromptEvent;
  if (typeof promptEvent.prompt === 'function') {
    promptEvent.preventDefault();
  }
  updateSnapshot({
    deferredPrompt: promptEvent,
  });
}

function handleAppInstalled(): void {
  updateSnapshot({
    deferredPrompt: null,
    isInstalled: true,
    isStandalone: true,
  });
}

function handleDisplayModeChange(event: MediaQueryListEvent): void {
  const env = detectEnvironment();
  updateSnapshot({
    isStandalone: event.matches || env.isStandalone,
  });
}

function attachGlobalListeners(): void {
  if (listenersAttached || typeof window === 'undefined') return;
  listenersAttached = true;

  // Refresh environment snapshot upon activation
  const env = detectEnvironment();
  snapshot = {
    ...snapshot,
    ...env,
  };

  window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  window.addEventListener('appinstalled', handleAppInstalled);

  if (window.matchMedia) {
    displayModeMediaQuery = window.matchMedia('(display-mode: standalone)');
    if (typeof displayModeMediaQuery.addEventListener === 'function') {
      displayModeMediaQuery.addEventListener('change', handleDisplayModeChange);
    } else if (typeof (displayModeMediaQuery as any).addListener === 'function') {
      (displayModeMediaQuery as any).addListener(handleDisplayModeChange);
    }
  }
}

// Capture beforeinstallprompt, appinstalled, and display-mode transitions eagerly in browser environments
// so events fired before mount or while Dashboard Navigation Hub is closed are retained.
if (typeof window !== 'undefined') {
  attachGlobalListeners();
}

export interface UsePWAInstallResult {
  platform: PWAInstallPlatform;
  isStandalone: boolean;
  isInstalled: boolean;
  isIOSSafari: boolean;
  isDesktopSafari: boolean;
  isDesktopChromium: boolean;
  isInAppBrowser: boolean;
  canPromptNatively: boolean;
  wasDismissed: boolean;
  shouldShowInstall: boolean;
  promptInstall: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
}

export function evaluatePWAInstallVisibility(params: {
  isStandalone: boolean;
  isInstalled: boolean;
}): boolean {
  return !(params.isStandalone || params.isInstalled);
}

export function usePWAInstall(): UsePWAInstallResult {
  const [state, setState] = useState<PWAInstallSnapshot>(() => snapshot);

  useEffect(() => {
    attachGlobalListeners();
    setState(snapshot);

    const handleChange = () => {
      setState(snapshot);
    };
    subscribers.add(handleChange);

    return () => {
      subscribers.delete(handleChange);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    if (snapshot.platform === 'ios' || !snapshot.deferredPrompt) {
      return 'unavailable';
    }

    const activePrompt = snapshot.deferredPrompt;
    // Deferred prompt is single-use per browser specification
    updateSnapshot({ deferredPrompt: null });

    try {
      await activePrompt.prompt();
      const choice = await activePrompt.userChoice;
      if (choice?.outcome === 'accepted') {
        updateSnapshot({ isInstalled: true });
        return 'accepted';
      }
      updateSnapshot({ wasDismissed: true });
      return 'dismissed';
    } catch {
      return 'unavailable';
    }
  }, []);

  const canPromptNatively = state.platform !== 'ios' && Boolean(state.deferredPrompt);
  const shouldShowInstall = evaluatePWAInstallVisibility({
    isStandalone: state.isStandalone,
    isInstalled: state.isInstalled,
  });

  return {
    platform: state.platform,
    isStandalone: state.isStandalone,
    isInstalled: state.isInstalled,
    isIOSSafari: state.isIOSSafari,
    isDesktopSafari: state.isDesktopSafari,
    isDesktopChromium: state.isDesktopChromium,
    isInAppBrowser: state.isInAppBrowser,
    canPromptNatively,
    wasDismissed: state.wasDismissed,
    shouldShowInstall,
    promptInstall,
  };
}
