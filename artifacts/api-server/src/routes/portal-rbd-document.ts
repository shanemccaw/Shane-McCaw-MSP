/**
 * portal-rbd-document.ts — the CUSTOMER-facing signed RBD document read +
 * whole-document signature capture (#1512, part of #1487).
 *
 *   GET  /api/portal/risk-register/rbd/:rbdId/versions             — this
 *        container's version history, scoped to the caller's own tenant
 *   GET  /api/portal/risk-register/rbd/:rbdId/versions/current      — the
 *        current (unsuperseded) version
 *   GET  /api/portal/risk-register/rbd/:rbdId/versions/:versionUid/document
 *        — the already-rendered document for that version
 *   POST /api/portal/risk-register/rbd/:rbdId/versions/:versionUid/sign
 *        — the customer signs the WHOLE document as one act
 *
 * ── Distinct from `portal-risk-register.ts`'s existing accept flow ─────────
 * That route (`POST /portal/risk-register/:rbdId/accept`) signs one LINE
 * ITEM (a single `msp_risk_decisions` row) with a typed name + checkbox. This
 * module signs the whole VERSIONED DOCUMENT #1508 captures — the "hand
 * someone a single page: this is what was agreed, signed here, on this date"
 * artifact the settled architecture describes. Both can coexist during the
 * #1509 transition; this is the new one #1512 asks for.
 *
 * ── Read-only for rendering ─────────────────────────────────────────────
 * This module never renders a document itself — only
 * `POST /api/msp/rbd/:rbdId/versions/:versionUid/document` (MSP-side,
 * `msp-rbd-versions.ts`) does that, because writing an
 * `msp_report_definitions` row needs a real MSP staff `createdByUserId`. A
 * customer reading before the MSP has ever rendered gets a clear 404, not a
 * render triggered under their own session and mis-attributed.
 *
 * ── Scoping is the same pair of predicates as `portal-risk-register.ts` ────
 * `msp_rbd_versions.tenantId` is free text (an M365 tenant identifier), no FK
 * to `tenants`. `resolveTenantScope` resolves the JWT's `customerId` to
 * `(mspId, tenantId)` and fails closed on anything missing — see that
 * module's own header for why both predicates are required, not just one.
 *
 * ── Role floor: `CustomerUser` ──────────────────────────────────────────
 * Same reasoning as `portal-risk-register.ts`: this is a signature surface
 * that transfers liability, so it sits at the higher floor, not the
 * `Assessment` floor the lower-stakes customer routes use.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import { z } from "zod";

import { requireRole } from "../middlewares/requireAuth";
import { resolveCustomerId, resolveTenantScope } from "../lib/portal-customer-scope";
import { apiError, ApiErrorCode } from "../lib/api-helpers";
import { logger } from "../lib/logger";
import {
  getCurrentRbdVersion,
  getRbdVersionByUid,
  listRbdVersions,
  signRbdVersion,
} from "../lib/rbd-versioning.ts";
import { getPersistedRbdVersionDocument } from "../lib/rbd-document-render.ts";
import type { ClientApprover, MspRbdVersion } from "@workspace/db";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

interface WireRbdVersionSummary {
  readonly versionUid: string;
  readonly rbdId: string;
  readonly versionNumber: number;
  readonly createdAt: string;
  readonly signed: boolean;
  readonly signedAt: string | null;
  readonly isCurrent: boolean;
  /** #1510 — true if this version's scope contains an addition the customer
   * has not yet signed off on (or it's the first version ever); false means
   * this version only dropped items from what was already signed, and the
   * prior signature carries forward automatically. */
  readonly requiresSignature: boolean;
  /** #1510 — true if `signed`/`signedAt` above were inherited from the prior
   * signed version rather than captured fresh on this one. */
  readonly signatureInherited: boolean;
}

function iso(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null;
}

function toWireSummary(row: MspRbdVersion): WireRbdVersionSummary {
  return {
    versionUid: row.versionUid,
    rbdId: row.rbdId,
    versionNumber: row.versionNumber,
    createdAt: iso(row.createdAt) as string,
    signed: row.signed,
    signedAt: iso(row.signedAt),
    isCurrent: row.supersededAt === null,
    requiresSignature: row.requiresSignature,
    signatureInherited: row.signatureInherited,
  };
}

/** Resolves the caller's tenant scope, or writes a 403 and returns null. Unlike
 * `portal-risk-register.ts`'s `scopeOrEmpty`, an unresolvable scope here is a
 * real 403 rather than an empty 200 — there is no "list" shape to empty out;
 * every route below acts on one specific container. */
async function requireScope(req: Request, res: Response) {
  const customerId = resolveCustomerId(req);
  if (customerId === null) {
    apiError(res, 403, ApiErrorCode.FORBIDDEN, "Customer context required");
    return null;
  }
  const scope = await resolveTenantScope(customerId);
  if (!scope) {
    apiError(res, 403, ApiErrorCode.FORBIDDEN, "Customer context required");
    return null;
  }
  return scope;
}

/** True iff `version` genuinely belongs to the caller's own tenant — the real
 * authorization check every route below performs before returning anything. */
function versionInScope(version: MspRbdVersion, scope: { mspId: number; tenantId: string }): boolean {
  return version.mspId === scope.mspId && version.tenantId === scope.tenantId;
}

