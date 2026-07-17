import { ShieldAlert, TrendingUp, AlertTriangle, FileWarning, Zap, DollarSign, Laptop, Users } from "lucide-react";
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

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
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
