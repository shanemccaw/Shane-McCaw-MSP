# adminv2 shell

The application shell for Simulator Studio, at `/adminv2`. Layout, ribbon engine,
tab system, command palette, peek overlay, status bar. **No screens are built
yet** — this document is how you add one.

Design source: [`Design/adminv2/`](../../../../Design/adminv2/) — `handoff.md`
for the reasoning, `Admin Shell.dc.html` for the pixels. Read `handoff.md`
before changing anything here; most of what looks arbitrary is load-bearing.
`Design/adminv2/README.md` explains how to unwrap the `.dc.html` bundle and
where each section lives in it.

---

## The three rules everything follows

From `handoff.md`, and they are the reason the contracts below are shaped the
way they are:

1. **Navigation should not require memory.** You should never have to recall
   where something lives.
2. **The same thing should always be in the same place.** Muscle memory only
   forms if position is stable.
3. **A one-off task should not move you off what you were doing.**

Two consequences a screen author will run into immediately:

- **There is no left navigation and you must not add one.** The Explorer panel
  is *per-screen contextual content*, not a global tree. This was already
  rebuilt as a tab system once and that recreated the same overwhelm.
- **The shell owns all chrome.** A screen declares what it contributes; it never
  draws a ribbon, a tab, an overlay, or a peek. That indirection is what keeps
  position stable.

---

## Registering a screen

One call, at module load, plus an import in `AdminV2.tsx`.

```tsx
// src/adminv2/screens/endpoints/index.tsx
import { Boxes } from "lucide-react";
import { registerScreen } from "@/adminv2";
import { EndpointsBody } from "./EndpointsBody";

registerScreen({
  id: "endpoints",              // stable, kebab-case, unique
  title: "M365 Endpoints",      // what the Back group's large button says
  area: "endpoints",            // palette same-area boost (+60)
  icon: Boxes,
  route: "/endpoints",          // under /adminv2
  render: (ctx) => <EndpointsBody recordId={ctx.recordId} />,
});
```

Then in `AdminV2.tsx`, `import "./screens/endpoints";` — importing is what
registers it. `registerScreen` throws on a duplicate id or a contract violation,
so a mistake is a startup failure rather than a silent no-op.

Everything below is optional and additive.

---

## 1. Contributing to a fixed ribbon tab

Seven fixed tabs, and the list is closed:

`home` · `inbox` · `money` · `watch` · `view` | `git` · `run`

Git and Run render inside an amber capsule that marks them as a developer set.
`watch` is the "what needs me" tab — exceptions, dead letters, unrun migrations,
overdue invoices — and it is the one place a live count belongs.

```tsx
registerScreen({
  // ...
  ribbon: [
    {
      tab: "home",
      order: 20,                       // lower sorts left; default 100
      group: {
        label: "Endpoints",            // caption; 17px, one short line
        large: [
          { label: "All endpoints", icon: Boxes, intent: "open",
            onSelect: () => shell.navigate("/endpoints") },
        ],
        small: [
          { label: "New endpoint", icon: Plus, intent: "create", onSelect: newEndpoint },
        ],
      },
    },
  ],
});
```

### The rule that will reject your code

> A fixed tab may only **open** something, **create** something, or act **across
> everything**. Anything requiring a specific record open belongs in a
> contextual tab.

This came out of an audit — Endpoints, Money, SQL, Documents, Services and
Marketing had all drifted and were stripped. It is now enforced: every
`RibbonCommand` declares an `intent`, and `registerScreen` throws
`ShellContractError` if a `record` intent appears on a fixed tab.

| intent | meaning | fixed tab? |
|---|---|---|
| `open` | navigates to or reveals something | yes |
| `create` | makes a new thing | yes |
| `global` | acts across every record at once | yes |
| `record` | needs a specific record open | **contextual only** |

If you find yourself wanting `record` on a fixed tab, the command belongs on
your contextual tab. That is not a workaround; it is the answer.

### Group anatomy

A group may carry any combination of:

| slot | renders as |
|---|---|
| `combos` | labelled dropdown picker, left of the group |
| `large` | 68px button, 24px icon, label underneath |
| `small` | stacked 15px-icon rows to the right |
| `row` | 14px-icon commands in a run |

When a group has both a combo and a row, the combo sits left and the row stacks
vertically beside it. The shell handles that; you just declare both.

