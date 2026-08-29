/**
 * m365-roadmap-mc-link.ts — the join between the M365 Roadmap and Message
 * Center on the Microsoft roadmap feature ID (Git #1531, part of #1494).
 *
 * ── The model (from #1531's own issue) ─────────────────────────────────────
 * These are two stages of one pipeline, not parallel feeds.
 *   - Roadmap (m365_roadmap_items, #1530) — what Microsoft INTENDS. Global,
 *     early, unauthenticated. The 90-day-and-beyond horizon.
 *   - Message Center (msp_message_center_items) — it is now coming to a
 *     specific TENANT's feed, with actionRequiredByDateTime and
 *     isMajorChange. The this-week/next-week horizon.
 * A roadmap item typically precedes its Message Center post by months. The
 * item CROSSES OVER when it lands in a tenant's feed — and that crossing is
 * when the affected-object count stops being hypothetical (the count #1533's
 * resolution layer produces).
 *
 * ── The join key ────────────────────────────────────────────────────────────
 * The roadmap feature ID, which Message Center posts routinely carry in their
 * own `body.content` — either a labelled mention ("Roadmap ID 124981") or a
 * link into microsoft.com/microsoft-365/roadmap (or the aka.ms/roadmap
 * shortlink) carrying the ID as a query parameter or path segment.
 * `extractRoadmapFeatureIds()` is that parser, and it is the ONLY place this
 * pattern set lives — message-center-sync.ts calls it once per post at sync
 * time and persists the result on `msp_message_center_items.roadmap_feature_ids`
 * (a GIN-indexed jsonb array, migration 2026-08-29-mc-roadmap-feature-link-1531),
 * so a reader never re-parses HTML on every request.
 *
 * ── What this module does NOT do ────────────────────────────────────────────
 * It does not count affected objects in a tenant (#1533, a concurrent build —
 * that is the RESOLUTION layer, per-tenant and separate by design) and it does
 * not render a timeline (#1535, not yet specified). This module answers one
 * question only: for a given roadmap feature ID, which real Message Center
 * posts (if any) reference it — i.e. has it crossed over yet, and where.
 */

import { db } from "@workspace/db";
import { m365RoadmapItemsTable, mspMessageCenterItemsTable } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { logger } from "./logger";

const log = logger.child({ channel: "integration.azure" });

/* ── The migration gate ──────────────────────────────────────────────────
 *
 * `roadmap_feature_ids` ships in manual migration
 * 2026-08-29-mc-roadmap-feature-link-1531.sql — like every schema change in
 * this repo, Shane's own step to run, never self-applied by a build session.
 * Unlike #1530's/#1532's own brand-new tables, this migration adds a column to
 * msp_message_center_items — the table message-center-sync.ts's DAILY job
 * writes for every real, live tenant. A naive reference to a column that does
 * not exist yet would not just leave a new feature inert, it would break that
 * already-working daily sync outright. So every read/write of the column in
 * this module checks `hasRoadmapFeatureIdsColumn()` first and degrades to "not
 * yet available" rather than throwing — the sync keeps behaving exactly as it
 * did before this ticket until the migration lands, and the join switches on
 * automatically the moment it does, with no redeploy required.
 *
 * Cached for the process lifetime once resolved either way: a schema
 * migration is not something to re-check on every sync tick, and a
 * false-negative self-corrects on the next process restart (which a migration
 * followed by `request-restart.mjs` naturally causes anyway).
 */
let columnExistsCache: boolean | null = null;

