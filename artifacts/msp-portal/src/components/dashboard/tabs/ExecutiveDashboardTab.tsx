import { ShieldAlert, TrendingUp, AlertTriangle, FileWarning, Zap, DollarSign, Laptop, Users } from "lucide-react";
import { MetricCard } from "../MetricCard";
import { BarComparisonChart } from "../charts/BarComparisonChart";
import { TrendChart } from "../charts/TrendChart";

// Mock Data
const postureTrend = [
  { date: "2026-06-16", score: 62 },
  { date: "2026-06-23", score: 65 },
  { date: "2026-06-30", score: 64 },
  { date: "2026-07-07", score: 68 },
  { date: "2026-07-14", score: 72 },
  { date: "2026-07-16", score: 74 },
];

const topRisks = [
  { name: "Legacy Auth Enabled", riskScore: 85 },
  { name: "MFA Disabled for Admin", riskScore: 92 },
  { name: "Public SharePoint Sites", riskScore: 78 },
  { name: "Unpatched Devices", riskScore: 65 },
  { name: "High-Risk Sign-ins", riskScore: 55 },
];

export function ExecutiveDashboardTab() {
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Overall Secure Score"
          value="74%"
          icon={ShieldAlert}
          trend={{ value: 12, label: "vs last month", direction: "up", goodDirection: "up" }}
        />
        <MetricCard
          title="Compliance Score"
          value="68%"
          icon={FileWarning}
          trend={{ value: 5, label: "vs last month", direction: "up", goodDirection: "up" }}
        />
        <MetricCard
          title="License Waste (Monthly)"
          value="$1,240"
          icon={DollarSign}
          trend={{ value: 15, label: "vs last month", direction: "down", goodDirection: "down" }}
        />
        <MetricCard
          title="Device Compliance"
          value="89%"
          icon={Laptop}
          trend={{ value: 2, label: "vs last month", direction: "up", goodDirection: "up" }}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TrendChart
          title="Security Posture Trend"
          description="30-day historical view of Microsoft Secure Score"
          data={postureTrend}
          xAxisKey="date"
          series={[{ key: "score", name: "Secure Score (%)", color: "hsl(var(--primary))" }]}
          valueFormatter={(v) => `${v}%`}
        />
        <BarComparisonChart
          title="Top 5 Critical Risks"
          description="Highest priority issues requiring immediate attention"
          data={topRisks}
          xAxisKey="name"
          series={[{ key: "riskScore", name: "Risk Score", color: "hsl(var(--destructive))" }]}
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
            3 critical drift events detected in the last 7 days. Conditional Access baseline has diverged.
          </p>
          <div className="text-2xl font-bold text-slate-100">3 Events</div>
        </div>
        <div className="bg-slate-900/50 rounded-xl p-5 border border-slate-800">
          <div className="flex items-center gap-3 text-emerald-500 mb-3">
            <TrendingUp className="size-5" />
            <h3 className="font-semibold text-slate-200">Adoption Insights</h3>
          </div>
          <p className="text-sm text-slate-400 mb-4">
            Teams meeting usage is up 14%. Copilot prompt frequency has doubled across sales dept.
          </p>
          <div className="text-2xl font-bold text-slate-100">84/100 Score</div>
        </div>
        <div className="bg-slate-900/50 rounded-xl p-5 border border-slate-800">
          <div className="flex items-center gap-3 text-blue-500 mb-3">
            <Users className="size-5" />
            <h3 className="font-semibold text-slate-200">External Sharing Risk</h3>
          </div>
          <p className="text-sm text-slate-400 mb-4">
            14% of SharePoint sites contain active anonymous links. 23 external guests inactive for 90+ days.
          </p>
          <div className="text-2xl font-bold text-slate-100">Moderate</div>
        </div>
      </div>
    </div>
  );
}
