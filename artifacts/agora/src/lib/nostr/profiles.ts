import { useEffect, useState } from "react";
import type { Event as NostrEvent } from "nostr-tools/core";
import { useNostrPool, publishSigned } from "./pool";
import type { Identity } from "./identity";

export type ProfileMetadata = {
  name?: string;
  display_name?: string;
  about?: string;
  picture?: string;
  banner?: string;
  nip05?: string;
};

const cache = new Map<string, ProfileMetadata | null>();

function parseProfile(event: NostrEvent): ProfileMetadata | null {
  try {
    return JSON.parse(event.content) as ProfileMetadata;
  } catch {
    return null;
  }
}

export function useProfile(pubkey: string | null | undefined): {
  profile: ProfileMetadata | null;
  loading: boolean;
} {
  const { pool, relays } = useNostrPool();
  const [profile, setProfile] = useState<ProfileMetadata | null>(
    pubkey ? cache.get(pubkey) ?? null : null,
  );
  const [loading, setLoading] = useState<boolean>(
    !!pubkey && !cache.has(pubkey),
  );

  useEffect(() => {
    if (!pubkey) {
      setProfile(null);
      setLoading(false);
      return;
    }
    if (cache.has(pubkey)) {
      setProfile(cache.get(pubkey) ?? null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    let latest: NostrEvent | null = null;
    const sub = pool.subscribeMany(relays, { kinds: [0], authors: [pubkey], limit: 1 }, {
      onevent: (event) => {
        if (!latest || event.created_at > latest.created_at) latest = event;
      },
      oneose: () => {
        if (cancelled) return;
        const meta = latest ? parseProfile(latest) : null;
        cache.set(pubkey, meta);
        setProfile(meta);
        setLoading(false);
        sub.close();
      },
    });
    return () => {
      cancelled = true;
      sub.close();
    };
  }, [pubkey, pool, relays]);

  return { profile, loading };
}

export async function publishProfile(
  identity: Identity,
  metadata: ProfileMetadata,
  relays: string[],
): Promise<void> {
  const event = identity.signEvent({
    kind: 0,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: JSON.stringify(metadata),
  });
  cache.set(identity.pubkey, metadata);
  await publishSigned(event, relays);
}

export function useProfiles(pubkeys: string[]): Map<string, ProfileMetadata> {
  const { pool, relays } = useNostrPool();
  const [profiles, setProfiles] = useState<Map<string, ProfileMetadata>>(() => {
    const m = new Map<string, ProfileMetadata>();
    for (const pk of pubkeys) {
      const cached = cache.get(pk);
      if (cached) m.set(pk, cached);
    }
    return m;
  });

  useEffect(() => {
    const need = pubkeys.filter((pk) => !cache.has(pk));
    if (!need.length) return;
    let cancelled = false;
    const sub = pool.subscribeMany(relays, { kinds: [0], authors: need }, {
      onevent: (event) => {
        const meta = parseProfile(event);
        if (!meta) return;
        const existing = cache.get(event.pubkey);
        cache.set(event.pubkey, meta);
        if (cancelled) return;
        if (!existing) {
          setProfiles((prev) => {
            const next = new Map(prev);
            next.set(event.pubkey, meta);
            return next;
          });
        }
      },
      oneose: () => sub.close(),
    });
    return () => {
      cancelled = true;
      sub.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pubkeys.join(",")]);

  return profiles;
}
