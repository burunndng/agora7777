import { useMemo, useState } from "react";
import { useParams, Link } from "wouter";
import { PostCard } from "@/components/post-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Hash, ArrowLeft, Gavel, ListOrdered, Network, Lock, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNostrQuery } from "@/lib/nostr/pool";
import { eventPow, scorePost } from "@/lib/nostr/scoring";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useModLog } from "@/lib/nostr/moderation";
import { hexToNpub, authorLabel } from "@/lib/nostr/format";
import { useProfile } from "@/lib/nostr/profiles";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { useIdentityStore } from "@/lib/nostr/store";
import { FederatedFeed } from "@/components/federated-feed";
import type { FederatedKind } from "@/lib/federated/types";
import { parseMastodonTarget } from "@/lib/federated/mastodon";
import { rememberMastodonInstance } from "@/lib/federated/mastodon-hosts";
import { useCommunity, useCommunityKey, forgetCommunityKey } from "@/lib/nostr/communities";
import { UnlockCommunityDialog } from "@/components/unlock-community-dialog";
import { useIsAdmin, useIsModerator } from "@/lib/nostr/roles";

export default function CommunityDetail() {
  const params = useParams();
  const identifier = decodeURIComponent(params.identifier || "");

  const { community, loading: loadingCommunity } = useCommunity(identifier || null);
  const { entries: modEntries, loading: loadingMod } = useModLog(identifier || null);
  const me = useIdentityStore((s) => s.identity);
  const isAdmin = useIsAdmin();
  const isGlobalMod = useIsModerator();
  const { key: decryptionKey, loading: loadingKey } = useCommunityKey(
    community?.encrypted ? identifier : null,
  );
  const moderatorPubkeys = useMemo(() => {
    const set = new Set<string>();
    if (community) {
      set.add(community.pubkey);
      for (const pk of community.moderatorPubkeys) set.add(pk);
    }
    return set;
  }, [community]);
  const isPerCommunityMod = !!me && moderatorPubkeys.has(me.pubkey);
  const isModerator = isPerCommunityMod || isAdmin || isGlobalMod;

  const removedIds = useMemo(() => {
    const set = new Set<string>();
    for (const e of modEntries) {
      if (e.action === "remove_post" && e.targetEventId) {
        set.add(e.targetEventId);
      }
    }
    return set;
  }, [modEntries]);

  const [tab, setTab] = useState<"feed" | "federated" | "modlog">("feed");

  const { events: posts, loading: loadingFeed } = useNostrQuery(
    identifier
      ? { kinds: [1, 11], "#t": [identifier], limit: 100 }
      : null,
    [identifier],
  );

  const ranked = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    return posts
      .filter((e) => !e.tags.some((t) => t[0] === "e"))
      .filter((e) => !removedIds.has(e.id))
      .map((event) => ({
      event,
      score: scorePost({
        upvotes: [],
        downvotes: [],
        postPow: eventPow(event),
        ageHours: Math.max(0, (now - event.created_at) / 3600),
      }),
    })).sort((a, b) => b.score - a.score);
  }, [posts, removedIds]);

  const persisted = loadFederatedState(identifier);
  const initialKind: FederatedKind = persisted?.kind ?? "lemmy";
  const initialTarget =
    persisted?.identifier ?? guessFederatedTarget(initialKind, identifier);
  const [federatedKind, setFederatedKindState] = useState<FederatedKind>(initialKind);
  const [federatedTarget, setFederatedTarget] = useState(initialTarget);
  const [federatedDraft, setFederatedDraft] = useState(initialTarget);

  const setFederatedKind = (next: FederatedKind) => {
    if (next === federatedKind) return;
    const prev = loadFederatedState(identifier);
    const previouslyUsed =
      prev?.kind === next ? prev.identifier : guessFederatedTarget(next, identifier);
    setFederatedKindState(next);
    setFederatedDraft(previouslyUsed);
    setFederatedTarget(previouslyUsed);
    saveFederatedState(identifier, { kind: next, identifier: previouslyUsed });
  };

  const submitFederated = (raw: string) => {
    const next = raw.trim();
    setFederatedTarget(next);
    saveFederatedState(identifier, { kind: federatedKind, identifier: next });
    if (federatedKind === "mastodon") {
      const parsed = parseMastodonTarget(next);
      if (parsed) rememberMastodonInstance(parsed.instance);
    }
  };

  return (
    <div className="flex flex-col md:flex-row min-h-screen">
      <div className="flex-1 flex flex-col min-w-0 border-r border-border">
        <div className="border-b border-border bg-card/50 sticky top-0 z-10 backdrop-blur-md px-4 py-3 flex items-center gap-3">
          <Link href="/communities">
            <Button variant="ghost" size="icon" className="h-11 w-11 rounded-full shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold font-mono text-primary flex items-center gap-2 truncate">
            <Hash className="h-5 w-5 shrink-0" />
            <span className="truncate">{identifier}</span>
          </h1>
        </div>

        <div className="md:hidden p-4 border-b border-border bg-secondary/10">
          {loadingCommunity ? (
            <Skeleton className="h-6 w-3/4" />
          ) : community ? (
            <div>
              <h2 className="text-lg font-bold mb-1 flex items-center gap-2 flex-wrap">
                {community.name}
                {community.encrypted && (
                  <span className="text-[10px] font-mono text-primary border border-primary/40 px-1.5 py-0.5 rounded-sm flex items-center gap-1">
                    <Lock className="h-3 w-3" /> ENCRYPTED
                  </span>
                )}
              </h2>
              {community.description && (
                <p className="text-sm text-muted-foreground">{community.description}</p>
              )}
            </div>
          ) : null}
        </div>

        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as any)}
          className="flex-1 flex flex-col"
        >
          <TabsList className="rounded-none border-b border-border bg-secondary/30 justify-start h-auto p-0 sticky top-[57px] z-[5] backdrop-blur-md">
            <TabsTrigger
              value="feed"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent gap-2 min-h-[44px] flex-1 md:flex-none"
              data-testid="tab-nostr"
            >
              <ListOrdered className="h-3.5 w-3.5" /> Feed
            </TabsTrigger>
            <TabsTrigger
              value="federated"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent gap-2 min-h-[44px] flex-1 md:flex-none"
              data-testid="tab-federated"
            >
              <Network className="h-3.5 w-3.5" /> Federated
            </TabsTrigger>
            <TabsTrigger
              value="modlog"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent gap-2 min-h-[44px] flex-1 md:flex-none"
              data-testid="tab-modlog"
            >
              <Gavel className="h-3.5 w-3.5" /> Mod Log
              {modEntries.length > 0 && (
                <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                  {modEntries.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="feed" className="m-0 flex-1 flex flex-col">
            {community?.encrypted && !decryptionKey && !loadingKey && (
              <div className="p-4 border-b border-border bg-amber-500/5 flex items-center justify-between gap-3">
                <div className="text-xs font-mono text-muted-foreground flex items-center gap-2">
                  <Lock className="h-4 w-4 text-primary" />
                  Posts in this community are encrypted. Unlock with the
                  community passphrase to read them.
                </div>
                <UnlockCommunityDialog community={community} />
              </div>
            )}
            {community?.encrypted && decryptionKey && (
              <div className="px-4 py-2 border-b border-border bg-secondary/20 flex items-center justify-between gap-3">
                <div className="text-[11px] font-mono text-muted-foreground flex items-center gap-2">
                  <KeyRound className="h-3.5 w-3.5 text-primary" />
                  Unlocked for this session.
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-[11px] font-mono h-7"
                  onClick={() => forgetCommunityKey(identifier)}
                  data-testid="button-forget-community-key"
                >
                  Forget key
                </Button>
              </div>
            )}
            {loadingFeed && posts.length === 0 ? (
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
            ) : ranked.length > 0 ? (
              ranked.map(({ event, score }) => (
                <PostCard
                  key={event.id}
                  event={event}
                  score={score}
                  community={identifier}
                  canModerate={isModerator}
                  decryptionKey={decryptionKey}
                />
              ))
            ) : (
              <div className="p-8 text-center text-muted-foreground font-mono">
                No posts in this community yet.
              </div>
            )}
          </TabsContent>

          <TabsContent value="federated" className="m-0 flex-1 flex flex-col">
            <div className="p-4 border-b border-border bg-secondary/10 space-y-3">
              <div>
                <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider block mb-2">
                  Source
                </label>
                <div className="inline-flex rounded-md border border-border overflow-hidden font-mono text-xs">
                  {(["lemmy", "mastodon"] as FederatedKind[]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setFederatedKind(k)}
                      className={
                        "px-3 py-2 min-h-[36px] uppercase tracking-wider transition-colors " +
                        (federatedKind === k
                          ? "bg-primary text-primary-foreground"
                          : "bg-background text-muted-foreground hover:bg-secondary/40")
                      }
                      data-testid={`button-federated-source-${k}`}
                    >
                      {k}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider block mb-2">
                  {federatedKind === "lemmy"
                    ? "Lemmy community (community@instance)"
                    : "Mastodon hashtag or account (#tag@instance or @user@instance)"}
                </label>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    submitFederated(federatedDraft);
                  }}
                  className="flex gap-2"
                >
                  <Input
                    value={federatedDraft}
                    onChange={(e) => setFederatedDraft(e.target.value)}
                    placeholder={
                      federatedKind === "lemmy"
                        ? `${identifier || "technology"}@lemmy.world`
                        : `#${identifier || "bitcoin"}@mastodon.social`
                    }
                    className="font-mono"
                    data-testid="input-federated-target"
                  />
                  <Button
                    type="submit"
                    className="min-h-[44px]"
                    data-testid="button-load-federated"
                  >
                    Load
                  </Button>
                </form>
              </div>
            </div>
            {federatedTarget ? (
              <FederatedFeed kind={federatedKind} identifier={federatedTarget} />
            ) : (
              <div className="p-8 text-center text-muted-foreground font-mono">
                Enter a {federatedKind === "lemmy" ? "Lemmy community" : "Mastodon hashtag or account"}{" "}
                above to bridge it here.
              </div>
            )}
          </TabsContent>

          <TabsContent value="modlog" className="m-0 flex-1 flex flex-col">
            <ModLogList
              loading={loadingMod}
              entries={modEntries}
              communityIdentifier={identifier}
            />
          </TabsContent>
        </Tabs>
      </div>

      <div className="w-full md:w-64 bg-card shrink-0 hidden md:block">
        <div className="p-4 border-b border-border sticky top-0 bg-card/50 backdrop-blur-md">
          <h2 className="font-bold text-sm text-muted-foreground uppercase tracking-widest">
            About Community
          </h2>
        </div>
        <div className="p-4 flex flex-col gap-6">
          {loadingCommunity ? (
            <Skeleton className="h-8 w-3/4" />
          ) : community ? (
            <div>
              <h3 className="text-xl font-bold text-foreground mb-2">{community.name}</h3>
              {community.description && (
                <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
                  {community.description}
                </p>
              )}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground font-mono">
              No NIP-72 metadata found for this community.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ModLogList({
  loading,
  entries,
  communityIdentifier,
}: {
  loading: boolean;
  entries: ReturnType<typeof useModLog>["entries"];
  communityIdentifier: string;
}) {
  if (loading && entries.length === 0) {
    return (
      <div className="p-4 space-y-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground font-mono text-sm">
        No moderation actions yet for n/{communityIdentifier}.
      </div>
    );
  }
  return (
    <div className="divide-y divide-border">
      {entries.map((e) => (
        <ModLogRow key={e.id} entry={e} />
      ))}
    </div>
  );
}

function ModLogRow({
  entry,
}: {
  entry: ReturnType<typeof useModLog>["entries"][number];
}) {
  const { profile } = useProfile(entry.signer);
  const signerNpub = hexToNpub(entry.signer);
  return (
    <div className="p-4 bg-card hover:bg-secondary/20">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <Badge variant="outline" className="font-mono text-[10px] border-primary/40 text-primary">
          <Gavel className="h-3 w-3 mr-1" />
          {entry.action}
        </Badge>
        <Link href={`/profile/${signerNpub}`}>
          <span className="text-xs font-mono hover:underline cursor-pointer">
            {authorLabel(signerNpub, profile?.display_name || profile?.name)}
          </span>
        </Link>
        <span className="text-[10px] text-muted-foreground font-mono">
          {formatDistanceToNow(new Date(entry.createdAt * 1000), { addSuffix: true })}
        </span>
      </div>
      {entry.targetEventId && (
        <div className="text-xs text-muted-foreground font-mono break-all">
          target post:{" "}
          <Link href={`/post/${entry.targetEventId}`}>
            <span className="text-foreground hover:underline cursor-pointer">
              {entry.targetEventId.slice(0, 16)}…
            </span>
          </Link>
        </div>
      )}
      {entry.targetPubkey && (
        <div className="text-xs text-muted-foreground font-mono break-all">
          target user:{" "}
          <Link href={`/profile/${hexToNpub(entry.targetPubkey)}`}>
            <span className="text-foreground hover:underline cursor-pointer">
              {hexToNpub(entry.targetPubkey).slice(0, 16)}…
            </span>
          </Link>
        </div>
      )}
      {entry.reason && (
        <div className="text-xs text-foreground mt-1 italic break-words">
          "{entry.reason}"
        </div>
      )}
    </div>
  );
}

function guessFederatedTarget(kind: FederatedKind, identifier: string): string {
  if (kind === "lemmy") {
    if (identifier.includes("@")) return identifier;
    return identifier ? `${identifier}@lemmy.world` : "";
  }
  // Mastodon — default to a hashtag matching the community slug. The parser
  // requires an explicit `#` or `@`, so a bare value is never a useful
  // default. Slugs that already contain `@` (e.g. legacy "tech@host" values)
  // would produce a malformed `#tech@host@mastodon.social`, so strip the
  // suffix and use just the local part as the hashtag.
  if (!identifier) return "";
  if (identifier.startsWith("#") || identifier.startsWith("@")) return identifier;
  const at = identifier.indexOf("@");
  const tag = at > 0 ? identifier.slice(0, at) : identifier;
  return `#${tag}@mastodon.social`;
}

interface FederatedPersisted {
  kind: FederatedKind;
  identifier: string;
}

function federatedStorageKey(community: string): string {
  return `agora.federated.lastSource:${community}`;
}

function loadFederatedState(community: string): FederatedPersisted | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(federatedStorageKey(community));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FederatedPersisted>;
    if (parsed.kind !== "lemmy" && parsed.kind !== "mastodon") return null;
    if (typeof parsed.identifier !== "string") return null;
    return { kind: parsed.kind, identifier: parsed.identifier };
  } catch {
    return null;
  }
}

function saveFederatedState(community: string, value: FederatedPersisted): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(federatedStorageKey(community), JSON.stringify(value));
  } catch {
    // best-effort
  }
}
