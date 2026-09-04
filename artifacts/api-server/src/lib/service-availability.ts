/**
 * service-availability.ts — whether a Microsoft SERVICE will answer for a tenant,
 * as a first-class fact separate from whether we hold the permission to ask
 * (Git #1847).
 *
 * ## Why this module exists
 *
 * `config_resources.availability` answers "do we have the scope". It said
 * `available_now` for 189 `/deviceManagement*` resources on the testbed while every
 * single one of them returned nothing, because Intune has never been stood up there.
 * Permission-available and service-available are different facts, and the platform
 * had only the first.
 *
 * Worse, the ten `devices:*` monitor checks were swallowing the refusal and
 * persisting `status: 'ok', item_count: 0`. Confirmed in the local database on
 * 2026-08-30, before this module existed: `devices:autopilot-coverage`,
 * `devices:compliance-policy-coverage`, `devices:compliant-vs-noncompliant`,
 * `devices:encryption-status`, `devices:enrollment-status`,
 * `devices:kfm-configuration`, `devices:os-patch-compliance`,
 * `devices:unassigned-intune-profiles` and `devices:update-rings-config` all sat at
 * `ok` with `item_count = 0`. To every consumer downstream that is identical to a
 * tenant that genuinely manages zero devices — a customer being told a measured
 * zero when nothing was measured at all.
 *
 * ## The five conditions this separates
 *
 * A refusal from `/deviceManagement` can mean five genuinely different things, and
 * "not configured" and "not licensed" are DIFFERENT CUSTOMER CONVERSATIONS: one says
 * go and set your MDM authority, the other says you do not own the product. Getting
 * that backwards is the platform being confidently wrong about someone's tenant.
 *
 *   available          the service answered 2xx, rows or no rows
 *   not_licensed       no service plan on the tenant entitles Intune at all
 *   not_configured     entitled, never enrolled/activated
 *   permission_denied  an ordinary Graph authorization failure
 *   service_outage     a transient refusal that is NOT a never-configured signature
 *
 * ## Why the wire signature alone is not enough
 *
 * A tenant that never licensed Intune and a tenant that licensed it and never
 * enrolled BOTH fail to answer `/deviceManagement`, with the same bodies. The wire
 * signature can prove "Intune is not answering"; only the tenant's own
 * `/subscribedSkus` entitlement can say which of the two it is. So this module
 * combines them: signature establishes unreachability, service-plan entitlement
 * disambiguates the cause, and `evidenceBasis` records which did the work.
 *
 * ## Report once, at tenant level
 *
 * The verdict is written ONCE per (tenant, service) into
 * `tenant_service_availability`. The ten checks resolve to `service_not_configured`
 * and refer to that row; they do not each independently announce the same
 * tenant-wide condition.
 *
 * Read-only against the tenant. Nothing here configures or enables anything.
 */

import { db } from "@workspace/db";
import {
  tenantServiceAvailabilityTable,
  tenantCheckItemDetailsTable,
  TENANT_SERVICE_KEYS,
  type TenantServiceKey,
  type TenantServiceState,
  type TenantServiceEvidenceBasis,
  type TenantServiceAvailability,
} from "@workspace/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { logger } from "./logger";

const log = logger.child({ channel: "integration.azure" });

/** Response-body evidence kept on the row is truncated to this many characters. */
const EVIDENCE_BODY_CHARS = 600;

// ── Which service backs a Graph path ─────────────────────────────────────────

/**
 * The Graph roots Intune serves. `/deviceManagement` is Intune's own root;
 * `/deviceAppManagement` is Intune app management (MAM) and fails with the same
 * backend signatures — both are in this issue's recorded live evidence.
 *
 * Deliberately prefix-gated rather than body-gated: the IIS 503 page in particular
 * carries no Intune-specific text of its own, and matching it endpoint-agnostically
 * would silently relabel a genuine outage on an unrelated workload as "no MDM".
 */
const INTUNE_GRAPH_ROOTS = ["/deviceManagement", "/deviceAppManagement"] as const;

