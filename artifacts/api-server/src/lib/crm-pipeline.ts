/**
 * crm-pipeline.ts
 *
 * Helpers that automatically wire client activity into the CRM pipeline:
 *   - ensureLeadForClient  — find-or-create a Lead when a user is provisioned
 *   - ensureOpportunityForSow — promote to Opportunity when a SOW is delivered
 *
 * Both functions are non-fatal: they catch all errors and log a warning so that
 * a CRM bookkeeping failure never breaks a purchase or document-delivery flow.
 */

import {
  db,
  leadsTable,
  opportunitiesTable,
  usersTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
const log = logger.child({ channel: "crm" });

/**
 * Find-or-create a Lead for a client user, then set users.linkedLeadId.
 * Called when a new user is provisioned via a landing-page purchase.
 * Returns the lead ID, or 0 on failure.
 */
export async function ensureLeadForClient(
  userId: number,
  email: string,
  name?: string,
  company?: string,
): Promise<number> {
  try {
    const normalizedEmail = email.toLowerCase().trim();

    const [user] = await db
      .select({ linkedLeadId: usersTable.linkedLeadId })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (user?.linkedLeadId) return user.linkedLeadId;

    const [existingLead] = await db
      .select({ id: leadsTable.id })
      .from(leadsTable)
      .where(eq(leadsTable.email, normalizedEmail))
      .limit(1);

    let leadId: number;
    if (existingLead) {
      leadId = existingLead.id;
    } else {
      const [newLead] = await db
        .insert(leadsTable)
        .values({
          name: name?.trim() || normalizedEmail,
          email: normalizedEmail,
          company: company?.trim() || undefined,
          source: "purchase",
          status: "converted",
          stage: "Cold",
        })
        .returning({ id: leadsTable.id });
      leadId = newLead!.id;
    }

    await db
      .update(usersTable)
      .set({ linkedLeadId: leadId })
      .where(eq(usersTable.id, userId));

    log.info({ userId, leadId }, "crm-pipeline: linked client user to lead");
    return leadId;
  } catch (err) {
    log.warn({ err, userId }, "crm-pipeline: ensureLeadForClient failed (non-fatal)");
    return 0;
  }
}

/**
 * When a SOW (or consolidated SOW) is delivered to a client:
 *   1. Ensure a Lead record exists for that user
 *   2. Move the lead to "qualified" status if it was earlier in the funnel
 *   3. Find or create an Opportunity linked to that lead
 *
 * Called from document-generator.ts (auto-fire path) and admin-insights.ts (send endpoint).
 */
export async function ensureOpportunityForSow(
  customerId: number,
  docId: number,
): Promise<void> {
  try {
    const [user] = await db
      .select({
        email: usersTable.email,
        name: usersTable.name,
        company: usersTable.company,
        linkedLeadId: usersTable.linkedLeadId,
      })
      .from(usersTable)
      .where(eq(usersTable.id, customerId))
      .limit(1);

    if (!user) return;

    const leadId = await ensureLeadForClient(
      customerId,
      user.email,
      user.name ?? undefined,
      user.company ?? undefined,
    );
    if (!leadId) return;

    const [currentLead] = await db
      .select({ status: leadsTable.status })
      .from(leadsTable)
      .where(eq(leadsTable.id, leadId))
      .limit(1);

    if (currentLead?.status === "new" || currentLead?.status === "contacted") {
      await db
        .update(leadsTable)
        .set({ status: "qualified", updatedAt: new Date() })
        .where(eq(leadsTable.id, leadId));
    }

    const [existingOpp] = await db
      .select({ id: opportunitiesTable.id })
      .from(opportunitiesTable)
      .where(eq(opportunitiesTable.leadId, leadId))
      .limit(1);

    if (!existingOpp) {
      await db.insert(opportunitiesTable).values({
        leadId,
        scoreSnapshot: 50,
        scoreFit: 15,
        scorePain: 15,
        scoreMaturity: 10,
        scoreIntent: 7,
        scoreUrgency: 3,
        evidence: ["SOW delivered — active proposal"],
        recommendedNextStep: "Follow up on delivered SOW",
        workflowType: "ProposalPrep",
        state: "new",
      });
      log.info({ customerId, leadId, docId }, "crm-pipeline: created opportunity from SOW delivery");
    } else {
      log.info({ customerId, leadId, docId, oppId: existingOpp.id }, "crm-pipeline: opportunity already exists");
    }
  } catch (err) {
    log.warn({ err, customerId, docId }, "crm-pipeline: ensureOpportunityForSow failed (non-fatal)");
  }
}
