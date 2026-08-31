/**
 * tenant-workloads.ts — the tenant's REAL enabled M365 workload estate (Git #2008).
 *
 * ── Why this exists ───────────────────────────────────────────────────────────
 * #1523 settled that the Ownership/RACI matrix attaches a row to every workload
 * the tenant actually RUNS (Exchange, SharePoint, OneDrive, Teams, Security,
 * Identity...), not to what the customer happens to have purchased through this
 * platform (`client_services`). A customer with only a Monitoring purchase
 * still runs Exchange, and Exchange still needs an accountable owner.
 *
 * THE ONE CONDITION (settled on #1516): a service plan whose `provisioningStatus`
 * is "Success" is enabled — full stop. Usage/consumption is a separate
 * Licensing-pillar signal (cost-engine.ts / license-waste-source.ts) and is
 * deliberately NOT conflated with this derivation.
 *
 * ── Where the data comes from ─────────────────────────────────────────────────
 * No dedicated Graph call. `/subscribedSkus` is already fetched by nine active
 * monitor checks (cost:*, copilot:*, license:*) and their full first-page
 * response — including every SKU's `servicePlans[]` — is already stored in
 * `tenant_monitor_profiles.rawResponse`. `license-waste-source.ts` established
 * the discovery pattern (find active checks whose endpoint hits
 * `/subscribedSkus`, read the most recently collected complete page); this
 * module reuses that exact discovery (`subscribedSkusCheckKeys`) rather than
 * re-deriving it.
 *
 * ── Workload identity is derived, never authored ──────────────────────────────
 * `servicePlanName` is Microsoft's own real identifier (e.g.
 * "EXCHANGE_S_ENTERPRISE") — kept verbatim on the stored row. The coarse
 * workload buckets below (Exchange, SharePoint, Teams, Security, Identity,
 * Endpoint) are a lookup FROM those real identifiers, the same discipline
 * `account-security-graph.ts`'s `FULL_INTUNE_SERVICE_PLAN` constant already
 * uses for its Intune entitlement check — every key in the map is a real,
 * Microsoft-issued servicePlanName, not an invented vocabulary. A plan whose
 * name isn't in the map contributes nothing rather than being force-fit into a
 * bucket — silence is the honest answer for a plan this map doesn't yet cover.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import { db, tenantMonitorProfilesTable, tenantServicePlansTable, tenantsTable } from "@workspace/db";
import { subscribedSkusCheckKeys } from "./license-waste-source.ts";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "tenant.workload" });

/** Only enabled plans are ever persisted — see the header's "one condition". */
const ENABLED_PROVISIONING_STATUS = "Success";

export interface WorkloadDefinition {
  readonly key: string;
  readonly label: string;
}

/**
 * Real Microsoft `servicePlanName` identifiers, mapped to the coarse workload
 * they belong to. Verified against Microsoft's own licensing service-plan
 * reference — nothing here is invented. A plan legitimately enabled on a
 * tenant but absent from this map (there are hundreds of real service plans,
 * most of them add-ons rather than workloads a RACI matrix asks someone to
 * own) simply produces no workload row for it, rather than a guessed one.
 */
