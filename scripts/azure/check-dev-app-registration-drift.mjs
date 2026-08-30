#!/usr/bin/env node
// Git #1812 — verifies two things every time it's run:
//
//   1. `.env.local` is actually pointed at the dedicated DEV App Registrations
//      (not accidentally reverted to production's IDs — the whole point of
//      #1812 was giving local dev its own identity, separate from prod).
//   2. The DEV apps' live Microsoft Graph/Exchange/SharePoint permissions
//      still match the baseline snapshot taken from PRODUCTION at the moment
//      the dev copies were created (`app-registration-baselines/*.json`) —
//      i.e. nobody granted prod a new permission without the dev app getting
//      the same one, or vice versa.
//
// Requires `az` CLI already logged in (`az account show`). Read-only — never
// mutates anything. Logs its result to
// scripts/azure/app-registration-drift.log (gitignored, local-only) on every
// run, appending, so drift found in the past stays visible even after the
// next clean run — that's the "logged some place" this exists for.

import { execFileSync } from "node:child_process";
import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const envPath = path.join(repoRoot, ".env.local");
const logPath = path.join(__dirname, "app-registration-drift.log");

// The dev apps created for #1812 — the expected values for .env.local.
// Update these three if the dev apps are ever recreated/rotated.
const EXPECTED = {
  MT_APP_CLIENT_ID: "4743b130-0379-41bf-b863-ec8de96d915a",
  MT_APP_WRITE_CLIENT_ID: "9f6f4772-b5be-421f-815e-b392336c373a",
  AZURE_CLIENT_ID: "16959be3-40b9-4cc0-b256-3fa771db3533",
  GRAPH_CLIENT_ID: "16959be3-40b9-4cc0-b256-3fa771db3533", // same app as AZURE_CLIENT_ID
};

const BASELINES = {
  MT_APP_CLIENT_ID: "mtapp-prod-required-resource-access.json",
  MT_APP_WRITE_CLIENT_ID: "mtapp-write-prod-required-resource-access.json",
  AZURE_CLIENT_ID: "scriptrunner-prod-required-resource-access.json",
};

function parseEnvLocal() {
  const out = {};
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

// Order-independent structural diff of two requiredResourceAccess arrays.
function diffResourceAccess(baseline, live) {
  const norm = (arr) =>
    new Set(
      (arr ?? []).flatMap((block) =>
        (block.resourceAccess ?? []).map((r) => `${block.resourceAppId}:${r.id}:${r.type}`),
      ),
    );
  const b = norm(baseline);
  const l = norm(live);
  const missingFromDev = [...b].filter((x) => !l.has(x)); // prod has it, dev doesn't
  const extraOnDev = [...l].filter((x) => !b.has(x)); // dev has it, baseline (prod at snapshot time) didn't
  return { missingFromDev, extraOnDev };
}

function main() {
  const lines = [`\n=== ${new Date().toISOString()} ===`];
  let anyDrift = false;

  if (!existsSync(envPath)) {
    lines.push("ABORT: .env.local not found.");
    appendFileSync(logPath, lines.join("\n") + "\n");
    console.error(lines.join("\n"));
    process.exit(1);
  }

  const env = parseEnvLocal();

  // 1. Identity check — is .env.local actually pointed at the dev apps?
  for (const [key, expected] of Object.entries(EXPECTED)) {
    const actual = env[key];
    if (actual !== expected) {
      anyDrift = true;
      lines.push(`IDENTITY DRIFT: ${key} = ${actual ?? "(unset)"} — expected the DEV app ${expected}. .env.local may have been reverted to production's identity.`);
    } else {
      lines.push(`OK: ${key} = ${expected} (dev app, as expected)`);
    }
  }

  // 2. Permission drift — does each dev app's LIVE requiredResourceAccess
  //    still match the baseline captured from prod at dev-app creation time?
  for (const [key, baselineFile] of Object.entries(BASELINES)) {
    const appId = EXPECTED[key];
    const baseline = JSON.parse(readFileSync(path.join(__dirname, "app-registration-baselines", baselineFile), "utf8"));
    let live;
    try {
      // shell: true — on Windows `az` resolves to az.cmd, which execFileSync
      // can't spawn directly without going through a shell.
      const raw = execFileSync("az", ["ad", "app", "show", "--id", appId, "--query", "requiredResourceAccess", "-o", "json"], { encoding: "utf8", shell: true });
      live = JSON.parse(raw);
    } catch (e) {
      anyDrift = true;
      lines.push(`CHECK FAILED for ${key} (${appId}): ${e.message.split("\n")[0]} — is 'az account show' logged in?`);
      continue;
    }
    const { missingFromDev, extraOnDev } = diffResourceAccess(baseline, live);
    if (missingFromDev.length === 0 && extraOnDev.length === 0) {
      lines.push(`OK: ${key} (${appId}) permissions match the recorded baseline.`);
    } else {
      anyDrift = true;
      lines.push(`PERMISSION DRIFT on ${key} (${appId}):`);
      for (const m of missingFromDev) lines.push(`  - missing on dev (baseline/prod had it): ${m}`);
      for (const x of extraOnDev) lines.push(`  - extra on dev (not in the recorded prod baseline): ${x}`);
    }
  }

  lines.push(anyDrift ? "RESULT: DRIFT FOUND — see above." : "RESULT: clean, no drift.");
  const output = lines.join("\n") + "\n";
  appendFileSync(logPath, output);
  console.log(output);
  process.exit(anyDrift ? 1 : 0);
}

main();
