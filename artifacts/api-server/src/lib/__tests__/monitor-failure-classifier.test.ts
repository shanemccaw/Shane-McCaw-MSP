/**
 * monitor-failure-classifier.test.ts
 *
 * Regression tests for Phase 4 failure auto-classification.
 *
 * EVERY MESSAGE FIXTURE BELOW IS A REAL SHAPE. They are the error signatures a
 * real debugging session read by hand out of `simulator_check_runs.error_message`
 * and bucketed by eye, wrapped in monitor-executor's own
 * `Graph API error {status}: {body}` envelope, which is exactly how the classifier
 * receives them in production. A test built on invented error text would prove
 * the regex works against itself and nothing else.
 *
 * THE TWO PROPERTIES THAT MATTER MOST, and why each has its own test:
 *   1. Each real signature lands in its real category.
 *   2. A genuinely novel error returns "unclassified" — NOT a nearest-neighbour
 *      guess. A confidently-wrong category sends the operator down a wrong path
 *      with false authority, which is strictly worse than no category at all.
 *
 * Run with: pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect } from "vitest";
import {
  aggregateFailureClassifications,
  classifyMonitorFailure,
  classifyRunFailure,
  extractPermissionNames,
  type ClassifiedFailure,
} from "../monitor-failure-classifier";

// ── Real error fixtures ───────────────────────────────────────────────────────
// Wrapped the way monitor-executor.graphFetchPaginated really wraps them.

const graphError = (status: number, body: string) => `Graph API error ${status}: ${body}`;

/** 403 naming the real missing permission — the highest-value case. */
const MISSING_SCOPE_NAMED = graphError(
  403,
  `{"error":{"code":"Forbidden","message":"The token doesn't have the required permissions. Required permission: SecurityEvents.Read.All. Contact your administrator."}}`,
);

/** 403 from the Exchange/role family — names roles rather than a permission. */
const MISSING_SCOPE_ROLES = graphError(
  403,
  `{"error":{"code":"authorization_error","message":"The user or administrator has not consented; the token does not have any of the required roles."}}`,
);

/** The classic Directory 403 — real, but names nothing. */
const MISSING_SCOPE_UNNAMED = graphError(
  403,
  `{"error":{"code":"Authorization_RequestDenied","message":"Insufficient privileges to complete the operation."}}`,
);

/** Defender/security wording. */
const MISSING_SCOPE_CALLER = graphError(
  403,
  `{"error":{"code":"accessDenied","message":"Caller does not have required permissions. Required permissions: DeviceManagementManagedDevices.Read.All"}}`,
);

/** 503 whose body is a raw HTML page rather than Graph JSON. */
const WRONG_ENDPOINT_HTML = graphError(
  503,
  `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN"><html><head><title>Service Unavailable</title></head><body><h2>Service Unavailable</h2></body></html>`,
);

/** The non-JSON-200 path monitor-executor raises for the same class of body. */
const WRONG_ENDPOINT_NON_JSON =
  `Graph API returned a non-JSON body (content-type: text/html): <!DOCTYPE HTML><html><body>Service Unavailable</body></html>`;

/** A URL segment Graph cannot route. */
const BAD_PATH_SEGMENT = graphError(
  400,
  `{"error":{"code":"BadRequest","message":"Resource not found for the segment 'securescores'."}}`,
);

/** A placeholder that was never substituted — the literal braces reached Graph. */
const BAD_PATH_PLACEHOLDER = graphError(
  400,
  `{"error":{"code":"BadRequest","message":"Invalid object identifier '{id}'."}}`,
);

/** A value landing in a locale/culture slot. */
const PARAMETER_SLOT = graphError(
  500,
  `{"error":{"code":"generalException","message":"System.Globalization.CultureNotFoundException: 'D7' is an invalid culture identifier."}}`,
);

/** A download-oriented call used where a metadata read was intended. */
const WRONG_API_PATTERN = graphError(
  400,
  `{"error":{"code":"InvalidDownloadToken","message":"The download token is invalid or has expired."}}`,
);

