/**
 * crm-pipeline.ts
 *
 * Helpers that automatically wire client activity into the CRM pipeline:
 *   - ensureLeadForClient  — find-or-create a Lead when a user is provisioned
 *   - ensureOpportunityForSow — promote to Opportunity when a SOW is delivered
 *
 * Both functions are non-fatal: they catch all errors and log a warning so that
 * a CRM bookkeeping failure never breaks a purchase or document-delivery flow.
 *
 * ── Decommission Legacy CRM Phase B (#136) ──────────────────────────────────
 * Nothing in this file reads or writes the legacy `leads` table any more.
 * `lead_staging` is the content source of truth; every find-or-create goes
 * through [[ensureLeadStagingForEmail]] (lead-intent.ts), which is the single
 * place a captured identity becomes a Zoho-bound lead.
 *
 * The *id* these functions return is still the legacy `leads.id` space, carried
 * on `lead_staging.legacy_lead_id`. That is deliberate, not leftover: ten
 * satellite FK columns (`users.linked_lead_id`, `opportunities.lead_id`,
 * `lead_intent_events.lead_id`, `engagement_offer_firings.lead_id`, …) still
 * store `leads.id`, and comparing the two id spaces returns wrong rows rather
 * than an error. Re-keying those columns is the follow-up issue's job.
 *
 * Consequence, stated plainly: a lead staged AFTER this cutover has no legacy
 * id, so these functions return 0 for it and `users.linked_lead_id` is left
 * unset. Its content is fully present in `lead_staging` — it is only the
 * id-keyed legacy surfaces that cannot see it until the FK re-key lands.
 */

import {
  db,
  leadStagingTable,
  opportunitiesTable,
  usersTable,
} from "@workspace/db";
import { eq, and, or, notInArray } from "drizzle-orm";
import { logger } from "./logger";
import { ensureLeadStagingForEmail } from "./lead-intent.ts";
import { queueLeadStagingPush } from "./zoho-lead-sync.ts";
import { ZOHO_DEFAULT_MSP_ID } from "./zoho-client.ts";
const log = logger.child({ channel: "crm" });

/**
 * Find-or-create a staged lead for a client user, then set users.linkedLeadId
 * when the staged row carries a legacy id. Called when a new user is
 * provisioned via a landing-page purchase.
 *
 * Returns the legacy lead ID, or 0 when there is none (staged-only lead, or
 * failure).
 */
export async function ensureLeadForClient(
  userId: number,
  email: string,
  name?: string,
  company?: string,
  ga4ClientId?: string,
): Promise<number> {
  try {
    const normalizedEmail = email.toLowerCase().trim();

    const [user] = await db
      .select({ linkedLeadId: usersTable.linkedLeadId })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    // Find-or-create is idempotent, so this is a no-op when the email was
    // already staged by an earlier funnel touch. An existing users.linkedLeadId
    // is passed through so a pre-cutover legacy id survives onto the staged row.
    const staged = await ensureLeadStagingForEmail(normalizedEmail, {
      name,
      company,
      source: "purchase",
      legacyLeadId: user?.linkedLeadId ?? undefined,
      ga4ClientId,
    });

    if (user?.linkedLeadId) return user.linkedLeadId;

    const leadId = staged?.legacyLeadId ?? 0;
    if (leadId) {
      await db
        .update(usersTable)
        .set({ linkedLeadId: leadId })
        .where(eq(usersTable.id, userId));
      log.info({ userId, leadId }, "crm-pipeline: linked client user to lead");
    } else {
      // Honest no-op rather than writing a lead_staging.id into a column that
      // holds leads.id — see the id-space note at the top of this file.
      log.info(
        { userId, leadStagingId: staged?.id },
        "crm-pipeline: staged client user has no legacy lead id — users.linked_lead_id left unset",
      );
    }
    return leadId;
  } catch (err) {
    log.warn({ err, userId }, "crm-pipeline: ensureLeadForClient failed (non-fatal)");
    return 0;
  }
}

