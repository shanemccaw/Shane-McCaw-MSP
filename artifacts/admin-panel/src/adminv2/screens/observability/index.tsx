/**
 * Observability — the Watch tab's screen. "What is wrong now."
 *
 * `watch` is the shell's "what needs me" tab (SHELL.md section 1: exceptions,
 * dead letters, unrun migrations, overdue invoices), so this screen registers
 * there rather than asking for a fixed tab of its own — the seven are closed.
 * Every fixed-tab command here is `open`, `create` or `global`; everything that
 * needs one specific rule, group, incident or job open lives on the "Observe
 * Tools" contextual tab, which is the audited rule (`auditFixedTabIntents`),
 * not a preference.
 *
 * Four record kinds under one route (`alert` `exception` `incident` `dlq`), so
 * `render` reads `ctx.kind` as well as `ctx.recordId` — alert rule 7 and
 * incident 7 are different records, and `recordId` alone cannot tell them
 * apart. That is the same reason `screens/ad/` needs it.
 *
 * The Watch tab's large button carries a live count — SHELL.md section 1 calls
 * `watch` "the one place a live count belongs", and this is the screen behind
 * it. It has to come through `RibbonCommand.liveKey` and not a plain `live`
 * value: a screen's `ribbon` array is built once, at `registerScreen()`
 * module-load time, so a number baked in there would be whatever was true
 * before the first fetch — on this screen, that means confidently reporting
 * "All clear" while an alert is firing. `observabilityStore`'s `syncLiveRibbon`
 * pushes the real total; the static label is only what shows before anything
 * has loaded.
 */

import { Activity, Bell, Bug, PackageX, RefreshCw, Siren, Zap } from "lucide-react";
import { registerScreen } from "../../registry/registry";
import { getShellApi } from "../../shell/ShellContext";
import { ACCENT, ACCENT_TEXT } from "../../theme";
import type { CommandItem, GalleryRow, GallerySpec, PeekModel } from "../../registry/types";
import { ObservabilityBody } from "./ObservabilityBody";
import { ObservabilityExplorer } from "./ObservabilityExplorer";
import { ObservabilityProperties } from "./ObservabilityProperties";
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
  fireTestException,
  getSnapshot,
  health,
  markDlqItem,
  openIncidentFrom,
  openView,
  refreshAll,
  resolveEvent,
  resolveExceptionGroup,
  retryAllDlq,
  retryDlqItem,
  sendTestFiring,
  toggleRule,
  unsuppressExceptionGroup,
  updateIncident,
  updateRule,
  type ObsView,
} from "./observabilityStore";
import type { IncidentStatus, Severity } from "./observabilityApi";

const ROUTE = "/observability";

/** Every entry point goes through here so a view switch and the route never disagree. */
function go(view: ObsView, id?: string | number) {
  return () => {
    openView(view, id);
    getShellApi()?.navigate(ROUTE);
  };
}

function openPeek(kind: "alert" | "exception" | "incident" | "dlq", id: string) {
  getShellApi()?.openPeek(kind, id);
}

function openDoc(kind: "alert" | "exception" | "incident" | "dlq", id: string) {
  getShellApi()?.openDoc({ kind, id, screenId: "observability" });
}

function severityOf(value: string): Severity {
  return value === "critical" || value === "major" || value === "minor" ? value : "major";
}

// ── The Watch tab's gallery ──────────────────────────────────────────────────

/**
 * Rows for "Everything that wants attention".
 *
 * Read through a getter below rather than assigned, because a gallery spec is
 * part of the module-load-time ribbon array and an assigned array would be
 * frozen empty forever. `Gallery.tsx` reads `spec.rows` while rendering, so the
 * getter runs at the moment the panel opens and the rows are always the real
 * current ones. Nothing else in the shell needs this; a gallery over static
 * content should just assign an array.
 */
