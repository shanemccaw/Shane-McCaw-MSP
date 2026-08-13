/**
 * deploy-stamp-version.ts — Git #666.
 *
 * Runs from .replit's [deployment.postBuild], which still has a real .git
 * checkout at build time (unlike the compiled production artifact that
 * actually serves traffic — see version.ts's computeVersionInfo()). Computes
 * the real commit hash/message and POSTs it to the running production
 * server's POST /api/admin/version-stamp, so GET /api/version's fallback has
 * something real to read once the shellout it normally does is unavailable.
 *
 * Deliberately best-effort and non-fatal: this step must NEVER fail a real
 * deploy just because the stamp POST didn't land (network hiccup, secret not
 * yet configured on a fresh environment, endpoint not yet live on the very
 * first rollout after this migration). Every failure path logs a warning and
 * exits 0.
 *
 * Requires the DEPLOY_STAMP_TOKEN secret to be set on BOTH sides — this
 * script (reads it to send) and the running api-server (reads the same name
 * to verify it, see requireAdminOrDeployToken in
 * artifacts/api-server/src/routes/version.ts). If it isn't set, this script
 * warns and exits 0 without attempting a request.
 *
 * Run:
 *   pnpm --filter @workspace/scripts run deploy-stamp-version
 */

import { execFileSync } from "node:child_process";

function resolveBaseUrl(): string | null {
  const domains = (process.env.REPLIT_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);

  const custom = domains.find((d) => !d.includes("replit."));
  if (custom) return `https://${custom}`;

  const replitApp = domains.find((d) => d.endsWith(".replit.app"));
  if (replitApp) return `https://${replitApp}`;

  const replitDev = domains.find((d) => d.endsWith(".replit.dev")) ?? process.env.REPLIT_DEV_DOMAIN;
  if (replitDev) return `https://${replitDev}`;

  return null;
}

async function main() {
  const token = process.env.DEPLOY_STAMP_TOKEN;
  if (!token) {
    console.warn("[deploy-stamp-version] DEPLOY_STAMP_TOKEN not set — skipping (deploy continues normally).");
    return;
  }

  const baseUrl = resolveBaseUrl();
  if (!baseUrl) {
    console.warn("[deploy-stamp-version] Could not resolve a deploy base URL from REPLIT_DOMAINS/REPLIT_DEV_DOMAIN — skipping.");
    return;
  }

  let commitHash: string;
  let commitMessage: string;
  try {
    commitHash = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
    commitMessage = execFileSync("git", ["log", "-1", "--format=%s"], { encoding: "utf8" }).trim();
  } catch (err) {
    console.warn("[deploy-stamp-version] Could not read git commit info — skipping.", err instanceof Error ? err.message : err);
    return;
  }

  try {
    const res = await fetch(`${baseUrl}/api/admin/version-stamp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Deploy-Token": token },
      body: JSON.stringify({ commitHash, commitMessage }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn(`[deploy-stamp-version] POST ${baseUrl}/api/admin/version-stamp returned ${res.status} — skipping (deploy continues normally).`);
      return;
    }
    console.log(`[deploy-stamp-version] Stamped ${commitHash} ("${commitMessage}") at ${baseUrl}.`);
  } catch (err) {
    console.warn("[deploy-stamp-version] Request failed — skipping (deploy continues normally).", err instanceof Error ? err.message : err);
  }
}

void main();
