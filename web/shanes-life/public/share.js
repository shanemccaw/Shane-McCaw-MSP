// The no-login share page.
//
// It talks to exactly two endpoints, both of which authenticate purely on the token in the URL.
// There is no session, no cookie, and nothing here can reach any other record.
//
// Visual language (Git #3184, design "Shanes Life 12 - Shared list.dc.html", option 1t): teal
// badge/checkmarks in place of the private app's blue, inline title/subtitle instead of a chrome
// header row. Interaction stays check-off-only, matching what `core/shares.mjs` actually allows
// a share link to do today -- the design's own final decision (turn 2 / option 2a) additionally
// specifies Flat/Category/Best-path ordering, an add box and live activity for this page, none of
// which the current architecture supports (share links can only ever tick an item, by design,
// Git #3116). That's a real product/security-scope question, filed as a follow-up rather than
// guessed at here -- see the #3184 bookend and the issue filed under #3086.

const token = decodeURIComponent(location.pathname.replace(/^\/s\/?/, ""));
const view = document.getElementById("view");

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
  view.replaceChildren(
    el("div", { class: "empty" }, [
      el("img", { src: "/icons/icon-192.png", alt: "" }),
      el("p", { text: message }),
    ]),
  );
}

async function load() {
  if (!token) return fail("This link is missing its code.");
  let data;
  try {
    const res = await fetch(`/api/public/share/${encodeURIComponent(token)}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return fail(body.error || "This link is not valid any more.");
    }
    data = await res.json();
  } catch {
    return fail("Could not reach the list. Check your connection and pull to refresh.");
  }

  const entity = data.entity;
  document.title = entity.title;

  const leftCount = entity.items.filter((i) => !i.checkedAt).length;
  const subtitleParts = [];
  if (data.sharedBy) subtitleParts.push(`From ${data.sharedBy}`);
  subtitleParts.push(entity.items.length === 0 ? "Nothing on this list yet" : `${leftCount} left`);
  subtitleParts.push(data.canCheck ? "live for everyone on this link" : "view only");

  const nodes = [
    el("div", { class: "row" }, [el("span", { class: "chip teal", text: "Shared link · no sign-in" })]),
    el("h1", { class: "share-title", text: entity.title }),
    el("p", { class: "share-subtitle", text: subtitleParts.join(" · ") }),
  ];
  if (entity.body) nodes.push(el("p", { class: "muted", text: entity.body }));

  if (entity.items.length === 0) {
    nodes.push(el("p", { class: "muted", text: "Nothing on this list yet." }));
    view.replaceChildren(...nodes);
    return;
  }

  const list = el("ul", { class: "checklist" });
  for (const item of entity.items) {
    const box = el("input", {
      type: "checkbox",
      ...(item.checkedAt ? { checked: true } : {}),
      ...(data.canCheck ? {} : { disabled: true }),
      "aria-label": item.text,
    });
    const label = el("span", { class: item.checkedAt ? "done" : "", text: item.text });
    const note = el("span", { class: "note", text: item.note || "" });

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
        label.className = updated.checkedAt ? "done" : "";
      } catch (err) {
        box.checked = !box.checked;
        note.textContent = err.message;
      } finally {
        box.disabled = !data.canCheck;
      }
    });

    list.append(el("li", {}, [box, el("div", {}, [label, note])]));
  }
  nodes.push(list);
  view.replaceChildren(...nodes);
}

load();
