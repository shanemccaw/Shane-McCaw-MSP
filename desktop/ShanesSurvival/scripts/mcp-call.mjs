#!/usr/bin/env node
// Call ShanesSurvival's own MCP tools headlessly, and print what they really return.
//
//   dotnet build ShanesSurvival.sln -c Release
//   node scripts/mcp-call.mjs src/ShanesSurvival.Mcp/bin/Release/net8.0/ShanesSurvival.Mcp.exe gate_status bill_status
//
// Why this exists: since Git #3107 this app's Postgres database is SHARED with the Shane's Life
// web app (web/shanes-life, migrations 013+). Any change to that database has to be provable
// against the real numbers this app computes, and the WPF window is not something a build session
// can read numbers out of. The MCP server is the same DashboardService over stdio, reading the
// same %AppData%\ShanesSurvival\settings.json connection string, so this is the real readout.
//
// The way to use it is before-and-after:
//
//   node scripts/mcp-call.mjs <exe> gate_status bill_status > before.txt
//   ...apply the migration...
//   node scripts/mcp-call.mjs <exe> gate_status bill_status > after.txt
//   diff before.txt after.txt      # must be empty
//
// Read-only: it only issues tools/call, and the finance tools it is meant for are reads.

import { spawn } from "node:child_process";

const [exe, ...tools] = process.argv.slice(2);
if (!exe || tools.length === 0) {
  console.error("Usage: node scripts/mcp-call.mjs <path-to-ShanesSurvival.Mcp.exe> <tool> [tool...]");
  process.exit(2);
}

const TIMEOUT_MS = 45_000;
const child = spawn(exe, [], { stdio: ["pipe", "pipe", "pipe"] });
const pending = new Map();
let buffer = "";
let nextId = 0;

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let newline;
  while ((newline = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue; // the server logs to stderr, but be tolerant of anything non-JSON on stdout
    }
    const resolve = pending.get(message.id);
    if (resolve) {
      pending.delete(message.id);
      resolve(message);
    }
  }
});
// The MCP host logs to stderr by design (stdout is the JSON-RPC channel); surface it only on failure.
let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

function rpc(method, params) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`timed out waiting for ${method}`));
    }, TIMEOUT_MS).unref();
  });
}

try {
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "mcp-call", version: "1" },
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

  for (const tool of tools) {
    const reply = await rpc("tools/call", { name: tool, arguments: {} });
    console.log(`===== ${tool} =====`);
    const text = reply.result?.content?.map((c) => c.text).join("\n");
    console.log(text ?? JSON.stringify(reply));
  }
} catch (err) {
  console.error(`ERROR: ${err.message}`);
  if (stderr.trim()) console.error(stderr.trim());
  process.exitCode = 1;
} finally {
  child.kill();
}
