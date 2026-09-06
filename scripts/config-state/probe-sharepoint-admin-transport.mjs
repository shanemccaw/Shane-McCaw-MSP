#!/usr/bin/env node
/**
 * #2943 — Live, READ-ONLY probe answering one question: can the 23
 * `read_transport = 'sharepoint-admin'` resource types be reached WITHOUT adding a
 * PnP/SharePoint PowerShell session type to the `ps-execution` container?
 *
 * Two candidate transports are probed against the real testbed tenant
 * (mccawsoft2.onmicrosoft.com, tenants.id = 1), both of which already exist in this
 * codebase and need no container work:
 *
 *   A. Microsoft Graph  `GET /v1.0/admin/sharepoint/settings`
 *      — the endpoint behind `Get-MgAdminSharepointSetting`. Client-SECRET app-only
 *        auth, the same transport `verify-sample.mjs` already uses. Permission
 *        `SharePointTenantSettings.Read.All` is already in the tenant's consent record.
 *
 *   B. SharePoint tenant-admin CSOM  `POST {prefix}-admin.sharepoint.com/_vti_bin/client.svc/ProcessQuery`
 *      — the transport `artifacts/api-server/src/lib/sharepoint-admin.ts` already
 *        implements (certificate app-only + `Sites.FullControl.All`). This is the SAME
 *        wire protocol `Get-PnPTenant` and friends use; PnP.PowerShell is a client for
 *        it, not a privileged path to it.
 *
 * SAFETY — mirrors verify-sample.mjs's constraints by construction, because the testbed
 * tenant is Shane's real production Microsoft 365 tenant:
 *   - Graph probe issues only `GET`.
 *   - The CSOM probe sends only a `<Query>` action (CSOM's read verb). There is no
 *     `SetProperty` / method-invocation payload anywhere in this file, so it cannot
 *     mutate tenant state even if edited carelessly — grep for `SetProperty` to confirm.
 *   - Only the MT app registration is used (never the PROD registration 3308b280-…),
 *     per CLAUDE.md's production-change gate.
 *
 * Usage:  node scripts/config-state/probe-sharepoint-admin-transport.mjs [--tenant 1]
 */
import { randomUUID, createPrivateKey, createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "./db.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const TENANT_ID = Number(arg("--tenant", "1"));

async function loadEnv() {
  const out = {};
  try {
    const txt = await readFile(path.join(repoRoot, ".env.local"), "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* fall through to process.env */ }
  return { ...out, ...process.env };
}

async function graphToken(env, entraTenantId) {
  const res = await fetch(`https://login.microsoftonline.com/${entraTenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: env.MT_APP_CLIENT_ID,
      client_secret: env.MT_APP_CLIENT_SECRET,
      scope: "https://graph.microsoft.com/.default",
    }).toString(),
  });
  if (!res.ok) throw new Error(`graph token failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).access_token;
}

/**
 * Certificate (client_assertion) app-only token for a SharePoint resource host.
 * Deliberately identical in shape to getSharePointToken() in
 * artifacts/api-server/src/lib/sharepoint-admin.ts — the point of this probe is to
 * exercise that exact production code path, not a parallel one.
 */
async function sharePointToken(env, entraTenantId, resourceHost) {
  const clientId = env.MT_APP_CLIENT_ID;
  const privateKey = (env.MT_APP_CERT_PRIVATE_KEY ?? "").replace(/\\n/g, "\n");
  const thumbprint = (env.MT_APP_CERT_THUMBPRINT ?? "").replace(/[:\s]/g, "");
  if (!clientId || !privateKey || !thumbprint) {
    throw new Error("MT_APP_CLIENT_ID / MT_APP_CERT_PRIVATE_KEY / MT_APP_CERT_THUMBPRINT not configured");
  }
  const key = createPrivateKey(privateKey); // fail fast + legibly (Git #855)
  const tokenEndpoint = `https://login.microsoftonline.com/${entraTenantId}/oauth2/v2.0/token`;
  // Hand-rolled RS256 rather than `jsonwebtoken` (which sharepoint-admin.ts uses):
  // scripts/ is its own workspace package and does not depend on it, and adding a
  // dependency for a diagnostic would mean a package download — a real metered cost
  // on this connection (Git #1987). The emitted JWT is byte-compatible.
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const signingInput =
    `${b64({ alg: "RS256", typ: "JWT", x5t: Buffer.from(thumbprint, "hex").toString("base64url") })}.` +
    b64({ aud: tokenEndpoint, iss: clientId, sub: clientId, jti: randomUUID(), nbf: now, exp: now + 480 });
  const signature = createSign("RSA-SHA256").update(signingInput).sign(key).toString("base64url");
  const assertion = `${signingInput}.${signature}`;
  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      scope: `https://${resourceHost}/.default`,
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: assertion,
    }).toString(),
  });
  if (!res.ok) throw new Error(`sharepoint token failed: ${res.status} ${(await res.text()).slice(0, 400)}`);
  return (await res.json()).access_token;
}

