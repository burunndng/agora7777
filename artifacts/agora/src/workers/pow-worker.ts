/// <reference lib="webworker" />
import { minePow } from "nostr-tools/nip13";
import type { UnsignedEvent } from "nostr-tools/pure";

export type PowRequest = {
  id: string;
  unsigned: UnsignedEvent;
  difficulty: number;
};

export type PowResponse =
  | { id: string; type: "result"; mined: Omit<UnsignedEvent, "sig"> }
  | { id: string; type: "error"; error: string };

self.addEventListener("message", (event: MessageEvent<PowRequest>) => {
  const { id, unsigned, difficulty } = event.data;
  try {
    const mined = minePow(unsigned, Math.max(0, Math.min(difficulty, 32)));
    (self as DedicatedWorkerGlobalScope).postMessage({
      id,
      type: "result",
      mined,
    } satisfies PowResponse);
  } catch (err) {
    (self as DedicatedWorkerGlobalScope).postMessage({
      id,
      type: "error",
      error: err instanceof Error ? err.message : String(err),
    } satisfies PowResponse);
  }
});
