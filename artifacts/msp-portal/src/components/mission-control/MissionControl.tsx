/**
 * MissionControl.tsx
 *
 * Mission Control content for the CustomerUser dashboard page — rendered by
 * customer-dashboard.tsx above the resolved dashboard canvas (the card trio /
 * ScoreRing live in this app, so this content composes at the page layer; it
 * does not modify the DashboardTabs/DashboardView/canvas system).
 *
 * Sections:
 *   - Hero: overall health ring + findings summary + scan status line
 *     (live SSE progress strip while a diagnostics run is active, otherwise a
 *     minimal "Last scan" line — no empty idle block).
 *   - Six-engine status strip (functional severity colors only).
 *   - Health Engine pillar breakdown as small ScoreRings (informational blue;
 *     only the overall ring carries severity color — pillar scores are raw
 *     impact sums without their own severity semantics).
 *   - Diagnostics-first findings feed using FindingCard, with the linked
 *     OfferCard / InstantRemediationCard where the server matched an offer.
 *     The instant variant only ever appears when the server flagged the offer
 *     `instant` (testbed customers only); the execute endpoint enforces the
 *     same guard server-side regardless of what this UI renders.
 *
 * Data: GET /api/portal/mission-control/engines + /overview (see
 * portal-mission-control.ts). Signal keys never reach this component.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { ScoreRing, type ScoreRingColor } from "@/components/ui/score-ring";
import {
  FindingCard,
  OfferCard,
  InstantRemediationCard,
  type FindingSeverity,
} from "@/components/ui/finding-offer-card";

// ── Server payload shapes (portal-mission-control.ts) ───────────────────────

type EngineSeverity = "good" | "watch" | "high" | "info";

interface EngineStatusEntry {
  key: string;
  label: string;
  severity: EngineSeverity;
  statusLabel: string;
  detail: string;
}

interface EnginesResponse {
  engines: EngineStatusEntry[];
  health: { score: number | null; pillars: Array<{ pillar: string; score: number }> };
  generatedAt: string;
}

interface LinkedOffer {
  id: number;
  title: string;
  rationale: string | null;
  adjustedPriceCents: number;
  state: string;
  instant: boolean;
}

interface OverviewFinding {
  id: number;
  checkLabel: string;
  severity: "critical" | "warning" | "info";
  title: string;
  description: string | null;
  effort: string | null;
  category: string | null;
  action: string | null;
  createdAt: string;
  offer: LinkedOffer | null;
}

interface OverviewResponse {
  scan: {
    active: boolean;
    runId: string | null;
    status: string | null;
    startedAt: string | null;
    lastScanAt: string | null;
  };
  summary: {
    critical: number;
    warning: number;
    info: number;
    checksOk: number | null;
    checksTotal: number | null;
  };
  findings: OverviewFinding[];
}

type DiagnosticsSSEEvent =
  | { type: "diagnostics_progress"; checkKey: string; checkLabel: string; status: string; index: number; total: number }
  | { type: "diagnostics_complete"; status: string; checksTotal: number; checksOk: number; checksError: number; findings: number }
  | { type: "diagnostics_error"; message: string };

// ── Display mappings (functional colors only, dot + text never color-alone) ──

const ENGINE_SEVERITY_META: Record<EngineSeverity, { dot: string; text: string }> = {
  good: { dot: "bg-status-green", text: "text-status-green" },
  watch: { dot: "bg-status-amber", text: "text-status-amber" },
  high: { dot: "bg-status-red", text: "text-status-red" },
  info: { dot: "bg-status-blue", text: "text-status-blue" },
};

const FINDING_SEVERITY: Record<OverviewFinding["severity"], FindingSeverity> = {
  critical: "high",
  warning: "watch",
  info: "good",
};

const PILLAR_LABELS: Record<string, string> = {
  governance: "Governance",
  compliance: "Compliance",
  adoption: "Adoption",
  copilot: "Copilot Readiness",
  architecture: "Architecture",
  licensing: "Licensing",
  security: "Security",
};

function healthRingColor(score: number | null): ScoreRingColor {
  if (score == null) return "blue";
  if (score < 60) return "red";
  if (score < 85) return "amber";
  return "green";
}

function formatPrice(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

function formatWhen(iso: string | null): string {
  if (!iso) return "never";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function findingConsequence(f: OverviewFinding): string {
  if (f.action) return f.action;
  const bits: string[] = [];
  if (f.category) bits.push(`Area: ${f.category}`);
  if (f.effort) bits.push(`Estimated effort: ${f.effort}`);
  return bits.length > 0 ? bits.join(" · ") : "Flagged by tenant diagnostics for review.";
}

// ── Component ────────────────────────────────────────────────────────────────

export function MissionControl() {
  const { user, accessToken, fetchWithAuth } = useAuth();
  const [, setLocation] = useLocation();
  const customerId = user?.customerId ?? null;

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [engines, setEngines] = useState<EnginesResponse | null>(null);
  const [enginesLoading, setEnginesLoading] = useState(true);
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchWithAuth("/api/portal/mission-control/engines")
      .then(async (res) => {
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as EnginesResponse;
        if (!cancelled) setEngines(data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setEnginesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth]);

  const loadOverview = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/portal/mission-control/overview");
      if (!res.ok || !mountedRef.current) return;
      const data = (await res.json()) as OverviewResponse;
      if (mountedRef.current) setOverview(data);
    } catch {
      // graceful — section renders its unavailable state
    } finally {
      if (mountedRef.current) setOverviewLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  // ── Live scan progress via the existing diagnostics SSE endpoint ──────────
  const scanActive = overview?.scan.active ?? false;
  const scanRunId = overview?.scan.runId ?? null;
  const [progress, setProgress] = useState<{ index: number; total: number; label: string } | null>(null);

  useEffect(() => {
    if (!scanActive || !scanRunId || customerId == null || !accessToken) return;
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const es = new EventSource(
      `${base}/api/msp/customers/${customerId}/diagnostics/runs/${scanRunId}/sse?jwt=${encodeURIComponent(accessToken)}`,
    );
    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data as string) as DiagnosticsSSEEvent;
        if (parsed.type === "diagnostics_progress") {
          setProgress({ index: parsed.index, total: parsed.total, label: parsed.checkLabel });
        } else if (parsed.type === "diagnostics_complete") {
          es.close();
          setProgress(null);
          toast.success("Diagnostics scan complete — refreshing findings.");
          setTimeout(() => void loadOverview(), 1200);
        } else if (parsed.type === "diagnostics_error") {
          es.close();
          setProgress(null);
          setTimeout(() => void loadOverview(), 1200);
        }
      } catch {
        // ignore malformed events
      }
    };
    es.onerror = () => {
      es.close();
    };
    return () => {
      es.close();
      setProgress(null);
    };
  }, [scanActive, scanRunId, customerId, accessToken, loadOverview]);

  // ── Instant remediation ───────────────────────────────────────────────────
  const [remediatingOfferId, setRemediatingOfferId] = useState<number | null>(null);
  const [triggeredOfferIds, setTriggeredOfferIds] = useState<Set<number>>(new Set());

  async function runInstantRemediation(offerId: number) {
    setRemediatingOfferId(offerId);
    try {
      const res = await fetchWithAuth("/api/portal/mission-control/remediate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offerId }),
      });
      if (res.status === 202) {
        toast.success("Remediation started — the configuration pack is being applied to your tenant.");
        setTriggeredOfferIds((prev) => new Set(prev).add(offerId));
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? "Failed to start remediation");
      }
    } catch {
      toast.error("Failed to start remediation");
    } finally {
      setRemediatingOfferId(null);
    }
  }

  const summary = overview?.summary;
  const hasScanHistory = overview != null && (overview.scan.lastScanAt != null || overview.scan.active);

  return (
    <section aria-label="Mission Control" className="space-y-4">
      {/* ── Hero ── */}
      <Card className="p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex flex-col gap-1.5 min-w-0">
          <h2 className="text-xl font-bold tracking-tight">Mission Control</h2>
          {overviewLoading ? (
            <span className="text-sm text-muted-foreground inline-flex items-center gap-1.5">
              <Loader2 className="size-3.5 animate-spin" /> Loading tenant status…
            </span>
          ) : summary && hasScanHistory ? (
            <p className="text-sm text-secondary-foreground/90">
              {summary.critical > 0 && <span className="text-status-red font-medium">{summary.critical} critical</span>}
              {summary.critical > 0 && (summary.warning > 0 || summary.checksTotal != null) && " · "}
              {summary.warning > 0 && <span className="text-status-amber font-medium">{summary.warning} to watch</span>}
              {summary.warning > 0 && summary.checksTotal != null && " · "}
              {summary.checksTotal != null && (
                <span>
                  {summary.checksOk ?? 0} of {summary.checksTotal} checks passing
                </span>
              )}
              {summary.critical === 0 && summary.warning === 0 && summary.checksTotal == null && (
                <span>No open findings.</span>
              )}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No diagnostics have run for your tenant yet.</p>
          )}
          {/* Scan status: live progress strip when active, minimal last-scan line otherwise */}
          {progress ? (
            <div className="w-full sm:w-80 flex flex-col gap-1 mt-1" role="status" aria-label="Scan in progress">
              <span className="text-xs text-status-blue inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-status-blue animate-pulse" aria-hidden="true" />
                Scanning — {progress.label} ({progress.index}/{progress.total})
              </span>
              <div className="h-1 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-status-blue rounded-full transition-all duration-500"
                  style={{ width: `${progress.total > 0 ? Math.round((progress.index / progress.total) * 100) : 0}%` }}
                />
              </div>
            </div>
          ) : scanActive ? (
            <span className="text-xs text-status-blue inline-flex items-center gap-1.5 mt-1">
              <span className="size-2 rounded-full bg-status-blue animate-pulse" aria-hidden="true" />
              Diagnostics scan in progress…
            </span>
          ) : overview?.scan.lastScanAt ? (
            <span className="text-xs font-mono text-muted-foreground mt-1">
              Last scan: {formatWhen(overview.scan.lastScanAt)}
            </span>
          ) : null}
        </div>
        <ScoreRing
          value={engines?.health.score ?? 0}
          color={healthRingColor(enginesLoading ? null : (engines?.health.score ?? null))}
          size={112}
          strokeWidth={9}
          label="Overall health"
          className="shrink-0"
        />
      </Card>

      {/* ── Six-engine status strip ── */}
      <Card className="px-4 py-3">
        {enginesLoading ? (
          <span className="text-sm text-muted-foreground inline-flex items-center gap-1.5">
            <Loader2 className="size-3.5 animate-spin" /> Checking engine status…
          </span>
        ) : engines ? (
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {engines.engines.map((engine) => {
              const meta = ENGINE_SEVERITY_META[engine.severity];
              return (
                <li key={engine.key} className="flex items-center gap-1.5" title={engine.detail}>
                  <span className={cn("size-2 rounded-full", meta.dot)} aria-hidden="true" />
                  <span className="text-xs font-medium text-foreground">{engine.label}</span>
                  <span className={cn("text-xs font-medium", meta.text)}>{engine.statusLabel}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <span className="text-sm text-muted-foreground">Engine status unavailable right now.</span>
        )}
      </Card>

      {/* ── Health pillar breakdown ── */}
      {engines && engines.health.pillars.length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Health breakdown</h3>
          <div className="flex flex-wrap gap-x-6 gap-y-4">
            {engines.health.pillars.map((p) => (
              <ScoreRing
                key={p.pillar}
                value={p.score}
                color="blue"
                size={64}
                strokeWidth={6}
                label={PILLAR_LABELS[p.pillar] ?? p.pillar}
              />
            ))}
          </div>
        </Card>
      )}

      {/* ── Diagnostics findings feed ── */}
      {!overviewLoading && overview && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Latest diagnostics findings</h3>
          {overview.findings.length === 0 ? (
            hasScanHistory ? (
              <p className="text-sm text-secondary-foreground/90 inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-status-green" aria-hidden="true" />
                No open findings from the latest scan
                {summary?.checksTotal != null ? ` — ${summary.checksOk ?? 0} of ${summary.checksTotal} checks passing.` : "."}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Findings will appear here after your first diagnostics scan.</p>
            )
          ) : (
            overview.findings.map((finding) => {
              const offer = finding.offer;
              return (
                <div key={finding.id} className={cn(offer && "grid gap-3 md:grid-cols-2")}>
                  <FindingCard
                    severity={FINDING_SEVERITY[finding.severity]}
                    engineSource={finding.checkLabel}
                    title={finding.title}
                    description={finding.description ?? ""}
                    consequence={findingConsequence(finding)}
                    timestamp={formatWhen(finding.createdAt)}
                  />
                  {offer &&
                    (triggeredOfferIds.has(offer.id) ? (
                      <Card className="p-4 flex flex-col justify-center gap-1 border-l-2 border-l-status-green">
                        <span className="text-sm font-medium text-status-green">Remediation started</span>
                        <span className="text-xs text-muted-foreground">
                          The configuration pack is being applied to your tenant.
                        </span>
                      </Card>
                    ) : offer.instant ? (
                      <InstantRemediationCard
                        title={offer.title}
                        rationale={offer.rationale ?? "Applies the recommended configuration to your tenant automatically."}
                        actionLabel={remediatingOfferId === offer.id ? "Starting…" : "Run remediation"}
                        onAction={() => {
                          if (remediatingOfferId == null) void runInstantRemediation(offer.id);
                        }}
                      />
                    ) : (
                      <OfferCard
                        title={offer.title}
                        rationale={offer.rationale ?? "Recommended follow-up for this finding."}
                        price={formatPrice(offer.adjustedPriceCents)}
                        actionLabel="View offer"
                        onAction={() => setLocation("/customer-offers")}
                      />
                    ))}
                </div>
              );
            })
          )}
        </div>
      )}
    </section>
  );
}
