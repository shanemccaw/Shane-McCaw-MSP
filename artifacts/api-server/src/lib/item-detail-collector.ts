/**
 * item-detail-collector.ts
 *
 * Runs the `detail:full-item-collection` monitoring package: the same real
 * checks the scoring scan runs, but with `includeItems: true`, persisting each
 * check's COMPLETE item list to tenant_check_item_details (#339).
 *
 * WHY THIS IS A SEPARATE RUNNER AND NOT A FLAG ON THE SCORING SCAN
 *   monitor-executor already computes the full item list on every check — that
 *   is how the count/score is derived — and then discards it unless the caller
 *   asks for it, on purpose, so the hot path retains no extra memory. And
 *   tenant_monitor_profiles.rawResponse deliberately keeps only the first page
 *   (five rows for a CSV report), so it can't stand in for a full list either.
 *   Remediation documents promise to list ALL affected items, so something has
 *   to keep the whole list — but making the scoring scan keep it would put that
 *   cost on every scan for every check nobody ever asks about.
 *
 *   The resolution (issue #339's final decision): the scoring scan is left
 *   exactly as it is, and this runs as its own real package, in PARALLEL, so the
 *   data is already collected by the time a document or a War Room per-item
 *   dialog needs it — the same concurrency shape the conversational quiz already
 *   uses alongside the main scan.
 *
 * NON-INTERFERENCE — the four things that keep this off the scoring path:
 *   1. Its own triggerId. The executor's idempotency key is
 *      "{tenantId}:{checkKey}:{triggerId}". Reusing the scoring run's triggerId
 *      would hand back that run's cached, item-LESS result — a silently empty
 *      item list. A distinct id is what makes this a real, separate fetch.
 *   2. Its own package (`engines: []`), so no engine recompute is triggered and
 *      it can never feed a score.
 *   3. It never awaits, blocks, or writes to anything the scoring run reads to
 *      build findings. `executeMonitorCheck` still writes its normal
 *      tenant_monitor_profiles row here (the same additive arrangement
 *      simulator_check_runs already relies on), which is a second collection of
 *      the same check, honestly recorded — not a mutation of the scan's rows.
 *   4. It never throws at its caller. Every failure mode resolves to a result
 *      object; the caller fires it and forgets it.
 *
 * THE TRUNCATION RULE: a persisted row holds the FULL item list or none of it
 * and says why. A prefix is never stored — a remediation document built from a
 * silent prefix would confidently under-report affected items, which is exactly
 * the failure this whole mechanism exists to prevent.
 */

import { randomUUID } from "crypto";
import { db, tenantCheckItemDetailsTable } from "@workspace/db";
import { executeMonitorCheck, loadOrderedPackageChecks, type CheckResult } from "./monitor-executor";
import { logger } from "./logger";

const log = logger.child({ channel: "engine.monitor" });

/** The real monitoring_packages row this collector runs (see the #339 migration). */
export const ITEM_DETAIL_PACKAGE_KEY = "detail:full-item-collection";

/**
 * Hard ceiling on the serialized item payload a single check row will persist
 * (~16 MB — the same bound simulator_check_runs uses, for the same reason).
 * Above it the items are omitted ENTIRELY and flagged, never trimmed to fit.
 */
export const MAX_PERSISTED_ITEM_BYTES = 16 * 1024 * 1024;

export interface ItemDetailRunResult {
  runId: string;
  packageKey: string;
  tenantId: string;
  /**
   * "no_checks"       — package missing/inactive, or no checks linked to it.
   * "consent_revoked" — a check hit a revoked grant; the run stopped there.
   * "partial"         — ran every check, but at least one produced no usable
   *                     item list (error, or a payload too large to store whole).
   * "completed"       — every covered check landed a real, complete row.
   */
  status: "completed" | "partial" | "no_checks" | "consent_revoked";
  /** Checks this run actually attempted. */
  checksTotal: number;
  /** Checks whose COMPLETE item list was persisted (may legitimately be 0 items). */
  checksWithItems: number;
  /** Checks whose payload exceeded the persistence ceiling and were stored as omitted. */
  checksOmitted: number;
  /** Checks that produced no item list at all (error / consent_revoked / requires_script). */
  checksWithoutItems: number;
  /** Total items persisted across every check in this run. */
  itemsPersisted: number;
  startedAt: string;
  completedAt: string;
}

/** JSON byte length, or null when the value can't be serialized at all. */
function safeByteLength(value: unknown): number | null {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
  } catch {
    return null;
  }
}

/**
 * Collects and persists the full per-check item lists for one tenant.
 *
 * Fire-and-forget by design: it resolves rather than rejects on every failure
 * path, so a caller can `void` it alongside the scoring scan without a
 * `.catch()` being load-bearing.
 *
 * Checks run SEQUENTIALLY, mirroring executeMonitoringPackage. This is a second
 * pass over the tenant's Graph surface running concurrently with the scoring
 * scan, and fanning it out in parallel on top of that is how a tenant earns a
 * 429 — the parallelism that matters here is against the scan, not within.
 */
