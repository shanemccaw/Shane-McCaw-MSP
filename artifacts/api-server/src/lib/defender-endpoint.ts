import { logger } from "./logger";

const log = logger.child({ channel: "integration.defender" });

// ── Microsoft Defender for Endpoint — device response actions (write) ───────────
//
// This is a THIRD Microsoft resource audience layered onto the SAME multi-tenant
// App Registration already used for Microsoft Graph (graph.ts) and the O365
// Management Activity API (graph.ts `getActivityApiToken`). It is NOT Microsoft
// Graph — Defender for Endpoint device actions live on their own API gateway and
// require their own token audience and their own Application permissions granted
// under the "WindowsDefenderATP" API surface in the app-registration manifest.
//
// Credentials are reused, never re-stored: the same MT_APP_CLIENT_ID /
// MT_APP_CLIENT_SECRET client-credential pair that graph.ts's
// `getAccessTokenForTenant` and `getActivityApiToken` already use. There is no
// separate certificate — the platform authenticates the MT app with a client
// secret (confirmed via graph.ts).
//
// ── Token-audience gotcha (verified against Microsoft Learn, 2026-02 revision) ──
// The API HOST is https://api.security.microsoft.com/... BUT the OAuth token must
// be issued for the LEGACY resource https://api.securitycenter.microsoft.com. Per
// Microsoft's own docs (exposed-apis-create-app-webapp): "Some Microsoft Defender
// for Endpoint APIs continue to require access tokens issued for the legacy
// resource https://api.securitycenter.microsoft.com. If the token audience
// doesn't match the resource expected by the API, requests fail with 403
// Forbidden, even if the API endpoint uses https://api.security.microsoft.com."
// So the request-host and the token-scope host are DELIBERATELY DIFFERENT — do
// not "fix" this mismatch; aligning them breaks auth.
//
// ── Rate limits (Microsoft-documented, per tenant) ──────────────────────────────
// 100 calls/minute and 1,500 calls/hour for each of these device-action APIs. No
// elaborate rate-limiting infrastructure is built here (out of scope for the
// connection/auth layer) — callers simply must not invoke these in a tight loop.
//
// ── Operational risk ────────────────────────────────────────────────────────────
// `isolateMachine` cuts a live device off the network; `runAntivirusScan` starts a
// real scan. These are disruptive, irreversible-in-the-moment actions. Every
// action requires a non-empty operator Comment (Microsoft requires it, and it is
// the audit trail Defender surfaces for who did what and why).

// Request host for the Defender for Endpoint device-action APIs. The canonical
// global host is api.security.microsoft.com; regional variants exist (e.g.
// us.api.security.microsoft.com, eu.api.security.microsoft.com) — overridable via
// env without a code change if a tenant's data residency requires it.
const DEFENDER_API_BASE =
  process.env.DEFENDER_ENDPOINT_API_BASE ?? "https://api.security.microsoft.com";

// Token audience/scope — the LEGACY resource, per the gotcha documented above.
// v2.0 client-credentials .default form, matching graph.ts's token convention.
const DEFENDER_TOKEN_SCOPE = "https://api.securitycenter.microsoft.com/.default";

// ── Required Application permissions (WindowsDefenderATP resource) ───────────────
// These are the app-only permissions that must be added to the multi-tenant App
// Registration under "APIs my organization uses → WindowsDefenderATP" (NOT under
// Microsoft Graph — that is why they are declared here and NOT in graph.ts's
// REQUIRED_MT_SCOPES, which is the Graph .default consent set; mixing a non-Graph
// permission into that list would break Graph token acquisition).
//
// Adding these permissions requires a fresh admin re-consent on every customer
// tenant — a tenant already consented for Graph will NOT automatically have these.
// Verified against Microsoft Learn (isolate-machine / unisolate-machine /
// run-av-scan API reference pages):
//   - Machine.Isolate ("Isolate machine")  → isolate + release-from-isolation
//   - Machine.Scan    ("Scan machine")      → run antivirus scan
export const REQUIRED_DEFENDER_APP_PERMISSIONS = [
  "Machine.Isolate",
  "Machine.Scan",
] as const;

