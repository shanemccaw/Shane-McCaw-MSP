#!/usr/bin/env node
// Manual verification harness for execute_write_pack (Phase 5 — Git #1324).
//
// Spawns the REAL MCP server, does the real stdio handshake, and calls the
// real execute_write_pack tool — so the whole chain (registry → #1325
// write-ahead audit → apiFetch → admin-config-pack-run route →
// config-pack-orchestrator → Workflow Engine) is exercised exactly as a
// Claude session would.
//
//   node scripts/execute-write-pack-check.mjs --pack quickstart-v1 --customer 1
//       → planOnly preview (no execution, still write-audited)
//   node scripts/execute-write-pack-check.mjs --pack quickstart-v1 --customer 1 --fire [--var k=v ...]
//       → REALLY executes the pack: REAL Graph writes against the
//         customer's REAL connected tenant. Deliberately not part of any
//         automated suite — run by hand, eyes open.
//
// After a --fire it polls wf_runs/wf_run_steps for the run's real progress
// and prints the msp_audit_logs rows the call landed (Git #1325).
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1] ?? "") : undefined;
};
const pack = flag("pack");
const customer = Number(flag("customer"));
const fire = argv.includes("--fire");
const variables = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--var") {
    const [k, ...rest] = String(argv[i + 1] ?? "").split("=");
    if (k && rest.length) variables[k] = rest.join("=");
  }
}
if (!pack || !Number.isInteger(customer) || customer <= 0) {
  console.error("usage: node scripts/execute-write-pack-check.mjs --pack <packKey> --customer <tenants.id> [--fire] [--var k=v ...]");
  process.exit(2);
}

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
      continue;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

function request(method, params, timeoutMs = 60_000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), timeoutMs);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      if (msg.error) reject(new Error(`${method}: ${JSON.stringify(msg.error)}`));
      else resolve(msg.result);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

const failures = [];
function check(label, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const init = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "execute-write-pack-check", version: "0.0.0" },
  });
  check("initialize handshake", Boolean(init?.serverInfo?.name), `server=${init?.serverInfo?.name}`);
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");

  const tools = await request("tools/list", {});
  const names = (tools?.tools ?? []).map((t) => t.name);
  check("tools/list contains execute_write_pack", names.includes("execute_write_pack"), names.join(", "));

  // 1) planOnly — always. Real registry + write-ahead audit + real plan route.
  const planRes = await request("tools/call", {
    name: "execute_write_pack",
    arguments: { packKey: pack, customerId: customer, planOnly: true },
  });
  const planText = planRes?.content?.[0]?.text ?? "";
  let plan = null;
  try {
    plan = JSON.parse(planText);
  } catch {
    /* fail below */
  }
  check(
    "planOnly returns real materialized plan (nothing executed)",
    !planRes?.isError && plan?.executed === false && Array.isArray(plan?.plan?.ordered),
    planRes?.isError
      ? planText.slice(0, 300)
      : `steps=${plan?.plan?.ordered?.length} gateAfter=${plan?.plan?.gatedTemplateId} operatorVariables=[${(plan?.plan?.operatorVariables ?? []).join(", ")}]`,
  );

  if (fire) {
    // 2) the REAL execution.
    const runRes = await request("tools/call", {
      name: "execute_write_pack",
      arguments: {
        packKey: pack,
        customerId: customer,
        ...(Object.keys(variables).length ? { variables } : {}),
      },
    });
    const runText = runRes?.content?.[0]?.text ?? "";
    let run = null;
    try {
      run = JSON.parse(runText);
    } catch {
      /* fail below */
    }
    check(
      "execute_write_pack fired a real run",
      !runRes?.isError && run?.executed === true && Number.isInteger(run?.runId),
      runRes?.isError ? runText.slice(0, 400) : `runId=${run?.runId} gated=${run?.gated} order=${(run?.templateOrder ?? []).join(" → ")}`,
    );

    if (run?.runId) {
      // 3) watch the engine actually execute — poll the run + steps.
      const { loadEnvLocal } = await import("../src/env.ts");
      loadEnvLocal();
      const { default: pg } = await import("pg");
      const dbc = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await dbc.connect();
      let last = null;
      for (let i = 0; i < 30; i++) {
        await sleep(2000);
        const { rows } = await dbc.query(
          `SELECT r.status, r.error_message,
                  (SELECT json_agg(json_build_object('node', o.node_id, 'status', o.status, 'error', o.error_message) ORDER BY o.id)
                     FROM wf_run_node_outputs o WHERE o.run_id = r.id) AS steps
             FROM wf_runs r WHERE r.id = $1`,
          [run.runId],
        );
        last = rows[0] ?? null;
        const stepsSummary = (last?.steps ?? []).map((s) => `${s.node}:${s.status}`).join(", ");
        console.log(`  run ${run.runId} status=${last?.status} steps=[${stepsSummary}]`);
        // Terminal states, or a real step has executed against the tenant.
        if (last && !["running", "pending"].includes(last.status)) break;
        if ((last?.steps ?? []).some((s) => ["waiting", "awaiting_verification", "failed", "success"].includes(s.status))) break;
      }
      const steps = last?.steps ?? [];
      check(
        "run reached a real step execution against the tenant",
        Boolean(last) && Array.isArray(steps) && steps.length > 0,
        `final run status=${last?.status}` +
          (steps.length ? ` — first step ${steps[0].node}:${steps[0].status}${steps[0].error ? ` (${String(steps[0].error).slice(0, 160)})` : ""}` : ""),
      );

      const { rows: audit } = await dbc.query(
        `SELECT outcome, metadata->>'phase' AS phase, customer_id, entity_id
           FROM msp_audit_logs
          WHERE action_type = 'mcp.tool.execute_write_pack'
            AND occurred_at > now() - interval '10 minutes'
          ORDER BY occurred_at DESC LIMIT 5`,
      );
      check(
        "call write-audited into msp_audit_logs (Git #1325)",
        audit.some((r) => r.entity_id === pack && Number(r.customer_id) === customer),
        audit.map((r) => `${r.outcome}/${r.phase} cust=${r.customer_id} entity=${r.entity_id}`).join("; ") || "no rows",
      );
      await dbc.end();
    }
  } else {
    console.log("(planOnly run — pass --fire to REALLY execute the pack. Real Graph writes.)");
  }
} catch (err) {
  check("harness run", false, err instanceof Error ? err.message : String(err));
} finally {
  child.kill();
}

process.exit(failures.length ? 1 : 0);
