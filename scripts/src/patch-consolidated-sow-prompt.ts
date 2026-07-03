/**
 * patch-consolidated-sow-prompt.ts
 *
 * One-time (idempotent) data migration that updates the live ai_prompts row
 * for key "insights-consulting-consolidated_sow".
 *
 * Background:
 *   The Consolidated SOW pricing prompt previously instructed the AI to apply
 *   shared adjustments (Tenant Size, Complexity, Data Sprawl, etc.) "verbatim
 *   to every pricing line item", causing each workstream row to be inflated by
 *   the full shared-adjustment stack. The correct behaviour is:
 *     - Per-workstream rows: Project/Workstream | Scope | Base Ceiling |
 *       Final Price (USD) | Reasoning — NO per-row adjustments
 *     - A separate "Pricing Adjustments" section lists each shared factor once
 *     - A Grand Total row = sum of workstream prices + sum of shared adjustments
 *
 * Idempotency:
 *   The script checks whether the prompt_body already contains the updated
 *   wording ("Base Ceiling"). If it does, the update is skipped.
 *
 * Run:
 *   pnpm --filter @workspace/scripts run patch-consolidated-sow-prompt
 *
 * Required env var:
 *   DATABASE_URL — Postgres connection string
 */

import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { aiPromptsTable } from "@workspace/db/schema";

const { Pool } = pg;

const NEW_PROMPT_BODY = `You are Shane McCaw, a senior Microsoft 365 Architect with 30 years of experience. Generate a comprehensive, client-ready Consolidated Statement of Work in HTML format.

Client: {{clientName}}
Deliverable title: {{title}}
Date: {{date}}

EXISTING DOCUMENTS GENERATED FOR THIS CLIENT (synthesize all findings, recommendations, and remediation items from these into the SOW):
{{existingDocs}}

ENGAGEMENT PROJECT PRICING CATALOGUE (use these titles, price ranges, and deliverables to populate real pricing in the SOW — select only the projects relevant to this client's needs):
{{engagementProjects}}

TENANT TELEMETRY (live M365 health profile flags, scores, and script findings — use this data to scope the work accurately and to justify pricing decisions):
{{tenantTelemetry}}

INSTRUCTIONS:
- Output ONLY valid HTML (no markdown, no code fences)
- Use inline CSS — professional white background, #0078D4 (Azure Blue) accent, Inter/system-font typography
- Structure: Executive Summary → Scope of Work → Deliverables (table) → Project Pricing (table with line items from the catalogue above) → Timeline (phased Gantt-style) → Resource Requirements → Acceptance Criteria → Terms & Conditions → Signature Block
- The Pricing section MUST contain two parts: (1) a per-workstream table with columns: Project/Workstream | Scope | Base Ceiling | Final Price (USD) | Reasoning — populated from the engagement projects catalogue and the telemetry above; (2) a "Pricing Adjustments" summary section below it that lists each shared adjustment factor (Tenant Size, Complexity, Data Sprawl, Security/Compliance, Copilot Readiness, Timeline) and its dollar value ONCE, followed by a Grand Total row
- You MUST output a single fixed price per project/workstream (no ranges, no TBD, no "depends"); shared adjustments must NOT be added to individual workstream rows
- You MUST calculate pricing using the telemetry and pricing rules provided; each workstream row shows only its Base Ceiling and Final Price; shared adjustments are listed ONCE in the "Pricing Adjustments" summary section below the workstream table, never repeated on individual rows
- Synthesise all findings and remediation themes across the provided documents into a coherent, unified scope
- Each major section as <h2> with a horizontal rule separator
- Professional consulting tone as Shane McCaw, first person where appropriate

- Total length: 2000-3500 words`;

const PROMPT_KEY = "insights-consulting-consolidated_sow";

async function main() {
  const dbUrl = process.env["DATABASE_URL"];
  if (!dbUrl) {
    console.error("ERROR: DATABASE_URL is not set.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dbUrl });
  const db = drizzle(pool);

  console.log("=== patch-consolidated-sow-prompt ===\n");

  const [existing] = await db
    .select({ key: aiPromptsTable.key, promptBody: aiPromptsTable.promptBody, updatedAt: aiPromptsTable.updatedAt })
    .from(aiPromptsTable)
    .where(eq(aiPromptsTable.key, PROMPT_KEY));

  if (!existing) {
    console.log(`Row not found for key "${PROMPT_KEY}" — nothing to patch (seeder will insert on next startup).`);
    await pool.end();
    return;
  }

  if (existing.promptBody?.includes("Base Ceiling")) {
    console.log(`✓ Prompt already contains updated wording — no changes needed.`);
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
  console.log(`  change: shared pricing adjustments now appear ONCE in summary section, not per workstream row`);

  await pool.end();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
