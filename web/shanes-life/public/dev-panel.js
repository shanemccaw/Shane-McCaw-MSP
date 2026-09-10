// Shane's Life -- the real dev floaty panel (Git #3146). Real port of the First Slice
// Prototype's own four dev tweaks (README "Prototype tweaks": `today`, `weather`, `sky`,
// `nextDemo`) into the real production app, as a genuine always-accessible overlay (not buried
// in Settings, per the issue's own framing) -- never shown by default, only once dev mode is
// turned on for this device (see dev-overrides.js's own header for the real gating mechanism).
//
// Plain DOM, no build step, matching every other module in this directory. Deliberately its own
// small file rather than folded into app.js: a dev-only tool shouldn't add weight to the reading
// of the real product code around it.

import {
  getDevOverrides,
  setDevOverride,
  resetDevOverrides,
  onDevOverridesChange,
  isDevModeEnabled,
} from "./dev-overrides.js";

const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? "" : v);
  }
  for (const child of [].concat(children)) {
    if (child) node.append(child);
  }
  return node;
};

// Real option lists -- `weather`/`sky` are the prototype's own enums verbatim (README
// "Prototype tweaks"). `nextDemo` follows the real production `resolveNextKind()` output values
// (app.js) rather than the prototype's own `groceries|rental|work|walmart` -- those were the
// prototype's location-demo concepts (a `where` state this real app never built, since it has no
// location feed yet, see build-journal/3144.md); overriding to a kind the real app doesn't
// produce would just render nothing. Same real "prototype vs. what's actually wired" tie-break
// theme.js already documents for `themeFor`.
const WEATHER_OPTIONS = [
  ["live", "Live"],
  ["sun", "Sun"],
  ["moon", "Moon"],
  ["cloud", "Cloud"],
  ["rain", "Rain"],
  ["storm", "Storm"],
  ["snow", "Snow"],
];
const SKY_OPTIONS = [
  ["auto", "Auto"],
  ["dawn", "Dawn"],
  ["day", "Day"],
  ["dusk", "Dusk"],
  ["night", "Night"],
];
const NEXT_DEMO_OPTIONS = [
  ["auto", "Auto"],
  ["doctor", "Doctor appt"],
  ["headingHome", "Heading home"],
  ["dinner", "Dinner"],
  ["home", "Groceries"],
  ["generic", "Other due item"],
  ["none", "Nothing next"],
];

function select(id, options, value, onChange) {
  const node = el("select", { id, class: "dev-panel-select", onChange: (e) => onChange(e.target.value) });
  for (const [v, label] of options) {
    node.append(el("option", { value: v, text: label, ...(v === value ? { selected: true } : {}) }));
  }
  return node;
}

function row(labelText, control) {
  return el("label", { class: "dev-panel-row" }, [el("span", { class: "dev-panel-label", text: labelText }), control]);
}

const PANEL_STYLE = `
.dev-panel-toggle{position:fixed;right:14px;bottom:88px;z-index:9000;width:44px;height:44px;border-radius:999px;
  background:#1F2937;color:#FDE68A;border:1.5px solid rgba(253,224,71,.45);font-size:19px;line-height:1;
  display:flex;align-items:center;justify-content:center;box-shadow:0 6px 18px rgba(0,0,0,.4);cursor:pointer}
.dev-panel{position:fixed;right:14px;bottom:140px;z-index:9000;width:240px;max-width:calc(100vw - 28px);
  background:#111827;color:#F8FAFC;border:1.5px solid rgba(253,224,71,.35);border-radius:14px;
  box-shadow:0 12px 32px rgba(0,0,0,.5);padding:12px 14px 14px;font:13px/1.4 system-ui,sans-serif}
.dev-panel-title{font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.dev-panel-close{background:none;border:none;color:#94A3B8;font-size:15px;cursor:pointer;padding:2px 4px}
.dev-panel-row{display:block;margin-bottom:8px}
.dev-panel-label{display:block;color:#94A3B8;font-size:11px;text-transform:uppercase;letter-spacing:.03em;margin-bottom:3px}
.dev-panel-input,.dev-panel-select{width:100%;box-sizing:border-box;background:#1F2937;color:#F8FAFC;
  border:1px solid rgba(148,163,184,.35);border-radius:8px;padding:6px 8px;font-size:13px}
.dev-panel-reset{width:100%;margin-top:4px;background:rgba(248,113,113,.14);color:#FCA5A5;
  border:1px solid rgba(248,113,113,.35);border-radius:999px;padding:7px 10px;font-size:12px;font-weight:600;cursor:pointer}
`;

/** Mounts the floating toggle + panel once, if (and only if) dev mode is enabled for this
 *  device. Called once from app.js's start(). Re-renders the current room on every override
 *  change so scope item 3's "real live effect" actually shows without a manual refresh. */
export function mountDevPanel(onOverrideChange) {
  if (!isDevModeEnabled()) return;

  document.head.append(el("style", { text: PANEL_STYLE }));

  let open = false;
  const panelSlot = el("div");
  const toggle = el("button", {
    type: "button",
    class: "dev-panel-toggle",
    text: "\u{1F6E0}", // (wrench)
    "aria-label": "Dev floaty panel",
    onClick: () => {
      open = !open;
      renderPanel();
    },
  });

  function renderPanel() {
    panelSlot.innerHTML = "";
    if (!open) return;
    const o = getDevOverrides();

    const todayInput = el("input", {
      class: "dev-panel-input",
      type: "text",
      placeholder: "e.g. 12/25/2026",
      value: o.today || "",
      onChange: (e) => setDevOverride("today", e.target.value.trim()),
    });

    const panel = el("div", { class: "dev-panel" }, [
      el("div", { class: "dev-panel-title" }, [
        el("span", { text: "Dev overrides" }),
        el("button", { type: "button", class: "dev-panel-close", text: "✕", "aria-label": "Close", onClick: () => { open = false; renderPanel(); } }),
      ]),
      row("Today", todayInput),
      row("Weather", select("dev-weather", WEATHER_OPTIONS, o.weather, (v) => setDevOverride("weather", v))),
      row("Sky", select("dev-sky", SKY_OPTIONS, o.sky, (v) => setDevOverride("sky", v))),
      row("Next", select("dev-next", NEXT_DEMO_OPTIONS, o.nextDemo, (v) => setDevOverride("nextDemo", v))),
      el("button", { type: "button", class: "dev-panel-reset", text: "Reset to auto/live", onClick: () => resetDevOverrides() }),
    ]);
    panelSlot.append(panel);
  }

  document.body.append(toggle, panelSlot);

  onDevOverridesChange(() => {
    renderPanel();
    if (typeof onOverrideChange === "function") onOverrideChange();
  });
}
