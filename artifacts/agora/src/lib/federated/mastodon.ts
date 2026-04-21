/**
 * Read-only Mastodon bridge.
 *
 * Mastodon's public REST endpoints (`/api/v1/timelines/tag/:tag`,
 * `/api/v1/accounts/lookup`, `/api/v1/accounts/:id/statuses`) all return
 * `Access-Control-Allow-Origin: *`, so we can call them straight from the
 * browser with no proxy. That's a real privacy win — only the destination
 * instance sees the request.
 */

import type { FederatedFetchResult, FederatedPost } from "./types";

export type MastodonTarget =
  | { kind: "tag"; instance: string; tag: string }
  | { kind: "account"; instance: string; user: string };

/**
 * Parse a free-form Mastodon identifier. The leading sigil is required so
 * there's no ambiguity between a hashtag and a handle that share the same
 * character set (e.g. `bitcoin@mastodon.social` could be either). Accepted
 * shapes:
 *   #bitcoin@mastodon.social      → tag timeline
 *   @username@mastodon.social     → account timeline
 *   https://mastodon.social/tags/bitcoin
 *   https://mastodon.social/@username
 *
 * Bare `name@instance` inputs return `null`; callers should surface a
 * friendly hint pointing to the explicit form.
 */
export function parseMastodonTarget(raw: string): MastodonTarget | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("http")) {
    try {
      const u = new URL(trimmed);
      const tagMatch = u.pathname.match(/^\/tags?\/([^/]+)$/);
      if (tagMatch) return { kind: "tag", instance: u.hostname, tag: tagMatch[1] };
      const acctMatch = u.pathname.match(/^\/@([^/@]+)$/);
      if (acctMatch) return { kind: "account", instance: u.hostname, user: acctMatch[1] };
      return null;
    } catch {
      return null;
    }
  }

  if (trimmed.startsWith("#")) {
    const rest = trimmed.slice(1);
    const at = rest.indexOf("@");
    if (at <= 0) return null;
    const tag = rest.slice(0, at);
    const instance = rest.slice(at + 1);
    if (!isValidHost(instance) || !isValidTag(tag)) return null;
    return { kind: "tag", instance, tag };
  }

  if (trimmed.startsWith("@")) {
    const rest = trimmed.slice(1);
    const at = rest.indexOf("@");
    if (at <= 0) return null;
    const user = rest.slice(0, at);
    const instance = rest.slice(at + 1);
    if (!isValidHost(instance) || !isValidUser(user)) return null;
    return { kind: "account", instance, user };
  }

  // No leading `#` or `@` — refuse to guess. The caller's invalid-input
  // message tells the user which sigil to add.
  return null;
}

export function formatMastodonTarget(t: MastodonTarget): string {
  return t.kind === "tag" ? `#${t.tag}@${t.instance}` : `@${t.user}@${t.instance}`;
}

function isValidHost(s: string): boolean {
  return /^[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+$/.test(s);
}
function isValidTag(s: string): boolean {
  return /^[a-zA-Z0-9_]+$/.test(s);
}
function isValidUser(s: string): boolean {
  return /^[a-zA-Z0-9_.-]+$/.test(s);
}

interface MastodonStatus {
  id: string;
  uri: string;
  url?: string;
  created_at: string;
  content: string;
  spoiler_text?: string;
  account: {
    acct: string;
    username: string;
    display_name?: string;
    url: string;
  };
  media_attachments?: Array<{ url?: string; remote_url?: string; preview_url?: string }>;
  reblog?: MastodonStatus | null;
}

interface MastodonAccountLookup {
  id: string;
  acct: string;
  url: string;
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

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Mastodon fetch failed (HTTP ${res.status}) for ${url}`);
  return (await res.json()) as T;
}

function statusToPost(s: MastodonStatus): FederatedPost {
  const source = s.reblog ?? s;
  const content = htmlToPlain(source.content || "");
  const spoiler = source.spoiler_text?.trim();
  const text = spoiler ? `${spoiler}\n\n${content}` : content;
  // Mastodon doesn't have post titles; show the first short line, fall back
  // to a generic label.
  const firstLine = text.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  const title = firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine || "(status)";
  const attachments: string[] = [];
  if (Array.isArray(source.media_attachments)) {
    for (const m of source.media_attachments) {
      const u = m.url ?? m.remote_url ?? m.preview_url;
      if (typeof u === "string") attachments.push(u);
    }
  }
  return {
    id: s.uri,
    url: s.url || s.uri,
    title,
    content: text,
    authorName: source.account.acct.includes("@")
      ? `@${source.account.acct}`
      : `@${source.account.acct}@${new URL(source.account.url).hostname}`,
    authorUrl: source.account.url,
    publishedAt: Math.floor(new Date(s.created_at).getTime() / 1000),
    attachments,
  };
}

export async function fetchMastodonTimeline(
  target: MastodonTarget,
  opts: { limit?: number; signal?: AbortSignal } = {},
): Promise<FederatedFetchResult> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 40);

  if (target.kind === "tag") {
    const url =
      `https://${target.instance}/api/v1/timelines/tag/${encodeURIComponent(target.tag)}` +
      `?limit=${limit}`;
    const statuses = await fetchJson<MastodonStatus[]>(url, opts.signal);
    return {
      posts: statuses.map(statusToPost),
      source: {
        kind: "mastodon",
        instance: target.instance,
        label: `#${target.tag}@${target.instance}`,
        remoteUrl: `https://${target.instance}/tags/${encodeURIComponent(target.tag)}`,
      },
      fetchedVia: "",
      direct: true,
    };
  }

  // Account lookup → statuses
  const lookupUrl =
    `https://${target.instance}/api/v1/accounts/lookup?acct=${encodeURIComponent(target.user)}`;
  const account = await fetchJson<MastodonAccountLookup>(lookupUrl, opts.signal);
  const statusesUrl =
    `https://${target.instance}/api/v1/accounts/${account.id}/statuses` +
    `?limit=${limit}&exclude_replies=true`;
  const statuses = await fetchJson<MastodonStatus[]>(statusesUrl, opts.signal);
  return {
    posts: statuses.map(statusToPost),
    source: {
      kind: "mastodon",
      instance: target.instance,
      label: `@${target.user}@${target.instance}`,
      remoteUrl: account.url,
    },
    fetchedVia: "",
    direct: true,
  };
}
