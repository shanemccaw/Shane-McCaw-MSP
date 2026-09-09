import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useRemediationPillarScores } from "@/lib/remediation-tracker-scores-api";
import {
  REMEDIATION_TRACKER_PILLAR_KEYS,
  REMEDIATION_TRACKER_PILLAR_LABELS,
  type PillarScore,
  type PillarScoreStatus,
  type RemediationTrackerPillarKey,
} from "@/lib/remediation-tracker-scores-types";
import { cn } from "@/lib/utils";

const GATE_SWATCH: Record<PillarScoreStatus, { label: string; className: string; dashed?: boolean }> = {
  scored: { label: "SCORED", className: "text-status-green border-status-green/35" },
  single_scan: { label: "SINGLE SCAN", className: "text-status-amber border-status-amber/40" },
  insufficient_data: { label: "NO SCORE", className: "text-muted-foreground border-border", dashed: true },
};

function subLine(score: PillarScore): string {
  if (score.status === "insufficient_data") return "never scanned";
  if (score.status === "single_scan") return "one scan · nothing to compare";
  return `day one ${score.dayOne ?? "—"} · before ${score.before ?? "—"}`;
}

function deltaClassName(delta: number | null): string {
  if (delta === null) return "text-muted-foreground";
  if (delta > 0) return "text-status-green";
  if (delta < 0) return "text-status-red";
  return "text-muted-foreground";
}

/**
 * Pillar scores card + Copilot gate (§1f, `docs/portal/remediation-tracking-contract-pack.md`).
 * Wired to the real `GET /portal/remediation-tracker/pillar-scores` — a pillar
 * with no snapshot renders "no score at all", never a fabricated number
 * (route header, `portal-remediation-tracker-scores.ts:44-48`).
 */
export function PillarScoresCard() {
  const { data, isLoading, isError } = useRemediationPillarScores();
  const [openPillar, setOpenPillar] = useState<RemediationTrackerPillarKey | null>(null);

  const openScore = openPillar && data ? data.pillars[openPillar] : undefined;

  return (
    <Card data-testid="remediation-pillar-scores-card">
      <CardHeader className="gap-1.5 space-y-0">
        <div className="flex flex-wrap items-baseline gap-2.5">
          <span className="text-[13.5px] font-semibold text-foreground">Pillar scores</span>
          {data && (
            <span className="text-[11px] text-muted-foreground">
              {data.meta.hasAnyHistory ? "from your real scan history" : "no scan history yet"}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3.5 pt-0">
        {isLoading && (
          <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Reading pillar scores…
          </div>
        )}
        {isError && <p className="py-3 text-xs text-status-red">Pillar scores could not be read.</p>}

        {!isLoading && !isError && data && (
          <>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
              {REMEDIATION_TRACKER_PILLAR_KEYS.map((key) => {
                const score = data.pillars[key];
                if (!score) return null;
                const gate = GATE_SWATCH[score.status];
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setOpenPillar(key)}
                    data-testid={`pillar-score-tile-${key}`}
                    className="flex flex-col gap-1.5 rounded-[11px] border border-border bg-card/60 p-2.5 pb-3 text-left transition-colors hover:border-primary/40"
                  >
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {REMEDIATION_TRACKER_PILLAR_LABELS[key]}
                    </span>
                    <div className="flex items-baseline gap-1.5">
                      <span
                        className={cn(
                          "text-2xl font-extrabold tabular-nums tracking-tight",
                          score.now === null ? "text-muted-foreground/50" : "text-foreground",
                        )}
                      >
                        {score.now ?? "—"}
                      </span>
                      {score.delta !== null && (
                        <span className={cn("text-xs font-bold tabular-nums", deltaClassName(score.delta))}>
                          {score.delta > 0 ? `+${score.delta}` : score.delta}
                        </span>
                      )}
                    </div>
                    <span className="text-[10.5px] leading-snug text-muted-foreground">{subLine(score)}</span>
                    <Badge
                      variant="outline"
                      className={cn(
                        "w-fit text-[9.5px] font-bold tracking-wide",
                        gate.className,
                        gate.dashed && "border-dashed",
                      )}
                    >
                      {gate.label}
                    </Badge>
                  </button>
                );
              })}
            </div>

            <div className="flex items-start gap-2.5 border-t border-border/60 pt-3">
              <ShieldCheck className="mt-0.5 size-[15px] flex-none text-muted-foreground" />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[12.5px] font-semibold text-foreground">
                  Copilot gate — {data.copilotGate.status === "go" ? "Go" : data.copilotGate.status === "no_go" ? "No-Go" : "Not ready"}
                </span>
                <span className="text-[11.5px] leading-relaxed text-muted-foreground">
                  {data.copilotGate.score === null
                    ? data.copilotGate.evaluation.reason
                    : `Score ${data.copilotGate.score} vs threshold ${data.copilotGate.threshold}.`}
                </span>
              </div>
            </div>

            <span className="text-[10.5px] text-muted-foreground/70">
              A pillar with one scan has no before and no movement. A pillar with no scan has no
              score at all — neither is rendered as zero.
            </span>
          </>
        )}
      </CardContent>

      <Dialog open={openPillar !== null} onOpenChange={(open) => !open && setOpenPillar(null)}>
        <DialogContent>
          {openPillar && openScore && (
            <>
              <DialogHeader>
                <DialogTitle>{REMEDIATION_TRACKER_PILLAR_LABELS[openPillar]} pillar</DialogTitle>
                <DialogDescription>
                  {openScore.scanCount} {openScore.scanCount === 1 ? "snapshot" : "snapshots"} ·{" "}
                  {openScore.status.replace("_", " ")}
                </DialogDescription>
              </DialogHeader>
              <dl className="flex flex-col gap-3 text-sm">
                <div>
                  <dt className="text-xs font-semibold text-foreground">
                    Now · {openScore.now === null ? "no score" : openScore.now}
                  </dt>
                  <dd className="text-xs text-muted-foreground">
                    {openScore.now === null
                      ? "Zero snapshots exist for this pillar. There is no score to show and none is implied."
                      : "The latest scan's real score."}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-foreground">
                    Before · {openScore.before === null ? "none" : openScore.before}
                  </dt>
                  <dd className="text-xs text-muted-foreground">
                    {openScore.before === null
                      ? "Fewer than two snapshots — nothing to compare against yet."
                      : "The prior scan's stamped score, not recomputed here."}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-foreground">
                    Day one · {openScore.dayOne === null ? "none" : openScore.dayOne}
                  </dt>
                  <dd className="text-xs text-muted-foreground">
                    {openScore.dayOne === null
                      ? "No first scan has happened."
                      : "The tenant's very first real score, kept permanently."}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-foreground">
                    Delta · {openScore.delta === null ? "none" : openScore.delta > 0 ? `+${openScore.delta}` : openScore.delta}
                  </dt>
                  <dd className="text-xs text-muted-foreground">
                    {openScore.delta === null ? "Requires a before value." : "now minus before."}
                  </dd>
                </div>
              </dl>
              <p className="text-[11px] text-muted-foreground/70">
                A missing number here is a missing scan, never a zero. The tracker does not invent
                its own scores.
              </p>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
