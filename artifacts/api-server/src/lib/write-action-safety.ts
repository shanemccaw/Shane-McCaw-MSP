/**
 * write-action-safety.ts
 *
 * Pure (no-DB) helpers backing the Simulator Studio "Write Actions" surface —
 * kept out of the route handler so they can be unit-tested against the real
 * data shapes without a database.
 *
 * Two concerns:
 *   1. successCriteria evaluation — baseline_action_templates.success_criteria is
 *      real, already-defined per-template metadata of the shape {"statusCode": N}
 *      (see 2026-07-20-launch-control-phase3-templates.sql). The PRODUCTION
 *      executor (runBaselineTemplateAgainstTenant → graphWriteForTenant) does NOT
 *      evaluate it — it determines success purely from the HTTP status class
 *      [200,201,204]. We do NOT override that; we surface, alongside the real
 *      production `success`, whether the template's own declared expected
 *      statusCode matched the status actually returned. Comparing the real
 *      returned status to the real declared status is not a new
 *      success-determination mechanism — it is reading data that already exists.
 *
 *   2. dependsOn chain state — baseline_action_templates.depends_on lists other
 *      real templateIds that must run first. The executor does NOT gate on it
 *      (it is inert at execution time). So the ONLY thing standing between an
 *      operator and running a dependent action in isolation is this surfacing +
 *      the confirmation step. We classify each declared dependency (does the
 *      template exist? does it have a recent successful run for this customer?)
 *      and raise an explicit standalone-run warning whenever dependencies exist.
 */

export interface SuccessCriteriaEvaluation {
  /** true when successCriteria declares an expected statusCode we can compare against. */
  defined: boolean;
  /** The expected status code declared by the template, when defined. */
  expectedStatus?: number;
  /** The status the Graph write actually returned. */
  actualStatus: number;
  /**
   * true only when `defined` and expectedStatus === actualStatus.
   * Left undefined when the template declares no comparable statusCode — we do
   * NOT guess a pass/fail with no criterion to check against.
   */
  met?: boolean;
  /** Human-readable, honest description of what was (or could not be) compared. */
  note: string;
}

/**
 * Compare a template's declared successCriteria against the status a real Graph
 * write returned. Descriptive only — never the authority on whether the write
 * succeeded (that is the production `success` flag from graphWriteForTenant).
 */
export function evaluateSuccessCriteria(
  successCriteria: Record<string, unknown> | null | undefined,
  actualStatus: number,
): SuccessCriteriaEvaluation {
  const raw = successCriteria && typeof successCriteria === "object" ? successCriteria["statusCode"] : undefined;
  const expectedStatus = typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;

  if (expectedStatus === undefined) {
    return {
      defined: false,
      actualStatus,
      note: "Template declares no expected statusCode in successCriteria — nothing to compare; rely on the HTTP status class.",
    };
  }

  const met = expectedStatus === actualStatus;
  return {
    defined: true,
    expectedStatus,
    actualStatus,
    met,
    note: met
      ? `Returned ${actualStatus}, matching the template's declared expected status ${expectedStatus}.`
      : `Returned ${actualStatus}, which differs from the template's declared expected status ${expectedStatus}. (Graph write-success is still judged by the [200,201,204] status class, not by this exact-match.)`,
  };
}

export interface DependsOnEntry {
  templateId: string;
  /** Whether a baseline_action_template with this id actually exists. */
  exists: boolean;
  /** Label of the dependency template, when it exists. */
  label: string | null;
  /**
   * Best-effort hint: whether this dependency has at least one successful
   * execution recorded for the target customer. NOT a guarantee the tenant's
   * live state satisfies it — only that the dependency was run and succeeded.
   */
  hasRecentSuccess: boolean;
}

export interface DependsOnState {
  entries: DependsOnEntry[];
  /** true when the template declares >= 1 dependency — a standalone run risks failing. */
  hasDependencies: boolean;
  /**
   * true when at least one declared dependency has no recorded successful run
   * for this customer (best-effort — the executor does not enforce dependsOn).
   */
  possiblyUnsatisfied: boolean;
  /**
   * A single, plainly-worded warning to show in the confirmation step whenever
   * dependencies exist. null when there are no dependencies.
   */
  isolatedRunWarning: string | null;
}

/**
 * Classify a template's declared dependsOn chain for the confirmation surface.
 *
 * @param dependsOn                  the template's declared depends_on templateIds
 * @param knownTemplateLabels        map of every existing templateId -> its label
 * @param recentlySucceededTemplateIds  set of templateIds that have a recorded
 *                                       successful run for the target customer
 */
export function resolveDependsOnState(
  dependsOn: string[] | null | undefined,
  knownTemplateLabels: Map<string, string>,
  recentlySucceededTemplateIds: Set<string>,
): DependsOnState {
  const deps = Array.isArray(dependsOn) ? dependsOn.filter(d => typeof d === "string" && d.length > 0) : [];

  const entries: DependsOnEntry[] = deps.map(templateId => {
    const exists = knownTemplateLabels.has(templateId);
    return {
      templateId,
      exists,
      label: exists ? knownTemplateLabels.get(templateId)! : null,
      hasRecentSuccess: recentlySucceededTemplateIds.has(templateId),
    };
  });

  const hasDependencies = entries.length > 0;
  const possiblyUnsatisfied = entries.some(e => !e.hasRecentSuccess);

  let isolatedRunWarning: string | null = null;
  if (hasDependencies) {
    const unmet = entries.filter(e => !e.hasRecentSuccess).map(e => e.templateId);
    isolatedRunWarning = possiblyUnsatisfied
      ? `This action declares ${entries.length} dependenc${entries.length === 1 ? "y" : "ies"} that must run first (${deps.join(", ")}). ` +
        `No recorded successful run for this customer was found for: ${unmet.join(", ")}. ` +
        `Running it standalone may fail or behave unexpectedly if those dependencies were never satisfied on the tenant.`
      : `This action declares ${entries.length} dependenc${entries.length === 1 ? "y" : "ies"} (${deps.join(", ")}), each with a recorded successful run for this customer. ` +
        `You are still running it in isolation, not as part of its chain — proceed only if the tenant state genuinely satisfies these.`;
  }

  return { entries, hasDependencies, possiblyUnsatisfied, isolatedRunWarning };
}
