import { db, engagementProjectsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

async function main() {
  const projects = await db
    .select({ id: engagementProjectsTable.id, title: engagementProjectsTable.title, triggeredBy: engagementProjectsTable.triggeredBy })
    .from(engagementProjectsTable);

  let updated = 0;
  for (const p of projects) {
    const existing: string[] = Array.isArray(p.triggeredBy) ? p.triggeredBy : [];
    if (existing.length > 0) {
      console.log(`Skipping "${p.title}" — already has triggers: ${existing.join(", ")}`);
      continue;
    }

    const t = p.title.toLowerCase();
    let signals: string[] = [];

    if (t.includes("migration")) {
      signals = ["hasExchangeOnPrem"];
    } else if (t.includes("power platform") || t.includes("power automate")) {
      signals = ["hasPowerPlatformUsage"];
    } else if (t.includes("copilot")) {
      signals = ["hasCopilotLicenses"];
    }

    if (signals.length > 0) {
      await db
        .update(engagementProjectsTable)
        .set({ triggeredBy: signals, updatedAt: new Date() })
        .where(eq(engagementProjectsTable.id, p.id));
      console.log(`Updated "${p.title}" → ${signals.join(", ")}`);
      updated++;
    } else {
      console.log(`Leaving "${p.title}" as always-include (no triggeredBy)`);
    }
  }

  console.log(`Done. ${updated} project(s) updated.`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