const WORKLOAD_BY_SERVICE_PLAN_NAME: Readonly<Record<string, WorkloadDefinition>> = {
  // Exchange Online
  EXCHANGE_S_STANDARD: { key: "exchange", label: "Exchange Online" },
  EXCHANGE_S_ENTERPRISE: { key: "exchange", label: "Exchange Online" },
  EXCHANGE_S_ESSENTIALS: { key: "exchange", label: "Exchange Online" },
  EXCHANGE_L_STANDARD: { key: "exchange", label: "Exchange Online" },
  EXCHANGE_S_DESKLESS: { key: "exchange", label: "Exchange Online" },
  EXCHANGE_S_FOUNDATION: { key: "exchange", label: "Exchange Online" },

  // SharePoint Online. OneDrive for Business shares this workload: Microsoft
  // provisions OneDrive on the SharePoint service in every SKU that carries
  // it, with no separate servicePlanName of its own — folding it in here is a
  // fact about Microsoft's own provisioning, not an invented merge.
  SHAREPOINTSTANDARD: { key: "sharepoint", label: "SharePoint & OneDrive" },
  SHAREPOINTENTERPRISE: { key: "sharepoint", label: "SharePoint & OneDrive" },
  SHAREPOINTWAC: { key: "sharepoint", label: "SharePoint & OneDrive" },
  SHAREPOINTDESKLESS: { key: "sharepoint", label: "SharePoint & OneDrive" },

  // Teams
  TEAMS1: { key: "teams", label: "Teams" },
  MCOSTANDARD: { key: "teams", label: "Teams" },
  MCOEV: { key: "teams", label: "Teams" },

  // Security (Defender family)
  ATP_ENTERPRISE: { key: "security", label: "Security (Defender)" },
  THREAT_INTELLIGENCE: { key: "security", label: "Security (Defender)" },
  ATA: { key: "security", label: "Security (Defender)" },
  MDATP: { key: "security", label: "Security (Defender)" },
  WIN_DEF_ATP: { key: "security", label: "Security (Defender)" },

  // Identity & access (Entra ID / ICAM)
  AAD_PREMIUM: { key: "icam", label: "Identity & Access (Entra ID)" },
  AAD_PREMIUM_P2: { key: "icam", label: "Identity & Access (Entra ID)" },

  // Endpoint management. Same real identifier
  // account-security-graph.ts's FULL_INTUNE_SERVICE_PLAN already keys off for
  // its device-compliance entitlement check.
  INTUNE_A: { key: "endpoint", label: "Endpoint Management (Intune)" },
};

export function resolveWorkloadForServicePlan(servicePlanName: string): WorkloadDefinition | null {
  return WORKLOAD_BY_SERVICE_PLAN_NAME[servicePlanName] ?? null;
}

/**
 * `monitor_checks.key` category prefixes, mapped to the SAME workload buckets
 * above (Git #1511 — role-based risk-acceptance authority). The prefix is the
 * check's own real, already-stored category (`identity:mfa-registration`,
 * `exchange:distribution-list-count`), read verbatim off `monitor_checks.key` /
 * `msp_risk_decisions.check_key` — not an invented taxonomy layered on top.
 *
 * A category with no single-workload owner (adoption, appgov, compliance,
 * copilot, cost, governance, license/licensing, m365, platform, diagnostics —
 * every one of them cross-cutting reporting or governance rather than one
 * workload's accountability) is deliberately absent, resolving to null: the
 * same "silence is the honest answer" rule `resolveWorkloadForServicePlan`
 * follows for a service plan outside its map.
 */
const WORKLOAD_BY_CHECK_CATEGORY: Readonly<Record<string, WorkloadDefinition>> = {
  exchange: { key: "exchange", label: "Exchange Online" },
  sharepoint: { key: "sharepoint", label: "SharePoint & OneDrive" },
  // OneDrive rides on the SharePoint service (see the service-plan map above) —
  // folding its check category into the same workload is the same fact about
  // Microsoft's own provisioning, not an invented merge.
  onedrive: { key: "sharepoint", label: "SharePoint & OneDrive" },
  teams: { key: "teams", label: "Teams" },
  security: { key: "security", label: "Security (Defender)" },
  identity: { key: "icam", label: "Identity & Access (Entra ID)" },
  devices: { key: "endpoint", label: "Endpoint Management (Intune)" },
};

/**
 * Resolves a `monitor_checks.key` (e.g. "identity:mfa-registration") to the
 * workload whose Ownership/RACI matrix row carries risk-acceptance authority
 * for it. Null for a check with no category prefix, or a category this map
 * does not cover.
 */
export function resolveWorkloadForCheckKey(checkKey: string): WorkloadDefinition | null {
  const prefix = checkKey.split(":")[0] ?? "";
  return prefix ? (WORKLOAD_BY_CHECK_CATEGORY[prefix] ?? null) : null;
}

