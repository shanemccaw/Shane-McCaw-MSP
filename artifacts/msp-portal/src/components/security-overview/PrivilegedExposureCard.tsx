import React, { useState } from 'react';
import { ShieldAlert, CircleDashed } from 'lucide-react';
import type { LiveMetric } from './useSecurityOverviewLive';

/**
 * Privileged Exposure — real privileged-access counts from the monitor check
 * catalog:
 *   • Global Admins        — identity:global-admin-count (real)
 *   • Standing Privileged  — identity:pim-permanent-roles (wired correctly;
 *     Roles                  currently blocked by a known missing Graph scope
 *                            server-side, so it honestly reads "not collected
 *                            yet" until that lands — never faked around)
 *   • Radar axes           — the two above + risky users + high-risk sign-ins,
 *     normalised against the metric registry's RISK_COUNT_BANDS critical
 *     threshold (10): an axis at/above 10 reads as full-scale exposure.
 * Axes with no collected data render at zero with an explicit "—" label.
 */

interface PrivilegedExposureCardProps {
  globalAdmins: LiveMetric;
  pimStandingRoles: LiveMetric;
  riskyUsers: LiveMetric;
  highRiskSignins: LiveMetric;
}

/** RISK_COUNT_BANDS.critical from the metric registry — 10+ = full scale. */
const RADAR_FULL_SCALE = 10;

function radarFraction(m: LiveMetric): number {
  if (!m.collected || m.value == null) return 0;
  return Math.min(1, m.value / RADAR_FULL_SCALE);
}

function axisLabel(m: LiveMetric): string {
  return m.collected && m.value != null ? String(m.value) : '—';
}

