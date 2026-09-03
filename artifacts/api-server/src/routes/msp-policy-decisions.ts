/**
 * msp-policy-decisions.ts — MSP-side view + management of a customer's own
 * `policy_decisions` register (Git #2671).
 *
 *   GET   /api/msp/policy-decisions/:customerId                            — this
 *                                                                             customer's
 *                                                                             policy
 *                                                                             decisions
 *   PATCH /api/msp/policy-decisions/:customerId/:id/clearance/resolve       — manual
 *                                                                             mark-resolved
 *                                                                             for a
 *                                                                             dependency-based
 *                                                                             decision (#1526)
 *
 * ── The real, confirmed gap this closes ────────────────────────────────────
 * Zero MSP-side routes touched `policy_decisions`/`policyDecisionsTable` before this file
 * — confirmed via repo-wide search. `portal-policy-decisions.ts` is the customer's own
 * read + create + manual-resolve surface over the table #1528/#2024 gave Policy Decisions
 * (its own table, own primary key, own lifecycle — see that table's header in
 * `lib/db/src/schema/msp.ts` for the full architecture: `reviewCadence`/`reviewState`/
 * `reviewDueAt` as the DATE clock, `clearanceCondition`/`clearanceTriggerType` as the
 * dependency-based THIRD clock #1526 added). No MSP operator could see or act on any of
 * it. This file is the MSP-side counterpart, same relationship `msp-security-plan.ts`
 * has to the customer-facing Security Plan surface.
 *
 * ── Scoping — `:customerId` -> (mspId, tenantId), never trusted from the body ──────
 * `policy_decisions.tenant_id` is the same free-text M365 tenant identifier
 * `msp_risk_decisions`/`msp_change_requests` already use, not a `tenants` FK — so
 * `resolveTenantScope` resolves `:customerId` (a `tenants.id`) to the `(mspId, tenantId)`
 * pair the table is actually keyed on, exactly like `portal-policy-decisions.ts` does off
 * the JWT. `resolveOwnedTenant` below additionally verifies the resolved tenant belongs to
 * the CALLING MSP (`resolveMspIdStrict`, session JWT only) before ever touching the table —
 * mirrors `msp-security-plan.ts`'s own `resolveOwnedTenant` helper verbatim: a tenant that
 * exists but belongs to another MSP 404s the same as one that doesn't exist, so this can
 * never leak cross-MSP existence.
 *
 * ── Role floor: `MSPOperator` (MSPAdmin/PlatformAdmin inherit) ─────────────────────
 * Matches every other MSP-scoped read/manage route (`msp-standing-policies.ts`,
 * `msp-rbd.ts`, `msp-security-plan.ts`) — this is ordinary MSP operator territory, not an
 * MSPAdmin-only action.
 *
 * ── Deliberately NOT built here: an MSP-side "create/author" endpoint ──────────────
 * `policy_decisions` has NO unsigned intermediate state (see the table's own header) — a
 * row is a SIGNED decision from the moment it exists, and `signedBy`/`signatureHash` are
 * the customer's own typed confirmation, captured at `portal-policy-decisions.ts`'s single
 * combined create/sign-off endpoint. Building an MSP-side create here would mean an MSP
 * staffer's typed name lands in `signed_by` on a row that reads, on the wire, as the
 * customer's own signed compliance position — misattributing consent on a real,
 * customer-facing compliance record. That is a genuine product/trust decision (money,
 * entitlement and customer-promise territory per this repo's own stop-and-ask rule), not
 * a missing-column gap this build can settle on its own — filed as a real finding rather
 * than guessed at; see the sibling issue this build filed under #1685.
 *
 * The one MUTATING action built here — manual clearance resolve — is safe to extend to MSP
 * staff because it is not a policy position: it is a plain, already-established action
 * (`portal-policy-decisions.ts` already lets ANY CustomerUser resolve it, not specifically
 * the original signer) recording an observed operational fact ("the dependency actually
 * resolved"), identical business rules to the portal's own endpoint (`manual` trigger
 * type only, one-shot).
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, policyDecisionsTable, complianceObligationsTable, complianceFrameworksTable } from "@workspace/db";
import { and, eq, desc, isNull, inArray } from "drizzle-orm";
import { z } from "zod";

import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { resolveMspIdStrict } from "../lib/resolve-msp-id";
import { resolveTenantScope, type TenantScope } from "../lib/portal-customer-scope";
import { apiError, ApiErrorCode } from "../lib/api-helpers";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

type PolicyDecisionRow = typeof policyDecisionsTable.$inferSelect;

/** ISO 8601, UTC. The wire carries machine time; the page formats it. */
function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

