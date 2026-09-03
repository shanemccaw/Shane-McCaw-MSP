/**
 * security-plan-assembly.ts — the Security Plan's assembled view (#1561, part of
 * #1495/#1485).
 *
 * The Security Plan owns almost no data. It READS what the other eight modules
 * produce and presents them as one document:
 *
 *   Policy Decisions   (#1490) — policy_decisions
 *   Risk Register      (#1487) — msp_risk_decisions
 *   Ownership / RACI    (#1491) — portal_ownership_rows
 *   SOPs / Runbooks     (#1493) — msp_sops
 *   Remediation         (#1489) — remediation_tracker_steps
 *   Change Control      (#1486) — msp_change_requests
 *   Microsoft Changes   (#1494) — m365_change_interpretations
 *
 * Every row here is read from a real source table for the caller's own tenant —
 * nothing is fabricated, and an empty module is an honest empty (a real query that
 * returned zero rows), never a fixture fallback.
 *
 * SCOPE (#1563). A caller may narrow which parts of the estate the plan covers, but
 * scope operates ONLY on DIMENSIONS (control family = `pillar`, `framework`,
 * `businessUnit`), NEVER on OUTCOME (severity, accepted/open, pass/fail). This module
 * deliberately exposes no outcome filter. A row is excluded by a scoped dimension ONLY
 * when it CARRIES a value for that dimension that is not in the allowed set — a row
 * that cannot be classified by the dimension is RETAINED, never silently dropped,
 * because dropping by absence is exactly the hiding #1563 forbids. `pillar` and
 * `framework` vary per row (real columns on policy_decisions / msp_risk_decisions).
 * `businessUnit` (#2085) is backed by `tenants.business_unit` instead — a single value
 * per tenant, so every item in one assembled plan carries the same value; scoping on
 * it is all-or-nothing within a plan, but it is real, tenant-set data, not fabricated.
 *
 * FOOTPRINT (#1565). The assembly always computes a filter footprint — which filters
 * were applied, what was excluded, and a per-module count — and returns it as part of
 * the document. When a version is sealed, that footprint is snapshotted into the
 * sealed `content` and cannot be suppressed by any UI.
 *
 * STATEMENT (#1563's other requirement). A scoped view also carries a human
 * `scope.statement` — what it covers and what it deliberately does not. The exclusion
 * counts in the footprint prove the fact of narrowing; the statement is what a reader
 * is told about it. `scopeMissingRequiredStatement` is enforced at seal time (see
 * `msp-security-plan.ts`'s POST /versions) so a scoped document can never be sealed
 * without a REAL, human-authored one.
 *
 * SIGNATURE SCOPE (#1564). #1563's enforcement above only covers the scoped case; the
 * HONEST (unscoped) seal is exactly the gap #1564 names: "Signing 'our identity control
 * posture as of this date' is a real, bounded statement. Signing 'our security posture'
 * unqualified is one nobody should make, and the platform should not offer it as a
 * default." An honest seal with no scope body still makes an implicit claim ("this is
 * our full assessed posture as of the sealed date") that must itself be bounded, not
 * left to speak for itself. `synthesizeScopeStatement` fills a canonical honest-view
 * statement whenever none is supplied (never for the scoped case — that already fails
 * closed via `scopeMissingRequiredStatement` before assembly runs) so the footprint's
 * `scope.statement` is never blank on anything that reaches a seal. A scope change is
 * never an amendment to an existing version; `security-plan-versioning.ts` only ever
 * inserts a new one, matching #1564's "Consequence" (a scope change produces a new
 * version, never an edit to the current one).
 */
import {
  db,
  policyDecisionsTable,
  mspRiskDecisionsTable,
  portalOwnershipRowsTable,
  mspSopsTable,
  remediationTrackerStepsTable,
  mspChangeRequestsTable,
  m365ChangeInterpretationsTable,
  SECURITY_PLAN_SCOPE_DIMENSIONS,
  type SecurityPlanContent,
  type SecurityPlanScope,
  type SecurityPlanScopeDimension,
  type SecurityPlanAssembledItem,
  type SecurityPlanAssembledModule,
  type SecurityPlanFilterFootprint,
  type SecurityPlanProse,
} from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import type { TenantScope } from "./portal-customer-scope.ts";

/** An item before scope is applied — carries its dimension classification so scope
 * can decide inclusion without re-reading the row. */
type RawItem = SecurityPlanAssembledItem;

/** One module's full (unscoped) contribution, before scope is applied. Exported so
 * the scope/footprint mechanics can be unit-tested without seeding the database — the
 * #1563/#1565 guarantees are pure functions of these rows and a scope. */
