-- ============================================================================
-- #551 PHASE 2 -- identity:global-admin-count counts ACTIVATED DIRECTORY ROLES,
-- not Global Administrators. Repoint it at the role's actual members.
-- ============================================================================
-- Manual migration -- Shane runs this himself (no DATABASE_URL in the Claude
-- environment, per CLAUDE.md). Idempotent: a plain UPDATE of one row by key,
-- safe to re-run.
--
-- ── WHAT WAS WRONG (confirmed live 2026-08-07, not hypothesised) ─────────────
-- The check ran GET /directoryRoles with mapping
--   [{"transform":"count","sourceField":"id","targetField":"globalAdminCount"}]
--
-- Graph documents that endpoint as "List the directory roles that are ACTIVATED
-- in the tenant" -- it returns role objects (id / displayName / roleTemplateId),
-- and members appear nowhere in the payload. So counting `id` counted how many
-- kinds of admin role have ever been activated in the tenant.
--
-- The live run on the real testbed tenant:
--     item_count: 14      globalAdminCount: 14      severity_matched: critical
--     members_count: 0    members_first: null       members_values: []
--
-- Note that last line. The old `properties` array asked for "members" and got
-- NOTHING on every scan, because directoryRole objects carry no members inline
-- -- the relationship has to be traversed. The check has been recording its own
-- defect in extracted_properties the whole time, while reporting `critical`
-- ("Far more Global Administrators than any real operational need") to a real
-- customer on a count of activated roles.
--
-- ── THE ENDPOINT -- CONFIRMED, NOT ASSUMED (v1.0 reference, 2026-08-07) ──────
-- learn.microsoft.com/en-us/graph/api/directoryrole-list-members
--
--   "You can address the directory role using either its id or roleTemplateId."
--     GET /directoryRoles/{role-id}/members
--     GET /directoryRoles(roleTemplateId='{roleTemplateId}')/members
--
-- The ALTERNATE-KEY form is what this migration uses, and it removes the only
-- hard part of the fix. A directoryRole's `id` is a tenant-specific GUID, so an
-- id-based URL could not be stored as static config -- it would need a lookup
-- call per tenant per scan. The roleTemplateId is the opposite: a fixed,
-- immutable well-known constant, IDENTICAL IN EVERY TENANT
-- (learn.microsoft.com/en-us/entra/identity/role-based-access-control/
-- permissions-reference). Global Administrator's is
--   62e90394-69f5-4237-9190-012177145e10
-- so the whole check stays one static endpoint string with zero lookups.
--
-- >>> PERMISSIONS: the API's least-privileged permission is
--     RoleManagement.Read.Directory, which this platform does NOT hold -- but
--     the same doc lists Directory.Read.All under "Higher privileged
--     permissions" for Application-type access, and Directory.Read.All is
--     already first in REQUIRED_MT_SCOPES (artifacts/api-server/src/lib/graph.ts).
--     NO new scope, and therefore NO tenant re-consent, is needed. (Same
--     conclusion #357 reached for Sites.Read.All.) <<<
--
-- ── CANDIDATES CHECKED AND REJECTED ─────────────────────────────────────────
--   1. GET /directoryRoles?$filter=roleTemplateId eq '...' then a second call to
--      /directoryRoles/{id}/members -- REJECTED. Correct, but two Graph round
--      trips per tenant per scan to obtain something the alternate key gives in
--      one, and it would need the fan-out machinery (or new executor code) to
--      thread the first call's result into the second. No benefit.
--   2. GET /roleManagement/directory/roleAssignments?$expand=principal
--      &$filter=roleDefinitionId eq '62e90394-...' -- REJECTED for THIS check.
--      It is a real v1.0 surface and Microsoft's recommended successor API, but
--      it returns assignment objects that need an $expand to yield a person, and
--      the platform already runs identity:pim-permanent-roles against exactly
--      this endpoint. Repointing global-admin-count here would duplicate that
--      check's surface rather than fix this one.
--   3. Beta /roleManagement/directory/roleAssignmentScheduleInstances --
--      REJECTED. PIM-flavoured, needs RoleAssignmentSchedule.Read.Directory
--      (not consented) and Entra ID P2, for data this check does not need.
--
-- ── WHY select_params STAYS NULL ────────────────────────────────────────────
-- Deliberate, not an omission. The response is a POLYMORPHIC directoryObject
-- collection -- users, role-assignable groups and service principals in one
-- list. Graph's default projection already returns displayName /
-- userPrincipalName / mail for the user entries (see the doc's own example
-- response) plus the @odata.type discriminator on each entry. A $select naming
-- user-only fields is the thing most likely to break on the group and service
-- principal entries, and it would buy nothing here. The endpoint supports ONLY
-- $select anyway -- no $filter, no $top.
--
-- ── THE THREE HONESTY CAVEATS, BUILT IN RATHER THAN ASSUMED AWAY ────────────
-- These are recorded in `description` (the check's own documentation surface,
-- which the admin UI and document generation both read) AND, where they can be,
-- in the emitted DATA -- prose alone would be a promise, not a mechanism.
--
--   1. ACTIVE MEMBERS ONLY -- PIM-eligible admins are invisible here.
--      /members returns standing assignments. A tenant doing privileged access
--      properly (GAs eligible via PIM, activating on demand) will report a
--      LOWER number than its real standing privilege. This number must never be
--      presented as "total privileged access" on its own; it belongs beside
--      identity:pim-eligible-roles, which the platform already runs. Recorded in
--      `description` because there is no field this check can emit that would
--      make an absent assignment visible -- the honest move is to say so.
--
--   2. NOT EVERY MEMBER IS A HUMAN -- discriminate, don't conflate.
--      This one IS enforced in data, not prose: the new mapping emits
--      `globalAdminsByPrincipalType` (a groupByCount over @odata.type, so
--      "#microsoft.graph.user" / ".group" / ".servicePrincipal" each get their
--      own real count) plus `globalAdminUserCount` and
--      `globalAdminServicePrincipalCount`. A consumer that wants humans now has
--      a field that means humans. NOTE: a role-assignable GROUP member means the
--      real human count is unbounded by this response -- the group's own
--      membership is not enumerated here.
--
--      >>> This needs the resolvePathInData literal-key fix shipped alongside
--          this migration (monitor-executor.ts, same issue). `@odata.type`
--          contains a dot but is a FIELD NAME, not a path; the resolver split it
--          unconditionally and asked each item for item["@odata"]["type"], which
--          is undefined on every real Graph object. Without that code change
--          `globalAdminsByPrincipalType` would silently come back {}. The two
--          `countTruthy` rules below are deliberately dot-free and work either
--          way, so the human/app split survives even if this file is somehow run
--          against an older build. <<<
--
--   3. HARD 1,000-OBJECT CEILING, NO PAGINATION.
--      The doc is explicit: "It returns a default of 1,000 objects and doesn't
--      support pagination using $top." Irrelevant at any realistic Global
--      Administrator count, but it is a real bound and nothing downstream should
--      imply completeness past it. Recorded in `description`. Left as
--      documentation rather than a synthetic "truncated" flag on purpose: the
--      mapping vocabulary has no way to test items.length against a constant,
--      and inventing a field the executor cannot actually populate would be a
--      worse lie than the plain statement.
--
-- ── WHAT globalAdminCount NOW MEANS, AND WHY IT IS ALL MEMBERS ──────────────
-- `globalAdminCount` deliberately stays the count of ALL members, not just
-- users, because severity_rules read that field and this migration DOES NOT
-- TOUCH severity_rules (see below). It is also the security-correct reading: a
-- service principal holding Global Administrator is privileged attack surface
-- and belongs in the total. Consumers wanting the human-only figure now have
-- `globalAdminUserCount`.
--
-- ── severity_rules: DELIBERATELY NOT IN THE UPDATE ──────────────────────────
-- The existing three bands (>= 10 critical, >= 5 warning, < 2 warning) were
-- reviewed in the #551 investigation and are well designed -- including the
-- often-missed `< 2` single-point-of-failure rule. They were never the defect;
-- they were correct rules reading a number that meant something else. Once
-- globalAdminCount means members, they become right for the first time. They are
-- absent from the SET clause below so a re-run cannot disturb them.
--
-- ── PER-ITEM DETAIL: NO WIRING NEEDED, IT IS ALREADY RUNNING ────────────────
-- No monitoring_package_checks change in this file, on purpose. The live audit
-- confirmed this check is ALREADY linked to detail:full-item-collection (61 rows
-- / 711 items collected). That runner persists each check's raw Graph items with
-- includeItems:true regardless of fan-out (item-detail-collector.ts), which is
-- why 711 directoryRole objects were already being stored. Fixing the endpoint
-- turns that same, already-running collection into a real per-admin list --
-- name, UPN, mail and principal type per row -- with no new plumbing. That was
-- the single cheapest part of this fix and it costs nothing here.
--
-- ── VERIFICATION STATUS -- READ THIS ────────────────────────────────────────
-- NOT smoke-tested against a live tenant. There is no DATABASE_URL and no Graph
-- credential in the environment this was written in, so the ONE thing that
-- genuinely cannot be proven here is that the literal single quote in
-- roleTemplateId='...' survives the real request path end to end. It is pinned
-- by unit tests through the platform's own URL construction
-- (global-admin-count-role-members-551.test.ts drives resolveEndpointPlaceholders
-- and reproduces graphFetchPaginated's exact concatenation), and Graph documents
-- this URL form verbatim -- but that is not the same as a 200 from a real
-- tenant. PART C below is the one-line live confirmation; run it before trusting
-- the number.
-- ============================================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- PART A -- READ-ONLY: the before-state, on the record
-- ══════════════════════════════════════════════════════════════════════════════
-- Expect endpoint '/directoryRoles', properties ["id","members"], and the single
-- count-on-id mapping rule. Keep this output.

SELECT key, label, endpoint, select_params, properties, mapping, severity_rules,
       engines, schema_version, status
FROM monitor_checks
WHERE key = 'identity:global-admin-count';


-- ══════════════════════════════════════════════════════════════════════════════
-- PART B -- THE CORRECTION (transactioned). Review PART A output first.
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

UPDATE monitor_checks
SET
  endpoint = '/directoryRoles(roleTemplateId=''62e90394-69f5-4237-9190-012177145e10'')/members',

  -- Raw property extraction. applyMapping emits <prop>_count / <prop>_first /
  -- <prop>_values for each, so displayName_values and userPrincipalName_values
  -- become the real per-admin lists inside extracted_properties -- the aggregate
  -- row alone now names the people, before anything reads the detail table.
  -- "members" is GONE: it asked directoryRole objects for a field they never
  -- carried and returned members_count 0 on every scan. The response IS the
  -- members list now, so there is nothing left to nest.
  -- @odata.type is read here via applyMapping's direct bracket access (which was
  -- always dot-safe) as well as via the mapping rule below.
  properties = '["id","displayName","userPrincipalName","mail","@odata.type"]'::jsonb,

  mapping = '[
    {"sourceField":"id","targetField":"globalAdminCount","transform":"count"},
    {"sourceField":"@odata.type","targetField":"globalAdminsByPrincipalType","transform":"groupByCount"},
    {"sourceField":"userPrincipalName","targetField":"globalAdminUserCount","transform":"countTruthy"},
    {"sourceField":"appId","targetField":"globalAdminServicePrincipalCount","transform":"countTruthy"}
  ]'::jsonb,

  description = 'Real Global Administrator MEMBERS, by name and principal type (#551). '
    || 'Reads GET /directoryRoles(roleTemplateId=''62e90394-69f5-4237-9190-012177145e10'')/members -- the v1.0 alternate-key form, '
    || 'so no tenant-specific role-ID lookup is required (roleTemplateId is a fixed constant in every tenant). '
    || 'Replaces the pre-#551 GET /directoryRoles, which returned ACTIVATED ROLE DEFINITIONS and whose count therefore reported '
    || 'how many kinds of admin role existed in the tenant, not how many administrators. '
    || 'THREE LIMITS THIS CHECK DOES NOT HIDE: '
    || '(1) ACTIVE ASSIGNMENTS ONLY -- PIM-eligible Global Administrators are NOT counted, so on a tenant using Privileged Identity '
    || 'Management this number understates standing privilege. Report it alongside identity:pim-eligible-roles, never alone as '
    || '"total privileged access". '
    || '(2) MEMBERS ARE NOT ALL PEOPLE -- the response mixes users, role-assignable groups and service principals. '
    || 'globalAdminCount is every privileged principal (the security-relevant total); globalAdminUserCount is humans; '
    || 'globalAdminServicePrincipalCount is app identities; globalAdminsByPrincipalType breaks all kinds out by @odata.type. '
    || 'A role-assignable GROUP member means the true human count is higher than any figure here, because that group''s own '
    || 'membership is not enumerated. '
    || '(3) HARD CEILING -- this endpoint returns at most 1,000 objects and supports no pagination, so nothing downstream may '
    || 'claim completeness beyond 1,000 members. '
    || 'App permission Directory.Read.All only -- already in REQUIRED_MT_SCOPES, so no re-consent. '
    || 'Per-admin detail (name / UPN / mail / type per row) reaches tenant_check_item_details through the '
    || 'detail:full-item-collection package this check was already linked to; no fan-out is involved.',

  schema_version = schema_version + 1,
  updated_at = now()
