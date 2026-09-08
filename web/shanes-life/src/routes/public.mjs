// The no-login half of the mixed access model (contract pack Section 9).
//
// Nothing in here reads a session cookie. Access is proved entirely by the token in the URL, and
// it grants exactly one real row: no listing, no other record, no account details, and no write
// beyond ticking an item off when the link was minted with can_check. The row can be a generic
// entity or a room's own typed table (Git #3116) -- resolveShare already normalised it, so this
// route only branches on entity_kind for the one write it needs to route to the right table.

import { Router, badRequest, forbidden, notFound, readJson, sendJson } from "../http.mjs";
import * as audit from "../core/audit.mjs";
import { setItemChecked } from "../core/entities.mjs";
import { setListItemChecked } from "../core/lists.mjs";
import { resolveShare } from "../core/shares.mjs";

function publicShape(record, link) {
  return {
    canCheck: link.can_check,
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
      items: record.items.map((i) => ({
        id: i.id,
        text: i.text,
        note: i.note,
        checkedAt: i.checked_at,
        checkedBy: i.checked_by,
        data: i.data,
      })),
    },
  };
}

export function buildPublicRouter() {
  const router = new Router();

  router.get("/api/public/share/:token", async (_req, res, params) => {
    const found = await resolveShare(params.token, { countView: true });
    if (!found) throw notFound("This link is not valid any more.");
    return sendJson(res, 200, publicShape(found.record, found.link));
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
        ? await setListItemChecked(found.link.list_id, params.itemId, body.checked)
        : await setItemChecked(found.record.id, params.itemId, body.checked, checkedBy);
    if (!item) throw notFound("Item not found");

    await audit.record({
      userId: found.link.user_id,
      actor: "share",
      actorLabel: found.link.label,
      action: found.link.entity_kind === "list" ? "list.item.check" : "entity.item.check",
      entityId: found.record.id,
      detail: { itemId: params.itemId, checked: Boolean(body.checked) },
    });
    return sendJson(res, 200, {
      id: item.id,
      text: item.text,
      note: item.note,
      checkedAt: item.checked_at,
      checkedBy: item.checked_by ?? checkedBy,
      data: item.data,
    });
  });

  return router;
}
