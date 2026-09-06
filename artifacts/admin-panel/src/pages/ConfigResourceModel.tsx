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
  /** #1847 — which Microsoft service must be stood up for this resource to answer. */
  serviceKey: string | null;
  availability: string;
  availabilityReason: string | null;
  missingPermissions: string[];
  verificationStatus: string;
  propertyCount: number;
  /** Checks credited to THIS row. `effectiveCheckCoverageCount` is the real answer. */
  checkCoverageCount: number;
  /**
   * #2821 — non-null when this row is not an independent resource: it describes the
   * same real tenant object as another row (both extraction pipelines model it) and
   * resolves onto that row for coverage.
   */
  canonicalResourceId: number | null;
  canonicalBasis: string | null;
  canonicalMatchedOn: string | null;
  /** Why a Graph-backed Microsoft365DSC row could NOT be resolved, when it could not. */
  canonicalGapReason: string | null;
  /**
   * #2821 — coverage of this row's whole canonical group. A duplicate row's own
   * `checkCoverageCount` is structurally 0 however correct a check is, because a check
   * is credited to exactly one resource id; this is the count that answers "covered?".
   */
  effectiveCheckCoverageCount: number;
  /**
   * covered | uncovered | no_executor | unavailable | operation | duplicate —
   * computed server-side from the row's transport (#1869), its own `availability`
   * (#1917), its container kind (#1929), and its canonical link (#2821).
   * `operation` marks a bound Graph Function — an operation, not config state, so
   * coverage does not apply. `duplicate` marks a row that is another row's object.
   */
  coverageState: "covered" | "uncovered" | "no_executor" | "unavailable" | "operation" | "duplicate";
  /**
   * #2940 — the Graph COLLECTION this row lives inside, and a DIFFERENT relationship from
   * `canonicalResourceId` above. That one says "same object as another row"; this says
   * "one of the object types that collection returns". Note it is absent from
   * `coverageState`, which is deliberate: a covered parent does not make this row covered,
   * because a check on `/deviceManagement/deviceConfigurations` returns the bytes without
   * asserting anything about the MacOS-specific settings this row describes. Rendered
   * beside the coverage badge, never as it.
   */
  containedInResourceId: number | null;
  containmentKind: "collection-member" | "nested-child" | null;
  containmentBasis: string | null;
  containmentMatchedOn: string | null;
  /** Why a row #2821 already flagged as residue got no containment edge either. */
  containmentGapReason: string | null;
  sourceRef: string | null;
  notes: string | null;
}

/**
 * #2940 — one end of a containment edge: the collection a row lives inside, or one of the
 * rows that live inside a collection. Deliberately a separate shape from `CanonicalRef`,
 * because it carries its OWN `coverageState` — a contained member's coverage is never
 * rolled up into its container's, which is exactly what makes this not a canonical link.
 */
interface ContainmentRef {
  id: number;
  resourceKey: string;
  displayName: string;
  origin: string;
  surface: string;
  graphPath: string | null;
  graphEntityType: string | null;
  containmentKind: "collection-member" | "nested-child" | null;
  containmentBasis: string | null;
  containmentMatchedOn: string | null;
  effectiveCheckCoverageCount: number;
  coverageState: "covered" | "uncovered" | "no_executor" | "unavailable" | "operation" | "duplicate";
}

/**
 * #2821 — one end of a canonical link: either the real resource a duplicate row resolves
 * onto, or one of the rows that resolve onto a canonical row.
 */
