import { useNostrQuery, publishSigned } from "./pool";
import { useIdentityStore, useRelayStore } from "./store";
import type { Event as NostrEvent } from "nostr-tools/core";

/**
 * Custom moderation event kind. We use kind:9000 (a generally-recognized
 * "moderation" range used by community implementations) and structure tags
 * so Agora can render a public, signed audit log.
 *
 * Tags:
 *   ["d", communityIdentifier]      // which community
 *   ["t", communityIdentifier]      // for #t-based filtering
 *   ["action", "remove_post"|"ban_user"|...]
 *   ["e", targetEventId]            // when applicable
 *   ["p", targetPubkey]             // when applicable
 *   ["reason", text]                // optional
 */
export const MOD_LOG_KIND = 9000;

export type ModAction = "remove_post" | "ban_user" | "unban_user" | "approve_post";

export type ModLogEntry = {
  id: string;
  signer: string;
  action: ModAction | string;
  community: string;
  targetEventId?: string;
  targetPubkey?: string;
  reason?: string;
  createdAt: number;
};

function tagValue(event: NostrEvent, key: string): string | undefined {
  return event.tags.find((t) => t[0] === key)?.[1];
}

export function eventToModLogEntry(event: NostrEvent): ModLogEntry | null {
  const community = tagValue(event, "d") ?? tagValue(event, "t");
  const action = tagValue(event, "action");
  if (!community || !action) return null;
  return {
    id: event.id,
    signer: event.pubkey,
    action,
    community,
    targetEventId: tagValue(event, "e"),
    targetPubkey: tagValue(event, "p"),
    reason: tagValue(event, "reason"),
    createdAt: event.created_at,
  };
}

export function useModLog(communityIdentifier: string | null) {
  const { events, loading } = useNostrQuery(
    communityIdentifier
      ? { kinds: [MOD_LOG_KIND], "#t": [communityIdentifier], limit: 200 }
      : null,
    [communityIdentifier],
  );
  const entries = events
    .map(eventToModLogEntry)
    .filter((e): e is ModLogEntry => !!e)
    .sort((a, b) => b.createdAt - a.createdAt);
  return { entries, loading };
}

export type PublishModActionInput = {
  community: string;
  action: ModAction;
  targetEventId?: string;
  targetPubkey?: string;
  reason?: string;
};

export async function publishModAction(input: PublishModActionInput) {
  const identity = useIdentityStore.getState().identity;
  if (!identity) throw new Error("not signed in");
  const relays = useRelayStore.getState().relays;
  const tags: string[][] = [
    ["d", input.community],
    ["t", input.community],
    ["action", input.action],
  ];
  if (input.targetEventId) tags.push(["e", input.targetEventId]);
  if (input.targetPubkey) tags.push(["p", input.targetPubkey]);
  if (input.reason) tags.push(["reason", input.reason]);
  const signed = identity.signEvent({
    kind: MOD_LOG_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: input.reason ?? "",
  });
  await publishSigned(signed, relays);
  return signed;
}
