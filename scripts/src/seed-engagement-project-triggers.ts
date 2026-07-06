/**
 * seed-engagement-project-triggers.ts
 *
 * Migrates all engagement projects to use canonical signal keys from TENANT_SIGNALS
 * instead of legacy plan-name strings (e.g. "M365 Tenant Health Audit").
 *
 * This script is IDEMPOTENT — safe to re-run any number of times.
 * It force-sets the correct signal keys even if triggeredBy already contains
 * old values, ensuring production databases are fully migrated.
 *
 * Run:
 *   pnpm --filter @workspace/scripts run seed-engagement-project-triggers
 */

import { db, engagementProjectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const KNOWN_SIGNAL_KEYS = new Set([
  "hasExchangeOnPrem",
  "hasPowerPlatformUsage",
  "hasGovernanceGaps",
  "hasSecurityGaps",
  "hasCopilotLicenses",
  "hasSharePointIssues",
  "hasLicensingWaste",
  "hasDLPGaps",
  "alwaysInclude",
]);

function mapTitleToSignals(title: string): string[] | null {
  const t = title.toLowerCase();

  if (t.includes("migration")) return ["hasExchangeOnPrem"];
  if (t.includes("power platform") || t.includes("power automate")) return ["hasPowerPlatformUsage"];
  if (t.includes("copilot")) return ["hasCopilotLicenses"];
  if (t.includes("governance remediation") || t.includes("governance foundations")) return ["hasGovernanceGaps"];
  if (t.includes("sharepoint") || t.includes("information architecture")) return ["hasSharePointIssues"];
  if (t.includes("security") && t.includes("compliance")) return ["hasSecurityGaps", "hasDLPGaps"];
  if (t.includes("security")) return ["hasSecurityGaps"];
  if (t.includes("licensing") || t.includes("license optim")) return ["hasLicensingWaste"];
  if (t.includes("data protection") || t.includes("dlp")) return ["hasDLPGaps"];

  return null;
}

async function main() {
  const projects = await db
    .select({
      id: engagementProjectsTable.id,
      title: engagementProjectsTable.title,
      triggeredBy: engagementProjectsTable.triggeredBy,
    })
    .from(engagementProjectsTable);

  console.log(`Found ${projects.length} engagement project(s).\n`);

  let migrated = 0;
  let alreadyCorrect = 0;
  let skipped = 0;

  for (const p of projects) {
    const existing: string[] = Array.isArray(p.triggeredBy) ? p.triggeredBy : [];
    const allAreSignalKeys = existing.length > 0 && existing.every(t => KNOWN_SIGNAL_KEYS.has(t));

    if (allAreSignalKeys) {
      console.log(`OK    "${p.title}" — already uses signal keys: ${existing.join(", ")}`);
      alreadyCorrect++;
      continue;
    }

    const signals = mapTitleToSignals(p.title);
    if (!signals) {
      // No title mapping — assign alwaysInclude so the project is never silently
      // excluded from SOWs after the empty-trigger bypass was removed. An admin
      // can tighten this to a specific signal key via the Admin Panel.
      await db
        .update(engagementProjectsTable)
        .set({ triggeredBy: ["alwaysInclude"], updatedAt: new Date() })
        .where(eq(engagementProjectsTable.id, p.id));

      const legacy = existing.length > 0 ? existing.join(", ") : "(empty)";
      console.warn(`FALLB "${p.title}"\n      ${legacy} → alwaysInclude (no title mapping — tighten via Admin Panel)`);
      migrated++;
      continue;
    }

    await db
      .update(engagementProjectsTable)
      .set({ triggeredBy: signals, updatedAt: new Date() })
      .where(eq(engagementProjectsTable.id, p.id));

    const legacy = existing.length > 0 ? existing.join(", ") : "(empty)";
    console.log(`MIGR  "${p.title}"\n      ${legacy} → ${signals.join(", ")}`);
    migrated++;
  }

  console.log(`\nDone. ${migrated} migrated, ${alreadyCorrect} already correct, ${skipped} skipped.`);

  if (skipped > 0) {
    console.warn("\nWARNING: Some projects were skipped and still have unrecognized triggeredBy strings.");
    console.warn("They will be EXCLUDED from all SOW generation until manually updated.");
    console.warn("Use the Admin Panel → Engagement Projects to set canonical signal keys.");
  }

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
