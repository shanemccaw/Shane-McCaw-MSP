/**
 * narrative-grounding.test.ts
 *
 * #343 — the never-fabricate machinery every live-rendered report's prose is
 * built on, tested once, where it lives.
 *
 * These functions are pure and import nothing but a type, so this suite needs no
 * mocks at all: what runs here is exactly what runs in production. That is the
 * point of the extraction — the guarantee is one implementation with one set of
 * tests rather than one per report.
 *
 * Run: pnpm --filter @workspace/api-server run test -- narrative-grounding
 */

import { describe, it, expect } from "vitest";

import {
  MIN_FACTS_FOR_NARRATIVE,
  collectFactsForPillars,
  formatStatValue,
  gateBlock,
  isRealStat,
  renderNarrativePrompt,
  sanitizeNarrativeHtml,
  stripFence,
  withExtraStats,
} from "./narrative-grounding.ts";
import type { WarRoomPillarCard, WarRoomStat } from "./war-room-pillar-stats.ts";

function stat(overrides: Partial<WarRoomStat> & Pick<WarRoomStat, "id">): WarRoomStat {
  return {
    label: "things",
    unit: "count",
    value: null,
    checkKey: `check:${overrides.id}`,
    source: "monitor_profile:x",
    replaces: "",
    ...overrides,
  } as WarRoomStat;
}

function card(overrides: Partial<WarRoomPillarCard> & Pick<WarRoomPillarCard, "pillar">): WarRoomPillarCard {
  return {
    enginePillar: "security",
    score: null,
    rawRiskScore: 0,
    stats: [],
    findings: [],
    findingCounts: { critical: 0, warning: 0 },
    trend: null,
    ...overrides,
  } as WarRoomPillarCard;
}

/* ------------------------------------------------------------------ *
 * What counts as a fact
 * ------------------------------------------------------------------ */

