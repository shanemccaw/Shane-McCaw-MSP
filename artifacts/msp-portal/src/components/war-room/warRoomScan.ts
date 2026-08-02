/**
 * warRoomScan.ts — #305 (War Room epic #302).
 *
 * Turns the real diagnostics run that `ScanStatusProvider` already streams into
 * the three things the War Room intro renders: the progress bar, the per-pillar
 * row states, and whether a scan is running at all.
 *
 * Before this, all three came from two `setInterval`s in WarRoomLogic.tsx
 * (`simulateScan` advanced the pillar row every 2600ms, `runScan` advanced the
 * progress bar every 1200/2200ms). Nothing here invents progress: every number
 * below is a count of real per-check results off the real
 * `diagnostics-run/:runId/sse` stream, or the real check counters on the
 * `scan-status` poll payload.
 *
 * This lives outside WarRoomLogic.tsx on purpose, the same way warRoomSections.ts
 * (#303) and warRoomQuizCatalog.ts (#306) do: that file is `@ts-nocheck`d to stay
 * diffable against the Claude Design source and is `.tsx`, which Node's type
 * stripping cannot load — so the decisions worth pinning down in a test have to
 * be real exported functions the component calls, not inline logic.
 */

/** One real per-check result off the diagnostics SSE stream (the fields used here). */
export interface WarRoomCheckResult {
  checkKey: string;
  checkLabel?: string;
  status?: string;
  index: number;
  total: number;
}

/** The `active` block of the real scan-status payload (the fields used here). */
export interface WarRoomActiveRun {
  runId: string;
  checksOk: number;
  checksError: number;
  checksLicenseGap: number;
  checksTotal: number;
}

/** The `lastRunSummary` block of the real scan-status payload (the fields used here). */
export interface WarRoomRunSummary {
  runId: string;
  status: string;
  checksTotal: number;
  checksOk: number;
  checksError: number;
  checksLicenseGap: number;
}

/**
 * The seven pillars the intro's row/stack renders, in HERO_PHASE order. The two
 * trailing HERO_PHASE entries (`docs`, `sow`) are deliberately NOT pillars —
 * they are document generation, which no monitoring check produces. They are
 * driven from the real doc-workflow status instead (see `docState` below).
 */
export const WAR_ROOM_PILLAR_KEYS = [
  "governance",
  "licensing",
  "adoption",
  "compliance",
  "health",
  "security",
  "copilot",
] as const;

export type WarRoomPillarKey = (typeof WAR_ROOM_PILLAR_KEYS)[number];

/**
 * Real `monitor_checks.key` domains behind each pillar — the prefix before the
 * colon, which is how every check key in the catalog is namespaced
 * (`identity:mfa-state`, `sharepoint:anonymous-links`, `usage:teams-activity`…).
 *
 * The groupings follow #245's pillar work rather than being invented here:
 * `identity:*` scores under Security (the Security Engine owns identity posture),
 * and `sharepoint:*`/`teams:*` score under Governance (oversharing and sprawl are
 * governance findings). `usage:*` is the real domain behind Adoption — the
 * pillar is named "adoption" but the checks that feed it are usage telemetry.
 *
 * A domain that is genuinely absent here — a check key whose prefix no pillar
 * claims — contributes to overall progress but lights no pillar, rather than
 * being forced into the nearest one.
 */
export const WAR_ROOM_PILLAR_DOMAINS: Record<WarRoomPillarKey, readonly string[]> = {
  governance: ["governance", "sharepoint", "teams"],
  licensing: ["licensing"],
  adoption: ["adoption", "usage"],
  compliance: ["compliance"],
  health: ["health", "device", "devices"],
  security: ["security", "identity"],
  copilot: ["copilot"],
};

/** Reverse index of the above, built once. */
const PILLAR_BY_DOMAIN = new Map<string, WarRoomPillarKey>();
for (const pillar of WAR_ROOM_PILLAR_KEYS) {
  for (const domain of WAR_ROOM_PILLAR_DOMAINS[pillar]) PILLAR_BY_DOMAIN.set(domain, pillar);
}

/** Which pillar a real check key scores under, or null if no pillar claims its domain. */
export function warRoomPillarForCheckKey(checkKey: string | null | undefined): WarRoomPillarKey | null {
  if (!checkKey) return null;
  const domain = String(checkKey).split(":")[0]!.trim().toLowerCase();
  return PILLAR_BY_DOMAIN.get(domain) ?? null;
}

/** What one pillar row shows. Same three states the fake advancement produced. */
export type WarRoomPillarState = "wait" | "live" | "done";

export interface WarRoomScanState {
  /** `idle` = no run to show, `running` = a real run is in flight, `complete` = a real run finished. */
  phase: "idle" | "running" | "complete";
  /** Real checks that have reported, and the run's real check count. */
  checksDone: number;
  checksTotal: number;
  /** Real fraction 0–1. Zero when nothing real is known yet — never a placeholder. */
  pct: number;
  /** Real label of the check currently reporting, for the live status line. */
  currentCheckLabel: string | null;
  /** Real per-pillar state, keyed by pillar. */
  pillars: Record<WarRoomPillarKey, WarRoomPillarState>;
  /** How many pillars have real results and are no longer the live one. */
  pillarsDone: number;
  /** The run all of the above describes. */
  runId: string | null;
}

