import { Shield, Key, Fingerprint, LockOpen } from "lucide-react";
import { MetricCard } from "../MetricCard";
import { TrendChart } from "../charts/TrendChart";
import { DistributionChart } from "../charts/DistributionChart";
import { HeatmapChart } from "../charts/HeatmapChart";
import { TimelineList } from "../charts/TimelineList";
import { BarComparisonChart } from "../charts/BarComparisonChart";
import type { IdentityTelemetry } from "../command-center-types";

export interface IdentityAccessTabProps {
  data: IdentityTelemetry | null;
}

export function IdentityAccessTab({ data }: IdentityAccessTabProps) {
  if (!data) return <div className="p-8 text-center text-slate-500">Waiting for telemetry data...</div>;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <DistributionChart
          title="MFA Coverage"
          description="Percentage of users registered and active with MFA"
          data={data.mfaCoverage}
        />
        <TrendChart
          title="Legacy Authentication Attempts"
          description="Basic authentication requests over time"
          data={data.legacyAuthTrend}
          xAxisKey="date"
          series={[{ key: "value", name: "Attempts", color: "hsl(var(--destructive))" }]}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <HeatmapChart
            title="Sign-In Activity Heatmap"
            description="Failed vs Successful sign-ins by hour"
            data={data.signInHeatmap}
            xLabels={["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]}
            yLabels={["00:00", "04:00", "08:00", "12:00", "16:00", "20:00"]}
          />
        </div>
        <div>
          <BarComparisonChart
            title="High-Risk Sign-ins"
            description="Sign-ins flagged by Identity Protection"
            data={data.highRiskSignIns}
            xAxisKey="name"
            series={[{ key: "value", name: "Events", color: "hsl(var(--warning))" }]}
            layout="vertical"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TimelineList
          title="Privileged Identity Management (PIM)"
          description="Recent role activations and escalations"
          events={data.pimActivations}
        />
        <div className="space-y-6">
          <TrendChart
            title="Risky Users Trend"
            data={data.riskyUsersTrend}
            xAxisKey="date"
            series={[{ key: "value", name: "Risky Users", color: "hsl(var(--destructive))" }]}
            height={200}
          />
          <DistributionChart
            title="Risk Detections by Category"
            data={data.riskDetectionsByCategory}
            height={200}
          />
        </div>
      </div>
    </div>
  );
}
