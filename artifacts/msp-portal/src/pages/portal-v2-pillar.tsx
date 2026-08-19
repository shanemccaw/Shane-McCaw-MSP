/**
 * portal-v2-pillar.tsx — one of the six pillar dashboards in the isolated
 * Customer Portal v2 build.
 *
 * One page serves all six; the pillar comes from the `:pillar` route param and
 * is validated against `PILLAR_KEYS` (journeyTokens) before anything renders,
 * so an unknown key is a 404 rather than an empty shell.
 *
 * Data is `GET /api/portal/assessment/war-room-pillars` via
 * `usePortalV2Pillars`. Score, findings, stat callouts and trend are all the
 * engine's own; this page ranks and formats, it does not compute.
 */

import { Link, useParams } from "wouter";
import { ArrowLeft, Loader2 } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import NotFound from "@/pages/not-found";
import { hexAlpha } from "@/components/copilot-journey/journeyTokens";

import { PortalV2Shell, PillarGlyph } from "@/components/portal-v2/PortalV2Shell";
import {
  Eyebrow,
  EmptyNote,
  FindingRow,
  Panel,
  PanelTitle,
  ScoreBlock,
  SeverityChip,
  StatCallout,
  TrendLine,
} from "@/components/portal-v2/PortalV2Pieces";
import { usePortalV2Pillars } from "@/components/portal-v2/usePortalV2Pillars";
import { evaluationNote, isPillarKey } from "@/components/portal-v2/portalV2Model";

