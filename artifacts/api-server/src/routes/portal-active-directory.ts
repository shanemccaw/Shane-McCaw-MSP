/**
 * portal-active-directory.ts — the CUSTOMER-scoped OU-assignment surface (Git #2524).
 *
 * Split out of #2148: the MSP sets an OU assignment through `/api/msp/active-
 * directory/*` (`msp-active-directory.ts`); the customer never sets it
 * directly. This file is the customer's own, narrower capability —
 *
 *   GET  /api/portal/active-directory/ou-assignment            — this tenant's OUs +
 *                                                                 real manual assignments
 *   GET  /api/portal/active-directory/ou-assignment-requests    — this tenant's own requests
 *   POST /api/portal/active-directory/ou-assignment-requests    — raise a new one
 *
 * ── The CR-pipeline-vs-dedicated-table question #2524 itself flags ──────────
 * `msp_change_requests` models a real M365 TENANT CONFIGURATION WRITE — a
 * pre-change snapshot, a rollback script, freeze-window gating, and the
 * `executorRunId` write-authorization claim the config-pack engine treats an
 * approved row as permission to write with. An OU assignment change is not
 * that: `msp-active-directory.ts`'s own set/move routes never issue a Graph
 * WRITE at all — they verify the object exists via a Graph READ, then write
 * only our own bookkeeping row (`active_directory_ou_assignments`). Routing a
 * request for this through the CR table would mean fabricating meaningless
 * values for `targetResource`/`psaTicketId`/`backupHash`/
 * `rollbackScriptSnippet`, and would misfile an internal-grouping request
 * alongside real tenant-config changes in the customer's Change Control
 * register. This uses a dedicated table instead —
 * `active_directory_ou_assignment_requests` — see that table's own header
 * comment in `lib/db/src/schema/index.ts` for the full reasoning. The MSP-side
 * list + resolve surface lives in `msp-active-directory.ts`, so the request is
 * a real round trip, not a black hole.
 *
 * ── Scoping ───────────────────────────────────────────────────────────────
 * `active_directory_ous.tenantId` and `active_directory_ou_assignments.
 * customerId` are both `tenants.id` directly (NOT the MSP-era free-text
 * `tenant_id` shape `portal-change-control.ts` has to resolve through) — so
 * this file scopes with a direct `resolveCustomerId(req)` comparison, no
 * `resolveTenantScope` needed for the read. The request table also carries the
 * real Graph tenant id (denormalized, same convention as
 * `active_directory_ou_assignments.tenantId`) so the create route can call
 * Graph to verify the object — that alone needs `resolveTenantScope`.
 *
 * ── Role floor: `CustomerUser`, not `Assessment` ─────────────────────────────
 * This surface names specific employees (UPN, display name) and their real
 * directory/policy grouping — more than the free/prospect `Assessment` tier
 * should see, matching Policy Decisions' own reasoning for flooring above
 * `Assessment` (`portal-risk-register.ts`).
 *
 * ── No UI in this pass ────────────────────────────────────────────────────
 * `Design/portal/design_handoff_full_site/screens/Policy Decisions.dc.html`
 * explicitly excludes this: "Standing policies are separate and not shown
 * here... Target settings your MSP holds for you — mailbox sizes, VIP
 * handling — are operated on their console." No `.dc.html` export anywhere in
 * `Design/portal/` covers OU assignment read/request-change. Per this repo's
 * own design-source rule, this stays backend-only until a real export exists
 * — same precedent #2148 already set for the MSP-side routes.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  activeDirectoryOusTable,
  activeDirectoryOuAssignmentsTable,
  activeDirectoryOuAssignmentRequestsTable,
  type ActiveDirectoryOuAssignmentRequest,
} from "@workspace/db";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { requireRole } from "../middlewares/requireAuth";
import { resolveCustomerId, resolveTenantScope } from "../lib/portal-customer-scope";
import { resolveGraphUserByUpn } from "./admin-active-directory";
import { createAuditLog } from "../lib/audit";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const log = logger.child({ channel: "tenant.active-directory" });

// ── GET /portal/active-directory/ou-assignment ───────────────────────────────
// This tenant's own OU containers + the real manual assignments currently
// pointed at them. DB-only, same as the MSP-side read — no live Graph call,
// because "OU assignment" IS the manual-override row, not a derived guess
// (the department-match fallback is compliance-EVALUATION machinery,
// `policy-compliance-graph.ts`, not a declared assignment a customer reads
// here).
interface WireOu {
  readonly id: number;
  readonly name: string;
}

interface WireOuAssignment {
  readonly id: number;
  readonly ouId: number;
  readonly ouName: string | null;
  readonly objectUpn: string;
  readonly objectDisplayName: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

router.get(
  "/portal/active-directory/ou-assignment",
  requireRole("CustomerUser"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      const [ous, assignments] = await Promise.all([
        db
          .select({ id: activeDirectoryOusTable.id, name: activeDirectoryOusTable.name })
          .from(activeDirectoryOusTable)
          .where(eq(activeDirectoryOusTable.tenantId, customerId))
          .orderBy(asc(activeDirectoryOusTable.name)),
        db
          .select()
          .from(activeDirectoryOuAssignmentsTable)
          .where(eq(activeDirectoryOuAssignmentsTable.customerId, customerId))
          .orderBy(asc(activeDirectoryOuAssignmentsTable.objectUpn)),
      ]);

      const ouNameById = new Map(ous.map((o) => [o.id, o.name]));
      const wireAssignments: WireOuAssignment[] = assignments.map((a) => ({
        id: a.id,
        ouId: a.ouId,
        ouName: ouNameById.get(a.ouId) ?? null,
        objectUpn: a.objectUpn,
        objectDisplayName: a.objectDisplayName,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      }));

      const wireOus: WireOu[] = ous.map((o) => ({ id: o.id, name: o.name }));
      res.json({ ous: wireOus, assignments: wireAssignments });
    } catch (err) {
      log.error({ err, customerId }, "GET /portal/active-directory/ou-assignment failed");
      res.status(500).json({ error: "Failed to load your OU assignments" });
    }
  },
);

// ── OU assignment requests ───────────────────────────────────────────────────
interface WireOuAssignmentRequest {
  readonly id: number;
  readonly status: string;
  readonly objectUpn: string;
  readonly objectDisplayName: string | null;
  readonly currentOuId: number | null;
  readonly currentOuName: string | null;
  readonly requestedOuId: number | null;
  readonly requestedOuName: string | null;
  readonly note: string;
  readonly resolutionNote: string | null;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
}

function toWireRequest(row: ActiveDirectoryOuAssignmentRequest, ouNameById: Map<number, string>): WireOuAssignmentRequest {
  return {
    id: row.id,
    status: row.status,
    objectUpn: row.objectUpn,
    objectDisplayName: row.objectDisplayName,
    currentOuId: row.currentOuId,
    currentOuName: row.currentOuId !== null ? ouNameById.get(row.currentOuId) ?? null : null,
    requestedOuId: row.requestedOuId,
    // A named real OU wins the display over the free-text fallback when both
    // somehow exist — the DB's own name is never stale in the way a
    // customer-typed label captured at request time could be.
    requestedOuName: row.requestedOuId !== null ? ouNameById.get(row.requestedOuId) ?? row.requestedOuName : row.requestedOuName,
    note: row.note,
    resolutionNote: row.resolutionNote,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
  };
}

/** This tenant's own OUs, id -> name, for annotating request rows. */
async function loadOuNames(customerId: number): Promise<Map<number, string>> {
  const rows = await db
    .select({ id: activeDirectoryOusTable.id, name: activeDirectoryOusTable.name })
    .from(activeDirectoryOusTable)
    .where(eq(activeDirectoryOusTable.tenantId, customerId));
  return new Map(rows.map((r) => [r.id, r.name]));
}

