---
name: Kanban auto-fire stuck-queued reconciliation
description: Why the stuck-queued bail-out is a heuristic, not a real failure, and must be paired with reconciliation.
---

`pollJobToCompletion()` in `kanban-auto-fire.ts` bails out early ("StuckQueued") if an Azure Automation job sits in New/Queued/Activating too long. This is a heuristic guess, not a real failure — Azure queuing delays are normal and the job can still complete successfully minutes later.

**Why:** treating a stuck-queued timeout as terminal caused false "failed" cards even when Azure went on to finish the job fine. Widening the timeout alone only shifts the problem; it doesn't eliminate false negatives for genuinely slow (but eventually successful) queues.

**How to apply:** any bail-out/timeout heuristic for an async external job (Azure runbook, similar polling loops) must ship with a reconciliation pass that re-checks the external system's real status later and corrects previously-declared failures if the job actually completed. In this codebase that's `reconcileLateStuckQueuedCompletions()`, wired to both the startup reconciliation system action and its own cron-scheduled system workflow (`__system__: Late Auto-Fire Reconciliation`, `reconcile_late_stuck_queued`) — startup-only firing is not enough since these can arrive at any time of day.
