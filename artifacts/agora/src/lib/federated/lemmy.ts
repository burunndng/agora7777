/**
 * Read-only Lemmy bridge.
 *
 * Lemmy exposes a clean JSON API at /api/v3, plus an ActivityPub outbox per
 * community. We prefer the JSON API (richer fields, simpler shape) and fall
 * back to the outbox if it is disabled or rejected. Both paths are wrapped in
 * the multi-proxy fetch helper because most instances do not enable CORS.
 */

import { fetchJsonWithFallback } from "./proxy";
import type { FederatedFetchResult, FederatedPost } from "./types";

export interface LemmyTarget {
  /** Bare hostname, e.g. `lemmy.world`. */
  instance: string;
  /** Local community name within the instance, e.g. `technology`. */
  community: string;
}

/**
 * Parse a free-form community identifier into an instance + community.
 * Accepted shapes:
 *   technology@lemmy.world
 *   !technology@lemmy.world
 *   https://lemmy.world/c/technology
 */
export function parseLemmyTarget(raw: string): LemmyTarget | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("http")) {
    try {
      const u = new URL(trimmed);
      const m = u.pathname.match(/\/c\/([^/]+)/);
      if (!m) return null;
      return { instance: u.hostname, community: m[1] };
    } catch {
      return null;
    }
  }
  const stripped = trimmed.startsWith("!") ? trimmed.slice(1) : trimmed;
  const at = stripped.indexOf("@");
  if (at <= 0 || at === stripped.length - 1) return null;
  const community = stripped.slice(0, at);
  const instance = stripped.slice(at + 1);
  if (!/^[a-zA-Z0-9._-]+$/.test(instance)) return null;
  if (!/^[a-zA-Z0-9._-]+$/.test(community)) return null;
  return { instance, community };
}

export function formatLemmyTarget(t: LemmyTarget): string {
  return `!${t.community}@${t.instance}`;
}

interface LemmyApiPostView {
  post: {
    id: number;
    name: string;
    body?: string;
    url?: string;
    ap_id: string;
    published: string;
    thumbnail_url?: string;
  };
  creator: {
    name: string;
    actor_id: string;
  };
}

interface LemmyApiPostList {
  posts?: LemmyApiPostView[];
}

interface ActivityPubObject {
  id?: string;
  type?: string;
  name?: string;
  content?: string;
  attributedTo?: string;
  published?: string;
  url?: string | { href?: string };
  attachment?: Array<{ url?: string; href?: string; type?: string }>;
}

interface OutboxPage {
  orderedItems?: Array<{
    type?: string;
    object?: ActivityPubObject;
    actor?: string;
    published?: string;
  }>;
  first?: string | { id?: string };
}

function pickUrl(value: ActivityPubObject["url"]): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof value.href === "string") return value.href;
  return null;
}

