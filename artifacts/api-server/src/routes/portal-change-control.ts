/**
 * portal-change-control.ts — the CUSTOMER-scoped Change Control register.
 *
 *   GET  /api/portal/change-control    — this customer's change requests + stats
 *   POST /api/portal/change-control    — raise a new one against their own tenant
 *
 * ── Why this route exists at all, given `msp-changes.ts` already does this ──
 * It does not do this. `msp-changes.ts` serves the same table gated by
 * `requireRole("MSPOperator")` and scoped by `resolveMspIdStrict` — i.e. every
 * change request belonging to every tenant of that MSP, in one list. Pointing a
 * customer-facing page at it would hand each customer the other customers'
 * change history: their tenant names, their primary domains, their target
 * resources, and the before/after JSON of their configuration. That is the
 * whole reason BUILD_PLAN §3.5 asks for a new route rather than a wider role on
 * the old one.
 *
 * ── The scoping, and why it is a pair of predicates and not one ─────────────
 * The JWT's `customerId` claim is a `tenants.id`. The change-request table is
 * NOT keyed on it: `msp_change_requests.tenant_id` is free `text`, holding the
 * M365 tenant identifier, with NO foreign key to `tenants` and no unique
 * constraint (verified live — `pg_constraint` on that table returns only its
 * primary key and the `msp_id` foreign key). So the resolution is:
 *
 *     JWT customerId → tenants row → (tenants.mspId, tenants.tenantId)
 *
 * and the query then filters on BOTH `mspId` and `tenantId`. Either alone is
 * not enough, for different reasons:
 *
 *   • `mspId` alone is the MSP-console scoping — every tenant of the MSP.
 *   • `tenantId` alone trusts an unconstrained free-text column to be globally
 *     unique. Nothing enforces that. Two MSPs onboarding the same M365 tenant,
 *     or any writer putting a non-GUID value in the column, collapses the
 *     scope. The live data already shows the column is not disciplined: the
 *     existing rows carry `'t-contoso'` (change requests) and `'contoso-01'`
 *     (risk decisions) — two different synthetic conventions, neither of them
 *     an M365 tenant GUID.
 *
 * Together they are safe: a row is only ever served to a caller whose own
 * tenant row names both that MSP and that tenant identifier.
 *
 * ── FAIL CLOSED on a blank tenant identifier ────────────────────────────────
 * `tenants.tenantId` is `text` and nothing guarantees it is populated. If it
 * were blank and we filtered on it anyway, `eq(tenantId, '')` would match every
 * OTHER row whose tenant identifier is also blank — a cross-tenant read created
 * by an empty string. `resolveScope` therefore returns null for a blank
 * identifier and the handlers answer with an empty register rather than a
 * query. This is the single most important line in the file.
 *
 * ── Role floor: `Assessment`, not `CustomerUser` ────────────────────────────
 * BUILD_PLAN §3.5 says `requireRole('CustomerUser')`. The floor used here is
 * `Assessment`, matching the customer-scoped routes that already exist —
 * `portal-remediation-tracker.ts` and `portal-tenant-check-items.ts` both floor
 * there, and the former states why in its own header: "Assessment is the lowest
 * role carrying a customerId".
 *
 * The distinction that matters: the role floor decides which TIER of customer
 * may open the page. It is NOT what prevents a cross-tenant read — the
 * `customerId`-from-JWT scoping above is, and that is identical either way. So
 * the choice between the two floors is a product decision, not a security one.
 *
 * `Assessment` is used for consistency with the routes above rather than
 * because `CustomerUser` would break anything: the configured testbed account
 * is in fact a `CustomerUser` (verified against the database, not assumed from
 * the "testbed Assessment account" phrasing in BuildConsole's own docs), so
 * either floor is reachable by the harness.
 *
 * ── UPDATE (Git #1173/#1168) — the READ route now floors at `CustomerUser` ──
 * Change Control shipped as a real, separately-priced add-on (#1173, prices
 * locked by Shane 2026-08-21) rather than folding into a tier. Per #1168's
 * "creation unconditional, gate visibility only" rule, the customer-facing
 * APPROVAL EXPERIENCE — this GET, which is what the register/briefing/record
 * views actually read — now requires both `CustomerUser` and an active
 * `change_control` entitlement (`../lib/portal-addon-entitlements.ts`). This
 * answers the flag above: an Assessment-tier (free) account no longer sees
 * Change Control at all, by design.
 *
 * The POST below is deliberately left at `Assessment` with NO entitlement
 * check — CR creation is the "creation unconditional" half of #1168's rule.
 * Every real change (including ones raised automatically elsewhere in the
 * platform) must always produce a real CR record regardless of whether this
 * tenant bought the add-on; only visibility into the register is gated.
 *
 * ── What this route deliberately does NOT expose ────────────────────────────
 * No approve, no reject, no rollback, and no `rollbackScriptSnippet` on the
 * wire.
 *
 * The prototype is the reason, and it is worth being precise because the
 * README's "No dead ends. Every button opens a form, gates a CR, or escalates
 * to ShaneBot" reads like a promise that these are wired. In the prototype's
 * own markup (proto 1513-1524) the Approve, "Reject with a reason", "Roll back
 * from snapshot", "Change window" and "Add a comment" buttons carry no
 * `onClick` at all — only "Ask ShaneBot to explain the diff" does. Approving a
 * change to a live tenant is also an authority this codebase has no customer-
 * side capability flag for: the two that exist (`canApprovePurchases`,
 * `canManageTeam` — see Git #1142) are about spend and team roster, and
 * overloading either to mean "may approve a tenant configuration change" would
 * grant an authority nobody granted. So the affordances render exactly as
 * designed and the mutation is not invented here.
 *
 * `rollbackScriptSnippet` is omitted because nothing on the page renders it,
 * and a stored rollback command is the last field to ship to a browser out of
 * habit.
 *
 * ── One inherited bug not carried over ──────────────────────────────────────
 * `msp-changes.ts`'s POST fabricates a random 64-hex string as `backupHash`
 * and sets `backupVerified: true` on every create, so a change request that has
 * never executed claims a verified backup that does not exist. This route
 * writes `backupVerified: false` and an empty hash on create, which is what the
 * prototype's own copy says is true: "A pre-change snapshot is captured
 * automatically at execution, not from the JSON you paste here" (proto 17158).
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, crApprovalsTable, mspChangeRequestsTable, usersTable, type CrApproval } from "@workspace/db";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { requireRole } from "../middlewares/requireAuth";
import { resolveCustomerId, resolveTenantScope } from "../lib/portal-customer-scope";
import { requireAddOnEntitlement } from "../lib/portal-addon-entitlements";
import { declineRoutedChangeToRisk } from "../lib/m365-change-router";
import { personIdForUser } from "../lib/portal-ownership";
import {
  requiredStages,
  summarizeApprovals,
  toWireApproval,
  type ApprovalState,
  type WireApprovalRecord,
} from "../lib/portal-change-approvals";
import {
  materializeApprovalsForChange,
  recordApproval,
} from "../lib/portal-change-approvals-store";
import { recordRejection } from "../lib/portal-change-rejection";
import { logger } from "../lib/logger";
import {
  CHANGE_CLASSES,
  EMERGENCY_LOOKBACK_DAYS,
  SNAPSHOT_RETENTION_DAYS,
  approvalLines,
  canApprove,
  canRollback,
  categoryForWorkload,
  computeRiskLevel,
  deriveWorkload,
  displayChangeClass,
  displayImplementer,
  displayIntake,
  displayRiskLevel,
  displayStatus,
  formatChangeRequestCode,
  formatSnapshotJson,
  isOpenStatus,
  storedChangeClass,
  storedRiskLevel,
  workloadForCategory,
  type ChangeClass,
  type ChangeRequestDisplayStatus,
} from "../lib/portal-change-control";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

/**
 * Both resolutions moved to `lib/portal-customer-scope.ts` when the Active
 * Runbooks page needed the same pair — one implementation of a scoping rule is
 * the point, and its header documents the two shapes and why they differ.
 */
