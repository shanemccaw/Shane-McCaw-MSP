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
 *   POST  /api/msp/security-plan/:customerId/draft/freeze           — freeze the assembled
 *                                                                     state to author prose
 *                                                                     against (#1566)
 *   GET   /api/msp/security-plan/:customerId/draft                  — the in-progress draft
 *   PATCH /api/msp/security-plan/:customerId/draft/prose            — edit one prose section
 *   POST  /api/msp/security-plan/:customerId/versions              — seal the frozen draft as
 *                                                                     a new version, superseding
 *                                                                     the current one (#1566)
 *   PATCH /api/msp/security-plan/:customerId/versions/:versionUid/sign — sign a version as a whole
 *
 * MSP-side, matching `msp-rbd-versions.ts` next door — this is the authoring/sealing
 * side. Per #1561 the MSP writes and signs the plan of record FOR a tenant and the
 * customer reads it; the customer-facing read/sign surface is a separate, not-yet-built
 * concern. SCOPE STOP on #1561/#1562/#1566 ends this build at the wire contract — there
 * is no `Design/portal` export and no `artifacts/portal` page to wire it to yet.
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
 *
 * AUTHORING SEQUENCE (#1566) is fixed by the issue, not a choice made here: freeze the
 * assembled state -> write/revise prose against that frozen state -> seal and sign as
 * ONE version. `POST /draft/freeze` chooses scope and captures the frozen snapshot;
 * `PATCH /draft/prose` edits sections against it; `POST /versions` now SEALS THE DRAFT
 * (it no longer re-assembles live or accepts inline prose/scope) and deletes it. A seal
 * attempted with no draft frozen is a 409 — there is nothing fixed to seal yet.
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
  freezeSecurityPlanDraft,
  getSecurityPlanDraft,
  updateSecurityPlanDraftProse,
  deleteSecurityPlanDraft,
} from "../lib/security-plan-draft.ts";
import {
  SECURITY_PLAN_SCOPE_DIMENSIONS,
  SECURITY_PLAN_PROSE_SECTIONS,
  type MspSecurityPlanVersion,
  type MspSecurityPlanDraft,
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
  /** The #1564 bounded-scope statement this version's signature (if any) attaches to —
   * mirrored out of `content.footprint.scope.statement` so a reader/UI can show what a
   * signature covers without parsing `content`. Never empty (see
   * `synthesizeScopeStatement`): the platform does not offer an unqualified "our
   * security posture" claim as a default. */
  readonly scopeStatement: string;
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
    scopeStatement: row.content.footprint.scope.statement,
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt) as string,
    signed: row.signed,
    signedBy: row.signedBy,
    signedAt: iso(row.signedAt),
    isCurrent: row.supersededAt === null,
  };
}

/** The Security Plan's in-progress draft, on the wire (#1566) — the frozen assembled
 * state plus the prose being authored against it. */
interface WireSecurityPlanDraft {
  readonly customerId: number;
  readonly frozenContent: unknown;
  readonly frozenAt: string;
  /** `SecurityPlanProse` — the four sections, each carrying its own
   * `editedInThisVersion` relative to the plan's last version (the carry-forward
   * baseline fixed when this draft was created). */
  readonly prose: unknown;
  readonly updatedAt: string;
}

