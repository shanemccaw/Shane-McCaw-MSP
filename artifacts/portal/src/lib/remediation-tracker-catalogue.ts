/**
 * The remediation tracker's fixed 28-step catalogue, as rendered on the
 * customer portal (#3037, Feature #1489).
 *
 * Mirrored verbatim from `artifacts/api-server/src/lib/remediation-tracker-
 * catalogue.ts`'s `REMEDIATION_TRACKER_CATALOGUE` — api-server cannot be
 * imported from here (independent Vite/Node apps, see CLAUDE.md), and that
 * file's own header documents the identical duplication for the same reason.
 * This is the SAME real, tested catalogue (id/pillar/title, ids s1-s23 +
 * s26-s30, gap at s24/s25 per #757), not an invented one — keep it in sync by
 * hand if the source ever changes; there is no cross-app drift test for this
 * particular mirror the way there is for the DB-facing one.
 *
 * `PHASE_PILLARS`/`PILLAR_FEE`/`FULL_PROGRAMME_FEE` are NOT duplicated here —
 * those drive money and stay server-computed
 * (`remediation-tracker-pricing.ts`'s `pricing` block on the GET response).
 * This module holds only the step *identity* the client needs to render the
 * catalogue the pricing numbers are about. `PHASE_PILLARS` (which two pillars
 * make up each of the three phases) is reproduced here ONLY as a fixed,
 * cited grouping key — not re-derived — because the wire's `pricing.phases`
 * array already carries each phase's own `pillars` list; this constant exists
 * to group the STEP rows the same way, not to recompute money.
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
  // Steps 24 & 25 (workflow-per-department, persona training) removed in #757 —
  // adoption/rollout guidance for White-Glove Copilot Adoption (#350/#668), not
  // remediation. Ids are NOT renumbered: s26 keeps its own number.
  { id: "s26", label: "Step 26", pillar: "adoption", title: "Stop attaching documents to email by default" },
  { id: "s27", label: "Step 27", pillar: "health", title: "Capture a signed configuration baseline" },
  { id: "s28", label: "Step 28", pillar: "health", title: "Resolve the 214 OneDrive sync errors" },
  { id: "s29", label: "Step 29", pillar: "health", title: "Attest and dispose of 148 inactive sites and 19 orphaned channels" },
  { id: "s30", label: "Step 30", pillar: "health", title: "Put drift telemetry on the tenant" },
] as const;

export type RemediationCataloguePillar = "governance" | "security" | "compliance" | "licensing" | "adoption" | "health";
export type RemediationCataloguePhase = 1 | 2 | 3;

/** The tracker's fixed phase→pillar grouping — `remediation-tracker-pricing.ts:96-100`. */
export const REMEDIATION_PHASE_PILLARS: Readonly<Record<RemediationCataloguePhase, readonly RemediationCataloguePillar[]>> = {
  1: ["governance", "security"],
  2: ["compliance", "licensing"],
  3: ["adoption", "health"],
};

const CATALOGUE_BY_ID = new Map(REMEDIATION_TRACKER_CATALOGUE.map((s) => [s.id, s]));

export function catalogueStep(stepId: string): RemediationTrackerCatalogueStep | undefined {
  return CATALOGUE_BY_ID.get(stepId);
}

export function stepsForPhase(phase: RemediationCataloguePhase): readonly RemediationTrackerCatalogueStep[] {
  const pillars = new Set<string>(REMEDIATION_PHASE_PILLARS[phase]);
  return REMEDIATION_TRACKER_CATALOGUE.filter((s) => pillars.has(s.pillar));
}

/**
 * The three steps with no automated check behind them at all (contract pack
 * §4c, confirmed against `STEP_CHECK_KEYS`/`STEP_CHECK_GAPS`/
 * `PROCESS_ONLY_STEP_IDS` in `remediationLiveGuide.ts`): s18 is a real,
 * platform-wide measurement gap; s27/s30 are process steps that expect no
 * check. This is permanent, not a scan that has not happened yet.
 */
export const REMEDIATION_STEPS_WITH_NO_CHECK: ReadonlySet<string> = new Set(["s18", "s27", "s30"]);
