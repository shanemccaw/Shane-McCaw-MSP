/**
 * monitor-failure-classifier.ts
 *
 * First-pass triage for a FAILED Simulator Studio check run (Phase 4).
 *
 * WHY THIS EXISTS: the categories below were not invented. They are the buckets
 * a real debugging session arrived at by hand, reading raw `error_message` text
 * out of `simulator_check_runs` and sorting it by eye — scope gap vs. wrong
 * endpoint vs. dead API vs. malformed request. Every signature in this file is a
 * signature that was actually observed. This module does that same first pass the
 * moment a run fails, so the same triage takes a glance instead of an evening.
 *
 * WHAT IT DELIBERATELY DOES NOT DO:
 *   • It never guesses. An error shape that matches nothing known returns
 *     "unclassified" with the raw message intact. A confidently-wrong category is
 *     strictly worse than no category — it sends the operator down a wrong path
 *     with false authority, which is exactly the failure mode the manual pass
 *     avoided by reading the real text.
 *   • It never changes anything. It returns a category, the literal evidence that
 *     produced it, and a SUGGESTED action. Applying that action is a separate
 *     human click on a real, reviewable form (see `FailureAction`), and adding a
 *     permission is not an action here at all — see `missing_scope` below.
 *   • It is a pure function over strings. No db, no Graph, no env. `declaredScopes`
 *     is passed IN by the caller (the route passes REQUIRED_MT_SCOPES) rather than
 *     imported, so this module stays trivially testable and can never be a path
 *     through which permission state is mutated.
 *
 * WHERE THE INPUT COMES FROM (audited before this was written):
 *   • monitor-executor.graphFetchPaginated throws
 *     `Graph API error {status}: {body}` for any non-ok response — so the HTTP
 *     status is carried IN the message text, and the body is the real Graph body.
 *   • A non-JSON 200 throws `Graph API returned a non-JSON body (content-type: …)`.
 *   • executeMonitorCheck puts that message on CheckResult.errorMessage UNTRUNCATED,
 *     and simulator-run-store persists it to `simulator_check_runs.error_message`,
 *     a plain `text` column. So the text this classifier sees is the real text.
 *     (The 1000-char slice in monitor-executor applies only to the separate
 *     tenant_monitor_profiles row, not to what reaches here.)
 *
 * PRECEDENCE is most-structural-first, and the order is load-bearing — see the
 * comment above each rule for why it sits where it does.
 */

// ── Categories ────────────────────────────────────────────────────────────────

export const FAILURE_CATEGORIES = [
  /** The app's token lacks a Graph permission/role the endpoint requires. */
  "missing_scope",
  /** The response never reached Graph's API logic at all (an HTML body, not JSON). */
  "wrong_endpoint",
  /** The URL is malformed: a bad segment, an unsubstituted placeholder, a literal scheme prefix. */
  "bad_path",
  /** A value landed in a parameter slot that expects something else (e.g. a locale). */
  "parameter_slot",
  /** The call shape is wrong for the intent (e.g. a download call used as a metadata read). */
  "wrong_api_pattern",
  /** Microsoft has withdrawn this API — a retirement candidate, not a fixable bug. */
  "dead_api",
  /** Already classified upstream: the tenant lacks the M365 SKU. Not a fault. */
  "license_gap",
  /** Already classified upstream: consent is gone. Not an endpoint problem. */
  "consent_revoked",
  /** Matched nothing known. Deliberate — see the module header. */
  "unclassified",
] as const;

export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

/** Stable ordering for display and for deterministic aggregation tie-breaks. */
const CATEGORY_ORDER: Record<FailureCategory, number> = Object.fromEntries(
  FAILURE_CATEGORIES.map((c, i) => [c, i]),
) as Record<FailureCategory, number>;