export type DefenderAppPermission = typeof REQUIRED_DEFENDER_APP_PERMISSIONS[number];

interface TokenCache {
  token: string;
  expiresAt: number;
}

// Per-tenant token cache — same shape/keying as graph.ts's tenantTokenCache and
// activityTokenCache, kept SEPARATE because the audience differs.
const defenderTokenCache = new Map<string, TokenCache>();

/**
 * True when the multi-tenant app client-credential pair is configured. Mirrors
 * graph.ts `mtAppCredentialsPresent()` — the same env vars, not a new secret.
 */
export function defenderCredentialsPresent(): boolean {
  return Boolean(process.env.MT_APP_CLIENT_ID && process.env.MT_APP_CLIENT_SECRET);
}

/**
 * Error thrown when a tenant has not admin-consented to the Defender for Endpoint
 * (WindowsDefenderATP) Application permissions — or that consent was revoked.
 *
 * DELIBERATELY distinct from graph.ts's `ConsentRevokedError` + it does NOT call
 * `markTenantConsentRevoked()`. Reason: Defender consent is a SEPARATE consent
 * surface from the Graph `tenant_consent` row. A tenant can be fully consented for
 * Graph yet have never re-consented to the newly-added Machine.Isolate/Machine.Scan
 * permissions, in which case the token request for the Defender resource returns
 * AADSTS65001 (consent_required). Flipping the shared Graph `tenant_consent` row to
 * "revoked" in that case would wrongly disable working Graph monitoring — the exact
 * kind of collateral damage this integration must avoid. So this layer evicts only
 * its own token cache and surfaces a Defender-specific re-consent signal, leaving
 * Graph consent state untouched. Callers must NOT silently swallow this.
 */
export class DefenderConsentError extends Error {
  readonly tenantId: string;
  constructor(tenantId: string) {
    super(`Defender for Endpoint admin consent revoked or missing for tenant ${tenantId}`);
    this.name = "DefenderConsentError";
    this.tenantId = tenantId;
  }
}

/** Evict the Defender token cache for a tenant (e.g. after a consent error). */
export function evictDefenderToken(tenantId: string): void {
  defenderTokenCache.delete(tenantId);
}

/**
 * Returns true if a token/API error body signals that admin consent for the
 * Defender (WindowsDefenderATP) permissions has been revoked or was never granted.
 * Mirrors graph.ts's isConsentErrorBody, but scoped to the token-acquisition step
 * for this separate resource.
 */
function isDefenderConsentErrorBody(body: string): boolean {
  return (
    body.includes("invalid_grant") ||
    body.includes("AADSTS65001") || // client/app not consented for this resource
    body.includes("consent_required") ||
    body.includes("InvalidAuthenticationToken")
  );
}

/**
 * Obtain a client-credentials token for a customer tenant scoped to the Defender
 * for Endpoint resource. Same flow/shape as graph.ts `getAccessTokenForTenant`,
 * only the scope differs (the legacy securitycenter resource, per the gotcha above).
 *
 * Throws DefenderConsentError on a consent/401 failure (see that class for why it
 * is separate from Graph's ConsentRevokedError). Throws a plain Error on any other
 * token failure.
 */
