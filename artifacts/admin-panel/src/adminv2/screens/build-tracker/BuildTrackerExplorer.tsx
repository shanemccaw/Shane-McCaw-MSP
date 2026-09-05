/**
 * BuildTrackerExplorer — left panel tree.
 *
 * Layout:
 *   ▼ Epic Title                   [Open] [In Progress] [Closed]
 *     ▼ Issue Title          [backlog]  💬 3
 *         💬 Chat title
 *   ── Free-form ──
 *     ▼ Marketing
 *         💬 Chat title
 *     💬 Unlinked chats (needs triage)
 */

import { useSyncExternalStore, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  GitBranch,
  GitPullRequest,
  MessageSquare,
  Folder,
  FolderOpen,
  AlertCircle,
  Flag,
  Sparkles,
  Search,
  X,
  ExternalLink,
} from "lucide-react";
import { ACCENT, FONT, LINE, SURFACE, TEXT } from "../../theme";
import {
  getSnapshot, subscribe, selectEpic, selectIssue, selectChat, selectMilestone,
  issuesForEpic, chatsForIssue, chatsForEpic, chatsForCategory, freeFormCategories,
  unlinkedChats, createIssue, createChat, updateEpic, deleteEpic, cycleIssueStatus,
  deleteIssue, updateChat, deleteChat, epicsForMilestone, estimateMilestoneHours,
  formatIssueAge, trimMilestoneToCapacity, syncFromGitHub, assignEpicToMilestone,
  epicIsUnassigned, milestoneProgress, setChatTriageActive, createEpicFromLooseIssues
} from "./buildTrackerStore";
import { EPIC_STATUS_COLOR, ISSUE_STATUS_COLOR, ISSUE_STATUS_LABEL, EPIC_STATUS_LABEL } from "./buildTrackerTypes";
import { STATUS_COLOR, STATUS_LABEL } from "../project-management/ProjectManagementBody";
import type { ChatRow, EpicRow, IssueRow, MilestoneRow } from "./buildTrackerTypes";
import { useContextMenu, ContextMenu } from "../../shell/ContextMenu";
import { getShellApi } from "../../shell/ShellContext";


function useStore() {
  return useSyncExternalStore(subscribe, getSnapshot);
}

// ── Search matching ──────────────────────────────────────────────────────────
// `q` is already trimmed + lowercased by the root before it reaches any of
// these. A leading "#" is stripped so "#556" and "556" match the same rows.

function matchesQuery(q: string, title: string, num?: number | null, id?: number): boolean {
  if (!q) return true;
  if (title.toLowerCase().includes(q)) return true;
  const bare = q.replace(/^#/, "");
  if (!bare) return false;
  if (num != null && String(num).includes(bare)) return true;
  if (id != null && String(id) === bare) return true;
  return false;
}

function chatMatchesQuery(chat: ChatRow, q: string): boolean {
  if (!q) return true;
  if (chat.title.toLowerCase().includes(q)) return true;
  if (chat.conversationId.toLowerCase().includes(q)) return true;
  const bare = q.replace(/^#/, "");
  return bare !== "" && String(chat.id) === bare;
}

function issueMatchesQuery(issue: IssueRow, q: string): boolean {
  if (!q) return true;
  if (matchesQuery(q, issue.title, issue.githubNumber, issue.id)) return true;
  return chatsForIssue(issue.id).some((c) => chatMatchesQuery(c, q));
}

function epicMatchesQuery(epic: EpicRow, q: string): boolean {
  if (!q) return true;
  if (matchesQuery(q, epic.title, epic.githubNumber, epic.id)) return true;
  if (issuesForEpic(epic.id).some((i) => issueMatchesQuery(i, q))) return true;
  const directChats = chatsForEpic(epic.id).filter((c) => c.epicId === epic.id && !c.issueId);
  return directChats.some((c) => chatMatchesQuery(c, q));
}

function milestoneMatchesQuery(milestone: MilestoneRow, q: string): boolean {
  if (!q) return true;
  if (matchesQuery(q, milestone.title, milestone.githubNumber, milestone.id)) return true;
  return epicsForMilestone(milestone.id).some((e) => epicMatchesQuery(e, q));
}

// ── Atoms ─────────────────────────────────────────────────────────────────────

function StatusPill({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      fontSize: 9, fontFamily: FONT.mono, fontWeight: 700,
      textTransform: "uppercase", letterSpacing: "0.04em",
      padding: "1px 4px", borderRadius: 3,
      background: `${color}22`, color,
    }}>
      {label}
    </span>
  );
}

