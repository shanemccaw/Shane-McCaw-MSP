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
 * GIT #1912 — WHAT CHANGED HERE.
 *   The original version shelled out to `az rest --body <inline JSON>` for the
 *   appRoleAssignments grant. On Windows, `az` is `az.cmd`, a batch wrapper;
 *   even with execFileSync's own quoting, the inline JSON reached cmd.exe with
 *   its double quotes stripped, so Graph received invalid JSON and every grant
 *   failed with a generic BadRequest — while the (temp-file-based) declare step
 *   worked fine, leaving registrations declared-but-not-consented.
 *
 *   Fix: this script no longer shells JSON through `az rest` at all. It uses
 *   `az account get-access-token` once (a plain GET, no request body — nothing
 *   for a shell to mangle) and then talks to Microsoft Graph directly over
 *   HTTPS with `fetch()` for every read and write. There is no shell in the
 *   path for any Graph call, on any OS.
 *
 *   It also now:
 *     - refuses to run without an explicit --app (no more "both by default" —
 *       that default is how the PROD registration ended up half-applied
 *       alongside DEV in the run #1912 was filed against);
 *     - re-reads the real appRoleAssignments after granting and reports
 *       exactly what Entra says is granted, rather than trusting exit codes;
 *     - exits non-zero with one clear summary when anything is declared but
 *       not actually granted, instead of a wall of per-permission FAILED lines
 *       that scrolls past;
 *     - treats "this appRoleAssignment already exists" as success (idempotent
 *       re-run), not a failure.
 *
 * SAFETY
 *   - Default mode is a DRY RUN: it prints the exact diff and changes nothing.
 *     Nothing happens without an explicit `--apply`.
 *   - Before applying it writes the current `requiredResourceAccess` of the
 *     target app(s) to `scripts/azure/app-registration-baselines/pre-1875-<appId>.json`,
 *     so the change is reversible with `--revert`.
 *   - It only ever ADDS permissions listed in the derived set. It never removes
 *     an existing permission, and never touches any other app.
 *   - Requires `az login` as an account that can administer these app
 *     registrations and grant tenant admin consent.
 *
 * USAGE
 *   node scripts/azure/apply-write-app-permissions-1875.mjs --app dev                    # dry run
 *   node scripts/azure/apply-write-app-permissions-1875.mjs --app dev --apply            # declare only
 *   node scripts/azure/apply-write-app-permissions-1875.mjs --app dev --apply --consent
 *   node scripts/azure/apply-write-app-permissions-1875.mjs --app both --apply --consent
 *   node scripts/azure/apply-write-app-permissions-1875.mjs --app dev --revert --apply
 *
 *   --app is now REQUIRED (dev, prod, or both) — there is no default.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const baselineDir = path.join(__dirname, "app-registration-baselines");

const GRAPH_RESOURCE_APP_ID = "00000003-0000-0000-c000-000000000000";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

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

// Git #1912 — no default. The old `?? "both"` default is what let a single run
// touch the PROD registration alongside DEV without anyone asking it to.
const appFlag = valueOf("--app");
if (!appFlag) {
  console.error(
    'Refusing to run without an explicit --app dev|prod|both. There is no default — ' +
    "a run against `--app both` is how the PROD registration (3308b280-…) ended up " +
    "half-applied in the incident Git #1912 was filed against. Say which registration " +
    "you mean every time.",
  );
  process.exit(2);
}
const which = appFlag.toLowerCase();
const targets = which === "both" ? ["dev", "prod"] : [which];
for (const t of targets) {
  if (!APPS[t]) { console.error(`Unknown --app "${t}". Use dev, prod or both.`); process.exit(2); }
}

// `az account show` / `az account get-access-token` are plain GETs with no
// request body — nothing for a shell to mangle — so these two remain `az`
// calls. Every Graph read/write below goes over `fetch()` directly instead.
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
  `${APPLY ? "WRITING" : "DRY RUN, nothing will change"} — target(s): ${targets.join(", ")}`,
);
console.log("");

let accessToken;
try {
  accessToken = az([
    "account", "get-access-token",
    "--resource", "https://graph.microsoft.com",
    "--query", "accessToken",
    "--output", "tsv",
  ], { json: false }).trim();
  if (!accessToken) throw new Error("empty token");
} catch (err) {
  console.error(`Could not acquire a Microsoft Graph access token via az: ${err.message}`);
  process.exit(1);
}

