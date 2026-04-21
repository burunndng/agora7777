/* Agora service worker.
 *
 * Strategy:
 *  - Precache the app shell on install (best-effort: index.html + favicon + manifest).
 *  - For static asset GETs (script/style/font/image) on the same origin,
 *    use stale-while-revalidate so the UI boots offline.
 *  - For navigations (HTML), use network-first with offline fallback to cached index.
 *  - Bypass everything else (Nostr WSS handled outside fetch; relay HTTP, nostr.band,
 *    corsproxy.io are intentionally network-only — no decrypted data lands on disk).
 *
 * Update model: NO automatic skipWaiting / clients.claim. A new worker
 * sits in `installed` state until the page sends a `SKIP_WAITING` message
 * (driven by the in-app SwUpdatePrompt banner). This prevents a poisoned
 * deploy from replacing a running session without the user's consent.
 */

const VERSION = "v2";
const SHELL_CACHE = `agora-shell-${VERSION}`;
const ASSET_CACHE = `agora-assets-${VERSION}`;

const SCOPE_URL = new URL(self.registration.scope);
const SHELL_URLS = [
  SCOPE_URL.pathname,
  SCOPE_URL.pathname + "index.html",
  SCOPE_URL.pathname + "favicon.svg",
  SCOPE_URL.pathname + "icon.svg",
  SCOPE_URL.pathname + "manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await Promise.all(
        SHELL_URLS.map((u) =>
          cache.add(u).catch(() => {
            /* ignore individual failures */
          }),
        ),
      );
      // Intentionally no skipWaiting() — wait for user-driven SKIP_WAITING.
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE)
          .map((k) => caches.delete(k)),
      );
      // Intentionally no clients.claim() — let the existing session keep
      // running until the user reloads.
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isNavigationRequest(request) {
  return request.mode === "navigate" || (request.method === "GET" && request.headers.get("accept")?.includes("text/html"));
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Don't touch cross-origin requests (relays, nostr.band, corsproxy.io, NIP-96 hosts).
  // The user's privacy guarantee: nothing decrypted from third parties lands in our caches.
  if (!isSameOrigin(url)) return;

  if (isNavigationRequest(request)) {
    event.respondWith(handleNavigation(request));
    return;
  }

  // Static assets: stale-while-revalidate.
  event.respondWith(staleWhileRevalidate(request));
});

async function handleNavigation(request) {
  try {
    const network = await fetch(request);
    const cache = await caches.open(SHELL_CACHE);
    cache.put(request, network.clone()).catch(() => {});
    return network;
  } catch (err) {
    const cache = await caches.open(SHELL_CACHE);
    const indexUrl = SCOPE_URL.pathname + "index.html";
    const cached = (await cache.match(request)) || (await cache.match(indexUrl)) || (await cache.match(SCOPE_URL.pathname));
    if (cached) return cached;
    return new Response("Offline and no cached app shell available.", {
      status: 503,
      headers: { "Content-Type": "text/plain" },
    });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);
  if (cached) return cached;
  const fresh = await networkPromise;
  if (fresh) return fresh;
  return new Response("Offline.", { status: 503, headers: { "Content-Type": "text/plain" } });
}
