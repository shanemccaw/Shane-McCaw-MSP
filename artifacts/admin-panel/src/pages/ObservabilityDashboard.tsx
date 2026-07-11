import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";

interface ServiceHealth {
  jobQueue: { pending: number; running: number; completed: number; failed: number; cancelled: number };
  dlq: { unresolved: number; resolvedLast7d: number };
  webhooks: { succeeded: number; failed: number; pending: number };
  portalWorkflows: { running: number; completed: number; failed: number };
}

interface EventBusStats {
  windowHours: number;
  totalEvents: number;
  byType: Array<{ eventType: string; count: number }>;
  hourly: Array<{ hour: string; count: number }>;
}

interface AlertEvent {
  id: number;
  alertEventId: string;
  ruleKey: string;
  ruleLabel: string;
  conditionType: string;
  severity: string;
  conditionValue: number;
  summary: string;
  deepLinkPath: string | null;
  deliveredEmail: boolean;
  deliveredPush: boolean;
  resolvedAt: string | null;
  firedAt: string;
}

function StatCard({ label, value, sub, accent }: { label: string; value: number | string; sub?: string; accent?: string }) {
  return (
    <div className="bg-[#161B22] border border-[#30363D] rounded-lg p-4">
      <p className="text-[#7D8590] text-xs mb-1">{label}</p>
      <p className={`text-2xl font-bold ${accent ?? "text-[#E6EDF3]"}`}>{value}</p>
      {sub && <p className="text-[#7D8590] text-xs mt-1">{sub}</p>}
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const cls = severity === "critical"
    ? "bg-red-900/40 text-red-400 border-red-800"
    : "bg-amber-900/40 text-amber-400 border-amber-800";
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wide ${cls}`}>
      {severity}
    </span>
  );
}

export default function ObservabilityDashboard() {
  const { fetchWithAuth } = useAuth();
  const [health, setHealth] = useState<ServiceHealth | null>(null);
  const [eventBus, setEventBus] = useState<EventBusStats | null>(null);
  const [alertEvents, setAlertEvents] = useState<AlertEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [h, e, a] = await Promise.all([
        fetchWithAuth("/api/admin/observability/service-health").then((r: Response) => r.json() as Promise<ServiceHealth>),
        fetchWithAuth("/api/admin/observability/event-bus?hours=24").then((r: Response) => r.json() as Promise<EventBusStats>),
        fetchWithAuth("/api/admin/observability/alert-events?limit=20").then((r: Response) => r.json() as Promise<{ events: AlertEvent[] }>),
      ]);
      setHealth(h);
      setEventBus(e);
      setAlertEvents(a.events ?? []);
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => { void load(); }, [load]);

  async function resolveAlert(id: number) {
    setResolving(id);
    try {
      await fetchWithAuth(`/api/admin/observability/alert-events/${id}/resolve`, { method: "PATCH" });
      await load();
    } finally {
      setResolving(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-[#7D8590] text-sm">
        Loading observability data…
      </div>
    );
  }

  const h = health!;
  const dlqHealthy = h.dlq.unresolved === 0;
  const jobHealthy = h.jobQueue.failed === 0;
  const webhookHealthy = h.webhooks.failed === 0;
  const wfHealthy = h.portalWorkflows.failed === 0;

  return (
    <div className="p-6 space-y-8 max-w-6xl">
      {/* Header */}
      <div>
        <h1 className="text-[#E6EDF3] text-xl font-semibold">Service Health</h1>
        <p className="text-[#7D8590] text-sm mt-1">Live platform health across jobs, DLQ, webhooks, and portal workflows.</p>
      </div>

      {/* Top status row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="DLQ Unresolved"
          value={h.dlq.unresolved}
          sub={`${h.dlq.resolvedLast7d} resolved last 7d`}
          accent={dlqHealthy ? "text-emerald-400" : "text-red-400"}
        />
        <StatCard
          label="Jobs Failed (24h)"
          value={h.jobQueue.failed}
          sub={`${h.jobQueue.completed} completed`}
          accent={jobHealthy ? "text-emerald-400" : "text-red-400"}
        />
        <StatCard
          label="Webhook Failures (24h)"
          value={h.webhooks.failed}
          sub={`${h.webhooks.succeeded} succeeded`}
          accent={webhookHealthy ? "text-emerald-400" : "text-amber-400"}
        />
        <StatCard
          label="Portal WF Failed (24h)"
          value={h.portalWorkflows.failed}
          sub={`${h.portalWorkflows.completed} completed`}
          accent={wfHealthy ? "text-emerald-400" : "text-red-400"}
        />
      </div>

      {/* Job Queue Detail */}
      <div className="bg-[#161B22] border border-[#30363D] rounded-lg p-5">
        <h2 className="text-[#E6EDF3] text-sm font-semibold mb-4">Background Job Queue (24h)</h2>
        <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
          {[
            { label: "Pending", value: h.jobQueue.pending, color: "text-blue-400" },
            { label: "Running", value: h.jobQueue.running, color: "text-yellow-400" },
            { label: "Completed", value: h.jobQueue.completed, color: "text-emerald-400" },
            { label: "Failed", value: h.jobQueue.failed, color: "text-red-400" },
            { label: "Cancelled", value: h.jobQueue.cancelled, color: "text-[#7D8590]" },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-[#7D8590] text-xs mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Event Bus */}
      {eventBus && (
        <div className="bg-[#161B22] border border-[#30363D] rounded-lg p-5">
          <h2 className="text-[#E6EDF3] text-sm font-semibold mb-1">Event Bus (last 24h)</h2>
          <p className="text-[#7D8590] text-xs mb-4">
            {eventBus.totalEvents.toLocaleString()} events dispatched
          </p>
          <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
            {eventBus.byType.map((t) => (
              <div key={t.eventType} className="flex items-center justify-between">
                <span className="text-[#7D8590] text-xs font-mono truncate max-w-xs">{t.eventType}</span>
                <div className="flex items-center gap-2 ml-4 shrink-0">
                  <div className="h-1.5 rounded-full bg-[#0078D4]" style={{ width: `${Math.min((t.count / (eventBus.totalEvents || 1)) * 120, 120)}px` }} />
                  <span className="text-[#E6EDF3] text-xs w-10 text-right">{t.count}</span>
                </div>
              </div>
            ))}
            {eventBus.byType.length === 0 && (
              <p className="text-[#7D8590] text-xs">No events in the last 24 hours.</p>
            )}
          </div>
        </div>
      )}

      {/* Recent Alerts */}
      <div className="bg-[#161B22] border border-[#30363D] rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[#E6EDF3] text-sm font-semibold">Recent Alert Events</h2>
          <button
            onClick={() => void load()}
            className="text-xs text-[#0078D4] hover:text-blue-400 transition-colors"
          >
            Refresh
          </button>
        </div>
        {alertEvents.length === 0 ? (
          <p className="text-[#7D8590] text-sm">No recent alerts. All conditions are within thresholds.</p>
        ) : (
          <div className="space-y-3">
            {alertEvents.map((evt) => (
              <div
                key={evt.id}
                className={`flex items-start gap-3 p-3 rounded-md border transition-opacity ${
                  evt.resolvedAt ? "opacity-40 border-[#21262D]" : "border-[#30363D]"
                }`}
              >
                <div className="shrink-0 mt-0.5">
                  <SeverityBadge severity={evt.severity} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[#E6EDF3] text-sm font-medium truncate">
                    {(evt as unknown as Record<string, unknown>)["rule_label"] as string ?? evt.ruleKey}
                  </p>
                  <p className="text-[#7D8590] text-xs mt-0.5 line-clamp-2">{evt.summary}</p>
                  <p className="text-[#484F58] text-xs mt-1">
                    {new Date(evt.firedAt).toLocaleString()} ·{" "}
                    {evt.deliveredEmail && "✉ email "}
                    {evt.deliveredPush && "🔔 push"}
                  </p>
                </div>
                {!evt.resolvedAt && (
                  <button
                    onClick={() => void resolveAlert(evt.id)}
                    disabled={resolving === evt.id}
                    className="shrink-0 text-xs text-[#7D8590] hover:text-[#E6EDF3] transition-colors disabled:opacity-50"
                  >
                    {resolving === evt.id ? "…" : "Resolve"}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
