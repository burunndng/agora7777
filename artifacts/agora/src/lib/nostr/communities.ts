import { useEffect, useMemo, useState } from "react";
import type { Event as NostrEvent } from "nostr-tools/core";
import { useNostrQuery, publishSigned } from "./pool";
import { useIdentityStore, useRelayStore } from "./store";

import ArgonWorker from "@/workers/argon2-worker?worker";
import type { ArgonRequest, ArgonResponse } from "@/workers/argon2-worker";

export const COMMUNITY_KIND = 34550;
/** Canonical tag name (per spec). Legacy "encryption" is also accepted on read. */
export const ENCRYPTION_TAG = "encrypted";
export const ENCRYPTION_TAG_LEGACY = "encryption";
export const ENCRYPTION_SCHEME = "agora-aes-gcm-v1";
export const ENCRYPTION_VERIFIER_TAG = "encryption-verifier";

const COMMUNITY_SALT_PREFIX = "agora.community.v1|";
const VERIFIER_PLAINTEXT = "agora-community-verify";

export type Community = {
  /** kind:34550 event id */
  id: string;
  /** Author of the kind:34550 metadata event (community creator). */
  pubkey: string;
  identifier: string;
  name: string;
  description?: string;
  image?: string;
  /** Pubkeys explicitly tagged as moderators in the community metadata. */
  moderatorPubkeys: string[];
  /** True if posts in this community are AES-GCM encrypted. */
  encrypted: boolean;
  /** base64(iv|cipher) verifier used to confirm a passphrase is correct. */
  encryptionVerifier: string | null;
  /**
   * True when the community was created from inside Agora — i.e. the
   * kind:34550 metadata event carries an `["app","agora"]` tag. Used by the
   * Communities page to group "Agora-native" rooms above the wider
   * federation list. Anyone can spoof this tag, so do NOT use it for any
   * trust / authorization decision — it is purely a UI grouping hint.
   */
  isAgora: boolean;
  createdAt: number;
};

/** Tag namespace marking a community as created inside this client. */
export const AGORA_APP_TAG = "agora";

function tagValue(event: NostrEvent, key: string): string | undefined {
  return event.tags.find((t) => t[0] === key)?.[1];
}

export function parseCommunity(event: NostrEvent): Community | null {
  if (event.kind !== COMMUNITY_KIND) return null;
  const identifier = tagValue(event, "d");
  if (!identifier) return null;
  const moderatorPubkeys: string[] = [];
  for (const t of event.tags) {
    if (t[0] === "p" && t[3] === "moderator" && t[1]) moderatorPubkeys.push(t[1]);
  }
  const encScheme =
    tagValue(event, ENCRYPTION_TAG) ?? tagValue(event, ENCRYPTION_TAG_LEGACY);
  return {
    id: event.id,
    pubkey: event.pubkey,
    identifier,
    name: tagValue(event, "name") ?? identifier,
    description: tagValue(event, "description"),
    image: tagValue(event, "image"),
    moderatorPubkeys,
    encrypted: encScheme === ENCRYPTION_SCHEME,
    encryptionVerifier: tagValue(event, ENCRYPTION_VERIFIER_TAG) ?? null,
    isAgora: tagValue(event, "app") === AGORA_APP_TAG,
    createdAt: event.created_at,
  };
}

export function useCommunity(identifier: string | null): {
  community: Community | null;
  loading: boolean;
} {
  const { events, loading } = useNostrQuery(
    identifier ? { kinds: [COMMUNITY_KIND], "#d": [identifier], limit: 5 } : null,
    [identifier],
  );
  const community = useMemo(() => {
    if (!events.length) return null;
    const newest = [...events].sort((a, b) => b.created_at - a.created_at)[0];
    return newest ? parseCommunity(newest) : null;
  }, [events]);
  return { community, loading };
}

export type PublishCommunityInput = {
  identifier: string;
  name: string;
  description?: string;
  image?: string;
  moderatorPubkeys?: string[];
  /** When provided, the community is marked encrypted. */
  encryption?: { passphrase: string; onProgress?: (p: number) => void } | null;
};

