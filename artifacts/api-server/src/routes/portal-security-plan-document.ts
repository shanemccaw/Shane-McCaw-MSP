/**
 * portal-security-plan-document.ts — the CUSTOMER-facing Security Plan version
 * read + genuine customer sign action (#2949, part of #1495/#1485).
 *
 *   GET  /api/portal/security-plan/versions                       — this plan's
 *        version history, scoped to the caller's own tenant
 *   GET  /api/portal/security-plan/versions/current                — the current
 *        (unsuperseded) version, signed or not — the thing a customer reviews
 *        before deciding to sign
 *   POST /api/portal/security-plan/versions/:versionUid/sign       — the customer
 *        signs that version themselves
 *
 * ── Real, confirmed gap this closes (#2949) ─────────────────────────────────
 * `msp-security-plan.ts`'s own header was explicit: "the customer-facing
 * read/sign surface is a separate, not-yet-built concern." `PATCH
 * /api/msp/security-plan/:customerId/versions/:versionUid/sign` lets an
 * MSPAdmin seal a signature on the customer's behalf (an out-of-band-collected
 * signature entered by MSP staff); nothing let the customer sign it
 * themselves. This module is that missing path — modeled directly on
 * `portal-rbd-document.ts`, since `msp.ts`'s own comment already calls the
 * Security Plan version chain "the RBD pattern one level up."
 *
 * ── Signature record shape: REUSE `ClientApprover`/`signedBy`, no schema change ──
 * `msp_security_plan_versions` already has room for both halves of the real
 * workflow without adding a column: `createdBy`/`createdAt` records the MSP-side
 * SEAL (who finalized this version's content, and when — already real, already
 * built via `POST .../versions`); `signed`/`signedBy`/`signedAt` records the
 * CLIENT'S OWN sign-off, exactly the `ClientApprover` shape `msp_rbd_versions`
 * and `msp_risk_decisions` already use. `signSecurityPlanVersion` is reused
 * unchanged — it already only touches a row that is current and unsigned, so
 * this route and the existing MSP-side `PATCH .../sign` cannot both succeed
 * against the same version (whichever writes first wins; the other gets 409).
 * No new table, no new column — see `security-plan-versioning.ts`.
 *
 * ── `ipAddress`/`signatureHash` are SERVER-derived, never client-supplied ───
 * Same guarantee `portal-risk-register.ts`'s `/accept` route and
 * `portal-rbd-document.ts`'s `/sign` route both enforce: a customer-facing
 * signature must not be able to choose its own audit trail. The MSP-side
 * `PATCH .../sign` accepts these in the body because that route is recording
 * an OFF-PLATFORM signature MSP staff collected, not asserting the platform
 * itself observed the act.
 *
 * ── Scoping ───────────────────────────────────────────────────────────────
 * `resolveTenantScope(resolveCustomerId(req))`, the same pair every other
 * customer-facing Security Plan / RBD route in this codebase uses. A
 * `versionUid` belonging to another tenant 404s exactly like one that does not
 * exist — scoped read first, same discipline as `portal-rbd-document.ts`.
 *
 * ── Role floor: `CustomerUser` ───────────────────────────────────────────
 * Same reasoning as `portal-rbd-document.ts` / `portal-risk-register.ts`: a
 * signature transfers real weight (the plan of record an insurer or auditor
 * may be shown), so it sits at the higher floor, not a lower-stakes one.
 *
 * ── What this does NOT change ────────────────────────────────────────────
 * `GET /api/portal/security-plan` (`portal-security-plan.ts`) is untouched —
 * it still serves `assembledPlan`, the last SIGNED version, as the plan of
 * record. This module adds the ability to see and act on the CURRENT version
 * before it is signed; it does not change what counts as the plan of record.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import { z } from "zod";

import { requireRole } from "../middlewares/requireAuth";
import { resolveCustomerId, resolveTenantScope, type TenantScope } from "../lib/portal-customer-scope";
import { apiError, ApiErrorCode } from "../lib/api-helpers";
import { logger } from "../lib/logger";
import {
  getCurrentSecurityPlanVersion,
  getSecurityPlanVersionByUid,
  listSecurityPlanVersions,
  signSecurityPlanVersion,
} from "../lib/security-plan-versioning.ts";
import type { ClientApprover, MspSecurityPlanVersion } from "@workspace/db";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

interface WireSecurityPlanVersionSummary {
  readonly versionUid: string;
  readonly versionNumber: number;
  readonly createdAt: string;
  readonly signed: boolean;
  readonly signedAt: string | null;
  readonly isCurrent: boolean;
}

/** The current version's full detail — what a customer reviews before signing.
 * `content` is the full, self-contained `SecurityPlanContent` snapshot, same
 * shape `msp-security-plan.ts`'s own `WireSecurityPlanVersion.content` passes
 * through untyped. */
interface WireSecurityPlanVersionDetail extends WireSecurityPlanVersionSummary {
  readonly content: unknown;
  readonly scopeStatement: string;
}

function iso(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null;
}

