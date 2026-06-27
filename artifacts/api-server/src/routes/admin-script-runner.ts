/**
 * admin-script-runner.ts
 *
 * Routes for listing Azure Automation Runbooks, triggering runbook jobs,
 * and polling job output.
 *
 * GET  /api/admin/runbooks                        — list runbooks
 * POST /api/admin/runbook-jobs                    — create a job
 * GET  /api/admin/runbook-jobs/output             — poll output (since=N seq)
 * GET  /api/admin/runbook-jobs/history            — list past job history
 * GET  /api/admin/runbook-jobs/:jobId/replay      — replay stored output for a past job
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, azureTenantCredentialsTable, kanbanTasksTable, runbookJobHistoryTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
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
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { sendAdminSms } from "../lib/sms";

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
  governanceAreas?: string[];
}

router.post("/admin/runbook-jobs", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { credentialId, runbookName, kanbanTaskId, governanceAreas } = req.body as CreateJobBody;

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

    let credentialValue: string;
    try {
      credentialValue = await getCredential(cred.keyVaultSecretName, cred.credentialType);
    } catch (kvErr) {
      const msg = kvErr instanceof Error ? kvErr.message : String(kvErr);
      logger.error({ kvErr, secretName: cred.keyVaultSecretName }, "admin-script-runner: Key Vault fetch failed");
      res.status(502).json({ error: `Key Vault error: ${msg}` });
      return;
    }

    const hasAreas = Array.isArray(governanceAreas) && governanceAreas.length > 0;

    let jobId: string;
    let status: string;
    try {
      ({ jobId, status } = await createRunbookJob({
        runbookName,
        parameters: {
          TenantId: cred.tenantId,
          ClientId: cred.clientId,
          ...(cred.credentialType === "secret"
            ? { ClientSecret: credentialValue }
            : { CertificatePem: credentialValue }),
          ...(hasAreas ? { GovernanceAreas: governanceAreas!.join(",") } : {}),
        },
      }));
    } catch (azErr) {
      const raw = azErr instanceof Error ? azErr.message : String(azErr);
      logger.error({ azErr, runbookName }, "admin-script-runner: Azure Automation job.create failed");
      res.status(502).json({ error: `Azure Automation error: ${raw}` });
      return;
    }

    // Persist job history record immediately
    try {
      await db.insert(runbookJobHistoryTable).values({
        jobId,
        runbookName,
        credentialId: cred.id,
        customerName: cred.displayName,
        status,
        startedAt: new Date(),
      });
    } catch (histErr) {
      logger.warn({ histErr, jobId }, "admin-script-runner: could not insert job history record");
    }

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

    // Update job history when terminal status reached
    if (terminal) {
      try {
        const fullOutput = outputLines.map(l => l.text).join("\n");
        await db
          .update(runbookJobHistoryTable)
          .set({
            status: statusResult.status,
            output: fullOutput,
            completedAt: new Date(),
          })
          .where(eq(runbookJobHistoryTable.jobId, jobId));
      } catch (histErr) {
        logger.warn({ histErr, jobId }, "admin-script-runner: could not update job history on completion");
      }
    } else {
      // Update running status in history
      try {
        await db
          .update(runbookJobHistoryTable)
          .set({ status: statusResult.status })
          .where(eq(runbookJobHistoryTable.jobId, jobId));
      } catch {
        // non-critical
      }
    }

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

/**
 * GET /api/admin/runbook-jobs/history?limit=50&credentialId=N
 *
 * Returns the last N runbook job history records, newest first.
 */
router.get("/admin/runbook-jobs/history", requireAdmin, async (req: Request, res: Response) => {
  const rawLimit = Number(req.query.limit ?? 50);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50;
  const rawCredId = req.query.credentialId ? Number(req.query.credentialId) : NaN;
  const credentialId = Number.isFinite(rawCredId) && rawCredId > 0 ? rawCredId : undefined;

  try {
    const query = db
      .select()
      .from(runbookJobHistoryTable)
      .orderBy(desc(runbookJobHistoryTable.startedAt))
      .limit(limit);

    const rows = credentialId
      ? await db
          .select()
          .from(runbookJobHistoryTable)
          .where(eq(runbookJobHistoryTable.credentialId, credentialId))
          .orderBy(desc(runbookJobHistoryTable.startedAt))
          .limit(limit)
      : await query;

    res.json(rows);
  } catch (err) {
    logger.error({ err }, "admin-script-runner: failed to fetch job history");
    res.status(500).json({ error: "Failed to fetch job history" });
  }
});

/**
 * POST /api/admin/runbook-jobs/:jobId/refetch-output
 *
 * Re-fetches job stream output from Azure Automation for a terminal job whose
 * stored output column is empty, then persists the result to the history table.
 * Returns the same line array shape as the replay endpoint so the frontend can
 * load the freshly fetched content directly into the console panel.
 */
