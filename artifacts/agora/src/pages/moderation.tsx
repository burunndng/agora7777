import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Gavel,
  ShieldCheck,
  AlertTriangle,
  Hash,
  ExternalLink,
  Loader2,
  Trash2,
  UserX,
  UserCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useNostrQuery } from "@/lib/nostr/pool";
import { useIdentityStore } from "@/lib/nostr/store";
import { useIsAdmin, useIsModerator, useModeratorRoster } from "@/lib/nostr/roles";
import {
  MOD_LOG_KIND,
  eventToModLogEntry,
  publishModAction,
  type ModAction,
  type ModLogEntry,
} from "@/lib/nostr/moderation";
import { hexToNpub, authorLabel } from "@/lib/nostr/format";
import { useProfile } from "@/lib/nostr/profiles";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { nip19 } from "nostr-tools";

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

const ALL = "__all__";

export default function ModerationPanel() {
  const [, setLocation] = useLocation();
  const me = useIdentityStore((s) => s.identity);
  const isAdmin = useIsAdmin();
  const isMod = useIsModerator();
  const { roster, loading: loadingRoster } = useModeratorRoster();
  const { toast } = useToast();

  const { events, loading } = useNostrQuery(
    me ? { kinds: [MOD_LOG_KIND], limit: 200 } : null,
    [me?.pubkey ?? null],
  );

  const entries = useMemo<ModLogEntry[]>(() => {
    return events
      .map(eventToModLogEntry)
      .filter((e): e is ModLogEntry => !!e)
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [events]);

  // Filters
  const [communityFilter, setCommunityFilter] = useState<string>(ALL);
  const [actionFilter, setActionFilter] = useState<string>(ALL);
  const [moderatorFilter, setModeratorFilter] = useState<string>(ALL);

  const communities = useMemo(
    () => Array.from(new Set(entries.map((e) => e.community))).sort(),
    [entries],
  );
  const actions = useMemo(
    () => Array.from(new Set(entries.map((e) => e.action))).sort(),
    [entries],
  );
  const moderators = useMemo(
    () => Array.from(new Set(entries.map((e) => e.signer))).sort(),
    [entries],
  );

  const filtered = useMemo(
    () =>
      entries.filter((e) => {
        if (communityFilter !== ALL && e.community !== communityFilter) return false;
        if (actionFilter !== ALL && e.action !== actionFilter) return false;
        if (moderatorFilter !== ALL && e.signer !== moderatorFilter) return false;
        return true;
      }),
    [entries, communityFilter, actionFilter, moderatorFilter],
  );

  const myActions = useMemo(
    () => (me ? entries.filter((e) => e.signer === me.pubkey) : []),
    [entries, me],
  );

  // Action form state
  const [actionCommunity, setActionCommunity] = useState("");
  const [actionType, setActionType] = useState<ModAction>("remove_post");
  const [actionTarget, setActionTarget] = useState("");
  const [actionReason, setActionReason] = useState("");
  const [actionBusy, setActionBusy] = useState(false);

  const onTakeAction = async () => {
    if (!actionCommunity.trim()) {
      toast({ title: "Community required", variant: "destructive" });
      return;
    }
    const target = actionTarget.trim();
    let targetEventId: string | undefined;
    let targetPubkey: string | undefined;
    if (actionType === "remove_post" || actionType === "approve_post") {
      if (!/^[0-9a-f]{64}$/i.test(target)) {
        toast({
          title: "Need a 64-char event id",
          description: "Paste the hex id of the post to act on.",
          variant: "destructive",
        });
        return;
      }
      targetEventId = target.toLowerCase();
    } else {
      const hex = npubToHex(target);
      if (!hex) {
        toast({
          title: "Need an npub or hex pubkey",
          variant: "destructive",
        });
        return;
      }
      targetPubkey = hex;
    }
    setActionBusy(true);
    try {
      await publishModAction({
        community: actionCommunity.trim(),
        action: actionType,
        targetEventId,
        targetPubkey,
        reason: actionReason.trim() || undefined,
      });
      toast({
        title: "Action published",
        description: `${actionType} broadcast for n/${actionCommunity.trim()}.`,
      });
      setActionTarget("");
      setActionReason("");
    } catch (err) {
      toast({
        title: "Publish failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setActionBusy(false);
    }
  };

  if (!me) {
    return (
      <Centered icon={<ShieldCheck className="h-12 w-12 text-primary" />}>
        <h1 className="text-2xl font-bold mb-2 font-mono">Moderation</h1>
        <p className="text-muted-foreground font-mono text-sm mb-6">
          Connect an identity to view this page.
        </p>
        <Button onClick={() => setLocation("/login")}>Go to Login</Button>
      </Centered>
    );
  }

  if (!isAdmin && !isMod) {
    return (
      <Centered icon={<AlertTriangle className="h-12 w-12 text-amber-500" />}>
        <h1 className="text-2xl font-bold mb-2 font-mono">Not a moderator</h1>
        <p className="text-muted-foreground font-mono text-sm max-w-md">
          The moderation panel is gated to identities listed in the
          admin-signed global moderator roster. Per-community moderators
          (declared on a community's NIP-72 metadata) can still moderate
          their own communities directly from each post.
        </p>
      </Centered>
    );
  }

  return (
    <div className="flex flex-col min-h-screen">
      <div className="border-b border-border bg-card/50 sticky top-0 z-10 backdrop-blur-md px-4 py-3">
        <h1 className="text-xl font-bold font-mono text-primary flex items-center gap-2">
          <Gavel className="h-5 w-5" /> Moderation
        </h1>
        <p className="text-xs font-mono text-muted-foreground mt-1">
          {isAdmin ? "Global admin" : "Global moderator"} · roster of{" "}
          {loadingRoster ? "…" : roster.pubkeys.size} mod
          {roster.pubkeys.size === 1 ? "" : "s"}
        </p>
      </div>

      <div className="p-4 md:p-6 space-y-6 max-w-4xl w-full mx-auto">
        <section className="border border-border rounded-lg p-4 bg-card">
          <h2 className="text-sm font-bold font-mono uppercase tracking-widest text-muted-foreground mb-3">
            Take action
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
                Community identifier
              </label>
              <Input
                value={actionCommunity}
                onChange={(e) => setActionCommunity(e.target.value.toLowerCase())}
                placeholder="agora-meta"
                className="font-mono mt-1"
                disabled={actionBusy}
                data-testid="input-action-community"
              />
            </div>
            <div>
              <label className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
                Action
              </label>
              <Select
                value={actionType}
                onValueChange={(v) => setActionType(v as ModAction)}
              >
                <SelectTrigger
                  className="mt-1 font-mono"
                  data-testid="select-action-type"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="remove_post">remove_post</SelectItem>
                  <SelectItem value="approve_post">approve_post</SelectItem>
                  <SelectItem value="ban_user">ban_user</SelectItem>
                  <SelectItem value="unban_user">unban_user</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <label className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
                Target{" "}
                {actionType === "remove_post" || actionType === "approve_post"
                  ? "(post event id, hex)"
                  : "(npub or hex pubkey)"}
              </label>
              <Input
                value={actionTarget}
                onChange={(e) => setActionTarget(e.target.value)}
                placeholder={
                  actionType === "remove_post" || actionType === "approve_post"
                    ? "abcdef…"
                    : "npub1…"
                }
                className="font-mono mt-1"
                disabled={actionBusy}
                data-testid="input-action-target"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
                Reason (optional, public)
              </label>
              <Input
                value={actionReason}
                onChange={(e) => setActionReason(e.target.value)}
                placeholder="spam / off-topic / …"
                className="mt-1"
                disabled={actionBusy}
                data-testid="input-action-reason"
              />
            </div>
          </div>
          <div className="flex justify-end mt-3">
            <Button
              onClick={onTakeAction}
              disabled={actionBusy}
              data-testid="button-take-action"
              className="gap-2"
            >
              {actionBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : actionType === "ban_user" ? (
                <UserX className="h-4 w-4" />
              ) : actionType === "unban_user" ? (
                <UserCheck className="h-4 w-4" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Publish {actionType}
            </Button>
          </div>
          <p className="text-[11px] font-mono text-muted-foreground mt-2 leading-relaxed">
            Each action is a signed kind:9000 event. Other clients honor
            them only when authored by a moderator listed in the relevant
            community or in the global roster.
          </p>
        </section>

        <section className="border border-border rounded-lg bg-card">
          <header className="px-4 py-3 border-b border-border flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-sm font-bold font-mono uppercase tracking-widest text-muted-foreground">
              All recent actions
            </h2>
            <Badge variant="outline" className="font-mono text-[10px]">
              {filtered.length}/{entries.length}
            </Badge>
          </header>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 px-4 py-3 border-b border-border bg-secondary/10">
            <Select value={communityFilter} onValueChange={setCommunityFilter}>
              <SelectTrigger
                className="font-mono text-xs"
                data-testid="select-filter-community"
              >
                <SelectValue placeholder="Community" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All communities</SelectItem>
                {communities.map((c) => (
                  <SelectItem key={c} value={c}>
                    n/{c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger
                className="font-mono text-xs"
                data-testid="select-filter-action"
              >
                <SelectValue placeholder="Action" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All actions</SelectItem>
                {actions.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={moderatorFilter} onValueChange={setModeratorFilter}>
              <SelectTrigger
                className="font-mono text-xs"
                data-testid="select-filter-moderator"
              >
                <SelectValue placeholder="Moderator" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All moderators</SelectItem>
                {moderators.map((m) => (
                  <SelectItem key={m} value={m}>
                    {hexToNpub(m).slice(0, 16)}…
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ModLogList
            loading={loading}
            entries={filtered}
            emptyText="No moderation actions match these filters."
          />
        </section>

        <section className="border border-border rounded-lg bg-card">
          <header className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-bold font-mono uppercase tracking-widest text-muted-foreground">
              My actions
            </h2>
            <Badge variant="outline" className="font-mono text-[10px]">
              {myActions.length}
            </Badge>
          </header>
          <ModLogList
            loading={loading}
            entries={myActions}
            emptyText="You haven't taken any mod actions yet."
          />
        </section>
      </div>
    </div>
  );
}

function ModLogList({
  loading,
  entries,
  emptyText,
}: {
  loading: boolean;
  entries: ModLogEntry[];
  emptyText: string;
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
      <div className="p-6 text-center text-muted-foreground font-mono text-sm">
        {emptyText}
      </div>
    );
  }
  return (
    <ul className="divide-y divide-border">
      {entries.map((e) => (
        <ModLogRow key={e.id} entry={e} />
      ))}
    </ul>
  );
}

function ModLogRow({ entry }: { entry: ModLogEntry }) {
  const { profile } = useProfile(entry.signer);
  const signerNpub = hexToNpub(entry.signer);
  const { toast } = useToast();
  const [busy, setBusy] = useState<ModAction | null>(null);

  const quickAction = async (action: ModAction) => {
    setBusy(action);
    try {
      await publishModAction({
        community: entry.community,
        action,
        targetEventId:
          action === "remove_post" || action === "approve_post"
            ? entry.targetEventId
            : undefined,
        targetPubkey:
          action === "ban_user" || action === "unban_user"
            ? entry.targetPubkey
            : undefined,
        reason: `quick action from mod log entry ${entry.id.slice(0, 8)}`,
      });
      toast({
        title: `${action} published`,
        description: `n/${entry.community}`,
      });
    } catch (err) {
      toast({
        title: "Publish failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="p-4 hover:bg-secondary/20">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <Badge variant="outline" className="font-mono text-[10px] border-primary/40 text-primary">
          <Gavel className="h-3 w-3 mr-1" />
          {entry.action}
        </Badge>
        <Link href={`/community/${encodeURIComponent(entry.community)}`}>
          <span className="text-xs font-mono hover:underline cursor-pointer flex items-center gap-1">
            <Hash className="h-3 w-3" />
            n/{entry.community}
          </span>
        </Link>
        <span className="text-xs font-mono text-muted-foreground">by</span>
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
            <span className="text-foreground hover:underline cursor-pointer inline-flex items-center gap-1">
              {entry.targetEventId.slice(0, 16)}…
              <ExternalLink className="h-3 w-3" />
            </span>
          </Link>
        </div>
      )}
      {entry.targetPubkey && !entry.targetEventId && (
        <div className="text-xs text-muted-foreground font-mono break-all">
          target user: {hexToNpub(entry.targetPubkey).slice(0, 24)}…
        </div>
      )}
      {entry.reason && (
        <div className="text-xs text-foreground mt-1 italic break-words">
          "{entry.reason}"
        </div>
      )}
      <div className="flex flex-wrap gap-2 mt-2">
        {entry.targetEventId && entry.action !== "remove_post" && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => quickAction("remove_post")}
            className="h-7 gap-1 text-xs"
            data-testid={`button-quick-remove-${entry.id.slice(0, 8)}`}
          >
            {busy === "remove_post" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Trash2 className="h-3 w-3" />
            )}
            Remove post
          </Button>
        )}
        {entry.targetPubkey && entry.action !== "ban_user" && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => quickAction("ban_user")}
            className="h-7 gap-1 text-xs"
            data-testid={`button-quick-ban-${entry.id.slice(0, 8)}`}
          >
            {busy === "ban_user" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <UserX className="h-3 w-3" />
            )}
            Ban user
          </Button>
        )}
        {entry.targetPubkey && entry.action !== "unban_user" && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy !== null}
            onClick={() => quickAction("unban_user")}
            className="h-7 gap-1 text-xs"
            data-testid={`button-quick-unban-${entry.id.slice(0, 8)}`}
          >
            {busy === "unban_user" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <UserCheck className="h-3 w-3" />
            )}
            Unban
          </Button>
        )}
      </div>
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
