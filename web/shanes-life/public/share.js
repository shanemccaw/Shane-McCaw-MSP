// The no-login share page.
//
// It talks to exactly two endpoints, both of which authenticate purely on the token in the URL.
// There is no session, no cookie, and nothing here can reach any other record.

const token = decodeURIComponent(location.pathname.replace(/^\/s\/?/, ""));
const view = document.getElementById("view");
const titleEl = document.getElementById("title");
const modeEl = document.getElementById("mode");

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
  titleEl.textContent = "Shared";
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
  titleEl.textContent = entity.title;
  modeEl.textContent = data.canCheck ? "you can tick things off" : "view only";

  view.replaceChildren();
  if (entity.body) view.append(el("p", { class: "muted", text: entity.body }));

  if (entity.items.length === 0) {
    view.append(el("p", { class: "muted", text: "Nothing on this list yet." }));
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
    const who = el("span", { class: "who", text: item.note || "" });

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
        who.textContent = err.message;
      } finally {
        box.disabled = !data.canCheck;
      }
    });

    list.append(el("li", {}, [box, el("div", {}, [label, who])]));
  }
  view.append(list);

  if (data.sharedAs) {
    view.append(el("p", { class: "muted small", text: `Shared with ${data.sharedAs}.` }));
  }
}

load();
