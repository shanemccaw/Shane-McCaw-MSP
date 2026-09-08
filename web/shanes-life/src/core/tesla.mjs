// Real Tesla Fleet API integration (Git #3158, Feature #3237): the "Heading Out" checklist's
// real climate-preconditioning trigger.
//
// What this module IS: a read-only OAuth connection (scope `openid offline_access
// vehicle_device_data`) so the app can (1) know which real vehicle to watch and (2) read its
// current climate state on demand. Delivery of the actual "heading out" moment once triggered
// is not this file's job -- see recordHookEvent() below, which is the one real bridge into the
// already-built, already-generic nudges.mjs / real OS push pipeline (queueNudge, migration 018
// explicitly named `tesla` as a real nudge kind from the start).
//
// What this module is NOT: a vehicle-command client. Sending a real command (start
// preconditioning, unlock, honk) needs Tesla's separate command-signing keypair/protocol
// (the "vehicle-command" proxy), which is real, separate work for sibling Features #3216/#3218
// under the same Feature-tier parent #3237 -- not this checklist-trigger issue. TESLA_PRIVATE_KEY
// is deliberately never read here.
//
// Same encryption discipline as vault.mjs (migration 017/052): AES-256-GCM, SL_VAULT_KEY lives
// OUTSIDE the database, an AAD binds each ciphertext to the exact row/owner/field it was written
// for. One key, one rotation story, reused rather than minting a second key for a second secret
// class -- vault.mjs's own header makes this same call for logins vs. bill references.
//
// Honest note on verification (mirrors #3199's own honest-partial-verification precedent for
// Plaid): the OAuth exchange, refresh, and vehicle_data reads below are written against Tesla's
// real, documented Fleet API contract, but this build has no local TESLA_CLIENT_ID/SECRET to
// actually exercise them against -- Shane's own comment on #3158 says those exist on Replit,
// not yet locally. `teslaConfigured()` reports that honestly rather than pretending; nothing
// here has been exercised against Tesla's real servers in this session.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { randomUUID } from "node:crypto";
import { config } from "../config.mjs";
import { many, one, query } from "../db.mjs";
import { fingerprint, mintToken } from "../auth/tokens.mjs";
import { notFound } from "../http.mjs";
import { queueNudge } from "./nudges.mjs";
import { getHeadingOutSignal } from "./lists.mjs";

// Tesla's real, documented endpoints (developer.tesla.com). Auth is one fixed host regardless
// of region; the Fleet API itself is regional -- North America/Asia-Pacific share one host,
// Europe/Middle East/Africa another. Hardcoded to NA/APAC for now: Shane's own real account and
// vehicle are both US-registered, and the region is chosen at Tesla's account level, not
// something this app can detect without a real API call first.
const TESLA_AUTH_BASE = "https://auth.tesla.com";
const TESLA_FLEET_API_BASE = "https://fleet-api.prd.na.vn.cloud.tesla.com";
const TESLA_SCOPES = "openid offline_access vehicle_device_data";

const IV_BYTES = 12;
const KEY_BYTES = 32;
const ACTIVE_KEY_ID = "v1";

// A real hook is deduplicated against the last one recorded for the same user within this
// window -- an external trigger (a Shortcuts automation, an IFTTT applet) can genuinely fire
// more than once for the same real preconditioning session (a retry, a flaky connection), and
// re-nudging every time would be exactly the "stacked, not held" failure the nudge cap (migration
// 018) exists to prevent even for a single real event.
const DEDUPE_WINDOW_MINUTES = 30;

export class TeslaError extends Error {
  constructor(message, { code = null, status = null } = {}) {
    super(message);
    this.name = "TeslaError";
    this.code = code;
    this.status = status;
  }
}

export function teslaConfigured() {
  return Boolean(config.teslaClientId && config.teslaClientSecret && config.teslaRedirectUri);
}

function requireVaultKey() {
  if (!config.vaultKey || config.vaultKey.length !== KEY_BYTES) {
    throw new TeslaError(
      "SL_VAULT_KEY is not set (or the wrong length), so Tesla tokens cannot be encrypted or " +
        "decrypted. Same key the password vault uses -- see .env.example.",
      { code: "VAULT_KEY_UNAVAILABLE" },
    );
  }
  return config.vaultKey;
}

function aad(userId, field) {
  return Buffer.from(`shanes-life:tesla:${ACTIVE_KEY_ID}:${userId}:${field}`, "utf8");
}

function encrypt(plaintext, userId, field) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", requireVaultKey(), iv);
  cipher.setAAD(aad(userId, field));
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

