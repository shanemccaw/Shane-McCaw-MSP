#!/usr/bin/env node
// Real end-to-end proof for the execute_action tool (Git #1323): spawns the
// actual MCP server over stdio, previews then EXECUTES one real micro-
// remediation (a real Microsoft Graph write) against the target customer's
// real connected tenant, and verifies both audit trails landed:
//   - msp_audit_logs (Git #1325 write-ahead row finalized to success)
//   - baseline_action_template_audit_log (the engine's own run record)
// No mocks anywhere in the chain.
//
//   node scripts/e2e-execute-action.mjs <customerId> <userId>
//
// Env: MCP_API_BASE_URL may point the underlying apiFetch at a private
// api-server instance (defaults to the dev :8080 one).
// Exit 0 = every check passed for real; exit 1 otherwise.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const customerId = Number(process.argv[2]);
const userId = process.argv[3];
if (!Number.isInteger(customerId) || !userId) {
  console.error("usage: node scripts/e2e-execute-action.mjs <customerId> <targetEntraUserId>");
  process.exit(1);
}

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
    try {
      msg = JSON.parse(line);
    } catch {
      continue; // not a protocol line
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 60_000);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      if (msg.error) reject(new Error(`${method}: ${JSON.stringify(msg.error)}`));
      else resolve(msg.result);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

const failures = [];
function check(label, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

function parseToolText(result) {
  try {
    return JSON.parse(result?.content?.[0]?.text ?? "null");
  } catch {
    return null;
  }
}

try {
  const init = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "e2e-execute-action", version: "0.0.0" },
  });
  check("initialize handshake", Boolean(init?.serverInfo?.name), `server=${init?.serverInfo?.name}`);
  notify("notifications/initialized", {});

  const tools = await request("tools/list", {});
  const names = (tools?.tools ?? []).map((t) => t.name);
  check("tools/list contains execute_action", names.includes("execute_action"), names.join(", "));

  // 1) PREVIEW — no confirm: must resolve the real request and write NOTHING.
  const previewRes = await request("tools/call", {
    name: "execute_action",
    arguments: {
      serviceSlug: "remediate-revoke-sessions",
      customerId,
      variables: { userId },
    },
  });
  const preview = parseToolText(previewRes);
  check(
    "preview resolves the real request without executing",
    !previewRes?.isError &&
      preview?.executed === false &&
      preview?.mode === "preview" &&
      preview?.resolvedRequest?.endpoint === `/users/${userId}/revokeSignInSessions` &&
      preview?.resolvedRequest?.method === "POST" &&
      preview?.ready === true,
    previewRes?.isError
      ? (previewRes?.content?.[0]?.text ?? "").slice(0, 250)
      : `endpoint=${preview?.resolvedRequest?.endpoint} ready=${preview?.ready} tenant=${preview?.tenant?.name}`,
  );

  // 2) EXECUTE — confirm:true fires the REAL Graph write.
  const execRes = await request("tools/call", {
    name: "execute_action",
    arguments: {
      serviceSlug: "remediate-revoke-sessions",
      customerId,
      variables: { userId },
      confirm: true,
    },
  });
  const exec = parseToolText(execRes);
  check(
    "confirmed call performs the REAL Graph write (success + 2xx)",
    !execRes?.isError &&
      exec?.executed === true &&
      exec?.mode === "executed" &&
      exec?.result?.success === true &&
      [200, 201, 204].includes(exec?.result?.status),
    execRes?.isError
      ? (execRes?.content?.[0]?.text ?? "").slice(0, 250)
      : `status=${exec?.result?.status} label=${exec?.result?.label} engineAuditLogId=${exec?.result?.auditLogId}`,
  );

  // 3) Both real audit trails must hold the run.
  const { loadEnvLocal } = await import("../src/env.ts");
  loadEnvLocal();
  const { default: pg } = await import("pg");
  const dbc = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await dbc.connect();
  const { rows: mcpRows } = await dbc.query(
    `SELECT outcome, customer_id, entity_id, metadata->>'phase' AS phase
       FROM msp_audit_logs
      WHERE action_type = 'mcp.tool.execute_action'
        AND occurred_at > now() - interval '3 minutes'
      ORDER BY occurred_at DESC`,
  );
  check(
    "msp_audit_logs holds finalized write-ahead rows for BOTH calls (Git #1325)",
    mcpRows.filter((r) => r.outcome === "success" && r.customer_id === customerId && r.entity_id === "remediate-revoke-sessions").length >= 2,
    mcpRows.map((r) => `${r.outcome}/${r.phase}`).join(", ") || "no rows",
  );
  const { rows: engineRows } = await dbc.query(
    `SELECT action, after_snapshot->>'success' AS success, after_snapshot->>'source' AS source
       FROM baseline_action_template_audit_log
      WHERE template_id = 'microrem.revoke-sign-in-sessions'
        AND created_at > now() - interval '3 minutes'
      ORDER BY created_at DESC LIMIT 3`,
  );
  check(
    "engine audit log holds the executed run (source execute_action)",
    engineRows.some((r) => r.action === "executed" && r.success === "true" && r.source === "execute_action"),
    engineRows.map((r) => `${r.action}:${r.success}:${r.source}`).join(", ") || "no rows",
  );
  await dbc.end();
} catch (err) {
  check("e2e run", false, err instanceof Error ? err.message : String(err));
} finally {
  child.kill();
}

process.exit(failures.length ? 1 : 0);
