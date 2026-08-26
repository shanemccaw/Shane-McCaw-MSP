import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadEnvLocal } from "./env.ts";
import { logger } from "./logger.ts";
import { resolveOperatorIdentity } from "./auth.ts";
import { registerTools } from "./tools/registry.ts";
import { ALL_TOOLS } from "./tools/index.ts";

async function main(): Promise<void> {
  loadEnvLocal();

  // Fail fast, before serving a single tool: if the operator identity can't
  // be resolved (DB down, wrong email, non-admin row) the server must not
  // come up half-working.
  const op = await resolveOperatorIdentity();

  const server = new McpServer({ name: "shane-msp-platform", version: "0.1.0" });
  registerTools(server, ALL_TOOLS);

  await server.connect(new StdioServerTransport());
  logger.info(
    { operator: op.email, tools: ALL_TOOLS.map((t) => t.name) },
    "MCP server ready (stdio)",
  );
}

main().catch((err: unknown) => {
  // pino serializes a bare Error to {} — log the message explicitly.
  logger.fatal(
    { err: err instanceof Error ? (err.stack ?? err.message) : String(err) },
    "MCP server failed to start",
  );
  process.exit(1);
});
