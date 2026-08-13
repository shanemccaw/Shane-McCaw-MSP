/**
 * warRoomSections.ts — the War Room's named stops and how each one resolves onto
 * the briefing's own beat machine (#303, parent epic #302).
 *
 * The War Room already had exactly one way to move to a named position: the
 * transport jump-menu, which resolved a key ("governance", "sow", …) to a
 * `SCRIPT` index and called `jumpTo(i)` — or, for the stops with no scripted
 * beat, opened the dive panel directly. That resolution lived inline inside
 * `renderVals()`, so nothing outside the render pass could reach it.
 *
 * It moves here verbatim — same target list, same three lookup rules, same
 * liveness test, same branch order — so that the URL restore path and the
 * jump-menu are the *same* mechanism rather than two that can drift apart.
 * `WarRoomLogic` now renders the menu from this list and restores from a URL
 * through the same `resolveWarRoomSection()`.
 *
 * Deliberately section-level, not per-beat: these 13 stops are the positions
 * the experience already treats as meaningfully distinct. Per-beat URLs would
 * mean minting a stable id for all ~200 `SCRIPT` entries, which is a data
 * change, and the issue explicitly scopes this to section granularity first.
 *
 * This file is typed and checked (the ported `WarRoomLogic`/`warRoomData` are
 * `@ts-nocheck` and stay that way) — the routing logic is new code, not ported
 * design source, so it carries real types and real tests.
 */
// Explicit .ts extension, matching quizCatalogClient.ts: it is what lets this
// module load under `node --test` as well as under Vite.
import { SCRIPT } from "./data/warRoomData.ts";

/** The URL prefix these sections hang off. */
export const WAR_ROOM_BASE_PATH = "/war-room";

/**
 * The wouter route pattern App.tsx registers. Optional param, so bare
 * `/war-room` and every named stop are served by one route — see the route's
 * own comment for why that matters here. Exported so the routing test asserts
 * against the pattern that actually ships, not a copy of it.
 */
export const WAR_ROOM_ROUTE_PATTERN = `${WAR_ROOM_BASE_PATH}/:section?`;

export interface WarRoomSectionTarget {
  /** URL segment and `state.dive` key — `/war-room/<key>`. */
  readonly key: string;
  /** Label shown in the transport jump-menu. */
  readonly label: string;
  /** Menu dot colour when the stop is reachable. */
  readonly dot: string;
}

/**
 * The transport jump-menu's target list, moved out of `renderVals()` unchanged
 * — same stops, same labels, same colours, same order.
 */
export const WAR_ROOM_SECTIONS: readonly WarRoomSectionTarget[] = [
  { key: "intro", label: "Introductions", dot: "#67E8F9" },
  { key: "governance", label: "Governance deep-dive", dot: "#3B82F6" },
  { key: "licensing", label: "Licensing deep-dive", dot: "#14B8A6" },
  { key: "adoption", label: "Adoption deep-dive", dot: "#F97316" },
  { key: "compliance", label: "Compliance deep-dive", dot: "#F3F4F6" },
  { key: "health", label: "Health deep-dive", dot: "#22C55E" },
  { key: "security", label: "Security deep-dive", dot: "#0078D4" },
  { key: "demo", label: "Live Copilot demo", dot: "#34d399" },
  { key: "copilot", label: "Copilot readiness — go / no-go", dot: "#67E8F9" },
  { key: "sow", label: "Statement of work", dot: "#0078D4" },
  { key: "remediation", label: "Full remediation plan", dot: "#34d399" },
  { key: "timeline", label: "Remediation timeline", dot: "#0078D4" },
  { key: "docs", label: "Documents", dot: "#7dd3fc" },
];

const SECTION_KEYS: ReadonlySet<string> = new Set(WAR_ROOM_SECTIONS.map((s) => s.key));

/**
 * Stops the jump-menu treats as reachable even when no `SCRIPT` beat names
 * them — they open their dive panel directly. Kept as its own set because it is
 * the one place the menu's `live` test is more permissive than the beat lookup.
 */
const PANEL_ONLY_SECTIONS: ReadonlySet<string> = new Set([
  "sow",
  "docs",
  "remediation",
  "timeline",
]);

/**
 * `SCRIPT` is ported design data behind `@ts-nocheck`, so it arrives as a
 * heterogeneous array of object literals. Read it through one narrow shape
 * instead of letting `any` leak across this module.
 */
