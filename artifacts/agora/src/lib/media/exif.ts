export type StripResult =
  | { stripped: true; bytes: Uint8Array; format: "jpeg" | "png" | "webp" | "gif" | "heic"; removed: string[] }
  | { stripped: false; bytes: Uint8Array; format: "unknown"; reason: string };

export async function stripMetadata(file: Blob): Promise<StripResult> {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (isJpeg(buf)) return stripJpeg(buf);
  if (isPng(buf)) return stripPng(buf);
  if (isWebp(buf)) return stripWebp(buf);
  if (isGif(buf)) return stripGif(buf);
  if (isHeic(buf)) return stripHeic(buf);
  return { stripped: false, bytes: buf, format: "unknown", reason: "Unrecognized image format" };
}

function isJpeg(b: Uint8Array): boolean {
  return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

function isPng(b: Uint8Array): boolean {
  return b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a;
}

function isGif(b: Uint8Array): boolean {
  return b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46;
}

function isWebp(b: Uint8Array): boolean {
  return b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
}

function isHeic(b: Uint8Array): boolean {
  // ISOBMFF: first box must be "ftyp" with a HEIC-family major/compatible brand
  if (b.length < 12) return false;
  const boxType = String.fromCharCode(b[4], b[5], b[6], b[7]);
  if (boxType !== "ftyp") return false;
  const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
  return /^(heic|heix|hevc|hevx|heim|heis|hevm|hevs|mif1|msf1|avif|avis)$/.test(brand);
}

// Walk JPEG segments and drop APP1 (EXIF/XMP), APP13 (IPTC), APP2 (ICC retained? -> drop too for privacy),
// COM (comment). Keep SOF/SOS/DQT/DHT and entropy-coded image data byte-for-byte.
function stripJpeg(b: Uint8Array): StripResult {
  const out: number[] = [];
  const removed: string[] = [];
  // SOI
  out.push(0xff, 0xd8);
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) {
      // Should not happen in well-formed JPEG before SOS; bail by copying remainder.
      for (; i < b.length; i++) out.push(b[i]);
      break;
    }
    // Skip fill bytes
    while (i < b.length && b[i] === 0xff) i++;
    if (i >= b.length) break;
    const marker = b[i++];
    // Standalone markers (no length): RSTn (D0-D7), SOI (D8), EOI (D9), TEM (01)
    if (marker === 0xd9) {
      // EOI
      out.push(0xff, 0xd9);
      break;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(0xff, marker);
      continue;
    }
    if (i + 1 >= b.length) break;
    const len = (b[i] << 8) | b[i + 1];
    const segStart = i - 2; // includes 0xFF marker
    const segEnd = i + len; // exclusive
    if (segEnd > b.length) {
      // malformed; copy rest verbatim
      for (let k = segStart; k < b.length; k++) out.push(b[k]);
      break;
    }

    const drop = isMetadataMarker(marker, b, i + 2, len - 2, removed);
    if (!drop) {
      for (let k = segStart; k < segEnd; k++) out.push(b[k]);
    }
    i = segEnd;

    // SOS marker: image entropy-coded data follows until next non-RST marker.
    if (marker === 0xda) {
      // Copy remaining bytes verbatim including the next markers (we already wrote SOS above).
      for (; i < b.length; i++) out.push(b[i]);
      break;
    }
  }
  return { stripped: true, bytes: new Uint8Array(out), format: "jpeg", removed };
}

function isMetadataMarker(marker: number, b: Uint8Array, payloadStart: number, payloadLen: number, removed: string[]): boolean {
  // APPn = 0xE0..0xEF
  if (marker >= 0xe0 && marker <= 0xef) {
    const id = readNullString(b, payloadStart, payloadLen);
    if (marker === 0xe1 && id.startsWith("Exif")) { removed.push("APP1/Exif"); return true; }
    if (marker === 0xe1 && id.startsWith("http://ns.adobe.com/xap/")) { removed.push("APP1/XMP"); return true; }
    if (marker === 0xe1 && id.startsWith("http://ns.adobe.com/xmp/")) { removed.push("APP1/XMP"); return true; }
    if (marker === 0xed && id.startsWith("Photoshop 3.0")) { removed.push("APP13/IPTC"); return true; }
    if (marker === 0xe2 && id.startsWith("ICC_PROFILE")) { removed.push("APP2/ICC"); return true; }
    if (marker === 0xee && id.startsWith("Adobe")) { removed.push("APP14/Adobe"); return true; }
    // Unknown APPn — drop to be safe (may contain camera metadata like MakerNote variants).
    removed.push(`APP${marker - 0xe0}/${id || "unknown"}`);
    return true;
  }
  if (marker === 0xfe) { removed.push("COM"); return true; }
  return false;
}