describe("only a real, finite number is a fact", () => {
  it("accepts a real zero — a measured 0 is an answer, not an absence", () => {
    expect(isRealStat(stat({ id: "a", value: 0 }))).toBe(true);
    expect(formatStatValue(stat({ id: "a", value: 0 }))).toBe("0");
  });

  it("rejects null, NaN and Infinity alike", () => {
    for (const value of [null, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(isRealStat(stat({ id: "a", value: value as number | null }))).toBe(false);
    }
  });

  it("renders each unit as the reader will see it, with no rounding of its own", () => {
    expect(formatStatValue(stat({ id: "a", unit: "percent", value: 38 }))).toBe("38%");
    expect(formatStatValue(stat({ id: "a", unit: "currency", value: 847608 }))).toBe("$847,608");
    expect(formatStatValue(stat({ id: "a", value: 214806 }))).toBe("214,806");
  });
});

describe("collectFactsForPillars", () => {
  it("counts a scored pillar, a real stat and a finding — and nothing else", () => {
    const facts = collectFactsForPillars(
      ["security"],
      [
        card({
          pillar: "security",
          score: 38,
          findingCounts: { critical: 1, warning: 0 },
          stats: [stat({ id: "s.a", label: "admins", value: 11 }), stat({ id: "s.b", unavailableReason: "no_data" })],
          findings: [{ severity: "critical", checkKey: "identity:mfa-registration", title: "No MFA", rankWeight: 0 }],
        }),
      ],
    );
    expect(facts.factCount).toBe(3);
    expect(facts.statBlock).toBe("- security · admins: 11");
    expect(facts.missingChecks).toEqual([{ checkKey: "check:s.b", reason: "no_data" }]);
  });

  it("never lets a tenant reach the floor on the strength of its own gaps", () => {
    const facts = collectFactsForPillars(
      ["security"],
      [card({ pillar: "security", stats: [stat({ id: "s.a", unavailableReason: "not_in_scan_package" })] })],
    );
    expect(facts.factCount).toBe(0);
    expect(facts.factCount).toBeLessThan(MIN_FACTS_FOR_NARRATIVE);
    expect(facts.missingChecks).toHaveLength(1);
  });

  it("ignores pillars outside the section's scope entirely", () => {
    const facts = collectFactsForPillars(
      ["security"],
      [card({ pillar: "governance", score: 46 }), card({ pillar: "security" })],
    );
    expect(facts.factCount).toBe(0);
    expect(facts.pillarBlock).not.toContain("governance");
  });

  it("says plainly when a block has nothing, rather than leaving the token blank", () => {
    const facts = collectFactsForPillars(["security"], [card({ pillar: "security" })]);
    expect(facts.statBlock).toContain("Do not cite any number here");
    expect(facts.findingBlock).toContain("Do not describe any finding");
    expect(facts.missingBlock).toContain("None — every check in scope");
    expect(facts.pillarBlock).toContain("NO SCORE");
  });

  it("drops an unavailable stat with no checkKey rather than naming an empty gap", () => {
    const facts = collectFactsForPillars(
      ["security"],
      [card({ pillar: "security", stats: [stat({ id: "s.a", checkKey: null })] })],
    );
    expect(facts.missingChecks).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * The extra-stat path — the same rule, not a second one
 * ------------------------------------------------------------------ */

describe("withExtraStats", () => {
  const base = () => collectFactsForPillars(["security"], [card({ pillar: "security" })]);

  it("is a no-op when there is nothing to add", () => {
    const facts = base();
    expect(withExtraStats(facts, "security", [])).toBe(facts);
  });

  it("REPLACES the 'no measured figure' placeholder rather than appending under it", () => {
    const facts = withExtraStats(base(), "security", [stat({ id: "x", label: "Secure Score", unit: "percent", value: 38 })]);
    expect(facts.statBlock).toBe("- security · Secure Score: 38%");
    expect(facts.statBlock).not.toContain("Do not cite any number here");
    expect(facts.factCount).toBe(1);
  });

  it("appends to real lines when there already are some", () => {
    const withOne = collectFactsForPillars(
      ["security"],
      [card({ pillar: "security", stats: [stat({ id: "s.a", label: "admins", value: 11 })] })],
    );
    const facts = withExtraStats(withOne, "security", [stat({ id: "x", label: "Secure Score", unit: "percent", value: 38 })]);
    expect(facts.statBlock).toBe("- security · admins: 11\n- security · Secure Score: 38%");
    expect(facts.factCount).toBe(2);
  });

  it("adds an unavailable extra to missingChecks and to no fact count", () => {
    const facts = withExtraStats(base(), "security", [stat({ id: "x", unavailableReason: "license_gap", licenseFeature: "Entra ID P2" })]);
    expect(facts.factCount).toBe(0);
    expect(facts.missingChecks).toEqual([
      { checkKey: "check:x", reason: "license_gap", licenseFeature: "Entra ID P2" },
    ]);
    expect(facts.missingBlock).toBe("- check:x (license_gap)");
    expect(facts.statBlock).toContain("Do not cite any number here");
  });

  it("keeps the card-derived missing checks ahead of its own", () => {
    const withGap = collectFactsForPillars(
      ["security"],
      [card({ pillar: "security", stats: [stat({ id: "s.a", unavailableReason: "no_data" })] })],
    );
    const facts = withExtraStats(withGap, "security", [stat({ id: "x", unavailableReason: "no_data" })]);
    expect(facts.missingChecks.map((m) => m.checkKey)).toEqual(["check:s.a", "check:x"]);
  });
});

/* ------------------------------------------------------------------ *
 * The Gate block
 * ------------------------------------------------------------------ */

describe("gateBlock", () => {
  it("states the gap exactly and forbids any other", () => {
    const block = gateBlock({ score: 41, threshold: 82, status: "no_go" });
    expect(block).toContain("The gap is exactly 41 points");
    expect(block).toContain("Never quote a different gap");
  });

  it("says there is no gap when the tenant is at or above the Gate", () => {
    expect(gateBlock({ score: 82, threshold: 82, status: "go" })).toContain("there is no gap to close");
  });

  it("forbids a verdict outright when there is no score — never a zero", () => {
    const block = gateBlock({ score: null, threshold: 82, status: null });
    expect(block).toContain("NO SCORE");
    expect(block).toContain("Do not state a score, a gap or a Go/No-Go verdict");
    expect(block).not.toMatch(/\b0\/100\b/);
  });
});

/* ------------------------------------------------------------------ *
 * Prompt rendering and sanitising
 * ------------------------------------------------------------------ */

describe("renderNarrativePrompt", () => {
  it("fills every token, so none can ship verbatim to the model", () => {
    const facts = collectFactsForPillars(["security"], [card({ pillar: "security", score: 38 })]);
    const prompt = renderNarrativePrompt(
      "{{tenantName}}|{{pillarBlock}}|{{statBlock}}|{{findingBlock}}|{{missingBlock}}|{{gateBlock}}|{{factCount}}",
      { tenantName: "Contoso", facts, gate: { score: 41, threshold: 82, status: "no_go" } },
    );
    expect(prompt).not.toMatch(/\{\{\w+\}\}/);
    expect(prompt.startsWith("Contoso|")).toBe(true);
    expect(prompt.endsWith("|1")).toBe(true);
  });

  it("empties the gate token rather than leaving it when a section has no Gate", () => {
    const facts = collectFactsForPillars(["security"], [card({ pillar: "security" })]);
    expect(renderNarrativePrompt("[{{gateBlock}}]", { tenantName: "C", facts })).toBe("[]");
  });
});

describe("sanitising", () => {
  it("strips script, style, embeds and inline handlers", () => {
    const dirty = `<p onclick="x()">a</p><script>b()</script><style>c{}</style><iframe src="d"></iframe>`;
    const clean = sanitizeNarrativeHtml(dirty);
    expect(clean).not.toMatch(/<script|<style|<iframe|onclick/i);
    expect(clean.startsWith("<p>a</p>")).toBe(true);
    // The OPENING embed tag is what carries the src and does the loading, and it
    // is gone. A lone closing tag survives and is deliberately left: an end tag
    // with no matching start tag is ignored by every HTML parser, and widening
    // the pattern to eat closing tags would be a behaviour change to a shipped
    // report's sanitiser for no security gain.
    expect(clean).toBe("<p>a</p></iframe>");
  });

  it("removes a markdown fence the model wrapped its fragment in", () => {
    expect(stripFence("```html\n<p>a</p>\n```")).toBe("<p>a</p>");
    expect(stripFence("<p>a</p>")).toBe("<p>a</p>");
  });
});