const IDLE_PILLARS = (): Record<WarRoomPillarKey, WarRoomPillarState> => ({
  governance: "wait",
  licensing: "wait",
  adoption: "wait",
  compliance: "wait",
  health: "wait",
  security: "wait",
  copilot: "wait",
});

export const WAR_ROOM_SCAN_IDLE: WarRoomScanState = {
  phase: "idle",
  checksDone: 0,
  checksTotal: 0,
  pct: 0,
  currentCheckLabel: null,
  pillars: IDLE_PILLARS(),
  pillarsDone: 0,
  runId: null,
};

export interface WarRoomScanInput {
  /** Every per-check result the currently streamed run has delivered (context's `scanCheckResults`). */
  scanCheckResults?: readonly WarRoomCheckResult[] | null;
  /** The run those results belong to (context's `streamedRunId`). */
  streamedRunId?: string | null;
  /** A run this session triggered and that is still held as in-flight (context's `triggeredRunId`). */
  triggeredRunId?: string | null;
  /** The poll's real active-run block. */
  active?: WarRoomActiveRun | null;
  /** The poll's real most-recent-run summary. */
  lastRunSummary?: WarRoomRunSummary | null;
  /**
   * The last per-check results this session actually saw, and the run they came
   * from — held by the caller across the stream closing.
   *
   * The provider empties `scanCheckResults` the moment a run finishes: it
   * releases the held runId, which makes `streamRunId` null, which re-runs the
   * subscribe effect and resets the array. Without retention the pillar row
   * would light up check by check through the whole run and then blank back to
   * all-queued at the exact moment it completed. These are that run's real
   * results, so they are only ever used for the run they belong to — never
   * carried onto a different one.
   */
  retainedResults?: readonly WarRoomCheckResult[] | null;
  retainedRunId?: string | null;
}

/**
 * Real terminal statuses of `msp_diagnostic_runs`, per diagnostics-runner.ts.
 * Kept in step with TERMINAL_RUN_STATUSES in scan-status-context.tsx.
 */
const TERMINAL_RUN_STATUSES = new Set(["completed", "partial", "failed"]);

/**
 * Derive everything the intro renders from one real run.
 *
 * Which run: the streamed one if a stream is attached (it is the only source
 * with per-check granularity, so it is the only one that can light pillars),
 * otherwise the active run from the poll, otherwise the last completed run — so
 * a customer who arrives at the War Room after their real post-consent scan has
 * already finished sees its real result rather than an empty room.
 *
 * How a pillar lights up, and why it is not simply "the next one in order": real
 * checks do not arrive grouped by pillar, so there is no honest way to say a
 * pillar is finished while the run is still going. What IS real is which checks
 * have reported. So a pillar is `live` when the most recent real check result
 * belongs to it, `done` once it has real results and something else is now
 * reporting, and `wait` while it has none. When the run ends, every pillar with
 * real results is `done` and every pillar with none stays `wait` — a package
 * that genuinely contains no compliance checks leaves Compliance queued rather
 * than claiming a score for it.
 */
export function deriveWarRoomScan(input: WarRoomScanInput | null | undefined): WarRoomScanState {
  if (!input) return WAR_ROOM_SCAN_IDLE;

  const results = input.scanCheckResults ?? [];
  const active = input.active ?? null;
  const summary = input.lastRunSummary ?? null;
  const streamedRunId = input.streamedRunId ?? null;
  const triggeredRunId = input.triggeredRunId ?? null;

  const liveStreaming = streamedRunId != null && results.length > 0;

  // A run this session started is in flight until the context releases it; the
  // poll's `active` covers a run started anywhere else (another tab, the
  // post-consent trigger). Either one means "really running".
  const runningNow = triggeredRunId != null || active != null;

  let runId: string | null = null;
  let checksDone = 0;
  let checksTotal = 0;

  if (liveStreaming) {
    runId = streamedRunId;
    // The stream replays cached events on reconnect, so distinct keys — not
    // `results.length` — is the real count of checks that have reported.
    checksDone = new Set(results.map((r) => r.checkKey)).size;
    checksTotal = Math.max(results[results.length - 1]!.total || 0, checksDone);
  } else if (active) {
    runId = active.runId;
    checksDone = active.checksOk + active.checksError + active.checksLicenseGap;
    checksTotal = Math.max(active.checksTotal || 0, checksDone);
  } else if (summary && TERMINAL_RUN_STATUSES.has(summary.status)) {
    runId = summary.runId;
    checksDone = summary.checksOk + summary.checksError + summary.checksLicenseGap;
    checksTotal = Math.max(summary.checksTotal || 0, checksDone);
  } else {
    return WAR_ROOM_SCAN_IDLE;
  }

  const complete = !runningNow;
  const pillars = IDLE_PILLARS();
  let currentCheckLabel: string | null = null;

  // Per-check detail for THIS run: the live stream while it is attached, else the
  // results retained from it — but only if they really are this run's.
  const detail: readonly WarRoomCheckResult[] = liveStreaming
    ? results
    : input.retainedRunId != null && input.retainedRunId === runId
      ? (input.retainedResults ?? [])
      : [];

  if (detail.length > 0) {
    // Walk in arrival order so the LAST result wins the `live` slot.
    let livePillar: WarRoomPillarKey | null = null;
    for (const result of detail) {
      const pillar = warRoomPillarForCheckKey(result.checkKey);
      if (!pillar) continue;
      pillars[pillar] = "done";
      livePillar = pillar;
    }
    const last = detail[detail.length - 1]!;
    currentCheckLabel = last.checkLabel || last.checkKey || null;
    if (!complete && livePillar) pillars[livePillar] = "live";
  }

  const pillarsDone = WAR_ROOM_PILLAR_KEYS.reduce(
    (n, key) => (pillars[key] === "done" ? n + 1 : n),
    0,
  );

  return {
    phase: runningNow ? "running" : "complete",
    checksDone,
    checksTotal,
    pct: checksTotal > 0 ? Math.min(1, checksDone / checksTotal) : 0,
    currentCheckLabel,
    pillars,
    pillarsDone,
    runId,
  };
}