export interface EnabledServicePlanRow {
  readonly servicePlanId: string;
  readonly servicePlanName: string;
  readonly servicePlanType: string | null;
  readonly skuPartNumber: string;
  readonly skuId: string;
  readonly provisioningStatus: string;
}

/**
 * Parses a stored `/subscribedSkus` Graph page down to the enabled
 * (`provisioningStatus === "Success"`) service plans across every SKU. Mirrors
 * `unusedSeatsFromSubscribedSkus` in license-waste-source.ts: only the FIRST
 * page is ever persisted, so a page carrying `@odata.nextLink` is a truncated
 * estate and is refused outright rather than silently underreporting which
 * workloads are enabled.
 *
 * A service plan bundled into more than one of the tenant's SKUs (a real,
 * common case — e.g. Exchange riding on both a base and an add-on SKU)
 * appears once, keyed by its own `servicePlanId`: the first SKU that carries
 * it wins, which is an arbitrary but stable tiebreak within one page.
 */
export function parseEnabledServicePlans(rawResponse: unknown): EnabledServicePlanRow[] {
  if (!rawResponse || typeof rawResponse !== "object") return [];
  const page = rawResponse as Record<string, unknown>;

  const nextLink = page["@odata.nextLink"];
  if (typeof nextLink === "string" && nextLink.length > 0) return [];

  const items = Array.isArray(page.value)
    ? page.value
    : Array.isArray(rawResponse)
      ? (rawResponse as unknown[])
      : null;
  if (!items) return [];

  const byPlanId = new Map<string, EnabledServicePlanRow>();
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const sku = item as Record<string, unknown>;
    const skuPartNumber = typeof sku.skuPartNumber === "string" ? sku.skuPartNumber : null;
    const skuId = typeof sku.skuId === "string" ? sku.skuId : null;
    if (!skuPartNumber || !skuId) continue;
    const plans = Array.isArray(sku.servicePlans) ? sku.servicePlans : [];

    for (const p of plans) {
      if (!p || typeof p !== "object") continue;
      const plan = p as Record<string, unknown>;
      const servicePlanId = typeof plan.servicePlanId === "string" ? plan.servicePlanId : null;
      const servicePlanName = typeof plan.servicePlanName === "string" ? plan.servicePlanName : null;
      const provisioningStatus = typeof plan.provisioningStatus === "string" ? plan.provisioningStatus : null;
      if (!servicePlanId || !servicePlanName || provisioningStatus !== ENABLED_PROVISIONING_STATUS) continue;
      if (byPlanId.has(servicePlanId)) continue;

      byPlanId.set(servicePlanId, {
        servicePlanId,
        servicePlanName,
        servicePlanType: typeof plan.servicePlanType === "string" ? plan.servicePlanType : null,
        skuPartNumber,
        skuId,
        provisioningStatus,
      });
    }
  }
  return [...byPlanId.values()];
}

export interface WorkloadGroup {
  readonly key: string;
  readonly label: string;
  /** The real servicePlanName(s) that put this workload on the tenant. */
  readonly servicePlanNames: readonly string[];
}

/**
 * Groups already-enabled service-plan rows (however sourced — the live sync
 * below, or a caller's own read of `tenant_service_plans`) into one row per
 * workload key. A plan whose name resolves to no workload (see
 * `resolveWorkloadForServicePlan`) contributes nothing, on purpose.
 */
