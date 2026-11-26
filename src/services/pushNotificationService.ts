import { getMessaging, getToken, onMessage, isSupported, Messaging } from 'firebase/messaging';
import { app, auth } from './firebase';
import {
  normalizePushPayload,
  buildNotificationNavTargetFromNormalized,
  PushNotificationDeduplicator,
  type NormalizedPushNotification,
  type NotificationNavTarget,
} from '../utils/pushNotificationPayload';

export interface PushRegistrationResult {
  status: 'granted' | 'denied' | 'default' | 'unsupported';
  token?: string;
  error?: string;
}

export interface PushNotificationServiceDeps {
  getCurrentUid?: () => string | null;
  getIdToken?: () => Promise<string | null>;
  fetchFn?: typeof fetch;
  postPushEndpoint?: (endpoint: string, payload: Record<string, any>, timeoutMs?: number) => Promise<boolean>;
  isSupportedFn?: () => Promise<boolean>;
  ensureActiveSwFn?: () => Promise<ServiceWorkerRegistration | null>;
  acquireFcmTokenFn?: (registration: ServiceWorkerRegistration) => Promise<string | null>;
  getNotificationPermissionFn?: () => NotificationPermission | 'unsupported';
  requestNotificationPermissionFn?: () => Promise<NotificationPermission>;
  subscribeOnMessageFn?: (handler: (payload: any) => void) => () => void;
  displayNotificationFn?: (title: string, options?: NotificationOptions) => void;
}

export class PushNotificationService {
  private foregroundDeduplicator = new PushNotificationDeduplicator(60_000, 100);
  private messaging: Messaging | null = null;
  private supported: boolean | null = null;
  private serviceWorkerRegistration: ServiceWorkerRegistration | null = null;
  private serviceWorkerRegistrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;
  private activeRegistrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;
  private currentToken: string | null = null;
  private registeredUserId: string | null = null;
  private inFlightSyncPromise: Promise<string | null> | null = null;
  private inFlightSyncUid: string | null = null;
  private deps: PushNotificationServiceDeps;
  private static readonly SW_ACTIVATION_TIMEOUT_MS = 12000;
  private static readonly PUSH_UNREGISTER_TIMEOUT_MS = 3000;

  constructor(deps: PushNotificationServiceDeps = {}) {
    this.deps = deps;
  }

  public getRegistrationState(): { token: string | null; userId: string | null } {
    return { token: this.currentToken, userId: this.registeredUserId };
  }

  private getCurrentAuthUid(): string | null {
    if (this.deps.getCurrentUid) return this.deps.getCurrentUid();
    return auth?.currentUser?.uid || null;
  }

  private getEndpointUrl(endpoint: string): string {
    const base = ((import.meta as any).env?.VITE_API_URL || '').replace(/\/+$/, '');
    const clean = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    return base ? `${base}${clean}` : clean;
  }

  private async postAuthenticatedPushEndpoint(
    endpoint: string,
    payload: Record<string, any>,
    timeoutMs: number = 8000
  ): Promise<boolean> {
    if (this.deps.postPushEndpoint) {
      return this.deps.postPushEndpoint(endpoint, payload, timeoutMs);
    }

    const idToken = this.deps.getIdToken
      ? await this.deps.getIdToken()
      : auth?.currentUser
      ? await auth.currentUser.getIdToken()
      : null;
    if (!idToken) return false;

    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const targetUrl = this.getEndpointUrl(cleanEndpoint);
    const fetchImpl = this.deps.fetchFn || fetch;

    const execFetch = async (url: string): Promise<Response> => {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      try {
        return await fetchImpl(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify(payload),
          signal: controller?.signal,
        });
      } finally {
        if (timer) clearTimeout(timer);
      }
    };

