/**
 * msp-automations.ts — the unified Automation wrapper API (Git #4354).
 *
 * One MSP-operator surface over the real `automations` table, which wraps a
 * Script Library script (#4291), a Runbook (#3479) or a Remediation Step
 * (#3471) and can additionally be linked to a POA&M, a Change Control / CAB
 * change request, and a Remediation Step. Consumed by MyArchitect (Epic #3454):
 * the Automation List panel and POA&M/Kanban's "Link to Automation" actions.
 *
 *   GET    /api/msp/customers/:customerId/automations              — list
 *   POST   /api/msp/customers/:customerId/automations              — create/wrap
 *   PATCH  /api/msp/customers/:customerId/automations/:id          — edit + (un)link
 *   DELETE /api/msp/customers/:customerId/automations/:id          — remove
 *   POST   /api/msp/customers/:customerId/automations/:id/run      — run (delegates)
 *   GET    /api/msp/customers/:customerId/automations/:id/history  — execution history
 *
 * `run` NEVER re-implements execution — it delegates to each wrapped type's own
 * existing mechanism (#4354 scope note):
 *   - script          → the Script Library download-token primitive
 *                       (lib/script-download-token.ts, shared with
 *                       portal-script-library.ts).
 *   - remediation_step→ the pointed re-scan the verify route fires
 *                       (emitWorkflowEvent "remediation.verify_requested").
 *   - runbook         → the runbook is a human checklist cycle (#3479); it has
 *                       no server-side executor by design, so run surfaces the
 *                       current cycle via the existing currentRunFor() helper.
 *
 * `history` is a read-through over the three real per-type execution-log
 * sources (script_run_results / portal_runbook_runs / the step's own
 * verification fields) — deliberately NOT a fourth history table (#4354).
 *
 * Auth: requireCapability("ladder.msp-operator") + assertCustomerAccess — the
 * same pattern as msp-automation-registry.ts.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  automationsTable,
  AUTOMATION_TYPES,
  type AutomationRow,
  powershellScriptsTable,
  portalRunbooksTable,
  remediationTrackerStepsTable,
  scriptRunResultsTable,
  portalRunbookRunsTable,
  mspPoamsTable,
  mspChangeRequestsTable,
  tenantsTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { requireCapability, assertCustomerAccess } from "../middlewares/requireAuth.ts";
import { logger } from "../lib/logger.ts";
import {
  generateScriptDownloadToken,
  ScriptDownloadTokenError,
} from "../lib/script-download-token.ts";
import { emitWorkflowEvent } from "../lib/workflow-executor.ts";
import { currentRunFor } from "../lib/portal-runbook-wire.ts";
import { stepCheckKeysFor } from "../lib/remediation-tracker-verification.ts";

const log = logger.child({ channel: "workflow.automation" });

const router: IRouter = Router();

// ── Wire mapper ─────────────────────────────────────────────────────────────
function toWire(row: AutomationRow) {
  return {
    id: row.id,
    customerId: row.customerId,
    type: row.type,
    wrappedRefId: row.wrappedRefId,
    name: row.name,
    description: row.description,
    linkedPoamId: row.linkedPoamId,
    linkedCabId: row.linkedCabId,
    linkedRemediationStepId: row.linkedRemediationStepId,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
  };
}

/** Parse+validate :customerId and confirm the caller may access it. */
async function resolveCustomer(req: Request, res: Response): Promise<number | null> {
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

/** The customer's owning mspId (JWT claim, falling back to the tenant row). */
async function resolveMspId(req: Request, customerId: number): Promise<number | null> {
  if (typeof req.user?.mspId === "number") return req.user.mspId;
  const [tenant] = await db
    .select({ mspId: tenantsTable.mspId })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, customerId))
    .limit(1);
  return tenant?.mspId ?? null;
}

/**
 * Confirm the wrapped underlying row exists and belongs to this customer/msp.
 * Returns an error string, or null when valid.
 */
