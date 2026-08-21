/**
 * holdAlerts.ts — the hold-window fixtures the alerts tray and the palette read,
 * derived through the shared `holdState` machine so the states, tones and
 * T-minus labels match Active Runbooks exactly.
 *
 * README §"Hold windows (runbook timers)": a window is reported in three places
 * from one source — the Hold windows panel on Active Runbooks, a band inside
 * each runbook card, and "a Hold windows section in the alerts tray that lists
 * only windows needing a decision." This module is that one source for the two
 * shell surfaces (tray section + palette rows). `HOLD_NOW` is the prototype's
 * fixed clock (shell 8580); the README's "use the real clock and re-derive on an
 * interval" is a wiring concern for the later pass, so the states here are
 * exactly the design's: one due, one closing, one clear-early, one still
 * running.
 */

// Relative import (not the `@/` alias) so `npm test` — Node's runner via
// `tsx --test`, which does not read the tsconfig path alias — resolves it
// transitively through the palette index.
import {
  deriveHoldClock,
  HOLD_TONE,
  type HoldScanVerdict,
} from "../holds/holdState";

/** The prototype's fixed clock — shell 8580. */
export const HOLD_NOW = new Date("2026-08-18T09:00:00Z");

const MS_PER_DAY = 86_400_000;

export interface HoldDef {
  readonly id: string;
  readonly runbook: string;
  readonly title: string;
  readonly gates: string;
  readonly startedAt: string;
  readonly waitDays: number;
  readonly scanVerdict: HoldScanVerdict;
  readonly scanLine: string;
}

/** `HOLD_DEFS` — shell 8581-8614 (the fields the shell surfaces read). */
export const HOLD_DEFS: readonly HoldDef[] = [
  {
    id: "hold-ca01",
    runbook: "sec-legacy-auth",
    title: "CA01 in report-only — 7 day observation window",
    gates: "Gates step 4 — enforce CA01 and block legacy authentication",
    startedAt: "2026-08-11T08:00:00Z",
    waitDays: 7,
    scanVerdict: "signals",
    scanLine:
      "2 sign-ins would have been blocked in the last 24 hours, both from the SMTP relay service account. Enforcing today breaks scan-to-email.",
  },
  {
    id: "hold-guest",
    runbook: "gov-manage-guests",
    title: "Guest owner confirmation — 14 day window",
    gates: "Gates step 5 — remove the guests nobody confirmed",
    startedAt: "2026-08-13T10:00:00Z",
    waitDays: 14,
    scanVerdict: "clear",
    scanLine:
      "No sign-in, no file access and no Teams activity from any of the 31 unconfirmed guests in 5 days. All 3 owners who intended to respond have responded.",
  },
  {
    id: "hold-admins",
    runbook: "gov-reduce-admins",
    title: "Site admin notice period — 7 days",
    gates: "Gates step 4 — remove all but the 2 retained admins",
    startedAt: "2026-08-12T06:00:00Z",
    waitDays: 7,
    scanVerdict: "watch",
    scanLine:
      "1 of the 9 admins being removed opened site settings yesterday. Worth a word before the window closes tomorrow morning.",
  },
  {
    id: "hold-private",
    runbook: "gov-convert-private",
    title: "Owner notice — 30 days before automatic conversion",
    gates: "Gates step 5 — convert the site to Private automatically",
    startedAt: "2026-08-11T09:00:00Z",
    waitDays: 30,
    scanVerdict: "watch",
    scanLine:
      "No owner response yet. 14 tenant members opened the site in the last week, so the conversion will be noticed when it happens.",
  },
];

function closesAtOf(h: HoldDef): string {
  return new Date(new Date(h.startedAt).getTime() + h.waitDays * MS_PER_DAY).toISOString();
}

export interface HoldAlertItem {
  readonly id: string;
  readonly t: string;
  readonly title: string;
  readonly why: string;
  readonly btnLabel: string;
  readonly tone: string;
  /** The design's primary action runs on Active Runbooks; deep-link there. */
  readonly href: string;
}

/**
 * The hold-window rows the alerts tray shows — shell 8716-8725. Only windows
 * that need a DECISION appear (state !== 'running'); a window quietly running
 * its clock is not an alert.
 */
export function deriveHoldAlertItems(now: Date): readonly HoldAlertItem[] {
  return HOLD_DEFS.map((h) => ({
    h,
    clock: deriveHoldClock({ closesAt: closesAtOf(h), scanVerdict: h.scanVerdict }, now),
  }))
    .filter(({ clock }) => clock.state !== "running")
    .map(({ h, clock }) => ({
      id: h.id,
      t:
        clock.state === "due"
          ? "T-0 · decision due now"
          : clock.state === "closing"
            ? `${clock.tMinus} · closes tomorrow`
            : `Clear early · ${clock.daysLeft} days of waiting left`,
      title: h.title,
      why: clock.state === "early" ? h.scanLine : h.gates,
      btnLabel: clock.state === "due" ? "Decide" : clock.state === "early" ? "Close early" : "Review",
      tone: HOLD_TONE[clock.state],
      href: "/portal-v2/runbooks",
    }));
}

export interface HoldPaletteRow {
  readonly id: string;
  readonly title: string;
  readonly sub: string;
  readonly tone: string;
}

/**
 * Every hold window, as a palette index row — shell 19124:
 * `pushIdx('Hold window', h.title, h.badge + ' · ' + h.gates, …, h.tone)`.
 * Unlike the tray, the palette indexes the running windows too.
 */
export function deriveHoldPaletteRows(now: Date): readonly HoldPaletteRow[] {
  return HOLD_DEFS.map((h) => {
    const clock = deriveHoldClock({ closesAt: closesAtOf(h), scanVerdict: h.scanVerdict }, now);
    return { id: h.id, title: h.title, sub: `${clock.badge} · ${h.gates}`, tone: clock.tone };
  });
}

/** The tray rows at the fixed prototype clock — the tray's default content. */
export const HOLD_ALERT_ITEMS: readonly HoldAlertItem[] = deriveHoldAlertItems(HOLD_NOW);
