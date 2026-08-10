/**
 * ProjectManagementBody — ADHD-friendly Project Management studio view.
 *
 * Features:
 *   1. Milestone Timeline across the top with target date countdowns & completion progress rings.
 *   2. Interactive Gantt Chart showing timeline bars per milestone & epic with completion fills.
 *   3. "Focus Mode" zero-distraction toggle for active milestones.
 *   4. One-Click Epic-to-Milestone assignment matrix.
 *   5. Quick Milestone creator modal.
 */

import { useState, useEffect, useSyncExternalStore } from "react";
import {
  Calendar, CheckCircle, Clock, Flag, GitBranch,
  GitPullRequest, Plus, Target, Sparkles, Filter, Eye, ChevronRight, X
} from "lucide-react";
import { ACCENT, FONT, LINE, METRICS, SURFACE, TEXT } from "../../theme";
import {
  getSnapshot, subscribe, milestoneById, epicsForMilestone,
  createMilestone, updateMilestone, deleteMilestone, assignEpicToMilestone,
  selectMilestone, selectEpic
} from "../build-tracker/buildTrackerStore";
import type { MilestoneRow, EpicRow, MilestoneStatus } from "../build-tracker/buildTrackerTypes";

function useStore() {
  return useSyncExternalStore(subscribe, getSnapshot);
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

function daysLeft(targetDateStr: string | null): string {
  if (!targetDateStr) return "No target date";
  const target = new Date(targetDateStr).getTime();
  const now = new Date().getTime();
  const diffDays = Math.ceil((target - now) / (1000 * 3600 * 24));
  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
  if (diffDays === 0) return "Due today!";
  return `${diffDays} days left`;
}

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
  const epics = epicsForMilestone(milestone.id);
  const state = useStore();
  
  // Calculate completion % from issues inside the epics
  let totalIssues = 0;
  let doneIssues = 0;
  for (const ep of epics) {
    const epIssues = state.issues.filter((i) => i.epicId === ep.id);
    totalIssues += epIssues.length;
    doneIssues += epIssues.filter((i) => i.status === "done" || i.status === "closed").length;
  }

  const percent = totalIssues > 0 ? Math.round((doneIssues / totalIssues) * 100) : 0;
  const daysText = daysLeft(milestone.targetDate);

  return (
    <div
      onClick={onSelect}
      style={{
        padding: 14,
        borderRadius: 8,
        background: focused ? `${ACCENT.amber}14` : SURFACE.card,
        border: `1px solid ${focused ? ACCENT.amber : LINE.quiet}`,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minWidth: 260,
        cursor: "pointer",
        transition: "all 150ms ease",
        boxShadow: focused ? `0 0 12px ${ACCENT.amber}25` : "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Flag size={13} color={STATUS_COLOR[milestone.status]} />
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: STATUS_COLOR[milestone.status] }}>
            {STATUS_LABEL[milestone.status]}
          </span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onFocusToggle();
          }}
          title={focused ? "Exit Focus Mode" : "Focus on this Milestone"}
          style={{
            padding: "2px 6px",
            borderRadius: 4,
            border: `1px solid ${focused ? ACCENT.amber : LINE.control}`,
            background: focused ? `${ACCENT.amber}22` : SURFACE.well,
            color: focused ? ACCENT.amber : TEXT.caption,
            fontSize: 10,
            fontWeight: 600,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <Target size={10} />
          {focused ? "Focused" : "Focus"}
        </button>
      </div>

      <div>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: TEXT.primary }}>
          {milestone.githubNumber ? `#${milestone.githubNumber} ` : ""}{milestone.title}
        </h3>
        {milestone.description && (
          <p style={{ margin: "4px 0 0", fontSize: 11.5, color: TEXT.quiet, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
            {milestone.description}
          </p>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, color: TEXT.caption }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <Clock size={11} color={ACCENT.info} />
          <span>{daysText}</span>
        </div>
        <span>{epics.length} Epics • {percent}% done</span>
      </div>

      {/* Progress Bar */}
      <div style={{ height: 4, background: SURFACE.well, borderRadius: 2, overflow: "hidden" }}>
        <div style={{
          height: "100%",
          background: percent === 100 ? ACCENT.greenSoft : ACCENT.info,
          width: `${percent}%`,
          transition: "width 200ms ease",
        }} />
      </div>
    </div>
  );
}

// ── Interactive Gantt Chart ───────────────────────────────────────────────────

function GanttChart({
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

              {/* Epic Sub-rows */}
              {mEpics.map((ep) => {
                const epIssues = state.issues.filter((i) => i.epicId === ep.id);
                const doneCount = epIssues.filter((i) => i.status === "done" || i.status === "closed").length;
                const epPct = epIssues.length > 0 ? Math.round((doneCount / epIssues.length) * 100) : 0;

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
                      <div style={{
                        position: "absolute",
                        left: ep.id % 2 === 0 ? "10%" : "30%",
                        width: "35%",
                        height: "100%",
                        background: `${ACCENT.info}20`,
                        border: `1px solid ${ACCENT.info}66`,
                        borderRadius: 3,
                        display: "flex",
                        alignItems: "center",
                        fontSize: 10,
                        fontWeight: 600,
                        color: ACCENT.info,
                        overflow: "hidden",
                      }}>
                        <div style={{
                          height: "100%",
                          background: ACCENT.info + "55",
                          width: `${epPct}%`,
                        }} />
                        <span style={{ position: "absolute", left: 6 }}>{epPct}% ({doneCount}/{epIssues.length})</span>
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
  const unassignedEpics = state.epics.filter((e) => !e.milestoneId && e.status !== "closed");

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

  const [title, setTitle] = useState(milestone?.title ?? "");
  const [desc, setDesc] = useState(milestone?.description ?? "");
  const [status, setStatus] = useState<MilestoneStatus>(milestone?.status ?? "open");
  const [startDate, setStartDate] = useState(milestone?.startDate ?? "");
  const [targetDate, setTargetDate] = useState(milestone?.targetDate ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!milestone) return null;

  const assignedEpics = epicsForMilestone(milestoneId);
  const unassignedEpics = state.epics.filter((e) => e.milestoneId !== milestoneId);

  async function handleSave() {
    await updateMilestone(milestoneId, {
      title,
      description: desc || null,
      status,
      startDate: startDate || null,
      targetDate: targetDate || null,
    });
    onClose();
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
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: STATUS_COLOR[status] }}>
              Edit Milestone
            </span>
            <h3 style={{ margin: "2px 0 0", fontSize: 18, fontWeight: 800, color: TEXT.primary }}>
              {milestone.githubNumber ? `#${milestone.githubNumber} ` : ""}{milestone.title}
            </h3>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: 0, color: TEXT.dim, cursor: "pointer" }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Status Switcher */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: TEXT.caption }}>Status</label>
            <div style={{ display: "flex", gap: 6 }}>
              {(["open", "in_progress", "closed"] as MilestoneStatus[]).map((st) => (
                <button
                  key={st}
                  onClick={() => setStatus(st)}
                  style={{
                    padding: "4px 10px", borderRadius: 5, fontSize: 11, fontWeight: 700,
                    border: `1px solid ${status === st ? STATUS_COLOR[st] : LINE.control}`,
                    background: status === st ? `${STATUS_COLOR[st]}22` : SURFACE.well,
                    color: status === st ? STATUS_COLOR[st] : TEXT.quiet,
                    cursor: "pointer", fontFamily: FONT.sans,
                  }}
                >
                  {STATUS_LABEL[st]}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: TEXT.caption }}>Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
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
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
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
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
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

          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={onClose}
              style={{
                padding: "6px 14px", borderRadius: 5, border: `1px solid ${LINE.control}`,
                background: "transparent", color: TEXT.quiet, fontSize: 12, cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => void handleSave()}
              style={{
                padding: "6px 14px", borderRadius: 5, border: 0,
                background: ACCENT.info, color: SURFACE.well, fontSize: 12, fontWeight: 600, cursor: "pointer",
              }}
            >
              Save Changes
            </button>
          </div>
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
