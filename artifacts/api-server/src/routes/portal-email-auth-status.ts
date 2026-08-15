/**
 * portal-email-auth-status.ts — Git #1041, sub-issue of epic #647
 * (Remediation Tracker). Read-only access to the tenant's latest
 * `exchange:dkim-spf-dmarc-status` monitor profile (`monitor-executor.ts`'s
 * `runDnsCheck`), for the Email Authentication Setup Instructions page.
 *
 *   GET /api/portal/email-auth-status
 *     — the calling customer's own tenant's most recent SPF/DKIM/DMARC
 *       check result, or `checked: false` if that check has never run for
 *       this tenant.
 *
 * Pure read. No DNS registrar writes, no `New-DkimSigningConfig`/
 * `Set-DkimSigningConfig` execution, no ps-execution container calls — the
 * page this feeds is customer self-service instructions only (see the
 * issue's explicit out-of-scope list).
 *
 * Same `tenants.id` -> `tenants.tenantId` resolution every other route on
 * this journey uses (`portal-tenant-check-items.ts`), because
 * `tenant_monitor_profiles.tenantId` is the M365 tenant identifier, not the
 * `customerId` JWT claim.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, tenantsTable, tenantMonitorProfilesTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";

import { requireRole } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "engine.remediation-tracker" });

const router: IRouter = Router();

const EMAIL_AUTH_CHECK_KEY = "exchange:dkim-spf-dmarc-status";

interface WireEmailAuthStatus {
  readonly checked: boolean;
  readonly domain: string | null;
  readonly spfConfigured: boolean | null;
  readonly dmarcConfigured: boolean | null;
  readonly dkimConfiguredAtDefaultSelectors: boolean | null;
  readonly collectedAt: string | null;
}

const NOT_CHECKED: WireEmailAuthStatus = {
  checked: false,
  domain: null,
  spfConfigured: null,
  dmarcConfigured: null,
  dkimConfiguredAtDefaultSelectors: null,
  collectedAt: null,
};

/** tenants.id, off the JWT's `customerId` claim — same resolution every other route on this journey uses. */
function resolveCustomerId(req: Request): number | null {
  const id = (req.user as { customerId?: number } | undefined)?.customerId;
  return typeof id === "number" && !isNaN(id) ? id : null;
}

router.get(
  "/portal/email-auth-status",
  // Same floor as the rest of the Copilot Readiness/Remediation journey (see
  // portal-remediation-tracker.ts / portal-tenant-check-items.ts): Assessment
  // is the lowest role carrying a customerId.
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      const [tenantRow] = await db
        .select({ tenantId: tenantsTable.tenantId })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, customerId))
        .limit(1);

      if (!tenantRow) {
        res.json(NOT_CHECKED);
        return;
      }

      const [profile] = await db
        .select({
          extractedProperties: tenantMonitorProfilesTable.extractedProperties,
          collectedAt: tenantMonitorProfilesTable.collectedAt,
        })
        .from(tenantMonitorProfilesTable)
        .where(
          and(
            eq(tenantMonitorProfilesTable.tenantId, tenantRow.tenantId),
            eq(tenantMonitorProfilesTable.checkKey, EMAIL_AUTH_CHECK_KEY),
          ),
        )
        .orderBy(desc(tenantMonitorProfilesTable.collectedAt))
        .limit(1);

      if (!profile) {
        res.json(NOT_CHECKED);
        return;
      }

      const props = profile.extractedProperties ?? {};
      const wire: WireEmailAuthStatus = {
        checked: true,
        domain: typeof props["domain"] === "string" ? (props["domain"] as string) : null,
        spfConfigured: typeof props["spfConfigured"] === "boolean" ? (props["spfConfigured"] as boolean) : null,
        dmarcConfigured: typeof props["dmarcConfigured"] === "boolean" ? (props["dmarcConfigured"] as boolean) : null,
        dkimConfiguredAtDefaultSelectors:
          typeof props["dkimConfiguredAtDefaultSelectors"] === "boolean"
            ? (props["dkimConfiguredAtDefaultSelectors"] as boolean)
            : null,
        collectedAt: profile.collectedAt.toISOString(),
      };

      res.json(wire);
    } catch (err) {
      log.error({ err, customerId }, "GET /portal/email-auth-status failed");
      res.status(500).json({ error: "Failed to load email authentication status" });
    }
  },
);

export default router;
