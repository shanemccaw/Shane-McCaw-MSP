#!/usr/bin/env node
// Preview-only proof for execute_action (Git #1323): spawns the real MCP
// server and calls execute_action WITHOUT confirm — it must resolve the real
// request through the live route + catalog wiring and write NOTHING to Graph.
// This proves routing, slug→template resolution, variable substitution and the
// preview branch end-to-end. The confirmed real-write is proven separately.
//
//   node scripts/e2e-execute-action-preview.mjs <customerId> <userId>
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const customerId = Number(process.argv[2]);
const userId = process.argv[3];
const pkgDir = dirname(dirname(fileURLToPath(import.meta.url)));
const child = spawn(process.execPath, [join(pkgDir, "src", "index.ts")], {
  stdio: ["pipe", "pipe", "inherit"],
  cwd: pkgDir,
  env: process.env,
});

let buffer = "";
const pending = new Map();
let nextId = 1;
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  }
});
function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout ${method}`)), 60_000);
    pending.set(id, (msg) => { clearTimeout(timer); msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result); });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
function notify(method, params) { child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n"); }
const failures = [];
function check(label, ok, detail) { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`); if (!ok) failures.push(label); }
function parse(r) { try { return JSON.parse(r?.content?.[0]?.text ?? "null"); } catch { return null; } }

try {
  await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e-preview", version: "0.0.0" } });
  notify("notifications/initialized", {});
  const tools = await request("tools/list", {});
  const names = (tools?.tools ?? []).map((t) => t.name);
  check("tools/list contains execute_action", names.includes("execute_action"), "");

  const previewRes = await request("tools/call", {
    name: "execute_action",
    arguments: { serviceSlug: "remediate-revoke-sessions", customerId, variables: { userId } },
  });
  const p = parse(previewRes);
  check(
    "preview resolves real request, writes nothing",
    !previewRes?.isError && p?.executed === false && p?.mode === "preview" &&
      p?.resolvedRequest?.endpoint === `/users/${userId}/revokeSignInSessions` &&
      p?.resolvedRequest?.method === "POST" && p?.ready === true,
    previewRes?.isError ? (previewRes?.content?.[0]?.text ?? "").slice(0, 250)
      : `endpoint=${p?.resolvedRequest?.endpoint} method=${p?.resolvedRequest?.method} ready=${p?.ready} tenant=${p?.tenant?.name} template=${p?.service?.templateId}`,
  );

  // Negative: a config-pack slug must be refused (that's execute_write_pack's job).
  const packRes = await request("tools/call", {
    name: "execute_action",
    arguments: { serviceSlug: "entra-id-quickstart-v1", customerId, confirm: true },
  });
  check(
    "config-pack slug refused with a real 400",
    packRes?.isError && (packRes?.content?.[0]?.text ?? "").includes("config_pack"),
    (packRes?.content?.[0]?.text ?? "").slice(0, 160),
  );

  // Preview call must still have landed a real audit row (Git #1325).
  const { loadEnvLocal } = await import("../src/env.ts");
  loadEnvLocal();
  const { default: pg } = await import("pg");
  const dbc = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await dbc.connect();
  const { rows } = await dbc.query(
    `SELECT outcome, customer_id, entity_id FROM msp_audit_logs
      WHERE action_type = 'mcp.tool.execute_action' AND occurred_at > now() - interval '2 minutes'
      ORDER BY occurred_at DESC LIMIT 5`,
  );
  await dbc.end();
  check(
    "msp_audit_logs holds finalized rows for the preview calls (Git #1325)",
    rows.some((r) => r.outcome === "success" && r.customer_id === customerId && r.entity_id === "remediate-revoke-sessions"),
    rows.map((r) => `${r.entity_id}:${r.outcome}`).join(", ") || "no rows",
  );
} catch (err) {
  check("e2e preview run", false, err instanceof Error ? err.message : String(err));
} finally {
  child.kill();
}
process.exit(failures.length ? 1 : 0);
