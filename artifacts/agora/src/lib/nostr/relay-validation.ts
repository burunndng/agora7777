/**
 * Strict validator for relay URLs that get persisted to localStorage.
 *
 * Why: a future XSS, a tampered persisted store, or a deep link could call
 * addRelay() with an attacker-controlled URL and turn the active session
 * into a permanent MITM that survives reload. We reject anything that
 * isn't a public-internet `wss://` host.
 */

const LOOPBACK_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
  "ip6-localhost",
  "ip6-loopback",
]);

function isIpv4Private(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const o = m.slice(1, 5).map(Number);
  if (o.some((n) => n < 0 || n > 255)) return true; // malformed → reject
  if (o[0] === 10) return true;
  if (o[0] === 127) return true;
  if (o[0] === 0) return true;
  if (o[0] === 169 && o[1] === 254) return true; // link-local
  if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true;
  if (o[0] === 192 && o[1] === 168) return true;
  return false;
}

function isIpv6Private(host: string): boolean {
  // Strip brackets if URL host form e.g. "[fe80::1]"
  const inner = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  const lower = inner.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) {
    return true;
  }
  return false;
}

export function isValidRelayUrl(input: unknown): input is string {
  if (typeof input !== "string") return false;
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > 512) return false;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  if (parsed.protocol !== "wss:") return false;
  if (parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase();
  if (!host) return false;
  if (host.length > 253) return false;
  if (LOOPBACK_HOSTS.has(host)) return false;
  if (isIpv4Private(host)) return false;
  if (host.includes(":") || host.startsWith("[")) {
    if (isIpv6Private(host)) return false;
  }
  // Require a DNS-like host (must contain a dot) unless it's a public IPv4.
  if (!host.includes(".")) return false;
  return true;
}

/** Lower-case the host but keep path/query as-is. Used for dedup. */
export function normalizeRelayUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    u.hostname = u.hostname.toLowerCase();
    // Strip trailing slash on bare host so wss://relay.example/ === wss://relay.example
    let s = u.toString();
    if (s.endsWith("/") && u.pathname === "/") s = s.slice(0, -1);
    return s;
  } catch {
    return url.trim();
  }
}
