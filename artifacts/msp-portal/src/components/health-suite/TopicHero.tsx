import React from 'react';
import { ShieldCheck, AlertTriangle, AlertOctagon, CircleDashed } from 'lucide-react';
import {
  scoreBand,
  BAND_COLOR_VAR,
  BAND_TEXT_CLASS,
  BAND_BADGE_CLASS,
} from './useTopicHealthLive';

/**
 * Shared topic-page hero — the page's own REAL pillar score (from the
 * package-aware radar, pillar-coverage.ts) as a band-colored gauge, plus up to
 * four real stat tiles the page provides. A null score renders the honest
 * "not covered / awaiting scan" state, never a fabricated number. Same visual
 * language as /m365-health's HeroHealthScore (real design tokens, status
 * red/amber/green bands, lucide icons).
 */

export interface HeroStat {
  label: string;
  /** Pre-formatted display value; null renders the honest em-dash. */
  value: string | null;
  /** One-line real-source caption (shown under the value). */
  caption: string;
  /** Fallback caption when value is null. */
  emptyCaption: string;
  /** Status token accent for the tile's left border + value. */
  accent: 'green' | 'amber' | 'red' | 'blue' | 'violet' | 'teal' | 'neutral';
}

const ACCENT_BORDER: Record<HeroStat['accent'], string> = {
  green: 'border-status-green',
  amber: 'border-status-amber',
  red: 'border-status-red',
  blue: 'border-status-blue',
  violet: 'border-status-violet',
  teal: 'border-status-teal',
  neutral: 'border-border',
};

const ACCENT_TEXT: Record<HeroStat['accent'], string> = {
  green: 'text-status-green',
  amber: 'text-status-amber',
  red: 'text-status-red',
  blue: 'text-status-blue',
  violet: 'text-status-violet',
  teal: 'text-status-teal',
  neutral: 'text-foreground',
};

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

interface TopicHeroProps {
  title: string;
  /** Real pillar score (0–100) or null (pillar not covered / no scan). */
  pillarScore: number | null;
  /** Whether the tenant has ever completed a scan (drives the empty copy). */
  everScanned: boolean;
  /** What the score genuinely is, e.g. "Governance pillar score from your latest scan". */
  scoreCaption: string;
  stats: HeroStat[];
}

export const TopicHero: React.FC<TopicHeroProps> = ({
  title,
  pillarScore,
  everScanned,
  scoreCaption,
  stats,
}) => {
  const circumference = 2 * Math.PI * 58;
  const strokeDashoffset =
    pillarScore != null ? circumference - (circumference * pillarScore) / 100 : circumference;
  const band = pillarScore != null ? scoreBand(pillarScore) : null;
  const BandIcon = band ? BAND_ICON[band] : CircleDashed;

  return (
    <section className="grid grid-cols-1 md:grid-cols-12 gap-6 bg-card border border-border p-6 md:p-8 rounded-xl relative overflow-hidden">
      {/* Gauge + headline */}
      <div className="md:col-span-5 lg:col-span-4 flex items-center space-x-6">
        <div className="relative flex-shrink-0">
          <svg className="w-28 h-28 md:w-32 md:h-32 transform -rotate-90">
            <circle cx="64" cy="64" r="58" fill="transparent" stroke="hsl(var(--muted))" strokeWidth="8" />
            {pillarScore != null && (
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
              className={`text-4xl md:text-5xl font-bold tracking-tight font-mono ${
                band ? BAND_TEXT_CLASS[band] : 'text-muted-foreground'
              }`}
            >
              {pillarScore ?? '—'}
            </span>
          </div>
        </div>

        <div>
          <h2 className="text-xl md:text-2xl font-bold text-foreground tracking-tight">{title}</h2>
          <p className="text-secondary-foreground/90 text-xs md:text-sm mt-1 leading-relaxed">
            {pillarScore != null
              ? scoreCaption
              : everScanned
                ? 'Your scanned package doesn’t cover this pillar yet'
                : 'Runs after your first tenant scan'}
          </p>
          <div className="flex items-center space-x-2 mt-2">
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border ${
                band ? BAND_BADGE_CLASS[band] : 'bg-muted text-muted-foreground border-border'
              }`}
            >
              <BandIcon className="w-3 h-3" />
              {band ? BAND_LABEL[band] : 'AWAITING SCAN'}
            </span>
          </div>
        </div>
      </div>

      {/* Real stat tiles */}
      <div className="md:col-span-7 lg:col-span-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 content-center">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className={`border-l-2 ${ACCENT_BORDER[stat.accent]} pl-4 py-1 bg-secondary/40 rounded-r-lg`}
          >
            <p className="text-[11px] font-mono text-muted-foreground tracking-wider uppercase">
              {stat.label}
            </p>
            <p className={`text-2xl font-bold font-mono mt-0.5 ${stat.value != null ? ACCENT_TEXT[stat.accent] : 'text-muted-foreground'}`}>
              {stat.value ?? '—'}
            </p>
            <p className="text-[10px] text-secondary-foreground/80 mt-0.5">
              {stat.value != null ? stat.caption : stat.emptyCaption}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
};