    try {
      const res = await execFetch(targetUrl);
      return res.ok;
    } catch (primaryErr) {
      if (targetUrl !== cleanEndpoint) {
        try {
          const fallbackRes = await execFetch(cleanEndpoint);
          return fallbackRes.ok;
        } catch {
          return false;
        }
      }
      throw primaryErr;
    }
  }

  /**
   * Coordinate unified root service worker registration initiated during app startup
   */
  public setServiceWorkerRegistrationPromise(promise: Promise<ServiceWorkerRegistration | null>): void {
    this.serviceWorkerRegistrationPromise = promise;
  }

  /**
   * Validate that a registration matches the expected Monvera root scope and environment worker script
   */
  private isValidRootRegistration(registration: ServiceWorkerRegistration | null | undefined): registration is ServiceWorkerRegistration {
    if (!registration || typeof window === 'undefined') return false;
    const expectedScope = `${window.location.origin}/`;
    if (registration.scope !== expectedScope) {
      console.warn('[Push] Unexpected service worker scope:', registration.scope);
      return false;
    }

    if (import.meta.env.PROD) {
      const scriptUrl =
        registration.active?.scriptURL ||
        registration.waiting?.scriptURL ||
        registration.installing?.scriptURL ||
        '';
      if (scriptUrl && !scriptUrl.endsWith('/sw.js')) {
        console.warn('[Push] Ignoring non-unified service worker registration in production:', scriptUrl);
        return false;
      }
    }

    return true;
  }

  /**
   * Wait (with a bounded timeout) until a registered service worker becomes activated
   */
  private waitForRegistrationActivation(
    registration: ServiceWorkerRegistration,
    timeoutMs: number = PushNotificationService.SW_ACTIVATION_TIMEOUT_MS
  ): Promise<ServiceWorkerRegistration | null> {
    if (registration.active && registration.active.state === 'activated') {
      return Promise.resolve(registration);
    }

    const candidate = registration.active || registration.waiting || registration.installing;
    if (!candidate) {
      console.warn('[Push] Service worker registration has no installing, waiting, or active worker.');
      return Promise.resolve(null);
    }

    if (candidate.state === 'redundant') {
      console.warn('[Push] Service worker became redundant before activation.');
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      let settled = false;
      let trackedWorker: ServiceWorker | null = candidate;

      const cleanup = () => {
        clearTimeout(timeoutId);
        if (trackedWorker) {
          trackedWorker.removeEventListener('statechange', handleStateChange);
          trackedWorker = null;
        }
        registration.removeEventListener('updatefound', handleUpdateFound);
      };

      const finish = (result: ServiceWorkerRegistration | null, diagnostic?: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (diagnostic) {
          console.warn(diagnostic);
        }
        resolve(result);
      };

      const checkActive = () => {
        if (registration.active && registration.active.state === 'activated') {
          finish(registration);
          return true;
        }
        return false;
      };

      const handleStateChange = () => {
        if (checkActive()) return;

        const currentState = trackedWorker?.state;
        if (currentState === 'redundant') {
          if (!registration.active && !registration.waiting && !registration.installing) {
            finish(null, '[Push] Service worker failed activation (state: redundant).');
          }
        }
      };

      const attachToWorker = (worker: ServiceWorker | null) => {
        if (!worker || worker === trackedWorker) return;
        if (trackedWorker) {
          trackedWorker.removeEventListener('statechange', handleStateChange);
        }
        trackedWorker = worker;
        trackedWorker.addEventListener('statechange', handleStateChange);
      };

      const handleUpdateFound = () => {
        if (checkActive()) return;
        if (registration.installing) {
          attachToWorker(registration.installing);
        }
      };

      const timeoutId = setTimeout(() => {
        if (!checkActive()) {
          finish(null, `[Push] Timed out after ${timeoutMs}ms waiting for service worker activation; skipping push token sync.`);
        }
      }, timeoutMs);

      trackedWorker.addEventListener('statechange', handleStateChange);
      registration.addEventListener('updatefound', handleUpdateFound);

      // Re-check synchronously in case state transitioned between inspection and listener attachment
      checkActive();
    });
  }

  /**
   * Resolve and confirm an activated root ServiceWorkerRegistration (never blocks forever or triggers legacy fallback)
   */
  private async ensureActiveServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return null;
    }

    if (
      this.serviceWorkerRegistration &&
      this.isValidRootRegistration(this.serviceWorkerRegistration) &&
      this.serviceWorkerRegistration.active?.state === 'activated'
    ) {
      return this.serviceWorkerRegistration;
    }

    if (this.activeRegistrationPromise) {
      return this.activeRegistrationPromise;
    }

    this.activeRegistrationPromise = (async () => {
      try {
        let registration: ServiceWorkerRegistration | null = null;

        if (this.serviceWorkerRegistrationPromise) {
          registration = await this.serviceWorkerRegistrationPromise.catch((err) => {
            console.warn('[Push] Coordinated service worker registration failed:', err);
            return null;
          });
        }

        if (!registration && import.meta.env.PROD) {
          const existingReg = await navigator.serviceWorker.getRegistration('/');
          if (this.isValidRootRegistration(existingReg)) {
            registration = existingReg;
          } else {
            registration = await navigator.serviceWorker
              .register('/sw.js', { scope: '/' })
              .catch((err) => {
                console.warn('[Push] Production /sw.js registration unavailable:', err);
                return null;
              });
          }
        } else if (!registration && !import.meta.env.PROD) {
          // Development mode uses Vite middleware without bundled dist/sw.js
          registration = await navigator.serviceWorker
            .register('/firebase-messaging-sw.js', { scope: '/' })
            .catch((err) => {
              console.warn('[Push] Development service worker registration note:', err);
              return null;
            });
        }

        if (!this.isValidRootRegistration(registration)) {
          console.warn('[Push] Valid root service worker registration unavailable; push token sync skipped.');
          return null;
        }

        const activeReg = await this.waitForRegistrationActivation(registration);
        if (!activeReg || !activeReg.active) {
          return null;
        }

        this.serviceWorkerRegistration = activeReg;
        console.log('[Push] Unified service worker active and ready');
        return activeReg;
      } catch (err) {
        console.warn('[Push] Error confirming active service worker:', err);
        return null;
      } finally {
        if (!this.serviceWorkerRegistration?.active) {
          this.activeRegistrationPromise = null;
        }
      }
    })();

    return this.activeRegistrationPromise;
  }

  /**
   * Check if Firebase Cloud Messaging & Web Push are supported in current browser/context
   */
  public async checkSupport(): Promise<boolean> {
    if (this.supported !== null) return this.supported;
    if (this.deps.isSupportedFn) {
      try {
        this.supported = await this.deps.isSupportedFn();
        return this.supported;
      } catch {
        this.supported = false;
        return false;
      }
    }
    if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator)) {
      this.supported = false;
      return false;
    }
    try {
      this.supported = await isSupported();
      return this.supported;
    } catch {
      this.supported = false;
      return false;
    }
  }

  private getBrowserNotificationPermission(): NotificationPermission | 'unsupported' {
    if (this.deps.getNotificationPermissionFn) {
      return this.deps.getNotificationPermissionFn();
    }
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'unsupported';
    }
    return Notification.permission;
  }

  /**
   * Initialize service worker and Firebase messaging instance
   */
  public async init(): Promise<Messaging | null> {
    const isSup = await this.checkSupport();
    if (!isSup) return null;

    try {
      await (this.deps.ensureActiveSwFn
        ? this.deps.ensureActiveSwFn()
        : this.ensureActiveServiceWorkerRegistration());

      if (this.deps.acquireFcmTokenFn) {
        return {} as Messaging;
      }

      if (!this.messaging) {
        this.messaging = getMessaging(app);
      }
      return this.messaging;
    } catch (err) {
      console.warn('[Push] Service worker / Messaging init note:', err);
      return null;
    }
  }

  /**
   * Request user permission and obtain FCM registration token
   */
  public async requestPushPermission(userId: string): Promise<PushRegistrationResult> {
    const isSup = await this.checkSupport();
    if (!isSup) {
      return { status: 'unsupported', error: 'Web Push is not supported in this browser environment.' };
    }

    try {
      const currentPermission = this.getBrowserNotificationPermission();
      if (currentPermission === 'unsupported') {
        return { status: 'unsupported', error: 'Notifications API is unavailable.' };
      }
      let permissionResult: NotificationPermission = currentPermission;

      if (currentPermission === 'default') {
        permissionResult = this.deps.requestNotificationPermissionFn
          ? await this.deps.requestNotificationPermissionFn()
          : await Notification.requestPermission();
      }

      if (permissionResult !== 'granted') {
        return { status: permissionResult as 'denied' | 'default' };
      }

      const messaging = await this.init();
      if (!messaging) {
        return { status: 'unsupported', error: 'Messaging engine unavailable.' };
      }

      const activeRegistration = this.deps.ensureActiveSwFn
        ? await this.deps.ensureActiveSwFn()
        : await this.ensureActiveServiceWorkerRegistration();
      if (!activeRegistration || (!this.deps.ensureActiveSwFn && !activeRegistration.active)) {
        console.warn('[Push] Skipping requestPushPermission getToken: no active service worker registration.');
        return {
          status: 'unsupported',
          error: 'Notification service worker is not active yet. Please try again momentarily.',
        };
      }

      // Optional VAPID key from environment, with default fallback
      const vapidKey = (import.meta as any).env?.VITE_FIREBASE_VAPID_KEY || undefined;

      const token = this.deps.acquireFcmTokenFn
        ? await this.deps.acquireFcmTokenFn(activeRegistration)
        : await getToken(messaging, {
            serviceWorkerRegistration: activeRegistration,
            vapidKey,
          });

      if (token && userId) {
        const registered = await this.saveTokenToFirestore(userId, token, true);
        if (!registered) {
          return {
            status: 'granted',
            error: 'Failed to register notification token with server. Please try again.',
          };
        }
        return { status: 'granted', token };
      }

      return { status: 'granted', token: token || undefined };
    } catch (err: any) {
      console.warn('[Push] Token registration error:', err);
      return { status: 'denied', error: err?.message || 'Failed to acquire notification token.' };
    }
  }

  /**
   * Silently sync existing granted token for the authenticated user.
   * Never triggers an OS permission prompt; resolves to the token ONLY if /api/push/register succeeds.
   */
  public async syncTokenForUser(userId: string): Promise<string | null> {
    if (!userId) return null;
    if (this.getBrowserNotificationPermission() !== 'granted') return null;

    if (this.inFlightSyncPromise && this.inFlightSyncUid === userId) {
      return this.inFlightSyncPromise;
    }

    const syncPromise = (async (): Promise<string | null> => {
      try {
        const messaging = await this.init();
        if (!messaging) return null;

        const activeRegistration = this.deps.ensureActiveSwFn
          ? await this.deps.ensureActiveSwFn()
          : await this.ensureActiveServiceWorkerRegistration();
        if (!activeRegistration || (!this.deps.ensureActiveSwFn && !activeRegistration.active)) {
          console.warn('[Push] Skipping syncTokenForUser getToken: no active service worker registration.');
          return null;
        }

        const vapidKey = (import.meta as any).env?.VITE_FIREBASE_VAPID_KEY || undefined;
        const token = this.deps.acquireFcmTokenFn
          ? await this.deps.acquireFcmTokenFn(activeRegistration)
          : await getToken(messaging, {
              serviceWorkerRegistration: activeRegistration,
              vapidKey,
            });

        if (token) {
          const registered = await this.saveTokenToFirestore(userId, token);
          return registered ? token : null;
        }
      } catch (err) {
        console.warn('[Push] Auto-sync token note:', err);
      }
      return null;
    })().finally(() => {
      if (this.inFlightSyncPromise === syncPromise) {
        this.inFlightSyncPromise = null;
        this.inFlightSyncUid = null;
      }
    });

    this.inFlightSyncPromise = syncPromise;
    this.inFlightSyncUid = userId;
    return syncPromise;
  }

  /**
   * Register the current device's FCM token via authenticated backend endpoint
   * (atomically transfers shared-device ownership without exposing other user records).
   * Assigns currentToken/registeredUserId ONLY after POST /api/push/register returns 2xx.
   */
  private async saveTokenToFirestore(userId: string, token: string, force: boolean = false): Promise<boolean> {
    try {
      const currentUid = this.getCurrentAuthUid();
      if (!currentUid || currentUid !== userId) {
        return false;
      }

      if (!force && this.currentToken === token && this.registeredUserId === userId) {
        return true;
      }

      const ok = await this.postAuthenticatedPushEndpoint('/api/push/register', {
        token,
        platform: 'web',
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent || 'unknown' : 'unknown',
      });
      if (ok) {
        this.currentToken = token;
        this.registeredUserId = userId;
        console.log('[Push] Token registered via authenticated push service for user:', userId);
        return true;
      }

      if (this.registeredUserId === userId) {
        this.registeredUserId = null;
      }
      console.warn('[Push] Authenticated token registration returned non-OK status.');
      return false;
    } catch (err) {
      if (this.registeredUserId === userId) {
        this.registeredUserId = null;
      }
      console.warn('[Push] Error registering push token:', err);
      return false;
    }
  }

  /**
   * Best-effort, bounded unlinking of ONLY the current device's FCM token prior to logout.
   * Never blocks sign-out if offline or slow, and preserves the customer's other registered devices.
   */
  public async unregisterCurrentDeviceToken(): Promise<void> {
    const tokenToClear = this.currentToken;
    this.currentToken = null;
    this.registeredUserId = null;

    if (!this.getCurrentAuthUid()) return;

    const runUnregister = async (): Promise<void> => {
      let resolvedToken = tokenToClear;

      if (!resolvedToken && this.getBrowserNotificationPermission() === 'granted') {
        try {
          if (this.deps.acquireFcmTokenFn && this.deps.ensureActiveSwFn) {
            const reg = await this.deps.ensureActiveSwFn();
            if (reg) resolvedToken = await this.deps.acquireFcmTokenFn(reg);
          } else if (typeof window !== 'undefined') {
            const messaging = this.messaging || ((await this.checkSupport()) ? getMessaging(app) : null);
            const reg =
              this.serviceWorkerRegistration ||
              ('serviceWorker' in navigator
                ? await navigator.serviceWorker.getRegistration('/').catch(() => null)
                : null);
            if (messaging && reg?.active) {
              const vapidKey = (import.meta as any).env?.VITE_FIREBASE_VAPID_KEY || undefined;
              resolvedToken = await getToken(messaging, {
                serviceWorkerRegistration: reg,
                vapidKey,
              });
            }
          }
        } catch {
          // Ignore token lookup errors during logout
        }
      }

      if (!resolvedToken) return;

      await this.postAuthenticatedPushEndpoint(
        '/api/push/unregister',
        { token: resolvedToken },
        PushNotificationService.PUSH_UNREGISTER_TIMEOUT_MS
      ).catch(() => false);
    };

    try {
      await Promise.race([
        runUnregister(),
        new Promise<void>((resolve) => setTimeout(resolve, PushNotificationService.PUSH_UNREGISTER_TIMEOUT_MS)),
      ]);
    } catch {
      // Never block user logout
    }
  }

  private static readonly CROSS_TAB_OS_DEDUPE_KEY = 'monvera_fg_push_os_claims';
  private static readonly CROSS_TAB_OS_DEDUPE_WINDOW_MS = 15_000;

  /**
   * Coordinate across multiple visible same-origin tabs/PWA windows so an FCM
   * foreground broadcast triggers at most one OS notification per event.
   */
  private claimCrossTabOsNotification(tag: string, nowMs: number = Date.now()): boolean {
    const cleanTag = String(tag || '').trim();
    if (!cleanTag) return true;

    try {
      if (typeof window === 'undefined' || !window.localStorage) {
        return true;
      }

      const raw = window.localStorage.getItem(PushNotificationService.CROSS_TAB_OS_DEDUPE_KEY);
      const parsed: Record<string, number> = raw ? JSON.parse(raw) || {} : {};
      const next: Record<string, number> = {};

      for (const [k, ts] of Object.entries(parsed)) {
        if (typeof ts === 'number' && nowMs - ts < PushNotificationService.CROSS_TAB_OS_DEDUPE_WINDOW_MS) {
          next[k] = ts;
        }
      }

      if (typeof next[cleanTag] === 'number' && nowMs - next[cleanTag] < PushNotificationService.CROSS_TAB_OS_DEDUPE_WINDOW_MS) {
        return false;
      }

      next[cleanTag] = nowMs;

      // Bound stored entries so storage stays tiny
      const entries = Object.entries(next);
      if (entries.length > 40) {
        entries.sort((a, b) => a[1] - b[1]);
        for (const [oldKey] of entries.slice(0, entries.length - 40)) {
          delete next[oldKey];
        }
      }

      window.localStorage.setItem(PushNotificationService.CROSS_TAB_OS_DEDUPE_KEY, JSON.stringify(next));
    } catch {
      // Never suppress OS notifications if storage is unavailable or restricted
    }

    return true;
  }

  /**
   * Resolve a ServiceWorkerRegistration capable of calling showNotification()
   * for foreground OS notification display (required on Android Chrome / installed PWAs).
   */
  private async resolveActiveSwRegistrationForDisplay(): Promise<ServiceWorkerRegistration | null> {
    if (
      this.serviceWorkerRegistration &&
      typeof this.serviceWorkerRegistration.showNotification === 'function'
    ) {
      return this.serviceWorkerRegistration;
    }

    if (this.deps.ensureActiveSwFn) {
      const injectedReg = await this.deps.ensureActiveSwFn().catch(() => null);
      if (injectedReg && typeof injectedReg.showNotification === 'function') {
        this.serviceWorkerRegistration = injectedReg;
        return injectedReg;
      }
    }

    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return null;
    }

    if (typeof window !== 'undefined') {
      const ensured = await this.ensureActiveServiceWorkerRegistration().catch(() => null);
      if (ensured && typeof ensured.showNotification === 'function') {
        return ensured;
      }
    }

    try {
      if (typeof navigator.serviceWorker.getRegistration === 'function') {
        const reg = await navigator.serviceWorker.getRegistration('/').catch(() => null);
        if (reg && typeof reg.showNotification === 'function' && (reg.active || !reg.installing)) {
          this.serviceWorkerRegistration = reg;
          return reg;
        }
      }

      if (navigator.serviceWorker.ready) {
        const readyReg = await Promise.race([
          navigator.serviceWorker.ready.catch(() => null),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
        ]);
        if (readyReg && typeof readyReg.showNotification === 'function') {
          this.serviceWorkerRegistration = readyReg;
          return readyReg;
        }
      }
    } catch {
      // Ignore SW lookup failures
    }

    return null;
  }

  /**
   * Subscribe to foreground push messages while the user has Monvera open.
   * Deduplicates rapid duplicate deliveries, notifies the in-app listener (toast + balance/drawer sync),
   * and displays an OS notification via the active ServiceWorkerRegistration when permission is granted
   * (both when Monvera is open/visible on Android/PWA/desktop and when minimized/hidden).
   */
  public listenToForegroundMessages(
    onMessageReceived: (payload: any, normalized: NormalizedPushNotification) => void
  ): () => void {
    let unsubscribe: (() => void) | null = null;
    let disposed = false;

    const handleIncoming = (payload: any) => {
      if (disposed) return;
      const normalized = normalizePushPayload(payload);
      if (!this.foregroundDeduplicator.shouldAccept(normalized.dedupeKey)) {
        return;
      }

      onMessageReceived(payload, normalized);

      const browserPerm = this.getBrowserNotificationPermission();
      if (browserPerm === 'granted') {
        const tag = normalized.dedupeKey.slice(0, 96);
        if (!this.claimCrossTabOsNotification(tag)) {
          return;
        }

        const options = {
          body: normalized.body,
          icon: '/pwa-192x192.png',
          badge: '/pwa-192x192.png',
          tag,
          renotify: false,
          actions: [
            {
              action: 'read_more',
              title: 'Read More',
            },
          ],
          data: {
            title: normalized.title,
            body: normalized.body,
            url: normalized.url,
            actionView: normalized.actionView,
            transactionId: normalized.transactionId,
            referenceId: normalized.referenceId,
            direction: normalized.direction,
            amount: normalized.amount,
            currency: normalized.currency,
            description: normalized.description,
            category: normalized.category,
            type: normalized.type,
            timestamp: normalized.timestamp,
          },
        } as NotificationOptions;

        void this.displayServiceWorkerNotification(normalized.title, options).catch((err) => {
          console.warn('[Push] Foreground OS notification display note:', err);
        });
      }
    };

    if (this.deps.subscribeOnMessageFn) {
      unsubscribe = this.deps.subscribeOnMessageFn(handleIncoming);
      return () => {
        disposed = true;
        if (unsubscribe) unsubscribe();
      };
    }

    this.init().then((messaging) => {
      if (!messaging || disposed) return;
      try {
        unsubscribe = onMessage(messaging, handleIncoming);
      } catch (err) {
        console.warn('[Push] onMessage listener setup note:', err);
      }
    });

    return () => {
      disposed = true;
      if (unsubscribe) unsubscribe();
    };
  }

  /**
   * Listen to navigation messages posted by the Service Worker when a user clicks
   * an OS notification or its "Read More" action button.
   */
  public listenToServiceWorkerNavigationMessages(
    onNavigate: (target: NotificationNavTarget) => void
  ): () => void {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return () => {};
    }

    const handleSwMessage = (event: MessageEvent) => {
      const msg = event?.data;
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'MONVERA_PUSH_NAVIGATE' && msg.payload) {
        onNavigate(msg.payload as NotificationNavTarget);
        return;
      }

      if (msg.isFirebaseMessaging && msg.messageType === 'notification-clicked') {
        const normalized = normalizePushPayload(msg);
        onNavigate(buildNotificationNavTargetFromNormalized(normalized));
      }
    };

    navigator.serviceWorker.addEventListener('message', handleSwMessage);
    return () => {
      navigator.serviceWorker.removeEventListener('message', handleSwMessage);
    };
  }

  /**
   * Display an OS notification through the active ServiceWorkerRegistration.showNotification API
   * (with Notification constructor fallback only when no SW registration is available).
   */
  public async displayServiceWorkerNotification(
    title: string,
    options?: NotificationOptions
  ): Promise<boolean> {
    if (this.deps.displayNotificationFn) {
      this.deps.displayNotificationFn(title, options);
      return true;
    }

    if (this.getBrowserNotificationPermission() !== 'granted') {
      return false;
    }

    const mergedOptions: NotificationOptions = {
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      ...options,
    };

    try {
      const swReg = await this.resolveActiveSwRegistrationForDisplay();
      if (swReg && typeof swReg.showNotification === 'function') {
        await swReg.showNotification(title, mergedOptions);
        return true;
      }

      if (typeof window !== 'undefined' && 'Notification' in window) {
        const { actions: _ignoredSwActions, ...windowNotificationOptions } = mergedOptions as NotificationOptions & {
          actions?: unknown;
        };
        const notif = new Notification(title, windowNotificationOptions);
        notif.onclick = () => {
          try {
            window.focus();
            const normalized = normalizePushPayload({ title, ...options, data: options?.data });
            const navTarget = buildNotificationNavTargetFromNormalized(normalized);
            window.dispatchEvent(new CustomEvent('monvera_notification_navigate', { detail: navTarget }));
          } catch {}
          notif.close();
        };
        return true;
      }
    } catch (err) {
      console.warn('[Push] Direct notification display note:', err);
    }

    return false;
  }

  /**
   * Display a direct browser notification safely if permissions allow
   */
  public displayClientNotification(title: string, options?: NotificationOptions): void {
    void this.displayServiceWorkerNotification(title, options);
  }
}

export const pushNotificationService = new PushNotificationService();
