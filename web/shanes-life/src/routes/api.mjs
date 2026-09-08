// The signed-in JSON API the web app itself talks to.

import { config } from "../config.mjs";
import { HttpError, Router, badRequest, forbidden, notFound, readJson, readBody, sendJson, tooMany, unauthorized } from "../http.mjs";
import * as ratelimit from "../auth/ratelimit.mjs";
import { SESSION_COOKIE, createSession, markSessionVerified, revokeAllSessions, revokeSession } from "../auth/sessions.mjs";
import { markSignedIn, recordAuthEvent } from "../core/users.mjs";
import * as credentials from "../core/credentials.mjs";
import * as webauthn from "../auth/webauthn.mjs";
import * as audit from "../core/audit.mjs";
import * as captures from "../core/captures.mjs";
import * as categories from "../core/categories.mjs";
import * as contacts from "../core/contacts.mjs";
import * as dates from "../core/dates.mjs";
import * as entities from "../core/entities.mjs";
import * as federalHolidays from "../core/federal-holidays.mjs";
import * as lists from "../core/lists.mjs";
import * as mealPlan from "../core/meal-plan.mjs";
import * as media from "../core/media.mjs";
import * as money from "../core/money.mjs";
import * as mcpTokens from "../core/mcp-tokens.mjs";
import * as medications from "../core/medications.mjs";
import * as pets from "../core/pets.mjs";
import * as prices from "../core/prices.mjs";
import * as recipes from "../core/recipes.mjs";
import * as scan from "../core/scan.mjs";
import * as shares from "../core/shares.mjs";
import * as storeAisles from "../core/store-aisles.mjs";
import * as vault from "../core/vault.mjs";
import * as things from "../core/things.mjs";
import * as wins from "../core/wins.mjs";
import { orderItems } from "../core/shopping-order.mjs";
import * as vehicles from "../core/vehicles.mjs";

// Deliberately tight: this app has one real account, so a burst of failures is an attack, not a
// forgetful person.
const LOGIN_LIMIT_PER_IP = { limit: 20, windowMs: 15 * 60 * 1000 };
// Enrolment is the one path that creates a credential, so it is limited harder than sign-in.
const ENROLL_LIMIT_PER_IP = { limit: 10, windowMs: 60 * 60 * 1000 };

function requireUser(ctx) {
  if (!ctx.session) throw unauthorized();
  return ctx.session.user;
}

/**
 * The critter daily-roll date key (Git #3119, "Shanes Life 14 - Critters.dc.html"): unpadded
 * Y-M-D from the SERVER's clock, never the client's -- the spec is explicit that the roll is
 * "evaluated once at first open from the server date" so every device shows the same critter for
 * a slot on a given day regardless of its own clock/timezone. Format matches the design's own
 * `d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate()` exactly (no zero-padding) --
 * padding would change the hash input and roll a different critter than the design previewed.
 */
function serverDateKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
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
      // The critter daily-roll seed (Git #3119) -- see serverDateKey() above.
      serverDate: serverDateKey(),
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

  // -- shopping / lists (typed tables, Git #3116's decision -- #3088 is the first room built
  // on this shape) ----------------------------------------------------------

  // Flat / Category / Best-path ordering (Git #3108) -- ?order=flat|category|best on either
  // real list-reading endpoint below. Best path reads the real, accumulated store_aisles map for
  // whatever store the list is currently set to; with no store set (or nothing learned yet for
  // it) every item lands in `unknown`, which is real and honest, not a guess.
  async function attachOrder(user, detail, url) {
    const mode = url.searchParams.get("order") || "flat";
    if (mode !== "category" && mode !== "best") return { ...detail, order: "flat" };
    let storeMap = [];
    if (mode === "best" && detail.store) storeMap = await storeAisles.getStoreMap(user.id, detail.store);
    const { mode: appliedMode, ...ordered } = orderItems(detail.items, mode, (item) => storeAisles.matchAisle(item.text, storeMap));
    return { ...detail, order: appliedMode, ...ordered };
  }

  // The Shopping room reads/writes exactly one real list -- "one run" (design handoff's capture
  // grammar, `grocery words -> the run`) -- so the client never needs to know its id up front.
  router.get("/api/shopping", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const list = await lists.getOrCreateShoppingList(user.id);
    const detail = await lists.getListDetail(user.id, list.id);
    // Per-store price history (Git #3112): "last time $X at Store" on each row, one extra query
    // for the whole list rather than one per item.
    detail.items = await prices.attachLatestPrices(user.id, detail.items);
    // Weekly-ad cross-store verdicts, coupons, multi-buy (Git #3110): "Walmart $2.99", cheapest
    // store on the current ad, plus any matching coupon -- a different question from lastPrice
    // above ("what does the CURRENT weekly ad say"), so it's a separate field, not a merge.
    detail.items = await prices.attachWeeklyAdVerdicts(user.id, detail.items);
    return sendJson(res, 200, await attachOrder(user, detail, ctx.url));
  });

  // The Lists room (#3155): every real list except the Shopping singleton -- Watch, Books, and
  // anything Claude files on the fly via `push_list`'s generic `category` path (Section 3, "real
  // simple lists").
  router.get("/api/lists", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, { lists: await lists.listListsForUser(user.id) });
  });

  // Shane naming a list directly from the Lists room ("New list") -- the same real
  // find-or-create `push_list` uses, just reached from the UI instead of MCP.
  router.post("/api/lists", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const list = await lists.getOrCreateListByName(user.id, { name: body.name, category: body.category });
    return sendJson(res, 201, await lists.getListDetail(user.id, list.id));
  });

  router.get("/api/lists/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    const detail = await lists.getListDetail(user.id, params.id);
    if (!detail) throw notFound("List not found");
    return sendJson(res, 200, await attachOrder(user, detail, ctx.url));
  });

  // Which real store this run is being shopped at -- what Best-path ordering and aisle memory
  // both key off. `store: null` clears it (switching stores mid-week).
  router.patch("/api/lists/:id/store", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    return sendJson(res, 200, await lists.setListStore(user.id, params.id, body.store ?? null));
  });

  // Real per-store aisle memory (Git #3108): "say where you found it once; next trip the list
  // walks the store in order." Sets/corrects a real spot for one item at one store, growing the
  // real accumulated map store_aisles.getStoreMap reads for Best-path -- and, for immediate
  // display, writes the same "Aisle N · note" line onto the item's own `note` field, matching
  // the design's "shown as a second line under the item."
  router.post("/api/lists/:id/items/:itemId/aisle", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const owned = await lists.getOwnedList(user.id, params.id);
    if (!owned) throw notFound("List not found");
    const body = await readJson(req);
    const store = body.store || owned.store;
    if (!store) throw badRequest("store is required (set the list's store first, or pass one in the body)");
    const items = await lists.getListDetail(user.id, params.id);
    const item = items?.items?.find((i) => i.id === params.itemId);
    if (!item) throw notFound("Item not found");

    const spot = await storeAisles.recordAisle(user.id, store, item.text, body.aisle, body.note ?? null);
    await audit.record({ userId: user.id, actor: "web", action: "store_aisle.record", entityId: params.id, detail: { store: spot.store, item: spot.item_text, aisle: spot.aisle, hits: spot.hits } });
    const noteLine = `Aisle ${spot.aisle}${spot.note ? ` · ${spot.note}` : ""}`;
    // Persist the aisle onto the list item's own note too, so it shows up on this run's row
    // without a second lookup -- store_aisles.getStoreMap remains the real source of truth for
    // future runs (and other lists at the same store).
    const updatedItem = await lists.setListItemNote(params.id, params.itemId, noteLine);
    return sendJson(res, 200, { spot, item: updatedItem, note: noteLine });
  });

  // The real, accumulated map for one store (Git #3108) -- what Best-path reads, surfaced for
  // the owner directly too (e.g. a settings/debug view), not just consumed internally.
  router.get("/api/store-aisles", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const store = ctx.url.searchParams.get("store");
    if (store) return sendJson(res, 200, { store, items: await storeAisles.getStoreMap(user.id, store) });
    return sendJson(res, 200, { stores: await storeAisles.listStores(user.id) });
  });

  // Real hub/spoke item-location memory (Git #3156). Saying it again corrects the same row --
  // see things.recordThing -- so there is deliberately no confirmation step here, matching
  // contract Section 8's "trust stated facts immediately."
  router.post("/api/things", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await things.recordThing(user.id, body);
    await audit.record({ userId: user.id, actor: "web", action: "thing.record", entityId: row.id, detail: { name: row.name, place: row.place, house: row.house } });
    return sendJson(res, 200, row);
  });

  // List/browse, optionally by house ("Lives at <house>"); ?q= for a real results list, distinct
  // from the single-best-match /search endpoint below the "where's the..." box uses.
  router.get("/api/things", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const house = ctx.url.searchParams.get("house");
    const q = ctx.url.searchParams.get("q");
    if (q) return sendJson(res, 200, { items: await things.searchThings(user.id, q) });
    const [items, houses] = await Promise.all([things.listThings(user.id, { house }), things.listHouses(user.id)]);
    return sendJson(res, 200, { items, houses });
  });

  // "where's the drill?" -- the app's own real, deterministic search (no AI call, per contract
  // Section 10). Returns the single best real match, or `thing: null` when genuinely nothing is
  // on file, which is a real, honest answer, not an error.
  router.get("/api/things/search", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const q = ctx.url.searchParams.get("q");
    if (!q) throw badRequest("q is required");
    return sendJson(res, 200, { thing: await things.findThing(user.id, q) });
  });

  // "Who fixed what" -- real service-provider contact log (Git #3156). Each capture is a new
  // real history row, not a latest-state update -- see contacts.recordContact.
  router.post("/api/contacts", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await contacts.recordContact(user.id, body);
    await audit.record({ userId: user.id, actor: "web", action: "contact.record", entityId: row.id, detail: { name: row.name, trade: row.trade, did: row.did } });
    return sendJson(res, 201, row);
  });

  router.get("/api/contacts", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const q = ctx.url.searchParams.get("q");
    const trade = ctx.url.searchParams.get("trade");
    if (q) return sendJson(res, 200, { items: await contacts.searchContacts(user.id, q) });
    return sendJson(res, 200, { items: await contacts.listContacts(user.id, { trade }) });
  });

  router.post("/api/lists/:id/items", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    return sendJson(res, 201, await lists.addListItems(user.id, params.id, body.items));
  });

  router.patch("/api/lists/:id/items/:itemId", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const owned = await lists.getOwnedList(user.id, params.id);
    if (!owned) throw notFound("List not found");
    const body = await readJson(req);
    if (body.checked === undefined) throw badRequest("checked is required");
    const item = await lists.setListItemChecked(params.id, params.itemId, body.checked);
    if (!item) throw notFound("Item not found");
    // setListItemChecked returns the entity-shaped keys (checked_at/checked_by) the share layer
    // needs -- remapped here onto the same raw done/done_at shape every other owner-side list
    // endpoint (GET /api/shopping, POST items, clear-checked) already returns.
    return sendJson(res, 200, { id: item.id, position: item.position, text: item.text, note: item.note, done: Boolean(item.checked_at), done_at: item.checked_at });
  });

  router.delete("/api/lists/:id/items/:itemId", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    await lists.deleteListItem(user.id, params.id, params.itemId);
    return sendJson(res, 200, { ok: true });
  });

  // The in-scope half of the design's "Done shopping" (Shanes Life 04 - Shopping.dc.html, 1j):
  // clears what's checked. Folding that into aisle-order pattern memory is a separate Feature.
  router.post("/api/lists/:id/clear-checked", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, await lists.clearCheckedItems(user.id, params.id));
  });

  // #3111: a real stated budget for this run. `budget` is dollars (a number, or null to clear)
  // -- informational only, per the issue's own scope: this never blocks addListItems above, it
  // just changes what getListDetail's real running total looks like against.
  router.patch("/api/lists/:id/budget", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    if (body.budget === undefined) throw badRequest("budget is required (a number, or null to clear)");
    const budgetCents = body.budget === null ? null : Math.round(Number(body.budget) * 100);
    if (budgetCents !== null && (!Number.isFinite(budgetCents) || budgetCents < 0)) {
      throw badRequest("budget must be a non-negative number or null");
    }
    return sendJson(res, 200, await lists.setListBudget(user.id, params.id, budgetCents));
  });

  // -- recipes (Git #3124, blocked_by #3088) -------------------------------
  //
  // "No separate recipe-authoring UI, no manual meal-planning calendar" (Section 5) -- the web
  // UI here only lists, matches, and lets Shane add missing ingredients or archive a recipe he
  // no longer wants; the real generation happens in a Claude conversation over MCP (push_recipes,
  // below in src/mcp/tools.mjs). createRecipe is still reachable directly (createdBy: 'shane')
  // for the rare case Shane wants to type one in himself.

  router.get("/api/recipes", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, { recipes: await recipes.listRecipesWithMatch(user.id) });
  });

  router.post("/api/recipes", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await recipes.createRecipe(user.id, { ...body, createdBy: "shane" });
    await audit.record({ userId: user.id, actor: "web", action: "recipe.create", entityId: row.id, detail: { name: row.name } });
    return sendJson(res, 201, row);
  });

  router.delete("/api/recipes/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    await recipes.archiveRecipe(user.id, params.id);
    await audit.record({ userId: user.id, actor: "web", action: "recipe.archive", entityId: params.id });
    return sendJson(res, 200, { ok: true });
  });

  // #3124's real scope item 3: the recipe's real currently-missing ingredients, pushed straight
  // onto the one real Shopping run -- same run push_list and the Shopping screen already write to.
  router.post("/api/recipes/:id/add-missing", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    const result = await recipes.addMissingIngredients(user.id, params.id);
    await audit.record({ userId: user.id, actor: "web", action: "recipe.add_missing", entityId: params.id, detail: { added: result.added } });
    return sendJson(res, 200, result);
  });

  // Section 5's real health context -- stated once, read by Claude (get_health_context, MCP)
  // before it generates recipes. Surfaced here too so the web UI (Settings) can show/edit it
  // without going through Claude every time.
  router.get("/api/health-context", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, { healthContext: await recipes.getHealthContext(user.id) });
  });

  router.patch("/api/health-context", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const healthContext = await recipes.setHealthContext(user.id, body.healthContext ?? null);
    await audit.record({ userId: user.id, actor: "web", action: "health_context.set" });
    return sendJson(res, 200, { healthContext });
  });

  // -- medications (Git #3135) ----------------------------------------------
  //
  // The batch-grouped Meds tray: GET returns today's real state (batches + taken-today status,
  // refills split into needs-you/handled). Swiping a batch complete or undoing it, marking a
  // manual-watch refill ordered, and basic CRUD for the medication list itself are all here so
  // the web UI is fully self-serve -- Claude's own MCP path (src/mcp/tools.mjs) is the
  // capture-grammar entry point ("took my morning meds"), not the only way in.

  router.get("/api/medications", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, await medications.getMedsToday(user.id));
  });

  router.post("/api/medications", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await medications.createMedication(user.id, body);
    await audit.record({ userId: user.id, actor: "web", action: "medication.create", entityId: row.id, detail: { name: row.name, batch: row.batch } });
    return sendJson(res, 201, row);
  });

  router.patch("/api/medications/:id", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await medications.updateMedication(user.id, params.id, body);
    await audit.record({ userId: user.id, actor: "web", action: "medication.update", entityId: params.id });
    return sendJson(res, 200, row);
  });

  router.delete("/api/medications/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    await medications.archiveMedication(user.id, params.id);
    await audit.record({ userId: user.id, actor: "web", action: "medication.archive", entityId: params.id });
    return sendJson(res, 200, { ok: true });
  });

  // "Ordered it" -- design screen 6's real manual-watch refill action.
  router.post("/api/medications/:id/ordered", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    const row = await medications.markMedicationOrdered(user.id, params.id);
    await audit.record({ userId: user.id, actor: "web", action: "medication.ordered", entityId: params.id, detail: { nextRefillOn: row.next_refill_on } });
    return sendJson(res, 200, row);
  });

  // Single swipe per batch (README non-negotiable) -- :batch is the batch name (morning,
  // evening, ...), not a medication id.
  router.post("/api/medications/batches/:batch/take", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    const row = await medications.markBatchTaken(user.id, params.batch, { source: "web" });
    await audit.record({ userId: user.id, actor: "web", action: "medication.batch_taken", detail: { batch: row.batch } });
    return sendJson(res, 200, row);
  });

  // Undo (Section 8's real 5s Undo pattern) -- clears today's swipe for this batch.
  router.delete("/api/medications/batches/:batch/take", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    await medications.unmarkBatchTaken(user.id, params.batch);
    await audit.record({ userId: user.id, actor: "web", action: "medication.batch_undo", detail: { batch: params.batch } });
    return sendJson(res, 200, { ok: true });
  });

  // -- meal plan (Git #3127, blocked_by #3124 and #3132) -------------------
  //
  // Section 5's real Sunday ritual: "no manual meal-planning calendar" holds here too -- this is
  // a real, read-only display of what Claude already pushed via push_meal_plan (MCP), plus the
  // one archive action to correct a bad push. There is no POST here on purpose; the app hosts
  // and displays the plan, it does not author it.

  router.get("/api/meal-plan", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, {
      entries: await mealPlan.listMealPlan(user.id, {
        from: ctx.url.searchParams.get("from"),
        to: ctx.url.searchParams.get("to"),
      }),
    });
  });

  router.delete("/api/meal-plan/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    await mealPlan.archiveMealPlanEntry(user.id, params.id);
    await audit.record({ userId: user.id, actor: "web", action: "meal_plan.archive", entityId: params.id });
    return sendJson(res, 200, { ok: true });
  });

  // -- per-store price history (Git #3112) ---------------------------------

  router.get("/api/stores", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, { stores: await prices.listStores(user.id) });
  });

  router.post("/api/stores", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    if (!body.name) throw badRequest("name is required");
    return sendJson(res, 201, await prices.getOrCreateStore(user.id, body.name));
  });

  // ?item= is the same normalised text saved with each price -- the Shopping room's own item
  // text, so "spaghetti sauce" pulls back every real observation ever logged for it.
  router.get("/api/prices", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const url = new URL(req.url, "http://internal");
    const item = url.searchParams.get("item");
    if (!item) throw badRequest("item query param is required");
    return sendJson(res, 200, { item, history: await prices.getPriceHistory(user.id, item) });
  });

  router.post("/api/prices", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await prices.recordPrice(user.id, {
      storeId: body.storeId ?? null,
      storeName: body.storeName ?? null,
      itemText: body.itemText,
      priceCents: body.priceCents,
      observedOn: body.observedOn ?? null,
      note: body.note ?? null,
      source: "shane",
    });
    await audit.record({
      userId: user.id,
      actor: "owner",
      action: "price.record",
      detail: { itemText: row.item_text, storeName: row.store_name, priceCents: row.price_cents },
    });
    return sendJson(res, 201, row);
  });

  // Barcode scan (Git #3109): resolve a real scanned barcode against this real list before
  // asking Shane for a price -- exact / near / unknown, per the design's own three-state
  // grammar. Read-only; never a silent failure -- "unknown" is a real, valid response, not an
  // error.
  router.post("/api/lists/:id/scan/lookup", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    return sendJson(res, 200, await scan.lookupBarcode(user.id, params.id, body.barcode));
  });

  // Saves the real typed price, links the barcode for next time, and checks the item off --
  // "Saving also checks the item off" per the design copy. Also feeds the real per-store price
  // history (Git #3122, fixing the #3109/#3112 gap this route's own prior note described) --
  // scan.saveScan() itself infers the store from the run's existing `lists.store` (#3108,
  // "Which store?" above the list) rather than asking again here, per the design's own "Shane
  // only types the price" copy for this screen.
  router.post("/api/lists/:id/scan/save", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const result = await scan.saveScan(user.id, params.id, {
      barcode: body.barcode,
      itemId: body.itemId ?? null,
      text: body.text ?? null,
      priceCents: body.priceCents,
    });
    await audit.record({
      userId: user.id,
      actor: "web",
      action: "list.item.scan",
      entityId: params.id,
      detail: { barcode: body.barcode, itemId: result.item.id, priceCents: result.item.price_cents },
    });
    return sendJson(res, 200, result);
  });

  // -- money (Git #3137) ---------------------------------------------------
  //
  // Every number here comes out of ShanesSurvival's own real tables in the SAME real Postgres
  // (#3107) and through the math ported from its own DashboardService.cs -- see
  // src/core/money.mjs. Reads only: the one endpoint that talks about moving money simulates it
  // and says so in its own response body, because Plaid is read-only and NFCU has no Transfer
  // product.

  router.get("/api/money/gate", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, await money.getGateStatus(user.id));
  });

  router.get("/api/money/budget-day", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, { budgetDay: await money.getBudgetDay(user.id) });
  });

  // GET, not POST: a what-if changes nothing, and a shareable/refreshable URL is the right shape
  // for a question that is pure arithmetic over current balances.
  router.get("/api/money/what-if", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const url = new URL(req.url, "http://internal");
    return sendJson(res, 200, await money.whatIf(user.id, url.searchParams.get("amount")));
  });

  // POST despite never writing anything: the request carries three real fields and reads far
  // better as a body than a query string. `executed: false` in every response is structural --
  // there is no code path in this app that can move real money.
  router.post("/api/money/simulate-transfer", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const result = await money.simulateTransfer(user.id, {
      amount: body.amount,
      from: body.from,
      to: body.to,
    });
    await audit.record({
      userId: user.id,
      actor: "web",
      action: "money.transfer.simulated",
      detail: { amount: body.amount, from: body.from, to: body.to, resolvable: result.resolvable },
    });
    return sendJson(res, 200, result);
  });

  router.get("/api/money/habits", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, { habits: await money.listHabits(user.id, { includeInactive: true }) });
  });

  // The only real write in this section, and it writes to Shane's Life's own table (026), never
  // to a ShanesSurvival one.
  router.patch("/api/money/habits", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await money.setHabit(user.id, body);
    await audit.record({
      userId: user.id,
      actor: "owner",
      action: "money.habit.set",
      entityId: row.id,
      detail: { name: row.name, amountPerCycle: row.amount_per_cycle, isActive: row.is_active },
    });
    return sendJson(res, 200, row);
  });

  // -- Money -> Vault (Git #3150) -------------------------------------------------------
  //
  // The bill-payment reference vault. Design contract Section 9 flags this as "a real security
  // requirement, not optional polish", and the handoff README's own §7 line is the spec these
  // routes implement: "rows with site + masked reference + Reveal (passkey overlay -> full value
  // shown 20 s -> Copy)". src/core/vault.mjs owns the AES-256-GCM and the audit write; what
  // lives here is the part that cannot live there -- the real WebAuthn assertion.
  //
  // The reveal is deliberately TWO requests carrying one assertion, not a check against
  // `sessions.last_verified_at`. Gating on the session's last-verified stamp would make one
  // assertion good for every entry inside a window, which is precisely the "not just session
  // presence" the issue rules out. Instead the challenge is issued per entry
  // (purpose `vault:reveal:<id>`), so an assertion obtained for one row cannot reveal another,
  // and `consumeChallenge`'s atomic UPDATE ... WHERE consumed_at IS NULL means it cannot be
  // replayed to reveal the same row twice either.

  const VAULT_REVEAL_LIMIT = { limit: 30, windowMs: 60 * 60 * 1000 };

  /** VaultKeyUnavailable is a real deployment fact (no SL_VAULT_KEY), not a bad request -- 503
   *  says "this feature cannot work right now" rather than blaming the caller. */
  function vaultError(err) {
    if (err instanceof vault.VaultKeyUnavailable) return new HttpError(503, err.message);
    return err;
  }

  router.get("/api/vault", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, {
      // Masked rows only -- listEntries has no plaintext path at all, by design.
      entries: await vault.listEntries(user.id),
      // The room says so out loud rather than failing at the first Reveal tap.
      keyConfigured: vault.keyIsConfigured(),
      windowSeconds: vault.REVEAL_WINDOW_SECONDS,
      clipboardClearSeconds: vault.CLIPBOARD_CLEAR_SECONDS,
    });
  });

  router.post("/api/vault", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    if (!body.label) throw badRequest("label is required");
    if (!body.secret) throw badRequest("secret is required");
    let entry;
    try {
      entry = await vault.createEntry(user.id, body);
    } catch (err) {
      throw vaultError(err);
    }
    // The detail column is a real audit trail, so it carries what the row IS, never what it
    // holds -- no secret, and not even the masked hint's digits.
    await audit.record({
      userId: user.id,
      actor: "owner",
      action: "vault.entry.created",
      entityId: entry.id,
      detail: { label: entry.label, site: entry.site },
    });
    return sendJson(res, 201, entry);
  });

  router.patch("/api/vault/:id", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    let entry;
    try {
      entry = await vault.updateEntry(user.id, params.id, body);
    } catch (err) {
      throw vaultError(err);
    }
    if (!entry) throw notFound("Vault entry not found");
    await audit.record({
      userId: user.id,
      actor: "owner",
      action: "vault.entry.updated",
      entityId: entry.id,
      detail: { label: entry.label, site: entry.site, secretChanged: Boolean(body.secret) },
    });
    return sendJson(res, 200, entry);
  });

  router.delete("/api/vault/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    const removed = await vault.deleteEntry(user.id, params.id);
    if (!removed) throw notFound("Vault entry not found");
    await audit.record({
      userId: user.id,
      actor: "owner",
      action: "vault.entry.deleted",
      entityId: params.id,
      detail: {},
    });
    return sendJson(res, 200, { ok: true });
  });

  // Step 1 of a reveal: a challenge bound to THIS entry. Issued only for an entry the caller
  // actually owns, so a probe cannot use this to learn which ids exist.
  router.post("/api/vault/:id/reveal/options", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    const owned = (await vault.listEntries(user.id)).some((e) => e.id === params.id);
    if (!owned) throw notFound("Vault entry not found");

    const credentialList = await credentials.listCredentials(user.id);
    if (credentialList.length === 0) {
      throw forbidden("No passkey is enrolled, and a reveal requires one every time.");
    }
    return sendJson(res, 200, {
      challenge: await webauthn.issueChallenge(`vault:reveal:${params.id}`, user.id),
      rpId: webauthn.relyingPartyId(),
      timeout: webauthn.CHALLENGE_TTL_SECONDS * 1000,
      userVerification: "required",
      allowCredentials: credentialList.map((c) => ({
        type: "public-key",
        id: c.credential_id,
        transports: c.transports,
      })),
    });
  });

  // Step 2: the assertion itself. Nothing decrypts until this verifies.
  router.post("/api/vault/:id/reveal", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const gate = ratelimit.hit(`vault:reveal:${user.id}`, VAULT_REVEAL_LIMIT.limit, VAULT_REVEAL_LIMIT.windowMs);
    if (!gate.allowed) {
      throw tooMany("Too many reveals in a row. Wait a bit.", { retryAfterMs: gate.retryAfterMs });
    }

    const body = await readJson(req);
    const consumed = await webauthn.consumeChallenge(body.challenge, `vault:reveal:${params.id}`);
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
      if (!config.isProduction) console.error("[vault] reveal refused:", err.message);
      throw unauthorized("That passkey check did not pass.");
    }

    await credentials.touchCredential(credential.credential_id, verified.signCount, verified.backedUp);
    // A reveal is also a genuine proof of presence, so the session's own stamp moves with it --
    // but note the reveal did NOT read that stamp to decide whether to proceed.
    await markSessionVerified(ctx.sessionToken, credential.credential_id);

    let revealed;
    try {
      revealed = await vault.reveal(user.id, params.id, {
        credentialId: credential.credential_id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
    } catch (err) {
      throw vaultError(err);
    }
    if (!revealed) throw notFound("Vault entry not found");

    // vault_reveals is the real audit row (written inside vault.reveal's own transaction); this
    // second line is the app-wide activity feed, and carries no plaintext either.
    await audit.record({
      userId: user.id,
      actor: "owner",
      action: "vault.revealed",
      entityId: revealed.id,
      detail: { label: revealed.label, site: revealed.site, credentialId: credential.credential_id },
    });
    return sendJson(res, 200, revealed);
  });

  router.get("/api/vault/:id/reveals", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, { reveals: await vault.revealHistory(user.id, params.id) });
  });

  // -- Money -> Cars (Git #3149) --------------------------------------------------------
  //
  // Real per-vehicle cards: identity + the linked real loan bill account (read through
  // src/core/vehicles.mjs, never duplicated) + insurance/registration/maintenance, aggregated
  // into a real all-in $/mo and $/yr. See vehicles.mjs's own header for exactly what each
  // component means and why. Reminders reuse Dates' own lead-time vocabulary rather than a
  // second copy of it.

  router.get("/api/cars", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, { vehicles: await vehicles.listVehicles(user.id) });
  });

  router.post("/api/cars", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await vehicles.createVehicle(user.id, body);
    await audit.record({ userId: user.id, actor: "web", action: "vehicle.create", entityId: row.id, detail: { name: row.name } });
    return sendJson(res, 201, row);
  });

  router.get("/api/cars/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, await vehicles.getVehicle(user.id, params.id));
  });

  router.patch("/api/cars/:id", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await vehicles.updateVehicle(user.id, params.id, body);
    await audit.record({ userId: user.id, actor: "web", action: "vehicle.update", entityId: params.id, detail: { fields: Object.keys(body) } });
    return sendJson(res, 200, row);
  });

  router.delete("/api/cars/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    await vehicles.deleteVehicle(user.id, params.id);
    await audit.record({ userId: user.id, actor: "web", action: "vehicle.delete", entityId: params.id });
    return sendJson(res, 200, { ok: true });
  });

  router.post("/api/cars/:id/maintenance", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await vehicles.logMaintenance(user.id, params.id, body);
    await audit.record({
      userId: user.id,
      actor: "web",
      action: "vehicle.maintenance.log",
      entityId: params.id,
      detail: { description: body.description, amount: body.amount },
    });
    return sendJson(res, 201, row);
  });

  // -- Wins (Git #3151) -----------------------------------------------------
  //
  // Manual "I did it" capture straight from the Wins tab (source: 'shane') -- distinct from the
  // universal capture box's classify-later pipeline, because Wins is a fixed real category, not
  // one Claude needs to pick. Automatic wins (a real debt hitting $0, a critical debt resolved, a
  // deferred bill caught up) are detected server-side (see src/core/wins.mjs detectMoneyWins,
  // wired into server.mjs housekeeping) and read back through the same GET.

  router.get("/api/money/wins", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, { wins: await wins.listWins(user.id) });
  });

  router.post("/api/money/wins", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await wins.createWin(user.id, { text: body.text, happenedOn: body.happenedOn ?? null, source: "shane" });
    await audit.record({ userId: user.id, actor: "web", action: "win.create", entityId: row.id, detail: { text: row.text } });
    return sendJson(res, 200, row);
  });

  // -- Dates (Git #3136) ----------------------------------------------------------------

  router.get("/api/dates", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const q = ctx.url.searchParams;
    return sendJson(res, 200, {
      dates: await dates.listDates(user.id, {
        includeDone: q.get("includeDone") === "true",
        horizonDays: q.get("horizonDays") ? Number(q.get("horizonDays")) : undefined,
      }),
    });
  });

  router.post("/api/dates", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await dates.createDate({
      userId: user.id,
      kind: body.kind,
      title: body.title,
      atDate: body.atDate,
      atTime: body.atTime ?? null,
      intervalDays: body.intervalDays ?? null,
      leadDays: body.leadDays ?? undefined,
      provider: body.provider ?? null,
      subjectType: body.subjectType || "self",
      subjectId: body.subjectId ?? null,
      category: body.category ?? null,
      categoryMeta: body.categoryMeta || {},
      source: "web",
      notes: body.notes ?? null,
    });
    await audit.record({ userId: user.id, actor: "web", action: "date.create", entityId: row.id, detail: { kind: row.kind } });
    return sendJson(res, 201, row);
  });

  router.get("/api/dates/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    const row = await dates.getDate(user.id, params.id);
    if (!row) throw notFound("Date not found");
    return sendJson(res, 200, row);
  });

  router.patch("/api/dates/:id", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await dates.updateDate(user.id, params.id, body);
    await audit.record({ userId: user.id, actor: "web", action: "date.update", entityId: params.id, detail: { fields: Object.keys(body) } });
    return sendJson(res, 200, row);
  });

  router.delete("/api/dates/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    await dates.deleteDate(user.id, params.id);
    await audit.record({ userId: user.id, actor: "web", action: "date.delete", entityId: params.id });
    return sendJson(res, 200, { ok: true });
  });

  // "next time at dr fonji ask about ..."
  router.post("/api/dates/:id/asks", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await dates.addAsk(user.id, params.id, body.text);
    await audit.record({ userId: user.id, actor: "web", action: "date.ask.add", entityId: params.id });
    return sendJson(res, 201, row);
  });

  // Tapping "Asked" on the date-detail screen -- clears back to unasked with { asked: false }.
  router.patch("/api/dates/:id/asks/:askId", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await dates.setAskAsked(user.id, params.id, params.askId, body.asked !== false);
    return sendJson(res, 200, row);
  });

  // "Notes and photos, by visit."
  router.post("/api/dates/:id/visits", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await dates.addVisit(user.id, params.id, {
      visitedOn: body.visitedOn ?? null,
      notes: body.notes ?? null,
      photos: body.photos || [],
    });
    await audit.record({ userId: user.id, actor: "web", action: "date.visit.add", entityId: params.id });
    return sendJson(res, 201, row);
  });

  router.post("/api/dates/:id/visits/:visitId/photos", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await dates.addVisitPhoto(user.id, params.id, params.visitId, {
      mediaId: body.mediaId ?? null,
      url: body.url ?? null,
      label: body.label ?? null,
    });
    return sendJson(res, 201, row);
  });

  // -- pets (Git #3141) -------------------------------------------------------------------
  // Vet visits stay on /api/dates (subjectType: 'pet'); this is real per-pet identity, vaccine
  // tracking, feeding/meds care items (merged into /api/medications), and photo records.

  router.get("/api/pets", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, { pets: await pets.listPets(user.id) });
  });

  router.post("/api/pets", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await pets.createPet(user.id, body);
    await audit.record({ userId: user.id, actor: "web", action: "pet.create", entityId: row.id, detail: { name: row.name } });
    return sendJson(res, 201, row);
  });

  router.get("/api/pets/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    const row = await pets.getPet(user.id, params.id);
    if (!row) throw notFound("Pet not found");
    return sendJson(res, 200, row);
  });

  router.patch("/api/pets/:id", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await pets.updatePet(user.id, params.id, body);
    await audit.record({ userId: user.id, actor: "web", action: "pet.update", entityId: params.id, detail: { fields: Object.keys(body) } });
    return sendJson(res, 200, row);
  });

  router.delete("/api/pets/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    await pets.deletePet(user.id, params.id);
    await audit.record({ userId: user.id, actor: "web", action: "pet.delete", entityId: params.id });
    return sendJson(res, 200, { ok: true });
  });

  router.post("/api/pets/:id/vaccines", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await pets.createVaccine(user.id, params.id, body);
    await audit.record({ userId: user.id, actor: "web", action: "pet.vaccine.create", entityId: row.id, detail: { petId: params.id, name: row.name } });
    return sendJson(res, 201, row);
  });

  router.patch("/api/pets/:id/vaccines/:vaccineId", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await pets.updateVaccine(user.id, params.id, params.vaccineId, body);
    await audit.record({ userId: user.id, actor: "web", action: "pet.vaccine.update", entityId: params.vaccineId });
    return sendJson(res, 200, row);
  });

  router.post("/api/pets/:id/vaccines/:vaccineId/given", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req).catch(() => ({}));
    const row = await pets.markVaccineGiven(user.id, params.id, params.vaccineId, { givenOn: body.givenOn ?? undefined });
    await audit.record({ userId: user.id, actor: "web", action: "pet.vaccine.given", entityId: params.vaccineId, detail: { dueOn: row.due_on } });
    return sendJson(res, 200, row);
  });

  router.delete("/api/pets/:id/vaccines/:vaccineId", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    await pets.deleteVaccine(user.id, params.id, params.vaccineId);
    await audit.record({ userId: user.id, actor: "web", action: "pet.vaccine.delete", entityId: params.vaccineId });
    return sendJson(res, 200, { ok: true });
  });

  router.post("/api/pets/:id/care", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await pets.createCare(user.id, params.id, body);
    await audit.record({ userId: user.id, actor: "web", action: "pet.care.create", entityId: row.id, detail: { petId: params.id, batch: row.batch } });
    return sendJson(res, 201, row);
  });

  router.patch("/api/pets/:id/care/:careId", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await pets.updateCare(user.id, params.id, params.careId, body);
    await audit.record({ userId: user.id, actor: "web", action: "pet.care.update", entityId: params.careId });
    return sendJson(res, 200, row);
  });

  router.delete("/api/pets/:id/care/:careId", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    await pets.deleteCare(user.id, params.id, params.careId);
    await audit.record({ userId: user.id, actor: "web", action: "pet.care.delete", entityId: params.careId });
    return sendJson(res, 200, { ok: true });
  });

  router.post("/api/pets/:id/records", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await pets.addRecord(user.id, params.id, body);
    await audit.record({ userId: user.id, actor: "web", action: "pet.record.add", entityId: row.id, detail: { petId: params.id } });
    return sendJson(res, 201, row);
  });

  router.delete("/api/pets/:id/records/:recordId", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    await pets.deleteRecord(user.id, params.id, params.recordId);
    await audit.record({ userId: user.id, actor: "web", action: "pet.record.delete", entityId: params.recordId });
    return sendJson(res, 200, { ok: true });
  });

  // Read-only surface for the real, live-refreshed OPM federal holiday list.
  router.get("/api/federal-holidays", async (_req, res, _params, ctx) => {
    requireUser(ctx);
    const q = ctx.url.searchParams;
    return sendJson(res, 200, {
      holidays: await federalHolidays.listFederalHolidays({ fromYear: q.get("fromYear") ? Number(q.get("fromYear")) : undefined }),
    });
  });

  // Manual trigger for the real OPM refresh -- the monthly housekeeping sweep in server.mjs
  // calls the same core function; this exists so a stale list never has to wait for a redeploy.
  router.post("/api/federal-holidays/refresh", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const result = await federalHolidays.refreshFederalHolidays();
    await audit.record({ userId: user.id, actor: "web", action: "federal_holidays.refresh", detail: result });
    return sendJson(res, 200, result);
  });

  // -- today / categories / activity --------------------------------------

  router.get("/api/today", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    // #3127's real moment-based meal nudges + "Tonight" teaser -- read off whatever Claude
    // pushed via push_meal_plan for today/tomorrow, never a calendar to browse.
    const { nudges: mealNudges, tonight } = await mealPlan.getTodayNudges(user.id);

    // Today tray Round 2 (Git #3144) -- the real "one card, chosen by rule" Next resolution and
    // the fox's contextual line both need to know: is there a real appointment/vet visit today,
    // and are there real open items on the running grocery list. Both are real, already-built
    // data (dates.mjs's own due_in_days, lists.mjs's own shopping list) -- no new tables.
    const allDates = await dates.listDates(user.id);
    const appointmentToday = allDates.find(
      (d) => (d.kind === "appointment" || d.kind === "vet") && d.due_in_days === 0,
    ) || null;
    const shoppingList = await lists.getOrCreateShoppingList(user.id);
    const shoppingDetail = await lists.getListDetail(user.id, shoppingList.id);
    const groceries = {
      listId: shoppingList.id,
      openCount: shoppingDetail.items.filter((i) => !i.done).length,
    };

    return sendJson(res, 200, {
      // "Today view shows only what's next" (contract pack Section 3) -- three, not a backlog.
      next: await entities.nextUp(user.id, 3),
      pendingCaptures: await captures.pendingCount(user.id),
      recent: await entities.listEntities(user.id, { limit: 8 }),
      mealNudges,
      tonight,
      appointmentToday: appointmentToday && {
        id: appointmentToday.id,
        kind: appointmentToday.kind,
        title: appointmentToday.title,
        provider: appointmentToday.provider,
        atTime: appointmentToday.at_time,
        categoryLabel: appointmentToday.category_label,
      },
      groceries,
      meds: await medications.getMedsToday(user.id),
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
      shares: await shares.listShareLinks(user.id, {
        entityId: ctx.url.searchParams.get("entityId"),
        listId: ctx.url.searchParams.get("listId"),
      }),
    });
  });

  router.post("/api/shares", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    if (!body.entityId && !body.listId) throw badRequest("entityId or listId is required");
    const share = await shares.createShareLink({
      userId: user.id,
      entityId: body.entityId ?? null,
      listId: body.listId ?? null,
      label: body.label ?? null,
      canCheck: body.canCheck !== false,
      expiresInDays: body.expiresInDays ?? null,
    });
    await audit.record({
      userId: user.id,
      actor: "web",
      action: "share.create",
      entityId: body.entityId ?? body.listId ?? null,
      detail: { shareId: share.id, kind: body.listId ? "list" : "entity" },
    });
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
