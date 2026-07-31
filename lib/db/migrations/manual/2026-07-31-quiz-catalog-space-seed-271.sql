-- Real Space/Aerospace quiz content — #271 part 5, parent epic #183.
--
-- Source: Shane's verbatim content in the #271 issue comment, and nothing else.
-- This is the part the earlier session deliberately left unwritten because the
-- content did not exist anywhere in the repo. Nothing here is invented:
-- every title below is copied from that comment exactly as written.
--
-- Run AFTER:
--   2026-07-31-quiz-catalog-tables-271.sql            (creates the tables)
--   2026-07-31-quiz-catalog-migrate-existing-271.sql  (loads the old content)
--
-- Contents: 10 clusters, 10 personas under Mission & Flight Operations,
-- 10 use cases and 10 outcomes under Flight Controller. Per the issue comment,
-- the other 9 clusters have NO personas/use-cases/outcomes specified yet and
-- none were invented for them — that remains a real, separate content gap.
--
-- ── THREE THINGS TO KNOW BEFORE RUNNING ──────────────────────────────────────
--
-- 1. DESCRIPTIONS ARE EMPTY STRINGS. The issue comment supplies titles only.
--    `description` is NOT NULL, so every row below is seeded with ''. Writing
--    plausible-sounding descriptions would have been inventing content, which is
--    exactly what this file exists to avoid. The quiz renders the description
--    under the title, so these 40 tiles will show a title and no supporting line
--    until Shane fills them in — a one-line UPDATE per row, e.g.
--      UPDATE "quiz_personas" SET description = '…'
--       WHERE industry = 'space' AND persona_key = 'flight_controller';
--    Icon names, by contrast, ARE chosen here: they are a mechanical UI concern,
--    every value is a real name from QuizScreen's DynamicIcon map, and an
--    unrecognised one would only fall back to the Sparkles glyph.
--
-- 2. NEW KEYS ARE DELIBERATELY DISTINCT FROM THE MIGRATED ONES. The migrated
--    space rows already hold cluster_key 'mission_ops' ("Mission Operations")
--    and persona_keys 'mission_spec', 'flight_dir' and 'flight_surgeon'. Because
--    every statement here is ON CONFLICT DO NOTHING, reusing those keys would
--    NOT rename them — it would silently skip the row and leave the old title in
--    place, and the affected personas would keep pointing at the old cluster and
--    never appear under Mission & Flight Operations at all. So this seed uses
--    'mission_flight_ops', 'mission_specialist', 'flight_director' and
--    'flight_surgeon_ops'. That last one is the only awkward slug in the file and
--    it exists solely because the bare 'flight_surgeon' key is already taken.
--
-- 3. CONSEQUENCE OF (2) — SPACE WILL SHOW BOTH SETS UNTIL YOU RETIRE THE OLD
--    ONES. After this runs, the Industry=Space quiz lists 14 clusters (the 4
--    migrated placeholders plus these 10 real ones), and Mission Specialist,
--    Flight Director and Flight Surgeon each appear twice — once under the old
--    "Mission Operations", once under the real "Mission & Flight Operations".
--    That is the honest additive result, not a bug. The migrated space rows were
--    always placeholder content this real content supersedes. To retire them,
--    run the clearly-separated block at the BOTTOM of this file — left commented
--    out on purpose, because deleting rows is a decision for Shane, not a
--    side effect of seeding.
--
-- Manual migration — review and run by hand (do not run drizzle-kit push/push --force).

-- ── 10 clusters ──────────────────────────────────────────────────────────────
INSERT INTO "quiz_persona_clusters" ("industry", "cluster_key", "title", "description", "icon_name", "sort_order") VALUES
  ('space', 'mission_flight_ops',      'Mission & Flight Operations',    '', 'Compass',     0),
  ('space', 'engineering_technical',   'Engineering & Technical',        '', 'Cpu',        10),
  ('space', 'manufacturing_production','Manufacturing & Production',     '', 'Factory',    20),
  ('space', 'research_science',        'Research & Science',             '', 'Atom',       30),
  ('space', 'safety_compliance',       'Safety & Compliance',            '', 'ShieldCheck',40),
  ('space', 'program_project_mgmt',    'Program & Project Management',   '', 'FolderKanban',50),
  ('space', 'ground_systems_infra',    'Ground Systems & Infrastructure','', 'Network',    60),
  ('space', 'it_data_simulation',      'IT, Data & Simulation',          '', 'HardDrive',  70),
  ('space', 'business_admin',          'Business & Administrative',      '', 'Briefcase',  80),
  ('space', 'comms_public_affairs',    'Communications & Public Affairs','', 'Megaphone',  90)
