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
import { purgeDeadChallenges } from "./auth/webauthn.mjs";
import * as ratelimit from "./auth/ratelimit.mjs";
import { buildApiRouter } from "./routes/api.mjs";
import { buildPublicRouter } from "./routes/public.mjs";
import { describeMcpEndpoint, handleMcpRequest } from "./routes/mcp.mjs";
import { runDetectors as runCatchDetectors } from "./core/catches.mjs";
import { findDueDayBeforeReminders } from "./core/dates.mjs";
import { needsMonthlyRefresh, refreshFederalHolidays } from "./core/federal-holidays.mjs";
import { findDueVaccineReminders } from "./core/pets.mjs";
import { queueNudge } from "./core/nudges.mjs";
import { listUsers } from "./core/users.mjs";
import { detectMoneyWins } from "./core/wins.mjs";

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

  // OAuth discovery probes (RFC 8414 / RFC 9728). `mcp-remote` -- the bridge Claude
  // Desktop uses to reach this server -- probes several `/.well-known/...` variants
  // (`/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource`,
  // and path-relative forms like `/mcp/.well-known/openid-configuration`) before ever
  // sending the bearer token, even though this server only does bearer-token auth and
  // implements none of them. Left to the SPA catch-all below, every one of those probes
  // got the app shell's `index.html` back -- `mcp-remote` either blew up trying to parse
  // it as JSON, or (confirmed live, 2026-09-07) silently treated the 200 HTML response as
  // real OpenID metadata. A real 404 on any path containing a `.well-known` segment is
  // enough: mcp-remote's own discovery code treats a 404 on these paths as "not
  // implemented" and moves on (see mcp-remote's `discoverOAuthProtectedResourceMetadata`,
  // which explicitly special-cases `response.status === 404`, and
  // `discoverAuthorizationServerMetadata`'s loop, which `continue`s past any 4xx), then
  // proceeds straight to sending the bearer token it already has. There is no reason to
  // implement any of these well-known responses for real -- bearer-token-only auth
  // already degrades cleanly once the probe fails honestly.
  if (pathname === "/.well-known" || pathname.includes("/.well-known/")) {
    return sendJson(res, 404, { error: "Not found" });
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
        const challenges = await purgeDeadChallenges();
        if (challenges > 0) log(`[housekeeping] purged ${challenges} spent WebAuthn challenges`);
      } catch (err) {
        log("[housekeeping] failed:", err.message);
      }
      await runDayBeforeReminders();
      await runVaccineLeadReminders();
      await runMonthlyFederalHolidaysRefresh();
      await runMoneyWinDetection();
      await runCatchesSweep();
    },
    6 * 60 * 60 * 1000,
  );
  housekeeping.unref();

  // Run once at boot too -- a 6-hour interval alone would leave a genuinely due day-before
  // reminder or a stale federal-holiday list waiting up to 6 hours after every redeploy.
  await runDayBeforeReminders();
  await runVaccineLeadReminders();
  await runMonthlyFederalHolidaysRefresh();
  await runMoneyWinDetection();
  await runCatchesSweep();
}

/**
 * Dates' one real clock exception (contract pack, "context over clock ... the only clock-
 * anchored reminders are day-before appointment reminders"). Queues a real nudge_events row per
 * due appointment/vet date, through the same 1-3/day cap everything else respects.
 */
async function runDayBeforeReminders() {
  try {
    for (const user of await listUsers()) {
      const due = await findDueDayBeforeReminders(user.id);
      for (const appt of due) {
        const time = appt.at_time ? ` ${appt.at_time.slice(0, 5)}` : "";
        await queueNudge({
          userId: user.id,
          kind: "appointment",
          title: `${appt.title}${appt.provider ? ` -- ${appt.provider}` : ""} tomorrow${time}`,
          body: null,
          payload: { dateId: appt.id, kind: appt.kind },
        });
      }
      if (due.length > 0) log(`[reminders] queued ${due.length} day-before appointment reminder(s) for ${user.email}`);
    }
  } catch (err) {
    log("[reminders] failed:", err.message);
  }
}

/**
 * Pets Section 6's real vaccine lead-time reminder: "enough real notice to actually book the
 * vet visit before the vaccine lapses" -- fires once a vaccine's own lead_days window has
 * opened, not just the day before like appointments.
 */
async function runVaccineLeadReminders() {
  try {
    for (const user of await listUsers()) {
      const due = await findDueVaccineReminders(user.id);
      for (const v of due) {
        await queueNudge({
          userId: user.id,
          kind: "vaccine",
          title: `${v.pet_name}'s ${v.vaccine_name} due ${new Date(v.due_on).toLocaleDateString()}`,
          body: null,
          payload: { vaccineId: v.id, petId: v.pet_id },
        });
      }
      if (due.length > 0) log(`[reminders] queued ${due.length} vaccine reminder(s) for ${user.email}`);
    }
  } catch (err) {
    log("[reminders] failed:", err.message);
  }
}

/**
 * Wins' real automatic triggers (Git #3151, design contract Section 3): a real debt balance
 * hitting $0, a critical debt getting resolved, a deferred bill finally caught up. See
 * src/core/wins.mjs detectMoneyWins for why this has to be a state-transition check, not a live
 * read, and why a first-sighted debt/bill is seeded silently rather than firing retroactively.
 */
async function runMoneyWinDetection() {
  try {
    for (const user of await listUsers()) {
      const created = await detectMoneyWins(user.id);
      if (created.length > 0) {
        log(`[wins] detected ${created.length} automatic win(s) for ${user.email}: ${created.map((w) => w.text).join(" · ")}`);
      }
    }
  } catch (err) {
    log("[wins] detection failed:", err.message);
  }
}

/**
 * Money's Catches card (contract Section 4, Git #3153): keeps the five real detectors running
 * even when nobody has opened the Money screen recently, so a renewal-watch window opening (a
 * date-driven, not user-action-driven event) is caught by the next sweep rather than only the
 * next visit. GET /api/money/catches also runs the same detectors on demand -- this is belt and
 * suspenders, not the only path; upserts make both safe to run redundantly.
 */
async function runCatchesSweep() {
  try {
    for (const user of await listUsers()) {
      await runCatchDetectors(user.id);
    }
  } catch (err) {
    log("[catches] sweep failed:", err.message);
  }
}

/** Real, live OPM refresh -- once a month is what the design calls for, not once a redeploy. */
async function runMonthlyFederalHolidaysRefresh() {
  try {
    if (!(await needsMonthlyRefresh())) return;
    const result = await refreshFederalHolidays();
    log(`[federal-holidays] refreshed from OPM: ${result.count} holidays across ${result.years.join(", ")}`);
  } catch (err) {
    log("[federal-holidays] refresh failed:", err.message);
  }
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
