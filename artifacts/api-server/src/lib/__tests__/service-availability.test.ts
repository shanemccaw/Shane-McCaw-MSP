/**
 * service-availability.test.ts — Git #1847.
 *
 * The pure half of the module: path→service mapping, the three documented wire
 * signatures, and the combined verdict that decides WHICH of the five service states
 * a refusal actually is.
 *
 * The combination is the point. A tenant that never licensed Intune and a tenant that
 * licensed it and never enrolled produce IDENTICAL wire signatures, so the signature
 * alone cannot separate them — only the tenant's own /subscribedSkus entitlement can.
 * Reporting the wrong one is the platform being confidently wrong about someone's
 * tenant, which is the failure this issue exists to prevent.
 *
 * The DB-backed functions (`readIntuneEntitlement`, `recordTenantServiceState`) are
 * exercised against the real database by the live verification recorded on the issue,
 * not mocked here.
 */

import { describe, it, expect, vi } from "vitest";

// The module under test imports the real db client purely for its two persistence
// helpers; importing it for real would demand a DATABASE_URL this pure-logic suite
// has no use for. Only the shapes the module names are stubbed.
vi.mock("@workspace/db", () => ({
  db: {},
  tenantServiceAvailabilityTable: {},
  tenantCheckItemDetailsTable: {},
  TENANT_SERVICE_KEYS: ["intune"],
}));

import {
  serviceKeyForGraphPath,
  matchIntuneWireSignature,
  resolveIntuneServiceState,
  type IntuneEntitlement,
} from "../service-availability";

// The real bodies from the issue's recorded live evidence, truncated to the parts
// the signatures actually key off.
const DEVICE_FE_401 =
  '{"error":{"code":"UnknownError","message":"{\\"ErrorCode\\":\\"Forbidden\\",\\"Message\\":\\"{\\\\r\\\\n \\\\\\"_version\\\\\\": 3, Url: https://proxy.msua01.manage.microsoft.com/DeviceFE/StatelessDeviceFEService/deviceManagement/manage';
const AUTOPILOT_400 =
  '{"error":{"code":"BadRequest","message":"Resource not found for the segment \'windowsAutopilotDeploymentProfiles\'."}}';
const IIS_503 =
  '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN">\r\n<HTML><HEAD><TITLE>Service Unavailable</TITLE></HEAD></HTML>';
// Real body from Git #1963's live evidence (snapshot 30433ced-b0e5-4161-8270-97bf360ff931,
// row 8, resource graph:beta:/deviceManagement/androidManagedStoreAccountEnterpriseSettings) —
// same "_version": 3 + Forbidden envelope as DEVICE_FE_401, but proxied through
// AndroidSync/StatelessAndroidSyncFEService instead of DeviceFE/StatelessDeviceFEService.
const FORBIDDEN_ENVELOPE_401 =
  '{"error":{"code":"UnknownError","message":"{\\"ErrorCode\\":\\"Forbidden\\",\\"Message\\":\\"{\\r\\n  \\"_version\\": 3,\\r\\n  \\"Message\\": \\"An error has occurred - Operation ID (for customer support): 00000000-0000-0000-0000-000000000000 - Activity ID: 55e53ed1-be1f-48e9-9282-39d88e6fcb54 - Url: https://proxy.msua01.manage.microsoft.com/AndroidSync/StatelessAndroidSyncFEService/deviceManagement/androidManagedStoreAccountEnterpriseSettings?api-version=5026-05-21';
