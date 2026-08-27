/**
 * portal-v2-retainer.tsx — My Architect (the retainer page).
 *
 * Built from `Customer Portal Shell.dc.html` — markup 1981-2196, logic class
 * 15852-15984. A NEW page in this build: the retainer had 19% of its design
 * copy present (all of it built in the logic class, invisible to the page)
 * and no route at all before this.
 *
 * ── What this page argues ──────────────────────────────────────────────────
 * Eight retained hours a month, shown as a working log rather than a summary
 * written after the fact. Two zoom levels sit on one page: the month rollup at
 * the top (hours used, findings closed, what is next) and a week you select in
 * place below it, which swaps the report card without moving the month.
 *
 * ── Live vs fixture (#1285/#1293) ─────────────────────────────────────────
 * The month bucket (retained/rolled/used) and the "Where the hours went" work
 * log now read real data via `useRetainerLive`, off `GET /api/portal/retainer`
 * — the AdminV2 Retainer Hours module (#1293) is the real source Shane logs
 * against. `dataState` overlays live data only once the customer has an
 * active retainer row (`configured`); an un-enrolled customer sees the design
 * fixture rather than a manufactured zero, same honest-fixture boundary
 * `useLivePillarHero.ts` documents. A hidden `pv2-ret-source` marker states
 * which is on screen. The weekly report card (summary, per-line work log,
 * deliverables, asks) has no backend source and stays on `retainerData.ts`'s
 * fixture, as do RET_OUTCOMES / RET_TERMS / RET_DOCS / RET_COPY. The week
 * selector is real local state; the ask box and the document/PDF buttons are
 * visual, to be wired in a later pass. Copy is FINAL and reproduced verbatim.
 */

import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";

import { PortalV2Shell, SIDEBAR_WASH } from "@/components/portal-v2/PortalV2Shell";
import {
  RET_COPY,
  RET_DOCS,
  RET_OUTCOMES,
  RET_TERMS,
  RET_WEEKS,
  RET_WORK,
} from "@/components/portal-v2/retainerData";
import {
  buildWeekView,
  computeRetSummary,
  hoursChip,
  outcomeToneColor,
  pillarTextColor,
  retSummary as fixtureRetSummary,
  workStateColor,
} from "@/components/portal-v2/retainerModel";
import { useRetainerLive } from "@/components/portal-v2/useRetainerLive";
import { PV2_SOURCE_CLIP } from "@/components/portal-v2/useLivePillarHero";
import { PortalV2LoadingState } from "@/components/portal-v2/PortalV2LoadingState";

const MONO = "'SF Mono',Menlo,Consolas,monospace";

function Eyebrow({ colour, children, spacing = ".18em" }: { colour: string; children: React.ReactNode; spacing?: string }) {
  return (
    <span
      style={{
        fontSize: "9.5px",
        fontWeight: 700,
        letterSpacing: spacing,
        textTransform: "uppercase",
        color: colour,
      }}
    >
      {children}
    </span>
  );
}