const resolveScope = resolveTenantScope;

/** One change request, as the page consumes it. Deliberately narrower than the row. */
interface WireChangeRequest {
  readonly code: string;
  readonly title: string;
  readonly changeClass: ChangeClass;
  readonly status: ChangeRequestDisplayStatus;
  readonly workload: string;
  readonly target: string;
  readonly ticket: string;
  readonly requester: string;
  readonly window: string;
  readonly risk: string;
  readonly impactedUsersCount: number;
  readonly rationale: string;
  readonly pre: string;
  readonly post: string;
  readonly approvals: readonly string[];
  readonly canApprove: boolean;
  readonly canRollback: boolean;
  readonly executedAt: string | null;
  readonly backupVerified: boolean;
  /**
   * "Raised from" — the finding this change came out of, e.g. "Governance ·
   * External Sharing Drift". NULL means raised directly, which the CR wizard's
   * own submissions are. The page's expanded row has a cell for this and, until
   * the column was added alongside the Active Runbooks build, nothing to put in
   * it; hold-window decisions now populate it with the window they came from.
   */
  readonly linkedFinding: string | null;
  /**
   * #1534 — set only on an automatically-routed Microsoft change. `intake` is the
   * "do I have to act" axis (Informed / Approval / Advisory); `implementer` names
   * who executes it ("Microsoft" for a forced change the tenant cannot refuse).
   * `sourceGraphMessageId` links the CR back to the Message Center announcement
   * it was routed from. All null on a wizard- or drift-raised CR.
   */
  readonly intake: string | null;
  readonly implementer: string | null;
  readonly sourceGraphMessageId: string | null;
  readonly createdAt: string;
  /**
   * #1496 — the real approval RECORD behind this change, one entry per approver
   * decision, plus the folded state (how many stages it needs, how many have
   * cleared, whether an SLA has breached, whether it is complete or terminally
   * rejected). `approvals` above stays as the prototype's one-line display
   * summary; these are the durable ledger the summary is derived from.
   */
  readonly approvalRecords: readonly WireApprovalRecord[];
  readonly approvalState: ApprovalState;
  /**
   * Whether THIS caller may record an approval on this change right now — has the
   * live `canApproveChanges` capability, is not the person who raised it
   * (separation of duties), and a pending stage exists. The page shows the
   * Approve/Reject affordance only when true.
   */
  readonly canApproveNow: boolean;
}

