-- ─────────────────────────────────────────────────────────────────────────────
-- Many-to-Many Chat-to-Issue Association & Build Queue Provenance Migration
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Create bt_chat_issues join table
CREATE TABLE IF NOT EXISTS bt_chat_issues (
  id              SERIAL PRIMARY KEY,
  chat_id         INTEGER NOT NULL REFERENCES bt_chats(id) ON DELETE CASCADE,
  issue_number    INTEGER NOT NULL,
  associated_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 2. Indexes for fast bi-directional lookup and uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS bt_chat_issues_chat_issue_unique ON bt_chat_issues (chat_id, issue_number);
CREATE INDEX IF NOT EXISTS bt_chat_issues_chat_id_idx ON bt_chat_issues (chat_id);
CREATE INDEX IF NOT EXISTS bt_chat_issues_issue_number_idx ON bt_chat_issues (issue_number);

-- 3. Backfill existing single-epic associations (bt_chats.epic_id -> bt_epics.github_number)
INSERT INTO bt_chat_issues (chat_id, issue_number, associated_at)
SELECT c.id, e.github_number, COALESCE(c.created_at, NOW())
FROM bt_chats c
JOIN bt_epics e ON c.epic_id = e.id
WHERE e.github_number IS NOT NULL
ON CONFLICT (chat_id, issue_number) DO NOTHING;

-- 4. Backfill existing single-issue associations (bt_chats.issue_id -> bt_issues.github_number)
INSERT INTO bt_chat_issues (chat_id, issue_number, associated_at)
SELECT c.id, i.github_number, COALESCE(c.created_at, NOW())
FROM bt_chats c
JOIN bt_issues i ON c.issue_id = i.id
WHERE i.github_number IS NOT NULL
ON CONFLICT (chat_id, issue_number) DO NOTHING;

-- 5. Add provenance columns to bt_build_queue
ALTER TABLE bt_build_queue ADD COLUMN IF NOT EXISTS originating_chat_id TEXT;
ALTER TABLE bt_build_queue ADD COLUMN IF NOT EXISTS chat_url TEXT;
