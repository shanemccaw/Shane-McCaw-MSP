/**
 * Money screen body — the Money tab's centre content.
 *
 * Three views ("This month" / "The business" / "The ramp"), switched via
 * `moneyStore`'s `view` field (mirrors `crmStore`'s `CrmView` — see
 * `SHELL.md`'s "Contributing a contextual tab" note on why sub-views live
 * inside one screen rather than as separate docs: none of these are
 * openable records, they're a mode within the one Money screen).
 *
 * Every number rendered here comes straight from `admin-money.ts` — nothing
 * is computed client-side except formatting (`usd()`), so a wrong figure is
 * always a backend bug, not a display one.
 */

import { useSyncExternalStore, useState } from "react";
import { ACCENT, LINE, SURFACE, TEXT } from "../../theme";
import {
  getSnapshot,
  loadBusiness,
  loadRamp,
  loadSummary,
  refreshAll,
  saveRampTarget,
  setView,
  subscribe,
  type MoneyStoreState,
  type MoneyView,
} from "./moneyStore";
import { usd, type MoneyBenchmark } from "./moneyTypes";

const VIEWS: { key: MoneyView; label: string }[] = [
  { key: "month", label: "This month" },
  { key: "business", label: "The business" },
  { key: "ramp", label: "The ramp" },
];

export function MoneyBody() {
  const state = useSyncExternalStore(subscribe, getSnapshot);

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", background: SURFACE.app }}>
      <Header state={state} />
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "18px 20px 30px" }}>
        {state.view === "month" && <MonthView state={state} />}
        {state.view === "business" && <BusinessView state={state} />}
        {state.view === "ramp" && <RampView state={state} />}
      </div>
    </div>
  );
}

function Header({ state }: { state: MoneyStoreState }) {
  return (
    <div
      style={{
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: 9,
        flexWrap: "wrap",
        padding: "10px 16px",
        borderBottom: `1px solid ${LINE.base}`,
        background: SURFACE.chrome,
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-.01em", color: TEXT.primary }}>Money</span>
      {state.summary && (
        <span
          style={{
            padding: "1px 7px",
            borderRadius: 9,
            border: `1px solid ${LINE.strong}`,
            fontSize: 10.5,
            color: TEXT.dimmer,
          }}
        >
          {state.summary.month}
        </span>
      )}
      <div style={{ display: "flex", gap: 4, marginLeft: 6 }}>
        {VIEWS.map((v) => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            style={{
              padding: "5px 11px",
              borderRadius: 5,
              border: `1px solid ${state.view === v.key ? LINE.hover : "transparent"}`,
              background: state.view === v.key ? SURFACE.wellHover : "transparent",
              color: state.view === v.key ? TEXT.primary : TEXT.dim,
              fontFamily: "inherit",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {v.label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, minWidth: 4 }} />
      <button
        onClick={refreshAll}
        style={{
          padding: "6px 12px",
          borderRadius: 5,
          border: `1px solid ${LINE.strong}`,
          background: "transparent",
          color: TEXT.soft,
          fontFamily: "inherit",
          fontSize: 12,
          cursor: "pointer",
        }}
      >
        Refresh
      </button>
    </div>
  );
}

function EmptyOrError({ loading, error, onRetry }: { loading: boolean; error: string | null; onRetry: () => void }) {
  if (loading) return <div style={{ padding: 20, fontSize: 12.5, color: TEXT.meta }}>Loading real figures…</div>;
  if (error)
    return (
      <div style={{ padding: 20, fontSize: 12.5, color: ACCENT.danger }}>
        {error}{" "}
        <button
          onClick={onRetry}
          style={{ marginLeft: 8, background: "transparent", border: "none", color: ACCENT.info, cursor: "pointer", font: "inherit" }}
        >
          Retry
        </button>
      </div>
    );
  return null;
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ flex: "1 1 240px", minWidth: 0, padding: "15px 17px", borderRadius: 9, border: `1px solid ${LINE.base}`, background: SURFACE.card }}>
      {children}
    </div>
  );
}

function CardLabel({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: TEXT.caption }}>{children}</span>;
}

function SectionLabel({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: color ?? TEXT.caption }}>{children}</span>
  );
}

// ── This month ───────────────────────────────────────────────────────────────

