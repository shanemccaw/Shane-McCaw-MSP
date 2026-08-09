/**
 * Observability screen body — the four views the design gives this area:
 * Alert rules · Exceptions · Incidents · Dead letters.
 *
 * Layout is the design's own (`Admin Shell.dc.html`, `obsVals`): a header
 * carrying the title, what the view is for, and the four chips; then a fixed
 * left list against a detail pane, except Incidents which is a single column
 * because an incident is prose, not a record with a body.
 *
 * Everything rendered here is a real row. Where the design invented an action
 * the platform cannot actually perform — reopening a resolved alert, retrying a
 * job nothing knows how to re-run — the control is absent and the reason is
 * stated, rather than present and broken. That is `handoff.md` section 8's
 * "everything states its cost and reversibility", applied to the gaps as well
 * as to the actions.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { ACCENT, ACCENT_TEXT, FONT, LINE, PRIMARY, SURFACE, TEXT } from "../../theme";
import {
  codeFrameLines,
  dayLabel,
  exceptionStatusTone,
  exceptionWhere,
  incidentStatusTone,
  severityTone,
  whenLabel,
} from "./observabilityFormat";
import {
  copyPayload,
  getSnapshot,
  health,
  loadDlq,
  loadExceptions,
  loadIncidents,
  loadRules,
  markDlqItem,
  openIncidentFrom,
  openView,
  resolveEvent,
  resolveExceptionGroup,
  retryAllDlq,
  retryDlqItem,
  selectDlq,
  selectException,
  selectIncident,
  selectRule,
  sendTestFiring,
  subscribe,
  suppressExceptionGroup,
  toggleRule,
  unsuppressExceptionGroup,
  OBS_VIEWS,
  type ObservabilityState,
  type ObsView,
} from "./observabilityStore";

// ── Small shared pieces ──────────────────────────────────────────────────────

/** The design's `pill()` — a tinted uppercase capsule. */
function Pill({ text, tone }: { text: string; tone: string }) {
  return (
    <span
      style={{
        flex: "none",
        whiteSpace: "nowrap",
        padding: "2px 9px",
        borderRadius: 10,
        fontSize: 10.5,
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

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 800,
        letterSpacing: ".09em",
        textTransform: "uppercase",
        color: TEXT.caption,
      }}
    >
      {children}
    </span>
  );
}

function QuietButton({
  label,
  onSelect,
  tone,
  disabled,
  title,
}: {
  label: string;
  onSelect: () => void;
  tone?: "primary" | "danger";
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onSelect}
      disabled={disabled}
      title={title}
      style={{
        flex: "none",
        whiteSpace: "nowrap",
        padding: "5px 12px",
        borderRadius: 5,
        border: tone === "primary" ? "0" : `1px solid ${tone === "danger" ? "rgba(229,122,122,.4)" : LINE.strong}`,
        background: tone === "primary" ? PRIMARY : "transparent",
        color: tone === "primary" ? "#fff" : tone === "danger" ? ACCENT_TEXT.danger : TEXT.soft,
        fontFamily: "inherit",
        fontSize: 11.5,
        fontWeight: tone === "primary" ? 600 : 400,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {label}
    </button>
  );
}

/** A left-hand list row: the 2px selection bar is the design's, on every list. */
function ListRow({
  on,
  dim,
  onSelect,
  children,
}: {
  on: boolean;
  dim?: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      onClick={onSelect}
      style={{
        padding: "9px 13px",
        cursor: "pointer",
        borderLeft: `2px solid ${on ? TEXT.quiet : "transparent"}`,
        background: on ? "rgba(255,255,255,.07)" : "transparent",
        opacity: dim ? 0.6 : 1,
      }}
    >
      {children}
    </div>
  );
}

function LeftList({ title, width, children }: { title: string; width: number; children: React.ReactNode }) {
  return (
    <div
      style={{
        flex: `0 0 ${width}px`,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        borderRight: `1px solid ${LINE.base}`,
      }}
    >
      <div style={{ flex: "none", padding: "9px 14px", borderBottom: `1px solid ${LINE.quiet}` }}>
        <Caption>{title}</Caption>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "6px 0 12px" }}>{children}</div>
    </div>
  );
}

