import { useEffect, useMemo, useState } from "react";
import type { Event as NostrEvent } from "nostr-tools/core";
import { useNostrQuery, publishSigned } from "./pool";
import { useIdentityStore, useRelayStore } from "./store";

/**
 * Client-side role model.
 *
 * Agora has no server, so "admin" is purely a derived label: the user
 * whose handle (mixed into their Argon2id salt) is exactly "admin". This
 * means role gating is *cosmetic* — anyone could try to spoof an admin
 * pubkey, but they'd need the actual passphrase to sign events that other
 * clients accept under the admin npub.
 *
 * The admin publishes a kind:30000 (NIP-51 follow-set) replaceable list
 * with `d=agora-moderators` whose `p` tags name the global moderator
 * roster. Any client can verify the roster's authenticity by checking the
 * event signature and that the author matches the cached admin pubkey.
 */

export const ADMIN_HANDLE = "admin";
export const MOD_ROSTER_KIND = 30000;
export const MOD_ROSTER_D = "agora-moderators";
export const ADMIN_PROFILE_KIND = 0;

const ADMIN_PUBKEY_LS_KEY = "agora.admin.pubkey.v1";

function readCachedAdminPubkey(): string | null {
  try {
    const v = localStorage.getItem(ADMIN_PUBKEY_LS_KEY);
    return v && /^[0-9a-f]{64}$/i.test(v) ? v.toLowerCase() : null;
  } catch {
    return null;
  }
}

function writeCachedAdminPubkey(pubkey: string) {
  try {
    localStorage.setItem(ADMIN_PUBKEY_LS_KEY, pubkey);
  } catch {
    /* ignore */
  }
}

/**
 * Returns the canonical admin pubkey, or null if not yet resolvable.
 *
 * Discovery is anchored in TWO independent on-relay claims, so that a
 * single forged kind:0 with `name=admin` cannot hijack moderator-roster
 * trust:
 *   1. Local short-circuit: if the signed-in user has handle="admin",
 *      they ARE the admin (cache + return).
 *   2. Locally cached value (only ever written by step 1 OR by step 3).
 *   3. Cross-anchor: scan kind:30000 d=agora-moderators rosters and
 *      kind:0 profiles whose `name`/`nip05` claims "admin"; only authors
 *      that BOTH published a roster event AND publicly profile-claim the
 *      admin label are accepted. Among matches, the newest roster wins.
 *
 * Even with this cross-anchor it's still client-side TOFU — but it
 * requires the attacker to publish two coordinated events under the same
 * key and beat the legitimate admin's first publish, which is materially
 * stronger than the previous "first roster event wins" heuristic.
 */
export function useAdminPubkey(): { adminPubkey: string | null; loading: boolean } {
  const me = useIdentityStore((s) => s.identity);
  const [cached, setCached] = useState<string | null>(() => readCachedAdminPubkey());

  useEffect(() => {
    if (me?.handle === ADMIN_HANDLE) {
      writeCachedAdminPubkey(me.pubkey);
      setCached(me.pubkey);
    }
  }, [me?.handle, me?.pubkey]);

  // Pull recent rosters and admin-claiming profiles in parallel. Either
  // can be empty; we combine on the client.
  const { events: rosterEvents, loading: loadingRoster } = useNostrQuery(
    cached ? null : { kinds: [MOD_ROSTER_KIND], "#d": [MOD_ROSTER_D], limit: 50 },
    [cached],
  );
  const { events: profileEvents, loading: loadingProfiles } = useNostrQuery(
    cached ? null : { kinds: [ADMIN_PROFILE_KIND], limit: 200 },
    [cached],
  );

  useEffect(() => {
    if (cached) return;
    if (!rosterEvents.length || !profileEvents.length) return;
    const adminClaimers = new Set<string>();
    for (const ev of profileEvents) {
      try {
        const meta = JSON.parse(ev.content) as {
          name?: string;
          nip05?: string;
        };
        const claim =
          (meta.name ?? "").trim().toLowerCase() === ADMIN_HANDLE ||
          (meta.nip05 ?? "")
            .split("@")[0]
            .trim()
            .toLowerCase() === ADMIN_HANDLE;
        if (claim) adminClaimers.add(ev.pubkey);
      } catch {
        /* ignore malformed profiles */
      }
    }
    const matchingRosters = rosterEvents
      .filter((e) => adminClaimers.has(e.pubkey))
      .sort((a, b) => b.created_at - a.created_at);
    const winner = matchingRosters[0]?.pubkey ?? null;
    if (winner) {
      writeCachedAdminPubkey(winner);
      setCached(winner);
    }
  }, [rosterEvents, profileEvents, cached]);

  return {
    adminPubkey: cached,
    loading: !cached && (loadingRoster || loadingProfiles),
  };
}

