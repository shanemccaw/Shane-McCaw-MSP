import React, { useState } from 'react';
import { Radar } from 'lucide-react';
import { scoreBand, BAND_COLOR_VAR, BAND_TEXT_CLASS } from '@/components/health-suite/useTopicHealthLive';
import type { CopilotReadinessLive } from '@/components/assessment-test/types';

/**
 * Data Safety Radar — the three REAL Copilot-readiness indicators
 * (copilot-readiness.ts: SharePoint/Teams exposure, sensitivity labels, DLP)
 * plotted on genuinely comparable 0–100 axes, replacing the mock radar's
 * invented axes/targets. An indicator with no real score renders at the
 * center and is listed as "no data" — never given an invented position.
 */

interface SafetyRadarChartProps {
  copilotReadiness: CopilotReadinessLive | null;
}

const AXES: { key: 'sharePointTeams' | 'sensitivityLabels' | 'dlp'; label: string }[] = [
  { key: 'sharePointTeams', label: 'SP & Teams exposure' },
  { key: 'sensitivityLabels', label: 'Sensitivity labels' },
  { key: 'dlp', label: 'DLP' },
];

/** Vertex position for axis i (of 3) at radius fraction f (0–1), centered at 50,50. */
function vertex(i: number, f: number): { x: number; y: number } {
  const angle = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
  return { x: 50 + 38 * f * Math.cos(angle), y: 50 + 38 * f * Math.sin(angle) };
}

export const SafetyRadarChart: React.FC<SafetyRadarChartProps> = ({ copilotReadiness }) => {
  const [hovered, setHovered] = useState<string | null>(null);
  const scores = AXES.map((axis) => ({
    ...axis,
    score: copilotReadiness?.[axis.key]?.score ?? null,
  }));
  const anyData = scores.some((s) => s.score != null);
  const overall = copilotReadiness?.overall.score ?? null;
  const overallBand = overall != null ? scoreBand(overall) : null;

  const polygonPoints = scores
    .map((s, i) => {
      const v = vertex(i, (s.score ?? 0) / 100);
      return `${v.x},${v.y}`;
    })
    .join(' ');

  return (
    <div className="bg-card border border-border rounded-xl p-5 flex flex-col h-full">
      <div className="flex justify-between items-center mb-3">
        <h4 className="font-mono text-xs font-semibold text-foreground uppercase flex items-center gap-1.5">
          <Radar className="w-3.5 h-3.5 text-status-violet" />
          DATA SAFETY RADAR
        </h4>
        <span
          className={`text-xs font-mono font-bold ${overallBand ? BAND_TEXT_CLASS[overallBand] : 'text-muted-foreground'}`}
        >
          {overall != null ? `${overall}% overall` : 'No data yet'}
        </span>
      </div>

      {anyData ? (
        <div className="flex-grow flex items-center justify-center relative min-h-[220px]">
          <svg className="w-56 h-56 overflow-visible" viewBox="0 0 100 100">
            {/* Concentric guide rings at 33/66/100 */}
            {[1 / 3, 2 / 3, 1].map((f) => (
              <polygon
                key={f}
                points={AXES.map((_, i) => {
                  const v = vertex(i, f);
                  return `${v.x},${v.y}`;
                }).join(' ')}
                fill="none"
                stroke="hsl(var(--border))"
                strokeWidth="0.5"
              />
            ))}
            {/* Spokes */}
            {AXES.map((_, i) => {
              const v = vertex(i, 1);
              return (
                <line key={i} x1="50" y1="50" x2={v.x} y2={v.y} stroke="hsl(var(--border))" strokeWidth="0.5" />
              );
            })}
            {/* Real score polygon */}
            <polygon
              points={polygonPoints}
              fill="color-mix(in srgb, var(--color-status-violet) 25%, transparent)"
              stroke="var(--color-status-violet)"
              strokeWidth="1.5"
            />
            {/* Vertices — only for axes with real scores */}
            {scores.map((s, i) => {
              if (s.score == null) return null;
              const v = vertex(i, s.score / 100);
              return (
                <circle
                  key={s.key}
                  cx={v.x}
                  cy={v.y}
                  r="2.5"
                  fill={BAND_COLOR_VAR[scoreBand(s.score)]}
                  onMouseEnter={() => setHovered(s.key)}
                  onMouseLeave={() => setHovered(null)}
                  className="cursor-pointer"
                />
              );
            })}
          </svg>
        </div>
      ) : (
        <div className="flex-grow flex items-center justify-center text-center px-6 py-10 min-h-[220px]">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            The safety radar appears once your scan has collected the backing
            SharePoint, labeling, and DLP checks.
          </p>
        </div>
      )}

      {/* Axis legend with real values */}
      <div className="grid grid-cols-3 gap-2 pt-3 border-t border-border text-[10px] font-mono">
        {scores.map((s) => {
          const band = s.score != null ? scoreBand(s.score) : null;
          return (
            <div
              key={s.key}
              className={`flex flex-col items-center gap-0.5 rounded py-1 transition-colors ${
                hovered === s.key ? 'bg-muted' : ''
              }`}
            >
              <span className="text-muted-foreground text-center leading-tight">{s.label}</span>
              <span className={`font-bold ${band ? BAND_TEXT_CLASS[band] : 'text-muted-foreground'}`}>
                {s.score != null ? `${s.score}%` : 'no data'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
