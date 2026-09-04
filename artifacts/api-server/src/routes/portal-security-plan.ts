/**
 * portal-security-plan.ts — the CUSTOMER-scoped Security Plan (plan of record).
 *
 *   GET /api/portal/security-plan — this customer's Security Plan, in TWO parts
 *                                   (#2576 — see "Two models, bridged" below):
 *                                   `plan` (the legacy hand-authored table) and
 *                                   `assembledPlan` (the settled #1561 pipeline's
 *                                   last SIGNED version).
 *
 * ── Why this route exists at all ───────────────────────────────────────────
 * Nothing backed `/portal-v2/security-plan` before it. The page was built from
 * `securityPlanData.ts` (SECURITY_PLAN) — a transcription of the design's own
 * Halden Materials plan — and there was NO plan-of-record table of any name,
 * customer-side or MSP-side. The four `portal_security_plan*` tables are that
 * store; this route reads them back for the calling customer.
 *
 * ── Two models, bridged (#2576) ─────────────────────────────────────────────
 * #2576 found this route's `portal_security_plans` table (`plan`, below) and
 * the real, tested, MSP-side assembled/versioned/signed pipeline
 * (`msp-security-plan.ts`, `security-plan-assembly.ts` + siblings, #1561-#1567)
 * were two live, completely disconnected representations of "the Security
 * Plan," with nothing bridging them. #1561's own settled architecture comment
 * (2026-08-28, closed) already decided the assembled pipeline is the real one
 * ("not a tenth module... owns almost no data of its own") — what had never
 * been scheduled was the bridge itself. `assembledPlan` IS that bridge: the
 * caller's tenant resolved via `resolveTenantScope` (read-only lookup, no MSP
 * session required) and the last **signed** `msp_security_plan_versions` row
 * for it, if any. Only ever the *signed* version — an unsigned draft/current
 * version is an MSP-internal work product (freeze → author prose → seal is an
 * authoring sequence, not a publication one) and is never surfaced here.
 *
 * `plan` (the legacy table) is kept exactly as it was — unchanged schema, zero
 * rows locally as of #2576, no live consumer — because dropping it is a
 * destructive schema change out of scope for this route-level bridge; see the
 * #2576 build's own bookend/issue comment for the recommendation on retiring
 * it outright. **The eventual customer-facing Security Plan page (no
 * `Design/portal` export exists yet — see moduleNav.ts's `builtPath: null`)
 * should be built against `assembledPlan`, not `plan`** — building it against
 * the legacy field would re-wire the stale model #2576 exists to flag.
 *
 * ── ADMIN-AUTHORED, READ-ONLY (and why there is no POST) ────────────────────
 * A Security Plan is the plan of record the MSP (Shane's team) writes and signs
 * FOR a tenant; the customer reads it, they do not edit it. So this route is
 * GET-only — the same read-only stance `portal-ownership.ts` took, for the same
 * PRODUCT reason rather than a security one. `plan`'s content is authored and
 * seeded through the manual migration
 * (`lib/db/migrations/manual/2026-08-21-portal-v2-security-plan.sql`); `assembledPlan`
 * is authored through `msp-security-plan.ts`'s freeze/prose/seal/sign sequence. If a
 * customer-editable plan is ever wanted, that is a new table decision and its own
 * piece of work — it is deliberately not faked here.
 *
 * ── Scoping ─────────────────────────────────────────────────────────────────
 * `resolveCustomerId` — `tenants.id`, straight off the JWT's `customerId` claim,
 * which is exactly the id every `portal_security_plan*` row is keyed on, for
 * `plan`. `assembledPlan` additionally resolves `resolveTenantScope(customerId)`
 * to get the `mspId` the MSP-era `msp_security_plan_versions` table is keyed on
 * (same two-scoping-shapes split `portal-customer-scope.ts`'s own header
 * documents) — read-only, fails closed to `null` on any resolution error.
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
 * rows; the client counts them. `assembledPlan.content` is likewise served as
 * the full, self-contained signed snapshot with no server-side re-derivation
 * (matching `msp-security-plan.ts`'s own "no rolled-up score" rule, §6.3 of the
 * Security Plan contract pack).
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
import { resolveCustomerId, resolveTenantScope } from "../lib/portal-customer-scope";
import { getLastSignedSecurityPlanVersion } from "../lib/security-plan-versioning";
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

/**
 * The #1561 assembled/versioned/signed pipeline's last SIGNED version, bridged
 * onto this customer route (#2576) — see the file header "Two models, bridged."
 * `content` is `SecurityPlanContent` (`security-plan-assembly.ts`'s module rows,
 * the #1563 scope and the #1565 filter footprint, plus authored prose) and
 * `signedBy` is `ClientApprover` — both left as `unknown` here exactly as
 * `msp-security-plan.ts`'s own `WireSecurityPlanVersion` does, since neither
 * type is exported for cross-module reuse and this route does not need to
 * inspect their shape, only pass it through.
 */
export interface WireAssembledSecurityPlan {
  readonly versionNumber: number;
  readonly content: unknown;
  /** Mirrored out of `content.footprint.scope.statement` — see #1564. */
  readonly scopeStatement: string;
  readonly signedAt: string;
  readonly signedBy: unknown;
}

export interface WireSecurityPlanPayload {
  /** The legacy hand-authored plan of record, or null when this customer has
   * none authored yet. See the file header — new work should not extend this. */
  readonly plan: WireSecurityPlan | null;
  /** The settled #1561 pipeline's last signed version, or null when nothing
   * has ever been signed for this customer. #2576's bridge — see file header. */
  readonly assembledPlan: WireAssembledSecurityPlan | null;
}

/**
 * Resolves `assembledPlan` (#2576). Fails closed to `null` on any error —
 * resolution failure here must never take down the legacy `plan` half of this
 * response, and vice versa, so this is intentionally isolated from the try/catch
 * around the legacy lookup below.
 */
async function resolveAssembledPlan(customerId: number): Promise<WireAssembledSecurityPlan | null> {
  try {
    const tenantScope = await resolveTenantScope(customerId);
    if (!tenantScope) return null;

    const lastSigned = await getLastSignedSecurityPlanVersion(tenantScope.mspId, customerId);
    if (!lastSigned || !lastSigned.signedAt) return null;

    return {
      versionNumber: lastSigned.versionNumber,
      content: lastSigned.content,
      scopeStatement: lastSigned.content.footprint.scope.statement,
      signedAt: lastSigned.signedAt.toISOString(),
      signedBy: lastSigned.signedBy,
    };
  } catch (err) {
    log.error(
      { customerId, err: err instanceof Error ? err.message : String(err) },
      "portal security plan: #2576 assembledPlan bridge lookup failed",
    );
    return null;
  }
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

    const assembledPlan = await resolveAssembledPlan(customerId);

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
        res.json({ plan: null, assembledPlan } satisfies WireSecurityPlanPayload);
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
          hasAssembledPlan: assembledPlan !== null,
        },
        "portal security plan served",
      );

      res.json({ plan, assembledPlan } satisfies WireSecurityPlanPayload);
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
