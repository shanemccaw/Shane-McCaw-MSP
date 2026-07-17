import { TrendChart } from "../charts/TrendChart";
import { HeatmapChart } from "../charts/HeatmapChart";
import { BarComparisonChart } from "../charts/BarComparisonChart";
import { MetricCard } from "../MetricCard";
import { FolderSync } from "lucide-react";
import type { CollaborationTelemetry } from "../command-center-types";

export interface CollaborationSharingTabProps {
  data: CollaborationTelemetry | null;
}

export function CollaborationSharingTab({ data }: CollaborationSharingTabProps) {
  if (!data) return <div className="p-8 text-center text-slate-500">Waiting for telemetry data...</div>;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard
          title="Overshared SharePoint Sites"
          value={data.oversharedSites}
          description="External/Anonymous access enabled"
          icon={FolderSync}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TrendChart
          title="Storage Growth Trend"
          description="Total tenant storage consumption over time (GB)"
          data={data.storageGrowthTrend}
          xAxisKey="date"
          series={[{ key: "value", name: "Storage (GB)", color: "hsl(var(--primary))" }]}
        />
        <HeatmapChart
          title="File Activity Heatmap"
          description="SharePoint/OneDrive file interactions by time"
          data={data.fileActivityHeatmap}
          xLabels={["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]}
          yLabels={["00:00", "04:00", "08:00", "12:00", "16:00", "20:00"]}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TrendChart
          title="Teams Usage Trend"
          description="Active users and meeting participation"
          data={data.teamsUsageTrend}
          xAxisKey="date"
          series={[{ key: "value", name: "Active Users", color: "#6264A7" }]}
        />
        <BarComparisonChart
          title="Call Quality Metrics"
          description="Poor quality streams by region/device"
          data={data.callQualityMetrics}
          xAxisKey="name"
          series={[{ key: "value", name: "Poor Streams", color: "hsl(var(--destructive))" }]}
          layout="vertical"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TrendChart
          title="Email Activity Trend"
          description="Sent vs Received volumes"
          data={data.emailActivityTrend}
          xAxisKey="date"
          series={[{ key: "value", name: "Volume", color: "#0078D4" }]}
        />
        <TrendChart
          title="Spam/Phishing Detections"
          description="Malicious emails blocked before delivery"
          data={data.spamPhishingDetections}
          xAxisKey="date"
          series={[{ key: "value", name: "Detections", color: "hsl(var(--destructive))" }]}
        />
      </div>
    </div>
  );
}
