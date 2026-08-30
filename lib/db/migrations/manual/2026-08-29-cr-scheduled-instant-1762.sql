-- #1762 — msp_change_requests.scheduled_for is free text, not a timestamp.
--
-- Adds a REAL booked-window instant pair alongside the existing free-text
-- `scheduled_for` label. `scheduled_for` is deliberately left exactly as it is
-- (text, NOT NULL) — the label and the instant are different things and both
-- are real. This is additive and reversible.
--
-- NOTHING is back-filled by parsing prose: existing rows carry strings like
-- "Awaiting records sign-off — no window booked" (no instant) and "Thu 27 Aug"
-- (no year), and a guessed timestamp a freeze check then enforces against is
-- worse than no timestamp. Every existing row keeps NULL, which every consumer
-- treats as "no window booked as a real instant" — never zero, never now().

ALTER TABLE msp_change_requests
  ADD COLUMN IF NOT EXISTS scheduled_start timestamptz;

ALTER TABLE msp_change_requests
  ADD COLUMN IF NOT EXISTS scheduled_end timestamptz;

-- Self-mark so Simulator Studio's Migrations tree (Git #497) reflects DB reality
-- regardless of which console ran this file.
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-29-cr-scheduled-instant-1762.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
