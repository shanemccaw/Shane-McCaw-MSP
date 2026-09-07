// Lists -- the typed shape rooms use instead of the generic entities pair (Git #3116's real
// decision on #3086: rooms get their own typed tables, not entities/entity_items).
//
// Full list CRUD (create a list, push items via MCP, the Shopping screen itself) is #3088's own
// scope and is not built here. This module carries exactly what the share layer needs to point
// a no-login link at a real `lists`/`list_items` row: an ownership check for minting a link, a
// read shaped the same way core/entities.mjs shapes an entity (so shares.mjs and
// routes/public.mjs stay kind-agnostic), and the one write a share link is allowed to make --
// ticking an item off.

import { many, one, query } from "../db.mjs";

/** Ownership check before minting a share link against a list. */
export async function getOwnedList(userId, listId) {
  return one(
    "SELECT id, name FROM lists WHERE id = $1 AND user_id = $2 AND archived_at IS NULL",
    [listId, userId],
  );
}

/**
 * A list plus its items, normalised onto the same field names core/entities.mjs's getEntity
 * already returns (title, body, status, occurs_at, data, category_label/icon/color/item_noun,
 * items[].checked_at/checked_by), so the public share route does not need to know which typed
 * table it is actually reading from. `category` falls back to the 'list' category 013 seeds
 * when the list was never filed under one of its own.
 */
export async function getListForShare(listId) {
  const list = await one(
    `SELECT l.id, l.name, l.updated_at,
            c.slug  AS category, c.label AS category_label, c.icon AS category_icon,
            c.color AS category_color, c.item_noun AS category_item_noun
       FROM lists l
       LEFT JOIN categories c ON c.slug = COALESCE(l.category, 'list')
      WHERE l.id = $1`,
    [listId],
  );
  if (!list) return null;

  const items = await many(
    `SELECT id, position, text, note, done, done_at
       FROM list_items WHERE list_id = $1 ORDER BY position, created_at`,
    [listId],
  );

  return {
    id: list.id,
    category: list.category || "list",
    title: list.name,
    body: null,
    status: null,
    occurs_at: null,
    data: {},
    updated_at: list.updated_at,
    category_label: list.category_label || "List",
    category_icon: list.category_icon || "list-checks",
    category_color: list.category_color || "sky",
    category_item_noun: list.category_item_noun || "item",
    // list_items has no checked_by column -- the design's own literal shape (016's header quotes
    // the handoff verbatim: `list_items(list_id, text, done)`) -- so who ticked it lives only in
    // the audit trail (actor/actorLabel on activity_log), not on the row itself.
    items: items.map((i) => ({
      id: i.id,
      position: i.position,
      text: i.text,
      note: i.note,
      checked_at: i.done_at,
      checked_by: null,
      data: {},
    })),
  };
}

/** Tick / untick a list item. Mirrors core/entities.mjs's setItemChecked for the typed shape. */
export async function setListItemChecked(listId, itemId, checked) {
  const row = await one(
    `UPDATE list_items
        SET done = $3, done_at = CASE WHEN $3 THEN now() ELSE NULL END
      WHERE id = $1 AND list_id = $2
      RETURNING id, position, text, note, done, done_at`,
    [itemId, listId, Boolean(checked)],
  );
  if (!row) return null;
  await query("UPDATE lists SET updated_at = now() WHERE id = $1", [listId]);
  return {
    id: row.id,
    position: row.position,
    text: row.text,
    note: row.note,
    checked_at: row.done_at,
    checked_by: null,
    data: {},
  };
}
