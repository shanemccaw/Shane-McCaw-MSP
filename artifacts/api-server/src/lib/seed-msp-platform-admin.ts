import { db, mspsTable, mspUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const MSP_SLUG = "shane-mccaw-consulting";
const PLATFORM_ADMIN_USER_ID = 1;

/**
 * Ensures Shane McCaw Consulting exists in the `msps` table and that
 * user ID 1 (shanemccaw@gmail.com) has a PlatformAdmin row in `msp_users`.
 *
 * Idempotent — safe to call on every server boot. Uses ON CONFLICT DO NOTHING
 * so manual admin edits are never overwritten.
 */
export async function seedMspPlatformAdmin(): Promise<void> {
  // 1. Ensure the MSP org row exists.
  // Use raw SQL so this works even before the is_direct_business column migration
  // has been applied (the column may not yet exist in older DB snapshots).
  await db.execute(
    (await import("drizzle-orm")).sql`
      INSERT INTO msps (name, slug, status)
      VALUES ('Shane McCaw Consulting', ${MSP_SLUG}, 'active')
      ON CONFLICT (slug) DO NOTHING
    `
  );

  // 2. Look up the MSP id (may have just been created or already existed)
  const [msp] = await db
    .select({ id: mspsTable.id })
    .from(mspsTable)
    .where(eq(mspsTable.slug, MSP_SLUG))
    .limit(1);

  if (!msp) {
    logger.warn("seed-msp: MSP row not found after insert — skipping msp_users seed");
    return;
  }

  // 3. Ensure the PlatformAdmin user row exists
  await db
    .insert(mspUsersTable)
    .values({
      userId: PLATFORM_ADMIN_USER_ID,
      mspId: msp.id,
      mspRole: "PlatformAdmin",
      isActive: true,
    })
    .onConflictDoNothing({ target: mspUsersTable.userId });

  logger.info({ mspId: msp.id }, "seed-msp: MSP org and PlatformAdmin user ensured");
}