export default function PortalV2PillarPage() {
  const params = useParams<{ pillar?: string }>();
  const { view, loaded, scanning, everScanned } = usePortalV2Pillars();

  // Validate before rendering any chrome — an unknown pillar is genuinely not a
  // page, not a pillar page with nothing in it.
  if (!isPillarKey(params.pillar)) return <NotFound />;

  const pillar = view.pillars.find((p) => p.key === params.pillar)!;
  const note = evaluationNote(pillar.evaluation, scanning, pillar.evaluationReason);

  return (
    <PortalV2Shell eyebrow="Pillar" title={pillar.label}>
      {/* Page container — the shell's <main> carries no padding; each page owns
          its width and rhythm, as the prototype does (line 274 / 393). */}
      <div
        style={{
          position: "relative",
          maxWidth: 1180,
          margin: "0 auto",
          padding: "28px 28px 56px",
          display: "flex",
          flexDirection: "column",
          gap: 22,
          minWidth: 0,
          boxSizing: "border-box",
        }}
      >
      <Link
        href="/portal-v2"
        className="pv2-transition mb-5 inline-flex items-center gap-1.5 text-[11.5px] font-medium"
        style={{ color: "var(--pv2-muted)" }}
        data-testid="pv2-back"
      >
        <ArrowLeft className="size-3.5" />
        Tenant health
      </Link>

      {scanning && (
        <div
          className="mb-5 flex items-center gap-2.5 rounded-[10px] border px-4 py-3 text-[12.5px]"
          style={{
            borderColor: hexAlpha("#60a5fa", 0.4),
            background: hexAlpha("#60a5fa", 0.1),
            color: "#93c5fd",
          }}
          data-testid="pv2-scanning-banner"
        >
          <Loader2 className="size-4 animate-spin" />
          A scan is running now. These numbers update when it finishes.
        </div>
      )}

      {!loaded ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-44 rounded-[12px]" />
          <Skeleton className="h-64 rounded-[12px]" />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {/* ── Hero: identity + score ─────────────────────────────────── */}
          <Panel className="p-6" accent={pillar.primary}>
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2.5">
                  <span
                    className="flex size-8 items-center justify-center rounded-[8px]"
                    style={{ background: hexAlpha(pillar.primary, 0.16) }}
                  >
                    <PillarGlyph pillar={pillar.key} color={pillar.primary} size={18} />
                  </span>
                  <h2
                    className="text-[21px] font-extrabold tracking-[-0.02em]"
                    style={{ color: "var(--pv2-heading)" }}
                    data-testid="pv2-pillar-heading"
                  >
                    {pillar.label}
                  </h2>
                </div>

                {pillar.score !== null ? (
                  <div className="mt-3 flex items-center gap-3">
                    <SeverityChip score={pillar.score} />
                    <span
                      className="pv2-num text-[12px]"
                      style={{ color: "var(--pv2-muted)" }}
                    >
                      <span style={{ color: "#f87171" }}>
                        {pillar.findingCounts.critical} critical
                      </span>
                      {" · "}
                      <span style={{ color: "#fbbf24" }}>
                        {pillar.findingCounts.warning} warning
                      </span>
                    </span>
                  </div>
                ) : (
                  <p
                    className="mt-3 max-w-xl text-[12.5px] leading-relaxed"
                    style={{ color: "var(--pv2-muted)" }}
                    data-testid="pv2-pillar-evaluation-note"
                  >
                    {note}
                  </p>
                )}

                {pillar.trend && pillar.trend.series.length >= 2 && (
                  <div className="mt-5">
                    <Eyebrow>Trend</Eyebrow>
                    <div className="mt-1.5 flex items-center gap-2.5">
                      <TrendLine
                        series={pillar.trend.series}
                        color={pillar.primary}
                        width={200}
                        height={40}
                      />
                      <span
                        className="text-[10.5px]"
                        style={{ color: "var(--pv2-deemphasised)" }}
                      >
                        {pillar.trend.window}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <ScoreBlock score={pillar.score} size={104} note={note} />
            </div>
          </Panel>

          {/* ── Stat callouts ──────────────────────────────────────────── */}
          <div>
            <div className="mb-3">
              <PanelTitle>What the scan measured</PanelTitle>
              <p className="mt-1 text-[11.5px]" style={{ color: "var(--pv2-micro)" }}>
                Every figure is a real value from your tenant&rsquo;s own scan, or a
                stated reason it could not be measured.
              </p>
            </div>

            {pillar.stats.length === 0 ? (
              <Panel>
                <EmptyNote testId="pv2-stats-empty">
                  {everScanned
                    ? "No stat callouts are defined for this pillar."
                    : "Nothing measured yet — this tenant has not been scanned."}
                </EmptyNote>
              </Panel>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {pillar.stats.map((s) => (
                  <StatCallout key={s.id} stat={s} />
                ))}
              </div>
            )}

            {/* Our own wiring faults are withheld from the grid rather than
                printed as though they were a gap in the customer's tenant —
                but the count is stated, so nothing is silently dropped. */}
            {pillar.withheldStatCount > 0 && (
              <p
                className="mt-2.5 text-[10.5px]"
                style={{ color: "var(--pv2-deemphasised)" }}
                data-testid="pv2-stats-withheld"
              >
                {pillar.withheldStatCount} further callout
                {pillar.withheldStatCount === 1 ? " is" : "s are"} not shown: the
                platform has no check wired for{" "}
                {pillar.withheldStatCount === 1 ? "it" : "them"} yet. That is ours
                to fix, not a gap in your tenant.
              </p>
            )}
          </div>

          {/* ── Findings ───────────────────────────────────────────────── */}
          <Panel>
            <div className="px-4 pb-2 pt-4">
              <PanelTitle>Findings</PanelTitle>
              <p className="mt-1 text-[11.5px]" style={{ color: "var(--pv2-micro)" }}>
                Worst first, ranked by the engine&rsquo;s own signal weight for this
                pillar.
              </p>
            </div>
            {pillar.findings.length === 0 ? (
              <EmptyNote testId="pv2-findings-empty">
                {everScanned
                  ? "No critical or warning findings for this pillar."
                  : "Nothing to report until this tenant has been scanned."}
              </EmptyNote>
            ) : (
              <ul data-testid="pv2-findings-list">
                {pillar.findings.map((f) => (
                  <FindingRow
                    key={`${f.checkKey}-${f.title}`}
                    finding={f}
                    pillarColor={pillar.primary}
                  />
                ))}
              </ul>
            )}
          </Panel>

          {/* ── Licence gaps ───────────────────────────────────────────── */}
          {pillar.upgrades.length > 0 && (
            <Panel className="p-5">
              <PanelTitle>Licence gaps</PanelTitle>
              <p className="mt-1 text-[11.5px]" style={{ color: "var(--pv2-micro)" }}>
                Checks this pillar could not run because your tenant&rsquo;s licence
                tier does not include them.
              </p>
              <ul className="mt-3 flex flex-col gap-2">
                {pillar.upgrades.map((u) => (
                  <li
                    key={u.skuKey}
                    className="rounded-[8px] border px-3.5 py-2.5"
                    style={{
                      borderColor: "var(--pv2-hairline)",
                      background: "var(--pv2-raised)",
                    }}
                    data-testid="pv2-upgrade-row"
                  >
                    <a
                      href={u.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[12.5px] font-semibold"
                      style={{ color: "#60a5fa" }}
                    >
                      {u.skuName}
                    </a>
                    <p
                      className="pv2-num mt-1 font-mono text-[10px]"
                      style={{ color: "var(--pv2-deemphasised)" }}
                    >
                      {u.checkKeys.join(" · ")}
                    </p>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {/* ── Provenance ─────────────────────────────────────────────── */}
          <p
            className="pv2-num font-mono text-[10.5px]"
            style={{ color: "var(--pv2-deemphasised)" }}
            data-testid="pv2-provenance"
          >
            {view.findingsRunId
              ? `Findings from run ${view.findingsRunId} (${view.findingsRunStatus ?? "unknown"})`
              : "No completed run backing these findings yet"}
            {view.generatedAt && ` · computed ${new Date(view.generatedAt).toLocaleString()}`}
          </p>
        </div>
      )}
      </div>
    </PortalV2Shell>
  );
}
