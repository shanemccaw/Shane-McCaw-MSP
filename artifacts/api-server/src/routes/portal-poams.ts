/**
 * portal-poams.ts — the CUSTOMER-scoped side of POA&Ms (Git #3080, Phase 1a
 * of #1935): "we ARE fixing this, here is the plan" — the sibling exit to
 * the Risk Register's "we accept the consequence" (`portal-risk-register.ts`).
 *
 *   GET  /api/portal/poams               — this customer's POA&Ms
 *   GET  /api/portal/poams/:poamId       — one, with its milestones
 *   POST /api/portal/poams               — customer raises a new plan (#1933's
 *                                           "raise a POA&M to disable the
 *                                           service" case)
 *   POST /api/portal/poams/:poamId/sign  — the real customer signature
 *
 * Same scoping shape as `portal-risk-register.ts`: `msp_poams` is an MSP-era
 * table (`msp_id` + free-text `tenant_id`), not customer-id-keyed, so every
 * query resolves through `resolveTenantScope` and filters on BOTH resulting
 * values — see that file's own header for why either alone is insufficient.
 *
 * Role floor: `Customer`, matching the Risk Register rather than the
 * lower `Free` floor some other customer-scoped routes use — a POA&M
 * carries the same class of governance/compliance weight (and, once signed,
 * the same "this was formally agreed" evidentiary value) that justified the
 * higher floor there.
 *
 * Tier-gated per #3104/#1168: creation and tracking stay unconditional (the
 * two POST routes below, and the whole MSP-console side in `msp-poams.ts`,
 * are never gated by this) — only the two customer-facing READ routes below
 * check the caller's purchased Monitoring tier bundles the real `poams`
 * module key, same as `policyDecisions`/`riskRegister` in
 * `portal-risk-register.ts`. WHICH tier(s) actually include `poams` is a
 * real pricing decision this build does not invent — see #3104's own bookend;
 * until that's decided nothing resolves `includedFeatures` to contain
 * `poams`, so this fails closed (402) rather than silently open.
 *
 * The real signature ceremony reuses `risk-authority.ts`'s resolution
 * functions VERBATIM (never RBD-specific in implementation, only in name):
 * accountability resolves through the M365 workload `checkKey` inherits
 * ownership from, never a typed field (#1491), exactly like #1511 already
 * settled for the Risk Register.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import { db, mspPoamsTable, mspPoamMilestonesTable, type ClientApprover } from "@workspace/db";
import { and, eq, desc, asc, isNull, inArray } from "drizzle-orm";
import { z } from "zod";

import { requireCapability } from "../middlewares/requireAuth";
import { resolveCustomerId, resolveTenantScope } from "../lib/portal-customer-scope";
import { requireTierFeature, PORTAL_TIER_MODULE_KEYS } from "../lib/portal-tier-features";
import { apiError, ApiErrorCode } from "../lib/api-helpers";
import { logger } from "../lib/logger";
import { personIdForUser } from "../lib/portal-ownership";
import { randomPlaceholder, assignPoamId } from "../lib/poam-ref";
import {
  currentAHolderPersonIds,
  namesForPersonIds,
  resolveRiskAuthority,
  resolveRiskWorkload,
  type RiskAuthority,
  type RiskAuthorizedBy,
} from "../lib/risk-authority";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

type PoamRow = typeof mspPoamsTable.$inferSelect;
type MilestoneRow = typeof mspPoamMilestonesTable.$inferSelect;

function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

/** Today as a YYYY-MM-DD string, UTC — comparable directly against the plain
 * `date` columns this table stores, no timezone parsing required. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Real, derived — never stored, never guessed. See schema header for why
 * this is computed at read time rather than a second clock-advance job. */
function computeOverdue(dueDate: string, isLive: boolean): boolean {
  return isLive && dueDate < todayIso();
}

interface WirePoamAuthorityHolder {
  readonly personId: string;
  readonly name: string;
}

