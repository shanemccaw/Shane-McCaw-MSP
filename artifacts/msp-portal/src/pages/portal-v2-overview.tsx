/**
 * portal-v2-overview.tsx — the tenant health Overview for the isolated
 * Customer Portal v2 build.
 *
 * Every number on this page comes from
 * `GET /api/portal/assessment/war-room-pillars` via `usePortalV2Pillars`, which
 * wraps the existing `useWarRoomPillarStats` hook. Nothing is scored, ranked or
 * defaulted here that the engine did not already state.
 *
 * The Copilot Gate readout is the payload's own `copilot` card — the same
 * `computePillarDisplayScore` number the live surfaces use — measured against
 * `COPILOT_GATE_TARGET`, which is the single gate constant (mirrored
 * server-side in copilot-gate.ts, each side asserted by its own test).
 */

import { Link } from "wouter";
import { Loader2 } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import {
  COPILOT_GATE_TARGET,
  gateLabel,
  hexAlpha,
} from "@/components/copilot-journey/journeyTokens";

import { PortalV2Shell, PillarGlyph } from "@/components/portal-v2/PortalV2Shell";
import {
  Eyebrow,
  EmptyNote,
  Panel,
  PanelTitle,
  ScoreBlock,
  SeverityChip,
  TrendLine,
} from "@/components/portal-v2/PortalV2Pieces";
import { usePortalV2Pillars } from "@/components/portal-v2/usePortalV2Pillars";
import { evaluationNote } from "@/components/portal-v2/portalV2Model";

function GateBand({
  score,
  scanning,
}: {
  score: number | null;
  scanning: boolean;
}) {
  // A gate verdict on a score the engine never stated would be a fabricated
  // Go/No-Go. Say so instead.
  if (score === null) {
    return (
      <Panel className="p-6">
        <Eyebrow>Copilot gate</Eyebrow>
        <p
          className="mt-2 text-[15px] font-semibold"
          style={{ color: "var(--pv2-heading)" }}
          data-testid="pv2-gate-unavailable"
        >
          No gate score yet
        </p>
        <p className="mt-1.5 text-[12.5px]" style={{ color: "var(--pv2-muted)" }}>
          {scanning
            ? "A scan is running now. The gate resolves when it finishes."
            : "The Copilot pillar has not been evaluated for your tenant yet."}
        </p>
      </Panel>
    );
  }

  const cleared = score >= COPILOT_GATE_TARGET;
  const colour = cleared ? "#34d399" : "#fbbf24";

  return (
    <Panel className="p-6" accent={colour}>
      <Eyebrow>Copilot gate</Eyebrow>
      <div className="mt-2 flex items-baseline gap-2">
        <span
          className="pv2-num text-[34px] font-extrabold leading-none tracking-[-0.02em]"
          style={{ color: "var(--pv2-heading)" }}
          data-testid="pv2-gate-score"
        >
          {score}
        </span>
        <span
          className="pv2-num text-[15px] font-semibold"
          style={{ color: "var(--pv2-deemphasised)" }}
        >
          / {COPILOT_GATE_TARGET}
        </span>
      </div>
      <p
        className="mt-2 inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold"
        style={{
          background: hexAlpha(colour, 0.14),
          color: colour,
          border: `1px solid ${hexAlpha(colour, 0.4)}`,
        }}
        data-testid="pv2-gate-verdict"
      >
        {gateLabel(score)}
      </p>
    </Panel>
  );
}

