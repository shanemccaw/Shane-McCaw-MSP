CREATE UNIQUE INDEX IF NOT EXISTS "wf_versions_one_published_per_def" ON "wf_versions" ("definition_id") WHERE status = 'published';
