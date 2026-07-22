import React from 'react';
import { Activity } from 'lucide-react';

/**
 * Overall M365 Health — a distinct scalar card rendered to the right of the
 * four pillar gauges. The score is the REAL derivation already proven in
 * AssessmentGeneratingScreen.tsx: the average of status.radar.pillars' real
 * scores (ALL covered pillars, not just the four shown as gauges — same as
 * the wizard's "Current Score: N/100"). Never fabricated: the caller passes
 * null when no pillars are covered yet, and this card says so honestly.
 */
interface OverallHealthCardProps {
  /** Average of all real covered-pillar scores, or null when none exist yet. */
  score: number | null;
  /** How many real pillars the score averages over (honest provenance line). */
  pillarCount: number;
}

export const OverallHealthCard: React.FC<OverallHealthCardProps> = ({ score, pillarCount }) => {
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = score != null ? circumference * (1 - score / 100) : circumference;

  return (
    <div className="bg-[#242424] rounded-xl card-border p-4 h-full flex flex-col items-center justify-center relative overflow-hidden shadow-md border border-[#479ef5]/25">
      {/* Distinct ambient glow — sets this card apart from the pillar gauges */}
      <div className="absolute inset-0 opacity-15 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-40 h-40 bg-[#479ef5] blur-[60px] rounded-full" />
      </div>

      <div className="z-10 flex items-center gap-1.5 mb-2">
        <Activity className="w-3.5 h-3.5 text-[#479ef5]" />
        <span className="text-[11px] font-bold uppercase tracking-wider text-center text-[#479ef5]">
          Overall M365 Health
        </span>
      </div>

      <div className="z-10 relative flex items-center justify-center w-24 h-24 my-1">
        <svg className="w-full h-full" viewBox="0 0 100 100">
          <defs>
            <linearGradient id="overallHealthGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#2b82dc" />
              <stop offset="100%" stopColor="#479ef5" />
            </linearGradient>
          </defs>
          <g className="-rotate-90 origin-center">
            <circle
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="8"
            />
            {score != null && (
              <circle
                className="transition-all duration-1000 ease-out"
                cx="50"
                cy="50"
                r={radius}
                fill="none"
                stroke="url(#overallHealthGrad)"
                strokeWidth="8"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                strokeLinecap="round"
              />
            )}
          </g>
        </svg>
        <span className="absolute text-xl font-extrabold tracking-tight text-[#479ef5] font-mono">
          {score != null ? `${score}` : '—'}
        </span>
      </div>

      <div className="z-10 mt-1 text-[11px] font-medium text-[#8a919d] text-center">
        {score != null
          ? `Average of ${pillarCount} scanned pillar${pillarCount === 1 ? '' : 's'}`
          : 'No pillar data from this scan yet'}
      </div>
    </div>
  );
};