interface ChangeRequestRow {
  id: number;
  title: string;
  description: string;
  changeClass: string;
  riskLevel: string;
  category: string;
  targetResource: string;
  psaTicketId: string;
  requestedBy: string;
  scheduledFor: string;
  impactedUsersCount: number;
  status: string;
  backupVerified: boolean;
  preChangeSnapshot: unknown;
  proposedPayload: unknown;
  executedAt: string | null;
  approvedBy: string | null;
  linkedFinding: string | null;
  intake: string | null;
  implementer: string | null;
  sourceGraphMessageId: string | null;
  createdAt: Date;
}

/** Per-request context for the caller-relative `canApproveNow` computation. */
interface ApprovalViewerContext {
  readonly now: Date;
  readonly callerCanApprove: boolean;
  readonly callerEmail: string;
}

function toWire(
  row: ChangeRequestRow,
  approvals: readonly CrApproval[],
  ctx: ApprovalViewerContext,
): WireChangeRequest {
  const changeClass = displayChangeClass(row.changeClass);
  const status = displayStatus(row.status, row.approvedBy);
  const required = requiredStages(row.changeClass as never, row.riskLevel as never);
  const approvalState = summarizeApprovals(approvals, required, ctx.now);
  const approvalRecords = approvals.map((a) => toWireApproval(a, ctx.now));
  // The caller may act only if they carry the capability, a stage is pending,
  // and they are not the requester (separation of duties). The store re-checks
  // all three server-side; this only decides whether to show the affordance.
  const requesterEmail = (row.requestedBy ?? "").trim().toLowerCase();
  const isRequester = requesterEmail.length > 0 && requesterEmail === ctx.callerEmail.trim().toLowerCase();
  const canApproveNow =
    ctx.callerCanApprove && approvalState.nextStage !== null && !approvalState.rejectedTerminal && !isRequester;
  return {
    code: formatChangeRequestCode(row.id),
    title: row.title,
    changeClass,
    status,
    workload: workloadForCategory(row.category),
    target: row.targetResource,
    ticket: row.psaTicketId,
    requester: row.requestedBy,
    window: row.scheduledFor,
    risk: displayRiskLevel(row.riskLevel),
    impactedUsersCount: row.impactedUsersCount,
    rationale: row.description,
    pre: formatSnapshotJson(row.preChangeSnapshot),
    post: formatSnapshotJson(row.proposedPayload),
    approvals: approvalLines({ status: row.status, approvedBy: row.approvedBy, changeClass }),
    canApprove: canApprove(status),
    canRollback: canRollback(status),
    executedAt: row.executedAt,
    backupVerified: row.backupVerified,
    linkedFinding: row.linkedFinding,
    intake: displayIntake(row.intake),
    implementer: displayImplementer(row.implementer),
    sourceGraphMessageId: row.sourceGraphMessageId,
    createdAt: row.createdAt.toISOString(),
    approvalRecords,
    approvalState,
    canApproveNow,
  };
}

