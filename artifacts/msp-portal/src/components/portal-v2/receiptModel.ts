/**
 * receiptModel.ts — the Receipt page derivation (Part 12).
 *
 * Transcribes the prototype's receipt render block (Customer Portal Shell.dc.html
 * 20543-20568): pick the charge by id, resolve its detail, and compute the meta
 * grid, line amounts and totals. Named and tested here so a split line amount or
 * a Paid/Due label can't render as a plausible-but-wrong number.
 */

import {
  BILL_ONETIME,
  RC_DETAIL,
  RECEIPT_BILLED_TO,
  RECEIPT_DEFAULT_ID,
  type OneTimeCharge,
  type ReceiptDetail,
} from "./receiptData";

/** '$' + thousands-grouped integer — prototype `rcMoney` (15742). */
export function rcMoney(n: number): string {
  return "$" + n.toLocaleString("en-US");
}

export interface ReceiptMetaRow {
  label: string;
  value: string;
}
export interface ReceiptLine {
  name: string;
  detail: string;
  qty: string;
  amount: string;
}
export interface ReceiptTotal {
  label: string;
  value: string;
  /** The subtotal/tax rows are small; the final Paid/Due row is large. */
  small: boolean;
}
export interface ReceiptTraceRow {
  label: string;
  value: string;
}

export interface ReceiptView {
  id: string;
  status: OneTimeCharge["status"];
  isPaid: boolean;
  meta: readonly ReceiptMetaRow[];
  lines: readonly ReceiptLine[];
  totals: readonly ReceiptTotal[];
  narrative: string;
  trace: readonly ReceiptTraceRow[];
}

/**
 * Resolve a charge by receipt id — prototype `rcRow` (15740): the matching
 * `BILL_ONETIME` row, or the Preservation-Lock row (index 2) as the fallback the
 * design uses when the id has no match.
 */
export function rcRowFor(id: string): OneTimeCharge {
  return BILL_ONETIME.find((o) => o.receipt === id) ?? BILL_ONETIME[2];
}

/** The detail behind a charge — prototype `rcDetail` (15741). */
export function rcDetailFor(row: OneTimeCharge): ReceiptDetail {
  return RC_DETAIL[row.receipt] ?? RC_DETAIL[RECEIPT_DEFAULT_ID];
}

/**
 * The whole receipt view for an id — prototype 20543-20568. `id` defaults to the
 * prototype's own default receipt.
 */
export function receiptView(id: string = RECEIPT_DEFAULT_ID): ReceiptView {
  const row = rcRowFor(id);
  const detail = rcDetailFor(row);
  const paid = row.status === "Paid";

  const meta: ReceiptMetaRow[] = [
    { label: "Receipt date", value: row.date },
    { label: "Billed to", value: RECEIPT_BILLED_TO },
    { label: "Payment method", value: paid ? "Visa ending 4242" : "Invoice, net 14" },
    { label: "Origin", value: row.origin },
  ];

  // A single-line receipt shows the full amount; a multi-line one splits the
  // amount evenly and rounds — prototype 20554-20557.
  const lineCount = detail.lines.length;
  const lines: ReceiptLine[] = detail.lines.map((l) => ({
    name: l.name,
    detail: l.detail,
    qty: l.qty,
    amount: rcMoney(lineCount === 1 ? row.amount : Math.round(row.amount / lineCount)),
  }));

  const totals: ReceiptTotal[] = [
    { label: "Subtotal", value: rcMoney(row.amount), small: true },
    { label: "Tax", value: "Not applicable", small: true },
    { label: paid ? "Paid" : "Due", value: rcMoney(row.amount), small: false },
  ];

  return {
    id: row.receipt,
    status: row.status,
    isPaid: paid,
    meta,
    lines,
    totals,
    narrative: detail.narrative,
    trace: detail.trace.map((t) => ({ label: t[0], value: t[1] })),
  };
}
