/**
 * pillar-signals.ts — turn the tenant's real observations into the pillar
 * page's "SIGNALS — WHAT WAS MEASURED" grid (Git #4578).
 *
 * Everything here is pure: it takes the specs (pillar-signal-specs.ts), the
 * tenant's real observations and the catalog facts it needs, and returns the
 * cards. No database, no clock, no fabricated value — so the branches that
 * decide what a customer reads are assertable directly (pillar-signals.test.ts).
 *
 * ── THE ONE RULE ────────────────────────────────────────────────────────────
 * An unmeasurable card renders as unmeasurable with its real reason, never as a
 * zero. A licence gap, a Microsoft service that is not set up, a check that
 * errored, a check that never ran and a check that has no single figure are
 * five different facts, and none of them is `0`. A real `0` (a check that ran
 * and found none) stays `0`.
 *
 * ── THE TIER ────────────────────────────────────────────────────────────────
 * The design's card tier (good / meh / bad / na) comes from the real
 * `tenant_monitor_profiles.severity_matched`. Checked against the live catalog
 * (build-journal/4578-plan.md, Finding 1) that is honest for the checks that
 * carry severity rules and silent for the ones that do not: `severity_matched`
 * is NULL both when rules exist and none fired (a genuine "good") and when the
 * check has no rules at all, and 68 of the 155 checks on the grid have none.
 * Those cards are `ungraded` — measured, shown, and not judged — rather than
 * painted `good` on the strength of nobody having an opinion.
 */

import { numericProp, SIGNAL_HISTORY_DEPTH, type CheckObservation } from "./pillar-check-observations.ts";
import type {
  PillarSignalIcon,
  PillarSignalSpec,
  PillarSignalGroupSpec,
  SignalValueSpec,
} from "./pillar-signal-specs.ts";

export type PillarSignalTier = "good" | "meh" | "bad" | "na" | "ungraded";

/** How the client formats `value` when `text` is null. */
export type PillarSignalFormat = "count" | "percent" | "text";

export interface PillarSignalCard {
  checkKey: string;
  label: string;
  icon: PillarSignalIcon;
  span: number;
  tier: PillarSignalTier;
  format: PillarSignalFormat;
  value: number | null;
  text: string | null;
  delta: number | null;
  history: number;
  sub?: string;
  ruleLabel?: string;
  unavailableReason?: string;
  licenseFeature?: string;
  serviceName?: string;
  collectedAt: string | null;
}

export interface PillarSignalGroup {
  title: string;
  cards: PillarSignalCard[];
}

export interface PillarSignals {
  groups: PillarSignalGroup[];
  cardCount: number;
  latestObservedAt: string | null;
  uncardedCheckCount: number;
}

/** What `resolveSeatFigures` carries that the paid-seat cards read. */
export interface SignalSeatFigures {
  provisioned: number;
  unassigned: number;
}

/** Everything about the world the pure builder needs, resolved once by the caller. */
export interface SignalContext {
  /** Newest-first stored observations per check; index 0 is the latest. */
  recent: ReadonlyMap<string, readonly CheckObservation[]>;
  /** Catalog checks that have at least one severity rule. */
  checksWithRules: ReadonlySet<string>;
  /** Catalog checks marked inactive — they can never run. */
  inactiveCheckKeys: ReadonlySet<string>;
  /** Every check key in this customer's scan packages; null when unknown. */
  scannedCheckKeys: ReadonlySet<string> | null;
  seats: SignalSeatFigures | null;
}

// ── Tier ─────────────────────────────────────────────────────────────────────

/**
 * Pure: the card tier for one check's latest observation.
 *
 *   not measured (no row, or any non-`ok` status)  → na
 *   critical | high                               → bad
 *   warning | medium | info | low                 → meh   (something fired, and it
 *                                                          is not the worst kind)
 *   nothing fired, the check HAS rules            → good
 *   nothing fired, the check has NO rules         → ungraded
 *
 * `info | low → meh` is the one judgement call: "Partially addressed" is a fair
 * reading of a fired advisory rule and "Fully covered" is not. It lives here, in
 * one place, so it can be flipped without touching anything else.
 */
export function signalTier(
  observation: CheckObservation | undefined,
  hasRules: boolean,
): PillarSignalTier {
  if (!observation || observation.status !== "ok") return "na";
  switch (observation.severity ?? null) {
    case null:
      return hasRules ? "good" : "ungraded";
    case "critical":
    case "high":
      return "bad";
    default:
      // warning, medium, info, low — and any severity vocabulary added later
      // still means "a rule fired", which is never "good".
      return "meh";
  }
}

// ── Value ────────────────────────────────────────────────────────────────────

