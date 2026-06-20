import { Router, type IRouter, type Request, type Response } from "express";
import { db, emailsTable, deviceTokensTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getMailMessage } from "../lib/graph";
import { matchDomainToUser, extractDomain } from "../lib/email-domain-match";
import { logger } from "../lib/logger";
import { sendPushNotifications } from "../lib/push";

const router: IRouter = Router();

const GRAPH_MAIL_USER_ID = process.env.GRAPH_MAIL_USER_ID ?? "me";

router.get("/graph/webhook", (req: Request, res: Response) => {
  const validationToken = req.query["validationToken"] as string | undefined;
  if (validationToken) {
    res.setHeader("Content-Type", "text/plain");
    res.status(200).send(validationToken);
    return;
  }
  res.status(400).json({ error: "validationToken query parameter required" });
});

interface GraphNotification {
  subscriptionId: string;
  changeType: string;
  resource: string;
  clientState?: string;
  resourceData?: {
    id?: string;
    "@odata.id"?: string;
  };
}

interface GraphNotificationBody {
  value: GraphNotification[];
}

const EXPECTED_CLIENT_STATE = process.env.GRAPH_WEBHOOK_CLIENT_STATE ?? "graph-webhook-secret";

router.post("/graph/webhook", async (req: Request, res: Response) => {
  const validationToken = req.query["validationToken"] as string | undefined;
  if (validationToken) {
    res.setHeader("Content-Type", "text/plain");
    res.status(200).send(validationToken);
    return;
  }

  res.status(202).send();

  const body = req.body as GraphNotificationBody;
  if (!body?.value || !Array.isArray(body.value)) return;

  for (const notification of body.value) {
    if (notification.changeType !== "created") continue;

    if (notification.clientState && notification.clientState !== EXPECTED_CLIENT_STATE) {
      logger.warn({ subscriptionId: notification.subscriptionId }, "Graph webhook: clientState mismatch — ignoring notification");
      continue;
    }

    const messageId =
      notification.resourceData?.id ??
      notification.resourceData?.["@odata.id"]?.split("messages/")[1];

    if (!messageId) {
      logger.warn({ notification }, "Graph webhook: could not extract message ID");
      continue;
    }

    setImmediate(() => void ingestMessage(messageId));
  }
});

async function ingestMessage(messageId: string): Promise<void> {
  try {
    const existing = await db
      .select({ id: emailsTable.id })
      .from(emailsTable)
      .where(eq(emailsTable.messageId, messageId))
      .limit(1);

    if (existing.length > 0) return;

    const message = await getMailMessage(GRAPH_MAIL_USER_ID, messageId);
    if (!message) {
      logger.warn({ messageId }, "Graph ingestMessage: could not fetch message");
      return;
    }

    const senderAddress = message.from?.emailAddress?.address ?? "";
    const rawFrom = message.from?.emailAddress?.name
      ? `${message.from.emailAddress.name} <${senderAddress}>`
      : senderAddress;
    const senderDomain = extractDomain(senderAddress);
    const linkedUserId = senderDomain ? await matchDomainToUser(senderDomain) : null;

    await db.insert(emailsTable).values({
      messageId,
      subject: message.subject ?? "(no subject)",
      senderAddress,
      senderDomain,
      bodyPreview: message.bodyPreview?.slice(0, 500) ?? null,
      receivedAt: new Date(message.receivedDateTime),
      rawFrom,
      linkedUserId,
    }).onConflictDoNothing();

    logger.info({ messageId, senderAddress, linkedUserId }, "Email ingested from Graph");

    // Send push notification to all registered admin devices
    const tokenRows = await db.select({ token: deviceTokensTable.token }).from(deviceTokensTable);
    const tokens = tokenRows.map(r => r.token);
    if (tokens.length > 0) {
      const senderLabel = message.from?.emailAddress?.name || senderAddress;
      const subject = message.subject ?? "(no subject)";
      void sendPushNotifications(
        tokens,
        "New email received",
        `${senderLabel}: ${subject}`,
        { screen: "EmailActivity", messageId },
        undefined,
        1,
      );
    }
  } catch (err) {
    logger.error({ err, messageId }, "Graph ingestMessage error");
  }
}

export default router;