export async function hasRoadmapFeatureIdsColumn(): Promise<boolean> {
  if (columnExistsCache !== null) return columnExistsCache;
  try {
    const result = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'msp_message_center_items' AND column_name = 'roadmap_feature_ids'
      ) AS exists
    `);
    // drizzle's db.execute returns a QueryResult; rows live in .rows (see the
    // same pattern in admin-db-status.ts).
    const rows = (result as unknown as { rows?: Array<{ exists: boolean }> }).rows ?? [];
    columnExistsCache = Boolean(rows[0]?.exists);
  } catch (err) {
    log.warn({ err }, "m365-roadmap-mc-link: could not check for the roadmap_feature_ids column — assuming not present");
    columnExistsCache = false;
  }
  return columnExistsCache;
}

/** Test-only: clears the cached column-existence check between test files. */
export function __resetRoadmapFeatureIdsColumnCache(): void {
  columnExistsCache = null;
}

/** A roadmap feature ID as m365_roadmap_items.feature_id stores it: Microsoft's
 * own decimal item id, kept as TEXT throughout (never parsed to a number) —
 * matching #1530's own convention for the same reason (leading-zero / overflow
 * safety, and it is never arithmetic, only ever compared for equality). */
const ID_TOKEN = "\\d{3,8}";

/** "Roadmap ID 124981", "Microsoft 365 Roadmap ID: 124981", "Feature IDs
 * 124981, 124982", "Roadmap 124981 and 124982" — the plain-text forms Microsoft
 * actually writes into a post's prose. Deliberately conservative (3-8 digits)
 * to avoid swallowing an unrelated number (a KB article id, a port number). */
const LABELLED_RE = new RegExp(
  `(?:Microsoft\\s*365\\s+)?(?:Roadmap|Feature)\\s*(?:IDs?)?\\s*[:#]?\\s*(${ID_TOKEN}(?:\\s*(?:,|and|&)\\s*${ID_TOKEN})*)`,
  "gi",
);

/** A link into the public roadmap site — microsoft.com/microsoft-365/roadmap
 * (optionally locale-prefixed, e.g. /en-us/) with a query string. `\/+` rather
 * than a single `\/` after the host because real posts have shipped a stray
 * doubled slash (`microsoft.com//microsoft-365/roadmap`) — Microsoft's own
 * authoring artifact, not a normalized URL to rely on. The ID lives in one of
 * a few query parameter names the public roadmap page has used;
 * `idsFromRoadmapLink` below extracts whichever is present. */
const ROADMAP_LINK_RE = /https?:\/\/(?:www\.)?microsoft\.com\/+(?:[a-z-]+\/)?microsoft-365\/roadmap\?[^"'\s<>]*/gi;

/** The aka.ms shortlink form, which carries the ID directly in the path:
 * aka.ms/roadmap/124981. */
const AKA_LINK_RE = /https?:\/\/aka\.ms\/roadmap\/(\d{3,8})/gi;

/** Query parameter names the public roadmap page has carried an item id under. */
const ROADMAP_LINK_ID_PARAMS = ["searchterms", "aid", "featureid", "id"] as const;

function idsFromList(list: string): string[] {
  return list
    .split(/\s*(?:,|and|&)\s*/i)
    .map((s) => s.trim())
    .filter((s) => /^\d{3,8}$/.test(s));
}

function idsFromRoadmapLink(url: string): string[] {
  const qIndex = url.indexOf("?");
  if (qIndex < 0) return [];
  // HTML source carries "&amp;" between query params; decode before parsing.
  // Real posts also carry a trailing "#Roadmap" fragment on this link
  // (`...searchterms=558435#Roadmap`) that URLSearchParams does not know to
  // split off, so a param value is matched for its LEADING digit run rather
  // than required to be digits-only.
  const query = url.slice(qIndex + 1).replace(/&amp;/gi, "&");
  const params = new URLSearchParams(query);
  const out: string[] = [];
  for (const key of ROADMAP_LINK_ID_PARAMS) {
    const id = params.get(key)?.trim().match(/^(\d{3,8})/)?.[1];
    if (id) out.push(id);
  }
  return out;
}

/**
 * Reads a Message Center post's raw `body.content` (HTML, as Graph returns it)
 * and returns the distinct roadmap feature ID(s) it references, sorted for a
 * stable diff. Returns `[]` for a post that names no roadmap item — most posts,
 * since only a fraction of Message Center traffic traces back to a roadmap
 * item at all (retirements/incidents/admin-only notices commonly do not).
 *
 * Pure and synchronous by design — no DB, no network — so it is unit-testable
 * without a tenant and safe to call from both the sync path and a one-off
 * backfill over already-stored rows.
 */
export function extractRoadmapFeatureIds(bodyContent: string | null | undefined): string[] {
  if (!bodyContent) return [];
  const decoded = bodyContent.replace(/&amp;/gi, "&");
  const found = new Set<string>();

  for (const m of decoded.matchAll(LABELLED_RE)) {
    for (const id of idsFromList(m[1])) found.add(id);
  }
  for (const m of decoded.matchAll(ROADMAP_LINK_RE)) {
    for (const id of idsFromRoadmapLink(m[0])) found.add(id);
  }
  for (const m of decoded.matchAll(AKA_LINK_RE)) {
    found.add(m[1]);
  }

  return [...found].sort();
}

/* ── Reads: the actual join ─────────────────────────────────────────────── */

export interface CrossoverMessageCenterPost {
  readonly tenantId: string;
  readonly mspId: number;
  readonly graphMessageId: string;
  readonly title: string;
  readonly isMajorChange: boolean;
  readonly actionRequiredByDateTime: Date | null;
  readonly lastModifiedDateTime: Date;
}

/**
 * Every Message Center post (optionally scoped to one MSP) whose own
 * body.content named this roadmap feature ID — the join #1531 exists to
 * build. Reads the persisted, GIN-indexed `roadmap_feature_ids` column via a
 * jsonb containment query rather than scanning bodyContent per request.
 */
export async function findMessageCenterPostsForFeatureId(
  featureId: string,
  mspId?: number,
): Promise<CrossoverMessageCenterPost[]> {
  if (!(await hasRoadmapFeatureIdsColumn())) return [];
  const containment = sql`${mspMessageCenterItemsTable.roadmapFeatureIds} @> ${JSON.stringify([featureId])}::jsonb`;
  const where = mspId !== undefined ? and(containment, eq(mspMessageCenterItemsTable.mspId, mspId)) : containment;

  return db
    .select({
      tenantId: mspMessageCenterItemsTable.tenantId,
      mspId: mspMessageCenterItemsTable.mspId,
      graphMessageId: mspMessageCenterItemsTable.graphMessageId,
      title: mspMessageCenterItemsTable.title,
      isMajorChange: mspMessageCenterItemsTable.isMajorChange,
      actionRequiredByDateTime: mspMessageCenterItemsTable.actionRequiredByDateTime,
      lastModifiedDateTime: mspMessageCenterItemsTable.lastModifiedDateTime,
    })
    .from(mspMessageCenterItemsTable)
    .where(where)
    .orderBy(desc(mspMessageCenterItemsTable.lastModifiedDateTime));
}

/**
 * The distinct set of roadmap feature IDs that have crossed over into at
 * least one Message Center post — optionally scoped to one MSP's tenants.
 * One cheap query (no per-item lookups) so a caller annotating a whole
 * roadmap candidate list can do it in a single round trip; see
 * `withCrossoverFlag` below.
 */
export async function getCrossedOverFeatureIds(mspId?: number): Promise<ReadonlySet<string>> {
  if (!(await hasRoadmapFeatureIdsColumn())) return new Set();
  const base = db
    .select({ ids: mspMessageCenterItemsTable.roadmapFeatureIds })
    .from(mspMessageCenterItemsTable);
  const rows = mspId !== undefined ? await base.where(eq(mspMessageCenterItemsTable.mspId, mspId)) : await base;

  const out = new Set<string>();
  for (const r of rows) for (const id of r.ids) out.add(id);
  return out;
}

/**
 * Pure annotation step: marks each roadmap-shaped item `crossedOver: true` iff
 * its `featureId` is in the given set. Split from `getCrossedOverFeatureIds`
 * so callers building a candidate list (e.g. admin-m365-interpretations.ts)
 * can fetch the set once and annotate many items without N+1 queries.
 */
export function withCrossoverFlag<T extends { featureId: string }>(
  items: readonly T[],
  crossedOverFeatureIds: ReadonlySet<string>,
): ReadonlyArray<T & { crossedOver: boolean }> {
  return items.map((item) => ({ ...item, crossedOver: crossedOverFeatureIds.has(item.featureId) }));
}

/* ── Backfill ─────────────────────────────────────────────────────────────
 *
 * message-center-sync.ts populates roadmap_feature_ids going forward, on every
 * insert/update. Rows synced before that column existed need the same parser
 * run once against their already-stored bodyContent — this is that one-off,
 * safe to run repeatedly (it only ever touches rows whose column is still the
 * default empty array, so a post that genuinely names no roadmap item is not
 * re-scanned every run).
 */
export interface BackfillResult {
  scanned: number;
  updated: number;
}

export async function backfillMessageCenterRoadmapLinks(): Promise<BackfillResult> {
  if (!(await hasRoadmapFeatureIdsColumn())) {
    log.warn("m365-roadmap-mc-link: backfill skipped — roadmap_feature_ids column does not exist yet (run the manual migration first)");
    return { scanned: 0, updated: 0 };
  }
  const rows = await db
    .select({
      id: mspMessageCenterItemsTable.id,
      bodyContent: mspMessageCenterItemsTable.bodyContent,
    })
    .from(mspMessageCenterItemsTable)
    .where(sql`${mspMessageCenterItemsTable.roadmapFeatureIds} = '[]'::jsonb`);

  let updated = 0;
  for (const row of rows) {
    const ids = extractRoadmapFeatureIds(row.bodyContent);
    if (ids.length === 0) continue;
    await db
      .update(mspMessageCenterItemsTable)
      .set({ roadmapFeatureIds: ids, updatedAt: new Date() })
      .where(eq(mspMessageCenterItemsTable.id, row.id));
    updated++;
  }

  log.info({ scanned: rows.length, updated }, "m365-roadmap-mc-link: backfill complete");
  return { scanned: rows.length, updated };
}

/** Whether at least one confirmed m365_roadmap_items row exists for a feature
 * ID — used to decide whether a crossed-over MC post's link is to a roadmap
 * item this platform has actually ingested, versus a stale/foreign ID. */
export async function roadmapItemExists(featureId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: m365RoadmapItemsTable.id })
    .from(m365RoadmapItemsTable)
    .where(eq(m365RoadmapItemsTable.featureId, featureId))
    .limit(1);
  return row !== undefined;
}
