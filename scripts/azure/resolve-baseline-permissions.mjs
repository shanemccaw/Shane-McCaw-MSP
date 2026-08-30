#!/usr/bin/env node
// Git #1811 part 3 — resolves every GUID in the #1812 baseline snapshots
// (scripts/azure/app-registration-baselines/*.json) to its real permission
// name via the resource service principals' live appRoles/
// oauth2PermissionScopes, then prints a resource-grouped table for manual
// diffing against REQUIRED_MT_SCOPES / REQUIRED_WRITE_APP_PERMISSIONS /
// REQUIRED_SHAREPOINT_APP_PERMISSIONS. Read-only — calls `az ad sp show`,
// never writes to Entra. Requires `az` already logged in (`az account show`).
//
// Re-run this any time #1812's baselines are refreshed, or as a standalone
// health check of what's actually granted vs what the baselines captured.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baselineDir = path.join(__dirname, "app-registration-baselines");

const RESOURCE_NAMES = {
  "00000003-0000-0000-c000-000000000000": "Microsoft Graph",
  "00000002-0000-0ff1-ce00-000000000000": "Office 365 Exchange Online",
  "c5393580-f805-4401-95e8-94b7a6ef2fc2": "Office 365 Management API",
  "00000003-0000-0ff1-ce00-000000000000": "Office 365 SharePoint Online",
};

function fetchServicePrincipal(resourceAppId) {
  // shell: true — on Windows `az` resolves to az.cmd, which execFileSync
  // can't spawn directly without going through a shell (same fix as
  // check-dev-app-registration-drift.mjs).
  const jmespath = "{appRoles:appRoles[].{id:id,value:value}, scopes:oauth2PermissionScopes[].{id:id,value:value}}";
  const raw = execFileSync(
    "az",
    [
      "ad", "sp", "show", "--id", resourceAppId,
      "--query", `"${jmespath}"`,
      "-o", "json",
    ],
    { encoding: "utf8", shell: true },
  );
  return JSON.parse(raw);
}

function resolve(lookup, id, type) {
  const list = type === "Role" ? lookup.appRoles : lookup.scopes;
  const found = list?.find((x) => x.id === id);
  return found ? found.value : `UNRESOLVED(${id})`;
}

function loadBaseline(file, resourceLookups) {
  const data = JSON.parse(readFileSync(path.join(baselineDir, file), "utf8"));
  const out = [];
  for (const block of data) {
    const resourceName = RESOURCE_NAMES[block.resourceAppId] ?? block.resourceAppId;
    const lookup = resourceLookups[block.resourceAppId];
    for (const r of block.resourceAccess) {
      out.push({
        resourceAppId: block.resourceAppId,
        resourceName,
        id: r.id,
        type: r.type,
        name: lookup ? resolve(lookup, r.id, r.type) : `UNKNOWN_RESOURCE(${block.resourceAppId})/${r.id}`,
      });
    }
  }
  return out;
}

const baselines = {
  "MT app (read) vs REQUIRED_MT_SCOPES + REQUIRED_SHAREPOINT_APP_PERMISSIONS": "mtapp-prod-required-resource-access.json",
  "MT app (write) vs REQUIRED_WRITE_APP_PERMISSIONS": "mtapp-write-prod-required-resource-access.json",
  "Script Runner / Graph email app — informational only, no REQUIRED_* array exists for it": "scriptrunner-prod-required-resource-access.json",
};

console.error("Fetching live resource service principals via az ad sp show...");
const resourceLookups = {};
for (const resourceAppId of Object.keys(RESOURCE_NAMES)) {
  resourceLookups[resourceAppId] = fetchServicePrincipal(resourceAppId);
}

for (const [label, file] of Object.entries(baselines)) {
  console.log(`\n=== ${label} (${file}) ===`);
  const resolved = loadBaseline(file, resourceLookups);
  const byResource = {};
  for (const r of resolved) {
    (byResource[r.resourceName] ??= []).push(r);
  }
  for (const [resourceName, entries] of Object.entries(byResource)) {
    console.log(`  ${resourceName} (${entries.length}):`);
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      console.log(`    - ${e.name}  [${e.type}]  id=${e.id}`);
    }
  }
}
