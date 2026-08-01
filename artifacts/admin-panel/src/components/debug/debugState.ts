// ⚠️ DEBUG-ONLY CODE — only ever read by the requireAdmin-gated debug panel ⚠️
//
// artifacts/admin-panel/src/components/debug/debugState.ts
//
// Lets any admin-panel page publish a slice of its live in-memory state to the
// floating debug panel (#285) with one hook call:
//
//     useDebugState("simulator", { selectedNodeId, runId, isRunning });
//
// It is a module-level registry rather than a React context on purpose: the
// panel is mounted as a sibling of the routed page (in App.tsx's RequireAdmin
// wrapper), not as its ancestor, so a context provider could not reach it
// without wrapping the entire router in one more provider. A registry works
// regardless of where either side sits in the tree, and a page that never calls
// the hook simply contributes nothing.
//
// Slices are keyed by caller-chosen name and removed on unmount, so navigating
// away from a page takes its state out of the panel instead of leaving a stale
// snapshot behind.

import { useEffect } from "react";

type Slices = Record<string, unknown>;

let slices: Slices = {};
let listeners: Array<() => void> = [];

function emit(): void {
  for (const l of listeners) l();
}

/** Current registered slices. Treated as immutable so useSyncExternalStore-style
 *  consumers see a new reference exactly when something actually changed. */
export function getDebugStateSlices(): Slices {
  return slices;
}

export function subscribeDebugState(listener: () => void): () => void {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

/** Internal — used by the useDebugState hook and by tests. */
export function setDebugStateSlice(key: string, value: unknown): void {
  if (key in slices && Object.is(slices[key], value)) return;
  slices = { ...slices, [key]: value };
  emit();
}

/** Internal — used by the useDebugState hook's cleanup. */
export function clearDebugStateSlice(key: string): void {
  if (!(key in slices)) return;
  const next = { ...slices };
  delete next[key];
  slices = next;
  emit();
}

/**
 * Publishes a page's live state to the debug panel under `page.<key>`.
 *
 * Costs the page nothing when the panel isn't open — the panel only reads the
 * registry while its State tab is showing. `value` is stored by reference, so
 * pass the state you already have rather than building a new object every
 * render if it is expensive to construct.
 */
export function useDebugState(key: string, value: unknown): void {
  useEffect(() => {
    setDebugStateSlice(key, value);
  }, [key, value]);

  useEffect(() => {
    return () => clearDebugStateSlice(key);
  }, [key]);
}
