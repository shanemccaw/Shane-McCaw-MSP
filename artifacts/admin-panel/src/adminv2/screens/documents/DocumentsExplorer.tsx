/**
 * Document Viewer's left (Explorer) panel — the list itself.
 *
 * Every real generation, newest first, search + category chips filtering
 * client-side over the loaded window (see `documentsStore.ts`'s file doc
 * comment for why). Selecting a row fills the main canvas and the Properties
 * panel — handoff.md principle 3, a one-off look should not move you off what
 * you were doing. Opening a document *properly* (its own doc tab, the
 * contextual tab) still goes through `openDoc`/`openPeek`, same as every
 * other screen's Explorer.
 */

import { useEffect, useSyncExternalStore } from "react";
import { Search } from "lucide-react";
import { ACCENT, ACCENT_TEXT, FONT, LINE, SURFACE, TEXT, WASH } from "../../theme";
import { getShellApi } from "../../shell/ShellContext";
import { ContextMenu, useContextMenu } from "../../shell/ContextMenu";
import {
  archiveSelected,
  copyText,
  getSnapshot,
  selectDocument,
  setCategory,
  setSearch,
  subscribe,
  visibleDocuments,
  warmDocuments,
} from "./documentsStore";
import {
  CATEGORY_LABEL,
  DOC_CATEGORY_FILTERS,
  STATUS_LABEL,
  costLabel,
  statusTone,
  subjectLabel,
  whenLabel,
  type DocumentEntry,
} from "./documentsTypes";

const TONE_COLOR: Record<string, string> = {
  danger: ACCENT.danger,
  amber: ACCENT.amber,
  green: ACCENT.greenBright,
  neutral: TEXT.faint,
};

export function DocumentsExplorer() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const { menu, open, close } = useContextMenu();

  useEffect(warmDocuments, []);

  const rows = visibleDocuments(state);

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%" }}>
      <div style={{ flex: "none", display: "flex", flexDirection: "column", gap: 6, padding: "8px 10px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 26,
            padding: "0 8px",
            background: SURFACE.well,
            border: `1px solid ${LINE.control}`,
            borderRadius: 4,
          }}
        >
          <Search size={12} color={TEXT.groupLabel} style={{ flex: "none" }} />
          <input
            value={state.search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search documents"
            aria-label="Search documents"
            spellCheck={false}
            style={{
              flex: 1,
              minWidth: 0,
              border: 0,
              outline: 0,
              background: "transparent",
              fontFamily: "inherit",
              fontSize: 11.5,
              color: TEXT.strong,
            }}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          {DOC_CATEGORY_FILTERS.map((filter) => {
            const on = state.category === filter;
            return (
              <button
                key={filter}
                type="button"
                onClick={() => setCategory(filter)}
                aria-pressed={on}
                style={{
                  flex: "none",
                  height: 22,
                  padding: "0 9px",
                  borderRadius: 4,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 10.5,
                  fontWeight: 600,
                  background: on ? WASH.chip : "transparent",
                  border: `1px solid ${on ? LINE.strong : LINE.control}`,
                  color: on ? TEXT.primary : TEXT.dim,
                }}
              >
                {filter === "All" ? "All" : CATEGORY_LABEL[filter]}
              </button>
            );
          })}
        </div>
        <span style={{ fontSize: 10.5, color: TEXT.faint }}>
          {state.loading ? "reading…" : `${rows.length} of ${state.entries.length}`}
        </span>
      </div>

      {state.error ? (
        <div style={{ flex: "none", padding: "6px 10px", fontSize: 11, color: ACCENT_TEXT.danger }}>{state.error}</div>
      ) : null}

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", paddingBottom: 8 }}>
        {rows.length === 0 ? (
          <EmptyState loading={state.loading} loaded={state.loaded} filtered={Boolean(state.search.trim()) || state.category !== "All"} />
        ) : (
          rows.map((entry) => (
            <Row key={entry.id} entry={entry} selected={state.selectedId === entry.id} onContextMenu={open} />
          ))
        )}
      </div>
      <ContextMenu menu={menu} onClose={close} />
    </div>
  );
}

function EmptyState({ loading, loaded, filtered }: { loading: boolean; loaded: boolean; filtered: boolean }) {
  const base = { padding: "24px 14px", fontSize: 11.5, lineHeight: 1.55, color: TEXT.meta } as const;
  if (!loaded || loading) return <div style={base}>Reading the history…</div>;
  if (filtered) return <div style={base}>Nothing matches that.</div>;
  return (
    <div style={base}>
      No documents have been generated yet. Every real generation from the Document Generator lands here.
    </div>
  );
}

function Row({
  entry,
  selected,
  onContextMenu,
}: {
  entry: DocumentEntry;
  selected: boolean;
  onContextMenu: ReturnType<typeof useContextMenu>["open"];
}) {
  const tone = TONE_COLOR[statusTone(entry.status)];
  const archived = entry.status === "archived";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => selectDocument(entry.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectDocument(entry.id);
        }
      }}
      onDoubleClick={() => getShellApi()?.openDoc({ kind: "document", id: entry.id, screenId: "documents" })}
      onContextMenu={(e) =>
        onContextMenu(
          e,
          [
            {
              label: "Open",
              onSelect: () => getShellApi()?.openDoc({ kind: "document", id: entry.id, screenId: "documents" }),
            },
            { label: "Copy title", onSelect: () => copyText(entry.title) },
            {
              label: archived ? "Already archived" : "Archive",
              danger: true,
              disabled: archived,
              // Same gate as the Properties panel and the contextual tab's Archive
              // item — a real window.confirm, not a bypass, since a context menu
              // item has no in-place arm-then-press-again UI of its own to reuse.
              onSelect: () => {
                if (window.confirm(`Archive "${entry.title}"? The client keeps any copy already sent.`)) {
                  void archiveSelected(entry.id);
                }
              },
            },
          ],
          `Actions for document ${entry.title}`,
        )
      }
      title={entry.title}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 3,
        padding: "7px 10px",
        cursor: "pointer",
        borderBottom: `1px solid ${LINE.subtle}`,
        borderLeft: `2px solid ${selected ? TEXT.quiet : "transparent"}`,
        background: selected ? WASH.hoverSoft : "transparent",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span aria-hidden style={{ flex: "none", width: 6, height: 6, borderRadius: "50%", background: tone }} />
        <span
          style={{
            flex: "0 1 auto",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: 12,
            fontWeight: 600,
            color: TEXT.strong,
          }}
        >
          {entry.title}
        </span>
        <div style={{ flex: 1, minWidth: 2 }} />
        <span style={{ flex: "none", whiteSpace: "nowrap", fontSize: 10, color: TEXT.faint }}>{whenLabel(entry.createdAt)}</span>
      </div>
      <div
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontSize: 11,
          color: TEXT.groupLabel,
        }}
      >
        {subjectLabel(entry)} · {entry.docTypeLabel ?? entry.docType}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {entry.status !== "delivered" && entry.status !== "approved" ? (
          <span style={{ flex: "none", fontFamily: FONT.mono, fontSize: 9.5, textTransform: "uppercase", color: tone }}>
            {STATUS_LABEL[entry.status]}
          </span>
        ) : null}
        <span style={{ flex: "none", fontFamily: FONT.mono, fontSize: 9.5, color: TEXT.faint }}>{costLabel(entry)}</span>
      </div>
    </div>
  );
}
