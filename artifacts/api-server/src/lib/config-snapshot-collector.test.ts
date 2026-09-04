/**
 * Git #2115 — classifySnapshotFailure() sharpened against real observed evidence.
 *
 * #1795's own constraint (restated in classifySnapshotFailure's header) is that
 * every branch keys off something the platform has ACTUALLY OBSERVED — never a
 * guessed pattern. Every literal string below is copied verbatim out of
 * `tenant_config_snapshot_resource_status.error_message` on the two real
 * snapshots this issue is grounded in: row 8 (#1962, smaller/earlier) and row 10
 * (#2115, the largest real snapshot — 778 failures, 304 of them `unknown_error`
 * before this fix). See build-journal/2115.md for the queries that pulled them.
 */
import { describe, expect, it } from "vitest";
import { classifySnapshotFailure, selectReadCmdlet } from "./config-snapshot-collector";
import { LicenseGapError } from "./graph";

describe("classifySnapshotFailure — #2115 real-literal branches", () => {
  it("classifies 'not supported for AAD accounts' as not_applicable_to_account_type (#1962 cause 1)", () => {
    const body =
      '{"error":{"code":"BadRequest","message":"This API is not supported for AAD accounts (no addressUrl for Microsoft.Exchange.Rbac,False).","innerError":{}}}';
    const { reason } = classifySnapshotFailure(new Error("boom"), 400, body);
    expect(reason).toBe("not_applicable_to_account_type");
  });

  it("classifies 'Request not applicable to target tenant' as not_applicable_to_account_type (real #2115 literal, 73 rows on snapshot 10)", () => {
    const body =
      '{"error":{"code":"BadRequest","message":"Request not applicable to target tenant.","innerError":{}}}';
    const { reason } = classifySnapshotFailure(new Error("boom"), 400, body);
    expect(reason).toBe("not_applicable_to_account_type");
  });

  it("classifies AADSTS500011 (resource principal not found in tenant) as not_applicable_to_account_type (#1962 cause 2)", () => {
    const body =
      '{"error":{"code":"AuthenticationError","message":"AADSTS500011: The resource principal named https://nam06c.dataservice.protection.outlook.com/ was not found in the tenant named c4c814d4-3afe-441e-9145-62461d0a4fd3."}}';
    const { reason } = classifySnapshotFailure(new Error("boom"), 400, body);
    expect(reason).toBe("not_applicable_to_account_type");
  });

  it("classifies Graph's nested apiNotFound as endpoint_not_found (#1962 cause 3)", () => {
    const body =
      '{"error":{"code":"invalidRequest","message":"API not found","innerError":{"code":"apiNotFound"}}}';
    const { reason } = classifySnapshotFailure(new Error("boom"), 400, body);
    expect(reason).toBe("endpoint_not_found");
  });

  it("classifies the OData 'segment not found' 400 as endpoint_not_found (real #2115 literal, dominant 'other' 400 bucket on snapshot 10)", () => {
    const body =
      "{\"error\":{\"code\":\"BadRequest\",\"message\":\"Resource not found for the segment 'continuousAccessEvaluationPolicy'.\",\"innerError\":{}}}";
    const { reason } = classifySnapshotFailure(new Error("boom"), 400, body);
    expect(reason).toBe("endpoint_not_found");
  });

  it("classifies a plain 404 as endpoint_not_found even with an empty body (real #2115 literal, 79 rows on snapshot 10)", () => {
    const body = '{"error":{"code":"UnknownError","message":""}}';
    const { reason } = classifySnapshotFailure(new Error("boom"), 404, body);
    expect(reason).toBe("endpoint_not_found");
  });

  it("classifies a 404 with no JSON body at all as endpoint_not_found (an upstream 404 HTML page, real #2115 literal)", () => {
    const body = "<html><head><title>404 Not Found</title></head><body>nginx</body></html>";
    const { reason } = classifySnapshotFailure(new Error("boom"), 404, body);
    expect(reason).toBe("endpoint_not_found");
  });

  it("classifies Graph's application-only-context 412 as not_supported_app_only", () => {
    const body =
      '{"error":{"code":"PreconditionFailed","message":"Requested API is not supported in application-only context"}}';
    const { reason } = classifySnapshotFailure(new Error("boom"), 412, body);
    expect(reason).toBe("not_supported_app_only");
  });

  it("still lands genuinely unclassifiable failures on unknown_error, not a guess", () => {
    const { reason } = classifySnapshotFailure(new Error("something entirely novel"), 418, "I'm a teapot");
    expect(reason).toBe("unknown_error");
  });

  it("existing 403/401/429/5xx branches are unchanged by the new literal checks", () => {
    expect(classifySnapshotFailure(new Error("x"), 403, '{"error":{"code":"accessDenied"}}').reason).toBe(
      "permission_denied",
    );
    expect(classifySnapshotFailure(new Error("x"), 401, "{}").reason).toBe("permission_denied");
    expect(classifySnapshotFailure(new Error("x"), 429, "{}").reason).toBe("transport_error");
    expect(classifySnapshotFailure(new Error("x"), 503, "{}").reason).toBe("transport_error");
  });

  it("LicenseGapError still classifies as license_required regardless of the new branches", () => {
    const err = new LicenseGapError(
      "tenant-1",
      "Microsoft Entra ID Premium (P1/P2)",
      "Authentication_RequestFromNonPremiumTenantOrB2CTenant",
      "{...}",
      400,
    );
    const { reason } = classifySnapshotFailure(err, err.httpStatus, err.rawBody);
    expect(reason).toBe("license_required");
  });

  it("LicenseGapError now carries real wire evidence (Git #2115 capture-gap fix) instead of null/null", () => {
    const err = new LicenseGapError(
      "tenant-1",
      "Microsoft Entra ID Premium (P1/P2)",
      "Authentication_RequestFromNonPremiumTenantOrB2CTenant",
      '{"error":{"code":"AuthenticationError"}}',
      400,
    );
    // This is exactly the extraction config-snapshot-collector.ts's catch block
    // now performs for a LicenseGapError — asserted directly here so a future
    // regression back to `status = null` on this error type is caught.
    expect(err.httpStatus).toBe(400);
    expect(err.rawBody).toBe('{"error":{"code":"AuthenticationError"}}');
  });

  it("a LicenseGapError built without an httpStatus (pre-#2115 call shape) still defaults safely to null", () => {
    const err = new LicenseGapError("tenant-1", "feature", "code", "body");
    expect(err.httpStatus).toBeNull();
  });
});

