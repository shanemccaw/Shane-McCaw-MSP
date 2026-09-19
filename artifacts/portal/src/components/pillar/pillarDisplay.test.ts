import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatCents,
  formatPurchasedMultiple,
  ledgerExcludedReason,
  ledgerFootnote,
} from "./pillarDisplay.ts";

describe("Licensing SKU ledger display (Git #4578)", () => {
  it("formats the price column with cents and the waste column without", () => {
    assert.equal(formatCents(2300, true), "$23.00");
    assert.equal(formatCents(0, false), "$0");
    assert.equal(formatCents(84760800, false), "$847,608");
  });

  it("uses the design's chip wording for the server's real exclusion reasons", () => {
    assert.equal(ledgerExcludedReason("zero_price"), "zero price");
    assert.equal(ledgerExcludedReason("no_price_on_file"), "no price on file");
  });

  it("spells out a reason it has no authored copy for instead of hiding it", () => {
    assert.equal(ledgerExcludedReason("some_new_reason"), "some new reason");
  });

  it("formats the purchased multiple", () => {
    assert.equal(formatPurchasedMultiple(10000), "×10,000");
  });

  it("puts the tenant's real priced/total SKU counts in the footnote", () => {
    assert.match(ledgerFootnote(1, 4), /1 of 4 SKUs today/);
  });
});
