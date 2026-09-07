// Shane's Life -- the app shell. Plain ES modules, no framework, no build step.
//
// Every number and every row on this screen comes from a real endpoint. There is no fixture
// module anywhere in this directory and there must never be one.

const $ = (sel, root = document) => root.querySelector(sel);

const state = {
  user: null,
  route: "today",
  entity: null,
  attachment: null, // { mediaId, kind, label }
};

// ---------------------------------------------------------------------------
// fetch helpers
// ---------------------------------------------------------------------------

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof Blob) ? { "content-type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text };
    }
  }
  if (!res.ok) {
    const err = new Error(payload?.error || `${res.status} ${res.statusText}`);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? "" : v);
  }
  for (const child of [].concat(children)) {
    if (child) node.append(child);
  }
  return node;
};

function empty(message, hint) {
  return el("div", { class: "empty" }, [
    el("img", { src: "/icons/icon-192.png", alt: "" }),
    el("p", { text: message }),
    hint ? el("p", { class: "small", text: hint }) : null,
  ]);
}

function when(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const diffDays = Math.round((d - new Date()) / 86_400_000);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (diffDays === 0) return `today ${time}`;
  if (diffDays === 1) return `tomorrow ${time}`;
  if (diffDays === -1) return `yesterday ${time}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + ` ${time}`;
}

// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------

async function loadMe() {
  const me = await api("/api/me");
  state.user = me.user;
  if (me.user) setInboxBadge(me.pendingCaptures);
  return me.user;
}

function setInboxBadge(count) {
  const badge = $("#inbox-badge");
  badge.textContent = count > 0 ? String(count) : "";
  badge.hidden = !count;
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = $("#login-error");
  const submit = $("#login-submit");
  error.hidden = true;
  submit.disabled = true;
  try {
    await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: $("#email").value, password: $("#password").value }),
    });
    $("#password").value = "";
    await start();
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  } finally {
    submit.disabled = false;
  }
});

$("#sign-out").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" });
  state.user = null;
  showLogin();
});

function showLogin() {
  $("#app-view").hidden = true;
  $("#login-view").hidden = false;
  $("#email").focus();
}

// ---------------------------------------------------------------------------
// the universal capture box
// ---------------------------------------------------------------------------

const captureText = $("#capture-text");
const captureStatus = $("#capture-status");

captureText.addEventListener("input", () => {
  captureText.style.height = "auto";
  captureText.style.height = Math.min(captureText.scrollHeight, 128) + "px";
});

// Enter sends, Shift+Enter breaks the line. Capture friction is the core enemy
// (contract pack Section 2) -- reaching for a button should be optional.
captureText.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $("#capture").requestSubmit();
  }
});

function setAttachment(attachment) {
  state.attachment = attachment;
  $("#capture-attachment").hidden = !attachment;
  if (attachment) $("#capture-attachment-label").textContent = attachment.label;
}

$("#capture-attachment-clear").addEventListener("click", () => setAttachment(null));

async function uploadBlob(blob, name) {
  const media = await api("/api/media", {
    method: "POST",
    body: blob,
    headers: { "content-type": blob.type || "application/octet-stream", "x-file-name": name || "" },
  });
  return media;
}

$("#capture-photo").addEventListener("click", () => $("#capture-file").click());

$("#capture-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  captureStatus.textContent = "Attaching photo…";
  try {
    const media = await uploadBlob(file, file.name);
    setAttachment({ mediaId: media.id, kind: "photo", label: `Photo attached (${Math.round(media.byte_size / 1024)} KB)` });
    captureStatus.textContent = "";
  } catch (err) {
    captureStatus.textContent = err.message;
  }
});

let recorder = null;
let recordedChunks = [];

$("#capture-voice").addEventListener("click", async () => {
  const button = $("#capture-voice");
  if (recorder && recorder.state === "recording") {
    recorder.stop();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    captureStatus.textContent = "This browser cannot record audio. Type it or attach a photo instead.";
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => e.data.size > 0 && recordedChunks.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      button.setAttribute("aria-pressed", "false");
      const blob = new Blob(recordedChunks, { type: recorder.mimeType || "audio/webm" });
      captureStatus.textContent = "Saving voice note…";
      try {
        const media = await uploadBlob(blob, "voice-note");
        setAttachment({ mediaId: media.id, kind: "voice", label: `Voice note attached (${Math.round(media.byte_size / 1024)} KB)` });
        captureStatus.textContent = "";
      } catch (err) {
        captureStatus.textContent = err.message;
      }
    };
    recorder.start();
    button.setAttribute("aria-pressed", "true");
    captureStatus.textContent = "Recording — tap the mic again to stop.";
  } catch (err) {
    captureStatus.textContent = `Microphone unavailable: ${err.message}`;
  }
});

$("#capture").addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = captureText.value.trim();
  if (!text && !state.attachment) return;
  const send = $("#capture-send");
  send.disabled = true;
  captureStatus.textContent = "Saving…";
  try {
    await api("/api/captures", {
      method: "POST",
      body: JSON.stringify({
        text: text || null,
        mediaId: state.attachment?.mediaId ?? null,
        kind: state.attachment?.kind || "text",
      }),
    });
    captureText.value = "";
    captureText.style.height = "auto";
    setAttachment(null);
    // Trust stated facts immediately (Section 8) -- it is saved, no confirmation dialog.
    captureStatus.textContent = "Got it.";
    setTimeout(() => (captureStatus.textContent = ""), 1800);
    await loadMe();
    if (state.route === "inbox" || state.route === "today") render();
  } catch (err) {
    captureStatus.textContent = err.message;
  } finally {
    send.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// views
// ---------------------------------------------------------------------------

async function viewToday(view) {
  const data = await api("/api/today");
  setInboxBadge(data.pendingCaptures);

  const next = el("section", { class: "section" }, [el("h2", { text: "Next" })]);
  if (data.next.length === 0) {
    next.append(
      el("div", { class: "card" }, [
        el("p", { class: "muted", text: "Nothing is due. That is the whole message." }),
      ]),
    );
  } else {
    for (const item of data.next) {
      next.append(entityTile(item));
    }
  }
  view.append(next);

  if (data.pendingCaptures > 0) {
    view.append(
      el("section", { class: "section" }, [
        el("div", { class: "card" }, [
          el("div", { class: "spread" }, [
            el("div", {}, [
              el("div", { class: "title", text: `${data.pendingCaptures} waiting in the inbox` }),
              el("div", { class: "meta muted small", text: "Ask Claude to file them, or leave them. They keep." }),
            ]),
            el("a", { href: "#/inbox", class: "chip", text: "Open" }),
          ]),
        ]),
      ]),
    );
  }

  const recent = el("section", { class: "section" }, [el("h2", { text: "Recent" })]);
  if (data.recent.length === 0) {
    recent.append(
      empty("Nothing here yet.", "Type into the box below, or ask Claude to push something in over MCP."),
    );
  } else {
    for (const item of data.recent) recent.append(entityTile(item));
  }
  view.append(recent);
}

function entityTile(entity) {
  const bits = [entity.category_label || entity.category];
  if (entity.item_count) bits.push(`${entity.checked_count}/${entity.item_count} done`);
  if (entity.share_count) bits.push(`${entity.share_count} shared`);
  const at = entity.remind_at || entity.occurs_at;
  if (at) bits.push(when(at));

  return el("a", { class: "tile", href: `#/entity/${entity.id}` }, [
    el("div", { class: "title", text: entity.title }),
    el("div", { class: "meta", text: bits.join(" · ") }),
  ]);
}