/** Microsoft explicitly reporting the API as withdrawn. */
const DEAD_API = graphError(
  404,
  `{"error":{"code":"ResourceNotFound","message":"This API has been deprecated and is no longer supported as of 2025-12-31."}}`,
);

/** Nothing known — the honesty case. */
const NOVEL_ERROR = graphError(
  500,
  `{"error":{"code":"unknownError","message":"An unexpected condition occurred in the downstream widget reconciler."}}`,
);

const DECLARED_SCOPES = ["Directory.Read.All", "SecurityEvents.Read.All", "Reports.Read.All"] as const;

// ── 1. Each real signature lands in its real category ─────────────────────────

describe("classifyMonitorFailure — the real error signatures", () => {
  it("classifies a 403 naming a permission as missing_scope and extracts the real name", () => {
    const result = classifyMonitorFailure({ errorMessage: MISSING_SCOPE_NAMED });
    expect(result.category).toBe("missing_scope");
    expect(result.statusCode).toBe(403);
    // The whole point: the real permission, not "permission error".
    expect(result.permissions).toContain("SecurityEvents.Read.All");
    // The sentence after the name must not be swallowed into it.
    expect(result.permissions.every((p) => !p.includes(" "))).toBe(true);
  });

  it("classifies the 'does not have any of the required roles' shape as missing_scope", () => {
    const result = classifyMonitorFailure({ errorMessage: MISSING_SCOPE_ROLES });
    expect(result.category).toBe("missing_scope");
    expect(result.evidence.some((e) => e.includes("required roles"))).toBe(true);
  });

  it("classifies 'Insufficient privileges' as missing_scope and says so honestly when nothing is named", () => {
    const result = classifyMonitorFailure({ errorMessage: MISSING_SCOPE_UNNAMED });
    expect(result.category).toBe("missing_scope");
    expect(result.permissions).toEqual([]);
    // Must not invent a permission to fill the gap.
    expect(result.summary).toMatch(/does not name/i);
  });

  it("classifies the 'Caller does not have required permissions' shape and extracts its permission", () => {
    const result = classifyMonitorFailure({ errorMessage: MISSING_SCOPE_CALLER });
    expect(result.category).toBe("missing_scope");
    expect(result.permissions).toContain("DeviceManagementManagedDevices.Read.All");
  });

  it("classifies a 503 with a raw HTML body as wrong_endpoint, not as a permission error", () => {
    const result = classifyMonitorFailure({ errorMessage: WRONG_ENDPOINT_HTML });
    expect(result.category).toBe("wrong_endpoint");
    expect(result.statusCode).toBe(503);
    // The HTML body IS the diagnostic — it must be stated as the evidence.
    expect(result.evidence.some((e) => e.includes("HTML"))).toBe(true);
  });

  it("classifies the non-JSON-body executor message as wrong_endpoint too", () => {
    expect(classifyMonitorFailure({ errorMessage: WRONG_ENDPOINT_NON_JSON }).category).toBe("wrong_endpoint");
  });

  it("classifies 'Resource not found for the segment' as bad_path and names the segment", () => {
    const result = classifyMonitorFailure({ errorMessage: BAD_PATH_SEGMENT });
    expect(result.category).toBe("bad_path");
    expect(result.summary).toContain("securescores");
  });

  it("classifies an unsubstituted {id} placeholder as bad_path", () => {
    const result = classifyMonitorFailure({ errorMessage: BAD_PATH_PLACEHOLDER });
    expect(result.category).toBe("bad_path");
    expect(result.evidence.some((e) => e.includes("placeholder"))).toBe(true);
  });

  it("classifies a literal non-HTTP scheme on the endpoint as bad_path", () => {
    const result = classifyMonitorFailure({
      errorMessage: graphError(400, `{"error":{"code":"BadRequest","message":"Invalid URI: the format could not be determined."}}`),
      endpoint: "exchange-online://mailbox/settings",
    });
    expect(result.category).toBe("bad_path");
    expect(result.evidence.some((e) => e.includes("exchange-online://"))).toBe(true);
  });

  it("classifies a CultureNotFoundException as parameter_slot", () => {
    const result = classifyMonitorFailure({ errorMessage: PARAMETER_SLOT });
    expect(result.category).toBe("parameter_slot");
    expect(result.action.kind).toBe("edit_endpoint");
    expect(result.action.focusField).toBe("selectParams");
  });

  it("classifies InvalidDownloadToken as wrong_api_pattern", () => {
    expect(classifyMonitorFailure({ errorMessage: WRONG_API_PATTERN }).category).toBe("wrong_api_pattern");
  });

  it("classifies an explicit deprecation as dead_api and suggests the reversible retire", () => {
    const result = classifyMonitorFailure({ errorMessage: DEAD_API, endpoint: "https://graph.microsoft.com/beta/reports/foo" });
    expect(result.category).toBe("dead_api");
    expect(result.action.kind).toBe("retire_check");
    // Beta-ness corroborates but is never the verdict on its own — see the next test.
    expect(result.evidence.some((e) => e.includes("/beta"))).toBe(true);
  });

  it("classifies HTTP 410 Gone as dead_api", () => {
    expect(classifyMonitorFailure({ errorMessage: graphError(410, "{}") }).category).toBe("dead_api");
  });

  it("does NOT call a beta endpoint dead just because it is on beta", () => {
    // A beta endpoint returning a permission error is a permission problem.
    const result = classifyMonitorFailure({
      errorMessage: MISSING_SCOPE_NAMED,
      endpoint: "https://graph.microsoft.com/beta/security/secureScores",
    });
    expect(result.category).toBe("missing_scope");
  });
});

