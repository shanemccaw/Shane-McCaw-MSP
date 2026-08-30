/**
 * diagnostics-finding-title.test.ts
 *
 * Tests: #408 — `buildFindingTitle`, the function that decides what a customer
 * actually reads on a finding.
 *
 * This exercises the REAL exported function from diagnostics-runner.ts. That
 * distinction is the whole point of the file: the pre-existing coverage of this
 * area (msp-diagnostics.test.ts) reimplements the branches inline and asserts
 * against its own copy, which is exactly why #408 — every finding titled
 * "warning finding detected" while dozens of specific severity_rules labels sat
 * unread — survived a green suite.
 *
 * A separate file rather than an addition to msp-diagnostics.test.ts: that file
 * mocks `../lib/diagnostics-runner` wholesale to test the routes, so the real
 * module can never be imported there.
 */

import { describe, it, expect, vi } from "vitest";
import type { CheckResult } from "./monitor-executor";

// diagnostics-runner pulls in the DB, the workflow executor, the narrative
// generator and the SSE hub at module load. None of them participate in title
// building, so they are stubbed to the minimum that lets the import succeed.
vi.mock("@workspace/db", () => ({
  db: {},
  mspDiagnosticRunsTable: {},
  mspDiagnosticFindingsTable: {},
  tenantsTable: {},
  mspDocumentsTable: {},
  portalWfRunsTable: {},
  portalWfOperatorTasksTable: {},
}));

vi.mock("./monitor-executor", () => ({ executeMonitoringPackage: vi.fn() }));
vi.mock("./workflow-executor", () => ({ emitWorkflowEvent: vi.fn() }));
vi.mock("./cio-narrative-generator", () => ({ generateCioNarrative: vi.fn() }));
vi.mock("./doc-gate-coverage", () => ({ evaluateDocGateCoverage: vi.fn() }));
vi.mock("./pillar-summary-stats", () => ({ resolveSeatFigures: vi.fn() }));
vi.mock("./license-waste-source", () => ({ DEFAULT_LICENSE_WASTE_CHECK_KEY: "cost:license-waste-estimate" }));
vi.mock("./sse-channels", () => ({
  broadcastDiagnosticsRunProgress: vi.fn(),
  broadcastDiagnosticsRunComplete: vi.fn(),
  broadcastDiagnosticsRunError: vi.fn(),
  clearDiagnosticsRunSSEState: vi.fn(),
}));

vi.mock("./logger", () => {
  const log: Record<string, unknown> = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  log["child"] = () => log;
  return { logger: log };
});

import { buildFindingTitle, buildFindingDescription } from "./diagnostics-runner";

/** A real matched-rule label, verbatim from the Governance sweep. */
const GOVERNANCE_LABEL =
  "No sensitivity labels configured — Copilot responses can surface unclassified content";

function checkResult(over: Partial<CheckResult>): CheckResult {
  return {
    checkKey: "governance:auto-labeling-coverage",
    status: "ok",
    extractedProperties: {},
    severityMatched: null,
    itemCount: 0,
    pageCount: 1,
    ...over,
  };
}

