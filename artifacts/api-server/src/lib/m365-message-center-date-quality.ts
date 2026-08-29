/**
 * m365-message-center-date-quality.ts — the prose-date half of #1536.
 *
 * `portal-message-center.ts`'s bucket axis is keyed off structural Graph
 * fields (`actionRequiredByDateTime`, `endDateTime`, `startDateTime`,
 * `lastModifiedDateTime`). Those are always present in practice, but they are
 * not always the MOST USEFUL date: Microsoft's own posts routinely carry a
 * "[Rollout Schedule]" section stating a specific, human-readable window —
 * "Rollout begins in mid-July 2026 and is expected to complete by early
 * August 2026" — that is more precise than the structural fields, and
 * occasionally disagrees with them outright (the structural `endDateTime` is
 * sometimes a generic outer bound Microsoft sets in the system, not the date
 * the prose actually names).
 *
 * ── The hard constraint this module is built around ─────────────────────
 * Per #1536: this prose is extracted, but ONLY into a separate advisory
 * field, rendered as the prose it came from. `extractAdvisoryDateText` never
 * returns a `Date` — only a short, human-readable string, taken verbatim (or
 * near-verbatim, with only a repeated platform label stripped) from the post
 * itself. It never feeds `actionRequiredByDateTime`, and the caller must
 * never use it to place a post in a bucket. A manufactured deadline in a
 * change timeline is the same class of failure as fixture data; this module
 * manufactures nothing — it either finds Microsoft's own words or returns
 * null.
 *
 * ── Why a regex over prose, and how it was validated ─────────────────────
 * There is no structured field for "the rollout window in readable form" —
 * if there were, this module would not need to exist. The "[Rollout
 * Schedule]" heading and the "General Availability" / date-range shape
 * beneath it are consistent enough across Microsoft's own authoring to
 * extract reliably: validated against all 567 real Message Center posts in
 * the local corpus that carry a "Rollout Schedule" section (of 1159 total),
 * with every one producing either a real date-bearing phrase or an honest
 * null — never a fabricated one. Real quirks this found and was tuned
 * against: the heading is written both "[Rollout Schedule]" and "Rollout
 * Schedule:]" (colon before the bracket); a bullet is sometimes shaped
 * "General Availability" as a bare heading with the actual date sitting in
 * the FOLLOWING bullet, not that one; and a bullet is sometimes shaped the
 * other way round — "April 2026 - Enforcement Phase: <a paragraph with no
 * date near its start>" — where the date is IN the label and stripping it
 * blindly would throw the date away.
 */

