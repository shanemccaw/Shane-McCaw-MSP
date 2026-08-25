/**
 * portal-v2-projects.tsx — the Projects page (SOW-based delivery).
 *
 * Built to the current design ('Customer Portal Shell.dc.html' 1231-1495 for
 * the markup, 15987-16340 for the logic class). The page answers two questions
 * and arranges everything under them: how much of the contracted scope is done,
 * and whose move it is.
 *
 * ── UI only ────────────────────────────────────────────────────────────────
 * Every number and string is fixture data, held in projectsData.ts. A later
 * pass wires it to a real source. The gantt geometry is REUSED from
 * overviewModel via projectsModel (pjRows/pjPct) so this full gantt and the
 * Overview's mini-gantt cannot disagree about a phase.
 *
 * ── ROUND TWO ITEM 6: the gantt and the board are FLUID ────────────────────
 * The reason this page is called out. The gantt track is `186px minmax(0,1fr)`
 * — a fluid second column with no min-width floor — and the task board is
 * `repeat(auto-fit, minmax(200px, 1fr))`, so its five lanes WRAP as the viewport
 * narrows rather than sitting inside a horizontally-scrolling wrapper. There is
 * no `overflow-x` anywhere on the page.
 *
 * ── Inert controls ─────────────────────────────────────────────────────────
 * Selecting a phase opens its rail panel and selecting a task card expands it —
 * both real, local UI state. The per-task "Confirm the pilot user list" style
 * action buttons drive a slide-over FORM in the prototype, and the "Ask
 * ShaneBot" buttons open the assistant; both belong to systems this part does
 * not own (the shell's openForm/askShane, Part 1), so they render exactly as
 * drawn but are inert — the same call the Change Control rebuild made. The two
 * footer buttons that point at real routes (Change Control, Documents) are real
 * links.
 */

import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";

import { PortalV2Shell } from "@/components/portal-v2/PortalV2Shell";
import {
  DUE_TONE,
  MILESTONE_TONE,
  PHASE_META,
  PJ_BOARD,
  PJ_CARD_LABELS,
  PJ_CONTRACT_END,
  PJ_CURRENT_WEEKS,
  PJ_FOOTER,
  PJ_GANTT_LEGEND,
  PJ_LANES,
  PJ_MINE,
  PJ_MINE_CARD,
  PJ_SCHEDULE,
  PJ_SCOPE_BARS,
  PJ_SCOPE_KICKER,
  PJ_SCOPE_NOTE,
  PJ_TODAY,
  PJ_WAITING_CARD,
  PJ_WEEKS,
  PRIO_META,
  PROJECT_META,
  PROJECT_PHASES,
  type ProjectTask,
} from "@/components/portal-v2/projectsData";
import {
  pjMilestones,
  pjMineCount,
  pjOwnerShort,
  pjPct,
  pjRows,
  pjTasksInLane,
  pjWaitingCount,
  pjWaitingTasks,
  type PjRow,
} from "@/components/portal-v2/projectsModel";

const MONO = "'SF Mono',Menlo,Consolas,monospace";

/* ── The 9.5px/800/.14em uppercase card kicker ──────────────────────────── */
function CardKicker({ colour, children }: { colour: string; children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: "9.5px",
        fontWeight: 800,
        letterSpacing: ".14em",
        textTransform: "uppercase",
        color: colour,
      }}
    >
      {children}
    </span>
  );
}

