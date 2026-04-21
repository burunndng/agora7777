export interface Nip96Descriptor {
  api_url: string;
  download_url?: string;
  supported_nips?: number[];
  tos_url?: string;
  content_types?: string[];
  plans?: Record<string, {
    name?: string;
    is_nip98_required?: boolean;
    max_byte_size?: number;
    file_expiration?: [number, number];
  }>;
}

export interface HostCapabilities {
  host: string;
  apiUrl: string;
  downloadUrl?: string;
  maxBytes: number | null;
  contentTypes: string[];
  requiresAuth: boolean;
  raw: Nip96Descriptor;
}

const cache = new Map<string, { ts: number; caps: HostCapabilities }>();
const TTL_MS = 5 * 60 * 1000;

function normalizeHost(host: string): string {
  let h = host.trim();
  if (!/^https?:\/\//i.test(h)) h = "https://" + h;
  return h.replace(/\/+$/, "");
}

export async function discoverHost(host: string, signal?: AbortSignal): Promise<HostCapabilities> {
  const base = normalizeHost(host);
  const cached = cache.get(base);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.caps;

  const url = `${base}/.well-known/nostr/nip96.json`;
  const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`NIP-96 discovery failed for ${base}: HTTP ${res.status}`);
  const desc = (await res.json()) as Nip96Descriptor;
  if (!desc.api_url) throw new Error(`NIP-96 descriptor missing api_url at ${base}`);

  const apiUrl = /^https?:\/\//i.test(desc.api_url) ? desc.api_url : new URL(desc.api_url, base + "/").toString();
  const downloadUrl = desc.download_url
    ? (/^https?:\/\//i.test(desc.download_url) ? desc.download_url : new URL(desc.download_url, base + "/").toString())
    : undefined;

  let maxBytes: number | null = null;
  let requiresAuth = false;
  if (desc.plans) {
    const plans = Object.values(desc.plans);
    const free = plans.find((p) => /free/i.test(p.name ?? "")) ?? plans[0];
    if (free) {
      maxBytes = free.max_byte_size ?? null;
      requiresAuth = !!free.is_nip98_required;
    }
  }

  const caps: HostCapabilities = {
    host: base,
    apiUrl,
    downloadUrl,
    maxBytes,
    contentTypes: desc.content_types ?? [],
    requiresAuth,
    raw: desc,
  };
  cache.set(base, { ts: Date.now(), caps });
  return caps;
}

export function clearDiscoveryCache(): void {
  cache.clear();
}
