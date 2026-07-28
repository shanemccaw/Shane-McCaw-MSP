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
      </div>
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