interface ResolvedValue {
  value: number | null;
  text: string | null;
  /** Why both are null, when they are. */
  reason?: string;
}

const NEVER_EXPIRES_DAYS = 2147483647;

const fmt = (n: number): string => n.toLocaleString("en-US");

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${i === 0 ? n : n.toFixed(1)} ${units[i]}`;
}

/** Why a field a spec names is absent from a row that otherwise ran fine. */
function absentReason(props: Record<string, unknown>): string {
  // Security Defaults, not Conditional Access, is what the tenant runs: the CA
  // checks' gate legitimately skips (#4576). The honest reason is that, not a
  // generic "no data".
  if (props.securityDefaultsEnabled === true) return "security_defaults_active";
  if (props._gateSkipped === true) return "gate_skipped";
  return "no_data";
}

/**
 * Pure: read one card's headline figure off a row's real properties.
 *
 * A field that is absent, null, or the wrong type yields an unavailable result
 * with a reason — never a coerced `0`. `numericProp` refuses "" and booleans,
 * and a string that is not a number (a real check bug on
 * `sharepoint:storage-utilization` returns a domain name in a percent field)
 * is reported as `non_numeric_value` rather than shown.
 */
export function resolveSignalValue(
  spec: SignalValueSpec,
  props: Record<string, unknown>,
  seats: SignalSeatFigures | null,
): ResolvedValue {
  const none = (reason: string): ResolvedValue => ({ value: null, text: null, reason });

  switch (spec.format) {
    case "none":
      return none("no_scalar_defined");

    case "count":
    case "percent": {
      const n = numericProp(props, spec.field);
      if (n != null) return { value: n, text: null };
      return none(props[spec.field] != null && typeof props[spec.field] === "string" ? "non_numeric_value" : absentReason(props));
    }

    case "flag": {
      const raw = props[spec.field];
      if (typeof raw !== "boolean") return none(absentReason(props));
      return { value: null, text: raw ? spec.on : spec.off };
    }

    case "text": {
      const raw = props[spec.field];
      if (typeof raw !== "string" || raw.trim() === "") return none(absentReason(props));
      return { value: null, text: raw };
    }

    case "ratio": {
      const n = numericProp(props, spec.field);
      const d = numericProp(props, spec.denominatorField);
      if (n == null || d == null) return none(absentReason(props));
      return { value: n, text: `${fmt(n)} / ${fmt(d)}` };
    }

    case "days": {
      const n = numericProp(props, spec.field);
      if (n == null) return none(absentReason(props));
      return n >= NEVER_EXPIRES_DAYS ? { value: null, text: "never" } : { value: n, text: `${fmt(n)} days` };
    }

    case "bytes": {
      const n = numericProp(props, spec.field);
      if (n == null) return none(absentReason(props));
      return { value: null, text: formatBytes(n) };
    }

    case "sum": {
      const parts = spec.fields.map((f) => numericProp(props, f));
      // A partial sum would under-report while looking complete.
      if (parts.some((p) => p == null)) return none(absentReason(props));
      return { value: (parts as number[]).reduce((a, b) => a + b, 0), text: null };
    }

    case "gaps": {
      const flags = spec.fields.map((f) => props[f]);
      if (flags.some((f) => typeof f !== "boolean")) return none(absentReason(props));
      const gaps = flags.filter((f) => f === false).length;
      return { value: gaps, text: `${gaps} gap${gaps === 1 ? "" : "s"}` };
    }

    case "paidSeats": {
      if (!seats) return none("no_seat_data");
      if (spec.part === "unassigned") return { value: seats.unassigned, text: null };
      const assigned = seats.provisioned - seats.unassigned;
      return { value: assigned, text: `${fmt(assigned)} / ${fmt(seats.provisioned)}` };
    }
  }
}

// ── Card ─────────────────────────────────────────────────────────────────────

/** Pure: why a check has no usable observation, from the most specific fact available. */
export function unmeasuredReason(
  checkKey: string,
  observation: CheckObservation | undefined,
  ctx: Pick<SignalContext, "inactiveCheckKeys" | "scannedCheckKeys">,
): Pick<PillarSignalCard, "unavailableReason" | "licenseFeature" | "serviceName"> {
  if (!observation) {
    if (ctx.inactiveCheckKeys.has(checkKey)) return { unavailableReason: "inactive_in_catalog" };
    if (ctx.scannedCheckKeys && ctx.scannedCheckKeys.size > 0 && !ctx.scannedCheckKeys.has(checkKey)) {
      return { unavailableReason: "not_in_scan_package" };
    }
    return { unavailableReason: "never_run" };
  }
  switch (observation.status) {
    case "license_gap":
      return {
        unavailableReason: "license_gap",
        ...(observation.licenseFeature ? { licenseFeature: observation.licenseFeature } : {}),
      };
    case "service_not_configured":
      return {
        unavailableReason: "service_not_configured",
        ...(observation.serviceName ? { serviceName: observation.serviceName } : {}),
      };
    case "error":
      return { unavailableReason: "check_error" };
    default:
      return { unavailableReason: "no_data" };
  }
}

function wireFormat(spec: SignalValueSpec, text: string | null): PillarSignalFormat {
  if (text != null) return "text";
  return spec.format === "percent" ? "percent" : "count";
}

/** Rounds away float noise so a delta of 0.1 + 0.2 - 0.3 never reads as a change. */
function delta(now: number | null, before: number | null): number | null {
  if (now == null || before == null) return null;
  return Math.round((now - before) * 1000) / 1000;
}

/** Pure: one card from one spec and the tenant's real observations. */
export function buildSignalCard(spec: PillarSignalSpec, ctx: SignalContext): PillarSignalCard {
  const history = ctx.recent.get(spec.checkKey) ?? [];
  const latest = history[0];
  const base = {
    checkKey: spec.checkKey,
    label: spec.label,
    icon: spec.icon,
    span: spec.span,
    history: Math.min(history.length, SIGNAL_HISTORY_DEPTH),
    collectedAt: latest?.collectedAt ?? null,
  };

  const measured = latest?.status === "ok";
  const resolved: ResolvedValue = measured
    ? resolveSignalValue(spec.value, latest.props, ctx.seats)
    : { value: null, text: null };

  // A measured row that still yields nothing (field absent, no scalar defined…)
  // is unmeasurable for the reason `resolveSignalValue` gave; an unmeasured row
  // is unmeasurable for the reason of its status.
  if (!measured || (resolved.value == null && resolved.text == null)) {
    const why = measured
      ? { unavailableReason: resolved.reason ?? "no_data" }
      : unmeasuredReason(spec.checkKey, latest, ctx);
    return {
      ...base,
      tier: "na",
      format: "count",
      value: null,
      text: null,
      delta: null,
      ...why,
    };
  }

  // Previous stored observation, read with the SAME explicit field as the value.
  const previous = history[1];
  const before =
    previous?.status === "ok" && spec.value.format !== "paidSeats"
      ? resolveSignalValue(spec.value, previous.props, ctx.seats).value
      : null;

  let sub: string | undefined;
  if (latest.props.securityDefaultsEnabled === true) {
    // #4576 — the reason a CA count is a real 0 here.
    sub = "This tenant uses Security Defaults instead of Conditional Access";
  } else if (spec.subDenominator) {
    const denominator = numericProp(latest.props, spec.subDenominator.field);
    // A caption reading "of — teams" is worse than none.
    if (denominator != null) sub = spec.subDenominator.template.replace("{value}", fmt(denominator));
  } else if (spec.sub) {
    sub = spec.sub;
  }

  const tier = signalTier(latest, ctx.checksWithRules.has(spec.checkKey));
  return {
    ...base,
    tier,
    format: wireFormat(spec.value, resolved.text),
    value: resolved.value,
    text: resolved.text,
    delta: delta(resolved.value, before),
    ...(sub ? { sub } : {}),
    ...((tier === "bad" || tier === "meh") && latest.severityLabel ? { ruleLabel: latest.severityLabel } : {}),
  };
}

/**
 * Pure: the whole grid for one pillar.
 *
 * `uncardedCheckCount` is the number of this pillar's catalog checks that the
 * design's grid does not show — the design's own "+ N more checks feed…" line —
 * computed from the SAME `checkKeyPillars` resolution the score uses.
 */
export function buildPillarSignals<P extends string>(
  pillar: P,
  groupSpecs: readonly PillarSignalGroupSpec[],
  checkKeyPillars: Readonly<Record<string, P>>,
  ctx: SignalContext,
): PillarSignals {
  const groups = groupSpecs.map((group) => ({
    title: group.title,
    cards: group.cards.map((spec) => buildSignalCard(spec, ctx)),
  }));

  const shown = new Set(groupSpecs.flatMap((g) => g.cards.map((c) => c.checkKey)));
  const uncardedCheckCount = Object.entries(checkKeyPillars).filter(
    ([checkKey, p]) => p === pillar && !shown.has(checkKey),
  ).length;

  let latestObservedAt: string | null = null;
  for (const group of groups) {
    for (const card of group.cards) {
      if (card.collectedAt && (!latestObservedAt || card.collectedAt > latestObservedAt)) {
        latestObservedAt = card.collectedAt;
      }
    }
  }

  return {
    groups,
    cardCount: groups.reduce((n, g) => n + g.cards.length, 0),
    latestObservedAt,
    uncardedCheckCount,
  };
}
