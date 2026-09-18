/**
 * ca-report-only-suffix-rename-4549.test.ts — Git #4549
 *
 * Five of the six CA baseline create templates hard-coded a displayName ending in
 * " (report-only)" that never got updated when a policy's real state changed
 * (immediate-mode create, or the #4522 promotion workflow). Covers:
 *   - stripCaReportOnlySuffix, the rename helper promoteCaPolicy uses
 *   - the #4549 migration's real, applied effect: each affected template's create
 *     body no longer carries the suffix, action.set-ca-policy-state's body_template
 *     PATCHes displayName alongside state, and the existence-lookup's selectMatch
 *     now recognizes either the legacy suffixed name or the new clean one
 *
 * The migration SQL is read out of the real file, not copied, so this suite tests
 * exactly what the database holds (same discipline as ca-policy-existence-lookup-4531.test.ts).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { stripCaReportOnlySuffix } from "./ca-enforcement-mode.ts";

describe("stripCaReportOnlySuffix", () => {
  it("strips a trailing (report-only) suffix, case-insensitively", () => {
    expect(stripCaReportOnlySuffix("Baseline: Require MFA for All Users (report-only)")).toBe(
      "Baseline: Require MFA for All Users",
    );
    expect(stripCaReportOnlySuffix("Baseline: Require MFA for All Users (REPORT-ONLY)")).toBe(
      "Baseline: Require MFA for All Users",
    );
  });

  it("leaves a name with no suffix (already renamed, or never had one) unchanged", () => {
    expect(stripCaReportOnlySuffix("Baseline: Require MFA for All Users")).toBe(
      "Baseline: Require MFA for All Users",
    );
    expect(stripCaReportOnlySuffix("Quick-Start Baseline: Require MFA for All Users")).toBe(
      "Quick-Start Baseline: Require MFA for All Users",
    );
  });

  it("only strips a trailing suffix, not one appearing mid-name", () => {
    expect(stripCaReportOnlySuffix("(report-only) is not a real policy name")).toBe(
      "(report-only) is not a real policy name",
    );
  });
});

const MIGRATION = fileURLToPath(
  new URL("../../../../lib/db/migrations/manual/2026-09-17-ca-report-only-suffix-rename-4549.sql", import.meta.url),
);
const migrationSql = readFileSync(MIGRATION, "utf8");

const AFFECTED_TEMPLATE_IDS = [
  "action.create-ca-legacy-auth-block-policy",
  "action.create-ca-mfa-all-users-policy",
  "action.create-ca-signin-risk-policy",
  "action.create-ca-user-risk-policy",
  "action.create-ca-guest-mfa-policy",
];

const CLEAN_NAMES: Record<string, string> = {
  "action.create-ca-legacy-auth-block-policy": "Baseline: Block Legacy Authentication",
  "action.create-ca-mfa-all-users-policy": "Baseline: Require MFA for All Users",
  "action.create-ca-signin-risk-policy": "Baseline: Require MFA on Sign-In Risk",
  "action.create-ca-user-risk-policy": "Baseline: Secure Password Change on User Risk",
  "action.create-ca-guest-mfa-policy": "Baseline: Require MFA for Guests",
};

describe("#4549 migration — strips the suffix, widens the lookup, PATCHes displayName", () => {
  it("touches exactly the five suffixed create templates, never quickstart's own template id in an IN() list", () => {
    for (const id of AFFECTED_TEMPLATE_IDS) expect(migrationSql).toContain(id);
    for (const block of migrationSql.split(/WHERE (?:template_id|t\.template_id) IN \(/).slice(1)) {
      expect(block.slice(0, block.indexOf(")"))).not.toContain("quickstart-v1.create-ca-baseline-policy");
    }
  });

  it("rewrites action.set-ca-policy-state's body_template to PATCH displayName alongside state", () => {
    expect(migrationSql).toContain('body_template || \'{"displayName": "{{displayName}}"}\'::jsonb');
    expect(migrationSql).toContain("'action.set-ca-policy-state'");
  });

  it("widens each template's skip-write selectMatch.displayName to an in: match", () => {
    expect(migrationSql).toContain("'in:' ||");
    expect(migrationSql).toContain("selectMatch,displayName");
  });

  it("every affected clean name is a real, non-suffixed prefix of its old suffixed form", () => {
    for (const [id, clean] of Object.entries(CLEAN_NAMES)) {
      expect(AFFECTED_TEMPLATE_IDS).toContain(id);
      expect(clean.endsWith("(report-only)")).toBe(false);
    }
  });
});
