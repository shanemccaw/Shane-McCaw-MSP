// Entities: the single generic shape every kind of thing in this app takes.
//
// There is no shopping-list module, no appointment module, no birthday module. There is this,
// plus an open category slug and an open jsonb payload. Shopping Lists (the next Feature) is a
// consumer of createEntity/addItems/checkItem, not new tables -- which is the whole reason the
// foundation is generic (contract pack Section 3).

import { many, one, query, transaction } from "../db.mjs";
import { badRequest, notFound } from "../http.mjs";
import { bumpUse, ensureCategory } from "./categories.mjs";

const MAX_ITEMS_PER_CALL = 500;

function coerceDate(value, field) {
  if (value === undefined || value === null || value === "") return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw badRequest(`${field} is not a valid date/time: ${value}`);
  return d.toISOString();
}

function normaliseItems(items) {
  if (items === undefined || items === null) return [];
  if (!Array.isArray(items)) throw badRequest("items must be an array");
  if (items.length > MAX_ITEMS_PER_CALL) {
    throw badRequest(`items must contain at most ${MAX_ITEMS_PER_CALL} entries`);
  }
  return items.map((raw, i) => {
    const item = typeof raw === "string" ? { text: raw } : raw;
    if (!item || typeof item !== "object") throw badRequest(`items[${i}] must be a string or an object`);
    const text = String(item.text ?? "").trim();
    if (!text) throw badRequest(`items[${i}].text is required`);
    return {
      text: text.slice(0, 500),
      note: item.note ? String(item.note).slice(0, 2000) : null,
      data: item.data && typeof item.data === "object" ? item.data : {},
      checked: Boolean(item.checked),
    };
  });
}

export async function createEntity({
  userId,
  category,
  categoryMeta,
  title,
  body = null,
  status = "open",
  occursAt = null,
  remindAt = null,
  data = {},
  items = [],
  captureId = null,
  source = "web",
  createdBy = "claude",
}) {
  const cleanTitle = String(title ?? "").trim();
  if (!cleanTitle) throw badRequest("title is required");
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw badRequest("data must be a JSON object");
  }
  const normalisedItems = normaliseItems(items);
  const cat = await ensureCategory(category, categoryMeta || {}, { createdBy });

  const entity = await transaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO entities
         (user_id, category, title, body, status, occurs_at, remind_at, data, capture_id, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
       RETURNING *`,
      [
        userId,
        cat.slug,
        cleanTitle.slice(0, 300),
        body ? String(body).slice(0, 20000) : null,
        String(status || "open").slice(0, 40),
        coerceDate(occursAt, "occursAt"),
        coerceDate(remindAt, "remindAt"),
        JSON.stringify(data),
        captureId,
        source,
      ],
    );
    const created = rows[0];

    for (let i = 0; i < normalisedItems.length; i++) {
      const item = normalisedItems[i];
      await client.query(
        `INSERT INTO entity_items (entity_id, position, text, note, data, checked_at, checked_by)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
        [
          created.id,
          i,
          item.text,
          item.note,
          JSON.stringify(item.data),
          item.checked ? new Date().toISOString() : null,
          item.checked ? "owner" : null,
        ],
      );
    }

    if (captureId) {
      await client.query(
        `UPDATE captures SET status = 'classified', classified_at = now(), entity_id = $2
          WHERE id = $1 AND user_id = $3`,
        [captureId, created.id, userId],
      );
    }
    return created;
  });

  await bumpUse(cat.slug);
  return getEntity(userId, entity.id);
}

