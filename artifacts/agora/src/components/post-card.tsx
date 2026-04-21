import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Link } from "wouter";
import { ArrowUp, ArrowDown, MessageSquare, ShieldAlert, Gavel, Loader2, Lock } from "lucide-react";
import type { Event as NostrEvent } from "nostr-tools/core";
import { authorLabel, hexToNpub } from "@/lib/nostr/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useProfile } from "@/lib/nostr/profiles";
import { eventPow } from "@/lib/nostr/scoring";
import { MediaList } from "@/components/media";
import { extractMediaUrls } from "@/lib/media/event-tags";
import { linkify } from "@/components/safe-link";
import { publishModAction } from "@/lib/nostr/moderation";
import { useToast } from "@/hooks/use-toast";
import { ReactionBar } from "@/components/reaction-bar";
import { BookmarkButton } from "@/components/bookmark-button";
import { Nip05Badge } from "@/components/nip05-badge";
import { useIsAdmin, useIsModerator } from "@/lib/nostr/roles";
import { decryptString, ENCRYPTION_SCHEME } from "@/lib/nostr/communities";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export interface PostCardProps {
  event: NostrEvent;
  score?: number;
  replyCount?: number;
  community?: string | null;
  isCompact?: boolean;
  canModerate?: boolean;
  decryptionKey?: Uint8Array | null;
}

function extractTitle(event: NostrEvent): string | null {
  const subjectTag = event.tags.find((t) => t[0] === "subject" || t[0] === "title");
  return subjectTag?.[1] ?? null;
}

function DiamondVote({
  direction,
  active = false,
  onClick,
}: {
  direction: "up" | "down";
  active?: boolean;
  onClick?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const goldColor = "#c9962e";
  const dimColor = "#1a2240";
  const bg = active || hovered ? goldColor : dimColor;
  const iconColor = active || hovered ? "#070b14" : "#8090b8";

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="transition-all active:scale-95"
      style={{
        width: 32,
        height: 32,
        clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
        backgroundColor: bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        border: "none",
        outline: "none",
        flexShrink: 0,
      }}
      title={direction === "up" ? "Upvote" : "Downvote"}
    >
      {direction === "up" ? (
        <ArrowUp style={{ width: 14, height: 14, color: iconColor, strokeWidth: 2.5 }} />
      ) : (
        <ArrowDown style={{ width: 14, height: 14, color: iconColor, strokeWidth: 2.5 }} />
      )}
    </button>
  );
}

