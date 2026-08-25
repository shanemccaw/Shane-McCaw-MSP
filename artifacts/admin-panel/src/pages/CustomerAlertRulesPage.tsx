import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";

// Admin surface for the CUSTOMER-tenant alert catalog (Git #1278) — what raises
// a customer-facing alert on a monitored M365 tenant. Sibling of AlertRulesPage
// (which manages the MSP-ops catalog). Delivery is DUAL: admin (email/push) now,
// and the customer via the #1276 preference layer once it lands.

interface CustomerAlertRule {
  id: number;
  ruleKey: string;
  label: string;
  description: string | null;
  conditionType: string;
  alertCategory: string;
  threshold: number;
  windowMinutes: number;
  severity: string;
  enabled: boolean;
  deliveryAdminEmail: boolean;
  deliveryAdminPush: boolean;
  notifyCustomer: boolean;
  cooldownMinutes: number;
  deepLinkPath: string | null;
  adminDeepLinkPath: string | null;
  detectorStatus: string;
  source: string | null;
  updatedAt: string;
}

interface CustomerAlertEvent {
  id: number;
  ruleKey: string;
  ruleLabel: string | null;
  alertCategory: string;
  severity: string;
  customerName: string | null;
  customerId: number;
  summary: string;
  deliveredAdminEmail: boolean;
  deliveredAdminPush: boolean;
  customerDeliveryStatus: string;
  resolvedAt: string | null;
  firedAt: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  findings: "Findings",
  drift: "Drift",
  progress: "Progress",
  reviews: "Reviews",
  remediation: "Remediation",
  billing: "Billing",
  support: "Support",
};

function SeverityBadge({ severity }: { severity: string }) {
  const cls =
    severity === "critical"
      ? "bg-red-900/40 text-red-400 border-red-800"
      : severity === "warning"
        ? "bg-amber-900/40 text-amber-400 border-amber-800"
        : "bg-sky-900/40 text-sky-400 border-sky-800";
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wide ${cls}`}>
      {severity}
    </span>
  );
}

function StatusBadge({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wide ${
        enabled
          ? "bg-emerald-900/40 text-emerald-400 border-emerald-800"
          : "bg-accent text-muted-foreground/60 border-border"
      }`}
    >
      {enabled ? "Active" : "Disabled"}
    </span>
  );
}

function DetectorBadge({ status }: { status: string }) {
  if (status === "live") return null;
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wide bg-purple-900/40 text-purple-300 border-purple-800">
      pending detector
    </span>
  );
}

