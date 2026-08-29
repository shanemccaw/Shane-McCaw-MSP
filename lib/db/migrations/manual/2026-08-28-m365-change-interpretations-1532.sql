-- Git #1532 (part of #1494) — M365 Changes interpretation layer: schema.
--
-- The INTERPRETATION layer. #1494's split is: interpretation is universal,
-- resolution is per-tenant. A Message Center post / roadmap item is prose about a
-- CLASS of change ("EWS retirement means apps and mailboxes using EWS must migrate
-- to Graph") — true for every tenant, so it is authored ONCE and every tenant's
-- resolution layer reuses it. The per-tenant affected-object count is NOT here.
--
-- Authoring model (#1532): Shane authors, AI proposes. The AI reads a roadmap
-- item's description / a Message Center post's bodyContent and PROPOSES the
-- structured reading (status 'proposed'); Shane CONFIRMS it (status 'confirmed')
-- before it is ever applied to a tenant. `status` is the gate the resolution layer
-- reads — only a 'confirmed' row may drive a tenant-facing answer. No unverified
-- interpretation reaches a customer.
--
-- Structurally PER-MSP even though there is one MSP today: scoped by msp_id so a
-- second MSP / the NASA extraction owns its own library. feature_id is the
-- cross-source join key (the roadmap feature ID that Message Center posts carry).
--
-- Shane To-Do: run this file against the local PostgreSQL 18 install before the
-- AdminV2 "Microsoft Changes" authoring surface is used. Until it runs, the surface
-- surfaces an honest "not collected" state — never fixture data.

CREATE TABLE IF NOT EXISTS m365_change_interpretations (
    id               SERIAL PRIMARY KEY,
    msp_id           integer NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
    feature_id       text,                                  -- join key → m365_roadmap_items.feature_id
    graph_message_id text,                                  -- join key → msp_message_center_items.graph_message_id
    source_kind      text NOT NULL DEFAULT 'roadmap',       -- "roadmap" | "message_center" | "manual"
    title            text NOT NULL,
    summary          text,                                  -- plain-language "what is changing"
    change_class     text NOT NULL,                         -- retirement | default_flip | new_feature | breaking_change | licensing
    touches          jsonb NOT NULL DEFAULT '{"services":[],"protocols":[],"skus":[],"settings":[]}'::jsonb,
    who_acts         text NOT NULL DEFAULT 'microsoft',     -- "microsoft" | "admin"
    controllable     text NOT NULL DEFAULT 'unknown',       -- "yes" | "no" | "unknown"
    control_method   text,                                  -- HOW to turn it off — only meaningful when controllable = 'yes'
    probe            jsonb NOT NULL DEFAULT '{"description":""}'::jsonb,  -- what to count in a tenant to know if it applies
    status           text NOT NULL DEFAULT 'proposed',      -- "proposed" | "confirmed" | "rejected" — the confirmation gate
    proposed_by      text NOT NULL DEFAULT 'ai',            -- "ai" | "human"
    ai_model         text,
    ai_rationale     text,
    confirmed_by     text,
    confirmed_at     timestamptz,
    notes            text,
    created_by       text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS m365_change_interpretations_msp_id_idx
    ON m365_change_interpretations (msp_id);
CREATE INDEX IF NOT EXISTS m365_change_interpretations_feature_id_idx
    ON m365_change_interpretations (feature_id);
CREATE INDEX IF NOT EXISTS m365_change_interpretations_status_idx
    ON m365_change_interpretations (status);

-- One interpretation per roadmap feature per MSP. Partial so hand-authored rows
-- with no feature_id are exempt (they are keyed by nothing but their own id).
CREATE UNIQUE INDEX IF NOT EXISTS m365_change_interpretations_msp_feature_uidx
    ON m365_change_interpretations (msp_id, feature_id)
    WHERE feature_id IS NOT NULL;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-28-m365-change-interpretations-1532.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
