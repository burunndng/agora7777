import { useEffect, useMemo, useState } from "react";
import { MapPin, Search, Globe, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  coarsen,
  NEARBY_GRID_DEG,
  type CoarseLocation,
} from "@/lib/nostr/nearby";
import { searchRegions, type Region } from "@/lib/nostr/region-list";
import { WorldMapPicker } from "@/components/world-map-picker";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Return true on success so the dialog can close; return false (or
  // throw) on failure so the user keeps their selection and can retry.
  onPick: (loc: CoarseLocation) => Promise<boolean> | boolean;
  initial?: CoarseLocation | null;
};

// Manual region picker: lets the user choose a region from a built-in
// city list or enter approximate coordinates by hand. The selected
// reading is always coarsened to the same grid that geolocation uses,
// so publishing a hand-picked region cannot leak more precision than
// the GPS path. The list is offline (no geocoder network call), so the
// dialog itself is privacy-neutral.
export function RegionPickerDialog({ open, onOpenChange, onPick, initial }: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Region | null>(null);
  const [latStr, setLatStr] = useState("");
  const [lngStr, setLngStr] = useState("");
  const [coordError, setCoordError] = useState<string | null>(null);
  const [tab, setTab] = useState<"cities" | "coords">("cities");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected(null);
    setCoordError(null);
    if (initial) {
      setLatStr(initial.lat.toFixed(2));
      setLngStr(initial.lng.toFixed(2));
    } else {
      setLatStr("");
      setLngStr("");
    }
  }, [open, initial]);

  const matches = useMemo(() => searchRegions(query, 80), [query]);

  const previewFromCity = selected
    ? coarsen(selected.lat, selected.lng)
    : null;

  const previewFromCoords = useMemo<CoarseLocation | null>(() => {
    const lat = Number.parseFloat(latStr);
    const lng = Number.parseFloat(lngStr);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return coarsen(lat, lng);
  }, [latStr, lngStr]);

  // Only close the dialog when the parent confirms the publish
  // succeeded — on failure we keep the user's selection visible so they
  // can edit and retry without re-searching.
  const tryPick = async (loc: CoarseLocation) => {
    setSaving(true);
    try {
      const ok = await onPick(loc);
      if (ok) onOpenChange(false);
    } catch {
      /* parent surfaces the error via toast; keep dialog open */
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (saving) return;
    if (tab === "cities") {
      if (!previewFromCity) return;
      await tryPick(previewFromCity);
      return;
    }
    const lat = Number.parseFloat(latStr);
    const lng = Number.parseFloat(lngStr);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setCoordError("Enter both latitude and longitude as numbers.");
      return;
    }
    if (lat < -90 || lat > 90) {
      setCoordError("Latitude must be between -90 and 90.");
      return;
    }
    if (lng < -180 || lng > 180) {
      setCoordError("Longitude must be between -180 and 180.");
      return;
    }
    setCoordError(null);
    await tryPick(coarsen(lat, lng));
  };

  const canSave =
    tab === "cities" ? previewFromCity !== null : previewFromCoords !== null;

  // Prefer the active tab's preview, but fall back to whichever side
  // has a valid selection so the marker doesn't disappear just because
  // the user toggled tabs.
  const mapMarker =
    tab === "cities"
      ? (previewFromCity ?? previewFromCoords)
      : (previewFromCoords ?? previewFromCity);

  // Clicking the world map fills the coordinate inputs (snapped to the
  // grid via the previewFromCoords memo) and switches to the Coordinates
  // tab so the user can see and tweak the result before saving.
  const handleMapPick = (loc: CoarseLocation) => {
    const snapped = coarsen(loc.lat, loc.lng);
    setLatStr(snapped.lat.toFixed(2));
    setLngStr(snapped.lng.toFixed(2));
    setCoordError(null);
    setSelected(null);
    setTab("coords");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg"
        data-testid="dialog-region-picker"
      >
        <DialogHeader>
          <DialogTitle className="font-mono flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" /> Pick your area
          </DialogTitle>
          <DialogDescription className="font-mono text-xs leading-relaxed">
            Choose a city or enter approximate coordinates. Whatever you pick
            is snapped to the nearest ~11 km grid cell
            ({NEARBY_GRID_DEG.toFixed(1)}°) before it leaves your device —
            the same coarsening the GPS path uses, so no extra precision is
            published.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          <WorldMapPicker
            selected={mapMarker}
            onPick={handleMapPick}
          />
          <p className="text-[10px] font-mono text-muted-foreground">
            Tap anywhere on the map to drop a marker — handy for remote areas
            with no nearby city.
          </p>
        </div>

        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as "cities" | "coords")}
          className="w-full"
        >
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="cities" data-testid="tab-region-cities">
              Cities
            </TabsTrigger>
            <TabsTrigger value="coords" data-testid="tab-region-coords">
              Coordinates
            </TabsTrigger>
          </TabsList>

          <TabsContent value="cities" className="space-y-3 mt-3">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search city or country…"
                className="pl-8 font-mono"
                data-testid="input-region-search"
              />
            </div>
            <div
              className="max-h-64 overflow-y-auto border border-border rounded-md divide-y divide-border bg-background"
              data-testid="list-region-results"
            >
              {matches.length === 0 ? (
                <div className="p-4 text-center text-xs font-mono text-muted-foreground">
                  No matches. Try a different name, or use the Coordinates tab.
                </div>
              ) : (
                matches.map((r) => {
                  const active =
                    selected?.name === r.name && selected?.country === r.country;
                  return (
                    <button
                      key={`${r.name}-${r.country}`}
                      type="button"
                      onClick={() => setSelected(r)}
                      className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 hover:bg-secondary/30 focus:outline-none focus:bg-secondary/40 ${
                        active ? "bg-secondary/40" : ""
                      }`}
                      data-testid={`option-region-${r.name.replace(/\s+/g, "-").toLowerCase()}`}
                    >
                      <div className="min-w-0">
                        <div className="text-sm text-foreground truncate">
                          {r.name}
                        </div>
                        <div className="text-[11px] font-mono text-muted-foreground truncate">
                          {r.country}
                        </div>
                      </div>
                      {active && (
                        <MapPin className="h-4 w-4 text-primary shrink-0" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
            {previewFromCity && (
              <div className="text-[11px] font-mono text-muted-foreground bg-secondary/10 border border-border rounded p-2">
                Will publish cell{" "}
                <span className="text-foreground">
                  {previewFromCity.lat.toFixed(2)}°,{" "}
                  {previewFromCity.lng.toFixed(2)}°
                </span>
                .
              </div>
            )}
          </TabsContent>

          <TabsContent value="coords" className="space-y-3 mt-3">
            <p className="text-xs font-mono text-muted-foreground">
              Enter any coordinate inside the area you want others to see.
              You can copy one from a map app — it will be snapped to the
              nearest ~11 km cell before publishing.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label
                  className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground block mb-1"
                  htmlFor="region-lat"
                >
                  Latitude (-90 to 90)
                </label>
                <Input
                  id="region-lat"
                  inputMode="decimal"
                  value={latStr}
                  onChange={(e) => {
                    setLatStr(e.target.value);
                    setCoordError(null);
                  }}
                  placeholder="40.71"
                  className="font-mono"
                  data-testid="input-region-lat"
                />
              </div>
              <div>
                <label
                  className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground block mb-1"
                  htmlFor="region-lng"
                >
                  Longitude (-180 to 180)
                </label>
                <Input
                  id="region-lng"
                  inputMode="decimal"
                  value={lngStr}
                  onChange={(e) => {
                    setLngStr(e.target.value);
                    setCoordError(null);
                  }}
                  placeholder="-74.00"
                  className="font-mono"
                  data-testid="input-region-lng"
                />
              </div>
            </div>
            {coordError && (
              <div
                className="text-xs font-mono text-destructive"
                data-testid="text-region-coord-error"
              >
                {coordError}
              </div>
            )}
            {previewFromCoords && !coordError && (
              <div className="text-[11px] font-mono text-muted-foreground bg-secondary/10 border border-border rounded p-2">
                Will publish cell{" "}
                <span className="text-foreground">
                  {previewFromCoords.lat.toFixed(2)}°,{" "}
                  {previewFromCoords.lng.toFixed(2)}°
                </span>
                .
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            data-testid="button-region-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={!canSave || saving}
            data-testid="button-region-save"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <MapPin className="h-4 w-4 mr-2" />
            )}
            Use this area
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