/** One policy decision, in the shape the MSP console reads — same wire shape
 * `portal-policy-decisions.ts` already established for the customer side, so the
 * two surfaces never drift on the same real object. */
interface WirePolicyRegisterEntry {
  readonly id: string;
  readonly state: string;
  readonly pillar: string | null;
  readonly title: string;
  readonly obligation: string;
  readonly obligationId: string | null;
  readonly obligationType: string | null;
  readonly owner: string;
  readonly ownerId: string | null;
  readonly reviewCadence: string | null;
  readonly reviewDueAt: string | null;
  readonly reviewState: string | null;
  readonly compensatingControl: string;
  readonly signedBy: string;
  readonly signedAt: string;
  readonly statement: string;
  readonly clearanceCondition: string | null;
  readonly clearanceTriggerType: string | null;
  readonly clearanceTriggerSkuPartNumber: string | null;
  readonly clearanceResolvedAt: string | null;
  readonly clearanceResolvedNote: string | null;
  readonly isCleared: boolean;
}

/** Resolves `authority_type` for a set of `compliance_obligations.id`s in one
 * query, so listing N decisions costs one extra round trip, not N. Same helper
 * shape as `portal-policy-decisions.ts`'s own. */
async function loadObligationTypes(obligationIds: readonly number[]): Promise<Map<number, string>> {
  const ids = [...new Set(obligationIds)];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ obligationId: complianceObligationsTable.id, authorityType: complianceFrameworksTable.authorityType })
    .from(complianceObligationsTable)
    .innerJoin(complianceFrameworksTable, eq(complianceObligationsTable.frameworkId, complianceFrameworksTable.id))
    .where(inArray(complianceObligationsTable.id, ids));
  return new Map(rows.map((r) => [r.obligationId, r.authorityType]));
}

function toWirePolicyRegisterEntry(row: PolicyDecisionRow, obligationTypeById: Map<number, string>): WirePolicyRegisterEntry {
  return {
    id: String(row.id),
    state: row.decisionState,
    pillar: row.pillar ?? null,
    title: row.title,
    obligation: row.obligation,
    obligationId: row.obligationId !== null ? String(row.obligationId) : null,
    obligationType: row.obligationId !== null ? (obligationTypeById.get(row.obligationId) ?? null) : null,
    owner: row.owner,
    ownerId: row.ownerId ?? null,
    reviewCadence: row.reviewCadence ?? null,
    reviewDueAt: iso(row.reviewDueAt),
    reviewState: row.reviewState ?? null,
    compensatingControl: row.compensatingControl,
    signedBy: row.signedBy,
    signedAt: iso(row.signedAt) as string,
    statement: row.statement,
    clearanceCondition: row.clearanceCondition ?? null,
    clearanceTriggerType: row.clearanceTriggerType ?? null,
    clearanceTriggerSkuPartNumber: row.clearanceTriggerSkuPartNumber ?? null,
    clearanceResolvedAt: iso(row.clearanceResolvedAt),
    clearanceResolvedNote: row.clearanceResolvedNote ?? null,
    isCleared: row.clearanceResolvedAt !== null,
  };
}

/** Resolves `:customerId`, verifies it belongs to the session's MSP, and returns the
 * tenant scope. Writes the appropriate error and returns null on any failure — the exact
 * pattern `msp-security-plan.ts`'s own `resolveOwnedTenant` established. */
async function resolveOwnedTenant(req: Request, res: Response): Promise<TenantScope | null> {
  const mspId = resolveMspIdStrict(req);
  if (mspId === null) {
    apiError(res, 403, ApiErrorCode.FORBIDDEN, "MSP context required");
    return null;
  }
  const customerId = Number(req.params.customerId);
  if (!Number.isInteger(customerId) || customerId <= 0) {
    apiError(res, 400, ApiErrorCode.VALIDATION, "customerId must be a positive integer");
    return null;
  }
  const scope = await resolveTenantScope(customerId);
  if (!scope) {
    apiError(res, 404, ApiErrorCode.NOT_FOUND, "No such customer tenant");
    return null;
  }
  if (scope.mspId !== mspId) {
    // The tenant exists but belongs to another MSP — do not leak that it exists.
    apiError(res, 404, ApiErrorCode.NOT_FOUND, "No such customer tenant");
    return null;
  }
  return scope;
}

