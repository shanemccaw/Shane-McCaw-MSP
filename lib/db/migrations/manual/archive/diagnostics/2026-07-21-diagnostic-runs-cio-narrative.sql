-- CIO-Report Narrative — persist the AI-generated architect-voice narrative for
-- each diagnostics run so the Assessment Wizard's "generating" step can render it
-- as soon as the scan completes (via a poll of the existing status endpoint, no
-- new client mechanism), independent of how long document generation still has to
-- run afterward.
--
-- Run manually (Shane) — this repo does not use `drizzle-kit push`.

ALTER TABLE "msp_diagnostic_runs"
  ADD COLUMN IF NOT EXISTS "cio_narrative_status" text NOT NULL DEFAULT 'not_started';

ALTER TABLE "msp_diagnostic_runs"
  ADD COLUMN IF NOT EXISTS "cio_narrative_html" text;

ALTER TABLE "msp_diagnostic_runs"
  ADD COLUMN IF NOT EXISTS "cio_narrative_generated_at" timestamptz;
