import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";

interface AlertRule {
  id: number;
  ruleKey: string;
  label: string;
  description: string | null;
  conditionType: string;
  threshold: number;
  windowMinutes: number;
  severity: string;
  enabled: boolean;
  deliveryEmail: boolean;
  deliveryPush: boolean;
  cooldownMinutes: number;
  deepLinkPath: string | null;
  updatedAt: string;
}

const CONDITION_LABELS: Record<string, string> = {
  dlq_backlog: "DLQ Backlog",
  billing_failure: "Billing Failure",
  sla_breach: "SLA Breach",
  event_bus_backlog: "Event Bus Backlog",
  job_failure_rate: "Job Failure Rate",
};

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

function StatusBadge({ enabled }: { enabled: boolean }) {
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wide ${
      enabled
        ? "bg-emerald-900/40 text-emerald-400 border-emerald-800"
        : "bg-[#21262D] text-[#484F58] border-[#30363D]"
    }`}>
      {enabled ? "Active" : "Disabled"}
    </span>
  );
}

export default function AlertRulesPage() {
  const { fetchWithAuth } = useAuth();
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<number | null>(null);
  const [toggling, setToggling] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<{ id: number; ok: boolean; msg: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/admin/observability/alert-rules");
      const data = await res.json();
      setRules(data.rules ?? []);
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => { void load(); }, [load]);

  async function toggleRule(rule: AlertRule) {
    setToggling(rule.id);
    try {
      await fetchWithAuth(`/api/admin/observability/alert-rules/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      await load();
    } finally {
      setToggling(null);
    }
  }

  async function testRule(rule: AlertRule) {
    setTesting(rule.id);
    setTestResult(null);
    try {
      const res = await fetchWithAuth(`/api/admin/observability/alert-rules/${rule.id}/test`, { method: "POST" });
      const data = await res.json();
      const channels = [data.emailOk && "email", data.pushOk && "push"].filter(Boolean).join(" + ");
      setTestResult({
        id: rule.id,
        ok: true,
        msg: channels ? `Test alert sent via ${channels}` : "Test event created (no delivery channels configured)",
      });
    } catch (err) {
      setTestResult({ id: rule.id, ok: false, msg: err instanceof Error ? err.message : "Failed" });
    } finally {
      setTesting(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-[#7D8590] text-sm">
        Loading alert rules…
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[#E6EDF3] text-xl font-semibold">Alert Rules</h1>
          <p className="text-[#7D8590] text-sm mt-1">
            Configure conditions that trigger alerts via Exchange Online email and browser push.
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="text-xs text-[#0078D4] hover:text-blue-400 transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Legend */}
      <div className="bg-[#161B22] border border-[#30363D] rounded-lg p-4 text-xs text-[#7D8590] space-y-1">
        <p><span className="text-[#E6EDF3]">Threshold</span> — condition value must be ≥ this to fire the alert.</p>
        <p><span className="text-[#E6EDF3]">Window</span> — lookback period (minutes) for rate-based conditions.</p>
        <p><span className="text-[#E6EDF3]">Cooldown</span> — minimum gap between re-alerts for the same rule.</p>
        <p>Delivery uses the platform Exchange Online mailbox (GRAPH_MAIL_USER_ID) and VAPID browser push.</p>
      </div>

      {/* Rules list */}
      <div className="space-y-3">
        {rules.map((rule) => (
          <div
            key={rule.id}
            className={`bg-[#161B22] border rounded-lg p-5 transition-opacity ${
              rule.enabled ? "border-[#30363D]" : "border-[#21262D] opacity-60"
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <SeverityBadge severity={rule.severity} />
                  <StatusBadge enabled={rule.enabled} />
                  <span className="text-[#7D8590] text-xs font-mono">{CONDITION_LABELS[rule.conditionType] ?? rule.conditionType}</span>
                </div>
                <h3 className="text-[#E6EDF3] text-sm font-semibold">{rule.label}</h3>
                {rule.description && (
                  <p className="text-[#7D8590] text-xs mt-0.5">{rule.description}</p>
                )}

                <div className="flex flex-wrap gap-4 mt-3 text-xs text-[#7D8590]">
                  <span>
                    <span className="text-[#E6EDF3]">Threshold:</span> ≥ {rule.threshold}
                  </span>
                  <span>
                    <span className="text-[#E6EDF3]">Window:</span> {rule.windowMinutes}m
                  </span>
                  <span>
                    <span className="text-[#E6EDF3]">Cooldown:</span> {rule.cooldownMinutes}m
                  </span>
                  <span>
                    <span className="text-[#E6EDF3]">Delivery:</span>{" "}
                    {[rule.deliveryEmail && "email", rule.deliveryPush && "push"]
                      .filter(Boolean).join(", ") || "none"}
                  </span>
                  {rule.deepLinkPath && (
                    <span>
                      <span className="text-[#E6EDF3]">Link:</span>{" "}
                      <span className="font-mono">{rule.deepLinkPath}</span>
                    </span>
                  )}
                </div>

                {testResult?.id === rule.id && (
                  <div className={`mt-3 text-xs px-3 py-2 rounded border ${
                    testResult.ok
                      ? "bg-emerald-900/20 border-emerald-800 text-emerald-400"
                      : "bg-red-900/20 border-red-800 text-red-400"
                  }`}>
                    {testResult.msg}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2 shrink-0">
                {/* Toggle */}
                <button
                  onClick={() => void toggleRule(rule)}
                  disabled={toggling === rule.id}
                  className={`text-xs px-3 py-1.5 rounded border transition-colors disabled:opacity-50 ${
                    rule.enabled
                      ? "border-[#30363D] text-[#7D8590] hover:text-red-400 hover:border-red-800"
                      : "border-emerald-800 text-emerald-400 hover:bg-emerald-900/20"
                  }`}
                >
                  {toggling === rule.id ? "…" : rule.enabled ? "Disable" : "Enable"}
                </button>

                {/* Test */}
                <button
                  onClick={() => void testRule(rule)}
                  disabled={testing === rule.id}
                  className="text-xs px-3 py-1.5 rounded border border-[#30363D] text-[#7D8590] hover:text-[#0078D4] hover:border-blue-800 transition-colors disabled:opacity-50"
                >
                  {testing === rule.id ? "Sending…" : "Test Alert"}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {rules.length === 0 && (
        <div className="text-center py-12 text-[#7D8590] text-sm">
          No alert rules configured. Rules are seeded automatically on server startup.
        </div>
      )}
    </div>
  );
}