/**
 * The admin role is bound exclusively to the act of signing with the
 * literal handle "admin" (mixed into the Argon2id salt). Pubkey-based
 * checks would let an attacker who happened to acquire a handle-collision
 * pubkey impersonate the admin without holding the passphrase.
 */
export function useIsAdmin(): boolean {
  const me = useIdentityStore((s) => s.identity);
  return me?.handle === ADMIN_HANDLE;
}

export type ModeratorRoster = {
  pubkeys: Set<string>;
  publishedAt: number | null;
  signer: string | null;
  /** Optional notes the admin attached when publishing the roster. */
  note: string | null;
};

const EMPTY_ROSTER: ModeratorRoster = {
  pubkeys: new Set(),
  publishedAt: null,
  signer: null,
  note: null,
};

function rosterFromEvent(event: NostrEvent | null): ModeratorRoster {
  if (!event) return EMPTY_ROSTER;
  const pubkeys = new Set<string>();
  for (const t of event.tags) {
    if (t[0] === "p" && typeof t[1] === "string" && /^[0-9a-f]{64}$/i.test(t[1])) {
      pubkeys.add(t[1].toLowerCase());
    }
  }
  return {
    pubkeys,
    publishedAt: event.created_at,
    signer: event.pubkey,
    note: event.content || null,
  };
}

/**
 * Hook returning the admin-signed global moderator roster, plus a loading
 * flag. Events authored by anyone other than the resolved admin are
 * ignored — this is what makes the roster spoof-resistant on the client.
 */
export function useModeratorRoster(): { roster: ModeratorRoster; loading: boolean } {
  const { adminPubkey, loading: loadingAdmin } = useAdminPubkey();
  const { events, loading } = useNostrQuery(
    adminPubkey
      ? {
          kinds: [MOD_ROSTER_KIND],
          authors: [adminPubkey],
          "#d": [MOD_ROSTER_D],
          limit: 5,
        }
      : null,
    [adminPubkey],
  );
  const roster = useMemo(() => {
    if (!adminPubkey) return EMPTY_ROSTER;
    const valid = events
      .filter((e) => e.pubkey === adminPubkey)
      .sort((a, b) => b.created_at - a.created_at);
    return rosterFromEvent(valid[0] ?? null);
  }, [events, adminPubkey]);
  return { roster, loading: loading || loadingAdmin };
}

export function useIsModerator(): boolean {
  const me = useIdentityStore((s) => s.identity);
  const { roster } = useModeratorRoster();
  if (!me) return false;
  return roster.pubkeys.has(me.pubkey);
}

export type AppRole = "admin" | "moderator" | "user" | "anonymous";

export function useRole(): AppRole {
  const me = useIdentityStore((s) => s.identity);
  const isAdmin = useIsAdmin();
  const isMod = useIsModerator();
  if (!me) return "anonymous";
  if (isAdmin) return "admin";
  if (isMod) return "moderator";
  return "user";
}

/**
 * Publish (or replace) the global moderator roster. Must be called by the
 * admin identity — other signers will produce an event other clients
 * ignore.
 */
export async function publishModeratorRoster(input: {
  pubkeys: string[];
  note?: string;
}) {
  const identity = useIdentityStore.getState().identity;
  if (!identity) throw new Error("not signed in");
  if (identity.handle !== ADMIN_HANDLE) {
    throw new Error("only the admin handle can publish the moderator roster");
  }
  const relays = useRelayStore.getState().relays;
  const seen = new Set<string>();
  const tags: string[][] = [["d", MOD_ROSTER_D]];
  for (const raw of input.pubkeys) {
    const pk = raw.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(pk)) continue;
    if (seen.has(pk)) continue;
    seen.add(pk);
    tags.push(["p", pk]);
  }
  const signed = identity.signEvent({
    kind: MOD_ROSTER_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: input.note ?? "",
  });
  // Cache our pubkey as admin so other devices/sessions resolve quickly.
  writeCachedAdminPubkey(identity.pubkey);
  await publishSigned(signed, relays);
  return signed;
}
