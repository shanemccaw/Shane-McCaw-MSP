/**
 * AssessmentSowSelector.tsx
 *
 * The interactive Statement of Work step of the Assessment wizard (task 4). It
 * layers scope interactivity on top of the same read-only document view used for
 * the findings reports — it does not replace that view.
 *
 * Three behaviors, matching the product spec:
 *   1. Instant, free price preview — toggling a workstream phase recomputes the
 *      running "Total Investment" and phase count entirely client-side from the
 *      already-stored per-phase pricing. No AI call, no round-trip per click.
 *      Mandatory adjustments are shown but never toggleable.
 *   2. Deliberate regeneration — the explicit "Update my scope" action calls
 *      POST /api/portal/assessment/sow/select. A genuinely narrower selection
 *      triggers a real, telemetry-grounded regeneration (an honest AI cost, so we
 *      show a "generating your updated scope" state, not an instant flash).
 *      Restoring a scope already in storage (e.g. "Reset to full scope") simply
 *      re-activates that stored version — instant and free.
 *   3. Pricing window — the SOW is valid for 30 days from generation, with a
 *      72-hour pay-in-full discount window at the start. This surfaces the live
 *      countdown / expiry state (the actual plan choice is task 5).
 *
 * Server state comes from GET /api/portal/assessment/sow.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  AlarmClock,
  CalendarClock,
  CheckCircle2,
  FileSignature,
  FileText,
  Loader2,
  Lock,
  Maximize2,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";

type FetchWithAuth = (
  path: string,
  init?: RequestInit,
  opts?: { silent?: boolean },
) => Promise<Response>;

interface Workstream {
  title: string;
  scope: string;
  priceUsd: number;
  weeks: number | null;
  deliveryDate: string | null;
}
interface Adjustment {
  title: string;
  scope: string;
  priceUsd: number;
}
interface PricingWindow {
  anchorAt: string;
  discountWindowEndsAt: string;
  validUntil: string;
  windowState: "discount" | "standard" | "expired";
}
interface SowStateReady {
  ready: true;
  regenerating: boolean;
  doc: { id: number; title: string; htmlContent: string; totalPrice: number | null };
  allWorkstreams: Workstream[];
  adjustments: Adjustment[];
  selectedWorkstreamTitles: string[];
  isFullScope: boolean;
  pricing: PricingWindow;
}
interface SowStateNotReady {
  ready: false;
  regenerating: boolean;
}
type SowState = SowStateReady | SowStateNotReady;

const POLL_INTERVAL_MS = 3000;

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const normalizeSet = (titles: string[]): string => [...new Set(titles)].sort().join("");

function formatRemaining(ms: number): string {
  if (ms <= 0) return "0s";
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  return `${hours}h ${mins}m ${secs}s`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ── Live pricing-window banner (30-day validity / 72-hour discount) ────────────

function PricingWindowBanner({ pricing }: { pricing: PricingWindow }) {
  // Re-render every second so the discount countdown ticks live.
  const [, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (pricing.windowState !== "discount") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [pricing.windowState]);

  if (pricing.windowState === "discount") {
    const remaining = new Date(pricing.discountWindowEndsAt).getTime() - Date.now();
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-4">
        <AlarmClock className="mt-0.5 size-5 shrink-0 text-amber-500" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            Pay-in-full discount window —{" "}
            <span className="tabular-nums text-amber-600 dark:text-amber-400">{formatRemaining(remaining)}</span> left
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Settle in full within this window for the best price. After it closes the standard price applies, and this
            quote stays valid until {formatDate(pricing.validUntil)}.
          </p>
        </div>
      </div>
    );
  }

  if (pricing.windowState === "standard") {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-border bg-muted/40 p-4">
        <CalendarClock className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">Quote valid until {formatDate(pricing.validUntil)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            The 72-hour pay-in-full discount window has closed. Standard pricing applies for the remainder of the
            30-day validity period.
          </p>
        </div>
      </div>
    );
  }

  // expired
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/[0.06] p-4">
      <CalendarClock className="mt-0.5 size-5 shrink-0 text-red-500" />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">This statement of work has expired</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          It was valid for 30 days from generation ({formatDate(pricing.validUntil)}). A fresh scan is needed to
          produce an up-to-date statement of work at current pricing.
        </p>
      </div>
    </div>
  );
}

// ── Read-only SOW document (same iframe pattern as AssessmentDocumentViewer) ────

function SowDocumentFrame({ title, htmlContent }: { title: string; htmlContent: string }) {
  const [fullscreen, setFullscreen] = useState(false);
  return (
    <>
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <span className="flex items-center gap-2 text-sm font-medium text-foreground">
            <FileText className="size-4 text-muted-foreground" />
            Statement of work
          </span>
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => setFullscreen(true)}>
            <Maximize2 className="size-3" />
            Full screen
          </Button>
        </div>
        <iframe
          srcDoc={htmlContent}
          title={title}
          className="w-full border-0 bg-white"
          style={{ height: "560px" }}
          sandbox="allow-same-origin"
        />
      </div>

      {fullscreen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/80">
          <div className="flex shrink-0 items-center justify-between border-b border-border bg-background px-5 py-3">
            <p className="truncate text-sm font-semibold text-foreground">{title}</p>
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setFullscreen(false)}>
              <X className="size-4" />
              Close
            </Button>
          </div>
          <iframe
            srcDoc={htmlContent}
            title={title}
            className="flex-1 border-0 bg-white"
            sandbox="allow-same-origin"
          />
        </div>
      )}
    </>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function AssessmentSowSelector({ fetchWithAuth }: { fetchWithAuth: FetchWithAuth }) {
  const [state, setState] = useState<SowState | null>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);

  // Local, unsaved workstream selection (drives the instant client-side preview).
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  // Set when a regeneration is in flight (either observed from the server or just
  // kicked off) so we show the honest "generating your updated scope" state.
  const [waitingRegen, setWaitingRegen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // The saved selection we last synced local `checked` to — so an incoming poll
  // that changes the active scope re-seeds the checkboxes, but a poll that doesn't
  // leaves the customer's in-progress toggles alone.
  const syncedSelectionRef = useRef<string | null>(null);

  const applyServerState = useCallback((next: SowState) => {
    setState(next);
    if (next.ready) {
      const key = normalizeSet(next.selectedWorkstreamTitles);
      if (syncedSelectionRef.current !== key) {
        setChecked(new Set(next.selectedWorkstreamTitles));
        syncedSelectionRef.current = key;
      }
    }
  }, []);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      setErrored(false);
      try {
        const res = await fetchWithAuth("/api/portal/assessment/sow", undefined, { silent: true });
        if (!res.ok) {
          setErrored(true);
          return;
        }
        applyServerState((await res.json()) as SowState);
      } catch {
        setErrored(true);
      } finally {
        setLoading(false);
      }
    },
    [fetchWithAuth, applyServerState],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while a regeneration is in flight, until the server reports it finished.
  const regenerating = (state?.regenerating ?? false) || waitingRegen;
  useEffect(() => {
    if (!regenerating) return;
    const t = setInterval(() => {
      void (async () => {
        try {
          const res = await fetchWithAuth("/api/portal/assessment/sow", undefined, { silent: true });
          if (!res.ok) return;
          const next = (await res.json()) as SowState;
          if (!next.regenerating) {
            // Regeneration settled — adopt the new active document + scope.
            syncedSelectionRef.current = null;
            applyServerState(next);
            setWaitingRegen(false);
          } else {
            setState(next);
          }
        } catch {
          /* best-effort; next tick retries */
        }
      })();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [regenerating, fetchWithAuth, applyServerState]);

  const ready = state?.ready ? state : null;

  const allTitles = useMemo(() => ready?.allWorkstreams.map((w) => w.title) ?? [], [ready]);
  const adjustmentsTotal = useMemo(
    () => ready?.adjustments.reduce((sum, a) => sum + a.priceUsd, 0) ?? 0,
    [ready],
  );
  const selectedWorkstreamTotal = useMemo(
    () => ready?.allWorkstreams.filter((w) => checked.has(w.title)).reduce((sum, w) => sum + w.priceUsd, 0) ?? 0,
    [ready, checked],
  );
  const previewTotal = selectedWorkstreamTotal + adjustmentsTotal;

  const savedSelectionKey = ready ? normalizeSet(ready.selectedWorkstreamTitles) : "";
  const currentSelectionKey = normalizeSet([...checked]);
  const dirty = ready != null && currentSelectionKey !== savedSelectionKey;
  const checkedIsFullScope = ready != null && currentSelectionKey === normalizeSet(allTitles);

  const toggle = useCallback((title: string) => {
    setActionError(null);
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  }, []);

  const applyScope = useCallback(
    async (titles: string[]) => {
      if (titles.length === 0) return;
      setSubmitting(true);
      setActionError(null);
      try {
        const res = await fetchWithAuth("/api/portal/assessment/sow/select", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ selectedWorkstreamTitles: titles }),
        });
        if (!res.ok) {
          setActionError("We couldn't update your scope just now. Please try again.");
          return;
        }
        const result = (await res.json()) as { regenerated: boolean };
        if (result.regenerated) {
          // Real AI regeneration in flight — show the generating state and poll.
          setWaitingRegen(true);
        } else {
          // Free re-activation of a stored version — reload immediately.
          syncedSelectionRef.current = null;
          await load({ silent: true });
        }
      } catch {
        setActionError("We couldn't update your scope just now. Please try again.");
      } finally {
        setSubmitting(false);
      }
    },
    [fetchWithAuth, load],
  );

  // ── Render states ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full rounded-2xl" />
        <Skeleton className="h-72 w-full rounded-2xl" />
      </div>
    );
  }

  if (errored) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-8 text-center">
        <FileSignature className="mx-auto size-8 text-muted-foreground/40" />
        <p className="mt-2 text-sm text-muted-foreground">We couldn't load your statement of work just now.</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => void load()}>
          Try again
        </Button>
      </div>
    );
  }

  if (!ready) {
    // No active SOW yet — it's still being prepared (or a first regeneration is running).
    return (
      <div className="rounded-2xl border border-dashed border-border p-8 text-center">
        <Loader2 className="mx-auto size-8 animate-spin text-muted-foreground/50" />
        <p className="mt-3 text-sm text-muted-foreground">
          Your statement of work is being prepared — it'll appear here shortly.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PricingWindowBanner pricing={ready.pricing} />

      {/* ── Scope selector + live total ── */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Sparkles className="size-4 text-primary" />
              Tailor your scope
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Toggle optional phases to see the price update instantly. When you're happy, update your scope to
              regenerate the statement of work.
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Total investment</p>
            <p className="text-3xl font-extrabold leading-none tracking-tight tabular-nums text-foreground">
              {usd.format(previewTotal)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground tabular-nums">
              {checked.size}/{allTitles.length} phase{allTitles.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>

        {/* Workstream phases (toggleable) */}
        <div className="mt-4 space-y-2">
          {ready.allWorkstreams.map((w) => {
            const isChecked = checked.has(w.title);
            return (
              <button
                key={w.title}
                type="button"
                onClick={() => toggle(w.title)}
                aria-pressed={isChecked}
                disabled={submitting || regenerating}
                className={cn(
                  "flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors disabled:cursor-not-allowed",
                  isChecked ? "border-primary/40 bg-primary/[0.04]" : "border-border bg-background hover:bg-muted/50",
                )}
              >
                <Checkbox checked={isChecked} className="mt-0.5 pointer-events-none" tabIndex={-1} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-medium text-foreground">{w.title}</span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                      {usd.format(w.priceUsd)}
                    </span>
                  </span>
                  {w.scope && <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{w.scope}</span>}
                  {(w.weeks != null || w.deliveryDate) && (
                    <span className="mt-1 block text-[11px] text-muted-foreground/80">
                      {w.weeks != null ? `${w.weeks} week${w.weeks === 1 ? "" : "s"}` : null}
                      {w.weeks != null && w.deliveryDate ? " · " : null}
                      {w.deliveryDate ? `delivery ${formatDate(w.deliveryDate)}` : null}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {/* Mandatory adjustments (shown, never toggleable) */}
        {ready.adjustments.length > 0 && (
          <div className="mt-3 rounded-xl border border-dashed border-border bg-muted/30 px-3.5 py-3">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <Lock className="size-3" />
              Included adjustments
            </p>
            <div className="mt-2 space-y-1.5">
              {ready.adjustments.map((a) => (
                <div key={a.title} className="flex items-center justify-between gap-3 text-xs">
                  <span className="truncate text-muted-foreground">{a.title}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{usd.format(a.priceUsd)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={() => void applyScope([...checked])} disabled={!dirty || checked.size === 0 || submitting || regenerating}>
            {submitting && !regenerating ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
            {dirty ? "Update my scope" : "Scope up to date"}
          </Button>
          {!checkedIsFullScope && (
            <Button
              variant="outline"
              onClick={() => {
                setChecked(new Set(allTitles));
                void applyScope(allTitles);
              }}
              disabled={submitting || regenerating}
            >
              <RotateCcw className="mr-1.5 size-4" />
              Reset to full scope
            </Button>
          )}
          {checked.size === 0 && (
            <span className="text-xs text-muted-foreground">Select at least one phase to continue.</span>
          )}
          {actionError && <span className="text-xs text-red-500">{actionError}</span>}
        </div>

        {dirty && !regenerating && (
          <p className="mt-3 text-xs text-muted-foreground">
            Updating regenerates a full, tailored statement of work for your selection — final pricing, including any
            adjustments, is confirmed then.
          </p>
        )}
      </div>

      {/* ── Regeneration state (honest — a real AI step, not instant) ── */}
      {regenerating ? (
        <div className="flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/[0.04] p-5">
          <Loader2 className="size-5 shrink-0 animate-spin text-primary" />
          <div>
            <p className="text-sm font-semibold text-foreground">Generating your updated scope…</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              We're rewriting your statement of work for the selected phases. This takes a moment — you can keep this
              page open.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 text-xs text-emerald-500">
            <CheckCircle2 className="size-3.5" />
            Showing your current statement of work{" "}
            {ready.doc.totalPrice != null ? <>— {usd.format(ready.doc.totalPrice)}</> : null}
          </div>
          <SowDocumentFrame title={ready.doc.title} htmlContent={ready.doc.htmlContent} />
        </>
      )}
    </div>
  );
}