async function viewInbox(view) {
  const { captures } = await api("/api/captures?status=pending");
  setInboxBadge(captures.length);

  view.append(
    el("section", { class: "section" }, [
      el("h2", { text: "Unfiled" }),
      el("p", { class: "muted small", text: "Raw, exactly as it came in. Nothing here has been classified — that happens in a Claude conversation, over MCP." }),
    ]),
  );

  if (captures.length === 0) {
    view.append(empty("The inbox is clear.", "Anything you say into the box lands here first."));
    return;
  }

  for (const capture of captures) {
    const body = [];
    if (capture.body_text) body.push(el("div", { class: "title", text: capture.body_text }));
    if (capture.media_id) {
      if (String(capture.mime_type || "").startsWith("image/")) {
        body.push(el("img", { src: `/api/media/${capture.media_id}`, alt: "Captured photo", style: "max-width:100%;border-radius:10px;margin-top:.5rem" }));
      } else {
        body.push(el("audio", { controls: true, src: `/api/media/${capture.media_id}`, style: "width:100%;margin-top:.5rem" }));
      }
    }
    body.push(
      el("div", { class: "meta", text: `${capture.source} · ${when(capture.created_at) || new Date(capture.created_at).toLocaleString()}` }),
    );
    body.push(
      el("div", { class: "row", style: "margin-top:.6rem" }, [
        el("button", {
          class: "ghost small",
          text: "Dismiss",
          onClick: async (event) => {
            event.target.disabled = true;
            await api(`/api/captures/${capture.id}/dismiss`, { method: "POST" });
            render();
          },
        }),
      ]),
    );
    view.append(el("div", { class: "card" }, body));
  }
}

