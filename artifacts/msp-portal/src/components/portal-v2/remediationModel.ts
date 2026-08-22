/**
 * remediationModel.ts — the Operate → Remediation Tracker derivation, Round Four.
 *
 * TRANSCRIBED from the prototype's rebuilt `rt` IIFE
 * ('Customer Portal Shell.dc.html' 20794-21173): the point scoring, the
 * nine-state resolver, the pillar-live maths, the phase grouping, the state
 * chips, the gate summary, the drift list and the Message Center mapping.
 *
 * ── REAL DATA DRIVES DONE / VERIFIED / ACCEPTED ────────────────────────────
 * The design resolves a task's `doneOf`/`verOf`/`skipOf` from client state with
 * a demo-fixture default. This build keeps the demo defaults OUT and reads those
 * three load-bearing facts from the customer's REAL tracker rows instead — a
 * task's `stepId` (remediationData.ts) into the `RtLiveState` the
 * `useRemediationTracker` hook returns (remediationLive.ts). So:
 *   • whether a task is DONE  ← real `status` ∈ completed/already_handled
 *   • whether it is VERIFIED  ← real `verificationState === 'verified'`
 *   • whether it is ACCEPTED  ← real `status` ∈ not_applicable/deferred
 * and every count that rides on them — the phase progress, the state chips, the
 * pillar confirmed/pending points, the gate — is real, not fixture. That is the
 * connection the rebuild had to keep, and it is threaded through every
 * derivation below.
 *
 * ── SESSION OVERRIDES ARE THE NEW, NOT-YET-WIRED STRUCTURE ──────────────────
 * The Round Four affordances the platform does not persist yet — advancing a
 * CR, releasing a hold, filing evidence, accepting a task, ticking or verifying
 * one — layer as session-only overrides (`RtOverrides`) OVER the real baseline,
 * exactly as the prototype's `this.state.rt*` did. Wiring them to real
 * persistence is the separate data pass; this pass is the shell. An override,
 * where set, wins; where unset the real fact (or the design seed, for CR / hold
 * / evidence) shows through.
 */

import {
  RT_BY_ID,
  RT_CR_STAGES,
  RT_PHASE_NAME,
  RT_PHASES,
  RT_PILLAR_BASE,
  RT_PILLAR_COLOR,
  RT_PILLAR_LABEL,
  RT_PILLAR_ORDER,
  RT_PILLAR_TARGET,
  RT_MESSAGE_CENTER,
  RT_RESCAN,
  RT_SEV_COLOR,
  RT_SEV_WEIGHT,
  RT_STATES,
  RT_TASKS,
  type RemediationTask,
  type RtEvidenceState,
  type RtPhaseKey,
  type RtPillarKey,
  type RtStateKey,
} from "./remediationData";
import {
  RT_ACCEPTED_STATUSES,
  RT_FIXED_STATUSES,
  RT_LIVE_EMPTY,
  rtLiveStep,
  type RtLiveState,
} from "./remediationLive";

/** A runbook run in progress — prototype `this.state.rtExec[id]`. */
export interface RtExec {
  readonly i: number;
  readonly n: number;
  readonly running: boolean;
  readonly done: boolean;
  readonly label: string;
  readonly at: string;
}

export type RtHoldStateKey = "running" | "closing" | "extended" | "released";

/**
 * The session-only overrides layered over the real baseline. Every field
 * defaults to empty; an entry present for a task id wins over the real fact (for
 * done/verified/accepted) or the design seed (for cr/hold/evidence/exec).
 */
export interface RtOverrides {
  readonly ticked: Readonly<Record<string, boolean>>;
  readonly verified: Readonly<Record<string, boolean>>;
  readonly ev: Readonly<Record<string, RtEvidenceState>>;
  readonly cr: Readonly<Record<string, number>>;
  readonly hold: Readonly<Record<string, RtHoldStateKey>>;
  readonly skipped: Readonly<Record<string, boolean>>;
  readonly exec: Readonly<Record<string, RtExec | null>>;
  readonly rescan: Readonly<Record<string, string>>;
}

export const RT_OV_EMPTY: RtOverrides = {
  ticked: {},
  verified: {},
  ev: {},
  cr: {},
  hold: {},
  skipped: {},
  exec: {},
  rescan: {},
};

