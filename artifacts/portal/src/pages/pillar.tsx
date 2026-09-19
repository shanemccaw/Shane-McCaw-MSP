import { useParams } from "wouter";
import { Loader2 } from "lucide-react";
import {
  PILLARS,
  PILLAR_ICON_PATHS,
  PILLAR_KEYS,
  SEVERITY_ON_DARK,
  severityForScore,
  reportAccent,
  type PillarKey,
} from "@workspace/copilot-scan-scene/journeyTokens";
import { usePillarPage } from "@/components/pillar/usePillarPage";
import {
  blockedNote,
  statDisplay,
  trendDeltaLabel,
  COVERAGE_SEGMENT_DISPLAY,
} from "@/components/pillar/pillarDisplay";
import { PillarSkuLedger } from "@/components/pillar/PillarSkuLedger";
import NotFound from "./not-found";

const HAIRLINE = "rgba(255,255,255,.09)";
const CARD_BG = "rgba(255,255,255,.02)";
const GRN = "#34d399";
const RED = "#f87171";
const NEVER_SCANNED_INK = "#475569";
const FSEV: Record<"critical" | "warning", string> = { critical: RED, warning: "#fbbf24" };

/**
 * One of the six pillar landing pages (#1749, Feature #1621), reached from
 * the shell's `PillarTabStrip`. Adapted from
 * `Design/portal/design_handoff_full_site/screens/Pillar Pages.dc.html` per
 * that package's README ("recreate these designs... using this codebase's
 * existing... patterns, not ship the HTML files as-is") — the design's own
 * `renderVals()` numbers are the design tool's demo data, not a real
 * contract, so every number here comes from `GET /api/portal/pillars`
 * (`usePillarPage`) instead.
 *
 * Wired this pass: the pillar identity header, the real score + evaluation
 * state, the real trend delta, the real stat tiles (with honest per-stat
 * unavailable reasons — never a zero standing in for "not measured"), the
 * real ranked findings list, the real license-gap upgrade callout, and the
 * real "scanned with" honesty line.
 *
 * Git #4560 added, all from the same real payload: the design's trend
 * checkpoint dots, its OPEN FINDINGS severity chips, the tiles' real
 * sub-captions, and the "WHAT FEEDS THIS SCORE" coverage bar with its
 * legend, its blocked note and its licence-gated panel. Every count in
 * those comes from `card.coverage`, which is the tenant's own latest
 * observation of every check tagged to this pillar — not a second,
 * drifting client-side tally.
 *
 * Deliberately NOT wired here — scope carried from the dispatch, not an
 * oversight: the design's full per-check "block" breakdown (the `groups`
 * tables of dozens of individual checks with per-check tiers/history), the
 * CONFIG DRIFT BASELINE panel, the Licensing SKU ledger table, and the
 * click-a-finding-for-full-breakdown + SOP/Runbook remediation offer flow.
 * #1621's own body leaves "what is a block" and which of the four
 * remediation vehicles a finding offers as open architecture questions not
 * yet settled in chat — building either now would mean inventing an answer
 * to a question Shane hasn't decided, not a missing-backend gap. Those are
 * tracked as real, separate follow-ups filed under #1621.
 */

