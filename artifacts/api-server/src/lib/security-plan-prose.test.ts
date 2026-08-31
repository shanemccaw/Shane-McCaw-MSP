/**
 * security-plan-prose.test.ts — pure tests for #1566's carry-forward/edit-marking
 * guarantee: prose is carried forward by default; only sections actually edited while
 * authoring the version being sealed are marked `editedInThisVersion`.
 */
import { describe, it, expect } from "vitest";
import { SECURITY_PLAN_PROSE_SECTIONS, type SecurityPlanProse } from "@workspace/db";
import { emptyProse, carryForwardProse, carryForwardLegacyOrProse, applyProseEdit } from "./security-plan-prose.ts";

function proseWith(overrides: Partial<Record<(typeof SECURITY_PLAN_PROSE_SECTIONS)[number], string>>): SecurityPlanProse {
  const prose = emptyProse();
  const next = { ...prose } as SecurityPlanProse;
  for (const [section, text] of Object.entries(overrides)) {
    next[section as keyof SecurityPlanProse] = { text: text as string, editedInThisVersion: true };
  }
  return next;
}

describe("emptyProse", () => {
  it("carries all four sections, each empty and unedited", () => {
    const prose = emptyProse();
    expect(Object.keys(prose).sort()).toEqual([...SECURITY_PLAN_PROSE_SECTIONS].sort());
    for (const section of SECURITY_PLAN_PROSE_SECTIONS) {
      expect(prose[section]).toEqual({ text: "", editedInThisVersion: false });
    }
  });
});

describe("carryForwardProse", () => {
  it("returns an empty baseline when there is no prior version", () => {
    expect(carryForwardProse(null)).toEqual(emptyProse());
  });

  it("carries every section's text forward verbatim, resetting editedInThisVersion to false", () => {
    const prior = proseWith({ scope: "Engagement covers all M365 workloads.", executiveSummary: "Posture improved this quarter." });
    const carried = carryForwardProse(prior);
    expect(carried.scope).toEqual({ text: "Engagement covers all M365 workloads.", editedInThisVersion: false });
    expect(carried.executiveSummary).toEqual({ text: "Posture improved this quarter.", editedInThisVersion: false });
    // Sections untouched in `prior` still carry their (empty) text forward, unedited.
    expect(carried.methodology).toEqual({ text: "", editedInThisVersion: false });
    expect(carried.exclusions).toEqual({ text: "", editedInThisVersion: false });
  });
});

describe("carryForwardLegacyOrProse", () => {
  it("treats a legacy pre-#1566 free-text stub as no baseline to carry forward", () => {
    expect(carryForwardLegacyOrProse("some free-text prose from an old version")).toEqual(emptyProse());
  });

  it("treats null the same as no prior version", () => {
    expect(carryForwardLegacyOrProse(null)).toEqual(emptyProse());
  });

  it("carries a real SecurityPlanProse forward like carryForwardProse", () => {
    const prior = proseWith({ methodology: "Automated scan + manual review." });
    expect(carryForwardLegacyOrProse(prior)).toEqual(carryForwardProse(prior));
  });
});

describe("applyProseEdit", () => {
  it("marks a section edited when its new text differs from the baseline", () => {
    const baseline = carryForwardProse(proseWith({ exclusions: "Excludes third-party SaaS not covered by MT app." }));
    const prose = baseline;
    const updated = applyProseEdit(prose, baseline, "exclusions", "Excludes third-party SaaS and BYOD devices.");
    expect(updated.exclusions).toEqual({ text: "Excludes third-party SaaS and BYOD devices.", editedInThisVersion: true });
    // Other sections are untouched by editing one.
    expect(updated.scope).toEqual(prose.scope);
  });

  it("clears editedInThisVersion when the text is edited back to the baseline", () => {
    const baseline = carryForwardProse(proseWith({ methodology: "Automated scan + manual review." }));
    const detour = applyProseEdit(baseline, baseline, "methodology", "Automated scan only.");
    expect(detour.methodology.editedInThisVersion).toBe(true);
    const revert = applyProseEdit(detour, baseline, "methodology", "Automated scan + manual review.");
    expect(revert.methodology).toEqual({ text: "Automated scan + manual review.", editedInThisVersion: false });
  });

  it("marks a never-before-authored section (empty baseline) edited the moment text is added", () => {
    const baseline = emptyProse();
    const updated = applyProseEdit(baseline, baseline, "scope", "First engagement scope statement.");
    expect(updated.scope).toEqual({ text: "First engagement scope statement.", editedInThisVersion: true });
  });
});