/**
 * Reduce any form of Graph endpoint this codebase passes around to the version-less
 * path the root matching below expects: `/deviceManagement/...`.
 *
 * Three forms genuinely occur, and before Git #1796 only the first was handled:
 *   - `/deviceManagement/managedDevices`                          (monitor_checks)
 *   - `https://graph.microsoft.com/v1.0/deviceManagement/...`     (an @odata.nextLink)
 *   - `https://graph.microsoft.com/beta/deviceManagement/...`     (the #1796 collector)
 *
 * The absolute forms used to fall straight through, because the old check was a bare
 * `startsWith("/deviceManagement")` and an absolute URL starts with `https:`. The
 * consequence was not cosmetic: an Intune 401/503 arriving on an absolute URL was
 * NOT recognised as the never-configured signature, so it was reported as a
 * permission denial or a transport error — the precise "confidently wrong about
 * someone's tenant" conflation this module exists to prevent, reintroduced through
 * a different spelling of the same endpoint. Reproduced live against the testbed on
 * 2026-08-30 while wiring #1796's collector, which reads beta paths as absolute URLs.
 */
function normalizeGraphEndpointPath(endpoint: string): string {
  let p = endpoint.trim();
  const hostMatch = /^https?:\/\/graph\.microsoft\.com\/(v1\.0|beta)(\/.*)?$/i.exec(p);
  if (hostMatch) p = hostMatch[2] ?? "/";
  return p.startsWith("/") ? p : `/${p}`;
}

/**
 * Which Microsoft service has to be stood up for a Graph path to answer, or null
 * when the path's backing service has no distinguishable service-level signature.
 *
 * Matches the root segment, so both `/deviceManagement` itself and anything beneath
 * it resolve — the issue's evidence includes a 503 from the bare root.
 */
export function serviceKeyForGraphPath(graphPath: string | null | undefined): TenantServiceKey | null {
  if (!graphPath) return null;
  const path = normalizeGraphEndpointPath(graphPath);
  for (const root of INTUNE_GRAPH_ROOTS) {
    if (path === root || path.startsWith(`${root}/`) || path.startsWith(`${root}?`)) return "intune";
  }
  return null;
}

// ── Wire signatures ──────────────────────────────────────────────────────────

/**
 * The five documented wire signatures a never-stood-up Intune backend produces.
 * Each is a real, reproduced observation, not a guess:
 *
 *   intune-legacy-devicefe-401
 *     401 on the `managedDevices`-backed paths. Graph wraps an INTUNE-side
 *     `Forbidden` — the `"_version": 3` envelope and the
 *     `DeviceFE/StatelessDeviceFEService` proxy name are Intune's, not Graph's.
 *     A real Graph permission denial looks nothing like this (contrast
 *     `devices:bitlocker-key-escrow`'s clean 403 `authorization_error`).
 *
 *   intune-segment-unresolved-400
 *     400 BadRequest on `windowsAutopilotDeploymentProfiles` — Graph's OData router
 *     reports the navigation property itself does not resolve.
 *
 *   intune-backend-iis-503
 *     503 returning a raw IIS "Service Unavailable" HTML page, not a Graph JSON
 *     error at all. Reproduced twice minutes apart on 2026-08-30, including from the
 *     bare `/deviceManagement` root, so it is not a one-off blip.
 *
 *   intune-forbidden-envelope-401
 *     401 wearing the SAME `"_version": 3` + `"ErrorCode":"Forbidden"` Intune
 *     envelope as `intune-legacy-devicefe-401`, but proxied through a DIFFERENT
 *     Intune backend service than `DeviceFE/StatelessDeviceFEService` — reproduced
 *     live on the testbed (snapshot `30433ced-b0e5-4161-8270-97bf360ff931`, row 8,
 *     2026-08-30) across at least `AndroidSync/StatelessAndroidSyncFEService`,
 *     `DeviceEnrollmentFE/StatelessDeviceEnrollmentFEService`,
 *     `StatelessCompanyTermFEService`, `StatelessCustomerDataFEService`,
 *     `StatelessNotificationFEService`, `StatelessRoleAdministrationFEService` and
 *     `WIPReportServices/StatelessWIPReportFEService` — every one of Intune's own
 *     backend proxies failing the same way, not one proxy's private quirk. Git
 *     #1963: 66 `/deviceManagement*` resources on this tenant reported
 *     `permission_denied` instead of the licence gap #1847 already proved, because
 *     the original matcher required the `DeviceFE` proxy name specifically.
 *     Gated on the envelope alone, not a proxy name — deliberately broader than the
 *     other three — because a genuine Graph permission denial does not wear this
 *     wrapper (contrast the clean `403 authorization_error` shape a real denial
 *     returns). `resolveIntuneServiceState` still requires the tenant's own
 *     `/subscribedSkus` entitlement to actually resolve this to `not_licensed`; the
 *     signature only proves Intune is not answering, same as the other three.
 *
 *   intune-bare-message-401
 *     401 wearing the same `"_version": 3` Intune envelope as
 *     `intune-forbidden-envelope-401`, but WITHOUT the `"ErrorCode":"Forbidden"`
 *     wrapper that signature keys off — just a bare `"Message"` field. Reproduced
 *     live on the testbed (snapshot `30433ced-b0e5-4161-8270-97bf360ff931`, row 8,
 *     2026-08-30) on `graph:beta:/deviceManagement/autopilotEvents` and
 *     `graph:v1.0:/deviceManagement/troubleshootingEvents` — the 2 rows of that
 *     snapshot's 41 `permission_denied`/401 `/deviceManagement*` rows that
 *     `intune-forbidden-envelope-401` (#1963) did not catch, because they lack the
 *     `ErrorCode` field entirely rather than carrying it at a different escape
 *     depth. Git #2843. Gated on the bare envelope alone, same discipline as
 *     `intune-forbidden-envelope-401`: a genuine Graph permission denial does not
 *     wear this wrapper. `resolveIntuneServiceState` still requires the tenant's
 *     own `/subscribedSkus` entitlement to resolve this to `not_licensed`; the
 *     signature only proves Intune is not answering.
 */
