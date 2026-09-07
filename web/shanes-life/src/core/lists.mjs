// Lists -- the typed shape rooms use instead of the generic entities pair (Git #3116's real
// decision on #3086: rooms get their own typed tables, not entities/entity_items).
//
// #3116 built exactly what the share layer needed: an ownership check, a read shaped the same
// way core/entities.mjs shapes an entity (so shares.mjs and routes/public.mjs stay kind-agnostic),
// and the one write a share link is allowed to make -- ticking an item off. #3088 (Shopping, the
// first real room on this typed shape) adds the rest: create/find-or-create, add/replace/delete
// items, and clearing checked rows -- the real list CRUD the Shopping screen and `push_list` (MCP)
// both need.

import { many, one, query, transaction } from "../db.mjs";
import { badRequest, notFound } from "../http.mjs";
import { bumpUse, ensureCategory } from "./categories.mjs";

const MAX_ITEMS_PER_CALL = 500;

// Mirrors core/entities.mjs's normaliseItems for the typed shape. Plain add/replace still only
// accepts text/note/checked -- quantity remains out of scope. Price now has a real home (020's
// price_cents/price_source/priced_at), but only via a real scan (core/scan.mjs, #3109) -- a
// plain add is never priced, so it is not accepted through this path either. Aisle memory
// (#3108) is real but deliberately NOT a list_items column: it is a per-(user, store, item)
// record in store_aisles that outlives any one run -- see core/store-aisles.mjs.
function normaliseListItems(items) {
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
      checked: Boolean(item.checked),
    };
  });
}

/** Ownership check before minting a share link against a list. Also the owner-side read used
 *  everywhere else in this module -- includes enough to show a list's own header, not just its
 *  name. */
export async function getOwnedList(userId, listId) {
  return one(
    `SELECT id, name, category, icon, store, budget_cents, created_at, updated_at
       FROM lists WHERE id = $1 AND user_id = $2 AND archived_at IS NULL`,
    [listId, userId],
  );
}

/** Sets which real store a run is being shopped at (#3108) -- what Best-path ordering and aisle
 *  memory both key off. Cleared with `store: null` (e.g. switching stores mid-week). */
export async function setListStore(userId, listId, store) {
  const owned = await getOwnedList(userId, listId);
  if (!owned) throw notFound("List not found");
  const clean = store ? String(store).trim().slice(0, 120) || null : null;
  const row = await one(
    `UPDATE lists SET store = $2, updated_at = now() WHERE id = $1
     RETURNING id, name, category, icon, store, created_at, updated_at`,
    [listId, clean],
  );
  return row;
}

/**
 * The Shopping room's real typed shape (#3088, Git #3116's decision): one active list, a
 * singleton per user. "One run" (design handoff's capture grammar, `grocery words -> the run`)
 * means exactly one non-archived `lists` row with category 'shopping' -- created the first time
 * anything needs it, same as the design's own "list created if missing" idiom for the generic
 * Lists room.
 */
export async function getOrCreateShoppingList(userId) {
  const existing = await one(
    `SELECT id, name, category, icon, budget_cents, created_at, updated_at FROM lists
      WHERE user_id = $1 AND category = 'shopping' AND archived_at IS NULL
      ORDER BY created_at ASC LIMIT 1`,
    [userId],
  );
  if (existing) return existing;

  const cat = await ensureCategory(
    "shopping",
    {
      label: "Shopping",
      icon: "shopping-cart",
      color: "sky",
      itemNoun: "item",
      description: "The one real running grocery/shopping list -- pushed to by Claude over MCP (push_list) or added to directly.",
    },
    { createdBy: "shane" },
  );

  try {
    const row = await one(
      `INSERT INTO lists (user_id, name, category, icon, created_by)
       VALUES ($1, 'Shopping', $2, $3, 'shane')
       RETURNING id, name, category, icon, budget_cents, created_at, updated_at`,
      [userId, cat.slug, cat.icon],
    );
    await bumpUse(cat.slug);
    return row;
  } catch (err) {
    // A concurrent request already created it (lists_user_name_key) -- re-read rather than 500.
    if (err.code === "23505") return getOrCreateShoppingList(userId);
    throw err;
  }
}

/**
 * Find-or-create a named, categorised list -- generalises getOrCreateShoppingList to any future
 * room built on this same typed shape. `push_list` (MCP) routes here for anything other than the
 * default 'shopping' category.
 */
export async function getOrCreateListByName(userId, { name, category, categoryMeta = {} }) {
  const cleanName = String(name || "").trim().slice(0, 200);
  if (!cleanName) throw badRequest("name is required");

  const existing = await one(
    `SELECT id, name, category, icon, budget_cents, created_at, updated_at FROM lists
      WHERE user_id = $1 AND lower(name) = lower($2) AND archived_at IS NULL`,
    [userId, cleanName],
  );
  if (existing) return existing;

  const cat = await ensureCategory(category || "list", categoryMeta, { createdBy: "claude" });
  try {
    const row = await one(
      `INSERT INTO lists (user_id, name, category, icon, created_by)
       VALUES ($1, $2, $3, $4, 'claude')
       RETURNING id, name, category, icon, budget_cents, created_at, updated_at`,
      [userId, cleanName, cat.slug, cat.icon],
    );
    await bumpUse(cat.slug);
    return row;
  } catch (err) {
    if (err.code === "23505") return getOrCreateListByName(userId, { name, category, categoryMeta });
    throw err;
  }
}

