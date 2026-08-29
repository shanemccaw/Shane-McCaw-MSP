/**
 * m365-roadmap-sync.ts  (#1530, part of #1494)
 *
 * Ingests the Microsoft 365 Roadmap into m365_roadmap_items from the PUBLIC,
 * unauthenticated release-communications API — no Graph, no consent, no tenant
 * scoping. The roadmap is a GLOBAL feed of what Microsoft *intends* to ship,
 * published months ahead of any tenant's Message Center post, so unlike
 * message-center-sync.ts / m365-health-sample.ts this does NOT iterate tenants
 * and does NOT go through graphFetchForTenant — it is a plain HTTPS fetch of a
 * public endpoint.
 *
 *   v1  https://www.microsoft.com/releasecommunications/api/v1/m365
 *        Legacy JSON array. 1,000+ items in ONE request — used for the nightly
 *        full snapshot (a single request, deliberately low-frequency).
 *   v2  https://www.microsoft.com/releasecommunications/api/v2/M365
 *        OData entity set, page size capped at 50 — used for targeted queries.
 *        A full sweep here is 20+ requests, so this path is bounded and only for
 *        targeted refresh, never the routine full snapshot.
 *
 * Cloud instance (Worldwide / GCC / GCC High / DoD) is persisted per item — in
 * v1 from tagsContainer.cloudInstances[].tagName, in v2 from the `availabilities`
 * complex type — because it is the source of truth for the standing gov/GCC
 * exclusion (#1537), enforced from real data rather than an assumption.
 *
 * HONEST DEGRADE (a hard requirement): Microsoft relocated this endpoint once
 * already (roadmap-api.azurewebsites.net -> www.microsoft.com, 15 Mar 2025). If
 * a fetch fails, redirects to a different origin, or returns a non-JSON / non-
 * array / empty body where 1,000+ items were expected, the sync records the
 * failure in m365_roadmap_sync_state (last_status='error', last_error, bumps
 * last_attempt_at) but LEAVES the existing items untouched and does NOT advance
 * last_success_at. Stale roadmap data is never presented as current, and empty
 * fixture content is never substituted — a reader compares last_success_at
 * against now to render an honest "roadmap not collected / stale" state.
 *
 * Invoked by the seeded "__system__: M365 Roadmap Sync" workflow (see
 * seed-system-workflows.ts) via the m365_roadmap_sync node type — a visible
 * Workflow Engine run, never a bare setInterval scheduler.
 */

