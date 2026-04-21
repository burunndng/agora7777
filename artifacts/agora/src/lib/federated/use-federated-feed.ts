import { useEffect, useState } from "react";
import { fetchLemmyCommunity, parseLemmyTarget } from "./lemmy";
import { fetchMastodonTimeline, parseMastodonTarget } from "./mastodon";
import type { FederatedFetchResult, FederatedKind } from "./types";

export interface FederatedFeedState {
  data: FederatedFetchResult | null;
  loading: boolean;
  error: string | null;
  /** True when the identifier could not be parsed for the given kind. */
  invalid: boolean;
}

export function useFederatedFeed(
  kind: FederatedKind,
  identifier: string | null,
  limit = 20,
): FederatedFeedState {
  const [state, setState] = useState<FederatedFeedState>({
    data: null,
    loading: !!identifier,
    error: null,
    invalid: false,
  });

  useEffect(() => {
    if (!identifier) {
      setState({ data: null, loading: false, error: null, invalid: false });
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const run = async (): Promise<FederatedFetchResult> => {
      if (kind === "lemmy") {
        const target = parseLemmyTarget(identifier);
        if (!target) throw new Error("__invalid__");
        return fetchLemmyCommunity(target, { limit, signal: controller.signal });
      }
      const target = parseMastodonTarget(identifier);
      if (!target) throw new Error("__invalid__");
      return fetchMastodonTimeline(target, { limit, signal: controller.signal });
    };
    setState((prev) => ({ ...prev, loading: true, error: null, invalid: false }));
    run()
      .then((res) => {
        if (cancelled) return;
        setState({ data: res, loading: false, error: null, invalid: false });
      })
      .catch((err: unknown) => {
        if (cancelled || controller.signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === "__invalid__") {
          setState({ data: null, loading: false, error: null, invalid: true });
        } else {
          setState({ data: null, loading: false, error: msg, invalid: false });
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [kind, identifier, limit]);

  return state;
}
