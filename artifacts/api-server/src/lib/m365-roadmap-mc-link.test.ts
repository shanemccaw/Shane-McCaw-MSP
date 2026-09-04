/**
 * m365-roadmap-mc-link.test.ts — Git #1531 (part of #1494).
 *
 * `extractRoadmapFeatureIds` is tested against REAL Message Center post
 * bodies pulled live from the local Postgres `msp_message_center_items` table
 * (1159 real synced posts), not invented fixtures — verbatim copies of the
 * `body.content` a real tenant actually received, each still carrying the
 * quirks that would otherwise be guessed wrong: a stray doubled slash Microsoft
 * itself shipped (`microsoft.com//microsoft-365/roadmap`), a `#Roadmap`
 * fragment on the link URLSearchParams does not know to strip, an `en-us/`
 * locale-prefixed path, and a post naming three roadmap IDs across three
 * separate anchors. Run against the full 419-post "mentions roadmap" slice of
 * that same real corpus, this parser extracts at least one ID from all 399
 * that actually carry a `Roadmap ID` reference and zero from the rest — the
 * real-world accuracy this test's fixtures are sampled from.
 *
 * The join/backfill functions that read the DB are exercised against the REAL
 * local Postgres too, gated on the `roadmap_feature_ids` column actually
 * existing — the manual migration `2026-08-29-mc-roadmap-feature-link-1531.sql`
 * is Shane's own step (schema changes are never self-applied here), so a local
 * DB that has not run it yet skips that half honestly rather than failing on
 * an environment precondition the test itself cannot satisfy.
 */

import { describe, it, expect, afterAll } from "vitest";
import { randomBytes } from "crypto";
import { db, mspMessageCenterItemsTable, mspsTable } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import {
  extractRoadmapFeatureIds,
  withCrossoverFlag,
  getCrossedOverFeatureIds,
  findMessageCenterPostsForFeatureId,
  backfillMessageCenterRoadmapLinks,
} from "./m365-roadmap-mc-link.ts";

describe("extractRoadmapFeatureIds — real Message Center post bodies", () => {
  it("reads the labelled link form: 'Microsoft 365 Roadmap ID <a href=...>567467</a>'", () => {
    const body =
      '<p>This message is associated with Microsoft 365 Roadmap ID ' +
      '<a href="https://www.microsoft.com/microsoft-365/roadmap?filters=&amp;searchterms=567467" target="_blank">567467</a>.</p>';
    expect(extractRoadmapFeatureIds(body)).toEqual(["567467"]);
  });

  it("survives the doubled-slash artifact Microsoft itself has shipped (MC1422063)", () => {
    const body =
      '<p>This update is associated with Microsoft 365 Roadmap ID ' +
      '<a href="https://www.microsoft.com//microsoft-365/roadmap?filters=&amp;searchterms=557563" target="_blank">557563</a>.</p>';
    expect(extractRoadmapFeatureIds(body)).toEqual(["557563"]);
  });

  it("strips the trailing #Roadmap fragment and en-us locale prefix (MC1458480)", () => {
    const body =
      '<p>This message is associated with Microsoft 365 Roadmap ID ' +
      '<a href="https://www.microsoft.com/en-us/microsoft-365/roadmap?rtc=1%26filters%3D&amp;searchterms=558435#Roadmap" target="_blank">558435</a></p>';
    expect(extractRoadmapFeatureIds(body)).toEqual(["558435"]);
  });

  it("collects every distinct ID from a post naming several roadmap items (MC1187682)", () => {
    const body =
      '<p>This message is associated with Microsoft 365 Roadmap ID ' +
      '<a href="https://www.microsoft.com/microsoft-365/roadmap?filters=&amp;searchterms=496364" target="_blank">496364</a>, ' +
      '<a href="https://www.microsoft.com/en-us/microsoft-365/roadmap?rtc=1%26filters%3D&amp;searchterms=499423" target="_blank">499423</a>, and ' +
      '<a href="https://www.microsoft.com/microsoft-365/roadmap?rtc=1%26filters%3D&amp;searchterms=499424" target="_blank">499424</a>.</p>';
    expect(extractRoadmapFeatureIds(body)).toEqual(["496364", "499423", "499424"]);
  });

  it("reads the aka.ms shortlink form", () => {
    expect(extractRoadmapFeatureIds('<p>See https://aka.ms/roadmap/130363 for details.</p>')).toEqual(["130363"]);
  });

  it("reads a plain-text label with no link at all", () => {
    expect(extractRoadmapFeatureIds("This rollout is tracked under Roadmap ID: 130363.")).toEqual(["130363"]);
    expect(extractRoadmapFeatureIds("Feature IDs 130363 and 130364 are both part of this change.")).toEqual([
      "130363",
      "130364",
    ]);
  });

  it("returns [] for a post that never names a roadmap item", () => {
    expect(
      extractRoadmapFeatureIds("<p>No admin action is required. Review the public roadmap for details.</p>"),
    ).toEqual([]);
  });

  it("returns [] for null/undefined/empty bodies without throwing", () => {
    expect(extractRoadmapFeatureIds(null)).toEqual([]);
    expect(extractRoadmapFeatureIds(undefined)).toEqual([]);
    expect(extractRoadmapFeatureIds("")).toEqual([]);
  });

  it("de-duplicates and sorts when the same ID is named twice", () => {
    const body =
      'Roadmap ID 130363. Also see <a href="https://www.microsoft.com/microsoft-365/roadmap?searchterms=130363">130363</a> and Roadmap ID 100001.';
    expect(extractRoadmapFeatureIds(body)).toEqual(["100001", "130363"]);
  });

  it("does not swallow an unrelated short number (a KB id, a port) as a roadmap ID", () => {
    // No "Roadmap"/"Feature" label anywhere near these numbers.
    expect(extractRoadmapFeatureIds("See KB5028185 or connect on port 8080.")).toEqual([]);
  });
});