interface ScriptBeat {
  act?: number;
  dive?: string;
  demo?: unknown;
  intro?: unknown;
}

const BEATS = SCRIPT as unknown as readonly ScriptBeat[];

export function isWarRoomSection(value: unknown): value is string {
  return typeof value === "string" && SECTION_KEYS.has(value);
}

/** Single place this route's URLs are built, so a rename can't leave a caller stale. */
export function warRoomSectionPath(section: string): string {
  return `${WAR_ROOM_BASE_PATH}/${section}`;
}

/**
 * Narrow a raw `:section` route param (which may be absent, stale or
 * hand-typed) to a real section key, or `null`.
 */
export function parseWarRoomSection(raw: string | undefined | null): string | null {
  return isWarRoomSection(raw) ? raw : null;
}

/**
 * The `SCRIPT` index a section lands on, or `-1`.
 *
 * The three lookup rules are the jump-menu's own, unchanged: "intro" matches
 * the first beat that either carries an intro or opens act 0, "demo" matches
 * the first beat flagged `demo`, and every other key matches the first beat
 * whose `dive` is that key.
 */
export function warRoomSectionBeat(section: string): number {
  if (section === "intro") {
    return BEATS.findIndex((b) => b.intro !== undefined || b.act === 0);
  }
  if (section === "demo") {
    return BEATS.findIndex((b) => b.demo);
  }
  return BEATS.findIndex((b) => b.dive === section);
}

/** A section is reachable if a beat names it, or it opens a panel directly. */
export function isWarRoomSectionLive(section: string): boolean {
  if (!isWarRoomSection(section)) return false;
  return warRoomSectionBeat(section) >= 0 || PANEL_ONLY_SECTIONS.has(section);
}

/**
 * What a section actually does to the beat machine. Mirrors the jump-menu's
 * `onClick` branch order exactly: intro first, then panel-only stops (no beat),
 * then a real beat jump.
 */
export type WarRoomSectionResolution =
  | { kind: "intro" }
  | { kind: "panel"; dive: string }
  | { kind: "beat"; index: number }
  | { kind: "unreachable" };

export function resolveWarRoomSection(section: string | undefined | null): WarRoomSectionResolution {
  const key = parseWarRoomSection(section);
  if (key === null) return { kind: "unreachable" };

  const index = warRoomSectionBeat(key);
  const live = index >= 0 || PANEL_ONLY_SECTIONS.has(key);
  if (!live) return { kind: "unreachable" };

  if (key === "intro") return { kind: "intro" };
  if (index < 0) return { kind: "panel", dive: key };
  return { kind: "beat", index };
}

/**
 * The section a given briefing state is sitting in, or `null` for "no named
 * section right now".
 *
 * `null` deliberately does NOT mean "clear the URL". The briefing spends most
 * of its time on the main scripted thread between dives, and blanking the URL
 * back to `/war-room` there would make a refresh drop the viewer all the way
 * back to the opening prelude. The URL instead keeps naming the last section
 * reached until the next one is entered — which is what section-level
 * granularity means.
 */
export function deriveWarRoomSection(state: {
  prelude?: unknown;
  dive?: unknown;
  beat?: unknown;
  introStage?: unknown;
}): string | null {
  // The opening hero / onboarding wizard sits in front of every named stop.
  if (state.prelude) return null;
  if (isWarRoomSection(state.dive)) return state.dive;
  // Read the demo off the beat, NOT off `state.demo`: the briefing keeps the
  // demo object around long after the demo beat has passed, so trusting it would
  // rewind the URL to /war-room/demo every time a later dive closed.
  const beat = typeof state.beat === "number" && state.beat >= 0 ? BEATS[state.beat] : undefined;
  if (beat && beat.demo) return "demo";
  // Arrivals and the "who first" picker together ARE the introductions.
  if (state.introStage) return "intro";
  return null;
}

/**
 * How a section change should reach the URL.
 *
 * `push` only for a stop the viewer explicitly chose from the transport menu,
 * so Back returns to the last place they picked. The briefing auto-advances
 * through dives on its own, and each of those becoming its own Back stop would
 * make the Back button useless — those `replace` instead.
 */
export interface WarRoomUrlSync {
  path: string;
  replace: boolean;
}

export function warRoomUrlSync(section: string, explicit: boolean): WarRoomUrlSync {
  return { path: warRoomSectionPath(section), replace: !explicit };
}
