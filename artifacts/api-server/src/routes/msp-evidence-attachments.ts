/**
 * msp-evidence-attachments.ts — #3503.
 *
 * The live server side `desktop/MyArchitect/Services/IEvidencePostClient.cs`
 * (#3470's screenshot tool) has been waiting on since it shipped: a real
 * `POST` to persist a captured screenshot + caption against either a
 * `remediation_tracker_steps` step or a `cr_executions` change execution.
 *
 *   POST /api/msp/customers/:customerId/remediation-tracker/steps/:stepId/evidence
 *   GET  /api/msp/customers/:customerId/remediation-tracker/steps/:stepId/evidence
 *   POST /api/msp/change-control/executions/:id/evidence
 *   GET  /api/msp/change-control/executions/:id/evidence
 *   GET  /api/msp/evidence-attachments/:id/file
 *
 * Auth/scoping mirrors the two source routers exactly, because these routes
 * exist to hang evidence off records those routers already own:
 *   - remediation-tracker steps: `requireCapability("ladder.msp-operator")` +
 *     `assertCustomerAccess`, same as msp-remediation-tracker.ts.
 *   - change-control executions: `requireCapability("ladder.msp-operator")` +
 *     `resolveMspIdStrict` + a (id, mspId)-scoped lookup, same as
 *     msp-change-executions.ts (reuses its own `getExecution`).
 *
 * Storage: multer disk storage under `UPLOADS_DIR/evidence-attachments`,
 * matching admin-media-library.ts's own convention — a server-generated
 * filename, never a client-supplied path. The file is served back only
 * through the scoped GET below, never a public static mount, because this is
 * real customer tenant evidence, not marketing media.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import { db, remediationTrackerStepsTable, tenantsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

import { requireAuth, requireCapability, assertCustomerAccess } from "../middlewares/requireAuth.ts";
import { resolveMspIdStrict } from "../lib/resolve-msp-id.ts";
import { personIdForUser } from "../lib/portal-ownership.ts";
import { logger } from "../lib/logger.ts";
import { getExecution } from "../lib/msp-change-execution-store.ts";
import {
  recordEvidenceAttachment,
  listEvidenceAttachments,
  getEvidenceAttachment,
  toWireEvidenceAttachment,
} from "../lib/evidence-attachments-store.ts";

const log = logger.child({ channel: "workflow.change-control" });

const router: IRouter = Router();

const UPLOADS_BASE = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.resolve("../../data/uploads");

const EVIDENCE_DIR = path.join(UPLOADS_BASE, "evidence-attachments");
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]);
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB — matches admin-media-library.ts

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, EVIDENCE_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safe = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 60);
    cb(null, `${Date.now()}-${safe}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTENSIONS.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed (jpg, jpeg, png, gif, webp, bmp)"));
    }
  },
});

function runUpload(req: Request, res: Response, next: (err?: unknown) => void): void {
  upload.single("file")(req, res, (err) => {
    if (err instanceof multer.MulterError || err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    next();
  });
}

function parseOptionalInt(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function actorIdentity(req: Request): { userId: number | null; personId: string | null } {
  const userId = typeof req.user?.id === "number" ? req.user.id : null;
  return { userId, personId: userId !== null ? personIdForUser(userId) : null };
}

// ── Shared MSP context (change-control side) ─────────────────────────────────
function mspContext(req: Request, res: Response): number | null {
  const mspId = resolveMspIdStrict(req);
  if (mspId === null) {
    res.status(403).json({ error: "MSP context required" });
    return null;
  }
  return mspId;
}

/** Parses `:customerId` and checks MSP ownership — matches msp-remediation-tracker.ts. */
async function resolveAuthorizedCustomerId(req: Request, res: Response): Promise<number | null> {
  const customerId = parseInt(req.params.customerId as string, 10);
  if (isNaN(customerId)) {
    res.status(400).json({ error: "Invalid customerId" });
    return null;
  }
  if (!(await assertCustomerAccess(req.user!, customerId))) {
    res.status(404).json({ error: "Customer not found" });
    return null;
  }
  return customerId;
}