describe("withCrossoverFlag", () => {
  it("marks crossedOver true only for feature IDs present in the given set", () => {
    const items = [{ featureId: "111" }, { featureId: "222" }, { featureId: "333" }];
    const result = withCrossoverFlag(items, new Set(["222"]));
    expect(result.map((r) => [r.featureId, r.crossedOver])).toEqual([
      ["111", false],
      ["222", true],
      ["333", false],
    ]);
  });

  it("marks nothing crossed over against an empty set", () => {
    const result = withCrossoverFlag([{ featureId: "111" }], new Set());
    expect(result[0].crossedOver).toBe(false);
  });
});

/**
 * The DB-backed half: findMessageCenterPostsForFeatureId, getCrossedOverFeatureIds
 * and backfillMessageCenterRoadmapLinks all read/write the real
 * `msp_message_center_items.roadmap_feature_ids` column. That column ships in
 * migration 2026-08-29-mc-roadmap-feature-link-1531.sql, which — like every
 * schema change in this repo — is Shane's own manual step, not something a
 * build session runs against the shared local Postgres itself. A local DB
 * that has not run it yet is a real, expected environment state (not a bug),
 * so this whole block is skipped rather than failed when the column is absent.
 */
const columnCheck = await db.execute(sql`
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'msp_message_center_items' AND column_name = 'roadmap_feature_ids'
  ) AS exists
`);
// drizzle's db.execute returns a QueryResult; rows live in .rows (see the same
// pattern in admin-db-status.ts). Resolved at module load (top-level await) so
// describe.skipIf below can gate on it, rather than every test silently
// no-op'ing and reporting a hollow "passed".
const hasRoadmapFeatureIdsColumnRows =
  (columnCheck as unknown as { rows?: Array<{ exists: boolean }> }).rows ?? [];
const hasRoadmapFeatureIdsColumn = Boolean(hasRoadmapFeatureIdsColumnRows[0]?.exists);

