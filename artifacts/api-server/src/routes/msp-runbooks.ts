/**
 * msp-runbooks.ts — MSP-console operator view of a customer's Active Runbooks
 * and their hold windows (#2669, part of #1683).
 *
 *   GET  /api/msp/runbooks                              — a customer's runbooks + run history
 *   PUT  /api/msp/runbooks/:runbookId/steps/:position    — mark a step complete on a live run
 *   POST /api/msp/hold-windows/:holdId/extend            — extend a hold window, with a reason
 *   GET  /api/msp/hold-windows/:holdId/events            — a hold window's decision audit trail
 *
 * ── Real, confirmed gap this closes ──────────────────────────────────────────
 * Before this file, zero MSP-side routes touched `portal_runbooks` /
 * `portal_runbook_runs` — only `admin-testbed.ts` (test seeding) and
 * `index.ts` (router registration) referenced the tables at all. No MSP
 * operator could view or manage a customer's runbooks.
 *
 * ── Scope of THIS file ────────────────────────────────────────────────────────
 * #1683 (Feature: Runbooks MSP Console) is explicitly marked NOT ARCHITECTED
 * for the full operator surface — authoring a runbook's definition, reordering
 * its steps, and recording a run's outcome are all real future work, but are
 * not invented here. Of the actions #1683 itself names ("Author the runbook
 * definition · manage step order · mark a step complete on a live run ·
 * extend a hold window · record the run outcome"), the two that already have
 * a real, proven implementation to mirror — marking a step complete, and
 * extending a hold window — are what #2669 asks for and what this file
 * builds. Both routes below run the *exact* same logic the customer-facing
 * `/portal/runbooks` routes do (portal-runbook-wire.ts), just under an
 * MSP-book ownership check instead of the JWT's own `customerId` claim.
 *
 * The three CR-raising hold-window decisions (close-early / release /
 * prepare-cr) are deliberately NOT mirrored here: those are the CUSTOMER's
 * own decision about their own tenant's change ("this is a change to an
 * approved runbook, so it raises a change request" — portal-runbooks.ts's own
 * header) and #1683 does not name them as an operator action. Giving MSP
 * staff a button that unilaterally closes a customer's hold window and raises
 * a CR on their behalf is a real product decision, not a missing route.
 *
 * ── Scoping ────────────────────────────────────────────────────────────────
 * `portal_runbooks` / `portal_hold_windows` are keyed on `customer_id`
 * (tenants.id), with no `mspId` column of their own — the same shape every
 * portal-era table uses (see portal-customer-scope.ts's header). An MSP
 * caller therefore always supplies the target `customerId` explicitly (query
 * param on GET, body field on PUT/POST), and every route resolves the
 * caller's own `mspId` via `resolveMspIdStrict` and verifies that customerId
 * is actually in that MSP's book via `customerBelongsToMsp` — the same
 * `requireRole("MSPOperator")` + `resolveMspIdStrict` + MSP-ownership-check
 * pattern every other MSP-scoped route in this repo uses (e.g.
 * msp-vip-classifications.ts). Once that check passes, the underlying
 * customer-scoped ownership queries (`ownedRunbook` / `ownedHold` /
 * `currentRunFor`) are exactly the ones portal-runbooks.ts uses — an id in
 * the path or body is still a request, not a permission, re-read with the
 * customer predicate either way.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, portalHoldWindowEventsTable, portalHoldWindowsTable, portalRunbookStepsTable, tenantsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { resolveMspIdStrict } from "../lib/resolve-msp-id";
import { apiError, ApiErrorCode } from "../lib/api-helpers";
import { logger } from "../lib/logger";
import { formatChangeRequestCode } from "../lib/portal-change-control";
import { currentRunFor, loadRunbooksForCustomer, maybeAdvanceCycle, ownedHold, ownedRunbook } from "../lib/portal-runbook-wire";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

/** True only if `customerId` is a real tenant owned by `mspId`. */
async function customerBelongsToMsp(customerId: number, mspId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: tenantsTable.id })
    .from(tenantsTable)
    .where(and(eq(tenantsTable.id, customerId), eq(tenantsTable.mspId, mspId)))
    .limit(1);
  return !!row;
}

