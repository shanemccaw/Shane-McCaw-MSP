/**
 * portal-account-security-graph.ts — Git #1593.
 *
 *   GET /api/portal/account-security/graph-signals
 *     — tenant-wide password age, failed sign-in attempts, and device
 *       compliance for the calling customer's own M365 tenant, each computed
 *       live from Microsoft Graph (see `lib/account-security-graph.ts` for
 *       the real per-item Graph calls and why each is tenant-wide rather than
 *       "this specific portal user's own" — portal users have no verified
 *       identity link to an M365 UPN).
 *
 * No frontend currently calls this route: the Account Security page (and its
 * `useAccountSecurityLive.ts` hook, which documented this exact gap only in a
 * code comment) was retired wholesale in `f40438cdc` hours after #1593 was
 * filed, and no `Design/portal/` export exists yet for its replacement. This
 * is the "build the endpoints" step of #1485's fixed order, ahead of Design.
 *
 * Same floor and customerId->tenantId resolution as portal-tenant-check-items.ts
 * (`requireRole("Assessment")`, JWT `customerId` claim is `tenants.id`).
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, tenantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

import { requireRole } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import {
  getPasswordAgeSignal,
  getFailedSignInsSignal,
  getDeviceComplianceSignal,
  getLocalFailedLoginSignal,
  type PasswordAgeSignal,
  type FailedSignInsSignal,
  type DeviceComplianceSignal,
  type LocalFailedLoginSignal,
  type GraphSignalUnavailable,
} from "../lib/account-security-graph";

const log = logger.child({ channel: "integration.azure" });

const router: IRouter = Router();

/** The wire shape this route returns — one discriminated result per item.
 * `failedSignIns` is the M365-tenant-wide sign-in-log signal (needs Entra
 * Premium); `localFailedLogins` is this portal user's OWN login-lockout state
 * (`users.failed_login_attempts`, always real/local, no Graph or license gate)
 * — deliberately separate fields since they answer different questions. */
export interface WireAccountSecurityGraphSignals {
  passwordAge: PasswordAgeSignal | GraphSignalUnavailable;
  failedSignIns: FailedSignInsSignal | GraphSignalUnavailable;
  deviceCompliance: DeviceComplianceSignal | GraphSignalUnavailable;
  localFailedLogins: LocalFailedLoginSignal | GraphSignalUnavailable;
}

function resolveCustomerId(req: Request): number | null {
  const id = (req.user as { customerId?: number } | undefined)?.customerId;
  return typeof id === "number" && !isNaN(id) ? id : null;
}

router.get(
  "/portal/account-security/graph-signals",
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    const userId = req.user!.id;

    try {
      const [tenantRow] = await db
        .select({ tenantId: tenantsTable.tenantId })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, customerId))
        .limit(1);

      // Local login-lockout state doesn't depend on an M365 tenant link at all
      // — it's this user's own row — so it's fetched regardless of whether the
      // tenant lookup below succeeds.
      const localFailedLogins = await getLocalFailedLoginSignal(userId);

      if (!tenantRow) {
        const unavailable: GraphSignalUnavailable = {
          available: false,
          reason: "error",
          detail: "No Microsoft 365 tenant is linked to this account.",
        };
        const body: WireAccountSecurityGraphSignals = {
          passwordAge: unavailable,
          failedSignIns: unavailable,
          deviceCompliance: unavailable,
          localFailedLogins,
        };
        res.json(body);
        return;
      }

      const [passwordAge, failedSignIns, deviceCompliance] = await Promise.all([
        getPasswordAgeSignal(tenantRow.tenantId),
        getFailedSignInsSignal(tenantRow.tenantId),
        getDeviceComplianceSignal(tenantRow.tenantId),
      ]);

      const body: WireAccountSecurityGraphSignals = { passwordAge, failedSignIns, deviceCompliance, localFailedLogins };
      res.json(body);
    } catch (err) {
      log.error({ err, customerId }, "GET /portal/account-security/graph-signals failed");
      res.status(500).json({ error: "Failed to load account security signals" });
    }
  },
);

export default router;
