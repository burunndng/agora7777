/**
 * Track Mastodon instances the user has loaded through the federated tab.
 * The build-time CSP bootstrap reads this list and adds each origin to
 * `connect-src`, so a brand-new instance only works after a reload in
 * production builds. The list is best-effort: if localStorage is full or
 * unavailable we silently skip.
 */

const KEY = "agora.federated.mastodonHosts.v1";
const MAX = 16;

function isValidHost(h: string): boolean {
  return /^[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+$/.test(h);
}

export function rememberMastodonInstance(hostname: string): void {
  if (typeof window === "undefined") return;
  if (!isValidHost(hostname)) return;
  const origin = `https://${hostname}`;
  try {
    const raw = window.localStorage.getItem(KEY);
    const current = raw ? (JSON.parse(raw) as unknown) : [];
    const list = Array.isArray(current) ? (current as unknown[]).filter((s) => typeof s === "string") as string[] : [];
    const without = list.filter((s) => s !== origin);
    without.unshift(origin);
    const trimmed = without.slice(0, MAX);
    window.localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    // best-effort
  }
}
