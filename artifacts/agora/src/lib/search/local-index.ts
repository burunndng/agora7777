import type { Event as NostrEvent } from "nostr-tools/core";
import type { EncryptedEventCache } from "@/lib/nostr/cache";

/**
 * Build a lightweight in-memory inverted index over the locally cached events.
 * This is intentionally simple: we tokenize on word characters, lowercase,
 * and dedupe. Good enough to match content the user has already seen offline.
 */
export interface LocalIndex {
  byToken: Map<string, Set<string>>;
  byId: Map<string, NostrEvent>;
}

export interface LocalSearchHit {
  event: NostrEvent;
  /** Number of distinct query tokens that matched. Higher = better. */
  matched: number;
}

const STOP_TOKENS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "for",
  "is", "it", "this", "that", "with", "as", "by", "be", "are", "was", "from",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2 && !STOP_TOKENS.has(t));
}

function indexEvent(index: LocalIndex, event: NostrEvent) {
  if (index.byId.has(event.id)) return;
  index.byId.set(event.id, event);
  // Index over content + searchable tags (subject/title/d/name).
  let text = event.content || "";
  for (const tag of event.tags) {
    if (tag[0] === "subject" || tag[0] === "title" || tag[0] === "d" || tag[0] === "name" || tag[0] === "t") {
      if (typeof tag[1] === "string") text += " " + tag[1];
    }
  }
  for (const token of new Set(tokenize(text))) {
    let bucket = index.byToken.get(token);
    if (!bucket) {
      bucket = new Set();
      index.byToken.set(token, bucket);
    }
    bucket.add(event.id);
  }
}

export function emptyLocalIndex(): LocalIndex {
  return { byToken: new Map(), byId: new Map() };
}

/**
 * Build (or rebuild) an index from the encrypted cache. Reads kinds 0/1/11.
 */
export async function buildLocalIndex(cache: EncryptedEventCache): Promise<LocalIndex> {
  const index = emptyLocalIndex();
  const kinds = [0, 1, 11];
  for (const k of kinds) {
    const events = await cache.getEventsByKind(k, { limit: 5000 });
    for (const event of events) indexEvent(index, event);
  }
  return index;
}

export function searchLocalIndex(
  index: LocalIndex,
  query: string,
  opts: { kind?: 0 | 1 | 11 | "post" | "profile"; limit?: number } = {},
): LocalSearchHit[] {
  const tokens = tokenize(query);
  if (tokens.length === 0 || index.byId.size === 0) return [];
  const counts = new Map<string, number>();
  for (const token of tokens) {
    // Prefix match across the inverted index for short queries.
    const exact = index.byToken.get(token);
    if (exact) {
      for (const id of exact) counts.set(id, (counts.get(id) ?? 0) + 1);
      continue;
    }
    if (token.length >= 3) {
      for (const [indexedToken, ids] of index.byToken) {
        if (indexedToken.startsWith(token)) {
          for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
        }
      }
    }
  }
  const wantKinds = opts.kind === "profile" ? [0]
    : opts.kind === "post" ? [1, 11]
    : typeof opts.kind === "number" ? [opts.kind]
    : null;
  const hits: LocalSearchHit[] = [];
  for (const [id, matched] of counts) {
    const event = index.byId.get(id);
    if (!event) continue;
    if (wantKinds && !wantKinds.includes(event.kind)) continue;
    hits.push({ event, matched });
  }
  hits.sort((a, b) => b.matched - a.matched || b.event.created_at - a.event.created_at);
  return hits.slice(0, opts.limit ?? 100);
}
