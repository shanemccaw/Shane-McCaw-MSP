# Simulator Studio — design handoff

The reasoning behind `Admin Shell.dc.html`. The file shows *what* it looks like; this explains *why*, so a rebuild keeps the decisions rather than just the pixels.

**Build it at `/admin-panel/adminv2`.** Everything described here belongs under that path — do not modify the existing admin panel.

Stack on the other side: React + Vite + Tailwind v4 + shadcn/ui (new-york) + Lucide, per the Shane McCaw MSP design system. The prototype is one HTML file with invented data — treat it as a clickable specification, not source to port.

---

## The problem this design solves

The existing admin panel has too many places to go. A left tree with thirty-odd nodes, screens that duplicate each other, and per-record actions scattered across pages. The stated constraint from the user: severe ADHD, and *"if I do it one way I'm always going to do it that way"* — so consistency of position matters more than density of features.

Three principles came out of that, and every layout decision follows from them:

1. **Navigation should not require memory.** You should never have to recall where something lives.
2. **The same thing should always be in the same place.** Muscle memory only forms if position is stable.
3. **A one-off task should not move you off what you were doing.**

---

## 1. There is no left navigation

Deliberately removed. It was rebuilt as a tab system first, and that recreated the same overwhelm — the problem was never the *shape* of the navigation, it was that navigation existed as a thing you had to think about at all.

Everything is reachable from the ribbon or the command palette. Do not reintroduce a sidebar.

## 2. The command palette is the primary way to move — Ctrl/Cmd K

This is the load-bearing feature. It is modelled on VS Code's Ctrl+P, which the user already relies on.

**Index** — roughly 143 entries, rebuilt on open: destinations, actions, live answers, and every record (tenants, endpoints, services, scripts, packages, leads, workflows, prompts, customers, mail).

**Prefixes** — these exist because the user cannot always remember what a thing is called:

| Prefix | Filters to | Why |
|---|---|---|
| `@` | Places to go | Browse all 20 destinations without knowing names |
| `>` | Things you can do | Verbs only |
| `#` | Records | Nouns only |
| `?` | Live numbers | Answers, not screens |

**Matching** (`cmdScore`) is layered, best first: exact name, prefix, word-start, substring, **acronym** (`gar` → Guest Access Review), then subsequence with a gap penalty. Boosts: +60 if the result type matches the area you're currently in, +25 for actions, +90 decaying for recency. Keep the acronym tier — it is what makes the palette usable without recall.

**Live values** — rows can carry a `live` field rendered as a large mono number on the right. `?` shows profit, sales against goal, MRR, overdue invoices, unrun migrations, unpackaged endpoints, queued CRM writes. These are answers, not links: the number is the point.

Empty state shows recents, then all destinations, then actions.

## 3. The ribbon is a control surface, not a menu

Seven fixed tabs: **Home · Inbox · Money · Watch · View | Git · Run**. Git and Run are visually grouped in an amber capsule as a developer set, the way Office marks special tabs.

**The rule that matters:** a fixed tab may only *open* something, *create* something, or act *across everything*. Anything requiring a specific record open belongs in a contextual tab. This was enforced by audit — Endpoints, Money, SQL, Documents, Services and Marketing all had per-record actions on their fixed tabs and were stripped.

**Watch** is the "what needs me" tab: exceptions, alerts, dead letters, unrun migrations, queued CRM writes, unpackaged endpoints, overdue invoices. The large button carries a live count.

**Group anatomy** — a group may have a `combos` picker, a `large` button, `small` stacked commands, and a `row`. When a group has both a combo and a row, the combo sits left and the row stacks vertically beside it. Ribbon body is 108px; anything taller clips the group caption.

## 4. Contextual tabs share one skeleton

The complaint that produced this: *"I try to go right back to what I clicked to get where I am and it's a new icon."*

Every contextual tab is assembled with a **Back group injected automatically at position 2**. Not hand-authored per tab — spliced in `ribbonGroups`. The large button is wherever you just came from, named properly; below it the two before that, then "Search everything".

This means the trail is in the same place on Endpoint Tools, Script Tools, Pipeline Tools, Observe Tools — everything. **Preserve this.** It is the single highest-value consistency decision in the design.

`openDoc` maintains `state.trail` (max 6, deduped). `docLabel(kind, id)` resolves a human name for any kind+id pair.

## 5. Peek — handle it without leaving

Clicking a row in any ribbon gallery opens a **peek** overlay rather than navigating. This is principle 3 made concrete.

