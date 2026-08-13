/**
 * Fulfillment — real shapes off `fulfillment_queue` / `fulfillment_sla_config`
 * / `fulfillment_types` (`lib/db/src/schema/msp.ts` + `schema/index.ts`), and
 * the pure helpers over them. No backend was written for this screen —
 * `admin-fulfillment.ts` / `admin-fulfillment-types.ts` already are the real
 * CRUD; this rebuilds the old `pages/FulfillmentQueue.tsx` /
 * `pages/FulfillmentTypes.tsx` pair inside the `SHELL.md` contract.
 *
 * Two distinct record kinds live on one screen, the same shape the Active
 * Directory screen uses: a **delivery** (one `fulfillment_queue` row — a sold
 * offer/SOW/bundle that has to be handed to a client) and a
 * **fulfillmentType** (one `fulfillment_types` row — the lifecycle *kind* a
 * service declares, wired to a `fulfillment.<key>` workflow event). See
 * `registry/types.ts`'s `PEEK_KINDS` doc comment for why they cannot share a
 * kind.
 */

export const DELIVERY_STATUSES = ["not_started", "in_progress", "delivered", "blocked"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const SOURCE_TYPES = ["offer", "sow", "bundle"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const FIRED_WHEN_VALUES = ["purchase", "signal", "manual"] as const;
export type FiredWhen = (typeof FIRED_WHEN_VALUES)[number];

/** `fulfillment_queue`. The API returns the whole row plus a server-computed `isOverdue`. */
export interface DeliveryRow {
  id: number;
  sourceType: SourceType;
  sourceId: string;
  clientUserId: number | null;
  clientName: string | null;
  clientEmail: string | null;
  mspId: number | null;
  mspName: string | null;
  customerId: number | null;
  customerName: string | null;
  itemTitle: string;
  itemDescription: string | null;
  purchasedAt: string | null;
  purchaseAmountCents: number | null;
  /** Real cost — what this delivery actually cost to fulfil, handoff.md's "real cost" convention. */
  wholesaleChargedCents: number | null;
  customerQuoteCents: number | null;
  deliveryStatus: DeliveryStatus;
  statusUpdatedAt: string | null;
  statusNote: string | null;
  projectId: number | null;
  presentationId: number | null;
  invoiceId: number | null;
  slaDueAt: string | null;
  slaThresholdDays: number | null;
  isOverdue: boolean;
  createdAt: string;
}

/** `GET /api/admin/fulfillment-queue`'s aggregate block — computed server-side, never client-derived. */
export interface QueueMeta {
  total: number;
  overdue: number;
  byStatus: Record<DeliveryStatus, number>;
  page: number;
  pageSize: number;
}

export interface QueueFilters {
  status: DeliveryStatus | "";
  sourceType: SourceType | "";
  overdue: boolean;
  q: string;
}

export const EMPTY_FILTERS: QueueFilters = { status: "", sourceType: "", overdue: false, q: "" };

/** `fulfillment_sla_config`. One row per source type, plus `"default"`. */
export interface SlaConfigRow {
  id: number;
  key: string;
  label: string;
  thresholdDays: number;
  updatedAt: string;
}

/** `fulfillment_types`. */
export interface FulfillmentTypeRow {
  key: string;
  label: string;
  description: string | null;
  firedWhen: FiredWhen[];
  recurring: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** The four standard types the old admin panel offered to seed an empty registry with. */
export const PRESET_TYPES: Array<Omit<FulfillmentTypeRow, "createdAt" | "updatedAt">> = [
  { key: "assessment", label: "Assessment", description: "One-time M365 health/readiness assessment", firedWhen: ["purchase", "signal"], recurring: false, isActive: true },
  { key: "bundle_subscription", label: "Bundle Subscription", description: "Recurring bundle of services billed monthly", firedWhen: ["purchase"], recurring: true, isActive: true },
  { key: "retainer", label: "Retainer", description: "Monthly retainer engagement", firedWhen: ["purchase"], recurring: true, isActive: true },
  { key: "msp_monthly_subscription", label: "MSP Monthly Subscription", description: "Managed service provider monthly subscription", firedWhen: ["purchase"], recurring: true, isActive: true },
];

export const STATUS_LABEL: Record<DeliveryStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  delivered: "Delivered",
  blocked: "Blocked",
};

export const SOURCE_LABEL: Record<SourceType, string> = {
  offer: "Micro-offer",
  sow: "SOW",
  bundle: "Bundle",
};

/** Cycling order for the peek's status cycle-button and the "advance" contextual command. */
export const STATUS_CYCLE: DeliveryStatus[] = ["not_started", "in_progress", "delivered", "blocked"];

export function nextStatus(current: DeliveryStatus): DeliveryStatus {
  const i = STATUS_CYCLE.indexOf(current);
  return STATUS_CYCLE[(i + 1) % STATUS_CYCLE.length];
}

export function usd(cents: number | null): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

/** Compact form for a gallery row's monospace tile — "$1.2k" rather than "$1,200". */
export function compactUsd(cents: number | null): string {
  if (cents == null) return "—";
  const dollars = cents / 100;
  if (Math.abs(dollars) >= 1000) return `$${(dollars / 1000).toFixed(dollars >= 10000 ? 0 : 1)}k`;
  return `$${Math.round(dollars)}`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** "3 days overdue" / "due in 2 days" / "due today" — the fact the SLA due date exists to state. */
export function slaNote(item: DeliveryRow): string {
  if (!item.slaDueAt) return "no SLA set";
  const days = Math.round((new Date(item.slaDueAt).getTime() - Date.now()) / 86_400_000);
  if (item.isOverdue) return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`;
  if (days === 0) return "due today";
  return `due in ${days} day${days === 1 ? "" : "s"}`;
}

export function deliveryDomain(item: DeliveryRow): string {
  return item.mspName ?? item.customerName ?? item.clientName ?? item.clientEmail ?? "Unassigned";
}

/** Free-text match over what an operator would actually type. */
export function deliveryMatches(item: DeliveryRow, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    item.itemTitle.toLowerCase().includes(q) ||
    (item.clientName ?? "").toLowerCase().includes(q) ||
    (item.clientEmail ?? "").toLowerCase().includes(q) ||
    (item.customerName ?? "").toLowerCase().includes(q) ||
    (item.mspName ?? "").toLowerCase().includes(q)
  );
}

export function firedWhenLabel(values: FiredWhen[]): string {
  return values.length ? values.join(", ") : "nothing — it never fires on its own";
}

/**
 * A registry key from a typed label — mirrors `admin-fulfillment-types.ts`'s
 * `createSchema` regex (`^[a-z0-9_]+$`) so the client can never propose a key
 * the server would reject.
 */
export function keyFromLabel(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/** "3 minutes ago" / "6 Aug" — matches `packagesTypes.ts`'s `whenShort`. */
export function whenShort(iso: string | null | undefined): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "never";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 8) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