function toWireDraft(row: MspSecurityPlanDraft): WireSecurityPlanDraft {
  return {
    customerId: row.customerId,
    frozenContent: row.frozenContent,
    frozenAt: iso(row.frozenAt) as string,
    prose: row.prose,
    updatedAt: iso(row.updatedAt) as string,
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

const freezeDraftSchema = z.object({
  /** Optional scope for the frozen assembly (#1563). Absent → the honest, unfiltered view. */
  scope: scopeSchema.optional(),
});

// POST /api/msp/security-plan/:customerId/draft/freeze — #1566 step 1 of the fixed
// authoring sequence: freeze the assembled state now (optionally scoped) so prose can
// be written/revised against a state that will not move underneath the author. The
// first freeze for a plan also seeds the draft's prose by carrying forward the plan's
// current version's prose (#1566: carried forward by default). A later re-freeze
// (e.g. to pick up a source-module edit before sealing) only refreshes the frozen
// snapshot — it never touches the prose already being authored.
router.post(
  "/msp/security-plan/:customerId/draft/freeze",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const tenant = await resolveOwnedTenant(req, res);
      if (!tenant) return;

      const parsed = freezeDraftSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid freeze payload", parsed.error.flatten());
        return;
      }
      const scope: SecurityPlanScope = parsed.data.scope ?? { dimensions: {} };

      const draft = await freezeSecurityPlanDraft(tenant, scope);
      log.info({ mspId: tenant.mspId, customerId: tenant.customerId }, "Security Plan draft frozen");
      res.status(201).json({ draft: toWireDraft(draft) });
    } catch (err: unknown) {
      log.error({ err }, "POST /api/msp/security-plan/:customerId/draft/freeze failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

// GET /api/msp/security-plan/:customerId/draft — the in-progress draft, or 404 if
// nothing has been frozen yet (the caller must POST .../draft/freeze first).
router.get(
  "/msp/security-plan/:customerId/draft",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const tenant = await resolveOwnedTenant(req, res);
      if (!tenant) return;
      const draft = await getSecurityPlanDraft(tenant.mspId, tenant.customerId);
      if (!draft) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "No draft — freeze the assembled state first");
        return;
      }
      res.json({ draft: toWireDraft(draft) });
    } catch (err: unknown) {
      log.error({ err }, "GET /api/msp/security-plan/:customerId/draft failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

const proseEditSchema = z.object({
  section: z.enum(SECURITY_PLAN_PROSE_SECTIONS),
  text: z.string(),
});

// PATCH /api/msp/security-plan/:customerId/draft/prose — #1566 step 2: edit one prose
// section against the frozen state. `editedInThisVersion` is computed server-side by
// diffing against the carry-forward baseline — never accepted from the client.
router.patch(
  "/msp/security-plan/:customerId/draft/prose",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const tenant = await resolveOwnedTenant(req, res);
      if (!tenant) return;
      const parsed = proseEditSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid prose edit payload", parsed.error.flatten());
        return;
      }
      const draft = await updateSecurityPlanDraftProse(tenant.mspId, tenant.customerId, parsed.data.section, parsed.data.text);
      if (!draft) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "No draft — freeze the assembled state first");
        return;
      }
      res.json({ draft: toWireDraft(draft) });
    } catch (err: unknown) {
      log.error({ err }, "PATCH /api/msp/security-plan/:customerId/draft/prose failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

// POST /api/msp/security-plan/:customerId/versions — #1566 step 3: seal the frozen
// draft as a new version — the draft's `frozenContent` (modules/footprint) plus its
// `prose`, combined into ONE `SecurityPlanContent` snapshot — and delete the draft.
// No live re-assembly and no inline scope/prose here: the authoring sequence is fixed
// (freeze -> author prose against that frozen state -> seal), so a seal with no frozen
// draft is a 409, not a fallback to "assemble now."
router.post(
  "/msp/security-plan/:customerId/versions",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const tenant = await resolveOwnedTenant(req, res);
      if (!tenant) return;

      const draft = await getSecurityPlanDraft(tenant.mspId, tenant.customerId);
      if (!draft) {
        apiError(
          res,
          409,
          ApiErrorCode.CONFLICT,
          "No frozen draft to seal — POST .../draft/freeze, then author prose, before sealing (#1566)",
        );
        return;
      }

      // #1563: a scoped seal must state what it covers and what it deliberately does
      // not. Checked against the scope captured at freeze time, not re-derived here.
      if (scopeMissingRequiredStatement(draft.frozenContent.footprint.scope)) {
        apiError(
          res,
          400,
          ApiErrorCode.VALIDATION,
          "A scoped seal must carry a scope statement — what it covers and what it deliberately does not (#1563)",
        );
        return;
      }

      const document = { ...draft.frozenContent, prose: draft.prose };

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

      await deleteSecurityPlanDraft(tenant.mspId, tenant.customerId);

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

      log.info(
        { mspId: tenant.mspId, customerId: tenant.customerId, versionUid, scopeStatement: updated.content.footprint.scope.statement },
        "Security Plan version signed",
      );
      res.json({ version: toWireVersion(updated) });
    } catch (err: unknown) {
      log.error({ err }, "PATCH /api/msp/security-plan/:customerId/versions/:versionUid/sign failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

export default router;
