// The no-login share page.
//
// It talks to exactly the public endpoints below, all of which authenticate purely on the token
// in the URL. There is no session, no cookie, and nothing here can reach any other record.
//
// Visual language (Git #3184, design "Shanes Life 12 - Shared list.dc.html", option 1t): teal
// badge/checkmarks in place of the private app's blue, inline title/subtitle instead of a chrome
// header row.
//
// Git #3186 (real, explicit decision from Shane on #3086's follow-up issue): the design's own
// final decision (turn 2 / option 2a) additionally specifies Flat/Category/Best-path ordering,
// an add box, and live activity for this page -- all real now, gated exactly the way the
// decision comment asked: Flat/Category are a pure function of item text, so every check-off
// link gets them; Best-path additionally needs the list's real store + aisle map, so it only
// shows on a can_add-enabled link; the add box only shows when canAdd is true; the activity line
// shows whenever there's real activity to show, since it narrates the same list state either
// kind of link can already see via a refresh, not a new privacy exposure. Barcode scan is a
// deliberate scope cut for this build, not an oversight -- see the #3186 completion comment.

const token = decodeURIComponent(location.pathname.replace(/^\/s\/?/, ""));
const view = document.getElementById("view");
const MODE_KEY = `sl_share_order_${token}`;
const POLL_MS = 5000;

let mode = localStorage.getItem(MODE_KEY) || "flat";
let lastEventId = null;
let latestActivityText = null;
let pollTimer = null;
let addBusy = false;

const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? "" : v);
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
};

function fail(message) {
  document.title = "Shared";
  if (pollTimer) clearInterval(pollTimer);
  view.replaceChildren(
    el("div", { class: "empty" }, [
      el("img", { src: "/icons/icon-192.png", alt: "" }),
      el("p", { text: message }),
    ]),
  );
}

async function fetchShare() {
  const res = await fetch(`/api/public/share/${encodeURIComponent(token)}?order=${mode}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "This link is not valid any more.");
  }
  return res.json();
}

async function fetchActivity() {
  const params = new URLSearchParams();
  if (lastEventId) params.set("since", String(lastEventId));
  try {
    const res = await fetch(`/api/public/share/${encodeURIComponent(token)}/activity?${params}`);
    if (!res.ok) return [];
    const body = await res.json();
    return body.events || [];
  } catch {
    return [];
  }
}

/** One checklist row -- same shape for a flat item, a category-grouped item, or a Best-path
 *  grouped item. A Best-path item additionally carries a real `aisleNote` (store_aisles' own
 *  shelf note, e.g. "left, 2nd row") whenever core/shopping-order.mjs matched one -- shown in
 *  preference to the item's own `note`, which may not have been re-saved onto this specific row
 *  yet (see core/lists.mjs's setListItemNote), so a fresher match still surfaces here. */
function itemRow(item, canCheck) {
  const box = el("input", {
    type: "checkbox",
    ...(item.checkedAt ? { checked: true } : {}),
    ...(canCheck ? {} : { disabled: true }),
    "aria-label": item.text,
  });
  const label = el("span", { class: item.checkedAt ? "done" : "", text: item.text });
  const note = el("span", { class: "note", text: item.aisleNote || item.note || "" });

  box.addEventListener("change", async () => {
    box.disabled = true;
    try {
      const res = await fetch(`/api/public/share/${encodeURIComponent(token)}/items/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ checked: box.checked }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not save that.");
      const updated = await res.json();
      item.checkedAt = updated.checkedAt;
      label.className = updated.checkedAt ? "done" : "";
    } catch (err) {
      box.checked = !box.checked;
      note.textContent = err.message;
    } finally {
      box.disabled = !canCheck;
    }
  });

  return el("li", {}, [box, el("div", {}, [label, note])]);
}

function itemList(items, canCheck) {
  const list = el("ul", { class: "checklist" });
  for (const item of items) list.append(itemRow(item, canCheck));
  return list;
}

/** Renders whatever shape the requested `order` actually returned -- flat is a plain `items`
 *  array; category/best are `groups` (+ an Best-path-only `unknown` tail), same real shapes
 *  core/shopping-order.mjs already produces for the owner's own Shopping room. */
function renderItems(entity, canCheck) {
  const wrap = el("div", { class: "share-items" });
  if (entity.order === "category" || entity.order === "best") {
    for (const group of entity.groups) {
      const label = entity.order === "best" ? `Aisle ${group.aisle}` : group.category;
      wrap.append(el("div", { class: "shop-group-label", text: label }), itemList(group.items, canCheck));
    }
    if (entity.unknown?.length) {
      wrap.append(
        el("p", { class: "small muted", style: "font-style:italic;margin:0.4rem 0 0", text: "No spot known yet — say the aisle when you find it." }),
        itemList(entity.unknown, canCheck),
      );
    }
  } else {
    wrap.append(itemList(entity.items, canCheck));
  }
  return wrap;
}

