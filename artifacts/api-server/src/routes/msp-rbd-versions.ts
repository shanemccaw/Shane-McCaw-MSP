/**
 * msp-rbd-versions.ts — the RBD document supersession chain's own API (#1508,
 * part of #1487).
 *
 *   GET   /api/msp/rbd/:rbdId/versions          — the full version history
 *   GET   /api/msp/rbd/:rbdId/versions/current   — the current (unsuperseded) version
 *   POST  /api/msp/rbd/:rbdId/versions           — capture a new version, superseding the current one
 *   PATCH /api/msp/rbd/:rbdId/versions/:versionUid/sign — sign a version as a whole
 *
 * MSP-side only, matching `msp-rbd.ts` next door — this is the authoring side.
 * There is no customer-portal counterpart in this build: #1512 ("Signed RBD
 * document render and signature capture") is the customer-facing read/sign flow
 * and is a separate, not-yet-built issue. `SCOPE STOP` on #1508 ends this build
 * at the wire contract — no `artifacts/portal` page exists to wire it to yet.
 *
 * `rbdId` is the container identifier `msp_risk_decisions.rbdId` already uses
 * (e.g. "RBD-..."). This route does not validate that a `msp_risk_decisions` row
 * with that id exists — #1509 has not yet formalized the container/line-item
 * relationship, so a version can legitimately be captured for a container that
 * predates any line-item table. The transaction mechanics (supersede-then-insert,
 * sign-only-the-current-unsigned-version) live in `../lib/rbd-versioning.ts` so
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
  listRbdVersions,
  signRbdVersion,
} from "../lib/rbd-versioning.ts";
import type { MspRbdVersion } from "@workspace/db";
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

// POST /api/msp/rbd/:rbdId/versions — capture a new version, superseding
// whatever was current. Always succeeds (version 1 if none existed yet); there
// is no "nothing changed" short-circuit here because #1510 (signature required
// only on scope EXPANSION, derived by diffing instance sets) is a separate,
// not-yet-built issue this route deliberately does not anticipate.
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
      });

      log.info({ mspId, rbdId, versionNumber: created.versionNumber }, "RBD version captured");
      res.status(201).json({ version: toWireVersion(created) });
    } catch (err: unknown) {
      log.error({ err }, "POST /api/msp/rbd/:rbdId/versions failed");
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
      const updated = await signRbdVersion(mspId, rbdId, versionUid, {
        name: parsed.data.name,
        title: parsed.data.title,
        email: parsed.data.email,
        signedAt: signedAtIso,
        ipAddress: parsed.data.ipAddress,
        signatureHash: parsed.data.signatureHash,
      });

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

export default router;
