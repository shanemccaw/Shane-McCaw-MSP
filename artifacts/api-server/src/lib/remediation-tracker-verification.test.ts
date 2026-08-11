/**
 * remediation-tracker-verification.test.ts — Git #732, Phase C of epic #647.
 *
 * Two things are worth guarding here and they are both correctness:
 *
 *   1. THE STEP → CHECK MAPPING HAS NOT DRIFTED. This file mirrors
 *      msp-portal's `remediationLiveGuide.ts` `STEP_CHECK_KEYS` — the same
 *      table `stepEvidence()` uses to decide what the guide itself shows —
 *      because msp-portal carries no `@workspace/db` dependency this file
 *      could import it through. This test reads the real guide file off disk
 *      and asserts the two mappings are identical, key for key, value for
 *      value.
 *   2. THE VERDICT RULE IS WHAT THE HEADER SAYS IT IS: drift on ANY real
 *      adverse finding among a step's mapped checks even with partial
 *      coverage; verified only with FULL coverage, all clean; no evidence
 *      (missing checks, mixed clean/absent) leaves the row untouched; a step
 *      with no mapped check (gap or process-only) is never eligible; an
 *      untouched (`not_started`) row is never eligible either.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let mockSelectResultsQueue: any[][] = [];
let mockUpdateSets: any[] = [];

vi.mock("@workspace/db", () => {
  const makeSelectChain = () => {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      then: (onfulfilled: any, onrejected?: any) =>
        Promise.resolve(mockSelectResultsQueue.shift() ?? []).then(onfulfilled, onrejected),
    };
    return chain;
  };

  const updateChain: any = {
    set: (v: any) => {
      mockUpdateSets.push(v);
      return updateChain;
    },
    where: () => Promise.resolve({}),
  };

  return {
    db: {
      select: vi.fn(() => makeSelectChain()),
      update: vi.fn(() => updateChain),
    },
    remediationTrackerStepsTable: {
      customerId: "customer_id",
      stepId: "step_id",
      status: "status",
      verificationState: "verification_state",
      verifiedAt: "verified_at",
      verifiedByRunId: "verified_by_run_id",
      updatedAt: "updated_at",
    },
  };
});

vi.mock("./logger", () => {
  const noop = () => {};
  const noopLogger: any = { info: noop, warn: noop, error: noop, debug: noop };
  noopLogger.child = () => noopLogger;
  return { logger: noopLogger };
});

import { reverifyRemediationTrackerSteps, REMEDIATION_TRACKER_STEP_CHECK_KEYS } from "./remediation-tracker-verification";

const CUSTOMER_ID = 42;
const RUN_ID = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  mockSelectResultsQueue = [];
  mockUpdateSets = [];
});

describe("the step→check mapping has not drifted from remediationLiveGuide.ts", () => {
  it("is exactly STEP_CHECK_KEYS, key for key and value for value", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const guidePath = path.resolve(
      here,
      "../../../msp-portal/src/components/copilot-journey/remediationLiveGuide.ts",
    );
    const source = readFileSync(guidePath, "utf8");
    const objMatch = source.match(
      /export const STEP_CHECK_KEYS: Readonly<Record<string, readonly string\[\]>> = \{([\s\S]*?)\n\};/,
    );
    expect(objMatch).not.toBeNull();

    const body = objMatch?.[1] ?? "";
    const entries = [...body.matchAll(/^\s*(s\d+):\s*\[(.*?)\],?\s*$/gm)];
    // Guards the guard: an empty extraction would pass a vacuous comparison.
    expect(entries.length).toBeGreaterThan(0);

    const guideMapping: Record<string, string[]> = {};
    for (const [, key, arrRaw] of entries) {
      guideMapping[key] = [...arrRaw.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    }

    expect(REMEDIATION_TRACKER_STEP_CHECK_KEYS).toEqual(guideMapping);
  });
});

describe("reverifyRemediationTrackerSteps — the verdict rule", () => {
  it("does nothing when the customer has claimed nothing (empty result set)", async () => {
    mockSelectResultsQueue = [[]];
    await reverifyRemediationTrackerSteps({ customerId: CUSTOMER_ID, runId: RUN_ID, findings: [] });
    expect(mockUpdateSets).toHaveLength(0);
  });

  it("verifies a single-check step when its check ran clean", async () => {
    mockSelectResultsQueue = [[{ stepId: "s1", status: "completed" }]];
    await reverifyRemediationTrackerSteps({
      customerId: CUSTOMER_ID,
      runId: RUN_ID,
      findings: [{ checkKey: "sharepoint:orgwide-links", severity: "ok" }],
    });
    expect(mockUpdateSets).toHaveLength(1);
    expect(mockUpdateSets[0].verificationState).toBe("verified");
    expect(mockUpdateSets[0].verifiedByRunId).toBe(RUN_ID);
    expect(mockUpdateSets[0].verifiedAt).toBeInstanceOf(Date);
  });

  it("drifts a single-check step when its check still fires", async () => {
    mockSelectResultsQueue = [[{ stepId: "s1", status: "already_handled" }]];
    await reverifyRemediationTrackerSteps({
      customerId: CUSTOMER_ID,
      runId: RUN_ID,
      findings: [{ checkKey: "sharepoint:orgwide-links", severity: "critical" }],
    });
    expect(mockUpdateSets[0].verificationState).toBe("drift");
  });

  it("leaves the row untouched when its mapped check did not run this scan", async () => {
    mockSelectResultsQueue = [[{ stepId: "s1", status: "completed" }]];
    await reverifyRemediationTrackerSteps({
      customerId: CUSTOMER_ID,
      runId: RUN_ID,
      findings: [{ checkKey: "identity:mfa-registration", severity: "ok" }], // a different step's check
    });
    expect(mockUpdateSets).toHaveLength(0);
  });

  it("never verifies a multi-check step on partial coverage, even all-clean", async () => {
    // s8 maps to two checks; only one ran this scan.
    mockSelectResultsQueue = [[{ stepId: "s8", status: "completed" }]];
    await reverifyRemediationTrackerSteps({
      customerId: CUSTOMER_ID,
      runId: RUN_ID,
      findings: [{ checkKey: "identity:ca-policy-count", severity: "ok" }],
    });
    expect(mockUpdateSets).toHaveLength(0);
  });

  it("verifies a multi-check step only once every mapped check ran and all are clean", async () => {
    mockSelectResultsQueue = [[{ stepId: "s8", status: "completed" }]];
    await reverifyRemediationTrackerSteps({
      customerId: CUSTOMER_ID,
      runId: RUN_ID,
      findings: [
        { checkKey: "identity:ca-policy-count", severity: "ok" },
        { checkKey: "identity:ca-mfa-coverage", severity: "ok" },
      ],
    });
    expect(mockUpdateSets[0].verificationState).toBe("verified");
  });

  it("drifts a multi-check step on ANY real adverse finding, even with partial coverage", async () => {
    // Only one of s8's two mapped checks ran, and it fired — real evidence of
    // a problem outweighs incomplete coverage.
    mockSelectResultsQueue = [[{ stepId: "s8", status: "completed" }]];
    await reverifyRemediationTrackerSteps({
      customerId: CUSTOMER_ID,
      runId: RUN_ID,
      findings: [{ checkKey: "identity:ca-policy-count", severity: "warning" }],
    });
    expect(mockUpdateSets[0].verificationState).toBe("drift");
  });

  it("is never eligible for a step with no mapped check at all (gap or process-only)", async () => {
    // s18 is a platform-wide measurement gap; s27 is process-only. Neither has
    // a STEP_CHECK_KEYS entry.
    mockSelectResultsQueue = [
      [
        { stepId: "s18", status: "completed" },
        { stepId: "s27", status: "already_handled" },
      ],
    ];
    await reverifyRemediationTrackerSteps({
      customerId: CUSTOMER_ID,
      runId: RUN_ID,
      findings: [{ checkKey: "anything:at-all", severity: "critical" }],
    });
    expect(mockUpdateSets).toHaveLength(0);
  });

  it("swallows a DB failure rather than letting it escape (best-effort, non-fatal)", async () => {
    mockSelectResultsQueue = []; // select() throws on an exhausted queue via the chain's own `then`
    const chain = {
      from: () => chain,
      where: () => chain,
      then: () => {
        throw new Error("simulated DB failure");
      },
    };
    const { db } = await import("@workspace/db");
    (db.select as any).mockImplementationOnce(() => chain);

    await expect(
      reverifyRemediationTrackerSteps({ customerId: CUSTOMER_ID, runId: RUN_ID, findings: [] }),
    ).resolves.toBeUndefined();
  });
});
