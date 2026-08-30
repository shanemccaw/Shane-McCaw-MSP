#!/usr/bin/env node
/**
 * #1906 — enrol an application as a Power Platform *management application* in a tenant.
 *
 * Microsoft requires this one-time registration before the BAP admin API
 * (https://api.bap.microsoft.com) will authorise ANY app-only call — there is no Entra
 * application permission, app role or admin-consent grant that unlocks it. See
 * https://learn.microsoft.com/en-us/power-platform/admin/powershell-create-service-principal
 * and artifacts/api-server/src/lib/power-platform-admin.ts.
 *
 * Microsoft also documents that a service principal CANNOT register itself: the call must
 * carry a tenant-admin USER token. That is the whole reason this is a script a human runs,
 * not something the platform can automate per-tenant.
 *
 * It makes exactly ONE request:
 *   PUT https://api.bap.microsoft.com/providers/Microsoft.BusinessAppPlatform/
 *       adminApplications/{clientId}?api-version=2020-10-01
 *
 * TOKEN HANDLING — deliberate, do not relax:
 *   - the user token is held in a local variable only; it is never written to disk, to an
 *     env file, to the database or to a log, at any level, including error paths;
 *   - it is never printed. Only non-secret claims (aud/tid/upn/exp) are echoed so the
 *     operator can confirm the right identity signed in;
 *   - it is used for the single PUT and nothing else — not for a read, not to verify.
 *     Verification is deliberately done by the app-only path
 *     (scripts/verify-power-platform-1869.mts), because verifying with the user token
 *     would only prove the user has access, which was never in doubt;
 *   - it is cleared as soon as the PUT returns.
 *
 * Usage (from the repo root):
 *   node scripts/azure/enrol-power-platform-management-app.mjs <appClientId> [--tenant <id>]
 *   node scripts/azure/enrol-power-platform-management-app.mjs <appClientId> --device-code
 *
 * Without --device-code it first tries the already-signed-in Azure CLI
 * ("az account get-access-token --resource https://service.powerapps.com/"), which needs no
 * interaction at all, and falls back to device code only if that fails.
 */
import { spawn } from "node:child_process";

const BAP_HOST = "api.bap.microsoft.com";
const RESOURCE = "https://service.powerapps.com/";
const API_VERSION = "2020-10-01";
// Azure CLI's own well-known public client id — usable for device code without registering
// anything new. Same client the operator is already signed in to.
const AZURE_CLI_CLIENT_ID = "04b07795-8ddb-461a-bbee-02f9e1bf7b46";

const args = process.argv.slice(2);
const appId = args.find((a) => !a.startsWith("--"));
const forceDeviceCode = args.includes("--device-code");
const tenantArg = (() => {
  const i = args.indexOf("--tenant");
  return i >= 0 ? args[i + 1] : undefined;
})();

if (!appId) {
  console.error("Usage: node scripts/azure/enrol-power-platform-management-app.mjs <appClientId> [--tenant <id>] [--device-code]");
  process.exit(2);
}

/** Non-secret claims only — never the token itself. */
function describeToken(token) {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const c = JSON.parse(Buffer.from(part, "base64").toString("utf8"));
    return {
      aud: c.aud,
      tid: c.tid,
      signedInAs: c.upn ?? c.unique_name ?? c.preferred_username ?? "(no upn claim)",
      idtyp: c.idtyp ?? (c.oid && !c.upn ? "app?" : "user"),
      expiresUtc: c.exp ? new Date(c.exp * 1000).toISOString() : "(none)",
    };
  } catch {
    return { parsed: false };
  }
}

function run(cmd, cmdArgs) {
  return new Promise((resolve) => {
    const p = spawn(cmd, cmdArgs, { shell: process.platform === "win32" });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => resolve({ code: -1, out, err: String(e) }));
    p.on("close", (code) => resolve({ code, out, err }));
  });
}