/**
 * The four stat cards (proto 15044-15053).
 *
 * Only the FIRST is derived in the prototype; the other three are literals
 * ('2', '1', '14'). CLAUDE.md's "every number on screen comes from the data
 * layer" makes literals unshippable, so all four are computed here — with one
 * honest limitation, stated rather than papered over:
 *
 * "In the next window" cannot be date-ordered. `scheduled_for` is free `text`
 * ("Thu 27 Aug · 07:00–09:00 BST", "Awaiting records sign-off — no window
 * booked", "2026-07-27 02:00 UTC (Next Maint Window)"), so there is no sound
 * way to sort it chronologically. What IS sound is grouping open changes by the
 * exact window string they were booked into and reporting the largest such
 * group, labelled with that group's real text. That answers the question the
 * card is asking — how many changes land together in one slot — without
 * pretending to parse a date out of prose. Flagged as a schema gap:
 * `scheduled_for` wants to be a timestamp.
 */
function buildStats(wire: readonly WireChangeRequest[], now: Date) {
  const open = wire.filter((c) => isOpenStatus(c.status));
  const awaitingApproval = wire.filter((c) => c.status === "Pending approval").length;

  const byWindow = new Map<string, number>();
  for (const c of open) {
    const key = c.window.trim();
    if (!key) continue;
    byWindow.set(key, (byWindow.get(key) ?? 0) + 1);
  }
  let nextWindowLabel = "No window booked";
  let nextWindowCount = 0;
  for (const [label, count] of byWindow) {
    if (count > nextWindowCount) {
      nextWindowCount = count;
      nextWindowLabel = label;
    }
  }

  const emergencyCutoff = new Date(now.getTime() - EMERGENCY_LOOKBACK_DAYS * 86_400_000);
  const emergencyCount = wire.filter(
    (c) => c.changeClass === "Emergency" && new Date(c.createdAt) >= emergencyCutoff,
  ).length;

  // A snapshot exists once a change has executed, and is held for
  // SNAPSHOT_RETENTION_DAYS from that moment. `executedAt` is free text like
  // the rest of this table's timestamps, so retention is measured from
  // `createdAt` (a real timestamptz) for rows that have executed at all —
  // stated here because it is a substitution, not the literal rule.
  const snapshotCutoff = new Date(now.getTime() - SNAPSHOT_RETENTION_DAYS * 86_400_000);
  const snapshotsHeld = wire.filter(
    (c) => c.executedAt !== null && c.executedAt !== "" && new Date(c.createdAt) >= snapshotCutoff,
  ).length;

  return {
    open: open.length,
    awaitingApproval,
    nextWindowCount,
    nextWindowLabel,
    emergencyCount,
    emergencyLookbackDays: EMERGENCY_LOOKBACK_DAYS,
    snapshotsHeld,
    snapshotRetentionDays: SNAPSHOT_RETENTION_DAYS,
  };
}

/** The feature key this add-on's entitlement rows and services carry. */
export const CHANGE_CONTROL_FEATURE_KEY = "change_control";

/**
 * The caller's LIVE `canApproveChanges` capability (#1496). Read fresh from the
 * DB every call, never trusted from the JWT — same discipline as `canManageTeam`
 * / `canApprovePurchases`, so a revoke takes effect immediately. MSP staff and
 * PlatformAdmin approve by role and are not subject to the per-user flag.
 */
async function callerCanApproveChanges(req: Request): Promise<boolean> {
  const user = req.user;
  if (!user) return false;
  const effectiveRole = user.role === "admin" ? "PlatformAdmin" : user.mspRole;
  if (effectiveRole === "MSPAdmin" || effectiveRole === "MSPOperator" || effectiveRole === "PlatformAdmin") {
    return true;
  }
  const [row] = await db
    .select({ canApproveChanges: usersTable.canApproveChanges })
    .from(usersTable)
    .where(eq(usersTable.id, user.id))
    .limit(1);
  return row?.canApproveChanges === true;
}

