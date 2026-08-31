/**
 * portal-risk-register.ts — the CUSTOMER-scoped Risk Register, Policy Decisions,
 * and the risk-acceptance write path.
 *
 *   GET  /api/portal/risk-register              — this customer's risk register
 *   GET  /api/portal/policy-decisions           — the same rows, policy-decision view
 *   POST /api/portal/risk-register/:rbdId/accept — accept a risk, permanently
 *
 * ── Why a new route, given `msp-rbd.ts` already serves this table ───────────
 * It serves it MSP-side. Every handler in `msp-rbd.ts` is
 * `requireRole("MSPOperator")` (list) or `requireRole("MSPAdmin")` (sign,
 * revoke), scoped by `resolveMspIdStrict` — i.e. every risk decision belonging
 * to every tenant of that MSP, in one list. Pointing a customer page at it
 * would hand each customer the other customers' liability records: their tenant
 * names, primary domains, hazard descriptions and dollar exposures. Same
 * leak-risk pattern `portal-change-control.ts` was built to avoid, same fix.
 *
 * ── The scoping is a PAIR of predicates, not one ───────────────────────────
 * `msp_risk_decisions.tenant_id` is unconstrained free `text` holding an M365
 * tenant identifier, with no foreign key to `tenants`. The JWT's `customerId`
 * is a `tenants.id` and is NOT that key, so:
 *
 *     JWT customerId → tenants row → (tenants.mspId, tenants.tenantId)
 *
 * and the query filters on BOTH, via the shared `resolveTenantScope` (which
 * fails closed on a missing row, a missing mspId, or a BLANK tenantId — an
 * empty-string match would be a cross-tenant read). That helper's own header
 * names this table as one of the three it exists for; this route does not
 * re-derive the rule.
 *
 * The live data justifies the paranoia: the one row in this table today carries
 * `tenant_id = 'contoso-01'`, which is not an M365 tenant GUID and matches no
 * real tenant. Filtering on that column alone would be filtering on a
 * convention nothing enforces.
 *
 * ── Role floor: `CustomerUser` ─────────────────────────────────────────────
 * Chosen deliberately, and it is a HIGHER floor than the customer-scoped routes
 * next door: `portal-change-control.ts`, `portal-remediation-tracker.ts` and
 * `portal-tenant-check-items.ts` all floor at `Assessment` ("the lowest role
 * carrying a customerId"). This one does not, for a product reason rather than
 * a security one — the register carries the tenant's dollar liability exposure
 * and a signature surface that transfers that liability, which is not something
 * a free Assessment-tier account should reach. The floor decides which TIER may
 * open the page; it is NOT what prevents a cross-tenant read (the scoping
 * above is, and it is identical either way).
 *
 * The configured testbed account is a real `CustomerUser`, so this floor is
 * reachable by the test harness — verified in `portal-change-control.ts`'s own
 * header against the database rather than assumed.
 *
 * ── Most of what these pages render did not exist in this table ────────────
 * `msp_risk_decisions` held the MSP-side liability record and nothing else: no
 * pillar, owner, likelihood, impact, weight, outcome, evidence, plan, register
 * reference, rationale or obligation. WIRING_PLAN.md predicted exactly that ("a
 * heat-map's likelihood/impact matrix almost certainly doesn't exist as
 * structured data today — that's real backend design work, not a type change").
 * Those columns were added by
 * `lib/db/migrations/manual/2026-08-21-portal-v2-risk-register-customer-fields.sql`
 * — purely additive, all nullable, no backfill.
 *
 * NULL IS SERVED AS NULL. A row written by `msp-rbd.ts` (which predates every
 * one of those columns and sets none of them) comes back with nulls, and the
 * page says "Not recorded". It does not get a plausible-looking default,
 * because a fabricated likelihood would land a risk on the heat map at
 * coordinates nobody chose.
 *
 * ── Three lifecycles, deliberately not merged ──────────────────────────────
 * `status` is the ACCEPTANCE's state (pending_signature / active / revoked).
 * `riskStatus` is the RISK's own (Open / Mitigating / Accepted / Closed /
 * Expired). A risk can be Mitigating with no acceptance at all, and an
 * acceptance can be revoked while the risk stays Open. The register shows the
 * second; the acceptance panel acts on the first.
 *
 * The THIRD clock — the REVIEW (`reviewState` / `reviewDueAt`) — was split out
 * of `status` on #1507. An acceptance is a signed fact and does not expire; what
 * lapses is the review. So `status` no longer carries `expired`: a past-due
 * review surfaces as `reviewState = "overdue"` on an acceptance that stays
 * `active`. `WireAcceptance` therefore has no `until` — the "look again" date is
 * `reviewDueAt`, on the risk, not a lifetime on the acceptance.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import { db, mspRiskDecisionsTable, complianceObligationsTable, complianceFrameworksTable, type CompensatingControl, type ClientApprover } from "@workspace/db";
import { and, eq, desc, isNull, inArray } from "drizzle-orm";
import { z } from "zod";

import { requireRole } from "../middlewares/requireAuth";
import { resolveCustomerId, resolveTenantScope } from "../lib/portal-customer-scope";
import { apiError, ApiErrorCode } from "../lib/api-helpers";
import { formatChangeRequestCode } from "../lib/portal-change-control";
import { logger } from "../lib/logger";
import { personIdForUser } from "../lib/portal-ownership";
import {
  currentAHolderPersonIds,
  namesForPersonIds,
  resolveRiskAuthoritiesBatch,
  resolveRiskWorkload,
  type RiskAuthority,
  type RiskAuthorityHolder,
  type RiskAuthorizedBy,
} from "../lib/risk-authority";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

/**
 * The severity vocabularies differ between the two sides and this is the only
 * place they meet. The table stores lowercase (`high`), the register's colour
 * map `RR_SEV_META` is keyed on title case (`High`). Anything not recognised
 * comes back as-is rather than being coerced into a bucket it does not belong
 * in — an unknown severity should look wrong on screen, not silently render as
 * Low.
 */
