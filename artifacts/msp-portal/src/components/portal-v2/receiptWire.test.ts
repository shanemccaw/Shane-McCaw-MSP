/**
 * receiptWire.test.ts — pins the Stripe invoice→ReceiptView mapping (Git #1242):
 * id matching (by Stripe id or by number), amount-in-cents conversion, paid vs
 * pending status/labels, and date formatting.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { receiptViewFromStripe, stripeReceiptMatches } from "./receiptWire";

const PAID = {
  id: "in_1AbCDe",
  number: "INV-0007",
  amount: 450000,
  currency: "usd",
  status: "paid",
  date: 1755702000,
  invoicePdf: "https://pay.stripe.com/invoice/in_1AbCDe/pdf",
};

const OPEN = {
  id: "in_2XyZ",
  number: null,
  amount: 18000,
  currency: "usd",
  status: "open",
  date: 1755702000,
  invoicePdf: null,
};

describe("stripeReceiptMatches", () => {
  it("matches by Stripe invoice id", () => {
    assert.equal(stripeReceiptMatches(PAID, "in_1AbCDe"), true);
  });
  it("matches by human invoice number", () => {
    assert.equal(stripeReceiptMatches(PAID, "INV-0007"), true);
  });
  it("does not match an unrelated id", () => {
    assert.equal(stripeReceiptMatches(PAID, "rcpt_1Q2fA1"), false);
  });
  it("does not match by number when number is null", () => {
    assert.equal(stripeReceiptMatches(OPEN, "in_2XyZ"), true);
    assert.equal(stripeReceiptMatches(OPEN, ""), false);
  });
});

describe("receiptViewFromStripe", () => {
  it("maps a paid invoice to a Paid receipt with dollar amounts converted from cents", () => {
    const v = receiptViewFromStripe(PAID);
    assert.equal(v.id, "INV-0007");
    assert.equal(v.status, "Paid");
    assert.equal(v.isPaid, true);
    assert.equal(v.lines[0].amount, "$4,500");
    assert.equal(v.totals.at(-1)?.label, "Paid");
    assert.equal(v.totals.at(-1)?.value, "$4,500");
  });

  it("maps a non-paid invoice to Pending/Due, falling back to the invoice id when no number", () => {
    const v = receiptViewFromStripe(OPEN);
    assert.equal(v.id, "in_2XyZ");
    assert.equal(v.status, "Pending");
    assert.equal(v.isPaid, false);
    assert.equal(v.totals.at(-1)?.label, "Due");
    assert.equal(v.lines[0].amount, "$180");
  });
});
