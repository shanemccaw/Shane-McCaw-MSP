/**
 * BuildTrackerProperties — right panel quick-edit.
 *
 * Context-aware: shows edit fields for whichever entity is selected
 * (epic, issue, or chat). Empty state when nothing is selected.
 */

import { useSyncExternalStore, useState } from "react";
import { Save, ExternalLink } from "lucide-react";
import { ACCENT, FONT, LINE, SURFACE, TEXT } from "../../theme";
import {
  getSnapshot, subscribe,
  epicById, issueById, chatById, milestoneById,
  updateEpic, updateIssue, updateChat, updateMilestone,
  cycleIssueStatus, estimateEpicHours, estimateMilestoneHours, formatIssueAge,
  trimMilestoneToCapacity,
} from "./buildTrackerStore";
import {
  ISSUE_STATUS_COLOR, ISSUE_STATUS_LABEL, ISSUE_STATUS_NEXT,
  EPIC_STATUS_COLOR, EPIC_STATUS_LABEL,
} from "./buildTrackerTypes";
import { STATUS_COLOR, STATUS_LABEL } from "../project-management/ProjectManagementBody";
import type { EpicStatus, IssueStatus } from "./buildTrackerTypes";

function useStore() {
  return useSyncExternalStore(subscribe, getSnapshot);
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: TEXT.caption }}>
      {children}
    </span>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  area?: boolean;
  onOpenModal?: () => void;
}

function Field({ label, value, onChange, area, onOpenModal }: FieldProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Label>{label}</Label>
        {area && onOpenModal && (
          <button
            onClick={onOpenModal}
            style={{
              padding: "2px 6px", borderRadius: 3, border: `1px solid ${LINE.control}`,
              background: SURFACE.well, color: TEXT.quiet, fontSize: 10,
              cursor: "pointer", fontFamily: FONT.sans, fontWeight: 600,
            }}
          >
            🔍 Read Full
          </button>
        )}
      </div>
      {area ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={12}
          style={{
            background: SURFACE.well, border: `1px solid ${LINE.control}`,
            borderRadius: 4, padding: "6px 8px", color: TEXT.primary,
            fontFamily: FONT.sans, fontSize: 12, resize: "vertical", outline: "none",
          }}
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            background: SURFACE.well, border: `1px solid ${LINE.control}`,
            borderRadius: 4, padding: "5px 8px", color: TEXT.primary,
            fontFamily: FONT.sans, fontSize: 12, outline: "none",
          }}
        />
      )}
    </div>
  );
}

function DescriptionModal({
  title, value, onClose,
}: { title: string; value: string; onClose: () => void }) {
  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center",
      justifyContent: "center", zIndex: 9999, padding: 40,
    }}>
      <div style={{
        background: SURFACE.card, border: `1px solid ${LINE.quiet}`,
        borderRadius: 8, padding: 24, width: "100%", maxWidth: 700,
        display: "flex", flexDirection: "column", gap: 16, maxHeight: "80vh",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: TEXT.primary }}>{title}</h3>
          <button
            onClick={onClose}
            style={{
              padding: "4px 10px", borderRadius: 4, border: `1px solid ${LINE.control}`,
              background: "transparent", color: TEXT.dim, cursor: "pointer",
              fontSize: 11, fontFamily: FONT.sans,
            }}
          >
            Close
          </button>
        </div>
        <div style={{
          overflowY: "auto", fontSize: 13, color: TEXT.primary,
          lineHeight: 1.6, background: SURFACE.well, padding: 16,
          borderRadius: 6, border: `1px solid ${LINE.control}`,
          fontFamily: FONT.mono, whiteSpace: "pre-wrap", flex: 1,
        }}>
          {value || "No content."}
        </div>
      </div>
    </div>
  );
}

function SaveButton({ onClick, saving }: { onClick: () => void; saving?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={saving}
      style={{
        display: "flex", alignItems: "center", gap: 5,
        padding: "5px 12px", borderRadius: 4, border: 0, cursor: "pointer",
        background: ACCENT.info + "22", color: ACCENT.info,
        fontFamily: FONT.sans, fontSize: 12, fontWeight: 600,
        opacity: saving ? 0.5 : 1,
      }}
    >
      <Save size={12} />
      {saving ? "Saving…" : "Save"}
    </button>
  );
}

// ── Epic properties ────────────────────────────────────────────────────────────