export interface RawSecurityPlanModule {
  key: string;
  label: string;
  sourceIssue: string;
  items: RawItem[];
}
type RawModule = RawSecurityPlanModule;

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/**
 * True when `item` is excluded by `scope`. A dimension excludes an item only when the
 * item HAS a value for that dimension and that value is not in the dimension's allowed
 * set. An item with a null value for a scoped dimension is never excluded by it.
 *
 * Exported for the #1563 guarantee test: scope narrows on a dimension VALUE, never on an
 * outcome, and an unclassifiable row is retained rather than silently dropped.
 */
export function isExcludedByScope(item: RawItem, scope: SecurityPlanScope): boolean {
  const dims = scope.dimensions ?? {};
  for (const dim of Object.keys(dims) as SecurityPlanScopeDimension[]) {
    const allowed = dims[dim];
    if (!allowed || allowed.length === 0) continue; // no constraint on this dimension
    const value = item[dim]; // "pillar" | "framework" | "businessUnit" all exist on SecurityPlanAssembledItem
    if (value === null) continue; // unclassifiable by this dimension → retained
    if (!allowed.includes(value)) return true;
  }
  return false;
}

// ── Per-module readers. Each returns the FULL (unscoped) set for the tenant. ────────

async function readPolicyDecisions(scope: TenantScope): Promise<RawModule> {
  const rows = await db
    .select({
      id: policyDecisionsTable.id,
      title: policyDecisionsTable.title,
      pillar: policyDecisionsTable.pillar,
      obligation: policyDecisionsTable.obligation,
      decisionState: policyDecisionsTable.decisionState,
      reviewState: policyDecisionsTable.reviewState,
    })
    .from(policyDecisionsTable)
    .where(and(eq(policyDecisionsTable.mspId, scope.mspId), eq(policyDecisionsTable.tenantId, scope.tenantId)))
    .orderBy(desc(policyDecisionsTable.id));
  return {
    key: "policy",
    label: "Policy Decisions",
    sourceIssue: "#1490",
    items: rows.map((r) => ({
      id: `policy-${r.id}`,
      title: r.title,
      state: str(r.decisionState),
      detail: str(r.reviewState) ? `Review: ${r.reviewState}` : str(r.obligation),
      pillar: str(r.pillar),
      framework: null,
      businessUnit: str(scope.businessUnit),
    })),
  };
}

async function readRiskRegister(scope: TenantScope): Promise<RawModule> {
  const rows = await db
    .select({
      id: mspRiskDecisionsTable.id,
      title: mspRiskDecisionsTable.title,
      pillar: mspRiskDecisionsTable.pillar,
      framework: mspRiskDecisionsTable.framework,
      rawRiskLevel: mspRiskDecisionsTable.rawRiskLevel,
      residualRiskLevel: mspRiskDecisionsTable.residualRiskLevel,
      status: mspRiskDecisionsTable.status,
    })
    .from(mspRiskDecisionsTable)
    .where(and(eq(mspRiskDecisionsTable.mspId, scope.mspId), eq(mspRiskDecisionsTable.tenantId, scope.tenantId)))
    .orderBy(desc(mspRiskDecisionsTable.id));
  return {
    key: "risk",
    label: "Risk Register",
    sourceIssue: "#1487",
    items: rows.map((r) => ({
      id: `risk-${r.id}`,
      title: r.title,
      state: str(r.status),
      detail: `Raw ${str(r.rawRiskLevel) ?? "?"} → residual ${str(r.residualRiskLevel) ?? "?"}`,
      pillar: str(r.pillar),
      framework: str(r.framework),
      businessUnit: str(scope.businessUnit),
    })),
  };
}

async function readOwnership(scope: TenantScope): Promise<RawModule> {
  const rows = await db
    .select({
      id: portalOwnershipRowsTable.id,
      rowId: portalOwnershipRowsTable.rowId,
      objType: portalOwnershipRowsTable.objType,
      name: portalOwnershipRowsTable.name,
      sub: portalOwnershipRowsTable.sub,
    })
    .from(portalOwnershipRowsTable)
    .where(eq(portalOwnershipRowsTable.customerId, scope.customerId))
    .orderBy(desc(portalOwnershipRowsTable.id));
  return {
    key: "ownership",
    label: "Ownership / RACI",
    sourceIssue: "#1491",
    items: rows.map((r) => ({
      id: `ownership-${r.id}`,
      title: str(r.name) ?? r.rowId,
      state: str(r.objType),
      detail: str(r.sub),
      pillar: null,
      framework: null,
      businessUnit: str(scope.businessUnit),
    })),
  };
}

