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
import { headingHomeAvailability, triggerHeadingHome } from "./heading-home.mjs";

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

  // Git #3216: real, location-observed "away from home, Tesla ready" outranks groceries/generic
  // -- it's the one card here that's genuinely time-sensitive (a real drive is either about to
  // start or already has), but a real appointment today still wins, same as every other kind
  // here.
  const headingHome = appointmentToday ? null : await headingHomeAvailability(userId);

  let kind = "none";
  if (appointmentToday) kind = "doctor";
  else if (headingHome) kind = "headingHome";
  else if (groceries.openCount > 0) kind = "home";
  else if (next.length > 0) kind = "generic";

  return { kind, appointmentToday, groceries, next, headingHome };
}

/** The real tap-through action itself -- fires the real Tesla commands and marks the trigger so
 *  a widget refresh in the next dedupe window doesn't repeat-fire it. `house`, if given, is the
 *  widget's own explicit override link (the other real house), not the recommended one. */
export async function triggerHeadingHomeAction(userId, house) {
  return triggerHeadingHome(userId, { house });
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
  if (data.kind === "headingHome") {
    const hh = data.headingHome;
    const alt = hh.alternatives[0]; // one real alternative link is enough for a widget-sized card
    return `
      <div class="sticker">Heading home?</div>
      <div class="title">${escapeHtml(hh.recommendedLabel)}</div>
      <div class="line">${escapeHtml(hh.vehicleDisplayName || "Tesla")} · navigation + preconditioning</div>
      <a class="action" href="?headingHome=${encodeURIComponent(hh.recommendedHouse)}">Send it</a>
      ${alt ? `<a class="action alt" href="?headingHome=${encodeURIComponent(alt.house)}">Not ${escapeHtml(hh.recommendedLabel)}? ${escapeHtml(alt.label)}</a>` : ""}`;
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
export function renderWidgetPage({ data, token, justDone, headingHomeResult }) {
  let banner = justDone ? `<div class="done">Marked done.</div>` : "";
  if (headingHomeResult) {
    const nav = headingHomeResult.navigation?.ok;
    const climate = headingHomeResult.climate?.ok;
    if (nav && climate) banner = `<div class="done">Sent -- navigation + preconditioning on the way to ${escapeHtml(headingHomeResult.targetLabel)}.</div>`;
    else if (!nav && !climate) banner = `<div class="failed">Tesla rejected both commands -- see Settings -> Tesla.</div>`;
    else banner = `<div class="failed">${nav ? "Navigation" : "Preconditioning"} sent, ${nav ? "preconditioning" : "navigation"} was rejected by Tesla -- see Settings -> Tesla.</div>`;
  }
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
  .action { display: inline-block; margin-top: 12px; margin-right: 8px; padding: 8px 14px; border-radius: 999px; background: #4f7cff; color: #fff; text-decoration: none; font-size: 14px; font-weight: 600; }
  .action.alt { background: rgba(255,255,255,.12); color: #cbd2da; }
  .done { font-size: 12px; color: #6ee7b7; margin-bottom: 8px; }
  .failed { font-size: 12px; color: #fca5a5; margin-bottom: 8px; }
</style>
</head>
<body>
  ${banner}
  ${cardHtml(data)}
</body>
</html>`;
}
