/**
 * A lead opened as a full doc tab ("Open it properly" from the peek, or the
 * contextual tab's Back trail). Same real fields the peek shows, plus a
 * notes composer — Zoho supports notes on Leads (`supportsNotes` in the old
 * panel's `ZohoLeads.tsx`), and a ribbon button has nowhere to put a textarea.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { ACCENT_TEXT, LINE, PRIMARY_OVERLAY, SURFACE, TEXT } from "../../theme";
import { addLeadNote, convertLead, getSnapshot, patchLead, refreshLead, subscribe } from "./crmStore";
import { formatShortDate, leadCompany, leadDisplayName, zohoOwnerName } from "./zohoTypes";

const fieldStyle = {
  width: "100%",
  height: 30,
  marginTop: 4,
  padding: "0 9px",
  borderRadius: 5,
  border: `1px solid ${LINE.control}`,
  background: SURFACE.root,
  color: TEXT.strong,
  fontFamily: "inherit",
  fontSize: 12.5,
  outline: "none",
} as const;

export function LeadRecordBody({ id }: { id: string }) {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const record = state.leads.find((l) => String(l.id) === id);

  useEffect(() => {
    void refreshLead(id);
    // Refresh once when a different lead doc opens, not on every store tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!record) {
    return (
      <div style={{ flex: 1, padding: 24, fontSize: 12.5, color: TEXT.faint }}>
        Loading this lead from Zoho…
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "auto", background: SURFACE.app, padding: 24 }}>
      <div style={{ maxWidth: 620, display: "flex", flexDirection: "column", gap: 18 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: ACCENT_TEXT.green }}>
            Zoho lead
          </div>
          <div style={{ fontSize: 21, fontWeight: 700, color: TEXT.bright, marginTop: 4 }}>{leadCompany(record)}</div>
          <div style={{ fontSize: 12.5, color: TEXT.meta, marginTop: 2 }}>
            {leadDisplayName(record)} · {String(record.Email ?? "no email")}
          </div>
        </div>

        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <Fact label="Status" value={String(record.Lead_Status ?? "—")} />
          <Fact label="Source" value={String(record.Lead_Source ?? "—")} />
          <Fact label="Owner" value={zohoOwnerName(record)} />
          <Fact label="Created" value={formatShortDate(record.Created_Time)} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <SectionLabel>Edit it here</SectionLabel>
          <EditRow label="Company" value={String(record.Company ?? "")} onSave={(v) => void patchLead(id, { Company: v })} />
          <EditRow label="Email" value={String(record.Email ?? "")} mono onSave={(v) => void patchLead(id, { Email: v })} />
          <EditRow label="Phone" value={String(record.Phone ?? "")} onSave={(v) => void patchLead(id, { Phone: v })} />
          <EditRow label="Status" value={String(record.Lead_Status ?? "")} onSave={(v) => void patchLead(id, { Lead_Status: v })} />
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={() => void convertLead(id)} style={primaryButtonStyle}>
            Convert to deal
          </button>
          <button onClick={() => void refreshLead(id)} style={secondaryButtonStyle}>
            Refresh from Zoho
          </button>
        </div>

        {state.noteByLeadId[id] && <div style={{ fontSize: 12, color: ACCENT_TEXT.green }}>{state.noteByLeadId[id]}</div>}

        <NotesComposer id={id} />
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 90 }}>
      <span style={{ fontSize: 14, fontWeight: 700, color: TEXT.primary }}>{value}</span>
      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: TEXT.metaAlt }}>
        {label}
      </span>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: TEXT.metaAlt, borderBottom: `1px solid ${LINE.quiet}`, paddingBottom: 6 }}>
      {children}
    </div>
  );
}

function EditRow({ label, value, mono, onSave }: { label: string; value: string; mono?: boolean; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ flex: "0 0 90px", fontSize: 11.5, color: TEXT.groupLabel }}>{label}</span>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== value) onSave(draft);
        }}
        style={{ ...fieldStyle, flex: 1, marginTop: 0, fontFamily: mono ? "Menlo, Consolas, monospace" : "inherit" }}
      />
    </div>
  );
}

function NotesComposer({ id }: { id: string }) {
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!content.trim()) return;
    setSubmitting(true);
    await addLeadNote(id, content.trim());
    setSubmitting(false);
    setContent("");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <SectionLabel>Add a note</SectionLabel>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Queued — lands on the lead in Zoho on the next sync."
        style={{ ...fieldStyle, height: 74, padding: 9, lineHeight: 1.5, marginTop: 0 }}
      />
      <button disabled={!content.trim() || submitting} onClick={() => void submit()} style={{ ...secondaryButtonStyle, alignSelf: "flex-start", opacity: content.trim() ? 1 : 0.5 }}>
        Queue note
      </button>
    </div>
  );
}

const primaryButtonStyle = {
  padding: "8px 16px",
  borderRadius: 6,
  border: 0,
  background: PRIMARY_OVERLAY,
  color: "#fff",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
} as const;

const secondaryButtonStyle = {
  padding: "8px 16px",
  borderRadius: 6,
  border: `1px solid ${LINE.control}`,
  background: "transparent",
  color: TEXT.strong,
  fontSize: 12.5,
  cursor: "pointer",
} as const;
