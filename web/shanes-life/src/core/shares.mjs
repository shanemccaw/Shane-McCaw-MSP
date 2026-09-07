// Share links -- the mixed access model from contract pack Section 9: "a shopping list link
// Shane can open on his phone or hand to someone else, while the rest of the app stays behind
// real auth."
//
// The link is a capability URL. Holding it grants access to exactly one real row and nothing
// else: no session is created, no other record is reachable, and the only write it can perform
// is ticking an item off (and only when can_check was set at creation time).
//
// Git #3116's real decision on #3086: rooms use their own typed tables, not the generic
// entities/entity_items pair. share_links (migration 019) carries an entity_kind + a second
// typed FK (list_id) so a link can point at either shape -- entities for the still-real open
// capture tail, or a room's own table, starting with lists/list_items (Shopping, #3088).
// Everything below branches on kind; the public route and the rest of the app never need to care
// which table a given link actually reads from.

import { config } from "../config.mjs";
import { many, one, query } from "../db.mjs";
import { fingerprint, mintToken } from "../auth/tokens.mjs";
import { badRequest, forbidden, notFound } from "../http.mjs";
import * as lists from "./lists.mjs";

export function shareUrl(token) {
  return `${config.publicOrigin}/s/${token}`;
}

async function ownedTarget(userId, { entityId, listId }) {
  if (entityId && listId) throw badRequest("Pass entityId or listId, not both");
  if (entityId) {
    const row = await one("SELECT id, title FROM entities WHERE id = $1 AND user_id = $2", [
      entityId,
      userId,
    ]);
    if (!row) throw notFound("Entity not found");
    return { kind: "entity", id: row.id, title: row.title };
  }
  if (listId) {
    const row = await lists.getOwnedList(userId, listId);
    if (!row) throw notFound("List not found");
    return { kind: "list", id: row.id, title: row.name };
  }
  throw badRequest("entityId or listId is required");
}

export async function createShareLink({
  userId,
  entityId = null,
  listId = null,
  label = null,
  canCheck = true,
  expiresInDays = null,
}) {
  const target = await ownedTarget(userId, { entityId, listId });

  const token = mintToken(24);
  const expires =
    expiresInDays === null || expiresInDays === undefined || expiresInDays === ""
      ? null
      : new Date(Date.now() + Number(expiresInDays) * 86_400_000).toISOString();
  if (expires !== null && Number.isNaN(Date.parse(expires))) {
    throw forbidden("expiresInDays must be a number of days");
  }

  const row = await one(
    `INSERT INTO share_links (user_id, entity_kind, entity_id, list_id, token_hash, label, can_check, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, entity_kind, label, can_check, expires_at, created_at`,
    [
      userId,
      target.kind,
      target.kind === "entity" ? target.id : null,
      target.kind === "list" ? target.id : null,
      fingerprint(token),
      label ? String(label).slice(0, 120) : null,
      Boolean(canCheck),
      expires,
    ],
  );

  // The raw token is returned exactly once, here. It is never recoverable from the database.
  return { ...row, token, url: shareUrl(token), entity_title: target.title };
}

async function resolveEntityRecord(entityId) {
  const entity = await one(
    `SELECT e.id, e.category, e.title, e.body, e.status, e.occurs_at, e.data, e.updated_at,
            c.label AS category_label, c.icon AS category_icon, c.color AS category_color,
            c.item_noun AS category_item_noun
       FROM entities e
       JOIN categories c ON c.slug = e.category
      WHERE e.id = $1`,
    [entityId],
  );
  if (!entity) return null;

  entity.items = await many(
    `SELECT id, position, text, note, checked_at, checked_by, data
       FROM entity_items WHERE entity_id = $1 ORDER BY position, created_at`,
    [entityId],
  );

  return entity;
}

/** Resolve a token to the real row it grants (whichever kind of table it points at), or null.
 *  Also bumps the real view counter. */
export async function resolveShare(token, { countView = false } = {}) {
  if (!token) return null;
  const link = await one(
    `SELECT s.id, s.user_id, s.entity_kind, s.entity_id, s.list_id, s.label, s.can_check,
            s.expires_at, s.view_count
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

  const record =
    link.entity_kind === "list"
      ? await lists.getListForShare(link.list_id)
      : await resolveEntityRecord(link.entity_id);
  if (!record) return null;

  return { link, record };
}

export async function listShareLinks(userId, { entityId = null, listId = null } = {}) {
  const params = [userId];
  const where = [];
  if (entityId) {
    params.push(entityId);
    where.push(`s.entity_id = $${params.length}`);
  }
  if (listId) {
    params.push(listId);
    where.push(`s.list_id = $${params.length}`);
  }
  const filter = where.length ? `AND ${where.join(" AND ")}` : "";
  return many(
    `SELECT s.id, s.entity_kind, s.entity_id, s.list_id, s.label, s.can_check, s.expires_at,
            s.revoked_at, s.view_count, s.last_seen_at, s.created_at,
            COALESCE(e.title, l.name) AS entity_title
       FROM share_links s
       LEFT JOIN entities e ON e.id = s.entity_id
       LEFT JOIN lists l ON l.id = s.list_id
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
