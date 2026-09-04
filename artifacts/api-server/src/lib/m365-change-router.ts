/**
 * m365-change-router.ts — the M365 Changes ROUTING layer (Git #1534, part of
 * #1494).
 *
 * The third stage of the pipeline, after interpretation (#1532, WHAT a change is)
 * and resolution (#1533, HOW MANY objects it touches for one tenant). Routing
 * decides what a resolved change BECOMES and records that decision durably.
 *
 * ── The gate (Shane's settled rule, #1534 2026-08-28) ──────────────────────
 * For each (confirmed interpretation × tenant) that has a resolution:
 *   • measured, affected_count > 0, AND a real structural date on the tenant's
 *     Message Center post  → AUTO-CREATE a Change Request, with Microsoft as the
 *     implementer. Per #1497 every change gets a CR including auto-approved ones,
 *     and a Microsoft change the tenant cannot refuse is a CR from the moment it
 *     is announced.
 *   • undated (incl. #1536's "date unclear"), no tenant announcement yet, OR
 *     zero affected objects  → PROPOSE a CR only. Nothing is created; the ledger
 *     row IS the proposal.
 *   • not measured  → route nothing yet (decision 'none'); the honest "your
 *     tenant has not been read against this notice" state stands.
 *   • a routed CR the customer later declines  → an accepted risk (#1514), via
 *     declineRoutedChangeToRisk() below.
 *
 * This gate is the ONLY noise control. There is deliberately no second
 * suppression mechanism — `portal-message-center.ts` stays read-only, and the
 * decision of what becomes a CR lives here and nowhere else.
 *
 * ── The intake axis (#1534) ────────────────────────────────────────────────
 * A routed CR carries an `intake` derived from the interpretation's `who_acts` /
 * `controllable` (#1532): informed (forced, acknowledge only), approval (a
 * control exists — a real decision), or advisory (requires work). Intake is the
 * axis #1494's timeline UI reads as "do I have to act", distinct from the ITIL
 * change_class.
 *
 * ── Idempotent ─────────────────────────────────────────────────────────────
 * One routing decision per (interpretation × customer), upserted. A CR is created
 * exactly once: the ledger's change_request_id plus a partial unique index on
 * msp_change_requests(source_interpretation_id, tenant_id) both guard it, so the
 * nightly sweep re-running never doubles a CR. A decision that has reached the
 * terminal customer states (auto_created with a CR, or declined_risk) is never
 * rewound by a later sweep.
 *
 * Every automated pass is a visible Workflow Engine node (m365_route_changes),
 * seeded as "__system__: M365 Changes Routing" — no bare scheduler.
 */