/** The design's 5-checkpoint trend strip (`trendDots` / `hTrendNote`). */
const TREND_CHECKPOINTS = 5;
export default function PillarPage() {
  const { pillar } = useParams<{ pillar: string }>();
  const { payload, loading, loaded, error } = usePillarPage();

  if (!PILLAR_KEYS.includes(pillar as PillarKey)) {
    return <NotFound />;
  }
  const key = pillar as PillarKey;
  const identity = PILLARS[key];
  const accent = reportAccent(key);
  const card = payload?.pillars.find((p) => p.pillar === key) ?? null;

  const showLoading = loading && !payload;
  const showError = error && !payload && loaded;
  const scanned = payload != null && payload.scannedPackageKeys.length > 0;
  const scoreSev = card?.score != null ? severityForScore(card.score) : null;
  const scoreInk = scoreSev ? SEVERITY_ON_DARK[scoreSev] : NEVER_SCANNED_INK;
  const trendLabel = card ? trendDeltaLabel(card.trend) : null;
  const findings = card?.findings ?? [];
  const upgrades = card?.licenseGapUpgrades ?? [];
  const coverage = card?.coverage ?? null;

  // The design's trend strip: one filled dot per REAL checkpoint the trend
  // series actually carries, capped at the five the strip has room for. A
  // tenant with fewer real scores gets fewer filled dots — never a full strip
  // implying history that doesn't exist.
  const trendPoints = Math.min(card?.trend?.series.length ?? 0, TREND_CHECKPOINTS);

  // OPEN FINDINGS chips, from the real per-severity counts.
  const findingChips: { text: string; ink: string; border: string }[] = [];
  if (card && scanned) {
    if (card.findingCounts.critical) {
      findingChips.push({ text: `${card.findingCounts.critical} critical`, ink: RED, border: "rgba(248,113,113,.35)" });
    }
    if (card.findingCounts.warning) {
      findingChips.push({ text: `${card.findingCounts.warning} warning`, ink: "#fbbf24", border: "rgba(251,191,36,.35)" });
    }
    if (findingChips.length === 0) {
      findingChips.push({ text: "none open", ink: GRN, border: "rgba(52,211,153,.30)" });
    }
  } else {
    findingChips.push({ text: "nothing measured yet", ink: NEVER_SCANNED_INK, border: "rgba(148,163,184,.25)" });
  }

  const coverageBlockedNote = coverage ? blockedNote(coverage) : null;

  const stateLine = showLoading
    ? "Reading your pillar data"
    : showError
      ? "Couldn't load — showing what we have"
      : !scanned
        ? "Never scanned — wired, waiting on the first scan"
        : "Live";
  const stateDot = showError ? RED : showLoading ? NEVER_SCANNED_INK : GRN;

  return (
    <div
      className="relative flex min-w-0 flex-1 flex-col gap-4 px-[26px] py-5"
      style={{ color: "#cbd5e1" }}
      data-testid={`pillar-page-${key}`}
      data-pillar-source={showLoading ? "loading" : showError ? "error" : scanned ? "live" : "never-scanned"}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[360px]"
        style={{ background: accent.glow }}
      />

      {/* Header */}
      <div className="relative flex flex-wrap items-center gap-3">
        <svg
          width={22}
          height={22}
          viewBox="0 0 24 24"
          fill="none"
          stroke={identity.primary}
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={PILLAR_ICON_PATHS[key]} />
        </svg>
        <span className="text-[20px] font-bold text-[#f8fafc]" style={{ letterSpacing: "-.01em" }}>
          {identity.label}
        </span>
        <div
          className="ml-auto flex items-center gap-[6px] text-[11px]"
          style={{ color: showError ? RED : "#64748b" }}
          data-testid="pillar-state-line"
        >
          <span className="size-[6px] rounded-full" style={{ background: stateDot }} />
          {stateLine}
          {payload?.activeRunId ? " · scan in progress" : ""}
        </div>
      </div>

      {showLoading ? (
        <div className="flex flex-1 items-center justify-center py-24">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Score hero */}
          <div
            className="relative flex flex-wrap items-center gap-6 rounded-[14px] p-5"
            style={{ border: `1px solid ${HAIRLINE}`, background: CARD_BG }}
            data-testid="pillar-score-hero"
          >
            <div className="flex flex-col items-center">
              <span
                className="text-[42px] font-extrabold"
                style={{ color: scoreInk, fontVariantNumeric: "tabular-nums" }}
                data-testid="pillar-score-value"
              >
                {card?.score ?? "—"}
              </span>
              <span className="text-[10.5px] font-semibold uppercase tracking-wide text-[#64748b]">/ 100</span>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {trendLabel ? (
                <span className="text-[12px] font-semibold" style={{ color: "#00B4D8" }}>
                  {trendLabel}
                </span>
              ) : null}
              <span className="text-[12.5px] text-[#94a3b8]" data-testid="pillar-evaluation-reason">
                {card
                  ? card.evaluation.status === "scored"
                    ? `Scored from ${card.evaluation.evaluableSignalCount} evaluable ${identity.label.toLowerCase()} signals · minimum ${card.evaluation.minRequiredSignals} required`
                    : card.evaluation.reason
                  : "Nothing measured yet"}
              </span>
              {!scanned ? (
                <span className="text-[11.5px] text-[#64748b]">
                  This tenant hasn't been scanned yet — every number below establishes on the first scan.
                </span>
              ) : (
                <span className="text-[11.5px] text-[#64748b]">
                  Scanned with {payload!.scannedPackageKeys.join(", ")} · {payload!.scannedCheckCount} checks in
                  the catalog
                </span>
              )}
            </div>

            {/* Trend checkpoints + open findings — the design's header strip */}
            <div className="flex flex-col items-start gap-2 sm:items-end" data-testid="pillar-header-strip">
              <div className="flex items-center gap-[5px]" data-testid="pillar-trend-dots">
                {Array.from({ length: TREND_CHECKPOINTS }, (_, i) => (
                  <span
                    key={i}
                    className="size-[7px] rounded-full"
                    style={{
                      background: i < trendPoints ? "#00B4D8" : "transparent",
                      border: `1px solid ${i < trendPoints ? "rgba(0,180,216,.6)" : "rgba(148,163,184,.35)"}`,
                    }}
                  />
                ))}
              </div>
              <span className="text-[10.5px] text-[#64748b]">
                appears after {TREND_CHECKPOINTS} checkpoints — {trendPoints} so far
              </span>
              <div className="flex flex-wrap items-center gap-1.5" data-testid="pillar-finding-chips">
                <span className="text-[9.5px] font-bold uppercase tracking-wide text-[#64748b]">Open findings</span>
                {findingChips.map((chip) => (
                  <span
                    key={chip.text}
                    className="rounded-full px-2 py-[2px] text-[10.5px] font-semibold"
                    style={{ color: chip.ink, border: `1px solid ${chip.border}` }}
                  >
                    {chip.text}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Stat tiles */}
          {card && card.stats.length > 0 ? (
            <div
              className="grid gap-px overflow-hidden rounded-[12px]"
              style={{ gridTemplateColumns: `repeat(${Math.min(card.stats.length, 4)}, minmax(0, 1fr))`, background: HAIRLINE }}
              data-testid="pillar-stat-tiles"
            >
              {card.stats.map((stat) => {
                const display = statDisplay(stat);
                return (
                  <div key={stat.id} className="flex flex-col gap-1 p-4" style={{ background: "#020617" }}>
                    <span className="text-[9.5px] font-bold uppercase tracking-wide text-[#64748b]">
                      {stat.label}
                    </span>
                    <span
                      className="text-[22px] font-extrabold"
                      style={{ color: display.unavailable ? NEVER_SCANNED_INK : "#f8fafc", fontVariantNumeric: "tabular-nums" }}
                    >
                      {display.big}
                    </span>
                    {display.sub ? <span className="text-[11px] text-[#64748b]">{display.sub}</span> : null}
                  </div>
                );
              })}
            </div>
          ) : null}

          {/* What feeds this score — real coverage of this pillar's checks */}
          {coverage && coverage.total > 0 ? (
            <div
              className="flex flex-col gap-3 rounded-[14px] p-4"
              style={{ border: `1px solid ${HAIRLINE}`, background: CARD_BG }}
              data-testid="pillar-coverage"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-[13px] font-bold text-[#f8fafc]">What feeds this score</span>
                <span className="text-[11px] text-[#64748b]" data-testid="pillar-coverage-line">
                  {coverage.total} checks in the catalog are tagged {identity.label.toLowerCase()}
                  {card?.evaluation.status === "scored"
                    ? ` · ${card.evaluation.evaluableSignalCount} produced an evaluable signal`
                    : ""}
                </span>
              </div>

              <div className="flex h-[8px] overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,.04)" }}>
                {coverage.segments.map((segment) => (
                  <div
                    key={segment.kind}
                    style={{
                      width: `${((segment.count / coverage.total) * 100).toFixed(1)}%`,
                      background: COVERAGE_SEGMENT_DISPLAY[segment.kind].color,
                    }}
                    data-testid={`pillar-coverage-segment-${segment.kind}`}
                  />
                ))}
              </div>

              <div className="flex flex-col gap-1">
                {coverage.segments.map((segment) => (
                  <div key={segment.kind} className="flex items-center gap-2 text-[11.5px]">
                    <span
                      className="size-[8px] flex-none rounded-[2px]"
                      style={{ background: COVERAGE_SEGMENT_DISPLAY[segment.kind].color }}
                    />
                    <span className="font-semibold tabular-nums text-[#e2e8f0]">{segment.count}</span>
                    <span className="text-[#94a3b8]">{COVERAGE_SEGMENT_DISPLAY[segment.kind].label}</span>
                  </div>
                ))}
              </div>

              {coverageBlockedNote ? (
                <span className="text-[11.5px] text-[#94a3b8]" data-testid="pillar-coverage-blocked-note">
                  {coverageBlockedNote}
                </span>
              ) : null}

              {coverage.licenseGapFeatures.length > 0 ? (
                <div
                  className="flex flex-col gap-1.5 rounded-[10px] p-3"
                  style={{ border: `1px solid ${HAIRLINE}` }}
                  data-testid="pillar-licence-gated"
                >
                  <span className="text-[9.5px] font-bold uppercase tracking-wide text-[#64748b]">
                    Licence-gated — honest, not broken
                  </span>
                  {coverage.licenseGapFeatures.map((gap) => (
                    <span key={gap.feature} className="text-[11.5px] text-[#94a3b8]">
                      <span className="font-semibold text-[#e2e8f0]">{gap.feature}</span> —{" "}
                      {gap.checkCount} check{gap.checkCount === 1 ? "" : "s"} your SKUs can't feed
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Findings */}
          <div
            className="flex flex-col gap-3 rounded-[14px] p-4"
            style={{ border: `1px solid ${HAIRLINE}`, background: CARD_BG }}
            data-testid="pillar-findings"
          >
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-bold text-[#f8fafc]">Findings</span>
              {card ? (
                <span className="text-[11px] text-[#64748b]">
                  {card.findingCounts.critical === 0 && card.findingCounts.warning === 0
                    ? "none open"
                    : [
                        card.findingCounts.critical ? `${card.findingCounts.critical} critical` : null,
                        card.findingCounts.warning ? `${card.findingCounts.warning} warning` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                </span>
              ) : null}
            </div>
            {findings.length === 0 ? (
              <span className="text-[12px] text-[#64748b]">
                {scanned ? "No open findings for this pillar." : "Nothing measured yet."}
              </span>
            ) : (
              findings.map((finding) => (
                <div
                  key={finding.checkKey}
                  className="flex flex-col gap-1 rounded-[10px] p-3"
                  style={{ border: `1px solid ${HAIRLINE}` }}
                  data-testid={`pillar-finding-${finding.checkKey}`}
                >
                  <div className="flex items-start gap-2">
                    <span
                      className="mt-[5px] size-[7px] flex-none rounded-full"
                      style={{ background: FSEV[finding.severity] }}
                    />
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[12.5px] font-semibold text-[#e2e8f0]">{finding.title}</span>
                      {finding.whyItMatters ? (
                        <span className="text-[11.5px] text-[#94a3b8]">{finding.whyItMatters}</span>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Licence gap upgrades */}
          {upgrades.length > 0 ? (
            <div
              className="flex flex-col gap-2 rounded-[14px] p-4"
              style={{ border: `1px solid ${HAIRLINE}`, background: CARD_BG }}
              data-testid="pillar-license-gaps"
            >
              <span className="text-[13px] font-bold text-[#f8fafc]">Licence gaps</span>
              {upgrades.map((u) => (
                <a
                  key={u.skuKey}
                  href={u.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[12px] text-[#60a5fa] hover:underline"
                >
                  {u.checkKeys.length} check{u.checkKeys.length === 1 ? "" : "s"} gated behind {u.skuName}
                </a>
              ))}
            </div>
          ) : null}

          {/* Licensing SKU ledger — Licensing pillar only, once a scan has run (Git #4578) */}
          {key === "licensing" && scanned ? <PillarSkuLedger ledger={payload?.licenseSkuLedger ?? null} /> : null}
        </>
      )}
    </div>
  );
}