// ── GET /api/msp/policy-decisions/:customerId ──────────────────────────────
// Every own-table policy decision for one customer in the caller's own MSP book.
router.get(
  "/msp/policy-decisions/:customerId",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const scope = await resolveOwnedTenant(req, res);
      if (!scope) return;

      const rows = await db
        .select()
        .from(policyDecisionsTable)
        .where(
          and(
            eq(policyDecisionsTable.mspId, scope.mspId),
            eq(policyDecisionsTable.tenantId, scope.tenantId),
          ),
        )
        .orderBy(desc(policyDecisionsTable.id));

      const obligationTypeById = await loadObligationTypes(
        rows.map((r) => r.obligationId).filter((id): id is number => id !== null),
      );
      res.json({ customerId: scope.customerId, decisions: rows.map((row) => toWirePolicyRegisterEntry(row, obligationTypeById)) });
    } catch (err: unknown) {
      log.error({ err }, "GET /api/msp/policy-decisions/:customerId failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

// ── PATCH /api/msp/policy-decisions/:customerId/:id/clearance/resolve ──────
// Manual mark-resolved for a dependency-based decision (#1526), on the MSP's behalf —
// identical business rules to `portal-policy-decisions.ts`'s own endpoint: only ever
// valid for `clearanceTriggerType === 'manual'` (a `'license_sku'` row is the platform's
// own to resolve via `advancePolicyClearances()` in `alert-engine.ts`), and one-shot.
const resolveClearanceSchema = z.object({
  note: z.string().trim().min(1, "Say how this was confirmed").max(2000),
});

router.patch(
  "/msp/policy-decisions/:customerId/:id/clearance/resolve",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const scope = await resolveOwnedTenant(req, res);
      if (!scope) return;

      const id = Number(req.params.id);
      if (!Number.isInteger(id)) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "Policy decision not found");
        return;
      }

      const parsed = resolveClearanceSchema.safeParse(req.body);
      if (!parsed.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid clearance resolution", parsed.error.flatten());
        return;
      }

      // Scoped read first — a decision belonging to another tenant (or another MSP,
      // already excluded by resolveOwnedTenant above) 404s exactly like one that does
      // not exist.
      const [existing] = await db
        .select()
        .from(policyDecisionsTable)
        .where(
          and(
            eq(policyDecisionsTable.id, id),
            eq(policyDecisionsTable.mspId, scope.mspId),
            eq(policyDecisionsTable.tenantId, scope.tenantId),
          ),
        )
        .limit(1);

      if (!existing) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "Policy decision not found");
        return;
      }
      if (existing.clearanceCondition === null) {
        apiError(res, 409, ApiErrorCode.CONFLICT, "This decision has no dependency clearance to resolve");
        return;
      }
      if (existing.clearanceTriggerType !== "manual") {
        apiError(
          res,
          409,
          ApiErrorCode.CONFLICT,
          "This decision's dependency is platform-observable and clears on its own — it cannot be marked resolved by hand",
        );
        return;
      }
      if (existing.clearanceResolvedAt !== null) {
        apiError(res, 409, ApiErrorCode.CONFLICT, "This decision's dependency has already been resolved");
        return;
      }

      const resolvedAt = new Date();
      const updated = await db
        .update(policyDecisionsTable)
        .set({
          clearanceResolvedAt: resolvedAt,
          clearanceResolvedNote: parsed.data.note,
          updatedAt: resolvedAt,
        })
        .where(
          and(
            eq(policyDecisionsTable.id, id),
            // The real race guard — mirrors the portal endpoint's isNull guard.
            isNull(policyDecisionsTable.clearanceResolvedAt),
          ),
        )
        .returning();

      if (updated.length === 0) {
        apiError(res, 409, ApiErrorCode.CONFLICT, "This decision's dependency has already been resolved");
        return;
      }

      log.info(
        {
          mspId: scope.mspId,
          customerId: scope.customerId,
          policyDecisionId: id,
          userId: typeof req.user?.id === "number" ? req.user.id : null,
        },
        "policy decision dependency clearance manually resolved by MSP staff",
      );

      const obligationTypeById = await loadObligationTypes(
        updated[0].obligationId !== null ? [updated[0].obligationId] : [],
      );
      res.json({ decision: toWirePolicyRegisterEntry(updated[0], obligationTypeById) });
    } catch (err: unknown) {
      log.error({ err }, "PATCH /api/msp/policy-decisions/:customerId/:id/clearance/resolve failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

export default router;