interface CanonicalRef {
  id: number;
  resourceKey: string;
  displayName: string;
  origin: string;
  surface: string;
  graphPath: string | null;
  canonicalResourceId: number | null;
  canonicalBasis: string | null;
  canonicalMatchedOn: string | null;
  checkCoverageCount: number;
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

/**
 * Git #1847 — the per-tenant SERVICE-availability half of the model.
 *
 * `availability` above answers "do we hold the scope". This answers "will the service
 * answer at all", which is a different fact and was previously not carried anywhere:
 * on the reconciliation tenant, hundreds of `/deviceManagement*` rows read
 * `available_now` on granted scopes while Intune returns nothing.
 */
interface ServiceAvailabilityState {
  serviceKey: string;
  state: string;
  evidenceBasis: string;
  reason: string;
  detectionSignature: string | null;
  observedEndpoint: string | null;
  observedHttpStatus: number | null;
  detectedByCheckKey: string | null;
  firstObservedAt: string;
  lastObservedAt: string;
}

interface ServiceAvailabilitySummary {
  /** The Graph tenant GUID the states were observed on. Null when none is on record. */
  tenantId: string | null;
  reconciledAgainstTenantId: number | null;
  services: ServiceAvailabilityState[];
  /** Per service: resources still classified `available_now` while the service does not answer. */
  contradictedByService: Record<string, number>;
}

interface ModelSummary {
  serviceAvailability: ServiceAvailabilitySummary;
  totals: {
    /** Raw model size, including bound-Function rows (#1929). */
    resources: number;
    properties: number;
    /**
     * Bound Graph Functions (#1929) — an operation, not persistent config
     * state. Kept in the model as reachable read endpoints, but excluded from
     * `properties`, `resourcesCoveredByAtLeastOneCheck`,
     * `resourcesEntirelyUncovered`, `resourcesWithNoExecutor` and
     * `resourcesUnavailable` below.
     */
    resourcesOperations: number;
    operationProperties: number;
    /**
     * #2821 — rows that are not independent resources: the same real tenant
     * object as another row, seen through the second extraction pipeline.
     * Excluded from every coverage bucket and from the denominator.
     */
    resourcesDuplicates: number;
    /**
     * `resources` minus `resourcesOperations` (#1929) minus
     * `resourcesDuplicates` (#2821) — the honest coverage denominator.
     */
    resourcesCoverageEligible: number;
    resourcesCoveredByAtLeastOneCheck: number;
    resourcesEntirelyUncovered: number;
    /** Resources no code path could read at all — their transport has no executor (#1869). */
    resourcesWithNoExecutor: number;
    /**
     * Resources on an executor-backed transport whose own scope sits above
     * anything this platform's principal can ever be granted (#1917).
     */
    resourcesUnavailable: number;
    /**
     * #2940 — rows that name the Graph collection they live inside. NOT excluded from
     * anything, unlike `resourcesDuplicates` above: these ARE independent resources that
     * happen to share a polymorphic collection, so this number OVERLAPS the coverage
     * buckets instead of partitioning with them.
     */
    resourcesContained: number;
    /**
     * #2940 — the subset of `resourcesEntirelyUncovered` whose parent collection IS
     * covered. A labelled subset for reading, never a subtraction: these gaps are still
     * open, they just have a read path already in place.
     */
    resourcesUncoveredUnderCoveredParent: number;
    resourcesUncoveredCollectionMembers: number;
    resourcesUncoveredNestedChildren: number;
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

/** #1847 — real Microsoft product names, matching the api-server's own display map. */
const SERVICE_LABELS: Record<string, string> = {
  intune: "Microsoft Intune",
};

/**
 * Never red for `not_configured` / `not_licensed`: neither is a fault. Amber says
 * "there is a real limitation here", which is the truth. `service_outage` is red
 * because it IS a live failure, and `available` is green.
 */
const SERVICE_STATE_TONE: Record<string, string> = {
  available: "bg-emerald-100 text-emerald-800 border-emerald-200",
  not_configured: "bg-amber-100 text-amber-900 border-amber-200",
  not_licensed: "bg-violet-100 text-violet-900 border-violet-200",
  permission_denied: "bg-rose-100 text-rose-900 border-rose-200",
  service_outage: "bg-rose-100 text-rose-900 border-rose-200",
  unknown: "bg-slate-100 text-slate-700 border-slate-200",
};

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
  /**
   * #2940 — an ORTHOGONAL filter to `coverage`, deliberately its own control rather than
   * extra options on the coverage dropdown. Containment is not a coverage state, and the
   * moment it appears in that list somebody reads "uncovered" as excluding it.
   */
  const [containment, setContainment] = useState(ALL);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<{
    properties: ResourceProperty[]; checks: MappedCheck[]; samples: ResourceSample[];
    /** #2821 — the real resource this row resolves onto, when it is a duplicate. */
    canonical: CanonicalRef | null;
    /** #2821 — the rows that resolve onto THIS one, when it is the canonical record. */
    duplicates: CanonicalRef[];
    /** #2940 — the collection this row lives inside, when it lives inside one. */
    containedIn: ContainmentRef | null;
    /** #2940 — the rows that live inside THIS one, when it is the collection. */
    containedMembers: ContainmentRef[];
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
      if (containment !== ALL) params.set("containment", containment);
      const res = await fetchWithAuth(`/api/admin/config-resources?${params.toString()}`);
      const data = await res.json() as { resources: ConfigResource[]; total: number };
      setResources(data.resources ?? []);
      setTotal(data.total ?? 0);
    } catch {
      toast({ title: "Error", description: "Failed to load config resources", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, toast, search, surface, transport, availability, coverage, containment]);

  useEffect(() => { void loadSummary(); }, [loadSummary]);
  useEffect(() => { void loadResources(); }, [loadResources]);

  /**
   * #1847 — the tenant-level service state, looked up from the ONE summary payload
   * rather than re-fetched per row. Undefined when the service has nothing observed,
   * which stays honestly blank instead of being assumed available.
   */
  const serviceStateByKey = useMemo(
    () => new Map((summary?.serviceAvailability.services ?? []).map((s) => [s.serviceKey, s.state])),
    [summary],
  );
  const serviceStateFor = useCallback(
    (key: string | null) => (key ? serviceStateByKey.get(key) ?? null : null),
    [serviceStateByKey],
  );

  const toggleExpand = useCallback(async (r: ConfigResource) => {
    if (expandedId === r.id) { setExpandedId(null); setDetail(null); return; }
    setExpandedId(r.id);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await fetchWithAuth(`/api/admin/config-resources/${r.id}`);
      const data = await res.json() as {
        properties: ResourceProperty[]; checks: MappedCheck[]; samples: ResourceSample[];
        canonical: CanonicalRef | null; duplicates: CanonicalRef[];
        containedIn: ContainmentRef | null; containedMembers: ContainmentRef[];
      };
      setDetail({
        properties: data.properties ?? [],
        checks: data.checks ?? [],
        samples: data.samples ?? [],
        canonical: data.canonical ?? null,
        duplicates: data.duplicates ?? [],
        containedIn: data.containedIn ?? null,
        containedMembers: data.containedMembers ?? [],
      });
    } catch {
      toast({ title: "Error", description: "Failed to load the resource detail", variant: "destructive" });
    } finally {
      setDetailLoading(false);
    }
  }, [expandedId, fetchWithAuth, toast]);

  const surfaces = useMemo(() => Object.keys(summary?.bySurface ?? {}).sort(), [summary]);
  const transports = useMemo(() => Object.keys(summary?.byTransport ?? {}).sort(), [summary]);
  const availabilities = useMemo(() => Object.keys(summary?.byAvailability ?? {}).sort(), [summary]);

  // Coverage is measured against the REACHABLE, non-operation model (#1869,
  // #1917, #1929). Resources whose transport has no executor, or whose own
  // scope is out of reach on an executor-backed transport, cannot be covered
  // by any check — counting them in the denominator would permanently
  // understate coverage and blame check authors for a transport/scope gap.
  // Bound-Function rows are an operation, not config state, so "coverage"
  // does not apply to them at all and they are excluded the same way. #2821
  // excludes duplicate rows for the same reason from the other direction: a row
  // that IS another row's object is not a second resource to cover, and counting
  // it once per pipeline made the denominator — and the gap — larger than reality.
  const reachableResources = summary
    ? summary.totals.resourcesCoverageEligible
      - summary.totals.resourcesWithNoExecutor
      - summary.totals.resourcesUnavailable
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
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-8" data-testid="config-model-totals">
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
            <StatTile
              label="Unavailable (scope)"
              value={summary.totals.resourcesUnavailable}
              sub="executor exists, but this resource's own scope is out of reach"
            />
            <StatTile
              label="Operations (excluded)"
              value={summary.totals.resourcesOperations}
              sub="bound Graph Functions — an operation, not config state; kept as reachable read endpoints, excluded from coverage and property counts"
            />
            <StatTile
              label="Duplicates (excluded)"
              value={summary.totals.resourcesDuplicates}
              sub="the same real tenant object as another row, seen through the second extraction pipeline and resolved onto it; not a second resource to cover"
            />
            {/*
              #2940 — read this tile NEXT TO "Duplicates (excluded)", not as a variant of
              it. A duplicate leaves the denominator because it is not a separate resource.
              A contained resource stays in every bucket it was already in, because it IS
              one: `IntuneDeviceConfigurationPolicyMacOS` and its 41 siblings are 42
              distinct configurable objects sharing one polymorphic Graph collection. The
              word "excluded" is deliberately absent from this label.
            */}
            <StatTile
              label="Inside a collection"
              value={summary.totals.resourcesContained}
              sub={
                summary.totals.resourcesUncoveredUnderCoveredParent > 0
                  ? `${summary.totals.resourcesUncoveredUnderCoveredParent} of these are still uncovered while a check already reads their parent collection — real gaps with a read path already in place, not covered rows`
                  : "rows that are a polymorphic member of, or nested under, a Graph collection; still counted in their own coverage bucket"
              }
            />
          </div>

          {/*
            #1847 — the tenant-level service fact, reported ONCE. Ten devices:* checks
            each announcing "Intune is not configured" is noise; this is the single
            statement they all refer to, with the real evidence that settled it.
          */}
          {summary.serviceAvailability.services.length > 0 && (
            <div className="space-y-3" data-testid="config-model-service-availability">
              {summary.serviceAvailability.services.map((s) => (
                <div
                  key={s.serviceKey}
                  className={`rounded-lg border p-4 text-sm ${SERVICE_STATE_TONE[s.state] ?? "bg-slate-100 text-slate-700 border-slate-200"}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{SERVICE_LABELS[s.serviceKey] ?? s.serviceKey}</span>
                    <Badge variant="outline" className={SERVICE_STATE_TONE[s.state] ?? ""}>
                      {s.state.replace(/_/g, " ")}
                    </Badge>
                    {summary.serviceAvailability.contradictedByService[s.serviceKey] != null && (
                      <span className="text-xs opacity-80">
                        {summary.serviceAvailability.contradictedByService[s.serviceKey]!.toLocaleString()} resources
                        still classified available_now on granted scopes
                      </span>
                    )}
                  </div>
                  <p className="mt-2 leading-relaxed">{s.reason}</p>
                  <p className="mt-2 text-xs opacity-80">
                    Evidence: {s.evidenceBasis}
                    {s.detectionSignature ? ` · ${s.detectionSignature}` : ""}
                    {s.observedEndpoint ? ` · ${s.observedEndpoint}` : ""}
                    {s.observedHttpStatus != null ? ` · HTTP ${s.observedHttpStatus}` : ""}
                    {s.detectedByCheckKey ? ` · via ${s.detectedByCheckKey}` : ""}
                    {" · first seen "}
                    {new Date(s.firstObservedAt).toLocaleString()}
                    {" · last seen "}
                    {new Date(s.lastObservedAt).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}

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
            <FilterSelect label="Coverage" value={coverage} onChange={setCoverage} options={["covered", "uncovered", "no_executor", "unavailable", "operation", "duplicate"]} testId="config-model-coverage" />
            {/*
              #2940 — a SEPARATE control so it composes with Coverage rather than replacing
              it. "uncovered" + "uncovered-under-covered-parent" together is the query a
              check author actually wants: open gaps that already have a read path.
            */}
            <FilterSelect label="Containment" value={containment} onChange={setContainment} options={["contained", "collection-member", "nested-child", "uncovered-under-covered-parent"]} testId="config-model-containment" />
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
                      {/*
                        #1847 — the resource's permission verdict above and its service's
                        state are separate facts. When the backing service is not answering
                        for this tenant, say so on the row: an `available_now` badge alone
                        is the model claiming a readability that live evidence contradicts.
                      */}
                      {r.serviceKey && serviceStateFor(r.serviceKey) && serviceStateFor(r.serviceKey) !== "available" && (
                        <Badge variant="outline" className={SERVICE_STATE_TONE[serviceStateFor(r.serviceKey)!] ?? ""}>
                          {SERVICE_LABELS[r.serviceKey] ?? r.serviceKey}: {serviceStateFor(r.serviceKey)!.replace(/_/g, " ")}
                        </Badge>
                      )}
                      <Badge variant="outline" className={VERIFICATION_TONE[r.verificationStatus] ?? ""}>{r.verificationStatus}</Badge>
                      <Badge variant="outline">{r.readTransport}</Badge>
                      <Badge variant="outline">{r.surface}</Badge>
                      {/* Six states, not two (#1869, #1917, #1929, #2821): "operation"
                          is a bound Graph Function — not config state, coverage does
                          not apply; "duplicate" is this row being another row's object
                          seen through the second extraction pipeline, so it has no
                          coverage question of its own and shows its canonical group's
                          count instead; "no executor" is a red transport gap no check
                          author can close; "unavailable" is a permission-scope gap on
                          an executor-backed transport; all distinct from the orange
                          "nobody has written this check yet". */}
                      {r.coverageState === "operation"
                        ? <Badge variant="outline" className="bg-slate-100 text-slate-700 border-slate-200" title="Bound Graph Function — an operation, not persistent config state. Kept as a reachable read endpoint, excluded from coverage.">operation</Badge>
                        : r.coverageState === "duplicate"
                          ? <Badge variant="outline" className="bg-violet-50 text-violet-800 border-violet-200" title={`Not a separate resource — the same real tenant object as another row, resolved onto it${r.canonicalMatchedOn ? ` (${r.canonicalBasis}: ${r.canonicalMatchedOn})` : ""}. Its coverage is that row's.`}>duplicate · {r.effectiveCheckCoverageCount} check{r.effectiveCheckCoverageCount === 1 ? "" : "s"}</Badge>
                          : r.coverageState === "no_executor"
                            ? <Badge variant="outline" className="bg-red-50 text-red-800 border-red-200" title={`No executor exists for the "${r.readTransport}" transport — this resource is unreachable by any code path.`}>no executor</Badge>
                            : r.coverageState === "unavailable"
                              ? <Badge variant="outline" className="bg-rose-50 text-rose-800 border-rose-200" title="An executor exists for this transport, but this resource's own scope sits above anything this platform's principal can ever be granted.">unavailable</Badge>
                              : r.effectiveCheckCoverageCount > 0
                                ? <Badge variant="outline">{r.effectiveCheckCoverageCount} check{r.effectiveCheckCoverageCount === 1 ? "" : "s"}</Badge>
                                : <Badge variant="outline" className="bg-orange-50 text-orange-800 border-orange-200">uncovered</Badge>}
                      {/*
                        #2940 — rendered AFTER the coverage badge and never in place of it.
                        A contained row still shows "uncovered" in orange above; this badge
                        adds where it lives, so the operator can see the gap has a read
                        path without the gap appearing to have been closed.
                      */}
                      {r.containedInResourceId && (
                        <Badge
                          variant="outline"
                          className="bg-sky-50 text-sky-800 border-sky-200"
                          title={r.containmentMatchedOn ?? undefined}
                          data-testid={`config-resource-containment-badge-${r.id}`}
                        >
                          {r.containmentKind === "nested-child" ? "nested child" : "in collection"}
                        </Badge>
                      )}
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

                    {/*
                      #2821 — the canonical-record resolution, stated on the row rather
                      than left for someone to reconstruct by grepping the table for a
                      same-`graphPath` sibling, which is exactly what #2761 had to do by
                      hand for all twenty identity-surface rows. Either half is worth
                      showing: what this row resolved onto, or — when it did not resolve
                      — the real reason, so an unresolved Graph-backed row is reviewable
                      instead of silently indistinguishable from an ordinary gap.
                    */}
                    {(r.canonicalResourceId || r.canonicalGapReason || (detail?.duplicates?.length ?? 0) > 0) && (
                      <div className="mt-4" data-testid={`config-resource-canonical-${r.id}`}>
                        <h3 className="font-medium">Canonical record</h3>
                        <dl className="mt-2 space-y-1 text-xs">
                          {r.canonicalResourceId ? (
                            <>
                              <Row k="Resolves onto" v={detail?.canonical?.resourceKey ?? `config_resources #${r.canonicalResourceId}`} />
                              {r.canonicalBasis && <Row k="Basis" v={r.canonicalBasis} />}
                              {r.canonicalMatchedOn && <Row k="Matched on" v={r.canonicalMatchedOn} />}
                              <Row
                                k="Group coverage"
                                v={`${r.effectiveCheckCoverageCount} check${r.effectiveCheckCoverageCount === 1 ? "" : "s"} read this object (credited to the canonical row, not this one)`}
                              />
                            </>
                          ) : (
                            <Row k="Not resolved" v={r.canonicalGapReason ?? ""} />
                          )}
                          {(detail?.duplicates?.length ?? 0) > 0 && (
                            <Row
                              k="Duplicates of this"
                              v={detail!.duplicates.map((d) => d.resourceKey).join(", ")}
                            />
                          )}
                        </dl>
                      </div>
                    )}

                    {/*
                      #2940 — the containment edge, shown as its OWN section directly below
                      "Canonical record" so the two relationships read as the different
                      things they are. Canonical answers "is this row the same object as
                      another"; this answers "which collection does this object live in".
                      The member list below deliberately prints each member's own coverage
                      state: forty-two uncovered members under one covered collection is
                      the honest picture, and rolling them up — the way the canonical group
                      legitimately does — would hide forty-one real gaps.
                    */}
                    {(r.containedInResourceId || r.containmentGapReason || (detail?.containedMembers?.length ?? 0) > 0) && (
                      <div className="mt-4" data-testid={`config-resource-containment-${r.id}`}>
                        <h3 className="font-medium">Lives inside</h3>
                        <dl className="mt-2 space-y-1 text-xs">
                          {r.containedInResourceId ? (
                            <>
                              <Row
                                k={r.containmentKind === "nested-child" ? "Nested under" : "Member of"}
                                v={detail?.containedIn?.graphPath ?? detail?.containedIn?.resourceKey ?? `config_resources #${r.containedInResourceId}`}
                              />
                              {r.containmentBasis && <Row k="Basis" v={r.containmentBasis} />}
                              {r.containmentMatchedOn && <Row k="Evidence" v={r.containmentMatchedOn} />}
                              {detail?.containedIn && (
                                <Row
                                  k="Parent coverage"
                                  v={
                                    detail.containedIn.effectiveCheckCoverageCount > 0
                                      ? `${detail.containedIn.effectiveCheckCoverageCount} check${detail.containedIn.effectiveCheckCoverageCount === 1 ? "" : "s"} read the parent collection. `
                                        + (r.containmentKind === "nested-child"
                                          ? "That check enumerates the containers, not this child — this row is still uncovered and closing it needs its own per-item read."
                                          : "That check returns objects of this type but asserts nothing specific about them — this row is still uncovered, it just already has a read path.")
                                      : "no check reads the parent collection either"
                                  }
                                />
                              )}
                            </>
                          ) : (
                            <Row k="No containment edge" v={r.containmentGapReason ?? ""} />
                          )}
                          {(detail?.containedMembers?.length ?? 0) > 0 && (
                            <Row
                              k={`Holds ${detail!.containedMembers.length} resource${detail!.containedMembers.length === 1 ? "" : "s"}`}
                              v={`${detail!.containedMembers.filter((m) => m.coverageState === "uncovered").length} of them uncovered · `
                                + detail!.containedMembers.map((m) => `${m.resourceKey} (${m.coverageState})`).join(", ")}
                            />
                          )}
                        </dl>
                      </div>
                    )}

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