ON CONFLICT ("industry", "cluster_key") DO NOTHING;

-- ── 10 personas, all under Mission & Flight Operations ───────────────────────
-- The other 9 clusters above intentionally get NO personas here.
INSERT INTO "quiz_personas" ("industry", "cluster_key", "persona_key", "title", "description", "icon_name", "sort_order") VALUES
  ('space', 'mission_flight_ops', 'mission_specialist',  'Mission Specialist',            '', 'Compass',      0),
  ('space', 'mission_flight_ops', 'flight_controller',   'Flight Controller',             '', 'Radio',       10),
  ('space', 'mission_flight_ops', 'flight_director',     'Flight Director',               '', 'Crown',       20),
  ('space', 'mission_flight_ops', 'payload_specialist',  'Payload Specialist',            '', 'Boxes',       30),
  ('space', 'mission_flight_ops', 'capcom',              'Capsule Communicator (CAPCOM)', '', 'MessageSquare',40),
  ('space', 'mission_flight_ops', 'launch_ops_officer',  'Launch Operations Officer',     '', 'Rocket',      50),
  ('space', 'mission_flight_ops', 'range_safety_officer','Range Safety Officer',          '', 'ShieldAlert', 60),
  ('space', 'mission_flight_ops', 'ground_ops_tech',     'Ground Operations Technician',  '', 'Wrench',      70),
  ('space', 'mission_flight_ops', 'mission_planner',     'Mission Planner / Scheduler',   '', 'ListTodo',    80),
  ('space', 'mission_flight_ops', 'flight_surgeon_ops',  'Flight Surgeon',                '', 'HeartPulse',  90)
ON CONFLICT ("industry", "persona_key") DO NOTHING;

-- ── 10 use cases, all under Flight Controller ────────────────────────────────
-- No collision risk with the migrated use cases: uniqueness is
-- (industry, persona_key, use_case_key) and 'flight_controller' is a new key.
INSERT INTO "quiz_use_cases" ("industry", "persona_key", "use_case_key", "title", "description", "icon_name", "sort_order") VALUES
  ('space', 'flight_controller', 'mission_log_drafting',         'Mission Log Drafting & Summaries',                 '', 'FileText',     0),
  ('space', 'flight_controller', 'telemetry_interpretation',     'Real-Time Telemetry Interpretation',               '', 'Activity',    10),
  ('space', 'flight_controller', 'anomaly_triage',               'Anomaly Detection & Rapid Triage',                 '', 'AlertTriangle',20),
  ('space', 'flight_controller', 'procedure_lookup',             'Procedure Lookup & Cross-Reference',               '', 'Search',      30),
  ('space', 'flight_controller', 'shift_handover_package',       'Shift Handover Package Generation',                '', 'FileCheck',   40),
  ('space', 'flight_controller', 'flight_rule_retrieval',        'Flight Rule Retrieval & Summarization',            '', 'BookOpen',    50),
  ('space', 'flight_controller', 'timeline_reconstruction',      'Timeline / Event Sequence Reconstruction',         '', 'Clock',       60),
  ('space', 'flight_controller', 'comms_drafting',               'Communications Drafting (internal + external)',    '', 'MessageSquare',70),
  ('space', 'flight_controller', 'incident_report_drafting',     'Incident Report Drafting',                         '', 'PenTool',     80),
  ('space', 'flight_controller', 'system_status_consolidation',  'System Status Consolidation Across Consoles',      '', 'Layers',      90)
ON CONFLICT ("industry", "persona_key", "use_case_key") DO NOTHING;

-- ── 10 outcomes, all under Flight Controller ─────────────────────────────────
-- These are the FIRST genuinely persona-scoped outcomes in the platform. Every
-- migrated outcome carries the '*' (industry-wide) sentinel, because that older
-- content has no persona linkage at all — the gap #271 was filed to close.
INSERT INTO "quiz_outcomes" ("industry", "persona_key", "outcome_key", "title", "description", "icon_name", "sort_order") VALUES
  ('space', 'flight_controller', 'faster_anomaly_triage',          'Faster anomaly detection and triage',                   '', 'Zap',          0),
  ('space', 'flight_controller', 'telemetry_accuracy',             'Higher accuracy in interpreting real-time telemetry',   '', 'Target',      10),
  ('space', 'flight_controller', 'reduced_cognitive_load',         'Reduced cognitive load during mission operations',      '', 'Activity',    20),
  ('space', 'flight_controller', 'reliable_shift_handover',        'More reliable shift handover packages',                 '', 'FileCheck',   30),
  ('space', 'flight_controller', 'faster_procedure_retrieval',     'Faster retrieval of procedures and flight rules',       '', 'Search',      40),
  ('space', 'flight_controller', 'comms_clarity',                  'Improved communication clarity across consoles',        '', 'MessageSquare',50),
  ('space', 'flight_controller', 'incident_documentation',         'Better incident and anomaly documentation',             '', 'FileText',    60),
  ('space', 'flight_controller', 'mission_log_consistency',        'More consistent mission log quality',                   '', 'CheckCircle2',70),
  ('space', 'flight_controller', 'less_multi_console_synthesis',   'Reduced time spent synthesizing multi-console data',    '', 'Clock',       80),
  ('space', 'flight_controller', 'operational_safety_confidence',  'Increased operational safety and decision confidence',  '', 'ShieldCheck', 90)
