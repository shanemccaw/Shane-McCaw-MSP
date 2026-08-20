/**
 * portal-v2-ms-changes.tsx — the Microsoft Changes module.
 *
 * Built from 'Microsoft Changes.dc.html' (markup 27-260, logic 590-1800).
 * A NEW file in this handoff round; the round-one bundle had no such module.
 *
 * ── What this page argues ──────────────────────────────────────────────────
 * Microsoft tells every tenant the same thing. This page says what it means for
 * THIS one. Each post carries Microsoft's own Message Center text beside the
 * tenant's answer, the Graph/PowerShell evidence behind that answer, and a
 * written consequence of doing nothing. The `score` is a per-tenant impact
 * number, not Microsoft's severity — which is the whole point of reading the
 * post against a scan rather than forwarding it.
 *
 * ── Round Two, item 6: the Gantt rows are fluid ────────────────────────────
 * "Horizontal scroll removed from several data displays ... the Change Control
 * CR/Microsoft-changes Gantt rows. These were all already built on fluid grid
 * columns (`minmax(0,1fr)`); the fix was removing an unnecessary fixed
 * `min-width` floor and its scroll wrapper."
 *
 * The density ROWS here are exactly that shape — `repeat(11,1fr)` with no floor
 * of their own (prototype 208) — and they are reproduced with no scroll
 * wrapper. The WAVE BAND above them is a different element and the prototype
 * still carries `overflow-x:auto` + `min-width:820px` on it (165-166); that one
 * is honoured rather than "fixed", because eleven columns of month header plus
 * a 190px label genuinely need the width, and the changelog names the ROWS.
 *
 * ── What is built here, and what is not ────────────────────────────────────
 * Built: the wave selector, the density grid, the freeze bands, the named posts
 * for the selected wave, and each post's full detail — Microsoft's words, the
 * plain-English reading, the evidence table, the consequence, the phases, the
 * change-request state and the history.
 *
 * Not built, and listed rather than quietly dropped: the "Did this release?"
 * retrospective, the seen-in-the-wild list, the per-group impact panel
 * (GROUPS), the thread/snooze/decision overlays, and the workload filter rail.
 * Each is its own subsystem in the prototype with its own state, and none is
 * named by the Round Two or Round Three changelog.
 */

import { useMemo, useState } from "react";
import { useRoute } from "wouter";
import { ChevronDown } from "lucide-react";

import { PortalV2Shell, SIDEBAR_WASH } from "@/components/portal-v2/PortalV2Shell";
import {
  MSC_BUCKETS,
  MSC_DENSITY,
  MSC_FREEZE_BANDS,
  MSC_KINDS,
  MSC_TODAY_LABEL,
  WORKLOAD_TONE,
  type MsPost,
} from "@/components/portal-v2/msChangesData";
import {
  bucketSums,
  bucketsInWave,
  breakingInWave,
  cellDots,
  cellTitle,
  clampWave,
  isFreezeBucket,
  postsInWave,
  waveBands,
  waveCount,
  waveLabel,
  waveTitle,
} from "@/components/portal-v2/msChangesModel";

const MONO = "'SF Mono',Menlo,Consolas,monospace";

/** The nav's readable wave slugs, in band order — see PortalV2Shell REFERENCE_ITEMS. */
const WAVE_SLUGS = ["late-august", "september", "q2", "q3", "beyond"] as const;

const KIND_TONE = Object.fromEntries(MSC_KINDS.map((k) => [k.k, k.tone])) as Record<string, string>;

function Kicker({ colour, children }: { colour: string; children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: "9.5px",
        fontWeight: 700,
        letterSpacing: ".14em",
        textTransform: "uppercase",
        color: colour,
      }}
    >
      {children}
    </span>
  );
}