export const INTUNE_WIRE_SIGNATURES = [
  "intune-legacy-devicefe-401",
  "intune-segment-unresolved-400",
  "intune-backend-iis-503",
  "intune-forbidden-envelope-401",
  "intune-bare-message-401",
] as const;
export type IntuneWireSignature = typeof INTUNE_WIRE_SIGNATURES[number];

/**
 * Match a failed Intune response against the never-configured signatures above.
 * Returns the signature name, or null when the failure is an ordinary error that
 * must keep flowing down the normal error path.
 */
export function matchIntuneWireSignature(
  endpoint: string,
  status: number,
  body: string,
): IntuneWireSignature | null {
  if (serviceKeyForGraphPath(endpoint) !== "intune") return null;
  if (status === 401 && body.includes("DeviceFE/StatelessDeviceFEService")) {
    return "intune-legacy-devicefe-401";
  }
  if (
    status === 400 &&
    body.includes('"code":"BadRequest"') &&
    body.includes("Resource not found for the segment")
  ) {
    return "intune-segment-unresolved-400";
  }
  if (status === 503 && body.includes("<!DOCTYPE HTML") && body.includes("Service Unavailable")) {
    return "intune-backend-iis-503";
  }
  if (status === 401 && INTUNE_FORBIDDEN_ENVELOPE_RE.test(body) && body.includes("_version")) {
    return "intune-forbidden-envelope-401";
  }
  if (
    status === 401 &&
    body.includes("_version") &&
    INTUNE_BARE_MESSAGE_RE.test(body) &&
    !INTUNE_ERROR_CODE_RE.test(body)
  ) {
    return "intune-bare-message-401";
  }
  return null;
}

/**
 * Matches `"ErrorCode":"Forbidden"` regardless of how many backslash-escape levels
 * deep it sits. Real evidence (Git #1963) shows this envelope arriving at different
 * escape depths depending on which Intune backend proxy wraps it — one backslash for
 * the `AndroidSync` proxy, three for others carrying the same `_version: 3` body — so
 * a fixed-count literal match would itself reproduce this issue's failure mode.
 */
const INTUNE_FORBIDDEN_ENVELOPE_RE = /\\*"ErrorCode\\*"\s*:\s*\\*"Forbidden\\*"/;

/**
 * Matches a bare `"Message"` field regardless of backslash-escape depth — same
 * tolerant-depth reasoning as `INTUNE_FORBIDDEN_ENVELOPE_RE` (Git #1963), applied to
 * the `intune-bare-message-401` envelope (Git #2843), which carries `"Message"` but
 * no `"ErrorCode"` at all.
 */
