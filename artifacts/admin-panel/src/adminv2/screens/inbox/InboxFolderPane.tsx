/**
 * Inbox's left panel — folders, CRM views, and the unread/flagged/attachment
 * filter chips. Registered as the screen's `left` panel (SHELL.md §6), so the
 * shell owns the header, the collapse rail and the persisted width; this only
 * supplies the body.
 */

import { useSyncExternalStore } from "react";
import { Archive, Briefcase, Inbox as InboxIcon, Pencil, Send, Trash2, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ACCENT, LINE, TEXT, WASH } from "../../theme";
import { ContextMenu, useContextMenu } from "../../shell/ContextMenu";
import {
  clearFilters,
  getSnapshot,
  openCompose,
  setSelectedFolder,
  subscribe,
  toggleFilter,
  type InboxFilter,
  type InboxFolder,
} from "./inboxStore";

const SYSTEM_FOLDERS: Array<{ key: InboxFolder; label: string; icon: LucideIcon }> = [
  { key: "inbox", label: "Inbox", icon: InboxIcon },
  { key: "sent", label: "Sent", icon: Send },
  { key: "drafts", label: "Drafts", icon: Pencil },
  { key: "archive", label: "Archive", icon: Archive },
  { key: "deleted", label: "Deleted", icon: Trash2 },
];

const CRM_FOLDERS: Array<{ key: InboxFolder; label: string; icon: LucideIcon }> = [
  { key: "crm:leads", label: "Leads", icon: Users },
  { key: "crm:prospects", label: "Prospects", icon: Users },
  { key: "crm:customers", label: "Customers", icon: Briefcase },
];

const FILTERS: Array<{ key: InboxFilter; label: string }> = [
  { key: "unread", label: "Unread" },
  { key: "flagged", label: "Flagged" },
  { key: "hasAttachments", label: "Has attachments" },
];

function SectionLabel({ children }: { children: string }) {
  return (
    <div
      style={{
        padding: "10px 10px 4px",
        fontSize: 10.5,
        fontWeight: 800,
        letterSpacing: ".07em",
        textTransform: "uppercase",
        color: TEXT.caption,
      }}
    >
      {children}
    </div>
  );
}

function FolderRow({
  label,
  icon: Icon,
  active,
  onSelect,
}: {
  label: string;
  icon: LucideIcon;
  active: boolean;
  onSelect: () => void;
}) {
  const { menu, open, close } = useContextMenu();

  return (
    <>
      <button
        type="button"
        onClick={onSelect}
        onContextMenu={(event) =>
          open(
            event,
            [
              { label: "Open", onSelect },
              { label: "Copy folder name", onSelect: () => navigator.clipboard?.writeText(label) },
            ],
            `Actions for ${label}`,
          )
        }
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "6px 10px",
          margin: "0 6px",
          width: "calc(100% - 12px)",
          borderRadius: 5,
          border: "none",
          background: active ? WASH.selected : "transparent",
          color: active ? TEXT.bright : TEXT.soft,
          fontSize: 12.5,
          fontWeight: active ? 600 : 500,
          fontFamily: "inherit",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <Icon size={14} color={active ? ACCENT.info : TEXT.dim} style={{ flexShrink: 0 }} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      </button>
      <ContextMenu menu={menu} onClose={close} />
    </>
  );
}

export function InboxFolderPane() {
  const state = useSyncExternalStore(subscribe, getSnapshot);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "auto" }}>
      <div style={{ padding: 8 }}>
        <button
          type="button"
          onClick={() => openCompose({ mode: "new" })}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            width: "100%",
            height: 30,
            borderRadius: 6,
            border: "none",
            background: "#0f6cbd",
            color: "#fff",
            fontFamily: "inherit",
            fontSize: 12.5,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <Pencil size={13} />
          New message
        </button>
      </div>

      <SectionLabel>Folders</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 1, paddingBottom: 6 }}>
        {SYSTEM_FOLDERS.map((f) => (
          <FolderRow key={f.key} label={f.label} icon={f.icon} active={state.selectedFolder === f.key} onSelect={() => setSelectedFolder(f.key)} />
        ))}
      </div>

      <SectionLabel>CRM views</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 1, paddingBottom: 6 }}>
        {CRM_FOLDERS.map((f) => (
          <FolderRow key={f.key} label={f.label} icon={f.icon} active={state.selectedFolder === f.key} onSelect={() => setSelectedFolder(f.key)} />
        ))}
      </div>

      <div style={{ borderTop: `1px solid ${LINE.subtle}`, marginTop: 4, paddingTop: 6 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 10px 4px" }}>
          <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".07em", textTransform: "uppercase", color: TEXT.caption }}>
            Filters
          </span>
          {state.filters.size > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              style={{ border: "none", background: "transparent", color: TEXT.meta, fontFamily: "inherit", fontSize: 10.5, cursor: "pointer" }}
            >
              Clear
            </button>
          )}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, padding: "0 10px 10px" }}>
          {FILTERS.map((f) => {
            const on = state.filters.has(f.key);
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => toggleFilter(f.key)}
                style={{
                  padding: "3px 9px",
                  borderRadius: 10,
                  border: `1px solid ${on ? "rgba(15,108,189,.55)" : LINE.control}`,
                  background: on ? WASH.selected : "transparent",
                  color: on ? TEXT.bright : TEXT.dim,
                  fontFamily: "inherit",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