export default function PortalV2OverviewPage() {
  const { view, loaded, scanning, everScanned } = usePortalV2Pillars();

  return (
    <PortalV2Shell eyebrow="Overview" title="Tenant health">
      {/* Page container — prototype line 274. The shell's <main> carries no
          padding of its own; each page owns its width and rhythm. */}
      <div
        style={{
          position: "relative",
          maxWidth: 1180,
          margin: "0 auto",
          padding: "28px 28px 110px",
          display: "flex",
          flexDirection: "column",
          gap: 22,
          minWidth: 0,
          boxSizing: "border-box",
        }}
      >
      {/* The Overview's own headline — prototype lines 277-281. The shell
          carries no title band, so each page renders its heading itself. */}
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <span
          style={{
            fontSize: "9.5px",
            fontWeight: 700,
            letterSpacing: ".2em",
            textTransform: "uppercase",
            color: "#00B4D8",
          }}
        >
          Tenant health · live
        </span>
        <h1
          style={{
            margin: 0,
            fontSize: "23px",
            fontWeight: 800,
            letterSpacing: "-.015em",
            color: "#f8fafc",
            lineHeight: 1.3,
          }}
          data-testid="pv2-page-title"
        >
          Tenant health
        </h1>
        <div
          style={{
            fontSize: "13px",
            color: "#94a3b8",
            lineHeight: 1.5,
            maxWidth: "74ch",
          }}
        >
          Your six pillars, the Copilot gate, and what needs a decision first.
        </div>
      </div>

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
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-[12px]" />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {/* ── Gate + scan provenance ─────────────────────────────────── */}
          <div className="grid gap-4 lg:grid-cols-3">
            <GateBand score={view.gate.score} scanning={scanning} />

            <Panel className="p-6 lg:col-span-2">
              <Eyebrow>Scan coverage</Eyebrow>
              {view.scannedCheckCount === null && view.scannedPackageKeys.length === 0 ? (
                <p
                  className="mt-2 text-[12.5px]"
                  style={{ color: "var(--pv2-muted)" }}
                  data-testid="pv2-coverage-none"
                >
                  {everScanned
                    ? "No scan package is recorded against this tenant yet."
                    : "This tenant has not been scanned yet."}
                </p>
              ) : (
                <>
                  <p className="mt-2 text-[12.5px]" style={{ color: "var(--pv2-body)" }}>
                    <span className="pv2-num font-semibold">{view.scannedCheckCount ?? 0}</span>{" "}
                    curated checks across{" "}
                    <span className="pv2-num font-semibold">
                      {view.scannedPackageKeys.length}
                    </span>{" "}
                    scan package{view.scannedPackageKeys.length === 1 ? "" : "s"}.
                  </p>
                  {view.scannedPackageKeys.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {view.scannedPackageKeys.map((k) => (
                        <span
                          key={k}
                          className="rounded-full px-2.5 py-1 font-mono text-[10.5px]"
                          style={{
                            background: "var(--pv2-raised)",
                            color: "var(--pv2-muted)",
                            border: "1px solid var(--pv2-hairline)",
                          }}
                        >
                          {k}
                        </span>
                      ))}
                    </div>
                  )}
                </>
              )}
              {view.generatedAt && (
                <p
                  className="pv2-num mt-4 font-mono text-[10.5px]"
                  style={{ color: "var(--pv2-deemphasised)" }}
                >
                  Computed {new Date(view.generatedAt).toLocaleString()}
                </p>
              )}
            </Panel>
          </div>

          {/* ── The six pillars ────────────────────────────────────────── */}
          <div>
            <div className="mb-3 flex items-baseline justify-between">
              <PanelTitle>Pillars</PanelTitle>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {view.pillars.map((p) => (
                <Link
                  key={p.key}
                  href={`/portal-v2/${p.key}`}
                  data-testid={`pv2-pillar-card-${p.key}`}
                  className="pv2-transition block"
                >
                  <Panel className="h-full p-5 hover:brightness-110" accent={p.primary}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className="flex size-6 items-center justify-center rounded-[6px]"
                            style={{ background: hexAlpha(p.primary, 0.16) }}
                          >
                            <PillarGlyph pillar={p.key} color={p.primary} size={14} />
                          </span>
                          <h3
                            className="text-[13.5px] font-bold tracking-tight"
                            style={{ color: "var(--pv2-heading)" }}
                          >
                            {p.label}
                          </h3>
                        </div>

                        {p.score !== null ? (
                          <div className="mt-3">
                            <SeverityChip score={p.score} />
                          </div>
                        ) : (
                          <p
                            className="mt-3 text-[11.5px] leading-snug"
                            style={{ color: "var(--pv2-micro)" }}
                            data-testid={`pv2-pillar-note-${p.key}`}
                          >
                            {evaluationNote(p.evaluation, scanning, p.evaluationReason)}
                          </p>
                        )}

                        <p
                          className="pv2-num mt-3 text-[11.5px]"
                          style={{ color: "var(--pv2-muted)" }}
                        >
                          <span style={{ color: "#f87171" }}>
                            {p.findingCounts.critical} critical
                          </span>
                          {" · "}
                          <span style={{ color: "#fbbf24" }}>
                            {p.findingCounts.warning} warning
                          </span>
                        </p>
                      </div>

                      <ScoreBlock
                        score={p.score}
                        size={72}
                        note={evaluationNote(p.evaluation, scanning, p.evaluationReason)}
                      />
                    </div>

                    {p.trend && p.trend.series.length >= 2 && (
                      <div className="mt-4 flex items-center gap-2">
                        <TrendLine series={p.trend.series} color={p.primary} width={140} height={30} />
                        <span
                          className="text-[10px]"
                          style={{ color: "var(--pv2-deemphasised)" }}
                        >
                          {p.trend.window}
                        </span>
                      </div>
                    )}
                  </Panel>
                </Link>
              ))}
            </div>
          </div>

          {/* ── Most urgent ────────────────────────────────────────────── */}
          <Panel>
            <div className="px-4 pb-2 pt-4">
              <PanelTitle>Most urgent</PanelTitle>
              <p className="mt-1 text-[11.5px]" style={{ color: "var(--pv2-micro)" }}>
                Ranked by the engine&rsquo;s own severity and signal weight.
              </p>
            </div>
            {view.urgent.length === 0 ? (
              <EmptyNote testId="pv2-urgent-empty">
                {everScanned
                  ? "No critical or warning findings across your pillars."
                  : "Nothing to rank until this tenant has been scanned."}
              </EmptyNote>
            ) : (
              <ul>
                {view.urgent.map((u) => (
                  <li key={`${u.checkKey}-${u.title}`}>
                    <Link
                      href={`/portal-v2/${u.pillar}`}
                      className="pv2-transition flex items-start gap-3 border-b px-4 py-3 last:border-b-0 hover:brightness-125"
                      style={{ borderColor: "var(--pv2-hairline)" }}
                      data-testid="pv2-urgent-row"
                    >
                      <span
                        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-[5px]"
                        style={{ background: hexAlpha(u.primary, 0.16) }}
                      >
                        <PillarGlyph pillar={u.pillar} color={u.primary} size={12} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p
                          className="text-[12.5px] leading-snug"
                          style={{ color: "var(--pv2-body)" }}
                        >
                          {u.title}
                        </p>
                        <p
                          className="pv2-num mt-0.5 font-mono text-[10px]"
                          style={{ color: "var(--pv2-deemphasised)" }}
                        >
                          {u.pillarLabel} · {u.checkKey}
                        </p>
                      </div>
                      <span
                        className="mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.1em]"
                        style={{
                          background: hexAlpha(
                            u.severity === "critical" ? "#f87171" : "#fbbf24",
                            0.14,
                          ),
                          color: u.severity === "critical" ? "#f87171" : "#fbbf24",
                        }}
                      >
                        {u.severity}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}
      </div>
    </PortalV2Shell>
  );
}
