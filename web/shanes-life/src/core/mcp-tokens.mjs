// Bearer tokens for the remote MCP server.
//
// Same discipline as sessions and share links: high-entropy value handed out once, only its
// SHA-256 stored. A token is scoped to exactly one user, is revocable, and every call it makes
// lands in activity_log with the token's label attached -- so "which Claude conversation wrote
// this" has a real answer.

import { many, one, query } from "../db.mjs";
import { fingerprint, mintToken } from "../auth/tokens.mjs";
import { notFound } from "../http.mjs";

export const TOKEN_PREFIX = "slmcp_";

export async function issueMcpToken(userId, label) {
  const token = TOKEN_PREFIX + mintToken(32);
  const row = await one(
    `INSERT INTO mcp_tokens (user_id, token_hash, label)
     VALUES ($1,$2,$3)
     RETURNING id, label, created_at`,
    [userId, fingerprint(token), String(label || "unnamed").slice(0, 120)],
  );
  return { ...row, token };
}

export async function resolveMcpToken(token) {
  if (!token) return null;
  const row = await one(
    `SELECT t.id, t.label, t.user_id, u.email, u.name, u.is_active
       FROM mcp_tokens t
       JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = $1 AND t.revoked_at IS NULL`,
    [fingerprint(token)],
  );
  if (!row || !row.is_active) return null;
  await query(
    "UPDATE mcp_tokens SET last_used_at = now(), call_count = call_count + 1 WHERE id = $1",
    [row.id],
  );
  return {
    tokenId: row.id,
    label: row.label,
    user: { id: row.user_id, email: row.email, name: row.name },
  };
}

export async function listMcpTokens(userId) {
  return many(
    `SELECT id, label, created_at, last_used_at, revoked_at, call_count
       FROM mcp_tokens WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
}

export async function revokeMcpToken(userId, tokenId) {
  const row = await one(
    `UPDATE mcp_tokens SET revoked_at = now()
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
      RETURNING id`,
    [tokenId, userId],
  );
  if (!row) throw notFound("MCP token not found, or it is already revoked");
  return row;
}
