import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { SqlRunnerModal } from "@/components/SqlRunnerModal";
import { GraphProbeModal } from "@/components/GraphProbeModal";
import { Database, Globe } from "lucide-react";

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

interface TelemetryData {
  ai: {
    todayTokens: number;
    monthlyCostUsd: string;
    topTenants: Array<{
      mspId: number | null;
      mspName: string;
      totalTokens: number;
      costUsd: string;
    }>;
  };
  system: {
    database: {
      sizePretty: string;
      sizeBytes: number;
      connections: {
        active: number;
        max: number;
        saturation: number;
      };
    };
    process: {
      heapUsed: number;
      heapTotal: number;
    };
  };
  heartbeats: {
    apiEngine: string;
    cronLoops: string;
  };
}

function StatCard({ label, value, sub, accent }: { label: string; value: number | string; sub?: string; accent?: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <p className="text-muted-foreground text-xs mb-1">{label}</p>
      <p className={`text-2xl font-bold ${accent ?? "text-foreground"}`}>{value}</p>
      {sub && <p className="text-muted-foreground text-xs mt-1">{sub}</p>}
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
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<number | null>(null);

  // Modal open states
  const [isSqlRunnerOpen, setIsSqlRunnerOpen] = useState(false);
  const [isGraphProbeOpen, setIsGraphProbeOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [h, e, a, t] = await Promise.all([
        fetchWithAuth("/api/admin/observability/service-health").then((r: Response) => r.json() as Promise<ServiceHealth>),
        fetchWithAuth("/api/admin/observability/event-bus?hours=24").then((r: Response) => r.json() as Promise<EventBusStats>),
        fetchWithAuth("/api/admin/observability/alert-events?limit=20").then((r: Response) => r.json() as Promise<{ events: AlertEvent[] }>),
        fetchWithAuth("/api/admin/observability")
          .then((r: Response) => r.json() as Promise<TelemetryData>)
          .catch(() => null),
      ]);
      setHealth(h);
      setEventBus(e);
      setAlertEvents(a.events ?? []);
      setTelemetry(t);
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
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Loading observability data…
      </div>
    );
  }

  if (!health) {
    return (
      <div className="flex items-center justify-center h-64 text-red-400 text-sm">
        Failed to load observability data.
      </div>
    );
  }

  const h: ServiceHealth = {
    jobQueue: health.jobQueue || { pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0 },
    dlq: health.dlq || { unresolved: 0, resolvedLast7d: 0 },
    webhooks: health.webhooks || { succeeded: 0, failed: 0, pending: 0 },
    portalWorkflows: health.portalWorkflows || { running: 0, completed: 0, failed: 0 }
  };

  const dlqHealthy = h.dlq.unresolved === 0;
  const jobHealthy = h.jobQueue.failed === 0;
  const webhookHealthy = h.webhooks.failed === 0;
  const wfHealthy = h.portalWorkflows.failed === 0;

  return (
    <div className="p-6 space-y-8 max-w-6xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-foreground text-xl font-semibold">Service Health</h1>
          <p className="text-muted-foreground text-sm mt-1">Live platform health across jobs, DLQ, webhooks, and portal workflows.</p>
          <div className="flex items-center gap-4 mt-3 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>API Engine:</span>
              <span className={`px-2 py-0.5 rounded font-medium border text-[10px] uppercase tracking-wider ${
                telemetry?.heartbeats.apiEngine === 'healthy' 
                  ? 'bg-emerald-900/30 text-emerald-400 border-emerald-800/50' 
                  : telemetry?.heartbeats.apiEngine === 'unhealthy' 
                  ? 'bg-red-900/30 text-red-400 border-red-800/50' 
                  : 'bg-accent text-muted-foreground border-border'
              }`}>
                {telemetry?.heartbeats.apiEngine || 'loading...'}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>Background Queue CRON:</span>
              <span className={`px-2 py-0.5 rounded font-medium border text-[10px] uppercase tracking-wider ${
                telemetry?.heartbeats.cronLoops === 'healthy' 
                  ? 'bg-emerald-900/30 text-emerald-400 border-emerald-800/50' 
                  : telemetry?.heartbeats.cronLoops === 'unhealthy' 
                  ? 'bg-red-900/30 text-red-400 border-red-800/50' 
                  : 'bg-accent text-muted-foreground border-border'
              }`}>
                {telemetry?.heartbeats.cronLoops || 'loading...'}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsSqlRunnerOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent hover:bg-border border border-border text-xs font-semibold text-white transition-colors"
          >
            <Database className="w-4 h-4 text-blue-400" />
            SQL Runner
          </button>
          <button
            onClick={() => setIsGraphProbeOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent hover:bg-border border border-border text-xs font-semibold text-white transition-colors"
          >
            <Globe className="w-4 h-4 text-purple-400" />
            API Graph Probe
          </button>
        </div>
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
      <div className="bg-card border border-border rounded-lg p-5">
        <h2 className="text-foreground text-sm font-semibold mb-4">Background Job Queue (24h)</h2>
        <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
          {[
            { label: "Pending", value: h.jobQueue.pending, color: "text-blue-400" },
            { label: "Running", value: h.jobQueue.running, color: "text-yellow-400" },
            { label: "Completed", value: h.jobQueue.completed, color: "text-emerald-400" },
            { label: "Failed", value: h.jobQueue.failed, color: "text-red-400" },
            { label: "Cancelled", value: h.jobQueue.cancelled, color: "text-muted-foreground" },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-muted-foreground text-xs mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* AI Telemetry and System Utilization Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Claude AI Token Burn & Cost */}
        <div className="bg-card border border-border rounded-lg p-5">
          <h2 className="text-foreground text-sm font-semibold mb-3">Claude AI Token Burn & Cost</h2>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="bg-background border border-accent p-3 rounded">
              <p className="text-muted-foreground text-xs">Today's Token Usage</p>
              <p className="text-xl font-bold text-blue-400 mt-1">
                {telemetry ? telemetry.ai.todayTokens.toLocaleString() : "—"}
              </p>
            </div>
            <div className="bg-background border border-accent p-3 rounded">
              <p className="text-muted-foreground text-xs">Monthly Estimated Cost</p>
              <p className="text-xl font-bold text-emerald-400 mt-1">
                {telemetry ? `$${telemetry.ai.monthlyCostUsd} USD` : "—"}
              </p>
            </div>
          </div>
          <div>
            <p className="text-foreground text-xs font-semibold mb-2">Top Consuming Tenants (This Month)</p>
            <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
              {telemetry?.ai.topTenants.map((t, idx) => (
                <div key={t.mspId || idx} className="flex justify-between items-center text-xs py-1 border-b border-accent last:border-0">
                  <span className="text-muted-foreground truncate max-w-[180px]">{t.mspName}</span>
                  <span className="text-foreground font-mono shrink-0">
                    {t.totalTokens.toLocaleString()} tokens (${t.costUsd})
                  </span>
                </div>
              ))}
              {telemetry && telemetry.ai.topTenants.length === 0 && (
                <p className="text-muted-foreground text-xs italic">No AI usage recorded this month.</p>
              )}
              {!telemetry && (
                <p className="text-muted-foreground text-xs italic">Loading tenant breakdown...</p>
              )}
            </div>
          </div>
        </div>

        {/* Database & Process Utilization */}
        <div className="bg-card border border-border rounded-lg p-5">
          <h2 className="text-foreground text-sm font-semibold mb-3">Database & Process Utilization</h2>
          <div className="space-y-4">
            {/* DB Size */}
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-muted-foreground">PostgreSQL Database Size</span>
                <span className="text-foreground font-mono font-semibold">
                  {telemetry?.system.database.sizePretty || "—"}
                </span>
              </div>
            </div>

            {/* Active DB Connections */}
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-muted-foreground">Active DB Connections</span>
                <span className="text-foreground font-mono">
                  {telemetry ? `${telemetry.system.database.connections.active} / ${telemetry.system.database.connections.max} active` : "—"}
                </span>
              </div>
              <div className="w-full bg-accent rounded-full h-1.5 overflow-hidden">
                <div 
                  className={`h-1.5 rounded-full ${
                    telemetry && telemetry.system.database.connections.saturation > 0.8 ? 'bg-red-500' : 'bg-blue-500'
                  }`}
                  style={{ width: `${telemetry ? Math.min(telemetry.system.database.connections.saturation * 100, 100) : 0}%` }}
                />
              </div>
            </div>

            {/* Node.js Process Heap Memory */}
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-muted-foreground">Node.js Heap Memory</span>
                <span className="text-foreground font-mono font-semibold">
                  {telemetry ? `${(telemetry.system.process.heapUsed / 1024 / 1024).toFixed(1)} MB / ${(telemetry.system.process.heapTotal / 1024 / 1024).toFixed(1)} MB` : "—"}
                </span>
              </div>
              <div className="w-full bg-accent rounded-full h-1.5 overflow-hidden">
                <div 
                  className={`h-1.5 rounded-full ${
                    telemetry && (telemetry.system.process.heapUsed / telemetry.system.process.heapTotal) > 0.8 ? 'bg-amber-500' : 'bg-purple-500'
                  }`}
                  style={{ width: `${telemetry ? Math.min((telemetry.system.process.heapUsed / telemetry.system.process.heapTotal) * 100, 100) : 0}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Event Bus */}
      {eventBus && (
        <div className="bg-card border border-border rounded-lg p-5">
          <h2 className="text-foreground text-sm font-semibold mb-1">Event Bus (last 24h)</h2>
          <p className="text-muted-foreground text-xs mb-4">
            {eventBus.totalEvents.toLocaleString()} events dispatched
          </p>
          <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
            {eventBus.byType.map((t) => (
              <div key={t.eventType} className="flex items-center justify-between">
                <span className="text-muted-foreground text-xs font-mono truncate max-w-xs">{t.eventType}</span>
                <div className="flex items-center gap-2 ml-4 shrink-0">
                  <div className="h-1.5 rounded-full bg-primary" style={{ width: `${Math.min((t.count / (eventBus.totalEvents || 1)) * 120, 120)}px` }} />
                  <span className="text-foreground text-xs w-10 text-right">{t.count}</span>
                </div>
              </div>
            ))}
            {eventBus.byType.length === 0 && (
              <p className="text-muted-foreground text-xs">No events in the last 24 hours.</p>
            )}
          </div>
        </div>
      )}

      {/* Recent Alerts */}
      <div className="bg-card border border-border rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-foreground text-sm font-semibold">Recent Alert Events</h2>
          <button
            onClick={() => void load()}
            className="text-xs text-primary hover:text-blue-400 transition-colors"
          >
            Refresh
          </button>
        </div>
        {alertEvents.length === 0 ? (
          <p className="text-muted-foreground text-sm">No recent alerts. All conditions are within thresholds.</p>
        ) : (
          <div className="space-y-3">
            {alertEvents.map((evt) => (
              <div
                key={evt.id}
                className={`flex items-start gap-3 p-3 rounded-md border transition-opacity ${
                  evt.resolvedAt ? "opacity-40 border-accent" : "border-border"
                }`}
              >
                <div className="shrink-0 mt-0.5">
                  <SeverityBadge severity={evt.severity} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-foreground text-sm font-medium truncate">
                    {(evt as unknown as Record<string, unknown>)["rule_label"] as string ?? evt.ruleKey}
                  </p>
                  <p className="text-muted-foreground text-xs mt-0.5 line-clamp-2">{evt.summary}</p>
                  <p className="text-muted-foreground/60 text-xs mt-1">
                    {new Date(evt.firedAt).toLocaleString()} ·{" "}
                    {evt.deliveredEmail && "✉ email "}
                    {evt.deliveredPush && "🔔 push"}
                  </p>
                </div>
                {!evt.resolvedAt && (
                  <button
                    onClick={() => void resolveAlert(evt.id)}
                    disabled={resolving === evt.id}
                    className="shrink-0 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                  >
                    {resolving === evt.id ? "…" : "Resolve"}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <SqlRunnerModal isOpen={isSqlRunnerOpen} onClose={() => setIsSqlRunnerOpen(false)} />
      <GraphProbeModal isOpen={isGraphProbeOpen} onClose={() => setIsGraphProbeOpen(false)} />
    </div>
  );
}