/** Everything a derivation reads: the real wire state and the session overrides. */
export interface RtCtx {
  readonly live: RtLiveState;
  readonly ov: RtOverrides;
}

export const RT_CTX_EMPTY: RtCtx = { live: RT_LIVE_EMPTY, ov: RT_OV_EMPTY };

// ── The load-bearing facts: real baseline, session override on top ────────────

function realDone(t: RemediationTask, live: RtLiveState): boolean {
  const { status } = rtLiveStep(t.stepId, live);
  return RT_FIXED_STATUSES.has(status);
}
function realVerified(t: RemediationTask, live: RtLiveState): boolean {
  return rtLiveStep(t.stepId, live).verification === "verified";
}
function realAccepted(t: RemediationTask, live: RtLiveState): boolean {
  const { status } = rtLiveStep(t.stepId, live);
  return RT_ACCEPTED_STATUSES.has(status);
}

/** Is the task done? Session tick override wins over the real claim. */
export function rtDoneOf(t: RemediationTask, ctx: RtCtx = RT_CTX_EMPTY): boolean {
  return ctx.ov.ticked[t.id] ?? realDone(t, ctx.live);
}
/** Has a real scan verified it? Only meaningful once done; override wins. */
export function rtVerOf(t: RemediationTask, ctx: RtCtx = RT_CTX_EMPTY): boolean {
  return rtDoneOf(t, ctx) && (ctx.ov.verified[t.id] ?? realVerified(t, ctx.live));
}
/** Accepted as a decision — real not_applicable/deferred, or a session skip. */
export function rtAcceptedOf(t: RemediationTask, ctx: RtCtx = RT_CTX_EMPTY): boolean {
  return ctx.ov.skipped[t.id] ?? realAccepted(t, ctx.live);
}
export function rtCrStageOf(t: RemediationTask, ctx: RtCtx = RT_CTX_EMPTY): number {
  return ctx.ov.cr[t.id] ?? t.crs;
}
export function rtEvStateOf(t: RemediationTask, ctx: RtCtx = RT_CTX_EMPTY): RtEvidenceState {
  return ctx.ov.ev[t.id] ?? t.evst;
}
export function rtHoldStateOf(t: RemediationTask, ctx: RtCtx = RT_CTX_EMPTY): RtHoldStateKey | null {
  return ctx.ov.hold[t.id] ?? (t.hold ? t.hold.state : null);
}
function scoredOf(t: RemediationTask, ctx: RtCtx): boolean {
  return rtDoneOf(t, ctx) && rtEvStateOf(t, ctx) === "approved" && rtVerOf(t, ctx);
}

// ── Severity-weighted points — prototype `pts` (20808-20815) ──────────────────

/** Points per task id: a pillar hits its target when all of it is scored. */
export const RT_POINTS: Readonly<Record<string, number>> = (() => {
  const pts: Record<string, number> = {};
  for (const k of RT_PILLAR_ORDER) {
    const ts = RT_TASKS.filter((t) => t.pl === k);
    const sum = ts.reduce((a, t) => a + RT_SEV_WEIGHT[t.sv], 0);
    const gap = RT_PILLAR_TARGET[k] - RT_PILLAR_BASE[k];
    let acc = 0;
    ts.forEach((t, i) => {
      const p = i === ts.length - 1 ? gap - acc : Math.round((gap * RT_SEV_WEIGHT[t.sv]) / sum);
      pts[t.id] = p;
      acc += p;
    });
  }
  return pts;
})();

// ── The nine-state resolver — prototype `stateOf` (20836-20855) ───────────────

export interface RtStateResult {
  readonly k: RtStateKey;
  readonly next: string;
}

