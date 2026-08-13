import { Router, type IRouter, type Request, type Response } from "express";
import { db, mspRiskDecisionsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole } from "../middlewares/requireAuth.ts";
import { resolveMspIdStrict } from "../lib/resolve-msp-id.ts";
import { apiError, ApiErrorCode } from "../lib/api-helpers.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

// Zod schemas for input validation
const compensatingControlSchema = z.object({
  type: z.enum(["technical", "administrative", "operational"]),
  description: z.string(),
});

const mspAssessorSchema = z.object({
  name: z.string(),
  upn: z.string(),
  timestamp: z.string(),
});

const clientApproverSchema = z.object({
  name: z.string(),
  title: z.string(),
  email: z.string(),
  signedAt: z.string().nullable().optional().default(null),
  ipAddress: z.string().nullable().optional().default(null),
  signatureHash: z.string().nullable().optional().default(null),
});

const createRbdSchema = z.object({
  rbdId: z.string(),
  tenantId: z.string(),
  tenantName: z.string(),
  primaryDomain: z.string(),
  title: z.string(),
  controlViolated: z.string(),
  framework: z.string(),
  rawRiskLevel: z.enum(["critical", "high", "medium"]),
  residualRiskLevel: z.enum(["high", "medium", "low"]),
  rawRiskScore: z.number().int(),
  residualRiskScore: z.number().int(),
  liabilityValueUsd: z.number().int(),
  hazardDescription: z.string(),
  graphEndpoint: z.string(),
  compensatingControls: z.array(compensatingControlSchema),
  clientApprover: clientApproverSchema,
  expirationDate: z.string(),
  status: z.enum(["active", "pending_signature", "expired", "revoked"]),
});

const signRbdSchema = z.object({
  name: z.string(),
  title: z.string(),
  email: z.string(),
  ipAddress: z.string(),
  signatureHash: z.string(),
});

// GET /api/msp/rbd
// List all risk based decisions for the active MSP
router.get(
  "/msp/rbd",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        res.status(403).json({ error: "MSP context required" });
        return;
      }

      const rows = await db
        .select()
        .from(mspRiskDecisionsTable)
        .where(eq(mspRiskDecisionsTable.mspId, mspId))
        .orderBy(desc(mspRiskDecisionsTable.id));

      res.json(rows);
    } catch (err: unknown) {
      log.error({ err }, "GET /api/msp/rbd failed");
      const msg = err instanceof Error ? err.message : String(err);
      apiError(res, 500, ApiErrorCode.INTERNAL, msg);
    }
  }
);

// POST /api/msp/rbd
// Publish a new risk based decision acceptance request
router.post(
  "/msp/rbd",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        res.status(403).json({ error: "MSP context required" });
        return;
      }

      const parsedBody = createRbdSchema.safeParse(req.body);
      if (!parsedBody.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid Risk-Based Decision data", parsedBody.error.flatten());
        return;
      }

      const userEmail = req.user?.email || "unknown@mspplatform.com";
      const userName = req.user?.name || "MSP Assessor";
      const nowUtc = new Date().toISOString().substring(0, 19).replace("T", " ") + " UTC";

      const [inserted] = await db
        .insert(mspRiskDecisionsTable)
        .values({
          mspId,
          rbdId: parsedBody.data.rbdId,
          tenantId: parsedBody.data.tenantId,
          tenantName: parsedBody.data.tenantName,
          primaryDomain: parsedBody.data.primaryDomain,
          title: parsedBody.data.title,
          controlViolated: parsedBody.data.controlViolated,
          framework: parsedBody.data.framework,
          rawRiskLevel: parsedBody.data.rawRiskLevel,
          residualRiskLevel: parsedBody.data.residualRiskLevel,
          rawRiskScore: parsedBody.data.rawRiskScore,
          residualRiskScore: parsedBody.data.residualRiskScore,
          liabilityValueUsd: parsedBody.data.liabilityValueUsd,
          hazardDescription: parsedBody.data.hazardDescription,
          graphEndpoint: parsedBody.data.graphEndpoint,
          compensatingControls: parsedBody.data.compensatingControls,
          mspAssessor: {
            name: userName,
            upn: userEmail,
            timestamp: nowUtc,
          },
          clientApprover: parsedBody.data.clientApprover,
          expirationDate: parsedBody.data.expirationDate,
          status: parsedBody.data.status,
        })
        .returning({ id: mspRiskDecisionsTable.id });

      res.status(201).json({
        id: inserted.id,
        rbdId: parsedBody.data.rbdId,
        message: "Risk-Based Decision request created successfully",
      });
    } catch (err: unknown) {
      log.error({ err }, "POST /api/msp/rbd failed");
      const msg = err instanceof Error ? err.message : String(err);
      apiError(res, 500, ApiErrorCode.INTERNAL, msg);
    }
  }
);

