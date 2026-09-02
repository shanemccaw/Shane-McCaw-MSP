# Filter Studio & Lenses (BuildConsole Shell)

## What it is
One shared filter/sort panel ("Filter Studio", `fsOpen`) covering every filterable surface in the console, plus **Lenses** — named, saved snapshots of filter state you can re-apply in one click.

## Open / close
- **Ctrl+Shift+F** or the sliders icon in the topbar toggles it (closes the Ctrl+K palette if open). The topbar icon lights up (`anyActive`) whenever any facet, on any surface, is non-default.
- Esc closes it.

## Scope model
The left rail lists **scopes**: `global` (section "LENS") plus one per surface (section "TARGETS"): Build Queue, Chats Pane, Git Board, Batter Up. Selecting a scope (`fsScope`) just changes which facet controls the right-hand panel shows — it is a navigation choice within Filter Studio, not itself a filter. Each scope row shows a live count of active facets and a `n / total` unit count for that surface (builds/chats/epics/cards). A scope with active facets can be cleared independently (`clearScope`).

## Facets (the actual filters)
Grouped by scope via `SCOPEKEYS`:
- **Global**: search text, Account, Status, Epic (`fGSearch/fGAccount/fGStatus/fGEpic`).
- **Build Queue**: state filter, set/account filters, search, model, effort, sort (`qFilter/qSetFilter/qAccountFilter/qSearch/fQModel/fQEffort/fQSort`).
- **Chats Pane**: committed search, context, account, sort (`chatQCommitted/fCCtx/fCAcct/fCSort`).
- **Git Board**: stat filter, sort (`gbStatFilter/fGbSort`).
- **Batter Up**: filter tab, epic, sort (`buFilter/fBuEpic/fBuSort`).
Global facets cascade into every surface; a surface's own facets narrow further within it. "No constraints. Everything visible" is shown when nothing is set anywhere; otherwise a dot-joined summary of active facets is shown.

## Lenses
- A **lens** is `{name, snap}` where `snap` is a plain object holding exactly the keys listed in `DEF` (the full set of facet keys above, defaults included) — i.e. a lens always captures *all* facets across *all* scopes at once, not just the currently-selected scope.
- **Save**: type a name in the "Save current lens as…" field and press Enter or click Save. Saving under a name that already exists overwrites that lens (de-duped by name).
- **Apply** (click a lens row): merges `DEF` with the lens's saved snapshot and sets it as current state — this resets any facet not present in the snapshot back to its default before applying the snapshot's values. A couple of derived draft fields (search boxes) are re-synced from the committed values on apply.
- **Delete**: the small trash icon on a lens row removes it immediately, no confirmation.
- Lenses persist to `localStorage` and reload on start; if storage is empty/corrupt it just starts with the three seeded defaults (`Unblock next`, `Opus · heavy`, `Primary sweep`).

## Key distinction from Ctrl+K
Filter Studio narrows *what's currently visible* on existing surfaces (persistent, saved, cross-surface). The Ctrl+K command center *finds and executes* things (issues, URLs, commands) in a one-off, transient search. They share the same modifier-key family (Ctrl+Shift+F vs Ctrl+K) and each closes the other when opened.