function titleCaseSeverity(value: string | null): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  return v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
}

/** The acceptance block, present only once the risk has actually been accepted. */
interface WireAcceptance {
  /** The name the customer TYPED at acceptance time. */
  readonly by: string;
  /** When they typed it — the server's clock, never the client's. */
  readonly on: string;
  // NO `until`. An acceptance is a signed fact and does not expire (#1507): a
  // thing that happened does not stop having happened. The date that used to sit
  // here (`expiration_date`) framed the acceptance as time-boxed, which is the
  // exact conflation this module was built to remove. The "when must this be
  // looked at again" date now belongs to the review clock — `WireRisk.reviewDueAt`
  // / `WireRisk.reviewState` — not to the acceptance.
  readonly register: string | null;
  readonly why: string | null;
  readonly compensating: string | null;
  /** The exact sentence they ticked, snapshotted at accept time. */
  readonly statement: string | null;
  /**
   * Role-based acceptance authority (Git #1511) as of the moment this risk was
   * signed — the workload whose Accountable role backed the signature, and
   * every wire person id that held it at that instant, replayed from the
   * ownership event log. Null when the risk's `checkKey` resolved to no
   * workload (a free-standing liability record, or a cross-cutting check
   * category) — the honest unresolved case, not an error.
   */
  readonly authorizedBy: WireRiskAuthority | null;
}

/** One current or point-in-time Accountable holder, for display. */
interface WireRiskAuthorityHolder {
  readonly personId: string;
  readonly name: string;
}

/** The workload + holder set behind an authority resolution (current or
 * point-in-time) — shared shape for `WireRisk.authority` and
 * `WireAcceptance.authorizedBy`. */
interface WireRiskAuthority {
  readonly workloadId: string;
  readonly workloadLabel: string;
  readonly holders: readonly WireRiskAuthorityHolder[];
}

function toWireRiskAuthority(a: RiskAuthority | RiskAuthorizedBy | null): WireRiskAuthority | null {
  if (!a) return null;
  return {
    workloadId: a.workload.objectId,
    workloadLabel: a.workload.label,
    holders: a.holders.map((h: RiskAuthorityHolder) => ({ personId: h.personId, name: h.name })),
  };
}