function decrypt(ciphertext, iv, authTag, userId, field) {
  const decipher = createDecipheriv("aes-256-gcm", requireVaultKey(), iv);
  decipher.setAAD(aad(userId, field));
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

// ---------------------------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------------------------

/** The real Tesla authorize URL to send the browser to. `state` is minted and verified by the
 *  route (a short-lived cookie), never generated here, so this stays a pure URL builder. */
export function authorizeUrl(state) {
  if (!teslaConfigured()) {
    throw new TeslaError("Tesla is not configured on this server.", { code: "NOT_CONFIGURED" });
  }
  const params = new URLSearchParams({
    client_id: config.teslaClientId,
    redirect_uri: config.teslaRedirectUri,
    response_type: "code",
    scope: TESLA_SCOPES,
    state,
  });
  return `${TESLA_AUTH_BASE}/oauth2/v3/authorize?${params.toString()}`;
}

async function tokenPost(body) {
  if (!teslaConfigured()) {
    throw new TeslaError("Tesla is not configured on this server.", { code: "NOT_CONFIGURED" });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  let res;
  try {
    res = await fetch(`${TESLA_AUTH_BASE}/oauth2/v3/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.teslaClientId,
        client_secret: config.teslaClientSecret,
        ...body,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    throw new TeslaError(`Could not reach Tesla: ${err.message}`, { code: "NETWORK" });
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new TeslaError(`Tesla returned a non-JSON response (HTTP ${res.status}).`, { status: res.status });
  }
  if (!res.ok) {
    throw new TeslaError(json?.error_description || json?.error || `Tesla returned HTTP ${res.status}.`, {
      status: res.status,
    });
  }
  return json;
}

/** Exchange a real authorization code for real tokens, immediately after Tesla's redirect back
 *  to /auth/tesla/callback. */
export async function exchangeCode(code) {
  return tokenPost({ grant_type: "authorization_code", code, redirect_uri: config.teslaRedirectUri });
}

async function refreshTokens(refreshToken) {
  return tokenPost({ grant_type: "refresh_token", refresh_token: refreshToken });
}

/** Persist a real token pair for a user, encrypted the same way as everything else this app
 *  keeps secret at rest. Upserts -- a reconnect replaces the old connection outright rather than
 *  leaving a stale row a real user_id-unique index would reject anyway. */
export async function saveTokens(userId, { access_token, refresh_token, expires_in, id_token } = {}) {
  if (!access_token || !refresh_token) {
    throw new TeslaError("Tesla's token response was missing access_token or refresh_token.");
  }
  const access = encrypt(access_token, userId, "access");
  const refresh = encrypt(refresh_token, userId, "refresh");
  const expiresAt = new Date(Date.now() + Math.max(0, Number(expires_in) || 0) * 1000);
  const teslaUserId = decodeSubject(id_token);

  await query(
    `INSERT INTO tesla_accounts
       (id, user_id, tesla_user_id, access_ciphertext, access_iv, access_auth_tag,
        refresh_ciphertext, refresh_iv, refresh_auth_tag, key_id, scope, token_expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (user_id) DO UPDATE SET
       tesla_user_id = EXCLUDED.tesla_user_id,
       access_ciphertext = EXCLUDED.access_ciphertext, access_iv = EXCLUDED.access_iv, access_auth_tag = EXCLUDED.access_auth_tag,
       refresh_ciphertext = EXCLUDED.refresh_ciphertext, refresh_iv = EXCLUDED.refresh_iv, refresh_auth_tag = EXCLUDED.refresh_auth_tag,
       key_id = EXCLUDED.key_id, scope = EXCLUDED.scope, token_expires_at = EXCLUDED.token_expires_at,
       last_refreshed_at = now(), updated_at = now()`,
    [
      randomUUID(),
      userId,
      teslaUserId,
      access.ciphertext,
      access.iv,
      access.authTag,
      refresh.ciphertext,
      refresh.iv,
      refresh.authTag,
      ACTIVE_KEY_ID,
      TESLA_SCOPES,
      expiresAt,
    ],
  );
}

/** The unverified `sub` claim out of Tesla's id_token, for display only (e.g. "connected as
 *  ...") -- never used as an authorization decision, so no signature check is needed here. */
function decodeSubject(idToken) {
  if (!idToken || idToken.split(".").length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"));
    return payload.sub || null;
  } catch {
    return null;
  }
}

async function ownedAccount(userId) {
  return one(
    `SELECT id, user_id, tesla_user_id, access_ciphertext, access_iv, access_auth_tag,
            refresh_ciphertext, refresh_iv, refresh_auth_tag, key_id, scope, token_expires_at,
            vehicle_id, vehicle_vin, vehicle_display_name, connected_at, last_refreshed_at
       FROM tesla_accounts WHERE user_id = $1`,
    [userId],
  );
}

/** A real, valid access token for this user -- refreshing first if the stored one is expired or
 *  about to be (a 60s margin so a request in flight doesn't race the expiry). Returns null when
 *  there is no real connection at all, so every caller has one honest "not connected" check
 *  instead of catching a decrypt error. */
export async function getValidAccessToken(userId) {
  const row = await ownedAccount(userId);
  if (!row) return null;
  if (row.key_id !== ACTIVE_KEY_ID) {
    throw new TeslaError(`Tesla tokens were encrypted with key "${row.key_id}", which is not the active key.`);
  }

  const expiresSoon = new Date(row.token_expires_at).getTime() - Date.now() < 60_000;
  if (!expiresSoon) {
    return decrypt(row.access_ciphertext, row.access_iv, row.access_auth_tag, userId, "access");
  }

  const refreshToken = decrypt(row.refresh_ciphertext, row.refresh_iv, row.refresh_auth_tag, userId, "refresh");
  const fresh = await refreshTokens(refreshToken);
  await saveTokens(userId, {
    access_token: fresh.access_token,
    // Tesla's refresh response may omit refresh_token when it did not rotate -- keep the one we
    // already have rather than saving `undefined` over a real, still-valid value.
    refresh_token: fresh.refresh_token || refreshToken,
    expires_in: fresh.expires_in,
  });
  return fresh.access_token;
}

/** Real connection status for the Settings -> Tesla section. Never throws for "not connected" --
 *  that is a real, ordinary state, not an error. */
export async function connectionStatus(userId) {
  if (!teslaConfigured()) return { configured: false, connected: false };
  const row = await ownedAccount(userId);
  if (!row) return { configured: true, connected: false };
  return {
    configured: true,
    connected: true,
    teslaUserId: row.tesla_user_id,
    vehicleId: row.vehicle_id,
    vehicleVin: row.vehicle_vin,
    vehicleDisplayName: row.vehicle_display_name,
    connectedAt: row.connected_at,
    lastRefreshedAt: row.last_refreshed_at,
  };
}

export async function disconnect(userId) {
  const { rowCount } = await query("DELETE FROM tesla_accounts WHERE user_id = $1", [userId]);
  return rowCount > 0;
}

// ---------------------------------------------------------------------------------------------
// Fleet API reads (vehicle_device_data scope only)
// ---------------------------------------------------------------------------------------------

async function fleetGet(userId, path) {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) throw new TeslaError("Tesla is not connected.", { code: "NOT_CONNECTED" });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  let res;
  try {
    res = await fetch(`${TESLA_FLEET_API_BASE}${path}`, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
  } catch (err) {
    throw new TeslaError(`Could not reach Tesla's Fleet API: ${err.message}`, { code: "NETWORK" });
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new TeslaError(`Tesla's Fleet API returned a non-JSON response (HTTP ${res.status}).`, { status: res.status });
  }
  if (!res.ok) {
    throw new TeslaError(json?.error || `Tesla's Fleet API returned HTTP ${res.status}.`, { status: res.status });
  }
  return json?.response;
}

/** Every real vehicle on the connected Tesla account, for the Settings picker. */
export async function listVehicles(userId) {
  const vehicles = await fleetGet(userId, "/api/1/vehicles");
  return (vehicles || []).map((v) => ({
    id: String(v.id),
    vin: v.vin,
    displayName: v.display_name,
    state: v.state,
  }));
}

/** Persist which real vehicle to watch -- required before a climate read or a hook event means
 *  anything, since the account can hold more than one real vehicle. */
export async function selectVehicle(userId, { vehicleId, vin, displayName }) {
  const row = await query(
    `UPDATE tesla_accounts
        SET vehicle_id = $2, vehicle_vin = $3, vehicle_display_name = $4, updated_at = now()
      WHERE user_id = $1`,
    [userId, String(vehicleId), vin || null, displayName || null],
  );
  if (row.rowCount === 0) throw notFound("Connect Tesla before selecting a vehicle.");
}

/** On-demand real climate read for the selected vehicle -- the MCP tool and the Settings
 *  "check now" action both call this. Deliberately not auto-polled on an interval: waking the
 *  vehicle to answer costs real 12V battery, and Tesla's own Fleet API rate-limits vehicle_data
 *  reads -- the real trigger path is the webhook (recordHookEvent below), not a poll loop. */
export async function getVehicleClimateState(userId) {
  const account = await ownedAccount(userId);
  if (!account?.vehicle_id) {
    throw new TeslaError("No Tesla vehicle is selected yet.", { code: "NO_VEHICLE" });
  }
  const data = await fleetGet(
    userId,
    `/api/1/vehicles/${encodeURIComponent(account.vehicle_id)}/vehicle_data?endpoints=climate_state`,
  );
  const climate = data?.climate_state || {};
  return {
    vehicleDisplayName: account.vehicle_display_name,
    isClimateOn: Boolean(climate.is_climate_on),
    isPreconditioning: Boolean(climate.is_preconditioning),
    insideTempC: climate.inside_temp ?? null,
    outsideTempC: climate.outside_temp ?? null,
  };
}

// ---------------------------------------------------------------------------------------------
// Hook tokens (the real bearer credential for the external climate-preconditioning trigger)
// ---------------------------------------------------------------------------------------------

export const HOOK_TOKEN_PREFIX = "slteslahook_";

export async function issueHookToken(userId, label) {
  const token = HOOK_TOKEN_PREFIX + mintToken(32);
  const row = await one(
    `INSERT INTO tesla_hook_tokens (user_id, token_hash, label)
     VALUES ($1,$2,$3) RETURNING id, label, created_at`,
    [userId, fingerprint(token), String(label || "unnamed").slice(0, 120)],
  );
  return { ...row, token };
}

export async function listHookTokens(userId) {
  return many(
    `SELECT id, label, created_at, last_used_at, revoked_at
       FROM tesla_hook_tokens WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
}

export async function revokeHookToken(userId, tokenId) {
  const row = await one(
    `UPDATE tesla_hook_tokens SET revoked_at = now()
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
      RETURNING id`,
    [tokenId, userId],
  );
  if (!row) throw notFound("Tesla webhook token not found, or it is already revoked");
  return row;
}

async function resolveHookToken(token) {
  if (!token) return null;
  const row = await one(
    `SELECT t.id, t.user_id FROM tesla_hook_tokens t
      WHERE t.token_hash = $1 AND t.revoked_at IS NULL`,
    [fingerprint(token)],
  );
  if (!row) return null;
  await query("UPDATE tesla_hook_tokens SET last_used_at = now() WHERE id = $1", [row.id]);
  return row;
}

// ---------------------------------------------------------------------------------------------
// The real trigger: an inbound hook -> (deduped) -> a real nudge
// ---------------------------------------------------------------------------------------------

/**
 * The one real bridge this whole file exists for: a genuine "climate preconditioning started"
 * signal, from whatever real external trigger Shane wires up (an iOS Shortcuts automation
 * reacting to CarPlay/climate state, an IFTTT applet, Home Assistant), lands here as an
 * authenticated POST and becomes a real nudge -- the fully generic, already-built delivery path
 * (real OS push, in-app tray fallback, mark/snooze/dismiss) via nudges.mjs's queueNudge(), not
 * anything new.
 *
 * Every real inbound call is recorded in `hooks` (kind='tesla') regardless of dedup outcome --
 * "context over clock" (design contract Section 8) means when the tray's Next card reads wrong,
 * the only way to tell why is the payload that produced it (migration 018's own header). The
 * nudge itself is what's deduped, not the record.
 */
export async function recordHookEvent(token, payload) {
  const resolved = await resolveHookToken(token);
  if (!resolved) throw notFound("This Tesla webhook link is not valid any more.");

  // Every real inbound call is recorded regardless of dedup outcome -- the row IS the audit
  // trail (migration 018's own header). Whether it goes on to queue a real nudge is decided
  // separately, right after.
  const inserted = await one(
    `INSERT INTO hooks (user_id, kind, payload) VALUES ($1, 'tesla', $2::jsonb) RETURNING id, at`,
    [resolved.user_id, JSON.stringify(payload || {})],
  );

  const recentlyProcessed = await one(
    `SELECT id FROM hooks
      WHERE user_id = $1 AND kind = 'tesla' AND id != $2
        AND processed_at > now() - interval '${DEDUPE_WINDOW_MINUTES} minutes'
      ORDER BY at DESC LIMIT 1`,
    [resolved.user_id, inserted.id],
  );
  if (recentlyProcessed) {
    await query("UPDATE hooks SET processed_at = now() WHERE id = $1", [inserted.id]);
    return { queued: false, reason: "deduped" };
  }

  await query("UPDATE hooks SET processed_at = now() WHERE id = $1", [inserted.id]);
  const heading = await getHeadingOutSignal(resolved.user_id);
  await queueNudge({
    userId: resolved.user_id,
    kind: "tesla",
    title: "Heading out?",
    body: heading ? heading.names.join(" · ") : "Preconditioning started -- check the Heading Out list.",
    payload: { source: "tesla-climate-preconditioning", raw: payload || {} },
  });
  return { queued: true };
}
