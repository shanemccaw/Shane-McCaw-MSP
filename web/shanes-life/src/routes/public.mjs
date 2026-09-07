// The no-login half of the mixed access model (contract pack Section 9).
//
// Nothing in here reads a session cookie. Access is proved entirely by the token in the URL, and
// it grants exactly one entity: no listing, no other record, no account details, and no write
// beyond ticking an item off when the link was minted with can_check.

import { Router, badRequest, forbidden, notFound, readJson, sendJson } from "../http.mjs";
import * as audit from "../core/audit.mjs";
import { setItemChecked } from "../core/entities.mjs";
import { resolveShare } from "../core/shares.mjs";

function publicShape(entity, link) {
  return {
    canCheck: link.can_check,
    sharedAs: link.label,
    expiresAt: link.expires_at,
    entity: {
      id: entity.id,
      category: entity.category,
      categoryLabel: entity.category_label,
      categoryIcon: entity.category_icon,
      categoryColor: entity.category_color,
      itemNoun: entity.category_item_noun,
      title: entity.title,
      body: entity.body,
      status: entity.status,
      occursAt: entity.occurs_at,
      updatedAt: entity.updated_at,
      data: entity.data,
      items: entity.items.map((i) => ({
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
    return sendJson(res, 200, publicShape(found.entity, found.link));
  });

  router.patch("/api/public/share/:token/items/:itemId", async (req, res, params) => {
    const found = await resolveShare(params.token);
    if (!found) throw notFound("This link is not valid any more.");
    if (!found.link.can_check) throw forbidden("This link is view-only.");

    const body = await readJson(req);
    if (body.checked === undefined) throw badRequest("checked is required");

    const checkedBy = found.link.label ? `share:${found.link.label}` : "share";
    const item = await setItemChecked(found.entity.id, params.itemId, body.checked, checkedBy);
    await audit.record({
      userId: found.link.user_id,
      actor: "share",
      actorLabel: found.link.label,
      action: "entity.item.check",
      entityId: found.entity.id,
      detail: { itemId: params.itemId, checked: Boolean(body.checked) },
    });
    return sendJson(res, 200, {
      id: item.id,
      text: item.text,
      note: item.note,
      checkedAt: item.checked_at,
      checkedBy: item.checked_by,
      data: item.data,
    });
  });

  return router;
}
