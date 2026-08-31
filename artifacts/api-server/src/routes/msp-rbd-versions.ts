/**
 * msp-rbd-versions.ts — the RBD document supersession chain's own API (#1508,
 * part of #1487).
 *
 *   GET   /api/msp/rbd/:rbdId/versions          — the full version history
 *   GET   /api/msp/rbd/:rbdId/versions/current   — the current (unsuperseded) version
 *   POST  /api/msp/rbd/:rbdId/versions           — capture a new version, superseding the current one
 *   PATCH /api/msp/rbd/:rbdId/versions/:versionUid/sign — sign a version as a whole
 *   POST  /api/msp/rbd/:rbdId/versions/:versionUid/document — render (or re-render) the
 *                                                    signable document and persist it (#1512)
 *   POST  /api/msp/rbd/:rbdId/versions/:versionUid/share    — generate an unauthenticated
 *                                                    review/sign link for the current,
 *                                                    unsigned version (#1512)
 *   GET   /api/msp/rbd/:rbdId/versions/narrative-audit — #1510's audit trail on
 *                                                    narrative/score drift between versions
 *
 * MSP-side only, matching `msp-rbd.ts` next door — this is the authoring side.
 * There is no customer-portal counterpart in this build: #1512 ("Signed RBD
 * document render and signature capture") is the customer-facing read/sign flow
 * and is a separate, not-yet-built issue. `SCOPE STOP` on #1508 ends this build
 * at the wire contract — no `artifacts/portal` page exists to wire it to yet.
 *
 * `rbdId` is the container identifier `msp_risk_decisions.rbdId` already uses
 * (e.g. "RBD-..."). `POST .../versions` DOES require a `msp_risk_decisions` row
 * to exist for (mspId, rbdId) as of #1510 — capturing a version derives its
 * scope/narrative snapshot from that row and from `risk_instances`, so there is
 * no longer a "container-less" version to capture; every other route here still
 * addresses a version purely by `rbdId`/`versionUid` with no container lookup.
 * The transaction mechanics (supersede-then-insert, sign-only-the-current-
 * unsigned-version, the #1510 scope diff) live in `../lib/rbd-versioning.ts` so
 * later issues that attach to this chain (#1509–#1512) reuse it rather than
 * re-implementing it.
 *
 * Auth: `requireRole("MSPOperator")` to capture a version (same floor as
 * `POST /api/msp/rbd`); `requireRole("MSPAdmin")` to sign one (same floor as
 * `PATCH /api/msp/rbd/:rbdId/sign`) — capturing a draft and signing it off are
 * different levels of authority on the MSP side, matching the existing pattern
 * exactly. Scoped by `resolveMspIdStrict`, never taken from the request body.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth, requireRole } from "../middlewares/requireAuth.ts";
import { resolveMspIdStrict } from "../lib/resolve-msp-id.ts";
import { apiError, ApiErrorCode } from "../lib/api-helpers.ts";
import { logger } from "../lib/logger.ts";
import {
  createRbdVersion,
  getCurrentRbdVersion,
  getRbdVersionByUid,
  listRbdVersions,
  signRbdVersion,
  generateRbdShareLink,
  listRbdNarrativeAudit,
} from "../lib/rbd-versioning.ts";
import { listRiskInstancesByRbdId } from "../lib/rbd-instances.ts";
import { renderAndPersistRbdVersionDocument } from "../lib/rbd-document-render.ts";
import { db, mspRiskDecisionsTable, type MspRbdVersion, type MspRbdNarrativeAudit, type RbdNarrativeSnapshot } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

/** One captured version of an RBD document, on the wire. */
interface WireRbdVersion {
  readonly versionUid: string;
  readonly rbdId: string;
  readonly versionNumber: number;
  readonly content: unknown;
  readonly createdBy: unknown;
  readonly createdAt: string;
  readonly signed: boolean;
  readonly signedBy: unknown;
  readonly signedAt: string | null;
  /** True for exactly one version per (mspId, rbdId): the current one. */
  readonly isCurrent: boolean;
  /** #1510 — the derived instance scope this version accepts, and the diff
   * against the version it superseded. */
  readonly scopeInstanceIds: number[];
  readonly scopeAddedInstanceIds: number[];
  readonly scopeRemovedInstanceIds: number[];
  /** #1510 — true if this version's scope contained an addition (or it was
   * the first version ever); false if a subtraction-only/unchanged scope let
   * it inherit the prior signature instead. */
  readonly requiresSignature: boolean;
  /** #1510 — true if `signed`/`signedBy`/`signedAt` above were copied
   * forward from the superseded version rather than captured fresh here. */
  readonly signatureInherited: boolean;
  readonly signatureInheritedFromVersionUid: string | null;
  /** #1510 — the narrative/score snapshot captured with this version. */
  readonly narrativeSnapshot: unknown;
}

