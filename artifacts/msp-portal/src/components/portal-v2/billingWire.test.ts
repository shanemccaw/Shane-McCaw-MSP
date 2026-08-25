/**
 * billingWire.test.ts — pins the invoice→receipt normalisation (Git #1237):
 * amount formatting (whole vs cents), date formatting, description fallback,
 * downloadable flag, and dropping a row with no usable id.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { toBillingReceipts } from "./billingWire";

describe("toBillingReceipts", () => {
  it("normalises a real invoice row into a receipt", () => {
    const rows = toBillingReceipts([
      {
        id: 11,
        invoiceNumber: "ONB-1785341493227-0",
        description: "Security Posture Assessment — self-service purchase",
        amount: "4500.00",
        status: "paid",
        invoiceType: "instant",
        pdfFilename: "invoice-11.pdf",
        paidAt: "2026-07-29T20:11:33.227Z",
        createdAt: "2026-07-29T20:11:33.227Z",
      },
    ]);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], {
      id: 11,
      date: "29 Jul 2026",
      what: "Security Posture Assessment — self-service purchase",
      ref: "ONB-1785341493227-0",
      amount: "$4,500",
      downloadable: true,
    });
  });

  it("keeps cents when the amount is not a whole dollar", () => {
    const rows = toBillingReceipts([
      { id: 1, invoiceNumber: "X-1", amount: "129.50", createdAt: "2026-01-01T00:00:00Z" },
    ]);
    assert.equal(rows[0].amount, "$129.50");
  });

  it("falls back to a type-derived label when no description was recorded", () => {
    const [instant] = toBillingReceipts([{ id: 2, invoiceNumber: "X-2", amount: "0", invoiceType: "instant", createdAt: "2026-01-01T00:00:00Z" }]);
    const [retainer] = toBillingReceipts([{ id: 3, invoiceNumber: "X-3", amount: "0", invoiceType: "retainer", createdAt: "2026-01-01T00:00:00Z" }]);
    assert.equal(instant.what, "One-time purchase");
    assert.equal(retainer.what, "Architect retainer");
  });

  it("is not downloadable without a stored PDF", () => {
    const [row] = toBillingReceipts([{ id: 4, invoiceNumber: "X-4", amount: "0", createdAt: "2026-01-01T00:00:00Z" }]);
    assert.equal(row.downloadable, false);
  });

  it("drops a row with no usable id and tolerates a non-array payload", () => {
    assert.deepEqual(toBillingReceipts([{ invoiceNumber: "no-id", amount: "1" }]), []);
    assert.deepEqual(toBillingReceipts(null), []);
    assert.deepEqual(toBillingReceipts(undefined), []);
  });
});
