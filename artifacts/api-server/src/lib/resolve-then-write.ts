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
   *   - "in:<a>,<b>,..."  → the field equals (case-insensitive) one of a
   *      comma-separated list — typically a {{var}} an earlier step's `collect`
   *      filled, so a later lookup can intersect two collections (#4514)
   *   - "ieq:<text>"      → case-insensitive, whitespace-trimmed equality (#4531),
   *      for names that may contain a comma and so cannot use "in:". Never
   *      matches when <text> interpolates to nothing.
   *   - "has:<a>,<b>,..." → the field is an ARRAY holding every listed value
   *      (case-insensitive) — e.g. a CA policy's conditions.users.excludeGroups
   *      holding {{breakGlassGroupId}} (#4531). A list that interpolates to
   *      nothing never matches: an unresolved {{var}} is not "requires nothing".
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
  /**
   * #4514 — every matching item across every page must be exactly ONE. Two or more
   * matches fail closed and report the matched ids rather than picking the first:
   * when a tenant holds two "Break-Glass Accounts - CA Exclusion" groups, choosing
   * one by response order is a guess, and the wrong guess leaves every admin who is
   * only in the other group inside a blocking CA policy.
   */
  unique?: boolean;
  /**
   * #4514 — varName → dot-path read off EVERY matching item (not just the first),
   * assigned as a comma-separated list. Feeds a later step's `in:` selectMatch.
   */
  collect?: Record<string, string>;
  /**
   * #4514 — resolve-then-skip. When this step matches, the resource the template
   * would create already exists: assign vars off it, stop resolving, and do NOT
   * fire the write (the caller reports the existing item as the step's result).
   * No match is not a failure — the write proceeds. Implies `unique`: two
   * existing matches are ambiguous and fail closed instead of skipping onto one.
   */
  onMatch?: "skip-write";
  /**
   * #4531 — read only on an `onMatch: "skip-write"` step. fieldPath → expected
   * value, same conventions as `selectMatch`, that the ONE existing item must ALSO
   * satisfy before the write may be skipped. A match that fails any of them fails
   * closed (no skip, no write): finding a resource by its name is not proof it is
   * the resource this template would create. A Conditional Access policy named
   * "Baseline: Require MFA for All Users (report-only)" may lack the break-glass
   * exclusion, target other users, or already be enforced — recording the step as
   * satisfied would claim a state the tenant does not hold, and creating a second
   * one beside it is the duplicate the lookup exists to prevent.
   */
  skipRequires?: Record<string, string>;
  /**
   * Plain-language name of what this lookup finds ("the break-glass CA exclusion
   * group"), used in fail-closed reasons so an operator reads what is missing
   * rather than a raw GET.
   */
  subject?: string;
}

/** One lookup's real read trail, for the audit row and operator-facing reports. */
export interface ResolveLookupTrail {
  endpoint: string;
  pages: number;
  matchedCount: number;
  /** `id` of each matched item (when the items carry one), capped at 20. */
  matchedIds: string[];
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
  /**
   * #4514 — set when an `onMatch: "skip-write"` step found the resource already
   * present: the write must NOT fire, and `item` stands in for its response.
   */
  skipWrite?: { endpoint: string; item: unknown };
  /** Every lookup that ran, in order. */
  lookups: ResolveLookupTrail[];
}

/**
 * #4514 — page bound for a lookup that follows @odata.nextLink. A `unique`,
 * `collect` or skip-write step that still has a next page after this many fails
 * closed: it cannot claim "exactly one" or "all of them" over a result it did not
 * finish reading.
 */
export const MAX_RESOLVE_PAGES = 20;

/** #3800 — the flat set of var names a template's resolveSteps assign at runtime. */
export function resolveProvidedVariablesOf(steps: BaselineTemplateResolveStep[] | null | undefined): string[] {
  const out = new Set<string>();
  for (const step of steps ?? []) {
    for (const varName of Object.keys(step.assign ?? {})) out.add(varName);
    for (const varName of Object.keys(step.collect ?? {})) out.add(varName);
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

/** An interpolated comma-separated list as trimmed, lower-cased, non-empty values. */
function listOf(raw: string, payload: Record<string, unknown>): string[] {
  return (interp(raw, payload) ?? "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v.length > 0);
}

/** Does one field of an item satisfy one expected value? Conventions: see `selectMatch`. */
function fieldMatches(
  item: unknown,
  fieldPath: string,
  rawExpected: string,
  payload: Record<string, unknown>,
): boolean {
  const actualRaw = readFieldPath(item, fieldPath);
  if (rawExpected.startsWith("has:")) {
    const required = listOf(rawExpected.slice("has:".length), payload);
    if (required.length === 0 || !Array.isArray(actualRaw)) return false;
    const held = new Set(actualRaw.map((v) => String(v).trim().toLowerCase()));
    return required.every((v) => held.has(v));
  }
  const actual = actualRaw == null ? "" : String(actualRaw);
  if (rawExpected.startsWith("in:")) {
    return listOf(rawExpected.slice("in:".length), payload).includes(actual.trim().toLowerCase());
  }
  if (rawExpected.startsWith("ieq:")) {
    const expected = (interp(rawExpected.slice("ieq:".length), payload) ?? "").trim().toLowerCase();
    return expected.length > 0 && actual.trim().toLowerCase() === expected;
  }
  if (rawExpected.startsWith("contains:")) {
    const needle = (interp(rawExpected.slice("contains:".length), payload) ?? "").trim().toLowerCase();
    return actual.toLowerCase().includes(needle);
  }
  return actual === (interp(rawExpected, payload) ?? "").trim();
}

/** Does a candidate item satisfy every selectMatch entry? */
function itemMatchesSelect(
  item: unknown,
  selectMatch: Record<string, string> | undefined,
  payload: Record<string, unknown>,
): boolean {
  if (!selectMatch) return true;
  return Object.entries(selectMatch).every(([fieldPath, rawExpected]) =>
    fieldMatches(item, fieldPath, rawExpected, payload),
  );
}

/**
 * #4531 — every `skipRequires` entry the existing item fails, rendered for the
 * fail-closed reason as `<field> expected <interpolated expectation>, found <actual>`.
 */
function unmetSkipRequirements(
  item: unknown,
  skipRequires: Record<string, string> | undefined,
  payload: Record<string, unknown>,
): string[] {
  const unmet: string[] = [];
  for (const [fieldPath, rawExpected] of Object.entries(skipRequires ?? {})) {
    if (fieldMatches(item, fieldPath, rawExpected, payload)) continue;
    const actual = readFieldPath(item, fieldPath);
    unmet.push(
      `${fieldPath} expected ${JSON.stringify(interp(rawExpected, payload) ?? rawExpected)}, ` +
        `found ${actual === undefined ? "nothing" : JSON.stringify(actual)}`,
    );
  }
  return unmet;
}

/** A matched item's `id`, when it has one — for ambiguity reports and the trail. */
function itemIdOf(item: unknown): string | null {
  const id = readFieldPath(item, "id");
  return id == null || id === "" ? null : String(id);
}

/**
 * Pure resolve-then-write core. Runs each step's GET via the injected `graphGet`,
 * selects the matching item, assigns extracted fields, and threads them into the
 * payload for later steps. Fails closed on a required step that matches nothing or
 * whose read throws, and (#4514) on a `unique`/skip-write step that matches more
 * than one item. A skip-write step that matches returns `skipWrite` and stops —
 * the caller must not fire the write — unless (#4531) its one match fails the
 * step's `skipRequires`, which fails closed instead.
 */
export async function runTemplateResolveSteps(
  steps: BaselineTemplateResolveStep[],
  basePayload: Record<string, unknown>,
  graphGet: (endpoint: string) => Promise<any>,
): Promise<ResolveStepOutcome> {
  const resolvedVars: Record<string, string> = {};
  const lookups: ResolveLookupTrail[] = [];
  // Later steps see earlier steps' assignments layered over the base payload.
  const workingPayload: Record<string, unknown> = { ...basePayload };

  const fail = (reason: string, endpoint: string): ResolveStepOutcome => ({
    resolvedVars, failed: true, reason, failedEndpoint: endpoint, lookups,
  });

  for (const step of steps) {
    const endpoint = interp(step.endpoint, workingPayload) ?? step.endpoint;
    const skipOnMatch = step.onMatch === "skip-write";
    // "Exactly one" and "all of them" need every page; a first-match step stops
    // paging as soon as it has its match.
    const needsCompleteRead = step.unique === true || skipOnMatch || step.collect !== undefined;
    const subject = step.subject ? `for ${step.subject} ` : "";

    const matches: unknown[] = [];
    let pages = 0;
    let nextUrl: string | null = endpoint;
    let readError: string | null = null;
    while (nextUrl !== null && pages < MAX_RESOLVE_PAGES) {
      let body: any;
      try {
        body = await graphGet(nextUrl);
      } catch (err) {
        readError = err instanceof Error ? err.message : String(err);
        break;
      }
      pages++;
      // A Graph collection response is { value: [...] }; a single-object read is the object itself.
      const isCollection = Array.isArray(body?.value);
      const candidates: unknown[] = isCollection ? body.value : body != null ? [body] : [];
      for (const item of candidates) {
        if (itemMatchesSelect(item, step.selectMatch, workingPayload)) matches.push(item);
      }
      const link = isCollection ? body["@odata.nextLink"] : undefined;
      nextUrl = typeof link === "string" && link.length > 0 ? link : null;
      if (!needsCompleteRead && matches.length > 0) break;
    }

    const matchedIds = matches.map(itemIdOf).filter((id): id is string => id !== null);
    lookups.push({ endpoint, pages, matchedCount: matches.length, matchedIds: matchedIds.slice(0, 20) });

    if (readError !== null) {
      if (step.optional) continue;
      return fail(`resolve lookup ${subject}GET ${endpoint} failed: ${readError}`, endpoint);
    }

    if (needsCompleteRead && nextUrl !== null) {
      return fail(
        `resolve lookup ${subject}GET ${endpoint} has more than ${MAX_RESOLVE_PAGES} pages — ` +
          `refusing to act on a result that was not read to the end`,
        endpoint,
      );
    }

    if ((step.unique === true || skipOnMatch) && matches.length > 1) {
      return fail(
        `resolve lookup ${subject}is ambiguous: ${matches.length} items match GET ${endpoint}` +
          (step.selectMatch ? ` for ${JSON.stringify(step.selectMatch)}` : "") +
          (matchedIds.length > 0 ? ` (ids: ${matchedIds.join(", ")})` : "") +
          " — refusing to guess which one is correct",
        endpoint,
      );
    }

    if (matches.length === 0) {
      // resolve-then-skip: nothing exists yet, so the write is what creates it.
      if (step.optional || skipOnMatch) continue;
      return fail(
        `resolve lookup ${subject}GET ${endpoint} matched no item${step.selectMatch ? ` for ${JSON.stringify(step.selectMatch)}` : ""}`,
        endpoint,
      );
    }

    const matched = matches[0];

    if (skipOnMatch) {
      const unmet = unmetSkipRequirements(matched, step.skipRequires, workingPayload);
      if (unmet.length > 0) {
        const id = itemIdOf(matched);
        return fail(
          `resolve lookup ${subject}found an existing item${id ? ` (id ${id})` : ""} at GET ${endpoint} that is not ` +
            `the one this template would create: ${unmet.join("; ")} — refusing to skip onto it or to create a duplicate beside it`,
          endpoint,
        );
      }
    }

    for (const [varName, fieldPath] of Object.entries(step.collect ?? {})) {
      const values = matches
        .map((item) => readFieldPath(item, fieldPath))
        .filter((v) => v != null && v !== "")
        .map(String);
      if (values.length === 0) {
        if (step.optional) continue;
        return fail(
          `resolve lookup ${subject}GET ${endpoint} matched items with no '${fieldPath}' to collect into '${varName}'`,
          endpoint,
        );
      }
      const joined = values.join(",");
      resolvedVars[varName] = joined;
      workingPayload[varName] = joined;
    }

    for (const [varName, fieldPath] of Object.entries(step.assign ?? {})) {
      const value = readFieldPath(matched, fieldPath);
      if (value == null || value === "") {
        if (step.optional) continue;
        return fail(
          `resolve lookup ${subject}GET ${endpoint} selected an item with no '${fieldPath}' to assign to '${varName}'`,
          endpoint,
        );
      }
      const asStr = String(value);
      resolvedVars[varName] = asStr;
      workingPayload[varName] = asStr;
    }

    if (skipOnMatch) {
      return { resolvedVars, failed: false, skipWrite: { endpoint, item: matched }, lookups };
    }
  }

  return { resolvedVars, failed: false, lookups };
}

/** #4514 — the distinct {{var}} names a body template references. */
export function templateBodyVariables(bodyTemplate: unknown): string[] {
  const out = new Set<string>();
  for (const m of JSON.stringify(bodyTemplate ?? {}).matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) {
    out.add((m[1].startsWith("payload.") ? m[1].slice("payload.".length) : m[1]).split(".")[0]);
  }
  return [...out];
}

/**
 * #4514 — the run node (if any) whose template skipped its write because the
 * resource already existed, and whose unapplied body carried one of `secretKeys`.
 * The break-glass gate refuses to deliver a secret this finds: it never reached
 * the tenant.
 */
export function findUnappliedSecretSource(
  nodeOutputs: Record<string, unknown> | null | undefined,
  secretKeys: Iterable<string>,
): { nodeId: string; existing: unknown } | null {
  const keys = new Set(secretKeys);
  for (const [nodeId, out] of Object.entries(nodeOutputs ?? {})) {
    const o = out as { skippedExisting?: unknown; unappliedVariables?: unknown; data?: unknown } | null;
    if (
      o?.skippedExisting === true &&
      Array.isArray(o.unappliedVariables) &&
      o.unappliedVariables.some((v) => keys.has(String(v)))
    ) {
      return { nodeId, existing: o.data ?? null };
    }
  }
  return null;
}
