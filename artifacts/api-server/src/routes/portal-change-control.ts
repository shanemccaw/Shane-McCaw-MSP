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
import { db, changeFreezeWindowsTable, changeMaintenanceWindowsTable, crApprovalsTable, mspChangeRequestsTable, usersTable, type CrApproval } from "@workspace/db";
import { and, asc, desc, eq, or } from "drizzle-orm";
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
import { loadApprovalPolicy, recordApproval } from "../lib/portal-change-approvals-store";
import { recordRejection } from "../lib/portal-change-rejection";
import { raiseChangeRequest, RaiseChangeRequestError } from "../lib/portal-change-control-raise";
import { dependencyEdgesForMany, type DependencyEdges } from "../lib/portal-change-dependencies-store";
import {
  addAttachment,
  addComment,
  listAttachmentsForChangeIds,
  listCommentsForChangeIds,
  listEventsForChangeIds,
} from "../lib/portal-change-timeline-store";
import { computeChangeMetrics } from "../lib/portal-change-metrics";
import { logger } from "../lib/logger";
import {
  CHANGE_CLASSES,
  EMERGENCY_LOOKBACK_DAYS,
  SNAPSHOT_RETENTION_DAYS,
  approvalLines,
  canApprove,
  canRollback,
  displayChangeClass,
  displayImplementer,
  displayIntake,
  displayRiskLevel,
  displayStatus,
  formatChangeRequestCode,
  formatSnapshotJson,
  isOpenStatus,
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
  /**
   * #1762 — the booked execution window as a REAL instant, additive alongside
   * `window` (the free-text human label). BOTH null when no real instant was
   * booked; `window` still carries whatever the human typed. These are what a
   * freeze check, a date-ordering, or an SLA-vs-execution check can evaluate;
   * `window` is not, and stays the display label. ISO-8601 UTC strings.
   */
  readonly scheduledStart: string | null;
  readonly scheduledEnd: string | null;
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
   * #1541 — the structured counterpart to `linkedFinding` above: the exact
   * remediation checkKey this CR was raised to fix, when it was raised from a
   * remediation item. NULL for a hand-typed wizard submission with no item
   * behind it. This is what the reveal gate (`remediation-reveal-gate.ts`)
   * matches against the caller's checkKey — exposed here so the register can
   * show a CR is the one authorizing a given item's script, not because
   * anything renders it as prose yet.
   */
  readonly remediationCheckKey: string | null;
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
   * #1497 — the wf_run executing this change, when an approved CR authorized a
   * write through the Change Control gate. NULL until the change is executed;
   * once its run completes the CR moves to `Implemented`. This is the link that
   * makes an authorized change traceable from the register to the execution that
   * carried it out (and, downstream, to the drift the execution attributes).
   */
  readonly executorRunId: number | null;
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
  /**
   * #1504 — `blocked_by` dependencies on this change, in both directions.
   * `blockedBy` is what this CR is still waiting on (non-empty means it
   * cannot yet authorize a write — see `change-control-write-gate.ts`);
   * `blocks` is what is waiting on THIS CR. Both empty on the overwhelming
   * majority of CRs, which have no dependency edges at all.
   */
  readonly blockedBy: readonly WireDependencyRef[];
  readonly blocks: readonly WireDependencyRef[];
}

/**
 * One `change_request_dependencies` edge, from the OTHER CR's point of view.
 * `status` is the raw STORED status (`pending_approval`, `completed`, …), not
 * the display-formatted one `toWire` derives elsewhere — the dependency store
 * does not load `approvedBy` for the other side, so it cannot derive the
 * display label without a second round trip this reference isn't worth.
 */
interface WireDependencyRef {
  readonly code: string;
  readonly status: string;
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
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  impactedUsersCount: number;
  status: string;
  backupVerified: boolean;
  preChangeSnapshot: unknown;
  proposedPayload: unknown;
  executedAt: string | null;
  approvedBy: string | null;
  linkedFinding: string | null;
  remediationCheckKey: string | null;
  intake: string | null;
  implementer: string | null;
  sourceGraphMessageId: string | null;
  executorRunId: number | null;
  createdAt: Date;
}

/** Per-request context for the caller-relative `canApproveNow` computation. */
interface ApprovalViewerContext {
  readonly now: Date;
  readonly callerCanApprove: boolean;
  readonly callerEmail: string;
  /** This tenant's `portal_change_control_policy.required_signatures` (#1759),
   *  or null when it has no policy row — floors the stage count. */
  readonly requiredSignatures: number | null;
  /** This tenant's `portal_change_control_policy.require_separate_approver`
   *  (#1759). When false, the requester may approve their own change, so the
   *  affordance is not hidden from them. */
  readonly requireSeparateApprover: boolean;
}

