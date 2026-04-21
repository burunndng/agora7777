import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate } from "nostr-tools/pure";
import { bytesToHex } from "@noble/hashes/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";

export interface Nip98Signer {
  sign(template: EventTemplate): Promise<string> | string;
}

// Ephemeral signer: generates a fresh keypair per session, used when the user
// has no Nostr identity yet (foundation task ships the real one). Hosts that
// require NIP-98 still get a valid signed auth event; the upload simply isn't
// linked to the user's main pubkey.
export function createEphemeralSigner(): Nip98Signer {
  const sk = generateSecretKey();
  return {
    sign(template) {
      const event = finalizeEvent(template, sk);
      return JSON.stringify(event);
    },
  };
}

export function ephemeralPubkeyHex(): string {
  const sk = generateSecretKey();
  return getPublicKey(sk);
}

export async function buildNip98AuthHeader(opts: {
  url: string;
  method: string;
  payload?: Uint8Array;
  signer: Nip98Signer;
}): Promise<string> {
  const tags: string[][] = [
    ["u", opts.url],
    ["method", opts.method.toUpperCase()],
  ];
  if (opts.payload && opts.payload.length > 0) {
    tags.push(["payload", bytesToHex(sha256(opts.payload))]);
  }
  const template: EventTemplate = {
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: "",
  };
  const signedJson = await opts.signer.sign(template);
  const b64 = typeof btoa !== "undefined"
    ? btoa(unescape(encodeURIComponent(signedJson)))
    : Buffer.from(signedJson, "utf8").toString("base64");
  return `Nostr ${b64}`;
}
