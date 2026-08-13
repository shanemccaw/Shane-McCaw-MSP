import React from 'react';
import { X, ArrowRight, CircleDashed } from 'lucide-react';
import {
  HealthRadarPillar,
  scoreBand,
  BAND_COLOR_VAR,
  BAND_TEXT_CLASS,
} from './useM365HealthLive';
import { PILLAR_UNIVERSE } from './PillarGrid';

/**
 * Pillar detail — the real data only: the pillar's real score (or the honest
 * not-covered state) plus real navigation to that pillar's dedicated page in
 * the M365 Health suite. The mock sub-metrics / recommendations / "30-day
 * velocity" content had no real backend source and was removed rather than
 * rendered as fiction.
 */

/** Pillar key → its real dedicated suite page route (App.tsx). */
export const PILLAR_ROUTES: Record<string, string> = {
  security: '/security-overview',
  governance: '/governance',
  compliance: '/compliance',
  adoption: '/adoption',
  copilot: '/copilot',
  architecture: '/architecture',
  licensing: '/licensing',
};

interface PillarDetailModalProps {
  /** The selected pillar key from the canonical 7-pillar universe. */
  pillarKey: string | null;
  /** Real covered pillars — the selected key may legitimately be absent. */
  pillars: HealthRadarPillar[];
  onClose: () => void;
  onNavigate: (route: string) => void;
}

const RING_RADIUS = 40;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export const PillarDetailModal: React.FC<PillarDetailModalProps> = ({
  pillarKey,
  pillars,
  onClose,
  onNavigate,
}) => {
  if (!pillarKey) return null;

  const universeEntry = PILLAR_UNIVERSE.find((p) => p.key === pillarKey);
  const real = pillars.find((p) => p.pillar === pillarKey) ?? null;
  const label = real?.label ?? universeEntry?.fallbackLabel ?? pillarKey;
  const IconComp = universeEntry?.icon ?? CircleDashed;
  const band = real ? scoreBand(real.score) : null;
  const route = PILLAR_ROUTES[pillarKey];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-popover border border-border rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-6 py-5 border-b border-border flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center bg-secondary ${
                band ? BAND_TEXT_CLASS[band] : 'text-muted-foreground'
              }`}
            >
              <IconComp className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-foreground">{label}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {real ? 'Covered by your scanned package' : 'Not covered by your current scan'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 flex flex-col items-center space-y-4">
          {/* Real score ring — or the honest not-covered ring */}
          <div className="relative w-28 h-28">
            <svg className="w-full h-full" viewBox="0 0 100 100">
              <circle
                cx="50"
                cy="50"
                r={RING_RADIUS}
                fill="none"
                stroke="hsl(var(--muted))"
                strokeWidth="8"
              />
              {real && band && (
                <circle
                  cx="50"
                  cy="50"
                  r={RING_RADIUS}
                  fill="none"
                  stroke={BAND_COLOR_VAR[band]}
                  strokeWidth="8"
                  strokeDasharray={RING_CIRCUMFERENCE}
                  strokeDashoffset={RING_CIRCUMFERENCE * (1 - real.score / 100)}
                  strokeLinecap="round"
                  transform="rotate(-90 50 50)"
                  className="transition-all duration-700"
                />
              )}
            </svg>
            <span
              className={`absolute inset-0 flex items-center justify-center text-2xl font-bold font-mono ${
                band ? BAND_TEXT_CLASS[band] : 'text-muted-foreground'
              }`}
            >
              {real ? real.score : '—'}
            </span>
          </div>

          <p className="text-xs text-secondary-foreground/90 text-center leading-relaxed">
            {real
              ? band === 'green'
                ? 'This pillar is healthy. Open its dedicated page for the full breakdown.'
                : band === 'amber'
                  ? 'This pillar needs attention. Open its dedicated page for the full breakdown.'
                  : 'This pillar is at risk. Open its dedicated page for the full breakdown.'
              : 'Your current monitoring package doesn’t include the checks behind this pillar, so no score exists — nothing is fabricated to fill the gap.'}
          </p>

          {route && (
            <button
              onClick={() => onNavigate(route)}
              className="w-full px-4 py-2 bg-primary text-primary-foreground font-mono text-xs font-bold rounded-lg hover:brightness-110 transition-all flex items-center justify-center space-x-2"
            >
              <span>Open {label} page</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
