/**
 * Inbox — the "inbox" fixed tab's screen. Real Graph mail (`/api/inbox/*`,
 * `artifacts/api-server/src/routes/inbox.ts`), not invented data.
 *
 * Fixed-tab ribbon groups only ever open a folder/CRM view or create a new
 * message — per-message actions (reply, flag, archive, delete, the AI
 * extras) live on the "Message Tools" contextual tab, which activates once a
 * message is opened as a doc (`shell.openDoc({kind:"mail", ...})` in
 * `InboxBody.tsx`). Ribbon closures are built once at module-load time, so
 * they reach the store's action helpers rather than hooks — see
 * `inboxStore.ts`'s doc comment.
 */

import { Archive, Briefcase, Flag, Forward, Inbox as InboxIcon, Mail, MailX, Pencil, Reply, Send, Sparkles, Trash2, Users } from "lucide-react";
import { ACCENT } from "../../theme";
import { registerScreen } from "../../registry/registry";
import { getShellApi } from "../../shell/ShellContext";
import { InboxBody } from "./InboxBody";
import { InboxFolderPane } from "./InboxFolderPane";
import { InboxProperties } from "./InboxProperties";
import {
  archiveMessageAction,
  clearFilters,
  deleteMessageAction,
  getMailSummary,
  markReadAction,
  openCompose,
  setFilters,
  setSelectedFolder,
  toggleFlagAction,
} from "./inboxStore";

function goInbox() {
  getShellApi()?.navigate("/inbox");
  setSelectedFolder("inbox");
  clearFilters();
}

function goFlagged() {
  getShellApi()?.navigate("/inbox");
  setSelectedFolder("inbox");
  setFilters(["flagged"]);
}

function goFolder(folder: Parameters<typeof setSelectedFolder>[0]) {
  return () => {
    getShellApi()?.navigate("/inbox");
    setSelectedFolder(folder);
  };
}

function closeMailDoc(id: string) {
  getShellApi()?.dispatch({ type: "closeDoc", id: `mail:${id}` });
}

registerScreen({
  id: "inbox",
  title: "Inbox",
  area: "inbox",
  icon: InboxIcon,
  route: "/inbox",
  render: (ctx) => <InboxBody recordId={ctx.recordId} />,
  left: { title: "Folders", render: () => <InboxFolderPane /> },
  right: { title: "Properties", render: () => <InboxProperties /> },

  ribbon: [
    {
      tab: "inbox",
      order: 10,
      group: {
        label: "Mail",
        large: [{ label: "Inbox", icon: InboxIcon, intent: "open", onSelect: goInbox }],
        small: [
          { label: "Flagged", icon: Flag, intent: "open", onSelect: goFlagged, color: ACCENT.amber },
          { label: "Drafts", icon: Pencil, intent: "open", onSelect: goFolder("drafts") },
          { label: "Sent", icon: Send, intent: "open", onSelect: goFolder("sent") },
        ],
      },
    },
    {
      tab: "inbox",
      order: 20,
      group: {
        label: "CRM views",
        large: [{ label: "Leads", icon: Users, intent: "open", onSelect: goFolder("crm:leads") }],
        small: [
          { label: "Prospects", icon: Users, intent: "open", onSelect: goFolder("crm:prospects") },
          { label: "Customers", icon: Briefcase, intent: "open", onSelect: goFolder("crm:customers") },
        ],
      },
    },
    {
      tab: "inbox",
      order: 30,
      group: {
        label: "Compose",
        large: [
          {
            label: "New message",
            icon: Pencil,
            intent: "create",
            onSelect: () => {
              getShellApi()?.navigate("/inbox");
              openCompose({ mode: "new" });
            },
          },
        ],
      },
    },
  ],

  contextualTab: (ctx) => {
    const id = ctx.recordId;
    if (!id) return null;
    return {
      id: "message-tools",
      label: "Message Tools",
      groups: [
        {
          label: "Reply",
          large: [{ label: "Reply", icon: Reply, intent: "record", onSelect: () => openCompose({ mode: "reply", sourceMessageId: id }) }],
          small: [
            { label: "Reply all", icon: Reply, intent: "record", onSelect: () => openCompose({ mode: "replyAll", sourceMessageId: id }) },
            { label: "Forward", icon: Forward, intent: "record", onSelect: () => openCompose({ mode: "forward", sourceMessageId: id }) },
            {
              label: "Draft with AI",
              icon: Sparkles,
              intent: "record",
              color: ACCENT.info,
              onSelect: () => openCompose({ mode: "reply", sourceMessageId: id, aiDraft: true }),
            },
          ],
        },
        {
          label: "This message",
          large: [
            {
              label: "Archive",
              icon: Archive,
              intent: "record",
              onSelect: () => {
                void archiveMessageAction(id);
                closeMailDoc(id);
              },
            },
          ],
          small: [
            {
              label: "Delete",
              icon: Trash2,
              intent: "record",
              color: ACCENT.danger,
              onSelect: () => {
                void deleteMessageAction(id);
                closeMailDoc(id);
              },
            },
            {
              label: "Toggle flag",
              icon: Flag,
              intent: "record",
              onSelect: () => void toggleFlagAction(id, getMailSummary(id)?.flagged ?? false),
            },
            { label: "Mark unread", icon: MailX, intent: "record", onSelect: () => void markReadAction(id, false) },
          ],
        },
      ],
    };
  },

  peeks: {
    mail: (id) => {
      const m = getMailSummary(id);
      if (!m) return null;
      return {
        kind: "mail",
        eyebrow: "MAIL",
        title: m.subject,
        sub: m.fromName || m.fromAddress,
        icon: Mail,
        tone: ACCENT.info,
        tag: m.isRead ? undefined : "Unread",
        tagTone: ACCENT.info,
        facts: [
          { label: "From", value: m.fromAddress || "—" },
          { label: "Received", value: m.receivedDateTime ? new Date(m.receivedDateTime).toLocaleString() : "—", prose: true },
        ],
        open: () => getShellApi()?.openDoc({ kind: "mail", id, screenId: "inbox", label: m.subject }),
      };
    },
  },

  commands: () => [
    {
      id: "act:inbox-compose",
      type: "action",
      kind: "mail",
      name: "New message",
      sub: "Compose a message through Exchange Online",
      area: "inbox",
      run: () => {
        getShellApi()?.navigate("/inbox");
        openCompose({ mode: "new" });
      },
    },
  ],
});
