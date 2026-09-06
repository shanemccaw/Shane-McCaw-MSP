#!/usr/bin/env node
// Git #2846 — the controlled live probe Shane authorised on 2026-09-05.
//
// QUESTION: Microsoft's operation page for
// `PATCH /policies/identitySecurityDefaultsEnforcementPolicy` documents only
// `Policy.Read.All` (least) and `Policy.Read.All` + `Policy.ReadWrite.ConditionalAccess`
// (higher) for the Application tier. The general Graph permissions reference
// separately documents `Policy.ReadWrite.SecurityDefaults` — "Read and write
// security defaults policy" — which is an exact description of this one operation
// and appears nowhere on the operation page. One of the two pages is stale.
// Documentation cannot settle it; only a real call can.
//
// WHAT THIS DOES: acquires the same app-only token the platform's Graph write
// executor uses (DEV write app registration 9f6f4772-b5be-421f-815e-b392336c373a,
// MT_APP_WRITE_CLIENT_ID/SECRET from .env.local), prints the `roles` claim, and
// optionally issues the real PATCH that quickstart-v1 step 5
// (`quickstart-v1.disable-security-defaults`) makes.
//
// SAFETY: `patch` always sends the tenant's CURRENT `isEnabled` value unless an
// explicit value is passed, so the authorisation decision (204 vs 403) is exercised
// without changing tenant state. Graph evaluates the app role before it looks at the
// body, so a no-op write answers the question exactly as a state-changing one would.
//
// GIT #1913 GATE: DEV app registration only. Never the PROD write app
// (3308b280-e41e-42ba-9f73-73aac2ad3dee).
//
// Usage:
//   node scripts/azure/securitydefaults-permission-probe-2846.mjs roles
//   node scripts/azure/securitydefaults-permission-probe-2846.mjs read
//   node scripts/azure/securitydefaults-permission-probe-2846.mjs patch [true|false]

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const DEV_WRITE_APP_ID = "9f6f4772-b5be-421f-815e-b392336c373a";
const TENANT_ID = "c4c814d4-3afe-441e-9145-62461d0a4fd3"; // mccawsoft2.onmicrosoft.com
const POLICY_URL = "/policies/identitySecurityDefaultsEnforcementPolicy";

function parseEnvLocal() {
  const out = {};
  for (const line of readFileSync(path.join(repoRoot, ".env.local"), "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return out;
}

async function acquireToken(env) {
  if (env.MT_APP_WRITE_CLIENT_ID !== DEV_WRITE_APP_ID) {
    throw new Error(
      `Refusing to run: MT_APP_WRITE_CLIENT_ID is ${env.MT_APP_WRITE_CLIENT_ID}, not the DEV write app ${DEV_WRITE_APP_ID}.`,
    );
  }
  const res = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.MT_APP_WRITE_CLIENT_ID,
      client_secret: env.MT_APP_WRITE_CLIENT_SECRET,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  const json = await res.json();
  if (!json.access_token) {
    throw new Error(`Token request failed: ${json.error} — ${String(json.error_description).slice(0, 300)}`);
  }
  const claims = JSON.parse(
    Buffer.from(json.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(),
  );
  return { accessToken: json.access_token, claims };
}

async function graph(accessToken, method, url, payload) {
  const res = await fetch("https://graph.microsoft.com/v1.0" + url, {
    method,
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  return { status: res.status, body: await res.text() };
}

function reportRoles(claims) {
  const roles = (claims.roles ?? []).slice().sort();
  console.log(`appid=${claims.appid}  tid=${claims.tid}  iat=${new Date(claims.iat * 1000).toISOString()}`);
  console.log(`Policy.* roles in token: ${roles.filter((r) => r.startsWith("Policy.")).join(", ") || "(none)"}`);
  console.log(`total roles in token: ${roles.length}`);
  return roles;
}

const cmd = process.argv[2] ?? "roles";
const env = parseEnvLocal();
const { accessToken, claims } = await acquireToken(env);
reportRoles(claims);

if (cmd === "read") {
  const res = await graph(accessToken, "GET", POLICY_URL);
  console.log(`GET ${POLICY_URL} -> HTTP ${res.status}`);
  console.log(res.body);
} else if (cmd === "patch") {
  let value = process.argv[3];
  if (value === undefined) {
    const cur = await graph(accessToken, "GET", POLICY_URL);
    if (cur.status !== 200) {
      console.error(`Cannot read current state to build a no-op PATCH (HTTP ${cur.status}): ${cur.body}`);
      process.exit(1);
    }
    value = String(JSON.parse(cur.body).isEnabled);
    console.log(`No value given — sending the tenant's current value (isEnabled=${value}) as a no-op write.`);
  }
  const res = await graph(accessToken, "PATCH", POLICY_URL, { isEnabled: value === "true" });
  console.log(`PATCH ${POLICY_URL} { isEnabled: ${value === "true"} } -> HTTP ${res.status}`);
  console.log(res.body || "(empty body)");
} else if (cmd !== "roles") {
  console.error(`Unknown command "${cmd}". Use roles | read | patch [true|false].`);
  process.exit(2);
}
