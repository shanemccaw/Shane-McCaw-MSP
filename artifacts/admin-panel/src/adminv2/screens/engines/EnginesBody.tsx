/**
 * Engines screen body.
 *
 * Four tabs, in the design's order: Score · Run every engine · Rules /
 * Configuration · Run and replay. Every figure comes from
 * `routes/admin-engines.ts` through `enginesStore`; nothing here computes a
 * score, and where the wire has no answer the surface says so instead of
 * filling the gap (handoff.md section 6's "cannot read" principle, applied to
 * engines rather than endpoints).
 *
 * The one place this deliberately departs from `Admin Shell.dc.html`: the
 * mockup offers a "Dry run" that "writes nothing", and a "Type a payload"
 * runner. Neither is true of the real backend — `lib/engine-registry.ts`
 * writes a snapshot on every `runForTenant`, and free-text payload testing
 * was retired platform-wide (`runEngine` in `admin-engines.ts` rejects a call
 * with no real `customerId` in as many words). Both are replaced with copy
 * that states what actually happens.
 */

import { useSyncExternalStore } from "react";
import { ACCENT, ACCENT_TEXT, FONT, LINE, PRIMARY, SURFACE, TEXT } from "../../theme";
import {
  currentTestbed,
  getEngine,
  loadConfig,
  loadHistory,
  runEngine,
  runPipeline,
  runReplay,
  previewEngine,
  armPipeline,
  cancelPipeline,
  copyRun,
  copyWorking,
  getSnapshot,
  select,
  selectedEngine,
  setReplayFrom,
  setReplayStep,
  setTab,
  setTestbed,
  subscribe,
  REPLAY_FROMS,
  REPLAY_STEPS,
  type EnginesStoreState,
  type EngineTab,
} from "./enginesStore";
import {
  historyUnderreportsScore,
  humanise,
  relativeTime,
  scoreOfOutput,
  severityTone,
  shortDate,
  statusTone,
  traceRowsOf,
  traceTotal,
  type EngineDefLite,
  type TraceRow,
} from "./engineTypes";

// ─── Shared bits ──────────────────────────────────────────────────────────────

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: TEXT.caption }}>
      {children}
    </span>
  );
}

function Pill({ label, on, onSelect }: { label: string; on: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      style={{
        flex: "none",
        whiteSpace: "nowrap",
        padding: "4px 11px",
        borderRadius: 11,
        fontFamily: "inherit",
        fontSize: 11.5,
        cursor: "pointer",
        border: `1px solid ${on ? "rgba(255,255,255,.28)" : LINE.control}`,
        background: on ? "rgba(255,255,255,.12)" : "transparent",
        color: on ? TEXT.primary : TEXT.dimmer,
      }}
    >
      {label}
    </button>
  );
}

function Badge({ text, tone }: { text: string; tone: string }) {
  return (
    <span
      style={{
        flex: "none",
        whiteSpace: "nowrap",
        padding: "2px 9px",
        borderRadius: 10,
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: ".05em",
        textTransform: "uppercase",
        background: `${tone}22`,
        border: `1px solid ${tone}55`,
        color: tone,
      }}
    >
      {text}
    </span>
  );
}

function PrimaryButton({ label, onSelect, busy }: { label: string; onSelect: () => void; busy?: boolean }) {
  return (
    <button
      onClick={onSelect}
      disabled={busy}
      style={{
        flex: "none",
        whiteSpace: "nowrap",
        padding: "5px 14px",
        borderRadius: 5,
        border: 0,
        background: busy ? LINE.control : PRIMARY,
        color: "#fff",
        fontFamily: "inherit",
        fontSize: 11.5,
        fontWeight: 600,
        cursor: busy ? "default" : "pointer",
      }}
    >
      {label}
    </button>
  );
}

