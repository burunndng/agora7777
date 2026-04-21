import { useState, useEffect } from "react";
import { useParams, Link, useLocation } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { authorLabel, hexToNpub, npubToHex } from "@/lib/nostr/format";
import { Badge } from "@/components/ui/badge";
import {
  Terminal,
  Shield,
  MessageCircle,
  Pencil,
  Loader2,
  Sparkles,
  Hash,
  MessageSquareQuote,
  Send,
} from "lucide-react";
import { useProfile, publishProfile, type ProfileMetadata } from "@/lib/nostr/profiles";
import { Nip05BadgeStatic } from "@/components/nip05-badge";
import { useNip05Verification } from "@/lib/nostr/nip05";
import { Button } from "@/components/ui/button";
import { useIdentityStore } from "@/lib/nostr/store";
import { useRelayStore } from "@/lib/nostr/store";
import { linkify } from "@/components/safe-link";
import {
  useSharedContext,
  buildOpener,
  type SharedContext,
} from "@/lib/nostr/shared-context";
import { sendDM } from "@/lib/nostr/dm";
import { useResonanceMode } from "@/lib/resonance/preferences";
import { useResonanceMap } from "@/lib/resonance/use-interests";
import {
  ResonanceMapView,
  SharedResonanceBadge,
} from "@/components/resonance/resonance-map";
import { EditResonanceMapDialog } from "@/components/resonance/edit-resonance-map-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export default function Profile() {
  const params = useParams();
  const idParam = params.npub || "";
  const pubkey = idParam.startsWith("npub") ? npubToHex(idParam) : idParam;
  const npub = pubkey ? hexToNpub(pubkey) : idParam;
  const { profile: fetchedProfile, loading } = useProfile(pubkey);
  const [savedProfile, setSavedProfile] = useState<ProfileMetadata | null>(null);
  const profile = savedProfile ?? fetchedProfile;
  const nip05Status = useNip05Verification(profile?.nip05, pubkey);
  const me = useIdentityStore((s) => s.identity);
  const relays = useRelayStore((s) => s.relays);
  const isMe = me?.pubkey === pubkey;

  const [editOpen, setEditOpen] = useState(false);
  const [editResonanceOpen, setEditResonanceOpen] = useState(false);
  const resonanceMode = useResonanceMode();
  // Only fetch maps when Resonance Mode is on, so users who never opt
  // in never trigger the extra subscription.
  const { map: theirMap } = useResonanceMap(
    resonanceMode && pubkey ? pubkey : null,
  );
  const { map: myMap } = useResonanceMap(
    resonanceMode && me?.pubkey && !isMe ? me.pubkey : null,
  );

  // Only show the conversation-starter prompt when navigation arrived from
  // the Nearby view. Read once on mount and clear so a manual reload of
  // the same profile won't keep nagging.
  const [cameFromNearby, setCameFromNearby] = useState(false);
  useEffect(() => {
    if (!pubkey) {
      setCameFromNearby(false);
      return;
    }
    try {
      const flagged = sessionStorage.getItem("agora.profile.fromNearby");
      const matched = !!flagged && flagged === pubkey;
      // Always reset for the new pubkey so navigating between profiles
      // can't carry a stale "from Nearby" flag forward.
      setCameFromNearby(matched);
      if (matched) sessionStorage.removeItem("agora.profile.fromNearby");
    } catch {
      setCameFromNearby(false);
    }
  }, [pubkey]);

  return (
    <div className="flex flex-col min-h-screen">
      <div className="border-b border-border bg-card/50 sticky top-0 z-10 backdrop-blur-md px-4 py-3">
        <h1 className="text-xl font-bold font-mono text-primary flex items-center gap-2">
          <Terminal className="h-5 w-5" />
          Cryptographic Identity
        </h1>
      </div>

      {loading ? (
        <div className="p-6 space-y-6">
          <div className="flex items-center gap-6">
            <Skeleton className="h-24 w-24 rounded-full" />
            <div className="space-y-3 flex-1">
              <Skeleton className="h-8 w-1/3" />
              <Skeleton className="h-4 w-1/4" />
            </div>
          </div>
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <>
          {profile?.banner && (
            <div
              className="h-32 md:h-48 w-full bg-cover bg-center border-b border-border"
              style={{ backgroundImage: `url(${profile.banner})` }}
            />
          )}

          <div className="p-6">
            <div className="flex flex-col md:flex-row gap-6 md:items-end -mt-12 md:-mt-16 mb-6">
              {profile?.picture ? (
                <img
                  src={profile.picture}
                  alt={profile.display_name || profile.name || "Avatar"}
                  className="h-24 w-24 md:h-32 md:w-32 rounded-full border-4 border-background bg-secondary object-cover"
                />
              ) : (
                <div className="h-24 w-24 md:h-32 md:w-32 rounded-full border-4 border-background bg-secondary flex items-center justify-center text-4xl text-primary font-bold">
                  {(profile?.display_name || profile?.name || npub).charAt(0).toUpperCase()}
                </div>
              )}

              <div className="flex-1 pb-2 min-w-0">
                <div className="flex flex-wrap items-center gap-3 mb-1">
                  <h2 className="text-2xl md:text-3xl font-bold text-foreground">
                    {profile?.display_name || profile?.name || "Anonymous"}
                  </h2>
                  {profile?.nip05 && (
                    <Nip05BadgeStatic value={profile.nip05} status={nip05Status} />
                  )}
                  {isMe && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="font-mono text-xs"
                      onClick={() => setEditOpen(true)}
                    >
                      <Pencil className="h-3.5 w-3.5 mr-1" />
                      Edit profile
                    </Button>
                  )}
                  {!isMe && pubkey && (
                    <Link href={`/messages/${npub}`}>
                      <Button size="sm" variant="outline" className="font-mono text-xs">
                        <MessageCircle className="h-3.5 w-3.5 mr-1" />
                        Message
                      </Button>
                    </Link>
                  )}
                </div>
                <div className="text-muted-foreground font-mono flex items-center gap-2 text-sm">
                  <Shield className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">
                    {authorLabel(npub, profile?.display_name || profile?.name)}
                  </span>
                </div>
              </div>
            </div>

            {profile?.about && (
              <div className="bg-secondary/10 border border-border rounded-md p-4 mb-6 font-mono text-sm whitespace-pre-wrap break-words">
                {linkify(profile.about)}
              </div>
            )}

            {cameFromNearby && !isMe && pubkey && me && (
              <ConversationStarterPrompt
                viewer={me.pubkey}
                target={pubkey}
                targetNpub={npub}
                targetName={profile?.display_name || profile?.name || null}
              />
            )}

            <div className="text-xs text-muted-foreground font-mono break-all bg-secondary/30 p-3 rounded border border-border">
              {npub}
            </div>

            {resonanceMode && pubkey && (
              <div className="mt-6 space-y-3" data-testid="profile-resonance-section">
                {!isMe && <SharedResonanceBadge mine={myMap} theirs={theirMap} />}
                <ResonanceMapView
                  map={theirMap}
                  emptyLabel={
                    isMe
                      ? "You haven't published a Resonance Map yet."
                      : "This account hasn't published a Resonance Map."
                  }
                />
                {isMe && me && (
                  <div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="font-mono text-xs"
                      onClick={() => setEditResonanceOpen(true)}
                      data-testid="button-edit-resonance"
                    >
                      <Sparkles className="h-3.5 w-3.5 mr-1" />
                      {theirMap && theirMap.selections.length > 0
                        ? "Edit Resonance Map"
                        : "Create Resonance Map"}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {isMe && me && resonanceMode && (
        <EditResonanceMapDialog
          open={editResonanceOpen}
          onOpenChange={setEditResonanceOpen}
          identity={me}
        />
      )}

      {isMe && me && (
        <EditProfileDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          current={profile}
          onSave={async (metadata) => {
            await publishProfile(me, metadata, relays);
            setSavedProfile(metadata);
            setEditOpen(false);
          }}
        />
      )}
    </div>
  );
}

function EditProfileDialog({
  open,
  onOpenChange,
  current,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: ProfileMetadata | null;
  onSave: (metadata: ProfileMetadata) => Promise<void>;
}) {
  const [name, setName] = useState(current?.name ?? "");
  const [displayName, setDisplayName] = useState(current?.display_name ?? "");
  const [about, setAbout] = useState(current?.about ?? "");
  const [picture, setPicture] = useState(current?.picture ?? "");
  const [banner, setBanner] = useState(current?.banner ?? "");
  const [nip05, setNip05] = useState(current?.nip05 ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(current?.name ?? "");
      setDisplayName(current?.display_name ?? "");
      setAbout(current?.about ?? "");
      setPicture(current?.picture ?? "");
      setBanner(current?.banner ?? "");
      setNip05(current?.nip05 ?? "");
      setError(null);
    }
  }, [open, current]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const metadata: ProfileMetadata = {};
      if (name.trim()) metadata.name = name.trim();
      if (displayName.trim()) metadata.display_name = displayName.trim();
      if (about.trim()) metadata.about = about.trim();
      if (picture.trim()) metadata.picture = picture.trim();
      if (banner.trim()) metadata.banner = banner.trim();
      if (nip05.trim()) metadata.nip05 = nip05.trim();
      await onSave(metadata);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to publish profile");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg font-mono">
        <DialogHeader>
          <DialogTitle className="font-mono text-primary flex items-center gap-2">
            <Pencil className="h-4 w-4" />
            Edit profile
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="ep-name" className="text-xs text-muted-foreground">
                Name
              </Label>
              <Input
                id="ep-name"
                className="font-mono text-sm"
                placeholder="satoshi"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ep-display-name" className="text-xs text-muted-foreground">
                Display name
              </Label>
              <Input
                id="ep-display-name"
                className="font-mono text-sm"
                placeholder="Satoshi Nakamoto"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ep-about" className="text-xs text-muted-foreground">
              About
            </Label>
            <Textarea
              id="ep-about"
              className="font-mono text-sm resize-none"
              placeholder="A short bio…"
              rows={3}
              value={about}
              onChange={(e) => setAbout(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ep-picture" className="text-xs text-muted-foreground">
              Picture URL
            </Label>
            <Input
              id="ep-picture"
              className="font-mono text-sm"
              placeholder="https://example.com/avatar.png"
              value={picture}
              onChange={(e) => setPicture(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ep-banner" className="text-xs text-muted-foreground">
              Banner URL
            </Label>
            <Input
              id="ep-banner"
              className="font-mono text-sm"
              placeholder="https://example.com/banner.png"
              value={banner}
              onChange={(e) => setBanner(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ep-nip05" className="text-xs text-muted-foreground">
              NIP-05 identifier
            </Label>
            <Input
              id="ep-nip05"
              className="font-mono text-sm"
              placeholder="you@yourdomain.com"
              value={nip05}
              onChange={(e) => setNip05(e.target.value)}
            />
          </div>

          {error && (
            <p className="text-xs text-destructive font-mono">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving} className="font-mono">
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Publishing…
              </>
            ) : (
              "Save profile"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConversationStarterPrompt({
  viewer,
  target,
  targetNpub,
  targetName,
}: {
  viewer: string;
  target: string;
  targetNpub: string;
  targetName: string | null;
}) {
  const { context, loading } = useSharedContext(viewer, target);
  const relays = useRelayStore((s) => s.relays);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [sending, setSending] = useState(false);

  // Per spec: when no shared context can be found, hide the prompt entirely
  // — never fall back to a generic opener that pretends to know something.
  if (loading || !context) return null;

  const opener = buildOpener(context);
  const label = targetName || targetNpub.slice(0, 12) + "…";

  const handleSend = async () => {
    setSending(true);
    try {
      await sendDM(target, opener, relays);
      toast({
        title: "Opener sent",
        description: `Your message is on its way to ${label}.`,
      });
      setLocation(`/messages/${targetNpub}`);
    } catch (err) {
      toast({
        title: "Could not send opener",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="border border-primary/40 bg-primary/5 rounded-md p-4 mb-6 space-y-3"
      data-testid="card-conversation-starter"
    >
      <div className="flex items-center gap-2 text-primary font-mono text-sm font-bold">
        <Sparkles className="h-4 w-4" />
        Start with something you have in common
      </div>

      {context.kind === "community" ? (
        <div className="text-sm font-mono text-muted-foreground">
          You both post in{" "}
          <Link href={`/community/${encodeURIComponent(context.identifier)}`}>
            <span className="inline-flex items-center gap-1 text-primary border border-primary/40 px-1.5 py-0.5 rounded-sm cursor-pointer hover:bg-primary/10 align-baseline">
              <Hash className="h-3 w-3" />
              {context.identifier}
            </span>
          </Link>
          .
        </div>
      ) : (
        <div className="text-sm font-mono text-muted-foreground">
          You both commented on{" "}
          <Link href={`/post/${context.eventId}`}>
            <span className="inline-flex items-center gap-1 text-primary cursor-pointer hover:underline align-baseline">
              <MessageSquareQuote className="h-3 w-3" />
              {context.title}
            </span>
          </Link>
          .
        </div>
      )}

      <div className="border-l-2 border-primary/40 pl-3 text-sm font-mono text-foreground/90 italic break-words">
        “{opener}”
      </div>

      <div>
        <Button
          onClick={() => void handleSend()}
          disabled={sending}
          className="font-mono"
          data-testid="button-send-opener"
        >
          {sending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Send className="h-4 w-4 mr-2" />
          )}
          Send opener
        </Button>
      </div>
    </div>
  );
}

