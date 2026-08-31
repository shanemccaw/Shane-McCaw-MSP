/**
 * Config Snapshot Report (Git #1798) — render one tenant configuration snapshot
 * (#1795) as a readable document, grouped by workload and resource type.
 *
 * This is a configuration report: what the tenant's configuration IS. It is
 * deliberately not a restyle of the findings/pillar/health surfaces, which answer a
 * different question (what is WRONG). Every number here comes from
 * `/api/admin/config-snapshots*` — no fixture module, no fallback array. An empty
 * response renders an honest empty state, never invented rows.
 *
 * Completeness is shown honestly: every resource type this snapshot targeted appears,
 * including the ones it could not read, each carrying its real reason. That table IS
 * the completeness report — nothing is silently omitted.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ChevronDown, ChevronRight, Layers, Boxes, FileJson } from "lucide-react";
import {
  ReportShell, Panel, Heading, SeverityBadge, StatTile, EmptyState, SeverityDot,
} from "./configReport/components";
import { pctOrNull, severityForPct, SEVERITY_COLOR, INK, HAIRLINE_BORDER } from "./configReport/theme";

const SNAPSHOT_STATUS_SEVERITY: Record<string, "healthy" | "attention" | "critical"> = {
  collected: "healthy",
  empty: "healthy",
  partial: "attention",
  skipped: "critical",
  failed: "critical",
};

interface SnapshotListRow {
  id: number;
  snapshotId: string;
  tenantId: number;
  tenantName: string | null;
  entraTenantId: string;
  capturedAt: string;
  status: string;
  trigger: string;
  isComplete: boolean;
  resourceTypesTargeted: number;
  resourceTypesCollected: number;
  resourceTypesEmpty: number;
  resourceTypesPartial: number;
  resourceTypesSkipped: number;
  resourceTypesFailed: number;
  objectCount: number;
}

interface ResourceRow {
  resourceKey: string;
  displayName: string;
  surface: string | null;
  workload: string;
  readTransport: string;
  status: string;
  skipReason: string | null;
  reasonDetail: string | null;
  objectCount: number;
  pageCount: number | null;
  httpStatus: number | null;
  errorCode: string | null;
  durationMs: number | null;
  attemptedAt: string;
}

interface WorkloadGroup {
  workload: string;
  resources: ResourceRow[];
  totals: Record<string, number>;
  objectCount: number;
}

interface SnapshotDetail {
  snapshot: SnapshotListRow & { error: string | null; collectorVersion: string | null };
  workloads: WorkloadGroup[];
  resourceCount: number;
}

interface SnapshotObject {
  objectIdentity: string;
  identityStrategy: string;
  displayName: string | null;
  objectJson: Record<string, unknown>;
  objectHash: string;
  propertyCount: number;
  odataType: string | null;
  sourceRef: string | null;
  collectedAt: string;
}

export default function ConfigSnapshotReport() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();

  const [snapshots, setSnapshots] = useState<SnapshotListRow[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<SnapshotDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedWorkload, setExpandedWorkload] = useState<string | null>(null);
  const [expandedResource, setExpandedResource] = useState<string | null>(null);
  const [objects, setObjects] = useState<SnapshotObject[] | null>(null);
  const [objectsTotal, setObjectsTotal] = useState(0);
  const [objectsLoading, setObjectsLoading] = useState(false);
  const [expandedObjectIdentity, setExpandedObjectIdentity] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/admin/config-snapshots?limit=200");
      const data = await res.json() as { snapshots: SnapshotListRow[] };
      const rows = data.snapshots ?? [];
      setSnapshots(rows);
      // Default to the most recent SEALED snapshot — a `running` one is by definition
      // incomplete and not the answer to "what does the report look like".
      const firstSealed = rows.find((r) => r.status === "sealed");
      setSelectedId((prev) => prev ?? firstSealed?.id ?? rows[0]?.id ?? null);
    } catch {
      toast({ title: "Error", description: "Failed to load configuration snapshots", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, toast]);

  const loadDetail = useCallback(async (id: number) => {
    setLoading(true);
    setDetail(null);
    setExpandedWorkload(null);
    setExpandedResource(null);
    setObjects(null);
    try {
      const res = await fetchWithAuth(`/api/admin/config-snapshots/${id}`);
      if (!res.ok) throw new Error(String(res.status));
      setDetail(await res.json() as SnapshotDetail);
    } catch {
      toast({ title: "Error", description: "Failed to load the snapshot document", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, toast]);

  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => { if (selectedId != null) void loadDetail(selectedId); }, [selectedId, loadDetail]);

  const loadObjects = useCallback(async (resourceKey: string) => {
    if (selectedId == null) return;
    if (expandedResource === resourceKey) { setExpandedResource(null); setObjects(null); return; }
    setExpandedResource(resourceKey);
    setObjects(null);
    setObjectsLoading(true);
    try {
      const params = new URLSearchParams({ resourceKey, limit: "200" });
      const res = await fetchWithAuth(`/api/admin/config-snapshots/${selectedId}/objects?${params.toString()}`);
      const data = await res.json() as { objects: SnapshotObject[]; paging: { total: number } };
      setObjects(data.objects ?? []);
      setObjectsTotal(data.paging?.total ?? 0);
    } catch {
      toast({ title: "Error", description: "Failed to load the stored objects", variant: "destructive" });
    } finally {
      setObjectsLoading(false);
    }
  }, [selectedId, expandedResource, fetchWithAuth, toast]);

  const completenessPct = useMemo(() => {
    if (!detail) return null;
    const { resourceTypesCollected, resourceTypesEmpty, resourceTypesTargeted } = detail.snapshot;
    return pctOrNull(resourceTypesCollected + resourceTypesEmpty, resourceTypesTargeted);
  }, [detail]);

  return (
    <ReportShell>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <Heading sub="A tenant configuration snapshot (#1795), rendered as a readable document — grouped by workload and resource type, with every skipped or failed read stated honestly rather than omitted.">
          <span className="inline-flex items-center gap-2"><FileJson className="h-6 w-6" /> Config Snapshot Report</span>
        </Heading>
        <div className="w-72">
          <Select
            value={selectedId != null ? String(selectedId) : undefined}
            onValueChange={(v) => setSelectedId(Number(v))}
          >
            <SelectTrigger style={{ background: "transparent", borderColor: HAIRLINE_BORDER, color: INK.heading }}>
              <SelectValue placeholder="Select a snapshot" />
            </SelectTrigger>
            <SelectContent>
              {snapshots.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>
                  #{s.id} · {s.tenantName ?? `tenant ${s.tenantId}`} · {new Date(s.capturedAt).toLocaleString()} · {s.status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!loading && snapshots.length === 0 && (
        <EmptyState>
          No configuration snapshots exist yet. This report renders real snapshots from
          <code className="mx-1">tenant_config_snapshots</code> — none have been collected.
          Run the #1795/#1796 collector before expecting a document here.
        </EmptyState>
      )}

      {detail && (
        <>
          <Panel>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm" style={{ color: INK.bodyStrong }}>
                  {detail.snapshot.tenantName ?? `tenant ${detail.snapshot.tenantId}`}
                  <span style={{ color: INK.micro }}> · {detail.snapshot.entraTenantId}</span>
                </div>
                <div className="text-xs mt-1" style={{ color: INK.micro }}>
                  Captured {new Date(detail.snapshot.capturedAt).toLocaleString()} · trigger {detail.snapshot.trigger}
                  {" · "}snapshot {detail.snapshot.snapshotId}
                  {detail.snapshot.collectorVersion ? ` · collector ${detail.snapshot.collectorVersion}` : ""}
                </div>
              </div>
              <SeverityBadge pct={completenessPct} label="Read completeness" />
            </div>
            {detail.snapshot.error && (
              <div className="mt-3 text-xs" style={{ color: SEVERITY_COLOR.critical }}>
                Run error: {detail.snapshot.error}
              </div>
            )}
          </Panel>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            <StatTile label="Resource types targeted" value={detail.snapshot.resourceTypesTargeted} />
            <StatTile label="Collected" value={detail.snapshot.resourceTypesCollected} tone="healthy" />
            <StatTile label="Empty (genuinely none)" value={detail.snapshot.resourceTypesEmpty} tone="healthy" />
            <StatTile label="Partial" value={detail.snapshot.resourceTypesPartial} tone="attention" />
            <StatTile label="Skipped" value={detail.snapshot.resourceTypesSkipped} tone="critical" />
            <StatTile label="Failed" value={detail.snapshot.resourceTypesFailed} tone="critical" />
          </div>
          <StatTile label="Total objects stored" value={detail.snapshot.objectCount} />

          <div className="space-y-3">
            {detail.workloads.map((w) => {
              const wPct = pctOrNull(w.totals.collected + w.totals.empty, w.resources.length);
              const wSev = severityForPct(wPct);
              const isOpen = expandedWorkload === w.workload;
              return (
                <div key={w.workload} className="rounded-lg" style={{ border: `1px solid ${HAIRLINE_BORDER}` }}>
                  <button
                    type="button"
                    className="w-full flex items-center justify-between gap-3 p-3 text-left"
                    onClick={() => setExpandedWorkload(isOpen ? null : w.workload)}
                    data-testid={`snapshot-workload-toggle-${w.workload}`}
                  >
                    <span className="flex items-center gap-2" style={{ color: INK.heading }}>
                      {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      <Layers className="h-4 w-4" style={{ color: INK.micro }} />
                      <span className="font-medium">{w.workload}</span>
                    </span>
                    <span className="flex items-center gap-3 text-xs" style={{ color: INK.body }}>
                      <SeverityDot severity={wSev} />
                      {w.resources.length} resource types · {w.objectCount.toLocaleString()} objects
                    </span>
                  </button>
                  {isOpen && (
                    <div className="border-t" style={{ borderColor: HAIRLINE_BORDER }}>
                      {w.resources.map((r) => (
                        <div key={r.resourceKey}>
                          <button
                            type="button"
                            className="w-full flex items-center justify-between gap-3 p-3 text-left text-sm"
                            style={{ borderTop: `1px solid ${HAIRLINE_BORDER}` }}
                            onClick={() => void loadObjects(r.resourceKey)}
                            disabled={r.status !== "collected"}
                            data-testid={`snapshot-resource-row-${r.resourceKey}`}
                          >
                            <span className="flex items-center gap-2">
                              <SeverityDot severity={SNAPSHOT_STATUS_SEVERITY[r.status] ?? null} />
                              <span style={{ color: INK.bodyStrong }}>{r.displayName}</span>
                              <span className="text-xs" style={{ color: INK.deEmphasised }}>{r.resourceKey}</span>
                            </span>
                            <span className="flex items-center gap-3 text-xs" style={{ color: INK.body }}>
                              <span>{r.status}{r.status === "collected" ? ` · ${r.objectCount.toLocaleString()} objects` : ""}</span>
                              {r.status === "collected" && <Boxes className="h-3.5 w-3.5" />}
                            </span>
                          </button>
                          {r.status !== "collected" && r.status !== "empty" && (
                            <div className="px-3 pb-3 text-xs" style={{ color: INK.body }}>
                              {r.skipReason ?? "no reason recorded"}
                              {r.reasonDetail ? ` — ${r.reasonDetail}` : ""}
                              {r.httpStatus ? ` (HTTP ${r.httpStatus})` : ""}
                              {r.errorCode ? ` [${r.errorCode}]` : ""}
                            </div>
                          )}
                          {expandedResource === r.resourceKey && (
                            <div className="px-3 pb-3">
                              {objectsLoading && <div className="text-xs" style={{ color: INK.micro }}>Loading objects…</div>}
                              {objects && (
                                <div className="rounded p-2" style={{ border: `1px solid ${HAIRLINE_BORDER}` }}>
                                  <div className="text-xs mb-2" style={{ color: INK.micro }}>
                                    Showing {objects.length} of {objectsTotal.toLocaleString()} real stored objects
                                  </div>
                                  <div className="space-y-1 max-h-96 overflow-auto">
                                    {objects.map((o) => (
                                      <div key={o.objectIdentity}>
                                        <button
                                          type="button"
                                          className="w-full flex items-center justify-between text-left text-xs py-1"
                                          onClick={() => setExpandedObjectIdentity(
                                            expandedObjectIdentity === o.objectIdentity ? null : o.objectIdentity,
                                          )}
                                        >
                                          <span style={{ color: INK.bodyStrong }}>
                                            {o.displayName ?? o.objectIdentity}
                                          </span>
                                          <span style={{ color: INK.micro }}>{o.propertyCount} properties</span>
                                        </button>
                                        {expandedObjectIdentity === o.objectIdentity && (
                                          <pre
                                            className="text-xs overflow-auto p-2 rounded mt-1"
                                            style={{ background: "rgba(0,0,0,0.35)", color: INK.body, maxHeight: 320 }}
                                          >
                                            {JSON.stringify(o.objectJson, null, 2)}
                                          </pre>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
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
        </>
      )}
    </ReportShell>
  );
}
