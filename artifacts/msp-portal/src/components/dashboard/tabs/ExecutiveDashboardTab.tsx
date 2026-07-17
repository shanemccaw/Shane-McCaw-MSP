import { ShieldAlert, TrendingUp, AlertTriangle, FileWarning, Zap, DollarSign, Laptop, Users, CheckCircle2, Zap as CopilotIcon, Scale as GovIcon, ShieldCheck } from "lucide-react";
import { MetricCard } from "../MetricCard";
import { BarComparisonChart } from "../charts/BarComparisonChart";
import { TrendChart } from "../charts/TrendChart";
import type { ExecutiveTelemetry } from "../command-center-types";

export interface ExecutiveDashboardTabProps {
  data: ExecutiveTelemetry | null;
}

export function ExecutiveDashboardTab({ data }: ExecutiveDashboardTabProps) {
  if (!data) {
    return <div className="p-8 text-center text-slate-500">Waiting for telemetry data...</div>;
  }

  // Helper for circular progress
  const CircularScore = ({ score, size = "md" }: { score: number; size?: "sm" | "md" | "lg" }) => {
    const r = size === "lg" ? 40 : size === "sm" ? 20 : 28;
    const strokeWidth = size === "lg" ? 8 : size === "sm" ? 4 : 6;
    const circumference = 2 * Math.PI * r;
    const dashoffset = circumference * (1 - score / 100);
    const color = score >= 80 ? "text-emerald-500" : score >= 50 ? "text-amber-500" : "text-rose-500";
    const trackColor = score >= 80 ? "stroke-emerald-500" : score >= 50 ? "stroke-amber-500" : "stroke-rose-500";
    const boxSize = r * 2 + strokeWidth * 2;
    
    return (
      <div className="relative inline-flex items-center justify-center">
        <svg width={boxSize} height={boxSize} viewBox={`0 0 ${boxSize} ${boxSize}`} className="-rotate-90">
          <circle cx={boxSize/2} cy={boxSize/2} r={r} fill="none" strokeWidth={strokeWidth} className="stroke-slate-100 dark:stroke-slate-800" />
          <circle
            cx={boxSize/2} cy={boxSize/2} r={r} fill="none" strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={dashoffset}
            strokeLinecap="round"
            className={`${trackColor} transition-all duration-1000`}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`font-bold tabular-nums ${color} ${size === "lg" ? "text-xl" : size === "sm" ? "text-xs" : "text-sm"}`}>{score}%</span>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* OVERALL HEALTH SCORE */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 md:p-8 flex items-center gap-6 md:gap-10 shadow-sm">
        <CircularScore score={data.overallHealthScore} size="lg" />
        <div>
          <h2 className="text-slate-500 dark:text-slate-400 font-medium mb-1">Overall Health Score</h2>
          <div className="text-4xl md:text-5xl font-bold text-rose-500 mb-2">{data.overallHealthScore}%</div>
          <p className="text-sm text-slate-400 dark:text-slate-500">Last updated {data.lastUpdated}</p>
        </div>
      </div>

      {/* CATEGORY BREAKDOWN */}
      <div>
        <h3 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4">Category Breakdown</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col gap-4 shadow-sm">
            <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200 font-semibold">
              <FileWarning className="size-4 text-blue-500" />
              <span>Compliance Coverage</span>
            </div>
            <div className="flex items-center gap-4">
              <CircularScore score={data.pillarScores.compliance} size="md" />
              <div className="flex flex-col">
                <span className="text-xs text-slate-400">Current score</span>
                <span className="text-lg font-bold text-slate-800 dark:text-slate-100">{data.pillarScores.compliance}%</span>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col gap-4 shadow-sm">
            <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200 font-semibold">
              <CopilotIcon className="size-4 text-blue-500" />
              <span>Copilot Readiness</span>
            </div>
            <div className="flex items-center gap-4">
              <CircularScore score={data.pillarScores.copilot} size="md" />
              <div className="flex flex-col">
                <span className="text-xs text-slate-400">Current score</span>
                <span className="text-lg font-bold text-slate-800 dark:text-slate-100">{data.pillarScores.copilot}%</span>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col gap-4 shadow-sm">
            <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200 font-semibold">
              <GovIcon className="size-4 text-blue-500" />
              <span>Governance Maturity</span>
            </div>
            <div className="flex items-center gap-4">
              <CircularScore score={data.pillarScores.governance} size="md" />
              <div className="flex flex-col">
                <span className="text-xs text-slate-400">Current score</span>
                <span className="text-lg font-bold text-slate-800 dark:text-slate-100">{data.pillarScores.governance}%</span>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col gap-4 shadow-sm">
            <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200 font-semibold">
              <Users className="size-4 text-blue-500" />
              <span>Adoption Score</span>
            </div>
            <div className="flex items-center gap-4">
              <CircularScore score={data.pillarScores.adoption} size="md" />
              <div className="flex flex-col">
                <span className="text-xs text-slate-400">Current score</span>
                <span className="text-lg font-bold text-slate-800 dark:text-slate-100">{data.pillarScores.adoption}%</span>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col gap-4 shadow-sm">
            <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200 font-semibold">
              <ShieldCheck className="size-4 text-blue-500" />
              <span>Security Posture</span>
            </div>
            <div className="flex items-center gap-4">
              <CircularScore score={data.pillarScores.security} size="md" />
              <div className="flex flex-col">
                <span className="text-xs text-slate-400">Current score</span>
                <span className="text-lg font-bold text-slate-800 dark:text-slate-100">{data.pillarScores.security}%</span>
              </div>
            </div>
          </div>

        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Overall Secure Score"
          value={`${data.overallSecureScore}%`}
          icon={ShieldAlert}
        />
        <MetricCard
          title="Compliance Score"
          value={`${data.complianceScore}%`}
          icon={FileWarning}
        />
        <MetricCard
          title="License Waste (Monthly)"
          value={`$${data.licenseWasteCost.toLocaleString()}`}
          icon={DollarSign}
        />
        <MetricCard
          title="Device Compliance"
          value={`${data.deviceCompliancePct}%`}
          icon={Laptop}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TrendChart
          title="Security Posture Trend"
          description="Historical view of Microsoft Secure Score"
          data={data.postureTrend}
          xAxisKey="date"
          series={[{ key: "value", name: "Secure Score (%)", color: "hsl(var(--primary))" }]}
          valueFormatter={(v) => `${v}%`}
        />
        <BarComparisonChart
          title="Top Critical Risks"
          description="Highest priority issues requiring immediate attention"
          data={data.topRisks}
          xAxisKey="name"
          series={[{ key: "value", name: "Risk Score", color: "hsl(var(--destructive))" }]}
          layout="vertical"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-slate-900/50 rounded-xl p-5 border border-slate-800">
          <div className="flex items-center gap-3 text-amber-500 mb-3">
            <AlertTriangle className="size-5" />
            <h3 className="font-semibold text-slate-200">Configuration Drift</h3>
          </div>
          <p className="text-sm text-slate-400 mb-4">
            Recent critical drift events detected in tenant baselines.
          </p>
          <div className="text-2xl font-bold text-slate-100">{data.driftEventCount} Events</div>
        </div>
        <div className="bg-slate-900/50 rounded-xl p-5 border border-slate-800">
          <div className="flex items-center gap-3 text-emerald-500 mb-3">
            <TrendingUp className="size-5" />
            <h3 className="font-semibold text-slate-200">Adoption Insights</h3>
          </div>
          <p className="text-sm text-slate-400 mb-4">
            Overall adoption and productivity score across M365 workloads.
          </p>
          <div className="text-2xl font-bold text-slate-100">{data.adoptionScore}/100 Score</div>
        </div>
        <div className="bg-slate-900/50 rounded-xl p-5 border border-slate-800">
          <div className="flex items-center gap-3 text-blue-500 mb-3">
            <Users className="size-5" />
            <h3 className="font-semibold text-slate-200">External Sharing Risk</h3>
          </div>
          <p className="text-sm text-slate-400 mb-4">
            Calculated risk based on anonymous links and stale guest accounts.
          </p>
          <div className="text-2xl font-bold text-slate-100">{data.externalSharingRisk}</div>
        </div>
      </div>
    </div>
  );
}
