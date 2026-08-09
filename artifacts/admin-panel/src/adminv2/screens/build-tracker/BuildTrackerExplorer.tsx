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
} from "lucide-react";
import { ACCENT, FONT, LINE, SURFACE, TEXT } from "../../theme";
import { getSnapshot, subscribe, selectEpic, selectIssue, selectChat, issuesForEpic, chatsForIssue, chatsForEpic, chatsForCategory, freeFormCategories, unlinkedChats, createIssue, createChat, updateEpic, deleteEpic, cycleIssueStatus, deleteIssue, updateChat, deleteChat } from "./buildTrackerStore";
import { EPIC_STATUS_COLOR, ISSUE_STATUS_COLOR, ISSUE_STATUS_LABEL, EPIC_STATUS_LABEL } from "./buildTrackerTypes";
import type { ChatRow, EpicRow, IssueRow } from "./buildTrackerTypes";
import { useContextMenu, ContextMenu } from "../../shell/ContextMenu";
import { getShellApi } from "../../shell/ShellContext";


function useStore() {
  return useSyncExternalStore(subscribe, getSnapshot);
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
    <button
      onClick={onSelect}
      onContextMenu={onContextMenu}
      title={chat.claudeUrl}
      style={{
        display: "flex", alignItems: "center", gap: 5,
        width: "100%", padding: "3px 8px 3px 28px",
        background: selected ? `${ACCENT.info}18` : "transparent",
        border: 0, borderRadius: 3, cursor: "pointer", textAlign: "left",
        borderLeft: selected ? `2px solid ${ACCENT.info}` : "2px solid transparent",
      }}
    >
      <MessageSquare size={11} color={ACCENT.info} style={{ flex: "none", opacity: 0.7 }} />
      <span style={{ fontSize: 11.5, color: selected ? TEXT.primary : TEXT.quiet, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {chat.title === chat.conversationId ? chat.conversationId.slice(0, 18) + "…" : chat.title}
      </span>
    </button>
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
}: {
  issue: IssueRow;
  selectedIssueId: number | null;
  selectedChatId: number | null;
  onIssue: (id: number) => void;
  onChat: (id: number) => void;
  onIssueContextMenu: (e: React.MouseEvent, issue: IssueRow) => void;
  onChatContextMenu: (e: React.MouseEvent, chat: ChatRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const chats = chatsForIssue(issue.id);
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
        <span style={{ fontSize: 12, color: isSelected ? TEXT.strong : TEXT.body, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {issue.githubNumber ? `#${issue.githubNumber} ` : ""}{issue.title}
        </span>
        <StatusPill label={ISSUE_STATUS_LABEL[issue.status]} color={ISSUE_STATUS_COLOR[issue.status]} />
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
}) {
  const [open, setOpen] = useState(false);
  const issues = issuesForEpic(epic.id);
  const visibleIssues = showClosed ? issues : issues.filter((i) => i.status !== "closed");
  const directChats = chatsForEpic(epic.id).filter((c) => c.epicId === epic.id && !c.issueId);
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
              key={i.id}
              issue={i}
              selectedIssueId={selectedIssueId}
              selectedChatId={selectedChatId}
              onIssue={onIssue}
              onChat={onChat}
              onIssueContextMenu={onIssueContextMenu}
              onChatContextMenu={onChatContextMenu}
            />
          ))}
          {directChats.map((c) => (
            <ChatChip key={c.id} chat={c} selected={selectedChatId === c.id} onSelect={() => onChat(c.id)} onContextMenu={(e) => onChatContextMenu(e, c)} />
          ))}
          {visibleIssues.length === 0 && directChats.length === 0 && (
            <p style={{ fontSize: 11, color: TEXT.faintest, padding: "2px 8px 2px 24px", margin: 0 }}>No issues yet</p>
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
}: {
  issues: IssueRow[];
  selectedIssueId: number | null;
  selectedChatId: number | null;
  onIssue: (id: number) => void;
  onChat: (id: number) => void;
  onIssueContextMenu: (e: React.MouseEvent, issue: IssueRow) => void;
  onChatContextMenu: (e: React.MouseEvent, chat: ChatRow) => void;
}) {
  const [open, setOpen] = useState(false);

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
              key={i.id}
              issue={i}
              selectedIssueId={selectedIssueId}
              selectedChatId={selectedChatId}
              onIssue={onIssue}
              onChat={onChat}
              onIssueContextMenu={onIssueContextMenu}
              onChatContextMenu={onChatContextMenu}
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
}: { category: string; selectedChatId: number | null; onChat: (id: number) => void; onChatContextMenu: (e: React.MouseEvent, chat: ChatRow) => void }) {
  const [open, setOpen] = useState(false);
  const chats = chatsForCategory(category);
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
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();

  function handleEpic(id: number) {
    getShellApi()?.openDoc({ kind: "epic", id: String(id), screenId: "build-tracker" });
  }
  function handleIssue(id: number) {
    getShellApi()?.openDoc({ kind: "issue", id: String(id), screenId: "build-tracker" });
  }
  function handleChat(id: number) {
    getShellApi()?.openDoc({ kind: "chatLink", id: String(id), screenId: "build-tracker" });
  }

  function onEpicContextMenu(e: React.MouseEvent, epic: EpicRow) {
    const items = [
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

  function onChatContextMenu(e: React.MouseEvent, chat: ChatRow) {
    const items = [
      {
        label: "Open in Claude",
        onSelect: () => window.open(chat.claudeUrl, "_blank")
      },
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
    ];

    openMenu(e, items, `Chat actions for ${chat.title}`);
  }

  if (state.epicsLoading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: TEXT.dim, fontSize: 12 }}>
        Loading…
      </div>
    );
  }

  const visibleEpics = showClosed ? state.epics : state.epics.filter(e => e.status !== "closed");
  const noEpicIssues = state.issues.filter((i) => i.epicId === null);
  const visibleNoEpicIssues = showClosed ? noEpicIssues : noEpicIssues.filter((i) => i.status !== "closed");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
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

      <div style={{ display: "flex", flexDirection: "column", gap: 1, padding: "8px 4px", overflowY: "auto", flex: 1 }}>
        {/* Epics */}
        {visibleEpics.length === 0 ? (
          <div style={{ padding: "12px 8px", fontSize: 12, color: TEXT.dim, textAlign: "center" }}>
            <GitBranch size={20} color={TEXT.faintest} style={{ marginBottom: 6 }} />
            <p style={{ margin: 0 }}>No open epics</p>
            {state.epics.length > 0 && <p style={{ margin: "4px 0 0", fontSize: 11, color: TEXT.faintest }}>Change filter to see closed epics</p>}
          </div>
        ) : (
          visibleEpics.map((e) => (
            <EpicNode
              key={e.id}
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
            />
          ))
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
          />
        )}
      </div>

      {/* Free-form / categorised chats */}
      {(categories.length > 0 || unlinked.length > 0) && (
        <>
          <div style={{ height: 1, background: LINE.quiet, margin: "8px 4px" }} />
          <p style={{ fontSize: 10, fontWeight: 700, color: TEXT.caption, textTransform: "uppercase", letterSpacing: "0.06em", padding: "0 8px", margin: "0 0 4px" }}>
            Free-form
          </p>
          {categories.map((cat) => (
            <CategoryNode key={cat} category={cat} selectedChatId={state.selectedChatId} onChat={handleChat} onChatContextMenu={onChatContextMenu} />
          ))}
          {unlinked.length > 0 && (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px" }}>
                <AlertCircle size={11} color={ACCENT.amber} />
                <span style={{ fontSize: 12, color: ACCENT.amber, fontWeight: 600 }}>Needs triage</span>
                <span style={{ fontSize: 10, color: ACCENT.amber, marginLeft: "auto" }}>{unlinked.length}</span>
              </div>
              {unlinked.map((c) => (
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
