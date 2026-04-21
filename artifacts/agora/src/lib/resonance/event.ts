/**
 * Encode/decode the user's Resonance Map as a NIP-51 parameterized
 * replaceable event so other Nostr clients can read it.
 *
 * Event shape (kind 30015):
 *   tags:
 *     ["d", "agora-resonance-v1"]                  // identifier (one map per user)
 *     ["t", "<tag-id>", "<intensity>"]             // one per selected interest
 *     ...
 *     ["app", "agora"]                             // UI hint (spoofable)
 *   content: ""
 *
 * "intensity" is a string in the inclusive range "1".."5". Tags whose id
 * is not in the current taxonomy are silently dropped on read so that
 * removing a tag from the taxonomy never breaks decoding old events.
 */

import type { Event as NostrEvent } from "nostr-tools/core";
import {
  MAX_RESONANCE_SELECTIONS,
  clampIntensity,
  isKnownResonanceTag,
} from "./taxonomy";

export const RESONANCE_EVENT_KIND = 30015;
export const RESONANCE_DTAG = "agora-resonance-v1";
export const RESONANCE_APP_TAG = "agora";

export type ResonanceSelection = {
  tagId: string;
  intensity: number;
};

export type ResonanceMap = {
  /** Author pubkey of the kind 30015 event. */
  pubkey: string;
  /** Selected tags with intensity, in published order. */
  selections: ResonanceSelection[];
  /** Unix seconds — when the underlying event was created. */
  updatedAt: number;
};

export function buildResonanceEventTags(
  selections: ResonanceSelection[],
): string[][] {
  // Defensive: dedupe by tagId, drop unknowns, clamp intensity, cap count.
  const seen = new Set<string>();
  const tags: string[][] = [["d", RESONANCE_DTAG]];
  let kept = 0;
  for (const s of selections) {
    if (kept >= MAX_RESONANCE_SELECTIONS) break;
    if (!s || typeof s.tagId !== "string") continue;
    const id = s.tagId.trim();
    if (!id || seen.has(id) || !isKnownResonanceTag(id)) continue;
    seen.add(id);
    tags.push(["t", id, String(clampIntensity(s.intensity))]);
    kept++;
  }
  tags.push(["app", RESONANCE_APP_TAG]);
  return tags;
}

export function parseResonanceEvent(event: NostrEvent): ResonanceMap | null {
  if (event.kind !== RESONANCE_EVENT_KIND) return null;
  const dTag = event.tags.find((t) => t[0] === "d")?.[1];
  if (dTag !== RESONANCE_DTAG) return null;
  const selections: ResonanceSelection[] = [];
  const seen = new Set<string>();
  for (const t of event.tags) {
    if (t[0] !== "t" || typeof t[1] !== "string") continue;
    const id = t[1];
    if (seen.has(id) || !isKnownResonanceTag(id)) continue;
    const raw = typeof t[2] === "string" ? Number.parseInt(t[2], 10) : NaN;
    selections.push({ tagId: id, intensity: clampIntensity(raw) });
    seen.add(id);
    if (selections.length >= MAX_RESONANCE_SELECTIONS) break;
  }
  return {
    pubkey: event.pubkey,
    selections,
    updatedAt: event.created_at,
  };
}
