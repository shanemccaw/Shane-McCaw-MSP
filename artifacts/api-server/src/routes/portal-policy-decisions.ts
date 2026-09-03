/**
 * portal-policy-decisions.ts — Policy Decisions' OWN table, own create path.
 *
 *   GET  /api/portal/policy-register              — this customer's policy decisions
 *   POST /api/portal/policy-register               — create a decision, signed at creation
 *
 * ── Why a new table and a new route, given `portal-risk-register.ts` already
 * serves `GET /portal/policy-decisions` ─────────────────────────────────────
 * That route reads `msp_risk_decisions` filtered to rows that already carry a
 * `decision_state` — i.e. a policy position recorded against a risk that was
 * already raised. #1528 (2026-08-31) decided that model does not generalize:
 * there was no way to record "we've decided X" without a risk finding first,
 * and a policy decision is genuinely a different, growing object from a risk
 * acceptance, not a permanent discriminator on the same table. This route is
 * the real, own-table create path #1528 asked for. It does not replace the
 * existing risk-derived read at `GET /portal/policy-decisions` — that endpoint
 * still serves policy positions attached to actual risk decisions. This one
 * serves (and creates) decisions that live in `policy_decisions` on their own.
 *
 * ── Scoping, identical pattern to portal-risk-register.ts ──────────────────
 * `policy_decisions.tenant_id` is the same free-text M365 tenant identifier
 * with no foreign key to `tenants`, so the JWT's `customerId` is resolved to
 * `(mspId, tenantId)` via the shared `resolveTenantScope` and both are used in
 * every query, never `tenantId` alone.
 *
 * ── Role floor: `CustomerUser` ─────────────────────────────────────────────
 * Matches `portal-risk-register.ts`'s floor, for the same reason: recording a
 * signed policy decision is not something a free Assessment-tier account
 * should reach.
 *
 * ── No unsigned intermediate state ──────────────────────────────────────────
 * A row on this table is signed from the moment it exists — see the schema's
 * own header (`lib/db/src/schema/msp.ts`, `policyDecisionsTable`). The create
 * endpoint therefore combines what the "Sign it off" form captures (owner,
 * review cadence, compensating control) with what a real signature needs
 * (typed name, server-set timestamp, statement), matching the rigor of
 * `portal-risk-register.ts`'s `accept` endpoint: server-derived timestamp and
 * IP, a sha256 signature hash, never a client-supplied signing time.
 *
 * ── A third clock: dependency-based clearance (#1526) ──────────────────────
 * `reviewCadence` above is the DATE clock. Some decisions ("Guest access
 * reviews deferred until the Entra P2 licences land") clear when a DEPENDENCY
 * resolves, not when a date arrives — no meaningful lapse, so forcing a review
 * date onto it would manufacture a false overdue state (#1526). The create
 * schema below accepts EXACTLY ONE of `reviewCadence` or `clearanceCondition`
 * — never both, never neither — matching the DB's own
 * `policy_decisions_review_xor_clearance_chk` CHECK. `clearanceTriggerType`
 * `license_sku` is observable (`advancePolicyClearances()` in
 * `alert-engine.ts` watches the tenant's already-collected `/subscribedSkus`
 * data); `manual` is not, and can only be cleared via
 * `PATCH .../:id/clearance/resolve` below.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import { db, policyDecisionsTable, CLEARANCE_TRIGGER_TYPES, REVIEW_CADENCES, complianceObligationsTable, complianceFrameworksTable } from "@workspace/db";
import { and, eq, desc, isNull, inArray, or } from "drizzle-orm";
import { z } from "zod";

import { requireRole } from "../middlewares/requireAuth";
import { resolveCustomerId, resolveTenantScope } from "../lib/portal-customer-scope";
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

/** One policy decision, in the shape this table's own consumer reads. */
interface WirePolicyRegisterEntry {
  readonly id: string;
  readonly state: string;
  readonly pillar: string | null;
  readonly title: string;
  readonly obligation: string;
  /** The compliance_obligations.id this decision cites, when it matches the
   * catalog (#1525). Null when the free-text `obligation` above has no match. */
  readonly obligationId: string | null;
  /** The cited authority's type (AUTHORITY_TYPES), resolved from `obligationId`.
   * Null unless `obligationId` is set. */
  readonly obligationType: string | null;
  readonly owner: string;
  readonly ownerId: string | null;
  /** NULL for a dependency-based decision (#1526) — see `clearance*` below. */
  readonly reviewCadence: string | null;
  readonly reviewDueAt: string | null;
  /** NULL for a dependency-based decision — there is no on_track/due/overdue
   * reading for a dependency, only resolved/unresolved (`isCleared`). */
  readonly reviewState: string | null;
  readonly compensatingControl: string;
  readonly signedBy: string;
  readonly signedAt: string;
  readonly statement: string;
  /** The dependency in plain language, e.g. "Entra P2 licences land". NULL for
   * a date-cycled decision. */
  readonly clearanceCondition: string | null;
  /** CLEARANCE_TRIGGER_TYPES: 'license_sku' (platform-observable) | 'manual'
   * (only a human mark-resolved can clear it). NULL unless `clearanceCondition`
   * is set. */
  readonly clearanceTriggerType: string | null;
  readonly clearanceTriggerSkuPartNumber: string | null;
  readonly clearanceResolvedAt: string | null;
  readonly clearanceResolvedNote: string | null;
  /** True once the dependency has resolved — the decision is actionable
   * immediately at that point, with no scheduled review to wait for (#1526). */
  readonly isCleared: boolean;
}

