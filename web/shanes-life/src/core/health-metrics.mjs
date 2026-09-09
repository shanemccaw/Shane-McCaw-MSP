// Real Apple Health bridge via Shortcuts automation (Git #3322, Feature #3220).
//
// Real, confirmed platform constraint (issue body, verified live): HealthKit is exclusively a
// native iOS framework -- no web app/PWA (which shanes-life is) can read it directly. The real,
// viable bridge is Apple's own Shortcuts app, which CAN both read HealthKit and make real HTTP
// requests -- a Shortcuts automation (time-based, or triggered on a real health-metric
// condition) posts a real oxygen/heart-rate reading to POST /hooks/health-metrics/:token below.
//
// Auth is the exact same real shape this app already uses for exactly this kind of headless
// external client: high-entropy value handed out once, only its SHA-256 stored, scoped to one
// user, revocable -- widget_tokens (migration 046) and tesla_hook_tokens (migration 055,
// already built for "an iOS Shortcuts automation posts to a webhook") are the two established
// precedents this copies.
//
// Correlation with #3321's medication usage log is explicitly deferred (issue body, item 5) --
// this module only ever ingests and lists real readings.

import { many, one, query } from "../db.mjs";
import { fingerprint, mintToken } from "../auth/tokens.mjs";
import { badRequest, notFound } from "../http.mjs";

export const HOOK_TOKEN_PREFIX = "slhealthhook_";

export const METRIC_TYPES = ["spo2", "heart_rate"];

// Sanity bounds -- not clinical validation, just enough to catch a Shortcut sending the wrong
// unit or a garbled value before it lands in the database.
const METRIC_BOUNDS = {
  spo2: { min: 50, max: 100 },
  heart_rate: { min: 20, max: 260 },
};

// ---------------------------------------------------------------------------------------------
// Hook tokens (the real bearer credential the Shortcuts automation authenticates with)
// ---------------------------------------------------------------------------------------------

export async function issueHookToken(userId, label) {
  const token = HOOK_TOKEN_PREFIX + mintToken(32);
  const row = await one(
    `INSERT INTO health_metric_hook_tokens (user_id, token_hash, label)
     VALUES ($1,$2,$3) RETURNING id, label, created_at`,
    [userId, fingerprint(token), String(label || "unnamed").slice(0, 120)],
  );
  return { ...row, token };
}

export async function listHookTokens(userId) {
  return many(
    `SELECT id, label, created_at, last_used_at, revoked_at
       FROM health_metric_hook_tokens WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
}

export async function revokeHookToken(userId, tokenId) {
  const row = await one(
    `UPDATE health_metric_hook_tokens SET revoked_at = now()
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
      RETURNING id`,
    [tokenId, userId],
  );
  if (!row) throw notFound("Health metrics webhook token not found, or it is already revoked");
  return row;
}

async function resolveHookToken(token) {
  if (!token) return null;
  const row = await one(
    `SELECT t.id, t.user_id FROM health_metric_hook_tokens t
      WHERE t.token_hash = $1 AND t.revoked_at IS NULL`,
    [fingerprint(token)],
  );
  if (!row) return null;
  await query("UPDATE health_metric_hook_tokens SET last_used_at = now() WHERE id = $1", [row.id]);
  return row;
}

// ---------------------------------------------------------------------------------------------
// The real readings
// ---------------------------------------------------------------------------------------------

/**
 * POST /hooks/health-metrics/:token -- a real Shortcuts automation read a HealthKit sample and
 * is posting it here. The token in the path IS the authorization, same shape as
 * /hooks/tesla/:token and /widget/t/:token. Body: { metric: "spo2"|"heart_rate", value: number,
 * recordedAt?: ISO8601 }. recordedAt is the real moment HealthKit itself timestamped the sample
 * (the Shortcut reads this off the sample); it defaults to now() only when the Shortcut genuinely
 * has no better value to send.
 */
export async function recordMetric(token, body) {
  const resolved = await resolveHookToken(token);
  if (!resolved) throw notFound("This Apple Health webhook link is not valid any more.");

  const metricType = String(body?.metric || "").trim();
  if (!METRIC_TYPES.includes(metricType)) {
    throw badRequest(`metric must be one of: ${METRIC_TYPES.join(", ")}`);
  }

  const value = Number(body?.value);
  if (!Number.isFinite(value)) throw badRequest("value must be a real number");
  const bounds = METRIC_BOUNDS[metricType];
  if (value < bounds.min || value > bounds.max) {
    throw badRequest(`value ${value} is outside the real sane range for ${metricType} (${bounds.min}-${bounds.max})`);
  }

  let recordedAt = new Date();
  if (body?.recordedAt) {
    const parsed = new Date(body.recordedAt);
    if (Number.isNaN(parsed.getTime())) throw badRequest("recordedAt must be a real ISO 8601 timestamp");
    recordedAt = parsed;
  }

  const row = await one(
    `INSERT INTO health_metrics (user_id, metric_type, value, recorded_at, source)
     VALUES ($1, $2, $3, $4, 'shortcuts')
     RETURNING id, metric_type, value, recorded_at`,
    [resolved.user_id, metricType, value, recordedAt.toISOString()],
  );
  return { ok: true, ...row };
}

/** Settings -> Connected's recent-readings list, and the real future #3321 correlation view. */
export async function listRecent(userId, limit = 20) {
  return many(
    `SELECT id, metric_type, value, recorded_at, source, created_at
       FROM health_metrics WHERE user_id = $1
      ORDER BY recorded_at DESC LIMIT $2`,
    [userId, limit],
  );
}
