/**
 * portal-runbook-wire.ts — the runbook wire shapes and customer-scoped
 * read/ownership/mutation helpers, shared between the customer-facing
 * `/portal/runbooks` routes (portal-runbooks.ts) and the MSP-operator
 * `/msp/runbooks` routes (msp-runbooks.ts, #2669).
 *
 * Extracted verbatim out of portal-runbooks.ts rather than reimplemented: an
 * MSP operator viewing or acting on a customer's runbooks must see exactly
 * the same derived state (status label precedence, hold decoration, run
 * history) the customer sees on their own page, and a step tick or hold
 * extension taken from the MSP console must run the exact same cycle-advance
 * and audit-trail side effects a customer-initiated one does. A second
 * hand-copied implementation would drift from this one the first time either
 * is touched.
 *
 * Every helper here is scoped by `customerId` (tenants.id), never by mspId —
 * that is `portal_runbooks`' own key, matching remediation_tracker_steps and
 * every other portal-era table (see portal-customer-scope.ts's header). The
 * caller is responsible for establishing that the customerId it passes in is
 * one the caller is actually allowed to act for: `resolveCustomerId(req)` for
 * the portal (the JWT's own claim, nothing to check), or
 * `customerBelongsToMsp(customerId, mspId)` for the MSP console (#2669).
 */

import {
  db,
  portalHoldWindowsTable,
  portalRunbookRunsTable,
  portalRunbookStepsTable,
  portalRunbooksTable,
} from "@workspace/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";

import {
  deriveHoldWindow,
  dueHoldNotifications,
  holdBadge,
  holdDayTicks,
  holdPrimaryAction,
  holdScanLabel,
  holdScanProvenance,
  holdScanTone,
  holdTMinus,
  runbookStatusFromHold,
} from "./portal-hold-windows";
import { cloneStepsForNextCycle, cycleProgress, isCycleComplete } from "./portal-runbook-cycles";
import { logger } from "./logger";

const log = logger.child({ channel: "tenant.portal" });

// ── Wire shapes ───────────────────────────────────────────────────────────────

export interface WireStep {
  readonly position: number;
  readonly text: string;
  readonly checked: boolean;
  readonly isCustom: boolean;
  readonly checkedAt: string | null;
}

export interface WireHoldWindow {
  readonly id: number;
  readonly holdKey: string;
  readonly title: string;
  readonly gates: string;
  readonly gatesStepPosition: number | null;
  /** The cycle this window gates (#1940). Null for a legacy window raised before the column existed. */
  readonly runId: number | null;
  readonly pillar: string;
  readonly why: string;
  readonly state: string;
  readonly tone: string;
  readonly badge: string;
  readonly tMinus: string;
  readonly daysLeft: number;
  readonly daysSaved: number;
  readonly hoursLeft: number;
  readonly totalDays: number;
  readonly waitDays: number;
  readonly extendedDays: number;
  readonly startedAt: string;
  readonly closesAt: string;
  readonly closedAt: string | null;
  readonly ticks: ReadonlyArray<"done" | "partial" | "todo">;
  readonly scanVerdict: string;
  readonly scanLabel: string;
  readonly scanTone: string;
  readonly scanLine: string;
  readonly scanProvenance: string;
  readonly primaryAction: { readonly kind: string; readonly label: string };
  /** Which of the README's three alerts this window currently owes. */
  readonly notificationsDue: readonly string[];
}

/** A past cycle's own record — history only, no step detail. */
export interface WireRunbookRunSummary {
  readonly id: number;
  readonly cycleNumber: number;
  readonly startedOn: string;
  readonly status: string;
  readonly completedAt: string | null;
  readonly checkedSteps: number;
  readonly totalSteps: number;
}

export interface WireRunbook {
  readonly id: number;
  readonly runbookKey: string;
  readonly title: string;
  readonly context: string;
  readonly pillar: string;
  /** Whether finishing the current cycle spawns the next one automatically (#1557). */
  readonly recurring: boolean;
  /** The id of the cycle whose steps are below — null if this schedule somehow has no run yet. */
  readonly currentRunId: number | null;
  readonly cycleNumber: number;
  /** The CURRENT cycle's start — moved off the schedule itself in #1557. */
  readonly startedOn: string | null;
  readonly cycleDays: number;
  readonly daysElapsed: number;
  readonly daysLeft: number;
  readonly checkedSteps: number;
  readonly totalSteps: number;
  readonly pct: number;
  readonly statusLabel: string;
  /** The current cycle's steps. */
  readonly steps: readonly WireStep[];
  readonly hold: WireHoldWindow | null;
  /** Past cycles, newest first — the run history #1557 exists to stop erasing. */
  readonly runHistory: readonly WireRunbookRunSummary[];
}

