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
  shouldTriggerWarRoomScan,
  warRoomPhaseStates,
  warRoomPillarForCheckKey,
  warRoomPlannedPillarCounts,
  warRoomScanningNote,
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

  // Event 3 is sharepoint:* → Governance takes over as live. Security has real
  // results and is no longer the one being read, but `running()` supplies no
  // scan plan, so how many checks Security is still owed is genuinely unknown —
  // it reads `scanning`, not `done` (#340). See the plan-driven tests below for
  // the same moment with the run's real check list in hand.
  const afterSharePoint = running(3);
  assert.equal(afterSharePoint.pillars.governance, "live");
  assert.equal(afterSharePoint.pillars.security, "scanning");
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

// ── The trigger gate (#329) ─────────────────────────────────────────────────
// `triggerScan()` in WarRoomLogic.tsx refused to fire whenever
// `scan.phase !== "idle"`. `idle` is only ever the state of an account that has
// never been scanned at all, so on a testbed tenant with real history — which is
// every testbed tenant, and the only kind of tenant the trigger is reachable for
// — every click of "Nice to meet you — let's get started" was silently dropped,
// from the first render, forever. These replay that exact account state.

/** A real terminal run from earlier: a tenant that has genuinely been scanned. */
const PRIOR_RUN = {
  runId: "run-earlier",
  status: "partial",
  checksTotal: 137,
  checksOk: 121,
  checksError: 9,
  checksLicenseGap: 7,
};

/** What the room derives on first render for an account with prior history. */
const withHistory = () =>
  deriveWarRoomScan({
    scanCheckResults: [],
    streamedRunId: null,
    triggeredRunId: null,
    active: null,
    lastRunSummary: PRIOR_RUN,
  });

test("a testbed account with real prior scan history can still trigger a fresh scan", () => {
  const scan = withHistory();
  // First render, nothing streaming and nothing active: the room is reporting a
  // real run that finished earlier.
  assert.equal(scan.phase, "complete");
  assert.equal(scan.runId, PRIOR_RUN.runId);
  // The old guard's own condition, spelled out — true here, which is exactly why
  // the trigger was dead on this account.
  assert.equal(scan.phase !== "idle", true);
  // The real rule lets the click through.
  assert.equal(shouldTriggerWarRoomScan({ scan, triggerPending: false }), true);
});

test("no state an account with real history can reach ever reads idle again", () => {
  // Which is why keying the guard on `idle` could never re-open once history
  // existed: mid-run it is `running`, and every moment after it is `complete`.
  const midRun = deriveWarRoomScan({
    scanCheckResults: streamed(4),
    streamedRunId: "run-now",
    triggeredRunId: "run-now",
    lastRunSummary: PRIOR_RUN,
  });
  assert.equal(midRun.phase, "running");
  assert.equal(withHistory().phase, "complete");
  // Only a tenant that has genuinely never been scanned reads idle.
  assert.equal(deriveWarRoomScan({ scanCheckResults: [], streamedRunId: null }).phase, "idle");
  assert.equal(shouldTriggerWarRoomScan({ scan: deriveWarRoomScan({}) }), true);
});

test("a run really in flight still blocks a second one (#322)", () => {
  // The run this session started — the context is still holding its runId.
  const mine = deriveWarRoomScan({
    scanCheckResults: streamed(2),
    streamedRunId: "run-now",
    triggeredRunId: "run-now",
  });
  assert.equal(mine.phase, "running");
  assert.equal(shouldTriggerWarRoomScan({ scan: mine }), false);

  // A run started anywhere else — another tab, or the real post-consent run a
  // customer never triggered themselves — arrives on the poll's `active` block
  // with no triggeredRunId at all.
  const elsewhere = deriveWarRoomScan({
    scanCheckResults: [],
    streamedRunId: null,
    triggeredRunId: null,
    active: { runId: "run-consent", checksOk: 12, checksError: 0, checksLicenseGap: 1, checksTotal: 137 },
    lastRunSummary: PRIOR_RUN,
  });
  assert.equal(elsewhere.phase, "running");
  assert.equal(shouldTriggerWarRoomScan({ scan: elsewhere }), false);
});

test("the in-flight request blocks the other control before any run is visible", () => {
  // "Nice to meet you" and the prelude footer's "Simulate scan" are on screen at
  // the same time (#322). Between the first POST leaving and its runId reaching
  // the provider, `scan` still shows the historical run — so `phase` alone
  // cannot dedupe the two, and the caller's own pending flag has to.
  assert.equal(shouldTriggerWarRoomScan({ scan: withHistory(), triggerPending: true }), false);
});