async function validateWrappedRef(
  type: (typeof AUTOMATION_TYPES)[number],
  wrappedRefId: string,
  customerId: number,
): Promise<string | null> {
  if (type === "script") {
    const [row] = await db
      .select({ id: powershellScriptsTable.id })
      .from(powershellScriptsTable)
      .where(eq(powershellScriptsTable.id, wrappedRefId))
      .limit(1);
    return row ? null : "Wrapped script not found";
  }
  if (type === "runbook") {
    const numericId = Number(wrappedRefId);
    if (!Number.isInteger(numericId) || numericId <= 0) return "wrappedRefId must be the runbook row id";
    const [row] = await db
      .select({ id: portalRunbooksTable.id })
      .from(portalRunbooksTable)
      .where(and(eq(portalRunbooksTable.id, numericId), eq(portalRunbooksTable.customerId, customerId)))
      .limit(1);
    return row ? null : "Wrapped runbook not found for this customer";
  }
  // remediation_step — wrappedRefId is the stepId TEXT (e.g. "s1"), the system's
  // real per-(customer,step) identity; the numeric row id is never exposed.
  const [row] = await db
    .select({ id: remediationTrackerStepsTable.id })
    .from(remediationTrackerStepsTable)
    .where(and(eq(remediationTrackerStepsTable.stepId, wrappedRefId), eq(remediationTrackerStepsTable.customerId, customerId)))
    .limit(1);
  return row ? null : "Wrapped remediation step not found for this customer";
}

/** Resolve a remediation step's serial id from its (customer, stepId-text) key. */
async function resolveRemediationStepId(customerId: number, stepKey: string): Promise<number | null> {
  const [row] = await db
    .select({ id: remediationTrackerStepsTable.id })
    .from(remediationTrackerStepsTable)
    .where(and(eq(remediationTrackerStepsTable.stepId, stepKey), eq(remediationTrackerStepsTable.customerId, customerId)))
    .limit(1);
  return row?.id ?? null;
}

/** Validate optional governance links belong to the same customer/msp. */
async function validateLinks(
  links: { linkedPoamId?: number | null; linkedCabId?: number | null; linkedRemediationStepId?: number | null },
  customerId: number,
  mspId: number,
): Promise<string | null> {
  if (links.linkedPoamId != null) {
    const [row] = await db
      .select({ id: mspPoamsTable.id })
      .from(mspPoamsTable)
      .where(and(eq(mspPoamsTable.id, links.linkedPoamId), eq(mspPoamsTable.mspId, mspId)))
      .limit(1);
    if (!row) return "linkedPoamId not found for this MSP";
  }
  if (links.linkedCabId != null) {
    const [row] = await db
      .select({ id: mspChangeRequestsTable.id })
      .from(mspChangeRequestsTable)
      .where(and(eq(mspChangeRequestsTable.id, links.linkedCabId), eq(mspChangeRequestsTable.mspId, mspId)))
      .limit(1);
    if (!row) return "linkedCabId (change request) not found for this MSP";
  }
  if (links.linkedRemediationStepId != null) {
    const [row] = await db
      .select({ id: remediationTrackerStepsTable.id })
      .from(remediationTrackerStepsTable)
      .where(
        and(
          eq(remediationTrackerStepsTable.id, links.linkedRemediationStepId),
          eq(remediationTrackerStepsTable.customerId, customerId),
        ),
      )
      .limit(1);
    if (!row) return "linkedRemediationStepId not found for this customer";
  }
  return null;
}

/** Load one automation scoped to the customer. */
async function loadAutomation(id: number, customerId: number): Promise<AutomationRow | null> {
  const [row] = await db
    .select()
    .from(automationsTable)
    .where(and(eq(automationsTable.id, id), eq(automationsTable.customerId, customerId)))
    .limit(1);
  return row ?? null;
}

// ── GET list ────────────────────────────────────────────────────────────────
router.get(
  "/msp/customers/:customerId/automations",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const customerId = await resolveCustomer(req, res);
    if (customerId === null) return;
    try {
      const rows = await db
        .select()
        .from(automationsTable)
        .where(eq(automationsTable.customerId, customerId))
        .orderBy(desc(automationsTable.updatedAt));
      res.json({ automations: rows.map(toWire) });
    } catch (err) {
      log.error({ err, customerId }, "msp-automations: GET list failed");
      res.status(500).json({ error: "Failed to load automations" });
    }
  },
);

// ── POST create/wrap ──────────────────────────────────────────────────────────
const createSchema = z.object({
  type: z.enum(AUTOMATION_TYPES),
  wrappedRefId: z.string().min(1).max(200),
  name: z.string().min(1).max(500),
  description: z.string().max(4000).nullable().optional(),
  linkedPoamId: z.number().int().positive().nullable().optional(),
  linkedCabId: z.number().int().positive().nullable().optional(),
  linkedRemediationStepId: z.number().int().positive().nullable().optional(),
  // Client-facing alternative to linkedRemediationStepId: the step's (customer, stepId-text)
  // key, resolved to the numeric FK server-side (the numeric id is never exposed to clients).
  linkedRemediationStepKey: z.string().min(1).max(100).nullable().optional(),
});

