import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Identity } from "./identity";
import { EncryptedEventCache, destroyCache } from "./cache";
import { isValidRelayUrl, normalizeRelayUrl } from "./relay-validation";
import { resetReactionsState } from "./reactions";

export const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
];

const FIRST_SEEN_KEY = "agora.identity.firstSeen.v1";

function loadFirstSeenMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(FIRST_SEEN_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function recordFirstSeen(npub: string): number {
  const map = loadFirstSeenMap();
  if (!map[npub]) {
    map[npub] = Math.floor(Date.now() / 1000);
    try {
      localStorage.setItem(FIRST_SEEN_KEY, JSON.stringify(map));
    } catch {
      /* ignore quota errors */
    }
  }
  return map[npub];
}

export function getFirstSeen(npub: string | null | undefined): number | null {
  if (!npub) return null;
  const map = loadFirstSeenMap();
  return map[npub] ?? null;
}

interface IdentityState {
  identity: Identity | null;
  cache: EncryptedEventCache | null;
  firstSeen: number | null;
  setIdentity: (identity: Identity | null) => void;
  logout: () => void;
}

async function tearDownActiveSession(prev: {
  identity: Identity | null;
  cache: EncryptedEventCache | null;
}) {
  try {
    prev.identity?.destroy();
  } catch {
    /* ignore */
  }
  try {
    prev.cache?.destroy();
  } catch {
    /* ignore */
  }
  try {
    await destroyCache();
  } catch {
    /* ignore */
  }
  try {
    resetReactionsState();
  } catch {
    /* ignore */
  }
}

export const useIdentityStore = create<IdentityState>((set, get) => ({
  identity: null,
  cache: null,
  firstSeen: null,
  setIdentity: (identity) => {
    const prev = { identity: get().identity, cache: get().cache };
    if (identity) {
      const firstSeen = recordFirstSeen(identity.npub);
      set({
        identity,
        cache: new EncryptedEventCache(identity.cacheKey),
        firstSeen,
      });
      // Drop any orphaned previous cache+key material asynchronously so we
      // don't keep an imported CryptoKey reachable across logins.
      if (prev.identity && prev.identity !== identity) {
        void tearDownActiveSession(prev);
      }
    } else {
      set({ identity: null, cache: null, firstSeen: null });
      void tearDownActiveSession(prev);
    }
  },
  logout: () => {
    const prev = { identity: get().identity, cache: get().cache };
    set({ identity: null, cache: null, firstSeen: null });
    void tearDownActiveSession(prev);
  },
}));

interface RelayState {
  relays: string[];
  setRelays: (relays: string[]) => void;
  addRelay: (url: string) => void;
  removeRelay: (url: string) => void;
}

function dedupeAndValidate(input: unknown): string[] {
  if (!Array.isArray(input)) return [...DEFAULT_RELAYS];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (!isValidRelayUrl(raw)) continue;
    const norm = normalizeRelayUrl(raw);
    const key = norm.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(norm);
  }
  return out.length > 0 ? out : [...DEFAULT_RELAYS];
}

export const useRelayStore = create<RelayState>()(
  persist(
    (set, get) => ({
      relays: DEFAULT_RELAYS,
      setRelays: (relays) => set({ relays: dedupeAndValidate(relays) }),
      addRelay: (url) => {
        if (!isValidRelayUrl(url)) return;
        const norm = normalizeRelayUrl(url);
        const existing = get().relays.map((r) => r.toLowerCase());
        if (existing.includes(norm.toLowerCase())) return;
        set({ relays: [...get().relays, norm] });
      },
      removeRelay: (url) => {
        const target = url.toLowerCase();
        set({
          relays: get().relays.filter((r) => r.toLowerCase() !== target),
        });
      },
    }),
    {
      name: "agora.relays.v1",
      // Re-validate on rehydration so a tampered localStorage payload can't
      // inject a malicious relay (e.g. wss://attacker/ or wss://localhost/).
      migrate: (persisted) => {
        if (
          persisted &&
          typeof persisted === "object" &&
          "relays" in persisted
        ) {
          const p = persisted as { relays: unknown };
          return { relays: dedupeAndValidate(p.relays) } as RelayState;
        }
        return { relays: [...DEFAULT_RELAYS] } as RelayState;
      },
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.relays = dedupeAndValidate(state.relays);
        }
      },
    },
  ),
);
