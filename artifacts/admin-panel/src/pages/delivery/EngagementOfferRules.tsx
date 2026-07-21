import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, Plus, Pencil, Loader2, X, ChevronDown, ChevronRight, History } from "lucide-react";

// engagement_offer_rules (lib/db/src/schema/index.ts) — fires a discount offer
// event when a lead's session crosses the configured page-view/intent-score
// thresholds within windowMinutes, gated by cooldownMinutes per lead. Firings
// (engagement_offer_firings) are the audit trail proving the engine actually ran.

interface EngagementOfferRule {
  id: number;
  mspId: number | null;
  name: string;
  minDistinctPagesViewed: number;
  minIntentScore: number;
  windowMinutes: number;
  eligibleServiceIds: number[];
  discountPct: number;
  eventName: string;
  cooldownMinutes: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface OfferFiring {
  id: number;
  ruleId: number;
  leadId: number | null;
  firedAt: string;
}

interface RuleForm {
  name: string;
  minDistinctPagesViewed: string;
  minIntentScore: string;
  windowMinutes: string;
  discountPct: string;
  eventName: string;
  cooldownMinutes: string;
  eligibleServiceIds: string;
}

const emptyForm: RuleForm = {
  name: "",
  minDistinctPagesViewed: "3",
  minIntentScore: "15",
  windowMinutes: "30",
  discountPct: "10",
  eventName: "",
  cooldownMinutes: "1440",
  eligibleServiceIds: "",
};

const formFromRule = (rule: EngagementOfferRule): RuleForm => ({
  name: rule.name,
  minDistinctPagesViewed: String(rule.minDistinctPagesViewed),
  minIntentScore: String(rule.minIntentScore),
  windowMinutes: String(rule.windowMinutes),
  discountPct: String(rule.discountPct),
  eventName: rule.eventName,
  cooldownMinutes: String(rule.cooldownMinutes),
  eligibleServiceIds: rule.eligibleServiceIds.join(", "),
});

function parseServiceIds(raw: string): number[] {
  return raw
    .split(",")
    .map(s => s.trim())
    .filter(s => s !== "")
    .map(Number)
    .filter(n => Number.isFinite(n));
}

const inputCls =
  "w-full border border-border bg-background text-foreground rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/60";
const btnPrimaryCls =
  "inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-lg disabled:opacity-40 transition-colors";
const btnGhostCls =
  "inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-foreground/90 text-xs font-semibold rounded-lg border border-border hover:border-primary/40 disabled:opacity-40 transition-colors";

async function readErr(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  return (body as { error?: string } | null)?.error ?? fallback;
}

export default function EngagementOfferRules() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [rules, setRules] = useState<EngagementOfferRule[]>([]);