export function rtStateOf(t: RemediationTask, ctx: RtCtx = RT_CTX_EMPTY): RtStateResult {
  if (rtAcceptedOf(t, ctx)) {
    return { k: "accepted", next: "A decision on the record. Reverse it to bring the points back into scope." };
  }
  if (rtDoneOf(t, ctx)) {
    const ev = rtEvStateOf(t, ctx);
    if (ev !== "approved") {
      return {
        k: "evidence",
        next:
          ev === "submitted"
            ? "Evidence submitted, waiting on approval before the task can close."
            : "File the evidence this task owes before it can close.",
      };
    }
    if (!rtVerOf(t, ctx)) {
      return {
        k: "completed",
        next: `Closed. Re-scan to bank the ${RT_POINTS[t.id]} points against ${RT_PILLAR_LABEL[t.pl]}.`,
      };
    }
    return { k: "completed", next: "Closed and verified at scan 14. Monitored for drift from here." };
  }
  const dep = (t.dep ?? []).filter((d) => !rtDoneOf(RT_BY_ID[d], ctx));
  if (dep.length) return { k: "blocked", next: `Waiting on ${RT_BY_ID[dep[0]].t}.` };
  const hs = rtHoldStateOf(t, ctx);
  if (t.hold && hs !== "released") {
    const word = hs === "closing" ? "closing" : hs === "extended" ? "extended" : "running";
    return { k: "held", next: `Hold window ${word}, ${t.hold.left} left. Release, extend or close it early.` };
  }
  if (t.cr) {
    const s = rtCrStageOf(t, ctx);
    if (s < 3) return { k: "wcr", next: `CR at ${RT_CR_STAGES[s]}. Advance it to submit.` };
    if (s < 5) return { k: "wapp", next: `CR submitted, waiting on ${s === 3 ? "approval" : "the execute window"}.` };
    if (s < 7) return { k: "progress", next: "CR approved and executing. Tick the task when the change is made." };
  }
  return { k: "released", next: "Released to you. Tick it when the change has been made." };
}

export function rtStateKeyOf(t: RemediationTask, ctx: RtCtx = RT_CTX_EMPTY): RtStateKey {
  return rtStateOf(t, ctx).k;
}

/** prototype `canTick` (20868). The tick gate: a CR-gated task needs execute (crs≥5). */
export function rtCanTick(t: RemediationTask, ctx: RtCtx = RT_CTX_EMPTY): boolean {
  if (rtDoneOf(t, ctx)) return false;
  const k = rtStateKeyOf(t, ctx);
  if (k === "blocked" || k === "accepted") return false;
  if (t.cr && rtCrStageOf(t, ctx) < 5) return false;
  if (t.hold && rtHoldStateOf(t, ctx) !== "released") return false;
  return true;
}

// ── Pillar-live maths — prototype `pillarLive` (20816-20823) ──────────────────

export interface RtPillarLive {
  readonly base: number;
  readonly now: number;
  readonly pending: number;
  readonly target: number;
}

export function rtPillarLive(k: RtPillarKey, ctx: RtCtx = RT_CTX_EMPTY): RtPillarLive {
  let conf = 0;
  let pend = 0;
  for (const t of RT_TASKS.filter((x) => x.pl === k)) {
    if (rtAcceptedOf(t, ctx)) continue;
    if (scoredOf(t, ctx)) conf += RT_POINTS[t.id];
    else if (rtDoneOf(t, ctx)) pend += RT_POINTS[t.id];
  }
  return { base: RT_PILLAR_BASE[k], now: RT_PILLAR_BASE[k] + conf, pending: pend, target: RT_PILLAR_TARGET[k] };
}

const clampPct = (n: number, span: number) => Math.max(0, Math.min(100, Math.round((n / span) * 100)));

export interface RtPillarCell {
  readonly key: RtPillarKey;
  readonly label: string;
  readonly color: string;
  readonly score: string;
  readonly target: string;
  readonly delta: string;
  readonly deltaPositive: boolean;
  readonly atTarget: boolean;
  readonly pending: string;
  readonly hasPending: boolean;
  readonly confPct: number;
  readonly pendPct: number;
}

export function rtPillarCells(ctx: RtCtx = RT_CTX_EMPTY): readonly RtPillarCell[] {
  return RT_PILLAR_ORDER.map((k) => {
    const l = rtPillarLive(k, ctx);
    const span = l.target - l.base;
    return {
      key: k,
      label: RT_PILLAR_LABEL[k],
      color: RT_PILLAR_COLOR[k],
      score: String(l.now),
      target: `of ${l.target}`,
      delta: l.now > l.base ? `+${l.now - l.base}` : "±0",
      deltaPositive: l.now > l.base,
      atTarget: l.now >= l.target,
      pending: l.pending > 0 ? `+${l.pending} pending` : "",
      hasPending: l.pending > 0,
      confPct: clampPct(l.now - l.base, span),
      pendPct: clampPct(l.pending, span),
    };
  });
}