/** Step 1 — the free path. Returns the token in memory, or null. */
async function tokenFromAzureCli() {
  const cmdArgs = ["account", "get-access-token", "--resource", RESOURCE, "-o", "json"];
  if (tenantArg) cmdArgs.push("--tenant", tenantArg);
  const { code, out, err } = await run("az", cmdArgs);
  if (code !== 0) {
    console.log(`  az returned exit ${code}: ${err.trim().split("\n").slice(0, 3).join(" | ")}`);
    return null;
  }
  try {
    const token = JSON.parse(out).accessToken;
    return typeof token === "string" && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

/** Step 2 — device code, only if step 1 failed. Prints the code immediately, then polls. */
async function tokenFromDeviceCode() {
  const tenant = tenantArg ?? "organizations";
  const base = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;
  const scope = `${RESOURCE}.default offline_access`;

  const initRes = await fetch(`${base}/devicecode`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: AZURE_CLI_CLIENT_ID, scope }),
  });
  const init = await initRes.json();
  if (!initRes.ok) {
    throw new Error(`device code request failed: ${initRes.status} ${JSON.stringify(init)}`);
  }

  console.log("");
  console.log("=".repeat(72));
  console.log("  SIGN IN NOW — the code below expires in a few minutes.");
  console.log("");
  console.log(`  1. Open:  ${init.verification_uri}`);
  console.log(`  2. Code:  ${init.user_code}`);
  console.log("");
  console.log("  Sign in as a Global Administrator of the target tenant.");
  console.log("=".repeat(72));
  console.log("");

  const deadline = Date.now() + (init.expires_in ?? 900) * 1000;
  let interval = (init.interval ?? 5) * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    const pollRes = await fetch(`${base}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: AZURE_CLI_CLIENT_ID,
        device_code: init.device_code,
      }),
    });
    const body = await pollRes.json();
    if (pollRes.ok && body.access_token) return body.access_token;
    if (body.error === "authorization_pending") continue;
    if (body.error === "slow_down") {
      interval += 5000;
      continue;
    }
    // expired_token / authorization_declined / anything else — surface the CODE only.
    throw new Error(`device code flow ended: ${body.error} — ${body.error_description?.split("\n")[0] ?? ""}`);
  }
  throw new Error("device code expired before sign-in completed");
}

async function main() {
  console.log(`Enrolling application ${appId} as a Power Platform management application.`);
  console.log(`Tenant: ${tenantArg ?? "(whatever the signed-in identity's home tenant is)"}`);
  console.log("");

  let token = null;
  if (!forceDeviceCode) {
    console.log("Step 1 — trying the already-signed-in Azure CLI (no interaction)...");
    token = await tokenFromAzureCli();
    console.log(token ? "  got a token from az." : "  az did not yield a usable token.");
  }
  if (!token) {
    console.log("Step 2 — device code flow.");
    token = await tokenFromDeviceCode();
  }

  const claims = describeToken(token);
  console.log("");
  console.log("Token identity (non-secret claims only):", JSON.stringify(claims));
  if (claims.tid && tenantArg && claims.tid !== tenantArg) {
    throw new Error(`token is for tenant ${claims.tid}, not the requested ${tenantArg} — refusing to PUT`);
  }
  console.log("");

  const url = `https://${BAP_HOST}/providers/Microsoft.BusinessAppPlatform/adminApplications/${appId}?api-version=${API_VERSION}`;
  console.log(`PUT ${url}`);

  let status;
  let text;
  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    });
    status = res.status;
    text = await res.text();
  } finally {
    // The token existed for that one call. It does not survive it.
    token = null;
  }

  console.log(`=> HTTP ${status}`);
  console.log(text.length > 4000 ? `${text.slice(0, 4000)}…` : text);
  process.exit(status >= 200 && status < 300 ? 0 : 1);
}

main().catch((e) => {
  // Error paths must not leak the token either — only the message is printed.
  console.error(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
