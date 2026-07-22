import React from 'react';
import { TrendingUp, CheckCircle2 } from 'lucide-react';
import { TenantScore } from './types';

interface ScoreOverviewProps {
  score: TenantScore;
  onCardClick?: (metric: string) => void;
}

export const ScoreOverview: React.FC<ScoreOverviewProps> = ({
  score,
  onCardClick,
}) => {
  // Calculate SVG stroke offset for gauge circle (radius 36 => circumference 226.19)
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score.overall / 100) * circumference;

  const subScores = [
    {
      id: 'Directory Hygiene',
      title: 'Directory Hygiene',
      val: score.directoryHygiene,
      color: 'bg-[#479ef5]',
      borderColor: 'border-[#479ef5]/30',
    },
    {
      id: 'CA Architecture',
      title: 'CA Architecture',
      val: score.caArchitecture,
      color: 'bg-[#f59e0b]',
      borderColor: 'border-[#f59e0b]/30',
    },
    {
      id: 'OAuth Governance',
      title: 'OAuth Governance',
      val: score.oauthGovernance,
      color: 'bg-[#cda3ff]',
      borderColor: 'border-[#cda3ff]/30',
    },
    {
      id: 'Collab Structure',
      title: 'Collab Structure',
      val: score.collabStructure,
      color: 'bg-[#38bdf8]',
      borderColor: 'border-[#38bdf8]/30',
    },
  ];

  return (
    <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-12">
      {/* Main Architecture Score Card */}
      <div className="rounded-lg border border-[#333535] bg-[#1e2020] p-5 shadow-lg lg:col-span-5 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-[#e2e2e2]">
              Architecture Score
            </h2>
            {score.overall >= 90 && (
              <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-400 border border-emerald-500/20">
                <CheckCircle2 className="h-3 w-3" /> OPTIMAL
              </span>
            )}
          </div>

          <div className="mt-4 flex items-center gap-6">
            {/* SVG Ring Gauge */}
            <div className="relative flex h-24 w-24 shrink-0 items-center justify-center">
              <svg className="h-full w-full -rotate-90 transform" viewBox="0 0 88 88">
                <circle
                  cx="44"
                  cy="44"
                  r={radius}
                  className="stroke-[#282a2b]"
                  strokeWidth="7"
                  fill="transparent"
                />
                <circle
                  cx="44"
                  cy="44"
                  r={radius}
                  className="stroke-[#479ef5] transition-all duration-1000 ease-out"
                  strokeWidth="7"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="round"
                  fill="transparent"
                />
              </svg>
              <div className="absolute flex flex-col items-center justify-center text-center">
                <span className="font-display text-2xl font-bold text-white leading-none">
                  {score.overall}
                </span>
                <span className="font-mono text-[10px] text-[#8a919d] mt-0.5">/ 100</span>
              </div>
            </div>

            <div className="flex flex-col justify-center">
              <div className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-[#479ef5]">
                <TrendingUp className="h-4 w-4" />
                <span>{score.trend}</span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-[#c0c7d3]">
                {score.summary}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 4 Grid Metric Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:col-span-7">
        {subScores.map((item) => (
          <div
            key={item.id}
            onClick={() => onCardClick?.(item.title)}
            className={`flex flex-col justify-between rounded-lg border border-[#333535] bg-[#1e2020] p-4 transition-all hover:border-[#8a919d]/40 hover:bg-[#282a2b]/50 cursor-pointer group`}
          >
            <div>
              <div className="font-mono text-[11px] font-medium tracking-wide text-[#8a919d] group-hover:text-[#e2e2e2] transition-colors">
                {item.title}
              </div>
              <div className="mt-2 font-display text-3xl font-bold text-[#e2e2e2]">
                {item.val}
              </div>
            </div>

            <div className="mt-4 w-full">
              <div className="h-1.5 w-full rounded-full bg-[#121414]">
                <div
                  className={`h-1.5 rounded-full ${item.color} transition-all duration-700`}
                  style={{ width: `${item.val}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
