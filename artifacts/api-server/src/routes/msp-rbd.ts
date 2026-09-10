import { Router, type IRouter, type Request, type Response } from "express";
import { db, mspRiskDecisionsTable, mspPoamsTable, mspAuditLogsTable, monitorChecksTable, complianceFrameworksTable, complianceObligationsTable, RISK_ACCEPTANCE_STATUSES } from "@workspace/db";
import { eq, and, or, isNull, desc, asc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAuth, requireCapability } from "../middlewares/requireAuth.ts";
import { resolveMspIdStrict } from "../lib/resolve-msp-id.ts";
import { apiError, ApiErrorCode } from "../lib/api-helpers.ts";
import { assignRegisterRef } from "../lib/risk-register-ref.ts";
import { randomPlaceholder, assignPoamId } from "../lib/poam-ref.ts";
import { getRequestContext } from "../lib/request-context.ts";
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
  // `expired` was removed on #1507 — an acceptance is a signed fact and does not
  // expire; what lapses is the review clock. See RISK_ACCEPTANCE_STATUSES.
  status: z.enum(RISK_ACCEPTANCE_STATUSES),
  /** Optional: the monitor_checks.key this decision covers, for #1279 alert
   * suppression. Omitted/null when this is a free-standing liability record. */
  checkKey: z.string().nullable().optional(),
  /** Optional: the compliance_obligations.id this decision cites, as a
   * first-class reference (#1525) alongside the free-text `framework`/
   * `obligation`. Omitted/null when no catalog entry matches the citation. */
  obligationId: z.number().int().nullable().optional(),
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

const convertToPoamSchema = z.object({
  /** Real, required reasoning for why the customer decided to fix this risk
   * after all, instead of continuing to carry it as accepted — never
   * inferred. Becomes both rows' `conversionReason`. */
  reason: z.string().min(1),
  scheduledCompletionDate: isoDate,
  interimCompensatingControl: z.string().min(1),
  resourcesRequired: z.string().min(1),
  sowId: z.string().uuid().nullable().optional(),
});

const signRbdSchema = z.object({
  name: z.string(),
  title: z.string(),
  email: z.string(),
  ipAddress: z.string(),
  signatureHash: z.string(),
});

// GET /api/msp/rbd/available-checks
// Read-only monitor_checks catalog (key/label/description only — no rule
// internals) for the RiskBasedDecisionConsole's linked-check picker (Git
// #1294). MSPOperator-readable: the catalog itself isn't sensitive (MSP
// staff already see check labels on every diagnostics finding), only
// authoring it is platform-only (see admin-monitor-checks.ts).
router.get(
  "/msp/rbd/available-checks",
  requireAuth,
  requireCapability("ladder.msp-operator"),
  async (_req: Request, res: Response) => {
    try {
      const checks = await db
        .select({
          key: monitorChecksTable.key,
          label: monitorChecksTable.label,
          description: monitorChecksTable.description,
        })
        .from(monitorChecksTable)
        .orderBy(asc(monitorChecksTable.label));

      res.json(checks);
    } catch (err: unknown) {
      log.error({ err }, "GET /api/msp/rbd/available-checks failed");
      const msg = err instanceof Error ? err.message : String(err);
      apiError(res, 500, ApiErrorCode.INTERNAL, msg);
    }
  }
);

// GET /api/msp/rbd/available-obligations
// Read-only cited-authority catalog (Git #1525) for the RBD console's
// obligation picker: the global/seeded catalog (`compliance_frameworks` with
// `msp_id` null — GDPR, ISO 27001, ...) PLUS any authority this MSP has
// authored for one of its own tenants (a customer's own insurance schedule or
// records policy). Never another MSP's tenant-authored rows.
router.get(
  "/msp/rbd/available-obligations",
  requireAuth,
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        res.status(403).json({ error: "MSP context required" });
        return;
      }

      const rows = await db
        .select({
          obligationId: complianceObligationsTable.id,
          citation: complianceObligationsTable.citation,
          requires: complianceObligationsTable.requires,
          frameworkName: complianceFrameworksTable.name,
          authorityType: complianceFrameworksTable.authorityType,
          tenantId: complianceFrameworksTable.tenantId,
        })
        .from(complianceObligationsTable)
        .innerJoin(complianceFrameworksTable, eq(complianceObligationsTable.frameworkId, complianceFrameworksTable.id))
        .where(
          and(
            eq(complianceObligationsTable.active, true),
            eq(complianceFrameworksTable.active, true),
            or(isNull(complianceFrameworksTable.mspId), eq(complianceFrameworksTable.mspId, mspId)),
          ),
        )
        .orderBy(asc(complianceFrameworksTable.sortOrder), asc(complianceObligationsTable.sortOrder));

      res.json(rows);
    } catch (err: unknown) {
      log.error({ err }, "GET /api/msp/rbd/available-obligations failed");
      const msg = err instanceof Error ? err.message : String(err);
      apiError(res, 500, ApiErrorCode.INTERNAL, msg);
    }
  }
);

