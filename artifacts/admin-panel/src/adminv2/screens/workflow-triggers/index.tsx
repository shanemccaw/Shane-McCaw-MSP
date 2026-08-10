/**
 * Workflow Triggers — the cross-definition view over `wf_triggers` Workflow
 * Builder's own per-definition trigger editor (`screens/workflows/
 * WorkflowProperties.tsx`) never had: every trigger, across every workflow,
 * in one place, with the event history/stats/test-fire/webhook-rotation
 * routes `admin-workflows.ts` already exposed but no screen had ever wired
 * up. Rebuilt inside `SHELL.md`'s `registerScreen` contract; one new
 * read-only route (`GET /admin/workflows/triggers`) added alongside this
 * screen — see `triggersTypes.ts`'s doc comment.
 *
 * ## Intent audit (`SHELL.md` section 1)
 *
 * The Home tab only opens the triggers gallery or creates a new trigger. The
 * Watch tab only opens the "trigger errors" gallery. Every action that needs
 * one specific trigger open (test-fire, enable/disable, rotate its webhook
 * token, jump to its workflow) is on the contextual tab, `intent: "record"`.
 */

import { useEffect } from "react";
import { AlertTriangle, KeyRound, Plus, Power, RefreshCw, Workflow as WorkflowIcon, Zap } from "lucide-react";
import { ACCENT } from "../../theme";
import { registerScreen } from "../../registry/registry";
import { getShellApi } from "../../shell/ShellContext";
import type { CommandItem, GallerySpec, PeekModel } from "../../registry/types";
import { WorkflowTriggersBody } from "./WorkflowTriggersBody";
import { WorkflowTriggersExplorer } from "./WorkflowTriggersExplorer";
import { WorkflowTriggersProperties } from "./WorkflowTriggersProperties";
import {
  createTriggerInteractive,
  erroredTriggers,
  getSnapshot,
  patchTriggerConfig,
  refreshAll,
  removeTrigger,
  RIBBON_KEYS,
  rotateTokenNow,
  selectTrigger,
  testFireNow,
  toggleTriggerEnabled,
  triggerById,
} from "./triggersStore";
import { STATUS_LABEL, triggerConfigSummary, whenShort, type GlobalTriggerRow } from "./triggersTypes";

const AREA = "workflows";
const ROUTE = "/triggers";

function go() {
  return () => getShellApi()?.navigate(ROUTE);
}

function openTriggerPeek(id: number) {
  return () => getShellApi()?.openPeek("trigger", String(id));
}

function openTriggerDoc(id: number) {
  return () => getShellApi()?.openDoc({ kind: "trigger", id: String(id), screenId: "workflow-triggers" });
}

function newTrigger(): void {
  void createTriggerInteractive().then((created) => {
    if (created) openTriggerDoc(created.id)();
  });
}

// ── Galleries ────────────────────────────────────────────────────────────────

const triggersGallery: GallerySpec = {
  id: "triggers-all",
  title: "Triggers",
  searchable: true,
  searchPlaceholder: "Type to narrow it down",
  get rows() {
    const state = getSnapshot();
    return state.triggers.map((t) => ({
      id: String(t.id),
      group: t.enabled ? "Enabled" : "Disabled",
      tile: t.type.slice(0, 3).toUpperCase(),
      name: t.definitionName,
      head: t.lastStatus ? STATUS_LABEL[t.lastStatus] : "never fired",
      sub: `${triggerConfigSummary(t)} — last fired ${whenShort(t.lastFiredAt)}`,
      on: state.selectedTriggerId === t.id,
      onSelect: openTriggerPeek(t.id),
    }));
  },
  footer: { label: "New trigger", onSelect: newTrigger },
};

const errorsGallery: GallerySpec = {
  id: "triggers-errors",
  title: "Trigger errors",
  get rows() {
    return erroredTriggers().map((t) => ({
      id: String(t.id),
      tile: t.type.slice(0, 3).toUpperCase(),
      name: t.definitionName,
      head: "last fire failed",
      sub: `${triggerConfigSummary(t)} — ${whenShort(t.lastFiredAt)}`,
      onSelect: openTriggerPeek(t.id),
    }));
  },
  footer: { label: "Open Workflow Triggers", onSelect: go() },
};

// ── Peek ─────────────────────────────────────────────────────────────────────

function triggerPeek(id: string): PeekModel | null {
  const state = getSnapshot();
  const t = triggerById(id, state);
  if (!t) return null;

  const tone = t.lastStatus === "error" ? ACCENT.danger : t.enabled ? ACCENT.info : undefined;

  return {
    kind: "trigger",
    eyebrow: "TRIGGER",
    title: t.definitionName,
    sub: `${t.type} — ${triggerConfigSummary(t)}`,
    icon: Zap,
    tone,
    tag: t.enabled ? "enabled" : "disabled",
    tagTone: t.enabled ? ACCENT.green : undefined,
    facts: [
      { label: "Last fired", value: whenShort(t.lastFiredAt), color: t.lastStatus === "error" ? ACCENT.danger : undefined },
      { label: "Total fires", value: String(t.eventCount) },
    ],
    edits:
      t.type === "schedule"
        ? [{ key: "cron", label: "Cron", value: typeof t.config.cron === "string" ? t.config.cron : "", mono: true, onChange: (v) => void patchConfig(t, "cron", v) }]
        : t.type === "event"
          ? [{ key: "eventName", label: "Event name", value: typeof t.config.eventName === "string" ? t.config.eventName : "", mono: true, onChange: (v) => void patchConfig(t, "eventName", v) }]
          : undefined,
    body: t.type === "webhook" ? { title: "Webhook URL", content: `/api/webhooks/workflow/${t.webhookToken ?? "—"}` } : undefined,
    open: openTriggerDoc(t.id),
    openLabel: "Open the trigger",
    actions: [
      { label: "Test fire", tone: "primary", onSelect: () => void testFireNow(t) },
      ...(t.type === "webhook" ? [{ label: "Rotate token", onSelect: () => void rotateTokenNow(t) }] : []),
      { label: "Delete", tone: "danger", confirm: true, onSelect: () => void removeTrigger(t) },
    ],
  };
}

