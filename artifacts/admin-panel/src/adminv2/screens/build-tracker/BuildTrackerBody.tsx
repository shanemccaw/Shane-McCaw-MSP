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
  selectIssue, selectEpic, updateIssue, setTriageActive, syncFromGitHub,
} from "./buildTrackerStore";
import {
  EPIC_STATUS_COLOR, EPIC_STATUS_LABEL,
  ISSUE_STATUS_COLOR, ISSUE_STATUS_LABEL, ISSUE_STATUS_NEXT,
  IssueStatus, githubIssueUrl,
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
            onClick={() => {
              const api = (window as any).__shellApi;
              if (api) api.navigate("/project-management");
            }}
            style={{
              display: "flex", alignItems: "center", gap: 6, padding: "6px 14px",
              borderRadius: 6, border: `1px solid ${ACCENT.amber}`, background: `${ACCENT.amber}18`,
              color: ACCENT.amber, fontFamily: FONT.sans, fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}
          >
            🎯 Gantt & Milestones Roadmap
          </button>
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
    <div style={{ padding: 24, maxWidth: 1000, display: "flex", flexDirection: "column", gap: 20 }}>
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
        </div>
      </div>

      {/* Two Column Layout */}
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 24, alignItems: "start" }}>
        {/* Left Column: Description, Issues, Delete button */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {epic.description && (
            <div style={{ background: SURFACE.card, padding: 16, borderRadius: 8, border: `1px solid ${LINE.quiet}` }}>
              <p style={{ margin: 0, fontSize: 13.5, color: TEXT.quiet, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{epic.description}</p>
            </div>
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
                    marginBottom: 6,
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

        {/* Right Column: Chats */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <Section title={`Chats on this epic (${directChats.length})`}>
            {directChats.length === 0 ? (
              <p style={{ fontSize: 12, color: TEXT.dim, margin: 0 }}>No chats linked yet</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {directChats.map((c) => <ChatOpenChip key={c.id} chat={c} />)}
              </div>
            )}
          </Section>
        </div>
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

function TriageView() {
  const state = useStore();
  const triagable = state.issues.filter((i) => {
    if (i.status === "closed" || i.status === "done") return false;
    if (!state.triageShowAssigned && i.epicId !== null) return false;
    return true;
  });
  const [index, setIndex] = useState(0);
  const [epicSearch, setEpicSearch] = useState("");

  // Clamp index to valid bounds
  const currentIndex = Math.max(0, Math.min(index, triagable.length - 1));
  const issue = triagable[currentIndex];

  if (triagable.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
        <div style={{ fontSize: 48 }}>🎉</div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: TEXT.bright }}>All issues triaged!</h1>
        <p style={{ margin: 0, fontSize: 14, color: TEXT.dim, maxWidth: 400 }}>
          Your pile of open issues is completely clean. Beautiful job!
        </p>
        <button
          onClick={() => setTriageActive(false)}
          style={{
            marginTop: 8, padding: "8px 16px", borderRadius: 6, border: 0,
            background: ACCENT.info, color: SURFACE.well, fontWeight: 600,
            cursor: "pointer", fontFamily: FONT.sans, fontSize: 13,
          }}
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  const epic = issue.epicId ? epicById(issue.epicId) : null;

  async function handleAssignEpic(epicId: number | null) {
    await updateIssue(issue.id, { epicId });
  }

  async function handleSetStatus(status: IssueStatus) {
    await updateIssue(issue.id, { status });
  }

  async function handleDelete() {
    if (window.confirm(`Delete issue "${issue.title}"?`)) {
      await deleteIssue(issue.id);
    }
  }

  // Filter epics by search query (supports name, number, or #number)
  const query = epicSearch.trim().toLowerCase();
  const filteredEpics = state.epics
    .filter(e => e.status !== "closed")
    .filter((e) => {
      if (!query) return true;
      const nameMatch = e.title.toLowerCase().includes(query);
      const numMatch = e.githubNumber ? String(e.githubNumber).includes(query) : false;
      const hashNumMatch = e.githubNumber ? `#${e.githubNumber}`.includes(query) : false;
      return nameMatch || numMatch || hashNumMatch;
    });

  return (
    <div style={{ padding: 24, maxWidth: 900, display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: ACCENT.amber }}>
            Triage Mode
          </span>
          <h1 style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 800, color: TEXT.bright }}>
            Clean the Pile
          </h1>
        </div>
        <button
          onClick={() => setTriageActive(false)}
          style={{
            padding: "5px 12px", borderRadius: 5, border: `1px solid ${LINE.control}`,
            background: "transparent", color: TEXT.dim, cursor: "pointer",
            fontFamily: FONT.sans, fontSize: 11.5,
          }}
        >
          Exit Triage
        </button>
      </div>

      {/* Progress Bar */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: TEXT.caption }}>
          <span>{triagable.length} issues remaining</span>
          <span>{currentIndex + 1} of {triagable.length}</span>
        </div>
        <div style={{ height: 6, background: SURFACE.well, borderRadius: 3, overflow: "hidden" }}>
          <div style={{
            height: "100%", background: ACCENT.info, borderRadius: 3,
            width: `${((currentIndex + 1) / triagable.length) * 100}%`,
            transition: "width 200ms ease",
          }} />
        </div>
      </div>

      {/* Two Column Layout */}
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 24, alignItems: "start" }}>
        {/* Left Column: Navigation Controls at the top, Card, Status */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Navigation Controls */}
          <div style={{ display: "flex", gap: 10, background: SURFACE.well, padding: 10, borderRadius: 6, border: `1px solid ${LINE.quiet}` }}>
            <button
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              disabled={currentIndex === 0}
              style={{
                padding: "6px 12px", borderRadius: 5, border: `1px solid ${LINE.control}`,
                background: SURFACE.card, color: TEXT.quiet, fontSize: 12, fontWeight: 600,
                fontFamily: FONT.sans, cursor: currentIndex === 0 ? "default" : "pointer",
                opacity: currentIndex === 0 ? 0.4 : 1,
              }}
            >
              Previous
            </button>
            <button
              onClick={() => setIndex((i) => Math.min(triagable.length - 1, i + 1))}
              disabled={currentIndex === triagable.length - 1}
              style={{
                padding: "6px 12px", borderRadius: 5, border: `1px solid ${LINE.control}`,
                background: SURFACE.card, color: TEXT.quiet, fontSize: 12, fontWeight: 600,
                fontFamily: FONT.sans, cursor: currentIndex === triagable.length - 1 ? "default" : "pointer",
                opacity: currentIndex === triagable.length - 1 ? 0.4 : 1,
              }}
            >
              Skip / Next
            </button>
            <button
              onClick={() => void handleDelete()}
              style={{
                padding: "6px 12px", borderRadius: 5, border: `1px solid ${ACCENT.danger}30`,
                background: `${ACCENT.danger}12`, color: ACCENT.danger, fontSize: 12, fontWeight: 600,
                fontFamily: FONT.sans, cursor: "pointer", marginLeft: "auto",
              }}
            >
              Delete Issue
            </button>
          </div>

          {/* Current Issue Card */}
          <div style={{
            padding: 20, background: SURFACE.card, borderRadius: 8,
            border: `1px solid ${LINE.quiet}`, display: "flex", flexDirection: "column", gap: 14,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <GitPullRequest size={15} color={ISSUE_STATUS_COLOR[issue.status]} />
              <span style={{ fontSize: 11.5, fontFamily: FONT.mono, color: TEXT.dim }}>
                {issue.githubNumber ? `#${issue.githubNumber}` : "Local Issue"}
              </span>
              <StatusPill label={ISSUE_STATUS_LABEL[issue.status]} color={ISSUE_STATUS_COLOR[issue.status]} />
            </div>
            
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: TEXT.primary, lineHeight: 1.4 }}>
              {issue.title}
            </h2>

            {epic ? (
              <p style={{ margin: 0, fontSize: 12.5, color: TEXT.quiet }}>
                Assigned to Epic: <strong style={{ color: ACCENT.greenSoft }}>{epic.githubNumber ? `#${epic.githubNumber} ` : ""}{epic.title}</strong>
              </p>
            ) : (
              <p style={{ margin: 0, fontSize: 12.5, color: ACCENT.amber, fontWeight: 500 }}>
                ⚠️ No Epic assigned
              </p>
            )}
          </div>

          {/* Status Actions */}
          <Section title="Set Status & Advance">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
              {(["backlog", "in_progress", "done", "closed"] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => void handleSetStatus(status)}
                  style={{
                    padding: "10px 8px", borderRadius: 6,
                    border: `1px solid ${issue.status === status ? ISSUE_STATUS_COLOR[status] : LINE.control}`,
                    background: issue.status === status ? `${ISSUE_STATUS_COLOR[status]}15` : SURFACE.well,
                    color: issue.status === status ? ISSUE_STATUS_COLOR[status] : TEXT.quiet,
                    cursor: "pointer", fontSize: 12, fontWeight: 600,
                    fontFamily: FONT.sans,
                  }}
                >
                  {ISSUE_STATUS_LABEL[status]}
                </button>
              ))}
            </div>
          </Section>
        </div>

        {/* Right Column: Epic Search & Assignment List */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Section title="Assign to Epic">
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input
                type="text"
                placeholder="Search Epics by name or #number..."
                value={epicSearch}
                onChange={(e) => setEpicSearch(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: 6,
                  border: `1px solid ${LINE.control}`,
                  background: SURFACE.well,
                  color: TEXT.primary,
                  fontSize: 12.5,
                  fontFamily: FONT.sans,
                  outline: "none",
                }}
              />
              <div style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                maxHeight: 460,
                overflowY: "auto",
                paddingRight: 4,
              }}>
                <button
                  onClick={() => void handleAssignEpic(null)}
                  style={{
                    padding: "10px 14px", borderRadius: 6,
                    border: `1px solid ${!issue.epicId ? ACCENT.amber : LINE.control}`,
                    background: !issue.epicId ? `${ACCENT.amber}12` : SURFACE.well,
                    color: !issue.epicId ? ACCENT.amber : TEXT.quiet,
                    cursor: "pointer", fontSize: 12.5, fontWeight: 600, textAlign: "left",
                    fontFamily: FONT.sans, flexShrink: 0,
                    textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap",
                  }}
                >
                  No Epic
                </button>
                {filteredEpics.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => void handleAssignEpic(e.id)}
                    style={{
                      padding: "10px 14px", borderRadius: 6,
                      border: `1px solid ${issue.epicId === e.id ? ACCENT.greenSoft : LINE.control}`,
                      background: issue.epicId === e.id ? `${ACCENT.greenSoft}12` : SURFACE.well,
                      color: issue.epicId === e.id ? ACCENT.greenSoft : TEXT.quiet,
                      cursor: "pointer", fontSize: 12.5, fontWeight: 600, textAlign: "left",
                      fontFamily: FONT.sans, flexShrink: 0,
                      textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap",
                    }}
                    title={e.githubNumber ? `#${e.githubNumber} ${e.title}` : e.title}
                  >
                    {e.githubNumber ? `#${e.githubNumber} ` : ""}{e.title}
                  </button>
                ))}
                {filteredEpics.length === 0 && (
                  <div style={{ padding: "12px 6px", fontSize: 12, color: TEXT.dim, textAlign: "center", fontFamily: FONT.sans }}>
                    No matching Epics found
                  </div>
                )}
              </div>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function BuildTrackerBody() {
  const state = useStore();

  if (state.triageActive) return <TriageView />;

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