/** The month rollup's three cards — the "time this period" one spans two. */
function TimeCard({ retSummary, retainedLabel }: { retSummary: ReturnType<typeof computeRetSummary>; retainedLabel: string }) {
  return (
    <div
      data-testid="pv2-ret-time-card"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 9,
        padding: "15px 16px",
        border: "1px solid rgba(0,120,212,.28)",
        borderRadius: 11,
        background: "linear-gradient(160deg, rgba(0,120,212,.08), rgba(15,23,42,.45))",
        gridColumn: "span 2",
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <Eyebrow colour="#60a5fa" spacing=".14em">
          {RET_COPY.timeLabel}
        </Eyebrow>
        <span style={{ fontSize: "10.5px", color: "#64748b" }}>{RET_COPY.timeMeta}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: "30px", fontWeight: 800, color: "#f8fafc", letterSpacing: "-.03em", lineHeight: 1, fontFamily: MONO }}>
          {retSummary.used}
        </span>
        <span style={{ fontSize: "13px", fontWeight: 700, color: "#94a3b8" }}>of {retSummary.available} hours used</span>
        <span style={{ fontSize: "11px", color: "#64748b", fontFamily: MONO }}>{retSummary.usedPctLabel}</span>
      </div>
      <div style={{ height: 10, borderRadius: 5, background: "rgba(148,163,184,.14)", overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            borderRadius: 5,
            width: `${retSummary.usedPct}%`,
            background: "linear-gradient(90deg, #0078D4, #00B4D8)",
          }}
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: "8px 16px", paddingTop: 2 }}>
        <MicroStat label="Retained monthly" value={retainedLabel} />
        <MicroStat label="Rolled from July" value={`${retSummary.rolled} hours · ${RET_COPY.rolledExpiry}`} />
        <MicroStat label="Remaining" value={`${retSummary.remaining} hours, ${RET_COPY.remainingTail}`} />
      </div>
      <span style={{ fontSize: "10.5px", color: "#94a3b8", lineHeight: 1.5, textWrap: "pretty" }}>{RET_COPY.timeNote}</span>
    </div>
  );
}

function MicroStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: "#64748b" }}>
        {label}
      </span>
      <span style={{ fontSize: "11.5px", color: "#e2e8f0" }}>{value}</span>
    </div>
  );
}

function SmallCard({ label, value, sub, valueSize = "14px" }: { label: string; value: string; sub: string; valueSize?: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "14px 15px",
        border: "1px solid rgba(30,41,59,.9)",
        borderRadius: 11,
        background: "rgba(15,23,42,.4)",
      }}
    >
      <Eyebrow colour="#64748b" spacing=".11em">
        {label}
      </Eyebrow>
      <span
        style={{
          fontSize: valueSize,
          fontWeight: 800,
          color: "#f8fafc",
          letterSpacing: "-.01em",
          lineHeight: 1.35,
          fontFamily: valueSize === "20px" ? MONO : undefined,
        }}
      >
        {value}
      </span>
      <span style={{ fontSize: "10.5px", color: "#64748b", lineHeight: 1.45 }}>{sub}</span>
    </div>
  );
}

/** One row in the "Where the hours went" table. */
function WorkRow({ work }: { work: (typeof RET_WORK)[number] }) {
  const chipColour = pillarTextColor(work.color);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0,1.9fr) minmax(130px,.8fr) 58px minmax(84px,.5fr)",
        gap: 12,
        padding: "12px 16px",
        borderBottom: "1px solid rgba(30,41,59,.8)",
        alignItems: "start",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
        <span style={{ fontSize: "12px", fontWeight: 700, color: "#e2e8f0", lineHeight: 1.4, textWrap: "pretty" }}>{work.item}</span>
        <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.5, textWrap: "pretty" }}>{work.outcome}</span>
        <span style={{ fontSize: "10px", color: "#475569", fontFamily: MONO }}>{work.week}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
        <span
          style={{
            flex: "0 0 auto",
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "2px 8px",
            borderRadius: 4,
            border: `1px solid ${work.color}44`,
            background: `${work.color}12`,
            fontSize: "9px",
            fontWeight: 700,
            letterSpacing: ".06em",
            textTransform: "uppercase",
            color: chipColour,
            whiteSpace: "nowrap",
            width: "fit-content",
          }}
        >
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: work.color, flex: "0 0 5px" }} />
          {work.pillar}
        </span>
        <span style={{ fontSize: "10.5px", color: "#64748b", fontFamily: MONO }}>{work.finding}</span>
      </div>
      <span style={{ fontSize: "12.5px", fontWeight: 800, color: "#e2e8f0", textAlign: "right", fontFamily: MONO }}>{hoursChip(work.hours)}</span>
      <span
        style={{
          fontSize: "10px",
          fontWeight: 700,
          letterSpacing: ".05em",
          textTransform: "uppercase",
          color: workStateColor(work.state),
          whiteSpace: "nowrap",
          textAlign: "right",
        }}
      >
        {work.state}
      </span>
    </div>
  );
}

