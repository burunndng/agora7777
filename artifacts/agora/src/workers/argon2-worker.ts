/// <reference lib="webworker" />
import { argon2idAsync } from "@noble/hashes/argon2.js";

export type ArgonRequest = {
  id: string;
  passphrase: string;
  salt: string;
  t?: number;
  m?: number;
  p?: number;
  dkLen?: number;
};

export type ArgonResponse =
  | { id: string; type: "progress"; progress: number }
  | { id: string; type: "result"; seed: ArrayBuffer }
  | { id: string; type: "error"; error: string };

self.addEventListener("message", async (event: MessageEvent<ArgonRequest>) => {
  const { id, passphrase, salt, t = 3, m = 65536, p = 1, dkLen = 32 } = event.data;
  try {
    const seed = await argon2idAsync(passphrase, salt, {
      t,
      m,
      p,
      dkLen,
      asyncTick: 25,
      onProgress: (progress: number) => {
        (self as DedicatedWorkerGlobalScope).postMessage({
          id,
          type: "progress",
          progress,
        } satisfies ArgonResponse);
      },
    });
    const out = new Uint8Array(seed);
    const buf = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
    out.fill(0);
    (self as DedicatedWorkerGlobalScope).postMessage(
      { id, type: "result", seed: buf } satisfies ArgonResponse,
      [buf],
    );
  } catch (err) {
    (self as DedicatedWorkerGlobalScope).postMessage({
      id,
      type: "error",
      error: err instanceof Error ? err.message : String(err),
    } satisfies ArgonResponse);
  }
});
