/**
 * portal-v2-remediation.tsx — Operate → Remediation Tracker (Round Four shell).
 *
 * A port of the prototype's rebuilt `isRemediation` block
 * ('Customer Portal Shell.dc.html' 5961-6228) and its `rt` derivation
 * (20678-21173), transcribed into remediationData.ts / remediationModel.ts.
 *
 * ── What this page argues ──────────────────────────────────────────────────
 * The whole tenant across seven phases, each task gated by its change request,
 * its hold window and the evidence it owes. Points only move the score once a
 * re-scan proves the change; drift puts a completed task back on the board. The
 * phases live in the LEFT NAV (portalV2Nav.ts), not the page body — clicking one
 * filters this list to it.
 *
 * ── REAL DATA SURVIVES THE REBUILD — THE LOAD-BEARING GUARANTEE ─────────────
 * This page is wired to REAL data and STAYS wired to it. `useRemediationTracker`
 * is imported and used below; its `statuses`/`verification` maps become the
 * `RtLiveState` that every derivation reads. Whether a task is DONE, VERIFIED or
 * ACCEPTED — and therefore the phase progress, the state chips, the pillar
 * confirmed/pending points and the tenant gate — comes off that hook, per task,
 * through each task's `stepId` (remediationData.ts → remediationLive.ts). Only
 * `reverifyRemediationTrackerSteps()` inside a real scan can mark a step
 * verified; this page never derives verified from a tick or a filter.
 *
 * ── WHAT IS SESSION-ONLY IN THIS SHELL PASS (Git #1476 audit) ──────────────
 * Advancing a CR stage, releasing/closing a hold and filing/approving evidence
 * are SESSION-ONLY — no backend models a per-task CR-stage pipeline, hold
 * window or evidence set for THIS catalogue (see remediationData.ts's header;
 * each spot is marked `NO-BACKEND-TO-WIRE` below). Re-scanning ("run the check
 * now") is also session-only: only a real scan's own
 * reverifyRemediationTrackerSteps() may produce `verified`, and no
 * trigger-a-scan-now endpoint exists for this page to call.
 *
 * Ticking/re-opening/rolling back a task, accepting it, handing it to Shane,
 * and a runbook's completion DO now write real status through
 * `useRemediationTracker`'s `toggleComplete`/`setAction` (Git #1476 — these
 * were previously session-only too, despite the hook being imported and read
 * from: the mutators existed but nothing on this page ever called them, so a
 * "completed" task here silently reverted on reload). `RtOverrides` remains
 * the optimistic paint layer for all of the above — it still wins in the UI
 * the instant a button is clicked — but the ticking/accept/hand-off/rollback
 * fields on it now have a real write riding alongside, for any task whose
 * `stepId` is non-null. The filter state (phase from the URL, task state, open
 * row) is client UI only, same as the prototype.
 */

import { useCallback, useMemo, useState } from "react";
import { useLocation, useRoute } from "wouter";

import { useRemediationTracker } from "@/components/copilot-journey/useRemediationTracker";
import { useRemediationPillarScores } from "@/components/portal-v2/useRemediationPillarScores";
import { useFormDrawer } from "@/components/portal-v2/FormDrawer";
import { PortalV2Shell, SIDEBAR_WASH } from "@/components/portal-v2/PortalV2Shell";
import {
  RT_PHASES,
  type RtEvidenceState,
  type RtPhaseKey,
  type RtStateKey,
} from "@/components/portal-v2/remediationData";
import type { RtLiveState } from "@/components/portal-v2/remediationLive";
import type { RtLiveScores } from "@/components/portal-v2/remediationScores";
import {
  RT_OV_EMPTY,
  rtDriftItems,
  rtGate,
  rtGroups,
  rtFilterBar,
  rtHeadline,
  rtMc,
  rtPillarCells,
  rtStateChips,
  rtRow,
  type RtChip,
  type RtCtx,
  type RtExec,
  type RtHoldStateKey,
  type RtOverrides,
  type RtRow,
} from "@/components/portal-v2/remediationModel";

const MONO = "'SF Mono',Menlo,Consolas,monospace";

const PHASE_KEYS = new Set<string>(RT_PHASES.map((p) => p.k));