/** The msp_id this remediation-tracker route's evidence rows are stamped with — the acting operator's own MSP. */
function actorMspId(req: Request, res: Response): number | null {
  const mspId = typeof req.user?.mspId === "number" ? req.user.mspId : null;
  if (mspId === null) {
    res.status(403).json({ error: "MSP context required" });
    return null;
  }
  return mspId;
}

// ── Remediation tracker step evidence ────────────────────────────────────────

router.post(
  "/msp/customers/:customerId/remediation-tracker/steps/:stepId/evidence",
  requireAuth,
  requireCapability("ladder.msp-operator"),
  runUpload,
  async (req: Request, res: Response): Promise<void> => {
    const customerId = await resolveAuthorizedCustomerId(req, res);
    if (customerId === null) return;
    const mspId = actorMspId(req, res);
    if (mspId === null) return;

    const stepId = String(req.params.stepId ?? "");
    if (!req.file) {
      res.status(400).json({ error: "No file provided" });
      return;
    }

    try {
      const [step] = await db
        .select({ id: remediationTrackerStepsTable.id })
        .from(remediationTrackerStepsTable)
        .where(and(eq(remediationTrackerStepsTable.customerId, customerId), eq(remediationTrackerStepsTable.stepId, stepId)))
        .limit(1);
      if (!step) {
        res.status(404).json({ error: "This customer has no tracked state for that remediation step yet — set a status on it before attaching evidence" });
        return;
      }

      const actor = actorIdentity(req);
      const capturedAtRaw = typeof req.body?.capturedAt === "string" ? new Date(req.body.capturedAt) : null;
      const row = await recordEvidenceAttachment({
        mspId,
        customerId,
        source: "remediation_tracker",
        sourceRefId: step.id,
        filePath: path.join("evidence-attachments", req.file.filename),
        originalFilename: req.file.originalname,
        contentType: req.file.mimetype,
        fileSizeBytes: req.file.size,
        caption: typeof req.body?.caption === "string" ? req.body.caption : null,
        width: parseOptionalInt(req.body?.width),
        height: parseOptionalInt(req.body?.height),
        capturedAt: capturedAtRaw && !isNaN(capturedAtRaw.getTime()) ? capturedAtRaw : undefined,
        uploadedByUserId: actor.userId,
        uploadedByPersonId: actor.personId,
      });

      log.info({ customerId, stepId, id: row.id }, "remediation tracker evidence attached");
      res.status(201).json({ attachment: toWireEvidenceAttachment(row) });
    } catch (err) {
      log.error({ err, customerId, stepId }, "POST remediation-tracker evidence failed");
      res.status(500).json({ error: "Failed to save the evidence attachment" });
    }
  },
);

router.get(
  "/msp/customers/:customerId/remediation-tracker/steps/:stepId/evidence",
  requireAuth,
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = await resolveAuthorizedCustomerId(req, res);
    if (customerId === null) return;
    const mspId = actorMspId(req, res);
    if (mspId === null) return;

    const stepId = String(req.params.stepId ?? "");
    try {
      const [step] = await db
        .select({ id: remediationTrackerStepsTable.id })
        .from(remediationTrackerStepsTable)
        .where(and(eq(remediationTrackerStepsTable.customerId, customerId), eq(remediationTrackerStepsTable.stepId, stepId)))
        .limit(1);
      if (!step) {
        res.status(200).json({ attachments: [] });
        return;
      }
      const rows = await listEvidenceAttachments(mspId, "remediation_tracker", step.id);
      res.status(200).json({ attachments: rows.map(toWireEvidenceAttachment) });
    } catch (err) {
      log.error({ err, customerId, stepId }, "GET remediation-tracker evidence failed");
      res.status(500).json({ error: "Failed to load evidence attachments" });
    }
  },
);

// ── Change-control execution evidence ────────────────────────────────────────

