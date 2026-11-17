import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/common/ErrorBoundary.tsx';
import { initTranslation } from './services/translationService.ts';
import { pushNotificationService } from './services/pushNotificationService.ts';
import './index.css';

// Initialize automatic multilingual translation
initTranslation();

// Register unified root PWA + FCM service worker in production before AuthContext initializes push sync
if (import.meta.env.PROD && typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  const swRegistrationPromise = navigator.serviceWorker
    .register('/sw.js', { scope: '/' })
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