router.post(
  "/msp/customers/:customerId/automations",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const customerId = await resolveCustomer(req, res);
    if (customerId === null) return;
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
      return;
    }
    try {
      const mspId = await resolveMspId(req, customerId);
      if (mspId === null) {
        res.status(404).json({ error: "Customer has no owning MSP" });
        return;
      }
      const refErr = await validateWrappedRef(parsed.data.type, parsed.data.wrappedRefId, customerId);
      if (refErr) {
        res.status(400).json({ error: refErr });
        return;
      }
      const linkErr = await validateLinks(parsed.data, customerId, mspId);
      if (linkErr) {
        res.status(400).json({ error: linkErr });
        return;
      }
      let linkedRemediationStepId = parsed.data.linkedRemediationStepId ?? null;
      if (parsed.data.linkedRemediationStepKey != null) {
        const resolved = await resolveRemediationStepId(customerId, parsed.data.linkedRemediationStepKey);
        if (resolved === null) {
          res.status(400).json({ error: "linkedRemediationStepKey not found for this customer" });
          return;
        }
        linkedRemediationStepId = resolved;
      }
      const [inserted] = await db
        .insert(automationsTable)
        .values({
          customerId,
          mspId,
          type: parsed.data.type,
          wrappedRefId: parsed.data.wrappedRefId,
          name: parsed.data.name,
          description: parsed.data.description ?? null,
          linkedPoamId: parsed.data.linkedPoamId ?? null,
          linkedCabId: parsed.data.linkedCabId ?? null,
          linkedRemediationStepId,
        })
        .returning();
      log.info({ customerId, id: inserted.id, type: inserted.type }, "automation created");
      res.status(201).json({ automation: toWire(inserted) });
    } catch (err) {
      log.error({ err, customerId }, "msp-automations: POST create failed");
      res.status(500).json({ error: "Failed to create automation" });
    }
  },
);

// ── PATCH edit + (un)link ─────────────────────────────────────────────────────
const patchSchema = z.object({
  name: z.string().min(1).max(500).optional(),
  description: z.string().max(4000).nullable().optional(),
  linkedPoamId: z.number().int().positive().nullable().optional(),
  linkedCabId: z.number().int().positive().nullable().optional(),
  linkedRemediationStepId: z.number().int().positive().nullable().optional(),
  // Set (stepId-text) or clear (null) the remediation-step link without the numeric id.
  linkedRemediationStepKey: z.string().min(1).max(100).nullable().optional(),
});

router.patch(
  "/msp/customers/:customerId/automations/:id",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const customerId = await resolveCustomer(req, res);
    if (customerId === null) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid automation id" });
      return;
    }
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
      return;
    }
    try {
      const existing = await loadAutomation(id, customerId);
      if (!existing) {
        res.status(404).json({ error: "Automation not found" });
        return;
      }
      const linkErr = await validateLinks(parsed.data, customerId, existing.mspId);
      if (linkErr) {
        res.status(400).json({ error: linkErr });
        return;
      }
      const patch: Partial<typeof automationsTable.$inferInsert> = { updatedAt: new Date() };
      if (parsed.data.name !== undefined) patch.name = parsed.data.name;
      if (parsed.data.description !== undefined) patch.description = parsed.data.description;
      if (parsed.data.linkedPoamId !== undefined) patch.linkedPoamId = parsed.data.linkedPoamId;
      if (parsed.data.linkedCabId !== undefined) patch.linkedCabId = parsed.data.linkedCabId;
      if (parsed.data.linkedRemediationStepKey !== undefined) {
        if (parsed.data.linkedRemediationStepKey === null) {
          patch.linkedRemediationStepId = null;
        } else {
          const resolved = await resolveRemediationStepId(customerId, parsed.data.linkedRemediationStepKey);
          if (resolved === null) {
            res.status(400).json({ error: "linkedRemediationStepKey not found for this customer" });
            return;
          }
          patch.linkedRemediationStepId = resolved;
        }
      } else if (parsed.data.linkedRemediationStepId !== undefined) {
        patch.linkedRemediationStepId = parsed.data.linkedRemediationStepId;
      }

      const [updated] = await db
        .update(automationsTable)
        .set(patch)
        .where(and(eq(automationsTable.id, id), eq(automationsTable.customerId, customerId)))
        .returning();
      res.json({ automation: toWire(updated) });
    } catch (err) {
      log.error({ err, customerId, id }, "msp-automations: PATCH failed");
      res.status(500).json({ error: "Failed to update automation" });
    }
  },
);

