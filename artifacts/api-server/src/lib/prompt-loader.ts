/**
 * prompt-loader.ts
 *
 * Fetches AI prompt bodies from the DB-backed ai_prompts table.
 * Falls back to a hard-coded string if the row is missing — so removing
 * a row from the DB never breaks a feature.
 *
 * ai_prompts rows are admin-managed only (#500) — there is no code-level
 * seeding mechanism. A brand-new/reset database gets no default rows; every
 * `getPrompt()` call site still carries its own hard-coded fallback string,
 * so the feature keeps working, just without an editable DB override until
 * an admin creates one via the AI Prompts admin UI or direct SQL.
 */

import { db, aiPromptsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.ts";
const log = logger.child({ channel: "admin.content" });

/**
 * Fetch a prompt body from the DB, falling back to `fallback` if missing.
 *
 * Pass `deprecatedTokens` to guard against stale DB prompts that still
 * contain tokens that are no longer substituted (e.g. "{{scores}}").  If
 * the stored body contains ANY of those literal strings the row is deleted
 * and the canonical `fallback` is returned instead, preventing silent
 * corruption where un-substituted placeholders appear verbatim in AI output.
 */
export async function getPrompt(
  key: string,
  fallback: string,
  deprecatedTokens?: string[],
): Promise<string> {
  try {
    const [row] = await db
      .select({ promptBody: aiPromptsTable.promptBody })
      .from(aiPromptsTable)
      .where(eq(aiPromptsTable.key, key))
      .limit(1);
    if (row) {
      if (deprecatedTokens?.some((token) => row.promptBody.includes(token))) {
        log.warn(
          { key, deprecatedTokens },
          "prompt-loader: DB prompt contains deprecated tokens — deleting stale row and using fallback",
        );
        try {
          await db.delete(aiPromptsTable).where(eq(aiPromptsTable.key, key));
        } catch (delErr) {
          log.warn({ delErr, key }, "prompt-loader: failed to delete stale prompt row");
        }
        return fallback;
      }
      return row.promptBody;
    }
  } catch (err) {
    log.warn({ err, key }, "prompt-loader: DB lookup failed, using fallback");
  }
  return fallback;
}

/**
 * Returns the shared document style guide that is prepended to every
 * AI-generated client document (reports, consulting deliverables, SOWs).
 * Stored under the key "insights-document-style" in the ai_prompts table
 * so it is editable without a code deploy.
 * Returns an empty string if the row is missing or DB lookup fails.
 */
export async function getDocumentStylePrefix(): Promise<string> {
  try {
    const [row] = await db
      .select({ promptBody: aiPromptsTable.promptBody })
      .from(aiPromptsTable)
      .where(eq(aiPromptsTable.key, "insights-document-style"))
      .limit(1);
    if (row?.promptBody) return row.promptBody + "\n\n";
  } catch (err) {
    log.warn({ err }, "prompt-loader: style-guide lookup failed, skipping prefix");
  }
  return "";
}

/**
 * Returns the SOW pricing-formula block (base ceilings, adjustment map, and
 * output rules) that is appended to the Consolidated SOW prompt. Stored under
 * the key "insights-consulting-sow_pricing_formula" so tier dollar amounts and
 * adjustment eligibility rules are editable in the AI Prompts admin UI without
 * a code deploy. Falls back to `fallback` if the DB row is missing.
 */
export async function getSowPricingFormulaBlock(fallback: string): Promise<string> {
  return getPrompt("insights-consulting-sow_pricing_formula", fallback);
}

