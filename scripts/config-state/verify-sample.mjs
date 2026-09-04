#!/usr/bin/env node
/**
 * #1794 — Live, READ-ONLY verification of a representative sample of the resource model.
 *
 * SAFETY — the testbed customer (mccawsoft2.onmicrosoft.com, tenants.id = 1) is Shane's
 * REAL production Microsoft 365 tenant, with write-back and consent gates armed. This
 * script is therefore constrained to reads by construction, not by care:
 *
 *   - Only `GET` is ever issued. There is no code path here that can send another verb.
 *   - Only resources whose read_transport is `graph` are attempted; PowerShell,
 *     SharePoint-admin and Azure-RM resources are recorded `not_attempted` with the
 *     reason, never invoked speculatively.
 *   - Only paths with NO unresolved template segment are attempted; a path such as
 *     `/groups/{id}/settings` needs a real object id, and inventing one is exactly the
 *     probing this issue forbids.
 *   - `$top=1` on every collection read, so the smallest possible amount of the
 *     tenant's real data crosses the wire.
 *   - Requests are serialised with a delay between them. `429 TooManyRequests` is an
 *     already-observed error literal on this platform; a sample is not worth causing one.
 *
 * WHAT IS STORED: shape only — property names, and property -> JSON type. No values are
 * ever written to the database. The point is to prove the derived model matches the real
 * response, and a type map proves that without copying a production tenant's data.
 *
 * Anything not sampled keeps `derived_not_verified`. That is the honest state, and it is
 * the state of most of the model by design — this verifies a sample, not everything.
 *
 * Usage:
 *   node scripts/config-state/verify-sample.mjs [--tenant 1] [--per-surface 3] [--delay 350]
 */
import { randomUUID } from "node:crypto";
import { connect, insertRows } from "./db.mjs";
import { resolveDatabaseUrl } from "./db.mjs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectPropertyDivergence } from "./detect-property-divergence.mjs";
import { applyLiveEvidence } from "./reconcile-live-evidence.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const TENANT_ID = Number(arg("--tenant", "1"));
const PER_SURFACE = Number(arg("--per-surface", "3"));
const DELAY_MS = Number(arg("--delay", "350"));

/** The only HTTP method this file can produce. */
const READ_METHOD = "GET";

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

async function getAppOnlyToken(env, entraTenantId) {
  const clientId = env.MT_APP_CLIENT_ID;
  const clientSecret = env.MT_APP_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("MT_APP_CLIENT_ID / MT_APP_CLIENT_SECRET not configured");
  const res = await fetch(`https://login.microsoftonline.com/${entraTenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
    }).toString(),
  });
  if (!res.ok) throw new Error(`token request failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).access_token;
}

/** A path is sampleable only if every segment is literal — no `{id}` to invent. */
function isConcretePath(p) {
  return !!p && !/\{|\}/.test(p);
}

const jsonType = (v) =>
  v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "object" ? "object" : typeof v;