interface WirePoamAuthority {
  readonly workloadId: string;
  readonly workloadLabel: string;
  readonly holders: readonly WirePoamAuthorityHolder[];
}

function toWirePoamAuthority(a: RiskAuthority | RiskAuthorizedBy | null): WirePoamAuthority | null {
  if (!a) return null;
  return {
    workloadId: a.workload.objectId,
    workloadLabel: a.workload.label,
    holders: a.holders.map((h) => ({ personId: h.personId, name: h.name })),
  };
}

interface WirePoamMilestone {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly dueDate: string;
  readonly status: string;
  readonly completedAt: string | null;
  readonly isOverdue: boolean;
}

function toWireMilestone(row: MilestoneRow): WirePoamMilestone {
  return {
    id: String(row.id),
    title: row.title,
    description: row.description ?? null,
    dueDate: row.dueDate,
    status: row.status,
    completedAt: iso(row.completedAt),
    isOverdue: computeOverdue(row.dueDate, row.status === "pending"),
  };
}

/** The signature block, present only once the plan has actually been signed. */
interface WirePoamSignature {
  readonly by: string;
  readonly on: string;
  readonly statement: string | null;
  readonly authorizedBy: WirePoamAuthority | null;
}

interface WirePoam {
  readonly id: string;
  readonly title: string;
  readonly weakness: string;
  readonly checkKey: string | null;
  readonly status: string;
  readonly isOverdue: boolean;
  readonly scheduledCompletionDate: string;
  readonly originalScheduledCompletionDate: string;
  readonly interimCompensatingControl: string;
  readonly resourcesRequired: string;
  readonly sowId: string | null;
  readonly authority: WirePoamAuthority | null;
  readonly signed?: WirePoamSignature;
  readonly isSigned: boolean;
  readonly milestones: readonly WirePoamMilestone[];
}

function toWirePoam(
  row: PoamRow,
  milestones: readonly MilestoneRow[],
  authority: RiskAuthority | null,
): WirePoam {
  const signedAt = iso(row.signedAt);
  const approver = (row.signedBy ?? null) as ClientApprover | null;

  // Mirrors `portal-risk-register.ts`'s own guard: the signature block
  // appears iff the write path actually ran, never merely `status === "active"`.
  const signed: WirePoamSignature | undefined =
    signedAt && approver?.name
      ? {
          by: approver.name,
          on: signedAt,
          statement: row.signedStatement ?? null,
          authorizedBy: null, // point-in-time authority attached by the caller when available (see routes below)
        }
      : undefined;

  return {
    id: row.poamId,
    title: row.title,
    weakness: row.weaknessDescription,
    checkKey: row.checkKey ?? null,
    status: row.status,
    isOverdue: computeOverdue(row.scheduledCompletionDate, row.status === "active"),
    scheduledCompletionDate: row.scheduledCompletionDate,
    originalScheduledCompletionDate: row.originalScheduledCompletionDate,
    interimCompensatingControl: row.interimCompensatingControl,
    resourcesRequired: row.resourcesRequired,
    sowId: row.sowId ?? null,
    authority: toWirePoamAuthority(authority),
    ...(signed ? { signed } : {}),
    isSigned: signed !== undefined,
    milestones: milestones.map(toWireMilestone),
  };
}

async function scopeOrEmpty(req: Request, res: Response) {
  const customerId = resolveCustomerId(req);
  if (customerId === null) {
    apiError(res, 403, ApiErrorCode.FORBIDDEN, "Customer context required");
    return null;
  }
  const scope = await resolveTenantScope(customerId);
  if (!scope) {
    log.info({ customerId }, "POA&Ms requested with no resolvable tenant scope — serving empty");
    res.json({ poams: [] });
    return null;
  }
  return scope;
}