function readNullString(b: Uint8Array, start: number, maxLen: number): string {
  let end = start;
  const limit = Math.min(start + maxLen, b.length);
  while (end < limit && b[end] !== 0x00) end++;
  return new TextDecoder("latin1").decode(b.subarray(start, end));
}

// PNG: drop ancillary text/metadata chunks (tEXt, zTXt, iTXt, eXIf, tIME). Keep IHDR, PLTE, IDAT, IEND, etc.
function stripPng(b: Uint8Array): StripResult {
  const out: number[] = [];
  const removed: string[] = [];
  for (let k = 0; k < 8; k++) out.push(b[k]);
  let i = 8;
  const drops = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);
  while (i + 8 <= b.length) {
    const len = (b[i] << 24 | b[i + 1] << 16 | b[i + 2] << 8 | b[i + 3]) >>> 0;
    const typeBytes = b.subarray(i + 4, i + 8);
    const type = String.fromCharCode(typeBytes[0], typeBytes[1], typeBytes[2], typeBytes[3]);
    const chunkEnd = i + 8 + len + 4; // length + type + data + crc
    if (chunkEnd > b.length) break;
    if (drops.has(type)) {
      removed.push(type);
    } else {
      for (let k = i; k < chunkEnd; k++) out.push(b[k]);
    }
    i = chunkEnd;
    if (type === "IEND") break;
  }
  return { stripped: true, bytes: new Uint8Array(out), format: "png", removed };
}

// ─── WebP ────────────────────────────────────────────────────────────────────
// RIFF layout: "RIFF" (4) + fileSize LE (4) + "WEBP" (4) + chunks…
// Each chunk: FourCC (4) + dataSize LE (4) + data (padded to even length)
// Strip EXIF and XMP_ chunks; keep everything else.
function stripWebp(b: Uint8Array): StripResult {
  if (b.length < 12) return { stripped: true, bytes: b, format: "webp", removed: [] };

  const removed: string[] = [];
  const out: number[] = [];

  // Write RIFF + placeholder size + WEBP
  out.push(0x52, 0x49, 0x46, 0x46); // "RIFF"
  const fileSizeOffset = out.length;
  out.push(0, 0, 0, 0); // placeholder for file size (LE)
  out.push(0x57, 0x45, 0x42, 0x50); // "WEBP"

  let i = 12;
  while (i + 8 <= b.length) {
    const fourCC = String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
    const dataSize = b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | ((b[i + 7] & 0x7f) << 24);
    const paddedSize = dataSize + (dataSize & 1); // RIFF pads chunks to even byte boundary
    const chunkEnd = i + 8 + paddedSize;

    if (chunkEnd > b.length) {
      // Malformed / truncated chunk; copy remainder verbatim
      for (let k = i; k < b.length; k++) out.push(b[k]);
      break;
    }

    if (fourCC === "EXIF") {
      removed.push("EXIF");
    } else if (fourCC === "XMP ") {
      removed.push("XMP");
    } else {
      for (let k = i; k < chunkEnd; k++) out.push(b[k]);
    }

    i = chunkEnd;
  }

  // Patch the RIFF file-size field (= total bytes after the 8-byte RIFF header)
  const fileSize = out.length - 8;
  out[fileSizeOffset]     = fileSize & 0xff;
  out[fileSizeOffset + 1] = (fileSize >> 8) & 0xff;
  out[fileSizeOffset + 2] = (fileSize >> 16) & 0xff;
  out[fileSizeOffset + 3] = (fileSize >> 24) & 0xff;

  return { stripped: true, bytes: new Uint8Array(out), format: "webp", removed };
}

