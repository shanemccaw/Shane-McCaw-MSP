import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { KanbanCardModalTask } from "@/components/KanbanCardModal";
import type { DiscoveryMetadata } from "@/components/kanban/TypedCardContent";

const RISK_PILL: Record<string, { cls: string; label: string }> = {
  low:      { cls: "bg-green-100 text-green-700",   label: "Low Risk" },
  medium:   { cls: "bg-orange-100 text-orange-700", label: "Medium Risk" },
  high:     { cls: "bg-red-100 text-red-700",       label: "High Risk" },
  critical: { cls: "bg-red-200 text-red-900",       label: "Critical Risk" },
};

function getInitials(name: string): string {
  return name.trim().split(/\s+/).map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

interface Props {
  task: KanbanCardModalTask;
  open: boolean;
  onClose: () => void;
  mode?: "client" | "admin";
  onUpdate?: (updated: KanbanCardModalTask) => void;
}

export function DiscoveryCardModal({ task, open, onClose, mode = "client", onUpdate }: Props) {
  const meta = (task.taskMetadata ?? {}) as DiscoveryMetadata;
  const [checked, setChecked] = useState<Record<number, boolean>>({});

  const recs       = meta.recommendations ?? [];
  const alerts     = meta.criticalAlerts  ?? [];
  const log        = meta.activityLog     ?? [];
  const score      = meta.vulnerabilityScore;
  const riskCfg    = meta.riskScore ? RISK_PILL[meta.riskScore] : null;

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-6xl max-h-[921px] p-0 overflow-hidden flex flex-col [&>button]:hidden">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="px-8 py-6 border-b border-gray-100 flex justify-between items-start flex-shrink-0">
          <div className="space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="bg-pink-100 text-pink-700 px-3 py-1 rounded-full text-xs font-bold">
                Discovery
              </span>
              {riskCfg && (
                <span className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold ${riskCfg.cls}`}>
                  <span className="material-symbols-outlined" style={{ fontSize: "13px" }}>warning</span>
                  {riskCfg.label}
                </span>
              )}
            </div>
            <h2 className="text-xl font-bold text-[#0A2540] leading-snug">{task.title}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors text-muted-foreground flex-shrink-0 mt-1"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        {/* ── Two-column body ─────────────────────────────────────────────── */}
        <div className="flex flex-col md:flex-row flex-grow overflow-hidden min-h-0">

          {/* Left — scrollable main content */}
          <div className="flex-1 overflow-y-auto p-8 space-y-10">

            {/* Initial Tenant Analysis */}
            {meta.findingsSummary && (
              <section>
                <h3 className="text-base font-bold text-[#0A2540] mb-4 flex items-center gap-2">
                  <span className="material-symbols-outlined text-teal-600" style={{ fontSize: "20px" }}>analytics</span>
                  Initial Tenant Analysis
                </h3>
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 text-sm text-gray-700 leading-relaxed">
                  {meta.findingsSummary}
                </div>
              </section>
            )}

            {/* Critical Alerts */}
            {alerts.length > 0 && (
              <section>
                <h3 className="text-base font-bold text-[#0A2540] mb-4 flex items-center gap-2">
                  <span className="material-symbols-outlined text-red-500" style={{ fontSize: "20px" }}>priority_high</span>
                  Critical Alerts
                </h3>
                <div className="space-y-3">
                  {alerts.map((alert, i) => {
                    const isCrit = alert.severity !== "warning";
                    return (
                      <div
                        key={i}
                        className={`flex items-start gap-4 p-4 rounded-lg border ${isCrit ? "bg-red-50/60 border-red-100" : "bg-orange-50/60 border-orange-100"}`}
                      >
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white flex-shrink-0 ${isCrit ? "bg-red-500" : "bg-orange-500"}`}>
                          <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>
                            {isCrit ? "person_off" : "warning"}
                          </span>
                        </div>
                        <div>
                          <p className={`font-bold text-sm ${isCrit ? "text-red-900" : "text-orange-900"}`}>{alert.title}</p>
                          {alert.description && (
                            <p className="text-xs text-gray-600 mt-0.5 leading-snug">{alert.description}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Recommended Next Steps */}
            {recs.length > 0 && (
              <section>
                <h3 className="text-base font-bold text-[#0A2540] mb-4">Recommended Next Steps</h3>
                <div className="space-y-2">
                  {recs.map((rec, i) => {
                    const isChecked = !!checked[i];
                    return (
                      <label
                        key={i}
                        className={`flex items-center gap-3 p-4 border rounded-lg cursor-pointer transition-colors ${isChecked ? "bg-teal-50 border-teal-200" : "border-gray-200 hover:bg-gray-50"}`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={e => setChecked(c => ({ ...c, [i]: e.target.checked }))}
                          className="w-4 h-4 rounded border-gray-300 accent-teal-600 flex-shrink-0"
                        />
                        <span className={`text-sm ${isChecked ? "line-through text-muted-foreground" : "text-[#0A2540]"}`}>
                          {rec}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Risk Assessment */}
            {score !== undefined && (
              <section>
                <h3 className="text-base font-bold text-[#0A2540] mb-4">Risk Assessment</h3>
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-5">
                  <div className="flex justify-between items-end mb-3">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                      Overall Vulnerability
                    </span>
                    <span className="text-xl font-bold text-orange-600">{score}/100</span>
                  </div>
                  <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min(100, Math.max(0, score))}%`,
                        background: "linear-gradient(90deg, #14b8a6 0%, #f97316 100%)",
                      }}
                    />
                  </div>
                  <p className="mt-3 text-xs text-gray-500 italic">
                    *Calculated based on current security score and active discovery findings.
                  </p>
                </div>
              </section>
            )}

            {/* Fallback when no content */}
            {!meta.findingsSummary && alerts.length === 0 && recs.length === 0 && score === undefined && (
              <p className="text-sm text-muted-foreground italic">No discovery analysis data yet.</p>
            )}
          </div>

          {/* Right — sidebar */}
          <aside className="w-full md:w-80 bg-[#F7F9FC] border-t md:border-t-0 md:border-l border-gray-100 overflow-y-auto p-8 flex-shrink-0">
            <div className="space-y-8">

              {/* Assigned To */}
              {task.assignedTo && (
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block mb-4">Assigned To</span>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-[#0078D4] text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                      {getInitials(task.assignedTo)}
                    </div>
                    <div>
                      <p className="font-bold text-sm text-[#0A2540] leading-tight">{task.assignedTo}</p>
                      {meta.assignedToRole && (
                        <p className="text-xs text-gray-500 mt-0.5">{meta.assignedToRole}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Due Date */}
              {task.dueDate && (
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block mb-4">Due Date</span>
                  <div className="flex items-center gap-2 text-[#0A2540]">
                    <span className="material-symbols-outlined text-gray-400" style={{ fontSize: "18px" }}>calendar_today</span>
                    <span className="font-bold text-sm">
                      {new Date(task.dueDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                    </span>
                  </div>
                </div>
              )}

              {/* Activity Log */}
              {log.length > 0 && (
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block mb-6">Activity Log</span>
                  <div className="relative space-y-7 before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-[2px] before:bg-gray-200">
                    {log.map((entry, i) => {
                      const dotCls =
                        entry.type === "error"   ? "bg-red-500" :
                        entry.type === "primary" ? "bg-[#0A2540]" :
                                                   "bg-gray-300";
                      return (
                        <div key={i} className="relative pl-8">
                          <div className={`absolute left-0 top-1 w-6 h-6 rounded-full border-4 border-[#F7F9FC] z-10 ${dotCls}`} />
                          <p className="text-sm font-bold text-[#0A2540] leading-snug">{entry.event}</p>
                          {entry.detail && (
                            <p className="text-xs text-gray-600 mt-0.5 leading-snug">{entry.detail}</p>
                          )}
                          <p className="text-[10px] text-gray-400 mt-0.5">{entry.timestamp}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className={`space-y-3 ${log.length > 0 || task.dueDate || task.assignedTo ? "pt-6 border-t border-gray-200" : ""}`}>
                {mode === "admin" && onUpdate && (
                  <button
                    onClick={() => onUpdate(task)}
                    className="w-full py-3 bg-[#0A2540] text-white rounded-lg text-sm font-bold hover:bg-[#0A2540]/90 transition-colors"
                  >
                    Update Assessment
                  </button>
                )}
                <button
                  onClick={() => { if (meta.assessmentUrl) window.open(meta.assessmentUrl, "_blank"); }}
                  disabled={!meta.assessmentUrl}
                  className="w-full py-3 bg-white text-[#0A2540] border border-gray-300 rounded-lg text-sm font-bold hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Export PDF Report
                </button>
              </div>
            </div>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}