function iso(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null;
}

function toWireVersion(row: MspRbdVersion): WireRbdVersion {
  return {
    versionUid: row.versionUid,
    rbdId: row.rbdId,
    versionNumber: row.versionNumber,
    content: row.content,
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt) as string,
    signed: row.signed,
    signedBy: row.signedBy,
    signedAt: iso(row.signedAt),
    isCurrent: row.supersededAt === null,
    scopeInstanceIds: row.scopeInstanceIds,
    scopeAddedInstanceIds: row.scopeAddedInstanceIds,
    scopeRemovedInstanceIds: row.scopeRemovedInstanceIds,
    requiresSignature: row.requiresSignature,
    signatureInherited: row.signatureInherited,
    signatureInheritedFromVersionUid: row.signatureInheritedFromVersionUid,
    narrativeSnapshot: row.narrativeSnapshot,
  };
}

/** #1510 — one narrative/score audit row, on the wire. */
interface WireRbdNarrativeAudit {
  readonly fromVersionUid: string | null;
  readonly toVersionUid: string;
  readonly changedFields: unknown;
  readonly createdAt: string;
}

function toWireNarrativeAudit(row: MspRbdNarrativeAudit): WireRbdNarrativeAudit {
  return {
    fromVersionUid: row.fromVersionUid,
    toVersionUid: row.toVersionUid,
    changedFields: row.changedFields,
    createdAt: iso(row.createdAt) as string,
  };
}

const createVersionSchema = z.object({
  tenantId: z.string().min(1),
  tenantName: z.string().min(1),
  /** Full, self-contained document snapshot. Untyped on purpose — see
   * `msp_rbd_versions`'s schema header; #1509 has not yet formalized the shape. */
  content: z.unknown(),
});