function Detail({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        overflow: "auto",
        padding: "14px 16px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 13,
      }}
    >
      {children}
    </div>
  );
}

function Placeholder({ text }: { text: string }) {
  return <div style={{ padding: "16px 18px", fontSize: 12.5, color: TEXT.faint }}>{text}</div>;
}

function LoadState({ loading, error, onRetry }: { loading: boolean; error: string | null; onRetry: () => void }) {
  if (error)
    return (
      <div style={{ padding: "16px 18px", fontSize: 12.5, color: ACCENT_TEXT.danger }}>
        {error}
        <button
          onClick={onRetry}
          style={{ marginLeft: 8, background: "transparent", border: "none", color: ACCENT.info, cursor: "pointer", font: "inherit" }}
        >
          Try again
        </button>
      </div>
    );
  if (loading) return <Placeholder text="Reading the real rows…" />;
  return null;
}

// ── Header ───────────────────────────────────────────────────────────────────

function headerCopy(state: ObservabilityState): { title: string; sub: string } {
  const h = health(state);
  switch (state.view) {
    case "rules":
      return {
        title: "Alert rules",
        sub: `${state.rules.length} conditions, seeded on startup — tune them and watch what they fire`,
      };
    case "exceptions":
      return {
        title: "Exceptions",
        sub: `${h.openExceptions.length} open, fingerprinted so a recurring error stays one row`,
      };
    case "incidents":
      return { title: "Incidents", sub: "Hand-written, and shown on the public status page" };
    default:
      return {
        title: "Dead-letter queue",
        sub: `${state.dlqTotal} failed jobs waiting for a decision`,
      };
  }
}

