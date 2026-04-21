import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  Crown,
  Loader2,
  Plus,
  ShieldCheck,
  Trash2,
  Users,
  AlertTriangle,
  Hash,
  Activity,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useIdentityStore } from "@/lib/nostr/store";
import {
  ADMIN_HANDLE,
  publishModeratorRoster,
  useIsAdmin,
  useModeratorRoster,
} from "@/lib/nostr/roles";
import { hexToNpub } from "@/lib/nostr/format";
import { CreateCommunityDialog } from "@/components/create-community-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useProfile } from "@/lib/nostr/profiles";
import { useToast } from "@/hooks/use-toast";
import { nip19 } from "nostr-tools";
import { useNostrPool, useNostrQuery } from "@/lib/nostr/pool";
import {
  COMMUNITY_KIND,
  parseCommunity,
  type Community,
} from "@/lib/nostr/communities";
import {
  MOD_LOG_KIND,
  eventToModLogEntry,
  type ModLogEntry,
} from "@/lib/nostr/moderation";
import { formatDistanceToNow } from "date-fns";

function npubToHex(input: string): string | null {
  const trimmed = input.trim();
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase();
  if (trimmed.startsWith("npub1")) {
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type === "npub") return (decoded.data as string).toLowerCase();
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Resolve a free-form handle ("alice") to a pubkey by scanning recent
 * kind:0 profile events whose `name` claim matches. Returns null if none
 * found within the relay sample.
 */
function useHandleResolver() {
  const { pool, relays } = useNostrPool();
  return async (handle: string): Promise<string | null> => {
    const norm = handle.trim().toLowerCase();
    if (!norm) return null;
    return new Promise((resolve) => {
      let best: { pubkey: string; created_at: number } | null = null;
      const sub = pool.subscribeMany(relays, { kinds: [0], limit: 500 }, {
        onevent: (event) => {
          try {
            const m = JSON.parse(event.content) as { name?: string };
            if (
              (m.name ?? "").trim().toLowerCase() === norm &&
              (!best || event.created_at > best.created_at)
            ) {
              best = { pubkey: event.pubkey, created_at: event.created_at };
            }
          } catch {
            /* ignore */
          }
        },
        oneose: () => {
          sub.close();
          resolve(best?.pubkey ?? null);
        },
      });
      // Hard timeout fallback so the UI doesn't hang forever.
      setTimeout(() => {
        sub.close();
        resolve(best?.pubkey ?? null);
      }, 4000);
    });
  };
}

export default function AdminPanel() {
  const [, setLocation] = useLocation();
  const me = useIdentityStore((s) => s.identity);
  const isAdmin = useIsAdmin();
  const { roster, loading } = useModeratorRoster();
  const { toast } = useToast();
  const resolveHandle = useHandleResolver();

  const [draft, setDraft] = useState<string[]>([]);
  const [note, setNote] = useState<string>("");
  const [adding, setAdding] = useState("");
  const [addingBusy, setAddingBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate the editable draft from the latest roster once.
  useEffect(() => {
    if (hydrated || loading) return;
    setDraft(Array.from(roster.pubkeys));
    setNote(roster.note ?? "");
    setHydrated(true);
  }, [roster, loading, hydrated]);

  const dirty = useMemo(() => {
    if (!hydrated) return false;
    if ((roster.note ?? "") !== note) return true;
    if (draft.length !== roster.pubkeys.size) return true;
    return draft.some((pk) => !roster.pubkeys.has(pk));
  }, [draft, roster, note, hydrated]);

  // Site-wide stats sources.
  const { events: communityEvents } = useNostrQuery(
    isAdmin ? { kinds: [COMMUNITY_KIND], limit: 200 } : null,
    [isAdmin],
  );
  const { events: globalModEvents, loading: loadingGlobalMod } = useNostrQuery(
    isAdmin ? { kinds: [MOD_LOG_KIND], limit: 50 } : null,
    [isAdmin],
  );
  const communities = useMemo<Community[]>(() => {
    const byId = new Map<string, Community>();
    for (const ev of communityEvents) {
      const c = parseCommunity(ev);
      if (!c) continue;
      const prev = byId.get(c.identifier);
      if (!prev || prev.createdAt < c.createdAt) byId.set(c.identifier, c);
    }
    return Array.from(byId.values());
  }, [communityEvents]);
  const recentMod = useMemo<ModLogEntry[]>(
    () =>
      globalModEvents
        .map(eventToModLogEntry)
        .filter((e): e is ModLogEntry => !!e)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 10),
    [globalModEvents],
  );

  if (!me) {
    return (
      <Centered icon={<ShieldCheck className="h-12 w-12 text-primary" />}>
        <h1 className="text-2xl font-bold mb-2 font-mono">Admin Panel</h1>
        <p className="text-muted-foreground font-mono text-sm mb-6">
          Connect an identity to view this page.
        </p>
        <Button onClick={() => setLocation("/login")}>Go to Login</Button>
      </Centered>
    );
  }

  if (!isAdmin) {
    return (
      <Centered icon={<AlertTriangle className="h-12 w-12 text-amber-500" />}>
        <h1 className="text-2xl font-bold mb-2 font-mono">Not authorized</h1>
        <p className="text-muted-foreground font-mono text-sm max-w-md">
          The admin panel is only available to the identity whose handle is
          <code className="mx-1 px-1 bg-secondary rounded">{ADMIN_HANDLE}</code>.
          Role checks are entirely client-side, so other clients won't honor
          spoofed admin events either.
        </p>
      </Centered>
    );
  }

  const onAdd = async () => {
    const raw = adding.trim();
    if (!raw) return;
    let hex = npubToHex(raw);
    if (!hex) {
      // Try handle resolution.
      setAddingBusy(true);
      try {
        hex = await resolveHandle(raw);
      } finally {
        setAddingBusy(false);
      }
    }
    if (!hex) {
      toast({
        title: "Couldn't resolve",
        description:
          "Paste an npub1…/64-hex pubkey, or a handle that has a published kind:0 profile with that name.",
        variant: "destructive",
      });
      return;
    }
    if (draft.includes(hex)) {
      toast({ title: "Already in roster" });
      return;
    }
    setDraft([...draft, hex]);
    setAdding("");
  };

  const onRemove = (pk: string) => {
    setDraft(draft.filter((d) => d !== pk));
  };

  const onPublish = async () => {
    setBusy(true);
    try {
      await publishModeratorRoster({ pubkeys: draft, note: note.trim() });
      toast({
        title: "Roster published",
        description: `${draft.length} moderator${draft.length === 1 ? "" : "s"} broadcast.`,
      });
    } catch (err) {
      toast({
        title: "Publish failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col min-h-screen">
      <div className="border-b border-border bg-card/50 sticky top-0 z-10 backdrop-blur-md px-4 py-3">
        <h1 className="text-xl font-bold font-mono text-primary flex items-center gap-2">
          <Crown className="h-5 w-5" /> Admin Panel
        </h1>
        <p className="text-xs font-mono text-muted-foreground mt-1">
          Signed in as the admin identity ({hexToNpub(me.pubkey).slice(0, 16)}…)
        </p>
      </div>

      <div className="p-4 md:p-6 space-y-6 max-w-3xl w-full mx-auto">
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Stat
            icon={<Users className="h-4 w-4" />}
            label="Moderators"
            value={String(roster.pubkeys.size)}
            testid="stat-moderators"
          />
          <Stat
            icon={<Hash className="h-4 w-4" />}
            label="Communities"
            value={String(communities.length)}
            testid="stat-communities"
          />
          <Stat
            icon={<Activity className="h-4 w-4" />}
            label="Recent mod actions"
            value={loadingGlobalMod ? "…" : String(recentMod.length)}
            testid="stat-recent-actions"
          />
        </section>

        <section className="border border-border rounded-lg p-4 bg-card">
          <header className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-2">
              <Users className="h-4 w-4" /> Moderator roster
            </h2>
            <Badge variant="outline" className="font-mono text-[10px]">
              kind:30000 d=agora-moderators
            </Badge>
          </header>

          {loading && !hydrated ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <>
              {draft.length === 0 ? (
                <p className="text-sm font-mono text-muted-foreground py-3">
                  No moderators yet.
                </p>
              ) : (
                <ul className="divide-y divide-border border border-border rounded-md mb-3">
                  {draft.map((pk) => (
                    <ModeratorRow key={pk} pubkey={pk} onRemove={() => onRemove(pk)} />
                  ))}
                </ul>
              )}

              <div className="flex gap-2 mb-1">
                <Input
                  value={adding}
                  onChange={(e) => setAdding(e.target.value)}
                  placeholder="handle, npub1…, or hex pubkey"
                  className="font-mono"
                  disabled={addingBusy}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onAdd();
                    }
                  }}
                  data-testid="input-add-moderator"
                />
                <Button
                  onClick={onAdd}
                  disabled={addingBusy}
                  className="gap-1"
                  data-testid="button-add-moderator"
                >
                  {addingBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Add
                </Button>
              </div>
              <p className="text-[11px] font-mono text-muted-foreground mb-3">
                Handles resolve via the most-recent kind:0 profile whose{" "}
                <code>name</code> matches.
              </p>

              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional public note attached to the roster event…"
                className="font-mono mb-3"
              />

              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-mono text-muted-foreground">
                  {roster.publishedAt
                    ? `Last published ${new Date(roster.publishedAt * 1000).toLocaleString()}`
                    : "Never published — first publish becomes the canonical roster."}
                </p>
                <Button
                  onClick={onPublish}
                  disabled={busy || !dirty}
                  data-testid="button-publish-roster"
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : dirty ? (
                    "Publish roster"
                  ) : (
                    "No changes"
                  )}
                </Button>
              </div>
            </>
          )}
        </section>

        <section className="border border-border rounded-lg p-4 bg-card">
          <header className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold font-mono uppercase tracking-widest text-muted-foreground">
              Communities
            </h2>
          </header>
          <p className="text-sm font-mono text-muted-foreground mb-3 leading-relaxed">
            Create new communities, including password-protected ones whose
            posts are AES-GCM encrypted at rest in relays. Only this admin
            identity can create encrypted communities.
          </p>
          <CreateCommunityDialog
            onCreated={(identifier) =>
              setLocation(`/community/${encodeURIComponent(identifier)}`)
            }
          />
        </section>

        <section className="border border-border rounded-lg bg-card">
          <header className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-bold font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-2">
              <Activity className="h-4 w-4" /> Recent mod feed
            </h2>
            <Badge variant="outline" className="font-mono text-[10px]">
              {recentMod.length}
            </Badge>
          </header>
          {loadingGlobalMod && recentMod.length === 0 ? (
            <div className="p-4 space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : recentMod.length === 0 ? (
            <p className="p-6 text-center text-muted-foreground font-mono text-sm">
              No moderation actions on connected relays.
            </p>
          ) : (
            <ul className="divide-y divide-border" data-testid="list-recent-mod">
              {recentMod.map((entry) => (
                <li
                  key={entry.id}
                  className="px-4 py-3 flex flex-wrap items-center gap-2 text-xs font-mono"
                >
                  <Badge
                    variant="outline"
                    className="font-mono text-[10px] border-primary/40 text-primary"
                  >
                    {entry.action}
                  </Badge>
                  <span className="text-muted-foreground">
                    n/{entry.community}
                  </span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">
                    by {hexToNpub(entry.signer).slice(0, 16)}…
                  </span>
                  <span className="text-muted-foreground ml-auto">
                    {formatDistanceToNow(new Date(entry.createdAt * 1000), {
                      addSuffix: true,
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="border border-border rounded-lg p-4 bg-card">
          <header className="flex items-center gap-2 mb-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-bold font-mono uppercase tracking-widest text-muted-foreground">
              Known communities
            </h2>
          </header>
          {communities.length === 0 ? (
            <p className="text-sm font-mono text-muted-foreground py-2">
              None observed on connected relays yet.
            </p>
          ) : (
            <ul className="divide-y divide-border border border-border rounded-md">
              {communities.slice(0, 20).map((c) => (
                <li
                  key={c.id}
                  className="px-3 py-2 flex items-center justify-between gap-2 text-xs font-mono"
                >
                  <span className="truncate">
                    n/{c.identifier}
                    {c.encrypted && (
                      <Badge
                        variant="outline"
                        className="ml-2 font-mono text-[10px] border-primary/40 text-primary"
                      >
                        ENCRYPTED
                      </Badge>
                    )}
                  </span>
                  <span className="text-muted-foreground truncate">
                    {c.name}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  testid,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  testid: string;
}) {
  return (
    <div
      className="border border-border rounded-lg p-4 bg-card flex items-center gap-3"
      data-testid={testid}
    >
      <div className="text-primary">{icon}</div>
      <div>
        <div className="text-xl font-bold font-mono">{value}</div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          {label}
        </div>
      </div>
    </div>
  );
}

function ModeratorRow({
  pubkey,
  onRemove,
}: {
  pubkey: string;
  onRemove: () => void;
}) {
  const { profile } = useProfile(pubkey);
  const npub = hexToNpub(pubkey);
  const display = profile?.display_name || profile?.name || npub.slice(0, 16) + "…";
  const initial = (profile?.display_name || profile?.name || npub).charAt(0).toUpperCase();
  return (
    <li
      className="flex items-center justify-between gap-3 px-3 py-2"
      data-testid={`row-moderator-${pubkey.slice(0, 8)}`}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <Avatar className="h-8 w-8 flex-shrink-0">
          {profile?.picture && <AvatarImage src={profile.picture} alt={display} />}
          <AvatarFallback className="text-xs font-mono">{initial}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-mono truncate">{display}</div>
          <code className="text-[10px] font-mono text-muted-foreground truncate block">
            {npub}
          </code>
        </div>
      </div>
      <Button
        size="sm"
        variant="ghost"
        onClick={onRemove}
        data-testid={`button-remove-mod-${pubkey.slice(0, 8)}`}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </li>
  );
}

function Centered({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col min-h-screen items-center justify-center p-4">
      <div className="text-center max-w-md">
        <div className="flex justify-center mb-4">{icon}</div>
        {children}
      </div>
    </div>
  );
}
