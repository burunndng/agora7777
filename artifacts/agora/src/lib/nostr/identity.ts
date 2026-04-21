import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { getPublicKey, finalizeEvent } from "nostr-tools/pure";
import type { Event as NostrEvent, EventTemplate, VerifiedEvent } from "nostr-tools/core";
import { nip19 } from "nostr-tools";
import { wrapManyEvents, unwrapEvent } from "nostr-tools/nip59";

import { hexToNpub } from "./format";

import ArgonWorker from "@/workers/argon2-worker?worker";
import type { ArgonRequest, ArgonResponse } from "@/workers/argon2-worker";

export type DMRumor = {
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  id?: string;
};

/**
 * Legacy v1 salt — used by accounts created before the per-user salt
 * rollout (Apr 2026). Kept for one release so existing users can recover
 * their key via the "Legacy login" path; will be removed thereafter.
 */
const LEGACY_SALT_V1 = "agora.nostr.v1.passphrase-salt";
const SALT_PREFIX_V2 = "agora.nostr.v2|handle=";
const KDF_NOSTR_KEY = "agora/nostr-signing-key/v1";
const KDF_CACHE_KEY = "agora/cache-encryption-key/v1";

export function normalizeHandle(handle: string): string {
  return handle.normalize("NFKC").trim().toLowerCase();
}

export function isValidHandle(handle: string): boolean {
  const norm = normalizeHandle(handle);
  if (norm.length < 3 || norm.length > 64) return false;
  // Conservative charset: letters, digits, dot, dash, underscore, @ for
  // people who want to type a NIP-05-style identifier as their handle.
  return /^[a-z0-9._@\-]+$/.test(norm);
}

function deriveSubkey(seed: Uint8Array, label: string): Uint8Array {
  const out = hmac(sha256, seed, new TextEncoder().encode(label));
  return new Uint8Array(out);
}

function wipe(buf: Uint8Array | undefined) {
  if (buf) buf.fill(0);
}

export type Identity = {
  npub: `npub1${string}`;
  pubkey: string;
  /**
   * Normalized handle the user typed at login (NFKC + lowercased + trimmed),
   * or `null` for legacy v1 logins which have no handle. Never published to
   * relays — used only for client-side role checks (admin = handle "admin").
   */
  handle: string | null;
  signEvent: (template: EventTemplate) => VerifiedEvent;
  /**
   * Return the bech32-encoded nsec (NIP-19) for this identity. Used by the
   * "Backup signing key" flow in Settings so the user can save their key
   * out-of-band (e.g. paper backup, password manager). The returned string
   * carries the raw private key — treat it as toxic: never log, never send
   * to a relay, never persist to storage that survives logout.
   */
  exportNsec: () => `nsec1${string}`;
  /**
   * Wrap a NIP-17 chat message (kind:14) for both the recipient and the sender
   * using NIP-59 gift-wrap. Returns the array of kind:1059 wrap events.
   * Timestamps are randomized within ±48h by nostr-tools (NIP-59 spec).
   */
  wrapDM: (recipientPubkey: string, message: string) => NostrEvent[];
  /**
   * Unwrap a kind:1059 NIP-59 gift-wrap addressed to this identity. Returns
   * the inner rumor (typically a kind:14 chat message).
   */
  unwrapDM: (wrap: NostrEvent) => DMRumor;
  cacheKey: Uint8Array;
  destroy: () => void;
};

export type DeriveProgress = (progress: number) => void;

export type DeriveOptions = {
  /**
   * If set, derive using the legacy v1 single-shared salt instead of the
   * per-user salt. Used by the "Legacy login" path during the v1→v2
   * migration window. The v1 path will be removed in a future release.
   */
  legacy?: boolean;
};

export async function deriveIdentity(
  passphrase: string,
  handle: string,
  onProgress?: DeriveProgress,
  options: DeriveOptions = {},
): Promise<Identity> {
  const legacy = options.legacy === true;
  let salt: string;
  if (legacy) {
    salt = LEGACY_SALT_V1;
  } else {
    if (!isValidHandle(handle)) {
      throw new Error(
        "Invalid handle. Use 3–64 chars: letters, digits, '.', '-', '_', '@'.",
      );
    }
    salt = SALT_PREFIX_V2 + normalizeHandle(handle);
  }

  const worker = new ArgonWorker();
  const id = crypto.randomUUID();
  let seed: Uint8Array | null = null;
  try {
    seed = await new Promise<Uint8Array>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<ArgonResponse>) => {
        const msg = e.data;
        if (msg.id !== id) return;
        if (msg.type === "progress") onProgress?.(msg.progress);
        else if (msg.type === "result") resolve(new Uint8Array(msg.seed));
        else if (msg.type === "error") reject(new Error(msg.error));
      };
      worker.onerror = (err) => reject(err);
      worker.postMessage({
        id,
        passphrase,
        salt,
        t: 3,
        m: 65536,
        p: 1,
        dkLen: 32,
      } satisfies ArgonRequest);
    });
  } finally {
    worker.terminate();
  }

  const nostrKey = deriveSubkey(seed, KDF_NOSTR_KEY);
  const cacheKey = deriveSubkey(seed, KDF_CACHE_KEY);
  wipe(seed);

  const pubkey = getPublicKey(nostrKey);
  const npub = nip19.npubEncode(pubkey) as `npub1${string}`;

  let secret: Uint8Array | null = nostrKey;

  const signEvent = (template: EventTemplate): VerifiedEvent => {
    if (!secret) throw new Error("identity destroyed");
    return finalizeEvent(template, secret);
  };

  const exportNsec = (): `nsec1${string}` => {
    if (!secret) throw new Error("identity destroyed");
    return nip19.nsecEncode(secret) as `nsec1${string}`;
  };

  const wrapDM = (recipientPubkey: string, message: string): NostrEvent[] => {
    if (!secret) throw new Error("identity destroyed");
    // wrapManyEvents returns: [wrap-for-self, wrap-for-recipient1, ...]
    // Inner rumor uses kind:14 (NIP-17 chat). nostr-tools randomizes
    // created_at on both seal and wrap within ±48h per NIP-59.
    return wrapManyEvents(
      { kind: 14, content: message, tags: [["p", recipientPubkey]] },
      secret,
      [recipientPubkey],
    );
  };

  const unwrapDM = (wrap: NostrEvent): DMRumor => {
    if (!secret) throw new Error("identity destroyed");
    return unwrapEvent(wrap, secret) as DMRumor;
  };

  const destroy = () => {
    if (secret) wipe(secret);
    secret = null;
    wipe(cacheKey);
  };

  const handleOut = legacy ? null : normalizeHandle(handle);
  return {
    npub,
    pubkey,
    handle: handleOut,
    signEvent,
    exportNsec,
    wrapDM,
    unwrapDM,
    cacheKey,
    destroy,
  };
}
