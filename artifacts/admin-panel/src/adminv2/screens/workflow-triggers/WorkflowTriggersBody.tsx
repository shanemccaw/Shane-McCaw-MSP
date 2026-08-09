/**
 * Workflow Triggers screen body — the centre content.
 *
 * Nothing open shows a dashboard (total/errored triggers, the same numbers
 * the Watch tab is built from, plus every trigger in one table). A trigger
 * open shows its real event history (`GET .../triggers/:tid/events`) and a
 * "Test fire" action (`POST .../triggers/:tid/test-fire`) — both real routes
 * `admin-workflows.ts` already had, unused by any screen until now.
 */

import { useSyncExternalStore } from "react";
import { ACCENT, LINE, PRIMARY, SURFACE, TEXT } from "../../theme";
import { getShellApi } from "../../shell/ShellContext";
import {
  erroredTriggers,
  getSnapshot,
  refreshAll,
  subscribe,
  testFireNow,
  triggerById,
  type TriggersState,
} from "./triggersStore";
import { formatDuration, STATUS_LABEL, triggerConfigSummary, whenShort, type EventStatus, type GlobalTriggerRow, type TriggerEventRow } from "./triggersTypes";

const STATUS_TONE: Record<EventStatus, string> = {
  fired: ACCENT.greenBright,
  skipped: TEXT.faint,
  error: ACCENT.danger,
};

export function WorkflowTriggersBody() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const t = triggerById(state.selectedTriggerId, state);

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", background: SURFACE.app }}>
      <Header state={state} t={t} />
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>{t ? <Detail t={t} state={state} /> : <Overview state={state} />}</div>
      {state.message && <Toast message={state.message} />}
    </div>
  );
}

function Header({ state, t }: { state: TriggersState; t: GlobalTriggerRow | null }) {
  return (
    <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", padding: "10px 16px", borderBottom: `1px solid ${LINE.base}`, background: SURFACE.chrome }}>
      <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-.01em", color: TEXT.primary }}>{t ? `${t.definitionName} — ${t.type}` : "Workflow Triggers"}</span>
      {!t && (
        <span style={{ padding: "1px 7px", borderRadius: 9, border: `1px solid ${LINE.strong}`, fontSize: 10.5, color: TEXT.dimmer }}>
          {state.triggers.length} trigger{state.triggers.length === 1 ? "" : "s"}
        </span>
      )}
      <div style={{ flex: 1, minWidth: 4 }} />
      {t && (
        <button onClick={() => getShellApi()?.openDoc({ kind: "workflow", id: String(t.definitionId), screenId: "workflows" })} style={buttonStyle(false)}>
          Open workflow
        </button>
      )}
      {t && (
        <button onClick={() => void testFireNow(t)} disabled={state.testFiring} style={buttonStyle(true)}>
          {state.testFiring ? "Firing…" : "Test fire"}
        </button>
      )}
      <button onClick={() => void refreshAll()} style={buttonStyle(false)}>
        Refresh
      </button>
    </div>
  );
}

function buttonStyle(primary: boolean): React.CSSProperties {
  return {
    padding: "6px 12px",
    borderRadius: 5,
    border: primary ? 0 : `1px solid ${LINE.strong}`,
    background: primary ? PRIMARY : "transparent",
    color: primary ? "#fff" : TEXT.soft,
    fontFamily: "inherit",
    fontSize: 12,
    fontWeight: primary ? 600 : 400,
    cursor: "pointer",
  };
}

function Toast({ message }: { message: string }) {
  return (
    <div style={{ flex: "none", padding: "8px 16px", fontSize: 12, color: TEXT.strong, background: SURFACE.card, borderTop: `1px solid ${LINE.base}` }}>{message}</div>
  );
}

// ── Nothing open ─────────────────────────────────────────────────────────────

