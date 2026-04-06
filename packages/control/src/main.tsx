import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Register service worker for PWA support
if ('serviceWorker' in navigator && (import.meta as unknown as { env?: { PROD?: boolean } }).env?.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(registration => {
      // Force an immediate update check so a freshly deployed sw.js is picked up
      // without waiting for the browser's 24-hour update interval.
      registration.update().catch(() => {});

      // When a new SW is found, tell it to skip waiting so it activates immediately
      // (the SW itself also calls skipWaiting on install, but this handles the case
      // where the new SW was already waiting when this page loaded).
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            newWorker.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });
    }).catch(() => {
      // SW registration failure is non-fatal — app works without it
    });

    // When a new SW activates it sends SW_UPDATED — reload to get the new bundle.
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'SW_UPDATED') {
        window.location.reload();
      }
    });
  });
}
