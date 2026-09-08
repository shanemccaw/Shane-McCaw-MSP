// The no-login half of the mixed access model (contract pack Section 9).
//
// Nothing in here reads a session cookie. Access is proved entirely by the token in the URL, and
// it grants exactly one real row: no listing, no other record, no account details, and no write
// beyond what the link was minted with (can_check to tick an item, can_add to add one too --
// Git #3186). The row can be a generic entity or a room's own typed table (Git #3116) --
// resolveShare already normalised it, so this route only branches on entity_kind for the writes
// that need to route to the right table.
//
// Git #3186 (real, explicit decision from Shane): share links get the full design match --
// adding items, real Best-path/aisle-number ordering, and a real live activity feed. Explicit
// privacy boundary from the same decision, verified below rather than assumed: every one of
// these new capabilities is still scoped to exactly the one list a token resolves to -- the
// activity feed reads audit.recentForEntity(userId, entityId), which filters on that list's own
// real id, never a general per-user stream; Best-path reads only that list's own current store;
// and the add-item route still refuses anything but the list this token names.

import { Router, badRequest, forbidden, notFound, readJson, sendJson } from "../http.mjs";
import * as audit from "../core/audit.mjs";
import { setItemChecked } from "../core/entities.mjs";
import * as lists from "../core/lists.mjs";
import { resolveShare } from "../core/shares.mjs";
import { orderItems } from "../core/shopping-order.mjs";
import * as storeAisles from "../core/store-aisles.mjs";

function mapPublicItem(i) {
  return {
    id: i.id,
    text: i.text,
    note: i.note,
    checkedAt: i.checked_at,
    checkedBy: i.checked_by,
    addedBy: i.added_by ?? null,
    data: i.data,
    // Only present on a Best-path grouped item (orderItems' "best" mode adds these) -- absent
    // everywhere else, so a plain flat/category item's shape doesn't grow phantom keys.
    ...(i.aisle !== undefined ? { aisle: i.aisle, aisleNote: i.aisleNote ?? null } : {}),
  };
}

/**
 * Flat / Category / Best-path for the public share shape -- the same real ordering logic the
 * owner's own GET /api/lists/:id?order= uses (core/shopping-order.mjs + core/store-aisles.mjs),
 * not a re-derived copy. Category is a pure function of item text, so it's available on any
 * list-kind link regardless of capability. Best-path additionally needs the list's real current
 * store and its accumulated aisle map -- Shane's decision comment ties that real store/aisle data
 * specifically to a can_add-enabled link ("expose it for a can_add-enabled share so Best-path
 * ordering can work for the link holder too"), so an ordinary check-off-only link never sees it,
 * even if it asks for ?order=best.
 */
async function orderForShare(link, record, url) {
  if (link.entity_kind !== "list") return { order: "flat", items: record.items.map(mapPublicItem) };

  const mode = url.searchParams.get("order") || "flat";
  if (mode === "category") {
    const { mode: appliedMode, groups } = orderItems(record.items, "category");
    return { order: appliedMode, groups: groups.map((g) => ({ category: g.category, items: g.items.map(mapPublicItem) })) };
  }
  if (mode === "best" && link.can_add) {
    const storeMap = record.store ? await storeAisles.getStoreMap(link.user_id, record.store) : [];
    const { mode: appliedMode, groups, unknown } = orderItems(record.items, "best", (item) =>
      storeAisles.matchAisle(item.text, storeMap),
    );
    return {
      order: appliedMode,
      groups: groups.map((g) => ({ aisle: g.aisle, items: g.items.map(mapPublicItem) })),
      unknown: unknown.map(mapPublicItem),
    };
  }
  return { order: "flat", items: record.items.map(mapPublicItem) };
}

function publicShape(record, link, ordered) {
  return {
    canCheck: link.can_check,
    canAdd: link.can_add,
    sharedAs: link.label,
    sharedBy: link.owner_name,
    expiresAt: link.expires_at,
    entity: {
      id: record.id,
      category: record.category,
      categoryLabel: record.category_label,
      categoryIcon: record.category_icon,
      categoryColor: record.category_color,
      itemNoun: record.category_item_noun,
      title: record.title,
      body: record.body,
      status: record.status,
      occursAt: record.occurs_at,
      updatedAt: record.updated_at,
      data: record.data,
      ...ordered,
    },
  };
}

/** "Shane just checked off Milk" / "Ronnie just added Bread" -- built server-side so the client
 *  stays as dumb as the rest of this page (fetch, render, never interpret). `actorLabel` is the
 *  share link's own label (e.g. "Ronnie"); a bare `actor` of "share" with no label falls back to
 *  "Someone on this link" rather than inventing a name. */