export default function CustomerAlertRulesPage() {
  const { fetchWithAuth } = useAuth();
  const [rules, setRules] = useState<CustomerAlertRule[]>([]);
  const [events, setEvents] = useState<CustomerAlertEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<number | null>(null);
  const [toggling, setToggling] = useState<number | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [testResult, setTestResult] = useState<{ id: number; ok: boolean; msg: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rulesRes, eventsRes] = await Promise.all([
        fetchWithAuth("/api/admin/customer-alert-rules"),
        fetchWithAuth("/api/admin/customer-alert-events?limit=30"),
      ]);
      const rulesData = await rulesRes.json();
      const eventsData = await eventsRes.json();
      setRules(rulesData.rules ?? []);
      setEvents(eventsData.events ?? []);
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleRule(rule: CustomerAlertRule) {
    setToggling(rule.id);
    try {
      await fetchWithAuth(`/api/admin/customer-alert-rules/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      await load();
    } finally {
      setToggling(null);
    }
  }

  async function testRule(rule: CustomerAlertRule) {
    setTesting(rule.id);
    setTestResult(null);
    try {
      const res = await fetchWithAuth(`/api/admin/customer-alert-rules/${rule.id}/test`, { method: "POST" });
      const data = await res.json();
      const channels = [data.emailOk && "email", data.pushOk && "push"].filter(Boolean).join(" + ");
      setTestResult({
        id: rule.id,
        ok: true,
        msg: channels ? `Admin test alert sent via ${channels}` : "Test event created (no admin delivery channels configured)",
      });
    } catch (err) {
      setTestResult({ id: rule.id, ok: false, msg: err instanceof Error ? err.message : "Failed" });
    } finally {
      setTesting(null);
    }
  }

  async function evaluateNow() {
    setEvaluating(true);
    try {
      await fetchWithAuth("/api/admin/customer-alert-rules/evaluate", { method: "POST" });
      await load();
    } finally {
      setEvaluating(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Loading customer alert rules…
      </div>
    );
  }

  // Group rules by category for the display.
  const byCategory = new Map<string, CustomerAlertRule[]>();
  for (const r of rules) {
    const arr = byCategory.get(r.alertCategory) ?? [];
    arr.push(r);
    byCategory.set(r.alertCategory, arr);
  }
  const categoryOrder = ["findings", "drift", "progress", "reviews", "remediation", "billing", "support"];
  const orderedCategories = categoryOrder.filter((c) => byCategory.has(c));

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-foreground text-xl font-semibold">Customer Alert Rules</h1>
          <p className="text-muted-foreground text-sm mt-1">
            The catalog of conditions on a customer's monitored M365 tenant that raise a customer-facing alert.
            Delivery is dual: admin (email + push) and — via the customer's own preferences (#1276) — the customer.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => void evaluateNow()}
            disabled={evaluating}
            className="text-xs px-3 py-1.5 rounded border border-border text-muted-foreground hover:text-primary hover:border-blue-800 transition-colors disabled:opacity-50"
          >
            {evaluating ? "Evaluating…" : "Evaluate now"}
          </button>
          <button onClick={() => void load()} className="text-xs text-primary hover:text-blue-400 transition-colors">
            Refresh
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="bg-card border border-border rounded-lg p-4 text-xs text-muted-foreground space-y-1">
        <p><span className="text-foreground">Category</span> — the customer-facing group (#1276) this alert rolls up to.</p>
        <p><span className="text-foreground">Window</span> — lookback (or forward lead-time) in minutes the condition polls over.</p>
        <p><span className="text-foreground">Cooldown</span> — minimum gap between re-alerts per (rule × tenant).</p>
        <p><span className="text-purple-300">pending detector</span> — catalog row present, but its upstream source is a sub-issue and not wired yet.</p>
        <p><span className="text-foreground">Customer delivery</span> is recorded <span className="font-mono">pending_prefs</span> until the #1276 customer Alert Preferences page persists preferences.</p>
      </div>

      {/* Rules grouped by category */}
      {orderedCategories.map((cat) => (
        <div key={cat} className="space-y-3">
          <h2 className="text-foreground text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {CATEGORY_LABELS[cat] ?? cat}
          </h2>
          {(byCategory.get(cat) ?? []).map((rule) => (
            <div
              key={rule.id}
              className={`bg-card border rounded-lg p-5 transition-opacity ${
                rule.enabled ? "border-border" : "border-accent opacity-60"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <SeverityBadge severity={rule.severity} />
                    <StatusBadge enabled={rule.enabled} />
                    <DetectorBadge status={rule.detectorStatus} />
                    <span className="text-muted-foreground text-xs font-mono">{rule.conditionType}</span>
                  </div>
                  <h3 className="text-foreground text-sm font-semibold">{rule.label}</h3>
                  {rule.description && <p className="text-muted-foreground text-xs mt-0.5">{rule.description}</p>}

                  <div className="flex flex-wrap gap-4 mt-3 text-xs text-muted-foreground">
                    <span><span className="text-foreground">Window:</span> {rule.windowMinutes}m</span>
                    <span><span className="text-foreground">Cooldown:</span> {rule.cooldownMinutes}m</span>
                    <span>
                      <span className="text-foreground">Admin:</span>{" "}
                      {[rule.deliveryAdminEmail && "email", rule.deliveryAdminPush && "push"].filter(Boolean).join(", ") || "none"}
                    </span>
                    <span>
                      <span className="text-foreground">Customer:</span>{" "}
                      {rule.notifyCustomer ? "via #1276" : "no"}
                    </span>
                    {rule.source && <span className="font-mono opacity-70">{rule.source}</span>}
                  </div>

                  {testResult?.id === rule.id && (
                    <div
                      className={`mt-3 text-xs px-3 py-2 rounded border ${
                        testResult.ok
                          ? "bg-emerald-900/20 border-emerald-800 text-emerald-400"
                          : "bg-red-900/20 border-red-800 text-red-400"
                      }`}
                    >
                      {testResult.msg}
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-2 shrink-0">
                  <button
                    onClick={() => void toggleRule(rule)}
                    disabled={toggling === rule.id}
                    className={`text-xs px-3 py-1.5 rounded border transition-colors disabled:opacity-50 ${
                      rule.enabled
                        ? "border-border text-muted-foreground hover:text-red-400 hover:border-red-800"
                        : "border-emerald-800 text-emerald-400 hover:bg-emerald-900/20"
                    }`}
                  >
                    {toggling === rule.id ? "…" : rule.enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    onClick={() => void testRule(rule)}
                    disabled={testing === rule.id}
                    className="text-xs px-3 py-1.5 rounded border border-border text-muted-foreground hover:text-primary hover:border-blue-800 transition-colors disabled:opacity-50"
                  >
                    {testing === rule.id ? "Sending…" : "Test Alert"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}

      {rules.length === 0 && (
        <div className="text-center py-12 text-muted-foreground text-sm">
          No customer alert rules found. Run the manual migration
          <span className="font-mono"> 2026-08-25-customer-tenant-alert-rules-1278.sql</span> to seed the catalog.
        </div>
      )}

      {/* Recent firings */}
      <div className="space-y-3">
        <h2 className="text-foreground text-sm font-semibold uppercase tracking-wide text-muted-foreground">Recent firings</h2>
        {events.length === 0 ? (
          <div className="bg-card border border-border rounded-lg p-4 text-xs text-muted-foreground">
            No customer alerts have fired yet.
          </div>
        ) : (
          <div className="bg-card border border-border rounded-lg divide-y divide-border">
            {events.map((ev) => (
              <div key={ev.id} className="p-4 flex items-start gap-3 text-xs">
                <SeverityBadge severity={ev.severity} />
                <div className="flex-1 min-w-0">
                  <p className="text-foreground">{ev.summary}</p>
                  <p className="text-muted-foreground mt-0.5">
                    <span className="font-mono">{ev.ruleKey}</span>
                    {ev.customerName ? ` · ${ev.customerName}` : ` · tenant ${ev.customerId}`}
                    {" · "}
                    admin: {[ev.deliveredAdminEmail && "email", ev.deliveredAdminPush && "push"].filter(Boolean).join(", ") || "—"}
                    {" · "}
                    customer: <span className="font-mono">{ev.customerDeliveryStatus}</span>
                    {" · "}
                    {new Date(ev.firedAt).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
