/**
 * Document Viewer's main canvas — the design's own `viewerColStyle` overlay
 * (`Admin Shell.dc.html`), rebuilt as a screen's body per SHELL.md's "Known
 * gaps" note that the shell does not own it and a screen must, if one needs
 * it. The prototype paginates invented per-paragraph blocks; a real generation
 * is one self-contained HTML document (`insights_generated_documents.htmlContent`),
 * so this renders it verbatim in a sandboxed iframe — the same convention
 * `SimulatorDocumentCanvas.tsx` already established for this exact content
 * shape — inside a "paper" card on the design's own dark canvas background,
 * rather than inventing a synthetic outline/page-break scheme real documents
 * have no data for.
 *
 * Selecting a row is not navigation (handoff.md principle 3) — this canvas
 * just shows whatever `documentsStore` currently has selected.
 */

import { useSyncExternalStore } from "react";
import { FileText } from "lucide-react";
import { ACCENT, ACCENT_TEXT, FONT, SURFACE, TEXT } from "../../theme";
import { getSnapshot, selectedEntry, subscribe } from "./documentsStore";
import { STATUS_LABEL, costLabel, statusTone, subjectLabel, whenLabel } from "./documentsTypes";

const TONE_COLOR: Record<string, string> = {
  danger: ACCENT.danger,
  amber: ACCENT.amber,
  green: ACCENT.greenBright,
  neutral: TEXT.dim,
};

export function DocumentsBody() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const entry = selectedEntry();

  if (!entry) {
    return (
      <div
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          background: SURFACE.root,
          color: TEXT.faint,
          fontSize: 12,
          textAlign: "center",
          padding: 24,
        }}
      >
        <FileText size={28} color={TEXT.faintest} />
        <span>Pick a document on the left and it opens here, without leaving.</span>
      </div>
    );
  }

  const tone = TONE_COLOR[statusTone(entry.status)];

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", background: SURFACE.root }}>
      <header
        style={{
          flex: "none",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "9px 16px",
          background: SURFACE.chrome,
          borderBottom: "1px solid #363636",
        }}
      >
        <FileText size={15} color={tone} style={{ flex: "none" }} />
        <span
          style={{
            flex: "0 1 auto",
            minWidth: 60,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: 12.5,
            fontWeight: 600,
            color: TEXT.primary,
          }}
        >
          {entry.title}
        </span>
        <span
          style={{
            flex: "none",
            whiteSpace: "nowrap",
            padding: "2px 8px",
            borderRadius: 9,
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: ".05em",
            textTransform: "uppercase",
            border: `1px solid ${tone}`,
            color: tone,
          }}
        >
          {STATUS_LABEL[entry.status]}
        </span>
        <div style={{ flex: 1, minWidth: 4 }} />
        <span style={{ flex: "none", whiteSpace: "nowrap", fontSize: 11, color: TEXT.meta }}>
          {subjectLabel(entry)} · {whenLabel(entry.createdAt)} · {costLabel(entry)}
        </span>
      </header>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "22px 24px 34px", display: "flex", justifyContent: "center" }}>
        <Content entry={entry} loading={state.contentLoading} contentError={state.contentError} />
      </div>
    </div>
  );
}

function Content({
  entry,
  loading,
  contentError,
}: {
  entry: ReturnType<typeof selectedEntry>;
  loading: boolean;
  contentError: string | null;
}) {
  if (!entry) return null;

  if (entry.status === "failed") {
    return (
      <div style={{ maxWidth: 640, alignSelf: "flex-start", padding: "16px 18px", fontSize: 12.5, lineHeight: 1.6, color: ACCENT_TEXT.danger }}>
        This generation failed.
        {entry.errorMessage ? (
          <div style={{ marginTop: 8, fontFamily: FONT.mono, fontSize: 11.5, color: TEXT.softer, whiteSpace: "pre-wrap" }}>
            {entry.errorMessage}
          </div>
        ) : null}
      </div>
    );
  }

  if (contentError) {
    return <div style={{ maxWidth: 640, padding: "16px 18px", fontSize: 12.5, color: ACCENT_TEXT.danger }}>{contentError}</div>;
  }

  if (entry.html === undefined) {
    return (
      <div style={{ padding: "16px 18px", fontSize: 12, color: TEXT.faint }}>{loading ? "Reading the document…" : "Nothing to show."}</div>
    );
  }

  if (entry.html === "") {
    return <div style={{ padding: "16px 18px", fontSize: 12, color: TEXT.faint }}>This document has no content.</div>;
  }

  return (
    <div
      style={{
        width: "min(880px, 100%)",
        minHeight: 400,
        flex: "none",
        background: "#ffffff",
        borderRadius: 4,
        boxShadow: "0 14px 40px rgba(0,0,0,.45)",
        overflow: "hidden",
      }}
    >
      <iframe
        srcDoc={entry.html}
        sandbox="allow-same-origin"
        title={entry.title}
        style={{ display: "block", width: "100%", height: "80vh", border: 0, background: "#ffffff" }}
      />
    </div>
  );
}
