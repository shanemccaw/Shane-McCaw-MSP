# #d — Recover Session-Limit Builds button (Build Queue panel)

- **Status:** ⏳ IN FLIGHT
- **Scope:** buildconsole
- **Started:** 2026-08-30
- **Commit(s):** (fill at DONE)

## Log
- 2026-08-30 ⏳ IN FLIGHT — Shane asked for a manual-recovery button in the Build
  Queue panel header, left of Paste Build / Pause / Refresh / Pin: scan every
  build's raw stdout log touched in the last 1 hour for the CLI's "You've hit
  your session limit · resets …" line (or a variation), and requeue (resume,
  not restart-from-scratch) whatever it finds regardless of what status the row
  landed in.
