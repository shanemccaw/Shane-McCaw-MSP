import { Router, type IRouter, type Request, type Response } from "express";
import { db, usersTable, mspsTable, impersonationTokensTable } from "@workspace/db";
import { eq, and, inArray, asc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth.ts";
import { createAuditLog } from "../lib/audit.ts";
import { logger } from "../lib/logger.ts";
const log = logger.child({ channel: "admin.impersonation" });

const router: IRouter = Router();

router.post("/admin/impersonate/:userId", requireAdmin, async (req: Request, res: Response) => {
  const userId = parseInt(String(req.params.userId ?? ""), 10);
  if (isNaN(userId)) { res.status(400).json({ error: "Invalid user ID" }); return; }

  const [client] = await db.select().from(usersTable)
    .where(and(eq(usersTable.id, userId), eq(usersTable.role, "client")))
    .limit(1);
  if (!client) { res.status(404).json({ error: "Client not found" }); return; }

  const adminId = req.user!.id;
  const { randomBytes } = await import("crypto");
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

  await db.insert(impersonationTokensTable).values({
    token,
    clientUserId: client.id,
    adminUserId: adminId,
    expiresAt,
  });

  void createAuditLog({
    actorUserId: req.user!.id,
    actorName: req.user!.name ?? req.user!.email,
    actorRole: "admin",
    actionType: "admin_impersonated",
    entityType: "user",
    entityId: client.id,
    entityLabel: client.name ?? client.email,
  });

  res.json({ token, client: { id: client.id, email: client.email, name: client.name } });
});

// PlatformAdmin: impersonate an MSP by finding that MSP's MSPAdmin user and
// issuing a single-use impersonation token, consumed by /auth/impersonate-exchange
// (the exchange endpoint is already generic — it derives full MSP claims from
// the target user, so no changes are needed there).
router.post("/admin/msps/:mspId/impersonate", requireAdmin, async (req: Request, res: Response) => {
  const mspId = parseInt(String(req.params.mspId ?? ""), 10);
  if (isNaN(mspId)) { res.status(400).json({ error: "Invalid MSP ID" }); return; }

  const [msp] = await db.select().from(mspsTable).where(eq(mspsTable.id, mspId)).limit(1);
  if (!msp) {
    log.warn(
      { actorUserId: req.user!.id, targetMspId: mspId },
      "impersonate_msp: MSP not found",
    );
    res.status(404).json({ error: "MSP not found" });
    return;
  }

  const [mspAdmin] = await db.select({ userId: usersTable.id }).from(usersTable)
    .where(and(eq(usersTable.mspId, mspId), eq(usersTable.mspRole, "MSPAdmin")))
    .limit(1);
  if (!mspAdmin) {
    log.warn(
      { actorUserId: req.user!.id, targetMspId: mspId, targetSlug: msp.slug },
      "impersonate_msp: no MSPAdmin user found for MSP",
    );
    res.status(404).json({ error: "No MSPAdmin user found for this MSP" });
    return;
  }

  const impersonateAdminId = req.user!.id;
  const { randomBytes: randomBytesMsp } = await import("crypto");
  const mspToken = randomBytesMsp(32).toString("hex");
  const mspExpiresAt = new Date(Date.now() + 30 * 60 * 1000);

  await db.insert(impersonationTokensTable).values({
    token: mspToken,
    clientUserId: mspAdmin.userId,
    adminUserId: impersonateAdminId,
    expiresAt: mspExpiresAt,
  });

  void createAuditLog({
    actorUserId: req.user!.id,
    actorName: req.user!.name ?? req.user!.email,
    actorRole: "admin",
    actionType: "admin_impersonated_msp",
    entityType: "msp",
    entityId: msp.id,
    entityLabel: msp.name,
  });

  log.info(
    {
      actorUserId: impersonateAdminId,
      targetMspId: msp.id,
      targetSlug: msp.slug,
      targetUserId: mspAdmin.userId,
    },
    "impersonate_msp: impersonation token issued",
  );

  res.json({
    token: mspToken,
    targetSlug: msp.slug,
    msp: { id: msp.id, name: msp.name, slug: msp.slug },
  });
});

// PlatformAdmin: list real accounts usable as "view as" targets for the
// testing switcher, grouped by tier. Read-only — issues no tokens itself.
// Reuses the existing /admin/impersonate/:userId (Assessment/CustomerUser,
// both usersTable.role="client") and /admin/msps/:mspId/impersonate
// (MSPAdmin) endpoints unchanged to actually generate a token.
router.get("/admin/view-as/accounts", requireAdmin, async (req: Request, res: Response) => {
  const rows = await db
    .select({
      userId: usersTable.id,
      email: usersTable.email,
      name: usersTable.name,
      mspRole: usersTable.mspRole,
      mspId: usersTable.mspId,
      mspName: mspsTable.name,
      mspSlug: mspsTable.slug,
    })
    .from(usersTable)
    .leftJoin(mspsTable, eq(usersTable.mspId, mspsTable.id))
    .where(and(
      inArray(usersTable.mspRole, ["Assessment", "CustomerUser", "MSPAdmin"]),
      eq(usersTable.isActive, true),
    ))
    .orderBy(asc(usersTable.mspRole), asc(usersTable.email));

  res.json({
    accounts: rows.map(r => ({
      userId: r.userId,
      email: r.email,
      name: r.name,
      tier: r.mspRole,
      mspId: r.mspId,
      mspName: r.mspName,
      mspSlug: r.mspSlug,
    })),
  });
});

export default router;