async function readSops(scope: TenantScope): Promise<RawModule> {
  // SOPs are the MSP's procedure library (msp-wide, msp_id only — no tenant_id).
  const rows = await db
    .select({
      id: mspSopsTable.id,
      sopId: mspSopsTable.sopId,
      title: mspSopsTable.title,
      category: mspSopsTable.category,
      automationType: mspSopsTable.automationType,
      versionStatus: mspSopsTable.versionStatus,
    })
    .from(mspSopsTable)
    .where(eq(mspSopsTable.mspId, scope.mspId))
    .orderBy(desc(mspSopsTable.id));
  return {
    key: "sops",
    label: "SOPs & Runbooks",
    sourceIssue: "#1493",
    items: rows.map((r) => ({
      id: `sop-${r.id}`,
      title: r.title,
      state: str(r.versionStatus),
      // `category` is the SOP library's own taxonomy, not the pillar dimension, so it
      // is shown as detail rather than mapped onto `pillar` (which would conflate two
      // different vocabularies and make a `pillar` scope dishonest).
      detail: [str(r.category), str(r.automationType)].filter(Boolean).join(" · ") || null,
      pillar: null,
      framework: null,
      businessUnit: str(scope.businessUnit),
    })),
  };
}

async function readRemediation(scope: TenantScope): Promise<RawModule> {
  const rows = await db
    .select({
      id: remediationTrackerStepsTable.id,
      stepId: remediationTrackerStepsTable.stepId,
      status: remediationTrackerStepsTable.status,
      verificationState: remediationTrackerStepsTable.verificationState,
    })
    .from(remediationTrackerStepsTable)
    .where(eq(remediationTrackerStepsTable.customerId, scope.customerId))
    .orderBy(desc(remediationTrackerStepsTable.id));
  return {
    key: "remediation",
    label: "Remediation",
    sourceIssue: "#1489",
    items: rows.map((r) => ({
      id: `remediation-${r.id}`,
      title: r.stepId,
      state: str(r.status),
      detail: str(r.verificationState) ? `Verification: ${r.verificationState}` : null,
      pillar: null,
      framework: null,
      businessUnit: str(scope.businessUnit),
    })),
  };
}

async function readChangeControl(scope: TenantScope): Promise<RawModule> {
  const rows = await db
    .select({
      id: mspChangeRequestsTable.id,
      title: mspChangeRequestsTable.title,
      changeClass: mspChangeRequestsTable.changeClass,
      riskLevel: mspChangeRequestsTable.riskLevel,
      status: mspChangeRequestsTable.status,
      category: mspChangeRequestsTable.category,
    })
    .from(mspChangeRequestsTable)
    .where(and(eq(mspChangeRequestsTable.mspId, scope.mspId), eq(mspChangeRequestsTable.tenantId, scope.tenantId)))
    .orderBy(desc(mspChangeRequestsTable.id));
  return {
    key: "change_control",
    label: "Change Control",
    sourceIssue: "#1486",
    items: rows.map((r) => ({
      id: `change-${r.id}`,
      title: r.title,
      state: str(r.status),
      detail: [str(r.changeClass), str(r.riskLevel), str(r.category)].filter(Boolean).join(" · ") || null,
      pillar: null,
      framework: null,
      businessUnit: str(scope.businessUnit),
    })),
  };
}

async function readMicrosoftChanges(scope: TenantScope): Promise<RawModule> {
  const rows = await db
    .select({
      id: m365ChangeInterpretationsTable.id,
      title: m365ChangeInterpretationsTable.title,
      changeClass: m365ChangeInterpretationsTable.changeClass,
      status: m365ChangeInterpretationsTable.status,
      controllable: m365ChangeInterpretationsTable.controllable,
    })
    .from(m365ChangeInterpretationsTable)
    .where(eq(m365ChangeInterpretationsTable.mspId, scope.mspId))
    .orderBy(desc(m365ChangeInterpretationsTable.id));
  return {
    key: "microsoft_changes",
    label: "Microsoft Changes",
    sourceIssue: "#1494",
    items: rows.map((r) => ({
      id: `m365-${r.id}`,
      title: r.title,
      state: str(r.status),
      detail: [str(r.changeClass), str(r.controllable) ? `controllable: ${r.controllable}` : null].filter(Boolean).join(" · ") || null,
      pillar: null,
      framework: null,
      businessUnit: str(scope.businessUnit),
    })),
  };
}

/** The empty (honest, unfiltered) scope — the default view. */
export const HONEST_SCOPE: SecurityPlanScope = { dimensions: {} };

export function scopeHasConstraints(scope: SecurityPlanScope): boolean {
  const dims = scope.dimensions ?? {};
  return (Object.keys(dims) as SecurityPlanScopeDimension[]).some((d) => (dims[d]?.length ?? 0) > 0);
}

