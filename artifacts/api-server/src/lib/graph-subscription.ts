import { db, graphSubscriptionsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { logger } from "./logger";
import {
  graphCredentialsPresent,
  createSubscription,
  renewSubscription,
  listSubscriptions,
} from "./graph";

const RENEWAL_LEAD_MS = 30 * 60 * 1000;
const RETRY_DELAY_MS = 5 * 60 * 1000;

let renewalTimer: NodeJS.Timeout | null = null;

function scheduleRenewal(subscriptionId: string, expirationDateTime: string): void {
  if (renewalTimer) clearTimeout(renewalTimer);

  const expiresAt = new Date(expirationDateTime).getTime();
  const renewAt = expiresAt - RENEWAL_LEAD_MS;
  const delay = Math.max(renewAt - Date.now(), 60_000);

  logger.info({ subscriptionId, renewInMs: delay }, "Graph subscription renewal scheduled");

  renewalTimer = setTimeout(() => {
    void (async () => {
      try {
        const renewed = await renewSubscription(subscriptionId);
        if (!renewed) throw new Error("renewSubscription returned null");

        await db
          .update(graphSubscriptionsTable)
          .set({
            expirationDateTime: new Date(renewed.expirationDateTime),
            updatedAt: new Date(),
          })
          .where(eq(graphSubscriptionsTable.subscriptionId, subscriptionId));

        logger.info({ subscriptionId }, "Graph subscription renewed");
        scheduleRenewal(renewed.id, renewed.expirationDateTime);
      } catch (err) {
        logger.error({ err, subscriptionId }, "Graph subscription renewal failed — retrying in 5 min");
        renewalTimer = setTimeout(() => { void scheduleRenewal(subscriptionId, expirationDateTime); }, RETRY_DELAY_MS);
      }
    })();
  }, delay);
}

export async function initGraphSubscription(): Promise<void> {
  if (!graphCredentialsPresent()) {
    logger.warn("Graph credentials missing (GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET) — email ingestion disabled");
    return;
  }

  const webhookUrl = buildWebhookUrl();
  if (!webhookUrl) {
    logger.warn("Cannot determine webhook URL — set REPLIT_DOMAINS or GRAPH_WEBHOOK_URL to enable Graph subscriptions");
    return;
  }

  try {
    const [existing] = await db
      .select()
      .from(graphSubscriptionsTable)
      .orderBy(desc(graphSubscriptionsTable.updatedAt))
      .limit(1);

    if (existing) {
      const expiresAt = new Date(existing.expirationDateTime).getTime();
      if (expiresAt > Date.now() + RENEWAL_LEAD_MS) {
        logger.info({ subscriptionId: existing.subscriptionId }, "Existing Graph subscription is still valid");
        scheduleRenewal(existing.subscriptionId, existing.expirationDateTime.toISOString());
        return;
      }

      const renewed = await renewSubscription(existing.subscriptionId);
      if (renewed) {
        await db
          .update(graphSubscriptionsTable)
          .set({
            expirationDateTime: new Date(renewed.expirationDateTime),
            updatedAt: new Date(),
          })
          .where(eq(graphSubscriptionsTable.subscriptionId, existing.subscriptionId));
        logger.info({ subscriptionId: renewed.id }, "Graph subscription renewed on startup");
        scheduleRenewal(renewed.id, renewed.expirationDateTime);
        return;
      }

      await db
        .delete(graphSubscriptionsTable)
        .where(eq(graphSubscriptionsTable.subscriptionId, existing.subscriptionId));
    }

    const mailUserId = process.env.GRAPH_MAIL_USER_ID ?? "me";
    const sub = await createSubscription(webhookUrl, mailUserId);
    if (!sub) {
      logger.warn("Could not create Graph subscription — email ingestion will not work until credentials/URL are valid");
      return;
    }

    await db.insert(graphSubscriptionsTable).values({
      subscriptionId: sub.id,
      resource: sub.resource,
      expirationDateTime: new Date(sub.expirationDateTime),
    });

    logger.info({ subscriptionId: sub.id, webhookUrl }, "Graph subscription created");
    scheduleRenewal(sub.id, sub.expirationDateTime);
  } catch (err) {
    logger.error({ err }, "initGraphSubscription failed");
  }
}

function buildWebhookUrl(): string | null {
  const explicit = process.env.GRAPH_WEBHOOK_URL;
  if (explicit) return explicit;

  const domains = process.env.REPLIT_DOMAINS;
  if (domains) {
    const primary = domains.split(",")[0]?.trim();
    if (primary) return `https://${primary}/api/graph/webhook`;
  }

  return null;
}
