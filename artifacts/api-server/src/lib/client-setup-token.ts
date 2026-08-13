import { db, accountSetupTokensTable } from "@workspace/db";
import { and, eq, gte, isNull, isNotNull, lt, or, sql } from "drizzle-orm";

/**
 * Extracted from portal.ts (#175, portal.ts route decommission) — shared by
 * portal-team.ts (invite flow) and portal-checkout-free.ts (free onboarding).
 */
export async function ensureClientSetupToken(userId: number): Promise<{ token: string; isNew: boolean }> {
  return db.transaction(async (tx) => {
    // Advisory lock: namespace 43083 (0xACCT) + userId.
    // Two concurrent calls with the same userId block here until the first commits.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(43083, ${userId})`);

    const now = new Date();
    const [existing] = await tx
      .select({ token: accountSetupTokensTable.token })
      .from(accountSetupTokensTable)
      .where(
        and(
          eq(accountSetupTokensTable.userId, userId),
          gte(accountSetupTokensTable.expiresAt, now),
          isNull(accountSetupTokensTable.usedAt),
        ),
      )
      .limit(1);

    if (existing) return { token: existing.token, isNew: false };

    // Purge stale (expired or already-used) tokens before creating a fresh one
    // to prevent unbounded accumulation from repeated purchases.
    await tx.delete(accountSetupTokensTable)
      .where(
        and(
          eq(accountSetupTokensTable.userId, userId),
          or(
            lt(accountSetupTokensTable.expiresAt, now),
            isNotNull(accountSetupTokensTable.usedAt),
          ),
        ),
      );

    const { randomBytes } = await import("crypto");
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
    await tx.insert(accountSetupTokensTable).values({ userId, token, expiresAt });
    return { token, isNew: true };
  });
}
