/**
 * portal-runbooks.ts — Active Runbooks and their hold windows, customer-scoped.
 *
 *   GET  /api/portal/runbooks
 *   PUT  /api/portal/runbooks/:runbookId/steps/:position     — tick / untick
 *   POST /api/portal/runbooks/:runbookId/steps               — add a step
 *   POST /api/portal/hold-windows/:holdId/extend             — extend, with a reason
 *   POST /api/portal/hold-windows/:holdId/close-early        — close early  → raises a CR
 *   POST /api/portal/hold-windows/:holdId/release            — release      → raises a CR
 *   POST /api/portal/hold-windows/:holdId/prepare-cr         — draft the CR ahead of close
 *
 * ── Scoping ────────────────────────────────────────────────────────────────
 * Simpler than Change Control's, because these tables were built for the portal
 * rather than adapted from the MSP console: `customer_id` IS the JWT's
 * `customerId` claim, so there is nothing to resolve and one predicate is the
 * whole story. Every write re-reads the row with the customer predicate
 * included rather than trusting the id in the path — an id in a URL is a
 * request, not a permission.
 *
 * The one place the MSP-era shape is still needed is raising a change request,
 * because `msp_change_requests` predates the portal and is keyed on
 * `(msp_id, tenant_id)`. That resolution goes through `resolveTenantScope`,
 * shared with `portal-change-control.ts`.
 *
 * ── Why the hold actions write change requests ─────────────────────────────
 * The design's rule is that nothing changes in the tenant without a change
 * request, and it says so specifically about this page: closing a window early
 * "is a change to an approved runbook, so it raises a change request with the
 * scan evidence attached". In the prototype those four actions are `openForm`
 * calls that stop at a confirmation message. Here they write a real CR and
 * record the link in `portal_hold_window_events.change_request_id`, which is
 * what turns "every early close routes through a CR" from a claim into
 * something a query can check.
 *
 * `linked_finding` on the raised CR names the hold window it came from, which is
 * the column added alongside this page for exactly this purpose.
 *
 * ── What releasing does NOT do ─────────────────────────────────────────────
 * It does not execute anything against the tenant, and it does not tick the
 * gated step. It raises the change request that asks for the step to be
 * released, and it closes the window. Executing the step is the CR's job, after
 * approval — collapsing the two would be the portal quietly making a tenant
 * change on a button press, which is the exact thing the CR gate exists to
 * prevent.
 *
 * ── A runbook is a SCHEDULE; a cycle is a RUN (#1557) ───────────────────────
 * `:runbookId` in the URLs above always addresses the SCHEDULE
 * (`portal_runbooks`), never a specific cycle. Every route that touches steps
 * resolves the schedule's CURRENT cycle (`portal_runbook_runs`, highest
 * `cycleNumber`) internally via `currentRunFor`, so a caller never needs to
 * know a run id exists. Ticking every step in the current cycle marks that
 * cycle `complete` (who, when) via `maybeAdvanceCycle`, and — only if the
 * schedule is `recurring` — spawns the next cycle immediately with a cloned,
 * all-unchecked step list. A finished cycle is never mutated or deleted after
 * that: it stays as history (`runHistory` on the GET response), which is the
 * whole point — a reset used to silently overwrite the last cycle's
 * completion; now it can't.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  mspChangeRequestsTable,
  portalHoldWindowEventsTable,
  portalHoldWindowsTable,
  portalRunbookRunsTable,
  portalRunbookStepsTable,
  portalRunbooksTable,
} from "@workspace/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { requireRole } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { resolveCustomerId, resolveTenantScope } from "../lib/portal-customer-scope";
import {
  computeRiskLevel,
  deriveWorkload,
  categoryForWorkload,
  formatChangeRequestCode,
  storedChangeClass,
  storedRiskLevel,
} from "../lib/portal-change-control";
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
} from "../lib/portal-hold-windows";
import { cloneStepsForNextCycle, cycleProgress, isCycleComplete } from "../lib/portal-runbook-cycles";
import { personIdForUser } from "../lib/portal-ownership";
import { recordCrEvent } from "../lib/portal-change-timeline-store";
import { loadApprovalPolicy, materializeApprovalsForChange } from "../lib/portal-change-approvals-store";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

/** How many steps one runbook may hold. A guard against an accidental loop, not a product limit. */
const MAX_STEPS_PER_RUNBOOK = 200;

