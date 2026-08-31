/**
 * Config Diff Report (Git #1798) — render a computed configuration diff (#1797) as a
 * change document: what moved, from what to what, and what could not be compared.
 *
 * A findings report says what is wrong; this says what CHANGED. Absence,
 * unreadability and deletion are rendered as the three different things #1797's store
 * makes them — a resource that could not be compared shows its real reason and emits
 * no change rows, rather than being folded into "no changes" or "deleted".
 *
 * Every number comes from `/api/admin/config-diffs*`. No fixture module, no invented
 * rows. Deltas (added/removed/changed) use teal, never a severity colour — an
 * improvement or a change is not a judgement.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ChevronDown, ChevronRight, GitCompare, ArrowRight, Layers } from "lucide-react";
import {
  ReportShell, Panel, Heading, SeverityBadge, StatTile, EmptyState, SeverityDot,
} from "./configReport/components";
import {
  pctOrNull, severityForPct, SEVERITY_COLOR, INK, HAIRLINE_BORDER, TEAL,
} from "./configReport/theme";

const COMPARABILITY_SEVERITY: Record<string, "healthy" | "attention" | "critical"> = {
  comparable: "healthy",
  partially_comparable: "attention",
  not_comparable: "critical",
};

interface DiffListRow {
  diffId: string;
  diffRowId: number;
  mode: string;
  baseSnapshotRowId: number;
  headSnapshotRowId: number;
  baseTenantId: number;
  headTenantId: number;
  status: string;
  isComplete: boolean;
  resourceTypesCompared: number;
  resourceTypesPartial: number;
  resourceTypesNotComparable: number;
  changesTotal: number;
  changesSignificant: number;
  changesIgnored: number;
  objectsPaired: number;
  objectsAdded: number;
  objectsRemoved: number;
  objectsIndeterminate: number;
  objectsUnpairable: number;
  differVersion: string;
  createdAt: string;
}

interface SnapshotHeader {
  id: number;
  tenantId: number;
  entraTenantId: string;
  capturedAt: string;
  status: string;
}

interface ResourceComparabilityRow {
  resourceKey: string;
  displayName: string;
  workload: string;
  comparability: string;
  notComparableReason: string | null;
  baseStatus: string | null;
  baseSkipReason: string | null;
  headStatus: string | null;
  headSkipReason: string | null;
  objectsPaired: number;
  objectsAdded: number;
  objectsRemoved: number;
  objectsIndeterminate: number;
  objectsUnpairable: number;
  changesTotal: number;
  changesSignificant: number;
}

interface ChangeRow {
  sequence: number;
  resourceKey: string;
  resourceDisplayName: string;
  workload: string;
  objectIdentity: string;
  objectDisplayName: string | null;
  changeKind: string;
  propertyPath: string | null;
  oldValue: unknown;
  newValue: unknown;
  oldValuePresent: boolean;
  newValuePresent: boolean;
  isIgnored: boolean;
}

interface DiffDetail {
  diff: DiffListRow & { notes: string | null; error: string | null };
  snapshots: { base: SnapshotHeader | null; head: SnapshotHeader | null };
  summary: {
    byKind: { changeKind: string; isIgnored: boolean; count: number }[];
    byComparability: { comparability: string; count: number }[];
  };
  changes: ChangeRow[];
  paging: { total: number; limit: number; offset: number };
}

function fmtValue(v: unknown, present: boolean): string {
  if (!present) return "—";
  if (v === null) return "null";
  if (typeof v === "string") return v.length > 120 ? `${v.slice(0, 117)}...` : v;
  return JSON.stringify(v);
}

export default function ConfigDiffReport() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();

  const [diffs, setDiffs] = useState<DiffListRow[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<DiffDetail | null>(null);
  const [resources, setResources] = useState<ResourceComparabilityRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedWorkload, setExpandedWorkload] = useState<string | null>(null);
  const [changeWorkload, setChangeWorkload] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/admin/config-diffs?limit=200");
      const data = await res.json() as { diffs: DiffListRow[] };
      const rows = data.diffs ?? [];
      setDiffs(rows);
      const firstSealed = rows.find((r) => r.status === "sealed");
      setSelectedId((prev) => prev ?? firstSealed?.diffRowId ?? rows[0]?.diffRowId ?? null);
    } catch {
      toast({ title: "Error", description: "Failed to load configuration diffs", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, toast]);

  const loadDetail = useCallback(async (id: number) => {
    setLoading(true);
    setDetail(null);
    setResources(null);
    setExpandedWorkload(null);
    try {
      const [detailRes, resourcesRes] = await Promise.all([
        fetchWithAuth(`/api/admin/config-diffs/${id}?limit=1000`),
        fetchWithAuth(`/api/admin/config-diffs/${id}/resources?limit=2000`),
      ]);
      if (!detailRes.ok) throw new Error(String(detailRes.status));
      setDetail(await detailRes.json() as DiffDetail);
      const resourcesData = await resourcesRes.json() as { resources: ResourceComparabilityRow[] };
      setResources(resourcesData.resources ?? []);
    } catch {
      toast({ title: "Error", description: "Failed to load the diff document", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, toast]);

  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => { if (selectedId != null) void loadDetail(selectedId); }, [selectedId, loadDetail]);

  const comparablePct = useMemo(() => {
    if (!detail || !resources) return null;
    const comparable = resources.filter((r) => r.comparability === "comparable").length;
    return pctOrNull(comparable, resources.length);
  }, [detail, resources]);

  const resourcesByWorkload = useMemo(() => {
    if (!resources) return [];
    const map = new Map<string, ResourceComparabilityRow[]>();
    for (const r of resources) {
      const list = map.get(r.workload) ?? [];
      list.push(r);
      map.set(r.workload, list);
    }
    return Array.from(map.entries())
      .map(([workload, rows]) => ({ workload, rows }))
      .sort((a, b) => a.workload.localeCompare(b.workload));
  }, [resources]);

  const changesByWorkload = useMemo(() => {
    if (!detail) return [];
    const map = new Map<string, ChangeRow[]>();
    for (const c of detail.changes) {
      const list = map.get(c.workload) ?? [];
      list.push(c);
      map.set(c.workload, list);
    }
    return Array.from(map.entries())
      .map(([workload, rows]) => ({ workload, rows }))
      .sort((a, b) => b.rows.length - a.rows.length);
  }, [detail]);

  return (
    <ReportShell>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <Heading sub="A computed configuration diff (#1797), rendered as a change document — what moved, from what to what, and what could not be compared at all. Absence, unreadability and deletion are never conflated.">
          <span className="inline-flex items-center gap-2"><GitCompare className="h-6 w-6" /> Config Diff Report</span>
        </Heading>
        <div className="w-96">
          <Select
            value={selectedId != null ? String(selectedId) : undefined}
            onValueChange={(v) => setSelectedId(Number(v))}
          >
            <SelectTrigger style={{ background: "transparent", borderColor: HAIRLINE_BORDER, color: INK.heading }}>
              <SelectValue placeholder="Select a diff" />
            </SelectTrigger>
            <SelectContent>
              {diffs.map((d) => (
                <SelectItem key={d.diffRowId} value={String(d.diffRowId)}>
                  #{d.diffRowId} · {d.mode} · snapshot {d.baseSnapshotRowId}→{d.headSnapshotRowId} · {d.changesSignificant} changes · {d.status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!loading && diffs.length === 0 && (
        <EmptyState>
          No configuration diffs have been computed yet. This report renders real rows
          from <code className="mx-1">config_diffs</code> — none exist. Compute one via
          <code className="mx-1">POST /api/admin/config-diffs</code> against two sealed
          snapshots before expecting a document here.
        </EmptyState>
      )}

      {detail && (
        <>
          <Panel>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm" style={{ color: INK.bodyStrong }}>
                  mode <span style={{ color: INK.heading }}>{detail.diff.mode}</span>
                </div>
                <div className="text-xs mt-1" style={{ color: INK.micro }}>
                  base: snapshot #{detail.diff.baseSnapshotRowId}
                  {detail.snapshots.base ? ` · ${new Date(detail.snapshots.base.capturedAt).toLocaleString()}` : " (not found)"}
                  {" · "}head: snapshot #{detail.diff.headSnapshotRowId}
                  {detail.snapshots.head ? ` · ${new Date(detail.snapshots.head.capturedAt).toLocaleString()}` : " (not found)"}
                </div>
                <div className="text-xs mt-1" style={{ color: INK.micro }}>
                  diff {detail.diff.diffId} · differ {detail.diff.differVersion} · status {detail.diff.status}
                </div>
              </div>
              <SeverityBadge pct={comparablePct} label="Resources comparable" />
            </div>
            {detail.diff.error && (
              <div className="mt-3 text-xs" style={{ color: SEVERITY_COLOR.critical }}>
                Run error: {detail.diff.error}
              </div>
            )}
          </Panel>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            <StatTile label="Objects paired" value={detail.diff.objectsPaired ?? 0} />
            <StatTile label="Objects added" value={detail.diff.objectsAdded} tone="delta" />
            <StatTile label="Objects removed" value={detail.diff.objectsRemoved} tone="delta" />
            <StatTile label="Indeterminate" value={detail.diff.objectsIndeterminate}
              sub="present one side only, set known incomplete" />
            <StatTile label="Unpairable" value={detail.diff.objectsUnpairable}
              sub="content-hash identity — can't distinguish modify from delete+add" />
            <StatTile label="Changes (significant)" value={detail.diff.changesSignificant} tone="delta"
              sub={`${detail.diff.changesIgnored} ignored by noise rules, ${detail.diff.changesTotal} total`} />
          </div>

          {/* ── Resource comparability report — the completeness evidence ────────── */}
          <div>
            <h2 className="text-sm font-semibold mb-2" style={{ color: INK.heading }}>
              Resource comparability
            </h2>
            <div className="space-y-3">
              {resourcesByWorkload.map(({ workload, rows }) => {
                const comparable = rows.filter((r) => r.comparability === "comparable").length;
                const wPct = pctOrNull(comparable, rows.length);
                const wSev = severityForPct(wPct);
                const isOpen = expandedWorkload === workload;
                return (
                  <div key={workload} className="rounded-lg" style={{ border: `1px solid ${HAIRLINE_BORDER}` }}>
                    <button
                      type="button"
                      className="w-full flex items-center justify-between gap-3 p-3 text-left"
                      onClick={() => setExpandedWorkload(isOpen ? null : workload)}
                      data-testid={`diff-workload-toggle-${workload}`}
                    >
                      <span className="flex items-center gap-2" style={{ color: INK.heading }}>
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        <Layers className="h-4 w-4" style={{ color: INK.micro }} />
                        <span className="font-medium">{workload}</span>
                      </span>
                      <span className="flex items-center gap-3 text-xs" style={{ color: INK.body }}>
                        <SeverityDot severity={wSev} />
                        {rows.length} resources · {rows.reduce((s, r) => s + r.changesSignificant, 0)} changes
                      </span>
                    </button>
                    {isOpen && (
                      <div className="border-t" style={{ borderColor: HAIRLINE_BORDER }}>
                        {rows.map((r) => (
                          <div key={r.resourceKey} className="p-3 text-sm" style={{ borderTop: `1px solid ${HAIRLINE_BORDER}` }}>
                            <div className="flex items-center justify-between gap-3">
                              <span className="flex items-center gap-2">
                                <SeverityDot severity={COMPARABILITY_SEVERITY[r.comparability] ?? null} />
                                <span style={{ color: INK.bodyStrong }}>{r.displayName}</span>
                                <span className="text-xs" style={{ color: INK.deEmphasised }}>{r.resourceKey}</span>
                              </span>
                              <span className="text-xs" style={{ color: INK.body }}>{r.comparability}</span>
                            </div>
                            {r.comparability === "comparable" ? (
                              <div className="mt-1 text-xs" style={{ color: INK.body }}>
                                paired {r.objectsPaired} · added {r.objectsAdded} · removed {r.objectsRemoved}
                                {" · "}{r.changesSignificant} significant changes
                              </div>
                            ) : (
                              <div className="mt-1 text-xs" style={{ color: INK.body }}>
                                {r.notComparableReason ?? "no reason recorded"}
                                {" — base: "}{r.baseStatus ?? "never targeted"}{r.baseSkipReason ? ` (${r.baseSkipReason})` : ""}
                                {" · head: "}{r.headStatus ?? "never targeted"}{r.headSkipReason ? ` (${r.headSkipReason})` : ""}
                                {r.objectsIndeterminate > 0 && ` · ${r.objectsIndeterminate} objects indeterminate`}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── The changes — the product ──────────────────────────────────────── */}
          <div>
            <h2 className="text-sm font-semibold mb-2" style={{ color: INK.heading }}>
              Changes ({detail.changes.length} of {detail.paging.total.toLocaleString()} significant)
            </h2>
            <div className="space-y-3">
              {changesByWorkload.map(({ workload, rows }) => {
                const isOpen = changeWorkload === workload;
                return (
                  <div key={workload} className="rounded-lg" style={{ border: `1px solid ${HAIRLINE_BORDER}` }}>
                    <button
                      type="button"
                      className="w-full flex items-center justify-between gap-3 p-3 text-left"
                      onClick={() => setChangeWorkload(isOpen ? null : workload)}
                      data-testid={`diff-changes-toggle-${workload}`}
                    >
                      <span className="flex items-center gap-2" style={{ color: INK.heading }}>
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        <span className="font-medium">{workload}</span>
                      </span>
                      <span className="text-xs" style={{ color: TEAL }}>{rows.length} changes</span>
                    </button>
                    {isOpen && (
                      <div className="border-t divide-y" style={{ borderColor: HAIRLINE_BORDER }}>
                        {rows.map((c) => (
                          <div key={c.sequence} className="p-3 text-xs" style={{ borderColor: HAIRLINE_BORDER }}>
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className="rounded px-1.5 py-0.5"
                                style={{ border: `1px solid ${TEAL}59`, color: TEAL }}
                              >
                                {c.changeKind}
                              </span>
                              <span style={{ color: INK.bodyStrong }}>{c.resourceDisplayName}</span>
                              <span style={{ color: INK.deEmphasised }}>
                                {c.objectDisplayName ?? c.objectIdentity}
                              </span>
                            </div>
                            {c.propertyPath && (
                              <div className="mt-1" style={{ color: INK.body }}>{c.propertyPath}</div>
                            )}
                            <div className="mt-1 flex items-center gap-2" style={{ color: INK.body }}>
                              <span style={{ color: INK.deEmphasised }}>{fmtValue(c.oldValue, c.oldValuePresent)}</span>
                              <ArrowRight className="h-3 w-3" style={{ color: TEAL }} />
                              <span style={{ color: INK.bodyStrong }}>{fmtValue(c.newValue, c.newValuePresent)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {changesByWorkload.length === 0 && (
                <EmptyState>No significant changes in this diff.</EmptyState>
              )}
            </div>
          </div>
        </>
      )}
    </ReportShell>
  );
}
