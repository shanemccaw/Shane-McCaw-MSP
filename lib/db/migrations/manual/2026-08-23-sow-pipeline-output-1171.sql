-- Git #1171 — make the proven document-engine-sow.ts pipeline actually
-- invocable for the 'sow' document type.
--
-- WHY THIS IS NEEDED --------------------------------------------------------
-- document-engine-sow.ts:379 THROWS unless document_types.pipeline_category =
-- 'pipeline_output' for the type it is asked to generate. Two callers ask it to
-- generate "sow": portal-assessment.ts's SOW rescope path, and (new in #1171)
-- the Project Work offer-acceptance fulfillment (project-sow-fulfillment.ts).
--
-- Live introspection of the Dev database (2026-08-23) found
-- document_types.key='sow' sitting at pipeline_category='standalone' — the
-- schema default (lib/db/src/schema/index.ts:345), never overridden by ANY
-- migration. In that state EVERY generateSowDocument("sow") call throws before
-- doing any work: the whole engine is un-invocable. Not a single document_types
-- row is 'pipeline_output' today.
--
-- The rest of the codebase already assumes 'sow' is pipeline_output:
--   * 2026-08-06-document-generation-ai-prompts.sql's own header asserts "in the
--     live database, 'sow' is a pipeline_output row" — a stated precondition
--     that turns out never to have been set.
--   * document-engine.ts:934 REFUSES pipeline_output types, and admin routing
--     (admin-document-generator.ts, workflow-executor.ts) branches 'sow' to the
--     dedicated SOW engine by exactly this category. Verified no production
--     caller does generateDocument({docTypeKey:'sow'}) — every "sow" docTypeKey
--     in the tree that is NOT this engine is in a test file — so flipping the
--     category breaks no existing standalone-generation path.
--   * document-engine-sow.ts's own grounding read (line 579) pulls prior
--     findings only from pipeline_category='standalone' documents, so a SOW is
--     correctly excluded from grounding itself once it is pipeline_output.
--
-- One-column data correction, fully reversible (flip back to 'standalone').
-- Applied to the Dev database this session to verify the pipeline becomes
-- invocable end-to-end (dry-run prompt assembly succeeded afterward). This file
-- carries the same correction to Staging/Production, where Shane runs it.

BEGIN;

UPDATE document_types
   SET pipeline_category = 'pipeline_output',
       updated_at = now()
 WHERE key = 'sow'
   AND pipeline_category <> 'pipeline_output';

-- Self-marking run record so Simulator Studio's Migrations tree (Git #497)
-- reflects DB reality regardless of which console ran the file.
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-23-sow-pipeline-output-1171.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
