/**
 * Wrapper around `navigator.storage.persist()` so callers don't have to
 * type-guard the API every time. Returns the resulting persistence state, or
 * null when the browser doesn't support the API at all.
 */
export type PersistState = "granted" | "denied" | "unsupported";

export async function requestPersistentStorage(): Promise<PersistState> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) {
    return "unsupported";
  }
  try {
    const granted = await navigator.storage.persist();
    return granted ? "granted" : "denied";
  } catch {
    return "denied";
  }
}

export async function isStoragePersisted(): Promise<PersistState> {
  if (typeof navigator === "undefined" || !navigator.storage?.persisted) {
    return "unsupported";
  }
  try {
    const persisted = await navigator.storage.persisted();
    return persisted ? "granted" : "denied";
  } catch {
    return "denied";
  }
}

export async function estimateStorage(): Promise<{
  usage: number | null;
  quota: number | null;
}> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
    return { usage: null, quota: null };
  }
  try {
    const est = await navigator.storage.estimate();
    return { usage: est.usage ?? null, quota: est.quota ?? null };
  } catch {
    return { usage: null, quota: null };
  }
}
