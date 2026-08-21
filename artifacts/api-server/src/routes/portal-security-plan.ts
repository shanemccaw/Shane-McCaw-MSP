/**
 * portal-security-plan.ts — the CUSTOMER-scoped Security Plan (plan of record).
 *
 *   GET /api/portal/security-plan — this customer's authoritative Security Plan:
 *                                   its header, its numbered sections, each
 *                                   section's requirement rows, and its version
 *                                   history.
 *
 * ── Why this route exists at all ───────────────────────────────────────────
 * Nothing backed `/portal-v2/security-plan` before it. The page was built from
 * `securityPlanData.ts` (SECURITY_PLAN) — a transcription of the design's own
 * Halden Materials plan — and there was NO plan-of-record table of any name,
 * customer-side or MSP-side. The four `portal_security_plan*` tables are that
 * store; this route reads them back for the calling customer.
 *
 * ── ADMIN-AUTHORED, READ-ONLY (and why there is no POST) ────────────────────
 * A Security Plan is the plan of record the MSP (Shane's team) writes and signs
 * FOR a tenant; the customer reads it, they do not edit it. So this route is
 * GET-only — the same read-only stance `portal-ownership.ts` took, for the same
 * PRODUCT reason rather than a security one. The plan's content is authored and
 * seeded through the manual migration
 * (`lib/db/migrations/manual/2026-08-21-portal-v2-security-plan.sql`), not through
 * the portal. If a customer-editable plan is ever wanted, that is a new table
 * decision and its own piece of work — it is deliberately not faked here.
 *
 * ── Scoping ─────────────────────────────────────────────────────────────────
 * `resolveCustomerId` — `tenants.id`, straight off the JWT's `customerId` claim,
 * which is exactly the id every `portal_security_plan*` row is keyed on. One
 * value, direct comparison. No `resolveTenantScope` needed: unlike Ownership,
 * nothing here reads an MSP-era `(mspId, tenantId)` table.
 *
 * ── Role floor ─────────────────────────────────────────────────────────────
 * `requireRole("CustomerUser")`, matching `portal-ownership.ts`: a security plan
 * is a thing a paying tenant's team reads, not something a free assessment lead
 * is shown. The cross-tenant guard is the `customerId`-from-JWT scoping below.
 *
 * ── The derived numbers are NOT computed here ──────────────────────────────
 * The header verdict, the met percentage and the per-section gap badge are
 * DERIVED from the rows on the client (`securityPlanModel.ts`), and stay there —
 * a plan that could disagree with itself defeats its own claim, so there is one
 * derivation, not a server copy that could drift from it. This route serves the
 * rows; the client counts them.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  portalSecurityPlansTable,
  portalSecurityPlanSectionsTable,
  portalSecurityPlanRowsTable,
  portalSecurityPlanVersionsTable,
} from "@workspace/db";
import { asc, eq, inArray } from "drizzle-orm";

import { requireRole } from "../middlewares/requireAuth";
import { resolveCustomerId } from "../lib/portal-customer-scope";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

/** One requirement row, in the page's own `SecPlanRow` shape. */
export interface WireSecPlanRow {
  readonly req: string;
  readonly state: string;
  readonly detail: string;
  readonly to: string;
  readonly toLabel: string;
}

/** One section, in the page's own `SecPlanSection` shape. */
export interface WireSecPlanSection {
  readonly k: string;
  readonly n: string;
  readonly label: string;
  readonly lead: string;
  readonly rows: readonly WireSecPlanRow[];
}

/** One version-history entry, in the page's own `SecPlanVersion` shape. */
export interface WireSecPlanVersion {
  readonly v: string;
  readonly when: string;
  readonly who: string;
  readonly what: string;
  readonly cr: string;
}

/** The whole plan, in the page's own `SecurityPlan` shape plus the owner chip. */
export interface WireSecurityPlan {
  readonly tenant: string;
  readonly env: string;
  readonly tier: string;
  readonly version: string;
  readonly updated: string;
  readonly approver: string;
  /** The signing-owner chip — the page's `SECURITY_PLAN_OWNER`. */
  readonly owner: { readonly initials: string; readonly tone: string };
  readonly sections: readonly WireSecPlanSection[];
  readonly history: readonly WireSecPlanVersion[];
}

export interface WireSecurityPlanPayload {
  /** The plan of record, or null when this customer has none authored yet. */
  readonly plan: WireSecurityPlan | null;
}

router.get(
  "/portal/security-plan",
  requireRole("CustomerUser"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      const [planRow] = await db
        .select()
        .from(portalSecurityPlansTable)
        .where(eq(portalSecurityPlansTable.customerId, customerId))
        .limit(1);

      // No plan authored for this customer yet. A null plan — not an empty one —
      // so the client renders its design fixture (which explains what the page is
      // for) rather than an empty masthead.
      if (!planRow) {
        log.info({ customerId }, "portal security plan: none authored for customer");
        res.json({ plan: null } satisfies WireSecurityPlanPayload);
        return;
      }

      const sectionRows = await db
        .select()
        .from(portalSecurityPlanSectionsTable)
        .where(eq(portalSecurityPlanSectionsTable.planId, planRow.id))
        .orderBy(asc(portalSecurityPlanSectionsTable.position));

      const sectionIds = sectionRows.map((s) => s.id);

      // One query for every row across every section, then grouped in code, so a
      // ten-section plan is two queries rather than eleven.
      const reqRows = sectionIds.length
        ? await db
            .select()
            .from(portalSecurityPlanRowsTable)
            .where(inArray(portalSecurityPlanRowsTable.sectionId, sectionIds))
            .orderBy(
              asc(portalSecurityPlanRowsTable.sectionId),
              asc(portalSecurityPlanRowsTable.position),
            )
        : [];

      const rowsBySection = new Map<number, WireSecPlanRow[]>();
      for (const r of reqRows) {
        const list = rowsBySection.get(r.sectionId) ?? [];
        list.push({ req: r.req, state: r.state, detail: r.detail, to: r.toRoute, toLabel: r.toLabel });
        rowsBySection.set(r.sectionId, list);
      }

      const versionRows = await db
        .select()
        .from(portalSecurityPlanVersionsTable)
        .where(eq(portalSecurityPlanVersionsTable.planId, planRow.id))
        .orderBy(asc(portalSecurityPlanVersionsTable.position));

      const plan: WireSecurityPlan = {
        tenant: planRow.tenant,
        env: planRow.env,
        tier: planRow.tier,
        version: planRow.version,
        updated: planRow.updatedLabel,
        approver: planRow.approver,
        owner: { initials: planRow.ownerInitials, tone: planRow.ownerTone },
        sections: sectionRows.map((s) => ({
          k: s.sectionKey,
          n: s.number,
          label: s.label,
          lead: s.lead,
          rows: rowsBySection.get(s.id) ?? [],
        })),
        history: versionRows.map((h) => ({
          v: h.version,
          when: h.whenLabel,
          who: h.who,
          what: h.what,
          cr: h.cr,
        })),
      };

      log.info(
        {
          customerId,
          sections: plan.sections.length,
          requirements: reqRows.length,
          history: plan.history.length,
        },
        "portal security plan served",
      );

      res.json({ plan } satisfies WireSecurityPlanPayload);
    } catch (err) {
      log.error(
        { customerId, err: err instanceof Error ? err.message : String(err) },
        "portal security plan failed",
      );
      res.status(500).json({ error: "Your security plan could not be loaded." });
    }
  },
);

export default router;