// GET /api/msp/rbd/:rbdId/versions — full supersession chain, newest first.
router.get(
  "/msp/rbd/:rbdId/versions",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "MSP context required");
        return;
      }
      const rbdId = String(req.params.rbdId);
      const rows = await listRbdVersions(mspId, rbdId);
      res.json({ rbdId, versions: rows.map(toWireVersion) });
    } catch (err: unknown) {
      log.error({ err }, "GET /api/msp/rbd/:rbdId/versions failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

// GET /api/msp/rbd/:rbdId/versions/current — the current version, or 404 if
// nothing has ever been captured for this container.
router.get(
  "/msp/rbd/:rbdId/versions/current",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "MSP context required");
        return;
      }
      const rbdId = String(req.params.rbdId);
      const row = await getCurrentRbdVersion(mspId, rbdId);
      if (!row) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "No version has been captured for this RBD");
        return;
      }
      res.json({ version: toWireVersion(row) });
    } catch (err: unknown) {
      log.error({ err }, "GET /api/msp/rbd/:rbdId/versions/current failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

/**
 * #1510 — the scope/narrative inputs `createRbdVersion`'s diff runs on, derived
 * from the LIVE `risk_instances` and `msp_risk_decisions` rows rather than
 * anything the client sends. This is what makes the addition/subtraction
 * distinction undgameable: a caller can change the real scope only by actually
 * adding/accepting/resolving line items through `msp-rbd-instances.ts`'s own
 * routes, never by shaping this request's body. Returns null (and writes the
 * response) if the container row doesn't exist for (mspId, rbdId).
 */
async function deriveScopeAndNarrative(
  mspId: number,
  rbdId: string,
  res: Response,
): Promise<{ scopeInstanceIds: number[]; narrativeSnapshot: RbdNarrativeSnapshot } | null> {
  const [container] = await db
    .select({
      hazardDescription: mspRiskDecisionsTable.hazardDescription,
      compensatingControls: mspRiskDecisionsTable.compensatingControls,
      residualRiskScore: mspRiskDecisionsTable.residualRiskScore,
      residualRiskLevel: mspRiskDecisionsTable.residualRiskLevel,
    })
    .from(mspRiskDecisionsTable)
    .where(and(eq(mspRiskDecisionsTable.rbdId, rbdId), eq(mspRiskDecisionsTable.mspId, mspId)))
    .limit(1);
  if (!container) {
    apiError(res, 404, ApiErrorCode.NOT_FOUND, "Risk-Based Decision not found");
    return null;
  }

  const instances = await listRiskInstancesByRbdId(mspId, rbdId);
  const scopeInstanceIds = instances.filter((i) => i.status === "active").map((i) => i.id);

  return {
    scopeInstanceIds,
    narrativeSnapshot: {
      hazardDescription: container.hazardDescription,
      compensatingControls: container.compensatingControls,
      residualRiskScore: container.residualRiskScore,
      residualRiskLevel: container.residualRiskLevel,
    },
  };
}

// POST /api/msp/rbd/:rbdId/versions — capture a new version, superseding
// whatever was current. Always succeeds (version 1 if none existed yet).
// #1510: the scope/narrative diff and the signature-required-vs-inherited
// derivation run inside `createRbdVersion` itself, against
// `scopeInstanceIds`/`narrativeSnapshot` derived here from the live
// `risk_instances`/`msp_risk_decisions` rows — never from this request's body.
router.post(
  "/msp/rbd/:rbdId/versions",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "MSP context required");
        return;
      }
      const rbdId = String(req.params.rbdId);
      const parsed = createVersionSchema.safeParse(req.body);
      if (!parsed.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid version payload", parsed.error.flatten());
        return;
      }

      const derived = await deriveScopeAndNarrative(mspId, rbdId, res);
      if (derived === null) return;

      const userEmail = req.user?.email || "unknown@mspplatform.com";
      const userName = req.user?.name || "MSP Assessor";
      const nowUtc = new Date().toISOString().substring(0, 19).replace("T", " ") + " UTC";

      const created = await createRbdVersion({
        mspId,
        rbdId,
        tenantId: parsed.data.tenantId,
        tenantName: parsed.data.tenantName,
        content: parsed.data.content ?? null,
        createdBy: { name: userName, upn: userEmail, timestamp: nowUtc },
        scopeInstanceIds: derived.scopeInstanceIds,
        narrativeSnapshot: derived.narrativeSnapshot,
      });

      log.info(
        {
          mspId,
          rbdId,
          versionNumber: created.versionNumber,
          requiresSignature: created.requiresSignature,
          signatureInherited: created.signatureInherited,
          added: created.scopeAddedInstanceIds.length,
          removed: created.scopeRemovedInstanceIds.length,
        },
        "RBD version captured",
      );
      res.status(201).json({ version: toWireVersion(created) });
    } catch (err: unknown) {
      log.error({ err }, "POST /api/msp/rbd/:rbdId/versions failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

// GET /api/msp/rbd/:rbdId/versions/narrative-audit — #1510's audit trail on
// narrative/score drift (hazard text, compensating controls, residual score)
// across the version chain — the interim answer for the case that
// deliberately requires no signature.
router.get(
  "/msp/rbd/:rbdId/versions/narrative-audit",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "MSP context required");
        return;
      }
      const rbdId = String(req.params.rbdId);
      const rows = await listRbdNarrativeAudit(mspId, rbdId);
      res.json({ rbdId, audit: rows.map(toWireNarrativeAudit) });
    } catch (err: unknown) {
      log.error({ err }, "GET /api/msp/rbd/:rbdId/versions/narrative-audit failed");
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
  /** #1512 — optional: an MSP operator recording an off-platform signature
   * (e.g. a scanned wet-signature page) may attach the image. The
   * customer-self-service path (`portal-rbd-document.ts`) always sends one;
   * this MSP-side path is the exception, hence optional here. */
  signatureData: z.string().optional(),
});

