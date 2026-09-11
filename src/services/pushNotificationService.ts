import { getMessaging, getToken, onMessage, isSupported, Messaging } from 'firebase/messaging';
import { doc, setDoc, getFirestore } from 'firebase/firestore';
import { app } from './firebase';

export interface PushRegistrationResult {
  status: 'granted' | 'denied' | 'default' | 'unsupported';
  token?: string;
  error?: string;
}

class PushNotificationService {
  private messaging: Messaging | null = null;
  private supported: boolean | null = null;
  private serviceWorkerRegistration: ServiceWorkerRegistration | null = null;

  /**
   * Check if Firebase Cloud Messaging & Web Push are supported in current browser/context
   */
  public async checkSupport(): Promise<boolean> {
    if (this.supported !== null) return this.supported;
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

  /**
   * Initialize service worker and Firebase messaging instance
   */
  public async init(): Promise<Messaging | null> {
    const isSup = await this.checkSupport();
    if (!isSup) return null;

    try {
      if (!this.serviceWorkerRegistration && 'serviceWorker' in navigator) {
        this.serviceWorkerRegistration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
          scope: '/',
        });
        console.log('[Push] Service worker registered successfully');
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
      const currentPermission = Notification.permission;
      let permissionResult = currentPermission;

      if (currentPermission === 'default') {
        permissionResult = await Notification.requestPermission();
      }

      if (permissionResult !== 'granted') {
        return { status: permissionResult as 'denied' | 'default' };
      }

      const messaging = await this.init();
      if (!messaging) {
        return { status: 'unsupported', error: 'Messaging engine unavailable.' };
      }

      // Optional VAPID key from environment, with default fallback
      const vapidKey = (import.meta as any).env?.VITE_FIREBASE_VAPID_KEY || undefined;

      const token = await getToken(messaging, {
        serviceWorkerRegistration: this.serviceWorkerRegistration || undefined,
        vapidKey,
      });

      if (token && userId) {
        await this.saveTokenToFirestore(userId, token);
        return { status: 'granted', token };
      }

      return { status: 'granted', token };
    } catch (err: any) {
      console.warn('[Push] Token registration error:', err);
      return { status: 'denied', error: err?.message || 'Failed to acquire notification token.' };
    }
  }

  /**
   * Silently sync existing granted token for the authenticated user
   */
  public async syncTokenForUser(userId: string): Promise<string | null> {
    if (typeof window === 'undefined' || !('Notification' in window)) return null;
    if (Notification.permission !== 'granted' || !userId) return null;

    try {
      const messaging = await this.init();
      if (!messaging) return null;

      const vapidKey = (import.meta as any).env?.VITE_FIREBASE_VAPID_KEY || undefined;
      const token = await getToken(messaging, {
        serviceWorkerRegistration: this.serviceWorkerRegistration || undefined,
        vapidKey,
      });

      if (token) {
        await this.saveTokenToFirestore(userId, token);
        return token;
      }
    } catch (err) {
      console.warn('[Push] Auto-sync token note:', err);
    }
    return null;
  }

  /**
   * Save registration token to Firestore under user subcollection and root index
   */
  private async saveTokenToFirestore(userId: string, token: string): Promise<void> {
    try {
      const db = getFirestore(app);
      // Clean safe hash from token
      const tokenId = btoa(token.slice(-32)).replace(/[/+=]/g, '_');
      const now = new Date().toISOString();

      const tokenData = {
        id: tokenId,
        userId,
        token,
        platform: 'web',
        userAgent: navigator.userAgent || 'unknown',
        createdAt: now,
        lastUsedAt: now,
      };

      // 1. Nested under users/{userId}/notificationTokens/{tokenId}
      const userTokenRef = doc(db, 'users', userId, 'notificationTokens', tokenId);
      await setDoc(userTokenRef, tokenData, { merge: true });

      // 2. Global token index for server dispatchers
      const globalTokenRef = doc(db, 'notification_tokens', tokenId);
      await setDoc(globalTokenRef, tokenData, { merge: true });

      console.log('[Push] Token registered in Firestore for user:', userId);
    } catch (err) {
      console.warn('[Push] Error saving token to Firestore:', err);
    }
  }

  /**
   * Subscribe to foreground push messages while the user has Monvera open
   */
  public listenToForegroundMessages(onMessageReceived: (payload: any) => void): () => void {
    let unsubscribe: (() => void) | null = null;

    this.init().then((messaging) => {
      if (!messaging) return;
      try {
        unsubscribe = onMessage(messaging, (payload) => {
          console.log('[Push] Foreground push message received:', payload);
          onMessageReceived(payload);

          // If window is blurred or document is hidden, show native browser notification
          if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
            const title = payload.notification?.title || payload.data?.title || 'Monvera Digital Bank';
            const body = payload.notification?.body || payload.data?.body || 'New financial activity alert.';
            this.displayClientNotification(title, {
              body,
              icon: '/favicon.svg',
              tag: payload.data?.referenceId || 'monvera-foreground',
            });
          }
        });
      } catch (err) {
        console.warn('[Push] onMessage listener setup note:', err);
      }
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }

  /**
   * Display a direct browser notification safely if permissions allow
   */
  public displayClientNotification(title: string, options?: NotificationOptions): void {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    try {
      if (this.serviceWorkerRegistration && 'showNotification' in this.serviceWorkerRegistration) {
        this.serviceWorkerRegistration.showNotification(title, {
          icon: '/favicon.svg',
          badge: '/favicon.svg',
          ...options,
        });
      } else {
        new Notification(title, {
          icon: '/favicon.svg',
          ...options,
        });
      }
    } catch (err) {
      console.warn('[Push] Direct notification display note:', err);
    }
  }
}

export const pushNotificationService = new PushNotificationService();