function toWire(
  row: ChangeRequestRow,
  approvals: readonly CrApproval[],
  ctx: ApprovalViewerContext,
  dependencies: DependencyEdges = { blockedBy: [], blocks: [] },
): WireChangeRequest {
  const changeClass = displayChangeClass(row.changeClass);
  const status = displayStatus(row.status, row.approvedBy);
  const required = requiredStages(row.changeClass as never, row.riskLevel as never, ctx.requiredSignatures);
  const approvalState = summarizeApprovals(approvals, required, ctx.now);
  const approvalRecords = approvals.map((a) => toWireApproval(a, ctx.now));
  // The caller may act only if they carry the capability, a stage is pending,
  // and — when the tenant's policy requires a separate approver (#1759) — they
  // are not the requester. The store re-checks all of this server-side; this
  // only decides whether to show the affordance.
  const requesterEmail = (row.requestedBy ?? "").trim().toLowerCase();
  const isRequester = requesterEmail.length > 0 && requesterEmail === ctx.callerEmail.trim().toLowerCase();
  const blockedAsRequester = ctx.requireSeparateApprover && isRequester;
  const canApproveNow =
    ctx.callerCanApprove && approvalState.nextStage !== null && !approvalState.rejectedTerminal && !blockedAsRequester;
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
    scheduledStart: row.scheduledStart ? row.scheduledStart.toISOString() : null,
    scheduledEnd: row.scheduledEnd ? row.scheduledEnd.toISOString() : null,
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
    remediationCheckKey: row.remediationCheckKey,
    intake: displayIntake(row.intake),
    implementer: displayImplementer(row.implementer),
    sourceGraphMessageId: row.sourceGraphMessageId,
    executorRunId: row.executorRunId,
    createdAt: row.createdAt.toISOString(),
    approvalRecords,
    approvalState,
    canApproveNow,
    blockedBy: dependencies.blockedBy.map((e) => ({ code: e.otherChangeRequestCode, status: e.otherStatus })),
    blocks: dependencies.blocks.map((e) => ({ code: e.otherChangeRequestCode, status: e.otherStatus })),
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
 * "In the next window": #1762 added a REAL booked-window instant
 * (`scheduled_start`), so where changes carry one this card is now genuinely
 * date-ordered — the earliest UPCOMING start wins, and the count is how many
 * changes share that same instant. Where no open change carries a real instant,
 * it falls back to the pre-#1762 behaviour: grouping by the exact free-text
 * `window` string and reporting the largest such group, labelled with that
 * group's real text. `scheduled_for` was ("Thu 27 Aug · 07:00–09:00 BST",
 * "Awaiting records sign-off — no window booked") — prose that cannot be
 * sorted, so the fallback does not pretend to be date-ordered: `stats` carries
 * `nextWindowDateOrdered` telling the caller which path produced the number.
 */
