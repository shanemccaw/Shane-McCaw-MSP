/**
 * configStateLive.ts — the Configuration State page's real data (Git #3004, part
 * of #3002/#1485).
 *
 *   GET /api/portal/config-state/snapshots
 *   GET /api/portal/config-state/snapshots/current
 *   GET /api/portal/config-state/snapshots/:id
 *   GET /api/portal/config-state/changes
 *   GET /api/portal/config-state/changes/:diffId
 *
 * served by `artifacts/api-server/src/routes/portal-config-state.ts`, scoped to the
 * calling customer's own tenant (JWT `customerId`, which IS `tenants.id` — there is
 * no `?tenantId=` on this router and never will be, see that file's header).
 *
 * Every number this page renders comes from one of the five calls above — there is
 * no `configStateData.ts` fixture module. A failed initial read is reported as its
 * own `dataState: "fixture"` (the read itself never resolved) — never silently
 * substituted with invented rows (HARD RULE).
 *
 * The drill-down side panel (`lpOpen`/`lpRows`/`lpNote` in the landed design) is
 * real, per-click data: a workload panel opens instantly from the already-fetched
 * roll-up and then lazily fetches that workload's real resource rows to compute the
 * most common unread reason (`config-state-views.ts`'s own §4.2 style of reporting,
 * done live instead of copied from a point-in-time contract pack); a change-group
 * panel lazily fetches that resource's real change rows; "why nothing was
 * comparable" and "why so many are unattributed" read from data already on hand.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import {
  buildAttrPills,
  buildChangeGroups,
  buildKindChips,
  buildLegend,
  buildSegments,
  completenessTotals,
  fmt,
  fmtSnapDateTime,
  fmtSnapWhen,
  groupByNotComparableReason,
  groupChangesByKind,
  largestGroupLine,
  mostCommonUnreadReason,
  pctLine,
  shortResourceKey,
  type ChangeGroup,
  type ChangesOverviewResponse,
  type CurrentSnapshotResponse,
  type DiffChangesResponse,
  type DiffResourcesResponse,
  type SnapshotDocumentResponse,
  type SnapshotsListResponse,
  type WireAttributionRollup,
  type WireCompleteness,
  type WireDiffCompleteness,
  type WireSnapshotHeader,
  type WireSnapshotSummary,
  type WireWorkloadRollup,
} from "./configStateWire";

const BASE = "/api/portal/config-state";

export type ConfigStateDataState = "loading" | "live" | "fixture" | "never-collected";

export interface PanelSpec {
  readonly title: string;
  readonly state: string;
  readonly rows: readonly { readonly k: string; readonly v: string }[];
  readonly note: string | null;
  readonly loading: boolean;
}

export interface CurrentSnapshotView {
  readonly header: WireSnapshotHeader;
  readonly completeness: WireCompleteness;
  readonly workloads: readonly WireWorkloadRollup[];
  readonly meta: string;
  readonly answered: number;
  readonly segments: ReturnType<typeof buildSegments>;
  readonly legend: ReturnType<typeof buildLegend>;
  readonly fracLine: string;
}

export type ChangesView =
  | { readonly kind: "unavailable"; readonly reason: string; readonly detail: string }
  | {
      readonly kind: "nothing-comparable";
      readonly meta: string;
      readonly targeted: number;
      readonly compared: number;
      readonly detail: string;
    }
  | {
      readonly kind: "full";
      readonly meta: string;
      readonly diffId: string;
      readonly diffRowId: number;
      readonly changesSignificant: number;
      readonly changeTypeCount: number;
      readonly notComparableCount: number;
      readonly changeGroups: readonly ChangeGroup[];
      readonly kindChips: readonly { readonly kind: string; readonly n: number }[];
      readonly attribution: WireAttributionRollup | null;
      readonly footnote: string | null;
      readonly ignoredCount: number;
    };

export interface ConfigStateLiveState {
  readonly dataState: ConfigStateDataState;
  readonly neverCollectedDetail: string | null;
  readonly current: CurrentSnapshotView | null;
  readonly history: readonly WireSnapshotSummary[];
  readonly historyTotal: number;
  readonly changes: ChangesView | null;
  readonly panel: PanelSpec | null;
  readonly closePanel: () => void;
  readonly openWorkloadPanel: (w: WireWorkloadRollup) => void;
  readonly openChangeGroupPanel: (g: ChangeGroup) => void;
  readonly openNotComparablePanel: () => void;
  readonly openAttributionPanel: () => void;
  readonly openHistoryPanel: (h: WireSnapshotSummary) => void;
  readonly refetch: () => void;
}

export function useConfigStateLive(): ConfigStateLiveState {
  const { fetchWithAuth } = useAuth();
  const [dataState, setDataState] = useState<ConfigStateDataState>("loading");
  const [neverCollectedDetail, setNeverCollectedDetail] = useState<string | null>(null);
  const [current, setCurrent] = useState<CurrentSnapshotView | null>(null);
  const [history, setHistory] = useState<readonly WireSnapshotSummary[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [changes, setChanges] = useState<ChangesView | null>(null);
  const [panel, setPanel] = useState<PanelSpec | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Cached raw payloads the panel builders reuse rather than re-fetching.
  const notComparableResourcesRef = useRef<DiffResourcesResponse["resources"] | undefined>(undefined);

  const refetch = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setDataState("loading");
    void (async () => {
      try {
        const res = await fetchWithAuth(`${BASE}/snapshots/current`, undefined, { silent: true });
        if (!res.ok) throw new Error(`config-state/snapshots/current ${res.status}`);
        const body = (await res.json()) as CurrentSnapshotResponse;
        if (cancelled) return;

        if (!body.collected || !body.snapshot || !body.completeness) {
          setDataState("never-collected");
          setNeverCollectedDetail(body.detail ?? null);
          setCurrent(null);
          return;
        }

        const totals = completenessTotals(body.completeness);
        const answered = body.completeness.resourceTypesCollected + body.completeness.resourceTypesEmpty;
        setCurrent({
          header: body.snapshot,
          completeness: body.completeness,
          workloads: body.workloads ?? [],
          meta:
            `Captured ${fmtSnapDateTime(body.completeness.capturedAt)} · ${body.snapshot.trigger}` +
            (body.completeness.collectorVersion ? ` · collector ${body.completeness.collectorVersion}` : ""),
          answered,
          segments: buildSegments(totals, body.completeness.resourceTypesTargeted),
          legend: buildLegend(totals),
          fracLine: pctLine(body.completeness.readableFraction),
        });
        setDataState("live");

        // History + changes only make sense once a snapshot exists.
        void loadHistory();
        void loadChanges();
      } catch (err: unknown) {
        if (cancelled) return;
        setDataState("fixture");
        setCurrent(null);
        // eslint-disable-next-line no-console
        console.error("configStateLive: current snapshot read failed", err);
      }
    })();

    async function loadHistory() {
      try {
        const res = await fetchWithAuth(`${BASE}/snapshots?limit=10`, undefined, { silent: true });
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as SnapshotsListResponse;
        if (cancelled) return;
        setHistory(body.snapshots);
        setHistoryTotal(body.paging.total);
      } catch {
        // Non-fatal — the current-snapshot card already rendered live data; history
        // simply stays empty rather than failing the whole page.
      }
    }

    async function loadChanges() {
      try {
        const res = await fetchWithAuth(`${BASE}/changes?limit=1000`, undefined, { silent: true });
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as ChangesOverviewResponse;
        if (cancelled) return;

        if (!body.available || !body.comparison) {
          setChanges({
            kind: "unavailable",
            reason: body.reason ?? "unknown",
            detail: body.detail ?? "This comparison is not available yet.",
          });
          return;
        }

        const dc = body.completeness as WireDiffCompleteness;
        notComparableResourcesRef.current = body.notComparable?.resources ?? [];

        if (dc.resourceTypesCompared === 0 && dc.changesSignificant === 0) {
          setChanges({
            kind: "nothing-comparable",
            meta: `Comparison ${body.comparison.diffId.slice(0, 8)}`,
            targeted: dc.resourceTypesCompared + dc.resourceTypesPartial + dc.resourceTypesNotComparable,
            compared: dc.resourceTypesCompared,
            detail:
              `The newer snapshot answered 0 of its ${fmt(
                dc.resourceTypesCompared + dc.resourceTypesPartial + dc.resourceTypesNotComparable,
              )} targeted resource types, so no resource could be compared. 0 changes here is not an all-clear.`,
          });
          return;
        }

        // Per-resource breakdown, needed for changeGroups + the not-comparable panel's
        // group-by. Fetched once, right after the overview resolves.
        const diffId = body.comparison.diffId;
        const [resourcesRes, changesRes] = await Promise.all([
          fetchWithAuth(`${BASE}/changes/${diffId}?view=resources&limit=1000`, undefined, { silent: true }),
          fetchWithAuth(`${BASE}/changes/${diffId}?view=changes&limit=1`, undefined, { silent: true }),
        ]);
        const resourcesBody: DiffResourcesResponse = resourcesRes.ok
          ? ((await resourcesRes.json()) as DiffResourcesResponse)
          : { resources: [] };
        const changesBody: DiffChangesResponse = changesRes.ok
          ? ((await changesRes.json()) as DiffChangesResponse)
          : { changes: [], byKind: [] };
        if (cancelled) return;

        const changeGroups = buildChangeGroups(resourcesBody.resources);
        const kindChips = buildKindChips(changesBody.byKind);
        const changeTypeCount = resourcesBody.resources.filter((r) => r.changesSignificant > 0).length;

        setChanges({
          kind: "full",
          meta: `Comparison ${diffId.slice(0, 8)}`,
          diffId,
          diffRowId: body.comparison.diffRowId,
          changesSignificant: dc.changesSignificant,
          changeTypeCount,
          notComparableCount: body.notComparable?.count ?? dc.resourceTypesNotComparable,
          changeGroups,
          kindChips,
          attribution: body.attribution ?? null,
          footnote: largestGroupLine(changeGroups, dc.changesSignificant),
          ignoredCount: dc.changesIgnored,
        });
      } catch (err: unknown) {
        if (cancelled) return;
        // Non-fatal — the current-snapshot card is the primary content; the changes
        // section simply reports it could not be read.
        setChanges({
          kind: "unavailable",
          reason: "read_failed",
          detail: err instanceof Error ? err.message : "Could not read your configuration change report.",
        });
      }
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchWithAuth, attempt]);

  const closePanel = useCallback(() => setPanel(null), []);

  const openWorkloadPanel = useCallback(
    (w: WireWorkloadRollup) => {
      setPanel({
        title: w.workload,
        state: `${fmt(w.resourceTypes)} resource types · ${fmt(w.objectCount)} objects`,
        rows: [
          { k: `Collected · ${w.totals.collected}`, v: "Read successfully, objects stored" },
          { k: `Empty · ${w.totals.empty}`, v: "Read successfully, genuinely zero" },
          { k: `Partial · ${w.totals.partial}`, v: "Truncated set — absences unknown" },
          { k: `Skipped · ${w.totals.skipped}`, v: "Not attempted — reason stored per row" },
          { k: `Failed · ${w.totals.failed}`, v: "Attempted, refused — evidence stored per row" },
        ],
        note: null,
        loading: true,
      });
      if (!current) return;
      void (async () => {
        try {
          const res = await fetchWithAuth(
            `${BASE}/snapshots/${current.header.id}?workload=${encodeURIComponent(w.workload)}&limit=1000`,
            undefined,
            { silent: true },
          );
          if (!res.ok) throw new Error(`snapshot document ${res.status}`);
          const body = (await res.json()) as SnapshotDocumentResponse;
          const note = mostCommonUnreadReason(body.resources);
          setPanel((p) =>
            p && p.title === w.workload
              ? { ...p, note: note ?? "Every resource type in this workload was read successfully.", loading: false }
              : p,
          );
        } catch {
          setPanel((p) => (p && p.title === w.workload ? { ...p, note: "Could not load this workload's detail.", loading: false } : p));
        }
      })();
    },
    [current, fetchWithAuth],
  );

  const openChangeGroupPanel = useCallback(
    (g: ChangeGroup) => {
      const cv = changes;
      setPanel({
        title: g.shortKey,
        state: `${fmt(g.n)} changes · ${g.workload} · ${g.resourceKey}`,
        rows: [],
        note: null,
        loading: true,
      });
      if (!cv || cv.kind !== "full") return;
      void (async () => {
        try {
          const res = await fetchWithAuth(
            `${BASE}/changes/${cv.diffId}?view=changes&resourceKey=${encodeURIComponent(g.resourceKey)}&limit=500`,
            undefined,
            { silent: true },
          );
          if (!res.ok) throw new Error(`diff changes ${res.status}`);
          const body = (await res.json()) as DiffChangesResponse;
          const rows = groupChangesByKind(body.changes);
          const note = g.partial
            ? "This resource type is partially comparable — its object set was truncated on at least one side, so absences are unknown and never read as deletions."
            : "Rows keep their stored sequence — the order is part of the result.";
          setPanel((p) => (p && p.title === g.shortKey ? { ...p, rows, note, loading: false } : p));
        } catch {
          setPanel((p) => (p && p.title === g.shortKey ? { ...p, note: "Could not load this resource's changes.", loading: false } : p));
        }
      })();
    },
    [changes, fetchWithAuth],
  );

  const openNotComparablePanel = useCallback(() => {
    const cv = changes;
    if (!cv) return;
    const resources = notComparableResourcesRef.current ?? [];
    if (cv.kind === "nothing-comparable") {
      setPanel({
        title: "Could not be compared",
        state: `${fmt(cv.targeted)} of ${fmt(cv.targeted)} resource types`,
        rows: [{ k: "Head snapshot answered nothing", v: "Every targeted resource type failed on the new side" }],
        note:
          "At least one side did not successfully read these resources, so no object-level or property-level difference can be asserted.",
        loading: false,
      });
      return;
    }
    if (cv.kind !== "full") return;
    setPanel({
      title: "Could not be compared",
      state: `${fmt(cv.notComparableCount)} resource types`,
      rows: groupByNotComparableReason(resources),
      note:
        "At least one side did not successfully read these resources, so no object-level or property-level difference can be asserted. This is explicitly not a report that anything was added or removed.",
      loading: false,
    });
  }, [changes]);

  const openAttributionPanel = useCallback(() => {
    const cv = changes;
    if (!cv || cv.kind !== "full") return;
    const attribution = cv.attribution;
    const rows: { k: string; v: string }[] = [];
    if (attribution) {
      if (attribution.changeRequests.length === 0) {
        rows.push({ k: "No Change Requests explain any part of this comparison", v: "0 real, executed Change Request rows matched" });
      } else {
        for (const cr of attribution.changeRequests) {
          rows.push({ k: cr.ref ?? `Change Request #${cr.id}`, v: `Covers ${fmt(cr.changes)} changed row(s) in this comparison` });
        }
      }
      if (attribution.riskDecisions.length === 0) {
        rows.push({ k: "No accepted risk decisions cover this comparison", v: "0 active risk-decision rows matched" });
      } else {
        for (const rd of attribution.riskDecisions) {
          rows.push({ k: rd.ref ?? `Risk decision #${rd.id}`, v: `Covers ${fmt(rd.changes)} changed row(s) in this comparison` });
        }
      }
    }
    setPanel({
      title: "Why so many are unattributed",
      state: `${fmt(cv.changesSignificant)} changes · attribution pass ${attribution?.attributed ? "has run" : "has not run yet"}`,
      rows,
      note:
        "As Change Control and the Risk Register record real activity for this tenant, the same rows re-attribute on the next read — attribution never blocks or edits the underlying comparison.",
      loading: false,
    });
  }, [changes]);

  const openHistoryPanel = useCallback((h: WireSnapshotSummary) => {
    const c = h.completeness;
    setPanel({
      title: `Snapshot #${h.id}`,
      state: `${fmtSnapWhen(h.capturedAt)} · ${h.trigger} · ${h.status}`,
      rows: [
        { k: `Targeted · ${fmt(c.resourceTypesTargeted)}`, v: "Resource types this collection attempted" },
        { k: `Answered · ${fmt(c.resourceTypesCollected + c.resourceTypesEmpty)}`, v: "Collected + empty — both are real answers" },
        { k: `Skipped · ${fmt(c.resourceTypesSkipped)}`, v: "Not attempted at all" },
        { k: `Failed · ${fmt(c.resourceTypesFailed)}`, v: "Attempted, refused" },
        { k: `Objects stored · ${fmt(c.objectCount)}`, v: "Real stored objects across every collected resource" },
      ],
      note:
        h.status === "sealed"
          ? "Sealed means immutable — it says nothing about completeness; the status split above answers that separately."
          : `This snapshot is ${h.status} — see its own status for why it never sealed.`,
      loading: false,
    });
  }, []);

  return useMemo(
    () => ({
      dataState,
      neverCollectedDetail,
      current,
      history,
      historyTotal,
      changes,
      panel,
      closePanel,
      openWorkloadPanel,
      openChangeGroupPanel,
      openNotComparablePanel,
      openAttributionPanel,
      openHistoryPanel,
      refetch,
    }),
    [
      dataState,
      neverCollectedDetail,
      current,
      history,
      historyTotal,
      changes,
      panel,
      closePanel,
      openWorkloadPanel,
      openChangeGroupPanel,
      openNotComparablePanel,
      openAttributionPanel,
      openHistoryPanel,
      refetch,
    ],
  );
}

export { shortResourceKey };