export const FAILURE_CATEGORY_TITLES: Record<FailureCategory, string> = {
  missing_scope: "Missing permission",
  wrong_endpoint: "Wrong endpoint",
  bad_path: "Bad path",
  parameter_slot: "Parameter in the wrong slot",
  wrong_api_pattern: "Wrong API pattern",
  dead_api: "Dead API",
  license_gap: "Tenant licence gap",
  consent_revoked: "Consent revoked",
  unclassified: "Unclassified failure",
};

// ── Actions ───────────────────────────────────────────────────────────────────

/**
 * The action kinds a classification may SUGGEST.
 *
 * Every one of these opens something reviewable. None of them is applied by the
 * classifier, and none is applied by the UI on render:
 *   • show_permission — DISPLAY ONLY, by explicit decision. Adding a permission to
 *     the multi-tenant app forces re-consent on EVERY connected tenant, so it is a
 *     human decision made deliberately, not a button. This action carries the real
 *     extracted permission name and says where it would go; it never offers to add it.
 *   • edit_endpoint  — opens the existing Phase 1 endpoint edit form, focused on the
 *     field that is most likely wrong. Saving is still the operator's own Save click.
 *   • retire_check   — the existing Phase 1 archive action: a reversible status
 *     change to "archived", behind a confirm. Never a hard delete.
 *   • none           — nothing actionable here (already-explained or unclassified).
 */
export type FailureActionKind = "show_permission" | "edit_endpoint" | "retire_check" | "none";

export interface FailureAction {
  kind: FailureActionKind;
  /** The button/label text the operator sees. */
  label: string;
  /** For edit_endpoint: which field the edit form should land the cursor in. */
  focusField?: "endpoint" | "selectParams" | "requestBody";
}

// ── Result ────────────────────────────────────────────────────────────────────

export interface FailureClassification {
  category: FailureCategory;
  title: string;
  /** What this failure means, in one line. */
  summary: string;
  /** What to do about it. Prose for a human — never something the UI executes. */
  guidance: string;
  /**
   * The literal signatures that produced this category — the proof, not a
   * paraphrase. If the operator disagrees with the verdict, this is what they
   * check it against.
   */
  evidence: string[];
  /** HTTP status, parsed from the message or supplied by the caller. */
  statusCode: number | null;
  /** Real permission/role names pulled out of the real message (missing_scope). */
  permissions: string[];
  /**
   * Of `permissions`, those ALREADY declared on the multi-tenant app. A named
   * permission that is already declared means the app has it but this tenant's
   * consent predates it — a re-consent problem, not a manifest problem. Naming
   * that difference is the whole value of surfacing this.
   */
  alreadyDeclaredPermissions: string[];
  action: FailureAction;
}

export interface FailureClassifierInput {
  /** CheckResult.errorMessage — the real, untruncated executor message. */
  errorMessage?: string | null;
  /** CheckResult.status, when known. license_gap/consent_revoked short-circuit. */
  resultStatus?: string | null;
  /** HTTP status if the caller knows it independently of the message text. */
  statusCode?: number | null;
  /** The endpoint the run actually requested — corroborating evidence only. */
  endpoint?: string | null;
  /**
   * Permissions declared on the multi-tenant App Registration (REQUIRED_MT_SCOPES).
   * READ ONLY — passed in so this module never imports permission-granting code.
   */
  declaredScopes?: readonly string[];
}

// ── Signature tables ──────────────────────────────────────────────────────────
// Every entry below was observed in a real failing run. Lower-cased matching
// throughout; the evidence string reports the signature that hit.

/**
 * Permission failures whose wording is unambiguous on its own — these do not
 * need a status code to corroborate them.
 */
const SCOPE_PHRASES = [
  "doesn't have the required permissions",
  "does not have the required permissions",
  "do not have the required permissions",
  "does not have any of the required roles",
  "caller does not have required permissions",
  "caller does not have the required permissions",
  "insufficient privileges to complete the operation",
  "application is not authorized to perform this operation",
  "required permission",
  "required role",
  "missing required permission",
  "does not have permission",
] as const;

