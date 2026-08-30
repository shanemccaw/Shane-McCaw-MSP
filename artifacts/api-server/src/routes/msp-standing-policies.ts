/**
 * msp-standing-policies.ts — MSP-side authoring and governance of the Policy
 * Engine's declarative object (#1547, #1550).
 *
 *   GET  /api/msp/standing-policies            — this MSP's standing policies
 *   POST /api/msp/standing-policies            — author a new standing policy (always born inactive)
 *   POST /api/msp/standing-policies/:id/activate   — #1550: the governed act, MSPAdmin
 *   POST /api/msp/standing-policies/:id/deactivate — stops future enactments cold, MSPAdmin
 *
 * ── What a standing policy is ────────────────────────────────────────────────
 * DECLARATIVE and operationally live: it states a target state; it cites no
 * obligation, follows no finding, and requires no signature. It is the SECOND
 * object of the Policy Engine and is deliberately NOT a row on
 * msp_risk_decisions (the register of reactive, obligation-bound, SIGNED
 * deviation decisions). #1547 establishes exactly that separation, which the
 * rest of the engine (#1548-#1553) depends on.
 *
 * The target-state declaration does two jobs from ONE map: forward (what an SOP
 * drives toward when provisioning, #1548 — the engine never executes directly)
 * and backward (what a check compares against to find a member out of state,
 * #1553). It binds to an OU (active_directory_ous) — the container is the
 * attachment point; membership determines what applies.
 *
 * ── Scope of THIS route ──────────────────────────────────────────────────────
 * Read + author + the #1550 governed activation lifecycle. Continuous
 * evaluation (#1549) and the actual per-enactment CR-raising mechanism
 * (`lib/policy-enactment.ts`, invoked from the SOP run route, #1548/#1550)
 * are separate builds; this route ends at the wire contract.
 *
 * ── #1550: activation is a governed act, not a settings toggle ──────────────
 * "A policy IS a standard change catalog item" — approving the policy IS
 * approving the `change_catalog_items` row it is bound to (#1498's own signed,
 * dated, revocable decision), never a second parallel approval object on this
 * table. A new policy is always born inactive (`isActive` is not settable at
 * creation, below): the ONLY way to `isActive = true` is `POST /:id/activate`,
 * floored at `MSPAdmin` — the same bar #1498's catalog-item approve/revoke use
 * — and it live-checks (never cached) that `catalogItemId` is set AND that
 * item's `status` is currently `'approved'` before flipping the flag. Every
 * enactment (`raisePolicyEnactmentChangeRequest`) re-checks the same thing
 * live at CR-raise time, so revoking the bound catalog item stops future
 * enactments cold even if nobody remembers to deactivate the policy itself.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  standingPoliciesTable,
  activeDirectoryOusTable,
  changeCatalogItemsTable,
  STANDING_POLICY_TARGET_KIND,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { resolveMspIdStrict } from "../lib/resolve-msp-id";
import { personIdForUser } from "../lib/portal-ownership";
import { apiError, ApiErrorCode } from "../lib/api-helpers";
import { logger } from "../lib/logger";
import { toWireStandingPolicy, evaluatePolicyEnactmentGate } from "../lib/standing-policies";

const log = logger.child({ channel: "workflow.change-control" });

const router: IRouter = Router();

/** The identity a newly-authored policy is stamped with. Never "the system". */
function actorIdentity(req: Request): { personId: string; name: string } {
  const user = req.user!;
  return {
    personId: personIdForUser(user.id),
    name: (user.email ?? "").trim() || `User ${user.id}`,
  };
}

