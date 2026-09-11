# Handoff: Chats Panel

A visual reference for the **Chats** side panel used in BuildConsole Shell: the list of Epics, each holding
its chat threads, with a search field and "New Chat" action.

**Visual UI only.** This handoff covers appearance and layout, not behavior, navigation, or click targets.
The prototype has no working interactions (the search input is inert, buttons and rows do not navigate) —
treat it purely as a static reference for colors, type, spacing, and structure.

## About the design files

`Chats Panel.dc.html` is a **static HTML mockup**, not production code. Open it in a browser to see it
rendered; recreate the visuals in the target codebase's own environment and patterns.

Files in this bundle:

- `Chats Panel.dc.html` — the mockup (template + placeholder data in one file).
- `support.js`, `lucide-local.js` — mockup runtime and icon set. Reference only.
- `screenshots/` — three reference captures (listed below).

## Fidelity

**High-fidelity on visuals**: colors, type sizes, spacing and card geometry are final. Epic names, numbers,
chat titles, percentages and context values are placeholder data.

## Layout

Panel: `280px` wide, dark theme. `background:#161b22`, `1px solid #30363d` border, `8px` radius.

1. **Header** — `36px` tall, bottom border `#30363d`. Label "CHATS", 14px/600, uppercase, tracking .04em, `#8b949e`.
2. **Body** — scrollable column, `8px` padding, `10px` gap between items. Custom scrollbar: 13px wide, thumb `#2e3742`.
3. **Search field** — `28px` tall, `#0d1117` fill, `1px solid #262c36` border, `7px` radius. Left icon (Lucide `locate`, 12px, `#576069`),
   monospace placeholder text 10.5px, right-aligned `↵` hint in a small bordered chip.
4. **New Chat button** — `30px` tall, full width, `7px` radius, `#25497a` fill, `#cfe4fb` text, 11px/700. Plus icon, label, chevron icon (flipped 180° while its dropdown is open).
5. **Epic cards** — one per Epic, stacked with 10px gaps. `background:#12161d`, `1px solid #262c36` border, `9px` radius.

### Epic card

- **Header row**: 24×24 tile (`message-square` icon) tinted to the Epic's accent color · `#num` pill (mono 14px/800, tinted fill/border/text) ·
  Epic name (10px/600, uppercase, tracking .05em, `#8b949e`) · subtitle below (8.5px mono, `#576069`, e.g. "4 chats · last Just now") · chevron-right at far right.
- **Progress bar** (when present): thin 3px track (`#0d1117`), fill colored green ≥100%, amber ≥50%, else the Epic's accent; percentage label in mono 8px/800 to the right.
- **Expanded state**: a vertical rail line down the left, then one row per chat, plus a dashed "+ Continue in a new chat" button at the bottom (accent-tinted text and dashed border).

### Chat row

`background:#0e1420`, rounded 8px, tinted border. Contents: small color dot · chat name — `[#num] EpicName`
(11px/600, `#dbe1e6`, matching every chat filed under that epic) · right-aligned context usage — a label
like "576k / 900k ctx" (mono 8px/800, green under 70%, amber 70–99%, red at 100%)
above a 34×3px mini progress bar in the same color. Fully-used chats (100% context) render at reduced opacity.

A sub-epic (e.g. "SUB-EPIC #1494 · MICROSOFT CHANGES") appears as a small uppercase mono divider label between
chat rows when an Epic has one; its chats are indented slightly and follow the same row style.

### New Chat dropdown

Clicking "New Chat" flips its chevron 180° and reveals an inline panel below the button (not a popover) —
`background:#0e1420`, `1px solid #262c36` border, `8px` radius, full width of the column. This replaces the
app's current modal dialog for this flow.

1. **Explainer row** — 9.5px `#8b949e` text: "Which feature is this chat about? The chat gets filed under it,
   so builds and issues from the conversation land in the right place." Bottom border `#1a1f27`.
2. **Anchor rows** — one per epic/gate you can file the chat under: an accent-tinted `#num` pill (mono
   11px/800, pill radius) followed by its `EPIC: <name>` or `GATE: <name>` label (10px/600, uppercase,
   tracking .03em, `#8b949e`), same line. Each row bottom-bordered `#1a1f27`, hover fill `#161b22`.
3. **"No feature yet — decide later"** — closing row, dashed empty dot, 11px/600 `#8b949e` text, no border.

This is a visual design only — no interaction is wired up.

## Epic accent colors (sample data)

`#1202 Build Console` amber `#e2984a` · `#1485 Portal` blue `#79b3c8` · `#1096 Application Core` indigo `#7c8cf0` ·
`#1095 Admin Panel` gold `#c8a86a` · `#1571 Portal Admin` teal `#37b8b0` · `#1281 GATE: v1.1 Release` violet `#c084fc`.

## Design tokens

Background `#161b22` (panel), `#12161d` (card), `#0e1420` (row), `#0d1117` (page/track) · borders `#30363d`, `#262c36`, `#1d232c` ·
text `#e6edf3` / `#dbe1e6` / `#8b949e` / `#576069` / `#3f4756` · state colors: green `#7fb08a`/`#7fb08a`, amber `#c8a86a`/`#c9ab72`, red `#c08a84`.

Type: system UI stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`) for labels and names;
`Consolas, ui-monospace, Menlo, monospace` for every number, `#id`, percentage and context value.
Sizes in use: 8, 8.5, 9, 10, 10.5, 11, 14 px. Eyebrow-style text is uppercase with letter-spacing .04–.05em.

Radii: 4–7px on pills and tiles, 7–9px on cards, 99px on pills/dots/bars.

## Screenshots (`screenshots/`)

- `chats-panel-top.png` — default view: header, search field, New Chat button, Build Console epic expanded with its chats.
- `chats-panel-subepic.png` — Portal epic expanded, showing a sub-epic divider and its nested chat.
- `chats-panel-bottom.png` — collapsed epic cards (Portal, Application Core, Admin Panel, Portal Admin, Gate: v1.1 Release) scrolled to the end of the list.
- `chats-panel-new-chat-dropdown.png` — the New Chat dropdown open, showing target epic, topic, model, context and launch controls.

## Assets

Icons: Lucide, 2px stroke — `locate, plus, chevron-down, message-square, chevron-right, check`. No images.

## Files

- `Chats Panel.dc.html` — the mockup. Template (markup, inline styles) at the top; a small logic block at the bottom holds only
  placeholder sample data and per-item style strings — no event handlers, no navigation, no state beyond icon rendering.