/**
 * Graph error CODES that mean "permission" — weaker than the phrases above
 * because a bare code carries no context, so they only count alongside a 401/403.
 */
const SCOPE_CODES = ["authorization_requestdenied", "authorization_error", "accessdenied", "forbidden"] as const;

/**
 * Microsoft has withdrawn the API. These are explicit-withdrawal words: an
 * endpoint merely being on /beta is NOT one of them (see classifyMonitorFailure).
 */
const DEAD_API_PHRASES = [
  "has been deprecated",
  "is deprecated",
  "deprecated and",
  "no longer supported",
  "is no longer available",
  "has been removed",
  "has been retired",
  "sunset",
  "end of life",
] as const;

/** A value meant for one parameter landing in a locale/culture position. */
const PARAMETER_SLOT_PHRASES = [
  "culturenotfoundexception",
  "invalid culture identifier",
  "is not a valid culture",
  "invalid culture",
] as const;

/** A download-oriented call used where a metadata/read call was intended. */
const WRONG_API_PATTERN_PHRASES = ["invaliddownloadtoken", "invalid download token"] as const;

/** A malformed URL: bad segment, unsubstituted placeholder, literal scheme prefix. */
const BAD_PATH_PHRASES = [
  "resource not found for the segment",
  "invalid object identifier",
  "the request uri is not valid",
  "invalid uri",
  "bad request url",
  "malformed url",
] as const;

/** Non-http schemes that must be intercepted by the platform, never sent to Graph. */
const NON_HTTP_SCHEME_RE = /^(?!https?:)([a-z][a-z0-9+.-]*):\/\//i;

/**
 * A placeholder token that was never substituted — literal braces reaching Graph.
 * Requires a word character straight after the brace, which is what keeps it from
 * firing on the JSON braces every Graph error body is wrapped in (`{"error":…`).
 */
const UNSUBSTITUTED_PLACEHOLDER_RE = /\{[A-Za-z0-9][A-Za-z0-9_]*\}|%7[bB][A-Za-z0-9]/;

// ── Small helpers ─────────────────────────────────────────────────────────────

const firstMatch = (haystack: string, needles: readonly string[]): string | null =>
  needles.find((n) => haystack.includes(n)) ?? null;

/**
 * The HTTP status. Prefers what the caller passed; otherwise reads it back out of
 * monitor-executor's own `Graph API error {status}:` message prefix, which is
 * where the real status lives once the response has been turned into an Error.
 */
export function parseStatusCode(message: string, supplied?: number | null): number | null {
  if (typeof supplied === "number" && Number.isFinite(supplied)) return supplied;
  const m = /graph api error\s+(\d{3})\b/i.exec(message);
  return m ? Number(m[1]) : null;
}

/**
 * True when the body is HTML rather than JSON.
 *
 * This is itself the diagnostic: Graph answers in JSON even when it fails. An
 * HTML body (a bare IIS/front-door "Service Unavailable" page) means the request
 * never reached Graph's API logic, so nothing in the body is a Graph error
 * signature and no text rule below it can be trusted.
 */
function looksLikeHtmlBody(message: string): boolean {
  return (
    /<!doctype\s+html/i.test(message) ||
    /<html[\s>]/i.test(message) ||
    /content-type:\s*text\/html/i.test(message)
  );
}

// ── Permission-name extraction ────────────────────────────────────────────────

/**
 * The labelled form — "Required permission: X", "Required roles: A, B". When
 * Microsoft names the permission, this is the value of the whole feature: the
 * operator gets the real name instead of "it's a permission error somewhere".
 */