function MonthView({ state }: { state: MoneyStoreState }) {
  if (!state.summary) return <EmptyOrError loading={state.summaryLoading} error={state.summaryError} onRetry={loadSummary} />;
  const s = state.summary;
  const profitPositive = s.profit.cents >= 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Hero */}
      <div
        style={{
          padding: "22px 24px",
          borderRadius: 12,
          background: `linear-gradient(135deg, rgba(108,203,150,.14), rgba(108,203,150,.03))`,
          border: `1px solid rgba(108,203,150,.28)`,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <SectionLabel color={ACCENT.greenSoft}>Profit this month</SectionLabel>
        <span style={{ fontSize: 44, fontWeight: 800, letterSpacing: "-.03em", lineHeight: 1, color: profitPositive ? ACCENT.greenSoft : ACCENT.danger }}>
          {usd(s.profit.cents)}
        </span>
        <div style={{ display: "flex", alignItems: "baseline", gap: 18, flexWrap: "wrap", marginTop: 2 }}>
          <span style={{ fontSize: 15, color: "#c6e6d3" }}>{usd(s.revenue.cents)} in</span>
          <span style={{ fontSize: 15, color: TEXT.dim }}>{usd(s.cost.cents)} out</span>
        </div>
        <span style={{ fontSize: 11.5, color: TEXT.meta, marginTop: 4 }}>{s.cost.note}</span>
      </div>

      {/* Goal / MRR / Streak */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <Card>
          <CardLabel>Sales this month</CardLabel>
          <div style={{ marginTop: 10, display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-.03em", lineHeight: 1, color: TEXT.primary }}>{s.sales.count}</span>
            <span style={{ fontSize: 15, color: TEXT.caption }}>of {s.sales.goal}</span>
          </div>
          <span style={{ display: "block", marginTop: 8, fontSize: 11.5, color: s.sales.count >= s.sales.goal ? ACCENT.greenSoft : TEXT.caption }}>
            {s.sales.count >= s.sales.goal ? "Goal met" : `${s.sales.goal - s.sales.count} more to goal`}
          </span>
        </Card>
        <Card>
          <CardLabel>Recurring revenue</CardLabel>
          <div style={{ marginTop: 10, display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-.025em", lineHeight: 1, color: TEXT.primary }}>{usd(s.mrr.cents)}</span>
            <span style={{ fontSize: 13, color: TEXT.caption }}>of {usd(s.mrr.goalCents)} target</span>
          </div>
          <div style={{ marginTop: 12, height: 8, borderRadius: 4, background: SURFACE.well, overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: `${Math.min(100, s.mrr.goalCents > 0 ? (s.mrr.cents / s.mrr.goalCents) * 100 : 0)}%`,
                background: ACCENT.greenBright,
              }}
            />
          </div>
          <span style={{ display: "block", marginTop: 8, fontSize: 11.5, color: TEXT.caption }}>{s.retainers.length} retainers</span>
        </Card>
        <Card>
          <CardLabel>Streak</CardLabel>
          <div style={{ marginTop: 10, display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-.025em", lineHeight: 1, color: ACCENT.amber }}>{s.streak}</span>
            <span style={{ fontSize: 13, color: TEXT.caption }}>months hitting goal</span>
          </div>
          <span style={{ display: "block", marginTop: 12, fontSize: 11, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: TEXT.caption }}>
            Lifetime
          </span>
          <span style={{ display: "block", marginTop: 5, fontSize: 22, fontWeight: 800, letterSpacing: "-.02em", color: ACCENT.greenSoft }}>
            {usd(s.lifetimeRevenue.cents)}
          </span>
        </Card>
      </div>

      {/* Money in */}
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <SectionLabel color={ACCENT.green}>Money in</SectionLabel>
        {s.sales.items.length === 0 && <span style={{ fontSize: 12.5, color: TEXT.meta }}>Nothing charged yet this month.</span>}
        {s.sales.items.map((sale) => (
          <div
            key={sale.id}
            style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "12px 15px", borderRadius: 8, border: `1px solid ${LINE.base}`, background: SURFACE.card }}
          >
            <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.025em", color: ACCENT.green }}>{usd(sale.amountCents)}</span>
            <div style={{ flex: "1 1 200px", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: TEXT.primary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sale.who}</span>
              <span style={{ fontSize: 11.5, color: TEXT.caption, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sale.what}</span>
            </div>
            <span style={{ fontSize: 11.5, color: TEXT.meta }}>{sale.when ? new Date(sale.when).toLocaleDateString() : ""}</span>
          </div>
        ))}
      </div>

      {/* Money out / retainers */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 300px", minWidth: 0, display: "flex", flexDirection: "column", gap: 9 }}>
          <SectionLabel color={ACCENT.red}>Money out</SectionLabel>
          {s.cost.byFeature.length === 0 && <span style={{ fontSize: 12.5, color: TEXT.meta }}>No AI usage cost this month.</span>}
          {s.cost.byFeature.map((c) => (
            <div key={c.label} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "9px 13px", borderRadius: 7, border: `1px solid ${LINE.base}`, background: SURFACE.card }}>
              <span style={{ flex: "1 1 130px", minWidth: 0, fontSize: 12.5, color: TEXT.body }}>{c.label}</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: ACCENT.red }}>{usd(c.cents)}</span>
            </div>
          ))}
        </div>
        <div style={{ flex: "1 1 260px", minWidth: 0, display: "flex", flexDirection: "column", gap: 9 }}>
          <SectionLabel>Retainers</SectionLabel>
          {s.retainers.length === 0 && <span style={{ fontSize: 12.5, color: TEXT.meta }}>No active retainers.</span>}
          {s.retainers.map((r) => (
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 7, border: `1px solid ${LINE.base}`, background: SURFACE.card }}>
              <span style={{ flex: "1 1 130px", minWidth: 0, fontSize: 12.5, color: TEXT.body, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.who}</span>
              <span style={{ flex: "0 1 auto", minWidth: 0, fontSize: 11.5, color: TEXT.meta, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.what}</span>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: ACCENT.greenSoft }}>{usd(r.monthlyCents)}/mo</span>
            </div>
          ))}
        </div>
      </div>

      {/* Trend */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <SectionLabel>Revenue, month by month</SectionLabel>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 110 }}>
          {(() => {
            const max = Math.max(1, ...s.trend.map((t) => t.cents));
            return s.trend.map((t) => (
              <div key={t.month} style={{ flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, height: "100%", justifyContent: "flex-end" }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: TEXT.quiet }}>{usd(t.cents)}</span>
                <div style={{ width: "100%", borderRadius: "4px 4px 0 0", background: ACCENT.greenBright, height: `${Math.max(4, (t.cents / max) * 78)}px` }} />
                <span style={{ fontSize: 11, color: TEXT.meta }}>{t.label}</span>
              </div>
            ));
          })()}
        </div>
      </div>
    </div>
  );
}

