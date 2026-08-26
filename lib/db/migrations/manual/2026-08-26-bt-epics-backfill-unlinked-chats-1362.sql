-- Git #1362 — Chats stuck under "Unlinked" cannot be associated to their real epic.
--
-- ROOT CAUSE (confirmed against the real local build-tracker data, not assumed):
-- BuildConsole's Chats panel groups a chat under its epic ENTIRELY through the
-- local bt_epics table (LeftSidebar.GetEpicForChat -> GetEpicByGithubNumber, and
-- the assign path BuildQueuePostgresClient.LinkChatToIssueAsync). bt_epics is only
-- repopulated by a full GitHub sync, and the local copy went stale on 2026-08-17
-- (max synced github_number 1094). Several real, OPEN, sub-issue-bearing GitHub
-- epics created around/after that snapshot were never synced into bt_epics:
--
--     #1093  EPIC: Marketing Website   (29 sub-issues)
--     #1095  EPIC: Admin Panel         ( 1 sub-issue)
--     #1352  EPIC: Free Scan …         ( 9 sub-issues)
--
-- Every chat linked to one of these (via bt_chat_issues) therefore had no epic
-- row to resolve to and fell into the synthetic "Unlinked" bucket — permanently,
-- because re-assigning it from the UI only re-inserts the same unresolvable
-- bt_chat_issues row and, finding no bt_epics match, never sets bt_chats.epic_id
-- either. This is exactly why the bug "resisted multiple fix attempts": prior
-- fixes (commit 0709f43c) made the *resolution logic* smarter, but the missing
-- record was the EPIC, not the chat. #1094 (EPIC: Customer Portal) WAS synced, so
-- its chat grouped correctly — the tell that this is a data gap, not a code gap.
--
-- This file is the one-time data correction: backfill the three missing epics
-- exactly as a GitHub sync would (upsertEpicRow: title, status='open',
-- milestone_id = GitHub milestone number 5 = "v1.1 - Monitoring & Launch Control",
-- same as their sibling #1094), then pin each stranded chat to its primary epic.
-- (A separate LeftSidebar.xaml.cs change makes the panel self-heal from the live
-- Git Board going forward, so this class of bug can't recur; this file fixes the
-- rows already stuck.) Idempotent and safe to replay: ON CONFLICT DO NOTHING never
-- clobbers a fresher row a later real sync may have written.

BEGIN;

-- 1. Backfill the real, open epics missing from the local bt_epics table.
INSERT INTO bt_epics (title, status, github_number, milestone_id)
VALUES
  ('EPIC: Marketing Website', 'open', 1093, 5),
  ('EPIC: Admin Panel',       'open', 1095, 5),
  ('EPIC: Free Scan — real Zoho lead-gen, real consent, real scan, real locked results, real conversion', 'open', 1352, 5)
ON CONFLICT (github_number) DO NOTHING;

-- 2. Pin each stranded chat to its primary epic (the one named in its "[#NNNN]"
--    title prefix), so grouping is deterministic even for a chat linked to more
--    than one of these epics. Only touch still-unlinked chats (epic_id IS NULL) so
--    no real existing assignment is overwritten. Chats linked purely via
--    bt_chat_issues (no title prefix) still resolve through GetEpicForChat's
--    AssociatedIssueNumbers path now that the epic row exists — so this UPDATE is
--    a determinism nicety, not a correctness requirement.
UPDATE bt_chats c
SET epic_id = e.id, issue_id = NULL, updated_at = now()
FROM bt_epics e
WHERE e.github_number IN (1093, 1095, 1352)
  AND c.epic_id IS NULL
  AND c.title LIKE '[#' || e.github_number || ']%';

-- Self-marking run record (Git #497) — reflects DB reality in Simulator Studio's
-- Migrations tree regardless of which console ran the file.
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-26-bt-epics-backfill-unlinked-chats-1362.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