Budget: the ribbon body is **108px** and the caption takes **17px** of it.
Anything taller clips the caption. Both live in `METRICS` — do not hardcode.

### Colour

Semantic and restrained. `ACCENT.amber` = needs attention, `ACCENT.danger` =
broken or destructive, `ACCENT.green` = money in / healthy, `ACCENT.red` = money
out, `ACCENT.info` = informational. **Never blue** — blue is the primary action
colour only, and blue icons and body text were explicitly called out as hard on
the eyes.

---

## 2. Contributing a contextual tab

```tsx
registerScreen({
  // ...
  contextualTab: {
    id: "endpoint-tools",
    label: "Endpoint Tools",
    groups: [
      { label: "Request", large: [{ label: "Run", icon: Play, intent: "record", onSelect: run }] },
      { label: "Rules",   small: [/* ... */] },
    ],
  },
});
```

It appears to the right of the fixed tabs behind a rule, and is auto-selected
when a record doc opens. For a static spec the shell only shows it once a record
is genuinely open. If you need finer control, pass a function:

```tsx
contextualTab: (ctx) => ctx.recordId ? { id: "...", label: "...", groups: [...] } : null,
```

### Do not hand-author a Back group

The shell splices one in **at position 2, always**, for every contextual tab in
the app. The large button is wherever you just came from, named properly; below
it the two before that; then "Search everything".

This exists because of a specific complaint: *"I try to go right back to what I
clicked to get where I am and it's a new icon."* `handoff.md` calls it the
single highest-value consistency decision in the design. If you add your own
Back group you will get two, in different places, and you will have broken the
one thing the design is most sure about.

Mechanics live in `registry/ribbonAssembly.ts`:

- `pushTrail(trail, entry)` — most-recent-first, deduped on `kind:id`, capped at 6.
- `backGroupFrom(trail, onSearch)` — `trail[0]` is where you *are*, so the large
  button is `trail[1]`.
- `assembleContextualGroups(spec, trail, onSearch)` — the splice.

When there is nowhere to go back to, the group still renders with only "Search
everything". It is never hidden: hiding it would shift every other group one
position left, which is exactly the instability this design exists to prevent.

---

## 3. Contributing a peek

A peek is how a record is handled **without leaving**. Clicking a row in any
ribbon gallery opens one rather than navigating.

Supported kinds: `endpoint` `package` `lead` `script` `document` `tenant`
`workflow` `prompt` `service` `customer` `mail`.

```tsx
registerScreen({
  // ...
  peeks: {
    endpoint: (id) => {
      const ep = findEndpoint(id);
      if (!ep) return null;              // null lets another screen answer
      return {
        kind: "endpoint",
        eyebrow: "ENDPOINT",             // defaults to kind
        title: ep.label,
        sub: ep.path,
        icon: Boxes,
        tone: ACCENT.info,               // tints hero gradient + tile + eyebrow
        tag: "In 3 packages",
        tagTone: ACCENT.green,
        facts: [
          { label: "Weight", value: "18" },                      // 19px/800
          { label: "Last run", value: "Runs against nobody" },   // 12.5px/600, wraps
        ],
        edits: [
          { key: "path", label: "Path", value: ep.path, onChange: setPath, mono: true },
          { key: "method", label: "Method", value: ep.method,
            options: ["GET", "POST"], onChange: setMethod },
        ],
        body: { title: "Last response", content: ep.sample },
        list: {
          title: "Rules",
          rows: ep.rules.map((r) => ({
            id: r.id, mark: r.verdict, tone: verdictTone(r),
            name: r.label, sub: r.path, right: r.value,
            onSelect: () => openPeek("package", r.packageId),
          })),
        },
        open: () => openDoc({ kind: "endpoint", id, screenId: "endpoints" }),
        actions: [
          { label: "Run it", tone: "primary", onSelect: run },
          { label: "Delete", tone: "danger", confirm: true, onSelect: remove },
        ],
      };
    },
  },
});
```

Things the shell does for you, and that you therefore must not reimplement:

- **The fact row is size-aware.** A bare number (optionally with a currency
  prefix and/or a percent suffix), or anything four characters or shorter,
  renders 19px/800 and hugs its width. Everything else drops to 12.5px/600 and
  wraps to two lines. Forcing one treatment clips — that is why it is a
  measurement (`isNumericFact`) and not your choice. Set `prose: true` to force
  the small treatment on a short value that is really prose.
