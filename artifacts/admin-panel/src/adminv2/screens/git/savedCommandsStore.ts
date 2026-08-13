/**
 * Saved Deploy Console commands — a small, client-only pinboard that sits
 * beside the full server-side run history (`run-history/runHistoryStore.ts`).
 *
 * Deliberately NOT server-side: this is a handful of commands one admin
 * wants one click away in the floating console's sidekick, not an audit
 * trail — adding a `simulator_*` table (and the manual migration that comes
 * with it, per CLAUDE.md) would be a heavier lift than a personal shortlist
 * needs. Persisted to `localStorage`, so it is this browser's list only —
 * it will not follow the admin to a different machine, and does not need to.
 */

const STORAGE_KEY = "admin-panel.deploy-console.saved-commands.v1";

export interface SavedCommand {
  id: string;
  cmd: string;
  savedAt: number;
}

type Listener = () => void;
const listeners = new Set<Listener>();

function load(): SavedCommand[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((c): c is SavedCommand => !!c && typeof c.cmd === "string" && typeof c.id === "string")
      : [];
  } catch {
    return [];
  }
}

let commands: SavedCommand[] = load();

function persist(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(commands));
  } catch {
    // storage full or blocked — the list just won't persist across reloads
  }
}

function notify(): void {
  for (const fn of listeners) fn();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSavedCommands(): SavedCommand[] {
  return commands;
}

export function isSaved(cmd: string): boolean {
  const trimmed = cmd.trim();
  return commands.some((c) => c.cmd === trimmed);
}

/** Adds `cmd` to the top of the list. Re-saving an already-saved command just moves it to the top. */
export function saveCommand(cmd: string): void {
  const trimmed = cmd.trim();
  if (!trimmed) return;
  commands = [
    { id: `saved-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, cmd: trimmed, savedAt: Date.now() },
    ...commands.filter((c) => c.cmd !== trimmed),
  ];
  persist();
  notify();
}

export function removeSavedCommand(id: string): void {
  commands = commands.filter((c) => c.id !== id);
  persist();
  notify();
}