export function groupEnabledServicePlansByWorkload(
  rows: readonly { servicePlanName: string }[],
): WorkloadGroup[] {
  const byKey = new Map<string, { key: string; label: string; servicePlanNames: string[] }>();
  for (const row of rows) {
    const def = resolveWorkloadForServicePlan(row.servicePlanName);
    if (!def) continue;
    const existing = byKey.get(def.key);
    if (existing) {
      if (!existing.servicePlanNames.includes(row.servicePlanName)) {
        existing.servicePlanNames.push(row.servicePlanName);
      }
    } else {
      byKey.set(def.key, { key: def.key, label: def.label, servicePlanNames: [row.servicePlanName] });
    }
  }
  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** Latest complete stored `/subscribedSkus` page for one M365 tenant, across every candidate check. */
async function latestSubscribedSkusPage(
  tenantId: string,
): Promise<{ rawResponse: unknown; collectedAt: Date | null; checkKey: string } | null> {
  const candidates = await subscribedSkusCheckKeys().catch((err) => {
    log.warn({ err, tenantId }, "latestSubscribedSkusPage: /subscribedSkus check discovery failed");
    return [] as string[];
  });
  if (candidates.length === 0) return null;

  const [row] = await db
    .select({
      checkKey: tenantMonitorProfilesTable.checkKey,
      rawResponse: tenantMonitorProfilesTable.rawResponse,
      collectedAt: tenantMonitorProfilesTable.collectedAt,
    })
    .from(tenantMonitorProfilesTable)
    .where(
      and(
        eq(tenantMonitorProfilesTable.tenantId, tenantId),
        inArray(tenantMonitorProfilesTable.checkKey, candidates),
      ),
    )
    .orderBy(desc(tenantMonitorProfilesTable.collectedAt))
    .limit(1);
  if (!row) return null;
  return { rawResponse: row.rawResponse, collectedAt: row.collectedAt ?? null, checkKey: row.checkKey };
}

export interface SyncTenantServicePlansResult {
  readonly synced: boolean;
  readonly reason?: string;
  readonly count: number;
}

/**
 * Refreshes `tenant_service_plans` for one M365 tenant from its already-stored
 * `/subscribedSkus` page — a full REPLACE per (mspId, tenantId), not an
 * incremental upsert, so a plan that lapsed out of "Success" since the last
 * sync is gone rather than left stale. No live Graph call is made here; the
 * caller (monitor-executor.ts, after a package run that included a
 * /subscribedSkus check) is what keeps the underlying data fresh.
 *
 * Returns `synced: false` (never throws for an ordinary absence) when there is
 * no `tenants` row for this Graph tenant id yet, or no `/subscribedSkus` page
 * has ever been collected for it — both real, unexceptional states for a
 * tenant this early in onboarding.
 */
export async function syncTenantServicePlans(tenantId: string): Promise<SyncTenantServicePlansResult> {
  const [tenantRow] = await db
    .select({ mspId: tenantsTable.mspId })
    .from(tenantsTable)
    .where(eq(tenantsTable.tenantId, tenantId))
    .limit(1);
  if (!tenantRow) {
    log.info({ tenantId }, "syncTenantServicePlans: no tenants row for this M365 tenant id — skipped");
    return { synced: false, reason: "no_tenant_row", count: 0 };
  }
  const mspId = tenantRow.mspId;

  const page = await latestSubscribedSkusPage(tenantId);
  if (!page) {
    log.info({ tenantId, mspId }, "syncTenantServicePlans: no stored /subscribedSkus page yet — nothing to sync");
    return { synced: false, reason: "no_subscribed_skus_page", count: 0 };
  }

  const enabled = parseEnabledServicePlans(page.rawResponse);
  const collectedAt = page.collectedAt ?? new Date();

  await db.transaction(async (tx) => {
    await tx
      .delete(tenantServicePlansTable)
      .where(and(eq(tenantServicePlansTable.mspId, mspId), eq(tenantServicePlansTable.tenantId, tenantId)));
    if (enabled.length > 0) {
      await tx.insert(tenantServicePlansTable).values(
        enabled.map((row) => ({
          mspId,
          tenantId,
          servicePlanId: row.servicePlanId,
          servicePlanName: row.servicePlanName,
          servicePlanType: row.servicePlanType,
          skuPartNumber: row.skuPartNumber,
          skuId: row.skuId,
          provisioningStatus: row.provisioningStatus,
          collectedAt,
        })),
      );
    }
  });

  log.info(
    { tenantId, mspId, checkKey: page.checkKey, count: enabled.length },
    "syncTenantServicePlans: synced enabled service plans",
  );
  return { synced: true, count: enabled.length };
}
