/**
 * remediation-checklist.ts — the checklist derived from findings, not a
 * standalone step list (#1538).
 *
 * THE GAP THIS CLOSES
 * ────────────────────
 * `remediation_tracker_steps` predates this: it is keyed by `s1`…`s30`, a
 * hand-authored catalogue (`REMEDIATION_TRACKER_CATALOGUE` in msp-portal /
 * its api-server mirror `remediation-tracker-catalogue.ts`) frozen to one
 * narrative tenant's own numbers. Nothing joined those ids to what a scan
 * actually finds. #1538 settles it the other way round: **the tracker is the
 * checklist for THIS tenant, and its contents are derived from findings.**
 *
 * THE ITEM'S IDENTITY IS THE FINDING'S IDENTITY
 * ───────────────────────────────────────────────
 * An item's stable key is `checkKey` — the same identity
 * `remediation_knowledge_base.check_key` and `msp_diagnostic_findings.
 * check_key` already share, and the same one `remediation-tracker-
 * verification.ts`'s `STEP_CHECK_KEYS` already uses to re-verify the OLD
 * catalogue. `findingId` (this scan's specific `msp_diagnostic_findings.
 * finding_id`) rides along as the evidence instance, but the tracker CLAIM
 * is stored against `checkKey`, not the per-scan uuid — a finding that
 * recurs run after run is the same open item, and resolving it (the check
 * coming back clean) is what makes the item stop appearing here at all.
 *
 * This reuses `remediation_tracker_steps` as-is — same columns, same
 * vocabulary, same verification-reset-on-write rule `portal-remediation-
 * tracker.ts` already established — by writing rows whose `step_id` holds a
 * `checkKey` string (e.g. "sharepoint:orgwide-links") instead of an `s`-id.
 * `step_id` is plain text with no CHECK constraint, so this needed no schema
 * change. It does NOT touch the existing s1–s30 rows, route or catalogue,
 * so `progress.fix_verified` / `remediation.phase_gate_verified` /
 * `remediation.task_awaiting_customer` (customer_tenant-alert-engine.ts) —
 * which all key off `customer_id` + `status`/`verification_state` only,
 * never `step_id` — keep working unchanged; they now also count
 * findings-derived rows once a customer starts working this checklist,
 * which is the honest, more-complete answer to what those alerts describe.
 *
 * WHAT MAKES AN ITEM
 * -------------------
 * The customer's latest completed-or-current scan's real adverse findings
 * (`critical` | `warning` — the same set `pillar-summary-stats.ts` uses for
 * its own cards, `PILLAR_FINDING_SEVERITIES`). No fixture, no fabricated
 * row: a tenant that has never scanned, or whose latest scan is clean, gets
 * an empty list.
 *
 * Each item is resolved against `remediation-fix-route.ts` (#1539) —
 * `shape = min(what the finding supports, what the tenant permits)` — so the
 * checklist and the fix-route dimension it was built to need never disagree.
 */

import { and, eq, desc, inArray, isNotNull } from "drizzle-orm";
import {
  db,
  mspDiagnosticFindingsTable,
  remediationKnowledgeBaseTable,
  remediationTrackerStepsTable,
  configPackTemplatesTable,
  configPacksTable,
  monitorChecksTable,
  tenantsTable,
  REMEDIATION_TRACKER_STEP_STATUS,
  type RemediationFixRoute,
  type RemediationKbStep,
  type RemediationTrackerStepStatus,
  type RemediationTrackerVerificationState,
} from "@workspace/db";
import { resolveFixRoute, resolveTenantWriteCeiling, FIX_ROUTE_AFFORDANCE } from "./remediation-fix-route";
import { logger } from "./logger";

const log = logger.child({ channel: "engine.remediation-tracker" });

/** The same adverse-severity set the pillar cards use — a checklist is what's actually wrong, not every "ok"/"info" check the scan ran. */
export const CHECKLIST_FINDING_SEVERITIES = ["critical", "warning"] as const;

