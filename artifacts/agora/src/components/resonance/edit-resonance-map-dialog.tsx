/**
 * Editor for the viewer's own Resonance Map. Tags are toggled with a tap
 * and intensity is set with a 1–5 slider. On save, a single replaceable
 * NIP-51 event (kind 30015, d="agora-resonance-v1") is published to the
 * configured relays.
 */

import { useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, Sparkles, X, ShieldOff } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  RESONANCE_FAMILIES,
  MAX_INTENSITY,
  MIN_INTENSITY,
  MAX_RESONANCE_SELECTIONS,
  clampIntensity,
} from "@/lib/resonance/taxonomy";
import {
  publishResonanceMap,
  useResonanceMap,
} from "@/lib/resonance/use-interests";
import type { Identity } from "@/lib/nostr/identity";
import { useToast } from "@/hooks/use-toast";

export function EditResonanceMapDialog({
  open,
  onOpenChange,
  identity,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  identity: Identity;
}) {
  const { map: current } = useResonanceMap(identity.pubkey);
  const { toast } = useToast();

  // tagId -> intensity (1..5). Absent key means "not selected".
  const [picks, setPicks] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  // Reset picks to the current map every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    const next: Record<string, number> = {};
    if (current) {
      for (const s of current.selections) next[s.tagId] = s.intensity;
    }
    setPicks(next);
  }, [open, current]);

  const total = useMemo(() => Object.keys(picks).length, [picks]);
  const atCap = total >= MAX_RESONANCE_SELECTIONS;

  const togglePick = (tagId: string) => {
    setPicks((prev) => {
      const next = { ...prev };
      if (next[tagId] != null) {
        delete next[tagId];
      } else {
        if (Object.keys(next).length >= MAX_RESONANCE_SELECTIONS) return prev;
        next[tagId] = 3; // sensible default — neither token nor obsession
      }
      return next;
    });
  };

  const setIntensity = (tagId: string, n: number) => {
    setPicks((prev) => {
      if (prev[tagId] == null) return prev;
      return { ...prev, [tagId]: clampIntensity(n) };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const selections = Object.entries(picks).map(([tagId, intensity]) => ({
        tagId,
        intensity,
      }));
      await publishResonanceMap(identity, selections);
      toast({
        title: "Resonance Map saved",
        description:
          selections.length === 0
            ? "Published an empty map — your prior selections are no longer visible to other clients."
            : `Published ${selections.length} interest${selections.length === 1 ? "" : "s"} to your relays.`,
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Could not publish Resonance Map",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl font-mono max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="font-mono text-primary flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            Edit Resonance Map
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-1 space-y-5 py-2">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Tap a tag to add it to your map, then drag the slider to mark how
            strongly it resonates. Up to {MAX_RESONANCE_SELECTIONS}{" "}
            selections — quality over quantity. Saving publishes a single
            replaceable event to your relays so other Nostr clients can
            read it.
          </p>

          <div className="border border-border/60 bg-secondary/10 rounded-md p-3 flex items-start gap-2">
            <ShieldOff className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-bold text-foreground">Soft Mask.</span>{" "}
              If you want a different Resonance Map under a different
              identity, just disconnect and log in with a different handle.
              Agora derives a separate signing key per handle automatically.
            </p>
          </div>

          {RESONANCE_FAMILIES.map((fam) => (
            <div key={fam.id} className="space-y-3">
              <div>
                <div className="text-xs uppercase tracking-widest text-primary font-bold">
                  {fam.label}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {fam.blurb}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {fam.tags.map((tag) => {
                  const selected = picks[tag.id] != null;
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => togglePick(tag.id)}
                      disabled={!selected && atCap}
                      data-testid={`resonance-toggle-${tag.id}`}
                      className={
                        "inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs transition-colors " +
                        (selected
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border bg-background hover:border-primary/40 disabled:opacity-40 disabled:cursor-not-allowed")
                      }
                    >
                      {selected && <X className="h-3 w-3" />}
                      <span>{tag.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Per-tag intensity sliders for this family's selected tags. */}
              {fam.tags.some((t) => picks[t.id] != null) && (
                <div className="space-y-2 pl-1 pt-1">
                  {fam.tags
                    .filter((t) => picks[t.id] != null)
                    .map((tag) => (
                      <div
                        key={tag.id}
                        className="grid grid-cols-[7rem_1fr_2rem] items-center gap-3"
                      >
                        <div className="text-xs truncate" title={tag.label}>
                          {tag.label}
                        </div>
                        <Slider
                          min={MIN_INTENSITY}
                          max={MAX_INTENSITY}
                          step={1}
                          value={[picks[tag.id]]}
                          onValueChange={(v) =>
                            setIntensity(tag.id, v[0] ?? MIN_INTENSITY)
                          }
                          aria-label={`${tag.label} intensity`}
                          data-testid={`resonance-intensity-${tag.id}`}
                        />
                        <div className="text-xs text-muted-foreground text-right tabular-nums">
                          {picks[tag.id]} / {MAX_INTENSITY}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <DialogFooter className="border-t border-border pt-3 flex items-center justify-between">
          <div className="text-xs text-muted-foreground mr-auto">
            {total} / {MAX_RESONANCE_SELECTIONS} selected
          </div>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={saving}
            data-testid="button-save-resonance"
          >
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Publishing…
              </>
            ) : (
              <>
                <Pencil className="h-3.5 w-3.5 mr-1.5" />
                Publish map
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