async function viewThings(view) {
  const [{ entities }, { categories }] = await Promise.all([
    api("/api/entities?limit=200"),
    api("/api/categories"),
  ]);

  const used = categories.filter((c) => c.entity_count > 0);
  if (used.length > 0) {
    const chips = el("div", { class: "row" }, [
      el("a", { class: "chip", href: "#/things", text: `all ${entities.length}` }),
      ...used.map((c) => el("a", { class: "chip", href: `#/things/${c.slug}`, text: `${c.label} ${c.entity_count}` })),
    ]);
    view.append(el("section", { class: "section" }, [el("h2", { text: "Categories" }), chips]));
  }

  const filter = state.categoryFilter;
  const shown = filter ? entities.filter((e) => e.category === filter) : entities;

  const list = el("section", { class: "section" }, [
    el("h2", { text: filter ? categories.find((c) => c.slug === filter)?.label || filter : "Everything" }),
  ]);
  if (shown.length === 0) {
    list.append(
      empty(
        "Nothing filed yet.",
        "Categories are open — Claude invents the right one when it files something, so this fills itself in.",
      ),
    );
  } else {
    for (const entity of shown) list.append(entityTile(entity));
  }
  view.append(list);
}

async function viewEntity(view, entityId) {
  const entity = await api(`/api/entities/${entityId}`);

  view.append(
    el("section", { class: "section" }, [
      el("div", { class: "card" }, [
        el("div", { class: "row" }, [el("span", { class: "chip", text: entity.category_label || entity.category })]),
        el("h1", { text: entity.title, style: "margin:.5rem 0 0" }),
        entity.body ? el("p", { class: "muted", text: entity.body }) : null,
        entity.occurs_at ? el("p", { class: "meta muted small", text: `Happens ${when(entity.occurs_at)}` }) : null,
        entity.remind_at ? el("p", { class: "meta muted small", text: `Surfaces ${when(entity.remind_at)}` }) : null,
      ]),
    ]),
  );

  if (entity.items.length > 0) {
    const list = el("ul", { class: "checklist" });
    for (const item of entity.items) list.append(itemRow(entity.id, item));
    view.append(el("section", { class: "section" }, [el("h2", { text: `${entity.category_item_noun}s` }), list]));
  }

  const dataKeys = Object.keys(entity.data || {});
  if (dataKeys.length > 0) {
    view.append(
      el("section", { class: "section" }, [
        el("h2", { text: "Details" }),
        el("div", { class: "card" }, [
          el("pre", { class: "token", text: JSON.stringify(entity.data, null, 2) }),
        ]),
      ]),
    );
  }

  // Share links -- the mixed access model, from the owner's side.
  const shares = el("section", { class: "section" }, [el("h2", { text: "Shared links" })]);
  const liveShares = entity.shares.filter((s) => !s.revoked_at);
  if (liveShares.length === 0) {
    shares.append(el("p", { class: "muted small", text: "Not shared with anyone." }));
  }
  for (const share of liveShares) {
    shares.append(
      el("div", { class: "card" }, [
        el("div", { class: "spread" }, [
          el("div", {}, [
            el("div", { class: "title", text: share.label || "Unlabelled link" }),
            el("div", { class: "meta", text: `${share.can_check ? "can tick items" : "view only"} · opened ${share.view_count}x` }),
          ]),
          el("button", {
            class: "ghost small danger",
            text: "Revoke",
            onClick: async (event) => {
              event.target.disabled = true;
              await api(`/api/shares/${share.id}`, { method: "DELETE" });
              render();
            },
          }),
        ]),
      ]),
    );
  }

  const labelInput = el("input", { placeholder: "Who is this for? e.g. Ronnie", "aria-label": "Share label" });
  const result = el("div");
  shares.append(
    el("div", { class: "card" }, [
      labelInput,
      el("div", { class: "row", style: "margin-top:.6rem" }, [
        el("button", {
          class: "primary small",
          text: "Create a no-login link",
          onClick: async (event) => {
            event.target.disabled = true;
            try {
              const share = await api("/api/shares", {
                method: "POST",
                body: JSON.stringify({ entityId: entity.id, label: labelInput.value.trim() || null, canCheck: true }),
              });
              result.replaceChildren(
                el("p", { class: "small ok", text: "Copy it now — the link is shown once and cannot be recovered." }),
                el("pre", { class: "token", text: share.url }),
                el("button", {
                  class: "small",
                  text: "Copy link",
                  onClick: () => navigator.clipboard?.writeText(share.url),
                }),
              );
            } catch (err) {
              result.replaceChildren(el("p", { class: "small error", text: err.message }));
            } finally {
              event.target.disabled = false;
            }
          },
        }),
      ]),
      result,
    ]),
  );
  view.append(shares);
}

