/**
 * riskRegisterWire.test.ts — the one rule this layer exists to enforce:
 * a register field the database does not hold is reported as NOT HELD, never
 * filled in with something that looks plausible.
 *
 * This matters more than it looks. `msp_risk_decisions` gained the register's
 * own columns with no backfill, so the common case in production right now is a
 * row where most of them are null. If normalisation quietly substituted a 1 for
 * a missing likelihood, every such risk would appear on the heat map at "very
 * unlikely, negligible impact" — a specific claim about a real customer's real
 * risk that nobody ever made. Zero keeps it off the grid instead, because the
 * grid only has cells for 1-5.
 *
 * The weight case is the same argument in money: `rrSuppressedWeight` sums it,
 * and the page prints the total as "N points are currently suppressed". A
 * guessed weight would make that sentence false.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  NOT_RECORDED,
  decisionState,
  formatLongDate,
  toPolicyDecision,
  toRiskEntry,
  type WirePolicyDecision,
  type WireRisk,
} from "./riskRegisterWire";
import { rrStats, rrSuppressedWeight, rrAccepted, rrFiltered } from "./riskRegisterModel";
import { RR_RISKS } from "./riskRegisterData";

/** A row as `msp-rbd.ts` writes one: none of the register columns populated. */
const BARE: WireRisk = {
  id: "RBD-2026-575",
  title: "Conditional Risk Acceptance Request",
  pillar: null,
  inherent: "High",
  residual: "Medium",
  status: null,
  owner: null,
  review: null,
  weight: null,
  likelihood: null,
  impact: null,
  what: "MFA is not enforced for all users.",
  outcome: null,
  evidence: null,
  controls: ["Conditional Access restricts sign-in locations."],
  plan: null,
  isAccepted: false,
  liabilityValueUsd: 35000,
  framework: "CIS M365 Baseline",
  controlViolated: "CIS 1.1.1 - Enforce MFA for All Users",
};

describe("toRiskEntry — absence is reported, not filled in", () => {
  it("maps every missing text field to 'Not recorded' rather than a blank or a guess", () => {
    const r = toRiskEntry(BARE);
    assert.equal(r.pillar, NOT_RECORDED);
    assert.equal(r.owner, NOT_RECORDED);
    assert.equal(r.status, NOT_RECORDED);
    assert.equal(r.review, NOT_RECORDED);
    assert.equal(r.outcome, NOT_RECORDED);
    assert.equal(r.evidence, NOT_RECORDED);
    assert.equal(r.plan, NOT_RECORDED);
  });

  it("keeps a missing likelihood/impact OFF the heat map instead of plotting it at 1x1", () => {
    const r = toRiskEntry(BARE);
    assert.equal(r.likelihood, 0);
    assert.equal(r.impact, 0);
    // The grid is built for 1..5; nothing lands on a cell at 0.
    assert.ok(r.likelihood < 1 && r.impact < 1);
  });

  it("gives a missing weight no influence on the suppressed-points total", () => {
    const accepted = toRiskEntry({
      ...BARE,
      status: "Accepted",
      weight: null,
      accepted: {
        by: "Jordan Diaz",
        on: "2026-08-20T10:00:00.000Z",
        until: "2027-08-19",
        register: null,
        why: null,
        compensating: null,
        statement: "I understand and accept this risk.",
      },
    });
    assert.equal(accepted.weight, 0);
    assert.equal(rrSuppressedWeight([accepted]), 0);
  });

  it("passes real values through untouched", () => {
    const r = toRiskEntry({ ...BARE, pillar: "Security", owner: "CIO", weight: 7, likelihood: 3, impact: 5 });
    assert.equal(r.pillar, "Security");
    assert.equal(r.owner, "CIO");
    assert.equal(r.weight, 7);
    assert.equal(r.likelihood, 3);
    assert.equal(r.impact, 5);
    assert.equal(r.what, "MFA is not enforced for all users.");
    assert.deepEqual(r.controls, ["Conditional Access restricts sign-in locations."]);
  });

  it("omits the acceptance block entirely when nothing has been accepted", () => {
    assert.equal(toRiskEntry(BARE).accepted, undefined);
  });

  it("renders an acceptance date in the same long form the fixture uses", () => {
    const r = toRiskEntry({
      ...BARE,
      accepted: {
        by: "Jordan Diaz",
        on: "2026-08-13T09:15:00.000Z",
        until: "30 November 2026",
        register: "RR-2026-016",
        why: "Access reviews need Entra ID P1 on every reviewer.",
        compensating: "Invitation restriction is live.",
        statement: "I understand and accept this risk.",
      },
    });
    assert.equal(r.accepted?.on, "13 August 2026");
    assert.equal(r.accepted?.by, "Jordan Diaz");
    assert.equal(r.accepted?.register, "RR-2026-016");
  });
});