// ─── GIF ─────────────────────────────────────────────────────────────────────
// Strip Comment Extension (0x21 0xFE) and Application Extension blocks whose
// app identifier is "XMP Data" (Adobe XMP).  Keep Netscape/ANIMEXTS and all
// other extensions so animation still works.
function stripGif(b: Uint8Array): StripResult {
  if (b.length < 13) return { stripped: true, bytes: b, format: "gif", removed: [] };

  const removed: string[] = [];
  const out: number[] = [];

  // GIF header (6) + Logical Screen Descriptor (7)
  for (let k = 0; k < 13; k++) out.push(b[k]);

  // Global Color Table (optional)
  const lsdPacked = b[10];
  const hasGCT = (lsdPacked & 0x80) !== 0;
  const gctBytes = hasGCT ? 3 * (1 << ((lsdPacked & 0x07) + 1)) : 0;
  for (let k = 13; k < 13 + gctBytes && k < b.length; k++) out.push(b[k]);

  let i = 13 + gctBytes;

  while (i < b.length) {
    const introducer = b[i];

    // Trailer
    if (introducer === 0x3b) { out.push(0x3b); break; }

    // Image Descriptor
    if (introducer === 0x2c) {
      if (i + 10 > b.length) break;
      for (let k = i; k < i + 10; k++) out.push(b[k]);
      const imgPacked = b[i + 9];
      const hasLCT = (imgPacked & 0x80) !== 0;
      const lctBytes = hasLCT ? 3 * (1 << ((imgPacked & 0x07) + 1)) : 0;
      i += 10;
      // Local Color Table
      for (let k = i; k < i + lctBytes && k < b.length; k++) out.push(b[k]);
      i += lctBytes;
      // LZW minimum code size
      if (i >= b.length) break;
      out.push(b[i++]);
      // Image sub-blocks
      i = copySubBlocks(b, i, out);
      continue;
    }

    // Extension block
    if (introducer === 0x21) {
      if (i + 2 > b.length) break;
      const label = b[i + 1];

      // Comment Extension — strip
      if (label === 0xfe) {
        removed.push("Comment");
        i += 2;
        i = skipSubBlocks(b, i);
        continue;
      }

      // Application Extension
      if (label === 0xff && i + 14 <= b.length) {
        const blockSize = b[i + 2]; // always 11
        if (blockSize === 11) {
          const appId = String.fromCharCode(
            b[i + 3], b[i + 4], b[i + 5], b[i + 6],
            b[i + 7], b[i + 8], b[i + 9], b[i + 10]
          );
          const authCode = String.fromCharCode(b[i + 11], b[i + 12], b[i + 13]);

          if (appId === "XMP Data" && authCode === "XMP") {
            removed.push("XMP");
            i += 2 + 1 + blockSize; // introducer + label + blockSize byte + blockSize data bytes
            i = skipSubBlocks(b, i);
            continue;
          }
        }
      }

      // Keep all other extensions (Netscape loop, ANIMEXTS, Graphic Control, etc.)
      out.push(b[i++]); // 0x21
      out.push(b[i++]); // label
      i = copySubBlocks(b, i, out);
      continue;
    }

    // Unknown byte — stop parsing, copy remainder
    for (; i < b.length; i++) out.push(b[i]);
    break;
  }

  return { stripped: true, bytes: new Uint8Array(out), format: "gif", removed };
}

/** Copy GIF sub-blocks to output; returns new position after terminator. */
function copySubBlocks(b: Uint8Array, i: number, out: number[]): number {
  while (i < b.length) {
    const size = b[i];
    out.push(b[i++]);
    if (size === 0) break;
    for (let k = 0; k < size && i < b.length; k++) out.push(b[i++]);
  }
  return i;
}

/** Skip GIF sub-blocks without copying; returns new position after terminator. */
function skipSubBlocks(b: Uint8Array, i: number): number {
  while (i < b.length) {
    const size = b[i++];
    if (size === 0) break;
    i += size;
  }
  return i;
}

// ─── HEIC (ISOBMFF) ──────────────────────────────────────────────────────────
// Strip EXIF and XMP items from the ISOBMFF container without re-encoding.
//
// Strategy (in-place neutralization — safe, no offset rebasing needed):
//   1. Walk the top-level boxes to locate the `meta` box.
//   2. Within `meta`, parse `iinf` to find item IDs with type "Exif" or "mime"
//      (XMP is stored as a mime item with content-type "application/rdf+xml").
//   3. Parse `iloc` to find the absolute byte extents of those items.
//   4. Copy the entire file buffer, then zero out only those payload byte ranges.
//      All box sizes, offsets, and structural fields remain exactly the same,
//      so the file stays valid and decodable.
//   5. Also zero out top-level `uuid` boxes with the Adobe XMP UUID.
//
// This preserves pixel data and all structural boxes intact.

