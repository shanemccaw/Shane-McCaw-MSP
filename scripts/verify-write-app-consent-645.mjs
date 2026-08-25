#!/usr/bin/env node
/**
 * Git #645 — Verify the WRITE app registration's permissions are ACTUALLY
 * granted in a real customer tenant's Azure AD, independent of the platform's
 * own `tenants.consent.writeBack` flag.
 *
 * Reads Shane's testbed tenant's REAL Azure AD Enterprise Applications record:
 *   1. Acquire an app-only token for the tenant using the READ multi-tenant app
 *      (MT_APP_CLIENT_ID/SECRET) — it declares Application.Read.All, which lets
 *      us read any service principal + its appRoleAssignments in the tenant.
 *   2. Find the WRITE app's service principal (Enterprise App) by its appId.
 *   3. List its appRoleAssignments — these ARE the granted application
 *      permissions shown under Entra → Enterprise Applications → Permissions.
 *   4. Resolve each granted appRoleId to a human name against the resource SP's
 *      appRoles, and compare to what the code says the write app REQUIRES.
 *
 * Read-only. No writes to Microsoft or the DB. Prints a real report either way.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load MT_APP_* from .env.local (do not print secret values) ────────────────
function loadEnvLocal() {
  const p = join(__dirname, "..", ".env.local");
  const out = {};
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const env = loadEnvLocal();
const TESTBED_TENANT = "c4c814d4-3afe-441e-9145-62461d0a4fd3";
const WRITE_APP_ID = "3308b280-e41e-42ba-9f73-73aac2ad3dee"; // graph.ts REQUIRED_WRITE_APP_PERMISSIONS header
const GRAPH_RESOURCE_APPID = "00000003-0000-0000-c000-000000000000"; // Microsoft Graph

// What the code declares the write app REQUIRES (graph.ts REQUIRED_WRITE_APP_PERMISSIONS)
const REQUIRED_WRITE_APP_PERMISSIONS = [
  "Application.ReadWrite.All",
  "Group.Create",
  "RoleManagement.ReadWrite.Directory",
];

async function tokenFor(tenant, clientId, clientSecret) {
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
  });
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, body: text };
  return { ok: true, token: JSON.parse(text).access_token };
}

async function graphGet(token, url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, json, text };
}

function line() { console.log("─".repeat(72)); }

(async () => {
  console.log("Git #645 — Real Azure AD verification of WRITE app consent");
  line();
  console.log("Testbed tenant :", TESTBED_TENANT);
  console.log("Write app appId:", WRITE_APP_ID, '("… (Write)")');
  console.log("Verifier       : READ app (MT_APP_CLIENT_ID) app-only token, Application.Read.All");
  line();

  const readId = env.MT_APP_CLIENT_ID;
  const readSecret = env.MT_APP_CLIENT_SECRET;
  if (!readId || !readSecret) {
    console.log("ABORT: MT_APP_CLIENT_ID / MT_APP_CLIENT_SECRET not present in .env.local — cannot query the tenant.");
    process.exit(2);
  }

  // 1) token for the testbed tenant via the READ app
  const tok = await tokenFor(TESTBED_TENANT, readId, readSecret);
  if (!tok.ok) {
    console.log(`ABORT: could not get a READ-app token for the testbed tenant (HTTP ${tok.status}).`);
    console.log(tok.body?.slice(0, 500));
    process.exit(2);
  }
  console.log("[1/4] READ-app app-only token for testbed tenant: OK (tenant has consented to the read app)");

  // 2) find the WRITE app's service principal in this tenant
  const spRes = await graphGet(
    tok.token,
    `https://graph.microsoft.com/v1.0/servicePrincipals?$filter=appId eq '${WRITE_APP_ID}'&$select=id,appId,displayName,accountEnabled`,
  );
  if (!spRes.ok) {
    console.log(`[2/4] Query write app service principal FAILED (HTTP ${spRes.status}).`);
    console.log(spRes.text?.slice(0, 600));
    process.exit(2);
  }
  const sp = spRes.json?.value?.[0];
  if (!sp) {
    console.log("[2/4] RESULT: NO service principal for the write app exists in this tenant.");
    console.log("       → The write app has NEVER been consented in this tenant (no Enterprise App record).");
    console.log("       → Platform 'writeBack granted' flag, if set, would be a FALSE positive.");
    process.exit(0);
  }
  console.log(`[2/4] Write-app Enterprise Application FOUND: spId=${sp.id} enabled=${sp.accountEnabled} name="${sp.displayName}"`);

  // 3) list its appRoleAssignments (granted application permissions)
  const araRes = await graphGet(
    tok.token,
    `https://graph.microsoft.com/v1.0/servicePrincipals/${sp.id}/appRoleAssignments?$top=200`,
  );
  if (!araRes.ok) {
    console.log(`[3/4] appRoleAssignments query FAILED (HTTP ${araRes.status}).`);
    console.log(araRes.text?.slice(0, 600));
    process.exit(2);
  }
  const assignments = araRes.json?.value ?? [];
  console.log(`[3/4] appRoleAssignments (granted application permissions) count: ${assignments.length}`);

  // 4) resolve appRoleId -> name against each resource SP's appRoles
  const resourceCache = new Map();
  async function resolveRole(resourceSpId, appRoleId) {
    if (!resourceCache.has(resourceSpId)) {
      const r = await graphGet(
        tok.token,
        `https://graph.microsoft.com/v1.0/servicePrincipals/${resourceSpId}?$select=appId,displayName,appRoles`,
      );
      resourceCache.set(resourceSpId, r.ok ? r.json : null);
    }
    const rsp = resourceCache.get(resourceSpId);
    const role = rsp?.appRoles?.find((a) => a.id === appRoleId);
    return { name: role?.value ?? "(unknown)", resource: rsp?.displayName ?? resourceSpId };
  }

  const grantedNames = new Set();
  line();
  console.log("Granted application permissions on the WRITE app (REAL Azure AD record):");
  for (const a of assignments) {
    const { name, resource } = await resolveRole(a.resourceId, a.appRoleId);
    grantedNames.add(name);
    console.log(`   • ${name}   [resource: ${resource}]`);
  }
  if (assignments.length === 0) console.log("   (none)");

  // Compare to required
  line();
  console.log("[4/4] Required vs. actually-granted (write app):");
  let allPresent = true;
  for (const req of REQUIRED_WRITE_APP_PERMISSIONS) {
    const present = grantedNames.has(req);
    if (!present) allPresent = false;
    console.log(`   ${present ? "✓ GRANTED " : "✗ MISSING "} ${req}`);
  }
  line();
  console.log(
    allPresent
      ? "VERDICT: All required write-app permissions are ACTUALLY granted in the tenant's real Azure AD."
      : "VERDICT: One or more required write-app permissions are NOT granted in the tenant's real Azure AD.",
  );
})().catch((e) => {
  console.error("UNEXPECTED ERROR:", e?.message ?? e);
  process.exit(3);
});
