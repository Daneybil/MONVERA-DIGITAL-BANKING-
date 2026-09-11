/* eslint-disable no-undef */
// Monvera Digital Bank — Official Service Worker & Background Push Notification Handler
// Handles Firebase Cloud Messaging (FCM) background delivery & deep-link focus

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDpD41fq8guo0gLojjkawsjMnBbFfy42VU",
  authDomain: "monvera-digital-banking.firebaseapp.com",
  projectId: "monvera-digital-banking",
  storageBucket: "monvera-digital-banking.firebasestorage.app",
  messagingSenderId: "1097022690812",
  appId: "1:1097022690812:web:c7848faac29d4226c84e79"
});

const messaging = firebase.messaging();

// Background push notification receiver
messaging.onBackgroundMessage((payload) => {
  console.log('[Monvera SW] Received background FCM message:', payload);
  const notificationTitle = payload.notification?.title || payload.data?.title || 'Monvera Digital Bank';
  const notificationOptions = {
    body: payload.notification?.body || payload.data?.body || 'New account activity alert received.',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag: payload.data?.referenceId || `monvera-${Date.now()}`,
    renotify: true,
    data: {
      url: payload.data?.url || '/dashboard',
      referenceId: payload.data?.referenceId,
      timestamp: Date.now()
    }
  };

  return self.registration.showNotification(notificationTitle, notificationOptions);
});

// Resilient native push event listener fallback
self.addEventListener('push', (event) => {
  if (!event.data) return;
  try {
    const payload = event.data.json();
    if (payload.notification || payload.fcmMessageId) {
      // Handled natively by Firebase messaging compat
      return;
    }
    const title = payload.title || 'Monvera Digital Bank';
    const body = payload.message || payload.body || 'Financial transaction alert.';
    event.waitUntil(
      self.registration.showNotification(title, {
        body,
        icon: '/favicon.svg',
        badge: '/favicon.svg',
        tag: payload.referenceId || 'monvera-notification',
        renotify: true,
        data: { url: '/dashboard' }
      })
    );
  } catch (_err) {
    // Non-JSON payload
    event.waitUntil(
      self.registration.showNotification('Monvera Digital Bank', {
        body: event.data.text() || 'New transaction activity.',
        icon: '/favicon.svg',
        badge: '/favicon.svg',
        data: { url: '/dashboard' }
      })
    );
  }
});

// Notification click deep linking
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data?.url || '/dashboard';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
