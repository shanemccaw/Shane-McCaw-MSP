import { TimelineList } from "../charts/TimelineList";
import { MetricCard } from "../MetricCard";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import type { DriftTelemetry } from "../command-center-types";

export interface ConfigurationDriftTabProps {
  data: DriftTelemetry | null;
}

export function ConfigurationDriftTab({ data }: ConfigurationDriftTabProps) {
  if (!data) return <div className="p-8 text-center text-slate-500">Waiting for telemetry data...</div>;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <MetricCard
          title="Total Policy Changes"
          value={data.policyChangesCount}
          description="Modifications to Conditional Access, Intune, etc."
          icon={AlertTriangle}
          trend={{ value: 5, label: "vs last week", direction: "up", goodDirection: "down" }}
        />
        <MetricCard
          title="Admin Role Changes"
          value={data.adminRoleChangesCount}
          description="New assignments to highly privileged roles"
          icon={ShieldAlert}
          trend={{ value: 0, label: "vs last week", direction: "neutral" }}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TimelineList
          title="Critical Drift Alerts"
          description="High-risk configuration changes requiring review"
          events={data.criticalAlerts}
        />
        <TimelineList
          title="Baseline Drift Events"
          description="All deviations from the established tenant baseline"
          events={data.driftEvents}
        />
      </div>
    </div>
  );
}
