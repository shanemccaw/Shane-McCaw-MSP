import { useEffect, useState } from "react";
import { Layout } from "../components/Layout";
import { SEOMeta } from "../components/SEOMeta";
import { GlassPanel } from "../components/design-system/GlassPanel";
import { GradientText } from "../components/design-system/GradientText";
import { CheckCircle2, AlertTriangle, XCircle, Clock } from "lucide-react";

interface PlatformIncident {
  id: number;
  title: string;
  description: string;
  severity: "minor" | "major" | "critical";
  status: "investigating" | "identified" | "monitoring" | "resolved";
  startedAt: string;
  resolvedAt: string | null;
}

type M365ServiceStatus = "healthy" | "degraded" | "interruption";

interface M365ServiceHealthEntry {
  service: string;
  status: M365ServiceStatus;
}

type M365HealthSection =
  | { available: true; services: M365ServiceHealthEntry[] }
  | { available: false; reason: string };

interface StatusResponse {
  status: "operational" | "degraded" | "outage";
  incidents: PlatformIncident[];
  m365Health: M365HealthSection;
}

const STATUS_META: Record<StatusResponse["status"], { label: string; color: string; icon: typeof CheckCircle2 }> = {
  operational: { label: "All Systems Operational", color: "text-emerald-400", icon: CheckCircle2 },
  degraded: { label: "Degraded Performance", color: "text-amber-400", icon: AlertTriangle },
  outage: { label: "Service Outage", color: "text-red-400", icon: XCircle },
};

function SeverityBadge({ severity }: { severity: PlatformIncident["severity"] }) {
  const cls =
    severity === "critical"
      ? "bg-red-500/10 text-red-400 border-red-500/30"
      : severity === "major"
        ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
        : "bg-white/5 text-text-tertiary border-white/10";
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wide ${cls}`}>
      {severity}
    </span>
  );
}

function StatusPill({ status }: { status: PlatformIncident["status"] }) {
  const cls =
    status === "resolved"
      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
      : "bg-blue-500/10 text-blue-400 border-blue-500/30";
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wide ${cls}`}>
      {status.replace("_", " ")}
    </span>
  );
}