describe("formatLongDate", () => {
  it("matches the fixture's own format, so live and fixture rows read alike", () => {
    assert.equal(formatLongDate("2026-08-12T00:00:00.000Z"), "12 August 2026");
    // The fixture writes exactly this string for RSK-004.
    assert.equal(RR_RISKS.find((r) => r.id === "RSK-004")?.accepted?.on, "12 August 2026");
  });

  it("says 'Not recorded' for a null, and echoes an unparseable value rather than 'Invalid Date'", () => {
    assert.equal(formatLongDate(null), NOT_RECORDED);
    assert.equal(formatLongDate("not a date"), "not a date");
  });

  /**
   * Regression: this originally formatted in the viewer's local zone, so a
   * signature stamped at midnight UTC rendered as the PREVIOUS DAY for anyone
   * west of Greenwich — the same permanent record showing two different dates
   * depending on who opened it. On a liability transfer, the date is the point.
   *
   * These two instants are the boundary cases: the first minute of a UTC day
   * (wrong-dates for negative offsets) and the last (wrong-dates for positive
   * offsets). Both must report the UTC day regardless of where the test runs.
   */
  it("reports the UTC day whatever the machine's timezone is", () => {
    assert.equal(formatLongDate("2026-08-12T00:00:00.000Z"), "12 August 2026");
    assert.equal(formatLongDate("2026-08-12T23:59:59.000Z"), "12 August 2026");
  });
});

describe("decisionState", () => {
  it("accepts the four real states, case-insensitively", () => {
    assert.equal(decisionState("live"), "live");
    assert.equal(decisionState("DUE"), "due");
    assert.equal(decisionState("expired"), "expired");
    assert.equal(decisionState("proposed"), "proposed");
  });

  it("falls back to 'proposed' — the least committed lane — rather than dropping the row", () => {
    assert.equal(decisionState("nonsense"), "proposed");
    assert.equal(decisionState(null), "proposed");
    assert.equal(decisionState(""), "proposed");
  });
});

const BARE_DECISION: WirePolicyDecision = {
  id: "RBD-2026-576",
  state: "live",
  pillar: null,
  title: "Teams chat retention set to 1 year",
  obligation: null,
  owner: null,
  ownerId: null,
  approved: null,
  review: null,
  register: null,
  rationale: null,
  compensating: null,
  check: null,
};

describe("toPolicyDecision", () => {
  it("reports missing fields as 'Not recorded'", () => {
    const d = toPolicyDecision(BARE_DECISION);
    assert.equal(d.obligation, NOT_RECORDED);
    assert.equal(d.rationale, NOT_RECORDED);
    assert.equal(d.check, NOT_RECORDED);
    assert.equal(d.approved, NOT_RECORDED);
    assert.equal(d.state, "live");
  });

  it("leaves ownerId as an empty string, since it is a lookup key and not shown", () => {
    assert.equal(toPolicyDecision(BARE_DECISION).ownerId, "");
  });

  it("formats a real approval date", () => {
    const d = toPolicyDecision({ ...BARE_DECISION, approved: "2026-03-14T00:00:00.000Z" });
    assert.equal(d.approved, "14 March 2026");
  });
});

describe("the model's derivations run over live rows, not just the fixture", () => {
  it("counts the register it is given rather than the design's twelve", () => {
    const live = [toRiskEntry(BARE)];
    const stats = rrStats(live);
    assert.equal(stats[0].value, "1");
    // The fixture default is still intact for the pillar pages.
    assert.equal(rrStats()[0].value, String(RR_RISKS.length));
  });

  it("counts accepted decisions from the live rows", () => {
    const live = [
      toRiskEntry({ ...BARE, status: "Accepted", weight: 6 }),
      toRiskEntry({ ...BARE, id: "RBD-2", status: "Open", weight: 4 }),
    ];
    assert.equal(rrAccepted(live).length, 1);
    assert.equal(rrSuppressedWeight(live), 6);
  });

  it("filters live rows by pillar the same way it filters fixture rows", () => {
    const live = [
      toRiskEntry({ ...BARE, id: "A", pillar: "Security" }),
      toRiskEntry({ ...BARE, id: "B", pillar: "Compliance" }),
    ];
    const filtered = rrFiltered(
      { pillar: "Security", severity: "All severities", status: "All statuses", owner: "All owners", sort: "Risk ID" },
      live,
    );
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].id, "A");
  });
});