/** A small check glyph for the ticked box — prototype iconSvg('check-sm'). */
function CheckSm({ color }: { color: string }) {
  return (
    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

export default function PortalV2RemediationPage() {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/portal-v2/remediation/:phase");
  const selPhase: RtPhaseKey | null =
    params?.phase && PHASE_KEYS.has(params.phase) ? (params.phase as RtPhaseKey) : null;

  // ── The REAL tracker rows — the same store the Full Remediation Guide writes.
  // This hook is the load-bearing real-data connection the rebuild had to keep.
  const tracker = useRemediationTracker();
  const live: RtLiveState = useMemo(
    () => ({ statuses: tracker.statuses, verification: tracker.verification }),
    [tracker.statuses, tracker.verification],
  );

  // ── The REAL per-pillar scores (Git #1381) — rolling before/now, permanent
  // day-one baseline and the real Copilot gate. Replaces the fixture headline.
  const pillarScores = useRemediationPillarScores();
  const scores: RtLiveScores = useMemo(
    () => ({
      pillars: pillarScores.pillars,
      copilotGate: pillarScores.copilotGate,
      taskPoints: pillarScores.taskPoints,
      loaded: pillarScores.loaded,
    }),
    [pillarScores.pillars, pillarScores.copilotGate, pillarScores.taskPoints, pillarScores.loaded],
  );

  // Session-only overrides for the not-yet-persisted Round Four structure.
  const [ov, setOv] = useState<RtOverrides>(RT_OV_EMPTY);
  const [selState, setSelState] = useState<RtStateKey | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const ctx: RtCtx = useMemo(() => ({ live, ov, scores }), [live, ov, scores]);
  const { openForm, formElement } = useFormDrawer();

  const headline = useMemo(() => rtHeadline(ctx), [ctx]);
  const gate = useMemo(() => rtGate(ctx), [ctx]);
  const pillarCells = useMemo(() => rtPillarCells(ctx), [ctx]);
  const chips = useMemo(() => rtStateChips(selState, ctx), [selState, ctx]);
  const groups = useMemo(() => rtGroups(selPhase, selState, ctx), [selPhase, selState, ctx]);
  const bar = useMemo(() => rtFilterBar(selPhase, selState, ctx), [selPhase, selState, ctx]);
  const drift = useMemo(() => rtDriftItems(), []);
  const mc = useMemo(() => rtMc(), []);

  // ── Session-override setters ────────────────────────────────────────────────
  const patch = useCallback(
    <K extends keyof RtOverrides>(key: K, id: string, val: RtOverrides[K][string]) =>
      setOv((o) => ({ ...o, [key]: { ...o[key], [id]: val } })),
    [],
  );

  const toggleState = (k: RtStateKey) => {
    setSelState((s) => (s === k ? null : k));
    setOpen(null);
  };
  const clearFilters = () => {
    setSelState(null);
    navigate("/portal-v2/remediation");
  };
  const toggleOpen = (id: string) => setOpen((o) => (o === id ? null : id));

  const reopenForm = (row: RtRow) =>
    openForm({
      kicker: "Re-open a signed-off task",
      title: "Why is this being re-opened?",
      intro: `${row.title}. The evidence is approved${row.verified ? " and a re-scan verified it at scan 14" : ""}, so re-opening it withdraws ${row.points} points from ${row.pillarLabel} and puts the reason on the record against the CR.`,
      submitLabel: "Re-open the task",
      fields: [
        {
          id: "reason",
          label: "Reason",
          kind: "select",
          value: "The change was reversed in the tenant",
          options: [
            "The change was reversed in the tenant",
            "The evidence does not prove the fix",
            "Approved in error",
            "Scope changed",
          ].map((o) => ({ value: o, label: o })),
        },
        { id: "detail", label: "What happened", kind: "textarea", wide: true, placeholder: "What has changed since sign-off." },
      ],
      onSubmit: () => {
        setOv((o) => ({
          ...o,
          ticked: { ...o.ticked, [row.id]: false },
          verified: { ...o.verified, [row.id]: false },
          ev: { ...o.ev, [row.id]: "missing" as RtEvidenceState },
          exec: { ...o.exec, [row.id]: null },
        }));
        // Real write-back (Git #1476): the same customer-scoped status this
        // task's stepId resolves to elsewhere (the Full Remediation Guide) —
        // re-opening here must not leave that guide still showing it complete.
        if (row.task.stepId) tracker.setAction(row.task.stepId, "not_started");
      },
      doneNote: "Re-opened. The points are withdrawn, the evidence is marked missing again, and the reason is filed against the change request.",
    });

  const tick = (row: RtRow) => {
    if (row.done) {
      if (row.signedOff) reopenForm(row);
      else {
        patch("ticked", row.id, false);
        if (row.task.stepId) tracker.setAction(row.task.stepId, "not_started");
      }
      return;
    }
    if (!row.canTick) {
      setOpen(row.id);
      return;
    }
    patch("ticked", row.id, true);
    // Real write-back (Git #1476): previously this only ever painted the
    // session override — a genuinely real mutator (useRemediationTracker,
    // GET/PUT /api/portal/remediation-tracker) was imported and read from but
    // never called, so a completed task here never actually reached the
    // server and reverted on reload despite the page's own header claiming
    // full real-data wiring. Tasks with no platform step (stepId === null —
    // the three Discovery reads, the two removed adoption items, the drift
    // re-close) have nowhere real to write and stay session-only, honestly.
    if (row.task.stepId) tracker.toggleComplete(row.task.stepId);
  };

  // NO-BACKEND-TO-WIRE (Git #1476): no table models a per-task CR-stage
  // pipeline for this catalogue (see remediationData.ts's header) — advancing
  // a stage is session-only.
  const crAdvance = (row: RtRow) => patch("cr", row.id, Math.min(7, row.crStage + 1));

  // NO-BACKEND-TO-WIRE (Git #1476): `portal_hold_windows` is real schema, but
  // backs the Active Runbooks page, not this catalogue's `hold` seed (see
  // remediationData.ts's header) — closing a hold here is session-only.
  const holdClose = (row: RtRow) =>
    openForm({
      kicker: "Hold window · close early",
      title: "Close the hold early",
      intro: `${row.title}. The window still has ${row.hold?.left ?? ""} to run. ${row.hold?.verdict ?? ""}, so closing early is defensible — the reason is recorded against the CR.`,
      submitLabel: "Close the window",
      fields: [{ id: "why", label: "Why it is safe to close now", kind: "textarea", wide: true, value: "Scan 14 came back clear and no dependent change is outstanding." }],
      onSubmit: () => patch("hold", row.id, "released" as RtHoldStateKey),
      doneNote: "Window closed. The gated step is released and the reason is filed against the CR.",
    });

  // NO-BACKEND-TO-WIRE (Git #1476): no evidence table exists for this
  // catalogue — filing/approving evidence is session-only.
  const evAct = (row: RtRow) => {
    if (row.evidence.state === "missing") {
      openForm({
        kicker: `Evidence · ${row.title.slice(0, 40)}`,
        title: "File the evidence for this task",
        intro: `Every completed task owes evidence: ${row.evidence.items.join(", ")}. Filed evidence lands in the Document Library against this task and its CR.`,
        submitLabel: "File it",
        fields: [
          {
            id: "method",
            label: "How",
            kind: "select",
            value: "Collect automatically through Graph",
            options: ["Collect automatically through Graph", "Attach a PowerShell transcript", "Upload screenshots and notes"].map((o) => ({ value: o, label: o })),
          },
          { id: "approver", label: "Approver", kind: "text", value: "jordan.diaz@tenant.com", placeholder: "name@tenant.com" },
        ],
        onSubmit: () => patch("ev", row.id, "submitted" as RtEvidenceState),
        doneNote: "Filed. The task stays at Waiting for Evidence until the approver signs it off.",
      });
    } else {
      patch("ev", row.id, "approved" as RtEvidenceState);
    }
  };

  const verify = (row: RtRow) =>
    openForm({
      kicker: "Remediation tracker · re-scan",
      title: "Re-scan and re-score",
      intro: `${row.title}. This re-runs the check that produced the finding and re-scores ${row.pillarLabel} on the result. The ${row.points} points stay pending until it passes.`,
      submitLabel: "Run the check now",
      fields: [
        { id: "scope", label: "Scope", kind: "select", value: "This check only", options: ["This check only", "This check and its pillar", "Full tenant scan"].map((o) => ({ value: o, label: o })) },
        { id: "notify", label: "Tell me the result", kind: "select", value: "Portal and email", options: ["Portal only", "Portal and email", "Portal, email and the webhook"].map((o) => ({ value: o, label: o })) },
      ],
      // NO-BACKEND-TO-WIRE (Git #1476): there is no real "trigger a re-scan
      // now" endpoint. remediationLive.ts's own header is explicit that only
      // the server's reverifyRemediationTrackerSteps(), fired from inside a
      // REAL scan, may ever produce `verified` — "nothing in this module...
      // may promote a step to verified from a status, a tick, a filter or any
      // other UI state." This form submit does exactly that today (a session
      // override, not a real scan) — a real "run this check now" action needs
      // a real synchronous re-scan endpoint, which does not exist. Left
      // session-only rather than building that endpoint under this issue.
      onSubmit: () => patch("verified", row.id, true),
      doneNote: `Check passed. ${row.pillarLabel} moves +${row.points}, and those points are scored rather than pending.`,
    });

  const handToShane = (row: RtRow) =>
    openForm({
      kicker: `Remediation tracker · ${row.task.sv}`,
      title: "Hand this task to Shane",
      intro: `${row.title}. ${row.problem} Handing it over raises the CR against ${row.phaseName}, so the fee and the dates stay on one document.`,
      submitLabel: "Hand it over",
      fields: [
        { id: "window", label: "Preferred change window", kind: "select", value: "Next available", options: ["Next available", "Out of hours only", "Weekend only", "Agree on a call"].map((o) => ({ value: o, label: o })) },
        { id: "approver", label: "Who approves the change", kind: "text", value: "jordan.diaz@tenant.com", placeholder: "name@tenant.com" },
      ],
      // Real write-back (Git #1476): "shane_handles" is a real status in the
      // wire vocabulary (REMEDIATION_TRACKER_STEP_STATUS) — this hand-off
      // previously changed no state at all, real or session. The CR/Active
      // Runbooks appearance the doneNote promises is still NO-BACKEND-TO-WIRE
      // (no CR is actually raised, no runbook actually created) — only the
      // step's own status is real.
      onSubmit: () => {
        if (row.task.stepId) tracker.setAction(row.task.stepId, "shane_handles");
      },
      doneNote: "Handed over. It appears in Change Control as a CR and in Active Runbooks once the window is approved.",
    });

  const cycleRescan = (row: RtRow) => {
    if (row.rescanVerified) return;
    setOv((o) => {
      const order = ["nightly", "weekly", "window"];
      const cur = o.rescan[row.id] ?? "nightly";
      const next = order[(order.indexOf(cur) + 1) % order.length];
      return { ...o, rescan: { ...o.rescan, [row.id]: next } };
    });
  };

  /**
   * The stepped runbook run — prototype rtRunbook (shell 8547-8564).
   * NO-BACKEND-TO-WIRE (Git #1476): the step-by-step "Calling GET /sites..."
   * animation is a timed simulation, not a real call — no backend executes
   * `task.gr`'s Graph calls on this page's behalf. What its completion marks
   * done IS real (below): the underlying task's stepId, if it has one.
   */
  const runRunbook = (row: RtRow) => {
    const labels = (row.task.gr ?? []).map((g) => `Calling ${g}`);
    const n = labels.length;
    if (n === 0) return;
    setOv((o) => ({ ...o, exec: { ...o.exec, [row.id]: { i: 0, n, running: true, done: false, label: labels[0], at: "" } as RtExec } }));
    let i = 0;
    const step = () => {
      if (i >= n - 1) {
        setOv((o) => ({
          ...o,
          exec: { ...o.exec, [row.id]: { i: n - 1, n, running: false, done: true, label: labels[n - 1], at: "09:12" } as RtExec },
          ticked: { ...o.ticked, [row.id]: true },
          ev: { ...o.ev, [row.id]: "submitted" as RtEvidenceState },
        }));
        // Real write-back (Git #1476) — same reasoning as tick().
        if (row.task.stepId) tracker.setAction(row.task.stepId, "completed");
        return;
      }
      i += 1;
      setOv((o) => ({ ...o, exec: { ...o.exec, [row.id]: { i, n, running: true, done: false, label: labels[i], at: "" } as RtExec } }));
      window.setTimeout(step, 620);
    };
    window.setTimeout(step, 620);
  };

  const rollback = (row: RtRow) => {
    setOv((o) => ({
      ...o,
      exec: { ...o.exec, [row.id]: null },
      ticked: { ...o.ticked, [row.id]: false },
      verified: { ...o.verified, [row.id]: false },
      ev: { ...o.ev, [row.id]: "missing" as RtEvidenceState },
    }));
    // Real write-back (Git #1476) — same reasoning as reopenForm's onSubmit.
    if (row.task.stepId) tracker.setAction(row.task.stepId, "not_started");
  };

  const skip = (row: RtRow) => {
    patch("skipped", row.id, !row.accepted);
    // Real write-back (Git #1476): "not_applicable" is the real status
    // RemediationGuideBody's own action picker already uses for "Accept
    // as-is" ("Not applicable to this tenant") — same vocabulary, same
    // per-customer store, so accepting a task here must not disagree with
    // what the guide shows for the same underlying step.
    if (row.task.stepId) tracker.setAction(row.task.stepId, row.accepted ? "not_started" : "not_applicable");
  };

  return (
    <PortalV2Shell eyebrow="Operate" title="Remediation Tracker">
      <div
        style={{ minHeight: "100%", background: SIDEBAR_WASH }}
        data-testid="pv2-rt-root"
        data-rt-loaded={tracker.loaded ? "true" : "false"}
        data-rt-error={tracker.error ? "true" : "false"}
      >
        <div style={{ maxWidth: 1180, margin: "0 auto", padding: "26px 28px 60px", display: "flex", flexDirection: "column", gap: 18 }}>
          {/* ── Header — proto 5964-5968 ─────────────────────────────────────── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <span style={{ fontSize: "9.5px", fontWeight: 800, letterSpacing: ".16em", textTransform: "uppercase", color: "#64748b" }}>Remediation tracker</span>
            <span data-testid="pv2-rt-heading" style={{ fontSize: "22px", fontWeight: 800, color: "#f8fafc", letterSpacing: "-.02em", lineHeight: 1.3 }}>{headline.headline}</span>
            <span data-testid="pv2-rt-sub" style={{ fontSize: "12.5px", color: "#94a3b8", lineHeight: 1.6, maxWidth: "86ch", textWrap: "pretty" }}>{headline.sub}</span>
          </div>

          {/* ── Gate summary strip — real rolling tenant score + day-one (#1381) ─ */}
          <div data-testid="pv2-rt-gate" data-rt-scored={gate.hasScore ? "true" : "false"} style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap", padding: "16px 18px", border: "1px solid rgba(30,41,59,.9)", borderRadius: 13, background: "rgba(15,23,42,.45)" }}>
            <div style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: "9px", fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase", color: "#64748b" }}>Tenant score</span>
              <span data-testid="pv2-rt-gate-now" style={{ fontSize: "40px", fontWeight: 800, lineHeight: 1, fontFamily: MONO, color: gate.nowColor }}>{gate.now}</span>
              {gate.hasScore ? (
                gate.delta ? (
                  <span style={{ fontSize: "10.5px", fontWeight: 700, fontFamily: MONO, color: gate.deltaPositive ? "#34d399" : gate.deltaNegative ? "#f87171" : "#475569" }}>{gate.before} → {gate.now} · {gate.delta} since last scan</span>
                ) : (
                  <span style={{ fontSize: "10.5px", fontWeight: 700, fontFamily: MONO, color: "#475569" }}>{gate.statusNote || "no change since last scan"}</span>
                )
              ) : (
                <span style={{ fontSize: "10.5px", fontWeight: 700, fontFamily: MONO, color: "#64748b" }}>{gate.statusNote}</span>
              )}
            </div>
            <div style={{ flex: "1 1 260px", minWidth: 200, display: "flex", flexDirection: "column", gap: 7 }}>
              <div style={{ position: "relative", height: 9, borderRadius: 5, background: "rgba(148,163,184,.14)", overflow: "hidden" }}>
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${gate.scorePct}%`, background: "linear-gradient(90deg,#34d399,#5eead4)", transition: "width 500ms" }} />
                {gate.dayOne && <div style={{ position: "absolute", left: `${gate.dayOnePct}%`, top: -2, bottom: -2, width: 2, background: "#94a3b8" }} title={`Day 1 · ${gate.dayOne}`} />}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
                {gate.dayOne && <span data-testid="pv2-rt-gate-dayone" style={{ fontSize: "10.5px", color: "#94a3b8", fontFamily: MONO }}>day 1 · {gate.dayOne}</span>}
                {gate.hasScore && gate.before && <span style={{ fontSize: "10.5px", color: "#94a3b8", fontFamily: MONO }}>previous scan · {gate.before}</span>}
                {!gate.hasScore && <span style={{ fontSize: "10.5px", color: "#64748b", fontFamily: MONO }}>run a scan to establish a baseline</span>}
              </div>
            </div>
            <div style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", gap: 2, paddingLeft: 18, borderLeft: "1px solid rgba(30,41,59,.9)" }}>
              <span style={{ fontSize: "9px", fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase", color: "#64748b" }}>Copilot gate</span>
              <span data-testid="pv2-rt-copilot-gate" style={{ fontSize: "15px", fontWeight: 800, fontFamily: MONO, color: gate.copilotOk ? "#34d399" : gate.copilotEvaluated ? "#fbbf24" : "#64748b" }}>{gate.copilotGate}</span>
              <span style={{ fontSize: "10px", color: "#64748b" }}>{gate.copilotNote}</span>
            </div>
          </div>

          {/* ── Pillar cells — proto 5993-6011 ───────────────────────────────── */}
          <div data-testid="pv2-rt-pillars" style={{ display: "grid", gridTemplateColumns: "repeat(6,minmax(0,1fr))", gap: 9 }}>
            {pillarCells.map((p) => (
              <button
                key={p.key}
                onClick={() => navigate(`/portal-v2/${p.key}`)}
                data-testid={`pv2-rt-pillar-${p.key}`}
                style={{ display: "flex", flexDirection: "column", gap: 4, padding: "11px 12px", borderRadius: 10, cursor: "pointer", fontFamily: "inherit", textAlign: "left", border: `1px solid ${p.color}2b`, background: `${p.color}0a` }}
              >
                <span style={{ fontSize: "9px", fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase", color: p.color }}>{p.label}</span>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span data-testid={`pv2-rt-pillar-score-${p.key}`} style={{ fontSize: "18px", fontWeight: 800, fontFamily: MONO, color: p.hasScore ? "#f8fafc" : "#475569" }}>{p.score}</span>
                  {p.dayOneLabel && <span style={{ fontSize: "9.5px", color: "#475569", fontFamily: MONO }}>{p.dayOneLabel}</span>}
                  {p.delta && <span style={{ fontSize: "9.5px", fontWeight: 700, fontFamily: MONO, color: p.deltaPositive ? "#34d399" : p.deltaNegative ? "#f87171" : "#64748b" }}>{p.delta}</span>}
                </div>
                <div style={{ position: "relative", height: 5, borderRadius: 3, background: "rgba(148,163,184,.14)", overflow: "hidden" }}>
                  <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${p.scorePct}%`, background: p.color, transition: "width 400ms" }} />
                  {p.dayOne && <div style={{ position: "absolute", left: `${p.dayOnePct}%`, top: -1, bottom: -1, width: 1.5, background: "#94a3b8" }} />}
                </div>
                {p.statusNote && <span style={{ fontSize: "9px", fontWeight: 700, color: "#64748b", fontFamily: MONO }}>{p.statusNote}</span>}
              </button>
            ))}
          </div>

          {/* ── State filter chips — proto 6013-6020 ─────────────────────────── */}
          <div data-testid="pv2-rt-chips" style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
            {chips.map((c) => (
              <button
                key={c.key}
                onClick={() => toggleState(c.key)}
                data-testid={`pv2-rt-chip-${c.key}`}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit", border: `1px solid ${c.color}${c.active ? "99" : "33"}`, background: `${c.color}${c.active ? "1f" : "0a"}`, color: c.color, fontSize: "10px", fontWeight: 700 }}
              >
                {c.label}
                <span style={{ fontSize: "10px", fontWeight: 800, fontFamily: MONO, color: c.color }}>{c.n}</span>
              </button>
            ))}
            {bar.filtered && (
              <button onClick={clearFilters} data-testid="pv2-rt-clear" style={{ padding: "5px 10px", borderRadius: 999, border: "1px solid rgba(148,163,184,.22)", background: "transparent", color: "#94a3b8", fontSize: "10px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                {bar.label} · clear
              </button>
            )}
          </div>

          {/* ── Phase groups — proto 6022-6185 ───────────────────────────────── */}
          {groups.map((g) => (
            <div key={g.key} data-testid={`pv2-rt-group-${g.key}`} style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: "9px", fontWeight: 800, letterSpacing: ".14em", color: "#475569", fontFamily: MONO }}>{g.n}</span>
                <span style={{ fontSize: "11px", fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: "#cbd5e1" }}>{g.name}</span>
                <span style={{ fontSize: "9.5px", color: "#3f4c5f", fontFamily: MONO }}>{g.progress}</span>
                <span style={{ fontSize: "9.5px", color: "#3f4c5f" }}>Target {g.due}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 0, border: "1px solid rgba(30,41,59,.85)", borderRadius: 11, background: "rgba(15,23,42,.4)", overflow: "hidden" }}>
                {g.items.map((t) => (
                  <RemediationRow
                    key={t.id}
                    row={t}
                    isOpen={open === t.id}
                    onToggleOpen={() => toggleOpen(t.id)}
                    onTick={() => tick(t)}
                    onCrAdvance={() => crAdvance(t)}
                    onHoldRelease={() => patch("hold", t.id, "released")}
                    onHoldExtend={() => patch("hold", t.id, "extended")}
                    onHoldClose={() => holdClose(t)}
                    onEvAct={() => evAct(t)}
                    onEvDocs={() => navigate("/portal-v2/documents")}
                    onRunbook={() => runRunbook(t)}
                    onRollback={() => rollback(t)}
                    onRescan={() => cycleRescan(t)}
                    onVerify={() => verify(t)}
                    onHand={() => handToShane(t)}
                    onSkip={() => skip(t)}
                    onDep={(depId) => {
                      const dep = groups.flatMap((gg) => gg.items).find((r) => r.id === depId);
                      const depPhase = dep?.task.ph;
                      if (depPhase) navigate(`/portal-v2/remediation/${depPhase}`);
                      setOpen(depId);
                    }}
                  />
                ))}
              </div>
            </div>
          ))}

          {/* ── Drift and re-remediation — proto 6187-6202 ───────────────────── */}
          <div data-testid="pv2-rt-drift" style={{ display: "flex", flexDirection: "column", gap: 9, padding: "16px 18px", border: "1px solid rgba(244,114,182,.28)", borderRadius: 13, background: "rgba(244,114,182,.05)" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: "9px", fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase", color: "#f472b6" }}>Drift and re-remediation</span>
              <span style={{ fontSize: "12px", color: "#cbd5e1", lineHeight: 1.6, maxWidth: "80ch", textWrap: "pretty" }}>Completed tasks stay monitored. When a setting reverses, a policy disappears or PII re-exposes, the scan raises a new task against the original and it carries its own CR.</span>
            </div>
            {drift.map((d) => (
              <button
                key={d.id}
                onClick={() => {
                  navigate(`/portal-v2/remediation/${d.phase}`);
                  setSelState(null);
                  setOpen(d.id);
                }}
                data-testid={`pv2-rt-drift-${d.id}`}
                style={{ display: "flex", flexDirection: "column", gap: 3, padding: "11px 13px", border: "1px solid rgba(30,41,59,.9)", borderRadius: 10, background: "rgba(15,23,42,.5)", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                  <span style={{ flex: "1 1 220px", minWidth: 0, fontSize: "12.5px", fontWeight: 700, color: "#e2e8f0", lineHeight: 1.4, textWrap: "pretty" }}>{d.title}</span>
                  <span style={{ flex: "0 0 auto", padding: "2px 7px", borderRadius: 5, border: `1px solid ${d.sevColor}55`, color: d.sevColor, fontSize: "9px", fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase" }}>{d.sev}</span>
                </div>
                <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.5, textWrap: "pretty" }}>{d.detected}</span>
                <span style={{ fontSize: "10px", color: "#64748b", fontFamily: MONO }}>{d.origin}</span>
              </button>
            ))}
          </div>

          {/* ── Microsoft Message Center — proto 6204-6225 ───────────────────── */}
          <div data-testid="pv2-rt-mc" style={{ display: "flex", flexDirection: "column", gap: 9, padding: "16px 18px", border: "1px solid rgba(167,139,250,.28)", borderRadius: 13, background: "rgba(167,139,250,.05)" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: "9px", fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase", color: "#a78bfa" }}>Microsoft Message Center</span>
              <span style={{ fontSize: "12px", color: "#cbd5e1", lineHeight: 1.6, maxWidth: "80ch", textWrap: "pretty" }}>Posts with tenant impact, read against your configuration. Map one to a change request or add it to the plan so Microsoft's baseline and yours stay in step.</span>
            </div>
            {mc.map((m) => (
              <div key={m.id} data-testid={`pv2-rt-mc-${m.id}`} style={{ display: "flex", flexDirection: "column", gap: 5, padding: "12px 14px", border: "1px solid rgba(30,41,59,.9)", borderRadius: 10, background: "rgba(15,23,42,.5)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                  <span style={{ fontSize: "9.5px", fontWeight: 800, color: "#a78bfa", fontFamily: MONO }}>{m.id}</span>
                  <span style={{ flex: "1 1 220px", minWidth: 0, fontSize: "12.5px", fontWeight: 700, color: "#e2e8f0", lineHeight: 1.4, textWrap: "pretty" }}>{m.title}</span>
                  <span style={{ flex: "0 0 auto", padding: "2px 8px", borderRadius: 5, border: `1px solid ${m.needColor}80`, color: m.needColor, fontSize: "9px", fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{m.need}</span>
                </div>
                <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.6, textWrap: "pretty" }}>{m.impact}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                  <span style={{ fontSize: "10px", color: "#64748b", fontFamily: MONO }}>{m.when}</span>
                  <button
                    onClick={() => {
                      navigate(`/portal-v2/remediation/${m.taskPhase}`);
                      setSelState(null);
                      setOpen(m.taskId);
                    }}
                    style={{ padding: "5px 11px", borderRadius: 7, border: "1px solid rgba(148,163,184,.22)", background: "transparent", color: "#94a3b8", fontSize: "10.5px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                  >
                    {m.taskLabel}
                  </button>
                  <button
                    onClick={() =>
                      openForm({
                        kicker: `Message Center · ${m.id}`,
                        title: "Map this post to a change request",
                        intro: `${m.title}. ${m.impact} Mapping it raises a CR against the phase you choose, so Microsoft's change and your remediation stay on one record.`,
                        submitLabel: "Raise the CR",
                        fields: [
                          { id: "phase", label: "Phase", kind: "select", value: RT_PHASES.find((p) => p.k === m.taskPhase)?.name ?? RT_PHASES[0].name, options: RT_PHASES.map((p) => ({ value: p.name, label: p.name })) },
                          { id: "owner", label: "Owner", kind: "text", value: "jordan.diaz@tenant.com", placeholder: "name@tenant.com" },
                          { id: "note", label: "What has to change", kind: "textarea", wide: true, required: false, placeholder: "Optional — what in the tenant this post forces." },
                        ],
                        doneNote: "Raised. The CR carries the Message Center ID, so the audit trail shows what Microsoft changed and what you did about it.",
                      })
                    }
                    style={{ padding: "5px 11px", borderRadius: 7, border: "1px solid rgba(167,139,250,.45)", background: "rgba(167,139,250,.12)", color: "#c4b5fd", fontSize: "10.5px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                  >
                    Map to a change request
                  </button>
                  <button onClick={() => navigate("/portal-v2/ms-changes")} style={{ padding: "5px 11px", borderRadius: 7, border: "1px solid rgba(148,163,184,.22)", background: "transparent", color: "#94a3b8", fontSize: "10.5px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Open Microsoft Changes</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {formElement}
    </PortalV2Shell>
  );
}

function Chip({ chip }: { chip: RtChip }) {
  return (
    <span
      style={{
        flex: "0 0 auto",
        padding: "2px 7px",
        borderRadius: 5,
        border: `1px ${chip.dashed ? "dashed" : "solid"} ${chip.color}44`,
        background: chip.dashed ? "transparent" : `${chip.color}10`,
        color: chip.color,
        fontSize: "9px",
        fontWeight: 700,
        letterSpacing: ".04em",
        whiteSpace: "nowrap",
        fontFamily: MONO,
      }}
    >
      {chip.text}
    </span>
  );
}

const ACTION_BTN = (accent: "cr" | "hold" | "ev" | "runbook" | "blue" | "muted"): React.CSSProperties => {
  const map: Record<string, { border: string; bg: string; color: string }> = {
    cr: { border: "rgba(96,165,250,.45)", bg: "rgba(96,165,250,.1)", color: "#bfdbfe" },
    hold: { border: "rgba(34,211,238,.5)", bg: "rgba(34,211,238,.12)", color: "#22d3ee" },
    ev: { border: "rgba(251,191,36,.45)", bg: "rgba(251,191,36,.1)", color: "#fbbf24" },
    runbook: { border: "rgba(94,234,212,.55)", bg: "rgba(94,234,212,.14)", color: "#5eead4" },
    blue: { border: "rgba(0,120,212,.5)", bg: "rgba(0,120,212,.14)", color: "#bfdbfe" },
    muted: { border: "rgba(148,163,184,.22)", bg: "transparent", color: "#94a3b8" },
  };
  const m = map[accent];
  return { padding: "6px 12px", borderRadius: 7, border: `1px solid ${m.border}`, background: m.bg, color: m.color, fontSize: "11px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
};

function DetailLabel({ color, children }: { color: string; children: React.ReactNode }) {
  return <span style={{ fontSize: "9px", fontWeight: 800, letterSpacing: ".13em", textTransform: "uppercase", color }}>{children}</span>;
}

interface RowProps {
  row: RtRow;
  isOpen: boolean;
  onToggleOpen: () => void;
  onTick: () => void;
  onCrAdvance: () => void;
  onHoldRelease: () => void;
  onHoldExtend: () => void;
  onHoldClose: () => void;
  onEvAct: () => void;
  onEvDocs: () => void;
  onRunbook: () => void;
  onRollback: () => void;
  onRescan: () => void;
  onVerify: () => void;
  onHand: () => void;
  onSkip: () => void;
  onDep: (depId: string) => void;
}

function RemediationRow(props: RowProps) {
  const { row: t, isOpen } = props;
  const boxBorder = t.done ? "rgba(52,211,153,.7)" : t.canTick ? "rgba(148,163,184,.4)" : "rgba(148,163,184,.2)";
  return (
    <div
      data-testid={`pv2-rt-row-${t.id}`}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "11px 13px",
        borderLeft: `2px solid ${t.stateColor}`,
        borderTop: "1px solid rgba(30,41,59,.75)",
        background: isOpen ? "rgba(30,41,59,.35)" : t.scored ? "rgba(52,211,153,.04)" : "transparent",
      }}
    >
      {/* Line 1 — checkbox, title, state, points */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button
          onClick={props.onTick}
          title={t.boxTitle}
          data-testid={`pv2-rt-tick-${t.id}`}
          style={{
            flex: "0 0 18px",
            width: 18,
            height: 18,
            borderRadius: 5,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
            fontFamily: "inherit",
            cursor: t.canTick || t.done ? "pointer" : "not-allowed",
            border: `1px ${t.canTick || t.done ? "solid" : "dashed"} ${boxBorder}`,
            background: t.done ? "rgba(52,211,153,.16)" : "transparent",
          }}
        >
          {t.done && <CheckSm color="#34d399" />}
        </button>
        <button onClick={props.onToggleOpen} style={{ flex: "1 1 240px", minWidth: 0, textAlign: "left", background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit" }}>
          <span style={{ fontSize: "12.5px", fontWeight: 600, lineHeight: 1.4, textWrap: "pretty", color: t.accepted ? "#64748b" : t.done ? "#cbd5e1" : "#e2e8f0", textDecoration: t.accepted ? "line-through" : "none" }}>{t.title}</span>
        </button>
        <span style={{ flex: "0 0 auto", padding: "2px 8px", borderRadius: 5, border: `1px solid ${t.stateColor}55`, background: `${t.stateColor}14`, fontSize: "9px", fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: t.stateColor, whiteSpace: "nowrap" }}>{t.stateLabel}</span>
        <div style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
          <span style={{ fontSize: "12px", fontWeight: 800, fontFamily: MONO, color: t.ptsColor, textAlign: "right" }}>{t.ptsLabel}</span>
          <span style={{ fontSize: "8.5px", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#475569" }}>{t.ptsSub}</span>
        </div>
      </div>

      {/* Line 2 — chips */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", paddingLeft: 28 }}>
        {t.chips.map((c, i) => (
          <Chip key={i} chip={c} />
        ))}
      </div>

      {/* Line 3 — next step */}
      <span style={{ paddingLeft: 28, fontSize: "10.5px", color: "#64748b", lineHeight: 1.5, textWrap: "pretty" }}>{t.next}</span>

      {isOpen && <RemediationRowDetail {...props} />}
    </div>
  );
}

function RemediationRowDetail(props: RowProps) {
  const { row: t } = props;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 13, margin: "6px 0 4px 28px", padding: "14px 16px", border: "1px solid rgba(30,41,59,.9)", borderRadius: 11, background: "rgba(8,17,32,.5)" }}>
      {/* Problem / fix */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <DetailLabel color="#f87171">The problem</DetailLabel>
          <span style={{ fontSize: "12px", color: "#cbd5e1", lineHeight: 1.6, textWrap: "pretty" }}>{t.problem}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <DetailLabel color="#34d399">The fix</DetailLabel>
          <span style={{ fontSize: "12px", color: "#cbd5e1", lineHeight: 1.6, textWrap: "pretty" }}>{t.fix}</span>
        </div>
      </div>

      {/* Depends on */}
      {t.deps.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <DetailLabel color="#64748b">Depends on</DetailLabel>
          {t.deps.map((d) => (
            <button key={d.id} onClick={() => props.onDep(d.id)} style={{ alignSelf: "flex-start", background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
              <span style={{ fontSize: "11px", color: d.met ? "#34d399" : "#f87171", fontFamily: MONO }}>{d.label} · {d.met ? "met" : "outstanding"}</span>
            </button>
          ))}
        </div>
      )}

      {/* CR gate stepper */}
      {t.hasCr && (
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
            <DetailLabel color="#64748b">Change request</DetailLabel>
            <span style={{ fontSize: "10.5px", fontWeight: 800, color: "#93c5fd", fontFamily: MONO }}>{t.crLabel}</span>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {t.crStages.map((s) => (
              <div
                key={s.n}
                style={{
                  flex: "1 1 84px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                  padding: "7px 9px",
                  borderRadius: 8,
                  border: `1px solid ${s.done ? "rgba(52,211,153,.35)" : s.current ? "rgba(96,165,250,.55)" : "rgba(30,41,59,.9)"}`,
                  background: s.done ? "rgba(52,211,153,.07)" : s.current ? "rgba(96,165,250,.1)" : "transparent",
                }}
              >
                <span style={{ fontSize: "8.5px", fontWeight: 800, fontFamily: MONO, color: s.done ? "#34d399" : s.current ? "#93c5fd" : "#475569" }}>{s.n}</span>
                <span style={{ fontSize: "10px", fontWeight: 700, lineHeight: 1.3, color: s.done || s.current ? "#e2e8f0" : "#475569" }}>{s.label}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {t.crCanAdvance && (
              <button onClick={props.onCrAdvance} data-testid={`pv2-rt-cr-advance-${t.id}`} style={ACTION_BTN("cr")}>{t.crNextLabel}</button>
            )}
            {t.crClosed && <span style={{ fontSize: "11px", color: "#34d399", fontWeight: 700 }}>{t.crNextLabel}</span>}
          </div>
        </div>
      )}

      {/* Hold window */}
      {t.hold && (
        <div style={{ display: "flex", flexDirection: "column", gap: 7, padding: "12px 13px", border: "1px solid rgba(34,211,238,.3)", borderRadius: 10, background: "rgba(34,211,238,.05)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
            <DetailLabel color="#22d3ee">Hold window</DetailLabel>
            <span style={{ flex: "0 0 auto", padding: "2px 8px", borderRadius: 5, border: `1px solid ${t.hold.released ? "rgba(52,211,153,.5)" : "rgba(34,211,238,.5)"}`, background: t.hold.released ? "rgba(52,211,153,.12)" : "rgba(34,211,238,.1)", color: t.hold.released ? "#34d399" : "#22d3ee", fontSize: "9px", fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase" }}>{t.hold.stateLabel}</span>
            <span style={{ fontSize: "10.5px", fontWeight: 700, color: "#e2e8f0", fontFamily: MONO }}>{t.hold.left}</span>
            <span style={{ fontSize: "10.5px", color: "#5eead4", fontFamily: MONO }}>{t.hold.verdict}</span>
          </div>
          <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.6, textWrap: "pretty" }}>{t.hold.why}</span>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            <button onClick={props.onHoldRelease} style={ACTION_BTN("hold")}>Release the gated step</button>
            <button onClick={props.onHoldExtend} style={ACTION_BTN("muted")}>Extend 24h</button>
            <button onClick={props.onHoldClose} style={ACTION_BTN("muted")}>Close early</button>
          </div>
        </div>
      )}

      {/* Evidence */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          <DetailLabel color="#64748b">Evidence</DetailLabel>
          <span style={{ flex: "0 0 auto", padding: "2px 8px", borderRadius: 5, fontSize: "9px", fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", border: `1px solid ${t.evidence.state === "approved" ? "rgba(52,211,153,.5)" : t.evidence.state === "submitted" ? "rgba(251,191,36,.5)" : "rgba(100,116,139,.4)"}`, color: t.evidence.state === "approved" ? "#34d399" : t.evidence.state === "submitted" ? "#fbbf24" : "#94a3b8" }}>{t.evidence.label}</span>
        </div>
        {t.evidence.items.map((e, i) => (
          <span key={i} style={{ fontSize: "11.5px", color: t.evidence.state === "missing" ? "#64748b" : "#cbd5e1", lineHeight: 1.5 }}>{e}</span>
        ))}
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", paddingTop: 2 }}>
          {t.evidence.canAct && (
            <button onClick={props.onEvAct} data-testid={`pv2-rt-ev-${t.id}`} style={ACTION_BTN("ev")}>{t.evidence.actLabel}</button>
          )}
          <button onClick={props.onEvDocs} style={ACTION_BTN("muted")}>Open in the Document Library</button>
        </div>
      </div>

      {/* Runbook */}
      <div style={{ display: "flex", flexDirection: "column", gap: 7, padding: "12px 13px", border: "1px solid rgba(94,234,212,.22)", borderRadius: 10, background: "rgba(94,234,212,.04)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          <DetailLabel color="#5eead4">Runbook</DetailLabel>
          <span style={{ flex: "1 1 160px", minWidth: 0, fontSize: "11.5px", fontWeight: 700, color: "#93c5fd", textAlign: "left" }}>{t.runbook.playbook}</span>
          <span style={{ flex: "0 0 auto", padding: "2px 8px", borderRadius: 5, border: `1px solid ${t.runbook.hasGraph ? "rgba(94,234,212,.45)" : "rgba(148,163,184,.25)"}`, color: t.runbook.hasGraph ? "#5eead4" : "#94a3b8", fontSize: "9px", fontWeight: 800, letterSpacing: ".05em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{t.runbook.kind}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {t.runbook.steps.map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "7px 10px", borderRadius: 8, border: `1px solid ${s.current ? "rgba(94,234,212,.5)" : "rgba(30,41,59,.9)"}`, background: s.current ? "rgba(94,234,212,.08)" : s.ran ? "rgba(52,211,153,.05)" : "transparent" }}>
              <span style={{ flex: "0 0 46px", fontSize: "8.5px", fontWeight: 800, letterSpacing: ".07em", textTransform: "uppercase", color: s.color, paddingTop: 2 }}>{s.kind}</span>
              <span style={{ flex: "1 1 200px", minWidth: 0, fontSize: "10.5px", lineHeight: 1.5, wordBreak: "break-all", color: s.auto ? (s.ran ? "#cbd5e1" : "#94a3b8") : "#94a3b8", fontFamily: s.auto ? MONO : "inherit" }}>{s.label}</span>
              <span style={{ flex: "0 0 auto", fontSize: "9px", fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: s.color }}>{s.mark}</span>
            </div>
          ))}
        </div>
        {t.runbook.running && (
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <div style={{ height: 5, borderRadius: 3, background: "rgba(148,163,184,.14)", overflow: "hidden" }}>
              <div style={{ height: "100%", borderRadius: 3, transition: "width 400ms", background: "linear-gradient(90deg,#34d399,#5eead4)", width: `${t.runbook.barPct}%` }} />
            </div>
            <span style={{ fontSize: "10.5px", color: "#5eead4", fontFamily: MONO }}>{t.runbook.status}</span>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
          {t.runbook.canRun && (
            <button onClick={props.onRunbook} data-testid={`pv2-rt-run-${t.id}`} style={{ ...ACTION_BTN("runbook"), fontSize: "11.5px", fontWeight: 800, padding: "7px 13px" }}>Run it now</button>
          )}
          {t.runbook.ran && (
            <>
              <span style={{ fontSize: "11px", color: "#34d399", fontWeight: 700, lineHeight: 1.5 }}>{t.runbook.status}</span>
              <button onClick={props.onRollback} style={ACTION_BTN("muted")}>Roll it back</button>
            </>
          )}
          {t.runbook.blocked && <span style={{ fontSize: "11px", color: "#fbbf24", lineHeight: 1.5 }}>{t.runbook.blockedNote}</span>}
        </div>
      </div>

      {/* Footer action bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", paddingTop: 2, borderTop: "1px solid rgba(30,41,59,.8)" }}>
        <span style={{ flex: "1 1 200px", minWidth: 0, fontSize: "11px", color: "#94a3b8", paddingTop: 11, fontFamily: MONO }}>{t.feeLine}</span>
        <button onClick={props.onRescan} title="Cycle the re-scan that verifies this change" style={{ flex: "0 0 auto", padding: "4px 10px", borderRadius: 7, fontSize: "10px", fontWeight: 700, fontFamily: MONO, cursor: t.rescanVerified ? "default" : "pointer", border: `1px dashed ${t.rescanVerified ? "rgba(52,211,153,.35)" : "rgba(148,163,184,.3)"}`, background: "transparent", color: t.rescanVerified ? "#34d399" : "#94a3b8" }}>{t.rescanLabel}</button>
        {t.canVerify && (
          <button onClick={props.onVerify} data-testid={`pv2-rt-verify-${t.id}`} style={{ padding: "6px 12px", borderRadius: 7, border: "1px solid rgba(94,234,212,.45)", background: "rgba(94,234,212,.1)", color: "#5eead4", fontSize: "11px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Re-scan now</button>
        )}
        <button onClick={props.onHand} style={ACTION_BTN("blue")}>Hand it to Shane</button>
        <button onClick={props.onSkip} data-testid={`pv2-rt-skip-${t.id}`} style={{ padding: "6px 12px", borderRadius: 7, border: "1px solid rgba(148,163,184,.2)", background: "transparent", color: "#64748b", fontSize: "11px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>{t.accepted ? "Reverse the acceptance" : "Accept as-is"}</button>
      </div>
    </div>
  );
}