export interface WarRoomTriggerInput {
  /** The real scan state the room is currently rendering. */
  scan?: Pick<WarRoomScanState, "phase"> | null;
  /**
   * True between a trigger request leaving and it settling — the caller's own
   * flag, because nothing about an in-flight POST is on `scan` yet.
   */
  triggerPending?: boolean;
}

/**
 * Whether a real trigger control should actually ask for a run right now (#329).
 *
 * The guard this replaces was `scan.phase !== "idle"`, added by #322 to stop the
 * hero's "Nice to meet you" chip and the prelude footer's "Simulate scan" button
 * — both on screen at once — from each POSTing and inserting a second
 * `msp_diagnostic_runs` row. But `idle` is only ever the state of an account
 * with NO scan history at all: `deriveWarRoomScan` reports `running` while a run
 * is in flight and `complete` for the most recent finished run forever after,
 * and there is no path back to `idle` once real history exists. So on any tenant
 * that has ever been scanned — which is every testbed tenant the trigger exists
 * for — that guard rejected every trigger from the very first render,
 * permanently. Same bug class as #234, where the Telemetry page keyed its
 * phase-advance on `scanComplete`, a value that likewise reflected the tenant's
 * most recent run ever regardless of age.
 *
 * What actually makes a second request wrong is a run being in flight *now*, not
 * the tenant having been scanned before:
 *   - `phase === "running"` covers a run this session started (the context is
 *     still holding its runId) and one started anywhere else — another tab, or
 *     the real post-consent run. Both are already on `scan`.
 *   - `triggerPending` covers the one window `phase` cannot see: between the POST
 *     leaving and its runId reaching the provider, the request exists only in the
 *     caller. This is #234's "did THIS session ask" flag
 *     (`testbedScanTriggeredThisSession`) adapted to the request's own lifetime
 *     rather than the whole session, because the War Room has two live trigger
 *     controls a real session can reach repeatedly, not one debug button.
 *
 * A *finished* run deliberately does not block: once it is over, asking for a
 * fresh one is the entire point of the control.
 *
 * Note this is only about not double-asking. Who is *allowed* to start a run is
 * a separate, server-side question that this never second-guesses:
 * `debug-trigger-scan` is hard-gated to testbed tenants, and the page's own
 * trigger handler does not POST at all for a real customer — their scan is the
 * one that already ran at consent time (#305), which is the run this room is
 * reporting.
 */
export function shouldTriggerWarRoomScan(input?: WarRoomTriggerInput | null): boolean {
  if (!input) return true;
  if (input.triggerPending) return false;
  return (input.scan?.phase ?? "idle") !== "running";
}

/**
 * The two document rows (HERO_PHASE `docs` and `sow`) in the pillar list. No
 * monitoring check produces a document, so these read the real Assessment
 * Document Generation workflow status the scan-status poll already carries.
 * `undefined` (an api-server that does not send the field) and `null` (no run
 * has ever fired) both stay `wait` — neither is evidence of a document.
 */
export function warRoomDocState(
  docWorkflow: { status: string } | null | undefined,
): WarRoomPillarState {
  if (!docWorkflow) return "wait";
  const status = String(docWorkflow.status || "").toLowerCase();
  if (status === "completed" || status === "complete" || status === "success") return "done";
  if (status === "running" || status === "pending" || status === "in_progress") return "live";
  return "wait";
}

/**
 * Per-HERO_PHASE-index states, in the order WarRoomLogic renders them: the seven
 * pillars, then the two document rows.
 */
export function warRoomPhaseStates(
  scan: WarRoomScanState,
  docWorkflow?: { status: string } | null,
): WarRoomPillarState[] {
  const doc = warRoomDocState(docWorkflow);
  return [...WAR_ROOM_PILLAR_KEYS.map((key) => scan.pillars[key]), doc, doc];
}
