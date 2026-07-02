import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { format } from "date-fns";

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

export default function TriggersPage({ defId }: { defId: number }) {
  const { fetchWithAuth } = useAuth();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [newType, setNewType] = useState<"schedule" | "webhook" | "event">("schedule");
  const [cronExpr, setCronExpr] = useState("0 9 * * 1");
  const [eventName, setEventName] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);

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
      const config: Record<string, unknown> =
        newType === "schedule" ? { cron: cronExpr }
        : newType === "event" ? { eventName }
        : {};
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

  const toggleMut = useMutation({
    mutationFn: async ({ id, enabled }: { id: number; enabled: boolean }) => {
      const res = await fetchWithAuth(`/api/admin/workflows/definitions/${defId}/triggers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wf-triggers", defId] }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetchWithAuth(`/api/admin/workflows/definitions/${defId}/triggers/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wf-triggers", defId] });
      setDeleteId(null);
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

        {/* Info box */}
        <div className="bg-[#0078D4]/5 border border-[#0078D4]/20 rounded-xl p-4 text-sm text-[#7D8590]">
          Triggers fire the <strong className="text-[#E6EDF3]">published</strong> version of this workflow.
          Publish a version in the Builder before activating triggers.
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

        {/* Delete confirm */}
        {deleteId !== null && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setDeleteId(null)}>
            <div className="bg-[#161B22] border border-red-500/30 rounded-xl p-6 max-w-sm w-full space-y-4" onClick={e => e.stopPropagation()}>
              <h2 className="font-semibold text-[#E6EDF3]">Delete Trigger</h2>
              <p className="text-sm text-[#7D8590]">This will remove the trigger permanently.</p>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setDeleteId(null)} className="px-4 py-2 text-sm text-[#7D8590]">Cancel</button>
                <button
                  onClick={() => deleteMut.mutate(deleteId)}
                  disabled={deleteMut.isPending}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
                >
                  {deleteMut.isPending ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Triggers list */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2].map(i => <div key={i} className="h-20 bg-[#161B22] border border-[#30363D] rounded-xl animate-pulse" />)}
          </div>
        ) : triggers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-[#E6EDF3] font-medium">No triggers configured</p>
            <p className="text-sm text-[#7D8590] mt-1">Add a trigger to automate this workflow.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {triggers.map(t => (
              <div key={t.id} className={`bg-[#161B22] border rounded-xl p-4 space-y-2 transition-colors ${t.enabled ? "border-[#30363D]" : "border-[#30363D]/50 opacity-60"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{TRIGGER_ICONS[t.type]}</span>
                    <div>
                      <p className="text-sm font-semibold text-[#E6EDF3] capitalize">{t.type} Trigger</p>
                      <p className="text-xs text-[#7D8590]">{TRIGGER_DESCRIPTIONS[t.type]}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => toggleMut.mutate({ id: t.id, enabled: !t.enabled })}
                      disabled={toggleMut.isPending}
                      className={`px-2.5 py-1 text-[10px] font-semibold rounded-full border transition-colors ${
                        t.enabled
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20"
                          : "bg-[#1C2128] text-[#7D8590] border-[#30363D] hover:border-[#484F58]"
                      }`}
                    >
                      {t.enabled ? "Enabled" : "Disabled"}
                    </button>
                    <button
                      onClick={() => setDeleteId(t.id)}
                      className="p-1.5 text-[#484F58] hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>

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
                      onClick={() => navigator.clipboard.writeText(`${webhookBase}/${t.webhookToken}`)}
                      className="flex-shrink-0 p-2 text-[#484F58] hover:text-[#E6EDF3] hover:bg-[#1C2128] rounded-lg border border-[#30363D] transition-colors"
                      title="Copy URL"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </button>
                  </div>
                )}

                {t.type === "event" && (
                  <div className="text-xs text-[#484F58] font-mono bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2">
                    event: <span className="text-[#E6EDF3]">{(t.config.eventName as string) ?? "—"}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
