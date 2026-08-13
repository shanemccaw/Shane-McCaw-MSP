---
name: Stale published workflow version can be picked by lookups
description: run_workflow/trigger/kanban-auto-fire version lookups must ORDER BY versionNumber DESC, and publish/revert endpoints must archive-old+publish-new atomically.
---

Any query that resolves "the published version" for a workflow definition
(`where status = 'published' limit 1`) must add
`.orderBy(desc(wfVersionsTable.versionNumber))` before `.limit(1)`. Without it,
Postgres does not guarantee which row comes back if more than one row for that
definition is ever visible as "published" at read time — the query can return
an old/stale version instead of the current one, making the workflow appear to
silently run stale (or empty) logic even though the builder shows a newer
published version.

**Why:** Observed in production: a `run_workflow` node resolved a definition's
sub-workflow to a version that had been archived 38 minutes prior, instead of
the version that was live at run time. The archive-old/publish-new sequence in
the publish (and revert-to-default) endpoints was two separate non-transactional
UPDATEs, leaving a window where zero or two rows could match `status='published'`
for the same definition. An unordered `limit(1)` under that condition has no
guaranteed "latest" semantics.

**How to apply:** Whenever you touch code that resolves a workflow's published
version (run_workflow child lookup, event-trigger enqueue, kanban-auto-fire),
require the ORDER BY. Whenever you touch code that flips `status` between
`archived`/`published` for `wf_versions`, wrap the archive+publish pair in a
single `db.transaction()` so the two writes are atomic — never do them as two
independent `await db.update(...)` calls in sequence.
