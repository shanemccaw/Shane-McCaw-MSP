/**
 * The Properties panel and the bottom panel's two tabs.
 *
 * Properties answers "what IS this endpoint" — the saved definition, who runs
 * it, and its own severity rules. That last one is the distinction most worth
 * making on this screen, because two different things in this platform are both
 * called a rule and they run at different times against different data:
 *
 *   • `monitor_checks.severity_rules` — expressions in the condition grammar,
 *     evaluated BY THE EXECUTOR at run time. They set the run's severity band,
 *     and their `label` is the finding sentence a customer eventually reads.
 *   • `signal_derivation_rules` — the rules the centre column writes. They read
 *     the keys the mapping produced, and they feed dashboard scoring.
 *
 * The run bar shows the first ("matched high"); the "Rules against this result"
 * column shows the second. Conflating them is how a check ends up appearing to
 * have rules while contributing nothing to any score.
 */

import { useSyncExternalStore } from "react";
import { ACCENT, FONT, LINE, SURFACE, TEXT } from "../../theme";
import { getShellApi } from "../../shell/ShellContext";
import {
  getSnapshot,
  packagesForCheck,
  refreshHistory,
  selectedCheck,
  subscribe,
  type EndpointsState,
} from "./endpointsStore";
import {
  domainOf,
  pillarOf,
  relativeTime,
  requestUrlFor,
  unpackagedLabel,
  type MonitorCheck,
} from "./endpointsTypes";
import { unpackagedChecks } from "./endpointsStore";

export function EndpointProperties() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const check = selectedCheck(state);
  if (!check) {
    return (
      <div style={{ padding: "12px 14px", fontSize: 11.5, lineHeight: 1.6, color: TEXT.faint }}>
        Nothing is open. Pick an endpoint and this shows what it is, who runs it and what it already says.
      </div>
    );
  }
  return <PropertiesView state={state} check={check} />;
}

export function PropertiesView({ state, check }: { state: EndpointsState; check: MonitorCheck }) {
  const packages = packagesForCheck(check.key, state);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "12px 14px 20px", overflow: "auto", height: "100%" }}>
      <Section title="What it is">
        <Fact label="Key" value={check.key} mono />
        <Fact label="Domain" value={domainOf(check.key)} />
        <Fact label="Pillar" value={pillarOf(check.key)} />
        <Fact label="Runs" value={check.frequency} />
        <Fact label="Executor" value={check.executorType} />
        {check.description && (
          <span style={{ display: "block", marginTop: 4, fontSize: 11.5, lineHeight: 1.6, color: TEXT.groupLabel }}>
            {check.description}
          </span>
        )}
      </Section>

      {check.executorType === "graph" && (
        <Section title="The request">
          <span style={{ display: "block", fontFamily: FONT.mono, fontSize: 11, lineHeight: 1.6, color: ACCENT.info, wordBreak: "break-all" }}>
            {check.method} {requestUrlFor(check)}
          </span>
          {check.fanOutSource && (
            <span style={{ display: "block", marginTop: 6, fontSize: 11, lineHeight: 1.6, color: TEXT.faint }}>
              Fans out: it enumerates <code style={{ fontFamily: FONT.mono }}>{check.fanOutSource}</code> first and calls
              the endpoint once per item, so one run is many requests.
            </span>
          )}
        </Section>
      )}

      <Section title="Who runs it">
        {packages.length === 0 ? (
          <span style={{ fontSize: 11.5, lineHeight: 1.6, color: ACCENT.amber }}>{unpackagedLabel()}</span>
        ) : (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {packages.map((p) => (
              <span
                key={p.key}
                style={{ padding: "3px 9px", borderRadius: 999, border: `1px solid ${LINE.control}`, fontSize: 11, color: TEXT.softer }}
              >
                {p.label}
              </span>
            ))}
          </div>
        )}
        <span style={{ display: "block", marginTop: 6, fontSize: 11, color: TEXT.faint }}>
          {check.engines.length ? `feeds ${check.engines.join(", ")}` : "feeds no engine"}
        </span>
      </Section>

      <Section title="Its own severity rules">
        {check.severityRules.length === 0 ? (
          <span style={{ fontSize: 11.5, lineHeight: 1.6, color: TEXT.faint }}>
            None. A run of this check can never carry a severity band of its own.
          </span>
        ) : (
          check.severityRules.map((r, i) => (
            <div key={`${r.expression}-${i}`} style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <span style={{ flex: "1 1 140px", minWidth: 0, fontFamily: FONT.mono, fontSize: 11, color: TEXT.strong, wordBreak: "break-all" }}>
                  {r.expression}
                </span>
                <span style={{ flex: "none", fontSize: 9.5, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: ACCENT.amber }}>
                  {r.severity}
                </span>
              </div>
              {r.label && (
                <span style={{ display: "block", marginTop: 3, fontSize: 11, lineHeight: 1.55, color: TEXT.groupLabel }}>{r.label}</span>
              )}
            </div>
          ))
        )}
        <span style={{ display: "block", marginTop: 4, fontSize: 10.5, lineHeight: 1.6, color: TEXT.faintest }}>
          These run inside the executor and set the run's band. They are not the rules the centre column writes — those
          feed scoring.
        </span>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".11em", textTransform: "uppercase", color: TEXT.metaAlt }}>
        {title}
      </span>
      {children}
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      <span style={{ flex: "none", minWidth: 62, fontSize: 11, color: TEXT.caption }}>{label}</span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontFamily: mono ? FONT.mono : "inherit",
          fontSize: 11.5,
          color: TEXT.strong,
          wordBreak: "break-all",
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ── Bottom panel ──────────────────────────────────────────────────────────────