// ── The business ─────────────────────────────────────────────────────────────

function BusinessView({ state }: { state: MoneyStoreState }) {
  if (!state.business) {
    if (!state.businessLoading && !state.businessError) void loadBusiness();
    return <EmptyOrError loading={state.businessLoading} error={state.businessError} onRetry={loadBusiness} />;
  }
  const b = state.business;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <Card>
          <CardLabel>Recurring share of revenue</CardLabel>
          <span style={{ display: "block", marginTop: 8, fontSize: 28, fontWeight: 800, color: TEXT.primary }}>{b.recurringSharePct}%</span>
        </Card>
        <Card>
          <CardLabel>Margin after AI cost</CardLabel>
          <span style={{ display: "block", marginTop: 8, fontSize: 28, fontWeight: 800, color: TEXT.primary }}>{b.marginAfterAiCostPct}%</span>
        </Card>
        <Card>
          <CardLabel>Largest client's share</CardLabel>
          <span style={{ display: "block", marginTop: 8, fontSize: 28, fontWeight: 800, color: TEXT.primary }}>{b.clientConcentrationPct}%</span>
        </Card>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <SectionLabel>How you compare</SectionLabel>
        {b.benchmarks.map((bm) => (
          <BenchmarkRow key={bm.key} bm={bm} />
        ))}
        <span style={{ fontSize: 11.5, color: TEXT.meta, lineHeight: 1.5 }}>{b.benchmarkNote}</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <SectionLabel>Who pays you</SectionLabel>
        {b.clients.length === 0 && <span style={{ fontSize: 12.5, color: TEXT.meta }}>No active retainers.</span>}
        {b.clients.map((c) => (
          <div key={c.who} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px 13px", borderRadius: 7, border: `1px solid ${LINE.base}`, background: SURFACE.card }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: ACCENT.greenSoft }}>{usd(c.mrrCents)}</span>
            <span style={{ flex: "1 1 180px", minWidth: 0, fontSize: 12.5, color: TEXT.strong }}>{c.who}</span>
            <div style={{ flex: "1 1 90px", minWidth: 50, height: 7, borderRadius: 4, background: SURFACE.well, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${c.sharePct}%`, background: ACCENT.greenBright }} />
            </div>
            <span style={{ fontSize: 11.5, color: TEXT.meta }}>{c.sharePct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BenchmarkRow({ bm }: { bm: MoneyBenchmark }) {
  const meets = bm.verdict === "meets";
  return (
    <div style={{ padding: "11px 13px", borderRadius: 7, border: `1px solid ${LINE.base}`, background: SURFACE.card }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 11, flexWrap: "wrap" }}>
        <span style={{ fontSize: 19, fontWeight: 800, color: meets ? ACCENT.greenSoft : ACCENT.amber }}>{bm.actualPct}%</span>
        <span style={{ flex: "1 1 160px", minWidth: 0, fontSize: 12.5, color: TEXT.body }}>{bm.label}</span>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: meets ? ACCENT.greenSoft : ACCENT.amber }}>
          {meets ? "meets" : "below"}
        </span>
        <span style={{ fontSize: 11.5, color: TEXT.meta }}>
          {bm.direction === "atLeast" ? "target ≥" : "target ≤"} {bm.targetPct}%
        </span>
      </div>
    </div>
  );
}

// ── The ramp ──────────────────────────────────────────────────────────────────

function RampView({ state }: { state: MoneyStoreState }) {
  if (!state.ramp) {
    if (!state.rampLoading && !state.rampError) void loadRamp();
    return <EmptyOrError loading={state.rampLoading} error={state.rampError} onRetry={loadRamp} />;
  }
  const r = state.ramp;
  const maxWorth = Math.max(1, ...r.rows.map((row) => row.worthCents));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <Card>
          <CardLabel>Average real sale</CardLabel>
          <span style={{ display: "block", marginTop: 8, fontSize: 26, fontWeight: 800, color: TEXT.primary }}>{usd(r.avgSaleCents)}</span>
          <span style={{ display: "block", marginTop: 7, fontSize: 11.5, color: TEXT.meta }}>Trailing 90 days of real charges, falling back to all-time.</span>
        </Card>
        <Card>
          <CardLabel>Projected next 6 months</CardLabel>
          <span style={{ display: "block", marginTop: 8, fontSize: 26, fontWeight: 800, color: ACCENT.greenSoft }}>{usd(r.projectedYearCents)}</span>
          <span style={{ display: "block", marginTop: 7, fontSize: 11.5, color: TEXT.meta }}>Targets below × the average sale — a projection, not a promise.</span>
        </Card>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
          <SectionLabel>Month by month</SectionLabel>
          <span style={{ fontSize: 11.5, color: TEXT.faint }}>This month's target adjusts here and saves immediately.</span>
        </div>
        {r.rows.map((row) => (
          <RampRow key={row.month} row={row} saving={state.rampSaving} />
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <SectionLabel>Where it lands</SectionLabel>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 130, padding: "14px 16px", borderRadius: 9, border: `1px solid ${LINE.base}`, background: SURFACE.card }}>
          {r.rows.map((row) => (
            <div key={row.month} style={{ flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 5, height: "100%", justifyContent: "flex-end" }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: TEXT.quiet }}>{usd(row.worthCents)}</span>
              <div style={{ width: "100%", borderRadius: "4px 4px 0 0", background: ACCENT.amberDim, height: `${Math.max(4, (row.worthCents / maxWorth) * 90)}px` }} />
              <span style={{ fontSize: 10, color: TEXT.meta }}>{row.label.split(" ")[0]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RampRow({ row, saving }: { row: { month: string; label: string; target: number; actual: number | null; worthCents: number }; saving: boolean }) {
  const [pending, setPending] = useState<number | null>(null);
  const target = pending ?? row.target;

  function step(delta: number) {
    const next = Math.max(0, target + delta);
    setPending(next);
    void saveRampTarget(row.month, next).then(() => setPending(null));
  }

  return (
    <div style={{ padding: "12px 14px", borderRadius: 8, border: `1px solid ${LINE.base}`, background: SURFACE.card }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ flex: "1 1 130px", minWidth: 0, fontSize: 13, fontWeight: 600, color: TEXT.primary }}>{row.label}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            onClick={() => step(-1)}
            disabled={saving}
            style={{ width: 22, height: 22, borderRadius: 4, border: `1px solid ${LINE.control}`, background: "transparent", color: TEXT.soft, cursor: "pointer" }}
          >
            −
          </button>
          <span style={{ minWidth: 24, textAlign: "center", fontSize: 15, fontWeight: 700, color: TEXT.primary }}>{target}</span>
          <button
            onClick={() => step(1)}
            disabled={saving}
            style={{ width: 22, height: 22, borderRadius: 4, border: `1px solid ${LINE.control}`, background: "transparent", color: TEXT.soft, cursor: "pointer" }}
          >
            +
          </button>
        </div>
        <span style={{ fontSize: 11.5, color: TEXT.caption }}>{usd(row.worthCents)} projected</span>
        {row.actual !== null && (
          <span style={{ fontSize: 11.5, color: row.actual >= row.target ? ACCENT.greenSoft : TEXT.meta }}>{row.actual} so far</span>
        )}
      </div>
    </div>
  );
}
