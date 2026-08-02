/**
 * warRoomScan.test.ts — #305 (War Room epic #302).
 *
 * The issue's verification ask is that the progress bar and the pillar states
 * reflect genuine real-time progress rather than a timer. What that reduces to,
 * once the timers are gone, is: given the real per-check events the diagnostics
 * SSE stream emits, does the intro show the right thing at each point in the run?
 *
 * So these tests replay a real run's event sequence one check at a time and
 * assert what the room would render after each — which is exactly what a timer
 * could never satisfy, because the values here move only when a check reports.
 * The check keys used below are real keys from the monitoring catalog
 * (identity:mfa-state, sharepoint:anonymous-links, usage:teams-activity, …), not
 * invented ones, so the domain→pillar mapping is exercised against the real
 * namespacing.
 *
 * Run with Node's own test runner (msp-portal has no vitest):
 *   pnpm --filter @workspace/msp-portal test
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  WAR_ROOM_PILLAR_KEYS,
  WAR_ROOM_SCAN_IDLE,
  deriveWarRoomScan,
  warRoomDocState,
  warRoomPhaseStates,
  warRoomPillarForCheckKey,
  type WarRoomCheckResult,
} from "./warRoomScan.ts";

/** A real run: nine real check keys across six real domains, in arrival order. */
const RUN: Array<{ checkKey: string; checkLabel: string }> = [
  { checkKey: "identity:mfa-state", checkLabel: "MFA state" },
  { checkKey: "identity:legacy-auth", checkLabel: "Legacy authentication" },
  { checkKey: "sharepoint:anonymous-links", checkLabel: "Anonymous sharing links" },
  { checkKey: "teams:orphaned-teams", checkLabel: "Orphaned teams" },
  { checkKey: "licensing:sku-usage", checkLabel: "SKU usage" },
  { checkKey: "compliance:missing-labels", checkLabel: "Missing sensitivity labels" },
  { checkKey: "usage:teams-activity", checkLabel: "Teams activity" },
  { checkKey: "devices:compliance", checkLabel: "Device compliance" },
  { checkKey: "copilot:readiness", checkLabel: "Copilot readiness" },
];

/** The first `n` events of RUN, shaped like real ScanCheckResults. */
function streamed(n: number): WarRoomCheckResult[] {
  return RUN.slice(0, n).map((c, i) => ({
    checkKey: c.checkKey,
    checkLabel: c.checkLabel,
    status: "ok",
    index: i + 1,
    total: RUN.length,
  }));
}

const running = (n: number) =>
  deriveWarRoomScan({
    scanCheckResults: streamed(n),
    streamedRunId: "run-1",
    triggeredRunId: "run-1",
  });

test("check-key domains map onto the real pillars", () => {
  assert.equal(warRoomPillarForCheckKey("identity:mfa-state"), "security");
  assert.equal(warRoomPillarForCheckKey("security:secure-score"), "security");
  assert.equal(warRoomPillarForCheckKey("sharepoint:anonymous-links"), "governance");
  assert.equal(warRoomPillarForCheckKey("teams:channel-sprawl"), "governance");
  assert.equal(warRoomPillarForCheckKey("governance:oversharing"), "governance");
  assert.equal(warRoomPillarForCheckKey("usage:teams-activity"), "adoption");
  assert.equal(warRoomPillarForCheckKey("adoption:no-owners"), "adoption");
  assert.equal(warRoomPillarForCheckKey("licensing:sku-usage"), "licensing");
  assert.equal(warRoomPillarForCheckKey("compliance:dlp-incidents"), "compliance");
  assert.equal(warRoomPillarForCheckKey("devices:compliance"), "health");
  assert.equal(warRoomPillarForCheckKey("copilot:readiness"), "copilot");
});

test("a domain no pillar claims lights no pillar, rather than the nearest one", () => {
  assert.equal(warRoomPillarForCheckKey("exchange:mailbox-audit"), null);
  assert.equal(warRoomPillarForCheckKey(""), null);
  assert.equal(warRoomPillarForCheckKey(null), null);

  const scan = deriveWarRoomScan({
    scanCheckResults: [
      { checkKey: "exchange:mailbox-audit", checkLabel: "Mailbox audit", index: 1, total: 2 },
      { checkKey: "identity:mfa-state", checkLabel: "MFA state", index: 2, total: 2 },
    ],
    streamedRunId: "run-x",
    triggeredRunId: "run-x",
  });
  // Both checks count toward real progress...
  assert.equal(scan.checksDone, 2);
  assert.equal(scan.pct, 1);
  // ...but only the one with a claimed domain lights a pillar.
  assert.equal(scan.pillarsDone + (scan.pillars.security === "live" ? 1 : 0), 1);
});