export interface RemediationChecklistItem {
  /** The finding's own stable identity — also the tracker claim's key (`remediation_tracker_steps.step_id`). */
  readonly checkKey: string;
  /** `msp_diagnostic_findings.finding_id` for the specific instance this scan found — the evidence, not the identity. */
  readonly findingId: string;
  readonly severity: "critical" | "warning";
  /** The tenant-specific fact, straight from the finding — e.g. "2,940 anonymous links found". */
  readonly title: string;
  readonly description: string | null;
  /** #1539's resolved shape for THIS tenant. */
  readonly fixRoute: RemediationFixRoute;
  readonly affordance: "execute" | "copy" | "link";
  /** A `remediation_knowledge_base` row exists and is `published` — the customer-facing content below is real, verified content rather than absent. */
  readonly hasVerifiedContent: boolean;
  readonly summary: string | null;
  readonly remediationSteps: RemediationKbStep[];
  readonly adminCenterPath: string | null;
  readonly adminCenterUrl: string | null;
  readonly validationCommand: string | null;
  /** The customer's own claim about this item — see `REMEDIATION_TRACKER_STEP_STATUS`. Defaults `not_started` when no row exists yet. */
  readonly status: RemediationTrackerStepStatus;
  readonly completedAt: string | null;
  /** Whether a rescan has actually checked that claim — see `REMEDIATION_TRACKER_VERIFICATION_STATE`. */
  readonly verificationState: RemediationTrackerVerificationState;
  readonly verifiedAt: string | null;
}

export interface RemediationChecklistResult {
  /** `msp_diagnostic_runs.run_id` the checklist was derived from, or null when the tenant has never scanned. */
  readonly runId: string | null;
  readonly items: RemediationChecklistItem[];
}

const isoOrNull = (v: Date | string | null | undefined): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : String(v);

/**
 * Resolves one customer's checklist: their latest scan's real adverse
 * findings, each turned into an item carrying its own fix route and current
 * tracker claim. Fully derived — no fabricated rows, no fixture fallback.
 */
