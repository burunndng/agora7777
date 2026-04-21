import { SEND_INSTANCES, pickRandomSendInstance } from "./instances";

/**
 * Send v3 protocol client.
 *
 * Implements the WebSocket upload flow used by https://github.com/timvisee/send :
 *   1. Generate a random 16-byte secret.
 *   2. HKDF-derive `encryptKey`, `authKey`, `metaKey` from the secret.
 *   3. Encrypt the file metadata with `metaKey` (AES-GCM, zero IV).
 *   4. Open a WebSocket to `{instance}/api/ws`.
 *   5. Send a JSON envelope with the encrypted metadata and authorization.
 *   6. Stream the file body encrypted with the RFC 8188 `aes128gcm`
 *      content-encoding (ECE), keyed by `encryptKey`.
 *   7. Send a zero-length binary frame to mark EOF.
 *   8. Receive `{ url, id, owner }` from the server.
 *   9. Append the secret as a URL fragment so the recipient can decrypt.
 */

const RECORD_SIZE = 1024 * 64;
const TAG_BYTES = 16;
const PLAINTEXT_RECORD_BYTES = RECORD_SIZE - TAG_BYTES - 1;

const encoder = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hkdfBits(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  bits: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    ikm as BufferSource,
    "HKDF",
    false,
    ["deriveBits"],
  );
  const out = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: salt as BufferSource,
      info: info as BufferSource,
    },
    key,
    bits,
  );
  return new Uint8Array(out);
}

interface DerivedKeys {
  encryptKey: Uint8Array;
  authKey: Uint8Array;
  metaCryptoKey: CryptoKey;
}

async function deriveSendKeys(secret: Uint8Array): Promise<DerivedKeys> {
  const empty = new Uint8Array(0);
  const [encryptKey, authKey, metaKeyRaw] = await Promise.all([
    hkdfBits(secret, empty, encoder.encode("encryption"), 128),
    hkdfBits(secret, empty, encoder.encode("authentication"), 512),
    hkdfBits(secret, empty, encoder.encode("metadata"), 128),
  ]);
  const metaCryptoKey = await crypto.subtle.importKey(
    "raw",
    metaKeyRaw as BufferSource,
    "AES-GCM",
    false,
    ["encrypt"],
  );
  return { encryptKey, authKey, metaCryptoKey };
}

async function encryptMetadata(
  metaCryptoKey: CryptoKey,
  file: File,
): Promise<Uint8Array> {
  const meta = {
    name: file.name,
    size: file.size,
    type: file.type || "application/octet-stream",
    manifest: {
      files: [
        {
          name: file.name,
          size: file.size,
          type: file.type || "application/octet-stream",
        },
      ],
    },
  };
  const ct = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: new Uint8Array(12) as BufferSource,
      tagLength: 128,
    },
    metaCryptoKey,
    encoder.encode(JSON.stringify(meta)) as BufferSource,
  );
  return new Uint8Array(ct);
}

function buildECEHeader(salt: Uint8Array, rs: number): Uint8Array {
  // salt(16) | rs(4 BE) | idlen(1) | keyid(idlen) — keyid empty here.
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, rs, false);
  header[20] = 0;
  return header;
}

async function deriveECEKeys(
  encryptKey: Uint8Array,
  salt: Uint8Array,
): Promise<{ cek: CryptoKey; baseNonce: Uint8Array }> {
  const cekBits = await hkdfBits(
    encryptKey,
    salt,
    encoder.encode("Content-Encoding: aes128gcm\0"),
    128,
  );
  const nonceBits = await hkdfBits(
    encryptKey,
    salt,
    encoder.encode("Content-Encoding: nonce\0"),
    96,
  );
  const cek = await crypto.subtle.importKey(
    "raw",
    cekBits as BufferSource,
    "AES-GCM",
    false,
    ["encrypt"],
  );
  return { cek, baseNonce: nonceBits };
}

function nonceForRecord(baseNonce: Uint8Array, seq: number): Uint8Array {
  const out = new Uint8Array(baseNonce);
  // XOR a 96-bit big-endian counter into the last 12 bytes; we only need
  // 64 bits since record counts never come close to overflowing.
  const view = new DataView(out.buffer, out.byteOffset, 12);
  const high = Math.floor(seq / 0x100000000);
  const low = seq >>> 0;
  view.setUint32(4, view.getUint32(4, false) ^ high, false);
  view.setUint32(8, view.getUint32(8, false) ^ low, false);
  return out;
}

async function encryptECERecord(
  cek: CryptoKey,
  baseNonce: Uint8Array,
  seq: number,
  plain: Uint8Array,
  isLast: boolean,
): Promise<Uint8Array> {
  const padded = new Uint8Array(plain.length + 1);
  padded.set(plain, 0);
  padded[plain.length] = isLast ? 0x02 : 0x01;
  const iv = nonceForRecord(baseNonce, seq);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource, tagLength: 128 },
    cek,
    padded as BufferSource,
  );
  return new Uint8Array(ct);
}

interface ECEStreamItem {
  data: Uint8Array;
  bytesUploaded: number;
}

async function* eceEncryptStream(
  file: File,
  encryptKey: Uint8Array,
): AsyncGenerator<ECEStreamItem> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const { cek, baseNonce } = await deriveECEKeys(encryptKey, salt);
  yield { data: buildECEHeader(salt, RECORD_SIZE), bytesUploaded: 0 };

  const total = file.size;
  let offset = 0;
  let seq = 0;

  if (total === 0) {
    yield {
      data: await encryptECERecord(cek, baseNonce, 0, new Uint8Array(0), true),
      bytesUploaded: 0,
    };
    return;
  }

  while (offset < total) {
    const end = Math.min(offset + PLAINTEXT_RECORD_BYTES, total);
    const isLast = end === total;
    const chunkBuf = await file.slice(offset, end).arrayBuffer();
    const chunk = new Uint8Array(chunkBuf);
    const data = await encryptECERecord(cek, baseNonce, seq, chunk, isLast);
    seq += 1;
    offset = end;
    yield { data, bytesUploaded: offset };
  }
}

