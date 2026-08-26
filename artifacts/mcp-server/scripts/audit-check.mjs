#!/usr/bin/env node
// Real verification for mandatory MCP audit logging (Git #1325): exercises
// the REAL registry wrapper + REAL audit module against the REAL local
// Postgres. Nothing in the audit chain is mocked — only the MCP transport
// (a stub registerTool capture) and the synthetic tools themselves.
//
//   node artifacts/mcp-server/scripts/audit-check.mjs
//
// Checks:
//  1. write tool success   → write-ahead row finalized outcome=success with
//                            tenant, verbatim params and the real result
//  2. write tool failure   → same row finalized outcome=failure + real error
//  3. read tool (no decl)  → best-effort row outcome=success
//  4. undeclared tool attempting a mutating apiFetch → BLOCKED before any
//                            HTTP happens, and the block itself is audited
//  5. fail-closed          → with an unreachable DATABASE_URL a write tool
//                            is REFUSED and its handler NEVER runs
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadEnvLocal } from "../src/env.ts";
import { registerTools } from "../src/tools/registry.ts";
import { apiFetch } from "../src/api-client.ts";
import pg from "pg";

loadEnvLocal();
const pkgDir = dirname(dirname(fileURLToPath(import.meta.url)));

const failures = [];
function check(label, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

// The registry is the real enforcement point — register synthetic tools
// through it exactly the way index.ts registers the real ones.
const handlers = new Map();
const stubServer = { registerTool: (name, _meta, cb) => handlers.set(name, cb) };
registerTools(stubServer, [
  {
    name: "audit_check_write_ok",
    description: "synthetic write tool that succeeds",
    audit: { access: "write", entityType: "audit_check" },
    handler: async (args) => ({ did: "synthetic-write", got: args }),
  },
  {
    name: "audit_check_write_fail",
    description: "synthetic write tool that throws",
    audit: { access: "write" },
    handler: async () => {
      throw new Error("synthetic write failure");
    },
  },
  {
    name: "audit_check_read",
    description: "synthetic read tool (no audit declaration at all)",
    handler: async () => ({ ok: true }),
  },
  {
    name: "audit_check_undeclared_mutation",
    description: "read-declared tool that tries a POST — must be blocked",
    handler: async () => apiFetch("/nonexistent", { method: "POST", body: {} }),
  },
]);

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
// Clear prior runs' synthetic rows so every assertion below is about THIS
// run; the rows this run writes are left in place for inspection.
await client.query(`DELETE FROM msp_audit_logs WHERE action_type LIKE 'mcp.tool.audit_check_%'`);
const rowFor = async (name) =>
  (
    await client.query(
      `SELECT outcome, customer_id, entity_type, correlation_id, user_agent, metadata
         FROM msp_audit_logs WHERE action_type = $1
        ORDER BY occurred_at DESC LIMIT 1`,
      [`mcp.tool.${name}`],
    )
  ).rows[0];

try {
  // 1 — write tool success
  const r1 = await handlers.get("audit_check_write_ok")({ customerId: 424242, note: "hello" });
  const row1 = await rowFor("audit_check_write_ok");
  check("write tool returned ok", !r1.isError, r1.content?.[0]?.text?.slice(0, 80));
  check(
    "write-ok row finalized success (phase completed)",
    row1?.outcome === "success" && row1?.metadata?.phase === "completed",
    `outcome=${row1?.outcome} phase=${row1?.metadata?.phase}`,
  );
  check(
    "write-ok row carries tenant + verbatim params + entityType",
    row1?.customer_id === 424242 &&
      row1?.metadata?.params?.note === "hello" &&
      row1?.entity_type === "audit_check",
    `customer_id=${row1?.customer_id}`,
  );
  check(
    "write-ok row carries the real result",
    row1?.metadata?.result?.did === "synthetic-write",
    JSON.stringify(row1?.metadata?.result)?.slice(0, 80),
  );

  // 2 — write tool failure
  const r2 = await handlers.get("audit_check_write_fail")({});
  const row2 = await rowFor("audit_check_write_fail");
  check("write-fail surfaced as isError", r2.isError === true, r2.content?.[0]?.text);
  check(
    "write-fail row finalized failure with the real error",
    row2?.outcome === "failure" && String(row2?.metadata?.error).includes("synthetic write failure"),
    `outcome=${row2?.outcome} error=${row2?.metadata?.error}`,
  );

  // 3 — read tool with no declaration still lands in the trail
  const r3 = await handlers.get("audit_check_read")({});
  const row3 = await rowFor("audit_check_read");
  check(
    "undeclared read tool audited success",
    !r3.isError && row3?.outcome === "success" && row3?.metadata?.access === "read",
    `outcome=${row3?.outcome}`,
  );

  // 4 — mutating apiFetch from a non-write tool is structurally blocked
  const r4 = await handlers.get("audit_check_undeclared_mutation")({});
  const row4 = await rowFor("audit_check_undeclared_mutation");
  check(
    "undeclared mutation BLOCKED",
    r4.isError === true && (r4.content?.[0]?.text ?? "").includes("BLOCKED"),
    r4.content?.[0]?.text?.slice(0, 120),
  );
  check(
    "block itself audited as failure",
    row4?.outcome === "failure",
    `outcome=${row4?.outcome}`,
  );

  // 5 — fail-closed: unreachable DB refuses the write tool, handler never runs
  const registryUrl = pathToFileURL(join(pkgDir, "src", "tools", "registry.ts")).href;
  const sub = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const { registerTools } = await import(${JSON.stringify(registryUrl)});
       const handlers = new Map();
       registerTools({ registerTool: (n, _m, cb) => handlers.set(n, cb) }, [{
         name: "audit_check_failclosed",
         description: "must be refused when the audit trail is unreachable",
         audit: { access: "write" },
         handler: async () => { console.log("HANDLER_RAN"); return {}; },
       }]);
       const res = await handlers.get("audit_check_failclosed")({});
       console.log("RESULT:" + JSON.stringify(res));`,
    ],
    {
      env: { ...process.env, DATABASE_URL: "postgresql://postgres:x@127.0.0.1:59999/nope" },
      encoding: "utf8",
      cwd: pkgDir,
      timeout: 60_000,
    },
  );
  const out = sub.stdout ?? "";
  check(
    "fail-closed: write tool refused when audit trail unreachable",
    out.includes("AUDIT REFUSAL") && out.includes('"isError":true'),
    out.split("RESULT:")[1]?.slice(0, 140) ?? `status=${sub.status} stderr=${(sub.stderr ?? "").slice(-200)}`,
  );
  check("fail-closed: handler never ran", !out.includes("HANDLER_RAN"));
} catch (err) {
  check("audit-check run", false, err instanceof Error ? (err.stack ?? err.message) : String(err));
} finally {
  await client.end();
}

process.exit(failures.length ? 1 : 0);
