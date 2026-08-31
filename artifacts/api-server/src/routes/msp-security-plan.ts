/**
 * msp-security-plan.ts — the Security Plan assembled view + its seal/supersession
 * chain (#1561, part of #1495/#1485).
 *
 *   GET   /api/msp/security-plan/:customerId/assembled              — the live, honest
 *                                                                     assembled view over
 *                                                                     the eight modules
 *   GET   /api/msp/security-plan/:customerId/drift                  — the live view's
 *                                                                     drift from the LAST
 *                                                                     SIGNED version (#1562)
 *   GET   /api/msp/security-plan/:customerId/versions              — the full seal chain
 *   GET   /api/msp/security-plan/:customerId/versions/current       — the current sealed version
 *   POST  /api/msp/security-plan/:customerId/versions              — seal a new version,
 *                                                                     superseding the current one
 *   PATCH /api/msp/security-plan/:customerId/versions/:versionUid/sign — sign a version as a whole
 *
 * MSP-side, matching `msp-rbd-versions.ts` next door — this is the authoring/sealing
 * side. Per #1561 the MSP writes and signs the plan of record FOR a tenant and the
 * customer reads it; the customer-facing read/sign surface is a separate, not-yet-built
 * concern. SCOPE STOP on #1561/#1562 ends this build at the wire contract — there is no
 * `Design/portal` export and no `artifacts/portal` page to wire it to yet.
 *
 * #1562 settles the "cumulative vs live" tension: a version is assembled, frozen and
 * signed at a point in time; the live view sits ALONGSIDE it, showing drift from the
 * last signed version, rather than the document silently re-rendering out from under a
 * prior signature. `/drift` is that companion view — see `security-plan-drift.ts`.
 *
 * `:customerId` is a `tenants.id`. `resolveTenantScope` resolves it to the
 * `(mspId, tenantId)` pair the MSP-era source tables need AND carries the mspId used to
 * verify the plan belongs to the session's MSP — a plan is never assembled for a tenant
 * the caller's MSP does not own. Scoping is `resolveMspIdStrict`, never from the body.
 *
 * SCOPE (#1563) is expressed only as DIMENSIONS (control family = `pillar`, and
 * `framework`) — there is deliberately no query or body field here that can express an
 * OUTCOME filter (severity, accepted/open, pass/fail). FOOTPRINT (#1565): the assembly
 * always attaches a filter footprint, and sealing snapshots it into the version so it
 * cannot be suppressed by a UI.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth, requireRole } from "../middlewares/requireAuth.ts";
import { resolveMspIdStrict } from "../lib/resolve-msp-id.ts";
import { resolveTenantScope, type TenantScope } from "../lib/portal-customer-scope.ts";
import { apiError, ApiErrorCode } from "../lib/api-helpers.ts";
import { logger } from "../lib/logger.ts";
import { assembleSecurityPlan, scopeMissingRequiredStatement } from "../lib/security-plan-assembly.ts";
import { getSecurityPlanDrift } from "../lib/security-plan-drift.ts";
import {
  createSecurityPlanVersion,
  getCurrentSecurityPlanVersion,
  listSecurityPlanVersions,
  signSecurityPlanVersion,
} from "../lib/security-plan-versioning.ts";
import {
  SECURITY_PLAN_SCOPE_DIMENSIONS,
  type MspSecurityPlanVersion,
  type SecurityPlanScope,
  type SecurityPlanScopeDimension,
} from "@workspace/db";
import { z } from "zod";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

/** One sealed version of a Security Plan, on the wire. */
interface WireSecurityPlanVersion {
  readonly versionUid: string;
  readonly customerId: number;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly versionNumber: number;
  readonly content: unknown;
  readonly createdBy: unknown;
  readonly createdAt: string;
  readonly signed: boolean;
  readonly signedBy: unknown;
  readonly signedAt: string | null;
  /** True for exactly one version per (mspId, customerId): the current one. */
  readonly isCurrent: boolean;
}

function iso(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null;
}

