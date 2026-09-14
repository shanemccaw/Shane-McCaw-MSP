/**
 * exchange-online-transport.ts — #3948
 *
 * Pure mapping layer for the workflow engine's SECOND execution transport:
 * `baseline_action_templates` rows whose `endpoint` is an
 * `exchange-online://<Cmdlet>` pseudo-URI execute through the ps-execution
 * container (ps-execution-client.ts / Connect-ExchangeOnline app-only
 * session), not through Microsoft Graph. Before #3948,
 * runBaselineTemplateAgainstTenant() sent these endpoints to
 * graphWriteForTenant() verbatim, which built a malformed Graph URL.
 *
 * Deliberately dependency-free (no db, no ps-execution-client import) so it
 * is unit-testable with no module graph — same discipline as
 * resolve-then-write.ts / mfa-reregistration.ts. The tenant-bound execution
 * wrapper lives in workflow-executor.ts.
 *
 * Success/failure evaluation (the issue's third design question): a
 * PowerShell execution has no Graph HTTP status to compare against
 * `success_criteria.expectStatus`. The real success signal is the
 * container's own contract — the child process invokes the resolved cmdlet
 * with -ErrorAction defaults, a throwing cmdlet becomes a non-200 container
 * response, and callPsExecution() surfaces every non-200 as a thrown
 * PsExecutionError. So: callPsExecution resolving WITHOUT throwing IS
 * success, and the 200 the container genuinely returned is reported as
 * `status` — which keeps the stored `{"expectStatus": 200}` rows honest
 * without inventing a fake Graph status. Failures map the PsExecutionError
 * `kind` onto the existing BaselineTemplateExecutionResult errorType union
 * via classifyPsExecutionFailure() below.
 */

export const EXCHANGE_ONLINE_SCHEME = "exchange-online://";

export function isExchangeOnlineEndpoint(endpoint: string): boolean {
  return endpoint.toLowerCase().startsWith(EXCHANGE_ONLINE_SCHEME);
}

/**
 * Cmdlet → container cmdletKey map. Explicit and code-owned on BOTH sides on
 * purpose: the container resolves cmdletKey against its own fixed
 * $script:CmdletCatalog (services/ps-execution/cmdlet-catalog.ps1 — the #209
 * security boundary), and this client-side map mirrors exactly the write
 * entries #3948 added there, so an endpoint naming any other cmdlet fails
 * closed HERE with a precise error instead of a container 400. Keys are the
 * cmdlet's own name kebab-cased, the catalog's mechanical naming convention.
 *
 * `New-TransportRule` (action.set-mail-flow-rule) is DELIBERATELY absent:
 * that template's body names a "Condition" parameter New-TransportRule does
 * not have, and because the container silently drops params outside an
 * entry's AllowedParams, allowlisting it would fire `New-TransportRule
 * -Name X -SetSCL n` with no condition at all — an org-wide SCL rule
 * applying to ALL mail. Excluded until the template row is redesigned with
 * the cmdlet's real condition predicates (filed as its own finding).
 */
export const EXCHANGE_ONLINE_CMDLET_KEYS: Record<string, string> = {
  "Set-Mailbox": "set-mailbox",
  "New-Mailbox": "new-mailbox",
  "New-DistributionGroup": "new-distribution-group",
  "Add-MailboxPermission": "add-mailbox-permission",
  "Add-RecipientPermission": "add-recipient-permission",
  "Enable-Mailbox": "enable-mailbox",
};

export interface ParsedExchangeOnlineEndpoint {
  cmdlet: string;
  cmdletKey: string;
}

/**
 * Parse `exchange-online://<Cmdlet>` into the cmdlet name and its container
 * cmdletKey. Returns an error string (never throws) for a malformed endpoint
 * or a cmdlet with no allowlisted key — both are defects in the template
 * definition, and the caller reports them as bad_request WITHOUT firing
 * anything.
 */
export function parseExchangeOnlineEndpoint(
  endpoint: string,
): { ok: true; parsed: ParsedExchangeOnlineEndpoint } | { ok: false; error: string } {
  if (!isExchangeOnlineEndpoint(endpoint)) {
    return { ok: false, error: `endpoint '${endpoint}' does not use the ${EXCHANGE_ONLINE_SCHEME} scheme` };
  }
  const cmdlet = endpoint.slice(EXCHANGE_ONLINE_SCHEME.length).replace(/\/+$/, "").trim();
  if (!cmdlet) {
    return { ok: false, error: `endpoint '${endpoint}' names no cmdlet after the scheme` };
  }
  const cmdletKey = EXCHANGE_ONLINE_CMDLET_KEYS[cmdlet];
  if (!cmdletKey) {
    return {
      ok: false,
      error:
        `cmdlet '${cmdlet}' has no allowlisted ps-execution cmdletKey — ` +
        `supported: ${Object.keys(EXCHANGE_ONLINE_CMDLET_KEYS).join(", ")}`,
    };
  }
  return { ok: true, parsed: { cmdlet, cmdletKey } };
}