// ── The gate summary — prototype 21120-21166 ──────────────────────────────────

export interface RtGate {
  readonly base: string;
  readonly now: string;
  readonly target: string;
  readonly nowColor: string;
  readonly pending: string;
  readonly pendingColor: string;
  readonly confPct: number;
  readonly pendPct: number;
  readonly copilotGate: string;
  readonly copilotNote: string;
  readonly copilotOk: boolean;
}

export function rtGate(ctx: RtCtx = RT_CTX_EMPTY): RtGate {
  const avg = (f: (l: RtPillarLive) => number) =>
    Math.round(RT_PILLAR_ORDER.reduce((a, k) => a + f(rtPillarLive(k, ctx)), 0) / RT_PILLAR_ORDER.length);
  const gBase = avg((l) => l.base);
  const gNow = avg((l) => l.now);
  const gTarget = avg((l) => l.target);
  const gPend = avg((l) => l.pending);
  const gw = (n: number) => Math.max(0, Math.min(100, (n / (gTarget - gBase)) * 100));
  return {
    base: String(gBase),
    now: String(gNow),
    target: String(gTarget),
    nowColor: gNow >= 68 ? "#34d399" : gNow > gBase ? "#f8fafc" : "#f87171",
    pending: gPend > 0 ? `+${gPend} pending re-scan` : "nothing pending re-scan",
    pendingColor: gPend > 0 ? "#5eead4" : "#475569",
    confPct: gw(gNow - gBase),
    pendPct: gw(gPend),
    copilotGate: `${Math.max(0, gNow - 2)} of 82`,
    copilotNote: gNow >= 68 ? "clear to deploy Copilot" : "not yet safe to turn Copilot on",
    copilotOk: gNow >= 68,
  };
}

// ── Progress headline — prototype 21156-21157 ─────────────────────────────────

export interface RtHeadline {
  readonly headline: string;
  readonly sub: string;
}

export function rtHeadline(ctx: RtCtx = RT_CTX_EMPTY): RtHeadline {
  const g = rtGate(ctx);
  const completed = RT_TASKS.filter((t) => rtStateKeyOf(t, ctx) === "completed").length;
  return {
    headline: `Tenant score ${g.base} → ${g.now}, ${completed} of ${RT_TASKS.length} tasks completed.`,
    sub: "The whole tenant across seven phases, each task gated by its change request, its hold window and the evidence it owes. Points only move the score once a re-scan proves the change, and drift puts a task back on the board.",
  };
}

// ── State filter chips — prototype `stateChips` (21090-21099) ──────────────────

export interface RtStateChip {
  readonly key: RtStateKey;
  readonly label: string;
  readonly n: string;
  readonly color: string;
  readonly active: boolean;
}

export function rtStateChips(selState: RtStateKey | null, ctx: RtCtx = RT_CTX_EMPTY): readonly RtStateChip[] {
  return (Object.keys(RT_STATES) as RtStateKey[])
    .map((k) => {
      const n = RT_TASKS.filter((t) => rtStateKeyOf(t, ctx) === k).length;
      return { key: k, label: RT_STATES[k].label, n: String(n), color: RT_STATES[k].c, active: selState === k, count: n };
    })
    .filter((c) => c.count > 0)
    .map(({ count: _count, ...rest }) => rest);
}

// ── The row + its expanded detail ─────────────────────────────────────────────

