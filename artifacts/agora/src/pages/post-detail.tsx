import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "wouter";
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  ShieldAlert,
  MessageSquare,
  Lock,
} from "lucide-react";
import {
  ENCRYPTION_SCHEME,
  decryptString,
  parseCommunity,
  useCommunityKey,
} from "@/lib/nostr/communities";
import { UnlockCommunityDialog } from "@/components/unlock-community-dialog";
import { Button } from "@/components/ui/button";
import { authorLabel, hexToNpub } from "@/lib/nostr/format";
import { Nip05Badge } from "@/components/nip05-badge";
import { formatDistanceToNow } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useIdentityStore, useRelayStore } from "@/lib/nostr/store";
import { useNostrQuery, publishSigned } from "@/lib/nostr/pool";
import { useProfile } from "@/lib/nostr/profiles";
import { eventPow } from "@/lib/nostr/scoring";
import { minePowAsync } from "@/lib/nostr/miner";
import type { Event as NostrEvent } from "nostr-tools/core";
import type { EventTemplate } from "nostr-tools/core";
import type { UnsignedEvent } from "nostr-tools/pure";
import * as nip10 from "nostr-tools/nip10";
import { MediaList } from "@/components/media";
import { extractMediaUrls } from "@/lib/media/event-tags";
import { ReactionBar } from "@/components/reaction-bar";
import { BookmarkButton } from "@/components/bookmark-button";

const VOTE_POW_DIFFICULTY = 8;

const DEPTH_COLORS = [
  "#c9962e",
  "#7a5818",
  "#3d4f70",
  "#1a2240",
];

function findRoot(event: NostrEvent): { id: string; author?: string } {
  const parsed = nip10.parse(event);
  if (parsed.root) return { id: parsed.root.id, author: parsed.root.author };
  if (parsed.reply) return { id: parsed.reply.id, author: parsed.reply.author };
  return { id: event.id, author: event.pubkey };
}

function buildTree(root: NostrEvent, replies: NostrEvent[]) {
  const byParent = new Map<string, NostrEvent[]>();
  for (const r of replies) {
    const parsed = nip10.parse(r);
    const parentId = parsed.reply?.id ?? parsed.root?.id ?? root.id;
    const list = byParent.get(parentId) ?? [];
    list.push(r);
    byParent.set(parentId, list);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.created_at - b.created_at);
  return byParent;
}

function isEncryptedEvent(event: NostrEvent): boolean {
  return event.tags.some(
    (t) =>
      (t[0] === "encrypted" || t[0] === "encryption") &&
      t[1] === ENCRYPTION_SCHEME,
  );
}

