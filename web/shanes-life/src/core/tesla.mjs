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
// Vehicle COMMANDS (navigation, preconditioning, the trunk) were deliberately left out of the
// original #3158 build -- that's real, separate work, added below under "Vehicle commands" for
// #3216/#3218. This app never signs a command or reads TESLA_PRIVATE_KEY itself: modern Teslas
// reject unsigned commands, so every real command (Heading Home's navigation_gps_request /
// auto_conditioning_start, #3218's actuate_trunk) is forwarded through sendVehicleCommand() to
// Tesla's own official local signing proxy (config.teslaCommandProxyUrl) instead of
// reimplementing that binary protocol from scratch -- see sendVehicleCommand's own header.
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
// vehicle_cmds added for Git #3218 -- commands (actuate_trunk) genuinely need it; 055/#3158's
// original read-only scope did not carry it. Anyone who connected under the old scope needs to
// reconnect (Settings -> Tesla -> Disconnect, then Connect again) before a command will work --
// Tesla does not silently upgrade an already-granted scope.
const TESLA_SCOPES = "openid offline_access vehicle_device_data vehicle_cmds";

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
            vehicle_id, vehicle_vin, vehicle_display_name, connected_at, last_refreshed_at,
            auto_trunk_on_checkout
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
    commandsConfigured: teslaCommandsConfigured(),
    autoTrunkOnCheckout: row.auto_trunk_on_checkout,
  };
}

export async function disconnect(userId) {
  const { rowCount } = await query("DELETE FROM tesla_accounts WHERE user_id = $1", [userId]);
  return rowCount > 0;
}

// ---------------------------------------------------------------------------------------------
// Fleet API reads (vehicle_device_data scope only)
// ---------------------------------------------------------------------------------------------

/** The full, real, unwrapped JSON body -- every vehicle_data endpoint this file already called
 *  documents a `{ response: {...} }` envelope, which is what fleetGet() below assumes. Charging
 *  Endpoints' real envelope is NOT documented (migration 060's own header) -- getChargingHistory
 *  needs the raw body so it can check for `.response`, `.data`, a bare array, or whatever Tesla
 *  actually sends, rather than this function guessing on its callers' behalf. */
async function fleetGetRaw(userId, path) {
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
  return json;
}

/** The real, documented `{ response: {...} }` envelope every vehicle_data/vehicle-list call
 *  uses -- see fleetGetRaw above for the one real caller that can't assume this shape. */
async function fleetGet(userId, path) {
  const json = await fleetGetRaw(userId, path);
  return json?.response;
}

// ---------------------------------------------------------------------------------------------
// Heading Home commands (Git #3216): real navigation + climate-preconditioning sends, the piece
// #3158's own header explicitly deferred to this sibling Feature. Both go through
// sendVehicleCommand() below (Git #3218's real signing-proxy forwarder) -- see its own header
// for why this file never signs a command itself.
// ---------------------------------------------------------------------------------------------

/** Real "drive to this real address" command -- Tesla's own lat/lon nav-request endpoint, so a
 *  saved place's real coordinates (places.latitude/longitude) go straight in with no geocoding
 *  step. */
async function sendNavigationRequest(userId, { latitude, longitude, label }) {
  return sendVehicleCommand(userId, "navigation_gps_request", { lat: latitude, lon: longitude, value: label || "Home", order: 0 });
}

/** Real climate-preconditioning start -- the same real vehicle action the "Heading Out"
 *  checklist's inbound webhook (recordHookEvent, above) reacts to once it's already running;
 *  this is the other direction, this app STARTING it. */
async function sendPreconditioningStart(userId) {
  return sendVehicleCommand(userId, "auto_conditioning_start");
}

/** The one real entry point the Heading Home action calls: send both real commands to the
 *  selected vehicle, and report each honestly and independently -- a rejected preconditioning
 *  command is not a reason to also fail a navigation command that actually went through, and
 *  vice versa. */
