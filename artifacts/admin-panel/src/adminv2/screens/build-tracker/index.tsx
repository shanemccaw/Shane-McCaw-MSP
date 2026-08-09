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
  RefreshCw, AlertCircle, ExternalLink,
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
  createEpic, createIssue,
  epicById, issueById, chatById,
  chatsForIssue, unlinkedCount,
  updateEpic, updateIssue, updateChat,
  deleteEpic, deleteIssue, deleteChat,
  syncFromGitHub, loadAll,
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
    // When navigated here from a peek or palette record link, select the right node.
    if (ctx.kind === "issue" && ctx.recordId)    selectIssue(Number(ctx.recordId));
    if (ctx.kind === "chatLink" && ctx.recordId) selectChat(Number(ctx.recordId));
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

  // ── Contextual tab: Issue Tools ─────────────────────────────────────────────
  contextualTab: (ctx) => {
    if (ctx.kind !== "issue" || !ctx.recordId) return null;
    const issue = issueById(ctx.recordId);
    if (!issue) return null;
    const next = ISSUE_STATUS_NEXT[issue.status];
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
        },
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
          ],
        },
        {
          label: "Navigate",
          small: [
            { label: "All issues", icon: GitBranch, intent: "open", onSelect: goto },
            ...(issue.githubUrl
              ? [{ label: "GitHub", icon: ExternalLink, intent: "open" as const, onSelect: () => window.open(issue.githubUrl!, "_blank") }]
              : []),
          ],
        },
      ],
    };
  },

  // ── Peek: issue ─────────────────────────────────────────────────────────────
  peeks: {
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