/**
 * True when `scope` narrows on a dimension but carries no human statement of what it
 * covers and what it deliberately does not — #1563's first "to build" requirement
 * ("every filtered view carries its own scope statement"), which the footprint's
 * exclusion counts alone do not satisfy. The honest (unconstrained) scope never needs
 * a statement; there is nothing being narrowed to explain.
 */
export function scopeMissingRequiredStatement(scope: SecurityPlanScope): boolean {
  return scopeHasConstraints(scope) && !(scope.statement && scope.statement.trim().length > 0);
}

/**
 * Resolves the bounded statement (#1564) that goes into a footprint's `scope`. A
 * caller-supplied `scope.statement` is used verbatim (trimmed). For the HONEST view,
 * where #1563's `scopeMissingRequiredStatement` deliberately requires nothing, a
 * canonical statement is synthesized so the field is never blank — #1564's point that an
 * unscoped seal still makes an implicit, bounded claim that must be recorded, not left
 * to speak for itself. For a SCOPED view with no statement, this also falls back to a
 * mechanically-derived one (naming the applied dimensions) as a structural last resort —
 * `msp-security-plan.ts`'s POST /versions already fails closed on that case via
 * `scopeMissingRequiredStatement` before assembly ever runs, so a real, human-authored
 * statement is what actually reaches a seal; this fallback only guards other callers
 * (e.g. the live/unsealed GET view) against ever returning a blank one.
 */
export function synthesizeScopeStatement(scope: SecurityPlanScope, isHonestView: boolean): string {
  const provided = scope.statement?.trim();
  if (provided) return provided;
  if (isHonestView) return "Full assessed estate — no scope narrowing applied.";
  const dims = scope.dimensions ?? {};
  const parts: string[] = [];
  for (const dim of SECURITY_PLAN_SCOPE_DIMENSIONS) {
    const values = dims[dim];
    if (values && values.length) parts.push(`${dim}: ${values.join(", ")}`);
  }
  return parts.length
    ? `Scoped to ${parts.join("; ")}. Content outside this scope is not represented in this version.`
    : "Full assessed estate — no scope narrowing applied.";
}

/**
 * Applies `scope` to already-read raw modules and computes the #1565 filter footprint.
 * PURE — the whole #1563/#1565 mechanism lives here, decoupled from the DB reads, so it
 * is unit-testable without seeding. Every excluded row is counted into the footprint,
 * and the footprint travels with the returned modules so a sealed snapshot always
 * carries proof of what was cut.
 */
export function applyScopeAndFootprint(
  rawModules: readonly RawSecurityPlanModule[],
  scope: SecurityPlanScope,
  computedAt: string = new Date().toISOString(),
): { modules: SecurityPlanAssembledModule[]; footprint: SecurityPlanFilterFootprint } {
  const modules: SecurityPlanAssembledModule[] = [];
  const excludedByModule: { moduleKey: string; excludedCount: number }[] = [];
  let totalExcluded = 0;

  for (const m of rawModules) {
    const inScope: SecurityPlanAssembledItem[] = [];
    let excluded = 0;
    for (const item of m.items) {
      if (isExcludedByScope(item, scope)) excluded += 1;
      else inScope.push(item);
    }
    totalExcluded += excluded;
    excludedByModule.push({ moduleKey: m.key, excludedCount: excluded });
    modules.push({
      key: m.key,
      label: m.label,
      sourceIssue: m.sourceIssue,
      total: inScope.length,
      excludedCount: excluded,
      items: inScope,
    });
  }

  const isHonestView = !scopeHasConstraints(scope);
  const footprint: SecurityPlanFilterFootprint = {
    scope: { ...scope, statement: synthesizeScopeStatement(scope, isHonestView) },
    isHonestView,
    excludedByModule,
    totalExcluded,
    computedAt,
  };

  return { modules, footprint };
}

/**
 * Assembles the whole Security Plan for one tenant, applying `scope` and computing the
 * #1565 filter footprint. `scope` defaults to the honest (unfiltered) view.
 */
export async function assembleSecurityPlan(
  tenant: TenantScope,
  scope: SecurityPlanScope = HONEST_SCOPE,
  prose: SecurityPlanProse | null = null,
): Promise<SecurityPlanContent> {
  const rawModules = await Promise.all([
    readPolicyDecisions(tenant),
    readRiskRegister(tenant),
    readOwnership(tenant),
    readSops(tenant),
    readRemediation(tenant),
    readChangeControl(tenant),
    readMicrosoftChanges(tenant),
  ]);

  const nowIso = new Date().toISOString();
  const { modules, footprint } = applyScopeAndFootprint(rawModules, scope, nowIso);

  return {
    customerId: tenant.customerId,
    tenantId: tenant.tenantId,
    tenantName: tenant.tenantName,
    assembledAt: nowIso,
    modules,
    footprint,
    prose,
  };
}
