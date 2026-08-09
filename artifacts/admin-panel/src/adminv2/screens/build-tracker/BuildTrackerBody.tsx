/**
 * BuildTrackerBody — centre panel.
 *
 * What's shown depends on what's selected in the explorer:
 *   • Nothing selected   → Dashboard (summary counts)
 *   • Epic selected      → Epic detail (description + issue list)
 *   • Issue selected     → Issue detail — Claude chats AT THE TOP as clickable chips,
 *                          then description, labels, status, GitHub link
 *   • Chat selected      → redirects back to issue or shows standalone chat detail
 */

import { useSyncExternalStore, useState } from "react";
import {
  ExternalLink, MessageSquare, Plus, RefreshCw, GitBranch,
  GitPullRequest, AlertCircle, CheckCircle, Clock, Archive, Trash,
} from "lucide-react";
import { ACCENT, FONT, LINE, METRICS, SURFACE, TEXT } from "../../theme";
import {
  getSnapshot, subscribe,
  epicById, issueById, chatById,
  issuesForEpic, chatsForIssue, chatsForEpic,
  unlinkedChats, loadAll, createIssue, createChat,
  cycleIssueStatus, deleteIssue, deleteEpic, deleteChat,
  selectIssue, syncFromGitHub,
} from "./buildTrackerStore";
import {
  EPIC_STATUS_COLOR, EPIC_STATUS_LABEL,
  ISSUE_STATUS_COLOR, ISSUE_STATUS_LABEL, ISSUE_STATUS_NEXT,
  githubIssueUrl,
} from "./buildTrackerTypes";
import type { ChatRow, IssueRow } from "./buildTrackerTypes";

function useStore() {
  return useSyncExternalStore(subscribe, getSnapshot);
}

// ── Design atoms ──────────────────────────────────────────────────────────────

function StatusPill({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em",
      padding: "2px 7px", borderRadius: 12,
      background: `${color}22`, color, flexShrink: 0,
    }}>
      {label}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: TEXT.caption, margin: 0 }}>
        {title}
      </p>
      {children}
    </div>
  );
}

function ActionBtn({
  onClick, children, danger, disabled,
}: { onClick: () => void; children: React.ReactNode; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "5px 12px", borderRadius: 4,
        border: `1px solid ${danger ? ACCENT.danger : LINE.control}`,
        background: "transparent",
        color: danger ? ACCENT.danger : TEXT.quiet,
        fontFamily: FONT.sans, fontSize: 12, cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {children}
    </button>
  );
}

// ── Claude chat chip ──────────────────────────────────────────────────────────

