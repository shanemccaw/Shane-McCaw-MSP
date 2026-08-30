#!/usr/bin/env tsx
/**
 * #1869 — live, READ-ONLY verification of the Power Platform admin (BAP) surface.
 *
 * Drives the REAL production module (artifacts/api-server/src/lib/power-platform-admin.ts)
 * rather than reimplementing its auth, so what this prints is what the executor
 * would actually do. Answers, with real calls rather than inference:
 *
 *   1. Can the existing multi-tenant app registration acquire a token for the
 *      Power Platform resource (`https://service.powerapps.com/.default`)?
 *   2. Does the BAP admin API accept that token?
 *   3. What is the tenant's real Power Platform / DLP posture?
 *
 * Every request is a GET. Nothing is created, modified or deleted — there is no
 * write path in the module this calls.
 *
 * Endpoint/scope facts are sourced from Microsoft365DSC + MSCloudLoginAssistant
 * (Dev branch, read 2026-08-30); see power-platform-admin.ts's header for the
 * exact provenance.
 *
 * Usage (from the repo root):
 *   node artifacts/api-server/node_modules/.bin/tsx scripts/verify-power-platform-1869.mts [aadTenantId]
 *
 * Reads MT_APP_CLIENT_ID / MT_APP_CLIENT_SECRET from .env.local.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Minimal .env.local reader — no dependency on the api-server's own bootstrap.
function loadEnvLocal(): void {
  try {
    const raw = readFileSync(resolve(repoRoot, ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
      if (!m) continue;
      let v = m[2]!.trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!process.env[m[1]!]) process.env[m[1]!] = v;
    }
  } catch {
    /* env may be supplied by the caller instead */
  }
}
loadEnvLocal();

const {
  getPowerPlatformToken,
  listDlpPolicies,
  listEnvironments,
  getTenantSettings,
  probePowerPlatformReachability,
  powerPlatformCredentialsPresent,
  PowerPlatformNotRegisteredError,
  POWER_PLATFORM_SCOPE,
  POWER_PLATFORM_MANAGEMENT_APP_REGISTRATION,
} = await import("../artifacts/api-server/src/lib/power-platform-admin.ts");

/** tenants.id = 1 — mccawsoft2.onmicrosoft.com, the testbed. */
const TENANT_ID = process.argv[2] ?? "c4c814d4-3afe-441e-9145-62461d0a4fd3";

function decodeJwtClaims(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split(".")[1]!;
    return JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  console.log("=== #1869 Power Platform admin API live verification (READ-ONLY) ===");
  console.log(`tenant : ${TENANT_ID}`);
  console.log(`client : ${process.env["MT_APP_CLIENT_ID"] ?? "(MT_APP_CLIENT_ID missing)"}`);
  console.log(`scope  : ${POWER_PLATFORM_SCOPE}`);
  console.log(`creds  : ${powerPlatformCredentialsPresent() ? "present" : "MISSING"}\n`);

  // ── 1. Token acquisition, through the real module ──────────────────────────
  console.log("--- 1. getPowerPlatformToken()");
  let token: string;
  try {
    token = await getPowerPlatformToken(TENANT_ID);
  } catch (err) {
    console.log(`    FAILED: ${err instanceof Error ? err.message : String(err)}`);
    console.log("\nRESULT: token acquisition failed — cannot proceed.");
    process.exit(1);
  }
  const claims = decodeJwtClaims(token) ?? {};
  console.log(`    aud   : ${claims["aud"]}`);
  console.log(`    appid : ${claims["appid"]}`);
  console.log(`    tid   : ${claims["tid"]}`);
  console.log(`    roles : ${JSON.stringify(claims["roles"] ?? null)}`);
  console.log(`    oid   : ${claims["oid"]}`);
  console.log("    => token acquired OK (the EXISTING MT app registration reaches this resource)\n");

  // ── 2. Reachability, as the coverage surface would classify it ─────────────
  console.log("--- 2. probePowerPlatformReachability()");
  const reach = await probePowerPlatformReachability(TENANT_ID);
  console.log(`    state: ${reach.state}`);
  if (reach.state === "not_registered") {
    console.log(`    remediation: ${reach.remediation}`);
    console.log(`    constraint : ${POWER_PLATFORM_MANAGEMENT_APP_REGISTRATION.selfServiceImpossible}`);
  } else if (reach.state === "ok") {
    console.log(`    environments: ${reach.environmentCount}`);
  } else {
    console.log(`    detail: ${reach.detail}`);
  }
  console.log("");

  // ── 3. The real reads ──────────────────────────────────────────────────────
  const reads: Array<[string, () => Promise<unknown>]> = [
    ["listDlpPolicies", () => listDlpPolicies(TENANT_ID)],
    ["listEnvironments", () => listEnvironments(TENANT_ID)],
    ["getTenantSettings", () => getTenantSettings(TENANT_ID)],
  ];

  for (const [label, fn] of reads) {
    console.log(`--- 3. ${label}()`);
    try {
      const out = await fn();
      if (Array.isArray(out)) {
        console.log(`    ${out.length} row(s)`);
        console.log(`    ${JSON.stringify(out).slice(0, 1500)}`);
      } else {
        console.log(`    ${JSON.stringify(out).slice(0, 1500)}`);
      }
    } catch (err) {
      if (err instanceof PowerPlatformNotRegisteredError) {
        console.log("    BLOCKED — management-app registration missing (NOT a credential or scope problem):");
        console.log(`    ${err.message}`);
      } else {
        console.log(`    ERROR: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    console.log("");
  }
}

await main();