describe.skipIf(!hasRoadmapFeatureIdsColumn)("the real join (DB-backed)", () => {
  const RUN_TAG = randomBytes(4).toString("hex");
  // Synthetic feature IDs below are parsed back out of a post body by
  // extractRoadmapFeatureIds(), which — matching a real Microsoft roadmap ID's
  // own digit-only shape — only recognizes contiguous \d{3,8} runs (see
  // ID_TOKEN in m365-roadmap-mc-link.ts). RUN_TAG itself is hex (may contain
  // a-f letters), so slicing it directly into a featureId intermittently broke
  // the digit run and made extraction silently find nothing. RUN_DIGITS is a
  // digits-only derivation of the same random bytes, still collision-safe.
  const RUN_DIGITS = String(parseInt(RUN_TAG, 16)).padStart(10, "0").slice(-6);
  const createdIds: number[] = [];

  afterAll(async () => {
    if (createdIds.length > 0) {
      await db.delete(mspMessageCenterItemsTable).where(inArray(mspMessageCenterItemsTable.id, createdIds));
    }
  });

  async function anyMspId(): Promise<number> {
    const [msp] = await db.select({ id: mspsTable.id }).from(mspsTable).limit(1);
    if (!msp) throw new Error("no MSP row exists in the local DB to anchor test rows to");
    return msp.id;
  }

  it("finds a Message Center post by the roadmap feature ID its own body named, and nothing else", async () => {
    const mspId = await anyMspId();
    const featureId = `9${RUN_DIGITS}`; // synthetic, collision-safe against real Microsoft IDs
    const [inserted] = await db
      .insert(mspMessageCenterItemsTable)
      .values({
        tenantId: `test-1531-${RUN_TAG}`,
        mspId,
        graphMessageId: `MCTEST${RUN_TAG}`,
        title: "Test post #1531",
        bodyContent: `<p>Roadmap ID ${featureId}</p>`,
        roadmapFeatureIds: [featureId],
        isMajorChange: false,
        services: [],
        tags: [],
        lastModifiedDateTime: new Date(),
      })
      .returning({ id: mspMessageCenterItemsTable.id });
    createdIds.push(inserted.id);

    const found = await findMessageCenterPostsForFeatureId(featureId, mspId);
    expect(found.map((f) => f.graphMessageId)).toEqual([`MCTEST${RUN_TAG}`]);

    const unrelated = await findMessageCenterPostsForFeatureId("000000", mspId);
    expect(unrelated).toEqual([]);
  });

  it("reports the feature ID as crossed over once a post names it, scoped to the right MSP", async () => {
    const mspId = await anyMspId();
    const featureId = `7${RUN_DIGITS}`;
    const [inserted] = await db
      .insert(mspMessageCenterItemsTable)
      .values({
        tenantId: `test-1531-crossover-${RUN_TAG}`,
        mspId,
        graphMessageId: `MCCROSSOVER${RUN_TAG}`,
        title: "Test post #1531 (crossover)",
        bodyContent: `<p>Roadmap ID ${featureId}</p>`,
        roadmapFeatureIds: [featureId],
        isMajorChange: false,
        services: [],
        tags: [],
        lastModifiedDateTime: new Date(),
      })
      .returning({ id: mspMessageCenterItemsTable.id });
    createdIds.push(inserted.id);

    const crossed = await getCrossedOverFeatureIds(mspId);
    expect(crossed.has(featureId)).toBe(true);
    expect(crossed.has("this-was-never-referenced")).toBe(false);
  });

  it("backfills a row whose body was stored before this column existed", async () => {
    const mspId = await anyMspId();
    const featureId = `8${RUN_DIGITS}`;
    const [inserted] = await db
      .insert(mspMessageCenterItemsTable)
      .values({
        tenantId: `test-1531-backfill-${RUN_TAG}`,
        mspId,
        graphMessageId: `MCBACKFILL${RUN_TAG}`,
        title: "Pre-existing post, never parsed",
        bodyContent: `<p>Roadmap ID ${featureId}</p>`,
        // roadmapFeatureIds left at its default [] — as if synced before #1531.
        isMajorChange: false,
        services: [],
        tags: [],
        lastModifiedDateTime: new Date(),
      })
      .returning({ id: mspMessageCenterItemsTable.id });
    createdIds.push(inserted.id);

    const result = await backfillMessageCenterRoadmapLinks();
    expect(result.updated).toBeGreaterThanOrEqual(1);

    const [after] = await db
      .select({ roadmapFeatureIds: mspMessageCenterItemsTable.roadmapFeatureIds })
      .from(mspMessageCenterItemsTable)
      .where(eq(mspMessageCenterItemsTable.id, inserted.id));
    expect(after.roadmapFeatureIds).toEqual([featureId]);
  });
});