function QuietButton({ label, onSelect, title, tone }: { label: string; onSelect: () => void; title?: string; tone?: string }) {
  return (
    <button
      onClick={onSelect}
      title={title}
      style={{
        flex: "none",
        whiteSpace: "nowrap",
        padding: "5px 12px",
        borderRadius: 5,
        border: `1px solid ${LINE.strong}`,
        background: "transparent",
        color: tone ?? TEXT.soft,
        fontFamily: "inherit",
        fontSize: 11.5,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function Note({ children, tone }: { children: React.ReactNode; tone?: string }) {
  return (
    <span style={{ display: "block", fontSize: 11.5, lineHeight: 1.55, color: tone ?? TEXT.faint, textWrap: "pretty" }}>
      {children}
    </span>
  );
}

/** A stated empty state. Never an empty box — SHELL.md section 6. */
function Stated({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: "18px 20px", fontSize: 12.5, lineHeight: 1.6, color: TEXT.faint, textWrap: "pretty" }}>{children}</div>;
}

/**
 * The bar chart under a score, and under a replay.
 *
 * Heights are relative to the tallest bar in the set, which is the only
 * honest scaling when the score's own range differs per engine (health is
 * 0–100, drift and priority are unbounded sums).
 */
function Bars({ points, height }: { points: Array<{ label: string; value: number }>; height: number }) {
  const max = Math.max(1, ...points.map((p) => Math.abs(p.value)));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 9, height }}>
      {points.map((p, i) => (
        <div
          key={`${p.label}-${i}`}
          style={{ flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 5, height: "100%", justifyContent: "flex-end" }}
        >
          <span style={{ flex: "none", whiteSpace: "nowrap", fontSize: 10.5, color: TEXT.caption }}>{p.value}</span>
          <div
            style={{
              width: "100%",
              borderRadius: "4px 4px 0 0",
              height: Math.max(6, Math.round((Math.abs(p.value) / max) * (height - 28))),
              background: i === points.length - 1 ? TEXT.quiet : LINE.hover,
            }}
          />
          <span style={{ flex: "none", whiteSpace: "nowrap", fontSize: 10, color: TEXT.faint }}>{p.label}</span>
        </div>
      ))}
    </div>
  );
}

