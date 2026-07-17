import { TrendChart } from "../charts/TrendChart";
import { DistributionChart } from "../charts/DistributionChart";
import type { AdoptionTelemetry } from "../command-center-types";

export interface UsageAdoptionTabProps {
  data: AdoptionTelemetry | null;
}

export function UsageAdoptionTab({ data }: UsageAdoptionTabProps) {
  if (!data) return <div className="p-8 text-center text-slate-500">Waiting for telemetry data...</div>;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TrendChart
          title="Active Users Trend"
          description="Daily active users across all M365 workloads"
          data={data.activeUsersTrend}
          xAxisKey="date"
          series={[{ key: "value", name: "Active Users", color: "hsl(var(--primary))" }]}
        />
        <TrendChart
          title="Meetings per User"
          description="Average Teams meetings attended per user"
          data={data.meetingsPerUserTrend}
          xAxisKey="date"
          series={[{ key: "value", name: "Meetings", color: "#6264A7" }]}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TrendChart
          title="SharePoint Site Visits"
          description="Total visits to SharePoint intranet and team sites"
          data={data.siteVisitsTrend}
          xAxisKey="date"
          series={[{ key: "value", name: "Visits", color: "#0078D4" }]}
        />
        <DistributionChart
          title="Mobile vs Desktop Usage"
          description="Platform breakdown for email and Teams"
          data={data.mobileVsDesktop}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TrendChart
          title="Copilot Prompts per User"
          description="Average daily prompts for Copilot-enabled users"
          data={data.copilotPromptsPerUser}
          xAxisKey="date"
          series={[{ key: "value", name: "Prompts", color: "#4f46e5" }]}
        />
      </div>
    </div>
  );
}