function describeActivity(row, ownerName) {
  const who = row.actor === "share" ? row.actor_label || "Someone on this link" : ownerName;
  const text = row.detail?.text;
  if (!text) return null;
  if (row.action.endsWith(".add")) return { id: row.id, at: row.at, text: `${who} just added ${text}` };
  const verb = row.detail?.checked === false ? "unchecked" : "checked off";
  return { id: row.id, at: row.at, text: `${who} just ${verb} ${text}` };
}

export function buildPublicRouter() {
  const router = new Router();

  router.get("/api/public/share/:token", async (_req, res, params, ctx) => {
    const found = await resolveShare(params.token, { countView: true });
    if (!found) throw notFound("This link is not valid any more.");
    const ordered = await orderForShare(found.link, found.record, ctx.url);
    return sendJson(res, 200, publicShape(found.record, found.link, ordered));
  });

  router.patch("/api/public/share/:token/items/:itemId", async (req, res, params) => {
    const found = await resolveShare(params.token);
    if (!found) throw notFound("This link is not valid any more.");
    if (!found.link.can_check) throw forbidden("This link is view-only.");

    const body = await readJson(req);
    if (body.checked === undefined) throw badRequest("checked is required");

    const checkedBy = found.link.label ? `share:${found.link.label}` : "share";
    const item =
      found.link.entity_kind === "list"
        ? await lists.setListItemChecked(found.link.list_id, params.itemId, body.checked, checkedBy)
        : await setItemChecked(found.record.id, params.itemId, body.checked, checkedBy);
    if (!item) throw notFound("Item not found");

    await audit.record({
      userId: found.link.user_id,
      actor: "share",
      actorLabel: found.link.label,
      action: found.link.entity_kind === "list" ? "list.item.check" : "entity.item.check",
      entityId: found.record.id,
      detail: { itemId: params.itemId, checked: Boolean(body.checked), text: item.text },
    });
    return sendJson(res, 200, {
      id: item.id,
      text: item.text,
      note: item.note,
      checkedAt: item.checked_at,
      checkedBy: item.checked_by ?? checkedBy,
      addedBy: item.added_by ?? null,
      data: item.data,
    });
  });

  // Real add capability (Git #3186), gated on can_add -- list-kind only. No real entity-kind
  // share has ever asked for this (verified live: every share_links row today is list-kind), so
  // rather than half-wire a second write path nothing uses, this refuses entity-kind outright
  // regardless of can_add, same as the rest of this route already refuses a check on a
  // view-only link.
  router.post("/api/public/share/:token/items", async (req, res, params, ctx) => {
    const found = await resolveShare(params.token);
    if (!found) throw notFound("This link is not valid any more.");
    if (!found.link.can_add) throw forbidden("This link can't add items.");
    if (found.link.entity_kind !== "list") throw forbidden("Adding items isn't available on this link.");

    const body = await readJson(req);
    const addedBy = found.link.label ? `share:${found.link.label}` : "share";
    const before = new Set(found.record.items.map((i) => i.id));
    const detail = await lists.addListItems(found.link.user_id, found.link.list_id, body.items, { addedBy });
    const addedItems = detail.items.filter((i) => !before.has(i.id));

    for (const item of addedItems) {
      await audit.record({
        userId: found.link.user_id,
        actor: "share",
        actorLabel: found.link.label,
        action: "list.item.add",
        entityId: found.link.list_id,
        detail: { itemId: item.id, text: item.text },
      });
    }

    const record = await lists.getListForShare(found.link.list_id);
    const ordered = await orderForShare(found.link, record, ctx.url);
    return sendJson(res, 201, publicShape(record, found.link, ordered));
  });

  // Real, scoped live activity feed (Git #3186). `since` (an activity_log id, not a timestamp --
  // strictly increasing, no clock-skew ambiguity) lets the page poll for only what's new since
  // its last render. Scoped to exactly this list's own real events -- see the module header and
  // audit.recentForEntity's own real WHERE clause.
  router.get("/api/public/share/:token/activity", async (_req, res, params, ctx) => {
    const found = await resolveShare(params.token);
    if (!found) throw notFound("This link is not valid any more.");
    const afterId = ctx.url.searchParams.get("since");
    const rows = await audit.recentForEntity(found.link.user_id, found.record.id, {
      limit: ctx.url.searchParams.get("limit"),
      afterId: afterId ? Number(afterId) : null,
    });
    const events = rows.map((r) => describeActivity(r, found.link.owner_name)).filter(Boolean);
    return sendJson(res, 200, { events });
  });

  return router;
}
