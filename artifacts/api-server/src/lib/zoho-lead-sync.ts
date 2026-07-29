// lead_staging → Zoho Lead sync (#83).
//
// One place that knows how a staged lead maps onto Zoho's Lead field names, so
// every entry point that creates a staged lead (marketing conversion, quiz
// capture, portal login, the Scoring Engine) queues an identical push instead
// of each inventing its own field mapping.
//
// Nothing here calls Zoho. It enqueues `zoho_upsert_lead` and marks the row
// "queued"; the 5-minute drain performs the write and zoho-crm.ts stamps the
// resulting zohoLeadId back onto the row.

import { db, leadStagingTable, type LeadStaging } from "@workspace/db";
import { eq } from "drizzle-orm";
import { enqueueZohoWrite } from "./zoho-crm.ts";
import { logger } from "./logger";

const log = logger.child({ channel: "integration.zoho" });

/**
 * Maps a staged lead onto Zoho Lead API field names. Only fields Zoho actually
 * owns are sent — the local scoring columns (score, stage, painPoints, …) stay
 * in Postgres, since the engines that produce them are unchanged by this phase
 * and Zoho has no home for them.
 */
export function mapStagingToZohoLead(row: LeadStaging): Record<string, unknown> {
  // Zoho requires Last_Name on Leads. A single-word name has no surname to
  // split off, so the whole name becomes Last_Name rather than being dropped.
  const parts = row.name.trim().split(/\s+/);
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : row.name.trim();
  const firstName = parts.length > 1 ? parts[0] : undefined;

  const fields: Record<string, unknown> = {
    Last_Name: lastName || row.email,
    Email: row.email.trim().toLowerCase(),
  };
  if (firstName) fields.First_Name = firstName;
  if (row.company) fields.Company = row.company;
  if (row.phone) fields.Phone = row.phone;
  if (row.industry) fields.Industry = row.industry;
  if (row.role) fields.Designation = row.role;
  if (row.location) fields.City = row.location;
  if (row.companySize) fields.No_of_Employees = row.companySize;
  if (row.source) fields.Lead_Source = row.source;
  if (row.notes) fields.Description = row.notes;
  // GA4_Client_ID must exist as a custom field on Zoho's Leads module (Setup >
  // Customization > Fields) before this is set — same precondition #122's
  // signal fields carry. The API rejects writes to a field that doesn't exist.
  if (row.ga4ClientId) fields.GA4_Client_ID = row.ga4ClientId;

  return fields;
}

export interface QueueLeadPushOptions {
  mspId?: number;
  customerId?: number;
  correlationId?: string;
}

/**
 * Queues an idempotent upsert of a staged lead into Zoho and flips the row to
 * "queued". Uses upsert (find-by-email then create-or-update) rather than
 * create so a retried job — or a lead captured twice through different funnels
 * — updates the existing Zoho record instead of duplicating it.
 *
 * Non-fatal by design: a CRM bookkeeping failure must never break the purchase,
 * quiz, or login flow that produced the lead. Mirrors crm-pipeline.ts.
 */
export async function queueLeadStagingPush(
  row: LeadStaging | undefined | null,
  opts: QueueLeadPushOptions = {},
): Promise<{ queued: boolean; jobId?: string }> {
  if (!row) return { queued: false };

  try {
    const queued = await enqueueZohoWrite(
      "zoho_upsert_lead",
      { fields: mapStagingToZohoLead(row), leadStagingId: row.id },
      opts,
    );

    await db
      .update(leadStagingTable)
      .set({ zohoSyncState: "queued", zohoSyncError: null, updatedAt: new Date() })
      .where(eq(leadStagingTable.id, row.id));

    return { queued: true, jobId: queued.jobId };
  } catch (err) {
    log.warn({ err, leadStagingId: row.id }, "zoho-lead-sync: failed to queue lead push (non-fatal)");
    await db
      .update(leadStagingTable)
      .set({ zohoSyncState: "error", zohoSyncError: String(err).slice(0, 2000), updatedAt: new Date() })
      .where(eq(leadStagingTable.id, row.id))
      .catch(() => { /* bookkeeping only — never surface */ });
    return { queued: false };
  }
}
