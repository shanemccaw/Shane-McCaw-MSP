/**
 * Active Cards (#366) — client-side mirror of the four real card payload
 * shapes built server-side in `shanebot-engine.ts` (`InvoiceCardData`,
 * `SubscriptionCardData`, `ScoreCardData`, `DataAnswerCardData`) and extracted
 * verbatim in `docs/shanebot-contract-pack.md` §4. A card's `data` arrives as
 * `Record<string, unknown>` on the wire (contract pack §3 — `cardType` never
 * narrows the union at the routing layer), so each renderer below re-checks
 * its own shape defensively rather than trusting a cast.
 */

export interface InvoiceCardData {
  invoices: Array<{
    invoiceNumber: string;
    description: string | null;
    amount: string;
    currency: string;
    status: string;
    dueDate: string | null;
    paidAt: string | null;
  }>;
}

export interface SubscriptionCardData {
  subscriptions: Array<{
    name: string;
    status: string;
    activatedAt: string | null;
    trialExpiresAt: string | null;
  }>;
}

export interface ScoreCardData {
  identity: number;
  security: number;
  collaboration: number;
  compliance: number;
  copilotReadiness: number;
  updatedAt: string;
}

export interface DataAnswerCardData {
  subscriptions: SubscriptionCardData["subscriptions"];
  latestScan: { packageKey: string; status: string; startedAt: string | null } | null;
  purchases: Array<{ title: string; status: string; amount: string; date: string | null }>;
}

function isArray(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

/** Runtime guard — the wire `data` is `Record<string, unknown>`, never trusted blind. */
export function asInvoiceCardData(data: Record<string, unknown>): InvoiceCardData | null {
  if (!isArray(data.invoices)) return null;
  return { invoices: data.invoices as InvoiceCardData["invoices"] };
}

export function asSubscriptionCardData(data: Record<string, unknown>): SubscriptionCardData | null {
  if (!isArray(data.subscriptions)) return null;
  return { subscriptions: data.subscriptions as SubscriptionCardData["subscriptions"] };
}

export function asScoreCardData(data: Record<string, unknown>): ScoreCardData | null {
  if (typeof data.identity !== "number" || typeof data.updatedAt !== "string") return null;
  return data as unknown as ScoreCardData;
}

export function asDataAnswerCardData(data: Record<string, unknown>): DataAnswerCardData | null {
  if (!isArray(data.subscriptions) || !isArray(data.purchases)) return null;
  return data as unknown as DataAnswerCardData;
}

/** Shared date formatter — ISO string (or null) to a short, readable date. */
export function formatCardDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
