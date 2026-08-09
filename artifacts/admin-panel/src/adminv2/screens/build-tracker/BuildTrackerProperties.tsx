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
  epicById, issueById, chatById,
  updateEpic, updateIssue, updateChat,
  cycleIssueStatus,
} from "./buildTrackerStore";
import {
  ISSUE_STATUS_COLOR, ISSUE_STATUS_LABEL, ISSUE_STATUS_NEXT,
  EPIC_STATUS_COLOR, EPIC_STATUS_LABEL,
} from "./buildTrackerTypes";
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: 12 }}>
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: 12 }}>
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

// ── Root ──────────────────────────────────────────────────────────────────────

export function BuildTrackerProperties() {
  const state = useStore();

  if (state.selectedChatId !== null) return <ChatProperties id={state.selectedChatId} />;
  if (state.selectedIssueId !== null) return <IssueProperties id={state.selectedIssueId} />;
  if (state.selectedEpicId !== null) return <EpicProperties id={state.selectedEpicId} />;

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: TEXT.dim, fontSize: 12, padding: 16, textAlign: "center" }}>
      Select an epic, issue, or chat to edit it here.
    </div>
  );
}
