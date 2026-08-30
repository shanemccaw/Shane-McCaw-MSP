/**
 * Config Resource Model (#1794) — the operator view over the tenant configuration
 * resource model derived from Microsoft Graph's published `$metadata`, Microsoft's
 * published permissions reference, and the Microsoft365DSC resource map.
 *
 * What this page is for: it answers, from real data, "what configuration can this
 * platform actually read, and how much of it does the monitor catalog already ask
 * about". Sitting next to Monitor Checks is deliberate — the coverage number here is
 * the measured counterpart to that catalog.
 *
 * Every number and row on this screen comes from `/api/admin/config-resources`.
 * There is no fixture module and no fallback array: an empty response renders an
 * empty state that says the extraction has not been run, not invented rows.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ChevronDown, ChevronRight } from "lucide-react";

interface ConfigResource {
  id: number;
  resourceKey: string;
  displayName: string;
  description: string | null;
  surface: string;
  workload: string;
  origin: "graph-metadata" | "m365dsc" | "both";
  readTransport: string;
  graphVersion: string | null;
  graphPath: string | null;
  graphIsCollection: boolean;
  graphContainerKind: string | null;
  graphEntityType: string | null;
  alsoInBeta: boolean;
  readCmdlets: string[];
  m365dscResource: string | null;
  m365dscMode: string | null;
  linkBasis: string | null;
  requiredAppPermissions: string[];
  graphReadPermissionOptions: string[];
  permissionSource: string | null;
  permissionPathMatched: string | null;
  requiredRoles: string[];
  availability: string;
  availabilityReason: string | null;
  missingPermissions: string[];
  verificationStatus: string;
  propertyCount: number;
  checkCoverageCount: number;
  /** covered | uncovered | no_executor — computed server-side from the row's transport (#1869). */
  coverageState: "covered" | "uncovered" | "no_executor";
  sourceRef: string | null;
  notes: string | null;
}

interface ResourceProperty {
  name: string;
  source: string;
  dataType: string;
  isCollection: boolean;
  isKey: boolean;
  isRequired: boolean;
  allowedValues: string[];
  nestedTypeRef: string | null;
  isConnectionParameter: boolean;
  description: string | null;
}

interface MappedCheck {
  checkKey: string;
  executorType: string;
  matchBasis: string;
  confidence: string;
  matchedOn: string | null;
}

interface ResourceSample {
  graphVersion: string;
  requestPath: string;
  httpStatus: number | null;
  ok: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  itemCount: number | null;
  observedPropertyNames: string[];
  observedShape: Record<string, string>;
  durationMs: number | null;
  observedAt: string;
}

interface ModelSummary {
  totals: {
    resources: number;
    properties: number;
    resourcesCoveredByAtLeastOneCheck: number;
    resourcesEntirelyUncovered: number;
    /** Resources no code path could read at all — their transport has no executor (#1869). */
    resourcesWithNoExecutor: number;
    transportsWithNoExecutor: string[];
    checksMapped: number;
    checksUnmatched: number;
  };
  bySurface: Record<string, number>;
  byTransport: Record<string, number>;
  byAvailability: Record<string, number>;
  byVerificationStatus: Record<string, number>;
  extraction: {
    runId: string;
    m365dscCommit: string | null;
    m365dscResourceCount: number;
    graphV1TypeCount: number;
    graphBetaTypeCount: number;
    graphConfigPathCount: number;
    graphPermissionCount: number;
    grantedScopes: string[];
    status: string;
    startedAt: string;
    finishedAt: string | null;
  } | null;
}

const AVAILABILITY_TONE: Record<string, string> = {
  available_now: "bg-emerald-100 text-emerald-800 border-emerald-200",
  needs_additional_scope: "bg-amber-100 text-amber-900 border-amber-200",
  needs_license: "bg-violet-100 text-violet-900 border-violet-200",
  unavailable: "bg-rose-100 text-rose-900 border-rose-200",
  unknown: "bg-slate-100 text-slate-700 border-slate-200",
};

const VERIFICATION_TONE: Record<string, string> = {
  verified_live: "bg-emerald-100 text-emerald-800 border-emerald-200",
  failed_live: "bg-rose-100 text-rose-900 border-rose-200",
  not_attempted: "bg-slate-100 text-slate-700 border-slate-200",
  derived_not_verified: "bg-sky-100 text-sky-900 border-sky-200",
};