export async function getEntity(userId, entityId) {
  const entity = await one(
    `SELECT e.*, c.label AS category_label, c.icon AS category_icon,
            c.color AS category_color, c.item_noun AS category_item_noun
       FROM entities e
       JOIN categories c ON c.slug = e.category
      WHERE e.id = $1 AND e.user_id = $2`,
    [entityId, userId],
  );
  if (!entity) return null;
  entity.items = await many(
    `SELECT id, position, text, note, checked_at, checked_by, data, media_id, created_at
       FROM entity_items WHERE entity_id = $1 ORDER BY position, created_at`,
    [entityId],
  );
  entity.shares = await many(
    `SELECT id, label, can_check, expires_at, revoked_at, view_count, last_seen_at, created_at
       FROM share_links WHERE entity_id = $1 ORDER BY created_at DESC`,
    [entityId],
  );
  return entity;
}

export async function listEntities(
  userId,
  { category = null, status = null, includeArchived = false, search = null, limit = 100 } = {},
) {
  const params = [userId];
  const where = ["e.user_id = $1"];
  if (!includeArchived) where.push("e.archived_at IS NULL");
  if (category) {
    params.push(category);
    where.push(`e.category = $${params.length}`);
  }
  if (status) {
    params.push(status);
    where.push(`e.status = $${params.length}`);
  }
  if (search) {
    params.push(`%${String(search).trim()}%`);
    where.push(`(e.title ILIKE $${params.length} OR e.body ILIKE $${params.length})`);
  }
  params.push(Math.min(Number(limit) || 100, 500));

  return many(
    `SELECT e.id, e.category, e.title, e.body, e.status, e.occurs_at, e.remind_at, e.data,
            e.source, e.created_at, e.updated_at, e.archived_at,
            c.label AS category_label, c.icon AS category_icon, c.color AS category_color,
            c.item_noun AS category_item_noun,
            (SELECT count(*)::int FROM entity_items i WHERE i.entity_id = e.id) AS item_count,
            (SELECT count(*)::int FROM entity_items i
              WHERE i.entity_id = e.id AND i.checked_at IS NOT NULL) AS checked_count,
            (SELECT count(*)::int FROM share_links s
              WHERE s.entity_id = e.id AND s.revoked_at IS NULL) AS share_count
       FROM entities e
       JOIN categories c ON c.slug = e.category
      WHERE ${where.join(" AND ")}
      ORDER BY COALESCE(e.remind_at, e.occurs_at, e.updated_at) DESC
      LIMIT $${params.length}`,
    params,
  );
}

const UPDATABLE = {
  title: (v) => String(v).trim().slice(0, 300),
  body: (v) => (v === null ? null : String(v).slice(0, 20000)),
  status: (v) => String(v).slice(0, 40),
  category: null, // handled separately -- it has to go through ensureCategory
  occurs_at: (v) => coerceDate(v, "occursAt"),
  remind_at: (v) => coerceDate(v, "remindAt"),
};

export async function updateEntity(userId, entityId, patch, { createdBy = "claude" } = {}) {
  const existing = await one("SELECT id, category FROM entities WHERE id = $1 AND user_id = $2", [
    entityId,
    userId,
  ]);
  if (!existing) throw notFound("Entity not found");

  const sets = [];
  const params = [entityId, userId];

  const mapped = {
    title: patch.title,
    body: patch.body,
    status: patch.status,
    occurs_at: patch.occursAt,
    remind_at: patch.remindAt,
  };

  for (const [column, value] of Object.entries(mapped)) {
    if (value === undefined) continue;
    params.push(UPDATABLE[column](value));
    sets.push(`${column} = $${params.length}`);
  }

  if (patch.category !== undefined) {
    const cat = await ensureCategory(patch.category, patch.categoryMeta || {}, { createdBy });
    params.push(cat.slug);
    sets.push(`category = $${params.length}`);
  }

  if (patch.data !== undefined) {
    if (patch.data === null || typeof patch.data !== "object" || Array.isArray(patch.data)) {
      throw badRequest("data must be a JSON object");
    }
    params.push(JSON.stringify(patch.data));
    // Shallow merge, so a caller adding one key never blanks keys it did not know about.
    sets.push(`data = data || $${params.length}::jsonb`);
  }

  if (patch.archived !== undefined) {
    sets.push(patch.archived ? "archived_at = now()" : "archived_at = NULL");
  }

  if (sets.length === 0) throw badRequest("No updatable fields supplied");
  sets.push("updated_at = now()");

  await query(`UPDATE entities SET ${sets.join(", ")} WHERE id = $1 AND user_id = $2`, params);
  return getEntity(userId, entityId);
}

