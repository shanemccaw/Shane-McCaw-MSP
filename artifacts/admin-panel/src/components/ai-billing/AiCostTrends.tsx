// artifacts/admin-panel/src/components/ai-billing/AiCostTrends.tsx
//
// Trends & anomalies section of the PlatformAdmin AI Billing page (initiative:
// ai-cost-governance-billing-rollup, Phase 4 / Issue #52). Backed entirely by
// GET /admin/ai-billing/analytics.
//
// It answers three questions Phase 3's ledger could not: where is spend going
// over time, which customer / MSP / document type is driving it, and has any
// period broken out of its own recent baseline.
//
// Phase 4.1 (#81) adds a fourth and fifth, from GET /admin/ai-billing/lead-analytics:
// what does a LEAD cost, and what does one ASSESSMENT RUN cost — the two figures
// the parent tracker (#48) frames the initiative around. That endpoint is fetched
// separately from /analytics because it runs two extra identity queries that the
// chart above should not pay for on every bucket-size change.
//
// ── Colours are explicit, never inherited ────────────────────────────────────
//
// admin-panel's design tokens are RAW HSL TRIPLES (`--border: 217.9 21.4% 17.5%`),
// not complete colour values — they are only valid inside an `hsl()` wrapper,
// which Tailwind supplies and a charting library's theme does not. Handing
// `var(--border)` to a chart yields an invisible grid and black ticks; that
// breakage is documented in this codebase and the fix is to pass colour props
// explicitly. Every colour below is therefore a literal, taken from the token
// block in index.css, exactly as the other recharts pages here already do.
//
// recharts is the chart library because it is what admin-panel already uses in
// nine places. @workspace/dashboard-canvas (Nivo) is the widget-canvas system
// used by the dashboard designer; pulling it in here would add a second chart
// runtime to this page in order to render one line.
//
// ── Money ────────────────────────────────────────────────────────────────────
//
// Everything on the wire and in state is integer cents. Cents become currency
// only through ./format, at render time.

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle } from "lucide-react";
import { formatBucketLabel, formatCents, formatCentsCompact, formatRatio } from "./format";

// Literal tokens from index.css — see the docblock above for why these are not
// CSS variables.
const CHART = {
  grid: "#232A36",
  tick: "#8B94A3",
  line: "#2F6FED",
  surface: "#171C26",
  border: "#232A36",
  text: "#E6EDF3",
  elevated: "#F0B429", // Signal Amber
  severe: "#EF4444", // Signal Red
} as const;

// ─── Types (mirror routes/admin-ai-billing.ts's /analytics response) ─────────

export type TrendBucket = "day" | "week" | "month";

export interface TrendPoint {
  bucketKey: string;
  bucketStart: string;
  costCents: number;
  eventCount: number;
  partial: boolean;
}

export interface DimensionSlice {
  key: string;
  id: number | null;
  label: string;
  costCents: number;
  eventCount: number;
}

export interface DimensionRollup {
  dimension: string;
  slices: DimensionSlice[];
  other: { costCents: number; eventCount: number; sliceCount: number };
  unattributed: { costCents: number; eventCount: number; label: string };
  totalCostCents: number;
  eventCount: number;
}

export interface Anomaly {
  bucketKey: string;
  bucketStart: string;
  costCents: number;
  baselineCents: number;
  ratioBps: number | null;
  severity: "elevated" | "severe";
  reason: "above-baseline" | "new-spend";
}

export interface AnalyticsResponse {
  bucket: TrendBucket;
  bucketCount: number;
  periodStart: string;
  periodEnd: string;
  totalCostCents: number;
  eventCount: number;
  coverage: {
    rowsScanned: number;
    rowLimit: number;
    truncated: boolean;
    observedFrom: string | null;
  };
  series: TrendPoint[];
  byCustomer: DimensionRollup;
  byMsp: DimensionRollup;
  byArtifactType: DimensionRollup;
  anomalies: {
    rule: { direction: string; description: string; factor: number };
    anomalies: Anomaly[];
    evaluated: number;
    skipped: { partialBucket: number; insufficientBaseline: number };
  };
}

// ─── Phase 4.1 types (mirror /admin/ai-billing/lead-analytics) ───────────────