function buildStats(wire: readonly WireChangeRequest[], now: Date) {
  const open = wire.filter((c) => isOpenStatus(c.status));
  const awaitingApproval = wire.filter((c) => c.status === "Pending approval").length;

  // #1762 — date-order when real instants exist. The earliest UPCOMING
  // `scheduled_start` is the next window; changes sharing that exact instant are
  // the ones landing in it. Only fires when at least one open change carries a
  // real, still-future instant.
  const upcoming = open
    .filter((c) => c.scheduledStart !== null && new Date(c.scheduledStart).getTime() >= now.getTime())
    .sort((a, b) => new Date(a.scheduledStart!).getTime() - new Date(b.scheduledStart!).getTime());

  let nextWindowLabel = "No window booked";
  let nextWindowCount = 0;
  let nextWindowDateOrdered = false;
  if (upcoming.length > 0) {
    const earliest = upcoming[0].scheduledStart!;
    const group = upcoming.filter((c) => c.scheduledStart === earliest);
    nextWindowCount = group.length;
    nextWindowLabel = group[0].window.trim() || "No window booked";
    nextWindowDateOrdered = true;
  } else {
    // Fallback: no real instants — group by the exact free-text window string
    // and report the largest group. NOT date-ordered, and flagged as such.
    const byWindow = new Map<string, number>();
    for (const c of open) {
      const key = c.window.trim();
      if (!key) continue;
      byWindow.set(key, (byWindow.get(key) ?? 0) + 1);
    }
    for (const [label, count] of byWindow) {
      if (count > nextWindowCount) {
        nextWindowCount = count;
        nextWindowLabel = label;
      }
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
    // #1762 — true when the number above came from real `scheduled_start`
    // instants (chronological), false when it fell back to string grouping.
    nextWindowDateOrdered,
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
          scheduledStart: mspChangeRequestsTable.scheduledStart,
          scheduledEnd: mspChangeRequestsTable.scheduledEnd,
          impactedUsersCount: mspChangeRequestsTable.impactedUsersCount,
          status: mspChangeRequestsTable.status,
          backupVerified: mspChangeRequestsTable.backupVerified,
          preChangeSnapshot: mspChangeRequestsTable.preChangeSnapshot,
          proposedPayload: mspChangeRequestsTable.proposedPayload,
          executedAt: mspChangeRequestsTable.executedAt,
          approvedBy: mspChangeRequestsTable.approvedBy,
          linkedFinding: mspChangeRequestsTable.linkedFinding,
          remediationCheckKey: mspChangeRequestsTable.remediationCheckKey,
          intake: mspChangeRequestsTable.intake,
          implementer: mspChangeRequestsTable.implementer,
          sourceGraphMessageId: mspChangeRequestsTable.sourceGraphMessageId,
          executorRunId: mspChangeRequestsTable.executorRunId,
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
      // #1759 — the tenant's approval policy is authoritative. It floors how many
      // signatures a change needs and decides whether the requester may sign; the
      // register read reflects both so the affordance matches what the store will
      // actually enforce.
      const [callerCanApprove, policy, dependenciesByCr] = await Promise.all([
        callerCanApproveChanges(req),
        loadApprovalPolicy(customerId),
        // #1504 — one bulk pair of queries for the whole page's blocked_by edges.
        dependencyEdgesForMany(crIds, scope.mspId),
      ]);
      const ctx: ApprovalViewerContext = {
        now,
        callerCanApprove,
        callerEmail: req.user?.email ?? "",
        requiredSignatures: policy.requiredSignatures,
        requireSeparateApprover: policy.requireSeparateApprover,
      };

      const requests = rows.map((row) =>
        toWire(row, approvalsByCr.get(row.id) ?? [], ctx, dependenciesByCr.get(row.id)),
      );
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
  // #1762 — the booked window as a REAL instant, additive alongside `window`
  // (the required free-text label). Optional ISO-8601; when a start is given the
  // freeze calendar can evaluate the change's own booked window, not just submit
  // time. When both are given, end must be after start.
  scheduledStart: z.string().datetime({ offset: true }).optional(),
  scheduledEnd: z.string().datetime({ offset: true }).optional(),
  // #1500 — the ONLY way through an active freeze window: a written
  // justification, submitted with the change itself. Absent/blank means "no
  // exception requested", which is what a submission during a freeze needs.
  freezeException: z.object({ justification: z.string().trim().min(1).max(2_000) }).optional(),
  // #1541 — set only when this CR is raised FROM a remediation item (the
  // structured counterpart to the free-text `linkedFinding` below). Absent for
  // every hand-typed wizard submission with no remediation item behind it,
  // which is every submission today — nothing in this codebase sends it yet
  // (see the CR gate's own header). Accepting it here is what lets a future
  // "raise a change for this fix" affordance produce a CR the reveal gate can
  // actually resolve, without a second create path.
  remediationCheckKey: z.string().trim().min(1).max(200).optional(),
}).refine(
  (d) => !(d.scheduledStart && d.scheduledEnd) || new Date(d.scheduledEnd).getTime() > new Date(d.scheduledStart).getTime(),
  { message: "Scheduled end must be after scheduled start", path: ["scheduledEnd"] },
);

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

    const body = parsed.data;
    try {
      // #1941 — the actual insert/freeze-gate/approval-materialisation/
      // risk-discharge logic moved to `lib/portal-change-control-raise.ts` so
      // the "raise a change for this fix" checklist affordance can reuse it
      // instead of a second create path. See that file's header.
      const result = await raiseChangeRequest(customerId, req.user!, {
        title: body.title,
        target: body.target,
        ticket: body.ticket,
        pre: parseJsonField(body.pre),
        post: parseJsonField(body.post),
        changeClass: body.changeClass,
        impactedUsersCount: body.impactedUsersCount,
        window: body.window,
        scheduledStart: body.scheduledStart,
        scheduledEnd: body.scheduledEnd,
        freezeException: body.freezeException,
        remediationCheckKey: body.remediationCheckKey,
      });
      res.status(201).json(result);
    } catch (err) {
      if (err instanceof RaiseChangeRequestError) {
        res.status(err.status).json({ error: err.message, ...err.body });
        return;
      }
      log.error({ err, customerId }, "POST /portal/change-control failed");
      res.status(500).json({ error: "Failed to raise the change request" });
    }
  },
);

