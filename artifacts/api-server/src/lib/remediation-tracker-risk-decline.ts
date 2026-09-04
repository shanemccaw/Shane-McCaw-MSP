/**
 * remediation-tracker-risk-decline.ts — Git #1542, part of #1489.
 *
 * "A finding the customer accepts as risk should not sit unverified forever —
 * it exits the checklist to the register." Same rejection-to-risk path as
 * #1514, arriving from the Remediation Tracker rather than Change Control: a
 * customer declining to fix a checklist item is accepting the residual risk,
 * and the decline IS the acceptance — one signed action, not two.
 *
 * THE SHIPPED PRECEDENT THIS MIRRORS
 * -----------------------------------
 * #1514's own mechanism already exists and is live on `main`:
 * `createAcceptedRiskFromDecline()` / `declineRoutedChangeToRisk()` in
 * `m365-change-router.ts` (landed under #1496, explicitly commented "#1514").
 * This file is that function's Remediation Tracker counterpart — same shape,
 * same NOT-NULL-field discipline (never an invented dollar figure or score),
 * same back-pointer convention — sourced from `remediation_tracker_steps` /
 * `REMEDIATION_TRACKER_CATALOGUE` / `msp_diagnostic_findings` instead of a
 * `msp_change_requests` row. `riskScoreForLevel()` is imported rather than
 * re-implemented so the two paths cannot silently disagree on what a risk
 * level is worth.
 *
 * WHERE THE REQUIRED MSP-LIABILITY FIELDS COME FROM
 * ----------------------------------------------------
 * `msp_risk_decisions` carries several NOT NULL fields that exist for a human
 * MSP assessor authoring a liability record by hand (`framework`,
 * `controlViolated`, `graphEndpoint`, `liabilityValueUsd`). A declined
 * checklist item has none of those, and inventing them would be exactly the
 * fabricated-data failure this codebase's own standing rules forbid. Every
 * field here is either a real, derived value or an explicitly-labelled,
 * documented absence:
 *   - `title`/`controlViolated` — the step's own verified catalogue entry
 *     (`REMEDIATION_TRACKER_CATALOGUE`, already used by the CSV/PDF export).
 *   - `rawRiskLevel`/`residualRiskLevel` — the most recent real scan severity
 *     on this step's mapped check(s), when one exists; `medium` only when no
 *     scan evidence exists at all (documented default, never presented as
 *     measured).
 *   - `hazardDescription` — the published KB summary, then the scan finding's
 *     own description/title, then the check's own `monitor_checks.label`,
 *     then the catalogue title — in that order, never fabricated prose.
 *   - `liabilityValueUsd` — always 0. Not quantified here, same as the #1514
 *     precedent: a dollar figure this module cannot measure is never invented.
 *   - `graphEndpoint` — always "". Nothing to cite; the same precedent leaves
 *     it blank rather than guessing one.
 *
 * ALL MAPPED CHECK KEYS ARE LINKED (#1957)
 * -------------------------------------------
 * A handful of steps map to more than one check (see
 * `REMEDIATION_TRACKER_STEP_CHECK_KEYS`). The risk decision's `checkKey`
 * column still only carries the first, but every additional mapped key goes
 * into `additionalCheckKeys` (#1957) — the customer-tenant alert engine's
 * suppression query matches either column, so declining one of these steps
 * now suppresses re-firing on the WHOLE mapped set, not just the first. This
 * closes the documented limitation #1542 originally shipped with (see the
 * #1957 bookend).
 *
 * THE REVIEW CLOCK (#1507)
 * --------------------------
 * Unlike the pre-#1507 CR precedent (which only set the legacy `reviewDate`
 * string), this path sets BOTH the legacy display copy AND the real
 * `reviewDueAt`/`reviewState` machine columns #1507 introduced — #1507 is a
 * direct, shipped dependency of this issue, so its model is followed exactly
 * rather than the stale pattern that predates it.
 */

import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";

import {
  db,
  mspRiskDecisionsTable,
  mspDiagnosticFindingsTable,
  remediationKnowledgeBaseTable,
  monitorChecksTable,
  type MspAssessor,
  type ClientApprover,
} from "@workspace/db";

import { riskScoreForLevel } from "./m365-change-router";
import { assignRegisterRef } from "./risk-register-ref";
import { REMEDIATION_TRACKER_CATALOGUE, type RemediationTrackerCatalogueStep } from "./remediation-tracker-catalogue";
import { REMEDIATION_TRACKER_STEP_CHECK_KEYS } from "./remediation-tracker-verification";
import type { TenantScope } from "./portal-customer-scope";
import { logger } from "./logger";

const log = logger.child({ channel: "engine.remediation-tracker" });