/** Resolves `authority_type` for a set of `compliance_obligations.id`s in one
 * query, so listing N decisions costs one extra round trip, not N. */
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

/** Every own-table policy decision for the calling customer's own tenant. */
router.get(
  "/portal/policy-register",
  requireRole("CustomerUser"),
  async (req: Request, res: Response) => {
    try {
      const customerId = resolveCustomerId(req);
      if (customerId === null) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "Customer context required");
        return;
      }
      const scope = await resolveTenantScope(customerId);
      if (!scope) {
        log.info({ customerId }, "policy decisions requested with no resolvable tenant scope — serving empty");
        res.json({ decisions: [] });
        return;
      }

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
      res.json({ decisions: rows.map((row) => toWirePolicyRegisterEntry(row, obligationTypeById)) });
    } catch (err: unknown) {
      log.error({ err }, "GET /portal/policy-register failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

/**
 * Create a policy decision, signed at creation. `confirmed` is `z.literal(true)`,
 * matching `portal-risk-register.ts`'s `accept` schema exactly: the checkbox IS
 * the consent, so a request without it is malformed rather than merely "not
 * confirmed". `signerName` is not checked against the account's own name, for
 * the same reason recorded on the accept endpoint — the person signing may
 * legitimately be signing in a role, and the account that signed is recorded
 * separately (`req.user.id`, in the log line below).
 *
 * `reviewCadence` XOR `clearanceCondition` (#1526) — a decision is either on a
 * date cycle or cleared by a dependency, never both, matching the DB's own
 * `policy_decisions_review_xor_clearance_chk`. `clearanceTriggerSkuPartNumber`
 * is required exactly when `clearanceTriggerType === 'license_sku'` (that is
 * the SKU `advancePolicyClearances()` watches for) and forbidden for `manual`
 * (there is nothing for the platform to watch).
 */
const createSchema = z
  .object({
    title: z.string().trim().min(2, "Describe the decision").max(300),
    obligation: z.string().trim().min(2, "Cite the obligation this decision responds to").max(300),
    /** Optional: the compliance_obligations.id the `obligation` citation above
     * resolves to, as a first-class reference (#1525). Verified below to be a
     * real, active catalog entry either global or authored for this tenant —
     * never trusted as-is from the client. */
    obligationId: z.number().int().nullable().optional(),
    pillar: z.string().trim().max(100).optional(),
    owner: z.string().trim().min(1, "Assign an owner").max(200),
    ownerId: z.string().trim().max(200).optional(),
    /** REVIEW_CADENCES (#2518, Shane decided Option A — fixed enum). Anything
     * outside that set is rejected here at create time (400), never silently
     * accepted with a null reviewDueAt. */
    reviewCadence: z.enum(REVIEW_CADENCES).optional(),
    clearanceCondition: z.string().trim().min(1).max(500).optional(),
    clearanceTriggerType: z.enum(CLEARANCE_TRIGGER_TYPES).optional(),
    clearanceTriggerSkuPartNumber: z.string().trim().min(1).max(100).optional(),
    compensatingControl: z.string().trim().min(1, "Describe the compensating control").max(2000),
    signerName: z.string().trim().min(2, "Type your full name to sign this decision").max(200),
    confirmed: z.literal(true),
    statement: z.string().trim().min(1).max(2000),
  })
  .superRefine((data, ctx) => {
    const dateBased = data.reviewCadence !== undefined;
    const dependencyBased = data.clearanceCondition !== undefined;
    if (dateBased === dependencyBased) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Set exactly one of reviewCadence (a date cycle) or clearanceCondition (a dependency)",
        path: ["reviewCadence"],
      });
      return;
    }
    if (dependencyBased) {
      if (data.clearanceTriggerType === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "clearanceTriggerType is required when clearanceCondition is set",
          path: ["clearanceTriggerType"],
        });
        return;
      }
      const needsSku = data.clearanceTriggerType === "license_sku";
      if (needsSku && data.clearanceTriggerSkuPartNumber === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "clearanceTriggerSkuPartNumber is required when clearanceTriggerType is 'license_sku'",
          path: ["clearanceTriggerSkuPartNumber"],
        });
      }
      if (!needsSku && data.clearanceTriggerSkuPartNumber !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "clearanceTriggerSkuPartNumber is only meaningful when clearanceTriggerType is 'license_sku'",
          path: ["clearanceTriggerSkuPartNumber"],
        });
      }
    }
  });

