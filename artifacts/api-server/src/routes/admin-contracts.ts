import { Router, type IRouter, type Request, type Response } from "express";
import { db, contractsTable, servicesTable, usersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth.ts";
import { logger } from "../lib/logger.ts";
const log = logger.child({ channel: "admin.contracts" });

const router: IRouter = Router();

router.get("/admin/contracts", requireAdmin, async (_req: Request, res: Response) => {
  const contracts = await db
    .select({
      id: contractsTable.id,
      serviceId: contractsTable.serviceId,
      userId: contractsTable.userId,
      signerName: contractsTable.signerName,
      signedAt: contractsTable.signedAt,
      contractVersion: contractsTable.contractVersion,
      projectId: contractsTable.projectId,
      stripeSessionId: contractsTable.stripeSessionId,
      serviceName: servicesTable.name,
      serviceSlug: servicesTable.slug,
      clientEmail: usersTable.email,
      clientCompany: usersTable.company,
    })
    .from(contractsTable)
    .leftJoin(servicesTable, eq(contractsTable.serviceId, servicesTable.id))
    .leftJoin(usersTable, eq(contractsTable.userId, usersTable.id))
    .orderBy(desc(contractsTable.signedAt));
  res.json(contracts);
});

// ─── ADMIN: Delete a contract ─────────────────────────────────────────────────
router.delete("/admin/contracts/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid contract ID" }); return; }

  const [existing] = await db.select({ id: contractsTable.id }).from(contractsTable).where(eq(contractsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Contract not found" }); return; }

  await db.delete(contractsTable).where(eq(contractsTable.id, id));
  res.status(204).end();
});

export default router;
