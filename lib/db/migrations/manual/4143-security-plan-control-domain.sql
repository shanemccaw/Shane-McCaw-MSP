-- #4143 — Security Plan Part II "Control Domains" grouping had no backing field.
--
-- Adds a real, nullable `control_domain` column to each of the seven source
-- tables `security-plan-assembly.ts` reads (policy_decisions, msp_risk_decisions,
-- portal_ownership_rows, msp_sops, remediation_tracker_steps, msp_change_requests,
-- m365_change_interpretations), so `SecurityPlanAssembledItem.controlDomain` is a
-- real per-row read, not an invented display mapping over an existing, DIFFERENT
-- vocabulary (`pillar` and each module's own `category` are real but distinct —
-- see the schema comments on each column added below).
--
-- Vocabulary: identity | data | collaboration | change | monitoring
-- (SECURITY_PLAN_CONTROL_DOMAINS, lib/db/src/schema/msp.ts).
--
-- Backfill below is a one-time editorial read of this local database's own small,
-- real seed rows (23 total across the five non-empty tables) against their own
-- title/category/summary content — the same kind of judgment call an MSP operator
-- would make entering the row in the first place, not a formula or a guess.
-- `policy_decisions`, `portal_ownership_rows` and `remediation_tracker_steps` are
-- all empty locally (0 rows) — no backfill statements needed there; new rows in
-- every table simply start NULL (honestly unclassified) until each module's own
-- create/edit surface is extended to capture this — real, separate future work,
-- filed as a finding under #1495 rather than attempted here.

ALTER TABLE policy_decisions ADD COLUMN IF NOT EXISTS control_domain text;
ALTER TABLE msp_risk_decisions ADD COLUMN IF NOT EXISTS control_domain text;
ALTER TABLE portal_ownership_rows ADD COLUMN IF NOT EXISTS control_domain text;
ALTER TABLE msp_sops ADD COLUMN IF NOT EXISTS control_domain text;
ALTER TABLE remediation_tracker_steps ADD COLUMN IF NOT EXISTS control_domain text;
ALTER TABLE msp_change_requests ADD COLUMN IF NOT EXISTS control_domain text;
ALTER TABLE m365_change_interpretations ADD COLUMN IF NOT EXISTS control_domain text;

-- ── msp_risk_decisions ────────────────────────────────────────────────────────
-- id=1,85: MFA / legacy-auth control violations → identity.
-- id=86,88: retention findings (audit log, Teams chat) → data.
-- id=87: guest population review → identity.
UPDATE msp_risk_decisions SET control_domain = 'identity' WHERE id IN (1, 85, 87);
UPDATE msp_risk_decisions SET control_domain = 'data' WHERE id IN (86, 88);

-- ── msp_sops ──────────────────────────────────────────────────────────────────
-- "Identity & Access" category rows, plus "Quarterly Guest Access Review"
-- (category "Governance", but content is plainly an identity/access review) → identity.
-- "Incident Response" category rows (including id=1 "Test") → monitoring.
-- "Data Protection" category rows → data.
-- id=49 "Build verification — #2994 wiring check" (category "Verification") is a
-- dev/test artifact with no real domain content — left NULL, honestly unclassified.
UPDATE msp_sops SET control_domain = 'identity' WHERE id IN (34, 35, 38, 39, 42, 43, 45, 46, 47, 48);
UPDATE msp_sops SET control_domain = 'monitoring' WHERE id IN (1, 36, 37);
UPDATE msp_sops SET control_domain = 'data' WHERE id IN (40, 41);

-- ── msp_change_requests ───────────────────────────────────────────────────────
-- Every Change Control row is classified 'change' regardless of its own
-- `category` (a real but different workload taxonomy) — matching the design
-- reference's own choice (Security Plan.dc.html:322-324, every "cc" row → "change"),
-- since this register's rows are fundamentally the operational change-management
-- domain whatever workload they touch.
UPDATE msp_change_requests SET control_domain = 'change' WHERE id = 1226;

-- ── m365_change_interpretations ──────────────────────────────────────────────
-- id=4: touches Exchange Online / Outlook / shared calendars → collaboration.
UPDATE m365_change_interpretations SET control_domain = 'collaboration' WHERE id = 4;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('4143-security-plan-control-domain.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
