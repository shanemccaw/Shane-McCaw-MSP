/**
 * msp-change-pir.ts — the pure derivations behind the Post-Implementation
 * Review record (Git #1502).
 *
 * A close code a human types is a status field, not a review. This file (and
 * the `cr_pirs` table it reasons over) is what turns a closed change into a
 * REVIEWED one: a real close-code vocabulary, a required narrative, and the
 * honest boundary of what the drift re-scan can and cannot confirm.
 *
 * Everything here is a total function over stored values — no database, no
 * request — the same split `msp-change-execution.ts` follows for `cr_executions`.
 * The store (`msp-change-pir-store.ts`) and the route (`routes/msp-change-pir.ts`)
 * are where these functions meet the DB and the drift-collection engine.
 */

import type { CrPir, CrPirCloseCode, CrPirDriftRescanStatus } from "@workspace/db";
import { CR_PIR_CLOSE_CODES, CR_PIR_DRIFT_RESCAN_STATUSES } from "@workspace/db";
import { formatChangeRequestCode } from "./portal-change-control";

export { CR_PIR_CLOSE_CODES, CR_PIR_DRIFT_RESCAN_STATUSES, formatChangeRequestCode };
export type { CrPirCloseCode, CrPirDriftRescanStatus };

/**
 * The drift domain, and the `monitor_checks.key` that drives it, for the ONE
 * category `monitor-executor.ts` attributes drift to a CR for today. Kept here
 * (not just in `drift-check-specs.ts`) as the single explicit statement of the
 * boundary this build does not widen: every other category resolves to
 * `undefined` and the PIR honestly records `not_applicable` rather than running
 * a scan the attribution engine cannot use.
 */
export const PIR_DRIFT_RESCAN_CA_DOMAIN_KEY = "ca-policy";

/** Categories `msp_change_requests.category` may hold that have a drift re-scan path today. */
export function categoryHasDriftRescanPath(category: string): boolean {
  return category === "ConditionalAccess";
}

// ── Wire shape ───────────────────────────────────────────────────────────────

/** One PIR record, as the MSP operator surface consumes it. */
export interface WireCrPir {
  readonly id: number;
  readonly executionId: number;
  readonly changeRequestId: number;
  readonly changeCode: string;
  readonly tenantId: string;
  readonly closeCode: CrPirCloseCode;
  readonly summary: string;
  readonly issuesNoted: string | null;
  readonly reviewedBy: string;
  readonly reviewedByPersonId: string | null;
  readonly reviewedAt: string;
  readonly driftRescan: {
    readonly applicable: boolean;
    readonly domainKey: string | null;
    readonly checkKey: string | null;
    readonly status: CrPirDriftRescanStatus;
    readonly eventsInsertedCount: number | null;
    readonly attributedCount: number | null;
    readonly otherOpenDriftCount: number | null;
    readonly note: string | null;
    readonly ranAt: string | null;
  };
  readonly createdAt: string;
}

export function toWireCrPir(row: CrPir): WireCrPir {
  return {
    id: row.id,
    executionId: row.executionId,
    changeRequestId: row.changeRequestId,
    changeCode: formatChangeRequestCode(row.changeRequestId),
    tenantId: row.tenantId,
    closeCode: row.closeCode,
    summary: row.summary,
    issuesNoted: row.issuesNoted,
    reviewedBy: row.reviewedBy,
    reviewedByPersonId: row.reviewedByPersonId,
    reviewedAt: row.reviewedAt.toISOString(),
    driftRescan: {
      applicable: row.driftRescanApplicable,
      domainKey: row.driftRescanDomainKey,
      checkKey: row.driftRescanCheckKey,
      status: row.driftRescanStatus,
      eventsInsertedCount: row.driftRescanEventsInsertedCount,
      attributedCount: row.driftRescanAttributedCount,
      otherOpenDriftCount: row.driftRescanOtherOpenDriftCount,
      note: row.driftRescanNote,
      ranAt: row.driftRescanRanAt ? row.driftRescanRanAt.toISOString() : null,
    },
    createdAt: row.createdAt.toISOString(),
  };
}
