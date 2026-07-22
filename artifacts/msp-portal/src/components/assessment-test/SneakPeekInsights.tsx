import React, { useState } from 'react';
import {
  TenantHealthData,
  LicenseOptimizationData,
  CopilotReadinessData,
} from './types';
import { TenantHealthCard } from './TenantHealthCard';
import {
  Activity,
  CreditCard,
  Sparkles,
  AlertTriangle,
} from 'lucide-react';

interface SneakPeekInsightsProps {
  /** Average of all real covered-pillar scores, or null when none exist yet. */
  overallScore: number | null;
  /** How many real pillars the score averages over (honest provenance line). */
  pillarCount: number;
  tenantHealth: TenantHealthData;
  licenseOpt: LicenseOptimizationData;
  copilotReadiness: CopilotReadinessData;
  onOpenCardDetail: (cardName: string) => void;
}

export const SneakPeekInsights: React.FC<SneakPeekInsightsProps> = ({
  overallScore,
  pillarCount,
  tenantHealth,
  licenseOpt,
  copilotReadiness,
  onOpenCardDetail,
}) => {
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const dashOffset =
    overallScore != null ? circumference * (1 - overallScore / 100) : circumference;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold text-[#e0e2ea] tracking-tight">
          Sneak Peek Insights
        </h2>
        <div className="w-2 h-2 rounded-full bg-[#479ef5] animate-ping" />
      </div>

      <div className="flex flex-col gap-4">
        {/* 1. Overall M365 Health Card — REAL average of all covered
            pillars' real scores (same derivation as the pillar-gauge row
            and AssessmentGeneratingScreen.tsx). Honest em-dash when no
            pillar data exists yet. Not clickable — this is a summary
            scalar, not a single pillar's drill-down. */}
        <div className="bg-[#242424] rounded-xl card-border p-4 flex flex-col relative overflow-hidden shadow-md">
          <div className="flex justify-between items-start mb-2">
            <span className="text-[11px] font-semibold text-[#8a919d] uppercase tracking-wider">
              Overall M365 Health
            </span>
            <Activity className="w-4 h-4 text-[#34d399]" />
          </div>

          <div className="flex items-center justify-center relative py-2 h-28">
            <svg className="w-24 h-24" viewBox="0 0 100 100">
              <defs>
                <linearGradient id="overallHealthGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#10b981" />
                  <stop offset="100%" stopColor="#34d399" />
                </linearGradient>
              </defs>
              <g className="-rotate-90 origin-center">
                <circle
                  cx="50"
                  cy="50"
                  r={radius}
                  fill="none"
                  stroke="rgba(255,255,255,0.1)"
                  strokeWidth="10"
                />
                {overallScore != null && (
                  <circle
                    className="transition-all duration-1000"
                    cx="50"
                    cy="50"
                    r={radius}
                    fill="none"
                    stroke="url(#overallHealthGrad)"
                    strokeWidth="10"
                    strokeDasharray={circumference}
                    strokeDashoffset={dashOffset}
                    strokeLinecap="round"
                  />
                )}
              </g>
            </svg>
            <div className="absolute flex flex-col items-center">
              <span className="text-xl font-bold text-[#34d399] font-mono">
                {overallScore != null ? `${overallScore}` : '—'}
              </span>
            </div>
          </div>
          <div className="text-[11px] text-[#c0c7d3] flex items-center justify-center mt-1 pt-2 border-t border-white/5">
            {overallScore != null
              ? `Average of ${pillarCount} scanned pillar${pillarCount === 1 ? '' : 's'}`
              : 'No pillar data from this scan yet'}
          </div>
        </div>

        {/* 2. Tenant Health Spider Chart Card */}
        <TenantHealthCard
          data={tenantHealth}
          onClick={() => onOpenCardDetail('health')}
        />

        {/* 3. License Optimization Card */}
        <div
          onClick={() => onOpenCardDetail('licenses')}
          className="bg-[#242424] rounded-xl card-border p-4 flex flex-col relative overflow-hidden hover:border-[#479ef5]/40 transition-all cursor-pointer shadow-md group"
        >
          <div className="flex justify-between items-start mb-1">
            <span className="text-[11px] font-semibold text-[#8a919d] uppercase tracking-wider">
              License Optimization
            </span>
            <CreditCard className="w-4 h-4 text-[#479ef5]" />
          </div>

          <div className="flex flex-col justify-center my-1.5">
            <div className="text-[11px] text-[#8a919d] mb-0.5">Potential Monthly Savings</div>
            <div className="text-2xl font-bold text-[#34d399] tracking-tight group-hover:scale-105 transition-transform origin-left">
              ${licenseOpt.potentialMonthlySavings.toLocaleString()}
            </div>
            <div className="text-xs text-[#c0c7d3] mt-2 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-[#f59e0b] flex-shrink-0" />
              <span>{licenseOpt.unassignedCount} unassigned licenses</span>
            </div>
          </div>
        </div>

        {/* 4. Copilot Readiness Card */}
        <div
          onClick={() => onOpenCardDetail('copilot')}
          className="bg-[#242424] rounded-xl card-border p-4 flex flex-col relative overflow-hidden hover:border-[#479ef5]/40 transition-all cursor-pointer shadow-md group"
        >
          <div className="flex justify-between items-start mb-2">
            <span className="text-[11px] font-semibold text-[#8a919d] uppercase tracking-wider">
              Copilot Readiness
            </span>
            <Sparkles className="w-4 h-4 text-[#479ef5]" />
          </div>

          <div className="flex flex-col justify-center gap-2.5 my-1">
            {/* Ready Users */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#34d399] pulse-ring-active" />
                  <span className="text-[#e0e2ea] font-medium">Ready Users</span>
                </div>
                <span className="font-bold text-[#e0e2ea] font-mono">
                  {copilotReadiness.readyUsers}
                </span>
              </div>
              <div className="w-full bg-[#181c21] rounded-full h-1.5">
                <div
                  className="bg-[#34d399] h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${Math.round(
                      (copilotReadiness.readyUsers / copilotReadiness.totalEligible) * 100
                    )}%`,
                  }}
                />
              </div>
            </div>

            {/* Needs Action Users */}
            <div className="space-y-1 mt-1">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#f59e0b]" />
                  <span className="text-[#e0e2ea] font-medium">Needs Action</span>
                </div>
                <span className="font-bold text-[#e0e2ea] font-mono">
                  {copilotReadiness.needsActionUsers}
                </span>
              </div>
              <div className="w-full bg-[#181c21] rounded-full h-1.5">
                <div
                  className="bg-[#f59e0b] h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${Math.round(
                      (copilotReadiness.needsActionUsers / copilotReadiness.totalEligible) * 100
                    )}%`,
                  }}
                />
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
