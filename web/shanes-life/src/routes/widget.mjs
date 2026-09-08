// /widget: the lightweight, token-authed page a third-party iOS "Widget Web" app screenshots for
// the Home Screen (Git #3188). No session cookie, no WebAuthn -- see src/core/widget-tokens.mjs
// and migration 044_widget_tokens.sql for why. Registered ahead of the session-cookie branch in
// server.mjs, the same way /mcp and the public share routes are.

import { Router, notFound, sendText } from "../http.mjs";
import * as audit from "../core/audit.mjs";
import { resolveWidgetToken } from "../core/widget-tokens.mjs";
import { computeNextCard, markNextEntityDone, renderWidgetPage } from "../core/widget.mjs";

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

    const data = await computeNextCard(resolved.user.id);
    return sendText(res, 200, renderWidgetPage({ data, token: params.token, justDone }), "text/html; charset=utf-8");
  });

  return router;
}
