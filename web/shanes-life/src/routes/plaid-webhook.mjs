// The real Plaid webhook receiver (Git #3168).
//
// This is the reason the webhook half of #3168 lives in Shane's Life rather than ShanesSurvival:
// Plaid delivers to a URL, and a WPF app that is only running when Shane is at his desk has no
// URL to give it. This app is the always-on, hosted half, so item health stops being something
// discovered by a sync failing hours or days later.
//
// Authenticated by Plaid's own signature, never by the session cookie -- so it is wired in
// server.mjs alongside /mcp and /healthz rather than into either router, both of which assume a
// different auth model. Nothing here trusts the body until the JWS over its SHA-256 verifies.

import { readBody, sendJson } from "../http.mjs";
import * as ratelimit from "../auth/ratelimit.mjs";
import { queueNudge } from "../core/nudges.mjs";
import { listUsers } from "../core/users.mjs";
import {
  HEALTH_OK,
  applyHealth,
  findItemByPlaidItemId,
  healthFromErrorCode,
  isReconnectable,
  recordWebhookEvent,
  verifyWebhook,
} from "../core/plaid.mjs";
import { query } from "../db.mjs";

const MAX_WEBHOOK_BYTES = 200_000;

/** Transaction-side codes that mean "there is new data waiting to be pulled". */
const TRANSACTIONS_PENDING_CODES = new Set([
  "SYNC_UPDATES_AVAILABLE",
  "INITIAL_UPDATE",
  "HISTORICAL_UPDATE",
  "DEFAULT_UPDATE",
  "TRANSACTIONS_REMOVED",
]);

/**
 * Decide what one real webhook means for item health. Returns null when the webhook is real and
 * worth recording but says nothing about health (a new-accounts notice, a webhook-update ack).
 */
export function healthChangeForWebhook(webhookType, webhookCode, body) {
  if (webhookType !== "ITEM") return null;

  switch (webhookCode) {
    case "ERROR": {
      const code = body?.error?.error_code ?? null;
      return {
        status: healthFromErrorCode(code),
        code,
        message: body?.error?.error_message ?? null,
        consentExpiresAt: null,
      };
    }
    case "PENDING_EXPIRATION":
      return {
        status: "pending_expiration",
        code: "PENDING_EXPIRATION",
        message: "Plaid access for this bank expires soon.",
        consentExpiresAt: body?.consent_expiration_time ?? null,
      };
    case "PENDING_DISCONNECT":
      return {
        status: "pending_disconnect",
        code: "PENDING_DISCONNECT",
        // Plaid sends a `reason` here (e.g. INSTITUTION_MIGRATION); pass it through verbatim
        // rather than paraphrasing it into something that may not be true next year.
        message: body?.reason ? `Plaid will disconnect this bank (${body.reason}).` : "Plaid will disconnect this bank.",
        consentExpiresAt: null,
      };
    case "USER_PERMISSION_REVOKED":
    case "USER_ACCOUNT_REVOKED":
      return {
        status: "revoked",
        code: webhookCode,
        message: "Access to this bank was revoked. Reconnecting is the only way back.",
        consentExpiresAt: null,
      };
    case "LOGIN_REPAIRED":
      return { status: HEALTH_OK, code: null, message: null, consentExpiresAt: null };
    default:
      return null;
  }
}

async function nudgeItemNeedsAttention(item, change, log) {
  try {
    for (const user of await listUsers()) {
      await queueNudge({
        userId: user.id,
        kind: "bank",
        title: `${item.institution_name} needs reconnecting`,
        body: change.message,
        payload: { plaidItemId: item.id, health: change.status, code: change.code },
      });
    }
  } catch (err) {
    // A nudge that will not queue must never cost us the health write or the 200 back to Plaid.
    log(`[plaid] could not queue reconnect nudge: ${err.message}`);
  }
}

/**
 * Handle one real inbound Plaid webhook. Always answers fast: Plaid retries on a non-2xx, so the
 * only non-2xx answers here are the ones that genuinely SHOULD be retried or refused.
 */
