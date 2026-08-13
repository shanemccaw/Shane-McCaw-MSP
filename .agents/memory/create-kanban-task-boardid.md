---
name: create_kanban_task boardId fallback
description: The live-run create_kanban_task handler has no boardId default; dry-run has one. Missing boardId fails the guard with a misleading error.
---

## The rule
Always apply `|| "marketing"` fallback to `boardIdRaw` in the live-run path, same as dry-run.

**Why:** The workflow builder doesn't require boardId — a newly-created node has no boardId in its data. Without a fallback, `interp(undefined, payload)` returns `undefined`, and `!boardIdRaw` fails the validation guard. The error message mentions all three fields so it looks like a title/column problem.

**How to apply:** Whenever the live-run `create_kanban_task` case is updated, ensure:
```ts
const boardIdRaw = interp(node.data.boardId as string | undefined, payload) || "marketing";
```
The "marketing" board is a safe default for cases where no project board is configured. Users who want a project board set `boardId = "{{projectId}}"` or similar in the node's config panel.

## Debugging hint
If `create_kanban_task` fails with "requires boardId, columnId, and a non-empty title", check `node.data.boardId` first — it may simply be absent (not set in the builder), causing all three checks to appear suspicious when only boardId is missing.