/** One risk, in the shape the Risk Register page consumes. */
interface WireRisk {
  readonly id: string;
  readonly title: string;
  readonly pillar: string | null;
  readonly inherent: string | null;
  readonly residual: string | null;
  readonly status: string | null;
  readonly owner: string | null;
  /** The review date as display copy, e.g. "27 Aug 2026" — never money. */
  readonly review: string | null;
  /** The review clock (#1507), split out of the acceptance `status`. The machine
   * due date (ISO, UTC) the display `review` describes — so overdue is computable,
   * not parsed from copy. Null when no review is scheduled. */
  readonly reviewDueAt: string | null;
  /** The review's operational state (RISK_REVIEW_STATES: on_track / due /
   * overdue). Null when no review is scheduled. A past-due review is a flag on a
   * still-accepted risk; it does NOT lapse the acceptance (#1507). */
  readonly reviewState: string | null;
  readonly weight: number | null;
  readonly likelihood: number | null;
  readonly impact: number | null;
  readonly what: string;
  readonly outcome: string | null;
  readonly evidence: string | null;
  readonly controls: readonly string[];
  readonly plan: string | null;
  /** Absent unless the risk has genuinely been accepted. */
  readonly accepted?: WireAcceptance;
  /** True once accepted — the panel uses this to refuse a second signature. */
  readonly isAccepted: boolean;
  /** The liability this acceptance would transfer, in whole USD. */
  readonly liabilityValueUsd: number;
  readonly framework: string;
  readonly controlViolated: string;
  /** The compliance_obligations.id this risk cites, when `obligation` matches
   * the catalog (#1525). Null when there is no catalog match. */
  readonly obligationId: string | null;
  /** The cited authority's type (AUTHORITY_TYPES), resolved from `obligationId`.
   * Null unless `obligationId` is set. */
  readonly obligationType: string | null;
  /**
   * #1514 — the Change-Control provenance pair. `spawnedByChangeRequestCode` is
   * the change the customer rejected, whose decline became this accepted risk
   * (null for every risk not raised that way — e.g. a Remediation Tracker
   * decline, or an `msp-rbd.ts`-authored liability record). `dischargedByChangeRequestCode`
   * is the LATER, fresh change that has since superseded this acceptance — null
   * while the risk still stands, which is the common case. Both are display
   * codes (`formatChangeRequestCode`), not raw ids, matching every other
   * customer-facing CR reference.
   */
  readonly spawnedByChangeRequestCode: string | null;
  readonly dischargedByChangeRequestCode: string | null;
  /**
   * Role-based acceptance authority (Git #1511) — the workload this risk's
   * `checkKey` resolves to, and who CURRENTLY holds Accountable there. This is
   * "who may sign it right now", independent of whether it has been. Null
   * when `checkKey` resolves to no workload.
   */
  readonly authority: WireRiskAuthority | null;
}

/** One policy decision — the same rows, read as documented policy positions. */
interface WirePolicyDecision {
  readonly id: string;
  readonly state: string | null;
  readonly pillar: string | null;
  readonly title: string;
  readonly obligation: string | null;
  readonly owner: string | null;
  readonly ownerId: string | null;
  readonly approved: string | null;
  /** Review date as display copy. See `reviewDueAt` / `reviewState` for the clock. */
  readonly review: string | null;
  /** Machine review due date (ISO, UTC), #1507. Null when none scheduled. */
  readonly reviewDueAt: string | null;
  /** Review state (RISK_REVIEW_STATES). A past-due review is an operational flag
   * on a decision that stays `live` — `expired` was removed here (#1527). */
  readonly reviewState: string | null;
  readonly register: string | null;
  readonly rationale: string | null;
  readonly compensating: string | null;
  readonly check: string | null;
  /** The compliance_obligations.id this decision cites, when `obligation`
   * matches the catalog (#1525). Null when there is no catalog match. */
  readonly obligationId: string | null;
  /** The cited authority's type (AUTHORITY_TYPES), resolved from `obligationId`.
   * Null unless `obligationId` is set. */
  readonly obligationType: string | null;
}

type RiskRow = typeof mspRiskDecisionsTable.$inferSelect;

/** ISO 8601, UTC. The wire carries machine time; the page formats it. */
function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function controlDescriptions(controls: CompensatingControl[] | null): readonly string[] {
  if (!Array.isArray(controls)) return [];
  return controls.map((c) => c?.description).filter((d): d is string => typeof d === "string" && d.trim() !== "");
}