// ── DELETE ────────────────────────────────────────────────────────────────────
router.delete(
  "/msp/customers/:customerId/automations/:id",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const customerId = await resolveCustomer(req, res);
    if (customerId === null) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid automation id" });
      return;
    }
    try {
      const [deleted] = await db
        .delete(automationsTable)
        .where(and(eq(automationsTable.id, id), eq(automationsTable.customerId, customerId)))
        .returning({ id: automationsTable.id });
      if (!deleted) {
        res.status(404).json({ error: "Automation not found" });
        return;
      }
      log.info({ customerId, id }, "automation deleted");
      res.json({ ok: true, id: deleted.id });
    } catch (err) {
      log.error({ err, customerId, id }, "msp-automations: DELETE failed");
      res.status(500).json({ error: "Failed to delete automation" });
    }
  },
);

// ── POST run — delegates to each wrapped type's existing mechanism ─────────────
router.post(
  "/msp/customers/:customerId/automations/:id/run",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const customerId = await resolveCustomer(req, res);
    if (customerId === null) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid automation id" });
      return;
    }
    try {
      const automation = await loadAutomation(id, customerId);
      if (!automation) {
        res.status(404).json({ error: "Automation not found" });
        return;
      }

      if (automation.type === "script") {
        try {
          const result = await generateScriptDownloadToken({
            scriptId: automation.wrappedRefId,
            mspId: automation.mspId,
            customerId,
          });
          log.info({ customerId, id, tokenId: result.tokenId }, "automation run: script download token minted");
          res.json({
            delegatedTo: "script-download-token",
            status: "ready",
            message:
              "Script Library run: single-use download token minted. Run the returned script — results ingest back into history.",
            tokenId: result.tokenId,
            scriptTitle: result.scriptTitle,
            scriptType: result.scriptType,
            schemaVersion: result.schemaVersion,
            expiresAt: result.expiresAt instanceof Date ? result.expiresAt.toISOString() : result.expiresAt,
            scriptBody: result.scriptBody,
          });
        } catch (err) {
          if (err instanceof ScriptDownloadTokenError) {
            res.status(err.status).json({ error: err.message });
            return;
          }
          throw err;
        }
        return;
      }

      if (automation.type === "remediation_step") {
        // wrappedRefId is the stepId text (the system's per-(customer,step) identity).
        const [step] = await db
          .select({
            stepId: remediationTrackerStepsTable.stepId,
            status: remediationTrackerStepsTable.status,
          })
          .from(remediationTrackerStepsTable)
          .where(
            and(
              eq(remediationTrackerStepsTable.stepId, automation.wrappedRefId),
              eq(remediationTrackerStepsTable.customerId, customerId),
            ),
          )
          .limit(1);
        if (!step) {
          res.status(404).json({ error: "Wrapped remediation step not found" });
          return;
        }
        const mappedKeys = stepCheckKeysFor(step.stepId);
        if (!mappedKeys || mappedKeys.length === 0) {
          res.status(400).json({
            error: "This remediation step has no automated check behind it — there is nothing a re-scan could verify",
          });
          return;
        }
        if (step.status === "not_started") {
          res.status(400).json({ error: "Nothing to verify yet — this step has no claim on it" });
          return;
        }
        const [tenant] = await db
          .select({ tenantId: tenantsTable.tenantId })
          .from(tenantsTable)
          .where(eq(tenantsTable.id, customerId))
          .limit(1);
        if (!tenant?.tenantId) {
          res.status(400).json({ error: "No connected M365 tenant — nothing to re-scan against" });
          return;
        }
        await emitWorkflowEvent("remediation.verify_requested", { customerId, stepId: step.stepId });
        log.info({ customerId, id, stepId: step.stepId }, "automation run: remediation verify re-scan requested");
        res.status(202).json({
          delegatedTo: "remediation.verify_requested",
          status: "started",
          message:
            "Pointed verification started — poll the automation history (or the remediation tracker) for the result.",
          stepId: step.stepId,
          checkKeys: mappedKeys,
        });
        return;
      }

      // runbook — a human checklist cycle (#3479); no server-side executor by
      // design. Surface the current cycle via the existing helper.
      const runbookId = Number(automation.wrappedRefId);
      const run = await currentRunFor(runbookId);
      if (!run) {
        res.json({
          delegatedTo: "runbook-cycle",
          status: "no_active_cycle",
          message:
            "This runbook has no active cycle. Runbooks are advanced by checking off their steps in the Runbooks surface, not executed server-side.",
        });
        return;
      }
      log.info({ customerId, id, runbookId, cycleNumber: run.cycleNumber }, "automation run: runbook current cycle surfaced");
      res.json({
        delegatedTo: "runbook-cycle",
        status: run.status,
        message:
          "Runbooks are advanced by checking off their steps in the Runbooks surface. This is the current cycle.",
        runId: run.id,
        cycleNumber: run.cycleNumber,
        startedOn: run.startedOn,
        completedAt: run.completedAt instanceof Date ? run.completedAt.toISOString() : run.completedAt,
      });
    } catch (err) {
      log.error({ err, customerId, id }, "msp-automations: POST run failed");
      res.status(500).json({ error: "Failed to run automation" });
    }
  },
);