function ChatChip({ chat, selected, onSelect, onContextMenu }: { chat: ChatRow; selected: boolean; onSelect: () => void; onContextMenu?: (e: React.MouseEvent) => void }) {
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 2,
        borderLeft: selected ? `2px solid ${ACCENT.info}` : "2px solid transparent",
        background: selected ? `${ACCENT.info}18` : "transparent",
        borderRadius: 3,
      }}
    >
      <button
        onClick={onSelect}
        onContextMenu={onContextMenu}
        title={chat.claudeUrl}
        style={{
          display: "flex", alignItems: "center", gap: 5, minWidth: 0,
          flex: 1, padding: "3px 4px 3px 26px",
          background: "transparent", border: 0, cursor: "pointer", textAlign: "left",
        }}
      >
        <MessageSquare size={11} color={ACCENT.info} style={{ flex: "none", opacity: 0.7 }} />
        <span style={{ fontSize: 11.5, color: selected ? TEXT.primary : TEXT.quiet, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {chat.title === chat.conversationId ? chat.conversationId.slice(0, 18) + "…" : chat.title}
        </span>
      </button>
      {/* One-click open — the whole reason this tracker exists is to reach the
          chat, so don't make reaching it cost a navigate-then-click detour. */}
      <a
        href={chat.claudeUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        title="Open this chat in Claude"
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          flex: "none", width: 20, height: 20, marginRight: 4, borderRadius: 3,
          color: TEXT.faintest,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = ACCENT.info; e.currentTarget.style.background = `${ACCENT.info}18`; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = TEXT.faintest; e.currentTarget.style.background = "transparent"; }}
      >
        <ExternalLink size={10} />
      </a>
    </div>
  );
}

// ── Issue row ──────────────────────────────────────────────────────────────────