// ── Freeze calendar, read-only (#1500) ───────────────────────────────────────
//
// This tenant's own active freeze windows — global, their own tenant, or any
// workload — so a future page can show "here is what is frozen right now" the
// same way the wizard is blocked from submitting into it. Gated identically to
// the register read: CustomerUser + the change_control entitlement, since
// seeing the freeze calendar is part of the same approval experience.
interface WireFreezeWindow {
  readonly id: number;
  readonly scope: string;
  readonly workload: string | null;
  readonly name: string;
  readonly reason: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly recurrence: string;
  readonly recurrenceUntil: string | null;
}

function toWireFreezeWindow(row: {
  id: number;
  scope: string;
  workload: string | null;
  name: string;
  reason: string | null;
  startsAt: Date;
  endsAt: Date;
  recurrence: string;
  recurrenceUntil: Date | null;
}): WireFreezeWindow {
  return {
    id: row.id,
    scope: row.scope,
    workload: row.workload,
    name: row.name,
    reason: row.reason,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    recurrence: row.recurrence,
    recurrenceUntil: row.recurrenceUntil ? row.recurrenceUntil.toISOString() : null,
  };
}

router.get(
  "/portal/change-control/freeze-windows",
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
        res.json({ windows: [] });
        return;
      }
      const rows = await db
        .select()
        .from(changeFreezeWindowsTable)
        .where(
          and(
            eq(changeFreezeWindowsTable.mspId, scope.mspId),
            eq(changeFreezeWindowsTable.active, true),
            or(
              eq(changeFreezeWindowsTable.scope, "global"),
              and(eq(changeFreezeWindowsTable.scope, "tenant"), eq(changeFreezeWindowsTable.tenantId, scope.tenantId)),
              eq(changeFreezeWindowsTable.scope, "workload"),
            ),
          ),
        )
        .orderBy(asc(changeFreezeWindowsTable.startsAt));
      res.json({ windows: rows.map(toWireFreezeWindow) });
    } catch (err) {
      log.error({ err, customerId }, "GET /portal/change-control/freeze-windows failed");
      res.status(500).json({ error: "Failed to load the freeze calendar" });
    }
  },
);

// ── Maintenance calendar, read-only (#1504) ──────────────────────────────────
//
// The maintenance-window counterpart to the freeze-windows read above — same
// shape, same scoping, OPPOSITE meaning: these are the windows change is
// EXPECTED in, not forbidden from. Gated identically to the freeze read.
interface WireMaintenanceWindow {
  readonly id: number;
  readonly scope: string;
  readonly workload: string | null;
  readonly name: string;
  readonly reason: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly recurrence: string;
  readonly recurrenceUntil: string | null;
}

function toWireMaintenanceWindow(row: {
  id: number;
  scope: string;
  workload: string | null;
  name: string;
  reason: string | null;
  startsAt: Date;
  endsAt: Date;
  recurrence: string;
  recurrenceUntil: Date | null;
}): WireMaintenanceWindow {
  return {
    id: row.id,
    scope: row.scope,
    workload: row.workload,
    name: row.name,
    reason: row.reason,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    recurrence: row.recurrence,
    recurrenceUntil: row.recurrenceUntil ? row.recurrenceUntil.toISOString() : null,
  };
}

