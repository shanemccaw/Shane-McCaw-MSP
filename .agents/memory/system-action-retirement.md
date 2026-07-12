---
name: system_action retirement pattern
description: How to promote an opaque system_action task into a real documented composable node type, including compat patches for live graphs. system_action is now FULLY RETIRED from the codebase.
---

## Current state (as of July 2026)

`system_action` is **fully retired** from the codebase:
- Removed from `WfNode` union in `lib/db/src/schema/index.ts`
- Removed from `node-type-registry.ts`
- `system-action-handlers.ts` deleted; its behaviors promoted to:
  - `msp_dunning_advance` → `msp-billing-nodes.ts:handleMspDunningAdvance`
  - `msp_overage_meter` → `msp-billing-nodes.ts:handleMspOverageMeter`
  - kanban auto-fire → `auto-fire-kanban-handler.ts:handleAutoFireKanban`
- SQL `JSONB` guard strings in `seed-system-workflows.ts` remain as compat patches only — safe and intentional

## The promotion pattern (for future node types)

When a `system_action` node encapsulates a distinct behavior that other workflows could reuse, promote it to its own top-level node `type`:

1. Add the new type string to `WfNode.type` in `lib/db/src/schema/index.ts` and rebuild the lib (`pnpm run typecheck:libs`).
2. Add a top-level `case "new_type":` in the main `switch (node.type)` block in `workflow-executor.ts` (NOT in `PROMOTED_ACTION_TYPES` unless it lives inside `case "action":`).
3. Add a dry-run stub in `makeDryRunOutput`'s switch.
4. Update the seeded workflow graphs in `seed-system-workflows.ts` to use the new type.
5. Write a compat patch (guarded by `graph->'nodes' @> '[{"type":"system_action"}]'`) that migrates live graph JSON via `jsonb_set` (for in-place node swaps) or a full `graph` column replacement (for expanded multi-node graphs).

## Compat patch shapes

**In-place swap (same node count, same edges)**:
```sql
UPDATE workflows SET graph = jsonb_set(
  graph, '{nodes}',
  (SELECT jsonb_agg(CASE WHEN n->>'id' = 'act' AND n->>'type' = 'system_action'
                    THEN $newNode ELSE n END)
   FROM jsonb_array_elements(graph->'nodes') AS n)
)
WHERE definition_id = $1
  AND graph->'nodes' @> '[{"id":"act","type":"system_action"}]';
```

**Full graph swap (node count changes, new edges)**:
```sql
UPDATE workflows SET graph = $fullNewGraph::jsonb
WHERE definition_id = $1
  AND graph->'nodes' @> '[{"id":"act","type":"system_action"}]';
```

**Why:** system_action was a grab-bag black box with no schema documentation; callers had no introspection into what it did. Promoting each behavior to its own node type makes the catalog self-documenting and allows the builder UI to surface fields and help text.

**How to apply:** Whenever a system_action task `T` is identified for promotion, follow steps 1–5 above. The compat patch guard (`@> '[{"type":"system_action"}]'`) makes it safe to re-run seedSystemWorkflows repeatedly — already-migrated graphs won't match and won't be double-patched.

## Node mock pattern for workflow-executor tests

When mocking new node handler modules in Vitest, the mock specifier MUST match the exact import string in the source file (including `.ts` extension if used). `auto-fire-kanban-handler.ts` uses explicit `.ts` extensions in its imports — mock with the `.ts` suffix or the mock won't intercept.
