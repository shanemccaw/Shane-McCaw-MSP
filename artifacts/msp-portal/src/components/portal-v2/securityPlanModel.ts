/**
 * securityPlanModel.ts — the Security Plan derivations.
 *
 * The plan's whole claim is that it cannot quietly drift from the tenant, so its
 * headline numbers are DERIVED from the requirement rows rather than stated: the
 * met / partly-met / not-met counts, the percentage, the one-line verdict, and
 * the per-section gap badge. The prototype builds these inline (shell
 * 20199-20242); each is transcribed with its reference.
 */

import type { SecPlanSection, SecPlanState, SecPlanRow, SecurityPlan } from "./securityPlanData";

/** State → colour and label. Prototype `meta` (shell 20230). */
export const SP_STATE_META: Record<SecPlanState, { readonly color: string; readonly label: string }> = {
  met: { color: "#34d399", label: "Met" },
  partial: { color: "#fbbf24", label: "Partly met" },
  gap: { color: "#f87171", label: "Not met" },
};

/** Every requirement across every section, flattened. Prototype `all` (20201). */
export function spAllRows(plan: SecurityPlan): readonly SecPlanRow[] {
  return plan.sections.reduce<SecPlanRow[]>((a, s) => a.concat(s.rows), []);
}

export interface SpCounts {
  readonly met: number;
  readonly partial: number;
  readonly gap: number;
  readonly total: number;
}

/** The header tallies — prototype shell 20202-20204, 20208. */
export function spCounts(plan: SecurityPlan): SpCounts {
  const all = spAllRows(plan);
  return {
    met: all.filter((r) => r.state === "met").length,
    partial: all.filter((r) => r.state === "partial").length,
    gap: all.filter((r) => r.state === "gap").length,
    total: all.length,
  };
}

/** The met percentage — prototype shell 20209. */
export function spPct(plan: SecurityPlan): number {
  const { met, total } = spCounts(plan);
  return Math.round((met / total) * 100);
}

/** The one-line verdict — prototype shell 20211. */
export function spVerdict(plan: SecurityPlan): string {
  const { gap, partial } = spCounts(plan);
  return gap === 0
    ? "Every requirement in this plan is met."
    : `${gap} requirements in this plan are not met, and ${partial} are only partly met.`;
}

/** How many not-met rows a section carries — prototype shell 20216. */
export function spSectionGaps(section: SecPlanSection): number {
  return section.rows.filter((r) => r.state === "gap").length;
}

/**
 * The section selected in the left rail. The prototype defaults to 'governance'
 * (shell 20215/20229); an unknown key falls back to the first section rather
 * than rendering nothing.
 */
export function spSelectedSection(plan: SecurityPlan, key: string): SecPlanSection {
  return plan.sections.find((s) => s.k === key) ?? plan.sections[0];
}