test("the gate re-opens once the run this session started has finished", () => {
  // The whole real sequence, on a testbed account that already had history.
  const before = withHistory();
  assert.equal(shouldTriggerWarRoomScan({ scan: before, triggerPending: false }), true);

  // POST away, nothing on props yet.
  assert.equal(shouldTriggerWarRoomScan({ scan: before, triggerPending: true }), false);

  // The new run is streaming — the pending flag has cleared, `phase` holds it now.
  const live = deriveWarRoomScan({
    scanCheckResults: streamed(3),
    streamedRunId: "run-new",
    triggeredRunId: "run-new",
  });
  assert.equal(shouldTriggerWarRoomScan({ scan: live, triggerPending: false }), false);

  // Run over: the room is reporting a finished run again, and a fresh one can be
  // asked for without reloading the page.
  const finished = deriveWarRoomScan({
    scanCheckResults: [],
    streamedRunId: null,
    triggeredRunId: null,
    active: null,
    lastRunSummary: { ...PRIOR_RUN, runId: "run-new", status: "completed" },
    retainedResults: streamed(RUN.length),
    retainedRunId: "run-new",
  });
  assert.equal(finished.phase, "complete");
  assert.equal(finished.runId, "run-new");
  assert.equal(shouldTriggerWarRoomScan({ scan: finished, triggerPending: false }), true);
});

test("nothing known at all does not block the trigger", () => {
  assert.equal(shouldTriggerWarRoomScan(), true);
  assert.equal(shouldTriggerWarRoomScan(null), true);
  assert.equal(shouldTriggerWarRoomScan({ scan: null }), true);
  assert.equal(shouldTriggerWarRoomScan({ scan: WAR_ROOM_SCAN_IDLE }), true);
});

// ── Per-pillar completion against the run's REAL check plan (#340) ───────────
//
// The bug: the per-run pillar loop wrote `done` the moment ANY single result
// mapped to a pillar. Real results arrive interleaved across pillars, so a
// pillar with several real checks read finished after its first one — and
// #331/#334's honest NO DATA treatment, which is correct for a pillar that
// genuinely finished with no score, fired on pillars still being scanned.
//
// The fix needs a real count of each pillar's checks. That count comes from the
// run's package: `GET /api/portal/scan-plan` returns
// `loadOrderedPackageChecks(packageKey).checks.map(c => c.key)` — the exact list
// `executeMonitoringPackage` iterates and emits one progress event per. The plan
// below is that shape: real catalog check keys, one per event the run will send.

/**
 * A real package plan for the RUN above, plus a THIRD identity check that has
 * not reported yet. Security therefore owns 3 real checks while the stream has
 * delivered 2 — the exact shape that used to declare the pillar finished.
 */
const PLAN = [
  "identity:mfa-state",
  "identity:legacy-auth",
  "identity:ca-policy-count",
  "sharepoint:anonymous-links",
  "teams:orphaned-teams",
  "licensing:sku-usage",
  "compliance:missing-labels",
  "usage:teams-activity",
  "devices:compliance",
  "copilot:readiness",
];

/** The same replay as `running()`, but with the run's real plan in hand. */
const runningWithPlan = (n: number) =>
  deriveWarRoomScan({
    scanCheckResults: streamed(n),
    streamedRunId: "run-1",
    triggeredRunId: "run-1",
    plannedCheckKeys: PLAN,
    plannedRunId: "run-1",
  });

test("planned check counts come from the real plan, per real pillar", () => {
  const counts = warRoomPlannedPillarCounts(PLAN);
  assert.equal(counts.security, 3);     // identity:mfa-state / legacy-auth / ca-policy-count
  assert.equal(counts.governance, 2);   // sharepoint:anonymous-links + teams:orphaned-teams
  assert.equal(counts.licensing, 1);
  assert.equal(counts.compliance, 1);
  assert.equal(counts.adoption, 1);     // usage:teams-activity
  assert.equal(counts.health, 1);       // devices:compliance
  assert.equal(counts.copilot, 1);

  // A planned key no pillar claims is counted nowhere — the same domains the
  // reporting side ignores, so a pillar can never be owed a check that could
  // not have arrived for it.
  const withStray = warRoomPlannedPillarCounts([...PLAN, "exchange:mailbox-audit"]);
  assert.deepEqual(withStray, counts);

  // Duplicates collapse, for the same reason the reporting side counts distinct
  // keys: the stream replays cached events on reconnect.
  assert.deepEqual(warRoomPlannedPillarCounts([...PLAN, ...PLAN]), counts);

  // No plan at all is zeroes — "unknown", handled explicitly everywhere.
  for (const key of WAR_ROOM_PILLAR_KEYS) {
    assert.equal(warRoomPlannedPillarCounts(null)[key], 0);
    assert.equal(warRoomPlannedPillarCounts(undefined)[key], 0);
  }
});