// ── 2. Novel errors stay unclassified ─────────────────────────────────────────

describe("classifyMonitorFailure — refuses to guess", () => {
  it("returns unclassified for a genuinely novel error shape", () => {
    const result = classifyMonitorFailure({ errorMessage: NOVEL_ERROR });
    expect(result.category).toBe("unclassified");
    expect(result.action.kind).toBe("none");
    expect(result.permissions).toEqual([]);
  });

  it("returns unclassified for a bare 401, which Graph returns for many non-permission reasons", () => {
    // graph.ts documents this explicitly: expired tokens, wrong audiences and beta
    // endpoints all 401. Calling that a missing scope would be a false positive.
    const result = classifyMonitorFailure({
      errorMessage: graphError(401, `{"error":{"code":"InvalidAuthenticationToken","message":"Access token has expired."}}`),
    });
    expect(result.category).toBe("unclassified");
  });

  it("returns unclassified rather than inventing a category for an empty message", () => {
    expect(classifyMonitorFailure({ errorMessage: "" }).category).toBe("unclassified");
    expect(classifyMonitorFailure({ errorMessage: null }).category).toBe("unclassified");
  });

  it("defers to the executor for license_gap and consent_revoked instead of re-deriving them", () => {
    expect(
      classifyMonitorFailure({ errorMessage: "Requires Microsoft Entra ID Premium (P1/P2)", resultStatus: "license_gap" })
        .category,
    ).toBe("license_gap");
    expect(
      classifyMonitorFailure({ errorMessage: "Consent revoked for tenant abc", resultStatus: "consent_revoked" }).category,
    ).toBe("consent_revoked");
  });
});

// ── 3. Permission-name extraction ─────────────────────────────────────────────