import {
  db,
  m365ChangeInterpretationsTable,
  m365ChangeResolutionsTable,
  m365ChangeRoutingsTable,
  mspChangeRequestsTable,
  mspMessageCenterItemsTable,
  mspRiskDecisionsTable,
  tenantsTable,
  type ChangeRequestImplementer,
  type ChangeRequestIntake,
  type M365ChangeInterpretation,
  type M365ChangeResolution,
  type M365ResolutionStatus,
  type M365RoutingDecision,
  type M365RoutingReason,
  type MspChangeRequest,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";

import {
  categoryForWorkload,
  computeRiskLevel,
  deriveWorkloadFromTouches,
  displayChangeClass,
  formatChangeRequestCode,
  type ChangeClass,
} from "./portal-change-control";
import { materializeApprovalsForChange } from "./portal-change-approvals-store";
import { assignRegisterRef } from "./risk-register-ref";
import { recordCrEvent } from "./portal-change-timeline-store";
import { logger } from "./logger";

const log = logger.child({ channel: "workflow.change-control" });

// ── Pure decision functions (unit-tested, no database) ───────────────────────

/**
 * The intake axis for an interpretation (#1534). Precedence follows Shane's
 * table exactly: a control existing (`controllable: yes`) is the disableable
 * "approval" case regardless of who acts; failing that, an admin having to act is
 * the "advisory" (requires work) case; everything else is Microsoft acting with
 * no opt-out — "informed".
 */
export function deriveIntake(
  interp: Pick<M365ChangeInterpretation, "whoActs" | "controllable">,
): ChangeRequestIntake {
  if (interp.controllable === "yes") return "approval";
  if (interp.whoActs === "admin") return "advisory";
  return "informed";
}

/**
 * Who implements the change. Mirrors `who_acts`: an admin-driven change (the
 * advisory / migration case) is implemented by the customer's own team; every
 * other routed Microsoft change is implemented by Microsoft — the headline of
 * #1534.
 */
export function deriveImplementer(
  interp: Pick<M365ChangeInterpretation, "whoActs">,
): ChangeRequestImplementer {
  return interp.whoActs === "admin" ? "customer" : "microsoft";
}

/**
 * The ITIL change_class a routed CR is stored under. `informed` is auto-approved
 * and low-ceremony, so it maps to `standard` (a pre-approved standard change);
 * approval and advisory both need a human, so `normal`. The honest "nobody
 * pre-authorised this" nuance is carried by the dedicated `intake` column, not by
 * overloading the three-value change_class enum.
 */
export function changeClassForIntake(intake: ChangeRequestIntake): "standard" | "normal" {
  return intake === "informed" ? "standard" : "normal";
}

export interface RoutingInputs {
  readonly resolutionStatus: M365ResolutionStatus;
  readonly affectedCount: number | null;
  /** Does a Message Center post for this change exist in the tenant's own feed? */
  readonly hasAnnouncement: boolean;
  /** Does that post carry a real structural date (actionRequiredBy / rollout-end)? */
  readonly hasStructuralDate: boolean;
}

export interface RoutingDecision {
  readonly decision: Exclude<M365RoutingDecision, "declined_risk">;
  readonly reason: M365RoutingReason;
}

/**
 * The pure gate. `declined_risk` is NOT produced here — it is a later transition
 * driven by a customer's rejection (declineRoutedChangeToRisk), never by the
 * sweep.
 */
export function decideRouting(input: RoutingInputs): RoutingDecision {
  // Can't route what we haven't counted. A not-measured / errored resolution
  // leaves the honest "not read against this notice" state in place.
  if (input.resolutionStatus !== "measured" || input.affectedCount === null) {
    return { decision: "none", reason: "not_measured" };
  }
  // A MEASURED zero: the change touches nothing counted in this estate. Per
  // #1534 this proposes rather than auto-creates — surfaced for a human, never
  // silently turned into a CR.
  if (input.affectedCount === 0) {
    return { decision: "proposed", reason: "zero_affected" };
  }
  // measured, non-zero from here down.
  if (!input.hasAnnouncement) {
    return { decision: "proposed", reason: "no_announcement" };
  }
  if (!input.hasStructuralDate) {
    return { decision: "proposed", reason: "undated" };
  }
  return { decision: "auto_created", reason: "auto_created" };
}

/** A risk score for a stored risk level — declining a change accepts it whole, so residual == raw. */
export function riskScoreForLevel(level: string): number {
  switch (level) {
    case "critical":
      return 100;
    case "high":
      return 75;
    case "medium":
      return 50;
    default:
      return 25;
  }
}

/** The readable target string for a routed CR — the interpretation's real touches, never invented. */
export function targetResourceForInterpretation(
  interp: Pick<M365ChangeInterpretation, "touches" | "title">,
): string {
  const t = interp.touches ?? { services: [], protocols: [], skus: [], settings: [] };
  const parts = [...(t.services ?? []), ...(t.protocols ?? []), ...(t.skus ?? []), ...(t.settings ?? [])]
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts.length > 0 ? Array.from(new Set(parts)).join(", ") : interp.title;
}

// ── CR creation for a routed change ──────────────────────────────────────────

const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/** "1 October 2026" — the structural date, formatted for the CR's `scheduled_for` prose. */
function formatStructuralDate(d: Date): string {
  return `${d.getUTCDate()} ${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

interface TenantIdentity {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly primaryDomain: string;
}

/** One measured, dated, non-zero resolution's own announcement date. */
interface AnnouncementDates {
  readonly actionRequiredByDateTime: Date | null;
  readonly endDateTime: Date | null;
}

function structuralDate(a: AnnouncementDates): Date | null {
  return a.actionRequiredByDateTime ?? a.endDateTime ?? null;
}

/**
 * Insert the auto-routed Change Request. Returns the new CR id, or the id of the
 * one that already exists for this (interpretation × tenant) if a concurrent
 * pass beat us to the partial unique index — so this is safe to call more than
 * once and never creates a duplicate.
 */
export async function createRoutedChangeRequest(input: {
  interpretation: M365ChangeInterpretation;
  resolution: M365ChangeResolution;
  tenant: TenantIdentity;
  announcement: AnnouncementDates | null;
  graphMessageId: string | null;
}): Promise<number> {
  const { interpretation, resolution, tenant, announcement, graphMessageId } = input;

  const intake = deriveIntake(interpretation);
  const implementer = deriveImplementer(interpretation);
  const storedChangeClass = changeClassForIntake(intake);
  const affected = resolution.affectedCount ?? 0;
  const target = targetResourceForInterpretation(interpretation);

  const displayCc: ChangeClass = displayChangeClass(storedChangeClass);
  const risk = computeRiskLevel({ changeClass: displayCc, targetResource: target, impactedUsersCount: affected });
  const storedRisk = risk === "High" ? "high" : risk === "Medium" ? "medium" : "low";
  // #1700: workload/category is read off the interpretation's own structured
  // `touches` (its real service/workload signal), never off `target` — that
  // string is a comma-joined display string built for humans, not the
  // technical cmdlet/endpoint pattern `deriveWorkload` expects, and matching
  // it against those patterns silently fell through to Identity.
  const category = categoryForWorkload(deriveWorkloadFromTouches(interpretation.touches));

  const dueDate = announcement ? structuralDate(announcement) : null;
  const scheduledFor = dueDate
    ? `Microsoft rollout — by ${formatStructuralDate(dueDate)}`
    : "Microsoft rollout — no date published";

  // An `informed` change is forced: the tenant cannot refuse it, so it is
  // auto-approved from the moment it is announced (#1497). `approvedBy` set to
  // Microsoft makes displayStatus() read "Approved". Approval/advisory intakes
  // leave it null — those need a real human decision or plan.
  const approvedBy = intake === "informed" ? "Microsoft (auto-approved — forced change)" : null;

  const summary = interpretation.summary?.trim();
  const description = [
    summary && summary.length > 0 ? summary : `Microsoft 365 change: ${interpretation.title}.`,
    `Routed automatically from the Microsoft 365 Message Center. ${affected} affected ${affected === 1 ? "object" : "objects"} counted in this tenant.`,
    intake === "informed"
      ? "Microsoft implements this change; no action is required from you. Recorded for audit."
      : intake === "approval"
        ? "A control exists — review whether to leave this on or turn it off."
        : "This requires planning and execution by your team.",
  ].join(" ");

  const provenance = {
    source: "microsoft_change",
    graphMessageId,
    interpretationId: interpretation.id,
    resolutionId: resolution.id,
    affectedCount: affected,
    basis: resolution.basis ?? null,
    intake,
    implementer,
  };

  try {
    const [inserted] = await db
      .insert(mspChangeRequestsTable)
      .values({
        mspId: resolution.mspId,
        tenantId: tenant.tenantId,
        tenantName: tenant.tenantName,
        primaryDomain: tenant.primaryDomain,
        title: interpretation.title,
        description,
        changeClass: storedChangeClass,
        riskLevel: storedRisk,
        category,
        targetResource: target,
        psaTicketId: "Microsoft 365 change — auto-routed",
        requestedBy: "Microsoft 365 change routing",
        requestedAt: new Date().toISOString(),
        scheduledFor,
        // #1762 — the ONE path where a real instant IS honestly known: it comes
        // from Microsoft's OWN structured `actionRequiredBy`/`endDateTime`, not
        // from parsing prose. Populate `scheduled_start` from it so the freeze
        // calendar can evaluate this routed change's booked window. No end is
        // published, so `scheduled_end` stays null; where `dueDate` is null this
        // stays null too — nothing is invented.
        scheduledStart: dueDate,
        impactedUsersCount: affected,
        status: "pending_approval",
        approvedBy,
        // Nothing has executed, so nothing is backed up — same honesty as the
        // customer wizard's own creates (portal-change-control.ts).
        backupVerified: false,
        backupHash: "",
        preChangeSnapshot: {},
        proposedPayload: provenance,
        rollbackScriptSnippet: "",
        linkedFinding: `Microsoft 365 Message Center · ${interpretation.title}`,
        // ── routing fields (#1534) ──
        intake,
        implementer,
        sourceKind: "microsoft_change",
        sourceGraphMessageId: graphMessageId,
        sourceInterpretationId: interpretation.id,
        sourceResolutionId: resolution.id,
      })
      .returning({ id: mspChangeRequestsTable.id, createdAt: mspChangeRequestsTable.createdAt });

    // #1503 — every CR-creation path emits the `raised` event that opens its
    // timeline, regardless of whether an approval record ever materialises.
    await recordCrEvent({
      changeRequestId: inserted.id,
      mspId: resolution.mspId,
      tenantId: tenant.tenantId,
      eventType: "raised",
      fromValue: null,
      toValue: "pending_approval",
      actorRole: "microsoft",
      actorName: "Microsoft 365 change routing",
      occurredAt: inserted.createdAt,
    });

    // #1496 — a routed change produces its real approval record too. An
    // `informed` (forced) change arrives auto-approved, so this records ONE
    // `microsoft_forced` approved row; an approval/advisory routed change arrives
    // unapproved, so it materialises the pending customer stage(s) with their SLA.
    // Idempotent and non-fatal — the CR already exists if this throws.
    try {
      await materializeApprovalsForChange({
        id: inserted.id,
        mspId: resolution.mspId,
        tenantId: tenant.tenantId,
        changeClass: storedChangeClass,
        riskLevel: storedRisk,
        status: "pending_approval",
        approvedBy,
        requestedBy: "Microsoft 365 change routing",
        createdAt: inserted.createdAt,
      });
    } catch (err) {
      log.warn({ err, crId: inserted.id }, "createRoutedChangeRequest: approval materialisation failed (non-fatal)");
    }
    return inserted.id;
  } catch (err) {
    // The partial unique index on (source_interpretation_id, tenant_id) fired —
    // a CR for this exact change already exists on this tenant. Return its id
    // rather than surfacing a duplicate-key error; routing is idempotent.
    const [existing] = await db
      .select({ id: mspChangeRequestsTable.id })
      .from(mspChangeRequestsTable)
      .where(
        and(
          eq(mspChangeRequestsTable.sourceInterpretationId, interpretation.id),
          eq(mspChangeRequestsTable.tenantId, tenant.tenantId),
        ),
      )
      .limit(1);
    if (existing) {
      log.warn({ interpretationId: interpretation.id, tenantId: tenant.tenantId, crId: existing.id }, "createRoutedChangeRequest: CR already existed, reusing (idempotent)");
      return existing.id;
    }
    throw err;
  }
}

// ── The per-interpretation-per-tenant router ─────────────────────────────────

interface TenantAnnouncement extends TenantIdentity {
  readonly customerId: number;
  readonly hasAnnouncement: boolean;
  readonly announcement: AnnouncementDates | null;
  readonly graphMessageId: string | null;
}

/** Resolve the tenant identity + its Message Center announcement for one resolution. */
async function loadTenantAnnouncement(
  interpretation: M365ChangeInterpretation,
  resolution: M365ChangeResolution,
): Promise<TenantAnnouncement | null> {
  const [tenant] = await db
    .select({
      customerName: tenantsTable.customerName,
      tenantId: tenantsTable.tenantId,
      domain: tenantsTable.domain,
    })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, resolution.customerId))
    .limit(1);
  if (!tenant) return null;

  const identity: TenantIdentity = {
    tenantId: (tenant.tenantId ?? resolution.tenantId ?? "").trim(),
    tenantName: (tenant.customerName ?? "").trim() || `Customer ${resolution.customerId}`,
    primaryDomain: (tenant.domain ?? "").trim(),
  };

  const graphMessageId = interpretation.graphMessageId?.trim() || null;
  if (!graphMessageId) {
    return { ...identity, customerId: resolution.customerId, hasAnnouncement: false, announcement: null, graphMessageId: null };
  }

  const [mc] = await db
    .select({
      actionRequiredByDateTime: mspMessageCenterItemsTable.actionRequiredByDateTime,
      endDateTime: mspMessageCenterItemsTable.endDateTime,
    })
    .from(mspMessageCenterItemsTable)
    .where(
      and(
        eq(mspMessageCenterItemsTable.customerId, resolution.customerId),
        eq(mspMessageCenterItemsTable.graphMessageId, graphMessageId),
      ),
    )
    .limit(1);

  if (!mc) {
    return { ...identity, customerId: resolution.customerId, hasAnnouncement: false, announcement: null, graphMessageId };
  }
  return {
    ...identity,
    customerId: resolution.customerId,
    hasAnnouncement: true,
    announcement: { actionRequiredByDateTime: mc.actionRequiredByDateTime, endDateTime: mc.endDateTime },
    graphMessageId,
  };
}

export interface RouteOneResult {
  customerId: number;
  decision: M365RoutingDecision;
  reason: M365RoutingReason;
  changeRequestId: number | null;
  skipped: boolean;
}

/**
 * Route one resolution (one interpretation × one tenant), upserting the ledger
 * and creating a CR when the gate says auto_created. Terminal customer states
 * (an existing CR, or a declined-to-risk decision) are never rewound.
 */
export async function routeResolution(
  interpretation: M365ChangeInterpretation,
  resolution: M365ChangeResolution,
): Promise<RouteOneResult> {
  const [existing] = await db
    .select()
    .from(m365ChangeRoutingsTable)
    .where(
      and(
        eq(m365ChangeRoutingsTable.interpretationId, interpretation.id),
        eq(m365ChangeRoutingsTable.customerId, resolution.customerId),
      ),
    )
    .limit(1);

  // Never rewind a customer's terminal decision, and never re-create a CR that
  // already exists for this change.
  if (existing?.decision === "declined_risk") {
    return { customerId: resolution.customerId, decision: "declined_risk", reason: existing.reason, changeRequestId: existing.changeRequestId, skipped: true };
  }
  if (existing?.decision === "auto_created" && existing.changeRequestId) {
    return { customerId: resolution.customerId, decision: "auto_created", reason: existing.reason, changeRequestId: existing.changeRequestId, skipped: true };
  }

  const announcement = await loadTenantAnnouncement(interpretation, resolution);
  const hasAnnouncement = announcement?.hasAnnouncement ?? false;
  const hasStructuralDate = announcement?.announcement ? structuralDate(announcement.announcement) !== null : false;

  const { decision, reason } = decideRouting({
    resolutionStatus: resolution.status,
    affectedCount: resolution.affectedCount,
    hasAnnouncement,
    hasStructuralDate,
  });

  const intake = decision === "none" ? null : deriveIntake(interpretation);
  const now = new Date();

  let changeRequestId: number | null = null;
  if (decision === "auto_created" && announcement) {
    changeRequestId = await createRoutedChangeRequest({
      interpretation,
      resolution,
      tenant: { tenantId: announcement.tenantId, tenantName: announcement.tenantName, primaryDomain: announcement.primaryDomain },
      announcement: announcement.announcement,
      graphMessageId: announcement.graphMessageId,
    });
  }

  await db
    .insert(m365ChangeRoutingsTable)
    .values({
      mspId: resolution.mspId,
      customerId: resolution.customerId,
      tenantId: resolution.tenantId,
      interpretationId: interpretation.id,
      resolutionId: decision === "none" ? null : resolution.id,
      graphMessageId: announcement?.graphMessageId ?? null,
      decision,
      reason,
      intake,
      affectedCount: resolution.affectedCount,
      hasStructuralDate,
      changeRequestId,
      routedAt: now,
    })
    .onConflictDoUpdate({
      target: [m365ChangeRoutingsTable.interpretationId, m365ChangeRoutingsTable.customerId],
      set: {
        resolutionId: decision === "none" ? null : resolution.id,
        graphMessageId: announcement?.graphMessageId ?? null,
        decision,
        reason,
        intake,
        affectedCount: resolution.affectedCount,
        hasStructuralDate,
        // Only advance changeRequestId; never clear one already set.
        ...(changeRequestId !== null ? { changeRequestId } : {}),
        routedAt: now,
        updatedAt: now,
      },
    });

  return { customerId: resolution.customerId, decision, reason, changeRequestId, skipped: false };
}

export interface RoutingSweepResult {
  interpretations: number;
  resolutions: number;
  autoCreated: number;
  proposed: number;
  none: number;
}

/**
 * The sweep: every confirmed interpretation × its resolutions, routed. Wired as
 * the m365_route_changes workflow node, seeded on a daily schedule AFTER the
 * resolution sweep so the day's counts land first.
 *
 * `interpretationId` (#1701) scopes the sweep to a single interpretation — the
 * on-demand operator trigger (`POST .../interpretations/:id/route`) fires this
 * same node through the Workflow Engine with that id in the run's trigger
 * payload, so "route now" is the identical code path as the nightly sweep,
 * just narrowed to the interpretation the operator is looking at rather than
 * scheduler bypass. Omitted (the nightly cron's case), it routes every
 * confirmed interpretation exactly as before.
 */
export async function runM365ChangeRoutingSweep(opts: { interpretationId?: number } = {}): Promise<RoutingSweepResult> {
  const filters = [eq(m365ChangeInterpretationsTable.status, "confirmed")];
  if (opts.interpretationId !== undefined) {
    filters.push(eq(m365ChangeInterpretationsTable.id, opts.interpretationId));
  }
  const confirmed = await db
    .select()
    .from(m365ChangeInterpretationsTable)
    .where(and(...filters));

  const result: RoutingSweepResult = { interpretations: confirmed.length, resolutions: 0, autoCreated: 0, proposed: 0, none: 0 };

  for (const interpretation of confirmed) {
    const resolutions = await db
      .select()
      .from(m365ChangeResolutionsTable)
      .where(eq(m365ChangeResolutionsTable.interpretationId, interpretation.id));

    for (const resolution of resolutions) {
      result.resolutions += 1;
      try {
        const routed = await routeResolution(interpretation, resolution);
        if (routed.decision === "auto_created" && !routed.skipped) result.autoCreated += 1;
        else if (routed.decision === "proposed") result.proposed += 1;
        else if (routed.decision === "none") result.none += 1;
      } catch (err) {
        log.warn({ err, interpretationId: interpretation.id, customerId: resolution.customerId }, "m365-change-router: routing failed for one tenant (non-fatal)");
      }
    }
  }

  log.info(result, "m365-change-router: routing sweep complete");
  return result;
}

/**
 * Workflow node handler for the `m365_route_changes` node type
 * (workflow-executor.ts's executeNode switch). `payload.interpretationId`
 * (#1701) is how the on-demand operator trigger narrows this same node's run
 * to one interpretation — the nightly schedule trigger never sets it, so its
 * runs are unaffected.
 */
export async function handleM365RouteChanges(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const interpretationId = typeof payload.interpretationId === "number" ? payload.interpretationId : undefined;
  const r = await runM365ChangeRoutingSweep({ interpretationId });
  return {
    interpretations: r.interpretations,
    resolutions: r.resolutions,
    autoCreated: r.autoCreated,
    proposed: r.proposed,
    routedNone: r.none,
  };
}

// ── Decline → accepted risk (#1514) ──────────────────────────────────────────

export interface DeclineInput {
  /** The CR being declined (numeric msp_change_requests.id). */
  changeRequestId: number;
  mspId: number;
  /**
   * Who declined. A CUSTOMER declining a Microsoft change is accepting the
   * residual risk — the rejection IS the acceptance (#1514) — so a risk record
   * is created. An MSP declining produces NO risk record: nobody accepted
   * anything (different terminal state, #1514).
   */
  declinedBy: "customer" | "msp";
  /** The accepting person, for a customer decline. */
  approverName?: string;
  approverEmail?: string;
  /** The exact sentence the customer agreed to, snapshotted at accept time. */
  statement?: string;
  /** The approval stage this decline lands on, when the caller has one (e.g. via `recordRejection`). Defaults to 1 for a direct decline that never touched the approval ledger. */
  stage?: number;
  /** The acting person's wire id (`personIdForUser`), for the cr_events actor. */
  actorPersonId?: string;
}

export interface DeclineResult {
  changeRequestId: number;
  riskDecisionId: number | null;
  alreadyRejected: boolean;
}

/**
 * Decline a routed Change Request. The CR reaches the terminal `rejected` state
 * (immutable — never resurrected). For a CUSTOMER decline this also creates an
 * accepted-risk record pointing back at the CR that spawned it (#1514) and flips
 * the routing ledger to `declined_risk`.
 */
export async function declineRoutedChangeToRisk(input: DeclineInput): Promise<DeclineResult> {
  const [cr] = await db
    .select()
    .from(mspChangeRequestsTable)
    .where(and(eq(mspChangeRequestsTable.id, input.changeRequestId), eq(mspChangeRequestsTable.mspId, input.mspId)))
    .limit(1);
  if (!cr) {
    throw new Error(`Change request ${input.changeRequestId} not found for MSP ${input.mspId}`);
  }
  if (cr.status === "rejected") {
    // Idempotent: already terminal. Return the risk it already spawned, if any.
    const [routing] = await db
      .select({ riskDecisionId: m365ChangeRoutingsTable.riskDecisionId })
      .from(m365ChangeRoutingsTable)
      .where(eq(m365ChangeRoutingsTable.changeRequestId, cr.id))
      .limit(1);
    return { changeRequestId: cr.id, riskDecisionId: routing?.riskDecisionId ?? null, alreadyRejected: true };
  }

  const approverName = (input.approverName ?? "").trim() || (input.declinedBy === "customer" ? "Customer" : "MSP");
  const rejectedAt = new Date();

  await db
    .update(mspChangeRequestsTable)
    .set({ status: "rejected", approvedBy: `Rejected by ${approverName}`, updatedAt: rejectedAt })
    .where(eq(mspChangeRequestsTable.id, cr.id));

  // #1503 — the single choke point for BOTH callers of this function: a
  // rejection routed through `recordRejection`'s routed branch, and the
  // `/portal/change-control/:code/decline` route, which calls this directly
  // and never touches `cr_approvals` at all.
  await recordCrEvent({
    changeRequestId: cr.id,
    mspId: input.mspId,
    tenantId: cr.tenantId,
    eventType: "rejected",
    fromValue: cr.status,
    toValue: "rejected",
    stage: input.stage ?? 1,
    actorRole: input.declinedBy === "customer" ? "customer" : "msp",
    actorPersonId: input.actorPersonId ?? null,
    actorName: approverName,
    reason: (input.statement ?? "").trim() || null,
    occurredAt: rejectedAt,
  });

  // An MSP rejecting its own routed change produces no risk record (#1514).
  if (input.declinedBy === "msp") {
    await db
      .update(m365ChangeRoutingsTable)
      .set({ decision: "declined_risk", reason: "auto_created", riskDecisionId: null, updatedAt: rejectedAt })
      .where(eq(m365ChangeRoutingsTable.changeRequestId, cr.id));
    log.info({ changeRequestId: cr.id, mspId: input.mspId }, "m365-change-router: routed CR declined by MSP — no risk record (#1514)");
    return { changeRequestId: cr.id, riskDecisionId: null, alreadyRejected: false };
  }

  // A customer decline: the rejection is a risk acceptance.
  const riskDecisionId = await createAcceptedRiskFromDecline(cr, {
    approverName,
    approverEmail: (input.approverEmail ?? "").trim(),
    statement: (input.statement ?? "").trim() || DEFAULT_ACCEPTANCE_STATEMENT,
    acceptedAt: rejectedAt,
  });

  await db
    .update(m365ChangeRoutingsTable)
    .set({ decision: "declined_risk", reason: "auto_created", riskDecisionId, updatedAt: rejectedAt })
    .where(eq(m365ChangeRoutingsTable.changeRequestId, cr.id));

  log.info({ changeRequestId: cr.id, riskDecisionId, mspId: input.mspId }, "m365-change-router: routed CR declined by customer — accepted risk created (#1514)");
  return { changeRequestId: cr.id, riskDecisionId, alreadyRejected: false };
}

const DEFAULT_ACCEPTANCE_STATEMENT =
  "By declining this change I accept the residual risk of leaving the current configuration in place until a future change supersedes it.";

const RISK_REVIEW_DAYS = 90;

/** Create the accepted-risk record for a customer's decline of a routed CR. */
async function createAcceptedRiskFromDecline(
  cr: MspChangeRequest,
  accept: { approverName: string; approverEmail: string; statement: string; acceptedAt: Date },
): Promise<number> {
  const rbdId = `RR-CR-${cr.id}`;
  const rawScore = riskScoreForLevel(cr.riskLevel);
  const reviewDate = new Date(accept.acceptedAt.getTime() + RISK_REVIEW_DAYS * 86_400_000);
  const signedAtDisplay = accept.acceptedAt.toISOString().substring(0, 19).replace("T", " ") + " UTC";
  const signatureHash = createHash("sha256")
    .update([rbdId, accept.approverName, accept.acceptedAt.toISOString(), accept.statement].join(" "))
    .digest("hex");

  const [inserted] = await db
    .insert(mspRiskDecisionsTable)
    .values({
      mspId: cr.mspId,
      rbdId,
      tenantId: cr.tenantId,
      tenantName: cr.tenantName,
      primaryDomain: cr.primaryDomain,
      title: cr.title,
      controlViolated: cr.targetResource,
      framework: "Microsoft 365 Change Control",
      rawRiskLevel: cr.riskLevel,
      residualRiskLevel: cr.riskLevel, // declining accepts the risk whole — no mitigation applied
      rawRiskScore: rawScore,
      residualRiskScore: rawScore,
      liabilityValueUsd: 0, // not quantified here — never an invented dollar figure
      hazardDescription: `${cr.description} The customer declined this remediation; the residual risk is accepted until a future change supersedes it.`,
      graphEndpoint: "",
      compensatingControls: [],
      mspAssessor: { name: "Microsoft 365 change routing", upn: "system@routing", timestamp: accept.acceptedAt.toISOString() },
      clientApprover: {
        name: accept.approverName,
        title: "",
        email: accept.approverEmail,
        signedAt: signedAtDisplay,
        ipAddress: null,
        signatureHash,
      },
      expirationDate: formatStructuralDate(reviewDate),
      status: "active",
      riskStatus: "Accepted",
      reviewDate: formatStructuralDate(reviewDate),
      acceptedAt: accept.acceptedAt,
      acceptedStatement: accept.statement,
      // #1514 back-pointer: this risk was spawned by the CR the customer rejected.
      spawnedByChangeRequestId: cr.id,
    })
    .onConflictDoUpdate({
      // (mspId, rbdId) unique — a repeated decline of the same CR returns the same risk.
      target: [mspRiskDecisionsTable.mspId, mspRiskDecisionsTable.rbdId],
      set: { updatedAt: accept.acceptedAt },
    })
    .returning({ id: mspRiskDecisionsTable.id });

  await assignRegisterRef(inserted.id);
  return inserted.id;
}

/** Human code for a routed CR, kept identical to every other console. */
export function routedChangeRequestCode(id: number): string {
  return formatChangeRequestCode(id);
}