/**
 * `governance` → `Governance`. The pillar is stored as a lowercase key (one of
 * journeyTokens' six), but every customer-facing use of it in the design is
 * title-cased. Only the first letter is touched, so a key that is already
 * display-cased passes through unchanged.
 */
function titleCasePillar(pillar: string): string {
  if (!pillar) return pillar;
  return pillar.charAt(0).toUpperCase() + pillar.slice(1);
}

// ── Wire shapes ───────────────────────────────────────────────────────────────

interface WireStep {
  readonly position: number;
  readonly text: string;
  readonly checked: boolean;
  readonly isCustom: boolean;
  readonly checkedAt: string | null;
}

interface WireHoldWindow {
  readonly id: number;
  readonly holdKey: string;
  readonly title: string;
  readonly gates: string;
  readonly gatesStepPosition: number | null;
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
interface WireRunbookRunSummary {
  readonly id: number;
  readonly cycleNumber: number;
  readonly startedOn: string;
  readonly status: string;
  readonly completedAt: string | null;
  readonly checkedSteps: number;
  readonly totalSteps: number;
}

interface WireRunbook {
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

function isoOrNull(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

function toWireHold(
  row: typeof portalHoldWindowsTable.$inferSelect,
  now: Date,
): WireHoldWindow {
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

// ── Read ──────────────────────────────────────────────────────────────────────
router.get(
  "/portal/runbooks",
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      const now = new Date();

      const runbookRows = await db
        .select()
        .from(portalRunbooksTable)
        .where(eq(portalRunbooksTable.customerId, customerId))
        .orderBy(asc(portalRunbooksTable.id));

      if (runbookRows.length === 0) {
        res.json({ runbooks: [], holds: [], summary: emptySummary() });
        return;
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
        // An open window is the one that decorates its runbook; a closed one
        // stays in the list for the record but must not keep overriding the
        // runbook's status forever.
        if (h.runbookId !== null && !h.closedAt) holdByRunbook.set(h.runbookId, wire);
      }

      const runbooks: WireRunbook[] = runbookRows.map((r) => {
        const runs = runsByRunbook.get(r.id) ?? [];
        const currentRun = runs.length ? runs[runs.length - 1] : null;
        const historyRuns = runs.slice(0, -1).reverse();

        const steps = currentRun ? stepsByRun.get(currentRun.id) ?? [] : [];
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

      res.json({ runbooks, holds: allHolds, summary: summarise(allHolds) });
    } catch (err) {
      log.error({ err, customerId }, "GET /portal/runbooks failed");
      res.status(500).json({ error: "Failed to load runbooks" });
    }
  },
);

function emptySummary() {
  return { running: 0, closing: 0, due: 0, early: 0, openCount: 0, text: "No hold windows" };
}

/**
 * The panel's summary line (proto 7140-7143). Closed windows are excluded from
 * every count: the line answers "what is waiting on you", and a window that has
 * been decided is not.
 */
function summarise(holds: readonly WireHoldWindow[]) {
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

// ── Ownership helpers ─────────────────────────────────────────────────────────
//
// Both re-read with the customer predicate rather than trusting the path id.

async function ownedRunbook(customerId: number, runbookId: number) {
  const [row] = await db
    .select()
    .from(portalRunbooksTable)
    .where(and(eq(portalRunbooksTable.id, runbookId), eq(portalRunbooksTable.customerId, customerId)))
    .limit(1);
  return row ?? null;
}

async function ownedHold(customerId: number, holdId: number) {
  const [row] = await db
    .select()
    .from(portalHoldWindowsTable)
    .where(and(eq(portalHoldWindowsTable.id, holdId), eq(portalHoldWindowsTable.customerId, customerId)))
    .limit(1);
  return row ?? null;
}

/**
 * The CURRENT cycle of a schedule the caller already owns — the highest
 * `cycleNumber` row, whatever its status. Every write in this file (tick a
 * step, add a step) acts on this cycle, never on history (#1557).
 */
async function currentRunFor(runbookId: number) {
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
async function maybeAdvanceCycle(opts: {
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

// ── Tick / untick a step ──────────────────────────────────────────────────────
const putStepSchema = z.object({ checked: z.boolean() });

router.put(
  "/portal/runbooks/:runbookId/steps/:position",
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    const runbookId = Number.parseInt(String(req.params.runbookId), 10);
    const position = Number.parseInt(String(req.params.position), 10);
    if (!Number.isFinite(runbookId) || !Number.isFinite(position)) {
      res.status(400).json({ error: "Invalid runbook or step" });
      return;
    }

    const parsed = putStepSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
      return;
    }

    try {
      const runbook = await ownedRunbook(customerId, runbookId);
      // 404, not 403: a runbook belonging to someone else must be
      // indistinguishable from one that does not exist.
      if (!runbook) {
        res.status(404).json({ error: "Runbook not found" });
        return;
      }

      const run = await currentRunFor(runbookId);
      if (!run) {
        res.status(404).json({ error: "This runbook has no active cycle" });
        return;
      }

      const { checked } = parsed.data;
      const now = new Date();
      const userId = typeof req.user?.id === "number" ? req.user.id : null;

      // Un-ticking clears the timestamp rather than leaving a stale one claiming
      // a completion that was withdrawn — the rule portal-remediation-tracker.ts
      // established for the same kind of customer-asserted tick. Scoped to the
      // CURRENT cycle's steps (#1557) — a step position is only unique per run.
      const result = await db
        .update(portalRunbookStepsTable)
        .set({
          checked,
          checkedAt: checked ? now : null,
          checkedByUserId: userId,
          updatedAt: now,
        })
        .where(
          and(
            eq(portalRunbookStepsTable.runId, run.id),
            eq(portalRunbookStepsTable.position, position),
          ),
        )
        .returning({ id: portalRunbookStepsTable.id });

      if (result.length === 0) {
        res.status(404).json({ error: "Step not found" });
        return;
      }

      if (checked) {
        await maybeAdvanceCycle({ runbook, run, userId, now });
      }

      log.info({ customerId, runbookId, runId: run.id, position, checked, userId }, "runbook step toggled");
      res.json({ ok: true, position, checked });
    } catch (err) {
      log.error({ err, customerId, runbookId, position }, "PUT /portal/runbooks step failed");
      res.status(500).json({ error: "Failed to save the step" });
    }
  },
);

// ── Add a custom step ─────────────────────────────────────────────────────────
const addStepSchema = z.object({ text: z.string().trim().min(1).max(500) });

router.post(
  "/portal/runbooks/:runbookId/steps",
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    const runbookId = Number.parseInt(String(req.params.runbookId), 10);
    if (!Number.isFinite(runbookId)) {
      res.status(400).json({ error: "Invalid runbook" });
      return;
    }

    const parsed = addStepSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
      return;
    }

    try {
      const runbook = await ownedRunbook(customerId, runbookId);
      if (!runbook) {
        res.status(404).json({ error: "Runbook not found" });
        return;
      }

      const run = await currentRunFor(runbookId);
      if (!run) {
        res.status(404).json({ error: "This runbook has no active cycle" });
        return;
      }

      const [{ maxPosition, stepCount }] = await db
        .select({
          maxPosition: sql<number>`coalesce(max(${portalRunbookStepsTable.position}), 0)`,
          stepCount: sql<number>`count(*)`,
        })
        .from(portalRunbookStepsTable)
        .where(eq(portalRunbookStepsTable.runId, run.id));

      if (Number(stepCount) >= MAX_STEPS_PER_RUNBOOK) {
        res.status(409).json({ error: "This runbook already has the maximum number of steps" });
        return;
      }

      const position = Number(maxPosition) + 1;
      await db.insert(portalRunbookStepsTable).values({
        runId: run.id,
        position,
        text: parsed.data.text,
        checked: false,
        // The customer's own note, not part of the agreed procedure. Carries
        // forward into every future cycle once this one completes (#1557).
        isCustom: true,
      });

      log.info({ customerId, runbookId, runId: run.id, position }, "custom runbook step added");
      res.status(201).json({ position, text: parsed.data.text });
    } catch (err) {
      log.error({ err, customerId, runbookId }, "POST /portal/runbooks steps failed");
      res.status(500).json({ error: "Failed to add the step" });
    }
  },
);

// ── Hold window: extend ───────────────────────────────────────────────────────
//
// A reason is REQUIRED, and that is the design's own point: "Extending is
// recorded with a reason, so a window that keeps moving is visible rather than
// quietly permanent."
const extendSchema = z.object({
  days: z.number().int().min(1).max(90),
  reason: z.string().trim().min(1).max(2000),
});

router.post(
  "/portal/hold-windows/:holdId/extend",
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    const holdId = Number.parseInt(String(req.params.holdId), 10);
    const parsed = extendSchema.safeParse(req.body);
    if (!Number.isFinite(holdId) || !parsed.success) {
      res.status(400).json({
        error: parsed.success ? "Invalid hold window" : parsed.error.issues.map((i) => i.message).join("; "),
      });
      return;
    }

    try {
      const hold = await ownedHold(customerId, holdId);
      if (!hold) {
        res.status(404).json({ error: "Hold window not found" });
        return;
      }
      if (hold.closedAt) {
        res.status(409).json({ error: "This window has already closed" });
        return;
      }

      const now = new Date();
      const userId = typeof req.user?.id === "number" ? req.user.id : null;

      // `waitDays` is never rewritten — the agreed wait stays visible next to
      // the accumulated extension.
      await db
        .update(portalHoldWindowsTable)
        .set({
          extendedDays: hold.extendedDays + parsed.data.days,
          // A moved deadline invalidates the alerts already sent about the old
          // one: T-24 and T-0 must fire again for the new close moment.
          notifiedT24At: null,
          notifiedT0At: null,
          updatedAt: now,
        })
        .where(eq(portalHoldWindowsTable.id, holdId));

      await db.insert(portalHoldWindowEventsTable).values({
        holdWindowId: holdId,
        kind: "extended",
        daysDelta: parsed.data.days,
        reason: parsed.data.reason,
        actorUserId: userId,
      });

      log.info({ customerId, holdId, days: parsed.data.days, userId }, "hold window extended");
      res.status(201).json({ extendedDays: hold.extendedDays + parsed.data.days });
    } catch (err) {
      log.error({ err, customerId, holdId }, "POST /portal/hold-windows extend failed");
      res.status(500).json({ error: "Failed to extend the window" });
    }
  },
);

// ── Hold window: the three CR-raising decisions ───────────────────────────────

const decisionSchema = z.object({
  /** Free text the customer added in the form. Optional — the CR body is composed either way. */
  note: z.string().trim().max(2000).optional(),
  /** The chosen route, for `release`: as written, excluding what the scan flagged, etc. */
  route: z.string().trim().max(200).optional(),
  window: z.string().trim().max(200).optional(),
});

type HoldDecision = "close_early" | "release" | "prepare_cr";

/**
 * Raises the change request for a hold-window decision and records the link.
 *
 * The CR's target and payload describe the RUNBOOK STEP being released, not a
 * Graph call, because that is what is actually being asked for — the gated step
 * has its own execution path once approved. Risk is computed by the same
 * server-side rule every other CR uses.
 */
async function raiseHoldChangeRequest(opts: {
  req: Request;
  customerId: number;
  hold: typeof portalHoldWindowsTable.$inferSelect;
  runbookTitle: string | null;
  decision: HoldDecision;
  body: z.infer<typeof decisionSchema>;
  now: Date;
}): Promise<{ id: number; code: string } | { error: string; status: number }> {
  const scope = await resolveTenantScope(opts.customerId);
  if (!scope) {
    return {
      status: 409,
      error: "This account has no connected Microsoft 365 tenant to raise a change against",
    };
  }

  const d = deriveHoldWindow(
    {
      startedAt: opts.hold.startedAt,
      waitDays: opts.hold.waitDays,
      extendedDays: opts.hold.extendedDays,
      scanVerdict: opts.hold.scanVerdict,
    },
    opts.now,
  );

  const title =
    opts.decision === "close_early"
      ? `Close hold window ${d.daysSaved} day${d.daysSaved === 1 ? "" : "s"} early — ${opts.hold.title}`
      : opts.decision === "release"
        ? `Release the step gated by — ${opts.hold.title}`
        : `Prepared ahead of close — ${opts.hold.title}`;

  // The description carries the evidence, which is the whole argument for the
  // decision: the design says the scan evidence is attached to the CR.
  const description = [
    opts.hold.gates,
    `Scan verdict at the time of the decision: ${opts.hold.scanVerdict}. ${opts.hold.scanLine}`,
    opts.body.route ? `Chosen route: ${opts.body.route}` : null,
    opts.body.note ? `Note: ${opts.body.note}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const target = opts.hold.gatesStepPosition
    ? `Runbook ${opts.runbookTitle ?? ""} · step ${opts.hold.gatesStepPosition}`.trim()
    : `Runbook ${opts.runbookTitle ?? opts.hold.title}`.trim();

  const risk = computeRiskLevel({
    changeClass: "Normal",
    targetResource: target,
    impactedUsersCount: 0,
  });
  const workload = deriveWorkload(target);

  const [inserted] = await db
    .insert(mspChangeRequestsTable)
    .values({
      mspId: scope.mspId,
      tenantId: scope.tenantId,
      tenantName: scope.tenantName,
      primaryDomain: scope.primaryDomain,
      title,
      description,
      changeClass: storedChangeClass("Normal"),
      riskLevel: storedRiskLevel(risk),
      category: categoryForWorkload(workload),
      targetResource: target,
      psaTicketId: "No ticket reference",
      requestedBy: opts.req.user?.email ?? "unknown",
      requestedAt: opts.now.toISOString(),
      scheduledFor: opts.body.window?.trim() || "Awaiting approval — no window booked",
      impactedUsersCount: 0,
      status: "pending_approval",
      // Nothing has executed, so nothing has been backed up.
      backupVerified: false,
      backupHash: "",
      preChangeSnapshot: {
        holdKey: opts.hold.holdKey,
        waitDays: opts.hold.waitDays,
        extendedDays: opts.hold.extendedDays,
        closesAt: d.closesAt.toISOString(),
        scanVerdict: opts.hold.scanVerdict,
      },
      proposedPayload: {
        decision: opts.decision,
        daysSaved: opts.decision === "close_early" ? d.daysSaved : 0,
        route: opts.body.route ?? null,
      },
      rollbackScriptSnippet: "",
      // The column added with this page — "Raised from", pointing at the window.
      // Title-cased: the pillar is stored as a lowercase key (`governance`) but
      // the design writes this cell as "Governance · External Sharing Drift",
      // and a customer reading their own register should not see the internal
      // casing of a database column.
      linkedFinding: `${titleCasePillar(opts.hold.pillar)} · ${opts.hold.title}`,
    })
    .returning({ id: mspChangeRequestsTable.id, createdAt: mspChangeRequestsTable.createdAt });

  // #1503 — every CR-creation path emits the `raised` event that opens its timeline.
  await recordCrEvent({
    changeRequestId: inserted.id,
    mspId: scope.mspId,
    tenantId: scope.tenantId,
    eventType: "raised",
    fromValue: null,
    toValue: "pending_approval",
    actorRole: "customer",
    actorPersonId: opts.req.user ? personIdForUser(opts.req.user.id) : null,
    actorName: opts.req.user?.email ?? null,
    occurredAt: opts.now,
  });

  // #1775 — the hold-window CR raise is the other door that never called
  // `materializeApprovalsForChange` (#1496): a CR raised from a hold-window
  // decision had zero `cr_approvals` rows, same gap as the MSP console door.
  // Non-fatal: the CR already exists either way.
  try {
    const policy = await loadApprovalPolicy(opts.customerId);
    await materializeApprovalsForChange(
      {
        id: inserted.id,
        mspId: scope.mspId,
        tenantId: scope.tenantId,
        changeClass: storedChangeClass("Normal"),
        riskLevel: storedRiskLevel(risk),
        status: "pending_approval",
        approvedBy: null,
        requestedBy: opts.req.user?.email ?? "unknown",
        createdAt: inserted.createdAt,
      },
      policy,
    );
  } catch (err) {
    log.error({ err, crId: inserted.id }, "hold-window change request created but approval materialisation failed");
  }

  return { id: inserted.id, code: formatChangeRequestCode(inserted.id) };
}

function decisionRoute(decision: HoldDecision, path: string) {
  router.post(
    path,
    requireRole("Assessment"),
    async (req: Request, res: Response): Promise<void> => {
      const customerId = resolveCustomerId(req);
      if (customerId === null) {
        res.status(403).json({ error: "No customer identity on token" });
        return;
      }

      const holdId = Number.parseInt(String(req.params.holdId), 10);
      const parsed = decisionSchema.safeParse(req.body ?? {});
      if (!Number.isFinite(holdId) || !parsed.success) {
        res.status(400).json({
          error: parsed.success ? "Invalid hold window" : parsed.error.issues.map((i) => i.message).join("; "),
        });
        return;
      }

      try {
        const hold = await ownedHold(customerId, holdId);
        if (!hold) {
          res.status(404).json({ error: "Hold window not found" });
          return;
        }
        if (hold.closedAt) {
          res.status(409).json({ error: "This window has already closed" });
          return;
        }

        const now = new Date();

        // Closing early is only meaningful while there is time left to save.
        // Guarding here as well as in the UI, because the UI is not the gate.
        if (decision === "close_early") {
          const d = deriveHoldWindow(
            {
              startedAt: hold.startedAt,
              waitDays: hold.waitDays,
              extendedDays: hold.extendedDays,
              scanVerdict: hold.scanVerdict,
            },
            now,
          );
          if (d.state !== "early") {
            res.status(409).json({
              error:
                "This window cannot be closed early — either the scan is not clear or there is less than a day left to save",
            });
            return;
          }
        }

        const runbook = hold.runbookId ? await ownedRunbook(customerId, hold.runbookId) : null;

        const cr = await raiseHoldChangeRequest({
          req,
          customerId,
          hold,
          runbookTitle: runbook?.title ?? null,
          decision,
          body: parsed.data,
          now,
        });
        if ("error" in cr) {
          res.status(cr.status).json({ error: cr.error });
          return;
        }

        await db.insert(portalHoldWindowEventsTable).values({
          holdWindowId: holdId,
          kind: decision === "close_early" ? "closed_early" : decision === "release" ? "released" : "cr_prepared",
          reason: parsed.data.note ?? null,
          actorUserId: typeof req.user?.id === "number" ? req.user.id : null,
          changeRequestId: cr.id,
        });

        // Preparing a CR ahead of close does NOT close the window — that is the
        // whole point of the action: the paperwork is ready and the wait
        // continues. The other two do close it.
        if (decision !== "prepare_cr") {
          await db
            .update(portalHoldWindowsTable)
            .set({
              closedAt: now,
              closedReason: decision === "close_early" ? "Closed early on clear scan evidence" : "Released at T-0",
              updatedAt: now,
            })
            .where(eq(portalHoldWindowsTable.id, holdId));
        }

        log.info({ customerId, holdId, decision, code: cr.code }, "hold window decision raised a change request");
        res.status(201).json({ changeRequestCode: cr.code, decision });
      } catch (err) {
        log.error({ err, customerId, holdId, decision }, "hold window decision failed");
        res.status(500).json({ error: "Failed to record the decision" });
      }
    },
  );
}

decisionRoute("close_early", "/portal/hold-windows/:holdId/close-early");
decisionRoute("release", "/portal/hold-windows/:holdId/release");
decisionRoute("prepare_cr", "/portal/hold-windows/:holdId/prepare-cr");

/** The decisions taken on one window — the audit trail, customer-scoped. */
router.get(
  "/portal/hold-windows/:holdId/events",
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    const holdId = Number.parseInt(String(req.params.holdId), 10);
    if (!Number.isFinite(holdId)) {
      res.status(400).json({ error: "Invalid hold window" });
      return;
    }

    try {
      const hold = await ownedHold(customerId, holdId);
      if (!hold) {
        res.status(404).json({ error: "Hold window not found" });
        return;
      }

      const rows = await db
        .select()
        .from(portalHoldWindowEventsTable)
        .where(eq(portalHoldWindowEventsTable.holdWindowId, holdId))
        .orderBy(desc(portalHoldWindowEventsTable.id));

      res.json({
        events: rows.map((e) => ({
          kind: e.kind,
          daysDelta: e.daysDelta,
          reason: e.reason,
          changeRequestCode: e.changeRequestId ? formatChangeRequestCode(e.changeRequestId) : null,
          createdAt: e.createdAt.toISOString(),
        })),
      });
    } catch (err) {
      log.error({ err, customerId, holdId }, "GET /portal/hold-windows events failed");
      res.status(500).json({ error: "Failed to load the window's history" });
    }
  },
);

export default router;
