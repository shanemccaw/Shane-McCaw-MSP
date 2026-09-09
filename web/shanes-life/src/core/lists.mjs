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
      // Who actually asked for this, e.g. "Ronnie" -- free text, not a person_id FK (Section 3's
      // "genuinely open" principle again). Purely additive: every existing caller that never
      // passes it keeps working exactly as before. Feeds the Catches' duplicate-request detector
      // (core/catches.mjs, #3153) -- two different real names on the same real item text is the
      // whole signal it looks for.
      requestedBy: item.requestedBy ? String(item.requestedBy).trim().slice(0, 120) || null : null,
    };
  });
}

/**
 * The occasional-purchase list's own canonical name/category (Git #3311, sub-issue of #3229):
 * "What I like" -- items Shane buys sometimes, not routinely, worth a nudge if a real weekly-ad
 * deal or coupon matches one. Same real "conventionally-named list, no table of its own" shape as
 * Watch/Books/Heading Out above -- exported so capture-grammar.mjs (which creates/finds it) and
 * prices.mjs (which reads it to run the real deal-match check) both name the exact same list.
 */
export const OCCASIONAL_LIST_NAME = "What I Like";
export const OCCASIONAL_LIST_CATEGORY = "occasional";

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
 * Every real list except the Shopping singleton -- the Lists room (#3155, Section 3's "real
 * simple lists": Watch, Books, and anything else Claude files on the fly via `push_list`'s
 * generic `category` path). Shopping stays off-screen here; it already has its own full room.
 * Grouped by category so the UI can render one card per real category (icon/label/color come
 * from the same `categories` row `ensureCategory` wrote when the list was created), with a real
 * done/total count per list so a room can show progress without a second round-trip.
 */
export async function listListsForUser(userId) {
  return many(
    `SELECT l.id, l.name, l.category, l.created_by, l.created_at, l.updated_at,
            c.label AS category_label, c.icon AS category_icon, c.color AS category_color,
            c.item_noun AS category_item_noun, c.created_by AS category_created_by,
            COUNT(li.id)::int AS item_count,
            COUNT(li.id) FILTER (WHERE li.done)::int AS done_count
       FROM lists l
       LEFT JOIN categories c ON c.slug = l.category
       LEFT JOIN list_items li ON li.list_id = l.id
      WHERE l.user_id = $1 AND l.archived_at IS NULL AND COALESCE(l.category, '') != 'shopping'
      GROUP BY l.id, c.label, c.icon, c.color, c.item_noun, c.created_by
      ORDER BY l.created_at ASC`,
    [userId],
  );
}

/**
 * Every real list's own name, Shopping included -- the prefix-match candidate set the Lists
 * room's own capture grammar needs ("gifts list: …" / "add tent stakes to the camping list",
 * README "the Lists room" §3: "list names match by prefix, create on miss") but
 * `listListsForUser` deliberately doesn't provide, since that one excludes the Shopping singleton
 * for its own real reason (Shopping already has its own room). Capture grammar has no such
 * reason to exclude it -- typing "shopping list: …" should still find the real run, not spawn a
 * second, shadow "Shopping" list.
 */