- **The value sits above its label**, so a fact reads as a figure with a
  caption. Do not invert it.
- **Edits write straight through.** There is no save step and no dirty state
  inside a peek; `onChange` should hit the record. Supplying `options` turns the
  field into a cycle button rather than a dropdown.
- **`confirm: true` arms in place.** The first press relabels the button to
  `<label> — press again`; only the second calls `onSelect`. There is
  deliberately no confirm dialog behind it — the user does not want to be taken
  away for a one-off. Arming resets when the peek closes *or* when a different
  record opens. Set it on anything irreversible, not just Delete.
- **Esc closes it**, but only when it is frontmost — see the unwind order below.

Open one from anywhere with `useShell().openPeek(kind, id)`.

`docLabel(kind, id)` resolves a human name for any kind + id pair by reusing
these same resolvers, so a record can never disagree with its own label in the
tab strip or the Back group.

---

## 4. Contributing palette entries

The palette is the primary way to move. Your screen's destination is added
automatically from `title` + `route`; `commands` is for everything else.

```tsx
registerScreen({
  // ...
  commands: () => [
    { id: "act:run-scan", type: "action", kind: "run", name: "Run a scan",
      sub: "Against the tenant in scope", area: "endpoints", run: runScan },
    { id: "rec:ep-1", type: "record", kind: "endpoint", name: "Sign-in logs",
      sub: "/auditLogs/signIns", tag: "in 3 packages",
      run: () => openPeek("endpoint", "ep-1") },
    { id: "ans:unpackaged", type: "answer", name: "Unpackaged endpoints",
      live: "7", run: () => navigate("/endpoints?filter=unpackaged") },
  ],
});
```

`commands` is called **on every palette open**, not cached — `answer` rows carry
live numbers and a cached figure is worse than none. Keep it cheap; read from
state you already have, do not fetch.

The four types map to the four prefixes:

| prefix | type | what it is for |
|---|---|---|
| `@` | `destination` | browse all places without knowing names |
| `>` | `action` | verbs only |
| `#` | `record` | nouns only |
| `?` | `answer` | live numbers — the number is the point, not the link |

A bare prefix lists that whole category. The empty state is recents, then
destinations, then answers, then actions, under banded headers.

`kind` drives the mono badge in the row's left gutter (`GO`, `DO`, `NOW`, `API`,
`PKG`, `SQL`, `CRM`, ...). It defaults from `type`, but set it on records — the
badge is what lets you scan a long index by shape before reading a single name.

Matching (`command/cmdScore.ts`) is layered, best first: exact name, prefix,
word-start, substring, **acronym**, then subsequence with a gap penalty. Boosts:
+60 same area, +25 for actions, +90 decaying for recency.

**Keep the acronym tier.** It is what makes `gar` find "Guest Access Review" and
what makes the palette usable without recall. It is not redundant with
subsequence matching — subsequence would rank it far below noise.

Name your commands the way a person would say them. The matcher rewards real
words; it cannot rescue a name nobody would type.

---

## 5. Galleries

A ribbon command with a `gallery` becomes a dropdown instead of a button.

```tsx
{
  label: "Packages", icon: Boxes, intent: "open", onSelect: () => {},
  gallery: {
    id: "packages",
    title: "Packages",
    searchable: true,                 // adds the filter box; 428px grows to 520px
    searchPlaceholder: "Type to narrow it down",
    rows: [
      { id: "p1", group: "Live", tile: "42", name: "Baseline security",
        head: "42 checks", sub: "Last run found 6 gaps", on: isCurrent,
        onSelect: () => openPeek("package", "p1") },
    ],
    footer: { label: "New package", onSelect: newPackage },
  },
}
```

**Rows carry real data, not labels.** A package shows its check count and what
the last run found; a script states destructive vs read-only; a document shows
when it was last generated and what it cost. That is what makes a 24-item list
pickable. A row whose `sub` restates its `name` is a row that should not exist.

`tile` is two or three monospace characters — the row's most useful number or
code, not an icon. `on` marks the current selection and shows a tick.

Rows should `openPeek`, not navigate.

---

## 6. Panels