export async function sendHeadingHomeCommands(userId, { latitude, longitude, label }) {
  const account = await ownedAccount(userId);
  if (!account?.vehicle_id) throw new TeslaError("No Tesla vehicle is selected yet.", { code: "NO_VEHICLE" });

  const outcome = async (fn) => {
    try {
      await fn();
      return { ok: true };
    } catch (err) {
      if (err instanceof TeslaError) return { ok: false, code: err.code, message: err.message };
      return { ok: false, code: null, message: err.message };
    }
  };

  const [navigation, climate] = await Promise.all([
    outcome(() => sendNavigationRequest(userId, { latitude, longitude, label })),
    outcome(() => sendPreconditioningStart(userId)),
  ]);
  return { vehicleDisplayName: account.vehicle_display_name, navigation, climate };
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

/** On-demand real charge read (Git #3238) -- battery_range is Tesla's own documented, rated
 *  range in miles (`charge_state.battery_range`), the same figure the Tesla app shows by
 *  default. Deliberately not `est_battery_range` (a driving-history-based estimate that swings
 *  with recent conditions) -- `battery_range` is the stable, rated figure, and consistency day
 *  to day matters more here than marginal accuracy for a "will tonight's charge cover tomorrow"
 *  check. Same on-demand-only discipline as getVehicleClimateState above: no poll loop, only
 *  called from the real 6-hour housekeeping sweep (server.mjs's runTeslaLowBatteryChecks) and
 *  the Settings "check now" action. */
export async function getChargeState(userId) {
  const account = await ownedAccount(userId);
  if (!account?.vehicle_id) {
    throw new TeslaError("No Tesla vehicle is selected yet.", { code: "NO_VEHICLE" });
  }
  const data = await fleetGet(
    userId,
    `/api/1/vehicles/${encodeURIComponent(account.vehicle_id)}/vehicle_data?endpoints=charge_state`,
  );
  const charge = data?.charge_state || {};
  return {
    vehicleDisplayName: account.vehicle_display_name,
    batteryLevel: charge.battery_level ?? null,
    batteryRangeMiles: charge.battery_range ?? null,
    chargingState: charge.charging_state ?? null,
  };
}

/** Real, on-demand odometer read (Git #3217) -- `vehicle_state.odometer` is Tesla's own
 *  long-documented, stable field (miles, reported as a float e.g. 57509.856033); rounded down to
 *  a whole mile here since that is the unit vehicle_maintenance_log.mileage and
 *  vehicles.current_mileage both already use. Same on-demand-only discipline as
 *  getVehicleClimateState/getChargeState above -- only called from the 6-hour housekeeping sweep
 *  (server.mjs's runTeslaOdometerSync) and the Settings "sync now" action, never polled. */
export async function getVehicleState(userId) {
  const account = await ownedAccount(userId);
  if (!account?.vehicle_id) {
    throw new TeslaError("No Tesla vehicle is selected yet.", { code: "NO_VEHICLE" });
  }
  const data = await fleetGet(
    userId,
    `/api/1/vehicles/${encodeURIComponent(account.vehicle_id)}/vehicle_data?endpoints=vehicle_state`,
  );
  const state = data?.vehicle_state || {};
  const odometer = typeof state.odometer === "number" ? Math.floor(state.odometer) : null;
  return { vehicleDisplayName: account.vehicle_display_name, odometerMiles: odometer };
}

/**
 * Real charging-session data off Tesla's own Charging Endpoints (Git #3217) -- confirmed,
 * investigated real limitation (see migration 060's own header): `charging/history` has no
 * officially published field schema, so this reads defensively rather than assuming an exact
 * key name -- it tries every plausible casing a real Tesla Fleet API response has been observed
 * to use elsewhere (this app's own vehicle_data endpoints are snake_case; third-party
 * integrations built directly against this endpoint report camelCase) and keeps the untouched
 * `raw` object on every session regardless of what did or didn't map, so nothing real is ever
 * silently dropped and nothing unmapped is ever guessed at. Cost/price is deliberately NOT
 * extracted here even defensively -- confirmed across multiple independent sources (Tesla's own
 * docs, a real third-party integration, #3238/#3258's own prior investigation) that no such
 * field exists anywhere in this endpoint for a personal developer account; inventing a lookup
 * for a field that has never been shown to exist would be exactly the fabrication the HARD RULE
 * forbids. Energy added is what funds this app's own cost ESTIMATE (Shane's real
 * charge_cost_per_kwh x real kWh), computed by the caller, not here.
 */
export async function getChargingHistory(userId) {
  const account = await ownedAccount(userId);
  if (!account?.vehicle_vin) {
    throw new TeslaError("No Tesla vehicle is selected yet.", { code: "NO_VEHICLE" });
  }
  const data = await fleetGetRaw(userId, `/api/1/dx/charging/history?vin=${encodeURIComponent(account.vehicle_vin)}`);
  // The real envelope shape is unconfirmed (no live account has exercised this yet) -- accept
  // whatever real array Tesla actually sends back rather than assuming one specific wrapper.
  const list = Array.isArray(data)
    ? data
    : Array.isArray(data?.response)
      ? data.response
      : Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data?.charges)
          ? data.charges
          : [];
  return list.map((raw) => ({
    sessionKey: String(raw.sessionId ?? raw.session_id ?? raw.id ?? `${raw.chargeStartDateTime ?? raw.charge_start_date_time ?? ""}:${raw.siteLocationName ?? raw.site_location_name ?? ""}`),
    startedAt: raw.chargeStartDateTime ?? raw.charge_start_date_time ?? raw.started_at ?? null,
    location: raw.siteLocationName ?? raw.site_location_name ?? raw.location ?? null,
    energyAddedKwh: typeof raw.energyAdded === "number" ? raw.energyAdded : typeof raw.energy_added === "number" ? raw.energy_added : null,
    raw,
  }));
}