function htmlToPlain(html: string): string {
  return html
    .replace(/<br\s*\/?>(\s|$)/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function authorLabelFromUrl(url: string, fallback: string): string {
  try {
    const u = new URL(url);
    const handle = u.pathname.split("/").filter(Boolean).pop() ?? fallback;
    return `${handle}@${u.hostname}`;
  } catch {
    return fallback;
  }
}

export async function fetchLemmyCommunity(
  target: LemmyTarget,
  opts: { limit?: number; signal?: AbortSignal } = {},
): Promise<FederatedFetchResult> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const communityUrl = `https://${target.instance}/c/${target.community}`;

  // Try the native JSON API first.
  const apiUrl =
    `https://${target.instance}/api/v3/post/list` +
    `?community_name=${encodeURIComponent(target.community)}` +
    `&sort=Active&limit=${limit}`;
  let apiError: string | null = null;
  try {
    const { data, attempt } = await fetchJsonWithFallback<LemmyApiPostList>(apiUrl, {
      signal: opts.signal,
      accept: "application/json",
    });
    if (data && Array.isArray(data.posts)) {
      const posts: FederatedPost[] = data.posts.map((view) => {
        const p = view.post;
        const publishedAt = Math.floor(new Date(p.published).getTime() / 1000);
        const attachments: string[] = [];
        if (p.url) attachments.push(p.url);
        if (p.thumbnail_url && p.thumbnail_url !== p.url) attachments.push(p.thumbnail_url);
        return {
          id: p.ap_id,
          url: p.ap_id,
          title: p.name?.trim() || "(untitled)",
          content: p.body ? p.body.trim() : "",
          authorName: authorLabelFromUrl(view.creator.actor_id, view.creator.name),
          authorUrl: view.creator.actor_id,
          publishedAt: Number.isFinite(publishedAt) ? publishedAt : Math.floor(Date.now() / 1000),
          attachments,
        };
      });
      return {
        posts,
        source: {
          kind: "lemmy",
          instance: target.instance,
          label: `${target.community}@${target.instance}`,
          remoteUrl: communityUrl,
        },
        fetchedVia: attempt.via,
        direct: attempt.direct,
      };
    }
    apiError = "JSON API returned an unexpected shape";
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    apiError = err instanceof Error ? err.message : String(err);
  }

  // Fall back to the ActivityPub outbox.
  const outboxUrl = `${communityUrl}/outbox`;
  const { data: outbox, attempt } = await fetchJsonWithFallback<OutboxPage>(outboxUrl, {
    signal: opts.signal,
    accept: "application/activity+json, application/json",
  });
  let page: OutboxPage = outbox;
  if (!Array.isArray(page.orderedItems) && page.first) {
    const firstUrl = typeof page.first === "string" ? page.first : page.first?.id;
    if (firstUrl) {
      const next = await fetchJsonWithFallback<OutboxPage>(firstUrl, {
        signal: opts.signal,
        accept: "application/activity+json, application/json",
      });
      page = next.data;
    }
  }
  const items = Array.isArray(page.orderedItems) ? page.orderedItems : [];
  const posts: FederatedPost[] = [];
  for (const activity of items) {
    if (posts.length >= limit) break;
    if (activity?.type !== "Create" || !activity.object) continue;
    const obj = activity.object;
    if (obj.type && obj.type !== "Note" && obj.type !== "Page" && obj.type !== "Article") continue;
    const id = obj.id;
    if (!id || typeof id !== "string") continue;
    const externalUrl = pickUrl(obj.url) ?? id;
    const publishedRaw = obj.published || activity.published;
    const publishedAt = publishedRaw
      ? Math.floor(new Date(publishedRaw).getTime() / 1000)
      : Math.floor(Date.now() / 1000);
    if (Number.isNaN(publishedAt)) continue;
    const title = obj.name?.trim() || "(untitled)";
    const content = obj.content ? htmlToPlain(obj.content) : "";
    const authorUrl = obj.attributedTo || activity.actor || communityUrl;
    const attachments: string[] = [];
    if (Array.isArray(obj.attachment)) {
      for (const att of obj.attachment) {
        const u = att?.url ?? att?.href;
        if (typeof u === "string") attachments.push(u);
      }
    }
    posts.push({
      id,
      url: externalUrl,
      title,
      content,
      authorName: authorLabelFromUrl(authorUrl, "lemmy"),
      authorUrl,
      publishedAt,
      attachments,
    });
  }
  if (posts.length === 0 && apiError) {
    // Surface the JSON-API failure so users see why we fell back to an empty
    // outbox rather than silently showing "no posts".
    throw new Error(`JSON API failed (${apiError}); outbox returned no usable posts`);
  }
  return {
    posts,
    source: {
      kind: "lemmy",
      instance: target.instance,
      label: `${target.community}@${target.instance}`,
      remoteUrl: communityUrl,
    },
    fetchedVia: attempt.via,
    direct: attempt.direct,
  };
}
