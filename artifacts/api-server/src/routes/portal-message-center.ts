/**
 * portal-message-center.ts — the CUSTOMER-scoped Microsoft 365 Message Center.
 *
 *   GET /api/portal/message-center — this customer's own Message Center posts,
 *     shaped into the dataset the Customer Portal v2 "Microsoft Changes" page
 *     is drawn from.
 *
 * ── Why this route exists, given `msp-message-center.ts` already serves this ──
 * Because that route cannot be pointed at a customer. It is
 * `requireRole("MSPOperator")`, scoped by `resolveMspIdStrict`, and takes an
 * OPTIONAL `customerId` QUERY PARAM:
 *
 *     GET /api/msp/message-center?customerId=3
 *
 * Two things follow from that shape, and both are disqualifying here. Without
 * the param it returns every Message Center item for every tenant of the MSP —
 * one customer reading another customer's estate. With the param, the customer
 * being read is whatever the CALLER TYPED IN THE URL. Widening its role floor to
 * let customers in would turn that query param into an unauthenticated tenant
 * selector: `?customerId=1`, `?customerId=2`, walk the id space.
 *
 * So this route takes no customer input of any kind. The customer is
 * `resolveCustomerId(req)` — the JWT's own `customerId` claim, a `tenants.id`,
 * put there by the token issuer — and nothing on the request can influence it.
 * There is deliberately no `customerId` param on this route to ignore: a param
 * that is accepted and then discarded is one refactor away from being honoured.
 *
 * ── Scoping shape: customerId alone, not the (mspId, tenantId) pair ────────
 * `portal-change-control.ts` needs BOTH predicates because `msp_change_requests`
 * predates the portal and is keyed on a free-text `tenant_id` with no foreign
 * key. `msp_message_center_items` is not that shape — it carries a real
 * `customer_id` column (a `tenants.id`, written by `message-center-sync.ts` from
 * the `tenants` row that owns the tenant GUID), which is exactly the JWT's own
 * id space. So `eq(customerId, <from JWT>)` is the whole scope.
 *
 * `mspId` is nonetheless included as a second predicate. It is not needed for
 * correctness — `customer_id` is unique across MSPs — but it is free, it is the
 * partner-isolation boundary every other MSP-era table is filtered on, and it
 * means a future writer that populated `customer_id` loosely cannot widen this
 * read. It is resolved from the tenants row, never from the request.
 *
 * ── FAIL CLOSED on a null customer_id ─────────────────────────────────────
 * `msp_message_center_items.customer_id` is NULLABLE (no FK, by design — see the
 * schema's own comment). `resolveCustomerId` returns a number or null and the
 * handler answers 403 on null, so a token without the claim never reaches a
 * query. The nullable column itself is safe: `eq(customer_id, 4)` never matches
 * a NULL row in SQL. The dangerous shape would be a blank-string scope of the
 * kind `portal-change-control.ts` guards against, and this route has no
 * free-text predicate to have that problem with.
 *
 * ── Role floor: `CustomerUser`, as specified ──────────────────────────────
 * MSP_ROLES ranks PlatformAdmin, MSPAdmin, MSPOperator, CustomerUser,
 * ServiceAccount, Free, Assessment — so `requireRole("CustomerUser")` admits
 * paying customers and MSP staff, and excludes Free and Assessment tiers. That
 * is a deliberately higher floor than `portal-change-control.ts`'s `Assessment`:
 * this page reads the customer's connected Microsoft 365 tenant, which a free
 * assessment account has no entitlement to. The floor decides which TIER may
 * open the page; it is NOT what prevents a cross-tenant read — the
 * JWT-only scoping above is.
 *
 * ── Read-only, deliberately ───────────────────────────────────────────────
 * No writes of any kind. The daily sync (`message-center-sync.ts`, wired in
 * index.ts) is the only writer of this table, and the page's own actions
 * — snooze, record a decision, brief the wave — write to change control and
 * hold windows, not here.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, mspMessageCenterItemsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";

import { requireRole } from "../middlewares/requireAuth";
import { resolveCustomerId, resolveTenantScope } from "../lib/portal-customer-scope";
import { logger } from "../lib/logger";
import {
  buildBuckets,
  buildDensity,
  buildStats,
  bucketForDate,
  capPerWave,
  effectiveDate,
  formatCountdown,
  formatScanAt,
  formatWhen,
  htmlToText,
  impactForPost,
  kindForPost,
  kindLabel,
  scoreForPost,
  waveShort,
  workloadFound,
  workloadForPost,
  WORKLOAD_NAMES,
  type Bucket,
  type MessageCenterRow,
} from "../lib/portal-message-center";

const log = logger.child({ channel: "integration.azure" });

const router: IRouter = Router();

/**
 * How many posts are shaped for the wire, PER WAVE.
 *
 * The live testbed tenant holds 501 items and a busy enterprise will hold more.
 * Every one of them is COUNTED — the density grid, the stat cards and the wave
 * totals are computed over the whole corpus before this cap applies — but only
 * the highest-scoring posts are shaped into full post objects with their body
 * text, because the page lists posts a wave at a time and a megabyte of
 * Microsoft prose the reader will never scroll to is not worth the transfer.
 *
 * ── Why PER WAVE and not one global cap ───────────────────────────────────
 * A single global cap applied to a bucket-ordered list starves the far end of
 * the axis: on the real testbed tenant, 449 posts land on the axis and a flat
 * top-240 filled up inside the first four buckets, so the Q3 and Q4 waves came
 * back with NO posts at all. The page is wave-navigable — "pick a wave and the
 * page becomes that wave" — so those waves rendered their empty states, and
 * this page's empty states are ASSERTIONS about the customer's estate
 * ("Nothing in this wave stops working here"). A transfer optimisation must
 * never make the page state something untrue about a wave it simply did not
 * send, so the budget is spent per wave instead: every wave keeps its own
 * highest-scoring posts, and a wave is empty on screen only when it is empty
 * in the data.
 *
 * The cap is reported on the wire as `postsTruncated` rather than left silent.
 */
