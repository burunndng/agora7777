/**
 * Read-only visualisation of a Resonance Map. Reusable for both the
 * viewer's own map and another user's map. Tags are grouped by family in
 * the canonical taxonomy order; intensity is shown as 1–5 filled dots.
 */

import { Sparkles } from "lucide-react";
import { RESONANCE_FAMILIES, MAX_INTENSITY, findResonanceTag } from "@/lib/resonance/taxonomy";
import type { ResonanceMap } from "@/lib/resonance/event";

export function ResonanceMapView({
  map,
  emptyLabel,
}: {
  map: ResonanceMap | null;
  emptyLabel?: string;
}) {
  if (!map || map.selections.length === 0) {
    return (
      <div className="border border-border/60 bg-secondary/10 rounded-md p-4 text-sm text-muted-foreground font-mono">
        {emptyLabel ?? "No Resonance Map published yet."}
      </div>
    );
  }

  const byFamily = new Map<string, { tagId: string; intensity: number }[]>();
  for (const sel of map.selections) {
    const def = findResonanceTag(sel.tagId);
    if (!def) continue;
    const arr = byFamily.get(def.family) ?? [];
    arr.push(sel);
    byFamily.set(def.family, arr);
  }

  return (
    <div
      className="border border-primary/30 bg-primary/5 rounded-md p-4 space-y-4"
      data-testid="resonance-map-view"
    >
      <div className="flex items-center gap-2 text-primary font-mono text-sm font-bold">
        <Sparkles className="h-4 w-4" />
        Resonance Map
      </div>

      <div className="space-y-4">
        {RESONANCE_FAMILIES.map((fam) => {
          const sels = byFamily.get(fam.id);
          if (!sels || sels.length === 0) return null;
          return (
            <div key={fam.id} className="space-y-2">
              <div className="text-[11px] uppercase tracking-widest font-mono text-muted-foreground">
                {fam.label}
              </div>
              <div className="flex flex-wrap gap-2">
                {sels.map((s) => {
                  const def = findResonanceTag(s.tagId);
                  if (!def) return null;
                  return (
                    <div
                      key={s.tagId}
                      className="inline-flex items-center gap-2 border border-primary/40 bg-background/40 rounded-full px-3 py-1 font-mono text-xs"
                      data-testid={`resonance-chip-${s.tagId}`}
                    >
                      <span>{def.label}</span>
                      <IntensityDots value={s.intensity} />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function IntensityDots({ value }: { value: number }) {
  return (
    <span
      className="inline-flex items-center gap-0.5"
      aria-label={`Intensity ${value} of ${MAX_INTENSITY}`}
    >
      {Array.from({ length: MAX_INTENSITY }).map((_, i) => (
        <span
          key={i}
          className={
            i < value
              ? "h-1.5 w-1.5 rounded-full bg-primary"
              : "h-1.5 w-1.5 rounded-full bg-primary/20"
          }
        />
      ))}
    </span>
  );
}

/**
 * Compact "shared interests" badge: tags both viewer and target have
 * marked at intensity ≥ 3. Pure intersection — no ranking, no scoring.
 */
export function SharedResonanceBadge({
  mine,
  theirs,
}: {
  mine: ResonanceMap | null;
  theirs: ResonanceMap | null;
}) {
  if (!mine || !theirs) return null;
  const STRONG = 3;
  const mineStrong = new Set(
    mine.selections.filter((s) => s.intensity >= STRONG).map((s) => s.tagId),
  );
  const shared = theirs.selections
    .filter((s) => s.intensity >= STRONG && mineStrong.has(s.tagId))
    .map((s) => s.tagId);

  if (shared.length === 0) return null;

  return (
    <div
      className="border border-primary/40 bg-primary/10 rounded-md p-3 space-y-2"
      data-testid="shared-resonance-badge"
    >
      <div className="text-[11px] uppercase tracking-widest font-mono text-primary font-bold">
        Shared interests · {shared.length}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {shared.map((id) => {
          const def = findResonanceTag(id);
          if (!def) return null;
          return (
            <span
              key={id}
              className="font-mono text-xs border border-primary/40 px-2 py-0.5 rounded-sm"
            >
              {def.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
