-- ════════════════════════════════════════════════════════════════════════════
-- Git #403 — Nested-array audit: which ACTIVE monitor checks are reading a
-- field that lives one level down inside an array, and therefore reading
-- nothing at all?
--
-- READ-ONLY. Nothing here writes. Every statement is a SELECT.
--
-- WHY THIS IS SQL AND NOT CODE: monitor_checks.mapping and
-- monitor_checks.severity_rules are jsonb DATA held only in the database.
-- Nothing in the repo records what any live check's sourceField actually says,
-- so the four checks #403 names could not be inspected from a Claude Code
-- session — the claims below are stated as QUESTIONS THIS SQL ANSWERS, not as
-- findings.
--
-- The gap this hunts, in one sentence: applyMapping resolves sourceField with
-- resolvePathInData, which walks NAMED PROPERTIES ONLY. On a real user,
-- "assignedLicenses.skuId" steps into the array (an object, so the walk
-- continues), asks it for a "skuId" property it does not have, and yields
-- undefined — silently, for every user in the tenant.
--
-- The vocabulary added in #403 (artifacts/api-server/src/lib/monitor-executor.ts):
--   valueWhere('matchField','matchValue'[,'extractField'])
--        — find one entry in an array of {name, value}-shaped objects by
--          matching one field, extract another. Returns NULL when absent and
--          "" when present-but-unset, which Graph really does distinguish.
--   flattenValues('field')
--        — that field out of every object in every item's nested array, as one
--          flat list. Readable by `contains` and `length>`.
--   countDuplicatesBy('field')
--        — flattenValues, then the SAME duplicate tally countDuplicates uses.
--
-- Run each part and read the `verdict` column. Parts A and B name a specific
-- check and a specific rewrite; C, D and E are the questions #403 could not
-- answer without the database.
-- ════════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
-- PART A — Dot-paths with TWO OR MORE segments whose first segment is a known
-- Graph ARRAY field.
--
-- Each of these resolves to undefined on every item, forever, with no error and
-- no warning: count -> 0, join -> "", countEquals -> 0, exists -> false. The
-- check runs green and reports a fabricated-looking-honest number.
--
-- The array-field list is a hand-maintained sample of the v1.0 collections this
-- platform's checks actually touch, so this is a FLOOR, not a census — extend
-- it rather than trusting an empty result.
--
-- FIX: sourceField becomes the ARRAY alone and the transform names the nested
-- field, e.g. {"sourceField":"assignedLicenses.skuId","transform":"join"}
--         ->  {"sourceField":"assignedLicenses","transform":"flattenValues('skuId')"}
-- ════════════════════════════════════════════════════════════════════════════

