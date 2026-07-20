-- MSP Partner QBRs — AI-generated cross-customer Quarterly Business Review
-- documents, one per (MSP, quarter). Backs the "Generate QBR" action in MSP
-- Executive Mode.
-- Manual migration — review and run by hand (do not run drizzle-kit push/push --force).
--
-- MSP-level (whole-book) document, NOT per-customer: the per-customer, client-
-- facing formal document is the consolidated SOW (insights_generated_documents,
-- customerId-scoped). A QBR spans every customer in the book, so it cannot live
-- in insights_generated_documents (whose customer_id is a single users.id with
-- no msp_id) — it gets its own MSP-scoped table here.
--
-- Cost discipline: exactly one QBR per (msp_id, quarter_key) — enforced by the
-- unique index below. A request within the same quarter returns the cached row;
-- a manual "Regenerate" (force) overwrites it in place. We never regenerate an
-- expensive Opus generation speculatively.
--
-- Consumed by:
--   - GET  /api/msp/executive/qbr          (MSPAdmin+) — current quarter's cached QBR
--   - POST /api/msp/executive/qbr/generate (MSPAdmin+) — generate/regenerate

CREATE TABLE IF NOT EXISTS "msp_partner_qbrs" (
  "id" serial PRIMARY KEY,
  "msp_id" integer NOT NULL REFERENCES "msps"("id") ON DELETE CASCADE,
  "quarter_key" text NOT NULL,
  "status" text NOT NULL DEFAULT 'generating' CHECK ("status" IN ('generating', 'ready', 'failed')),
  "title" text NOT NULL DEFAULT '',
  "html_content" text NOT NULL DEFAULT '',
  "data_snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "model" text,
  "error_message" text,
  "generated_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- One QBR per MSP per quarter (the cache key + upsert target).
CREATE UNIQUE INDEX IF NOT EXISTS "msp_partner_qbrs_msp_quarter_idx"
  ON "msp_partner_qbrs" ("msp_id", "quarter_key");
