import { Router, type IRouter } from "express";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { requireAdmin } from "../middlewares/requireAuth";

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
    const version = `${MAJOR}.${MINOR}.0`;
    return {
      major: MAJOR,
      minor: MINOR,
      build: 0,
      hash: "unknown",
      version,
      display: `${version} (unknown)`,
      startedAt,
    };
  }
}

const versionInfo = computeVersionInfo();

const router: IRouter = Router();

router.get("/version", (_req, res) => {
  res.json(versionInfo);
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
