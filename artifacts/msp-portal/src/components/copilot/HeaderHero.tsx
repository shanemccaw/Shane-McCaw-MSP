import React from 'react';
import { ShieldCheck, UserCheck, TrendingDown } from 'lucide-react';
import { ExecutiveMetrics } from './types';

interface HeaderHeroProps {
  metrics: ExecutiveMetrics;
  onRefreshMetrics?: () => void;
}

export const HeaderHero: React.FC<HeaderHeroProps> = ({ metrics }) => {
  // SVG Gauge calculations
  // circumference = 2 * PI * 58 ≈ 364.42
  const circumference = 364.4;
  const strokeDashoffset = circumference - (circumference * metrics.aggregateReadiness) / 100;

  return (
    <div className="space-y-6">
      {/* SECTION 1: HERO BAND */}
      <header className="flex flex-col md:flex-row items-start md:items-end justify-between gap-6 mb-8">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <p className="font-mono text-xs text-[#479ef5] tracking-[0.2em] uppercase font-medium">
              EXECUTIVE INTELLIGENCE
            </p>
            {metrics.liveDataFeedActive && (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono bg-sky-500/10 text-sky-400 border border-sky-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-ping"></span>
                LIVE SYNC
              </span>
            )}
          </div>
          <h1 className="font-display text-4xl sm:text-5xl text-[#f0f0f0] tracking-tighter font-bold">
            Copilot Readiness Overview
          </h1>
          <p className="font-body text-base text-[#c0c7d3] max-w-2xl mt-3 leading-relaxed">
            Comprehensive environmental analysis for Microsoft 365 Copilot deployment. Scoring based on current security posture and data governance alignment.
          </p>
        </div>

        {/* Aggregate Readiness Gauge Card */}
        <div className="bg-card border border-border p-6 rounded-xl flex flex-col items-center justify-center min-w-[280px] self-stretch md:self-auto transition-all duration-300 hover:border-sky-500/30">
          <span className="font-mono text-xs text-[#c0c7d3] uppercase mb-3 tracking-wider">
            Aggregate Readiness
          </span>
          <div className="relative">
            <svg className="w-32 h-32 transform -rotate-90">
              <circle
                className="text-[#333535]"
                cx="64"
                cy="64"
                fill="transparent"
                r="58"
                stroke="currentColor"
                strokeWidth="8"
              />
              <circle
                className="text-[#479ef5] transition-all duration-1000 ease-out"
                cx="64"
                cy="64"
                fill="transparent"
                r="58"
                stroke="currentColor"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeWidth="8"
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="font-display text-4xl text-[#479ef5] font-bold score-glow">
                {metrics.aggregateReadiness}
              </span>
            </div>
          </div>
          <span className="font-display text-lg font-semibold text-[#f0f0f0] mt-3">
            {metrics.readinessStatus}
          </span>
        </div>
      </header>

      {/* Top 3 KPI Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Card 1: PERMISSIONS HYGIENE */}
        <div className="bg-card border border-border p-5 rounded-xl border-t-2 border-t-[#479ef5] transition-all hover:bg-white/5">
          <div className="flex justify-between items-start mb-4">
            <span className="font-mono text-xs font-medium text-[#c0c7d3] tracking-wider uppercase">
              PERMISSIONS HYGIENE
            </span>
            <ShieldCheck className="text-[#479ef5] w-5 h-5" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-display text-3xl font-bold text-[#f0f0f0]">
              {metrics.permissionsHygiene}
            </span>
            <span className="font-mono text-xs text-[#c0c7d3]">/ 100</span>
          </div>
          <div className="w-full h-1.5 bg-[#333535] rounded-full mt-4 overflow-hidden">
            <div
              className="h-full bg-[#479ef5] transition-all duration-700 rounded-full"
              style={{ width: `${metrics.permissionsHygiene}%` }}
            />
          </div>
        </div>

        {/* Card 2: SENSITIVE DATA PROTECTION */}
        <div className="bg-card border border-border p-5 rounded-xl border-t-2 border-t-[#b388ff] transition-all hover:bg-white/5">
          <div className="flex justify-between items-start mb-4">
            <span className="font-mono text-xs font-medium text-[#c0c7d3] tracking-wider uppercase">
              SENSITIVE DATA PROTECTION
            </span>
            <UserCheck className="text-[#b388ff] w-5 h-5" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-display text-3xl font-bold text-[#f0f0f0]">
              {metrics.sensitiveDataProtection}
            </span>
            <span className="font-mono text-xs text-[#c0c7d3]">/ 100</span>
          </div>
          <div className="w-full h-1.5 bg-[#333535] rounded-full mt-4 overflow-hidden">
            <div
              className="h-full bg-[#b388ff] transition-all duration-700 rounded-full"
              style={{ width: `${metrics.sensitiveDataProtection}%` }}
            />
          </div>
        </div>

        {/* Card 3: COPILOT RISK SCORE */}
        <div className="bg-card border border-border p-5 rounded-xl border-t-2 border-t-[#4caf50] transition-all hover:bg-white/5">
          <div className="flex justify-between items-start mb-4">
            <span className="font-mono text-xs font-medium text-[#c0c7d3] tracking-wider uppercase">
              COPILOT RISK SCORE
            </span>
            <TrendingDown className="text-[#4caf50] w-5 h-5" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-display text-3xl font-bold text-[#4caf50] green-glow">
              {metrics.copilotRiskScore}
            </span>
            <span className="font-mono text-xs text-[#c0c7d3]">
              (Lower is Better)
            </span>
          </div>
          <div className="flex gap-1 mt-4">
            <div className="h-1.5 flex-1 bg-[#4caf50] rounded-sm"></div>
            <div className="h-1.5 flex-1 bg-[#333535] rounded-sm"></div>
            <div className="h-1.5 flex-1 bg-[#333535] rounded-sm"></div>
            <div className="h-1.5 flex-1 bg-[#333535] rounded-sm"></div>
            <div className="h-1.5 flex-1 bg-[#333535] rounded-sm"></div>
          </div>
        </div>
      </div>
    </div>
  );
};
