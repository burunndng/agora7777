/**
 * Subscribe to a user's Resonance Map (kind 30015 / d="agora-resonance-v1").
 * Falls back to `null` when the user has not published one. Cached in a
 * module-level Map keyed by pubkey so navigating between profiles doesn't
 * re-fetch the same map.
 */

import { useEffect, useState } from "react";
import type { Event as NostrEvent } from "nostr-tools/core";
import { useNostrPool, publishSigned } from "@/lib/nostr/pool";
import { useIdentityStore, useRelayStore } from "@/lib/nostr/store";
import type { Identity } from "@/lib/nostr/identity";
import {
  RESONANCE_DTAG,
  RESONANCE_EVENT_KIND,
  buildResonanceEventTags,
  parseResonanceEvent,
  type ResonanceMap,
  type ResonanceSelection,
} from "./event";

const cache = new Map<string, ResonanceMap | null>();
const listeners = new Set<(pubkey: string) => void>();

function notifyMapChanged(pubkey: string) {
  for (const fn of listeners) {
    try {
      fn(pubkey);
    } catch {
      /* ignore */
    }
  }
}

export function useResonanceMap(pubkey: string | null | undefined): {
  map: ResonanceMap | null;
  loading: boolean;
} {
  const { pool, relays } = useNostrPool();
  const [map, setMap] = useState<ResonanceMap | null>(
    pubkey ? cache.get(pubkey) ?? null : null,
  );
  const [loading, setLoading] = useState<boolean>(
    !!pubkey && !cache.has(pubkey),
  );

  // Subscribe to in-process publishes so an editor save updates the view
  // immediately, before the relay round-trip resolves.
  useEffect(() => {
    if (!pubkey) return;
    const fn = (changed: string) => {
      if (changed === pubkey) setMap(cache.get(pubkey) ?? null);
    };
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, [pubkey]);

  useEffect(() => {
    if (!pubkey) {
      setMap(null);
      setLoading(false);
      return;
    }
    if (cache.has(pubkey)) {
      setMap(cache.get(pubkey) ?? null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    let latest: NostrEvent | null = null;
    const sub = pool.subscribeMany(
      relays,
      {
        kinds: [RESONANCE_EVENT_KIND],
        authors: [pubkey],
        "#d": [RESONANCE_DTAG],
        limit: 1,
      },
      {
        onevent: (event) => {
          if (!latest || event.created_at > latest.created_at) latest = event;
        },
        oneose: () => {
          if (cancelled) return;
          const parsed = latest ? parseResonanceEvent(latest) : null;
          cache.set(pubkey, parsed);
          setMap(parsed);
          setLoading(false);
          sub.close();
        },
      },
    );
    return () => {
      cancelled = true;
      sub.close();
    };
  }, [pubkey, pool, relays]);

  return { map, loading };
}

export async function publishResonanceMap(
  identity: Identity,
  selections: ResonanceSelection[],
): Promise<ResonanceMap> {
  const relays = useRelayStore.getState().relays;
  const tags = buildResonanceEventTags(selections);
  const event = identity.signEvent({
    kind: RESONANCE_EVENT_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: "",
  });
  const parsed = parseResonanceEvent(event);
  const map: ResonanceMap = parsed ?? {
    pubkey: identity.pubkey,
    selections: [],
    updatedAt: event.created_at,
  };
  cache.set(identity.pubkey, map);
  notifyMapChanged(identity.pubkey);
  await publishSigned(event, relays);
  return map;
}

/** Wipe the cache when the active identity changes (login/logout/switch). */
let _prevIdentityPubkey: string | null =
  useIdentityStore.getState().identity?.pubkey ?? null;
useIdentityStore.subscribe((s) => {
  const cur = s.identity?.pubkey ?? null;
  if (cur !== _prevIdentityPubkey) {
    cache.clear();
    _prevIdentityPubkey = cur;
  }
});
