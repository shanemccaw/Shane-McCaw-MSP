---
name: Run Workflow node child payload isolation
description: run_workflow's child payload is built clean, not spread from the parent's payload — avoids leaking For/ForEach loop context (item, index, depth, nodes) into the child workflow.
---

The `run_workflow` action type in `workflow-executor.ts` builds `subPayload` for the child run from scratch (`{}`), not by spreading the parent's current `payload`.

**Why:** Spreading the parent payload (`{ ...payload }`) leaked loop-iteration context — `item`, `index`, `depth`, `nodes`, `steps`, `collectedResults` — into the child whenever the Run Workflow node sat inside a For/ForEach loop body. This confused child-workflow template expressions that expected a clean starting context.

**How to apply:** The child payload only ever contains the explicit `inputMapping` key/expr pairs plus `_parentRunId` and `_depth`. If a workflow needs the child to see specific parent data, it must be added as an inputMapping entry — there is no implicit inheritance. See also `workflow-executor-template-resolution.md` for how those mapped values are resolved.
