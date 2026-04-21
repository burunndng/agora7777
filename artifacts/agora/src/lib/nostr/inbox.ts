import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import type { Event as NostrEvent } from "nostr-tools/core";
import { SimplePool } from "nostr-tools/pool";
import { useRelayStore, useIdentityStore } from "./store";
import type { EncryptedEventCache } from "./cache";

const INBOX_KIND_FILTER = [1, 11];
const INBOX_LIMIT = 200;
const LAST_SEEN_KV_KEY_PREFIX = "inbox.lastSeenAt.v1:";

function lastSeenKey(myPubkey: string): string {
  return `${LAST_SEEN_KV_KEY_PREFIX}${myPubkey}`;
}

type InboxStore = {
  myPubkey: string | null;
  events: NostrEvent[];
  lastSeenAt: number; // unix seconds; 0 means "never"
  loading: boolean;
  _seenIds: Set<string>;
  reset: (myPubkey: string | null) => void;
  ingest: (event: NostrEvent) => void;
  setLoading: (loading: boolean) => void;
  setLastSeenAt: (ts: number) => void;
};

export const useInboxStore = create<InboxStore>((set) => ({
  myPubkey: null,
  events: [],
  lastSeenAt: 0,
  loading: false,
  _seenIds: new Set(),
  reset: (myPubkey) =>
    set({
      myPubkey,
      events: [],
      lastSeenAt: 0,
      loading: !!myPubkey,
      _seenIds: new Set(),
    }),
  ingest: (event) =>
    set((state) => {
      if (!state.myPubkey) return state;
      if (event.pubkey === state.myPubkey) return state;
      if (state._seenIds.has(event.id)) return state;
      const seen = new Set(state._seenIds);
      seen.add(event.id);
      const next = [event, ...state.events]
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, INBOX_LIMIT);
      return { ...state, events: next, _seenIds: seen };
    }),
  setLoading: (loading) => set({ loading }),
  setLastSeenAt: (ts) => set({ lastSeenAt: ts }),
}));

let activePool: SimplePool | null = null;
let activeSub: { close: () => void } | null = null;
let ownedSub: { close: () => void } | null = null;
let repliesSub: { close: () => void } | null = null;
let activeKey: string | null = null;
let cacheRef: EncryptedEventCache | null = null;
let myEventIds: Set<string> = new Set();
let activeRelays: string[] = [];
let repliesReopenTimer: ReturnType<typeof setTimeout> | null = null;

function closeSafely(sub: { close: () => void } | null) {
  if (!sub) return;
  try {
    sub.close();
  } catch {
    /* ignore */
  }
}

function teardownSubscription() {
  closeSafely(activeSub);
  closeSafely(ownedSub);
  closeSafely(repliesSub);
  activeSub = null;
  ownedSub = null;
  repliesSub = null;
  if (repliesReopenTimer) {
    clearTimeout(repliesReopenTimer);
    repliesReopenTimer = null;
  }
  myEventIds = new Set();
  activeRelays = [];
  activeKey = null;
}

function reopenRepliesSub() {
  if (!activePool || activeRelays.length === 0) return;
  if (myEventIds.size === 0) return;
  closeSafely(repliesSub);
  repliesSub = activePool.subscribeMany(
    activeRelays,
    {
      kinds: INBOX_KIND_FILTER,
      "#e": Array.from(myEventIds),
      limit: INBOX_LIMIT,
    },
    {
      onevent: (event) => useInboxStore.getState().ingest(event),
    },
  );
}

function scheduleRepliesReopen() {
  if (repliesReopenTimer) return;
  repliesReopenTimer = setTimeout(() => {
    repliesReopenTimer = null;
    reopenRepliesSub();
  }, 1000);
}

