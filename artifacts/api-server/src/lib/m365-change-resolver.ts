/**
 * m365-change-resolver.ts — the M365 Changes RESOLUTION layer (Git #1533, part
 * of #1494).
 *
 * #1494's split: interpretation is universal, resolution is per-tenant. A
 * confirmed interpretation (m365_change_interpretations, #1532) names WHAT to
 * count; this module runs that count against ONE tenant's real estate and
 * returns a NUMBER — "you have 412 mailboxes with EWS enabled". The number is
 * the hinge: zero affected objects = the post is noise for that customer;
 * non-zero with a deadline = the routing trigger.
 *
 * ── No second probe mechanism ─────────────────────────────────────────────
 * Every number comes from infrastructure that already exists:
 *
 *   • `probe.monitorCheckKey` → a `monitor_checks` row. The latest stored
 *     `tenant_monitor_profiles` result is preferred (the daily scans already
 *     paid for it); a live `executeMonitorCheck` run is the fallback when the
 *     caller allows it. Live execution dispatches by the check's OWN
 *     executorType — Graph, the ca-ps-execution PowerShell container,
 *     sharepoint-admin, or dns — so the Exchange/Purview cases where Graph
 *     will not answer ride the existing PowerShell path with nothing new
 *     built here.
 *   • `touches.skus` → `license_assignment_snapshots` (#1291), the per-user ×
 *     per-SKU register. Covers the SKU cases — Project Online retiring while
 *     the tenant holds the licence — by counting the users actually holding a
 *     matched SKU in the latest snapshot run.
 *
 * ── Zero is only ever a MEASURED zero ─────────────────────────────────────
 * Where no probe exists, or the probe could not answer for THIS tenant, the
 * outcome is `not_measured` with a structured reason — NEVER zero. The portal
 * keeps its honest wording ("your tenant has not been read against this
 * notice") for exactly those rows. A SKU name that matches nothing in the
 * tenant's subscribed catalog is `sku_not_mapped`, not "zero users": free-text
 * naming failure and genuine absence are indistinguishable there, and guessing
 * zero is the lie this module exists to avoid.
 *
 * ── The confirmation gate ─────────────────────────────────────────────────
 * Only a `confirmed` interpretation is ever resolved (#1532's gate). The
 * entry points refuse anything else outright.
 */

import {
  db,
  licenseAssignmentSnapshotsTable,
  m365ChangeInterpretationsTable,
  m365ChangeResolutionsTable,
  monitorChecksTable,
  tenantMonitorProfilesTable,
  tenantsTable,
  type M365ChangeInterpretation,
  type M365ResolutionBasis,
  type M365ResolutionBasisDetail,
  type M365ResolutionStatus,
} from "@workspace/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { executeMonitorCheck } from "./monitor-executor";
import { resolveSubscribedSkuCatalog, type SubscribedSkuCatalogEntry } from "./license-waste-source";
import { logger } from "./logger";

const log = logger.child({ channel: "integration.azure" });

/**
 * How old a stored tenant_monitor_profiles row may be and still serve as the
 * count. Checks run on hourly/daily cadences but not every tenant is scanned
 * every day; a week-old real count still beats "not measured", and the row's
 * own collectedAt rides along in basisDetail so a consumer can show staleness
 * honestly instead of this module deciding silence is better.
 */
const MAX_STORED_PROFILE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** The tenant a resolution runs against — same shape portal-customer-scope resolves. */
export interface ResolutionScope {
  readonly customerId: number;
  readonly mspId: number;
  /** M365 tenant GUID — guaranteed non-blank by the caller. */
  readonly tenantId: string;
}

/** One computed answer, ready to persist. */
export interface ResolutionOutcome {
  status: M365ResolutionStatus;
  /** NULL unless status = 'measured' — a not-measured answer is never zero. */
  affectedCount: number | null;
  basis: M365ResolutionBasis | null;
  basisDetail: M365ResolutionBasisDetail;
  errorMessage: string | null;
  measuredAt: Date | null;
}

function notMeasured(detail: M365ResolutionBasisDetail): ResolutionOutcome {
  return { status: "not_measured", affectedCount: null, basis: null, basisDetail: detail, errorMessage: null, measuredAt: null };
}