WITH graph_array_fields(f) AS (
  VALUES ('assignedLicenses'), ('assignedPlans'), ('provisionedPlans'),
         ('values'), ('owners'), ('members'), ('memberOf'), ('transitiveMemberOf'),
         ('groupTypes'), ('proxyAddresses'), ('businessPhones'),
         ('servicePlans'), ('prepaidUnits'), ('licenseDetails'),
         ('grantControls'), ('conditions'), ('sessionControls'),
         ('reviewers'), ('fallbackReviewers'), ('instances'), ('decisions'),
         ('stageSettings'), ('applyActions'),
         ('grantedToIdentitiesV2'), ('permissions'), ('roleDefinitions'),
         ('assignments'), ('alerts'), ('detections'), ('evidence'),
         ('disabledPlans'), ('scopes'), ('resources'), ('identities')
)
SELECT c.key,
       c.label,
       c.status,
       m->>'sourceField'  AS source_field,
       m->>'targetField'  AS target_field,
       m->>'transform'    AS transform,
       split_part(m->>'sourceField', '.', 1) AS array_field,
       split_part(m->>'sourceField', '.', 2) AS nested_field,
       'DOT-PATH THROUGH AN ARRAY — resolves to undefined on EVERY item. '
       || 'Rewrite as sourceField=' || split_part(m->>'sourceField', '.', 1)
       || ' with flattenValues(''' || split_part(m->>'sourceField', '.', 2) || ''') '
       || 'or countDuplicatesBy(''' || split_part(m->>'sourceField', '.', 2) || ''') '
       || 'or valueWhere(...)' AS verdict
FROM monitor_checks c
CROSS JOIN LATERAL jsonb_array_elements(c.mapping) AS m
WHERE c.status = 'active'
  AND position('.' IN COALESCE(m->>'sourceField', '')) > 0
  AND split_part(m->>'sourceField', '.', 1) IN (SELECT f FROM graph_array_fields)
ORDER BY c.key;


-- ════════════════════════════════════════════════════════════════════════════
-- PART B — countDuplicates / groupByCount pointed at an array of OBJECTS.
--
-- THE LOUDEST QUERY IN THIS FILE. countDuplicates stringifies each array entry
-- with String(v). For an object that is the literal text "[object Object]" —
-- IDENTICAL for every entry — so every licence in the tenant collides with
-- every other one and the count becomes "how many licence assignments exist at
-- all (if there are two or more)", not "how many are duplicated". The number is
-- large, plausible, monotonically rising with tenant size, and wrong.
--
-- #403 could not confirm whether licensing:duplicate-assignments is in this
-- state, because its mapping lives only in this database. 0191 rewrote its
-- transform from "countWhere" to "countDuplicates" without touching
-- sourceField, so the question is open. This query settles it.
--
-- FIX: countDuplicatesBy('skuId') with sourceField = assignedLicenses.
--
-- CAVEAT, and it is not a small one: countDuplicatesBy flattens across ALL
-- users, so a SKU held by two DIFFERENT users counts as a duplicate. That
-- answers "which SKUs are widely held", NOT "which users hold two overlapping
-- licences" — which is what "duplicate assignment" normally means to an MSP.
-- Decide which question the check is asking BEFORE rewiring it.
-- ════════════════════════════════════════════════════════════════════════════

SELECT c.key,
       c.label,
       c.status,
       c.endpoint,
       m->>'sourceField'  AS source_field,
       m->>'targetField'  AS target_field,
       m->>'transform'    AS transform,
       CASE
         WHEN m->>'transform' = 'countDuplicates'
           THEN 'IF this sourceField holds an array of OBJECTS, every entry '
                || 'stringifies to "[object Object]" and the count is the whole '
                || 'estate. Confirm against a real tenant_monitor_profiles row '
                || '(Part E), then move to countDuplicatesBy(''<field>'').'
         ELSE 'groupByCount over objects buckets everything under the single '
              || 'key "[object Object]" — same failure, different shape.'
       END AS verdict
FROM monitor_checks c
CROSS JOIN LATERAL jsonb_array_elements(c.mapping) AS m
WHERE c.status = 'active'
  AND m->>'transform' IN ('countDuplicates', 'groupByCount')
ORDER BY c.key;


-- ════════════════════════════════════════════════════════════════════════════
-- PART C — The four checks #403 names, in full.
--
-- Everything a decision needs, in one row each: endpoint, fan-out config,
-- mapping and severity rules. Read this BEFORE rewiring anything — #403
-- deliberately did not touch these rows.
--
-- What the Graph v1.0 reference already settles about them:
--
--   governance:guest-access-reviews   NEEDS NO CODE. An access review
--       definition's scope really is {"@odata.type":
--       "#microsoft.graph.accessReviewQueryScope", "query": "...", "queryType":
--       "MicrosoftGraph"}, and for a guest review the query text really does
--       contain `userType eq 'Guest'` verbatim. A `join` over the nested
--       dot-path scope.query plus the EXISTING contains operator reads it —
--       proved by test, both quoted and unquoted. This is a severity_rules
--       UPDATE, nothing more. Check below whether it already has one.
--
--   governance:group-expiration-policy   CHECK THE ENDPOINT FIRST. #403's
--       premise was that groupLifetimeInDays is a named entry inside
--       /groupSettings' values array. It is NOT. groupLifetimeInDays is a
--       TOP-LEVEL Int32 on groupLifecyclePolicy (GET /groupLifecyclePolicies),
--       where `first`/`count` already read it with no new transform at all.
--       /groupSettings' values array holds a different, real set of names —
--       AllowToAddGuests, EnableGroupCreation, PrefixSuffixNamingRequirement,
--       CustomBlockedWordsList, AllowGuestsToBeGroupOwner, ... — and THOSE are
--       what valueWhere is for. If this check points at /groupSettings it is
--       pointed at the wrong endpoint for expiration.
--
--   governance:overdue-access-reviews   NOT A TRANSFORM PROBLEM. The
--       definition carries createdDateTime / lastModifiedDateTime / status and
--       NO due date whatsoever. endDateTime lives on the accessReviewInstance,
--       and neither list-definitions nor get-definition supports
--       $expand=instances — the reference says outright "to retrieve the
--       instances of the access review series, use the list accessReviewInstance
--       API". So instances cannot be flattened out of the definitions payload;
--       the check must ENUMERATE them. That is this platform's existing fan-out:
--         fanOutSource = /identityGovernance/accessReviews/definitions
--         endpoint     = /identityGovernance/accessReviews/definitions/{itemId}/instances
--       Once it fans out, endDateTime is already a flat top-level ISO string and
--       #401's `olderThanDays 0` reads it directly. THE REMAINING GAP, and it is
--       real: nothing in the transform vocabulary COUNTS items whose date field
--       is in the past (countIfLastSignInOlderThan is hardcoded to
--       signInActivity.lastSignInDateTime). A generic countOlderThan('field', N)
--       is the follow-up. Out of #403's scope; recorded here so it is not
--       rediscovered by hand a fourth time.
--
--   licensing:duplicate-assignments   See Part B.
-- ════════════════════════════════════════════════════════════════════════════

SELECT c.key,
       c.label,
       c.status,
       c.endpoint,
       c.method,
       c.fan_out_source,
       c.fan_out_item_id_field,
       jsonb_pretty(c.mapping)        AS mapping,
       jsonb_pretty(c.severity_rules) AS severity_rules
FROM monitor_checks c
WHERE c.key IN (
  'governance:guest-access-reviews',
  'governance:group-expiration-policy',
  'governance:overdue-access-reviews',
  'licensing:duplicate-assignments',
  'cost:duplicate-assignments'
)
ORDER BY c.key;


-- ════════════════════════════════════════════════════════════════════════════
-- PART D — Checks whose endpoint fetches an array of name/value pairs but whose
-- mapping never names an entry inside it.
--
-- The /groupSettings shape, generalised. Graph returns the FULL template for
-- any settings object a tenant has created, so `exists` on `values` is true for
-- every tenant that has ever touched group settings — including one that
-- configured nothing. A check whose only signal is "the array is there" is
-- reporting tenant-has-a-settings-object, not tenant-has-a-policy.
--
-- FIX: valueWhere('name', '<SettingName>'), then a rule that tests BOTH states:
--        {{x}} == null || {{x}} == ''
--      because absent and present-but-unset are genuinely different answers and
--      only the first one means "no settings object exists at all".
-- ════════════════════════════════════════════════════════════════════════════

SELECT c.key,
       c.label,
       c.status,
       c.endpoint,
       jsonb_pretty(c.mapping) AS mapping,
       'ENDPOINT RETURNS name/value PAIRS but no mapping rule reads one by name '
       || '— any signal here is "a settings object exists", not "a policy is set"' AS verdict
FROM monitor_checks c
WHERE c.status = 'active'
  AND (c.endpoint ILIKE '%groupSettings%' OR c.endpoint ILIKE '%/settings%'
       OR c.endpoint ILIKE '%settingTemplates%' OR c.endpoint ILIKE '%directorySetting%')
  AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(c.mapping) m
         WHERE m->>'transform' LIKE 'valueWhere%'
      )
ORDER BY c.key;


-- ════════════════════════════════════════════════════════════════════════════
-- PART E — Live proof, from this platform's own captured responses.
--
-- The only part of this file that reads real tenant data rather than check
-- configuration. tenant_monitor_profiles.raw_response holds the FIRST PAGE of
-- what Graph actually returned, so it can settle the shape questions above
-- against a real tenant instead of against the reference docs.
--
-- IMPORTANT LIMIT, inherited from graphFetchPaginated: raw_response is the
-- first page ONLY (and for CSV reports, five rows only). Use it to confirm
-- FIELD SHAPES — never to recompute a count.
-- ════════════════════════════════════════════════════════════════════════════

-- E1. Does a real captured /groupSettings response have the {name, value} shape,
--     and which names does this tenant's template actually carry?
SELECT p.tenant_id,
       p.check_key,
       p.collected_at,
       s->>'displayName' AS settings_object,
       s->>'templateId'  AS template_id,
       (SELECT string_agg(v->>'name', ', ' ORDER BY v->>'name')
          FROM jsonb_array_elements(s->'values') v) AS setting_names,
       (SELECT count(*) FROM jsonb_array_elements(s->'values') v
         WHERE COALESCE(v->>'value', '') = '')      AS unset_count
FROM tenant_monitor_profiles p
CROSS JOIN LATERAL jsonb_array_elements(p.raw_response->'value') AS s
WHERE p.raw_response ? 'value'
  AND s ? 'values'
  AND jsonb_typeof(s->'values') = 'array'
ORDER BY p.collected_at DESC
LIMIT 50;

-- E2. Does a real captured user page carry assignedLicenses as an array of
--     OBJECTS with a skuId? If skuid_present is true and the check still uses
--     countDuplicates, Part B's failure is live, not hypothetical.
SELECT p.tenant_id,
       p.check_key,
       p.collected_at,
       jsonb_array_length(u->'assignedLicenses')                    AS licence_count,
       (u->'assignedLicenses'->0) ? 'skuId'                         AS skuid_present,
       jsonb_typeof(u->'assignedLicenses'->0)                       AS entry_type,
       u->'assignedLicenses'->0->>'skuId'                           AS sample_sku
FROM tenant_monitor_profiles p
CROSS JOIN LATERAL jsonb_array_elements(p.raw_response->'value') AS u
WHERE p.raw_response ? 'value'
  AND u ? 'assignedLicenses'
  AND jsonb_typeof(u->'assignedLicenses') = 'array'
  AND jsonb_array_length(u->'assignedLicenses') > 0
ORDER BY p.collected_at DESC
LIMIT 50;

-- E3. Does a real captured access review definitions page carry scope.query,
--     and does any of this tenant's reviews actually target guests? This is the
--     query that turns "guest-access-reviews needs only a severity_rules UPDATE"
--     from a documented claim into a verified one for THIS tenant.
SELECT p.tenant_id,
       p.check_key,
       p.collected_at,
       d->>'id'                       AS definition_id,
       d->>'displayName'              AS display_name,
       d->>'status'                   AS status,
       d->'scope'->>'@odata.type'     AS scope_type,
       d->'scope'->>'query'           AS scope_query,
       (d->'scope'->>'query') LIKE '%userType eq ''Guest''%' AS targets_guests,
       d ? 'endDateTime'              AS definition_has_end_date  -- expected: false
FROM tenant_monitor_profiles p
CROSS JOIN LATERAL jsonb_array_elements(p.raw_response->'value') AS d
WHERE p.raw_response ? 'value'
  AND d ? 'scope'
  AND p.check_key ILIKE '%access-review%'
ORDER BY p.collected_at DESC
LIMIT 50;

-- E4. Every distinct transform in use, with how many active checks use it —
--     the running census the #401 audit started. A name here that is not in
--     the vocabulary listed at the top of this file is a live silent failure.
SELECT m->>'transform' AS transform,
       count(*)        AS mapping_rules,
       count(DISTINCT c.key) AS checks,
       string_agg(DISTINCT c.key, ', ' ORDER BY c.key) AS check_keys
FROM monitor_checks c
CROSS JOIN LATERAL jsonb_array_elements(c.mapping) AS m
WHERE c.status = 'active'
GROUP BY 1
ORDER BY 2 DESC;