/** The "Against <tenant>" scope bar the Run and Replay tabs share. */
function AgainstBar({ state, children }: { state: EnginesStoreState; children?: React.ReactNode }) {
  return (
    <div
      style={{
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: 9,
        flexWrap: "wrap",
        padding: "11px 16px",
        borderBottom: `1px solid ${LINE.quiet}`,
        background: SURFACE.inset,
      }}
    >
      <span style={{ flex: "none", fontSize: 10.5, fontWeight: 800, letterSpacing: ".09em", textTransform: "uppercase", color: TEXT.caption }}>
        Against
      </span>
      {state.testbeds.length === 0 ? (
        <span style={{ fontSize: 11.5, color: ACCENT.amber }}>
          {state.testbedsLoading ? "Looking for testbed customers…" : "No customer is flagged as a testbed, so nothing here can run."}
        </span>
      ) : (
        <select
          value={state.testbedId ?? ""}
          onChange={(e) => setTestbed(Number(e.target.value))}
          style={{
            flex: "none",
            padding: "3px 9px",
            borderRadius: 11,
            border: `1px solid ${LINE.control}`,
            background: SURFACE.well,
            color: TEXT.softer,
            fontFamily: "inherit",
            fontSize: 11.5,
            cursor: "pointer",
          }}
        >
          {state.testbeds.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}
      {children}
    </div>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────────

const TABS: Array<{ key: EngineTab; label: (engine: EngineDefLite | undefined) => string }> = [
  { key: "score", label: () => "Score" },
  { key: "all", label: () => "Run every engine" },
  { key: "config", label: (e) => (e?.configMode === "signal-rules" ? "Rules" : "Configuration") },
  { key: "test", label: () => "Run and replay" },
];

function modeLabel(engine: EngineDefLite): { text: string; tone: string } {
  switch (engine.configMode) {
    case "signal-rules":
      return { text: "rules drive it", tone: ACCENT.greenSoft };
    case "backing-table":
      return { text: "configured elsewhere", tone: ACCENT.info };
    default:
      return { text: "aggregates the others", tone: ACCENT.info };
  }
}

function Header({ state, engine }: { state: EnginesStoreState; engine: EngineDefLite }) {
  const mode = modeLabel(engine);
  return (
    <div
      style={{
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: 9,
        flexWrap: "wrap",
        padding: "10px 16px",
        borderBottom: `1px solid ${LINE.base}`,
        background: SURFACE.chrome,
      }}
    >
      <span style={{ flex: "none", fontSize: 14, fontWeight: 700, letterSpacing: "-.01em", color: TEXT.primary }}>{engine.label}</span>
      <Badge text={mode.text} tone={mode.tone} />
      <span
        style={{
          flex: "0 1 auto",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontSize: 11.5,
          color: TEXT.groupLabel,
        }}
        title={engine.description}
      >
        {engine.description}
      </span>
      <div style={{ flex: 1, minWidth: 4 }} />
      {state.message && (
        <span
          style={{
            flex: "0 1 auto",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: 11.5,
            color: ACCENT.greenSoft,
          }}
        >
          {state.message}
        </span>
      )}
      {TABS.map((t) => (
        <Pill key={t.key} label={t.label(engine)} on={state.tab === t.key} onSelect={() => setTab(t.key)} />
      ))}
    </div>
  );
}

// ─── Score tab ────────────────────────────────────────────────────────────────

function TraceList({ rows }: { rows: TraceRow[] }) {
  let lastBand = "";
  return (
    <>
      {rows.map((r) => {
        const showBand = r.band !== "" && r.band !== lastBand;
        lastBand = r.band;
        return (
          <div key={r.id}>
            {showBand && (
              <div style={{ padding: "10px 2px 2px" }}>
                <Eyebrow>{r.band}</Eyebrow>
              </div>
            )}
            <div
              style={{
                marginTop: 8,
                padding: "10px 13px",
                borderRadius: 7,
                border: `1px solid ${LINE.base}`,
                background: SURFACE.card,
                display: "flex",
                alignItems: "center",
                gap: 11,
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  flex: "none",
                  whiteSpace: "nowrap",
                  minWidth: 56,
                  textAlign: "center",
                  padding: "5px 10px",
                  borderRadius: 7,
                  fontSize: 16,
                  fontWeight: 800,
                  letterSpacing: "-.02em",
                  background: r.impact === null ? "transparent" : "rgba(255,255,255,.05)",
                  border: `1px solid ${r.impact === null ? LINE.base : LINE.strong}`,
                  color: r.impact === null ? TEXT.faintest : TEXT.body,
                }}
                title={r.impact === null ? "This breakdown row carries no single contribution figure" : undefined}
              >
                {r.impact === null ? "—" : r.impact}
              </span>
              <div style={{ flex: "1 1 210px", minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontFamily: FONT.mono, fontSize: 12, color: TEXT.strong, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.name}
                </span>
                {r.detail.length > 0 && (
                  <span style={{ fontSize: 11, color: TEXT.caption }}>
                    {r.detail.map(([k, v]) => `${k} ${v}`).join(" · ")}
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}

function ScoreTab({ state, engine }: { state: EnginesStoreState; engine: EngineDefLite }) {
  const tenant = currentTestbed();
  const history = state.history[engine.key];
  const latest = history?.latest ?? null;
  const run = state.runs[engine.key];

  if (state.testbedId == null) {
    return <Stated>Pick a customer at the top of the Run tab first — a score only means anything against a tenant.</Stated>;
  }
  if (state.historyBusy === engine.key && !history) {
    return <Stated>Reading what this engine has recorded for {tenant?.name ?? "this tenant"}…</Stated>;
  }
  if (state.historyError && !history) {
    return (
      <Stated>
        {state.historyError}{" "}
        <button onClick={() => void loadHistory(engine.key, true)} style={{ background: "transparent", border: 0, color: ACCENT.info, cursor: "pointer", font: "inherit" }}>
          Try again
        </button>
      </Stated>
    );
  }

  // The breakdown from the last run in this session, when there is one, else
  // the one stored with the most recent snapshot. Never both — they would be
  // two different arithmetics under one heading.
  const breakdown = run?.breakdown ?? latest?.breakdown;
  const rows = traceRowsOf(breakdown);
  const rowTotal = traceTotal(rows);
  const series = (history?.series ?? []).slice(-12);
  const underreports = historyUnderreportsScore(run);

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "18px 20px 26px", display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ flex: "0 1 280px", minWidth: 230, padding: "17px 19px", borderRadius: 11, border: `1px solid ${LINE.base}`, background: SURFACE.card }}>
          <Eyebrow>Score for {tenant?.name ?? "this tenant"}</Eyebrow>
          <div style={{ marginTop: 8, display: "flex", alignItems: "baseline", gap: 11, flexWrap: "wrap" }}>
            <span style={{ fontSize: 58, fontWeight: 800, letterSpacing: "-.035em", lineHeight: 1, color: latest ? TEXT.primary : TEXT.faintest }}>
              {latest ? latest.score : "—"}
            </span>
            {latest && (
              <span
                style={{
                  fontSize: 12.5,
                  padding: "3px 10px",
                  borderRadius: 11,
                  whiteSpace: "nowrap",
                  background: "rgba(255,255,255,.06)",
                  color: TEXT.softer,
                }}
              >
                {latest.delta === null ? "first recorded run" : latest.delta === 0 ? "no change" : `${latest.delta > 0 ? "up" : "down"} ${Math.abs(latest.delta)} on the run before`}
              </span>
            )}
          </div>
          <div style={{ marginTop: 8 }}>
            <Note>
              {latest
                ? `Recorded ${relativeTime(latest.capturedAt)}, from ${latest.rawSignals.length} fired signal${latest.rawSignals.length === 1 ? "" : "s"}.`
                : "This engine has never been recorded against this tenant. Run it and it will be."}
            </Note>
          </div>
          {underreports && (
            <div style={{ marginTop: 10 }}>
              <Note tone={ACCENT.amber}>
                This engine's own output is a breakdown rather than a single number, and recorded history only stores whole numbers — so its history rows
                read 0 whatever it actually found. Run and replay has the real figures.
              </Note>
            </div>
          )}
        </div>

        <div style={{ flex: "1 1 280px", minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          <Eyebrow>What it has recorded</Eyebrow>
          {series.length > 0 ? (
            <Bars points={series.map((p) => ({ label: shortDate(p.date), value: p.score }))} height={88} />
          ) : (
            <Note>Nothing recorded in the last 90 days.</Note>
          )}
        </div>
      </div>

      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          <Eyebrow>How that number was reached</Eyebrow>
          <div style={{ flex: 1, minWidth: 4 }} />
          <QuietButton label="Copy the working" onSelect={() => copyWorking(engine.key)} title="Paste it wherever you were about to write SQL" />
        </div>

        {rows.length === 0 ? (
          <div style={{ marginTop: 10 }}>
            <Note>
              {breakdown
                ? "The recorded run has an empty breakdown — no signal contributed to this score."
                : "Nothing to show yet. Run it and this fills in with the signals that moved the number."}
            </Note>
          </div>
        ) : (
          <>
            <div style={{ marginTop: 4 }}>
              <Note>
                {run
                  ? "From the run you just did — every line is a signal that fired and what it contributed."
                  : "From the most recent recorded run — every line is a signal that fired and what it contributed."}
              </Note>
            </div>
            <TraceList rows={rows} />
            <div
              style={{
                marginTop: 9,
                display: "flex",
                alignItems: "center",
                gap: 11,
                flexWrap: "wrap",
                padding: "11px 14px",
                borderRadius: 7,
                border: "1px solid rgba(255,255,255,.16)",
                background: SURFACE.wellHover,
              }}
            >
              <span style={{ flex: "1 1 200px", minWidth: 0, fontSize: 12.5, fontWeight: 600, color: TEXT.primary }}>
                {rowTotal === null ? "These rows carry no single contribution figure" : "These add up to"}
              </span>
              <span style={{ flex: "none", whiteSpace: "nowrap", fontSize: 22, fontWeight: 800, letterSpacing: "-.02em", color: TEXT.primary }}>
                {rowTotal === null ? "—" : rowTotal}
              </span>
            </div>
            {rowTotal !== null && latest && rowTotal !== latest.score && (
              <div style={{ marginTop: 9 }}>
                <Note tone={ACCENT.amber}>
                  That does not equal the recorded {latest.score}. The engine applies arithmetic beyond summing these rows — this screen shows what the
                  engine reported rather than re-deriving it, so the difference is real and worth knowing about.
                </Note>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Run every engine tab ─────────────────────────────────────────────────────

function EngineCard({ state, def }: { state: EnginesStoreState; def: EngineDefLite }) {
  const run = state.runs[def.key];
  const display = run?.display;
  const pipelineResult = state.pipeline?.engines[def.key];
  const busy = state.runBusy === def.key;
  const tone = statusTone(display?.status);
  const score = scoreOfOutput(run);

  return (
    <div
      style={{
        flex: "1 1 320px",
        minWidth: 270,
        padding: "13px 15px",
        borderRadius: 9,
        border: `1px solid ${run || pipelineResult ? LINE.hover : LINE.base}`,
        background: SURFACE.card,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
        <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <button
            onClick={() => select(def.key)}
            style={{
              textAlign: "left",
              padding: 0,
              border: 0,
              background: "transparent",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontFamily: "inherit",
              fontSize: 13,
              fontWeight: 700,
              color: TEXT.primary,
              cursor: "pointer",
            }}
            title="Open this engine"
          >
            {def.label}
          </button>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: FONT.mono, fontSize: 10.5, color: TEXT.caption }}>
            {def.backingTable ?? def.key}
          </span>
        </div>
        <button
          onClick={() => void runEngine(def.key)}
          disabled={busy}
          title="Runs for real against the selected testbed, and writes a history row"
          style={{
            flex: "none",
            whiteSpace: "nowrap",
            padding: "4px 11px",
            borderRadius: 5,
            border: `1px solid ${LINE.strong}`,
            background: "transparent",
            color: busy ? ACCENT.amber : TEXT.soft,
            fontFamily: "inherit",
            fontSize: 11,
            cursor: busy ? "default" : "pointer",
          }}
        >
          {busy ? "…" : "Run"}
        </button>
      </div>

      <div style={{ marginTop: 7 }}>
        <Note tone={TEXT.caption}>{def.description}</Note>
      </div>

      {!run && pipelineResult && (
        <div style={{ marginTop: 11, paddingTop: 11, borderTop: `1px solid ${LINE.quiet}` }}>
          <Note tone={pipelineResult.ok ? ACCENT_TEXT.green : ACCENT_TEXT.danger}>
            {pipelineResult.ok
              ? "Ran in the last pipeline. Run it on its own to see what it found."
              : "Failed in the last pipeline. Run it on its own to see the error."}
          </Note>
        </div>
      )}

      {run && (
        <div style={{ marginTop: 11, paddingTop: 11, borderTop: `1px solid ${LINE.quiet}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ flex: "none", whiteSpace: "nowrap", fontSize: 9.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: ACCENT_TEXT.green }}>
              ran against {currentTestbed()?.name ?? "the tenant"}
            </span>
            <div style={{ flex: 1, minWidth: 4 }} />
            <button
              onClick={() => copyRun(def.key)}
              title="Copy the raw output"
              style={{ flex: "none", padding: "2px 8px", borderRadius: 5, border: `1px solid ${LINE.strong}`, background: "transparent", color: TEXT.dim, fontFamily: "inherit", fontSize: 10.5, cursor: "pointer" }}
            >
              Copy
            </button>
            <button
              onClick={() => {
                select(def.key);
                setTab("score");
              }}
              title="Which signals fired, and what they contributed"
              style={{ flex: "none", padding: "2px 8px", borderRadius: 5, border: `1px solid ${LINE.strong}`, background: "transparent", color: TEXT.dim, fontFamily: "inherit", fontSize: 10.5, cursor: "pointer" }}
            >
              Trace
            </button>
          </div>

          <div style={{ marginTop: 9, padding: "11px 13px", borderRadius: 7, border: `1px solid ${LINE.base}`, background: SURFACE.root }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <span style={{ flex: "1 1 120px", minWidth: 0, fontSize: 12.5, fontWeight: 700, color: TEXT.primary, textWrap: "pretty" }}>
                {display?.title ?? def.label}
              </span>
              {display?.status && <Badge text={display.status.replace(/_/g, " ")} tone={tone} />}
            </div>
            <div style={{ marginTop: 8, display: "flex", alignItems: "baseline", gap: 8 }}>
              <Eyebrow>{score.label}</Eyebrow>
              <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: "-.02em", color: TEXT.body }}>
                {score.value ?? "—"}
              </span>
              <span style={{ fontSize: 11, color: TEXT.caption }}>
                {run.rawSignals?.length ?? 0} signal{(run.rawSignals?.length ?? 0) === 1 ? "" : "s"} fired
              </span>
            </div>
            {display && (
              <>
                <div style={{ marginTop: 8 }}>
                  <Eyebrow>Impact</Eyebrow>
                </div>
                <span style={{ display: "block", marginTop: 3, fontSize: 12, lineHeight: 1.55, color: TEXT.softer, textWrap: "pretty" }}>{display.impact}</span>
                <div style={{ marginTop: 8 }}>
                  <Eyebrow>Do this</Eyebrow>
                </div>
                <span style={{ display: "block", marginTop: 3, fontSize: 12, lineHeight: 1.55, color: TEXT.softer, textWrap: "pretty" }}>{display.recommendation}</span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RunAllTab({ state }: { state: EnginesStoreState }) {
  const tenant = currentTestbed();
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <AgainstBar state={state}>
        <span style={{ flex: "1 1 220px", minWidth: 0, fontSize: 11.5, lineHeight: 1.5, color: TEXT.faint, textWrap: "pretty" }}>
          Every run here hits the real path against a real tenant. There is no sample-payload mode, and every run writes a history row.
        </span>
        <PrimaryButton
          label={state.pipelineBusy ? "Running…" : "Run every engine"}
          onSelect={armPipeline}
          busy={state.pipelineBusy || state.testbedId == null}
        />
      </AgainstBar>

      {state.pipelineArmed && (
        <div
          style={{
            flex: "none",
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            flexWrap: "wrap",
            padding: "11px 16px",
            borderBottom: "1px solid rgba(242,202,99,.3)",
            background: "rgba(242,202,99,.08)",
          }}
        >
          <span style={{ flex: "1 1 220px", minWidth: 0, fontSize: 12, lineHeight: 1.5, color: ACCENT.amber, textWrap: "pretty" }}>
            This runs all {state.engines.length} engines against {tenant?.name ?? "the selected testbed"} for real, in dependency order — a history row per
            engine, and anything listening downstream gets told.
          </span>
          <PrimaryButton label="Yes, run it" onSelect={() => void runPipeline()} />
          <QuietButton label="Not now" onSelect={cancelPipeline} />
        </div>
      )}

      {state.pipeline && (
        <div
          style={{
            flex: "none",
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
            padding: "9px 16px",
            borderBottom: `1px solid ${LINE.quiet}`,
          }}
        >
          {Object.entries(state.pipeline.engines).map(([key, result]) => (
            <Badge
              key={key}
              text={`${getEngine(key)?.label ?? key}${result.ok ? "" : " failed"}`}
              tone={result.ok ? ACCENT.greenSoft : ACCENT.danger}
            />
          ))}
          <div style={{ flex: 1, minWidth: 4 }} />
          <span style={{ flex: "none", whiteSpace: "nowrap", fontFamily: FONT.mono, fontSize: 11.5, color: TEXT.caption }}>
            {state.pipeline.executionMs} ms
          </span>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "14px 16px 22px", display: "flex", gap: 13, flexWrap: "wrap", alignContent: "flex-start" }}>
        {state.engines.length === 0 ? (
          <Stated>{state.enginesError ?? "No engines are registered."}</Stated>
        ) : (
          state.engines.map((def) => <EngineCard key={def.key} state={state} def={def} />)
        )}
      </div>
    </div>
  );
}

// ─── Configuration tab ────────────────────────────────────────────────────────

function formatCell(value: unknown, type: string | undefined): string {
  if (value === null || value === undefined) return "—";
  if (type === "bool") return value ? "yes" : "no";
  if (type === "array") return Array.isArray(value) ? (value.length ? value.join(", ") : "none") : String(value);
  if (type === "date") return typeof value === "string" ? relativeTime(value) : String(value);
  return String(value);
}

function ConfigTab({ state, engine }: { state: EnginesStoreState; engine: EngineDefLite }) {
  const config = state.config[engine.key];

  if (state.configBusy === engine.key && !config) return <Stated>Reading what configures {engine.label}…</Stated>;
  if (state.configError && !config) {
    return (
      <Stated>
        {state.configError}{" "}
        <button onClick={() => void loadConfig(engine.key, true)} style={{ background: "transparent", border: 0, color: ACCENT.info, cursor: "pointer", font: "inherit" }}>
          Try again
        </button>
      </Stated>
    );
  }
  if (!config) return <Stated>Nothing loaded yet.</Stated>;

  const body: React.ReactNode[] = [];

  if (config.mode === "signal-rules") {
    const rules = config.rules ?? [];
    const groups = config.groups ?? [];
    body.push(
      <div key="prefix">
        <Eyebrow>Rules behind this engine</Eyebrow>
        <div style={{ marginTop: 6 }}>
          <Note>
            These are the <span style={{ fontFamily: FONT.mono, color: ACCENT.info }}>signal_derivation_rules</span> and{" "}
            <span style={{ fontFamily: FONT.mono, color: ACCENT.info }}>signal_rule_groups</span> rows whose contribution fields {engine.label} actually
            sums. A rule outside that set never reaches this engine, however it is categorised.
          </Note>
        </div>
      </div>,
    );

    if (rules.length === 0 && groups.length === 0) {
      body.push(
        <Note key="none" tone={ACCENT.amber}>
          Nothing configured contributes to this engine, so it scores every tenant the same. That is worth fixing before trusting its number.
        </Note>,
      );
    }

    if (groups.length > 0) {
      body.push(
        <div key="groups" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Eyebrow>{groups.length} rule group{groups.length === 1 ? "" : "s"}</Eyebrow>
          {groups.map((g) => (
            <div
              key={`g-${g.id}`}
              style={{ display: "flex", alignItems: "center", gap: 11, flexWrap: "wrap", padding: "10px 13px", borderRadius: 7, border: `1px solid ${LINE.base}`, background: SURFACE.card }}
            >
              <Badge text={g.logic} tone={ACCENT.info} />
              <div style={{ flex: "1 1 200px", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5, color: TEXT.strong }}>
                  {g.label ?? g.signalKey}
                </span>
                <span style={{ fontFamily: FONT.mono, fontSize: 11, color: ACCENT.info, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {g.signalKey}
                </span>
              </div>
              {g.severity && <Badge text={g.severity} tone={severityTone(g.severity)} />}
              <span style={{ flex: "none", whiteSpace: "nowrap", fontSize: 11.5, color: TEXT.caption }}>
                {g.weight === null || g.weight === undefined ? "no weight" : `weight ${g.weight}`}
              </span>
            </div>
          ))}
        </div>,
      );
    }

    if (rules.length > 0) {
      body.push(
        <div key="rules" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Eyebrow>{rules.length} rule{rules.length === 1 ? "" : "s"}</Eyebrow>
          {rules.map((r) => (
            <div
              key={`r-${r.id}`}
              style={{ display: "flex", alignItems: "center", gap: 11, flexWrap: "wrap", padding: "10px 13px", borderRadius: 7, border: `1px solid ${LINE.base}`, background: SURFACE.card }}
            >
              {r.severity ? <Badge text={r.severity} tone={severityTone(r.severity)} /> : <Badge text="no severity" tone={TEXT.dim} />}
              <div style={{ flex: "1 1 220px", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5, color: TEXT.strong }}>
                  {r.description ?? r.signalKey}
                </span>
                <span style={{ fontFamily: FONT.mono, fontSize: 11, color: TEXT.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.sourceKey} {humanise(r.ruleType)} {r.compareValue ?? ""}
                </span>
              </div>
              <span style={{ flex: "none", whiteSpace: "nowrap", fontSize: 11.5, color: TEXT.caption }}>
                {r.weight === null || r.weight === undefined ? "no weight" : `weight ${r.weight}`}
              </span>
            </div>
          ))}
        </div>,
      );
    }

    body.push(
      <Note key="editedin">
        These rows are edited where signals are edited — one editor, every engine, so a change there is the change here. Nothing on this screen writes to
        them.
      </Note>,
    );
  } else if (config.mode === "backing-table") {
    const columns = config.columns ?? [];
    const items = config.items ?? [];
    body.push(
      <div
        key="banner"
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 11,
          flexWrap: "wrap",
          padding: "13px 15px",
          borderRadius: 9,
          border: "1px solid rgba(122,167,204,.3)",
          background: "rgba(122,167,204,.08)",
        }}
      >
        <div style={{ flex: "1 1 220px", minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12.5, lineHeight: 1.55, color: "#cfe0ee", textWrap: "pretty" }}>{config.description}</span>
          <span style={{ fontFamily: FONT.mono, fontSize: 11.5, color: ACCENT.info }}>{config.backingTable}</span>
        </div>
      </div>,
    );
    body.push(
      <div key="table" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Eyebrow>
          {config.count ?? items.length} row{(config.count ?? items.length) === 1 ? "" : "s"} in {config.backingTable}
        </Eyebrow>
        {items.length === 0 ? (
          <Note tone={ACCENT.amber}>That table is empty, so this engine has nothing to work from.</Note>
        ) : (
          <div style={{ overflowX: "auto", border: `1px solid ${LINE.base}`, borderRadius: 8 }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 11.5 }}>
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      style={{ textAlign: "left", whiteSpace: "nowrap", padding: "8px 11px", borderBottom: `1px solid ${LINE.base}`, background: SURFACE.inset, color: TEXT.caption, fontWeight: 700 }}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={i} style={{ background: i % 2 ? SURFACE.card : "transparent" }}>
                    {columns.map((c) => (
                      <td key={c.key} style={{ padding: "7px 11px", borderBottom: `1px solid ${LINE.subtle}`, color: TEXT.softer, whiteSpace: "nowrap" }}>
                        {formatCell(item[c.key], c.type)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>,
    );
  } else {
    body.push(
      <div
        key="agg"
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 11,
          flexWrap: "wrap",
          padding: "13px 15px",
          borderRadius: 9,
          border: "1px solid rgba(122,167,204,.3)",
          background: "rgba(122,167,204,.08)",
        }}
      >
        <span style={{ flex: "1 1 220px", minWidth: 0, fontSize: 12.5, lineHeight: 1.55, color: "#cfe0ee", textWrap: "pretty" }}>{config.description}</span>
      </div>,
    );
    const depends = config.dependsOn ?? engine.dependsOn;
    if (depends.length > 0) {
      body.push(
        <div key="deps" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Eyebrow>Its score moves when these do</Eyebrow>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {depends.map((k) => (
              <button
                key={k}
                onClick={() => select(k)}
                style={{
                  padding: "5px 12px",
                  borderRadius: 7,
                  border: `1px solid ${LINE.strong}`,
                  background: SURFACE.card,
                  color: TEXT.softer,
                  fontFamily: "inherit",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                {getEngine(k)?.label ?? k}
              </button>
            ))}
          </div>
        </div>,
      );
    }
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "17px 19px 24px", display: "flex", flexDirection: "column", gap: 15 }}>{body}</div>
  );
}

// ─── Run and replay tab ───────────────────────────────────────────────────────

function PreviewResult({ state }: { state: EnginesStoreState }) {
  const preview = state.preview;
  if (!preview) return null;
  const vars = Object.keys(preview.workflowOutputPreview ?? {});
  const sow = preview.sowImpactPreview ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9, paddingTop: 14, borderTop: `1px solid ${LINE.quiet}` }}>
      <Eyebrow>What this run means downstream</Eyebrow>
      <Note>
        {vars.length} workflow variable{vars.length === 1 ? "" : "s"} become available to anything listening; {sow.length} of the fired signals carry a
        pricing contribution.
      </Note>
      {sow.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {sow.map((s) => (
            <div key={s.signalKey} style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              <span style={{ fontFamily: FONT.mono, fontSize: 11.5, color: ACCENT.info }}>{s.signalKey}</span>
              <span style={{ fontSize: 11.5, color: TEXT.softer }}>
                pricing impact {s.pricingImpact} · value contribution {s.pricingValueContribution}
              </span>
            </div>
          ))}
        </div>
      )}
      {preview.mspImpactPreview && <Note>{preview.mspImpactPreview.note}</Note>}
    </div>
  );
}

function TestTab({ state, engine }: { state: EnginesStoreState; engine: EngineDefLite }) {
  const busy = state.runBusy === engine.key;
  const run = state.runs[engine.key];
  const score = scoreOfOutput(run);
  const traces = state.replay?.traces ?? [];

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <AgainstBar state={state}>
        <div style={{ flex: 1, minWidth: 4 }} />
        <PrimaryButton label={busy ? "Running…" : "Run it for real"} onSelect={() => void runEngine(engine.key)} busy={busy || state.testbedId == null} />
        <QuietButton
          label="Run and show downstream"
          onSelect={() => void previewEngine(engine.key)}
          title="Same run, plus the workflow variables and pricing contributions the fired signals carry"
        />
      </AgainstBar>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "17px 19px 24px", display: "flex", flexDirection: "column", gap: 17 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          <Eyebrow>Replay it over time</Eyebrow>
          <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", padding: "11px 14px", borderRadius: 8, border: `1px solid ${LINE.base}`, background: SURFACE.card }}>
            <span style={{ flex: "none", whiteSpace: "nowrap", fontSize: 12, color: TEXT.quieter }}>From</span>
            {REPLAY_FROMS.map((f) => (
              <Pill key={f} label={f} on={state.replayFrom === f} onSelect={() => setReplayFrom(f)} />
            ))}
            <span style={{ flex: "none", whiteSpace: "nowrap", fontSize: 12, color: TEXT.quieter }}>in steps of</span>
            {REPLAY_STEPS.map((s) => (
              <Pill key={s} label={s} on={state.replayStep === s} onSelect={() => setReplayStep(s)} />
            ))}
            <div style={{ flex: 1, minWidth: 4 }} />
            <PrimaryButton
              label={state.replayBusy ? "Replaying…" : "Replay it"}
              onSelect={() => void runReplay()}
              busy={state.replayBusy || state.testbedId == null}
            />
          </div>
          <Note>
            Nothing else on the platform does this — it re-runs the engine at each back-dated step so you can see whether the scoring behaves sensibly, not
            just where it landed today. Each step is a real run and writes its own history row, which is why the step size is a choice.
          </Note>
        </div>

        {traces.length > 0 && (
          <div>
            <Eyebrow>
              What it did over {state.replayFrom.replace(" ago", "")}, in steps of {state.replayStep}
            </Eyebrow>
            <div style={{ marginTop: 11 }}>
              <Bars
                points={traces.map((t) => ({ label: shortDate(t.timestamp), value: scoreOfOutput(t.output).value ?? 0 }))}
                height={120}
              />
            </div>
            <div style={{ marginTop: 11 }}>
              <Note tone={TEXT.quieter}>
                {traces.length} step{traces.length === 1 ? "" : "s"}, each a real run at that date. A flat line means the scoring did not react to anything
                that changed in the window.
              </Note>
            </div>
          </div>
        )}

        {run && (
          <div style={{ paddingTop: 14, borderTop: `1px solid ${LINE.quiet}` }}>
            <Eyebrow>The last run</Eyebrow>
            <div style={{ marginTop: 8, display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-.02em", color: TEXT.primary }}>{score.value ?? "—"}</span>
              <span style={{ fontSize: 12, color: TEXT.caption }}>{score.label}</span>
              {run.display?.status && <Badge text={run.display.status.replace(/_/g, " ")} tone={statusTone(run.display.status)} />}
            </div>
            <div style={{ marginTop: 8 }}>
              <Note tone={TEXT.quieter}>
                {score.note ?? `${run.rawSignals?.length ?? 0} signal${(run.rawSignals?.length ?? 0) === 1 ? "" : "s"} fired against ${currentTestbed()?.name ?? "the tenant"}. A history row was written and anything listening for this engine has been told.`}
              </Note>
            </div>
            {run.display && (
              <div style={{ marginTop: 8 }}>
                <Note tone={TEXT.softer}>{run.display.impact}</Note>
              </div>
            )}
            <PreviewResult state={state} />
          </div>
        )}

        {state.runError && (
          <div style={{ paddingTop: 14, borderTop: `1px solid ${LINE.quiet}` }}>
            <Note tone={ACCENT_TEXT.danger}>{state.runError}</Note>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Body ─────────────────────────────────────────────────────────────────────

export function EnginesBody({ recordId }: { recordId?: string }) {
  const state = useSyncExternalStore(subscribe, getSnapshot);

  // A doc opened on a specific engine wins over whatever the store had — the
  // tab strip and the screen must never disagree about which record is open.
  const engine = (recordId ? getEngine(recordId) : undefined) ?? selectedEngine();

  if (!engine) {
    return (
      <div style={{ flex: 1, background: SURFACE.app }}>
        <Stated>
          {state.enginesLoading
            ? "Reading the engine registry…"
            : (state.enginesError ?? "No engines are registered on the server, so there is nothing to show.")}
        </Stated>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", background: SURFACE.app }}>
      <Header state={state} engine={engine} />
      {state.tab === "score" && <ScoreTab state={state} engine={engine} />}
      {state.tab === "all" && <RunAllTab state={state} />}
      {state.tab === "config" && <ConfigTab state={state} engine={engine} />}
      {state.tab === "test" && <TestTab state={state} engine={engine} />}
    </div>
  );
}

