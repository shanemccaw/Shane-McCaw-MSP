/**
 * Run History's right (Properties) panel — the selected run in detail.
 *
 * The three groups are the design's own (`Admin Shell.dc.html`'s `dp_run`,
 * `dp_eff`, `dp_act`): what it was, what it did, and what you can do about it
 * now. Two departures, both deliberate:
 *
 * - "What it was" is an editable note rather than a static field. The design
 *   already has `histNotes` writing through per run; this is where it belongs,
 *   and it is the only field on the screen that is not derived — everything
 *   else is what actually came back.
 * - Re-run is split by kind, because a manual migration's SQL is never in the
 *   browser (see `runHistoryTypes.ts`'s `migrationFile`): a deploy command is
 *   re-typed into the console, a query is loaded back into the editor, and a
 *   migration is asked for again by name.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { ACCENT_TEXT, LINE, SURFACE, TEXT, FONT } from "../../theme";
import { copyText, getSnapshot, runCount, selectedEntry, setNote, subscribe } from "./runHistoryStore";
import { durationLabel, repeatLabel, whenLabel, type RunHistoryEntry } from "./runHistoryTypes";
import { rerunEntry } from "./runHistoryActions";

export function RunHistoryProperties() {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const entry = selectedEntry();

  if (!entry) {
    return (
      <div style={{ padding: 12, fontSize: 11.5, color: TEXT.faint, lineHeight: 1.5 }}>
        Nothing selected. Click a run in the list and its output, its effect and its command land here.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: 12 }}>
      <Group label="Run" tag={entry.ok ? "" : "failed"}>
        <NoteField entry={entry} />
        <Field label="Ticket" value={entry.ticket || "none in the text"} dim={!entry.ticket} />
        <Field label="When" value={whenLabel(entry.startedAt)} />
        <Field label="Took" value={durationLabel(entry.durationMs) || "not measured"} />
        <Field label="Run before" value={repeatLabel(runCount(entry.cmd))} />
      </Group>

      <Group label="What it did">
        <Field
          label="Outcome"
          value={entry.ok ? "succeeded" : "failed"}
          accent={entry.ok ? ACCENT_TEXT.green : ACCENT_TEXT.danger}
        />
        {entry.effect.length === 0 ? (
          <Field label="Effect" value="nothing reported" dim />
        ) : (
          entry.effect.map((chip, i) => <Field key={chip} label={i === 0 ? "Effect" : " "} value={chip} />)
        )}
        <Field label={entry.migrationFile ? "File" : "Command"} value={entry.cmd} mono />
      </Group>

      <Group label="Actions">
        <ActionRow label={rerunLabel(entry)} value={rerunValue(entry)} onSelect={() => rerunEntry(entry)} />
        <ActionRow
          label="Copy output"
          value={entry.output ? "click to copy" : "it printed nothing"}
          disabled={!entry.output}
          onSelect={() => copyText(entry.output)}
        />
        <ActionRow label="Copy command" value="click to copy" onSelect={() => copyText(entry.cmd)} />
      </Group>
    </div>
  );
}

function rerunLabel(entry: RunHistoryEntry): string {
  if (entry.migrationFile) return "Run this migration again";
  return entry.kind === "sql" ? "Open in SQL Runner" : "Run again";
}

function rerunValue(entry: RunHistoryEntry): string {
  if (entry.migrationFile) return "runs against the real database";
  return entry.kind === "sql" ? "loads the query into the editor and runs it" : "runs it on the server again";
}

function Group({ label, tag, children }: { label: string; tag?: string; children: React.ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: ".09em",
            textTransform: "uppercase",
            color: TEXT.groupLabel,
          }}
        >
          {label}
        </span>
        {tag ? <span style={{ fontSize: 10.5, color: ACCENT_TEXT.danger }}>{tag}</span> : null}
      </div>
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
      <span style={{ flex: "0 0 84px", fontSize: 11, color: TEXT.label }}>{label}</span>
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

/**
 * The note writes straight through on blur rather than on every keystroke —
 * every write persists the whole log to localStorage, and doing that per
 * character is the one place "no save step" would cost something real.
 */
function NoteField({ entry }: { entry: RunHistoryEntry }) {
  const [draft, setDraft] = useState(entry.note);

  useEffect(() => {
    setDraft(entry.note);
    // Reset when the selected run changes, not on every store tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id]);

  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      <span style={{ flex: "0 0 84px", fontSize: 11, color: TEXT.label }}>What it was</span>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== entry.note) setNote(entry.id, draft);
        }}
        placeholder={entry.title}
        aria-label="What this run was"
        style={{
          flex: 1,
          minWidth: 0,
          height: 24,
          padding: "0 7px",
          borderRadius: 4,
          border: `1px solid ${LINE.control}`,
          background: SURFACE.root,
          color: TEXT.softer,
          fontFamily: "inherit",
          fontSize: 11.5,
          outline: "none",
        }}
      />
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
      <span style={{ flex: "0 0 84px", fontSize: 11, color: TEXT.label }}>{label}</span>
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
