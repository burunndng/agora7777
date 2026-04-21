import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { Search as SearchIcon, AlertTriangle, Database, Globe } from "lucide-react";
import { PostCard } from "@/components/post-card";
import { SearchBar } from "@/components/search-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSearch } from "@/lib/search/use-search";
import type { SearchKindFilter } from "@/lib/search/nostr-band";
import { authorLabel, hexToNpub } from "@/lib/nostr/format";
import type { Event as NostrEvent } from "nostr-tools/core";

// wouter's hash hook routes a path like `/search?q=foo` into a url where the
// hash holds only `/search` and the query string lives in `location.search`.
// We read it from the URL directly so deep links and in-app navigation agree.
function useQueryParam(name: string): string {
  const [location] = useLocation();
  return useMemo(() => {
    if (typeof window === "undefined") return "";
    const params = new URLSearchParams(window.location.search);
    return params.get(name) ?? "";
    // location is in the deps so we re-read on every navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, name]);
}

function communityFromEvent(event: NostrEvent): string | null {
  const a = event.tags.find((t) => t[0] === "a" && (t[1] ?? "").startsWith("34550:"));
  if (a) return a[1].split(":")[2] ?? null;
  const t = event.tags.find((tag) => tag[0] === "t");
  return t?.[1] ?? null;
}

function ProfileResultCard({ event, sources }: { event: NostrEvent; sources: string[] }) {
  let parsed: { name?: string; display_name?: string; about?: string; nip05?: string } = {};
  try {
    parsed = JSON.parse(event.content);
  } catch {
    /* ignore */
  }
  const npub = hexToNpub(event.pubkey);
  return (
    <Link href={`/profile/${npub}`}>
      <div className="p-4 border-b border-border hover:bg-secondary/20 transition-colors cursor-pointer flex gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-bold text-foreground truncate">
            {parsed.display_name || parsed.name || "Anonymous"}
          </h3>
          <div className="text-xs text-muted-foreground font-mono truncate">
            {authorLabel(npub, parsed.display_name || parsed.name)}
            {parsed.nip05 && <span className="ml-2 text-primary">{parsed.nip05}</span>}
          </div>
          {parsed.about && (
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{parsed.about}</p>
          )}
        </div>
        <div className="flex flex-col gap-1 items-end shrink-0">
          {sources.map((s) => (
            <Badge key={s} variant="outline" className="text-[10px] h-5">
              {s === "local" ? <Database className="h-3 w-3 mr-1" /> : <Globe className="h-3 w-3 mr-1" />}
              {s}
            </Badge>
          ))}
        </div>
      </div>
    </Link>
  );
}

export default function SearchPage() {
  const initialQuery = useQueryParam("q");
  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState<SearchKindFilter>("posts");

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  const { hits, loadingRemote, remoteError, localCount, remoteCount } = useSearch(query, filter);

  return (
    <div className="flex flex-col min-h-screen">
      <div className="border-b border-border bg-card/50 sticky top-0 z-10 backdrop-blur-md px-4 py-3 space-y-3">
        <h1 className="text-xl font-bold font-mono text-primary flex items-center gap-2">
          <SearchIcon className="h-5 w-5" />
          Search
        </h1>
        <SearchBar initialQuery={initialQuery} />
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={filter === "posts" ? "default" : "outline"}
            onClick={() => setFilter("posts")}
            className="h-11 min-w-[80px]"
            data-testid="filter-posts"
          >
            Posts
          </Button>
          <Button
            type="button"
            size="sm"
            variant={filter === "profiles" ? "default" : "outline"}
            onClick={() => setFilter("profiles")}
            className="h-11 min-w-[80px]"
            data-testid="filter-profiles"
          >
            Profiles
          </Button>
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground font-mono">
            <Badge variant="outline" className="h-5">
              <Database className="h-3 w-3 mr-1" /> {localCount} cached
            </Badge>
            <Badge variant="outline" className="h-5">
              <Globe className="h-3 w-3 mr-1" /> {loadingRemote ? "…" : remoteCount} nostr.band
            </Badge>
          </div>
        </div>
      </div>

      {remoteError && (
        <div className="mx-4 mt-4 p-3 border border-destructive/40 bg-destructive/5 rounded-md text-sm font-mono text-destructive flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span className="break-words">
            Remote search failed: {remoteError}. Showing cached results only.
          </span>
        </div>
      )}

      {!query.trim() ? (
        <div className="p-8 text-center text-muted-foreground font-mono">
          Type a query above. Local cache is searched offline; nostr.band is queried online.
        </div>
      ) : loadingRemote && hits.length === 0 ? (
        <div className="flex flex-col">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="p-4 border-b border-border flex gap-4">
              <Skeleton className="w-8 h-20" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-12 w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : hits.length === 0 ? (
        <div className="p-8 text-center text-muted-foreground font-mono">
          No results for "{query}".
        </div>
      ) : (
        <div className="flex flex-col">
          {hits.map((hit) =>
            hit.event.kind === 0 ? (
              <ProfileResultCard
                key={hit.event.id}
                event={hit.event}
                sources={hit.sources}
              />
            ) : (
              <div key={hit.event.id} className="relative">
                <PostCard
                  event={hit.event}
                  community={communityFromEvent(hit.event)}
                />
                <div className="absolute right-3 top-3 flex flex-col gap-1 items-end pointer-events-none">
                  {hit.sources.map((s) => (
                    <Badge key={s} variant="outline" className="text-[10px] h-5">
                      {s === "local" ? <Database className="h-3 w-3 mr-1" /> : <Globe className="h-3 w-3 mr-1" />}
                      {s}
                    </Badge>
                  ))}
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