export async function getDefenderAccessTokenForTenant(tenantId: string): Promise<string> {
  const cached = defenderTokenCache.get(tenantId);
  if (cached && Date.now() < cached.expiresAt - 60_000) {
    return cached.token;
  }

  const clientId = process.env.MT_APP_CLIENT_ID;
  const clientSecret = process.env.MT_APP_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("MT_APP_CLIENT_ID / MT_APP_CLIENT_SECRET not configured");
  }

  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: DEFENDER_TOKEN_SCOPE,
  });

  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    const isConsentError = res.status === 401 || (res.status === 400 && isDefenderConsentErrorBody(text));
    if (isConsentError) {
      log.warn({ tenantId, status: res.status }, "Defender token: consent revoked/missing for tenant");
      defenderTokenCache.delete(tenantId);
      throw new DefenderConsentError(tenantId);
    }
    throw new Error(`Defender token fetch failed for ${tenantId}: ${res.status} ${text}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  const entry: TokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  defenderTokenCache.set(tenantId, entry);
  return entry.token;
}

/**
 * The Defender for Endpoint "Machine Action" resource returned (201 Created) by a
 * successful device-action call. Only the commonly-consumed fields are typed; the
 * index signature preserves any additional fields Microsoft returns.
 */
export interface MachineAction {
  id: string;
  type: string;                     // e.g. "Isolate", "Unisolate", "RunAntiVirusScan"
  status: string;                   // e.g. "Pending" | "InProgress" | "Succeeded" | "Failed" | "Cancelled"
  machineId: string;
  computerDnsName?: string | null;
  requestor?: string | null;
  requestorComment?: string | null;
  creationDateTimeUtc?: string;
  lastUpdateDateTimeUtc?: string;
  [key: string]: unknown;
}

export interface DefenderActionResult {
  success: boolean;
  status: number;
  /** Parsed MachineAction on success; raw response text on failure. */
  machineAction: MachineAction | null;
  data: unknown;
  errorType?: "consent_revoked" | "insufficient_privilege" | "conflict" | "bad_request" | "not_found" | "unexpected";
}

/**
 * Low-level POST against a Defender for Endpoint device-action endpoint for a
 * tenant. Structurally mirrors graph.ts `graphWriteForTenant`, with two deliberate
 * differences: (1) consent errors throw DefenderConsentError and do NOT flip the
 * shared Graph tenant_consent row (see DefenderConsentError); (2) the success code
 * for these actions is 201 Created.
 *
 * Never throws on ordinary 4xx (403/400/404/409) — those are returned as a typed
 * unsuccessful result so callers can branch on errorType. Only a DefenderConsentError
 * (re-consent required) or a genuine network error propagates.
 */
async function defenderActionPost(
  tenantId: string,
  path: string,
  body: unknown,
): Promise<DefenderActionResult> {
  const token = await getDefenderAccessTokenForTenant(tenantId);

  const res = await fetch(`${DEFENDER_API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  // 401 → token rejected / consent revoked. Evict cache + surface re-consent signal
  // WITHOUT touching Graph consent state.
  if (res.status === 401) {
    const text = await res.text();
    log.warn({ tenantId, status: 401, body: text }, "Defender action: 401 — Defender consent revoked");
    defenderTokenCache.delete(tenantId);
    throw new DefenderConsentError(tenantId);
  }

  // A 403 may carry an embedded consent signal, or may simply mean the specific
  // Machine.Isolate/Machine.Scan permission was never granted (app is consented,
  // this permission is not). Only the former is a re-consent-revoked case.
  if (res.status === 403) {
    const text = await res.text();
    if (isDefenderConsentErrorBody(text)) {
      log.warn({ tenantId, status: 403, body: text }, "Defender action: 403 consent error — Defender consent revoked");
      defenderTokenCache.delete(tenantId);
      throw new DefenderConsentError(tenantId);
    }
    log.warn({ tenantId, status: 403, body: text }, "Defender action: 403 insufficient privilege (permission not granted)");
    return { success: false, status: 403, machineAction: null, data: text, errorType: "insufficient_privilege" };
  }

  if (res.status === 201 || res.status === 200) {
    const text = await res.text();
    let parsed: MachineAction | null = null;
    if (text) {
      try {
        parsed = JSON.parse(text) as MachineAction;
      } catch {
        parsed = null;
      }
    }
    return { success: true, status: res.status, machineAction: parsed, data: parsed ?? text };
  }

  // "Action is already in progress" comes back as 400 or a pending-action body;
  // 409 is the canonical conflict. Surface both as conflict so callers can no-op.
  const text = await res.text();
  if (res.status === 409 || (res.status === 400 && text.includes("already in progress"))) {
    log.info({ tenantId, status: res.status, path }, "Defender action: already in progress (conflict)");
    return { success: false, status: res.status, machineAction: null, data: text, errorType: "conflict" };
  }
  if (res.status === 400) {
    log.warn({ tenantId, status: 400, body: text, path }, "Defender action: bad request");
    return { success: false, status: 400, machineAction: null, data: text, errorType: "bad_request" };
  }
  if (res.status === 404) {
    log.warn({ tenantId, status: 404, path }, "Defender action: machine not found");
    return { success: false, status: 404, machineAction: null, data: text, errorType: "not_found" };
  }

  log.warn({ tenantId, status: res.status, body: text, path }, "Defender action: unexpected response");
  return { success: false, status: res.status, machineAction: null, data: text, errorType: "unexpected" };
}

export type DefenderIsolationType = "Full" | "Selective" | "UnManagedDevice";
export type DefenderScanType = "Quick" | "Full";

/**
 * Isolate a device from the network (disruptive — cuts the device off from all but
 * a limited allow-list of Defender cloud traffic).
 *
 * POST /api/machines/{id}/isolate  body: { Comment, IsolationType }
 * Requires the Machine.Isolate Application permission.
 *
 * @param tenantId     Azure AD tenant (GUID) of the customer that owns the device.
 * @param machineId    Defender machine id (the device's Defender for Endpoint id).
 * @param comment      Required, non-empty operator justification (audit trail).
 * @param isolationType "Full" (default), "Selective", or "UnManagedDevice".
 *                      Use "UnManagedDevice" to contain an unmanaged device.
 */
export async function isolateMachine(
  tenantId: string,
  machineId: string,
  comment: string,
  isolationType: DefenderIsolationType = "Full",
): Promise<DefenderActionResult> {
  if (!comment || !comment.trim()) {
    throw new Error("isolateMachine: a non-empty Comment is required");
  }
  log.info({ tenantId, machineId, isolationType }, "Defender: isolating machine");
  return defenderActionPost(
    tenantId,
    `/api/machines/${encodeURIComponent(machineId)}/isolate`,
    { Comment: comment, IsolationType: isolationType },
  );
}

/**
 * Release a device from isolation (undo `isolateMachine`).
 *
 * POST /api/machines/{id}/unisolate  body: { Comment }
 * Requires the Machine.Isolate Application permission (same permission as isolate).
 *
 * @param tenantId  Azure AD tenant (GUID) of the customer that owns the device.
 * @param machineId Defender machine id.
 * @param comment   Required, non-empty operator justification (audit trail).
 */
export async function releaseMachineFromIsolation(
  tenantId: string,
  machineId: string,
  comment: string,
): Promise<DefenderActionResult> {
  if (!comment || !comment.trim()) {
    throw new Error("releaseMachineFromIsolation: a non-empty Comment is required");
  }
  log.info({ tenantId, machineId }, "Defender: releasing machine from isolation");
  return defenderActionPost(
    tenantId,
    `/api/machines/${encodeURIComponent(machineId)}/unisolate`,
    { Comment: comment },
  );
}

/**
 * Run a Microsoft Defender Antivirus scan on a device.
 *
 * POST /api/machines/{id}/runAntiVirusScan  body: { Comment, ScanType }
 * Requires the Machine.Scan Application permission.
 *
 * @param tenantId  Azure AD tenant (GUID) of the customer that owns the device.
 * @param machineId Defender machine id.
 * @param comment   Required, non-empty operator justification (audit trail).
 * @param scanType  "Quick" (default) or "Full".
 */
export async function runAntivirusScan(
  tenantId: string,
  machineId: string,
  comment: string,
  scanType: DefenderScanType = "Quick",
): Promise<DefenderActionResult> {
  if (!comment || !comment.trim()) {
    throw new Error("runAntivirusScan: a non-empty Comment is required");
  }
  log.info({ tenantId, machineId, scanType }, "Defender: running antivirus scan");
  return defenderActionPost(
    tenantId,
    `/api/machines/${encodeURIComponent(machineId)}/runAntiVirusScan`,
    { Comment: comment, ScanType: scanType },
  );
}
