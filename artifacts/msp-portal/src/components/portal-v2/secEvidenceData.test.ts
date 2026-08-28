/**
 * secEvidenceData.test.ts — pins `securityEmailPageWithLive`'s overlay
 * contract (Git #1430): a live count prepends one honest "Open findings"
 * stat card and the fabricated "Domains" row list is unconditionally
 * cleared, live or not, since it has no per-domain producer.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { EVIDENCE_PAGES, securityEmailPageWithLive } from "./secEvidenceData";

const emailFixture = EVIDENCE_PAGES["security-email"];

describe("securityEmailPageWithLive", () => {
  it("clears the fabricated row list even when the metric hasn't resolved", () => {
    const page = securityEmailPageWithLive(emailFixture, { emailAuthFindingCount: null });
    assert.deepEqual(page.rows, []);
    // no live data -> no new stat card, the five fixture cards are untouched
    assert.equal(page.statCards.length, emailFixture.statCards.length);
    assert.equal(page.statCards[0].label, emailFixture.statCards[0].label);
  });

  it("prepends a red 'Open findings' card and still clears rows when findings > 0", () => {
    const page = securityEmailPageWithLive(emailFixture, { emailAuthFindingCount: 2 });
    assert.deepEqual(page.rows, []);
    assert.equal(page.statCards.length, emailFixture.statCards.length + 1);
    assert.equal(page.statCards[0].label, "Open findings");
    assert.equal(page.statCards[0].value, "2");
    assert.equal(page.statCards[0].tone, "red");
  });

  it("prepends a green 'Open findings' card when the tenant has zero open findings", () => {
    const page = securityEmailPageWithLive(emailFixture, { emailAuthFindingCount: 0 });
    assert.equal(page.statCards[0].value, "0");
    assert.equal(page.statCards[0].tone, "green");
  });

  it("leaves topRisks, queries and secondaryRows untouched — out of this issue's scope", () => {
    const page = securityEmailPageWithLive(emailFixture, { emailAuthFindingCount: 1 });
    assert.deepEqual(page.topRisks, emailFixture.topRisks);
    assert.deepEqual(page.queries, emailFixture.queries);
    assert.deepEqual(page.secondaryRows, emailFixture.secondaryRows);
  });
});