export interface LeadCostSlice {
  key: string;
  leadStagingId: number;
  label: string;
  email: string | null;
  source: string | null;
  costCents: number;
  eventCount: number;
}

export interface AssessmentRunCostSlice {
  key: string;
  runId: string;
  customerId: number | null;
  status: string | null;
  startedAt: string | null;
  completedAt: string | null;
  costCents: number;
  eventCount: number;
}

export interface CostPerLeadRollup {
  slices: LeadCostSlice[];
  other: { costCents: number; eventCount: number; sliceCount: number };
  unattributed: {
    costCents: number;
    eventCount: number;
    label: string;
    breakdown: {
      noCustomer: { costCents: number; eventCount: number };
      customerWithoutLead: { costCents: number; eventCount: number };
    };
  };
  /** Null — never 0 — when no lead has spend. See the empty-state note below. */
  medianCostPerLeadCents: number | null;
  meanCostPerLeadCents: number | null;
  leadsWithSpend: number;
  leadsReachable: number;
  ambiguousTenantCount: number;
  attributedCostCents: number;
  totalCostCents: number;
  eventCount: number;
}

export interface CostPerAssessmentRunRollup {
  slices: AssessmentRunCostSlice[];
  other: { costCents: number; eventCount: number; sliceCount: number };
  unattributed: { costCents: number; eventCount: number; label: string };
  medianCostPerRunCents: number | null;
  meanCostPerRunCents: number | null;
  runsInWindow: number;
  runsWithSpend: number;
  runsWithoutInterval: number;
  overlappingEventCount: number;
  attributedCostCents: number;
  totalCostCents: number;
  eventCount: number;
  attribution: { method: string; openRunCapMs: number; note: string };
}

export interface LeadAnalyticsResponse {
  bucket: TrendBucket;
  periodStart: string;
  periodEnd: string;
  totalCostCents: number;
  eventCount: number;
  coverage: {
    rowsScanned: number;
    rowLimit: number;
    truncated: boolean;
    distinctTenants: number;
    tenantsElided: number;
    identityLinkRows: number;
    identityLinksTruncated: boolean;
    assessmentRunsTruncated: boolean;
  };
  byLead: CostPerLeadRollup;
  byAssessmentRun: CostPerAssessmentRunRollup;
  leadsStagedInWindow: number;
}

const BUCKET_OPTIONS: { value: TrendBucket; label: string }[] = [
  { value: "day", label: "Daily" },
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
];

/** Default span per bucket size — matches the server's own defaults. */
const DEFAULT_COUNT: Record<TrendBucket, number> = { day: 30, week: 26, month: 12 };

export interface AiCostTrendsProps {
  fetchWithAuth: (input: string, init?: RequestInit) => Promise<Response>;
  tzOffsetMinutes: number;
  /** Non-date filters, so the charts describe the same slice as the ledger below. */
  scope: {
    mspId: string;
    customerId: string;
    costOwner: string;
    feature: string;
    generatedArtifactType: string;
  };
  /** Drill-down: clicking a slice narrows the page's shared filters. */
  onFilter: (patch: {
    mspId?: string;
    customerId?: string;
    generatedArtifactType?: string;
  }) => void;
  /** Bumped by the page's refresh control. */
  reloadKey?: number;
}

