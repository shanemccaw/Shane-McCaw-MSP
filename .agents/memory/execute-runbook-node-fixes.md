---
name: Execute Runbook node — Runbook ID field and Single/Multiple tab bug
description: Two fixes to the execute_runbook builder node — missing Runbook ID input, and the Single/Multiple mode toggle silently failing to switch.
---

The Execute Runbook node's Single/Multiple execution-mode toggle derived
`isMulti` purely from whether `node.data.runbooks` (the multi-runbook text
field) was non-empty. Clicking "Multiple" while `runbookName` was empty wrote
`runbooks: ""`, so `isMulti` stayed `false` and the tab appeared to do
nothing.

**Why:** any UI mode/tab that is derived from the content of a field it also
writes to is fragile — an edge case where that field would be written as
empty defeats the derivation. Needs an explicit mode flag instead.

**How to apply:** store an explicit `runbookMode: "single" | "multiple"` in
node data on toggle click; only fall back to the "is content non-empty"
heuristic for reading pre-existing saved nodes that predate the flag. Apply
the same "explicit state, heuristic only for back-compat" pattern to any
other builder node with a derived-from-data mode toggle.

Also: `runbookId` existed in the executor as a fallback (`resolveRunbookNameById`)
but had no UI field and was only used when `runbookName` was empty. Added a
`PayloadField` for it in the Single-mode UI and flipped executor priority so
`runbookId` (when present) overrides `runbookName`, matching user expectation
that specifying an ID should win.
