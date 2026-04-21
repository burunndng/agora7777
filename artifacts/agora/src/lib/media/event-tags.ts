import type { Event as NostrEvent } from "nostr-tools/core";

// Each attachment is encoded as a NIP-92 imeta tag:
//   ["imeta", "url <primary>", "url <fallback>", "size <bytes>", "m <mime>", "name <filename>"]
// Multiple `url` entries inside the same imeta tag are mirrors of the same file.
// Returns an array of "mirror1 mirror2" strings (whitespace-joined) for MediaList.
export function extractMediaUrls(event: NostrEvent): string[] {
  const out: string[] = [];
  for (const tag of event.tags) {
    if (tag[0] !== "imeta") continue;
    const mirrors: string[] = [];
    for (let i = 1; i < tag.length; i++) {
      const entry = tag[i];
      if (typeof entry !== "string") continue;
      const sp = entry.indexOf(" ");
      if (sp < 0) continue;
      const k = entry.slice(0, sp);
      const v = entry.slice(sp + 1).trim();
      if (k === "url" && v) mirrors.push(v);
    }
    if (mirrors.length > 0) out.push(mirrors.join(" "));
  }
  return out;
}

export function buildImetaTag(opts: { mirrors: string[]; mimeType?: string; sizeBytes?: number; filename?: string }): string[] {
  const tag: string[] = ["imeta"];
  for (const u of opts.mirrors) tag.push(`url ${u}`);
  if (opts.mimeType) tag.push(`m ${opts.mimeType}`);
  if (typeof opts.sizeBytes === "number") tag.push(`size ${opts.sizeBytes}`);
  if (opts.filename) tag.push(`name ${opts.filename}`);
  return tag;
}
