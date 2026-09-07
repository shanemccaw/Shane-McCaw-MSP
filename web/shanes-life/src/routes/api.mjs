// The signed-in JSON API the web app itself talks to.

import { config } from "../config.mjs";
import { Router, badRequest, forbidden, notFound, readJson, readBody, sendJson, tooMany, unauthorized } from "../http.mjs";
import * as ratelimit from "../auth/ratelimit.mjs";
import { SESSION_COOKIE, createSession, revokeAllSessions, revokeSession } from "../auth/sessions.mjs";
import { authenticate, recordAuthEvent } from "../core/users.mjs";
import * as audit from "../core/audit.mjs";
import * as captures from "../core/captures.mjs";
import * as categories from "../core/categories.mjs";
import * as entities from "../core/entities.mjs";
import * as media from "../core/media.mjs";
import * as mcpTokens from "../core/mcp-tokens.mjs";
import * as shares from "../core/shares.mjs";

// Deliberately tight: this app has one real account, so a burst of failures is an attack, not a
// forgetful person. Both windows must pass -- per-address and per-source.
const LOGIN_LIMIT_PER_IP = { limit: 10, windowMs: 15 * 60 * 1000 };
const LOGIN_LIMIT_PER_EMAIL = { limit: 5, windowMs: 15 * 60 * 1000 };

function requireUser(ctx) {
  if (!ctx.session) throw unauthorized();
  return ctx.session.user;
}