test("nothing real known yet reads as idle, with no invented progress", () => {
  assert.deepEqual(deriveWarRoomScan(null), WAR_ROOM_SCAN_IDLE);
  assert.deepEqual(deriveWarRoomScan({}), WAR_ROOM_SCAN_IDLE);

  const idle = deriveWarRoomScan({ scanCheckResults: [], streamedRunId: null });
  assert.equal(idle.phase, "idle");
  assert.equal(idle.pct, 0);
  assert.equal(idle.pillarsDone, 0);
  for (const key of WAR_ROOM_PILLAR_KEYS) assert.equal(idle.pillars[key], "wait");
});

test("the progress bar advances on every real check, not in pillar-sized jumps", () => {
  // Nine real checks over six domains: if the bar were pillar-driven it could
  // only ever show six distinct values. Each check must move it.
  const seen = new Set<number>();
  for (let n = 1; n <= RUN.length; n++) {
    const scan = running(n);
    assert.equal(scan.checksDone, n);
    assert.equal(scan.checksTotal, RUN.length);
    assert.equal(scan.pct, n / RUN.length);
    seen.add(scan.pct);
  }
  assert.equal(seen.size, RUN.length, "every real check produced a distinct bar position");
});

test("the live pillar follows the check that is actually reporting", () => {
  // Event 1 is identity:* → Security is live and nothing is done yet.
  const afterMfa = running(1);
  assert.equal(afterMfa.pillars.security, "live");
  assert.equal(afterMfa.pillarsDone, 0);
  assert.equal(afterMfa.currentCheckLabel, "MFA state");

  // Event 3 is sharepoint:* → Governance takes over as live, Security is done.
  const afterSharePoint = running(3);
  assert.equal(afterSharePoint.pillars.governance, "live");
  assert.equal(afterSharePoint.pillars.security, "done");
  assert.equal(afterSharePoint.currentCheckLabel, "Anonymous sharing links");

  // Pillars no check has reached yet are still waiting — never pre-lit.
  assert.equal(afterSharePoint.pillars.licensing, "wait");
  assert.equal(afterSharePoint.pillars.compliance, "wait");
  assert.equal(afterSharePoint.pillars.copilot, "wait");
});

test("pillars light in real arrival order, which is not HERO_PHASE order", () => {
  // The fake advancement walked governance→licensing→adoption→…; the real run
  // above reaches Security first. This is the assertion a timer cannot pass.
  const order: string[] = [];
  for (let n = 1; n <= RUN.length; n++) {
    const live = WAR_ROOM_PILLAR_KEYS.find((k) => running(n).pillars[k] === "live");
    if (live && order[order.length - 1] !== live) order.push(live);
  }
  assert.deepEqual(order, ["security", "governance", "licensing", "compliance", "adoption", "health", "copilot"]);
});

test("a finished run scores every pillar it really covered, and no others", () => {
  // Same nine results, but the run is over: nothing is held, nothing is active.
  const done = deriveWarRoomScan({
    scanCheckResults: streamed(RUN.length),
    streamedRunId: "run-1",
    triggeredRunId: null,
    active: null,
  });
  assert.equal(done.phase, "complete");
  assert.equal(done.pct, 1);
  assert.equal(done.pillarsDone, WAR_ROOM_PILLAR_KEYS.length);
  for (const key of WAR_ROOM_PILLAR_KEYS) assert.equal(done.pillars[key], "done");

  // A package with genuinely no compliance check leaves Compliance queued
  // rather than claiming a score for it.
  const partial = deriveWarRoomScan({
    scanCheckResults: [{ checkKey: "identity:mfa-state", checkLabel: "MFA state", index: 1, total: 1 }],
    streamedRunId: "run-2",
    triggeredRunId: null,
  });
  assert.equal(partial.phase, "complete");
  assert.equal(partial.pillars.security, "done");
  assert.equal(partial.pillars.compliance, "wait");
  assert.equal(partial.pillarsDone, 1);
});

test("a replayed stream does not double-count checks", () => {
  // The SSE stream replays cached events on reconnect, so the same check key can
  // arrive twice. Real progress must not exceed the run's real check count.
  const replayed = deriveWarRoomScan({
    scanCheckResults: [...streamed(3), ...streamed(3)],
    streamedRunId: "run-1",
    triggeredRunId: "run-1",
  });
  assert.equal(replayed.checksDone, 3);
  assert.equal(replayed.pct, 3 / RUN.length);
});

test("without a stream, progress comes from the real poll counters", () => {
  const fromActive = deriveWarRoomScan({
    scanCheckResults: [],
    streamedRunId: null,
    triggeredRunId: "run-9",
    active: { runId: "run-9", checksOk: 4, checksError: 1, checksLicenseGap: 1, checksTotal: 12 },
  });
  assert.equal(fromActive.phase, "running");
  assert.equal(fromActive.checksDone, 6);
  assert.equal(fromActive.pct, 0.5);
  assert.equal(fromActive.runId, "run-9");
  // No per-check granularity means no pillar can honestly be lit.
  assert.equal(fromActive.pillarsDone, 0);
});

