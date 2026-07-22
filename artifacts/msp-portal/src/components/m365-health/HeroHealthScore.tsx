import React, { useState } from 'react';
import { TrendingUp, ArrowUpRight, Target, Info } from 'lucide-react';
import { PillarData } from './types';

interface HeroHealthScoreProps {
  pillars: PillarData[];
  healthScore: number;
  scoreDelta: number;
  annualSavings: number;
  riskReduction: number;
  copilotReadiness: number;
  onSelectPillar: (pillarId: string) => void;
}

export const HeroHealthScore: React.FC<HeroHealthScoreProps> = ({
  pillars,
  healthScore,
  scoreDelta,
  annualSavings,
  riskReduction,
  copilotReadiness,
  onSelectPillar,
}) => {
  const [hoveredPillar, setHoveredPillar] = useState<PillarData | null>(null);

  // Gauge calculations
  const circumference = 2 * Math.PI * 58; // 364.4
  const strokeDashoffset = circumference - (circumference * healthScore) / 100;

  return (
    <section className="grid grid-cols-1 md:grid-cols-12 gap-6 bg-card border border-border p-6 md:p-8 rounded-xl relative overflow-hidden mb-6">
      {/* Background ambient lighting */}
      <div className="absolute -top-24 -left-24 w-64 h-64 bg-[#479ef5]/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-24 -right-24 w-64 h-64 bg-[#dab9ff]/10 rounded-full blur-3xl pointer-events-none" />

      {/* Main Gauge + Headline */}
      <div className="md:col-span-5 lg:col-span-4 flex items-center space-x-6 z-10">
        <div className="relative group cursor-pointer">
          <svg className="w-28 h-28 md:w-32 md:h-32 transform -rotate-90 filter drop-shadow-[0_0_12px_rgba(71,158,245,0.3)]">
            {/* Track */}
            <circle
              cx="64"
              cy="64"
              r="58"
              fill="transparent"
              stroke="#333535"
              strokeWidth="8"
            />
            {/* Progress line */}
            <circle
              cx="64"
              cy="64"
              r="58"
              fill="transparent"
              stroke="#479ef5"
              strokeWidth="8"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              className="transition-all duration-1000 ease-out"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-headline text-4xl md:text-5xl font-bold tracking-tight text-[#e2e2e2]">
              {healthScore}
            </span>
            <div className="flex items-center text-[#a0c9ff] text-xs font-mono font-semibold mt-0.5">
              <TrendingUp className="w-3.5 h-3.5 mr-0.5" />
              <span>+{scoreDelta}%</span>
            </div>
          </div>
        </div>

        <div>
          <h2 className="font-headline text-xl md:text-2xl font-bold text-[#e2e2e2] tracking-tight">
            Tenant Health Score
          </h2>
          <p className="text-[#c0c7d3] text-xs md:text-sm mt-1 leading-relaxed">
            Aggregate intelligence across 7 core pillars
          </p>
          <div className="flex items-center space-x-2 mt-2">
            <span className="status-pill bg-[#a0c9ff]/20 text-[#a0c9ff] border border-[#a0c9ff]/30">
              OPTIMAL
            </span>
            <span className="text-[11px] font-mono text-[#8a919d]">Top 8% of sector</span>
          </div>
        </div>
      </div>

      {/* Key Metrics Columns & Distribution Bar */}
      <div className="md:col-span-7 lg:col-span-8 flex flex-col justify-between space-y-6 z-10">
        {/* Top 3 Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="border-l-2 border-[#479ef5] pl-4 py-1 bg-[#1e2020]/40 rounded-r-lg">
            <p className="text-[11px] font-mono text-[#8a919d] tracking-wider uppercase">
              ANNUAL COST SAVINGS
            </p>
            <p className="font-headline text-2xl font-bold text-[#a0c9ff] mt-0.5">
              ${annualSavings.toLocaleString()}
            </p>
            <p className="text-[10px] text-[#c0c7d3] mt-0.5">Forecasted run-rate</p>
          </div>

          <div className="border-l-2 border-[#c8c6c5] pl-4 py-1 bg-[#1e2020]/40 rounded-r-lg">
            <p className="text-[11px] font-mono text-[#8a919d] tracking-wider uppercase">
              RISK REDUCTION
            </p>
            <p className="font-headline text-2xl font-bold text-[#e2e2e2] mt-0.5">
              {riskReduction}%
            </p>
            <p className="text-[10px] text-[#c0c7d3] mt-0.5">Automated mitigation</p>
          </div>

          <div className="border-l-2 border-[#dab9ff] pl-4 py-1 bg-[#1e2020]/40 rounded-r-lg">
            <p className="text-[11px] font-mono text-[#8a919d] tracking-wider uppercase">
              COPILOT READINESS
            </p>
            <p className="font-headline text-2xl font-bold text-[#dab9ff] mt-0.5">
              {copilotReadiness}%
            </p>
            <p className="text-[10px] text-[#c0c7d3] mt-0.5">Data governance ready</p>
          </div>
        </div>

        {/* Pillar Score Distribution Bar */}
        <div className="space-y-2 bg-[#1a1c1c]/70 p-3 rounded-lg border border-[#404752]/40">
          <div className="flex justify-between items-center text-xs font-mono">
            <span className="text-[#c0c7d3] flex items-center space-x-1.5">
              <span>Pillar Score Distribution</span>
              {hoveredPillar ? (
                <span className="text-[#a0c9ff] font-bold">
                  ({hoveredPillar.name}: {hoveredPillar.score}/100)
                </span>
              ) : (
                <Info className="w-3 h-3 text-[#8a919d]" />
              )}
            </span>
            <span className="text-[#a0c9ff] font-semibold flex items-center space-x-1">
              <Target className="w-3.5 h-3.5" />
              <span>Target: 85+</span>
            </span>
          </div>

          {/* Segmented Distribution Bar */}
          <div className="flex h-3 w-full space-x-1 rounded-full overflow-hidden bg-[#333535]">
            {pillars.map((pillar) => (
              <button
                key={pillar.id}
                onClick={() => onSelectPillar(pillar.id)}
                onMouseEnter={() => setHoveredPillar(pillar)}
                onMouseLeave={() => setHoveredPillar(null)}
                className="h-full transition-all duration-200 hover:brightness-125 focus:outline-none relative group"
                style={{
                  width: `${(pillar.score / 7) * 1.1}%`,
                  backgroundColor: pillar.color,
                }}
                title={`${pillar.name}: ${pillar.score}/100`}
              />
            ))}
          </div>

          {/* Interactive Legend */}
          <div className="flex flex-wrap items-center justify-between gap-1 pt-1 text-[10px] font-mono text-[#8a919d]">
            {pillars.map((p) => (
              <button
                key={p.id}
                onClick={() => onSelectPillar(p.id)}
                onMouseEnter={() => setHoveredPillar(p)}
                onMouseLeave={() => setHoveredPillar(null)}
                className={`flex items-center space-x-1 px-1.5 py-0.5 rounded transition-colors ${
                  hoveredPillar?.id === p.id ? 'bg-[#333535] text-[#e2e2e2]' : 'hover:text-[#c0c7d3]'
                }`}
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
                <span>{p.shortCode}</span>
                <span className="font-semibold">{p.score}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
