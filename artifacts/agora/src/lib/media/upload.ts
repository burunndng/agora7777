import { discoverHost, type HostCapabilities } from "./nip96";
import { stripMetadata, type StripResult } from "./exif";
import { buildNip98AuthHeader, createEphemeralSigner, type Nip98Signer } from "./nip98";

export type HostUploadStatus =
  | { host: string; state: "pending" }
  | { host: string; state: "discovering" }
  | { host: string; state: "uploading"; progress: number }
  | { host: string; state: "ok"; url: string; sizeBytes: number }
  | { host: string; state: "error"; message: string };

export interface UploadResult {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  strip: StripResult;
  perHost: HostUploadStatus[];
  urls: string[];
}

export interface UploadOptions {
  hosts: string[];
  signer?: Nip98Signer;
  onStatus?: (status: HostUploadStatus[]) => void;
  signal?: AbortSignal;
}

interface Nip96UploadResponse {
  status?: "success" | "error" | "processing";
  message?: string;
  nip94_event?: { tags?: string[][]; content?: string };
}

function extractUrl(resp: Nip96UploadResponse): string | null {
  const tags = resp.nip94_event?.tags;
  if (!tags) return null;
  for (const t of tags) {
    if (t[0] === "url" && typeof t[1] === "string") return t[1];
  }
  return null;
}

export async function uploadToHosts(file: File, opts: UploadOptions): Promise<UploadResult> {
  const strip = await stripMetadata(file);
  const bytes = strip.bytes;
  const sizeBytes = bytes.byteLength;
  const mimeType = file.type || "application/octet-stream";

  const signer = opts.signer ?? createEphemeralSigner();
  const statuses: HostUploadStatus[] = opts.hosts.map((h) => ({ host: h, state: "pending" }));
  const emit = () => opts.onStatus?.([...statuses]);
  emit();

  const tasks = opts.hosts.map((host, idx) =>
    uploadOne(host, bytes, mimeType, file.name, signer, opts.signal, (s) => {
      statuses[idx] = s;
      emit();
    }).then(
      (s) => {
        statuses[idx] = s;
        emit();
      },
      (err: unknown) => {
        statuses[idx] = { host, state: "error", message: err instanceof Error ? err.message : String(err) };
        emit();
      },
    ),
  );

  await Promise.all(tasks);

  const urls = statuses.flatMap((s) => (s.state === "ok" ? [s.url] : []));
  return { filename: file.name, mimeType, sizeBytes, strip, perHost: statuses, urls };
}

async function uploadOne(
  host: string,
  bytes: Uint8Array,
  mimeType: string,
  filename: string,
  signer: Nip98Signer,
  signal: AbortSignal | undefined,
  onStatus: (s: HostUploadStatus) => void,
): Promise<HostUploadStatus> {
  onStatus({ host, state: "discovering" });
  let caps: HostCapabilities;
  try {
    caps = await discoverHost(host, signal);
  } catch (e) {
    return { host, state: "error", message: e instanceof Error ? e.message : "discovery failed" };
  }

  if (caps.maxBytes !== null && bytes.byteLength > caps.maxBytes) {
    return {
      host,
      state: "error",
      message: `File too large for host (${formatBytes(bytes.byteLength)} > ${formatBytes(caps.maxBytes)})`,
    };
  }
  if (caps.contentTypes.length > 0 && !caps.contentTypes.includes(mimeType)) {
    return { host, state: "error", message: `Host does not accept ${mimeType}` };
  }

  onStatus({ host, state: "uploading", progress: 0 });

  const form = new FormData();
  // Use a fresh ArrayBuffer slice so the typed-array view doesn't leak.
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([ab], { type: mimeType });
  form.append("file", blob, filename);
  form.append("size", String(bytes.byteLength));
  form.append("content_type", mimeType);

  const headers: Record<string, string> = {};
  if (caps.requiresAuth) {
    try {
      headers["Authorization"] = await buildNip98AuthHeader({
        url: caps.apiUrl,
        method: "POST",
        payload: bytes,
        signer,
      });
    } catch (e) {
      return { host, state: "error", message: `NIP-98 sign failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  const status = await uploadWithProgress(caps.apiUrl, form, headers, signal, (p) => {
    onStatus({ host, state: "uploading", progress: p });
  });
  if (!status.ok) {
    return { host, state: "error", message: `Upload failed: HTTP ${status.statusCode}` };
  }

  let parsed: Nip96UploadResponse;
  try {
    parsed = JSON.parse(status.body) as Nip96UploadResponse;
  } catch {
    return { host, state: "error", message: "Invalid JSON response from host" };
  }
  if (parsed.status === "error") {
    return { host, state: "error", message: parsed.message ?? "Host reported error" };
  }
  const url = extractUrl(parsed);
  if (!url) {
    return { host, state: "error", message: "Host response missing url tag" };
  }
  return { host, state: "ok", url, sizeBytes: bytes.byteLength };
}

interface RawResponse {
  ok: boolean;
  statusCode: number;
  body: string;
}

function uploadWithProgress(
  url: string,
  body: FormData,
  headers: Record<string, string>,
  signal: AbortSignal | undefined,
  onProgress: (p: number) => void,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url, true);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable) onProgress(evt.loaded / evt.total);
    };
    xhr.onload = () => {
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, statusCode: xhr.status, body: xhr.responseText });
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.onabort = () => reject(new Error("Upload aborted"));
    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        return;
      }
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send(body);
  });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
