import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { format, formatDistanceToNow } from "date-fns";

interface WfTrigger {
  id: number;
  definitionId: number;
  type: "manual" | "schedule" | "webhook" | "event";
  config: Record<string, unknown>;
  webhookToken: string | null;
  nextRunAt: string | null;
  enabled: boolean;
  createdAt: string;
}

interface WfDefinition {
  id: number;
  name: string;
}

interface TriggerEvent {
  id: number;
  triggerId: number;
  runId: number | null;
  firedAt: string;
  status: "fired" | "skipped" | "error";
  durationMs: number | null;
  errorMessage: string | null;
  payload: Record<string, unknown> | null;
}

interface TriggerStats {
  total: number;
  avgDurationMs: number | null;
  lastFiredAt: string | null;
  lastStatus: string | null;
  dailyBuckets: Array<{ day: string; total: number; fired: number; errors: number }>;
}

const TRIGGER_ICONS: Record<string, string> = {
  manual:   "🖱",
  schedule: "📅",
  webhook:  "🔗",
  event:    "📡",
};

const TRIGGER_DESCRIPTIONS: Record<string, string> = {
  manual:   "Fired via API or the 'Run Now' button.",
  schedule: "Fires on a cron schedule.",
  webhook:  "Fires when a POST request arrives at the webhook URL.",
  event:    "Fires when a named backend event is emitted.",
};