function PlatformStatusTab({ data, error }: { data: StatusResponse | null; error: string | null }) {
  const meta = data ? STATUS_META[data.status] : null;
  const Icon = meta?.icon ?? Clock;

  return (
    <div className="space-y-8">
      <GlassPanel className="px-6 py-5 flex items-center gap-3">
        <Icon className={`w-6 h-6 shrink-0 ${meta?.color ?? "text-text-tertiary"}`} />
        <span className={`text-lg font-semibold ${meta?.color ?? "text-text-secondary"}`}>
          {error ? "Status unavailable" : meta ? meta.label : "Checking status…"}
        </span>
      </GlassPanel>

      <div>
        <h2 className="font-display text-xl font-semibold text-text-primary mb-4">
          Incident History
          <span className="text-text-tertiary text-sm font-normal ml-2">(last 90 days)</span>
        </h2>

        {data && data.incidents.length === 0 && !error && (
          <p className="text-text-tertiary text-sm">No incidents reported in the last 90 days.</p>
        )}

        <div className="space-y-3">
          {data?.incidents.map((incident) => (
            <div
              key={incident.id}
              className="rounded-xl border border-white/[0.06] bg-charcoal-1 p-5"
            >
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <SeverityBadge severity={incident.severity} />
                <StatusPill status={incident.status} />
                <span className="text-text-tertiary text-xs">
                  {new Date(incident.startedAt).toLocaleString()}
                  {incident.resolvedAt && ` — resolved ${new Date(incident.resolvedAt).toLocaleString()}`}
                </span>
              </div>
              <h3 className="text-text-primary text-sm font-semibold">{incident.title}</h3>
              <p className="text-text-secondary text-sm mt-1">{incident.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const M365_STATUS_META: Record<M365ServiceStatus, { label: string; color: string }> = {
  healthy: { label: "Healthy", color: "text-emerald-400" },
  degraded: { label: "Degraded", color: "text-amber-400" },
  interruption: { label: "Interruption", color: "text-red-400" },
};

function M365StatusPill({ status }: { status: M365ServiceStatus }) {
  const meta = M365_STATUS_META[status];
  const cls =
    status === "healthy"
      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
      : status === "degraded"
        ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
        : "bg-red-500/10 text-red-400 border-red-500/30";
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wide ${cls}`}>
      {meta.label}
    </span>
  );
}

function M365HealthTab({ data, error }: { data: StatusResponse | null; error: string | null }) {
  const m365 = data?.m365Health;

  if (error) {
    return (
      <GlassPanel className="px-6 py-5 flex items-center gap-3">
        <XCircle className="w-6 h-6 shrink-0 text-red-400" />
        <span className="text-lg font-semibold text-text-secondary">Status unavailable</span>
      </GlassPanel>
    );
  }

  if (!m365) {
    return (
      <GlassPanel className="px-6 py-5 flex items-center gap-3">
        <Clock className="w-6 h-6 shrink-0 text-text-tertiary" />
        <span className="text-lg font-semibold text-text-secondary">Checking status…</span>
      </GlassPanel>
    );
  }

  if (!m365.available) {
    return (
      <GlassPanel className="px-6 py-5 flex items-center gap-3">
        <Clock className="w-6 h-6 shrink-0 text-text-tertiary" />
        <span className="text-lg font-semibold text-text-secondary">M365 service health is temporarily unavailable</span>
      </GlassPanel>
    );
  }

  return (
    <div className="space-y-3">
      {m365.services.length === 0 && (
        <p className="text-text-tertiary text-sm">No M365 service health data available.</p>
      )}
      {m365.services.map((entry) => (
        <div
          key={entry.service}
          className="rounded-xl border border-white/[0.06] bg-charcoal-1 p-5 flex items-center justify-between gap-3"
        >
          <h3 className="text-text-primary text-sm font-semibold">{entry.service}</h3>
          <M365StatusPill status={entry.status} />
        </div>
      ))}
    </div>
  );
}

type StatusTab = "platform" | "m365";

export default function Status() {
  const [tab, setTab] = useState<StatusTab>("platform");
  const [data, setData] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/status")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load status");
        return r.json() as Promise<StatusResponse>;
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load current status");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Layout>
      <SEOMeta
        title="System Status | Shane McCaw Consulting"
        description="Live platform status and incident history for the Shane McCaw Consulting engine."
      />

      <section className="relative pt-32 sm:pt-40 pb-16 px-4 sm:px-6 lg:px-8 text-center overflow-hidden">
        <div className="max-w-4xl mx-auto">
          <h1 className="font-display text-4xl sm:text-5xl font-bold text-text-primary tracking-tight mb-4">
            System <GradientText>Status</GradientText>
          </h1>
          <p className="text-text-secondary text-base sm:text-lg max-w-2xl mx-auto">
            Real-time platform uptime and incident history.
          </p>
        </div>
      </section>

      <section className="border-t border-white/[0.06] py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto">
          <div className="flex gap-2 mb-8 border-b border-white/[0.06]">
            <button
              onClick={() => setTab("platform")}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === "platform"
                  ? "border-accent-blue text-text-primary"
                  : "border-transparent text-text-tertiary hover:text-text-secondary"
              }`}
            >
              Platform
            </button>
            <button
              onClick={() => setTab("m365")}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === "m365"
                  ? "border-accent-blue text-text-primary"
                  : "border-transparent text-text-tertiary hover:text-text-secondary"
              }`}
            >
              M365 Service Health
            </button>
          </div>

          {tab === "platform" && <PlatformStatusTab data={data} error={error} />}
          {tab === "m365" && <M365HealthTab data={data} error={error} />}
        </div>
      </section>
    </Layout>
  );
}
