/**
 * sow-pricing-persist.ts
 *
 * Shared helper that parses SOW pricing from HTML and writes
 * `sowPricingLines` + `sowTotalPrice` back to the database row.
 *
 * Used by:
 *   - workflow-executor.ts  (generate_document + calculate_pricing nodes)
 *   - routes/admin-insights.ts  (consolidated SOW generation route)
 *
 * Keeping the implementation in one place ensures that both callers
 * produce identical data regardless of how the document was generated.
 */

import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { insightsGeneratedDocumentsTable } from "@workspace/db";
import {
  parseSowAllPricing,
  SowPricingLineSchema,
  assignDeliveryDates,
  nextBusinessMonday,
} from "./sow-pricing.js";
import { logger } from "./logger.js";

/**
 * Parse pricing from a SOW HTML string and persist the result to the DB.
 *
 * @param documentId  Primary key of the `insights_generated_documents` row.
 * @param html        The document's HTML content to parse pricing from.
 * @returns           `{ lineCount, totalPrice }` for downstream node outputs.
 */
export async function persistSowPricing(
  documentId: number,
  html: string,
): Promise<{ lineCount: number; totalPrice: number }> {
  const { workstreamLines, adjustmentLines, computedTotal } = parseSowAllPricing(html);

  const engagementStart = nextBusinessMonday();
  const sowLines = [
    ...assignDeliveryDates(
      workstreamLines.map(l => ({ ...l, line_type: "workstream" as const })),
      engagementStart,
    ),
    ...adjustmentLines.map(l => ({ ...l, line_type: "adjustment" as const })),
  ];

  const validation = z.array(SowPricingLineSchema).safeParse(sowLines);
  if (!validation.success) {
    logger.warn(
      { documentId, issues: validation.error.issues },
      "persistSowPricing: sowPricingLines failed schema validation — persisting anyway",
    );
  }

  await db
    .update(insightsGeneratedDocumentsTable)
    .set({
      sowPricingLines: sowLines.length > 0 ? sowLines : null,
      sowTotalPrice: computedTotal > 0 ? String(computedTotal) : null,
      updatedAt: new Date(),
    })
    .where(eq(insightsGeneratedDocumentsTable.id, documentId));

  logger.info(
    { documentId, lineCount: sowLines.length, totalPrice: computedTotal },
    "persistSowPricing: wrote sowPricingLines + sowTotalPrice",
  );

  return { lineCount: sowLines.length, totalPrice: computedTotal };
}
