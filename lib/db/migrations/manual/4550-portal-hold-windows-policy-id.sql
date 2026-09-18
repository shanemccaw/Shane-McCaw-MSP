-- #4550 — a hold window has no link to the Conditional Access policy it
-- observes, so nothing can target a scan at it. Additive, nullable: not every
-- hold window is CA-gated (site-admin notice periods, guest-access windows
-- have no policy to scan).

ALTER TABLE portal_hold_windows ADD COLUMN IF NOT EXISTS policy_id text;

CREATE INDEX IF NOT EXISTS portal_hold_windows_policy_id_idx ON portal_hold_windows (policy_id);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('4550-portal-hold-windows-policy-id.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
