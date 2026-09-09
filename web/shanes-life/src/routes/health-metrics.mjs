// The real, public health-metrics ingestion webhook (Git #3322): authenticated by its own
// bearer token in the path, never by the session cookie -- the real external trigger here (an
// Apple Shortcuts automation reading a HealthKit sample) is not a browser and holds no session,
// same "different auth model, sits above the session branch" reasoning routes/tesla.mjs's own
// header already gives for /hooks/tesla/:token.
//
// Everything session-gated (hook token CRUD, the recent-readings list for Settings -> Connected)
// lives in routes/api.mjs instead, the same split tesla.mjs/plaid-webhook.mjs already use.

import { HttpError, readJson, sendJson } from "../http.mjs";
import { recordMetric } from "../core/health-metrics.mjs";

const MAX_HOOK_BYTES = 10_000;

/**
 * POST /hooks/health-metrics/:token -- see core/health-metrics.mjs's recordMetric for the real
 * body shape and validation.
 */
export async function handleHealthMetricHook(req, res, token, { log }) {
  let body;
  try {
    body = await readJson(req, MAX_HOOK_BYTES);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, "Invalid JSON body");
  }

  const result = await recordMetric(token, body);
  log?.(`[health-metrics] recorded ${result.metric_type}=${result.value} at ${result.recorded_at.toISOString?.() || result.recorded_at}`);
  return sendJson(res, 201, result);
}