/** Months to advance from the anchor date per REVIEW_CADENCES value (#2518). */
const REVIEW_CADENCE_MONTHS: Record<(typeof REVIEW_CADENCES)[number], number> = {
  Monthly: 1,
  Quarterly: 3,
  "Semi-Annual": 6,
  Annual: 12,
  Biennial: 24,
};

/** Computes `reviewDueAt` from a cadence + anchor date (#2518) — `createdAt`
 * at create time, per the decided Option A. Uses `setUTCMonth` (not manual
 * millisecond math) so month-length variance is handled the same way the JS
 * Date engine already handles it elsewhere on this platform (e.g. a Jan 31
 * anchor + Monthly rolls to the last day of Feb via native overflow rules,
 * not a fabricated day count). */
function computeReviewDueAt(cadence: (typeof REVIEW_CADENCES)[number], anchor: Date): Date {
  const due = new Date(anchor);
  due.setUTCMonth(due.getUTCMonth() + REVIEW_CADENCE_MONTHS[cadence]);
  return due;
}

router.post(
  "/portal/policy-register",
  requireRole("CustomerUser"),
  async (req: Request, res: Response) => {
    const customerId = resolveCustomerId(req);
    try {
      if (customerId === null) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "Customer context required");
        return;
      }
      const scope = await resolveTenantScope(customerId);
      if (!scope) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "Customer context required");
        return;
      }

      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid policy decision", parsed.error.flatten());
        return;
      }

      // Never trust a client-supplied FK as-is: confirm it names a real, active
      // catalog entry that is either global or authored for THIS tenant. A
      // mismatch is dropped to null rather than failing the whole request —
      // the free-text `obligation` citation stays valid on its own.
      let obligationId: number | null = null;
      if (parsed.data.obligationId != null) {
        const [match] = await db
          .select({ id: complianceObligationsTable.id })
          .from(complianceObligationsTable)
          .innerJoin(complianceFrameworksTable, eq(complianceObligationsTable.frameworkId, complianceFrameworksTable.id))
          .where(
            and(
              eq(complianceObligationsTable.id, parsed.data.obligationId),
              eq(complianceObligationsTable.active, true),
              eq(complianceFrameworksTable.active, true),
              or(isNull(complianceFrameworksTable.mspId), eq(complianceFrameworksTable.mspId, scope.mspId)),
            ),
          );
        if (match) {
          obligationId = match.id;
        } else {
          log.info(
            { customerId, mspId: scope.mspId, requestedObligationId: parsed.data.obligationId },
            "policy decision obligationId did not resolve to an accessible catalog entry — dropping to null",
          );
        }
      }

      const signedAt = new Date();
      // Server-derived, same reasoning as portal-risk-register.ts's accept
      // endpoint: the app sits behind Replit's proxy with `trust proxy` not
      // configured, so this records the proxy's loopback hop today, not the
      // customer's real address. Recorded anyway (absent would be worse);
      // nothing should be inferred from it until that app-wide setting changes.
      const ipAddress = (req.ip ?? "").trim() || null;
      const signatureHash = createHash("sha256")
        .update([
          scope.tenantId,
          parsed.data.title,
          parsed.data.signerName,
          signedAt.toISOString(),
          parsed.data.statement,
        ].join(" "))
        .digest("hex");

      // #1526: date-based rows get reviewState "on_track"; a dependency-based
      // row gets no reviewState at all — there is no on_track/due/overdue
      // reading for a dependency, only resolved/unresolved.
      const dependencyBased = parsed.data.clearanceCondition !== undefined;
      // #2518: reviewDueAt is computed from reviewCadence + createdAt as the
      // anchor. `createdAt` is DB-defaulted (defaultNow()), so `signedAt`
      // (already `new Date()`, taken moments earlier) stands in for it here
      // and is written explicitly to the createdAt column below too, so the
      // anchor actually used matches the row's own createdAt exactly rather
      // than drifting by the few ms between this point and the DB's own
      // defaultNow() — the two must never be one insert apart for the same
      // decision. NULL for a dependency-based row — no date clock to anchor.
      const reviewDueAt = dependencyBased || parsed.data.reviewCadence === undefined
        ? null
        : computeReviewDueAt(parsed.data.reviewCadence, signedAt);

      const [created] = await db
        .insert(policyDecisionsTable)
        .values({
          mspId: scope.mspId,
          tenantId: scope.tenantId,
          title: parsed.data.title,
          obligation: parsed.data.obligation,
          obligationId,
          pillar: parsed.data.pillar ?? null,
          owner: parsed.data.owner,
          ownerId: parsed.data.ownerId ?? null,
          reviewCadence: parsed.data.reviewCadence ?? null,
          reviewState: dependencyBased ? null : "on_track",
          reviewDueAt,
          clearanceCondition: parsed.data.clearanceCondition ?? null,
          clearanceTriggerType: parsed.data.clearanceTriggerType ?? null,
          clearanceTriggerSkuPartNumber: parsed.data.clearanceTriggerSkuPartNumber ?? null,
          compensatingControl: parsed.data.compensatingControl,
          signedBy: parsed.data.signerName,
          signedAt,
          createdAt: signedAt,
          statement: parsed.data.statement,
          ipAddress,
          signatureHash,
        })
        .returning();

      log.info(
        {
          customerId,
          mspId: scope.mspId,
          policyDecisionId: created.id,
          signedBy: parsed.data.signerName,
          userId: typeof req.user?.id === "number" ? req.user.id : null,
          signatureHash,
        },
        "policy decision created and signed by customer",
      );

      const obligationTypeById = await loadObligationTypes(obligationId !== null ? [obligationId] : []);
      res.status(201).json({ decision: toWirePolicyRegisterEntry(created, obligationTypeById) });
    } catch (err: unknown) {
      log.error({ err, customerId }, "POST /portal/policy-register failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

/**
 * Manual mark-resolved for a dependency-based decision (#1526): the "cannot be
 * observed" half of the two ways a clearance clears. Only ever valid for
 * `clearanceTriggerType === 'manual'` — a `'license_sku'` row is the platform's
 * own to resolve (`advancePolicyClearances()` in `alert-engine.ts`); forcing a
 * manual override there would let a human clear a condition the platform
 * itself is supposed to be the source of truth for, so it 409s instead.
 */
const resolveClearanceSchema = z.object({
  note: z.string().trim().min(1, "Say how this was confirmed").max(2000),
});

router.patch(
  "/portal/policy-register/:id/clearance/resolve",
  requireRole("CustomerUser"),
  async (req: Request, res: Response) => {
    const customerId = resolveCustomerId(req);
    const id = Number(req.params.id);
    try {
      if (customerId === null) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "Customer context required");
        return;
      }
      if (!Number.isInteger(id)) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "Policy decision not found");
        return;
      }
      const scope = await resolveTenantScope(customerId);
      if (!scope) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "Customer context required");
        return;
      }

      const parsed = resolveClearanceSchema.safeParse(req.body);
      if (!parsed.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid clearance resolution", parsed.error.flatten());
        return;
      }

      // Scoped read first, same reasoning as portal-risk-register.ts's accept
      // endpoint: a decision belonging to another tenant 404s exactly like one
      // that does not exist.
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
            // The real race guard — mirrors the accept endpoint's isNull guard.
            isNull(policyDecisionsTable.clearanceResolvedAt),
          ),
        )
        .returning();

      if (updated.length === 0) {
        apiError(res, 409, ApiErrorCode.CONFLICT, "This decision's dependency has already been resolved");
        return;
      }

      log.info(
        { customerId, mspId: scope.mspId, policyDecisionId: id, userId: typeof req.user?.id === "number" ? req.user.id : null },
        "policy decision dependency clearance manually resolved",
      );

      const obligationTypeById = await loadObligationTypes(
        updated[0].obligationId !== null ? [updated[0].obligationId] : [],
      );
      res.json({ decision: toWirePolicyRegisterEntry(updated[0], obligationTypeById) });
    } catch (err: unknown) {
      log.error({ err, customerId, id }, "PATCH /portal/policy-register/:id/clearance/resolve failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

export default router;