function StatusDot({ status }: { status: "fired" | "skipped" | "error" }) {
  const colors = {
    fired: "bg-emerald-400",
    skipped: "bg-amber-400",
    error: "bg-red-400",
  };
  return <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${colors[status]}`} />;
}

function Sparkline({ buckets }: { buckets: TriggerStats["dailyBuckets"] }) {
  if (!buckets.length) {
    return (
      <div className="flex items-end gap-0.5 h-8">
        {Array.from({ length: 30 }).map((_, i) => (
          <div key={i} className="flex-1 bg-[#1C2128] rounded-sm" style={{ height: "4px" }} />
        ))}
      </div>
    );
  }
  const maxTotal = Math.max(...buckets.map(b => b.total), 1);
  const last30: TriggerStats["dailyBuckets"] = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const found = buckets.find(b => b.day.slice(0, 10) === key);
    last30.push(found ?? { day: key, total: 0, fired: 0, errors: 0 });
  }
  return (
    <div className="flex items-end gap-0.5 h-8" title="Daily fire counts — last 30 days">
      {last30.map(b => {
        const height = Math.max(4, Math.round((b.total / maxTotal) * 32));
        const hasErrors = b.errors > 0;
        return (
          <div
            key={b.day}
            className={`flex-1 rounded-sm ${hasErrors ? "bg-red-400/70" : b.total > 0 ? "bg-emerald-400/70" : "bg-[#1C2128]"}`}
            style={{ height }}
            title={`${b.day}: ${b.total} fire${b.total !== 1 ? "s" : ""}${b.errors ? `, ${b.errors} error${b.errors !== 1 ? "s" : ""}` : ""}`}
          />
        );
      })}
    </div>
  );
}

function TriggerCard({
  t,
  defId,
  webhookBase,
}: {
  t: WfTrigger;
  defId: number;
  webhookBase: string;
}) {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [showPayload, setShowPayload] = useState<number | null>(null);
  const [copying, setCopying] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [showTestPayloadEditor, setShowTestPayloadEditor] = useState(false);
  const [customPayloadText, setCustomPayloadText] = useState<string>(
    () => localStorage.getItem(`wf-trigger-payload-${t.id}`) ?? "{}",
  );
  const [payloadError, setPayloadError] = useState<string | null>(null);
  // If there's already a saved payload in localStorage, mark as prefilled
  // so the "auto-fill from last event" logic doesn't override the user's entry.
  const [payloadPrefilled, setPayloadPrefilled] = useState<boolean>(
    () => !!localStorage.getItem(`wf-trigger-payload-${t.id}`),
  );

  const { data: events = [], isLoading: eventsLoading } = useQuery<TriggerEvent[]>({
    queryKey: ["wf-trigger-events", t.id],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/workflows/definitions/${defId}/triggers/${t.id}/events?limit=20`);
      return res.json();
    },
    enabled: expanded,
    refetchInterval: expanded ? 15000 : false,
  });

  const { data: stats } = useQuery<TriggerStats>({
    queryKey: ["wf-trigger-stats", t.id],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/workflows/definitions/${defId}/triggers/${t.id}/stats`);
      return res.json();
    },
    refetchInterval: 60000,
  });

  const toggleMut = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await fetchWithAuth(`/api/admin/workflows/definitions/${defId}/triggers/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error("Failed to update");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wf-triggers", defId] }),
  });

  const deleteMut = useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth(`/api/admin/workflows/definitions/${defId}/triggers/${t.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wf-triggers", defId] }),
  });

  const testFireMut = useMutation({
    mutationFn: async () => {
      let parsedPayload: Record<string, unknown> = {};
      try {
        parsedPayload = JSON.parse(customPayloadText) as Record<string, unknown>;
        setPayloadError(null);
      } catch {
        setPayloadError("Invalid JSON — fix the payload before firing.");
        throw new Error("Invalid JSON payload");
      }
      const res = await fetchWithAuth(`/api/admin/workflows/definitions/${defId}/triggers/${t.id}/test-fire`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: parsedPayload }),
      });
      if (!res.ok) throw new Error("Failed to test-fire");
      return res.json() as Promise<{ runId: number | null }>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wf-trigger-events", t.id] });
      qc.invalidateQueries({ queryKey: ["wf-trigger-stats", t.id] });
    },
  });

  const copyUrl = async (url: string) => {
    await navigator.clipboard.writeText(url);
    setCopying(true);
    setTimeout(() => setCopying(false), 1200);
  };

  return (
    <div className={`bg-[#161B22] border rounded-xl transition-colors ${t.enabled ? "border-[#30363D]" : "border-[#30363D]/40 opacity-70"}`}>
      {/* Card header */}
      <div
        className="flex items-center gap-3 p-4 cursor-pointer select-none"
        onClick={() => setExpanded(v => !v)}
      >
        <span className="text-xl flex-shrink-0">{TRIGGER_ICONS[t.type]}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-[#E6EDF3] capitalize">{t.type} Trigger</p>
            {stats?.lastStatus && (
              <StatusDot status={stats.lastStatus as "fired" | "skipped" | "error"} />
            )}
            {stats?.lastFiredAt && (
              <span className="text-[10px] text-[#484F58]">
                Last: {formatDistanceToNow(new Date(stats.lastFiredAt), { addSuffix: true })}
              </span>
            )}
            {stats && stats.total > 0 && (
              <span className="text-[10px] text-[#484F58]">· {stats.total} total fires</span>
            )}
          </div>
          <p className="text-xs text-[#7D8590] mt-0.5">{TRIGGER_DESCRIPTIONS[t.type]}</p>
        </div>

        {/* Sparkline */}
        {stats && (
          <div className="flex-shrink-0 hidden sm:block">
            <Sparkline buckets={stats.dailyBuckets} />
          </div>
        )}

        <div className="flex items-center gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => toggleMut.mutate(!t.enabled)}
            disabled={toggleMut.isPending}
            className={`px-2.5 py-1 text-[10px] font-semibold rounded-full border transition-colors ${
              t.enabled
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20"
                : "bg-[#1C2128] text-[#7D8590] border-[#30363D] hover:border-[#484F58]"
            }`}
          >
            {t.enabled ? "Enabled" : "Disabled"}
          </button>
          {(t.type === "webhook" || t.type === "event") && (
            <button
              onClick={() => {
                if (!showTestPayloadEditor && !payloadPrefilled && events.length > 0 && events[0].payload) {
                  try {
                    setCustomPayloadText(JSON.stringify(events[0].payload, null, 2));
                    setPayloadPrefilled(true);
                  } catch { /* leave as-is */ }
                }
                setShowTestPayloadEditor(v => !v);
              }}
              className={`px-2.5 py-1 text-[10px] font-semibold rounded-full border transition-colors ${showTestPayloadEditor ? "bg-[#0078D4]/10 border-[#0078D4]/40 text-[#0078D4]" : "border-[#0078D4]/30 text-[#0078D4] hover:bg-[#0078D4]/10"}`}
              title="Edit test payload JSON before firing"
            >
              Test Fire ▾
            </button>
          )}
          {deleteConfirm ? (
            <>
              <button
                onClick={() => deleteMut.mutate()}
                disabled={deleteMut.isPending}
                className="px-2.5 py-1 text-[10px] font-semibold rounded-full border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-colors"
              >
                {deleteMut.isPending ? "Deleting…" : "Confirm"}
              </button>
              <button
                onClick={() => setDeleteConfirm(false)}
                className="px-2.5 py-1 text-[10px] text-[#7D8590] hover:text-[#E6EDF3] transition-colors"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setDeleteConfirm(true)}
              className="p-1.5 text-[#484F58] hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
              title="Delete trigger"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>

        <svg
          className={`w-4 h-4 text-[#484F58] flex-shrink-0 transition-transform duration-150 ${expanded ? "" : "-rotate-90"}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* Type-specific config row */}
      <div className="px-4 pb-3 -mt-1">
        {t.type === "schedule" && (
          <div className="text-xs text-[#484F58] font-mono bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2">
            cron: <span className="text-[#E6EDF3]">{(t.config.cron as string) ?? "—"}</span>
            {t.nextRunAt && (
              <span className="ml-4">next: <span className="text-[#7D8590]">{format(new Date(t.nextRunAt), "MMM d, HH:mm")}</span></span>
            )}
          </div>
        )}
        {t.type === "webhook" && t.webhookToken && (
          <div className="flex items-center gap-2">
            <code className="flex-1 text-[10px] bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-[#7D8590] font-mono truncate">
              POST {webhookBase}/{t.webhookToken}
            </code>
            <button
              onClick={() => copyUrl(`${webhookBase}/${t.webhookToken}`)}
              className="flex-shrink-0 p-2 text-[#484F58] hover:text-[#E6EDF3] hover:bg-[#1C2128] rounded-lg border border-[#30363D] transition-colors"
              title="Copy URL"
            >
              {copying ? (
                <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              )}
            </button>
          </div>
        )}
        {t.type === "event" && (
          <div className="text-xs text-[#484F58] font-mono bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2">
            event: <span className="text-[#E6EDF3]">{(t.config.eventName as string) ?? "—"}</span>
          </div>
        )}
      </div>

      {/* Test Fire payload editor (shown when dropdown is open, regardless of expanded) */}
      {showTestPayloadEditor && (
        <div className="border-t border-[#30363D] px-4 pb-3 pt-3 space-y-2">
          <p className="text-[10px] uppercase tracking-widest font-bold text-[#484F58]">Test Payload (JSON)</p>
          <textarea
            value={customPayloadText}
            onChange={e => {
              setCustomPayloadText(e.target.value);
              localStorage.setItem(`wf-trigger-payload-${t.id}`, e.target.value);
              setPayloadError(null);
            }}
            rows={5}
            spellCheck={false}
            className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] font-mono resize-y outline-none focus:border-[#0078D4]/60 placeholder-[#484F58]"
            placeholder='{ "key": "value" }'
          />
          {payloadError && <p className="text-[10px] text-red-400">{payloadError}</p>}
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => {
                setCustomPayloadText("{}");
                localStorage.removeItem(`wf-trigger-payload-${t.id}`);
                setPayloadPrefilled(false);
                setPayloadError(null);
              }}
              className="px-3 py-1.5 text-xs text-[#7D8590] hover:text-[#E6EDF3] transition-colors"
            >
              Reset
            </button>
            <button
              onClick={() => testFireMut.mutate()}
              disabled={testFireMut.isPending}
              className="px-3 py-1.5 text-xs bg-[#0078D4] hover:bg-[#006CBF] disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
            >
              {testFireMut.isPending ? "Firing…" : "Fire Now"}
            </button>
          </div>
        </div>
      )}

      {/* Expanded section */}
      {expanded && (
        <div className="border-t border-[#30363D] px-4 pb-4 pt-3 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-widest font-bold text-[#484F58]">Event History</p>
            {testFireMut.isSuccess && (
              <span className="text-[10px] text-emerald-400">
                ✓ Fired — run #{testFireMut.data?.runId ?? "n/a"}
              </span>
            )}
            {testFireMut.isError && (
              <span className="text-[10px] text-red-400">Test fire failed</span>
            )}
          </div>

          {eventsLoading ? (
            <div className="space-y-1">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-8 bg-[#0D1117] border border-[#30363D] rounded-lg animate-pulse" />
              ))}
            </div>
          ) : events.length === 0 ? (
            <div className="text-center py-6 text-[#484F58] text-xs">
              No events yet — click <strong>Test Fire</strong> to generate the first one.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[#484F58] text-[10px] uppercase tracking-widest">
                    <th className="text-left px-2 pb-1 font-normal w-4"></th>
                    <th className="text-left px-2 pb-1 font-normal">When</th>
                    <th className="text-left px-2 pb-1 font-normal">Run</th>
                    <th className="text-left px-2 pb-1 font-normal">Duration</th>
                    <th className="text-left px-2 pb-1 font-normal">Payload</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map(evt => (
                    <tr key={evt.id} className="border-t border-[#1C2128] hover:bg-[#0D1117]/50 transition-colors">
                      <td className="px-2 py-1.5">
                        <StatusDot status={evt.status} />
                      </td>
                      <td className="px-2 py-1.5 text-[#7D8590] whitespace-nowrap">
                        {formatDistanceToNow(new Date(evt.firedAt), { addSuffix: true })}
                      </td>
                      <td className="px-2 py-1.5">
                        {evt.runId ? (
                          <span className="font-mono text-[#0078D4]">#{evt.runId}</span>
                        ) : (
                          <span className="text-[#484F58]">—</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-[#7D8590] whitespace-nowrap">
                        {evt.durationMs != null ? `${evt.durationMs} ms` : "—"}
                      </td>
                      <td className="px-2 py-1.5">
                        {evt.payload && Object.keys(evt.payload).length > 0 ? (
                          <button
                            onClick={() => setShowPayload(showPayload === evt.id ? null : evt.id)}
                            className="text-[10px] text-[#0078D4] hover:text-[#2E9EFF] transition-colors"
                          >
                            {showPayload === evt.id ? "Hide" : "View"}
                          </button>
                        ) : (
                          <span className="text-[#484F58]">{"{}"}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Payload viewer */}
              {showPayload != null && (() => {
                const evt = events.find(e => e.id === showPayload);
                if (!evt?.payload) return null;
                const json = JSON.stringify(evt.payload, null, 2);
                return (
                  <div className="mt-2 relative">
                    <pre className="bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-[10px] text-[#7D8590] font-mono overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap break-all">
                      {json}
                    </pre>
                    <button
                      onClick={() => navigator.clipboard.writeText(json)}
                      className="absolute top-2 right-2 p-1 rounded text-[#484F58] hover:text-[#E6EDF3] hover:bg-[#1C2128] transition-colors"
                      title="Copy JSON"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </button>
                  </div>
                );
              })()}

              {/* Error message for latest errored event */}
              {events[0]?.status === "error" && events[0]?.errorMessage && (
                <div className="mt-2 bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-2 text-[10px] text-red-400 font-mono">
                  {events[0].errorMessage}
                </div>
              )}
            </div>
          )}

          {/* Stats row */}
          {stats && (
            <div className="flex items-center gap-4 pt-1 border-t border-[#1C2128]">
              <div>
                <p className="text-[9px] uppercase tracking-widest text-[#484F58]">Total fires</p>
                <p className="text-sm font-bold text-[#E6EDF3]">{stats.total}</p>
              </div>
              {stats.avgDurationMs != null && (
                <div>
                  <p className="text-[9px] uppercase tracking-widest text-[#484F58]">Avg duration</p>
                  <p className="text-sm font-bold text-[#E6EDF3]">{stats.avgDurationMs} ms</p>
                </div>
              )}
              <div className="flex-1">
                <p className="text-[9px] uppercase tracking-widest text-[#484F58] mb-1">Last 30 days</p>
                <Sparkline buckets={stats.dailyBuckets} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function TriggersPage({ defId }: { defId: number }) {
  const { fetchWithAuth } = useAuth();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [newType, setNewType] = useState<"schedule" | "webhook" | "event">("schedule");
  const [cronExpr, setCronExpr] = useState("0 9 * * 1");
  const [eventName, setEventName] = useState("");

  const [schedulePayloadMode, setSchedulePayloadMode] = useState<"static" | "per_record" | "batched">("static");
  const [staticPayload, setStaticPayload] = useState("{}");
  const [fanOutQuery, setFanOutQuery] = useState("SELECT id FROM clients WHERE active = true");
  const [staticPayloadError, setStaticPayloadError] = useState<string | null>(null);

  const { data: def } = useQuery<WfDefinition>({
    queryKey: ["wf-def", defId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/workflows/definitions/${defId}`);
      return res.json();
    },
  });

  const { data: triggers = [], isLoading } = useQuery<WfTrigger[]>({
    queryKey: ["wf-triggers", defId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/workflows/definitions/${defId}/triggers`);
      return res.json();
    },
  });

  const addMut = useMutation({
    mutationFn: async () => {
      let config: Record<string, unknown> = {};
      if (newType === "schedule") {
        config = { cron: cronExpr };
        if (schedulePayloadMode === "static") {
          try { config.payload = JSON.parse(staticPayload); } catch { throw new Error("Static payload is not valid JSON"); }
        } else if (schedulePayloadMode === "per_record") {
          config.fan_out_mode = "per_record";
          config.fan_out_query = fanOutQuery.trim();
        } else {
          config.fan_out_mode = "batched";
          config.fan_out_query = fanOutQuery.trim();
        }
      } else if (newType === "event") {
        config = { eventName };
      }
      const res = await fetchWithAuth(`/api/admin/workflows/definitions/${defId}/triggers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: newType, config }),
      });
      if (!res.ok) throw new Error("Failed to create trigger");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wf-triggers", defId] });
      setShowAdd(false);
    },
  });

  const webhookBase = `${window.location.origin}/api/webhooks/workflow`;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6">

        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/workflows/list")}
            className="text-[#7D8590] hover:text-[#E6EDF3] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-[#E6EDF3]">Triggers</h1>
            <p className="text-sm text-[#7D8590] mt-0.5">{def?.name ?? "Loading…"}</p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 bg-[#0078D4] hover:bg-[#006CBD] text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Trigger
          </button>
        </div>

        <div className="bg-[#0078D4]/5 border border-[#0078D4]/20 rounded-xl p-4 text-sm text-[#7D8590]">
          Triggers fire the <strong className="text-[#E6EDF3]">published</strong> version of this workflow.
          Publish a version in the Builder before activating triggers. Click any trigger to see its event history and statistics.
        </div>

        {/* Add dialog */}
        {showAdd && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowAdd(false)}>
            <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-6 max-w-md w-full space-y-4" onClick={e => e.stopPropagation()}>
              <h2 className="font-semibold text-[#E6EDF3]">Add Trigger</h2>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[#7D8590]">Type</label>
                <select
                  value={newType}
                  onChange={e => setNewType(e.target.value as typeof newType)}
                  className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] outline-none focus:border-[#0078D4]/60"
                >
                  <option value="schedule">📅 Schedule (cron)</option>
                  <option value="webhook">🔗 Webhook</option>
                  <option value="event">📡 Backend Event</option>
                </select>
              </div>

              {newType === "schedule" && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[#7D8590]">Cron Expression</label>
                    <input
                      value={cronExpr}
                      onChange={e => setCronExpr(e.target.value)}
                      placeholder="0 9 * * 1"
                      className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60 font-mono"
                    />
                    <p className="text-[10px] text-[#484F58]">Format: minute hour dom month dow — e.g. "0 9 * * 1" = 9am every Monday</p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[#7D8590]">Payload Mode</label>
                    <div className="flex gap-1">
                      {(["static", "per_record", "batched"] as const).map(mode => (
                        <button
                          key={mode}
                          onClick={() => setSchedulePayloadMode(mode)}
                          className={`flex-1 px-2 py-1.5 rounded-lg text-[10px] font-medium border transition-colors ${schedulePayloadMode === mode ? "bg-[#0078D4]/10 border-[#0078D4]/40 text-[#0078D4]" : "bg-[#0D1117] border-[#30363D] text-[#7D8590] hover:border-[#484F58]"}`}
                        >
                          {mode === "static" ? "Static" : mode === "per_record" ? "Per-Record" : "Batched"}
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] text-[#484F58]">
                      {schedulePayloadMode === "static"
                        ? "Fire one run with a fixed JSON payload each tick."
                        : schedulePayloadMode === "per_record"
                        ? "Run a SELECT; fire one workflow run per row."
                        : "Run a SELECT; fire one run with all rows as { records: [...] }."}
                    </p>
                  </div>

                  {schedulePayloadMode === "static" && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[#7D8590]">Payload (JSON)</label>
                      <textarea
                        rows={3}
                        value={staticPayload}
                        onChange={e => {
                          setStaticPayload(e.target.value);
                          try { JSON.parse(e.target.value); setStaticPayloadError(null); }
                          catch { setStaticPayloadError("Invalid JSON"); }
                        }}
                        className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60 font-mono resize-none"
                      />
                      {staticPayloadError && <p className="text-[10px] text-red-400">{staticPayloadError}</p>}
                    </div>
                  )}

                  {(schedulePayloadMode === "per_record" || schedulePayloadMode === "batched") && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[#7D8590]">
                        {schedulePayloadMode === "per_record" ? "Fan-Out Query (one run per row)" : "Batch Query (one run with all rows)"}
                      </label>
                      <textarea
                        rows={3}
                        value={fanOutQuery}
                        onChange={e => setFanOutQuery(e.target.value)}
                        className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60 font-mono resize-none"
                      />
                      <p className="text-[10px] text-amber-500/70">
                        {schedulePayloadMode === "per_record"
                          ? "Each row becomes an individual run payload. SELECT only, no semicolons."
                          : "All rows collected into { records: [...] } and sent as one run payload. SELECT only, no semicolons."}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {newType === "event" && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[#7D8590]">Event Name</label>
                  <input
                    value={eventName}
                    onChange={e => setEventName(e.target.value)}
                    placeholder="e.g. client.signed_contract"
                    className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60 font-mono"
                  />
                </div>
              )}

              {newType === "webhook" && (
                <div className="bg-[#0D1117] border border-[#30363D] rounded-lg p-3 text-xs text-[#7D8590]">
                  A unique webhook URL will be generated automatically after saving.
                </div>
              )}

              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-[#7D8590]">Cancel</button>
                <button
                  onClick={() => addMut.mutate()}
                  disabled={addMut.isPending}
                  className="px-4 py-2 bg-[#0078D4] hover:bg-[#006CBD] disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {addMut.isPending ? "Adding…" : "Add Trigger"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Triggers list */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2].map(i => <div key={i} className="h-24 bg-[#161B22] border border-[#30363D] rounded-xl animate-pulse" />)}
          </div>
        ) : triggers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-[#E6EDF3] font-medium">No triggers configured</p>
            <p className="text-sm text-[#7D8590] mt-1">Add a trigger to automate this workflow.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {triggers.map(t => (
              <TriggerCard
                key={t.id}
                t={t}
                defId={defId}
                webhookBase={webhookBase}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