export async function addItems(userId, entityId, items) {
  const owned = await one("SELECT id FROM entities WHERE id = $1 AND user_id = $2", [
    entityId,
    userId,
  ]);
  if (!owned) throw notFound("Entity not found");
  const normalised = normaliseItems(items);
  if (normalised.length === 0) throw badRequest("items is empty");

  await transaction(async (client) => {
    const { rows } = await client.query(
      "SELECT COALESCE(max(position), -1) AS max FROM entity_items WHERE entity_id = $1",
      [entityId],
    );
    let next = Number(rows[0].max) + 1;
    for (const item of normalised) {
      await client.query(
        `INSERT INTO entity_items (entity_id, position, text, note, data, checked_at, checked_by)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
        [
          entityId,
          next++,
          item.text,
          item.note,
          JSON.stringify(item.data),
          item.checked ? new Date().toISOString() : null,
          item.checked ? "owner" : null,
        ],
      );
    }
    await client.query("UPDATE entities SET updated_at = now() WHERE id = $1", [entityId]);
  });

  return getEntity(userId, entityId);
}

/**
 * Tick / untick an item. checkedBy records who did it -- "owner" for the signed-in app, or
 * "share:<label>" when it came in through a no-login share link, which is what makes a handed-out
 * shopping list auditable rather than anonymous.
 */
export async function setItemChecked(entityId, itemId, checked, checkedBy) {
  const row = await one(
    `UPDATE entity_items
        SET checked_at = CASE WHEN $3 THEN now() ELSE NULL END,
            checked_by = CASE WHEN $3 THEN $4::text ELSE NULL END
      WHERE id = $1 AND entity_id = $2
      RETURNING id, position, text, note, checked_at, checked_by, data, media_id, created_at`,
    [itemId, entityId, Boolean(checked), checkedBy],
  );
  if (!row) throw notFound("Item not found");
  await query("UPDATE entities SET updated_at = now() WHERE id = $1", [entityId]);
  return row;
}

export async function deleteItem(userId, entityId, itemId) {
  const owned = await one("SELECT id FROM entities WHERE id = $1 AND user_id = $2", [
    entityId,
    userId,
  ]);
  if (!owned) throw notFound("Entity not found");
  const { rowCount } = await query("DELETE FROM entity_items WHERE id = $1 AND entity_id = $2", [
    itemId,
    entityId,
  ]);
  if (rowCount === 0) throw notFound("Item not found");
  await query("UPDATE entities SET updated_at = now() WHERE id = $1", [entityId]);
}

/**
 * The Today view (contract pack: "Today view shows only what's next", nudges rationed).
 * Everything that is genuinely due, plus anything still sitting unclassified in the inbox.
 * No invented urgency, no filler -- an empty result means there is genuinely nothing next.
 */
export async function nextUp(userId, limit = 3) {
  return many(
    `SELECT e.id, e.category, e.title, e.status, e.occurs_at, e.remind_at,
            c.label AS category_label, c.icon AS category_icon, c.color AS category_color
       FROM entities e
       JOIN categories c ON c.slug = e.category
      WHERE e.user_id = $1
        AND e.archived_at IS NULL
        AND e.status <> 'done'
        AND (e.remind_at IS NOT NULL OR e.occurs_at IS NOT NULL)
        AND COALESCE(e.remind_at, e.occurs_at) <= now() + interval '7 days'
      ORDER BY COALESCE(e.remind_at, e.occurs_at) ASC
      LIMIT $2`,
    [userId, Math.min(Number(limit) || 3, 20)],
  );
}
