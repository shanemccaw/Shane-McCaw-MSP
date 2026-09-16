/**
 * msp-evidence.ts — #4353.
 *
 * The real SHARED Evidence object's HTTP surface, for MyArchitect's operator
 * cockpit. Distinct from msp-evidence-attachments.ts (#3503), which hangs a
 * screenshot off exactly one remediation step or change execution. Here one
 * `evidence` row can be linked to MANY object types (milestone|document|
 * finding|gap|risk|kanban_card|poam) so #4345/#4349/#4350 reuse ONE object.
 *
 *   POST   /api/msp/evidence                     — create (file upload OR link), optionally attach to a target
 *   GET    /api/msp/evidence?linkedType=&linkedId= — list evidence for one object
 *   POST   /api/msp/evidence/:id/link             — attach an existing evidence row to another object
 *   DELETE /api/msp/evidence/:id/link?linkedType=&linkedId= — detach from one object (the "or unlink" case)
 *   DELETE /api/msp/evidence/:id                  — delete the evidence row (cascades its links + removes the file)
 *   GET    /api/msp/evidence/:id/file             — serve an uploaded file, scoped to the caller's MSP
 *
 * Auth: `requireAuth` + `requireCapability("ladder.msp-operator")`, scoped by
 * the operator's own `mspId` — identical to msp-evidence-attachments.ts. Every
 * mutating call (create / link / unlink / delete) writes a real audit row; the
 * cross-boundary GET writes a privileged-read audit row.
 *
 * Storage: multer disk storage under `UPLOADS_DIR/evidence`, a server-generated
 * filename never a client path — the same convention msp-evidence-attachments.ts
 * uses for `evidence-attachments`. Files are served only through the scoped GET
 * below, never a public static mount.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import { EVIDENCE_KINDS, EVIDENCE_LINK_TYPES, type EvidenceKind, type EvidenceLinkType } from "@workspace/db";

import { requireAuth, requireCapability, assertCustomerAccess } from "../middlewares/requireAuth.ts";
import { resolveMspIdStrict } from "../lib/resolve-msp-id.ts";
import { personIdForUser } from "../lib/portal-ownership.ts";
import { logger } from "../lib/logger.ts";
import { createAuditLog, auditPrivilegedRead, resolveAuditActorRole } from "../lib/audit.ts";
import {
  createEvidence,
  getEvidence,
  linkEvidence,
  unlinkEvidence,
  listEvidenceForTarget,
  listLinksForEvidence,
  deleteEvidence,
  toWireEvidence,
} from "../lib/evidence-store.ts";

const log = logger.child({ channel: "workflow.evidence" });

const router: IRouter = Router();

const UPLOADS_BASE = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.resolve("../../data/uploads");

const EVIDENCE_DIR = path.join(UPLOADS_BASE, "evidence");
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

// Evidence files are broader than screenshots — a proof-of-remediation might be a
// PDF, a CSV export or a log. Allow the common document/image types; still an
// allowlist, never "anything".
const ALLOWED_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp",
  ".pdf", ".txt", ".csv", ".json", ".log", ".doc", ".docx", ".xls", ".xlsx",
]);
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

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
      cb(new Error(`File type ${ext || "(none)"} is not allowed`));
    }
  },
});

/**
 * Tolerant multer wrapper — the POST accepts EITHER a multipart file upload OR a
 * JSON `link` body, so a missing file is not an error here (multer just leaves
 * `req.file` undefined for a non-multipart request; express.json already parsed
 * the body). A real multer error (too large, wrong type) still 400s.
 */