function toWireVersion(row: MspSecurityPlanVersion): WireSecurityPlanVersion {
  return {
    versionUid: row.versionUid,
    customerId: row.customerId,
    tenantId: row.tenantId,
    tenantName: row.tenantName,
    versionNumber: row.versionNumber,
    content: row.content,
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt) as string,
    signed: row.signed,
    signedBy: row.signedBy,
    signedAt: iso(row.signedAt),
    isCurrent: row.supersededAt === null,
  };
}

/** The scope shape accepted on the wire. Keyed ONLY on the real dimension names
 * (#1563) — a client cannot express an outcome filter because no outcome key exists. */
const scopeSchema = z.object({
  dimensions: z
    .object({
      pillar: z.array(z.string().min(1)).optional(),
      framework: z.array(z.string().min(1)).optional(),
    })
    .default({}),
  statement: z.string().optional(),
});

/** Parses `scope` from query params: `?pillar=a,b&framework=c&statement=...`. Only the
 * two dimension keys are read; any other query key (e.g. an attempted `severity=`) is
 * ignored, which is what structurally keeps scope to dimensions, not outcomes (#1563). */
function scopeFromQuery(req: Request): SecurityPlanScope {
  const dimensions: Partial<Record<SecurityPlanScopeDimension, string[]>> = {};
  for (const dim of SECURITY_PLAN_SCOPE_DIMENSIONS) {
    const raw = req.query[dim];
    if (typeof raw === "string" && raw.trim().length) {
      const values = raw.split(",").map((v) => v.trim()).filter(Boolean);
      if (values.length) dimensions[dim] = values;
    }
  }
  const statement = typeof req.query.statement === "string" ? req.query.statement : undefined;
  return { dimensions, statement };
}

/** Resolves `:customerId`, verifies it belongs to the session's MSP, and returns the
 * tenant scope. Writes the appropriate error and returns null on any failure. */
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