// GET /api/portal/risk-register/rbd/:rbdId/versions — full history, scoped.
router.get(
  "/portal/risk-register/rbd/:rbdId/versions",
  requireRole("CustomerUser"),
  async (req: Request, res: Response) => {
    try {
      const scope = await requireScope(req, res);
      if (!scope) return;
      const rbdId = String(req.params.rbdId);

      const rows = await listRbdVersions(scope.mspId, rbdId);
      const scoped = rows.filter((r) => versionInScope(r, scope));
      res.json({ rbdId, versions: scoped.map(toWireSummary) });
    } catch (err: unknown) {
      log.error({ err }, "GET /portal/risk-register/rbd/:rbdId/versions failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

// GET /api/portal/risk-register/rbd/:rbdId/versions/current
router.get(
  "/portal/risk-register/rbd/:rbdId/versions/current",
  requireRole("CustomerUser"),
  async (req: Request, res: Response) => {
    try {
      const scope = await requireScope(req, res);
      if (!scope) return;
      const rbdId = String(req.params.rbdId);

      const version = await getCurrentRbdVersion(scope.mspId, rbdId);
      if (!version || !versionInScope(version, scope)) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "No version has been captured for this RBD");
        return;
      }
      res.json({ version: toWireSummary(version) });
    } catch (err: unknown) {
      log.error({ err }, "GET /portal/risk-register/rbd/:rbdId/versions/current failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

// GET /api/portal/risk-register/rbd/:rbdId/versions/:versionUid/document —
// the already-rendered document. Never renders on demand (see header).
router.get(
  "/portal/risk-register/rbd/:rbdId/versions/:versionUid/document",
  requireRole("CustomerUser"),
  async (req: Request, res: Response) => {
    try {
      const scope = await requireScope(req, res);
      if (!scope) return;
      const rbdId = String(req.params.rbdId);
      const versionUid = String(req.params.versionUid);

      const version = await getRbdVersionByUid(scope.mspId, rbdId, versionUid);
      if (!version || !versionInScope(version, scope)) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "Version not found");
        return;
      }

      const doc = await getPersistedRbdVersionDocument(versionUid);
      if (!doc) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "This document has not been prepared yet");
        return;
      }
      res.json({ document: doc });
    } catch (err: unknown) {
      log.error({ err }, "GET /portal/risk-register/rbd/:rbdId/versions/:versionUid/document failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

/**
 * The customer's whole-document signature. `signatureData` is the drawn
 * signature (base64 PNG), required — this is the SOW-flow parity #1512
 * exists to add; `msp-rbd-versions.ts`'s MSP-side sign endpoint is the only
 * place it stays optional (an off-platform recording).
 */
const signDocumentSchema = z.object({
  signerName: z.string().trim().min(2, "Type your full name to sign this document").max(200),
  signerTitle: z.string().trim().max(200).optional(),
  signatureData: z.string().min(10, "A drawn signature is required"),
});

router.post(
  "/portal/risk-register/rbd/:rbdId/versions/:versionUid/sign",
  requireRole("CustomerUser"),
  async (req: Request, res: Response) => {
    try {
      const scope = await requireScope(req, res);
      if (!scope) return;
      const rbdId = String(req.params.rbdId);
      const versionUid = String(req.params.versionUid);

      const parsed = signDocumentSchema.safeParse(req.body);
      if (!parsed.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid signature", parsed.error.flatten());
        return;
      }

      // Scoped read first, same reasoning as portal-risk-register.ts's
      // accept route: a version belonging to another tenant 404s exactly
      // like one that does not exist.
      const version = await getRbdVersionByUid(scope.mspId, rbdId, versionUid);
      if (!version || !versionInScope(version, scope)) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "Version not found");
        return;
      }
      if (version.supersededAt !== null) {
        apiError(res, 409, ApiErrorCode.CONFLICT, "This version has been superseded and can no longer be signed");
        return;
      }
      if (version.signed) {
        apiError(res, 409, ApiErrorCode.CONFLICT, "This version has already been signed");
        return;
      }

      // Both derived SERVER-side, same guarantee portal-risk-register.ts's
      // accept route enforces — a customer-facing signature must not be able
      // to choose its own audit trail. See that route's header for the known
      // req.ip-behind-proxy limitation (recorded honestly, not inferred from).
      const acceptedAt = new Date();
      const ipAddress = (req.ip ?? "").trim() || null;
      const signatureHash = createHash("sha256")
        .update([version.rbdId, version.versionUid, parsed.data.signerName, acceptedAt.toISOString()].join("\x00"))
        .digest("hex");

      const signedBy: ClientApprover = {
        name: parsed.data.signerName,
        title: parsed.data.signerTitle ?? "",
        email: req.user?.email ?? "",
        signedAt: acceptedAt.toISOString().substring(0, 19).replace("T", " ") + " UTC",
        ipAddress,
        signatureHash,
      };

      const updated = await signRbdVersion(scope.mspId, rbdId, versionUid, signedBy, parsed.data.signatureData);
      if (!updated) {
        apiError(res, 409, ApiErrorCode.CONFLICT, "This version has already been signed or is no longer current");
        return;
      }

      log.info(
        { customerId: scope.customerId, mspId: scope.mspId, rbdId, versionUid, signerName: parsed.data.signerName, signatureHash },
        "RBD document signed by customer",
      );

      res.status(201).json({ version: toWireSummary(updated) });
    } catch (err: unknown) {
      log.error({ err }, "POST /portal/risk-register/rbd/:rbdId/versions/:versionUid/sign failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

export default router;