function runUpload(req: Request, res: Response, next: (err?: unknown) => void): void {
  upload.single("file")(req, res, (err) => {
    if (err instanceof multer.MulterError || err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    next();
  });
}

function actorMspId(req: Request, res: Response): number | null {
  const mspId = typeof req.user?.mspId === "number" ? req.user.mspId : resolveMspIdStrict(req);
  if (mspId === null) {
    res.status(403).json({ error: "MSP context required" });
    return null;
  }
  return mspId;
}

function actorIdentity(req: Request): { userId: number | null; personId: string | null } {
  const userId = typeof req.user?.id === "number" ? req.user.id : null;
  return { userId, personId: userId !== null ? personIdForUser(userId) : null };
}

function auditActor(req: Request) {
  return {
    actorUserId: req.user?.id ?? null,
    actorName: req.user?.name ?? req.user?.email ?? "unknown",
    actorRole: resolveAuditActorRole(req.user!),
  };
}

function isLinkType(value: unknown): value is EvidenceLinkType {
  return typeof value === "string" && (EVIDENCE_LINK_TYPES as readonly string[]).includes(value);
}

function parseOptionalInt(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

// ── Create (file upload OR link), optionally attach to a target ───────────────

router.post(
  "/msp/evidence",
  requireAuth,
  requireCapability("ladder.msp-operator"),
  runUpload,
  async (req: Request, res: Response): Promise<void> => {
    const mspId = actorMspId(req, res);
    if (mspId === null) return;

    // The requested kind: an uploaded file, or a link. Infer from the presence of
    // a file when not stated explicitly.
    const explicitKind = typeof req.body?.kind === "string" ? req.body.kind : null;
    const kind: EvidenceKind = explicitKind && (EVIDENCE_KINDS as readonly string[]).includes(explicitKind)
      ? (explicitKind as EvidenceKind)
      : req.file
        ? "file"
        : "link";

    // Optional target to attach on create.
    const linkedTypeRaw = req.body?.linkedType;
    const linkedIdRaw = req.body?.linkedId;
    const hasTarget = linkedTypeRaw !== undefined && linkedTypeRaw !== null && linkedTypeRaw !== "";
    if (hasTarget && !isLinkType(linkedTypeRaw)) {
      res.status(400).json({ error: `Invalid linkedType. Must be one of: ${EVIDENCE_LINK_TYPES.join(", ")}` });
      return;
    }
    const linkedId = hasTarget ? String(linkedIdRaw ?? "") : "";
    if (hasTarget && linkedId === "") {
      res.status(400).json({ error: "linkedId is required when linkedType is provided" });
      return;
    }

    // Optional customer scope — verify access when supplied.
    const customerId = parseOptionalInt(req.body?.customerId);
    if (customerId !== null && !(await assertCustomerAccess(req.user!, customerId))) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }

    let fileRef: string;
    let originalFilename: string | null = null;
    let contentType: string | null = null;
    let fileSizeBytes: number | null = null;

    if (kind === "file") {
      if (!req.file) {
        res.status(400).json({ error: "No file provided for a file-kind evidence" });
        return;
      }
      fileRef = path.join("evidence", req.file.filename);
      originalFilename = req.file.originalname;
      contentType = req.file.mimetype;
      fileSizeBytes = req.file.size;
    } else {
      const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
      if (!/^https?:\/\//i.test(url)) {
        res.status(400).json({ error: "A link-kind evidence requires a valid http(s) url" });
        return;
      }
      fileRef = url;
    }

    const description = typeof req.body?.description === "string" ? req.body.description : null;
    const actor = actorIdentity(req);

    try {
      const row = await createEvidence({
        mspId,
        customerId,
        kind,
        fileRef,
        originalFilename,
        contentType,
        fileSizeBytes,
        description,
        uploadedByUserId: actor.userId,
        uploadedByPersonId: actor.personId,
      });

      void createAuditLog({
        ...auditActor(req),
        actionType: "evidence.create",
        entityType: "evidence",
        entityId: row.id,
        entityLabel: originalFilename ?? (kind === "link" ? fileRef : null),
        tenantId: customerId,
        metadata: { kind },
      });

      if (hasTarget && isLinkType(linkedTypeRaw)) {
        await linkEvidence(row.id, linkedTypeRaw, linkedId, actor.userId);
        void createAuditLog({
          ...auditActor(req),
          actionType: "evidence.link",
          entityType: "evidence",
          entityId: row.id,
          tenantId: customerId,
          metadata: { linkedType: linkedTypeRaw, linkedId },
        });
      }

      const links = await listLinksForEvidence(row.id);
      log.info({ mspId, id: row.id, kind, linkedType: hasTarget ? linkedTypeRaw : null }, "evidence created");
      res.status(201).json({ evidence: toWireEvidence(row, links) });
    } catch (err) {
      log.error({ err, mspId }, "POST evidence failed");
      res.status(500).json({ error: "Failed to save the evidence" });
    }
  },
);

// ── List evidence for one target object ───────────────────────────────────────

router.get(
  "/msp/evidence",
  requireAuth,
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response): Promise<void> => {
    const mspId = actorMspId(req, res);
    if (mspId === null) return;

    const linkedTypeRaw = req.query.linkedType;
    const linkedId = typeof req.query.linkedId === "string" ? req.query.linkedId : "";
    if (!isLinkType(linkedTypeRaw)) {
      res.status(400).json({ error: `linkedType is required and must be one of: ${EVIDENCE_LINK_TYPES.join(", ")}` });
      return;
    }
    if (linkedId === "") {
      res.status(400).json({ error: "linkedId is required" });
      return;
    }

    try {
      const rows = await listEvidenceForTarget(mspId, linkedTypeRaw, linkedId);
      void auditPrivilegedRead({
        ...auditActor(req),
        actionType: "evidence.list",
        entityType: "evidence",
        entityId: `${linkedTypeRaw}:${linkedId}`,
        metadata: { linkedType: linkedTypeRaw, linkedId, count: rows.length },
      });
      res.status(200).json({ evidence: rows.map((r) => toWireEvidence(r)) });
    } catch (err) {
      log.error({ err, mspId }, "GET evidence failed");
      res.status(500).json({ error: "Failed to load evidence" });
    }
  },
);

// ── Attach an existing evidence row to another object ─────────────────────────