// GET /api/msp/security-plan/:customerId/assembled — the live, honest assembled view.
router.get(
  "/msp/security-plan/:customerId/assembled",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const tenant = await resolveOwnedTenant(req, res);
      if (!tenant) return;
      const scope = scopeFromQuery(req);
      const document = await assembleSecurityPlan(tenant, scope);
      res.json({ document });
    } catch (err: unknown) {
      log.error({ err }, "GET /api/msp/security-plan/:customerId/assembled failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

// GET /api/msp/security-plan/:customerId/drift — the live (honest, unscoped) view
// alongside its drift from the last SIGNED version (#1562). Always the honest view on
// the live side, regardless of any scope query params: drift answers "what actually
// changed since the signature," not "what changed within whatever slice was asked for."
router.get(
  "/msp/security-plan/:customerId/drift",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const tenant = await resolveOwnedTenant(req, res);
      if (!tenant) return;
      const { live, drift } = await getSecurityPlanDrift(tenant);
      res.json({ document: live, drift });
    } catch (err: unknown) {
      log.error({ err }, "GET /api/msp/security-plan/:customerId/drift failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

// GET /api/msp/security-plan/:customerId/versions — full seal chain, newest first.
router.get(
  "/msp/security-plan/:customerId/versions",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const tenant = await resolveOwnedTenant(req, res);
      if (!tenant) return;
      const rows = await listSecurityPlanVersions(tenant.mspId, tenant.customerId);
      res.json({ customerId: tenant.customerId, versions: rows.map(toWireVersion) });
    } catch (err: unknown) {
      log.error({ err }, "GET /api/msp/security-plan/:customerId/versions failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

// GET /api/msp/security-plan/:customerId/versions/current — current sealed version,
// or 404 if nothing has ever been sealed for this tenant.
router.get(
  "/msp/security-plan/:customerId/versions/current",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const tenant = await resolveOwnedTenant(req, res);
      if (!tenant) return;
      const row = await getCurrentSecurityPlanVersion(tenant.mspId, tenant.customerId);
      if (!row) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "No version has been sealed for this Security Plan");
        return;
      }
      res.json({ version: toWireVersion(row) });
    } catch (err: unknown) {
      log.error({ err }, "GET /api/msp/security-plan/:customerId/versions/current failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

const sealVersionSchema = z.object({
  /** Optional scope for a scoped seal (#1563). Absent → the honest, unfiltered view. */
  scope: scopeSchema.optional(),
  /** Authored narrative owned by this module (#1561), sealed verbatim into the snapshot. */
  prose: z.string().nullable().optional(),
});

// POST /api/msp/security-plan/:customerId/versions — seal a new version. Assembles the
// document NOW (optionally scoped), snapshots it whole (incl. the #1565 footprint), and
// supersedes whatever was current. There is no "nothing changed" short-circuit.
router.post(
  "/msp/security-plan/:customerId/versions",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const tenant = await resolveOwnedTenant(req, res);
      if (!tenant) return;

      const parsed = sealVersionSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid seal payload", parsed.error.flatten());
        return;
      }
      const scope: SecurityPlanScope = parsed.data.scope ?? { dimensions: {} };
      const prose = parsed.data.prose ?? null;

      // #1563: a scoped seal becomes a document someone can be handed — it must state
      // what it covers and what it deliberately does not, not just carry the #1565
      // exclusion counts. The honest (unscoped) seal needs no statement.
      if (scopeMissingRequiredStatement(scope)) {
        apiError(
          res,
          400,
          ApiErrorCode.VALIDATION,
          "A scoped seal must carry a scope statement — what it covers and what it deliberately does not (#1563)",
        );
        return;
      }

      const document = await assembleSecurityPlan(tenant, scope, prose);

      const userEmail = req.user?.email || "unknown@mspplatform.com";
      const userName = req.user?.name || "MSP Assessor";
      const nowUtc = new Date().toISOString().substring(0, 19).replace("T", " ") + " UTC";

      const created = await createSecurityPlanVersion({
        mspId: tenant.mspId,
        customerId: tenant.customerId,
        tenantId: tenant.tenantId,
        tenantName: tenant.tenantName,
        content: document,
        createdBy: { name: userName, upn: userEmail, timestamp: nowUtc },
      });

      log.info(
        { mspId: tenant.mspId, customerId: tenant.customerId, versionNumber: created.versionNumber, totalExcluded: document.footprint.totalExcluded },
        "Security Plan version sealed",
      );
      res.status(201).json({ version: toWireVersion(created) });
    } catch (err: unknown) {
      log.error({ err }, "POST /api/msp/security-plan/:customerId/versions failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

const signVersionSchema = z.object({
  name: z.string().min(1),
  title: z.string(),
  email: z.string(),
  ipAddress: z.string(),
  signatureHash: z.string(),
});

// PATCH /api/msp/security-plan/:customerId/versions/:versionUid/sign — sign the current
// version as a whole. Only the current, unsigned version may be signed.
router.patch(
  "/msp/security-plan/:customerId/versions/:versionUid/sign",
  requireAuth,
  requireRole("MSPAdmin"),
  async (req: Request, res: Response) => {
    try {
      const tenant = await resolveOwnedTenant(req, res);
      if (!tenant) return;
      const versionUid = String(req.params.versionUid);
      const parsed = signVersionSchema.safeParse(req.body);
      if (!parsed.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid signature data", parsed.error.flatten());
        return;
      }

      const signedAtIso = new Date().toISOString().substring(0, 19).replace("T", " ") + " UTC";
      const updated = await signSecurityPlanVersion(tenant.mspId, tenant.customerId, versionUid, {
        name: parsed.data.name,
        title: parsed.data.title,
        email: parsed.data.email,
        signedAt: signedAtIso,
        ipAddress: parsed.data.ipAddress,
        signatureHash: parsed.data.signatureHash,
      });

      if (!updated) {
        apiError(res, 409, ApiErrorCode.CONFLICT, "Version not found, not current, or already signed");
        return;
      }

      log.info({ mspId: tenant.mspId, customerId: tenant.customerId, versionUid }, "Security Plan version signed");
      res.json({ version: toWireVersion(updated) });
    } catch (err: unknown) {
      log.error({ err }, "PATCH /api/msp/security-plan/:customerId/versions/:versionUid/sign failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

export default router;