/**
 * Reserved connection-identity fields the container consumes itself and
 * never forwards to the cmdlet (entrypoint.ps1 / Resolve-CmdletInvocation).
 * A template body naming either is a defect — fail closed rather than let a
 * body value silently steer which tenant the session connects to.
 */
const RESERVED_PARAM_NAMES = new Set(["organization", "tenantid"]);

/**
 * Map a resolved template `body` (the second design question: the Graph path
 * assumes a JSON request body; a cmdlet takes named parameters) onto the
 * `params` hashtable callPsExecution() sends.
 *
 * - Keys pass through as-is: the 13 templates' body keys ARE the cmdlets'
 *   real parameter names (Identity, PrimarySmtpAddress, AccessRights, ...).
 * - `null` passes through: JSON null becomes PowerShell $null, which is the
 *   real "clear this setting" value (action.remove-forwarding-rule sets
 *   ForwardingSmtpAddress: null on purpose).
 * - The exact strings "true"/"false" (case-insensitive) coerce to booleans:
 *   {{var}} interpolation is string-typed (interp() substitutes into a JSON
 *   string), but PowerShell boolean/switch parameters cannot bind from the
 *   string "true" — Set-Mailbox -LitigationHoldEnabled "true" is a binding
 *   error, $true is not. Literal (non-interpolated) JSON booleans arrive as
 *   real booleans already and are untouched.
 * - `Organization` is set LAST from the tenant's own resolved domain and can
 *   never come from the body.
 */
export function buildPsExecutionParams(
  body: Record<string, unknown>,
  organization: string,
): { ok: true; params: Record<string, unknown> } | { ok: false; error: string } {
  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (RESERVED_PARAM_NAMES.has(key.toLowerCase())) {
      return {
        ok: false,
        error: `body parameter '${key}' is a reserved ps-execution connection field and cannot be set by a template`,
      };
    }
    if (typeof value === "string" && (value.toLowerCase() === "true" || value.toLowerCase() === "false")) {
      params[key] = value.toLowerCase() === "true";
    } else {
      params[key] = value;
    }
  }
  params.Organization = organization;
  return { ok: true, params };
}

/**
 * Structural view of PsExecutionError — kept structural (not an instanceof
 * import) so this module stays dependency-free and the classification is
 * unit-testable without the client's azure-keyvault module graph.
 */
export interface PsExecutionFailureLike {
  kind: "unreachable" | "auth_failed" | "script_error" | "cmdlet_unavailable";
  message: string;
  containerErrorKind?: string;
}

export interface ClassifiedPsFailure {
  errorType: "insufficient_privilege" | "bad_request" | "unexpected";
  /** Best-effort HTTP-shaped status for the result envelope/audit row. */
  status: number;
}

/**
 * Map a PsExecutionError kind onto BaselineTemplateExecutionResult's
 * existing errorType union (switchChosenHandle routes workflow edges by
 * these exact slugs — no new value is introduced):
 *
 * - auth_failed          → insufficient_privilege (the app-only session/cert
 *                          was rejected — our side lacks access, nothing
 *                          about the request body was wrong)
 * - cmdlet_unavailable   → insufficient_privilege (per #250 this means the
 *                          cmdlet was never registered into this tenant's
 *                          session: Exchange.ManageAsApp / RBAC role OR
 *                          licensing — the container cannot tell which, so
 *                          this deliberately does NOT map to license_gap,
 *                          which asserts a specific missing license)
 * - script_error         → bad_request (the client's own contract groups
 *                          container 400s and cmdlet throws as "defects in
 *                          the check definition itself" — for a write that
 *                          means the template/inputs, e.g. a nonexistent
 *                          Identity)
 * - unreachable          → unexpected, status 0 (no HTTP exchange happened)
 */
export function classifyPsExecutionFailure(err: PsExecutionFailureLike): ClassifiedPsFailure {
  switch (err.kind) {
    case "auth_failed":
      return { errorType: "insufficient_privilege", status: 502 };
    case "cmdlet_unavailable":
      return { errorType: "insufficient_privilege", status: 500 };
    case "script_error":
      return { errorType: "bad_request", status: 400 };
    case "unreachable":
    default:
      return { errorType: "unexpected", status: 0 };
  }
}