export async function resolveRemediationChecklist(customerId: number): Promise<RemediationChecklistResult> {
  // ── The tenant's actual open findings: latest run only ──────────────────
  const [latest] = await db
    .select({ runId: mspDiagnosticFindingsTable.runId })
    .from(mspDiagnosticFindingsTable)
    .where(eq(mspDiagnosticFindingsTable.customerId, customerId))
    .orderBy(desc(mspDiagnosticFindingsTable.createdAt))
    .limit(1);

  if (!latest) {
    return { runId: null, items: [] };
  }

  const findings = await db
    .select({
      findingId: mspDiagnosticFindingsTable.findingId,
      checkKey: mspDiagnosticFindingsTable.checkKey,
      severity: mspDiagnosticFindingsTable.severity,
      title: mspDiagnosticFindingsTable.title,
      description: mspDiagnosticFindingsTable.description,
    })
    .from(mspDiagnosticFindingsTable)
    .where(
      and(
        eq(mspDiagnosticFindingsTable.runId, latest.runId),
        inArray(mspDiagnosticFindingsTable.severity, [...CHECKLIST_FINDING_SEVERITIES]),
      ),
    );

  if (findings.length === 0) {
    return { runId: latest.runId, items: [] };
  }

  const checkKeys = [...new Set(findings.map((f) => f.checkKey))];

  // ── Tenant side: the write-back ceiling (#1539) ──────────────────────────
  const [tenant] = await db
    .select({ consent: tenantsTable.consent })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, customerId))
    .limit(1);

  // ── Finding side: published KB content for these checks ─────────────────
  const kbRows = await db
    .select({
      checkKey: remediationKnowledgeBaseTable.checkKey,
      title: remediationKnowledgeBaseTable.title,
      summary: remediationKnowledgeBaseTable.summary,
      remediationSteps: remediationKnowledgeBaseTable.remediationSteps,
      capability: remediationKnowledgeBaseTable.fixRouteCapability,
      adminCenterPath: remediationKnowledgeBaseTable.adminCenterPath,
      adminCenterUrl: remediationKnowledgeBaseTable.adminCenterUrl,
      validationCommand: remediationKnowledgeBaseTable.validationCommand,
      status: remediationKnowledgeBaseTable.status,
    })
    .from(remediationKnowledgeBaseTable)
    .where(and(inArray(remediationKnowledgeBaseTable.checkKey, checkKeys), eq(remediationKnowledgeBaseTable.status, "published")));
  const kbByKey = new Map(kbRows.map((r) => [r.checkKey, r]));

  // ── Checks a live, execution-ready config pack maps (#1539) ──────────────
  const packRows = await db
    .select({ checkKey: configPackTemplatesTable.checkKey })
    .from(configPackTemplatesTable)
    .innerJoin(configPacksTable, eq(configPacksTable.id, configPackTemplatesTable.packId))
    .where(
      and(
        inArray(configPackTemplatesTable.checkKey, checkKeys),
        isNotNull(configPackTemplatesTable.checkKey),
        isNotNull(configPackTemplatesTable.templateId),
        eq(configPacksTable.status, "active"),
      ),
    );
  const packCheckKeys = new Set(packRows.map((r) => r.checkKey).filter((k): k is string => k !== null));

  // ── This tenant's existing tracker claims, keyed by checkKey ─────────────
  const trackerRows = await db
    .select({
      stepId: remediationTrackerStepsTable.stepId,
      status: remediationTrackerStepsTable.status,
      completedAt: remediationTrackerStepsTable.completedAt,
      verificationState: remediationTrackerStepsTable.verificationState,
      verifiedAt: remediationTrackerStepsTable.verifiedAt,
    })
    .from(remediationTrackerStepsTable)
    .where(and(eq(remediationTrackerStepsTable.customerId, customerId), inArray(remediationTrackerStepsTable.stepId, checkKeys)));
  const trackerByKey = new Map(trackerRows.map((r) => [r.stepId, r]));

  const items: RemediationChecklistItem[] = findings.map((f): RemediationChecklistItem => {
    const kb = kbByKey.get(f.checkKey);
    const writePackAvailable = packCheckKeys.has(f.checkKey);
    const fixRoute = resolveFixRoute({
      capability: kb?.capability ?? null,
      writePackAvailable,
      consent: tenant?.consent,
    });
    const tracker = trackerByKey.get(f.checkKey);

    return {
      checkKey: f.checkKey,
      findingId: f.findingId,
      severity: f.severity as "critical" | "warning",
      title: f.title,
      description: f.description,
      fixRoute,
      affordance: FIX_ROUTE_AFFORDANCE[fixRoute],
      hasVerifiedContent: kb !== undefined,
      summary: kb?.summary ?? null,
      remediationSteps: kb?.remediationSteps ?? [],
      adminCenterPath: kb?.adminCenterPath ?? null,
      adminCenterUrl: kb?.adminCenterUrl ?? null,
      validationCommand: kb?.validationCommand ?? null,
      status: (tracker?.status as RemediationTrackerStepStatus) ?? "not_started",
      completedAt: isoOrNull(tracker?.completedAt),
      verificationState: (tracker?.verificationState as RemediationTrackerVerificationState) ?? "unverified",
      verifiedAt: isoOrNull(tracker?.verifiedAt),
    };
  });

  // Critical first, then warning; alphabetical within a tier so the order is stable render to render.
  items.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "critical" ? -1 : 1;
    return a.title.localeCompare(b.title);
  });

  log.info({ customerId, runId: latest.runId, itemCount: items.length }, "remediation checklist resolved from findings");

  return { runId: latest.runId, items };
}

/**
 * The real, current vocabulary of writable check keys — `monitor_checks.key`,
 * the same FK target `remediation_knowledge_base.check_key` already restricts
 * to. Used by the write route to reject junk keys without reintroducing a
 * second hand-maintained id list.
 */
export async function isKnownCheckKey(checkKey: string): Promise<boolean> {
  const [row] = await db.select({ key: monitorChecksTable.key }).from(monitorChecksTable).where(eq(monitorChecksTable.key, checkKey)).limit(1);
  return row !== undefined;
}

/**
 * One checklist item, resolved the same way `resolveRemediationChecklist`
 * resolves all of them. Returns null when `checkKey` names no OPEN finding
 * for this tenant's latest scan — a finding that has already resolved (fixed,
 * no longer flagged) or was never real for this tenant is not something a
 * "raise a change to fix this" action can be raised against, and this is the
 * single fail-closed gate that guarantees that (#1941).
 */
export async function resolveRemediationChecklistItem(
  customerId: number,
  checkKey: string,
): Promise<RemediationChecklistItem | null> {
  const { items } = await resolveRemediationChecklist(customerId);
  return items.find((item) => item.checkKey === checkKey) ?? null;
}

export { REMEDIATION_TRACKER_STEP_STATUS };
