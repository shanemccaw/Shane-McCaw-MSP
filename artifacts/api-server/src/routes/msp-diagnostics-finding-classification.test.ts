/**
 * msp-diagnostics-finding-classification.test.ts
 *
 * Tests: #379 — the failure classifier wired onto each msp_diagnostic_findings
 * row returned by GET /msp/customers/:customerId/diagnostics/runs/:runId.
 *
 * These exercise the REAL exported functions from msp-diagnostics.ts, not a
 * reimplementation of them, and they feed the real error text shapes the
 * classifier's own test file documents as genuinely observed.
 *
 * A separate file rather than an addition to msp-diagnostics.test.ts: that
 * file's `../lib/logger` mock has no `.child()`, so the route module fails to
 * import there (which is why 2 of its route tests already fail on baseline).
 * That pre-existing breakage is left alone — see PLATFORM_BUILD.md.
 *
 * What is deliberately NOT tested here: the classifier's own signature rules.
 * Those have their own suite (lib/__tests__/monitor-failure-classifier.test.ts)
 * and this task does not modify them. What's under test is only the WIRING —
 * which findings get a verdict, which get null, and what the classifier is
 * handed.
 */

import { describe, it, expect, vi } from "vitest";

// ── Environment ───────────────────────────────────────────────────────────────
// msp-diagnostics.ts transitively pulls in ps-script-gen → the Anthropic AI
// integration client, which THROWS at module load if these are unset (same
// reason consent.test.ts sets them). vi.hoisted() rather than bare assignments:
// static imports are evaluated before any top-level statement, so a plain
// `process.env.X = …` would run too late.
vi.hoisted(() => {
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = "https://anthropic.test";
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "test-anthropic-key";
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://openai.test";
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "test-openai-key";
  process.env.JWT_SECRET = "diagnostics-classification-test-secret";
});

// The route module is imported for its exported helpers only; these mocks exist
// purely so that import succeeds without a DB or a real logger.
vi.mock("@workspace/db", () => ({
  db: {},
  mspDiagnosticRunsTable: {},
  mspDiagnosticFindingsTable: {},
  tenantsTable: {},
  usersTable: {},
  clientServicesTable: {},
  servicesTable: {},
  industryBenchmarkReferenceTable: {},
  monitorChecksTable: { key: "key", endpoint: "endpoint" },
  scriptModulesTable: {},
}));

vi.mock("../lib/logger", () => {
  const log: Record<string, unknown> = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  log["child"] = () => log;
  return { logger: log };
});

import {
  classifyDiagnosticFindings,
  isClassifiableFinding,
  rawGraphErrorOf,
} from "./msp-diagnostics";
import { REQUIRED_MT_SCOPES } from "../lib/graph";

// Real observed shapes, matching the classifier's own fixtures.
const PIM_CULTURE_ERROR =
  "Graph API error 400: {\"error\":{\"code\":\"UnknownError\",\"message\":\"System.Globalization.CultureNotFoundException: '*' is an invalid culture identifier.\"}}";
const FORBIDDEN_NAMED_PERMISSION =
  "Graph API error 403: {\"error\":{\"code\":\"Authorization_RequestDenied\",\"message\":\"Insufficient privileges to complete the operation. Required permission: Sites.Read.All\"}}";

const noEndpoints = new Map<string, string | null>();

describe("#379 rawGraphErrorOf — reads #374's field, nothing else", () => {
  it("returns the raw Graph error when extractedProperties carries it", () => {
    expect(rawGraphErrorOf({ extractedProperties: { _rawGraphError: "boom" } })).toBe("boom");
  });

  it("returns null for a finding with no extractedProperties at all (pre-#374 rows)", () => {
    expect(rawGraphErrorOf({ extractedProperties: null })).toBeNull();
    expect(rawGraphErrorOf({})).toBeNull();
  });

  it("returns null for an empty string or a non-string value rather than treating it as an error", () => {
    expect(rawGraphErrorOf({ extractedProperties: { _rawGraphError: "" } })).toBeNull();
    expect(rawGraphErrorOf({ extractedProperties: { _rawGraphError: 42 } })).toBeNull();
  });
});

