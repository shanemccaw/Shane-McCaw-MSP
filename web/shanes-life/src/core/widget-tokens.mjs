// Bearer tokens for the lightweight /widget page (Git #3188).
//
// Same discipline as sessions, share links, and MCP tokens: high-entropy value handed out once,
// only its SHA-256 stored. A token is scoped to exactly one user and is revocable. It exists
// because a third-party iOS "Widget Web" app's WKWebView does not share Safari's session -- and
// cannot run WebAuthn at all -- so it needs its own long-lived credential baked into the widget's
// own URL, the same real problem mcp_tokens already solved for MCP. See migration
// 044_widget_tokens.sql for the full rationale.

import { many, one, query } from "../db.mjs";
import { fingerprint, mintToken } from "../auth/tokens.mjs";
import { notFound } from "../http.mjs";

export const TOKEN_PREFIX = "slwidget_";

export async function issueWidgetToken(userId, label) {
  const token = TOKEN_PREFIX + mintToken(32);
  const row = await one(
    `INSERT INTO widget_tokens (user_id, token_hash, label)
     VALUES ($1,$2,$3)
     RETURNING id, label, created_at`,
    [userId, fingerprint(token), String(label || "unnamed").slice(0, 120)],
  );
  return { ...row, token };
}

export async function resolveWidgetToken(token) {
  if (!token) return null;
  const row = await one(
    `SELECT t.id, t.label, t.user_id, u.email, u.name, u.is_active
       FROM widget_tokens t
       JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = $1 AND t.revoked_at IS NULL`,
    [fingerprint(token)],
  );
  if (!row || !row.is_active) return null;
  await query("UPDATE widget_tokens SET last_used_at = now() WHERE id = $1", [row.id]);
  return {
    tokenId: row.id,
    label: row.label,
    user: { id: row.user_id, email: row.email, name: row.name },
  };
}

export async function listWidgetTokens(userId) {
  return many(
    `SELECT id, label, created_at, last_used_at, revoked_at
       FROM widget_tokens WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
}

export async function revokeWidgetToken(userId, tokenId) {
  const row = await one(
    `UPDATE widget_tokens SET revoked_at = now()
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
      RETURNING id`,
    [tokenId, userId],
  );
  if (!row) throw notFound("Widget token not found, or it is already revoked");
  return row;
}