export interface RtChip {
  readonly text: string;
  readonly color: string;
  readonly dashed: boolean;
}
export interface RtDep {
  readonly id: string;
  readonly label: string;
  readonly met: boolean;
}
export interface RtCrStageView {
  readonly label: string;
  readonly n: string;
  readonly done: boolean;
  readonly current: boolean;
}
export interface RtHoldView {
  readonly left: string;
  readonly verdict: string;
  readonly why: string;
  readonly stateLabel: string;
  readonly released: boolean;
}
export interface RtEvidenceView {
  readonly state: RtEvidenceState;
  readonly label: string;
  readonly items: readonly string[];
  readonly canAct: boolean;
  readonly actLabel: string;
}
export interface RtRunbookStep {
  readonly label: string;
  readonly kind: "Graph" | "Manual";
  readonly mark: "done" | "running" | "queued" | "by hand";
  readonly color: string;
  readonly auto: boolean;
  readonly ran: boolean;
  readonly current: boolean;
}
export interface RtRunbookView {
  readonly playbook: string;
  readonly kind: string;
  readonly hasGraph: boolean;
  readonly steps: readonly RtRunbookStep[];
  readonly canRun: boolean;
  readonly blocked: boolean;
  readonly blockedNote: string;
  readonly running: boolean;
  readonly ran: boolean;
  readonly status: string;
  readonly barPct: number;
}

export interface RtRow {
  readonly id: string;
  readonly task: RemediationTask;
  readonly title: string;
  readonly phaseName: string;
  readonly pillarLabel: string;
  readonly stateKey: RtStateKey;
  readonly stateLabel: string;
  readonly stateColor: string;
  readonly next: string;
  readonly done: boolean;
  readonly verified: boolean;
  readonly scored: boolean;
  readonly accepted: boolean;
  readonly canTick: boolean;
  readonly signedOff: boolean;
  readonly boxTitle: string;
  readonly points: number;
  readonly ptsLabel: string;
  readonly ptsSub: string;
  readonly ptsColor: string;
  readonly chips: readonly RtChip[];
  // ── expanded detail ──
  readonly problem: string;
  readonly fix: string;
  readonly deps: readonly RtDep[];
  readonly hasCr: boolean;
  readonly crLabel: string;
  readonly crStage: number;
  readonly crClosed: boolean;
  readonly crStages: readonly RtCrStageView[];
  readonly crCanAdvance: boolean;
  readonly crNextLabel: string;
  readonly hold: RtHoldView | null;
  readonly evidence: RtEvidenceView;
  readonly runbook: RtRunbookView;
  readonly feeLine: string;
  readonly rescanLabel: string;
  readonly rescanVerified: boolean;
  readonly canVerify: boolean;
}

/** prototype `crLabel` (20925): 'CR-0' + (140 + (index % 40)). */
function crLabelFor(t: RemediationTask): string {
  return `CR-0${140 + (RT_TASKS.indexOf(t) % 40)}`;
}

function rescanFor(t: RemediationTask, ctx: RtCtx) {
  const cur = ctx.ov.rescan[t.id] ?? "nightly";
  return RT_RESCAN.find((r) => r.k === cur) ?? RT_RESCAN[0];
}