// ── GET history — read-through over the three real per-type sources ────────────
interface HistoryEntry {
  id: string;
  status: string;
  source: string;
  startedAt: string | null;
  finishedAt: string | null;
  summary: string;
}

router.get(
  "/msp/customers/:customerId/automations/:id/history",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const customerId = await resolveCustomer(req, res);
    if (customerId === null) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid automation id" });
      return;
    }
    try {
      const automation = await loadAutomation(id, customerId);
      if (!automation) {
        res.status(404).json({ error: "Automation not found" });
        return;
      }

      const iso = (d: Date | string | null | undefined): string | null =>
        d == null ? null : d instanceof Date ? d.toISOString() : String(d);

      let history: HistoryEntry[] = [];

      if (automation.type === "script") {
        const rows = await db
          .select()
          .from(scriptRunResultsTable)
          .where(eq(scriptRunResultsTable.libraryScriptId, automation.wrappedRefId))
          .orderBy(desc(scriptRunResultsTable.createdAt))
          .limit(50);
        history = rows.map((r) => ({
          id: String(r.id),
          status: r.status,
          source: `script:${r.executionSource}`,
          startedAt: iso(r.createdAt),
          finishedAt: iso(r.reviewedAt ?? r.uploadedAt ?? null),
          summary: `${r.scriptName ?? "Script run"} — ${r.parsedFindings?.length ?? 0} finding(s)`,
        }));
      } else if (automation.type === "runbook") {
        const rows = await db
          .select()
          .from(portalRunbookRunsTable)
          .where(eq(portalRunbookRunsTable.runbookId, Number(automation.wrappedRefId)))
          .orderBy(desc(portalRunbookRunsTable.cycleNumber))
          .limit(50);
        history = rows.map((r) => ({
          id: String(r.id),
          status: r.status,
          source: "runbook-cycle",
          startedAt: iso(r.startedOn),
          finishedAt: iso(r.completedAt),
          summary: `Cycle ${r.cycleNumber}`,
        }));
      } else {
        // remediation_step — the step's own verification fields are the log.
        const [step] = await db
          .select({
            verificationState: remediationTrackerStepsTable.verificationState,
            verifiedAt: remediationTrackerStepsTable.verifiedAt,
            verifiedByRunId: remediationTrackerStepsTable.verifiedByRunId,
          })
          .from(remediationTrackerStepsTable)
          .where(
            and(
              eq(remediationTrackerStepsTable.stepId, automation.wrappedRefId),
              eq(remediationTrackerStepsTable.customerId, customerId),
            ),
          )
          .limit(1);
        if (step && step.verificationState && step.verificationState !== "unverified") {
          history = [
            {
              id: step.verifiedByRunId ?? `verify-${automation.id}`,
              status: step.verificationState,
              source: "remediation-verify",
              startedAt: null,
              finishedAt: iso(step.verifiedAt),
              summary: `Verification: ${step.verificationState}`,
            },
          ];
        }
      }

      res.json({ history });
    } catch (err) {
      log.error({ err, customerId, id }, "msp-automations: GET history failed");
      res.status(500).json({ error: "Failed to load automation history" });
    }
  },
);

export default router;