function toWireSummary(row: MspSecurityPlanVersion): WireSecurityPlanVersionSummary {
  return {
    versionUid: row.versionUid,
    versionNumber: row.versionNumber,
    createdAt: iso(row.createdAt) as string,
    signed: row.signed,
    signedAt: iso(row.signedAt),
    isCurrent: row.supersededAt === null,
  };
}

function toWireDetail(row: MspSecurityPlanVersion): WireSecurityPlanVersionDetail {
  return {
    ...toWireSummary(row),
    content: row.content,
    scopeStatement: row.content.footprint.scope.statement,
  };
}

/** Resolves the caller's tenant scope, or writes a 403 and returns null. */
async function requireScope(req: Request, res: Response): Promise<TenantScope | null> {
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

// GET /api/portal/security-plan/versions — full seal chain, newest first, scoped
// to the caller's own tenant.
router.get(
  "/portal/security-plan/versions",
  requireRole("CustomerUser"),
  async (req: Request, res: Response) => {
    try {
      const scope = await requireScope(req, res);
      if (!scope) return;
      const rows = await listSecurityPlanVersions(scope.mspId, scope.customerId);
      res.json({ versions: rows.map(toWireSummary) });
    } catch (err: unknown) {
      log.error({ err }, "GET /portal/security-plan/versions failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

// GET /api/portal/security-plan/versions/current — the current (unsuperseded)
// version, signed or not. This is the review step: a customer must be able to
// see what a version actually says before deciding to sign it, which is why
// this is deliberately NOT restricted to signed-only the way `assembledPlan`
// (portal-security-plan.ts) is — that route answers "what is the plan of
// record," this one answers "what is there for me to act on right now."
router.get(
  "/portal/security-plan/versions/current",
  requireRole("CustomerUser"),
  async (req: Request, res: Response) => {
    try {
      const scope = await requireScope(req, res);
      if (!scope) return;
      const version = await getCurrentSecurityPlanVersion(scope.mspId, scope.customerId);
      if (!version) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "No version has been sealed for this Security Plan yet");
        return;
      }
      res.json({ version: toWireDetail(version) });
    } catch (err: unknown) {
      log.error({ err }, "GET /portal/security-plan/versions/current failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

/**
 * The typed-name acceptance. `fullName`/`title` are typed by the signer, not
 * pulled from the account record — the person signing may legitimately be
 * signing in a role, matching `portal-rbd-document.ts`'s own reasoning.
 * `email` is NOT accepted from the body — it comes from the authenticated
 * session (`req.user.email`), the same real identity claim every other
 * customer-facing signature route in this codebase uses rather than trusting
 * a client-typed address.
 */
const signVersionSchema = z.object({
  fullName: z.string().trim().min(2, "Type your full name to sign this document").max(200),
  title: z.string().trim().max(200).optional(),
});

router.post(
  "/portal/security-plan/versions/:versionUid/sign",
  requireRole("CustomerUser"),
  async (req: Request, res: Response) => {
    try {
      const scope = await requireScope(req, res);
      if (!scope) return;
      const versionUid = String(req.params.versionUid);

      const parsed = signVersionSchema.safeParse(req.body);
      if (!parsed.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid signature", parsed.error.flatten());
        return;
      }

      // Scoped read first, same reasoning as portal-rbd-document.ts /
      // portal-risk-register.ts: a version belonging to another tenant 404s
      // exactly like one that does not exist.
      const version = await getSecurityPlanVersionByUid(scope.mspId, scope.customerId, versionUid);
      if (!version) {
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

      // Both derived SERVER-side — see file header. Known limitation, flagged
      // rather than papered over (same as portal-risk-register.ts /
      // portal-rbd-document.ts): behind Replit's proxy without `trust proxy`
      // configured, `req.ip` is the proxy's loopback hop, not the customer's
      // real address. Still recorded — an absent field would be worse — but
      // nothing should be inferred from it until that app-wide setting changes.
      const signedAt = new Date();
      const ipAddress = (req.ip ?? "").trim() || null;
      const signatureHash = createHash("sha256")
        .update([version.customerId, version.versionUid, parsed.data.fullName, signedAt.toISOString()].join("\x00"))
        .digest("hex");

      const signedBy: ClientApprover = {
        name: parsed.data.fullName,
        title: parsed.data.title ?? "",
        email: req.user?.email ?? "",
        signedAt: signedAt.toISOString().substring(0, 19).replace("T", " ") + " UTC",
        ipAddress,
        signatureHash,
      };

      const updated = await signSecurityPlanVersion(scope.mspId, scope.customerId, versionUid, signedBy);
      if (!updated) {
        apiError(res, 409, ApiErrorCode.CONFLICT, "This version has already been signed or is no longer current");
        return;
      }

      log.info(
        {
          customerId: scope.customerId,
          mspId: scope.mspId,
          versionUid,
          signerName: parsed.data.fullName,
          signatureHash,
        },
        "Security Plan version signed by customer",
      );

      res.status(201).json({ version: toWireDetail(updated) });
    } catch (err: unknown) {
      log.error({ err }, "POST /portal/security-plan/versions/:versionUid/sign failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

export default router;
