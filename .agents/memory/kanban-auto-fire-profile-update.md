---
name: kanban-auto-fire vs processRunInBackground
description: Automated kanban runbooks go through kanban-auto-fire.ts, not processRunInBackground; any post-run side-effects must exist in both code paths
---

## The rule

When a client's App Registration is verified, runbooks fire automatically through `kanban-auto-fire.ts::runInBackground()`. This is a completely separate code path from `admin-m365-run.ts::processRunInBackground()` (which handles manual admin-panel "Run Script" button clicks).

Any logic that must run after every script completion — profile updates, health snapshots, score impacts — **must be implemented in both files**.

**Why:** The two paths were written independently and diverged. `processRunInBackground` had `applyProfileUpdates` + `snapshotHealthFromProfile` all along; `kanban-auto-fire` only stored `profileUpdates` in `script_run_results` but never applied them to `client_m365_profiles`. This caused the M365 Profile to stay empty even after successful automated runs.

**How to apply:**

- Any new post-run side-effect: add it to `kanban-auto-fire.ts::runInBackground()` AND `admin-m365-run.ts::processRunInBackground()`.
- To avoid duplication, extract shared helpers into `artifacts/api-server/src/lib/` (e.g. `m365-profile-update.ts` for `applyProfileUpdates` / `snapshotHealthFromProfile`).
- The shared lib pattern: define the function once in a lib file, import it in both route/lib files.

## Trigger identification

The log entry `"kanban-auto-fire: job started — polling in background"` confirms the automated path. The log entry `"admin-m365-run: background job processing complete"` confirms the manual path.

## Current shared helpers

`artifacts/api-server/src/lib/m365-profile-update.ts` exports:
- `applyProfileUpdates(clientId, profileUpdates)` — upserts into `client_m365_profiles`
- `snapshotHealthFromProfile(clientId)` — reads profile → computes scores → inserts into `client_health_history`

Both `admin-m365-run.ts` and `kanban-auto-fire.ts` import from this shared lib.
