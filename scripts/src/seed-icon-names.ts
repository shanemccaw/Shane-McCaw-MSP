/**
 * seed-icon-names.ts
 *
 * Idempotently sets sensible iconName values for all existing services
 * in the development database. These values correspond exactly to keys in
 * the frontend ICON_MAP used by Microsoft365.tsx (and the admin panel's
 * live card preview). Running this script multiple times is safe — it only
 * updates rows whose current icon_name does not already match the desired value.
 *
 * Run:
 *   pnpm --filter @workspace/scripts run seed-icon-names
 *
 * Required env vars:
 *   DATABASE_URL — dev Postgres connection string
 */

import pg from "pg";

const { Pool } = pg;

const devUrl = process.env["DATABASE_URL"];
if (!devUrl) {
  console.error("ERROR: DATABASE_URL is not set.");
  process.exit(2);
}

const pool = new Pool({ connectionString: devUrl });

const ICON_ASSIGNMENTS: Array<{ slug: string; iconName: string }> = [
  { slug: "m365-tenant-health-audit",              iconName: "ShieldCheck" },
  { slug: "power-platform-quickstart",             iconName: "Zap"         },
  { slug: "governance-foundations-package",        iconName: "Shield"      },
  { slug: "migration-readiness-assessment",        iconName: "Database"    },
  { slug: "copilot-for-m365-readiness-assessment", iconName: "Sparkles"    },
  { slug: "architect-essentials",                  iconName: "Target"      },
  { slug: "architect-growth",                      iconName: "Layers"      },
  { slug: "architect-enterprise",                  iconName: "Globe"       },
  { slug: "microsoft-365-training--enablement",    iconName: "BookOpen"    },
];

async function main(): Promise<void> {
  const client = await pool.connect();
  try {
    console.log("Seeding icon names…");
    for (const { slug, iconName } of ICON_ASSIGNMENTS) {
      const result = await client.query<{ slug: string }>(
        `UPDATE services
            SET icon_name = $1
          WHERE slug = $2
            AND (icon_name IS DISTINCT FROM $1)
          RETURNING slug`,
        [iconName, slug],
      );
      if (result.rowCount && result.rowCount > 0) {
        console.log(`  updated: ${slug} → ${iconName}`);
      } else {
        console.log(`  skipped: ${slug} (already set or not found)`);
      }
    }
    console.log("\nDone.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("seed-icon-names failed:", err);
  process.exit(1);
});
