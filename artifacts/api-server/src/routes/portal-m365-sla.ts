/**
 * portal-m365-sla.ts
 *
 * Customer-facing M365 Third-Party SLA summary — a compact "Your M365
 * uptime" view against Microsoft's own 99.9% Monthly Uptime Percentage SLA
 * commitment, computed by sla-uptime.ts. Simplified relative to the
 * MSP-facing view (msp-m365-sla.ts): no per-service breakdown table, just
 * the worst-performing service per window and an overall breach flag, since
 * customers care whether their tenant is meeting the SLA, not the full
 * accountability detail an MSP operator needs.
 *
 * Routes (CustomerUser, customerId from JWT claim):
 *   GET /api/portal/m365-sla/summary
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, mspCustomersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireRole } from "../middlewares/requireAuth";
import { computeM365UptimeForTenant, SLA_TARGET_UPTIME_PERCENT, type SlaWindowDays } from "../lib/sla-uptime";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "integration.azure" });

const router: IRouter = Router();

function resolveCustomerId(req: Request): number | null {
  const id = (req.user as { customerId?: number } | undefined)?.customerId;
  return typeof id === "number" && !isNaN(id) ? id : null;
}

export interface M365SlaSummary {
  available: boolean;
  target: number;
  window: Partial<Record<SlaWindowDays, { uptimePercent: number | null; breached: boolean; worstService: string | null }>>;
}

router.get("/portal/m365-sla/summary", requireRole("CustomerUser"), async (req: Request, res: Response) => {
  try {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    const [customer] = await db
      .select({ tenantId: mspCustomersTable.tenantId })
      .from(mspCustomersTable)
      .where(eq(mspCustomersTable.id, customerId))
      .limit(1);

    if (!customer?.tenantId) {
      res.json({ available: false, target: SLA_TARGET_UPTIME_PERCENT, window: {} } satisfies M365SlaSummary);
      return;
    }

    const services = await computeM365UptimeForTenant(customer.tenantId);
    if (services.length === 0) {
      res.json({ available: false, target: SLA_TARGET_UPTIME_PERCENT, window: {} } satisfies M365SlaSummary);
      return;
    }

    const summary: M365SlaSummary = {
      available: true,
      target: SLA_TARGET_UPTIME_PERCENT,
      window: {
        30: worstOf(services, 30),
        90: worstOf(services, 90),
      },
    };

    res.json(summary);
  } catch (err) {
    log.error({ err }, "portal-m365-sla: GET /portal/m365-sla/summary failed");
    res.status(500).json({ error: "Failed to fetch M365 SLA summary" });
  }
});

function worstOf(
  services: Awaited<ReturnType<typeof computeM365UptimeForTenant>>,
  windowDays: SlaWindowDays,
): { uptimePercent: number | null; breached: boolean; worstService: string | null } {
  let worstService: string | null = null;
  let worstPercent: number | null = null;
  let anyBreached = false;

  for (const s of services) {
    const w = s.windows[windowDays];
    if (w.breached) anyBreached = true;
    if (w.uptimePercent === null) continue;
    if (worstPercent === null || w.uptimePercent < worstPercent) {
      worstPercent = w.uptimePercent;
      worstService = s.service;
    }
  }

  return { uptimePercent: worstPercent, breached: anyBreached, worstService };
}

export default router;
