import { useRef } from "react";
import type { CoarseLocation } from "@/lib/nostr/nearby";

// Tiny equirectangular world map: lng (-180..180) maps to x (0..360),
// lat (-90..90) maps to y (180..0). Continent shapes are intentionally
// simplified — this is a confirmation/orientation aid, not a real map.

const CONTINENTS: string[] = [
  // North America
  "20,30 32,18 55,15 78,15 95,8 105,15 100,28 115,38 120,55 100,55 88,50 78,55 70,75 55,85 35,70 28,50 20,30",
  // Greenland
  "100,18 118,15 122,28 110,40 100,32 100,18",
  // Central America / Caribbean
  "75,80 90,75 95,82 88,90 78,88 75,80",
  // South America
  "95,92 115,88 122,100 120,125 110,150 98,160 90,150 88,128 92,108 95,92",
  // Europe
  "168,38 200,32 218,38 215,55 195,60 175,55 168,45 168,38",
  // Africa
  "168,72 195,68 215,72 220,95 215,118 200,138 180,140 170,125 165,105 168,85 168,72",
  // Middle East / Arabia
  "215,75 230,72 238,85 230,98 218,95 215,82 215,75",
  // Asia
  "218,30 270,25 320,32 345,45 350,62 335,72 305,80 278,78 258,70 245,55 232,48 218,42 218,30",
  // India
  "248,72 262,72 268,82 260,95 252,90 248,80 248,72",
  // Southeast Asia / Indonesia
  "275,92 305,88 318,95 312,105 290,108 278,102 275,92",
  // Australia
  "292,118 322,115 332,128 322,142 298,140 290,128 292,118",
  // Antarctica
  "0,165 360,165 360,180 0,180 0,165",
];

type Props = {
  selected: CoarseLocation | null;
  onPick: (loc: CoarseLocation) => void;
  className?: string;
};

export function WorldMapPicker({ selected, onPick, className }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const xRatio = (e.clientX - rect.left) / rect.width;
    const yRatio = (e.clientY - rect.top) / rect.height;
    const lng = xRatio * 360 - 180;
    const lat = 90 - yRatio * 180;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;
    onPick({ lat, lng });
  };

  // Marker position in SVG coords.
  const markerX = selected ? selected.lng + 180 : null;
  const markerY = selected ? 90 - selected.lat : null;

  return (
    <div className={className}>
      <svg
        ref={svgRef}
        viewBox="0 0 360 180"
        preserveAspectRatio="none"
        onClick={handleClick}
        className="w-full h-32 rounded border border-border bg-secondary/20 cursor-crosshair block"
        role="img"
        aria-label="World map. Click to choose a location."
        data-testid="svg-region-map"
      >
        {/* Graticule */}
        <g
          stroke="currentColor"
          strokeWidth="0.2"
          opacity="0.18"
          className="text-muted-foreground"
        >
          {[30, 60, 90, 120, 150].map((y) => (
            <line key={`h${y}`} x1={0} y1={y} x2={360} y2={y} />
          ))}
          {[60, 120, 180, 240, 300].map((x) => (
            <line key={`v${x}`} x1={x} y1={0} x2={x} y2={180} />
          ))}
          {/* Equator a little stronger */}
          <line x1={0} y1={90} x2={360} y2={90} strokeWidth="0.4" opacity="0.35" />
        </g>

        {/* Continents */}
        <g
          fill="currentColor"
          className="text-primary/35"
          stroke="currentColor"
          strokeWidth="0.3"
        >
          {CONTINENTS.map((pts, i) => (
            <polygon key={i} points={pts} />
          ))}
        </g>

        {/* Selected marker */}
        {markerX !== null && markerY !== null && (
          <g
            className="text-primary"
            data-testid="marker-region-map"
            pointerEvents="none"
          >
            <circle
              cx={markerX}
              cy={markerY}
              r={4}
              fill="currentColor"
              opacity="0.25"
            />
            <circle
              cx={markerX}
              cy={markerY}
              r={1.8}
              fill="currentColor"
              stroke="white"
              strokeWidth="0.6"
            />
          </g>
        )}
      </svg>
    </div>
  );
}
