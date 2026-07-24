-- Reframe: identity:continuous-access-evaluation — CAE as a Conditional Access session control
-- Manual migration — review and run by hand (do not run drizzle-kit push/push --force).
--
-- ── WHAT THIS SUPERSEDES ─────────────────────────────────────────────────────────
-- This is the implemented, approved version of the proposal left COMMENTED in
-- 2026-07-23-monitor-check-endpoint-corrections.sql, section 8. That section
-- explained why the check was failing ("Resource not found for the segment
-- 'conditionalAccess'") and sketched the v1.0 reframe but stopped short of shipping
-- it because it changes what the check MEANS (not just its URL) and therefore also
-- needs the mapping + signal rule to change — which that task was forbidden from
-- touching. Shane has since approved the reframe. This file makes it real.
--
-- ── WHAT THE CHECK USED TO MEAN (and why it could never work) ────────────────────
-- The old check looked for a STANDALONE, tenant-wide Continuous Access Evaluation
-- object ("is CAE on?"). No such object exists in Microsoft Graph v1.0. The only
-- standalone CAE policy singleton lives in /beta and is itself superseded (it
-- carries a `migrate` property) — Microsoft folded CAE INTO Conditional Access as
-- an optional per-policy SESSION CONTROL (alongside sign-in frequency, persistent
-- browser, etc.), not a tenant-wide on/off toggle. So the old endpoint hit a path
-- segment Graph v1.0 doesn't recognise and hard-errored on every scan.
--
-- ── WHAT THE CHECK MEANS NOW ─────────────────────────────────────────────────────
-- It reads the tenant's real Conditional Access policies and reports on the CAE
-- session control across them. Endpoint (v1.0, already covered by Policy.Read.All
-- which is in REQUIRED_MT_SCOPES — no re-consent needed):
--
--     /identity/conditionalAccess/policies?$select=id,displayName,sessionControls
--
-- The mapping produces a real, meaningful shape instead of forcing the old boolean:
--     caePolicyTotal            — M: how many CA policies the tenant has
--     caeConfiguredPolicyCount  — how many carry an explicit CAE session-control setting
--     caeDisabledPolicyCount    — N: how many have CAE EXPLICITLY DISABLED (mode='disabled')
--
-- ── DIRECTION OF THE RULE (the real judgment call — NOT a copy of ca-policy-count) ─
-- This is deliberately NOT the same direction as the ca-policy-count fix, and the
-- difference is the whole point.
--
--   • ca-policy-count is ZERO-IS-BAD: you want CA policies to EXIST; zero is the
--     alarm. (Fixed separately; do not touch it.)
--   • CAE is HIGH-IS-BAD on the DISABLED count. CAE is enabled BY DEFAULT across
--     Entra ID for all users and policies — Microsoft migrated the old tenant-wide
--     opt-in to on-by-default. The per-policy session control exists mainly to
--     DISABLE CAE for a scope (or to add strict-location enforcement). So the
--     actionable security gap is NOT "zero policies have CAE enabled" (that state
--     only occurs when there are zero policies at all — already covered by
--     ca-policy-count) — it is "one or more CA policies have CAE explicitly turned
--     OFF", which strips real-time token revocation from that scope. "Found some =
--     bad."
--
-- Concretely the signal fires when caeDisabledPolicyCount > 0. This is encoded as a
-- profile_key_gt rule on the NAMED mapping field (NOT rule_type='threshold', which
-- reads <checkKey>__itemCount = total policy count and would wrongly fire whenever
-- ANY CA policy exists). Keying off the named field is also status-safe by the same
-- mechanism documented in 2026-07-23-threshold-rule-direction-audit.sql: on an
-- errored/consent-revoked/license-gap run the executor writes extractedProperties={},
-- so caeDisabledPolicyCount is ABSENT (not 0), Number(undefined)=NaN, and
-- profile_key_gt does not false-fire. The check's own severity_rules encode the same
-- direction ({{caeDisabledPolicyCount}} > 0) so the generalized direction audit
-- classifies this rule as CORRECT_AS_IS rather than flagging it for a flip.
--
-- ── THE ONE HONEST CAVEAT (verified against learn.microsoft.com, must not be hidden)
-- The per-policy CAE session control (`sessionControls.continuousAccessEvaluation`,
-- type continuousAccessEvaluationSessionControl, with its `mode` enum: disabled /
-- strictLocation / strictEnforcement) is a BETA-ONLY sub-property. The v1.0
-- conditionalAccessSessionControls resource does NOT include it (v1.0 lists only
-- applicationEnforcedRestrictions, cloudAppSecurity, disableResilienceDefaults,
-- persistentBrowser, signInFrequency). The monitor executor is hard-wired to the
-- v1.0 Graph base (graph.ts graphFetchForTenant unconditionally prefixes
-- https://graph.microsoft.com/v1.0; an absolute /beta URL becomes a malformed
-- doubled URL), so it cannot reach beta today.
--
-- CONSEQUENCE, and why this is still the right thing to ship now:
--   • Under the current v1.0 executor, caeDisabledPolicyCount reads 0 on every
--     tenant regardless of real configuration (the source field is simply absent
--     from v1.0 responses). caePolicyTotal is REAL v1.0 data.
--   • Because the direction is HIGH-IS-BAD via profile_key_gt, the check FAILS SAFE
--     during this gap: 0 disabled -> the signal never fires -> ZERO false alarms.
--     Contrast a "zero-enabled-is-bad" framing, which would false-alarm on 100% of
--     tenants forever while the field is absent. The chosen direction is both the
--     security-correct one AND the one that is safe under the data gap.
--   • The instant real CAE mode data becomes observable — either Microsoft GAs the
--     session control into v1.0, OR the executor is later given beta reachability
--     (make graphFetchForTenant pass an absolute-URL endpoint straight through, then
--     store the endpoint as https://graph.microsoft.com/beta/identity/conditional
--     Access/policies?$select=id,displayName,sessionControls) — this exact rule
--     starts working correctly with NO further rule change.
--   • Net: the check goes from a hard ERROR every scan to a successful read of real
--     CA policy inventory plus a benign, forward-compatible CAE reading. A strict
--     improvement, and honest about what it can and cannot see today.
--
-- Enabling beta reachability is a code change with platform-wide blast radius and a
-- dependency on a Microsoft-"not-for-production" beta surface; it is deliberately
-- left as Shane's call and is NOT done here. No code changes are made by this task:
-- the new shape is produced entirely by the existing mapping transform vocabulary
-- (`count` + `countEquals('...')`), verified in monitor-executor.ts applyMapping.
--
-- ── HOW TO RUN ────────────────────────────────────────────────────────────────────
-- No DATABASE_URL is available to Claude Code sessions in this repo, so the values
-- below are NOT verified against live rows. PART A is read-only and prints the
-- current check + current signal rule(s) so the before/after is on the record.
-- Review PART A first, then run PART B (transactioned, with a RETURNING receipt).


-- ════════════════════════════════════════════════════════════════════════════════
-- PART A — READ-ONLY: current state before anything changes
-- ════════════════════════════════════════════════════════════════════════════════

-- A.1 — the check as it stands today (old endpoint/label/mapping/severity).
SELECT key, label, endpoint, method, properties, mapping, severity_rules, schema_version, status
FROM monitor_checks
WHERE key = 'identity:continuous-access-evaluation';

-- A.2 — every derivation rule for this signal, so a multi-rule group is visible
--       before PART B rewrites the count rule. If A.2 shows anything other than a
--       single count/threshold rule keyed off the check (e.g. an AND/OR group, or a
--       source_key different from the two PART B matches on), STOP and adjust
--       PART B's WHERE to the real row before running it.
SELECT id, signal_key, group_id, rule_type, source_key, compare_value, msp_id, description, updated_at
FROM signal_derivation_rules
WHERE signal_key = 'signal.identity.continuous-access-evaluation'
   OR source_key = 'identity:continuous-access-evaluation'
ORDER BY msp_id NULLS FIRST, id;


-- ════════════════════════════════════════════════════════════════════════════════
-- PART B — CORRECTIONS (transactioned). Review PART A output first.
-- ════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── B.1 — reframe the check: endpoint, label, description, properties, mapping,
--          severity_rules, and a schema_version bump (the output shape changed).
UPDATE monitor_checks
SET
  endpoint = '/identity/conditionalAccess/policies?$select=id,displayName,sessionControls',
  label = 'Conditional Access: Continuous Access Evaluation session control',
  description = 'Reports on Continuous Access Evaluation (CAE) as a Conditional Access session control, '
    || 'not a standalone tenant toggle (which does not exist in Graph v1.0). Reads the tenant''s live CA '
    || 'policies and counts how many have CAE EXPLICITLY DISABLED (sessionControls.continuousAccessEvaluation.mode '
    || '= ''disabled''). CAE is enabled by default across Entra ID, so the actionable risk is a policy that turns '
    || 'it OFF, removing real-time token revocation for that scope. Endpoint is v1.0 and covered by Policy.Read.All. '
    || 'NOTE: the per-policy CAE session control is a beta-only sub-property of sessionControls; under the v1.0 '
    || 'executor the disabled-count reads 0 until CAE is GA in v1.0 or the executor gains beta reachability. The '
    || 'check still returns real CA policy inventory and fails safe (never false-alarms) in the meantime.',
  properties = '["displayName","id"]'::jsonb,
  mapping = '[
    {"sourceField":"id","targetField":"caePolicyTotal","transform":"count"},
    {"sourceField":"sessionControls.continuousAccessEvaluation.mode","targetField":"caeConfiguredPolicyCount","transform":"count"},
    {"sourceField":"sessionControls.continuousAccessEvaluation.mode","targetField":"caeDisabledPolicyCount","transform":"countEquals(''disabled'')"}
  ]'::jsonb,
  severity_rules = '[
    {"expression":"{{caeDisabledPolicyCount}} > 0","severity":"medium","label":"One or more Conditional Access policies have Continuous Access Evaluation explicitly disabled"}
  ]'::jsonb,
  schema_version = schema_version + 1,
  updated_at = now()