function Header({ state }: { state: ObservabilityState }) {
  const { title, sub } = headerCopy(state);
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
      <span style={{ flex: "none", fontSize: 14, fontWeight: 700, letterSpacing: "-.01em", color: TEXT.primary }}>
        {title}
      </span>
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
      >
        {sub}
      </span>
      {state.said && (
        <span style={{ flex: "none", fontSize: 11.5, color: ACCENT_TEXT.green }}>{state.said}</span>
      )}
      {state.actionError && (
        <span style={{ flex: "0 1 auto", minWidth: 0, fontSize: 11.5, color: ACCENT_TEXT.danger }}>
          {state.actionError}
        </span>
      )}
      <div style={{ flex: 1, minWidth: 4 }} />
      {OBS_VIEWS.map((v) => (
        <button
          key={v.key}
          onClick={() => openView(v.key)}
          style={{
            flex: "none",
            whiteSpace: "nowrap",
            padding: "4px 11px",
            borderRadius: 11,
            fontFamily: "inherit",
            fontSize: 11.5,
            cursor: "pointer",
            border: `1px solid ${state.view === v.key ? "rgba(255,255,255,.28)" : LINE.control}`,
            background: state.view === v.key ? "rgba(255,255,255,.12)" : "transparent",
            color: state.view === v.key ? TEXT.primary : TEXT.dimmer,
          }}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}

// ── Rules ────────────────────────────────────────────────────────────────────

function RulesView({ state }: { state: ObservabilityState }) {
  const selected = state.rules.find((r) => r.id === state.selectedRuleId) ?? null;
  const events = selected ? state.events.filter((e) => e.ruleId === selected.id) : [];

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "stretch" }}>
      <LeftList title="Rules" width={340}>
        <LoadState loading={state.rulesLoading} error={state.rulesError} onRetry={() => void loadRules()} />
        {!state.rulesLoading && !state.rulesError && state.rules.length === 0 && (
          <Placeholder text="No alert rules exist yet. Nothing is watching, so nothing will tell you." />
        )}
        {state.rules.map((rule) => {
          const ruleEvents = state.events.filter((e) => e.ruleId === rule.id);
          const live = ruleEvents.filter((e) => !e.resolvedAt).length;
          return (
            <ListRow key={rule.id} on={rule.id === state.selectedRuleId} dim={!rule.enabled} onSelect={() => selectRule(rule.id)}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    flex: "none",
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: rule.enabled ? severityTone(rule.severity) : LINE.hover,
                  }}
                />
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: TEXT.strong,
                  }}
                >
                  {rule.label}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleRule(rule.id);
                  }}
                  title={rule.enabled ? "Stop this rule firing" : "Let this rule fire again"}
                  style={{
                    flex: "none",
                    whiteSpace: "nowrap",
                    padding: "2px 9px",
                    borderRadius: 10,
                    fontFamily: "inherit",
                    fontSize: 10.5,
                    fontWeight: 700,
                    cursor: "pointer",
                    border: `1px solid ${rule.enabled ? "rgba(108,203,150,.45)" : LINE.control}`,
                    background: rule.enabled ? "rgba(108,203,150,.16)" : "transparent",
                    color: rule.enabled ? ACCENT.greenSoft : TEXT.groupLabel,
                  }}
                >
                  {rule.enabled ? "on" : "off"}
                </button>
              </div>
              <span style={{ display: "block", marginTop: 3, fontSize: 11.5, color: TEXT.groupLabel }}>
                {`above ${rule.threshold} in ${rule.windowMinutes} min · cooldown ${rule.cooldownMinutes} min`}
              </span>
              <span
                style={{
                  display: "block",
                  marginTop: 4,
                  fontSize: 11,
                  color: live ? ACCENT.danger : TEXT.faint,
                }}
              >
                {live
                  ? "firing now"
                  : ruleEvents.length
                    ? `last fired ${whenLabel(ruleEvents[0]!.firedAt)}`
                    : "never fired"}
              </span>
            </ListRow>
          );
        })}
      </LeftList>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div
          style={{
            flex: "none",
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "9px 14px",
            borderBottom: `1px solid ${LINE.quiet}`,
          }}
        >
          <Caption>What it fired</Caption>
          <div style={{ flex: 1, minWidth: 4 }} />
          <QuietButton
            label="Send a test firing"
            disabled={!selected}
            title="Writes a real alert event and actually attempts email and push"
            onSelect={() => selected && void sendTestFiring(selected.id)}
          />
        </div>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            padding: "10px 14px 18px",
            display: "flex",
            flexDirection: "column",
            gap: 9,
          }}
        >
          {!selected && <Placeholder text="Pick a rule to see what it has fired." />}
          {selected && events.length === 0 && (
            <div style={{ padding: "12px 2px", fontSize: 12, color: TEXT.faint }}>
              This rule has not fired in the window shown.
            </div>
          )}
          {events.map((event) => {
            const done = Boolean(event.resolvedAt);
            return (
              <div
                key={event.id}
                style={{
                  padding: "11px 13px",
                  borderRadius: 8,
                  border: `1px solid ${done ? LINE.base : "rgba(229,122,122,.35)"}`,
                  background: SURFACE.card,
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
                  <Pill text={event.severity} tone={severityTone(event.severity)} />
                  <span style={{ flex: "1 1 200px", minWidth: 0, fontSize: 12.5, color: TEXT.strong }}>
                    {event.summary}
                  </span>
                  <span style={{ flex: "none", whiteSpace: "nowrap", fontSize: 11.5, color: TEXT.meta }}>
                    {whenLabel(event.firedAt)}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginTop: 7 }}>
                  <Pill text={done ? "resolved" : "open"} tone={done ? ACCENT.greenBright : ACCENT.danger} />
                  <span style={{ flex: "none", whiteSpace: "nowrap", fontSize: 11, color: TEXT.meta }}>
                    {`${event.deliveredEmail ? "emailed" : "no email"}${event.deliveredPush ? " · pushed" : ""}`}
                  </span>
                  <div style={{ flex: 1, minWidth: 4 }} />
                  {done ? (
                    <span style={{ flex: "none", fontSize: 11, color: TEXT.faint }}>
                      {`resolved ${whenLabel(event.resolvedAt)}`}
                    </span>
                  ) : (
                    <QuietButton label="Resolve" tone="primary" onSelect={() => void resolveEvent(event.id)} />
                  )}
                  <QuietButton
                    label="Open an incident"
                    onSelect={() => void openIncidentFrom("an alert", event.summary, normaliseSeverity(event.severity))}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** `msp_alert_events.severity` is free text; `platform_incidents.severity` is an enum. */
function normaliseSeverity(value: string): "minor" | "major" | "critical" {
  return value === "critical" || value === "major" || value === "minor" ? value : "major";
}

// ── Exceptions ───────────────────────────────────────────────────────────────

function ExceptionsView({ state }: { state: ObservabilityState }) {
  const selected = state.exceptions.find((g) => g.fingerprint === state.selectedFingerprint) ?? null;
  const [suppressing, setSuppressing] = useState(false);
  const [reason, setReason] = useState("");

  // Arming is per-record, exactly like the peek's `confirm` action: moving to a
  // different group must not leave a half-armed Suppress pointing at it.
  useEffect(() => {
    setSuppressing(false);
    setReason("");
  }, [state.selectedFingerprint]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "stretch" }}>
      <LeftList title="Groups" width={320}>
        <LoadState loading={state.exceptionsLoading} error={state.exceptionsError} onRetry={() => void loadExceptions()} />
        {!state.exceptionsLoading && !state.exceptionsError && state.exceptions.length === 0 && (
          <Placeholder text="Nothing has thrown. This is the good state." />
        )}
        {state.exceptions.map((group) => (
          <ListRow
            key={group.fingerprint}
            on={group.fingerprint === state.selectedFingerprint}
            dim={group.status === "suppressed"}
            onSelect={() => selectException(group.fingerprint)}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontFamily: FONT.mono,
                  fontSize: 12,
                  color: TEXT.strong,
                }}
              >
                {group.errorName}
              </span>
              <span
                style={{
                  flex: "none",
                  whiteSpace: "nowrap",
                  fontSize: 11,
                  fontWeight: 700,
                  color: group.status === "open" ? ACCENT.amberDim : TEXT.faint,
                }}
              >
                {group.occurrenceCount}
              </span>
            </div>
            <span
              style={{
                display: "block",
                marginTop: 3,
                fontSize: 11.5,
                color: TEXT.groupLabel,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {group.errorMessage}
            </span>
            <span style={{ display: "block", marginTop: 3, fontSize: 11, color: TEXT.faint }}>
              {exceptionWhere(group)}
            </span>
          </ListRow>
        ))}
      </LeftList>

      {!selected ? (
        <Detail>
          <Placeholder text="Pick a group to see where it threw and who it hit." />
        </Detail>
      ) : (
        <Detail>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontFamily: FONT.mono, fontSize: 14, fontWeight: 700, color: TEXT.primary }}>
              {selected.errorName}
            </span>
            <span style={{ fontSize: 12.5, color: TEXT.soft }}>{selected.errorMessage}</span>
            <span style={{ fontFamily: FONT.mono, fontSize: 11.5, color: TEXT.groupLabel }}>
              {selected.file
                ? `${selected.file}${selected.line ? `:${selected.line}` : ""}${selected.functionName ? ` in ${selected.functionName}` : ""}`
                : "no file recorded"}
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
            <Pill text={selected.status} tone={exceptionStatusTone(selected.status)} />
            <span style={{ flex: "none", whiteSpace: "nowrap", fontSize: 11.5, color: TEXT.groupLabel }}>
              {`${selected.occurrenceCount} occurrences · first ${dayLabel(selected.firstSeenAt)} · last ${whenLabel(selected.lastSeenAt)}`}
            </span>
            <div style={{ flex: 1, minWidth: 4 }} />
            {selected.status !== "resolved" && (
              <QuietButton
                label="Resolve"
                tone="primary"
                title="It reopens by itself the next time it throws"
                onSelect={() => void resolveExceptionGroup(selected.fingerprint)}
              />
            )}
            {selected.status === "suppressed" ? (
              <QuietButton label="Unsuppress" onSelect={() => void unsuppressExceptionGroup(selected.fingerprint)} />
            ) : (
              <QuietButton label="Suppress" onSelect={() => setSuppressing(true)} />
            )}
            <QuietButton
              label="Open an incident"
              onSelect={() =>
                void openIncidentFrom("an exception group", `${selected.errorName}: ${selected.errorMessage}`)
              }
            />
          </div>

          {suppressing && (
            // Suppression demands a reason (the route 400s without one) and a
            // suppressed group stops asking for you — so the why is collected
            // here, in place, rather than in a dialog that takes you away.
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
                padding: "10px 12px",
                borderRadius: 7,
                border: `1px solid ${LINE.base}`,
                background: SURFACE.card,
              }}
            >
              <span style={{ fontSize: 11.5, color: TEXT.soft }}>Why is this one not worth seeing?</span>
              <input
                value={reason}
                autoFocus
                onChange={(e) => setReason(e.target.value)}
                placeholder="It is a known third-party throttle"
                style={{
                  flex: "1 1 220px",
                  minWidth: 0,
                  padding: "5px 9px",
                  borderRadius: 5,
                  border: `1px solid ${LINE.control}`,
                  background: SURFACE.well,
                  color: TEXT.body,
                  fontFamily: "inherit",
                  fontSize: 12,
                }}
              />
              <QuietButton
                label="Suppress it"
                tone="primary"
                disabled={!reason.trim()}
                onSelect={() => {
                  void suppressExceptionGroup(selected.fingerprint, reason.trim());
                  setSuppressing(false);
                  setReason("");
                }}
              />
              <QuietButton label="Never mind" onSelect={() => setSuppressing(false)} />
            </div>
          )}

          {selected.suppressionReason && selected.status === "suppressed" && (
            <span style={{ fontSize: 11.5, color: TEXT.faint }}>
              {`Suppressed because: ${selected.suppressionReason}`}
            </span>
          )}

          {codeFrameLines(selected.codeFrame).length > 0 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                borderRadius: 7,
                border: `1px solid ${LINE.base}`,
                overflow: "hidden",
                background: SURFACE.chrome,
              }}
            >
              {codeFrameLines(selected.codeFrame).map((line, i) => (
                <div
                  key={i}
                  style={{
                    padding: "5px 12px",
                    fontFamily: FONT.mono,
                    fontSize: 11.5,
                    whiteSpace: "pre",
                    overflowX: "auto",
                    color: line.hit ? ACCENT_TEXT.danger : TEXT.groupLabel,
                    background: line.hit ? "rgba(229,122,122,.10)" : "transparent",
                  }}
                >
                  {line.text}
                </div>
              ))}
            </div>
          )}

          {selected.stackSample && (
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <Caption>Stack</Caption>
              {selected.stackSample.split("\n").map((line, i) => (
                <span key={i} style={{ fontFamily: FONT.mono, fontSize: 11.5, color: TEXT.dim, wordBreak: "break-all" }}>
                  {line}
                </span>
              ))}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Caption>Occurrences</Caption>
            {state.occurrencesLoading && <span style={{ fontSize: 11.5, color: TEXT.faint }}>Loading…</span>}
            {!state.occurrencesLoading && state.occurrences.length === 0 && (
              <span style={{ fontSize: 11.5, color: TEXT.faint }}>
                The group is here but no individual occurrences were kept.
              </span>
            )}
            {state.occurrences.map((occ) => (
              <div
                key={occ.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                  padding: "8px 12px",
                  borderRadius: 6,
                  border: `1px solid ${LINE.base}`,
                  background: SURFACE.card,
                }}
              >
                <span style={{ flex: "none", whiteSpace: "nowrap", fontFamily: FONT.mono, fontSize: 11, color: ACCENT.info }}>
                  {occ.correlationId ?? "no correlation id"}
                </span>
                <span
                  style={{
                    flex: "1 1 140px",
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontSize: 12,
                    color: TEXT.softer,
                  }}
                >
                  {occ.customerId ? `customer ${occ.customerId}` : "no customer"} · {occ.channel}
                </span>
                <span style={{ flex: "none", whiteSpace: "nowrap", fontSize: 11.5, color: TEXT.meta }}>
                  {whenLabel(occ.occurredAt)}
                </span>
              </div>
            ))}
          </div>
        </Detail>
      )}
    </div>
  );
}