export async function publishCommunity(input: PublishCommunityInput) {
  const identity = useIdentityStore.getState().identity;
  if (!identity) throw new Error("not signed in");
  const relays = useRelayStore.getState().relays;
  const tags: string[][] = [
    ["d", input.identifier],
    ["name", input.name],
    // Marks the community as Agora-native so the Communities page can list
    // it above wider federation rooms. Spoofable — UI grouping only.
    ["app", AGORA_APP_TAG],
  ];
  if (input.description) tags.push(["description", input.description]);
  if (input.image) tags.push(["image", input.image]);
  for (const pk of input.moderatorPubkeys ?? []) {
    if (/^[0-9a-f]{64}$/i.test(pk)) {
      tags.push(["p", pk.toLowerCase(), "", "moderator"]);
    }
  }
  if (input.encryption) {
    const key = await deriveCommunityKey(
      input.encryption.passphrase,
      input.identifier,
      input.encryption.onProgress,
    );
    const verifier = await encryptString(key, VERIFIER_PLAINTEXT, input.identifier);
    tags.push([ENCRYPTION_TAG, ENCRYPTION_SCHEME]);
    tags.push([ENCRYPTION_VERIFIER_TAG, verifier]);
  }
  const signed = identity.signEvent({
    kind: COMMUNITY_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: "",
  });
  await publishSigned(signed, relays);
  return signed;
}

// ---------- Encryption helpers ---------------------------------------------

export async function deriveCommunityKey(
  passphrase: string,
  identifier: string,
  onProgress?: (p: number) => void,
): Promise<Uint8Array> {
  const worker = new ArgonWorker();
  const id = crypto.randomUUID();
  try {
    const seed = await new Promise<Uint8Array>((resolve, reject) => {
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
        salt: COMMUNITY_SALT_PREFIX + identifier,
        // Lighter than the identity KDF — communities are unlocked frequently.
        t: 2,
        m: 32768,
        p: 1,
        dkLen: 32,
      } satisfies ArgonRequest);
    });
    return seed;
  } finally {
    worker.terminate();
  }
}

async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    raw as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

function aad(identifier: string): Uint8Array {
  return new TextEncoder().encode(`agora-community|${identifier}`);
}

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function encryptString(
  rawKey: Uint8Array,
  plaintext: string,
  identifier: string,
): Promise<string> {
  const key = await importAesKey(rawKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource, additionalData: aad(identifier) as BufferSource },
    key,
    new TextEncoder().encode(plaintext) as BufferSource,
  );
  const out = new Uint8Array(iv.length + cipher.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(cipher), iv.length);
  return bytesToB64(out);
}

export async function decryptString(
  rawKey: Uint8Array,
  payload: string,
  identifier: string,
): Promise<string> {
  const all = b64ToBytes(payload);
  if (all.length < 13) throw new Error("ciphertext too short");
  const iv = all.subarray(0, 12);
  const cipher = all.subarray(12);
  const key = await importAesKey(rawKey);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource, additionalData: aad(identifier) as BufferSource },
    key,
    cipher as BufferSource,
  );
  return new TextDecoder().decode(plain);
}

export async function verifyCommunityKey(
  rawKey: Uint8Array,
  community: Pick<Community, "identifier" | "encryptionVerifier">,
): Promise<boolean> {
  if (!community.encryptionVerifier) return true;
  try {
    const plain = await decryptString(
      rawKey,
      community.encryptionVerifier,
      community.identifier,
    );
    return plain === VERIFIER_PLAINTEXT;
  } catch {
    return false;
  }
}

// ---------- Per-session key cache -------------------------------------------

/**
 * Strictly in-memory keys for the current session, keyed by community
 * identifier. We deliberately do NOT persist these to disk: the
 * passphrase-derived AES key is the only thing protecting community
 * confidentiality, so it must die with the page (and definitely die on
 * logout / identity switch).
 */
const sessionKeys = new Map<string, Uint8Array>();
const sessionKeyListeners = new Set<() => void>();

// Wipe in-memory community keys whenever the signed-in identity changes
// (login, logout, switch). Combined with no on-disk persistence, this
// guarantees that once a session ends the keys are gone.
let _prevIdentityPubkey: string | null =
  useIdentityStore.getState().identity?.pubkey ?? null;
useIdentityStore.subscribe((s) => {
  const cur = s.identity?.pubkey ?? null;
  if (cur !== _prevIdentityPubkey) {
    for (const k of sessionKeys.values()) k.fill(0);
    sessionKeys.clear();
    notifyKeyChange();
    _prevIdentityPubkey = cur;
  }
});

function notifyKeyChange() {
  for (const fn of sessionKeyListeners) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

export function rememberCommunityKey(identifier: string, key: Uint8Array) {
  sessionKeys.set(identifier, key);
  notifyKeyChange();
}

export function forgetCommunityKey(identifier: string) {
  const existing = sessionKeys.get(identifier);
  if (existing) existing.fill(0);
  sessionKeys.delete(identifier);
  notifyKeyChange();
}

export function useCommunityKey(identifier: string | null): {
  key: Uint8Array | null;
  loading: boolean;
} {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    sessionKeyListeners.add(fn);
    return () => {
      sessionKeyListeners.delete(fn);
    };
  }, []);
  return {
    key: identifier ? sessionKeys.get(identifier) ?? null : null,
    loading: false,
  };
}
