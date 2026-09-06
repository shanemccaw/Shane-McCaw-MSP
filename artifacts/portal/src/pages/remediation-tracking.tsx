/**
 * Remediation Tracking (#3037, Feature #1489) — real Design export
 * (`Design/portal/design_handoff_full_site/screens/Remediation Tracking.dc.html`)
 * wired against `docs/remediation-tracking-contract-pack.md`.
 *
 * This page currently mounts only the "28-step programme" tab (§1a — this
 * issue's own scope). The design's other two tabs — "Your findings"
 * (checklist/fix-routes/reveal, §1b-1e, #3038) and "Fixed outside change
 * control" (bypass-resolutions, §1e, #3038), plus the pillar-scores panel and
 * CSV/PDF/evidence exports on this same tab (§1f-1g, #3039) — are separate,
 * real functional units dispatched as their own issues under the same
 * Feature and are not yet wired. Once they land, the tab strip the design
 * calls for goes here; there is no fabricated tab in the meantime.
 */
import { RemediationProgrammeTab } from "@/components/remediation-tracker/RemediationProgrammeTab";

export default function RemediationTrackingPage() {
  return (
    <div className="flex flex-col gap-4 pb-14">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight text-foreground">Remediation tracking</h1>
        <span
          title="Three separate facts per item: what you claim, whether a re-scan agreed, and how it finally resolved. A tick on its own is never evidence."
          className="flex size-[17px] cursor-help items-center justify-center rounded-full border border-muted-foreground/35 text-[10px] font-bold text-muted-foreground"
        >
          i
        </span>
      </div>

      <RemediationProgrammeTab />
    </div>
  );
}
