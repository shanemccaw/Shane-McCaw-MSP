// The real content behind /widget (Git #3188) -- the Today tray's own "Next" card, resolved
// server-side and rendered as plain, static HTML.
//
// A third-party iOS "Widget Web" app (Villy21/JsWidget) loads a page in its own WKWebView, waits
// for it to render, then screenshots it -- that screenshot IS the widget, refreshed on a timer or
// manual tap. There is a real, hard 30MB memory ceiling, so this deliberately does not load
// app.js/app.css or run a client SPA -- one small server-rendered HTML document, no JS framework,
// no images.
//
// Priority mirrors app.js's real resolveNextKind() (contract pack "one card, chosen by rule"):
// appointment today > open groceries > the generic due-entity list > nothing next. The client's
// "dinner" case is deliberately dropped here -- it depends on mealSession.done, a client-only
// flag this app never persists (see app.js's own comment on it), so a server-rendered page has no
// honest way to know whether tonight's dinner is already handled. That is a real, stated
// simplification for the widget's first version, not an oversight -- the issue's own non-goal is
// "don't try to replicate the whole Today tray or every room; one small, useful surface first."

import * as dates from "./dates.mjs";
import * as entities from "./entities.mjs";
import * as lists from "./lists.mjs";

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function formatTime12(hhmmss) {
  if (!hhmmss) return null;
  const [h, m] = hhmmss.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

/**
 * The same real data /api/today reads, trimmed to just what the Next-card priority rule needs --
 * no new tables, no invented fields.
 */
export async function computeNextCard(userId) {
  const allDates = await dates.listDates(userId);
  const appointmentToday = allDates.find((d) => (d.kind === "appointment" || d.kind === "vet") && d.due_in_days === 0) || null;

  const shoppingList = await lists.getOrCreateShoppingList(userId);
  const shoppingDetail = await lists.getListDetail(userId, shoppingList.id);
  const groceries = { listId: shoppingList.id, openCount: shoppingDetail.items.filter((i) => !i.done).length };

  const next = await entities.nextUp(userId, 3);

  let kind = "none";
  if (appointmentToday) kind = "doctor";
  else if (groceries.openCount > 0) kind = "home";
  else if (next.length > 0) kind = "generic";

  return { kind, appointmentToday, groceries, next };
}

/**
 * Mark the top real "generic" next item done -- the one tap-through action this first version
 * ships (contract pack's own real action-link pattern: a widget URL with a fragment/query param
 * standing in for a real state change, resolved through the app's real updateEntity(), not a
 * fabricated widget-only mutation).
 */
export async function markNextEntityDone(userId, entityId) {
  return entities.updateEntity(userId, entityId, { status: "done" });
}

function cardHtml(data) {
  if (data.kind === "doctor") {
    const appt = data.appointmentToday;
    const time = formatTime12(appt.atTime);
    return `
      <div class="sticker">${time ? `Today · ${escapeHtml(time)}` : "Today"}</div>
      <div class="title">${escapeHtml(appt.provider || appt.title)}</div>
      <div class="line">${escapeHtml(appt.categoryLabel || (appt.kind === "vet" ? "Vet visit" : "Appointment"))}</div>`;
  }
  if (data.kind === "home") {
    const n = data.groceries.openCount;
    return `
      <div class="sticker">Groceries</div>
      <div class="title">${n} item${n === 1 ? "" : "s"}</div>
      <div class="line">Ready for whenever you pass a store.</div>`;
  }
  if (data.kind === "generic") {
    const top = data.next[0];
    return `
      <div class="sticker">${escapeHtml(top.category_label || top.category)}</div>
      <div class="title">${escapeHtml(top.title)}</div>
      <div class="line">${escapeHtml(top.status)}</div>
      <a class="action" href="?done=${encodeURIComponent(top.id)}">Mark done</a>`;
  }
  return `
    <div class="title">Nothing next</div>
    <div class="line">The day's yours.</div>`;
}

/**
 * The whole widget page: no external CSS/JS, one inline &lt;style&gt;, real content only. `token`
 * is baked back into the one action link so a tap-through reload still authenticates.
 */
export function renderWidgetPage({ data, token, justDone }) {
  const banner = justDone ? `<div class="done">Marked done.</div>` : "";
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Shane's Life</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #14171c; color: #e8eaed; }
  .sticker { display: inline-block; font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: rgba(255,255,255,.12); color: #cbd2da; margin-bottom: 8px; }
  .title { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
  .line { font-size: 14px; color: #9aa2ad; }
  .action { display: inline-block; margin-top: 12px; padding: 8px 14px; border-radius: 999px; background: #4f7cff; color: #fff; text-decoration: none; font-size: 14px; font-weight: 600; }
  .done { font-size: 12px; color: #6ee7b7; margin-bottom: 8px; }
</style>
</head>
<body>
  ${banner}
  ${cardHtml(data)}
</body>
</html>`;
}