function ChatOpenChip({ chat }: { chat: ChatRow }) {
  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (window.confirm("Are you sure you want to delete this chat link?")) {
      void deleteChat(chat.id);
    }
  };

  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 8,
        borderRadius: 8,
        background: `${ACCENT.info}12`,
        border: `1px solid ${ACCENT.info}30`,
        transition: "background 150ms",
        paddingRight: 6,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = `${ACCENT.info}20`; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = `${ACCENT.info}12`; }}
    >
      <a
        href={chat.claudeUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={`Open Claude chat: ${chat.conversationId}`}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          flex: 1, padding: "10px 10px 10px 14px", textDecoration: "none",
          minWidth: 0,
        }}
      >
        <MessageSquare size={16} color={ACCENT.info} style={{ flex: "none" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: TEXT.primary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {chat.title === chat.conversationId
              ? `Chat ${chat.conversationId.slice(0, 18)}…`
              : chat.title}
          </p>
          {chat.notes && (
            <p style={{ margin: "1px 0 0", fontSize: 11, color: TEXT.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {chat.notes}
            </p>
          )}
        </div>
        <ExternalLink size={13} color={ACCENT.info} style={{ flex: "none", opacity: 0.6 }} />
      </a>
      <button
        onClick={handleDelete}
        title="Delete chat link"
        style={{
          background: "transparent", border: 0, padding: 8, cursor: "pointer",
          borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center",
          color: TEXT.caption,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = ACCENT.danger; e.currentTarget.style.background = `${ACCENT.danger}15`; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = TEXT.caption; e.currentTarget.style.background = "transparent"; }}
      >
        <Trash size={14} />
      </button>
    </div>
  );
}

// ── Dashboard (nothing selected) ──────────────────────────────────────────────

function Dashboard() {
  const state = useStore();
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ epics: number; issues: number } | null>(null);

  const openEpics      = state.epics.filter((e) => e.status === "open").length;
  const inProgressEpics = state.epics.filter((e) => e.status === "in_progress").length;
  const backlogIssues  = state.issues.filter((i) => i.status === "backlog").length;
  const activeIssues   = state.issues.filter((i) => i.status === "in_progress").length;
  const doneIssues     = state.issues.filter((i) => i.status === "done" || i.status === "closed").length;
  const unlinked       = unlinkedChats().length;

  async function doSync() {
    setSyncing(true);
    setSyncResult(null);
    const result = await syncFromGitHub();
    setSyncing(false);
    if (result) setSyncResult(result);
  }

  const statCard = (icon: React.ReactNode, label: string, value: number, color: string) => (
    <div style={{
      display: "flex", flexDirection: "column", gap: 4, padding: "14px 18px",
      background: SURFACE.card, border: `1px solid ${LINE.quiet}`, borderRadius: 8,
      borderTop: `2px solid ${color}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, color }}>
        {icon}
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
      </div>
      <span style={{ fontSize: 28, fontWeight: 800, color: TEXT.bright, fontFamily: FONT.mono }}>{value}</span>
    </div>
  );

  return (
    <div style={{ padding: 24, maxWidth: 680, display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: TEXT.bright }}>Build Tracker</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: TEXT.dim }}>
            Organise Claude chats against GitHub epics and issues.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {syncResult && (
            <span style={{ fontSize: 11, color: ACCENT.green }}>
              ✓ {syncResult.epics} epics · {syncResult.issues} issues synced
            </span>
          )}
          <button
            onClick={() => void doSync()}
            disabled={syncing}
            style={{
              display: "flex", alignItems: "center", gap: 6, padding: "6px 14px",
              borderRadius: 6, border: `1px solid ${LINE.control}`, background: SURFACE.well,
              color: TEXT.quiet, fontFamily: FONT.sans, fontSize: 12, cursor: syncing ? "default" : "pointer",
              opacity: syncing ? 0.5 : 1,
            }}
          >
            <RefreshCw size={13} style={{ animation: syncing ? "spin 1s linear infinite" : "none" }} />
            {syncing ? "Syncing…" : "Sync from GitHub"}
          </button>
          <button
            onClick={() => void loadAll()}
            style={{
              display: "flex", alignItems: "center", gap: 5, padding: "6px 10px",
              borderRadius: 6, border: `1px solid ${LINE.control}`, background: SURFACE.well,
              color: TEXT.quiet, fontFamily: FONT.sans, fontSize: 12, cursor: "pointer",
            }}
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        {statCard(<GitBranch size={13} />, "Open Epics",      openEpics,      ACCENT.info)}
        {statCard(<Clock size={13} />,     "In Progress",     activeIssues,   ACCENT.amber)}
        {statCard(<AlertCircle size={13} />, "Needs Triage",  unlinked,       ACCENT.danger)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        {statCard(<GitPullRequest size={13} />, "Backlog",    backlogIssues,  TEXT.dim)}
        {statCard(<CheckCircle size={13} />,    "Done",       doneIssues,     ACCENT.green)}
        {statCard(<Archive size={13} />,        "Epics Active", inProgressEpics, ACCENT.amber)}
      </div>

      <div style={{ height: 1, background: LINE.quiet }} />
      <p style={{ fontSize: 12, color: TEXT.dim, margin: 0 }}>
        Select an epic or issue in the left panel, or use <kbd style={{ fontSize: 10, padding: "1px 5px", background: SURFACE.well, borderRadius: 3, border: `1px solid ${LINE.control}` }}>Ctrl K</kbd> to search everything.
      </p>
    </div>
  );
}

// ── Epic detail ────────────────────────────────────────────────────────────────

function EpicDetail({ id }: { id: number }) {
  const state = useStore();
  const epic = epicById(id);
  const [newIssueTitle, setNewIssueTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!epic) return null;
  const epicId = epic.id; // capture before async closure
  const issues = issuesForEpic(epicId);
  const directChats = chatsForEpic(epicId).filter((c) => c.epicId === epicId && !c.issueId);

  async function handleNewIssue() {
    if (!newIssueTitle.trim()) return;
    setAdding(true);
    await createIssue(newIssueTitle.trim(), epicId);
    setNewIssueTitle("");
    setAdding(false);
  }

  return (
    <div style={{ padding: 24, maxWidth: 680, display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <p style={{ margin: 0, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: TEXT.caption }}>Epic</p>
            <StatusPill label={EPIC_STATUS_LABEL[epic.status]} color={EPIC_STATUS_COLOR[epic.status]} />
            {epic.githubNumber && (
              <a href={`https://github.com/shanemccaw/Shane-McCaw-MSP/milestone/${epic.githubNumber}`} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 11, color: ACCENT.info, textDecoration: "none", display: "flex", alignItems: "center", gap: 4 }}>
                <ExternalLink size={11} /> #{epic.githubNumber}
              </a>
            )}
          </div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: TEXT.bright }}>{epic.title}</h1>
          {epic.description && (
            <p style={{ margin: "8px 0 0", fontSize: 13, color: TEXT.quiet, lineHeight: 1.5 }}>{epic.description}</p>
          )}
        </div>
      </div>

      {directChats.length > 0 && (
        <Section title={`Chats on this epic (${directChats.length})`}>
          {directChats.map((c) => <ChatOpenChip key={c.id} chat={c} />)}
        </Section>
      )}

      <Section title={`Issues (${issues.length})`}>
        {issues.length === 0 ? (
          <p style={{ fontSize: 12, color: TEXT.dim, margin: 0 }}>No issues yet</p>
        ) : (
          issues.map((issue) => (
            <button
              key={issue.id}
              onClick={() => selectIssue(issue.id)}
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
                background: SURFACE.card, borderRadius: 6, border: `1px solid ${LINE.quiet}`,
                cursor: "pointer", width: "100%", textAlign: "left",
                fontFamily: FONT.sans,
                transition: "border-color 150ms",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = ACCENT.amber; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = LINE.quiet; }}
            >
              <GitPullRequest size={13} color={ISSUE_STATUS_COLOR[issue.status]} style={{ flex: "none" }} />
              <span style={{ flex: 1, fontSize: 13, color: TEXT.body, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {issue.githubNumber ? `#${issue.githubNumber} ` : ""}{issue.title}
              </span>
              <StatusPill label={ISSUE_STATUS_LABEL[issue.status]} color={ISSUE_STATUS_COLOR[issue.status]} />
              {issue.chatCount > 0 && (
                <span style={{ fontSize: 11, color: ACCENT.info, marginLeft: 4 }}>💬{issue.chatCount}</span>
              )}
            </button>
          ))
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <input
            placeholder="New issue title…"
            value={newIssueTitle}
            onChange={(e) => setNewIssueTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void handleNewIssue(); }}
            style={{
              flex: 1, padding: "6px 10px", borderRadius: 5,
              background: SURFACE.well, border: `1px solid ${LINE.control}`,
              color: TEXT.primary, fontFamily: FONT.sans, fontSize: 12, outline: "none",
            }}
          />
          <button
            onClick={() => void handleNewIssue()}
            disabled={adding || !newIssueTitle.trim()}
            style={{
              display: "flex", alignItems: "center", gap: 5, padding: "6px 12px",
              borderRadius: 5, border: 0, background: `${ACCENT.info}22`, color: ACCENT.info,
              fontFamily: FONT.sans, fontSize: 12, cursor: "pointer",
              opacity: adding || !newIssueTitle.trim() ? 0.4 : 1,
            }}
          >
            <Plus size={13} /> Add
          </button>
        </div>
      </Section>

      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <ActionBtn
          danger
          onClick={() => {
            if (confirmDelete) void deleteEpic(id);
            else setConfirmDelete(true);
          }}
        >
          {confirmDelete ? "Delete — press again" : "Delete Epic"}
        </ActionBtn>
      </div>
    </div>
  );
}

