/**
 * ProjectManagementBody — ADHD-friendly Project Management studio view.
 *
 * Features:
 *   1. Milestone Timeline across the top — one glass card per milestone with a
 *      row of per-epic status capsules (green/red/amber/blue/grey) and a
 *      hover/focus tooltip surfacing the most relevant issue.
 *   2. Interactive Gantt Chart showing timeline bars per milestone & epic with completion fills.
 *   3. "Focus Mode" zero-distraction toggle for active milestones.
 *   4. One-Click Epic-to-Milestone assignment matrix.
 *   5. Quick Milestone creator modal.
 */

import { useState, useEffect, useRef, useSyncExternalStore } from "react";
import {
  Calendar, CheckCircle, Clock, Flag, GitBranch,
  GitPullRequest, Plus, Target, Sparkles, Filter, Eye, ChevronRight, X, ArrowUpRight,
} from "lucide-react";
import { ACCENT, FONT, LINE, METRICS, SURFACE, TEXT } from "../../theme";
import {
  getSnapshot, subscribe, milestoneById, epicsForMilestone, issuesForEpic,
  createMilestone, updateMilestone, deleteMilestone, assignEpicToMilestone,
  selectMilestone, selectEpic, epicIsUnassigned, epicBubbleStatus,
  epicCardState, issueCardState, formatIssueAge, estimateEpicHours, epicIsDone,
  type EpicBubbleStatus, type EpicCardState, type IssueCardState,
} from "../build-tracker/buildTrackerStore";
import { githubIssueUrl } from "../build-tracker/buildTrackerTypes";
import type { MilestoneRow, EpicRow, MilestoneStatus } from "../build-tracker/buildTrackerTypes";