function attentionRows(): GalleryRow[] {
  const state = getSnapshot();
  const h = health(state);
  const rows: GalleryRow[] = [];

  for (const event of h.firing) {
    rows.push({
      id: `alert-${event.id}`,
      group: "Firing",
      tile: String(event.conditionValue),
      name: event.ruleLabel ?? event.ruleKey,
      head: event.severity,
      sub: event.summary,
      onSelect: () => openPeek("alert", String(event.ruleId)),
    });
  }
  for (const item of h.stuck) {
    rows.push({
      id: `dlq-${item.dlqId}`,
      group: "Stuck",
      tile: `${item.attemptCount}x`,
      name: item.eventType,
      head: item.replayable ? "can re-run" : "no re-run",
      sub: `${item.errorMessage} · ${item.customerName ?? "no customer"}`,
      onSelect: () => openPeek("dlq", item.dlqId),
    });
  }
  for (const group of h.openExceptions) {
    rows.push({
      id: `exc-${group.fingerprint}`,
      group: "Throwing",
      tile: String(group.occurrenceCount),
      name: group.errorName,
      head: group.channel,
      sub: `${group.errorMessage} · last ${whenLabel(group.lastSeenAt)}`,
      onSelect: () => openPeek("exception", group.fingerprint),
    });
  }
  for (const incident of h.liveIncidents) {
    rows.push({
      id: `inc-${incident.id}`,
      group: "Public",
      tile: incident.severity.slice(0, 3),
      name: incident.title,
      head: incident.status,
      sub: `Opened ${whenLabel(incident.startedAt)} — customers can read this`,
      onSelect: () => openPeek("incident", String(incident.id)),
    });
  }

  if (rows.length === 0) {
    rows.push({
      id: "clear",
      group: "Right now",
      tile: "OK",
      name: "Nothing wants you",
      sub: "No firing alerts, no stuck jobs, no open exceptions, no live incidents",
      onSelect: go("rules"),
    });
  }
  return rows;
}

const attentionGallery: GallerySpec = {
  id: "obs-attention",
  title: "Everything that wants attention",
  searchable: true,
  searchPlaceholder: "Type to narrow it down",
  get rows() {
    return attentionRows();
  },
  footer: { label: "Open Observability", onSelect: go("rules") },
};

// ── Peeks ────────────────────────────────────────────────────────────────────

function alertPeek(id: string): PeekModel | null {
  const state = getSnapshot();
  const rule = state.rules.find((r) => String(r.id) === id);
  if (!rule) return null;
  const events = state.events.filter((e) => e.ruleId === rule.id);
  const live = events.filter((e) => !e.resolvedAt);

  return {
    kind: "alert",
    eyebrow: "ALERT RULE",
    title: rule.label,
    sub: rule.ruleKey,
    icon: Bell,
    tone: rule.enabled ? severityTone(rule.severity) : ACCENT.info,
    tag: rule.enabled ? "armed" : "off",
    tagTone: rule.enabled ? ACCENT.greenSoft : ACCENT.info,
    note: state.said ?? undefined,
    facts: [
      { label: "Threshold", value: String(rule.threshold) },
      { label: "Window", value: `${rule.windowMinutes} min` },
      { label: "Firings", value: String(events.length), color: live.length ? ACCENT_TEXT.danger : undefined },
      {
        label: "What it watches",
        value: rule.description ?? "Nobody wrote this down.",
        prose: true,
      },
    ],
    edits: [
      { key: "threshold", label: "Threshold", value: String(rule.threshold), onChange: (v) => void updateRule(rule.id, { threshold: Number(v.replace(/[^0-9]/g, "")) || 0 }) },
      { key: "window", label: "Window (min)", value: String(rule.windowMinutes), onChange: (v) => void updateRule(rule.id, { windowMinutes: Number(v.replace(/[^0-9]/g, "")) || 0 }) },
      { key: "cooldown", label: "Cooldown (min)", value: String(rule.cooldownMinutes), onChange: (v) => void updateRule(rule.id, { cooldownMinutes: Number(v.replace(/[^0-9]/g, "")) || 0 }) },
      { key: "severity", label: "Severity", value: rule.severity, options: ["critical", "major", "minor"], onChange: (v) => void updateRule(rule.id, { severity: v }) },
      { key: "enabled", label: "Enabled", value: rule.enabled ? "yes" : "no", options: ["yes", "no"], onChange: (v) => void updateRule(rule.id, { enabled: v === "yes" }) },
      { key: "email", label: "Email", value: rule.deliveryEmail ? "yes" : "no", options: ["yes", "no"], onChange: (v) => void updateRule(rule.id, { deliveryEmail: v === "yes" }) },
      { key: "push", label: "Push", value: rule.deliveryPush ? "yes" : "no", options: ["yes", "no"], onChange: (v) => void updateRule(rule.id, { deliveryPush: v === "yes" }) },
    ],
    list: {
      title: "What it fired",
      rows: events.slice(0, 20).map((event) => ({
        id: String(event.id),
        mark: event.resolvedAt ? "DONE" : "OPEN",
        tone: event.resolvedAt ? ACCENT.greenBright : ACCENT.danger,
        name: event.summary,
        sub: `${event.deliveredEmail ? "emailed" : "no email"}${event.deliveredPush ? " · pushed" : ""}`,
        right: whenLabel(event.firedAt),
        onSelect: event.resolvedAt ? undefined : () => void resolveEvent(event.id),
      })),
    },
    open: () => openDoc("alert", id),
    openLabel: "Open it properly",
    actions: [
      { label: "Send a test firing", tone: "primary", onSelect: () => void sendTestFiring(rule.id) },
      { label: rule.enabled ? "Disable it" : "Enable it", confirm: rule.enabled, onSelect: () => toggleRule(rule.id) },
    ],
  };
}

