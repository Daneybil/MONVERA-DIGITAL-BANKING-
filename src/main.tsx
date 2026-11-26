import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/common/ErrorBoundary.tsx';
import { initTranslation } from './services/translationService.ts';
import { pushNotificationService } from './services/pushNotificationService.ts';
import './index.css';

// Initialize automatic multilingual translation
initTranslation();

function promoteWaitingUnifiedServiceWorker(
  registration: ServiceWorkerRegistration | null | undefined
): void {
  if (!registration) return;
  try {
    if (registration.waiting && registration.waiting.scriptURL.endsWith('/sw.js')) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
  } catch (err) {
    console.warn('[PWA] Unable to signal waiting service worker activation:', err);
  }
}

// Register unified root PWA + FCM service worker in production before AuthContext initializes push sync
if (import.meta.env.PROD && typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  const swRegistrationPromise = navigator.serviceWorker
    .register('/sw.js', { scope: '/' })
    .then((registration) => {
      promoteWaitingUnifiedServiceWorker(registration);

      if (typeof registration.addEventListener === 'function') {
        registration.addEventListener('updatefound', () => {
          const installingWorker = registration.installing;
          if (!installingWorker || !installingWorker.scriptURL.endsWith('/sw.js')) return;
          installingWorker.addEventListener('statechange', () => {
            if (installingWorker.state === 'installed') {
              promoteWaitingUnifiedServiceWorker(registration);
            }
          });
        });
      }

      if (typeof registration.update === 'function') {
        void registration.update().catch(() => {});
      }

      return registration;
    })
    .catch((err) => {
      console.warn('[PWA] Unified service worker registration note:', err);
      return null;
    });
  pushNotificationService.setServiceWorkerRegistrationPromise(swRegistrationPromise);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

