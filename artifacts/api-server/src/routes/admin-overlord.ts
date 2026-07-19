import { Router, type IRouter, type Request, type Response } from "express";
import { db, mspsTable, mspSubscriptionsTable, servicesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { aggregatePlatformMonitoringMrr, calculateColonyCompositeScore } from "../lib/msp-financial-aggregator.ts";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "billing" });

const router: IRouter = Router();

// ── GET /api/admin/overlord ─────────────────────────────────────────────────
// PlatformAdmin-only. Raw JSON snapshot of the platform-wide monitoring MRR
// ("overlord total") plus a per-MSP ("colony") composite score breakdown.

router.get("/admin/overlord", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const overlordTotal = await aggregatePlatformMonitoringMrr();

    const msps = await db
      .select({ id: mspsTable.id, name: mspsTable.name })
      .from(mspsTable);

    const colonies = await Promise.all(
      msps.map(async (msp) => {
        const [compositeScore, subscription] = await Promise.all([
          calculateColonyCompositeScore(msp.id),
          db
            .select({ typeAttributes: servicesTable.typeAttributes })
            .from(mspSubscriptionsTable)
            .innerJoin(servicesTable, eq(mspSubscriptionsTable.serviceId, servicesTable.id))
            .where(eq(mspSubscriptionsTable.mspId, msp.id))
            .limit(1),
        ]);

        const tenantTierLabel = subscription[0]?.typeAttributes?.["tenantTierLabel"];
        const seatTier = typeof tenantTierLabel === "string" ? tenantTierLabel : null;

        return {
          mspId: msp.id,
          name: msp.name,
          compositeScore: compositeScore.score,
          seatTier,
        };
      })
    );

    log.debug({ mspCount: msps.length }, "overlord snapshot assembled");

    res.json({ overlordTotal, colonies });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

export default router;
