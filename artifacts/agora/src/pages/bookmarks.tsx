import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Bookmark } from "lucide-react";
import { useIdentityStore } from "@/lib/nostr/store";
import { useBookmarkList } from "@/lib/nostr/bookmarks";
import { useNostrPool } from "@/lib/nostr/pool";
import { PostCard } from "@/components/post-card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Event as NostrEvent } from "nostr-tools/core";

function communityFromEvent(event: NostrEvent): string | null {
  const a = event.tags.find(
    (t) => t[0] === "a" && (t[1] ?? "").startsWith("34550:"),
  );
  if (a) return a[1].split(":")[2] ?? null;
  const t = event.tags.find((tag) => tag[0] === "t");
  return t?.[1] ?? null;
}

export default function Bookmarks() {
  const identity = useIdentityStore((s) => s.identity);
  const { records, loading } = useBookmarkList();
  const { pool, relays } = useNostrPool();
  const [hydrated, setHydrated] = useState<Map<string, NostrEvent>>(new Map());

  // Find any bookmarked ids that don't have a cached event payload and
  // fetch them from the relay set so the list still renders after disk
  // recovery / older bookmarks made before snapshots were stored.
  const missingIds = useMemo(
    () => records.filter((r) => !r.event && !hydrated.has(r.id)).map((r) => r.id),
    [records, hydrated],
  );

  useEffect(() => {
    if (missingIds.length === 0) return;
    const sub = pool.subscribeMany(
      relays,
      { ids: missingIds, limit: missingIds.length },
      {
        onevent: (event) => {
          setHydrated((prev) => {
            if (prev.has(event.id)) return prev;
            const next = new Map(prev);
            next.set(event.id, event);
            return next;
          });
        },
        oneose: () => sub.close(),
      },
    );
    return () => sub.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingIds.join(","), relays.join(",")]);

  if (!identity) {
    return (
      <div className="flex flex-col min-h-screen">
        <Header />
        <div className="p-8 text-center text-muted-foreground font-mono">
          Connect your identity to view your encrypted local bookmarks.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen">
      <Header count={records.length} />

      {loading && records.length === 0 ? (
        <div className="p-4 space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : records.length === 0 ? (
        <div className="p-8 text-center text-muted-foreground font-mono">
          No bookmarks yet. Tap the bookmark icon on any post to save it
          here. Bookmarks live only on this device, encrypted with your
          identity key.
        </div>
      ) : (
        <div>
          {records.map((rec) => {
            const ev = rec.event ?? hydrated.get(rec.id);
            if (!ev) {
              return (
                <div
                  key={rec.id}
                  className="p-4 border-b border-border bg-card"
                >
                  <div className="text-xs text-muted-foreground font-mono mb-1">
                    Loading bookmarked post…
                  </div>
                  <Link href={`/post/${rec.id}`}>
                    <span className="text-sm text-primary hover:underline font-mono break-all cursor-pointer">
                      {rec.id.slice(0, 16)}…
                    </span>
                  </Link>
                </div>
              );
            }
            return (
              <PostCard
                key={rec.id}
                event={ev}
                community={communityFromEvent(ev)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function Header({ count }: { count?: number }) {
  return (
    <div className="border-b border-border bg-card/50 sticky top-0 z-10 backdrop-blur-md px-4 py-3 flex items-center justify-between">
      <h1 className="text-xl font-bold font-mono text-primary flex items-center gap-2">
        <Bookmark className="h-5 w-5" />
        Bookmarks
      </h1>
      {typeof count === "number" && (
        <span className="text-xs text-muted-foreground font-mono">
          {count} saved
        </span>
      )}
    </div>
  );
}