test("THE BUG: one real result no longer finishes a pillar that has more checks", () => {
  // Three events in: Security has really reported 2 of its 3 checks, and
  // Governance is now the one being read. Before #340 Security read `done` here
  // — off its FIRST result, two events earlier.
  const mid = runningWithPlan(3);
  assert.equal(mid.phase, "running");
  assert.equal(mid.pillars.security, "scanning");
  assert.notEqual(mid.pillars.security, "done");
  assert.equal(mid.pillarChecksDone.security, 2);
  assert.equal(mid.pillarChecksTotal.security, 3);
  // Nothing downstream may read it as scanned, either.
  assert.equal(mid.pillarsDone, 0);
  assert.equal(mid.pillarsScanning, 1);
});

test("a pillar resolves to done exactly when its real checks have all reported", () => {
  // Governance owns 2 real checks (sharepoint + teams). Event 4 delivers its
  // second, so from event 5 — the first result belonging to someone else — it is
  // genuinely finished and may show its real score.
  const fourIn = runningWithPlan(4);
  assert.equal(fourIn.pillars.governance, "live", "still the one being read");
  assert.equal(fourIn.pillarChecksDone.governance, 2);

  const fiveIn = runningWithPlan(5);
  assert.equal(fiveIn.pillars.governance, "done");
  assert.equal(fiveIn.pillars.licensing, "live");
  // ...while Security, still owed its third check, stays honestly in progress.
  assert.equal(fiveIn.pillars.security, "scanning");
  assert.equal(fiveIn.pillarsDone, 1);

  // Never scanned pillars are untouched by any of this.
  assert.equal(fiveIn.pillars.copilot, "wait");
});

test("the actively-checked pillar still lights up, plan or no plan (hard constraint)", () => {
  // #340's own constraint: the live/flash behaviour must be exactly what it was.
  // The pillar the run is reading right now is `live` at every point of the run,
  // whether or not its checks are complete, and whether or not a plan exists.
  for (let n = 1; n <= RUN.length; n++) {
    const withPlan = runningWithPlan(n);
    const withoutPlan = running(n);
    const livePillar = warRoomPillarForCheckKey(RUN[n - 1]!.checkKey);
    assert.equal(withPlan.pillars[livePillar!], "live", `event ${n} lights its pillar`);
    assert.equal(withoutPlan.pillars[livePillar!], "live", `event ${n} lights its pillar`);
    // Exactly one pillar is live at a time, in both cases.
    assert.equal(WAR_ROOM_PILLAR_KEYS.filter((k) => withPlan.pillars[k] === "live").length, 1);
    assert.equal(WAR_ROOM_PILLAR_KEYS.filter((k) => withoutPlan.pillars[k] === "live").length, 1);
  }

  // A pillar whose last planned check is the one reporting right now is live,
  // not done — it settles into `done` on the next pillar's first event, which is
  // the same beat the row already animated on.
  assert.equal(runningWithPlan(2).pillarChecksDone.security, 2);
  assert.equal(runningWithPlan(4).pillars.governance, "live");
});

test("no plan means honestly in progress, never prematurely finished", () => {
  // The plan fetch has not landed, or the api-server predates the route. The
  // pillar count is genuinely unknown, so nothing is declared finished — which
  // is the state that must NOT resolve to NO DATA.
  const noPlan = running(5);
  assert.equal(noPlan.pillars.security, "scanning");
  assert.equal(noPlan.pillars.governance, "scanning");
  assert.equal(noPlan.pillarsDone, 0);
  // The unknown total is reported as 0 — "we don't know", and every reader is
  // required to treat it as such rather than as "this pillar has no checks".
  assert.equal(noPlan.pillarChecksTotal.security, 0);
  assert.equal(noPlan.pillarChecksDone.security, 2);
});

