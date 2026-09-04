-- Git #2007 — config_resources row for MSFT_EXOAtpProtectionPolicyRule had its DSC
-- resource identity fields (resource_key, display_name, m365dsc_resource) set to the
-- literal placeholder string "ResourceName" instead of the real resource name
-- "EXOAtpProtectionPolicyRule".
--
-- Root cause (fixed in scripts/config-state/parse-m365dsc.mjs's
-- extractM365DscResources): the extractor trusted settings.json's own `resourceName`
-- field unconditionally. For this one resource that field held the literal,
-- un-templated placeholder text "ResourceName" rather than a real value. The field is
-- now derived from the resource's own directory name (DscResources/MSFT_<Name>/,
-- Microsoft365DSC's structural, authoritative identity for the resource) instead, with
-- settings.json's value only used as a fallback / cross-check.
--
-- Confirmed via `SELECT split_part(resource_key,':',2) ... WHERE resource_key LIKE
-- 'm365dsc:%'` against all 481 m365dsc-origin rows that this was the ONLY row with
-- this class of placeholder pollution — a single-row data fix, not a bulk repair.
-- workload/surface are corrected alongside the name because they are derived from the
-- resource name by prefix match (workloadForDscResource); every other column
-- (properties, permissions, verification_status, notes) was already correct and is
-- untouched.

BEGIN;

UPDATE config_resources
SET
  resource_key      = 'm365dsc:EXOAtpProtectionPolicyRule',
  display_name      = 'EXOAtpProtectionPolicyRule',
  m365dsc_resource  = 'EXOAtpProtectionPolicyRule',
  workload          = 'ExchangeOnline',
  surface           = 'exchange',
  updated_at        = now()
WHERE resource_key = 'm365dsc:ResourceName';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-04-fix-exoatpprotectionpolicyrule-resource-name-2007.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