export interface RunbooksSummary {
  readonly running: number;
  readonly closing: number;
  readonly due: number;
  readonly early: number;
  readonly openCount: number;
  readonly text: string;
}

export function isoOrNull(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

export function toWireHold(row: typeof portalHoldWindowsTable.$inferSelect, now: Date): WireHoldWindow {
  const input = {
    startedAt: row.startedAt,
    waitDays: row.waitDays,
    extendedDays: row.extendedDays,
    scanVerdict: row.scanVerdict,
    closedAt: row.closedAt,
  };
  const d = deriveHoldWindow(input, now);
  return {
    id: row.id,
    holdKey: row.holdKey,
    title: row.title,
    gates: row.gates,
    gatesStepPosition: row.gatesStepPosition,
    runId: row.runId,
    pillar: row.pillar,
    why: row.why,
    state: d.state,
    tone: d.tone,
    badge: holdBadge(input, now),
    tMinus: holdTMinus(input, now),
    daysLeft: d.daysLeft,
    daysSaved: d.daysSaved,
    hoursLeft: d.hoursLeft,
    totalDays: d.totalDays,
    waitDays: row.waitDays,
    extendedDays: row.extendedDays,
    startedAt: row.startedAt.toISOString(),
    closesAt: d.closesAt.toISOString(),
    closedAt: isoOrNull(row.closedAt),
    ticks: holdDayTicks(input, now),
    scanVerdict: row.scanVerdict,
    scanLabel: holdScanLabel(row.scanVerdict),
    scanTone: holdScanTone(row.scanVerdict),
    scanLine: row.scanLine,
    scanProvenance: holdScanProvenance({
      scanSource: row.scanSource,
      scanCadence: row.scanCadence,
      scanAt: row.scanAt,
    }),
    primaryAction: holdPrimaryAction(input, now),
    notificationsDue: dueHoldNotifications(
      {
        ...input,
        notifiedT24At: row.notifiedT24At,
        notifiedT0At: row.notifiedT0At,
        notifiedEarlyClearAt: row.notifiedEarlyClearAt,
      },
      now,
    ),
  };
}

export function emptySummary(): RunbooksSummary {
  return { running: 0, closing: 0, due: 0, early: 0, openCount: 0, text: "No hold windows" };
}

/**
 * The panel's summary line (proto 7140-7143). Closed windows are excluded from
 * every count: the line answers "what is waiting on you", and a window that has
 * been decided is not.
 */
export function summarise(holds: readonly WireHoldWindow[]): RunbooksSummary {
  const open = holds.filter((h) => h.closedAt === null);
  const count = (s: string) => open.filter((h) => h.state === s).length;
  const due = count("due");
  const closing = count("closing");
  const early = count("early");

  const parts = [`${open.length} running`];
  if (due) parts.push(`${due} decision due`);
  if (closing) parts.push(`${closing} closing within 24h`);
  if (early) parts.push(`${early} clear to close early`);

  return {
    running: count("running"),
    closing,
    due,
    early,
    openCount: open.length,
    text: open.length === 0 ? "No hold windows" : parts.join(" · "),
  };
}

/**
 * The full customer-scoped read: every runbook, its current cycle's steps,
 * its decorating hold (if any), and its run history — exactly what
 * `GET /portal/runbooks` renders. `customerId` is trusted; the caller has
 * already established ownership (JWT claim for the portal, an explicit
 * MSP-book check for the MSP console).
 */
export async function loadRunbooksForCustomer(
  customerId: number,
): Promise<{ runbooks: WireRunbook[]; holds: WireHoldWindow[]; summary: RunbooksSummary }> {
  const now = new Date();

  const runbookRows = await db
    .select()
    .from(portalRunbooksTable)
    .where(eq(portalRunbooksTable.customerId, customerId))
    .orderBy(asc(portalRunbooksTable.id));

  if (runbookRows.length === 0) {
    return { runbooks: [], holds: [], summary: emptySummary() };
  }

  const runbookIds = runbookRows.map((r) => r.id);

  // Three queries rather than N+1: every cycle, every step (across every
  // cycle) and every hold for these runbooks, grouped in memory. A tenant's
  // whole Operate page is still one round trip's worth of data — #1557
  // added a query, not an N+1.
  const runRows = await db
    .select()
    .from(portalRunbookRunsTable)
    .where(
      sql`${portalRunbookRunsTable.runbookId} IN (${sql.join(
        runbookIds.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    )
    .orderBy(asc(portalRunbookRunsTable.runbookId), asc(portalRunbookRunsTable.cycleNumber));

  const runIds = runRows.map((r) => r.id);
  const stepRows = runIds.length
    ? await db
        .select()
        .from(portalRunbookStepsTable)
        .where(
          sql`${portalRunbookStepsTable.runId} IN (${sql.join(
            runIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        )
        .orderBy(asc(portalRunbookStepsTable.runId), asc(portalRunbookStepsTable.position))
    : [];

  // Holds are read by CUSTOMER, not by runbook id, so a window whose runbook
  // link is null still belongs to its tenant and still appears.
  const holdRows = await db
    .select()
    .from(portalHoldWindowsTable)
    .where(eq(portalHoldWindowsTable.customerId, customerId))
    .orderBy(asc(portalHoldWindowsTable.id));

  const stepsByRun = new Map<number, WireStep[]>();
  for (const s of stepRows) {
    const list = stepsByRun.get(s.runId) ?? [];
    list.push({
      position: s.position,
      text: s.text,
      checked: s.checked,
      isCustom: s.isCustom,
      checkedAt: isoOrNull(s.checkedAt),
    });
    stepsByRun.set(s.runId, list);
  }

  // Runs arrived ordered by (runbookId, cycleNumber) ascending, so the last
  // entry per runbook is the current cycle and everything before it is
  // history — no extra sort needed.
  const runsByRunbook = new Map<number, (typeof runRows)[number][]>();
  for (const run of runRows) {
    const list = runsByRunbook.get(run.runbookId) ?? [];
    list.push(run);
    runsByRunbook.set(run.runbookId, list);
  }

  const holdByRunbook = new Map<number, WireHoldWindow>();
  const allHolds: WireHoldWindow[] = [];
  for (const h of holdRows) {
    const wire = toWireHold(h, now);
    allHolds.push(wire);
    if (h.runbookId === null || h.closedAt) continue;

    // #1940 — a window carrying a runId only decorates the runbook when it
    // gates that runbook's CURRENT cycle, not just any cycle of it. A
    // recurring runbook's cycle 1 hold must not be read as still gating
    // cycle 2's identically-numbered step once cycle 2 has spawned.
    // A window with no runId (raised before this column existed, or
    // before #1557) falls back to the pre-#1940 behavior of decorating
    // whichever runbook it names, matching legacy rows.
    const currentRun = (runsByRunbook.get(h.runbookId) ?? []).slice(-1)[0];
    if (h.runId !== null && (!currentRun || h.runId !== currentRun.id)) continue;

    // An open window is the one that decorates its runbook; a closed one
    // stays in the list for the record but must not keep overriding the
    // runbook's status forever.
    holdByRunbook.set(h.runbookId, wire);
  }

  const runbooks: WireRunbook[] = runbookRows.map((r) => {
    const runs = runsByRunbook.get(r.id) ?? [];
    const currentRun = runs.length ? runs[runs.length - 1] : null;
    const historyRuns = runs.slice(0, -1).reverse();

    const steps = currentRun ? (stepsByRun.get(currentRun.id) ?? []) : [];
    const totalSteps = steps.length;
    const checkedSteps = steps.filter((s) => s.checked).length;
    const pct = totalSteps ? Math.round((checkedSteps / totalSteps) * 100) : 0;
    const complete = currentRun?.status === "complete" || isCycleComplete(steps);
    const progress = currentRun
      ? cycleProgress(currentRun.startedOn, r.cycleDays, now, complete)
      : { daysElapsed: 0, daysLeft: r.cycleDays, overdue: false };
    const hold = holdByRunbook.get(r.id) ?? null;

    // The design's precedence (proto 16866): complete wins, then an open
    // hold window, then overdue, then on track. A held runbook reads as held
    // even when it is also past its cycle, because the hold is the reason.
    const statusLabel = complete
      ? "Complete"
      : hold
        ? runbookStatusFromHold(hold.state as "running" | "closing" | "due" | "early")
        : progress.overdue
          ? "Overdue"
          : "On track";

    const runHistory: WireRunbookRunSummary[] = historyRuns.map((run) => {
      const runSteps = stepsByRun.get(run.id) ?? [];
      return {
        id: run.id,
        cycleNumber: run.cycleNumber,
        startedOn: run.startedOn,
        status: run.status,
        completedAt: isoOrNull(run.completedAt),
        checkedSteps: runSteps.filter((s) => s.checked).length,
        totalSteps: runSteps.length,
      };
    });

    return {
      id: r.id,
      runbookKey: r.runbookKey,
      title: r.title,
      context: r.context,
      pillar: r.pillar,
      recurring: r.recurring,
      currentRunId: currentRun?.id ?? null,
      cycleNumber: currentRun?.cycleNumber ?? 1,
      startedOn: currentRun?.startedOn ?? null,
      cycleDays: r.cycleDays,
      daysElapsed: progress.daysElapsed,
      daysLeft: progress.daysLeft,
      checkedSteps,
      totalSteps,
      pct,
      statusLabel,
      steps,
      hold,
      runHistory,
    };
  });

  return { runbooks, holds: allHolds, summary: summarise(allHolds) };
}

// ── Ownership helpers ─────────────────────────────────────────────────────────
//
// Both re-read with the customer predicate rather than trusting the path id.

export async function ownedRunbook(customerId: number, runbookId: number) {
  const [row] = await db
    .select()
    .from(portalRunbooksTable)
    .where(and(eq(portalRunbooksTable.id, runbookId), eq(portalRunbooksTable.customerId, customerId)))
    .limit(1);
  return row ?? null;
}

export async function ownedHold(customerId: number, holdId: number) {
  const [row] = await db
    .select()
    .from(portalHoldWindowsTable)
    .where(and(eq(portalHoldWindowsTable.id, holdId), eq(portalHoldWindowsTable.customerId, customerId)))
    .limit(1);
  return row ?? null;
}

/**
 * The CURRENT cycle of a schedule the caller already owns — the highest
 * `cycleNumber` row, whatever its status. Every write path (tick a step, add
 * a step) acts on this cycle, never on history (#1557).
 */
export async function currentRunFor(runbookId: number) {
  const [row] = await db
    .select()
    .from(portalRunbookRunsTable)
    .where(eq(portalRunbookRunsTable.runbookId, runbookId))
    .orderBy(desc(portalRunbookRunsTable.cycleNumber))
    .limit(1);
  return row ?? null;
}

/**
 * Runs the completion side-effects of a step check (#1557): once every step in
 * the current cycle is checked, that cycle is marked complete (who, when), and
 * — only if the schedule is `recurring` — the NEXT cycle is spawned immediately
 * with a cloned, all-unchecked step list. A non-recurring schedule (e.g. the
 * Overshared SharePoint site-fix runbooks) just stays complete; nothing spawns.
 */
export async function maybeAdvanceCycle(opts: {
  runbook: typeof portalRunbooksTable.$inferSelect;
  run: typeof portalRunbookRunsTable.$inferSelect;
  userId: number | null;
  now: Date;
}): Promise<void> {
  const { runbook, run, userId, now } = opts;
  if (run.status === "complete") return;

  const steps = await db
    .select()
    .from(portalRunbookStepsTable)
    .where(eq(portalRunbookStepsTable.runId, run.id))
    .orderBy(asc(portalRunbookStepsTable.position));

  if (!isCycleComplete(steps)) return;

  await db
    .update(portalRunbookRunsTable)
    .set({ status: "complete", completedAt: now, completedByUserId: userId, updatedAt: now })
    .where(eq(portalRunbookRunsTable.id, run.id));

  if (!runbook.recurring) return;

  const [nextRun] = await db
    .insert(portalRunbookRunsTable)
    .values({
      runbookId: runbook.id,
      customerId: runbook.customerId,
      cycleNumber: run.cycleNumber + 1,
      startedOn: now.toISOString().slice(0, 10),
      status: "active",
    })
    .returning({ id: portalRunbookRunsTable.id });

  const nextSteps = cloneStepsForNextCycle(steps).map((s) => ({ ...s, runId: nextRun.id }));
  await db.insert(portalRunbookStepsTable).values(nextSteps);

  log.info(
    { runbookId: runbook.id, completedRunId: run.id, nextRunId: nextRun.id, cycleNumber: run.cycleNumber + 1 },
    "runbook cycle completed — recurring schedule spawned its next cycle",
  );
}
