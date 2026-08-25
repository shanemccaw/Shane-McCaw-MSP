/**
 * receiptWire.ts — the shape `GET /api/portal/billing/stripe-receipts` serves
 * (`artifacts/api-server/src/routes/portal-billing.ts`), and its mapping into
 * a `ReceiptView` (Git #1242).
 *
 * Split out of `receiptLive.ts` so it can be tested as a plain function — no
 * React, no fetching. Stripe invoices carry no "what this paid for" prose or
 * change-request trace the way the design's fixture receipts do, so a live
 * receipt states plainly what Stripe itself reports rather than inventing
 * narrative/trace copy the platform has no record of.
 */

import { rcMoney, type ReceiptView } from "./receiptModel";
import { RECEIPT_BILLED_TO } from "./receiptData";

export interface StripeReceiptWire {
  readonly id: string;
  readonly number: string | null;
  readonly amount: number;
  readonly currency: string;
  readonly status: string;
  readonly date: number;
  readonly invoicePdf: string | null;
}

/** A route `:id` matches a live receipt by Stripe's invoice id or its human number. */
export function stripeReceiptMatches(entry: StripeReceiptWire, routeId: string): boolean {
  return entry.id === routeId || (!!entry.number && entry.number === routeId);
}

export function receiptViewFromStripe(entry: StripeReceiptWire): ReceiptView {
  const isPaid = entry.status === "paid";
  const amountDollars = Math.round(entry.amount) / 100;
  const label = entry.number ?? entry.id;
  const dateLabel = new Date(entry.date * 1000).toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return {
    id: label,
    status: isPaid ? "Paid" : "Pending",
    isPaid,
    meta: [
      { label: "Receipt date", value: dateLabel },
      { label: "Billed to", value: RECEIPT_BILLED_TO },
      { label: "Payment method", value: isPaid ? "Card on file" : "Invoice, pending" },
      { label: "Origin", value: "Subscription invoice" },
    ],
    lines: [
      {
        name: `Invoice ${label}`,
        detail: "Subscription invoice issued through Stripe.",
        qty: "1",
        amount: rcMoney(amountDollars),
      },
    ],
    totals: [
      { label: "Subtotal", value: rcMoney(amountDollars), small: true },
      { label: "Tax", value: "Not applicable", small: true },
      { label: isPaid ? "Paid" : "Due", value: rcMoney(amountDollars), small: false },
    ],
    narrative: "A recurring subscription invoice from Stripe, shown here with the live status and amount on file.",
    trace: [
      { label: "Stripe status", value: entry.status },
      { label: "Currency", value: entry.currency.toUpperCase() },
    ],
  };
}