function useStore() {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Roadmap bubble colors — green done, red blocked, amber aged, blue ordinary open work. */
const BUBBLE_COLOR: Record<EpicBubbleStatus, string> = {
  done: ACCENT.greenSoft,
  blocked: ACCENT.danger,
  aged: ACCENT.amber,
  open: ACCENT.info,
};

const BUBBLE_LABEL: Record<EpicBubbleStatus, string> = {
  done: "Done",
  blocked: "Blocked",
  aged: "Aged — left behind a while",
  open: "In progress",
};

// ── Gantt bar timeframe ─────────────────────────────────────────────────────
// The Gantt's own time axis (its header row below) is a fixed Aug 1 – Sep 30
// 2026 window, not read from any real date — there is no stored "sprint
// window" this app tracks. An epic's bar is positioned on that same fixed
// window using the one real date it does have (createdAt) plus a real
// estimate of what's left (estimateEpicHours(), the same velocity math the
// Milestone page's own estimate already uses): closed epics show their real
// created→closed span; open ones show created→(today + estimated remaining
// days), so the bar's length actually reflects how much work is left, not a
// decorative placeholder.

const GANTT_AXIS_START = Date.parse("2026-08-01T00:00:00Z");
const GANTT_AXIS_END = Date.parse("2026-10-01T00:00:00Z"); // exclusive — covers through Sep 30
const GANTT_AXIS_SPAN = GANTT_AXIS_END - GANTT_AXIS_START;

function axisPct(ms: number): number {
  return Math.min(100, Math.max(0, ((ms - GANTT_AXIS_START) / GANTT_AXIS_SPAN) * 100));
}

function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Real created→(closed | today+estimate) span for one epic, clamped onto the fixed axis window. */
function epicGanttSpan(epic: EpicRow): { leftPct: number; widthPct: number; startMs: number; endMs: number } {
  const startMs = Date.parse(epic.createdAt);
  const endMs = epicIsDone(epic)
    ? Date.parse(epic.closedAt ?? epic.updatedAt)
    : Date.now() + (estimateEpicHours(epic.id) / 8) * 86_400_000;
  const leftPct = axisPct(startMs);
  const rightPct = axisPct(Math.max(endMs, startMs + 86_400_000)); // at least one visible day wide
  return { leftPct, widthPct: Math.max(2, rightPct - leftPct), startMs, endMs };
}

// ── Milestone Timeline card — capsule colors/labels ────────────────────────────

const CARD_EPIC_COLOR: Record<EpicCardState, string> = {
  blocked: "#b8746f",
  on_hold: "#b79a68",
  on_track: "#7ba489",
  done: "#7b98bd",
  not_started: "#5a6672",
};

const CARD_EPIC_RING: Record<EpicCardState, string> = {
  blocked: "rgba(184,116,111,.34)",
  on_hold: "rgba(183,154,104,.32)",
  on_track: "rgba(123,164,137,.30)",
  done: "rgba(123,152,189,.30)",
  not_started: "rgba(255,255,255,.07)",
};

const CARD_EPIC_LABEL: Record<EpicCardState, string> = {
  blocked: "Blocked",
  on_hold: "On hold",
  on_track: "On track",
  done: "Done",
  not_started: "Not started",
};

/** Tooltip section header per epic state, colored the same as the epic's own state. */
const CARD_EPIC_SECTION_LABEL: Record<EpicCardState, string> = {
  blocked: "Blocking issue",
  on_hold: "On hold",
  on_track: "Next up",
  done: "Last closed",
  not_started: "Not started",
};

const CARD_ISSUE_DOT_COLOR: Record<IssueCardState, string> = {
  blocked: "#b8746f",
  on_hold: "#b79a68",
  open: "#7c8a99",
  closed: "#7b98bd",
};

/** Sort/pick priority when choosing which issue(s) to surface in the tooltip. */
const CARD_ISSUE_RANK: Record<IssueCardState, number> = { blocked: 0, on_hold: 1, open: 2, closed: 3 };

interface CardIssue {
  id: string;
  title: string;
  state: IssueCardState;
  meta: string;
  url: string;
}

interface CardEpic {
  epicId: number;
  name: string;
  state: EpicCardState;
  total: number;
  closed: number;
  issues: CardIssue[];
}

/** Real epics/issues for a milestone, mapped into the card's generic shape. */
function buildCardEpics(milestoneId: number): CardEpic[] {
  return epicsForMilestone(milestoneId).map((ep) => {
    const issues = issuesForEpic(ep.id);
    return {
      epicId: ep.id,
      name: ep.githubNumber ? `#${ep.githubNumber} ${ep.title}` : ep.title,
      state: epicCardState(ep),
      total: issues.length,
      closed: issues.filter((i) => i.status === "done" || i.status === "closed").length,
      issues: issues.map((i) => ({
        id: i.githubNumber ? `#${i.githubNumber}` : `#${i.id}`,
        title: i.title,
        state: issueCardState(i),
        meta: formatIssueAge(i.createdAt, i.closedAt),
        url: i.githubUrl ?? (i.githubNumber ? githubIssueUrl(i.githubNumber) : "#"),
      })),
    };
  });
}

/** Which issue(s) the tooltip shows: every blocked issue (max 2) if the epic itself
 *  is blocked, otherwise just the single highest-priority issue. */
function pickTooltipIssues(epic: CardEpic): CardIssue[] {
  const sorted = [...epic.issues].sort((a, b) => CARD_ISSUE_RANK[a.state] - CARD_ISSUE_RANK[b.state]);
  if (epic.state === "blocked") return sorted.filter((i) => i.state === "blocked").slice(0, 2);
  return sorted.slice(0, 1);
}

function EpicTooltip({
  epic, index, total, onMouseEnter, onMouseLeave,
}: {
  epic: CardEpic; index: number; total: number;
  onMouseEnter: () => void; onMouseLeave: () => void;
}) {
  const pct = epic.total > 0 ? Math.round((epic.closed / epic.total) * 100) : 0;
  const leftPct = Math.min(88, Math.max(12, ((index + 0.5) / total) * 100));
  const pickedIssues = pickTooltipIssues(epic);
  const stateColor = CARD_EPIC_COLOR[epic.state];

  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: "absolute",
        bottom: 8,
        left: `${leftPct}%`,
        transform: "translateX(-50%)",
        width: 246,
        borderRadius: 12,
        background: "rgba(18,24,31,.94)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: "1px solid rgba(255,255,255,.11)",
        boxShadow: "0 12px 30px rgba(0,0,0,.55)",
        padding: 12,
        zIndex: 50,
        pointerEvents: "auto",
        animation: "milestone-card-tooltip-in 150ms ease-out",
        fontFamily: FONT.sans,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", flex: "none", background: stateColor }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: "#e8edf2" }}>{epic.name}</span>
      </div>
      <div style={{ fontSize: 11, color: "#8b98a6", marginTop: 4, marginLeft: 14 }}>
        {CARD_EPIC_LABEL[epic.state]} · {epic.closed}/{epic.total} · {pct}%
      </div>

      <div style={{ height: 1, background: "rgba(255,255,255,.08)", margin: "10px 0 8px" }} />

      <div style={{
        fontSize: 9.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em",
        color: stateColor, marginBottom: 6,
      }}>
        {CARD_EPIC_SECTION_LABEL[epic.state]}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {pickedIssues.length === 0 ? (
          <div style={{ fontSize: 11, color: "#7c8a99" }}>No issues yet</div>
        ) : pickedIssues.map((issue) => (
          <a
            key={issue.id}
            href={issue.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "flex", alignItems: "center", gap: 7,
              padding: "6px 7px", borderRadius: 8,
              background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.07)",
              textDecoration: "none", transition: "background 160ms, border-color 160ms",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,.08)";
              e.currentTarget.style.borderColor = "rgba(255,255,255,.14)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,.04)";
              e.currentTarget.style.borderColor = "rgba(255,255,255,.07)";
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", flex: "none", background: CARD_ISSUE_DOT_COLOR[issue.state] }} />
            <span style={{ flex: 1, fontSize: 11.5, color: "#dbe3ea", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {issue.id} {issue.title}
            </span>
            <span style={{ fontSize: 10, color: "#78859a", flex: "none" }}>{issue.meta}</span>
            <ArrowUpRight size={11} color="#78859a" strokeWidth={2} style={{ flex: "none" }} />
          </a>
        ))}
      </div>
    </div>
  );
}

function EpicCapsuleBar({ epics, onEpicClick }: { epics: CardEpic[]; onEpicClick: (epic: CardEpic) => void }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  function openNow(i: number) {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setHovered(i);
  }
  function scheduleClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setHovered(null), 260);
  }

  return (
    <div style={{ position: "relative", display: "flex", gap: 5 }} onMouseLeave={scheduleClose}>
      {epics.map((ep, i) => {
        const pct = ep.total > 0 ? Math.round((ep.closed / ep.total) * 100) : 0;
        const color = CARD_EPIC_COLOR[ep.state];
        const ring = CARD_EPIC_RING[ep.state];
        const isHovered = hovered === i;
        return (
          <div
            key={ep.epicId}
            role="button"
            tabIndex={0}
            aria-label={`${ep.name}, ${CARD_EPIC_LABEL[ep.state]}, ${ep.closed} of ${ep.total} issues`}
            onMouseEnter={() => openNow(i)}
            onFocus={() => openNow(i)}
            onBlur={scheduleClose}
            onKeyDown={(e) => { if (e.key === "Escape") setHovered(null); }}
            onClick={(e) => { e.stopPropagation(); onEpicClick(ep); }}
            style={{
              flex: 1, height: 8, borderRadius: 999, position: "relative",
              background: "rgba(255,255,255,.075)",
              boxShadow: `inset 0 0 0 1px ${isHovered ? color : ring}`,
              cursor: "pointer", outline: "none",
            }}
          >
            <div style={{ height: "100%", borderRadius: 999, background: color, width: `${pct}%`, transition: "width 320ms" }} />
          </div>
        );
      })}

      {hovered !== null && epics[hovered] && (
        <EpicTooltip
          epic={epics[hovered]}
          index={hovered}
          total={epics.length}
          onMouseEnter={() => openNow(hovered)}
          onMouseLeave={scheduleClose}
        />
      )}
    </div>
  );
}