export default function AiCostTrends({
  fetchWithAuth,
  tzOffsetMinutes,
  scope,
  onFilter,
  reloadKey = 0,
}: AiCostTrendsProps) {
  const [bucket, setBucket] = useState<TrendBucket>("day");
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [leadData, setLeadData] = useState<LeadAnalyticsResponse | null>(null);
  const [leadLoading, setLeadLoading] = useState(true);
  const [leadError, setLeadError] = useState<string | null>(null);

  const query = useMemo(() => {
    const q = new URLSearchParams();
    q.set("bucket", bucket);
    q.set("buckets", String(DEFAULT_COUNT[bucket]));
    q.set("tzOffsetMinutes", String(tzOffsetMinutes));
    if (scope.mspId) q.set("mspId", scope.mspId);
    if (scope.customerId) q.set("customerId", scope.customerId);
    if (scope.costOwner) q.set("costOwner", scope.costOwner);
    if (scope.feature) q.set("feature", scope.feature);
    if (scope.generatedArtifactType) q.set("generatedArtifactType", scope.generatedArtifactType);
    return q.toString();
  }, [bucket, tzOffsetMinutes, scope]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchWithAuth(`/api/admin/ai-billing/analytics?${query}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("analytics"))))
      .then((json: AnalyticsResponse) => {
        if (cancelled) return;
        setData(json);
      })
      .catch(() => {
        if (cancelled) return;
        setData(null);
        setError("Could not load AI cost trends.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [query, fetchWithAuth, reloadKey]);

  // Phase 4.1: its own request, so a failure here degrades the lead section
  // alone rather than blanking the trend chart above it.
  useEffect(() => {
    let cancelled = false;
    setLeadLoading(true);
    setLeadError(null);

    fetchWithAuth(`/api/admin/ai-billing/lead-analytics?${query}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("lead-analytics"))))
      .then((json: LeadAnalyticsResponse) => {
        if (cancelled) return;
        setLeadData(json);
      })
      .catch(() => {
        if (cancelled) return;
        setLeadData(null);
        setLeadError("Could not load cost-per-lead analytics.");
      })
      .finally(() => { if (!cancelled) setLeadLoading(false); });

    return () => { cancelled = true; };
  }, [query, fetchWithAuth, reloadKey]);

  const anomalies = data?.anomalies.anomalies ?? [];
  const anomalyByKey = useMemo(
    () => new Map(anomalies.map((a) => [a.bucketKey, a])),
    [anomalies],
  );
  const partialCount = (data?.series ?? []).filter((p) => p.partial).length;

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <span className="text-[11px] font-semibold text-foreground">Trends &amp; anomalies</span>
        {anomalies.length > 0 && (
          <span className="flex items-center gap-1 rounded-sm border border-warning/40 bg-warning/10 px-1.5 py-px text-[9px] font-medium uppercase tracking-wider text-warning">
            <AlertTriangle className="h-2.5 w-2.5" />
            {anomalies.length} flagged
          </span>
        )}
        <div className="flex-1" />
        <div className="flex items-center gap-1 rounded-sm border border-border p-0.5">
          {BUCKET_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setBucket(o.value)}
              className={`rounded-sm px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors ${
                bucket === o.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3 p-3">
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {/* Coverage is stated whenever the scan was clipped — a chart drawn over
            part of a window must not look like a chart drawn over all of it. */}
        {data?.coverage.truncated && (
          <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-warning">
            This window holds more than {data.coverage.rowLimit.toLocaleString()} usage events, so
            only the most recent {data.coverage.rowsScanned.toLocaleString()} were read. Periods
            before {new Date(data.coverage.observedFrom ?? "").toLocaleString()} are shown as
            partially observed and are excluded from anomaly detection. Narrow the filters for a
            complete picture.
          </div>
        )}

        {/* ── Trend chart ── */}
        <div className="h-[200px] w-full">
          {data && data.series.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="aiCostArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART.line} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={CHART.line} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
                <XAxis
                  dataKey="bucketKey"
                  tickFormatter={(k: string) => formatBucketLabel(k, bucket)}
                  stroke={CHART.grid}
                  tick={{ fill: CHART.tick, fontSize: 10 }}
                  tickLine={false}
                  minTickGap={16}
                />
                <YAxis
                  stroke={CHART.grid}
                  tick={{ fill: CHART.tick, fontSize: 10 }}
                  tickLine={false}
                  width={48}
                  tickFormatter={(cents: number) => formatCentsCompact(cents)}
                />
                <Tooltip
                  cursor={{ stroke: CHART.tick, strokeDasharray: "3 3" }}
                  content={(props) => (
                    <TrendTooltip
                      active={props.active}
                      payload={props.payload as { payload?: TrendPoint }[] | undefined}
                      bucket={bucket}
                      anomalyByKey={anomalyByKey}
                    />
                  )}
                />
                <Area
                  type="monotone"
                  dataKey="costCents"
                  stroke={CHART.line}
                  strokeWidth={2}
                  fill="url(#aiCostArea)"
                  dot={false}
                  isAnimationActive={false}
                />
                {anomalies.map((a) => (
                  <ReferenceDot
                    key={a.bucketKey}
                    x={a.bucketKey}
                    y={a.costCents}
                    r={4}
                    fill={a.severity === "severe" ? CHART.severe : CHART.elevated}
                    stroke={CHART.surface}
                    strokeWidth={1.5}
                    isFront
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              {loading ? "Loading…" : "No AI usage in this window."}
            </div>
          )}
        </div>

        {/* ── The rule, in words ── */}
        {data && (
          <div className="rounded-md border border-border bg-background px-2.5 py-1.5">
            <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
              Anomaly rule
            </p>
            {/* Printed from the server's own rule object, so the stated threshold
                cannot drift from the one the data was actually judged by. */}
            <p className="mt-0.5 text-[11px] leading-relaxed text-foreground">
              {data.anomalies.rule.description}
            </p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {data.anomalies.evaluated} of {data.series.length} periods judged
              {data.anomalies.skipped.insufficientBaseline > 0 &&
                ` · ${data.anomalies.skipped.insufficientBaseline} skipped for want of a baseline`}
              {partialCount > 0 && ` · ${partialCount} not fully observed`}
            </p>
          </div>
        )}

        {/* ── Flagged periods ── */}
        {anomalies.length > 0 && (
          <ul className="space-y-1">
            {anomalies.map((a) => (
              <li
                key={a.bucketKey}
                className={`flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-md border px-2.5 py-1.5 font-mono text-[11px] ${
                  a.severity === "severe"
                    ? "border-destructive/40 bg-destructive/10"
                    : "border-warning/40 bg-warning/10"
                }`}
              >
                <span
                  className={`text-[9px] font-semibold uppercase tracking-wider ${
                    a.severity === "severe" ? "text-destructive" : "text-warning"
                  }`}
                >
                  {a.severity}
                </span>
                <span className="text-foreground">{formatBucketLabel(a.bucketKey, bucket)}</span>
                <span className="tabular-nums text-foreground">{formatCents(a.costCents)}</span>
                <span className="text-muted-foreground">
                  {a.reason === "new-spend"
                    ? "no spend in the preceding baseline"
                    : `vs ${formatCents(a.baselineCents)} baseline · ${formatRatio(a.ratioBps)}`}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* ── Cost per customer / MSP / document type ── */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <DimensionPanel
            title="Cost per customer"
            rollup={data?.byCustomer ?? null}
            bucketLabel="customer"
            onSelect={(s) => s.id != null && onFilter({ customerId: String(s.id) })}
          />
          <DimensionPanel
            title="Cost per MSP"
            rollup={data?.byMsp ?? null}
            bucketLabel="MSP"
            onSelect={(s) => s.id != null && onFilter({ mspId: String(s.id) })}
          />
          <DimensionPanel
            title="Cost per document type"
            rollup={data?.byArtifactType ?? null}
            bucketLabel="document type"
            onSelect={(s) => onFilter({ generatedArtifactType: s.key })}
          />
        </div>

        {/* ── Phase 4.1: cost per lead / cost per assessment run ── */}
        <LeadCostSection data={leadData} loading={leadLoading} error={leadError} />
      </div>
    </div>
  );
}

// ─── Phase 4.1: lead & assessment-run cost ───────────────────────────────────

/**
 * The two figures #48 frames the whole initiative around.
 *
 * Three things this section is careful about, because they are the acceptance
 * criteria this phase was written around:
 *
 *   1. A NULL headline renders as "no figure yet", never as "$0.00". Until
 *      #133's live Zoho verification lands, `lead_staging` may be near-empty and
 *      a confident $0.00 would read as "leads are free" rather than "we have
 *      nothing to measure".
 *   2. Unattributed spend gets its own line AND its own reasons. The two reasons
 *      call for different fixes — a null customerId is an unwrapped call site, a
 *      customer with no lead is a real gap in lead capture — so they are never
 *      merged into one number.
 *   3. The assessment-run figure prints the server's own attribution note
 *      verbatim. It is an interval attribution, not a key join, and the reader
 *      is told so rather than being left to assume precision that is not there.
 */
function LeadCostSection({
  data,
  loading,
  error,
}: {
  data: LeadAnalyticsResponse | null;
  loading: boolean;
  error: string | null;
}) {
  if (error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        {error}
      </div>
    );
  }

  // Guarded on the rollups themselves, not just on `data`: a response that
  // arrives without them is a shape this section cannot render, and it must
  // degrade to an empty state rather than take the trend chart above it down
  // with a render throw.
  if (!data?.byLead || !data.byAssessmentRun) {
    return (
      <div className="rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
        {loading ? "Loading lead costs…" : "No lead cost data."}
      </div>
    );
  }

  const { byLead, byAssessmentRun } = data;

  return (
    <div className="space-y-3 rounded-md border border-border bg-background p-2.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Cost per lead &amp; per assessment run
        </span>
        <span className="text-[10px] text-muted-foreground">
          {data.leadsStagedInWindow} lead{data.leadsStagedInWindow === 1 ? "" : "s"} staged in this
          window
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <HeadlineFigure
          label="Median cost per lead"
          cents={byLead.medianCostPerLeadCents}
          meanCents={byLead.meanCostPerLeadCents}
          detail={
            byLead.leadsWithSpend > 0
              ? `across ${byLead.leadsWithSpend} lead${byLead.leadsWithSpend === 1 ? "" : "s"} with spend · ${byLead.leadsReachable} reachable`
              : `no lead in this window incurred AI spend · ${byLead.leadsReachable} reachable`
          }
        />
        <HeadlineFigure
          label="Median cost per assessment run"
          cents={byAssessmentRun.medianCostPerRunCents}
          meanCents={byAssessmentRun.meanCostPerRunCents}
          detail={
            byAssessmentRun.runsWithSpend > 0
              ? `across ${byAssessmentRun.runsWithSpend} of ${byAssessmentRun.runsInWindow} run${byAssessmentRun.runsInWindow === 1 ? "" : "s"} in this window`
              : `no spend attributed to any of ${byAssessmentRun.runsInWindow} run${byAssessmentRun.runsInWindow === 1 ? "" : "s"} in this window`
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-md border border-border p-2.5">
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Top leads by AI spend
          </p>
          {byLead.slices.length === 0 ? (
            <p className="font-mono text-[11px] text-muted-foreground">
              No AI spend traced to a lead in this window.
            </p>
          ) : (
            <ul className="space-y-0.5 font-mono text-[11px]">
              {byLead.slices.map((s) => (
                <li key={s.key} className="flex items-baseline gap-2">
                  <span className="flex-1 truncate text-foreground" title={s.email ?? s.label}>
                    {s.label}
                    {s.source && (
                      <span className="ml-1 text-muted-foreground">· {s.source}</span>
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatCents(s.costCents)}
                  </span>
                </li>
              ))}
              {byLead.other.sliceCount > 0 && (
                <li className="flex items-baseline gap-2 text-muted-foreground">
                  <span className="flex-1 truncate">
                    {byLead.other.sliceCount} more lead
                    {byLead.other.sliceCount === 1 ? "" : "s"}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {formatCents(byLead.other.costCents)}
                  </span>
                </li>
              )}
            </ul>
          )}

          {/* Unattributed, split by reason — see this component's docblock. */}
          {byLead.unattributed.eventCount > 0 && (
            <div className="mt-1.5 border-t border-border pt-1.5 font-mono text-[11px]">
              <div className="flex items-baseline gap-2 text-muted-foreground">
                <span className="flex-1 truncate">{byLead.unattributed.label}</span>
                <span className="shrink-0 tabular-nums">
                  {formatCents(byLead.unattributed.costCents)}
                </span>
              </div>
              <ul className="mt-0.5 space-y-px text-[9px] text-muted-foreground/80">
                <li>
                  {formatCents(byLead.unattributed.breakdown.noCustomer.costCents)} from calls with
                  no customer recorded ({byLead.unattributed.breakdown.noCustomer.eventCount} call
                  {byLead.unattributed.breakdown.noCustomer.eventCount === 1 ? "" : "s"}) — includes
                  any spend around an unpromoted quiz result, which carries no identity to trace
                </li>
                <li>
                  {formatCents(byLead.unattributed.breakdown.customerWithoutLead.costCents)} from
                  customers with no lead on record (
                  {byLead.unattributed.breakdown.customerWithoutLead.eventCount} call
                  {byLead.unattributed.breakdown.customerWithoutLead.eventCount === 1 ? "" : "s"})
                </li>
              </ul>
            </div>
          )}

          {byLead.ambiguousTenantCount > 0 && (
            <p className="mt-1 text-[9px] text-muted-foreground/80">
              {byLead.ambiguousTenantCount} customer
              {byLead.ambiguousTenantCount === 1 ? "" : "s"} resolved to more than one lead; spend
              was attributed to the earliest lead staged for each, never counted twice.
            </p>
          )}
        </div>

        <div className="rounded-md border border-border p-2.5">
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Top assessment runs by AI spend
          </p>
          {byAssessmentRun.slices.length === 0 ? (
            <p className="font-mono text-[11px] text-muted-foreground">
              No AI spend attributed to an assessment run in this window.
            </p>
          ) : (
            <ul className="space-y-0.5 font-mono text-[11px]">
              {byAssessmentRun.slices.map((s) => (
                <li key={s.key} className="flex items-baseline gap-2">
                  <span className="flex-1 truncate text-foreground" title={s.runId}>
                    {s.runId.slice(0, 8)}
                    <span className="ml-1 text-muted-foreground">
                      · {s.status ?? "unknown"}
                      {s.startedAt && ` · ${new Date(s.startedAt).toLocaleDateString()}`}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatCents(s.costCents)}
                  </span>
                </li>
              ))}
              {byAssessmentRun.other.sliceCount > 0 && (
                <li className="flex items-baseline gap-2 text-muted-foreground">
                  <span className="flex-1 truncate">
                    {byAssessmentRun.other.sliceCount} more run
                    {byAssessmentRun.other.sliceCount === 1 ? "" : "s"}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {formatCents(byAssessmentRun.other.costCents)}
                  </span>
                </li>
              )}
            </ul>
          )}

          {byAssessmentRun.unattributed.eventCount > 0 && (
            <div className="mt-1.5 border-t border-border pt-1.5 font-mono text-[11px]">
              <div className="flex items-baseline gap-2 text-muted-foreground">
                <span className="flex-1 truncate">{byAssessmentRun.unattributed.label}</span>
                <span className="shrink-0 tabular-nums">
                  {formatCents(byAssessmentRun.unattributed.costCents)}
                </span>
              </div>
            </div>
          )}

          {/* Printed from the server's own note so the page cannot describe an
              interval attribution as an exact per-run cost. */}
          <p className="mt-1.5 text-[9px] leading-relaxed text-muted-foreground/80">
            {byAssessmentRun.attribution.note}
          </p>
        </div>
      </div>

      {/* Any ceiling that bit is stated, for the same reason the trend chart
          states a clipped scan: a capped attribution must not read as a
          complete one. */}
      {(data.coverage.truncated ||
        data.coverage.tenantsElided > 0 ||
        data.coverage.identityLinksTruncated ||
        data.coverage.assessmentRunsTruncated) && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-[10px] text-warning">
          These figures cover part of the window only
          {data.coverage.truncated &&
            ` · read the most recent ${data.coverage.rowsScanned.toLocaleString()} of more than ${data.coverage.rowLimit.toLocaleString()} usage events`}
          {data.coverage.tenantsElided > 0 &&
            ` · ${data.coverage.tenantsElided} customer${data.coverage.tenantsElided === 1 ? "" : "s"} left unresolved`}
          {data.coverage.identityLinksTruncated && " · identity resolution hit its row ceiling"}
          {data.coverage.assessmentRunsTruncated && " · assessment run list hit its ceiling"}
          . Narrow the filters for a complete picture.
        </p>
      )}
    </div>
  );
}

/**
 * One headline figure. A null `cents` is the honest "we have no figure" state
 * and is rendered as such — never as $0.00, which would be a different and
 * false claim.
 */
function HeadlineFigure({
  label,
  cents,
  meanCents,
  detail,
}: {
  label: string;
  cents: number | null;
  meanCents: number | null;
  detail: string;
}) {
  return (
    <div className="rounded-md border border-border p-2.5">
      <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 font-mono text-lg tabular-nums text-foreground">
        {cents == null ? (
          <span className="text-sm text-muted-foreground">No figure yet</span>
        ) : (
          formatCents(cents)
        )}
      </p>
      {cents != null && meanCents != null && meanCents !== cents && (
        <p className="text-[9px] text-muted-foreground">
          mean {formatCents(meanCents)} — median shown, so one runaway does not move it
        </p>
      )}
      <p className="mt-0.5 text-[10px] text-muted-foreground">{detail}</p>
    </div>
  );
}

// ─── Presentational pieces ───────────────────────────────────────────────────

function TrendTooltip({
  active,
  payload,
  bucket,
  anomalyByKey,
}: {
  active?: boolean;
  payload?: { payload?: TrendPoint }[];
  bucket: TrendBucket;
  anomalyByKey: Map<string, Anomaly>;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  const anomaly = anomalyByKey.get(point.bucketKey);

  return (
    <div
      className="rounded-sm border px-2 py-1 font-mono text-[10px]"
      style={{ background: CHART.surface, borderColor: CHART.border, color: CHART.text }}
    >
      <div>{formatBucketLabel(point.bucketKey, bucket)}</div>
      <div className="tabular-nums">
        {formatCents(point.costCents)} · {point.eventCount} call
        {point.eventCount === 1 ? "" : "s"}
      </div>
      {/* A period that is still running, or that the row scan could not fully
          read, is understated — saying so beats letting it read as a dip. */}
      {point.partial && <div style={{ color: CHART.tick }}>not fully observed</div>}
      {anomaly && (
        <div style={{ color: anomaly.severity === "severe" ? CHART.severe : CHART.elevated }}>
          {anomaly.reason === "new-spend"
            ? "flagged — new spend"
            : `flagged — ${formatRatio(anomaly.ratioBps)} baseline`}
        </div>
      )}
    </div>
  );
}

function DimensionPanel({
  title,
  rollup,
  bucketLabel,
  onSelect,
}: {
  title: string;
  rollup: DimensionRollup | null;
  bucketLabel: string;
  onSelect: (slice: DimensionSlice) => void;
}) {
  const total = rollup?.totalCostCents ?? 0;

  return (
    <div className="rounded-md border border-border bg-background p-2.5">
      <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </p>

      {!rollup || (rollup.slices.length === 0 && rollup.unattributed.eventCount === 0) ? (
        <p className="font-mono text-[11px] text-muted-foreground">No spend in this window.</p>
      ) : (
        <>
          <ul className="space-y-0.5 font-mono text-[11px]">
            {rollup.slices.map((s) => (
              <li key={s.key} className="flex items-baseline gap-2">
                <button
                  type="button"
                  onClick={() => onSelect(s)}
                  className="flex-1 truncate text-left text-foreground hover:text-primary hover:underline"
                  title={`Filter by ${s.label}`}
                >
                  {s.label}
                </button>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatCents(s.costCents)}
                </span>
              </li>
            ))}

            {/* A capped list says what it dropped rather than ending silently. */}
            {rollup.other.sliceCount > 0 && (
              <li className="flex items-baseline gap-2 text-muted-foreground">
                <span className="flex-1 truncate">
                  {rollup.other.sliceCount} more {bucketLabel}
                  {rollup.other.sliceCount === 1 ? "" : "s"}
                </span>
                <span className="shrink-0 tabular-nums">{formatCents(rollup.other.costCents)}</span>
              </li>
            )}
          </ul>

          {/* Unattributed spend is shown as its own line, outside the ranking.
              Folding it into a named bucket would overstate how well attributed
              this spend actually is — which is the number worth watching. */}
          {rollup.unattributed.eventCount > 0 && (
            <div className="mt-1.5 border-t border-border pt-1.5 font-mono text-[11px]">
              <div className="flex items-baseline gap-2 text-muted-foreground">
                <span className="flex-1 truncate" title={rollup.unattributed.label}>
                  {rollup.unattributed.label}
                </span>
                <span className="shrink-0 tabular-nums">
                  {formatCents(rollup.unattributed.costCents)}
                </span>
              </div>
              <p className="mt-0.5 text-[9px] text-muted-foreground/80">
                {total > 0
                  ? `${Math.round((rollup.unattributed.costCents / total) * 100)}% of this window's spend, across ${rollup.unattributed.eventCount} call${rollup.unattributed.eventCount === 1 ? "" : "s"}`
                  : `${rollup.unattributed.eventCount} call${rollup.unattributed.eventCount === 1 ? "" : "s"}`}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
