// A real MCP server: JSON-RPC 2.0 over the Streamable HTTP transport.
//
// Written directly against the spec rather than pulled in from @modelcontextprotocol/sdk,
// because this app keeps a single runtime dependency (see README) and the server half of the
// protocol is genuinely small: initialize, tools/list, tools/call, ping, and the empty
// resources/prompts probes clients send on connect. Responses are plain application/json --
// the spec permits that for a request that produces exactly one response, and none of these
// tools stream.

import { TOOLS_BY_NAME, toolManifest } from "./tools.mjs";
import { runWithToolName } from "./tool-context.mjs";

export const SERVER_INFO = { name: "shanes-life", title: "Shane's Life", version: "0.1.0" };

// Versions this server actually implements. If a client asks for something else it still gets a
// working session -- it just gets told which version it is really talking to.
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

const ok = (id, result) => ({ jsonrpc: "2.0", id, result });
const fail = (id, code, message, data) => ({
  jsonrpc: "2.0",
  id,
  error: data === undefined ? { code, message } : { code, message, data },
});

/**
 * Handle one JSON-RPC message.
 * @returns the response object, or null for a notification (which gets an empty 202).
 */
async function handleMessage(msg, ctx) {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
    return fail(null, INVALID_REQUEST, "Request must be a JSON-RPC object");
  }
  const { id = null, method, params = {} } = msg;
  const isNotification = msg.id === undefined || msg.id === null;

  if (typeof method !== "string") {
    return isNotification ? null : fail(id, INVALID_REQUEST, "Missing method");
  }

  switch (method) {
    case "initialize": {
      const asked = params?.protocolVersion;
      const version = SUPPORTED_PROTOCOL_VERSIONS.includes(asked) ? asked : DEFAULT_PROTOCOL_VERSION;
      return ok(id, {
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          "Shane's Life stores what you have already worked out with Shane; it never does its own " +
          "inference. Categories are open: invent a sensible new slug (with categoryLabel and " +
          "categoryIcon) whenever nothing existing fits, rather than forcing a bad match. Call " +
          "list_categories and list_entities before creating something, so a second copy of an " +
          "open list does not appear beside the first.",
      });
    }

    // Notifications carry no id and get no JSON-RPC response at all.
    case "notifications/initialized":
    case "notifications/cancelled":
    case "notifications/progress":
      return null;

    case "ping":
      return ok(id, {});

    case "tools/list":
      return ok(id, { tools: toolManifest() });

    case "resources/list":
      return ok(id, { resources: [] });

    case "resources/templates/list":
      return ok(id, { resourceTemplates: [] });

    case "prompts/list":
      return ok(id, { prompts: [] });

    case "tools/call": {
      const name = params?.name;
      const tool = TOOLS_BY_NAME.get(name);
      if (!tool) return fail(id, INVALID_PARAMS, `Unknown tool: ${name}`);
      const args = params?.arguments && typeof params.arguments === "object" ? params.arguments : {};
      try {
        const result = await runWithToolName(name, () => tool.handler(args, ctx));
        const text = JSON.stringify(result, null, 2);
        return ok(id, {
          content: [{ type: "text", text }],
          structuredContent: result && typeof result === "object" && !Array.isArray(result) ? result : { result },
          isError: false,
        });
      } catch (err) {
        // A tool that fails reports a real, readable failure to the model as a tool result --
        // not a protocol-level error, and never a fabricated success.
        ctx.log?.(`[mcp] tool ${name} failed: ${err.message}`);
        return ok(id, {
          content: [{ type: "text", text: `${name} failed: ${err.message}` }],
          isError: true,
        });
      }
    }

    default:
      return isNotification ? null : fail(id, METHOD_NOT_FOUND, `Unknown method: ${method}`);
  }
}

/**
 * Handle a raw request body (single message or a batch).
 * @returns {Promise<{status:number, body:object|array|null}>}
 */
export async function handleRpc(rawBody, ctx) {
  let parsed;
  try {
    parsed = JSON.parse(rawBody.toString("utf8"));
  } catch (err) {
    return { status: 400, body: fail(null, PARSE_ERROR, `Invalid JSON: ${err.message}`) };
  }

  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      return { status: 400, body: fail(null, INVALID_REQUEST, "Empty batch") };
    }
    const responses = [];
    for (const msg of parsed) {
      try {
        const res = await handleMessage(msg, ctx);
        if (res) responses.push(res);
      } catch (err) {
        responses.push(fail(msg?.id ?? null, INTERNAL_ERROR, err.message));
      }
    }
    // An all-notification batch produces no responses at all.
    return responses.length === 0 ? { status: 202, body: null } : { status: 200, body: responses };
  }

  try {
    const res = await handleMessage(parsed, ctx);
    return res === null ? { status: 202, body: null } : { status: 200, body: res };
  } catch (err) {
    ctx.log?.(`[mcp] internal error: ${err.stack || err.message}`);
    return { status: 200, body: fail(parsed?.id ?? null, INTERNAL_ERROR, err.message) };
  }
}
