import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ShieldAlert,
  Activity,
} from "lucide-react";

// ─── API shapes ────────────────────────────────────────────────────────────
// Matches artifacts/api-server/src/routes/admin-signal-rules.ts:
//   GET /admin/signal-rules/conflicts -> { conflicts: RuleConflict[], count }
//   GET /admin/signal-rules/health    -> Record<signalKey, { clientCount, totalClients }>
//   GET /admin/signal-rules           -> { bySignal, rules, groups } (used here only to
//     resolve a conflict's ruleIds back to their ruleType/sourceKey/compareValue for display)

interface RuleConflict {
  ruleIds: number[];
  description: string;
}

interface HealthEntry {
  clientCount: number;
  totalClients: number;
}
type HealthData = Record<string, HealthEntry>;

interface SignalRule {
  id: number;
  signalKey: string;
  ruleType: string;
  sourceKey: string;
  compareValue: string | null;
}

interface SignalLabel {
  key: string;
  label: string;
}

const signalLabel = (labels: Map<string, string>, key: string) => labels.get(key) ?? key;

export default function ConflictsHealthPanel() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [conflicts, setConflicts] = useState<RuleConflict[]>([]);
  const [health, setHealth] = useState<HealthData>({});
  const [ruleById, setRuleById] = useState<Map<number, SignalRule>>(new Map());
  const [labels, setLabels] = useState<Map<string, string>>(new Map());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [conflictsRes, healthRes, rulesRes, signalsRes, adjSignalsRes] = await Promise.all([
        fetchWithAuth("/api/admin/signal-rules/conflicts"),
        fetchWithAuth("/api/admin/signal-rules/health"),
        fetchWithAuth("/api/admin/signal-rules"),
        fetchWithAuth("/api/admin/engagement-projects/signals"),
        fetchWithAuth("/api/admin/signal-rules/adjustment-signals"),
      ]);

      if (conflictsRes.ok) {
        const data = await conflictsRes.json() as { conflicts: RuleConflict[] };
        setConflicts(data.conflicts ?? []);
      }
      if (healthRes.ok) {
        setHealth(await healthRes.json() as HealthData);
      }
      if (rulesRes.ok) {
        const data = await rulesRes.json() as { rules: SignalRule[] };
        setRuleById(new Map((data.rules ?? []).map(r => [r.id, r])));
      }
      const labelMap = new Map<string, string>();
      if (signalsRes.ok) {
        for (const s of await signalsRes.json() as SignalLabel[]) labelMap.set(s.key, s.label);
      }
      if (adjSignalsRes.ok) {
        for (const s of await adjSignalsRes.json() as SignalLabel[]) labelMap.set(s.key, s.label);
      }
      setLabels(labelMap);
    } catch (err) {
      toast({
        title: "Failed to load conflicts & health",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // Group conflicts by signalKey (a conflict's own rules all share one signalKey —
  // detectRuleConflicts groups by signalKey+sourceKey — so the first member rule's
  // signalKey identifies the whole conflict; fall back to parsing the description
  // if none of its rule ids are in the current rule set, e.g. after a delete).
  const conflictsBySignal = useMemo(() => {
    const groups = new Map<string, RuleConflict[]>();
    for (const c of conflicts) {
      const firstRule = c.ruleIds.map(id => ruleById.get(id)).find(Boolean);
      const key = firstRule?.signalKey ?? c.description.match(/Signal "([^"]+)"/)?.[1] ?? "Unknown signal";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(c);
    }
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [conflicts, ruleById]);

  const healthRows = useMemo(() => {
    return Object.entries(health)
      .map(([key, entry]) => ({
        key,
        ...entry,
        coverage: entry.totalClients > 0 ? entry.clientCount / entry.totalClients : 0,
      }))
      .sort((a, b) => a.clientCount - b.clientCount || a.key.localeCompare(b.key));
  }, [health]);

  const orphanedCount = healthRows.filter(r => r.clientCount === 0).length;
  const totalClients = healthRows[0]?.totalClients ?? 0;

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm p-4">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading conflicts &amp; health…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Conflicts ── */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <ShieldAlert className={`h-4 w-4 ${conflicts.length > 0 ? "text-amber-400" : "text-emerald-400"}`} />
          <h2 className="text-sm font-semibold text-foreground">Rule Conflicts</h2>
          <span
            className={`ml-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
              conflicts.length > 0
                ? "bg-amber-400/10 text-amber-400 border border-amber-400/25"
                : "bg-emerald-400/10 text-emerald-400 border border-emerald-400/25"
            }`}
          >
            {conflicts.length}
          </span>
        </div>

        {conflicts.length === 0 ? (
          <div className="px-4 py-6 flex items-center gap-2 text-sm text-muted-foreground italic">
            <CheckCircle2 className="h-4 w-4 text-emerald-400/70" />
            No conflicting rules detected.
          </div>
        ) : (
          <div className="p-3 space-y-3">
            {conflictsBySignal.map(([signalKey, group]) => (
              <div key={signalKey} className="rounded-lg border border-amber-500/25 bg-amber-500/5">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-amber-500/20">
                  <span className="font-mono text-xs text-foreground">{signalLabel(labels, signalKey)}</span>
                  <span className="text-[10px] text-muted-foreground/70 font-mono">{signalKey}</span>
                  <span className="ml-auto text-[10px] text-amber-400/80">
                    {group.length} conflict{group.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="p-3 space-y-3">
                  {group.map((c, i) => (
                    <div key={i} className="rounded-md border border-border bg-background/50 p-2.5">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                        <p className="text-xs text-foreground/90 leading-snug">{c.description}</p>
                      </div>
                      {c.ruleIds.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5 pl-6">
                          {c.ruleIds.map(id => {
                            const rule = ruleById.get(id);
                            return (
                              <span
                                key={id}
                                className="inline-flex items-center gap-1 rounded bg-accent/60 border border-border px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground"
                                title={rule ? `${rule.ruleType} — ${rule.sourceKey}${rule.compareValue != null ? ` = ${rule.compareValue}` : ""}` : `Rule #${id}`}
                              >
                                #{id}
                                {rule && <span className="text-foreground/80">{rule.ruleType}</span>}
                                {rule && <span>{rule.sourceKey}</span>}
                                {rule?.compareValue != null && rule.compareValue !== "" && <span>= {rule.compareValue}</span>}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Health ── */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Activity className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Signal Health</h2>
          <span className="text-[11px] text-muted-foreground">
            Share of clients (of {totalClients}) each signal fires for
          </span>
          {orphanedCount > 0 && (
            <span className="ml-auto flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold bg-amber-400/10 text-amber-400 border border-amber-400/25">
              <AlertTriangle className="h-3 w-3" />
              {orphanedCount} never fire
            </span>
          )}
        </div>

        {healthRows.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground italic">No signal health data available.</div>
        ) : (
          <div className="divide-y divide-border/60">
            {healthRows.map(row => (
              <div key={row.key} className="flex items-center gap-3 px-4 py-2.5">
                <div className="w-52 shrink-0 truncate">
                  <span className="text-xs text-foreground/90">{signalLabel(labels, row.key)}</span>
                  <span className="block text-[10px] text-muted-foreground/60 font-mono truncate">{row.key}</span>
                </div>
                <div className="flex-1 h-2 rounded-full bg-accent/60 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${row.clientCount === 0 ? "bg-muted-foreground/30" : "bg-primary"}`}
                    style={{ width: `${Math.min(100, Math.round(row.coverage * 100))}%` }}
                  />
                </div>
                <div className="w-28 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                  {row.clientCount} / {row.totalClients}
                  <span className="ml-1 text-muted-foreground/60">({Math.round(row.coverage * 100)}%)</span>
                </div>
                {row.clientCount === 0 && (
                  <span title="This signal never fires for any client — its rules may be orphaned or miscalibrated">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400/80 shrink-0" />
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
