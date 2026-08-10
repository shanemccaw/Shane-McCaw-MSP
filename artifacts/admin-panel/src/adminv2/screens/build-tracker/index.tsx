/**
 * Build Tracker — Claude chat organiser at `/adminv2/build-tracker`.
 *
 * Places all controls on the new "Build" fixed tab (added alongside Git/Run in
 * the amber dev capsule) rather than Home. The Watch tab carries the
 * "Unlinked chats" live count — chats that have been ingested but not yet
 * assigned to an epic, issue, or category.
 *
 * Peek kinds registered: `issue` and `chatLink` (both added to PEEK_KINDS in
 * registry/types.ts with the standard rationale doc comment).
 *
 * GitHub integration: POST /admin/build-tracker/github-sync pulls milestones
 * → bt_epics and issues → bt_issues from shanemccaw/Shane-McCaw-MSP using
 * GITHUB_TOKEN env var. Token never touches client code.
 *
 * Browser extension ingest: POST /admin/build-tracker/chats/ingest accepts
 * { conversation_id: "uuid" } — no session cookie needed if
 * BUILD_TRACKER_INGEST_TOKEN env var is set and the extension sends
 * Authorization: Bearer <token>.
 */

import {
  BookOpen, GitBranch, GitPullRequest, MessageSquare, Plus,
  RefreshCw, AlertCircle, ExternalLink, Trash2,
} from "lucide-react";
import { registerScreen } from "../../registry/registry";
import { getShellApi } from "../../shell/ShellContext";
import { ACCENT } from "../../theme";
import type { CommandItem } from "../../registry/types";
import { BuildTrackerBody } from "./BuildTrackerBody";
import { BuildTrackerExplorer } from "./BuildTrackerExplorer";
import { BuildTrackerProperties } from "./BuildTrackerProperties";
import {
  getSnapshot,
  selectEpic, selectIssue, selectChat,
  createEpic, createIssue, createChat,
  epicById, issueById, chatById,
  chatsForIssue, unlinkedCount,
  updateEpic, updateIssue, updateChat,
  deleteEpic, deleteIssue, deleteChat,
  syncFromGitHub, loadAll, setTriageActive, setTriageShowAssigned,
  WATCH_UNLINKED_KEY,
} from "./buildTrackerStore";
import {
  EPIC_STATUS_COLOR, EPIC_STATUS_LABEL,
  ISSUE_STATUS_COLOR, ISSUE_STATUS_LABEL, ISSUE_STATUS_NEXT,
} from "./buildTrackerTypes";

const ROUTE = "/build-tracker";

function goto() {
  getShellApi()?.navigate(ROUTE);
}

function openIssue(id: number) {
  selectIssue(id);
  getShellApi()?.openDoc({ kind: "issue", id: String(id), screenId: "build-tracker" });
}

function openChat(id: number) {
  selectChat(id);
  getShellApi()?.openDoc({ kind: "chatLink", id: String(id), screenId: "build-tracker" });
}

