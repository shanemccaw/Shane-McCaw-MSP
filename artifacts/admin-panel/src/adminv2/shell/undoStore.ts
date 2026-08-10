/**
 * Universal undo/redo store — shell-level, screen-namespaced.
 *
 * Each screen gets its own undo and redo stack, so undoing while on the
 * Build Tracker does not clobber anything the SQL screen did. The active
 * screen's stacks are what the Undo/Redo buttons in the title bar operate on.
 *
 * ## Usage (from any screen store)
 *
 * ```ts
 * import { pushUndo } from "../../shell/undoStore";
 *
 * export async function updateFoo(id: number, patch: Partial<FooRow>) {
 *   const prev = state.foos.find((f) => f.id === id);
 *   if (prev) {
 *     pushUndo("my-screen", {
 *       label: `Edit "${prev.name}"`,
 *       revert: async () => { await updateFoo(id, pick(prev, Object.keys(patch))); },
 *     });
 *   }
 *   // … perform the mutation …
 * }
 * ```
 *
 * The screen id must match the `id` field passed to `registerScreen()`.
 * `revert` must return `Promise<void>`.
 * Pushing a new action clears the redo stack for that screen (standard behaviour).
 */

type Listener = () => void;

/** One reversible action. */
export interface UndoEntry {
  /** Shown in the Undo button's tooltip — be specific: "Assign 'Epic' → Sprint 1". */
  label: string;
  /** Async function that fully reverses the action. Must return Promise<void>. */
  revert: () => Promise<void>;
}

interface ScreenHistory {
  undo: UndoEntry[];
  redo: UndoEntry[];
}

const MAX_STACK = 20;

const stacks = new Map<string, ScreenHistory>();
const listeners = new Set<Listener>();

function get(screenId: string): ScreenHistory {
  if (!stacks.has(screenId)) stacks.set(screenId, { undo: [], redo: [] });
  return stacks.get(screenId)!;
}

function notify() {
  for (const fn of listeners) fn();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Subscribe to undo-store changes (React `useSyncExternalStore`-compatible).
 */
export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Returns a stable snapshot reference — always the same object unless
 * something actually changed. Required by `useSyncExternalStore`.
 */
let _snapshot: Record<string, never> = {};
export function getSnapshot(): Record<string, never> { return _snapshot; }

/** Push an undoable action for a given screen. Clears that screen's redo stack. */
export function pushUndo(screenId: string, entry: UndoEntry): void {
  const h = get(screenId);
  h.undo = [...h.undo.slice(-(MAX_STACK - 1)), entry];
  h.redo = []; // new action always clears redo
  _snapshot = {};
  notify();
}

/** Undo the most recent action for the given screen, push it to redo. */
export async function undo(screenId: string): Promise<void> {
  const h = get(screenId);
  const entry = h.undo[h.undo.length - 1];
  if (!entry) return;
  h.undo = h.undo.slice(0, -1);
  h.redo = [...h.redo, entry];
  _snapshot = {};
  notify();
  await entry.revert();
}

/** Redo the most recently undone action for the given screen. */
export async function redo(screenId: string): Promise<void> {
  const h = get(screenId);
  const entry = h.redo[h.redo.length - 1];
  if (!entry) return;
  h.redo = h.redo.slice(0, -1);
  h.undo = [...h.undo, entry];
  _snapshot = {};
  notify();
  await entry.revert();
}

export function canUndo(screenId: string): boolean {
  return (stacks.get(screenId)?.undo.length ?? 0) > 0;
}

export function canRedo(screenId: string): boolean {
  return (stacks.get(screenId)?.redo.length ?? 0) > 0;
}

/** Label of the action that would be undone next. Empty string when nothing to undo. */
export function undoLabel(screenId: string): string {
  const stack = stacks.get(screenId)?.undo ?? [];
  return stack[stack.length - 1]?.label ?? "";
}

/** Label of the action that would be redone next. Empty string when nothing to redo. */
export function redoLabel(screenId: string): string {
  const stack = stacks.get(screenId)?.redo ?? [];
  return stack[stack.length - 1]?.label ?? "";
}

/** Clear all undo/redo history for a screen (e.g. after a full refresh/sync). */
export function clearHistory(screenId: string): void {
  stacks.delete(screenId);
  _snapshot = {};
  notify();
}