/* ── The "Waiting on you" card — prototype 1252-1275 ─────────────────────── */
function WaitingCard() {
  const waiting = pjWaitingTasks();
  return (
    <div
      data-testid="pv2-projects-waiting"
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 9,
        padding: "15px 16px",
        border: "1px solid rgba(251,191,36,.5)",
        borderRadius: 12,
        background: "linear-gradient(160deg, rgba(251,191,36,.13), rgba(15,23,42,.5))",
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <CardKicker colour="#fbbf24">{PJ_WAITING_CARD.kicker}</CardKicker>
        <span style={{ fontSize: "10.5px", color: "#a16207", fontWeight: 700 }}>{PJ_WAITING_CARD.overdue}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: "30px", fontWeight: 800, color: "#f8fafc", letterSpacing: "-.03em", lineHeight: 1, fontFamily: MONO }}>
          {pjWaitingCount()}
        </span>
        <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#fde68a", lineHeight: 1.4, textWrap: "pretty" }}>
          {PJ_WAITING_CARD.tail}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 2 }}>
        {waiting.map((w) => (
          <div
            key={w.id}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 7,
              padding: "9px 11px",
              border: "1px solid rgba(251,191,36,.3)",
              borderRadius: 8,
              background: "rgba(15,23,42,.5)",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#e2e8f0", lineHeight: 1.4, textWrap: "pretty" }}>{w.title}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                <span style={{ fontSize: "10px", fontWeight: 700, color: DUE_TONE[w.dueTone], fontFamily: MONO, whiteSpace: "nowrap" }}>{w.dueLabel}</span>
                <span style={{ fontSize: "10px", color: "#475569" }}>{pjOwnerShort(w.owner)}</span>
              </span>
            </div>
            {w.actionLabel && (
              <button
                type="button"
                style={{
                  alignSelf: "stretch",
                  padding: "7px 10px",
                  borderRadius: 6,
                  border: "1px solid rgba(251,191,36,.55)",
                  background: "rgba(251,191,36,.16)",
                  color: "#fde68a",
                  fontSize: "10.5px",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  textAlign: "center",
                }}
              >
                {w.actionLabel}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── The "With us" card — prototype 1277-1294 ────────────────────────────── */
function WithUsCard() {
  return (
    <div
      data-testid="pv2-projects-mine"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 9,
        padding: "15px 16px",
        border: "1px solid rgba(0,120,212,.3)",
        borderRadius: 12,
        background: "linear-gradient(160deg, rgba(0,120,212,.09), rgba(15,23,42,.45))",
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <CardKicker colour="#60a5fa">{PJ_MINE_CARD.kicker}</CardKicker>
        <span style={{ fontSize: "10.5px", color: "#64748b" }}>{PJ_MINE_CARD.clear}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: "30px", fontWeight: 800, color: "#f8fafc", letterSpacing: "-.03em", lineHeight: 1, fontFamily: MONO }}>
          {pjMineCount()}
        </span>
        <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#bfdbfe", lineHeight: 1.4, textWrap: "pretty" }}>{PJ_MINE_CARD.tail}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 0, paddingTop: 2, borderTop: "1px solid rgba(30,41,59,.8)" }}>
        {PJ_MINE.map((m) => (
          <div
            key={m.title}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              padding: "8px 0",
              borderBottom: "1px solid rgba(30,41,59,.65)",
            }}
          >
            <span style={{ fontSize: "11.5px", color: "#cbd5e1", lineHeight: 1.4, minWidth: 0, textWrap: "pretty" }}>{m.title}</span>
            <span style={{ fontSize: "10.5px", fontWeight: 700, color: "#64748b", fontFamily: MONO, whiteSpace: "nowrap" }}>{m.due}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── The "Scope delivered" card — prototype 1296-1326 ────────────────────── */
function ScopeCard() {
  return (
    <div
      data-testid="pv2-projects-scope"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 11,
        padding: "15px 16px",
        border: "1px solid rgba(30,41,59,.9)",
        borderRadius: 12,
        background: "rgba(15,23,42,.4)",
        minWidth: 0,
      }}
    >
      <CardKicker colour="#64748b">{PJ_SCOPE_KICKER}</CardKicker>
      {PJ_SCOPE_BARS.map((bar) => (
        <div key={bar.label} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
            <span style={{ fontSize: "10.5px", fontWeight: 700, color: "#94a3b8" }}>{bar.label}</span>
            <span style={{ fontSize: "11px", fontWeight: 800, color: "#e2e8f0", fontFamily: MONO }}>{bar.value}</span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: "rgba(148,163,184,.14)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${bar.pct}%`, borderRadius: 3, background: bar.color }} />
          </div>
        </div>
      ))}
      <span style={{ fontSize: "10.5px", color: "#94a3b8", lineHeight: 1.5, textWrap: "pretty" }}>{PJ_SCOPE_NOTE}</span>
    </div>
  );
}

/* ── One gantt phase row — reuses pjRows geometry, PHASE_META colour ──────── */
function GanttRow({ row, selected, onToggle }: { row: PjRow; selected: boolean; onToggle: () => void }) {
  const meta = PHASE_META[row.status];
  const color = meta.color;
  const pending = row.status === "pending";
  return (
    <div style={{ display: "grid", gridTemplateColumns: "186px minmax(0,1fr)", gap: 12, alignItems: "center" }}>
      <button
        type="button"
        data-testid={`pv2-projects-phase-${row.n}`}
        onClick={onToggle}
        aria-pressed={selected}
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
          minWidth: 0,
          padding: "6px 8px",
          borderRadius: 8,
          border: `1px solid ${selected ? `${color}77` : "transparent"}`,
          background: selected ? meta.background : "transparent",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        <span style={{ flex: "0 0 auto", fontSize: "10px", fontWeight: 800, color, fontFamily: MONO, paddingTop: 1 }}>P{row.n}</span>
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1, textAlign: "left" }}>
          <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#e2e8f0", lineHeight: 1.3, textWrap: "pretty" }}>{row.name}</span>
          <span style={{ fontSize: "9.5px", color: "#64748b", fontFamily: MONO }}>{row.dates}</span>
        </span>
      </button>
      <div
        style={{
          position: "relative",
          height: 30,
          borderRadius: 6,
          background: "repeating-linear-gradient(90deg, rgba(148,163,184,.07) 0 1px, transparent 1px 11.1111%)",
        }}
      >
        <div style={{ position: "absolute", left: `${pjPct(PJ_TODAY)}%`, top: -2, bottom: -2, width: 1, background: "rgba(34,211,238,.55)" }} />
        <div style={{ position: "absolute", left: `${pjPct(PJ_CONTRACT_END)}%`, top: -2, bottom: -2, width: 1, background: "rgba(226,232,240,.22)" }} />
        {row.slip && (
          <div
            style={{
              position: "absolute",
              left: `${row.slip.left}%`,
              width: `${row.slip.width}%`,
              top: 7,
              height: 16,
              borderRadius: 4,
              border: "1px dashed rgba(248,113,113,.5)",
              background: "repeating-linear-gradient(135deg, rgba(248,113,113,.18) 0 5px, transparent 5px 10px)",
            }}
          />
        )}
        <div
          style={{
            position: "absolute",
            left: `${row.left}%`,
            width: `${row.width}%`,
            top: 4,
            height: 22,
            borderRadius: 5,
            border: `1px solid ${color}${pending ? "55" : "99"}`,
            background: pending ? "rgba(100,116,139,.14)" : `${color}26`,
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
          }}
        >
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${row.donePct}%`, background: `${color}${row.status === "complete" ? "66" : "4d"}` }} />
          <span style={{ position: "relative", padding: "0 7px", fontSize: "9.5px", fontWeight: 700, color: pending ? "#94a3b8" : "#f1f5f9", whiteSpace: "nowrap", fontFamily: MONO }}>
            {row.barText}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ── The open phase's rail panel — prototype 1412-1429 ───────────────────── */
function PhasePanel({ n }: { n: number }) {
  const phase = PROJECT_PHASES.find((p) => p.n === n);
  if (!phase) return null;
  const meta = PHASE_META[phase.status];
  return (
    <div
      data-testid="pv2-projects-phase-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 9,
        padding: "14px 16px",
        border: `1px solid ${meta.color}44`,
        borderRadius: 11,
        background: "rgba(15,23,42,.5)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
        <span style={{ fontSize: "10px", fontWeight: 800, color: meta.color, fontFamily: MONO, letterSpacing: ".04em" }}>
          PHASE {String(phase.n).padStart(2, "0")}
        </span>
        <span style={{ fontSize: "13px", fontWeight: 800, color: "#f8fafc", letterSpacing: "-.01em" }}>{phase.name}</span>
        <span
          style={{
            fontSize: "9px",
            fontWeight: 700,
            letterSpacing: ".09em",
            textTransform: "uppercase",
            color: meta.color,
            padding: "2px 6px",
            border: `1px solid ${meta.color}55`,
            borderRadius: 4,
            whiteSpace: "nowrap",
          }}
        >
          {meta.label}
        </span>
      </div>
      <span style={{ fontSize: "12px", color: "#cbd5e1", lineHeight: 1.6, maxWidth: "96ch", textWrap: "pretty" }}>{phase.summary}</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
        {phase.deliverables.map((d) => (
          <span
            key={d}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 9px",
              borderRadius: 6,
              border: "1px solid rgba(148,163,184,.22)",
              background: "rgba(148,163,184,.06)",
              fontSize: "11px",
              color: "#e2e8f0",
              whiteSpace: "nowrap",
            }}
          >
            {d}
          </span>
        ))}
      </div>
      <span style={{ fontSize: "11.5px", color: phase.status === "blocked" ? "#fbbf24" : "#94a3b8", lineHeight: 1.55, textWrap: "pretty" }}>{phase.note}</span>
    </div>
  );
}

/* ── The schedule + gantt section — prototype 1329-1430 ──────────────────── */
function ScheduleSection({ open, onToggle }: { open: number | null; onToggle: (n: number) => void }) {
  const rows = pjRows();
  const milestones = pjMilestones();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <span data-testid="pv2-projects-schedule" style={{ flex: "1 1 260px", minWidth: 0, fontSize: "9.5px", fontWeight: 700, letterSpacing: ".18em", textTransform: "uppercase", color: "#64748b" }}>
          {PJ_SCHEDULE.kicker}
        </span>
        <span style={{ flex: "0 0 auto", fontSize: "10.5px", color: "#475569" }}>{PJ_SCHEDULE.hint}</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 0, border: "1px solid rgba(30,41,59,.9)", borderRadius: 12, background: "rgba(15,23,42,.35)", overflow: "hidden" }}>
        {/* The on-track callout + next milestone */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap", padding: "13px 16px", borderBottom: "1px solid rgba(30,41,59,.85)" }}>
          <div style={{ flex: "1 1 320px", minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#fbbf24", lineHeight: 1.45, textWrap: "pretty" }}>{PJ_SCHEDULE.callout}</span>
            <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.55, textWrap: "pretty" }}>{PJ_SCHEDULE.calloutBody}</span>
          </div>
          <div style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", gap: 3, minWidth: 150 }}>
            <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: "#64748b" }}>{PJ_SCHEDULE.nextMilestoneKicker}</span>
            <span style={{ fontSize: "12px", fontWeight: 700, color: "#e2e8f0" }}>{PJ_SCHEDULE.nextMilestone}</span>
            <span style={{ fontSize: "10.5px", color: "#64748b" }}>{PJ_SCHEDULE.nextMilestoneMeta}</span>
          </div>
        </div>

        {/* The gantt itself */}
        <div data-testid="pv2-projects-gantt" style={{ padding: "12px 16px 14px", display: "flex", flexDirection: "column", gap: 7 }}>
          {/* Week header */}
          <div style={{ display: "grid", gridTemplateColumns: "186px minmax(0,1fr)", gap: 12, alignItems: "end" }}>
            <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "#475569" }}>{PJ_SCHEDULE.phaseHeading}</span>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              {PJ_WEEKS.map((w, i) => (
                <span
                  key={w}
                  style={{
                    flex: "1 1 0",
                    width: "11.1111%",
                    minWidth: 0,
                    fontSize: "9.5px",
                    color: PJ_CURRENT_WEEKS.includes(i) ? "#94a3b8" : "#475569",
                    fontFamily: MONO,
                    paddingBottom: 3,
                    borderLeft: "1px solid rgba(30,41,59,.85)",
                    paddingLeft: 5,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                  }}
                >
                  {w}
                </span>
              ))}
            </div>
          </div>

          {rows.map((row) => (
            <GanttRow key={row.n} row={row} selected={open === row.n} onToggle={() => onToggle(row.n)} />
          ))}

          {/* Milestones row */}
          <div style={{ display: "grid", gridTemplateColumns: "186px minmax(0,1fr)", gap: 12, alignItems: "center", paddingTop: 3 }}>
            <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "#475569" }}>{PJ_SCHEDULE.milestonesHeading}</span>
            <div style={{ position: "relative", height: 22 }}>
              <div style={{ position: "absolute", left: `${pjPct(PJ_TODAY)}%`, top: -7, height: 12, width: 1, background: "rgba(34,211,238,.55)" }} />
              {milestones.map((m) => {
                const c = MILESTONE_TONE[m.tone];
                return (
                  <div
                    key={m.label}
                    style={{
                      position: "absolute",
                      left: `${m.left}%`,
                      top: 0,
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      transform: `translateX(${m.nearEnd ? "-100%" : "-4px"})`,
                      flexDirection: m.nearEnd ? "row-reverse" : "row",
                    }}
                  >
                    <span style={{ width: 7, height: 7, flex: "0 0 7px", borderRadius: 2, transform: "rotate(45deg)", background: c }} />
                    <span style={{ fontSize: "9.5px", fontWeight: 700, color: c, whiteSpace: "nowrap" }}>{m.label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Legend */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", paddingTop: 5, borderTop: "1px solid rgba(30,41,59,.85)", marginTop: 3 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "10px", color: "#64748b", whiteSpace: "nowrap" }}>
              <span style={{ width: 1, height: 12, background: "rgba(226,232,240,.4)" }} />
              {PJ_SCHEDULE.contractedEnd}
            </span>
            {PJ_GANTT_LEGEND.map((l) => (
              <span key={l.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "10px", color: "#64748b", whiteSpace: "nowrap" }}>
                <span
                  style={{
                    width: 14,
                    height: 8,
                    borderRadius: 2,
                    border: `1px solid ${l.color}99`,
                    background: l.slip ? "repeating-linear-gradient(135deg, rgba(248,113,113,.3) 0 4px, transparent 4px 8px)" : `${l.color}33`,
                  }}
                />
                {l.label}
              </span>
            ))}
            <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "10px", color: "#64748b", whiteSpace: "nowrap" }}>
              <span style={{ width: 1, height: 12, background: "#22d3ee" }} />
              {PJ_SCHEDULE.today}
            </span>
          </div>
        </div>
      </div>

      {open !== null && <PhasePanel n={open} />}
    </div>
  );
}

/* ── One task card — prototype 1447-1479 ─────────────────────────────────── */
function TaskCard({ task, open, onToggle }: { task: ProjectTask; open: boolean; onToggle: () => void }) {
  const isWaiting = task.lane === "waiting";
  const isDone = task.lane === "done";
  const prio = PRIO_META[task.prio];
  const hasReason = !!task.reason;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 7,
        padding: "10px 11px",
        border: `1px solid ${
          open
            ? isWaiting
              ? "rgba(251,191,36,.7)"
              : "rgba(96,165,250,.5)"
            : isWaiting
              ? "rgba(251,191,36,.34)"
              : "rgba(30,41,59,.95)"
        }`,
        borderRadius: 9,
        background: isWaiting ? "rgba(15,23,42,.62)" : "rgba(15,23,42,.55)",
        cursor: "pointer",
        fontFamily: "inherit",
        textAlign: "left",
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: "9px", fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: prio.color, padding: "1px 5px", borderRadius: 3, background: prio.background, whiteSpace: "nowrap" }}>
          {task.prio}
        </span>
        <span style={{ fontSize: "10px", fontWeight: 700, color: DUE_TONE[task.dueTone], fontFamily: MONO, whiteSpace: "nowrap" }}>{task.dueLabel}</span>
      </div>
      <span style={{ fontSize: "12px", fontWeight: 700, color: isDone ? "#94a3b8" : "#e2e8f0", lineHeight: 1.4, textWrap: "pretty", textDecoration: isDone ? "line-through" : "none" }}>
        {task.title}
      </span>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 7 }}>
        <span style={{ fontSize: "10px", color: "#475569", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{task.owner}</span>
        <span style={{ fontSize: "10px", color: "#475569", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Phase {task.phase}</span>
      </div>
      {hasReason && <span style={{ fontSize: "11px", color: "#fbbf24", lineHeight: 1.5, textWrap: "pretty" }}>{task.reason}</span>}
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 7, paddingTop: 8, borderTop: "1px solid rgba(148,163,184,.16)" }}>
          {task.detail && <span style={{ fontSize: "11px", color: "#cbd5e1", lineHeight: 1.55, textWrap: "pretty" }}>{task.detail}</span>}
          {hasReason && (
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "#a16207" }}>{PJ_CARD_LABELS.holds}</span>
              <span style={{ fontSize: "11px", color: "#e2e8f0", lineHeight: 1.55, textWrap: "pretty" }}>{task.blocks}</span>
              <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "#a16207", paddingTop: 2 }}>{PJ_CARD_LABELS.whenDone}</span>
              <span style={{ fontSize: "11px", color: "#cbd5e1", lineHeight: 1.55, textWrap: "pretty" }}>{task.next}</span>
            </div>
          )}
          {task.actionLabel && (
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                padding: "7px 11px",
                borderRadius: 7,
                border: "1px solid rgba(251,191,36,.55)",
                background: "rgba(251,191,36,.14)",
                color: "#fde68a",
                fontSize: "11px",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
                width: "100%",
              }}
            >
              {task.actionLabel}
            </button>
          )}
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              padding: "6px 10px",
              borderRadius: 7,
              border: "1px solid rgba(0,180,216,.35)",
              background: "transparent",
              color: "#22d3ee",
              fontSize: "10.5px",
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
              width: "100%",
            }}
          >
            {PJ_CARD_LABELS.ask}
          </button>
        </div>
      )}
    </div>
  );
}

/* ── The task board — prototype 1432-1484 ────────────────────────────────── */
function TaskBoard({ openTask, onToggle }: { openTask: string | null; onToggle: (id: string) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <span data-testid="pv2-projects-board" style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".18em", textTransform: "uppercase", color: "#64748b" }}>
          {PJ_BOARD.kicker}
        </span>
        <span style={{ fontSize: "10.5px", color: "#475569" }}>{PJ_BOARD.hint}</span>
      </div>
      {/* Round Two item 6: auto-fit wrapping, no min-width floor, no overflow-x. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10, alignItems: "start" }}>
        {PJ_LANES.map((lane) => {
          const isWaiting = lane.key === "waiting";
          const cards = pjTasksInLane(lane.key);
          return (
            <div
              key={lane.key}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: "11px 11px 13px",
                border: `1px solid ${isWaiting ? "rgba(251,191,36,.5)" : "rgba(30,41,59,.9)"}`,
                borderRadius: 12,
                background: isWaiting ? "linear-gradient(180deg, rgba(251,191,36,.1), rgba(15,23,42,.45))" : "rgba(15,23,42,.3)",
                minWidth: 0,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 7, paddingBottom: 8, borderBottom: `1px solid ${isWaiting ? "rgba(251,191,36,.28)" : "rgba(30,41,59,.85)"}` }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: lane.color, flex: "0 0 6px" }} />
                <span style={{ fontSize: "10.5px", fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: lane.color, whiteSpace: "nowrap" }}>{lane.label}</span>
                <span style={{ fontSize: "10.5px", fontWeight: 700, color: lane.color, fontFamily: MONO }}>{cards.length}</span>
              </div>
              <span style={{ fontSize: "10px", color: isWaiting ? "#fbbf24" : "#475569", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{lane.note}</span>
              {cards.map((task) => (
                <TaskCard key={task.id} task={task} open={openTask === task.id} onToggle={() => onToggle(task.id)} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── The footer actions — prototype 1486-1491 ────────────────────────────── */
function footerButtonStyle(border: string, background: string, color: string): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "8px 13px",
    borderRadius: 8,
    border: `1px solid ${border}`,
    background,
    color,
    fontSize: "11px",
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
    textDecoration: "none",
  };
}

function FooterActions() {
  return (
    <div data-testid="pv2-projects-footer" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", paddingTop: 2 }}>
      <Link href="/portal-v2/change-control" style={footerButtonStyle("rgba(96,165,250,.4)", "rgba(96,165,250,.1)", "#bfdbfe")}>
        {PJ_FOOTER.changeControl}
      </Link>
      <Link href="/portal-v2/documents" style={footerButtonStyle("rgba(30,41,59,.95)", "transparent", "#94a3b8")}>
        {PJ_FOOTER.docs}
      </Link>
      <button type="button" style={footerButtonStyle("rgba(0,180,216,.4)", "rgba(0,180,216,.08)", "#22d3ee")}>
        {PJ_FOOTER.ask}
      </button>
      <span style={{ fontSize: "10.5px", color: "#475569" }}>{PJ_FOOTER.billing}</span>
    </div>
  );
}

export default function PortalV2ProjectsPage() {
  const [openPhase, setOpenPhase] = useState<number | null>(null);
  const [openTask, setOpenTask] = useState<string | null>(null);

  return (
    <PortalV2Shell eyebrow="Projects" title={PROJECT_META.title}>
      <div
        data-testid="pv2-projects"
        style={{
          position: "relative",
          maxWidth: 1400,
          margin: "0 auto",
          padding: "26px 26px 48px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          boxSizing: "border-box",
        }}
      >
        <Link
          href="/portal-v2"
          style={{
            alignSelf: "flex-start",
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            fontSize: "11.5px",
            fontWeight: 600,
            color: "#64748b",
            fontFamily: "inherit",
            textDecoration: "none",
          }}
        >
          <ArrowLeft size={13} color="#64748b" />
          Overview
        </Link>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", paddingBottom: 14, borderBottom: "1px solid rgba(30,41,59,.9)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
            <span data-testid="pv2-projects-sow" style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: "#60a5fa" }}>{PROJECT_META.sowLabel}</span>
            <span data-testid="pv2-projects-title" style={{ fontSize: "18px", fontWeight: 800, color: "#f8fafc", letterSpacing: "-.015em" }}>{PROJECT_META.title}</span>
            <span style={{ fontSize: "12.5px", color: "#94a3b8", lineHeight: 1.55, maxWidth: "88ch", textWrap: "pretty" }}>{PROJECT_META.intro}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flex: "0 0 auto" }}>
            <span style={{ fontSize: "10.5px", color: "#64748b" }}>{PROJECT_META.lead}</span>
            <span style={{ fontSize: "10.5px", color: "#475569" }}>{PROJECT_META.terms}</span>
            <span style={{ fontSize: "10.5px", color: "#475569" }}>{PROJECT_META.day}</span>
          </div>
        </div>

        {/* The three summary cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(310px,1fr))", gap: 12, alignItems: "stretch" }}>
          <WaitingCard />
          <WithUsCard />
          <ScopeCard />
        </div>

        <ScheduleSection open={openPhase} onToggle={(n) => setOpenPhase((cur) => (cur === n ? null : n))} />

        <TaskBoard openTask={openTask} onToggle={(id) => setOpenTask((cur) => (cur === id ? null : id))} />

        <FooterActions />
      </div>
    </PortalV2Shell>
  );
}