registerScreen({
  id: "build-tracker",
  title: "Build Tracker",
  area: "build-tracker",
  icon: BookOpen,
  route: ROUTE,

  render: (ctx) => {
    const state = getSnapshot();
    // When navigated here from a peek or palette record link, select the right node.
    if (ctx.kind === "epic" && ctx.recordId && state.selectedEpicId !== Number(ctx.recordId)) {
      selectEpic(Number(ctx.recordId));
    }
    if (ctx.kind === "issue" && ctx.recordId && state.selectedIssueId !== Number(ctx.recordId)) {
      selectIssue(Number(ctx.recordId));
    }
    if (ctx.kind === "chatLink" && ctx.recordId && state.selectedChatId !== Number(ctx.recordId)) {
      selectChat(Number(ctx.recordId));
    }
    return <BuildTrackerBody />;
  },

  // ── Ribbon: Build tab ───────────────────────────────────────────────────────
  ribbon: [
    {
      tab: "build",
      order: 10,
      group: {
        label: "Tracker",
        large: [
          {
            label: "Build Tracker",
            icon: BookOpen,
            intent: "open",
            onSelect: goto,
            title: "Organise Claude chats against GitHub epics and issues",
          },
        ],
        small: [
          {
            label: "New epic",
            icon: GitBranch,
            intent: "create",
            onSelect: () => {
              goto();
              const title = window.prompt("Epic title:");
              if (title?.trim()) void createEpic(title.trim());
            },
          },
          {
            label: "New issue",
            icon: GitPullRequest,
            intent: "create",
            onSelect: () => {
              goto();
              const title = window.prompt("Issue title:");
              if (title?.trim()) void createIssue(title.trim(), null);
            },
          },
        ],
      },
    },
    {
      tab: "build",
      order: 20,
      group: {
        label: "GitHub",
        large: [
          {
            label: "Sync GitHub",
            icon: RefreshCw,
            intent: "global",
            onSelect: () => { goto(); void syncFromGitHub(); },
            title: "Pull milestones → epics and issues from shanemccaw/Shane-McCaw-MSP",
          },
        ],
        small: [
          {
            label: "Reload",
            icon: RefreshCw,
            intent: "open",
            onSelect: () => void loadAll(),
          },
        ],
      },
    },
    // ── Watch tab: unlinked chats needing triage ─────────────────────────────
    {
      tab: "watch",
      order: 50,
      group: {
        label: "Build Tracker",
        large: [
          {
            label: "Unlinked chats",
            icon: MessageSquare,
            intent: "open",
            color: unlinkedCount() > 0 ? ACCENT.amber : undefined,
            liveKey: WATCH_UNLINKED_KEY,
            onSelect: goto,
            title: "Chats ingested but not yet assigned to an epic, issue, or category",
          },
        ],
      },
    },
  ],

  // ── Contextual tab: Tools ──────────────────────────────────────────────────
  contextualTab: (ctx) => {
    const state = getSnapshot();
    if (state.triageActive) {
      return {
        id: "triage-tools",
        label: "Triage Tools",
        groups: [
          {
            label: "Filter",
            large: [
              {
                label: state.triageShowAssigned ? "Hide Assigned" : "Show Assigned",
                icon: BookOpen,
                intent: "record",
                color: state.triageShowAssigned ? ACCENT.info : undefined,
                onSelect: () => void setTriageShowAssigned(!state.triageShowAssigned),
                title: "Toggle showing issues that are already assigned to an Epic",
              },
            ],
          },
          {
            label: "Actions",
            large: [
              {
                label: "Exit Triage",
                icon: RefreshCw,
                intent: "record",
                onSelect: () => void setTriageActive(false),
              },
            ],
          },
        ],
      };
    }

    if (!ctx.kind || !ctx.recordId) {
      return {
        id: "build-tracker-tools",
        label: "Build Tools",
        groups: [
          {
            label: "Roadmap",
            large: [
              {
                label: "Gantt & Roadmap",
                icon: Target,
                intent: "open",
                color: ACCENT.amber,
                onSelect: () => getShellApi()?.navigate("/project-management"),
                title: "Open Gantt Chart and Milestone Roadmap",
              },
            ],
          },
          {
            label: "Actions",
            small: [
              {
                label: "Sync from GitHub",
                icon: RefreshCw,
                intent: "record",
                onSelect: () => void syncFromGitHub(),
              },
              {
                label: "Triage Issues",
                icon: BookOpen,
                intent: "record",
                onSelect: () => {
                  setTriageActive(true);
                },
              },
            ],
          },
        ],
      };
    }

    if (ctx.kind === "epic") {
      const epic = epicById(Number(ctx.recordId));
      if (!epic) return null;
      return {
        id: "epic-tools",
        label: "Epic Tools",
        groups: [
          {
            label: "Actions",
            large: [
              {
                label: "New issue",
                icon: GitPullRequest,
                intent: "record",
                onSelect: () => {
                  const title = window.prompt(`New issue title for Epic "${epic.title}":`);
                  if (title?.trim()) void createIssue(title.trim(), epic.id);
                },
              },
            ],
            small: [
              {
                label: epic.status === "closed" ? "Mark as Open" : "Mark as Closed",
                icon: GitBranch,
                intent: "record",
                onSelect: () => void updateEpic(epic.id, { status: epic.status === "closed" ? "open" : "closed" }),
              },
              {
                label: "Link Claude chat",
                icon: MessageSquare,
                intent: "record",
                onSelect: () => {
                  const cid = window.prompt("Paste Claude conversation ID or URL:");
                  if (cid?.trim()) void createChat(cid.trim(), cid.trim(), null, epic.id);
                },
              },
              {
                label: "Delete Epic",
                icon: Trash2,
                intent: "record",
                color: ACCENT.danger,
                onSelect: () => {
                  if (window.confirm(`Delete Epic "${epic.title}"? This cannot be undone.`)) {
                    void deleteEpic(epic.id);
                    getShellApi()?.navigate(ROUTE);
                  }
                },
              },
            ],
          },
          {
            label: "Navigate",
            small: [
              { label: "All epics", icon: BookOpen, intent: "open", onSelect: goto },
              ...(epic.githubNumber
                ? [{ label: "GitHub Milestone", icon: ExternalLink, intent: "open" as const, onSelect: () => window.open(`https://github.com/shanemccaw/Shane-McCaw-MSP/milestone/${epic.githubNumber}`, "_blank") }]
                : []),
            ],
          },
          {
            label: "Triage",
            large: [
              {
                label: "Triage issues",
                icon: BookOpen,
                intent: "record",
                color: ACCENT.amber,
                onSelect: () => {
                  goto();
                  setTriageActive(true);
                },
                title: "Decide what to do with the pile of open issues",
              },
            ],
          },
        ],
      };
    }

    if (ctx.kind === "issue") {
      const issue = issueById(ctx.recordId);
      if (!issue) return null;
      const next = ISSUE_STATUS_NEXT[issue.status];
      const state = getSnapshot();
      const openEpics = state.epics.filter(e => e.status !== "closed");

      return {
        id: "issue-tools",
        label: "Issue Tools",
        groups: [
          {
            label: "Status",
            large: [
              {
                label: `→ ${ISSUE_STATUS_LABEL[next]}`,
                icon: GitPullRequest,
                intent: "record",
                color: ISSUE_STATUS_COLOR[next],
                onSelect: () => void updateIssue(issue.id, { status: next }),
              },
            ],
            small: [
              {
                label: "Set as Backlog",
                icon: GitPullRequest,
                intent: "record",
                onSelect: () => void updateIssue(issue.id, { status: "backlog" }),
              },
              {
                label: "Set as In Progress",
                icon: GitPullRequest,
                intent: "record",
                onSelect: () => void updateIssue(issue.id, { status: "in_progress" }),
              },
              {
                label: "Set as Done",
                icon: GitPullRequest,
                intent: "record",
                onSelect: () => void updateIssue(issue.id, { status: "done" }),
              },
              {
                label: "Set as Closed",
                icon: GitPullRequest,
                intent: "record",
                onSelect: () => void updateIssue(issue.id, { status: "closed" }),
              },
            ],
          },
          ...(issue.epicId === null && openEpics.length > 0
            ? [
                {
                  label: "Assign Epic",
                  large: [
                    {
                      label: "Assign Epic",
                      icon: GitBranch,
                      intent: "record" as const,
                      onSelect: () => {},
                      gallery: {
                        id: `assign-epic-gallery-${issue.id}`,
                        title: "Assign Issue to Epic",
                        searchable: true,
                        searchPlaceholder: "Search epics...",
                        rows: openEpics.map((e) => ({
                          id: String(e.id),
                          tile: e.githubNumber ? `#${e.githubNumber}` : "EP",
                          name: e.title,
                          sub: `Epic Status: ${e.status}`,
                          onSelect: () => void updateIssue(issue.id, { epicId: e.id }),
                        })),
                      },
                    },
                  ],
                },
              ]
            : []),
          {
            label: "Chat",
            small: [
              {
                label: "Link a chat",
                icon: MessageSquare,
                intent: "record",
                onSelect: () => {
                  const cid = window.prompt("Paste the Claude conversation ID:");
                  if (cid?.trim()) {
                    void (async () => {
                      const { createChat } = await import("./buildTrackerStore");
                      await createChat(cid.trim(), cid.trim(), issue.id, null, null);
                    })();
                  }
                },
              },
              {
                label: "Delete Issue",
                icon: Trash2,
                intent: "record",
                color: ACCENT.danger,
                onSelect: () => {
                  if (window.confirm(`Delete Issue "${issue.title}"? This cannot be undone.`)) {
                    void deleteIssue(issue.id);
                    getShellApi()?.navigate(ROUTE);
                  }
                },
              },
            ],
          },
          {
            label: "Navigate",
            small: [
              { label: "All issues", icon: BookOpen, intent: "open", onSelect: goto },
              ...(issue.githubUrl
                ? [{ label: "GitHub Issue", icon: ExternalLink, intent: "open" as const, onSelect: () => window.open(issue.githubUrl!, "_blank") }]
                : []),
            ],
          },
          {
            label: "Triage",
            large: [
              {
                label: "Triage issues",
                icon: BookOpen,
                intent: "record",
                color: ACCENT.amber,
                onSelect: () => {
                  goto();
                  setTriageActive(true);
                },
                title: "Decide what to do with the pile of open issues",
              },
            ],
          },
        ],
      };
    }

    if (ctx.kind === "chatLink") {
      const chat = chatById(ctx.recordId);
      if (!chat) return null;
      return {
        id: "chat-tools",
        label: "Chat Tools",
        groups: [
          {
            label: "Chat",
            large: [
              {
                label: "Open in Claude",
                icon: ExternalLink,
                intent: "record",
                onSelect: () => window.open(chat.claudeUrl, "_blank"),
              },
            ],
            small: [
              {
                label: "Rename chat",
                icon: MessageSquare,
                intent: "record",
                onSelect: () => {
                  const title = window.prompt("New chat title:", chat.title);
                  if (title?.trim()) void updateChat(chat.id, { title: title.trim() });
                },
              },
              {
                label: "Delete chat link",
                icon: Trash2,
                intent: "record",
                color: ACCENT.danger,
                onSelect: () => {
                  if (window.confirm("Delete this chat link?")) {
                    void deleteChat(chat.id);
                    getShellApi()?.navigate(ROUTE);
                  }
                },
              },
            ],
          },
        ],
      };
    }

    return null;
  },

  // ── Peeks ──────────────────────────────────────────────────────────────────
  peeks: {
    epic: (id) => {
      const epic = epicById(Number(id));
      if (!epic) return null;
      return {
        kind: "epic",
        eyebrow: "EPIC",
        title: epic.title,
        sub: epic.githubNumber ? `#${epic.githubNumber} · ${EPIC_STATUS_LABEL[epic.status]}` : EPIC_STATUS_LABEL[epic.status],
        icon: GitBranch,
        tone: EPIC_STATUS_COLOR[epic.status],
        tag: EPIC_STATUS_LABEL[epic.status],
        tagTone: EPIC_STATUS_COLOR[epic.status],
        facts: [
          { label: "Status", value: EPIC_STATUS_LABEL[epic.status], prose: true },
        ],
        edits: [
          { key: "title", label: "Title", value: epic.title, onChange: (v) => void updateEpic(epic.id, { title: v }) },
        ],
        open: () => {
          selectEpic(epic.id);
          getShellApi()?.openDoc({ kind: "epic", id: String(epic.id), screenId: "build-tracker" });
        },
        openLabel: "Open detail",
        actions: [
          { label: "Delete", tone: "danger", confirm: true, onSelect: () => void deleteEpic(epic.id) },
        ],
      };
    },

    issue: (id) => {
      const issue = issueById(id);
      if (!issue) return null;
      const chats = chatsForIssue(issue.id);
      return {
        kind: "issue",
        eyebrow: "ISSUE",
        title: issue.title,
        sub: issue.githubNumber ? `#${issue.githubNumber} · ${ISSUE_STATUS_LABEL[issue.status]}` : ISSUE_STATUS_LABEL[issue.status],
        icon: GitPullRequest,
        tone: ISSUE_STATUS_COLOR[issue.status],
        tag: ISSUE_STATUS_LABEL[issue.status],
        tagTone: ISSUE_STATUS_COLOR[issue.status],
        facts: [
          { label: "Chats linked", value: String(chats.length) },
          { label: "Status", value: ISSUE_STATUS_LABEL[issue.status], prose: true },
          ...(issue.epicId ? [{ label: "Epic", value: epicById(issue.epicId)?.title ?? "Unknown", prose: true }] : []),
        ],
        edits: [
          { key: "title", label: "Title", value: issue.title, onChange: (v) => void updateIssue(issue.id, { title: v }) },
        ],
        list: chats.length > 0 ? {
          title: "Claude Chats",
          rows: chats.map((c) => ({
            id: String(c.id),
            name: c.title === c.conversationId ? `Chat ${c.conversationId.slice(0, 18)}…` : c.title,
            sub: c.notes ?? c.claudeUrl,
            onSelect: () => getShellApi()?.openPeek("chatLink", String(c.id)),
          })),
        } : undefined,
        open: () => openIssue(issue.id),
        openLabel: "Open full detail",
        actions: [
          { label: "Delete", tone: "danger", confirm: true, onSelect: () => void deleteIssue(issue.id) },
        ],
      };
    },

    chatLink: (id) => {
      const chat = chatById(id);
      if (!chat) return null;
      const issue = chat.issueId ? issueById(chat.issueId) : undefined;
      return {
        kind: "chatLink",
        eyebrow: "CHAT",
        title: chat.title === chat.conversationId
          ? `Chat ${chat.conversationId.slice(0, 24)}…`
          : chat.title,
        sub: issue ? `Issue: ${issue.title}` : chat.category ?? "Unlinked",
        icon: MessageSquare,
        tone: ACCENT.info,
        tag: chat.category ?? (issue ? "Linked" : "Unlinked"),
        tagTone: issue ? ACCENT.green : chat.category ? ACCENT.info : ACCENT.amber,
        facts: [
          { label: "Status", value: issue ? `On: ${ISSUE_STATUS_LABEL[issue.status]}` : "Not linked", prose: true },
          { label: "Category", value: chat.category ?? "—", prose: true },
        ],
        edits: [
          { key: "title", label: "Label", value: chat.title, onChange: (v) => void updateChat(chat.id, { title: v }) },
          { key: "notes", label: "Notes", value: chat.notes ?? "", area: true, onChange: (v) => void updateChat(chat.id, { notes: v || null }) },
        ],
        open: () => { window.open(chat.claudeUrl, "_blank"); },
        openLabel: "Open Claude chat ↗",
        actions: [
          { label: "Delete", tone: "danger", confirm: true, onSelect: () => void deleteChat(chat.id) },
        ],
      };
    },
  },

  // ── Palette entries ──────────────────────────────────────────────────────────
  commands: (): CommandItem[] => {
    const state = getSnapshot();

    const epicItems: CommandItem[] = state.epics.map((e) => ({
      id: `rec:epic-${e.id}`,
      type: "record",
      kind: "go",
      name: e.title,
      sub: `Epic · ${EPIC_STATUS_LABEL[e.status]}${e.githubNumber ? ` · #${e.githubNumber}` : ""}`,
      area: "build-tracker",
      run: () => { selectEpic(e.id); goto(); },
    }));

    const issueItems: CommandItem[] = state.issues.map((i) => ({
      id: `rec:issue-${i.id}`,
      type: "record",
      kind: "issue",
      name: i.title,
      sub: `Issue · ${ISSUE_STATUS_LABEL[i.status]}${i.githubNumber ? ` · #${i.githubNumber}` : ""}`,
      tag: i.status === "in_progress" ? "active" : undefined,
      area: "build-tracker",
      run: () => getShellApi()?.openPeek("issue", String(i.id)),
    }));

    const chatItems: CommandItem[] = state.chats.map((c) => ({
      id: `rec:chat-${c.id}`,
      type: "record",
      kind: "chatLink",
      name: c.title === c.conversationId ? `Chat ${c.conversationId.slice(0, 18)}…` : c.title,
      sub: c.category ?? (c.issueId ? `Issue ${c.issueId}` : "Unlinked"),
      area: "build-tracker",
      run: () => getShellApi()?.openPeek("chatLink", String(c.id)),
    }));

    const unlinked = unlinkedCount(state);
    const answers: CommandItem[] = [
      {
        id: "ans:bt-unlinked",
        type: "answer",
        name: "Unlinked chats needing triage",
        sub: "Ingested but not yet assigned",
        area: "build-tracker",
        live: String(unlinked),
        run: goto,
      },
    ];

    const actions: CommandItem[] = [
      { id: "act:bt-sync", type: "action", kind: "run", name: "Sync from GitHub", sub: "Pull milestones and issues", area: "build-tracker", run: () => { goto(); void syncFromGitHub(); } },
      { id: "act:bt-new-epic", type: "action", kind: "run", name: "New epic", sub: "Create an epic manually", area: "build-tracker", run: () => { goto(); const t = window.prompt("Epic title:"); if (t?.trim()) void createEpic(t.trim()); } },
      { id: "act:bt-new-issue", type: "action", kind: "run", name: "New issue", sub: "Create an issue manually", area: "build-tracker", run: () => { goto(); const t = window.prompt("Issue title:"); if (t?.trim()) void createIssue(t.trim(), null); } },
    ];

    return [...epicItems, ...issueItems, ...chatItems, ...answers, ...actions];
  },

  left:  { title: "Epics & Issues", render: () => <BuildTrackerExplorer /> },
  right: { title: "Properties",     render: () => <BuildTrackerProperties /> },
});
