import { Router, type IRouter, type Request, type Response } from "express";
import { db, messagesTable, usersTable, deviceTokensTable } from "@workspace/db";
import { eq, and, asc, count, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { resolveSiblingUserIds } from "../lib/tenant-signals";
import { sendEmailFromTemplate, getTenantHealthBlockHtml, canSendAutomatedCustomerEmailForUser } from "../lib/mailer";
import { sendPushNotifications } from "../lib/push";
import { sendWebPushToAdmins } from "../lib/web-push";
import { createNotification } from "../lib/notification-center";
import { logger } from "../lib/logger";
import { getMspPortalBaseUrl } from "../lib/portal-url";

const router: IRouter = Router();
const log = logger.child({ channel: "tenant.portal" });

async function getAdminUnreadMessageCount(): Promise<number> {
  try {
    const [row] = await db
      .select({ n: count() })
      .from(messagesTable)
      .where(eq(messagesTable.readByAdmin, false));
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

// ─── CLIENT: Messages ────────────────────────────────────────────────────────
router.get("/portal/messages", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const isAdmin = req.user!.role === "admin";

  if (isAdmin) {
    const clientId = parseInt(String(req.query.clientId ?? ""), 10);
    if (isNaN(clientId)) { res.status(400).json({ error: "clientId required for admin" }); return; }
    const [clientUser] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, clientId)).limit(1);
    if (!clientUser) { res.status(404).json({ error: "Client not found" }); return; }
    const messages = await db.select().from(messagesTable)
      .where(eq(messagesTable.clientUserId, clientId))
      .orderBy(asc(messagesTable.createdAt));
    await db.update(messagesTable).set({ readByAdmin: true }).where(and(eq(messagesTable.clientUserId, clientId), eq(messagesTable.readByAdmin, false)));
    res.json(messages);
  } else {
    // #1397: the customer↔MSP thread belongs to the account — show and mark-read
    // across every login of the customer, not just the requesting one.
    const siblingIds = await resolveSiblingUserIds(userId);
    const messages = await db.select().from(messagesTable)
      .where(inArray(messagesTable.clientUserId, siblingIds))
      .orderBy(asc(messagesTable.createdAt));
    await db.update(messagesTable).set({ readByClient: true }).where(and(inArray(messagesTable.clientUserId, siblingIds), eq(messagesTable.readByClient, false)));
    res.json(messages);
  }
});

router.post("/portal/messages", requireAuth, async (req: Request, res: Response) => {
  const senderId = req.user!.id;
  const isAdmin = req.user!.role === "admin";
  const { body, clientId } = req.body as { body?: string; clientId?: number };

  if (!body?.trim()) { res.status(400).json({ error: "body is required" }); return; }

  const clientUserId = isAdmin ? Number(clientId) : senderId;
  if (!clientUserId || isNaN(clientUserId)) { res.status(400).json({ error: "clientId required" }); return; }

  const [msg] = await db.insert(messagesTable).values({
    clientUserId,
    senderUserId: senderId,
    body: body.trim(),
    readByAdmin: isAdmin,
    readByClient: !isAdmin,
  }).returning();

  // When admin replies, mark all unread client messages in this conversation as read
  if (isAdmin) {
    await db.update(messagesTable)
      .set({ readByAdmin: true })
      .where(and(eq(messagesTable.clientUserId, clientUserId), eq(messagesTable.readByAdmin, false)));
  }

  // Create in-app notification + email for the other party
  if (isAdmin) {
    await createNotification({
      title: "New message from Shane",
      body: body.trim().slice(0, 100),
      notifType: "message",
      category: "message",
      linkPath: "/portal/messages",
      recipient: { type: "customer_user", userId: clientUserId },
      // This route already sends its own branded "client-message-notification"
      // template email below — don't let createNotification's own
      // preference-gated email double it up once the client opts in (#2933).
      suppressPreferenceEmail: true,
    });
    // Email the client
    const [clientUser] = await db.select({ email: usersTable.email, name: usersTable.name })
      .from(usersTable).where(eq(usersTable.id, clientUserId)).limit(1);
    if (clientUser && await canSendAutomatedCustomerEmailForUser(clientUserId)) {
      void sendEmailFromTemplate(
        "client-message-notification",
        clientUser.email,
        {
          clientName: clientUser.name ?? "",
          messageBody: body.trim(),
          portalLink: `${getMspPortalBaseUrl()}/messages`,
          tenantHealthBlockHtml: await getTenantHealthBlockHtml(clientUserId),
        },
        "New message from Shane McCaw Consulting",
        `
        <p>Hello ${clientUser.name ?? ""},</p>
        <p>You have a new message from Shane McCaw Consulting:</p>
        <blockquote style="border-left:3px solid #0078D4;padding:8px 12px;color:#333;margin:12px 0;">${body.trim()}</blockquote>
        <p><a href="${getMspPortalBaseUrl()}/messages" style="color:#0078D4;font-weight:bold;">View in your portal →</a></p>
        `,
      );
    }
  } else {
    const [adminUser] = await db.select({ id: usersTable.id, email: usersTable.email }).from(usersTable).where(eq(usersTable.role, "admin")).limit(1);
    if (adminUser) {
      await createNotification({
        title: "New client message",
        body: body.trim().slice(0, 100),
        notifType: "message",
        category: "message",
        linkPath: `/dashboard/messages?clientId=${senderId}`,
        recipient: { type: "customer_user", userId: adminUser.id },
        // This route already sends its own branded "admin-message-notification"
        // template email below — don't let createNotification's own
        // preference-gated email double it up once the admin opts in (#2933).
        suppressPreferenceEmail: true,
      });
      void sendWebPushToAdmins({
        title: "New client message",
        body: body.trim().slice(0, 100),
        linkPath: `/dashboard/messages?clientId=${senderId}`,
      });
      // Email the admin
      const [clientUser] = await db.select({ name: usersTable.name, email: usersTable.email })
        .from(usersTable).where(eq(usersTable.id, senderId)).limit(1);
      const senderLabel = clientUser?.name ?? clientUser?.email ?? "a client";
      void sendEmailFromTemplate(
        "admin-message-notification",
        adminUser.email,
        {
          clientName: clientUser?.name ?? clientUser?.email ?? "A client",
          messageBody: body.trim(),
        },
        `New client message from ${senderLabel}`,
        `
        <p>Hello Shane,</p>
        <p>${clientUser?.name ?? "A client"} sent a new message:</p>
        <blockquote style="border-left:3px solid #0078D4;padding:8px 12px;color:#333;margin:12px 0;">${body.trim()}</blockquote>
        `,
      );
      // Push notification to Shane's devices
      const clientName = clientUser?.name ?? clientUser?.email ?? "A client";
      db.select({ token: deviceTokensTable.token }).from(deviceTokensTable)
        .then(async (rows) => {
          const tokens = rows.map((r) => r.token);
          // The new message is already in the DB (readByAdmin = false), so the count
          // naturally includes it — this gives an accurate cumulative unread badge.
          const badge = await getAdminUnreadMessageCount();
          return sendPushNotifications(
            tokens,
            "New Client Message",
            `${clientName}: ${body.trim().slice(0, 80)}`,
            { screen: "conversation", clientId: String(senderId) },
            "MESSAGE",
            badge,
          );
        })
        .catch(() => null);
    }
  }

  res.status(201).json(msg);
});

export default router;
