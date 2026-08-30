#!/usr/bin/env node
/**
 * Git #1875 — bring the WRITE app registrations in line with the permission set
 * derived from the Config Packs' real steps, and admin-consent it on a tenant.
 *
 * WHY A SCRIPT AND NOT A CLICK-THROUGH. The set is 16 permissions with a
 * documented justification each; picking them by hand in the Entra portal is
 * where transcription errors come from, and transcription error is exactly the
 * defect #1875 was filed for. This script reads the list from
 * `artifacts/api-server/src/lib/graph-write-permissions.ts` — the same module
 * the API server and the admin UI read — so the registration, the consent
 * screen and the code cannot disagree.
 *
 * WHAT IT TOUCHES. Two app registrations in Shane's tenant:
 *   DEV   9f6f4772-b5be-421f-815e-b392336c373a  (what .env.local points at)
 *   PROD  3308b280-e41e-42ba-9f73-73aac2ad3dee  (what customers consent to)
 * It sets each registration's `requiredResourceAccess` (what the app DECLARES)
 * and then, with --consent, creates the `appRoleAssignments` on that app's
 * service principal in the target tenant (the actual GRANT).
 *
 * SAFETY
 *   - Default mode is a DRY RUN: it prints the exact diff and changes nothing.
 *     Nothing happens without an explicit `--apply`.
 *   - Before applying it writes the current `requiredResourceAccess` of both
 *     apps to `scripts/azure/app-registration-baselines/pre-1875-<appId>.json`,
 *     so the change is reversible with `--revert`.
 *   - It only ever ADDS permissions listed in the derived set. It never removes
 *     an existing permission, and never touches any other app.
 *   - Requires `az login` as an account that can administer these app
 *     registrations and grant tenant admin consent.
 *
 * USAGE
 *   node scripts/azure/apply-write-app-permissions-1875.mjs                 # dry run, both apps
 *   node scripts/azure/apply-write-app-permissions-1875.mjs --apply         # declare only
 *   node scripts/azure/apply-write-app-permissions-1875.mjs --apply --consent
 *   node scripts/azure/apply-write-app-permissions-1875.mjs --app dev --apply --consent
 *   node scripts/azure/apply-write-app-permissions-1875.mjs --revert --apply
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const baselineDir = path.join(__dirname, "app-registration-baselines");

const GRAPH_RESOURCE_APP_ID = "00000003-0000-0000-c000-000000000000";

const APPS = {
  dev: { appId: "9f6f4772-b5be-421f-815e-b392336c373a", label: "MSP Platform Write (DEV)  — what .env.local uses" },
  prod: { appId: "3308b280-e41e-42ba-9f73-73aac2ad3dee", label: "MSP Platform (Write)      — what customers consent to" },
};

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valueOf = (f) => { const i = argv.indexOf(f); return i === -1 ? null : argv[i + 1] ?? null; };

const APPLY = has("--apply");
const CONSENT = has("--consent");
const REVERT = has("--revert");
const which = (valueOf("--app") ?? "both").toLowerCase();
const targets = which === "both" ? ["dev", "prod"] : [which];
for (const t of targets) {
  if (!APPS[t]) { console.error(`Unknown --app "${t}". Use dev, prod or both.`); process.exit(2); }
}

// On Windows the Azure CLI is `az.cmd`, which execFileSync cannot launch
// without a shell — hence the explicit binary name rather than a bare "az".
const AZ_BIN = process.platform === "win32" ? "az.cmd" : "az";

function az(args, { json = true } = {}) {
  const out = execFileSync(AZ_BIN, args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  return json ? (out.trim() ? JSON.parse(out) : null) : out;
}

// ── who am I, and is az even logged in ───────────────────────────────────────
let account;
try {
  account = az(["account", "show", "--output", "json"]);
} catch {
  console.error("az is not logged in. Run `az login` first.");
  process.exit(1);
}
const tenantId = account.tenantId;
console.log(`Signed in as ${account.user?.name} on tenant ${tenantId} (${account.tenantDisplayName ?? "?"})`);
console.log(
  `Mode: ${REVERT ? "REVERT" : "GRANT"}${CONSENT ? " + admin consent" : " (declare only)"} — ` +
  `${APPLY ? "WRITING" : "DRY RUN, nothing will change"}`,
);
console.log("");

// ── the derived permission set, read from the one source of truth ────────────
const permsModuleUrl = pathToFileURL(
  path.join(repoRoot, "artifacts", "api-server", "src", "lib", "graph-write-permissions.ts"),
).href;
const { DERIVED_WRITE_APP_PERMISSIONS, DOCUMENTED_BUT_NOT_REQUESTED, GRAPH_WRITE_PERMISSION_RULES } =
  await import(permsModuleUrl);

console.log(`Derived permission set (${DERIVED_WRITE_APP_PERMISSIONS.length}) from graph-write-permissions.ts:`);
for (const p of DERIVED_WRITE_APP_PERMISSIONS) {
  const rule = GRAPH_WRITE_PERMISSION_RULES.find((r) => r.permissions.includes(p) && r.grantRecommended !== false);
  console.log(`  - ${p.padEnd(44)} ${rule ? `${rule.method} ${rule.pattern}` : "(body-driven / template extra)"}`);
}
if (DOCUMENTED_BUT_NOT_REQUESTED.length) {
  console.log("\nDocumented but deliberately NOT requested:");
  for (const d of DOCUMENTED_BUT_NOT_REQUESTED) console.log(`  - ${d.permission}\n      ${d.reason}`);
}
console.log("");

// ── resolve permission NAMES to Graph appRole ids, live ──────────────────────
const graphSp = az([
  "ad", "sp", "show", "--id", GRAPH_RESOURCE_APP_ID, "--query", "{id:id,appRoles:appRoles}", "--output", "json",
]);
const roleIdByName = new Map(graphSp.appRoles.map((r) => [r.value, r.id]));

const wantedRoleIds = [];
for (const name of DERIVED_WRITE_APP_PERMISSIONS) {
  const id = roleIdByName.get(name);
  if (!id) {
    console.error(`FATAL: "${name}" is not an application permission Microsoft Graph publishes. Refusing to continue.`);
    process.exit(1);
  }
  wantedRoleIds.push({ name, id });
}

if (!existsSync(baselineDir)) mkdirSync(baselineDir, { recursive: true });

let changed = false;

for (const key of targets) {
  const { appId, label } = APPS[key];
  console.log(`── ${key.toUpperCase()}  ${appId}  ${label}`);

  const app = az(["ad", "app", "show", "--id", appId, "--output", "json"]);
  const current = app.requiredResourceAccess ?? [];
  const snapshotPath = path.join(baselineDir, `pre-1875-${appId}.json`);

  if (REVERT) {
    if (!existsSync(snapshotPath)) {
      console.log(`   no pre-1875 snapshot at ${snapshotPath} — nothing to revert to.\n`);
      continue;
    }
    const restore = JSON.parse(readFileSync(snapshotPath, "utf8"));
    console.log(`   would restore requiredResourceAccess from ${path.basename(snapshotPath)}`);
    if (APPLY) {
      const tmp = path.join(baselineDir, `.revert-${appId}.json`);
      writeFileSync(tmp, JSON.stringify(restore));
      az(["ad", "app", "update", "--id", appId, "--required-resource-accesses", `@${tmp}`], { json: false });
      console.log("   restored.");
      changed = true;
    }
    console.log("");
    continue;
  }

  // Snapshot BEFORE the first write, and never overwrite an existing snapshot
  // (a second run must not record the already-modified state as the baseline).
  // A dry run must leave nothing behind, so it only says what it would write.
  if (existsSync(snapshotPath)) {
    console.log(`   snapshot already exists: ${path.basename(snapshotPath)} (kept)`);
  } else if (APPLY) {
    writeFileSync(snapshotPath, JSON.stringify(current, null, 2) + "\n");
    console.log(`   snapshot written: ${path.basename(snapshotPath)}`);
  } else {
    console.log(`   would snapshot current state to ${path.basename(snapshotPath)} before changing anything`);
  }

  const graphBlock = current.find((b) => b.resourceAppId === GRAPH_RESOURCE_APP_ID);
  const existingIds = new Set((graphBlock?.resourceAccess ?? []).filter((r) => r.type === "Role").map((r) => r.id));
  const toAdd = wantedRoleIds.filter((r) => !existingIds.has(r.id));

  console.log(`   declares ${existingIds.size} Graph application permission(s); adding ${toAdd.length}:`);
  for (const r of toAdd) console.log(`     + ${r.name}`);
  if (toAdd.length === 0) console.log("     (registration already declares the full derived set)");

  if (APPLY && toAdd.length > 0) {
    // Merge, never replace: keep every existing entry (including non-Graph
    // resources such as Exchange Online) exactly as it is.
    const merged = current.filter((b) => b.resourceAppId !== GRAPH_RESOURCE_APP_ID);
    const mergedRoles = [
      ...(graphBlock?.resourceAccess ?? []),
      ...toAdd.map((r) => ({ id: r.id, type: "Role" })),
    ];
    merged.push({ resourceAppId: GRAPH_RESOURCE_APP_ID, resourceAccess: mergedRoles });

    const tmp = path.join(baselineDir, `.apply-${appId}.json`);
    writeFileSync(tmp, JSON.stringify(merged));
    az(["ad", "app", "update", "--id", appId, "--required-resource-accesses", `@${tmp}`], { json: false });
    console.log("   registration updated.");
    changed = true;
  }

  // ── the actual GRANT: appRoleAssignments on the SP in THIS tenant ──────────
  if (CONSENT) {
    let sp;
    try {
      sp = az(["ad", "sp", "show", "--id", appId, "--query", "{id:id}", "--output", "json"]);
    } catch {
      console.log("   no service principal for this app in this tenant — skipping consent.");
      console.log("");
      continue;
    }

    const assigned = az([
      "rest", "--method", "GET",
      "--url", `https://graph.microsoft.com/v1.0/servicePrincipals/${sp.id}/appRoleAssignments?$top=200`,
      "--output", "json",
    ]);
    const grantedIds = new Set(
      (assigned.value ?? []).filter((a) => a.resourceId === graphSp.id).map((a) => a.appRoleId),
    );
    const toGrant = wantedRoleIds.filter((r) => !grantedIds.has(r.id));

    console.log(`   consented: ${grantedIds.size}; granting ${toGrant.length}:`);
    for (const r of toGrant) console.log(`     + ${r.name}`);

    if (APPLY) {
      for (const r of toGrant) {
        const body = JSON.stringify({ principalId: sp.id, resourceId: graphSp.id, appRoleId: r.id });
        try {
          az([
            "rest", "--method", "POST",
            "--url", `https://graph.microsoft.com/v1.0/servicePrincipals/${sp.id}/appRoleAssignments`,
            "--headers", "Content-Type=application/json",
            "--body", body,
            "--output", "none",
          ], { json: false });
          console.log(`     granted ${r.name}`);
          changed = true;
        } catch (err) {
          console.error(`     FAILED ${r.name}: ${err.message.split("\n")[0]}`);
        }
      }
    }
  }
  console.log("");
}

if (!APPLY) {
  console.log("DRY RUN — nothing was changed. Re-run with --apply (and --consent to grant) to make it real.");
} else if (changed) {
  console.log("Done. Verify with: node scripts/verify-write-app-consent-645.mjs");
  console.log("Consent can take a minute to propagate; the write token's `roles` claim is the authoritative check.");
} else {
  console.log("Nothing to change — already in the desired state.");
}
