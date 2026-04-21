import { useEffect, useMemo, useState } from "react";
import type { Event as NostrEvent } from "nostr-tools/core";
import { useNostrQuery, publishSigned } from "./pool";
import type { Identity } from "./identity";

// Nearby presence is a NIP-78 (kind:30078) replaceable event with d-tag
// NEARBY_D_TAG. We round coordinates to NEARBY_GRID_DEG before signing so
// only a coarse cell is ever published.
export const NEARBY_KIND = 30078;
export const NEARBY_D_TAG = "agora.nearby.v1";

// 0.1° ≈ 11 km cells; radius ≈ 110 km; hard cap on entries.
export const NEARBY_GRID_DEG = 0.1;
export const NEARBY_RESULT_CAP = 60;
export const NEARBY_RADIUS_DEG = 1.0;

const LS_DISCOVERABLE = "agora.nearby.v1.discoverable";
const LS_COARSE_LOC = "agora.nearby.v1.coarseLoc";

export type CoarseLocation = {
  lat: number;
  lng: number;
};

export type NearbyRecord = {
  pubkey: string;
  loc: CoarseLocation;
  discoverable: boolean;
  updatedAt: number;
};

/** Round a coordinate to the nearest grid cell. */
export function coarsen(lat: number, lng: number): CoarseLocation {
  const r = (n: number) => Math.round(n / NEARBY_GRID_DEG) * NEARBY_GRID_DEG;
  return {
    lat: Number(r(lat).toFixed(2)),
    lng: Number(r(lng).toFixed(2)),
  };
}

/** Latitude-weighted planar distance in degrees, used for sorting only. */
export function approxDistance(
  a: CoarseLocation,
  b: CoarseLocation,
): number {
  const meanLatRad = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const dLat = a.lat - b.lat;
  const dLng = (a.lng - b.lng) * Math.cos(meanLatRad);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

// ---------- Local preference helpers --------------------------------------

export function getDiscoverable(): boolean {
  try {
    return localStorage.getItem(LS_DISCOVERABLE) === "true";
  } catch {
    return false;
  }
}

function setDiscoverableLS(value: boolean): void {
  try {
    if (value) localStorage.setItem(LS_DISCOVERABLE, "true");
    else localStorage.removeItem(LS_DISCOVERABLE);
  } catch {
    /* ignore */
  }
}

export function getStoredCoarseLocation(): CoarseLocation | null {
  try {
    const raw = localStorage.getItem(LS_COARSE_LOC);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CoarseLocation>;
    if (typeof parsed?.lat === "number" && typeof parsed?.lng === "number") {
      return { lat: parsed.lat, lng: parsed.lng };
    }
    return null;
  } catch {
    return null;
  }
}

function setStoredCoarseLocation(loc: CoarseLocation | null): void {
  try {
    if (!loc) localStorage.removeItem(LS_COARSE_LOC);
    else localStorage.setItem(LS_COARSE_LOC, JSON.stringify(loc));
  } catch {
    /* ignore */
  }
}

// Sample the browser's geolocation once and coarsen it before returning,
// so the precise reading never escapes this function.
export function sampleCoarseLocation(): Promise<CoarseLocation> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Geolocation is not available in this browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coarse = coarsen(pos.coords.latitude, pos.coords.longitude);
        resolve(coarse);
      },
      (err) => reject(new Error(err.message || "Could not read location.")),
      {
        enableHighAccuracy: false,
        timeout: 15000,
        maximumAge: 5 * 60 * 1000,
      },
    );
  });
}

function buildNearbyEvent(
  identity: Identity,
  loc: CoarseLocation | null,
  discoverable: boolean,
): NostrEvent {
  const content = JSON.stringify(
    discoverable && loc
      ? { discoverable: true, lat: loc.lat, lng: loc.lng, grid: NEARBY_GRID_DEG }
      : { discoverable: false },
  );
  return identity.signEvent({
    kind: NEARBY_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["d", NEARBY_D_TAG]],
    content,
  });
}

// Throws if no relay accepted the event so the caller can surface the
// failure instead of silently believing the publish succeeded.
async function publishOrThrow(event: NostrEvent, relays: string[]): Promise<void> {
  const results = await publishSigned(event, relays);
  const accepted = results.some((r) => r.status === "fulfilled");
  if (!accepted) {
    throw new Error(
      "No relay accepted the publish — your status may not be visible to other clients yet.",
    );
  }
}

// Publish (or refresh) the viewer's coarse cell with discoverable=true.
export async function publishNearbyOptIn(
  identity: Identity,
  loc: CoarseLocation,
  relays: string[],
): Promise<void> {
  const coarse = coarsen(loc.lat, loc.lng);
  const event = buildNearbyEvent(identity, coarse, true);
  setStoredCoarseLocation(coarse);
  setDiscoverableLS(true);
  await publishOrThrow(event, relays);
}

// Mark the viewer as not discoverable: publish discoverable=false
// (so other clients drop them on next refresh) plus a NIP-09 retraction
// of the prior addressable event, and clear the local cell.
export async function publishNearbyOptOut(
  identity: Identity,
  relays: string[],
): Promise<void> {
  const event = buildNearbyEvent(identity, null, false);
  setDiscoverableLS(false);
  setStoredCoarseLocation(null);
  await publishOrThrow(event, relays);
  // NIP-09 retraction of the addressable event.
  try {
    const del = identity.signEvent({
      kind: 5,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["a", `${NEARBY_KIND}:${identity.pubkey}:${NEARBY_D_TAG}`],
        ["k", String(NEARBY_KIND)],
      ],
      content: "User turned off Nearby discoverability.",
    });
    await publishSigned(del, relays);
  } catch {
    /* best-effort */
  }
}

