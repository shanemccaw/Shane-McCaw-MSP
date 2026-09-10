-- Git #3509 — closes the duplicate-BUILD:-dispatch race.
--
-- Real finding: two independent flows (a MyArchitect-set dispatch and a
-- BatterUpClearOut-set dispatch) each separately found #3493 had no `BUILD:` comment
-- yet, and each independently asked its own active chat to write and post one — six
-- minutes apart (comment ids IC_kwDOTWTvIM8AAAABTpR3ag and IC_kwDOTWTvIM8AAAABTpVG3g).
-- Neither of BuildConsole's two check-then-ask call sites (DispatchPanel.DispatchAsync,
-- LeftSidebar.DispatchOrAskActiveChatAsync) — nor a chat following CLAUDE.md's Build
-- Queue Method directly, outside BuildConsole entirely — shared any record of "someone
-- already asked for this issue's BUILD: comment." No collision landed this time only
-- because no worktree/session was ever actually launched from the losing comment.
--
-- bt_dispatch_claims is the one real source of truth that closes this: a short-lived
-- claim row, keyed by github_number, inserted (via an atomic
-- INSERT ... ON CONFLICT DO NOTHING) immediately before any flow asks a chat to write
-- and post a BUILD: comment. A second flow's claim attempt on the same issue fails
-- atomically while the first claim is still live, so it can report "already being
-- dispatched" instead of asking again. Claims expire on their own via expires_at (an
-- explicit, bounded TTL — not indefinite) so an abandoned ask can never hold an issue's
-- dispatch hostage.
CREATE TABLE IF NOT EXISTS bt_dispatch_claims (
  github_number INT PRIMARY KEY,
  claimed_by    TEXT NOT NULL,                 -- free-form origin label, e.g. "BuildConsole:DispatchPanel", "BuildConsole:GitBoard", a chat/session name
  claimed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS bt_dispatch_claims_expires_at_idx ON bt_dispatch_claims (expires_at);

-- Self-mark so Simulator Studio's Migrations tree reflects DB reality (Git #497).
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-10-bt-dispatch-claims-3509.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
