/**
 * Pure derivation for the home "room" — the parts of the Claude Design export's
 * `renderVals()` that are just data → view-model, with no DOM and no React.
 *
 * Kept separate from the components so the transcript styling (which is entirely
 * computed, per-speaker, in the export) stays readable and testable.
 */

import type { CSSProperties } from "react";
import {
  CAST,
  IND,
  PROBLEMS,
  READINESS,
  type CastMember,
  type IndustryDef,
  type Persona,
  type PillarId,
  type ProblemKey,
} from "./roomData";

export type MessageKind = "text" | "sim" | "sites";

export interface SimPara {
  key: string;
  t: string;
}
export interface SimRef {
  key: string;
  n: string;
  t: string;
}
export interface SiteRowView {
  key: string;
  url: string;
  tag: string;
  files: string;
  tagStyle: CSSProperties;
}
export interface ChainStep {
  key: string;
  n: string;
  k: string;
  d: string;
}

export interface RoomMessage {
  key: string;
  initials: string;
  name: string;
  role: string;
  text: string;
  kind: MessageKind;
  row: CSSProperties;
  stack: CSSProperties;
  metaRow: CSSProperties;
  avatar: CSSProperties;
  nameStyle: CSSProperties;
  roleStyle: CSSProperties;
  bubble: CSSProperties;
  /** sim-card payload */
  prompt?: string;
  paras?: SimPara[];
  refs?: SimRef[];
  warn?: string;
  /** sites-card payload */
  query?: string;
  sites?: SiteRowView[];
  chain?: ChainStep[];
}

/** Classifies free text into one of the five blocker profiles. */
export function classify(text: string): ProblemKey {
  const low = (text || "").toLowerCase();
  if (/(licen|seat|cost|spend|budget|waste|money|roi|invoice|renew)/.test(low)) return "waste";
  if (/(retention|complian|legal|regulat|residen|dlp|audit|subpoena|hipaa|gdpr|record|ediscover)/.test(low))
    return "evidence";
  if (/(adopt|nobody|unused|training|useless|wrong answer|ignor|trust|stopped)/.test(low)) return "adoption";
  if (/(sign.?off|approve|security|risk|blast|mfa|breach|ciso|permission)/.test(low)) return "signoff";
  return "sprawl";
}

export function getIndustry(name: string): IndustryDef {
  return IND[name] ?? IND["Space & aerospace"];
}

export function getProblem(key: ProblemKey) {
  return PROBLEMS.find((p) => p.key === key) ?? PROBLEMS[0];
}

/**
 * Resolves a speaker id against the seated roster.
 *
 * `beth` and `alex` are the export's stand-ins from before personas were dynamic:
 * they resolve to roster slots 3 and 1. The roster is capped at three, so slot 3
 * never exists and `beth` always lands on roster[0] — the export's own behaviour,
 * reproduced rather than "corrected", because the compliance and copilot pillars
 * are written for whoever is actually in the room.
 */
export function resolveSpeaker(who: string, roster: Persona[]): CastMember {
  let id = who;
  if (who === "beth" || who === "alex") {
    const slot = who === "beth" ? 3 : 1;
    id = (roster[slot] ?? roster[0] ?? CAST.shane).id;
  }
  return (CAST as Record<string, CastMember>)[id] ?? roster.find((x) => x.id === id) ?? CAST.shane;
}

/**
 * Builds one transcript row. Ported verbatim from the export's `msg()`:
 * Shane and Kira hold the left with a coloured left rail; everyone who does the
 * work answers from the right; "you" gets the neutral slate treatment.
 */