/** Owner-side read: the list, its raw items, and its share links -- not the share-normalised
 *  shape getListForShare returns below, which exists for the kind-agnostic public route only.
 *
 * #3111 (per-run budget): also returns the list's real `budget` (dollars, from `budget_cents`)
 * and a real running `totalCents`/`total` summed across every item's own `price_cents` --
 * #3109's real scan is the only thing that ever sets that column, so the total is real, not
 * estimated, and simply reads $0 until something on the run has actually been scanned. This
 * intentionally does NOT split by done/checked -- the issue's own real scope is "updates live
 * as items are added/removed," not a checked-vs-still-to-get split (that richer cart/toGo model
 * belongs to the store-path Feature, #3108, not this one). */
export async function getListDetail(userId, listId) {
  const list = await getOwnedList(userId, listId);
  if (!list) return null;
  const items = await many(
    `SELECT id, position, text, note, done, done_at, created_at,
            price_cents, price_source, priced_at
       FROM list_items WHERE list_id = $1 ORDER BY position, created_at`,
    [listId],
  );
  const shareRows = await many(
    `SELECT id, label, can_check, expires_at, revoked_at, view_count, last_seen_at, created_at
       FROM share_links WHERE list_id = $1 ORDER BY created_at DESC`,
    [listId],
  );
  const totalCents = items.reduce((sum, i) => sum + (i.price_cents || 0), 0);
  return {
    ...list,
    budget: list.budget_cents == null ? null : list.budget_cents / 100,
    items,
    totalCents,
    total: totalCents / 100,
    overBudgetCents: list.budget_cents == null ? 0 : Math.max(0, totalCents - list.budget_cents),
    shares: shareRows,
  };
}

/** Set (or clear, with `null`) the real stated budget for this run -- #3111. Informational only:
 *  see routes/api.mjs and mcp/tools.mjs, nothing here ever blocks an add. */
export async function setListBudget(userId, listId, budgetCents) {
  const owned = await getOwnedList(userId, listId);
  if (!owned) throw notFound("List not found");
  if (budgetCents !== null && (!Number.isFinite(budgetCents) || budgetCents < 0)) {
    throw badRequest("budgetCents must be a non-negative number or null");
  }
  await query("UPDATE lists SET budget_cents = $2, updated_at = now() WHERE id = $1", [listId, budgetCents]);
  return getListDetail(userId, listId);
}

/** Append items, ownership-checked. Mirrors core/entities.mjs's addItems for the typed shape. */
export async function addListItems(userId, listId, items) {
  const owned = await getOwnedList(userId, listId);
  if (!owned) throw notFound("List not found");
  const normalised = normaliseListItems(items);
  if (normalised.length === 0) throw badRequest("items is empty");

  await transaction(async (client) => {
    const { rows } = await client.query(
      "SELECT COALESCE(max(position), -1) AS max FROM list_items WHERE list_id = $1",
      [listId],
    );
    let next = Number(rows[0].max) + 1;
    for (const item of normalised) {
      await client.query(
        `INSERT INTO list_items (list_id, position, text, note, done, done_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [listId, next++, item.text, item.note, item.checked, item.checked ? new Date().toISOString() : null],
      );
    }
    await client.query("UPDATE lists SET updated_at = now() WHERE id = $1", [listId]);
  });

  return getListDetail(userId, listId);
}

/** Replace every row on a list in one call -- what a freshly Claude-generated list (`push_list`
 *  with replace:true) wants: this run's old contents are gone, not merged with whatever was left
 *  over from last time. */
export async function replaceListItems(userId, listId, items) {
  const owned = await getOwnedList(userId, listId);
  if (!owned) throw notFound("List not found");
  await query("DELETE FROM list_items WHERE list_id = $1", [listId]);
  const normalised = normaliseListItems(items);
  if (normalised.length === 0) {
    await query("UPDATE lists SET updated_at = now() WHERE id = $1", [listId]);
    return getListDetail(userId, listId);
  }
  return addListItems(userId, listId, items);
}

/** Ownership-checked delete of a single item -- correcting a mistaken add, same as entities. */
export async function deleteListItem(userId, listId, itemId) {
  const owned = await getOwnedList(userId, listId);
  if (!owned) throw notFound("List not found");
  const { rowCount } = await query("DELETE FROM list_items WHERE id = $1 AND list_id = $2", [
    itemId,
    listId,
  ]);
  if (rowCount === 0) throw notFound("Item not found");
  await query("UPDATE lists SET updated_at = now() WHERE id = $1", [listId]);
}

/** Clears every checked-off row -- the real, in-scope half of the design's "Done shopping"
 *  (Shanes Life 04 - Shopping.dc.html, option 1j): the run resets. Aisle spots already learned
 *  for this store live in store_aisles (#3108), independent of any one run's items -- clearing
 *  the run never touches that real, accumulated map. */
export async function clearCheckedItems(userId, listId) {
  const owned = await getOwnedList(userId, listId);
  if (!owned) throw notFound("List not found");
  await query("DELETE FROM list_items WHERE list_id = $1 AND done = true", [listId]);
  await query("UPDATE lists SET updated_at = now() WHERE id = $1", [listId]);
  return getListDetail(userId, listId);
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

/** Overwrite a list item's note -- used by the aisle-memory endpoint (#3108) to write a real
 *  "Aisle N · shelf note" line onto the row itself, so this run shows it without a second
 *  store_aisles lookup. Ownership is checked by the caller (the route already loaded the item
 *  off getListDetail, which is itself ownership-scoped). */
export async function setListItemNote(listId, itemId, note) {
  const row = await one(
    `UPDATE list_items SET note = $3 WHERE id = $1 AND list_id = $2
     RETURNING id, position, text, note, done, done_at`,
    [itemId, listId, note],
  );
  if (!row) throw notFound("Item not found");
  await query("UPDATE lists SET updated_at = now() WHERE id = $1", [listId]);
  return row;
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