WHERE key = 'identity:continuous-access-evaluation'
RETURNING key, label, endpoint, mapping, severity_rules, schema_version;

-- ── B.2 — reframe the derivation rule to the new shape.
--   OLD (expected): rule_type='threshold', source_key='identity:continuous-access-evaluation'
--       — fired on <checkKey>__itemCount, i.e. presence of items from the old
--       (never-found) standalone CAE object.
--   NEW: rule_type='profile_key_gt', source_key='caeDisabledPolicyCount', compare_value='0'
--       — fires when at least one CA policy has CAE explicitly disabled.
--   Matches the platform-owned (msp_id IS NULL) rule for this signal that keys off
--   the check. If PART A.2 showed a different source_key, edit the WHERE to match.
UPDATE signal_derivation_rules
SET
  rule_type = 'profile_key_gt',
  source_key = 'caeDisabledPolicyCount',
  compare_value = '0',
  description = 'Fires when one or more Conditional Access policies have Continuous Access Evaluation '
    || 'explicitly disabled (mode=disabled). High-is-bad on the disabled count; deliberately NOT the '
    || 'zero-is-bad direction of ca-policy-count. Keys off the named mapping field (status-safe: absent '
    || 'on error, so no false-fire). Reads 0 under the v1.0 executor until the beta CAE session control '
    || 'is reachable — see 2026-07-24-cae-check-reframe.sql header.',
  updated_at = now()
WHERE signal_key = 'signal.identity.continuous-access-evaluation'
  AND msp_id IS NULL
  AND source_key = 'identity:continuous-access-evaluation'
RETURNING id, signal_key, rule_type, source_key, compare_value;

-- ── RECEIPT expectations ─────────────────────────────────────────────────────────
-- B.1: exactly 1 row (the check).
-- B.2: 1 row IF the old rule matched the expected (threshold, check-key) shape.
--      If B.2 returns 0 rows, the live rule used a different source_key/shape —
--      DO NOT COMMIT blind. Read PART A.2's output, then run the fallback below with
--      the real rule id, and re-run PART A.2 to confirm, before COMMIT.
--
-- Fallback (fill in <RULE_ID> from PART A.2), if B.2 matched nothing:
-- UPDATE signal_derivation_rules
-- SET rule_type='profile_key_gt', source_key='caeDisabledPolicyCount', compare_value='0', updated_at=now()
-- WHERE id = <RULE_ID>
-- RETURNING id, signal_key, rule_type, source_key, compare_value;
--
-- If the receipts look right:  COMMIT;
-- If anything looks wrong:     ROLLBACK;

COMMIT;
