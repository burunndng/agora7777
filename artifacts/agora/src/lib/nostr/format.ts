import { nip19 } from "nostr-tools";

export function hexToNpub(hex: string): string {
  try {
    return nip19.npubEncode(hex);
  } catch {
    return hex;
  }
}

export function npubToHex(npub: string): string | null {
  try {
    const decoded = nip19.decode(npub);
    if (decoded.type === "npub") return decoded.data;
    if (decoded.type === "nprofile") return decoded.data.pubkey;
    return null;
  } catch {
    return null;
  }
}

export function shortNpub(npub: string | null | undefined): string {
  if (!npub) return "";
  if (!npub.startsWith("npub")) {
    const enc = npub.length === 64 ? hexToNpub(npub) : npub;
    return shortNpub(enc);
  }
  if (npub.length <= 16) return npub;
  return `${npub.slice(0, 9)}…${npub.slice(-4)}`;
}

export function authorLabel(
  hexOrNpub: string | null | undefined,
  displayName?: string | null,
): string {
  if (!hexOrNpub) return "anonymous";
  const npub = hexOrNpub.startsWith("npub") ? hexOrNpub : hexToNpub(hexOrNpub);
  const short = shortNpub(npub);
  const name = (displayName || "").trim();
  return name ? `${name} (${short})` : short;
}
