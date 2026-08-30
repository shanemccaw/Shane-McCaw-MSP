/**
 * msp-standing-policies.ts — MSP-side authoring of the Policy Engine's
 * declarative object (#1547).
 *
 *   GET  /api/msp/standing-policies            — this MSP's standing policies
 *   POST /api/msp/standing-policies            — author a new standing policy
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
 * Read + author only. No approve/revoke lifecycle lives here: a standing policy
 * requires no signature (that is what makes it a second object, not a register
 * entry). The #1550 approval binding — a policy IS a standard change catalog
 * item — is recorded as an optional `catalogItemId` reference and is built out
 * by #1550, not here. Enactment (#1548) and continuous evaluation (#1549) are
 * separate builds; this route ends at the wire contract.
 *
 *   GET /msp/standing-policies/:id/enactment?customerId=  — #1551: preview the
 *   enactment ROUTE this policy would take for one tenant right now, using
 *   policy.isActive + that tenant's own Graph/write-back consent (state that
 *   already exists — see policy-enactment-route.ts). This does not detect a
 *   divergence or enact anything; #1549/#1553 own that. It answers "if this
 *   policy fired for this tenant today, which of the three settled shapes
 *   would it take, and why".
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  standingPoliciesTable,
  activeDirectoryOusTable,
  changeCatalogItemsTable,
  tenantsTable,
  STANDING_POLICY_TARGET_KIND,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { resolveMspIdStrict } from "../lib/resolve-msp-id";
import { personIdForUser } from "../lib/portal-ownership";
import { apiError, ApiErrorCode } from "../lib/api-helpers";
import { logger } from "../lib/logger";
import { toWireStandingPolicy } from "../lib/standing-policies";
import { resolvePolicyEnactmentRoute } from "../lib/policy-enactment-route";

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
  isActive: z.boolean().optional(),
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
          isActive: parsed.data.isActive ?? false,
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

// ── Enactment preview (#1551) ──────────────────────────────────────────────
const enactmentQuerySchema = z.object({
  customerId: z.coerce.number().int().positive(),
});

router.get(
  "/msp/standing-policies/:id/enactment",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "MSP context required");
        return;
      }

      const policyId = Number(req.params.id);
      if (!Number.isInteger(policyId) || policyId <= 0) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid standing policy id");
        return;
      }

      const parsedQuery = enactmentQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "customerId is required", parsedQuery.error.flatten());
        return;
      }

      // The policy must be this MSP's own — never resolve enactment for
      // another MSP's policy from a borrowed id.
      const [policy] = await db
        .select()
        .from(standingPoliciesTable)
        .where(and(eq(standingPoliciesTable.id, policyId), eq(standingPoliciesTable.mspId, mspId)))
        .limit(1);
      if (!policy) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, `Standing policy '${policyId}' not found`);
        return;
      }

      // Same customerId == tenants.id convention runSopForCustomer/graphWriteForTenant
      // use — and the same "must belong to this MSP" guard, so a policy can never be
      // previewed against a tenant it has no authority over.
      const [customer] = await db
        .select({ id: tenantsTable.id, mspId: tenantsTable.mspId, consent: tenantsTable.consent })
        .from(tenantsTable)
        .where(and(eq(tenantsTable.id, parsedQuery.data.customerId), eq(tenantsTable.mspId, mspId)))
        .limit(1);
      if (!customer) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, `Customer '${parsedQuery.data.customerId}' not found for this MSP`);
        return;
      }

      const decision = resolvePolicyEnactmentRoute({ policyActive: policy.isActive, consent: customer.consent });

      log.info(
        { mspId, standingPolicyId: policy.id, customerId: customer.id, route: decision.route, reason: decision.reason },
        "policy enactment route resolved",
      );

      res.json({
        policyId: policy.id,
        customerId: customer.id,
        targetKind: policy.targetKind,
        sopId: policy.sopId,
        catalogItemId: policy.catalogItemId,
        route: decision.route,
        reason: decision.reason,
      });
    } catch (err: unknown) {
      log.error({ err }, "GET /api/msp/standing-policies/:id/enactment failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

export default router;
