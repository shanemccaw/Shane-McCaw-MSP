import { logger } from "./logger";

const log = logger.child({ channel: "integration.azure" });

// ─────────────────────────────────────────────────────────────────────────────
// Azure Resource Manager — app-only READ transport (#1871, answering #1849)
//
// This module is the connection/auth layer for Azure Resource Manager, the fifth
// `MONITOR_CHECK_EXECUTOR_TYPES` transport. It exists because 22 modelled
// configuration resources (`config_resources.read_transport = 'azure-rm'`) have
// no Graph and no PowerShell read path at all; Microsoft365DSC reads them with
// `Invoke-AzRestMethod` against `(Get-MSCloudLoginConnectionProfile -Workload
// Azure).ManagementUrl`, i.e. plain ARM REST at https://management.azure.com.
//
// ── THE THING THAT MAKES THIS TRANSPORT DIFFERENT (do not "simplify" it away) ──
//
// Graph and ARM are separate control planes with separate token audiences, and
// **Microsoft Entra permissions confer nothing on ARM**. A service principal
// admin-consented to every Graph application permission Microsoft publishes, and
// holding the Global Reader directory role (#1483), has *zero* Azure access.
// Authorization on ARM comes only from Azure RBAC role assignments, and those are
// scoped to a management group, a subscription or a resource group — never to
// "the tenant".
//
// This is not a theoretical distinction. Verified live against the testbed tenant
// c4c814d4-…-62461d0a4fd3 on 2026-08-30, with two different app registrations:
//
//   - The platform multi-tenant app (MT_APP_CLIENT_ID) acquired a perfectly valid
//     ARM token for that tenant — HTTP 200, `aud: https://management.azure.com` —
//     and then `GET /subscriptions` returned 200 with `{"value":[],"count":0}`.
//     Valid token, zero reach.
//   - A different single-tenant app holding three resource-scoped Azure role
//     assignments in that same tenant saw the tenant's one real subscription.
//
// Same tenant, same moment, same consent state, opposite answers. An executor
// that assumed tenant-level auth implies Azure access would look correct on a
// tenant where somebody had happened to make a role assignment and would silently
// read nothing everywhere else. Hence the reach probe below, which is run BEFORE
// any operation and whose result is a first-class persisted state, not an error.
//
// ── Onboarding: how a customer's Azure would actually become readable ──────────
//
// Azure Lighthouse (delegated resource management) is the mechanism Microsoft
// designed for this MSP relationship. The customer deploys an ARM template that
// grants named principals in the managing tenant named BUILT-IN roles at named
// scopes; the customer can revoke it; the managing tenant never needs
// `Microsoft.Authorization/roleAssignments/write` in the customer's directory.
// Per Microsoft's published documentation, the onboarding scope is a
// SUBSCRIPTION, or one or more RESOURCE GROUPS within a subscription — a
// management group cannot be delegated, and neither can a billing account. All
// built-in roles are supported except Owner, roles carrying `DataActions`, and
// roles carrying `Microsoft.Authorization/*` writes; custom roles are not
// supported at all. `Reader` is supported and is the least-privilege role for
// read-only configuration extraction.
//
// Consequence, stated plainly because it decides what this transport can ever
// reach: the billing-scoped resources (`AzureBillingAccountPolicy` and siblings,
// which M365DSC reads at `/providers/Microsoft.Billing/billingAccounts/…`) and
// the tenant-root `microsoft.aadiam` diagnostic settings live ABOVE any
// delegable scope, so Lighthouse cannot make them readable. They need a role the
// customer assigns directly at the billing account / root scope. See #1871.
// ─────────────────────────────────────────────────────────────────────────────

/** ARM's public-cloud endpoint. Gov/GCC clouds are explicitly out of scope. */
export const ARM_BASE_URL = "https://management.azure.com";

/** The `.default` scope for the ARM audience — NOT a Microsoft Graph scope. */
export const ARM_SCOPE = "https://management.azure.com/.default";

/**
 * The least-privilege Azure built-in role for read-only configuration
 * extraction, and the one to name in a Lighthouse authorization. Declared here
 * so the requirement is discoverable in code rather than only in prose, the same
 * way sharepoint-admin.ts declares REQUIRED_SHAREPOINT_APP_PERMISSIONS.
 *
 * `Reader` covers every subscription-scoped operation in AZURE_RM_OPERATIONS.
 * The two roles Microsoft365DSC additionally names for specific resource
 * families are recorded next to them, not merged into one blanket ask.
 */
