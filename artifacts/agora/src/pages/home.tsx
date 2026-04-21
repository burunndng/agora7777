import { useMemo } from "react";
import { PostCard } from "@/components/post-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useIdentityStore } from "@/lib/nostr/store";
import { Activity, Zap } from "lucide-react";
import { useNostrQuery } from "@/lib/nostr/pool";
import { eventPow, scorePost } from "@/lib/nostr/scoring";
import type { Event as NostrEvent } from "nostr-tools/core";

const FEED_LIMIT = 60;

function communityFromEvent(event: NostrEvent): string | null {
  const a = event.tags.find((t) => t[0] === "a" && (t[1] ?? "").startsWith("34550:"));
  if (a) return a[1].split(":")[2] ?? null;
  const t = event.tags.find((tag) => tag[0] === "t");
  return t?.[1] ?? null;
}

export default function Home() {
  const identity = useIdentityStore((s) => s.identity);
  const npub = identity?.npub ?? null;

  const { events, loading } = useNostrQuery(
    { kinds: [1, 11], limit: FEED_LIMIT },
    [],
  );

  const ranked = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    return events
      .filter((e) => !e.tags.some((t) => t[0] === "e"))
      .map((event) => ({
        event,
        score: scorePost({
          upvotes: [],
          downvotes: [],
          postPow: eventPow(event),
          ageHours: Math.max(0, (now - event.created_at) / 3600),
        }),
      }))
      .sort((a, b) => b.score - a.score);
  }, [events]);

  const trending = ranked.slice(0, 3);
  const feed = ranked.slice(3);

  return (
    <div className="flex flex-col min-h-screen">
      <div className="border-b border-border bg-card/50 sticky top-0 z-10 backdrop-blur-md px-4 py-3">
        <h1 className="text-xl font-bold font-mono text-primary flex items-center gap-2">
          <Activity className="h-5 w-5" />
          Global Feed
        </h1>
      </div>

      {!npub && (
        <div className="p-6 bg-secondary/30 border-b border-border">
          <h2 className="text-lg font-bold text-foreground mb-2">Welcome to Agora</h2>
          <p className="text-muted-foreground text-sm mb-4 font-mono">
            A decentralized, censorship-resistant forum on Nostr. Nobody owns your keys.
          </p>
          <Link href="/login">
            <Button size="sm">Connect Identity</Button>
          </Link>
        </div>
      )}

      {trending.length > 0 && (
        <div className="border-b border-border">
          <div className="px-4 py-2 bg-secondary/50 border-b border-border text-xs font-bold text-primary flex items-center gap-2 uppercase tracking-widest">
            <Zap className="h-3 w-3" /> Trending Now
          </div>
          {trending.map(({ event, score }) => (
            <PostCard
              key={`trending-${event.id}`}
              event={event}
              score={score}
              community={communityFromEvent(event)}
              isCompact
            />
          ))}
        </div>
      )}

      <div className="px-4 py-2 bg-secondary/50 border-b border-border text-xs font-bold text-muted-foreground uppercase tracking-widest">
        Latest Posts
      </div>

      <div className="flex-1 flex flex-col">
        {loading && events.length === 0 ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="p-4 border-b border-border flex gap-4">
              <Skeleton className="w-8 h-24" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-16 w-full" />
              </div>
            </div>
          ))
        ) : feed.length > 0 ? (
          feed.map(({ event, score }) => (
            <PostCard
              key={`feed-${event.id}`}
              event={event}
              score={score}
              community={communityFromEvent(event)}
            />
          ))
        ) : (
          <div className="p-8 text-center text-muted-foreground font-mono">
            No posts yet — your relays returned no events.
          </div>
        )}
      </div>
    </div>
  );
}
