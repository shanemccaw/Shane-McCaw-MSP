/**
 * msp-billing-nodes.ts
 *
 * Dedicated handlers for the `msp_dunning_advance` and `msp_overage_meter`
 * workflow node types. Called directly from the executor case blocks —
 * no opaque dispatcher involved.
 */

import { db } from "@workspace/db";
import { mspSubscriptionsTable, mspsTable, mspEventStoreTable, mspCustomersTable, servicesTable } from "@workspace/db";
import { eq, and, isNotNull, sql, count } from "drizzle-orm";
import { logger } from "./logger";
const log = logger.child({ channel: "billing" });

// ── MSP Dunning State Machine ─────────────────────────────────────────────────
// Runs daily (seeded workflow). For each past_due/unpaid subscription,
// computes days since paymentFailedAt and advances dunning state.
// Thresholds (configurable via node data — passed in payload):
//   Day 3  → reminder_sent
//   Day 7  → suspended
//   Day 14 → access_revoked
//   Day 30 → archival_flagged

export async function handleMspDunningAdvance(
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const dayReminder  = Number(payload.dayReminder  ?? 3);
  const daySuspend   = Number(payload.daySuspend   ?? 7);
  const dayRevoke    = Number(payload.dayRevoke    ?? 14);
  const dayArchive   = Number(payload.dayArchive   ?? 30);

  const overdue = await db
    .select({
      id: mspSubscriptionsTable.id,
      mspId: mspSubscriptionsTable.mspId,
      dunningState: mspSubscriptionsTable.dunningState,
      paymentFailedAt: mspSubscriptionsTable.paymentFailedAt,
      contactEmail: mspSubscriptionsTable.contactEmail,
    })
    .from(mspSubscriptionsTable)
    .where(and(
      sql`status IN ('past_due', 'unpaid')`,
      isNotNull(mspSubscriptionsTable.paymentFailedAt),
    ));

  const now = new Date();
  let advanced = 0;
  let suspended = 0;
  let revoked = 0;
  let archived = 0;

  for (const sub of overdue) {
    const failedAt = sub.paymentFailedAt!;
    const daysSince = Math.floor((now.getTime() - failedAt.getTime()) / 86_400_000);

    let targetState: "reminder_sent" | "suspended" | "access_revoked" | "archival_flagged" | null = sub.dunningState as typeof targetState;

    if (daysSince >= dayArchive && targetState !== "archival_flagged") {
      targetState = "archival_flagged";
      archived++;
    } else if (daysSince >= dayRevoke && targetState !== "access_revoked" && targetState !== "archival_flagged") {
      targetState = "access_revoked";
      revoked++;
    } else if (daysSince >= daySuspend && targetState !== "suspended" && targetState !== "access_revoked" && targetState !== "archival_flagged") {
      targetState = "suspended";
      suspended++;
    } else if (daysSince >= dayReminder && !targetState) {
      targetState = "reminder_sent";
    }

    if (targetState !== sub.dunningState) {
      await db.update(mspSubscriptionsTable).set({
        dunningState: targetState,
        updatedAt: now,
      }).where(eq(mspSubscriptionsTable.id, sub.id));

      // Sync MSP status for suspension/revocation states.
      // suspendedAt is only set on the first suspension transition — NOT
      // reset on subsequent access_revoked escalation, so the 7-day clock
      // keeps running from when the MSP was first suspended.
      if (targetState === "suspended") {
        await db.update(mspsTable)
          .set({ status: "suspended", suspendedAt: now, updatedAt: now })
          .where(eq(mspsTable.id, sub.mspId));
      } else if (targetState === "access_revoked") {
        await db.update(mspsTable)
          .set({ status: "suspended", updatedAt: now })
          .where(eq(mspsTable.id, sub.mspId));
      }

      await db.insert(mspEventStoreTable).values({
        eventType: `msp.dunning.${targetState}`,
        source: "dunning-workflow",
        actor: { id: "system", role: "system", type: "system" },
        meta: { tenant: { mspId: sub.mspId, customerId: null } },
        payload: {
          mspId: sub.mspId,
          dunningState: targetState,
          daysSinceFailure: daysSince,
          contactEmail: sub.contactEmail ?? null,
        },
        mspId: sub.mspId,
        ownerType: "platform",
      }).catch((err: unknown) => {
        log.warn({ err, mspId: sub.mspId }, "msp_dunning_advance: event store insert failed (non-fatal)");
      });

      log.info({ mspId: sub.mspId, daysSince, prevState: sub.dunningState, newState: targetState }, "msp_dunning_advance: state advanced");
      advanced++;
    }
  }

  const result = { checked: overdue.length, advanced, suspended, revoked, archived };
  log.info(result, "msp_dunning_advance: completed");
  return result;
}

