// Shane's Life -- HTTP entry point.
//
// Boots in this order, deliberately: connect, migrate, then listen. A Replit redeploy therefore
// cannot serve one request against a schema that has not caught up with the code.

import { createServer } from "node:http";
import { resolve } from "node:path";
import { config } from "./config.mjs";
import { closePool, query } from "./db.mjs";
import { runMigrations } from "./migrate.mjs";
import { HttpError, clientIp, parseCookies, sendJson, sendText, serveStatic, setCookie } from "./http.mjs";
import { SESSION_COOKIE, purgeDeadSessions, resolveSession } from "./auth/sessions.mjs";
import * as ratelimit from "./auth/ratelimit.mjs";
import { buildApiRouter } from "./routes/api.mjs";
import { buildPublicRouter } from "./routes/public.mjs";
import { describeMcpEndpoint, handleMcpRequest } from "./routes/mcp.mjs";

const PUBLIC_DIR = resolve(config.root, "public");
const apiRouter = buildApiRouter();
const publicRouter = buildPublicRouter();

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

/**
 * Same-origin check on every state-changing request.
 *
 * The session cookie is SameSite=Lax, which already blocks cross-site POSTs from a form, and the
 * API only accepts application/json, which a simple cross-origin form cannot send. This is the
 * third layer: an Origin header that is present and foreign is refused outright. The public
 * share endpoints are exempt -- they authenticate by URL token, hold no ambient credential, and
 * so have nothing for a CSRF to ride on.
 */
function checkOrigin(req, url) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser client (curl, MCP, the stdio bridge)
  const allowed = new Set([config.publicOrigin, `http://localhost:${config.port}`, `http://127.0.0.1:${config.port}`]);
  if (allowed.has(origin)) return true;
  // Replit serves the app on its own hostname; trust the host the request actually arrived on.
  const host = req.headers.host;
  return host ? origin === `https://${host}` || origin === `http://${host}` : false;
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;
  const method = req.method || "GET";

  // ---- MCP: authenticated by its own bearer token, never by the session cookie -------------
  if (pathname === "/mcp" || pathname.startsWith("/mcp/t/")) {
    if (method === "GET") return describeMcpEndpoint(res);
    if (method === "DELETE") {
      // Streamable HTTP session teardown. Nothing to tear down; answer honestly.
      res.writeHead(204);
      return res.end();
    }
    if (method !== "POST") {
      res.writeHead(405, { allow: "GET, POST, DELETE" });
      return res.end();
    }
    const pathToken = pathname.startsWith("/mcp/t/")
      ? decodeURIComponent(pathname.slice("/mcp/t/".length))
      : null;
    return handleMcpRequest(req, res, { pathToken, log: (m) => log(m) });
  }

  // ---- health --------------------------------------------------------------------------
  if (pathname === "/healthz") {
    try {
      await query("SELECT 1");
      return sendJson(res, 200, { ok: true, service: "shanes-life", db: "up" });
    } catch (err) {
      return sendJson(res, 503, { ok: false, service: "shanes-life", db: "down", error: err.message });
    }
  }

  // ---- public share routes: no cookie, no session ---------------------------------------
  const publicMatch = publicRouter.match(method, pathname);
  if (publicMatch) {
    return publicMatch.handler(req, res, publicMatch.params, { url, ip: clientIp(req) });
  }

  // ---- everything else may carry a session -----------------------------------------------
  const cookies = parseCookies(req);
  const sessionToken = cookies[SESSION_COOKIE] || null;
  const session = await resolveSession(sessionToken);

  const ctx = {
    url,
    session,
    sessionToken,
    ip: clientIp(req) || "unknown",
    userAgent: req.headers["user-agent"] || null,
    setSessionCookie(token, maxAge) {
      setCookie(res, SESSION_COOKIE, token, { maxAge, secure: config.isProduction });
    },
    clearSessionCookie() {
      setCookie(res, SESSION_COOKIE, "", { maxAge: 0, secure: config.isProduction });
    },
  };

  const apiMatch = apiRouter.match(method, pathname);
  if (apiMatch) {
    if (method !== "GET" && !checkOrigin(req, url)) {
      throw new HttpError(403, "Cross-origin request refused.");
    }
    return apiMatch.handler(req, res, apiMatch.params, ctx);
  }

  if (pathname.startsWith("/api/")) {
    return sendJson(res, 404, { error: `No such endpoint: ${method} ${pathname}` });
  }

  // ---- static + app shells ----------------------------------------------------------------
  if (method !== "GET" && method !== "HEAD") {
    res.writeHead(405, { allow: "GET, HEAD" });
    return res.end();
  }

  // A share URL renders its own standalone shell -- no login, no app chrome, nothing that
  // would prompt someone holding a grocery list to sign in.
  if (pathname === "/s" || pathname.startsWith("/s/")) {
    if (serveStatic(PUBLIC_DIR, "/share.html", res)) return;
  }

  if (pathname !== "/" && serveStatic(PUBLIC_DIR, pathname, res)) return;

  // Client-side routing: any unknown path falls back to the app shell.
  if (serveStatic(PUBLIC_DIR, "/index.html", res)) return;

  return sendText(res, 404, "Not found");
}

const server = createServer((req, res) => {
  const started = Date.now();
  res.on("finish", () => {
    // One line per request. No bodies, no cookies, no tokens.
    if (!req.url.startsWith("/api/media/")) {
      log(`${req.method} ${req.url.split("?")[0]} -> ${res.statusCode} ${Date.now() - started}ms`);
    }
  });

  handle(req, res).catch((err) => {
    if (res.headersSent) {
      log("[error after headers]", err.message);
      return res.end();
    }
    if (err instanceof HttpError) {
      return sendJson(res, err.status, { error: err.message, ...(err.detail ? { detail: err.detail } : {}) });
    }
    log("[500]", err.stack || err.message);
    return sendJson(res, 500, {
      error: config.isProduction ? "Something went wrong." : err.message,
    });
  });
});

async function main() {
  log(`[boot] shanes-life starting (${config.nodeEnv})`);
  await query("SELECT 1");
  log("[boot] database reachable");
  await runMigrations({ log });

  server.listen(config.port, config.host, () => {
    log(`[boot] listening on http://${config.host}:${config.port}`);
    log(`[boot] public origin ${config.publicOrigin}`);
    log(`[boot] MCP endpoint  ${config.publicOrigin}/mcp`);
  });

  // Slow housekeeping. Cheap, and it keeps the tables from growing forever on a long-lived
  // deployment nobody restarts.
  const housekeeping = setInterval(
    async () => {
      try {
        ratelimit.sweep();
        const purged = await purgeDeadSessions();
        if (purged > 0) log(`[housekeeping] purged ${purged} dead sessions`);
      } catch (err) {
        log("[housekeeping] failed:", err.message);
      }
    },
    6 * 60 * 60 * 1000,
  );
  housekeeping.unref();
}

async function shutdown(signal) {
  log(`[shutdown] ${signal}`);
  server.close();
  await closePool().catch(() => {});
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

main().catch((err) => {
  console.error("[boot] failed:", err.message);
  process.exit(1);
});
