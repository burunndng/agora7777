import { useEffect, useMemo, useRef, useState } from "react";
import { SimplePool } from "nostr-tools/pool";
import type { Event as NostrEvent, EventTemplate } from "nostr-tools/core";
import type { Filter } from "nostr-tools/filter";
import { useRelayStore } from "./store";
import { useIdentityStore } from "./store";

let sharedPool: SimplePool | null = null;
function getPool(): SimplePool {
  if (!sharedPool) {
    sharedPool = new SimplePool({ enableReconnect: true, enablePing: true });
  }
  return sharedPool;
}

export function useNostrPool() {
  const relays = useRelayStore((s) => s.relays);
  const pool = useMemo(() => getPool(), []);
  const [connectionStatus, setConnectionStatus] = useState<Map<string, boolean>>(
    new Map(),
  );

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      if (cancelled) return;
      const status = new Map<string, boolean>();
      for (const url of relays) {
        status.set(url, pool.listConnectionStatus().get(url) ?? false);
      }
      setConnectionStatus(status);
    };
    // eagerly connect
    for (const url of relays) {
      pool.ensureRelay(url, { connectionTimeout: 6000 }).catch(() => {});
    }
    const interval = window.setInterval(refresh, 2000);
    refresh();
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [pool, relays]);

  return { pool, relays, connectionStatus };
}

export function useNostrQuery(filter: Filter | null, deps: unknown[] = []) {
  const { pool, relays } = useNostrPool();
  const cache = useIdentityStore((s) => s.cache);
  const [events, setEvents] = useState<NostrEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!filter) {
      setEvents([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    seenRef.current = new Set();

    // Hydrate from cache for the kinds requested if possible.
    (async () => {
      if (!cache || !filter.kinds?.length) return;
      try {
        const cached: NostrEvent[] = [];
        for (const k of filter.kinds) {
          const list = await cache.getEventsByKind(k, { limit: filter.limit ?? 200 });
          cached.push(...list);
        }
        const matched = cached.filter((e) => matchesFilter(e, filter));
        if (cancelled) return;
        matched.forEach((e) => seenRef.current.add(e.id));
        setEvents((prev) => mergeEvents(prev, matched));
      } catch {
        /* ignore */
      }
    })();

    const sub = pool.subscribeMany(relays, filter, {
      onevent: (event) => {
        if (cancelled) return;
        if (seenRef.current.has(event.id)) return;
        seenRef.current.add(event.id);
        setEvents((prev) => mergeEvents(prev, [event]));
        cache?.putEvent(event).catch(() => {});
      },
      oneose: () => {
        if (!cancelled) setLoading(false);
      },
    });

    return () => {
      cancelled = true;
      sub.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { events, loading };
}

function matchesFilter(event: NostrEvent, filter: Filter): boolean {
  if (filter.ids && !filter.ids.includes(event.id)) return false;
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
  if (typeof filter.since === "number" && event.created_at < filter.since) return false;
  if (typeof filter.until === "number" && event.created_at > filter.until) return false;
  // Tag filters: keys like "#e", "#p", "#t", "#a", "#d", ...
  for (const key of Object.keys(filter)) {
    if (!key.startsWith("#") || key.length !== 2) continue;
    const tagName = key.slice(1);
    const wanted = (filter as unknown as Record<string, string[]>)[key];
    if (!Array.isArray(wanted) || wanted.length === 0) continue;
    const values = event.tags
      .filter((t) => t[0] === tagName)
      .map((t) => t[1])
      .filter((v): v is string => typeof v === "string");
    if (!wanted.some((w) => values.includes(w))) return false;
  }
  return true;
}

export function mergeEvents(a: NostrEvent[], b: NostrEvent[]): NostrEvent[] {
  const map = new Map<string, NostrEvent>();
  for (const e of a) map.set(e.id, e);
  for (const e of b) map.set(e.id, e);
  return Array.from(map.values()).sort((x, y) => y.created_at - x.created_at);
}

export async function publishSigned(event: NostrEvent, relays: string[]) {
  const pool = getPool();
  const promises = pool.publish(relays, event);
  return Promise.allSettled(promises);
}

export type { EventTemplate };
