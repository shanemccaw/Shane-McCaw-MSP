import React, { useState } from 'react';
import { Info, Shield, ShieldCheck, AlertTriangle, AlertOctagon, CircleDashed } from 'lucide-react';
import { HeartbeatTrace } from '@/components/security-overview/HeartbeatTrace';
import {
  HealthRadarPillar,
  scoreBand,
  BAND_COLOR_VAR,
  BAND_TEXT_CLASS,
} from './useM365HealthLive';
import { PILLAR_UNIVERSE } from './PillarGrid';

/**
 * Primary hero — the real M365 Health score: average of the pillars the
 * customer's scanned package genuinely covers (status.radar.pillars — the same
 * derivation already proven on /assessment). A null score renders the honest
 * "no scan data yet" state, never a fabricated number.
 *
 * Stat columns are real too: Annual Cost Savings = the Cost Engine's real
 * license-waste annualCents (monthly seat-count × sku_price_reference list
 * price × 12); Genuine Findings = the last completed run's real
 * critical+warning count. The mock "Risk Reduction %" stat was removed with
 * the rest of the fabricated hero copy ("+4%", "Top 8% of sector") — no real
 * historical/sector data source exists yet (backlogged for v2). The
 * "Copilot Readiness" callout (and Copilot's entry in the pillar distribution
 * below) was removed entirely (#1137) — Copilot isn't a health pillar on
 * this report (#1098) and already has a real, gated home in TrendsRow's
 * Copilot Readiness Breakdown (#1099).
 */
interface HeroHealthScoreProps {
  pillars: HealthRadarPillar[];
  healthScore: number | null;
  annualSavingsCents: number | null;
  genuineFindings: number | null;
  everScanned: boolean;
  /** #1107: true while a scan is genuinely running right now — swaps the
   * pre-scan "runs after your first scan" copy for a "building live" one. */
  scanRunning?: boolean;
  onSelectPillar: (pillarKey: string) => void;
}

const BAND_LABEL: Record<'green' | 'amber' | 'red', string> = {
  green: 'HEALTHY',
  amber: 'NEEDS ATTENTION',
  red: 'AT RISK',
};

const BAND_ICON = {
  green: ShieldCheck,
  amber: AlertTriangle,
  red: AlertOctagon,
};

