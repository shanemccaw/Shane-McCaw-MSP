/**
 * Document Viewer's right (Properties) panel — the selected document's real
 * facts, plus the one mutation this screen has: Archive.
 *
 * No editable fields here on purpose — unlike Run History's note or Services'
 * inline price, there is no PATCH route for a generated document's title or
 * metadata (only `archive` exists; see `documentsApi.ts`), so this panel
 * stays read-only rather than drawing a field that would silently do nothing.
 */

import { useSyncExternalStore } from "react";
import { ACCENT_TEXT, TEXT, FONT } from "../../theme";
import { archiveSelected, copyText, getSnapshot, selectedEntry, subscribe } from "./documentsStore";
import { CATEGORY_LABEL, STATUS_LABEL, costLabel, subjectLabel, whenLabel } from "./documentsTypes";

export function DocumentsProperties() {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const entry = selectedEntry();

  if (!entry) {
    return (
      <div style={{ padding: 12, fontSize: 11.5, color: TEXT.faint, lineHeight: 1.5 }}>
        Nothing selected. Click a document on the left and its tenant, cost and status land here.
      </div>
    );
  }

  const archived = entry.status === "archived";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: 12 }}>
      <Group label="Document">
        <Field label="Title" value={entry.title} />
        <Field label="Status" value={STATUS_LABEL[entry.status]} accent={entry.status === "failed" ? ACCENT_TEXT.danger : undefined} />
        <Field label="Type" value={entry.docTypeLabel ?? entry.docType} />
        <Field label="Kind" value={CATEGORY_LABEL[entry.category]} />
        <Field label="When" value={whenLabel(entry.createdAt)} />
        <Field label="Cost" value={costLabel(entry)} dim={entry.costCents == null} />
        {entry.errorMessage ? <Field label="Error" value={entry.errorMessage} mono accent={ACCENT_TEXT.danger} /> : null}
      </Group>

      <Group label="For">
        <Field label="Tenant" value={subjectLabel(entry)} />
        <Field label="Project" value={entry.projectTitle ?? "no project"} dim={!entry.projectTitle} />
      </Group>

      <Group label="Actions">
        <ActionRow label="Copy title" value="click to copy" onSelect={() => copyText(entry.title)} />
        <ActionRow
          label={archived ? "Archived" : "Archive"}
          value={archived ? "already archived" : "removes it from the active history — the client keeps any copy already sent"}
          disabled={archived}
          onSelect={() => {
            if (window.confirm(`Archive "${entry.title}"? The client keeps any copy already sent.`)) void archiveSelected(entry.id);
          }}
        />
      </Group>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".09em", textTransform: "uppercase", color: TEXT.groupLabel }}>
        {label}
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>{children}</div>
    </section>
  );
}

function Field({
  label,
  value,
  mono,
  dim,
  accent,
}: {
  label: string;
  value: string;
  mono?: boolean;
  dim?: boolean;
  accent?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      <span style={{ flex: "0 0 68px", fontSize: 11, color: TEXT.label }}>{label}</span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: mono ? 11 : 11.5,
          fontFamily: mono ? FONT.mono : "inherit",
          color: accent ?? (dim ? TEXT.faint : TEXT.softer),
          wordBreak: mono ? "break-all" : "normal",
          whiteSpace: mono ? "pre-wrap" : "normal",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function ActionRow({
  label,
  value,
  onSelect,
  disabled,
}: {
  label: string;
  value: string;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      <span style={{ flex: "0 0 68px", fontSize: 11, color: TEXT.label }}>{label}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={onSelect}
        style={{
          flex: 1,
          minWidth: 0,
          textAlign: "left",
          background: "transparent",
          border: 0,
          padding: 0,
          fontFamily: "inherit",
          fontSize: 11.5,
          color: disabled ? TEXT.faint : ACCENT_TEXT.green,
          cursor: disabled ? "default" : "pointer",
        }}
      >
        {value}
      </button>
    </div>
  );
}

