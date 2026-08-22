/**
 * portal-v2-ms-changes.tsx — the Microsoft Changes module.
 *
 * Built from 'Microsoft Changes.dc.html' (active markup 27-586, logic 590-2172).
 *
 * ── What this page argues ──────────────────────────────────────────────────
 * Microsoft ships in waves. Pick a wave and this page becomes that wave: what
 * lands, what stops working, what needs a decision before it decides itself,
 * and what your people will simply see. Each post is read against the tenant —
 * Microsoft's own words beside the tenant's counted answer — not forwarded.
 *
 * ── Round Two, item 6: the density rows are fluid, the wave band is not ────
 * The density ROWS are the fluid `repeat(11,1fr)` shape with no min-width floor
 * and no scroll wrapper (prototype 208). The WAVE BAND above them keeps its
 * `overflow-x:auto` + `min-width:820px` (165-166), because eleven month columns
 * plus a 190px label genuinely need the width and the changelog names the ROWS.
 * Both are honoured rather than "fixed".
 *
 * ── Part 10 finished the deferred surfaces ─────────────────────────────────
 * The wave-page layout replaces the earlier inline post list: the wave header
 * card with its four tiles and "Brief this wave", "What your people will see"
 * (the seen-in-the-wild list), "What stops working", "Decide before it lands"
 * with its snooze / record-a-decision overlays, "Nothing to do", the per-group
 * impact panel, the "Did this release?" retrospective, the ownership line, the
 * board-briefing / digest / services (workload) forms, and the eleven-section
 * post detail slide-over with its thread. Every form is the portal's one
 * FormDrawer primitive; the design's `pick`/`toggle` fields map to its selects.
 */

import { useEffect, useMemo, useState } from "react";
import { useRoute } from "wouter";
import { Link } from "wouter";

import { useFormDrawer, type FormSpec } from "@/components/portal-v2/FormDrawer";
import { PortalV2Shell, SIDEBAR_WASH } from "@/components/portal-v2/PortalV2Shell";
/**
 * The bucket axis, the density rows, the stat cards, the post corpus and the
 * scan time no longer come from this module — they come from the `MscDataset`
 * that `useMessageCenter()` returns, which is the tenant's real Message Center
 * when one is reachable and this fixture when it is not.
 *
 * What is still imported here is the design's own STRUCTURE, which has no data
 * source and needs none: the four kind legends, the eleven detail sections, the
 * workload accents, and the tenant's freeze bands / today pin.
 */
import {
  MSC_FREEZE_BANDS,
  MSC_KINDS,
  MSC_SECS,
  MSC_TODAY_LABEL,
  WORKLOAD_TONE,
  type MsPost,
} from "@/components/portal-v2/msChangesData";
import { useMessageCenter } from "@/components/portal-v2/useMessageCenter";
import {
  breakMeta,
  cellDots,
  cellTitle,
  clampWave,
  decideMeta,
  activeDensity,
  freezeInWave,
  groupStrip,
  groupWave,
  impactTone,
  isFreezeBucket,
  pastWave,
  QUIET_META,
  raciRows,
  rangeOf,
  seenInWave,
  waveBands,
  waveBreaks,
  waveCount,
  waveLabel,
  waveNotice,
  waveQueue,
  waveQuiet,
  waveSilent,
  waveStatus,
  waveTiles,
  waveTitle,
  waveTotals,
  type Services,
} from "@/components/portal-v2/msChangesModel";

const MONO = "'SF Mono',Menlo,Consolas,monospace";

/** The nav's readable wave slugs, in band order — see PortalV2Shell REFERENCE_ITEMS. */
const WAVE_SLUGS = ["late-august", "september", "q2", "q3", "beyond"] as const;

const KIND_TONE = Object.fromEntries(MSC_KINDS.map((k) => [k.k, k.tone])) as Record<string, string>;

const ALL_SERVICES: Services = { Exchange: true, Teams: true, SharePoint: true, Entra: true, Purview: true, Copilot: true };

/** The Settings button's dynamic label — prototype `settingsLabel` (1255). */
function settingsLabel(services: Services): string {
  const count = Object.values(services).filter(Boolean).length;
  return `Settings · ${count} services`;
}

/**
 * Round Four: each wave tile drops its evidence in place. The label, note and
 * tone per tile key — prototype `wDrill` (Microsoft Changes.dc.html 1946-1961).
 */
const WT_META: Readonly<Record<string, { label: string; note: string; tone: string }>> = {
  changes: { label: "changes in this wave", note: "Every notice in scope, read against your tenant rather than against the catalogue.", tone: "#60a5fa" },
  breaks: { label: "stop something working", note: "Each one has a named thing in your tenant and a date it stops.", tone: "#f87171" },
  decide: { label: "need a decision", note: "Each carries a date after which the decision is made for you.", tone: "#fbbf24" },
  seen: { label: "your people will notice", note: "No admin action needed. Somebody still has to be told.", tone: "#a78bfa" },
};

interface WaveDrillRow {
  id: string;
  title: string;
  why: string;
  meta: string;
  metaTone: string;
}

function Kicker({ colour, children }: { colour: string; children: React.ReactNode }) {
  return (
    <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: colour }}>
      {children}
    </span>
  );
}

function pill(text: string, tone: string, bg?: string): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    alignSelf: "flex-start",
    padding: "2px 8px",
    borderRadius: 5,
    fontSize: "10px",
    fontWeight: 700,
    letterSpacing: ".04em",
    whiteSpace: "nowrap",
    color: tone,
    background: bg ?? "rgba(148,163,184,.1)",
    border: `1px solid ${tone}40`,
  };
}

const HEADER_BTN = (accent: boolean): React.CSSProperties => ({
  padding: "9px 15px",
  borderRadius: 7,
  fontSize: "12px",
  fontWeight: accent ? 700 : 600,
  border: accent ? "1px solid #0078D4" : "1px solid rgba(148,163,184,.24)",
  background: accent ? "#0078D4" : "transparent",
  color: accent ? "#fff" : "#94a3b8",
  cursor: "pointer",
  fontFamily: "inherit",
  whiteSpace: "nowrap",
});

const SECTION_CARD = (border: string): React.CSSProperties => ({
  display: "flex",
  flexDirection: "column",
  gap: 9,
  padding: "15px 17px",
  border: `1px solid ${border}`,
  borderRadius: 13,
  background: "#0b1524",
});

/** A design-style form spec (fields with pick/toggle) mapped onto the FormDrawer. */
interface MscField {
  k: string;
  label: string;
  kind: "text" | "area" | "select" | "pick" | "toggle";
  options?: string[];
  toggleLabel?: string;
  value?: string;
  ph?: string;
  hint?: string;
}
interface MscFormCfg {
  kicker: string;
  title: string;
  intro: string;
  submitLabel: string;
  fields: MscField[];
  doneNote: string;
  onSubmit?: (v: Record<string, string>) => void;
}

function toFormSpec(cfg: MscFormCfg): FormSpec {
  return {
    kicker: cfg.kicker,
    title: cfg.title,
    intro: cfg.intro,
    submitLabel: cfg.submitLabel,
    doneNote: cfg.doneNote,
    onSubmit: cfg.onSubmit,
    fields: cfg.fields.map((f) => {
      if (f.kind === "text") return { id: f.k, label: f.label, kind: "text" as const, wide: true, value: f.value, placeholder: f.ph, hint: f.hint };
      if (f.kind === "area") return { id: f.k, label: f.label, kind: "textarea" as const, wide: true, value: f.value, placeholder: f.ph, hint: f.hint };
      if (f.kind === "toggle")
        return {
          id: f.k,
          label: f.label,
          kind: "select" as const,
          value: f.value ?? "In use",
          options: [
            { value: "In use", label: f.toggleLabel ?? "In use" },
            { value: "Off", label: "Off" },
          ],
          hint: f.hint,
        };
      // select | pick -> a native select of the same options
      return {
        id: f.k,
        label: f.label,
        kind: "select" as const,
        wide: f.kind === "pick",
        value: f.value ?? (f.options?.[0] ?? ""),
        options: (f.options ?? []).map((o) => ({ value: o, label: o })),
        hint: f.hint,
      };
    }),
  };
}

/* ── The post detail slide-over — prototype 327-517 ──────────────────────── */

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "#475569" }}>{label}</span>
      <span style={{ fontSize: "12px", fontWeight: 600, color: "#e2e8f0", lineHeight: 1.45 }}>{value}</span>
    </div>
  );
}

function BlockHead({ head, hint }: { head: string; hint?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
      <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "#64748b" }}>{head}</span>
      {hint && <span style={{ fontSize: "10.5px", color: "#475569" }}>{hint}</span>}
    </div>
  );
}

function Prose({ text, css }: { text: string; css: React.CSSProperties }) {
  return <span style={css}>{text}</span>;
}

const BLOCK_WRAP: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  padding: "15px 17px",
  border: "1px solid rgba(30,41,59,.9)",
  borderRadius: 11,
  background: "#0b1524",
  minWidth: 0,
};

