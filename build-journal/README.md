# build-journal/ — per-issue session bookends

**One file per issue. One writer per file. No shared append, ever.**

This directory replaces the single shared `PLATFORM_BUILD.md` / `desktop/BuildConsole/BUILD_LOG.md`
bookend tables (both now frozen as historical archives). Every work session records
its own bookend in **its own file** — `build-journal/<id>.md` — so two concurrent
sessions can never clobber each other's rows. That collision (Git #1267) is
structurally impossible here: sessions write to different files.

## Filename

- **Git-issue work:** `build-journal/<issue-number>.md` (e.g. `build-journal/1371.md`).
- **Non-Git / `--notGit` local work:** `build-journal/<letter-id>.md`, using the
  same base-26 local id BuildConsole assigns (see the notGit id memory).
- **Work spanning several issues in one session:** write one file per issue you
  actually touch, each with its own bookend. Cross-link them in the body.

There is **no product-vs-BuildConsole split** anymore. Both live here; record which
side the work touched in the `Scope:` line instead. (The old rule sent product work
to `PLATFORM_BUILD.md` and BuildConsole work to `BUILD_LOG.md` — that distinction is
now just a field.)

## Format

A per-issue file is standalone Markdown. Keep it simple — because only one session
ever writes it, the elaborate commit-tree/CAS discipline the shared file required is
unnecessary; a plain `git add build-journal/<id>.md && git commit` is safe.

```markdown
# #<id> — <short title>

- **Status:** ⏳ IN FLIGHT 2026-08-31T23:23:47Z      <!-- flip to: ✅ DONE <timestamp>  (or leave IN FLIGHT if abandoned) -->
- **Scope:** platform | buildconsole | both
- **Started:** <YYYY-MM-DD>
- **Commit(s):** <real hash(es) — fill at DONE>

## Log
- <UTC ISO8601> ⏳ IN FLIGHT — <the step you're about to do>
- <UTC ISO8601> ✅ DONE — <what actually shipped, verification result, honest gaps>
```

**Every status line — the top `Status:` field and every `## Log` entry — carries a
UTC ISO 8601 timestamp alongside the status (Git #2131), not just once at file
creation.** A bookend can be edited more than once in one session (IN FLIGHT →
BLOCKED → IN FLIGHT → DONE), and each transition needs its own timestamp so a fresh
session or Shane can tell current state from a stale leftover at a glance.

## The two bookend moments (unchanged intent, new mechanism)

1. **First thing the session does, before any other work:** create
   `build-journal/<id>.md` with `Status: ⏳ IN FLIGHT <timestamp>` and the opening
   `Log` line. Commit it immediately as its own small standalone commit.
2. **After all real work is tested & typechecked:** flip `Status:` to
   `✅ DONE <timestamp>`, fill in the real commit hash(es), append a timestamped
   `✅ DONE` log line. Commit.

If a session is abandoned/crashes, its file is left at `⏳ IN FLIGHT` — that's the
record. Do not clean up or delete other sessions' stale IN FLIGHT files.

## Why this is collision-safe

The whole class of failures in Git #1267 (one session's DONE commit deleting another
session's IN FLIGHT row; line-count-based edits clobbering a sibling row; stale-index
bleed on a shared append) came from many sessions editing **one** file. Here each
session edits only the file named for its own issue, which no other session touches.
No re-read-before-write, no diff-guard, no CAS push needed — though the standing
[Shared File Write Discipline](../CLAUDE.md) still applies to any genuinely shared
file that remains (e.g. `test-manifests/_regression-suite.json`).

## Superseded files

- `PLATFORM_BUILD.md` — frozen archive; all rows preserved in git history.
- `desktop/BuildConsole/BUILD_LOG.md` — frozen archive; likewise.
- `.cc-bookend.js` — the shared-file CAS helper; no longer needed for bookends
  (kept for reference / any lingering shared-table edit).
