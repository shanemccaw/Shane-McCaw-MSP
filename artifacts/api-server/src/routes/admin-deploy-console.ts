import { Router, type Request, type Response } from "express";
import { requireAdmin } from "../middlewares/requireAuth";
import { exec } from "child_process";
import fs from "fs";
import path from "path";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "admin.deploy" });

const router = Router();

// The server is always started (both `pnpm run start` locally and the bundled
// `node ./dist/index.mjs` in production) from the real workspace root, so
// process.cwd() is the robust source of truth here — unlike __dirname, it
// isn't tied to whether this file is running from its src/ source location
// or collapsed into a single bundled dist/ file. Verified against a .git
// directory rather than trusted blindly, so a wrong cwd fails loudly instead
// of silently running deploy operations against the wrong path.
const WORKSPACE_ROOT = process.cwd();
if (!fs.existsSync(path.join(WORKSPACE_ROOT, ".git"))) {
  throw new Error(
    `admin-deploy-console: WORKSPACE_ROOT (${WORKSPACE_ROOT}) does not contain a .git directory — ` +
      "the server process was not started from the real workspace root."
  );
}

interface DeployStep {
  label: string;
  command: string;
  timeoutMs: number;
}

// Fixed, real whitelist of deploy-console operations. Each key maps to a
// fixed sequence of shell commands — the ":operation" route param is only
// ever used as a lookup key into this object, never interpolated into a
// command string. No free-text/arbitrary command execution path exists.
const DEPLOY_OPERATIONS: Record<string, DeployStep[]> = {
  "git-status": [
    { label: "git status", command: "git status --short --branch", timeoutMs: 15_000 },
  ],
  "version-info": [
    { label: "git log -1", command: "git log -1 --format=%H%n%an%n%ad%n%s", timeoutMs: 15_000 },
    { label: "git rev-list --count HEAD", command: "git rev-list --count HEAD", timeoutMs: 15_000 },
  ],
  "git-pull": [
    // --ff-only: this repo's convention is committing directly to main, so a
    // pull that would require a merge commit means local and remote have
    // diverged — surface that as a failure instead of silently merging.
    { label: "git pull --ff-only", command: "git pull --ff-only", timeoutMs: 60_000 },
  ],
  "pnpm-install": [
    { label: "pnpm install", command: "pnpm install", timeoutMs: 300_000 },
  ],
  "pnpm-build": [
    { label: "pnpm run build", command: "pnpm run build", timeoutMs: 600_000 },
  ],
  "full-rebuild": [
    { label: "git pull --ff-only", command: "git pull --ff-only", timeoutMs: 60_000 },
    { label: "pnpm install", command: "pnpm install", timeoutMs: 300_000 },
    { label: "pnpm run build", command: "pnpm run build", timeoutMs: 600_000 },
  ],
};

interface StepResult {
  label: string;
  command: string;
  ok: boolean;
  output: string;
}

function runStep(step: DeployStep): Promise<StepResult> {
  return new Promise((resolve) => {
    exec(
      step.command,
      { cwd: WORKSPACE_ROOT, timeout: step.timeoutMs, env: { ...process.env }, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const output = [stdout, stderr].filter(Boolean).join("\n").trim();
        resolve({ label: step.label, command: step.command, ok: !err, output: err ? (output || err.message) : output });
      }
    );
  });
}

// GET /admin/simulator/deploy/operations — lists the fixed whitelist so the
// frontend never has to hardcode operation keys independently of the server.
router.get("/admin/simulator/deploy/operations", requireAdmin, (_req: Request, res: Response) => {
  res.json({
    operations: Object.entries(DEPLOY_OPERATIONS).map(([key, steps]) => ({
      key,
      steps: steps.map((s) => s.label),
    })),
  });
});

// POST /admin/simulator/deploy/:operation — runs one whitelisted operation.
// :operation is validated against DEPLOY_OPERATIONS' keys and used only as a
// lookup; the executed command string always comes from the whitelist entry.
router.post("/admin/simulator/deploy/:operation", requireAdmin, async (req: Request, res: Response) => {
  const operation = String(req.params.operation);
  const steps = Object.prototype.hasOwnProperty.call(DEPLOY_OPERATIONS, operation)
    ? DEPLOY_OPERATIONS[operation]
    : undefined;

  if (!steps) {
    res.status(400).json({ error: `Unknown deploy operation: ${operation}` });
    return;
  }

  log.info({ operation, userId: req.user?.id }, "Deploy console operation starting");

  const results: StepResult[] = [];
  for (const step of steps) {
    const result = await runStep(step);
    results.push(result);
    if (!result.ok) {
      log.error({ operation, step: step.label }, "Deploy console step failed");
      res.status(500).json({ ok: false, operation, steps: results, error: `${step.label} failed` });
      return;
    }
  }

  log.info({ operation }, "Deploy console operation completed");
  res.json({ ok: true, operation, steps: results });
});

export default router;