// PATCH /api/msp/rbd/:rbdId/sign
// Digitally sign a pending Risk-Based Decision (marks status active)
router.patch(
  "/msp/rbd/:rbdId/sign",
  requireAuth,
  requireRole("MSPAdmin"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        res.status(403).json({ error: "MSP context required" });
        return;
      }

      const rbdIdStr = String(req.params.rbdId);

      const parsedBody = signRbdSchema.safeParse(req.body);
      if (!parsedBody.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid signature data", parsedBody.error.flatten());
        return;
      }

      // Verify item exists and belongs to this MSP
      const [existing] = await db
        .select()
        .from(mspRiskDecisionsTable)
        .where(and(eq(mspRiskDecisionsTable.rbdId, rbdIdStr), eq(mspRiskDecisionsTable.mspId, mspId)))
        .limit(1);

      if (!existing) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "Risk-Based Decision not found");
        return;
      }

      if (existing.status !== "pending_signature") {
        apiError(res, 409, ApiErrorCode.CONFLICT, "Decision is not in a signable pending state");
        return;
      }

      const signedAt = new Date().toISOString().substring(0, 19).replace("T", " ") + " UTC";

      const updatedApprover = {
        name: parsedBody.data.name,
        title: parsedBody.data.title,
        email: parsedBody.data.email,
        signedAt,
        ipAddress: parsedBody.data.ipAddress,
        signatureHash: parsedBody.data.signatureHash,
      };

      await db
        .update(mspRiskDecisionsTable)
        .set({
          status: "active",
          clientApprover: updatedApprover,
        })
        .where(eq(mspRiskDecisionsTable.id, existing.id));

      res.json({
        rbdId: rbdIdStr,
        message: "Risk-Based Decision signed and accepted successfully",
      });
    } catch (err: unknown) {
      log.error({ err }, "PATCH /api/msp/rbd/:rbdId/sign failed");
      const msg = err instanceof Error ? err.message : String(err);
      apiError(res, 500, ApiErrorCode.INTERNAL, msg);
    }
  }
);

// PATCH /api/msp/rbd/:rbdId/revoke
// Revoke an active Risk-Based Decision
router.patch(
  "/msp/rbd/:rbdId/revoke",
  requireAuth,
  requireRole("MSPAdmin"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        res.status(403).json({ error: "MSP context required" });
        return;
      }

      const rbdIdStr = String(req.params.rbdId);

      // Verify item exists and belongs to this MSP
      const [existing] = await db
        .select()
        .from(mspRiskDecisionsTable)
        .where(and(eq(mspRiskDecisionsTable.rbdId, rbdIdStr), eq(mspRiskDecisionsTable.mspId, mspId)))
        .limit(1);

      if (!existing) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "Risk-Based Decision not found");
        return;
      }

      if (existing.status !== "active" && existing.status !== "pending_signature") {
        apiError(res, 409, ApiErrorCode.CONFLICT, "Decision status must be active or pending to be revoked");
        return;
      }

      await db
        .update(mspRiskDecisionsTable)
        .set({
          status: "revoked",
        })
        .where(eq(mspRiskDecisionsTable.id, existing.id));

      res.json({
        rbdId: rbdIdStr,
        message: "Risk-Based Decision revoked successfully",
      });
    } catch (err: unknown) {
      log.error({ err }, "PATCH /api/msp/rbd/:rbdId/revoke failed");
      const msg = err instanceof Error ? err.message : String(err);
      apiError(res, 500, ApiErrorCode.INTERNAL, msg);
    }
  }
);

export default router;