export default function PortalV2RetainerPage() {
  const [weekKey, setWeekKey] = useState<string>(RET_WEEKS[0].key);
  const [askText, setAskText] = useState("");
  const week = buildWeekView(weekKey);
  const askReady = askText.trim().length > 0;

  const live = useRetainerLive();
  const retSummary = live.dataState === "live" && live.bucket
    ? computeRetSummary({ retained: live.bucket.retainedHours, rolled: live.bucket.rolledHours, used: live.bucket.usedHours })
    : fixtureRetSummary;
  const retainedLabel = live.dataState === "live" && live.bucket
    ? `${live.bucket.retainedHours.toFixed(1)} hours`
    : RET_COPY.retainedMonthly;
  const workItems = live.dataState === "live" && live.entries.length > 0 ? live.entries : RET_WORK;
  // Real read in flight: `loaded` is the only signal this hook exposes (Git
  // #1365) — `dataState` starts "fixture" and stays "fixture" for a genuinely
  // unconfigured retainer, so it can't distinguish loading from settled.
  const retainerLoading = !live.loaded;

  return (
    <PortalV2Shell eyebrow={RET_COPY.eyebrow} title="My Architect">
      <div style={{ minHeight: "100%", background: SIDEBAR_WASH }}>
        <div
          style={{
            position: "relative",
            maxWidth: 1240,
            margin: "0 auto",
            padding: "26px 26px 48px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
            boxSizing: "border-box",
          }}
        >
          {/* Back to Overview — a real link, since Overview is a real route */}
          <Link
            href="/portal-v2"
            data-testid="pv2-ret-back"
            style={{
              alignSelf: "flex-start",
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: 0,
              fontSize: "11.5px",
              fontWeight: 600,
              color: "#64748b",
              textDecoration: "none",
            }}
          >
            <ArrowLeft size={13} />
            Overview
          </Link>

          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              gap: 16,
              flexWrap: "wrap",
              paddingBottom: 14,
              borderBottom: "1px solid rgba(30,41,59,.9)",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
              <span
                data-testid="pv2-page-title"
                style={{ fontSize: "18px", fontWeight: 800, color: "#f8fafc", letterSpacing: "-.015em" }}
              >
                {RET_COPY.heading}
              </span>
              <span style={{ fontSize: "12.5px", color: "#94a3b8", lineHeight: 1.55, maxWidth: "82ch" }}>{RET_COPY.subhead}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flex: "0 0 auto" }}>
              <span style={{ fontSize: "10.5px", color: "#64748b" }}>{RET_COPY.architect}</span>
              <span style={{ fontSize: "10.5px", color: "#475569" }}>{RET_COPY.billing}</span>
            </div>
          </div>

          {/* Month rollup cards */}
          <span data-testid="pv2-ret-source" style={PV2_SOURCE_CLIP}>{live.dataState}</span>

          {retainerLoading ? (
            <PortalV2LoadingState rows={2} label="Loading your retainer hours…" testId="pv2-ret-summary-loading" />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: 12, alignItems: "stretch" }}>
              <TimeCard retSummary={retSummary} retainedLabel={retainedLabel} />
              <SmallCard
                label={RET_COPY.findingsClosedLabel}
                value={RET_COPY.findingsClosedValue}
                sub={RET_COPY.findingsClosedSub}
                valueSize="20px"
              />
              <SmallCard
                label={RET_COPY.nextScheduledLabel}
                value={RET_COPY.nextScheduledValue}
                sub={RET_COPY.nextScheduledSub}
              />
            </div>
          )}

          {/* Where the hours went */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <Eyebrow colour="#64748b">{RET_COPY.hoursHeading}</Eyebrow>
              <span style={{ fontSize: "10.5px", color: "#475569" }}>{RET_COPY.hoursHeadingNote}</span>
            </div>
            <div
              data-testid="pv2-ret-work"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 0,
                border: "1px solid rgba(30,41,59,.9)",
                borderRadius: 12,
                background: "rgba(15,23,42,.35)",
                overflow: "hidden",
              }}
            >
              {retainerLoading ? (
                <PortalV2LoadingState rows={4} label="Loading where the hours went…" testId="pv2-ret-work-loading" />
              ) : (
                workItems.map((w, i) => <WorkRow key={`${w.finding}-${w.week}-${i}`} work={w} />)
              )}
            </div>
          </div>

          {/* Week detail + right rail */}
          <div className="pv2-gov-grid">
            {/* Left: week selector + report */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <Eyebrow colour="#64748b">{RET_COPY.weekDetailLabel}</Eyebrow>
                <span style={{ fontSize: "10.5px", color: "#475569" }}>{RET_COPY.weekDetailNote}</span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))", gap: 8 }}>
                {RET_WEEKS.map((t) => {
                  const sel = t.key === weekKey;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setWeekKey(t.key)}
                      data-testid={`pv2-ret-week-tab-${t.key}`}
                      aria-pressed={sel}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                        textAlign: "left",
                        padding: "9px 13px",
                        borderRadius: 9,
                        border: `1px solid ${sel ? "rgba(0,120,212,.55)" : "rgba(30,41,59,.9)"}`,
                        background: sel ? "rgba(0,120,212,.09)" : "rgba(15,23,42,.4)",
                        cursor: "pointer",
                        fontFamily: "inherit",
                        minWidth: 0,
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: "12px", fontWeight: 800, color: sel ? "#60a5fa" : "#e2e8f0" }}>{t.label}</span>
                        {t.current && (
                          <span style={{ fontSize: "8.5px", fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#34d399" }}>
                            Now
                          </span>
                        )}
                      </span>
                      <span style={{ fontSize: "10.5px", color: "#64748b" }}>{t.range}</span>
                      <span style={{ fontSize: "10.5px", color: "#94a3b8", fontFamily: MONO }}>{hoursChip(t.hours)}</span>
                    </button>
                  );
                })}
              </div>

              {/* Selected week's report */}
              <div
                data-testid="pv2-ret-week-report"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 0,
                  border: "1px solid rgba(30,41,59,.9)",
                  borderRadius: 12,
                  background: "rgba(15,23,42,.35)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    padding: "13px 16px",
                    borderBottom: "1px solid rgba(30,41,59,.9)",
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                    <span style={{ fontSize: "12.5px", fontWeight: 800, color: "#f1f5f9" }}>
                      {week.label} · {week.range} · {week.hours}
                    </span>
                    <span style={{ fontSize: "10.5px", color: "#64748b" }}>
                      {week.author} · {week.published}
                    </span>
                  </div>
                  <button
                    type="button"
                    style={{
                      padding: "5px 11px",
                      borderRadius: 6,
                      border: "1px solid rgba(148,163,184,.22)",
                      background: "transparent",
                      fontSize: "10.5px",
                      fontWeight: 600,
                      color: "#94a3b8",
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    Open as PDF
                  </button>
                </div>
                <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
                  <span style={{ fontSize: "12.5px", color: "#cbd5e1", lineHeight: 1.68, textWrap: "pretty" }}>{week.summary}</span>

                  {week.hasLog && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <Eyebrow colour="#64748b" spacing=".09em">
                        Work log
                      </Eyebrow>
                      {week.log.map((l) => (
                        <div
                          key={l.what}
                          style={{
                            display: "flex",
                            alignItems: "baseline",
                            justifyContent: "space-between",
                            gap: 12,
                            padding: "7px 0",
                            borderBottom: "1px solid rgba(30,41,59,.75)",
                          }}
                        >
                          <span style={{ fontSize: "11.5px", color: "#e2e8f0", lineHeight: 1.45, textWrap: "pretty" }}>{l.what}</span>
                          <span style={{ flex: "0 0 auto", fontSize: "11.5px", fontWeight: 700, color: "#94a3b8", fontFamily: MONO }}>{l.hours}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {week.hasDeliverables && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <Eyebrow colour="#64748b" spacing=".09em">
                        Produced this week
                      </Eyebrow>
                      {week.deliverables.map((d) => (
                        <div
                          key={d}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 10,
                            padding: "8px 11px",
                            border: "1px solid rgba(30,41,59,.9)",
                            borderRadius: 8,
                            background: "#0b1524",
                          }}
                        >
                          <span style={{ fontSize: "11.5px", color: "#e2e8f0", lineHeight: 1.45, textWrap: "pretty" }}>{d}</span>
                          <button
                            type="button"
                            style={{
                              flex: "0 0 auto",
                              padding: 0,
                              background: "none",
                              border: "none",
                              fontSize: "10.5px",
                              fontWeight: 600,
                              color: "#60a5fa",
                              cursor: "pointer",
                              fontFamily: "inherit",
                            }}
                          >
                            Open
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      paddingTop: 2,
                      borderTop: "1px solid rgba(30,41,59,.85)",
                    }}
                  >
                    <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: "#64748b", paddingTop: 12 }}>
                      Questions on this report
                    </span>
                    {week.asks.map((a) => (
                      <div
                        key={`${a.when}-${a.who}`}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 3,
                          padding: "11px 13px",
                          borderRadius: 9,
                          border: `1px solid ${a.fromYou ? "rgba(148,163,184,.2)" : "rgba(0,120,212,.3)"}`,
                          background: a.fromYou ? "rgba(148,163,184,.05)" : "rgba(0,120,212,.05)",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                          <span
                            style={{
                              fontSize: "10px",
                              fontWeight: 700,
                              letterSpacing: ".06em",
                              textTransform: "uppercase",
                              color: a.fromYou ? "#94a3b8" : "#60a5fa",
                            }}
                          >
                            {a.who}
                          </span>
                          <span style={{ fontSize: "10px", color: "#475569" }}>{a.when}</span>
                        </div>
                        <span style={{ fontSize: "11.5px", color: "#e2e8f0", lineHeight: 1.6, textWrap: "pretty" }}>{a.text}</span>
                      </div>
                    ))}
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 8, flexWrap: "wrap" }}>
                      <input
                        value={askText}
                        onChange={(e) => setAskText(e.target.value)}
                        placeholder={RET_COPY.askPlaceholder}
                        style={{
                          flex: "1 1 240px",
                          padding: "9px 12px",
                          borderRadius: 7,
                          border: "1px solid rgba(30,41,59,.9)",
                          background: "#0b1a2e",
                          color: "#e2e8f0",
                          fontSize: "12px",
                          fontFamily: "inherit",
                        }}
                      />
                      <button
                        type="button"
                        style={{
                          padding: "8px 14px",
                          borderRadius: 7,
                          fontSize: "11.5px",
                          fontWeight: 700,
                          cursor: askReady ? "pointer" : "default",
                          fontFamily: "inherit",
                          border: `1px solid ${askReady ? "#0078D4" : "rgba(30,41,59,.9)"}`,
                          background: askReady ? "#0078D4" : "transparent",
                          color: askReady ? "#fff" : "#475569",
                        }}
                      >
                        Send
                      </button>
                    </div>
                    <span style={{ fontSize: "10.5px", color: "#475569" }}>{RET_COPY.askNote}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right rail */}
            <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
              {/* What the retainer has produced */}
              <div
                data-testid="pv2-ret-produced"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 0,
                  border: "1px solid rgba(52,211,153,.24)",
                  borderRadius: 12,
                  background: "rgba(52,211,153,.04)",
                  overflow: "hidden",
                }}
              >
                <div style={{ padding: "11px 14px", borderBottom: "1px solid rgba(52,211,153,.14)", display: "flex", flexDirection: "column", gap: 2 }}>
                  <Eyebrow colour="#34d399" spacing=".16em">
                    {RET_COPY.producedLabel}
                  </Eyebrow>
                  <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.45 }}>{RET_COPY.producedNote}</span>
                </div>
                {RET_OUTCOMES.map((o) => (
                  <div key={o.what} style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "11px 14px", borderBottom: "1px solid rgba(52,211,153,.1)" }}>
                    <span style={{ flex: "0 0 6px", width: 6, height: 6, borderRadius: "50%", background: outcomeToneColor(o.tone), marginTop: 6 }} />
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#e2e8f0", lineHeight: 1.45 }}>{o.what}</span>
                      <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.5, textWrap: "pretty" }}>{o.detail}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Documents */}
              <div
                data-testid="pv2-ret-docs"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 0,
                  border: "1px solid rgba(30,41,59,.9)",
                  borderRadius: 12,
                  background: "rgba(15,23,42,.4)",
                  overflow: "hidden",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "11px 14px", borderBottom: "1px solid rgba(30,41,59,.9)" }}>
                  <Eyebrow colour="#64748b" spacing=".16em">
                    {RET_COPY.documentsLabel}
                  </Eyebrow>
                  <button
                    type="button"
                    style={{
                      padding: "4px 10px",
                      borderRadius: 5,
                      border: "1px solid rgba(148,163,184,.22)",
                      background: "transparent",
                      fontSize: "10.5px",
                      fontWeight: 600,
                      color: "#94a3b8",
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {RET_COPY.documentsAll}
                  </button>
                </div>
                {RET_DOCS.map((d) => (
                  <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid rgba(30,41,59,.8)" }}>
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                      <span style={{ fontSize: "11.5px", fontWeight: 600, color: "#e2e8f0", lineHeight: 1.4, textWrap: "pretty" }}>{d.name}</span>
                      <span style={{ fontSize: "10.5px", color: "#64748b" }}>
                        {d.kind} · {d.when}
                      </span>
                    </div>
                    <button
                      type="button"
                      style={{
                        flex: "0 0 auto",
                        padding: 0,
                        background: "none",
                        border: "none",
                        fontSize: "10.5px",
                        fontWeight: 600,
                        color: "#60a5fa",
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      Open
                    </button>
                  </div>
                ))}
              </div>

              {/* How the retainer works */}
              <div
                data-testid="pv2-ret-terms"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 0,
                  border: "1px solid rgba(30,41,59,.9)",
                  borderRadius: 12,
                  background: "rgba(15,23,42,.4)",
                  overflow: "hidden",
                }}
              >
                <div style={{ padding: "11px 14px", borderBottom: "1px solid rgba(30,41,59,.9)" }}>
                  <Eyebrow colour="#64748b" spacing=".16em">
                    {RET_COPY.termsLabel}
                  </Eyebrow>
                </div>
                <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 0 }}>
                  {RET_TERMS.map((t) => (
                    <div key={t.k} style={{ display: "flex", flexDirection: "column", gap: 1, padding: "8px 0", borderBottom: "1px solid rgba(30,41,59,.75)" }}>
                      <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: "#64748b" }}>{t.k}</span>
                      <span style={{ fontSize: "11.5px", color: "#e2e8f0", lineHeight: 1.55, textWrap: "pretty" }}>{t.v}</span>
                    </div>
                  ))}
                </div>
                <div style={{ padding: "0 14px 13px", display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    style={{
                      padding: "6px 12px",
                      borderRadius: 6,
                      border: "1px solid rgba(0,120,212,.45)",
                      background: "rgba(0,120,212,.12)",
                      fontSize: "11px",
                      fontWeight: 700,
                      color: "#60a5fa",
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    Book time
                  </button>
                  <button
                    type="button"
                    style={{
                      padding: "6px 12px",
                      borderRadius: 6,
                      border: "1px solid rgba(148,163,184,.22)",
                      background: "transparent",
                      fontSize: "11px",
                      fontWeight: 600,
                      color: "#94a3b8",
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    Billing
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </PortalV2Shell>
  );
}