function exceptionPeek(id: string): PeekModel | null {
  const state = getSnapshot();
  const group = state.exceptions.find((g) => g.fingerprint === id);
  if (!group) return null;

  const frame = codeFrameLines(group.codeFrame)
    .map((l) => l.text)
    .join("\n");

  return {
    kind: "exception",
    eyebrow: "EXCEPTION",
    title: group.errorName,
    sub: group.errorMessage,
    icon: Bug,
    tone: exceptionStatusTone(group.status),
    tag: group.status,
    tagTone: exceptionStatusTone(group.status),
    note: state.said ?? undefined,
    facts: [
      { label: "Occurrences", value: String(group.occurrenceCount), color: group.status === "open" ? ACCENT.amberDim : undefined },
      { label: "First seen", value: dayLabel(group.firstSeenAt) },
      { label: "Last seen", value: whenLabel(group.lastSeenAt), prose: true },
      { label: "Where", value: exceptionWhere(group), prose: true },
    ],
    body: frame
      ? { title: "Where it threw", content: frame }
      : group.stackSample
        ? { title: "Stack", content: group.stackSample }
        : undefined,
    list: {
      title: "Occurrences",
      rows:
        state.selectedFingerprint === group.fingerprint
          ? state.occurrences.slice(0, 20).map((occ) => ({
              id: String(occ.id),
              name: occ.correlationId ?? "no correlation id",
              sub: occ.customerId ? `customer ${occ.customerId} · ${occ.channel}` : occ.channel,
              right: whenLabel(occ.occurredAt),
            }))
          : [],
    },
    open: () => openDoc("exception", id),
    // Suppressing needs a reason the route will not accept as blank, and a peek
    // has nowhere to collect one — so it stays on the screen, and this is the
    // way there. Offering a Suppress here that 400s would be worse than not
    // offering it.
    openLabel: "Open it properly to suppress",
    actions: [
      ...(group.status === "open"
        ? [{ label: "Resolve", tone: "primary" as const, onSelect: () => void resolveExceptionGroup(group.fingerprint) }]
        : []),
      ...(group.status === "suppressed"
        ? [{ label: "Unsuppress", onSelect: () => void unsuppressExceptionGroup(group.fingerprint) }]
        : []),
      {
        label: "Open an incident",
        onSelect: () => void openIncidentFrom("an exception group", `${group.errorName}: ${group.errorMessage}`),
      },
    ],
  };
}

function incidentPeek(id: string): PeekModel | null {
  const state = getSnapshot();
  const incident = state.incidents.find((i) => String(i.id) === id);
  if (!incident) return null;

  return {
    kind: "incident",
    eyebrow: "INCIDENT",
    title: incident.title,
    sub: incident.description,
    icon: Siren,
    tone: incidentStatusTone(incident.status),
    tag: incident.severity,
    tagTone: severityTone(incident.severity),
    note: state.said ?? undefined,
    facts: [
      { label: "Status", value: incident.status, prose: true },
      { label: "Opened", value: whenLabel(incident.startedAt), prose: true },
      { label: "Updated", value: whenLabel(incident.updatedAt), prose: true },
      { label: "Who sees it", value: "Anyone on the public status page", prose: true },
    ],
    edits: [
      { key: "title", label: "Title", value: incident.title, onChange: (v) => v.trim() && void updateIncident(incident.id, { title: v.trim() }) },
      { key: "description", label: "Description", value: incident.description, area: true, onChange: (v) => v.trim() && void updateIncident(incident.id, { description: v.trim() }) },
      { key: "severity", label: "Severity", value: incident.severity, options: ["minor", "major", "critical"], onChange: (v) => void updateIncident(incident.id, { severity: v as Severity }) },
      { key: "status", label: "Status", value: incident.status, options: ["investigating", "identified", "monitoring", "resolved"], onChange: (v) => void updateIncident(incident.id, { status: v as IncidentStatus }) },
    ],
    open: () => openDoc("incident", id),
    actions:
      incident.status === "resolved"
        ? []
        : [
            {
              label: "Mark resolved",
              tone: "primary",
              confirm: true,
              onSelect: () => void updateIncident(incident.id, { status: "resolved" }),
            },
          ],
  };
}