export function buildApiRouter() {
  const router = new Router();

  // -- auth ---------------------------------------------------------------

  router.post("/api/auth/login", async (req, res, _params, ctx) => {
    const body = await readJson(req);
    const email = String(body.email || "").trim();
    const password = String(body.password || "");
    if (!email || !password) throw badRequest("Email and password are both required.");

    const ipGate = ratelimit.hit(`login:ip:${ctx.ip}`, LOGIN_LIMIT_PER_IP.limit, LOGIN_LIMIT_PER_IP.windowMs);
    const emailGate = ratelimit.hit(
      `login:email:${email.toLowerCase()}`,
      LOGIN_LIMIT_PER_EMAIL.limit,
      LOGIN_LIMIT_PER_EMAIL.windowMs,
    );
    if (!ipGate.allowed || !emailGate.allowed) {
      await recordAuthEvent({ email, event: "login_throttled", ip: ctx.ip, userAgent: ctx.userAgent });
      const retryMs = Math.max(ipGate.retryAfterMs, emailGate.retryAfterMs);
      res.setHeader("Retry-After", String(Math.ceil(retryMs / 1000)));
      throw tooMany("Too many sign-in attempts. Try again shortly.", {
        retryAfterSeconds: Math.ceil(retryMs / 1000),
      });
    }

    const result = await authenticate(email, password);
    if (!result.ok) {
      await recordAuthEvent({ email, userId: result.userId ?? null, event: result.reason, ip: ctx.ip, userAgent: ctx.userAgent });
      // One message for every failure mode: a wrong password and an address with no account
      // must be indistinguishable from the outside.
      throw unauthorized("That email and password do not match an account.");
    }

    ratelimit.clear(`login:email:${email.toLowerCase()}`);
    ratelimit.clear(`login:ip:${ctx.ip}`);
    const session = await createSession(result.user.id, { userAgent: ctx.userAgent, ip: ctx.ip });
    await recordAuthEvent({ email, userId: result.user.id, event: "login_ok", ip: ctx.ip, userAgent: ctx.userAgent });

    ctx.setSessionCookie(session.token, session.ttlSeconds);
    return sendJson(res, 200, { user: result.user, expiresAt: session.expiresAt });
  });

  router.post("/api/auth/logout", async (_req, res, _params, ctx) => {
    if (ctx.sessionToken) {
      await revokeSession(ctx.sessionToken);
      if (ctx.session) {
        await recordAuthEvent({
          email: ctx.session.user.email,
          userId: ctx.session.user.id,
          event: "logout",
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
      }
    }
    ctx.clearSessionCookie();
    return sendJson(res, 200, { ok: true });
  });

  router.post("/api/auth/logout-everywhere", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const count = await revokeAllSessions(user.id);
    ctx.clearSessionCookie();
    return sendJson(res, 200, { ok: true, revoked: count });
  });

  router.get("/api/me", async (_req, res, _params, ctx) => {
    if (!ctx.session) return sendJson(res, 200, { user: null });
    const user = ctx.session.user;
    return sendJson(res, 200, {
      user,
      pendingCaptures: await captures.pendingCount(user.id),
      publicOrigin: config.publicOrigin,
    });
  });

  // -- the capture box ----------------------------------------------------

  // Raw-body upload rather than multipart: the browser can POST a Blob straight from
  // MediaRecorder or a camera <input> with one fetch, and the server needs no parser.
  router.post("/api/media", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const bytes = await readBody(req, config.maxUploadBytes);
    const row = await media.storeMedia({
      userId: user.id,
      mimeType: req.headers["content-type"] || "",
      bytes,
      originalName: req.headers["x-file-name"] || null,
    });
    return sendJson(res, 201, row);
  });

  router.get("/api/media/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    const row = await media.readMedia(user.id, params.id);
    if (!row) throw notFound("Attachment not found");
    res.writeHead(200, {
      "content-type": row.mime_type,
      "content-length": row.byte_size,
      "cache-control": "private, max-age=3600",
    });
    return res.end(row.bytes);
  });

  router.post("/api/captures", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const kind = body.mediaId && !body.kind ? "photo" : body.kind || "text";
    const row = await captures.createCapture({
      userId: user.id,
      kind,
      bodyText: body.text ?? null,
      mediaId: body.mediaId ?? null,
      source: "web",
    });
    await audit.record({ userId: user.id, actor: "web", action: "capture.create", detail: { captureId: row.id, kind } });
    return sendJson(res, 201, row);
  });

  router.get("/api/captures", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, {
      captures: await captures.listCaptures(user.id, {
        status: ctx.url.searchParams.get("status") || "pending",
        limit: ctx.url.searchParams.get("limit"),
      }),
    });
  });

  router.post("/api/captures/:id/dismiss", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    const row = await captures.dismissCapture(user.id, params.id);
    await audit.record({ userId: user.id, actor: "web", action: "capture.dismiss", detail: { captureId: params.id } });
    return sendJson(res, 200, row);
  });

  // -- entities -----------------------------------------------------------

  router.get("/api/entities", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const q = ctx.url.searchParams;
    return sendJson(res, 200, {
      entities: await entities.listEntities(user.id, {
        category: q.get("category"),
        status: q.get("status"),
        search: q.get("search"),
        includeArchived: q.get("includeArchived") === "true",
        limit: q.get("limit"),
      }),
    });
  });

  router.post("/api/entities", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const entity = await entities.createEntity({
      userId: user.id,
      category: body.category || "note",
      categoryMeta: body.categoryMeta || {},
      title: body.title,
      body: body.body ?? null,
      status: body.status || "open",
      occursAt: body.occursAt ?? null,
      remindAt: body.remindAt ?? null,
      data: body.data || {},
      items: body.items || [],
      captureId: body.captureId ?? null,
      source: "web",
      createdBy: "shane",
    });
    await audit.record({ userId: user.id, actor: "web", action: "entity.create", entityId: entity.id, detail: { category: entity.category } });
    return sendJson(res, 201, entity);
  });

  router.get("/api/entities/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    const entity = await entities.getEntity(user.id, params.id);
    if (!entity) throw notFound("Entity not found");
    return sendJson(res, 200, entity);
  });

  router.patch("/api/entities/:id", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const patch = await readJson(req);
    const entity = await entities.updateEntity(user.id, params.id, patch, { createdBy: "shane" });
    await audit.record({ userId: user.id, actor: "web", action: "entity.update", entityId: params.id, detail: { fields: Object.keys(patch) } });
    return sendJson(res, 200, entity);
  });

  router.post("/api/entities/:id/items", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const entity = await entities.addItems(user.id, params.id, body.items);
    return sendJson(res, 201, entity);
  });

  router.patch("/api/entities/:id/items/:itemId", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const owned = await entities.getEntity(user.id, params.id);
    if (!owned) throw notFound("Entity not found");
    const body = await readJson(req);
    if (body.checked === undefined) throw badRequest("checked is required");
    const item = await entities.setItemChecked(params.id, params.itemId, body.checked, "owner");
    return sendJson(res, 200, item);
  });

  router.delete("/api/entities/:id/items/:itemId", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    await entities.deleteItem(user.id, params.id, params.itemId);
    return sendJson(res, 200, { ok: true });
  });

  // -- today / categories / activity --------------------------------------

  router.get("/api/today", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, {
      // "Today view shows only what's next" (contract pack Section 3) -- three, not a backlog.
      next: await entities.nextUp(user.id, 3),
      pendingCaptures: await captures.pendingCount(user.id),
      recent: await entities.listEntities(user.id, { limit: 8 }),
    });
  });

  router.get("/api/categories", async (_req, res, _params, ctx) => {
    requireUser(ctx);
    return sendJson(res, 200, { categories: await categories.listCategories() });
  });

  router.get("/api/activity", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, { activity: await audit.recent(user.id, ctx.url.searchParams.get("limit")) });
  });

  // -- share links --------------------------------------------------------

  router.get("/api/shares", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, {
      shares: await shares.listShareLinks(user.id, ctx.url.searchParams.get("entityId")),
    });
  });

  router.post("/api/shares", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    if (!body.entityId) throw badRequest("entityId is required");
    const share = await shares.createShareLink({
      userId: user.id,
      entityId: body.entityId,
      label: body.label ?? null,
      canCheck: body.canCheck !== false,
      expiresInDays: body.expiresInDays ?? null,
    });
    await audit.record({ userId: user.id, actor: "web", action: "share.create", entityId: body.entityId, detail: { shareId: share.id } });
    return sendJson(res, 201, share);
  });

  router.delete("/api/shares/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    await shares.revokeShareLink(user.id, params.id);
    await audit.record({ userId: user.id, actor: "web", action: "share.revoke", detail: { shareId: params.id } });
    return sendJson(res, 200, { ok: true });
  });

  // -- MCP tokens ---------------------------------------------------------

  router.get("/api/mcp-tokens", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, {
      tokens: await mcpTokens.listMcpTokens(user.id),
      endpoint: `${config.publicOrigin}/mcp`,
    });
  });

  router.post("/api/mcp-tokens", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    if (!body.label || !String(body.label).trim()) {
      throw badRequest("label is required -- name the connection so it can be revoked later.");
    }
    const issued = await mcpTokens.issueMcpToken(user.id, body.label);
    await audit.record({ userId: user.id, actor: "web", action: "mcp_token.issue", detail: { tokenId: issued.id, label: issued.label } });
    // The raw token appears here and nowhere else, ever.
    return sendJson(res, 201, {
      ...issued,
      endpoint: `${config.publicOrigin}/mcp`,
      urlForm: `${config.publicOrigin}/mcp/t/${issued.token}`,
    });
  });

  router.delete("/api/mcp-tokens/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    await mcpTokens.revokeMcpToken(user.id, params.id);
    await audit.record({ userId: user.id, actor: "web", action: "mcp_token.revoke", detail: { tokenId: params.id } });
    return sendJson(res, 200, { ok: true });
  });

  // Guard against a route ever being added that expects a signed-in user but forgets to say so.
  router.get("/api/_routes", async (_req, res, _params, ctx) => {
    requireUser(ctx);
    if (config.isProduction) throw forbidden("Not available in production");
    return sendJson(res, 200, { routes: router.routes.map((r) => `${r.method} ${r.pattern}`) });
  });

  return router;
}