// ── GET /portal/active-directory/ou-assignment-requests ─────────────────────
// This tenant's own requests, most recent first — so a customer who raised
// one can see whether it is still pending or how the MSP resolved it.
router.get(
  "/portal/active-directory/ou-assignment-requests",
  requireRole("CustomerUser"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      const [rows, ouNameById] = await Promise.all([
        db
          .select()
          .from(activeDirectoryOuAssignmentRequestsTable)
          .where(eq(activeDirectoryOuAssignmentRequestsTable.customerId, customerId))
          .orderBy(desc(activeDirectoryOuAssignmentRequestsTable.createdAt)),
        loadOuNames(customerId),
      ]);
      res.json({ requests: rows.map((r) => toWireRequest(r, ouNameById)) });
    } catch (err) {
      log.error({ err, customerId }, "GET /portal/active-directory/ou-assignment-requests failed");
      res.status(500).json({ error: "Failed to load your OU assignment requests" });
    }
  },
);

const createRequestSchema = z
  .object({
    objectUpn: z.string().trim().min(1, "objectUpn is required").max(320),
    requestedOuId: z.number().int().positive().optional(),
    requestedOuName: z.string().trim().min(1).max(200).optional(),
    note: z.string().trim().min(1, "note is required").max(2000),
  })
  .refine((body) => body.requestedOuId !== undefined || body.requestedOuName !== undefined, {
    message: "Either requestedOuId or requestedOuName is required",
    path: ["requestedOuId"],
  });

