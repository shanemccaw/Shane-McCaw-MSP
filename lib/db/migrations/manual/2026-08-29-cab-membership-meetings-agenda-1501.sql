-- #1501 — Change Advisory Board: membership, meetings, agenda, ECAB.
--
-- Closes the gap `useChangeControl.ts:22` recorded: no CAB agenda table. Adds
-- three tables and reuses the #1496 approval model for recorded decisions —
-- `cab_agenda_items.cr_approval_id` joins back to `cr_approvals`, which stays
-- the ONE ledger a decision is durably recorded in. All additive.

BEGIN;

-- 1. Membership roster. One MSP-wide board; `tenant_id` is set only for a
--    customer-side member, scoping which tenant they represent.
CREATE TABLE IF NOT EXISTS cab_members (
  id           serial PRIMARY KEY,
  msp_id       integer NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  person_id    text NOT NULL,
  name         text NOT NULL,
  email        text NOT NULL,
  role         text NOT NULL DEFAULT 'voting',   -- chair | voting | advisory | secretary
  side         text NOT NULL,                    -- msp | customer
  tenant_id    text,
  is_ecab      boolean NOT NULL DEFAULT false,
  active       boolean NOT NULL DEFAULT true,
  added_at     timestamptz NOT NULL DEFAULT now(),
  removed_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cab_members_msp_id_idx ON cab_members(msp_id);

-- One ACTIVE membership per person per board. Partial so a removed member can
-- rejoin under a fresh row without colliding with their own old one.
CREATE UNIQUE INDEX IF NOT EXISTS cab_members_msp_person_active_unique
  ON cab_members(msp_id, person_id)
  WHERE active = true;

-- 2. Meetings. `meeting_type` = 'cab' (standing board) or 'ecab' (emergency
--    board, always retroactive — see cab_agenda_items.is_retroactive below).
CREATE TABLE IF NOT EXISTS cab_meetings (
  id             serial PRIMARY KEY,
  msp_id         integer NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  meeting_type   text NOT NULL DEFAULT 'cab',       -- cab | ecab
  status         text NOT NULL DEFAULT 'scheduled',  -- scheduled | in_progress | completed | cancelled
  scheduled_for  timestamptz NOT NULL,
  held_at        timestamptz,
  closed_at      timestamptz,
  chair_person_id text,
  chair_name     text NOT NULL DEFAULT '',
  location       text NOT NULL DEFAULT '',
  notes          text NOT NULL DEFAULT '',
  minutes        text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cab_meetings_msp_id_idx ON cab_meetings(msp_id);
CREATE INDEX IF NOT EXISTS cab_meetings_status_idx ON cab_meetings(status);

-- 3. Agenda items — one row per change request discussed at one meeting. The
--    decision this item produces is a REAL cr_approvals row (cr_approval_id),
--    not a second model.
CREATE TABLE IF NOT EXISTS cab_agenda_items (
  id                     serial PRIMARY KEY,
  meeting_id             integer NOT NULL REFERENCES cab_meetings(id) ON DELETE CASCADE,
  change_request_id      integer NOT NULL REFERENCES msp_change_requests(id) ON DELETE CASCADE,
  msp_id                 integer NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  tenant_id              text NOT NULL,
  ordinal                integer NOT NULL DEFAULT 0,
  presenter_name         text NOT NULL DEFAULT '',
  discussion_notes       text NOT NULL DEFAULT '',
  recommendation         text,                       -- approve | reject | defer | NULL (undecided)
  decided_at             timestamptz,
  cr_approval_id         integer REFERENCES cr_approvals(id),
  is_retroactive         boolean NOT NULL DEFAULT false,
  deferred_to_meeting_id integer REFERENCES cab_meetings(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cab_agenda_items_meeting_cr_unique UNIQUE (meeting_id, change_request_id)
);

CREATE INDEX IF NOT EXISTS cab_agenda_items_meeting_id_idx ON cab_agenda_items(meeting_id);
CREATE INDEX IF NOT EXISTS cab_agenda_items_change_request_id_idx ON cab_agenda_items(change_request_id);
CREATE INDEX IF NOT EXISTS cab_agenda_items_msp_tenant_idx ON cab_agenda_items(msp_id, tenant_id);

-- Self-mark so Simulator Studio's Migrations tree reflects DB reality (Git #497).
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-29-cab-membership-meetings-agenda-1501.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