function patchConfig(t: GlobalTriggerRow, key: string, value: string): void {
  void patchTriggerConfig(t, { ...t.config, [key]: value });
}

// ── The screen ───────────────────────────────────────────────────────────────

function WorkflowTriggersScreen({ kind, recordId }: { kind?: string; recordId?: string }) {
  useEffect(() => {
    if (kind === "trigger" && recordId) {
      void selectTrigger(Number(recordId));
    } else {
      void selectTrigger(null);
    }
  }, [kind, recordId]);
  return <WorkflowTriggersBody />;
}

registerScreen({
  id: "workflow-triggers",
  title: "Workflow Triggers",
  area: AREA,
  icon: Zap,
  route: ROUTE,
  render: (ctx) => <WorkflowTriggersScreen kind={ctx.kind} recordId={ctx.recordId} />,

  left: { title: "Triggers", render: () => <WorkflowTriggersExplorer /> },
  right: { title: "Properties", render: () => <WorkflowTriggersProperties /> },

  ribbon: [
    {
      tab: "automation",
      order: 20,
      group: {
        label: "Triggers",
        large: [
          {
            label: "All triggers",
            icon: Zap,
            intent: "open",
            title: "Every trigger, across every workflow — schedule, event, webhook and manual",
            liveKey: RIBBON_KEYS.triggersCount,
            onSelect: go(),
            gallery: triggersGallery,
          },
        ],
        small: [
          { label: "New trigger", icon: Plus, intent: "create", onSelect: newTrigger },
          { label: "Refresh", icon: RefreshCw, intent: "global", onSelect: () => void refreshAll() },
        ],
      },
    },
    {
      tab: "watch",
      order: 40,
      group: {
        label: "Broken",
        small: [
          {
            label: "Trigger errors",
            icon: AlertTriangle,
            intent: "open",
            color: ACCENT.danger,
            title: "Triggers whose most recent fire ended in an error",
            liveKey: RIBBON_KEYS.errorsWatch,
            onSelect: go(),
            gallery: errorsGallery,
          },
        ],
      },
    },
  ],

  contextualTab: (ctx) => {
    if (ctx.kind !== "trigger" || !ctx.recordId) return null;
    const t = triggerById(ctx.recordId);
    if (!t) return null;
    return {
      id: "trigger-tools",
      label: "Trigger Tools",
      groups: [
        {
          label: "This trigger",
          large: [{ label: "Test fire", icon: Zap, intent: "record", onSelect: () => void testFireNow(t) }],
          small: [
            { label: t.enabled ? "Disable" : "Enable", icon: Power, intent: "record", onSelect: () => void toggleTriggerEnabled(t, !t.enabled) },
            { label: "Open its workflow", icon: WorkflowIcon, intent: "record", onSelect: () => getShellApi()?.openDoc({ kind: "workflow", id: String(t.definitionId), screenId: "workflows" }) },
            ...(t.type === "webhook" ? [{ label: "Rotate token", icon: KeyRound, intent: "record" as const, onSelect: () => void rotateTokenNow(t) }] : []),
          ],
        },
      ],
    };
  },

  peeks: {
    trigger: triggerPeek,
  },

  commands: () => {
    const state = getSnapshot();
    const items: CommandItem[] = [
      { id: "act:triggers-new", type: "action", kind: "run", name: "New trigger", sub: "Pick a workflow and a trigger type", area: AREA, run: newTrigger },
      { id: "act:triggers-refresh", type: "action", kind: "run", name: "Refresh triggers", sub: "Re-reads every trigger and its latest fire", area: AREA, run: () => void refreshAll() },
    ];

    for (const t of state.triggers) {
      items.push({
        id: `rec:trigger-${t.id}`,
        type: "record",
        kind: "trigger",
        name: `${t.definitionName} — ${t.type}`,
        sub: triggerConfigSummary(t),
        tag: t.lastStatus === "error" ? "last fire failed" : t.enabled ? undefined : "disabled",
        area: AREA,
        run: openTriggerPeek(t.id),
      });
    }

    const errored = erroredTriggers(state);
    if (errored.length > 0) {
      items.push({
        id: "ans:triggers-errors",
        type: "answer",
        name: "Triggers whose last fire errored",
        sub: "Worth a look before it fires again",
        area: AREA,
        live: String(errored.length),
        run: go(),
      });
    }

    return items;
  },
});
