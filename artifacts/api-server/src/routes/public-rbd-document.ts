/**
 * public-rbd-document.ts — the UNAUTHENTICATED review + sign path for an RBD
 * document (#1512, part of #1487), same shape as `msp-sow.ts`'s
 * `/api/public/sows/:shareToken` pair.
 *
 *   GET  /api/public/rbd/:shareToken        — public viewer, read-only
 *   POST /api/public/rbd/:shareToken/sign   — public sign (rate-limited)
 *
 * A share link is generated explicitly by an MSP operator
 * (`POST /api/msp/rbd/:rbdId/versions/:versionUid/share`, `msp-rbd-versions.ts`)
 * for the current, unsigned version only — it is not the default access path;
 * an authenticated `CustomerUser` never needs one (`portal-rbd-document.ts`).
 * This exists for the case the actual signer is not a portal user at all.
 *
 * Never renders on demand, same reasoning as the portal read path: only the
 * MSP-side render endpoint persists a document, because that write needs a
 * real MSP staff `createdByUserId`. A share link generated before the MSP
 * ever rendered the version reads back "not yet prepared", not a render
 * attributed to nobody.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import rateLimit from "express-rate-limit";
import { z } from "zod";

import { apiError, ApiErrorCode } from "../lib/api-helpers";
import { logger } from "../lib/logger";
import { getRbdVersionByShareToken, signRbdVersion } from "../lib/rbd-versioning.ts";
import { getPersistedRbdVersionDocument } from "../lib/rbd-document-render.ts";
import type { ClientApprover } from "@workspace/db";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

// GET /api/public/rbd/:shareToken — unauthenticated, read-only.
router.get(
  "/public/rbd/:shareToken",
  async (req: Request, res: Response) => {
    try {
      const shareToken = String(req.params.shareToken);
      const version = await getRbdVersionByShareToken(shareToken);
      if (!version) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "This link is invalid or has expired");
        return;
      }

      const doc = await getPersistedRbdVersionDocument(version.versionUid);
      if (!doc) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "This document has not been prepared yet");
        return;
      }

      const signedBy = version.signedBy as ClientApprover | null;

      // Don't expose signature image data in the public view — same rule
      // msp-sow.ts's public viewer follows.
      res.json({
        rbdId: version.rbdId,
        versionNumber: version.versionNumber,
        tenantName: version.tenantName,
        htmlContent: doc.htmlContent,
        signed: version.signed,
        signedAt: version.signedAt?.toISOString() ?? null,
        signerName: signedBy?.name ?? null,
      });
    } catch (err: unknown) {
      log.error({ err }, "GET /public/rbd/:shareToken failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

const publicSignLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV !== "production" ? 500 : 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many signing attempts. Please wait before trying again." },
});

const publicSignSchema = z.object({
  signerName: z.string().trim().min(2, "Type your full name to sign this document").max(200),
  signerTitle: z.string().trim().max(200).optional(),
  signerEmail: z.string().trim().max(320).optional(),
  signatureData: z.string().min(10, "A drawn signature is required"),
});

// POST /api/public/rbd/:shareToken/sign — unauthenticated sign via share link.
router.post(
  "/public/rbd/:shareToken/sign",
  publicSignLimiter,
  async (req: Request, res: Response) => {
    try {
      const shareToken = String(req.params.shareToken);
      const parsed = publicSignSchema.safeParse(req.body);
      if (!parsed.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid signature", parsed.error.flatten());
        return;
      }

      const version = await getRbdVersionByShareToken(shareToken);
      if (!version) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "This link is invalid or has expired");
        return;
      }
      if (version.supersededAt !== null) {
        apiError(res, 409, ApiErrorCode.CONFLICT, "This version has been superseded and can no longer be signed");
        return;
      }
      if (version.signed) {
        apiError(res, 409, ApiErrorCode.CONFLICT, "This document has already been signed");
        return;
      }

      const signedAt = new Date();
      const ipAddress = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
        ?? req.socket.remoteAddress
        ?? null;
      const signatureHash = createHash("sha256")
        .update([version.rbdId, version.versionUid, parsed.data.signerName, signedAt.toISOString()].join("\x00"))
        .digest("hex");

      const signedBy: ClientApprover = {
        name: parsed.data.signerName,
        title: parsed.data.signerTitle ?? "",
        email: parsed.data.signerEmail ?? "",
        signedAt: signedAt.toISOString().substring(0, 19).replace("T", " ") + " UTC",
        ipAddress,
        signatureHash,
      };

      const updated = await signRbdVersion(version.mspId, version.rbdId, version.versionUid, signedBy, parsed.data.signatureData);
      if (!updated) {
        apiError(res, 409, ApiErrorCode.CONFLICT, "This document has already been signed or is no longer current");
        return;
      }

      log.info(
        { mspId: version.mspId, rbdId: version.rbdId, versionUid: version.versionUid, signerName: parsed.data.signerName, viaShareLink: true },
        "RBD document signed via public share link",
      );

      res.json({ ok: true, signed: true });
    } catch (err: unknown) {
      log.error({ err }, "POST /public/rbd/:shareToken/sign failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

export default router;