// ── SKU matching (pure, unit-tested) ─────────────────────────────────────────

/** Lowercase, alphanumerics only — "Project Online Plan 1" ≡ "PROJECTONLINE_PLAN_1"'s stem. */
export function normalizeSkuName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Minimum normalized length before containment (rather than exact equality)
 * counts as a match. Stops "E5" from matching every SKU with an E5 tier in its
 * part number while still letting "Project Online" find PROJECTONLINE_PLAN_1.
 */
const MIN_CONTAINMENT_LENGTH = 6;

/**
 * Match an interpretation's free-text `touches.skus` entries against the
 * tenant's real subscribed-SKU catalog. An entry matches on: exact normalized
 * equality with the skuPartNumber, exact equality with the skuId GUID, or
 * normalized containment either way when both sides are long enough to make
 * containment meaningful. Unmatched entries are returned, not guessed at.
 */
export function matchSkusToCatalog(
  names: readonly string[],
  catalog: readonly SubscribedSkuCatalogEntry[],
): { matched: Record<string, string>; unmatched: string[] } {
  const matched: Record<string, string> = {};
  const unmatched: string[] = [];

  for (const name of names) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const norm = normalizeSkuName(trimmed);
    let hit: SubscribedSkuCatalogEntry | null = null;
    for (const entry of catalog) {
      const normPart = normalizeSkuName(entry.skuPartNumber);
      const normId = normalizeSkuName(entry.skuId);
      if (norm === normPart || norm === normId) {
        hit = entry;
        break;
      }
      if (
        norm.length >= MIN_CONTAINMENT_LENGTH &&
        normPart.length >= MIN_CONTAINMENT_LENGTH &&
        (normPart.includes(norm) || norm.includes(normPart))
      ) {
        hit = entry;
        break;
      }
    }
    if (hit) matched[hit.skuPartNumber] = hit.skuId;
    else unmatched.push(trimmed);
  }

  return { matched, unmatched };
}

// ── Probe path 1: monitor_checks ─────────────────────────────────────────────

async function resolveViaMonitorCheck(opts: {
  checkKey: string;
  scope: ResolutionScope;
  interpretationId: number;
  allowLive: boolean;
}): Promise<ResolutionOutcome> {
  const { checkKey, scope, interpretationId, allowLive } = opts;

  const [check] = await db
    .select()
    .from(monitorChecksTable)
    .where(and(eq(monitorChecksTable.key, checkKey), eq(monitorChecksTable.status, "active")))
    .limit(1);
  if (!check) {
    log.warn({ checkKey, interpretationId }, "m365-change-resolver: probe names a monitor check that does not exist or is archived");
    return notMeasured({ checkKey, reason: "check_not_found" });
  }

  // Preferred: the latest stored profile — the daily scans already produced it.
  const [profile] = await db
    .select({
      status: tenantMonitorProfilesTable.status,
      itemCount: tenantMonitorProfilesTable.itemCount,
      collectedAt: tenantMonitorProfilesTable.collectedAt,
    })
    .from(tenantMonitorProfilesTable)
    .where(
      and(
        eq(tenantMonitorProfilesTable.tenantId, scope.tenantId),
        eq(tenantMonitorProfilesTable.checkKey, checkKey),
        inArray(tenantMonitorProfilesTable.status, ["ok", "partial"]),
      ),
    )
    .orderBy(desc(tenantMonitorProfilesTable.collectedAt))
    .limit(1);

  const now = Date.now();
  if (profile && profile.itemCount !== null && now - profile.collectedAt.getTime() <= MAX_STORED_PROFILE_AGE_MS) {
    return {
      status: "measured",
      affectedCount: profile.itemCount,
      basis: "monitor_check",
      basisDetail: {
        checkKey,
        live: false,
        profileStatus: profile.status,
        collectedAt: profile.collectedAt.toISOString(),
      },
      errorMessage: null,
      measuredAt: new Date(),
    };
  }

  if (!allowLive) {
    return notMeasured({ checkKey, reason: "no_stored_profile" });
  }

  // Live run. persistProfile: false is a CORRECTNESS requirement, not an
  // optimisation — tenant_monitor_profiles is read unscoped as the tenant's
  // live per-check signal, so a resolution pass writing to it would silently
  // become the score (#543). skipIdempotency because the triggerId is unique
  // per invocation anyway and a cached row is exactly what we just ruled out.
  const result = await executeMonitorCheck({
    check,
    tenantId: scope.tenantId,
    triggerId: `m365res:${interpretationId}:${now}`,
    skipIdempotency: true,
    persistProfile: false,
  });

  if (result.status === "ok" || result.status === "partial") {
    return {
      status: "measured",
      affectedCount: result.itemCount,
      basis: "monitor_check",
      basisDetail: { checkKey, live: true, profileStatus: result.status },
      errorMessage: null,
      measuredAt: new Date(),
    };
  }
  if (result.status === "license_gap") return notMeasured({ checkKey, live: true, reason: "license_gap" });
  // #1847 — the service behind the probe does not answer for this tenant. Not
  // measured, and specifically NOT an affectedCount of 0.
  if (result.status === "service_not_configured") {
    return notMeasured({ checkKey, live: true, reason: "service_not_configured" });
  }
  if (result.status === "consent_revoked") return notMeasured({ checkKey, live: true, reason: "consent_revoked" });
  if (result.status === "requires_script") return notMeasured({ checkKey, live: true, reason: "requires_script" });

  return {
    status: "error",
    affectedCount: null,
    basis: null,
    basisDetail: { checkKey, live: true },
    errorMessage: result.errorMessage ?? "monitor check execution failed",
    measuredAt: null,
  };
}

