import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTestbedContext } from "@/contexts/TestbedContext";
import { toast } from "sonner";
import {
  RefreshCw,
  ExternalLink,
  Loader2,
  AlertTriangle,
  Gauge,
  ChevronRight,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

/** One raw breakdown entry as persisted — shape varies per engine template. */
type BreakdownEntry = Record<string, unknown>;

interface PolicyActivityRow {
  engineKey: string | null;
  ruleName: string;
  severity: string;
  category: string;
  firedAt: string | null;
}

interface EngineSnapshot {
  engineKey: string;
  score: number | null;
  capturedAt: string | null;
  findings: string[];
  /** Raw persisted breakdown array (may be empty; single-object engines are 1-element). */
  breakdown?: BreakdownEntry[];
}

interface PortalSnapshot {
  customer: { id: number; name: string; domain: string | null };
  hasPortalUser: boolean;
  compositeScore: number | null;
  engines: EngineSnapshot[];
  policyActivity?: PolicyActivityRow[];
  capturedAt: string | null;
}

function scoreColor(score: number | null): string {
  if (score === null) return "text-muted-foreground";
  if (score >= 80) return "text-emerald-400";
  if (score >= 60) return "text-amber-400";
  return "text-destructive";
}

// ── Explain-dialog rendering ────────────────────────────────────────────────
// Each engine persists a differently-shaped breakdown (see the portal-snapshot
// endpoint / engine outputs). The dialog renders by template based on engineKey.

/** Engines whose breakdown is a flat sum-of-signals list. */
const SUM_OF_SIGNALS_ENGINES = new Set(["health", "security", "drift", "forecasting", "priority", "pricing"]);
/** Engines whose breakdown is a list of independently-evaluated items with a status. */
const EVALUATION_LIST_ENGINES = new Set(["sla", "scope_creep"]);

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
function str(v: unknown): string {
  return v == null ? "" : String(v);
}
function fmt(v: unknown): string {
  const n = num(v);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** The single per-signal contribution value for a sum-of-signals entry. */
function contributionOf(engineKey: string, e: BreakdownEntry): number {
  if (engineKey === "pricing") {
    // pricing entries carry pricingImpact + pricingValueContribution, not `contribution`.
    return num(e.pricingImpact) + num(e.pricingValueContribution);
  }
  // health/security pillars carry `value`; drift/forecasting/priority carry `contribution`.
  if ("contribution" in e) return num(e.contribution);
  if ("value" in e) return num(e.value);
  return 0;
}

/** Best display label for an entry — resolved label first, then signalKey/pillar. */
function entryLabel(e: BreakdownEntry): string {
  return str(e.label) || str(e.signalKey) || str(e.pillar) || "—";
}

/** One-line "why" beneath a sum-of-signals row. */
function entryWhy(engineKey: string, e: BreakdownEntry): string | null {
  if (engineKey === "health" || engineKey === "security") {
    return e.pillar ? `pillar: ${str(e.pillar)}` : null;
  }
  if (engineKey === "drift" || engineKey === "forecasting") {
    const parts: string[] = [];
    if (e.trendDirection) parts.push(`trend ${str(e.trendDirection)}`);
    if (e.trendValue != null) parts.push(`Δ${fmt(e.trendValue)}`);
    if (engineKey === "drift" && e.governanceImpact != null) parts.push(`gov ${fmt(e.governanceImpact)}`);
    if (engineKey === "forecasting" && e.decayRate != null) parts.push(`decay ${fmt(e.decayRate)}`);
    if (engineKey === "forecasting" && e.decayFactor != null) parts.push(`×${fmt(e.decayFactor)}`);
    return parts.length > 0 ? parts.join(" · ") : null;
  }
  return null;
}

/**
 * Health/security persist per-pillar breakdown objects, each holding its own
 * `contributions: {signalKey, value}[]`. Flatten to one row per contribution so
 * the sum-of-signals template can render them, carrying the pillar down.
 */
function flattenPillarBreakdown(breakdown: BreakdownEntry[]): BreakdownEntry[] {
  const rows: BreakdownEntry[] = [];
  for (const pillar of breakdown) {
    const contributions = Array.isArray(pillar.contributions) ? (pillar.contributions as BreakdownEntry[]) : [];
    if (contributions.length === 0) continue;
    for (const c of contributions) {
      rows.push({ ...c, pillar: pillar.pillar });
    }
  }
  return rows;
}

function severityBadgeVariant(severity: string): "default" | "secondary" | "destructive" | "outline" {
  const s = severity.toLowerCase();
  if (s === "critical" || s === "breached" || s === "exceeded") return "destructive";
  if (s === "warning") return "default";
  return "secondary";
}

function StatCell({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded border border-border bg-card px-1.5 py-1 text-center">
      <div className="font-mono text-xs font-semibold tabular-nums text-foreground">{fmt(value)}</div>
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

/** Template 1 — flat sum-of-signals list with a literal-sum footer. */
function SumOfSignalsTemplate({ engineKey, breakdown }: { engineKey: string; breakdown: BreakdownEntry[] }) {
  const rows = engineKey === "health" || engineKey === "security" ? flattenPillarBreakdown(breakdown) : breakdown;
  if (rows.length === 0) {
    return <p className="text-[11px] text-muted-foreground">No signal contributions in this snapshot.</p>;
  }
  const sum = rows.reduce((acc, e) => acc + contributionOf(engineKey, e), 0);
  return (
    <div className="space-y-1">
      {rows.map((e, i) => {
        const why = entryWhy(engineKey, e);
        return (
          <div key={i} className="flex items-start justify-between gap-3 rounded border border-border bg-card px-2 py-1">
            <div className="min-w-0">
              <div className="truncate text-[11px] text-foreground" title={entryLabel(e)}>{entryLabel(e)}</div>
              {why && <div className="truncate text-[10px] text-muted-foreground">{why}</div>}
            </div>
            <span className="shrink-0 font-mono text-[11px] font-semibold tabular-nums text-foreground">
              {fmt(contributionOf(engineKey, e))}
            </span>
          </div>
        );
      })}
      <div className="flex items-center justify-between border-t border-border pt-1.5 text-[11px] font-semibold text-foreground">
        <span>Sum</span>
        <span className="font-mono tabular-nums">{fmt(sum)}</span>
      </div>
    </div>
  );
}

/** Template 2 — CRM multi-dimension list: 5 numbers per row + totals footer. */
function CrmTemplate({ breakdown }: { breakdown: BreakdownEntry[] }) {
  if (breakdown.length === 0) {
    return <p className="text-[11px] text-muted-foreground">No CRM signal contributions in this snapshot.</p>;
  }
  const dims = ["fit", "pain", "maturity", "intent", "urgency"] as const;
  const totals = dims.map((d) => breakdown.reduce((acc, e) => acc + num(e[d]), 0));
  return (
    <div className="space-y-1.5">
      {breakdown.map((e, i) => (
        <div key={i} className="rounded border border-border bg-card px-2 py-1.5">
          <div className="truncate text-[11px] text-foreground" title={entryLabel(e)}>{entryLabel(e)}</div>
          <div className="mt-1 grid grid-cols-5 gap-1">
            {dims.map((d) => (
              <StatCell key={d} label={d} value={e[d]} />
            ))}
          </div>
        </div>
      ))}
      <div className="border-t border-border pt-1.5">
        <div className="mb-1 text-[11px] font-semibold text-foreground">Totals</div>
        <div className="grid grid-cols-5 gap-1">
          {dims.map((d, i) => (
            <StatCell key={d} label={d} value={totals[i]} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Template 3 — list of independently-evaluated items with status badges. */
function EvaluationListTemplate({ engineKey, breakdown }: { engineKey: string; breakdown: BreakdownEntry[] }) {
  if (breakdown.length === 0) {
    return <p className="text-[11px] text-muted-foreground">No evaluations in this snapshot.</p>;
  }
  return (
    <div className="space-y-1.5">
      {breakdown.map((e, i) => {
        if (engineKey === "sla") {
          const status = str(e.status) || (e.breached ? "breached" : e.warningFired ? "warning" : "ok");
          return (
            <div key={i} className="rounded border border-border bg-card px-2 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-[11px] text-foreground" title={str(e.ticketRef) || str(e.timerId)}>
                  {str(e.ticketRef) || str(e.phase) || `timer ${str(e.timerId)}`}
                </span>
                <Badge variant={severityBadgeVariant(status)}>{status}</Badge>
              </div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                {fmt(e.elapsedMinutes)}m elapsed · warn {fmt(e.warningThresholdMinutes)}m · breach {fmt(e.thresholdMinutes)}m
              </div>
            </div>
          );
        }
        // scope_creep
        const exceeded = Boolean(e.exceeded);
        return (
          <div key={i} className="rounded border border-border bg-card px-2 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[11px] text-foreground" title={str(e.detectionType)}>
                {str(e.detectionType) || `detection ${str(e.detectionId)}`}
              </span>
              <Badge variant={exceeded ? "destructive" : "secondary"}>{exceeded ? "exceeded" : "within-threshold"}</Badge>
            </div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">
              change {fmt(e.changePct)}% · threshold {fmt(e.threshold)}% · contribution {fmt(e.contribution)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** One-off — monitoring coverage summary (single breakdown object). */
function MonitoringTemplate({ breakdown }: { breakdown: BreakdownEntry[] }) {
  const m = breakdown[0];
  if (!m) return <p className="text-[11px] text-muted-foreground">No monitoring summary in this snapshot.</p>;
  const cells: [string, unknown][] = [
    ["total", m.total],
    ["ok", m.ok],
    ["error", m.error],
    ["needs script", m.requiresScript],
    ["consent revoked", m.consentRevoked],
    ["coverage", m.coverage],
    ["failures", m.failures],
  ];
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {cells.map(([label, value]) => (
        <StatCell key={label} label={label} value={value} />
      ))}
    </div>
  );
}

/** One-off — sales_offer candidate list (no breakdown; candidates array). */
function SalesOfferTemplate({ breakdown }: { breakdown: BreakdownEntry[] }) {
  // sales_offer has no persisted breakdown; candidates live on the engine output.
  // We surface whatever candidate-shaped rows made it into the snapshot, if any.
  const candidates = breakdown.filter((e) => e && (e.title != null || e.serviceName != null || e.rationale != null));
  if (candidates.length === 0) {
    return <p className="text-[11px] text-muted-foreground">No offer candidates in this snapshot.</p>;
  }
  return (
    <div className="space-y-1.5">
      {candidates.map((c, i) => (
        <div key={i} className="rounded border border-border bg-card px-2 py-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[11px] font-medium text-foreground" title={str(c.title) || str(c.serviceName)}>
              {str(c.title) || str(c.serviceName) || `candidate ${i + 1}`}
            </span>
            {c.score != null && (
              <span className="shrink-0 font-mono text-[11px] font-semibold tabular-nums text-foreground">{fmt(c.score)}</span>
            )}
          </div>
          {c.rationale != null && <div className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{str(c.rationale)}</div>}
        </div>
      ))}
    </div>
  );
}

function PolicyActivitySection({ rows }: { rows: PolicyActivityRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-3 border-t border-border pt-2.5">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Policy activity</div>
      <div className="space-y-1">
        {rows.map((r, i) => (
          <div key={i} className="rounded border border-border bg-card px-2 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[11px] text-foreground" title={r.ruleName}>{r.ruleName}</span>
              <Badge variant={severityBadgeVariant(r.severity)}>{r.severity}</Badge>
            </div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">
              {r.category}
              {r.firedAt && <> · fired {new Date(r.firedAt).toLocaleString()}</>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EngineBreakdownBody({ engineKey, breakdown }: { engineKey: string; breakdown: BreakdownEntry[] }) {
  if (engineKey === "crm") return <CrmTemplate breakdown={breakdown} />;
  if (engineKey === "monitoring") return <MonitoringTemplate breakdown={breakdown} />;
  if (engineKey === "sales_offer") return <SalesOfferTemplate breakdown={breakdown} />;
  if (EVALUATION_LIST_ENGINES.has(engineKey)) return <EvaluationListTemplate engineKey={engineKey} breakdown={breakdown} />;
  if (SUM_OF_SIGNALS_ENGINES.has(engineKey)) return <SumOfSignalsTemplate engineKey={engineKey} breakdown={breakdown} />;
  // Unknown / msp roll-up etc. — fall back to a readable dump.
  if (breakdown.length === 0) return <p className="text-[11px] text-muted-foreground">No breakdown persisted for this engine.</p>;
  return (
    <pre className="max-h-64 overflow-auto rounded border border-border bg-card p-2 text-[10px] leading-snug text-muted-foreground">
      {JSON.stringify(breakdown, null, 2)}
    </pre>
  );
}

function EngineExplainDialog({
  engine,
  policyActivity,
  onClose,
}: {
  engine: EngineSnapshot | null;
  policyActivity: PolicyActivityRow[];
  onClose: () => void;
}) {
  const breakdown = engine?.breakdown ?? [];
  // Policy activity rows that threshold on this engine.
  const relevantPolicy = engine ? policyActivity.filter((p) => p.engineKey === engine.engineKey) : [];
  return (
    <Dialog open={engine !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        {engine && (
          <>
            <DialogHeader>
              <DialogTitle className="font-mono">{engine.engineKey}</DialogTitle>
              <DialogDescription>
                Score{" "}
                <span className={`font-mono font-semibold ${scoreColor(engine.score)}`}>{engine.score ?? "—"}</span>
                {" "}— how it was calculated
                {engine.capturedAt && <> · captured {new Date(engine.capturedAt).toLocaleString()}</>}
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[60vh] overflow-y-auto">
              <EngineBreakdownBody engineKey={engine.engineKey} breakdown={breakdown} />
              <PolicyActivitySection rows={relevantPolicy} />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Replaces the retired live-iframe Customer Portal Mirror. The iframe approach
 * was structurally unreliable (single-use impersonation token dies on any frame
 * remount, the portal's root redirect races the token exchange, and the panel
 * required a hand-typed cross-deployment URL). Instead: a static snapshot of
 * the same engine-snapshot state the portal dashboard renders, fetched via the
 * admin API, plus a fresh-token "open portal in new tab" action.
 */
export function SimulatorPortalSnapshot() {
  const { fetchWithAuth } = useAuth();
  const { selectedCustomerId } = useTestbedContext();
  const [snapshot, setSnapshot] = useState<PortalSnapshot | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [explainEngine, setExplainEngine] = useState<EngineSnapshot | null>(null);
  // Monotonic request id — a slow response for a previously-selected testbed
  // must not overwrite the snapshot of the currently-selected one.
  const requestSeq = useRef(0);

  const loadSnapshot = useCallback(
    async (id: number) => {
      const seq = ++requestSeq.current;
      setLoading(true);
      try {
        const res = await fetchWithAuth(`/api/admin/simulator/testbeds/${id}/portal-snapshot`);
        const data = await res.json();
        if (seq !== requestSeq.current) return;
        if (!res.ok) throw new Error(data.error ?? "Failed to load portal snapshot");
        setSnapshot(data);
        setFetchedAt(new Date());
        // Any open explain dialog references a now-stale engine object — close it.
        setExplainEngine(null);
      } catch (err: any) {
        if (seq !== requestSeq.current) return;
        toast.error(err.message ?? "Failed to load portal snapshot");
        setSnapshot(null);
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [fetchWithAuth],
  );

  useEffect(() => {
    if (selectedCustomerId == null) {
      setSnapshot(null);
      return;
    }
    loadSnapshot(selectedCustomerId);
  }, [selectedCustomerId, loadSnapshot]);

  // Fresh single-use token per click — tokens are consumed on first exchange,
  // so re-using one across opens can never work. Same-host path routing means
  // the portal is always at /portal on this origin (see .replit-artifact
  // manifests) — no hand-typed base URL.
  const openPortal = async () => {
    if (selectedCustomerId == null) return;
    setOpening(true);
    // Open the tab synchronously inside the click gesture — popup blockers
    // reject window.open calls that happen after an await.
    const tab = window.open("", "_blank");
    try {
      const res = await fetchWithAuth(`/api/admin/simulator/testbeds/${selectedCustomerId}/portal-mirror-token`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to issue portal token");
      const url = `/portal/?impersonation_token=${encodeURIComponent(data.token)}`;
      if (tab) tab.location.href = url;
      else window.open(url, "_blank");
    } catch (err: any) {
      tab?.close();
      toast.error(err.message ?? "Failed to open portal");
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-xs">
      <div className="shrink-0 space-y-2 border-b border-border p-2.5">
        <div className="flex gap-1.5">
          <button
            onClick={() => selectedCustomerId != null && loadSnapshot(selectedCustomerId)}
            disabled={selectedCustomerId == null || loading}
            className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded border border-border bg-card text-foreground transition-colors hover:bg-accent disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Refresh
          </button>
          <button
            onClick={openPortal}
            disabled={selectedCustomerId == null || opening || (snapshot !== null && !snapshot.hasPortalUser)}
            title="Issues a fresh single-use impersonation token and opens the customer portal in a new tab"
            className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {opening ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}
            Open Portal
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
        {selectedCustomerId == null ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <Gauge className="h-6 w-6 opacity-40" />
            <p className="max-w-[220px] leading-relaxed">
              Select a testbed customer in the header to see a snapshot of the state their portal dashboard renders.
            </p>
          </div>
        ) : loading && !snapshot ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : snapshot ? (
          <div className="space-y-3">
            <div>
              <div className="text-sm font-semibold text-foreground">{snapshot.customer.name}</div>
              <div className="font-mono text-[11px] text-muted-foreground">
                {snapshot.customer.domain ?? "no domain"} · customer #{snapshot.customer.id}
              </div>
              {fetchedAt && (
                <div className="mt-0.5 text-[10px] text-muted-foreground/70">
                  snapshot fetched {fetchedAt.toLocaleTimeString()}
                </div>
              )}
            </div>

            {!snapshot.hasPortalUser && (
              <div className="flex items-start gap-2 rounded border border-amber-400/30 bg-amber-400/10 p-2 text-amber-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="leading-relaxed">
                  No active portal user for this customer — "Open Portal" needs one to impersonate.
                </span>
              </div>
            )}

            <div className="flex items-baseline gap-2 rounded border border-border bg-card p-2.5">
              <span className={`font-mono text-2xl font-semibold tabular-nums ${scoreColor(snapshot.compositeScore)}`}>
                {snapshot.compositeScore ?? "—"}
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Composite score
              </span>
            </div>

            {snapshot.engines.length === 0 ? (
              <div className="rounded border border-dashed border-border p-3 text-center leading-relaxed text-muted-foreground">
                No engine snapshots yet — run engines from the Run Engines tab to populate the portal dashboard.
              </div>
            ) : (
              <div className="divide-y divide-border overflow-hidden rounded border border-border">
                {snapshot.engines.map((eng) => (
                  <button
                    key={eng.engineKey}
                    type="button"
                    onClick={() => setExplainEngine(eng)}
                    title="Explain how this score was calculated"
                    className="group w-full bg-card p-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1">
                        <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" />
                        <span className="truncate font-mono text-[11px] text-foreground">{eng.engineKey}</span>
                      </span>
                      <span className={`font-mono text-sm font-semibold tabular-nums ${scoreColor(eng.score)}`}>
                        {eng.score ?? "—"}
                      </span>
                    </div>
                    {eng.capturedAt && (
                      <div className="pl-4 text-[10px] text-muted-foreground/70">
                        captured {new Date(eng.capturedAt).toLocaleString()}
                      </div>
                    )}
                    {eng.findings.length > 0 && (
                      <ul className="mt-1 space-y-0.5 pl-4">
                        {eng.findings.map((f, i) => (
                          <li key={i} className="truncate text-[11px] leading-snug text-muted-foreground" title={f}>
                            · {f}
                          </li>
                        ))}
                      </ul>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>

      <EngineExplainDialog
        engine={explainEngine}
        policyActivity={snapshot?.policyActivity ?? []}
        onClose={() => setExplainEngine(null)}
      />
    </div>
  );
}
