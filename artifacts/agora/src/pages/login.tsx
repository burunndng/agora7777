import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { useIdentityStore } from "@/lib/nostr/store";
import { deriveIdentity, isValidHandle } from "@/lib/nostr/identity";
import { estimateStrength } from "@/lib/nostr/strength";
import { requestPersistentStorage } from "@/lib/storage/persist";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Terminal,
  KeyRound,
  Lock,
  ArrowRight,
  Loader2,
  AtSign,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";

const LAST_HANDLE_KEY = "agora.identity.lastHandle.v1";

export default function Login() {
  const [, setLocation] = useLocation();
  const setIdentity = useIdentityStore((s) => s.setIdentity);
  const { toast } = useToast();

  const [handle, setHandle] = useState<string>(() => {
    try {
      return localStorage.getItem(LAST_HANDLE_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [legacyMode, setLegacyMode] = useState(false);

  const strength = useMemo(() => estimateStrength(passphrase), [passphrase]);

  // Wipe passphrase from state when component unmounts.
  useEffect(() => {
    return () => setPassphrase("");
  }, []);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!legacyMode && !isValidHandle(handle)) {
      toast({
        title: "Pick a handle",
        description:
          "Use 3–64 chars: letters, digits, '.', '-', '_' or '@'. The handle is mixed into your key derivation salt and never published.",
        variant: "destructive",
      });
      return;
    }
    if (passphrase.length < 12) {
      toast({
        title: "Passphrase too short",
        description: "Use at least 12 characters.",
        variant: "destructive",
      });
      return;
    }
    if (!strength.acceptable) {
      toast({
        title: "Passphrase too weak",
        description:
          strength.feedback.warning ||
          "Add length or unrelated words. This passphrase is your only key.",
        variant: "destructive",
      });
      return;
    }

    setBusy(true);
    setProgress(0);
    try {
      const local = passphrase;
      // Wipe the input state immediately; keep only the local closure copy.
      setPassphrase("");
      const identity = await deriveIdentity(
        local,
        handle,
        (p) => setProgress(p),
        { legacy: legacyMode },
      );
      setIdentity(identity);
      // Best-effort persistence of the handle for next-login UX. The handle
      // is a privacy datum but the user already typed it on this device;
      // they can clear via Panic Wipe.
      if (!legacyMode) {
        try {
          localStorage.setItem(LAST_HANDLE_KEY, handle);
        } catch {
          /* ignore */
        }
      }
      // Best-effort: ask the browser to keep our encrypted cache around. This
      // matters most on mobile Safari & Android where storage gets evicted
      // under pressure. Failures are silent — settings exposes a manual button.
      requestPersistentStorage().catch(() => {});
      toast({
        title: "Identity derived",
        description: legacyMode
          ? "Legacy v1 key loaded. Re-derive with a handle soon."
          : "Your Nostr keypair is loaded in memory only.",
      });
      setLocation("/");
    } catch (err) {
      toast({
        title: "Derivation failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const meterColor = (() => {
    if (strength.score <= 1) return "bg-destructive";
    if (strength.score === 2) return "bg-amber-500";
    if (strength.score === 3) return "bg-primary";
    return "bg-green-500";
  })();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-background">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-xl bg-secondary/50 mb-4 border border-border shadow-[0_0_20px_rgba(255,165,0,0.1)]">
            <Terminal className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Agora Identity</h1>
          <p className="text-muted-foreground font-mono text-sm">
            Decentralized. Uncensorable. Yours.
          </p>
        </div>

        <div className="bg-card border border-border p-6 rounded-xl shadow-lg mb-6">
          <form onSubmit={handleConnect} className="space-y-6">
            <div className="space-y-4">
              {!legacyMode && (
                <div>
                  <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-2 font-mono">
                    <AtSign className="h-4 w-4" /> Handle
                  </label>
                  <Input
                    type="text"
                    placeholder="e.g. alice or alice@example.com"
                    className="h-12 font-mono bg-secondary/30 text-lg border-border focus:border-primary transition-colors"
                    value={handle}
                    onChange={(e) => setHandle(e.target.value)}
                    disabled={busy}
                    autoComplete="username"
                    autoCapitalize="off"
                    spellCheck={false}
                    data-testid="input-handle"
                  />
                  <p className="text-[11px] font-mono text-muted-foreground mt-1.5">
                    Mixed into your Argon2id salt so two users with the same
                    passphrase get different keys. Never published to relays.
                  </p>
                </div>
              )}

              <div>
                <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-2 font-mono">
                  <KeyRound className="h-4 w-4" /> Passphrase
                </label>
                <Input
                  type="password"
                  placeholder="Enter a long, unique passphrase…"
                  className="h-12 font-mono bg-secondary/30 text-lg border-border focus:border-primary transition-colors"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  disabled={busy}
                  autoComplete="current-password"
                />
              </div>

              {passphrase.length > 0 && !busy && (
                <div className="space-y-1.5 animate-in fade-in slide-in-from-top-1">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-mono text-muted-foreground">
                      Strength (zxcvbn)
                    </span>
                    <span className="text-xs font-mono font-bold">
                      {["very weak", "weak", "fair", "strong", "excellent"][strength.score]}
                    </span>
                  </div>
                  <Progress
                    value={strength.percent}
                    className="h-1.5"
                    indicatorClassName={meterColor}
                  />
                  {(strength.feedback.warning || strength.feedback.suggestions.length > 0) && (
                    <div className="text-[11px] font-mono text-muted-foreground pt-1">
                      {strength.feedback.warning && (
                        <div className="text-amber-500">{strength.feedback.warning}</div>
                      )}
                      {strength.feedback.suggestions.slice(0, 2).map((s, i) => (
                        <div key={i}>• {s}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {busy && (
                <div className="space-y-1.5 animate-in fade-in slide-in-from-top-1">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-mono text-muted-foreground">
                      Argon2id derivation
                    </span>
                    <span className="text-xs font-mono font-bold">
                      {Math.round(progress * 100)}%
                    </span>
                  </div>
                  <Progress value={Math.round(progress * 100)} className="h-1.5" />
                </div>
              )}
            </div>

            <div className="bg-secondary/20 p-4 rounded-md border border-border/50 text-xs text-muted-foreground font-mono leading-relaxed">
              <Lock className="h-3 w-3 inline mr-1 -mt-0.5 text-primary" />
              Argon2id (m=64MB, t=3) runs in a worker. The derived seed never leaves
              your browser. If you lose this passphrase, your identity cannot be
              recovered — there is no server to reset it.
            </div>

            {legacyMode && (
              <div className="bg-amber-500/10 border border-amber-500/40 p-3 rounded-md text-[11px] text-amber-600 dark:text-amber-400 font-mono leading-relaxed">
                Legacy login (v1, single shared salt). Use this only to recover
                an account you created before the per-handle salt was rolled
                out. After you log in, re-derive with a handle and migrate.
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-12 font-bold text-md"
              disabled={busy || passphrase.length < 12 || !strength.acceptable}
              data-testid="button-derive"
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Deriving identity…
                </>
              ) : (
                <>
                  Derive identity & connect <ArrowRight className="h-4 w-4 ml-2" />
                </>
              )}
            </Button>
          </form>
        </div>

        <div className="text-center space-y-2">
          <Button
            variant="link"
            disabled={busy}
            className="text-muted-foreground font-mono text-xs hover:text-primary"
            onClick={() => {
              const bytes = crypto.getRandomValues(new Uint8Array(24));
              const hex = Array.from(bytes)
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("");
              setPassphrase(hex);
            }}
          >
            Generate a random 48-character passphrase
          </Button>
          <div>
            <Button
              variant="link"
              disabled={busy}
              className="text-muted-foreground font-mono text-[11px] hover:text-primary"
              onClick={() => setLegacyMode((v) => !v)}
              data-testid="button-toggle-legacy"
            >
              {legacyMode
                ? "Use new (v2) per-handle salt"
                : "Legacy login (v1, no handle)"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