async function startSubscription(
  myPubkey: string,
  relays: string[],
  cache: EncryptedEventCache | null,
) {
  if (!activePool) {
    activePool = new SimplePool({ enableReconnect: true, enablePing: true });
  }
  cacheRef = cache;

  // Hydrate persisted last-seen before opening the relay sub so we don't
  // momentarily flash a wrong unread count.
  if (cache) {
    try {
      const persisted = await cache.kvGet<number>(lastSeenKey(myPubkey));
      if (typeof persisted === "number") {
        useInboxStore.getState().setLastSeenAt(persisted);
      }
    } catch {
      /* ignore */
    }
  }

  activeRelays = relays;

  // Mentions and replies that p-tag the user.
  activeSub = activePool.subscribeMany(
    relays,
    {
      kinds: INBOX_KIND_FILTER,
      "#p": [myPubkey],
      limit: INBOX_LIMIT,
    },
    {
      onevent: (event) => useInboxStore.getState().ingest(event),
      oneose: () => useInboxStore.getState().setLoading(false),
    },
  );

  // Discover the user's authored events so we can also catch replies that
  // only e-tag (not p-tag) the parent — covers clients that don't strictly
  // follow NIP-10's "include parent author pubkey" guidance.
  ownedSub = activePool.subscribeMany(
    relays,
    {
      kinds: INBOX_KIND_FILTER,
      authors: [myPubkey],
      limit: INBOX_LIMIT,
    },
    {
      onevent: (event) => {
        if (myEventIds.has(event.id)) return;
        myEventIds.add(event.id);
        scheduleRepliesReopen();
      },
    },
  );
}

/**
 * Side-effect hook mounted once at the top of the React tree (Layout).
 * Owns the single shared subscription and binds it to the active identity.
 */
export function useInboxSyncEffect() {
  const identity = useIdentityStore((s) => s.identity);
  const cache = useIdentityStore((s) => s.cache);
  const relays = useRelayStore((s) => s.relays);
  const reset = useInboxStore((s) => s.reset);
  const myPubkey = identity?.pubkey ?? null;
  const relaysKey = relays.join(",");

  useEffect(() => {
    teardownSubscription();
    reset(myPubkey);
    if (!myPubkey) {
      cacheRef = null;
      return () => {
        /* nothing to tear down */
      };
    }
    const key = `${myPubkey}|${relaysKey}`;
    activeKey = key;
    void startSubscription(myPubkey, relays, cache);
    return () => {
      if (activeKey === key) teardownSubscription();
    };
  }, [myPubkey, relaysKey, cache, reset]);
}

/**
 * Read-only consumer hook for the layout badge. Pulls from the shared
 * store so all consumers see the same unread count after `markAllRead`.
 */
export function useInboxUnreadCount(): number {
  const events = useInboxStore((s) => s.events);
  const lastSeenAt = useInboxStore((s) => s.lastSeenAt);
  const myPubkey = useInboxStore((s) => s.myPubkey);
  return useMemo(() => {
    if (!myPubkey) return 0;
    return events.filter((e) => e.created_at > lastSeenAt).length;
  }, [events, lastSeenAt, myPubkey]);
}

export function useInbox(): {
  events: NostrEvent[];
  lastSeenAt: number;
  loading: boolean;
  unreadCount: number;
  markAllRead: () => Promise<void>;
} {
  const events = useInboxStore((s) => s.events);
  const lastSeenAt = useInboxStore((s) => s.lastSeenAt);
  const loading = useInboxStore((s) => s.loading);
  const myPubkey = useInboxStore((s) => s.myPubkey);
  const setLastSeenAt = useInboxStore((s) => s.setLastSeenAt);

  const unreadCount = useMemo(() => {
    if (!myPubkey) return 0;
    return events.filter((e) => e.created_at > lastSeenAt).length;
  }, [events, lastSeenAt, myPubkey]);

  const markAllRead = async () => {
    const newest =
      events.length > 0 ? events[0].created_at : Math.floor(Date.now() / 1000);
    setLastSeenAt(newest);
    if (cacheRef && myPubkey) {
      try {
        await cacheRef.kvSet(lastSeenKey(myPubkey), newest);
      } catch {
        /* ignore */
      }
    }
  };

  return { events, lastSeenAt, loading, unreadCount, markAllRead };
}

/** Force tear-down used by tests / Panic Wipe paths. */
export function _tearDownInboxForTesting() {
  teardownSubscription();
  useInboxStore.getState().reset(null);
  cacheRef = null;
}

/**
 * Determine the parent post id for a reply / mention event. Used by the
 * inbox UI to deep-link back into the source thread.
 */
export function inboxThreadAnchor(event: NostrEvent): string | null {
  const eTags = event.tags.filter((t) => t[0] === "e");
  if (eTags.length === 0) return event.id; // mention with no thread → link to itself
  const reply = eTags.find((t) => t[3] === "reply");
  if (reply) return reply[1] ?? null;
  const root = eTags.find((t) => t[3] === "root");
  if (root) return root[1] ?? null;
  return eTags[eTags.length - 1][1] ?? null;
}

export function inboxKind(event: NostrEvent): "reply" | "mention" {
  return event.tags.some((t) => t[0] === "e") ? "reply" : "mention";
}
