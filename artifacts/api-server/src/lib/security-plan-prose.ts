/**
 * security-plan-prose.ts — the Security Plan's authored prose (#1566, formalizing the
 * #1561 stub, part of #1495/#1485).
 *
 * "A real security plan carries scope, methodology, exclusions and an executive
 * summary — content no module owns." These four sections (`SECURITY_PLAN_PROSE_SECTIONS`
 * in `@workspace/db`) are the only data this module itself authors; everything else in
 * `SecurityPlanContent` is read from another module.
 *
 * Versioning rule (#1566): "scope and methodology barely change between versions; an
 * executive summary changes every time. If every version demands a full rewrite,
 * nobody will produce versions." So every section is CARRIED FORWARD BY DEFAULT from
 * the plan's last version, and only the sections actually touched while authoring the
 * version being sealed now are marked `editedInThisVersion`.
 *
 * PURE — no DB access. `carryForwardProse` and `applyProseEdit` are the whole
 * carry-forward/edit-marking guarantee, unit-testable without seeding, the same shape
 * as `applyScopeAndFootprint` (#1563/#1565) and `computeSecurityPlanDrift` (#1562).
 */
import { SECURITY_PLAN_PROSE_SECTIONS, type SecurityPlanProse, type SecurityPlanProseSection, type SecurityPlanProseSectionContent } from "@workspace/db";

/** An empty section: no text authored yet, so nothing to have "edited". Used both for
 * a brand-new plan's first draft (no prior version to carry forward) and as the shape
 * every section starts from before a value is known. */
function emptySection(): SecurityPlanProseSectionContent {
  return { text: "", editedInThisVersion: false };
}

/** All four sections empty — the starting point for a plan that has never had a
 * version sealed, so there is nothing to carry forward. */
export function emptyProse(): SecurityPlanProse {
  const prose = {} as Record<SecurityPlanProseSection, SecurityPlanProseSectionContent>;
  for (const section of SECURITY_PLAN_PROSE_SECTIONS) prose[section] = emptySection();
  return prose as SecurityPlanProse;
}

/**
 * Carries `prior` forward as the baseline for a NEW draft: every section's text is
 * kept verbatim, but `editedInThisVersion` is reset to false on all of them — nothing
 * has been touched yet in the version now being authored. `prior` is either the last
 * version's prose, or null when the plan has never had a version sealed (including the
 * legacy pre-#1566 `string | null` shape, which carries nothing forward — see
 * `carryForwardLegacyOrProse`).
 */
export function carryForwardProse(prior: SecurityPlanProse | null): SecurityPlanProse {
  if (!prior) return emptyProse();
  const prose = {} as Record<SecurityPlanProseSection, SecurityPlanProseSectionContent>;
  for (const section of SECURITY_PLAN_PROSE_SECTIONS) {
    prose[section] = { text: prior[section]?.text ?? "", editedInThisVersion: false };
  }
  return prose as SecurityPlanProse;
}

/** `prior` may be the legacy pre-#1566 free-text stub (`string | null`) on an old
 * sealed version, or a real `SecurityPlanProse` on one sealed after this build. A
 * legacy string has no section structure to carry forward — treated the same as "no
 * prior version" (empty baseline), since inventing a section split for free text would
 * be fabricating structure that was never authored. */
export function carryForwardLegacyOrProse(prior: SecurityPlanProse | string | null): SecurityPlanProse {
  if (prior && typeof prior === "object") return carryForwardProse(prior);
  return emptyProse();
}

/**
 * Applies one section edit. `editedInThisVersion` is computed by diffing `text`
 * against `baseline[section].text` (the carry-forward snapshot captured once at draft
 * creation) — NOT against `prose[section]`'s own previous value — so an author who
 * types a change and then types it back to the original text correctly clears
 * `editedInThisVersion` again, rather than it staying stuck true from the detour.
 */
export function applyProseEdit(
  prose: SecurityPlanProse,
  baseline: SecurityPlanProse,
  section: SecurityPlanProseSection,
  text: string,
): SecurityPlanProse {
  return {
    ...prose,
    [section]: { text, editedInThisVersion: text !== (baseline[section]?.text ?? "") },
  };
}
