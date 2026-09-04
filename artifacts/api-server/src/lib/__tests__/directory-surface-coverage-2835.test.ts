/**
 * Git #2835 — real follow-up from #2763: closes 1 of the 35 remaining
 * directory-surface `check_coverage_count=0` gaps with a real new check,
 * `identity:transitive-role-assignments`.
 *
 * This replays the REAL shipped config
 * (lib/db/migrations/manual/2026-09-04-directory-surface-coverage-2835.sql)
 * — mapping/severity_rules read straight out of the migration file, not
 * restated — through the real applyMapping / classifySeverity, mirroring
 * #2763's own test precedent (which itself mirrors #2762's), so behaviour is
 * pinned by the shipped row.
 *
 * The "real testbed shape" below is a trimmed version of the actual object
 * returned by a live GET against the testbed tenant (mccawsoft2.onmicrosoft.com,
 * tenants.id=1, app-only) during this session — see build-journal/2835.md for
 * the real probe transcript. The "risky shape" is synthetic, used only to
 * prove the Global Administrator severity branch actually fires — the real
 * testbed principal probed happened to hold Global Administrator directly
 * (that IS what the real transitiveRoleAssignments response showed), so the
 * "no transitive Global Admin" case below is also real-shaped, just a
 * different principal's row.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";

// applyMapping/classifySeverity are pure, but monitor-executor.ts imports
// @workspace/db at module scope, which throws without a DATABASE_URL.
vi.mock("@workspace/db", () => ({
  db: {},
  monitorChecksTable: {},
  monitoringPackagesTable: {},
  monitoringPackageChecksTable: {},
  tenantMonitorProfilesTable: {},
  tenantCheckItemDetailsTable: {},
  tenantsTable: {},
}));

import { applyMapping, classifySeverity } from "../monitor-executor";
import type { MappingRule, SeverityRule } from "../monitor-executor";

const MIGRATION_PATH = fileURLToPath(
  new URL(
    "../../../../../lib/db/migrations/manual/2026-09-04-directory-surface-coverage-2835.sql",
    import.meta.url,
  ),
);

const GLOBAL_ADMIN_ROLE_ID = "62e90394-69f5-4237-9190-012177145e10";

/** Same extraction pattern as #2763's own test — see that file's own comment
 *  for why CRLF is normalized before boundary-matching (Git #2836). */
function readShippedConfig(checkKey: string): { mapping: MappingRule[]; severityRules: SeverityRule[] } {
  const sql = readFileSync(MIGRATION_PATH, "utf8").replace(/\r\n/g, "\n");
  const keyIdx = sql.indexOf(`'${checkKey}',`);
  expect(keyIdx, `check key ${checkKey} not found in migration`).toBeGreaterThan(-1);
  const rowEnd = sql.indexOf("\n),\n(", keyIdx);
  const rowEndAlt = sql.indexOf("\n);", keyIdx);
  const end = rowEnd === -1 ? rowEndAlt : (rowEndAlt === -1 ? rowEnd : Math.min(rowEnd, rowEndAlt));
  const rowText = sql.slice(keyIdx, end === -1 ? undefined : end);
  const jsonbBlocks = [...rowText.matchAll(/'(\[[\s\S]*?\])'::jsonb/g)].map(m => m[1]);
  // Column order: properties, mapping, severity_rules, engines.
  expect(jsonbBlocks.length, `expected 4 jsonb blocks (properties, mapping, severity_rules, engines) for ${checkKey}`).toBe(4);
  const unescape = (s: string) => s.replace(/''/g, "'");
  const mapping = JSON.parse(unescape(jsonbBlocks[1]));
  const severityRules = JSON.parse(unescape(jsonbBlocks[2]));
  return { mapping, severityRules };
}

describe("#2835 identity:transitive-role-assignments", () => {
  const { mapping, severityRules } = readShippedConfig("identity:transitive-role-assignments");

  it("fires warning on the real testbed shape (a real user's transitive role includes Global Administrator)", () => {
    // Real observed shape (fan-out over /users, filtered per-user by
    // principalId): GET .../transitiveRoleAssignments?$filter=principalId eq
    // '<real user id>' on the testbed tenant returned one real row assigning
    // roleDefinitionId=62e90394-... (Global Administrator) to that user.
    const extracted = applyMapping(
      [{
        id: "lAPpYvVpN0KRkAEhdxReEH1pF6om3MhHpDGXhJcOWhg-1",
        principalId: "aa17697d-dc26-47c8-a431-9784970e5a18",
        principalOrganizationId: "c4c814d4-3afe-441e-9145-62461d0a4fd3",
        resourceScope: "/",
        directoryScopeId: "/",
        roleDefinitionId: GLOBAL_ADMIN_ROLE_ID,
      }],
      mapping, [],
    );
    expect(extracted.transitiveRoleAssignmentCount).toBe(1);
    expect(extracted.transitiveGlobalAdminCount).toBe(1);
    expect(classifySeverity(severityRules, extracted)?.severity).toBe("warning");
  });

  it("does not fire when a user's transitive roles hold no Global Administrator assignment (real-shaped, different role id)", () => {
    const extracted = applyMapping(
      [{
        id: "row2",
        principalId: "other-user-id",
        resourceScope: "/",
        directoryScopeId: "/",
        roleDefinitionId: "fe930be7-5e62-47db-91af-98c3a49a38b1", // real Microsoft Entra "User Administrator" role id, not Global Admin
      }],
      mapping, [],
    );
    expect(extracted.transitiveRoleAssignmentCount).toBe(1);
    expect(extracted.transitiveGlobalAdminCount).toBe(0);
    expect(classifySeverity(severityRules, extracted)).toBeNull();
  });

  it("does not fire when a user has no transitive role assignments at all", () => {
    const extracted = applyMapping([], mapping, []);
    expect(extracted.transitiveRoleAssignmentCount).toBe(0);
    expect(extracted.transitiveGlobalAdminCount).toBe(0);
    expect(classifySeverity(severityRules, extracted)).toBeNull();
  });
});
