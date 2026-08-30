/**
 * remediation-checklist.test.ts — the findings-derived checklist (#1538).
 *
 * Locks the two things this module is FOR:
 *   1. An empty tenant (no scan, or a clean latest scan) gets an empty list —
 *      never a fixture, never a fallback row.
 *   2. Each item is resolved from real state: its fix route via #1539's
 *      `min(finding ceiling, tenant ceiling)`, and its tracker claim carried
 *      through when one already exists, keyed by the finding's own checkKey.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

let mockSelectResultsQueue: any[][] = [];

vi.mock("@workspace/db", () => {
  const makeSelectChain = () => {
    const chain: any = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve(mockSelectResultsQueue.shift() ?? []),
      then: (onfulfilled: any, onrejected?: any) =>
        Promise.resolve(mockSelectResultsQueue.shift() ?? []).then(onfulfilled, onrejected),
    };
    return chain;
  };

  return {
    db: {
      select: vi.fn(() => makeSelectChain()),
    },
    mspDiagnosticFindingsTable: {
      runId: "run_id",
      customerId: "customer_id",
      severity: "severity",
      findingId: "finding_id",
      checkKey: "check_key",
      title: "title",
      description: "description",
      createdAt: "created_at",
    },
    remediationKnowledgeBaseTable: {
      checkKey: "check_key",
      title: "title",
      summary: "summary",
      remediationSteps: "remediation_steps",
      fixRouteCapability: "fix_route_capability",
      adminCenterPath: "admin_center_path",
      adminCenterUrl: "admin_center_url",
      validationCommand: "validation_command",
      status: "status",
    },
    remediationTrackerStepsTable: {
      customerId: "customer_id",
      stepId: "step_id",
      status: "status",
      completedAt: "completed_at",
      verificationState: "verification_state",
      verifiedAt: "verified_at",
    },
    configPackTemplatesTable: { checkKey: "check_key", templateId: "template_id", packId: "pack_id" },
    configPacksTable: { id: "id", status: "status" },
    monitorChecksTable: { key: "key", label: "label" },
    tenantsTable: { id: "id", consent: "consent" },
    REMEDIATION_TRACKER_STEP_STATUS: [
      "not_started",
      "completed",
      "already_handled",
      "not_applicable",
      "deferred",
      "shane_handles",
    ],
    REMEDIATION_FIX_ROUTE: ["we_can_run", "you_must_run", "admin_center_only"],
  };
});

vi.mock("./logger", () => {
  const noop = () => {};
  const noopLogger: any = { info: noop, warn: noop, error: noop, debug: noop };
  noopLogger.child = () => noopLogger;
  return { logger: noopLogger };
});

import { resolveRemediationChecklist, isKnownCheckKey } from "./remediation-checklist";

const CUSTOMER_ID = 42;
const RUN_ID = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  mockSelectResultsQueue = [];
});

describe("resolveRemediationChecklist", () => {
  it("returns an empty checklist when the tenant has never scanned", async () => {
    mockSelectResultsQueue = [[]]; // latest-run lookup: no rows
    const result = await resolveRemediationChecklist(CUSTOMER_ID);
    expect(result).toEqual({ runId: null, items: [] });
  });

  it("returns an empty checklist when the latest scan has no adverse findings", async () => {
    mockSelectResultsQueue = [
      [{ runId: RUN_ID }], // latest run
      [], // findings (none critical/warning)
    ];
    const result = await resolveRemediationChecklist(CUSTOMER_ID);
    expect(result).toEqual({ runId: RUN_ID, items: [] });
  });

  it("resolves a real item: fix route from a write-granted tenant + published KB row, no existing tracker claim", async () => {
    mockSelectResultsQueue = [
      [{ runId: RUN_ID }], // latest run
      [
        {
          findingId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          checkKey: "identity:mfa-registration",
          severity: "critical",
          title: "11 admin accounts without MFA",
          description: "Eleven privileged accounts have no MFA method registered.",
        },
      ], // findings
      [{ consent: { writeBack: { status: "granted" } } }], // tenant
      [
        {
          checkKey: "identity:mfa-registration",
          title: "Enforce MFA on admin accounts",
          summary: "Every admin account must have a second factor.",
          remediationSteps: [{ text: "Enable Security Defaults or a CA policy." }],
          capability: "you_must_run",
          adminCenterPath: "Entra admin center → Security",
          adminCenterUrl: null,
          validationCommand: "Get-MgUserAuthenticationMethod",
          status: "published",
        },
      ], // kb rows
      [{ checkKey: "identity:mfa-registration" }], // pack rows — live pack exists, raises ceiling
      [], // tracker rows — no existing claim
    ];

    const result = await resolveRemediationChecklist(CUSTOMER_ID);
    expect(result.runId).toBe(RUN_ID);
    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item.checkKey).toBe("identity:mfa-registration");
    expect(item.findingId).toBe("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    expect(item.severity).toBe("critical");
    expect(item.title).toBe("11 admin accounts without MFA"); // the finding's own tenant-specific fact, not the KB title
    // authored capability is "you_must_run", but a live pack raises the finding
    // ceiling to "we_can_run", and the tenant has granted write — min(we_can_run, we_can_run).
    expect(item.fixRoute).toBe("we_can_run");
    expect(item.affordance).toBe("execute");
    expect(item.hasVerifiedContent).toBe(true);
    expect(item.summary).toBe("Every admin account must have a second factor.");
    expect(item.status).toBe("not_started");
    expect(item.verificationState).toBe("unverified");
    expect(item.completedAt).toBeNull();
  });

  it("carries an existing tracker claim through, keyed by the finding's own checkKey", async () => {
    mockSelectResultsQueue = [
      [{ runId: RUN_ID }],
      [
        {
          findingId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
          checkKey: "sharepoint:anonymous-links",
          severity: "warning",
          title: "2,940 anonymous links found",
          description: null,
        },
      ],
      [{ consent: null }], // no consent on file — caps at you_must_run
      [], // no KB row published for this check yet
      [], // no live pack
      [
        {
          stepId: "sharepoint:anonymous-links",
          status: "already_handled",
          completedAt: null,
          verificationState: "unverified",
          verifiedAt: null,
        },
      ], // existing claim
    ];

    const result = await resolveRemediationChecklist(CUSTOMER_ID);
    const item = result.items[0];
    expect(item.status).toBe("already_handled");
    expect(item.hasVerifiedContent).toBe(false);
    expect(item.fixRoute).toBe("admin_center_only"); // no KB capability, no pack — admin_center_only floor
    expect(item.affordance).toBe("link");
  });
});

describe("isKnownCheckKey", () => {
  it("is true when monitor_checks has the key", async () => {
    mockSelectResultsQueue = [[{ key: "identity:mfa-registration" }]];
    expect(await isKnownCheckKey("identity:mfa-registration")).toBe(true);
  });

  it("is false for a key that isn't a real check", async () => {
    mockSelectResultsQueue = [[]];
    expect(await isKnownCheckKey("not-a-real-check")).toBe(false);
  });
});