/**
 * The compensating controls as one sentence, for the acceptance record's own
 * "what is holding this down" line. Joined here rather than on the page so the
 * register and the acceptance block cannot disagree about the same controls.
 */
function compensatingSentence(controls: CompensatingControl[] | null): string | null {
  const list = controlDescriptions(controls);
  return list.length ? list.join(" ") : null;
}

/** Resolves `authority_type` for a set of `compliance_obligations.id`s in one
 * query, so listing N rows costs one extra round trip, not N. */
async function loadObligationTypes(obligationIds: readonly number[]): Promise<Map<number, string>> {
  const ids = [...new Set(obligationIds)];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ obligationId: complianceObligationsTable.id, authorityType: complianceFrameworksTable.authorityType })
    .from(complianceObligationsTable)
    .innerJoin(complianceFrameworksTable, eq(complianceObligationsTable.frameworkId, complianceFrameworksTable.id))
    .where(inArray(complianceObligationsTable.id, ids));
  return new Map(rows.map((r) => [r.obligationId, r.authorityType]));
}

function toWireRisk(
  row: RiskRow,
  obligationTypeById: Map<number, string>,
  authority: RiskAuthority | null,
  authorizedBy: RiskAuthorizedBy | null,
): WireRisk {
  const acceptedAt = iso(row.acceptedAt);
  const approver = (row.clientApprover ?? null) as ClientApprover | null;

  // The acceptance block appears iff the write path actually ran. `status ===
  // "active"` alone is NOT the test: `msp-rbd.ts` can flip a row to active from
  // the MSP side without a customer ever typing a name, and rendering an
  // acceptance with a blank signatory would be a false record of consent.
  const accepted: WireAcceptance | undefined =
    acceptedAt && approver?.name
      ? {
          by: approver.name,
          on: acceptedAt,
          register: row.registerRef ?? null,
          why: row.rationale ?? null,
          compensating: compensatingSentence(row.compensatingControls),
          statement: row.acceptedStatement ?? null,
          authorizedBy: toWireRiskAuthority(authorizedBy),
        }
      : undefined;

  return {
    id: row.rbdId,
    title: row.title,
    pillar: row.pillar ?? null,
    inherent: titleCaseSeverity(row.rawRiskLevel),
    residual: titleCaseSeverity(row.residualRiskLevel),
    status: row.riskStatus ?? null,
    owner: row.owner ?? null,
    review: row.reviewDate ?? null,
    reviewDueAt: iso(row.reviewDueAt),
    reviewState: row.reviewState ?? null,
    weight: row.weight ?? null,
    likelihood: row.likelihood ?? null,
    impact: row.impact ?? null,
    what: row.hazardDescription,
    outcome: row.outcome ?? null,
    evidence: row.evidence ?? null,
    controls: controlDescriptions(row.compensatingControls),
    plan: row.plan ?? null,
    authority: toWireRiskAuthority(authority),
    ...(accepted ? { accepted } : {}),
    isAccepted: accepted !== undefined,
    liabilityValueUsd: row.liabilityValueUsd,
    framework: row.framework,
    controlViolated: row.controlViolated,
    obligationId: row.obligationId !== null ? String(row.obligationId) : null,
    obligationType: row.obligationId !== null ? (obligationTypeById.get(row.obligationId) ?? null) : null,
    spawnedByChangeRequestCode: row.spawnedByChangeRequestId !== null ? formatChangeRequestCode(row.spawnedByChangeRequestId) : null,
    dischargedByChangeRequestCode: row.dischargedByChangeRequestId !== null ? formatChangeRequestCode(row.dischargedByChangeRequestId) : null,
  };
}

function toWirePolicyDecision(row: RiskRow, obligationTypeById: Map<number, string>): WirePolicyDecision {
  const approver = (row.clientApprover ?? null) as ClientApprover | null;
  return {
    id: row.rbdId,
    state: row.decisionState ?? null,
    pillar: row.pillar ?? null,
    title: row.title,
    obligation: row.obligation ?? null,
    owner: row.owner ?? null,
    ownerId: row.ownerId ?? null,
    // The approval date is the acceptance's real timestamp where one exists,
    // falling back to the MSP-side display string `msp-rbd.ts` writes.
    approved: iso(row.acceptedAt) ?? approver?.signedAt ?? null,
    review: row.reviewDate ?? null,
    reviewDueAt: iso(row.reviewDueAt),
    reviewState: row.reviewState ?? null,
    register: row.registerRef ?? null,
    rationale: row.rationale ?? null,
    compensating: compensatingSentence(row.compensatingControls),
    check: row.verificationNote ?? null,
    obligationId: row.obligationId !== null ? String(row.obligationId) : null,
    obligationType: row.obligationId !== null ? (obligationTypeById.get(row.obligationId) ?? null) : null,
  };
}

