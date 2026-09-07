// HTTP entry point for the MCP server.
//
// Two ways in, both real, both authenticating against the same mcp_tokens table:
//
//   POST /mcp            with `Authorization: Bearer slmcp_...`
//                        The correct form. Claude Code / Claude Desktop can set a header.
//
//   POST /mcp/t/<token>  the token in the path.
//                        A capability URL, same class of secret as a share link, for clients
//                        that only let you paste a URL. It exists because some MCP clients have
//                        no header field at all; the token is still revocable and still audited.
//
// Both are HTTPS-only in production (Replit terminates TLS), and neither creates a session.

import { config } from "../config.mjs";
import { handleRpc } from "../mcp/protocol.mjs";
import { resolveMcpToken } from "../core/mcp-tokens.mjs";
import { readBody, sendJson } from "../http.mjs";

const MAX_RPC_BYTES = 2_000_000;

function bearerFrom(req) {
  const header = req.headers.authorization || req.headers.Authorization;
  if (typeof header === "string" && /^bearer\s+/i.test(header)) {
    return header.replace(/^bearer\s+/i, "").trim();
  }
  // Some clients send the token as a plain custom header instead.
  const alt = req.headers["x-mcp-token"];
  return typeof alt === "string" && alt ? alt.trim() : null;
}

export async function handleMcpRequest(req, res, { pathToken = null, log = console.error } = {}) {
  const token = pathToken || bearerFrom(req);
  if (!token) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="shanes-life"');
    return sendJson(res, 401, {
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32001,
        message:
          "Missing MCP token. Send `Authorization: Bearer slmcp_...`, or use the /mcp/t/<token> URL form. " +
          "Mint one in the app under Settings, or with `npm run issue-mcp-token`.",
      },
    });
  }

  const auth = await resolveMcpToken(token);
  if (!auth) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="shanes-life", error="invalid_token"');
    return sendJson(res, 401, {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32001, message: "That MCP token is not valid, or it has been revoked." },
    });
  }

  const body = await readBody(req, MAX_RPC_BYTES);
  const { status, body: payload } = await handleRpc(body, {
    user: auth.user,
    label: auth.label,
    tokenId: auth.tokenId,
    log,
  });

  // The Streamable HTTP transport wants a session id echoed on later requests. This server is
  // genuinely stateless between calls -- every request re-authenticates from the token -- so the
  // token id is a stable, honest value to hand back rather than inventing session bookkeeping
  // that does nothing.
  res.setHeader("Mcp-Session-Id", auth.tokenId);

  if (payload === null) {
    res.writeHead(status);
    return res.end();
  }
  return sendJson(res, status, payload);
}

/** GET /mcp -- clients probe this to see whether the endpoint is alive before POSTing. */
export function describeMcpEndpoint(res) {
  return sendJson(res, 200, {
    server: "shanes-life",
    transport: "streamable-http",
    endpoint: `${config.publicOrigin}/mcp`,
    auth: "Authorization: Bearer slmcp_... (or POST to /mcp/t/<token>)",
    note: "POST JSON-RPC 2.0 here. GET is informational only; this server does not open an SSE stream.",
  });
}