describe("#379 isClassifiableFinding — a verdict never lands on a green check", () => {
  it("is false for a healthy finding, even one with real extracted data", () => {
    expect(isClassifiableFinding({ checkStatus: "ok", extractedProperties: { userCount: 42 } })).toBe(false);
  });

  it("is false for requires_script — nothing failed, there is just no Graph request", () => {
    expect(isClassifiableFinding({ checkStatus: "requires_script", extractedProperties: {} })).toBe(false);
  });

  it("is true for a finding carrying a real raw Graph error", () => {
    expect(isClassifiableFinding({ checkStatus: "error", extractedProperties: { _rawGraphError: PIM_CULTURE_ERROR } })).toBe(true);
  });

  it("is true for the two statuses already classified upstream, even with no error text", () => {
    expect(isClassifiableFinding({ checkStatus: "license_gap", extractedProperties: {} })).toBe(true);
    expect(isClassifiableFinding({ checkStatus: "consent_revoked", extractedProperties: null })).toBe(true);
  });
});

describe("#379 classifyDiagnosticFindings — the wiring", () => {
  it("classifies a failing finding and leaves a healthy one null", () => {
    const [failing, healthy] = classifyDiagnosticFindings(
      [
        {
          checkKey: "identity:pim-eligible-roles",
          checkStatus: "error",
          extractedProperties: { _rawGraphError: PIM_CULTURE_ERROR },
        },
        { checkKey: "identity:mfa-registration", checkStatus: "ok", extractedProperties: { userCount: 42 } },
      ],
      noEndpoints,
    );

    // The real category for the real culture-identifier error, from the
    // unmodified classifier — not a guess made here.
    expect(failing!.classification?.category).toBe("parameter_slot");
    expect(failing!.classification?.action.kind).toBe("edit_endpoint");
    expect(failing!.classification?.evidence.some((e) => e.includes("culture"))).toBe(true);

    expect(healthy!.classification).toBeNull();
  });

  it("passes REQUIRED_MT_SCOPES through, so an already-declared permission is named as a re-consent case", () => {
    const [f] = classifyDiagnosticFindings(
      [
        {
          checkKey: "sharepoint:external-sharing",
          checkStatus: "error",
          extractedProperties: { _rawGraphError: FORBIDDEN_NAMED_PERMISSION },
        },
      ],
      noEndpoints,
    );

    expect(f!.classification?.category).toBe("missing_scope");
    expect(f!.classification?.permissions).toContain("Sites.Read.All");
    // Sites.Read.All really is on the multi-tenant app, so the classifier must
    // say so — that is the whole difference between "add a permission" and
    // "this tenant needs to re-consent".
    expect(REQUIRED_MT_SCOPES).toContain("Sites.Read.All");
    expect(f!.classification?.alreadyDeclaredPermissions).toContain("Sites.Read.All");
  });

  it("feeds the joined monitor_checks endpoint through as corroborating evidence", () => {
    const withBeta = new Map<string, string | null>([
      ["reports:dead-one", "https://graph.microsoft.com/beta/reports/withdrawn"],
    ]);
    const [f] = classifyDiagnosticFindings(
      [
        {
          checkKey: "reports:dead-one",
          checkStatus: "error",
          extractedProperties: { _rawGraphError: "Graph API error 400: this API has been deprecated" },
        },
      ],
      withBeta,
    );

    expect(f!.classification?.category).toBe("dead_api");
    // Only reachable if the endpoint really was passed in.
    expect(f!.classification?.evidence).toContain("endpoint targets the /beta API surface");
  });

  it("survives a check_key with no monitor_checks row rather than throwing", () => {
    const [f] = classifyDiagnosticFindings(
      [{ checkKey: "gone:missing-check", checkStatus: "error", extractedProperties: { _rawGraphError: PIM_CULTURE_ERROR } }],
      noEndpoints,
    );
    expect(f!.classification?.category).toBe("parameter_slot");
  });

  it("license_gap is reported as not-a-fault, with no suggested action", () => {
    const [f] = classifyDiagnosticFindings(
      [{ checkKey: "identity:risky-users", checkStatus: "license_gap", extractedProperties: {} }],
      noEndpoints,
    );
    expect(f!.classification?.category).toBe("license_gap");
    expect(f!.classification?.action.kind).toBe("none");
  });

  it("preserves every original field on the finding — classification is purely additive", () => {
    const original = {
      findingId: "f-1",
      checkKey: "identity:pim-eligible-roles",
      checkStatus: "error",
      title: "PIM eligible roles check failed",
      extractedProperties: { _rawGraphError: PIM_CULTURE_ERROR },
    };
    const [f] = classifyDiagnosticFindings([original], noEndpoints);
    expect(f!.findingId).toBe("f-1");
    expect(f!.title).toBe("PIM eligible roles check failed");
    expect(f!.extractedProperties).toEqual(original.extractedProperties);
  });
});