// The capture deliberately ALLOWS dots — permission names are dotted
// (SecurityEvents.Read.All), so excluding them would truncate every name to its
// first segment. The sentence boundary is re-imposed after the match by cutting
// at the first period that is followed by whitespace or end-of-string.
const LABELLED_PERMISSION_RE =
  /(?:required\s+permissions?(?:\(s\))?|required\s+roles?|required\s+scopes?|permissions?\s+required|scopes?\s+required)\s*[:\-]\s*([^"\n\\{}]+)/gi;

/**
 * The bare-token form, for messages that name the permission without labelling it.
 * Graph permission names are dotted PascalCase whose LAST segment is an access
 * verb ("All", "Read", "ReadWrite", "ManageAsApp", "ReadBasic"). Requiring that
 * shape is what keeps `System.Globalization.CultureNotFoundException` and
 * `Microsoft.Graph` out of the results.
 */
const PERMISSION_TOKEN_RE = /\b([A-Z][A-Za-z0-9]*(?:\.[A-Z][A-Za-z0-9]*){1,3})\b/g;

/** Namespaces that produce dotted PascalCase but are never permission names. */
const NON_PERMISSION_NAMESPACES = new Set(["microsoft", "system", "newtonsoft", "azure", "windows", "org", "com"]);

const ACCESS_VERB_RE = /^(All|Read|Write|Manage|Send|Create|Delete|Update|Execute|Select|Own|Initiate)/;

/** Cap on how many names are surfaced — a wall of tokens is not a finding. */
const MAX_EXTRACTED_PERMISSIONS = 8;

function looksLikePermissionName(token: string): boolean {
  const parts = token.split(".");
  if (parts.length < 2) return false;
  if (NON_PERMISSION_NAMESPACES.has(parts[0]!.toLowerCase())) return false;
  return ACCESS_VERB_RE.test(parts[parts.length - 1]!);
}

/**
 * Extracts the real named permissions/roles from a real error message.
 *
 * Labelled captures win and are taken verbatim (Microsoft's own wording, which
 * may name a role that is not dotted at all). The bare-token scan then adds
 * anything else that has the shape of a Graph permission. Order is preserved and
 * duplicates are dropped, so the first name Microsoft mentions stays first.
 */
export function extractPermissionNames(message: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const value = raw.trim().replace(/[.,;)\]]+$/, "").trim();
    if (!value) return;
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    found.push(value);
  };

  LABELLED_PERMISSION_RE.lastIndex = 0;
  let labelled: RegExpExecArray | null;
  while ((labelled = LABELLED_PERMISSION_RE.exec(message)) != null) {
    // Stop at the end of the sentence, not at the first dot — "SecurityEvents.Read.All"
    // is one name, but "…Read.All. Please contact…" is a name followed by prose.
    const sentence = labelled[1]!.split(/\.(?=\s|$)/)[0] ?? "";
    // "A, B or C" / "A; B" — Microsoft uses all of these in the same family of messages.
    for (const part of sentence.split(/,|;|\bor\b|\band\b|\|/i)) push(part);
  }

  PERMISSION_TOKEN_RE.lastIndex = 0;
  let token: RegExpExecArray | null;
  while ((token = PERMISSION_TOKEN_RE.exec(message)) != null) {
    if (looksLikePermissionName(token[1]!)) push(token[1]!);
  }

  return found.slice(0, MAX_EXTRACTED_PERMISSIONS);
}

// ── The classifier ────────────────────────────────────────────────────────────

function build(
  category: FailureCategory,
  parts: {
    summary: string;
    guidance: string;
    evidence: string[];
    statusCode: number | null;
    action: FailureAction;
    permissions?: string[];
    alreadyDeclaredPermissions?: string[];
  },
): FailureClassification {
  return {
    category,
    title: FAILURE_CATEGORY_TITLES[category],
    summary: parts.summary,
    guidance: parts.guidance,
    evidence: parts.evidence,
    statusCode: parts.statusCode,
    permissions: parts.permissions ?? [],
    alreadyDeclaredPermissions: parts.alreadyDeclaredPermissions ?? [],
    action: parts.action,
  };
}

const NO_ACTION: FailureAction = { kind: "none", label: "" };

