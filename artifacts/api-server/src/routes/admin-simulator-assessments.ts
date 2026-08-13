/**
 * admin-simulator-assessments.ts
 *
 * Read-only catalog + packageKey audit for the Simulator Studio's "Assessments"
 * node (simulator-studio-assessments Phase 1, Issue #23). Lists every
 * `services` row with `category = 'assessment'` and, for each, resolves the
 * SAME packageKey path `consent.ts` uses at scan time
 * (`services.type_attributes->>'packageKey'`, falling back to
 * `core:security-baseline` when absent) — plus, for a service with a real
 * dedicated packageKey, that package's ordered `monitoring_package_checks`
 * list, so an operator can see exactly what a purchase of that assessment
 * will scan without reading SQL.
 *
 * Deliberately NOT here (later phases, not yet built): create/edit/delete of
 * the packageKey assignment or of monitoring packages themselves.
 *
 * Routes:
 *   GET /api/admin/simulator/assessments
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { servicesTable, monitoringPackageChecksTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
const log = logger.child({ channel: "engine.monitor" });

const router: IRouter = Router();

// The canonical fallback every assessment scan runs against when its product
// carries no dedicated packageKey — mirrors consent.ts's resolvedPackageKey.
export const CORE_SECURITY_BASELINE_FALLBACK = "core:security-baseline";

export interface SimulatorAssessmentNode {
  id: number;
  name: string;
  slug: string | null;
  isFreeOffering: boolean;
  /** Real services.sort_order — surfaced so the Phase 5 creation wizard can
   *  default a new assessment's sortOrder to max(existing) + 1 without a
   *  second fetch of the full services catalog. */
  sortOrder: number;
  /** Real services.visibility — "private" is how Phase 7's Deprecate action
   *  unpublishes an assessment (PUT /admin/services/:id) without deleting
   *  the row. Surfaced so the tree can flag a deprecated assessment without
   *  a second fetch. */
  visibility: "public" | "private" | "landing_page_only";
  /** The real dedicated packageKey, or null when this assessment has none and
   *  runs on the core:security-baseline fallback at scan time. */
  packageKey: string | null;
  hasDedicatedPackage: boolean;
  /** Ordered check_key list for `packageKey`'s monitoring_package_checks rows.
   *  Null when hasDedicatedPackage is false — there is nothing to join. */
  checkKeys: string[] | null;
  checkCount: number | null;
}

router.get("/admin/simulator/assessments", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select({
        id: servicesTable.id,
        name: servicesTable.name,
        slug: servicesTable.slug,
        isFreeOffering: servicesTable.isFreeOffering,
        sortOrder: servicesTable.sortOrder,
        visibility: servicesTable.visibility,
        typeAttributes: servicesTable.typeAttributes,
      })
      .from(servicesTable)
      .where(eq(servicesTable.category, "assessment"));

    const withPackageKey = rows.map((row) => {
      const packageKey =
        typeof row.typeAttributes?.["packageKey"] === "string"
          ? (row.typeAttributes["packageKey"] as string)
          : null;
      return { ...row, packageKey };
    });

    const dedicatedPackageKeys = Array.from(
      new Set(withPackageKey.map((r) => r.packageKey).filter((k): k is string => k != null)),
    );

    const checkLinks =
      dedicatedPackageKeys.length > 0
        ? await db
            .select({
              packageKey: monitoringPackageChecksTable.packageKey,
              checkKey: monitoringPackageChecksTable.checkKey,
              sortOrder: monitoringPackageChecksTable.sortOrder,
            })
            .from(monitoringPackageChecksTable)
            .where(inArray(monitoringPackageChecksTable.packageKey, dedicatedPackageKeys))
        : [];

    const checksByPackage = new Map<string, string[]>();
    for (const link of [...checkLinks].sort((a, b) => a.sortOrder - b.sortOrder)) {
      const existing = checksByPackage.get(link.packageKey) ?? [];
      existing.push(link.checkKey);
      checksByPackage.set(link.packageKey, existing);
    }

    const assessments: SimulatorAssessmentNode[] = withPackageKey.map((row) => {
      const hasDedicatedPackage = row.packageKey != null;
      const checkKeys = hasDedicatedPackage ? (checksByPackage.get(row.packageKey!) ?? []) : null;
      return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        isFreeOffering: row.isFreeOffering,
        sortOrder: row.sortOrder,
        visibility: row.visibility,
        packageKey: row.packageKey,
        hasDedicatedPackage,
        checkKeys,
        checkCount: checkKeys != null ? checkKeys.length : null,
      };
    });

    res.json({ assessments });
  } catch (err) {
    log.error({ err }, "admin-simulator-assessments: list failed");
    res.status(500).json({ error: "Failed to list assessment catalog" });
  }
});

export default router;
