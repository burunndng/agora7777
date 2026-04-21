import type { Event as NostrEvent } from "nostr-tools/core";

const NOSTR_BAND_BASE = "https://nostr.band";

export type SearchKindFilter = "posts" | "profiles";

export interface RemoteSearchResult {
  events: NostrEvent[];
  /** Total number of results reported by nostr.band, when known. */
  total: number | null;
  /** True when the request hit the network (not a noop empty query). */
  fromNetwork: boolean;
}

function isNostrEvent(value: unknown): value is NostrEvent {
  if (!value || typeof value !== "object") return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    typeof e.pubkey === "string" &&
    typeof e.kind === "number" &&
    typeof e.created_at === "number" &&
    typeof e.content === "string" &&
    Array.isArray(e.tags) &&
    typeof e.sig === "string"
  );
}

/**
 * Wraps the public nostr.band search endpoint. We use the `q` shorthand which
 * supports kind: filters, e.g. `kind:1 nostr` or `kind:0 alice`.
 *
 * Pagination uses an offset cursor (server caps a single page at 50).
 *
 * @returns parsed events plus the (best-effort) total count from the server.
 */
export async function searchNostrBand(opts: {
  query: string;
  filter: SearchKindFilter;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}): Promise<RemoteSearchResult> {
  const q = opts.query.trim();
  if (!q) {
    return { events: [], total: 0, fromNetwork: false };
  }

  const kind = opts.filter === "profiles" ? 0 : 1;
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const offset = Math.max(opts.offset ?? 0, 0);

  // nostr.band exposes a JSON API at /search?q=...&format=json
  const url = new URL("/search", NOSTR_BAND_BASE);
  url.searchParams.set("q", `kind:${kind} ${q}`);
  url.searchParams.set("format", "json");
  url.searchParams.set("count", String(limit));
  if (offset) url.searchParams.set("offset", String(offset));

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      signal: opts.signal,
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    throw new Error(
      `nostr.band search failed (network): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!res.ok) {
    throw new Error(`nostr.band search failed (HTTP ${res.status})`);
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch (err) {
    throw new Error(
      `nostr.band returned non-JSON response: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const events = extractEvents(payload);
  const total = extractTotal(payload);
  return { events, total, fromNetwork: true };
}

function extractEvents(payload: unknown): NostrEvent[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  // Common shapes the public endpoint has returned over time: { events: [...] }
  // (preferred), { results: [...] }, or a bare array.
  const candidates: unknown[] = [];
  if (Array.isArray(root.events)) candidates.push(...root.events);
  else if (Array.isArray(root.results)) candidates.push(...root.results);
  else if (Array.isArray(payload)) candidates.push(...(payload as unknown[]));
  return candidates.filter(isNostrEvent);
}

function extractTotal(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  if (typeof root.total === "number") return root.total;
  if (typeof root.count === "number") return root.count;
  return null;
}
