import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  MapPin,
  Loader2,
  ShieldOff,
  Users,
  RefreshCw,
  Compass,
  MessageSquare,
  Hash,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useIdentityStore, useRelayStore } from "@/lib/nostr/store";
import { useProfile } from "@/lib/nostr/profiles";
import { authorLabel, hexToNpub } from "@/lib/nostr/format";
import {
  useNearbySelf,
  useNearbyUsers,
  useForumContext,
  publishNearbyOptIn,
  publishNearbyOptOut,
  sampleCoarseLocation,
  type NearbyEntry,
} from "@/lib/nostr/nearby";
import { linkify } from "@/components/safe-link";
import { RegionPickerDialog } from "@/components/region-picker-dialog";
import type { CoarseLocation } from "@/lib/nostr/nearby";

export default function Nearby() {
  const identity = useIdentityStore((s) => s.identity);
  const relays = useRelayStore((s) => s.relays);
  const { discoverable, coarseLocation, setCoarseLocation, setDiscoverable } =
    useNearbySelf();
  const { toast } = useToast();
  const [busy, setBusy] = useState<
    "opt-in" | "refresh" | "opt-out" | "manual" | null
  >(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const { entries, loading } = useNearbyUsers(
    discoverable ? coarseLocation : null,
    identity?.pubkey ?? null,
  );

  const handleOptIn = async () => {
    if (!identity) return;
    setBusy("opt-in");
    setPermissionDenied(false);
    try {
      const loc = await sampleCoarseLocation();
      await publishNearbyOptIn(identity, loc, relays);
      setCoarseLocation(loc);
      setDiscoverable(true);
      toast({
        title: "You're now discoverable nearby",
        description:
          "Only a coarse cell (~11 km square) is shared. You can turn this off any time.",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not enable.";
      const denied = /denied|permission/i.test(message);
      setPermissionDenied(denied);
      toast({
        title: denied ? "Location permission denied" : "Could not enable Nearby",
        description: message,
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const handleRefresh = async () => {
    if (!identity) return;
    setBusy("refresh");
    try {
      const loc = await sampleCoarseLocation();
      await publishNearbyOptIn(identity, loc, relays);
      setCoarseLocation(loc);
      toast({ title: "Location refreshed" });
    } catch (err) {
      toast({
        title: "Refresh failed",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  // Publishes a hand-picked region. The picker has already coarsened
  // the value, but `publishNearbyOptIn` re-coarsens defensively so the
  // grid invariant holds even if a future caller forgets.
  const handleManualPick = async (loc: CoarseLocation): Promise<boolean> => {
    if (!identity) return false;
    setBusy("manual");
    setPermissionDenied(false);
    try {
      await publishNearbyOptIn(identity, loc, relays);
      setCoarseLocation(loc);
      setDiscoverable(true);
      toast({
        title: "Area saved",
        description:
          "Your chosen ~11 km cell was published — no GPS reading was taken.",
      });
      return true;
    } catch (err) {
      toast({
        title: "Could not publish your area",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const handleOptOut = async () => {
    if (!identity) {
      setDiscoverable(false);
      setCoarseLocation(null);
      return;
    }
    setBusy("opt-out");
    try {
      await publishNearbyOptOut(identity, relays);
      setDiscoverable(false);
      setCoarseLocation(null);
      toast({
        title: "You're hidden from Nearby",
        description:
          "Other clients will drop your card on next refresh, and your stored cell was cleared.",
      });
    } catch (err) {
      toast({
        title: "Could not publish opt-out",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col min-h-screen pb-10">
      <div className="border-b border-border bg-card/50 sticky top-0 z-10 backdrop-blur-md px-4 py-3 flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold font-mono text-primary flex items-center gap-2">
          <Compass className="h-5 w-5" />
          Nearby
        </h1>
        {discoverable && coarseLocation && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleRefresh()}
              disabled={!!busy}
              className="font-mono text-xs"
              data-testid="button-nearby-refresh"
            >
              {busy === "refresh" ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              )}
              Refresh
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void handleOptOut()}
              disabled={!!busy}
              className="font-mono text-xs"
              data-testid="button-nearby-opt-out"
            >
              {busy === "opt-out" ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <ShieldOff className="h-3.5 w-3.5 mr-1.5" />
              )}
              Hide me
            </Button>
          </div>
        )}
      </div>

      {!identity ? (
        <EmptyState
          icon={<Compass className="h-8 w-8 text-primary" />}
          title="Connect to discover people nearby"
          body="Nearby surfaces other Agora users in your area, with the communities they post in and one recent thing they wrote — so you have real context before reaching out."
          action={
            <Link href="/login">
              <Button className="font-mono">Connect identity</Button>
            </Link>
          }
        />
      ) : !discoverable || !coarseLocation ? (
        <EmptyState
          icon={<MapPin className="h-8 w-8 text-primary" />}
          title={permissionDenied ? "Location permission was denied" : "Join Nearby"}
          body={
            permissionDenied ? (
              <>
                Your browser refused the location prompt. Re-enable location for
                this site in your browser's site settings — or skip GPS entirely
                and pick your area from a city list.
              </>
            ) : (
              <>
                Share an <strong>approximate</strong> location to see other opted-in
                users in your area. Agora rounds your reading to a ~11 km grid cell
                before publishing — your precise position never leaves your device,
                and you can turn discoverability off at any time from this page or
                from Settings. No GPS? Pick your area from a list instead.
              </>
            )
          }
          action={
            <div className="flex flex-col sm:flex-row gap-2 justify-center">
              <Button
                onClick={() => void handleOptIn()}
                disabled={!!busy}
                className="font-mono"
                data-testid="button-nearby-opt-in"
              >
                {busy === "opt-in" ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <MapPin className="h-4 w-4 mr-2" />
                )}
                Use GPS
              </Button>
              <Button
                variant="outline"
                onClick={() => setPickerOpen(true)}
                disabled={!!busy}
                className="font-mono"
                data-testid="button-nearby-pick-region"
              >
                {busy === "manual" ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Compass className="h-4 w-4 mr-2" />
                )}
                Pick area from list
              </Button>
            </div>
          }
        />
      ) : (
        <NearbyList entries={entries} loading={loading} />
      )}

      <RegionPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={handleManualPick}
        initial={coarseLocation}
      />
    </div>
  );
}

function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-4 border border-border bg-secondary/10 rounded-md p-8">
        <div className="flex justify-center">{icon}</div>
        <h2 className="text-lg font-bold font-mono text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground font-mono leading-relaxed">
          {body}
        </p>
        {action && <div className="pt-2">{action}</div>}
      </div>
    </div>
  );
}

function NearbyList({
  entries,
  loading,
}: {
  entries: NearbyEntry[];
  loading: boolean;
}) {
  if (loading && entries.length === 0) {
    return (
      <div className="p-4 grid gap-4 grid-cols-1 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="border border-border bg-secondary/10 rounded-md p-4 flex gap-4"
          >
            <Skeleton className="w-16 h-16 rounded-full shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-12 w-full" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<Users className="h-8 w-8 text-primary" />}
        title="No one nearby yet"
        body="Nobody else has opted in to Nearby in your area on the relays you're connected to. Check back later, or invite someone you know to share their cell too."
      />
    );
  }

  return (
    <div className="p-4 grid gap-4 grid-cols-1 md:grid-cols-2">
      {entries.map((entry) => (
        <NearbyCard key={entry.pubkey} entry={entry} />
      ))}
    </div>
  );
}

function NearbyCard({ entry }: { entry: NearbyEntry }) {
  const { profile } = useProfile(entry.pubkey);
  const { context } = useForumContext(entry.pubkey);
  const [, setLocation] = useLocation();
  const npub = hexToNpub(entry.pubkey);
  const displayName = profile?.display_name || profile?.name || "";
  const initial = (displayName || npub).charAt(displayName ? 0 : 4).toUpperCase();

  const recentTitle =
    context.recent?.tags.find((t) => t[0] === "subject" || t[0] === "title")?.[1] ??
    null;
  const recentSnippet = context.recent?.content
    ? truncate(context.recent.content, 180)
    : null;
  const isReply = context.recent?.tags.some((t) => t[0] === "e") ?? false;

  // Inner links handle their own navigation; suppress card-level navigation
  // when the user clicks something inside that already routes elsewhere.
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const goToProfile = () => {
    // Hint the profile page that this navigation came from Nearby so it
    // can render the conversation-starter prompt. SessionStorage avoids
    // fighting the hash router over query strings.
    try {
      sessionStorage.setItem("agora.profile.fromNearby", entry.pubkey);
    } catch {
      /* ignore */
    }
    setLocation(`/profile/${npub}`);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={goToProfile}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          goToProfile();
        }
      }}
      className="border border-border bg-secondary/10 rounded-md p-4 flex gap-4 cursor-pointer transition-colors hover:bg-secondary/20 focus:outline-none focus:ring-2 focus:ring-primary/40 text-left"
      data-testid={`card-nearby-${npub}`}
    >
      {profile?.picture ? (
        <img
          src={profile.picture}
          alt={displayName || "Avatar"}
          className="w-16 h-16 rounded-full object-cover bg-secondary border border-border shrink-0"
        />
      ) : (
        <div className="w-16 h-16 rounded-full bg-secondary border border-border flex items-center justify-center text-primary font-bold text-xl shrink-0">
          {initial}
        </div>
      )}
      <div className="flex-1 min-w-0 space-y-2">
        <div>
          <div className="font-bold text-foreground truncate">
            {displayName || "Anonymous"}
          </div>
          <div className="text-xs font-mono text-muted-foreground truncate">
            {authorLabel(npub, displayName)}
          </div>
        </div>

        {context.communities.length > 0 ? (
          <div className="flex flex-wrap gap-1.5" onClick={stop}>
            {context.communities.map((id) => (
              <Link key={id} href={`/community/${encodeURIComponent(id)}`}>
                <span className="text-[10px] font-mono uppercase tracking-wider text-primary border border-primary/40 px-1.5 py-0.5 rounded-sm flex items-center gap-1 cursor-pointer hover:bg-primary/10">
                  <Hash className="h-3 w-3" />
                  {id}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-[11px] font-mono text-muted-foreground italic">
            No community posts seen yet.
          </div>
        )}

        {context.recent ? (
          <div onClick={stop}>
            <Link href={`/post/${context.recent.id}`}>
              <div
                className="border-l-2 border-primary/40 pl-3 space-y-1 cursor-pointer hover:border-primary transition-colors block"
                data-testid={`link-nearby-recent-${npub}`}
              >
                {recentTitle && (
                  <div className="text-xs font-bold text-foreground line-clamp-1">
                    {recentTitle}
                  </div>
                )}
                {recentSnippet && (
                  <div className="text-xs text-muted-foreground font-mono line-clamp-3 break-words whitespace-pre-wrap">
                    {linkify(recentSnippet)}
                  </div>
                )}
                <div className="text-[10px] font-mono text-primary flex items-center gap-1 pt-0.5">
                  {isReply ? (
                    <MessageSquare className="h-3 w-3" />
                  ) : (
                    <ExternalLink className="h-3 w-3" />
                  )}
                  {isReply ? "View comment thread" : "View full post"}
                </div>
              </div>
            </Link>
          </div>
        ) : (
          <div className="text-[11px] font-mono text-muted-foreground italic">
            No recent posts to show.
          </div>
        )}
      </div>
    </div>
  );
}

function truncate(s: string, n: number): string {
  const t = s.trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
}
