-- Git #2937 — action.submit-file-detonation stores POST /security/alerts_v2,
-- an operation Microsoft Graph does not expose.
--
-- WHY THIS RETIRES THE STEP RATHER THAN REPOINTING IT AT THE COMMENTS ENDPOINT
-- ---------------------------------------------------------------------------
-- #2937 named two materially different candidate fixes and asked which the row
-- was actually MEANT to be. The row's own provenance answers it, and it is not
-- "comment on an alert":
--
--   write_action_catalog id 204 — created 2026-07-20 15:00:50-04, three hours
--   BEFORE the baseline_action_templates row (2026-07-20 18:21:15-04) — records
--   the original intent independently of any endpoint:
--       domain              = 'Security (Defender)'
--       action_name         = 'Submit file/URL for detonation'
--       surface             = 'defender'
--       required_permission = 'TBD - Defender Application permission'
--
--   The catalogue row says, in its own stored data, that this is a DEFENDER
--   action whose Defender application permission was never determined. The
--   template row written later then improvised a Graph endpoint and body for it.
--
-- Three further pieces of the stored row agree with that reading:
--   1. required_variables is ["fileOrUrl"] — a file/URL submission variable that
--      neither the stored endpoint nor the stored body ever consumes. A comment-
--      on-alert step would carry ["alertId"], which is what action.resolve-alert
--      (PATCH /security/alerts_v2/{{alertId}}) genuinely carries.
--   2. The label is "Submit File/URL for Detonation". Re-reading it as an alert
--      comment would require rewriting the label, the description, the required
--      variables, the catalogue action_name AND the catalogue surface — that is
--      not correcting a defect, it is substituting a different capability.
--   3. Alert writing is already covered: action.resolve-alert and
--      action.manage-incident exist. The catalogue does not need a third.
--
-- So the endpoint is not a typo for /security/alerts_v2/{{alertId}}/comments.
-- The capability is detonation, detonation is not on the Graph alerts_v2 surface
-- at all, and this platform's sole write executor is Graph REST — which is
-- exactly why isNonGraphEndpoint() (graph-write-permissions.ts) already treats
-- /api/machines/ and /api/indicators as untransportable.
--
-- WHY NOT SIMPLY MOVE IT BEHIND isNonGraphEndpoint()
-- ---------------------------------------------------------------------------
-- That would require storing a real, documented Defender endpoint. Microsoft's
-- documented Defender for Endpoint machine actions are Isolate, Unisolate,
-- RunAntiVirusScan, CollectInvestigationPackage, RestrictCodeExecution,
-- StopAndQuarantineFile and LiveResponse — none of them is a file/URL detonation
-- submission. Inventing a plausible-looking /api/... path to make the row "look
-- non-Graph" would be fabricating an endpoint, which is precisely the defect
-- #2937 is about. The honest state is that no endpoint has been designed for it.
--
-- WHAT THIS DOES
-- ---------------------------------------------------------------------------
-- 1. Archives the template (status 'archived' — the first-class, non-destructive
--    retirement the schema already defines: "Archived (not hard-deleted)
--    templates are grandfathered into any config pack that already references
--    them", mirroring MONITOR_CHECK_STATUS). No config_pack_templates row
--    references it (verified: 0 rows), so nothing is grandfathered here. The
--    fabricated endpoint/method/body are deliberately left ON the archived row
--    as the record of what was stored; the description now states plainly that
--    they are not real.
-- 2. Returns write_action_catalog id 204 to the honest state its own sibling
--    already sits in — id 203 "Release from quarantine", also surface 'defender',
--    is 'endpoint_design_pending' with no template_id. 204 is now the same, with
--    a real blocked_reason instead of an empty one.
--
-- The capability is NOT deleted from the catalogue: write_action_catalog id 204
-- still records that Shane wants file/URL detonation. It is recorded as pending
-- an endpoint design, which is true, instead of 'execution_ready' pointing at a
-- Graph operation that does not exist, which was not.

BEGIN;

UPDATE baseline_action_templates
SET status = 'archived',
    description =
      'ARCHIVED (#2937). Not executable: the stored endpoint POST /security/alerts_v2 is not a real '
      || 'Microsoft Graph operation — the v1.0 microsoft.graph.security.alert resource documents only '
      || 'List, Get, Update, Create comment and Move alerts, with no POST on the collection, and the '
      || 'stored body {"comment": "..."} is the shape of POST /security/alerts_v2/{alertId}/comments, a '
      || 'different operation. The capability this row was meant to provide — file/URL detonation — is a '
      || 'Microsoft Defender capability, not a Graph one (write_action_catalog id 204 records it as '
      || 'surface ''defender'' with the Defender application permission still TBD), and this platform''s '
      || 'only write transport is Graph REST. Tracked for a real endpoint design on write_action_catalog '
      || 'id 204, now endpoint_design_pending. The endpoint/method/body fields are left as they were '
      || 'stored, as the record of the defect; they are not a real API.',
    updated_at = now()
WHERE template_id = 'action.submit-file-detonation';

UPDATE write_action_catalog
SET status = 'endpoint_design_pending',
    template_id = NULL,
    blocked_reason =
      'No endpoint designed (#2937). The previously linked template action.submit-file-detonation stored '
      || 'POST /security/alerts_v2, which Microsoft Graph does not expose, and has been archived. File/URL '
      || 'detonation is a Defender capability with no documented Defender for Endpoint machine action '
      || 'behind it, and this platform executes writes over Graph REST only — so it needs both a real '
      || 'endpoint and a Defender transport before it can be execution_ready.'
WHERE id = 204
  AND domain = 'Security (Defender)'
  AND action_name = 'Submit file/URL for detonation';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-05-retire-submit-file-detonation-2937.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