export async function handlePlaidWebhook(req, res, { ip = "unknown", log = console.log } = {}) {
  // A public internet endpoint. The signature is the real gate; this only stops a flood from
  // filling the event table before that gate gets a chance to reject each one individually.
  const limited = ratelimit.hit(`plaid-webhook:${ip}`, 120, 60_000);
  if (!limited.allowed) {
    return sendJson(res, 429, { error: "Too many webhook deliveries." });
  }

  let raw;
  try {
    raw = await readBody(req, MAX_WEBHOOK_BYTES);
  } catch (err) {
    return sendJson(res, err.status === 413 ? 413 : 400, { error: err.message });
  }

  const verification = await verifyWebhook(req.headers["plaid-verification"], raw);

  let body = null;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    body = null;
  }

  if (!verification.ok) {
    // Recorded, not silently dropped -- "did something try to spoof this?" and "is my
    // verification broken?" are the same shape of question later, and both need evidence.
    if (body && typeof body === "object") {
      await recordWebhookEvent({
        plaidItemId: typeof body.item_id === "string" ? body.item_id : null,
        webhookType: String(body.webhook_type ?? "UNKNOWN"),
        webhookCode: String(body.webhook_code ?? "UNKNOWN"),
        payload: body,
        verified: false,
        applied: false,
        note: verification.reason,
      }).catch((err) => log(`[plaid] could not record rejected webhook: ${err.message}`));
    }
    log(`[plaid] webhook REJECTED from ${ip}: ${verification.reason}`);
    return sendJson(res, 403, { error: "Webhook verification failed." });
  }

  if (!body || typeof body !== "object") {
    return sendJson(res, 400, { error: "Webhook body is not a JSON object." });
  }

  const webhookType = String(body.webhook_type ?? "UNKNOWN");
  const webhookCode = String(body.webhook_code ?? "UNKNOWN");
  const plaidItemId = typeof body.item_id === "string" ? body.item_id : null;
  const item = plaidItemId ? await findItemByPlaidItemId(plaidItemId) : null;

  let applied = false;
  let note = null;

  if (!item) {
    // Real and worth keeping: Plaid knows about an item this database does not. Answer 200 so
    // Plaid stops retrying something no retry can fix.
    note = plaidItemId ? "No local plaid_items row for this item_id" : "Webhook carried no item_id";
  } else {
    const change = healthChangeForWebhook(webhookType, webhookCode, body);
    if (change) {
      const result = await applyHealth(item.id, change);
      applied = result.changed;
      note = result.changed
        ? `health ${result.previous} -> ${change.status}`
        : `health unchanged (${change.status})`;
      // Only a real transition INTO a state a reconnect fixes is news. Plaid re-sends ITEM: ERROR
      // on every failed call, and a nudge per repeat would train Shane to ignore the one that
      // matters.
      if (result.changed && isReconnectable(change.status)) {
        await nudgeItemNeedsAttention(item, change, log);
      }
    } else if (webhookType === "TRANSACTIONS" && TRANSACTIONS_PENDING_CODES.has(webhookCode)) {
      // Shane's Life deliberately does not sync -- the WPF app owns the cursor. This records the
      // honest fact that data is waiting, so "the desktop app has not caught up" is visible
      // instead of invisible.
      const { rowCount } = await query(
        `UPDATE plaid_items SET transactions_pending_since = COALESCE(transactions_pending_since, now())
          WHERE id = $1 AND (transactions_pending_since IS NULL OR last_synced_at > transactions_pending_since)`,
        [item.id],
      );
      applied = rowCount > 0;
      note = applied ? "transactions pending for the desktop sync" : "transactions already pending";
    } else if (webhookType === "ITEM" && webhookCode === "WEBHOOK_UPDATE_ACKNOWLEDGED") {
      await query(
        "UPDATE plaid_items SET webhook_url = $2, webhook_registered_at = now() WHERE id = $1",
        [item.id, typeof body.new_webhook_url === "string" ? body.new_webhook_url : null],
      );
      applied = true;
      note = "webhook url acknowledged by Plaid";
    } else {
      note = "recorded, no health meaning";
    }

    await query("UPDATE plaid_items SET last_webhook_at = now() WHERE id = $1", [item.id]);
  }

  await recordWebhookEvent({
    itemId: item?.id ?? null,
    plaidItemId,
    webhookType,
    webhookCode,
    errorCode: body?.error?.error_code ?? null,
    errorMessage: body?.error?.error_message ?? null,
    payload: body,
    verified: true,
    applied,
    note,
  });

  log(`[plaid] webhook ${webhookType}:${webhookCode} item=${plaidItemId ?? "none"} -> ${note}`);
  return sendJson(res, 200, { received: true, applied });
}