router.post("/admin/runbook-jobs/:jobId/refetch-output", requireAdmin, async (req: Request, res: Response) => {
  const jobId = String(req.params.jobId);

  try {
    const [row] = await db
      .select()
      .from(runbookJobHistoryTable)
      .where(eq(runbookJobHistoryTable.jobId, jobId))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Job not found in history" });
      return;
    }

    const TERMINAL = new Set(["Completed", "Failed", "Stopped", "Suspended"]);
    if (!TERMINAL.has(row.status)) {
      res.status(409).json({ error: "Job is not in a terminal state — output may still be accumulating" });
      return;
    }

    const outputLines = await getJobOutput(jobId);
    const fullOutput = outputLines.map(l => l.text).join("\n");

    await db
      .update(runbookJobHistoryTable)
      .set({
        output: fullOutput || null,
        completedAt: row.completedAt ?? new Date(),
      })
      .where(eq(runbookJobHistoryTable.jobId, jobId));

    logger.info({ jobId, lineCount: outputLines.length }, "admin-script-runner: refetched job output");

    res.json({
      jobId: row.jobId,
      runbookName: row.runbookName,
      customerName: row.customerName,
      status: row.status,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      lines: outputLines.map(l => ({ sequence: l.sequence, streamType: l.streamType, text: l.text })),
    });
  } catch (err) {
    if (isAzureConfigMissing(err)) {
      res.status(503).json({ error: "Azure Automation is not configured — cannot fetch stream output" });
      return;
    }
    logger.error({ err, jobId }, "admin-script-runner: failed to refetch job output");
    res.status(500).json({ error: "Failed to refetch job output from Azure Automation" });
  }
});

/**
 * GET /api/admin/runbook-jobs/:jobId/replay
 *
 * Returns the stored output lines for a completed job from the history table.
 * Used by the frontend to replay past job output without hitting Azure Automation.
 */
router.get("/admin/runbook-jobs/:jobId/replay", requireAdmin, async (req: Request, res: Response) => {
  const jobId = String(req.params.jobId);

  try {
    const [row] = await db
      .select()
      .from(runbookJobHistoryTable)
      .where(eq(runbookJobHistoryTable.jobId, jobId))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Job not found in history" });
      return;
    }

    const lines = (row.output ?? "")
      .split("\n")
      .map((text, i) => ({ sequence: i, text }));

    res.json({
      jobId: row.jobId,
      runbookName: row.runbookName,
      customerName: row.customerName,
      status: row.status,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      lines,
    });
  } catch (err) {
    logger.error({ err, jobId }, "admin-script-runner: failed to replay job output");
    res.status(500).json({ error: "Failed to replay job output" });
  }
});

/**
 * POST /api/admin/scripts/analyze
 *
 * Sends the log output from a completed runbook job to Claude for AI-powered
 * analysis. Returns structured JSON: summary, risks, recommendations, nextSteps.
 */
router.post("/admin/scripts/analyze", requireAdmin, async (req: Request, res: Response) => {
  const { output, runbookName, customerName } = req.body as {
    output?: string;
    runbookName?: string;
    customerName?: string;
  };

  if (!output || typeof output !== "string" || !output.trim()) {
    res.status(400).json({ error: "output is required" });
    return;
  }

  const prompt = `You are a Microsoft 365 and Azure automation expert. Analyze the following PowerShell runbook execution output and provide a structured assessment.

Runbook: ${runbookName ?? "Unknown Runbook"}
Customer Tenant: ${customerName ?? "Unknown Customer"}

=== EXECUTION OUTPUT ===
${output.slice(0, 7000)}
=== END OUTPUT ===

Return a JSON object with exactly these fields:
{
  "summary": "2-3 sentence plain-English summary of what the runbook did and the overall outcome",
  "risks": ["specific risk or issue found in the output"],
  "recommendations": ["actionable recommendation based on what was found"],
  "nextSteps": ["concrete next step for the M365 administrator"]
}

Rules:
- Provide 2-5 items per array
- Be specific about what you see in the output — reference actual values, errors, or warnings where present
- If the output shows errors, surface them clearly in risks
- Focus on Microsoft 365 security, governance, and Copilot readiness implications
- Return ONLY the JSON object, no markdown fences, no other text`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = message.content.find(b => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      res.status(500).json({ error: "No text response from AI" });
      return;
    }

    const raw = textBlock.text.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn({ raw: raw.slice(0, 200) }, "admin-script-runner: AI response was not parseable JSON");
      res.status(500).json({ error: "AI response was not valid JSON" });
      return;
    }

    const result = JSON.parse(jsonMatch[0]) as {
      summary: string;
      risks: string[];
      recommendations: string[];
      nextSteps: string[];
    };

    res.json(result);
  } catch (err) {
    logger.error({ err }, "admin-script-runner: AI analysis failed");
    res.status(500).json({ error: "AI analysis failed — check server logs" });
  }
});

// ─── POST /api/admin/test-sms ─────────────────────────────────────────────────
router.post("/admin/test-sms", requireAdmin, async (_req: Request, res: Response) => {
  const missing: string[] = [];
  if (!process.env.TWILIO_ACCOUNT_SID)  missing.push("TWILIO_ACCOUNT_SID");
  if (!process.env.TWILIO_AUTH_TOKEN)   missing.push("TWILIO_AUTH_TOKEN");
  if (!process.env.TWILIO_FROM_NUMBER)  missing.push("TWILIO_FROM_NUMBER");
  if (!process.env.SHANE_PHONE_NUMBER)  missing.push("SHANE_PHONE_NUMBER");

  if (missing.length > 0) {
    res.status(503).json({
      error: `SMS not configured — missing secrets: ${missing.join(", ")}`,
    });
    return;
  }

  try {
    await sendAdminSms("✅ Test message from Shane McCaw Consulting admin portal — Twilio is working.");
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "admin test-sms: send failed");
    res.status(500).json({ error: "SMS send failed — check server logs for details." });
  }
});

export default router;