export function buildMessage(who: string, text: string, roster: Persona[]): RoomMessage {
  const c = resolveSpeaker(who, roster);
  const id = c.id;
  const me = who === "you" || id === "you";
  const hue = id === "shane" ? "#67E8F9" : id === "kira" ? "#8B5CF6" : c.color;
  const host = id === "shane" || id === "kira";
  const right = !host;

  return {
    key: `${who}|${text.slice(0, 24)}`,
    initials: c.initials,
    name: c.name,
    role: c.role,
    text,
    kind: "text",
    row: {
      display: "flex",
      gap: 12,
      alignItems: "flex-start",
      maxWidth: host ? "100%" : "min(600px,92%)",
      flexDirection: right ? "row-reverse" : "row",
      alignSelf: right ? "flex-end" : "flex-start",
    },
    stack: {
      minWidth: 0,
      flex: 1,
      display: "flex",
      flexDirection: "column",
      gap: 6,
      alignItems: host ? "stretch" : "flex-end",
    },
    metaRow: {
      display: "flex",
      alignItems: "baseline",
      gap: 8,
      flexWrap: "wrap",
      flexDirection: right ? "row-reverse" : "row",
    },
    avatar: {
      width: 34,
      height: 34,
      flex: "0 0 34px",
      borderRadius: 12,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: me ? 8.5 : 9,
      fontWeight: 800,
      color: me ? "#cbd5e1" : "#f8fafc",
      background: c.tile,
      border: `1px solid ${me ? c.bd : `${c.color}8c`}`,
      boxShadow: me ? "none" : `0 0 16px ${c.color}40`,
    },
    nameStyle: {
      fontSize: 10,
      fontWeight: 800,
      letterSpacing: ".14em",
      textTransform: "uppercase",
      color: me ? c.color : hue,
    },
    roleStyle: {
      fontSize: 9.5,
      fontWeight: 700,
      letterSpacing: ".1em",
      textTransform: "uppercase",
      color: "#94a3b8",
    },
    bubble: {
      padding: "15px 16px",
      fontSize: 13.5,
      lineHeight: 1.6,
      textWrap: "pretty",
      backdropFilter: "blur(16px)",
      borderRadius: right ? "18px 18px 5px 18px" : "18px 18px 18px 5px",
      textAlign: "left",
      alignSelf: right ? "flex-end" : "stretch",
      color: "#e2e8f0",
      background: me
        ? "linear-gradient(115deg, rgba(148,163,184,.2), rgba(20,14,44,.7) 78%)"
        : id === "shane"
          ? "linear-gradient(115deg, rgba(59,130,246,.24), rgba(139,92,246,.22) 40%, rgba(103,232,249,.18) 76%, rgba(20,14,44,.62))"
          : id === "kira"
            ? "linear-gradient(115deg, rgba(139,92,246,.34), rgba(167,139,250,.16) 48%, rgba(20,14,44,.68) 84%)"
            : `linear-gradient(115deg, ${hue}33, ${hue}14 46%, rgba(20,14,44,.66) 82%)`,
      border: `1.5px solid ${me ? "rgba(148,163,184,.4)" : `${hue}b3`}`,
      ...(host ? { borderLeft: `3px solid ${hue}` } : null),
      ...(right && !me ? { borderRight: `3px solid ${hue}` } : null),
      animation: "smcr-slidein 380ms cubic-bezier(.22,1,.36,1) both",
      boxShadow: me
        ? "0 10px 26px rgba(10,6,24,.4)"
        : `0 0 0 1px ${hue}33, 0 0 22px ${hue}4d, 0 14px 38px rgba(10,6,24,.5), inset 0 0 46px ${hue}1a`,
    },
  };
}

/** Wraps buildMessage for the two rich card kinds (the Copilot simulation and the site sweep). */
export function buildCard(
  who: string,
  kind: Exclude<MessageKind, "text">,
  roster: Persona[],
  data: Partial<RoomMessage>,
): RoomMessage {
  const m = buildMessage(who, data.text ?? "", roster);
  return {
    ...m,
    ...data,
    key: `${who}|${kind}|${(data.text ?? "").slice(0, 12)}`,
    kind,
    stack: { ...m.stack, width: "100%", maxWidth: "100%" },
    row: { ...m.row, maxWidth: "min(660px,100%)" },
  };
}

/** Colour-codes a share tag by how far outside the org it reaches. */
export function siteTagStyle(tag: string): CSSProperties {
  const anyone = tag.indexOf("Anyone") === 0;
  const guest = tag.indexOf("Guest") === 0;
  const color = anyone ? "#F87171" : guest ? "#FBBF24" : "#A78BFA";
  const bg = anyone ? "rgba(248,113,113,.14)" : guest ? "rgba(251,191,36,.14)" : "rgba(167,139,250,.14)";
  const bd = anyone ? "rgba(248,113,113,.34)" : guest ? "rgba(251,191,36,.34)" : "rgba(167,139,250,.34)";
  return {
    padding: "3px 8px",
    borderRadius: 6,
    fontSize: 8.5,
    fontWeight: 800,
    letterSpacing: ".06em",
    whiteSpace: "nowrap",
    color,
    background: bg,
    border: `1px solid ${bd}`,
  };
}

export const TOTAL_CHECKS = (Object.keys(READINESS) as PillarId[]).reduce(
  (n, k) => n + READINESS[k].length,
  0,
);

/**
 * Indicative score: the answered checks as a share of every check's top mark, so a
 * single strong answer can never read as a perfect score while nine are outstanding.
 */
export function computeScore(checks: Record<string, number>): number {
  const answered = Object.keys(checks);
  if (answered.length === 0) return 0;
  const earned = answered.reduce((n, k) => n + checks[k], 0);
  return Math.round((earned / (TOTAL_CHECKS * 10)) * 100);
}

export type Posture = "weak" | "mixed" | "strong" | null;

export function pillarPosture(id: PillarId, checks: Record<string, number>): Posture {
  const qs = READINESS[id] ?? [];
  const done = qs.filter((q) => checks[q.id] !== undefined);
  if (!done.length) return null;
  const avg = done.reduce((n, q) => n + checks[q.id], 0) / done.length;
  return avg < 4 ? "weak" : avg < 7.5 ? "mixed" : "strong";
}

/** "1 cluster" / "3 clusters" */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Formats integer cents the way the rest of the site formats catalog prices. */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}
