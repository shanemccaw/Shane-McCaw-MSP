import { Router, type IRouter } from "express";
import { execFileSync } from "node:child_process";
import path from "node:path";

// Internal build/version stamp — distinct from the external partner
// health check at /api/msp/v1/health, which stays unmodified.
//
// Computed once at server startup, directly from the running process's own
// git checkout (no build-time hook, no generated file — this environment's
// real dev/build workflow never reliably triggers a predev/prebuild script).
const MAJOR = 1;
const MINOR = 0;

const repoRoot = path.resolve(process.cwd(), "../..");

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
    };
  }
}

const versionInfo = computeVersionInfo();

const router: IRouter = Router();

router.get("/version", (_req, res) => {
  res.json(versionInfo);
});

export default router;
