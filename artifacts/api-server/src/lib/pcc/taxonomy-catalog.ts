import { db, pccTestCatalogTable } from '@workspace/db';

export type PccTaxonomy = 'ConfigDrift' | 'GraphEndpoint' | 'EventInjection' | 'JourneyReplay' | 'UISurface';

export interface PccTest {
  id: string;
  name: string;
  taxonomy: PccTaxonomy;
  description: string;
  isProdSafe: boolean;
  dependencies: string[];
  tags: string[];
}

/**
 * Git #3551 — the catalog used to be the hardcoded `DEFAULT_TESTS` array below.
 * It is now a real table (`pcc_test_catalog`, seeded from that exact array by
 * `lib/db/migrations/manual/2026-09-13-pcc-test-catalog-3551.sql`), read here at
 * request time instead of imported as a constant.
 */
export async function getCatalog(): Promise<PccTest[]> {
  const rows = await db.select().from(pccTestCatalogTable);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    taxonomy: r.taxonomy as PccTaxonomy,
    description: r.description,
    isProdSafe: r.isProdSafe,
    dependencies: r.dependencies as string[],
    tags: r.tags as string[],
  }));
}
