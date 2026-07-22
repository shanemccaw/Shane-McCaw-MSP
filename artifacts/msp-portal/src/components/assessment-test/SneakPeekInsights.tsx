import React from 'react';
import {
  RadarPillarEntry,
  LicenseWasteSummary,
  CopilotReadinessLive,
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
  /** All 7 pillars in canonical order for the radar (score:null = not covered). */
  radarPillars: RadarPillarEntry[];
  /** Real Cost Engine waste breakdown (status.stats.licenseWaste), or null. */
  licenseWaste: LicenseWasteSummary | null;
  /** Real Copilot-readiness sub-indicators (status.copilotReadiness), or null. */
  copilotReadiness: CopilotReadinessLive | null;
  onOpenCardDetail: (cardName: string) => void;
}

/** Small circular sub-indicator for the Copilot Readiness card. Renders the
 * honest em-dash ring when its backing check has no collected data. */
const ReadinessRing: React.FC<{
  label: string;
  score: number | null;
  detail: string;
  color: string;
}> = ({ label, score, detail, color }) => {
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex flex-col items-center gap-1 flex-1 min-w-0">
      <div className="relative flex items-center justify-center w-14 h-14">
        <svg className="w-full h-full" viewBox="0 0 56 56">
          <g className="-rotate-90 origin-center">
            <circle cx="28" cy="28" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="5" />
            {score != null && (
              <circle
                className="transition-all duration-700"
                cx="28"
                cy="28"
                r={r}
                fill="none"
                stroke={color}
                strokeWidth="5"
                strokeDasharray={c}
                strokeDashoffset={c * (1 - score / 100)}
                strokeLinecap="round"
              />
            )}
          </g>
        </svg>
        <span
          className="absolute text-[11px] font-bold font-mono"
          style={{ color: score != null ? color : '#8a919d' }}
        >
          {score != null ? score : '—'}
        </span>
      </div>
      <span className="text-[10px] font-semibold text-[#e0e2ea] text-center leading-tight">
        {label}
      </span>
      <span className="text-[9px] text-[#8a919d] text-center leading-tight">{detail}</span>
    </div>
  );
};

export const SneakPeekInsights: React.FC<SneakPeekInsightsProps> = ({
  overallScore,
  pillarCount,
  radarPillars,
  licenseWaste,
  copilotReadiness,
  onOpenCardDetail,
}) => {
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const dashOffset =
    overallScore != null ? circumference * (1 - overallScore / 100) : circumference;

  const cr = copilotReadiness;
  const crOverall = cr?.overall.score ?? null;
  const crCoveredCount = cr?.overall.coveredIndicators.length ?? 0;
  // Weights as whole percentages for the caption (real values from the backend,
  // not re-hardcoded here).
  const weightPct = (w: number | undefined) => Math.round((w ?? 0) * 100);

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

        {/* 2. Tenant Health Spider Chart Card — REAL, full 7-pillar universe */}
        <TenantHealthCard
          pillars={radarPillars}
          unifiedScore={overallScore}
          onClick={() => onOpenCardDetail('health')}
        />

        {/* 3. License Optimization Card — REAL Cost Engine dollars
            (status.stats.licenseWaste: reported license counts × real
            sku_price_reference prices). Honest empty state until real data. */}
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

          {licenseWaste ? (
            <div className="flex flex-col justify-center my-1.5">
              <div className="text-[11px] text-[#8a919d] mb-0.5">Potential Monthly Savings</div>
              <div className="text-2xl font-bold text-[#34d399] tracking-tight group-hover:scale-105 transition-transform origin-left">
                ${Math.round(licenseWaste.monthlyCents / 100).toLocaleString()}
              </div>
              <div className="text-xs text-[#c0c7d3] mt-2 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-[#f59e0b] flex-shrink-0" />
                <span>
                  {licenseWaste.seatCount} wasted seat{licenseWaste.seatCount === 1 ? '' : 's'} across{' '}
                  {licenseWaste.skuCount} SKU{licenseWaste.skuCount === 1 ? '' : 's'}
                </span>
              </div>
              {licenseWaste.topSku && (
                <div className="text-[11px] text-[#8a919d] mt-1 truncate">
                  Top: {licenseWaste.topSku.displayName} × {licenseWaste.topSku.count} ($
                  {Math.round(licenseWaste.topSku.monthlyCents / 100).toLocaleString()}/mo)
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col justify-center my-1.5">
              <div className="text-[11px] text-[#8a919d] mb-0.5">Potential Monthly Savings</div>
              <div className="text-2xl font-bold text-[#8a919d] tracking-tight">—</div>
              <div className="text-[11px] text-[#8a919d] mt-2">
                No license-waste data from this scan yet
              </div>
            </div>
          )}
        </div>

        {/* 4. Copilot Readiness Card — three REAL sub-indicators (SharePoint/
            Teams oversharing ratio; sensitivity-label + DLP risk-band scores)
            and the weighted overall bar. Each ring is real or an honest
            em-dash; the weights come from the backend response. */}
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

          {cr ? (
            <>
              <div className="flex items-start justify-between gap-1 my-1">
                <ReadinessRing
                  label="SharePoint / Teams"
                  score={cr.sharePointTeams.score}
                  color="#34d399"
                  detail={
                    cr.sharePointTeams.oversharedSites != null && cr.sharePointTeams.totalSites != null
                      ? `${cr.sharePointTeams.oversharedSites} of ${cr.sharePointTeams.totalSites} sites overshared`
                      : 'No site data collected'
                  }
                />
                <ReadinessRing
                  label="Sensitivity Labels"
                  score={cr.sensitivityLabels.score}
                  color="#c084fc"
                  detail={
                    cr.sensitivityLabels.unlabeledItems != null
                      ? `${cr.sensitivityLabels.unlabeledItems} unlabeled item${cr.sensitivityLabels.unlabeledItems === 1 ? '' : 's'}`
                      : 'No label data collected'
                  }
                />
                <ReadinessRing
                  label="DLP"
                  score={cr.dlp.score}
                  color="#60a5fa"
                  detail={
                    cr.dlp.weakPolicies != null
                      ? `${cr.dlp.weakPolicies} weak polic${cr.dlp.weakPolicies === 1 ? 'y' : 'ies'}`
                      : 'No DLP data collected'
                  }
                />
              </div>

              {/* Weighted overall readiness bar */}
              <div className="mt-2 space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#e0e2ea] font-medium">Overall readiness</span>
                  <span className="font-bold text-[#e0e2ea] font-mono">
                    {crOverall != null ? `${crOverall}%` : '—'}
                  </span>
                </div>
                <div className="w-full bg-[#181c21] rounded-full h-1.5">
                  {crOverall != null && (
                    <div
                      className="bg-gradient-to-r from-[#34d399] via-[#c084fc] to-[#60a5fa] h-full rounded-full transition-all duration-700"
                      style={{ width: `${crOverall}%` }}
                    />
                  )}
                </div>
                <div className="text-[10px] text-[#8a919d] leading-snug">
                  {crOverall != null ? (
                    <>
                      Weighted {weightPct(cr.overall.weights.sharePointTeams)}/
                      {weightPct(cr.overall.weights.sensitivityLabels)}/
                      {weightPct(cr.overall.weights.dlp)} — SP/Teams · Labels · DLP
                      {crCoveredCount < 3 &&
                        ` (renormalized over ${crCoveredCount} covered indicator${crCoveredCount === 1 ? '' : 's'})`}
                    </>
                  ) : (
                    'No readiness checks collected for this tenant yet'
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-24 text-[11px] text-[#8a919d]">
              No Copilot-readiness data from this scan yet
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