/** Past runs of the open endpoint. Persisted, so they outlive an api-server restart. */
export function RunHistoryPanel() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const check = selectedCheck(state);

  if (!check) {
    return <div style={{ padding: "10px 14px", fontSize: 11.5, color: TEXT.faint }}>Open an endpoint to see its past runs.</div>;
  }

  return (
    <div style={{ padding: "8px 14px 14px", overflow: "auto", height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 11.5, color: TEXT.faint }}>
          {state.history.length
            ? `${state.history.length} run${state.history.length === 1 ? "" : "s"} of ${check.label}`
            : (state.historyError ?? "No run of this endpoint has been recorded yet.")}
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => void refreshHistory(check.key)}
          style={{
            padding: "3px 10px",
            borderRadius: 5,
            border: `1px solid ${LINE.control}`,
            background: "transparent",
            color: TEXT.caption,
            fontFamily: "inherit",
            fontSize: 10.5,
            cursor: "pointer",
          }}
        >
          Refresh
        </button>
      </div>
      {state.history.map((run) => (
        <div
          key={run.runId}
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 10,
            flexWrap: "wrap",
            padding: "6px 0",
            borderBottom: `1px solid ${LINE.subtle}`,
          }}
        >
          <span
            style={{
              flex: "none",
              minWidth: 62,
              fontSize: 9.5,
              fontWeight: 800,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              color: run.status === "failed" ? ACCENT.danger : run.status === "completed" ? ACCENT.green : ACCENT.amber,
            }}
          >
            {run.resultStatus ?? run.status}
          </span>
          <span style={{ flex: "none", fontSize: 11.5, color: TEXT.softer }}>{relativeTime(run.startedAt)}</span>
          <span style={{ flex: "none", fontFamily: FONT.mono, fontSize: 11, color: TEXT.faint }}>
            {run.itemCount ?? run.result?.itemCount ?? 0} items
          </span>
          <span style={{ flex: "1 1 160px", minWidth: 0, fontSize: 11, color: TEXT.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {run.statusText}
          </span>
          {run.hasTrace && <span style={{ flex: "none", fontSize: 10.5, color: ACCENT.info }}>traced</span>}
        </div>
      ))}
    </div>
  );
}

/**
 * Endpoints in no package at all.
 *
 * `handoff.md` section 3 lists unpackaged endpoints among the things the Watch
 * tab exists for, and `SHELL.md` section 6 permits a count on a bottom tab
 * precisely because "a queue you must clear is a number that means you must
 * act". This is one: each row is a check that is fully configured, costs
 * nothing to run, and is executed against nobody.
 */
export function GapsPanel() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const gaps = unpackagedChecks(state);

  if (gaps.length === 0) {
    return (
      <div style={{ padding: "10px 14px", fontSize: 11.5, color: TEXT.faint }}>
        {state.checks.length === 0 ? "The catalog has not loaded." : "Every endpoint is in at least one package."}
      </div>
    );
  }

  return (
    <div style={{ padding: "8px 14px 14px", overflow: "auto", height: "100%" }}>
      <span style={{ display: "block", marginBottom: 8, fontSize: 11.5, lineHeight: 1.6, color: TEXT.faint }}>
        {gaps.length} endpoint{gaps.length === 1 ? "" : "s"} {gaps.length === 1 ? "is" : "are"} in no package. They are
        configured and they run against nobody.
      </span>
      {gaps.map((check) => (
        <div
          key={check.key}
          role="button"
          tabIndex={0}
          onClick={() => getShellApi()?.openPeek("endpoint", check.key)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              getShellApi()?.openPeek("endpoint", check.key);
            }
          }}
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 10,
            flexWrap: "wrap",
            padding: "6px 8px",
            borderRadius: 5,
            cursor: "pointer",
            background: SURFACE.card,
            marginBottom: 4,
          }}
        >
          <span style={{ flex: "none", fontSize: 12, color: TEXT.strong }}>{check.label}</span>
          <span style={{ flex: "1 1 160px", minWidth: 0, fontFamily: FONT.mono, fontSize: 10.5, color: ACCENT.info, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {check.key}
          </span>
          <span style={{ flex: "none", fontSize: 11, color: TEXT.faint }}>{check.frequency}</span>
        </div>
      ))}
    </div>
  );
}