export const AZURE_RM_LEAST_PRIVILEGE_ROLE = "Reader";

/** Built-in role definition GUIDs, for building a Lighthouse authorization. */
export const AZURE_BUILT_IN_ROLE_IDS = {
  /** Reader — read everything, change nothing. Supported by Azure Lighthouse. */
  Reader: "acdd72a7-3385-48ef-bd42-f606fba81ae7",
} as const;

// ── Errors ────────────────────────────────────────────────────────────────────

/**
 * Raised when an ARM token cannot be acquired for a tenant at all. Deliberately
 * its OWN error type and NOT graph.ts's ConsentRevokedError: an ARM token failure
 * says nothing about Graph consent, and must never be allowed to flip a tenant's
 * Graph consent state — the same rule sharepoint-admin.ts's SharePointAuthError
 * follows.
 */
export class AzureRmAuthError extends Error {
  // Declared as a plain field rather than a constructor parameter property:
  // parts of this repo run TypeScript under Node's strip-only mode
  // (`node --experimental-strip-types`), which rejects parameter properties
  // outright with ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX.
  httpStatus?: number;

  constructor(message: string, httpStatus?: number) {
    super(message);
    this.name = "AzureRmAuthError";
    this.httpStatus = httpStatus;
  }
}

// ── Token acquisition ─────────────────────────────────────────────────────────

interface CachedToken { token: string; expiresAt: number; objectId: string | null; clientId: string }
const tenantArmTokenCache = new Map<string, CachedToken>();

/**
 * Which app registration is the platform's ARM principal.
 *
 * Defaults to the multi-tenant app every customer already consents to, because
 * that is the principal a customer can name in a Lighthouse authorization or a
 * direct role assignment. `AZURE_RM_CLIENT_ID`/`AZURE_RM_CLIENT_SECRET` override
 * it when the deployment gives ARM its own registration.
 *
 * Stated explicitly rather than left to be discovered: if the override names a
 * SINGLE-tenant app, it can only ever acquire a token in its own home tenant, so
 * every other tenant probes as `unreachable`. That is reported honestly by the
 * reach probe; it is not silently hidden. Whichever principal is in use is
 * recorded on every persisted reach row, because reach is a property of the
 * principal, not of the tenant.
 */
export function armPrincipalCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.AZURE_RM_CLIENT_ID || process.env.MT_APP_CLIENT_ID;
  const clientSecret = process.env.AZURE_RM_CLIENT_SECRET || process.env.MT_APP_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function armCredentialsPresent(): boolean {
  return armPrincipalCredentials() !== null;
}

/** The `oid` (service principal object id) claim, read without verifying the signature — it is our own token, used only for logging and for building a roleAssignments filter. */
function objectIdFromToken(accessToken: string): string | null {
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return null;
    const claims = JSON.parse(Buffer.from(payload, "base64").toString("utf8")) as { oid?: string };
    return typeof claims.oid === "string" ? claims.oid : null;
  } catch {
    return null;
  }
}

/**
 * Acquire an app-only ARM token for a tenant. Throws AzureRmAuthError on any
 * failure — the caller turns that into the `unreachable` reach state rather than
 * letting it surface as a generic check error.
 */
export async function getArmAccessTokenForTenant(tenantId: string): Promise<{ token: string; objectId: string | null; clientId: string }> {
  const cached = tenantArmTokenCache.get(tenantId);
  if (cached && Date.now() < cached.expiresAt - 60_000) {
    return { token: cached.token, objectId: cached.objectId, clientId: cached.clientId };
  }

  const creds = armPrincipalCredentials();
  if (!creds) {
    throw new AzureRmAuthError(
      "no ARM principal configured — set AZURE_RM_CLIENT_ID/AZURE_RM_CLIENT_SECRET, or MT_APP_CLIENT_ID/MT_APP_CLIENT_SECRET",
    );
  }

  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      scope: ARM_SCOPE,
    }).toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new AzureRmAuthError(`ARM token request failed: ${res.status} ${text.slice(0, 500)}`, res.status);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  const objectId = objectIdFromToken(data.access_token);
  tenantArmTokenCache.set(tenantId, {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    objectId,
    clientId: creds.clientId,
  });
  return { token: data.access_token, objectId, clientId: creds.clientId };
}

