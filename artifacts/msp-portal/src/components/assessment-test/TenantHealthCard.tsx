import React from 'react';
import { RadarPillarEntry } from './types';
import { Activity } from 'lucide-react';

interface TenantHealthCardProps {
  /** All 7 pillars in canonical order; score:null = not covered by this scan. */
  pillars: RadarPillarEntry[];
  /** Real average of covered pillars' scores (same derivation as the page). */
  unifiedScore: number | null;
  onClick?: () => void;
}

/**
 * Real tenant-health radar over the full 7-pillar set (Security, Governance,
 * Compliance, Adoption, Copilot, Architecture, Licensing — status.radar.pillars,
 * package-aware). Honesty rules, matching the gauge row's precedent:
 *  - only pillars the customer's scanned package genuinely covers get an axis —
 *    an uncovered pillar never renders a fabricated axis/vertex;
 *  - a polygon needs 3+ covered axes; with 1–2 the covered pillars render as
 *    plain bars instead of a degenerate fake radar;
 *  - uncovered pillars are named in the footer so the omission is explicit.
 */
export const TenantHealthCard: React.FC<TenantHealthCardProps> = ({ pillars, unifiedScore, onClick }) => {
  const covered = pillars.filter(
    (p): p is RadarPillarEntry & { score: number } => p.score != null,
  );
  const uncovered = pillars.filter((p) => p.score == null);

  // Center & radius for the SVG radar chart
  const cx = 130;
  const cy = 110;
  const radius = 70;

  // Per-axis colors, cycled over the covered axes (fixed palette, 7 entries so
  // every pillar keeps a stable hue whichever subset is covered).
  const pillarColors = ['#34d399', '#fbbf24', '#60a5fa', '#2dd4bf', '#c084fc', '#818cf8', '#fb923c'];
  const colorFor = (key: string) => {
    const idx = pillars.findIndex((p) => p.key === key);
    return pillarColors[(idx >= 0 ? idx : 0) % pillarColors.length];
  };

  // Evenly-distributed axis angles for the covered pillars, starting at top.
  const angleFor = (index: number) => -90 + (index * 360) / covered.length;

  const pointAt = (index: number, valPercent: number) => {
    const rad = (angleFor(index) * Math.PI) / 180;
    const r = (radius * valPercent) / 100;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };

  // Concentric grid polygons (at 25%, 50%, 75%, 100%)
  const gridLevels = [0.25, 0.5, 0.75, 1.0];
  const gridPolygons = gridLevels.map((level) =>
    covered
      .map((_, i) => {
        const rad = (angleFor(i) * Math.PI) / 180;
        return `${cx + radius * level * Math.cos(rad)},${cy + radius * level * Math.sin(rad)}`;
      })
      .join(' '),
  );

  const dataPoints = covered.map((p, i) => pointAt(i, p.score));
  const dataPolygonString = dataPoints.map((p) => `${p.x},${p.y}`).join(' ');

  // Angle-aware label placement (anchor flips by which side of the chart).
  const labelFor = (index: number) => {
    const rad = (angleFor(index) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const lx = cx + (radius + 14) * cos;
    const ly = cy + (radius + 16) * sin + 4;
    const anchor = cos > 0.35 ? 'start' : cos < -0.35 ? 'end' : 'middle';
    return { x: lx, y: ly, anchor };
  };

  return (
    <div
      onClick={onClick}
      className="bg-[#242424] rounded-xl card-border p-4 flex flex-col relative overflow-hidden hover:border-[#479ef5]/40 transition-all cursor-pointer shadow-md group"
    >
      {/* Header */}
      <div className="flex justify-between items-start mb-1">
        <div>
          <span className="text-[11px] font-semibold text-[#8a919d] uppercase tracking-wider block">
            Tenant Health Radar
          </span>
          <div className="text-xs text-[#c0c7d3] mt-0.5">
            Real pillar scores from this scan
          </div>
        </div>

        {/* Unified Score Badge — real covered-pillar average; em-dash until data exists */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#479ef5]/15 border border-[#479ef5]/30">
          <Activity className="w-3.5 h-3.5 text-[#479ef5]" />
          <span className="text-xs font-bold text-[#e0e2ea] font-mono">
            {unifiedScore != null ? `${unifiedScore}%` : '—'}
          </span>
        </div>
      </div>

      {covered.length >= 3 ? (
        /* Full radar — 3+ real axes */
        <div className="flex items-center justify-center relative py-1 my-1">
          <svg width="260" height="230" className="overflow-visible">
            <defs>
              <linearGradient id="radarGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#ef4444" stopOpacity="0.35" />
                <stop offset="35%" stopColor="#fbbf24" stopOpacity="0.25" />
                <stop offset="70%" stopColor="#34d399" stopOpacity="0.3" />
                <stop offset="100%" stopColor="#c084fc" stopOpacity="0.35" />
              </linearGradient>
              <filter id="radarGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>

            {/* Grid concentric polygons */}
            {gridPolygons.map((polyStr, i) => (
              <polygon
                key={i}
                points={polyStr}
                fill="none"
                stroke="rgba(255, 255, 255, 0.08)"
                strokeWidth="1"
                strokeDasharray={i === gridLevels.length - 1 ? 'none' : '2 2'}
              />
            ))}

            {/* Axis lines */}
            {covered.map((_, i) => {
              const rad = (angleFor(i) * Math.PI) / 180;
              return (
                <line
                  key={i}
                  x1={cx}
                  y1={cy}
                  x2={cx + radius * Math.cos(rad)}
                  y2={cy + radius * Math.sin(rad)}
                  stroke="rgba(255, 255, 255, 0.12)"
                  strokeWidth="1"
                />
              );
            })}

            {/* Filled data polygon */}
            <polygon
              points={dataPolygonString}
              fill="url(#radarGradient)"
              stroke="#479ef5"
              strokeWidth="2"
              filter="url(#radarGlow)"
              className="transition-all duration-700 ease-out group-hover:stroke-[#34d399]"
            />

            {/* Data vertices */}
            {dataPoints.map((pt, i) => (
              <circle
                key={i}
                cx={pt.x}
                cy={pt.y}
                r="4"
                fill={colorFor(covered[i].key)}
                stroke="#101419"
                strokeWidth="2"
                className="group-hover:scale-125 transition-transform origin-center"
              />
            ))}

            {/* Axis labels */}
            {covered.map((p, i) => {
              const lbl = labelFor(i);
              return (
                <text
                  key={p.key}
                  x={lbl.x}
                  y={lbl.y}
                  textAnchor={lbl.anchor as 'start' | 'middle' | 'end'}
                  fill="#c0c7d3"
                  fontSize="10"
                  fontWeight="600"
                  className="font-sans"
                >
                  {p.label}{' '}
                  <tspan fill={colorFor(p.key)} fontWeight="700">
                    ({p.score}%)
                  </tspan>
                </text>
              );
            })}

            {/* Center dot */}
            <circle cx={cx} cy={cy} r="3" fill="#8a919d" />
          </svg>
        </div>
      ) : covered.length > 0 ? (
        /* 1–2 covered pillars — honest bars, not a degenerate radar polygon */
        <div className="flex flex-col gap-3 py-4 my-1">
          {covered.map((p) => (
            <div key={p.key} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#e0e2ea] font-medium">{p.label}</span>
                <span className="font-bold font-mono" style={{ color: colorFor(p.key) }}>
                  {p.score}%
                </span>
              </div>
              <div className="w-full bg-[#181c21] rounded-full h-1.5">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${p.score}%`, backgroundColor: colorFor(p.key) }}
                />
              </div>
            </div>
          ))}
          <div className="text-[11px] text-[#8a919d]">
            Radar view needs 3+ covered pillars
          </div>
        </div>
      ) : (
        /* Nothing covered yet — honest empty state */
        <div className="flex items-center justify-center h-32 my-1 text-xs text-[#8a919d]">
          No pillar data from this scan yet
        </div>
      )}

      {/* Footer — real coverage provenance; uncovered pillars named explicitly */}
      <div className="flex flex-col gap-0.5 pt-2 border-t border-white/5 text-[11px] text-[#8a919d]">
        <span>
          {covered.length} of {pillars.length} pillars covered by this scan
        </span>
        {uncovered.length > 0 && (
          <span className="truncate">
            Not covered: {uncovered.map((p) => p.label).join(', ')}
          </span>
        )}
      </div>
    </div>
  );
};
