/**
 * Contextual-tab assembly and the trail that feeds it.
 *
 * The complaint that produced this: "I try to go right back to what I clicked
 * to get where I am and it's a new icon." So the way back is not something each
 * screen draws — it is spliced into every contextual tab at the same position,
 * by this module, and screens cannot opt out.
 */

import { ArrowLeft, Search } from "lucide-react";
import { ACCENT } from "../theme";
import type { ContextualTabSpec, PeekKind, RibbonGroup } from "./types";

/** Where you have been. `openDoc` pushes onto the front. */
export interface TrailEntry {
  /** Peek kind, or "screen" for a plain destination. */
  kind: PeekKind | "screen";
  id: string;
  /** Resolved human name — never a raw id. */
  label: string;
  /** Reopens this entry. */
  open: () => void;
}

/** handoff.md: `state.trail` is capped at 6 and deduped. */
export const TRAIL_MAX = 6;

/**
 * Pushes an entry onto the trail, most-recent-first.
 *
 * Deduped on `kind:id`, so revisiting something moves it to the front rather
 * than growing a run of the same record. Returns a new array; never mutates.
 */
export function pushTrail(trail: readonly TrailEntry[], entry: TrailEntry): TrailEntry[] {
  const key = trailKey(entry);
  const without = trail.filter((t) => trailKey(t) !== key);
  return [entry, ...without].slice(0, TRAIL_MAX);
}

/** `kind:id`, the identity used to dedupe the trail and to exclude the current doc. */
export function trailKey(entry: { kind: PeekKind | "screen"; id: string }): string {
  return `${entry.kind}:${entry.id}`;
}

/**
 * Builds the Back group: the three most recent places that are not where you
 * are now, then "Search everything".
 *
 * `currentKey` is excluded explicitly rather than assumed to be `trail[0]`.
 * That assumption held only while `openDoc` was the sole way focus moved —
 * clicking a doc tab or closing one changes the active doc without touching
 * the trail, and the large button would then offer to navigate to the record
 * already on screen. The design guards it the same way, by filtering the
 * selected doc out before taking the first entry.
 *
 * When there is nothing to go back to, the group still renders with only
 * "Search everything". Hiding it would move every other group one position
 * left, which is exactly the instability this design exists to prevent.
 */
export function backGroupFrom(
  trail: readonly TrailEntry[],
  onSearchEverything: () => void,
  currentKey?: string,
): RibbonGroup {
  const previous = trail.filter((entry) => trailKey(entry) !== currentKey).slice(0, 3);
  const [first, ...rest] = previous;

  return {
    label: "Back",
    large: first
      ? [
          {
            label: first.label,
            icon: ArrowLeft,
            intent: "open",
            onSelect: first.open,
            title: `Back to ${first.label}`,
          },
        ]
      : [],
    small: [
      ...rest.map((entry) => ({
        label: entry.label,
        icon: ArrowLeft as typeof ArrowLeft,
        intent: "open" as const,
        onSelect: entry.open,
        title: `Back to ${entry.label}`,
      })),
      {
        label: "Search everything",
        icon: Search,
        intent: "open" as const,
        onSelect: onSearchEverything,
        color: ACCENT.info,
        title: "Search everything (Ctrl K)",
      },
    ],
  };
}

/** The Back group is spliced in here — second, always. */
export const BACK_GROUP_POSITION = 1;

/**
 * Assembles a contextual tab's final group list.
 *
 * This is the only place a contextual tab's groups are put together. Screens
 * hand over their own groups and never see the Back group; splicing it here is
 * what guarantees the trail sits in the same place on Endpoint Tools, Script
 * Tools, Pipeline Tools, Observe Tools and everything built later.
 *
 * If a screen supplies no groups at all, Back still lands at index 0 rather
 * than being dropped — the group must exist for the tab to be usable.
 */
export function assembleContextualGroups(
  spec: ContextualTabSpec,
  trail: readonly TrailEntry[],
  onSearchEverything: () => void,
  currentKey?: string,
): RibbonGroup[] {
  const groups = [...spec.groups];
  const back = backGroupFrom(trail, onSearchEverything, currentKey);
  const at = Math.min(BACK_GROUP_POSITION, groups.length);
  groups.splice(at, 0, back);
  return groups;
}