function orderToggle(entity, canAdd, onChange) {
  const modes = [["flat", "Flat"], ["category", "Category"]];
  if (canAdd) modes.push(["best", "Best path"]);
  if (!canAdd && mode === "best") mode = "flat"; // a link's own capability can change server-side
  return el(
    "div",
    { class: "shop-segment" },
    modes.map(([m, label]) =>
      el("button", {
        type: "button",
        class: `shop-segment-btn${mode === m ? " active" : ""}`,
        text: label,
        onClick: () => {
          mode = m;
          localStorage.setItem(MODE_KEY, mode);
          onChange();
        },
      }),
    ),
  );
}

function addBox(onAdd) {
  const input = el("input", { placeholder: "Add, or say where you found it", "aria-label": "Add an item" });
  const status = el("p", { class: "small error" });
  const submit = async () => {
    const text = input.value.trim();
    if (!text || addBusy) return;
    addBusy = true;
    status.textContent = "";
    try {
      await onAdd(text);
      input.value = "";
    } catch (err) {
      status.textContent = err.message;
    } finally {
      addBusy = false;
    }
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  });
  return el("div", { class: "share-add" }, [
    el("div", { class: "share-add-row" }, [input, el("button", { class: "primary small", text: "Add", onClick: submit })]),
    status,
  ]);
}

function activityBanner(text) {
  return el("div", { class: "card share-activity" }, [
    el("div", {}, [
      el("div", { class: "share-activity-text", text }),
      el("div", { class: "share-activity-live", text: "Live · everyone on this link sees the same list" }),
    ]),
  ]);
}

async function render() {
  let data;
  try {
    data = await fetchShare();
  } catch (err) {
    return fail(err.message);
  }

  const entity = data.entity;
  document.title = entity.title;

  const flatCount = entity.order === "flat" ? entity.items.length : (entity.groups || []).reduce((n, g) => n + g.items.length, 0) + (entity.unknown?.length || 0);
  const leftCount =
    entity.order === "flat"
      ? entity.items.filter((i) => !i.checkedAt).length
      : (entity.groups || []).reduce((n, g) => n + g.items.filter((i) => !i.checkedAt).length, 0) +
        (entity.unknown || []).filter((i) => !i.checkedAt).length;

  const subtitleParts = [];
  if (data.sharedBy) subtitleParts.push(`From ${data.sharedBy}`);
  subtitleParts.push(flatCount === 0 ? "Nothing on this list yet" : `${leftCount} left`);
  subtitleParts.push(data.canCheck ? "live for everyone on this link" : "view only");

  const nodes = [
    el("div", { class: "row" }, [el("span", { class: "chip teal", text: "Shared link · no sign-in" })]),
    el("h1", { class: "share-title", text: entity.title }),
    el("p", { class: "share-subtitle", text: subtitleParts.join(" · ") }),
  ];
  if (entity.body) nodes.push(el("p", { class: "muted", text: entity.body }));

  if (flatCount > 0) nodes.push(orderToggle(entity, data.canAdd, render));

  if (latestActivityText) nodes.push(activityBanner(latestActivityText));

  if (flatCount === 0) {
    nodes.push(el("p", { class: "muted", text: "Nothing on this list yet." }));
  } else {
    nodes.push(renderItems(entity, data.canCheck));
  }

  if (data.canAdd) {
    nodes.push(
      addBox(async (text) => {
        const res = await fetch(`/api/public/share/${encodeURIComponent(token)}/items`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ items: [{ text }] }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not add that.");
        await render();
      }),
    );
  }

  view.replaceChildren(...nodes);
}

/** Patches the activity banner's own text in place when it already exists, so a new event
 *  doesn't force a full re-render (and doesn't interrupt someone mid check-toggle or mid-type
 *  in the add box). The very first event of the page's lifetime still needs one real render to
 *  create the banner element at all. */
async function pollActivity() {
  const events = await fetchActivity();
  if (events.length === 0) return;
  // Events arrive newest-first; the highest id becomes the new cursor either way.
  lastEventId = events.reduce((max, e) => Math.max(max, e.id), lastEventId || 0);
  latestActivityText = events[0].text;
  const textEl = view.querySelector(".share-activity-text");
  if (textEl) textEl.textContent = latestActivityText;
  else await render();
}

async function start() {
  if (!token) return fail("This link is missing its code.");
  await render();
  await pollActivity();
  pollTimer = setInterval(pollActivity, POLL_MS);
  // Full re-render on a slower cadence too, so a check/add from the OTHER side of the link (or
  // the owner's own app) shows up here without the visitor doing anything -- the activity poll
  // above only patches the banner text, never full list state. Skipped while the add box has
  // focus, so a full rebuild never wipes out something the visitor is mid-typing.
  setInterval(() => {
    const typing = document.activeElement?.closest?.(".share-add");
    if (!document.hidden && !typing) render();
  }, POLL_MS * 2);
}

start();
