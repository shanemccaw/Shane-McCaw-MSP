/**
 * useMessageCenter.ts — the one data seam for `/portal-v2/ms-changes`.
 *
 * Wraps `GET /api/portal/message-center` (api-server
 * `routes/portal-message-center.ts`), which is customer-scoped from the JWT and
 * serves the tenant's REAL Microsoft 365 Message Center — the posts
 * `message-center-sync.ts` pulls from Graph `/admin/serviceAnnouncement/messages`
 * on a daily schedule.
 *
 * ── Why not `/api/msp/message-center` ──────────────────────────────────────
 * That route is `requireRole("MSPOperator")` and takes an optional `customerId`
 * QUERY PARAM, so a customer-facing page pointed at it would either read every
 * tenant of the MSP or let the browser choose which tenant to read. The new
 * route takes no customer input at all. See its header.
 *
 * ── What this hook returns ────────────────────────────────────────────────
 * A whole `MscDataset`, never a partial one. Until the fetch resolves — and if
 * it fails, and for the surfaces the API genuinely cannot answer — the page gets
 * `FIXTURE_DATASET`, the design's own tenant, so it renders rather than
 * flickering through an empty state.
 *
 * The tenant-analysis surfaces (`queue`, `seen`, `groups`, `landed`, `raci`)
 * stay on the fixture even in the live dataset, because nothing in this build
 * produces them for Message Center posts. They are carried over WHOLE rather
 * than half-filled: a fixture write-up sitting under a real post's heading would
 * read as an analysis of that post, which is the one outcome worth avoiding.
 * `live` and `itemCount` let the page state which it is showing.
 *
 * ── fetchWithAuth in a ref ────────────────────────────────────────────────
 * It is rebuilt on every silent token refresh, so holding it in a dependency
 * array re-runs the effect mid-flight. Every polling hook in this codebase holds
 * it in a ref; this one does too (see `holds/useRunbooks.ts`).
 */

import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/lib/auth-context";

import {
  FIXTURE_DATASET,
  type MscBucket,
  type MscDataset,
  type MscDensityRow,
  type MscScan,
  type MscStatDef,
  type MsPost,
} from "./msChangesData";

const MESSAGE_CENTER_URL = "/api/portal/message-center";

/**
 * The Message Center syncs daily, so the page has no reason to poll. It reads
 * once per mount; a customer who leaves the tab open overnight gets the new
 * posts on their next navigation, which is the same cadence the data has.
 */

/** One post as the route sends it — the real Microsoft fields, nothing invented. */
interface WirePost {
  id: string;
  title: string;
  wl: string;
  workload: string;
  kind: string;
  hard: boolean;
  month: number;
  when: string;
  countdown: string;
  score: number;
  impact: string;
  bucket: number;
  ms: string;
  plain: string;
  msSays: string;
  services: string[];
  tags: string[];
  publishedAt: string;
  lastModifiedAt: string;
  actionRequiredBy: string | null;
}

interface WirePayload {
  scoped: boolean;
  itemCount: number;
  onAxisCount: number;
  postsTruncated: boolean;
  lastSyncedAt: string | null;
  scanAt: string | null;
  buckets: MscBucket[];
  waveShort: Record<string, string>;
  posts: WirePost[];
  density: MscDensityRow[];
  stats: MscStatDef[];
  workloads: MscScan[];
  provenance: {
    source: string;
    impactBasis: string;
    scoreBasis: string;
    notReadAgainstTenant: string;
  };
}

/**
 * Turns a wire post into the `MsPost` the page renders.
 *
 * Nine of the thirty-three fields have a real source. The rest are filled with
 * a STATED ABSENCE rather than a plausible-looking value: `youSay` says the
 * tenant has not been read against the notice, `evidence` is empty, `seats` is
 * unknown. The design's own copy is not reused here — a fixture's "1,240
 * mailboxes · 11 with legacy-auth activity" printed under a real customer's real
 * post would be a fabricated finding about their estate.
 */
