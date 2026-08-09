/**
 * Document Viewer — API client.
 *
 * Every function takes `adminFetch` first, same convention as
 * `screens/run-history/runHistoryApi.ts`, so both React components and
 * `documentsStore`'s module-scope calls (ribbon closures run outside React)
 * use one client.
 *
 * There is no `create`. Generating a document is the old (non-adminv2) admin
 * panel's Document Generator IDE's job — see `documentsTypes.ts`'s file doc
 * comment — this client only reads real generations back and archives one.
 */

import { CATEGORY_LABEL, isDocStatus, type DocumentEntry } from "./documentsTypes";

export type AdminFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const BASE = "/api/admin/document-generator";

/** The route's own cap (`admin-document-generator.ts` clamps `limit` to 200). */
export const HISTORY_FETCH_LIMIT = 200;

interface HistoryRow {
  id: number;
  docType: string;
  category: string;
  title: string;
  status: string;
  errorMessage: string | null;
  createdAt: string;
  customerId: number | null;
  customerName: string | null;
  customerCompany: string | null;
  projectId: number | null;
  projectTitle: string | null;
  docTypeLabel: string | null;
  costCents: number | null;
}

function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string") {
    return (body as { error: string }).error;
  }
  return `Request failed (${status})`;
}

function toEntry(row: HistoryRow): DocumentEntry {
  return {
    id: String(row.id),
    docType: row.docType,
    docTypeLabel: row.docTypeLabel,
    category: row.category in CATEGORY_LABEL ? (row.category as DocumentEntry["category"]) : "report",
    title: row.title,
    status: isDocStatus(row.status) ? row.status : "draft",
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
    customerId: row.customerId,
    customerName: row.customerName,
    customerCompany: row.customerCompany,
    projectId: row.projectId,
    projectTitle: row.projectTitle,
    costCents: row.costCents,
  };
}

/**
 * The most recent generations across every tenant, newest first. The real
 * route takes `docType`/`limit` only — no free-text search, no category
 * filter — so `documentsStore` filters this loaded window client-side rather
 * than sending a second request per keystroke.
 */
export async function fetchDocumentHistory(adminFetch: AdminFetch): Promise<DocumentEntry[]> {
  const res = await adminFetch(`${BASE}/history?limit=${HISTORY_FETCH_LIMIT}`);
  const body: unknown = await res.json().catch(() => []);
  if (!res.ok) throw new Error(errorMessage(body, res.status));
  return Array.isArray(body) ? body.map((row) => toEntry(row as HistoryRow)) : [];
}

/** The document's real generated body — self-contained HTML, meant for an `srcDoc` iframe. */
export async function fetchDocumentHtml(adminFetch: AdminFetch, id: string): Promise<string> {
  const res = await adminFetch(`${BASE}/history/${id}/html`);
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => ({}));
    throw new Error(errorMessage(body, res.status));
  }
  return res.text();
}

/** Soft delete — sets `status='archived'`. There is no hard-delete route. */
export async function archiveDocument(adminFetch: AdminFetch, id: string): Promise<void> {
  const res = await adminFetch(`${BASE}/history/${id}/archive`, { method: "POST" });
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(errorMessage(body, res.status));
}