import { db } from "@workspace/db";
import { m365RoadmapItemsTable, m365RoadmapSyncStateTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const log = logger.child({ channel: "integration.azure" });

const V1_URL = "https://www.microsoft.com/releasecommunications/api/v1/m365";
const V2_URL = "https://www.microsoft.com/releasecommunications/api/v2/M365";

/** Both feeds live under this origin post-relocation; a redirect off it is the
 * signal Microsoft has moved the endpoint again and the response can no longer
 * be trusted as the current roadmap. */
const EXPECTED_ORIGIN = "https://www.microsoft.com";

/** A v1 full snapshot is 1,000+ items; anything far below that is treated as a
 * degraded/partial response rather than "the roadmap shrank to nothing", so we
 * fail honestly instead of wiping the freshness signal. */
const V1_MIN_EXPECTED_ITEMS = 100;

/** Page size Microsoft caps v2 OData at. */
const V2_PAGE_SIZE = 50;

/** Bound on v2 paging so a targeted sweep stays deliberate and never looks like
 * scraping the whole 1,000+ set 50 at a time. */
const V2_DEFAULT_MAX_PAGES = 10;

const FETCH_TIMEOUT_MS = 30_000;

interface V1TagsContainer {
  products?: Array<{ tagName?: string | null }> | null;
  cloudInstances?: Array<{ tagName?: string | null }> | null;
  releasePhase?: Array<{ tagName?: string | null }> | null;
  releasePhases?: Array<{ tagName?: string | null }> | null;
  platforms?: Array<{ tagName?: string | null }> | null;
}

interface V1RoadmapItem {
  id?: string | number | null;
  title?: string | null;
  description?: string | null;
  status?: string | null;
  moreInfoLink?: string | null;
  publicDisclosureAvailabilityDate?: string | null;
  created?: string | null;
  modified?: string | null;
  tags?: string[] | null;
  tagsContainer?: V1TagsContainer | null;
}

interface V2Availability {
  cloudInstance?: string | null;
  ring?: string | null;
  releaseType?: string | null;
}

interface V2RoadmapItem {
  id?: string | number | null;
  title?: string | null;
  description?: string | null;
  status?: string | null;
  moreInfoLink?: string | null;
  publicDisclosureAvailabilityDate?: string | null;
  created?: string | null;
  modified?: string | null;
  tags?: string[] | null;
  products?: string[] | null;
  releasePhases?: string[] | null;
  platforms?: string[] | null;
  availabilities?: V2Availability[] | null;
}

export interface RoadmapSyncResult {
  source: "v1" | "v2";
  status: "ok" | "error";
  itemCount: number;
  newCount: number;
  updatedCount: number;
  errorMessage?: string;
}

function toDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Extracts a de-duplicated, trimmed, non-empty list of `tagName`s. */
function tagNames(arr: Array<{ tagName?: string | null }> | null | undefined): string[] {
  if (!Array.isArray(arr)) return [];
  const out = new Set<string>();
  for (const t of arr) {
    const name = t?.tagName?.trim();
    if (name) out.add(name);
  }
  return [...out];
}

function cleanStrings(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  const out = new Set<string>();
  for (const v of arr) {
    if (typeof v === "string" && v.trim()) out.add(v.trim());
  }
  return [...out];
}

/** Records the outcome of a sync attempt for one source feed. On error this is
 * the ONLY write the sync makes — items are left exactly as they were, and
 * last_success_at is not advanced, so a reader can tell fresh from stale. */
async function recordSyncState(
  source: "v1" | "v2",
  outcome: { status: "ok" | "error"; itemCount: number; errorMessage?: string },
): Promise<void> {
  const now = new Date();
  const base = {
    source,
    lastAttemptAt: now,
    lastStatus: outcome.status,
    lastError: outcome.status === "error" ? (outcome.errorMessage ?? "unknown error") : null,
    updatedAt: now,
  };
  await db
    .insert(m365RoadmapSyncStateTable)
    .values({
      ...base,
      lastSuccessAt: outcome.status === "ok" ? now : null,
      lastItemCount: outcome.status === "ok" ? outcome.itemCount : 0,
    })
    .onConflictDoUpdate({
      target: [m365RoadmapSyncStateTable.source],
      set: {
        lastAttemptAt: now,
        lastStatus: outcome.status,
        lastError: base.lastError,
        updatedAt: now,
        // On error, deliberately leave last_success_at and last_item_count as
        // they were — do NOT overwrite the last-good freshness signal.
        ...(outcome.status === "ok"
          ? { lastSuccessAt: now, lastItemCount: outcome.itemCount }
          : {}),
      },
    });
}

/** Fetches a URL as JSON, treating a relocation off the expected origin or a
 * non-JSON body as a hard failure (the honest-degrade signal). */
async function fetchRoadmapJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "follow",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} from ${url}`);
  }
  // Relocation detection: a redirect to a different origin means Microsoft has
  // moved the endpoint again — the body is no longer the trustworthy roadmap.
  if (res.redirected && !res.url.startsWith(EXPECTED_ORIGIN)) {
    throw new Error(`endpoint relocated: ${url} redirected to ${res.url}`);
  }
  const contentType = res.headers.get("content-type") ?? "";
  const body = await res.text();
  if (!contentType.includes("json") && !body.trimStart().startsWith("[") && !body.trimStart().startsWith("{")) {
    throw new Error(`non-JSON response from ${url} (content-type: ${contentType || "none"})`);
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`unparseable JSON response from ${url}`);
  }
}

/** Upserts one normalized item by feature_id. Returns whether it was new. */
async function upsertItem(values: typeof m365RoadmapItemsTable.$inferInsert): Promise<boolean> {
  const [existing] = await db
    .select({ id: m365RoadmapItemsTable.id })
    .from(m365RoadmapItemsTable)
    .where(eq(m365RoadmapItemsTable.featureId, values.featureId))
    .limit(1);

  if (existing) {
    await db
      .update(m365RoadmapItemsTable)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(m365RoadmapItemsTable.id, existing.id));
    return false;
  }
  await db.insert(m365RoadmapItemsTable).values(values);
  return true;
}

/**
 * Nightly full snapshot from the v1 feed — a single request returning 1,000+
 * items. This is the routine ingestion path.
 */
export async function syncM365RoadmapSnapshot(): Promise<RoadmapSyncResult> {
  try {
    const data = await fetchRoadmapJson(V1_URL);
    if (!Array.isArray(data)) {
      throw new Error("v1 response was not a JSON array (shape changed or endpoint moved)");
    }
    if (data.length < V1_MIN_EXPECTED_ITEMS) {
      throw new Error(
        `v1 returned only ${data.length} items (< ${V1_MIN_EXPECTED_ITEMS} expected) — treating as a degraded response, not wiping freshness`,
      );
    }

    const items = data as V1RoadmapItem[];
    const now = new Date();
    let newCount = 0;
    let updatedCount = 0;

    for (const item of items) {
      const featureId = item?.id != null ? String(item.id) : "";
      if (!featureId || !item.title) continue;

      const tc = item.tagsContainer ?? {};
      const values = {
        featureId,
        title: item.title,
        description: item.description ?? null,
        status: item.status ?? null,
        moreInfoLink: item.moreInfoLink ?? null,
        products: tagNames(tc.products),
        releasePhases: tagNames(tc.releasePhase ?? tc.releasePhases),
        platforms: tagNames(tc.platforms),
        cloudInstances: tagNames(tc.cloudInstances),
        tags: cleanStrings(item.tags),
        publicDisclosureAvailabilityDate: item.publicDisclosureAvailabilityDate ?? null,
        msCreated: toDate(item.created),
        msModified: toDate(item.modified),
        source: "v1" as const,
        raw: item as unknown as Record<string, unknown>,
        lastSeenAt: now,
        updatedAt: now,
      };

      const isNew = await upsertItem(values);
      if (isNew) newCount++;
      else updatedCount++;
    }

    await recordSyncState("v1", { status: "ok", itemCount: items.length });
    log.info({ itemCount: items.length, newCount, updatedCount }, "m365-roadmap-sync: v1 snapshot synced");
    return { source: "v1", status: "ok", itemCount: items.length, newCount, updatedCount };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await recordSyncState("v1", { status: "error", itemCount: 0, errorMessage });
    log.error({ err: errorMessage }, "m365-roadmap-sync: v1 snapshot failed — items left untouched, not marked fresh");
    return { source: "v1", status: "error", itemCount: 0, newCount: 0, updatedCount: 0, errorMessage };
  }
}

export interface RoadmapTargetedOptions {
  /** Raw OData $filter, e.g. `availabilities/any(a: a/cloudInstance eq 'GCC High')`. */
  filter?: string;
  /** OData $search term. */
  search?: string;
  /** Max 50-item pages to pull. Bounded so a targeted refresh stays deliberate. */
  maxPages?: number;
}

/**
 * Targeted refresh from the v2 OData feed (page size capped at 50). Bounded by
 * maxPages so a sweep never turns into scraping the full 1,000+ set. Writes the
 * same table with source="v2". Intended for targeted queries (e.g. re-checking a
 * cloud-instance slice), not the routine full snapshot — that is v1's job.
 */
export async function syncM365RoadmapTargeted(opts: RoadmapTargetedOptions = {}): Promise<RoadmapSyncResult> {
  const maxPages = Math.max(1, opts.maxPages ?? V2_DEFAULT_MAX_PAGES);
  try {
    const now = new Date();
    let newCount = 0;
    let updatedCount = 0;
    let total = 0;

    for (let page = 0; page < maxPages; page++) {
      const params = new URLSearchParams();
      params.set("$top", String(V2_PAGE_SIZE));
      params.set("$skip", String(page * V2_PAGE_SIZE));
      if (opts.filter) params.set("$filter", opts.filter);
      if (opts.search) params.set("$search", opts.search);

      const data = await fetchRoadmapJson(`${V2_URL}?${params.toString()}`);
      const value = (data as { value?: unknown })?.value;
      if (!Array.isArray(value)) {
        throw new Error("v2 response had no `value` array (shape changed or endpoint moved)");
      }
      if (value.length === 0) break; // reached the end of the result set

      for (const item of value as V2RoadmapItem[]) {
        const featureId = item?.id != null ? String(item.id) : "";
        if (!featureId || !item.title) continue;

        const cloudInstances = cleanStrings(
          (item.availabilities ?? []).map((a) => a?.cloudInstance).filter(Boolean),
        );

        const values = {
          featureId,
          title: item.title,
          description: item.description ?? null,
          status: item.status ?? null,
          moreInfoLink: item.moreInfoLink ?? null,
          products: cleanStrings(item.products),
          releasePhases: cleanStrings(item.releasePhases),
          platforms: cleanStrings(item.platforms),
          cloudInstances,
          tags: cleanStrings(item.tags),
          publicDisclosureAvailabilityDate: item.publicDisclosureAvailabilityDate ?? null,
          msCreated: toDate(item.created),
          msModified: toDate(item.modified),
          source: "v2" as const,
          raw: item as unknown as Record<string, unknown>,
          lastSeenAt: now,
          updatedAt: now,
        };

        const isNew = await upsertItem(values);
        if (isNew) newCount++;
        else updatedCount++;
        total++;
      }

      if (value.length < V2_PAGE_SIZE) break; // last (partial) page
    }

    await recordSyncState("v2", { status: "ok", itemCount: total });
    log.info({ itemCount: total, newCount, updatedCount, maxPages }, "m365-roadmap-sync: v2 targeted synced");
    return { source: "v2", status: "ok", itemCount: total, newCount, updatedCount };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await recordSyncState("v2", { status: "error", itemCount: 0, errorMessage });
    log.error({ err: errorMessage }, "m365-roadmap-sync: v2 targeted failed — items left untouched, not marked fresh");
    return { source: "v2", status: "error", itemCount: 0, newCount: 0, updatedCount: 0, errorMessage };
  }
}

/**
 * Workflow node handler for the m365_roadmap_sync node type
 * (workflow-executor.ts's executeNode switch). Defaults to the v1 nightly full
 * snapshot; pass mode:"v2" with an OData filter/search for a targeted refresh.
 */
export async function handleM365RoadmapSync(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const mode = payload?.mode === "v2" ? "v2" : "v1";
  const result =
    mode === "v2"
      ? await syncM365RoadmapTargeted({
          filter: typeof payload.filter === "string" ? payload.filter : undefined,
          search: typeof payload.search === "string" ? payload.search : undefined,
          maxPages: typeof payload.maxPages === "number" ? payload.maxPages : undefined,
        })
      : await syncM365RoadmapSnapshot();

  return {
    source: result.source,
    syncStatus: result.status,
    itemCount: result.itemCount,
    newCount: result.newCount,
    updatedCount: result.updatedCount,
    errorMessage: result.errorMessage ?? null,
  };
}

/** Reads the current freshness signal for a source feed — the backing for a
 * reader's honest fresh/stale/not-collected decision (no fixture fallback). */
export async function getRoadmapSyncState(source: "v1" | "v2" = "v1") {
  const [row] = await db
    .select()
    .from(m365RoadmapSyncStateTable)
    .where(eq(m365RoadmapSyncStateTable.source, source))
    .limit(1);
  return row ?? null;
}
