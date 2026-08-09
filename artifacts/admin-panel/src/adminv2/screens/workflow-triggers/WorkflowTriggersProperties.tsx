/**
 * The Properties panel. Mirrors `WorkflowProperties.tsx`'s split: nothing
 * open shows screen-wide totals; a trigger open shows its real config edits,
 * enable toggle, webhook token (with rotate), and its 30-day stats — the
 * `getTriggerStats`/`listTriggerEvents` routes `admin-workflows.ts` already
 * had but no screen had ever called.
 */

import { useSyncExternalStore } from "react";
import { ACCENT, FONT, LINE, TEXT } from "../../theme";
import {
  patchTriggerConfig,
  rotateTokenNow,
  toggleTriggerEnabled,
  erroredTriggers,
  getSnapshot,
  subscribe,
  triggerById,
  type TriggersState,
} from "./triggersStore";
import { STATUS_LABEL, whenShort, type GlobalTriggerRow } from "./triggersTypes";

export function WorkflowTriggersProperties() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const t = triggerById(state.selectedTriggerId, state);
  if (t) return <TriggerView t={t} state={state} />;
  return <Overview state={state} />;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".11em", textTransform: "uppercase", color: TEXT.metaAlt }}>{title}</span>
      {children}
    </div>
  );
}

function Fact({ label, value, mono, color }: { label: string; value: string; mono?: boolean; color?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      <span style={{ flex: "none", minWidth: 76, fontSize: 11, color: TEXT.caption }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0, fontFamily: mono ? FONT.mono : "inherit", fontSize: 11.5, color: color ?? TEXT.strong, wordBreak: "break-all" }}>{value}</span>
    </div>
  );
}

// ── Nothing open ─────────────────────────────────────────────────────────────

function Overview({ state }: { state: TriggersState }) {
  const errored = erroredTriggers(state);
  const enabled = state.triggers.filter((t) => t.enabled).length;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "12px 14px 20px", overflow: "auto", height: "100%" }}>
      <Section title="Every trigger">
        <Fact label="Total" value={String(state.triggers.length)} />
        <Fact label="Enabled" value={String(enabled)} />
        <Fact label="Disabled" value={String(state.triggers.length - enabled)} />
        <Fact label="Errored" value={String(errored.length)} color={errored.length > 0 ? ACCENT.danger : undefined} />
      </Section>

      {errored.length > 0 && (
        <Section title="Last fire failed">
          {errored.slice(0, 8).map((t) => (
            <div key={t.id} style={{ display: "flex", flexDirection: "column", gap: 2, padding: "8px 9px", borderRadius: 6, border: `1px solid ${LINE.base}`, background: "#242424" }}>
              <span style={{ fontSize: 11.5, color: TEXT.strong }}>{t.definitionName}</span>
              <span style={{ fontSize: 10.5, color: TEXT.faint, textTransform: "capitalize" }}>
                {t.type} · {whenShort(t.lastFiredAt)}
              </span>
            </div>
          ))}
        </Section>
      )}

      {state.message && <span style={{ fontSize: 11.5, color: ACCENT.greenBright }}>{state.message}</span>}
    </div>
  );
}

// ── A trigger open ───────────────────────────────────────────────────────────

function TriggerView({ t, state }: { t: GlobalTriggerRow; state: TriggersState }) {
  const eventName = typeof t.config.eventName === "string" ? t.config.eventName : "";
  const cron = typeof t.config.cron === "string" ? t.config.cron : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "12px 14px 20px", overflow: "auto", height: "100%" }}>
      <Section title="This trigger">
        <Fact label="Workflow" value={t.definitionName} />
        <Fact label="Type" value={t.type} mono />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: TEXT.caption }}>Enabled</span>
          <button
            onClick={() => void toggleTriggerEnabled(t, !t.enabled)}
            style={{ padding: "2px 9px", borderRadius: 8, border: `1px solid ${t.enabled ? ACCENT.greenBright : LINE.control}`, background: "transparent", color: t.enabled ? ACCENT.greenBright : TEXT.faint, fontFamily: "inherit", fontSize: 10.5, cursor: "pointer" }}
          >
            {t.enabled ? "on" : "off"}
          </button>
        </div>
        {t.type === "schedule" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 10.5, color: TEXT.caption }}>Cron</span>
            <input
              defaultValue={cron}
              placeholder="e.g. 0 6 1 * *"
              onBlur={(e) => {
                if (e.target.value !== cron) void patchTriggerConfig(t, { ...t.config, cron: e.target.value });
              }}
              style={{ padding: "5px 8px", borderRadius: 5, border: `1px solid ${LINE.control}`, background: "#191919", color: TEXT.primary, fontFamily: FONT.mono, fontSize: 11.5 }}
            />
            <Fact label="Next run" value={whenShort(t.nextRunAt)} />
          </div>
        )}
        {t.type === "event" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 10.5, color: TEXT.caption }}>Event name</span>
            <input
              defaultValue={eventName}
              placeholder="e.g. fulfillment.assessment"
              onBlur={(e) => {
                if (e.target.value !== eventName) void patchTriggerConfig(t, { ...t.config, eventName: e.target.value });
              }}
              style={{ padding: "5px 8px", borderRadius: 5, border: `1px solid ${LINE.control}`, background: "#191919", color: TEXT.primary, fontFamily: FONT.mono, fontSize: 11.5 }}
            />
          </div>
        )}
        {t.type === "webhook" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 10.5, color: TEXT.caption }}>Webhook URL</span>
            <span style={{ fontFamily: FONT.mono, fontSize: 10.5, color: TEXT.faint, wordBreak: "break-all" }}>…/api/webhooks/workflow/{t.webhookToken ?? "—"}</span>
            <button onClick={() => void rotateTokenNow(t)} style={{ alignSelf: "flex-start", padding: "3px 9px", borderRadius: 6, border: `1px solid ${LINE.control}`, background: "transparent", color: TEXT.dimmer, fontFamily: "inherit", fontSize: 10.5, cursor: "pointer" }}>
              Rotate token
            </button>
          </div>
        )}
      </Section>

      <Section title="Last 30 days">
        {state.loadingStats && !state.stats && <span style={{ fontSize: 11, color: TEXT.faint }}>Reading…</span>}
        {state.stats && (
          <>
            <Fact label="Fired" value={String(state.stats.total)} />
            <Fact label="Avg duration" value={state.stats.avgDurationMs != null ? `${state.stats.avgDurationMs}ms` : "—"} />
            <Fact label="Last status" value={state.stats.lastStatus ? STATUS_LABEL[state.stats.lastStatus] : "never fired"} color={state.stats.lastStatus === "error" ? ACCENT.danger : undefined} />
          </>
        )}
      </Section>

      {state.message && <span style={{ fontSize: 11.5, color: ACCENT.greenBright }}>{state.message}</span>}
    </div>
  );
}
