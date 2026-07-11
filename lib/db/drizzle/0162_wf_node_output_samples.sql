CREATE TABLE IF NOT EXISTS "wf_node_output_samples" (
  "definition_id" INTEGER NOT NULL,
  "node_id"       TEXT    NOT NULL,
  "node_type"     TEXT    NOT NULL,
  "sample"        JSONB   NOT NULL DEFAULT '{}',
  "captured_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "source_run_id" INTEGER,
  PRIMARY KEY ("definition_id", "node_id")
);

CREATE INDEX IF NOT EXISTS "wf_node_output_samples_def_idx"
  ON "wf_node_output_samples" ("definition_id");