function toPost(w: WirePost, notReadAgainstTenant: string): MsPost {
  return {
    id: w.id,
    title: w.title,
    wl: w.wl,
    workload: w.workload,
    kind: w.kind,
    hard: w.hard,
    month: w.month,
    when: w.when,
    countdown: w.countdown,
    score: w.score,
    impact: w.impact,
    bucket: w.bucket,

    // Real — Microsoft's own published text.
    ms: w.ms,
    msSays: w.msSays,
    // `plain` is the change in Shane's words. There is no write-up, so the page
    // falls back to Microsoft's own first paragraph rather than an empty panel.
    plain: w.plain || w.msSays,

    // No source: these need a read of the customer's own configuration.
    youSay: notReadAgainstTenant,
    evidence: [],
    evidenceNote: "",
    ignore: "",
    seats: w.services.join(" · ") || "Not measured against your tenant",

    // No source: opt-out terms are prose inside Microsoft's body text, not a
    // structured Graph field, so they are not asserted here.
    optOut: w.actionRequiredBy ? "Microsoft has published a deadline" : "Not stated in the post",
    optOutNote: "",
    owned: "",

    // No source: nothing links a Message Center post to a change request yet.
    crCode: "",
    crState: "",
    crNote: "",

    // No source: Graph does not return the rollout ring breakdown per tenant.
    phases: [],
    roadmapId: "",
    toldMs: w.publishedAt,
    toldYou: "",
    history: [],
    decisions: [],
    controls: w.tags,
    thread: [],
  };
}

export interface MessageCenterState {
  /** Always a whole dataset — the fixture until, and unless, the real one lands. */
  readonly dataset: MscDataset;
  readonly loaded: boolean;
  readonly error: string | null;
  /** How the numbers were arrived at, for the page to state on screen. */
  readonly provenance: WirePayload["provenance"] | null;
  readonly postsTruncated: boolean;
}

export function useMessageCenter(): MessageCenterState {
  const { fetchWithAuth } = useAuth();
  const fetchRef = useRef(fetchWithAuth);
  fetchRef.current = fetchWithAuth;

  const [state, setState] = useState<MessageCenterState>({
    dataset: FIXTURE_DATASET,
    loaded: false,
    error: null,
    provenance: null,
    postsTruncated: false,
  });

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const res = await fetchRef.current(MESSAGE_CENTER_URL, {}, { silent: true });
        if (!active) return;
        if (!res.ok) {
          setState((s) => ({ ...s, loaded: true, error: "Your Microsoft Message Center could not be loaded." }));
          return;
        }
        const body = (await res.json()) as WirePayload;
        if (!active) return;

        // An account with no connected tenant, or a tenant Microsoft has posted
        // nothing for, keeps the fixture rather than being shown an empty grid
        // that reads as "a clear twelve months".
        if (!body.scoped || !Array.isArray(body.posts) || body.posts.length === 0) {
          setState({
            dataset: FIXTURE_DATASET,
            loaded: true,
            error: null,
            provenance: body.provenance ?? null,
            postsTruncated: false,
          });
          return;
        }

        setState({
          dataset: {
            ...FIXTURE_DATASET,
            live: true,
            posts: body.posts.map((p) => toPost(p, body.provenance.notReadAgainstTenant)),
            density: body.density,
            buckets: body.buckets,
            stats: body.stats,
            scans: body.workloads,
            scanAt: body.scanAt ?? FIXTURE_DATASET.scanAt,
            waveShort: body.waveShort,
            // Live posts carry their own `bucket`; the fixture map would only
            // mis-place them, so it is emptied rather than left to shadow them.
            itemBucket: {},
            itemCount: body.itemCount,
          },
          loaded: true,
          error: null,
          provenance: body.provenance,
          postsTruncated: body.postsTruncated,
        });
      } catch {
        if (!active) return;
        setState((s) => ({ ...s, loaded: true, error: "Your Microsoft Message Center could not be loaded." }));
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, []);

  return state;
}
