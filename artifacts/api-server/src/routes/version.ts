import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { execFileSync } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { db, deployedVersionStampTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "admin.deploy" });

// Internal build/version stamp — distinct from the external partner
// health check at /api/msp/v1/health, which stays unmodified.
//
// Computed once at server startup, directly from the running process's own
// git checkout (no build-time hook, no generated file — this environment's
// real dev/build workflow never reliably triggers a predev/prebuild script).
const MAJOR = 1;
const MINOR = 0;

const repoRoot = path.resolve(process.cwd(), "../..");

// Captured once, at the moment this module first computes the version —
// i.e. real server-process startup — not the commit's own git timestamp.
const startedAt = new Date().toISOString();

const GENERIC_FALLBACK_VERSION_INFO = {
  major: MAJOR,
  minor: MINOR,
  build: 0,
  hash: "unknown",
  version: `${MAJOR}.${MINOR}.0`,
  display: `${MAJOR}.${MINOR}.0 (unknown)`,
  startedAt,
};

function computeVersionInfo() {
  try {
    const build = execFileSync("git", ["rev-list", "--count", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();

    const hash = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();

    const version = `${MAJOR}.${MINOR}.${build}`;

    return {
      major: MAJOR,
      minor: MINOR,
      build: Number(build),
      hash,
      version,
      display: `${version} (${hash})`,
      startedAt,
    };
  } catch {
    return GENERIC_FALLBACK_VERSION_INFO;
  }
}

// Git #666: production has no .git directory, so computeVersionInfo() above
// always falls into its catch there. Before settling for the generic
// placeholder, check the real deployed_version_stamp table — populated once
// per real deploy by POST /admin/version-stamp below — for the commit that
// actually shipped. Runs once, async, right after the sync git attempt at
// module load; harmless if a request lands before it resolves (serves the
// generic fallback for that brief window, then the real stamp thereafter).
async function resolveDeployedVersionStampFallback() {
  try {
    const [latest] = await db
      .select()
      .from(deployedVersionStampTable)
      .orderBy(desc(deployedVersionStampTable.deployedAt))
      .limit(1);
    if (!latest) return null;
    const version = `${MAJOR}.${MINOR}.0`;
    return {
      major: MAJOR,
      minor: MINOR,
      build: 0,
      hash: latest.commitHash,
      version,
      display: `${version} (${latest.commitHash})`,
      startedAt,
    };
  } catch (err) {
    log.error({ err }, "failed to read deployed_version_stamp fallback");
    return null;
  }
}

let versionInfo = computeVersionInfo();

if (versionInfo.hash === "unknown") {
  void resolveDeployedVersionStampFallback().then((stamped) => {
    if (stamped) versionInfo = stamped;
  });
}

const router: IRouter = Router();

router.get("/version", (_req, res) => {
  res.json(versionInfo);
});

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

// Git #666: this route is also called headlessly, with no user session, from
// .replit's [deployment.postBuild] step (scripts/src/deploy-stamp-version.ts)
// during every real deploy. That script authenticates with a shared secret
// (DEPLOY_STAMP_TOKEN, set as a Replit secret on both this server and the
// deploy environment) via the X-Deploy-Token header, since a build step has
// no admin JWT to send. A real admin session still works too, unchanged —
// this only ADDS a second accepted credential, it never weakens requireAdmin
// itself. If DEPLOY_STAMP_TOKEN isn't configured, the header path is a no-op
// and this always falls through to the normal requireAdmin check.
function requireAdminOrDeployToken(req: Request, res: Response, next: NextFunction): void {
  const configuredToken = process.env.DEPLOY_STAMP_TOKEN;
  const presentedToken = req.header("X-Deploy-Token");
  if (configuredToken && presentedToken && timingSafeEqualStrings(presentedToken, configuredToken)) {
    next();
    return;
  }
  requireAdmin(req, res, next);
}

const versionStampBodySchema = z.object({
  commitHash: z.string().trim().min(1),
  commitMessage: z.string().trim().min(1),
});

router.post("/admin/version-stamp", requireAdminOrDeployToken, async (req: Request, res: Response) => {
  const parsed = versionStampBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "commitHash and commitMessage are required", detail: parsed.error.flatten() });
    return;
  }

  try {
    const [inserted] = await db
      .insert(deployedVersionStampTable)
      .values({ commitHash: parsed.data.commitHash, commitMessage: parsed.data.commitMessage })
      .returning();
    log.info({ commitHash: inserted.commitHash }, "deployed_version_stamp recorded");
    res.json({ success: true, stamp: inserted });
  } catch (err) {
    log.error({ err }, "failed to write deployed_version_stamp");
    res.status(500).json({ error: "Could not record deploy stamp", detail: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/version/remote-check", (_req, res) => {
  try {
    execFileSync("git", ["fetch", "origin", "main"], { cwd: repoRoot, encoding: "utf8", timeout: 15000 });
    const latestBuild = execFileSync("git", ["rev-list", "--count", "origin/main"], { cwd: repoRoot, encoding: "utf8" }).trim();
    const latestHash = execFileSync("git", ["rev-parse", "--short", "origin/main"], { cwd: repoRoot, encoding: "utf8" }).trim();
    const current = computeVersionInfo();
    res.json({
      current,
      latest: { build: Number(latestBuild), hash: latestHash, version: `${MAJOR}.${MINOR}.${latestBuild}` },
      upToDate: current.build >= Number(latestBuild),
    });
  } catch (err) {
    res.status(500).json({ error: "Could not check remote version", detail: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/version/pull", requireAdmin, (_req, res) => {
  try {
    const pullOutput = execFileSync("git", ["pull", "origin", "main"], { cwd: repoRoot, encoding: "utf8", timeout: 30000 });
    const updated = computeVersionInfo();
    res.json({
      success: true,
      output: pullOutput.trim(),
      version: updated,
      note: "Files updated on disk. The running server process still has the old code loaded in memory — a restart is required for changes to actually take effect.",
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: "git pull failed — check for local changes or merge conflicts on the server",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
