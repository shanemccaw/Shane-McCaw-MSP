// artifacts/admin-panel/src/pages/AiBillingPage.tsx
//
// PlatformAdmin AI Billing page (initiative: ai-cost-governance-billing-rollup,
// Phase 3 / Issue #51). Routed at /system/ai-billing via SystemWorkspace's
// case-dispatch, registered in workspaceNav's "platform" section.
//
// NOT the MSP-facing view — artifacts/msp-portal/src/pages/ai-billing.tsx is an
// MSP looking at its own allowance. Everything here is platform-wide.
//
// Filter state lives in the URL search string (the RunHistoryPage convention),
// so the StatusBar's Today/Month click-through can deep-link straight into a
// pre-filtered view and the result stays shareable/refreshable.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import AiCostTrends from "@/components/ai-billing/AiCostTrends";
import { formatCents } from "@/components/ai-billing/format";

// ─── Types (mirror routes/admin-ai-billing.ts's responses) ───────────────────

interface UsageEvent {
  id: number;
  eventId: string | null;
  occurredAt: string | null;
  mspId: number | null;
  mspName: string | null;
  customerId: number | null;
  customerName: string | null;
  nodeType: string | null;
  feature: string | null;
  triggerSource: string | null;
  generatedArtifactType: string | null;
  generatedArtifactName: string | null;
  generatedArtifactId: string | null;
  costCents: number;
  costOwner: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  model: string | null;
  runId: string | null;
  correlationId: string | null;
}

interface EventsResponse {
  events: UsageEvent[];
  total: number;
  filteredCostCents: number;
  limit: number;
  offset: number;
}

interface SummaryResponse {
  range: "today" | "month";
  periodStart: string;
  periodEnd: string;
  totalCostCents: number;
  eventCount: number;
  byCostOwner: { costOwner: string; costCents: number; eventCount: number }[];
  byMsp: { mspId: number | null; mspName: string; costCents: number; eventCount: number }[];
  byFeature: { feature: string; costCents: number; eventCount: number }[];
}

const PAGE_SIZE = 50;

// formatCents lives in components/ai-billing/format so the ledger and the Phase 4
// trends section render cents identically — and so cents become currency in
// exactly one place.

function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

// ─── Filter state (URL-backed) ───────────────────────────────────────────────

interface Filters {
  range: "today" | "month";
  mspId: string;
  customerId: string;
  from: string;
  to: string;
  nodeType: string;
  feature: string;
  costOwner: string;
  generatedArtifactType: string;
  offset: number;
}

function parseFilters(searchStr: string): Filters {
  const sp = new URLSearchParams(searchStr);
  return {
    // The StatusBar deep-links with ?range=today|month; "month" is the default
    // for a direct visit because the page is a ledger, not a live ticker.
    range: sp.get("range") === "today" ? "today" : "month",
    mspId: sp.get("mspId") ?? "",
    customerId: sp.get("customerId") ?? "",
    from: sp.get("from") ?? "",
    to: sp.get("to") ?? "",
    nodeType: sp.get("nodeType") ?? "",
    feature: sp.get("feature") ?? "",
    costOwner: sp.get("costOwner") ?? "",
    generatedArtifactType: sp.get("generatedArtifactType") ?? "",
    offset: Number(sp.get("offset") ?? 0) || 0,
  };
}

