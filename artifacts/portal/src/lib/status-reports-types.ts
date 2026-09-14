/**
 * Wire types for the customer-facing Status Reports surface, #4038 (Feature
 * #3435, phase 4 of 4), extracted verbatim from
 * `docs/portal/status-reports-portal-contract-pack.md` against the real
 * `artifacts/api-server/src/routes/portal-status-reports.ts`.
 *
 * **Not the same "status reports" concept as `my-architect-types.ts`'s
 * `WireStatusReport`** — that's the `status_reports` table (retainer status
 * reports, admin-authored). This is `msp_status_reports` /
 * `msp_status_report_comments` (MSP Console-authored, two-sided comment
 * thread). See the contract pack's §0 for the full disambiguation table.
 */

export type StatusReportCommentAuthorType = "customer" | "msp";

/** `portal-status-reports.ts:62-73` — deliberately narrower than the
 * MSP-side wire: no `state`, `customerId`, or `authoredByUserId`. */
export interface WireMspStatusReport {
  id: number;
  periodLabel: string;
  asOfDate: string;
  content: string;
  authoredByName: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

/** `portal-status-reports.ts:75-84` — no `updatedAt`; comments are never
 * edited by either side. */
export interface WireMspStatusReportComment {
  id: number;
  reportId: number;
  authorType: StatusReportCommentAuthorType | string;
  authorName: string | null;
  body: string;
  createdAt: string;
}

/** `portal-status-reports.ts` sends `{ error: "<message>" }` — a bare
 * string, same shape `my-architect-types.ts`'s `ApiErrorBody` uses. */
export interface ApiErrorBody {
  error?: string;
}