interface UploadResponse {
  url?: string;
  id?: string;
  owner?: string;
  error?: number | string;
}

function instanceToWsUrl(instance: string): string {
  const u = new URL(instance);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  // Send mounts the upload websocket at /api/ws
  u.pathname = u.pathname.replace(/\/+$/, "") + "/api/ws";
  return u.toString();
}

export interface UploadOptions {
  onProgress?: (uploaded: number, total: number) => void;
  signal?: AbortSignal;
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw new DOMException("Upload aborted", "AbortError");
  }
}

async function uploadToInstance(
  file: File,
  instance: string,
  options: UploadOptions = {},
): Promise<{ url: string; instance: string }> {
  const { onProgress, signal } = options;
  throwIfAborted(signal);

  const secret = crypto.getRandomValues(new Uint8Array(16));
  const { encryptKey, authKey, metaCryptoKey } = await deriveSendKeys(secret);
  const metaCipher = await encryptMetadata(metaCryptoKey, file);

  const ws = new WebSocket(instanceToWsUrl(instance));
  ws.binaryType = "arraybuffer";

  const opened = new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("WebSocket error")), {
      once: true,
    });
    ws.addEventListener(
      "close",
      (e) => {
        if (e.code !== 1000) reject(new Error(`WebSocket closed: ${e.code}`));
      },
      { once: true },
    );
  });

  // Buffer text frames from the server in arrival order so we can await them.
  // Waiters carry both resolve and reject so we can fail any in-flight wait
  // when the socket closes/errors or the caller aborts — otherwise a cancel
  // mid-handshake or mid-finalize would leave the upload promise pending.
  const textQueue: string[] = [];
  const waiters: Array<{
    resolve: (s: string) => void;
    reject: (e: Error) => void;
  }> = [];
  let closedReason: Error | null = null;
  const failAllWaiters = (err: Error) => {
    if (!closedReason) closedReason = err;
    while (waiters.length) waiters.shift()!.reject(err);
  };

  ws.addEventListener("message", (e) => {
    if (typeof e.data === "string") {
      const w = waiters.shift();
      if (w) w.resolve(e.data);
      else textQueue.push(e.data);
    }
  });
  ws.addEventListener("close", (e) => {
    if (e.code !== 1000) {
      failAllWaiters(new Error(`WebSocket closed: ${e.code}`));
    } else {
      failAllWaiters(new Error("WebSocket closed before response"));
    }
  });
  ws.addEventListener("error", () => {
    failAllWaiters(new Error("WebSocket error"));
  });

  const onAbort = () => {
    failAllWaiters(new DOMException("Upload aborted", "AbortError"));
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  };
  signal?.addEventListener("abort", onAbort);

  const nextText = () =>
    new Promise<string>((resolve, reject) => {
      const queued = textQueue.shift();
      if (queued !== undefined) {
        resolve(queued);
        return;
      }
      if (closedReason) {
        reject(closedReason);
        return;
      }
      waiters.push({ resolve, reject });
    });

  try {
    await opened;
    throwIfAborted(signal);

    ws.send(
      JSON.stringify({
        fileMetadata: b64urlEncode(metaCipher),
        authorization: `send-v1 ${b64urlEncode(authKey)}`,
        timeLimit: 86400,
        dlimit: 1,
      }),
    );

    const ack = JSON.parse(await nextText()) as UploadResponse;
    if (ack.error) {
      throw new Error(`Send rejected upload: ${ack.error}`);
    }

    onProgress?.(0, file.size);
    for await (const item of eceEncryptStream(file, encryptKey)) {
      throwIfAborted(signal);
      ws.send(item.data);
      onProgress?.(item.bytesUploaded, file.size);
    }
    // Empty binary frame signals EOF to the server.
    ws.send(new ArrayBuffer(0));

    const finalMsg = JSON.parse(await nextText()) as UploadResponse;
    if (finalMsg.error || !finalMsg.url) {
      throw new Error(
        `Send finalize failed: ${finalMsg.error ?? "no url returned"}`,
      );
    }

    // Replace the server-provided URL host with the share fragment containing
    // the secret. Send returns `{instance}/download/{id}` and expects the
    // client to append `/#{secret}`.
    const shareUrl = `${finalMsg.url}#${b64urlEncode(secret)}`;
    return { url: shareUrl, instance };
  } finally {
    signal?.removeEventListener("abort", onAbort);
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Upload a file to a randomly-chosen public Send instance and return the
 * shareable download URL (with the decryption secret in the URL fragment).
 *
 * If the chosen instance fails, falls back to one other random instance
 * before giving up — public Send servers go up and down all the time.
 */
export async function uploadToSend(
  file: File,
  options: UploadOptions = {},
): Promise<{ url: string; instance: string }> {
  const first = pickRandomSendInstance();
  try {
    return await uploadToInstance(file, first, options);
  } catch (err) {
    // Don't retry on user-initiated cancel.
    if (options.signal?.aborted) throw err;
    // Single retry against a guaranteed-different random instance.
    const others = SEND_INSTANCES.filter((i) => i !== first);
    if (others.length === 0) throw err;
    const fallback = others[Math.floor(Math.random() * others.length)];
    return uploadToInstance(file, fallback, options);
  }
}
