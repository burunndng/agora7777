import { useEffect, useState } from "react";
import { Loader2, Plus, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
import { publishCommunity, deriveCommunityKey, rememberCommunityKey } from "@/lib/nostr/communities";
import { useIsAdmin } from "@/lib/nostr/roles";
import { estimateStrength } from "@/lib/nostr/strength";

const ID_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/;

export function CreateCommunityDialog({
  trigger,
  defaultOpen = false,
  onCreated,
}: {
  trigger?: React.ReactNode;
  defaultOpen?: boolean;
  onCreated?: (identifier: string) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [identifier, setIdentifier] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState("");
  const [encryptOn, setEncryptOn] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const isAdmin = useIsAdmin();
  const { toast } = useToast();

  // Wipe passphrase from memory when dialog closes.
  useEffect(() => {
    if (!open) {
      setPassphrase("");
      setProgress(0);
    }
  }, [open]);

  const strength = encryptOn ? estimateStrength(passphrase) : null;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ID_RE.test(identifier)) {
      toast({
        title: "Invalid identifier",
        description:
          "Use 2–64 chars: lowercase letters, digits, '.', '-', '_'. Must start with letter or digit.",
        variant: "destructive",
      });
      return;
    }
    if (!name.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    if (encryptOn) {
      if (!isAdmin) {
        toast({
          title: "Admin only",
          description: "Only the admin can create password-protected communities.",
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
      if (strength && !strength.acceptable) {
        toast({
          title: "Passphrase too weak",
          description:
            strength.feedback.warning ||
            "Add length or unrelated words. Members will need this to decrypt posts.",
          variant: "destructive",
        });
        return;
      }
    }

    setBusy(true);
    setProgress(0);
    try {
      let derived: Uint8Array | null = null;
      const local = passphrase;
      setPassphrase("");
      if (encryptOn) {
        derived = await deriveCommunityKey(local, identifier, (p) => setProgress(p));
      }
      await publishCommunity({
        identifier,
        name: name.trim(),
        description: description.trim() || undefined,
        image: image.trim() || undefined,
        encryption: encryptOn && derived ? { passphrase: local } : null,
      });
      if (encryptOn && derived) {
        // Remember in this session so the creator doesn't have to unlock.
        rememberCommunityKey(identifier, derived);
      }
      toast({
        title: "Community published",
        description: encryptOn
          ? "Encrypted community created. Share the passphrase out-of-band with members."
          : "NIP-72 community metadata broadcast to your relay set.",
      });
      onCreated?.(identifier);
      setOpen(false);
      setIdentifier("");
      setName("");
      setDescription("");
      setImage("");
      setEncryptOn(false);
    } catch (err) {
      toast({
        title: "Create failed",
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
          <Button size="sm" className="gap-2" data-testid="button-create-community">
            <Plus className="h-4 w-4" /> New community
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-mono">Create community</DialogTitle>
          <DialogDescription>
            Publishes a NIP-72 (kind:34550) community metadata event to your
            relay set. The d-tag identifier is permanent and globally
            referenced.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
              Identifier
            </label>
            <Input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value.toLowerCase())}
              placeholder="agora-meta"
              className="font-mono mt-1"
              autoCapitalize="off"
              spellCheck={false}
              disabled={busy}
              data-testid="input-community-id"
            />
            <p className="text-[11px] font-mono text-muted-foreground mt-1">
              Lowercase letters, digits, '.', '-', '_'. Cannot be changed.
            </p>
          </div>
          <div>
            <label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
              Display name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Agora Meta"
              className="mt-1"
              disabled={busy}
              data-testid="input-community-name"
            />
          </div>
          <div>
            <label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
              Description (optional)
            </label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this community about?"
              className="mt-1"
              disabled={busy}
            />
          </div>
          <div>
            <label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
              Banner image URL (optional)
            </label>
            <Input
              value={image}
              onChange={(e) => setImage(e.target.value)}
              placeholder="https://…/banner.jpg"
              className="font-mono mt-1"
              disabled={busy}
              autoCapitalize="off"
              spellCheck={false}
              data-testid="input-community-image"
            />
            <p className="text-[11px] font-mono text-muted-foreground mt-1">
              Stored as the NIP-72 <code>image</code> tag.
            </p>
          </div>

          {isAdmin && (
            <div className="border border-border rounded-md p-3 space-y-3 bg-secondary/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Lock className="h-3.5 w-3.5 text-primary" />
                  <span className="text-sm font-mono">Password-protect (admin)</span>
                </div>
                <Switch
                  checked={encryptOn}
                  onCheckedChange={setEncryptOn}
                  disabled={busy}
                  data-testid="switch-community-encrypt"
                />
              </div>
              {encryptOn && (
                <>
                  <Input
                    type="password"
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    placeholder="Community passphrase…"
                    className="font-mono"
                    disabled={busy}
                    autoComplete="new-password"
                    data-testid="input-community-passphrase"
                  />
                  {strength && passphrase.length > 0 && !busy && (
                    <Progress
                      value={strength.percent}
                      className="h-1.5"
                      indicatorClassName={
                        strength.score <= 1
                          ? "bg-destructive"
                          : strength.score === 2
                            ? "bg-amber-500"
                            : strength.score === 3
                              ? "bg-primary"
                              : "bg-green-500"
                      }
                    />
                  )}
                  {busy && progress > 0 && (
                    <Progress value={Math.round(progress * 100)} className="h-1.5" />
                  )}
                  <p className="text-[11px] font-mono text-muted-foreground leading-relaxed">
                    Posts will be AES-GCM encrypted with a key derived via
                    Argon2id from this passphrase + the identifier. Share
                    out-of-band — Agora cannot recover it.
                  </p>
                </>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy} data-testid="button-submit-community">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Publish"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