export function rtRow(t: RemediationTask, ctx: RtCtx = RT_CTX_EMPTY): RtRow {
  const s = rtStateOf(t, ctx);
  const meta = RT_STATES[s.k];
  const done = rtDoneOf(t, ctx);
  const ver = rtVerOf(t, ctx);
  const sc = scoredOf(t, ctx);
  const accepted = rtAcceptedOf(t, ctx);
  const ev = rtEvStateOf(t, ctx);
  const crs = rtCrStageOf(t, ctx);
  const hs = rtHoldStateOf(t, ctx);
  const exec = ctx.ov.exec[t.id] ?? null;
  const canTick = rtCanTick(t, ctx);
  const signedOff = done && (ev === "approved" || ver);
  const pts = RT_POINTS[t.id];

  const chips: RtChip[] = [
    { text: RT_PILLAR_LABEL[t.pl], color: RT_PILLAR_COLOR[t.pl], dashed: false },
    { text: t.sv, color: RT_SEV_COLOR[t.sv], dashed: false },
    { text: `${t.ef} effort`, color: "#94a3b8", dashed: false },
  ];
  if (t.cr) {
    chips.push({
      text: `${crLabelFor(t)} · ${crs === 7 ? "closed" : RT_CR_STAGES[crs]}`,
      color: crs === 7 ? "#34d399" : "#93c5fd",
      dashed: false,
    });
  }
  chips.push({
    text: `Evidence ${ev}`,
    color: ev === "approved" ? "#34d399" : ev === "submitted" ? "#fbbf24" : "#64748b",
    dashed: ev === "missing",
  });
  if (t.hold) chips.push({ text: `Hold ${t.hold.left} of ${t.hold.of}`, color: "#22d3ee", dashed: false });
  if (t.drift) chips.push({ text: `Drift of ${RT_BY_ID[t.drift].t.slice(0, 22)}…`, color: "#f472b6", dashed: false });
  if (t.mc) chips.push({ text: t.mc, color: "#a78bfa", dashed: false });

  const graph = t.gr ?? [];
  const manual = t.mn ?? [];
  const rbSteps: RtRunbookStep[] = [
    ...graph.map((g, i) => ({ g, auto: true, i })),
    ...manual.map((m, i) => ({ g: m, auto: false, i: graph.length + i })),
  ].map((st) => {
    const ran = !!(exec && exec.i >= st.i);
    const current = !!(exec && exec.running && exec.i + 1 === st.i);
    const color = !st.auto ? "#94a3b8" : ran ? "#34d399" : current ? "#5eead4" : "#475569";
    return {
      label: st.g,
      kind: st.auto ? ("Graph" as const) : ("Manual" as const),
      mark: (ran ? "done" : current ? "running" : st.auto ? "queued" : "by hand") as RtRunbookStep["mark"],
      color,
      auto: st.auto,
      ran,
      current,
    };
  });

  const rbBlockedNote =
    t.cr && crs < 5
      ? `Blocked until ${crLabelFor(t)} reaches execute.`
      : t.hold && hs !== "released"
        ? "Blocked until the hold window is released."
        : "Blocked by an outstanding dependency.";

  const rs = rescanFor(t, ctx);

  return {
    id: t.id,
    task: t,
    title: t.t,
    phaseName: RT_PHASE_NAME[t.ph],
    pillarLabel: RT_PILLAR_LABEL[t.pl],
    stateKey: s.k,
    stateLabel: meta.label,
    stateColor: meta.c,
    next: s.next,
    done,
    verified: ver,
    scored: sc,
    accepted,
    canTick,
    signedOff,
    boxTitle: done
      ? signedOff
        ? "Signed off — re-opening needs a recorded reason"
        : "Re-open this task"
      : canTick
        ? "Mark the configuration change made"
        : s.next,
    points: pts,
    ptsLabel: `+${pts}`,
    ptsSub: sc ? "scored" : done ? "pending" : accepted ? "forfeit" : "to claim",
    ptsColor: sc ? "#34d399" : done ? "#5eead4" : accepted ? "#475569" : "#64748b",
    chips,
    problem: t.pr,
    fix: t.fx,
    deps: (t.dep ?? []).map((d) => ({ id: d, label: RT_BY_ID[d].t, met: rtDoneOf(RT_BY_ID[d], ctx) })),
    hasCr: t.cr,
    crLabel: crLabelFor(t),
    crStage: crs,
    crClosed: crs === 7,
    crStages: RT_CR_STAGES.map((label, i) => ({ label, n: String(i + 1), done: i < crs, current: i === crs })),
    crCanAdvance: crs < 7,
    crNextLabel: crs === 7 ? "CR closed, evidence filed" : `Advance to ${crs === 6 ? "closed" : RT_CR_STAGES[crs + 1]}`,
    hold: t.hold
      ? {
          left: `${t.hold.left} left of ${t.hold.of}`,
          verdict: t.hold.verdict,
          why: t.hold.why,
          stateLabel: hs === "released" ? "Released" : hs === "extended" ? "Extended by 24h" : hs === "closing" ? "Closing" : "Running",
          released: hs === "released",
        }
      : null,
    evidence: {
      state: ev,
      label: ev === "approved" ? "Approved and filed" : ev === "submitted" ? "Submitted, waiting on approval" : "Missing",
      items: t.ev ?? [],
      canAct: ev !== "approved",
      actLabel: ev === "missing" ? "File the evidence" : "Approve the evidence",
    },
    runbook: {
      playbook: t.pb,
      kind: graph.length ? `Executable through Graph · ${graph.length} call${graph.length === 1 ? "" : "s"}` : "Manual procedure · no Graph path",
      hasGraph: graph.length > 0,
      steps: rbSteps,
      canRun: graph.length > 0 && !(exec && (exec.running || exec.done)) && canTick,
      blocked: graph.length > 0 && !canTick && !(exec && exec.done),
      blockedNote: rbBlockedNote,
      running: !!(exec && exec.running),
      ran: !!(exec && exec.done),
      status: exec && exec.running ? `Running · ${exec.label}` : exec && exec.done ? `Ran at ${exec.at} · evidence captured, task ticked, awaiting approval` : "",
      barPct: exec ? Math.round((Math.max(0, exec.i + 1) / exec.n) * 100) : 0,
    },
    feeLine: `${t.ef} estimated · ${t.bill === "Retainer" ? "covered by the retainer" : "quoted separately"}`,
    rescanLabel: ver ? "Verified at scan 14" : `Target re-scan · ${rs.label}`,
    rescanVerified: ver,
    canVerify: done && !ver && ev === "approved",
  };
}

