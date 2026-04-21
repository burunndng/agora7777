import { useEffect, useState } from "react";
import { getNip05Verification } from "./preferences";

export type Nip05Status = "idle" | "checking" | "verified" | "mismatch" | "error";

const cache = new Map<string, { status: Nip05Status; checkedAt: number }>();
const TTL_MS = 10 * 60 * 1000;
const TTL_NEGATIVE_MS = 60 * 60 * 1000;

const NIP05_RE = /^[A-Za-z0-9_.\-]+@[A-Za-z0-9_.\-]+\.[A-Za-z]{2,}$/;

export function isValidNip05(value: string | undefined | null): boolean {
  if (!value) return false;
  return NIP05_RE.test(value);
}

/**
 * Verify a NIP-05 identifier maps to the given pubkey by fetching
 * `https://<domain>/.well-known/nostr.json?name=<local>`.
 *
 * Note: this fetch leaks the user's IP to an attacker-controllable domain.
 * Callers should respect the user's `getNip05Verification()` opt-in for any
 * background / passive verification (the `useNip05Verification` hook does
 * this for you). When the toggle is off the production CSP also restricts
 * `connect-src`, so even a manual call here will fail with a network
 * error in production until the user re-enables verification and reloads.
 */
export async function verifyNip05(
  nip05: string,
  expectedPubkey: string,
): Promise<Nip05Status> {
  if (!isValidNip05(nip05)) return "error";
  const [localPart, domain] = nip05.split("@");
  const local = localPart.toLowerCase();
  const url = `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(local)}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      // No credentials, no cookies sent.
      credentials: "omit",
      mode: "cors",
    });
    if (!res.ok) return "error";
    const json = (await res.json()) as { names?: Record<string, string> };
    const found = json.names?.[local];
    if (!found) return "mismatch";
    return found.toLowerCase() === expectedPubkey.toLowerCase()
      ? "verified"
      : "mismatch";
  } catch {
    return "error";
  }
}

export function useNip05Verification(
  nip05: string | undefined | null,
  pubkey: string | undefined | null,
): Nip05Status {
  const [status, setStatus] = useState<Nip05Status>("idle");

  useEffect(() => {
    if (!nip05 || !pubkey || !isValidNip05(nip05)) {
      setStatus("idle");
      return;
    }
    // Privacy-by-default: do not silently fetch arbitrary domains for every
    // rendered profile. The user must opt in via Settings → Privacy.
    if (!getNip05Verification()) {
      setStatus("idle");
      return;
    }
    const key = `${nip05}::${pubkey}`;
    const hit = cache.get(key);
    if (hit) {
      const ttl = hit.status === "verified" ? TTL_MS : TTL_NEGATIVE_MS;
      if (Date.now() - hit.checkedAt < ttl) {
        setStatus(hit.status);
        return;
      }
    }
    let cancelled = false;
    setStatus("checking");
    verifyNip05(nip05, pubkey).then((s) => {
      cache.set(key, { status: s, checkedAt: Date.now() });
      if (!cancelled) setStatus(s);
    });
    return () => {
      cancelled = true;
    };
  }, [nip05, pubkey]);

  return status;
}
