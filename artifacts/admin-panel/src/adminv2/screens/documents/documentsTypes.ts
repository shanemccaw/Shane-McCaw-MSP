/**
 * Document Viewer — shared types and label derivations.
 *
 * A "document" is one real `insights_generated_documents` row — an AI-written
 * deliverable (a report, a SOW) generated for one tenant. Rows come from
 * `GET /api/admin/document-generator/history`
 * (`artifacts/api-server/src/routes/admin-document-generator.ts`), the exact
 * same table and route the old (non-adminv2) admin panel's Document Generator
 * IDE already reads and writes. This screen only reads it, plus the one
 * existing mutation it exposes (`archive`) — generation itself (tenant/project
 * pickers, the AI call, editing a document type's scoping) stays the old IDE's
 * job. `Design/adminv2/handoff.md`'s "Document Generator is on hold and its UI
 * has been removed" is why this screen does not rebuild that half; it exists
 * to fill the OTHER known gap SHELL.md names explicitly — the design's own
 * `viewerColStyle` overlay ("read it without leaving") — for a screen that
 * finally needs it.
 *
 * `htmlContent` (the real generated body, self-contained styled HTML — see
 * `SimulatorDocumentCanvas.tsx`'s `srcDoc` iframe for the established
 * rendering convention this screen reuses) is never in the list response — it
 * is fetched per selection from `.../history/:id/html`, same reasoning as Run
 * History's `output`: a real document can be tens of kB and shipping it for
 * every row in the list would be paid for and never read.
 */

export type DocCategory = "report" | "consulting";
export type DocStatus = "draft" | "approved" | "delivered" | "archived" | "generating" | "failed";

const DOC_STATUSES: readonly DocStatus[] = ["draft", "approved", "delivered", "archived", "generating", "failed"];

export function isDocStatus(value: string): value is DocStatus {
  return (DOC_STATUSES as readonly string[]).includes(value);
}

export interface DocumentEntry {
  /** `insights_generated_documents.id`, stringified — the doc/peek record id. */
  id: string;
  docType: string;
  /** `document_types.label` for this `docType`, when that catalog row still exists. */
  docTypeLabel: string | null;
  category: DocCategory;
  title: string;
  status: DocStatus;
  errorMessage: string | null;
  /** ISO 8601. */
  createdAt: string;
  customerId: number | null;
  customerName: string | null;
  customerCompany: string | null;
  projectId: number | null;
  projectTitle: string | null;
  /** Cents. Null when no `ai_usage_events` row matched — "unknown", never a fabricated $0. */
  costCents: number | null;
  /** Fetched lazily per selection — see file doc comment. Undefined means "not fetched yet". */
  html?: string;
}

export type DocCategoryFilter = "All" | DocCategory;
export const DOC_CATEGORY_FILTERS: readonly DocCategoryFilter[] = ["All", "report", "consulting"];

export const CATEGORY_LABEL: Record<DocCategory, string> = {
  report: "Report",
  consulting: "Consulting",
};

export const STATUS_LABEL: Record<DocStatus, string> = {
  draft: "draft",
  approved: "approved",
  delivered: "delivered",
  archived: "archived",
  generating: "generating",
  failed: "failed",
};

/** Pure tone bucket — kept free of theme imports; call sites map this to an `ACCENT.*` value. */
export type ToneBucket = "danger" | "amber" | "green" | "neutral";

export function statusTone(status: DocStatus): ToneBucket {
  if (status === "failed") return "danger";
  if (status === "generating") return "amber";
  if (status === "approved" || status === "delivered") return "green";
  return "neutral";
}

/** Who it's for — the tenant/company name if one resolved, else the login name, else honest about the gap. */
export function subjectLabel(e: DocumentEntry): string {
  return e.customerCompany || e.customerName || "no tenant on record";
}

/** "$0.42" / "$0.00" / "unknown" — costCents is null only when no `ai_usage_events` row matched. */
export function costLabel(e: DocumentEntry): string {
  if (e.costCents == null) return "unknown";
  return "$" + (e.costCents / 100).toFixed(2);
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function calendarDaysBetween(then: number, now: number): number {
  return Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000);
}

function clockLabel(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "today 09:12" / "yesterday 17:40" / "Mon 11:06" / "24 Jul 08:00" — same ladder as Run History's `whenLabel`. */
export function whenLabel(createdAt: string, now: number = Date.now()): string {
  const ms = Date.parse(createdAt);
  if (Number.isNaN(ms)) return createdAt;
  const days = calendarDaysBetween(ms, now);
  const clock = clockLabel(ms);
  if (days <= 0) return `today ${clock}`;
  if (days === 1) return `yesterday ${clock}`;
  if (days < 7) {
    const weekday = new Date(ms).toLocaleDateString(undefined, { weekday: "short" });
    return `${weekday} ${clock}`;
  }
  const date = new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return `${date} ${clock}`;
}
