import { Badge } from "@/components/ui/badge";
import type { BypassResolution, RemediationChecklistItem } from "@/lib/remediation-checklist-types";
import { formatDateTime, verdictSwatch } from "@/lib/remediation-checklist-visuals";
import { cn } from "@/lib/utils";

function Fact({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-[11.5px] leading-relaxed text-foreground">{value}</span>
    </div>
  );
}

/**
 * A tracker step verified alongside a same-run, out-of-change-control drift
 * event (#1543) — purely observational, never enforcement or scoring.
 * `stepId` addresses the same `remediation_tracker_steps` table this
 * checklist writes to, so a title is only resolvable here when it happens to
 * match one of the customer's current findings-derived items; the legacy
 * s1-s30 catalogue (#3037's scope) is not available on this page.
 */
export function BypassResolutionCard({
  resolution,
  checklistItems,
}: {
  readonly resolution: BypassResolution;
  readonly checklistItems: readonly RemediationChecklistItem[];
}) {
  const matchedItem = checklistItems.find((i) => i.checkKey === resolution.stepId);
  const verdict = verdictSwatch(resolution.driftEvent.verdict);
  const changedBy = resolution.driftEvent.changedBy ?? "No actor recorded in the audit log for this change";

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-border/60 bg-muted/5 p-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-mono text-[10px] text-muted-foreground/70">{resolution.stepId}</span>
        <span className="text-[13px] font-semibold text-foreground">
          {matchedItem?.title ?? `Domain: ${resolution.domainKey}`}
        </span>
        <Badge variant="outline" className={cn("ml-auto text-[9.5px] font-bold tracking-wider", verdict.text, verdict.bg, verdict.border)}>
          {verdict.label}
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Fact label="Verified" value={`${formatDateTime(resolution.verifiedAt)}, every mapped check clean`} />
        <Fact label="Change seen" value={`${resolution.driftEvent.op} on ${resolution.driftEvent.setting}`} />
        <Fact label="Attributed to" value={changedBy} />
        <Fact label="Change request" value="None — no approved CR covers this window" />
      </div>
    </div>
  );
}