export const STATUS_COLOR: Record<MilestoneStatus, string> = {
  open: ACCENT.info,
  in_progress: ACCENT.amber,
  closed: ACCENT.greenSoft,
};

export const STATUS_LABEL: Record<MilestoneStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  closed: "Completed",
};

// ── Milestone Card ─────────────────────────────────────────────────────────────

function MilestoneCard({
  milestone,
  focused,
  onFocusToggle,
  onSelect,
}: {
  milestone: MilestoneRow;
  focused: boolean;
  onFocusToggle: () => void;
  onSelect: () => void;
}) {
  useStore(); // re-render as epics/issues change — buildCardEpics reads the store directly
  const epics = buildCardEpics(milestone.id);
  const totalIssues = epics.reduce((sum, e) => sum + e.total, 0);
  const closedIssues = epics.reduce((sum, e) => sum + e.closed, 0);
  const overallPct = totalIssues > 0 ? Math.round((closedIssues / totalIssues) * 100) : 0;
  const cardStatus: "Open" | "Closed" = milestone.status === "closed" ? "Closed" : "Open";
  const title = milestone.githubNumber ? `#${milestone.githubNumber} ${milestone.title}` : milestone.title;

  return (
    <div
      onClick={onSelect}
      style={{
        width: 340,
        padding: 16,
        borderRadius: 18,
        background: "rgba(255,255,255,.045)",
        backdropFilter: "blur(24px) saturate(150%)",
        WebkitBackdropFilter: "blur(24px) saturate(150%)",
        border: focused ? `1px solid ${ACCENT.amber}80` : "1px solid rgba(255,255,255,.085)",
        boxShadow: focused
          ? `inset 0 1px 0 rgba(255,255,255,.07), 0 0 0 1px ${ACCENT.amber}40, 0 12px 32px rgba(0,0,0,.42)`
          : "inset 0 1px 0 rgba(255,255,255,.07), 0 12px 32px rgba(0,0,0,.42)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        flex: "none",
        cursor: "pointer",
        transition: "border-color 150ms, box-shadow 150ms",
        fontFamily: FONT.sans,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Flag size={12} color="#8ba7c4" strokeWidth={2} />
          <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#8ba7c4" }}>
            {cardStatus}
          </span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onFocusToggle();
          }}
          title={focused ? "Exit Focus Mode" : "Focus on this Milestone"}
          style={{
            display: "flex", alignItems: "center", gap: 4,
            padding: "3px 9px", borderRadius: 999,
            background: focused ? `${ACCENT.amber}22` : "rgba(255,255,255,.05)",
            border: `1px solid ${focused ? ACCENT.amber + "60" : "rgba(255,255,255,.09)"}`,
            color: focused ? ACCENT.amber : "#93a1b0",
            fontSize: 11, fontWeight: 500, cursor: "pointer", fontFamily: FONT.sans,
          }}
        >
          <Target size={11} strokeWidth={2} />
          {focused ? "Focused" : "Focus"}
        </button>
      </div>

      <div>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 650, letterSpacing: "-0.01em", color: "#eef2f6" }}>
          {title}
        </h3>
        {milestone.description && (
          <p style={{
            margin: "4px 0 0", fontSize: 12.5, lineHeight: 1.45, color: "#8b98a6",
            textWrap: "pretty" as React.CSSProperties["textWrap"],
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
          }}>
            {milestone.description}
          </p>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11.5, color: "#7c8a99" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <Clock size={12} strokeWidth={2} />
          <span>{milestone.targetDate ?? "No target date"}</span>
        </div>
        <span>{epics.length} epics · {overallPct}% done</span>
      </div>

      <EpicCapsuleBar
        epics={epics}
        onEpicClick={(ep) => { selectEpic(ep.epicId); }}
      />
    </div>
  );
}

