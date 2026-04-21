import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Event as NostrEvent, EventTemplate } from "nostr-tools/core";
import { useNostrQuery, publishSigned } from "./pool";
import { useIdentityStore, useRelayStore } from "./store";
import type { Identity } from "./identity";

export const DEFAULT_REACTION_EMOJIS = ["🤙", "🔥", "💯", "😂", "🫡", "❤️"];

export const EXTRA_REACTION_EMOJIS = [
  "👍",
  "👎",
  "🙏",
  "🤔",
  "👀",
  "🚀",
  "🎉",
  "😢",
  "😡",
  "🧠",
];

export type ReactionAggregate = {
  counts: Map<string, number>;
  myReactions: { id: string; emoji: string }[];
  total: number;
};

/**
 * Per-event aggregate cache so a remount of the same PostCard reuses the
 * computed aggregate instead of recomputing from scratch. Keyed by
 * `${eventId}|${myPubkey}` because "my reactions" depend on identity.
 */
const aggregateCache = new Map<string, ReactionAggregate>();

/**
 * Locally retracted reaction event ids (this session). Used as an
 * optimistic tombstone so the UI updates instantly on "unreact" without
 * waiting for the relay to round-trip the kind:5 deletion back to us.
 */
const localTombstones = new Set<string>();

const tombstoneListeners = new Set<() => void>();
let tombstoneRev = 0;

function notifyTombstones() {
  tombstoneRev += 1;
  for (const fn of tombstoneListeners) fn();
}

function subscribeTombstones(cb: () => void) {
  tombstoneListeners.add(cb);
  return () => tombstoneListeners.delete(cb);
}

function getTombstoneRev() {
  return tombstoneRev;
}

/**
 * Drop all session-local reaction state. Called on logout and Panic Wipe
 * so the next user doesn't inherit the previous identity's tombstones or
 * cached aggregates.
 */
export function resetReactionsState() {
  localTombstones.clear();
  aggregateCache.clear();
  notifyTombstones();
}

function emojiFromContent(content: string): string {
  const c = (content ?? "").trim();
  if (c === "" || c === "+") return "👍";
  if (c === "-") return "👎";
  return c;
}

export function useReactions(
  eventId: string | null | undefined,
  eventPubkey?: string | null,
): ReactionAggregate & { loading: boolean } {
  const { events, loading } = useNostrQuery(
    eventId ? { kinds: [7], "#e": [eventId], limit: 500 } : null,
    [eventId],
  );
  const me = useIdentityStore((s) => s.identity);

  // Subscribe to NIP-09 deletions targeting any of the reaction events we
  // just observed. Re-issue when the reaction id set changes. This is what
  // makes "tapping again retracts it" reflect across other clients too.
  const reactionIds = useMemo(() => events.map((e) => e.id), [events]);
  const reactionIdsKey = reactionIds.join(",");
  const { events: deletions } = useNostrQuery(
    reactionIds.length > 0 ? { kinds: [5], "#e": reactionIds, limit: 500 } : null,
    [reactionIdsKey],
  );

  // Hot-path read: if we already have an aggregate computed for this
  // (event, identity) pair, hand it back immediately on the first render
  // after a remount instead of waiting for the deletion subscription's
  // first dependency cycle to settle. The memo below still recomputes
  // when the underlying events/deletions arrays update.
  const cachedInitial = useMemo(() => {
    if (!eventId) return null;
    return aggregateCache.get(`${eventId}|${me?.pubkey ?? ""}`) ?? null;
  }, [eventId, me?.pubkey]);

  // Subscribe to local tombstone mutations so an optimistic retract
  // forces a recompute immediately, without waiting for the deletion
  // event to round-trip through the relay subscription.
  const tombstoneVersion = useSyncExternalStore(
    subscribeTombstones,
    getTombstoneRev,
    getTombstoneRev,
  );

  const computed = useMemo(() => {
    // Build the set of retracted reaction ids: a NIP-09 deletion only
    // counts when it's authored by the same pubkey that authored the
    // reaction (you can't delete someone else's event). Plus our own
    // optimistic tombstones for instant UI feedback.
    const reactionByAuthor = new Map<string, string>(); // reactionId -> author pubkey
    for (const r of events) reactionByAuthor.set(r.id, r.pubkey);

    const retracted = new Set<string>(localTombstones);
    for (const d of deletions) {
      for (const t of d.tags) {
        if (t[0] !== "e" || !t[1]) continue;
        const author = reactionByAuthor.get(t[1]);
        if (author && author === d.pubkey) {
          retracted.add(t[1]);
        }
      }
    }

    const counts = new Map<string, number>();
    const myReactions: { id: string; emoji: string }[] = [];
    // De-dup so a user spamming the same emoji on the same event from
    // multiple relays doesn't inflate counts. Keep the latest non-retracted
    // reaction per (pubkey, emoji).
    const lastByAuthorEmoji = new Map<string, { id: string; created_at: number }>();

    for (const r of events) {
      if (retracted.has(r.id)) continue;
      const emoji = emojiFromContent(r.content);
      const targetEvent = r.tags.find((t) => t[0] === "e")?.[1];
      if (eventId && targetEvent !== eventId) continue;
      // Optional sanity filter: ensure the reaction's `p` tag (when set)
      // matches the post author so we don't aggregate noise from
      // misrouted events.
      if (eventPubkey) {
        const pTag = r.tags.find((t) => t[0] === "p")?.[1];
        if (pTag && pTag !== eventPubkey) continue;
      }
      const key = `${r.pubkey}|${emoji}`;
      const existing = lastByAuthorEmoji.get(key);
      if (!existing || r.created_at > existing.created_at) {
        lastByAuthorEmoji.set(key, { id: r.id, created_at: r.created_at });
      }
    }

    for (const [key, ref] of lastByAuthorEmoji) {
      const [pubkey, emoji] = key.split("|");
      counts.set(emoji, (counts.get(emoji) ?? 0) + 1);
      if (me && pubkey === me.pubkey) {
        myReactions.push({ id: ref.id, emoji });
      }
    }

    const aggregate: ReactionAggregate = {
      counts,
      myReactions,
      total: lastByAuthorEmoji.size,
    };

    if (eventId) {
      const cacheKey = `${eventId}|${me?.pubkey ?? ""}`;
      aggregateCache.set(cacheKey, aggregate);
    }

    return aggregate;
  }, [events, deletions, me, eventId, eventPubkey, tombstoneVersion]);

  // While the live query is still loading and we have a cached aggregate
  // from a prior mount, surface the cached value so the bar doesn't flicker
  // back to "0" between PostCard remounts on feed scroll.
  if (loading && events.length === 0 && cachedInitial) {
    return { ...cachedInitial, loading };
  }
  return { ...computed, loading };
}