```tsx
registerScreen({
  // ...
  left:  { title: "Explorer",   render: () => <EndpointTree /> },
  right: { title: "Properties", render: () => <EndpointProps /> },
  bottom: [
    { id: "staged", label: "Staged", count: 12, render: () => <Staged /> },
    { id: "logs",   label: "Logs",                render: () => <Logs /> },
  ],
});
```

The shell owns the header, the collapse rail, the splitter and the persisted
size. You supply the body. A screen that supplies nothing gets a stated empty
state, not an empty box.

`count` on a bottom tab is the **only** count in the shell, and only because a
queue you must clear is a number that means you must act. Nothing else carries a
badge — no folders, no sections, no tabs. Nothing is red just to be noticed.

---

## 7. The status bar

24px along the bottom, and it is the app's, not a screen's — a screen that wants
to say something says it on its own surface.

```tsx
<Shell
  statusLeft={[
    { id: "tenant", label: tenant.name, dot: TEXT.quieter, title: "Tenant in scope" },
    { id: "health", label: "all quiet", dot: ACCENT.green, onSelect: openWatch },
  ]}
  statusRight={[{ id: "copy", label: "auto copy off", onSelect: toggleCopy }]}
/>
```

Segments with an `onSelect` render as buttons; the rest render as inert text, so
read-only state does not put fake stops in the tab order.

---

## Runtime API

```tsx
const shell = useShell();

shell.navigate("/endpoints");
shell.openDoc({ kind: "endpoint", id: "ep-1", screenId: "endpoints" });
shell.openPeek("endpoint", "ep-1");
shell.openPalette();          // or just let Ctrl/Cmd K do it
shell.setDocDirty(docId, true);
shell.state;                  // read-only view of shell state
```

`openDoc` resolves the label via `docLabel`, pushes the trail, opens a tab and
focuses it. Opening a record auto-selects its contextual tab.

---

## What the shell owns and you do not

- The seven fixed tabs and their order.
- The Back group and its position.
- The peek layout, its fact sizing, and its action arming.
- The palette, its prefixes, its badges and its ranking.
- Panel headers, rails, splitters, sizes and persistence.
- `Ctrl/Cmd K`.
- **Esc's unwind order: palette → gallery → peek.** That is frontmost-first, and
  it matches the design's own z-order (palette 131, gallery 119, peek 111). A
  peek can be open *behind* the palette, and Esc must close what is actually in
  front of you.
- Layout persistence (`localStorage`, key `adminv2_shell`). Open docs, palette
  state and peek state deliberately do **not** survive a reload.

## Files

| path | what |
|---|---|
| `theme.ts` | every colour, size and elevation. Paint with these, never raw hex |
| `registry/types.ts` | all contracts, with the reasoning in doc comments |
| `registry/registry.ts` | `registerScreen`, peek dispatch, palette index, `docLabel` |
| `registry/ribbonAssembly.ts` | trail + Back-group injection |
| `command/cmdScore.ts` | the matcher |
| `command/paletteQuery.ts` | prefixes, banding, ranking, empty state |
| `shell/shellState.ts` | the reducer — all behaviour, no DOM |
| `shell/ShellContext.tsx` | provider, derived ribbon, global keys |
| `shell/Shell.tsx` | composition |
| `shell/shellRibbon.tsx` | the window's own ribbon groups (Home/Find, View/Panels) |

## Tests

`npx vitest run --config vitest.config.ts src/adminv2` — 104 tests.

`shell/Shell.test.tsx` mounts the real shell over a real registered screen and
drives it; it is the one that catches contract regressions. If you change a
contract, that file should fail.

## Known gaps

- **Write endpoints do not exist.** The Write Actions safety pattern — what will
  change, on which tenant, dry-run first — is specified in `handoff.md` but not
  built here. Build it before anything mutates a tenant, and have every other
  module copy its confirmation flow.
- **Screens.** None. The ribbon shows the shell's own Home/Find and View/Panels
  groups; every other tab is empty until screens register.
- **Overlays the design has and this shell does not**, because they belong to
  screens rather than to the shell: the document viewer (`viewerColStyle`), the
  generic modal, the right-click context menu, the sale celebration, the
  floating console, and the tenant-detail sheet. All are in
  `Admin Shell.dc.html` if and when a screen needs one.
