import type { ZodRawShape } from "zod";
import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApiError } from "../api-client.ts";
import { logger } from "../logger.ts";

/**
 * The one shape every tool in this server is written as. A tool is a plain
 * object: name, description, optional zod arg shape, and an async handler
 * that returns raw JSON-serializable data (the registry stringifies it into
 * the MCP text content — handlers never build MCP envelopes themselves).
 *
 * The SDK validates arguments against `inputSchema` BEFORE the handler runs,
 * so a handler may trust the shape it declared; type the parameter by
 * z.infer on your own schema object inside the tool file.
 *
 * Error contract: throw. An ApiError from apiFetch (any non-2xx route
 * answer) or any other Error is caught here and returned as an MCP
 * `isError` text result carrying the real message — the api-server's own
 * status + error body for ApiError. Handlers never swallow failures into
 * fake-successful results.
 */
export interface ToolDef {
  name: string;
  description: string;
  /** zod raw shape for the tool's arguments; omit for no-argument tools. */
  inputSchema?: ZodRawShape;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

export function registerTools(server: McpServer, tools: ToolDef[]): void {
  for (const tool of tools) {
    const wrapped = async (args: Record<string, unknown>) => {
      const startedAt = Date.now();
      try {
        const result = await tool.handler(args ?? {});
        logger.info({ tool: tool.name, ms: Date.now() - startedAt }, "tool call ok");
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(
          {
            tool: tool.name,
            ms: Date.now() - startedAt,
            err: message,
            ...(err instanceof ApiError ? { status: err.status, path: err.path } : {}),
          },
          "tool call failed",
        );
        return {
          isError: true,
          content: [{ type: "text" as const, text: message }],
        };
      }
    };

    // One deliberate cast: ToolDef is heterogeneous (each tool has its own
    // arg shape), so the per-shape callback generic can't be expressed on a
    // plain list. The SDK still validates args against each tool's own
    // inputSchema before calling.
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema ?? {} },
      wrapped as unknown as ToolCallback<ZodRawShape>,
    );
  }
}