/**
 * Classifies ONE failed run's real error text into one of the real categories.
 *
 * Returns "unclassified" — never a best guess — when nothing matches.
 */
export function classifyMonitorFailure(input: FailureClassifierInput): FailureClassification {
  const raw = (input.errorMessage ?? "").trim();
  const lower = raw.toLowerCase();
  const endpoint = (input.endpoint ?? "").trim();
  const status = parseStatusCode(raw, input.statusCode ?? null);

  // ── 0. Already classified upstream ──────────────────────────────────────────
  // license_gap and consent_revoked are decided by graph.ts against documented
  // Microsoft signatures and are surfaced as their own executor statuses. Re-deriving
  // them from text here could only ever disagree with the authority, so defer.
  if (input.resultStatus === "license_gap") {
    return build("license_gap", {
      summary: "This tenant is not licensed for the data this check reads.",
      guidance:
        "Not a broken check and not an error — the tenant lacks the Microsoft 365 SKU or add-on. Nothing to fix on the endpoint.",
      evidence: ["executor status: license_gap"],
      statusCode: status,
      action: NO_ACTION,
    });
  }
  if (input.resultStatus === "consent_revoked") {
    return build("consent_revoked", {
      summary: "The tenant's consent is revoked, so no check can run against it.",
      guidance:
        "Nothing about this endpoint is at fault. The tenant has to re-consent before any check here returns data.",
      evidence: ["executor status: consent_revoked"],
      statusCode: status,
      action: NO_ACTION,
    });
  }

  if (!raw) {
    return build("unclassified", {
      summary: "This run failed without an error message to classify.",
      guidance: "There is no captured text to triage. Re-run the check to capture a real failure message.",
      evidence: [],
      statusCode: status,
      action: NO_ACTION,
    });
  }

  // ── 1. HTML body → WRONG ENDPOINT ───────────────────────────────────────────
  // FIRST, and structural rather than textual: Graph always answers in JSON, even
  // on failure. An HTML body means the request never reached Graph's API logic, so
  // every text signature below it would be matching against a web server's error
  // page, not a Graph error. Classifying on text after seeing HTML would be exactly
  // the confidently-wrong answer this module exists to avoid.
  if (looksLikeHtmlBody(raw)) {
    const serviceUnavailable = lower.includes("service unavailable") || status === 503;
    return build("wrong_endpoint", {
      summary: "Graph answered with an HTML page, not JSON — the request never reached Graph's API logic.",
      guidance:
        "Graph returns JSON even when it fails, so an HTML body is itself the diagnostic: this URL is not a live Graph API route " +
        (serviceUnavailable ? "(a front-end 'Service Unavailable' page was returned instead). " : "") +
        "Check the endpoint for a wrong host, a wrong API version, or a path that no longer routes.",
      evidence: [
        status != null ? `HTTP ${status}` : "no HTTP status in the message",
        "response body is HTML, not JSON",
        ...(serviceUnavailable ? ["body contains a 'Service Unavailable' page"] : []),
      ],
      statusCode: status,
      action: { kind: "edit_endpoint", label: "Edit endpoint", focusField: "endpoint" },
    });
  }

  // ── 2. Explicit withdrawal → DEAD API ───────────────────────────────────────
  // Requires Microsoft to SAY it is gone (or a 410 Gone). Being on /beta is NOT
  // sufficient on its own — a beta endpoint returning 403 is a permission problem,
  // not a dead API — so beta-ness is recorded as corroborating evidence only.
  // "Has no v1.0 equivalent" is not knowable from an error body and is never inferred.
  const deadPhrase = firstMatch(lower, DEAD_API_PHRASES);
  const isBetaEndpoint = /(^|\/)beta(\/|$)/i.test(endpoint) || /graph\.microsoft\.com\/beta/i.test(endpoint);
  if (deadPhrase || status === 410) {
    return build("dead_api", {
      summary: "Microsoft reports this API as withdrawn — a retirement candidate, not a fixable bug.",
      guidance:
        "Retiring the check archives it (reversible) rather than deleting it. If the workload still needs covering, a replacement endpoint is a new check, not an edit to this one." +
        (isBetaEndpoint ? " This endpoint is on /beta, which has no support commitment and can be withdrawn without a v1.0 successor." : ""),
      evidence: [
        ...(status != null ? [`HTTP ${status}`] : []),
        ...(deadPhrase ? [`message contains "${deadPhrase}"`] : []),
        ...(status === 410 ? ["HTTP 410 Gone"] : []),
        ...(isBetaEndpoint ? ["endpoint targets the /beta API surface"] : []),
      ],
      statusCode: status,
      action: { kind: "retire_check", label: "Retire this check" },
    });
  }

  // ── 3. Permission language → MISSING SCOPE ──────────────────────────────────
  // The named permission is the payoff: "permission error" costs an evening,
  // "SecurityEvents.Read.All" costs a minute.
  const scopePhrase = firstMatch(lower, SCOPE_PHRASES);
  const scopeCode = status === 401 || status === 403 ? firstMatch(lower, SCOPE_CODES) : null;
  // A bare 403 with no recognisable wording is still a permission verdict — 403 is
  // Graph's documented answer for an unauthorised caller. A bare 401 is NOT: graph.ts
  // already documents that Graph 401s for expired tokens, wrong audiences and beta
  // endpoints too, so a 401 alone stays unclassified rather than becoming a guess.
  const bareForbidden = status === 403;
  if (scopePhrase || scopeCode || bareForbidden) {
    const permissions = extractPermissionNames(raw);
    const declared = input.declaredScopes ?? [];
    const declaredLower = new Map(declared.map((s) => [s.toLowerCase(), s]));
    const alreadyDeclared = permissions
      .map((p) => declaredLower.get(p.toLowerCase()))
      .filter((p): p is string => p != null);

    return build("missing_scope", {
      summary: permissions.length
        ? `The app's token is missing a required permission: ${permissions.join(", ")}.`
        : "The app's token lacks a permission this endpoint requires — the message does not name which one.",
      guidance:
        (permissions.length
          ? "The permission above is the one Microsoft named in the real response. "
          : "Microsoft did not name the permission in this response, so the exact one has to be read off the endpoint's own documentation. ") +
        (alreadyDeclared.length
          ? `${alreadyDeclared.join(", ")} ${alreadyDeclared.length > 1 ? "are" : "is"} ALREADY declared on the multi-tenant app — so this is a re-consent problem for this tenant, not a missing declaration. `
          : "") +
        "Permissions are declared in REQUIRED_MT_SCOPES (artifacts/api-server/src/lib/graph.ts) and on the Azure App Registration manifest. " +
        "Nothing here adds one: every added permission forces re-consent on every connected tenant, so that stays a deliberate human decision.",
      evidence: [
        ...(status != null ? [`HTTP ${status}`] : []),
        ...(scopePhrase ? [`message contains "${scopePhrase}"`] : []),
        ...(scopeCode ? [`error code contains "${scopeCode}"`] : []),
        ...(!scopePhrase && !scopeCode && bareForbidden ? ["HTTP 403 with no named permission in the body"] : []),
      ],
      statusCode: status,
      permissions,
      alreadyDeclaredPermissions: alreadyDeclared,
      // DISPLAY ONLY, deliberately — see FailureActionKind.
      action: { kind: "show_permission", label: "Where this permission is declared" },
    });
  }

  // ── 4. Culture/locale slot → PARAMETER IN WRONG SLOT ────────────────────────
  const slotPhrase = firstMatch(lower, PARAMETER_SLOT_PHRASES);
  if (slotPhrase) {
    return build("parameter_slot", {
      summary: "A value landed in a parameter slot that expects something else (a locale/culture identifier).",
      guidance:
        "The request reached the API, but one argument is in the wrong position — a value meant for another parameter is being read as a culture identifier. Check the select params and the request body against the endpoint's real signature.",
      evidence: [
        ...(status != null ? [`HTTP ${status}`] : []),
        `message contains "${slotPhrase}"`,
      ],
      statusCode: status,
      action: { kind: "edit_endpoint", label: "Edit request parameters", focusField: "selectParams" },
    });
  }

  // ── 5. Download-token shape → WRONG API PATTERN ─────────────────────────────
  const patternPhrase = firstMatch(lower, WRONG_API_PATTERN_PHRASES);
  if (patternPhrase) {
    return build("wrong_api_pattern", {
      summary: "A download-oriented call is being used where a metadata/read call was intended.",
      guidance:
        "The endpoint exists, but this is the wrong call shape for what the check wants. A download endpoint issues a short-lived token and expects a follow-up fetch; a check that only needs values should be reading the metadata/report endpoint instead.",
      evidence: [
        ...(status != null ? [`HTTP ${status}`] : []),
        `message contains "${patternPhrase}"`,
      ],
      statusCode: status,
      action: { kind: "edit_endpoint", label: "Edit endpoint", focusField: "endpoint" },
    });
  }

  // ── 6. Malformed URL → BAD PATH ─────────────────────────────────────────────
  const pathPhrase = firstMatch(lower, BAD_PATH_PHRASES);
  const literalScheme = NON_HTTP_SCHEME_RE.exec(endpoint);
  // A placeholder is only evidence when it survived INTO the request. The stored
  // endpoint legitimately contains {id}/{NDaysAgo} tokens that the executor
  // resolves before sending, so the message is the authority here; the endpoint
  // only corroborates when the same literal braces come back in Graph's complaint.
  const placeholderInMessage = UNSUBSTITUTED_PLACEHOLDER_RE.test(raw);
  if (pathPhrase || literalScheme || placeholderInMessage) {
    const segment = /resource not found for the segment '([^']+)'/i.exec(raw)?.[1] ?? null;
    return build("bad_path", {
      summary: segment
        ? `Graph could not resolve the URL segment '${segment}'.`
        : "The request URL is malformed — Graph could not route it.",
      guidance:
        (literalScheme
          ? `The endpoint starts with "${literalScheme[1]}://", which is a platform routing scheme that must be intercepted before the request is issued — it is being sent to Graph literally. `
          : "") +
        (placeholderInMessage
          ? "A placeholder token reached Graph unsubstituted — the literal braces are in the URL Graph rejected. "
          : "") +
        "Fix the path on the endpoint itself; this is a URL problem, not a permission or licence problem.",
      evidence: [
        ...(status != null ? [`HTTP ${status}`] : []),
        ...(pathPhrase ? [`message contains "${pathPhrase}"`] : []),
        ...(segment ? [`unresolved segment: '${segment}'`] : []),
        ...(literalScheme ? [`endpoint uses a non-HTTP scheme: ${literalScheme[1]}://`] : []),
        ...(placeholderInMessage ? ["an unsubstituted {placeholder} appears in the rejected URL"] : []),
      ],
      statusCode: status,
      action: { kind: "edit_endpoint", label: "Edit endpoint", focusField: "endpoint" },
    });
  }

  // ── 7. Nothing matched ──────────────────────────────────────────────────────
  // Deliberately not a guess. A novel error shape gets the raw text and no verdict.
  return build("unclassified", {
    summary: "This failure does not match any known error signature.",
    guidance:
      "No category is being asserted, because asserting a wrong one would send you down the wrong path with false confidence. Read the raw message below — and if this shape turns out to be a real recurring bucket, it belongs in the signature table in monitor-failure-classifier.ts.",
    evidence: status != null ? [`HTTP ${status}`] : [],
    statusCode: status,
    action: NO_ACTION,
  });
}