WHERE key = 'identity:global-admin-count'
RETURNING key, label, endpoint, select_params, properties, mapping, severity_rules, schema_version;

-- ── RECEIPT expectations ────────────────────────────────────────────────────
-- Exactly 1 row. endpoint now carries the parenthesised roleTemplateId form.
-- severity_rules MUST come back UNCHANGED -- the three >= 10 / >= 5 / < 2 bands,
-- byte for byte. They are not in the SET clause; if they differ, stop and
-- ROLLBACK, because something else wrote this row.
-- label ('Global Administrator Count') is intentionally untouched: it was always
-- the correct name for this check, it simply was not true until now.
--
-- If the receipt looks right:  COMMIT;
-- If anything looks wrong:     ROLLBACK;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-07-global-admin-count-role-members-551.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
COMMIT;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART C -- THE LIVE SMOKE TEST (do this, it is the one unproven thing)
-- ══════════════════════════════════════════════════════════════════════════════
-- The single quote inside roleTemplateId='...' is the only part of this change
-- that unit tests cannot fully settle -- they prove the platform builds the URL
-- intact, not that Graph answers it. Run the check once against the real testbed
-- tenant (Simulator Studio, or any path that executes identity:global-admin-count)
-- and then run this.
--
-- EXPECT:
--   * status 'ok', NOT an error mentioning "Invalid object identifier" or a 400 --
--     that would mean the quote did not survive and the endpoint needs
--     percent-encoding (%27) instead.
--   * item_count and globalAdminCount both equal to the tenant's REAL Global
--     Administrator count -- a small number. The old value was 14 (activated
--     roles). If it comes back 14 again, the row did not actually change.
--   * displayName_values / userPrincipalName_values populated with real people.
--   * members_count ABSENT (that key is gone from properties).
--   * globalAdminsByPrincipalType a real object like {"#microsoft.graph.user": 3}.
--     If it comes back {} while displayName_values is populated, the
--     resolvePathInData literal-key fix is not deployed -- ship the api-server
--     change with this migration.