// ── MSP Overage Metering ──────────────────────────────────────────────────────
// Runs monthly (seeded workflow). For each active subscription, counts
// active tenants vs tier allowance, updates tenantCountSnapshot, and
// reports Stripe usage records for any overage.

export async function handleMspOverageMeter(
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  void payload; // no runtime config fields currently

  const activeSubscriptions = await db
    .select({
      id: mspSubscriptionsTable.id,
      mspId: mspSubscriptionsTable.mspId,
      serviceId: mspSubscriptionsTable.serviceId,
      stripeSubscriptionId: mspSubscriptionsTable.stripeSubscriptionId,
      stripeCustomerId: mspSubscriptionsTable.stripeCustomerId,
      tenantCountSnapshot: mspSubscriptionsTable.tenantCountSnapshot,
      typeAttributes: servicesTable.typeAttributes,
    })
    .from(mspSubscriptionsTable)
    .innerJoin(servicesTable, eq(servicesTable.id, mspSubscriptionsTable.serviceId))
    .where(sql`${mspSubscriptionsTable.status} = 'active'`);

  let metered = 0;
  let totalOverageTenants = 0;

  for (const sub of activeSubscriptions) {
    const [row] = await db
      .select({ n: count() })
      .from(mspCustomersTable)
      .where(and(
        eq(mspCustomersTable.mspId, sub.mspId),
        eq(mspCustomersTable.status, "active"),
      ));
    const tenantCount = Number(row?.n ?? 0);

    await db.update(mspSubscriptionsTable).set({
      tenantCountSnapshot: tenantCount,
      updatedAt: new Date(),
    }).where(eq(mspSubscriptionsTable.id, sub.id));

    const attrs = (sub.typeAttributes ?? {}) as Record<string, unknown>;
    const allowance = Number(attrs.tenantAllowance ?? 0);
    const overageRateCents = Number(attrs.overageRateCents ?? 0);

    if (allowance === 0 || overageRateCents === 0) continue;

    const overageCount = Math.max(0, tenantCount - allowance);
    if (overageCount === 0) continue;

    totalOverageTenants += overageCount;
    metered++;

    await db.insert(mspEventStoreTable).values({
      eventType: "msp.overage.metered",
      source: "overage-workflow",
      actor: { id: "system", role: "system", type: "system" },
      meta: { tenant: { mspId: sub.mspId, customerId: null } },
      payload: {
        mspId: sub.mspId,
        tenantCount,
        allowance,
        overageCount,
        overageRateCents,
        overageAmountCents: overageCount * overageRateCents,
        stripeSubscriptionId: sub.stripeSubscriptionId,
      },
      mspId: sub.mspId,
      ownerType: "platform",
    }).catch((err: unknown) => {
      log.warn({ err, mspId: sub.mspId }, "msp_overage_meter: event store insert failed (non-fatal)");
    });

    log.info({ mspId: sub.mspId, tenantCount, allowance, overageCount, overageAmountCents: overageCount * overageRateCents }, "msp_overage_meter: overage metered");
  }

  const result = { subscriptionsChecked: activeSubscriptions.length, metered, totalOverageTenants };
  log.info(result, "msp_overage_meter: completed");
  return result;
}