/** Every POA&M for the calling customer's own tenant, milestones included. */
router.get(
  "/portal/poams",
  requireCapability("ladder.customer-user"),
  // #1168/#3104: creation (POST below) is unconditional; only this READ
  // checks the customer's purchased Monitoring tier bundles POA&Ms.
  requireTierFeature(PORTAL_TIER_MODULE_KEYS.poams),
  async (req: Request, res: Response) => {
    try {
      const scope = await scopeOrEmpty(req, res);
      if (!scope) return;

      const rows = await db
        .select()
        .from(mspPoamsTable)
        .where(and(eq(mspPoamsTable.mspId, scope.mspId), eq(mspPoamsTable.tenantId, scope.tenantId)))
        .orderBy(desc(mspPoamsTable.id));

      const milestonesByPoam = new Map<number, MilestoneRow[]>();
      if (rows.length > 0) {
        const milestoneRows = await db
          .select()
          .from(mspPoamMilestonesTable)
          .where(inArray(mspPoamMilestonesTable.poamId, rows.map((r) => r.id)))
          .orderBy(asc(mspPoamMilestonesTable.sortOrder), asc(mspPoamMilestonesTable.id));
        for (const m of milestoneRows) {
          const list = milestonesByPoam.get(m.poamId) ?? [];
          list.push(m);
          milestonesByPoam.set(m.poamId, list);
        }
      }

      const authorities = await Promise.all(
        rows.map((r) => resolveRiskAuthority(scope.customerId, r.checkKey)),
      );

      res.json({
        poams: rows.map((row, i) => toWirePoam(row, milestonesByPoam.get(row.id) ?? [], authorities[i] ?? null)),
      });
    } catch (err: unknown) {
      log.error({ err }, "GET /portal/poams failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

/** One POA&M, with its milestones. */
router.get(
  "/portal/poams/:poamId",
  requireCapability("ladder.customer-user"),
  requireTierFeature(PORTAL_TIER_MODULE_KEYS.poams),
  async (req: Request, res: Response) => {
    const customerId = resolveCustomerId(req);
    try {
      if (customerId === null) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "Customer context required");
        return;
      }
      const scope = await resolveTenantScope(customerId);
      if (!scope) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "POA&M not found");
        return;
      }

      const [existing] = await db
        .select()
        .from(mspPoamsTable)
        .where(
          and(
            eq(mspPoamsTable.poamId, String(req.params.poamId)),
            eq(mspPoamsTable.mspId, scope.mspId),
            eq(mspPoamsTable.tenantId, scope.tenantId),
          ),
        )
        .limit(1);
      if (!existing) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "POA&M not found");
        return;
      }

      const milestones = await db
        .select()
        .from(mspPoamMilestonesTable)
        .where(eq(mspPoamMilestonesTable.poamId, existing.id))
        .orderBy(asc(mspPoamMilestonesTable.sortOrder), asc(mspPoamMilestonesTable.id));

      const authority = await resolveRiskAuthority(scope.customerId, existing.checkKey);
      res.json(toWirePoam(existing, milestones, authority));
    } catch (err: unknown) {
      log.error({ err, customerId }, "GET /portal/poams/:poamId failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

/**
 * Customer-authored creation (#1933: "raise a POA&M to actually disable the
 * service"). `tenantId`/`tenantName`/`primaryDomain`/`mspId` are ALWAYS
 * server-derived from the resolved scope, never taken from the request body
 * — the same discipline `portal-risk-register.ts`'s accept route already
 * applies to every server-set fact. `status` always starts `pending_signature`
 * — a customer authoring their own plan still goes through the real
 * signature ceremony below; there is no bypass for a self-authored plan.
 */
const createPoamSchema = z.object({
  title: z.string().trim().min(1).max(300),
  weaknessDescription: z.string().trim().min(1).max(4000),
  checkKey: z.string().nullable().optional(),
  additionalCheckKeys: z.array(z.string()).nullable().optional(),
  scheduledCompletionDate: isoDate,
  interimCompensatingControl: z.string().trim().min(1).max(4000),
  resourcesRequired: z.string().trim().min(1).max(4000),
  sowId: z.string().uuid().nullable().optional(),
});

router.post(
  "/portal/poams",
  requireCapability("ladder.customer-user"),
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

      const parsed = createPoamSchema.safeParse(req.body);
      if (!parsed.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid POA&M data", parsed.error.flatten());
        return;
      }
      const data = parsed.data;
      const placeholder = randomPlaceholder();

      const [inserted] = await db
        .insert(mspPoamsTable)
        .values({
          mspId: scope.mspId,
          poamId: placeholder,
          tenantId: scope.tenantId,
          tenantName: scope.tenantName,
          primaryDomain: scope.primaryDomain,
          title: data.title,
          weaknessDescription: data.weaknessDescription,
          checkKey: data.checkKey ?? null,
          additionalCheckKeys: data.additionalCheckKeys ?? null,
          scheduledCompletionDate: data.scheduledCompletionDate,
          originalScheduledCompletionDate: data.scheduledCompletionDate,
          interimCompensatingControl: data.interimCompensatingControl,
          resourcesRequired: data.resourcesRequired,
          status: "pending_signature",
          sowId: data.sowId ?? null,
        })
        .returning({ id: mspPoamsTable.id });

      const poamId = await assignPoamId(inserted.id, placeholder);

      log.info({ customerId, mspId: scope.mspId, poamId }, "POA&M raised by customer");

      res.status(201).json({ id: poamId, message: "POA&M created successfully" });
    } catch (err: unknown) {
      log.error({ err, customerId }, "POST /portal/poams failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

/**
 * The typed-name + checkbox signature — mirrors
 * `portal-risk-register.ts`'s `acceptSchema` exactly. `confirmed` is a
 * literal, not a boolean: the checkbox IS the consent.
 */
const signSchema = z.object({
  fullName: z.string().trim().min(2, "Type your full name to sign this plan").max(200),
  confirmed: z.literal(true),
  statement: z.string().trim().min(1).max(2000),
});

router.post(
  "/portal/poams/:poamId/sign",
  requireCapability("ladder.customer-user"),
  async (req: Request, res: Response) => {
    const customerId = resolveCustomerId(req);
    const poamIdParam = String(req.params.poamId);
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

      const parsed = signSchema.safeParse(req.body);
      if (!parsed.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid signature", parsed.error.flatten());
        return;
      }

      // Scoped read first — a plan belonging to another tenant 404s exactly
      // like one that does not exist (same anti-probing discipline as the
      // Risk Register's accept route).
      const [existing] = await db
        .select()
        .from(mspPoamsTable)
        .where(
          and(
            eq(mspPoamsTable.poamId, poamIdParam),
            eq(mspPoamsTable.mspId, scope.mspId),
            eq(mspPoamsTable.tenantId, scope.tenantId),
          ),
        )
        .limit(1);
      if (!existing) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "POA&M not found");
        return;
      }

      // NEVER EDITABLE AFTER THE FACT — Postgres has no write-once column, so
      // the guarantee is a guarded UPDATE plus this check, same discipline
      // `msp_risk_decisions.acceptedAt` already established.
      if (existing.signedAt !== null) {
        apiError(res, 409, ApiErrorCode.CONFLICT, "This POA&M has already been signed and cannot be changed");
        return;
      }
      if (existing.status === "cancelled" || existing.status === "completed") {
        apiError(res, 409, ApiErrorCode.CONFLICT, `This POA&M is ${existing.status} and cannot be signed`);
        return;
      }

      // ── Role-based signature authority (#1491, reusing #1511's mechanism) ──
      // Same rule the Risk Register already settled: when `checkKey` resolves
      // to a real workload, only a CURRENT Accountable holder there may sign.
      // A `checkKey` resolving to no workload keeps the honest fallback: any
      // `Customer` may sign.
      const workload = resolveRiskWorkload(existing.checkKey);
      const signerPersonId = typeof req.user?.id === "number" ? personIdForUser(req.user.id) : null;
      let authorizingHolderIds: string[] | null = null;

      if (workload) {
        const holderIds = await currentAHolderPersonIds(customerId, workload.objectId);
        if (holderIds.length === 0) {
          apiError(
            res,
            409,
            ApiErrorCode.CONFLICT,
            `No one currently holds Accountable authority for ${workload.label}. Assign an owner on the Ownership page before this plan can be signed.`,
          );
          return;
        }
        if (!signerPersonId || !holderIds.includes(signerPersonId)) {
          const names = await namesForPersonIds(customerId, holderIds);
          apiError(
            res,
            403,
            ApiErrorCode.FORBIDDEN,
            `Only an Accountable holder for ${workload.label} can sign this plan.`,
            { workload: workload.label, holders: holderIds.map((id) => names.get(id) ?? id) },
          );
          return;
        }
        authorizingHolderIds = holderIds;
      }

      const signedAt = new Date();

      // Both server-derived, same known-limitation note as the Risk Register's
      // accept route: `req.ip` reads the proxy's loopback hop until Express
      // `trust proxy` is configured app-wide (Shane's call, not this route's).
      const ipAddress = (req.ip ?? "").trim() || null;
      const signatureHash = createHash("sha256")
        .update([existing.poamId, parsed.data.fullName, signedAt.toISOString(), parsed.data.statement].join("\x00"))
        .digest("hex");

      const signedBy: ClientApprover = {
        name: parsed.data.fullName,
        title: "",
        email: "",
        signedAt: signedAt.toISOString().substring(0, 19).replace("T", " ") + " UTC",
        ipAddress,
        signatureHash,
      };

      const updated = await db
        .update(mspPoamsTable)
        .set({
          signedAt,
          signedStatement: parsed.data.statement,
          signedBy,
          status: "active",
          authorizingWorkloadId: workload?.objectId ?? null,
          authorizingWorkloadLabel: workload?.label ?? null,
          authorizingHolderPersonIds: authorizingHolderIds,
          signedByPersonId: signerPersonId,
          updatedAt: signedAt,
        })
        .where(
          and(
            eq(mspPoamsTable.id, existing.id),
            // The real race guard — only one concurrent request can match
            // `signed_at IS NULL`; the loser updates zero rows.
            isNull(mspPoamsTable.signedAt),
          ),
        )
        .returning({ id: mspPoamsTable.id });

      if (updated.length === 0) {
        apiError(res, 409, ApiErrorCode.CONFLICT, "This POA&M has already been signed and cannot be changed");
        return;
      }

      log.info(
        {
          customerId,
          mspId: scope.mspId,
          poamId: poamIdParam,
          signedBy: parsed.data.fullName,
          userId: typeof req.user?.id === "number" ? req.user.id : null,
          signatureHash,
          authorizingWorkloadId: workload?.objectId ?? null,
          signedByPersonId: signerPersonId,
        },
        "POA&M signed by customer",
      );

      let authorizedBy: WirePoamAuthority | null = null;
      if (workload && authorizingHolderIds) {
        const names = await namesForPersonIds(customerId, authorizingHolderIds);
        authorizedBy = {
          workloadId: workload.objectId,
          workloadLabel: workload.label,
          holders: authorizingHolderIds.map((id) => ({ personId: id, name: names.get(id) ?? id })),
        };
      }

      res.status(201).json({
        poamId: poamIdParam,
        signed: {
          by: parsed.data.fullName,
          on: signedAt.toISOString(),
          statement: parsed.data.statement,
          authorizedBy,
        },
      });
    } catch (err: unknown) {
      log.error({ err, customerId, poamId: poamIdParam }, "POST /portal/poams/:poamId/sign failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

export default router;
