import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useScopeStatus, useSlaStatus } from "@/lib/scope-sla-api";
import type { OverallStatus, ScopeAreaStatus } from "@/lib/scope-sla-types";

const OVERALL_STYLES: Record<OverallStatus, { label: string; ink: string; border: string; bg: string; pill: string }> = {
  on_track: {
    label: "On track",
    ink: "text-status-green",
    border: "border-status-green/30",
    bg: "bg-muted/5",
    pill: "bg-status-green/10 border-status-green/30 text-status-green",
  },
  attention_needed: {
    label: "Attention needed",
    ink: "text-status-amber",
    border: "border-status-amber/35",
    bg: "bg-status-amber/[.03]",
    pill: "bg-status-amber/10 border-status-amber/35 text-status-amber",
  },
  action_required: {
    label: "Action required",
    ink: "text-status-red",
    border: "border-status-red/35",
    bg: "bg-status-red/[.03]",
    pill: "bg-status-red/10 border-status-red/35 text-status-red",
  },
};

const AREA_STYLES: Record<ScopeAreaStatus, { label: string; ink: string; border: string; dot: string }> = {
  ok: { label: "Fine", ink: "text-status-green", border: "border-status-green/30", dot: "bg-status-green" },
  notice: { label: "Worth a look", ink: "text-status-amber", border: "border-status-amber/35", dot: "bg-status-amber" },
  alert: { label: "Needs action", ink: "text-status-red", border: "border-status-red/35", dot: "bg-status-red" },
};

const LEDGER: { gap: string; where: string }[] = [
  {
    gap: "No per-request breakdown, ticket references, policy names or internal scores. The routes translate to headline, subtext and counts; the page draws only what is served.",
    where: "§1 · §2",
  },
  {
    gap: "Always three scope areas. The route returns exactly three, so the page never adds a fourth or hides an empty one.",
    where: "§2",
  },
  {
    gap: '"Needs action" can appear on an area whose own change is small, because any open violation escalates every exceeded area. The page explains that beside the list.',
    where: "§2",
  },
  {
    gap: '"Computed at" is when this page opened. Neither reading is stored; there is no last-run time to show.',
    where: "§3",
  },
  {
    gap: "No numeric compliance figure for scope. Only the SLA reading serves one, and only as the server's label.",
    where: "§2",
  },
  {
    gap: "The Overview's SLA and scope scores come from a stored snapshot and can disagree with these live readings; the page names that rather than reconciling it.",
    where: "§7",
  },
  {
    gap: "A failed read shows the server's own message and no substitute figures.",
    where: "§6",
  },
];

function formatUpdatedAt(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
}

function LoadingCard() {
  return (
    <div className="flex animate-pulse flex-col gap-3 rounded-xl border border-border/60 bg-muted/10 p-5">
      <div className="h-2.5 w-2/5 rounded-full bg-muted-foreground/20" />
      <div className="h-4 w-4/5 rounded-full bg-muted-foreground/15" />
      <div className="h-2 w-3/5 rounded-full bg-muted-foreground/10" />
    </div>
  );
}

function ErrorCard({ message, onRetry, retrying }: { message: string; onRetry: () => void; retrying: boolean }) {
  return (
    <div className="flex gap-2.5 rounded-xl border border-dashed border-status-red/45 bg-status-red/[.06] p-4">
      <AlertTriangle className="mt-0.5 size-4 flex-none text-status-red" />
      <div className="flex flex-col gap-1">
        <span className="text-[13px] font-semibold text-foreground">{message}</span>
        <span className="max-w-[560px] text-xs leading-relaxed text-muted-foreground">
          Both readings compute live, so a failed read has no cached figure to fall back on — nothing is shown in
          its place.
        </span>
        <Button
          variant="link"
          size="sm"
          className="h-auto w-fit p-0 text-[11.5px]"
          onClick={onRetry}
          disabled={retrying}
        >
          {retrying && <Loader2 className="size-3 animate-spin" />}
          Try again
        </Button>
      </div>
    </div>
  );
}

