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

// --- 5. FIREBASE CLOUD MESSAGING (PRESERVED MONVERA CONFIG & HANDLERS) ---
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
  console.log('[Monvera SW] Received background FCM message:', payload);

  // Firebase SDK automatically renders notifications containing a top-level `notification` object.
  if (payload?.notification) {
    return;
  }

  const notificationTitle = payload?.data?.title || 'Monvera Digital Bank';
  const notificationOptions: NotificationOptions = {
    body: payload?.data?.body || 'New account activity alert received.',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: payload?.data?.referenceId || `monvera-${Date.now()}`,
    renotify: true,
    data: {
      url: payload?.data?.url || '/dashboard',
      referenceId: payload?.data?.referenceId,
      timestamp: Date.now(),
    },
  } as NotificationOptions;

  return self.registration.showNotification(notificationTitle, notificationOptions);
});

// Resilient native push event listener fallback for non-FCM messages
self.addEventListener('push', (event: PushEvent) => {
  if (!event.data) return;
  try {
    const payload = event.data.json();
    if (payload.notification || payload.fcmMessageId) {
      // Handled natively by Firebase Messaging
      return;
    }
    const title = payload.title || 'Monvera Digital Bank';
    const body = payload.message || payload.body || 'Financial transaction alert.';
    event.waitUntil(
      self.registration.showNotification(title, {
        body,
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        tag: payload.referenceId || 'monvera-notification',
        renotify: true,
        data: { url: '/dashboard' },
      } as NotificationOptions)
    );
  } catch {
    // Non-JSON payload
    event.waitUntil(
      self.registration.showNotification('Monvera Digital Bank', {
        body: event.data.text() || 'New transaction activity.',
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        data: { url: '/dashboard' },
      })
    );
  }
});

// Notification click deep linking (preserves existing window focus / openWindow logic)
self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const urlToOpen = event.notification.data?.url || '/dashboard';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen);
      }
    })
  );
});
