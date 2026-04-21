import { useEffect, useMemo, useRef, useState } from "react";
import type { Event as NostrEvent } from "nostr-tools/core";
import { useIdentityStore } from "@/lib/nostr/store";
import {
  buildLocalIndex,
  emptyLocalIndex,
  searchLocalIndex,
  type LocalIndex,
} from "./local-index";
import { searchNostrBand, type SearchKindFilter } from "./nostr-band";

export type SearchSource = "local" | "nostr.band";

export interface SearchHit {
  event: NostrEvent;
  sources: SearchSource[];
}

export interface SearchState {
  hits: SearchHit[];
  loadingRemote: boolean;
  remoteError: string | null;
  localCount: number;
  remoteCount: number;
}

/**
 * Local cache index is built once per identity. Subsequent searches reuse it.
 * Rebuild when the active identity (and therefore cache) changes.
 */
export function useLocalSearchIndex(): LocalIndex {
  const cache = useIdentityStore((s) => s.cache);
  const [index, setIndex] = useState<LocalIndex>(() => emptyLocalIndex());

  useEffect(() => {
    let cancelled = false;
    if (!cache) {
      setIndex(emptyLocalIndex());
      return;
    }
    buildLocalIndex(cache)
      .then((next) => {
        if (!cancelled) setIndex(next);
      })
      .catch(() => {
        if (!cancelled) setIndex(emptyLocalIndex());
      });
    return () => {
      cancelled = true;
    };
  }, [cache]);

  return index;
}

export function useSearch(
  query: string,
  filter: SearchKindFilter,
  options: { debounceMs?: number } = {},
): SearchState {
  const debounceMs = options.debounceMs ?? 250;
  const localIndex = useLocalSearchIndex();
  const [debounced, setDebounced] = useState(query);
  const [remote, setRemote] = useState<NostrEvent[]>([]);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const reqRef = useRef(0);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(query), debounceMs);
    return () => window.clearTimeout(handle);
  }, [query, debounceMs]);

  useEffect(() => {
    const id = ++reqRef.current;
    setRemoteError(null);
    if (!debounced.trim()) {
      setRemote([]);
      setLoadingRemote(false);
      return;
    }
    setLoadingRemote(true);
    const controller = new AbortController();
    searchNostrBand({ query: debounced, filter, signal: controller.signal })
      .then((res) => {
        if (id !== reqRef.current) return;
        setRemote(res.events);
        setLoadingRemote(false);
      })
      .catch((err) => {
        if (id !== reqRef.current) return;
        if (controller.signal.aborted) return;
        setRemote([]);
        setRemoteError(err instanceof Error ? err.message : String(err));
        setLoadingRemote(false);
      });
    return () => controller.abort();
  }, [debounced, filter]);

  const local = useMemo(
    () =>
      searchLocalIndex(localIndex, debounced, {
        kind: filter === "profiles" ? "profile" : "post",
        limit: 100,
      }),
    [localIndex, debounced, filter],
  );

  const merged = useMemo<SearchHit[]>(() => {
    const map = new Map<string, SearchHit>();
    for (const h of local) {
      map.set(h.event.id, { event: h.event, sources: ["local"] });
    }
    for (const event of remote) {
      const existing = map.get(event.id);
      if (existing) {
        if (!existing.sources.includes("nostr.band")) existing.sources.push("nostr.band");
      } else {
        map.set(event.id, { event, sources: ["nostr.band"] });
      }
    }
    return Array.from(map.values()).sort(
      (a, b) => b.event.created_at - a.event.created_at,
    );
  }, [local, remote]);

  return {
    hits: merged,
    loadingRemote,
    remoteError,
    localCount: local.length,
    remoteCount: remote.length,
  };
}