/**
 * Find-or-create a staged lead the moment a visitor enters name + email at the
 * top of the assessment funnel (the marketing-site checkout guest-info step),
 * BEFORE they proceed to M365 consent. Captured even if they bounce — a bounced
 * lead is still real, trackable, remarketable data (it can later be redirected
 * toward the quiz funnel, etc.). See [[login-signal-and-consent-bridge]].
 *
 * Idempotent by email: an already-staged email is left untouched (never
 * downgrade an already-`converted`/`qualified` lead back to `new`). Non-fatal —
 * a CRM bookkeeping failure must never block session creation.
 *
 * This is the funnel's earliest capture point, so it is where a GA4 client_id
 * is recorded first-touch (#116).
 *
 * Returns the legacy lead ID, or 0 when there is none.
 */
export async function ensureAssessmentFunnelLead(
  email: string,
  name?: string,
  company?: string,
  ga4ClientId?: string,
): Promise<number> {
  try {
    const normalizedEmail = email.toLowerCase().trim();
    if (!normalizedEmail) return 0;

    const staged = await ensureLeadStagingForEmail(normalizedEmail, {
      name,
      company,
      source: "assessment",
      ga4ClientId,
    });
    if (!staged) return 0;

    log.info(
      { leadStagingId: staged.id, legacyLeadId: staged.legacyLeadId, email: normalizedEmail },
      "crm-pipeline: captured assessment-funnel lead",
    );
    return staged.legacyLeadId ?? 0;
  } catch (err) {
    log.warn({ err, email }, "crm-pipeline: ensureAssessmentFunnelLead failed (non-fatal)");
    return 0;
  }
}

/**
 * Find-or-create the staged lead for a client user (via [[ensureLeadForClient]])
 * AND flip its status to `converted`. Called at the point a real Prospect
 * account is created at consent time — the funnel-entry lead captured by
 * ensureAssessmentFunnelLead transitions new → converted here. `converted` is a
 * plain status write (the Lead Scoring Engine is decoupled from it), so no
 * scoring pass is required. Guarded so an already-`archived` lead is never
 * resurrected.
 *
 * The status flip is keyed on the staged row's email, not on a lead id, so it
 * still works for a staged-only lead that has no legacy id.
 *
 * Returns the legacy lead ID, or 0 when there is none. Non-fatal.
 */
export async function convertLeadForClient(
  userId: number,
  email: string,
  name?: string,
  company?: string,
  ga4ClientId?: string,
): Promise<number> {
  const leadId = await ensureLeadForClient(userId, email, name, company, ga4ClientId);
  try {
    const normalizedEmail = email.toLowerCase().trim();
    if (normalizedEmail) {
      await db
        .update(leadStagingTable)
        .set({ status: "converted", updatedAt: new Date() })
        .where(and(
          eq(leadStagingTable.email, normalizedEmail),
          notInArray(leadStagingTable.status, ["converted", "archived"]),
        ));
    }
  } catch (err) {
    log.warn({ err, userId, leadId }, "crm-pipeline: convertLeadForClient status flip failed (non-fatal)");
  }
  return leadId;
}

/**
 * Records a completed Home-page assessment purchase (#456's payment-complete
 * CRM trigger) onto the buyer's staged lead and re-syncs it to Zoho.
 *
 * There is no "paid" rung on the lead_staging funnel: `converted` already
 * fires at consent time (see [[convertLeadForClient]], `provisionProspectAccount`),
 * before payment, because that is when a real account exists — and mapStagingToZohoLead
 * (zoho-lead-sync.ts) deliberately does not sync `stage`/`score` to Zoho at all
 * ("Zoho has no home for them"). So a stage bump would be a silent no-op on the
 * Zoho side, not a real signal. `notes` IS a mapped field (-> Description), so
 * that is where this actually reaches the CRM — appended, never overwritten,
 * matching the existing append convention (admin-marketing.ts's lead-notes PATCH).
 */