/**
 * Resolves the caller's scope, or writes the response and returns null.
 *
 * An unresolvable scope answers 200 with an EMPTY register rather than 403: a
 * customer whose tenant row carries no M365 identifier has no risks, which is a
 * true statement and renders correctly. 403 would read as "you are not allowed
 * to see your own register", which is a different and wrong claim.
 */
async function scopeOrEmpty(req: Request, res: Response, emptyKey: "risks" | "decisions") {
  const customerId = resolveCustomerId(req);
  if (customerId === null) {
    apiError(res, 403, ApiErrorCode.FORBIDDEN, "Customer context required");
    return null;
  }
  const scope = await resolveTenantScope(customerId);
  if (!scope) {
    log.info({ customerId }, "risk register requested with no resolvable tenant scope — serving empty");
    res.json({ [emptyKey]: [] });
    return null;
  }
  return scope;
}

/** Every risk decision for the calling customer's own tenant. */
router.get(
  "/portal/risk-register",
  requireRole("CustomerUser"),
  async (req: Request, res: Response) => {
    try {
      const scope = await scopeOrEmpty(req, res, "risks");
      if (!scope) return;

      const rows = await db
        .select()
        .from(mspRiskDecisionsTable)
        .where(
          and(
            eq(mspRiskDecisionsTable.mspId, scope.mspId),
            eq(mspRiskDecisionsTable.tenantId, scope.tenantId),
          ),
        )
        .orderBy(desc(mspRiskDecisionsTable.id));

      const obligationTypeById = await loadObligationTypes(
        rows.map((r) => r.obligationId).filter((id): id is number => id !== null),
      );
      const { current, authorizedBy } = await resolveRiskAuthoritiesBatch(
        scope.customerId,
        rows.map((r) => ({ checkKey: r.checkKey, acceptedAt: r.acceptedAt })),
      );
      res.json({
        risks: rows.map((row, i) => toWireRisk(row, obligationTypeById, current[i] ?? null, authorizedBy[i] ?? null)),
      });
    } catch (err: unknown) {
      log.error({ err }, "GET /portal/risk-register failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

/**
 * The same rows read as policy decisions.
 *
 * Filtered to rows that actually ARE one — `decision_state` non-null. A raw
 * liability acceptance with no policy position recorded against it is a risk,
 * not a documented policy decision, and listing it here would put a blank lane
 * on the page.
 */
router.get(
  "/portal/policy-decisions",
  requireRole("CustomerUser"),
  async (req: Request, res: Response) => {
    try {
      const scope = await scopeOrEmpty(req, res, "decisions");
      if (!scope) return;

      const rows = await db
        .select()
        .from(mspRiskDecisionsTable)
        .where(
          and(
            eq(mspRiskDecisionsTable.mspId, scope.mspId),
            eq(mspRiskDecisionsTable.tenantId, scope.tenantId),
          ),
        )
        .orderBy(desc(mspRiskDecisionsTable.id));

      const decisionRows = rows.filter((r) => (r.decisionState ?? "").trim() !== "");
      const obligationTypeById = await loadObligationTypes(
        decisionRows.map((r) => r.obligationId).filter((id): id is number => id !== null),
      );
      res.json({
        decisions: decisionRows.map((row) => toWirePolicyDecision(row, obligationTypeById)),
      });
    } catch (err: unknown) {
      log.error({ err }, "GET /portal/policy-decisions failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

/**
 * The typed-name + checkbox acceptance.
 *
 * `confirmed` is `z.literal(true)`, not a boolean: the checkbox is the consent,
 * so a request without it is malformed rather than merely "not accepted".
 *
 * `fullName` is trimmed and must be at least two characters. It is NOT checked
 * against the account's own name on purpose — the person signing may legitimately
 * be signing in a role ("Jordan Diaz · IT Administrator"), and rejecting a
 * mismatch would block a valid signature while doing nothing an attacker with
 * the session could not work around anyway. The account that signed is recorded
 * separately, below, and THAT is the identity claim.
 */
const acceptSchema = z.object({
  fullName: z.string().trim().min(2, "Type your full name to accept this risk").max(200),
  confirmed: z.literal(true),
  statement: z.string().trim().min(1).max(2000),
});

router.post(
  "/portal/risk-register/:rbdId/accept",
  requireRole("CustomerUser"),
  async (req: Request, res: Response) => {
    const customerId = resolveCustomerId(req);
    const rbdId = String(req.params.rbdId);
    try {
      if (customerId === null) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "Customer context required");
        return;
      }
      const scope = await resolveTenantScope(customerId);
      if (!scope) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "Customer context required");
        return;
      }

      const parsed = acceptSchema.safeParse(req.body);
      if (!parsed.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid acceptance", parsed.error.flatten());
        return;
      }

      // Scoped read FIRST: a risk belonging to another tenant must 404 exactly
      // like one that does not exist, so this endpoint cannot be used to probe
      // which RBD ids are real.
      const [existing] = await db
        .select()
        .from(mspRiskDecisionsTable)
        .where(
          and(
            eq(mspRiskDecisionsTable.rbdId, rbdId),
            eq(mspRiskDecisionsTable.mspId, scope.mspId),
            eq(mspRiskDecisionsTable.tenantId, scope.tenantId),
          ),
        )
        .limit(1);

      if (!existing) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "Risk not found");
        return;
      }

      // PERMANENT, NEVER EDITABLE AFTER THE FACT. This is the whole guarantee of
      // the flow and it is enforced here because Postgres has no write-once
      // column. Do not relax it into an upsert.
      if (existing.acceptedAt !== null) {
        apiError(res, 409, ApiErrorCode.CONFLICT, "This risk has already been accepted and cannot be changed");
        return;
      }
      if (existing.status === "revoked") {
        apiError(res, 409, ApiErrorCode.CONFLICT, "This risk decision has been revoked and cannot be accepted");
        return;
      }

      // ── Role-based acceptance authority (Git #1511) ────────────────────────
      // Resolved from the finding's WORKLOAD, never from a per-risk assignment
      // (#1523's settled rule). When `checkKey` resolves to a real workload,
      // only a CURRENT Accountable holder on that workload may sign — any one
      // of them, in any order, all carrying identical authority (#1515/#1517).
      // A `checkKey` resolving to no workload (a free-standing liability
      // record authored directly via `msp-rbd.ts`, or a cross-cutting check
      // category) keeps the pre-#1511 behaviour: any `CustomerUser` may sign,
      // because there is no workload to check authority against — the honest
      // unresolved case, not a security hole this build introduces.
      const workload = resolveRiskWorkload(existing.checkKey);
      const signerPersonId = typeof req.user?.id === "number" ? personIdForUser(req.user.id) : null;
      let authorizingHolderIds: string[] | null = null;

      if (workload) {
        const holderIds = await currentAHolderPersonIds(customerId, workload.objectId);
        if (holderIds.length === 0) {
          apiError(
            res,
            409,
            ApiErrorCode.CONFLICT,
            `No one currently holds Accountable authority for ${workload.label}. Assign an owner on the Ownership page before this risk can be accepted.`,
          );
          return;
        }
        if (!signerPersonId || !holderIds.includes(signerPersonId)) {
          const names = await namesForPersonIds(customerId, holderIds);
          apiError(
            res,
            403,
            ApiErrorCode.FORBIDDEN,
            `Only an Accountable holder for ${workload.label} can accept this risk.`,
            { workload: workload.label, holders: holderIds.map((id) => names.get(id) ?? id) },
          );
          return;
        }
        authorizingHolderIds = holderIds;
      }

      const acceptedAt = new Date();

      // Both derived SERVER-side. `msp-rbd.ts`'s own sign handler takes
      // `ipAddress` and `signatureHash` from the request body, which lets the
      // signer choose their own audit trail. A customer-facing signature must
      // not: the whole point of the record is that it was not written by the
      // person it binds.
      //
      // KNOWN LIMITATION, FLAGGED RATHER THAN PAPERED OVER: on the deployed dev
      // server this records `127.0.0.1`, verified against a real acceptance.
      // The app sits behind Replit's proxy and Express `trust proxy` is not
      // configured, so `req.ip` is the proxy's loopback hop and not the
      // customer's address. The value is therefore NOT a meaningful audit fact
      // today. It is still recorded (it is correct once `trust proxy` is set,
      // and an absent field would be worse), but nothing should be inferred
      // from it until that setting is made — and it must not be "fixed" by
      // reading `x-forwarded-for` directly, which is client-spoofable unless
      // `trust proxy` is configured to say how many hops to believe. That is an
      // app-wide change affecting every route, so it is Shane's call, not this
      // route's to make unilaterally.
      const ipAddress = (req.ip ?? "").trim() || null;
      const signatureHash = createHash("sha256")
        .update([existing.rbdId, parsed.data.fullName, acceptedAt.toISOString(), parsed.data.statement].join("\x00"))
        .digest("hex");

      const priorApprover = (existing.clientApprover ?? null) as ClientApprover | null;
      const clientApprover: ClientApprover = {
        name: parsed.data.fullName,
        // Title/email keep whatever the MSP recorded when raising the request;
        // the customer types a name, not a new contact record.
        title: priorApprover?.title ?? "",
        email: priorApprover?.email ?? "",
        signedAt: acceptedAt.toISOString().substring(0, 19).replace("T", " ") + " UTC",
        ipAddress,
        signatureHash,
      };

      // Guarded UPDATE: the `acceptedAt IS NULL` predicate is repeated here as
      // the real race guard. Two tabs submitting at once both pass the check
      // above; only one can match this WHERE, and the other updates zero rows
      // and is told the risk was already accepted.
      const updated = await db
        .update(mspRiskDecisionsTable)
        .set({
          acceptedAt,
          acceptedStatement: parsed.data.statement,
          clientApprover,
          status: "active",
          riskStatus: "Accepted",
          authorizingWorkloadId: workload?.objectId ?? null,
          authorizingWorkloadLabel: workload?.label ?? null,
          authorizingHolderPersonIds: authorizingHolderIds,
          signedByPersonId: signerPersonId,
          updatedAt: acceptedAt,
        })
        .where(
          and(
            eq(mspRiskDecisionsTable.id, existing.id),
            // The real guard. The read above can be stale by the time this runs;
            // only one concurrent request can match `accepted_at IS NULL`, and
            // the loser updates zero rows rather than overwriting a signature.
            isNull(mspRiskDecisionsTable.acceptedAt),
          ),
        )
        .returning({ id: mspRiskDecisionsTable.id });

      if (updated.length === 0) {
        apiError(res, 409, ApiErrorCode.CONFLICT, "This risk has already been accepted and cannot be changed");
        return;
      }

      log.info(
        {
          customerId,
          mspId: scope.mspId,
          rbdId,
          acceptedBy: parsed.data.fullName,
          userId: typeof req.user?.id === "number" ? req.user.id : null,
          signatureHash,
          authorizingWorkloadId: workload?.objectId ?? null,
          signedByPersonId: signerPersonId,
        },
        "risk accepted by customer",
      );

      let authorizedBy: WireRiskAuthority | null = null;
      if (workload && authorizingHolderIds) {
        const names = await namesForPersonIds(customerId, authorizingHolderIds);
        authorizedBy = {
          workloadId: workload.objectId,
          workloadLabel: workload.label,
          holders: authorizingHolderIds.map((id) => ({ personId: id, name: names.get(id) ?? id })),
        };
      }

      res.status(201).json({
        rbdId,
        accepted: {
          by: parsed.data.fullName,
          on: acceptedAt.toISOString(),
          // No `until`: the acceptance does not expire (#1507). The review clock
          // (WireRisk.reviewDueAt / reviewState) owns any "look again" date.
          register: existing.registerRef ?? null,
          why: existing.rationale ?? null,
          compensating: compensatingSentence(existing.compensatingControls),
          statement: parsed.data.statement,
          authorizedBy,
        },
      });
    } catch (err: unknown) {
      log.error({ err, customerId, rbdId }, "POST /portal/risk-register/:rbdId/accept failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

export default router;
