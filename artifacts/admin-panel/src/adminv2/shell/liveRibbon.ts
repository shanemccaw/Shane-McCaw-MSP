/**
 * Live overlay for ribbon commands and fixed-tab labels.
 *
 * A screen's `ribbon` array (and the fixed tab strip) is built once, at
 * `registerScreen()` module-load time — outside any component, so a plain
 * `RibbonCommand.label`/`.live`/`.color`/`.active` value is frozen at
 * whatever it was when the module first imported (typically before any real
 * data has loaded). That is fine for static labels ("Git pull") but wrong
 * for anything that has to show a real, current number — the Money screen's
 * fixed-tab label is real profit (design convention, `SHELL.md`), not the
 * word "Money", and several of its ribbon buttons show real revenue/cost/
 * sales-count figures the same way.
 *
 * This is a tiny, screen-agnostic key/value overlay: a screen pushes an
 * entry keyed by whatever string it put in `RibbonCommand.liveKey` (or, for
 * a fixed tab's own label, `tab:<tabId>`), and `RibbonBody`/`RibbonTabs`
 * read it at render time, falling back to the static value when no entry
 * exists. It intentionally does not know about `ShellContext`'s `ribbonGroups`
 * memo at all — that memo stays keyed on navigation state only, and this
 * overlay is a second, independent read at render time, the same way a
 * `<Clock />` component reads `Date.now()` without its parent re-rendering.
 */

import { useSyncExternalStore } from "react";

export interface LiveRibbonEntry {
  label?: string;
  live?: string;
  color?: string;
  active?: boolean;
}

const entries = new Map<string, LiveRibbonEntry>();
let version = 0;
const listeners = new Set<() => void>();

/** `null` clears the key entirely, falling back to the command's static fields. */
export function setLiveRibbonValue(key: string, entry: LiveRibbonEntry | null): void {
  if (entry === null) {
    if (!entries.has(key)) return;
    entries.delete(key);
  } else {
    entries.set(key, entry);
  }
  version++;
  for (const listener of listeners) listener();
}

export function getLiveRibbonEntry(key: string): LiveRibbonEntry | undefined {
  return entries.get(key);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getVersion(): number {
  return version;
}

/** Re-renders the caller whenever any live ribbon value changes. Read entries with `getLiveRibbonEntry` afterward. */
export function useLiveRibbonVersion(): number {
  return useSyncExternalStore(subscribe, getVersion, getVersion);
}
