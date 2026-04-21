import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { RotateCw } from "lucide-react";

/**
 * Listens for a waiting service worker (a new deploy) and surfaces a
 * banner asking the user to reload. The new worker only takes over after
 * the user clicks — silent skipWaiting / clients.claim is removed so a
 * poisoned deploy can't replace a running session without consent.
 */
export function SwUpdatePrompt() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    let cancelled = false;

    const trackRegistration = (reg: ServiceWorkerRegistration) => {
      if (reg.waiting) setWaiting(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (
            installing.state === "installed" &&
            navigator.serviceWorker.controller
          ) {
            if (!cancelled) setWaiting(installing);
          }
        });
      });
    };

    navigator.serviceWorker
      .getRegistration()
      .then((reg) => {
        if (reg && !cancelled) trackRegistration(reg);
      })
      .catch(() => {});

    const onControllerChange = () => {
      // The new worker has taken over; reload so we boot the new shell.
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange,
    );

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
    };
  }, []);

  if (!waiting) return null;

  const apply = () => {
    waiting.postMessage({ type: "SKIP_WAITING" });
  };

  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-card border border-primary/40 shadow-lg rounded-md px-4 py-3 flex items-center gap-3"
      role="status"
      data-testid="sw-update-prompt"
    >
      <span className="text-sm font-mono">A new version of Agora is ready.</span>
      <Button size="sm" onClick={apply} data-testid="button-sw-update-apply">
        <RotateCw className="h-3.5 w-3.5 mr-1.5" /> Reload to apply
      </Button>
    </div>
  );
}
