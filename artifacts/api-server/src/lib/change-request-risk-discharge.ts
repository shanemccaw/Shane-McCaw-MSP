/**
 * change-request-risk-discharge.ts — Git #1514, the second half of the
 * rejection-to-risk lifecycle.
 *
 * #1496's own commit (ab2368df8c) already shipped the FORWARD pointer:
 * `msp_risk_decisions.spawned_by_change_request_id`, written by both
 * `declineRoutedChangeToRisk()` (m365-change-router.ts, for a routed Microsoft
 * change) and `createAssignedRiskFromRejection()` (portal-change-rejection.ts,
 * for every other change) the moment a CUSTOMER's rejection becomes an
 * accepted risk. The BACK pointer — `discharged_by_change_request_id`, "the
 * fresh CR that later supersedes it" (#1514's own lifecycle) — has carried the
 * column and its migration since the same day but nothing ever wrote it. This
 * file is that writer.
 *
 * WHERE THIS FIRES
 * -----------------
 * `POST /portal/change-control` is the one real place a fresh CR is raised
 * carrying `remediationCheckKey` — the #1541 structured link this build's
 * companion fix (`portal-change-rejection.ts`) also carries onto the risk row
 * it creates, specifically so this lookup can find it later. A newly-created
 * CR whose `remediationCheckKey` matches an ACTIVE accepted risk's `checkKey`
 * (same mspId + tenantId, the identical scoping pair #1279's suppression
 * query already uses) IS, by construction, the fresh CR being raised to
 * actually address what was previously just accepted — the exact "supersede"
 * event #1508's own version-chain precedent fires AT CAPTURE TIME, not later:
 * a new version/CR becomes current the moment it exists, not once some later
 * step confirms it worked.
 *
 * WHAT DISCHARGE DOES NOT TOUCH
 * -------------------------------
 * The acceptance `status` (pending_signature / active / revoked) is left
 * alone. #1507 is explicit that an acceptance is a signed fact that does not
 * expire — "revoked" is a distinct MSP-operator act (`PATCH
 * /msp/rbd/:rbdId/revoke`), not a side effect of a new CR existing, and
 * flipping it here would also silently lift the #1279 alert-suppression this
 * discharge is not the place to decide. Only `riskStatus` (the RISK's own
 * lifecycle: Open / Mitigating / Accepted / Closed / Expired) moves, to
 * `Closed` — the risk is no longer the standing, unaddressed position now
 * that a real CR is on record to resolve it.
 */

import { db, mspRiskDecisionsTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";

import { logger } from "./logger";

const log = logger.child({ channel: "workflow.change-control" });

export interface DischargeInput {
  /** The fresh CR being raised — the one that supersedes the risk(s) found. */
  readonly changeRequestId: number;
  readonly mspId: number;
  readonly tenantId: string;
  /** The exact `msp_risk_decisions.check_key` this CR was raised to fix. */
  readonly checkKey: string;
}

export interface DischargeResult {
  /** Every risk decision this CR just discharged. Empty when none matched — the
   * common case, since most CRs carry no `remediationCheckKey` at all and most
   * that do find no standing accepted risk on the same check. */
  readonly dischargedRiskIds: readonly number[];
}

/**
 * Discharges every ACTIVE, not-yet-discharged accepted risk on this
 * (mspId, tenantId, checkKey) — there is normally at most one, but this does
 * not assume it: a remediation-tracker decline (#1542) and a Change-Control
 * rejection (#1514) can both have separately accepted the same check, and a
 * single fresh CR resolves both records at once.
 *
 * The `isNull(dischargedByChangeRequestId)` guard is also the concurrency
 * guard: two CRs racing to discharge the same risk, only the first UPDATE's
 * WHERE still matches.
 */
export async function dischargeRisksForNewChangeRequest(input: DischargeInput): Promise<DischargeResult> {
  const now = new Date();
  const updated = await db
    .update(mspRiskDecisionsTable)
    .set({
      dischargedByChangeRequestId: input.changeRequestId,
      riskStatus: "Closed",
      updatedAt: now,
    })
    .where(
      and(
        eq(mspRiskDecisionsTable.mspId, input.mspId),
        eq(mspRiskDecisionsTable.tenantId, input.tenantId),
        eq(mspRiskDecisionsTable.checkKey, input.checkKey),
        eq(mspRiskDecisionsTable.status, "active"),
        isNull(mspRiskDecisionsTable.dischargedByChangeRequestId),
      ),
    )
    .returning({ id: mspRiskDecisionsTable.id });

  const dischargedRiskIds = updated.map((r) => r.id);
  if (dischargedRiskIds.length > 0) {
    log.info(
      { changeRequestId: input.changeRequestId, mspId: input.mspId, checkKey: input.checkKey, dischargedRiskIds },
      "change-request-risk-discharge: fresh CR discharged prior accepted risk(s) (#1514)",
    );
  }
  return { dischargedRiskIds };
}
