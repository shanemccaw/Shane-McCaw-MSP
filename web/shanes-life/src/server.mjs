// Shane's Life -- HTTP entry point.
//
// Boots in this order, deliberately: connect, migrate, then listen. A Replit redeploy therefore
// cannot serve one request against a schema that has not caught up with the code.

import { createServer } from "node:http";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
import { buildWidgetRouter } from "./routes/widget.mjs";
import { handlePlaidWebhook } from "./routes/plaid-webhook.mjs";
import { handleTeslaHook, serveTeslaPublicKey } from "./routes/tesla.mjs";
import { handleHealthMetricHook } from "./routes/health-metrics.mjs";
import { dispatchDueCommands as dispatchDueTeslaCommands, runLowBatteryCheckForUser } from "./core/tesla.mjs";
import { syncOdometerFromTesla, syncChargingSessionsFromTesla } from "./core/vehicles.mjs";
import * as plaid from "./core/plaid.mjs";
import { describeMcpEndpoint, handleMcpRequest } from "./routes/mcp.mjs";
import { runDetectors as runCatchDetectors } from "./core/catches.mjs";
import { findDueDayBeforeReminders } from "./core/dates.mjs";
import { needsMonthlyRefresh, refreshFederalHolidays } from "./core/federal-holidays.mjs";
import { findDueVaccineReminders } from "./core/pets.mjs";
import { queueNudge, redeliverSnoozedNudges } from "./core/nudges.mjs";
import * as timers from "./core/timers.mjs";
import { listUsers } from "./core/users.mjs";
import { detectMoneyWins } from "./core/wins.mjs";
import { captureBillCycleSnapshots, findDueBillReminders, findDueDebtReminders, formatMoney } from "./core/money.mjs";

const PUBLIC_DIR = resolve(config.root, "public");
const apiRouter = buildApiRouter();
const publicRouter = buildPublicRouter();
const widgetRouter = buildWidgetRouter();

// Real structural fix for Git #3334: the service worker's own cache-version string used to be a
// manually-maintained constant in public/sw.js -- nobody bumped it for hundreds of commits (since
// #3160), so every real deploy since kept serving whatever app.js/app.css were cached at install
// time. Instead of trusting a human to remember, this ties the SW cache name to the real commit
// this process is actually running -- computed once at boot (a real deploy always restarts the
// process) so it changes automatically on every real deploy and never on a bare restart of the
// same code. `/sw.js` below serves the file through this substitution instead of the raw static
// file, so nothing has to remember to bump `CACHE` in public/sw.js by hand again.
const SW_BUILD_ID = (() => {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: config.root, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    // No git available in this deploy environment (e.g. a stripped artifact with no .git) --
    // fall back to this boot's own timestamp so the cache still rolls forward on every real
    // restart, just without the human-readable commit tie.
    return String(Date.now());
  }
})();

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

