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
  initMessagingFn?: () => Messaging | null;
  isProdFn?: () => boolean;
  swActivationTimeoutMs?: number;
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
  private pendingTokenSyncUserId: string | null = null;
  private controllerChangeAttached = false;
  private watchedRecoveryRegistrations = new WeakSet<ServiceWorkerRegistration>();
  private pendingOsNotifications = new Map<
    string,
    { title: string; options: NotificationOptions; enqueuedAt: number }
  >();
  private osRecoveryInFlight = false;
  private deps: PushNotificationServiceDeps;
  private static readonly SW_ACTIVATION_TIMEOUT_MS = 12000;
  private static readonly PUSH_UNREGISTER_TIMEOUT_MS = 3000;
  private static readonly PENDING_OS_NOTIFICATION_TTL_MS = 5 * 60_000;

  constructor(deps: PushNotificationServiceDeps = {}) {
    this.deps = deps;
  }

  private isProdEnv(): boolean {
    if (this.deps.isProdFn) return this.deps.isProdFn();
    return Boolean((import.meta as any).env?.PROD);
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
    this.setupControllerChangeListener();
  }

  private isTargetUnifiedWorker(worker: ServiceWorker | null | undefined): worker is ServiceWorker {
    if (!worker) return false;
    if (!this.isProdEnv()) return true;
    return typeof worker.scriptURL === 'string' && worker.scriptURL.endsWith('/sw.js');
  }

  private promoteWaitingWorker(registration: ServiceWorkerRegistration | null | undefined): boolean {
    if (!registration?.waiting) return false;
    if (!this.isTargetUnifiedWorker(registration.waiting)) return false;
    try {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      return true;
    } catch (err) {
      console.warn('[Push] Failed to promote waiting service worker:', err);
      return false;
    }
  }

  private setupControllerChangeListener(): void {
    if (this.controllerChangeAttached) return;
    if (
      typeof window === 'undefined' ||
      typeof navigator === 'undefined' ||
      !('serviceWorker' in navigator) ||
      typeof navigator.serviceWorker?.addEventListener !== 'function'
    ) {
      return;
    }
    this.controllerChangeAttached = true;

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (typeof navigator.serviceWorker.getRegistration !== 'function') return;
      void navigator.serviceWorker
        .getRegistration('/')
        .then((reg) => {
          if (
            reg &&
            this.isValidRootRegistration(reg) &&
            reg.active &&
            reg.active.state === 'activated' &&
            this.isTargetUnifiedWorker(reg.active)
          ) {
            void this.onServiceWorkerActivated(reg);
          }
        })
        .catch(() => {});
    });
  }

  private async onServiceWorkerActivated(registration: ServiceWorkerRegistration): Promise<void> {
    this.serviceWorkerRegistration = registration;
    await this.flushPendingOsNotifications(registration);

    const retryUid = this.pendingTokenSyncUserId;
    if (retryUid && this.getBrowserNotificationPermission() === 'granted') {
      void this.syncTokenForUser(retryUid);
    }
  }

  private attachBackgroundActivationRecovery(registration: ServiceWorkerRegistration): void {
    if (this.watchedRecoveryRegistrations.has(registration)) return;
    this.watchedRecoveryRegistrations.add(registration);

    const trackedSet = new Set<ServiceWorker>();
    const cleanup = () => {
      for (const worker of trackedSet) {
        worker.removeEventListener('statechange', handleState);
      }
      trackedSet.clear();
      if (typeof registration.removeEventListener === 'function') {
        registration.removeEventListener('updatefound', handleUpdateFound);
      }
    };

    const checkAndRecover = () => {
      if (
        registration.active &&
        registration.active.state === 'activated' &&
        this.isTargetUnifiedWorker(registration.active)
      ) {
        cleanup();
        void this.onServiceWorkerActivated(registration);
        return true;
      }
      this.promoteWaitingWorker(registration);
      return false;
    };

    const handleState = () => {
      checkAndRecover();
    };

    const trackWorker = (worker: ServiceWorker | null | undefined) => {
      if (!worker || !this.isTargetUnifiedWorker(worker) || trackedSet.has(worker)) return;
      trackedSet.add(worker);
      if (typeof worker.addEventListener === 'function') {
        worker.addEventListener('statechange', handleState);
      }
    };

    const handleUpdateFound = () => {
      trackWorker(registration.installing);
      trackWorker(registration.waiting);
      checkAndRecover();
    };

    trackWorker(registration.installing);
    trackWorker(registration.waiting);
    if (typeof registration.addEventListener === 'function') {
      registration.addEventListener('updatefound', handleUpdateFound);
    }
    checkAndRecover();
  }

  /**
   * Validate that a registration matches the expected Monvera root scope and environment worker script.
   * Permits a root registration actively transitioning from legacy /firebase-messaging-sw.js to /sw.js.
   */
  private isValidRootRegistration(
    registration: ServiceWorkerRegistration | null | undefined
  ): registration is ServiceWorkerRegistration {
    if (!registration || typeof window === 'undefined') return false;
    const expectedScope = `${window.location.origin}/`;
    if (registration.scope !== expectedScope) {
      console.warn('[Push] Unexpected service worker scope:', registration.scope);
      return false;
    }

    if (this.isProdEnv()) {
      const workers = [registration.active, registration.waiting, registration.installing].filter(
        (w): w is ServiceWorker => Boolean(w)
      );
      const hasUnifiedWorker = workers.some((w) => this.isTargetUnifiedWorker(w));
      if (workers.length > 0 && !hasUnifiedWorker) {
        console.warn(
          '[Push] Ignoring non-unified service worker registration in production:',
          workers[0].scriptURL
        );
        return false;
      }
    }

    return true;
  }

  /**
   * Wait (with a bounded timeout) until a target service worker becomes activated
   */
  private waitForRegistrationActivation(
    registration: ServiceWorkerRegistration,
    timeoutMs: number = this.deps.swActivationTimeoutMs ?? PushNotificationService.SW_ACTIVATION_TIMEOUT_MS
  ): Promise<ServiceWorkerRegistration | null> {
    if (
      registration.active &&
      registration.active.state === 'activated' &&
      this.isTargetUnifiedWorker(registration.active)
    ) {
      return Promise.resolve(registration);
    }

    this.promoteWaitingWorker(registration);

    const candidate =
      [registration.installing, registration.waiting, registration.active].find((w) =>
        this.isTargetUnifiedWorker(w)
      ) ||
      registration.waiting ||
      registration.installing ||
      registration.active;

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
        if (trackedWorker && typeof trackedWorker.removeEventListener === 'function') {
          trackedWorker.removeEventListener('statechange', handleStateChange);
          trackedWorker = null;
        }
        if (typeof registration.removeEventListener === 'function') {
          registration.removeEventListener('updatefound', handleUpdateFound);
        }
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
        if (
          registration.active &&
          registration.active.state === 'activated' &&
          this.isTargetUnifiedWorker(registration.active)
        ) {
          finish(registration);
          return true;
        }
        return false;
      };

      const attachToWorker = (worker: ServiceWorker | null | undefined) => {
        if (!worker || worker === trackedWorker) return;
        if (trackedWorker && typeof trackedWorker.removeEventListener === 'function') {
          trackedWorker.removeEventListener('statechange', handleStateChange);
        }
        trackedWorker = worker;
        if (typeof trackedWorker.addEventListener === 'function') {
          trackedWorker.addEventListener('statechange', handleStateChange);
        }
      };

      const handleStateChange = () => {
        if (checkActive()) return;

        this.promoteWaitingWorker(registration);

        if (
          registration.waiting &&
          this.isTargetUnifiedWorker(registration.waiting) &&
          trackedWorker !== registration.waiting
        ) {
          attachToWorker(registration.waiting);
        }

        const currentState = trackedWorker?.state;
        if (currentState === 'redundant') {
          const nextWorker = [registration.installing, registration.waiting, registration.active].find(
            (w) => this.isTargetUnifiedWorker(w) && w.state !== 'redundant'
          );
          if (nextWorker) {
            attachToWorker(nextWorker);
            return;
          }
          if (!registration.active && !registration.waiting && !registration.installing) {
            finish(null, '[Push] Service worker failed activation (state: redundant).');
          }
        }
      };

      const handleUpdateFound = () => {
        if (checkActive()) return;
        if (registration.installing && this.isTargetUnifiedWorker(registration.installing)) {
          attachToWorker(registration.installing);
        }
      };

      const timeoutId = setTimeout(() => {
        if (!checkActive()) {
          this.attachBackgroundActivationRecovery(registration);
          finish(
            null,
            `[Push] Timed out after ${timeoutMs}ms waiting for service worker activation; will retry once active.`
          );
        }
      }, timeoutMs);

      if (typeof trackedWorker.addEventListener === 'function') {
        trackedWorker.addEventListener('statechange', handleStateChange);
      }
      if (typeof registration.addEventListener === 'function') {
        registration.addEventListener('updatefound', handleUpdateFound);
      }

      // Re-check synchronously in case state transitioned between inspection and listener attachment
      checkActive();
    });
  }

  /**
   * Resolve and confirm an activated root ServiceWorkerRegistration (never blocks forever or leaves waiting stuck)
   */
  private async ensureActiveServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return null;
    }

    this.setupControllerChangeListener();

    if (
      this.serviceWorkerRegistration &&
      this.isValidRootRegistration(this.serviceWorkerRegistration) &&
      this.serviceWorkerRegistration.active?.state === 'activated' &&
      this.isTargetUnifiedWorker(this.serviceWorkerRegistration.active)
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

        if (this.isProdEnv()) {
          if (!this.isValidRootRegistration(registration)) {
            const existingReg =
              typeof navigator.serviceWorker.getRegistration === 'function'
                ? await navigator.serviceWorker.getRegistration('/').catch(() => null)
                : null;
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
          }
        } else if (!registration) {
          // Development mode uses Vite middleware without bundled dist/sw.js
          registration = await navigator.serviceWorker
            .register('/firebase-messaging-sw.js', { scope: '/' })
            .catch((err) => {
              console.warn('[Push] Development service worker registration note:', err);
              return null;
            });
        }

        if (!this.isValidRootRegistration(registration)) {
          console.warn('[Push] Valid root service worker registration unavailable; push token sync deferred.');
          return null;
        }

        this.promoteWaitingWorker(registration);

        const activeReg = await this.waitForRegistrationActivation(registration);
        if (!activeReg || !activeReg.active || !this.isTargetUnifiedWorker(activeReg.active)) {
          return null;
        }

        this.serviceWorkerRegistration = activeReg;
        console.log('[Push] Unified service worker active and ready');
        return activeReg;
      } catch (err) {
        console.warn('[Push] Error confirming active service worker:', err);
        return null;
      } finally {
        if (
          !this.serviceWorkerRegistration?.active ||
          !this.isTargetUnifiedWorker(this.serviceWorkerRegistration.active)
        ) {
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
   * Initialize Firebase messaging instance promptly and warm up service worker readiness
   * in the background so foreground onMessage attaches without waiting for SW activation.
   */
  public async init(): Promise<Messaging | null> {
    const isSup = await this.checkSupport();
    if (!isSup) return null;

    this.setupControllerChangeListener();

    try {
      const warmupSw = this.deps.ensureActiveSwFn
        ? this.deps.ensureActiveSwFn()
        : this.ensureActiveServiceWorkerRegistration();
      void Promise.resolve(warmupSw).catch(() => null);

      if (this.deps.initMessagingFn) {
        if (!this.messaging) {
          this.messaging = this.deps.initMessagingFn();
        }
        return this.messaging;
      }

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

      if (userId) {
        this.pendingTokenSyncUserId = userId;
      }

      const messaging = await this.init();
      if (!messaging) {
        return { status: 'unsupported', error: 'Messaging engine unavailable.' };
      }

      const activeRegistration = this.deps.ensureActiveSwFn
        ? await this.deps.ensureActiveSwFn()
        : await this.ensureActiveServiceWorkerRegistration();
      if (!activeRegistration || (!this.deps.ensureActiveSwFn && !activeRegistration.active)) {
        console.warn('[Push] Skipping requestPushPermission getToken: no active service worker registration yet.');
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

    this.pendingTokenSyncUserId = userId;
    this.setupControllerChangeListener();

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
          console.warn('[Push] Deferring syncTokenForUser getToken until service worker activation completes.');
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
        if (this.pendingTokenSyncUserId === userId) {
          this.pendingTokenSyncUserId = null;
        }
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
    this.pendingTokenSyncUserId = null;
    this.pendingOsNotifications.clear();

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

  private isServiceWorkerRequiredEnvironment(): boolean {
    if (typeof navigator !== 'undefined') {
      const nav = navigator as Navigator & { standalone?: boolean };
      if (Boolean((nav as any).serviceWorker)) return true;
      if (/android/i.test(nav.userAgent || '')) return true;
      if (nav.standalone === true) return true;
    }
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      try {
        if (window.matchMedia('(display-mode: standalone)').matches) return true;
      } catch {}
    }
    return false;
  }

  private isSwRegistrationUsableForShowNotification(
    reg: ServiceWorkerRegistration | null | undefined
  ): reg is ServiceWorkerRegistration {
    if (!reg || typeof reg.showNotification !== 'function') return false;
    if (reg.active) {
      if (reg.active.state && reg.active.state !== 'activated') return false;
      return this.isTargetUnifiedWorker(reg.active);
    }
    return false;
  }

  private enqueuePendingOsNotification(title: string, options: NotificationOptions): void {
    const key = String(options.tag || title || 'monvera-alert').trim();
    if (!key) return;
    if (this.pendingOsNotifications.has(key)) return;

    this.pendingOsNotifications.set(key, {
      title,
      options,
      enqueuedAt: Date.now(),
    });

    if (this.pendingOsNotifications.size > 20) {
      const oldestKey = this.pendingOsNotifications.keys().next().value;
      if (oldestKey) {
        this.pendingOsNotifications.delete(oldestKey);
      }
    }
  }

  private async flushPendingOsNotifications(swReg: ServiceWorkerRegistration): Promise<void> {
    if (!this.isSwRegistrationUsableForShowNotification(swReg)) return;
    if (this.pendingOsNotifications.size === 0) return;
    if (this.getBrowserNotificationPermission() !== 'granted') {
      this.pendingOsNotifications.clear();
      return;
    }

    const now = Date.now();
    const items = Array.from(this.pendingOsNotifications.entries());
    for (const [key, item] of items) {
      if (now - item.enqueuedAt > PushNotificationService.PENDING_OS_NOTIFICATION_TTL_MS) {
        this.pendingOsNotifications.delete(key);
        continue;
      }
      this.pendingOsNotifications.delete(key);
      try {
        await swReg.showNotification(item.title, item.options);
      } catch (err) {
        this.pendingOsNotifications.set(key, item);
        console.warn('[Push] Deferred OS notification retry failed:', err);
        break;
      }
    }
  }

  private schedulePendingOsNotificationRecovery(): void {
    if (this.osRecoveryInFlight || this.pendingOsNotifications.size === 0) return;
    this.osRecoveryInFlight = true;

    void (async () => {
      try {
        const swReg = await this.resolveActiveSwRegistrationForDisplay();
        if (swReg) {
          await this.flushPendingOsNotifications(swReg);
        }
      } catch {
        // Retry will still trigger on controllerchange or background activation recovery
      } finally {
        this.osRecoveryInFlight = false;
      }
    })();
  }

  /**
   * Resolve a ServiceWorkerRegistration capable of calling showNotification()
   * for foreground OS notification display (required on Android Chrome / installed PWAs).
   */
  private async resolveActiveSwRegistrationForDisplay(): Promise<ServiceWorkerRegistration | null> {
    if (this.isSwRegistrationUsableForShowNotification(this.serviceWorkerRegistration)) {
      return this.serviceWorkerRegistration;
    }

    if (this.deps.ensureActiveSwFn) {
      const injectedReg = await this.deps.ensureActiveSwFn().catch(() => null);
      if (this.isSwRegistrationUsableForShowNotification(injectedReg)) {
        this.serviceWorkerRegistration = injectedReg;
        return injectedReg;
      }
    }

    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return null;
    }

    try {
      if (typeof navigator.serviceWorker.getRegistration === 'function') {
        const reg = await navigator.serviceWorker.getRegistration('/').catch(() => null);
        if (this.isSwRegistrationUsableForShowNotification(reg)) {
          this.serviceWorkerRegistration = reg;
          return reg;
        }
      }
    } catch {
      // Fall through to full activation check
    }

    if (typeof window !== 'undefined') {
      const ensured = await this.ensureActiveServiceWorkerRegistration().catch(() => null);
      if (this.isSwRegistrationUsableForShowNotification(ensured)) {
        return ensured;
      }
    }

    try {
      if (navigator.serviceWorker.ready) {
        const readyReg = await Promise.race([
          navigator.serviceWorker.ready.catch(() => null),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
        ]);
        if (this.isSwRegistrationUsableForShowNotification(readyReg)) {
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
   * Attaches Firebase onMessage promptly without blocking on SW activation,
   * deduplicates rapid duplicate deliveries, notifies the in-app listener (toast + balance/drawer sync),
   * and displays an OS notification via the active ServiceWorkerRegistration when permission is granted.
   */
  public listenToForegroundMessages(
    onMessageReceived: (payload: any, normalized: NormalizedPushNotification) => void
  ): () => void {
    let unsubscribe: (() => void) | null = null;
    let disposed = false;

    this.setupControllerChangeListener();

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
   * Display an OS notification exclusively through ServiceWorkerRegistration.showNotification
   * on Android Chrome / installed PWAs / SW-capable browsers. Never falls back to `new Notification()`
   * in SW-capable or Android/PWA environments; queues and retries safely once SW activation completes.
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

    const tagKey = String(mergedOptions.tag || title || 'monvera-alert').trim();

    try {
      const swReg = await this.resolveActiveSwRegistrationForDisplay();
      if (swReg && typeof swReg.showNotification === 'function') {
        await swReg.showNotification(title, mergedOptions);
        this.pendingOsNotifications.delete(tagKey);
        return true;
      }

      if (this.isServiceWorkerRequiredEnvironment()) {
        this.enqueuePendingOsNotification(title, mergedOptions);
        this.schedulePendingOsNotificationRecovery();
        console.warn(
          '[Push] Active service worker registration unavailable; queued foreground OS notification for post-activation display.'
        );
        return false;
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
      if (this.isServiceWorkerRequiredEnvironment()) {
        this.enqueuePendingOsNotification(title, mergedOptions);
        this.schedulePendingOsNotificationRecovery();
      }
      console.warn('[Push] Direct SW notification display note:', err);
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
