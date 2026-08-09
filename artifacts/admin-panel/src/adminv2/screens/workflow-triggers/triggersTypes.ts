/**
 * Real shapes for the Workflow Triggers screen — the cross-definition view
 * over `wf_triggers` and its `wf_trigger_events` history.
 *
 * Workflow Builder (`screens/workflows/`) already has a per-definition
 * trigger editor, but only for one definition at a time — there was no
 * "every trigger, across every workflow" surface, and `admin-workflows.ts`
 * had no route to answer it either. This screen is that surface: a new
 * `GET /admin/workflows/triggers` route (added alongside this screen)
 * answers the list; everything else — enable/disable, config edits, delete,
 * test-fire, webhook token rotation, event history, 30-day stats — reuses
 * routes that already existed but that no screen had ever wired up.
 *
 * `TriggerType`/`TRIGGER_TYPES`/`whenShort`/`formatDuration` are NOT
 * redeclared here — imported straight from `../workflows/workflowTypes`,
 * the same source Workflow Builder's own trigger editor uses, so the two
 * screens can never silently disagree about what a trigger type is or how
 * "3 min ago" gets formatted.
 */

import { formatDuration, TRIGGER_TYPES, whenShort, type TriggerType } from "../workflows/workflowTypes";

export { TRIGGER_TYPES, whenShort, formatDuration };
export type { TriggerType };

export const EVENT_STATUSES = ["fired", "skipped", "error"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const STATUS_LABEL: Record<EventStatus, string> = {
  fired: "Fired",
  skipped: "Skipped",
  error: "Error",
};

/** One `wf_triggers` row, joined with its definition's name and its own latest event. */
export interface GlobalTriggerRow {
  id: number;
  definitionId: number;
  definitionName: string;
  type: TriggerType;
  config: Record<string, unknown>;
  webhookToken: string | null;
  nextRunAt: string | null;
  enabled: boolean;
  createdAt: string;
  lastFiredAt: string | null;
  lastStatus: EventStatus | null;
  eventCount: number;
}

/** One `wf_trigger_events` row. */
export interface TriggerEventRow {
  id: number;
  triggerId: number;
  runId: number | null;
  status: EventStatus;
  durationMs: number | null;
  errorMessage: string | null;
  payload: Record<string, unknown> | null;
  firedAt: string;
}

export interface TriggerStats {
  total: number;
  avgDurationMs: number | null;
  lastFiredAt: string | null;
  lastStatus: EventStatus | null;
  dailyBuckets: Array<{ day: string; total: number; fired: number; errors: number }>;
}

/** A workflow definition, just enough of it to power the "New trigger" picker. */
export interface DefinitionLite {
  id: number;
  name: string;
}

export function triggerConfigSummary(t: GlobalTriggerRow): string {
  if (t.type === "schedule") {
    const cron = typeof t.config.cron === "string" ? t.config.cron : "";
    return cron ? `cron ${cron}` : "no schedule set";
  }
  if (t.type === "event") {
    const eventName = typeof t.config.eventName === "string" ? t.config.eventName : "";
    return eventName ? eventName : "no event name set";
  }
  if (t.type === "webhook") return t.webhookToken ? "webhook" : "no token";
  return "fires from the Workflow Builder / palette";
}

/** Free-text match over what an operator would actually type. */
export function triggerMatches(t: GlobalTriggerRow, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return t.definitionName.toLowerCase().includes(q) || t.type.toLowerCase().includes(q) || triggerConfigSummary(t).toLowerCase().includes(q);
}
