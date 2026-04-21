/**
 * Shared types for read-only federated bridges (Lemmy, Mastodon, …).
 * One normalised post shape so the UI can render any source uniformly.
 */

export type FederatedKind = "lemmy" | "mastodon";

export interface FederatedPost {
  id: string;
  url: string;
  title: string;
  content: string;
  authorName: string;
  authorUrl: string;
  publishedAt: number; // unix seconds
  attachments: string[];
}

export interface FederatedSource {
  kind: FederatedKind;
  /** Hostname of the remote instance, e.g. `lemmy.world` or `mastodon.social`. */
  instance: string;
  /** Human-readable label (community / hashtag / handle). */
  label: string;
  /** Browser URL pointing at the original timeline. */
  remoteUrl: string;
}

export interface FederatedFetchResult {
  posts: FederatedPost[];
  source: FederatedSource;
  /** Hostname that actually served the bytes. Empty string if direct. */
  fetchedVia: string;
  /** Whether the response was fetched directly (no proxy). */
  direct: boolean;
}