export async function markAssessmentLeadPurchased(
  email: string,
  serviceName: string,
): Promise<void> {
  try {
    const normalizedEmail = email.toLowerCase().trim();
    if (!normalizedEmail) return;

    const [existing] = await db
      .select({ id: leadStagingTable.id, notes: leadStagingTable.notes })
      .from(leadStagingTable)
      .where(eq(leadStagingTable.email, normalizedEmail))
      .limit(1);
    if (!existing) return;

    const entry = `Purchased ${serviceName} on ${new Date().toISOString().slice(0, 10)}.`;
    const updatedNotes = existing.notes ? `${existing.notes}\n${entry}` : entry;

    const [staged] = await db
      .update(leadStagingTable)
      .set({ notes: updatedNotes, updatedAt: new Date() })
      .where(eq(leadStagingTable.id, existing.id))
      .returning();

    if (staged) {
      await queueLeadStagingPush(staged, { mspId: ZOHO_DEFAULT_MSP_ID });
      log.info({ leadStagingId: staged.id, email: normalizedEmail }, "crm-pipeline: assessment purchase noted and re-synced to Zoho");
    }
  } catch (err) {
    log.warn({ err, email }, "crm-pipeline: markAssessmentLeadPurchased failed (non-fatal)");
  }
}

/**
 * When a SOW (or consolidated SOW) is delivered to a client:
 *   1. Ensure a staged lead exists for that user
 *   2. Move the staged lead to "qualified" status if it was earlier in the funnel
 *   3. Find or create an Opportunity linked to that staged lead
 *
 * Called from document-generator.ts (auto-fire path) and admin-insights.ts (send endpoint).
 *
 * The opportunity row is scoring EVIDENCE, not the deal itself (Zoho owns the
 * deal — see opportunitiesTable's #83 note). It is written against
 * `opportunities.lead_staging_id`, with the legacy `lead_id` still populated
 * when the staged row has one so the not-yet-re-pointed readers
 * (opportunities.ts, inbox.ts, admin-marketing.ts, ai-next-best-actions.ts)
 * keep seeing it. The de-dupe check covers both pointers, so a pre-cutover
 * opportunity that only has `lead_id` is still found and not duplicated.
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

    const legacyLeadId = await ensureLeadForClient(
      customerId,
      user.email,
      user.name ?? undefined,
      user.company ?? undefined,
    );

    const normalizedEmail = user.email.toLowerCase().trim();
    const [staged] = await db
      .select({ id: leadStagingTable.id, status: leadStagingTable.status })
      .from(leadStagingTable)
      .where(eq(leadStagingTable.email, normalizedEmail))
      .limit(1);

    if (!staged) return;

    if (staged.status === "new" || staged.status === "contacted") {
      await db
        .update(leadStagingTable)
        .set({ status: "qualified", updatedAt: new Date() })
        .where(eq(leadStagingTable.id, staged.id));
    }

    const [existingOpp] = await db
      .select({ id: opportunitiesTable.id })
      .from(opportunitiesTable)
      .where(legacyLeadId
        ? or(
            eq(opportunitiesTable.leadStagingId, staged.id),
            eq(opportunitiesTable.leadId, legacyLeadId),
          )
        : eq(opportunitiesTable.leadStagingId, staged.id))
      .limit(1);

    if (!existingOpp) {
      await db.insert(opportunitiesTable).values({
        leadId: legacyLeadId || null,
        leadStagingId: staged.id,
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
      log.info(
        { customerId, leadStagingId: staged.id, legacyLeadId, docId },
        "crm-pipeline: created opportunity from SOW delivery",
      );
    } else {
      log.info(
        { customerId, leadStagingId: staged.id, legacyLeadId, docId, oppId: existingOpp.id },
        "crm-pipeline: opportunity already exists",
      );
    }
  } catch (err) {
    log.warn({ err, customerId, docId }, "crm-pipeline: ensureOpportunityForSow failed (non-fatal)");
  }
}
