#!/usr/bin/env node
// Real end-to-end proof for the MCP server: spawns the actual server process,
// performs the MCP initialize handshake over stdio, lists tools, and calls
// both real tools against the live local api-server + Postgres. No mocks
// anywhere in the chain.
//
//   pnpm --dir artifacts/mcp-server e2e
//
// Exit 0 = every check passed for real; exit 1 otherwise.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = dirname(dirname(fileURLToPath(import.meta.url)));
const child = spawn(process.execPath, [join(pkgDir, "src", "index.ts")], {
  stdio: ["pipe", "pipe", "inherit"],
  cwd: pkgDir,
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
    const timer = setTimeout(
      () => reject(new Error(`timeout waiting for ${method}`)),
      30_000,
    );
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

try {
  const init = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "e2e-check", version: "0.0.0" },
  });
  check(
    "initialize handshake",
    Boolean(init?.serverInfo?.name),
    `server=${init?.serverInfo?.name} v${init?.serverInfo?.version}`,
  );
  notify("notifications/initialized", {});

  const tools = await request("tools/list", {});
  const names = (tools?.tools ?? []).map((t) => t.name);
  check(
    "tools/list contains platform_health + whoami",
    names.includes("platform_health") && names.includes("whoami"),
    names.join(", "),
  );

  const health = await request("tools/call", { name: "platform_health", arguments: {} });
  const healthText = health?.content?.[0]?.text ?? "";
  check(
    "platform_health returns live status ok",
    !health?.isError && healthText.includes('"status": "ok"'),
    healthText.replaceAll("\n", " ").slice(0, 120),
  );

  const who = await request("tools/call", { name: "whoami", arguments: {} });
  const whoText = who?.content?.[0]?.text ?? "";
  let whoJson = null;
  try {
    whoJson = JSON.parse(whoText);
  } catch {
    /* leave null — check below fails honestly */
  }
  check(
    "whoami proves admin auth end to end",
    !who?.isError &&
      whoJson?.adminAccessVerified === true &&
      typeof whoJson?.liveCustomerCount === "number",
    who?.isError
      ? whoText.slice(0, 200)
      : `operator=${whoJson?.operator?.email} customers=${whoJson?.liveCustomerCount}`,
  );

  // Git #1325: both calls above must have landed in the real audit trail
  // (msp_audit_logs — the same table GET /api/msp/audit reads).
  const { loadEnvLocal } = await import("../src/env.ts");
  loadEnvLocal();
  const { default: pg } = await import("pg");
  const dbc = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await dbc.connect();
  const { rows: auditRows } = await dbc.query(
    `SELECT action_type, outcome FROM msp_audit_logs
      WHERE action_type IN ('mcp.tool.platform_health', 'mcp.tool.whoami')
        AND occurred_at > now() - interval '2 minutes'
      ORDER BY occurred_at DESC LIMIT 10`,
  );
  await dbc.end();
  check(
    "audit rows landed for both calls (Git #1325)",
    auditRows.some((r) => r.action_type === "mcp.tool.platform_health" && r.outcome === "success") &&
      auditRows.some((r) => r.action_type === "mcp.tool.whoami" && r.outcome === "success"),
    auditRows.map((r) => `${r.action_type}:${r.outcome}`).join(", ") || "no rows",
  );
} catch (err) {
  check("e2e run", false, err instanceof Error ? err.message : String(err));
} finally {
  child.kill();
}

process.exit(failures.length ? 1 : 0);