describe("#408 buildFindingTitle — the matched rule's own words reach the customer", () => {
  it("titles the finding with the matched rule's label, not the generic band text", () => {
    const title = buildFindingTitle(
      checkResult({ severityMatched: "warning", severityLabel: GOVERNANCE_LABEL }),
    );
    expect(title).toBe(GOVERNANCE_LABEL);
    expect(title).not.toBe("warning finding detected");
  });

  it("keeps the generic band text ONLY when the matched rule genuinely has no label", () => {
    expect(buildFindingTitle(checkResult({ severityMatched: "warning", severityLabel: null })))
      .toBe("warning finding detected");
    // Pre-#408 rows and every non-severity code path leave the field absent.
    expect(buildFindingTitle(checkResult({ severityMatched: "critical" })))
      .toBe("critical finding detected");
  });

  it("does not treat a whitespace-only label as real text", () => {
    expect(buildFindingTitle(checkResult({ severityMatched: "warning", severityLabel: "   " })))
      .toBe("warning finding detected");
  });

  it("still reports a check that could not run, label or not", () => {
    // A label describes a MATCHED condition; a check that never produced data
    // has nothing to report but why. These branches sit above the label on
    // purpose — a stale label must never mask a consent or execution failure.
    expect(buildFindingTitle(checkResult({ status: "consent_revoked", severityLabel: GOVERNANCE_LABEL })))
      .toBe("Consent Revoked — Check could not run");
    // #1147 — an error title must NEVER embed the raw internal check key.
    expect(buildFindingTitle(checkResult({ status: "error", severityLabel: GOVERNANCE_LABEL })))
      .toBe("This check couldn't complete");
    expect(buildFindingTitle(checkResult({ status: "error" })))
      .not.toContain("governance:auto-labeling-coverage");
    expect(buildFindingTitle(checkResult({ status: "requires_script", severityLabel: GOVERNANCE_LABEL })))
      .toBe("Requires customer-side script");
    expect(
      buildFindingTitle(
        checkResult({
          status: "license_gap",
          severityLabel: GOVERNANCE_LABEL,
          extractedProperties: { _licenseGapFeature: "Microsoft Entra ID Premium (P1/P2)" },
        }),
      ),
    ).toBe("Not checked — requires Microsoft Entra ID Premium (P1/P2)");
  });

  it("leaves the clean and partial-coverage cases alone", () => {
    expect(buildFindingTitle(checkResult({}))).toBe("Check passed");
    expect(buildFindingTitle(checkResult({ status: "partial" })))
      .toBe("Partial coverage — some items could not be scanned");
  });
});

describe("#1147 buildFindingDescription — no raw property dump reaches the customer", () => {
  // The exact extractedProperties shape from Shane's report — including a nested
  // object (`sitesByHighestSharingLevel`) that the old generic builder rendered
  // as the literal string "[object Object]".
  const EEEU_PROPS = {
    oversharedSiteCount: 1,
    eeeuSiteCount: 1,
    everyoneSiteCount: 0,
    anonymousLinkSiteCount: 0,
    organizationLinkSiteCount: 0,
    sitesScanned: 93,
    sitesByHighestSharingLevel: { eeeu: 1, everyone: 0 },
  };

  it("renders the SharePoint over-sharing check through its real human template", () => {
    const desc = buildFindingDescription(
      checkResult({ checkKey: "compliance:eeeu-site-sharing", status: "partial", extractedProperties: EEEU_PROPS }),
    );
    expect(desc).toContain("93 SharePoint sites");
    expect(desc).toContain("1 site is shared more broadly than recommended");
    // The precise leaks #1147 was filed about are gone:
    expect(desc).not.toContain("[object Object]");
    expect(desc).not.toContain("oversharedSiteCount");
    expect(desc).not.toContain("sitesByHighestSharingLevel");
  });

  it("falls back to an honest 'not available yet' state for an un-templated check — never a raw dump", () => {
    const desc = buildFindingDescription(
      checkResult({
        checkKey: "teams:channel-review",
        status: "partial",
        // A fan-out check's raw props: identifiers and a nested object that the
        // old builder would have dumped verbatim.
        extractedProperties: {
          channelCount: 27,
          firstChannelId: "19:5c658ac2cf1b4675a0ed8fc061ca6f3a@thread.skype",
          id: ["19:5c658ac2cf1b4675a0ed8fc061ca6f3a@thread.skype"],
          id_count: 27,
          nested: { deep: "value" },
        },
      }),
    );
    expect(desc).toContain("isn't available yet");
    // None of the raw identifiers / keys / object stringifications leak:
    expect(desc).not.toContain("[object Object]");
    expect(desc).not.toContain("thread.skype");
    expect(desc).not.toContain("channelCount");
    expect(desc).not.toContain("firstChannelId");
  });

  it("keeps the honest per-status messages that already existed", () => {
    expect(buildFindingDescription(checkResult({ status: "consent_revoked" })))
      .toContain("consent has been revoked");
    expect(buildFindingDescription(checkResult({ status: "ok", extractedProperties: {} })))
      .toBe("No issues detected for this check.");
  });
});