/** One post, collapsed to a row and expanding in place — the portal's own idiom. */
function PostRow({ post, open, onToggle }: { post: MsPost; open: boolean; onToggle: () => void }) {
  const tone = WORKLOAD_TONE[post.wl] ?? "#94a3b8";
  const hits = post.impact === "Hits you";
  return (
    <div
      data-testid={`pv2-msc-post-${post.id}`}
      style={{
        border: `1px solid ${post.hard ? "rgba(248,113,113,.3)" : "rgba(30,41,59,.9)"}`,
        borderRadius: 12,
        background: post.hard ? "rgba(248,113,113,.04)" : "rgba(2,6,23,.35)",
        overflow: "hidden",
      }}
    >
      <button
        onClick={onToggle}
        data-testid={`pv2-msc-toggle-${post.id}`}
        aria-expanded={open}
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) 120px 92px 22px",
          gap: 12,
          alignItems: "center",
          width: "100%",
          padding: "13px 15px",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          fontFamily: "inherit",
          textAlign: "left",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: "9.5px", fontWeight: 700, color: "#475569", fontFamily: MONO }}>
              {post.id}
            </span>
            <span
              style={{
                display: "inline-flex",
                padding: "1px 7px",
                borderRadius: 5,
                fontSize: "9px",
                fontWeight: 800,
                letterSpacing: ".05em",
                textTransform: "uppercase",
                color: tone,
                background: `${tone}14`,
                border: `1px solid ${tone}44`,
              }}
            >
              {post.workload}
            </span>
            <span style={{ fontSize: "9.5px", fontWeight: 700, color: "#64748b" }}>{post.kind}</span>
          </span>
          <span style={{ fontSize: "13px", fontWeight: 700, color: "#f1f5f9", lineHeight: 1.4 }}>
            {post.title}
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#e2e8f0", fontFamily: MONO }}>
            {post.when}
          </span>
          <span style={{ fontSize: "10px", color: "#64748b" }}>{post.countdown}</span>
        </div>
        <span
          style={{
            fontSize: "10px",
            fontWeight: 800,
            letterSpacing: ".05em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
            color: hits ? "#f87171" : "#94a3b8",
          }}
        >
          {post.impact}
        </span>
        <span
          style={{
            display: "flex",
            justifyContent: "flex-end",
            color: "#64748b",
            transform: `rotate(${open ? 0 : -90}deg)`,
            transition: "transform 180ms",
          }}
        >
          <ChevronDown size={15} />
        </span>
      </button>

      {open && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
            padding: "4px 15px 16px",
            borderTop: "1px solid rgba(30,41,59,.7)",
          }}
        >
          {/* Microsoft's words vs the tenant's answer, side by side — the
              module's central claim, so they share one row and equal width. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 12, paddingTop: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <Kicker colour="#94a3b8">Microsoft says</Kicker>
              <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.6, textWrap: "pretty" }}>
                {post.msSays}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <Kicker colour="#22d3ee">Your tenant says</Kicker>
              <span style={{ fontSize: "11.5px", color: "#cbd5e1", lineHeight: 1.6, textWrap: "pretty" }}>
                {post.youSay}
              </span>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <Kicker colour="#60a5fa">In plain words</Kicker>
            <span style={{ fontSize: "12px", color: "#cbd5e1", lineHeight: 1.65, textWrap: "pretty" }}>
              {post.plain}
            </span>
          </div>

          {/* Evidence — the provenance block every drill-down in this portal has */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 0,
              border: "1px solid rgba(30,41,59,.9)",
              borderRadius: 10,
              background: "rgba(2,6,23,.4)",
              overflow: "hidden",
            }}
          >
            {post.evidence.map((e, i) => (
              <div
                key={e.q}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0,1.6fr) minmax(0,1fr)",
                  gap: 12,
                  padding: "9px 12px",
                  alignItems: "center",
                  borderBottom: i === post.evidence.length - 1 ? "none" : "1px solid rgba(30,41,59,.8)",
                }}
              >
                <span
                  style={{
                    fontSize: "10.5px",
                    color: "#94a3b8",
                    fontFamily: MONO,
                    lineHeight: 1.5,
                    minWidth: 0,
                    overflowWrap: "anywhere",
                  }}
                >
                  {e.q}
                </span>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    color: e.bad ? "#f87171" : "#34d399",
                    lineHeight: 1.5,
                    minWidth: 0,
                  }}
                >
                  {e.a}
                </span>
              </div>
            ))}
          </div>
          <span style={{ fontSize: "10.5px", color: "#475569", lineHeight: 1.5 }}>{post.evidenceNote}</span>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 5,
              padding: "13px 14px",
              border: "1px solid rgba(248,113,113,.28)",
              borderRadius: 11,
              background: "rgba(248,113,113,.05)",
            }}
          >
            <Kicker colour="#f87171">If nobody acts</Kicker>
            <span style={{ fontSize: "12px", color: "#cbd5e1", lineHeight: 1.65, textWrap: "pretty" }}>
              {post.ignore}
            </span>
          </div>

          {/* Phases, and the CR that already exists for it */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <Kicker colour="#a78bfa">How it rolls out</Kicker>
              {post.phases.map((ph) => (
                <div key={ph.name} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#e2e8f0" }}>
                    {ph.name} · <span style={{ fontFamily: MONO, fontWeight: 600 }}>{ph.when}</span>
                  </span>
                  <span style={{ fontSize: "10.5px", color: "#94a3b8", lineHeight: 1.5 }}>{ph.note}</span>
                </div>
              ))}
              <span style={{ fontSize: "10px", color: "#475569", fontFamily: MONO }}>{post.roadmapId}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <Kicker colour="#0078D4">Change request</Kicker>
              <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: "12px", fontWeight: 800, color: "#60a5fa", fontFamily: MONO }}>
                  {post.crCode}
                </span>
                <span style={{ fontSize: "10.5px", fontWeight: 700, color: "#94a3b8" }}>{post.crState}</span>
              </span>
              <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.6, textWrap: "pretty" }}>
                {post.crNote}
              </span>
              <span style={{ fontSize: "11px", color: "#cbd5e1", lineHeight: 1.55 }}>
                <span style={{ color: "#64748b" }}>Opt-out: </span>
                {post.optOut} — {post.optOutNote}
              </span>
            </div>
          </div>

          {/* History — the module's sharpest point: dates move silently */}
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <Kicker colour="#fbbf24">What Microsoft changed about this post</Kicker>
            {post.history.map((h) => (
              <div key={`${h.at}-${h.what}`} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                <span
                  style={{
                    flex: "0 0 84px",
                    fontSize: "10px",
                    fontWeight: 700,
                    color: "#475569",
                    fontFamily: MONO,
                  }}
                >
                  {h.at}
                </span>
                <span style={{ flex: 1, fontSize: "11.5px", color: "#cbd5e1", lineHeight: 1.55, minWidth: 0 }}>
                  <span style={{ fontWeight: 700, color: "#e2e8f0" }}>{h.what}</span> — {h.detail}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function PortalV2MsChangesPage() {
  const [, params] = useRoute("/portal-v2/ms-changes/:wave");
  const bands = useMemo(() => waveBands(), []);
  const slugIndex = params?.wave ? WAVE_SLUGS.indexOf(params.wave as (typeof WAVE_SLUGS)[number]) : 0;
  const wave = clampWave(slugIndex < 0 ? 0 : slugIndex, bands);

  const [openId, setOpenId] = useState<string | null>(null);

  const sums = useMemo(() => bucketSums(), []);
  const selected = useMemo(() => new Set(bucketsInWave(wave, bands)), [wave, bands]);
  const posts = useMemo(() => postsInWave(wave), [wave]);
  const breaks = useMemo(() => breakingInWave(wave), [wave]);

  return (
    <PortalV2Shell eyebrow="Reference" title="Microsoft Changes">
      <div style={{ minHeight: "100%", background: SIDEBAR_WASH }}>
        <div
          style={{
            maxWidth: 1180,
            margin: "0 auto",
            padding: "26px 28px 110px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              gap: 20,
              flexWrap: "wrap",
              paddingBottom: 13,
              borderBottom: "1px solid rgba(30,41,59,.9)",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
              <span
                style={{ fontSize: "19px", fontWeight: 800, color: "#f8fafc", letterSpacing: "-.015em" }}
                data-testid="pv2-page-title"
              >
                Microsoft Changes
              </span>
              <span style={{ fontSize: "12.5px", color: "#94a3b8", lineHeight: 1.5 }}>
                Every Message Center post, read against your tenant rather than forwarded to you.
              </span>
            </div>
          </div>

          {/* ── The density grid ──────────────────────────────────────────
              The wave band keeps the prototype's scroll wrapper (165-166);
              the ROWS below it are the fluid `repeat(11,1fr)` shape Round Two
              de-scrolled, and carry no floor of their own. */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              padding: "16px 18px",
              border: "1px solid rgba(30,41,59,.9)",
              borderRadius: 13,
              background: "#0b1524",
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <Kicker colour="#22d3ee">What is coming</Kicker>
              <span style={{ fontSize: "11px", color: "#64748b" }}>
                {sums.reduce((a, b) => a + b, 0)} changes across the next twelve months, by workload
              </span>
            </div>

            <div style={{ overflowX: "auto", overflowY: "hidden" }} data-testid="pv2-msc-grid">
              <div style={{ minWidth: 820, display: "grid", gridTemplateColumns: "190px minmax(0,1fr)", gap: 0 }}>
                <span
                  style={{
                    fontSize: "9px",
                    fontWeight: 700,
                    letterSpacing: ".1em",
                    textTransform: "uppercase",
                    color: "#475569",
                    alignSelf: "end",
                    padding: "0 12px 6px 2px",
                  }}
                >
                  Wave
                </span>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(11,1fr)" }}>
                  {bands.map((b, wi) => {
                    const on = wi === wave;
                    const n = waveCount(wi);
                    return (
                      <a
                        key={b.wave}
                        href={`/portal-v2/ms-changes${wi === 0 ? "" : `/${WAVE_SLUGS[wi]}`}`}
                        title={waveTitle(b, n)}
                        data-testid={`pv2-msc-wave-${WAVE_SLUGS[wi]}`}
                        aria-current={on ? "page" : undefined}
                        style={{
                          gridColumn: `${b.start + 1} / span ${b.span}`,
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 0,
                          margin: "0 1px 5px",
                          padding: "5px 3px",
                          borderRadius: 5,
                          cursor: "pointer",
                          fontFamily: "inherit",
                          textDecoration: "none",
                          border: `1px solid ${on ? "rgba(96,165,250,.55)" : "rgba(96,165,250,.2)"}`,
                          background: on ? "rgba(96,165,250,.16)" : "rgba(96,165,250,.05)",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "9px",
                            fontWeight: on ? 800 : 700,
                            letterSpacing: ".03em",
                            textTransform: "uppercase",
                            color: on ? "#e2e8f0" : "#93c5fd",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            maxWidth: "100%",
                          }}
                        >
                          {waveLabel(b)}
                        </span>
                        <span
                          style={{
                            fontSize: "9px",
                            fontWeight: 700,
                            color: on ? "#93c5fd" : "#60a5fa",
                            whiteSpace: "nowrap",
                            lineHeight: 1.3,
                          }}
                        >
                          {n}
                        </span>
                      </a>
                    );
                  })}
                </div>

                <span
                  style={{
                    fontSize: "9px",
                    fontWeight: 700,
                    letterSpacing: ".1em",
                    textTransform: "uppercase",
                    color: "#475569",
                    alignSelf: "start",
                    padding: "6px 12px 0 2px",
                  }}
                >
                  Workload
                </span>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(11,1fr)" }}>
                  {MSC_BUCKETS.map((b, i) => (
                    <div
                      key={`${b.label}-${b.sub}`}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 0,
                        padding: "5px 2px",
                        borderLeft:
                          i === 0
                            ? "2px solid rgba(34,211,238,.75)"
                            : `1px solid ${isFreezeBucket(i) ? "rgba(248,113,113,.4)" : "rgba(30,41,59,.6)"}`,
                        background: selected.has(i) ? "rgba(96,165,250,.05)" : "transparent",
                      }}
                    >
                      {i === 0 && (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            padding: "1px 6px",
                            marginBottom: 2,
                            borderRadius: 999,
                            fontSize: "8px",
                            fontWeight: 800,
                            letterSpacing: ".06em",
                            textTransform: "uppercase",
                            color: "#022c33",
                            background: "#22d3ee",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {MSC_TODAY_LABEL}
                        </span>
                      )}
                      <span
                        style={{
                          fontSize: "9.5px",
                          fontWeight: i === 0 ? 800 : 700,
                          color: i === 0 ? "#22d3ee" : "#cbd5e1",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {b.label}
                      </span>
                      <span
                        style={{
                          fontSize: "8.5px",
                          fontWeight: 600,
                          color: isFreezeBucket(i) ? "#f87171" : "#475569",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {isFreezeBucket(i)
                          ? MSC_FREEZE_BANDS.find((f) => f.from <= i && i < f.from + f.span)?.label ?? b.sub
                          : b.sub}
                      </span>
                    </div>
                  ))}
                </div>

                {MSC_DENSITY.map((row) => (
                  <div
                    key={row.wl}
                    data-testid={`pv2-msc-row-${row.wl}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "190px minmax(0,1fr)",
                      gap: 0,
                      gridColumn: "1 / span 2",
                      borderTop: "1px solid rgba(30,41,59,.6)",
                    }}
                  >
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 9, padding: "0 12px 0 2px", minWidth: 0 }}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 2,
                          flex: "0 0 auto",
                          background: WORKLOAD_TONE[row.wl],
                        }}
                      />
                      <span
                        style={{
                          flex: 1,
                          fontSize: "11.5px",
                          fontWeight: 600,
                          color: "#cbd5e1",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          minWidth: 0,
                        }}
                      >
                        {row.name}
                      </span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(11,1fr)" }}>
                      {row.cells.map((c, i) => (
                        <div
                          key={i}
                          title={cellTitle(row.name, i, c)}
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            alignContent: "center",
                            justifyContent: "center",
                            gap: 3,
                            minHeight: 38,
                            padding: "6px 5px",
                            borderLeft:
                              i === 0
                                ? "2px solid rgba(34,211,238,.5)"
                                : `1px solid ${isFreezeBucket(i) ? "rgba(248,113,113,.35)" : "rgba(30,41,59,.5)"}`,
                            background: selected.has(i) ? "rgba(96,165,250,.05)" : "transparent",
                          }}
                        >
                          {cellDots(c).map((k, di) => (
                            <span
                              key={di}
                              style={{
                                width: 7,
                                height: 7,
                                borderRadius: 2,
                                background: KIND_TONE[k],
                                opacity: k === "s" ? 0.85 : 1,
                              }}
                            />
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", paddingTop: 2 }}>
              {MSC_KINDS.map((k) => (
                <span key={k.k} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 2, background: k.tone }} />
                  <span style={{ fontSize: "10px", color: "#64748b", whiteSpace: "nowrap" }}>{k.label}</span>
                </span>
              ))}
            </div>
          </div>

          {/* What stops working, for the selected wave — prototype 222-240 */}
          {breaks.length > 0 && (
            <div
              data-testid="pv2-msc-breaks"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 9,
                padding: "15px 17px",
                border: "1px solid rgba(248,113,113,.28)",
                borderRadius: 13,
                background: "#0b1524",
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <Kicker colour="#f87171">What stops working</Kicker>
                <span style={{ fontSize: "11px", color: "#64748b" }}>
                  {breaks.length} in {bands[wave].wave.toLowerCase()}, with a date you cannot move
                </span>
              </div>
              {breaks.map((p) => (
                <div
                  key={p.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "150px minmax(0,1fr)",
                    gap: 14,
                    padding: "10px 12px",
                    borderLeft: "2px solid rgba(248,113,113,.5)",
                    borderRadius: "0 8px 8px 0",
                    background: "rgba(248,113,113,.05)",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                    <span style={{ fontSize: "12.5px", fontWeight: 800, color: "#f87171", lineHeight: 1.3 }}>
                      {p.when}
                    </span>
                    <span style={{ fontSize: "10px", color: "#94a3b8" }}>{p.countdown}</span>
                    <span style={{ fontSize: "9.5px", fontWeight: 700, color: "#475569", fontFamily: MONO }}>
                      {p.id}
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                    <span style={{ fontSize: "13px", fontWeight: 700, color: "#f1f5f9", lineHeight: 1.4 }}>
                      {p.title}
                    </span>
                    <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.55, textWrap: "pretty" }}>
                      {p.seats}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* The wave's named posts */}
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <Kicker colour="#2dd4bf">{bands[wave].wave}</Kicker>
              <span style={{ fontSize: "11px", color: "#64748b" }} data-testid="pv2-msc-post-count">
                {posts.length === 0
                  ? "No post in this wave has been read against your tenant yet."
                  : `${posts.length} read against your tenant`}
              </span>
            </div>
            {posts.map((p) => (
              <PostRow
                key={p.id}
                post={p}
                open={openId === p.id}
                onToggle={() => setOpenId(openId === p.id ? null : p.id)}
              />
            ))}
          </div>
        </div>
      </div>
    </PortalV2Shell>
  );
}
