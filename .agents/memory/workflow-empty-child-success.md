---
name: run_workflow / kanban-auto-fire treat empty child graphs as success
description: Why a sub-workflow with no real action nodes appears to "complete" instantly and marks callers (kanban cards, parent Run Workflow nodes) as successful even though nothing happened.
---

Both the `run_workflow` action node (workflow-executor.ts) and kanban-auto-fire's
`run_workflow` card type judge success purely by the child `wf_runs.status` not
being `failed`/`cancelled`. There is no check that the child graph actually
reached a meaningful action node (e.g. `execute_runbook`).

**Why this matters:** a workflow definition that is still a draft (e.g. just
`Start → For Each → Compose`, no real action) will run to completion in
milliseconds with zero errors. If that definition is already wired into live
automation — a kanban card's "run workflow" config, or another workflow's
`Run Workflow` node — every trigger "succeeds" and the caller marks itself
done, producing symptoms like "tasks are auto-completing without the workflow
actually running." This is not an executor bug; it is the natural result of
publishing/testing an unfinished workflow definition that live automation
already points at.

**How to apply:** when investigating unexpected auto-completion, check the
*target* workflow's published graph for a real action node before suspecting
the executor. `SELECT graph->'nodes' FROM wf_versions WHERE id = <versionId>`.
If it only contains structural nodes (start/foreach/compose/condition) with no
`action`/`execute_runbook` node, that's the root cause — not a regression.
Consider disconnecting kanban card automation from a definition while it is
still being built in the Workflow Builder.