test("a customer arriving after their real post-consent scan sees that run", () => {
  const after = deriveWarRoomScan({
    scanCheckResults: [],
    streamedRunId: null,
    triggeredRunId: null,
    active: null,
    lastRunSummary: {
      runId: "run-consent",
      status: "completed",
      checksTotal: 10,
      checksOk: 9,
      checksError: 1,
      checksLicenseGap: 0,
    },
  });
  assert.equal(after.phase, "complete");
  assert.equal(after.runId, "run-consent");
  assert.equal(after.pct, 1);

  // A run that never reached a terminal status is not reported as a result.
  const stillGoing = deriveWarRoomScan({
    lastRunSummary: {
      runId: "run-half", status: "running",
      checksTotal: 10, checksOk: 2, checksError: 0, checksLicenseGap: 0,
    },
  });
  assert.equal(stillGoing.phase, "idle");
});

test("pillars survive the stream closing at the end of a run", () => {
  // The provider empties scanCheckResults the instant a run finishes (it releases
  // the held runId, which tears the subscription down). Without retention the row
  // would blank back to all-queued at the exact moment the scan completed.
  const summary = {
    runId: "run-1", status: "completed",
    checksTotal: RUN.length, checksOk: RUN.length, checksError: 0, checksLicenseGap: 0,
  };
  const after = deriveWarRoomScan({
    scanCheckResults: [],           // wiped by the provider
    streamedRunId: null,            // stream detached
    triggeredRunId: null,
    active: null,
    lastRunSummary: summary,
    retainedResults: streamed(RUN.length),
    retainedRunId: "run-1",
  });
  assert.equal(after.phase, "complete");
  assert.equal(after.pct, 1);
  assert.equal(after.pillarsDone, WAR_ROOM_PILLAR_KEYS.length);
  for (const key of WAR_ROOM_PILLAR_KEYS) assert.equal(after.pillars[key], "done");

  // Retained results from a DIFFERENT run are never borrowed.
  const other = deriveWarRoomScan({
    scanCheckResults: [],
    streamedRunId: null,
    triggeredRunId: null,
    lastRunSummary: { ...summary, runId: "run-2" },
    retainedResults: streamed(RUN.length),
    retainedRunId: "run-1",
  });
  assert.equal(other.runId, "run-2");
  assert.equal(other.pillarsDone, 0);
  for (const key of WAR_ROOM_PILLAR_KEYS) assert.equal(other.pillars[key], "wait");
});

test("a live stream outranks retained results for the same run", () => {
  const live = deriveWarRoomScan({
    scanCheckResults: streamed(2),
    streamedRunId: "run-1",
    triggeredRunId: "run-1",
    retainedResults: streamed(RUN.length), // stale, from later in a prior render
    retainedRunId: "run-1",
  });
  assert.equal(live.checksDone, 2);
  assert.equal(live.pillars.security, "live");
  assert.equal(live.pillars.copilot, "wait");
});

test("document rows read the real doc workflow, never the scan", () => {
  assert.equal(warRoomDocState(null), "wait");
  assert.equal(warRoomDocState(undefined), "wait");
  assert.equal(warRoomDocState({ status: "running" }), "live");
  assert.equal(warRoomDocState({ status: "completed" }), "done");
  assert.equal(warRoomDocState({ status: "failed" }), "wait");

  // A fully scored scan does not by itself claim any document exists.
  const scan = deriveWarRoomScan({
    scanCheckResults: streamed(RUN.length),
    streamedRunId: "run-1",
    triggeredRunId: null,
  });
  const states = warRoomPhaseStates(scan, null);
  assert.equal(states.length, WAR_ROOM_PILLAR_KEYS.length + 2);
  assert.deepEqual(states.slice(-2), ["wait", "wait"]);

  const withDocs = warRoomPhaseStates(scan, { status: "completed" });
  assert.deepEqual(withDocs.slice(-2), ["done", "done"]);
});

test("phase states line up with the order the intro renders them", () => {
  const scan = running(3);
  const states = warRoomPhaseStates(scan, null);
  // HERO_PHASE order: governance, licensing, adoption, compliance, health,
  // security, copilot, docs, sow.
  assert.equal(states[0], scan.pillars.governance);
  assert.equal(states[1], scan.pillars.licensing);
  assert.equal(states[2], scan.pillars.adoption);
  assert.equal(states[3], scan.pillars.compliance);
  assert.equal(states[4], scan.pillars.health);
  assert.equal(states[5], scan.pillars.security);
  assert.equal(states[6], scan.pillars.copilot);
});