/** Build the /events query string from the active filters. */
function buildEventsQuery(f: Filters, tzOffsetMinutes: number): string {
  const q = new URLSearchParams();
  q.set("limit", String(PAGE_SIZE));
  q.set("offset", String(f.offset));
  if (f.mspId) q.set("mspId", f.mspId);
  if (f.customerId) q.set("customerId", f.customerId);
  if (f.nodeType) q.set("nodeType", f.nodeType);
  if (f.feature) q.set("feature", f.feature);
  if (f.costOwner) q.set("costOwner", f.costOwner);
  if (f.generatedArtifactType) q.set("generatedArtifactType", f.generatedArtifactType);

  // An explicit from/to always wins. Otherwise the selected range's own window
  // bounds the table, so the summary cards above it and the rows below it are
  // describing the SAME period rather than quietly disagreeing.
  if (f.from || f.to) {
    // The date inputs give a bare "YYYY-MM-DD". Bare-date strings parse as UTC
    // midnight, so the explicit local time-of-day suffix is what makes the
    // filter mean the viewer's day. `to` covers through the END of the chosen
    // day — the server's `to` bound is inclusive, and a bare midnight would
    // otherwise exclude the entire day the user just selected.
    if (f.from) q.set("from", new Date(`${f.from}T00:00:00`).toISOString());
    if (f.to) q.set("to", new Date(`${f.to}T23:59:59.999`).toISOString());
  } else {
    q.set("_rangeTz", String(tzOffsetMinutes));
  }
  return q.toString();
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function AiBillingPage() {
  const { fetchWithAuth } = useAuth();
  const [location, navigate] = useLocation();
  const searchStr = useSearch();
  const filters = useMemo(() => parseFilters(searchStr), [searchStr]);
  const tzOffsetMinutes = useMemo(() => new Date().getTimezoneOffset(), []);

  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [events, setEvents] = useState<EventsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const setFilter = useCallback(
    (patch: Partial<Filters>) => {
      const sp = new URLSearchParams(searchStr);
      for (const [k, v] of Object.entries(patch)) {
        if (v === "" || v === undefined || v === null) sp.delete(k);
        else sp.set(k, String(v));
      }
      // Any filter change other than paging resets to the first page — leaving
      // a stale offset would show an empty page and read as "no results".
      if (!("offset" in patch)) sp.delete("offset");
      navigate(`${location}?${sp.toString()}`);
    },
    [searchStr, location, navigate],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const summaryUrl =
      `/api/admin/ai-billing/summary?range=${filters.range}&tzOffsetMinutes=${tzOffsetMinutes}`;

    // Sequential on purpose: with no explicit from/to, the table is bounded by
    // the SAME window the summary resolved, so the cards and the rows can never
    // describe different periods. The server owns that window (timezone and
    // month-length logic live in one place), so the client waits for it rather
    // than recomputing it and risking a drift of its own.
    fetchWithAuth(summaryUrl)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("summary"))))
      .then(async (s: SummaryResponse) => {
        const q = new URLSearchParams(buildEventsQuery(filters, tzOffsetMinutes));
        if (q.has("_rangeTz")) {
          q.delete("_rangeTz");
          q.set("from", s.periodStart);
          // periodEnd is EXCLUSIVE but the events endpoint's `to` is inclusive,
          // so step back one millisecond. Passing periodEnd straight through
          // would let a call at the exact stroke of the next period leak into
          // this one and make the table's total exceed the summary's.
          q.set("to", new Date(new Date(s.periodEnd).getTime() - 1).toISOString());
        }
        const r = await fetchWithAuth(`/api/admin/ai-billing/events?${q.toString()}`);
        if (!r.ok) throw new Error("events");
        return [s, (await r.json()) as EventsResponse] as const;
      })
      .then(([s, e]) => {
        if (cancelled) return;
        setSummary(s);
        setEvents(e);
      })
      .catch(() => {
        if (cancelled) return;
        setSummary(null);
        setEvents(null);
        setError("Could not load AI usage data.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [filters, tzOffsetMinutes, fetchWithAuth, reloadKey]);

  const rangeLabel = filters.range === "today" ? "Today" : "This month";

  // Memoised so the trends section's fetch keys off the FILTER VALUES rather
  // than off object identity — an inline literal here would rebuild every render
  // and refetch the analytics on every keystroke elsewhere on the page.
  const trendScope = useMemo(
    () => ({
      mspId: filters.mspId,
      customerId: filters.customerId,
      costOwner: filters.costOwner,
      feature: filters.feature,
      generatedArtifactType: filters.generatedArtifactType,
    }),
    [filters],
  );

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background font-sans text-foreground">
      <header className="flex h-9 shrink-0 items-center gap-2.5 border-b border-border bg-card px-3 select-none">
        <span className="text-[11px] font-semibold tracking-wide text-foreground">AI Billing</span>
        <span className="rounded-sm border border-border bg-background px-1.5 py-px text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
          Platform admin
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-1 rounded-sm border border-border p-0.5">
          {(["today", "month"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setFilter({ range: r })}
              className={`px-2 py-0.5 text-[10px] uppercase tracking-wider rounded-sm transition-colors ${
                filters.range === r
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {r === "today" ? "Today" : "Month"}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          title="Refresh"
          className="flex items-center px-1.5 py-0.5 text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-3">
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {/* ── Summary cards ── */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
          <SummaryCard title={`Total spend — ${rangeLabel.toLowerCase()}`}>
            <p className="font-mono text-2xl tabular-nums text-foreground">
              {summary ? formatCents(summary.totalCostCents) : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {summary ? `${summary.eventCount} AI call${summary.eventCount === 1 ? "" : "s"}` : ""}
            </p>
          </SummaryCard>

          <SummaryCard title="By cost owner">
            <BreakdownList
              rows={(summary?.byCostOwner ?? []).map((b) => ({
                label: b.costOwner,
                costCents: b.costCents,
                eventCount: b.eventCount,
              }))}
            />
          </SummaryCard>

          <SummaryCard title="By MSP">
            <BreakdownList
              rows={(summary?.byMsp ?? []).slice(0, 6).map((b) => ({
                label: b.mspName,
                costCents: b.costCents,
                eventCount: b.eventCount,
                onClick: b.mspId != null ? () => setFilter({ mspId: String(b.mspId) }) : undefined,
              }))}
            />
          </SummaryCard>

          <SummaryCard title="By feature">
            <BreakdownList
              rows={(summary?.byFeature ?? []).slice(0, 6).map((b) => ({
                label: b.feature,
                costCents: b.costCents,
                eventCount: b.eventCount,
                onClick: () => setFilter({ feature: b.feature }),
              }))}
            />
          </SummaryCard>
        </div>

        {/* ── Filters ── */}
        <div className="rounded-md border border-border bg-card p-2.5">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-7">
            <FilterInput label="MSP ID" value={filters.mspId} onChange={(v) => setFilter({ mspId: v })} />
            <FilterInput label="Customer ID" value={filters.customerId} onChange={(v) => setFilter({ customerId: v })} />
            <FilterInput label="From" type="date" value={filters.from} onChange={(v) => setFilter({ from: v })} />
            <FilterInput label="To" type="date" value={filters.to} onChange={(v) => setFilter({ to: v })} />
            <FilterInput label="Node / feature" value={filters.feature} onChange={(v) => setFilter({ feature: v })} />
            <FilterSelect
              label="Cost owner"
              value={filters.costOwner}
              options={[
                { value: "", label: "Any" },
                { value: "msp", label: "MSP" },
                { value: "platform", label: "Platform" },
              ]}
              onChange={(v) => setFilter({ costOwner: v })}
            />
            <FilterInput
              label="Artifact type"
              value={filters.generatedArtifactType}
              onChange={(v) => setFilter({ generatedArtifactType: v })}
            />
          </div>
          {(filters.from || filters.to) && (
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              An explicit date range overrides the {rangeLabel.toLowerCase()} window above, so the
              table and the summary cards describe different periods.
            </p>
          )}
        </div>

        {/* ── Trends & anomalies (Phase 4 / #52) ──
            Owns its own bucket size and its own window, so it is not bound to
            the Today/Month toggle above — a trend needs more history than a
            single period. It DOES honour the filters, so narrowing to one MSP
            narrows the charts, the anomaly baseline and the ledger together. */}
        <AiCostTrends
          fetchWithAuth={fetchWithAuth}
          tzOffsetMinutes={tzOffsetMinutes}
          scope={trendScope}
          onFilter={setFilter}
          reloadKey={reloadKey}
        />

        {/* ── Event table ── */}
        <div className="rounded-md border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
            <span className="text-[11px] font-semibold text-foreground">Usage events</span>
            <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
              {events
                ? `${events.total} row${events.total === 1 ? "" : "s"} · ${formatCents(events.filteredCostCents)}`
                : loading
                  ? "Loading…"
                  : "—"}
            </span>
          </div>

          {events && events.events.length === 0 && !loading ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              No AI usage events match these filters.
            </p>
          ) : (
            <table className="w-full font-mono text-[11px]">
              <thead>
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="w-6" />
                  <th className="px-2 py-1 font-medium">When</th>
                  <th className="px-2 py-1 font-medium">MSP</th>
                  <th className="px-2 py-1 font-medium">Customer</th>
                  <th className="px-2 py-1 font-medium">Cause</th>
                  <th className="px-2 py-1 font-medium">Generated</th>
                  <th className="px-2 py-1 font-medium">Owner</th>
                  <th className="px-2 py-1 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {(events?.events ?? []).map((e) => (
                  <EventRow
                    key={e.id}
                    event={e}
                    expanded={expandedId === e.id}
                    onToggle={() => setExpandedId(expandedId === e.id ? null : e.id)}
                  />
                ))}
              </tbody>
            </table>
          )}

          {events && events.total > PAGE_SIZE && (
            <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
              <span className="tabular-nums">
                {events.offset + 1}–{Math.min(events.offset + PAGE_SIZE, events.total)} of {events.total}
              </span>
              <div className="flex gap-1">
                <button
                  type="button"
                  disabled={events.offset === 0}
                  onClick={() => setFilter({ offset: Math.max(0, events.offset - PAGE_SIZE) })}
                  className="rounded-sm border border-border px-2 py-0.5 disabled:opacity-40 hover:text-foreground"
                >
                  Prev
                </button>
                <button
                  type="button"
                  disabled={events.offset + PAGE_SIZE >= events.total}
                  onClick={() => setFilter({ offset: events.offset + PAGE_SIZE })}
                  className="rounded-sm border border-border px-2 py-0.5 disabled:opacity-40 hover:text-foreground"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Presentational pieces ───────────────────────────────────────────────────

function SummaryCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-card p-2.5">
      <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
  );
}

function BreakdownList({
  rows,
}: {
  rows: { label: string; costCents: number; eventCount: number; onClick?: () => void }[];
}) {
  if (rows.length === 0) {
    return <p className="font-mono text-[11px] text-muted-foreground">No spend in this period.</p>;
  }
  return (
    <ul className="space-y-0.5 font-mono text-[11px]">
      {rows.map((r) => (
        <li key={r.label} className="flex items-baseline gap-2">
          {r.onClick ? (
            <button
              type="button"
              onClick={r.onClick}
              className="flex-1 truncate text-left text-foreground hover:text-primary hover:underline"
              title={`Filter by ${r.label}`}
            >
              {r.label}
            </button>
          ) : (
            <span className="flex-1 truncate text-foreground">{r.label}</span>
          )}
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {formatCents(r.costCents)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function EventRow({
  event,
  expanded,
  onToggle,
}: {
  event: UsageEvent;
  expanded: boolean;
  onToggle: () => void;
}) {
  const cause = event.triggerSource ?? event.feature ?? event.nodeType ?? "—";
  const generated = event.generatedArtifactName ?? event.generatedArtifactType ?? "—";
  return (
    <>
      <tr className="border-b border-border/50 hover:bg-accent/40">
        <td className="px-1 align-top">
          <button
            type="button"
            onClick={onToggle}
            aria-label={expanded ? "Collapse row" : "Expand row"}
            className="p-1 text-muted-foreground hover:text-foreground"
          >
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        </td>
        <td className="px-2 py-1 align-top whitespace-nowrap text-muted-foreground">
          {formatTimestamp(event.occurredAt)}
        </td>
        <td className="px-2 py-1 align-top">{event.mspName ?? "Platform"}</td>
        <td className="px-2 py-1 align-top">{event.customerName ?? "—"}</td>
        <td className="px-2 py-1 align-top">{cause}</td>
        <td className="px-2 py-1 align-top">{generated}</td>
        <td className="px-2 py-1 align-top">{event.costOwner ?? "—"}</td>
        <td className="px-2 py-1 align-top text-right tabular-nums">{formatCents(event.costCents)}</td>
      </tr>
      {expanded && (
        <tr className="border-b border-border/50 bg-muted/30">
          <td />
          <td colSpan={7} className="px-2 py-2">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 lg:grid-cols-4">
              <Detail label="Node type" value={event.nodeType} />
              <Detail label="Feature" value={event.feature} />
              <Detail label="Trigger source" value={event.triggerSource} />
              <Detail label="Model" value={event.model} />
              <Detail label="Artifact type" value={event.generatedArtifactType} />
              <Detail label="Artifact name" value={event.generatedArtifactName} />
              <Detail label="Artifact id" value={event.generatedArtifactId} />
              <Detail label="MSP id" value={event.mspId != null ? String(event.mspId) : null} />
              <Detail
                label="Customer id"
                value={event.customerId != null ? String(event.customerId) : null}
              />
              <Detail
                label="Tokens (in / out / total)"
                value={
                  event.totalTokens != null || event.promptTokens != null
                    ? `${event.promptTokens ?? 0} / ${event.completionTokens ?? 0} / ${event.totalTokens ?? 0}`
                    : null
                }
              />
              <Detail label="Run id" value={event.runId} />
              <Detail label="Correlation id" value={event.correlationId} />
              <Detail label="Event id" value={event.eventId} />
            </dl>
          </td>
        </tr>
      )}
    </>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      {/* A missing value renders as an explicit dash — never as a guess or a
          blank that could read as "zero". */}
      <dd className="truncate text-[11px] text-foreground" title={value ?? undefined}>
        {value ?? "—"}
      </dd>
    </div>
  );
}

function FilterInput({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <input
        type={type}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        // Commit on blur/Enter rather than per keystroke — each commit rewrites
        // the URL and refetches, so per-keystroke would fire a request per
        // character typed.
        onBlur={() => { if (draft !== value) onChange(draft); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="h-6 rounded-sm border border-border bg-background px-1.5 font-mono text-[11px] text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
    </label>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 rounded-sm border border-border bg-background px-1 font-mono text-[11px] text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}
