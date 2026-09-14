/**
 * invoiceDetailWire.ts — wire shapes and normalisation behind the real invoice
 * detail + version-history endpoints (#4116, follow-on from #4109's versioned
 * re-issue):
 *
 *   GET /api/portal/invoices/:id
 *   GET /api/portal/invoices/:id/versions
 *
 * served by `artifacts/api-server/src/routes/portal-billing.ts`. Pure
 * functions, no React — the fetching lives in `invoiceDetailLive.ts`.
 */

export interface WireInvoiceDetail {
  readonly invoice?: {
    readonly id?: unknown;
    readonly invoiceNumber?: unknown;
    readonly description?: unknown;
    readonly amount?: unknown;
    readonly currency?: unknown;
    readonly status?: unknown;
    readonly invoiceType?: unknown;
    readonly dueDate?: unknown;
    readonly paidAt?: unknown;
    readonly createdAt?: unknown;
    readonly version?: unknown;
    readonly revisionReason?: unknown;
    readonly pdfFilename?: unknown;
  };
  readonly project?: { readonly id?: unknown; readonly title?: unknown } | null;
}

export interface InvoiceDetail {
  readonly id: number;
  readonly invoiceNumber: string;
  readonly description: string;
  readonly amountCents: number;
  readonly amountDisplay: string;
  readonly currency: string;
  readonly status: string;
  readonly dueDate: string | null;
  readonly createdAt: string;
  readonly version: number;
  readonly revisionReason: string | null;
  readonly projectTitle: string | null;
  readonly downloadable: boolean;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number {
  if (typeof value === "number") return value;
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function toInvoiceDetail(payload: WireInvoiceDetail | null | undefined): InvoiceDetail | null {
  const raw = payload?.invoice;
  if (!raw) return null;
  const id = typeof raw.id === "number" ? raw.id : Number.parseInt(str(raw.id), 10);
  if (!Number.isFinite(id)) return null;
  // invoicesTable.amount is integer cents (Git #1610); the wire from GET
  // /portal/invoices/:id sends the raw column value, not a pre-formatted string
  // (unlike GET /portal/invoices/:id/versions below, which formats server-side).
  const amountCents = num(raw.amount);
  return {
    id,
    invoiceNumber: str(raw.invoiceNumber) || `inv_${id}`,
    description: str(raw.description),
    amountCents,
    amountDisplay: `$${(amountCents / 100).toFixed(2)}`,
    currency: str(raw.currency) || "usd",
    status: str(raw.status),
    dueDate: raw.dueDate != null ? str(raw.dueDate) : null,
    createdAt: str(raw.createdAt),
    version: typeof raw.version === "number" ? raw.version : 1,
    revisionReason: raw.revisionReason != null ? str(raw.revisionReason) : null,
    projectTitle: payload?.project?.title != null ? str(payload.project.title) : null,
    downloadable: !!str(raw.pdfFilename),
  };
}

export interface WireInvoiceVersion {
  readonly id?: unknown;
  readonly version?: unknown;
  readonly status?: unknown;
  readonly amount?: unknown;
  readonly description?: unknown;
  readonly dueDate?: unknown;
  readonly revisionReason?: unknown;
  readonly createdAt?: unknown;
  readonly isCurrent?: unknown;
  readonly diff?: ReadonlyArray<{ readonly field?: unknown; readonly from?: unknown; readonly to?: unknown }>;
}

export interface InvoiceVersion {
  readonly id: number;
  readonly version: number;
  readonly status: string;
  /** Already dollar-formatted by the server for this endpoint. */
  readonly amount: string;
  readonly description: string;
  readonly dueDate: string | null;
  readonly revisionReason: string | null;
  readonly createdAt: string;
  readonly isCurrent: boolean;
  readonly diff: ReadonlyArray<{ readonly field: string; readonly from: string; readonly to: string }>;
}

function toVersion(raw: WireInvoiceVersion): InvoiceVersion | null {
  const id = typeof raw.id === "number" ? raw.id : Number.parseInt(str(raw.id), 10);
  if (!Number.isFinite(id)) return null;
  return {
    id,
    version: typeof raw.version === "number" ? raw.version : 1,
    status: str(raw.status),
    amount: str(raw.amount),
    description: str(raw.description),
    dueDate: raw.dueDate != null ? str(raw.dueDate) : null,
    revisionReason: raw.revisionReason != null ? str(raw.revisionReason) : null,
    createdAt: str(raw.createdAt),
    isCurrent: raw.isCurrent === true,
    diff: Array.isArray(raw.diff)
      ? raw.diff
          .map((d) => ({ field: str(d.field), from: str(d.from), to: str(d.to) }))
          .filter((d) => d.field !== "")
      : [],
  };
}

/** Oldest-first, exactly as the endpoint already orders them. */
export function toInvoiceVersions(payload: { readonly versions?: readonly WireInvoiceVersion[] } | null | undefined): readonly InvoiceVersion[] {
  if (!Array.isArray(payload?.versions)) return [];
  return payload.versions.map(toVersion).filter((v): v is InvoiceVersion => v !== null);
}
