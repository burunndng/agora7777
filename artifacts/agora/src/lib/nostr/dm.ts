import { useEffect, useMemo, useState } from "react";
import type { Event as NostrEvent } from "nostr-tools/core";
import { useNostrPool } from "./pool";
import { useIdentityStore } from "./store";
import type { DMRumor } from "./identity";
import { publishSigned } from "./pool";

export type DMMessage = {
  /** Stable id: use the inner rumor id when present, else wrap id. */
  id: string;
  /** Sender pubkey (from the unwrapped rumor — authentic). */
  from: string;
  /** First p-tag in the rumor (the recipient). */
  to: string;
  /** Plain-text message content. */
  content: string;
  /** The rumor's actual created_at (set by sender, NOT jittered). */
  createdAt: number;
};

export type DMThread = {
  /** The other party's pubkey. */
  counterpart: string;
  messages: DMMessage[];
  /** Most recent message timestamp. */
  lastAt: number;
};

function rumorToMessage(rumor: DMRumor, wrap: NostrEvent): DMMessage | null {
  if (rumor.kind !== 14) return null;
  const recipient = rumor.tags.find((t) => t[0] === "p")?.[1] ?? "";
  return {
    id: rumor.id ?? wrap.id,
    from: rumor.pubkey,
    to: recipient,
    content: rumor.content,
    createdAt: rumor.created_at,
  };
}

/**
 * Subscribe to incoming NIP-59 wrapped DMs (#p == self) and unwrap them
 * into NIP-17 chat messages. Groups results into threads keyed by counterpart.
 */
export function useDMs() {
  const identity = useIdentityStore((s) => s.identity);
  const { pool, relays } = useNostrPool();
  const [messages, setMessages] = useState<Map<string, DMMessage>>(new Map());
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    if (!identity) {
      setMessages(new Map());
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);

    const sub = pool.subscribeMany(
      relays,
      // 48h jitter window means we may receive wraps stamped up to 48h in the
      // future — request a wide window so the relay returns them.
      { kinds: [1059], "#p": [identity.pubkey], limit: 500 },
      {
        onevent: (wrap) => {
          if (cancelled) return;
          try {
            const rumor = identity.unwrapDM(wrap);
            const msg = rumorToMessage(rumor, wrap);
            if (!msg) return;
            setMessages((prev) => {
              if (prev.has(msg.id)) return prev;
              const next = new Map(prev);
              next.set(msg.id, msg);
              return next;
            });
          } catch {
            // Not for us, or undecryptable. Skip.
          }
        },
        oneose: () => {
          if (!cancelled) setLoading(false);
        },
      },
    );

    return () => {
      cancelled = true;
      sub.close();
    };
  }, [identity, pool, relays]);

  const threads = useMemo<DMThread[]>(() => {
    if (!identity) return [];
    const byCounterpart = new Map<string, DMMessage[]>();
    for (const m of messages.values()) {
      const counterpart = m.from === identity.pubkey ? m.to : m.from;
      if (!counterpart) continue;
      const list = byCounterpart.get(counterpart) ?? [];
      list.push(m);
      byCounterpart.set(counterpart, list);
    }
    return Array.from(byCounterpart.entries())
      .map(([counterpart, list]) => {
        list.sort((a, b) => a.createdAt - b.createdAt);
        return {
          counterpart,
          messages: list,
          lastAt: list[list.length - 1].createdAt,
        };
      })
      .sort((a, b) => b.lastAt - a.lastAt);
  }, [messages, identity]);

  return { threads, loading };
}

/**
 * Encrypt and publish a NIP-17 chat message to the recipient. Publishes
 * gift-wrap events for both sender and recipient so both inboxes can render
 * the conversation. Timestamps are randomized within ±48h by NIP-59.
 */
export async function sendDM(
  recipientPubkey: string,
  message: string,
  relays: string[],
) {
  const identity = useIdentityStore.getState().identity;
  if (!identity) throw new Error("not signed in");
  if (!message.trim()) throw new Error("empty message");
  const wraps = identity.wrapDM(recipientPubkey, message.trim());
  await Promise.all(wraps.map((w) => publishSigned(w, relays)));
}