// ── POST /portal/active-directory/ou-assignment-requests ────────────────────
// Raise a real request against this tenant's own directory. The object is
// verified against Graph (never trusted from client input alone, same
// discipline `msp-active-directory.ts`'s set route uses) and, when a real
// target OU id is given, that OU must be one that actually belongs to this
// tenant — never the platform-wide null-tenant case, matching the MSP-side
// restriction exactly.
router.post(
  "/portal/active-directory/ou-assignment-requests",
  requireRole("CustomerUser"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    const parsed = createRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
      return;
    }
    const body = parsed.data;

    const scope = await resolveTenantScope(customerId);
    if (!scope) {
      res.status(400).json({ error: "Your organisation has no resolvable Microsoft 365 tenant on record" });
      return;
    }

    const graphUser = await resolveGraphUserByUpn(scope.tenantId, body.objectUpn);
    if (!graphUser.ok) {
      res.status(400).json({ error: graphUser.error });
      return;
    }

    if (body.requestedOuId !== undefined) {
      const [ou] = await db
        .select({ id: activeDirectoryOusTable.id, tenantId: activeDirectoryOusTable.tenantId })
        .from(activeDirectoryOusTable)
        .where(eq(activeDirectoryOusTable.id, body.requestedOuId))
        .limit(1);
      if (!ou || ou.tenantId !== customerId) {
        res.status(400).json({ error: "The requested OU does not belong to your organisation" });
        return;
      }
    }

    try {
      const [existingAssignment] = await db
        .select({ ouId: activeDirectoryOuAssignmentsTable.ouId })
        .from(activeDirectoryOuAssignmentsTable)
        .where(
          and(
            eq(activeDirectoryOuAssignmentsTable.customerId, customerId),
            eq(activeDirectoryOuAssignmentsTable.objectId, graphUser.id),
          ),
        )
        .limit(1);

      const [inserted] = await db
        .insert(activeDirectoryOuAssignmentRequestsTable)
        .values({
          mspId: scope.mspId,
          customerId,
          tenantId: scope.tenantId,
          objectUpn: graphUser.userPrincipalName,
          objectDisplayName: graphUser.displayName,
          currentOuId: existingAssignment?.ouId ?? null,
          requestedOuId: body.requestedOuId ?? null,
          requestedOuName: body.requestedOuName ?? null,
          note: body.note,
          requestedByUserId: req.user!.id,
        })
        .returning();

      await createAuditLog({
        actorUserId: req.user!.id,
        actorName: req.user!.name ?? req.user!.email,
        actorRole: req.user!.role,
        actionType: "active_directory.ou_assignment_request.raised",
        entityType: "active_directory_ou_assignment_request",
        entityId: inserted.id,
        metadata: { customerId, objectUpn: graphUser.userPrincipalName, requestedOuId: body.requestedOuId ?? null, requestedOuName: body.requestedOuName ?? null },
      });
      log.info({ customerId, requestId: inserted.id }, "Customer raised an OU assignment request");

      const ouNameById = await loadOuNames(customerId);
      res.status(201).json(toWireRequest(inserted, ouNameById));
    } catch (err) {
      log.error({ err, customerId }, "POST /portal/active-directory/ou-assignment-requests failed");
      res.status(500).json({ error: "Failed to raise the OU assignment request" });
    }
  },
);

export default router;
