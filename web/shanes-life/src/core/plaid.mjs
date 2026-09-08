// Real Plaid item health, webhooks, and reconnect (Git #3168).
//
// What this module is NOT: a second Plaid sync. ShanesSurvival's WPF app already owns the real
// incremental /transactions/sync (cursor-persisted, migration 002) into the same real tables this
// app reads, and duplicating it here would give two writers one cursor. Nothing in this file
// fetches a transaction or a balance.
//
// What it IS: the two real gaps neither app had. (1) A webhook receiver, because item health --
// ITEM_LOGIN_REQUIRED, PENDING_EXPIRATION -- was previously only ever discovered by a sync
// failing, and a desktop app that is not running discovers nothing. (2) The update-mode Link
// flow that fixes it, ported from Finance-Tracker's real implementation.
//
// Credentials come from the environment and are never logged. Plaid puts client_id/secret in the
// request body rather than a header (matching PlaidClient.cs, which is the proven shape here).

import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto";
import { config } from "../config.mjs";
import { many, one, query } from "../db.mjs";

/** Plaid retired "development" as a separate host in 2023 -- only sandbox has its own base URL. */
export function plaidBaseUrl() {
  return String(config.plaidEnv || "").toLowerCase() === "sandbox"
    ? "https://sandbox.plaid.com"
    : "https://production.plaid.com";
}

export function plaidConfigured() {
  return Boolean(config.plaidClientId && config.plaidSecret);
}