/** Real, Shane-entered commute-nudge settings for the Settings -> Tesla section (Git #3238).
 *  Every field here is something only Shane can state -- see migration 056's own header for why
 *  none of it can come from Tesla directly. */
export async function getCommuteSettings(userId) {
  const account = await one(
    `SELECT low_battery_nudge_enabled, commute_miles_needed, efficiency_miles_per_kwh, charge_cost_per_kwh
       FROM tesla_accounts WHERE user_id = $1`,
    [userId],
  );
  if (!account) return null;
  return {
    lowBatteryNudgeEnabled: account.low_battery_nudge_enabled,
    commuteMilesNeeded: account.commute_miles_needed !== null ? Number(account.commute_miles_needed) : null,
    efficiencyMilesPerKwh: account.efficiency_miles_per_kwh !== null ? Number(account.efficiency_miles_per_kwh) : null,
    chargeCostPerKwh: account.charge_cost_per_kwh !== null ? Number(account.charge_cost_per_kwh) : null,
  };
}

export async function updateCommuteSettings(
  userId,
  { lowBatteryNudgeEnabled, commuteMilesNeeded, efficiencyMilesPerKwh, chargeCostPerKwh } = {},
) {
  const row = await query(
    `UPDATE tesla_accounts SET
        low_battery_nudge_enabled = $2,
        commute_miles_needed = $3,
        efficiency_miles_per_kwh = $4,
        charge_cost_per_kwh = $5,
        updated_at = now()
      WHERE user_id = $1`,
    [
      userId,
      Boolean(lowBatteryNudgeEnabled),
      commuteMilesNeeded === null || commuteMilesNeeded === undefined ? null : Number(commuteMilesNeeded),
      efficiencyMilesPerKwh === null || efficiencyMilesPerKwh === undefined ? null : Number(efficiencyMilesPerKwh),
      chargeCostPerKwh === null || chargeCostPerKwh === undefined ? null : Number(chargeCostPerKwh),
    ],
  );
  if (row.rowCount === 0) throw notFound("Connect Tesla before configuring commute nudges.");
  return getCommuteSettings(userId);
}

/**
 * The real "will tonight's charge cover tomorrow's drive" check (Git #3238) -- called from
 * server.mjs's housekeeping sweep for every user with the nudge enabled. Returns a real,
 * honest status object rather than throwing for any of the ordinary "nothing to do" cases
 * (not connected, not enabled, no vehicle, missing settings) -- those are real states, not
 * errors, same discipline connectionStatus() above already uses.
 *
 * Cost is only included when Shane has entered both `efficiencyMilesPerKwh` and
 * `chargeCostPerKwh` -- if either is missing, the nudge still fires (the real battery
 * shortfall is real and worth surfacing on its own) but with no cost line, rather than
 * fabricating a number to fill the gap.
 */
