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
import { db, azureTenantCredentialsTable, clientAppRegistrationsTable, clientAutomationRunsTable, usersTable, projectsTable, kanbanTasksTable, runbookJobHistoryTable, scriptRunResultsTable, powershellScriptsTable, scriptModulesTable } from "@workspace/db";
import { eq, desc, and, inArray } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth.ts";
import { getCredential } from "../lib/azure-keyvault.ts";
import {
  listRunbooks,
  createRunbookJob,
  getJobStatus,
  getJobOutput,
  isTerminalStatus,
  pushScriptToAzure,
  isAzureConfigured,
} from "../lib/azure-automation.ts";
import { logger } from "../lib/logger.ts";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { sendAdminSms } from "../lib/sms.ts";
import { validatePsSyntax } from "../lib/ps-guard.ts";

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Fixed Azure runbook name used for IDE ad-hoc script executions. */
const ADHOC_RUNBOOK_NAME = "IDE-AdHoc";

interface CreateJobBody {
  /** Legacy credential from azureTenantCredentialsTable. Kept for backward compatibility. */
  credentialId?: number;
  /** Preferred: use client's App Registration from clientAppRegistrationsTable. */
  appRegistrationId?: number;
  /**
   * UUID of a powershell_scripts or script_modules row.
   * Server resolves azureRunbookName from DB.
   * Optional only when adHocContent is also provided (ad-hoc IDE runs that push
   * temporary content to the fixed ADHOC_RUNBOOK_NAME Azure runbook).
   */
  scriptId?: string;
  kanbanTaskId?: number;
  governanceAreas?: string[];
  /** When provided, pushes this PowerShell content to Azure as the runbook draft before starting the job (ad-hoc IDE run). */
  adHocContent?: string;
}