function dlqPeek(id: string): PeekModel | null {
  const state = getSnapshot();
  const item = state.dlq.find((d) => d.dlqId === id);
  if (!item) return null;

  return {
    kind: "dlq",
    eyebrow: "DEAD LETTER",
    title: item.eventType,
    sub: item.errorMessage,
    icon: PackageX,
    tone: ACCENT.danger,
    tag: `${item.attemptCount} attempts`,
    tagTone: item.attemptCount >= 5 ? ACCENT.danger : ACCENT.amberDim,
    note: state.said ?? undefined,
    facts: [
      { label: "Attempts", value: String(item.attemptCount) },
      { label: "Customer", value: item.customerName ?? "none recorded", prose: true },
      { label: "Failed", value: whenLabel(item.lastAttemptAt), prose: true },
      {
        label: "Can be re-run",
        value: item.replayable ? "Yes — it came from a workflow run" : "No — nothing knows how to re-run it",
        prose: true,
        color: item.replayable ? ACCENT.greenSoft : undefined,
      },
    ],
    body: { title: "Payload", content: JSON.stringify(item.payload, null, 2) },
    open: () => openDoc("dlq", id),
    actions: [
      ...(item.replayable
        ? [{ label: "Retry", tone: "primary" as const, onSelect: () => void retryDlqItem(item.dlqId) }]
        : []),
      { label: "Copy payload", onSelect: () => copyPayload(item.dlqId) },
      { label: "Mark handled", onSelect: () => void markDlqItem(item.dlqId, "manual") },
      { label: "Discard", tone: "danger", confirm: true, onSelect: () => void markDlqItem(item.dlqId, "discarded") },
    ],
  };
}

// ── Registration ─────────────────────────────────────────────────────────────

