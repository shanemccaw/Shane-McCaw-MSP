/**
 * "Phases and fees" + the "Hire Shane" CTA (#3037) — the `pricing` block that
 * ships on `GET /portal/remediation-tracker` (§1a), computed live server-side
 * by `remediation-tracker-pricing.ts`. Nothing here is recomputed; the phase
 * fees and the hire price are rendered exactly as the server returns them.
 *
 * The per-phase verified/accepted/claimed breakdown bar IS computed
 * client-side — from the real `steps` array the same GET response already
 * carries, joined against the catalogue's real phase/pillar grouping. That is
 * presentation over real wire data, not a second source of truth for the fee
 * itself (the fee stays server-authored).
 */
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { stepsForPhase } from "@/lib/remediation-tracker-catalogue";
import type { RemediationTrackerPricing, WireTrackerStep } from "@/lib/remediation-tracker-types";

const READY_STATUSES = new Set(["completed", "already_handled", "not_applicable", "deferred", "accepted_risk"]);

export function PricingPanel({
  pricing,
  stepsById,
}: {
  pricing: RemediationTrackerPricing;
  stepsById: ReadonlyMap<string, WireTrackerStep>;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-[13.5px] font-semibold text-foreground">Phases and fees</span>
          <span className="text-[11px] text-muted-foreground">
            a phase prices down only once every step in it reaches a terminal decision
          </span>
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          {pricing.phases.map((ph) => {
            const steps = stepsForPhase(ph.phase);
            const total = steps.length || 1;
            const verified = steps.filter((s) => stepsById.get(s.id)?.verificationState === "verified").length;
            const accepted = steps.filter(
              (s) => stepsById.get(s.id)?.status === "accepted_risk" && stepsById.get(s.id)?.verificationState !== "verified",
            ).length;
            const claimed = steps.filter((s) => READY_STATUSES.has(stepsById.get(s.id)?.status ?? "not_started")).length;
            const untouchedPct = Math.round(((total - claimed) / total) * 100);
            const claimedOnlyPct = Math.round(((claimed - verified - accepted) / total) * 100);
            const verifiedPct = Math.round((verified / total) * 100);
            const acceptedPct = Math.round((accepted / total) * 100);

            return (
              <div
                key={ph.phase}
                className={cn(
                  "flex flex-col gap-2 rounded-lg border p-3",
                  ph.ready ? "border-status-green/25 bg-status-green/[.03]" : "border-border/60",
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Phase {ph.phase}</span>
                  <span
                    className={cn(
                      "ml-auto rounded-full border px-1.5 py-0.5 text-[9.5px] font-bold tracking-wider",
                      ph.ready ? "border-status-green/40 text-status-green" : "border-border text-muted-foreground",
                    )}
                  >
                    {ph.ready ? "PHASE READY" : "NOT READY"}
                  </span>
                </div>
                <span className="text-[12px] text-muted-foreground">
                  {ph.pillars[0]} + {ph.pillars[1]}
                </span>
                <span className="text-xl font-extrabold tabular-nums text-foreground">{ph.feeDisplay}</span>
                <div className="flex h-1.5 overflow-hidden rounded-full bg-muted/20">
                  <div className="bg-status-green" style={{ width: `${verifiedPct}%` }} />
                  <div className="bg-violet-400" style={{ width: `${acceptedPct}%` }} />
                  <div className="bg-status-green/30" style={{ width: `${claimedOnlyPct}%` }} />
                  <div className="bg-transparent" style={{ width: `${untouchedPct}%` }} />
                </div>
                <span className="text-[10.5px] tabular-nums text-muted-foreground">
                  {verified} verified · {accepted} accepted as risk · {claimed - verified - accepted} claimed, unverified · {total - claimed} untouched
                </span>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-border/50 pt-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline gap-2">
              <span className="text-[12.5px] font-semibold text-foreground">{pricing.hire.cta}</span>
              <span className="text-base font-extrabold tabular-nums text-foreground">{pricing.hire.price}</span>
              {pricing.hire.wasShow && (
                <span className="text-[11.5px] text-muted-foreground line-through tabular-nums">{pricing.hire.was}</span>
              )}
              {pricing.hire.savedShow && (
                <span className="text-[11.5px] font-semibold tabular-nums text-status-green">{pricing.hire.saved} off</span>
              )}
            </div>
            <span className="max-w-[620px] text-[11px] leading-relaxed text-muted-foreground">{pricing.hire.note}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