router.get(
  "/portal/change-control/maintenance-windows",
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
        res.json({ windows: [] });
        return;
      }
      const rows = await db
        .select()
        .from(changeMaintenanceWindowsTable)
        .where(
          and(
            eq(changeMaintenanceWindowsTable.mspId, scope.mspId),
            eq(changeMaintenanceWindowsTable.active, true),
            or(
              eq(changeMaintenanceWindowsTable.scope, "global"),
              and(eq(changeMaintenanceWindowsTable.scope, "tenant"), eq(changeMaintenanceWindowsTable.tenantId, scope.tenantId)),
              eq(changeMaintenanceWindowsTable.scope, "workload"),
            ),
          ),
        )
        .orderBy(asc(changeMaintenanceWindowsTable.startsAt));
      res.json({ windows: rows.map(toWireMaintenanceWindow) });
    } catch (err) {
      log.error({ err, customerId }, "GET /portal/change-control/maintenance-windows failed");
      res.status(500).json({ error: "Failed to load the maintenance calendar" });
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
        actorPersonId: req.user ? personIdForUser(req.user.id) : undefined,
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

/**
 * The CR essentials both decision routes load, scoped to the caller's tenant. The
 * return type is INFERRED from the select so `changeClass`/`riskLevel`/`status`
 * keep their real enum types (what `CrEssentials` expects), not a widened string.
 */
async function loadScopedChange(crId: number, mspId: number, tenantId: string) {
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

      const policy = await loadApprovalPolicy(customerId);
      const result = await recordApproval(cr, approverIdentity(req, customerId), parsed.data.note ?? null, policy);
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

      const policy = await loadApprovalPolicy(customerId);
      const result = await recordRejection(cr, approverIdentity(req, customerId), parsed.data.reason, policy);
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

// ── Timeline: events, comments, attachments (#1503) ──────────────────────────
//
// The register had no per-CR history at all — "Add a comment" was one of five
// dead buttons in the retired prototype. All three floor at the same
// CustomerUser + change_control entitlement as the register read and the
// approve/reject/decline actions above: this is part of the same approval
// experience, not a separate free surface.
//
// `cr_events` has NO write route here — it is system-authored only, appended
// exclusively from the approval/rejection/execution transitions above and in
// `msp-changes.ts`'s PATCH. A customer or operator never posts an event
// directly; they post a COMMENT, which is a different table for a reason (see
// `lib/db/src/schema/msp.ts`'s header on the three tables).

interface WireCrEvent {
  readonly eventType: string;
  readonly fromValue: string | null;
  readonly toValue: string;
  readonly stage: number | null;
  readonly actorRole: string;
  readonly actorName: string | null;
  readonly reason: string | null;
  readonly occurredAt: string;
}

interface WireCrComment {
  readonly authorRole: string;
  readonly authorName: string;
  readonly body: string;
  readonly createdAt: string;
}

interface WireCrAttachment {
  readonly kind: string;
  readonly label: string;
  readonly externalUrl: string | null;
  readonly mimeType: string | null;
  readonly sizeBytes: number | null;
  readonly uploadedByRole: string;
  readonly uploadedByName: string;
  readonly createdAt: string;
}

router.get(
  "/portal/change-control/:code/timeline",
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
    try {
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

      const [events, comments, attachments] = await Promise.all([
        listEventsForChangeIds([crId]),
        listCommentsForChangeIds([crId]),
        listAttachmentsForChangeIds([crId]),
      ]);

      res.json({
        code: formatChangeRequestCode(crId),
        events: events.map((e): WireCrEvent => ({
          eventType: e.eventType,
          fromValue: e.fromValue,
          toValue: e.toValue,
          stage: e.stage,
          actorRole: e.actorRole,
          actorName: e.actorName,
          reason: e.reason,
          occurredAt: e.occurredAt.toISOString(),
        })),
        comments: comments.map((c): WireCrComment => ({
          authorRole: c.authorRole,
          authorName: c.authorName,
          body: c.body,
          createdAt: c.createdAt.toISOString(),
        })),
        attachments: attachments.map((a): WireCrAttachment => ({
          kind: a.kind,
          label: a.label,
          externalUrl: a.externalUrl,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          uploadedByRole: a.uploadedByRole,
          uploadedByName: a.uploadedByName,
          createdAt: a.createdAt.toISOString(),
        })),
      });
    } catch (err) {
      log.error({ err, customerId, crId }, "GET /portal/change-control/:code/timeline failed");
      res.status(500).json({ error: "Failed to load the change's timeline" });
    }
  },
);

const commentSchema = z.object({ body: z.string().trim().min(1).max(4_000) });

router.post(
  "/portal/change-control/:code/comments",
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
    const parsed = commentSchema.safeParse(req.body);
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
      const cr = await loadScopedChange(crId, scope.mspId, scope.tenantId);
      if (!cr) {
        res.status(404).json({ error: "Change request not found" });
        return;
      }
      const approver = approverIdentity(req, customerId);
      const comment = await addComment({
        changeRequestId: crId,
        mspId: scope.mspId,
        tenantId: scope.tenantId,
        authorRole: approver.role,
        authorPersonId: approver.personId,
        authorName: approver.name,
        body: parsed.data.body,
      });
      res.status(201).json({
        code: formatChangeRequestCode(crId),
        comment: { authorRole: comment.authorRole, authorName: comment.authorName, body: comment.body, createdAt: comment.createdAt.toISOString() } satisfies WireCrComment,
      });
    } catch (err) {
      log.error({ err, customerId, crId }, "POST /portal/change-control/:code/comments failed");
      res.status(500).json({ error: "Failed to add the comment" });
    }
  },
);