const POSTS_PER_WAVE = 60;

/** One post, in the shape the page's `MsPost` expects. */
interface WirePost {
  readonly id: string;
  readonly title: string;
  readonly wl: string;
  readonly workload: string;
  readonly kind: string;
  readonly hard: boolean;
  readonly month: number;
  readonly when: string;
  readonly countdown: string;
  readonly score: number;
  readonly impact: string;
  readonly bucket: number;
  readonly ms: string;
  readonly plain: string;
  readonly msSays: string;
  readonly services: readonly string[];
  readonly tags: readonly string[];
  readonly publishedAt: string;
  readonly lastModifiedAt: string;
  readonly actionRequiredBy: string | null;
}

/**
 * The stated-absence copy for the tenant-analysis half of a post.
 *
 * The design's post detail sets Microsoft's words beside the tenant's counted
 * answer. The first half is real. The second half needs a read of the customer's
 * own configuration, which nothing in this build performs for Message Center
 * posts, so the page is told plainly that it has not been done rather than being
 * handed an invented count. See the module header of `lib/portal-message-center.ts`.
 */
const NOT_READ_AGAINST_TENANT =
  "Your tenant has not been read against this notice. What Microsoft published is above; the count of what it touches in your estate is not something this page has measured.";

function toWirePost(row: MessageCenterRow, buckets: readonly Bucket[], now: Date): WirePost {
  const when = effectiveDate(row);
  const wl = workloadForPost(row.services);
  const body = row.bodyContent ? htmlToText(row.bodyContent) : "";

  return {
    id: row.graphMessageId,
    title: row.title,
    wl,
    workload: row.services[0] ?? WORKLOAD_NAMES[wl],
    kind: kindLabel(row),
    hard: kindForPost(row) === "b",
    // The design's `month` indexes a twelve-month calendar from the axis start.
    month: Math.max(0, (when.getUTCFullYear() - now.getUTCFullYear()) * 12 + when.getUTCMonth() - now.getUTCMonth()),
    when: formatWhen(when),
    countdown: formatCountdown(when, now),
    score: scoreForPost(row, now),
    impact: impactForPost(row),
    bucket: bucketForDate(when, buckets),
    ms: body,
    // `plain` is "the same change in Shane's words" — a human write-up. There
    // isn't one, and paraphrasing Microsoft with a regex would be a worse lie
    // than an empty string, so the page falls back to Microsoft's own words.
    plain: "",
    msSays: body.split("\n")[0] ?? "",
    services: row.services,
    tags: row.tags,
    publishedAt: (row.startDateTime ?? row.lastModifiedDateTime).toISOString(),
    lastModifiedAt: row.lastModifiedDateTime.toISOString(),
    actionRequiredBy: row.actionRequiredByDateTime?.toISOString() ?? null,
  };
}

