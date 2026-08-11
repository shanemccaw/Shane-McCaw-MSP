/**
 * remediation-tracker-catalogue.ts — Git #733 (Phase D1 of Epic #647).
 *
 * The CSV/PDF export needs a human title and pillar for each "s1".."s30" row
 * it prints, but the real catalogue lives in msp-portal's
 * `previewRemediationGuide.ts` and api-server cannot import across app
 * boundaries (independent Vite/Node apps — see CLAUDE.md). This mirrors the
 * same duplication `portal-remediation-tracker.ts`'s `REMEDIATION_TRACKER_STEP_IDS`
 * already accepted for the same reason: a small, explicitly-guarded copy
 * rather than a runtime cross-app import. `remediation-tracker-catalogue.test.ts`
 * reads the real file directly and fails if this list drifts from it.
 *
 * Deliberately holds only what an export row prints (id/label/pillar/title) —
 * not the scripts, blast-radius copy, or verify/caution text, which stay
 * exclusive to the in-app guide.
 */

export interface RemediationTrackerCatalogueStep {
  readonly id: string;
  readonly label: string;
  readonly pillar: string;
  readonly title: string;
}

export const REMEDIATION_TRACKER_CATALOGUE: readonly RemediationTrackerCatalogueStep[] = [
  { id: "s1", label: "Step 1", pillar: "governance", title: "Close org-wide sharing on the four sensitive sites" },
  { id: "s2", label: "Step 2", pillar: "governance", title: "Export the remaining 208 org-wide sites and route them to owners" },
  { id: "s3", label: "Step 3", pillar: "governance", title: "Expire all future anonymous links" },
  { id: "s4", label: "Step 4", pillar: "governance", title: "Revoke the 2,940 existing anonymous links" },
  { id: "s5", label: "Step 5", pillar: "governance", title: "Put a 12-month lifecycle policy on Groups, Teams and SharePoint" },
  { id: "s6", label: "Step 6", pillar: "governance", title: "Put Teams creation behind a request" },
  { id: "s7", label: "Step 7", pillar: "security", title: "Audit and fix MFA on the 11 admin accounts" },
  { id: "s8", label: "Step 8", pillar: "security", title: "Scope a Conditional Access policy to privileged roles" },
  { id: "s9", label: "Step 9", pillar: "security", title: "Re-enable CA01 and remove the 14 June exclusion" },
  { id: "s10", label: "Step 10", pillar: "security", title: "Disable legacy authentication" },
  { id: "s11", label: "Step 11", pillar: "security", title: "Reduce 11 standing Global Admins to 2 break-glass accounts" },
  { id: "s12", label: "Step 12", pillar: "security", title: "Reinstate the Safe Links policy disabled on 14 June" },
  { id: "s13", label: "Step 13", pillar: "security", title: "Take device compliance out of report-only" },
  { id: "s14", label: "Step 14", pillar: "compliance", title: "Publish a mandatory baseline sensitivity label set" },
  { id: "s15", label: "Step 15", pillar: "compliance", title: "Auto-label regulated content instead of asking 1,240 people" },
  { id: "s16", label: "Step 16", pillar: "compliance", title: "Extend DLP to Teams chat and OneDrive — in review mode" },
  { id: "s17", label: "Step 17", pillar: "compliance", title: "Extend retention to the six uncovered workloads" },
  { id: "s18", label: "Step 18", pillar: "compliance", title: "Raise audit log retention above the 90-day floor" },
  { id: "s19", label: "Step 19", pillar: "licensing", title: "Identify the 22 dormant Copilot seats" },
  { id: "s20", label: "Step 20", pillar: "licensing", title: "Reclaim them after a 14-day notice" },
  { id: "s21", label: "Step 21", pillar: "licensing", title: "Reconcile the 47 mismatched SKU assignments" },
  { id: "s22", label: "Step 22", pillar: "licensing", title: "Move to group-based licensing and retire the three legacy groups" },
  { id: "s23", label: "Step 23", pillar: "adoption", title: "Pull the real usage baseline before planning any training" },
  { id: "s24", label: "Step 24", pillar: "adoption", title: "Move one real recurring workflow per department into a channel" },
  { id: "s25", label: "Step 25", pillar: "adoption", title: "Train the three ready personas first" },
  { id: "s26", label: "Step 26", pillar: "adoption", title: "Stop attaching documents to email by default" },
  { id: "s27", label: "Step 27", pillar: "health", title: "Capture a signed configuration baseline" },
  { id: "s28", label: "Step 28", pillar: "health", title: "Resolve the 214 OneDrive sync errors" },
  { id: "s29", label: "Step 29", pillar: "health", title: "Attest and dispose of 148 inactive sites and 19 orphaned channels" },
  { id: "s30", label: "Step 30", pillar: "health", title: "Put drift telemetry on the tenant" },
] as const;

/**
 * Real copy, straight out of `RemediationGuideBody.tsx`'s own `ACTION_LABELS`
 * (which sources it from `Design/Remediation Tracker.dc.html`) for the four
 * actioned statuses, plus the two states that constant doesn't cover.
 */
export const REMEDIATION_TRACKER_STATUS_LABELS: Readonly<Record<string, string>> = {
  not_started: "Not started",
  completed: "Completed",
  already_handled: "Already handled another way",
  not_applicable: "Not applicable to this tenant",
  deferred: "Deferring to a later phase",
  shane_handles: "Have Shane do this one",
};
