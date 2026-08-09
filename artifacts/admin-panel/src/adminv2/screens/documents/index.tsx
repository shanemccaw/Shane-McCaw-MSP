/**
 * Document Viewer — screen registration.
 *
 * Reads real generated documents (`insights_generated_documents`, via the
 * already-built `admin-document-generator.ts`) and renders one without
 * leaving, filling the design's own `viewerColStyle` overlay gap SHELL.md
 * names explicitly ("Overlays the design has and this shell does not... the
 * document viewer — build it if a screen needs one"). See
 * `documentsTypes.ts`'s file doc comment for what this screen deliberately
 * does not rebuild (generation itself — the old admin panel's Document
 * Generator IDE already owns that, and the design handoff calls it "on hold").
 *
 * ## Placement
 *
 * Home tab: browse/search everything generated, real data throughout (no
 * invented counts). Watch tab: the one live count this screen publishes —
 * generations that failed, which is exactly the "you must act" signal
 * SHELL.md reserves a badge for.
 *
 * Every fixed-tab command here is `open`/`global` per the audited rule —
 * there is deliberately no `create` (see above). Archiving a specific
 * document needs that document open, so it is a `record` intent and lives on
 * the contextual tab and in the peek, never on Home or Watch.
 */

import { Archive, Copy, FileText, RefreshCw, Search, TriangleAlert } from "lucide-react";
import { ACCENT } from "../../theme";
import { registerScreen } from "../../registry/registry";
import { getShellApi } from "../../shell/ShellContext";
import type { CommandItem, ContextualTabSpec, GalleryRow, PeekModel } from "../../registry/types";
import { DocumentsBody } from "./DocumentsBody";
import { DocumentsExplorer } from "./DocumentsExplorer";
import { DocumentsProperties } from "./DocumentsProperties";
import {
  archiveSelected,
  copyText,
  entryById,
  failedCount,
  getSnapshot,
  loadDocuments,
  selectDocument,
  warmDocuments,
  WATCH_FAILED_KEY,
} from "./documentsStore";
import { CATEGORY_LABEL, STATUS_LABEL, costLabel, statusTone, subjectLabel, whenLabel } from "./documentsTypes";

const ROUTE = "/documents";

const TONE_ACCENT: Record<string, string> = {
  danger: ACCENT.danger,
  amber: ACCENT.amber,
  green: ACCENT.greenBright,
  neutral: ACCENT.info,
};

function openDocuments(): void {
  warmDocuments();
  getShellApi()?.navigate(ROUTE);
}

function showFailures(): void {
  warmDocuments();
  getShellApi()?.navigate(ROUTE);
  const failed = getSnapshot().entries.find((e) => e.status === "failed");
  if (failed) selectDocument(failed.id);
}

function openDocument(id: string): void {
  getShellApi()?.openDoc({ kind: "document", id, screenId: "documents" });
}

/** Two/three mono characters — SHELL.md section 5. */
const TILE_FOR_STATUS: Record<string, string> = {
  failed: "!",
  generating: "GEN",
  archived: "ARC",
  approved: "OK",
  delivered: "OK",
  draft: "DFT",
};

function tileFor(status: string): string {
  return TILE_FOR_STATUS[status] ?? "·";
}

/**
 * Rebuilt on every read via the `get rows()` getter below, same reasoning as
 * `screens/run-history/index.tsx`'s `recentRunRows` — a screen's `ribbon`
 * array is frozen at `registerScreen()` module-load time, so a static
 * `rows: [...]` would freeze at the empty history every reload starts with.
 */
function recentDocumentRows(): GalleryRow[] {
  warmDocuments();
  return getSnapshot()
    .entries.slice(0, 40)
    .map((entry) => ({
      id: entry.id,
      group: CATEGORY_LABEL[entry.category],
      tile: tileFor(entry.status),
      name: entry.title,
      head: entry.status === "failed" ? "failed" : entry.status === "archived" ? "archived" : "",
      // Real data, not a restatement of the name — who it's for and when.
      sub: `${subjectLabel(entry)} · ${whenLabel(entry.createdAt)}`,
      on: getSnapshot().selectedId === entry.id,
      onSelect: () => getShellApi()?.openPeek("document", entry.id),
    }));
}