// ── Probe path 2: license_assignment_snapshots ───────────────────────────────

async function resolveViaLicenseSnapshots(opts: {
  skuNames: readonly string[];
  scope: ResolutionScope;
}): Promise<ResolutionOutcome> {
  const { skuNames, scope } = opts;

  const catalog = await resolveSubscribedSkuCatalog(scope.tenantId);
  if (!catalog) return notMeasured({ reason: "no_sku_data" });

  const { matched, unmatched } = matchSkusToCatalog(skuNames, catalog.skus);
  const matchedIds = Object.values(matched);
  if (matchedIds.length === 0) {
    // Free-text naming failure and genuine absence are indistinguishable here —
    // "not measured", never a guessed zero. `unmatchedSkus` gives the admin the
    // exact strings to fix into real part numbers.
    return notMeasured({ unmatchedSkus: unmatched, reason: "sku_not_mapped" });
  }

  // The latest snapshot run for this tenant, then the distinct users holding a
  // matched SKU inside it. A run that contains no matched row is a REAL zero:
  // the SKU is subscribed (it matched the catalog) but assigned to nobody.
  const [latestRun] = await db
    .select({
      runId: licenseAssignmentSnapshotsTable.runId,
      collectedAt: licenseAssignmentSnapshotsTable.collectedAt,
    })
    .from(licenseAssignmentSnapshotsTable)
    .where(eq(licenseAssignmentSnapshotsTable.tenantId, scope.tenantId))
    .orderBy(desc(licenseAssignmentSnapshotsTable.collectedAt))
    .limit(1);

  if (latestRun) {
    const [row] = await db
      .select({ n: sql<number>`count(distinct ${licenseAssignmentSnapshotsTable.userId})`.mapWith(Number) })
      .from(licenseAssignmentSnapshotsTable)
      .where(
        and(
          eq(licenseAssignmentSnapshotsTable.tenantId, scope.tenantId),
          eq(licenseAssignmentSnapshotsTable.runId, latestRun.runId),
          inArray(licenseAssignmentSnapshotsTable.skuId, matchedIds),
        ),
      );
    return {
      status: "measured",
      affectedCount: row?.n ?? 0,
      basis: "license_snapshot",
      basisDetail: {
        matchedSkus: matched,
        ...(unmatched.length > 0 ? { unmatchedSkus: unmatched } : {}),
        snapshotRunId: latestRun.runId,
        source: "assignment_snapshot",
        collectedAt: latestRun.collectedAt.toISOString(),
      },
      errorMessage: null,
      measuredAt: new Date(),
    };
  }

  // No per-user snapshot run yet — the subscribed catalog's own consumedUnits
  // is still a real Graph-reported count of assigned seats for those SKUs.
  const matchedParts = new Set(Object.keys(matched));
  let consumed = 0;
  let anyConsumed = false;
  for (const entry of catalog.skus) {
    if (!matchedParts.has(entry.skuPartNumber)) continue;
    if (entry.consumedUnits === null) continue;
    consumed += entry.consumedUnits;
    anyConsumed = true;
  }
  if (!anyConsumed) return notMeasured({ matchedSkus: matched, reason: "no_sku_data" });

  return {
    status: "measured",
    affectedCount: consumed,
    basis: "license_snapshot",
    basisDetail: {
      matchedSkus: matched,
      ...(unmatched.length > 0 ? { unmatchedSkus: unmatched } : {}),
      source: "subscribed_skus_consumed",
      ...(catalog.collectedAt ? { collectedAt: catalog.collectedAt.toISOString() } : {}),
    },
    errorMessage: null,
    measuredAt: new Date(),
  };
}

