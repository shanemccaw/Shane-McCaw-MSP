/**
 * Tests: Document Generator cost display, toast half (#53, parent #48).
 *
 * generateDocument()/generateSowDocument() (backend, already done in 19339c18)
 * report costCents/costStatus straight through the generate route's JSON
 * response; this covers the wording the IDE's generation-success toast picks
 * for each of the three states, so "recorded" always carries a real figure
 * and "no-ai-call"/"unknown" never render as a misleading $0.00.
 */

import { describe, it, expect } from "vitest";
import { formatGenerationCostLabel } from "./DocumentGeneratorIde";

describe("formatGenerationCostLabel", () => {
  it("shows the real figure for a recorded cost", () => {
    expect(formatGenerationCostLabel("recorded", 1234)).toBe("$12.34");
  });

  it("shows a zero recorded cost as an actual $0.00, not unknown", () => {
    expect(formatGenerationCostLabel("recorded", 0)).toBe("$0.00");
  });

  it("falls back to $0.00 if a recorded status somehow carries a null cost", () => {
    expect(formatGenerationCostLabel("recorded", null)).toBe("$0.00");
  });

  it("labels a drift-gate reuse as no AI call, not free", () => {
    expect(formatGenerationCostLabel("no-ai-call", 0)).toBe("no AI call (reused)");
  });

  it("labels a failed usage recording as unknown, not $0.00", () => {
    expect(formatGenerationCostLabel("unknown", null)).toBe("cost unknown");
  });

  it("defaults to unknown when the response carries no cost status at all", () => {
    expect(formatGenerationCostLabel(undefined, undefined)).toBe("cost unknown");
  });
});