// ── Phase grouping — prototype `groups` (21042-21047) ─────────────────────────

export interface RtGroup {
  readonly key: RtPhaseKey;
  readonly n: string;
  readonly name: string;
  readonly due: string;
  readonly progress: string;
  readonly items: readonly RtRow[];
}

export function rtGroups(
  selPhase: RtPhaseKey | null,
  selState: RtStateKey | null,
  ctx: RtCtx = RT_CTX_EMPTY,
): readonly RtGroup[] {
  const visible = RT_TASKS.filter(
    (t) => (!selPhase || t.ph === selPhase) && (!selState || rtStateKeyOf(t, ctx) === selState),
  );
  return RT_PHASES.filter((p) => visible.some((t) => t.ph === p.k)).map((p) => {
    const ts = RT_TASKS.filter((t) => t.ph === p.k);
    const done = ts.filter((t) => rtStateKeyOf(t, ctx) === "completed").length;
    return {
      key: p.k,
      n: p.n,
      name: p.name,
      due: p.due,
      progress: `${done} of ${ts.length} completed`,
      items: visible.filter((t) => t.ph === p.k).map((t) => rtRow(t, ctx)),
    };
  });
}

export interface RtFilterBar {
  readonly filtered: boolean;
  readonly label: string;
}

export function rtFilterBar(
  selPhase: RtPhaseKey | null,
  selState: RtStateKey | null,
  ctx: RtCtx = RT_CTX_EMPTY,
): RtFilterBar {
  const visible = RT_TASKS.filter(
    (t) => (!selPhase || t.ph === selPhase) && (!selState || rtStateKeyOf(t, ctx) === selState),
  );
  const label =
    `Showing ${visible.length} of ${RT_TASKS.length} tasks` +
    (selPhase ? ` · ${RT_PHASE_NAME[selPhase]}` : "") +
    (selState ? ` · ${RT_STATES[selState].label}` : "");
  return { filtered: !!(selPhase || selState), label };
}

// ── Drift + Message Center — prototype 21125-21153 ────────────────────────────

export interface RtDriftItem {
  readonly id: string;
  readonly title: string;
  readonly detected: string;
  readonly origin: string;
  readonly sev: string;
  readonly sevColor: string;
  readonly phase: RtPhaseKey;
}

export function rtDriftItems(): readonly RtDriftItem[] {
  return RT_TASKS.filter((t) => t.drift).map((t) => ({
    id: t.id,
    title: t.t,
    detected: t.pr,
    origin: `Original: ${RT_BY_ID[t.drift as string].t}`,
    sev: t.sv,
    sevColor: RT_SEV_COLOR[t.sv],
    phase: t.ph,
  }));
}

export interface RtMcView {
  readonly id: string;
  readonly title: string;
  readonly when: string;
  readonly impact: string;
  readonly need: string;
  readonly needColor: string;
  readonly taskLabel: string;
  readonly taskId: string;
  readonly taskPhase: RtPhaseKey;
}

export function rtMc(): readonly RtMcView[] {
  return RT_MESSAGE_CENTER.map((m) => ({
    id: m.id,
    title: m.title,
    when: m.when,
    impact: m.impact,
    need: m.need,
    needColor: m.need === "Remediation required" ? "#fbbf24" : "#34d399",
    taskLabel: `In the plan · ${RT_BY_ID[m.task].t}`,
    taskId: m.task,
    taskPhase: RT_BY_ID[m.task].ph,
  }));
}