// ── Read ──────────────────────────────────────────────────────────────────────
router.get(
  "/portal/change-control",
  requireRole("CustomerUser"),
  requireAddOnEntitlement(CHANGE_CONTROL_FEATURE_KEY),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      const scope = await resolveScope(customerId);
      if (!scope) {
        // Not an error: a tenant with no resolvable M365 identifier simply has
        // no change requests that can be safely attributed to it. Answering
        // with an empty register is the fail-closed outcome (see the header).
        log.info({ customerId }, "change-control: no resolvable tenant scope, serving empty register");
        res.json({ requests: [], stats: buildStats([], new Date()), scoped: false });
        return;
      }

      const rows = await db
        .select({
          id: mspChangeRequestsTable.id,
          title: mspChangeRequestsTable.title,
          description: mspChangeRequestsTable.description,
          changeClass: mspChangeRequestsTable.changeClass,
          riskLevel: mspChangeRequestsTable.riskLevel,
          category: mspChangeRequestsTable.category,
          targetResource: mspChangeRequestsTable.targetResource,
          psaTicketId: mspChangeRequestsTable.psaTicketId,
          requestedBy: mspChangeRequestsTable.requestedBy,
          scheduledFor: mspChangeRequestsTable.scheduledFor,
          impactedUsersCount: mspChangeRequestsTable.impactedUsersCount,
          status: mspChangeRequestsTable.status,
          backupVerified: mspChangeRequestsTable.backupVerified,
          preChangeSnapshot: mspChangeRequestsTable.preChangeSnapshot,
          proposedPayload: mspChangeRequestsTable.proposedPayload,
          executedAt: mspChangeRequestsTable.executedAt,
          approvedBy: mspChangeRequestsTable.approvedBy,
          linkedFinding: mspChangeRequestsTable.linkedFinding,
          intake: mspChangeRequestsTable.intake,
          implementer: mspChangeRequestsTable.implementer,
          sourceGraphMessageId: mspChangeRequestsTable.sourceGraphMessageId,
          createdAt: mspChangeRequestsTable.createdAt,
        })
        .from(mspChangeRequestsTable)
        // BOTH predicates. See the header — neither is sufficient alone.
        .where(
          and(
            eq(mspChangeRequestsTable.mspId, scope.mspId),
            eq(mspChangeRequestsTable.tenantId, scope.tenantId),
          ),
        )
        .orderBy(desc(mspChangeRequestsTable.id));

      // #1496 — attach the approval ledger. One scoped read for every CR on the
      // page, grouped by change; the (mspId, tenantId) predicate is the same
      // cross-tenant guard the CR read uses.
      const now = new Date();
      const crIds = rows.map((r) => r.id);
      const approvalRows =
        crIds.length === 0
          ? []
          : await db
              .select()
              .from(crApprovalsTable)
              .where(and(eq(crApprovalsTable.mspId, scope.mspId), eq(crApprovalsTable.tenantId, scope.tenantId)))
              .orderBy(asc(crApprovalsTable.stage), asc(crApprovalsTable.id));
      const approvalsByCr = new Map<number, CrApproval[]>();
      for (const a of approvalRows) {
        const list = approvalsByCr.get(a.changeRequestId) ?? [];
        list.push(a);
        approvalsByCr.set(a.changeRequestId, list);
      }
      const ctx: ApprovalViewerContext = {
        now,
        callerCanApprove: await callerCanApproveChanges(req),
        callerEmail: req.user?.email ?? "",
      };

      const requests = rows.map((row) => toWire(row, approvalsByCr.get(row.id) ?? [], ctx));
      res.json({ requests, stats: buildStats(requests, now), scoped: true });
    } catch (err) {
      log.error({ err, customerId }, "GET /portal/change-control failed");
      res.status(500).json({ error: "Failed to load change control register" });
    }
  },
);

// ── Write ─────────────────────────────────────────────────────────────────────
//
// The wizard's Submit (proto 17161-17195). The client sends what the customer
// typed and NOTHING that decides authority: `risk` and `workload` are
// recomputed here from the target and the blast radius, `status` is always
// `pending_approval`, and the tenant the change lands against comes from the
// resolved scope rather than the body.
const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  target: z.string().trim().min(1).max(500),
  ticket: z.string().trim().max(120).optional(),
  pre: z.string().max(20_000).optional(),
  post: z.string().trim().min(1).max(20_000),
  changeClass: z.enum(CHANGE_CLASSES),
  impactedUsersCount: z.number().int().min(0).max(10_000_000),
  window: z.string().trim().min(1).max(200),
});