router.get(
  "/portal/message-center",
  requireRole("CustomerUser"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      const scope = await resolveTenantScope(customerId);
      const now = new Date();
      const buckets = buildBuckets(now);

      if (!scope) {
        // Not an error: an account with no resolvable tenant row simply has no
        // Message Center to read. `scoped:false` lets the page say so instead of
        // rendering an empty grid that looks like a clear month.
        log.info({ customerId }, "portal-message-center: no resolvable tenant scope");
        res.json({ scoped: false, itemCount: 0, posts: [], density: [], buckets, stats: [], workloads: [] });
        return;
      }

      const rows = await db
        .select({
          graphMessageId: mspMessageCenterItemsTable.graphMessageId,
          title: mspMessageCenterItemsTable.title,
          category: mspMessageCenterItemsTable.category,
          isMajorChange: mspMessageCenterItemsTable.isMajorChange,
          services: mspMessageCenterItemsTable.services,
          tags: mspMessageCenterItemsTable.tags,
          bodyContent: mspMessageCenterItemsTable.bodyContent,
          startDateTime: mspMessageCenterItemsTable.startDateTime,
          endDateTime: mspMessageCenterItemsTable.endDateTime,
          actionRequiredByDateTime: mspMessageCenterItemsTable.actionRequiredByDateTime,
          lastModifiedDateTime: mspMessageCenterItemsTable.lastModifiedDateTime,
          lastSeenAt: mspMessageCenterItemsTable.lastSeenAt,
        })
        .from(mspMessageCenterItemsTable)
        // Both predicates resolved from the token, never from the request.
        .where(
          and(
            eq(mspMessageCenterItemsTable.customerId, scope.customerId),
            eq(mspMessageCenterItemsTable.mspId, scope.mspId),
          ),
        )
        .orderBy(desc(mspMessageCenterItemsTable.lastModifiedDateTime));

      const corpus: readonly MessageCenterRow[] = rows.map((r) => ({
        graphMessageId: r.graphMessageId,
        title: r.title,
        category: r.category,
        isMajorChange: r.isMajorChange,
        services: Array.isArray(r.services) ? r.services : [],
        tags: Array.isArray(r.tags) ? r.tags : [],
        bodyContent: r.bodyContent,
        startDateTime: r.startDateTime,
        endDateTime: r.endDateTime,
        actionRequiredByDateTime: r.actionRequiredByDateTime,
        lastModifiedDateTime: r.lastModifiedDateTime,
        lastSeenAt: r.lastSeenAt,
      }));

      // Everything below is computed over the WHOLE corpus. Only the post list
      // is capped — see POSTS_PER_WAVE.
      const density = buildDensity(corpus, buckets);
      const stats = buildStats(corpus, buckets, now);

      const onAxis = corpus.filter((r) => bucketForDate(effectiveDate(r), buckets) >= 0);
      const shaped = onAxis
        .map((r) => toWirePost(r, buckets, now))
        .sort((a, b) => (a.bucket === b.bucket ? b.score - a.score : a.bucket - b.bucket));

      // The budget is spent per WAVE, so no wave is starved by a busier one
      // earlier on the axis. See capPerWave's header for what went wrong with a
      // flat cap on the real tenant.
      const posts = capPerWave(shaped, buckets, POSTS_PER_WAVE);

      const lastSeen = corpus.reduce<Date | null>(
        (acc, r) => (acc === null || r.lastSeenAt > acc ? r.lastSeenAt : acc),
        null,
      );

      const workloads = density.map((d) => ({
        wl: d.wl,
        name: d.name,
        found: workloadFound(corpus, d.wl, buckets),
      }));

      log.info(
        { customerId, mspId: scope.mspId, itemCount: corpus.length, onAxis: onAxis.length, posts: posts.length },
        "portal-message-center: served customer Message Center",
      );

      res.json({
        scoped: true,
        /** Everything Microsoft has posted for this tenant, including past rollouts. */
        itemCount: corpus.length,
        /** The subset that lands inside the eleven-bucket forward axis. */
        onAxisCount: onAxis.length,
        postsTruncated: shaped.length > posts.length,
        lastSyncedAt: lastSeen?.toISOString() ?? null,
        scanAt: lastSeen ? formatScanAt(lastSeen) : null,
        buckets,
        waveShort: waveShort(buckets),
        posts,
        density,
        stats,
        workloads,
        /**
         * What the numbers above are, and are not. The page shows this rather
         * than letting a reader assume their tenant was scanned.
         */
        provenance: {
          source: "Microsoft 365 Message Center via Graph /admin/serviceAnnouncement/messages",
          impactBasis:
            "Microsoft's own category and tags for posts targeted at your tenant. Not a read of your tenant's configuration.",
          scoreBasis:
            "How prominently Microsoft flagged the post and how soon it lands. Not a per-tenant impact measurement.",
          notReadAgainstTenant: NOT_READ_AGAINST_TENANT,
        },
      });
    } catch (err) {
      log.error({ err, customerId }, "GET /portal/message-center failed");
      res.status(500).json({ error: "Failed to load your Microsoft Message Center" });
    }
  },
);

export default router;
