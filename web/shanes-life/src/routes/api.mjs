// The signed-in JSON API the web app itself talks to.

import { config } from "../config.mjs";
import { Router, badRequest, forbidden, notFound, readJson, readBody, sendJson, tooMany, unauthorized } from "../http.mjs";
import * as ratelimit from "../auth/ratelimit.mjs";
import { SESSION_COOKIE, createSession, markSessionVerified, revokeAllSessions, revokeSession } from "../auth/sessions.mjs";
import { markSignedIn, recordAuthEvent } from "../core/users.mjs";
import * as credentials from "../core/credentials.mjs";
import * as webauthn from "../auth/webauthn.mjs";
import * as audit from "../core/audit.mjs";
import * as captures from "../core/captures.mjs";
import * as categories from "../core/categories.mjs";
import * as entities from "../core/entities.mjs";
import * as media from "../core/media.mjs";
import * as mcpTokens from "../core/mcp-tokens.mjs";
import * as shares from "../core/shares.mjs";

// Deliberately tight: this app has one real account, so a burst of failures is an attack, not a
// forgetful person.
const LOGIN_LIMIT_PER_IP = { limit: 20, windowMs: 15 * 60 * 1000 };
// Enrolment is the one path that creates a credential, so it is limited harder than sign-in.
const ENROLL_LIMIT_PER_IP = { limit: 10, windowMs: 60 * 60 * 1000 };

function requireUser(ctx) {
  if (!ctx.session) throw unauthorized();
  return ctx.session.user;
}

