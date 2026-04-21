import { useEffect, useState } from "react";
import { Loader2, Lock, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  deriveCommunityKey,
  rememberCommunityKey,
  verifyCommunityKey,
  type Community,
} from "@/lib/nostr/communities";

export function UnlockCommunityDialog({
  community,
  trigger,
  onUnlocked,
}: {
  community: Community;
  trigger?: React.ReactNode;
  onUnlocked?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) {
      setPassphrase("");
      setProgress(0);
    }
  }, [open]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passphrase.length < 1) return;
    setBusy(true);
    setProgress(0);
    try {
      const local = passphrase;
      setPassphrase("");
      const key = await deriveCommunityKey(local, community.identifier, (p) =>
        setProgress(p),
      );
      const ok = await verifyCommunityKey(key, community);
      if (!ok) {
        key.fill(0);
        toast({
          title: "Wrong passphrase",
          description: "The verifier didn't match. Try again.",
          variant: "destructive",
        });
        setBusy(false);
        return;
      }
      rememberCommunityKey(community.identifier, key);
      toast({
        title: "Unlocked",
        description: `n/${community.identifier} decrypted for this session.`,
      });
      setOpen(false);
      onUnlocked?.();
    } catch (err) {
      toast({
        title: "Unlock failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" variant="outline" className="gap-2" data-testid="button-unlock-community">
            <KeyRound className="h-4 w-4" /> Unlock
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-mono flex items-center gap-2">
            <Lock className="h-4 w-4 text-primary" /> Unlock n/{community.identifier}
          </DialogTitle>
          <DialogDescription>
            Enter the community passphrase. The derived key is held in
            memory only — it is never written to disk, and is wiped on
            reload, logout, or identity switch. You will need to unlock
            again the next time you open Agora.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <Input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="Passphrase"
            className="font-mono"
            disabled={busy}
            autoFocus
            autoComplete="current-password"
            data-testid="input-unlock-passphrase"
          />
          {busy && progress > 0 && (
            <Progress value={Math.round(progress * 100)} className="h-1.5" />
          )}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || passphrase.length === 0} data-testid="button-submit-unlock">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Unlock"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
