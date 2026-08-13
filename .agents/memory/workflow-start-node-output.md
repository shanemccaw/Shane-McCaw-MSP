---
name: Start node output must carry the trigger payload
description: Why the workflow Start node's output previously showed only {started:true} and how it now exposes incoming trigger/input data
---

The workflow executor's `start` node is a STRUCTURAL_TYPE, so it always executes (even in dry-run) and previously hardcoded its output to `{ started: true }`, discarding the run's incoming trigger/input payload from that node's output.

**Why this mattered:** the run's initial payload (`run.payload`, e.g. `tasks`, `clientId`, `projectId` from an event trigger or `run_workflow` child call) was still merged into the top-level `payload` object, so `{{fieldName}}` template references worked downstream — but `{{steps.<startNodeId>.fieldName}}` did not, and the run viewer's Start node output panel showed no useful debugging info about what actually triggered the run.

**How to apply:** the `start` case now sets `output = { started: true, ...payload }` so the incoming data is visible both in `{{steps.<startNodeId>.*}}` references and in the run viewer, matching how every other node's output flows into `payload.steps`/`payload.nodes`. If you touch the `start` case again, keep this spread — don't revert to a bare `{started:true}` marker.
</content>
