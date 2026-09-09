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
 * ── Tenant-authored authority scoping (Git #1525 / #3042) ──────────────────
 * `compliance_frameworks` gained nullable `mspId`/`tenantId` for a tenant-
 * authored authority (a customer's own insurance schedule) alongside the
 * global/seeded catalog. #3042 is the first route that can ever create one of
 * those rows, and this GET's catalog query originally had NO mspId/tenantId
 * predicate at all — it read every active framework/obligation unconditionally.
 * That is fine while every real row is global, but the instant a tenant-
 * authored row exists it would be served to EVERY tenant of EVERY MSP on the
 * platform, not just the one it was authored for — a real cross-tenant leak on
 * a customer-facing route (a materially worse trust boundary than
 * `msp-rbd.ts`'s own mspId-only filter, which is MSP staff reading their own
 * book). Fixed here: a row is included only if it is global (`mspId IS NULL`)
 * or matches THIS caller's own resolved `(mspId, tenantId)` pair — the same
 * `or(isNull(...), eq(...))` shape `portal-policy-decisions.ts:337` already
 * uses for the obligation-FK resolution.
 *
 * ── Role floor ──────────────────────────────────────────────────────────────
 * `Assessment` — same floor as `/portal/pillars`/`useLivePillarHero`, since this
 * page carries no liability dollar figure (unlike risk-register's `CustomerUser`
 * floor).
 *
 * ── `id` / `type` added for #1724 ───────────────────────────────────────────
 * The wire previously omitted `compliance_obligations.id` and the joined
 * `authority_type`, even though both were already selected/joinable here. The
 * Policy Decisions page (#1724) needs `id` to let a customer cite a real
 * catalog row as `obligationId` on `POST /portal/policy-register` (#1525),
 * and `type` for the same authority-type badge
 * `portal-policy-decisions.ts`'s `loadObligationTypes` already resolves for a
 * signed decision. Both are additive fields — no schema change.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, complianceFrameworksTable, complianceObligationsTable, tenantComplianceScopeTable, mspRiskDecisionsTable } from "@workspace/db";
import { and, eq, asc, isNull, or } from "drizzle-orm";

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
  /** `compliance_obligations.id`, stringified — added for #1724 so the Policy
   * Decisions "record a decision" form can cite a real catalog row as
   * `obligationId` (#1525) rather than free text only. Not previously served
   * on this wire; this route already selects the underlying column. */
  readonly id: string;
  readonly framework: string;
  readonly scope: "In scope" | "Marked out of scope";
  readonly requires: string;
  readonly state: string;
  readonly tone: ObligationTone;
  /** `compliance_frameworks.authority_type` (AUTHORITY_TYPES) — added for
   * #1724's "AUTHORITY" badge, the same field `portal-policy-decisions.ts`'s
   * `loadObligationTypes` already joins for a signed decision's own citation. */
  readonly type: string;
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

      // Resolved up front (not just for the risk-findings join below) — this is
      // also what lets the catalog query below tell "global" apart from "this
      // caller's own tenant-authored row" instead of reading every MSP's
      // tenant-authored authorities unconditionally. See the header note.
      const tenantScope = await resolveTenantScope(customerId);

      const catalog = await db
        .select({
          frameworkId: complianceFrameworksTable.id,
          frameworkName: complianceFrameworksTable.name,
          defaultInScope: complianceFrameworksTable.defaultInScope,
          obligationId: complianceObligationsTable.id,
          citation: complianceObligationsTable.citation,
          requires: complianceObligationsTable.requires,
          authorityType: complianceFrameworksTable.authorityType,
        })
        .from(complianceObligationsTable)
        .innerJoin(complianceFrameworksTable, eq(complianceObligationsTable.frameworkId, complianceFrameworksTable.id))
        .where(
          and(
            eq(complianceObligationsTable.active, true),
            eq(complianceFrameworksTable.active, true),
            tenantScope
              ? or(
                  isNull(complianceFrameworksTable.mspId),
                  and(
                    eq(complianceFrameworksTable.mspId, tenantScope.mspId),
                    eq(complianceFrameworksTable.tenantId, tenantScope.tenantId),
                  ),
                )
              : isNull(complianceFrameworksTable.mspId),
          ),
        )
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
            id: String(o.obligationId),
            framework: o.citation,
            scope: "Marked out of scope",
            requires: o.requires,
            state: "You marked this out of scope in onboarding. Tell us if that changed and every check re-evaluates.",
            tone: "slate",
            type: o.authorityType,
          };
        }

        const open = openByObligation.get(normalizeKey(o.citation));
        if (!open || open.count === 0) {
          return {
            id: String(o.obligationId),
            framework: o.citation,
            scope: "In scope",
            requires: o.requires,
            state: "No open findings against this obligation.",
            tone: "green",
            type: o.authorityType,
          };
        }

        const descriptor = open.titles.slice(0, 2).join(", ");
        return {
          id: String(o.obligationId),
          framework: o.citation,
          scope: "In scope",
          requires: o.requires,
          state: `${open.count} finding${open.count === 1 ? "" : "s"} open${descriptor ? ` — ${descriptor}` : ""}`,
          tone: open.hasHigh ? "red" : "amber",
          type: o.authorityType,
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
