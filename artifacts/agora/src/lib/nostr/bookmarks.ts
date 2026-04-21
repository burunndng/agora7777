import { useCallback, useEffect, useState } from "react";
import type { Event as NostrEvent } from "nostr-tools/core";
import { useIdentityStore } from "./store";
import type { BookmarkRecord } from "./cache";

type Listener = () => void;
const listeners = new Set<Listener>();

function emit() {
  for (const l of Array.from(listeners)) {
    try {
      l();
    } catch {
      /* ignore */
    }
  }
}

/**
 * In-memory mirror of the encrypted bookmark id set, scoped to the
 * currently logged-in npub. Reset on logout/login by `useBookmarkIds`.
 */
let cachedIds: Set<string> | null = null;

async function loadIds(cache: ReturnType<typeof useIdentityStore.getState>["cache"]) {
  if (!cache) {
    cachedIds = new Set();
    return;
  }
  try {
    cachedIds = await cache.listBookmarkIds();
  } catch {
    cachedIds = new Set();
  }
  emit();
}

export function useBookmarkIds(): Set<string> {
  const cache = useIdentityStore((s) => s.cache);
  const npub = useIdentityStore((s) => s.identity?.npub ?? null);
  const [, setVersion] = useState(0);

  useEffect(() => {
    cachedIds = new Set();
    if (cache) {
      void loadIds(cache);
    }
    const l: Listener = () => setVersion((v) => v + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, [cache, npub]);

  return cachedIds ?? new Set();
}

export function useBookmarkActions(): {
  isBookmarked: (id: string) => boolean;
  add: (event: NostrEvent) => Promise<void>;
  remove: (id: string) => Promise<void>;
  toggle: (event: NostrEvent) => Promise<boolean>;
  canBookmark: boolean;
} {
  const cache = useIdentityStore((s) => s.cache);
  const ids = useBookmarkIds();

  const isBookmarked = useCallback((id: string) => ids.has(id), [ids]);

  const add = useCallback(
    async (event: NostrEvent) => {
      if (!cache) return;
      await cache.addBookmark(event.id, event);
      cachedIds = new Set(cachedIds ?? []);
      cachedIds.add(event.id);
      emit();
    },
    [cache],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!cache) return;
      await cache.removeBookmark(id);
      if (cachedIds) {
        cachedIds.delete(id);
        cachedIds = new Set(cachedIds);
      }
      emit();
    },
    [cache],
  );

  const toggle = useCallback(
    async (event: NostrEvent) => {
      if (!cache) return false;
      if (cachedIds?.has(event.id)) {
        await remove(event.id);
        return false;
      }
      await add(event);
      return true;
    },
    [cache, add, remove],
  );

  return {
    isBookmarked,
    add,
    remove,
    toggle,
    canBookmark: !!cache,
  };
}

export function useBookmarkList(): {
  records: BookmarkRecord[];
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const cache = useIdentityStore((s) => s.cache);
  const npub = useIdentityStore((s) => s.identity?.npub ?? null);
  const [records, setRecords] = useState<BookmarkRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!cache) {
      setRecords([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await cache.listBookmarks();
      setRecords(list);
    } finally {
      setLoading(false);
    }
  }, [cache]);

  useEffect(() => {
    void refresh();
    const l: Listener = () => {
      void refresh();
    };
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, [refresh, npub]);

  return { records, loading, refresh };
}