const attachmentSchema = z.object({
  kind: z.enum(["evidence", "test_result", "approval_email", "other"]).default("other"),
  label: z.string().trim().min(1).max(200),
  externalUrl: z.string().trim().url().max(2_000).optional(),
  mimeType: z.string().trim().max(120).optional(),
  sizeBytes: z.number().int().min(0).max(1_000_000_000).optional(),
});

router.post(
  "/portal/change-control/:code/attachments",
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
    const parsed = attachmentSchema.safeParse(req.body);
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
      const cr = await loadScopedChange(crId, scope.mspId, scope.tenantId);
      if (!cr) {
        res.status(404).json({ error: "Change request not found" });
        return;
      }
      const approver = approverIdentity(req, customerId);
      const attachment = await addAttachment({
        changeRequestId: crId,
        mspId: scope.mspId,
        tenantId: scope.tenantId,
        kind: parsed.data.kind,
        label: parsed.data.label,
        externalUrl: parsed.data.externalUrl ?? null,
        mimeType: parsed.data.mimeType ?? null,
        sizeBytes: parsed.data.sizeBytes ?? null,
        uploadedByRole: approver.role,
        uploadedByPersonId: approver.personId,
        uploadedByName: approver.name,
      });
      res.status(201).json({
        code: formatChangeRequestCode(crId),
        attachment: {
          kind: attachment.kind,
          label: attachment.label,
          externalUrl: attachment.externalUrl,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          uploadedByRole: attachment.uploadedByRole,
          uploadedByName: attachment.uploadedByName,
          createdAt: attachment.createdAt.toISOString(),
        } satisfies WireCrAttachment,
      });
    } catch (err) {
      log.error({ err, customerId, crId }, "POST /portal/change-control/:code/attachments failed");
      res.status(500).json({ error: "Failed to record the attachment" });
    }
  },
);

// ── Change metrics (Git #1506) ───────────────────────────────────────────────
//
// The KPIs an MSP sells the change-control program on: change success rate,
// failed-change rate, emergency-change ratio, lead time, CAB throughput. All
// real aggregates over `cr_events`/`cr_executions`/`cab_agenda_items` — see
// `lib/portal-change-metrics.ts` for the formulas and the honesty rule (a
// metric with no qualifying events reads as unavailable, never as zero).
//
// Same middleware pair as the register read and the timeline: this is a view
// over the same customer-scoped Change Control data, gated the same way —
// CustomerUser + an active `change_control` entitlement.

interface WireRateMetric {
  readonly available: boolean;
  readonly rate: number | null;
  readonly numerator: number;
  readonly denominator: number;
}

interface WireDurationMetric {
  readonly available: boolean;
  readonly averageHours: number | null;
  readonly medianHours: number | null;
  readonly sampleSize: number;
}

interface WireCabThroughputMetric {
  readonly available: boolean;
  readonly meetingsHeld: number;
  readonly itemsDecided: number;
  readonly itemsDeferred: number;
  readonly averageDecisionLatencyHours: number | null;
}

interface WireChangeMetrics {
  readonly changeSuccessRate: WireRateMetric;
  readonly failedChangeRate: WireRateMetric;
  readonly emergencyChangeRatio: WireRateMetric;
  readonly leadTime: WireDurationMetric;
  readonly cabThroughput: WireCabThroughputMetric;
}

router.get(
  "/portal/change-control/metrics",
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
        res.status(409).json({ error: "This account has no connected Microsoft 365 tenant" });
        return;
      }
      const metrics = await computeChangeMetrics({ mspId: scope.mspId, tenantId: scope.tenantId });
      res.json({ metrics: metrics satisfies WireChangeMetrics });
    } catch (err) {
      log.error({ err, customerId }, "GET /portal/change-control/metrics failed");
      res.status(500).json({ error: "Failed to compute change metrics" });
    }
  },
);

export default router;