router.post(
  "/msp/evidence/:id/link",
  requireAuth,
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response): Promise<void> => {
    const mspId = actorMspId(req, res);
    if (mspId === null) return;

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid evidence id" });
      return;
    }

    const linkedTypeRaw = req.body?.linkedType;
    const linkedId = String(req.body?.linkedId ?? "");
    if (!isLinkType(linkedTypeRaw)) {
      res.status(400).json({ error: `Invalid linkedType. Must be one of: ${EVIDENCE_LINK_TYPES.join(", ")}` });
      return;
    }
    if (linkedId === "") {
      res.status(400).json({ error: "linkedId is required" });
      return;
    }

    try {
      const evidence = await getEvidence(mspId, id);
      if (!evidence) {
        res.status(404).json({ error: "Evidence not found" });
        return;
      }
      const actor = actorIdentity(req);
      await linkEvidence(id, linkedTypeRaw, linkedId, actor.userId);
      void createAuditLog({
        ...auditActor(req),
        actionType: "evidence.link",
        entityType: "evidence",
        entityId: id,
        tenantId: evidence.customerId,
        metadata: { linkedType: linkedTypeRaw, linkedId },
      });

      const links = await listLinksForEvidence(id);
      res.status(200).json({ evidence: toWireEvidence(evidence, links) });
    } catch (err) {
      log.error({ err, mspId, id }, "POST evidence link failed");
      res.status(500).json({ error: "Failed to link the evidence" });
    }
  },
);

// ── Detach from one object (the "or unlink" case) ─────────────────────────────

router.delete(
  "/msp/evidence/:id/link",
  requireAuth,
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response): Promise<void> => {
    const mspId = actorMspId(req, res);
    if (mspId === null) return;

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid evidence id" });
      return;
    }

    const linkedTypeRaw = req.query.linkedType;
    const linkedId = typeof req.query.linkedId === "string" ? req.query.linkedId : "";
    if (!isLinkType(linkedTypeRaw)) {
      res.status(400).json({ error: `Invalid linkedType. Must be one of: ${EVIDENCE_LINK_TYPES.join(", ")}` });
      return;
    }
    if (linkedId === "") {
      res.status(400).json({ error: "linkedId is required" });
      return;
    }

    try {
      const evidence = await getEvidence(mspId, id);
      if (!evidence) {
        res.status(404).json({ error: "Evidence not found" });
        return;
      }
      const removed = await unlinkEvidence(id, linkedTypeRaw, linkedId);
      void createAuditLog({
        ...auditActor(req),
        actionType: "evidence.unlink",
        entityType: "evidence",
        entityId: id,
        tenantId: evidence.customerId,
        metadata: { linkedType: linkedTypeRaw, linkedId, removed },
      });
      res.status(200).json({ removed });
    } catch (err) {
      log.error({ err, mspId, id }, "DELETE evidence link failed");
      res.status(500).json({ error: "Failed to unlink the evidence" });
    }
  },
);

// ── Delete the evidence row (cascades links, removes the file) ────────────────

router.delete(
  "/msp/evidence/:id",
  requireAuth,
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response): Promise<void> => {
    const mspId = actorMspId(req, res);
    if (mspId === null) return;

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid evidence id" });
      return;
    }

    try {
      const row = await deleteEvidence(mspId, id);
      if (!row) {
        res.status(404).json({ error: "Evidence not found" });
        return;
      }
      // Remove the backing file for a file-kind row (best-effort — a missing file
      // is not an error; the DB row is already gone).
      if (row.kind === "file") {
        const filePath = path.join(UPLOADS_BASE, row.fileRef);
        try {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch (fileErr) {
          log.warn({ fileErr, id, filePath }, "evidence deleted but its file could not be removed");
        }
      }
      void createAuditLog({
        ...auditActor(req),
        actionType: "evidence.delete",
        entityType: "evidence",
        entityId: id,
        tenantId: row.customerId,
        metadata: { kind: row.kind },
      });
      res.status(200).json({ deleted: true, id });
    } catch (err) {
      log.error({ err, mspId, id }, "DELETE evidence failed");
      res.status(500).json({ error: "Failed to delete the evidence" });
    }
  },
);

// ── File serving — scoped to the caller's own MSP ─────────────────────────────

router.get(
  "/msp/evidence/:id/file",
  requireAuth,
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response): Promise<void> => {
    const mspId = actorMspId(req, res);
    if (mspId === null) return;

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid evidence id" });
      return;
    }

    try {
      const row = await getEvidence(mspId, id);
      if (!row || row.kind !== "file") {
        res.status(404).json({ error: "Evidence file not found" });
        return;
      }
      const filePath = path.join(UPLOADS_BASE, row.fileRef);
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: "File not found" });
        return;
      }
      if (row.contentType) res.setHeader("Content-Type", row.contentType);
      res.sendFile(filePath);
    } catch (err) {
      log.error({ err, id }, "GET evidence file failed");
      res.status(500).json({ error: "Failed to load the evidence file" });
    }
  },
);

export default router;
