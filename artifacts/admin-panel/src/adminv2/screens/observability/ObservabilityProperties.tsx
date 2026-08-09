/**
 * The Observability screen's right (Properties) panel — the design's own
 * per-view property groups, over real columns.
 *
 *   rules       Rule · Firing · Delivery · Its firings
 *   exceptions  Exception group · State
 *   incidents   Incident · Public
 *   dlq         Failed job · Queue
 *
 * Editable fields write straight through and then reload, matching the peek's
 * rule (SHELL.md section 3: "there is no save step and no dirty state"). Text
 * fields commit on blur or Enter rather than per keystroke — a PATCH per
 * character would be a write storm, and the reload after each one would fight
 * the cursor.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { ACCENT, ACCENT_TEXT, FONT, LINE, SURFACE, TEXT } from "../../theme";
import {
  dayLabel,
  exceptionStatusTone,
  incidentStatusTone,
  severityTone,
  whenLabel,
} from "./observabilityFormat";
import {
  getSnapshot,
  openView,
  resolveExceptionGroup,
  subscribe,
  unsuppressExceptionGroup,
  updateIncident,
  updateRule,
  type ObservabilityState,
} from "./observabilityStore";
import type { IncidentStatus, Severity } from "./observabilityApi";
import { getShellApi } from "../../shell/ShellContext";

const INPUT = {
  width: "100%",
  height: 28,
  marginTop: 3,
  padding: "0 8px",
  borderRadius: 5,
  border: `1px solid ${LINE.control}`,
  background: SURFACE.root,
  color: TEXT.strong,
  fontFamily: "inherit",
  fontSize: 12.5,
  outline: "none",
} as const;

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span
        style={{
          fontSize: 10.5,
          fontWeight: 800,
          letterSpacing: ".09em",
          textTransform: "uppercase",
          color: TEXT.caption,
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

function Static({ label, value, tone, mono }: { label: string; value: string; tone?: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <span style={{ fontSize: 11, color: TEXT.groupLabel }}>{label}</span>
      <span
        style={{
          fontSize: 12.5,
          color: tone ?? TEXT.body,
          fontFamily: mono ? FONT.mono : "inherit",
          wordBreak: mono ? "break-all" : "normal",
        }}
      >
        {value}
      </span>
    </div>
  );
}

/** Commits on blur or Enter — see the file doc comment. */
function TextField({
  label,
  value,
  onCommit,
  area,
  numeric,
}: {
  label: string;
  value: string;
  onCommit: (next: string) => void;
  area?: boolean;
  numeric?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    if (draft !== value) onCommit(draft);
  };

  return (
    <label style={{ display: "block" }}>
      <span style={{ fontSize: 11, color: TEXT.groupLabel }}>{label}</span>
      {area ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          style={{ ...INPUT, height: 74, padding: "6px 8px", resize: "vertical", lineHeight: 1.45 }}
        />
      ) : (
        <input
          value={draft}
          inputMode={numeric ? "numeric" : undefined}
          onChange={(e) => setDraft(numeric ? e.target.value.replace(/[^0-9]/g, "") : e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          style={INPUT}
        />
      )}
    </label>
  );
}

/**
 * A cycle button, not a dropdown — the same treatment the peek gives a small
 * enum (SHELL.md section 3), so an enum reads the same wherever it appears.
 */
function EnumField({
  label,
  value,
  options,
  onSelect,
  tone,
}: {
  label: string;
  value: string;
  options: string[];
  onSelect: (next: string) => void;
  tone?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <span style={{ fontSize: 11, color: TEXT.groupLabel }}>{label}</span>
      <button
        onClick={() => {
          const i = options.indexOf(value);
          onSelect(options[(i + 1) % options.length]!);
        }}
        title={`Cycles through ${options.join(", ")}`}
        style={{
          marginTop: 3,
          height: 28,
          padding: "0 10px",
          borderRadius: 5,
          border: `1px solid ${LINE.control}`,
          background: SURFACE.root,
          color: tone ?? TEXT.strong,
          fontFamily: "inherit",
          fontSize: 12.5,
          fontWeight: 600,
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        {value}
      </button>
    </div>
  );
}

function Nothing({ text }: { text: string }) {
  return <div style={{ padding: 12, fontSize: 11.5, color: TEXT.faint, lineHeight: 1.5 }}>{text}</div>;
}

// ── Per-view panels ──────────────────────────────────────────────────────────

function RuleProps({ state }: { state: ObservabilityState }) {
  const rule = state.rules.find((r) => r.id === state.selectedRuleId);
  if (!rule) return <Nothing text="No rule selected. Pick one on the left and its settings land here." />;

  const events = state.events.filter((e) => e.ruleId === rule.id);

  return (
    <>
      <Group label="Rule">
        <Static label="Rule" value={rule.label} />
        <Static label="Key" value={rule.ruleKey} mono tone={ACCENT.info} />
        <Static label="Condition" value={rule.conditionType} mono />
        <Static label="What it watches" value={rule.description ?? "Nobody wrote this down."} />
      </Group>

      <Group label="Firing">
        <TextField
          label="Threshold"
          numeric
          value={String(rule.threshold)}
          onCommit={(v) => void updateRule(rule.id, { threshold: Number(v) || 0 })}
        />
        <TextField
          label="Window (min)"
          numeric
          value={String(rule.windowMinutes)}
          onCommit={(v) => void updateRule(rule.id, { windowMinutes: Number(v) || 0 })}
        />
        <TextField
          label="Cooldown (min)"
          numeric
          value={String(rule.cooldownMinutes)}
          onCommit={(v) => void updateRule(rule.id, { cooldownMinutes: Number(v) || 0 })}
        />
        <EnumField
          label="Severity"
          value={rule.severity}
          options={["critical", "major", "minor"]}
          tone={severityTone(rule.severity)}
          onSelect={(v) => void updateRule(rule.id, { severity: v })}
        />
      </Group>

      <Group label="Delivery">
        <EnumField
          label="Enabled"
          value={rule.enabled ? "yes" : "no"}
          options={["yes", "no"]}
          tone={rule.enabled ? ACCENT.greenSoft : TEXT.groupLabel}
          onSelect={(v) => void updateRule(rule.id, { enabled: v === "yes" })}
        />
        <EnumField
          label="Email"
          value={rule.deliveryEmail ? "yes" : "no"}
          options={["yes", "no"]}
          onSelect={(v) => void updateRule(rule.id, { deliveryEmail: v === "yes" })}
        />
        <EnumField
          label="Push"
          value={rule.deliveryPush ? "yes" : "no"}
          options={["yes", "no"]}
          onSelect={(v) => void updateRule(rule.id, { deliveryPush: v === "yes" })}
        />
        <Static
          label="Deep link"
          value={rule.deepLinkPath ?? "none — the alert names no screen to open"}
          mono
          tone={rule.deepLinkPath ? ACCENT.info : TEXT.faint}
        />
      </Group>

      <Group label="Its firings">
        <Static label="Events" value={String(events.length)} />
        <Static label="Last fired" value={events[0] ? whenLabel(events[0].firedAt) : "never"} />
        <Static
          label="Still open"
          value={String(events.filter((e) => !e.resolvedAt).length)}
          tone={events.some((e) => !e.resolvedAt) ? ACCENT_TEXT.danger : undefined}
        />
      </Group>
    </>
  );
}

function ExceptionProps({ state }: { state: ObservabilityState }) {
  const group = state.exceptions.find((g) => g.fingerprint === state.selectedFingerprint);
  if (!group) return <Nothing text="No exception group selected." />;

  return (
    <>
      <Group label="Exception group">
        <Static label="Error" value={group.errorName} mono />
        <Static label="Message" value={group.errorMessage} />
        <Static
          label="Where"
          value={group.file ? `${group.file}${group.line ? `:${group.line}` : ""}` : "not recorded"}
          mono
          tone={group.file ? ACCENT.info : TEXT.faint}
        />
        <Static label="Function" value={group.functionName ?? "not recorded"} mono />
      </Group>

      <Group label="State">
        {/*
          Not an EnumField: suppressing needs a reason the route will not accept
          as blank, and resolving says something about the world. Both are
          buttons on the group itself; this panel states the truth instead of
          offering a third way to set it that would have to duplicate the prompt.
        */}
        <Static label="Status" value={group.status} tone={exceptionStatusTone(group.status)} />
        <Static label="Occurrences" value={String(group.occurrenceCount)} tone={ACCENT.amberDim} />
        <Static label="First seen" value={dayLabel(group.firstSeenAt)} />
        <Static label="Last seen" value={whenLabel(group.lastSeenAt)} />
        <Static label="Channel" value={`${group.channel} · ${group.source}`} />
        {group.suppressionReason && <Static label="Suppressed because" value={group.suppressionReason} />}
        {group.resolutionNote && <Static label="Resolution note" value={group.resolutionNote} />}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
          {group.status === "suppressed" ? (
            <PanelButton label="Unsuppress" onSelect={() => void unsuppressExceptionGroup(group.fingerprint)} />
          ) : group.status === "open" ? (
            <PanelButton label="Resolve" onSelect={() => void resolveExceptionGroup(group.fingerprint)} />
          ) : null}
        </div>
      </Group>
    </>
  );
}

function IncidentProps({ state }: { state: ObservabilityState }) {
  const incident = state.incidents.find((i) => i.id === state.selectedIncidentId);
  if (!incident)
    return <Nothing text="No incident selected. Open one from an alert or an exception, or pick one from the list." />;

  return (
    <>
      <Group label="Incident">
        <TextField
          label="Title"
          value={incident.title}
          onCommit={(v) => v.trim() && void updateIncident(incident.id, { title: v.trim() })}
        />
        <TextField
          label="Description"
          area
          value={incident.description}
          onCommit={(v) => v.trim() && void updateIncident(incident.id, { description: v.trim() })}
        />
        <EnumField
          label="Severity"
          value={incident.severity}
          options={["minor", "major", "critical"]}
          tone={severityTone(incident.severity)}
          onSelect={(v) => void updateIncident(incident.id, { severity: v as Severity })}
        />
        <EnumField
          label="Status"
          value={incident.status}
          options={["investigating", "identified", "monitoring", "resolved"]}
          tone={incidentStatusTone(incident.status)}
          onSelect={(v) => void updateIncident(incident.id, { status: v as IncidentStatus })}
        />
      </Group>

      <Group label="Public">
        <Static label="Opened" value={whenLabel(incident.startedAt)} />
        <Static label="Updated" value={whenLabel(incident.updatedAt)} />
        <Static
          label="Resolved"
          value={incident.resolvedAt ? whenLabel(incident.resolvedAt) : "still running"}
          tone={incident.resolvedAt ? ACCENT.greenSoft : ACCENT.amberDim}
        />
        <Static label="Seen by" value="Anyone on the status page. Write it as if a customer is reading it." />
      </Group>
    </>
  );
}

function DlqProps({ state }: { state: ObservabilityState }) {
  const item = state.dlq.find((d) => d.dlqId === state.selectedDlqId);
  if (!item) return <Nothing text="No failed job selected." />;

  return (
    <>
      <Group label="Failed job">
        <Static label="Job" value={item.eventType} mono />
        <Static label="Error" value={item.errorMessage} tone={ACCENT_TEXT.danger} />
        <Static label="Customer" value={item.customerName ?? "none recorded"} />
        <Static
          label="Attempts"
          value={String(item.attemptCount)}
          tone={item.attemptCount >= 5 ? ACCENT.danger : ACCENT.amberDim}
        />
        <Static label="Failed at" value={whenLabel(item.lastAttemptAt)} />
        <Static
          label="Can be re-run"
          value={item.replayable ? "yes — it came from a workflow run" : "no — nothing knows how to re-run it"}
          tone={item.replayable ? ACCENT.greenSoft : TEXT.faint}
        />
      </Group>

      <Group label="Queue">
        <Static label="Waiting" value={`${state.dlqTotal} jobs`} tone={ACCENT.amberDim} />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
          <PanelButton
            label="The rule watching this"
            onSelect={() => {
              openView("rules");
              getShellApi()?.navigate("/observability");
            }}
          />
        </div>
      </Group>
    </>
  );
}

function PanelButton({ label, onSelect }: { label: string; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      style={{
        padding: "5px 10px",
        borderRadius: 5,
        border: `1px solid ${LINE.control}`,
        background: "transparent",
        color: TEXT.soft,
        fontFamily: "inherit",
        fontSize: 11.5,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

export function ObservabilityProperties() {
  const state = useSyncExternalStore(subscribe, getSnapshot);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 12 }}>
      {state.view === "rules" && <RuleProps state={state} />}
      {state.view === "exceptions" && <ExceptionProps state={state} />}
      {state.view === "incidents" && <IncidentProps state={state} />}
      {state.view === "dlq" && <DlqProps state={state} />}
    </div>
  );
}
