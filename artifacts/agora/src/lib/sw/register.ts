/**
 * Register the Agora service worker. We deliberately keep this small: the SW
 * itself implements the cache strategy. Registration only needs the path,
 * which respects the build-time base path so it works on GitHub Pages.
 */
export function registerServiceWorker(): void {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  // Don't register inside the dev banner / iframe error-modal preview.
  if (import.meta.env.DEV) return;

  const baseUrl = import.meta.env.BASE_URL || "/";
  const swUrl = `${baseUrl}sw.js`;

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(swUrl, { scope: baseUrl })
      .catch((err) => {
        // Service workers are a best-effort upgrade. Log but don't break the app.
        console.warn("[sw] registration failed", err);
      });
  });
}