export async function checkLowBatteryForCommute(userId) {
  const settings = await getCommuteSettings(userId);
  if (!settings) return { checked: false, reason: "not_connected" };
  if (!settings.lowBatteryNudgeEnabled) return { checked: false, reason: "not_enabled" };
  if (!settings.commuteMilesNeeded) return { checked: false, reason: "no_commute_distance_set" };

  const charge = await getChargeState(userId);
  if (charge.batteryRangeMiles === null) return { checked: false, reason: "no_range_data" };

  const shortfallMiles = settings.commuteMilesNeeded - charge.batteryRangeMiles;
  if (shortfallMiles <= 0) return { checked: true, needsCharge: false };

  let costEstimate = null;
  if (settings.efficiencyMilesPerKwh && settings.chargeCostPerKwh) {
    const kwhNeeded = shortfallMiles / settings.efficiencyMilesPerKwh;
    costEstimate = Math.round(kwhNeeded * settings.chargeCostPerKwh * 100) / 100;
  }

  return {
    checked: true,
    needsCharge: true,
    batteryRangeMiles: charge.batteryRangeMiles,
    commuteMilesNeeded: settings.commuteMilesNeeded,
    shortfallMiles: Math.round(shortfallMiles * 10) / 10,
    costEstimate,
  };
}

/**
 * The real housekeeping-sweep entry point (server.mjs's runTeslaLowBatteryChecks, same shape
 * as Dates' day-before reminder / Pets' vaccine lead reminder): runs checkLowBatteryForCommute
 * for one user and queues a real nudge if a shortfall is found -- deduped against the same
 * `kind` + `day` already queued today, same real pattern pets.mjs's findDueVaccineReminders
 * uses (NOT EXISTS against nudge_events), so a 6-hour sweep never double-nudges the same real
 * shortfall on the same day.
 */
export async function runLowBatteryCheckForUser(userId) {
  const result = await checkLowBatteryForCommute(userId);
  if (!result.checked || !result.needsCharge) return result;

  const alreadyNudgedToday = await one(
    `SELECT id FROM nudge_events
      WHERE user_id = $1 AND kind = 'tesla_battery' AND day = current_date`,
    [userId],
  );
  if (alreadyNudgedToday) return { ...result, nudged: false, reason: "already_nudged_today" };

  const costLine = result.costEstimate !== null ? ` That'll run about $${result.costEstimate.toFixed(2)}.` : "";
  await queueNudge({
    userId,
    kind: "tesla_battery",
    title: "You need to charge tonight for tomorrow's commute",
    body: `${result.batteryRangeMiles} mi of range won't cover the ${result.commuteMilesNeeded} mi you need tomorrow.${costLine}`,
    payload: {
      batteryRangeMiles: result.batteryRangeMiles,
      commuteMilesNeeded: result.commuteMilesNeeded,
      shortfallMiles: result.shortfallMiles,
      costEstimate: result.costEstimate,
    },
  });
  return { ...result, nudged: true };
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
// ---------------------------------------------------------------------------------------------
// Vehicle commands (Git #3218, sibling to this file's read-only OAuth work): the checkout-to-
// trunk automation, and the real send/schedule machinery it needs.
// ---------------------------------------------------------------------------------------------

/** Real, honest configured-state check for the command path specifically -- distinct from
 *  teslaConfigured() above, since OAuth can be fully set up while the command proxy is not. */
export function teslaCommandsConfigured() {
  return Boolean(config.teslaCommandProxyUrl);
}

/**
 * Sends one real, already-signed-by-the-proxy command to the vehicle. This app never signs a
 * command itself -- see config.mjs's teslaCommandProxyUrl header for why -- it forwards the same
 * real OAuth bearer token used for reads to Tesla's own official local vehicle-command proxy
 * (github.com/teslamotors/vehicle-command), which holds the real enrolled private key and does
 * the actual signing + relay to the car. `body`, if given, is the command's own real parameters
 * (e.g. navigation_gps_request's lat/lon) -- Git #3216 -- most commands (actuate_trunk,
 * auto_conditioning_start) take none, hence the default.
 */
async function sendVehicleCommand(userId, command, body = {}) {
  if (!teslaCommandsConfigured()) {
    throw new TeslaError(
      "The Tesla vehicle-command proxy is not configured on this server (TESLA_COMMAND_PROXY_URL).",
      { code: "COMMANDS_NOT_CONFIGURED" },
    );
  }
  const account = await ownedAccount(userId);
  if (!account?.vehicle_id) {
    throw new TeslaError("No Tesla vehicle is selected yet.", { code: "NO_VEHICLE" });
  }
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) throw new TeslaError("Tesla is not connected.", { code: "NOT_CONNECTED" });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  let res;
  try {
    res = await fetch(
      `${config.teslaCommandProxyUrl}/api/1/vehicles/${encodeURIComponent(account.vehicle_id)}/command/${command}`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );
  } catch (err) {
    throw new TeslaError(`Could not reach the Tesla command proxy: ${err.message}`, { code: "NETWORK" });
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new TeslaError(`The Tesla command proxy returned a non-JSON response (HTTP ${res.status}).`, { status: res.status });
  }
  if (!res.ok || json?.response?.result === false) {
    throw new TeslaError(json?.response?.reason || json?.error || `Tesla rejected the command (HTTP ${res.status}).`, {
      status: res.status,
    });
  }
  return json?.response;
}

