// Persists media preferences. Today: localStorage (synchronous, simple).
// TODO (foundation task): migrate to the encrypted IndexedDB cache once available.

const AUTO_LOAD_KEY = "agora_media_auto_load";
const HOSTS_KEY = "agora_media_upload_hosts";

export const DEFAULT_UPLOAD_HOSTS = ["https://nostr.build", "https://void.cat"];

export function getAutoLoadMedia(): boolean {
  try {
    return localStorage.getItem(AUTO_LOAD_KEY) === "true";
  } catch {
    return false;
  }
}

export function setAutoLoadMedia(value: boolean): void {
  try {
    localStorage.setItem(AUTO_LOAD_KEY, value ? "true" : "false");
  } catch {
    /* ignore */
  }
}

export function getUploadHosts(): string[] {
  try {
    const raw = localStorage.getItem(HOSTS_KEY);
    if (!raw) return [...DEFAULT_UPLOAD_HOSTS];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === "string") && parsed.length > 0) {
      return parsed;
    }
  } catch {
    /* fall through */
  }
  return [...DEFAULT_UPLOAD_HOSTS];
}

export function setUploadHosts(hosts: string[]): void {
  try {
    localStorage.setItem(HOSTS_KEY, JSON.stringify(hosts));
  } catch {
    /* ignore */
  }
}
