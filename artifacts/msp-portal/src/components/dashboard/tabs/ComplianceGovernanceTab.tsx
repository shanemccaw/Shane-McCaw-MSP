import { TrendChart } from "../charts/TrendChart";
import { DistributionChart } from "../charts/DistributionChart";
import type { ComplianceTelemetry } from "../command-center-types";

export interface ComplianceGovernanceTabProps {
  data: ComplianceTelemetry | null;
}

export function ComplianceGovernanceTab({ data }: ComplianceGovernanceTabProps) {
  if (!data) return <div className="p-8 text-center text-slate-500">Waiting for telemetry data...</div>;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TrendChart
          title="DLP Policy Matches"
          description="Frequency of data loss prevention rule triggers"
          data={data.dlpMatchFrequency}
          xAxisKey="date"
          series={[{ key: "value", name: "Matches", color: "hsl(var(--warning))" }]}
        />
        <DistributionChart
          title="DLP Incidents by Sensitivity Label"
          data={data.dlpIncidentsBySensitivity}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <DistributionChart
          title="DLP Rule Effectiveness"
          description="Blocked vs Allowed actions"
          data={data.dlpEffectiveness}
        />
        <DistributionChart
          title="Retention Policy Coverage"
          description="Items under retention vs not retained"
          data={data.retentionPolicyCoverage}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TrendChart
          title="Compliance Score Trend"
          data={data.complianceScoreTrend}
          xAxisKey="date"
          series={[{ key: "value", name: "Score", color: "hsl(var(--primary))" }]}
          valueFormatter={(v) => `${v}%`}
        />
        <DistributionChart
          title="Control Pass/Fail Distribution"
          data={data.controlPassFail}
        />
      </div>
    </div>
  );
}