function itemRow(entityId, item) {
  const box = el("input", { type: "checkbox", ...(item.checked_at ? { checked: true } : {}) });
  const label = el("span", { class: item.checked_at ? "done" : "", text: item.text });
  const who = el("span", {
    class: "who",
    text: item.checked_by && item.checked_by !== "owner" ? `ticked by ${item.checked_by.replace(/^share:/, "")}` : "",
  });
  box.addEventListener("change", async () => {
    box.disabled = true;
    try {
      const updated = await api(`/api/entities/${entityId}/items/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ checked: box.checked }),
      });
      label.className = updated.checked_at ? "done" : "";
      who.textContent = updated.checked_by && updated.checked_by !== "owner" ? `ticked by ${updated.checked_by.replace(/^share:/, "")}` : "";
    } finally {
      box.disabled = false;
    }
  });
  return el("li", {}, [box, el("div", {}, [label, item.note ? el("span", { class: "who", text: item.note }) : null, who])]);
}

async function viewSettings(view) {
  const { tokens, endpoint } = await api("/api/mcp-tokens");

  view.append(
    el("section", { class: "section" }, [
      el("h2", { text: "Account" }),
      el("div", { class: "card" }, [
        el("div", { class: "title", text: state.user.name }),
        el("div", { class: "meta", text: state.user.email }),
        el("div", { class: "row", style: "margin-top:.75rem" }, [
          el("button", {
            class: "small danger",
            text: "Sign out everywhere",
            onClick: async () => {
              await api("/api/auth/logout-everywhere", { method: "POST" });
              showLogin();
            },
          }),
        ]),
      ]),
    ]),
  );

  const mcp = el("section", { class: "section" }, [
    el("h2", { text: "Claude (MCP)" }),
    el("p", { class: "muted small", text: "A token lets a Claude conversation write straight into this app. Everything it does is recorded under its label." }),
    el("div", { class: "card" }, [
      el("div", { class: "meta", text: "Endpoint" }),
      el("pre", { class: "token", text: endpoint }),
    ]),
  ]);

  for (const token of tokens.filter((t) => !t.revoked_at)) {
    mcp.append(
      el("div", { class: "card" }, [
        el("div", { class: "spread" }, [
          el("div", {}, [
            el("div", { class: "title", text: token.label }),
            el("div", { class: "meta", text: `${token.call_count} ${token.call_count === 1 ? "call" : "calls"} · ${token.last_used_at ? `last used ${when(token.last_used_at)}` : "never used"}` }),
          ]),
          el("button", {
            class: "ghost small danger",
            text: "Revoke",
            onClick: async (event) => {
              event.target.disabled = true;
              await api(`/api/mcp-tokens/${token.id}`, { method: "DELETE" });
              render();
            },
          }),
        ]),
      ]),
    );
  }

  const nameInput = el("input", { placeholder: "Name this connection, e.g. Claude on my phone", "aria-label": "Token label" });
  const issued = el("div");
  mcp.append(
    el("div", { class: "card" }, [
      nameInput,
      el("div", { class: "row", style: "margin-top:.6rem" }, [
        el("button", {
          class: "primary small",
          text: "Create token",
          onClick: async (event) => {
            event.target.disabled = true;
            try {
              const token = await api("/api/mcp-tokens", {
                method: "POST",
                body: JSON.stringify({ label: nameInput.value.trim() }),
              });
              issued.replaceChildren(
                el("p", { class: "small ok", text: "Shown once. Copy it now." }),
                el("pre", { class: "token", text: token.token }),
                el("p", { class: "small muted", text: "For a client that cannot set a header, use this URL instead:" }),
                el("pre", { class: "token", text: token.urlForm }),
              );
              nameInput.value = "";
            } catch (err) {
              issued.replaceChildren(el("p", { class: "small error", text: err.message }));
            } finally {
              event.target.disabled = false;
            }
          },
        }),
      ]),
      issued,
    ]),
  );
  view.append(mcp);

  const { activity } = await api("/api/activity?limit=25");
  const log = el("section", { class: "section" }, [el("h2", { text: "Recent activity" })]);
  if (activity.length === 0) {
    log.append(el("p", { class: "muted small", text: "Nothing written yet." }));
  } else {
    for (const row of activity) {
      log.append(
        el("div", { class: "tile" }, [
          el("div", { class: "title small", text: row.action }),
          el("div", { class: "meta", text: `${row.actor}${row.actor_label ? ` (${row.actor_label})` : ""} · ${new Date(row.at).toLocaleString()}` }),
        ]),
      );
    }
  }
  view.append(log);
}

// ---------------------------------------------------------------------------
// routing
// ---------------------------------------------------------------------------

const TITLES = { today: "Today", inbox: "Inbox", things: "Things", settings: "Settings", entity: "" };

function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, "");
  const [head, ...rest] = hash.split("/");
  state.route = head || "today";
  state.categoryFilter = state.route === "things" ? rest[0] || null : null;
  state.entity = state.route === "entity" ? rest[0] : null;
}

async function render() {
  parseRoute();
  const view = $("#view");
  view.replaceChildren();
  $("#view-title").textContent = TITLES[state.route] ?? "";

  for (const tab of document.querySelectorAll(".tabs a")) {
    if (tab.dataset.tab === state.route) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  }

  try {
    if (state.route === "inbox") await viewInbox(view);
    else if (state.route === "things") await viewThings(view);
    else if (state.route === "settings") await viewSettings(view);
    else if (state.route === "entity") await viewEntity(view, state.entity);
    else await viewToday(view);
  } catch (err) {
    if (err.status === 401) return showLogin();
    view.replaceChildren(el("div", { class: "card" }, [el("p", { class: "error", text: err.message })]));
  }
}

window.addEventListener("hashchange", render);

async function start() {
  const user = await loadMe();
  if (!user) return showLogin();
  $("#login-view").hidden = true;
  $("#app-view").hidden = false;
  await render();
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {
    // A failed registration costs offline caching only; the app still works online.
  });
}

start().catch((err) => {
  console.error(err);
  showLogin();
});
