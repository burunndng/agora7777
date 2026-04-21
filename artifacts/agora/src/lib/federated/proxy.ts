/**
 * Multi-proxy fetch helper for cross-origin reads.
 *
 * Some federated instances (Lemmy in particular) do not enable CORS on their
 * public read endpoints, so we have to route through a public CORS proxy. Free
 * proxies come and go, so we try a small ordered list and remember which one
 * worked so the privacy footer can be honest.
 *
 * We always try a direct fetch first — if the instance happens to allow CORS
 * (Mastodon does on its public endpoints, and a handful of Lemmy instances
 * have started enabling it too) then no third party gets to see the request.
 */

export interface ProxyAttempt {
  /** Hostname that served the bytes; empty when the fetch went direct. */
  via: string;
  direct: boolean;
}

export interface ProxiedResponse<T> {
  data: T;
  attempt: ProxyAttempt;
}

const PROXY_BUILDERS: Array<{ host: string; build: (url: string) => string }> = [
  {
    host: "api.allorigins.win",
    build: (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  },
  {
    host: "corsproxy.org",
    build: (url) => `https://corsproxy.org/?${encodeURIComponent(url)}`,
  },
  {
    host: "cors.eu.org",
    build: (url) => `https://cors.eu.org/${url}`,
  },
];

export const PROXY_HOSTS: readonly string[] = PROXY_BUILDERS.map((p) => p.host);

export interface FetchJsonOptions {
  signal?: AbortSignal;
  /** Sent as the Accept header on every attempt. */
  accept?: string;
  /** If true, skip the direct attempt and go straight to proxies. */
  proxyOnly?: boolean;
}

async function tryFetchJson(
  url: string,
  accept: string,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  const res = await fetch(url, {
    signal,
    headers: { Accept: accept },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  // Some proxies pass through the upstream content-type, others always say
  // text/plain. Parse defensively.
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Response was not valid JSON");
  }
}

/**
 * Fetch JSON, trying direct first then each proxy in order. Throws an Error
 * with a combined message if every attempt fails.
 */
export async function fetchJsonWithFallback<T = unknown>(
  url: string,
  opts: FetchJsonOptions = {},
): Promise<ProxiedResponse<T>> {
  const accept = opts.accept ?? "application/json";
  const errors: string[] = [];

  if (!opts.proxyOnly) {
    try {
      const data = (await tryFetchJson(url, accept, opts.signal)) as T;
      return { data, attempt: { via: "", direct: true } };
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      errors.push(`direct: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  for (const p of PROXY_BUILDERS) {
    try {
      const data = (await tryFetchJson(p.build(url), accept, opts.signal)) as T;
      return { data, attempt: { via: p.host, direct: false } };
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      errors.push(`${p.host}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(`All fetch attempts failed (${errors.join("; ")})`);
}