describe("extractPermissionNames", () => {
  it("pulls the real name out of a real labelled message", () => {
    expect(extractPermissionNames(MISSING_SCOPE_NAMED)).toContain("SecurityEvents.Read.All");
  });

  it("pulls multiple names out of a comma/or list", () => {
    const names = extractPermissionNames(
      `{"error":{"message":"Required permissions: Directory.Read.All, Policy.Read.All or Application.Read.All"}}`,
    );
    expect(names).toEqual(expect.arrayContaining(["Directory.Read.All", "Policy.Read.All", "Application.Read.All"]));
  });

  it("finds a non-.All permission shape like Exchange.ManageAsApp", () => {
    expect(
      extractPermissionNames(`{"error":{"message":"The app does not have permission Exchange.ManageAsApp on this tenant."}}`),
    ).toContain("Exchange.ManageAsApp");
  });

  it("does NOT mistake a .NET type name for a permission", () => {
    // The single most likely false positive: dotted PascalCase that is a class, not a scope.
    const names = extractPermissionNames(PARAMETER_SLOT);
    expect(names).not.toContain("System.Globalization.CultureNotFoundException");
    expect(names).toEqual([]);
  });

  it("does not return a permission when the message names none", () => {
    expect(extractPermissionNames(MISSING_SCOPE_UNNAMED)).toEqual([]);
  });
});

describe("already-declared permissions", () => {
  it("marks a named permission that is ALREADY on the app as a re-consent case", () => {
    const result = classifyMonitorFailure({ errorMessage: MISSING_SCOPE_NAMED, declaredScopes: DECLARED_SCOPES });
    expect(result.alreadyDeclaredPermissions).toEqual(["SecurityEvents.Read.All"]);
    expect(result.guidance).toMatch(/re-consent/i);
  });

  it("leaves it empty when the named permission is genuinely not declared", () => {
    const result = classifyMonitorFailure({ errorMessage: MISSING_SCOPE_CALLER, declaredScopes: DECLARED_SCOPES });
    expect(result.permissions).toContain("DeviceManagementManagedDevices.Read.All");
    expect(result.alreadyDeclaredPermissions).toEqual([]);
  });
});

// ── 4. The safety boundary ────────────────────────────────────────────────────

describe("the tie-to-action safety boundary", () => {
  it("never offers to add a permission — missing_scope is display only", () => {
    for (const message of [MISSING_SCOPE_NAMED, MISSING_SCOPE_ROLES, MISSING_SCOPE_UNNAMED, MISSING_SCOPE_CALLER]) {
      const result = classifyMonitorFailure({ errorMessage: message, declaredScopes: DECLARED_SCOPES });
      expect(result.category).toBe("missing_scope");
      expect(result.action.kind).toBe("show_permission");
    }
  });

  it("only ever suggests edit_endpoint or retire_check as mutating actions", () => {
    const allowed = new Set(["show_permission", "edit_endpoint", "retire_check", "none"]);
    for (const message of [
      MISSING_SCOPE_NAMED, WRONG_ENDPOINT_HTML, BAD_PATH_SEGMENT, PARAMETER_SLOT,
      WRONG_API_PATTERN, DEAD_API, NOVEL_ERROR,
    ]) {
      expect(allowed.has(classifyMonitorFailure({ errorMessage: message }).action.kind)).toBe(true);
    }
  });

  it("suggests nothing actionable for already-explained or unclassified failures", () => {
    expect(classifyMonitorFailure({ errorMessage: "x", resultStatus: "license_gap" }).action.kind).toBe("none");
    expect(classifyMonitorFailure({ errorMessage: "x", resultStatus: "consent_revoked" }).action.kind).toBe("none");
    expect(classifyMonitorFailure({ errorMessage: NOVEL_ERROR }).action.kind).toBe("none");
  });
});

// ── 5. classifyRunFailure — the run-shaped wrapper ────────────────────────────

