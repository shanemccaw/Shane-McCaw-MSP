/**
 * The Engines screen's Properties panel.
 *
 * The design's four groups, in its order: Engine · What configures it · The
 * arithmetic · Running it. Every field is read-only, and that is not an
 * omission — nothing about an engine is editable from an engine screen. Its
 * behaviour lives in signal rules or in a backing table, which is precisely
 * what the "What configures it" group exists to tell you.
 */

import { useSyncExternalStore } from "react";
import { ACCENT, FONT, LINE, TEXT } from "../../theme";
import {
  currentTestbed,
  getSnapshot,
  runEngine,
  runReplay,
  setTab,
  subscribe,
  previewEngine,
} from "./enginesStore";
import { relativeTime, traceRowsOf, type EngineDefLite } from "./engineTypes";
import { selectedEngine } from "./enginesStore";

function Group({ title, tag, tagTone, children }: { title: string; tag?: string; tagTone?: string; children: React.ReactNode }) {
  return (
    <div style={{ borderBottom: `1px solid ${LINE.subtle}`, padding: "9px 0 11px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "0 12px 6px" }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".09em", textTransform: "uppercase", color: TEXT.caption }}>{title}</span>
        {tag && (
          <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: tagTone ?? TEXT.dim }}>{tag}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function Field({ label, value, mono, tone, onSelect, title }: { label: string; value: string; mono?: boolean; tone?: string; onSelect?: () => void; title?: string }) {
  const body = (
    <>
      <span style={{ flex: "0 0 42%", minWidth: 0, fontSize: 11.5, color: TEXT.caption, overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 11.5,
          fontFamily: mono ? FONT.mono : "inherit",
          color: tone ?? TEXT.softer,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          textAlign: "right",
        }}
      >
        {value}
      </span>
    </>
  );

  if (!onSelect) {
    return (
      <div title={title ?? value} style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "4px 12px" }}>
        {body}
      </div>
    );
  }
  return (
    <button
      onClick={onSelect}
      title={title ?? value}
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 8,
        width: "100%",
        padding: "4px 12px",
        border: 0,
        background: "transparent",
        fontFamily: "inherit",
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      {body}
    </button>
  );
}

function configuredBy(engine: EngineDefLite): string {
  switch (engine.configMode) {
    case "signal-rules":
      return "signal_derivation_rules";
    case "backing-table":
      return engine.backingTable ?? "a dedicated table";
    default:
      return "nothing — it aggregates";
  }
}

export function EngineProperties() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const engine = selectedEngine();

  if (!engine) {
    return <div style={{ padding: "10px 12px", fontSize: 11.5, color: TEXT.faint }}>No engine open.</div>;
  }

  const latest = state.history[engine.key]?.latest ?? null;
  const run = state.runs[engine.key];
  const rows = traceRowsOf(run?.breakdown ?? latest?.breakdown);
  const tenant = currentTestbed();
  const editable = engine.configMode === "signal-rules";

  return (
    <div style={{ paddingBottom: 12 }}>
      <Group title="Engine" tag={editable ? "rules drive it" : "read-only here"} tagTone={editable ? ACCENT.greenSoft : ACCENT.info}>
        <Field label="Engine" value={engine.label} />
        <Field label="Key" value={engine.key} mono />
        <Field label="Scored per" value={engine.tenantScoped ? "tenant" : "the whole portfolio"} />
        <Field label="Score" value={latest ? String(latest.score) : "never recorded here"} tone={latest ? TEXT.primary : TEXT.faintest} />
        <Field
          label="Since the run before"
          value={latest ? (latest.delta === null ? "first recorded run" : latest.delta === 0 ? "no change" : `${latest.delta > 0 ? "up" : "down"} ${Math.abs(latest.delta)}`) : "—"}
        />
        <Field label="Recorded" value={latest ? relativeTime(latest.capturedAt) : "never"} />
        <Field label="Customer in scope" value={tenant?.name ?? "none picked"} tone={tenant ? undefined : ACCENT.amber} />
      </Group>

      <Group title="What configures it">
        <Field label="Reads" value={configuredBy(engine)} mono tone={ACCENT.info} />
        <Field
          label="Scope"
          value={editable ? "rules whose contribution fields it sums" : engine.configMode === "aggregator" ? "the engines below" : "the whole table"}
          title={
            editable
              ? "Not a category prefix — a rule reaches this engine when the contribution field this engine sums is non-zero on it."
              : undefined
          }
        />
        <Field label="Runs after" value={engine.dependsOn.length ? engine.dependsOn.join(", ") : "nothing — it can run first"} />
        <Field label="Open what configures it" value="Configuration" onSelect={() => setTab("config")} />
      </Group>

      {rows.length > 0 && (
        <Group title="The arithmetic">
          {rows.slice(0, 12).map((r) => (
            <Field key={r.id} label={r.name} value={r.impact === null ? "no single figure" : String(r.impact)} tone={r.impact === null ? TEXT.faintest : TEXT.softer} />
          ))}
          {rows.length > 12 && <Field label="…and more" value={`${rows.length - 12} further rows`} onSelect={() => setTab("score")} />}
        </Group>
      )}

      <Group title="Running it">
        <Field
          label="Run it for real"
          value="writes history"
          onSelect={() => {
            setTab("test");
            void runEngine(engine.key);
          }}
        />
        <Field
          label="Run and show downstream"
          value="also writes history"
          title="There is no dry run — every engine execution writes a snapshot row."
          onSelect={() => {
            setTab("test");
            void previewEngine(engine.key);
          }}
        />
        <Field
          label="Replay over time"
          value={`${state.replayFrom} · ${state.replayStep}`}
          onSelect={() => {
            setTab("test");
            void runReplay();
          }}
        />
      </Group>
    </div>
  );
}
