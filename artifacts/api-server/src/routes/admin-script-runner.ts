/**
 * admin-script-runner.ts
 *
 * Routes for listing Azure Automation Runbooks, triggering runbook jobs,
 * and polling job output.
 *
 * GET  /api/admin/runbooks                        — list runbooks
 * POST /api/admin/runbook-jobs                    — create a job
 * GET  /api/admin/runbook-jobs/:jobId/output      — poll output (since=N seq)
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, azureTenantCredentialsTable, kanbanTasksTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { getCredential } from "../lib/azure-keyvault";
import {
  listRunbooks,
  createRunbookJob,
  getJobStatus,
  getJobOutput,
  isTerminalStatus,
} from "../lib/azure-automation";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function isAzureConfigMissing(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.message.includes("Missing Azure env vars") ||
      err.message.includes("AZURE_TENANT_ID") ||
      err.message.includes("AZURE_CLIENT_ID") ||
      err.message.includes("AZURE_KEY_VAULT_URL") ||
      err.message.includes("AZURE_SUBSCRIPTION_ID") ||
      err.message.includes("AZURE_AUTOMATION_"))
  );
}

router.get("/admin/runbooks", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const runbooks = await listRunbooks();
    res.json({ configured: true, runbooks });
  } catch (err) {
    if (isAzureConfigMissing(err)) {
      res.status(503).json({
        configured: false,
        error: "not_configured",
        message: "Azure Automation secrets are not set. Add AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID, AZURE_KEY_VAULT_URL, AZURE_SUBSCRIPTION_ID, AZURE_AUTOMATION_RESOURCE_GROUP, and AZURE_AUTOMATION_ACCOUNT_NAME to Replit Secrets.",
      });
      return;
    }
    logger.error({ err }, "admin-script-runner: failed to list runbooks");
    res.status(500).json({ configured: true, error: "Failed to list runbooks from Azure Automation" });
  }
});

interface CreateJobBody {
  credentialId: number;
  runbookName: string;
  kanbanTaskId?: number;
}

router.post("/admin/runbook-jobs", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { credentialId, runbookName, kanbanTaskId } = req.body as CreateJobBody;

    if (!credentialId || !runbookName) {
      res.status(400).json({ error: "credentialId and runbookName are required" });
      return;
    }

    const [cred] = await db
      .select()
      .from(azureTenantCredentialsTable)
      .where(eq(azureTenantCredentialsTable.id, credentialId))
      .limit(1);

    if (!cred) {
      res.status(404).json({ error: "Azure credential not found" });
      return;
    }

    const credentialValue = await getCredential(cred.keyVaultSecretName, cred.credentialType);

    const { jobId, status } = await createRunbookJob({
      runbookName,
      parameters: {
        TenantId: cred.tenantId,
        ClientId: cred.clientId,
        ...(cred.credentialType === "secret"
          ? { ClientSecret: credentialValue }
          : { CertificatePem: credentialValue }),
      },
    });

    if (kanbanTaskId) {
      try {
        const [task] = await db
          .select()
          .from(kanbanTasksTable)
          .where(eq(kanbanTasksTable.id, kanbanTaskId))
          .limit(1);

        if (task) {
          const meta = ((task.taskMetadata ?? {}) as Record<string, unknown>);
          await db
            .update(kanbanTasksTable)
            .set({
              taskMetadata: { ...meta, lastJobId: jobId, lastJobStatus: status },
              updatedAt: new Date(),
            })
            .where(eq(kanbanTasksTable.id, kanbanTaskId));
        }
      } catch (metaErr) {
        logger.warn({ metaErr, kanbanTaskId }, "admin-script-runner: could not update task metadata");
      }
    }

    res.status(201).json({ jobId, status });
  } catch (err) {
    logger.error({ err }, "admin-script-runner: failed to create runbook job");
    res.status(500).json({ error: "Failed to create runbook job" });
  }
});

/**
 * GET /api/admin/runbook-jobs/output?jobId=X&since=N[&kanbanTaskId=N]
 *
 * Polls the current job status and returns any output lines with sequence > `since`.
 * Used by the frontend with fetchWithAuth instead of EventSource so Bearer auth works.
 *
 * Response:
 *  { status, terminal, lines: [{ sequence, streamType, text }], kanbanMetaUpdated?: bool }
 */
router.get("/admin/runbook-jobs/output", requireAdmin, async (req: Request, res: Response) => {
  const jobId = req.query.jobId ? String(req.query.jobId) : undefined;
  if (!jobId) {
    res.status(400).json({ error: "jobId query parameter is required" });
    return;
  }
  const since = req.query.since ? Number(req.query.since) : -1;
  const kanbanTaskId = req.query.kanbanTaskId ? Number(req.query.kanbanTaskId) : undefined;

  try {
    const [statusResult, outputLines] = await Promise.all([
      getJobStatus(jobId),
      getJobOutput(jobId),
    ]);

    const newLines = outputLines.filter(l => l.sequence > since);
    const terminal = isTerminalStatus(statusResult.status);

    let kanbanMetaUpdated = false;
    if (terminal && kanbanTaskId) {
      try {
        const [task] = await db
          .select()
          .from(kanbanTasksTable)
          .where(eq(kanbanTasksTable.id, kanbanTaskId))
          .limit(1);

        if (task) {
          const meta = ((task.taskMetadata ?? {}) as Record<string, unknown>);
          await db
            .update(kanbanTasksTable)
            .set({
              taskMetadata: { ...meta, lastJobId: jobId, lastJobStatus: statusResult.status },
              updatedAt: new Date(),
            })
            .where(eq(kanbanTasksTable.id, kanbanTaskId));
          kanbanMetaUpdated = true;
        }
      } catch (metaErr) {
        logger.warn({ metaErr }, "admin-script-runner: could not update task metadata on completion");
      }
    }

    res.json({
      status: statusResult.status,
      statusDetails: statusResult.statusDetails,
      terminal,
      lines: newLines.map(l => ({ sequence: l.sequence, streamType: l.streamType, text: l.text })),
      kanbanMetaUpdated,
    });
  } catch (err) {
    logger.error({ err, jobId }, "admin-script-runner: output poll error");
    res.status(500).json({ error: "Failed to fetch job output" });
  }
});

export default router;
