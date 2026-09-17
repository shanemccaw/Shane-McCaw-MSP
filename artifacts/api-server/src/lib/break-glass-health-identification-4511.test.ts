/**
 * Git #4511 — identity:break-glass-health reported "No enabled break-glass
 * account" (critical) on a tenant with two, because GET /users never returned
 * accountEnabled (no $select) and countTruthy read undefined as 0.
 *
 * Pins the fix's two halves:
 *   1. MappingRule.requireField — a required field absent from EVERY fetched
 *      item leaves its targetField unset and fails the check closed, instead
 *      of writing a fabricated 0.
 *   2. The check's new config, mirroring
 *      lib/db/migrations/manual/2026-09-17-break-glass-health-identification-4511.sql,
 *      against payloads shaped like the live tenant 2080 response.
 */

import { describe, it, expect, vi } from "vitest";

// monitor-executor.ts imports @workspace/db at module scope.
vi.mock("@workspace/db", () => ({
  db: {},
  monitorChecksTable: {},
  monitoringPackagesTable: {},
  monitoringPackageChecksTable: {},
  tenantMonitorProfilesTable: {},
  tenantCheckItemDetailsTable: {},
  tenantsTable: {},
}));

import {
  applyMapping,
  appendQueryParams,
  assertRequiredFieldsPresent,
  classifySeverity,
  MissingRequiredFieldError,
  MISSING_REQUIRED_FIELDS_KEY,
} from "./monitor-executor.ts";
import type { MappingRule, SeverityRule } from "./monitor-executor.ts";

const SELECT = "id,accountEnabled,userPrincipalName,displayName";
const FILTER = "startswith(userPrincipalName,'breakglass') or startswith(displayName,'Emergency Access')";
const PROPERTIES = ["id", "accountEnabled", "userPrincipalName"];
const MAPPING: MappingRule[] = [
  { sourceField: "id", targetField: "breakGlassAccountCount", transform: "count", requireField: true },
  { sourceField: "accountEnabled", targetField: "breakGlassAccountsHealthy", transform: "countTruthy", requireField: true },
];
const RULES: SeverityRule[] = [
  { severity: "critical", expression: "breakGlassAccountCount == 0", label: "No break-glass account found — real risk of total tenant lockout" },
  { severity: "critical", expression: "breakGlassAccountsHealthy == 0", label: "No enabled break-glass account — real risk of total tenant lockout" },
];

function run(items: unknown[]) {
  const extracted = applyMapping(items, MAPPING, PROPERTIES);
  return { extracted, severity: classifySeverity(RULES, extracted) };
}

describe("#4511 identity:break-glass-health config", () => {
  it("builds the $select + encoded $filter URL", () => {
    const url = appendQueryParams("/users", SELECT, FILTER);
    expect(url).toBe(`/users?$select=${SELECT}&$filter=${encodeURIComponent(FILTER)}`);
  });

  it("two enabled break-glass accounts (tenant 2080's real shape) is healthy", () => {
    const { extracted, severity } = run([
      { id: "be87e536", accountEnabled: true, userPrincipalName: "breakglass-admin@mccawsoft.com", displayName: "Emergency Access Admin" },
      { id: "00b799b7", accountEnabled: true, userPrincipalName: "breakglass-admin@shanemccaw.com", displayName: "Emergency Access Admin" },
    ]);
    expect(extracted.breakGlassAccountCount).toBe(2);
    expect(extracted.breakGlassAccountsHealthy).toBe(2);
    expect(extracted[MISSING_REQUIRED_FIELDS_KEY]).toBeUndefined();
    expect(() => assertRequiredFieldsPresent("identity:break-glass-health", extracted)).not.toThrow();
    expect(severity).toBeNull();
  });

  it("no matching account is a real critical, not a missing field", () => {
    const { extracted, severity } = run([]);
    expect(extracted.breakGlassAccountCount).toBe(0);
    expect(extracted.breakGlassAccountsHealthy).toBe(0);
    expect(() => assertRequiredFieldsPresent("identity:break-glass-health", extracted)).not.toThrow();
    expect(severity?.severity).toBe("critical");
    expect(severity?.label).toMatch(/^No break-glass account found/);
  });

  it("accounts that exist but are all disabled are critical", () => {
    const { extracted, severity } = run([
      { id: "a", accountEnabled: false, userPrincipalName: "breakglass-admin@x.com" },
      { id: "b", accountEnabled: false, userPrincipalName: "breakglass-admin@y.com" },
    ]);
    expect(extracted.breakGlassAccountCount).toBe(2);
    expect(extracted.breakGlassAccountsHealthy).toBe(0);
    expect(severity?.label).toMatch(/^No enabled break-glass account/);
  });

  it("fails closed when accountEnabled is absent from every item (the original defect)", () => {
    const { extracted, severity } = run([
      { id: "a", userPrincipalName: "breakglass-admin@x.com" },
      { id: "b", userPrincipalName: "breakglass-admin@y.com" },
    ]);
    expect(extracted).not.toHaveProperty("breakGlassAccountsHealthy");
    expect(extracted[MISSING_REQUIRED_FIELDS_KEY]).toEqual(["accountEnabled"]);
    // Neither the fabricated-0 critical nor a clean result may come out of this.
    expect(severity?.label ?? "").not.toMatch(/No enabled break-glass account/);
    expect(() => assertRequiredFieldsPresent("identity:break-glass-health", extracted))
      .toThrow(MissingRequiredFieldError);
    expect(() => assertRequiredFieldsPresent("identity:break-glass-health", extracted))
      .toThrow(/"accountEnabled" absent from all 2 fetched item/);
  });
});

describe("#4511 MappingRule.requireField", () => {
  it("counts an explicit null as present (Graph's answer for a selected empty property)", () => {
    const extracted = applyMapping(
      [{ accountEnabled: null }, { accountEnabled: null }],
      [{ sourceField: "accountEnabled", targetField: "n", transform: "countTruthy", requireField: true }],
      [],
    );
    expect(extracted.n).toBe(0);
    expect(extracted[MISSING_REQUIRED_FIELDS_KEY]).toBeUndefined();
  });

  it("one item carrying the field is enough", () => {
    const extracted = applyMapping(
      [{ accountEnabled: true }, {}],
      [{ sourceField: "accountEnabled", targetField: "n", transform: "countTruthy", requireField: true }],
      [],
    );
    expect(extracted.n).toBe(1);
    expect(extracted[MISSING_REQUIRED_FIELDS_KEY]).toBeUndefined();
  });

  it("rules without requireField keep their existing behaviour", () => {
    const extracted = applyMapping(
      [{ id: "a" }, { id: "b" }],
      [{ sourceField: "accountEnabled", targetField: "n", transform: "countTruthy" }],
      [],
    );
    expect(extracted.n).toBe(0);
    expect(extracted[MISSING_REQUIRED_FIELDS_KEY]).toBeUndefined();
  });
});