/** Real per-user opt-in for the checkout-to-trunk automation -- defaults off (migration 056);
 *  meaningless, and refused, without a real connected + selected vehicle. */
export async function setAutoTrunkOnCheckout(userId, enabled) {
  const account = await ownedAccount(userId);
  if (!account?.vehicle_id) {
    throw new TeslaError("Select a Tesla vehicle before enabling this.", { code: "NO_VEHICLE" });
  }
  await query("UPDATE tesla_accounts SET auto_trunk_on_checkout = $2, updated_at = now() WHERE user_id = $1", [
    userId,
    Boolean(enabled),
  ]);
  return { autoTrunkOnCheckout: Boolean(enabled) };
}

/**
 * The real first Tesla-room automation Shane named: when a real Shopping run finishes ("Done
 * shopping" / clear-checked, #3202), give him the real 5-minute walk-to-the-car window, then open
 * the real trunk. Called from lists.clearCheckedItems's route, not lists.mjs itself -- Tesla is
 * this file's concern, not Lists'. A no-op, not an error, for every real case where the
 * automation isn't actually armed (not connected, no vehicle, opted out, proxy not configured) --
 * finishing a shopping run must never fail because an unrelated automation isn't set up.
 */
export async function scheduleCheckoutTrunkOpen(userId) {
  if (!teslaCommandsConfigured()) return null;
  const account = await ownedAccount(userId);
  if (!account?.vehicle_id || !account.auto_trunk_on_checkout) return null;

  const row = await one(
    `INSERT INTO tesla_scheduled_commands (user_id, command, reason, scheduled_for)
     VALUES ($1, 'actuate_trunk', 'checkout-to-trunk', now() + interval '5 minutes')
     RETURNING id, scheduled_for`,
    [userId],
  );
  return row;
}

export async function listScheduledCommands(userId) {
  return many(
    `SELECT id, command, reason, scheduled_for, status, error, created_at, sent_at
       FROM tesla_scheduled_commands
      WHERE user_id = $1 AND status = 'pending'
      ORDER BY scheduled_for ASC`,
    [userId],
  );
}

export async function cancelScheduledCommand(userId, commandId) {
  const row = await one(
    `UPDATE tesla_scheduled_commands SET status = 'canceled'
      WHERE id = $1 AND user_id = $2 AND status = 'pending'
      RETURNING id`,
    [commandId, userId],
  );
  if (!row) throw notFound("Scheduled Tesla command not found, or it already ran.");
  return row;
}

/**
 * Real housekeeping call (server.mjs, same 5-minute cadence as redeliverSnoozedNudges): fires
 * every scheduled command whose time has come. One command's real failure (Tesla unreachable, the
 * vehicle asleep and not woken, the proxy down) is recorded on its own row and never blocks the
 * next one -- the same "one bad row never wedges the sweep" shape runPlaidItemMaintenance uses.
 */
export async function dispatchDueCommands() {
  const due = await many(
    `SELECT id, user_id, command FROM tesla_scheduled_commands
      WHERE status = 'pending' AND scheduled_for <= now()`,
  );
  let sent = 0;
  for (const row of due) {
    try {
      await sendVehicleCommand(row.user_id, row.command);
      await query(`UPDATE tesla_scheduled_commands SET status = 'sent', sent_at = now() WHERE id = $1`, [row.id]);
      sent += 1;
    } catch (err) {
      await query(`UPDATE tesla_scheduled_commands SET status = 'failed', error = $2, sent_at = now() WHERE id = $1`, [
        row.id,
        err.message,
      ]);
    }
  }
  return sent;
}

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