export async function runItemDetailCollection(opts: {
  tenantId: string;
  customerId?: number | null;
  packageKey?: string;
  /**
   * The scoring run this collection was fired alongside. Correlation for the
   * logs only — this collector never reads or writes that run's rows.
   */
  parallelToRunId?: string;
}): Promise<ItemDetailRunResult> {
  const { tenantId, customerId = null, packageKey = ITEM_DETAIL_PACKAGE_KEY, parallelToRunId } = opts;
  const runId = randomUUID();
  // Distinct from any scoring run's `diag-run-{runId}` — see NON-INTERFERENCE #1.
  const triggerId = `item-detail-${runId}`;
  const startedAt = new Date().toISOString();

  const done = (status: ItemDetailRunResult["status"], counts: {
    checksTotal: number;
    checksWithItems: number;
    checksOmitted: number;
    checksWithoutItems: number;
    itemsPersisted: number;
  }): ItemDetailRunResult => ({
    runId,
    packageKey,
    tenantId,
    status,
    ...counts,
    startedAt,
    completedAt: new Date().toISOString(),
  });

  const empty = { checksTotal: 0, checksWithItems: 0, checksOmitted: 0, checksWithoutItems: 0, itemsPersisted: 0 };

  let checks;
  try {
    const loaded = await loadOrderedPackageChecks(packageKey);
    if (!loaded.pkg || loaded.linkedCheckCount === 0) {
      // Loud, not silent: a missing package or an unpopulated junction means
      // every remediation document downstream will find no detail rows, and the
      // only symptom would otherwise be an empty table.
      log.warn(
        { tenantId, packageKey, packageFound: loaded.pkg != null, parallelToRunId },
        "item-detail-collector: no checks to collect — package missing/inactive or has no linked checks (see the #339 migration)",
      );
      return done("no_checks", empty);
    }
    checks = loaded.checks;
  } catch (err) {
    log.error({ err, tenantId, packageKey, parallelToRunId }, "item-detail-collector: failed to load the detail package");
    return done("no_checks", empty);
  }

  log.info(
    { runId, tenantId, customerId, packageKey, checkCount: checks.length, parallelToRunId },
    "item-detail-collector: full-item collection started (parallel to the scoring scan)",
  );

  let checksTotal = 0;
  let checksWithItems = 0;
  let checksOmitted = 0;
  let checksWithoutItems = 0;
  let itemsPersisted = 0;
  let consentRevoked = false;

  for (const check of checks) {
    checksTotal++;
    let result: CheckResult;
    try {
      result = await executeMonitorCheck({ check, tenantId, triggerId, includeItems: true });
    } catch (err) {
      // executeMonitorCheck returns statuses rather than throwing, but a genuine
      // throw here must cost this run one check, not the whole collection.
      log.error({ err, runId, tenantId, checkKey: check.key }, "item-detail-collector: check threw — skipping");
      checksWithoutItems++;
      continue;
    }

    // A revoked grant fails every remaining check for this tenant identically —
    // stop rather than spend the rest of the package proving it 132 more times.
    if (result.status === "consent_revoked") consentRevoked = true;

    const items = result.items;
    let persistedItems: unknown[] | null = null;
    let itemsOmitted = false;
    let itemsOmittedReason: string | null = null;

    if (Array.isArray(items)) {
      const bytes = safeByteLength(items);
      if (bytes == null) {
        itemsOmitted = true;
        itemsOmittedReason = "The captured item list could not be serialized for storage (circular or non-JSON value).";
      } else if (bytes > MAX_PERSISTED_ITEM_BYTES) {
        // Store none of it rather than a prefix that would make a remediation
        // document under-report affected items while looking complete.
        itemsOmitted = true;
        itemsOmittedReason =
          `The captured item list was ${Math.round(bytes / (1024 * 1024))} MB across ${items.length} item(s), ` +
          `over the ${Math.round(MAX_PERSISTED_ITEM_BYTES / (1024 * 1024))} MB persistence limit. ` +
          `It was NOT stored in part — a partial list would make a remediation document under-report. ` +
          `This check needs per-check handling before its full detail can be relied on.`;
      } else {
        persistedItems = items;
      }
    }

    try {
      await db
        .insert(tenantCheckItemDetailsTable)
        .values({
          runId,
          tenantId,
          customerId,
          checkKey: result.checkKey,
          checkSchemaVersion: check.schemaVersion,
          packageKey,
          triggerId,
          profileId: result.profileId ?? null,
          status: result.status,
          itemCount: result.itemCount,
          pageCount: result.pageCount,
          items: persistedItems,
          itemsOmitted,
          itemsOmittedReason,
          errorMessage: result.errorMessage ?? null,
        })
        .onConflictDoNothing();
    } catch (err) {
      log.error({ err, runId, tenantId, checkKey: result.checkKey }, "item-detail-collector: failed to persist item detail row");
      checksWithoutItems++;
      if (consentRevoked) break;
      continue;
    }

    if (itemsOmitted) {
      checksOmitted++;
      log.warn({ runId, tenantId, checkKey: result.checkKey, itemCount: result.itemCount }, itemsOmittedReason ?? "items omitted");
    } else if (persistedItems) {
      checksWithItems++;
      itemsPersisted += persistedItems.length;
    } else {
      // No item list came back at all: error, consent_revoked, requires_script,
      // or a license gap. The row is still written, so "we have no detail for
      // this check, and here is why" is answerable from the table itself.
      checksWithoutItems++;
    }

    if (consentRevoked) break;
  }

  const status: ItemDetailRunResult["status"] = consentRevoked
    ? "consent_revoked"
    : checksWithoutItems > 0 || checksOmitted > 0
      ? "partial"
      : "completed";

  const counts = { checksTotal, checksWithItems, checksOmitted, checksWithoutItems, itemsPersisted };
  log.info({ runId, tenantId, packageKey, status, ...counts, parallelToRunId }, "item-detail-collector: full-item collection finished");
  return done(status, counts);
}
