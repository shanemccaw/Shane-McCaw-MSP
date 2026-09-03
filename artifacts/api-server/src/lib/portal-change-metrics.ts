/**
 * portal-change-metrics.ts — Change Control KPIs (Git #1506): change success
 * rate, failed-change rate, emergency-change ratio, lead time, CAB throughput.
 *
 * These are the numbers an MSP sells the change-control program on. Every one
 * is a real aggregate over real rows — `cr_events` (#1503, the append-only
 * state-transition ledger), `cr_executions` (#1499), `cab_agenda_items` and
 * `cab_meetings` (#1501) — scoped to one (mspId, tenantId) pair, the same
 * scoping every other Change Control table in this codebase uses (see
 * `routes/portal-change-control.ts`'s header for why both predicates are
 * required together).
 *
 * ── Which vocabulary this reads (the issue body is superseded here) ─────────
 * #1506's own issue body says success/failure should read #1502's close codes
 * (`successful | successful_with_issues | failed | rolled_back`). #1502 is
 * still OPEN — no close-code column exists anywhere in the schema (verified
 * live: no `close_code` / `successful_with_issues` in `lib/db/src/schema/msp.ts`
 * and nothing under `lib/db/migrations/manual/` adds one). #1506's own
 * 2026-09-03 re-dispatch comment supersedes the stale body and is what this
 * module actually implements: a change's terminal outcome comes from
 * `cr_executions.outcome` (`succeeded | failed | rolled_back`) when an
 * execution row exists for it, and falls back to the CR's own `cr_events`
 * terminal event (`completed` | `rolled_back`) when it does not. `crEventsTable`
 * itself documents this exact pair of formulas — see its header in
 * `lib/db/src/schema/msp.ts`. If #1502 lands later and adds a real close-code
 * column, extend this file to prefer it; don't invent a second vocabulary here
 * in the meantime.
 *
 * ── Honesty rule ──────────────────────────────────────────────────────────────
 * A metric with no qualifying events is `available: false`, never `0` and never
 * rendered as a bad/red number by anything reading this wire shape. A tenant
 * with no change history has no success rate — that is not a 0% success rate.
 * Every metric carries its own sample size so a caller can tell a thin sample
 * from a real one.
 */

