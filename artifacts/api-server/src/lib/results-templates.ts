/**
 * results-templates.ts
 *
 * Shared lookup for the results_templates registry table — the admin-editable
 * mapping of each assessment product (services row) to one of the 4 fixed
 * Results Template families (pillar_scored / framework_gap_list /
 * readiness_logistics / copilot), modeled on document-types.ts.
 *
 * This is the TYPE REGISTRY only (family, config, narrative copy hints).
 * Rendering the assessment results page against this registry is a separate
 * phase (#163) and does not live in this module.
 */

import { db, resultsTemplatesTable, type ResultsTemplate, type ResultsTemplateFamily } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { logger } from "./logger";
const log = logger.child({ channel: "engine.assessment-results" });

/** In-process cache — results templates change rarely and are read on every results-page load. */
let cache: { rows: ResultsTemplate[]; loadedAt: number } | null = null;
const CACHE_TTL_MS = 30_000;

async function loadAll(): Promise<ResultsTemplate[]> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.rows;
  try {
    const rows = await db.select().from(resultsTemplatesTable).orderBy(asc(resultsTemplatesTable.sortOrder));
    cache = { rows, loadedAt: Date.now() };
    return rows;
  } catch (err) {
    log.warn({ err }, "results-templates: DB lookup failed");
    return cache?.rows ?? [];
  }
}

/** Invalidate the cache — call after any create/update/deactivate through the admin routes. */
export function invalidateResultsTemplateCache(): void {
  cache = null;
}

/** Fetch a single results template by its own key, active or not. Returns null if unknown. */
export async function getResultsTemplate(key: string): Promise<ResultsTemplate | null> {
  const rows = await loadAll();
  return rows.find((r) => r.key === key) ?? null;
}

/** Fetch the results template mapped to a given assessment product (services.id). Returns null if unmapped. */
export async function getResultsTemplateForService(serviceId: number): Promise<ResultsTemplate | null> {
  const rows = await loadAll();
  return rows.find((r) => r.serviceId === serviceId) ?? null;
}

/** All results templates, optionally filtered to a family, ordered by sortOrder. */
export async function listResultsTemplates(family?: ResultsTemplateFamily): Promise<ResultsTemplate[]> {
  const rows = await loadAll();
  return family ? rows.filter((r) => r.family === family) : rows;
}

/** True if `serviceId` has an active results template mapped, optionally scoped to a family. */
export async function isActiveResultsTemplateForService(serviceId: number, family?: ResultsTemplateFamily): Promise<boolean> {
  const row = await getResultsTemplateForService(serviceId);
  return !!row && row.isActive && (!family || row.family === family);
}

/** Direct DB read (bypasses cache) for admin routes that need read-your-writes consistency. */
export async function getResultsTemplateByServiceIdFresh(serviceId: number): Promise<ResultsTemplate | null> {
  const [row] = await db
    .select()
    .from(resultsTemplatesTable)
    .where(eq(resultsTemplatesTable.serviceId, serviceId))
    .limit(1);
  return row ?? null;
}
