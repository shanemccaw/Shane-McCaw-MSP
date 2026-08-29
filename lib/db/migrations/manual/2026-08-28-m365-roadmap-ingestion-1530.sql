-- Git #1530 (part of #1494) — M365 Roadmap ingestion: schema.
--
-- Two new GLOBAL tables (not tenant/msp-scoped): the Microsoft 365 Roadmap is a
-- public, unauthenticated, global feed of what Microsoft *intends* to ship,
-- published months ahead of any tenant's Message Center post. It is fetched from
-- the release-communications API (v1 for the nightly full snapshot of 1,000+
-- items, v2 OData for targeted queries) with no Graph, no consent, no tenant.
--
--  * m365_roadmap_items       — one row per roadmap feature. feature_id is the
--                               cross-source join key that Message Center posts
--                               carry (#1494). cloud_instances is the source of
--                               truth for the standing gov/GCC exclusion (#1537).
--  * m365_roadmap_sync_state  — one row per source feed, backing the honest-
--                               degrade requirement: Microsoft relocated this
--                               endpoint once already (15 Mar 2025), so the sync
--                               records failure without advancing last_success_at
--                               and without wiping items, so a reader can tell
--                               fresh from stale and never serve stale as current.
--
-- Shane To-Do: run this file against the local PostgreSQL 18 install before the
-- M365 Roadmap sync workflow first runs. The sync surfaces an honest
-- "not collected" state (never fixture data) until this migration has run.

CREATE TABLE IF NOT EXISTS m365_roadmap_items (
    id                                   SERIAL PRIMARY KEY,
    feature_id                           text NOT NULL,               -- Microsoft roadmap feature ID — join key to Message Center posts
    title                                text NOT NULL,
    description                          text,
    status                               text,                        -- "In development" | "Rolling out" | "Launched"
    more_info_link                       text,
    products                             jsonb NOT NULL DEFAULT '[]'::jsonb,
    release_phases                       jsonb NOT NULL DEFAULT '[]'::jsonb,
    platforms                            jsonb NOT NULL DEFAULT '[]'::jsonb,
    cloud_instances                      jsonb NOT NULL DEFAULT '[]'::jsonb,  -- #1537 gov/GCC exclusion source of truth
    tags                                 jsonb NOT NULL DEFAULT '[]'::jsonb,
    public_disclosure_availability_date  text,                        -- often a coarse string ("September CY2024"), kept verbatim
    ms_created                           timestamptz,                 -- Microsoft's own created timestamp
    ms_modified                          timestamptz,                 -- Microsoft's own modified timestamp — diffs genuinely-changed items
    source                               text NOT NULL,               -- "v1" | "v2"
    raw                                  jsonb,                       -- full raw item, kept for the later resolution/interpretation layer (#1494)
    first_seen_at                        timestamptz NOT NULL DEFAULT now(),
    last_seen_at                         timestamptz NOT NULL DEFAULT now(),
    created_at                           timestamptz NOT NULL DEFAULT now(),
    updated_at                           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS m365_roadmap_items_feature_id_idx
    ON m365_roadmap_items (feature_id);
CREATE INDEX IF NOT EXISTS m365_roadmap_items_status_idx
    ON m365_roadmap_items (status);
CREATE INDEX IF NOT EXISTS m365_roadmap_items_ms_modified_idx
    ON m365_roadmap_items (ms_modified);
-- GIN index for cloud-instance containment queries (the gov/GCC exclusion filter,
-- e.g. cloud_instances @> '["GCC High"]'). Not declared in the Drizzle TS schema.
CREATE INDEX IF NOT EXISTS m365_roadmap_items_cloud_instances_gin
    ON m365_roadmap_items USING gin (cloud_instances);

CREATE TABLE IF NOT EXISTS m365_roadmap_sync_state (
    id               SERIAL PRIMARY KEY,
    source           text NOT NULL,                    -- "v1" | "v2"
    last_attempt_at  timestamptz,
    last_success_at  timestamptz,
    last_status      text NOT NULL DEFAULT 'never',    -- "never" | "ok" | "error"
    last_error       text,
    last_item_count  integer NOT NULL DEFAULT 0,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS m365_roadmap_sync_state_source_idx
    ON m365_roadmap_sync_state (source);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-28-m365-roadmap-ingestion-1530.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
