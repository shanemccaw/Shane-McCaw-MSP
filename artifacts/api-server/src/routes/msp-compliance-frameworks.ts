/**
 * msp-compliance-frameworks.ts — MSP-console create route for a tenant-authored
 * compliance authority + its obligations (Git #3042, part of #1490).
 *
 *   POST /api/msp/customers/:customerId/compliance-frameworks
 *   GET  /api/msp/customers/:customerId/compliance-frameworks
 *   POST /api/msp/customers/:customerId/compliance-frameworks/:frameworkId/compliance-obligations
 *   GET  /api/msp/customers/:customerId/compliance-frameworks/:frameworkId/compliance-obligations
 *
 * ── The real, confirmed gap this closes (#3042, itself filed by #1642's contract-pack
 * regeneration for #1525) ───────────────────────────────────────────────────────────
 * #1525 gave `compliance_frameworks` nullable `mspId`/`tenantId` columns so a row can be
 * either global/seeded (`mspId IS NULL`) or authored for one specific MSP/tenant — a
 * customer's own cyber-insurance schedule or records policy, cited as an authority the
 * same way GDPR or SOX are. That schema shape shipped with **no route anywhere that
 * could ever create one** (confirmed via repo-wide grep for `insert(complianceFrameworksTable`
 * / `insert(complianceObligationsTable` — zero matches before this file). Every real
 * `compliance_frameworks` row in the local DB carried `msp_id IS NULL` because nothing
 * could write anything else.
 *
 * ── Where it lives — MSP-console side, per Shane's real 2026-09-07 decision on #3042 ──
 * "Right now, the only MSP Staff is Shane... it doesn't really matter. Much later when
 * we start making money we can tackle RBAC here." Same pattern already established for
 * #2148's OU-assignment question (`msp-active-directory.ts`): MSP staff curate the
 * customer's catalog, not customer self-service (deferred, not decided against).
 *
 * ── Scope — `:customerId` -> (mspId, tenantId), never trusted from the body ─────────
 * Same `resolveOwnedTenant` discipline as `msp-security-plan.ts`: `resolveTenantScope`
 * resolves `:customerId` (a `tenants.id`) to the real `(mspId, tenantId)` pair, and the
 * resolved `mspId` is verified against the CALLING MSP (`resolveMspIdStrict`, session
 * JWT only) before anything is read or written — a tenant belonging to another MSP 404s
 * identically to one that doesn't exist, never leaking cross-MSP existence.
 *
 * Every row this file creates carries `mspId`/`tenantId` set to the CALLER's own scope —
 * the client cannot set either. Global/seeded rows (`mspId IS NULL`) are out of scope
 * for this issue and cannot be created here; they remain manually seeded catalog data.
 *
 * An obligation can only be authored under a framework this build itself created for the
 * SAME (mspId, tenantId) — never under a global framework (that would mean MSP-authored
 * text landing on a shared seeded regime every other tenant also reads) and never under
 * another tenant's authored framework (ownership-checked the same way as the framework
 * route itself).
 *
 * ── Role floor: `MSPOperator` (MSPAdmin/PlatformAdmin inherit) ─────────────────────
 * Matches every other MSP-scoped manage route (`msp-security-plan.ts`,
 * `msp-active-directory.ts`, `msp-policy-decisions.ts`) — ordinary MSP operator
 * territory, not MSPAdmin-only.
 *
 * ── The GET routes are the deliberate completion of the loop, not scope creep ───────
 * A create with no way to see what was created is a black hole (the exact phrase
 * `msp-active-directory.ts`'s own header uses for the same shape) — these two GETs are
 * scoped identically to their POST siblings and return only rows the caller authored.
 *
 * ── #3042 finding, fixed in this same build, not filed separately ───────────────────
 * `portal-compliance-obligations.ts`'s customer-facing GET had NO mspId/tenantId
 * predicate at all before this build — it read every active framework/obligation
 * unconditionally. The instant this route created a real tenant-authored row, that
 * customer-facing register would have served it to every tenant of every MSP on the
 * platform, not just the one it was authored for. Fixed directly (not filed as a
 * separate finding, per the "a gap you fixed in this build" rule) — see that file's own
 * header for detail.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  complianceFrameworksTable,
  complianceObligationsTable,
  AUTHORITY_TYPES,
} from "@workspace/db";
import { and, eq, asc } from "drizzle-orm";
import { z } from "zod";

import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { resolveMspIdStrict } from "../lib/resolve-msp-id";
import { resolveTenantScope, type TenantScope } from "../lib/portal-customer-scope";
import { apiError, ApiErrorCode } from "../lib/api-helpers";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

/** Resolves `:customerId`, verifies it belongs to the session's MSP, and returns the
 * tenant scope. Writes the appropriate error and returns null on any failure. Same
 * shape as `msp-security-plan.ts`'s own `resolveOwnedTenant`. */
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