/** Property -> JSON type for the first item of a collection, or the object itself. */
function shapeOf(body) {
  const subject = Array.isArray(body?.value) ? body.value[0] : body;
  if (!subject || typeof subject !== "object") return { names: [], shape: {} };
  const shape = {};
  for (const [k, v] of Object.entries(subject)) {
    if (k.startsWith("@odata")) continue;
    shape[k] = jsonType(v);
  }
  return { names: Object.keys(shape).sort(), shape };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const client = await connect();
  const env = await loadEnv();
  const sampleRunId = randomUUID();

  try {
    const tenant = (await client.query(
      "SELECT id, tenant_id, domain, is_testbed FROM tenants WHERE id = $1", [TENANT_ID])).rows[0];
    if (!tenant) throw new Error(`tenant ${TENANT_ID} not found`);
    console.log(`Sampling READ-ONLY against ${tenant.domain} (entra ${tenant.tenant_id}, is_testbed=${tenant.is_testbed})`);
    if (!tenant.is_testbed) throw new Error("refusing to sample a tenant that is not flagged is_testbed");

    // Representative subset: the best-supported resources per surface. Ordered so the
    // sample favours resources the model claims are readable NOW — those are the ones
    // whose claim is worth testing — and spreads across workloads rather than
    // hammering one.
    const candidates = (await client.query(`
      SELECT id, resource_key, graph_version, graph_path, graph_is_collection, surface,
             availability, graph_container_kind, graph_read_permission_options
        FROM config_resources
       WHERE read_transport = 'graph'
         AND graph_path IS NOT NULL
         AND availability = 'available_now'
         -- Bound OData functions take REQUIRED arguments (a reporting period, a date).
         -- Calling one without them returns 400 BadRequest, which would say nothing
         -- about whether the model describes the resource correctly. Excluded on
         -- purpose and recorded as not_attempted below rather than sampled badly.
         AND graph_container_kind <> 'function'
       ORDER BY surface, check_coverage_count DESC, property_count DESC, graph_path`)).rows;

    const bySurface = new Map();
    const chosen = [];
    for (const r of candidates) {
      if (!isConcretePath(r.graph_path)) continue;
      const n = bySurface.get(r.surface) ?? 0;
      if (n >= PER_SURFACE) continue;
      bySurface.set(r.surface, n + 1);
      chosen.push(r);
    }
    console.log(`  ${chosen.length} resources selected across ${bySurface.size} surfaces (max ${PER_SURFACE} each)`);

    const token = await getAppOnlyToken(env, tenant.tenant_id);
    const rows = [];

    /** The one and only request this script can make. */
    async function readOnce(version, requestPath) {
      const res = await fetch(`https://graph.microsoft.com/${version}${requestPath}`, {
        method: READ_METHOD,
        headers: {
          Authorization: `Bearer ${token}`,
          // #393 — undici sets `accept-language: *`, which Graph's PIM backend
          // rejects as an unparseable culture. Set a real one explicitly.
          "Accept-Language": "en-US",
        },
      });
      const text = await res.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
      return { res, text, body };
    }

    for (const r of chosen) {
      let requestPath = r.graph_is_collection ? `${r.graph_path}?$top=1` : r.graph_path;
      const started = Date.now();
      let out = {
        sample_run_id: sampleRunId,
        resource_key: r.resource_key,
        config_resource_id: r.id,
        tenant_id: TENANT_ID,
        graph_version: r.graph_version,
        request_path: requestPath,
        http_status: null,
        ok: false,
        error_code: null,
        error_message: null,
        item_count: null,
        observed_property_names: "[]",
        observed_shape: "{}",
        duration_ms: null,
        skipped_reason: null,
      };
      try {
        let { res, text, body } = await readOnce(r.graph_version, requestPath);

        // A handful of Graph collections (subscribedSkus, groupSettingTemplates) do
        // not implement $top and answer Request_UnsupportedQuery. That is this
        // script's query shape being wrong, not the model being wrong, so retry
        // without it rather than record a failure the resource did not cause.
        if (!res.ok && body?.error?.code === "Request_UnsupportedQuery" && requestPath.includes("?$top=1")) {
          requestPath = requestPath.replace("?$top=1", "");
          await sleep(DELAY_MS);
          ({ res, text, body } = await readOnce(r.graph_version, requestPath));
        }

        out.request_path = requestPath;
        out.http_status = res.status;
        out.duration_ms = Date.now() - started;

        if (res.ok) {
          out.ok = true;
          if (Array.isArray(body?.value)) out.item_count = body.value.length;
          const { names, shape } = shapeOf(body);
          out.observed_property_names = JSON.stringify(names);
          out.observed_shape = JSON.stringify(shape);
        } else {
          out.error_code = body?.error?.code ?? null;
          out.error_message = (body?.error?.message ?? text ?? "").slice(0, 500);
        }
      } catch (err) {
        out.error_message = String(err?.message ?? err).slice(0, 500);
        out.duration_ms = Date.now() - started;
      }
      rows.push(out);
      const badge = out.ok ? `OK ${out.item_count ?? "obj"}` : `${out.http_status ?? "ERR"} ${out.error_code ?? ""}`;
      console.log(`  ${badge.padEnd(34)} ${r.graph_version} ${requestPath}`);
      await sleep(DELAY_MS);
    }

    await insertRows(client, "config_resource_samples", Object.keys(rows[0]), rows);

    // Resources this script DELIBERATELY did not attempt are marked `not_attempted`
    // with the reason, rather than left indistinguishable from "just not reached yet".
    // Everything else keeps `derived_not_verified`, which is the honest default.
    await client.query(`
      UPDATE config_resources
         SET verification_status = 'not_attempted',
             notes = 'not sampled: bound OData function requires arguments (a reporting period or date); calling it without them would prove nothing about the model',
             updated_at = now()
       WHERE read_transport = 'graph' AND graph_container_kind = 'function'
         AND verification_status = 'derived_not_verified'`);
    await client.query(`
      UPDATE config_resources
         SET verification_status = 'not_attempted',
             notes = 'not sampled: path contains an unresolved template segment and needs a real object id; inventing one is the endpoint probing this issue forbids',
             updated_at = now()
       WHERE read_transport = 'graph' AND graph_path LIKE '%{%'
         AND verification_status = 'derived_not_verified'`);
    await client.query(`
      UPDATE config_resources
         SET verification_status = 'not_attempted',
             notes = 'not sampled: read transport is ' || read_transport ||
                     ', which this Graph-only sampler cannot exercise (see #1793 for the PowerShell cmdlet survey)',
             updated_at = now()
       WHERE read_transport <> 'graph' AND verification_status = 'derived_not_verified'`);

    // #1895 — shared with build-resource-model.mjs's post-rebuild reconciliation, so
    // "what counts as a live license gap" has exactly one definition, not two copies
    // that could drift.
    const evidence = await applyLiveEvidence(client, { sampleRunId });

    const ok = rows.filter((r) => r.ok).length;
    console.log(`\nSample run ${sampleRunId}`);
    console.log(`  ${ok}/${rows.length} returned 200; ${rows.length - ok} failed (recorded with the real Graph error code)`);
    if (evidence.licenseGapKeys.length) {
      console.log(`  ${evidence.licenseGapKeys.length} marked needs_license from live evidence: ${evidence.licenseGapKeys.join(", ")}`);
    }
    if (evidence.tenantMismatchKeys.length) {
      console.log(`  ${evidence.tenantMismatchKeys.length} marked unavailable (tenant-type mismatch) from live evidence: ${evidence.tenantMismatchKeys.join(", ")}`);
    }
    const breakdown = (await client.query(
      "SELECT verification_status, count(*) n FROM config_resources GROUP BY 1 ORDER BY 2 DESC")).rows;
    console.log("  verification status across the whole model:");
    for (const b of breakdown) console.log(`    ${String(b.n).padStart(5)}  ${b.verification_status}`);

    // #1846 — every live sample is a chance to re-derive the $metadata-vs-observed
    // divergence, so a newly-undeclared property surfaces here rather than needing
    // someone to remember to run a separate query.
    const divergence = await detectPropertyDivergence(client);
    console.log(`\n  property divergence: ${divergence.total} observed-but-undeclared`
      + ` (${divergence.versionGap} version_gap, ${divergence.undeclaredAnywhere} undeclared_anywhere)`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`verify-sample failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