function documentPeek(id: string): PeekModel | null {
  const entry = entryById(id);
  if (!entry) return null;

  const tone = TONE_ACCENT[statusTone(entry.status)];
  const archived = entry.status === "archived";

  return {
    kind: "document",
    eyebrow: "DOCUMENT",
    title: entry.title,
    sub: entry.docTypeLabel ?? entry.docType,
    icon: FileText,
    tone,
    tag: STATUS_LABEL[entry.status],
    tagTone: tone,
    facts: [
      { label: "For", value: subjectLabel(entry), prose: true },
      { label: "Project", value: entry.projectTitle ?? "no project", prose: true },
      { label: "Cost", value: costLabel(entry) },
      { label: "When", value: whenLabel(entry.createdAt), prose: true },
    ],
    body: entry.errorMessage ? { title: "Why it failed", content: entry.errorMessage } : undefined,
    open: () => openDocument(entry.id),
    openLabel: "Open it properly",
    actions: [
      { label: "Copy title", onSelect: () => copyText(entry.title) },
      {
        label: archived ? "Already archived" : "Archive",
        tone: "danger",
        confirm: !archived,
        onSelect: () => {
          if (!archived) void archiveSelected(entry.id);
        },
      },
    ],
  };
}

registerScreen({
  id: "documents",
  title: "Document Viewer",
  area: "documents",
  icon: FileText,
  route: ROUTE,

  render: (ctx) => {
    // Mirrors `screens/services/index.tsx`'s adoption of `ctx.recordId` —
    // opening a document from a peek, the palette or a gallery row routes
    // here with the document id as `recordId`, and the store is what lets
    // `DocumentsBody`/`DocumentsProperties` (no ctx of their own) know which
    // record is open. This screen owns exactly one record kind, so `ctx.kind`
    // needs no check here.
    selectDocument(ctx.recordId ?? null);
    return <DocumentsBody />;
  },

  ribbon: [
    {
      tab: "home",
      order: 70,
      group: {
        label: "Documents",
        large: [
          {
            label: "All documents",
            icon: FileText,
            intent: "open",
            onSelect: openDocuments,
            title: "Every real document the platform has generated",
          },
        ],
        small: [
          {
            label: "Search documents",
            icon: Search,
            intent: "open",
            onSelect: () => {},
            gallery: {
              id: "documents",
              title: "Documents",
              searchable: true,
              searchPlaceholder: "Search by title, tenant or type",
              get rows() {
                return recentDocumentRows();
              },
              footer: { label: "Open the full list", onSelect: openDocuments },
            },
          },
          { label: "Refresh", icon: RefreshCw, intent: "global", onSelect: () => void loadDocuments(), title: "Re-read the generation history" },
        ],
      },
    },
    {
      tab: "watch",
      order: 45,
      group: {
        label: "Documents",
        large: [
          {
            label: "Generations that failed",
            icon: TriangleAlert,
            intent: "open",
            liveKey: WATCH_FAILED_KEY,
            onSelect: showFailures,
            title: "AI generations that came back failed, among the most recently generated documents",
          },
        ],
      },
    },
  ],

  contextualTab: (ctx): ContextualTabSpec | null => {
    if (ctx.kind !== "document" || !ctx.recordId) return null;
    const entry = entryById(ctx.recordId);
    if (!entry) return null;
    const archived = entry.status === "archived";

    return {
      id: "document-tools",
      label: "Document Tools",
      groups: [
        {
          label: "This document",
          small: [
            { label: "Copy title", icon: Copy, intent: "record", onSelect: () => copyText(entry.title) },
            {
              label: archived ? "Archived" : "Archive",
              icon: Archive,
              intent: "record",
              color: ACCENT.danger,
              disabled: archived,
              onSelect: () => {
                if (window.confirm(`Archive "${entry.title}"? The client keeps any copy already sent.`)) void archiveSelected(entry.id);
              },
            },
          ],
        },
      ],
    };
  },

  peeks: { document: documentPeek },

  commands: (): CommandItem[] => {
    warmDocuments();
    const state = getSnapshot();

    const records: CommandItem[] = state.entries.slice(0, 60).map((entry) => ({
      id: `rec:document-${entry.id}`,
      type: "record",
      kind: "document",
      name: entry.title,
      sub: `${subjectLabel(entry)} · ${entry.docTypeLabel ?? entry.docType}`,
      tag: entry.status === "failed" ? "failed" : undefined,
      area: "documents",
      run: () => getShellApi()?.openPeek("document", entry.id),
    }));

    const items: CommandItem[] = [
      {
        id: "act:documents-search",
        type: "action",
        kind: "run",
        name: "Search documents",
        sub: "Every real generation, with its tenant and cost",
        area: "documents",
        run: openDocuments,
      },
    ];

    const failed = failedCount(state);
    if (failed > 0) {
      items.push({
        id: "ans:documents-failed",
        type: "answer",
        name: "Generations that failed",
        sub: "Among the most recently generated documents",
        area: "documents",
        live: String(failed),
        run: showFailures,
      });
    }

    return [...records, ...items];
  },

  left: { title: "Documents", render: () => <DocumentsExplorer /> },
  right: { title: "Properties", render: () => <DocumentsProperties /> },
});
