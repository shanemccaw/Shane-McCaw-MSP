import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Layers, Sparkles, ToggleLeft, Plus, Trash2, Pencil, Loader2, X } from "lucide-react";

// ─── Three distinct concepts, kept in their own sections (not conflated) ──────
// 1. Rule Groups (signal_rule_groups) — an AND/OR container of rules for one
//    signal. POST/PATCH/DELETE /admin/signal-rule-groups(/:id).
// 2. Custom Signals (custom_signals) — registers a brand-new signal key that
//    isn't hardcoded in TENANT_SIGNALS/ADJUSTMENT_SIGNALS. Just metadata; it
//    has no rules/logic of its own until groups/rules are attached to its key
//    (in section 1, or on the main Rules tab). GET/POST /admin/custom-signals,
//    DELETE /admin/custom-signals/:key.
// 3. Signal Enabled State — a global on/off switch per signal key, independent
//    of both of the above. GET /admin/signal-rules/adjustment-signals (the
//    adj:* pricing-adjustment subset, enriched with enabled) and GET
//    /admin/signal-rules/enabled-state (the raw flat map covering every signal
//    key in the system) are two different views over the SAME toggle store;
//    PATCH /admin/signal-rules/:signalKey/enabled flips it.

interface SignalIntelligenceFields {
  priority: number;
  weight: number;
  severity: string;
  category: string;
  pillar: string;
}

interface RuleGroup extends Partial<SignalIntelligenceFields> {
  id: number;
  signalKey: string;
  logic: "AND" | "OR";
  label: string | null;
  sortOrder: number;
}

interface CustomSignal {
  key: string;
  label: string;
  description: string;
  expectedImpact: string;
  isAdjustment: boolean;
}

interface AdjustmentSignal {
  key: string;
  label: string;
  description: string;
  expectedImpact: string;
  recommendedRules: unknown[];
  enabled: boolean;
}

const inputCls =
  "w-full border border-border bg-background text-foreground rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/60";
const selectCls = inputCls;
const btnPrimaryCls =
  "inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-lg disabled:opacity-40 transition-colors";
const btnGhostCls =
  "inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-foreground/90 text-xs font-semibold rounded-lg border border-border hover:border-primary/40 disabled:opacity-40 transition-colors";

interface GroupForm {
  signalKey: string;
  logic: "AND" | "OR";
  label: string;
  sortOrder: string;
  priority: string;
  weight: string;
  severity: string;
}

const emptyGroupForm = (signalKey = ""): GroupForm => ({
  signalKey,
  logic: "AND",
  label: "",
  sortOrder: "0",
  priority: "",
  weight: "",
  severity: "",
});

async function readErr(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  return (body as { error?: string } | null)?.error ?? fallback;
}

