import { useMemo } from "react";
import type { Event as NostrEvent } from "nostr-tools/core";
import { useNostrQuery } from "./pool";

export type SharedContext =
  | { kind: "community"; identifier: string }
  | { kind: "post"; eventId: string; title: string }
  | null;

const POST_KINDS = [1, 11, 1111];

function communityId(e: NostrEvent): string | null {
  const a = e.tags.find((t) => t[0] === "a" && (t[1] ?? "").startsWith("34550:"));
  if (!a) return null;
  const parts = a[1].split(":");
  return parts[2] || null;
}

function threadRoots(e: NostrEvent): string[] {
  // Both NIP-10 (kind 1) and NIP-22 (kind 1111) use lowercase `e` for the
  // direct parent and may use uppercase `E` for the root. Treat both as
  // "this user participated in this thread".
  const ids: string[] = [];
  for (const t of e.tags) {
    if ((t[0] === "e" || t[0] === "E") && t[1] && /^[0-9a-f]{64}$/i.test(t[1])) {
      ids.push(t[1]);
    }
  }
  return ids;
}

function postLabel(e: NostrEvent): string {
  const subj = e.tags.find((t) => t[0] === "subject" || t[0] === "title")?.[1];
  if (subj && subj.trim()) return subj.trim();
  const c = e.content.trim().replace(/\s+/g, " ");
  return c.length > 60 ? `${c.slice(0, 59).trimEnd()}…` : c || "a recent post";
}

/**
 * Find one shared piece of public forum context between viewer and target.
 * Prefers a community both have posted in; falls back to a post or thread
 * both have commented on. Returns null when nothing is shared — callers
 * must render no prompt at all in that case (no generic fallback).
 */
export function useSharedContext(
  viewer: string | null | undefined,
  target: string | null | undefined,
): { context: SharedContext; loading: boolean } {
  const enabled = !!viewer && !!target && viewer !== target;
  const { events, loading } = useNostrQuery(
    enabled
      ? { kinds: POST_KINDS, authors: [viewer!, target!], limit: 200 }
      : null,
    [viewer ?? null, target ?? null],
  );

  const candidate = useMemo<
    | { kind: "community"; identifier: string }
    | { kind: "post"; eventId: string }
    | null
  >(() => {
    if (!enabled) return null;
    const viewerComms = new Map<string, number>(); // identifier -> latest ts
    const targetComms = new Map<string, number>();
    const viewerThreads = new Map<string, number>();
    const targetThreads = new Map<string, number>();

    for (const e of events) {
      const cid = communityId(e);
      const roots = threadRoots(e);
      const isViewer = e.pubkey === viewer;
      const isTarget = e.pubkey === target;
      if (!isViewer && !isTarget) continue;
      if (cid) {
        const map = isViewer ? viewerComms : targetComms;
        map.set(cid, Math.max(map.get(cid) ?? 0, e.created_at));
      }
      for (const r of roots) {
        const map = isViewer ? viewerThreads : targetThreads;
        map.set(r, Math.max(map.get(r) ?? 0, e.created_at));
      }
    }

    // Prefer the most-recently-active shared community.
    let bestComm: { id: string; ts: number } | null = null;
    for (const [id, ts] of viewerComms) {
      const t2 = targetComms.get(id);
      if (!t2) continue;
      const score = Math.max(ts, t2);
      if (!bestComm || score > bestComm.ts) bestComm = { id, ts: score };
    }
    if (bestComm) return { kind: "community", identifier: bestComm.id };

    // Fallback: shared thread (most recent activity by either side).
    let bestThread: { id: string; ts: number } | null = null;
    for (const [id, ts] of viewerThreads) {
      const t2 = targetThreads.get(id);
      if (!t2) continue;
      const score = Math.max(ts, t2);
      if (!bestThread || score > bestThread.ts) bestThread = { id, ts: score };
    }
    if (bestThread) return { kind: "post", eventId: bestThread.id };
    return null;
  }, [events, viewer, target, enabled]);

  // For a shared thread we need the root post's human label.
  const { events: rootEvents, loading: rootLoading } = useNostrQuery(
    candidate?.kind === "post" ? { ids: [candidate.eventId], limit: 1 } : null,
    [candidate?.kind === "post" ? candidate.eventId : null],
  );

  const context = useMemo<SharedContext>(() => {
    if (!candidate) return null;
    if (candidate.kind === "community") return candidate;
    const evt = rootEvents[0];
    if (!evt) {
      // Still resolving: don't render until we have a label so we can show
      // a concrete shared thing instead of a bare event id.
      return null;
    }
    return { kind: "post", eventId: candidate.eventId, title: postLabel(evt) };
  }, [candidate, rootEvents]);

  return {
    context,
    loading: loading || (candidate?.kind === "post" && rootLoading),
  };
}

/**
 * Build the pre-written opener text for a shared context. Kept in one
 * place so the profile prompt and any future surface stay consistent.
 */
export function buildOpener(context: NonNullable<SharedContext>): string {
  if (context.kind === "community") {
    return `Hey — saw we both post in ${context.identifier}. What got you into it?`;
  }
  return `Hey — noticed we both commented on "${context.title}". Curious what your take on it was.`;
}
