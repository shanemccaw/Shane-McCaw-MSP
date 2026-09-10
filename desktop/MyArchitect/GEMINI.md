# MyArchitect — Gemini Agent Notes

Multi-tenant WPF operator cockpit. Epic #3454 in this repo. Read
BUILD_QUEUE_METHOD.md (repo root) AND desktop/MyArchitect/UI_RULES.md before
touching any issue in this epic.

## Standing rule — UI Shell first, no exceptions
#3493 (UI Shell Redesign) must land before any other Feature's UI work — the
6-tab Ribbon, title-bar QAT, and left/right flyout split are real
prerequisites other issues attach their UI into, not decoration to retrofit
later. If #3493 isn't done yet, do not build ad-hoc chrome (a new icon, a
new panel) to unblock yourself — stop and flag it instead. See UI_RULES.md
for the full shell spec and the six fixed Ribbon tabs.

## Standing rule — bookend every issue, no exceptions
Before starting real work on any issue #N:
- Create build-journal/N.md, Status: IN FLIGHT, real UTC timestamp. Commit
  this file ALONE. Push immediately.
Do the real feature work, as many commits as needed.
When genuinely done:
- Update build-journal/N.md — Status: DONE, add a "Completed" timestamp and
  the real commit hash of your last actual feature-work commit (not this
  bookend commit). Commit this update ALONE. Push immediately.
- Report the exact DONE commit hash back — nothing is considered closed
  without it being verified against origin/main.
Never skip straight to DONE. Both commits are real and separate.

## Real code, not fixture
No hardcoded/fixture data anywhere. If a real backend endpoint doesn't exist
yet for what you need, stop and flag it — don't invent one, don't stub one
silently.