router.post("/admin/runbook-jobs", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { credentialId, appRegistrationId, scriptId, kanbanTaskId, governanceAreas, adHocContent } = req.body as CreateJobBody;

    if (!credentialId && !appRegistrationId) {
      res.status(400).json({ error: "Either appRegistrationId or credentialId is required" });
      return;
    }

    // Resolve the actual Azure runbook name from DB — DB is the single source of truth.
    // Exception: ad-hoc IDE runs (adHocContent without scriptId) use the fixed IDE-AdHoc runbook.
    let runbookName: string;
    let resolvedScriptName: string | null = null;
    if (scriptId) {
      if (!UUID_RE.test(scriptId)) {
        res.status(400).json({ error: "scriptId must be a valid UUID" });
        return;
      }
      const [psScript] = await db
        .select({ azureRunbookName: powershellScriptsTable.azureRunbookName, title: powershellScriptsTable.title })
        .from(powershellScriptsTable)
        .where(eq(powershellScriptsTable.id, scriptId))
        .limit(1);
      if (psScript) {
        if (!psScript.azureRunbookName) {
          res.status(400).json({ error: "This script has not been pushed to Azure Automation yet — push it first from the Library editor" });
          return;
        }
        runbookName = psScript.azureRunbookName;
        resolvedScriptName = psScript.title ?? null;
      } else {
        const [mod] = await db
          .select({ azureRunbookName: scriptModulesTable.azureRunbookName, filename: scriptModulesTable.filename })
          .from(scriptModulesTable)
          .where(eq(scriptModulesTable.id, scriptId))
          .limit(1);
        if (!mod) {
          res.status(404).json({ error: `Script ${scriptId} not found in powershell_scripts or script_modules` });
          return;
        }
        if (!mod.azureRunbookName) {
          res.status(400).json({ error: "This module has not been pushed to Azure Automation yet — push it first from the Script Sets editor" });
          return;
        }
        runbookName = mod.azureRunbookName;
        resolvedScriptName = mod.filename ? mod.filename.replace(/\.ps1$/i, "") : null;
      }
      logger.info({ scriptId, runbookName }, "admin-script-runner: resolved runbookName from DB");
    } else if (adHocContent?.trim()) {
      // Ad-hoc IDE run without a DB-backed script — use fixed runbook slot
      runbookName = ADHOC_RUNBOOK_NAME;
      resolvedScriptName = "Ad-hoc Script";
      logger.info({ runbookName }, "admin-script-runner: ad-hoc run using fixed runbook slot");
    } else {
      res.status(400).json({ error: "scriptId (UUID) is required, or provide adHocContent for an ad-hoc run" });
      return;
    }

    // Ad-hoc run: push the editor content to Azure as the runbook draft before starting
    if (adHocContent?.trim()) {
      if (!isAzureConfigured()) {
        res.status(503).json({ error: "Azure Automation is not configured — cannot push ad-hoc script" });
        return;
      }
      try {
        await pushScriptToAzure(runbookName, adHocContent.trim());
        logger.info({ runbookName }, "admin-script-runner: pushed ad-hoc script content to Azure");
      } catch (pushErr) {
        const msg = pushErr instanceof Error ? pushErr.message : String(pushErr);
        logger.error({ pushErr, runbookName }, "admin-script-runner: failed to push ad-hoc content");
        res.status(502).json({ error: `Failed to upload script to Azure: ${msg}` });
        return;
      }
    }

    // ── Resolve credentials ────────────────────────────────────────────────────
    let tenantId: string;
    let clientId: string;
    let credentialValue: string;
    let credentialType: "secret" | "certificate" = "secret";
    let historyCredentialId: number | null = null;
    let customerName: string = "Unknown";
    let clientUserIdForRun: number | null = null;

    if (appRegistrationId) {
      // Preferred path: use client's App Registration
      const [appReg] = await db
        .select()
        .from(clientAppRegistrationsTable)
        .where(eq(clientAppRegistrationsTable.id, appRegistrationId))
        .limit(1);

      if (!appReg) {
        res.status(404).json({ error: "App Registration not found" });
        return;
      }

      tenantId = appReg.tenantId;
      clientId = appReg.azureClientId;
      clientUserIdForRun = appReg.clientUserId ?? null;

      // Fetch customer name for the history record
      const [user] = await db
        .select({ name: usersTable.name })
        .from(usersTable)
        .where(eq(usersTable.id, appReg.clientUserId))
        .limit(1);
      customerName = user?.name ?? `Client #${appReg.clientUserId}`;

      try {
        credentialValue = await getCredential(appReg.keyVaultSecretName, "secret");
      } catch (kvErr) {
        const msg = kvErr instanceof Error ? kvErr.message : String(kvErr);
        logger.error({ kvErr, secretName: appReg.keyVaultSecretName }, "admin-script-runner: Key Vault fetch failed (App Registration)");
        res.status(502).json({ error: `Key Vault error: ${msg}` });
        return;
      }
    } else {
      // Legacy path: use azureTenantCredentialsTable entry
      const [cred] = await db
        .select()
        .from(azureTenantCredentialsTable)
        .where(eq(azureTenantCredentialsTable.id, credentialId!))
        .limit(1);

      if (!cred) {
        res.status(404).json({ error: "Azure credential not found" });
        return;
      }

      tenantId = cred.tenantId;
      clientId = cred.clientId;
      credentialType = (cred.credentialType as typeof credentialType) ?? "secret";
      customerName = cred.displayName;
      historyCredentialId = cred.id;

      try {
        credentialValue = await getCredential(cred.keyVaultSecretName, cred.credentialType);
      } catch (kvErr) {
        const msg = kvErr instanceof Error ? kvErr.message : String(kvErr);
        logger.error({ kvErr, secretName: cred.keyVaultSecretName }, "admin-script-runner: Key Vault fetch failed");
        res.status(502).json({ error: `Key Vault error: ${msg}` });
        return;
      }
    }

    // For the legacy credentialId path: try to resolve clientUserId via kanban task → project
    // so we can still create a clientAutomationRunsTable row and show CRM progress.
    if (!clientUserIdForRun && kanbanTaskId) {
      try {
        const [taskRow] = await db
          .select({ projectId: kanbanTasksTable.projectId })
          .from(kanbanTasksTable)
          .where(eq(kanbanTasksTable.id, kanbanTaskId))
          .limit(1);
        if (taskRow?.projectId) {
          const [projectRow] = await db
            .select({ clientUserId: projectsTable.clientUserId })
            .from(projectsTable)
            .where(eq(projectsTable.id, taskRow.projectId))
            .limit(1);
          if (projectRow?.clientUserId) {
            clientUserIdForRun = projectRow.clientUserId;
          }
        }
      } catch {
        // non-fatal — proceed without automation run
      }
    }

    const hasAreas = Array.isArray(governanceAreas) && governanceAreas.length > 0;

    let jobId: string;
    let status: string;
    try {
      ({ jobId, status } = await createRunbookJob({
        runbookName,
        parameters: {
          TenantId: tenantId,
          ClientId: clientId,
          ...(credentialType === "secret"
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
        credentialId: historyCredentialId,
        customerName,
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

    let automationRunId: number | undefined;
    if (clientUserIdForRun) {
      try {
        const [autoRun] = await db
          .insert(clientAutomationRunsTable)
          .values({
            clientUserId: clientUserIdForRun,
            status: "running",
            modulesTotal: 0,
            modulesCompleted: 0,
            lastLogSnippet: runbookName,
          })
          .returning({ id: clientAutomationRunsTable.id });
        automationRunId = autoRun?.id;
      } catch (autoRunErr) {
        logger.warn({ autoRunErr, clientUserIdForRun }, "admin-script-runner: could not insert automation run (non-fatal)");
      }
    }

    // Create a script_run_results placeholder so the Results tab shows this run immediately.
    let runResultId: number | undefined;
    try {
      const [resultRow] = await db
        .insert(scriptRunResultsTable)
        .values({
          customerId: clientUserIdForRun ?? null,
          jobId,
          kanbanTaskId: kanbanTaskId ?? null,
          status: "running",
          executionSource: "manual",
          scriptName: resolvedScriptName,
        })
        .returning({ id: scriptRunResultsTable.id });
      runResultId = resultRow?.id;
    } catch (resultErr) {
      logger.warn({ resultErr, jobId }, "admin-script-runner: could not insert script_run_results placeholder (non-fatal)");
    }

    res.status(201).json({ jobId, status, automationRunId, runResultId });
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
  const automationRunId = req.query.automationRunId ? Number(req.query.automationRunId) : undefined;

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

      // Update script_run_results row with final output and status
      try {
        const fullOutput = outputLines.map(l => l.text).join("\n");
        const finalStatus = statusResult.status === "Completed" ? "completed" : "failed";
        await db
          .update(scriptRunResultsTable)
          .set({
            status: finalStatus,
            rawOutput: { text: fullOutput, azureStatus: statusResult.status },
          })
          .where(eq(scriptRunResultsTable.jobId, jobId));
      } catch (resultErr) {
        logger.warn({ resultErr, jobId }, "admin-script-runner: could not update script_run_results on completion (non-fatal)");
      }

      if (automationRunId) {
        try {
          const lastLine = outputLines.filter(l => l.text.trim()).slice(-1)[0]?.text ?? null;
          await db
            .update(clientAutomationRunsTable)
            .set({
              status: statusResult.status === "Completed" ? "completed" : "failed",
              finishedAt: new Date(),
              lastLogSnippet: lastLine,
            })
            .where(eq(clientAutomationRunsTable.id, automationRunId));
        } catch (autoRunErr) {
          logger.warn({ autoRunErr, automationRunId }, "admin-script-runner: could not update automation run on completion (non-fatal)");
        }
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
              taskMetadata: { ...meta, lastJobId: jobId, lastJobStatus: statusResult.status, runningJobRef: null },
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
 * POST /api/admin/scripts/validate-syntax
 *
 * Validates PowerShell syntax by spawning pwsh on the server.
 * Returns { valid: true } on success, { valid: false, errors: [...] } on parse
 * errors, or { valid: true, skipped: true } when pwsh is not available.
 *
 * Body: { content: string }
 */
router.post("/admin/scripts/validate-syntax", requireAdmin, async (req: Request, res: Response) => {
  const { content } = req.body as { content?: string };

  if (!content || typeof content !== "string") {
    res.status(400).json({ error: "content is required" });
    return;
  }

  const result = await validatePsSyntax(content);
  res.json(result);
});

/**
 * POST /api/admin/scripts/analyze
 *
 * Sends the log output from a completed runbook job to Claude for AI-powered
 * analysis. Returns structured JSON: summary, risks, recommendations, nextSteps.
 */
router.post("/admin/scripts/analyze-output", requireAdmin, async (req: Request, res: Response) => {
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

/**
 * GET /api/admin/script-runs?customerId=N&status=running|completed|failed&limit=200
 *
 * Returns a list of script_run_results joined with customer name and script title,
 * newest first. Used by the Running Scripts history page.
 */
router.get("/admin/script-runs", requireAdmin, async (req: Request, res: Response) => {
  const rawLimit = Number(req.query.limit ?? 200);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 200;
  const customerIdRaw = req.query.customerId ? Number(req.query.customerId) : NaN;
  const customerId = Number.isFinite(customerIdRaw) && customerIdRaw > 0 ? customerIdRaw : undefined;
  const statusFilter = req.query.status ? String(req.query.status) : undefined;
  const VALID_STATUSES = ["running", "completed", "failed", "awaiting_upload"] as const;

  try {
    const conditions = [];
    if (customerId) conditions.push(eq(scriptRunResultsTable.customerId, customerId));
    if (statusFilter && VALID_STATUSES.includes(statusFilter as typeof VALID_STATUSES[number])) {
      conditions.push(eq(scriptRunResultsTable.status, statusFilter as typeof VALID_STATUSES[number]));
    }

    const rows = await db
      .select({
        id: scriptRunResultsTable.id,
        status: scriptRunResultsTable.status,
        executionSource: scriptRunResultsTable.executionSource,
        jobId: scriptRunResultsTable.jobId,
        createdAt: scriptRunResultsTable.createdAt,
        customerId: scriptRunResultsTable.customerId,
        libraryScriptId: scriptRunResultsTable.libraryScriptId,
        kanbanTaskId: scriptRunResultsTable.kanbanTaskId,
        // Customer name via join
        customerName: usersTable.name,
        // Script title via join (fallback when scriptName column is null)
        scriptTitleJoin: powershellScriptsTable.title,
        scriptName: scriptRunResultsTable.scriptName,
      })
      .from(scriptRunResultsTable)
      .leftJoin(usersTable, eq(scriptRunResultsTable.customerId, usersTable.id))
      .leftJoin(powershellScriptsTable, eq(scriptRunResultsTable.libraryScriptId, powershellScriptsTable.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(scriptRunResultsTable.createdAt))
      .limit(limit);

    // Enrich: for rows with a jobId, look up completedAt from runbook_job_history
    const jobIds = rows.filter(r => r.jobId).map(r => r.jobId as string);
    let jobCompletedAtMap: Map<string, Date | null> = new Map();
    if (jobIds.length > 0) {
      const histRows = await db
        .select({ jobId: runbookJobHistoryTable.jobId, completedAt: runbookJobHistoryTable.completedAt })
        .from(runbookJobHistoryTable)
        .where(inArray(runbookJobHistoryTable.jobId, jobIds));
      for (const h of histRows) {
        jobCompletedAtMap.set(h.jobId, h.completedAt);
      }
    }

    const result = rows.map(r => ({
      id: r.id,
      status: r.status,
      executionSource: r.executionSource,
      jobId: r.jobId,
      createdAt: r.createdAt,
      completedAt: r.jobId ? (jobCompletedAtMap.get(r.jobId) ?? null) : null,
      customerId: r.customerId,
      customerName: r.customerName ?? null,
      libraryScriptId: r.libraryScriptId,
      scriptTitle: r.scriptName ?? r.scriptTitleJoin ?? null,
      kanbanTaskId: r.kanbanTaskId,
    }));

    res.json(result);
  } catch (err) {
    logger.error({ err }, "admin-script-runner: failed to fetch script runs");
    res.status(500).json({ error: "Failed to fetch script runs" });
  }
});

/**
 * GET /api/admin/script-runs/:id
 *
 * Returns the full detail for a single script_run_results row:
 * rawOutput, parsedFindings, recommendations, scoreImpact, profileUpdates,
 * status, jobId, timestamps, customerName, and scriptTitle via joins.
 */
router.get("/admin/script-runs/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  try {
    const [row] = await db
      .select({
        id: scriptRunResultsTable.id,
        status: scriptRunResultsTable.status,
        executionSource: scriptRunResultsTable.executionSource,
        jobId: scriptRunResultsTable.jobId,
        rawOutput: scriptRunResultsTable.rawOutput,
        parsedFindings: scriptRunResultsTable.parsedFindings,
        recommendations: scriptRunResultsTable.recommendations,
        scoreImpact: scriptRunResultsTable.scoreImpact,
        profileUpdates: scriptRunResultsTable.profileUpdates,
        createdAt: scriptRunResultsTable.createdAt,
        customerId: scriptRunResultsTable.customerId,
        libraryScriptId: scriptRunResultsTable.libraryScriptId,
        kanbanTaskId: scriptRunResultsTable.kanbanTaskId,
        customerName: usersTable.name,
        scriptTitleJoin: powershellScriptsTable.title,
        scriptName: scriptRunResultsTable.scriptName,
      })
      .from(scriptRunResultsTable)
      .leftJoin(usersTable, eq(scriptRunResultsTable.customerId, usersTable.id))
      .leftJoin(powershellScriptsTable, eq(scriptRunResultsTable.libraryScriptId, powershellScriptsTable.id))
      .where(eq(scriptRunResultsTable.id, id))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Script run not found" });
      return;
    }

    // Fetch completedAt from job history if we have a jobId
    let completedAt: Date | null = null;
    if (row.jobId) {
      const [hist] = await db
        .select({ completedAt: runbookJobHistoryTable.completedAt })
        .from(runbookJobHistoryTable)
        .where(eq(runbookJobHistoryTable.jobId, row.jobId))
        .limit(1);
      completedAt = hist?.completedAt ?? null;
    }

    res.json({
      ...row,
      completedAt,
      customerName: row.customerName ?? null,
      scriptTitle: row.scriptName ?? row.scriptTitleJoin ?? null,
    });
  } catch (err) {
    logger.error({ err, id }, "admin-script-runner: failed to fetch script run detail");
    res.status(500).json({ error: "Failed to fetch script run detail" });
  }
});

// ─── DELETE /api/admin/script-runs/:id ────────────────────────────────────────

router.delete("/admin/script-runs/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  try {
    const [deleted] = await db
      .delete(scriptRunResultsTable)
      .where(eq(scriptRunResultsTable.id, id))
      .returning({ id: scriptRunResultsTable.id });

    if (!deleted) {
      res.status(404).json({ error: "Script run not found" });
      return;
    }

    req.log.info({ id }, "admin-script-runner: script run result deleted");
    res.status(200).json({ ok: true });
  } catch (err) {
    logger.error({ err, id }, "admin-script-runner: failed to delete script run result");
    res.status(500).json({ error: "Failed to delete script run result" });
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
