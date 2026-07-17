import { TrendChart } from "../charts/TrendChart";
import { DistributionChart } from "../charts/DistributionChart";
import { BarComparisonChart } from "../charts/BarComparisonChart";
import type { SecurityPostureTelemetry } from "../command-center-types";

export interface SecurityPostureTabProps {
  data: SecurityPostureTelemetry | null;
}

export function SecurityPostureTab({ data }: SecurityPostureTabProps) {
  if (!data) return <div className="p-8 text-center text-slate-500">Waiting for telemetry data...</div>;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TrendChart
          title="Secure Score Trend"
          description="30-day historical view of Microsoft Secure Score"
          data={data.secureScoreTrend}
          xAxisKey="date"
          series={[{ key: "value", name: "Score", color: "hsl(var(--primary))" }]}
          valueFormatter={(v) => `${v}%`}
        />
        <DistributionChart
          title="Secure Score Opportunity"
          description="Score breakdown by category (Identity, Data, Devices)"
          data={data.secureScoreByCategory}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="col-span-1 sm:col-span-2">
          <DistributionChart
            title="Alerts by Severity"
            data={data.alertsBySeverity}
            height={220}
          />
        </div>
        <div className="col-span-1 sm:col-span-2">
          <DistributionChart
            title="Alerts by Workload"
            data={data.alertsByWorkload}
            height={220}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <BarComparisonChart
          title="Devices Missing Critical Patches"
          description="Endpoints grouped by missing patch count"
          data={data.missingPatches}
          xAxisKey="name"
          series={[{ key: "value", name: "Devices", color: "hsl(var(--destructive))" }]}
          layout="vertical"
        />
        <BarComparisonChart
          title="Software Vulnerabilities by CVE"
          description="Highest severity CVEs detected in the environment"
          data={data.vulnerabilitiesBySeverity}
          xAxisKey="name"
          series={[{ key: "value", name: "Instances", color: "hsl(var(--warning))" }]}
          layout="vertical"
        />
      </div>
    </div>
  );
}