/** Direct Microsoft Graph HTTP call — no shell anywhere in this path. */
async function graph(method, urlPath, body) {
  const res = await fetch(`${GRAPH_BASE}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { /* non-JSON body, leave data null */ }
  }
  if (!res.ok) {
    const message = data?.error?.message ?? text.slice(0, 500) ?? res.statusText;
    const err = new Error(`Graph ${method} ${urlPath} -> HTTP ${res.status}: ${message}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

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
const graphSp = await graph(
  "GET",
  `/servicePrincipals(appId='${GRAPH_RESOURCE_APP_ID}')?$select=id,appRoles`,
);
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
// Git #1912 — collected across all targets so the very last thing printed is
// one clear summary, not per-permission lines scrolling past.
const failedGrants = []; // { app, name, error }
const verifyGaps = [];   // { app, name } — declared/wanted but NOT granted after apply, per real Entra readback

for (const key of targets) {
  const { appId, label } = APPS[key];
  console.log(`── ${key.toUpperCase()}  ${appId}  ${label}`);

  const app = await graph("GET", `/applications(appId='${appId}')?$select=requiredResourceAccess`);
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
      await graph("PATCH", `/applications(appId='${appId}')`, { requiredResourceAccess: restore });
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
  if (toAdd.length === 0) console.log("     (registration already declares the full derived set — idempotent no-op)");

  if (APPLY && toAdd.length > 0) {
    // Merge, never replace: keep every existing entry (including non-Graph
    // resources such as Exchange Online) exactly as it is.
    const merged = current.filter((b) => b.resourceAppId !== GRAPH_RESOURCE_APP_ID);
    const mergedRoles = [
      ...(graphBlock?.resourceAccess ?? []),
      ...toAdd.map((r) => ({ id: r.id, type: "Role" })),
    ];
    merged.push({ resourceAppId: GRAPH_RESOURCE_APP_ID, resourceAccess: mergedRoles });

    await graph("PATCH", `/applications(appId='${appId}')`, { requiredResourceAccess: merged });
    console.log("   registration updated.");
    changed = true;
  }

  // ── the actual GRANT: appRoleAssignments on the SP in THIS tenant ──────────
  if (CONSENT) {
    let sp;
    try {
      sp = await graph("GET", `/servicePrincipals(appId='${appId}')?$select=id`);
    } catch (err) {
      if (err.status === 404) {
        console.log("   no service principal for this app in this tenant — skipping consent.");
        console.log("");
        continue;
      }
      throw err;
    }

    const assigned = await graph("GET", `/servicePrincipals/${sp.id}/appRoleAssignments?$top=200`);
    const grantedIds = new Set(
      (assigned.value ?? []).filter((a) => a.resourceId === graphSp.id).map((a) => a.appRoleId),
    );
    const toGrant = wantedRoleIds.filter((r) => !grantedIds.has(r.id));

    console.log(`   consented (real Entra readback): ${grantedIds.size}; granting ${toGrant.length}:`);
    for (const r of toGrant) console.log(`     + ${r.name}`);
    if (toGrant.length === 0) console.log("     (already fully consented — idempotent no-op)");

    if (APPLY) {
      for (const r of toGrant) {
        try {
          await graph("POST", `/servicePrincipals/${sp.id}/appRoleAssignments`, {
            principalId: sp.id,
            resourceId: graphSp.id,
            appRoleId: r.id,
          });
          console.log(`     granted ${r.name}`);
          changed = true;
        } catch (err) {
          const alreadyExists = err.status === 400 && /already exist/i.test(err.body?.error?.message ?? "");
          if (alreadyExists) {
            // Idempotent re-run racing a prior grant — not a failure.
            console.log(`     already granted ${r.name}`);
          } else {
            console.error(`     FAILED ${r.name}: ${err.message}`);
            failedGrants.push({ app: key, name: r.name, error: err.message });
          }
        }
      }

      // Git #1912 — verify by reading appRoleAssignments back from Entra, not
      // by trusting the POST calls' status codes.
      const verify = await graph("GET", `/servicePrincipals/${sp.id}/appRoleAssignments?$top=200`);
      const verifiedIds = new Set(
        (verify.value ?? []).filter((a) => a.resourceId === graphSp.id).map((a) => a.appRoleId),
      );
      const stillMissing = wantedRoleIds.filter((r) => !verifiedIds.has(r.id));
      if (stillMissing.length > 0) {
        console.error(`   VERIFY (real Entra readback): ${stillMissing.length} of ${wantedRoleIds.length} wanted permission(s) are NOT granted on ${key}:`);
        for (const r of stillMissing) {
          console.error(`     ✗ ${r.name}`);
          verifyGaps.push({ app: key, name: r.name });
        }
      } else {
        console.log(`   VERIFY (real Entra readback): all ${wantedRoleIds.length} wanted permission(s) are granted on ${key}.`);
      }
    }
  }
  console.log("");
}

if (!APPLY) {
  console.log("DRY RUN — nothing was changed. Re-run with --apply (and --consent to grant) to make it real.");
} else if (failedGrants.length > 0 || verifyGaps.length > 0) {
  // Git #1912 — one loud summary at the very end, not individual FAILED lines
  // scrolling past while the run otherwise looks like it succeeded.
  console.error("═".repeat(72));
  console.error(`FAILED: registration(s) are DECLARED but not fully GRANTED after this run.`);
  if (failedGrants.length > 0) {
    console.error(`  ${failedGrants.length} grant call(s) errored:`);
    for (const f of failedGrants) console.error(`    ✗ [${f.app}] ${f.name} — ${f.error}`);
  }
  if (verifyGaps.length > 0) {
    console.error(`  ${verifyGaps.length} permission(s) still missing per real Entra readback:`);
    for (const g of verifyGaps) console.error(`    ✗ [${g.app}] ${g.name}`);
  }
  console.error("Re-run this script (it is idempotent) once the above is resolved.");
  console.error("═".repeat(72));
  process.exitCode = 1;
} else if (changed) {
  console.log("Done. Verify with: node scripts/verify-write-app-consent-645.mjs");
  console.log("Consent can take a minute to propagate; the write token's `roles` claim is the authoritative check.");
} else {
  console.log("Nothing to change — already in the desired state.");
}
