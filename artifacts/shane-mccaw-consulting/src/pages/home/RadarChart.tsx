const RADAR_COLORS = ["#3B82F6", "#8B5CF6", "#F3F4F6", "#14B8A6", "#F97316", "#22C55E"];
const STROKE_COLORS = ["#60A5FA", "#A78BFA", "#D1D5DB", "#2DD4BF", "#FB923C", "#4ADE80"];

/** `sectorPath(i, ri, ro)` from the mockup: a 6-way pie-wedge polar path with a
 * small angular gap between wedges, centered on (240,240). */
export function sectorPath(i: number, ri: number, ro: number): string {
  const rad = Math.PI / 180;
  const a0 = (-90 + i * 60 + 2) * rad;
  const a1 = (-90 + (i + 1) * 60 - 2) * rad;
  const p = (r: number, a: number) => `${(240 + r * Math.cos(a)).toFixed(2)},${(240 + r * Math.sin(a)).toFixed(2)}`;
  return `M${p(ri, a0)} L${p(ro, a0)} A${ro},${ro} 0 0 1 ${p(ro, a1)} L${p(ri, a1)} A${ri},${ri} 0 0 0 ${p(ri, a0)} Z`;
}

/** The six-pillar radar used in the hero (live quiz estimate) and, at a smaller
 * size, in the illustrative scan step of the mocked flow. Wedge values are 0-1. */
export function RadarChart({
  idPrefix,
  values,
  trackOnly = false,
}: {
  idPrefix: string;
  values: number[];
  /** Renders the faint always-visible pillar sector outlines behind the live wedges (used by the scan step). */
  trackOnly?: boolean;
}) {
  return (
    <svg viewBox="0 0 480 480" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", overflow: "visible" }}>
      <defs>
        {RADAR_COLORS.map((c, i) => (
          <radialGradient key={i} id={`${idPrefix}g${i}`} gradientUnits="userSpaceOnUse" cx="240" cy="240" r="214">
            <stop offset="0.47" stopColor="#ffffff" stopOpacity="0.55" />
            <stop offset="0.56" stopColor={c} stopOpacity="1" />
            <stop offset="0.78" stopColor={c} stopOpacity="0.42" />
            <stop offset="1" stopColor={c} stopOpacity="0.06" />
          </radialGradient>
        ))}
        <radialGradient id={`${idPrefix}Hub`} gradientUnits="userSpaceOnUse" cx="240" cy="240" r="122">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.30" />
          <stop offset="0.34" stopColor="#22D3EE" stopOpacity="0.26" />
          <stop offset="0.72" stopColor="#3B82F6" stopOpacity="0.16" />
          <stop offset="1" stopColor="#020617" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx="240" cy="240" r="214" fill="none" stroke="rgba(148,163,184,.16)" strokeWidth={trackOnly ? 1.6 : 1} />
      {!trackOnly && (
        <>
          <circle cx="240" cy="240" r="143" fill="none" stroke="rgba(148,163,184,.10)" strokeWidth="1" />
          <circle cx="240" cy="240" r="71" fill="none" stroke="rgba(148,163,184,.08)" strokeWidth="1" />
        </>
      )}

      {trackOnly &&
        RADAR_COLORS.map((c, i) => (
          <path key={`track-${i}`} d={sectorPath(i, 100, 195)} fill={c} fillOpacity={0.13} stroke={STROKE_COLORS[i]} strokeOpacity={0.14} strokeWidth={1.4} />
        ))}

      {RADAR_COLORS.map((_, i) => (
        <path
          key={i}
          d={sectorPath(i, 100, 100 + values[i] * 95)}
          fill={`url(#${idPrefix}g${i})`}
          stroke={STROKE_COLORS[i]}
          strokeOpacity={0.5}
          strokeWidth={trackOnly ? 1.2 : 0.8}
          style={{ transition: `d ${trackOnly ? ".8s" : ".7s"} cubic-bezier(.2,.8,.2,1)` }}
        />
      ))}

      <circle cx="240" cy="240" r="100" fill="#050d1f" />
      <circle cx="240" cy="240" r="100" fill={`url(#${idPrefix}Hub)`} />
    </svg>
  );
}

/** The static six wedge-shaped tinted background sectors behind the hero radar. */
export function RadarBackdrop() {
  return (
    <g>
      <path
        d="M243.49,140.06 L247.47,26.13 A214,214 0 0 1 421.48,126.60 L324.80,187.01 A100,100 0 0 0 243.49,140.06 Z"
        fill="#1e3a8a"
        fillOpacity=".16"
        stroke="#60a5fa"
        strokeOpacity=".18"
        strokeWidth="1"
      />
      <path
        d="M328.29,193.05 L428.95,139.53 A214,214 0 0 1 428.95,340.47 L328.29,286.95 A100,100 0 0 0 328.29,193.05 Z"
        fill="#4c1d95"
        fillOpacity=".16"
        stroke="#a78bfa"
        strokeOpacity=".18"
        strokeWidth="1"
      />
      <path
        d="M324.80,292.99 L421.48,353.40 A214,214 0 0 1 247.47,453.87 L243.49,339.94 A100,100 0 0 0 324.80,292.99 Z"
        fill="#334155"
        fillOpacity=".16"
        stroke="#D1D5DB"
        strokeOpacity=".18"
        strokeWidth="1"
      />
      <path
        d="M236.51,339.94 L232.53,453.87 A214,214 0 0 1 58.52,353.40 L155.20,292.99 A100,100 0 0 0 236.51,339.94 Z"
        fill="#134e4a"
        fillOpacity=".16"
        stroke="#2dd4bf"
        strokeOpacity=".18"
        strokeWidth="1"
      />
      <path
        d="M151.71,286.95 L51.05,340.47 A214,214 0 0 1 51.05,139.53 L151.71,193.05 A100,100 0 0 0 151.71,286.95 Z"
        fill="#7c2d12"
        fillOpacity=".16"
        stroke="#fb923c"
        strokeOpacity=".18"
        strokeWidth="1"
      />
      <path
        d="M155.20,187.01 L58.52,126.60 A214,214 0 0 1 232.53,26.13 L236.51,140.06 A100,100 0 0 0 155.20,187.01 Z"
        fill="#14532d"
        fillOpacity=".16"
        stroke="#4ADE80"
        strokeOpacity=".18"
        strokeWidth="1"
      />
    </g>
  );
}

/** The conic-gradient orbiting ring behind/around the hub number. */
export function OrbitRing({ size, opacity = 0.5, spin = true }: { size: string; opacity?: number; spin?: boolean }) {
  return (
    <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: size, height: size, pointerEvents: "none" }}>
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: "50%",
          background: "conic-gradient(from 0deg,#3B82F6,#8B5CF6,#22D3EE,#F3F4F6,#8B5CF6,#3B82F6)",
          WebkitMask: spin ? "radial-gradient(circle,transparent 63%,#000 68%,#000 73%,transparent 78%)" : undefined,
          mask: spin ? "radial-gradient(circle,transparent 63%,#000 68%,#000 73%,transparent 78%)" : undefined,
          animation: spin ? "smcOrb 22s linear infinite" : undefined,
          opacity,
        }}
      />
    </div>
  );
}
