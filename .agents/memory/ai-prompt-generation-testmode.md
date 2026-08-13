---
name: AI generation testMode pattern for safe "test draft" previews
description: How to let admins preview an unpublished AI prompt through the real generation pipeline without persisting anything
---

When a feature needs to run a real AI generation flow (document/SOW generators) against an *unpublished* draft body, thread a `testMode: boolean` + `promptOverride: string` pair through the generator function rather than duplicating the pipeline.

**Why:** The generation functions in this codebase (`document-generator.ts`, `consolidated-sow-generator.ts`) have many persistence side-effects scattered through the function body (an early "generating" row insert, a callback to notify the HTTP caller of the new doc ID, mid-flight failure updates, and a final success/failure update). Every one of these needs an independent `if (!testMode)` guard — missing even one means a "preview" silently writes a real row, deletes a prior document, or fires a notification.

**How to apply:** When adding a testMode/preview capability to an existing generator:
1. Grep every reference to the row's primary key (`docId`) in the function — each usage after the initial insert is a candidate site that needs a guard or must tolerate the synthetic `-1` ID used in test mode.
2. Guard the initial DB insert itself, not just downstream writes — otherwise a "generating" row leaks into the table.
3. Guard the `onRowCreated`/similar caller-notification callback — a preview should not trigger caller-side side effects (e.g. streaming a doc ID to the client that expects a real row to exist later).
4. Guard both the success path's final update AND the catch block's failure-status update.
5. Return the raw generated content (e.g. `htmlContent`) directly in test mode instead of a doc ID, since no row exists to look it up later.
