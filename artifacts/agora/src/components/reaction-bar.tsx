import { useState } from "react";
import { Smile } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import {
  DEFAULT_REACTION_EMOJIS,
  EXTRA_REACTION_EMOJIS,
  useReactionPublisher,
  useReactions,
} from "@/lib/nostr/reactions";
import { cn } from "@/lib/utils";

export interface ReactionBarProps {
  eventId: string;
  eventPubkey: string;
  eventKind: number;
  /** Set of always-shown emojis. Falls back to the project default. */
  defaults?: string[];
  className?: string;
  size?: "sm" | "md";
}

/**
 * Compact NIP-25 reaction bar shown beneath posts and comments. Hidden
 * entirely for logged-out users so they don't see affordances they
 * cannot use.
 */
export function ReactionBar({
  eventId,
  eventPubkey,
  eventKind,
  defaults = DEFAULT_REACTION_EMOJIS,
  className,
  size = "sm",
}: ReactionBarProps) {
  const { counts, myReactions, loading } = useReactions(eventId, eventPubkey);
  const { react, retract, busy, canReact } = useReactionPublisher();
  const { toast } = useToast();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [animating, setAnimating] = useState<string | null>(null);

  if (!canReact) return null;

  // Show the default set first, then any extras the user/community have used.
  const seen = new Set<string>(defaults);
  const extras: string[] = [];
  for (const k of counts.keys()) if (!seen.has(k)) extras.push(k);
  const allShown = [...defaults, ...extras];

  const myEmojiToId = new Map(myReactions.map((r) => [r.emoji, r.id]));

  const onClick = async (emoji: string) => {
    if (busy) return;
    setAnimating(emoji);
    window.setTimeout(() => setAnimating(null), 250);
    try {
      const existing = myEmojiToId.get(emoji);
      if (existing) {
        await retract(existing);
      } else {
        await react(
          { id: eventId, pubkey: eventPubkey, kind: eventKind },
          emoji,
        );
      }
    } catch (err) {
      toast({
        title: "Reaction failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  const baseBtn =
    size === "md"
      ? "h-8 px-2.5 text-sm"
      : "h-7 px-2 text-xs";

  return (
    <div
      className={cn(
        "flex items-center gap-1 flex-wrap",
        loading ? "opacity-80" : undefined,
        className,
      )}
      data-testid="reaction-bar"
    >
      {allShown.map((emoji) => {
        const count = counts.get(emoji) ?? 0;
        const mine = myEmojiToId.has(emoji);
        if (!defaults.includes(emoji) && count === 0) return null;
        return (
          <button
            key={emoji}
            type="button"
            disabled={busy}
            onClick={() => void onClick(emoji)}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border font-mono transition-all",
              baseBtn,
              mine
                ? "border-primary/60 bg-primary/15 text-primary"
                : "border-border bg-secondary/40 text-muted-foreground hover:bg-secondary hover:text-foreground",
              "disabled:opacity-50",
            )}
            data-testid={`reaction-${emoji}`}
            data-mine={mine ? "true" : "false"}
          >
            <span
              className={cn(
                "leading-none transition-transform",
                animating === emoji ? "scale-125" : "scale-100",
              )}
            >
              {emoji}
            </span>
            {count > 0 && (
              <span
                className={cn(
                  "tabular-nums transition-transform",
                  animating === emoji ? "scale-110" : "scale-100",
                )}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}

      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex items-center justify-center rounded-full border border-dashed border-border text-muted-foreground hover:text-foreground hover:bg-secondary",
              size === "md" ? "h-8 w-8" : "h-7 w-7",
            )}
            aria-label="Add reaction"
            data-testid="reaction-picker"
          >
            <Smile className={size === "md" ? "h-4 w-4" : "h-3.5 w-3.5"} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-56 p-2 grid grid-cols-6 gap-1"
        >
          {EXTRA_REACTION_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              disabled={busy}
              onClick={() => {
                void onClick(emoji);
                setPickerOpen(false);
              }}
              className="h-8 w-8 rounded hover:bg-secondary text-base"
            >
              {emoji}
            </button>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  );
}
