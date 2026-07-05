/**
 * m365-profile-update.ts
 *
 * Shared helpers for writing M365 profile data and snapshotting health scores.
 * Imported by both admin-m365-run.ts (manual script runs) and kanban-auto-fire.ts
 * (automated kanban card script runs) so both code paths keep the profile and
 * health history in sync after every script run.
 */

import {
  db,
  clientM365ProfilesTable,
  clientHealthHistoryTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { normaliseProfileUpdates } from "./parse-m365-script-output";
import { computeM365Scores, type M365ScoreCategory } from "./m365-scores";

/**
 * Merge profileUpdates into client_m365_profiles.
 * - Normalises legacy `authMethod` → `authMethods` array.
 * - UPSERTs: inserts a new row if none exists; merges into the existing row otherwise.
 * - No-ops if profileUpdates is empty.
 */
export async function applyProfileUpdates(
  clientId: number,
  profileUpdates: Record<string, unknown>,
): Promise<void> {
  if (Object.keys(profileUpdates).length === 0) return;

  const normalised = normaliseProfileUpdates(profileUpdates);

  const [existing] = await db
    .select()
    .from(clientM365ProfilesTable)
    .where(eq(clientM365ProfilesTable.clientId, clientId))
    .limit(1);

  const existingProfile = (existing?.profile as Record<string, unknown>) ?? {};
  const normalisedExisting = normaliseProfileUpdates(existingProfile);
  const merged = { ...normalisedExisting, ...normalised };

  if (existing) {
    await db
      .update(clientM365ProfilesTable)
      .set({ profile: merged, updatedAt: new Date() })
      .where(eq(clientM365ProfilesTable.clientId, clientId));
  } else {
    await db
      .insert(clientM365ProfilesTable)
      .values({ clientId, profile: merged });
  }
}

/**
 * Snapshot the client's current M365 health scores derived from their profile
 * into clientHealthHistoryTable. Called after every profile update so both the
 * Health page and the Insights page always reflect the same source of truth.
 */
export async function snapshotHealthFromProfile(clientId: number): Promise<void> {
  const [row] = await db
    .select({ profile: clientM365ProfilesTable.profile })
    .from(clientM365ProfilesTable)
    .where(eq(clientM365ProfilesTable.clientId, clientId))
    .limit(1);

  if (!row?.profile) return;

  const scores = computeM365Scores(row.profile as Record<string, unknown>);
  const now = new Date();

  await db.insert(clientHealthHistoryTable).values(
    (Object.entries(scores) as [M365ScoreCategory, number][]).map(([category, score]) => ({
      clientId,
      category,
      score,
      recordedAt: now,
    }))
  );

  logger.info({ clientId, scoreCategories: Object.keys(scores).length }, "m365-profile-update: health snapshot recorded");
}