import {
  db,
  mspChangeRequestsTable,
  crEventsTable,
  crExecutionsTable,
  cabAgendaItemsTable,
  cabMeetingsTable,
  type CrEvent,
  type CrExecution,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

export interface ChangeMetricsScope {
  readonly mspId: number;
  readonly tenantId: string;
}

/** A ratio metric (0..1). `available` is false — and `rate`/counts meaningless — when the denominator is 0. */
export interface RateMetric {
  readonly available: boolean;
  readonly rate: number | null;
  readonly numerator: number;
  readonly denominator: number;
}

/** A duration metric in hours. `available` is false when no change qualifies. */
export interface DurationMetric {
  readonly available: boolean;
  readonly averageHours: number | null;
  readonly medianHours: number | null;
  readonly sampleSize: number;
}

export interface CabThroughputMetric {
  readonly available: boolean;
  readonly meetingsHeld: number;
  readonly itemsDecided: number;
  readonly itemsDeferred: number;
  readonly averageDecisionLatencyHours: number | null;
}

export interface ChangeMetrics {
  readonly changeSuccessRate: RateMetric;
  readonly failedChangeRate: RateMetric;
  readonly emergencyChangeRatio: RateMetric;
  readonly leadTime: DurationMetric;
  readonly cabThroughput: CabThroughputMetric;
}

const unavailableRate: RateMetric = { available: false, rate: null, numerator: 0, denominator: 0 };
const unavailableDuration: DurationMetric = { available: false, averageHours: null, medianHours: null, sampleSize: 0 };
const unavailableCabThroughput: CabThroughputMetric = {
  available: false,
  meetingsHeld: 0,
  itemsDecided: 0,
  itemsDeferred: 0,
  averageDecisionLatencyHours: null,
};

function rate(numerator: number, denominator: number): RateMetric {
  if (denominator <= 0) return unavailableRate;
  return { available: true, rate: numerator / denominator, numerator, denominator };
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Parses one of this table family's free-text-but-usually-ISO timestamp columns. Returns null rather than an invalid Date on anything unparseable — never a guessed instant. */
function parseRealInstant(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Computes every #1506 KPI for one (mspId, tenantId) scope. Pure aggregation —
 * no writes, no caching, no denormalised counters (per the issue's own
 * instruction: `cr_events` is the source of truth and a counter that can drift
 * from it is worse than no counter).
 */
export async function computeChangeMetrics(scope: ChangeMetricsScope): Promise<ChangeMetrics> {
  const crScope = and(eq(mspChangeRequestsTable.mspId, scope.mspId), eq(mspChangeRequestsTable.tenantId, scope.tenantId));

  const crs = await db
    .select({
      id: mspChangeRequestsTable.id,
      changeClass: mspChangeRequestsTable.changeClass,
      requestedAt: mspChangeRequestsTable.requestedAt,
      executedAt: mspChangeRequestsTable.executedAt,
    })
    .from(mspChangeRequestsTable)
    .where(crScope);

  if (crs.length === 0) {
    return {
      changeSuccessRate: unavailableRate,
      failedChangeRate: unavailableRate,
      emergencyChangeRatio: unavailableRate,
      leadTime: unavailableDuration,
      cabThroughput: unavailableCabThroughput,
    };
  }

  const crIds = crs.map((c) => c.id);
  const classById = new Map<number, string>(crs.map((c) => [c.id, c.changeClass]));

  const [events, executions, agendaItems] = await Promise.all([
    db.select().from(crEventsTable).where(inArray(crEventsTable.changeRequestId, crIds)),
    db.select().from(crExecutionsTable).where(inArray(crExecutionsTable.changeRequestId, crIds)),
    db
      .select()
      .from(cabAgendaItemsTable)
      .where(and(eq(cabAgendaItemsTable.mspId, scope.mspId), eq(cabAgendaItemsTable.tenantId, scope.tenantId))),
  ]);

  // ── Change success rate / failed change rate ────────────────────────────────
  // Per-CR terminal outcome: prefer the most recently-settled cr_executions row
  // (outcome != 'pending') when one exists; fall back to the CR's own latest
  // terminal cr_events row (`completed` | `rolled_back`) when it does not.
  const executionsByCr = new Map<number, CrExecution[]>();
  for (const e of executions) {
    if (e.outcome === "pending") continue;
    const list = executionsByCr.get(e.changeRequestId) ?? [];
    list.push(e);
    executionsByCr.set(e.changeRequestId, list);
  }
  const terminalEventsByCr = new Map<number, CrEvent[]>();
  for (const ev of events) {
    if (ev.eventType !== "completed" && ev.eventType !== "rolled_back") continue;
    const list = terminalEventsByCr.get(ev.changeRequestId) ?? [];
    list.push(ev);
    terminalEventsByCr.set(ev.changeRequestId, list);
  }

  let successCount = 0;
  let failureCount = 0;
  for (const crId of crIds) {
    const execs = executionsByCr.get(crId);
    if (execs && execs.length > 0) {
      const latest = [...execs].sort((a, b) => {
        const at = (a.executedAt ?? a.createdAt).getTime();
        const bt = (b.executedAt ?? b.createdAt).getTime();
        return bt - at;
      })[0];
      if (latest.outcome === "succeeded") successCount++;
      else if (latest.outcome === "failed" || latest.outcome === "rolled_back") failureCount++;
      continue;
    }
    const terminalEvents = terminalEventsByCr.get(crId);
    if (terminalEvents && terminalEvents.length > 0) {
      const latest = [...terminalEvents].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0];
      if (latest.eventType === "completed") successCount++;
      else if (latest.eventType === "rolled_back") failureCount++;
    }
    // Neither an execution nor a terminal event: this CR has not concluded — excluded from both counts.
  }
  const terminalCount = successCount + failureCount;
  const changeSuccessRate = rate(successCount, terminalCount);
  const failedChangeRate = rate(failureCount, terminalCount);

  // ── Emergency change ratio ───────────────────────────────────────────────────
  // Joins `raised` events back to the CR's own `changeClass`, per crEventsTable's
  // own header. One `raised` event per CR in the ordinary case; counting events
  // (not CR rows) is deliberate — it is what the schema comment specifies and
  // stays correct even if a CR is somehow re-raised.
  const raisedEvents = events.filter((e: CrEvent) => e.eventType === "raised");
  const emergencyRaisedCount = raisedEvents.filter((e) => classById.get(e.changeRequestId) === "emergency").length;
  const emergencyChangeRatio = rate(emergencyRaisedCount, raisedEvents.length);

  // ── Lead time: raise → implementation ────────────────────────────────────────
  // Reads `msp_change_requests.requestedAt`/`executedAt` directly (both real,
  // always-ISO text columns written at raise/execute time — see
  // `portal-change-control-raise.ts` and `msp-change-execution-store.ts`).
  // Deliberately NOT `scheduledFor`: that column is free text ("Awaiting
  // records sign-off"), not a real instant.
  const leadTimesHours: number[] = [];
  for (const cr of crs) {
    const requested = parseRealInstant(cr.requestedAt);
    const executed = parseRealInstant(cr.executedAt);
    if (!requested || !executed) continue;
    const hours = (executed.getTime() - requested.getTime()) / 3_600_000;
    if (hours >= 0) leadTimesHours.push(hours);
  }
  const leadTime: DurationMetric =
    leadTimesHours.length === 0
      ? unavailableDuration
      : { available: true, averageHours: mean(leadTimesHours), medianHours: median(leadTimesHours), sampleSize: leadTimesHours.length };

  // ── CAB throughput ────────────────────────────────────────────────────────────
  const decided = agendaItems.filter((i) => i.recommendation === "approve" || i.recommendation === "reject");
  const deferred = agendaItems.filter((i) => i.recommendation === "defer");
  const decisionLatenciesHours: number[] = [];
  for (const item of decided) {
    if (!item.decidedAt) continue;
    const hours = (item.decidedAt.getTime() - item.createdAt.getTime()) / 3_600_000;
    if (hours >= 0) decisionLatenciesHours.push(hours);
  }
  let meetingsHeld = 0;
  const meetingIds = [...new Set(agendaItems.map((i) => i.meetingId))];
  if (meetingIds.length > 0) {
    const meetings = await db
      .select({ id: cabMeetingsTable.id, status: cabMeetingsTable.status })
      .from(cabMeetingsTable)
      .where(inArray(cabMeetingsTable.id, meetingIds));
    meetingsHeld = meetings.filter((m) => m.status === "completed").length;
  }
  const cabThroughput: CabThroughputMetric =
    agendaItems.length === 0
      ? unavailableCabThroughput
      : {
          available: true,
          meetingsHeld,
          itemsDecided: decided.length,
          itemsDeferred: deferred.length,
          averageDecisionLatencyHours: decisionLatenciesHours.length > 0 ? mean(decisionLatenciesHours) : null,
        };

  return { changeSuccessRate, failedChangeRate, emergencyChangeRatio, leadTime, cabThroughput };
}