const ADOBE_XMP_UUID = new Uint8Array([
  0xbe, 0x7a, 0xcf, 0xcb, 0x97, 0xa9, 0x42, 0xe8,
  0x9c, 0x71, 0x99, 0x94, 0x91, 0xe3, 0xaf, 0xac,
]);

function stripHeic(b: Uint8Array): StripResult {
  const removed: string[] = [];

  // ── Pass 1: locate metadata item extents ────────────────────────────────
  // Collect absolute file offsets to zero out; never change box sizes or
  // offset fields so all iloc references remain valid after stripping.
  const metaItemIds = new Set<number>();
  const zeroRanges: Array<{ start: number; end: number }> = [];

  const topBoxes = parseIsobmffBoxes(b, 0, b.length);

  for (const box of topBoxes) {
    // Adobe XMP UUID box at top level — zero its payload
    if (box.type === "uuid" && box.end >= box.start + box.headerLen + 16) {
      const uuid = b.subarray(box.start + box.headerLen, box.start + box.headerLen + 16);
      if (uuidEquals(uuid, ADOBE_XMP_UUID)) {
        removed.push("XMP");
        // Zero the payload (after the 16-byte UUID) so XMP data is gone
        const payloadStart = box.start + box.headerLen + 16;
        if (payloadStart < box.end) zeroRanges.push({ start: payloadStart, end: box.end });
      }
    }

    if (box.type !== "meta") continue;

    // `meta` is a FullBox: 4-byte version+flags immediately after box header
    const metaDataStart = box.start + box.headerLen + 4;
    const metaSubBoxes = parseIsobmffBoxes(b, metaDataStart, box.end);

    const iinfBox = metaSubBoxes.find((x) => x.type === "iinf");
    const ilocBox = metaSubBoxes.find((x) => x.type === "iloc");

    // ── Parse iinf to find Exif / XMP item IDs ───────────────────────────
    if (iinfBox) {
      const iinfVersion = b[iinfBox.start + iinfBox.headerLen];
      const countOffset = iinfBox.start + iinfBox.headerLen + 4; // skip version+flags
      const entriesStart = countOffset + (iinfVersion < 2 ? 2 : 4);
      const infeBoxes = parseIsobmffBoxes(b, entriesStart, iinfBox.end);

      for (const infe of infeBoxes) {
        if (infe.type !== "infe") continue;
        const infeVersion = b[infe.start + infe.headerLen];
        // item_type only present in infe v2+
        if (infeVersion < 2) continue;

        const base = infe.start + infe.headerLen + 4; // skip version+flags
        const itemId = (b[base] << 8) | b[base + 1];
        // item_protection_index (2 bytes) then item_type (4 bytes)
        const itemType = String.fromCharCode(b[base + 4], b[base + 5], b[base + 6], b[base + 7]);

        if (itemType === "Exif") {
          metaItemIds.add(itemId);
          removed.push("Exif");
        } else if (itemType === "mime") {
          // content_type is the second null-terminated string after item_name
          let p = base + 8; // past item_type
          while (p < infe.end && b[p] !== 0) p++; // skip item_name
          p++; // skip null terminator
          const ctStart = p;
          while (p < infe.end && b[p] !== 0) p++;
          const ct = new TextDecoder("latin1").decode(b.subarray(ctStart, p));
          if (ct.includes("rdf+xml") || ct.includes("xmp")) {
            metaItemIds.add(itemId);
            removed.push("XMP");
          }
        }
      }
    }

    // ── Parse iloc to map item IDs → file byte extents ───────────────────
    if (ilocBox && metaItemIds.size > 0) {
      const ilocBase = ilocBox.start + ilocBox.headerLen + 4; // skip version+flags
      const ilocVersion = b[ilocBox.start + ilocBox.headerLen];
      const packed = b[ilocBase];
      const offsetSize = (packed >> 4) & 0x0f;
      const lengthSize = packed & 0x0f;
      const packed2 = b[ilocBase + 1];
      const baseOffsetSize = (packed2 >> 4) & 0x0f;
      // index_size only in iloc v1/v2
      const indexSize = (ilocVersion === 1 || ilocVersion === 2) ? (packed2 & 0x0f) : 0;

      const itemCountOffset = ilocBase + 2;
      let p: number;
      let itemCount: number;
      if (ilocVersion < 2) {
        itemCount = (b[itemCountOffset] << 8) | b[itemCountOffset + 1];
        p = itemCountOffset + 2;
      } else {
        itemCount = (b[itemCountOffset] << 24 | b[itemCountOffset + 1] << 16 |
          b[itemCountOffset + 2] << 8 | b[itemCountOffset + 3]) >>> 0;
        p = itemCountOffset + 4;
      }

      for (let n = 0; n < itemCount && p + 4 <= ilocBox.end; n++) {
        let itemId: number;
        if (ilocVersion < 2) {
          itemId = (b[p] << 8) | b[p + 1]; p += 2;
        } else {
          itemId = (b[p] << 24 | b[p + 1] << 16 | b[p + 2] << 8 | b[p + 3]) >>> 0; p += 4;
        }

        let constructionMethod = 0;
        if (ilocVersion === 1 || ilocVersion === 2) {
          constructionMethod = b[p + 1] & 0x0f; // lower nibble of 16-bit field
          p += 2;
        }
        p += 2; // data_reference_index
        const baseOffset = readUintN(b, p, baseOffsetSize); p += baseOffsetSize;
        const extentCount = (b[p] << 8) | b[p + 1]; p += 2;

        for (let e = 0; e < extentCount; e++) {
          if (indexSize > 0) p += indexSize;
          const extentOffset = readUintN(b, p, offsetSize); p += offsetSize;
          const extentLength = readUintN(b, p, lengthSize); p += lengthSize;

          // Only zero file-based extents (construction_method == 0)
          if (metaItemIds.has(itemId) && constructionMethod === 0 && extentLength > 0n) {
            const absStart = Number(baseOffset + extentOffset);
            const absEnd = absStart + Number(extentLength);
            if (absStart < b.length) zeroRanges.push({ start: absStart, end: Math.min(absEnd, b.length) });
          }
        }
      }
    }
  }

  if (removed.length === 0) {
    return { stripped: true, bytes: b, format: "heic", removed: [] };
  }

  // ── Pass 2: copy buffer and zero out identified ranges ───────────────────
  // All box sizes and offset fields remain byte-for-byte identical — the file
  // stays structurally valid and decodable; only payload content is zeroed.
  const out = new Uint8Array(b);
  for (const range of zeroRanges) {
    out.fill(0, range.start, range.end);
  }

  return { stripped: true, bytes: out, format: "heic", removed };
}

