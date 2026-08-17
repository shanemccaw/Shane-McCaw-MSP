import React from 'react';
import {
  Shield,
  Scale,
  FileCheck,
  Users,
  Network,
  Receipt,
  ChevronRight,
} from 'lucide-react';
import {
  HealthRadarPillar,
  scoreBand,
  BAND_COLOR_VAR,
  BAND_TEXT_CLASS,
} from './useM365HealthLive';
// #1107: the Reveal journey's own wording for "a scan is live and hasn't
// reached this pillar's signals yet" — reused verbatim (not re-typed) so the
// two surfaces read identically, per journeyModel.ts's own `stillScanning`
// distinction.
import { SCANNING_PILLAR_CHIP } from '@/components/copilot-journey/journeyModel.ts';

/**
 * 6-pillar score cards — circular red→amber→green rings driven by the real
 * package-aware pillar scores (status.radar.pillars). The full 6-pillar
 * universe always renders in canonical order; a pillar the customer's scanned
 * package doesn't genuinely cover renders the honest "Not covered by this
 * scan" state — never a fabricated score. Ring color = the platform's shared
 * score banding (≥70 green, ≥40 amber, else red) in the app's real status
 * tokens; the numeric score + band label always accompany the color so state
 * is never encoded by color alone.
 */

export interface PillarCardEntry {
  /** Canonical pillar key — matches the backend HealthPillar keys + "security". */
  key: string;
  label: string;
  /** null = honest not-covered state. */
  score: number | null;
  icon: React.ComponentType<{ className?: string }>;
}

/** The full, confirmed 6-pillar universe in canonical display order (Copilot
 * is tracked separately, not a health pillar — Git #1098). Keys match the
 * backend's real HealthPillar keys plus "security"; "architecture" displays
 * as "Health" per Shane's sign-off on #1098 (backend key/fields unchanged). */
export const PILLAR_UNIVERSE: { key: string; fallbackLabel: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'governance', fallbackLabel: 'Governance', icon: Scale },
  { key: 'security', fallbackLabel: 'Security', icon: Shield },
  { key: 'compliance', fallbackLabel: 'Compliance', icon: FileCheck },
  { key: 'licensing', fallbackLabel: 'Licensing', icon: Receipt },
  { key: 'adoption', fallbackLabel: 'Adoption', icon: Users },
  { key: 'architecture', fallbackLabel: 'Health', icon: Network },
];

export function buildPillarCards(pillars: HealthRadarPillar[]): PillarCardEntry[] {
  return PILLAR_UNIVERSE.map(({ key, fallbackLabel, icon }) => {
    const real = pillars.find((p) => p.pillar === key);
    return {
      key,
      label: real?.label ?? fallbackLabel,
      score: real ? real.score : null,
      icon,
    };
  });
}

interface PillarGridProps {
  pillars: HealthRadarPillar[];
  onSelectPillar: (pillarKey: string) => void;
  selectedPillarKey?: string;
  /** #1107: true while a scan is genuinely running right now — an uncovered
   * pillar reads as "still scanning" instead of "not covered" while true. */
  scanRunning?: boolean;
}

const RING_RADIUS = 34;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export const PillarGrid: React.FC<PillarGridProps> = ({
  pillars,
  onSelectPillar,
  selectedPillarKey,
  scanRunning = false,
}) => {
  const cards = buildPillarCards(pillars);

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-3 px-1">
        <h3 className="text-xs font-mono font-bold text-secondary-foreground/90 uppercase tracking-wider">
          6-Pillar Health Matrix
        </h3>
        <span className="text-[11px] font-mono text-muted-foreground">
          Scores reflect only what your scan genuinely covers
        </span>
      </div>

      <div
        className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4"
        data-testid="pillar-grid"
      >
        {cards.map((card) => {
          const IconComp = card.icon;
          const isSelected = selectedPillarKey === card.key;
          const covered = card.score != null;
          const band = covered ? scoreBand(card.score as number) : null;
          const ringColor = band ? BAND_COLOR_VAR[band] : undefined;
          const dashOffset = covered
            ? RING_CIRCUMFERENCE * (1 - (card.score as number) / 100)
            : RING_CIRCUMFERENCE;

          return (
            <button
              key={card.key}
              onClick={() => onSelectPillar(card.key)}
              data-testid={`pillar-card-${card.key}`}
              className={`bg-card border border-border p-4 rounded-xl cursor-pointer transition-all duration-300 group flex flex-col items-center text-center ${
                isSelected ? 'ring-2 ring-ring' : 'hover:-translate-y-1'
              } ${covered ? '' : 'opacity-70'}`}
            >
              {/* Title row */}
              <div className="flex items-center gap-1.5 mb-2">
                <IconComp
                  className={`w-3.5 h-3.5 ${covered && band ? BAND_TEXT_CLASS[band] : 'text-muted-foreground'}`}
                />
                <span className="text-[11px] font-mono font-semibold text-secondary-foreground/90 uppercase tracking-wide">
                  {card.label}
                </span>
                <ChevronRight className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>

              {/* Circular score ring */}
              <div className="relative w-20 h-20 my-1">
                <svg className="w-full h-full" viewBox="0 0 80 80">
                  <circle
                    cx="40"
                    cy="40"
                    r={RING_RADIUS}
                    fill="none"
                    stroke="hsl(var(--muted))"
                    strokeWidth="7"
                  />
                  {covered && (
                    <circle
                      cx="40"
                      cy="40"
                      r={RING_RADIUS}
                      fill="none"
                      stroke={ringColor}
                      strokeWidth="7"
                      strokeDasharray={RING_CIRCUMFERENCE}
                      strokeDashoffset={dashOffset}
                      strokeLinecap="round"
                      transform="rotate(-90 40 40)"
                      className="transition-all duration-700 ease-out"
                    />
                  )}
                </svg>
                <span
                  className={`absolute inset-0 flex items-center justify-center text-lg font-bold font-mono ${
                    covered && band ? BAND_TEXT_CLASS[band] : 'text-muted-foreground'
                  }`}
                >
                  {covered ? card.score : '—'}
                </span>
              </div>

              {/* Band label — state is never color alone */}
              <span className="text-[10px] font-mono text-muted-foreground mt-1">
                {covered
                  ? band === 'green'
                    ? 'Healthy'
                    : band === 'amber'
                      ? 'Needs attention'
                      : 'At risk'
                  : scanRunning
                    ? SCANNING_PILLAR_CHIP
                    : 'Not covered by this scan'}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
};
