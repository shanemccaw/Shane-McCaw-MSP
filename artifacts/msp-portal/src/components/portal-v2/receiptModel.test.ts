/**
 * receiptModel.test.ts — pins the receipt's charge selection, split line amounts
 * and totals against the prototype's own numbers.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { RECEIPT_DEFAULT_ID } from "./receiptData";
import { rcMoney, rcRowFor, receiptView } from "./receiptModel";

describe("rcMoney", () => {
  it("groups thousands with a dollar sign", () => {
    assert.equal(rcMoney(180), "$180");
    assert.equal(rcMoney(1350), "$1,350");
    assert.equal(rcMoney(8200), "$8,200");
  });
});

describe("charge selection", () => {
  it("defaults to the Preservation-Lock receipt the prototype falls back to", () => {
    assert.equal(RECEIPT_DEFAULT_ID, "rcpt_1Q2fA1");
    const v = receiptView();
    assert.equal(v.id, "rcpt_1Q2fA1");
    assert.equal(v.status, "Paid");
  });

  it("falls back to that same row for an unknown id", () => {
    assert.equal(rcRowFor("nope").receipt, "rcpt_1Q2fA1");
  });
});

describe("meta grid", () => {
  it("labels date, billed-to, method and origin, with the paid card method", () => {
    const v = receiptView("rcpt_1Q2fA1");
    assert.deepEqual(
      v.meta.map((m) => m.label),
      ["Receipt date", "Billed to", "Payment method", "Origin"],
    );
    assert.equal(v.meta[1].value, "Halden Materials · Jordan Diaz");
    assert.equal(v.meta[2].value, "Visa ending 4242");
    assert.equal(v.meta[3].value, "Compliance · CMP-03 write action");
  });
});

describe("line amounts", () => {
  it("shows the full amount for a single-line receipt", () => {
    const v = receiptView("rcpt_1Q2fA1"); // one line, $180
    assert.equal(v.lines.length, 1);
    assert.equal(v.lines[0].amount, "$180");
  });

  it("splits and rounds a multi-line receipt evenly", () => {
    const v = receiptView("rcpt_1Q9jK4"); // two lines, $1,350
    assert.equal(v.lines.length, 2);
    assert.equal(v.lines[0].amount, "$675");
    assert.equal(v.lines[1].amount, "$675");
  });
});

describe("totals", () => {
  it("reads Subtotal, Tax = Not applicable, and a Paid row for a paid receipt", () => {
    const v = receiptView("rcpt_1Q2fA1");
    assert.deepEqual(
      v.totals.map((t) => [t.label, t.value]),
      [
        ["Subtotal", "$180"],
        ["Tax", "Not applicable"],
        ["Paid", "$180"],
      ],
    );
    assert.equal(v.totals[2].small, false);
  });
});