router.post(
  "/msp/change-control/executions/:id/evidence",
  requireAuth,
  requireCapability("ladder.msp-operator"),
  runUpload,
  async (req: Request, res: Response): Promise<void> => {
    const mspId = mspContext(req, res);
    if (mspId === null) return;
    const executionId = Number(req.params.id);
    if (!Number.isInteger(executionId) || executionId <= 0) {
      res.status(400).json({ error: "Invalid execution id" });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "No file provided" });
      return;
    }

    try {
      const execution = await getExecution(mspId, executionId);
      if (!execution) {
        res.status(404).json({ error: "Execution not found for this MSP" });
        return;
      }

      // cr_executions carries tenantId (the M365 tenant GUID), not the portal
      // customerId evidence_attachments is keyed on — resolve the real portal
      // customer via tenants.tenant_id, the same join msp-remediation-tracker.ts
      // makes in the other direction (tenants.id -> tenants.tenant_id).
      const [tenant] = await db
        .select({ id: tenantsTable.id })
        .from(tenantsTable)
        .where(eq(tenantsTable.tenantId, execution.tenantId))
        .limit(1);
      if (!tenant) {
        res.status(500).json({ error: "No portal customer found for this execution's tenant" });
        return;
      }

      const actor = actorIdentity(req);
      const capturedAtRaw = typeof req.body?.capturedAt === "string" ? new Date(req.body.capturedAt) : null;
      const row = await recordEvidenceAttachment({
        mspId,
        customerId: tenant.id,
        source: "change_control",
        sourceRefId: execution.id,
        filePath: path.join("evidence-attachments", req.file.filename),
        originalFilename: req.file.originalname,
        contentType: req.file.mimetype,
        fileSizeBytes: req.file.size,
        caption: typeof req.body?.caption === "string" ? req.body.caption : null,
        width: parseOptionalInt(req.body?.width),
        height: parseOptionalInt(req.body?.height),
        capturedAt: capturedAtRaw && !isNaN(capturedAtRaw.getTime()) ? capturedAtRaw : undefined,
        uploadedByUserId: actor.userId,
        uploadedByPersonId: actor.personId,
      });

      log.info({ mspId, executionId, id: row.id }, "change-control execution evidence attached");
      res.status(201).json({ attachment: toWireEvidenceAttachment(row) });
    } catch (err) {
      log.error({ err, mspId, executionId }, "POST change-control execution evidence failed");
      res.status(500).json({ error: "Failed to save the evidence attachment" });
    }
  },
);

router.get(
  "/msp/change-control/executions/:id/evidence",
  requireAuth,
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response): Promise<void> => {
    const mspId = mspContext(req, res);
    if (mspId === null) return;
    const executionId = Number(req.params.id);
    if (!Number.isInteger(executionId) || executionId <= 0) {
      res.status(400).json({ error: "Invalid execution id" });
      return;
    }
    try {
      const execution = await getExecution(mspId, executionId);
      if (!execution) {
        res.status(404).json({ error: "Execution not found for this MSP" });
        return;
      }
      const rows = await listEvidenceAttachments(mspId, "change_control", execution.id);
      res.status(200).json({ attachments: rows.map(toWireEvidenceAttachment) });
    } catch (err) {
      log.error({ err, mspId, executionId }, "GET change-control execution evidence failed");
      res.status(500).json({ error: "Failed to load evidence attachments" });
    }
  },
);

// ── File serving ──────────────────────────────────────────────────────────────
// Scoped to the caller's own MSP — this is real tenant evidence, never a public
// static mount (unlike admin-media-library.ts's marketing images).

router.get(
  "/msp/evidence-attachments/:id/file",
  requireAuth,
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid attachment id" });
      return;
    }
    const mspId = typeof req.user?.mspId === "number" ? req.user.mspId : resolveMspIdStrict(req);
    if (mspId === null) {
      res.status(403).json({ error: "MSP context required" });
      return;
    }
    try {
      const row = await getEvidenceAttachment(mspId, id);
      if (!row) {
        res.status(404).json({ error: "Evidence attachment not found" });
        return;
      }
      const filePath = path.join(UPLOADS_BASE, row.filePath);
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: "File not found" });
        return;
      }
      if (row.contentType) res.setHeader("Content-Type", row.contentType);
      res.sendFile(filePath);
    } catch (err) {
      log.error({ err, id }, "GET evidence-attachments file failed");
      res.status(500).json({ error: "Failed to load the evidence file" });
    }
  },
);

export default router;