/** CSOM read of the tenant-admin `Tenant` object (the object `Get-PnPTenant` returns). */
const TENANT_TYPE_ID = "{268004ae-ef6b-4e9b-8425-127220d84719}";

async function csomTenantProperties(token, adminHost) {
  const body =
    `<Request xmlns="http://schemas.microsoft.com/sharepoint/clientquery/2009" SchemaVersion="15.0.0.0" ` +
    `LibraryVersion="16.0.0.0" ApplicationName="shane-msp config-state probe #2943">` +
    `<Actions><ObjectPath Id="2" ObjectPathId="1" />` +
    `<Query Id="3" ObjectPathId="1"><Query SelectAllProperties="true"><Properties /></Query></Query>` +
    `</Actions><ObjectPaths><Constructor Id="1" TypeId="${TENANT_TYPE_ID}" /></ObjectPaths></Request>`;
  const res = await fetch(`https://${adminHost}/_vti_bin/client.svc/ProcessQuery`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/xml" },
    body,
  });
  return { status: res.status, text: await res.text() };
}

async function main() {
  const env = await loadEnv();
  const db = await connect();
  const { rows } = await db.query(
    "select id, customer_name, tenant_id, domain, is_testbed from tenants where id = $1",
    [TENANT_ID],
  );
  await db.end();
  const tenant = rows[0];
  if (!tenant) throw new Error(`tenant ${TENANT_ID} not found`);
  const prefix = String(tenant.domain || "").split(".")[0];
  console.log(`tenant ${tenant.id} (${tenant.customer_name}) domain=${tenant.domain} testbed=${tenant.is_testbed} spPrefix=${prefix}`);

  // ── A. Graph /admin/sharepoint/settings ──────────────────────────────────
  try {
    const token = await graphToken(env, tenant.tenant_id);
    const res = await fetch("https://graph.microsoft.com/v1.0/admin/sharepoint/settings", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    const text = await res.text();
    console.log(`\n[A] GET /v1.0/admin/sharepoint/settings -> ${res.status}`);
    if (res.ok) {
      const json = JSON.parse(text);
      const keys = Object.keys(json).filter((k) => !k.startsWith("@"));
      console.log(`    ${keys.length} properties: ${keys.join(", ")}`);
    } else {
      console.log(`    ${text.slice(0, 500)}`);
    }
  } catch (err) {
    console.log(`\n[A] FAILED: ${err.message}`);
  }

  // ── B. SharePoint tenant-admin CSOM ProcessQuery ─────────────────────────
  const adminHost = `${prefix}-admin.sharepoint.com`;
  try {
    const token = await sharePointToken(env, tenant.tenant_id, adminHost);
    const { status, text } = await csomTenantProperties(token, adminHost);
    console.log(`\n[B] POST https://${adminHost}/_vti_bin/client.svc/ProcessQuery -> ${status}`);
    if (status === 200) {
      const parsed = JSON.parse(text);
      const err = parsed.find((e) => e && typeof e === "object" && e.ErrorInfo)?.ErrorInfo;
      if (err) {
        console.log(`    CSOM ErrorInfo: ${err.ErrorMessage} (${err.ErrorTypeName})`);
      } else {
        const obj = parsed.find((e) => e && typeof e === "object" && e._ObjectType_);
        const keys = obj ? Object.keys(obj).filter((k) => !k.startsWith("_")) : [];
        console.log(`    _ObjectType_=${obj?._ObjectType_} — ${keys.length} tenant properties`);
        console.log(`    sample: ${keys.slice(0, 30).join(", ")}`);
        // Which of the 23 `sharepoint-admin` resource types' properties are actually
        // present on this ONE Tenant read? This is the number that decides whether a
        // PnP session type is worth building (#2943).
        const probes = {
          "SPOSharingSettings/SPOAccessControlSettings": ["SharingCapability", "SharingDomainRestrictionMode", "DefaultSharingLinkType", "RequireAnonymousLinksExpireInDays", "ConditionalAccessPolicy"],
          "ODSettings": ["OneDriveStorageQuota", "OrphanedPersonalSitesRetentionPeriod", "NotifyOwnersWhenItemsReshared", "ExcludedFileExtensionsForSyncClient", "BlockMacSync"],
          "SPOBrowserIdleSignout": ["BrowserIdleSignout", "BrowserIdleSignoutMinutes", "BrowserIdleSignoutWarningMinutes"],
          "SPOTenantSettings": ["SearchResolveExactEmailOrUPN", "DisabledWebPartIds", "PublicCdnEnabled", "PublicCdnAllowedFileTypes"],
          "SPOTheme": ["HideDefaultThemes"],
          "SPOOrgAssetsLibrary": ["OrgNewsSiteUrl"],
        };
        for (const [resource, props] of Object.entries(probes)) {
          const present = props.filter((p) => p in (obj ?? {}));
          console.log(`    ${resource}: ${present.length}/${props.length} probe properties present${present.length ? ` — ${present.join(", ")}` : ""}`);
        }
      }
    } else {
      console.log(`    ${text.slice(0, 600)}`);
    }
  } catch (err) {
    console.log(`\n[B] FAILED: ${err.message}`);
  }

  // ── C. SharePoint admin REST reads that are NOT Tenant-object properties ──
  // Site designs / site scripts / hub sites / home site each have their own
  // admin-host REST endpoint. Some are POST-shaped reads (SharePoint's
  // SiteScriptUtility surface is method-invocation style), so this loop enforces
  // read-ness by NAME: every endpoint below must be a bare GET or a method whose
  // final segment starts with `Get`. Nothing else can be added without editing
  // this guard, which is deliberate.
  const restProbes = [
    { resource: "SPOHubSite", method: "GET", path: "/_api/HubSites" },
    { resource: "SPOHomeSite", method: "GET", path: "/_api/SPHSite" },
    { resource: "SPOSiteDesign", method: "POST", path: "/_api/Microsoft.SharePoint.Utilities.WebTemplateExtensions.SiteScriptUtility.GetSiteDesigns" },
    { resource: "SPOSiteScript", method: "POST", path: "/_api/Microsoft.SharePoint.Utilities.WebTemplateExtensions.SiteScriptUtility.GetSiteScripts" },
    { resource: "SPOStorageEntity", method: "GET", path: "/_api/web/GetStorageEntity('__probe_nonexistent__')" },
  ];
  console.log("");
  try {
    const token = await sharePointToken(env, tenant.tenant_id, adminHost);
    for (const p of restProbes) {
      const lastSegment = p.path.split(/[./]/).filter(Boolean).pop() ?? "";
      if (p.method !== "GET" && !lastSegment.startsWith("Get")) {
        console.log(`[C] ${p.resource}: SKIPPED — not a read-shaped endpoint (${p.method} ${p.path})`);
        continue;
      }
      const res = await fetch(`https://${adminHost}${p.path}`, {
        method: p.method,
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json;odata=nometadata" },
      });
      const text = await res.text();
      let detail = "";
      if (res.ok) {
        try {
          const json = JSON.parse(text);
          const value = json.value ?? json;
          detail = Array.isArray(value)
            ? `${value.length} item(s)`
            : `object keys: ${Object.keys(value).filter((k) => !k.startsWith("odata")).slice(0, 8).join(", ")}`;
        } catch { detail = text.slice(0, 120); }
      } else {
        detail = text.replace(/\s+/g, " ").slice(0, 220);
      }
      console.log(`[C] ${p.resource}: ${p.method} ${p.path} -> ${res.status} — ${detail}`);
      await new Promise((r) => setTimeout(r, 350));
    }
  } catch (err) {
    console.log(`[C] FAILED: ${err.message}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