export class PlaidError extends Error {
  constructor(message, { code = null, status = null, requestId = null } = {}) {
    super(message);
    this.name = "PlaidError";
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

/**
 * One real Plaid POST. `body` is merged with the credentials here rather than at every call site,
 * so no caller can accidentally build a request that logs or forwards the secret.
 */
async function plaidPost(path, body, { timeoutMs = 30_000 } = {}) {
  if (!plaidConfigured()) {
    throw new PlaidError(
      "Plaid is not configured on this server. Set SL_PLAID_CLIENT_ID and SL_PLAID_SECRET.",
      { code: "NOT_CONFIGURED" },
    );
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${plaidBaseUrl()}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: config.plaidClientId,
        secret: config.plaidSecret,
        ...body,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    throw new PlaidError(`Could not reach Plaid: ${err.message}`, { code: "NETWORK" });
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new PlaidError(`Plaid returned a non-JSON response (HTTP ${res.status}).`, { status: res.status });
  }

  if (!res.ok) {
    throw new PlaidError(json?.error_message || `Plaid returned HTTP ${res.status}.`, {
      code: json?.error_code ?? null,
      status: res.status,
      requestId: json?.request_id ?? null,
    });
  }
  return json;
}

// ---------------------------------------------------------------------------------------------
// Real Plaid calls this app genuinely needs
// ---------------------------------------------------------------------------------------------

/** The real webhook URL Plaid should call. Derived, never stored in two places. */
export function webhookUrl() {
  return `${config.publicOrigin}/api/plaid/webhook`;
}

/**
 * Plaid will only ever deliver to a publicly-reachable HTTPS endpoint, so a localhost origin is a
 * real, statable reason registration cannot happen -- not something to attempt and let fail with
 * a confusing Plaid error.
 */
export function webhookUrlIsDeliverable(url = webhookUrl()) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    return !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

/** Real /item/get -- the authoritative current state of one item, including its live error. */
export async function fetchItemStatus(accessToken) {
  const json = await plaidPost("/item/get", { access_token: accessToken });
  return {
    itemId: json?.item?.item_id ?? null,
    institutionId: json?.item?.institution_id ?? null,
    webhook: json?.item?.webhook ?? null,
    consentExpirationTime: json?.item?.consent_expiration_time ?? null,
    error: json?.item?.error ?? null,
    status: json?.status ?? null,
  };
}

/** Real /institutions/get_by_id, used only to put a human name on a reconnected item. */
export async function fetchInstitutionName(institutionId) {
  const json = await plaidPost("/institutions/get_by_id", {
    institution_id: institutionId,
    country_codes: ["US"],
  });
  return json?.institution?.name ?? null;
}

/** Real /item/webhook/update -- points an already-linked item at this app's receiver. */
export async function setItemWebhook(accessToken, url = webhookUrl()) {
  const json = await plaidPost("/item/webhook/update", { access_token: accessToken, webhook: url });
  return json?.item?.webhook ?? url;
}

/**
 * Real /link/token/create in UPDATE MODE. Passing `access_token` instead of `products` is what
 * makes Link re-authenticate an existing item rather than create a new one -- so the item id and
 * the access token both survive, and ShanesSurvival's stored cursor keeps working afterwards.
 */
export async function createUpdateLinkToken(accessToken, { clientUserId, redirectUri = config.plaidRedirectUri }) {
  const body = {
    user: { client_user_id: clientUserId },
    client_name: "Shane's Life",
    language: "en",
    country_codes: ["US"],
    access_token: accessToken,
  };
  if (webhookUrlIsDeliverable()) body.webhook = webhookUrl();
  // Only sent when it is genuinely registered in the Plaid dashboard -- an unregistered
  // redirect_uri is rejected outright, so the env var's presence is the proof of registration.
  if (redirectUri) body.redirect_uri = redirectUri;
  const json = await plaidPost("/link/token/create", body);
  return { linkToken: json.link_token, expiration: json.expiration ?? null };
}

// ---------------------------------------------------------------------------------------------
// Real webhook verification (Plaid-Verification: a JWS the sender signs with ES256)
// ---------------------------------------------------------------------------------------------

const verificationKeyCache = new Map(); // kid -> JWK

function b64urlToBuffer(value) {
  return Buffer.from(String(value).replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

async function fetchVerificationKey(keyId) {
  const cached = verificationKeyCache.get(keyId);
  if (cached) return cached;
  const json = await plaidPost("/webhook_verification_key/get", { key_id: keyId });
  const key = json?.key;
  if (!key || key.kty !== "EC" || key.crv !== "P-256") {
    throw new PlaidError("Plaid returned an unusable webhook verification key.", { code: "BAD_KEY" });
  }
  verificationKeyCache.set(keyId, key);
  return key;
}

/**
 * Verify a real Plaid webhook. Returns { ok, reason } rather than throwing, because the caller
 * has to record the rejection as a real event either way -- a webhook that failed verification is
 * exactly the thing worth being able to look at afterwards.
 *
 * Deliberately fails closed: no signature header, wrong algorithm, stale timestamp, or a body
 * whose hash does not match the signed claim all mean "not Plaid", and nothing is applied.
 */
export async function verifyWebhook(signedJwt, rawBody, { now = Date.now(), fetchKey = fetchVerificationKey } = {}) {
  if (!signedJwt) return { ok: false, reason: "Missing Plaid-Verification header" };

  const parts = String(signedJwt).split(".");
  if (parts.length !== 3) return { ok: false, reason: "Malformed Plaid-Verification JWT" };
  const [headerB64, payloadB64, signatureB64] = parts;

  let header;
  try {
    header = JSON.parse(b64urlToBuffer(headerB64).toString("utf8"));
  } catch {
    return { ok: false, reason: "Unreadable JWT header" };
  }
  // Pinned to ES256 on purpose: accepting whatever `alg` the token names is the classic JWT
  // downgrade, and "none" would make the whole check decorative.
  if (header.alg !== "ES256") return { ok: false, reason: `Unexpected JWT alg ${header.alg}` };
  if (!header.kid) return { ok: false, reason: "JWT header has no kid" };

  let jwk;
  try {
    jwk = await fetchKey(header.kid);
  } catch (err) {
    return { ok: false, reason: `Could not fetch verification key: ${err.message}` };
  }

  let publicKey;
  try {
    publicKey = createPublicKey({ key: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y }, format: "jwk" });
  } catch (err) {
    return { ok: false, reason: `Unusable verification key: ${err.message}` };
  }

  // A JWS ES256 signature is raw r||s, not the DER encoding Node defaults to.
  let signatureValid = false;
  try {
    signatureValid = cryptoVerify(
      "sha256",
      Buffer.from(`${headerB64}.${payloadB64}`, "ascii"),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      b64urlToBuffer(signatureB64),
    );
  } catch (err) {
    return { ok: false, reason: `Signature check failed: ${err.message}` };
  }
  if (!signatureValid) return { ok: false, reason: "JWT signature did not verify" };

  let claims;
  try {
    claims = JSON.parse(b64urlToBuffer(payloadB64).toString("utf8"));
  } catch {
    return { ok: false, reason: "Unreadable JWT claims" };
  }

  // Plaid's own documented replay window.
  const ageSeconds = now / 1000 - Number(claims.iat || 0);
  if (!Number.isFinite(ageSeconds) || ageSeconds > 5 * 60) {
    return { ok: false, reason: "Webhook timestamp is older than 5 minutes" };
  }

  const bodyHash = createHash("sha256").update(rawBody).digest("hex");
  if (bodyHash !== claims.request_body_sha256) {
    return { ok: false, reason: "Body hash does not match the signed claim" };
  }

  return { ok: true, reason: null, claims };
}

// ---------------------------------------------------------------------------------------------
// Real item-health store
// ---------------------------------------------------------------------------------------------

export const HEALTH_OK = "ok";
export const HEALTH_LOGIN_REQUIRED = "login_required";
export const HEALTH_PENDING_EXPIRATION = "pending_expiration";
export const HEALTH_PENDING_DISCONNECT = "pending_disconnect";
export const HEALTH_REVOKED = "revoked";
export const HEALTH_ERROR = "error";

/** Statuses that a reconnect (update-mode Link) genuinely fixes. */
const RECONNECTABLE = new Set([
  HEALTH_LOGIN_REQUIRED,
  HEALTH_PENDING_EXPIRATION,
  HEALTH_PENDING_DISCONNECT,
  HEALTH_REVOKED,
]);

export function healthFromErrorCode(errorCode) {
  if (!errorCode) return HEALTH_OK;
  if (errorCode === "ITEM_LOGIN_REQUIRED" || errorCode === "ITEM_LOCKED" || errorCode === "USER_SETUP_REQUIRED") {
    return HEALTH_LOGIN_REQUIRED;
  }
  if (errorCode === "PENDING_EXPIRATION") return HEALTH_PENDING_EXPIRATION;
  if (errorCode === "PENDING_DISCONNECT") return HEALTH_PENDING_DISCONNECT;
  if (errorCode === "USER_PERMISSION_REVOKED" || errorCode === "USER_ACCOUNT_REVOKED") return HEALTH_REVOKED;
  return HEALTH_ERROR;
}

export function isReconnectable(status) {
  return RECONNECTABLE.has(status);
}

/** The one place a health status becomes a sentence a human reads. */
export function healthHeadline(item) {
  switch (item.health) {
    case HEALTH_LOGIN_REQUIRED:
      return `${item.institutionName} needs you to sign in again`;
    case HEALTH_PENDING_EXPIRATION:
      return `${item.institutionName} access expires soon`;
    case HEALTH_PENDING_DISCONNECT:
      return `${item.institutionName} is about to disconnect`;
    case HEALTH_REVOKED:
      return `${item.institutionName} access was revoked`;
    case HEALTH_ERROR:
      return `${item.institutionName} hit an error`;
    default:
      return `${item.institutionName} is connected`;
  }
}

function itemShape(row) {
  return {
    id: row.id,
    plaidItemId: row.plaid_item_id,
    institutionName: row.institution_name,
    connectedAt: row.created_at,
    lastSyncedAt: row.last_synced_at,
    health: row.health_status,
    healthCode: row.health_code,
    healthMessage: row.health_message,
    healthChangedAt: row.health_changed_at,
    consentExpiresAt: row.consent_expires_at,
    webhookUrl: row.webhook_url,
    webhookRegisteredAt: row.webhook_registered_at,
    lastWebhookAt: row.last_webhook_at,
    transactionsPendingSince: row.transactions_pending_since,
    reconnectedAt: row.reconnected_at,
    needsReconnect: isReconnectable(row.health_status),
    accountCount: Number(row.account_count ?? 0),
    // The receiver cannot be registered against a localhost origin, and an item with no webhook
    // registered will never report its own health. Saying so is the difference between a screen
    // that looks fine and one that is honest about why it is quiet.
    webhookDeliverable: webhookUrlIsDeliverable(),
  };
}

export async function listItems() {
  const rows = await many(
    `SELECT i.*, (SELECT count(*) FROM accounts a WHERE a.plaid_item_id = i.id) AS account_count
       FROM plaid_items i
      ORDER BY i.institution_name`,
  );
  return rows.map(itemShape);
}

export async function getItemRow(id) {
  return one(
    `SELECT i.*, (SELECT count(*) FROM accounts a WHERE a.plaid_item_id = i.id) AS account_count
       FROM plaid_items i WHERE i.id = $1`,
    [id],
  );
}

export async function getItem(id) {
  const row = await getItemRow(id);
  return row ? itemShape(row) : null;
}

/**
 * Write a real health state onto an item. Returns whether it genuinely CHANGED, because that is
 * what decides whether a nudge fires -- Plaid repeats webhooks, and a repeat is not news.
 */
export async function applyHealth(itemId, { status, code = null, message = null, consentExpiresAt = null }) {
  const before = await one("SELECT health_status, health_code FROM plaid_items WHERE id = $1", [itemId]);
  if (!before) return { changed: false, previous: null };

  const changed = before.health_status !== status || (before.health_code ?? null) !== (code ?? null);
  await query(
    `UPDATE plaid_items
        SET health_status = $2,
            health_code = $3,
            health_message = $4,
            health_changed_at = CASE WHEN $5 THEN now() ELSE health_changed_at END,
            consent_expires_at = COALESCE($6::timestamptz, consent_expires_at)
      WHERE id = $1`,
    [itemId, status, code, message, changed, consentExpiresAt],
  );
  return { changed, previous: before.health_status };
}

/** Record one real webhook, verified or not, exactly as it arrived. */
export async function recordWebhookEvent({
  itemId = null,
  plaidItemId = null,
  webhookType,
  webhookCode,
  errorCode = null,
  errorMessage = null,
  payload,
  verified,
  applied = false,
  note = null,
}) {
  return one(
    `INSERT INTO plaid_webhook_events
       (item_id, plaid_item_id, webhook_type, webhook_code, error_code, error_message, payload, verified, applied, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)
     RETURNING *`,
    [
      itemId,
      plaidItemId,
      webhookType,
      webhookCode,
      errorCode,
      errorMessage,
      JSON.stringify(payload ?? {}),
      verified,
      applied,
      note,
    ],
  );
}

export async function listWebhookEvents({ itemId = null, limit = 50 } = {}) {
  const rows = itemId
    ? await many(
        `SELECT * FROM plaid_webhook_events WHERE item_id = $1 ORDER BY received_at DESC LIMIT $2`,
        [itemId, limit],
      )
    : await many(`SELECT * FROM plaid_webhook_events ORDER BY received_at DESC LIMIT $1`, [limit]);
  return rows.map((r) => ({
    id: r.id,
    itemId: r.item_id,
    plaidItemId: r.plaid_item_id,
    type: r.webhook_type,
    code: r.webhook_code,
    errorCode: r.error_code,
    errorMessage: r.error_message,
    receivedAt: r.received_at,
    verified: r.verified,
    applied: r.applied,
    note: r.note,
  }));
}

export async function findItemByPlaidItemId(plaidItemId) {
  return one("SELECT * FROM plaid_items WHERE plaid_item_id = $1", [plaidItemId]);
}

/**
 * Ask Plaid directly what an item's real state is and write it down. This is the path that works
 * for items linked before webhooks existed -- every item in this database today was created by
 * the WPF app with no webhook at all, so without this they would sit at the default 'ok' forever
 * regardless of what is actually true at the bank.
 */
export async function refreshItemHealth(itemId) {
  const row = await one("SELECT * FROM plaid_items WHERE id = $1", [itemId]);
  if (!row) return null;

  let status;
  try {
    status = await fetchItemStatus(row.access_token);
  } catch (err) {
    // A live ITEM_LOGIN_REQUIRED comes back as a Plaid *error*, not a field -- that IS the answer.
    if (err instanceof PlaidError && err.code && err.code !== "NETWORK" && err.code !== "NOT_CONFIGURED") {
      await applyHealth(itemId, {
        status: healthFromErrorCode(err.code),
        code: err.code,
        message: err.message,
      });
      return { ...(await getItem(itemId)), refreshedFrom: "error" };
    }
    throw err;
  }

  const errorCode = status.error?.error_code ?? null;
  await applyHealth(itemId, {
    status: healthFromErrorCode(errorCode),
    code: errorCode,
    message: status.error?.error_message ?? null,
    consentExpiresAt: status.consentExpirationTime ?? null,
  });

  // Record what Plaid says the webhook actually is, rather than what we hoped we set.
  await query(
    `UPDATE plaid_items
        SET webhook_url = $2,
            webhook_registered_at = CASE
              WHEN $2::text IS NOT NULL AND webhook_registered_at IS NULL THEN now()
              ELSE webhook_registered_at END
      WHERE id = $1`,
    [itemId, status.webhook ?? null],
  );

  return { ...(await getItem(itemId)), refreshedFrom: "item/get" };
}

/** Refresh every linked item, one at a time. One item failing never stops the rest. */
export async function refreshAllItemHealth() {
  const rows = await many("SELECT id FROM plaid_items");
  const refreshed = [];
  const failed = [];
  for (const row of rows) {
    try {
      refreshed.push(await refreshItemHealth(row.id));
    } catch (err) {
      failed.push({ id: row.id, error: err.message });
    }
  }
  return { refreshed, failed };
}

/**
 * Stamp a genuinely successful reconnect. Only ever called after a real /item/get came back
 * clean -- Link's own onSuccess is the user finishing the flow, which is not the same thing as
 * the item actually being healthy again, and only one of those two is worth recording.
 */
export async function markReconnected(itemId) {
  await query(
    `UPDATE plaid_items
        SET reconnected_at = now(),
            health_status = 'ok',
            health_code = NULL,
            health_message = NULL,
            health_changed_at = now()
      WHERE id = $1`,
    [itemId],
  );
  return getItem(itemId);
}

/**
 * Test seam, same idiom as src/push/webpush.mjs's own `__test`. Seeds the verification-key cache
 * so bin/selftest-plaid-webhook.mjs can drive the REAL receiver end to end with a real ES256
 * signature, against the real database, without live Plaid credentials.
 *
 * Not a backdoor: it is reachable only from code already running inside this process (which by
 * definition already holds the Plaid secret), never from an HTTP request, and nothing reads an
 * environment variable to populate it.
 */
export const __test = {
  seedVerificationKey(kid, jwk) {
    verificationKeyCache.set(kid, jwk);
  },
  clearVerificationKeys() {
    verificationKeyCache.clear();
  },
};

/**
 * Point every linked item at this app's webhook receiver. Idempotent, and honest when it cannot
 * run: a localhost PUBLIC_ORIGIN is not something Plaid can ever deliver to, so it reports that
 * as a real skip rather than attempting a call that would fail confusingly.
 */
export async function registerWebhooks({ force = false } = {}) {
  const target = webhookUrl();
  if (!plaidConfigured()) return { skipped: "not-configured", target, updated: [], failed: [] };
  if (!webhookUrlIsDeliverable(target)) return { skipped: "origin-not-public", target, updated: [], failed: [] };

  const rows = await many("SELECT id, access_token, institution_name, webhook_url FROM plaid_items");
  const updated = [];
  const failed = [];
  for (const row of rows) {
    if (!force && row.webhook_url === target) continue;
    try {
      const accepted = await setItemWebhook(row.access_token, target);
      await query(
        "UPDATE plaid_items SET webhook_url = $2, webhook_registered_at = now() WHERE id = $1",
        [row.id, accepted],
      );
      updated.push({ id: row.id, institutionName: row.institution_name, webhook: accepted });
    } catch (err) {
      failed.push({ id: row.id, institutionName: row.institution_name, error: err.message });
    }
  }
  return { skipped: null, target, updated, failed };
}
