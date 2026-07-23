import { Router, type Request, type Response } from "express";
import { requireAdmin } from "../middlewares/requireAuth";
import { exec, execSync } from "child_process";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "admin.deploy" });

const router = Router();

// process.cwd() is NOT reliable here — in this pnpm workspace, running a
// package's own dev/start script sets cwd to that package's directory, not
// the monorepo root. Ask git itself for the real repo root instead, which is
// correct regardless of where the process was launched from. Resolved lazily
// on first use (not at module load) so a resolution failure only breaks the
// deploy console route, never server startup — this is a secondary admin
// feature and must never be able to take the whole server down.
let cachedWorkspaceRoot: string | undefined;

function getWorkspaceRoot(): string {
  if (cachedWorkspaceRoot) return cachedWorkspaceRoot;
  let root: string;
  try {
    root = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
  } catch (err) {
    throw new Error(
      `admin-deploy-console: failed to resolve workspace root via 'git rev-parse --show-toplevel': ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
  if (!root) {
    throw new Error("admin-deploy-console: 'git rev-parse --show-toplevel' returned an empty result");
  }
  cachedWorkspaceRoot = root;
  return root;
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

function runStep(step: DeployStep, workspaceRoot: string): Promise<StepResult> {
  return new Promise((resolve) => {
    exec(
      step.command,
      { cwd: workspaceRoot, timeout: step.timeoutMs, env: { ...process.env }, maxBuffer: 10 * 1024 * 1024 },
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

  let workspaceRoot: string;
  try {
    workspaceRoot = getWorkspaceRoot();
  } catch (err) {
    log.error({ operation, err: err instanceof Error ? err.message : String(err) }, "Deploy console workspace root resolution failed");
    res.status(500).json({ ok: false, operation, error: err instanceof Error ? err.message : String(err) });
    return;
  }

  log.info({ operation, userId: req.user?.id }, "Deploy console operation starting");

  const results: StepResult[] = [];
  for (const step of steps) {
    const result = await runStep(step, workspaceRoot);
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
