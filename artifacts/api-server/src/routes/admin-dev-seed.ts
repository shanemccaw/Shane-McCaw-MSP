/**
 * admin-dev-seed.ts
 *
 * Dev-only endpoint for injecting synthetic M365 tenant script run results.
 * Registered in the router ONLY when NODE_ENV !== 'production'.
 *
 * POST /api/admin/dev/seed-result
 *   body: { type: 'good' | 'warning' | 'bad' | 'random', clientId?: number }
 *   Returns: { runResultId, clientId, findings, recommendations, scoreImpact }
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, scriptRunResultsTable, clientScoresTable, clientM365ProfilesTable, clientHealthHistoryTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth.ts";
import { logger } from "../lib/logger.ts";
import { runAiAnalyzer } from "../lib/ai-analyzer.ts";
import { parseM365ScriptOutput, normaliseProfileUpdates } from "../lib/parse-m365-script-output.ts";
import { computeM365Scores, type M365ScoreCategory } from "../lib/m365-scores.ts";
import { goodTenant, warningTenant, badTenant, generateRandomTenant, type M365TenantFixture } from "../lib/dev-fixtures.ts";

const router: IRouter = Router();

// ── Helpers (minimal copies — avoid importing from admin-m365-run to keep paths clean) ──

function clampScore(current: number, delta: number): number {
  return Math.max(0, Math.min(100, current + delta));
}

async function applyScoreImpact(clientId: number, scoreImpact: Record<string, number>): Promise<void> {
  if (Object.keys(scoreImpact).length === 0) return;

  const [existing] = await db
    .select()
    .from(clientScoresTable)
    .where(eq(clientScoresTable.clientId, clientId))
    .limit(1);

  const base = {
    identity: existing?.identity ?? 0,
    security: existing?.security ?? 0,
    collaboration: existing?.collaboration ?? 0,
    compliance: existing?.compliance ?? 0,
    copilotReadiness: existing?.copilotReadiness ?? 0,
  };

  const updated = {
    identity: scoreImpact.identity !== undefined ? clampScore(base.identity, scoreImpact.identity) : base.identity,
    security: scoreImpact.security !== undefined ? clampScore(base.security, scoreImpact.security) : base.security,
    collaboration: scoreImpact.collaboration !== undefined ? clampScore(base.collaboration, scoreImpact.collaboration) : base.collaboration,
    compliance: scoreImpact.compliance !== undefined ? clampScore(base.compliance, scoreImpact.compliance) : base.compliance,
    copilotReadiness: scoreImpact.copilotReadiness !== undefined ? clampScore(base.copilotReadiness, scoreImpact.copilotReadiness) : base.copilotReadiness,
  };

  if (existing) {
    await db.update(clientScoresTable).set({ ...updated, updatedAt: new Date() }).where(eq(clientScoresTable.clientId, clientId));
  } else {
    await db.insert(clientScoresTable).values({ clientId, ...updated });
  }
}

async function applyProfileUpdates(clientId: number, profileUpdates: Record<string, unknown>): Promise<void> {
  if (Object.keys(profileUpdates).length === 0) return;

  const normalised = normaliseProfileUpdates(profileUpdates);

  const [existing] = await db
    .select()
    .from(clientM365ProfilesTable)
    .where(eq(clientM365ProfilesTable.clientId, clientId))
    .limit(1);

  const existingProfile = (existing?.profile as Record<string, unknown>) ?? {};
  const merged = { ...normaliseProfileUpdates(existingProfile), ...normalised };

  if (existing) {
    await db.update(clientM365ProfilesTable).set({ profile: merged, updatedAt: new Date() }).where(eq(clientM365ProfilesTable.clientId, clientId));
  } else {
    await db.insert(clientM365ProfilesTable).values({ clientId, profile: merged });
  }
}

async function snapshotHealthFromProfile(clientId: number): Promise<void> {
  const [row] = await db
    .select({ profile: clientM365ProfilesTable.profile })
    .from(clientM365ProfilesTable)
    .where(eq(clientM365ProfilesTable.clientId, clientId))
    .limit(1);

  if (!row?.profile) return;

  const scores = computeM365Scores(row.profile as Record<string, unknown>);
  const now = new Date();

  await db.insert(clientHealthHistoryTable).values(
    (Object.entries(scores) as [M365ScoreCategory, number][]).map(([category, score]) => ({
      clientId,
      category,
      score,
      recordedAt: now,
    }))
  );
}

function fixtureLabel(type: string): string {
  const map: Record<string, string> = {
    good: "Good Tenant",
    warning: "Warning Tenant",
    bad: "Bad Tenant",
    random: "Random Tenant",
  };
  return map[type] ?? type;
}

// ── POST /api/admin/dev/seed-result ──────────────────────────────────────────

router.post("/admin/dev/seed-result", requireAdmin, async (req: Request, res: Response) => {
  const { type, clientId } = req.body as { type?: string; clientId?: number };

  if (!type || !["good", "warning", "bad", "random"].includes(type)) {
    res.status(400).json({ error: "type must be one of: good, warning, bad, random" });
    return;
  }

  let fixture: M365TenantFixture;
  if (type === "good") fixture = goodTenant;
  else if (type === "warning") fixture = warningTenant;
  else if (type === "bad") fixture = badTenant;
  else fixture = generateRandomTenant();

  const scriptOutput = JSON.stringify(fixture, null, 2);
  const label = fixtureLabel(type);
  const scriptName = `M365 Tenant Discovery (dev seed) · ${label}`;

  let customerName: string | null = null;
  if (clientId) {
    const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, clientId)).limit(1);
    customerName = user?.name ?? null;
  }

  // Insert script_run_results row
  let runResultId: number;
  try {
    const [row] = await db
      .insert(scriptRunResultsTable)
      .values({
        customerId: clientId ?? null,
        status: "completed",
        executionSource: "automated",
        scriptName,
        rawOutput: { output: scriptOutput, fixture: type },
        jobId: `dev-seed-${type}-${Date.now()}`,
      })
      .returning({ id: scriptRunResultsTable.id });
    runResultId = row.id;
  } catch (err) {
    logger.error({ err }, "admin-dev-seed: failed to insert script_run_results row");
    res.status(500).json({ error: "Failed to create run result" });
    return;
  }

  // Deterministic extraction
  const deterministicUpdates = parseM365ScriptOutput(fixture);

  // AI analysis
  let aiResult = {
    findings: [] as string[],
    recommendations: [] as string[],
    scoreImpact: {} as Record<string, number>,
    profileUpdates: {} as Record<string, unknown>,
  };
  try {
    aiResult = await runAiAnalyzer({
      scriptOutput,
      aiInstructions: `This is a ${label} M365 tenant scenario being seeded for development testing. Provide realistic analysis as if this were a real tenant discovery result.`,
      packageContext: `Dev Seed: ${label}`,
    });
  } catch (err) {
    logger.warn({ err, type }, "admin-dev-seed: AI analysis failed (non-fatal)");
  }

  const mergedProfileUpdates = { ...aiResult.profileUpdates, ...deterministicUpdates };

  // Update the run result with AI output
  await db.update(scriptRunResultsTable).set({
    parsedFindings: aiResult.findings,
    recommendations: aiResult.recommendations,
    scoreImpact: aiResult.scoreImpact,
    profileUpdates: mergedProfileUpdates,
  }).where(eq(scriptRunResultsTable.id, runResultId));

  // Apply scores and profile to client if one was specified
  if (clientId) {
    try {
      await applyScoreImpact(clientId, aiResult.scoreImpact);
    } catch (err) {
      logger.warn({ err, clientId }, "admin-dev-seed: applyScoreImpact failed (non-fatal)");
    }
    try {
      await applyProfileUpdates(clientId, mergedProfileUpdates);
    } catch (err) {
      logger.warn({ err, clientId }, "admin-dev-seed: applyProfileUpdates failed (non-fatal)");
    }
    try {
      await snapshotHealthFromProfile(clientId);
    } catch (err) {
      logger.warn({ err, clientId }, "admin-dev-seed: snapshotHealthFromProfile failed (non-fatal)");
    }
  }

  logger.info({ runResultId, type, clientId }, "admin-dev-seed: seed result injected");

  res.status(201).json({
    runResultId,
    type,
    label,
    clientId: clientId ?? null,
    customerName,
    scriptName,
    findings: aiResult.findings,
    recommendations: aiResult.recommendations,
    scoreImpact: aiResult.scoreImpact,
  });
});

export default router;