function Overview({ state }: { state: TriggersState }) {
  if (state.loadingTriggers && state.triggers.length === 0) {
    return <div style={{ padding: 20, fontSize: 12.5, color: TEXT.meta }}>Reading triggers…</div>;
  }

  const errored = erroredTriggers(state);

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "18px 20px 30px", display: "flex", flexDirection: "column", gap: 20 }}>
      <div
        style={{
          padding: "18px 20px",
          borderRadius: 10,
          background: errored.length > 0 ? "linear-gradient(135deg, rgba(229,122,122,.14), rgba(229,122,122,.02))" : "linear-gradient(135deg, rgba(127,180,216,.12), rgba(127,180,216,.02))",
          border: `1px solid ${errored.length > 0 ? "rgba(229,122,122,.30)" : "rgba(127,180,216,.24)"}`,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: errored.length > 0 ? ACCENT.danger : ACCENT.info }}>
          {errored.length > 0 ? "Needs attention" : "Every trigger"}
        </span>
        <span style={{ fontSize: 36, fontWeight: 800, letterSpacing: "-.03em", color: TEXT.primary }}>
          {state.triggers.length} trigger{state.triggers.length === 1 ? "" : "s"}
        </span>
        <span style={{ fontSize: 11.5, color: TEXT.meta }}>
          {errored.length > 0 ? `${errored.length} trigger${errored.length === 1 ? "" : "s"} whose last fire failed.` : "Nothing has failed on its most recent fire."}
        </span>
      </div>

      <Section title="Every trigger, across every workflow">
        {state.triggers.length === 0 && <span style={{ fontSize: 12, color: TEXT.faint }}>No triggers yet — add one from the Home tab.</span>}
        {state.triggers.map((t) => (
          <TriggerRowLine key={t.id} t={t} />
        ))}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: TEXT.caption }}>{title}</span>
      {children}
    </div>
  );
}

function TriggerRowLine({ t }: { t: GlobalTriggerRow }) {
  const tone = !t.enabled ? TEXT.faintest : t.lastStatus === "error" ? ACCENT.danger : t.lastStatus === "fired" ? ACCENT.greenBright : TEXT.faintest;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => getShellApi()?.openPeek("trigger", String(t.id))}
      style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 13px", borderRadius: 7, border: `1px solid ${LINE.base}`, background: SURFACE.card, cursor: "pointer" }}
    >
      <span style={{ flex: "none", width: 7, height: 7, borderRadius: "50%", background: tone }} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: TEXT.primary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.definitionName}</span>
      <span style={{ flex: "none", fontSize: 11, color: TEXT.faint, textTransform: "capitalize" }}>{t.type}</span>
      <span style={{ fontSize: 11, color: TEXT.faint }}>{whenShort(t.lastFiredAt)}</span>
    </div>
  );
}

// ── A trigger open ───────────────────────────────────────────────────────────

function Detail({ t, state }: { t: GlobalTriggerRow; state: TriggersState }) {
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "18px 20px 30px", display: "flex", flexDirection: "column", gap: 16 }}>
      <span style={{ fontSize: 12, color: TEXT.meta }}>{triggerConfigSummary(t)}</span>
      <Section title="Event history">
        {state.loadingEvents && state.events.length === 0 && <span style={{ fontSize: 12, color: TEXT.faint }}>Reading…</span>}
        {!state.loadingEvents && state.events.length === 0 && <span style={{ fontSize: 12, color: TEXT.faint }}>Never fired.</span>}
        {state.events.map((e) => (
          <EventRow key={e.id} e={e} />
        ))}
      </Section>
    </div>
  );
}

function EventRow({ e }: { e: TriggerEventRow }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "8px 12px", borderRadius: 7, border: `1px solid ${LINE.base}`, background: SURFACE.card }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ flex: "none", width: 6, height: 6, borderRadius: "50%", background: STATUS_TONE[e.status] }} />
        <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: TEXT.strong }}>{STATUS_LABEL[e.status]}</span>
        <span style={{ fontSize: 11, color: TEXT.faint }}>{whenShort(e.firedAt)}</span>
        <span style={{ fontSize: 11, color: TEXT.faint }}>{formatDuration(e.durationMs)}</span>
      </div>
      {e.errorMessage && <span style={{ fontSize: 11, color: ACCENT.danger, wordBreak: "break-word" }}>{e.errorMessage}</span>}
      {e.runId != null && (
        <span
          role="button"
          tabIndex={0}
          onClick={() => getShellApi()?.openPeek("workflowRun", String(e.runId))}
          style={{ alignSelf: "flex-start", fontSize: 10.5, color: TEXT.faint, textDecoration: "underline", cursor: "pointer" }}
        >
          View run #{e.runId}
        </span>
      )}
    </div>
  );
}