  const loadRules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/admin/engagement-offers/rules");
      if (!res.ok) throw new Error(await readErr(res, "Failed to load engagement offer rules"));
      const data = await res.json();
      setRules(Array.isArray(data) ? data : (data.rules ?? []));
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Failed to load engagement offer rules" });
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, toast]);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  // ── Create / edit modal ──────────────────────────────────────────────────

  const [modalOpen, setModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<EngagementOfferRule | null>(null);
  const [form, setForm] = useState<RuleForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const openCreate = () => {
    setEditingRule(null);
    setForm(emptyForm);
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (rule: EngagementOfferRule) => {
    setEditingRule(rule);
    setForm(formFromRule(rule));
    setFormError(null);
    setModalOpen(true);
  };

  const submitForm = async () => {
    if (!form.name.trim() || !form.eventName.trim()) {
      setFormError("Name and event name are required");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        minDistinctPagesViewed: Number(form.minDistinctPagesViewed) || 0,
        minIntentScore: Number(form.minIntentScore) || 0,
        windowMinutes: Number(form.windowMinutes) || 0,
        discountPct: Number(form.discountPct) || 0,
        eventName: form.eventName.trim(),
        cooldownMinutes: Number(form.cooldownMinutes) || 0,
        eligibleServiceIds: parseServiceIds(form.eligibleServiceIds),
      };
      const res = editingRule
        ? await fetchWithAuth(`/api/admin/engagement-offers/rules/${editingRule.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetchWithAuth("/api/admin/engagement-offers/rules", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
      if (!res.ok) {
        setFormError(await readErr(res, "Failed to save rule"));
        return;
      }
      setModalOpen(false);
      await loadRules();
      toast({ title: editingRule ? "Rule updated" : "Rule created" });
    } catch {
      setFormError("Failed to save rule");
    } finally {
      setSaving(false);
    }
  };

  // ── isActive toggle — optimistic, revert on error ────────────────────────

  const toggleActive = async (rule: EngagementOfferRule) => {
    const next = !rule.isActive;
    setRules(prev => prev.map(r => (r.id === rule.id ? { ...r, isActive: next } : r)));
    try {
      const res = await fetchWithAuth(`/api/admin/engagement-offers/rules/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: next }),
      });
      if (!res.ok) throw new Error(await readErr(res, "Failed to update rule"));
    } catch (err) {
      setRules(prev => prev.map(r => (r.id === rule.id ? { ...r, isActive: !next } : r)));
      toast({ title: err instanceof Error ? err.message : "Failed to update rule" });
    }
  };

  // ── Recent firings, lazy-loaded per rule on expand ───────────────────────

  const [expandedRuleId, setExpandedRuleId] = useState<number | null>(null);
  const [firingsByRule, setFiringsByRule] = useState<Record<number, OfferFiring[]>>({});
  const [firingsLoading, setFiringsLoading] = useState<number | null>(null);

  const toggleFirings = async (rule: EngagementOfferRule) => {
    if (expandedRuleId === rule.id) {
      setExpandedRuleId(null);
      return;
    }
    setExpandedRuleId(rule.id);
    if (firingsByRule[rule.id]) return;
    setFiringsLoading(rule.id);
    try {
      const res = await fetchWithAuth(`/api/admin/engagement-offers/rules/${rule.id}/firings`);
      if (!res.ok) throw new Error(await readErr(res, "Failed to load firings"));
      const data = await res.json();
      setFiringsByRule(prev => ({ ...prev, [rule.id]: Array.isArray(data) ? data : (data.firings ?? []) }));
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Failed to load firings" });
    } finally {
      setFiringsLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2 text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading engagement offer rules…
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-foreground text-xl font-semibold flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Engagement Offer Rules
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Fires a discount offer event when a lead's session crosses the configured page-view/intent-score
            thresholds within the time window, gated by a per-lead cooldown.
          </p>
        </div>
        <button onClick={openCreate} className={btnPrimaryCls}>
          <Plus className="h-3.5 w-3.5" /> New Rule
        </button>
      </div>

      {rules.length === 0 ? (
        <div className="px-4 py-3 text-xs italic text-muted-foreground/70 bg-card border border-border rounded-lg">
          No engagement offer rules yet.
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-hidden divide-y divide-border/60">
          {rules.map(rule => {
            const expanded = expandedRuleId === rule.id;
            const firings = firingsByRule[rule.id];
            return (
              <div key={rule.id}>
                <div className="flex items-center gap-3 px-4 py-2.5 group">
                  <button
                    onClick={() => void toggleFirings(rule)}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    title="Show recent firings"
                  >
                    {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  </button>
                  <span className="text-sm font-medium text-foreground truncate">{rule.name}</span>
                  <span className="font-mono text-[11px] text-muted-foreground shrink-0">{rule.eventName}</span>
                  <span className="text-[11px] text-muted-foreground shrink-0">
                    {rule.minDistinctPagesViewed} pages · intent ≥{rule.minIntentScore} · {rule.windowMinutes}m window
                  </span>
                  <span className="text-[11px] text-emerald-400 font-semibold shrink-0">{rule.discountPct}% off</span>
                  <span className="text-[11px] text-muted-foreground shrink-0">cooldown {rule.cooldownMinutes}m</span>
                  <span className="text-[11px] text-muted-foreground shrink-0">
                    {rule.eligibleServiceIds.length} service{rule.eligibleServiceIds.length !== 1 ? "s" : ""}
                  </span>
                  <div className="ml-auto flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => void toggleActive(rule)}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                        rule.isActive
                          ? "bg-emerald-400/10 text-emerald-400 border border-emerald-400/25"
                          : "bg-border text-muted-foreground border border-border"
                      }`}
                    >
                      {rule.isActive ? "Enabled" : "Disabled"}
                    </button>
                    <button
                      onClick={() => openEdit(rule)}
                      className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Edit rule"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {expanded && (
                  <div className="px-4 pb-3 pl-11">
                    <div className="rounded-lg border border-border bg-background/40 p-3">
                      <div className="flex items-center gap-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                        <History className="h-3.5 w-3.5" /> Recent Firings
                      </div>
                      {firingsLoading === rule.id ? (
                        <div className="flex items-center gap-2 text-muted-foreground text-xs">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading firings…
                        </div>
                      ) : !firings || firings.length === 0 ? (
                        <p className="text-xs italic text-muted-foreground/70">No firings yet — this rule hasn't triggered.</p>
                      ) : (
                        <div className="space-y-1">
                          {firings.map(f => (
                            <div key={f.id} className="flex items-center gap-3 text-xs">
                              <span className="text-foreground/90">
                                {f.leadId != null ? `Lead #${f.leadId}` : "Anonymous lead"}
                              </span>
                              <span className="text-muted-foreground/60 ml-auto">
                                {new Date(f.firedAt).toLocaleString()}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Create/edit modal ── */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card border border-border rounded-lg w-full max-w-md p-5 space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">{editingRule ? "Edit Rule" : "New Engagement Offer Rule"}</h3>
              <button onClick={() => setModalOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-muted-foreground">Name</label>
              <input className={inputCls} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. High-intent monitoring discount" />
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-muted-foreground">Event name</label>
              <input className={inputCls} value={form.eventName} onChange={e => setForm(f => ({ ...f, eventName: e.target.value }))} placeholder="e.g. offer.monitoring_discount" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-muted-foreground">Min distinct pages viewed</label>
                <input className={inputCls} type="number" value={form.minDistinctPagesViewed} onChange={e => setForm(f => ({ ...f, minDistinctPagesViewed: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-muted-foreground">Min intent score</label>
                <input className={inputCls} type="number" value={form.minIntentScore} onChange={e => setForm(f => ({ ...f, minIntentScore: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-muted-foreground">Window (minutes)</label>
                <input className={inputCls} type="number" value={form.windowMinutes} onChange={e => setForm(f => ({ ...f, windowMinutes: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-muted-foreground">Cooldown (minutes)</label>
                <input className={inputCls} type="number" value={form.cooldownMinutes} onChange={e => setForm(f => ({ ...f, cooldownMinutes: e.target.value }))} />
              </div>
              <div className="space-y-1.5 col-span-2">
                <label className="text-[11px] font-medium text-muted-foreground">Discount %</label>
                <input className={inputCls} type="number" value={form.discountPct} onChange={e => setForm(f => ({ ...f, discountPct: e.target.value }))} />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-muted-foreground">Eligible service IDs</label>
              <input
                className={inputCls}
                value={form.eligibleServiceIds}
                onChange={e => setForm(f => ({ ...f, eligibleServiceIds: e.target.value }))}
                placeholder="e.g. 12, 14, 19"
              />
              <p className="text-[10px] text-muted-foreground/60">Comma-separated numeric service IDs.</p>
            </div>

            {formError && <p className="text-xs text-red-400">{formError}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setModalOpen(false)} className={btnGhostCls}>Cancel</button>
              <button onClick={() => void submitForm()} disabled={saving} className={btnPrimaryCls}>
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {editingRule ? "Save" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