Anatomy, consistent across every record type:
- Tinted icon tile, uppercase eyebrow naming the type, title, subtitle, status pill
- A stat row that is **size-aware**: short numeric values render 19px/800 and hug their width; prose values drop to 12.5px/600 and wrap to two lines. Do not force one treatment — it clips.
- **Edit it here** — real editable fields, writing straight through to the record
- A body section (code, prompt, mapped JSON) where relevant
- A list section (checks, rules, sections, deliverables) with rows that can drill to another peek
- Footer: "Open it properly" as a quiet escape hatch on the left, primary action right, **Delete** last

**Delete is arm-then-confirm in place** — first press arms it and the button relabels to "Delete — press again". No second dialog. The user explicitly does not want to be taken away for a one-off.

Esc closes. Supported kinds: endpoint, package, lead, script, document, tenant, workflow, prompt, service, customer.

## 6. M365 Endpoints — the hardest screen

Named by the user as the single most important. The failure it fixes: *"I can see the field but there's no path from that to a rule, so I write SQL instead."*

**The loop is: run → browse what came back → click a value → get a rule.**

- **Request bar** — method, editable path, `$select` field picker, `$filter`, `$top`. Overrides are per-endpoint, show an "overridden" badge, and Reset restores the saved request. `epUrl()` rebuilds the URL from saved-path defaults plus overrides. Parse `$select`, `$filter` and `$top` out of the saved path — there is no separate field for them, and a missing parser silently drops the filter and queries the whole tenant.
- **Property tree** — the response flattened to paths with type badges and live values. Both the mapped output and the raw response. Every leaf is clickable.
- **Rule builder** — clicking a value prefills a condition and offers **one-click candidates generated from the value's type**: numbers get `> 0`, `> current`, `> half`, `< current`; booleans get is-true / is-false; arrays get empty / not-empty; strings get is / is-not / contains. Each chip shows whether it would fire *against the result in front of you*. The operator dropdown is plain English.
- **Live rules** — every rule evaluated continuously against the current result: **fires** / **quiet** / **cannot read**. "Cannot read" means the path is not in the response, so the rule can never fire — that state must stay visible, it is the failure mode the user was blind to.
- **Pillar pill is a filter** — picking a pillar narrows the endpoint list to endpoints scoring it. Selecting an endpoint outside the filter clears it rather than appearing to do nothing.

`epEval(when, data)` is the evaluator: `path op value` supporting `is`, `is not`, `>`, `<`, `>=`, `<=`, `contains`, `is empty`, `is not empty`.

**Key namespace:** `ENDPOINTS[].key` must match the strings in `PACKAGES[].checks` (`id.`, `dat.`, `dev.`, `app.`, `cop.`, `cmp.`, `lic.`). A mismatch makes every endpoint read "in no package" and silently empties the Gaps group.

## 7. Galleries

The ribbon dropdown. Titled panel, searchable with a live "6 of 24" count, grouped with banded headers, preview tile per row, name at full weight, qualifier as a pill, detail underneath, footer action.

**Rows carry real data, not labels** — packages show check count and what the last run found; endpoints show weight, rule count and which packages run them; scripts state destructive vs read-only; documents show when one was last generated and what it cost. This is what makes a 24-item list pickable.

## 8. Conventions worth keeping

**Colour** is semantic and restrained. Green `#7fae91` money in and healthy; muted red `#c08b8b` money out; amber `#f2ca63` needs attention; `#e57a7a` broken or destructive; `#7fb4d8` informational. Blue is the primary action only. No blue icons or body text — it was explicitly called out as hard on the eyes.

**Copy** is plain and consequence-first. "Runs against nobody", "they will not apply themselves", "nothing is live until you publish", "real cost". Say what will happen, not what the control is called.

**No badge counts** unless the number means you must act. Folders, sections and tabs carry no counts. Nothing is red just to be noticed.

**Money is loud on purpose.** Profit is the headline; a sale fires a full-screen celebration with a counting-up amount. This is motivational by request, not decoration.

**Everything states its cost and reversibility.** Document generation says "real cost". CRM edits say they queue for the next Zoho sync rather than rendering as done. Destructive scripts are marked before you run them.

## 9. Known gaps

- **Write endpoints do not exist.** Read only. The Write Actions safety pattern — what will change, on which tenant, dry-run first — was specified but never built. It should be built before any endpoint mutates a tenant, and every other module should copy its confirmation flow.
- **Document Generator is on hold** and its UI has been removed.
- **All data is invented.** The design proves the shape of the interaction, not the correctness of any rule or mapping. Validating against a real tenant is the next step — the fastest version is a "paste what Graph actually returned" box on the endpoint screen.
