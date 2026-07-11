---
name: system_action retirement pattern
description: How to promote an opaque system_action task into a real documented composable node type, including compat patches for live graphs.
---

## The rule

When a `system_action` node encapsulates a distinct behavior that other workflows could reuse, it should be promoted to its own top-level node `type`. This involves:

1. Adding the new type string to `WfNode.type` in `lib/db/src/schema/index.ts` and rebuilding the lib (`pnpm run typecheck:libs`).
2. Adding a top-level `case "new_type":` in the main `switch (node.type)` block in `workflow-executor.ts` (NOT in `PROMOTED_ACTION_TYPES` unless it lives inside `case "action":`).
3. Adding a dry-run stub in `makeDryRunOutput`'s switch.
4. Updating the seeded workflow graphs in `seed-system-workflows.ts` to use the new type.
5. Writing a compat patch (guarded by `graph->'nodes' @> '[{"type":"system_action"}]'`) that migrates live graph JSON via `jsonb_set` (for in-place node swaps) or a full `graph` column replacement (for expanded multi-node graphs).

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

## Retiring a system_action task type

Replace its old executor handler with a stub:
```typescript
case "old_action_type": {
  logger.warn({ runId, nodeId: node.id }, "wf-executor: old_action_type is retired — use sql_query instead");
  output = { skipped: true, note: "old_action_type is retired" };
  break;
}
```

**Why:** system_action was a grab-bag black box with no schema documentation; callers had no introspection into what it did. Promoting each behavior to its own node type makes the catalog self-documenting and allows the builder UI to surface fields and help text.

**How to apply:** Whenever a system_action task `T` is identified for promotion, follow steps 1–5 above. The compat patch guard (`@> '[{"type":"system_action"}]'`) makes it safe to re-run seedSystemWorkflows repeatedly — already-migrated graphs won't match and won't be double-patched.