/** Parses `customerId` out of query or body and validates it as a positive int. Does NOT check MSP ownership. */
function parseCustomerId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ── Read — a customer's runbooks + run history ──────────────────────────────
router.get(
  "/msp/runbooks",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "MSP context required");
        return;
      }

      const customerId = parseCustomerId(req.query.customerId);
      if (customerId === null) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "customerId is required");
        return;
      }
      if (!(await customerBelongsToMsp(customerId, mspId))) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "That customer is not in this MSP's book");
        return;
      }

      const payload = await loadRunbooksForCustomer(customerId);
      res.json(payload);
    } catch (err) {
      log.error({ err }, "GET /api/msp/runbooks failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

// ── Mark a step complete on a live run ──────────────────────────────────────
// Mirrors PUT /portal/runbooks/:runbookId/steps/:position exactly — same
// ownership re-read, same current-cycle resolution, same cycle-advance
// side-effect on completion — just MSP-book scoped instead of JWT-scoped.
const putStepSchema = z.object({
  customerId: z.number().int().positive(),
  checked: z.boolean(),
});

router.put(
  "/msp/runbooks/:runbookId/steps/:position",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "MSP context required");
        return;
      }

      const runbookId = Number.parseInt(String(req.params.runbookId), 10);
      const position = Number.parseInt(String(req.params.position), 10);
      if (!Number.isFinite(runbookId) || !Number.isFinite(position)) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid runbook or step");
        return;
      }

      const parsed = putStepSchema.safeParse(req.body);
      if (!parsed.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid request", parsed.error.flatten());
        return;
      }
      const { customerId, checked } = parsed.data;

      if (!(await customerBelongsToMsp(customerId, mspId))) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "That customer is not in this MSP's book");
        return;
      }

      const runbook = await ownedRunbook(customerId, runbookId);
      // 404, not 403: a runbook belonging to a different customer must be
      // indistinguishable from one that does not exist.
      if (!runbook) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "Runbook not found");
        return;
      }

      const run = await currentRunFor(runbookId);
      if (!run) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "This runbook has no active cycle");
        return;
      }

      const now = new Date();
      const userId = typeof req.user?.id === "number" ? req.user.id : null;

      // Un-ticking clears the timestamp rather than leaving a stale one
      // claiming a completion that was withdrawn — same rule the customer
      // route follows. Scoped to the CURRENT cycle's steps (#1557).
      const result = await db
        .update(portalRunbookStepsTable)
        .set({
          checked,
          checkedAt: checked ? now : null,
          checkedByUserId: userId,
          updatedAt: now,
        })
        .where(and(eq(portalRunbookStepsTable.runId, run.id), eq(portalRunbookStepsTable.position, position)))
        .returning({ id: portalRunbookStepsTable.id });

      if (result.length === 0) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "Step not found");
        return;
      }

      if (checked) {
        await maybeAdvanceCycle({ runbook, run, userId, now });
      }

      log.info({ mspId, customerId, runbookId, runId: run.id, position, checked, userId }, "runbook step toggled from MSP console");
      res.json({ ok: true, position, checked });
    } catch (err) {
      log.error({ err }, "PUT /api/msp/runbooks steps failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

// ── Hold window: extend ─────────────────────────────────────────────────────
// Mirrors POST /portal/hold-windows/:holdId/extend exactly — a reason is
// still required, for the same reason: "a window that keeps moving is
// visible rather than quietly permanent."
const extendSchema = z.object({
  customerId: z.number().int().positive(),
  days: z.number().int().min(1).max(90),
  reason: z.string().trim().min(1).max(2000),
});

router.post(
  "/msp/hold-windows/:holdId/extend",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "MSP context required");
        return;
      }

      const holdId = Number.parseInt(String(req.params.holdId), 10);
      const parsed = extendSchema.safeParse(req.body);
      if (!Number.isFinite(holdId) || !parsed.success) {
        apiError(
          res,
          400,
          ApiErrorCode.VALIDATION,
          !parsed.success ? parsed.error.issues.map((i) => i.message).join("; ") : "Invalid hold window",
        );
        return;
      }
      const { customerId, days, reason } = parsed.data;

      if (!(await customerBelongsToMsp(customerId, mspId))) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "That customer is not in this MSP's book");
        return;
      }

      const hold = await ownedHold(customerId, holdId);
      if (!hold) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "Hold window not found");
        return;
      }
      if (hold.closedAt) {
        apiError(res, 409, ApiErrorCode.CONFLICT, "This window has already closed");
        return;
      }

      const now = new Date();
      const userId = typeof req.user?.id === "number" ? req.user.id : null;

      // `waitDays` is never rewritten — the agreed wait stays visible next to
      // the accumulated extension.
      await db
        .update(portalHoldWindowsTable)
        .set({
          extendedDays: hold.extendedDays + days,
          // A moved deadline invalidates the alerts already sent about the
          // old one: T-24 and T-0 must fire again for the new close moment.
          notifiedT24At: null,
          notifiedT0At: null,
          updatedAt: now,
        })
        .where(eq(portalHoldWindowsTable.id, holdId));

      await db.insert(portalHoldWindowEventsTable).values({
        holdWindowId: holdId,
        kind: "extended",
        daysDelta: days,
        reason,
        actorUserId: userId,
      });

      log.info({ mspId, customerId, holdId, days, userId }, "hold window extended from MSP console");
      res.status(201).json({ extendedDays: hold.extendedDays + days });
    } catch (err) {
      log.error({ err }, "POST /api/msp/hold-windows extend failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

// ── Hold window: decision audit trail ───────────────────────────────────────
router.get(
  "/msp/hold-windows/:holdId/events",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "MSP context required");
        return;
      }

      const holdId = Number.parseInt(String(req.params.holdId), 10);
      const customerId = parseCustomerId(req.query.customerId);
      if (!Number.isFinite(holdId) || customerId === null) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "customerId and a valid hold window are required");
        return;
      }
      if (!(await customerBelongsToMsp(customerId, mspId))) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "That customer is not in this MSP's book");
        return;
      }

      const hold = await ownedHold(customerId, holdId);
      if (!hold) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "Hold window not found");
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
      log.error({ err }, "GET /api/msp/hold-windows events failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

export default router;
