-- Real location-transition state (Git #3320, Feature #3220): the command tray's "heading to X"
-- capture-grammar rule needs somewhere real to record which house/place Shane just said he's
-- heading to, so a later capture in the same trip can say "nothing to bring from NASA" instead
-- of the destination-agnostic default, and so the toast can honestly reference the real to-home
-- / Heading Out checklist state instead of the design prototype's fake client-only `st.where`.
--
-- Two columns, not a new table: this is one current fact per user (overwritten on every real
-- "heading to X" statement), not a log -- same shape as `users.health_context`, not
-- `med_batch_log`. `heading_to` holds exactly one of 'work' | 'rental' | 'home' (nasa/ksc both
-- normalise to 'work' in capture-grammar.mjs -- see `normaliseHeadingDestination`), a real, small,
-- closed vocabulary because it drives which real checklist gets referenced, not an open one like
-- `places.house`/`things.house`.
ALTER TABLE users ADD COLUMN IF NOT EXISTS heading_to text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS heading_to_at timestamptz;