function PostDetail({
  post,
  sec,
  setSec,
  thread,
  decided,
  snoozed,
  onCr,
  onDecide,
  onSnooze,
  onAsk,
  onTag,
  toast,
  onClose,
}: {
  post: MsPost;
  sec: string;
  setSec: (k: string) => void;
  thread: readonly { who: string; at: string; text: string; mine?: boolean }[];
  decided: string | undefined;
  snoozed: string | undefined;
  onCr: () => void;
  onDecide: () => void;
  onSnooze: () => void;
  onAsk: () => void;
  onTag: () => void;
  toast: (m: string) => void;
  onClose: () => void;
}) {
  const tone = impactTone(post.impact);
  const secDef = MSC_SECS.find((s) => s.key === sec) ?? MSC_SECS[0];
  const proseCss = (extra: React.CSSProperties): React.CSSProperties => ({ lineHeight: 1.7, textWrap: "pretty", ...extra });

  const acts: { label: string; go: () => void; accent?: boolean; tone?: string; border?: string; bg?: string }[] = [];
  if (post.crCode) acts.push({ label: `Open ${post.crCode}`, go: () => toast(`${post.crCode} opens on the change control page, linked to ${post.id}.`), tone: "#93c5fd", border: "rgba(0,120,212,.4)", bg: "rgba(0,120,212,.1)" });
  else acts.push({ label: "Raise a change request", go: onCr, tone: "#fff", border: "#0078D4", bg: "#0078D4" });
  acts.push({ label: decided ? "Decision recorded" : "Record a decision", go: onDecide, tone: decided ? "#34d399" : "#fbbf24", border: decided ? "rgba(52,211,153,.35)" : "rgba(251,191,36,.4)", bg: "transparent" });
  acts.push({ label: snoozed ? `Snoozed · ${snoozed}` : "Snooze", go: onSnooze, tone: "#94a3b8", border: "rgba(148,163,184,.24)", bg: "transparent" });

  const actNote = snoozed
    ? `Snoozed until ${snoozed.toLowerCase()}. It comes back before the deadline, and sooner if Microsoft edits the post.`
    : decided
      ? `Decision on record: ${decided.toLowerCase()}.`
      : "No decision on record yet. Reading a notice is not deciding on it.";

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 114, background: "rgba(2,6,23,.65)", backdropFilter: "blur(2px)" }} />
      <div
        data-testid={`pv2-msc-post-${post.id}`}
        style={{ position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 115, width: "min(1080px,97vw)", overflowY: "auto", borderLeft: "1px solid rgba(0,120,212,.4)", background: "#020617", boxShadow: "-28px 0 70px rgba(2,6,23,.7)" }}
      >
        <div style={{ padding: "22px 24px 48px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "16px 18px", border: "1px solid rgba(0,120,212,.28)", borderRadius: 12, background: "linear-gradient(180deg,rgba(0,120,212,.07),rgba(11,21,36,.9))" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                <button onClick={onClose} data-testid="pv2-msc-post-close" style={{ alignSelf: "flex-start", padding: 0, border: "none", background: "transparent", color: "#60a5fa", fontSize: "11px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>← Close</button>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#60a5fa", fontFamily: MONO }}>{post.id}</span>
                  <span style={{ fontSize: "17px", fontWeight: 800, color: "#f8fafc", letterSpacing: "-.01em", lineHeight: 1.3 }}>{post.title}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={pill(`${post.impact} · ${post.score}`, tone, `${tone}14`)}>{post.impact} · {post.score}</span>
                  <span style={pill(post.kind, post.hard ? "#f87171" : "#94a3b8", "rgba(148,163,184,.08)")}>{post.kind}</span>
                  <span style={pill(post.workload, WORKLOAD_TONE[post.wl], `${WORKLOAD_TONE[post.wl]}14`)}>{post.workload}</span>
                  <span style={{ fontSize: "11px", color: "#94a3b8" }}>Lands {post.when} · {post.countdown}</span>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {acts.map((a) => (
                    <button key={a.label} onClick={a.go} style={{ padding: "9px 15px", borderRadius: 7, fontSize: "12px", fontWeight: 700, fontFamily: "inherit", whiteSpace: "nowrap", cursor: "pointer", border: `1px solid ${a.border}`, background: a.bg, color: a.tone }}>{a.label}</button>
                  ))}
                </div>
                <span style={{ fontSize: "10.5px", color: "#64748b", textAlign: "right", maxWidth: "40ch", lineHeight: 1.45 }}>{actNote}</span>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, paddingTop: 11, borderTop: "1px solid rgba(30,41,59,.8)" }}>
              <Fact label="Lands" value={post.when} />
              <Fact label="Opt-out" value={post.optOut} />
              <Fact label="Scope" value={post.seats} />
              <Fact label="Roadmap" value={post.roadmapId} />
              <Fact label="Edits since publishing" value={String(post.history.length - 1)} />
              <Fact label="Licence" value={post.owned} />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "248px minmax(0,1fr)", gap: 16, alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, border: "1px solid rgba(30,41,59,.9)", borderRadius: 10, background: "#0b1524", padding: 6, position: "sticky", top: 18, overflow: "hidden" }}>
              {MSC_SECS.map((s) => {
                const on = s.key === sec;
                return (
                  <button key={s.key} onClick={() => setSec(s.key)} data-testid={`pv2-msc-sec-${s.key}`} style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left", padding: "9px 10px", border: "none", borderRadius: 7, cursor: "pointer", fontFamily: "inherit", background: on ? "rgba(0,120,212,.16)" : "transparent" }}>
                    <span style={{ flex: "0 0 auto", fontSize: "9.5px", fontWeight: 700, fontFamily: MONO, color: on ? "#93c5fd" : "#475569" }}>{s.num}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: "12px", fontWeight: on ? 700 : 500, color: on ? "#f1f5f9" : "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label}</span>
                  </button>
                );
              })}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingBottom: 10, borderBottom: "1px solid rgba(30,41,59,.9)" }}>
                <Kicker colour="#60a5fa">Section {secDef.num}</Kicker>
                <span style={{ fontSize: "15.5px", fontWeight: 700, color: "#f8fafc", letterSpacing: "-.01em" }}>{secDef.label}</span>
                <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.55, maxWidth: "80ch", textWrap: "pretty" }}>{secDef.intro}</span>
              </div>

              {sec === "ms" && (
                <>
                  <div style={BLOCK_WRAP}>
                    <BlockHead head="As published by Microsoft" hint={`${post.id} · ${post.roadmapId}`} />
                    <Prose text={post.ms} css={proseCss({ fontSize: "12.5px", color: "#cbd5e1", lineHeight: 1.75, fontFamily: "Georgia,serif" })} />
                  </div>
                  <div style={BLOCK_WRAP}>
                    <BlockHead head="Why it is kept verbatim" />
                    <Prose text="Because Microsoft edits these after publication and the edit is often the part that matters. This is the text as it stands today; section 10 lists every change made to it since it was first published." css={proseCss({ fontSize: "12px", color: "#94a3b8", lineHeight: 1.65 })} />
                  </div>
                </>
              )}

              {sec === "plain" && (
                <div style={BLOCK_WRAP}>
                  <BlockHead head="In plain terms" />
                  <Prose text={post.plain} css={proseCss({ fontSize: "13.5px", color: "#e2e8f0", lineHeight: 1.75 })} />
                </div>
              )}

              {sec === "tenant" && (
                <div style={BLOCK_WRAP}>
                  <BlockHead head="Microsoft says, your tenant says" hint="Evidence, not opinion" />
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: 12 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 5, padding: "12px 13px", border: "1px solid rgba(148,163,184,.2)", borderRadius: 9, background: "rgba(2,6,23,.45)" }}>
                      <Kicker colour="#94a3b8">Microsoft says</Kicker>
                      <span style={{ fontSize: "12.5px", color: "#cbd5e1", lineHeight: 1.6, textWrap: "pretty" }}>{post.msSays}</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 5, padding: "12px 13px", border: "1px solid rgba(248,113,113,.32)", borderRadius: 9, background: "rgba(248,113,113,.05)" }}>
                      <Kicker colour="#f87171">Your tenant says</Kicker>
                      <span style={{ fontSize: "12.5px", color: "#e2e8f0", lineHeight: 1.6, textWrap: "pretty" }}>{post.youSay}</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                    {post.evidence.map((e) => (
                      <div key={e.q} style={{ display: "grid", gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr)", gap: 12, padding: "10px 0", borderBottom: "1px solid rgba(30,41,59,.55)", alignItems: "baseline" }}>
                        <span style={{ fontSize: "11px", color: "#93c5fd", fontFamily: MONO, lineHeight: 1.55, wordBreak: "break-all", minWidth: 0 }}>{e.q}</span>
                        <span style={{ fontSize: "12px", fontWeight: 700, lineHeight: 1.5, color: e.bad ? "#f87171" : "#34d399" }}>{e.a}</span>
                      </div>
                    ))}
                  </div>
                  <span style={{ fontSize: "10.5px", color: "#475569", lineHeight: 1.55 }}>{post.evidenceNote}</span>
                </div>
              )}

              {sec === "blast" && (
                <>
                  <div style={BLOCK_WRAP}>
                    <BlockHead head="In your tenant" />
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 13 }}>
                      <Fact label="Scope" value={post.seats} />
                      <Fact label="Impact score" value={`${post.score} of 100`} />
                      <Fact label="Licence coverage" value={post.owned} />
                      <Fact label="Workload" value={post.workload} />
                    </div>
                  </div>
                  <div style={BLOCK_WRAP}>
                    <BlockHead head="How the score is built" />
                    <Prose text="Blast radius, whether failure is silent, how reversible it is, and how much notice you have. A high score is not Microsoft being reckless — it is your configuration meeting their date." css={proseCss({ fontSize: "12px", color: "#94a3b8", lineHeight: 1.65 })} />
                  </div>
                </>
              )}

              {sec === "opt" && (
                <>
                  <div style={BLOCK_WRAP}>
                    <BlockHead head="Your choice" />
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 13 }}>
                      <Fact label="Opt-out or override" value={post.optOut} />
                      <Fact label="Deadline" value={post.when} />
                      <Fact label="Time left" value={post.countdown} />
                    </div>
                  </div>
                  <div style={BLOCK_WRAP}>
                    <BlockHead head="What that means here" />
                    <Prose text={post.optOutNote} css={proseCss({ fontSize: "12.5px", color: "#cbd5e1", lineHeight: 1.7 })} />
                  </div>
                </>
              )}

              {sec === "ignore" && (
                <div style={BLOCK_WRAP}>
                  <BlockHead head="The version where nobody reads this" />
                  <Prose text={post.ignore} css={proseCss({ fontSize: "13px", color: "#e2e8f0", lineHeight: 1.75 })} />
                </div>
              )}

              {sec === "cr" && (
                <>
                  <div style={BLOCK_WRAP}>
                    <BlockHead head={post.crCode ? "Raised" : "Suggested"} hint={post.crCode ? `${post.crCode} · ${post.crState}` : "Nothing raised yet"} />
                    <Prose text={post.crNote} css={proseCss({ fontSize: "12.5px", color: "#cbd5e1", lineHeight: 1.7 })} />
                  </div>
                  <div style={BLOCK_WRAP}>
                    <BlockHead head="Linked records" />
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {(post.crCode
                        ? [{ id: post.crCode, title: post.title, note: `Change request · ${post.crState}. Opens on the change control page with this notice attached as the reason.`, tag: post.crState, tone: "#fbbf24" }]
                        : []
                      )
                        .concat(post.controls.length ? [{ id: "Controls", title: post.controls.join(" · "), note: "Compliance controls this notice is tied to. If the notice lands, these are the controls that move.", tag: `${post.controls.length} tagged`, tone: "#2dd4bf" }] : [])
                        .map((l) => (
                          <button key={l.id} onClick={() => toast(l.id === "Controls" ? "Opens the compliance pillar filtered to these controls." : `${l.id} opens on the change control page, with ${post.id} linked as the reason it exists.`)} style={{ display: "flex", alignItems: "flex-start", gap: 11, padding: "11px 12px", border: "1px solid rgba(30,41,59,.85)", borderRadius: 9, background: "rgba(2,6,23,.45)", cursor: "pointer", fontFamily: "inherit", textAlign: "left", width: "100%" }}>
                            <span style={{ flex: "0 0 auto", fontSize: "10.5px", fontWeight: 700, color: "#93c5fd", fontFamily: MONO, padding: "2px 6px", borderRadius: 4, background: "rgba(96,165,250,.1)", border: "1px solid rgba(96,165,250,.2)" }}>{l.id}</span>
                            <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
                              <span style={{ fontSize: "12px", fontWeight: 600, color: "#e2e8f0", lineHeight: 1.45 }}>{l.title}</span>
                              <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.55, textWrap: "pretty" }}>{l.note}</span>
                            </div>
                            <span style={pill(l.tag, l.tone, `${l.tone}14`)}>{l.tag}</span>
                          </button>
                        ))}
                    </div>
                  </div>
                </>
              )}

              {sec === "phases" && (
                <div style={BLOCK_WRAP}>
                  <BlockHead head="Rollout" hint={post.roadmapId} />
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10 }}>
                    {post.phases.map((p, i) => {
                      const last = i === post.phases.length - 1;
                      return (
                        <div key={p.name} style={{ display: "flex", flexDirection: "column", gap: 4, padding: "12px 13px", border: `1px solid ${last ? `${tone}40` : "rgba(30,41,59,.9)"}`, borderRadius: 10, background: "rgba(2,6,23,.45)" }}>
                          <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: last ? tone : "#64748b" }}>{p.name}</span>
                          <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#e2e8f0" }}>{p.when}</span>
                          <span style={{ fontSize: "10.5px", color: "#64748b", lineHeight: 1.5 }}>{p.note}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {sec === "told" && (
                <>
                  <div style={BLOCK_WRAP}>
                    <BlockHead head="Who Microsoft told" />
                    <Prose text={post.toldMs} css={proseCss({ fontSize: "12.5px", color: "#cbd5e1", lineHeight: 1.7 })} />
                  </div>
                  <div style={BLOCK_WRAP}>
                    <BlockHead head="Who you told" />
                    <Prose text={post.toldYou} css={proseCss({ fontSize: "12.5px", color: "#e2e8f0", lineHeight: 1.7 })} />
                  </div>
                  <div style={BLOCK_WRAP}>
                    <BlockHead head="The gap" />
                    <Prose text="Microsoft notifies administrators. The people affected by a change are almost never administrators, which is why a notice can be delivered perfectly and still reach nobody who needed it." css={proseCss({ fontSize: "12px", color: "#94a3b8", lineHeight: 1.65 })} />
                  </div>
                </>
              )}

              {sec === "history" && (
                <>
                  <div style={BLOCK_WRAP}>
                    <BlockHead head="Every edit since publication" hint={`${post.history.length} ${post.history.length === 1 ? "entry" : "entries"}`} />
                    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                      {post.history.map((h, i) => (
                        <div key={`${h.at}-${h.what}`} style={{ display: "grid", gridTemplateColumns: "130px 14px minmax(0,1fr)", gap: 12, alignItems: "start", padding: "10px 0", borderBottom: "1px solid rgba(30,41,59,.5)" }}>
                          <span style={{ fontSize: "10.5px", color: "#64748b", fontFamily: MONO, lineHeight: 1.5 }}>{h.at}</span>
                          <span style={{ marginTop: 5, width: 7, height: 7, borderRadius: "50%", background: i === 0 ? "#64748b" : "#fbbf24" }} />
                          <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                            <span style={{ fontSize: "12px", fontWeight: 600, color: "#e2e8f0", lineHeight: 1.45 }}>{h.what}</span>
                            <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.55, textWrap: "pretty" }}>{h.detail}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={BLOCK_WRAP}>
                    <BlockHead head="Why this section exists" />
                    <Prose text="A Message Center post is not a document, it is a living page. Dates move, scope widens, exemptions vanish — and none of it generates a new notice. If you planned against an older version, this is where you find out." css={proseCss({ fontSize: "12px", color: "#94a3b8", lineHeight: 1.65 })} />
                  </div>
                </>
              )}

              {sec === "log" && (
                <>
                  <div style={BLOCK_WRAP}>
                    <BlockHead head="Decision log" />
                    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                      {(post.decisions.length ? post.decisions.map((d) => ({ at: d.at.split(" · ")[0], what: d.what, detail: d.at.split(" · ")[1] ? `by ${d.at.split(" · ")[1]}` : "" })) : [{ at: "No decision yet", what: "Nobody has taken a position on this notice", detail: "Reading it is not deciding. Record a position and it becomes evidence rather than a memory." }]).map((d, i) => (
                        <div key={i} style={{ display: "grid", gridTemplateColumns: "130px 14px minmax(0,1fr)", gap: 12, alignItems: "start", padding: "10px 0", borderBottom: "1px solid rgba(30,41,59,.5)" }}>
                          <span style={{ fontSize: "10.5px", color: "#64748b", fontFamily: MONO, lineHeight: 1.5 }}>{d.at}</span>
                          <span style={{ marginTop: 5, width: 7, height: 7, borderRadius: "50%", background: "#34d399" }} />
                          <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                            <span style={{ fontSize: "12px", fontWeight: 600, color: "#e2e8f0", lineHeight: 1.45 }}>{d.what}</span>
                            {d.detail && <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.55, textWrap: "pretty" }}>{d.detail}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={BLOCK_WRAP}>
                    <BlockHead head="Compliance controls" />
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {(post.controls.length ? post.controls : ["No control tagged"]).map((c) => (
                        <span key={c} style={pill(c, "#2dd4bf", "rgba(45,212,191,.1)")}>{c}</span>
                      ))}
                    </div>
                    <button onClick={onTag} style={{ alignSelf: "flex-start", padding: "7px 12px", borderRadius: 6, border: "1px solid rgba(148,163,184,.24)", background: "transparent", color: "#94a3b8", fontSize: "11px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Tag another control</button>
                  </div>
                  <div style={BLOCK_WRAP}>
                    <BlockHead head="Thread with your architect" hint={thread.length ? `${thread.length} messages` : "Nothing asked yet"} />
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {thread.map((m, i) => (
                        <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4, padding: "12px 13px", border: `1px solid ${m.mine ? "rgba(148,163,184,.2)" : "rgba(0,120,212,.28)"}`, borderRadius: 9, background: m.mine ? "rgba(2,6,23,.45)" : "rgba(0,120,212,.06)" }}>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
                            <span style={{ fontSize: "11.5px", fontWeight: 700, color: m.mine ? "#cbd5e1" : "#93c5fd" }}>{m.who}</span>
                            <span style={{ fontSize: "10px", color: "#475569" }}>{m.at}</span>
                          </div>
                          <span style={{ fontSize: "12px", color: "#cbd5e1", lineHeight: 1.6, textWrap: "pretty" }}>{m.text}</span>
                        </div>
                      ))}
                      <button onClick={onAsk} data-testid="pv2-msc-ask" style={{ alignSelf: "flex-start", padding: "8px 13px", borderRadius: 7, border: "1px solid rgba(34,211,238,.35)", background: "transparent", color: "#22d3ee", fontSize: "11.5px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Ask Shane about this notice</button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default function PortalV2MsChangesPage() {
  const [, params] = useRoute("/portal-v2/ms-changes/:wave");

  /**
   * The tenant's REAL Microsoft 365 Message Center, from
   * `GET /api/portal/message-center`. Until it lands — and if it fails — `ds` is
   * the design fixture, so the page renders rather than flickering through an
   * empty state. See `useMessageCenter.ts` for what is real in it and what stays
   * fixture.
   */
  const { dataset: ds } = useMessageCenter();

  const bands = useMemo(() => waveBands(ds.buckets), [ds]);
  const slugIndex = params?.wave ? WAVE_SLUGS.indexOf(params.wave as (typeof WAVE_SLUGS)[number]) : 0;
  const wave = clampWave(slugIndex < 0 ? 0 : slugIndex, bands);

  const [services, setServices] = useState<Services>(ALL_SERVICES);
  // Round Four: which wave tile has dropped its evidence in place, or null.
  const [waveTile, setWaveTile] = useState<string | null>(null);
  const [past, setPast] = useState<number | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [sec, setSec] = useState("ms");
  const [decided, setDecided] = useState<Record<string, string>>({});
  const [snoozed, setSnoozed] = useState<Record<string, string>>({});
  const [threadOv, setThreadOv] = useState<Record<string, { who: string; at: string; text: string; mine?: boolean }[]>>({});
  const [toast, setToast] = useState("");
  const { openForm, formElement } = useFormDrawer();

  // Selecting a live wave (which changes the URL) drops out of the retrospective.
  useEffect(() => {
    setPast(null);
  }, [wave]);

  const t = (msg: string) => setToast(msg);
  const openPost = (id: string) => {
    setOpenId(id);
    setSec("ms");
  };

  const active = useMemo(() => activeDensity(services, ds), [services, ds]);
  const selBand = bands[wave];
  const selT = useMemo(() => waveTotals(wave, services, bands, ds), [wave, services, bands, ds]);
  const tiles = useMemo(() => waveTiles(wave, services, bands, ds), [wave, services, bands, ds]);
  const notice = waveNotice(wave, ds);
  const freeze = freezeInWave(wave, bands, ds);
  const wBreaks = useMemo(() => waveBreaks(wave, services, bands, ds), [wave, services, bands, ds]);
  const wQueue = useMemo(() => waveQueue(wave, services, bands, ds), [wave, services, bands, ds]);
  const wQuiet = useMemo(() => waveQuiet(wave, services, bands, ds), [wave, services, bands, ds]);
  const wSeen = useMemo(() => seenInWave(wave, services, bands, ds), [wave, services, bands, ds]);
  const raci = useMemo(() => raciRows(services, ds), [services, ds]);
  const pastData = past !== null ? pastWave(past, ds) : null;

  const openPostObj = openId ? ds.posts.find((p) => p.id === openId) ?? null : null;
  const thread = openPostObj ? [...openPostObj.thread, ...(threadOv[openPostObj.id] ?? [])] : [];

  // Round Four: the evidence a wave tile drops in place. Built from the same
  // wave sets the sections below render, so the tile and the section never
  // disagree. `changes` is every written-up notice; the other three are the
  // per-kind sets. Prototype `wDrill.rows` (Microsoft Changes.dc.html 1957-1968).
  const waveTileRows = (key: string): WaveDrillRow[] => {
    if (key === "breaks") return wBreaks.map((b) => ({ id: b.id, title: b.what, why: b.evidence, meta: b.state, metaTone: b.hasCr ? "#34d399" : "#fbbf24" }));
    if (key === "decide") return wQueue.map((q) => ({ id: q.item.id, title: q.item.decision, why: q.item.ifNot, meta: q.item.kind, metaTone: q.item.tone }));
    if (key === "seen") return wSeen.map((v) => ({ id: v.id, title: v.title, why: v.sees, meta: v.app, metaTone: "#a78bfa" }));
    return [
      ...wBreaks.map((b) => ({ id: b.id, title: b.what, why: b.evidence, meta: "Breaking", metaTone: "#f87171" })),
      ...wQueue.map((q) => ({ id: q.item.id, title: q.item.decision, why: q.item.ifNot, meta: "Decide", metaTone: "#fbbf24" })),
      ...wSeen.map((v) => ({ id: v.id, title: v.title, why: v.sees, meta: "Seen", metaTone: "#a78bfa" })),
    ];
  };

  /* ── The forms ─────────────────────────────────────────────────────────── */

  const briefForm = () =>
    openForm(
      toFormSpec({
        kicker: "Board briefing",
        title: "Build a board briefing",
        intro: "One page in the language of consequences rather than product names. What Microsoft is doing to this tenant, what being ready costs, and what happens if nothing is done.",
        submitLabel: "Build it",
        fields: [
          { k: "period", label: "Period", kind: "pick", value: "Next quarter", options: ["Next 30 days", "Next quarter", "Next twelve months"] },
          { k: "tone2", label: "Register", kind: "pick", value: "Plain English, no product names", options: ["Plain English, no product names", "Technical, for your IT team"] },
          { k: "include", label: "Include", kind: "toggle", value: "In use", toggleLabel: "Include what it costs to be ready, and what doing nothing costs" },
        ],
        doneNote: "Briefing built — four notices, three decisions, one reversal, with the cost of readiness against the cost of doing nothing.",
      }),
    );

  // Round Four: one Settings panel — digest cadence, services in scope and the
  // tenant scan, all in the single form the header's Settings button opens
  // (prototype settingsForm, Microsoft Changes.dc.html 1256-1280). It replaces
  // the former separate Digest and Services controls.
  const settingsForm = () =>
    openForm(
      toFormSpec({
        kicker: "Settings",
        title: "Digest, services and the tenant read",
        intro: `Read against your tenant, scanned ${ds.scanAt}. The digest decides who hears about a change; the services decide what this page counts at all. Turn a service off and its waves, counts and notices go with it.`,
        submitLabel: "Save settings",
        fields: [
          { k: "day", label: "Digest sent", kind: "pick", value: "Monday 07:00", options: ["Monday 07:00", "Friday 16:00", "First Monday of the month"] },
          { k: "to", label: "Recipients", kind: "text", value: "Priya Raman · IT team · Shane McCaw" },
          { k: "floor", label: "What to leave out", kind: "pick", value: "Skip no-impact unless it touches a control", options: ["Skip no-impact unless it touches a control", "Skip everything under 40", "Send everything"] },
          { k: "urgent", label: "Out of band", kind: "toggle", value: "In use", toggleLabel: "Send anything scored above 80 the day it is published" },
          ...ds.scans.map((sc) => ({ k: sc.wl, label: sc.name, kind: "toggle" as const, value: services[sc.wl] === false ? "Off" : "In use", toggleLabel: "In use", hint: `Scan found: ${sc.found}` })),
          { k: "rescan", label: "Tenant read", kind: "toggle" as const, value: "Off", toggleLabel: "Scan again when I save", hint: `Last read ${ds.scanAt}. A Graph read takes about four minutes.` },
        ],
        doneNote: "Saved. The digest goes out on the schedule you set, and every count on this page now reads against the services in use.",
        onSubmit: (v) => {
          const next: Record<string, boolean> = {};
          ds.scans.forEach((sc) => {
            next[sc.wl] = v[sc.wl] === "In use";
          });
          setServices(next);
          if (v.rescan === "In use") {
            t("Tenant scan queued — Graph read takes about four minutes. Everything on this page will re-read against the result.");
          }
        },
      }),
    );

  const briefWaveForm = () =>
    openForm(
      toFormSpec({
        kicker: `Briefing · ${selBand.wave}`,
        title: `Brief the ${selBand.wave.toLowerCase()}`,
        intro: "One page on this wave alone: what lands, what it costs to be ready, what happens if nothing is done. Written in consequences, not product names.",
        submitLabel: "Build the briefing",
        fields: [
          { k: "audience", label: "Written for", kind: "pick", value: "Board", options: ["Board", "Senior leadership", "The whole business"] },
          { k: "include", label: "Ownership", kind: "toggle", value: "In use", toggleLabel: "Name the owner against every item", hint: "Reads from the M365 RACI below." },
          { k: "note", label: "Anything to lead with", kind: "area", ph: "e.g. we are getting ahead of legacy auth deliberately" },
        ],
        doneNote: `Briefing built for the ${selBand.wave.toLowerCase()} — ${wBreaks.length} breaking, ${wQueue.length} to decide.`,
      }),
    );

  const decisionForm = (p: MsPost) =>
    openForm(
      toFormSpec({
        kicker: `Decision · ${p.id}`,
        title: `Record a decision on ${p.id}`,
        intro: "Acknowledging is a decision, not a dismissal. It records that you read it, what you chose, and why — so that in a year nobody has to guess.",
        submitLabel: "Record the decision",
        fields: [
          { k: "stance", label: "Position", kind: "pick", value: "Get ahead of it with a change request", options: ["Get ahead of it with a change request", "Let it land as Microsoft intends", "Accept the risk and record it", "Watch it — the date has moved before"] },
          { k: "why", label: "Reasoning", kind: "area", ph: "The sentence you would want in front of you if this went wrong in six months." },
          { k: "tell", label: "Who needs telling", kind: "pick", value: "IT team only", options: ["IT team only", "IT team and affected users", "Everyone with a mailbox", "Nobody yet"] },
        ],
        doneNote: `${p.id} — decision recorded. The decision, your name and the timestamp go on the notice and into the compliance evidence pack.`,
        onSubmit: (v) => setDecided((cur) => ({ ...cur, [p.id]: v.stance })),
      }),
    );

  const snoozeForm = (p: MsPost) =>
    openForm(
      toFormSpec({
        kicker: `Snooze · ${p.id}`,
        title: `Bring ${p.id} back later`,
        intro: "Snoozing is honest deferral, not deletion. It disappears from the queue and returns before the deadline, with the deadline attached.",
        submitLabel: "Snooze it",
        fields: [
          { k: "until", label: "Bring it back", kind: "pick", value: "30 days before it lands", options: ["30 days before it lands", "60 days before it lands", "At the next change review", "In one week"] },
          { k: "why", label: "Why now is not the time", kind: "area", ph: "Optional, but it is what stops the same conversation happening again in October." },
        ],
        doneNote: `${p.id} snoozed. It will be back, and the deadline will not have moved on your behalf.`,
        onSubmit: (v) => setSnoozed((cur) => ({ ...cur, [p.id]: v.until })),
      }),
    );

  const crForm = (p: MsPost) =>
    openForm(
      toFormSpec({
        kicker: `Change request · from ${p.id}`,
        title: `Get in front of ${p.id}`,
        intro: "This opens a change request on the change control page, pre-filled from the notice and linked to it, so the reason for the change survives longer than the person who raised it.",
        submitLabel: "Raise the change request",
        fields: [
          { k: "title", label: "Change title", kind: "text", value: p.title },
          { k: "window", label: "Target window", kind: "pick", value: "Next Tuesday · 21:00–23:00", options: ["Next Tuesday · 21:00–23:00", "Next Thursday · 20:00–22:00", "The week after next", "As soon as it can be approved"], hint: "Windows outside your Tue–Thu policy or inside a freeze are flagged on the change record." },
          { k: "risk", label: "Risk category", kind: "pick", value: "Medium", options: ["Low", "Medium", "High"] },
          { k: "note", label: "Anything the engineer should know", kind: "area" },
        ],
        doneNote: `Change request drafted from ${p.id}. It is linked to this notice both ways.`,
      }),
    );

  const askForm = (p: MsPost) =>
    openForm(
      toFormSpec({
        kicker: `Ask Shane · ${p.id}`,
        title: `Ask about ${p.id}`,
        intro: "Goes to your architect with the notice, your tenant evidence and the impact score attached, so the answer comes back with context rather than questions.",
        submitLabel: "Send it",
        fields: [
          { k: "q", label: "Your question", kind: "area", ph: "e.g. is there any version of this where we do nothing and are still fine?" },
          { k: "urgency", label: "When you need it", kind: "pick", value: "This week", options: ["Today", "This week", "Before the deadline", "No rush"] },
        ],
        doneNote: "Sent to Shane McCaw with the notice and your tenant evidence attached. It is on the thread on this notice.",
        onSubmit: (v) => setThreadOv((cur) => ({ ...cur, [p.id]: [...(cur[p.id] ?? []), { who: "Priya Raman", at: "just now", text: v.q, mine: true }] })),
      }),
    );

  const tagForm = (p: MsPost) =>
    openForm(
      toFormSpec({
        kicker: "Compliance",
        title: `Tag a control on ${p.id}`,
        intro: "Tagging a notice to a control means the control shows this notice as a reason it might move — which is the question an auditor actually asks.",
        submitLabel: "Tag it",
        fields: [
          { k: "control", label: "Control", kind: "select", value: "ISO 27001 A.9.4.2", options: ["ISO 27001 A.9.4.2", "ISO 27001 A.13.1.3", "Cyber Essentials Plus · authentication", "Cyber Essentials Plus · admin access", "Copilot readiness gate", "CMP-011 · external access"] },
          { k: "note", label: "How this notice affects it", kind: "area" },
        ],
        doneNote: `${p.id} tagged. The control now lists this notice as a reason it may move.`,
      }),
    );


  const tellForm = (name: string, items: readonly string[]) =>
    openForm(
      toFormSpec({
        kicker: "Tell them",
        title: `Notify ${name}`,
        intro: "Microsoft told your administrators. These are the people who actually feel it. This sends what changes, when, and what they should do differently.",
        submitLabel: "Send the notice",
        fields: [
          { k: "when", label: "When", kind: "pick", value: "Now", options: ["Now", "Two weeks before the date", "At the next team meeting"] },
          { k: "channel", label: "How", kind: "pick", value: "Email", options: ["Email", "Teams message", "Email and their manager"] },
          { k: "extra", label: "Anything to add", kind: "area", ph: "The generated notice already says what changes and when. This is for anything local — a handover, a shift pattern, a name to ask for." },
        ],
        doneNote: `${name} will be told. It is on the record against ${items.join(" and ")}.`,
      }),
    );

  return (
    <PortalV2Shell eyebrow="Reference" title="Microsoft Changes">
      <div style={{ minHeight: "100%", background: SIDEBAR_WASH }}>
        <div style={{ maxWidth: 1180, margin: "0 auto", padding: "26px 28px 110px", display: "flex", flexDirection: "column", gap: 16, boxSizing: "border-box" }}>
          {/* Header — prototype 31-41 */}
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20, flexWrap: "wrap", paddingBottom: 13, borderBottom: "1px solid rgba(30,41,59,.9)" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
              <span style={{ fontSize: "19px", fontWeight: 800, color: "#f8fafc", letterSpacing: "-.015em" }} data-testid="pv2-page-title">Microsoft Changes</span>
              <span style={{ fontSize: "12.5px", color: "#94a3b8", lineHeight: 1.5 }}>Microsoft ships in waves. Pick a wave and this page becomes that wave.</span>
            </div>
            {/* Round Four: two controls only — Export briefing + a single
                Settings panel (digest cadence, services in scope, tenant scan).
                The design merged the former Digest / Services / Scan controls
                into one form. */}
            <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
              <button onClick={briefForm} data-testid="pv2-msc-brief" style={HEADER_BTN(true)}>Export a board briefing</button>
              <button onClick={settingsForm} data-testid="pv2-msc-settings" style={HEADER_BTN(false)}>{settingsLabel(services)}</button>
            </div>
          </div>

          {/*
            Round Four removed the six duplicate stat cards — the same counts now
            read from the wave sub-nav in the left rail. The "Read against your
            tenant · scanned {date}" line and the tenant re-scan both moved into
            the single Settings panel (see settingsForm), so the page top goes
            straight from the header to the landed-wave nav and the wave itself.
          */}

          {/* Landed waves — the way into the retrospective — prototype pastNav 2087-2094 */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: "#475569", paddingRight: 2 }}>Landed</span>
            {ds.landed.map((w, i) => {
              const on = past === i;
              return (
                <button key={w.name} onClick={() => { setPast(i); setWaveTile(null); }} data-testid={`pv2-msc-pastnav-${i}`} style={{ display: "flex", flexDirection: "column", gap: 2, padding: "8px 12px", borderRadius: 9, cursor: "pointer", fontFamily: "inherit", textAlign: "left", border: `1px solid ${on ? "rgba(148,163,184,.4)" : "rgba(30,41,59,.9)"}`, borderLeft: `3px solid ${on ? "#94a3b8" : "rgba(148,163,184,.18)"}`, background: on ? "rgba(148,163,184,.08)" : "#0b1524" }}>
                  <span style={{ fontSize: "12px", fontWeight: on ? 800 : 600, color: on ? "#e2e8f0" : "#94a3b8" }}>{w.name}</span>
                  <span style={{ fontSize: "10px", fontWeight: 600, color: w.tone === "#f87171" ? "#f87171" : "#34d399" }}>{w.verdict}</span>
                </button>
              );
            })}
            {past !== null && (
              <button onClick={() => setPast(null)} style={{ padding: "8px 12px", borderRadius: 9, border: "1px solid rgba(0,120,212,.4)", background: "rgba(0,120,212,.1)", color: "#93c5fd", fontSize: "11px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Back to the live wave</button>
            )}
          </div>

          {/* ── The retrospective — prototype 60-97 ─────────────────────────── */}
          {pastData && (
            <div data-testid="pv2-msc-past" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 13, padding: "17px 19px", border: "1px solid rgba(148,163,184,.28)", borderRadius: 13, background: "linear-gradient(135deg,rgba(148,163,184,.08),rgba(11,21,36,.9))" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: "22px", fontWeight: 800, color: "#f8fafc", letterSpacing: "-.02em" }}>{pastData.name}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 999, fontSize: "10.5px", fontWeight: 700, whiteSpace: "nowrap", color: pastData.tone, background: `${pastData.tone}1f`, border: `1px solid ${pastData.tone}55` }}>{pastData.verdict}</span>
                  <span style={{ marginLeft: "auto", fontSize: "12px", fontWeight: 600, color: "#94a3b8", whiteSpace: "nowrap" }}>{pastData.range}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 9 }}>
                  {pastData.tiles.map((t2) => (
                    <div key={t2.label} style={{ display: "flex", flexDirection: "column", gap: 2, padding: "11px 13px", borderRadius: 9, border: `1px solid ${t2.tone}2e`, borderLeft: `3px solid ${t2.tone}`, background: "rgba(2,6,23,.5)" }}>
                      <span style={{ fontSize: "22px", fontWeight: 800, letterSpacing: "-.02em", lineHeight: 1.05, color: t2.tone }}>{t2.value}</span>
                      <span style={{ fontSize: "10.5px", fontWeight: 600, color: "#94a3b8", lineHeight: 1.4 }}>{t2.label}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 9, padding: "15px 17px", border: "1px solid rgba(30,41,59,.9)", borderRadius: 13, background: "#0b1524" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <Kicker colour="#94a3b8">Did this release?</Kicker>
                  <span style={{ fontSize: "11px", color: "#64748b" }}>What actually arrived, and what it cost the help desk</span>
                </div>
                <div style={{ overflowX: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
                  {pastData.rows.map((r) => (
                    <div key={r.id} style={{ display: "grid", gridTemplateColumns: "104px minmax(220px,1fr) 190px 150px", gap: 12, alignItems: "center", padding: "11px 13px", border: "1px solid rgba(30,41,59,.85)", borderRadius: 10, background: "rgba(2,6,23,.4)", minWidth: 700 }}>
                      <span style={{ fontSize: "9.5px", fontWeight: 700, color: "#475569", fontFamily: MONO }}>{r.id}</span>
                      <span style={{ fontSize: "12.5px", fontWeight: 600, color: "#e2e8f0", lineHeight: 1.4, minWidth: 0 }}>{r.title}</span>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                        <span style={{ fontSize: "11.5px", fontWeight: 700, color: r.tone }}>{r.outcome}</span>
                        <span style={{ fontSize: "10.5px", color: "#64748b" }}>{r.tickets}</span>
                      </div>
                      <span style={pill(r.told ? "People were told" : "Nobody was told", r.told ? "#34d399" : "#f87171", `${r.told ? "#34d399" : "#f87171"}14`)}>{r.told ? "People were told" : "Nobody was told"}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── The live wave ───────────────────────────────────────────────── */}
          {!pastData && (
            <>
              {/* Wave header card — prototype 101-130 */}
              <div data-testid="pv2-msc-wave-card" style={{ display: "flex", flexDirection: "column", gap: 13, padding: "17px 19px", border: "1px solid rgba(0,120,212,.32)", borderRadius: 13, background: "linear-gradient(135deg,rgba(0,120,212,.1),rgba(11,21,36,.9))" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: "22px", fontWeight: 800, color: "#f8fafc", letterSpacing: "-.02em" }}>{selBand.wave}</span>
                  <span style={pill(waveStatus(wave, bands, ds), wave === 0 ? "#22d3ee" : "#93c5fd", `${wave === 0 ? "#22d3ee" : "#60a5fa"}1f`)}>{waveStatus(wave, bands, ds)}</span>
                  {freeze && <span style={pill(`Lands inside your ${freeze.label.toLowerCase()} freeze`, "#f87171", "rgba(248,113,113,.12)")}>Lands inside your {freeze.label.toLowerCase()} freeze</span>}
                  <span style={{ marginLeft: "auto", fontSize: "12px", fontWeight: 600, color: "#93c5fd", whiteSpace: "nowrap" }}>{rangeOf(selBand, ds)}</span>
                  <button onClick={briefWaveForm} data-testid="pv2-msc-brief-wave" style={{ padding: "6px 12px", borderRadius: 7, fontSize: "11px", fontWeight: 700, border: "1px solid rgba(0,120,212,.5)", background: "rgba(0,120,212,.14)", color: "#93c5fd", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>Brief this wave</button>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                  <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#475569", whiteSpace: "nowrap" }}>{notice.given} days notice given</span>
                  <div style={{ flex: 1, height: 4, borderRadius: 2, background: "rgba(148,163,184,.16)", minWidth: 60 }}>
                    <div style={{ width: `${notice.pct}%`, height: "100%", borderRadius: 2, background: "linear-gradient(90deg,#0078D4,#22d3ee)" }} />
                  </div>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "#22d3ee", whiteSpace: "nowrap" }}>{notice.left} days left</span>
                </div>
                {/* Round Four: every tile is a button that drops its evidence in
                    place below the wave card — no link-out, no separate panel. */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 9 }}>
                  {tiles.map((tile) => {
                    const on = waveTile === tile.key;
                    return (
                      <button key={tile.key} onClick={() => setWaveTile((v) => (v === tile.key ? null : tile.key))} data-testid={`pv2-msc-tile-${tile.key}`} style={{ display: "flex", flexDirection: "column", gap: 2, padding: "11px 13px", borderRadius: 9, border: `1px solid ${tile.tone}${on ? "99" : "2e"}`, borderLeft: `3px solid ${tile.tone}`, background: on ? `${tile.tone}14` : "rgba(2,6,23,.5)", fontFamily: "inherit", textAlign: "left", cursor: "pointer" }}>
                        <span style={{ fontSize: "22px", fontWeight: 800, letterSpacing: "-.02em", lineHeight: 1.05, color: tile.tone }}>{tile.value}</span>
                        <span style={{ fontSize: "10.5px", fontWeight: 600, color: "#94a3b8", lineHeight: 1.4, textAlign: "left" }}>{tile.label}</span>
                        <span style={{ fontSize: "10px", fontWeight: 700, color: on ? tile.tone : "#475569", textAlign: "left" }}>{on ? "Hide the evidence" : "Show the evidence"}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* The tile's evidence, dropped in place — prototype wDrill 116-136 */}
              {waveTile &&
                (() => {
                  const meta = WT_META[waveTile] ?? WT_META.changes;
                  const rows = waveTileRows(waveTile);
                  return (
                    <div data-testid="pv2-msc-wave-drill" style={{ display: "flex", flexDirection: "column", gap: 10, padding: "15px 17px", border: `1px solid ${meta.tone}4d`, borderRadius: 13, background: `linear-gradient(150deg,${meta.tone}0d,#0b1524 55%)` }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                        <span style={{ fontSize: "9.5px", fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: meta.tone }}>{rows.length} written up · {meta.label}</span>
                        <span style={{ flex: "1 1 160px", minWidth: 0, fontSize: "11px", color: "#64748b", lineHeight: 1.5, textWrap: "pretty" }}>{meta.note}</span>
                        <button onClick={() => setWaveTile(null)} style={{ flex: "0 0 auto", border: "none", background: "transparent", color: "#64748b", fontSize: "14px", lineHeight: 1, cursor: "pointer", fontFamily: "inherit", padding: 0 }}>×</button>
                      </div>
                      {rows.length === 0 && <span style={{ fontSize: "12px", color: "#64748b", lineHeight: 1.5 }}>Nothing in this wave here.</span>}
                      {rows.length > 0 && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 0, border: "1px solid rgba(30,41,59,.9)", borderRadius: 10, overflow: "hidden" }}>
                          {rows.map((r, i) => (
                            <button
                              key={`${r.id}-${i}`}
                              onClick={() => (ds.posts.find((p) => p.id === r.id) ? openPost(r.id) : t("This notice is written up here — it has no separate detail page."))}
                              data-testid={`pv2-msc-drill-${r.id}`}
                              style={{ display: "flex", flexDirection: "column", gap: 3, padding: "11px 13px", border: "none", borderTop: i === 0 ? "none" : "1px solid rgba(30,41,59,.8)", background: "transparent", cursor: "pointer", fontFamily: "inherit", textAlign: "left", minWidth: 0 }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                                <span style={{ fontSize: "9.5px", fontWeight: 700, color: "#475569", fontFamily: MONO }}>{r.id}</span>
                                <span style={{ flex: "1 1 220px", minWidth: 0, fontSize: "12.5px", fontWeight: 600, color: "#e2e8f0", lineHeight: 1.4, textWrap: "pretty" }}>{r.title}</span>
                                <span style={{ flex: "0 0 auto", padding: "2px 8px", borderRadius: 5, border: `1px solid ${r.metaTone}4d`, color: r.metaTone, fontSize: "9.5px", fontWeight: 700, whiteSpace: "nowrap", fontFamily: MONO }}>{r.meta}</span>
                              </div>
                              <span style={{ fontSize: "11px", color: "#64748b", lineHeight: 1.55, textWrap: "pretty" }}>{r.why}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}

              {/* ── The density grid ──────────────────────────────────────────
                  The wave band keeps the prototype's scroll wrapper (165-166);
                  the ROWS below it are the fluid `repeat(11,1fr)` shape Round Two
                  de-scrolled, and carry no floor of their own. */}
              <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "16px 18px", border: "1px solid rgba(30,41,59,.9)", borderRadius: 13, background: "#0b1524" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
                  <Kicker colour="#60a5fa">The next twelve months · click a column to move</Kicker>
                  <div style={{ display: "flex", alignItems: "center", gap: 11, flexWrap: "wrap" }}>
                    {MSC_KINDS.map((k) => (
                      <div key={k.k} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ width: 7, height: 7, borderRadius: 2, background: k.tone }} />
                        <span style={{ fontSize: "10px", color: "#64748b", whiteSpace: "nowrap" }}>{k.label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ overflowX: "auto", overflowY: "hidden" }} data-testid="pv2-msc-grid">
                  <div style={{ minWidth: 900, display: "grid", gridTemplateColumns: "136px minmax(0,1fr)", gap: 0 }}>
                    <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "#475569", alignSelf: "end", padding: "0 12px 6px 2px" }}>Wave</span>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(11,minmax(0,1fr))" }}>
                      {bands.map((b, wi) => {
                        const on = wi === wave;
                        const n = waveCount(wi, active);
                        return (
                          <a
                            key={b.wave}
                            href={`/portal-v2/ms-changes${wi === 0 ? "" : `/${WAVE_SLUGS[wi]}`}`}
                            onClick={() => setPast(null)}
                            title={waveTitle(b, n)}
                            data-testid={`pv2-msc-wave-${WAVE_SLUGS[wi]}`}
                            aria-current={on ? "page" : undefined}
                            style={{ gridColumn: `${b.start + 1} / span ${b.span}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 0, margin: "0 1px 5px", padding: "5px 3px", borderRadius: 5, cursor: "pointer", fontFamily: "inherit", textDecoration: "none", border: `1px solid ${on ? "rgba(0,120,212,.75)" : "rgba(96,165,250,.22)"}`, background: on ? "rgba(0,120,212,.22)" : "rgba(96,165,250,.06)", overflow: "hidden" }}
                          >
                            <span style={{ fontSize: "9px", fontWeight: on ? 800 : 700, letterSpacing: ".03em", textTransform: "uppercase", color: on ? "#e2e8f0" : "#93c5fd", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%", lineHeight: 1.3 }}>{waveLabel(b, ds)}</span>
                            <span style={{ fontSize: "9px", fontWeight: 700, color: on ? "#93c5fd" : "#60a5fa", whiteSpace: "nowrap", lineHeight: 1.3 }}>{n}</span>
                          </a>
                        );
                      })}
                    </div>

                    <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "#475569", alignSelf: "start", padding: "6px 12px 0 2px" }}>Workload</span>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(11,minmax(0,1fr))" }}>
                      {ds.buckets.map((b, i) => (
                        <div key={`${b.label}-${b.sub}`} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0, padding: "5px 2px", borderLeft: i === 0 ? "2px solid rgba(34,211,238,.75)" : `1px solid ${isFreezeBucket(i, ds) ? "rgba(248,113,113,.4)" : "rgba(30,41,59,.6)"}`, background: b.wave === selBand.wave ? "rgba(96,165,250,.05)" : "transparent" }}>
                          {i === 0 && <span style={{ display: "inline-flex", alignItems: "center", padding: "1px 6px", marginBottom: 2, borderRadius: 999, fontSize: "8px", fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: "#022c33", background: "#22d3ee", whiteSpace: "nowrap" }}>{MSC_TODAY_LABEL}</span>}
                          <span style={{ fontSize: "9.5px", fontWeight: i === 0 ? 800 : 700, color: i === 0 ? "#22d3ee" : "#cbd5e1", whiteSpace: "nowrap" }}>{b.label}</span>
                          <span style={{ fontSize: "8.5px", fontWeight: 600, color: isFreezeBucket(i, ds) ? "#f87171" : "#475569", whiteSpace: "nowrap" }}>{isFreezeBucket(i, ds) ? MSC_FREEZE_BANDS.find((f) => f.from <= i && i < f.from + f.span)?.label ?? b.sub : b.sub}</span>
                        </div>
                      ))}
                    </div>

                    {active.map((row) => (
                      <div key={row.wl} data-testid={`pv2-msc-row-${row.wl}`} style={{ display: "grid", gridTemplateColumns: "136px minmax(0,1fr)", gap: 0, gridColumn: "1 / span 2", borderTop: "1px solid rgba(30,41,59,.6)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "0 12px 0 2px", minWidth: 0 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 2, flex: "0 0 auto", background: WORKLOAD_TONE[row.wl] }} />
                          <span style={{ flex: 1, fontSize: "11.5px", fontWeight: 600, color: "#cbd5e1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{row.name}</span>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(11,minmax(0,1fr))" }}>
                          {row.cells.map((c, i) => (
                            <div key={i} title={cellTitle(row.name, i, c, ds)} style={{ display: "flex", flexWrap: "wrap", alignContent: "center", justifyContent: "center", gap: 3, minHeight: 38, padding: "6px 5px", borderLeft: i === 0 ? "2px solid rgba(34,211,238,.5)" : `1px solid ${isFreezeBucket(i, ds) ? "rgba(248,113,113,.35)" : "rgba(30,41,59,.5)"}`, background: ds.buckets[i].wave === selBand.wave ? "rgba(96,165,250,.05)" : "transparent" }}>
                              {cellDots(c).map((k, di) => (
                                <span key={di} style={{ width: 7, height: 7, borderRadius: 2, background: KIND_TONE[k], opacity: k === "s" ? 0.85 : 1 }} />
                              ))}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* What stops working — prototype 224-253 */}
              <div data-testid="pv2-msc-breaks" style={SECTION_CARD("rgba(248,113,113,.28)")}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <Kicker colour="#f87171">What stops working</Kicker>
                  <span style={{ fontSize: "11px", color: "#64748b" }}>{breakMeta(wave, services, bands)}</span>
                </div>
                {wBreaks.map((b) => (
                  <button key={b.id} onClick={() => openPost(b.id)} data-testid={`pv2-msc-break-${b.id}`} style={{ display: "grid", gridTemplateColumns: "120px minmax(0,1fr) 190px", gap: 14, alignItems: "start", width: "100%", padding: "12px 13px", border: "1px solid rgba(248,113,113,.22)", borderRadius: 10, background: "rgba(248,113,113,.04)", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                      <span style={{ fontSize: "12.5px", fontWeight: 800, color: "#f87171", lineHeight: 1.3 }}>{b.when}</span>
                      <span style={{ fontSize: "10px", color: "#94a3b8" }}>{b.countdown}</span>
                      <span style={{ fontSize: "9.5px", fontWeight: 700, color: "#475569", fontFamily: MONO }}>{b.id}</span>
                      <span style={{ fontSize: "10px", color: "#94a3b8" }}>{b.owner}</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                      <span style={{ fontSize: "13px", fontWeight: 700, color: "#f1f5f9", lineHeight: 1.4 }}>{b.what}</span>
                      <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.55, textWrap: "pretty" }}>{b.evidence}</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 }}>
                      <span style={pill(b.state, b.hasCr ? "#34d399" : "#fbbf24", `${b.hasCr ? "#34d399" : "#fbbf24"}14`)}>{b.state}</span>
                      <span style={{ fontSize: "10.5px", color: "#64748b", whiteSpace: "nowrap" }}>Open →</span>
                    </div>
                  </button>
                ))}
                {wBreaks.length === 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 14px", border: "1px dashed rgba(52,211,153,.3)", borderRadius: 10, background: "rgba(52,211,153,.04)" }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#34d399", flex: "0 0 auto" }} />
                    <span style={{ fontSize: "12px", color: "#cbd5e1", lineHeight: 1.5 }}>Nothing in this wave stops working here.</span>
                  </div>
                )}
              </div>

              {/* Decide before it lands — prototype 255-285 */}
              <div data-testid="pv2-msc-decide" style={SECTION_CARD("rgba(251,191,36,.28)")}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <Kicker colour="#fbbf24">Decide before it lands</Kicker>
                  <span style={{ fontSize: "11px", color: "#64748b" }}>{decideMeta(wave, services, bands)}</span>
                </div>
                {wQueue.map((q) => (
                  <div key={q.item.id} data-testid={`pv2-msc-queue-${q.item.id}`} style={{ display: "grid", gridTemplateColumns: "150px minmax(0,1fr) auto", gap: 16, alignItems: "center", padding: "14px 16px", border: `1px solid ${q.item.tone}33`, borderLeft: `3px solid ${q.item.tone}`, borderRadius: 11, background: "#0b1524", minWidth: 0 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                      <span style={{ fontSize: "13px", fontWeight: 800, letterSpacing: "-.01em", color: q.item.tone }}>{q.item.due}</span>
                      <span style={pill(q.item.kind, q.item.tone, `${q.item.tone}14`)}>{q.item.kind}</span>
                      <span style={{ fontSize: "9.5px", fontWeight: 700, color: "#475569", fontFamily: MONO }}>{q.item.id}</span>
                      <span style={{ fontSize: "10px", color: "#94a3b8", lineHeight: 1.4 }}>{q.ownerLine}</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                      <span style={{ fontSize: "13px", fontWeight: 700, color: "#f1f5f9", lineHeight: 1.45 }}>{q.item.decision}</span>
                      <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.6, textWrap: "pretty" }}>{q.item.ifNot}</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: "0 0 auto" }}>
                      <button onClick={() => openPost(q.item.id)} style={{ padding: "7px 12px", borderRadius: 6, fontSize: "11px", fontWeight: 700, fontFamily: "inherit", whiteSpace: "nowrap", cursor: "pointer", border: "1px solid rgba(0,120,212,.4)", background: "rgba(0,120,212,.1)", color: "#93c5fd" }}>Open the notice</button>
                      <button onClick={() => snoozeForm(q.post)} data-testid={`pv2-msc-snooze-${q.item.id}`} style={{ padding: "7px 12px", borderRadius: 6, fontSize: "11px", fontWeight: 700, fontFamily: "inherit", whiteSpace: "nowrap", cursor: "pointer", border: "1px solid rgba(148,163,184,.24)", background: "transparent", color: "#94a3b8" }}>{snoozed[q.item.id] ? `Snoozed · ${snoozed[q.item.id]}` : "Snooze"}</button>
                      <button onClick={() => decisionForm(q.post)} data-testid={`pv2-msc-decide-${q.item.id}`} style={{ padding: "7px 12px", borderRadius: 6, fontSize: "11px", fontWeight: 700, fontFamily: "inherit", whiteSpace: "nowrap", cursor: "pointer", border: `1px solid ${decided[q.item.id] ? "rgba(52,211,153,.35)" : "rgba(251,191,36,.35)"}`, background: "transparent", color: decided[q.item.id] ? "#34d399" : "#fbbf24" }}>{decided[q.item.id] ? "Decision recorded" : "Record a decision"}</button>
                    </div>
                  </div>
                ))}
                {wQueue.length === 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 14px", border: "1px dashed rgba(148,163,184,.24)", borderRadius: 10, background: "rgba(148,163,184,.04)" }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#64748b", flex: "0 0 auto" }} />
                    <span style={{ fontSize: "12px", color: "#94a3b8", lineHeight: 1.5 }}>No decision closes in this wave. Nothing here expires while you wait.</span>
                  </div>
                )}
              </div>

              {/* Nothing to do — prototype 287-308 */}
              <div data-testid="pv2-msc-quiet" style={SECTION_CARD("rgba(30,41,59,.9)")}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <Kicker colour="#64748b">Nothing to do</Kicker>
                  <span style={{ fontSize: "11px", color: "#475569" }}>{QUIET_META}</span>
                </div>
                {wQuiet.map((n) => (
                  <button key={n.post.id} onClick={() => openPost(n.post.id)} style={{ display: "grid", gridTemplateColumns: "120px minmax(0,1fr) 150px", gap: 14, alignItems: "start", width: "100%", padding: "11px 13px", border: "1px solid rgba(30,41,59,.85)", borderRadius: 10, background: "rgba(2,6,23,.4)", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
                    <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#94a3b8" }}>{n.post.when}</span>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                      <span style={{ fontSize: "12.5px", fontWeight: 600, color: "#cbd5e1", lineHeight: 1.4 }}>{n.post.title}</span>
                      <span style={{ fontSize: "11px", color: "#64748b", lineHeight: 1.55, textWrap: "pretty" }}>{n.post.plain.split(". ")[0]}.</span>
                    </div>
                    <span style={pill(n.tag, n.tagTone, `${n.tagTone}14`)}>{n.tag}</span>
                  </button>
                ))}
                {wQuiet.length === 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", border: "1px dashed rgba(148,163,184,.2)", borderRadius: 10 }}>
                    <span style={{ fontSize: "18px", fontWeight: 800, color: "#64748b", letterSpacing: "-.02em" }}>{waveSilent(wave, services, bands)}</span>
                    <span style={{ fontSize: "11.5px", color: "#64748b", lineHeight: 1.5 }}>silent changes here, none of them written up because none of them need you</span>
                  </div>
                )}
              </div>

              {/* Who feels it — the per-group impact panel — prototype GROUPS 1637-1660 */}
              <div data-testid="pv2-msc-groups" style={SECTION_CARD("rgba(30,41,59,.9)")}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <Kicker colour="#2dd4bf">Who feels it</Kicker>
                  <span style={{ fontSize: "11px", color: "#64748b" }}>Microsoft told your administrators. These are the people who actually feel it.</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 12 }}>
                  {ds.groups.map((g, gi) => {
                    const strip = groupStrip(g.items, ds);
                    return (
                      <div key={g.name} data-testid={`pv2-msc-group-${gi}`} style={{ display: "flex", flexDirection: "column", gap: 8, padding: "15px 16px", border: `1px solid ${g.tone}30`, borderLeft: `3px solid ${g.tone}`, borderRadius: 12, background: "rgba(2,6,23,.35)", minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                          <span style={{ fontSize: "13.5px", fontWeight: 800, color: "#f8fafc" }}>{g.name}</span>
                          <span style={{ fontSize: "10.5px", color: "#64748b" }}>{g.heads}</span>
                          <span style={{ marginLeft: "auto", ...pill(g.told ? "Told" : "Not told", g.told ? "#34d399" : "#f87171", `${g.told ? "#34d399" : "#f87171"}14`) }}>{g.told ? "Told" : "Not told"}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 16 }}>
                          {strip.map((hit, i) => (
                            <span key={i} title={`${ds.buckets[i].label} ${ds.buckets[i].sub}${hit ? ` · ${hit} for this group` : " · nothing"}`} style={{ flex: 1, height: hit ? 14 : 5, borderRadius: 2, background: hit ? g.tone : "rgba(148,163,184,.13)" }} />
                          ))}
                        </div>
                        <span style={{ fontSize: "11.5px", color: "#cbd5e1", lineHeight: 1.6, textWrap: "pretty" }}>{g.what}</span>
                        <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.55, textWrap: "pretty" }}>{g.who}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={pill(`First date · ${g.first}`, g.tone, `${g.tone}14`)}>First date · {g.first}</span>
                          <span style={{ fontSize: "9.5px", color: "#64748b" }}>{groupWave(g.items, ds)}</span>
                          <span style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {g.items.map((id) => (
                              <button key={id} onClick={() => openPost(id)} style={{ padding: "3px 8px", borderRadius: 5, border: "1px solid rgba(96,165,250,.25)", background: "rgba(96,165,250,.08)", color: "#93c5fd", fontSize: "10px", fontWeight: 700, fontFamily: MONO, cursor: "pointer", whiteSpace: "nowrap" }}>{id}</button>
                            ))}
                          </span>
                        </div>
                        <button onClick={() => tellForm(g.name, g.items)} data-testid={`pv2-msc-tell-${gi}`} style={{ alignSelf: "flex-start", padding: "7px 12px", borderRadius: 6, border: `1px solid ${g.tone}55`, background: "transparent", color: g.tone, fontSize: "11px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Tell them</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {/* Ownership line — prototype 312-321 */}
          <div data-testid="pv2-msc-ownership" style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "13px 16px", border: "1px solid rgba(45,212,191,.26)", borderRadius: 13, background: "rgba(45,212,191,.05)" }}>
            <Kicker colour="#2dd4bf">Ownership</Kicker>
            <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.5, minWidth: 0 }}>Every change on this page inherits four names — responsible, accountable, consulted, informed — from its service.</span>
            <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
              {raci.slice(0, 4).map((r) => (
                <span key={r.wl} title={`${r.name} · ${r.r}`} style={pill(`${r.name.split(" &")[0].split(" ·")[0]} · ${r.r}`, r.gap ? "#f87171" : "#94a3b8", "rgba(148,163,184,.08)")}>{r.name.split(" &")[0].split(" ·")[0]} · {r.r}</span>
              ))}
            </div>
            <Link href="/portal-v2/ownership" style={{ marginLeft: "auto", fontSize: "11.5px", fontWeight: 700, color: "#2dd4bf", whiteSpace: "nowrap", textDecoration: "none" }}>Open the RACI matrix →</Link>
          </div>
        </div>
      </div>

      {openPostObj && (
        <PostDetail
          post={openPostObj}
          sec={sec}
          setSec={setSec}
          thread={thread}
          decided={decided[openPostObj.id]}
          snoozed={snoozed[openPostObj.id]}
          onCr={() => crForm(openPostObj)}
          onDecide={() => decisionForm(openPostObj)}
          onSnooze={() => snoozeForm(openPostObj)}
          onAsk={() => askForm(openPostObj)}
          onTag={() => tagForm(openPostObj)}
          toast={t}
          onClose={() => setOpenId(null)}
        />
      )}

      {formElement}

      {toast && (
        <div data-testid="pv2-msc-toast" style={{ position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", zIndex: 130, display: "flex", alignItems: "center", gap: 11, padding: "12px 17px", border: "1px solid rgba(0,120,212,.4)", borderRadius: 9, background: "#0b1a2e", boxShadow: "0 18px 40px rgba(2,6,23,.6)", maxWidth: "min(640px,92vw)" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#34d399", flex: "0 0 auto" }} />
          <span style={{ fontSize: "12px", color: "#e2e8f0", lineHeight: 1.5 }}>{toast}</span>
          <button onClick={() => setToast("")} style={{ flex: "0 0 auto", border: "none", background: "transparent", color: "#64748b", fontSize: "13px", cursor: "pointer", fontFamily: "inherit" }}>×</button>
        </div>
      )}
    </PortalV2Shell>
  );
}