registerScreen({
  id: "observability",
  title: "Observability",
  area: "obs",
  icon: Activity,
  route: ROUTE,
  render: (ctx) => <ObservabilityBody recordId={ctx.recordId} kind={ctx.kind} />,

  left: { title: "Observability", render: () => <ObservabilityExplorer /> },
  right: { title: "Properties", render: () => <ObservabilityProperties /> },

  ribbon: [
    {
      tab: "watch",
      order: 10,
      group: {
        label: "Right now",
        large: [
          {
            label: "What is wrong now",
            icon: Siren,
            intent: "open",
            color: ACCENT_TEXT.danger,
            title: "Every firing alert, stuck job, open exception and live incident, in one list",
            // Overridden with "3 need you" / "All clear" and its real colour as
            // soon as anything has loaded — see this file's doc comment.
            liveKey: "obs:attention",
            onSelect: go("rules"),
            gallery: attentionGallery,
          },
        ],
        small: [
          { label: "Alert rules", icon: Bell, intent: "open", liveKey: "obs:go-rules", onSelect: go("rules") },
          { label: "Exceptions", icon: Bug, intent: "open", liveKey: "obs:go-exceptions", onSelect: go("exceptions") },
          { label: "Dead-letter queue", icon: PackageX, intent: "open", color: ACCENT.amber, liveKey: "obs:go-dlq", onSelect: go("dlq") },
        ],
      },
    },
    {
      tab: "watch",
      order: 20,
      group: {
        label: "Triage",
        large: [
          {
            label: "Open an incident",
            icon: Siren,
            intent: "create",
            color: ACCENT.amber,
            title: "Writes a real row on the public status page. Customers can read it.",
            onSelect: () => void openIncidentFrom("the Watch tab", "New incident"),
          },
        ],
        small: [
          { label: "Incidents", icon: Activity, intent: "open", liveKey: "obs:go-incidents", onSelect: go("incidents") },
          {
            label: "Trigger a test exception",
            icon: Zap,
            intent: "global",
            title: "Throws a real error through the logger so the whole capture path can be checked",
            onSelect: () => void fireTestException(),
          },
          { label: "Refresh", icon: RefreshCw, intent: "global", onSelect: refreshAll },
        ],
      },
    },
    {
      tab: "watch",
      order: 30,
      group: {
        label: "The queue",
        large: [
          {
            label: "Retry every workflow job",
            icon: RefreshCw,
            intent: "global",
            title: "Re-runs every stuck job that came from a workflow. The rest cannot be re-run.",
            onSelect: () => void retryAllDlq(),
          },
        ],
      },
    },
  ],

  contextualTab: (ctx) => {
    const kind = ctx.kind;
    const id = ctx.recordId;
    if (!id || !kind || !["alert", "exception", "incident", "dlq"].includes(kind)) return null;

    const goTo = {
      label: "Go to",
      large: [{ label: "Alert rules", icon: Bell, intent: "record" as const, onSelect: go("rules") }],
      small: [
        { label: "Exceptions", icon: Bug, intent: "record" as const, onSelect: go("exceptions") },
        { label: "Incidents", icon: Activity, intent: "record" as const, onSelect: go("incidents") },
        { label: "Dead-letter queue", icon: PackageX, intent: "record" as const, onSelect: go("dlq") },
      ],
    };

    const state = getSnapshot();

    if (kind === "alert") {
      const rule = state.rules.find((r) => String(r.id) === id);
      return {
        id: "observe-tools",
        label: "Observe Tools",
        groups: [
          goTo,
          {
            label: "This rule",
            large: [
              {
                label: rule?.enabled ? "Disable" : "Enable",
                icon: Bell,
                intent: "record",
                color: rule?.enabled ? ACCENT.greenSoft : ACCENT.info,
                onSelect: () => toggleRule(Number(id)),
              },
            ],
            small: [
              { label: "Send a test firing", icon: Zap, intent: "record", onSelect: () => void sendTestFiring(Number(id)) },
              { label: "Open an incident", icon: Siren, intent: "record", color: ACCENT.amber, onSelect: () => void openIncidentFrom("a rule", rule?.label ?? "New incident") },
            ],
          },
        ],
      };
    }

    if (kind === "exception") {
      const group = state.exceptions.find((g) => g.fingerprint === id);
      return {
        id: "observe-tools",
        label: "Observe Tools",
        groups: [
          goTo,
          {
            label: "This exception",
            large: [
              {
                label: group?.status === "suppressed" ? "Unsuppress" : "Resolve",
                icon: Bug,
                intent: "record",
                color: ACCENT.greenSoft,
                title: "Resolving is not a promise — it reopens by itself the next time it throws",
                onSelect: () =>
                  group?.status === "suppressed"
                    ? void unsuppressExceptionGroup(id)
                    : void resolveExceptionGroup(id),
              },
            ],
            small: [
              {
                label: "Open an incident",
                icon: Siren,
                intent: "record",
                color: ACCENT.amber,
                onSelect: () => void openIncidentFrom("an exception group", group ? `${group.errorName}: ${group.errorMessage}` : "New incident"),
              },
              { label: "Trigger a test exception", icon: Zap, intent: "record", onSelect: () => void fireTestException() },
            ],
          },
        ],
      };
    }

    if (kind === "incident") {
      const incident = state.incidents.find((i) => String(i.id) === id);
      return {
        id: "observe-tools",
        label: "Observe Tools",
        groups: [
          goTo,
          {
            label: "This incident",
            large: [
              {
                label: "Mark resolved",
                icon: Activity,
                intent: "record",
                color: ACCENT.greenSoft,
                disabled: incident?.status === "resolved",
                title: "The public status page updates the moment you do this",
                onSelect: () => void updateIncident(Number(id), { status: "resolved" }),
              },
            ],
            small: [
              { label: "Monitoring", icon: Activity, intent: "record", onSelect: () => void updateIncident(Number(id), { status: "monitoring" }) },
              { label: "Identified", icon: Activity, intent: "record", onSelect: () => void updateIncident(Number(id), { status: "identified" }) },
            ],
          },
        ],
      };
    }

    const item = state.dlq.find((d) => d.dlqId === id);
    return {
      id: "observe-tools",
      label: "Observe Tools",
      groups: [
        goTo,
        {
          label: "This job",
          large: [
            {
              label: "Retry",
              icon: RefreshCw,
              intent: "record",
              disabled: !item?.replayable,
              title: item?.replayable
                ? "Starts a fresh workflow run from this payload"
                : "Nothing knows how to re-run this one — only workflow runs can be replayed",
              onSelect: () => void retryDlqItem(id),
            },
          ],
          small: [
            { label: "Copy payload", icon: PackageX, intent: "record", onSelect: () => copyPayload(id) },
            { label: "Mark handled", icon: Activity, intent: "record", onSelect: () => void markDlqItem(id, "manual") },
            { label: "Discard", icon: Zap, intent: "record", color: ACCENT.danger, onSelect: () => void markDlqItem(id, "discarded") },
          ],
        },
      ],
    };
  },

  peeks: {
    alert: alertPeek,
    exception: exceptionPeek,
    incident: incidentPeek,
    dlq: dlqPeek,
  },

  commands: () => {
    const state = getSnapshot();
    const h = health(state);

    const items: CommandItem[] = [
      {
        id: "act:obs-whats-wrong",
        type: "action",
        kind: "run",
        name: "What is wrong now",
        sub: "Firing alerts, stuck jobs, open exceptions, live incidents",
        area: "obs",
        run: go("rules"),
      },
      {
        id: "act:obs-open-incident",
        type: "action",
        kind: "run",
        name: "Open an incident",
        sub: "Writes a real row on the public status page",
        area: "obs",
        run: () => void openIncidentFrom("the palette", "New incident"),
      },
      {
        id: "act:obs-test-exception",
        type: "action",
        kind: "run",
        name: "Trigger a test exception",
        sub: "A real error through the logger — checks the whole capture path",
        area: "obs",
        run: () => void fireTestException(),
      },
      {
        id: "act:obs-retry-all",
        type: "action",
        kind: "run",
        name: "Retry every stuck workflow job",
        sub: "Only the ones that came from a workflow can be re-run",
        area: "obs",
        run: () => void retryAllDlq(),
      },
      {
        id: "act:obs-refresh",
        type: "action",
        kind: "run",
        name: "Refresh observability",
        sub: "Re-reads rules, exceptions, incidents and the dead-letter queue",
        area: "obs",
        run: refreshAll,
      },

      // `?` answers. The number is the point — see SHELL.md section 4.
      {
        id: "ans:obs-alerts-firing",
        type: "answer",
        name: "Alerts firing",
        sub: h.firing.length ? h.firing[0]!.summary : "Nothing is firing",
        area: "obs",
        live: String(h.firing.length),
        run: go("rules"),
      },
      {
        id: "ans:obs-stuck-jobs",
        type: "answer",
        name: "Jobs stuck in the dead-letter queue",
        sub: "Real work sitting unfinished",
        area: "obs",
        live: String(Math.max(h.stuck.length, state.dlqTotal)),
        run: go("dlq"),
      },
      {
        id: "ans:obs-open-exceptions",
        type: "answer",
        name: "Exception groups still open",
        sub: "Code that threw and nobody has looked at",
        area: "obs",
        live: String(h.openExceptions.length),
        run: go("exceptions"),
      },
      {
        id: "ans:obs-live-incidents",
        type: "answer",
        name: "Incidents on the status page",
        sub: "Anything not yet resolved is public",
        area: "obs",
        live: String(h.liveIncidents.length),
        run: go("incidents"),
      },
    ];

    for (const rule of state.rules) {
      items.push({
        id: `rec:obs-rule-${rule.id}`,
        type: "record",
        kind: "alert",
        name: rule.label,
        sub: `${rule.ruleKey} · above ${rule.threshold} in ${rule.windowMinutes} min`,
        tag: rule.enabled ? undefined : "off",
        area: "obs",
        run: () => openPeek("alert", String(rule.id)),
      });
    }
    for (const group of state.exceptions) {
      items.push({
        id: `rec:obs-exc-${group.fingerprint}`,
        type: "record",
        kind: "exception",
        name: group.errorName,
        sub: `${group.errorMessage} · ${exceptionWhere(group)}`,
        tag: group.status === "open" ? undefined : group.status,
        area: "obs",
        run: () => openPeek("exception", group.fingerprint),
      });
    }
    for (const incident of state.incidents) {
      items.push({
        id: `rec:obs-inc-${incident.id}`,
        type: "record",
        kind: "incident",
        name: incident.title,
        sub: `${incident.severity} · ${incident.status}`,
        area: "obs",
        run: () => openPeek("incident", String(incident.id)),
      });
    }
    for (const item of state.dlq) {
      items.push({
        id: `rec:obs-dlq-${item.dlqId}`,
        type: "record",
        kind: "dlq",
        name: item.eventType,
        sub: `${item.errorMessage} · ${item.attemptCount} attempts`,
        tag: item.replayable ? undefined : "no re-run",
        area: "obs",
        run: () => openPeek("dlq", item.dlqId),
      });
    }

    return items;
  },
});