// ── List ────────────────────────────────────────────────────────────────────
router.get(
  "/msp/standing-policies",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "MSP context required");
        return;
      }

      const rows = await db
        .select()
        .from(standingPoliciesTable)
        .where(eq(standingPoliciesTable.mspId, mspId))
        .orderBy(desc(standingPoliciesTable.id));

      res.json({ policies: rows.map(toWireStandingPolicy) });
    } catch (err: unknown) {
      log.error({ err }, "GET /api/msp/standing-policies failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

// ── Author ──────────────────────────────────────────────────────────────────
const createSchema = z.object({
  ouId: z.number().int().positive(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000).optional(),
  targetKind: z.enum(STANDING_POLICY_TARGET_KIND),
  // The declaration itself — a container -> target-state map. Object only; never
  // a primitive, never money. Defaults to an empty declaration.
  targetState: z.record(z.string(), z.unknown()).optional(),
  // #1550: bind to a pre-approved catalog item. Optional; scoped to this MSP below.
  catalogItemId: z.number().int().positive().optional(),
  // #1550: NOT settable here — a new policy is always born inactive. isActive
  // only ever flips true via the governed POST /:id/activate below, which
  // live-checks the bound catalog item is actually approved. Accepting a
  // client-supplied `true` at creation would be exactly the "settings toggle"
  // #1550 exists to rule out, so the field is intentionally absent from this
  // schema rather than accepted-and-ignored.
});

router.post(
  "/msp/standing-policies",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "MSP context required");
        return;
      }

      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid standing policy", parsed.error.flatten());
        return;
      }

      // The OU is the attachment point — it must be a real container.
      const [ou] = await db
        .select({ id: activeDirectoryOusTable.id })
        .from(activeDirectoryOusTable)
        .where(eq(activeDirectoryOusTable.id, parsed.data.ouId))
        .limit(1);
      if (!ou) {
        apiError(res, 400, ApiErrorCode.VALIDATION, `Organizational unit '${parsed.data.ouId}' does not exist`);
        return;
      }

      // If a catalog item is named (#1550), it must be this MSP's own — the
      // approval a forward enactment inherits cannot point across MSP boundaries.
      if (parsed.data.catalogItemId !== undefined) {
        const [item] = await db
          .select({ id: changeCatalogItemsTable.id })
          .from(changeCatalogItemsTable)
          .where(and(eq(changeCatalogItemsTable.id, parsed.data.catalogItemId), eq(changeCatalogItemsTable.mspId, mspId)))
          .limit(1);
        if (!item) {
          apiError(res, 400, ApiErrorCode.VALIDATION, `Catalog item '${parsed.data.catalogItemId}' does not exist for this MSP`);
          return;
        }
      }

      const actor = actorIdentity(req);
      const [inserted] = await db
        .insert(standingPoliciesTable)
        .values({
          mspId,
          ouId: parsed.data.ouId,
          title: parsed.data.title,
          description: parsed.data.description ?? "",
          targetKind: parsed.data.targetKind,
          targetState: parsed.data.targetState ?? {},
          catalogItemId: parsed.data.catalogItemId ?? null,
          isActive: false,
          createdByPersonId: actor.personId,
          createdByName: actor.name,
        })
        .returning();

      log.info({ mspId, standingPolicyId: inserted.id, ouId: inserted.ouId, targetKind: inserted.targetKind }, "standing policy authored");
      res.status(201).json(toWireStandingPolicy(inserted));
    } catch (err: unknown) {
      log.error({ err }, "POST /api/msp/standing-policies failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

/** Loads a standing policy scoped to the caller's own MSP — the cross-MSP guard both mutations below share. */
async function loadScopedPolicy(id: number, mspId: number) {
  const [row] = await db
    .select()
    .from(standingPoliciesTable)
    .where(and(eq(standingPoliciesTable.id, id), eq(standingPoliciesTable.mspId, mspId)))
    .limit(1);
  return row ?? null;
}

function parseIdParam(res: Response, raw: string): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid standing policy id");
    return null;
  }
  return id;
}

// ── Activate — the governed act (#1550) ──────────────────────────────────────
//
// Floored at MSPAdmin, not MSPOperator: flipping this on is what lets
// `raisePolicyEnactmentChangeRequest` treat every future enactment as
// auto-approved, so it deliberately takes the same higher bar #1498's
// catalog-item approve/revoke use. Live-checks the bound catalog item's
// status — never a value cached at authoring time.
router.post(
  "/msp/standing-policies/:id/activate",
  requireAuth,
  requireRole("MSPAdmin"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "MSP context required");
        return;
      }
      const id = parseIdParam(res, String(req.params.id));
      if (id === null) return;

      const policy = await loadScopedPolicy(id, mspId);
      if (!policy) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "Standing policy not found");
        return;
      }
      if (policy.isActive) {
        apiError(res, 409, ApiErrorCode.CONFLICT, "Standing policy is already active");
        return;
      }

      const item =
        policy.catalogItemId === null
          ? null
          : (
              await db
                .select({ status: changeCatalogItemsTable.status })
                .from(changeCatalogItemsTable)
                .where(and(eq(changeCatalogItemsTable.id, policy.catalogItemId), eq(changeCatalogItemsTable.mspId, mspId)))
                .limit(1)
            )[0] ?? null;

      // Same pure rule `lib/policy-enactment.ts` re-checks live at every
      // enactment — evaluated here with `isActive: true` to ask "if this
      // policy WERE active right now, would it pass the gate?", since the
      // not-already-active precondition above is this route's own to enforce.
      const gate = evaluatePolicyEnactmentGate({
        isActive: true,
        catalogItemId: policy.catalogItemId,
        catalogItemStatus: item?.status ?? null,
      });
      if (!gate.ok) {
        apiError(res, 409, ApiErrorCode.CONFLICT, `Cannot activate — ${gate.reason}`);
        return;
      }

      const actor = actorIdentity(req);
      const [updated] = await db
        .update(standingPoliciesTable)
        .set({ isActive: true, updatedAt: new Date() })
        .where(eq(standingPoliciesTable.id, id))
        .returning();

      log.info({ mspId, standingPolicyId: id, activatedBy: actor.name, catalogItemId: policy.catalogItemId }, "standing policy activated");
      res.json(toWireStandingPolicy(updated));
    } catch (err: unknown) {
      log.error({ err }, "POST /api/msp/standing-policies/:id/activate failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

// ── Deactivate — stops future enactments cold ────────────────────────────────
router.post(
  "/msp/standing-policies/:id/deactivate",
  requireAuth,
  requireRole("MSPAdmin"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "MSP context required");
        return;
      }
      const id = parseIdParam(res, String(req.params.id));
      if (id === null) return;

      const policy = await loadScopedPolicy(id, mspId);
      if (!policy) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "Standing policy not found");
        return;
      }
      if (!policy.isActive) {
        apiError(res, 409, ApiErrorCode.CONFLICT, "Standing policy is already inactive");
        return;
      }

      const actor = actorIdentity(req);
      const [updated] = await db
        .update(standingPoliciesTable)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(standingPoliciesTable.id, id))
        .returning();

      log.info({ mspId, standingPolicyId: id, deactivatedBy: actor.name }, "standing policy deactivated");
      res.json(toWireStandingPolicy(updated));
    } catch (err: unknown) {
      log.error({ err }, "POST /api/msp/standing-policies/:id/deactivate failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

export default router;
