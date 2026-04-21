import PowWorker from "@/workers/pow-worker?worker";
import type { PowRequest, PowResponse } from "@/workers/pow-worker";
import type { UnsignedEvent } from "nostr-tools/pure";

export async function minePowAsync(
  unsigned: UnsignedEvent,
  difficulty: number,
): Promise<Omit<UnsignedEvent, "sig">> {
  if (difficulty <= 0) return unsigned;
  const worker = new PowWorker();
  const id = crypto.randomUUID();
  try {
    return await new Promise<Omit<UnsignedEvent, "sig">>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<PowResponse>) => {
        const msg = e.data;
        if (msg.id !== id) return;
        if (msg.type === "result") resolve(msg.mined);
        else reject(new Error(msg.error));
      };
      worker.onerror = (err) => reject(err);
      worker.postMessage({ id, unsigned, difficulty } satisfies PowRequest);
    });
  } finally {
    worker.terminate();
  }
}
