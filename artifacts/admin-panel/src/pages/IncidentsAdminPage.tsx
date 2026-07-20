import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";

interface Incident {
  id: number;
  title: string;
  description: string;
  severity: "minor" | "major" | "critical";
  status: "investigating" | "identified" | "monitoring" | "resolved";
  startedAt: string;
  resolvedAt: string | null;
}

const SEVERITIES: Incident["severity"][] = ["minor", "major", "critical"];
const STATUSES: Incident["status"][] = ["investigating", "identified", "monitoring", "resolved"];

function SeverityBadge({ severity }: { severity: string }) {
  const cls =
    severity === "critical"
      ? "bg-red-900/40 text-red-400 border-red-800"
      : severity === "major"
        ? "bg-amber-900/40 text-amber-400 border-amber-800"
        : "bg-accent text-muted-foreground border-border";
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wide ${cls}`}>
      {severity}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "resolved"
      ? "bg-emerald-900/40 text-emerald-400 border-emerald-800"
      : "bg-blue-900/40 text-blue-400 border-blue-800";
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wide ${cls}`}>
      {status}
    </span>
  );
}

const emptyForm = {
  title: "",
  description: "",
  severity: "minor" as Incident["severity"],
  status: "investigating" as Incident["status"],
};

export default function IncidentsAdminPage() {
  const { fetchWithAuth } = useAuth();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/admin/incidents");
      const data = await res.json();
      setIncidents(Array.isArray(data) ? data : []);
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => { void load(); }, [load]);

  async function createIncident() {
    if (!form.title.trim() || !form.description.trim()) return;
    setSaving(true);
    try {
      await fetchWithAuth("/api/admin/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      setForm(emptyForm);
      setShowForm(false);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(incident: Incident, status: Incident["status"]) {
    await fetchWithAuth(`/api/admin/incidents/${incident.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await load();
  }

  async function deleteIncident(incident: Incident) {
    if (!confirm(`Delete incident "${incident.title}"?`)) return;
    await fetchWithAuth(`/api/admin/incidents/${incident.id}`, { method: "DELETE" });
    await load();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Loading incidents…
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-foreground text-xl font-semibold">Incidents</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manually logged platform incidents, shown on the public status page (last 90 days).
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowForm((v) => !v)}
            className="text-xs px-3 py-1.5 rounded border border-primary text-primary hover:bg-primary/10 transition-colors"
          >
            {showForm ? "Cancel" : "New Incident"}
          </button>
          <button
            onClick={() => void load()}
            className="text-xs text-primary hover:text-blue-400 transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {showForm && (
        <div className="bg-card border border-border rounded-lg p-5 space-y-3">
          <input
            className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-foreground"
            placeholder="Title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <textarea
            className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-foreground"
            placeholder="Description"
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <div className="flex gap-3">
            <select
              className="bg-background border border-border rounded px-3 py-2 text-sm text-foreground"
              value={form.severity}
              onChange={(e) => setForm({ ...form, severity: e.target.value as Incident["severity"] })}
            >
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select
              className="bg-background border border-border rounded px-3 py-2 text-sm text-foreground"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as Incident["status"] })}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <button
              onClick={() => void createIncident()}
              disabled={saving}
              className="text-xs px-3 py-1.5 rounded border border-emerald-800 text-emerald-400 hover:bg-emerald-900/20 disabled:opacity-50 transition-colors"
            >
              {saving ? "Creating…" : "Create"}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {incidents.map((incident) => (
          <div key={incident.id} className="bg-card border border-border rounded-lg p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <SeverityBadge severity={incident.severity} />
                  <StatusBadge status={incident.status} />
                  <span className="text-muted-foreground text-xs">
                    Started {new Date(incident.startedAt).toLocaleString()}
                  </span>
                </div>
                <h3 className="text-foreground text-sm font-semibold">{incident.title}</h3>
                <p className="text-muted-foreground text-xs mt-0.5">{incident.description}</p>
              </div>
              <div className="flex flex-col gap-2 shrink-0">
                <select
                  className="text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground"
                  value={incident.status}
                  onChange={(e) => void updateStatus(incident, e.target.value as Incident["status"])}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <button
                  onClick={() => void deleteIncident(incident)}
                  className="text-xs px-3 py-1.5 rounded border border-border text-muted-foreground hover:text-red-400 hover:border-red-800 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {incidents.length === 0 && (
        <div className="text-center py-12 text-muted-foreground text-sm">
          No incidents logged.
        </div>
      )}
    </div>
  );
}
