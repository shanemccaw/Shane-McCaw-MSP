/**
 * sow-expiry-sweep.ts
 *
 * Scheduled sweep that auto-expires MSP SOWs whose 30-day clock
 * (msp_sows.expires_at — stamped at creation and re-stamped at signature) has
 * elapsed, then fires a fresh diagnostics rescan for each affected customer.
 *
 * Why this exists: the msp_sows schema comment promised the SOW "auto-expires
 * after 30 days via a scheduled workflow transition" (lib/db msp.ts:1775), but
 * no such sweep was ever implemented — SOWs only expired lazily (checked when a
 * customer re-opened/signed one) or by explicit operator action via
 * POST /api/msp/sows/:sowId/expire. A signed-but-unpaid SOW that was never
 * re-opened sat at status "signed" indefinitely. This sweep closes that gap AND
 * uses the 30-day expiry as a system-detected rescan trigger: once a SOW's
 * underlying scan data is 30 days stale, refresh the customer's M365 posture.
 *
 * System-triggered, fire-and-forget, non-fatal — mirrors the consent.granted
 * scan path (routes/consent.ts). It is NOT customer-callable, so there is no
 * spam / AI-credit-burn surface (diagnostics are telemetry, not AI generation).
 * runDiagnostics has no skip-if-recent guard, so each expiry yields a genuinely
 * fresh scan. A SOW transitions to "expired" exactly once (the UPDATE is guarded
 * on the still-live status), so a rescan fires at most once per SOW; rescans are
 * de-duplicated per customer within a single sweep pass.
 */
import { db, mspSowsTable, mspSowEventsTable } from "@workspace/db";
import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";
import { logger } from "./logger";
import { runDiagnostics } from "./diagnostics-runner";

const log = logger.child({ channel: "workflow.doc-pipeline" });

export async function sweepExpiredSows(): Promise<void> {
  try {
    const now = new Date();

    // Live SOWs (sent/signed) past their 30-day expiry clock. Terminal states
    // (paid / failed / expired) and never-issued drafts are excluded — the index
    // msp_sows_expires_at_idx keeps this scan cheap.
    const candidates = await db
      .select({
        sowId: mspSowsTable.sowId,
        customerId: mspSowsTable.customerId,
      })
      .from(mspSowsTable)
      .where(
        and(
          inArray(mspSowsTable.status, ["sent", "signed"]),
          isNotNull(mspSowsTable.expiresAt),
          lt(mspSowsTable.expiresAt, now),
        ),
      );

    if (candidates.length === 0) return;

    // Rescan targets are collected only from SOWs this pass actually transitioned,
    // so a SOW that lost a race (concurrently signed/charged/expired) never fires
    // a spurious rescan.
    const rescanCustomerIds = new Set<number>();

    for (const sow of candidates) {
      // Guard the status in the WHERE: only flip if still sent/signed, so a
      // concurrent sign/charge is never clobbered by the sweep.
      const flipped = await db
        .update(mspSowsTable)
        .set({ status: "expired", updatedAt: now })
        .where(
          and(
            eq(mspSowsTable.sowId, sow.sowId),
            inArray(mspSowsTable.status, ["sent", "signed"]),
          ),
        )
        .returning({ sowId: mspSowsTable.sowId });
      if (flipped.length === 0) continue; // lost the race — already transitioned elsewhere

      // Append-only lifecycle event, mirroring emitSowEvent() in routes/msp-sow.ts.
      await db
        .insert(mspSowEventsTable)
        .values({
          sowId: sow.sowId,
          eventName: "sow.expired",
          actorRole: "system",
          payload: { auto: true, sweep: "sow-expiry-sweep" },
        })
        .catch((err: unknown) => {
          log.warn({ err, sowId: sow.sowId }, "sow-expiry-sweep: failed to write sow.expired event (non-fatal)");
        });

      if (sow.customerId != null) rescanCustomerIds.add(sow.customerId);
    }

    // One fresh diagnostics scan per distinct customer whose SOW we just expired.
    // Fire-and-forget so a slow scan never stalls the sweep; runDiagnostics
    // resolves tenantId/mspId from customerId itself.
    for (const customerId of rescanCustomerIds) {
      void (async () => {
        try {
          // 30-day SOW expiry rescan — routine, not assessment-triggered.
          await runDiagnostics({ customerId, isAssessmentTriggered: false });
          log.info({ customerId }, "sow-expiry-sweep: 30-day expiry rescan started");
        } catch (err) {
          log.warn({ err, customerId }, "sow-expiry-sweep: rescan failed (non-fatal)");
        }
      })();
    }

    log.info(
      { expiredCount: candidates.length, rescanCustomers: rescanCustomerIds.size },
      "sow-expiry-sweep: expired stale SOWs and fired rescans",
    );
  } catch (err) {
    log.warn({ err }, "sow-expiry-sweep: sweep failed (non-fatal)");
  }
}