const INTUNE_BARE_MESSAGE_RE = /\\*"Message\\*"\s*:\s*\\*"/;

/** Any escape-depth form of `"ErrorCode"` — used to keep `intune-bare-message-401`
 * from also matching the `intune-forbidden-envelope-401` envelope it is genuinely
 * missing the field from. */
const INTUNE_ERROR_CODE_RE = /\\*"ErrorCode\\*"/;

// ── Service-plan entitlement ─────────────────────────────────────────────────

/**
 * Intune service plans, from Microsoft's published product-names-and-service-plan
 * identifiers reference. The distinction that matters here:
 *
 *   FULL Intune (`INTUNE_A` and its variants) is what `/deviceManagement` serves.
 *   It ships in Microsoft 365 E3/E5 (`SPE_E3`/`SPE_E5`) and standalone, NOT in
 *   Office 365 E3 (`ENTERPRISEPACK`).
 *
 *   `INTUNE_O365` is "Mobile Device Management for Office 365" — the basic MDM that
 *   DOES ride in Office 365 SKUs. It is a materially smaller capability and does not
 *   entitle the Intune surface this platform reads.
 *
 * Conflating the two is exactly the confidently-wrong reporting this issue exists to
 * prevent, so they are separate lists and never merged.
 */
const FULL_INTUNE_PLAN_PREFIXES = ["INTUNE_A", "INTUNE_EDU", "INTUNE_SMBIZ", "INTUNE_P"] as const;
const BASIC_MDM_PLAN_NAMES = ["INTUNE_O365"] as const;

/** The monitor checks that read `/subscribedSkus`, in preference order.
 * Exported for `advancePolicyClearances()` (#1526, `alert-engine.ts`), which
 * needs the same already-collected data to detect a watched SKU landing in a
 * tenant — no reason to keep a second copy of this list. */
export const SUBSCRIBED_SKU_CHECK_KEYS = [
  "cost:entra-license-tier-distribution",
  "cost:license-count-by-sku",
  "cost:unused-unassigned-licenses",
  "license:sku-utilization",
] as const;

export interface IntuneServicePlanRow {
  skuPartNumber: string;
  servicePlanName: string;
  provisioningStatus: string;
}

/**
 * What the tenant's own licence data says about Intune.
 *
 *  - `licensed`               a full-Intune plan is present and provisioned Success
 *  - `entitled_not_activated` an Intune-family plan is present but none is Success
 *  - `basic_mdm_only`         only Mobile Device Management for Office 365
 *  - `not_licensed`           no Intune-family plan at all
 *  - `unknown`                no `/subscribedSkus` collection to read
 */
export type IntuneEntitlementVerdict =
  | "licensed"
  | "entitled_not_activated"
  | "basic_mdm_only"
  | "not_licensed"
  | "unknown";

export interface IntuneEntitlement {
  verdict: IntuneEntitlementVerdict;
  /** Every Intune-family service plan found, verbatim. Empty when none or unknown. */
  plans: IntuneServicePlanRow[];
  /** Every SKU part number on the tenant, so the evidence names the real licence set. */
  skuPartNumbers: string[];
  /** Which check's collection this was read from, and when. Null when unknown. */
  sourceCheckKey: string | null;
  collectedAt: string | null;
}

function isFullIntunePlan(name: string): boolean {
  const upper = name.toUpperCase();
  if ((BASIC_MDM_PLAN_NAMES as readonly string[]).includes(upper)) return false;
  return FULL_INTUNE_PLAN_PREFIXES.some((p) => upper === p || upper.startsWith(`${p}_`));
}

function isIntuneFamilyPlan(name: string): boolean {
  return name.toUpperCase().includes("INTUNE");
}

/**
 * Read the tenant's Intune entitlement from the `/subscribedSkus` collection the
 * platform already stores — no extra Graph call, and no inference from the presence
 * of an "E3-family" SKU, which is exactly the reasoning error this issue caught
 * (Office 365 E3 and Microsoft 365 E3 are both "E3" and only one carries Intune).
 *
 * Returns `unknown` rather than guessing when nothing has been collected.
 */