const ALL = "__all__";

export default function ConfigResourceModel() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();

  const [summary, setSummary] = useState<ModelSummary | null>(null);
  const [resources, setResources] = useState<ConfigResource[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [surface, setSurface] = useState(ALL);
  const [transport, setTransport] = useState(ALL);
  const [availability, setAvailability] = useState(ALL);
  const [coverage, setCoverage] = useState(ALL);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<{
    properties: ResourceProperty[]; checks: MappedCheck[]; samples: ResourceSample[];
  } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadSummary = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/admin/config-resources/summary");
      setSummary(await res.json() as ModelSummary);
    } catch {
      toast({ title: "Error", description: "Failed to load the resource model summary", variant: "destructive" });
    }
  }, [fetchWithAuth, toast]);

  const loadResources = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "300" });
      if (search.trim()) params.set("q", search.trim());
      if (surface !== ALL) params.set("surface", surface);
      if (transport !== ALL) params.set("transport", transport);
      if (availability !== ALL) params.set("availability", availability);
      if (coverage !== ALL) params.set("coverage", coverage);
      const res = await fetchWithAuth(`/api/admin/config-resources?${params.toString()}`);
      const data = await res.json() as { resources: ConfigResource[]; total: number };
      setResources(data.resources ?? []);
      setTotal(data.total ?? 0);
    } catch {
      toast({ title: "Error", description: "Failed to load config resources", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, toast, search, surface, transport, availability, coverage]);

  useEffect(() => { void loadSummary(); }, [loadSummary]);
  useEffect(() => { void loadResources(); }, [loadResources]);

  const toggleExpand = useCallback(async (r: ConfigResource) => {
    if (expandedId === r.id) { setExpandedId(null); setDetail(null); return; }
    setExpandedId(r.id);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await fetchWithAuth(`/api/admin/config-resources/${r.id}`);
      const data = await res.json() as {
        properties: ResourceProperty[]; checks: MappedCheck[]; samples: ResourceSample[];
      };
      setDetail({ properties: data.properties ?? [], checks: data.checks ?? [], samples: data.samples ?? [] });
    } catch {
      toast({ title: "Error", description: "Failed to load the resource detail", variant: "destructive" });
    } finally {
      setDetailLoading(false);
    }
  }, [expandedId, fetchWithAuth, toast]);

  const surfaces = useMemo(() => Object.keys(summary?.bySurface ?? {}).sort(), [summary]);
  const transports = useMemo(() => Object.keys(summary?.byTransport ?? {}).sort(), [summary]);
  const availabilities = useMemo(() => Object.keys(summary?.byAvailability ?? {}).sort(), [summary]);

  // Coverage is measured against the REACHABLE model, not the whole model
  // (#1869). Resources whose transport has no executor cannot be covered by any
  // check, so counting them in the denominator would permanently understate
  // coverage and blame check authors for a transport gap.
  const reachableResources = summary
    ? summary.totals.resources - summary.totals.resourcesWithNoExecutor
    : 0;
  const coveragePct = reachableResources > 0
    ? Math.round((summary!.totals.resourcesCoveredByAtLeastOneCheck / reachableResources) * 1000) / 10
    : 0;

  return (
    <div className="space-y-6 p-6" data-testid="config-resource-model-page">
      <div>
        <h1 className="text-2xl font-semibold">Config Resource Model</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Tenant configuration resources derived from Microsoft Graph&apos;s published
          <code className="mx-1">$metadata</code>, Microsoft&apos;s published permissions
          reference, and the Microsoft365DSC resource map. Each row carries what the
          resource is, how it is read, and the permission that read requires — reconciled
          against the scopes the testbed tenant has actually granted.
        </p>
      </div>

      {!summary || summary.totals.resources === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center" data-testid="config-model-empty">
          <p className="text-sm text-muted-foreground">
            No resource model has been extracted yet. Run
            <code className="mx-1">node scripts/config-state/fetch-sources.mjs</code>
            then
            <code className="mx-1">node scripts/config-state/build-resource-model.mjs</code>
            to populate it from the published sources.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5" data-testid="config-model-totals">
            <StatTile label="Resources modelled" value={summary.totals.resources} />
            <StatTile label="Properties modelled" value={summary.totals.properties} />
            <StatTile
              label="Covered by a check"
              value={summary.totals.resourcesCoveredByAtLeastOneCheck}
              sub={`${coveragePct}% of the ${reachableResources} reachable`}
            />
            <StatTile
              label="Entirely uncovered"
              value={summary.totals.resourcesEntirelyUncovered}
              sub={`${summary.totals.checksMapped} checks mapped, ${summary.totals.checksUnmatched} unmatched`}
            />
            <StatTile
              label="No executor exists"
              value={summary.totals.resourcesWithNoExecutor}
              sub={
                summary.totals.transportsWithNoExecutor.length > 0
                  ? `unreachable transport: ${summary.totals.transportsWithNoExecutor.join(", ")}`
                  : "every modelled transport has an executor"
              }
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <TallyCard title="Availability against granted scopes" tally={summary.byAvailability} tone={AVAILABILITY_TONE} />
            <TallyCard title="Live verification status" tally={summary.byVerificationStatus} tone={VERIFICATION_TONE} />
          </div>

          {summary.extraction && (
            <div className="rounded-lg border bg-muted/30 p-4 text-xs text-muted-foreground" data-testid="config-model-provenance">
              <span className="font-medium text-foreground">Extraction provenance:</span>{" "}
              Graph v1.0 {summary.extraction.graphV1TypeCount.toLocaleString()} types ·
              beta {summary.extraction.graphBetaTypeCount.toLocaleString()} types ·
              {" "}{summary.extraction.graphConfigPathCount.toLocaleString()} configuration paths ·
              {" "}{summary.extraction.graphPermissionCount.toLocaleString()} published permissions ·
              Microsoft365DSC {summary.extraction.m365dscResourceCount} resources
              {summary.extraction.m365dscCommit
                ? ` @ ${summary.extraction.m365dscCommit.slice(0, 10)}`
                : ""} ·
              reconciled against {summary.extraction.grantedScopes.length} granted scopes ·
              {" "}{summary.extraction.status} at{" "}
              {new Date(summary.extraction.finishedAt ?? summary.extraction.startedAt).toLocaleString()}
            </div>
          )}

          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[220px] flex-1">
              <Label htmlFor="config-model-search">Search</Label>
              <Input
                id="config-model-search"
                data-testid="config-model-search"
                placeholder="Resource, Graph path or DSC resource name"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <FilterSelect label="Surface" value={surface} onChange={setSurface} options={surfaces} testId="config-model-surface" />
            <FilterSelect label="Transport" value={transport} onChange={setTransport} options={transports} testId="config-model-transport" />
            <FilterSelect label="Availability" value={availability} onChange={setAvailability} options={availabilities} testId="config-model-availability" />
            <FilterSelect label="Coverage" value={coverage} onChange={setCoverage} options={["covered", "uncovered", "no_executor"]} testId="config-model-coverage" />
            <Button variant="outline" onClick={() => { void loadResources(); void loadSummary(); }}>Refresh</Button>
          </div>

          <div className="text-sm text-muted-foreground" data-testid="config-model-result-count">
            {loading ? "Loading…" : `${resources.length} shown of ${total} matching`}
          </div>

          <div className="rounded-lg border divide-y" data-testid="config-model-list">
            {resources.map((r) => (
              <div key={r.id}>
                <button
                  type="button"
                  className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/40"
                  onClick={() => void toggleExpand(r)}
                  data-testid={`config-resource-row-${r.id}`}
                >
                  {expandedId === r.id
                    ? <ChevronDown className="mt-1 h-4 w-4 shrink-0" />
                    : <ChevronRight className="mt-1 h-4 w-4 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm">{r.displayName}</span>
                      <Badge variant="outline" className={AVAILABILITY_TONE[r.availability] ?? ""}>{r.availability}</Badge>
                      <Badge variant="outline" className={VERIFICATION_TONE[r.verificationStatus] ?? ""}>{r.verificationStatus}</Badge>
                      <Badge variant="outline">{r.readTransport}</Badge>
                      <Badge variant="outline">{r.surface}</Badge>
                      {/* Three states, not two (#1869): "no executor" is a red
                          transport gap no check author can close, distinct from
                          the orange "nobody has written this check yet". */}
                      {r.coverageState === "no_executor"
                        ? <Badge variant="outline" className="bg-red-50 text-red-800 border-red-200" title={`No executor exists for the "${r.readTransport}" transport — this resource is unreachable by any code path.`}>no executor</Badge>
                        : r.checkCoverageCount > 0
                          ? <Badge variant="outline">{r.checkCoverageCount} check{r.checkCoverageCount === 1 ? "" : "s"}</Badge>
                          : <Badge variant="outline" className="bg-orange-50 text-orange-800 border-orange-200">uncovered</Badge>}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {r.workload} · {r.propertyCount} propert{r.propertyCount === 1 ? "y" : "ies"}
                      {r.m365dscResource ? ` · M365DSC ${r.m365dscResource}` : ""}
                      {r.graphEntityType ? ` · ${r.graphEntityType}` : ""}
                    </div>
                  </div>
                </button>

                {expandedId === r.id && (
                  <div className="border-t bg-muted/20 px-4 py-4 text-sm" data-testid={`config-resource-detail-${r.id}`}>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <h3 className="font-medium">Read transport</h3>
                        <dl className="mt-2 space-y-1 text-xs">
                          <Row k="Transport" v={r.readTransport} />
                          {r.graphPath && <Row k="Graph path" v={`${r.graphVersion} ${r.graphPath}`} />}
                          {r.graphContainerKind && <Row k="Addressed as" v={r.graphContainerKind} />}
                          {r.graphEntityType && <Row k="Entity type" v={r.graphEntityType} />}
                          {r.readCmdlets.length > 0 && <Row k="Read cmdlets" v={r.readCmdlets.join(", ")} />}
                          {r.m365dscResource && <Row k="Microsoft365DSC" v={`${r.m365dscResource}${r.m365dscMode ? ` (${r.m365dscMode})` : ""}`} />}
                          {r.linkBasis && <Row k="Link evidence" v={r.linkBasis} />}
                          <Row k="Origin" v={r.origin} />
                          {r.sourceRef && <Row k="Source" v={r.sourceRef} />}
                        </dl>
                      </div>
                      <div>
                        <h3 className="font-medium">Permission &amp; availability</h3>
                        <dl className="mt-2 space-y-1 text-xs">
                          <Row k="Verdict" v={r.availability} />
                          {r.availabilityReason && <Row k="Reason" v={r.availabilityReason} />}
                          {r.permissionSource && <Row k="Decided from" v={r.permissionSource} />}
                          {r.graphReadPermissionOptions.length > 0 && (
                            <Row k="Any one of" v={r.graphReadPermissionOptions.join(", ")} />
                          )}
                          {r.permissionPathMatched && <Row k="Documented on" v={r.permissionPathMatched} />}
                          {r.requiredAppPermissions.length > 0 && (
                            <Row k="All of (M365DSC)" v={r.requiredAppPermissions.join(", ")} />
                          )}
                          {r.requiredRoles.length > 0 && <Row k="RBAC roles" v={r.requiredRoles.join(", ")} />}
                          {r.missingPermissions.length > 0 && <Row k="Missing" v={r.missingPermissions.join(", ")} />}
                          {r.notes && <Row k="Notes" v={r.notes} />}
                        </dl>
                      </div>
                    </div>

                    {detailLoading && <p className="mt-4 text-xs text-muted-foreground">Loading detail…</p>}

                    {detail && (
                      <div className="mt-5 space-y-5">
                        <div>
                          <h3 className="font-medium">
                            Property model{" "}
                            <span className="text-xs font-normal text-muted-foreground">
                              ({detail.properties.filter((p) => !p.isConnectionParameter).length} configuration properties)
                            </span>
                          </h3>
                          <div className="mt-2 max-h-72 overflow-auto rounded border bg-background">
                            <table className="w-full text-xs">
                              <thead className="sticky top-0 bg-muted">
                                <tr>
                                  <th className="px-2 py-1 text-left">Property</th>
                                  <th className="px-2 py-1 text-left">Type</th>
                                  <th className="px-2 py-1 text-left">Source</th>
                                  <th className="px-2 py-1 text-left">Allowed values</th>
                                </tr>
                              </thead>
                              <tbody>
                                {detail.properties.filter((p) => !p.isConnectionParameter).map((p) => (
                                  <tr key={`${p.source}-${p.name}`} className="border-t">
                                    <td className="px-2 py-1 font-mono">
                                      {p.name}
                                      {p.isKey && <Badge variant="outline" className="ml-2">key</Badge>}
                                      {p.isRequired && <Badge variant="outline" className="ml-2">required</Badge>}
                                    </td>
                                    <td className="px-2 py-1 font-mono text-muted-foreground">
                                      {p.isCollection ? `${p.dataType}[]` : p.dataType}
                                      {p.nestedTypeRef ? ` → ${p.nestedTypeRef}` : ""}
                                    </td>
                                    <td className="px-2 py-1 text-muted-foreground">{p.source}</td>
                                    <td className="px-2 py-1 text-muted-foreground">
                                      {p.allowedValues.length > 0 ? p.allowedValues.join(" | ") : "—"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        <div>
                          <h3 className="font-medium">
                            Monitor checks mapped onto this resource{" "}
                            <span className="text-xs font-normal text-muted-foreground">({detail.checks.length})</span>
                          </h3>
                          {detail.checks.length === 0 ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              No check in the catalog asks anything about this resource.
                            </p>
                          ) : (
                            <ul className="mt-2 space-y-1 text-xs">
                              {detail.checks.map((c) => (
                                <li key={c.checkKey} className="flex flex-wrap items-center gap-2">
                                  <span className="font-mono">{c.checkKey}</span>
                                  <Badge variant="outline">{c.executorType}</Badge>
                                  <Badge variant="outline">{c.matchBasis}</Badge>
                                  <Badge variant="outline">{c.confidence} confidence</Badge>
                                  {c.matchedOn && <span className="text-muted-foreground">matched on {c.matchedOn}</span>}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>

                        <div>
                          <h3 className="font-medium">
                            Live read-only samples{" "}
                            <span className="text-xs font-normal text-muted-foreground">
                              (shape only — no tenant values are stored)
                            </span>
                          </h3>
                          {detail.samples.length === 0 ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Not sampled. This resource is described from published sources only.
                            </p>
                          ) : (
                            <ul className="mt-2 space-y-2 text-xs">
                              {detail.samples.map((s, i) => (
                                <li key={`${s.requestPath}-${i}`} className="rounded border bg-background p-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Badge variant="outline" className={s.ok ? VERIFICATION_TONE.verified_live : VERIFICATION_TONE.failed_live}>
                                      {s.httpStatus ?? "no response"}
                                    </Badge>
                                    <span className="font-mono">{s.graphVersion} {s.requestPath}</span>
                                    {s.itemCount !== null && <span className="text-muted-foreground">{s.itemCount} item(s)</span>}
                                    {s.durationMs !== null && <span className="text-muted-foreground">{s.durationMs} ms</span>}
                                    <span className="text-muted-foreground">{new Date(s.observedAt).toLocaleString()}</span>
                                  </div>
                                  {s.errorCode && (
                                    <div className="mt-1 text-muted-foreground">
                                      <span className="font-mono">{s.errorCode}</span>
                                      {s.errorMessage ? ` — ${s.errorMessage}` : ""}
                                    </div>
                                  )}
                                  {s.observedPropertyNames.length > 0 && (
                                    <div className="mt-1 font-mono text-muted-foreground">
                                      {s.observedPropertyNames.length} properties observed:{" "}
                                      {s.observedPropertyNames.join(", ")}
                                    </div>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {!loading && resources.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground" data-testid="config-model-no-matches">
                No resource matches these filters.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function StatTile({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value.toLocaleString()}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function TallyCard({ title, tally, tone }: { title: string; tally: Record<string, number>; tone: Record<string, string> }) {
  const entries = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  return (
    <div className="rounded-lg border p-4">
      <div className="text-sm font-medium">{title}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        {entries.map(([k, n]) => (
          <Badge key={k} variant="outline" className={tone[k] ?? ""}>
            {k} · {n.toLocaleString()}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function FilterSelect({
  label, value, onChange, options, testId,
}: { label: string; value: string; onChange: (v: string) => void; options: string[]; testId: string }) {
  return (
    <div className="min-w-[160px]">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger data-testid={testId}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All</SelectItem>
          {options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-32 shrink-0 text-muted-foreground">{k}</dt>
      <dd className="min-w-0 break-words font-mono">{v}</dd>
    </div>
  );
}