SELECT p.status, p.severity_matched, p.collected_at, p.item_count, p.error_message,
       p.extracted_properties -> 'globalAdminCount'              AS global_admin_count,
       p.extracted_properties -> 'globalAdminUserCount'          AS human_admins,
       p.extracted_properties -> 'globalAdminServicePrincipalCount' AS app_admins,
       p.extracted_properties -> 'globalAdminsByPrincipalType'   AS by_type,
       p.extracted_properties -> 'displayName_values'            AS admin_names,
       p.extracted_properties -> 'userPrincipalName_values'      AS admin_upns
FROM tenant_monitor_profiles p
WHERE p.check_key = 'identity:global-admin-count'
ORDER BY p.collected_at DESC
LIMIT 5;


-- ── The per-admin list, straight out of the detail table ────────────────────
-- Confirms caveat 2 end to end: one row per member, with the principal type on
-- it. Before this migration these items were directoryRole objects.

-- SELECT d.tenant_id, d.collected_at, d.item_count, d.items_omitted_reason,
--        m ->> '@odata.type'        AS principal_type,
--        m ->> 'displayName'        AS name,
--        m ->> 'userPrincipalName'  AS upn
-- FROM tenant_check_item_details d
-- CROSS JOIN LATERAL jsonb_array_elements(COALESCE(d.items, '[]'::jsonb)) AS m
-- WHERE d.check_key = 'identity:global-admin-count'
-- ORDER BY d.collected_at DESC, principal_type, name;


-- ══════════════════════════════════════════════════════════════════════════════
-- FOLLOW-UP -- DELIBERATELY NOT DONE HERE
-- ══════════════════════════════════════════════════════════════════════════════
-- The #413 spectrum simulation seed (signal_simulation_profiles, profile named
-- '#413 spectrum -- real test tenant c4c814d4 (confirmed critical)') hardcodes
--     "globalAdminCount": 14
-- and the finding string "identity:global-admin-count: critical severity
-- condition matched (14 Global Administrators)".
--
-- Both are derived from the defect this file fixes, so the simulator will keep
-- asserting a fiction after the live check is right. It is NOT corrected here on
-- purpose: the replacement is the tenant's REAL Global Administrator count,
-- which only exists after PART C has been run. Guessing a number to put in a
-- profile whose whole purpose is to be a confirmed-real reference point would
-- reintroduce exactly the class of error #551 exists to remove.
--
-- Shane: once PART C returns a real number, that value (and a corrected finding
-- string) go into the seed. Q5c of
-- archive/diagnostics/2026-08-07-per-item-enumeration-audit-551.sql lists every
-- simulation row that needs it.