/**
 * Git #1961 — selectReadCmdlet() picks the cmdlet that reads THIS resource.
 *
 * Every `read_cmdlets` array below is copied verbatim out of the real
 * `config_snapshot_resource_types` rows (local Postgres, read 2026-09-04),
 * including their real ORDER and their real case variants — the order is what
 * makes the naive "first mapped wins" pick the wrong object type, so a
 * hand-tidied array would test nothing.
 */
describe("selectReadCmdlet — #1961 real registry read_cmdlets orders", () => {
  it("prefers the Rule cmdlet over the Policy cmdlet listed ahead of it (the pre-existing EXOHostedContentFilterRule miscollection)", () => {
    expect(
      selectReadCmdlet("m365dsc:EXOHostedContentFilterRule", [
        "Get-HostedContentFilterPolicy",
        "Get-HostedContentFilterRule",
      ]),
    ).toBe("Get-HostedContentFilterRule");
  });

  it("prefers Get-LabelPolicy over the Get-Label listed first for SCLabelPolicy", () => {
    expect(selectReadCmdlet("m365dsc:SCLabelPolicy", ["Get-Label", "Get-LabelPolicy"])).toBe(
      "Get-LabelPolicy",
    );
  });

  it("prefers the longer, more specific noun for SCFilePlanPropertySubCategory", () => {
    expect(
      selectReadCmdlet("m365dsc:SCFilePlanPropertySubCategory", [
        "Get-FilePlanPropertyCategory",
        "Get-FilePlanPropertySubCategory",
      ]),
    ).toBe("Get-FilePlanPropertySubCategory");
  });

  it("keeps the first mapped cmdlet when no noun matches the resource name (EXODnssecForVerifiedDomain really is read via Get-AcceptedDomain)", () => {
    expect(
      selectReadCmdlet("m365dsc:EXODnssecForVerifiedDomain", ["Get-AcceptedDomain"]),
    ).toBe("Get-AcceptedDomain");
  });

  it("keeps Get-AuthenticationPolicy for EXOAuthenticationPolicyAssignment — the noun is not a suffix, and the registry's own choice is correct", () => {
    expect(
      selectReadCmdlet("m365dsc:EXOAuthenticationPolicyAssignment", ["Get-AuthenticationPolicy"]),
    ).toBe("Get-AuthenticationPolicy");
  });

  it("matches case-insensitively, so a real Get-DLPCompliancePolicy/Get-DlpCompliancePolicy variant pair resolves", () => {
    expect(
      selectReadCmdlet("m365dsc:SCDLPCompliancePolicy", [
        "Get-DLPCompliancePolicy",
        "Get-DlpCompliancePolicy",
      ]),
    ).toBe("Get-DLPCompliancePolicy");
  });

  it("returns undefined when the resource names no cmdlet this container can invoke", () => {
    expect(selectReadCmdlet("m365dsc:EXOPlace", ["Get-Place"])).toBeUndefined();
  });
});