export default function RuleGroupsAndSignalsManager() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [signalKeys, setSignalKeys] = useState<string[]>([]);
  const [groups, setGroups] = useState<RuleGroup[]>([]);
  const [customSignals, setCustomSignals] = useState<CustomSignal[]>([]);
  const [adjustmentSignals, setAdjustmentSignals] = useState<AdjustmentSignal[]>([]);
  const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>({});

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [rulesRes, customRes, adjRes, enabledRes] = await Promise.all([
        fetchWithAuth("/api/admin/signal-rules"),
        fetchWithAuth("/api/admin/custom-signals"),
        fetchWithAuth("/api/admin/signal-rules/adjustment-signals"),
        fetchWithAuth("/api/admin/signal-rules/enabled-state"),
      ]);
      if (rulesRes.ok) {
        const data = (await rulesRes.json()) as { bySignal: Record<string, unknown>; groups: RuleGroup[] };
        setSignalKeys(Object.keys(data.bySignal).sort());
        setGroups(data.groups);
      }
      if (customRes.ok) setCustomSignals((await customRes.json()) as CustomSignal[]);
      if (adjRes.ok) setAdjustmentSignals((await adjRes.json()) as AdjustmentSignal[]);
      if (enabledRes.ok) setEnabledMap((await enabledRes.json()) as Record<string, boolean>);
    } catch {
      toast({ title: "Failed to load rule groups & signals" });
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, toast]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // ── Section 1: Rule Groups ───────────────────────────────────────────────

  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<RuleGroup | null>(null);
  const [groupForm, setGroupForm] = useState<GroupForm>(emptyGroupForm());
  const [groupSaving, setGroupSaving] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);

  const openCreateGroup = () => {
    setEditingGroup(null);
    setGroupForm(emptyGroupForm(signalKeys[0] ?? ""));
    setGroupError(null);
    setGroupModalOpen(true);
  };

  const openEditGroup = (group: RuleGroup) => {
    setEditingGroup(group);
    setGroupForm({
      signalKey: group.signalKey,
      logic: group.logic,
      label: group.label ?? "",
      sortOrder: String(group.sortOrder),
      priority: group.priority != null ? String(group.priority) : "",
      weight: group.weight != null ? String(group.weight) : "",
      severity: group.severity ?? "",
    });
    setGroupError(null);
    setGroupModalOpen(true);
  };

  const submitGroup = async () => {
    if (!groupForm.signalKey.trim() || !groupForm.logic) {
      setGroupError("Signal key and logic are required");
      return;
    }
    setGroupSaving(true);
    setGroupError(null);
    try {
      const body: Record<string, unknown> = {
        logic: groupForm.logic,
        label: groupForm.label.trim() || null,
        sortOrder: Number(groupForm.sortOrder) || 0,
      };
      if (groupForm.priority.trim() !== "") body.priority = Number(groupForm.priority);
      if (groupForm.weight.trim() !== "") body.weight = Number(groupForm.weight);
      if (groupForm.severity.trim() !== "") body.severity = groupForm.severity.trim();

      const res = editingGroup
        ? await fetchWithAuth(`/api/admin/signal-rule-groups/${editingGroup.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetchWithAuth("/api/admin/signal-rule-groups", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ signalKey: groupForm.signalKey.trim(), ...body }),
          });
      if (!res.ok) {
        setGroupError(await readErr(res, "Failed to save group"));
        return;
      }
      setGroupModalOpen(false);
      await loadAll();
      toast({ title: editingGroup ? "Group updated" : "Group created" });
    } catch {
      setGroupError("Failed to save group");
    } finally {
      setGroupSaving(false);
    }
  };

  const deleteGroup = async (group: RuleGroup) => {
    if (!confirm(`Delete group "${group.label ?? `#${group.id}`}"? Member rules become ungrouped, not deleted.`)) return;
    try {
      const res = await fetchWithAuth(`/api/admin/signal-rule-groups/${group.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await readErr(res, "Failed to delete group"));
      await loadAll();
      toast({ title: "Group deleted" });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Failed to delete group" });
    }
  };

  // ── Section 2: Custom Signals ────────────────────────────────────────────

  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [customForm, setCustomForm] = useState({ key: "", label: "", description: "", expectedImpact: "", isAdjustment: false });
  const [customSaving, setCustomSaving] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);

  const submitCustomSignal = async () => {
    if (!customForm.key.trim() || !customForm.label.trim()) {
      setCustomError("Key and label are required");
      return;
    }
    setCustomSaving(true);
    setCustomError(null);
    try {
      const res = await fetchWithAuth("/api/admin/custom-signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(customForm),
      });
      if (!res.ok) {
        setCustomError(await readErr(res, "Failed to create custom signal"));
        return;
      }
      setCustomModalOpen(false);
      setCustomForm({ key: "", label: "", description: "", expectedImpact: "", isAdjustment: false });
      await loadAll();
      toast({ title: "Custom signal saved" });
    } catch {
      setCustomError("Failed to create custom signal");
    } finally {
      setCustomSaving(false);
    }
  };

  const deleteCustomSignal = async (key: string) => {
    if (!confirm(`Delete custom signal "${key}"? This also deletes any rule groups/rules keyed to it.`)) return;
    try {
      const res = await fetchWithAuth(`/api/admin/custom-signals/${encodeURIComponent(key)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await readErr(res, "Failed to delete custom signal"));
      await loadAll();
      toast({ title: "Custom signal deleted" });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Failed to delete custom signal" });
    }
  };

  // ── Section 3: Enabled State ─────────────────────────────────────────────

  const toggleEnabled = async (signalKey: string, next: boolean) => {
    setEnabledMap(prev => ({ ...prev, [signalKey]: next }));
    try {
      const res = await fetchWithAuth(`/api/admin/signal-rules/${encodeURIComponent(signalKey)}/enabled`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) throw new Error(await readErr(res, "Failed to update signal state"));
      await loadAll();
    } catch (err) {
      setEnabledMap(prev => ({ ...prev, [signalKey]: !next }));
      toast({ title: err instanceof Error ? err.message : "Failed to update signal state" });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading rule groups & signals…
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* ── Section 1: Rule Groups ── */}
      <section className="space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-foreground text-sm font-semibold flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              Rule Groups
            </h2>
            <p className="text-muted-foreground text-xs mt-1 max-w-2xl">
              An AND/OR container of rules for one signal. Deleting a group ungroups its member rules — it does not
              delete them.
            </p>
          </div>
          <button onClick={openCreateGroup} className={btnPrimaryCls}>
            <Plus className="h-3.5 w-3.5" /> New Group
          </button>
        </div>

        {groups.length === 0 ? (
          <div className="px-4 py-3 text-xs italic text-muted-foreground/70 bg-card border border-border rounded-lg">
            No rule groups yet.
          </div>
        ) : (
          <div className="bg-card border border-border rounded-lg overflow-hidden divide-y divide-border/60">
            {groups.map(group => (
              <div key={group.id} className="flex items-center gap-3 px-4 py-2.5 group">
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wider ${
                    group.logic === "AND"
                      ? "bg-amber-400/10 text-amber-400 border border-amber-400/25"
                      : "bg-emerald-400/10 text-emerald-400 border border-emerald-400/25"
                  }`}
                >
                  {group.logic}
                </span>
                <span className="font-mono text-xs text-foreground/90">{group.signalKey}</span>
                <span className="text-xs text-muted-foreground truncate">{group.label ?? `Group #${group.id}`}</span>
                <span className="text-[11px] text-muted-foreground/60 ml-auto shrink-0">#{group.sortOrder}</span>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button onClick={() => openEditGroup(group)} className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent" title="Edit group">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => void deleteGroup(group)} className="rounded p-1 text-muted-foreground hover:text-red-400 hover:bg-accent" title="Delete group">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Section 2: Custom Signal Definitions ── */}
      <section className="space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-foreground text-sm font-semibold flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Custom Signal Definitions
            </h2>
            <p className="text-muted-foreground text-xs mt-1 max-w-2xl">
              Registers a brand-new signal key not built into the platform. A custom signal has no logic of its own
              until rules or a rule group above are attached to its key.
            </p>
          </div>
          <button onClick={() => { setCustomForm({ key: "", label: "", description: "", expectedImpact: "", isAdjustment: false }); setCustomError(null); setCustomModalOpen(true); }} className={btnPrimaryCls}>
            <Plus className="h-3.5 w-3.5" /> New Custom Signal
          </button>
        </div>

        {customSignals.length === 0 ? (
          <div className="px-4 py-3 text-xs italic text-muted-foreground/70 bg-card border border-border rounded-lg">
            No custom signals defined yet.
          </div>
        ) : (
          <div className="bg-card border border-border rounded-lg overflow-hidden divide-y divide-border/60">
            {customSignals.map(sig => (
              <div key={sig.key} className="flex items-center gap-3 px-4 py-2.5 group">
                <span className="font-mono text-xs text-foreground/90">{sig.key}</span>
                <span className="text-xs text-muted-foreground truncate">{sig.label}</span>
                {sig.isAdjustment && (
                  <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold bg-blue-900/30 text-blue-400">adjustment</span>
                )}
                <button
                  onClick={() => void deleteCustomSignal(sig.key)}
                  className="ml-auto shrink-0 rounded p-1 text-muted-foreground hover:text-red-400 hover:bg-accent opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Delete custom signal"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Section 3: Signal Enabled State ── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-foreground text-sm font-semibold flex items-center gap-2">
            <ToggleLeft className="h-4 w-4 text-primary" />
            Signal Enabled State
          </h2>
          <p className="text-muted-foreground text-xs mt-1 max-w-2xl">
            Whether a signal participates in evaluation at all — independent of its rules/groups. A signal with no
            row here defaults to enabled.
          </p>
        </div>

        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-2 border-b border-border text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
            Adjustment Signals (pricing-impact)
          </div>
          {adjustmentSignals.length === 0 ? (
            <div className="px-4 py-3 text-xs italic text-muted-foreground/70">No adjustment signals.</div>
          ) : (
            <div className="divide-y divide-border/60">
              {adjustmentSignals.map(sig => (
                <div key={sig.key} className="flex items-center gap-3 px-4 py-2 text-xs">
                  <span className="font-mono text-foreground/90">{sig.key}</span>
                  <span className="text-muted-foreground truncate">{sig.label}</span>
                  <button
                    onClick={() => void toggleEnabled(sig.key, !sig.enabled)}
                    className={`ml-auto shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      sig.enabled
                        ? "bg-emerald-400/10 text-emerald-400 border border-emerald-400/25"
                        : "bg-border text-muted-foreground border border-border"
                    }`}
                  >
                    {sig.enabled ? "Enabled" : "Disabled"}
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="px-4 py-2 border-t border-b border-border text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
            All Signals
          </div>
          <div className="divide-y divide-border/60 max-h-72 overflow-y-auto">
            {signalKeys.map(key => {
              const enabled = enabledMap[key] ?? true;
              return (
                <div key={key} className="flex items-center gap-3 px-4 py-2 text-xs">
                  <span className="font-mono text-foreground/90">{key}</span>
                  <button
                    onClick={() => void toggleEnabled(key, !enabled)}
                    className={`ml-auto shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      enabled
                        ? "bg-emerald-400/10 text-emerald-400 border border-emerald-400/25"
                        : "bg-border text-muted-foreground border border-border"
                    }`}
                  >
                    {enabled ? "Enabled" : "Disabled"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Group create/edit modal ── */}
      {groupModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card border border-border rounded-lg w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">{editingGroup ? "Edit Group" : "New Rule Group"}</h3>
              <button onClick={() => setGroupModalOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-muted-foreground">Signal key</label>
              <input
                className={inputCls}
                list="rule-groups-signal-keys"
                value={groupForm.signalKey}
                disabled={!!editingGroup}
                onChange={e => setGroupForm(f => ({ ...f, signalKey: e.target.value }))}
                placeholder="e.g. hasSecurityGaps"
              />
              <datalist id="rule-groups-signal-keys">
                {signalKeys.map(k => <option key={k} value={k} />)}
              </datalist>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-muted-foreground">Logic</label>
                <select className={selectCls} value={groupForm.logic} onChange={e => setGroupForm(f => ({ ...f, logic: e.target.value as "AND" | "OR" }))}>
                  <option value="AND">AND</option>
                  <option value="OR">OR</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-muted-foreground">Sort order</label>
                <input className={inputCls} type="number" value={groupForm.sortOrder} onChange={e => setGroupForm(f => ({ ...f, sortOrder: e.target.value }))} />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-muted-foreground">Label</label>
              <input className={inputCls} value={groupForm.label} onChange={e => setGroupForm(f => ({ ...f, label: e.target.value }))} placeholder="Optional display label" />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-muted-foreground">Priority</label>
                <input className={inputCls} type="number" value={groupForm.priority} onChange={e => setGroupForm(f => ({ ...f, priority: e.target.value }))} placeholder="0" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-muted-foreground">Weight</label>
                <input className={inputCls} type="number" value={groupForm.weight} onChange={e => setGroupForm(f => ({ ...f, weight: e.target.value }))} placeholder="0" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-muted-foreground">Severity</label>
                <select className={selectCls} value={groupForm.severity} onChange={e => setGroupForm(f => ({ ...f, severity: e.target.value }))}>
                  <option value="">(default)</option>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                  <option value="critical">critical</option>
                </select>
              </div>
            </div>

            {groupError && <p className="text-xs text-red-400">{groupError}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setGroupModalOpen(false)} className={btnGhostCls}>Cancel</button>
              <button onClick={() => void submitGroup()} disabled={groupSaving} className={btnPrimaryCls}>
                {groupSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {editingGroup ? "Save" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Custom signal create modal ── */}
      {customModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card border border-border rounded-lg w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">New Custom Signal</h3>
              <button onClick={() => setCustomModalOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-muted-foreground">Key</label>
              <input className={inputCls} value={customForm.key} onChange={e => setCustomForm(f => ({ ...f, key: e.target.value }))} placeholder="e.g. hasUnusualLoginPattern" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-muted-foreground">Label</label>
              <input className={inputCls} value={customForm.label} onChange={e => setCustomForm(f => ({ ...f, label: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-muted-foreground">Description</label>
              <textarea className={`${inputCls} h-20 resize-y`} value={customForm.description} onChange={e => setCustomForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-muted-foreground">Expected impact</label>
              <input className={inputCls} value={customForm.expectedImpact} onChange={e => setCustomForm(f => ({ ...f, expectedImpact: e.target.value }))} />
            </div>
            <label className="flex items-center gap-2 text-xs text-foreground/90">
              <input type="checkbox" checked={customForm.isAdjustment} onChange={e => setCustomForm(f => ({ ...f, isAdjustment: e.target.checked }))} />
              Pricing-adjustment signal
            </label>

            {customError && <p className="text-xs text-red-400">{customError}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setCustomModalOpen(false)} className={btnGhostCls}>Cancel</button>
              <button onClick={() => void submitCustomSignal()} disabled={customSaving} className={btnPrimaryCls}>
                {customSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