// ── Incidents ────────────────────────────────────────────────────────────────

function IncidentsView({ state }: { state: ObservabilityState }) {
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          padding: "16px 18px 22px",
          display: "flex",
          flexDirection: "column",
          gap: 11,
        }}
      >
        <span style={{ fontSize: 12, color: TEXT.groupLabel }}>
          Hand-written, and shown on the public status page. Nothing here is created automatically — an alert or an
          exception only becomes an incident when you say so.
        </span>
        <LoadState loading={state.incidentsLoading} error={state.incidentsError} onRetry={() => void loadIncidents()} />
        {!state.incidentsLoading && !state.incidentsError && state.incidents.length === 0 && (
          <span style={{ fontSize: 12.5, color: TEXT.faint }}>
            No incidents have ever been written. The status page shows nothing but green.
          </span>
        )}
        {state.incidents.map((incident) => (
          <div
            key={incident.id}
            onClick={() => selectIncident(incident.id)}
            style={{
              padding: "13px 15px",
              borderRadius: 8,
              cursor: "pointer",
              border: `1px solid ${incident.id === state.selectedIncidentId ? LINE.hover : LINE.base}`,
              background: SURFACE.card,
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
              <Pill text={incident.severity} tone={severityTone(incident.severity)} />
              <span style={{ flex: "1 1 200px", minWidth: 0, fontSize: 13, fontWeight: 600, color: TEXT.primary }}>
                {incident.title}
              </span>
              <Pill text={incident.status} tone={incidentStatusTone(incident.status)} />
            </div>
            <span style={{ display: "block", marginTop: 6, fontSize: 12, color: TEXT.quieter }}>
              {incident.description}
            </span>
            <span style={{ display: "block", marginTop: 6, fontSize: 11.5, color: TEXT.meta }}>
              {`opened ${whenLabel(incident.startedAt)} · updated ${whenLabel(incident.updatedAt)}`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Dead letters ─────────────────────────────────────────────────────────────

function DlqView({ state }: { state: ObservabilityState }) {
  const selected = state.dlq.find((d) => d.dlqId === state.selectedDlqId) ?? null;
  const [discardArmed, setDiscardArmed] = useState(false);

  useEffect(() => {
    setDiscardArmed(false);
  }, [state.selectedDlqId]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "stretch" }}>
      <LeftList title="Failed jobs" width={330}>
        <LoadState loading={state.dlqLoading} error={state.dlqError} onRetry={() => void loadDlq()} />
        {!state.dlqLoading && !state.dlqError && state.dlq.length === 0 && (
          <Placeholder text="Nothing is stuck. Every job that failed has been dealt with." />
        )}
        {state.dlq.map((item) => (
          <ListRow key={item.dlqId} on={item.dlqId === state.selectedDlqId} onSelect={() => selectDlq(item.dlqId)}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontFamily: FONT.mono,
                  fontSize: 12,
                  color: TEXT.strong,
                }}
              >
                {item.eventType}
              </span>
              <span
                style={{
                  flex: "none",
                  whiteSpace: "nowrap",
                  fontSize: 11,
                  fontWeight: 700,
                  color: item.attemptCount >= 5 ? ACCENT.danger : ACCENT.amberDim,
                }}
              >
                {`${item.attemptCount}x`}
              </span>
            </div>
            <span
              style={{
                display: "block",
                marginTop: 3,
                fontSize: 11.5,
                color: TEXT.groupLabel,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {item.errorMessage}
            </span>
            <span style={{ display: "block", marginTop: 3, fontSize: 11, color: TEXT.faint }}>
              {`${item.customerName ?? "no customer"} · failed ${whenLabel(item.lastAttemptAt)}`}
            </span>
          </ListRow>
        ))}
        {state.dlqTotal > state.dlq.length && (
          <div style={{ padding: "10px 13px", fontSize: 11, color: TEXT.faint }}>
            {`Showing ${state.dlq.length} of ${state.dlqTotal} stuck jobs.`}
          </div>
        )}
      </LeftList>

      {!selected ? (
        <Detail>
          <Placeholder text="Pick a failed job to see why it stopped." />
        </Detail>
      ) : (
        <Detail>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontFamily: FONT.mono, fontSize: 14, fontWeight: 700, color: TEXT.primary }}>
              {selected.eventType}
            </span>
            <span style={{ fontSize: 12.5, color: ACCENT_TEXT.danger }}>{selected.errorMessage}</span>
            <span style={{ fontSize: 11.5, color: TEXT.groupLabel }}>
              {`${selected.customerName ?? "no customer"} · ${selected.attemptCount} attempts · failed ${whenLabel(selected.lastAttemptAt)}`}
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {selected.replayable ? (
              <QuietButton
                label="Retry"
                tone="primary"
                title="Starts a fresh workflow run from this payload"
                onSelect={() => void retryDlqItem(selected.dlqId)}
              />
            ) : (
              <span style={{ fontSize: 11.5, color: TEXT.faint }}>
                Nothing knows how to re-run this one — only workflow runs can be replayed.
              </span>
            )}
            <QuietButton
              label="Mark handled"
              title="You fixed it elsewhere. Takes it out of the queue without running anything."
              onSelect={() => void markDlqItem(selected.dlqId, "manual")}
            />
            <QuietButton label="Copy payload" onSelect={() => copyPayload(selected.dlqId)} />
            <div style={{ flex: 1, minWidth: 4 }} />
            <QuietButton
              label={discardArmed ? "Discard — press again" : "Discard"}
              tone="danger"
              title="The work never happens. There is no undo."
              onSelect={() => {
                if (!discardArmed) {
                  setDiscardArmed(true);
                  return;
                }
                setDiscardArmed(false);
                void markDlqItem(selected.dlqId, "discarded");
              }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Caption>Payload</Caption>
            <div
              style={{
                padding: "11px 13px",
                borderRadius: 7,
                border: `1px solid ${LINE.base}`,
                background: SURFACE.chrome,
                fontFamily: FONT.mono,
                fontSize: 11.5,
                color: TEXT.soft,
                wordBreak: "break-all",
                whiteSpace: "pre-wrap",
              }}
            >
              {JSON.stringify(selected.payload, null, 2)}
            </div>
          </div>

          {selected.errorStack && (
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <Caption>Stack</Caption>
              <span style={{ fontFamily: FONT.mono, fontSize: 11.5, color: TEXT.dim, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                {selected.errorStack}
              </span>
            </div>
          )}

          <span style={{ fontSize: 11.5, color: TEXT.faint }}>
            {state.dlqTotal > 1
              ? `${state.dlqTotal} jobs are waiting. Retry all only re-runs the ones that came from a workflow.`
              : "This is the only job waiting."}
          </span>
          {state.dlq.some((d) => d.replayable) && (
            <div>
              <QuietButton label="Retry every workflow job here" onSelect={() => void retryAllDlq()} />
            </div>
          )}
        </Detail>
      )}
    </div>
  );
}

// ── Body ─────────────────────────────────────────────────────────────────────

/** Which view owns each record kind this screen can have a doc open on. */
const VIEW_FOR_KIND: Record<string, ObsView> = {
  alert: "rules",
  exception: "exceptions",
  incident: "incidents",
  dlq: "dlq",
};

export function ObservabilityBody({ recordId, kind }: { recordId?: string; kind?: string }) {
  const state = useSyncExternalStore(subscribe, getSnapshot);

  // This screen owns four record kinds under one route, so `kind` is what
  // disambiguates them (SHELL.md's note on `ctx.kind`) — alert rule 7 and
  // incident 7 are not the same record. Opening a doc lands you on that
  // record's own view with it selected; arriving with no record open just
  // loads whichever view you were last on.
  useEffect(() => {
    const view = kind ? VIEW_FOR_KIND[kind] : undefined;
    if (view && recordId) openView(view, recordId);
    else openView(state.view);
    // Keyed on the open doc, not on every store tick.
  }, [recordId, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", background: SURFACE.app }}>
      <Header state={state} />
      {state.view === "rules" && <RulesView state={state} />}
      {state.view === "exceptions" && <ExceptionsView state={state} />}
      {state.view === "incidents" && <IncidentsView state={state} />}
      {state.view === "dlq" && <DlqView state={state} />}
    </div>
  );
}
