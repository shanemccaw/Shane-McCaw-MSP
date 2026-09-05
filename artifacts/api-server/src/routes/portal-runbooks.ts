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
 *
 * ── A hold window gates a CYCLE too, not just a runbook (#1940) ────────────
 * `portal_hold_windows` predates #1557 and was left keyed on `runbookId` +
 * `gatesStepPosition` alone. Since step `position` restarts at 1 per cycle,
 * that pair is ambiguous the moment a recurring runbook spawns a second
 * cycle — "step 4" could be cycle 1's step 4 or cycle 2's. `runId` (added
 * with this fix) resolves that: a window only decorates its runbook's status
 * on GET when its `runId` matches that runbook's CURRENT cycle. A window
 * with no `runId` (raised before this column existed) falls back to the old
 * behavior of decorating whichever runbook it names, for legacy rows.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  mspChangeRequestsTable,
  portalHoldWindowEventsTable,
  portalHoldWindowsTable,
  portalRunbookStepsTable,
} from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { requireRole } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { resolveCustomerId, resolveTenantScope } from "../lib/portal-customer-scope";
import { requireTierFeature, PORTAL_TIER_MODULE_KEYS } from "../lib/portal-tier-features";
import {
  computeRiskLevel,
  deriveWorkload,
  categoryForWorkload,
  formatChangeRequestCode,
  storedChangeClass,
  storedRiskLevel,
} from "../lib/portal-change-control";
import { deriveHoldWindow } from "../lib/portal-hold-windows";
import {
  currentRunFor,
  loadRunbooksForCustomer,
  maybeAdvanceCycle,
  ownedHold,
  ownedRunbook,
} from "../lib/portal-runbook-wire";
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

// ── Read ──────────────────────────────────────────────────────────────────────
// Wire shapes, the full customer-scoped read, and the ownership/cycle-advance
// helpers used across this file all live in portal-runbook-wire.ts, shared
// with the MSP-console routes (msp-runbooks.ts, #2669).
router.get(
  "/portal/runbooks",
  requireRole("Assessment"),
  // #1168: Config Pack execution itself stays unconditional; only this READ
  // checks the tier bundles Runbooks (an Assessment-tier login has no active
  // Monitoring subscription, so this fails closed to empty automatically).
  requireTierFeature(PORTAL_TIER_MODULE_KEYS.runbooks),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      const payload = await loadRunbooksForCustomer(customerId);
      res.json(payload);
    } catch (err) {
      log.error({ err, customerId }, "GET /portal/runbooks failed");
      res.status(500).json({ error: "Failed to load runbooks" });
    }
  },
);

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
      // #1505 — the real FK backing the free text above.
      linkedHoldWindowId: opts.hold.id,
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
  requireTierFeature(PORTAL_TIER_MODULE_KEYS.runbooks),
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