// GET /api/msp/rbd
// List all risk based decisions for the active MSP
router.get(
  "/msp/rbd",
  requireAuth,
  requireCapability("ladder.msp-operator"),
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
  requireCapability("ladder.msp-operator"),
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
          checkKey: parsedBody.data.checkKey ?? null,
          obligationId: parsedBody.data.obligationId ?? null,
        })
        .returning({ id: mspRiskDecisionsTable.id });

      const registerRef = await assignRegisterRef(inserted.id);

      res.status(201).json({
        id: inserted.id,
        rbdId: parsedBody.data.rbdId,
        registerRef,
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
  requireCapability("ladder.msp-admin"),
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
  requireCapability("ladder.msp-admin"),
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

// POST /api/msp/rbd/:rbdId/convert-to-poam — Git #3081, Phase 1b of #1935.
// The customer decided to actually fix a risk they'd previously accepted.
// Creates a new, signable `msp_poams` row (same `pending_signature` →
// sign-on-portal path a fresh POA&M already goes through) and marks this
// acceptance `converted_to_poam`, pointed at it. `MSPAdmin`-gated — same
// weight as revoke, since it both ends this record and creates a new plan.
router.patch(
  "/msp/rbd/:rbdId/convert-to-poam",
  requireAuth,
  requireCapability("ladder.msp-admin"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        res.status(403).json({ error: "MSP context required" });
        return;
      }

      const rbdIdStr = String(req.params.rbdId);

      const [existing] = await db
        .select()
        .from(mspRiskDecisionsTable)
        .where(and(eq(mspRiskDecisionsTable.rbdId, rbdIdStr), eq(mspRiskDecisionsTable.mspId, mspId)))
        .limit(1);

      if (!existing) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "Risk-Based Decision not found");
        return;
      }
      if (existing.status !== "active") {
        apiError(res, 409, ApiErrorCode.CONFLICT, `Risk-Based Decision must be active to convert — current status is ${existing.status}`);
        return;
      }

      const parsedBody = convertToPoamSchema.safeParse(req.body);
      if (!parsedBody.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid conversion data", parsedBody.error.flatten());
        return;
      }
      const data = parsedBody.data;

      const placeholder = randomPlaceholder();
      const [inserted] = await db
        .insert(mspPoamsTable)
        .values({
          mspId,
          poamId: placeholder,
          tenantId: existing.tenantId,
          tenantName: existing.tenantName,
          primaryDomain: existing.primaryDomain,
          title: existing.title,
          weaknessDescription: existing.hazardDescription,
          checkKey: existing.checkKey,
          additionalCheckKeys: existing.additionalCheckKeys,
          scheduledCompletionDate: data.scheduledCompletionDate,
          originalScheduledCompletionDate: data.scheduledCompletionDate,
          interimCompensatingControl: data.interimCompensatingControl,
          resourcesRequired: data.resourcesRequired,
          status: "pending_signature",
          // Accountability carries over — same workload/holders this
          // acceptance already resolved, never re-derived.
          authorizingWorkloadId: existing.authorizingWorkloadId,
          authorizingWorkloadLabel: existing.authorizingWorkloadLabel,
          authorizingHolderPersonIds: existing.authorizingHolderPersonIds,
          sowId: data.sowId ?? null,
          spawnedByRiskDecisionId: existing.id,
        })
        .returning({ id: mspPoamsTable.id });

      const poamId = await assignPoamId(inserted.id, placeholder);

      await db
        .update(mspRiskDecisionsTable)
        .set({
          status: "converted_to_poam",
          convertedToPoamId: inserted.id,
          conversionReason: data.reason,
          updatedAt: new Date(),
        })
        .where(eq(mspRiskDecisionsTable.id, existing.id));

      await db.insert(mspAuditLogsTable).values({
        actorUserId: req.user?.id ?? null,
        actorRole: req.user?.mspRole ?? req.user?.role ?? null,
        mspId,
        actionType: "msp.rbd.convert_to_poam",
        entityType: "msp_risk_decision",
        entityId: String(existing.id),
        entityLabel: rbdIdStr,
        correlationId: getRequestContext()?.traceId ?? randomUUID(),
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        outcome: "success",
        metadata: { rbdId: rbdIdStr, poamId, poamRowId: inserted.id, reason: data.reason },
      });

      log.info({ mspId, rbdId: rbdIdStr, poamId, poamRowId: inserted.id }, "Risk-Based Decision converted to POA&M (#3081)");

      res.status(201).json({
        rbdId: rbdIdStr,
        poamId,
        poamRowId: inserted.id,
        message: "Risk-Based Decision converted to a POA&M successfully — awaiting customer signature",
      });
    } catch (err: unknown) {
      log.error({ err }, "PATCH /api/msp/rbd/:rbdId/convert-to-poam failed");
      const msg = err instanceof Error ? err.message : String(err);
      apiError(res, 500, ApiErrorCode.INTERNAL, msg);
    }
  }
);

export default router;