export async function readIntuneEntitlement(tenantId: string): Promise<IntuneEntitlement> {
  const empty: IntuneEntitlement = {
    verdict: "unknown",
    plans: [],
    skuPartNumbers: [],
    sourceCheckKey: null,
    collectedAt: null,
  };

  let rows: Array<{ checkKey: string; items: unknown; collectedAt: Date }> = [];
  try {
    rows = await db
      .select({
        checkKey: tenantCheckItemDetailsTable.checkKey,
        items: tenantCheckItemDetailsTable.items,
        collectedAt: tenantCheckItemDetailsTable.collectedAt,
      })
      .from(tenantCheckItemDetailsTable)
      .where(
        and(
          eq(tenantCheckItemDetailsTable.tenantId, tenantId),
          eq(tenantCheckItemDetailsTable.status, "ok"),
          eq(tenantCheckItemDetailsTable.itemsOmitted, false),
          inArray(tenantCheckItemDetailsTable.checkKey, [...SUBSCRIBED_SKU_CHECK_KEYS]),
        ),
      )
      .orderBy(desc(tenantCheckItemDetailsTable.collectedAt))
      .limit(1);
  } catch (err) {
    log.error({ err, tenantId }, "service-availability: failed to read subscribedSkus collection");
    return empty;
  }

  const row = rows[0];
  if (!row || !Array.isArray(row.items) || row.items.length === 0) return empty;

  const skuPartNumbers: string[] = [];
  const plans: IntuneServicePlanRow[] = [];
  for (const raw of row.items as Array<Record<string, unknown>>) {
    const sku = typeof raw?.skuPartNumber === "string" ? raw.skuPartNumber : null;
    if (!sku) continue;
    skuPartNumbers.push(sku);
    const servicePlans = Array.isArray(raw.servicePlans) ? raw.servicePlans : [];
    for (const sp of servicePlans as Array<Record<string, unknown>>) {
      const planName = typeof sp?.servicePlanName === "string" ? sp.servicePlanName : null;
      if (!planName || !isIntuneFamilyPlan(planName)) continue;
      plans.push({
        skuPartNumber: sku,
        servicePlanName: planName,
        provisioningStatus: typeof sp.provisioningStatus === "string" ? sp.provisioningStatus : "unknown",
      });
    }
  }

  const base = {
    plans,
    skuPartNumbers,
    sourceCheckKey: row.checkKey,
    collectedAt: row.collectedAt.toISOString(),
  };

  const fullPlans = plans.filter((p) => isFullIntunePlan(p.servicePlanName));
  if (fullPlans.some((p) => p.provisioningStatus === "Success")) {
    return { ...base, verdict: "licensed" };
  }
  if (fullPlans.length > 0) {
    return { ...base, verdict: "entitled_not_activated" };
  }
  if (plans.length > 0) {
    // Intune-family plans exist but none of them is full Intune — i.e. MDM for
    // Office 365 only. Whether it activated is recorded in `plans`, but either way
    // it does not entitle the /deviceManagement surface.
    return { ...base, verdict: "basic_mdm_only" };
  }
  return { ...base, verdict: "not_licensed" };
}

// ── The combined verdict ─────────────────────────────────────────────────────

export interface ServiceStateVerdict {
  serviceKey: TenantServiceKey;
  state: TenantServiceState;
  evidenceBasis: TenantServiceEvidenceBasis;
  reason: string;
  detectionSignature: string | null;
  entitlement: IntuneEntitlement;
}

function describePlans(plans: IntuneServicePlanRow[]): string {
  return plans
    .map((p) => `${p.servicePlanName} (${p.skuPartNumber}, ${p.provisioningStatus})`)
    .join(", ");
}

/**
 * Combine a matched wire signature with the tenant's own entitlement into the one
 * honest tenant-level verdict, plus the sentence an operator or customer can read.
 *
 * The signature has already established that Intune will not answer. This decides
 * WHY, and never guesses: with no entitlement collection to read, the verdict stays
 * `not_configured` on the signature alone and `evidenceBasis` says `wire-signature`
 * so the thinness of the evidence is visible rather than hidden.
 */