// ── The per-tenant entry point ───────────────────────────────────────────────

/**
 * Run one CONFIRMED interpretation against one tenant. Tries the probe paths in
 * order — monitor check first (it is the deliberately-wired probe), then the
 * SKU register — and returns the first MEASURED outcome. When nothing measures,
 * an error outcome (a probe genuinely tried and failed) outranks a not-measured
 * one for visibility; with no probe at all the answer is the honest
 * `not_measured` / `no_probe`.
 */
export async function resolveInterpretationForTenant(opts: {
  interpretation: M365ChangeInterpretation;
  scope: ResolutionScope;
  /** Permit a live executeMonitorCheck run when no fresh stored profile exists. Sweeps keep this off; the admin's explicit "resolve now" turns it on. */
  allowLive?: boolean;
}): Promise<ResolutionOutcome> {
  const { interpretation, scope } = opts;
  if (interpretation.status !== "confirmed") {
    throw new Error(`Interpretation ${interpretation.id} is '${interpretation.status}' — only a confirmed interpretation may be resolved (#1532 gate)`);
  }

  const outcomes: ResolutionOutcome[] = [];

  const checkKey = interpretation.probe?.monitorCheckKey?.trim();
  if (checkKey) {
    outcomes.push(
      await resolveViaMonitorCheck({
        checkKey,
        scope,
        interpretationId: interpretation.id,
        allowLive: opts.allowLive === true,
      }),
    );
    const first = outcomes[0];
    if (first.status === "measured") return first;
  }

  const skuNames = (interpretation.touches?.skus ?? []).filter((s) => s.trim().length > 0);
  if (skuNames.length > 0) {
    const skuOutcome = await resolveViaLicenseSnapshots({ skuNames, scope });
    if (skuOutcome.status === "measured") return skuOutcome;
    outcomes.push(skuOutcome);
  }

  if (outcomes.length === 0) return notMeasured({ reason: "no_probe" });
  return outcomes.find((o) => o.status === "error") ?? outcomes[0];
}

// ── Persistence ──────────────────────────────────────────────────────────────

/** Upsert the tenant's CURRENT answer for one interpretation. */
export async function persistResolution(
  interpretation: M365ChangeInterpretation,
  scope: ResolutionScope,
  outcome: ResolutionOutcome,
): Promise<void> {
  await db
    .insert(m365ChangeResolutionsTable)
    .values({
      mspId: scope.mspId,
      customerId: scope.customerId,
      tenantId: scope.tenantId,
      interpretationId: interpretation.id,
      status: outcome.status,
      affectedCount: outcome.affectedCount,
      basis: outcome.basis,
      basisDetail: outcome.basisDetail,
      errorMessage: outcome.errorMessage,
      measuredAt: outcome.measuredAt,
    })
    .onConflictDoUpdate({
      target: [m365ChangeResolutionsTable.interpretationId, m365ChangeResolutionsTable.customerId],
      set: {
        tenantId: scope.tenantId,
        status: outcome.status,
        affectedCount: outcome.affectedCount,
        basis: outcome.basis,
        basisDetail: outcome.basisDetail,
        errorMessage: outcome.errorMessage,
        measuredAt: outcome.measuredAt,
        updatedAt: new Date(),
      },
    });
}

