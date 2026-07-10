/**
 * crm-engine.test.ts
 *
 * Unit tests for the pure core of the CRM scoring engine:
 *   filterCrmSignals() — restricts fired signals to those with a configured crm:* weight
 *   sumCrmScore()      — sums each of the five CRM contribution fields independently
 *
 * These are the only two functions that decide the engine's output — no DB
 * access, no hand-coded formulas. The tests prove:
 *   1. Determinism — same inputs produce the same score every run.
 *   2. Filtering — only signals with crm:* configuration contribute; other
 *      fired signals (e.g. security:*, alwaysInclude) are excluded entirely.
 *   3. Each of the five fields sums independently, with an accurate total.
 *   4. Delta correctness — changing one signal's contribution changes the
 *      corresponding field by exactly that delta, nothing more.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect } from "vitest";
import { filterCrmSignals, sumCrmScore, type CrmSignalWeightConfig, type CrmBreakdownEntry } from "./crm-engine.ts";

function crmWeight(
  signalKey: string,
  overrides: Partial<CrmSignalWeightConfig> = {},
): CrmSignalWeightConfig {
  return {
    signalKey,
    category: "crm:fit",
    crmFitContribution: 0,
    crmPainContribution: 0,
    crmMaturityContribution: 0,
    crmIntentContribution: 0,
    crmUrgencyContribution: 0,
    ...overrides,
  };
}

describe("filterCrmSignals", () => {
  it("includes a fired signal that has crm:* weight configuration", () => {
    const weights = [crmWeight("crmHighIntentBuyer", { crmIntentContribution: 30 })];
    const result = filterCrmSignals(["crmHighIntentBuyer"], weights);

    expect(result).toEqual([
      { signalKey: "crmHighIntentBuyer", fit: 0, pain: 0, maturity: 0, intent: 30, urgency: 0 },
    ]);
  });

  it("excludes a fired signal with no crm:* weight configuration (e.g. alwaysInclude)", () => {
    const weights = [crmWeight("crmHighIntentBuyer", { crmIntentContribution: 30 })];
    const result = filterCrmSignals(["alwaysInclude", "crmHighIntentBuyer", "hasSecurityGaps"], weights);

    expect(result.map(r => r.signalKey)).toEqual(["crmHighIntentBuyer"]);
  });

  it("excludes crm:* weight configuration for signals that did not fire", () => {
    const weights = [
      crmWeight("crmHighIntentBuyer", { crmIntentContribution: 30 }),
      crmWeight("crmMatureTenant", { crmMaturityContribution: 999 }),
    ];
    const result = filterCrmSignals(["crmHighIntentBuyer"], weights);

    expect(result).toEqual([
      { signalKey: "crmHighIntentBuyer", fit: 0, pain: 0, maturity: 0, intent: 30, urgency: 0 },
    ]);
  });

  it("returns an empty array when no signals fired", () => {
    expect(filterCrmSignals([], [crmWeight("crmHighIntentBuyer", { crmIntentContribution: 30 })])).toEqual([]);
  });

  it("returns an empty array when fired signals have zero crm:* configuration", () => {
    expect(filterCrmSignals(["alwaysInclude", "hasSecurityGaps"], [])).toEqual([]);
  });
});

describe("sumCrmScore", () => {
  const entries: CrmBreakdownEntry[] = [
    { signalKey: "crmHighIntentBuyer", fit: 10, pain: 5, maturity: 0, intent: 30, urgency: 15 },
    { signalKey: "crmMatureTenant", fit: 5, pain: 0, maturity: 20, intent: 0, urgency: 0 },
    { signalKey: "crmPainPoint", fit: 0, pain: 25, maturity: 0, intent: 0, urgency: 10 },
  ];

  it("sums each of the five CRM contribution fields independently", () => {
    const score = sumCrmScore(entries);
    expect(score.fit).toBe(15); // 10 + 5
    expect(score.pain).toBe(30); // 5 + 25
    expect(score.maturity).toBe(20); // 0 + 20
    expect(score.intent).toBe(30); // 30 + 0
    expect(score.urgency).toBe(25); // 15 + 0 + 10
  });

  it("total is the sum of all five independent field sums", () => {
    const score = sumCrmScore(entries);
    expect(score.total).toBe(score.fit + score.pain + score.maturity + score.intent + score.urgency);
    expect(score.total).toBe(120);
  });

  it("is deterministic — same input produces the same score every run", () => {
    const first = sumCrmScore(entries);
    const second = sumCrmScore([...entries]);
    const third = sumCrmScore(entries);
    expect(first).toEqual(second);
    expect(second).toEqual(third);
  });

  it("returns all-zero score for an empty signal set", () => {
    expect(sumCrmScore([])).toEqual({ fit: 0, pain: 0, maturity: 0, intent: 0, urgency: 0, total: 0 });
  });

  it("changing one signal's field contribution changes only that field and the total by exactly the delta", () => {
    const before = sumCrmScore(entries);

    const bumped = entries.map(e =>
      e.signalKey === "crmHighIntentBuyer" ? { ...e, intent: e.intent + 12 } : e,
    );
    const after = sumCrmScore(bumped);

    expect(after.intent - before.intent).toBe(12);
    expect(after.total - before.total).toBe(12);
    // Other fields are untouched
    expect(after.fit).toBe(before.fit);
    expect(after.pain).toBe(before.pain);
    expect(after.maturity).toBe(before.maturity);
    expect(after.urgency).toBe(before.urgency);
  });

  it("removing a fired signal reduces each field by exactly its own contribution", () => {
    const before = sumCrmScore(entries);
    const withoutPainPoint = entries.filter(e => e.signalKey !== "crmPainPoint");
    const after = sumCrmScore(withoutPainPoint);

    expect(before.pain - after.pain).toBe(25);
    expect(before.urgency - after.urgency).toBe(10);
    expect(before.total - after.total).toBe(35);
  });

  it("has no hidden business logic — a field's sum comes only from configured contributions, unconditionally", () => {
    // A signal that sounds "urgent" in name only, with a deliberately small
    // configured contribution, must not be boosted.
    const smallEntries: CrmBreakdownEntry[] = [
      { signalKey: "crmCriticalUrgentDeal", fit: 0, pain: 0, maturity: 0, intent: 0, urgency: 1 },
    ];
    expect(sumCrmScore(smallEntries).urgency).toBe(1);
    expect(sumCrmScore(smallEntries).total).toBe(1);
  });
});

describe("filterCrmSignals + sumCrmScore integration — full pure pipeline", () => {
  it("filters to crm:* signals then sums independently across all five fields", () => {
    const weights = [
      crmWeight("crmHighIntentBuyer", { category: "crm:intent", crmIntentContribution: 30, crmUrgencyContribution: 15 }),
      crmWeight("crmMatureTenant", { category: "crm:maturity", crmMaturityContribution: 20, crmFitContribution: 5 }),
    ];
    // hasSecurityGaps and alwaysInclude also fired, but have no crm:* configuration.
    const firedSignalKeys = ["alwaysInclude", "hasSecurityGaps", "crmHighIntentBuyer", "crmMatureTenant"];

    const filtered = filterCrmSignals(firedSignalKeys, weights);
    expect(filtered.map(f => f.signalKey)).toEqual(["crmHighIntentBuyer", "crmMatureTenant"]);

    const score = sumCrmScore(filtered);
    expect(score).toEqual({ fit: 5, pain: 0, maturity: 20, intent: 30, urgency: 15, total: 70 });
  });
});
