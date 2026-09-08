// /widget: the lightweight, token-authed page a third-party iOS "Widget Web" app screenshots for
// the Home Screen (Git #3188). No session cookie, no WebAuthn -- see src/core/widget-tokens.mjs
// and migration 044_widget_tokens.sql for why. Registered ahead of the session-cookie branch in
// server.mjs, the same way /mcp and the public share routes are.

import { Router, notFound, sendText } from "../http.mjs";
import * as audit from "../core/audit.mjs";
import { resolveWidgetToken } from "../core/widget-tokens.mjs";
import { computeNextCard, markNextEntityDone, renderWidgetPage, triggerHeadingHomeAction } from "../core/widget.mjs";
import { recentlyTriggeredHeadingHome } from "../core/places.mjs";

export function buildWidgetRouter() {
  const router = new Router();

  router.get("/widget/t/:token", async (_req, res, params, { url }) => {
    const resolved = await resolveWidgetToken(params.token);
    if (!resolved) throw notFound("This widget link is not valid any more.");

    let justDone = false;
    const doneId = url.searchParams.get("done");
    if (doneId) {
      // Real, idempotent tap-through action (contract: "at least one real tap-through action
      // works"). A plain query-string GET, not a POST -- WidgetWeb's own tappable-<a> mechanism
      // only ever performs a real navigation, never a method override, so this is the one shape
      // of "real HTTP action" actually reachable from a home-screen tap.
      try {
        await markNextEntityDone(resolved.user.id, doneId);
        justDone = true;
        await audit.record({
          userId: resolved.user.id,
          actor: "widget",
          actorLabel: resolved.label,
          action: "entity.item.done",
          entityId: doneId,
        });
      } catch {
        // Entity already gone/not owned by this user -- render the current real state below
        // rather than surfacing an error on someone's home screen.
      }
    }

    // Git #3216: the "Heading home?" quick action, same idempotent-GET tap-through shape as
    // ?done= above. Real dedupe (recentlyTriggeredHeadingHome) so a widget's own periodic
    // re-screenshot of the SAME already-tapped URL can't repeat-fire a real vehicle command.
    let headingHomeResult = null;
    const headingHomeHouse = url.searchParams.get("headingHome");
    if (headingHomeHouse) {
      if (await recentlyTriggeredHeadingHome(resolved.user.id)) {
        headingHomeResult = { navigation: { ok: true }, climate: { ok: true }, targetLabel: "already on the way" };
      } else {
        try {
          headingHomeResult = await triggerHeadingHomeAction(resolved.user.id, headingHomeHouse);
          await audit.record({
            userId: resolved.user.id,
            actor: "widget",
            actorLabel: resolved.label,
            action: "tesla.heading-home",
            detail: { house: headingHomeHouse, navigation: headingHomeResult.navigation, climate: headingHomeResult.climate },
          });
        } catch {
          // Not connected / no vehicle / no place for that house any more -- render current
          // real state below rather than surfacing a raw error on someone's home screen.
        }
      }
    }

    const data = await computeNextCard(resolved.user.id);
    return sendText(
      res,
      200,
      renderWidgetPage({ data, token: params.token, justDone, headingHomeResult }),
      "text/html; charset=utf-8",
    );
  });

  return router;
}
