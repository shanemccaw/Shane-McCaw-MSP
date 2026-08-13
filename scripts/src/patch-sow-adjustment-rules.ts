/**
 * patch-sow-adjustment-rules.ts
 *
 * Idempotent data migration that updates the live ai_prompts row for
 * key "insights-consulting-consolidated_sow" with workstream-scoped
 * adjustment rules.
 *
 * Background:
 *   The previous prompt listed all adjustment factors (Complexity, Data Sprawl,
 *   Security/Compliance, Copilot Readiness) unconditionally — so the AI could
 *   apply any adjustment to any workstream. The correct behaviour is:
 *     - Each workstream has a fixed allowed set of adjustments (see ADJUSTMENT MAP)
 *     - Two new adjustment types added: Tenant Size and Timeline
 *     - Each adjustment appears AT MOST ONCE in the Pricing Adjustments table
 *     - Adjustment amounts are never added to individual workstream rows
 *     - Grand Total = sum(workstream Final Prices) + sum(permitted adjustments)
 *
 * Idempotency:
 *   Skipped if the prompt_body already contains the sentinel string "ADJUSTMENT MAP".
 *
 * Run:
 *   pnpm --filter @workspace/scripts run patch-sow-adjustment-rules
 *
 * Required env var:
 *   DATABASE_URL — Postgres connection string
 */

import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { aiPromptsTable } from "@workspace/db/schema";

const { Pool } = pg;

// Updated sentinel forces re-apply when the prompt contained the old "ADJUSTMENT MAP"
// (from the previous patch) but now needs to be updated with the corrected, tighter rules.
const SENTINEL = "WORKSTREAM_ADJ_MAP_v2";
const PROMPT_KEY = "insights-consulting-consolidated_sow";

const NEW_PROMPT_BODY = `You are Shane McCaw, a senior Microsoft 365 Architect with 30 years of experience. Generate a comprehensive, client-ready Consolidated Statement of Work in HTML format.

Client: {{clientName}}
Deliverable title: {{title}}
Date: {{date}}
ENGAGEMENT START DATE: {{engagementStart}} (the first Monday that is at least one full week after the document generation date — use this as the baseline for all phase delivery date calculations)

EXISTING DOCUMENTS GENERATED FOR THIS CLIENT (synthesize all findings, recommendations, and remediation items from these into the SOW):
{{existingDocs}}

ENGAGEMENT PROJECT PRICING CATALOGUE (use these titles, price ranges, and deliverables to populate real pricing in the SOW — select only the projects relevant to this client's needs):
{{engagementProjects}}

TENANT TELEMETRY (live M365 health profile flags, scores, and script findings — use this data to scope the work accurately and to justify pricing decisions):
{{tenantTelemetry}}

INSTRUCTIONS:
- Output ONLY valid HTML (no markdown, no code fences)
- Use inline CSS — professional white background, #0078D4 (Azure Blue) accent, Inter/system-font typography
- Structure: Executive Summary → Scope of Work → Deliverables (table) → Project Pricing (two-part: workstream table + adjustments summary) → Timeline (phased, with real calendar delivery dates per phase) → Acceptance Criteria
- Do NOT include a Resource Requirements section — Shane McCaw is the sole consultant on this engagement
- Do NOT include a Payment Terms section — payment is managed separately through the client portal
- Do NOT include a Signature Block — document execution is handled through the portal
- The Pricing section MUST contain two parts: (1) a per-workstream table with columns: Project/Workstream | Scope | Base Ceiling | Duration (Weeks) | Delivery Date | Final Price (USD) | Reasoning — populated from the engagement projects catalogue and the telemetry above; (2) a "Pricing Adjustments" summary section below it that lists ONLY the adjustments permitted for the workstreams present in this SOW (per the ADJUSTMENT MAP in the TIER 02 PRICING FORMULA appended below), each appearing once, followed by a Grand Total row — do NOT list adjustments that are not permitted for the workstreams present
- For the Duration (Weeks) column: assign a realistic integer number of weeks to each workstream phase based on the scope of work (e.g. 2–16 weeks). Format as "N weeks" (e.g. "4 weeks")
- For the Delivery Date column: compute dates cumulatively starting from the ENGAGEMENT START DATE. Phase 1 delivery = ENGAGEMENT START DATE + Phase 1 weeks. Phase 2 delivery = Phase 1 delivery date + Phase 2 weeks. Continue this pattern for all subsequent phases. Format as "Mon DD, YYYY" (e.g. "Aug 4, 2026"). These MUST be real calendar dates, not relative estimates
- You MUST output a single fixed price per project/workstream (no ranges, no TBD, no "depends"); shared adjustments must NOT be added to individual workstream rows
- You MUST calculate pricing using the telemetry and pricing rules provided; each workstream row shows only its Base Ceiling and Final Price; only the adjustments permitted for the workstreams present (per the ADJUSTMENT MAP) are listed in the "Pricing Adjustments" summary section below the workstream table, each appearing once and never on individual rows
- The Grand Total MUST equal the arithmetic sum of all workstream Final Prices plus all adjustment amounts. Show the arithmetic explicitly in the Grand Total cell: "Grand Total = $[workstream subtotal] (workstreams) + $[adjustments subtotal] (adjustments) = $[total]". Verify the addition before writing the number.
- Synthesise all findings and remediation themes across the provided documents into a coherent, unified scope
- Each major section as <h2> with a horizontal rule separator
- Professional consulting tone as Shane McCaw, first person where appropriate
- Total length: 2000-3500 words
- PROHIBITED adjustment types (never include in the Pricing Adjustments table): Complexity, Data Sprawl, Timeline [WORKSTREAM_ADJ_MAP_v2]`;

async function main() {
  const dbUrl = process.env["DATABASE_URL"];
  if (!dbUrl) {
    console.error("ERROR: DATABASE_URL is not set.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dbUrl });
  const db = drizzle(pool);

  console.log("=== patch-sow-adjustment-rules ===\n");

  const [existing] = await db
    .select({ key: aiPromptsTable.key, promptBody: aiPromptsTable.promptBody, updatedAt: aiPromptsTable.updatedAt })
    .from(aiPromptsTable)
    .where(eq(aiPromptsTable.key, PROMPT_KEY));

  if (!existing) {
    console.log(`Row not found for key "${PROMPT_KEY}" — nothing to patch (seeder will insert the updated version on next startup).`);
    await pool.end();
    return;
  }

  if (existing.promptBody?.includes(SENTINEL)) {
    console.log(`✓ Prompt already contains workstream-scoped ADJUSTMENT MAP — no changes needed.`);
    console.log(`  key: ${existing.key}`);
    console.log(`  updated_at: ${existing.updatedAt}`);
    await pool.end();
    return;
  }

  await db
    .update(aiPromptsTable)
    .set({ promptBody: NEW_PROMPT_BODY, defaultBody: NEW_PROMPT_BODY, updatedAt: new Date() })
    .where(eq(aiPromptsTable.key, PROMPT_KEY));

  console.log(`✓ Prompt updated successfully.`);
  console.log(`  key: ${PROMPT_KEY}`);
  console.log(`  changes:`);
  console.log(`    - Replaced open-ended STEP 3 with workstream-scoped ADJUSTMENT MAP`);
  console.log(`    - Added Tenant Size and Timeline adjustment rows with tier amounts`);
  console.log(`    - Each adjustment now restricted to permitted workstreams only`);
  console.log(`    - Updated Pricing Adjustments bullet to reference ADJUSTMENT MAP`);

  await pool.end();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
