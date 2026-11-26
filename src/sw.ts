/// <reference lib="webworker" />

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getMessaging, onBackgroundMessage } from 'firebase/messaging/sw';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NetworkOnly } from 'workbox-strategies';

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

const BANKING_API_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const networkOnlyStrategy = new NetworkOnly();

const EXTERNAL_NETWORK_ONLY_HOST_PATTERNS = [
  /^monvera-digital-banking-production-6b9a206d\.up\.railway\.app$/i,
  /^(identitytoolkit|securetoken|firestore|firebasestorage|fcmregistrations|firebaseinstallations|fcm)\.googleapis\.com$/i,
  /^monvera-digital-banking\.(firebaseapp\.com|firebasestorage\.app)$/i,
  /^(api|checkout|js)\.stripe\.com$/i,
];

// --- 1. STRICT BANKING & AUTHENTICATION SECURITY RULES (EVALUATED FIRST) ---
// Same-origin backend APIs must always hit the live server and never be cached.
for (const method of BANKING_API_METHODS) {
  registerRoute(
    ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/api/'),
    networkOnlyStrategy,
    method
  );

  // Railway backend, Firebase Auth/Firestore/Storage/FCM, and Stripe payment endpoints
  registerRoute(
    ({ url }) => EXTERNAL_NETWORK_ONLY_HOST_PATTERNS.some((pattern) => pattern.test(url.hostname)),
    networkOnlyStrategy,
    method
  );
}

// Service worker files and manifest must never be served from fallback HTML
registerRoute(
  ({ url, sameOrigin }) =>
    sameOrigin &&
    (url.pathname === '/sw.js' ||
      url.pathname === '/firebase-messaging-sw.js' ||
      url.pathname === '/manifest.webmanifest'),
  networkOnlyStrategy
);

// --- 2. SAFE STATIC APP-SHELL PRECACHING ---
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// --- 3. SAFE SPA NAVIGATION FALLBACK ---
const navigationHandler = createHandlerBoundToURL('/index.html');
const navigationRoute = new NavigationRoute(navigationHandler, {
  denylist: [
    /^\/api(?:\/|$)/,
    /^\/sw\.js$/,
    /^\/firebase-messaging-sw\.js$/,
    /^\/manifest\.webmanifest$/,
  ],
});
registerRoute(navigationRoute);

// --- 4. PROMPT-CONTROLLED UPDATE ACTIVATION (NO FORCED MID-SESSION SKIPWAITING) ---
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

import {
  normalizePushPayload,
  buildNotificationNavTargetFromNormalized,
} from './utils/pushNotificationPayload';

// --- 5. UNIFIED NOTIFICATION CLICK & BACKGROUND PUSH HANDLERS ---
function resolveSwNavigationDetails(rawData: any): {
  fullUrl: string;
  navTarget: ReturnType<typeof buildNotificationNavTargetFromNormalized>;
} {
  const normalized = normalizePushPayload(rawData);
  const navTarget = buildNotificationNavTargetFromNormalized(normalized);
  const resolvedUrl = new URL(normalized.url || '/dashboard?view=transactions', self.location.origin);
  if (resolvedUrl.origin !== self.location.origin) {
    const safeFallback = new URL('/dashboard?view=transactions', self.location.origin).toString();
    return {
      fullUrl: safeFallback,
      navTarget: {
        ...navTarget,
        actionView: 'transactions',
        url: '/dashboard?view=transactions',
      },
    };
  }
  return {
    fullUrl: resolvedUrl.toString(),
    navTarget,
  };
}