const RISK_REVIEW_DAYS = 90;

const DEFAULT_ACCEPTANCE_STATEMENT =
  "By declining this remediation item I accept the residual risk of leaving the current configuration in place until a future fix supersedes it.";

/** Real scan severity → risk level. `MSP_DIAGNOSTIC_FINDING_SEVERITY` is `ok | info | warning | critical`. */
const SEVERITY_TO_RISK_LEVEL: Readonly<Record<string, string>> = {
  critical: "critical",
  warning: "high",
  info: "medium",
  ok: "low",
};

const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/** "27 Aug 2026" — matches `reviewDate`'s own documented display format. */
function formatReviewDate(d: Date): string {
  return `${d.getUTCDate()} ${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function catalogueEntry(stepId: string): RemediationTrackerCatalogueStep | undefined {
  return REMEDIATION_TRACKER_CATALOGUE.find((s) => s.id === stepId);
}

function titleCase(value: string): string {
  return value.length ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

export interface RemediationDeclineInput {
  readonly stepId: string;
  /** remediation_tracker_steps.id for this (customerId, stepId) row — must already exist. */
  readonly trackerStepRowId: number;
  readonly scope: TenantScope;
  /** The name the customer typed, same acceptance UX as the Risk Register's own accept flow. */
  readonly approverName: string;
  readonly approverEmail?: string;
  readonly statement: string;
}

export interface RemediationDeclineResult {
  readonly riskDecisionId: number;
  readonly rbdId: string;
  /** True when this step had already been declined-to-risk; the existing record is returned untouched. */
  readonly alreadyDeclined: boolean;
}

export interface RemediationChecklistDeclineInput {
  /** The finding's own stable identity — same string this row's `step_id` already holds (#1538). */
  readonly checkKey: string;
  /** remediation_tracker_steps.id for this (customerId, checkKey) row — must already exist. */
  readonly trackerStepRowId: number;
  readonly scope: TenantScope;
  /** The tenant-specific fact straight from the finding — `RemediationChecklistItem.title` (#1538), never invented. */
  readonly findingTitle: string;
  /** `RemediationChecklistItem.severity` — this checklist's only two adverse severities. */
  readonly severity: "critical" | "warning";
  /** Real evidence, in the same summary→description→title fallback order `resolveRemediationChecklist` already applies — never fabricated prose. */
  readonly hazardCore: string;
  readonly approverName: string;
  readonly approverEmail?: string;
  readonly statement: string;
}

/**
 * Declines one remediation-tracker step to the risk register: creates a
 * SIGNED, active `msp_risk_decisions` row (the decline IS the acceptance,
 * #1514's model) and returns its id. Idempotent on (mspId, rbdId) — a repeat
 * call for the same step returns the existing accepted risk rather than
 * erroring or re-signing it.
 */
export async function declineRemediationStepToRisk(input: RemediationDeclineInput): Promise<RemediationDeclineResult> {
  const { stepId, trackerStepRowId, scope, statement } = input;
  const approverName = (input.approverName ?? "").trim() || "Customer";
  const approverEmail = (input.approverEmail ?? "").trim();
  const rbdId = `RR-RT-${scope.customerId}-${stepId}`;

  const [existing] = await db
    .select({ id: mspRiskDecisionsTable.id, acceptedAt: mspRiskDecisionsTable.acceptedAt })
    .from(mspRiskDecisionsTable)
    .where(and(eq(mspRiskDecisionsTable.mspId, scope.mspId), eq(mspRiskDecisionsTable.rbdId, rbdId)))
    .limit(1);

  if (existing?.acceptedAt) {
    return { riskDecisionId: existing.id, rbdId, alreadyDeclined: true };
  }

  const mappedKeys = REMEDIATION_TRACKER_STEP_CHECK_KEYS[stepId] ?? [];
  const catalogue = catalogueEntry(stepId);
  const acceptedAt = new Date();

  // The most recent real scan finding on this step's mapped check(s), for this
  // tenant — real evidence, never guessed. Absent for steps never scanned, or
  // with no mapped check at all (the platform-wide gaps / process-only steps).
  const [finding] = mappedKeys.length
    ? await db
        .select({
          severity: mspDiagnosticFindingsTable.severity,
          title: mspDiagnosticFindingsTable.title,
          description: mspDiagnosticFindingsTable.description,
          checkKey: mspDiagnosticFindingsTable.checkKey,
        })
        .from(mspDiagnosticFindingsTable)
        .where(
          and(
            eq(mspDiagnosticFindingsTable.customerId, scope.customerId),
            inArray(mspDiagnosticFindingsTable.checkKey, mappedKeys as string[]),
          ),
        )
        .orderBy(desc(mspDiagnosticFindingsTable.createdAt))
        .limit(1)
    : [];

  // Primary key on the existing `checkKey` column, every remaining mapped key
  // on `additionalCheckKeys` (#1957) — see the header. `undefined` (not `[]`)
  // when there's nothing beyond the primary, so the column stays NULL rather
  // than storing an empty array on every single-key step.
  const primaryCheckKey = mappedKeys[0] ?? null;
  const additionalCheckKeys = mappedKeys.length > 1 ? mappedKeys.slice(1) : undefined;

  const [kbRow] = primaryCheckKey
    ? await db
        .select({ summary: remediationKnowledgeBaseTable.summary })
        .from(remediationKnowledgeBaseTable)
        .where(and(eq(remediationKnowledgeBaseTable.checkKey, primaryCheckKey), eq(remediationKnowledgeBaseTable.status, "published")))
        .limit(1)
    : [];

  const [checkRow] = primaryCheckKey
    ? await db
        .select({ label: monitorChecksTable.label })
        .from(monitorChecksTable)
        .where(eq(monitorChecksTable.key, primaryCheckKey))
        .limit(1)
    : [];

  const title = catalogue?.title ?? `Remediation step ${stepId}`;
  const controlViolated = catalogue?.pillar ? titleCase(catalogue.pillar) : "Remediation Tracker";

  const hazardCore =
    kbRow?.summary?.trim() ||
    finding?.description?.trim() ||
    finding?.title?.trim() ||
    checkRow?.label?.trim() ||
    title;
  const hazardDescription = `${hazardCore} The customer declined this remediation item; the residual risk is accepted until a future fix supersedes it.`;

  const riskLevel = (finding?.severity && SEVERITY_TO_RISK_LEVEL[finding.severity]) || "medium";
  const riskScore = riskScoreForLevel(riskLevel);

  const reviewDueAt = new Date(acceptedAt.getTime() + RISK_REVIEW_DAYS * 86_400_000);
  const reviewDisplay = formatReviewDate(reviewDueAt);
  const signedAtDisplay = acceptedAt.toISOString().substring(0, 19).replace("T", " ") + " UTC";
  const signatureHash = createHash("sha256")
    .update([rbdId, approverName, acceptedAt.toISOString(), statement].join(" "))
    .digest("hex");

  const mspAssessor: MspAssessor = { name: "Remediation Tracker", upn: "system@remediation-tracker", timestamp: acceptedAt.toISOString() };
  const clientApprover: ClientApprover = {
    name: approverName,
    title: "",
    email: approverEmail,
    signedAt: signedAtDisplay,
    ipAddress: null,
    signatureHash,
  };

  const [inserted] = await db
    .insert(mspRiskDecisionsTable)
    .values({
      mspId: scope.mspId,
      rbdId,
      tenantId: scope.tenantId,
      tenantName: scope.tenantName,
      primaryDomain: scope.primaryDomain,
      title,
      controlViolated,
      framework: "Remediation Tracker",
      checkKey: primaryCheckKey,
      additionalCheckKeys,
      rawRiskLevel: riskLevel,
      residualRiskLevel: riskLevel, // declining accepts the risk whole — no mitigation applied
      rawRiskScore: riskScore,
      residualRiskScore: riskScore,
      liabilityValueUsd: 0, // not quantified here — never an invented dollar figure
      hazardDescription,
      graphEndpoint: "",
      compensatingControls: [],
      mspAssessor,
      clientApprover,
      expirationDate: reviewDisplay,
      status: "active",
      riskStatus: "Accepted",
      reviewDate: reviewDisplay,
      reviewDueAt,
      reviewState: "on_track",
      acceptedAt,
      acceptedStatement: statement,
      // #1542 back-pointer: this risk was spawned by the remediation step the customer declined.
      spawnedByRemediationStepId: trackerStepRowId,
    })
    .onConflictDoUpdate({
      // (mspId, rbdId) unique — a repeated decline of the same step returns the same risk.
      target: [mspRiskDecisionsTable.mspId, mspRiskDecisionsTable.rbdId],
      set: { updatedAt: acceptedAt },
    })
    .returning({ id: mspRiskDecisionsTable.id });

  await assignRegisterRef(inserted.id);

  log.info(
    { customerId: scope.customerId, stepId, riskDecisionId: inserted.id, rbdId, checkKey: primaryCheckKey, additionalCheckKeys },
    "remediation step declined to risk register — accepted risk created (#1542)",
  );

  return { riskDecisionId: inserted.id, rbdId, alreadyDeclined: false };
}

/**
 * Declines one FINDINGS-DERIVED checklist item (#1538, checkKey-addressed) to
 * the risk register — the same signed `msp_risk_decisions` row
 * `declineRemediationStepToRisk` creates for the s1–s30 world, above (#2869).
 *
 * Simpler than the s1–s30 path by construction: a checklist item's identity
 * IS a real, currently-open finding (`resolveRemediationChecklistItem`,
 * `remediation-checklist.ts`) rather than a hand-authored step that may or may
 * not map to one — so the caller passes the finding's own already-resolved
 * title/severity/summary straight through instead of this function
 * re-deriving them via `REMEDIATION_TRACKER_STEP_CHECK_KEYS`. Same
 * NOT-NULL-field discipline as the s1–s30 path: `liabilityValueUsd` always 0,
 * `graphEndpoint` always "" — never an invented figure.
 */
export async function declineRemediationChecklistItemToRisk(
  input: RemediationChecklistDeclineInput,
): Promise<RemediationDeclineResult> {
  const { checkKey, trackerStepRowId, scope, findingTitle, severity, hazardCore, statement } = input;
  const approverName = (input.approverName ?? "").trim() || "Customer";
  const approverEmail = (input.approverEmail ?? "").trim();
  const rbdId = `RR-RT-${scope.customerId}-${checkKey}`;

  const [existing] = await db
    .select({ id: mspRiskDecisionsTable.id, acceptedAt: mspRiskDecisionsTable.acceptedAt })
    .from(mspRiskDecisionsTable)
    .where(and(eq(mspRiskDecisionsTable.mspId, scope.mspId), eq(mspRiskDecisionsTable.rbdId, rbdId)))
    .limit(1);

  if (existing?.acceptedAt) {
    return { riskDecisionId: existing.id, rbdId, alreadyDeclined: true };
  }

  const acceptedAt = new Date();
  const riskLevel = SEVERITY_TO_RISK_LEVEL[severity] || "medium";
  const riskScore = riskScoreForLevel(riskLevel);

  const reviewDueAt = new Date(acceptedAt.getTime() + RISK_REVIEW_DAYS * 86_400_000);
  const reviewDisplay = formatReviewDate(reviewDueAt);
  const signedAtDisplay = acceptedAt.toISOString().substring(0, 19).replace("T", " ") + " UTC";
  const signatureHash = createHash("sha256")
    .update([rbdId, approverName, acceptedAt.toISOString(), statement].join(" "))
    .digest("hex");

  const mspAssessor: MspAssessor = { name: "Remediation Tracker", upn: "system@remediation-tracker", timestamp: acceptedAt.toISOString() };
  const clientApprover: ClientApprover = {
    name: approverName,
    title: "",
    email: approverEmail,
    signedAt: signedAtDisplay,
    ipAddress: null,
    signatureHash,
  };

  const hazardDescription = `${hazardCore} The customer declined this remediation item; the residual risk is accepted until a future fix supersedes it.`;

  const [inserted] = await db
    .insert(mspRiskDecisionsTable)
    .values({
      mspId: scope.mspId,
      rbdId,
      tenantId: scope.tenantId,
      tenantName: scope.tenantName,
      primaryDomain: scope.primaryDomain,
      title: findingTitle,
      controlViolated: "Remediation Checklist",
      framework: "Remediation Checklist",
      checkKey,
      rawRiskLevel: riskLevel,
      residualRiskLevel: riskLevel, // declining accepts the risk whole — no mitigation applied
      rawRiskScore: riskScore,
      residualRiskScore: riskScore,
      liabilityValueUsd: 0, // not quantified here — never an invented dollar figure
      hazardDescription,
      graphEndpoint: "",
      compensatingControls: [],
      mspAssessor,
      clientApprover,
      expirationDate: reviewDisplay,
      status: "active",
      riskStatus: "Accepted",
      reviewDate: reviewDisplay,
      reviewDueAt,
      reviewState: "on_track",
      acceptedAt,
      acceptedStatement: statement,
      // #2869 back-pointer: this risk was spawned by the checklist item the customer declined.
      spawnedByRemediationStepId: trackerStepRowId,
    })
    .onConflictDoUpdate({
      // (mspId, rbdId) unique — a repeated decline of the same item returns the same risk.
      target: [mspRiskDecisionsTable.mspId, mspRiskDecisionsTable.rbdId],
      set: { updatedAt: acceptedAt },
    })
    .returning({ id: mspRiskDecisionsTable.id });

  await assignRegisterRef(inserted.id);

  log.info(
    { customerId: scope.customerId, checkKey, riskDecisionId: inserted.id, rbdId },
    "remediation checklist item declined to risk register — accepted risk created (#2869)",
  );

  return { riskDecisionId: inserted.id, rbdId, alreadyDeclined: false };
}
