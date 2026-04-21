import { useState, useEffect } from "react";
import { Image as ImageIcon, Video as VideoIcon, AlertTriangle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes, hostnameOf } from "@/lib/media/upload";
import { getAutoLoadMedia } from "@/lib/media/preferences";

export type MediaKind = "image" | "video";

export interface MediaProps {
  urls: string[]; // primary first, fallbacks after
  kind?: MediaKind;
  filename?: string;
  sizeBytes?: number;
  className?: string;
}

function inferKind(url: string): MediaKind {
  const ext = url.split("?")[0].split("#")[0].split(".").pop()?.toLowerCase() ?? "";
  if (["mp4", "webm", "mov", "m4v", "ogg"].includes(ext)) return "video";
  return "image";
}

export function Media({ urls, kind, filename, sizeBytes, className }: MediaProps) {
  const validUrls = urls.filter((u) => typeof u === "string" && u.length > 0);
  const initialAuto = getAutoLoadMedia();
  const [loaded, setLoaded] = useState(initialAuto);
  const [activeIndex, setActiveIndex] = useState(0);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    setActiveIndex(0);
    setErrored(false);
  }, [urls.join("|")]);

  if (validUrls.length === 0) return null;

  const resolvedKind = kind ?? inferKind(validUrls[0]);
  const KindIcon = resolvedKind === "video" ? VideoIcon : ImageIcon;
  const activeUrl = validUrls[activeIndex];
  const activeHost = hostnameOf(activeUrl);
  const fallbackHost = activeIndex + 1 < validUrls.length ? hostnameOf(validUrls[activeIndex + 1]) : null;

  const handleError = () => {
    if (activeIndex + 1 < validUrls.length) {
      setActiveIndex((i) => i + 1);
    } else {
      setErrored(true);
    }
  };

  if (!loaded) {
    return (
      <div
        className={`my-3 border border-border bg-secondary/20 rounded-md overflow-hidden ${className ?? ""}`}
        data-testid="media-placeholder"
      >
        <div className="flex items-center justify-between px-3 py-2 bg-secondary/40 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <KindIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs font-mono text-muted-foreground truncate">
              {filename ?? `${resolvedKind} from ${activeHost}`}
            </span>
          </div>
          <span className="text-[10px] font-mono text-muted-foreground shrink-0 ml-2">
            {sizeBytes ? formatBytes(sizeBytes) : "size unknown"}
          </span>
        </div>
        <div className="p-4 flex flex-col items-center gap-3">
          <p className="text-xs font-mono text-muted-foreground text-center max-w-sm">
            Click to load. Fetching this {resolvedKind} reveals your IP to the host.
          </p>
          <Button
            size="sm"
            variant="default"
            onClick={() => setLoaded(true)}
            data-testid="button-load-media"
            className="font-mono"
          >
            Load {resolvedKind} from {activeHost}
          </Button>
          {validUrls.length > 1 && (
            <p className="text-[10px] font-mono text-muted-foreground">
              {validUrls.length} mirrors available
            </p>
          )}
        </div>
      </div>
    );
  }

  if (errored) {
    return (
      <div className={`my-3 border border-destructive/40 bg-destructive/5 rounded-md p-3 ${className ?? ""}`}>
        <div className="flex items-center gap-2 text-xs font-mono text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" />
          All {validUrls.length} mirror{validUrls.length === 1 ? "" : "s"} failed to load.
        </div>
        <div className="mt-2 flex flex-col gap-1">
          {validUrls.map((u) => (
            <a
              key={u}
              href={u}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="text-[11px] font-mono text-muted-foreground hover:text-primary truncate flex items-center gap-1"
            >
              <ExternalLink className="h-3 w-3 shrink-0" /> {u}
            </a>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`my-3 border border-border bg-black/40 rounded-md overflow-hidden ${className ?? ""}`}>
      <div className="flex items-center justify-between px-3 py-1.5 bg-secondary/40 border-b border-border">
        <span className="text-[10px] font-mono text-muted-foreground truncate">
          {activeHost}{fallbackHost ? ` (fallback: ${fallbackHost})` : ""}
        </span>
        <a
          href={activeUrl}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="text-[10px] font-mono text-muted-foreground hover:text-primary flex items-center gap-1 shrink-0 ml-2"
        >
          <ExternalLink className="h-3 w-3" /> open
        </a>
      </div>
      {resolvedKind === "video" ? (
        <video
          key={activeUrl}
          src={activeUrl}
          controls
          preload="metadata"
          onError={handleError}
          className="w-full max-h-[600px] bg-black"
          data-testid="media-video"
        />
      ) : (
        <img
          key={activeUrl}
          src={activeUrl}
          alt={filename ?? "embedded media"}
          loading="lazy"
          onError={handleError}
          className="w-full max-h-[600px] object-contain bg-black"
          data-testid="media-image"
        />
      )}
    </div>
  );
}

interface MediaListProps {
  urls: string[]; // flat list of all media urls in a post
  className?: string;
}

// Each entry in `urls` represents one media item; if it contains multiple
// whitespace-separated URLs they are treated as mirrors of the same file
// (primary first, fallbacks next). This matches the redundant-upload pipeline
// which produces two URLs per attachment.
export function MediaList({ urls, className }: MediaListProps) {
  if (!urls || urls.length === 0) return null;
  return (
    <div className={className}>
      {urls.map((entry, i) => {
        const mirrors = entry.split(/\s+/).filter(Boolean);
        if (mirrors.length === 0) return null;
        return <Media key={`${entry}-${i}`} urls={mirrors} />;
      })}
    </div>
  );
}