/**
 * The wizard's two JSON fields are free-text textareas, so what arrives may not
 * parse. It is stored as `{ raw: "<what they typed>" }` rather than rejected:
 * the field is explicitly "for review" (proto 17158), and losing a customer's
 * typed payload to a validation error would be worse than storing it verbatim.
 */
function parseJsonField(value: string | undefined): Record<string, unknown> {
  const text = (value ?? "").trim();
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return { raw: text };
  }
}

router.post(
  "/portal/change-control",
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
      return;
    }

    try {
      const scope = await resolveScope(customerId);
      if (!scope) {
        res.status(409).json({
          error: "This account has no connected Microsoft 365 tenant to raise a change against",
        });
        return;
      }

      const body = parsed.data;
      // Authority-bearing values are computed, never accepted. See the header.
      const risk = computeRiskLevel({
        changeClass: body.changeClass,
        targetResource: body.target,
        impactedUsersCount: body.impactedUsersCount,
      });
      const workload = deriveWorkload(body.target);
      const requestedBy = req.user?.email ?? "unknown";
      const requestedAt = new Date().toISOString();

      const [inserted] = await db
        .insert(mspChangeRequestsTable)
        .values({
          mspId: scope.mspId,
          tenantId: scope.tenantId,
          tenantName: scope.tenantName,
          primaryDomain: scope.primaryDomain,
          title: body.title,
          // The prototype's own rationale for a wizard-raised CR (proto 17183).
          description: "Raised from the change control page. Awaiting approval.",
          // No casts on any of these three. They are typed unions from
          // lib/portal-change-control.ts precisely so the compiler checks them
          // against the real column types — a cast here would compile whether
          // or not `category` had actually been widened to hold "SharePoint".
          changeClass: storedChangeClass(body.changeClass),
          riskLevel: storedRiskLevel(risk),
          category: categoryForWorkload(workload),
          targetResource: body.target,
          psaTicketId: body.ticket?.trim() || "No ticket reference",
          requestedBy,
          requestedAt,
          scheduledFor: body.window,
          impactedUsersCount: body.impactedUsersCount,
          status: "pending_approval",
          // NOT the MSP route's fabricated hash — see the header. Nothing has
          // executed, so nothing has been backed up.
          backupVerified: false,
          backupHash: "",
          preChangeSnapshot: parseJsonField(body.pre),
          proposedPayload: parseJsonField(body.post),
          rollbackScriptSnippet: "",
        })
        .returning({ id: mspChangeRequestsTable.id, createdAt: mspChangeRequestsTable.createdAt });

      // #1496 — a real change produces a real approval record from the moment it
      // is raised. A wizard CR is `normal`, unapproved, so this materialises the
      // required pending stage(s) with their SLA. Non-fatal if it fails: the CR
      // is already created and the register still renders.
      try {
        await materializeApprovalsForChange({
          id: inserted.id,
          mspId: scope.mspId,
          tenantId: scope.tenantId,
          changeClass: storedChangeClass(body.changeClass),
          riskLevel: storedRiskLevel(risk),
          status: "pending_approval",
          approvedBy: null,
          requestedBy,
          createdAt: inserted.createdAt,
        });
      } catch (err) {
        log.error({ err, crId: inserted.id }, "change request created but approval materialisation failed");
      }

      const code = formatChangeRequestCode(inserted.id);
      log.info(
        { customerId, mspId: scope.mspId, code, risk, workload, changeClass: body.changeClass },
        "change request raised from the customer portal",
      );

      res.status(201).json({ code, risk, workload });
    } catch (err) {
      log.error({ err, customerId }, "POST /portal/change-control failed");
      res.status(500).json({ error: "Failed to raise the change request" });
    }
  },
);

// ── Decline a routed Microsoft change → accepted risk (#1534 / #1514) ───────────
//
// A customer declining an auto-routed Microsoft change is declining a
// remediation, and the residual risk becomes theirs — the rejection IS the risk
// acceptance (#1514). This drives the routed CR to its terminal `rejected` state
// and creates the accepted-risk record, linked back to the CR that spawned it.
//
// Scoped exactly like every read here: the CR must belong to the caller's own
// resolved (mspId, tenantId), and only a routed Microsoft change (source_kind =
// 'microsoft_change') may be declined through this path — a wizard-raised CR has
// no risk-acceptance semantics and is out of scope. Gated on the same
// CustomerUser + change_control entitlement as the register read: declining is
// part of the approval experience.
const declineSchema = z.object({
  fullName: z.string().trim().min(1).max(200),
  statement: z.string().trim().min(1).max(2_000),
});

