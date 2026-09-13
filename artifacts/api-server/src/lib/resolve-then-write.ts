/**
 * resolve-then-write.ts
 *
 * #3800 — the read-informs-the-next-write half of the write-pack execution model.
 * A baseline action template's `resolveSteps` are ordered filtered Graph GETs whose
 * selected item's field(s) are assigned into the run payload, so the write's
 * endpoint/body can reference them via {{var}} — the piece
 * `baseline_action_templates`' single {endpoint,method,body} row could not express,
 * which is what blocked every ADMX (groupPolicyConfigurations + definitionValues)
 * write, KFM included (discovered in #2039, resolved by #3800). It is the mirror of
 * the create-output chaining `config_pack_templates.parameter_mapping` already does.
 *
 * This module is DELIBERATELY free of db and Graph imports — the same discipline
 * mfa-reregistration.ts follows — so the matching/assignment/fail-closed logic is
 * unit-testable against fakes with no heavy module graph. The tenant-bound wrapper
 * that supplies the real Graph reader (resolveTemplateLookups) lives in
 * workflow-executor.ts.
 */

import { interp } from "./interp.ts";

/**
 * A single "resolve" phase of a resolve-then-write template. Steps run in array
 * order BEFORE the write, each seeing the vars every earlier step assigned — so a
 * later lookup can filter on an id an earlier one resolved (e.g. resolve a
 * definitionId, then resolve that definition's presentation ids).
 */
export interface BaselineTemplateResolveStep {
  /**
   * Graph GET path, {{var}}-substituted against the progressively-resolved payload.
   * A relative "/deviceManagement/..." hits v1.0; an absolute
   * "https://graph.microsoft.com/beta/..." URL is passed through verbatim (the KFM
   * group-policy resources are beta-only). May carry $filter/$expand.
   */
  endpoint: string;
  /**
   * Client-side selection over the response's `value[]` collection (or the response
   * object itself when it is not a collection): the FIRST item for which every
   * fieldPath matches its expected value is chosen. Value convention, mirroring the
   * existing `static:` convention on parameter_mapping:
   *   - "contains:<text>" → case-insensitive substring match (robust to localized
   *      Graph displayName strings and punctuation)
   *   - "<text>"          → exact, string-coerced (===) match
   * Each expected value is {{var}}-substituted before comparison. Omit to select the
   * first item unconditionally.
   */
  selectMatch?: Record<string, string>;
  /**
   * varName → dot-path field read off the selected item. Each extracted value is
   * merged into the payload (usable as {{varName}} in later resolveSteps, the
   * endpoint, and the bodyTemplate).
   */
  assign: Record<string, string>;
  /**
   * When true, a no-match / empty collection assigns nothing and does NOT fail the
   * action. Default (false) fails closed: a required lookup that resolves nothing
   * means the write cannot be built correctly, and firing it anyway is exactly the
   * "a wrong mapping offers a fix that does not fix the finding" failure #1925/#3800
   * warn against.
   */
  optional?: boolean;
}

export interface ResolveStepOutcome {
  /** Vars assigned across every step that matched — merged into the write payload. */
  resolvedVars: Record<string, string>;
  /** True when a REQUIRED step matched nothing or its read failed: fail closed, no write. */
  failed: boolean;
  /** Human-readable reason (which step, which endpoint) when failed. */
  reason?: string;
  /** endpoint of the step that failed, for the audit/error trail. */
  failedEndpoint?: string;
}

/** #3800 — the flat set of var names a template's resolveSteps assign at runtime. */
export function resolveProvidedVariablesOf(steps: BaselineTemplateResolveStep[] | null | undefined): string[] {
  const out = new Set<string>();
  for (const step of steps ?? []) {
    for (const varName of Object.keys(step.assign ?? {})) out.add(varName);
  }
  return [...out];
}

/**
 * Read a value off an object by field path. Tries the path as a LITERAL key first,
 * so OData keys that themselves contain a dot resolve correctly (e.g. "@odata.type",
 * the field KFM presentation matching selects on) — only then does it fall back to
 * dot-path traversal ("meta.inner"). Returns undefined for any missing hop.
 */
function readFieldPath(obj: unknown, path: string): unknown {
  if (obj != null && typeof obj === "object" && path in (obj as Record<string, unknown>)) {
    return (obj as Record<string, unknown>)[path];
  }
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Does a candidate item satisfy every selectMatch entry? "contains:" → ci-substring, else exact. */
function itemMatchesSelect(
  item: unknown,
  selectMatch: Record<string, string> | undefined,
  payload: Record<string, unknown>,
): boolean {
  if (!selectMatch) return true;
  for (const [fieldPath, rawExpected] of Object.entries(selectMatch)) {
    const actualRaw = readFieldPath(item, fieldPath);
    const actual = actualRaw == null ? "" : String(actualRaw);
    if (rawExpected.startsWith("contains:")) {
      const needle = (interp(rawExpected.slice("contains:".length), payload) ?? "").trim().toLowerCase();
      if (!actual.toLowerCase().includes(needle)) return false;
    } else {
      const expected = (interp(rawExpected, payload) ?? "").trim();
      if (actual !== expected) return false;
    }
  }
  return true;
}

/**
 * Pure resolve-then-write core. Runs each step's GET via the injected `graphGet`,
 * selects the first matching item, assigns extracted fields, and threads them into
 * the payload for later steps. Fails closed on a required step that matches nothing
 * or whose read throws.
 */
export async function runTemplateResolveSteps(
  steps: BaselineTemplateResolveStep[],
  basePayload: Record<string, unknown>,
  graphGet: (endpoint: string) => Promise<any>,
): Promise<ResolveStepOutcome> {
  const resolvedVars: Record<string, string> = {};
  // Later steps see earlier steps' assignments layered over the base payload.
  const workingPayload: Record<string, unknown> = { ...basePayload };

  for (const step of steps) {
    const endpoint = interp(step.endpoint, workingPayload) ?? step.endpoint;
    let body: any;
    try {
      body = await graphGet(endpoint);
    } catch (err) {
      if (step.optional) continue;
      return {
        resolvedVars,
        failed: true,
        reason: `resolve lookup GET ${endpoint} failed: ${err instanceof Error ? err.message : String(err)}`,
        failedEndpoint: endpoint,
      };
    }

    // A Graph collection response is { value: [...] }; a single-object read is the object itself.
    const candidates: unknown[] = Array.isArray(body?.value)
      ? body.value
      : body != null
        ? [body]
        : [];
    const matched = candidates.find((item) => itemMatchesSelect(item, step.selectMatch, workingPayload));

    if (matched === undefined) {
      if (step.optional) continue;
      return {
        resolvedVars,
        failed: true,
        reason: `resolve lookup GET ${endpoint} matched no item${step.selectMatch ? ` for ${JSON.stringify(step.selectMatch)}` : ""}`,
        failedEndpoint: endpoint,
      };
    }

    for (const [varName, fieldPath] of Object.entries(step.assign ?? {})) {
      const value = readFieldPath(matched, fieldPath);
      if (value == null || value === "") {
        if (step.optional) continue;
        return {
          resolvedVars,
          failed: true,
          reason: `resolve lookup GET ${endpoint} selected an item with no '${fieldPath}' to assign to '${varName}'`,
          failedEndpoint: endpoint,
        };
      }
      const asStr = String(value);
      resolvedVars[varName] = asStr;
      workingPayload[varName] = asStr;
    }
  }

  return { resolvedVars, failed: false };
}
