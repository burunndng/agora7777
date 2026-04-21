import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Users,
  Activity,
  Hash,
  MessageSquare,
  Lock,
  Sparkles,
  Globe,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useNostrQuery } from "@/lib/nostr/pool";
import { parseCommunity, type Community } from "@/lib/nostr/communities";
import { CreateCommunityDialog } from "@/components/create-community-dialog";
import { useIdentityStore } from "@/lib/nostr/store";
import { useIsAdmin, useIsModerator } from "@/lib/nostr/roles";

export default function Communities() {
  const [search, setSearch] = useState("");
  const me = useIdentityStore((s) => s.identity);
  const [, setLocation] = useLocation();
  const isAdmin = useIsAdmin();
  const isMod = useIsModerator();
  const canCreate = !!me && (isAdmin || isMod);
  const { events: communityEvents, loading } = useNostrQuery(
    { kinds: [34550], limit: 200 },
    [],
  );
  const { events: postEvents } = useNostrQuery(
    { kinds: [1, 11], limit: 200 },
    [],
  );

  const communities = useMemo<Community[]>(() => {
    // Keep the most-recent metadata event per identifier so updates win.
    const newest = new Map<string, Community>();
    for (const evt of communityEvents) {
      const c = parseCommunity(evt);
      if (!c) continue;
      const prev = newest.get(c.identifier);
      if (!prev || c.createdAt > prev.createdAt) newest.set(c.identifier, c);
    }
    return Array.from(newest.values());
  }, [communityEvents]);

  const postsByCommunity = useMemo(() => {
    const counts = new Map<string, number>();
    for (const evt of postEvents) {
      const a = evt.tags.find((t) => t[0] === "a" && (t[1] ?? "").startsWith("34550:"));
      const id = a ? a[1].split(":")[2] : null;
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [postEvents]);

  const filtered = communities.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.identifier.toLowerCase().includes(search.toLowerCase()),
  );

  // Stack Agora-native rooms (created in this client, carrying ["app","agora"])
  // above wider federation rooms. Within each section, sort newest-first so
  // freshly-created communities surface immediately. The split is a UI hint
  // only — the tag is spoofable, so do not rely on it for trust decisions.
  const agoraCommunities = useMemo(
    () =>
      filtered
        .filter((c) => c.isAgora)
        .sort((a, b) => b.createdAt - a.createdAt),
    [filtered],
  );
  const federationCommunities = useMemo(
    () =>
      filtered
        .filter((c) => !c.isAgora)
        .sort((a, b) => b.createdAt - a.createdAt),
    [filtered],
  );

  const stats = {
    totalCommunities: communities.length,
    totalAgora: communities.filter((c) => c.isAgora).length,
    totalPosts: postEvents.length,
  };

  return (
    <div className="flex flex-col md:flex-row min-h-screen">
      <div className="flex-1 flex flex-col min-w-0 border-r border-border">
        <div className="border-b border-border bg-card/50 sticky top-0 z-10 backdrop-blur-md px-4 py-3 flex items-center justify-between gap-3">
          <h1 className="text-xl font-bold font-mono text-primary flex items-center gap-2">
            <Users className="h-5 w-5" />
            Communities
          </h1>
          {canCreate && (
            <CreateCommunityDialog
              onCreated={(identifier) =>
                setLocation(`/community/${encodeURIComponent(identifier)}`)
              }
            />
          )}
        </div>

        <div className="p-4 border-b border-border">
          <Input
            placeholder="Search communities..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="font-mono bg-secondary/30"
          />
        </div>

        <div className="flex-1">
          {loading && communities.length === 0 ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="p-4 border-b border-border flex items-center gap-4">
                <Skeleton className="w-12 h-12 rounded-md" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-5 w-1/3" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              </div>
            ))
          ) : filtered.length > 0 ? (
            <>
              <CommunitySection
                title="Agora communities"
                subtitle="Rooms created from inside this client."
                icon={<Sparkles className="h-3.5 w-3.5" />}
                accent="agora"
                communities={agoraCommunities}
                postsByCommunity={postsByCommunity}
                emptyHint={
                  search
                    ? "No Agora rooms match your search."
                    : "No Agora-native rooms yet — be the first to create one."
                }
              />
              <CommunitySection
                title="Federation"
                subtitle="Wider Nostr communities seen on your relays."
                icon={<Globe className="h-3.5 w-3.5" />}
                accent="federation"
                communities={federationCommunities}
                postsByCommunity={postsByCommunity}
                emptyHint={
                  search
                    ? "No federation rooms match your search."
                    : "No federation rooms surfaced yet — try adding more relays."
                }
              />
            </>
          ) : (
            <div className="p-8 text-center text-muted-foreground font-mono">
              No communities found on connected relays.
            </div>
          )}
        </div>
      </div>

      <div className="w-full md:w-64 bg-card shrink-0 hidden md:block">
        <div className="p-4 border-b border-border sticky top-0 bg-card/50 backdrop-blur-md">
          <h2 className="font-bold text-sm text-muted-foreground uppercase tracking-widest flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Network Stats
          </h2>
        </div>
        <div className="p-4 flex flex-col gap-6">
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1 font-mono">
              Agora rooms
            </div>
            <div className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              {stats.totalAgora.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1 font-mono">
              Total seen (with federation)
            </div>
            <div className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Hash className="h-5 w-5 text-primary" />
              {stats.totalCommunities.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1 font-mono">
              Cached posts
            </div>
            <div className="text-2xl font-bold text-foreground flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-primary" />
              {stats.totalPosts.toLocaleString()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CommunitySection({
  title,
  subtitle,
  icon,
  accent,
  communities,
  postsByCommunity,
  emptyHint,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  accent: "agora" | "federation";
  communities: Community[];
  postsByCommunity: Map<string, number>;
  emptyHint: string;
}) {
  const accentColor = accent === "agora" ? "text-primary" : "text-muted-foreground";
  const accentBorder =
    accent === "agora" ? "border-primary/40" : "border-muted-foreground/30";
  return (
    <div>
      <div className="px-4 py-3 border-b border-border bg-secondary/10 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1.5 ${accentColor}`}>
            {icon}
            <h2 className="text-xs font-bold font-mono uppercase tracking-widest">
              {title}
            </h2>
          </span>
          <span className="text-[10px] font-mono text-muted-foreground border border-border px-1.5 py-0.5 rounded-sm">
            {communities.length}
          </span>
        </div>
        <p className="text-[11px] font-mono text-muted-foreground hidden sm:block">
          {subtitle}
        </p>
      </div>
      {communities.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground font-mono border-b border-border">
          {emptyHint}
        </div>
      ) : (
        communities.map((community) => (
          <Link
            key={community.identifier}
            href={`/community/${encodeURIComponent(community.identifier)}`}
          >
            <div
              className="p-4 border-b border-border hover:bg-secondary/20 transition-colors cursor-pointer group flex items-start gap-4"
              data-testid={`row-community-${community.identifier}`}
            >
              <div className="w-12 h-12 rounded-md bg-secondary/50 flex items-center justify-center text-primary font-bold text-xl shrink-0 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                {community.identifier.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-bold text-foreground group-hover:text-primary transition-colors flex items-center gap-2 flex-wrap">
                  {community.name}
                  <span
                    className={`text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm border ${accentBorder} ${accentColor}`}
                    data-testid={`badge-origin-${community.identifier}`}
                  >
                    {accent === "agora" ? "Agora" : "Federation"}
                  </span>
                  {community.encrypted && (
                    <span
                      className="text-[10px] font-mono text-primary border border-primary/40 px-1.5 py-0.5 rounded-sm flex items-center gap-1"
                      data-testid={`badge-encrypted-${community.identifier}`}
                    >
                      <Lock className="h-3 w-3" /> ENCRYPTED
                    </span>
                  )}
                  <span className="text-xs font-normal text-muted-foreground bg-secondary/50 px-2 py-0.5 rounded-sm font-mono">
                    n/{community.identifier}
                  </span>
                </h3>
                {community.description && (
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                    {community.description}
                  </p>
                )}
                <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground font-mono">
                  <div className="flex items-center gap-1">
                    <MessageSquare className="h-3.5 w-3.5" />
                    {postsByCommunity.get(community.identifier) ?? 0} cached posts
                  </div>
                </div>
              </div>
            </div>
          </Link>
        ))
      )}
    </div>
  );
}