// ── Issue detail ───────────────────────────────────────────────────────────────

function IssueDetail({ id }: { id: number }) {
  const state = useStore();
  const issue = issueById(id);
  const [newChatId, setNewChatId] = useState("");
  const [newChatTitle, setNewChatTitle] = useState("");
  const [addingChat, setAddingChat] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!issue) return null;
  const issueId = issue.id; // capture before async closure
  const chats = chatsForIssue(issueId);
  const next = ISSUE_STATUS_NEXT[issue.status];

  async function handleAddChat() {
    if (!newChatId.trim()) return;
    setAddingChat(true);
    await createChat(newChatId.trim(), newChatTitle.trim() || newChatId.trim(), issueId, null, null);
    setNewChatId("");
    setNewChatTitle("");
    setAddingChat(false);
  }

  return (
    <div style={{ padding: 24, maxWidth: 720, display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <p style={{ margin: 0, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: TEXT.caption }}>Issue</p>
          <StatusPill label={ISSUE_STATUS_LABEL[issue.status]} color={ISSUE_STATUS_COLOR[issue.status]} />
          {issue.githubNumber && (
            <a href={issue.githubUrl ?? githubIssueUrl(issue.githubNumber)} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 11, color: ACCENT.info, textDecoration: "none", display: "flex", alignItems: "center", gap: 4 }}>
              <ExternalLink size={11} /> #{issue.githubNumber} on GitHub
            </a>
          )}
        </div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: TEXT.bright }}>{issue.title}</h1>
        {issue.description && (
          <p style={{ margin: "8px 0 0", fontSize: 13, color: TEXT.quiet, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
            {issue.description}
          </p>
        )}
        {issue.labels.length > 0 && (
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 10 }}>
            {issue.labels.map((l) => (
              <span key={l} style={{ fontSize: 10, padding: "2px 7px", borderRadius: 10, background: `${ACCENT.info}18`, color: ACCENT.info, border: `1px solid ${ACCENT.info}30` }}>
                {l}
              </span>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => void cycleIssueStatus(id, next)}
          style={{
            display: "flex", alignItems: "center", gap: 6, padding: "6px 14px",
            borderRadius: 6, border: `1px solid ${ISSUE_STATUS_COLOR[next]}40`,
            background: `${ISSUE_STATUS_COLOR[next]}18`, color: ISSUE_STATUS_COLOR[next],
            fontFamily: FONT.sans, fontSize: 12, fontWeight: 600, cursor: "pointer",
          }}
        >
          Move to {ISSUE_STATUS_LABEL[next]}
        </button>
      </div>

      {/* ── Claude chats — PROMINENTLY AT TOP ─────────────────────────────── */}
      <Section title={`Claude Chats linked to this issue (${chats.length})`}>
        {chats.length === 0 ? (
          <p style={{ fontSize: 12, color: TEXT.dim, margin: 0 }}>No chats linked yet. Paste a conversation ID below.</p>
        ) : (
          chats.map((c) => <ChatOpenChip key={c.id} chat={c} />)
        )}

        {/* Add chat form */}
        <div style={{
          padding: "12px 14px", borderRadius: 8,
          background: SURFACE.card, border: `1px dashed ${LINE.control}`,
          display: "flex", flexDirection: "column", gap: 8,
        }}>
          <p style={{ margin: 0, fontSize: 11, color: TEXT.caption, fontWeight: 600 }}>Link a Claude chat</p>
          <input
            placeholder="Conversation ID (UUID from claude.ai/chat/…)"
            value={newChatId}
            onChange={(e) => setNewChatId(e.target.value)}
            style={{
              padding: "6px 10px", borderRadius: 5,
              background: SURFACE.well, border: `1px solid ${LINE.control}`,
              color: TEXT.primary, fontFamily: FONT.mono, fontSize: 11.5, outline: "none",
            }}
          />
          <input
            placeholder="Label (optional — defaults to conversation ID)"
            value={newChatTitle}
            onChange={(e) => setNewChatTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void handleAddChat(); }}
            style={{
              padding: "6px 10px", borderRadius: 5,
              background: SURFACE.well, border: `1px solid ${LINE.control}`,
              color: TEXT.primary, fontFamily: FONT.sans, fontSize: 12, outline: "none",
            }}
          />
          <button
            onClick={() => void handleAddChat()}
            disabled={addingChat || !newChatId.trim()}
            style={{
              alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 5,
              padding: "6px 14px", borderRadius: 5, border: 0,
              background: `${ACCENT.info}22`, color: ACCENT.info,
              fontFamily: FONT.sans, fontSize: 12, fontWeight: 600, cursor: "pointer",
              opacity: addingChat || !newChatId.trim() ? 0.4 : 1,
            }}
          >
            <Plus size={13} /> Link chat
          </button>
        </div>
      </Section>

      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <ActionBtn
          danger
          onClick={() => {
            if (confirmDelete) void deleteIssue(id);
            else setConfirmDelete(true);
          }}
        >
          {confirmDelete ? "Delete — press again" : "Delete Issue"}
        </ActionBtn>
      </div>
    </div>
  );
}

// ── Chat detail (standalone, no issue) ────────────────────────────────────────

function ChatDetail({ id }: { id: number }) {
  const chat = chatById(id);
  if (!chat) return null;
  return (
    <div style={{ padding: 24, maxWidth: 600, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <p style={{ margin: "0 0 6px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: TEXT.caption }}>Chat</p>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: TEXT.bright }}>
          {chat.title === chat.conversationId ? `Chat ${chat.conversationId.slice(0, 24)}…` : chat.title}
        </h1>
        {chat.category && (
          <p style={{ margin: "4px 0 0", fontSize: 12, color: TEXT.dim }}>Category: {chat.category}</p>
        )}
        {chat.notes && (
          <p style={{ margin: "8px 0 0", fontSize: 13, color: TEXT.quiet, lineHeight: 1.5 }}>{chat.notes}</p>
        )}
      </div>
      <ChatOpenChip chat={chat} />
      <p style={{ margin: 0, fontSize: 10, color: TEXT.faintest, fontFamily: FONT.mono, wordBreak: "break-all" }}>
        {chat.conversationId}
      </p>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function BuildTrackerBody() {
  const state = useStore();

  if (state.selectedChatId !== null) {
    const chat = chatById(state.selectedChatId);
    // If the chat has no issue, show its own detail. If it has an issue, show that issue.
    if (chat?.issueId) return <IssueDetail id={chat.issueId} />;
    return <ChatDetail id={state.selectedChatId} />;
  }
  if (state.selectedIssueId !== null) return <IssueDetail id={state.selectedIssueId} />;
  if (state.selectedEpicId !== null) return <EpicDetail id={state.selectedEpicId} />;
  return <Dashboard />;
}
