/**
 * Wire types for the customer-facing Documents surface (#4003, Feature #1658),
 * extracted from
 * `Design/portal/design_handoff_full_site/docs/documents-contract-pack.md`
 * against the real `portal-documents.ts` routes — all 8 of them.
 */

/** `GET /api/portal/reports` — full row, no field projection. */
export interface WireReport {
  id: number;
  clientUserId: number;
  projectId: number | null;
  title: string;
  period: "weekly" | "monthly" | "executive_summary" | "other" | string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  reportDate: string | null;
  createdAt: string;
}

/** `GET /api/portal/insights-documents` — field-projected list row, no `htmlContent`. */
export interface WireInsightDocument {
  id: number;
  title: string;
  category: "report" | "consulting" | string;
  docType: string;
  status: "draft" | "approved" | "delivered" | "archived" | "generating" | "failed" | string;
  deliveredAt: string | null;
  createdAt: string;
  sowTotalPrice: number | null;
  projectId: number | null;
  projectTitle: string | null;
}

/** `GET /api/portal/insights-documents/:id/view` response. */
export interface WireDocumentView {
  id: number;
  title: string;
  htmlContent: string;
}

/** `POST /api/portal/documents/:id/share` response. */
export interface WireShareResult {
  shareUrl: string;
  expiresAt: string;
}

/**
 * The Copilot Readiness journey's 7 "live spine" reports — they render live in
 * the browser from the tenant's own scan data and have no stored HTML, so the
 * server refuses /view (409) and its /pdf export currently fails (#2507, the
 * live Document Viewer route it depends on does not exist in `artifacts/portal`
 * yet — #2825/#2866). Kept in sync BY HAND with `LIVE_RENDERED_DOC_TYPES` in
 * `artifacts/api-server/src/routes/portal-documents.ts:29-37` — the same
 * cross-app-duplication pattern that file's own header comment documents.
 */
export const LIVE_RENDERED_DOC_TYPES = new Set<string>([
  "copilot_readiness",
  "security_posture_report",
  "governance_maturity_report",
  "compliance_alignment_report",
  "license_optimization_report",
  "adoption_report",
  "operational_health_report",
]);

/** `portal-documents.ts` sends `{ error: "<message>" }` — a bare string. */
export interface ApiErrorBody {
  error?: string;
}