/** `CR-2026-101` → the numeric msp_change_requests.id, or null. Inverse of formatChangeRequestCode. */
function parseChangeRequestCode(code: string): number | null {
  const m = code.match(/^CR-2026-(\d+)$/);
  if (!m) return null;
  const id = Number(m[1]) - 100;
  return Number.isInteger(id) && id > 0 ? id : null;
}

router.post(
  "/portal/change-control/:code/decline",
  requireRole("CustomerUser"),
  requireAddOnEntitlement(CHANGE_CONTROL_FEATURE_KEY),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    const crId = parseChangeRequestCode(String(req.params.code));
    if (crId === null) {
      res.status(400).json({ error: "Invalid change request code" });
      return;
    }

    const parsed = declineSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
      return;
    }

    try {
      const scope = await resolveScope(customerId);
      if (!scope) {
        res.status(409).json({ error: "This account has no connected Microsoft 365 tenant" });
        return;
      }

      // Confirm the CR belongs to this tenant AND is a routed Microsoft change
      // before anything is written — the scope pair is the cross-tenant guard.
      const [cr] = await db
        .select({ id: mspChangeRequestsTable.id, sourceKind: mspChangeRequestsTable.sourceKind, status: mspChangeRequestsTable.status })
        .from(mspChangeRequestsTable)
        .where(
          and(
            eq(mspChangeRequestsTable.id, crId),
            eq(mspChangeRequestsTable.mspId, scope.mspId),
            eq(mspChangeRequestsTable.tenantId, scope.tenantId),
          ),
        )
        .limit(1);
      if (!cr) {
        res.status(404).json({ error: "Change request not found" });
        return;
      }
      if (cr.sourceKind !== "microsoft_change") {
        res.status(409).json({ error: "Only an automatically-routed Microsoft change can be declined here" });
        return;
      }

      const result = await declineRoutedChangeToRisk({
        changeRequestId: crId,
        mspId: scope.mspId,
        declinedBy: "customer",
        approverName: parsed.data.fullName,
        approverEmail: req.user?.email ?? "",
        statement: parsed.data.statement,
      });

      log.info(
        { customerId, mspId: scope.mspId, crId, riskDecisionId: result.riskDecisionId, alreadyRejected: result.alreadyRejected },
        "routed Microsoft change declined by customer → accepted risk",
      );
      res.status(result.alreadyRejected ? 200 : 201).json({
        code: formatChangeRequestCode(crId),
        declined: true,
        riskAccepted: result.riskDecisionId !== null,
      });
    } catch (err) {
      log.error({ err, customerId, crId }, "POST /portal/change-control/:code/decline failed");
      res.status(500).json({ error: "Failed to decline the change" });
    }
  },
);

// ── Approve / reject a change (the #1496 approval model) ─────────────────────
//
// These are the customer-facing decision endpoints the approval model exists
// for. Both floor at CustomerUser + the change_control entitlement (the approval
// experience), and both ADDITIONALLY require the live `canApproveChanges`
// capability — approving a configuration change to a live tenant is a distinct
// authority (see this file's header and the flag's note in the users schema).
// Separation of duties and stage ordering are enforced in the store, not here.

/** The CR essentials both decision routes load, scoped to the caller's tenant. */
async function loadScopedChange(
  crId: number,
  mspId: number,
  tenantId: string,
): Promise<{
  id: number;
  mspId: number;
  tenantId: string;
  changeClass: string;
  riskLevel: string;
  status: string;
  approvedBy: string | null;
  requestedBy: string;
  createdAt: Date;
  sourceKind: string | null;
} | null> {
  const [cr] = await db
    .select({
      id: mspChangeRequestsTable.id,
      mspId: mspChangeRequestsTable.mspId,
      tenantId: mspChangeRequestsTable.tenantId,
      changeClass: mspChangeRequestsTable.changeClass,
      riskLevel: mspChangeRequestsTable.riskLevel,
      status: mspChangeRequestsTable.status,
      approvedBy: mspChangeRequestsTable.approvedBy,
      requestedBy: mspChangeRequestsTable.requestedBy,
      createdAt: mspChangeRequestsTable.createdAt,
      sourceKind: mspChangeRequestsTable.sourceKind,
    })
    .from(mspChangeRequestsTable)
    .where(
      and(
        eq(mspChangeRequestsTable.id, crId),
        eq(mspChangeRequestsTable.mspId, mspId),
        eq(mspChangeRequestsTable.tenantId, tenantId),
      ),
    )
    .limit(1);
  return cr ?? null;
}