// ─── ISOBMFF helpers ─────────────────────────────────────────────────────────

interface IsobmffBox { type: string; start: number; headerLen: number; end: number; }

function parseIsobmffBoxes(b: Uint8Array, from: number, to: number): IsobmffBox[] {
  const boxes: IsobmffBox[] = [];
  let i = from;
  while (i + 8 <= to) {
    const size32 = (b[i] << 24 | b[i + 1] << 16 | b[i + 2] << 8 | b[i + 3]) >>> 0;
    const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    let headerLen = 8;
    let end: number;

    if (size32 === 0) {
      end = to; // box extends to end of container
    } else if (size32 === 1) {
      // 64-bit extended size
      if (i + 16 > to) break;
      const hi = (b[i + 8] << 24 | b[i + 9] << 16 | b[i + 10] << 8 | b[i + 11]) >>> 0;
      const lo = (b[i + 12] << 24 | b[i + 13] << 16 | b[i + 14] << 8 | b[i + 15]) >>> 0;
      headerLen = 16;
      end = i + hi * 0x100000000 + lo;
    } else {
      end = i + size32;
    }

    if (end > to || end <= i) break;
    boxes.push({ type, start: i, headerLen, end });
    i = end;
  }
  return boxes;
}

/** Read an unsigned big-endian integer of `n` bytes (0–8) as BigInt. */
function readUintN(b: Uint8Array, offset: number, n: number): bigint {
  if (n === 0) return 0n;
  let v = 0n;
  for (let i = 0; i < n && offset + i < b.length; i++) {
    v = (v << 8n) | BigInt(b[offset + i]);
  }
  return v;
}

function uuidEquals(a: Uint8Array, expected: Uint8Array): boolean {
  for (let i = 0; i < 16; i++) if (a[i] !== expected[i]) return false;
  return true;
}