/** A postgres unique-violation, however the driver surfaces it (`code` on `pg`, or the
 * message text on whatever wraps it) — same detection shape already used across this
 * repo's admin-* create routes (e.g. `admin-customer-alert-rules.ts`). */
function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === "23505") return true;
  return err instanceof Error && /unique/i.test(err.message);
}

const createFrameworkSchema = z.object({
  key: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(300),
  authority: z.string().trim().max(300).optional(),
  category: z.string().trim().max(100).optional(),
  authorityType: z.enum(AUTHORITY_TYPES),
  description: z.string().trim().max(5000).optional(),
  defaultInScope: z.boolean().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

const createObligationSchema = z.object({
  key: z.string().trim().min(1).max(200),
  citation: z.string().trim().min(1).max(500),
  requires: z.string().trim().min(1).max(5000),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

// ── POST /msp/customers/:customerId/compliance-frameworks ──────────────────────────
// Creates a tenant-authored authority (a customer's own insurance schedule, records
// policy, contract, etc). mspId/tenantId are always the CALLER's own resolved scope —
// never client-supplied.
router.post(
  "/msp/customers/:customerId/compliance-frameworks",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const tenant = await resolveOwnedTenant(req, res);
      if (!tenant) return;

      const parsed = createFrameworkSchema.safeParse(req.body);
      if (!parsed.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid compliance framework", parsed.error.flatten());
        return;
      }

      const [row] = await db
        .insert(complianceFrameworksTable)
        .values({
          key: parsed.data.key,
          name: parsed.data.name,
          authority: parsed.data.authority ?? null,
          category: parsed.data.category ?? null,
          authorityType: parsed.data.authorityType,
          description: parsed.data.description ?? null,
          defaultInScope: parsed.data.defaultInScope ?? false,
          active: parsed.data.active ?? true,
          sortOrder: parsed.data.sortOrder ?? 0,
          mspId: tenant.mspId,
          tenantId: tenant.tenantId,
        })
        .returning();

      log.info(
        { customerId: tenant.customerId, mspId: tenant.mspId, frameworkId: row.id, key: row.key },
        "MSP staff authored a tenant-scoped compliance framework",
      );
      res.status(201).json(row);
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        apiError(res, 409, ApiErrorCode.CONFLICT, "A compliance framework with that key already exists");
        return;
      }
      log.error({ err }, "POST /api/msp/customers/:customerId/compliance-frameworks failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

// ── GET /msp/customers/:customerId/compliance-frameworks ───────────────────────────
// The tenant-authored authorities this MSP has created for this customer — global/
// seeded rows are not this MSP's to manage and are deliberately excluded here (they
// remain visible to MSP staff via `msp-rbd.ts`'s existing read-only catalog picker).
router.get(
  "/msp/customers/:customerId/compliance-frameworks",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const tenant = await resolveOwnedTenant(req, res);
      if (!tenant) return;

      const rows = await db
        .select()
        .from(complianceFrameworksTable)
        .where(
          and(
            eq(complianceFrameworksTable.mspId, tenant.mspId),
            eq(complianceFrameworksTable.tenantId, tenant.tenantId),
          ),
        )
        .orderBy(asc(complianceFrameworksTable.sortOrder), asc(complianceFrameworksTable.name));
      res.json(rows);
    } catch (err: unknown) {
      log.error({ err }, "GET /api/msp/customers/:customerId/compliance-frameworks failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

/** Loads a tenant-authored (never global) framework and confirms it belongs to the
 * caller's own resolved (mspId, tenantId) scope. 404s — never a different error — on
 * a global framework or one owned by another tenant/MSP, matching the
 * no-cross-tenant-existence-leak discipline used throughout this file. */
async function resolveOwnedFramework(
  frameworkId: number,
  tenant: TenantScope,
): Promise<typeof complianceFrameworksTable.$inferSelect | null> {
  const [framework] = await db
    .select()
    .from(complianceFrameworksTable)
    .where(eq(complianceFrameworksTable.id, frameworkId))
    .limit(1);
  if (!framework) return null;
  if (framework.mspId !== tenant.mspId || framework.tenantId !== tenant.tenantId) return null;
  return framework;
}

// ── POST /msp/customers/:customerId/compliance-frameworks/:frameworkId/compliance-obligations ──
// Adds a specific obligation/clause under a framework this MSP already authored for
// this same tenant. A global framework, or one authored for a different tenant/MSP,
// 404s identically to a missing one.
router.post(
  "/msp/customers/:customerId/compliance-frameworks/:frameworkId/compliance-obligations",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const tenant = await resolveOwnedTenant(req, res);
      if (!tenant) return;

      const frameworkId = Number(req.params.frameworkId);
      if (!Number.isInteger(frameworkId) || frameworkId <= 0) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "frameworkId must be a positive integer");
        return;
      }
      const framework = await resolveOwnedFramework(frameworkId, tenant);
      if (!framework) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "No such compliance framework for this customer");
        return;
      }

      const parsed = createObligationSchema.safeParse(req.body);
      if (!parsed.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid compliance obligation", parsed.error.flatten());
        return;
      }

      const [row] = await db
        .insert(complianceObligationsTable)
        .values({
          frameworkId: framework.id,
          key: parsed.data.key,
          citation: parsed.data.citation,
          requires: parsed.data.requires,
          active: parsed.data.active ?? true,
          sortOrder: parsed.data.sortOrder ?? 0,
        })
        .returning();

      log.info(
        { customerId: tenant.customerId, mspId: tenant.mspId, frameworkId: framework.id, obligationId: row.id },
        "MSP staff authored a tenant-scoped compliance obligation",
      );
      res.status(201).json(row);
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        apiError(res, 409, ApiErrorCode.CONFLICT, "A compliance obligation with that key already exists");
        return;
      }
      log.error({ err }, "POST .../compliance-obligations failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

// ── GET /msp/customers/:customerId/compliance-frameworks/:frameworkId/compliance-obligations ──
router.get(
  "/msp/customers/:customerId/compliance-frameworks/:frameworkId/compliance-obligations",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const tenant = await resolveOwnedTenant(req, res);
      if (!tenant) return;

      const frameworkId = Number(req.params.frameworkId);
      if (!Number.isInteger(frameworkId) || frameworkId <= 0) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "frameworkId must be a positive integer");
        return;
      }
      const framework = await resolveOwnedFramework(frameworkId, tenant);
      if (!framework) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "No such compliance framework for this customer");
        return;
      }

      const rows = await db
        .select()
        .from(complianceObligationsTable)
        .where(eq(complianceObligationsTable.frameworkId, framework.id))
        .orderBy(asc(complianceObligationsTable.sortOrder), asc(complianceObligationsTable.citation));
      res.json(rows);
    } catch (err: unknown) {
      log.error({ err }, "GET .../compliance-obligations failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

export default router;