export async function publishReaction(
  identity: Identity,
  target: { id: string; pubkey: string; kind: number },
  emoji: string,
  relays: string[],
): Promise<NostrEvent> {
  const template: EventTemplate = {
    kind: 7,
    content: emoji,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["e", target.id],
      ["p", target.pubkey],
      ["k", String(target.kind)],
    ],
  };
  const signed = identity.signEvent(template);
  await publishSigned(signed, relays);
  return signed;
}

/**
 * Retract a reaction by publishing a NIP-09 deletion (kind:5) referencing
 * the user's own reaction event, and immediately add it to the local
 * tombstone set so the UI hides it before the deletion event makes the
 * round-trip back through the relay subscription.
 */
export async function retractReaction(
  identity: Identity,
  reactionEventId: string,
  relays: string[],
): Promise<NostrEvent> {
  // Optimistic tombstone first.
  localTombstones.add(reactionEventId);
  notifyTombstones();
  try {
    const template: EventTemplate = {
      kind: 5,
      content: "retracted",
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["e", reactionEventId],
        ["k", "7"],
      ],
    };
    const signed = identity.signEvent(template);
    await publishSigned(signed, relays);
    return signed;
  } catch (err) {
    // Roll the optimistic tombstone back so the UI doesn't lie.
    localTombstones.delete(reactionEventId);
    notifyTombstones();
    throw err;
  }
}

export function useReactionPublisher() {
  const identity = useIdentityStore((s) => s.identity);
  const relays = useRelayStore((s) => s.relays);
  const [busy, setBusy] = useState(false);

  const react = async (
    target: { id: string; pubkey: string; kind: number },
    emoji: string,
  ): Promise<NostrEvent | null> => {
    if (!identity) return null;
    setBusy(true);
    try {
      return await publishReaction(identity, target, emoji, relays);
    } finally {
      setBusy(false);
    }
  };

  const retract = async (reactionEventId: string): Promise<NostrEvent | null> => {
    if (!identity) return null;
    setBusy(true);
    try {
      return await retractReaction(identity, reactionEventId, relays);
    } finally {
      setBusy(false);
    }
  };

  return { react, retract, busy, canReact: !!identity };
}