export async function listAllListNames(userId) {
  return many(
    `SELECT id, name FROM lists WHERE user_id = $1 AND archived_at IS NULL ORDER BY created_at ASC`,
    [userId],
  );
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
    `SELECT id, position, text, note, done, done_at, created_at, requested_by,
            price_cents, price_source, priced_at, added_by, checked_by
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

/**
 * Append items, ownership-checked. Mirrors core/entities.mjs's addItems for the typed shape.
 *
 * `addedBy` (Git #3186) is the real provenance marker Shane's decision comment asked for --
 * "owner" for the owner's own adds, "share" / "share:<label>" for a can_add-enabled share link
 * (see routes/public.mjs) -- applied to every item in this one call, since they all came from
 * the same real actor in the same request. Mirrors entity_items' existing checked_by
 * convention (013_shanes_life_foundation.sql), extended to cover who added a row too.
 */
export async function addListItems(userId, listId, items, { addedBy = null } = {}) {
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
        `INSERT INTO list_items (list_id, position, text, note, done, done_at, requested_by, added_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [listId, next++, item.text, item.note, item.checked, item.checked ? new Date().toISOString() : null, item.requestedBy, addedBy],
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

/**
 * Real signal for the Today tray's "Heading out" balloon (Git #3164, README "Later, by moment":
 * "any undone Heading-out item (line = the undone names)"). No new table -- Heading Out has no
 * backend of its own yet, and doesn't need one: it is a real list exactly like Watch or Books,
 * created the same way (push_list / Claude, or Shane starting one on the Lists room), just under
 * the conventional name "Heading Out" so this can find it. Returns null when there is no such
 * list, or it exists but everything on it is already done.
 */
export async function getHeadingOutSignal(userId) {
  const list = await one(
    `SELECT id FROM lists
      WHERE user_id = $1 AND lower(name) = 'heading out' AND archived_at IS NULL
      LIMIT 1`,
    [userId],
  );
  if (!list) return null;
  const items = await many(
    `SELECT text FROM list_items WHERE list_id = $1 AND done = false ORDER BY position, created_at`,
    [list.id],
  );
  if (items.length === 0) return null;
  return { listId: list.id, names: items.map((i) => i.text) };
}

/**
 * Git #3328: the Heading Out list's own "run complete" reset -- the real gap this closes.
 * `clearTakeRun` (things.mjs) moves checked-off take-for-house items to their destination house;
 * the design prototype's own `trip` chip (`Shanes Life - First Slice Prototype.dc.html` ~2819)
 * resets Heading Out items' `done` back to `false` on arrival, so next time's run starts fresh
 * with the same full checklist rather than everything staying checked forever. This mirrors that
 * real drawn intent: reset, not delete -- unlike `clearCheckedItems` (Shopping), Heading Out is a
 * recurring checklist (keys, wallet, phone charger...), not a run that consumes its own items.
 * No-op (returns 0) when there's no Heading Out list on file yet, or nothing was checked.
 */
export async function resetHeadingOutList(userId) {
  const list = await one(
    `SELECT id FROM lists
      WHERE user_id = $1 AND lower(name) = 'heading out' AND archived_at IS NULL
      LIMIT 1`,
    [userId],
  );
  if (!list) return 0;
  const rows = await many(
    `UPDATE list_items SET done = false, done_at = NULL, checked_by = NULL
      WHERE list_id = $1 AND done = true
      RETURNING id`,
    [list.id],
  );
  if (rows.length > 0) {
    await query("UPDATE lists SET updated_at = now() WHERE id = $1", [list.id]);
  }
  return rows.length;
}

/**
 * The occasional-purchase list's own real, undone items -- what prices.mjs's real deal-match
 * check (Git #3311, matchOccasionalListAgainst) matches a freshly `push_deals`/`push_coupons`
 * item against. Same real "no backend of its own beyond the list itself" shape as
 * getHeadingOutSignal above. Returns null when the list doesn't exist yet -- nothing to match.
 */
export async function getOccasionalListItems(userId) {
  const list = await one(
    `SELECT id FROM lists
      WHERE user_id = $1 AND lower(name) = lower($2) AND archived_at IS NULL
      LIMIT 1`,
    [userId, OCCASIONAL_LIST_NAME],
  );
  if (!list) return null;
  const items = await many(
    `SELECT id, text FROM list_items WHERE list_id = $1 AND done = false ORDER BY position, created_at`,
    [list.id],
  );
  return { listId: list.id, items };
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
    `SELECT l.id, l.name, l.store, l.updated_at,
            c.slug  AS category, c.label AS category_label, c.icon AS category_icon,
            c.color AS category_color, c.item_noun AS category_item_noun
       FROM lists l
       LEFT JOIN categories c ON c.slug = COALESCE(l.category, 'list')
      WHERE l.id = $1`,
    [listId],
  );
  if (!list) return null;

  const items = await many(
    `SELECT id, position, text, note, done, done_at, added_by, checked_by
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
    // The real store this run is being shopped at (#3108) -- server-side only. routes/public.mjs
    // uses it to compute Best-path aisle grouping for a can_add-enabled share; it is never put on
    // the public wire shape itself (the store name isn't something a share holder needs to see,
    // only the ordering it produces).
    store: list.store,
    // Real provenance (Git #3186's decision comment): NULL reads as "the owner", same convention
    // entity_items' checked_by already used ("owner" | "share:<label>").
    items: items.map((i) => ({
      id: i.id,
      position: i.position,
      text: i.text,
      note: i.note,
      checked_at: i.done_at,
      checked_by: i.checked_by,
      added_by: i.added_by,
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

/** Tick / untick a list item. Mirrors core/entities.mjs's setItemChecked for the typed shape.
 *  `checkedBy` (Git #3186) is the real provenance marker -- "owner" | "share" | "share:<label>",
 *  the same convention entity_items' own checked_by already uses. Cleared back to NULL on an
 *  uncheck, same as entities.mjs, so a stale attribution never survives an untick. */
export async function setListItemChecked(listId, itemId, checked, checkedBy = null) {
  const row = await one(
    `UPDATE list_items
        SET done = $3, done_at = CASE WHEN $3 THEN now() ELSE NULL END,
            checked_by = CASE WHEN $3 THEN $4::text ELSE NULL END
      WHERE id = $1 AND list_id = $2
      RETURNING id, position, text, note, done, done_at, checked_by, added_by`,
    [itemId, listId, Boolean(checked), checkedBy],
  );
  if (!row) return null;
  await query("UPDATE lists SET updated_at = now() WHERE id = $1", [listId]);
  return {
    id: row.id,
    position: row.position,
    text: row.text,
    note: row.note,
    checked_at: row.done_at,
    checked_by: row.checked_by,
    added_by: row.added_by,
    data: {},
  };
}
