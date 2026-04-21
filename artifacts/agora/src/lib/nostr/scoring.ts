import { getPow } from "nostr-tools/nip13";
import type { Event as NostrEvent } from "nostr-tools/core";

export function eventPow(event: NostrEvent): number {
  return getPow(event.id);
}

/**
 * Weighted score: net votes weighted by voter PoW and account age, then biased
 * by the post's own PoW. Mirrors the documented formula:
 *   score = netVotes * (1 + powDifficulty * 0.1) * log(1 + accountAgeDays)
 */
export function scorePost(opts: {
  upvotes: { pow: number; ageDays: number }[];
  downvotes: { pow: number; ageDays: number }[];
  postPow: number;
  ageHours: number;
}): number {
  const weight = (v: { pow: number; ageDays: number }) =>
    (1 + v.pow * 0.05) * Math.log(1 + Math.max(0, v.ageDays));
  const up = opts.upvotes.reduce((sum, v) => sum + weight(v), 0);
  const down = opts.downvotes.reduce((sum, v) => sum + weight(v), 0);
  const net = up - down;
  const powBoost = 1 + opts.postPow * 0.1;
  // gravity: posts decay over time, similar to HN
  const gravity = Math.pow(opts.ageHours + 2, 1.5);
  return (net * powBoost) / gravity;
}