export function resolveIntuneServiceState(
  signature: IntuneWireSignature,
  entitlement: IntuneEntitlement,
): ServiceStateVerdict {
  const common = { serviceKey: "intune" as const, detectionSignature: signature, entitlement };

  switch (entitlement.verdict) {
    case "not_licensed":
      return {
        ...common,
        state: "not_licensed",
        evidenceBasis: "combined",
        reason:
          `Microsoft Intune is not licensed on this tenant. Its subscribed SKUs (${entitlement.skuPartNumbers.join(", ")}) ` +
          `carry no Intune service plan, and the Intune endpoints refuse with the ${signature} signature. ` +
          `Device management cannot be reported until Intune is licensed.`,
      };
    case "basic_mdm_only":
      return {
        ...common,
        state: "not_licensed",
        evidenceBasis: "combined",
        reason:
          `Microsoft Intune is not licensed on this tenant. The only Intune-family entitlement is ` +
          `${describePlans(entitlement.plans)} — Mobile Device Management for Office 365, which is a basic MDM ` +
          `capability and does not include Intune. The Intune endpoints refuse with the ${signature} signature. ` +
          `Subscribed SKUs: ${entitlement.skuPartNumbers.join(", ")}.`,
      };
    case "entitled_not_activated":
      return {
        ...common,
        state: "not_configured",
        evidenceBasis: "combined",
        reason:
          `Microsoft Intune is licensed on this tenant but has never been activated: ${describePlans(entitlement.plans)}. ` +
          `The Intune endpoints refuse with the ${signature} signature. Device management can be reported once Intune ` +
          `is enrolled and an MDM authority is set.`,
      };
    case "licensed":
      return {
        ...common,
        state: "not_configured",
        evidenceBasis: "combined",
        reason:
          `Microsoft Intune is licensed and provisioned on this tenant (${describePlans(entitlement.plans)}) but is not ` +
          `answering: the endpoints refuse with the ${signature} signature, which is what a tenant whose MDM authority ` +
          `has never been set returns. Device management can be reported once Intune is enrolled.`,
      };
    case "unknown":
    default:
      return {
        ...common,
        state: "not_configured",
        evidenceBasis: "wire-signature",
        reason:
          `Microsoft Intune is not answering for this tenant: the endpoints refuse with the ${signature} signature, ` +
          `which a tenant that has never enrolled Intune returns. No /subscribedSkus collection has been recorded for ` +
          `this tenant, so whether Intune is licensed at all could not be confirmed.`,
      };
  }
}

// ── Persistence — one row per (tenant, service) ──────────────────────────────

export interface RecordServiceStateInput {
  tenantId: string;
  verdict: ServiceStateVerdict;
  observedEndpoint: string;
  observedHttpStatus: number;
  responseBody: string;
  detectedByCheckKey?: string | null;
}

/**
 * Upsert the tenant-level fact. Idempotent by (tenantId, serviceKey), so ten checks
 * hitting the same condition in one run leave ONE row, not ten — the whole point of
 * reporting this at tenant level.
 *
 * `firstObservedAt` is preserved across updates so the row records how long the
 * condition has held, while `lastObservedAt` moves each run. Never throws: a
 * bookkeeping failure must not fail the check that discovered the condition.
 */
export async function recordTenantServiceState(input: RecordServiceStateInput): Promise<void> {
  const { tenantId, verdict } = input;
  const evidence: Record<string, unknown> = {
    responseBody: input.responseBody.slice(0, EVIDENCE_BODY_CHARS),
    entitlementVerdict: verdict.entitlement.verdict,
    intuneServicePlans: verdict.entitlement.plans,
    skuPartNumbers: verdict.entitlement.skuPartNumbers,
    entitlementSourceCheckKey: verdict.entitlement.sourceCheckKey,
    entitlementCollectedAt: verdict.entitlement.collectedAt,
  };

  try {
    await db
      .insert(tenantServiceAvailabilityTable)
      .values({
        tenantId,
        serviceKey: verdict.serviceKey,
        state: verdict.state,
        evidenceBasis: verdict.evidenceBasis,
        reason: verdict.reason,
        detectionSignature: verdict.detectionSignature,
        observedEndpoint: input.observedEndpoint,
        observedHttpStatus: input.observedHttpStatus,
        evidence,
        detectedByCheckKey: input.detectedByCheckKey ?? null,
      })
      .onConflictDoUpdate({
        target: [tenantServiceAvailabilityTable.tenantId, tenantServiceAvailabilityTable.serviceKey],
        set: {
          state: verdict.state,
          evidenceBasis: verdict.evidenceBasis,
          reason: verdict.reason,
          detectionSignature: verdict.detectionSignature,
          observedEndpoint: input.observedEndpoint,
          observedHttpStatus: input.observedHttpStatus,
          evidence,
          detectedByCheckKey: input.detectedByCheckKey ?? null,
          lastObservedAt: sql`now()`,
          updatedAt: sql`now()`,
        },
      });
  } catch (err) {
    log.error(
      { err, tenantId, serviceKey: verdict.serviceKey },
      "service-availability: failed to record tenant service state",
    );
  }
}