export function buildApiRouter() {
  const router = new Router();

  // -- auth ---------------------------------------------------------------

  // Sign-in is a passkey assertion and nothing else. There is no /api/auth/login, no email
  // field and no password field anywhere in this app -- design handoff screen 1 draws exactly
  // two controls, "Continue with Face ID" and "Use a passkey from another device", and both of
  // them are this pair of routes.

  router.post("/api/auth/passkey/options", async (_req, res, _params, ctx) => {
    const gate = ratelimit.hit(`login:ip:${ctx.ip}`, LOGIN_LIMIT_PER_IP.limit, LOGIN_LIMIT_PER_IP.windowMs);
    if (!gate.allowed) {
      await recordAuthEvent({ event: "login_throttled", ip: ctx.ip, userAgent: ctx.userAgent });
      res.setHeader("Retry-After", String(Math.ceil(gate.retryAfterMs / 1000)));
      throw tooMany("Too many sign-in attempts. Try again shortly.", {
        retryAfterSeconds: Math.ceil(gate.retryAfterMs / 1000),
      });
    }
    // No allowCredentials: the passkeys this app registers are discoverable (residentKey
    // "required"), so the authenticator itself resolves which account is signing in. That is
    // what removes the email field from the screen -- and it means this endpoint leaks nothing
    // about which accounts exist.
    const challenge = await webauthn.issueChallenge("authentication");
    return sendJson(res, 200, {
      challenge,
      rpId: webauthn.relyingPartyId(),
      timeout: webauthn.CHALLENGE_TTL_SECONDS * 1000,
      userVerification: "required",
    });
  });

  router.post("/api/auth/passkey/verify", async (req, res, _params, ctx) => {
    const body = await readJson(req);
    const gate = ratelimit.hit(`login:ip:${ctx.ip}`, LOGIN_LIMIT_PER_IP.limit, LOGIN_LIMIT_PER_IP.windowMs);
    if (!gate.allowed) {
      await recordAuthEvent({ event: "login_throttled", ip: ctx.ip, userAgent: ctx.userAgent });
      res.setHeader("Retry-After", String(Math.ceil(gate.retryAfterMs / 1000)));
      throw tooMany("Too many sign-in attempts. Try again shortly.", {
        retryAfterSeconds: Math.ceil(gate.retryAfterMs / 1000),
      });
    }

    // One message for every failure mode below, exactly as the password flow did: an unknown
    // credential and a bad signature must be indistinguishable from the outside.
    const refuse = "That passkey did not sign you in.";

    const consumed = await webauthn.consumeChallenge(body.challenge, "authentication");
    if (!consumed) {
      await recordAuthEvent({ event: "login_bad_assertion", ip: ctx.ip, userAgent: ctx.userAgent });
      throw unauthorized(refuse);
    }

    const credential = await credentials.findCredential(body.id);
    if (!credential || !credential.is_active) {
      await recordAuthEvent({
        email: credential?.email ?? null,
        userId: credential?.user_id ?? null,
        event: credential ? "login_inactive" : "login_unknown_credential",
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      throw unauthorized(refuse);
    }

    let verified;
    try {
      verified = webauthn.verifyAssertion({
        expectedChallenge: consumed.challenge,
        response: body.response,
        credential,
      });
    } catch (err) {
      await recordAuthEvent({
        email: credential.email,
        userId: credential.user_id,
        event: "login_bad_assertion",
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      if (!config.isProduction) console.error("[webauthn] assertion refused:", err.message);
      throw unauthorized(refuse);
    }

    await credentials.touchCredential(credential.credential_id, verified.signCount, verified.backedUp);
    await markSignedIn(credential.user_id);
    ratelimit.clear(`login:ip:${ctx.ip}`);

    const session = await createSession(credential.user_id, {
      userAgent: ctx.userAgent,
      ip: ctx.ip,
      credentialId: credential.credential_id,
    });
    await recordAuthEvent({
      email: credential.email,
      userId: credential.user_id,
      event: "login_ok",
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    ctx.setSessionCookie(session.token, session.ttlSeconds);
    return sendJson(res, 200, {
      user: { id: credential.user_id, email: credential.email, name: credential.name },
      expiresAt: session.expiresAt,
    });
  });

  // -- enrolling a passkey ------------------------------------------------

  // Two ways in, and no third: a single-use enrolment token minted at a real terminal
  // (`npm run enroll-passkey`), or an already-signed-in session adding another device. There is
  // no self-service path, because in a passkey-only app that would be a password reset.
  async function resolveEnrollmentSubject(body, ctx) {
    if (body.token) {
      const pending = await credentials.peekEnrollment(body.token);
      if (!pending || !pending.is_active) {
        await recordAuthEvent({ event: "enroll_bad_token", ip: ctx.ip, userAgent: ctx.userAgent });
        throw unauthorized("That enrolment link is not valid any more. Mint a new one with `npm run enroll-passkey`.");
      }
      return { userId: pending.user_id, email: pending.email, name: pending.name, label: pending.label };
    }
    const user = requireUser(ctx);
    return { userId: user.id, email: user.email, name: user.name, label: body.label || "Passkey" };
  }

  router.post("/api/auth/enroll/options", async (req, res, _params, ctx) => {
    const body = await readJson(req);
    const gate = ratelimit.hit(`enroll:ip:${ctx.ip}`, ENROLL_LIMIT_PER_IP.limit, ENROLL_LIMIT_PER_IP.windowMs);
    if (!gate.allowed) {
      res.setHeader("Retry-After", String(Math.ceil(gate.retryAfterMs / 1000)));
      throw tooMany("Too many enrolment attempts. Try again later.", {
        retryAfterSeconds: Math.ceil(gate.retryAfterMs / 1000),
      });
    }
    const subject = await resolveEnrollmentSubject(body, ctx);
    const challenge = await webauthn.issueChallenge("registration", subject.userId);
    const existing = await credentials.listCredentials(subject.userId);
    return sendJson(res, 200, {
      challenge,
      rp: { id: webauthn.relyingPartyId(), name: webauthn.relyingPartyName() },
      // The user handle is the account's real uuid, not the email: it is stored on the
      // authenticator forever, and an email can change.
      user: { id: Buffer.from(subject.userId).toString("base64url"), name: subject.email, displayName: subject.name },
      pubKeyCredParams: webauthn.SUPPORTED_ALGORITHMS.map((a) => ({ type: "public-key", alg: a.alg })),
      timeout: webauthn.CHALLENGE_TTL_SECONDS * 1000,
      attestation: "none",
      authenticatorSelection: {
        // Discoverable, so sign-in needs no email field; verified, so it is a real Face ID /
        // fingerprint / PIN check rather than mere presence.
        residentKey: "required",
        requireResidentKey: true,
        userVerification: "required",
      },
      excludeCredentials: existing.map((c) => ({ type: "public-key", id: c.credential_id, transports: c.transports })),
    });
  });

  router.post("/api/auth/enroll/verify", async (req, res, _params, ctx) => {
    const body = await readJson(req);
    const subject = await resolveEnrollmentSubject(body, ctx);

    const consumed = await webauthn.consumeChallenge(body.challenge, "registration");
    if (!consumed || consumed.user_id !== subject.userId) {
      throw badRequest("That registration attempt expired. Start again.");
    }

    let registration;
    try {
      registration = webauthn.verifyRegistration({
        expectedChallenge: consumed.challenge,
        response: body.response,
      });
    } catch (err) {
      throw badRequest(`That passkey could not be registered: ${err.message}`);
    }

    const label = String(body.label || subject.label || "Passkey").slice(0, 80);
    // Consume the enrolment token BEFORE storing, so a token can never survive a duplicate
    // credential error and be reused.
    if (body.token) {
      const used = await credentials.consumeEnrollment(body.token, registration.credentialId);
      if (!used) throw unauthorized("That enrolment link has already been used.");
    }

    const stored = await credentials.storeCredential(subject.userId, registration, label);
    await recordAuthEvent({
      email: subject.email,
      userId: subject.userId,
      event: "passkey_registered",
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    // Enrolling from a link signs you straight in -- there is nothing else to prove.
    if (body.token) {
      await markSignedIn(subject.userId);
      const session = await createSession(subject.userId, {
        userAgent: ctx.userAgent,
        ip: ctx.ip,
        credentialId: registration.credentialId,
      });
      ctx.setSessionCookie(session.token, session.ttlSeconds);
      return sendJson(res, 201, {
        passkey: stored,
        user: { id: subject.userId, email: subject.email, name: subject.name },
        expiresAt: session.expiresAt,
      });
    }

    return sendJson(res, 201, { passkey: stored });
  });

  router.get("/api/passkeys", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, { passkeys: await credentials.listCredentials(user.id) });
  });

  router.delete("/api/passkeys/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    const removed = await credentials.revokeCredential(user.id, params.id);
    await recordAuthEvent({
      email: user.email,
      userId: user.id,
      event: "passkey_revoked",
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return sendJson(res, 200, { ok: true, removed });
  });

  // A fresh assertion inside a live session. The vault's reveal is the caller the design names
  // ("passkey (WebAuthn) re-auth per reveal ... a stated security requirement, not polish") --
  // the vault UI itself is a later Feature, but the proof-of-freshness it needs lives here.
  router.post("/api/auth/reverify/options", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const owned = await credentials.listCredentials(user.id);
    return sendJson(res, 200, {
      challenge: await webauthn.issueChallenge("vault", user.id),
      rpId: webauthn.relyingPartyId(),
      timeout: webauthn.CHALLENGE_TTL_SECONDS * 1000,
      userVerification: "required",
      allowCredentials: owned.map((c) => ({ type: "public-key", id: c.credential_id, transports: c.transports })),
    });
  });

  router.post("/api/auth/reverify", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const consumed = await webauthn.consumeChallenge(body.challenge, "vault");
    if (!consumed || consumed.user_id !== user.id) throw unauthorized("That check expired. Try again.");

    const credential = await credentials.findCredential(body.id);
    if (!credential || credential.user_id !== user.id) throw unauthorized("That passkey is not on this account.");

    let verified;
    try {
      verified = webauthn.verifyAssertion({
        expectedChallenge: consumed.challenge,
        response: body.response,
        credential,
      });
    } catch (err) {
      if (!config.isProduction) console.error("[webauthn] re-verify refused:", err.message);
      throw unauthorized("That passkey check did not pass.");
    }

    await credentials.touchCredential(credential.credential_id, verified.signCount, verified.backedUp);
    const verifiedAt = await markSessionVerified(ctx.sessionToken, credential.credential_id);
    return sendJson(res, 200, { ok: true, verifiedAt });
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
      passkeyCount: await credentials.countCredentials(user.id),
      lastVerifiedAt: ctx.session.lastVerifiedAt,
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