// ── Interactive Gantt Chart ───────────────────────────────────────────────────

/**
 * Also reused by `BuildTrackerBody.tsx`'s `MilestoneDetail` — Shane asked for
 * a milestone's own page to be "basically like the Milestones & Roadmap now
 * with a Gantt etc, scoped to that one milestone," and `focusedMilestoneId`
 * already does exactly that scoping, so this is the same component rather
 * than a second Gantt implementation to keep in sync.
 */
export function GanttChart({
  focusedMilestoneId,
  onSelectMilestone,
}: {
  focusedMilestoneId: number | null;
  onSelectMilestone: (id: number) => void;
}) {
  const state = useStore();
  const milestones = focusedMilestoneId
    ? state.milestones.filter((m) => m.id === focusedMilestoneId)
    : state.milestones;

  return (
    <div style={{
      background: SURFACE.card,
      borderRadius: 8,
      border: `1px solid ${LINE.quiet}`,
      padding: 16,
      display: "flex",
      flexDirection: "column",
      gap: 16,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: TEXT.primary }}>
            Project Gantt Chart & Roadmap
          </h3>
          <p style={{ margin: "2px 0 0", fontSize: 11.5, color: TEXT.caption }}>
            Visual timeline showing Milestone targets, associated Epics, and progress completion
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: TEXT.dim }}>Timeline view: August - September 2026</span>
        </div>
      </div>

      {/* Time Axis Header */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "220px repeat(6, 1fr)",
        gap: 2,
        background: SURFACE.well,
        padding: "8px 12px",
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 700,
        color: TEXT.dim,
      }}>
        <div>Milestone / Epic</div>
        <div>Aug 1 - Aug 10</div>
        <div>Aug 11 - Aug 20</div>
        <div>Aug 21 - Aug 31</div>
        <div>Sep 1 - Sep 10</div>
        <div>Sep 11 - Sep 20</div>
        <div>Sep 21 - Sep 30</div>
      </div>

      {/* Rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {milestones.map((m) => {
          const mEpics = epicsForMilestone(m.id);
          return (
            <div key={m.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {/* Milestone Row Header */}
              <div
                onClick={() => onSelectMilestone(m.id)}
                title="Click to view & edit Milestone details"
                style={{
                  display: "grid",
                  gridTemplateColumns: "220px 1fr",
                  gap: 12,
                  alignItems: "center",
                  background: `${SURFACE.well}99`,
                  padding: "8px 10px",
                  borderRadius: 6,
                  borderLeft: `3px solid ${STATUS_COLOR[m.status]}`,
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}>
                  <Flag size={12} color={STATUS_COLOR[m.status]} style={{ flex: "none" }} />
                  <strong style={{ fontSize: 12, color: TEXT.primary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {m.title}
                  </strong>
                </div>

                {/* Milestone Gantt Bar */}
                <div style={{ position: "relative", height: 24, background: SURFACE.well, borderRadius: 4, overflow: "hidden" }}>
                  <div style={{
                    position: "absolute",
                    left: m.id === 1 ? "0%" : m.id === 2 ? "25%" : "50%",
                    width: m.id === 1 ? "40%" : m.id === 2 ? "50%" : "45%",
                    height: "100%",
                    background: `${STATUS_COLOR[m.status]}25`,
                    border: `1px solid ${STATUS_COLOR[m.status]}`,
                    borderRadius: 4,
                    display: "flex",
                    alignItems: "center",
                    padding: "0 8px",
                    fontSize: 10.5,
                    fontWeight: 700,
                    color: STATUS_COLOR[m.status],
                  }}>
                    Target: {m.targetDate ?? "Unscheduled"}
                  </div>
                </div>
              </div>

              {/* Epic Sub-rows — a bar spanning the epic's real created→(closed or
                  today+estimate) timeframe on the fixed Aug–Sep axis above, colored
                  by the same blocked/aged/done/open verdict the bubbles used. */}
              {mEpics.map((ep) => {
                const epIssues = state.issues.filter((i) => i.epicId === ep.id);
                const doneCount = epIssues.filter((i) => i.status === "done" || i.status === "closed").length;
                const epPct = epIssues.length > 0 ? Math.round((doneCount / epIssues.length) * 100) : 0;
                const bubbleStatus = epicBubbleStatus(ep);
                const barColor = BUBBLE_COLOR[bubbleStatus];
                const span = epicGanttSpan(ep);

                return (
                  <div key={ep.id} style={{
                    display: "grid",
                    gridTemplateColumns: "220px 1fr",
                    gap: 12,
                    alignItems: "center",
                    paddingLeft: 16,
                  }}>
                    <div
                      onClick={() => selectEpic(ep.id)}
                      style={{
                        display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
                        fontSize: 11.5, color: TEXT.quiet, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                      }}
                      title="Click to view Epic detail"
                    >
                      <GitBranch size={11} color={ACCENT.info} style={{ flex: "none" }} />
                      <span>{ep.githubNumber ? `#${ep.githubNumber} ` : ""}{ep.title}</span>
                    </div>

                    <div style={{ position: "relative", height: 18, background: SURFACE.well, borderRadius: 3, overflow: "hidden" }}>
                      <div
                        onClick={() => selectEpic(ep.id)}
                        title={`${epPct}% done (${doneCount}/${epIssues.length}) — ${BUBBLE_LABEL[bubbleStatus]} — ${shortDate(span.startMs)} → ${shortDate(span.endMs)}`}
                        style={{
                          position: "absolute",
                          left: `${span.leftPct}%`,
                          width: `${span.widthPct}%`,
                          height: "100%",
                          background: `${barColor}20`,
                          border: `1px solid ${barColor}66`,
                          borderRadius: 3,
                          display: "flex",
                          alignItems: "center",
                          fontSize: 10,
                          fontWeight: 600,
                          color: barColor,
                          overflow: "hidden",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ height: "100%", background: `${barColor}55`, width: `${epPct}%` }} />
                        <span style={{ position: "absolute", left: 6, whiteSpace: "nowrap" }}>
                          {epPct}% ({doneCount}/{epIssues.length})
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Epic Assignment Matrix ────────────────────────────────────────────────────

function EpicAssignmentMatrix() {
  const state = useStore();
  const [query, setQuery] = useState("");
  const unassignedEpics = state.epics.filter((e) => epicIsUnassigned(e) && e.status !== "closed");

  if (unassignedEpics.length === 0) return null;

  const filtered = unassignedEpics.filter((ep) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase().trim().replace(/^#/, "");
    const matchesNumber = ep.githubNumber !== null && String(ep.githubNumber).includes(q);
    const matchesTitle = ep.title.toLowerCase().includes(q);
    return matchesNumber || matchesTitle;
  });

  return (
    <div style={{
      background: SURFACE.card,
      borderRadius: 8,
      border: `1px solid ${LINE.quiet}`,
      padding: 16,
      display: "flex",
      flexDirection: "column",
      gap: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Sparkles size={14} color={ACCENT.amber} />
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: TEXT.primary }}>
              Quick Epic Assignment Matrix ({unassignedEpics.length} unassigned)
            </h3>
          </div>
          <p style={{ margin: "2px 0 0", fontSize: 11.5, color: TEXT.quiet }}>
            Click any milestone pill to map unassigned Epics into project target dates instantly
          </p>
        </div>

        <div style={{ position: "relative", minWidth: 220 }}>
          <input
            type="text"
            placeholder="Search epics by name or #..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              width: "100%",
              padding: "5px 24px 5px 8px",
              borderRadius: 5,
              background: SURFACE.well,
              border: `1px solid ${LINE.control}`,
              color: TEXT.primary,
              fontFamily: FONT.sans,
              fontSize: 11.5,
              outline: "none",
            }}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              style={{
                position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
                background: "transparent", border: 0, color: TEXT.caption, cursor: "pointer", padding: 0,
              }}
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p style={{ fontSize: 12, color: TEXT.dim, margin: "8px 0 0" }}>No unassigned epics match "{query}".</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10, marginTop: 4 }}>
          {filtered.map((ep) => (
            <div key={ep.id} style={{
              padding: 10, borderRadius: 6, background: SURFACE.well, border: `1px solid ${LINE.control}`,
              display: "flex", flexDirection: "column", gap: 8,
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: TEXT.primary }}>
                {ep.githubNumber ? `#${ep.githubNumber} ` : ""}{ep.title}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {state.milestones.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => void assignEpicToMilestone(ep.id, m.id)}
                    style={{
                      padding: "3px 8px", borderRadius: 4, border: `1px solid ${LINE.control}`,
                      background: SURFACE.card, color: TEXT.quiet, fontSize: 10.5, fontWeight: 600,
                      cursor: "pointer", fontFamily: FONT.sans,
                    }}
                    title={`Map to "${m.title}"`}
                  >
                    + {m.title}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Edit Milestone Modal ──────────────────────────────────────────────────────

function EditMilestoneModal({
  milestoneId,
  onClose,
}: {
  milestoneId: number;
  onClose: () => void;
}) {
  const state = useStore();
  const milestone = milestoneById(milestoneId);

  // Title/description are free text — batched into local state and
  // auto-saved on blur so every keystroke doesn't fire a PATCH. Status and
  // the two dates are discrete choices (a click, a date-picker pick), so
  // they read straight from the store and save immediately on change —
  // there is nothing here that needs a separate "Save Changes" click.
  const [title, setTitle] = useState(milestone?.title ?? "");
  const [desc, setDesc] = useState(milestone?.description ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!milestone) return null;

  const assignedEpics = epicsForMilestone(milestoneId);
  const saving = state.savingIds.has(`milestone:${milestoneId}`);

  function commitTitle() {
    if (title !== milestone!.title) void updateMilestone(milestoneId, { title });
  }
  function commitDesc() {
    if (desc !== (milestone!.description ?? "")) void updateMilestone(milestoneId, { description: desc || null });
  }

  async function handleDelete() {
    await deleteMilestone(milestoneId);
    onClose();
  }

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center",
      justifyContent: "center", zIndex: 9999, padding: 20,
    }}>
      <div style={{
        background: SURFACE.card, border: `1px solid ${LINE.quiet}`,
        borderRadius: 8, padding: 24, width: "100%", maxWidth: 540,
        display: "flex", flexDirection: "column", gap: 16, maxHeight: "90vh", overflowY: "auto",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: STATUS_COLOR[milestone.status] }}>
              Edit Milestone{saving ? " · Saving…" : ""}
            </span>
            <h3 style={{ margin: "2px 0 0", fontSize: 18, fontWeight: 800, color: TEXT.primary }}>
              {milestone.githubNumber ? `#${milestone.githubNumber} ` : ""}{milestone.title}
            </h3>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: 0, color: TEXT.dim, cursor: "pointer" }}>
            <X size={18} />
          </button>
        </div>

        {state.message && (
          <p style={{ fontSize: 11, color: state.messageTone === "error" ? ACCENT.danger : ACCENT.green, margin: 0 }}>{state.message}</p>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Status Switcher — saves immediately on click, no confirm step needed. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: TEXT.caption }}>Status</label>
            <div style={{ display: "flex", gap: 6 }}>
              {(["open", "in_progress", "closed"] as MilestoneStatus[]).map((st) => (
                <button
                  key={st}
                  onClick={() => { if (milestone.status !== st) void updateMilestone(milestoneId, { status: st }); }}
                  style={{
                    padding: "4px 10px", borderRadius: 5, fontSize: 11, fontWeight: 700,
                    border: `1px solid ${milestone.status === st ? STATUS_COLOR[st] : LINE.control}`,
                    background: milestone.status === st ? `${STATUS_COLOR[st]}22` : SURFACE.well,
                    color: milestone.status === st ? STATUS_COLOR[st] : TEXT.quiet,
                    cursor: "pointer", fontFamily: FONT.sans,
                  }}
                >
                  {STATUS_LABEL[st]}
                </button>
              ))}
            </div>
          </div>

          {/* Title/Description are free text — save on blur. Status and the
              dates below are discrete picks, so they save on change/click,
              straight against the store, with no local draft state at all. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: TEXT.caption }}>Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commitTitle}
              style={{
                padding: "8px 10px", borderRadius: 5, background: SURFACE.well,
                border: `1px solid ${LINE.control}`, color: TEXT.primary, fontSize: 12.5, outline: "none",
              }}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: TEXT.caption }}>Start Date</label>
              <input
                type="date"
                value={milestone.startDate ?? ""}
                onChange={(e) => void updateMilestone(milestoneId, { startDate: e.target.value || null })}
                style={{
                  padding: "8px 10px", borderRadius: 5, background: SURFACE.well,
                  border: `1px solid ${LINE.control}`, color: TEXT.primary, fontSize: 12.5, outline: "none",
                }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: TEXT.caption }}>Target Completion Date</label>
              <input
                type="date"
                value={milestone.targetDate ?? ""}
                onChange={(e) => void updateMilestone(milestoneId, { targetDate: e.target.value || null })}
                style={{
                  padding: "8px 10px", borderRadius: 5, background: SURFACE.well,
                  border: `1px solid ${LINE.control}`, color: TEXT.primary, fontSize: 12.5, outline: "none",
                }}
              />
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: TEXT.caption }}>Description</label>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              onBlur={commitDesc}
              rows={4}
              style={{
                padding: "8px 10px", borderRadius: 5, background: SURFACE.well,
                border: `1px solid ${LINE.control}`, color: TEXT.primary, fontSize: 12.5, outline: "none", resize: "vertical",
              }}
            />
          </div>

          {/* Assigned Epics */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: TEXT.caption }}>
              Assigned Epics ({assignedEpics.length})
            </label>
            {assignedEpics.length === 0 ? (
              <p style={{ fontSize: 11.5, color: TEXT.dim, margin: 0 }}>No epics assigned to this milestone yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {assignedEpics.map((ep) => (
                  <div key={ep.id} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "6px 10px", background: SURFACE.well, borderRadius: 5, border: `1px solid ${LINE.quiet}`,
                    fontSize: 12, color: TEXT.primary,
                  }}>
                    <span>{ep.githubNumber ? `#${ep.githubNumber} ` : ""}{ep.title}</span>
                    <button
                      onClick={() => void assignEpicToMilestone(ep.id, null)}
                      title="Unassign Epic"
                      style={{ background: "transparent", border: 0, color: ACCENT.danger, cursor: "pointer", padding: 2 }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, paddingTop: 12, borderTop: `1px solid ${LINE.quiet}` }}>
          <button
            onClick={() => {
              if (confirmDelete) void handleDelete();
              else setConfirmDelete(true);
            }}
            style={{
              padding: "6px 12px", borderRadius: 5, border: `1px solid ${ACCENT.danger}40`,
              background: `${ACCENT.danger}15`, color: ACCENT.danger, fontSize: 11.5, fontWeight: 600, cursor: "pointer",
            }}
          >
            {confirmDelete ? "Confirm Delete" : "Delete Milestone"}
          </button>

          {/* Everything above already saved itself — this just closes the
              dialog, same as the X in the corner. */}
          <button
            onClick={onClose}
            style={{
              padding: "6px 14px", borderRadius: 5, border: 0,
              background: ACCENT.info, color: SURFACE.well, fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function ProjectManagementBody() {
  const state = useStore();
  const [focusedMilestoneId, setFocusedMilestoneId] = useState<number | null>(null);
  const [editingMilestoneId, setEditingMilestoneId] = useState<number | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newTargetDate, setNewTargetDate] = useState("");

  useEffect(() => {
    function handleOpen() {
      setShowCreateModal(true);
    }
    window.addEventListener("open-new-milestone-modal", handleOpen);
    return () => window.removeEventListener("open-new-milestone-modal", handleOpen);
  }, []);

  async function handleCreate() {
    if (!newTitle.trim()) return;
    await createMilestone(newTitle.trim(), newTargetDate || null, newDesc || null);
    setNewTitle("");
    setNewDesc("");
    setNewTargetDate("");
    setShowCreateModal(false);
  }

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 24, maxWidth: 1100, margin: "0 auto", width: "100%" }}>
      <style>{"@keyframes milestone-card-tooltip-in { from { opacity: 0; transform: translateX(-50%) translateY(3px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }"}</style>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: ACCENT.amber }}>
            Project Management Studio
          </span>
          <h1 style={{ margin: "4px 0 0", fontSize: 22, fontWeight: 800, color: TEXT.bright }}>
            Milestones & Roadmap
          </h1>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {focusedMilestoneId !== null && (
            <button
              onClick={() => setFocusedMilestoneId(null)}
              style={{
                padding: "6px 12px", borderRadius: 6, border: `1px solid ${ACCENT.amber}`,
                background: `${ACCENT.amber}15`, color: ACCENT.amber, fontSize: 12, fontWeight: 600,
                cursor: "pointer", fontFamily: FONT.sans, display: "flex", alignItems: "center", gap: 6,
              }}
            >
              <X size={12} /> Clear Focus
            </button>
          )}

          <button
            onClick={() => setShowCreateModal(true)}
            style={{
              padding: "6px 14px", borderRadius: 6, border: 0,
              background: ACCENT.info, color: SURFACE.well, fontSize: 12, fontWeight: 600,
              cursor: "pointer", fontFamily: FONT.sans, display: "flex", alignItems: "center", gap: 6,
            }}
          >
            <Plus size={14} /> New Milestone
          </button>
        </div>
      </div>

      {/* Top Milestone Timeline */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: TEXT.caption }}>
            Milestone Timeline ({state.milestones.length})
          </span>
          {focusedMilestoneId !== null && (
            <span style={{ fontSize: 11, color: ACCENT.amber, fontWeight: 600 }}>
              🎯 Focus Mode Active
            </span>
          )}
        </div>

        {state.milestones.length === 0 ? (
          <div style={{
            padding: "16px 20px", borderRadius: 8, background: SURFACE.card, border: `1px solid ${LINE.quiet}`,
            fontSize: 12.5, color: TEXT.quiet, display: "flex", alignItems: "center", gap: 10
          }}>
            <Flag size={14} color={ACCENT.info} />
            <span>No Milestones in GitHub yet. Click <strong>"+ New Milestone"</strong> to create your first GitHub milestone!</span>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 6 }} data-noscrollbar="true">
            {state.milestones.map((m) => (
              <MilestoneCard
                key={m.id}
                milestone={m}
                focused={focusedMilestoneId === m.id}
                onFocusToggle={() => setFocusedMilestoneId(focusedMilestoneId === m.id ? null : m.id)}
                onSelect={() => setEditingMilestoneId(m.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Gantt Chart */}
      <GanttChart
        focusedMilestoneId={focusedMilestoneId}
        onSelectMilestone={(id) => setEditingMilestoneId(id)}
      />

      {/* Epic Assignment Matrix */}
      <EpicAssignmentMatrix />

      {/* Edit Milestone Modal */}
      {editingMilestoneId !== null && (
        <EditMilestoneModal
          milestoneId={editingMilestoneId}
          onClose={() => setEditingMilestoneId(null)}
        />
      )}

      {/* New Milestone Modal */}
      {showCreateModal && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center",
          justifyContent: "center", zIndex: 9999, padding: 40,
        }}>
          <div style={{
            background: SURFACE.card, border: `1px solid ${LINE.quiet}`,
            borderRadius: 8, padding: 24, width: "100%", maxWidth: 480,
            display: "flex", flexDirection: "column", gap: 16,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: TEXT.primary }}>Create New Milestone</h3>
              <button
                onClick={() => setShowCreateModal(false)}
                style={{ background: "transparent", border: 0, color: TEXT.dim, cursor: "pointer" }}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: TEXT.caption }}>Title</label>
                <input
                  type="text"
                  placeholder="e.g. v2.0 Platform Launch"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  style={{
                    padding: "8px 10px", borderRadius: 5, background: SURFACE.well,
                    border: `1px solid ${LINE.control}`, color: TEXT.primary, fontSize: 12.5, outline: "none",
                  }}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: TEXT.caption }}>Target Completion Date</label>
                <input
                  type="date"
                  value={newTargetDate}
                  onChange={(e) => setNewTargetDate(e.target.value)}
                  style={{
                    padding: "8px 10px", borderRadius: 5, background: SURFACE.well,
                    border: `1px solid ${LINE.control}`, color: TEXT.primary, fontSize: 12.5, outline: "none",
                  }}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: TEXT.caption }}>Description</label>
                <textarea
                  placeholder="Target goals, scope, and key deliverables..."
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  rows={3}
                  style={{
                    padding: "8px 10px", borderRadius: 5, background: SURFACE.well,
                    border: `1px solid ${LINE.control}`, color: TEXT.primary, fontSize: 12.5, outline: "none", resize: "vertical",
                  }}
                />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
              <button
                onClick={() => setShowCreateModal(false)}
                style={{
                  padding: "6px 14px", borderRadius: 5, border: `1px solid ${LINE.control}`,
                  background: "transparent", color: TEXT.quiet, fontSize: 12, cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => void handleCreate()}
                disabled={!newTitle.trim()}
                style={{
                  padding: "6px 14px", borderRadius: 5, border: 0,
                  background: ACCENT.info, color: SURFACE.well, fontSize: 12, fontWeight: 600,
                  cursor: "pointer", opacity: !newTitle.trim() ? 0.4 : 1,
                }}
              >
                Create Milestone
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
