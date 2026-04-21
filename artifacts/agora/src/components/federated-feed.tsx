import { formatDistanceToNow } from "date-fns";
import { ExternalLink, Network, AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useFederatedFeed } from "@/lib/federated/use-federated-feed";
import type { FederatedKind } from "@/lib/federated/types";

const KIND_LABEL: Record<FederatedKind, string> = {
  lemmy: "Lemmy",
  mastodon: "Mastodon",
};

const PLACEHOLDER: Record<FederatedKind, string> = {
  lemmy: "Use community@instance, e.g. technology@lemmy.world.",
  mastodon:
    "Mastodon needs an explicit #tag@instance for hashtags or @user@instance for accounts " +
    "(e.g. #bitcoin@mastodon.social or @Gargron@mastodon.social). A bare name@instance is " +
    "ambiguous and is no longer accepted.",
};

export function FederatedFeed({
  kind,
  identifier,
}: {
  kind: FederatedKind;
  identifier: string;
}) {
  const { data, loading, error, invalid } = useFederatedFeed(kind, identifier);

  if (invalid) {
    return (
      <div className="p-4 text-sm text-destructive font-mono flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
        Could not parse {KIND_LABEL[kind]} identifier "{identifier}". {PLACEHOLDER[kind]}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="p-4 border-b border-border space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-12 w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 m-4 text-sm font-mono text-destructive border border-destructive/40 bg-destructive/5 rounded-md flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
        <div>
          <div className="font-bold">{KIND_LABEL[kind]} bridge failed</div>
          <div className="break-words">{error}</div>
          <div className="mt-2 text-xs text-muted-foreground">
            {kind === "lemmy"
              ? "Tried a direct fetch and several public CORS proxies — all failed. The instance may be down, blocking proxies, or rate-limiting."
              : "Mastodon is fetched directly with no proxy. The instance may be down, the identifier may not exist, or the endpoint may be restricted."}
          </div>
        </div>
      </div>
    );
  }

  if (!data || data.posts.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground font-mono">
        No posts in {data?.source.label ?? identifier}.
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="px-4 py-2 bg-secondary/30 border-b border-border text-[11px] font-mono text-muted-foreground flex items-start gap-2">
        <Network className="h-3 w-3 mt-0.5 shrink-0 text-primary" />
        <span>
          Read-only bridge to{" "}
          <a
            href={data.source.remoteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-primary"
          >
            {data.source.label}
          </a>
          .{" "}
          {data.direct ? (
            <>Fetched directly from {data.source.instance}; only the instance sees your IP.</>
          ) : (
            <>
              Fetched via {data.fetchedVia}; both proxy and the {KIND_LABEL[kind]} instance see
              your IP.
            </>
          )}
        </span>
      </div>
      {data.posts.map((post) => (
        <article
          key={post.id}
          className="p-4 border-b border-border hover:bg-secondary/10 transition-colors"
          data-testid={`federated-post-${kind}`}
        >
          <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono mb-1 flex-wrap">
            <Badge variant="outline" className="text-[10px] h-5 border-primary/40 text-primary">
              via {KIND_LABEL[kind]}
            </Badge>
            <span className="truncate">{post.authorName}</span>
            <span>•</span>
            <span suppressHydrationWarning>
              {formatDistanceToNow(new Date(post.publishedAt * 1000), {
                addSuffix: true,
              })}
            </span>
          </div>
          <a
            href={post.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group block"
          >
            <h3 className="text-lg font-bold text-foreground group-hover:text-primary transition-colors break-words flex items-center gap-2">
              {post.title}
              <ExternalLink className="h-3.5 w-3.5 inline shrink-0 opacity-50" />
            </h3>
            {post.content && (
              <p className="text-sm text-muted-foreground line-clamp-3 mt-1 whitespace-pre-wrap font-mono break-words">
                {post.content}
              </p>
            )}
          </a>
        </article>
      ))}
    </div>
  );
}