// Git #3276: the ONE real, deliberately cross-origin caller in this app. The Vault Autofill
// extension's one-click fill runs from its own privileged background context
// (chrome-extension://<id>, host-permitted but genuinely foreign to this app's origin) rather
// than through the app's own origin the way the existing reveal popup does -- see
// extension/background.js and src/core/vault.mjs's fillWithTrust. Its real auth is the trust
// token itself, presented in the JSON body, not the session cookie checkOrigin exists to
// protect; refusing this on Origin grounds would just break the feature it exists to serve.
const VAULT_FILL_PATH = /^\/api\/vault\/[^/]+\/fill$/;

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

  // ---- Plaid webhooks: authenticated by Plaid's own ES256 signature over the body hash, never
  // by the session cookie, and deliberately exempt from checkOrigin (Plaid is not a browser and
  // sends no Origin header). Sits above the routers for the same reason /mcp does -- a different
  // auth model entirely. See src/routes/plaid-webhook.mjs.
  if (pathname === "/api/plaid/webhook") {
    if (method !== "POST") {
      res.writeHead(405, { allow: "POST" });
      return res.end();
    }
    return handlePlaidWebhook(req, res, { ip: clientIp(req) || "unknown", log: (m) => log(m) });
  }

  // ---- Tesla webhook: authenticated by its own bearer token in the path, never by the session
  // cookie -- the external trigger (Shortcuts, IFTTT, Home Assistant) posting here is not a
  // browser and holds no session. Same shape as /widget/t/:token. See src/routes/tesla.mjs.
  if (pathname.startsWith("/hooks/tesla/")) {
    if (method !== "POST") {
      res.writeHead(405, { allow: "POST" });
      return res.end();
    }
    const token = decodeURIComponent(pathname.slice("/hooks/tesla/".length));
    return handleTeslaHook(req, res, token, { log: (m) => log(m) });
  }

  // ---- Apple Health bridge webhook (Git #3322): authenticated by its own bearer token in the
  // path, never by the session cookie -- a real Apple Shortcuts automation posting a HealthKit
  // sample is not a browser and holds no session. Same shape as /hooks/tesla/:token.
  if (pathname.startsWith("/hooks/health-metrics/")) {
    if (method !== "POST") {
      res.writeHead(405, { allow: "POST" });
      return res.end();
    }
    const token = decodeURIComponent(pathname.slice("/hooks/health-metrics/".length));
    return handleHealthMetricHook(req, res, token, { log: (m) => log(m) });
  }

  // ---- Tesla's real vehicle-pairing well-known public key: public by definition, no auth at
  // all. Has to be checked ahead of the blanket `.well-known` 404 further down (a deliberate,
  // real fix for an unrelated MCP OAuth-discovery-probe bug -- see that check's own comment).
  if (pathname === "/.well-known/appspecific/com.tesla.3p.public-key.pem") {
    if (method !== "GET" && method !== "HEAD") {
      res.writeHead(405, { allow: "GET, HEAD" });
      return res.end();
    }
    return serveTeslaPublicKey(res);
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

  // ---- /widget: authenticated by its own bearer token in the path, never by the session
  // cookie -- a third-party iOS widget app's WKWebView shares neither Safari's cookies nor its
  // passkeys (Git #3188). Sits above checkOrigin/session for the same reason /mcp does.
  const widgetMatch = widgetRouter.match(method, pathname);
  if (widgetMatch) {
    return widgetMatch.handler(req, res, widgetMatch.params, { url, ip: clientIp(req) });
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
    if (method !== "GET" && !VAULT_FILL_PATH.test(pathname) && !checkOrigin(req, url)) {
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

  // The one file that isn't served as a raw static file: see SW_BUILD_ID above (Git #3334).
  if (pathname === "/sw.js") {
    const src = readFileSync(resolve(PUBLIC_DIR, "sw.js"), "utf8").replaceAll("__SW_BUILD_ID__", SW_BUILD_ID);
    res.writeHead(200, {
      "content-type": "text/javascript; charset=utf-8",
      "content-length": Buffer.byteLength(src),
      // Must never be cached, or a redeploy cannot roll the app forward (same reasoning as
      // http.mjs's serveStatic already applies to sw.js).
      "cache-control": "no-cache",
    });
    return res.end(src);
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
      await runMoneyDueReminders();
      await runPlaidItemMaintenance();
      await runBillCycleSnapshotCapture();
      await runTeslaLowBatteryChecks();
      await runTeslaOdometerAndChargingSync();
    },
    6 * 60 * 60 * 1000,
  );
  housekeeping.unref();

  // Snoozed nudges need a much tighter check than the 6-hour sweep above -- "Snooze 1h" would
  // otherwise arrive up to 6 hours late, which is not a snooze. Real re-delivery only fires for
  // rows whose snoozed_until has actually passed, so a 5-minute poll costs nothing extra.
  const snoozeCheck = setInterval(
    async () => {
      try {
        const redelivered = await redeliverSnoozedNudges();
        if (redelivered > 0) log(`[nudges] redelivered ${redelivered} snoozed nudge(s)`);
      } catch (err) {
        log("[nudges] snooze redelivery failed:", err.message);
      }
    },
    5 * 60 * 1000,
  );
  snoozeCheck.unref();

  // Git #3218's checkout-to-trunk automation schedules a real command 5 minutes out -- the same
  // tight-poll reasoning as the snooze check above applies (a setTimeout-only countdown would die
  // on every redeploy; this is a persisted row, so the sweep just has to run at least as often as
  // the real countdown itself is meaningful).
  const teslaCommandCheck = setInterval(
    async () => {
      try {
        const sent = await dispatchDueTeslaCommands();
        if (sent > 0) log(`[tesla] dispatched ${sent} scheduled command(s)`);
      } catch (err) {
        log("[tesla] scheduled command dispatch failed:", err.message);
      }
    },
    5 * 60 * 1000,
  );
  teslaCommandCheck.unref();

  // Standalone timers (Git #3307): a real "8 min timer for pasta" needs to fire close to on
  // time -- much tighter than even the 5-minute sweeps above, since a real timer can genuinely
  // be "2 minutes" (the issue's own stated verification test). 20 seconds costs nothing extra
  // (one indexed WHERE fires_at <= now() read) and keeps the real, worst-case lateness small.
  const timerCheck = setInterval(
    async () => {
      const fired = await runTimerSweep();
      if (fired > 0) log(`[timers] fired ${fired} timer(s)`);
    },
    20 * 1000,
  );
  timerCheck.unref();

  // Run once at boot too -- a 6-hour interval alone would leave a genuinely due day-before
  // reminder or a stale federal-holiday list waiting up to 6 hours after every redeploy.
  await runDayBeforeReminders();
  await runVaccineLeadReminders();
  await runMonthlyFederalHolidaysRefresh();
  await runMoneyWinDetection();
  await runCatchesSweep();
  await runMoneyDueReminders();
  await runPlaidItemMaintenance();
  await runTeslaLowBatteryChecks();
  await runTeslaOdometerAndChargingSync();
  await runTimerSweep();
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
 * Standalone timers (Git #3307) -- fires every real due, unfired, uncanceled timer as a real OS
 * notification, through the existing nudge/web-push path (`countsToCap: false`: a timer Shane
 * directly asked for must always fire, never held for the 1-3/day cap -- see nudges.mjs's own
 * header for the same exception already made for meds batches). Marked fired BEFORE the push
 * attempt, not after: a push failure must not cause the same timer to re-fire (and re-notify)
 * every 20 seconds until someone notices -- the row is the one real source of truth for "did
 * this already happen," same as nudges.mjs's own "the nudge_events row is already committed
 * regardless" reasoning for pushNudge.
 */
async function runTimerSweep() {
  let fired = 0;
  try {
    const due = await timers.findDue();
    for (const row of due) {
      await timers.markFired(row.id);
      const label = row.label ? ` -- ${row.label}` : "";
      await queueNudge({
        userId: row.user_id,
        kind: "timer",
        title: `Timer's up${label}`,
        body: null,
        payload: { timerId: row.id },
        countsToCap: false,
      });
      fired += 1;
    }
  } catch (err) {
    log("[timers] sweep failed:", err.message);
  }
  return fired;
}

/**
 * The real "charge tonight for tomorrow's commute" check (Git #3238) -- see
 * core/tesla.mjs's runLowBatteryCheckForUser for the actual logic and migration 056 for why
 * the cost line is Shane's own real, entered rate rather than anything scraped from Tesla.
 * Each user is tried independently: a real Tesla API hiccup (network error, expired refresh
 * token) for one user must never stop the vaccine/appointment/bill reminders that follow it in
 * the same sweep, unlike the other reminder functions above which are pure local-DB reads.
 */
async function runTeslaLowBatteryChecks() {
  for (const user of await listUsers()) {
    try {
      const result = await runLowBatteryCheckForUser(user.id);
      if (result.nudged) log(`[reminders] queued Tesla low-battery commute nudge for ${user.email}`);
    } catch (err) {
      log(`[reminders] Tesla low-battery check failed for ${user.email}:`, err.message);
    }
  }
}

/**
 * Real Tesla odometer + charging-session sync (Git #3217) -- see core/vehicles.mjs's
 * syncOdometerFromTesla/syncChargingSessionsFromTesla for the actual reads/writes. Same
 * per-user, independent-failure discipline as runTeslaLowBatteryChecks above, and each of the
 * two real halves is tried independently too: a real charging-history hiccup must never stop
 * that same user's odometer sync, or the next user's sweep.
 */
async function runTeslaOdometerAndChargingSync() {
  for (const user of await listUsers()) {
    try {
      const odometer = await syncOdometerFromTesla(user.id);
      if (odometer.synced) log(`[tesla] synced odometer for ${user.email}: ${odometer.currentMileage} mi`);
    } catch (err) {
      log(`[tesla] odometer sync failed for ${user.email}:`, err.message);
    }
    try {
      const charging = await syncChargingSessionsFromTesla(user.id);
      if (charging.synced && charging.count > 0) log(`[tesla] synced ${charging.count} charging session(s) for ${user.email}`);
    } catch (err) {
      log(`[tesla] charging-history sync failed for ${user.email}:`, err.message);
    }
  }
}

/**
 * Real cycle-start balance snapshots for every real bill account (Git #3212), the data source
 * behind the bill detail sheet's rolled-over/this-cycle split and its funding-history sparkline.
 * Idempotent (migration 049's unique (account_id, cycle_start)) -- running this again before the
 * next real cycle starts is always a real no-op, so a 6-hour sweep granularity is fine even
 * though the honest capture moment is "right at the cycle boundary."
 */
async function runBillCycleSnapshotCapture() {
  try {
    const result = await captureBillCycleSnapshots();
    if (result.capturedCount > 0) {
      log(`[money] captured ${result.capturedCount} bill cycle snapshot(s) for cycle starting ${result.cycleStart}`);
    }
  } catch (err) {
    log("[money] bill cycle snapshot capture failed:", err.message);
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

/**
 * Money's real bill due-date and Tax Levy reminders (Git #3161, design contract Section 3):
 * `accounts.due_day` and `debts.due_day` are already real data -- this surfaces the same real
 * numbers as a due-soon nudge rather than maintaining a second due-date tracker. The Tax Levy's
 * own $242/month installment (Treasury Offset Program, migration 037) queues under a genuinely
 * separate kind (`debt_due`) from routine bills (`bill`), so it is never folded anonymously into
 * the general bill list.
 */
async function runMoneyDueReminders() {
  try {
    for (const user of await listUsers()) {
      const [bills, debts] = await Promise.all([findDueBillReminders(user.id), findDueDebtReminders(user.id)]);
      for (const b of bills) {
        await queueNudge({
          userId: user.id,
          kind: "bill",
          title: `${b.name} due ${new Date(b.dueDate).toLocaleDateString()} -- ${formatMoney(b.amountCents) ?? "amount unknown"}`,
          body: null,
          payload: { accountId: b.id, dueDate: b.dueDate },
        });
      }
      for (const d of debts) {
        await queueNudge({
          userId: user.id,
          kind: "debt_due",
          title: `${d.name} payment due ${new Date(d.dueDate).toLocaleDateString()} -- ${formatMoney(d.amountCents) ?? "amount unknown"}`,
          body: null,
          payload: { debtId: d.id, dueDate: d.dueDate },
        });
      }
      if (bills.length > 0 || debts.length > 0) {
        log(`[reminders] queued ${bills.length} bill / ${debts.length} debt due-date reminder(s) for ${user.email}`);
      }
    }
  } catch (err) {
    log("[reminders] money due-date sweep failed:", err.message);
  }
}

/**
 * Plaid item maintenance (Git #3168), belt-and-braces to the webhook receiver rather than a
 * replacement for it.
 *
 * Two real jobs. First, point items at this app's receiver: every item in this database was
 * linked by the WPF app, which never set a webhook, so without this they can never report their
 * own health. Second, poll /item/get so a bank that broke while the webhook was misconfigured --
 * or before this feature existed at all -- is still noticed, just later than a webhook would.
 *
 * Skips itself entirely when Plaid is not configured, or when PUBLIC_ORIGIN is not a public
 * HTTPS origin Plaid could ever deliver to. That is the normal local-dev case, and it is a real
 * skip with a real reason, not a silent no-op.
 */
async function runPlaidItemMaintenance() {
  if (!plaid.plaidConfigured()) return;
  try {
    if (plaid.webhookUrlIsDeliverable()) {
      const registered = await plaid.registerWebhooks();
      if (registered.updated.length > 0) {
        log(`[plaid] registered webhook on ${registered.updated.length} item(s) -> ${registered.target}`);
      }
      for (const f of registered.failed) log(`[plaid] webhook registration failed for ${f.institutionName}: ${f.error}`);
    }

    const before = new Map((await plaid.listItems()).map((i) => [i.id, i.health]));
    const { refreshed, failed } = await plaid.refreshAllItemHealth();
    for (const f of failed) log(`[plaid] health refresh failed for item ${f.id}: ${f.error}`);

    for (const item of refreshed) {
      if (!item) continue;
      const wasHealth = before.get(item.id);
      // Only a real transition INTO a reconnectable state is news -- the same rule the webhook
      // receiver applies, so polling and webhooks cannot double-notify for one break.
      if (wasHealth === item.health || !item.needsReconnect) continue;
      log(`[plaid] ${item.institutionName} health ${wasHealth} -> ${item.health}`);
      for (const user of await listUsers()) {
        await queueNudge({
          userId: user.id,
          kind: "bank",
          title: `${item.institutionName} needs reconnecting`,
          body: item.healthMessage,
          payload: { plaidItemId: item.id, health: item.health, code: item.healthCode },
        });
      }
    }
  } catch (err) {
    log("[plaid] item maintenance failed:", err.message);
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
