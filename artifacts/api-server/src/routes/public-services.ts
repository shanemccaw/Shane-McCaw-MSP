import { Router, type IRouter, type Request, type Response } from "express";
import { db, servicesTable } from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/services", async (req: Request, res: Response) => {
  try {
    const { type } = req.query as { type?: string };
    const conditions = [eq(servicesTable.isPublic, true)];
    if (type) {
      conditions.push(eq(servicesTable.serviceType, type));
    }
    const services = await db
      .select()
      .from(servicesTable)
      .where(and(...conditions))
      .orderBy(asc(servicesTable.sortOrder), asc(servicesTable.createdAt));
    res.json(services.map((s) => ({ ...s, hasPdf: s.overviewPdfKey != null })));
  } catch {
    res.status(500).json({ error: "Failed to fetch services" });
  }
});

export default router;
