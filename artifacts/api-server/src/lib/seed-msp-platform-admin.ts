import { db, mspsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
const log = logger.child({ channel: "admin.insights" });

const MSP_SLUG = "shane-mccaw-consulting";
const PLATFORM_ADMIN_USER_ID = 1;

/**
 * Ensures Shane McCaw Consulting exists in the `msps` table and that
 * user ID 1 (shanemccaw@gmail.com) carries the PlatformAdmin role.
 *
 * Idempotent — safe to call on every server boot, and it never overwrites an
 * explicit manual edit.
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
    log.warn("seed-msp: MSP row not found after insert — skipping PlatformAdmin seed");
    return;
  }

  // 3. Ensure the PlatformAdmin identity is present on the user's own row.
  // Pre-refactor this inserted an msp_users extension row and relied on
  // ON CONFLICT DO NOTHING to leave an existing one untouched. With msp_users
  // absorbed into `users` (#92) there is no separate row to be missing, so the
  // equivalent "never seeded" signal is the column still sitting at its default
  // "Free" — matching seedAdminUser()'s Phase 1 rewrite exactly. An account that
  // already carries an explicit role is left alone, as the old conflict branch
  // did. This seed does NOT create the user: the old insert FK'd to users.id, so
  // a missing user was always a no-op failure, and it stays a logged no-op here.
  const [existing] = await db
    .select({ id: usersTable.id, mspRole: usersTable.mspRole })
    .from(usersTable)
    .where(eq(usersTable.id, PLATFORM_ADMIN_USER_ID))
    .limit(1);

  if (!existing) {
    log.warn({ userId: PLATFORM_ADMIN_USER_ID }, "seed-msp: platform admin user row not found — skipping role seed");
    return;
  }

  if (existing.mspRole === "Free") {
    await db
      .update(usersTable)
      .set({ mspRole: "PlatformAdmin", mspId: msp.id, isActive: true })
      .where(eq(usersTable.id, existing.id));
  }

  log.info({ mspId: msp.id }, "seed-msp: MSP org and PlatformAdmin user ensured");
}