/** Every tenant of one MSP a resolution can run against (non-blank tenant GUID). */
async function resolvableTenantsForMsp(mspId: number): Promise<Array<ResolutionScope & { tenantName: string }>> {
  const rows = await db
    .select({
      id: tenantsTable.id,
      tenantId: tenantsTable.tenantId,
      customerName: tenantsTable.customerName,
    })
    .from(tenantsTable)
    .where(eq(tenantsTable.mspId, mspId));
  return rows
    .filter((r) => typeof r.tenantId === "string" && r.tenantId.trim().length > 0)
    .map((r) => ({
      customerId: r.id,
      mspId,
      tenantId: r.tenantId!.trim(),
      tenantName: (r.customerName ?? "").trim() || `Customer ${r.id}`,
    }));
}

export interface TenantResolutionResult {
  customerId: number;
  tenantName: string;
  outcome: ResolutionOutcome;
}

/**
 * Resolve one confirmed interpretation across the MSP's estate (or one
 * customer), persisting each answer. The admin "resolve now" surface.
 */
export async function resolveInterpretationAcrossTenants(opts: {
  interpretation: M365ChangeInterpretation;
  allowLive?: boolean;
  onlyCustomerId?: number;
}): Promise<TenantResolutionResult[]> {
  const { interpretation } = opts;
  const tenants = (await resolvableTenantsForMsp(interpretation.mspId)).filter(
    (t) => opts.onlyCustomerId === undefined || t.customerId === opts.onlyCustomerId,
  );

  const results: TenantResolutionResult[] = [];
  for (const scope of tenants) {
    let outcome: ResolutionOutcome;
    try {
      outcome = await resolveInterpretationForTenant({ interpretation, scope, allowLive: opts.allowLive });
    } catch (err) {
      outcome = {
        status: "error",
        affectedCount: null,
        basis: null,
        basisDetail: {},
        errorMessage: err instanceof Error ? err.message : String(err),
        measuredAt: null,
      };
    }
    await persistResolution(interpretation, scope, outcome);
    results.push({ customerId: scope.customerId, tenantName: scope.tenantName, outcome });
  }

  log.info(
    {
      interpretationId: interpretation.id,
      tenants: results.length,
      measured: results.filter((r) => r.outcome.status === "measured").length,
      notMeasured: results.filter((r) => r.outcome.status === "not_measured").length,
      errors: results.filter((r) => r.outcome.status === "error").length,
    },
    "m365-change-resolver: interpretation resolved across tenants",
  );
  return results;
}

/**
 * The daily sweep: every confirmed interpretation × every resolvable tenant,
 * from STORED data only (allowLive stays off — a sweep must not fan out live
 * Graph/PowerShell probes across the whole estate; the daily scans already
 * collect, this just counts). Wired in index.ts beside the other daily jobs.
 */
export async function runM365ResolutionSweep(): Promise<{ interpretations: number; resolutions: number }> {
  const confirmed = await db
    .select()
    .from(m365ChangeInterpretationsTable)
    .where(eq(m365ChangeInterpretationsTable.status, "confirmed"));

  let resolutions = 0;
  const tenantsByMsp = new Map<number, Awaited<ReturnType<typeof resolvableTenantsForMsp>>>();
  for (const interpretation of confirmed) {
    let tenants = tenantsByMsp.get(interpretation.mspId);
    if (!tenants) {
      tenants = await resolvableTenantsForMsp(interpretation.mspId);
      tenantsByMsp.set(interpretation.mspId, tenants);
    }
    for (const scope of tenants) {
      try {
        const outcome = await resolveInterpretationForTenant({ interpretation, scope, allowLive: false });
        await persistResolution(interpretation, scope, outcome);
        resolutions += 1;
      } catch (err) {
        log.warn(
          { err, interpretationId: interpretation.id, customerId: scope.customerId },
          "m365-change-resolver: sweep resolution failed for one tenant (non-fatal)",
        );
      }
    }
  }

  log.info({ interpretations: confirmed.length, resolutions }, "m365-change-resolver: sweep complete");
  return { interpretations: confirmed.length, resolutions };
}
