/**
 * portal-compliance-obligations.ts — the "Obligations We Check Against" register
 * behind `portal-v2-compliance-obligations.tsx` (Git #1223).
 *
 *   GET /api/portal/compliance-obligations
 *
 * ── Where the rows come from (Git #1256) ───────────────────────────────────
 * `compliance_frameworks` / `compliance_obligations` are a global, tenant-
 * independent catalog (regime + specific clause/citation). `tenant_compliance_scope`
 * is the one row-per-(tenant,framework) durable fact: whether that framework is
 * in scope for THIS tenant, decided at onboarding. Per #1256's sign-off (option
 * A), the `state`/`tone` shown per obligation are NOT stored anywhere — they are
 * derived here, at read time, by joining the in-scope obligation to the tenant's
 * own OPEN findings in `msp_risk_decisions`.
 *
 * ── The join key ────────────────────────────────────────────────────────────
 * `msp_risk_decisions.obligation` is free text but was added specifically to
 * hold "the obligation a policy decision sits against, e.g. 'GDPR Art. 5(1)(e)'"
 * — the exact same citation string `compliance_obligations.citation` carries.
 * That is the join: a case-insensitive, trimmed match on that pair of columns.
 * `.framework` (also free text on that table) predates the catalog and is not
 * used here — it is a citation on the MSP-side liability record, not guaranteed
 * to align with the catalog's `compliance_frameworks.name`.
 *
 * "Open" reuses the exact vocabulary `riskRegisterModel.ts`'s `COUNTING_STATUSES`
 * already established for "counts as unresolved" on the customer-facing register:
 * Open, Mitigating, Expired. Accepted/Closed rows do not count.
 *
 * ── Scope defaulting ────────────────────────────────────────────────────────
 * A tenant with no `tenant_compliance_scope` row for a framework has not made an
 * onboarding decision yet — this falls back to that framework's
 * `default_in_scope` hint rather than hiding the row, so the register is always
 * complete against the catalog.
 *
 * ── Role floor ──────────────────────────────────────────────────────────────
 * `Assessment` — same floor as `/portal/pillars`/`useLivePillarHero`, since this
 * page carries no liability dollar figure (unlike risk-register's `CustomerUser`
 * floor).
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, complianceFrameworksTable, complianceObligationsTable, tenantComplianceScopeTable, mspRiskDecisionsTable } from "@workspace/db";
import { and, eq, asc } from "drizzle-orm";

import { requireRole } from "../middlewares/requireAuth";
import { resolveCustomerId, resolveTenantScope } from "../lib/portal-customer-scope";
import { apiError, ApiErrorCode } from "../lib/api-helpers";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

/** Reuses `riskRegisterModel.ts`'s `COUNTING_STATUSES` vocabulary — Open, Mitigating, Expired count; Accepted/Closed do not. */
const OPEN_RISK_STATUSES = new Set(["Open", "Mitigating", "Expired"]);

const OBLIGATION_TONES = ["red", "amber", "green", "slate"] as const;
type ObligationTone = (typeof OBLIGATION_TONES)[number];

/** One row, in the shape the Obligations drill-down consumes. */
interface WireObligation {
  readonly framework: string;
  readonly scope: "In scope" | "Marked out of scope";
  readonly requires: string;
  readonly state: string;
  readonly tone: ObligationTone;
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

router.get(
  "/portal/compliance-obligations",
  requireRole("Assessment"),
  async (req: Request, res: Response) => {
    try {
      const customerId = resolveCustomerId(req);
      if (customerId === null) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "Customer context required");
        return;
      }

      const catalog = await db
        .select({
          frameworkId: complianceFrameworksTable.id,
          frameworkName: complianceFrameworksTable.name,
          defaultInScope: complianceFrameworksTable.defaultInScope,
          obligationId: complianceObligationsTable.id,
          citation: complianceObligationsTable.citation,
          requires: complianceObligationsTable.requires,
        })
        .from(complianceObligationsTable)
        .innerJoin(complianceFrameworksTable, eq(complianceObligationsTable.frameworkId, complianceFrameworksTable.id))
        .where(and(eq(complianceObligationsTable.active, true), eq(complianceFrameworksTable.active, true)))
        .orderBy(asc(complianceFrameworksTable.sortOrder), asc(complianceObligationsTable.sortOrder));

      if (catalog.length === 0) {
        res.json({ obligations: [] });
        return;
      }

      const scopeRows = await db
        .select({ frameworkId: tenantComplianceScopeTable.frameworkId, inScope: tenantComplianceScopeTable.inScope })
        .from(tenantComplianceScopeTable)
        .where(eq(tenantComplianceScopeTable.tenantId, customerId));
      const scopeByFramework = new Map(scopeRows.map((r) => [r.frameworkId, r.inScope]));

      // Open findings live on the MSP-era table, scoped by (mspId, tenantId text)
      // — NOT by customerId. A tenant with no resolvable scope (no M365 tenant
      // identifier recorded yet) genuinely has no findings, so this stays empty
      // rather than failing the whole register.
      const tenantScope = await resolveTenantScope(customerId);
      const openByObligation = new Map<string, { count: number; hasHigh: boolean; titles: string[] }>();
      if (tenantScope) {
        const riskRows = await db
          .select({
            obligation: mspRiskDecisionsTable.obligation,
            riskStatus: mspRiskDecisionsTable.riskStatus,
            residualRiskLevel: mspRiskDecisionsTable.residualRiskLevel,
            title: mspRiskDecisionsTable.title,
          })
          .from(mspRiskDecisionsTable)
          .where(
            and(
              eq(mspRiskDecisionsTable.mspId, tenantScope.mspId),
              eq(mspRiskDecisionsTable.tenantId, tenantScope.tenantId),
            ),
          );

        for (const row of riskRows) {
          const obligation = (row.obligation ?? "").trim();
          const status = (row.riskStatus ?? "").trim();
          if (!obligation || !OPEN_RISK_STATUSES.has(status)) continue;
          const key = normalizeKey(obligation);
          const existing = openByObligation.get(key) ?? { count: 0, hasHigh: false, titles: [] };
          existing.count += 1;
          if ((row.residualRiskLevel ?? "").trim().toLowerCase() === "high") existing.hasHigh = true;
          if (row.title) existing.titles.push(row.title);
          openByObligation.set(key, existing);
        }
      }

      const obligations: WireObligation[] = catalog.map((o) => {
        const inScope = scopeByFramework.get(o.frameworkId) ?? o.defaultInScope;

        if (!inScope) {
          return {
            framework: o.citation,
            scope: "Marked out of scope",
            requires: o.requires,
            state: "You marked this out of scope in onboarding. Tell us if that changed and every check re-evaluates.",
            tone: "slate",
          };
        }

        const open = openByObligation.get(normalizeKey(o.citation));
        if (!open || open.count === 0) {
          return {
            framework: o.citation,
            scope: "In scope",
            requires: o.requires,
            state: "No open findings against this obligation.",
            tone: "green",
          };
        }

        const descriptor = open.titles.slice(0, 2).join(", ");
        return {
          framework: o.citation,
          scope: "In scope",
          requires: o.requires,
          state: `${open.count} finding${open.count === 1 ? "" : "s"} open${descriptor ? ` — ${descriptor}` : ""}`,
          tone: open.hasHigh ? "red" : "amber",
        };
      });

      res.json({ obligations });
    } catch (err: unknown) {
      log.error({ err }, "GET /portal/compliance-obligations failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

export default router;