function IssueNode({
  issue,
  selectedIssueId,
  selectedChatId,
  onIssue,
  onChat,
  onIssueContextMenu,
  onChatContextMenu,
  query,
}: {
  issue: IssueRow;
  selectedIssueId: number | null;
  selectedChatId: number | null;
  onIssue: (id: number) => void;
  onChat: (id: number) => void;
  onIssueContextMenu: (e: React.MouseEvent, issue: IssueRow) => void;
  onChatContextMenu: (e: React.MouseEvent, chat: ChatRow) => void;
  query: string;
}) {
  const [open, setOpen] = useState(query.length > 0);
  const chats = chatsForIssue(issue.id).filter((c) => chatMatchesQuery(c, query));
  const isSelected = selectedIssueId === issue.id;

  return (
    <div>
      <button
        onClick={() => { onIssue(issue.id); if (chats.length) setOpen((o) => !o); }}
        onContextMenu={(e) => onIssueContextMenu(e, issue)}
        style={{
          display: "flex", alignItems: "center", gap: 5,
          width: "100%", padding: "4px 8px 4px 20px",
          background: isSelected ? `${ACCENT.amber}18` : "transparent",
          border: 0, borderRadius: 3, cursor: "pointer", textAlign: "left",
          borderLeft: isSelected ? `2px solid ${ACCENT.amber}` : "2px solid transparent",
        }}
      >
        {chats.length > 0
          ? <span style={{ color: TEXT.dim }}>{open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}</span>
          : <span style={{ width: 10 }} />
        }
        <GitPullRequest size={11} color={ISSUE_STATUS_COLOR[issue.status]} style={{ flex: "none" }} />
        {issue.epicId === null && (
          <span style={{ flex: "none", display: "flex" }} title="No parent Epic">
            <AlertCircle size={10} color={ACCENT.amber} />
          </span>
        )}
        <span style={{ fontSize: 12, color: isSelected ? TEXT.strong : TEXT.body, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {issue.githubNumber ? `#${issue.githubNumber} ` : ""}{issue.title}
        </span>
        <StatusPill label={ISSUE_STATUS_LABEL[issue.status]} color={ISSUE_STATUS_COLOR[issue.status]} />
        <span style={{ fontSize: 9.5, color: TEXT.caption, fontFamily: FONT.sans, marginLeft: 2 }}>
          {formatIssueAge(issue.createdAt, issue.closedAt)}
        </span>
        {chats.length > 0 && (
          <span style={{ fontSize: 10, color: ACCENT.info, marginLeft: 2 }}>
            💬{chats.length}
          </span>
        )}
      </button>
      {open && chats.map((c) => (
        <ChatChip
          key={c.id}
          chat={c}
          selected={selectedChatId === c.id}
          onSelect={() => onChat(c.id)}
          onContextMenu={(e) => onChatContextMenu(e, c)}
        />
      ))}
    </div>
  );
}

// ── Milestone row ──────────────────────────────────────────────────────────────

function MilestoneNode({
  milestone,
  selectedMilestoneId,
  selectedEpicId,
  selectedIssueId,
  selectedChatId,
  onMilestoneSelect,
  onEpic,
  onIssue,
  onChat,
  showClosed,
  onMilestoneContextMenu,
  onEpicContextMenu,
  onIssueContextMenu,
  onChatContextMenu,
  query,
}: {
  milestone: MilestoneRow;
  selectedMilestoneId: number | null;
  selectedEpicId: number | null;
  selectedIssueId: number | null;
  selectedChatId: number | null;
  onMilestoneSelect: (id: number) => void;
  onEpic: (id: number) => void;
  onIssue: (id: number) => void;
  onChat: (id: number) => void;
  showClosed: boolean;
  onMilestoneContextMenu: (e: React.MouseEvent, milestone: MilestoneRow) => void;
  onEpicContextMenu: (e: React.MouseEvent, epic: EpicRow) => void;
  onIssueContextMenu: (e: React.MouseEvent, issue: IssueRow) => void;
  onChatContextMenu: (e: React.MouseEvent, chat: ChatRow) => void;
  query: string;
}) {
  const [open, setOpen] = useState(true);
  const epics = epicsForMilestone(milestone.id)
    .filter((e) => showClosed || e.status !== "closed")
    .filter((e) => epicMatchesQuery(e, query));
  const visibleEpics = epics;
  const est = estimateMilestoneHours(milestone.id);
  const progress = milestoneProgress(milestone.id);
  const isSelected = selectedMilestoneId === milestone.id;

  return (
    <div style={{ marginBottom: 4 }}>
      <button
        onClick={() => { onMilestoneSelect(milestone.id); setOpen((o) => !o); }}
        onContextMenu={(e) => onMilestoneContextMenu(e, milestone)}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          width: "100%", padding: "5px 8px",
          background: isSelected ? `${ACCENT.amber}22` : SURFACE.well,
          border: `1px solid ${isSelected ? ACCENT.amber : LINE.quiet}`,
          borderRadius: 5, cursor: "pointer", textAlign: "left",
        }}
      >
        <Flag size={12} color={STATUS_COLOR[milestone.status]} style={{ flex: "none" }} />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: isSelected ? TEXT.bright : TEXT.primary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {milestone.githubNumber ? `#${milestone.githubNumber} ` : ""}{milestone.title}
            </span>
            <StatusPill label={STATUS_LABEL[milestone.status]} color={STATUS_COLOR[milestone.status]} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: TEXT.caption, marginTop: 2 }}>
            <span>{visibleEpics.length} epics</span>
            <span>·</span>
            <span>Est: {est.totalDays}d ({est.totalHours}h)</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 4 }}>
            <div style={{ flex: 1, height: 4, borderRadius: 2, background: `${TEXT.dim}30`, overflow: "hidden" }}>
              <div style={{
                width: `${progress.pct}%`, height: "100%", borderRadius: 2,
                background: progress.pct >= 100 ? ACCENT.greenSoft : ACCENT.amber,
                transition: "width 0.2s ease",
              }} />
            </div>
            <span style={{ fontSize: 9.5, color: TEXT.caption, fontFamily: FONT.mono, flex: "none" }}>
              {progress.done}/{progress.total} · {progress.pct}%
            </span>
          </div>
        </div>
        <span style={{ color: TEXT.dim }}>{open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}</span>
      </button>

      {open && (
        <div style={{ paddingLeft: 6, borderLeft: `2px solid ${ACCENT.amber}35`, marginLeft: 6, marginTop: 4 }}>
          {visibleEpics.length === 0 ? (
            <p style={{ fontSize: 11, color: TEXT.dim, padding: "3px 8px", margin: 0 }}>No epics in milestone</p>
          ) : (
            visibleEpics.map((e) => (
              <EpicNode
                key={`${e.id}:${query ? "s" : "n"}`}
                epic={e}
                selectedEpicId={selectedEpicId}
                selectedIssueId={selectedIssueId}
                selectedChatId={selectedChatId}
                onEpic={onEpic}
                onIssue={onIssue}
                onChat={onChat}
                showClosed={showClosed}
                onEpicContextMenu={onEpicContextMenu}
                onIssueContextMenu={onIssueContextMenu}
                onChatContextMenu={onChatContextMenu}
                query={query}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Epic row ──────────────────────────────────────────────────────────────────

function EpicNode({
  epic,
  selectedEpicId,
  selectedIssueId,
  selectedChatId,
  onEpic,
  onIssue,
  onChat,
  showClosed,
  onEpicContextMenu,
  onIssueContextMenu,
  onChatContextMenu,
  query,
}: {
  epic: EpicRow;
  selectedEpicId: number | null;
  selectedIssueId: number | null;
  selectedChatId: number | null;
  onEpic: (id: number) => void;
  onIssue: (id: number) => void;
  onChat: (id: number) => void;
  showClosed: boolean;
  onEpicContextMenu: (e: React.MouseEvent, epic: EpicRow) => void;
  onIssueContextMenu: (e: React.MouseEvent, issue: IssueRow) => void;
  onChatContextMenu: (e: React.MouseEvent, chat: ChatRow) => void;
  query: string;
}) {
  const [open, setOpen] = useState(query.length > 0);
  const issues = issuesForEpic(epic.id)
    .filter((i) => showClosed || i.status !== "closed")
    .filter((i) => issueMatchesQuery(i, query));
  const visibleIssues = issues;
  const directChats = chatsForEpic(epic.id)
    .filter((c) => c.epicId === epic.id && !c.issueId)
    .filter((c) => chatMatchesQuery(c, query));
  const isSelected = selectedEpicId === epic.id;

  return (
    <div>
      <button
        onClick={() => { onEpic(epic.id); setOpen((o) => !o); }}
        onContextMenu={(e) => onEpicContextMenu(e, epic)}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          width: "100%", padding: "5px 8px",
          background: isSelected ? `${ACCENT.greenSoft}15` : "transparent",
          border: 0, borderRadius: 3, cursor: "pointer", textAlign: "left",
          borderLeft: isSelected ? `2px solid ${ACCENT.greenSoft}` : "2px solid transparent",
        }}
      >
        {open ? <FolderOpen size={13} color={EPIC_STATUS_COLOR[epic.status]} style={{ flex: "none" }} />
               : <Folder size={13} color={EPIC_STATUS_COLOR[epic.status]} style={{ flex: "none" }} />}
        <span style={{ fontSize: 12.5, fontWeight: 600, color: isSelected ? TEXT.bright : TEXT.primary, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {epic.githubNumber ? `#${epic.githubNumber} ` : ""}{epic.title}
        </span>
        <StatusPill label={EPIC_STATUS_LABEL[epic.status]} color={EPIC_STATUS_COLOR[epic.status]} />
        <span style={{ color: TEXT.dim }}>{open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}</span>
      </button>

      {open && (
        <div style={{ paddingLeft: 4 }}>
          {visibleIssues.map((i) => (
            <IssueNode
              key={`${i.id}:${query ? "s" : "n"}`}
              issue={i}
              selectedIssueId={selectedIssueId}
              selectedChatId={selectedChatId}
              onIssue={onIssue}
              onChat={onChat}
              onIssueContextMenu={onIssueContextMenu}
              onChatContextMenu={onChatContextMenu}
              query={query}
            />
          ))}
          {directChats.map((c) => (
            <ChatChip key={c.id} chat={c} selected={selectedChatId === c.id} onSelect={() => onChat(c.id)} onContextMenu={(e) => onChatContextMenu(e, c)} />
          ))}
          {visibleIssues.length === 0 && directChats.length === 0 && (
            <p style={{ fontSize: 11, color: TEXT.faintest, padding: "2px 8px 2px 24px", margin: 0 }}>
              {query ? "No matches" : "No issues yet"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── No Epic node ─────────────────────────────────────────────────────────────

function NoEpicNode({
  issues,
  selectedIssueId,
  selectedChatId,
  onIssue,
  onChat,
  onIssueContextMenu,
  onChatContextMenu,
  query,
}: {
  issues: IssueRow[];
  selectedIssueId: number | null;
  selectedChatId: number | null;
  onIssue: (id: number) => void;
  onChat: (id: number) => void;
  onIssueContextMenu: (e: React.MouseEvent, issue: IssueRow) => void;
  onChatContextMenu: (e: React.MouseEvent, chat: ChatRow) => void;
  query: string;
}) {
  const [open, setOpen] = useState(query.length > 0);

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          width: "100%", padding: "5px 8px",
          background: "transparent",
          border: 0, borderRadius: 3, cursor: "pointer", textAlign: "left",
        }}
      >
        {open ? <FolderOpen size={13} color={TEXT.caption} style={{ flex: "none" }} />
               : <Folder size={13} color={TEXT.caption} style={{ flex: "none" }} />}
        <span style={{ fontSize: 12.5, fontWeight: 600, color: TEXT.primary, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          NO EPIC
        </span>
        <span style={{ fontSize: 10, color: TEXT.dim, marginRight: 4 }}>
          {issues.length}
        </span>
        <span style={{ color: TEXT.dim }}>{open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}</span>
      </button>

      {open && (
        <div style={{ paddingLeft: 4 }}>
          {issues.map((i) => (
            <IssueNode
              key={`${i.id}:${query ? "s" : "n"}`}
              issue={i}
              selectedIssueId={selectedIssueId}
              selectedChatId={selectedChatId}
              onIssue={onIssue}
              onChat={onChat}
              onIssueContextMenu={onIssueContextMenu}
              onChatContextMenu={onChatContextMenu}
              query={query}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Free-form section ─────────────────────────────────────────────────────────

function CategoryNode({
  category,
  selectedChatId,
  onChat,
  onChatContextMenu,
  query,
}: { category: string; selectedChatId: number | null; onChat: (id: number) => void; onChatContextMenu: (e: React.MouseEvent, chat: ChatRow) => void; query: string }) {
  const [open, setOpen] = useState(query.length > 0);
  const chats = chatsForCategory(category).filter((c) => chatMatchesQuery(c, query));
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          width: "100%", padding: "4px 8px",
          background: "transparent", border: 0, borderRadius: 3, cursor: "pointer",
        }}
      >
        {open ? <ChevronDown size={10} color={TEXT.dim} /> : <ChevronRight size={10} color={TEXT.dim} />}
        <Folder size={11} color={TEXT.caption} />
        <span style={{ fontSize: 12, color: TEXT.quiet }}>{category}</span>
        <span style={{ fontSize: 10, color: TEXT.dim, marginLeft: "auto" }}>{chats.length}</span>
      </button>
      {open && chats.map((c) => (
        <ChatChip key={c.id} chat={c} selected={selectedChatId === c.id} onSelect={() => onChat(c.id)} onContextMenu={(e) => onChatContextMenu(e, c)} />
      ))}
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function BuildTrackerExplorer() {
  const state = useStore();
  const unlinked = unlinkedChats();
  const categories = freeFormCategories();
  const [showClosed, setShowClosed] = useState(false);
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const [milestonesOpen, setMilestonesOpen] = useState(true);
  const [unassignedOpen, setUnassignedOpen] = useState(true);
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();

  // Select directly rather than relying only on openDoc()'s navigate-to-
  // build-tracker-then-render(ctx)-selects-it chain: this Explorer is also
  // the left panel on Project Management (project-management/index.tsx),
  // whose own render() never looks at ctx at all, so that chain never fires
  // there and clicking an epic did nothing visible. Calling selectEpic/
  // selectIssue/selectChat here makes the right Properties panel (shared by
  // both screens) react immediately regardless of which screen is active;
  // openDoc() still runs alongside it for the doc tab + navigating into the
  // full epic/issue view on Build Tracker.
  function handleEpic(id: number) {
    selectEpic(id);
    getShellApi()?.openDoc({ kind: "epic", id: String(id), screenId: "build-tracker" });
  }
  function handleIssue(id: number) {
    selectIssue(id);
    getShellApi()?.openDoc({ kind: "issue", id: String(id), screenId: "build-tracker" });
  }
  function handleChat(id: number) {
    selectChat(id);
    getShellApi()?.openDoc({ kind: "chatLink", id: String(id), screenId: "build-tracker" });
  }
  function handleMilestone(id: number) {
    selectMilestone(id);
    getShellApi()?.openDoc({ kind: "milestone", id: String(id), screenId: "build-tracker" });
  }

  /**
   * Right-click on empty Explorer space — "the whole reason I can't find
   * where to add a chat" per Shane's feedback. Creates a brand-new unlinked
   * chat straight into the Needs Triage bucket, no record to click into
   * first required.
   */
  function onBackgroundContextMenu(e: React.MouseEvent) {
    if (e.target !== e.currentTarget) return; // a row's own handler already ran
    openMenu(e, [
      {
        label: "Add New Chat...",
        onSelect: () => {
          const cid = window.prompt("Paste Claude conversation ID or URL:");
          if (!cid?.trim()) return;
          const title = window.prompt("Label (optional — defaults to the conversation ID):", cid.trim());
          void createChat(cid.trim(), (title ?? cid).trim() || cid.trim(), null, null, null);
        },
      },
    ], "Explorer actions");
  }

  function onEpicContextMenu(e: React.MouseEvent, epic: EpicRow) {
    const currentMilestone = state.milestones.find(m => m.id === epic.milestoneId);
    const items = [
      epic.milestoneId ? {
        label: `Unassign from "${currentMilestone?.title ?? 'Milestone'}"`,
        onSelect: () => void assignEpicToMilestone(epic.id, null)
      } : null,
      ...state.milestones
        .filter(m => m.status !== "closed" && m.id !== epic.milestoneId)
        .map(m => ({
          label: `Assign to "${m.title}"`,
          onSelect: () => void assignEpicToMilestone(epic.id, m.id)
        })),
      {
        label: "New issue...",
        onSelect: () => {
          const title = window.prompt(`New issue title for Epic "${epic.title}":`);
          if (title?.trim()) void createIssue(title.trim(), epic.id);
        }
      },
      {
        label: "Link Claude chat...",
        onSelect: () => {
          const cid = window.prompt(`Paste Claude conversation ID or URL to link to Epic "${epic.title}":`);
          if (cid?.trim()) void createChat(cid.trim(), cid.trim(), null, epic.id);
        }
      },
      epic.githubNumber ? {
        label: "Open in GitHub",
        onSelect: () => window.open(`https://github.com/shanemccaw/Shane-McCaw-MSP/milestone/${epic.githubNumber}`, "_blank")
      } : null,
      {
        label: epic.status === "closed" ? "Mark as Open" : "Mark as Closed",
        onSelect: () => void updateEpic(epic.id, { status: epic.status === "closed" ? "open" : "closed" })
      },
      {
        label: "Delete Epic",
        danger: true,
        onSelect: () => {
          if (window.confirm(`Are you sure you want to delete Epic "${epic.title}"?`)) {
            void deleteEpic(epic.id);
          }
        }
      }
    ].filter(Boolean) as any[];

    openMenu(e, items, `Epic actions for ${epic.title}`);
  }

  function onIssueContextMenu(e: React.MouseEvent, issue: IssueRow) {
    const items = [
      {
        label: "Link Claude chat...",
        onSelect: () => {
          const cid = window.prompt(`Paste Claude conversation ID or URL to link to Issue "${issue.title}":`);
          if (cid?.trim()) void createChat(cid.trim(), cid.trim(), issue.id);
        }
      },
      issue.githubUrl ? {
        label: "Open in GitHub",
        onSelect: () => window.open(issue.githubUrl!, "_blank")
      } : null,
      {
        label: "Set as Backlog",
        disabled: issue.status === "backlog",
        onSelect: () => void cycleIssueStatus(issue.id, "backlog")
      },
      {
        label: "Set as In Progress",
        disabled: issue.status === "in_progress",
        onSelect: () => void cycleIssueStatus(issue.id, "in_progress")
      },
      {
        label: "Set as Done",
        disabled: issue.status === "done",
        onSelect: () => void cycleIssueStatus(issue.id, "done")
      },
      {
        label: "Set as Closed",
        disabled: issue.status === "closed",
        onSelect: () => void cycleIssueStatus(issue.id, "closed")
      },
      {
        label: "Delete Issue",
        danger: true,
        onSelect: () => {
          if (window.confirm(`Are you sure you want to delete Issue "${issue.title}"?`)) {
            void deleteIssue(issue.id);
          }
        }
      }
    ].filter(Boolean) as any[];

    openMenu(e, items, `Issue actions for ${issue.title}`);
  }

  function onMilestoneContextMenu(e: React.MouseEvent, milestone: MilestoneRow) {
    const items = [
      {
        label: "Edit Milestone...",
        onSelect: () => selectMilestone(milestone.id)
      },
      {
        label: "New Epic & Assign Loose Issues...",
        onSelect: () => {
          const title = window.prompt(`New Epic title to group loose issues in "${milestone.title}":`);
          if (title?.trim()) {
            void createEpicFromLooseIssues(milestone.id, title.trim());
          }
        }
      },
      {
        label: "Trim Capacity (Fit to 5 Days)",
        onSelect: () => void trimMilestoneToCapacity(milestone.id, 5)
      },
      {
        label: "Sync from GitHub",
        onSelect: () => void syncFromGitHub()
      }
    ];

    openMenu(e, items, `Milestone actions for ${milestone.title}`);
  }

  function onChatContextMenu(e: React.MouseEvent, chat: ChatRow) {
    const isUnlinked = chat.issueId === null && chat.epicId === null && !chat.category;
    const items = [
      {
        label: "Open in Claude",
        onSelect: () => window.open(chat.claudeUrl, "_blank")
      },
      isUnlinked ? {
        label: "Assign triage chat...",
        onSelect: () => setChatTriageActive(true, chat.id),
      } : null,
      {
        label: "Rename chat...",
        onSelect: () => {
          const title = window.prompt("New chat title:", chat.title);
          if (title?.trim()) void updateChat(chat.id, { title: title.trim() });
        }
      },
      {
        label: "Delete chat link",
        danger: true,
        onSelect: () => {
          if (window.confirm("Are you sure you want to delete this chat link?")) {
            void deleteChat(chat.id);
          }
        }
      }
    ].filter(Boolean) as any[];

    openMenu(e, items, `Chat actions for ${chat.title}`);
  }

  if (state.epicsLoading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: TEXT.dim, fontSize: 12 }}>
        Loading…
      </div>
    );
  }

  const visibleMilestones = state.milestones
    .filter(m => showClosed || m.status !== "closed")
    .filter(m => milestoneMatchesQuery(m, query))
    .sort((a, b) => {
      // Lowest GitHub # first; milestones with no GitHub number (locally
      // created, never synced) sort after every numbered one.
      if (a.githubNumber != null && b.githubNumber != null) return a.githubNumber - b.githubNumber;
      if (a.githubNumber != null) return -1;
      if (b.githubNumber != null) return 1;
      return a.id - b.id;
    });
  const unassignedEpics = state.epics.filter(epicIsUnassigned);
  const visibleEpics = unassignedEpics
    .filter(e => showClosed || e.status !== "closed")
    .filter(e => epicMatchesQuery(e, query));
  const noEpicIssues = state.issues.filter((i) => i.epicId === null);
  const visibleNoEpicIssues = noEpicIssues
    .filter(i => showClosed || i.status !== "closed")
    .filter(i => issueMatchesQuery(i, query));
  const visibleCategories = categories.filter(
    (cat) => matchesQuery(query, cat) || chatsForCategory(cat).some((c) => chatMatchesQuery(c, query)),
  );
  const visibleUnlinked = unlinked.filter((c) => chatMatchesQuery(c, query));
  const noResults = !!query
    && visibleMilestones.length === 0 && visibleEpics.length === 0 && visibleNoEpicIssues.length === 0
    && visibleCategories.length === 0 && visibleUnlinked.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Search Box */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "6px 8px", borderBottom: `1px solid ${LINE.control}`,
        background: SURFACE.well, flexShrink: 0,
      }}>
        <Search size={12} color={TEXT.dim} style={{ flex: "none" }} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by #, name…"
          style={{
            flex: 1, minWidth: 0, background: "transparent", border: 0, outline: "none",
            fontSize: 11.5, color: TEXT.primary, fontFamily: FONT.sans,
          }}
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            title="Clear search"
            style={{ background: "transparent", border: 0, cursor: "pointer", padding: 2, display: "flex", flex: "none" }}
          >
            <X size={12} color={TEXT.dim} />
          </button>
        )}
      </div>

      {/* Filter Bar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "6px 8px", borderBottom: `1px solid ${LINE.control}`,
        background: SURFACE.well, flexShrink: 0,
      }}>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: TEXT.caption }}>
          Filter
        </span>
        <button
          onClick={() => setShowClosed(!showClosed)}
          style={{
            background: showClosed ? `${ACCENT.info}15` : "transparent",
            border: `1px solid ${showClosed ? ACCENT.info + "40" : LINE.control}`,
            cursor: "pointer", fontSize: 10.5, color: showClosed ? ACCENT.info : TEXT.dim,
            fontWeight: 600, padding: "2px 6px", borderRadius: 4,
            fontFamily: FONT.sans,
          }}
        >
          {showClosed ? "Showing All" : "Open Only"}
        </button>
      </div>

      {noResults && (
        <div style={{ padding: "12px 8px", fontSize: 12, color: TEXT.dim, textAlign: "center" }}>
          <Search size={20} color={TEXT.faintest} style={{ marginBottom: 6 }} />
          <p style={{ margin: 0 }}>No matches for "{search.trim()}"</p>
        </div>
      )}

      <div
        onContextMenu={onBackgroundContextMenu}
        style={{ display: "flex", flexDirection: "column", gap: 1, padding: "8px 4px", overflowY: "auto", flex: 1 }}
      >
        {/* Milestones Vertical Timeline */}
        {visibleMilestones.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <button
              onClick={() => setMilestonesOpen((o) => !o)}
              style={{
                display: "flex", alignItems: "center", gap: 4, width: "100%",
                background: "transparent", border: 0, cursor: "pointer",
                padding: "0 4px", margin: "0 0 6px", fontFamily: FONT.sans,
              }}
            >
              {milestonesOpen ? <ChevronDown size={11} color={ACCENT.amber} /> : <ChevronRight size={11} color={ACCENT.amber} />}
              <Flag size={11} color={ACCENT.amber} />
              <span style={{ fontSize: 10, fontWeight: 700, color: ACCENT.amber, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Milestones ({visibleMilestones.length})
              </span>
            </button>
            {milestonesOpen && visibleMilestones.map((m) => (
              <MilestoneNode
                key={m.id}
                milestone={m}
                selectedMilestoneId={state.selectedMilestoneId}
                selectedEpicId={state.selectedEpicId}
                selectedIssueId={state.selectedIssueId}
                selectedChatId={state.selectedChatId}
                onMilestoneSelect={handleMilestone}
                onEpic={handleEpic}
                onIssue={handleIssue}
                onChat={handleChat}
                showClosed={showClosed}
                onMilestoneContextMenu={onMilestoneContextMenu}
                onEpicContextMenu={onEpicContextMenu}
                onIssueContextMenu={onIssueContextMenu}
                onChatContextMenu={onChatContextMenu}
                query={query}
              />
            ))}
          </div>
        )}

        {/* Unassigned / Standalone Epics */}
        {visibleEpics.length > 0 && (
          <div style={{ marginTop: 4 }}>
            {visibleMilestones.length > 0 && (
              <button
                onClick={() => setUnassignedOpen((o) => !o)}
                style={{
                  display: "flex", alignItems: "center", gap: 4, width: "100%",
                  background: "transparent", border: 0, cursor: "pointer",
                  padding: "0 4px", margin: "0 0 4px", fontFamily: FONT.sans,
                }}
              >
                {unassignedOpen ? <ChevronDown size={10} color={TEXT.caption} /> : <ChevronRight size={10} color={TEXT.caption} />}
                <span style={{ fontSize: 10, fontWeight: 700, color: TEXT.caption, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Unassigned Epics ({visibleEpics.length})
                </span>
              </button>
            )}
            {(unassignedOpen || visibleMilestones.length === 0) && visibleEpics.map((e) => (
              <EpicNode
                key={`${e.id}:${query ? "s" : "n"}`}
                epic={e}
                selectedEpicId={state.selectedEpicId}
                selectedIssueId={state.selectedIssueId}
                selectedChatId={state.selectedChatId}
                onEpic={handleEpic}
                onIssue={handleIssue}
                onChat={handleChat}
                showClosed={showClosed}
                onEpicContextMenu={onEpicContextMenu}
                onIssueContextMenu={onIssueContextMenu}
                onChatContextMenu={onChatContextMenu}
                query={query}
              />
            ))}
          </div>
        )}

        {!query && visibleMilestones.length === 0 && visibleEpics.length === 0 && (
          <div style={{ padding: "12px 8px", fontSize: 12, color: TEXT.dim, textAlign: "center" }}>
            <GitBranch size={20} color={TEXT.faintest} style={{ marginBottom: 6 }} />
            <p style={{ margin: 0 }}>No open milestones or epics</p>
            {state.epics.length > 0 && <p style={{ margin: "4px 0 0", fontSize: 11, color: TEXT.faintest }}>Change filter to see closed items</p>}
          </div>
        )}

        {visibleNoEpicIssues.length > 0 && (
          <NoEpicNode
            issues={visibleNoEpicIssues}
            selectedIssueId={state.selectedIssueId}
            selectedChatId={state.selectedChatId}
            onIssue={handleIssue}
            onChat={handleChat}
            onIssueContextMenu={onIssueContextMenu}
            onChatContextMenu={onChatContextMenu}
            query={query}
          />
        )}
      </div>

      {/* Free-form / categorised chats */}
      {(visibleCategories.length > 0 || visibleUnlinked.length > 0) && (
        <>
          <div style={{ height: 1, background: LINE.quiet, margin: "8px 4px" }} />
          <p style={{ fontSize: 10, fontWeight: 700, color: TEXT.caption, textTransform: "uppercase", letterSpacing: "0.06em", padding: "0 8px", margin: "0 0 4px" }}>
            Free-form
          </p>
          {visibleCategories.map((cat) => (
            <CategoryNode key={`${cat}:${query ? "s" : "n"}`} category={cat} selectedChatId={state.selectedChatId} onChat={handleChat} onChatContextMenu={onChatContextMenu} query={query} />
          ))}
          {visibleUnlinked.length > 0 && (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px" }}>
                <AlertCircle size={11} color={ACCENT.amber} />
                <span style={{ fontSize: 12, color: ACCENT.amber, fontWeight: 600 }}>Needs triage</span>
                <span style={{ fontSize: 10, color: ACCENT.amber, marginLeft: "auto" }}>{visibleUnlinked.length}</span>
              </div>
              {visibleUnlinked.map((c) => (
                <ChatChip key={c.id} chat={c} selected={state.selectedChatId === c.id} onSelect={() => handleChat(c.id)} onContextMenu={(e) => onChatContextMenu(e, c)} />
              ))}
            </div>
          )}
        </>
      )}

      <ContextMenu menu={menu} onClose={closeMenu} />
    </div>
  );
}
