import { DistributionChart } from "../charts/DistributionChart";
import { MetricCard } from "../MetricCard";
import { Activity, Zap, CheckCircle2, ShieldCheck, Laptop, Users } from "lucide-react";
import type { OperationsTelemetry } from "../command-center-types";

export interface OperationalMaturityTabProps {
  data: OperationsTelemetry | null;
}

export function OperationalMaturityTab({ data }: OperationalMaturityTabProps) {
  if (!data) return <div className="p-8 text-center text-slate-500">Waiting for telemetry data...</div>;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard
          title="Ticket Resolution SLA"
          value={`${data.ticketResolutionSlaPct}%`}
          description="Service requests resolved within SLA"
          icon={CheckCircle2}
          trend={{ value: 2, label: "vs last month", direction: "up", goodDirection: "up" }}
        />
        <MetricCard
          title="Workflow Success Rate"
          value={`${data.workflowSuccessRate}%`}
          description="Automated runbook execution success"
          icon={Zap}
        />
        <MetricCard
          title="Overall Operational Health"
          value="Healthy"
          icon={Activity}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <DistributionChart
          title="Remediation Automation"
          description="Automated vs Manual alert remediations"
          data={data.automatedVsManual}
        />
      </div>

      <div>
        <h3 className="text-sm font-semibold text-slate-200 mb-4">Maturity Scores</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <MetricCard
            title="Identity Maturity"
            value={`${data.identityMaturityScore}/100`}
            icon={ShieldCheck}
          />
          <MetricCard
            title="Device Maturity"
            value={`${data.deviceMaturityScore}/100`}
            icon={Laptop}
          />
          <MetricCard
            title="Collaboration Maturity"
            value={`${data.collaborationMaturityScore}/100`}
            icon={Users}
          />
        </div>
      </div>
    </div>
  );
}