export const HeroHealthScore: React.FC<HeroHealthScoreProps> = ({
  pillars,
  healthScore,
  annualSavingsCents,
  genuineFindings,
  everScanned,
  scanRunning = false,
  onSelectPillar,
}) => {
  const [hoveredPillar, setHoveredPillar] = useState<HealthRadarPillar | null>(null);

  // #1137: `pillars` is the raw backend radar.pillars, which still carries a
  // "copilot" entry (HEALTH_PILLARS in health-engine.ts) — Copilot isn't a
  // health pillar on this report (Git #1098), so filter to the same canonical
  // 6-pillar universe PillarGrid.tsx already established before rendering.
  const displayPillars = pillars.filter((p) =>
    PILLAR_UNIVERSE.some((u) => u.key === p.pillar)
  );

  // Gauge calculations
  const circumference = 2 * Math.PI * 58;
  const strokeDashoffset =
    healthScore != null ? circumference - (circumference * healthScore) / 100 : circumference;

  const band = healthScore != null ? scoreBand(healthScore) : null;
  const BandIcon = band ? BAND_ICON[band] : CircleDashed;

  return (
    <section className="grid grid-cols-1 md:grid-cols-12 gap-6 bg-card border border-border p-6 md:p-8 rounded-xl relative overflow-hidden mb-6">
      {/* Decorative background — the shared shield + live heartbeat treatment
          (same real elements as the Security Intelligence hero band). Rendered
          before the content so it paints underneath; pointer-events-none. */}
      <div aria-hidden className="absolute -right-12 -top-12 opacity-[0.05] pointer-events-none text-foreground">
        <Shield className="w-[320px] h-[320px]" />
      </div>
      <HeartbeatTrace />

      {/* Main Gauge + Headline — stacks vertically below sm (ring above text)
          so the ring never gets crushed next to the headline on a phone. */}
      <div className="md:col-span-5 lg:col-span-4 flex flex-col sm:flex-row items-center sm:items-center gap-4 sm:gap-6 text-center sm:text-left">
        <div className="relative">
          <svg className="w-28 h-28 md:w-32 md:h-32 transform -rotate-90">
            {/* Track */}
            <circle
              cx="64"
              cy="64"
              r="58"
              fill="transparent"
              stroke="hsl(var(--muted))"
              strokeWidth="8"
            />
            {/* Progress line — colored by real score band */}
            {healthScore != null && (
              <circle
                cx="64"
                cy="64"
                r="58"
                fill="transparent"
                stroke={band ? BAND_COLOR_VAR[band] : 'var(--color-status-blue)'}
                strokeWidth="8"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                className="transition-all duration-1000 ease-out"
              />
            )}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span
              data-testid="m365-health-score-value"
              className={`text-4xl md:text-5xl font-bold tracking-tight font-mono ${
                band ? BAND_TEXT_CLASS[band] : 'text-muted-foreground'
              }`}
            >
              {healthScore ?? '—'}
            </span>
          </div>
        </div>

        <div>
          <h2 className="text-xl md:text-2xl font-bold text-foreground tracking-tight">
            M365 Health Score
          </h2>
          <p className="text-secondary-foreground/90 text-xs md:text-sm mt-1 leading-relaxed">
            {displayPillars.length > 0
              ? `Average across the ${displayPillars.length} pillar${displayPillars.length === 1 ? '' : 's'} your scan covers`
              : scanRunning
                ? 'Scan in progress — pillar scores building live'
                : everScanned
                  ? 'Scan complete — no pillar coverage computed yet'
                  : 'Runs after your first tenant scan'}
          </p>
          <div className="flex items-center space-x-2 mt-2">
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border ${
                band === 'green'
                  ? 'bg-status-green/15 text-status-green border-status-green/30'
                  : band === 'amber'
                    ? 'bg-status-amber/15 text-status-amber border-status-amber/30'
                    : band === 'red'
                      ? 'bg-status-red/15 text-status-red border-status-red/30'
                      : 'bg-muted text-muted-foreground border-border'
              }`}
            >
              <BandIcon className="w-3 h-3" />
              {band ? BAND_LABEL[band] : scanRunning ? 'SCANNING' : 'AWAITING SCAN'}
            </span>
          </div>
        </div>
      </div>

      {/* Key Metrics Columns & Distribution Bar */}
      <div className="md:col-span-7 lg:col-span-8 flex flex-col justify-between space-y-6">
        {/* Top real stats — Copilot Readiness removed from this hero (#1137):
            Copilot isn't a health pillar on this report (#1098) and already
            has its own gated home in TrendsRow's Copilot Readiness Breakdown
            (#1099); this callout was a redundant, ungated duplicate. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="border-l-2 border-status-green pl-4 py-1 bg-secondary/40 rounded-r-lg">
            <p className="text-[11px] font-mono text-muted-foreground tracking-wider uppercase">
              ANNUAL COST SAVINGS
            </p>
            <p className="text-2xl font-bold text-status-green font-mono mt-0.5">
              {annualSavingsCents != null
                ? `$${Math.round(annualSavingsCents / 100).toLocaleString()}`
                : '—'}
            </p>
            <p className="text-[10px] text-secondary-foreground/80 mt-0.5">
              {annualSavingsCents != null
                ? 'Identified license waste × 12 months'
                : 'No license waste data yet'}
            </p>
          </div>

          <div className="border-l-2 border-status-amber pl-4 py-1 bg-secondary/40 rounded-r-lg">
            <p className="text-[11px] font-mono text-muted-foreground tracking-wider uppercase">
              GENUINE FINDINGS
            </p>
            <p className="text-2xl font-bold text-foreground font-mono mt-0.5">
              {genuineFindings ?? '—'}
            </p>
            <p className="text-[10px] text-secondary-foreground/80 mt-0.5">
              {genuineFindings != null
                ? 'Critical + warning from your last scan'
                : 'No completed scan yet'}
            </p>
          </div>
        </div>

        {/* Pillar Score Distribution Bar — real covered pillars only */}
        <div className="space-y-2 bg-secondary/40 p-3 rounded-lg border border-border">
          <div className="flex justify-between items-center text-xs font-mono">
            <span className="text-secondary-foreground/90 flex items-center space-x-1.5">
              <span>Pillar Score Distribution</span>
              {/* #1146: hover-detail text is absolutely-positioned over the Info
                  icon (icon stays in-flow as a fixed-size placeholder) so
                  swapping between them never changes this row's content
                  width — that width change was reflowing the segmented bar
                  below out from under the cursor, causing an onMouseLeave/
                  onMouseEnter jitter loop. */}
              <span className="relative inline-flex items-center w-3 h-3">
                <Info
                  className={`w-3 h-3 text-muted-foreground transition-opacity ${
                    hoveredPillar ? 'opacity-0' : 'opacity-100'
                  }`}
                />
                {hoveredPillar && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 text-primary font-bold whitespace-nowrap">
                    ({hoveredPillar.label}: {hoveredPillar.score}/100)
                  </span>
                )}
              </span>
            </span>
            <span className="text-muted-foreground" data-testid="hero-pillar-distribution-count">
              {displayPillars.length > 0
                ? `${displayPillars.length} of ${PILLAR_UNIVERSE.length} pillars covered by your package`
                : scanRunning
                  ? 'Scan in progress — building pillar coverage now'
                  : 'No pillar coverage yet'}
            </span>
          </div>

          {displayPillars.length > 0 ? (
            <>
              {/* Segmented bar — equal-width segments, band-colored by score */}
              <div className="flex h-3 w-full space-x-1 rounded-full overflow-hidden bg-muted">
                {displayPillars.map((pillar) => (
                  <button
                    key={pillar.pillar}
                    onClick={() => onSelectPillar(pillar.pillar)}
                    onMouseEnter={() => setHoveredPillar(pillar)}
                    onMouseLeave={() => setHoveredPillar(null)}
                    className="h-full flex-1 transition-all duration-200 hover:brightness-125 focus:outline-none"
                    style={{ backgroundColor: BAND_COLOR_VAR[scoreBand(pillar.score)] }}
                    title={`${pillar.label}: ${pillar.score}/100`}
                  />
                ))}
              </div>

              {/* Interactive Legend */}
              <div className="flex flex-wrap items-center gap-1 pt-1 text-[10px] font-mono text-muted-foreground">
                {displayPillars.map((p) => (
                  <button
                    key={p.pillar}
                    onClick={() => onSelectPillar(p.pillar)}
                    onMouseEnter={() => setHoveredPillar(p)}
                    onMouseLeave={() => setHoveredPillar(null)}
                    className={`flex items-center space-x-1 px-1.5 py-0.5 rounded transition-colors ${
                      hoveredPillar?.pillar === p.pillar
                        ? 'bg-muted text-foreground'
                        : 'hover:text-secondary-foreground'
                    }`}
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: BAND_COLOR_VAR[scoreBand(p.score)] }}
                    />
                    <span>{p.label}</span>
                    <span className="font-semibold">{p.score}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="h-8 flex items-center text-[11px] text-muted-foreground">
              {scanRunning
                ? 'Scan in progress — pillar scores appear here as each pillar clears.'
                : 'Pillar scores appear here once your first scan completes.'}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
