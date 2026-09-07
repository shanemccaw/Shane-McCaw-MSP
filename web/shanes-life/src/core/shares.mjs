// Share links -- the mixed access model from contract pack Section 9: "a shopping list link
// Shane can open on his phone or hand to someone else, while the rest of the app stays behind
// real auth."
//
// The link is a capability URL. Holding it grants access to exactly one entity and nothing else:
// no session is created, no other entity is reachable, and the only write it can perform is
// ticking an item off (and only when can_check was set at creation time).

import { config } from "../config.mjs";
import { many, one, query } from "../db.mjs";
import { fingerprint, mintToken } from "../auth/tokens.mjs";
import { forbidden, notFound } from "../http.mjs";

export function shareUrl(token) {
  return `${config.publicOrigin}/s/${token}`;
}

export async function createShareLink({ userId, entityId, label = null, canCheck = true, expiresInDays = null }) {
  const owned = await one("SELECT id, title FROM entities WHERE id = $1 AND user_id = $2", [
    entityId,
    userId,
  ]);
  if (!owned) throw notFound("Entity not found");

  const token = mintToken(24);
  const expires =
    expiresInDays === null || expiresInDays === undefined || expiresInDays === ""
      ? null
      : new Date(Date.now() + Number(expiresInDays) * 86_400_000).toISOString();
  if (expires !== null && Number.isNaN(Date.parse(expires))) {
    throw forbidden("expiresInDays must be a number of days");
  }

  const row = await one(
    `INSERT INTO share_links (user_id, entity_id, token_hash, label, can_check, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, label, can_check, expires_at, created_at`,
    [userId, entityId, fingerprint(token), label ? String(label).slice(0, 120) : null, Boolean(canCheck), expires],
  );

  // The raw token is returned exactly once, here. It is never recoverable from the database.
  return { ...row, token, url: shareUrl(token), entity_title: owned.title };
}

/** Resolve a token to the entity it grants, or null. Also bumps the real view counter. */
export async function resolveShare(token, { countView = false } = {}) {
  if (!token) return null;
  const link = await one(
    `SELECT s.id, s.user_id, s.entity_id, s.label, s.can_check, s.expires_at, s.view_count
       FROM share_links s
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND (s.expires_at IS NULL OR s.expires_at > now())`,
    [fingerprint(token)],
  );
  if (!link) return null;

  if (countView) {
    await query(
      "UPDATE share_links SET view_count = view_count + 1, last_seen_at = now() WHERE id = $1",
      [link.id],
    );
  }

  const entity = await one(
    `SELECT e.id, e.category, e.title, e.body, e.status, e.occurs_at, e.data, e.updated_at,
            c.label AS category_label, c.icon AS category_icon, c.color AS category_color,
            c.item_noun AS category_item_noun
       FROM entities e
       JOIN categories c ON c.slug = e.category
      WHERE e.id = $1`,
    [link.entity_id],
  );
  if (!entity) return null;

  entity.items = await many(
    `SELECT id, position, text, note, checked_at, checked_by, data
       FROM entity_items WHERE entity_id = $1 ORDER BY position, created_at`,
    [link.entity_id],
  );

  return { link, entity };
}

export async function listShareLinks(userId, entityId = null) {
  const params = [userId];
  let filter = "";
  if (entityId) {
    params.push(entityId);
    filter = `AND s.entity_id = $${params.length}`;
  }
  return many(
    `SELECT s.id, s.entity_id, s.label, s.can_check, s.expires_at, s.revoked_at,
            s.view_count, s.last_seen_at, s.created_at, e.title AS entity_title
       FROM share_links s
       JOIN entities e ON e.id = s.entity_id
      WHERE s.user_id = $1 ${filter}
      ORDER BY s.created_at DESC`,
    params,
  );
}

export async function revokeShareLink(userId, shareId) {
  const row = await one(
    `UPDATE share_links SET revoked_at = now()
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
      RETURNING id`,
    [shareId, userId],
  );
  if (!row) throw notFound("Share link not found, or it is already revoked");
  return row;
}