function parseNearbyEvent(event: NostrEvent): NearbyRecord | null {
  try {
    const data = JSON.parse(event.content) as {
      discoverable?: boolean;
      lat?: number;
      lng?: number;
    };
    const discoverable = data.discoverable === true;
    if (!discoverable) {
      return {
        pubkey: event.pubkey,
        loc: { lat: 0, lng: 0 },
        discoverable: false,
        updatedAt: event.created_at,
      };
    }
    if (typeof data.lat !== "number" || typeof data.lng !== "number") {
      return null;
    }
    return {
      pubkey: event.pubkey,
      loc: coarsen(data.lat, data.lng),
      discoverable: true,
      updatedAt: event.created_at,
    };
  } catch {
    return null;
  }
}

export type NearbyEntry = NearbyRecord & { distance: number };

// Subscribe to the discoverable nearby set and rank by approximate
// distance from the viewer. Caps results and excludes the viewer.
export function useNearbyUsers(
  viewerLoc: CoarseLocation | null,
  viewerPubkey: string | null,
): { entries: NearbyEntry[]; loading: boolean } {
  const { events, loading } = useNostrQuery(
    viewerLoc ? { kinds: [NEARBY_KIND], "#d": [NEARBY_D_TAG], limit: 500 } : null,
    [viewerLoc?.lat ?? null, viewerLoc?.lng ?? null],
  );

  const entries = useMemo<NearbyEntry[]>(() => {
    if (!viewerLoc) return [];
    // Keep the most-recent record per author so updates win.
    const newest = new Map<string, NostrEvent>();
    for (const evt of events) {
      const prev = newest.get(evt.pubkey);
      if (!prev || evt.created_at > prev.created_at) newest.set(evt.pubkey, evt);
    }
    const out: NearbyEntry[] = [];
    for (const evt of newest.values()) {
      if (viewerPubkey && evt.pubkey === viewerPubkey) continue;
      const rec = parseNearbyEvent(evt);
      if (!rec || !rec.discoverable) continue;
      const distance = approxDistance(viewerLoc, rec.loc);
      if (distance > NEARBY_RADIUS_DEG) continue;
      out.push({ ...rec, distance });
    }
    out.sort((a, b) => {
      if (a.distance !== b.distance) return a.distance - b.distance;
      return b.updatedAt - a.updatedAt;
    });
    return out.slice(0, NEARBY_RESULT_CAP);
  }, [events, viewerLoc?.lat, viewerLoc?.lng, viewerPubkey]);

  return { entries, loading };
}

export type ForumContext = {
  communities: string[];
  recent: NostrEvent | null;
};

const POST_KINDS = [1, 11, 1111];

// Derive forum context for a Nearby card: the communities the user has
// posted in and one recent post/comment.
export function useForumContext(pubkey: string | null): {
  context: ForumContext;
  loading: boolean;
} {
  const { events, loading } = useNostrQuery(
    pubkey ? { kinds: POST_KINDS, authors: [pubkey], limit: 30 } : null,
    [pubkey],
  );
  const context = useMemo<ForumContext>(() => {
    const communities: string[] = [];
    const seen = new Set<string>();
    let recent: NostrEvent | null = null;
    const sorted = [...events].sort((a, b) => b.created_at - a.created_at);
    for (const evt of sorted) {
      const a = evt.tags.find(
        (t) => t[0] === "a" && (t[1] ?? "").startsWith("34550:"),
      );
      const id = a ? a[1].split(":")[2] : null;
      if (id && !seen.has(id)) {
        seen.add(id);
        communities.push(id);
      }
      if (!recent) recent = evt;
    }
    return { communities: communities.slice(0, 4), recent };
  }, [events]);
  return { context, loading };
}

// Live-read the viewer's local opt-in state and stored coarse cell.
// Updates when other tabs change them via the storage event.
export function useNearbySelf(): {
  discoverable: boolean;
  coarseLocation: CoarseLocation | null;
  setDiscoverable: (value: boolean) => void;
  setCoarseLocation: (loc: CoarseLocation | null) => void;
} {
  const [discoverable, setDiscoverableState] = useState(getDiscoverable());
  const [coarseLocation, setCoarseLocationState] = useState<CoarseLocation | null>(
    getStoredCoarseLocation(),
  );

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === LS_DISCOVERABLE) setDiscoverableState(getDiscoverable());
      if (e.key === LS_COARSE_LOC) setCoarseLocationState(getStoredCoarseLocation());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return {
    discoverable,
    coarseLocation,
    setDiscoverable: (v: boolean) => {
      setDiscoverableLS(v);
      setDiscoverableState(v);
    },
    setCoarseLocation: (loc: CoarseLocation | null) => {
      setStoredCoarseLocation(loc);
      setCoarseLocationState(loc);
    },
  };
}

// Wipe local Nearby state (used by Settings' "turn off & clear cell").
export function clearLocalNearbyState(): void {
  setDiscoverableLS(false);
  setStoredCoarseLocation(null);
}