// ── Run-shaped convenience wrapper ────────────────────────────────────────────

/**
 * Classifies a persisted run row, or returns null when there is nothing to triage.
 *
 * Returning null for a non-failed run matters: it is what stops a classification
 * banner from ever appearing over a green run.
 */
export function classifyRunFailure(
  run: {
    status: string;
    resultStatus?: string | null;
    errorMessage?: string | null;
    statusText?: string | null;
    requestEndpoint?: string | null;
  },
  declaredScopes: readonly string[] = [],
): FailureClassification | null {
  if (run.status !== "failed") return null;
  return classifyMonitorFailure({
    // statusText is the fallback because completeRun writes `${status}: ${message}`
    // there even in the paths where errorMessage was never set.
    errorMessage: run.errorMessage ?? run.statusText ?? null,
    resultStatus: run.resultStatus ?? null,
    endpoint: run.requestEndpoint ?? null,
    declaredScopes,
  });
}

// ── Batch aggregation ─────────────────────────────────────────────────────────

export interface ClassifiedFailure {
  checkKey: string;
  classification: FailureClassification;
}

export interface ClassificationGroup {
  category: FailureCategory;
  title: string;
  count: number;
  /** The real checks in this bucket, so the group is actionable per-check. */
  checkKeys: string[];
  /** Distinct permissions named across the whole group. */
  permissions: string[];
  /** Of those, the ones already declared on the app (a re-consent case, not a manifest gap). */
  alreadyDeclaredPermissions: string[];
  /** The action shared by every member of the group. */
  actionKind: FailureActionKind;
  /** One representative guidance line — identical for every member of a category. */
  guidance: string;
}