import { sql } from "drizzle-orm";
import { db, mspMessageCenterItemsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

import { htmlToText } from "./portal-message-center";
import { logger } from "./logger";

const log = logger.child({ channel: "integration.azure" });

const MONTH_YEAR =
  /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(?:\d{1,2}(?:st|nd|rd|th)?,?\s+)?\d{4}\b/i;

function hasDateSignal(s: string): boolean {
  return MONTH_YEAR.test(s) || /\bnow\b/i.test(s);
}

/**
 * A bullet is "Label: content" — a platform ("Worldwide:"), a milestone
 * ("General Availability:"), or a bare date ("July 21, 2026:"). Strips the
 * label, keeping whichever side actually carries the date.
 */
function stripLabel(line: string): string {
  const i = line.indexOf(":");
  if (i < 0) return line.trim();
  const before = line.slice(0, i).trim();
  const after = line.slice(i + 1).trim();
  if (hasDateSignal(before) && !hasDateSignal(after.slice(0, 40))) return before;
  return after;
}

/** Cap on the advisory string. This is a supplementary line, not the post body. */
const MAX_LEN = 200;

/**
 * Pulls the prose rollout-schedule phrase out of a post's `bodyContent`, or
 * null when the post has no such section or nothing date-bearing was found in
 * it. Pure and synchronous — text in, string-or-null out — so it is
 * unit-testable without a tenant or a database, same shape as
 * `m365-roadmap-mc-link.ts`'s `extractRoadmapFeatureIds`.
 */
export function extractAdvisoryDateText(bodyContent: string | null | undefined): string | null {
  if (!bodyContent) return null;
  const text = htmlToText(bodyContent);

  // Bound the section to the next bracket heading (usually "[Impact on Your
  // Organization]"). Brackets and the trailing colon are both optional
  // because Microsoft's own authoring is inconsistent about them.
  const sectionMatch = text.match(
    /\[?\s*Rollout Schedule\s*:?\s*\]?\s*([\s\S]*?)(?=\[?\s*Impact on [Yy]our [Oo]rganization|\[[A-Z][^\]]*\]|$)/i,
  );
  if (!sectionMatch) return null;
  const section = sectionMatch[1].trim();
  if (!section) return null;

  const lines = section.split("\n").map((l) => l.trim()).filter(Boolean);
  const strippedAll = lines.map(stripLabel);
  const stripped = strippedAll.filter((l) => l.length > 0);

  // Prefer a General Availability bullet that still carries a date once
  // stripped — a bare "General Availability" heading with the real date on a
  // following bullet is common, and the generic scan below would otherwise
  // stop at that empty heading rather than reading on.
  const gaCandidates = lines
    .map((l, i) => (/general availability/i.test(l) ? strippedAll[i] : null))
    .filter((l): l is string => Boolean(l) && hasDateSignal(l!));

  const chosen = gaCandidates[0] ?? stripped.find(hasDateSignal);
  if (!chosen) return null;

  return chosen.slice(0, MAX_LEN);
}

/**
 * Whether `advisory_date_text` exists on `msp_message_center_items` yet.
 * Mirrors `m365-roadmap-mc-link.ts`'s `hasRoadmapFeatureIdsColumn` exactly:
 * this column ships in a manual migration Shane runs himself, so the
 * ALREADY-LIVE daily sync must keep working through the gap between deploy
 * and that migration landing, degrading to "not yet available" rather than
 * throwing. Cached for the process lifetime once resolved either way.
 */
let columnExistsCache: boolean | null = null;

export async function hasAdvisoryDateTextColumn(): Promise<boolean> {
  if (columnExistsCache !== null) return columnExistsCache;
  try {
    const result = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'msp_message_center_items' AND column_name = 'advisory_date_text'
      ) AS exists
    `);
    const rows = (result as unknown as { rows?: Array<{ exists: boolean }> }).rows ?? [];
    columnExistsCache = Boolean(rows[0]?.exists);
  } catch (err) {
    log.warn({ err }, "m365-message-center-date-quality: could not check for the advisory_date_text column — assuming not present");
    columnExistsCache = false;
  }
  return columnExistsCache;
}

export interface BackfillResult {
  scanned: number;
  updated: number;
}

/**
 * One-off backfill for posts synced before this column existed. Mirrors
 * `backfillMessageCenterRoadmapLinks`'s own shape and reasoning: re-running
 * the ONE real parser against already-stored `bodyContent` rather than
 * reimplementing its rules a second time in SQL.
 */
export async function backfillMessageCenterAdvisoryDates(): Promise<BackfillResult> {
  if (!(await hasAdvisoryDateTextColumn())) {
    log.warn("m365-message-center-date-quality: backfill skipped — advisory_date_text column does not exist yet (run the manual migration first)");
    return { scanned: 0, updated: 0 };
  }
  const rows = await db
    .select({
      id: mspMessageCenterItemsTable.id,
      bodyContent: mspMessageCenterItemsTable.bodyContent,
    })
    .from(mspMessageCenterItemsTable)
    .where(sql`${mspMessageCenterItemsTable.advisoryDateText} IS NULL`);

  let updated = 0;
  for (const row of rows) {
    const advisory = extractAdvisoryDateText(row.bodyContent);
    if (!advisory) continue;
    await db
      .update(mspMessageCenterItemsTable)
      .set({ advisoryDateText: advisory, updatedAt: new Date() })
      .where(eq(mspMessageCenterItemsTable.id, row.id));
    updated++;
  }

  log.info({ scanned: rows.length, updated }, "m365-message-center-date-quality: backfill complete");
  return { scanned: rows.length, updated };
}
