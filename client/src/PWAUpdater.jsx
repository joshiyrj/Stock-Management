import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * Silent auto-updater — no UI prompt needed.
 * The service worker registers with `registerType: 'autoUpdate'`
 * so updates apply automatically on next visit.
 */
export function PWAUpdater() {
  useRegisterSW({
    onRegistered(r) {
      // Optional: poll for updates every hour
      if (r) {
        setInterval(() => r.update(), 60 * 60 * 1000);
      }
    },
    onRegisterError(error) {
      console.error('SW registration error', error);
    },
  });

  return null;
}