function useDecryptedContent(
  event: NostrEvent | null,
  community: string | null,
  key: Uint8Array | null,
):
  | { state: "plain"; text: string }
  | { state: "decrypted"; text: string }
  | { state: "locked" }
  | { state: "error" } {
  const encrypted = event ? isEncryptedEvent(event) : false;
  const content = event?.content ?? "";
  const [decrypted, setDecrypted] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!encrypted || !community || !key || !event) {
      setDecrypted(null);
      setError(false);
      return;
    }
    let cancelled = false;
    decryptString(key, content, community)
      .then((plain) => {
        if (!cancelled) {
          setDecrypted(plain);
          setError(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDecrypted(null);
          setError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [encrypted, content, community, key, event]);

  if (!encrypted) return { state: "plain", text: content };
  if (decrypted !== null) return { state: "decrypted", text: decrypted };
  if (error) return { state: "error" };
  return { state: "locked" };
}

function ContentBlock({
  content,
  className = "",
}: {
  content:
    | { state: "plain"; text: string }
    | { state: "decrypted"; text: string }
    | { state: "locked" }
    | { state: "error" };
  className?: string;
}) {
  if (content.state === "locked") {
    return (
      <div
        className={`flex items-center gap-2 italic ${className}`}
        style={{ color: "#8090b8" }}
      >
        <Lock className="h-3 w-3" style={{ color: "#c9962e" }} />
        Encrypted content — unlock the community to read.
      </div>
    );
  }
  if (content.state === "error") {
    return (
      <div className={`italic ${className}`} style={{ color: "#ef4444" }}>
        Failed to decrypt with the current community key.
      </div>
    );
  }
  return (
    <div
      className={`whitespace-pre-wrap break-words ${className}`}
      style={{ color: "#dde2f0", lineHeight: 1.7 }}
    >
      {content.text}
    </div>
  );
}

function DiamondVoteBtn({
  direction,
  onClick,
  disabled,
}: {
  direction: "up" | "down";
  onClick: () => void;
  disabled?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const goldColor = "#c9962e";
  const dimColor = "#1a2240";
  const bg = hovered && !disabled ? goldColor : dimColor;
  const iconColor = hovered && !disabled ? "#070b14" : "#8090b8";

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      disabled={disabled}
      className="transition-all active:scale-95"
      style={{
        width: 40,
        height: 40,
        clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
        backgroundColor: bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "not-allowed" : "pointer",
        border: "none",
        outline: "none",
        opacity: disabled ? 0.5 : 1,
      }}
      title={direction === "up" ? "Upvote" : "Downvote"}
    >
      {direction === "up" ? (
        <ArrowUp style={{ width: 18, height: 18, color: iconColor, strokeWidth: 2.5 }} />
      ) : (
        <ArrowDown style={{ width: 18, height: 18, color: iconColor, strokeWidth: 2.5 }} />
      )}
    </button>
  );
}

function CommentNode({
  event,
  byParent,
  depth = 0,
  community,
  decryptionKey,
}: {
  event: NostrEvent;
  byParent: Map<string, NostrEvent[]>;
  depth?: number;
  community: string | null;
  decryptionKey: Uint8Array | null;
}) {
  const { profile } = useProfile(event.pubkey);
  const npub = hexToNpub(event.pubkey);
  const children = byParent.get(event.id) ?? [];
  const pow = eventPow(event);
  const content = useDecryptedContent(event, community, decryptionKey);
  const depthColor = DEPTH_COLORS[Math.min(depth, DEPTH_COLORS.length - 1)];

  return (
    <div
      style={{
        borderLeft: `1px solid ${depthColor}`,
        marginLeft: depth === 0 ? 0 : 16,
        marginTop: 12,
        paddingLeft: 12,
        opacity: depth > 3 ? 0.8 : 1,
      }}
    >
      <div
        className="flex items-center gap-2 flex-wrap mb-1"
        style={{ fontSize: 11, color: "#8090b8" }}
      >
        <Link href={`/profile/${npub}`}>
          <span
            style={{ color: "#c9962e", fontFamily: "monospace", cursor: "pointer" }}
            className="hover:underline"
          >
            {authorLabel(npub, profile?.display_name || profile?.name)}
          </span>
        </Link>
        {profile?.nip05 && (
          <Nip05Badge value={profile.nip05} pubkey={event.pubkey} size="xs" />
        )}
        <span style={{ color: "#3d4f70" }}>·</span>
        <span style={{ color: "#3d4f70" }} suppressHydrationWarning>
          {formatDistanceToNow(new Date(event.created_at * 1000), { addSuffix: true })}
        </span>
        {pow > 0 && (
          <span
            style={{
              fontSize: 10,
              color: "#c9962e",
              border: "1px solid #7a5818",
              padding: "0 5px",
              fontFamily: "'Space Grotesk', sans-serif",
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
            }}
          >
            <ShieldAlert style={{ width: 10, height: 10 }} />
            PoW {pow}
          </span>
        )}
      </div>
      <ContentBlock content={content} className="text-sm" />
      <div className="mt-2">
        <ReactionBar
          eventId={event.id}
          eventPubkey={event.pubkey}
          eventKind={event.kind}
        />
      </div>
      {children.map((c) => (
        <CommentNode
          key={c.id}
          event={c}
          byParent={byParent}
          depth={depth + 1}
          community={community}
          decryptionKey={decryptionKey}
        />
      ))}
    </div>
  );
}

export default function PostDetail() {
  const params = useParams();
  const eventId = params.eventId || "";
  const { toast } = useToast();
  const identity = useIdentityStore((s) => s.identity);
  const firstSeen = useIdentityStore((s) => s.firstSeen);
  const relays = useRelayStore((s) => s.relays);
  const [voting, setVoting] = useState<"idle" | "mining" | "broadcasting">("idle");

  const { events: rootEvents, loading } = useNostrQuery(
    eventId ? { ids: [eventId], limit: 1 } : null,
    [eventId],
  );
  const post = rootEvents[0];

  const { events: replies } = useNostrQuery(
    eventId ? { kinds: [1, 11], "#e": [eventId], limit: 200 } : null,
    [eventId],
  );

  const { events: reactions } = useNostrQuery(
    eventId ? { kinds: [7], "#e": [eventId], limit: 500 } : null,
    [eventId],
  );

  const { profile: authorProfile } = useProfile(post?.pubkey);

  const communityIdentifier = useMemo<string | null>(() => {
    if (!post) return null;
    const a = post.tags.find(
      (t) => t[0] === "a" && (t[1] ?? "").startsWith("34550:"),
    )?.[1];
    return a ? a.split(":")[2] ?? null : null;
  }, [post]);

  const { events: communityEvents } = useNostrQuery(
    communityIdentifier
      ? { kinds: [34550], "#d": [communityIdentifier], limit: 10 }
      : null,
    [communityIdentifier],
  );
  const communityMeta = useMemo(() => {
    if (communityEvents.length === 0) return null;
    const newest = [...communityEvents].sort(
      (a, b) => b.created_at - a.created_at,
    )[0];
    return parseCommunity(newest);
  }, [communityEvents]);

  const { key: communityKey } = useCommunityKey(communityIdentifier);
  const rootContent = useDecryptedContent(
    post ?? null,
    communityIdentifier,
    communityKey,
  );

  const byParent = useMemo(
    () => (post ? buildTree(post, replies) : new Map<string, NostrEvent[]>()),
    [post, replies],
  );

  const score = useMemo(() => {
    let up = 0;
    let down = 0;
    for (const r of reactions) {
      const c = r.content.trim();
      if (c === "" || c === "+" || c === "🤙" || c === "👍") up += 1 + eventPow(r) * 0.05;
      else if (c === "-" || c === "👎") down += 1 + eventPow(r) * 0.05;
    }
    return up - down;
  }, [reactions]);

  const handleVote = async (direction: "up" | "down") => {
    if (!identity) {
      toast({
        title: "Authentication required",
        description: "Connect your identity to vote.",
        variant: "destructive",
      });
      return;
    }
    if (!post || voting !== "idle") return;

    const now = Math.floor(Date.now() / 1000);
    const ageDays = Math.max(
      0,
      firstSeen ? Math.floor((now - firstSeen) / 86400) : 0,
    );
    const baseTags: string[][] = [
      ["e", post.id],
      ["p", post.pubkey],
      ["k", String(post.kind)],
      ["voter_first_seen", String(firstSeen ?? now)],
      ["voter_age_days", String(ageDays)],
    ];
    const baseTemplate: EventTemplate = {
      kind: 7,
      content: direction === "up" ? "+" : "-",
      created_at: now,
      tags: baseTags,
    };

    try {
      setVoting("mining");
      const unsigned: UnsignedEvent = { ...baseTemplate, pubkey: identity.pubkey };
      const mined = await minePowAsync(unsigned, VOTE_POW_DIFFICULTY);
      const toSign: EventTemplate = {
        kind: mined.kind,
        content: mined.content,
        created_at: mined.created_at,
        tags: mined.tags,
      };
      setVoting("broadcasting");
      const signed = identity.signEvent(toSign);
      await publishSigned(signed, relays);
      toast({
        title: "Vote broadcast",
        description: `Reaction signed (PoW ${eventPow(signed)}) and sent to ${relays.length} relays.`,
      });
    } catch (err) {
      toast({
        title: "Vote failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setVoting("idle");
    }
  };

  if (loading && !post) {
    return (
      <div className="flex flex-col min-h-screen" style={{ backgroundColor: "#070b14" }}>
        <div
          className="sticky top-0 z-10 px-4 py-3 flex items-center gap-3"
          style={{ backgroundColor: "#0f1528", borderBottom: "1px solid #1a2240" }}
        >
          <Skeleton className="h-8 w-8" />
          <Skeleton className="h-6 w-1/3" />
        </div>
        <div className="p-6">
          <Skeleton className="h-10 w-3/4 mb-4" />
          <Skeleton className="h-4 w-1/4 mb-8" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="flex flex-col min-h-screen" style={{ backgroundColor: "#070b14" }}>
        <div
          className="sticky top-0 z-10 px-4 py-3 flex items-center gap-3"
          style={{ backgroundColor: "#0f1528", borderBottom: "1px solid #1a2240" }}
        >
          <Link href="/">
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <h1
            style={{
              fontSize: 18,
              fontWeight: 700,
              fontFamily: "'Space Grotesk', sans-serif",
              color: "#c9962e",
            }}
          >
            Post not found
          </h1>
        </div>
        <div
          className="p-8 text-center"
          style={{ color: "#8090b8", fontFamily: "Inter, sans-serif" }}
        >
          The event has not been seen on any of your connected relays.
        </div>
      </div>
    );
  }

  const root = findRoot(post);
  const npub = hexToNpub(post.pubkey);
  const subject = post.tags.find((t) => t[0] === "subject" || t[0] === "title")?.[1];
  const community = post.tags.find(
    (t) => t[0] === "a" && (t[1] ?? "").startsWith("34550:"),
  )?.[1].split(":")[2];
  const pow = eventPow(post);
  const mediaUrls = extractMediaUrls(post);

  return (
    <div
      className="flex flex-col min-h-screen pb-20"
      style={{ backgroundColor: "#070b14" }}
    >
      {/* Sticky nav bar */}
      <div
        className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between gap-3"
        style={{
          backgroundColor: "rgba(7,11,20,0.92)",
          borderBottom: "1px solid #1a2240",
          backdropFilter: "blur(12px)",
        }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => window.history.back()}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span
            style={{
              fontSize: 12,
              fontFamily: "monospace",
              color: "#3d4f70",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            Thread · {root.id.slice(0, 8)}
          </span>
          <BookmarkButton event={post} size="md" />
        </div>
      </div>

      {/* Post header card */}
      <div
        style={{
          backgroundColor: "#0f1528",
          borderBottom: "1px solid #1a2240",
          borderTop: "2px solid #c9962e",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Geometric corner accent */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: 60,
            height: 60,
            borderBottom: "1px solid #1a2240",
            borderLeft: "1px solid #1a2240",
            opacity: 0.3,
            pointerEvents: "none",
          }}
        />

        <div className="flex gap-4 p-4 md:p-6">
          {/* Vote column */}
          <div className="flex flex-col items-center gap-2 min-w-[44px] pt-1">
            <DiamondVoteBtn
              direction="up"
              onClick={() => void handleVote("up")}
              disabled={voting !== "idle"}
            />
            <span
              style={{
                fontSize: 16,
                fontWeight: 700,
                fontFamily: "'Space Grotesk', sans-serif",
                color: score > 0 ? "#c9962e" : score < 0 ? "#ef4444" : "#8090b8",
              }}
            >
              {voting === "mining"
                ? "…"
                : score > 0
                  ? `+${score.toFixed(1)}`
                  : score.toFixed(1)}
            </span>
            <DiamondVoteBtn
              direction="down"
              onClick={() => void handleVote("down")}
              disabled={voting !== "idle"}
            />
          </div>

          <div className="flex-1 min-w-0">
            {/* Meta */}
            <div className="flex items-center gap-2 flex-wrap mb-3" style={{ fontSize: 12 }}>
              {community && (
                <Link href={`/community/${encodeURIComponent(community)}`}>
                  <span
                    style={{
                      fontFamily: "'Space Grotesk', sans-serif",
                      fontSize: 10,
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
                  style={{ color: "#c9962e", fontFamily: "monospace", cursor: "pointer" }}
                  className="hover:underline"
                >
                  {authorLabel(npub, authorProfile?.display_name || authorProfile?.name)}
                </span>
              </Link>
              <span style={{ color: "#3d4f70" }}>·</span>
              <span style={{ color: "#3d4f70" }} suppressHydrationWarning>
                {formatDistanceToNow(new Date(post.created_at * 1000), { addSuffix: true })}
              </span>
              {pow > 0 && (
                <span
                  style={{
                    fontSize: 10,
                    color: "#c9962e",
                    border: "1px solid #7a5818",
                    padding: "0 5px",
                    fontFamily: "'Space Grotesk', sans-serif",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 3,
                  }}
                >
                  <ShieldAlert style={{ width: 10, height: 10 }} />
                  PoW {pow}
                </span>
              )}
            </div>

            {subject && (
              <h2
                className="mb-4 break-words"
                style={{
                  fontSize: "clamp(1.25rem, 3vw, 1.75rem)",
                  fontWeight: 700,
                  fontFamily: "'Space Grotesk', sans-serif",
                  color: "#dde2f0",
                  lineHeight: 1.3,
                }}
              >
                {subject}
              </h2>
            )}

            {communityMeta?.encrypted && rootContent.state !== "decrypted" && (
              <div
                className="mb-4 flex flex-wrap items-center gap-3 p-3"
                style={{
                  border: "1px solid rgba(201,150,46,0.4)",
                  backgroundColor: "rgba(201,150,46,0.05)",
                }}
              >
                <Lock className="h-4 w-4" style={{ color: "#c9962e" }} />
                <span
                  style={{ fontSize: 12, color: "#dde2f0", flex: 1, minWidth: 0 }}
                >
                  This community is password-protected. Posts and replies stay
                  encrypted at rest until unlocked.
                </span>
                <UnlockCommunityDialog community={communityMeta} />
              </div>
            )}

            <div
              className="mb-6 p-4"
              style={{
                backgroundColor: "#0c1122",
                border: "1px solid #1a2240",
                lineHeight: 1.75,
              }}
            >
              <ContentBlock content={rootContent} />
            </div>

            {mediaUrls.length > 0 && rootContent.state !== "locked" && rootContent.state !== "error" && (
              <MediaList urls={mediaUrls} className="mb-6" />
            )}

            <div className="mt-4">
              <ReactionBar
                eventId={post.id}
                eventPubkey={post.pubkey}
                eventKind={post.kind}
                size="md"
              />
            </div>

            <div
              className="flex items-center gap-6 mt-4 pt-4"
              style={{ borderTop: "1px solid #1a2240" }}
            >
              <div
                className="flex items-center gap-2"
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: "'Space Grotesk', sans-serif",
                  color: "#8090b8",
                }}
              >
                <MessageSquare className="h-4 w-4" />
                {replies.length} replies
              </div>
              <BookmarkButton event={post} size="md" withLabel />
            </div>
          </div>
        </div>
      </div>

      {/* Comments section */}
      <div className="p-4 md:p-6">
        <h3
          className="mb-4"
          style={{
            fontSize: 13,
            fontWeight: 600,
            fontFamily: "'Space Grotesk', sans-serif",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "#3d4f70",
          }}
        >
          Discussion
        </h3>
        {replies.length === 0 ? (
          <div
            className="p-8 text-center"
            style={{
              border: "1px dashed #1a2240",
              color: "#3d4f70",
              fontFamily: "'Space Grotesk', sans-serif",
            }}
          >
            <MessageSquare className="h-8 w-8 mx-auto mb-3 opacity-40" />
            No replies yet on connected relays.
          </div>
        ) : (
          (byParent.get(post.id) ?? []).map((c) => (
            <CommentNode
              key={c.id}
              event={c}
              byParent={byParent}
              community={communityIdentifier}
              decryptionKey={communityKey}
            />
          ))
        )}
      </div>
    </div>
  );
}
