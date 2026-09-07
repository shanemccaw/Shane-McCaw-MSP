#!/usr/bin/env node
// stdio <-> Streamable HTTP bridge.
//
// Claude Code and Claude Desktop can both speak Streamable HTTP directly, so this is not the
// primary path. It exists for two real cases: a client that only supports stdio, and debugging
// the deployed server from a terminal without a browser in the way.
//
//   SL_MCP_URL=https://<host>/mcp SL_MCP_TOKEN=slmcp_... node bin/mcp-stdio.mjs
//
// stdout carries protocol only. Every diagnostic goes to stderr -- one stray console.log on
// stdout corrupts the stream, which is the classic way a working MCP server appears broken.

const url = process.env.SL_MCP_URL || "http://localhost:5000/mcp";
const token = process.env.SL_MCP_TOKEN;

if (!token) {
  console.error("SL_MCP_TOKEN is not set. Mint one with: npm run issue-mcp-token -- --email ... --label ...");
  process.exit(1);
}

async function forward(message) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(message),
  });

  if (res.status === 202) return null; // notification accepted, nothing to relay back
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    console.error(`[bridge] non-JSON reply (${res.status}): ${text.slice(0, 200)}`);
    return {
      jsonrpc: "2.0",
      id: message?.id ?? null,
      error: { code: -32603, message: `Upstream returned ${res.status}` },
    };
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", async (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;

    let message;
    try {
      message = JSON.parse(line);
    } catch (err) {
      console.error(`[bridge] unparseable line from client: ${err.message}`);
      continue;
    }

    try {
      const reply = await forward(message);
      if (reply) process.stdout.write(JSON.stringify(reply) + "\n");
    } catch (err) {
      console.error(`[bridge] ${err.message}`);
      if (message?.id !== undefined && message.id !== null) {
        process.stdout.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32603, message: `Bridge could not reach ${url}: ${err.message}` },
          }) + "\n",
        );
      }
    }
  }
});

process.stdin.on("end", () => process.exit(0));
console.error(`[bridge] relaying stdio to ${url}`);
