import { TrendChart } from "../charts/TrendChart";
import { DistributionChart } from "../charts/DistributionChart";
import { BarComparisonChart } from "../charts/BarComparisonChart";
import { MetricCard } from "../MetricCard";
import { DollarSign } from "lucide-react";
import type { LicensingTelemetry } from "../command-center-types";

export interface LicensingCostTabProps {
  data: LicensingTelemetry | null;
}

export function LicensingCostTab({ data }: LicensingCostTabProps) {
  if (!data) return <div className="p-8 text-center text-slate-500">Waiting for telemetry data...</div>;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard
          title="Recoverable Spend"
          value={`$${data.recoverableSpend.toLocaleString()}`}
          description="Potential savings from unused or duplicate licenses"
          icon={DollarSign}
          trend={{ value: 12, label: "vs last month", direction: "up", goodDirection: "down" }}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <DistributionChart
          title="License Utilization"
          description="Assigned vs Unassigned vs Inactive seats"
          data={data.licenseUtilization}
        />
        <TrendChart
          title="License Cost Trend (MoM)"
          description="Monthly recurring cost variation"
          data={data.costTrend}
          xAxisKey="date"
          series={[{ key: "value", name: "Cost ($)", color: "hsl(var(--primary))" }]}
          valueFormatter={(v) => `$${v}`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <BarComparisonChart
          title="License Cost by SKU"
          description="Total spend per Microsoft product SKU"
          data={data.licenseCostBySku}
          xAxisKey="name"
          series={[{ key: "value", name: "Cost ($)", color: "hsl(var(--primary))" }]}
          layout="horizontal"
          valueFormatter={(v) => `$${v}`}
        />
        <BarComparisonChart
          title="SKU Waste by Department"
          description="Unused licenses grouped by AD Department"
          data={data.skuWasteByDept}
          xAxisKey="name"
          series={[{ key: "value", name: "Waste ($)", color: "hsl(var(--destructive))" }]}
          layout="vertical"
          valueFormatter={(v) => `$${v}`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TrendChart
          title="Copilot Adoption Trend"
          description="Active Copilot users vs Total assigned licenses"
          data={data.copilotUsageTrend}
          xAxisKey="date"
          series={[{ key: "value", name: "Active Users", color: "#4f46e5" }]}
        />
      </div>
    </div>
  );
}
