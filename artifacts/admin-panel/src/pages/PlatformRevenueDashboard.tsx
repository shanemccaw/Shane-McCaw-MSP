import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";

interface RevenueData {
  mrrCents: number;
  mrrUsd: string;
  churned30d: number;
  subscriptionsByStatus: Array<{ status: string; count: number; totalCents: number }>;
  mspsByStatus: Record<string, number>;
  perMsp: Array<{ mspName: string; planName: string; status: string; priceCents: number }>;
}

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  trialing: "Trialing",
  past_due: "Past Due",
  canceled: "Canceled",
  unpaid: "Unpaid",
};

const STATUS_COLORS: Record<string, string> = {
  active: "text-emerald-400",
  trialing: "text-blue-400",
  past_due: "text-amber-400",
  canceled: "text-muted-foreground/60",
  unpaid: "text-red-400",
};

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function PlatformRevenueDashboard() {
  const { fetchWithAuth } = useAuth();
  const [data, setData] = useState<RevenueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth("/api/admin/observability/platform-revenue");
      if (!res.ok) throw new Error(await res.text());
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load revenue data");
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Loading revenue data…
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 text-red-400 text-sm">{error}</div>
      </div>
    );
  }

  const d = data!;
  const totalActiveMsps = Object.entries(d.mspsByStatus)
    .filter(([s]) => s !== "suspended")
    .reduce((sum, [, n]) => sum + n, 0);

  return (
    <div className="p-6 space-y-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-foreground text-xl font-semibold">Platform Revenue</h1>
          <p className="text-muted-foreground text-sm mt-1">
            MRR from MSP platform subscriptions, churn, and per-MSP breakdown.
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="text-xs text-primary hover:text-blue-400 transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-muted-foreground text-xs mb-1">Monthly Recurring Revenue</p>
          <p className="text-2xl font-bold text-emerald-400">{formatCents(d.mrrCents)}</p>
          <p className="text-muted-foreground text-xs mt-1">from active subscriptions</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-muted-foreground text-xs mb-1">Total Active MSPs</p>
          <p className="text-2xl font-bold text-foreground">{totalActiveMsps}</p>
          <p className="text-muted-foreground text-xs mt-1">
            {d.mspsByStatus["trial"] ?? d.mspsByStatus["trialing"] ?? 0} on trial
          </p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-muted-foreground text-xs mb-1">Churn (Last 30d)</p>
          <p className={`text-2xl font-bold ${d.churned30d > 0 ? "text-red-400" : "text-emerald-400"}`}>
            {d.churned30d}
          </p>
          <p className="text-muted-foreground text-xs mt-1">cancellations</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-muted-foreground text-xs mb-1">Past Due</p>
          <p className={`text-2xl font-bold ${
            (d.subscriptionsByStatus.find((s) => s.status === "past_due")?.count ?? 0) > 0
              ? "text-amber-400" : "text-emerald-400"
          }`}>
            {d.subscriptionsByStatus.find((s) => s.status === "past_due")?.count ?? 0}
          </p>
          <p className="text-muted-foreground text-xs mt-1">subscriptions</p>
        </div>
      </div>

      {/* Subscriptions by status */}
      {d.subscriptionsByStatus.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-5">
          <h2 className="text-foreground text-sm font-semibold mb-4">Subscriptions by Status</h2>
          <div className="space-y-3">
            {d.subscriptionsByStatus.map((row) => (
              <div key={row.status} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className={`text-sm font-medium ${STATUS_COLORS[row.status] ?? "text-foreground"}`}>
                    {STATUS_LABELS[row.status] ?? row.status}
                  </span>
                  <span className="text-muted-foreground text-xs">{row.count} MSP{row.count !== 1 ? "s" : ""}</span>
                </div>
                <span className="text-foreground text-sm font-mono">{formatCents(row.totalCents)}/mo</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MSP by status */}
      <div className="bg-card border border-border rounded-lg p-5">
        <h2 className="text-foreground text-sm font-semibold mb-4">MSP Organisations by Status</h2>
        <div className="grid grid-cols-3 gap-4">
          {Object.entries(d.mspsByStatus).map(([status, count]) => (
            <div key={status} className="text-center">
              <p className={`text-xl font-bold ${STATUS_COLORS[status] ?? "text-foreground"}`}>{count}</p>
              <p className="text-muted-foreground text-xs mt-0.5 capitalize">{status}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Per-MSP breakdown */}
      {d.perMsp.length > 0 && (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="p-4 border-b border-accent">
            <h2 className="text-foreground text-sm font-semibold">Per-MSP Revenue</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-accent">
                  <th className="text-left text-muted-foreground text-xs font-medium px-4 py-2">MSP</th>
                  <th className="text-left text-muted-foreground text-xs font-medium px-4 py-2">Plan</th>
                  <th className="text-left text-muted-foreground text-xs font-medium px-4 py-2">Status</th>
                  <th className="text-right text-muted-foreground text-xs font-medium px-4 py-2">MRR</th>
                </tr>
              </thead>
              <tbody>
                {d.perMsp.map((row, i) => (
                  <tr key={i} className="border-b border-accent hover:bg-accent transition-colors">
                    <td className="px-4 py-2.5 text-foreground font-medium truncate max-w-[160px]">{row.mspName}</td>
                    <td className="px-4 py-2.5 text-muted-foreground truncate max-w-[160px]">{row.planName}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs ${STATUS_COLORS[row.status] ?? "text-foreground"}`}>
                        {STATUS_LABELS[row.status] ?? row.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-emerald-400">{formatCents(row.priceCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