describe("classifyRunFailure", () => {
  it("returns null for a run that did not fail, so no banner can sit over a green run", () => {
    expect(
      classifyRunFailure({ status: "completed", resultStatus: "ok", errorMessage: null }),
    ).toBeNull();
    expect(classifyRunFailure({ status: "running" })).toBeNull();
    expect(classifyRunFailure({ status: "pending" })).toBeNull();
  });

  it("classifies a failed run from its persisted error text", () => {
    const result = classifyRunFailure(
      { status: "failed", resultStatus: "error", errorMessage: MISSING_SCOPE_NAMED, requestEndpoint: "/security/secureScores" },
      DECLARED_SCOPES,
    );
    expect(result?.category).toBe("missing_scope");
    expect(result?.permissions).toContain("SecurityEvents.Read.All");
  });

  it("falls back to statusText when errorMessage was never set", () => {
    const result = classifyRunFailure({
      status: "failed",
      resultStatus: "error",
      errorMessage: null,
      statusText: `error: ${BAD_PATH_SEGMENT}`,
    });
    expect(result?.category).toBe("bad_path");
  });
});

// ── 6. Batch aggregation ──────────────────────────────────────────────────────

describe("aggregateFailureClassifications", () => {
  /** A realistic mixed batch: several failures sharing one real cause. */
  const batch = (): ClassifiedFailure[] =>
    [
      { checkKey: "identity:secure-score", message: MISSING_SCOPE_NAMED },
      { checkKey: "identity:risky-users", message: MISSING_SCOPE_NAMED },
      { checkKey: "device:compliance", message: MISSING_SCOPE_CALLER },
      { checkKey: "usage:teams-activity", message: WRONG_ENDPOINT_HTML },
      { checkKey: "policy:conditional-access", message: BAD_PATH_SEGMENT },
      { checkKey: "reports:legacy-mailbox", message: DEAD_API },
      { checkKey: "misc:unknown", message: NOVEL_ERROR },
    ].map(({ checkKey, message }) => ({
      checkKey,
      classification: classifyMonitorFailure({ errorMessage: message, declaredScopes: DECLARED_SCOPES }),
    }));

  it("groups multiple failures under one classification", () => {
    const triage = aggregateFailureClassifications(batch());
    const scope = triage.groups.find((g) => g.category === "missing_scope");
    expect(scope?.count).toBe(3);
    expect(scope?.checkKeys).toEqual(["identity:secure-score", "identity:risky-users", "device:compliance"]);
  });

  it("reduces the batch to the short real list of distinct permissions needed", () => {
    const triage = aggregateFailureClassifications(batch());
    // Three failing checks, two real distinct permissions — that is the compounding win.
    expect(triage.permissionsNeeded).toEqual([
      "SecurityEvents.Read.All",
      "DeviceManagementManagedDevices.Read.All",
    ]);
    expect(triage.permissionsAlreadyDeclared).toEqual(["SecurityEvents.Read.All"]);
  });

  it("counts classified vs unclassified honestly", () => {
    const triage = aggregateFailureClassifications(batch());
    expect(triage.totalFailures).toBe(7);
    expect(triage.unclassifiedCount).toBe(1);
    expect(triage.classifiedCount).toBe(6);
  });

  it("orders groups largest-bucket-first, deterministically", () => {
    const triage = aggregateFailureClassifications(batch());
    expect(triage.groups[0]?.category).toBe("missing_scope");
    const counts = triage.groups.map((g) => g.count);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
    // Same input, same output — the panel must not reshuffle between polls.
    expect(aggregateFailureClassifications(batch()).groups.map((g) => g.category)).toEqual(
      triage.groups.map((g) => g.category),
    );
  });

  it("carries the group's shared action kind, never a bulk mutation", () => {
    const triage = aggregateFailureClassifications(batch());
    expect(triage.groups.find((g) => g.category === "missing_scope")?.actionKind).toBe("show_permission");
    expect(triage.groups.find((g) => g.category === "dead_api")?.actionKind).toBe("retire_check");
    expect(triage.groups.find((g) => g.category === "unclassified")?.actionKind).toBe("none");
  });

  it("handles an all-green batch", () => {
    const triage = aggregateFailureClassifications([]);
    expect(triage.totalFailures).toBe(0);
    expect(triage.groups).toEqual([]);
    expect(triage.permissionsNeeded).toEqual([]);
  });
});