// PATCH /api/msp/rbd/:rbdId/versions/:versionUid/sign — sign the current
// version as a whole. Only the current, unsigned version may be signed.
router.patch(
  "/msp/rbd/:rbdId/versions/:versionUid/sign",
  requireAuth,
  requireRole("MSPAdmin"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "MSP context required");
        return;
      }
      const rbdId = String(req.params.rbdId);
      const versionUid = String(req.params.versionUid);
      const parsed = signVersionSchema.safeParse(req.body);
      if (!parsed.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid signature data", parsed.error.flatten());
        return;
      }

      const signedAtIso = new Date().toISOString().substring(0, 19).replace("T", " ") + " UTC";
      const updated = await signRbdVersion(
        mspId,
        rbdId,
        versionUid,
        {
          name: parsed.data.name,
          title: parsed.data.title,
          email: parsed.data.email,
          signedAt: signedAtIso,
          ipAddress: parsed.data.ipAddress,
          signatureHash: parsed.data.signatureHash,
        },
        parsed.data.signatureData ?? null,
      );

      if (!updated) {
        apiError(
          res,
          409,
          ApiErrorCode.CONFLICT,
          "Version not found, not current, or already signed",
        );
        return;
      }

      log.info({ mspId, rbdId, versionUid }, "RBD version signed");
      res.json({ version: toWireVersion(updated) });
    } catch (err: unknown) {
      log.error({ err }, "PATCH /api/msp/rbd/:rbdId/versions/:versionUid/sign failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

/** One rendered document, on the wire (#1512). */
interface WireRbdDocument {
  readonly runId: string;
  readonly htmlContent: string;
  readonly pdfBase64: string;
  readonly pdfSizeBytes: number;
  readonly generatedAt: string;
}

// POST /api/msp/rbd/:rbdId/versions/:versionUid/document — render (or
// re-render) the version as a signable document and persist it via
// msp_report_runs (#1512). Any existing version — current, superseded,
// signed or not — may be rendered; the document is a pure function of the
// version's own stored columns.
router.post(
  "/msp/rbd/:rbdId/versions/:versionUid/document",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "MSP context required");
        return;
      }
      const rbdId = String(req.params.rbdId);
      const versionUid = String(req.params.versionUid);

      const version = await getRbdVersionByUid(mspId, rbdId, versionUid);
      if (!version) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "Version not found");
        return;
      }

      const userId = typeof req.user?.id === "number" ? req.user.id : null;
      if (userId === null) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "Authenticated MSP user required");
        return;
      }

      const run = await renderAndPersistRbdVersionDocument(version, userId);
      const wire: WireRbdDocument = run;
      log.info({ mspId, rbdId, versionUid, runId: run.runId }, "RBD version document rendered");
      res.json({ document: wire });
    } catch (err: unknown) {
      log.error({ err }, "POST /api/msp/rbd/:rbdId/versions/:versionUid/document failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

// POST /api/msp/rbd/:rbdId/versions/:versionUid/share — generate an
// unauthenticated review/sign link for the current, unsigned version
// (#1512). Same shape as msp_sows' own share-token flow.
router.post(
  "/msp/rbd/:rbdId/versions/:versionUid/share",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "MSP context required");
        return;
      }
      const rbdId = String(req.params.rbdId);
      const versionUid = String(req.params.versionUid);

      const updated = await generateRbdShareLink(mspId, rbdId, versionUid);
      if (!updated) {
        apiError(res, 409, ApiErrorCode.CONFLICT, "Version not found, not current, or already signed");
        return;
      }

      log.info({ mspId, rbdId, versionUid }, "RBD version share link generated");
      res.json({ shareToken: updated.shareToken, shareTokenExpiresAt: updated.shareTokenExpiresAt?.toISOString() ?? null });
    } catch (err: unknown) {
      log.error({ err }, "POST /api/msp/rbd/:rbdId/versions/:versionUid/share failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

export default router;