function EpicProperties({ id }: { id: number }) {
  const state = useStore();
  const epic = epicById(id);
  const [title, setTitle]       = useState(epic?.title ?? "");
  const [desc, setDesc]         = useState(epic?.description ?? "");
  const [modalOpen, setModalOpen] = useState(false);
  const saving = state.savingIds.has(`epic:${id}`);

  if (!epic) return null;

  const statusCycle: EpicStatus[] = ["open", "in_progress", "closed"];
  const nextStatus = statusCycle[(statusCycle.indexOf(epic.status) + 1) % statusCycle.length];

  const estHours = estimateEpicHours(id);
  const ageStr = formatIssueAge(epic.createdAt, epic.closedAt);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Label>Epic</Label>
          <button
            onClick={() => void updateEpic(id, { status: nextStatus })}
            style={{
              fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em",
              padding: "2px 6px", borderRadius: 3, border: 0, cursor: "pointer",
              background: `${EPIC_STATUS_COLOR[epic.status]}22`, color: EPIC_STATUS_COLOR[epic.status],
            }}
          >
            {EPIC_STATUS_LABEL[epic.status]} →
          </button>
        </div>
        <span style={{ fontSize: 10, color: TEXT.caption, fontFamily: FONT.sans, fontWeight: 600 }}>
          Open {ageStr}
        </span>
      </div>

      <div style={{ padding: "6px 8px", borderRadius: 5, background: SURFACE.well, border: `1px solid ${LINE.quiet}`, fontSize: 11, color: TEXT.quiet }}>
        ⏱️ Est. Remaining Work: <strong>{estHours} hours</strong> ({(estHours / 8).toFixed(1)} days)
      </div>

      <Field label="Title" value={title} onChange={setTitle} />
      <Field label="Description" value={desc} onChange={setDesc} area onOpenModal={() => setModalOpen(true)} />

      {modalOpen && (
        <DescriptionModal
          title={`Epic #${epic.githubNumber ?? "Local"}: ${epic.title}`}
          value={desc}
          onClose={() => setModalOpen(false)}
        />
      )}

      {state.message && (
        <p style={{ fontSize: 11, color: ACCENT.green, margin: 0 }}>{state.message}</p>
      )}
      <SaveButton saving={saving} onClick={() => void updateEpic(id, { title, description: desc })} />

      <div style={{ fontSize: 11, color: TEXT.dim }}>
        <p style={{ margin: 0 }}>{epic.issueCount} issue{epic.issueCount !== 1 ? "s" : ""}</p>
        <p style={{ margin: "2px 0 0" }}>{epic.chatCount} chat{epic.chatCount !== 1 ? "s" : ""} linked</p>
      </div>
    </div>
  );
}

// ── Issue properties ───────────────────────────────────────────────────────────

function IssueProperties({ id }: { id: number }) {
  const state = useStore();
  const issue = issueById(id);
  const [title, setTitle] = useState(issue?.title ?? "");
  const [desc, setDesc]   = useState(issue?.description ?? "");
  const [modalOpen, setModalOpen] = useState(false);
  const saving = state.savingIds.has(`issue:${id}`);

  if (!issue) return null;

  const next = ISSUE_STATUS_NEXT[issue.status];

  function handleCopyProse() {
    if (!issue) return;
    const numStr = issue.githubNumber ? ` #${issue.githubNumber}` : "";
    const prose = `Please research the codebase for this task:
Issue:${numStr} "${issue.title}"

Description:
${issue.description || "No description provided."}

Please find the relevant files, analyze the requirements, and suggest a clear implementation plan.`;

    navigator.clipboard.writeText(prose);
    alert("Copied Claude research prompt to clipboard!");
  }

  const ageStr = formatIssueAge(issue.createdAt, issue.closedAt);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Label>Issue</Label>
          <button
            onClick={() => void cycleIssueStatus(id, next)}
            style={{
              fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em",
              padding: "2px 6px", borderRadius: 3, border: 0, cursor: "pointer",
              background: `${ISSUE_STATUS_COLOR[issue.status]}22`, color: ISSUE_STATUS_COLOR[issue.status],
            }}
          >
            {ISSUE_STATUS_LABEL[issue.status]} →
          </button>
        </div>
        <span style={{ fontSize: 10, color: TEXT.caption, fontFamily: FONT.sans, fontWeight: 600 }}>
          {issue.status === "closed" || issue.status === "done" ? "Done in " : "Open "} {ageStr}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Label>Title</Label>
          <button
            onClick={handleCopyProse}
            style={{
              padding: "3px 6px", borderRadius: 4, border: `1px solid ${ACCENT.amber}40`,
              background: `${ACCENT.amber}15`, color: ACCENT.amber, fontSize: 10,
              cursor: "pointer", fontFamily: FONT.sans, fontWeight: 700,
            }}
          >
            📋 Copy Claude research prompt
          </button>
        </div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{
            background: SURFACE.well, border: `1px solid ${LINE.control}`,
            borderRadius: 4, padding: "5px 8px", color: TEXT.primary,
            fontFamily: FONT.sans, fontSize: 12, outline: "none",
          }}
        />
      </div>

      <Field label="Description / Notes" value={desc} onChange={setDesc} area onOpenModal={() => setModalOpen(true)} />

      {modalOpen && (
        <DescriptionModal
          title={`Issue #${issue.githubNumber ?? "Local"}: ${issue.title}`}
          value={desc}
          onClose={() => setModalOpen(false)}
        />
      )}

      {issue.githubUrl && (
        <a href={issue.githubUrl} target="_blank" rel="noopener noreferrer"
          style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: ACCENT.info, textDecoration: "none" }}>
          <ExternalLink size={11} />
          Open in GitHub #{issue.githubNumber}
        </a>
      )}

      {state.message && (
        <p style={{ fontSize: 11, color: ACCENT.green, margin: 0 }}>{state.message}</p>
      )}
      <SaveButton saving={saving} onClick={() => void updateIssue(id, { title, description: desc })} />
    </div>
  );
}

