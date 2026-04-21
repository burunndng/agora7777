import { Bookmark, BookmarkCheck } from "lucide-react";
import type { Event as NostrEvent } from "nostr-tools/core";
import { useToast } from "@/hooks/use-toast";
import { useBookmarkActions } from "@/lib/nostr/bookmarks";
import { cn } from "@/lib/utils";

export interface BookmarkButtonProps {
  event: NostrEvent;
  size?: "sm" | "md";
  withLabel?: boolean;
  className?: string;
}

export function BookmarkButton({
  event,
  size = "sm",
  withLabel = false,
  className,
}: BookmarkButtonProps) {
  const { toggle, isBookmarked, canBookmark } = useBookmarkActions();
  const { toast } = useToast();

  if (!canBookmark) return null;
  const saved = isBookmarked(event.id);
  const Icon = saved ? BookmarkCheck : Bookmark;

  const handleClick = async () => {
    try {
      const nowSaved = await toggle(event);
      toast({
        title: nowSaved ? "Bookmarked" : "Bookmark removed",
        description: nowSaved
          ? "Saved to your encrypted local bookmarks."
          : "Removed from your local bookmarks.",
      });
    } catch (err) {
      toast({
        title: "Bookmark failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={saved}
      className={cn(
        "inline-flex items-center gap-1 font-mono transition-colors",
        size === "md" ? "text-sm" : "text-xs",
        saved
          ? "text-primary hover:text-primary/80"
          : "text-muted-foreground hover:text-foreground",
        className,
      )}
      data-testid="bookmark-toggle"
      data-bookmarked={saved ? "true" : "false"}
    >
      <Icon
        className={cn(size === "md" ? "h-4 w-4" : "h-3.5 w-3.5", saved && "fill-current")}
      />
      {withLabel && <span>{saved ? "Saved" : "Save"}</span>}
    </button>
  );
}