/** Every recorded service state for a tenant. Empty when nothing has been observed. */
export async function getTenantServiceStates(tenantId: string): Promise<TenantServiceAvailability[]> {
  try {
    return await db
      .select()
      .from(tenantServiceAvailabilityTable)
      .where(eq(tenantServiceAvailabilityTable.tenantId, tenantId));
  } catch (err) {
    log.error({ err, tenantId }, "service-availability: failed to read tenant service states");
    return [];
  }
}

/** One service's recorded state for a tenant, or null when nothing is on record. */
export async function getTenantServiceState(
  tenantId: string,
  serviceKey: TenantServiceKey,
): Promise<TenantServiceAvailability | null> {
  try {
    const rows = await db
      .select()
      .from(tenantServiceAvailabilityTable)
      .where(
        and(
          eq(tenantServiceAvailabilityTable.tenantId, tenantId),
          eq(tenantServiceAvailabilityTable.serviceKey, serviceKey),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  } catch (err) {
    log.error({ err, tenantId, serviceKey }, "service-availability: failed to read tenant service state");
    return null;
  }
}

// ── The error the fetch layer throws ─────────────────────────────────────────

/**
 * Thrown by `graphFetchPaginated` when a Microsoft service refuses with a documented
 * never-configured / not-licensed signature.
 *
 * This deliberately replaces the previous behaviour, which returned
 * `{ value: [], _intuneNotConfigured: true }` and let the check land as
 * `status: 'ok', item_count: 0`. That was the platform reporting a measured zero for
 * something it never measured. An error the executor classifies is the only way the
 * distinction survives to the customer.
 *
 * It is NOT a technical failure and must never route to consent revocation or be
 * counted as a failed check — the same treatment `LicenseGapError` already gets.
 */
export class ServiceNotConfiguredError extends Error {
  readonly tenantId: string;
  readonly verdict: ServiceStateVerdict;
  readonly serviceKey: TenantServiceKey;
  readonly state: TenantServiceState;
  readonly reason: string;
  readonly detectionSignature: string | null;
  readonly httpStatus: number;
  readonly endpoint: string;
  /** Truncated verbatim response body, carried so the recorded evidence is real. */
  readonly responseBody: string;

  constructor(
    tenantId: string,
    verdict: ServiceStateVerdict,
    endpoint: string,
    httpStatus: number,
    responseBody: string,
  ) {
    super(verdict.reason);
    this.name = "ServiceNotConfiguredError";
    this.tenantId = tenantId;
    this.verdict = verdict;
    this.serviceKey = verdict.serviceKey;
    this.state = verdict.state;
    this.reason = verdict.reason;
    this.detectionSignature = verdict.detectionSignature;
    this.httpStatus = httpStatus;
    this.endpoint = endpoint;
    this.responseBody = responseBody.slice(0, EVIDENCE_BODY_CHARS);
  }
}

/** Customer-safe display name per service key. Real product names only. */
const SERVICE_DISPLAY_NAMES: Record<TenantServiceKey, string> = {
  intune: "Microsoft Intune",
};

export function serviceDisplayName(serviceKey: TenantServiceKey): string {
  return SERVICE_DISPLAY_NAMES[serviceKey] ?? serviceKey;
}

export { TENANT_SERVICE_KEYS };
export type { TenantServiceKey, TenantServiceState };
