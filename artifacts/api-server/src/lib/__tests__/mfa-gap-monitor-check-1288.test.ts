/**
 * #1288 — identity:privileged-mfa-gap monitor check.
 *
 * Verifies the check's stored `mapping`/`severity_rules` (the same jsonb this
 * repo hand-writes into lib/db/migrations/manual/2026-08-25-mfa-gap-monitor-
 * check-1288.sql) actually produce the right counts and severity against a
 * representative /reports/authenticationMethods/userRegistrationDetails
 * response, exercising the SAME applyMapping/classifySeverity path
 * monitor-executor.ts runs in production — not a reimplementation of it.
 */
import { describe, it, expect } from "vitest";
import { applyMapping, classifySeverity } from "../monitor-executor";
import type { MappingRule, SeverityRule } from "../monitor-executor";

const MAPPING: MappingRule[] = [
  { sourceField: "value", targetField: "privilegedMfaGapCount", transform: "countWhere('{{isAdmin}} == true && {{isMfaRegistered}} == false')" },
  { sourceField: "value", targetField: "memberMfaGapCount", transform: `countWhere('{{isMfaRegistered}} == false && {{userType}} == "Member"')` },
];

const SEVERITY_RULES: SeverityRule[] = [
  { severity: "critical", expression: "privilegedMfaGapCount > 0", label: "{{privilegedMfaGapCount}} privileged admin account(s) do not have MFA registered" },
  { severity: "warning", expression: "memberMfaGapCount > 0", label: "{{memberMfaGapCount}} user account(s) do not have MFA registered" },
];

const REGISTRATION_DETAILS = [
  { id: "u1", userPrincipalName: "admin@contoso.com", isAdmin: true, isMfaRegistered: false, userType: "Member" },
  { id: "u2", userPrincipalName: "alice@contoso.com", isAdmin: false, isMfaRegistered: false, userType: "Member" },
  { id: "u3", userPrincipalName: "bob@contoso.com", isAdmin: false, isMfaRegistered: true, userType: "Member" },
  { id: "u4", userPrincipalName: "guest@partner.com", isAdmin: false, isMfaRegistered: false, userType: "Guest" },
];

describe("identity:privileged-mfa-gap monitor check", () => {
  it("counts privileged MFA gaps and total member MFA gaps, excluding guests from the member count", () => {
    // memberMfaGapCount is every unregistered Member — admin (u1) and non-admin
    // (alice) alike — since an admin account IS also a member account; it is not
    // privilegedMfaGapCount's complement. The guest (u4) is excluded from both:
    // guest MFA coverage is identity:guest-mfa-enforcement's job, not this check's.
    const result = applyMapping(REGISTRATION_DETAILS, MAPPING, []);
    expect(result.privilegedMfaGapCount).toBe(1);
    expect(result.memberMfaGapCount).toBe(2);
  });

  it("classifies critical when a privileged account lacks MFA", () => {
    const result = applyMapping(REGISTRATION_DETAILS, MAPPING, []);
    const match = classifySeverity(SEVERITY_RULES, result);
    expect(match?.severity).toBe("critical");
    expect(match?.label).toBe("1 privileged admin account(s) do not have MFA registered");
  });

  it("falls back to warning when only ordinary members lack MFA", () => {
    const noAdminGap = [
      { id: "u2", isAdmin: false, isMfaRegistered: false, userType: "Member" },
      { id: "u3", isAdmin: true, isMfaRegistered: true, userType: "Member" },
    ];
    const result = applyMapping(noAdminGap, MAPPING, []);
    expect(result.privilegedMfaGapCount).toBe(0);
    expect(result.memberMfaGapCount).toBe(1);
    const match = classifySeverity(SEVERITY_RULES, result);
    expect(match?.severity).toBe("warning");
  });

  it("reports no finding when every account has MFA registered", () => {
    const allGood = [
      { id: "u1", isAdmin: true, isMfaRegistered: true, userType: "Member" },
      { id: "u2", isAdmin: false, isMfaRegistered: true, userType: "Member" },
    ];
    const result = applyMapping(allGood, MAPPING, []);
    expect(classifySeverity(SEVERITY_RULES, result)).toBeNull();
  });
});