/** Test seam only — drops the per-tenant ARM token cache. */
export function __clearArmTokenCache(): void {
  tenantArmTokenCache.clear();
}

// ── ARM GET ───────────────────────────────────────────────────────────────────

export interface ArmResponse {
  status: number;
  /** Parsed JSON body when the response was JSON; the raw text otherwise. */
  body: unknown;
  ok: boolean;
}

/**
 * One ARM GET. READ-ONLY BY CONSTRUCTION: this module exposes no other verb, so
 * nothing built on it can create, modify or delete an ARM resource.
 *
 * The explicit `Accept-Language` is not cosmetic and must not be removed. Node's
 * global fetch (undici) injects `accept-language: *` when the caller sets none,
 * and ARM's PIM surface rejects that literal asterisk with
 * `CultureNotFoundException: '*' is an invalid culture identifier` — the exact
 * failure #393/#488 diagnosed on the Graph side and fixed the same way in
 * graph.ts. Confirmed live on ARM on 2026-08-30: without the header,
 * `…/providers/Microsoft.Authorization/roleManagementPolicyAssignments` returns
 * 400 CultureNotFoundException; with it, the same call returns the real answer
 * (400 `TenantNotOnboarded` — "The tenant has not onboarded to PIM").
 */
export async function armGet(accessToken: string, path: string): Promise<ArmResponse> {
  const url = path.startsWith("http") ? path : `${ARM_BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Accept-Language": "en-US",
    },
  });
  const text = await res.text();
  let body: unknown = text;
  try { body = text ? JSON.parse(text) : null; } catch { /* keep raw text */ }
  return { status: res.status, body, ok: res.ok };
}

/**
 * An ARM collection GET, following `nextLink` to completion. Returns the real
 * HTTP status of the FIRST page alongside the items, because the status is what
 * distinguishes "readable and empty" from "not authorized" — and those two must
 * never be conflated.
 */
export async function armGetAll(accessToken: string, path: string, maxPages = 50): Promise<{ status: number; items: Record<string, unknown>[]; error: unknown | null }> {
  const items: Record<string, unknown>[] = [];
  let next: string | null = path;
  let firstStatus = 0;
  let pages = 0;

  while (next && pages < maxPages) {
    const res: ArmResponse = await armGet(accessToken, next);
    if (pages === 0) firstStatus = res.status;
    if (!res.ok) return { status: res.status, items, error: res.body };
    const body = res.body as { value?: unknown[]; nextLink?: string } | null;
    for (const v of body?.value ?? []) {
      if (v && typeof v === "object") items.push(v as Record<string, unknown>);
    }
    next = typeof body?.nextLink === "string" ? body.nextLink : null;
    pages += 1;
  }

  return { status: firstStatus, items, error: null };
}

// ── Reach probe ───────────────────────────────────────────────────────────────

export interface AzureRmSubscriptionRef {
  subscriptionId: string;
  displayName: string | null;
  state: string | null;
  tenantId: string | null;
  managedByTenantIds: string[];
}

export type AzureRmReachState = "ok" | "no_rbac" | "no_subscriptions" | "unreachable";

export interface AzureRmReach {
  state: AzureRmReachState;
  tokenAcquired: boolean;
  subscriptionsHttpStatus: number | null;
  managementGroupsHttpStatus: number | null;
  subscriptions: AzureRmSubscriptionRef[];
  principalClientId: string | null;
  principalObjectId: string | null;
  errorMessage: string | null;
}

function toSubscriptionRef(raw: Record<string, unknown>): AzureRmSubscriptionRef | null {
  const subscriptionId = typeof raw.subscriptionId === "string" ? raw.subscriptionId : null;
  if (!subscriptionId) return null;
  const managedBy = Array.isArray(raw.managedByTenants) ? raw.managedByTenants : [];
  return {
    subscriptionId,
    displayName: typeof raw.displayName === "string" ? raw.displayName : null,
    state: typeof raw.state === "string" ? raw.state : null,
    tenantId: typeof raw.tenantId === "string" ? raw.tenantId : null,
    managedByTenantIds: managedBy
      .map((m) => (m && typeof m === "object" ? (m as { tenantId?: unknown }).tenantId : null))
      .filter((t): t is string => typeof t === "string"),
  };
}

/**
 * What Azure this platform's ARM principal can actually see in a tenant.
 *
 * The whole point is that an empty `GET /subscriptions` is AMBIGUOUS, because
 * that listing is RBAC-filtered: a tenant with fifty subscriptions and no grant
 * to us returns exactly the same `{"value":[]}` as a tenant that has no Azure at
 * all. Reporting either one as the other would be inventing a fact.
 *
 * The one signal that disambiguates it is whether we hold a read ABOVE the
 * subscription level. `GET /providers/Microsoft.Management/managementGroups`
 * succeeds only for a principal with a management-group-scoped (or root-scoped)
 * role, and such a role covers every subscription in the tenant — so an empty
 * listing corroborated by a 200 there IS conclusive. A 403 there (the normal
 * answer for a principal holding only subscription- or resource-group-scoped
 * roles, including everything Azure Lighthouse can delegate) leaves the empty
 * listing inconclusive, and we say so instead of guessing.
 *
 * Never throws: every outcome, including total failure, is one of the four states.
 */
export async function probeAzureRmReach(tenantId: string): Promise<AzureRmReach> {
  const base: AzureRmReach = {
    state: "unreachable",
    tokenAcquired: false,
    subscriptionsHttpStatus: null,
    managementGroupsHttpStatus: null,
    subscriptions: [],
    principalClientId: armPrincipalCredentials()?.clientId ?? null,
    principalObjectId: null,
    errorMessage: null,
  };

  let token: string;
  try {
    const acquired = await getArmAccessTokenForTenant(tenantId);
    token = acquired.token;
    base.tokenAcquired = true;
    base.principalObjectId = acquired.objectId;
    base.principalClientId = acquired.clientId;
  } catch (err) {
    base.errorMessage = err instanceof Error ? err.message : String(err);
    log.warn({ tenantId, err: base.errorMessage }, "azure-rm: ARM token could not be acquired for tenant");
    return base;
  }

  const subs = await armGetAll(token, "/subscriptions?api-version=2022-12-01");
  base.subscriptionsHttpStatus = subs.status;

  if (subs.error !== null) {
    base.errorMessage = `GET /subscriptions returned ${subs.status}: ${JSON.stringify(subs.error).slice(0, 500)}`;
    log.warn({ tenantId, status: subs.status }, "azure-rm: subscription listing failed");
    return base;
  }

  base.subscriptions = subs.items
    .map(toSubscriptionRef)
    .filter((s): s is AzureRmSubscriptionRef => s !== null);

  if (base.subscriptions.length > 0) {
    base.state = "ok";
    log.info(
      { tenantId, subscriptionCount: base.subscriptions.length, principalClientId: base.principalClientId },
      "azure-rm: reach probe found subscriptions",
    );
    return base;
  }

  // Empty listing. Only a readable scope above the subscription level can make
  // that conclusive.
  const mg = await armGet(token, "/providers/Microsoft.Management/managementGroups?api-version=2021-04-01");
  base.managementGroupsHttpStatus = mg.status;
  base.state = mg.ok ? "no_subscriptions" : "no_rbac";

  log.info(
    { tenantId, state: base.state, managementGroupsHttpStatus: mg.status, principalClientId: base.principalClientId },
    base.state === "no_subscriptions"
      ? "azure-rm: tenant has no Azure subscriptions (corroborated by a readable management-group scope)"
      : "azure-rm: no Azure RBAC in this tenant — the empty subscription listing says nothing about whether the tenant has Azure",
  );
  return base;
}

// ── Code-owned operation registry ─────────────────────────────────────────────

/**
 * A per-scope HTTP outcome, recorded rather than thrown. A 403 on one
 * subscription is a real fact about coverage, not a reason to fail the whole
 * check and lose the subscriptions that DID answer.
 */
export interface AzureRmScopeOutcome {
  scope: string;
  httpStatus: number;
  ok: boolean;
  /** ARM's own error code (e.g. "AuthorizationFailed"), when it returned one. */
  errorCode: string | null;
}

export interface AzureRmContext {
  tenantId: string;
  accessToken: string;
  reach: AzureRmReach;
  /** Appended to by operations as they go; surfaced on the check result verbatim. */
  scopeOutcomes: AzureRmScopeOutcome[];
}

function errorCodeOf(body: unknown): string | null {
  if (body && typeof body === "object") {
    const err = (body as { error?: { code?: unknown } }).error;
    if (err && typeof err === "object" && typeof err.code === "string") return err.code;
    const flat = (body as { ErrorCode?: unknown }).ErrorCode;
    if (typeof flat === "string") return flat;
  }
  return null;
}

/** One collection GET at one scope, recording the outcome instead of throwing. */
async function collect(ctx: AzureRmContext, scope: string, path: string): Promise<Record<string, unknown>[]> {
  const res = await armGetAll(ctx.accessToken, path);
  ctx.scopeOutcomes.push({
    scope,
    httpStatus: res.status,
    ok: res.error === null,
    errorCode: res.error === null ? null : errorCodeOf(res.error),
  });
  return res.error === null ? res.items : [];
}

/** Runs one collection GET per readable subscription, tagging each item with the subscription it came from. */
async function collectPerSubscription(
  ctx: AzureRmContext,
  pathFor: (subscriptionId: string) => string,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (const sub of ctx.reach.subscriptions) {
    const items = await collect(ctx, `/subscriptions/${sub.subscriptionId}`, pathFor(sub.subscriptionId));
    for (const item of items) {
      out.push({ ...item, _subscriptionId: sub.subscriptionId, _subscriptionName: sub.displayName });
    }
  }
  return out;
}

/**
 * A code-owned ARM operation: receives the resolved context and returns items in
 * the same shape the Graph path produces, so applyMapping and everything after
 * it runs unmodified.
 */
export type AzureRmOperation = (ctx: AzureRmContext) => Promise<Record<string, unknown>[]>;

/**
 * The code-owned operation registry. `monitor_checks.arm_operation` stores a KEY
 * into this table and nothing else — never a URL, never a script — the same
 * contract `ps_cmdlet_key` and `sp_operation` already follow. An unknown key is a
 * hard error at execution time, not a silent no-op.
 *
 * Every entry is a single documented ARM GET, and every one of them has been
 * issued live against a real Azure tenant (2026-08-30) rather than transcribed
 * from documentation. The `read_transport = 'azure-rm'` resource family each one
 * serves is named, along with the Azure RBAC role Microsoft365DSC declares for
 * it, and — where it matters — whether Azure Lighthouse can delegate the scope at
 * all.
 */
export const AZURE_RM_OPERATIONS: Record<string, AzureRmOperation> = {
  /**
   * The tenant's Azure subscriptions, exactly as ARM returned them. Serves
   * `AzureSubscription` at the subscription level and is the ground truth every
   * other operation is scoped by. Role: Reader (the listing is RBAC-filtered).
   */
  "list-subscriptions": async (ctx) => ctx.reach.subscriptions.map((s) => ({
    subscriptionId: s.subscriptionId,
    displayName: s.displayName,
    state: s.state,
    tenantId: s.tenantId,
    managedByTenantIds: s.managedByTenantIds,
    // Non-empty managedByTenantIds means the subscription is delegated to a
    // managing tenant through Azure Lighthouse — the onboarding path for this
    // transport, so worth carrying as a first-class field.
    isLighthouseDelegated: s.managedByTenantIds.length > 0,
  })),

  /**
   * Custom Azure role definitions per subscription. Serves `AzureRoleDefinition`.
   * Role: Reader. Filtered to CustomRole because the ~800 built-ins are identical
   * in every tenant and carry no per-tenant configuration signal.
   */
  "list-custom-role-definitions": async (ctx) => collectPerSubscription(ctx, (sub) =>
    `/subscriptions/${sub}/providers/Microsoft.Authorization/roleDefinitions` +
    `?api-version=2022-04-01&$filter=${encodeURIComponent("type eq 'CustomRole'")}`),

  /**
   * Microsoft Defender for Cloud plan/pricing tier per subscription. Serves
   * `DefenderSubscriptionPlan`. Roles per Microsoft365DSC: Security Reader (read)
   * / Security Admin. A subscription that has never enabled Defender for Cloud
   * answers 404 `Subscription Not Registered` — recorded as a scope outcome, not
   * silently treated as "no plans".
   */
  "list-defender-subscription-plans": async (ctx) => collectPerSubscription(ctx, (sub) =>
    `/subscriptions/${sub}/providers/Microsoft.Security/pricings?api-version=2024-01-01`),

  /**
   * Log Analytics workspaces per subscription — the container every Microsoft
   * Sentinel resource hangs off. Serves as the precondition for the four Sentinel
   * resources (`SentinelSetting`, `SentinelAlertRule`, `SentinelWatchlist`,
   * `SentinelThreatIntelligenceIndicator`), which Microsoft365DSC reaches with
   * Microsoft Sentinel Reader/Contributor at workspace scope. Zero workspaces is
   * a real answer: the tenant runs no Sentinel.
   */
  "list-sentinel-workspaces": async (ctx) => collectPerSubscription(ctx, (sub) =>
    `/subscriptions/${sub}/providers/Microsoft.OperationalInsights/workspaces?api-version=2022-10-01`),

  /**
   * Billing accounts visible to the principal. Serves the billing family
   * (`AzureBillingAccountPolicy`, `AzureBillingAccountsAssociatedTenant`,
   * `AzureBillingAccountScheduledAction`, `AzureBillingaccountsRoleAssignment`).
   * Role per Microsoft365DSC: Billing Reader, assigned at the BILLING ACCOUNT
   * scope — which is above any scope Azure Lighthouse can delegate, so this
   * family cannot be onboarded the Lighthouse way. The listing is filtered by
   * that separate billing RBAC, so an empty result means no billing account is
   * readable, not that none exists.
   */
  "list-billing-accounts": async (ctx) => collect(ctx, "/providers/Microsoft.Billing",
    "/providers/Microsoft.Billing/billingAccounts?api-version=2020-05-01"),

  /**
   * Microsoft Entra ID diagnostic settings. Serves `AzureDiagnosticSettings` and
   * `IntuneDiagnosticSettings`. This is a TENANT-ROOT ARM scope
   * (`/providers/microsoft.aadiam`), not a subscription scope: it is unreachable
   * for a principal holding only subscription-scoped roles, and Azure Lighthouse
   * cannot delegate it. Verified live: 403 AuthorizationFailed on
   * `microsoft.aadiam/diagnosticSettings/read` for a principal that could read
   * that same tenant's subscription fine.
   */
  "list-entra-diagnostic-settings": async (ctx) => collect(ctx, "/providers/microsoft.aadiam",
    "/providers/microsoft.aadiam/diagnosticSettings?api-version=2017-04-01-preview"),

  /**
   * Azure-resource PIM policy assignments per subscription. Serves
   * `AzureRoleEligibilityScheduleSettings` (and is the scope the
   * `AzureRoleAssignmentScheduleRequest` / `AzureRoleEligibilityScheduleRequest`
   * resources operate under). Role: Reader. A tenant that has never enabled PIM
   * for Azure resources answers 400 `TenantNotOnboarded`, which is a real state
   * and is recorded as such.
   */
  "list-role-management-policy-assignments": async (ctx) => collectPerSubscription(ctx, (sub) =>
    `/subscriptions/${sub}/providers/Microsoft.Authorization/roleManagementPolicyAssignments?api-version=2020-10-01`),

  /**
   * Azure Lighthouse delegations on each visible subscription. Not one of the 22
   * modelled resources — it is how this platform can see its OWN delegated
   * access, which is the onboarding artifact for every other operation here.
   */
  "list-lighthouse-delegations": async (ctx) => collectPerSubscription(ctx, (sub) =>
    `/subscriptions/${sub}/providers/Microsoft.ManagedServices/registrationAssignments?api-version=2022-10-01`),
};

export function resolveAzureRmOperation(key: string | null | undefined): AzureRmOperation {
  const operation = key ? AZURE_RM_OPERATIONS[key] : undefined;
  if (!operation) {
    throw new Error(
      `monitor check declares arm_operation "${key ?? "(null)"}", which is not in the code-owned registry ` +
      `(${Object.keys(AZURE_RM_OPERATIONS).join(", ") || "empty"})`,
    );
  }
  return operation;
}