// Real body from Git #2843's live evidence (same snapshot, row 8) — the 2 remaining
// unmatched rows on graph:beta:/deviceManagement/autopilotEvents and
// graph:v1.0:/deviceManagement/troubleshootingEvents. Same "_version": 3 envelope as
// FORBIDDEN_ENVELOPE_401, but WITHOUT an "ErrorCode" field — just a bare "Message".
const BARE_MESSAGE_401 =
  '{"error":{"code":"UnknownError","message":"{\\"Message\\":\\"{\\r\\n  \\"_version\\": 3,\\r\\n  \\"Message\\": \\"An error has occurred - Operation ID (for customer support): 00000000-0000-0000-0000-000000000000 - Activity ID: 935b8c4f-98a0-4f24-9c10-338d75f22ac5 - Url: https://proxy.msua01.manage.microsoft.com/DeviceEnrollmentFE/StatelessDeviceEnrollmentFEService/deviceManagement/autopilotEvents?api-version=5026-05-21';

function entitlement(partial: Partial<IntuneEntitlement>): IntuneEntitlement {
  return {
    verdict: "unknown",
    plans: [],
    skuPartNumbers: [],
    sourceCheckKey: null,
    collectedAt: null,
    ...partial,
  };
}

describe("serviceKeyForGraphPath", () => {
  it("maps Intune's own roots, including the bare root itself", () => {
    expect(serviceKeyForGraphPath("/deviceManagement")).toBe("intune");
    expect(serviceKeyForGraphPath("/deviceManagement/managedDevices")).toBe("intune");
    expect(serviceKeyForGraphPath("/deviceAppManagement/managedAppPolicies")).toBe("intune");
    expect(serviceKeyForGraphPath("/deviceManagement?$top=1")).toBe("intune");
  });

  it("does not claim unrelated paths", () => {
    expect(serviceKeyForGraphPath("/users")).toBeNull();
    expect(serviceKeyForGraphPath("/security/alerts_v2")).toBeNull();
    expect(serviceKeyForGraphPath(null)).toBeNull();
    // Prefix-adjacent but a genuinely different path — must not be swallowed.
    expect(serviceKeyForGraphPath("/deviceManagementOther")).toBeNull();
  });
});

describe("matchIntuneWireSignature", () => {
  it("recognises the five documented signatures on Intune paths", () => {
    expect(matchIntuneWireSignature("/deviceManagement/managedDevices", 401, DEVICE_FE_401))
      .toBe("intune-legacy-devicefe-401");
    expect(matchIntuneWireSignature("/deviceManagement/windowsAutopilotDeploymentProfiles", 400, AUTOPILOT_400))
      .toBe("intune-segment-unresolved-400");
    expect(matchIntuneWireSignature("/deviceAppManagement/managedAppPolicies", 503, IIS_503))
      .toBe("intune-backend-iis-503");
    // Git #1963: same envelope as DEVICE_FE_401, different Intune backend proxy —
    // was falling through unmatched to permission_denied.
    expect(
      matchIntuneWireSignature(
        "/deviceManagement/androidManagedStoreAccountEnterpriseSettings",
        401,
        FORBIDDEN_ENVELOPE_401,
      ),
    ).toBe("intune-forbidden-envelope-401");
    // Git #2843: same _version envelope, but no ErrorCode field at all — was
    // falling through unmatched to permission_denied on autopilotEvents/
    // troubleshootingEvents.
    expect(
      matchIntuneWireSignature("/deviceManagement/autopilotEvents", 401, BARE_MESSAGE_401),
    ).toBe("intune-bare-message-401");
  });

  it("does not mismatch the ErrorCode envelope as the bare-message one", () => {
    // FORBIDDEN_ENVELOPE_401 carries "ErrorCode" — must keep matching its own
    // signature, not fall through to intune-bare-message-401.
    expect(
      matchIntuneWireSignature(
        "/deviceManagement/androidManagedStoreAccountEnterpriseSettings",
        401,
        FORBIDDEN_ENVELOPE_401,
      ),
    ).toBe("intune-forbidden-envelope-401");
  });

  it("is gated on the path, so a genuine outage elsewhere is never relabelled as no-MDM", () => {
    // The IIS 503 page carries no Intune-specific text of its own. Matching it
    // endpoint-agnostically would silently swallow a real outage on any workload.
    expect(matchIntuneWireSignature("/users", 503, IIS_503)).toBeNull();
    expect(matchIntuneWireSignature("/security/alerts_v2", 401, DEVICE_FE_401)).toBeNull();
  });

  it("does not match an ordinary Graph permission denial on an Intune path", () => {
    const cleanDenial =
      '{"error":{"code":"authorization_error","message":"The token does not have the required permissions."}}';
    expect(matchIntuneWireSignature("/deviceManagement/managedDevices", 403, cleanDenial)).toBeNull();
  });
});