export const PrivilegedExposureCard: React.FC<PrivilegedExposureCardProps> = ({
  globalAdmins,
  pimStandingRoles,
  riskyUsers,
  highRiskSignins,
}) => {
  const [hoveredAxis, setHoveredAxis] = useState<string | null>(null);

  const anyCollected =
    globalAdmins.collected || pimStandingRoles.collected || riskyUsers.collected || highRiskSignins.collected;

  // Radar points relative to center (100, 100), max radius 70.
  const pTop = { x: 100, y: 100 - radarFraction(globalAdmins) * 70, label: 'Global Admins' };
  const pRight = { x: 100 + radarFraction(riskyUsers) * 70, y: 100, label: 'Risky Users' };
  const pBottom = { x: 100, y: 100 + radarFraction(pimStandingRoles) * 70, label: 'Standing Roles' };
  const pLeft = { x: 100 - radarFraction(highRiskSignins) * 70, y: 100, label: 'High-Risk Sign-ins' };

  const polygonPath = `${pTop.x},${pTop.y} ${pRight.x},${pRight.y} ${pBottom.x},${pBottom.y} ${pLeft.x},${pLeft.y}`;

  return (
    <div className="bg-card rounded-xl p-6 border border-border shadow-md flex flex-col justify-between h-full">
      {/* Title */}
      <div className="flex justify-between items-start mb-5">
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-0.5">Privileged Exposure</h2>
          <p className="text-muted-foreground text-xs">Privileged roles &amp; identity risk surfaces</p>
        </div>
        <span className="p-2 bg-primary/10 rounded-lg text-primary border border-primary/20">
          <ShieldAlert className="w-5 h-5" />
        </span>
      </div>

      {/* Real counts */}
      <div className="grid grid-cols-2 gap-6 mb-6">
        <div className="border-l-2 border-status-blue pl-3.5">
          <div className="text-muted-foreground font-mono text-[11px] uppercase tracking-wider">
            Global Admins
          </div>
          <div className="text-2xl font-semibold font-mono text-foreground mt-0.5">
            {axisLabel(globalAdmins)}
          </div>
          {!globalAdmins.collected && (
            <div className="text-[10px] text-muted-foreground mt-0.5">not collected yet</div>
          )}
        </div>
        <div className="border-l-2 border-status-violet pl-3.5">
          <div className="text-muted-foreground font-mono text-[11px] uppercase tracking-wider">
            Standing Privileged Roles
          </div>
          <div className="text-2xl font-semibold font-mono text-foreground mt-0.5">
            {axisLabel(pimStandingRoles)}
          </div>
          {!pimStandingRoles.collected && (
            <div className="text-[10px] text-muted-foreground mt-0.5">
              awaiting Graph permission — collection pending
            </div>
          )}
        </div>
      </div>

      {/* Radar */}
      {anyCollected ? (
        <div className="relative h-60 flex items-center justify-center my-2">
          <svg viewBox="0 0 200 200" className="w-full h-full max-w-[240px] overflow-visible">
            {/* Concentric grid */}
            <polygon points="100,20 180,100 100,180 20,100" fill="none" stroke="hsl(var(--border))" strokeWidth="1" strokeDasharray="2 2" className="opacity-70" />
            <polygon points="100,45 155,100 100,155 45,100" fill="none" stroke="hsl(var(--border))" strokeWidth="1" strokeDasharray="2 2" className="opacity-50" />
            <polygon points="100,70 130,100 100,130 70,100" fill="none" stroke="hsl(var(--border))" strokeWidth="1" strokeDasharray="2 2" className="opacity-40" />

            {/* Axes */}
            <line x1="100" y1="20" x2="100" y2="180" stroke="hsl(var(--border))" strokeWidth="1" className="opacity-50" />
            <line x1="20" y1="100" x2="180" y2="100" stroke="hsl(var(--border))" strokeWidth="1" className="opacity-50" />

            {/* Data area */}
            <polygon
              points={polygonPath}
              fill="hsl(var(--status-blue) / 0.2)"
              stroke="hsl(var(--status-blue))"
              strokeWidth="2"
              className="transition-all duration-500"
            />

            {/* Point markers */}
            {[pTop, pRight, pBottom, pLeft].map((pt) => (
              <g key={pt.label} onMouseEnter={() => setHoveredAxis(pt.label)} onMouseLeave={() => setHoveredAxis(null)}>
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={hoveredAxis === pt.label ? '5' : '3.5'}
                  fill="hsl(var(--status-blue))"
                  stroke="hsl(var(--card))"
                  strokeWidth="1.5"
                  className="cursor-pointer transition-all duration-200"
                />
              </g>
            ))}
          </svg>

          {/* Axis labels with real counts */}
          <div className="absolute top-0 font-mono text-[9px] text-muted-foreground uppercase tracking-wider bg-secondary/80 px-1.5 py-0.5 rounded border border-border">
            Global Admins ({axisLabel(globalAdmins)})
          </div>
          <div className="absolute right-0 font-mono text-[9px] text-muted-foreground uppercase tracking-wider bg-secondary/80 px-1.5 py-0.5 rounded border border-border text-right">
            Risky Users ({axisLabel(riskyUsers)})
          </div>
          <div className="absolute bottom-0 font-mono text-[9px] text-muted-foreground uppercase tracking-wider bg-secondary/80 px-1.5 py-0.5 rounded border border-border">
            Standing Roles ({axisLabel(pimStandingRoles)})
          </div>
          <div className="absolute left-0 font-mono text-[9px] text-muted-foreground uppercase tracking-wider bg-secondary/80 px-1.5 py-0.5 rounded border border-border">
            Risky Sign-ins ({axisLabel(highRiskSignins)})
          </div>
        </div>
      ) : (
        <div className="h-60 flex items-center justify-center my-2">
          <div className="flex items-start gap-2 text-xs text-muted-foreground max-w-[260px]">
            <CircleDashed className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>
              No privileged-exposure signals collected yet — this chart fills in after your first
              tenant scan.
            </span>
          </div>
        </div>
      )}

      <p className="text-[10px] font-mono text-muted-foreground mt-2 text-center">
        axes scale to full at {RADAR_FULL_SCALE}+ (registry critical threshold)
      </p>
    </div>
  );
};