export interface BatchTriage {
  totalFailures: number;
  classifiedCount: number;
  unclassifiedCount: number;
  groups: ClassificationGroup[];
  /** Every distinct permission named anywhere in the batch — the short real list. */
  permissionsNeeded: string[];
  /** Of those, the ones already declared on the app. */
  permissionsAlreadyDeclared: string[];
}

/**
 * Turns N individual failures into a short, real, actionable list.
 *
 * This is where the time saving compounds: forty failed checks are not forty
 * investigations if six of them are one missing permission. Groups are ordered by
 * size (largest bucket first — the biggest single win), with the declared category
 * order as a deterministic tie-break so the same batch always renders the same way.
 */
export function aggregateFailureClassifications(failures: ClassifiedFailure[]): BatchTriage {
  const byCategory = new Map<FailureCategory, ClassificationGroup>();
  const allPermissions: string[] = [];
  const allDeclared: string[] = [];

  const pushDistinct = (target: string[], values: string[]) => {
    for (const v of values) if (!target.some((t) => t.toLowerCase() === v.toLowerCase())) target.push(v);
  };

  for (const { checkKey, classification } of failures) {
    let group = byCategory.get(classification.category);
    if (!group) {
      group = {
        category: classification.category,
        title: classification.title,
        count: 0,
        checkKeys: [],
        permissions: [],
        alreadyDeclaredPermissions: [],
        actionKind: classification.action.kind,
        guidance: classification.guidance,
      };
      byCategory.set(classification.category, group);
    }
    group.count += 1;
    if (!group.checkKeys.includes(checkKey)) group.checkKeys.push(checkKey);
    pushDistinct(group.permissions, classification.permissions);
    pushDistinct(group.alreadyDeclaredPermissions, classification.alreadyDeclaredPermissions);
    pushDistinct(allPermissions, classification.permissions);
    pushDistinct(allDeclared, classification.alreadyDeclaredPermissions);
  }

  const groups = [...byCategory.values()].sort(
    (a, b) => b.count - a.count || CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category],
  );

  const unclassifiedCount = byCategory.get("unclassified")?.count ?? 0;

  return {
    totalFailures: failures.length,
    classifiedCount: failures.length - unclassifiedCount,
    unclassifiedCount,
    groups,
    permissionsNeeded: allPermissions,
    permissionsAlreadyDeclared: allDeclared,
  };
}