// CRITICAL: Register notificationclick BEFORE getMessaging() so Firebase SDK's
// internal onNotificationClick (which calls stopImmediatePropagation() and only
// focuses windows without navigating) never hijacks Monvera deep-link clicks.
self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  event.stopImmediatePropagation();

  const { fullUrl, navTarget } = resolveSwNavigationDetails(event.notification?.data);

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(async (windowClients) => {
        const sameOriginClients = windowClients.filter((client) => {
          try {
            return new URL(client.url).origin === self.location.origin;
          } catch {
            return false;
          }
        });

        const preferredClient =
          sameOriginClients.find((client) => client.focused || client.visibilityState === 'visible') ||
          sameOriginClients[0];

        if (preferredClient) {
          try {
            preferredClient.postMessage({
              type: 'MONVERA_PUSH_NAVIGATE',
              payload: navTarget,
            });
          } catch {
            // Ignore postMessage failures; navigate below handles URL handoff
          }

          if ('navigate' in preferredClient && typeof preferredClient.navigate === 'function') {
            try {
              const navigated = await preferredClient.navigate(fullUrl);
              if (navigated) {
                try {
                  navigated.postMessage({
                    type: 'MONVERA_PUSH_NAVIGATE',
                    payload: navTarget,
                  });
                } catch {}
                return navigated.focus();
              }
            } catch {
              // Fallback cleanly to focusing existing client + postMessage navigation
            }
          }

          if ('focus' in preferredClient) {
            return preferredClient.focus();
          }
          return preferredClient;
        }

        if (self.clients.openWindow) {
          return self.clients.openWindow(fullUrl);
        }
        return undefined;
      })
  );
});

const firebaseConfig = {
  apiKey: 'AIzaSyDpD41fq8guo0gLojjkawsjMnBbFfy42VU',
  authDomain: 'monvera-digital-banking.firebaseapp.com',
  projectId: 'monvera-digital-banking',
  storageBucket: 'monvera-digital-banking.firebasestorage.app',
  messagingSenderId: '1097022690812',
  appId: '1:1097022690812:web:c7848faac29d4226c84e79',
};

const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
const messaging = getMessaging(firebaseApp);

// Background push notification receiver (preserves data-only messages without duplicating auto-shown notification payloads)
onBackgroundMessage(messaging, (payload) => {
  // Firebase SDK automatically renders notifications containing a top-level `notification` object.
  if (payload?.notification) {
    return;
  }

  const normalized = normalizePushPayload(payload);
  const notificationOptions: NotificationOptions = {
    body: normalized.body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: normalized.dedupeKey.slice(0, 96),
    renotify: true,
    actions: [
      {
        action: 'read_more',
        title: 'Read More',
      },
    ],
    data: {
      url: normalized.url,
      actionView: normalized.actionView,
      transactionId: normalized.transactionId,
      referenceId: normalized.referenceId,
      direction: normalized.direction,
      amount: normalized.amount,
      currency: normalized.currency,
      description: normalized.description,
      timestamp: normalized.timestamp,
    },
  } as NotificationOptions;

  return self.registration.showNotification(normalized.title, notificationOptions);
});

// Resilient native push event listener fallback strictly for non-FCM messages
self.addEventListener('push', (event: PushEvent) => {
  if (!event.data) return;
  try {
    const payload = event.data.json();
    if (payload.notification || payload.fcmMessageId || payload.data) {
      // Handled natively by Firebase Messaging onPush / onBackgroundMessage
      return;
    }
    const normalized = normalizePushPayload(payload);
    event.waitUntil(
      self.registration.showNotification(normalized.title, {
        body: normalized.body,
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        tag: normalized.dedupeKey.slice(0, 96),
        renotify: true,
        actions: [
          {
            action: 'read_more',
            title: 'Read More',
          },
        ],
        data: {
          url: normalized.url,
          actionView: normalized.actionView,
          transactionId: normalized.transactionId,
          referenceId: normalized.referenceId,
          timestamp: normalized.timestamp,
        },
      } as NotificationOptions)
    );
  } catch {
    // Non-JSON payload
    event.waitUntil(
      self.registration.showNotification('Monvera Account Alert', {
        body: event.data.text() || 'New transaction activity.',
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        actions: [
          {
            action: 'read_more',
            title: 'Read More',
          },
        ],
        data: { url: '/dashboard?view=transactions', actionView: 'transactions' },
      } as NotificationOptions)
    );
  }
});