/** The acting approver's identity for the store. Role is customer unless MSP staff. */
function approverIdentity(req: Request, customerId: number): {
  personId: string;
  name: string;
  email: string;
  customerId: number;
  role: "customer" | "msp";
} {
  const user = req.user!;
  const effectiveRole = user.role === "admin" ? "PlatformAdmin" : user.mspRole;
  const isMsp = effectiveRole === "MSPAdmin" || effectiveRole === "MSPOperator" || effectiveRole === "PlatformAdmin";
  return {
    personId: personIdForUser(user.id),
    name: (user.email ?? "").trim() || `User ${user.id}`,
    email: user.email ?? "",
    customerId,
    role: isMsp ? "msp" : "customer",
  };
}

const approveSchema = z.object({ note: z.string().trim().max(2_000).optional() });
const rejectSchema = z.object({ reason: z.string().trim().min(1).max(2_000) });

router.post(
  "/portal/change-control/:code/approve",
  requireRole("CustomerUser"),
  requireAddOnEntitlement(CHANGE_CONTROL_FEATURE_KEY),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }
    const crId = parseChangeRequestCode(String(req.params.code));
    if (crId === null) {
      res.status(400).json({ error: "Invalid change request code" });
      return;
    }
    const parsed = approveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
      return;
    }

    try {
      if (!(await callerCanApproveChanges(req))) {
        res.status(403).json({ error: "You do not have permission to approve changes." });
        return;
      }
      const scope = await resolveScope(customerId);
      if (!scope) {
        res.status(409).json({ error: "This account has no connected Microsoft 365 tenant" });
        return;
      }
      const cr = await loadScopedChange(crId, scope.mspId, scope.tenantId);
      if (!cr) {
        res.status(404).json({ error: "Change request not found" });
        return;
      }

      const result = await recordApproval(cr, approverIdentity(req, customerId), parsed.data.note ?? null);
      if (!result.ok) {
        res.status(result.code).json({ error: result.error });
        return;
      }
      log.info({ customerId, mspId: scope.mspId, crId, stage: result.stage, complete: result.complete }, "change approved via approval model");
      res.status(200).json({ code: formatChangeRequestCode(crId), approved: true, stage: result.stage, complete: result.complete });
    } catch (err) {
      log.error({ err, customerId, crId }, "POST /portal/change-control/:code/approve failed");
      res.status(500).json({ error: "Failed to approve the change" });
    }
  },
);

router.post(
  "/portal/change-control/:code/reject",
  requireRole("CustomerUser"),
  requireAddOnEntitlement(CHANGE_CONTROL_FEATURE_KEY),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }
    const crId = parseChangeRequestCode(String(req.params.code));
    if (crId === null) {
      res.status(400).json({ error: "Invalid change request code" });
      return;
    }
    const parsed = rejectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
      return;
    }

    try {
      if (!(await callerCanApproveChanges(req))) {
        res.status(403).json({ error: "You do not have permission to reject changes." });
        return;
      }
      const scope = await resolveScope(customerId);
      if (!scope) {
        res.status(409).json({ error: "This account has no connected Microsoft 365 tenant" });
        return;
      }
      const cr = await loadScopedChange(crId, scope.mspId, scope.tenantId);
      if (!cr) {
        res.status(404).json({ error: "Change request not found" });
        return;
      }

      const result = await recordRejection(cr, approverIdentity(req, customerId), parsed.data.reason);
      if (!result.ok) {
        res.status(result.code).json({ error: result.error });
        return;
      }
      log.info({ customerId, mspId: scope.mspId, crId, riskDecisionId: result.riskDecisionId }, "change rejected via approval model");
      res.status(200).json({
        code: formatChangeRequestCode(crId),
        rejected: true,
        // A customer rejection assigns a risk; an MSP one does not.
        riskAssigned: result.riskDecisionId !== null,
      });
    } catch (err) {
      log.error({ err, customerId, crId }, "POST /portal/change-control/:code/reject failed");
      res.status(500).json({ error: "Failed to reject the change" });
    }
  },
);

export default router;
