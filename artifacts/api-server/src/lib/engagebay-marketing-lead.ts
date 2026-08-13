import { getEngageBayConnection, createContact, ENGAGEBAY_DEFAULT_MSP_ID } from "./engagebay-client.ts";
import { logger } from "./logger";

const log = logger.child({ channel: "crm" });

/**
 * Pushes a marketing-site lead (quiz capture / assessment funnel entry) to
 * EngageBay as a contact (#456).
 *
 * OFF BY DEFAULT — gated on ENGAGEBAY_MARKETING_LEAD_PUSH_ENABLED === "true",
 * on top of the existing connection-status gate, for two independent reasons
 * left for Shane to confirm before flipping this on:
 *
 *   1. This integration was reported paused pending a Microsoft-side Exchange
 *      Online send-limit restriction. No trace of that block (or any
 *      "Restricted Entities"/"send limit"/"Defender" reference) survives
 *      anywhere in code, comments, or commit history for EngageBay — grepped
 *      the whole repo to confirm. It may already be clear. But this
 *      environment has no DB access, so the live `engagebay_connection.status`
 *      row cannot be checked from here either way — only the code-level
 *      absence of a block can be confirmed, not the account's real state.
 *   2. engagebay-client.ts's own #106 audit comment flags createContact's/
 *      updateContact's request body shape as NEVER live-verified against a
 *      real EngageBay account: EngageBay's documented examples nest
 *      `properties` as an array of `{name,value,field_type,type}` entries,
 *      not the flat `{email,name,properties}` object shipped here. A first
 *      real call through this path is also the first real test of that shape.
 *
 * Wired to the same funnel-entry points as the Zoho push (crm-pipeline.ts,
 * lead-intent.ts) so flipping the flag on is the only step left once both
 * items above are confirmed clear.
 */
export async function pushMarketingLeadToEngageBay(opts: {
  email: string;
  name?: string;
  company?: string;
  source: string;
}): Promise<void> {
  if (process.env.ENGAGEBAY_MARKETING_LEAD_PUSH_ENABLED !== "true") return;

  try {
    const connection = await getEngageBayConnection(ENGAGEBAY_DEFAULT_MSP_ID);
    if (!connection || connection.status !== "connected") {
      log.info({ email: opts.email }, "engagebay: marketing lead push skipped — not connected");
      return;
    }

    await createContact(
      {
        email: opts.email,
        name: opts.name,
        properties: opts.company ? { company: opts.company, lead_source: opts.source } : { lead_source: opts.source },
      },
      ENGAGEBAY_DEFAULT_MSP_ID,
    );
    log.info({ email: opts.email, source: opts.source }, "engagebay: marketing lead pushed");
  } catch (err) {
    log.warn({ err, email: opts.email }, "engagebay: marketing lead push failed (non-fatal)");
  }
}
