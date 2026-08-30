-- #1547 — Policy Engine: standing policies are a second, declarative object.
--
-- Additive and reversible. Creates the ONE new table the Policy Engine's
-- declarative object needs. Nothing existing is altered.
--
-- A standing policy is DECLARATIVE and operationally live: it states a target
-- state; it cites no obligation, follows no finding, and requires no signature.
-- It is deliberately NOT a row on msp_risk_decisions (the register of reactive,
-- obligation-bound, SIGNED deviation decisions, #1525-#1529) — #1547 exists to
-- establish exactly that separation, which #1548-#1553 depend on.
--
-- The target state does two jobs from ONE declaration: forward (what an SOP
-- drives toward when provisioning, #1548) and backward (what a check compares
-- against to find a member out of state, #1553). The attachment point is the OU
-- (active_directory_ous) — a policy binds to a container; membership determines
-- what applies. `catalog_item_id` records the #1550 relationship (a policy IS a
-- standard change catalog item); nullable here because #1550 builds the flow
-- that makes the binding load-bearing.

BEGIN;

CREATE TABLE IF NOT EXISTS standing_policies (
  id               serial PRIMARY KEY,
  msp_id           integer NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  ou_id            integer NOT NULL REFERENCES active_directory_ous(id) ON DELETE CASCADE,
  title            text NOT NULL,
  description      text NOT NULL DEFAULT '',
  -- Enum enforced in Drizzle (STANDING_POLICY_TARGET_KIND), not by a DB CHECK,
  -- to match this schema's house style: mailbox_attribute | group_membership |
  -- service_policy.
  target_kind      text NOT NULL,
  -- The declaration itself — the SAME map read forward and backward. Shape
  -- varies by target_kind; jsonb is the honest representation of a
  -- container -> target-state map. Never money, never a signature.
  target_state     jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- #1550: the pre-approved change_catalog_items row a forward enactment raises
  -- its auto-approved CR from. Nullable — relationship exists at #1547.
  catalog_item_id  integer REFERENCES change_catalog_items(id) ON DELETE SET NULL,
  -- Opt-in, default-off (#1549 continuous-evaluation default).
  is_active        boolean NOT NULL DEFAULT false,
  created_by_person_id  text,
  created_by_name       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS standing_policies_msp_id_idx     ON standing_policies (msp_id);
CREATE INDEX IF NOT EXISTS standing_policies_ou_id_idx      ON standing_policies (ou_id);
CREATE INDEX IF NOT EXISTS standing_policies_msp_active_idx ON standing_policies (msp_id, is_active);

COMMENT ON TABLE standing_policies IS
  'Policy Engine declarative object (#1547): OU-bound target-state declarations, '
  'used forward (SOP provisioning, #1548) and backward (compliance comparison, #1553). '
  'Distinct from msp_risk_decisions (the signed, obligation-bound register).';

-- Verify the table + indexes landed.
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'standing_policies'
 ORDER BY ordinal_position;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-30-standing-policies-1547.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
