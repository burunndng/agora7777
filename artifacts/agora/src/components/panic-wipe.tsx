import { useEffect, useState } from "react";
import { useIdentityStore } from "@/lib/nostr/store";
import { destroyCache } from "@/lib/nostr/cache";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ShieldAlert } from "lucide-react";

const PANIC_FLAG = "agora.panicWipe.lastTriggered";

/**
 * Global keyboard handler for panic wipe (Ctrl+Shift+X).
 *
 * The shortcut shows a confirmation dialog (Ctrl+Shift+X collides with
 * common browser/IDE shortcuts on some setups, and the wipe is destructive
 * — clearing the encrypted IndexedDB cache and zeroing in-memory keys).
 * Only after the user clicks "Wipe everything" does the wipe actually run.
 */
export function PanicWipeHandler() {
  const logout = useIdentityStore((s) => s.logout);
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);

  // One-time toast after a wipe.
  useEffect(() => {
    try {
      const flag = sessionStorage.getItem(PANIC_FLAG);
      if (flag) {
        sessionStorage.removeItem(PANIC_FLAG);
        toast({
          title: "Panic wipe complete",
          description:
            "Your encrypted cache, in-memory keys, and local session were destroyed.",
        });
      }
    } catch {
      /* sessionStorage may be unavailable */
    }
  }, [toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.shiftKey) return;
      // Match either physical key X or current key 'X'/'x'.
      const isX = e.code === "KeyX" || e.key === "X" || e.key === "x";
      if (!isX) return;
      e.preventDefault();
      e.stopPropagation();
      setConfirming(true);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const onConfirm = async () => {
    if (running) return;
    setRunning(true);
    try {
      await runPanicWipe(logout);
    } finally {
      setRunning(false);
      setConfirming(false);
    }
  };

  return (
    <Dialog
      open={confirming}
      onOpenChange={(o) => {
        if (!running) setConfirming(o);
      }}
    >
      <DialogContent data-testid="panic-wipe-confirm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-mono">
            <ShieldAlert className="h-5 w-5 text-destructive" />
            Wipe all local data?
          </DialogTitle>
          <DialogDescription className="space-y-2">
            <span className="block">
              This will destroy your encrypted cache, drop the in-memory
              signing key, remove Agora's localStorage, and bounce you to
              the login screen.
            </span>
            <span className="block text-xs">
              Already-published events on relays are not affected. You can
              re-derive the same identity by signing in again with the same
              passphrase and handle.
            </span>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => setConfirming(false)}
            disabled={running}
            data-testid="panic-wipe-cancel"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => void onConfirm()}
            disabled={running}
            data-testid="panic-wipe-confirm-button"
          >
            {running ? "Wiping…" : "Wipe everything"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

async function runPanicWipe(logout: () => void) {
  // Mark for next-session toast BEFORE we wipe (sessionStorage survives a hash
  // navigation but not a tab close, which is acceptable).
  try {
    sessionStorage.setItem(PANIC_FLAG, "1");
  } catch {
    /* ignore */
  }

  // Zero in-memory key material and drop in-memory cache reference.
  try {
    logout();
  } catch {
    /* ignore */
  }

  // Wipe persisted Agora data from localStorage (relays, first-seen map, etc).
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("agora")) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }

  // Destroy the encrypted IndexedDB store.
  try {
    await destroyCache();
  } catch {
    /* ignore */
  }

  // Bounce to login.
  window.location.hash = "#/login";
}
