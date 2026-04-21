import { useEffect } from "react";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { Inbox as InboxIcon, MessageSquare, AtSign, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useIdentityStore } from "@/lib/nostr/store";
import { useInbox, inboxThreadAnchor, inboxKind } from "@/lib/nostr/inbox";
import { useProfile } from "@/lib/nostr/profiles";
import { authorLabel, hexToNpub } from "@/lib/nostr/format";
import type { Event as NostrEvent } from "nostr-tools/core";

export default function Inbox() {
  const identity = useIdentityStore((s) => s.identity);
  const { events, loading, lastSeenAt, unreadCount, markAllRead } = useInbox();

  // Auto-mark read on view so the badge clears once the user opens the page.
  useEffect(() => {
    if (!identity) return;
    if (events.length === 0) return;
    const t = window.setTimeout(() => {
      void markAllRead();
    }, 800);
    return () => window.clearTimeout(t);
  }, [identity, events, markAllRead]);

  if (!identity) {
    return (
      <div className="flex flex-col min-h-screen">
        <Header />
        <div className="p-8 text-center text-muted-foreground font-mono">
          Connect your identity to receive replies and mentions.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen">
      <Header unread={unreadCount} onMarkRead={() => void markAllRead()} />

      {loading && events.length === 0 ? (
        <div className="p-8 text-center text-muted-foreground font-mono">
          Listening for replies and mentions on your relays…
        </div>
      ) : events.length === 0 ? (
        <div className="p-8 text-center text-muted-foreground font-mono">
          No replies or mentions yet.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {events.map((event) => (
            <InboxRow key={event.id} event={event} lastSeenAt={lastSeenAt} />
          ))}
        </div>
      )}
    </div>
  );
}

function Header({
  unread,
  onMarkRead,
}: {
  unread?: number;
  onMarkRead?: () => void;
}) {
  return (
    <div className="border-b border-border bg-card/50 sticky top-0 z-10 backdrop-blur-md px-4 py-3 flex items-center justify-between gap-3">
      <h1 className="text-xl font-bold font-mono text-primary flex items-center gap-2">
        <InboxIcon className="h-5 w-5" />
        Inbox
        {typeof unread === "number" && unread > 0 && (
          <Badge variant="secondary" className="font-mono">
            {unread} new
          </Badge>
        )}
      </h1>
      {onMarkRead && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onMarkRead}
          className="font-mono text-xs"
          data-testid="inbox-mark-read"
        >
          <CheckCheck className="h-4 w-4 mr-1" />
          Mark all read
        </Button>
      )}
    </div>
  );
}

function InboxRow({
  event,
  lastSeenAt,
}: {
  event: NostrEvent;
  lastSeenAt: number;
}) {
  const { profile } = useProfile(event.pubkey);
  const npub = hexToNpub(event.pubkey);
  const kind = inboxKind(event);
  const anchor = inboxThreadAnchor(event);
  const community = event.tags.find(
    (t) => t[0] === "a" && (t[1] ?? "").startsWith("34550:"),
  )?.[1].split(":")[2];
  const unread = event.created_at > lastSeenAt;
  const Icon = kind === "reply" ? MessageSquare : AtSign;

  const linkTarget = anchor ? `/post/${anchor}` : `/profile/${npub}`;

  return (
    <Link href={linkTarget}>
      <div
        className={`block p-4 cursor-pointer hover:bg-secondary/20 transition-colors ${unread ? "bg-primary/5 border-l-2 border-primary" : ""}`}
        data-testid="inbox-row"
        data-unread={unread ? "true" : "false"}
      >
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2 font-mono flex-wrap">
          <Icon className="h-3.5 w-3.5" />
          <span className="uppercase tracking-wider">
            {kind === "reply" ? "Reply" : "Mention"}
          </span>
          <span>•</span>
          <span className="hover:underline text-primary">
            {authorLabel(npub, profile?.display_name || profile?.name)}
          </span>
          {community && (
            <>
              <span>•</span>
              <span className="text-foreground">n/{community}</span>
            </>
          )}
          <span>•</span>
          <span suppressHydrationWarning>
            {formatDistanceToNow(new Date(event.created_at * 1000), {
              addSuffix: true,
            })}
          </span>
        </div>
        <div className="text-sm text-foreground font-mono whitespace-pre-wrap break-words line-clamp-3">
          {event.content || <span className="italic text-muted-foreground">(empty)</span>}
        </div>
      </div>
    </Link>
  );
}
