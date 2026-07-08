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

**Follow-up bug (two colliding "runbookId" ID spaces):** `resolveRunbookNameById`
only matches Azure's ARM resource-path IDs from `listRunbooks()`. But
`workflow_template_step_tasks.runbook_id` (and any `runbookId` value copied
from the Script Library / "Linked Runbook" dropdown) is an **internal Postgres
UUID** — a FK to `powershell_scripts.id` or `script_modules.id` — never an
Azure ARM ID. Feeding that UUID straight into `resolveRunbookNameById` always
throws "No runbook found with ID", even though the same runbook runs fine via
`kanban-auto-fire.ts`'s `resolveRunbook()`, which already had the correct
UUID → `azure_runbook_name` lookup against those two tables.

**Why:** two independent subsystems (kanban auto-fire vs. the workflow
builder's Execute Runbook node) both consume the same `runbookId` field but
had diverged on how to resolve it — one used the DB-UUID scheme, the other
assumed Azure's ARM-ID scheme. This produces the confusing symptom of "the
runbook actually ran in Azure (via kanban auto-fire) even though the workflow
node reported a resolution error" — they're two separate execution paths for
the same nominal ID, not one flaky call.

**How to apply:** any new consumer of a `runbookId`/"Linked Runbook" value
must resolve it the same way `kanban-auto-fire.ts` does — check
`powershell_scripts.id` then `script_modules.id` for a UUID match and use
`azure_runbook_name`, and only fall back to Azure's ARM-ID lookup
(`resolveRunbookNameById`) for literal Azure resource IDs. `workflow-executor.ts`
now does this via `resolveExecuteRunbookId()`.

**Runbook parameters — App Registration credentials (not raw DB IDs):**
The execute_runbook node's `clientId` field is a numeric internal user ID. The
runbooks themselves expect `TenantId`, `ClientId` (Azure AD app client ID), and
`ClientSecret` — the App Registration credentials stored in Key Vault. Passing
the raw numeric user ID as `ClientId` is wrong; the node must look up
`client_app_registrations` (status = "verified") for that user, then fetch the
secret via `getSecretValue(appReg.keyVaultSecretName)`, and send `{ TenantId,
ClientId: appReg.azureClientId, ClientSecret }` — exactly the same parameters
`kanban-auto-fire.ts` sends. If no verified App Reg exists, the node errors
with a clear message rather than sending garbage parameters to Azure.