ON CONFLICT ("industry", "persona_key", "outcome_key") DO NOTHING;

-- ── Verification — run after applying ────────────────────────────────────────
--
-- 1. Expect 10 / 10 / 10 / 10 from this seed:
-- SELECT count(*) FROM "quiz_persona_clusters" WHERE industry = 'space'
--   AND cluster_key IN ('mission_flight_ops','engineering_technical','manufacturing_production',
--       'research_science','safety_compliance','program_project_mgmt','ground_systems_infra',
--       'it_data_simulation','business_admin','comms_public_affairs');
-- SELECT count(*) FROM "quiz_personas"   WHERE industry='space' AND cluster_key='mission_flight_ops';
-- SELECT count(*) FROM "quiz_use_cases"  WHERE industry='space' AND persona_key='flight_controller';
-- SELECT count(*) FROM "quiz_outcomes"   WHERE industry='space' AND persona_key='flight_controller';
--
-- 2. Confirm nothing was silently skipped. If any count above is short, a key
--    already existed and ON CONFLICT DO NOTHING dropped the row — find it with:
-- SELECT persona_key, cluster_key, title FROM "quiz_personas"
--  WHERE industry = 'space' ORDER BY cluster_key, sort_order;
--
-- 3. The real end-to-end chain this issue was about — Flight Controller now
--    reaching its own outcomes, which no persona could do before #271:
-- SELECT c.title AS cluster, p.title AS persona, u.title AS use_case, o.title AS outcome
--   FROM "quiz_persona_clusters" c
--   JOIN "quiz_personas"  p ON p.industry = c.industry AND p.cluster_key = c.cluster_key
--   LEFT JOIN "quiz_use_cases" u ON u.industry = p.industry AND u.persona_key = p.persona_key
--   LEFT JOIN "quiz_outcomes"  o ON o.industry = p.industry AND o.persona_key = p.persona_key
--  WHERE c.industry = 'space' AND p.persona_key = 'flight_controller'
--  ORDER BY u.sort_order, o.sort_order;
--
-- ── OPTIONAL — retire the superseded placeholder space rows ──────────────────
-- Commented out on purpose. Run ONLY when you have decided the migrated
-- placeholder content for space should go; it is what removes the duplicate
-- "Mission Operations" cluster and the second Mission Specialist / Flight
-- Director / Flight Surgeon. Order matters (children before parents), and this
-- touches ONLY the four old space cluster keys — no other industry.
--
-- DELETE FROM "quiz_use_cases"
--  WHERE industry = 'space'
--    AND persona_key IN (SELECT persona_key FROM "quiz_personas"
--                         WHERE industry = 'space'
--                           AND cluster_key IN ('science_research','mission_ops','engineering','prog_admin'));
-- DELETE FROM "quiz_outcomes"
--  WHERE industry = 'space'
--    AND persona_key IN (SELECT persona_key FROM "quiz_personas"
--                         WHERE industry = 'space'
--                           AND cluster_key IN ('science_research','mission_ops','engineering','prog_admin'));
-- DELETE FROM "quiz_personas"
--  WHERE industry = 'space'
--    AND cluster_key IN ('science_research','mission_ops','engineering','prog_admin');
-- DELETE FROM "quiz_persona_clusters"
--  WHERE industry = 'space'
--    AND cluster_key IN ('science_research','mission_ops','engineering','prog_admin');
--
-- NOTE: space's industry-wide outcomes (persona_key = '*': res_accel,
-- mission_safety, doc_quality, eng_accuracy) are NOT touched by the block above,
-- since they hang off no cluster. They will keep showing for every space
-- persona alongside Flight Controller's real ten. Delete them separately if you
-- want Flight Controller to show only its own:
-- DELETE FROM "quiz_outcomes" WHERE industry = 'space' AND persona_key = '*';