test("a plan belonging to a different run is never applied", () => {
  // Same discipline as retained results: a plan from another run would finish
  // pillars against a check list this run never executed.
  const wrongRun = deriveWarRoomScan({
    scanCheckResults: streamed(5),
    streamedRunId: "run-1",
    triggeredRunId: "run-1",
    plannedCheckKeys: PLAN,
    plannedRunId: "run-OTHER",
  });
  assert.equal(wrongRun.pillars.governance, "scanning");
  assert.equal(wrongRun.pillarChecksTotal.governance, 0);

  // And an absent runId on the plan is not a wildcard.
  const noRunId = deriveWarRoomScan({
    scanCheckResults: streamed(5),
    streamedRunId: "run-1",
    triggeredRunId: "run-1",
    plannedCheckKeys: PLAN,
    plannedRunId: null,
  });
  assert.equal(noRunId.pillarChecksTotal.governance, 0);
});

test("when the real run ends, in-progress pillars resolve and empty ones stay queued", () => {
  // Security never got its third check — the run ended first. Whatever it was
  // owed is not coming, so its real results are all there will be: it is done,
  // and only now may it read as a real score or an honest NO DATA.
  const finished = deriveWarRoomScan({
    scanCheckResults: [],
    streamedRunId: null,
    triggeredRunId: null,
    active: null,
    lastRunSummary: {
      runId: "run-1", status: "partial",
      checksTotal: PLAN.length, checksOk: RUN.length, checksError: 0, checksLicenseGap: 0,
    },
    retainedResults: streamed(RUN.length),
    retainedRunId: "run-1",
    plannedCheckKeys: PLAN,
    plannedRunId: "run-1",
  });
  assert.equal(finished.phase, "complete");
  assert.equal(finished.pillars.security, "done");
  assert.equal(finished.pillarChecksDone.security, 2);
  assert.equal(finished.pillarChecksTotal.security, 3);
  assert.equal(finished.pillarsScanning, 0);
  assert.equal(finished.pillarsDone, WAR_ROOM_PILLAR_KEYS.length);

  // A pillar the run genuinely never reported anything for stays queued, and is
  // still never mistaken for a scanned-but-empty one.
  const narrow = deriveWarRoomScan({
    scanCheckResults: [{ checkKey: "identity:mfa-state", checkLabel: "MFA state", index: 1, total: 1 }],
    streamedRunId: "run-3",
    triggeredRunId: null,
    plannedCheckKeys: ["identity:mfa-state"],
    plannedRunId: "run-3",
  });
  assert.equal(narrow.pillars.security, "done");
  assert.equal(narrow.pillars.compliance, "wait");
  assert.equal(narrow.pillarsScanning, 0);
});

test("the scanning line is real, reassuring, and never the no-data language", () => {
  const mid = runningWithPlan(3);
  assert.equal(warRoomScanningNote(mid, "security"), "scanning your tenant · 2 of 3 checks");

  // Unknown plan: the counts are dropped rather than printed as "2 of 0".
  const noPlan = running(3);
  const line = warRoomScanningNote(noPlan, "security");
  assert.equal(line, "scanning your tenant");
  assert.equal(/ of /.test(line), false);

  // Nothing an in-progress pillar says may read as a verdict on it.
  for (const text of [warRoomScanningNote(mid, "security"), warRoomScanningNote(noPlan, "security")]) {
    assert.equal(/no data/i.test(text), false);
    assert.equal(/n\/a/i.test(text), false);
    assert.equal(/fail|error|missing|problem/i.test(text), false);
  }

  // A replayed stream cannot push the reported count past the planned one.
  const replayed = deriveWarRoomScan({
    scanCheckResults: [...streamed(3), ...streamed(3)],
    streamedRunId: "run-1",
    triggeredRunId: "run-1",
    plannedCheckKeys: PLAN,
    plannedRunId: "run-1",
  });
  assert.equal(warRoomScanningNote(replayed, "security"), "scanning your tenant · 2 of 3 checks");
});

test("every pillar is in exactly one honest state at every point of a real run", () => {
  // The four states are exhaustive and mutually exclusive, and — the whole point
  // of #340 — a pillar with real results mid-run is never in the state the
  // NO DATA treatment keys off.
  for (let n = 0; n <= RUN.length; n++) {
    const scan = runningWithPlan(n);
    for (const key of WAR_ROOM_PILLAR_KEYS) {
      const state = scan.pillars[key];
      assert.equal(["wait", "live", "scanning", "done"].includes(state), true);
      if (state === "wait") assert.equal(scan.pillarChecksDone[key], 0);
      if (state === "scanning" || state === "live") assert.equal(scan.phase, "running");
      // `done` mid-run is only ever earned against the real plan.
      if (state === "done" && scan.phase === "running") {
        assert.equal(scan.pillarChecksTotal[key] > 0, true);
        assert.equal(scan.pillarChecksDone[key] >= scan.pillarChecksTotal[key], true);
      }
    }
  }
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