export default function ScopeAndSlaPage() {
  const sla = useSlaStatus();
  const scope = useScopeStatus();
  const [ledgerOpen, setLedgerOpen] = useState(true);

  const bothFailed = sla.isError && scope.isError;
  const bothLoading = sla.isLoading && scope.isLoading;
  const anyLive = (sla.data && !sla.isError) || (scope.data && !scope.isError);

  return (
    <div className="flex flex-col gap-4 pb-14" data-testid="scope-and-sla-page">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight text-foreground">Service and scope</h1>
        <span
          title="Two live readings, recomputed every time this page opens: whether your provider is answering requests within the agreed times, and whether the work being done matches what was agreed."
          className="flex size-[17px] cursor-help items-center justify-center rounded-full border border-muted-foreground/35 text-[10px] font-bold text-muted-foreground"
        >
          i
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground" data-testid="scope-and-sla-status">
          <span className={cn("size-1.5 rounded-full", bothFailed ? "bg-status-red" : bothLoading ? "bg-muted-foreground" : "bg-status-green")} />
          {bothLoading
            ? "Reading your service and scope status"
            : bothFailed
              ? "Could not compute your readings"
              : "Live — computed just now"}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {sla.isLoading ? (
          <LoadingCard />
        ) : sla.isError ? (
          <ErrorCard
            message={sla.error instanceof Error ? sla.error.message : "Unable to load your service status right now. Please try again shortly."}
            onRetry={() => void sla.refetch()}
            retrying={sla.isRefetching}
          />
        ) : sla.data ? (
          (() => {
            const s = sla.data;
            const st = OVERALL_STYLES[s.overall];
            return (
              <div className={cn("flex flex-col gap-3 rounded-2xl border p-5", st.border, st.bg)} data-testid="scope-and-sla-sla-card">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-[9px] font-bold tracking-[0.09em] text-muted-foreground/80">RESPONSE TIMES</span>
                  <Badge variant="outline" className={cn("ml-auto", st.pill)}>
                    {st.label}
                  </Badge>
                </div>
                <span className="text-[17px] font-bold leading-tight tracking-tight text-foreground">{s.headline}</span>
                <span className="text-[12.5px] leading-relaxed text-muted-foreground">{s.subtext}</span>
                <div className="grid grid-cols-3 gap-2.5 border-t border-border/50 pt-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[9px] font-bold tracking-[0.09em] text-muted-foreground/80">OPEN</span>
                    <span className="text-xl font-bold tabular-nums tracking-tight text-foreground">{s.openRequests}</span>
                    <span className="text-[10.5px] text-muted-foreground">requests with a clock running</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[9px] font-bold tracking-[0.09em] text-muted-foreground/80">APPROACHING</span>
                    <span className={cn("text-xl font-bold tabular-nums tracking-tight", s.activeWarnings ? "text-status-amber" : "text-foreground")}>
                      {s.activeWarnings}
                    </span>
                    <span className="text-[10.5px] text-muted-foreground">near their target</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[9px] font-bold tracking-[0.09em] text-muted-foreground/80">OVER</span>
                    <span className={cn("text-xl font-bold tabular-nums tracking-tight", s.activeIssues ? "text-status-red" : "text-foreground")}>
                      {s.activeIssues}
                    </span>
                    <span className="text-[10.5px] text-muted-foreground">past their target</span>
                  </div>
                </div>
                <div className="flex flex-col gap-1 border-t border-border/50 pt-3">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-[12.5px] text-foreground/90">{s.complianceLabel}</span>
                    <span className="text-[11px] text-muted-foreground">· {s.responsePerformanceLabel}</span>
                  </div>
                  <span className="text-[10.5px] text-muted-foreground">
                    Computed at {formatUpdatedAt(s.updatedAt)} — a fresh evaluation each time, not a stored figure.
                  </span>
                </div>
              </div>
            );
          })()
        ) : null}

        {scope.isLoading ? (
          <LoadingCard />
        ) : scope.isError ? (
          <ErrorCard
            message={scope.error instanceof Error ? scope.error.message : "Unable to load your project status right now. Please try again shortly."}
            onRetry={() => void scope.refetch()}
            retrying={scope.isRefetching}
          />
        ) : scope.data ? (
          (() => {
            const c = scope.data;
            const st = OVERALL_STYLES[c.overall];
            return (
              <div className={cn("flex flex-col gap-3 rounded-2xl border p-5", st.border, st.bg)} data-testid="scope-and-sla-scope-card">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-[9px] font-bold tracking-[0.09em] text-muted-foreground/80">AGREED SCOPE</span>
                  <Badge variant="outline" className={cn("ml-auto", st.pill)}>
                    {st.label}
                  </Badge>
                </div>
                <span className="text-[17px] font-bold leading-tight tracking-tight text-foreground">{c.headline}</span>
                <span className="text-[12.5px] leading-relaxed text-muted-foreground">{c.subtext}</span>
                <div className="flex flex-col border-t border-border/50 pt-1.5">
                  {c.areas.map((a) => {
                    const at = AREA_STYLES[a.status];
                    return (
                      <div key={a.key} className="flex items-start gap-3 border-b border-border/30 py-2.5 last:border-b-0">
                        <span className={cn("mt-1.5 size-2 flex-none rounded-full", at.dot)} />
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="text-[12.5px] text-foreground/90">{a.label}</span>
                          <span className="text-[11.5px] leading-relaxed text-muted-foreground">{a.message}</span>
                        </div>
                        <Badge variant="outline" className={cn("flex-none", at.ink, at.border)}>
                          {at.label}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[12.5px] text-foreground/90">{c.openItems} open items across the three areas</span>
                  <span className="text-[10.5px] leading-relaxed text-muted-foreground">
                    Computed at {formatUpdatedAt(c.updatedAt)}. Any open violation raises every exceeded area to
                    "needs action" at once — the violation count is scored for the whole engagement, not per area.
                  </span>
                </div>
              </div>
            );
          })()
        ) : null}
      </div>

      {anyLive && (
        <Card className="bg-muted/5">
          <CardContent className="flex flex-col gap-2.5 pt-6">
            <span className="text-[13.5px] font-semibold text-foreground">What these two readings are</span>
            <span className="max-w-[720px] text-xs leading-relaxed text-muted-foreground">
              Response times compare each open request against the target your agreement sets for its priority.
              Agreed scope watches three things against what was signed: deliverables that changed, work added
              beyond the agreement, and timeline slip. Both are translated for you — the per-request breakdown,
              policy names and internal scores stay with your provider.
            </span>
            <span className="max-w-[720px] text-[11px] leading-relaxed text-muted-foreground/70">
              The Overview's SLA and scope scores come from a stored snapshot and can differ from these live
              readings; when they disagree, this page is the fresher of the two.
            </span>
          </CardContent>
        </Card>
      )}

      <Card className="bg-muted/5">
        <CardContent className="flex flex-col gap-2.5 pt-6">
          <div className="flex items-baseline gap-2.5">
            <span className="text-[13px] font-semibold text-foreground">What this page deliberately does not do</span>
            <Button
              variant="link"
              size="sm"
              className="ml-auto h-auto p-0 text-[11.5px] font-semibold text-muted-foreground"
              onClick={() => setLedgerOpen((o) => !o)}
            >
              {ledgerOpen ? "Collapse" : "Expand"}
            </Button>
          </div>
          {ledgerOpen && (
            <div className="flex flex-col">
              {LEDGER.map((l, i) => (
                <div key={i} className="flex items-start gap-3 border-t border-border/50 py-2 first:border-t-0">
                  <span className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-foreground">{l.gap}</span>
                  <span className="flex-none font-mono text-[10.5px] text-muted-foreground/70">{l.where}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