// ── Chat properties ────────────────────────────────────────────────────────────

function ChatProperties({ id }: { id: number }) {
  const state = useStore();
  const chat = chatById(id);
  const [title, setTitle]       = useState(chat?.title ?? "");
  const [notes, setNotes]       = useState(chat?.notes ?? "");
  const [category, setCategory] = useState(chat?.category ?? "");
  const [modalOpen, setModalOpen] = useState(false);
  const saving = state.savingIds.has(`chat:${id}`);

  if (!chat) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: 12 }}>
      <Label>Chat Link</Label>

      <a
        href={chat.claudeUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "flex", alignItems: "center", gap: 6, padding: "8px 10px",
          background: ACCENT.info + "15", borderRadius: 6, textDecoration: "none",
          border: `1px solid ${ACCENT.info}33`,
        }}
      >
        <ExternalLink size={13} color={ACCENT.info} />
        <span style={{ fontSize: 12, color: ACCENT.info, fontWeight: 600 }}>Open Chat in Claude</span>
      </a>

      <Field label="Label" value={title} onChange={setTitle} />
      <Field label="Category (if free-form)" value={category} onChange={setCategory} />
      <Field label="Notes" value={notes} onChange={setNotes} area onOpenModal={() => setModalOpen(true)} />

      {modalOpen && (
        <DescriptionModal
          title={`Chat Notes: ${chat.title}`}
          value={notes}
          onClose={() => setModalOpen(false)}
        />
      )}

      {state.message && (
        <p style={{ fontSize: 11, color: ACCENT.green, margin: 0 }}>{state.message}</p>
      )}
      <SaveButton saving={saving} onClick={() => void updateChat(id, { title, notes: notes || null, category: category || null })} />

      <p style={{ fontSize: 10, color: TEXT.faintest, margin: 0, fontFamily: FONT.mono, wordBreak: "break-all" }}>
        {chat.conversationId}
      </p>
    </div>
  );
}

// ── Milestone properties ──────────────────────────────────────────────────────

function MilestoneProperties({ id }: { id: number }) {
  const milestone = milestoneById(id);
  const [title, setTitle] = useState(milestone?.title ?? "");
  const [desc, setDesc] = useState(milestone?.description ?? "");
  const [targetDate, setTargetDate] = useState(milestone?.targetDate ?? "");
  const [modalOpen, setModalOpen] = useState(false);

  if (!milestone) return null;

  const est = estimateMilestoneHours(id);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Label>Milestone</Label>
        <span style={{
          fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em",
          padding: "2px 6px", borderRadius: 3,
          background: `${STATUS_COLOR[milestone.status]}22`, color: STATUS_COLOR[milestone.status],
        }}>
          {STATUS_LABEL[milestone.status]}
        </span>
      </div>

      <div style={{ padding: 10, borderRadius: 6, background: SURFACE.well, border: `1px solid ${LINE.quiet}`, display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: ACCENT.amber }}>
          ⏱️ Math Velocity Estimate
        </span>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: TEXT.primary }}>
          {est.totalDays} Days ({est.totalHours} hours)
        </div>
        <span style={{ fontSize: 11, color: TEXT.quiet }}>
          {est.openIssues} open issue(s) remaining
        </span>
        <button
          onClick={() => void trimMilestoneToCapacity(id, 5)}
          style={{
            marginTop: 6, padding: "4px 8px", borderRadius: 4, border: `1px solid ${ACCENT.amber}40`,
            background: `${ACCENT.amber}15`, color: ACCENT.amber, fontSize: 11, fontWeight: 600,
            cursor: "pointer", fontFamily: FONT.sans,
          }}
        >
          ✂️ Trim to 5-Day Capacity
        </button>
      </div>

      <Field label="Title" value={title} onChange={setTitle} />
      <Field label="Target Date" value={targetDate} onChange={setTargetDate} />
      <Field label="Description" value={desc} onChange={setDesc} area onOpenModal={() => setModalOpen(true)} />

      {modalOpen && (
        <DescriptionModal
          title={`Milestone #${milestone.githubNumber ?? "Local"}: ${milestone.title}`}
          value={desc}
          onClose={() => setModalOpen(false)}
        />
      )}

      <SaveButton onClick={() => void updateMilestone(id, { title, description: desc, targetDate })} />
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function BuildTrackerProperties() {
  const state = useStore();

  if (state.selectedMilestoneId !== null) return <MilestoneProperties id={state.selectedMilestoneId} />;
  if (state.selectedChatId !== null) return <ChatProperties id={state.selectedChatId} />;
  if (state.selectedIssueId !== null) return <IssueProperties id={state.selectedIssueId} />;
  if (state.selectedEpicId !== null) return <EpicProperties id={state.selectedEpicId} />;

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: TEXT.dim, fontSize: 12, padding: 16, textAlign: "center" }}>
      Select a milestone, epic, issue, or chat to edit it here.
    </div>
  );
}
