import { TrendChart } from "../charts/TrendChart";
import { DistributionChart } from "../charts/DistributionChart";
import { MetricCard } from "../MetricCard";
import { Smartphone, ShieldCheck } from "lucide-react";
import type { DeviceTelemetry } from "../command-center-types";

export interface IntuneDeviceTabProps {
  data: DeviceTelemetry | null;
}

export function IntuneDeviceTab({ data }: IntuneDeviceTabProps) {
  if (!data) return <div className="p-8 text-center text-slate-500">Waiting for telemetry data...</div>;

  const compliantCount = data.deviceCompliance.find(d => d.name === "Compliant")?.value || 0;
  const totalCount = data.deviceCompliance.reduce((acc, curr) => acc + curr.value, 0);
  const compliancePct = totalCount > 0 ? Math.round((compliantCount / totalCount) * 100) : 0;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MetricCard
          title="Overall Device Compliance"
          value={`${compliancePct}%`}
          description="Enrolled endpoints meeting Intune policies"
          icon={Smartphone}
        />
        <MetricCard
          title="Total Managed Endpoints"
          value={totalCount}
          icon={ShieldCheck}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <DistributionChart
          title="Device Compliance Status"
          description="Compliant vs Non-compliant vs Grace period"
          data={data.deviceCompliance}
        />
        <TrendChart
          title="Compliance Trend"
          description="30-day view of compliant devices"
          data={data.complianceTrend}
          xAxisKey="date"
          series={[{ key: "value", name: "Compliant Devices", color: "hsl(var(--primary))" }]}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <DistributionChart
          title="Profile Assignment Status"
          description="Success vs Error vs Conflict"
          data={data.profileAssignmentStatus}
        />
        <DistributionChart
          title="Antivirus Status"
          description="Defender active and updated"
          data={data.antivirusStatus}
        />
        <DistributionChart
          title="Firewall Status"
          description="Firewall enabled vs disabled"
          data={data.firewallStatus}
        />
      </div>
    </div>
  );
}