export function PostCard({
  event,
  score = 0,
  replyCount = 0,
  community,
  isCompact = false,
  canModerate = false,
  decryptionKey = null,
}: PostCardProps) {
  const { profile } = useProfile(event.pubkey);
  const npub = hexToNpub(event.pubkey);
  const pow = eventPow(event);
  const title = extractTitle(event);
  const displayName = profile?.display_name || profile?.name || "";
  const isAdmin = useIsAdmin();
  const isGlobalMod = useIsModerator();
  const effectiveCanModerate = canModerate || isAdmin || isGlobalMod;

  const isEncryptedPost = event.tags.some(
    (t) => (t[0] === "encrypted" || t[0] === "encryption") && t[1] === ENCRYPTION_SCHEME,
  );
  const [decrypted, setDecrypted] = useState<string | null>(null);
  const [decryptError, setDecryptError] = useState<boolean>(false);
  useEffect(() => {
    if (!isEncryptedPost) return;
    if (!decryptionKey || !community) {
      setDecrypted(null);
      return;
    }
    let cancelled = false;
    decryptString(decryptionKey, event.content, community)
      .then((plain) => {
        if (!cancelled) {
          setDecrypted(plain);
          setDecryptError(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDecrypted(null);
          setDecryptError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isEncryptedPost, event.content, decryptionKey, community]);

  const displayContent = isEncryptedPost ? decrypted ?? "" : event.content;
  const mediaUrls = isEncryptedPost && !decrypted ? [] : extractMediaUrls(event);

  return (
    <div
      className="transition-colors group"
      style={{
        padding: "14px 16px",
        borderBottom: "1px solid #1a2240",
        backgroundColor: "#0f1528",
        borderLeft: "2px solid transparent",
        position: "relative",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.backgroundColor = "#111929";
        (e.currentTarget as HTMLElement).style.borderLeftColor = "#7a5818";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.backgroundColor = "#0f1528";
        (e.currentTarget as HTMLElement).style.borderLeftColor = "transparent";
      }}
    >
      <div className="flex gap-3">
        {/* Diamond Vote Column */}
        <div className="flex flex-col items-center gap-1.5 min-w-[36px] pt-1">
          <DiamondVote direction="up" />
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: score > 0 ? "#c9962e" : score < 0 ? "#ef4444" : "#8090b8",
              fontFamily: "'Space Grotesk', sans-serif",
              lineHeight: 1,
            }}
          >
            {score > 0 ? `+${Math.round(score)}` : Math.round(score)}
          </span>
          <DiamondVote direction="down" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Meta row */}
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            {community && (
              <Link href={`/community/${encodeURIComponent(community)}`}>
                <span
                  style={{
                    fontSize: 10,
                    fontFamily: "'Space Grotesk', sans-serif",
                    fontWeight: 600,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: "#c9962e",
                    border: "1px solid #7a5818",
                    padding: "1px 6px",
                    cursor: "pointer",
                  }}
                >
                  {community}
                </span>
              </Link>
            )}
            <Link href={`/profile/${npub}`}>
              <span
                style={{
                  fontSize: 11,
                  color: "#8090b8",
                  fontFamily: "monospace",
                  cursor: "pointer",
                }}
                className="hover:underline"
              >
                {authorLabel(npub, displayName)}
              </span>
            </Link>
            {profile?.nip05 && (
              <Nip05Badge value={profile.nip05} pubkey={event.pubkey} size="xs" />
            )}
            <span style={{ fontSize: 11, color: "#3d4f70" }}>·</span>
            <span style={{ fontSize: 11, color: "#3d4f70" }} suppressHydrationWarning>
              {formatDistanceToNow(new Date(event.created_at * 1000), { addSuffix: true })}
            </span>
            {pow > 0 && (
              <span
                style={{
                  fontSize: 10,
                  color: "#c9962e",
                  border: "1px solid #7a5818",
                  padding: "0px 5px",
                  fontFamily: "'Space Grotesk', sans-serif",
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                }}
              >
                <ShieldAlert style={{ width: 10, height: 10 }} />
                PoW {pow}
              </span>
            )}
          </div>

          {/* Title / Content */}
          <Link href={`/post/${event.id}`}>
            <div className="cursor-pointer block">
              {title && (
                <h3
                  className="transition-colors mb-1 break-words"
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    fontFamily: "'Space Grotesk', sans-serif",
                    color: "#dde2f0",
                    lineHeight: 1.4,
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#c9962e"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "#dde2f0"; }}
                >
                  {title}
                </h3>
              )}
              {isEncryptedPost && !decrypted ? (
                <div
                  className="flex items-center gap-2 mb-2"
                  style={{ fontSize: 13, color: "#8090b8", fontStyle: "italic" }}
                >
                  <Lock style={{ width: 12, height: 12, color: "#c9962e" }} />
                  {decryptError
                    ? "Encrypted (key mismatch)"
                    : decryptionKey
                      ? "Decrypting…"
                      : "Encrypted — unlock community to read"}
                </div>
              ) : (
                !isCompact && displayContent && (
                  <div
                    className="mb-2 break-words"
                    style={{
                      fontSize: 13,
                      color: "#8090b8",
                      lineHeight: 1.55,
                      display: "-webkit-box",
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {linkify(displayContent)}
                  </div>
                )
              )}
            </div>
          </Link>

          {!isCompact && mediaUrls.length > 0 && (
            <MediaList urls={mediaUrls} />
          )}

          <div className="mt-2">
            <ReactionBar
              eventId={event.id}
              eventPubkey={event.pubkey}
              eventKind={event.kind}
            />
          </div>

          {/* Footer actions */}
          <div className="flex items-center gap-4 mt-2">
            <Link href={`/post/${event.id}`}>
              <div
                className="flex items-center gap-1.5 cursor-pointer transition-colors"
                style={{ fontSize: 11, color: "#3d4f70", fontFamily: "'Space Grotesk', sans-serif" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#8090b8"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "#3d4f70"; }}
              >
                <MessageSquare style={{ width: 12, height: 12 }} />
                {replyCount} replies
              </div>
            </Link>
            <BookmarkButton event={event} />
            {effectiveCanModerate && community && (
              <ModerateRemoveButton
                eventId={event.id}
                authorPubkey={event.pubkey}
                community={community}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ModerateRemoveButton({
  eventId,
  authorPubkey,
  community,
}: {
  eventId: string;
  authorPubkey: string;
  community: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const submit = async () => {
    setBusy(true);
    try {
      await publishModAction({
        community,
        action: "remove_post",
        targetEventId: eventId,
        targetPubkey: authorPubkey,
        reason: reason.trim() || undefined,
      });
      toast({
        title: "Post removed",
        description: "Signed audit event published to the mod log.",
      });
      setOpen(false);
      setReason("");
    } catch (err) {
      toast({
        title: "Mod action failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          className="flex items-center gap-1 cursor-pointer transition-colors"
          type="button"
          style={{ fontSize: 11, color: "#3d4f70", fontFamily: "'Space Grotesk', sans-serif" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#ef4444"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "#3d4f70"; }}
        >
          <Gavel style={{ width: 12, height: 12 }} />
          Remove
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Remove post</DialogTitle>
          <DialogDescription>
            This publishes a signed kind:9000 audit event to the relay set.
            Other moderators and the public can see this action in the Mod Log tab.
          </DialogDescription>
        </DialogHeader>
        <Input
          placeholder="Reason (optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Remove"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
