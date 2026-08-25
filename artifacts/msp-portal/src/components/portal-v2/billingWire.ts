/**
 * billingWire.ts — the wire shapes and normalisation behind
 * GET /api/portal/invoices, the real source for the Billing page's Receipts
 * section (Git #1237).
 *
 * Pure functions, no React, so they can be unit-tested directly (the fetching
 * lives in `billingLive.ts`). `invoicesTable` is the platform's one real
 * billing-history ledger — every invoice, paid or not, direct-checkout or
 * onboarding — so it is what "Receipts" actually means once real money has
 * moved; `BILL_RECEIPTS` (billingData.ts) stays the design fixture for a
 * customer with no invoice history yet, or while the read is still loading.
 *
 * Only the four fields the row actually renders (date, what, ref, amount) are
 * pulled from the wire row; the id is kept alongside so the page can wire the
 * per-row "Receipt" button to a real download instead of leaving it inert.
 */

export interface WireInvoice {
  readonly id?: unknown;
  readonly invoiceNumber?: unknown;
  readonly description?: unknown;
  readonly amount?: unknown;
  readonly status?: unknown;
  readonly invoiceType?: unknown;
  readonly pdfFilename?: unknown;
  readonly paidAt?: unknown;
  readonly createdAt?: unknown;
}

export interface BillingReceiptRow {
  readonly id: number;
  readonly date: string;
  readonly what: string;
  readonly ref: string;
  readonly amount: string;
  /** Whether GET /api/portal/invoices/:id/download has a file to serve. */
  readonly downloadable: boolean;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** '$' + thousands-grouped, two-decimal amount — matches billingModel's fmt$
 *  in spirit but keeps cents, since a real invoice amount is not always whole. */
function fmtAmount(raw: unknown): string {
  const n = typeof raw === "string" ? Number.parseFloat(raw) : typeof raw === "number" ? raw : NaN;
  if (!Number.isFinite(n)) return "$0";
  const hasCents = Math.round(n * 100) % 100 !== 0;
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: hasCents ? 2 : 0, maximumFractionDigits: 2 });
}

/** "29 Jul 2026" — the fixture's own date style (billingData.ts BILL_RECEIPTS). */
function fmtDate(iso: unknown): string {
  const d = new Date(str(iso));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

const INVOICE_TYPE_FALLBACK: Record<string, string> = {
  retainer: "Architect retainer",
  instant: "One-time purchase",
};

/** A row's "what" line: the invoice's own description, or a generic label
 *  derived from its type when none was recorded. */
function whatLine(raw: WireInvoice): string {
  const description = str(raw.description);
  if (description) return description;
  return INVOICE_TYPE_FALLBACK[str(raw.invoiceType)] ?? "Tenant Monitoring";
}

function toReceiptRow(raw: WireInvoice): BillingReceiptRow | null {
  const id = typeof raw.id === "number" ? raw.id : Number.parseInt(str(raw.id), 10);
  if (!Number.isFinite(id)) return null;
  return {
    id,
    date: fmtDate(raw.paidAt ?? raw.createdAt),
    what: whatLine(raw),
    ref: str(raw.invoiceNumber) || `inv_${id}`,
    amount: fmtAmount(raw.amount),
    downloadable: !!str(raw.pdfFilename),
  };
}

/** The invoice list as receipt rows, newest first (the endpoint already
 *  orders by createdAt desc). Rows with no usable id are dropped — an id is
 *  what makes a receipt a receipt rather than a line of forgotten text. */
export function toBillingReceipts(payload: readonly WireInvoice[] | null | undefined): readonly BillingReceiptRow[] {
  if (!Array.isArray(payload)) return [];
  return payload.map(toReceiptRow).filter((r): r is BillingReceiptRow => r !== null);
}