describe("resolveIntuneServiceState", () => {
  it("reports not_licensed when the tenant has no Intune service plan at all", () => {
    const v = resolveIntuneServiceState(
      "intune-backend-iis-503",
      entitlement({ verdict: "not_licensed", skuPartNumbers: ["ENTERPRISEPACK", "FLOW_FREE"] }),
    );
    expect(v.state).toBe("not_licensed");
    expect(v.evidenceBasis).toBe("combined");
    expect(v.reason).toContain("not licensed");
  });

  it("reports not_licensed — NOT not_configured — when the only Intune-family plan is MDM for Office 365", () => {
    // The real testbed shape: Office 365 E3 (ENTERPRISEPACK) carries INTUNE_O365,
    // which is basic Mobile Device Management for Office 365, not Intune. Reading
    // that as "Intune is licensed, just not set up" would tell the customer to go
    // and configure a product they do not own.
    const v = resolveIntuneServiceState(
      "intune-legacy-devicefe-401",
      entitlement({
        verdict: "basic_mdm_only",
        skuPartNumbers: ["ENTERPRISEPACK"],
        plans: [
          { skuPartNumber: "ENTERPRISEPACK", servicePlanName: "INTUNE_O365", provisioningStatus: "PendingActivation" },
        ],
      }),
    );
    expect(v.state).toBe("not_licensed");
    expect(v.reason).toContain("INTUNE_O365");
    expect(v.reason).toContain("Mobile Device Management for Office 365");
  });

  it("reports not_configured when a full Intune plan exists but never activated", () => {
    const v = resolveIntuneServiceState(
      "intune-legacy-devicefe-401",
      entitlement({
        verdict: "entitled_not_activated",
        skuPartNumbers: ["SPE_E3"],
        plans: [{ skuPartNumber: "SPE_E3", servicePlanName: "INTUNE_A", provisioningStatus: "PendingActivation" }],
      }),
    );
    expect(v.state).toBe("not_configured");
    expect(v.evidenceBasis).toBe("combined");
  });

  it("reports not_configured when Intune is fully licensed and provisioned but still refuses", () => {
    const v = resolveIntuneServiceState(
      "intune-backend-iis-503",
      entitlement({
        verdict: "licensed",
        skuPartNumbers: ["SPE_E3"],
        plans: [{ skuPartNumber: "SPE_E3", servicePlanName: "INTUNE_A", provisioningStatus: "Success" }],
      }),
    );
    expect(v.state).toBe("not_configured");
    expect(v.reason).toContain("MDM authority");
  });

  it("says so, rather than guessing, when there is no entitlement evidence to read", () => {
    const v = resolveIntuneServiceState("intune-backend-iis-503", entitlement({ verdict: "unknown" }));
    expect(v.state).toBe("not_configured");
    // The thinness of the evidence has to be visible, not hidden behind a confident
    // verdict — that is the whole discipline this issue turns on.
    expect(v.evidenceBasis).toBe("wire-signature");
    expect(v.reason).toContain("could not be confirmed");
  });

  it("always names the service and never says zero", () => {
    for (const verdict of ["not_licensed", "basic_mdm_only", "entitled_not_activated", "licensed", "unknown"] as const) {
      const v = resolveIntuneServiceState("intune-legacy-devicefe-401", entitlement({ verdict }));
      expect(v.reason).toContain("Microsoft Intune");
      expect(v.reason).not.toMatch(/\b0 devices\b/);
    }
  });
});
