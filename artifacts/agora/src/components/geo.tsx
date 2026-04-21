export function GeoLine({ className = "" }: { className?: string }) {
  return (
    <div
      className={className}
      style={{
        height: 1,
        background: "linear-gradient(to right, transparent, #7a5818, transparent)",
        opacity: 0.4,
        flexShrink: 0,
      }}
    />
  );
}

export function GeoAccent({ className = "" }: { className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <polygon points="12,2 22,12 12,22 2,12" stroke="#7a5818" strokeWidth="0.75" fill="none" opacity="0.6" />
      <polygon points="12,6 18,12 12,18 6,12" stroke="#c9962e" strokeWidth="0.5" fill="none" opacity="0.4" />
      <circle cx="12" cy="12" r="1.5" fill="#c9962e" opacity="0.7" />
    </svg>
  );
}

export function GeoCornerTR() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        width: 80,
        height: 80,
        borderBottom: "1px solid #1a2240",
        borderLeft: "1px solid #1a2240",
        opacity: 0.3,
        pointerEvents: "none",
      }}
    />
  );
}

export function GeoCornerBL() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        width: 60,
        height: 60,
        borderTop: "1px solid #7a5818",
        borderRight: "1px solid #7a5818",
        opacity: 0.2,
        pointerEvents: "none",
      }}
    />
  );
}
